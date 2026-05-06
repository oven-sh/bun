//! Single allocation only.

use core::alloc::Layout;
use core::mem::align_of;
use core::ptr::NonNull;

use crate::{Alignment, Allocator};

// libc::max_align_t alignment (16 on x86_64/aarch64).
const MAX_ALIGN: usize = align_of::<libc::max_align_t>();

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
    pub fn resize(&mut self, _buf: &mut [u8], _alignment: Alignment, _new_len: usize, _ret_addr: usize) -> bool {
        panic!("not implemented");
    }

    /// Zig: `fn free(...) void {}` — no-op (single owned buffer freed on Drop).
    pub fn free(&mut self, _buf: &mut [u8], _alignment: Alignment, _ret_addr: usize) {}

    pub fn reset(&mut self) {
        self.len = 0;
    }

    // PORT NOTE: reshaped out-param constructor. Zig's `init(self: *Self, allocator) -> std.mem.Allocator`
    // both initialized `self` and returned a vtable+ptr pair. In Rust the caller constructs
    // `MaxHeapAllocator::init()` and obtains `&dyn Allocator` by borrowing the result.
    pub fn init() -> Self {
        Self { ptr: None, capacity: 0, len: 0 }
    }

    /// Zig: `pub fn isInstance(allocator) bool { return allocator.vtable == &vtable; }`
    pub fn is_instance(allocator: &dyn Allocator) -> bool {
        Allocator::type_id(allocator) == core::any::TypeId::of::<MaxHeapAllocator>()
    }
}

impl Default for MaxHeapAllocator {
    fn default() -> Self { Self::init() }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/MaxHeapAllocator.zig (58 lines)
//   confidence: high
//   notes:      AlignedManaged(u8, max_align_t) → raw MAX_ALIGN-aligned buffer
//               (Vec<u8> would lose the alignment guarantee). vtable fns are
//               inherent; `is_instance` uses Allocator::type_id().
// ──────────────────────────────────────────────────────────────────────────
