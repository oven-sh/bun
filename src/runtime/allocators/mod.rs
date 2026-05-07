//! Allocator-vtable shims that import bun_core/bun_sys/bun_runtime types and
//! therefore cannot live in `bun_alloc` (tier-0). MOVED here per CYCLEBREAK;
//! callers import these paths directly (no forwarding stubs in `bun_alloc`).
#![allow(unused, non_snake_case, dead_code)]

#[path = "LinuxMemFdAllocator.rs"] pub mod linux_mem_fd_allocator;
#[path = "MimallocArena.rs"]       pub mod mimalloc_arena;
                                   pub mod allocation_scope;

pub use allocation_scope::{AllocationScope, AllocationScopeIn};
pub use linux_mem_fd_allocator::LinuxMemFdAllocator;
