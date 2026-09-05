use core::ptr::NonNull;

use crate::{Alignment, StdAllocator, basic};

/// `Box<[u8]>` freed through a [`StdAllocator`]: the global allocator or a foreign free callback.
pub struct OwnedBytes {
    /// `None` ⇒ empty; nothing is freed on drop.
    ptr: Option<NonNull<u8>>,
    len: usize,
    allocator: StdAllocator,
}

// SAFETY: `ptr` is the sole alias of the buffer; `StdAllocator` is `Send + Sync`.
unsafe impl Send for OwnedBytes {}
// SAFETY: `&OwnedBytes` only reads the uniquely owned slice.
unsafe impl Sync for OwnedBytes {}

impl OwnedBytes {
    pub const fn new() -> Self {
        Self {
            ptr: None,
            len: 0,
            allocator: basic::C_ALLOCATOR,
        }
    }

    /// # Safety
    /// `ptr[..len]` is a live allocation owned by `allocator`; ownership moves here.
    pub unsafe fn from_raw_parts(ptr: NonNull<u8>, len: usize, allocator: StdAllocator) -> Self {
        Self {
            ptr: Some(ptr),
            len,
            allocator,
        }
    }

    /// `(ptr, len, allocator)` for the caller to free, or `None` when empty.
    pub fn into_raw_parts(self) -> Option<(NonNull<u8>, usize, StdAllocator)> {
        let this = core::mem::ManuallyDrop::new(self);
        this.ptr.map(|ptr| (ptr, this.len, this.allocator))
    }

    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        match self.ptr {
            // SAFETY: `ptr[..len]` is live and initialized (`from_raw_parts` contract).
            Some(ptr) => unsafe { core::slice::from_raw_parts(ptr.as_ptr(), self.len) },
            None => &[],
        }
    }
}

impl Default for OwnedBytes {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl core::ops::Deref for OwnedBytes {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.as_slice()
    }
}

impl From<Box<[u8]>> for OwnedBytes {
    fn from(bytes: Box<[u8]>) -> Self {
        if bytes.is_empty() {
            return Self::new();
        }
        let len = bytes.len();
        // SAFETY: `Box::into_raw` of a non-empty slice is non-null.
        let ptr = unsafe { NonNull::new_unchecked(Box::into_raw(bytes).cast::<u8>()) };
        Self {
            ptr: Some(ptr),
            len,
            allocator: basic::C_ALLOCATOR,
        }
    }
}

impl From<Vec<u8>> for OwnedBytes {
    #[inline]
    fn from(bytes: Vec<u8>) -> Self {
        Self::from(bytes.into_boxed_slice())
    }
}

impl Drop for OwnedBytes {
    fn drop(&mut self) {
        if let Some(ptr) = self.ptr {
            // `raw_free`, not `free`: a foreign callback must run for a zero-length buffer too.
            // SAFETY: `ptr[..len]` is the allocation adopted by `from_raw_parts`/`From`.
            let buf = unsafe { core::slice::from_raw_parts_mut(ptr.as_ptr(), self.len) };
            self.allocator
                .raw_free(buf, Alignment::from_byte_units(1), 0);
        }
    }
}
