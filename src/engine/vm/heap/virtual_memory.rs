//! Address space that is reserved first and backed by memory later.

use core::ffi::c_void;

use bun_alloc::default_alloc;

#[cfg(unix)]
mod platform {
    use core::ptr::{null_mut, with_exposed_provenance_mut};

    #[cfg(any(target_os = "linux", target_os = "android"))]
    const RESERVE_FLAGS: i32 = libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_NORESERVE;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    const RESERVE_FLAGS: i32 = libc::MAP_PRIVATE | libc::MAP_ANON;

    pub fn reserve(size: usize) -> Option<usize> {
        // SAFETY: a new mapping at an address that the kernel picks.
        let address =
            unsafe { libc::mmap(null_mut(), size, libc::PROT_NONE, RESERVE_FLAGS, -1, 0) };
        if address == libc::MAP_FAILED {
            return None;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        // SAFETY: advice about the new mapping.
        unsafe {
            libc::madvise(address, size, libc::MADV_NOHUGEPAGE);
        }
        Some(address.expose_provenance())
    }

    pub unsafe fn commit(address: usize, size: usize) -> bool {
        let protection = libc::PROT_READ | libc::PROT_WRITE;
        // SAFETY: the caller's.
        unsafe { libc::mprotect(with_exposed_provenance_mut(address), size, protection) == 0 }
    }

    pub unsafe fn discard(address: usize, size: usize) {
        #[cfg(target_os = "macos")]
        const ADVICE: i32 = libc::MADV_FREE_REUSABLE;
        #[cfg(not(target_os = "macos"))]
        const ADVICE: i32 = libc::MADV_DONTNEED;
        // SAFETY: the caller's.
        unsafe { libc::madvise(with_exposed_provenance_mut(address), size, ADVICE) };
    }

    pub unsafe fn reuse(_address: usize, _size: usize) {
        #[cfg(target_os = "macos")]
        // SAFETY: the caller's.
        unsafe {
            libc::madvise(
                with_exposed_provenance_mut(_address),
                _size,
                libc::MADV_FREE_REUSE,
            );
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub unsafe fn protect_none(address: usize, size: usize) -> bool {
        // SAFETY: the caller's.
        unsafe {
            discard(address, size);
            libc::mprotect(with_exposed_provenance_mut(address), size, libc::PROT_NONE) == 0
        }
    }

    /// Writes the pages that are resident, and has the kernel forget what it may have of the others.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) unsafe fn zero(address: usize, size: usize) {
        let page = bun_alloc::page_size();
        let (first, end) = (
            address.next_multiple_of(page),
            (address + size) / page * page,
        );
        // SAFETY: the caller's.
        let write = |from: usize, to: usize| unsafe {
            with_exposed_provenance_mut::<u8>(from).write_bytes(0, to - from);
        };
        write(address, first);
        write(end, address + size);
        let mut residency = [0u8; 4096];
        for start in (first..end).step_by(residency.len() * page) {
            let pages = &mut residency[..((end - start) / page).min(4096)];
            let (memory, length) = (with_exposed_provenance_mut(start), pages.len() * page);
            // SAFETY: a byte for each page.
            if unsafe { libc::mincore(memory, length, pages.as_mut_ptr()) } != 0 {
                pages.fill(1);
            }
            let mut from = start;
            for run in pages.chunk_by(|a, b| a & 1 == b & 1) {
                let (memory, length) = (with_exposed_provenance_mut(from), run.len() * page);
                // SAFETY: the caller's.
                let forget = || unsafe { libc::madvise(memory, length, libc::MADV_DONTNEED) } == 0;
                if run[0] & 1 != 0 || !forget() {
                    write(from, from + length);
                }
                from += length;
            }
        }
    }

    /// Advice does not clear the pages here.
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    pub unsafe fn protect_none(address: usize, size: usize) -> bool {
        let (address, flags) = (
            with_exposed_provenance_mut(address),
            RESERVE_FLAGS | libc::MAP_FIXED,
        );
        // SAFETY: the caller's.
        unsafe { libc::mmap(address, size, libc::PROT_NONE, flags, -1, 0) != libc::MAP_FAILED }
    }

    pub unsafe fn release(address: usize, size: usize) {
        // SAFETY: the caller's.
        unsafe { libc::munmap(with_exposed_provenance_mut(address), size) };
    }
}

#[cfg(windows)]
mod platform {
    use core::ffi::c_void;
    use core::ptr::{null_mut, with_exposed_provenance_mut};

    const MEM_COMMIT: u32 = 0x1000;
    const MEM_RESERVE: u32 = 0x2000;
    const MEM_DECOMMIT: u32 = 0x4000;
    const MEM_RELEASE: u32 = 0x8000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_READWRITE: u32 = 0x04;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn VirtualAlloc(address: *mut c_void, size: usize, kind: u32, protect: u32) -> *mut c_void;
        fn VirtualFree(address: *mut c_void, size: usize, kind: u32) -> i32;
    }

    pub fn reserve(size: usize) -> Option<usize> {
        // SAFETY: a new reservation at an address that the system picks.
        let address = unsafe { VirtualAlloc(null_mut(), size, MEM_RESERVE, PAGE_NOACCESS) };
        (!address.is_null()).then(|| address.expose_provenance())
    }

    pub unsafe fn commit(address: usize, size: usize) -> bool {
        let address = with_exposed_provenance_mut(address);
        // SAFETY: the caller's.
        unsafe { !VirtualAlloc(address, size, MEM_COMMIT, PAGE_READWRITE).is_null() }
    }

    pub unsafe fn discard(address: usize, size: usize) {
        // SAFETY: the caller's.
        unsafe { VirtualFree(with_exposed_provenance_mut(address), size, MEM_DECOMMIT) };
    }

    pub unsafe fn reuse(address: usize, size: usize) {
        // SAFETY: the caller's.
        if !unsafe { commit(address, size) } {
            bun_alloc::out_of_memory();
        }
    }

    pub unsafe fn protect_none(address: usize, size: usize) -> bool {
        // SAFETY: the caller's.
        unsafe { VirtualFree(with_exposed_provenance_mut(address), size, MEM_DECOMMIT) != 0 }
    }

    pub unsafe fn release(address: usize, _size: usize) {
        // SAFETY: the caller's.
        unsafe { VirtualFree(with_exposed_provenance_mut(address), 0, MEM_RELEASE) };
    }
}

/// `reserve`: an inaccessible range. The others take whole pages of such a range that nothing else uses.
/// `commit`: makes them readable and writable, filled with zeros. `discard`: gives the memory back until `reuse`,
/// after which the content is unspecified. `protect_none`: undoes `commit`. `release`: undoes `reserve`.
pub use platform::{commit, discard, protect_none, release, reserve, reuse};

/// As `default_alloc::zalloc`, which writes all of it if any part has been in use before. Much of a large allocation may
/// never be touched.
pub fn allocate_zeroed(size: usize) -> *mut c_void {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if size >= 4 << 20 && bun_alloc::USE_MIMALLOC {
        let memory = default_alloc::malloc(size);
        if !memory.is_null() {
            // SAFETY: new, of that size, and in a private anonymous mapping.
            unsafe { platform::zero(memory.expose_provenance(), size) };
        }
        return memory;
    }
    default_alloc::zalloc(size)
}
