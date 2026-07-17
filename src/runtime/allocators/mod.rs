//! Allocator-vtable shims that import bun_core/bun_sys/bun_runtime types and
//! therefore cannot live in `bun_alloc` (tier-0). Moved here;
//! callers import these paths directly (no forwarding stubs in `bun_alloc`).
#![warn(unused_must_use)]

#[path = "LinuxMemFdAllocator.rs"]
pub mod linux_mem_fd_allocator;

pub use linux_mem_fd_allocator::LinuxMemFdAllocator;

/// Push this crate's `StdAllocator` vtable addresses into the
/// `bun_safety::alloc::has_ptr` registry so allocator-mismatch checks can
/// distinguish instances. Idempotent enough — call once at startup.
///
/// Coverage:
///  - `LinuxMemFdAllocator` / `MimallocArena` ×2 /
///    `bundle_v2::ExternalFreeFunctionAllocator` → registered below.
///  - `c_allocator` / `z_allocator` / `MimallocArena::is_instance` /
///    `String::is_wtf_allocator` → checked directly in `bun_safety::alloc::
///    has_ptr` (`bun_alloc` is below the safety tier).
///  - `MaxHeapAllocator` / `CachedBytecode` / `heap_breakdown::Zone` → these
///    have **no `StdAllocator` vtable**; their `is_instance` is `TypeId`-based
///    on `&dyn Allocator`, which `has_ptr(StdAllocator)` cannot dispatch on.
///    They are intentionally omitted (safe under-approximation — `has_ptr` may
///    return `false`).
pub fn register_safety_vtables() {
    bun_safety::register_alloc_vtable(linux_mem_fd_allocator::std_vtable());
    for vt in bun_alloc::mimalloc_arena::std_vtables() {
        bun_safety::register_alloc_vtable(vt);
    }
    bun_safety::register_alloc_vtable(&bun_bundler::bundle_v2::EXTERNAL_FREE_VTABLE);
}
