//! Single allocation only.

use core::alloc::Layout;
use core::ptr::NonNull;

use crate::Allocator;
use crate::MAX_ALIGN_T as MAX_ALIGN;

/// Owns a single raw `MAX_ALIGN`-aligned buffer (a `Vec<u8>` would allocate
/// with align 1, violating the `alignment <= MAX_ALIGN` contract).
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

/// RAII guard returned by [`MaxHeapAllocator::scope`]; resets the allocator on drop.
pub struct MaxHeapScope<'a> {
    inner: &'a mut MaxHeapAllocator,
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
            // SAFETY: `ptr`/`capacity` describe this allocator's own buffer,
            // allocated with `MAX_ALIGN` alignment.
            unsafe {
                std::alloc::dealloc(
                    ptr.as_ptr(),
                    Layout::from_size_align_unchecked(self.capacity, MAX_ALIGN),
                );
            }
        }
    }
}
