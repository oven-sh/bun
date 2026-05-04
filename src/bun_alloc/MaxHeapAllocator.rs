//! Single allocation only.

use core::ffi::c_void;
use core::mem::align_of;

use crate::Allocator;

// TODO(port): Zig used `std.array_list.AlignedManaged(u8, .of(std.c.max_align_t))` so the
// backing buffer is guaranteed aligned to `max_align_t`. Rust `Vec<u8>` allocates with
// align 1. Phase B: either store `Vec<libc::max_align_t>` and byte-slice it, or use a raw
// `alloc::alloc(Layout::from_size_align(cap, MAX_ALIGN))` buffer.
pub struct MaxHeapAllocator {
    array_list: Vec<u8>,
}

// libc::max_align_t alignment (16 on x86_64/aarch64).
const MAX_ALIGN: usize = align_of::<libc::max_align_t>();

impl Allocator for MaxHeapAllocator {
    fn alloc(ptr: *mut c_void, len: usize, alignment: usize, _: usize) -> Option<*mut u8> {
        debug_assert!(alignment <= MAX_ALIGN);
        // SAFETY: ptr is the `&mut MaxHeapAllocator` erased through the Allocator vtable.
        let self_ = unsafe { &mut *(ptr as *mut MaxHeapAllocator) };
        self_.array_list.clear();
        // Zig: `ensureTotalCapacity(len) catch return null` — Vec::try_reserve maps cleanly.
        self_
            .array_list
            .try_reserve(len.saturating_sub(self_.array_list.len()))
            .ok()?;
        // SAFETY: capacity >= len after try_reserve; bytes are treated as uninitialized by caller.
        unsafe { self_.array_list.set_len(len) };
        Some(self_.array_list.as_mut_ptr())
    }

    fn resize(_: *mut c_void, _buf: &mut [u8], _: usize, _new_len: usize, _: usize) -> bool {
        unimplemented!("not implemented");
    }

    fn free(_: *mut c_void, _: &mut [u8], _: usize, _: usize) {}

    // TODO(port): Zig vtable also sets `.remap = &std.mem.Allocator.noRemap`; ensure the
    // `bun_alloc::Allocator` trait provides a default `remap` that returns None.
}

impl MaxHeapAllocator {
    pub fn reset(&mut self) {
        self.array_list.clear();
    }

    // PORT NOTE: reshaped out-param constructor. Zig's `init(self: *Self, allocator) -> std.mem.Allocator`
    // both initialized `self` and returned a vtable+ptr pair. In Rust the caller constructs
    // `MaxHeapAllocator::init()` and obtains `&dyn Allocator` by borrowing the result.
    pub fn init() -> Self {
        Self {
            array_list: Vec::new(),
        }
    }

    pub fn is_instance(allocator: &dyn Allocator) -> bool {
        // TODO(port): Zig compared `allocator.vtable == &vtable` for identity. Rust trait
        // objects don't expose stable vtable addresses; Phase B should add an
        // `Allocator::is<T>()` downcast hook (or compare `core::any::TypeId`).
        let _ = allocator;
        false
    }
}

// `pub fn deinit` dropped: body only freed `array_list`, which `Vec`'s Drop already does.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/MaxHeapAllocator.zig (58 lines)
//   confidence: medium
//   todos:      3
//   notes:      Allocator trait shape assumed from Zig vtable; Vec<u8> loses max_align_t guarantee; is_instance needs downcast support
// ──────────────────────────────────────────────────────────────────────────
