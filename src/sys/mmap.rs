use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use crate::{E, Error, Fd, Maybe, Tag};

/// A mapping at an address of the system's choice. Unmapped on drop.
pub struct Mmap {
    ptr: NonNull<u8>,
    len: usize,
}

impl Mmap {
    /// Panics if `flags` has `MAP_FIXED`.
    pub fn new(len: usize, prot: i32, flags: i32, fd: Fd, offset: i64) -> Maybe<Mmap> {
        #[cfg(unix)]
        assert!(flags & libc::MAP_FIXED == 0);
        // SAFETY: no `MAP_FIXED`.
        let ptr = unsafe { crate::mmap(core::ptr::null_mut(), len, prot, flags, fd, offset) }?;
        let ptr = NonNull::new(ptr).ok_or_else(|| Error::from_code(E::ENOMEM, Tag::mmap))?;
        Ok(Mmap { ptr, len })
    }

    /// SAFETY: `pages` is an `mmap` region, and nothing else unmaps it.
    pub unsafe fn from_raw(pages: *mut [u8]) -> Mmap {
        Mmap {
            // SAFETY: the caller's contract.
            ptr: unsafe { NonNull::new_unchecked(pages.cast()) },
            len: pages.len(),
        }
    }

    /// The pages stay mapped.
    pub fn into_raw(self) -> *mut [u8] {
        let this = ManuallyDrop::new(self);
        core::ptr::slice_from_raw_parts_mut(this.as_ptr(), this.len)
    }

    pub fn as_ptr(&self) -> *mut u8 {
        self.ptr.as_ptr()
    }

    pub fn size(&self) -> usize {
        self.len
    }

    /// SAFETY: the mapping is readable, its file covers it, and nothing else changes the file meanwhile.
    pub unsafe fn as_slice(&self) -> &[u8] {
        // SAFETY: the caller's contract. The pages stay mapped until `drop`.
        unsafe { core::slice::from_raw_parts(self.as_ptr(), self.len) }
    }

    /// SAFETY: as [`Self::as_slice`], for the rest of the process.
    pub unsafe fn leak(self) -> &'static [u8] {
        let this = ManuallyDrop::new(self);
        // SAFETY: the caller's contract. The pages are never unmapped.
        unsafe { core::slice::from_raw_parts(this.as_ptr(), this.len) }
    }

    /// SAFETY: as [`Self::as_slice`], and the mapping is writable.
    pub unsafe fn as_mut_slice(&mut self) -> &mut [u8] {
        // SAFETY: the caller's contract. The pages stay mapped until `drop`.
        unsafe { core::slice::from_raw_parts_mut(self.as_ptr(), self.len) }
    }
}

impl Drop for Mmap {
    fn drop(&mut self) {
        // SAFETY: `self` owns the pages, and every slice of them borrows `self`.
        let _ = unsafe { crate::munmap(self.as_ptr(), self.len) };
    }
}
