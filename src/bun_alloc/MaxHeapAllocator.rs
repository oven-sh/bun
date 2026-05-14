//! Single allocation only.

use core::alloc::Layout;
use core::ptr::NonNull;

use crate::MAX_ALIGN_T as MAX_ALIGN;
use crate::{Alignment, Allocator};

/// Zig backed `array_list` with `std.array_list.AlignedManaged(u8, .of(std.c.max_align_t))`
/// so the returned pointer is guaranteed aligned to `max_align_t`. Rust `Vec<u8>`
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
unsafe impl Sync for MaxHeapAllocator {}

impl MaxHeapAllocator {
    /// Zig: `fn alloc(ptr, len, alignment, _) ?[*]u8`
    pub fn alloc(&mut self, len: usize, alignment: Alignment, _ret_addr: usize) -> Option<*mut u8> {
        debug_assert!(alignment.to_byte_units() <= MAX_ALIGN);
        // Zig: `self.array_list.items.len = 0;` — reuse the existing buffer.
        self.len = 0;
        // Zig: `ensureTotalCapacity(len) catch return null`
        if self.capacity < len {
            // Grow (or first-allocate) to at least `len`, MAX_ALIGN-aligned.
            let new_layout = Layout::from_size_align(len, MAX_ALIGN).ok()?;
            // SAFETY: `new_layout` has nonzero align; size may be 0, which
            // `alloc::alloc` accepts (returns a dangling-but-aligned ptr we
            // never deref). On grow, the old buffer is freed first.
            let new_ptr = unsafe {
                if let Some(old) = self.ptr {
                    let old_layout = Layout::from_size_align_unchecked(self.capacity, MAX_ALIGN);
                    std::alloc::realloc(old.as_ptr(), old_layout, len)
                } else {
                    std::alloc::alloc(new_layout)
                }
            };
            let new_ptr = NonNull::new(new_ptr)?;
            self.ptr = Some(new_ptr);
            self.capacity = len;
        }
        self.len = len;
        Some(self.ptr?.as_ptr())
    }

    /// Zig: `fn resize(...) bool { @panic("not implemented") }`
    pub fn resize(
        &mut self,
        _buf: &mut [u8],
        _alignment: Alignment,
        _new_len: usize,
        _ret_addr: usize,
    ) -> bool {
        panic!("not implemented");
    }

    /// Zig: `fn free(...) void {}` — no-op (single owned buffer freed on Drop).
    pub fn free(&mut self, _buf: &mut [u8], _alignment: Alignment, _ret_addr: usize) {}

    pub fn reset(&mut self) {
        self.len = 0;
    }

    /// Borrow the allocator for a scope; `reset()` is called automatically when
    /// the returned guard drops. Mirrors Zig's `defer max_heap_allocator.reset()`
    /// at loop-iteration scope without an ad-hoc `scopeguard`.
    pub fn scope(&mut self) -> MaxHeapScope<'_> {
        MaxHeapScope { inner: self }
    }

    // PORT NOTE: reshaped out-param constructor. Zig's `init(self: *Self, allocator) -> std.mem.Allocator`
    // both initialized `self` and returned a vtable+ptr pair. In Rust the caller constructs
    // `MaxHeapAllocator::init()` and obtains `&dyn Allocator` by borrowing the result.
    pub fn init() -> Self {
        Self {
            ptr: None,
            capacity: 0,
            len: 0,
        }
    }

    /// Zig: `pub fn isInstance(allocator) bool { return allocator.vtable == &vtable; }`
    pub fn is_instance(alloc: &dyn Allocator) -> bool {
        alloc.is::<Self>()
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

// `Allocator` is a marker trait carrying `type_id()`; the vtable methods above
// are inherent (no dynamic dispatch needed for a single-allocation arena).
impl Allocator for MaxHeapAllocator {}

impl Drop for MaxHeapAllocator {
    fn drop(&mut self) {
        // Zig: `pub fn deinit` — freed `array_list`.
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

// ported from: src/bun_alloc/MaxHeapAllocator.zig
