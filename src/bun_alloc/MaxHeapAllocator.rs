//! Single allocation only.

use core::alloc::Layout;
use core::ptr::NonNull;

use crate::MAX_ALIGN_T as MAX_ALIGN;
use crate::{Alignment, Allocator};

/// The returned pointer must be aligned to `max_align_t`. Rust `Vec<u8>`
/// allocates with align 1, which would violate the `alignment <= MAX_ALIGN`
/// contract. Store a raw `MAX_ALIGN`-aligned buffer instead.
pub struct MaxHeapAllocator {
    ptr: Option<NonNull<u8>>,
    capacity: usize,
    len: usize,
}

// SAFETY: `MaxHeapAllocator` owns its buffer exclusively; no interior shared
// state. Same Send/Sync story as `Vec<u8>`.
unsafe impl Send for MaxHeapAllocator {}
// SAFETY: `&MaxHeapAllocator` exposes no interior mutability — the raw `ptr`
// is only dereferenced via `&mut self` methods, so sharing `&Self` across
// threads cannot race on the buffer. Same `Sync` story as `Vec<u8>`.
unsafe impl Sync for MaxHeapAllocator {}

impl MaxHeapAllocator {

    /// No-op (single owned buffer freed on Drop).
    pub fn free(&mut self, _buf: &mut [u8], _alignment: Alignment, _ret_addr: usize) {}

    pub(crate) fn reset(&mut self) {
        self.len = 0;
    }

    /// Borrow the allocator for a scope; `reset()` is called automatically when
    /// the returned guard drops.
    pub fn scope(&mut self) -> MaxHeapScope<'_> {
        MaxHeapScope { inner: self }
    }

    // The caller constructs `MaxHeapAllocator::init()` and obtains
    // `&dyn Allocator` by borrowing the result.
    pub fn init() -> Self {
        Self {
            ptr: None,
            capacity: 0,
            len: 0,
        }
    }
}

impl Default for MaxHeapAllocator {
    fn default() -> Self {
        Self::init()
    }
}

/// RAII guard returned by [`MaxHeapAllocator::scope`]. Derefs to the underlying
/// allocator so callers can hand out `&mut MaxHeapAllocator` (or a derived
/// `&dyn Allocator`) for the duration of the scope, and resets it on drop.
pub struct MaxHeapScope<'a> {
    inner: &'a mut MaxHeapAllocator,
}

impl core::ops::Deref for MaxHeapScope<'_> {
    type Target = MaxHeapAllocator;
    fn deref(&self) -> &Self::Target {
        self.inner
    }
}

impl core::ops::DerefMut for MaxHeapScope<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.inner
    }
}

impl Drop for MaxHeapScope<'_> {
    fn drop(&mut self) {
        self.inner.reset();
    }
}

// `Allocator` is a marker trait; the vtable methods above are inherent (no
// dynamic dispatch needed for a single-allocation arena).
impl Allocator for MaxHeapAllocator {}

impl Drop for MaxHeapAllocator {
    fn drop(&mut self) {
        if let Some(ptr) = self.ptr.take() {
            // SAFETY: `ptr`/`capacity` were produced by `alloc`/`realloc` above
            // with `MAX_ALIGN` alignment.
            unsafe {
                std::alloc::dealloc(
                    ptr.as_ptr(),
                    Layout::from_size_align_unchecked(self.capacity, MAX_ALIGN),
                );
            }
        }
    }
}
