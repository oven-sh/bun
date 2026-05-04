use core::ffi::c_void;

// TODO(port): `std.heap.c_allocator` is a `std.mem.Allocator` value backed by libc
// malloc/free. Expose a `CAllocator` implementing `bun_alloc::Allocator` here in Phase B
// (or drop entirely if every caller migrated to the global mimalloc allocator).
// pub static C_ALLOCATOR: &dyn crate::Allocator = &crate::CAllocator;

pub use crate::fallback::z::allocator as z_allocator;

/// libc can free allocations without being given their size.
pub fn free_without_size(ptr: *mut c_void) {
    // SAFETY: `ptr` was allocated by libc malloc/calloc/realloc (or is null, which
    // libc free accepts as a no-op) — same precondition as Zig `std.c.free`.
    unsafe { libc::free(ptr) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/fallback.zig (9 lines)
//   confidence: medium
//   todos:      1
//   notes:      c_allocator const left as TODO — std.mem.Allocator value has no 1:1 Rust shape; z_allocator kept as thin re-export
// ──────────────────────────────────────────────────────────────────────────
