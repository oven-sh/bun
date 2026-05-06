//! Allocator-vtable shims that import bun_core/bun_sys/bun_runtime types and
//! therefore cannot live in `bun_alloc` (tier-0). MOVED here per CYCLEBREAK.
//! `bun_alloc` keeps unit-stub re-exports so legacy `use bun_alloc::X` paths
//! resolve until callers migrate.
#![allow(unused, non_snake_case, dead_code)]

#[path = "LinuxMemFdAllocator.rs"] pub mod linux_mem_fd_allocator;
#[path = "MimallocArena.rs"]       pub mod mimalloc_arena;
                                   pub mod allocation_scope;
