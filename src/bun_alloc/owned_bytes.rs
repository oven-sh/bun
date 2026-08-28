use core::ptr::NonNull;

use crate::{Alignment, StdAllocator, basic};

/// A heap byte buffer paired with the [`StdAllocator`] that frees it.
///
/// `Box<[u8]>` in the common case (global allocator), but the buffer can also
/// belong to a foreign owner with its own free callback (a native bundler
/// plugin's `free_plugin_source_code_context`), so a consumer such as the
/// bundler's `OutputFile` can adopt such bytes without a copy.
pub struct OwnedBytes {
    /// `None` ⇒ empty; nothing is freed on drop.
    ptr: Option<NonNull<u8>>,
    len: usize,
    allocator: StdAllocator,
}

// SAFETY: the buffer is uniquely owned through `ptr` and `StdAllocator` is
// `Send + Sync`; the free callback's thread-safety is the allocator's contract
// (same as `StdAllocator` itself).
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

    /// Adopt `ptr[..len]`, to be released with `allocator.free`.
    ///
    /// # Safety
    /// `ptr[..len]` must be a live, initialized allocation owned by `allocator`
    /// and nothing else may free it afterwards.
    pub unsafe fn from_raw_parts(ptr: NonNull<u8>, len: usize, allocator: StdAllocator) -> Self {
        Self {
            ptr: Some(ptr),
            len,
            allocator,
        }
    }

    /// Give up ownership: `(ptr, len, allocator)`, or `None` when empty. The
    /// caller must free `ptr[..len]` through `allocator`.
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
            // Not `StdAllocator::free`: that skips empty slices, but a foreign
            // owner's callback must run even for a zero-length buffer.
            // SAFETY: `ptr[..len]` is the allocation handed over in
            // `from_raw_parts`/`From<Box<[u8]>>`, owned by `allocator`.
            let buf = unsafe { core::slice::from_raw_parts_mut(ptr.as_ptr(), self.len) };
            self.allocator
                .raw_free(buf, Alignment::from_byte_units(1), 0);
        }
    }
}
