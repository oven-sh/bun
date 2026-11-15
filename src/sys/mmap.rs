use core::ptr::NonNull;

use crate::{E, Error, Fd, Maybe, Tag};

/// A mapping at an address of the system's choice. Unmapped on drop.
pub struct Mmap {
    ptr: NonNull<u8>,
    len: usize,
}

impl Mmap {
    pub fn new(len: usize, prot: i32, flags: i32, fd: Fd, offset: i64) -> Maybe<Mmap> {
        let ptr = crate::mmap(core::ptr::null_mut(), len, prot, flags, fd, offset)?;
        let ptr = NonNull::new(ptr).ok_or_else(|| Error::from_code(E::ENOMEM, Tag::mmap))?;
        Ok(Mmap { ptr, len })
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

    /// SAFETY: as [`Self::as_slice`], and the mapping is writable.
    pub unsafe fn as_mut_slice(&mut self) -> &mut [u8] {
        // SAFETY: the caller's contract. The pages stay mapped until `drop`.
        unsafe { core::slice::from_raw_parts_mut(self.as_ptr(), self.len) }
    }
}

impl Drop for Mmap {
    fn drop(&mut self) {
        let _ = crate::munmap(self.as_ptr(), self.len);
    }
}
