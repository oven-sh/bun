//! Allocator-vtable shims that import bun_core/bun_sys/bun_runtime types and
//! therefore cannot live in `bun_alloc` (tier-0). Moved here;
//! callers import these paths directly (no forwarding stubs in `bun_alloc`).
#![warn(unused_must_use)]

#[path = "LinuxMemFdAllocator.rs"]
pub mod linux_mem_fd_allocator;

pub use linux_mem_fd_allocator::LinuxMemFdAllocator;
