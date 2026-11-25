use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

/// `N` zeroed bytes, resident only where they were written: the allocator would clear all of a block it has used before.
pub struct PageBuffer<const N: usize> {
    bytes: NonNull<[u8; N]>,
    is_mapped: bool,
}

// SAFETY: owns its bytes like a `Box<[u8; N]>`.
unsafe impl<const N: usize> Send for PageBuffer<N> {}
// SAFETY: as above.
unsafe impl<const N: usize> Sync for PageBuffer<N> {}

impl<const N: usize> PageBuffer<N> {
    pub fn new() -> Self {
        match Self::map() {
            Some(bytes) => Self {
                bytes,
                is_mapped: true,
            },
            None => Self {
                bytes: crate::heap::into_raw_nn(crate::boxed_zeroed()),
                is_mapped: false,
            },
        }
    }

    #[cfg(all(unix, not(bun_asan), not(miri)))]
    fn map() -> Option<NonNull<[u8; N]>> {
        // SAFETY: a new anonymous mapping aliases nothing.
        let mapping = unsafe {
            libc::mmap(
                core::ptr::null_mut(),
                N,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
                -1,
                0,
            )
        };
        if mapping == libc::MAP_FAILED {
            return None;
        }
        // The kernel merges neighbouring mappings, which under THP `enabled=always` can add up to a huge page.
        // SAFETY: the range is the mapping made above.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        unsafe {
            libc::madvise(mapping, N, libc::MADV_NOHUGEPAGE);
        }
        NonNull::new(mapping.cast())
    }

    #[cfg(not(all(unix, not(bun_asan), not(miri))))]
    fn map() -> Option<NonNull<[u8; N]>> {
        None
    }
}

impl<const N: usize> Default for PageBuffer<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> Deref for PageBuffer<N> {
    type Target = [u8; N];

    #[inline]
    fn deref(&self) -> &[u8; N] {
        // SAFETY: `N` initialized bytes that `self` owns.
        unsafe { self.bytes.as_ref() }
    }
}

impl<const N: usize> DerefMut for PageBuffer<N> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8; N] {
        // SAFETY: `N` initialized bytes that `self` owns.
        unsafe { self.bytes.as_mut() }
    }
}

impl<const N: usize> Drop for PageBuffer<N> {
    fn drop(&mut self) {
        if !self.is_mapped {
            // SAFETY: the box that `new` made.
            unsafe { crate::heap::destroy(self.bytes.as_ptr()) };
            return;
        }
        // SAFETY: the mapping `map` made, which nothing borrows any more.
        #[cfg(unix)]
        unsafe {
            libc::munmap(self.bytes.as_ptr().cast(), N);
        }
    }
}
