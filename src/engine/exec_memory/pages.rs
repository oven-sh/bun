//! What the operating system provides.

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Purpose {
    Code,
    Data,
}

#[cfg(unix)]
mod system {
    use super::Purpose;
    use core::ptr;

    const READ_WRITE: i32 = libc::PROT_READ | libc::PROT_WRITE;

    fn protection(purpose: Purpose) -> i32 {
        if purpose == Purpose::Code {
            READ_WRITE | libc::PROT_EXEC
        } else {
            READ_WRITE
        }
    }

    pub(crate) fn reserve(size: usize, purpose: Purpose) -> Option<usize> {
        #[cfg(target_os = "macos")]
        let (protection, flags) = (
            protection(purpose),
            if purpose == Purpose::Code {
                libc::MAP_JIT
            } else {
                0
            },
        );
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let (protection, flags, _) = (libc::PROT_NONE, libc::MAP_NORESERVE, purpose);
        #[cfg(target_os = "freebsd")]
        let (protection, flags, _) = (libc::PROT_NONE, 0, purpose);
        // SAFETY: the system picks an address that is not in use.
        let start = unsafe {
            libc::mmap(
                ptr::null_mut(),
                size,
                protection,
                flags | libc::MAP_PRIVATE | libc::MAP_ANON,
                -1,
                0,
            )
        };
        (start != libc::MAP_FAILED).then(|| start.expose_provenance())
    }

    pub(crate) unsafe fn unreserve(start: usize, size: usize) {
        // SAFETY: the caller's.
        unsafe { libc::munmap(ptr::with_exposed_provenance_mut(start), size) };
    }

    pub(crate) unsafe fn commit(start: usize, size: usize, purpose: Purpose) -> bool {
        // SAFETY: the caller's. Access only widens.
        cfg!(target_os = "macos")
            || unsafe {
                libc::mprotect(
                    ptr::with_exposed_provenance_mut(start),
                    size,
                    protection(purpose),
                ) == 0
            }
    }

    pub(crate) unsafe fn discard(start: usize, size: usize) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let advice = libc::MADV_DONTNEED;
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let advice = libc::MADV_FREE;
        // SAFETY: the caller's.
        unsafe { libc::madvise(ptr::with_exposed_provenance_mut(start), size, advice) };
    }
}

#[cfg(windows)]
mod system {
    use super::Purpose;

    const MEM_COMMIT: u32 = 0x1000;
    const MEM_RESERVE: u32 = 0x2000;
    const MEM_RELEASE: u32 = 0x8000;
    const MEM_RESET: u32 = 0x8_0000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_READWRITE: u32 = 0x04;
    const PAGE_EXECUTE_READWRITE: u32 = 0x40;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn VirtualAlloc(start: usize, size: usize, kind: u32, protection: u32) -> *mut u8;
        fn VirtualFree(start: usize, size: usize, kind: u32) -> i32;
    }

    pub(crate) fn reserve(size: usize, _purpose: Purpose) -> Option<usize> {
        // SAFETY: the system picks an address that is not in use.
        let start = unsafe { VirtualAlloc(0, size, MEM_RESERVE, PAGE_NOACCESS) };
        (!start.is_null()).then(|| start.expose_provenance())
    }

    pub(crate) unsafe fn unreserve(start: usize, _size: usize) {
        // SAFETY: the caller's.
        unsafe { VirtualFree(start, 0, MEM_RELEASE) };
    }

    pub(crate) unsafe fn commit(start: usize, size: usize, purpose: Purpose) -> bool {
        let protection = if purpose == Purpose::Code {
            PAGE_EXECUTE_READWRITE
        } else {
            PAGE_READWRITE
        };
        // SAFETY: the caller's. Access only widens.
        !unsafe { VirtualAlloc(start, size, MEM_COMMIT, protection) }.is_null()
    }

    pub(crate) unsafe fn discard(start: usize, size: usize) {
        // SAFETY: the caller's.
        unsafe { VirtualAlloc(start, size, MEM_RESET, PAGE_NOACCESS) };
    }
}

/// `unreserve`, `commit` and `discard` take whole pages of a reservation of the caller's. `discard` leaves them
/// accessible with any contents, so nothing may depend on what they held.
pub(crate) use system::{commit, discard, reserve, unreserve};

/// Lets this thread write to pages of code while `write` runs, which must not run generated code.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[inline]
pub(crate) fn with_writable_code(write: impl FnOnce()) {
    unsafe extern "C" {
        safe fn pthread_jit_write_protect_np(enabled: i32);
    }
    pthread_jit_write_protect_np(0);
    write();
    pthread_jit_write_protect_np(1);
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
#[inline]
pub(crate) fn with_writable_code(write: impl FnOnce()) {
    write();
}
