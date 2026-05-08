//! Allocator-vtable shims that import bun_core/bun_sys/bun_runtime types and
//! therefore cannot live in `bun_alloc` (tier-0). MOVED here per CYCLEBREAK;
//! callers import these paths directly (no forwarding stubs in `bun_alloc`).
#![allow(unused, non_snake_case, dead_code)]
#![warn(unused_must_use)]

#[path = "LinuxMemFdAllocator.rs"] pub mod linux_mem_fd_allocator;
#[path = "MimallocArena.rs"]       pub mod mimalloc_arena;
                                   pub mod allocation_scope;

pub use allocation_scope::{AllocationScope, AllocationScopeIn};
pub use linux_mem_fd_allocator::LinuxMemFdAllocator;

/// Push this crate's `StdAllocator` vtable addresses into the
/// `bun_safety::alloc::has_ptr` registry so allocator-mismatch checks can
/// distinguish instances (Zig: chain of inline `isInstance` calls in
/// `safety/alloc.zig:hasPtr`). Idempotent enough — call once at startup.
pub fn register_safety_vtables() {
    bun_safety::register_alloc_vtable(allocation_scope::std_vtable());
    bun_safety::register_alloc_vtable(linux_mem_fd_allocator::std_vtable());
    for vt in mimalloc_arena::std_vtables() {
        bun_safety::register_alloc_vtable(vt);
    }
}
