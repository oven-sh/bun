use core::ffi::c_void;

use crate::Alignment;

pub mod z;

/// An allocator backed by libc malloc/free. Exposed as a ZST with inherent
/// `raw_*` methods so the zeroing wrapper in `z.rs` can layer on top.
#[derive(Clone, Copy, Default)]
pub struct CAllocator;

pub static C_ALLOCATOR: CAllocator = CAllocator;

impl CAllocator {
    #[inline]
    pub fn raw_alloc(&self, len: usize, alignment: Alignment, _ret_addr: usize) -> Option<*mut u8> {
        // libc malloc guarantees alignment to `max_align_t`; for larger
        // alignments use the aligned variant.
        let align = alignment.to_byte_units();
        // SAFETY: libc malloc/aligned_alloc are sound for any nonzero size.
        let ptr = unsafe {
            if align <= crate::MAX_ALIGN_T {
                libc::malloc(len)
            } else {
                #[cfg(windows)]
                {
                    libc::aligned_malloc(len, align)
                }
                #[cfg(not(windows))]
                {
                    libc::aligned_alloc(align, len)
                }
            }
        };
        if ptr.is_null() {
            None
        } else {
            Some(ptr.cast())
        }
    }

    /// # Safety
    /// `buf` must describe a live allocation obtained from [`Self::raw_alloc`]
    /// with `alignment`.
    #[inline]
    pub unsafe fn raw_resize(
        &self,
        buf: &mut [u8],
        _alignment: Alignment,
        new_len: usize,
        _ret_addr: usize,
    ) -> bool {
        // In-place only — succeed on shrink or if the backing allocation
        // already has enough usable size; never relocate.
        if new_len <= buf.len() {
            return true;
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: caller contract — `buf` came from libc malloc on this platform.
            let usable = unsafe { libc::malloc_size(buf.as_ptr().cast()) };
            return new_len <= usable;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: caller contract — `buf` came from libc malloc on this platform.
            let usable = unsafe { libc::malloc_usable_size(buf.as_mut_ptr().cast()) };
            return new_len <= usable;
        }
        #[cfg(windows)]
        {
            // Our over-aligned path uses `_aligned_malloc`, and MSDN forbids
            // `_msize` on those blocks — must use `_aligned_msize` instead.
            unsafe extern "C" {
                fn _msize(p: *mut c_void) -> usize;
                fn _aligned_msize(p: *mut c_void, align: usize, offset: usize) -> usize;
            }
            // SAFETY: caller contract — `buf` came from `raw_alloc` on this platform.
            let usable = unsafe {
                if _alignment.to_byte_units() > crate::MAX_ALIGN_T {
                    _aligned_msize(buf.as_mut_ptr().cast(), _alignment.to_byte_units(), 0)
                } else {
                    _msize(buf.as_mut_ptr().cast())
                }
            };
            return new_len <= usable;
        }
        #[cfg(not(any(
            target_os = "macos",
            target_os = "linux",
            target_os = "android",
            windows
        )))]
        {
            false
        }
    }

    /// # Safety
    /// `buf` must describe a live allocation obtained from [`Self::raw_alloc`]
    /// with `alignment`. The allocation is freed exactly once; its memory must
    /// not be accessed after this call.
    #[inline]
    pub unsafe fn raw_free(&self, buf: &mut [u8], alignment: Alignment, _ret_addr: usize) {
        // On Windows MSVC, over-aligned allocations come from `_aligned_malloc`
        // and MUST be released with `_aligned_free`; passing them to `free()`
        // is heap corruption. POSIX `aligned_alloc` is freed with plain `free`.
        #[cfg(windows)]
        if alignment.to_byte_units() > crate::MAX_ALIGN_T {
            // SAFETY: caller contract — `buf` came from `_aligned_malloc` in `raw_alloc`.
            unsafe { libc::aligned_free(buf.as_mut_ptr().cast()) };
            return;
        }
        #[cfg(not(windows))]
        let _ = alignment;
        // SAFETY: caller contract — `buf` came from libc malloc/aligned_alloc
        // in `raw_alloc`.
        unsafe { libc::free(buf.as_mut_ptr().cast()) }
    }
}

impl crate::Allocator for CAllocator {}

pub use z::ALLOCATOR as z_allocator;

/// libc can free plain `malloc`/`calloc`/`realloc` allocations without being
/// given their size.
///
/// # Safety
/// `ptr` must be null or a live allocation returned by libc
/// `malloc`/`calloc`/`realloc`. On Windows, pointers from `_aligned_malloc`
/// (the over-aligned path in [`CAllocator::raw_alloc`]) are **not** valid here
/// and must go through [`CAllocator::raw_free`] so `_aligned_free` is used.
pub unsafe fn free_without_size(ptr: *mut c_void) {
    // SAFETY: caller contract — ptr is null or a plain malloc-family allocation;
    // libc free accepts null.
    unsafe { libc::free(ptr) }
}
