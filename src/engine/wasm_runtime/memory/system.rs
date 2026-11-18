//! Address space and pages from the operating system.

#[cfg(unix)]
mod system {
    use core::ptr;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    const UNACCOUNTED: i32 = libc::MAP_NORESERVE;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    const UNACCOUNTED: i32 = 0;

    pub(crate) fn reserve(size: usize) -> Option<usize> {
        let flags = libc::MAP_PRIVATE | libc::MAP_ANON | UNACCOUNTED;
        // SAFETY: the system picks an address that is not in use.
        let start = unsafe { libc::mmap(ptr::null_mut(), size, libc::PROT_NONE, flags, -1, 0) };
        (start != libc::MAP_FAILED).then(|| start.expose_provenance())
    }

    pub(crate) unsafe fn release(start: usize, size: usize) {
        // SAFETY: the caller's.
        unsafe { libc::munmap(ptr::with_exposed_provenance_mut(start), size) };
    }

    pub(crate) unsafe fn commit(start: usize, size: usize) -> bool {
        let start = ptr::with_exposed_provenance_mut(start);
        // SAFETY: the caller's. Access only widens.
        unsafe { libc::mprotect(start, size, libc::PROT_READ | libc::PROT_WRITE) == 0 }
    }

    pub(crate) fn address_space_limit() -> u64 {
        let mut limit = libc::rlimit {
            rlim_cur: libc::RLIM_INFINITY,
            rlim_max: libc::RLIM_INFINITY,
        };
        // SAFETY: the pointer is valid for the write.
        unsafe { libc::getrlimit(libc::RLIMIT_AS, &raw mut limit) };
        limit.rlim_cur as u64
    }
}

#[cfg(windows)]
mod system {
    const MEM_COMMIT: u32 = 0x1000;
    const MEM_RESERVE: u32 = 0x2000;
    const MEM_RELEASE: u32 = 0x8000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_READWRITE: u32 = 0x04;

    #[repr(C)]
    #[derive(Default)]
    struct MemoryStatus {
        size: u32,
        load: u32,
        total_physical: u64,
        available_physical: u64,
        total_page_file: u64,
        available_page_file: u64,
        total_virtual: u64,
        available_virtual: u64,
        available_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn VirtualAlloc(start: usize, size: usize, kind: u32, protection: u32) -> *mut u8;
        fn VirtualFree(start: usize, size: usize, kind: u32) -> i32;
        safe fn GlobalMemoryStatusEx(status: &mut MemoryStatus) -> i32;
    }

    pub(crate) fn reserve(size: usize) -> Option<usize> {
        // SAFETY: the system picks an address that is not in use.
        let start = unsafe { VirtualAlloc(0, size, MEM_RESERVE, PAGE_NOACCESS) };
        (!start.is_null()).then(|| start.expose_provenance())
    }

    pub(crate) unsafe fn release(start: usize, _size: usize) {
        // SAFETY: the caller's.
        unsafe { VirtualFree(start, 0, MEM_RELEASE) };
    }

    pub(crate) unsafe fn commit(start: usize, size: usize) -> bool {
        // SAFETY: the caller's. Access only widens.
        !unsafe { VirtualAlloc(start, size, MEM_COMMIT, PAGE_READWRITE) }.is_null()
    }

    pub(crate) fn address_space_limit() -> u64 {
        let mut status = MemoryStatus {
            size: size_of::<MemoryStatus>() as u32,
            ..Default::default()
        };
        match GlobalMemoryStatusEx(&mut status) {
            0 => u64::MAX,
            _ => status.total_virtual,
        }
    }
}

/// `release` takes a whole reservation of the caller's to which nothing refers any more, `commit` takes whole pages of
/// one. Pages are zero when they are first committed.
pub(crate) use system::{address_space_limit, commit, release, reserve};
