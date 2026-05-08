#![allow(unused, non_snake_case, clippy::all)]
#![warn(unused_must_use)]

#![warn(unreachable_pub)]
pub mod alloc;

#[path = "CriticalSection.rs"] mod critical_section;
pub use critical_section::CriticalSection;

#[path = "ThreadLock.rs"] mod thread_lock;
pub use thread_lock::ThreadLock;

pub mod thread_id;

// ──────────────────────────────────────────────────────────────────────────
// Allocator-identity registry (storage moved DOWN — data, not fn-ptrs).
//
// Low-tier `bun_safety` cannot name higher-tier allocator types
// (`MimallocArena`, `allocation_scope`, `LinuxMemFdAllocator`,
// `MaxHeapAllocator`, `CachedBytecode`, `bundle_v2`, `heap_breakdown::Zone`)
// directly. Instead of an erased fn-ptr hook, those crates push their
// `&'static AllocatorVTable` addresses here at init; `alloc::has_ptr` then
// does a plain pointer-equality scan. This is the same predicate Zig's
// `is_instance` checks compute (vtable identity), just with the *data* moved
// down rather than the *code* called up.
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, Ordering};

/// Erased `*const AllocatorVTable`. `*const ()` is `!Sync`, so wrap.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct VTablePtr(pub *const ());
// SAFETY: vtable addresses are immutable `'static` data.
unsafe impl Send for VTablePtr {}
// SAFETY: vtable addresses are immutable `'static` data.
unsafe impl Sync for VTablePtr {}

/// Vtable addresses of allocators whose `StdAllocator.ptr` is meaningful
/// (i.e. distinct instances have distinct `.ptr`). Registered by higher-tier
/// crates at startup via [`register_alloc_vtable`].
static KNOWN_ALLOC_VTABLES: parking_lot::RwLock<Vec<VTablePtr>> =
    parking_lot::RwLock::new(Vec::new());

/// Vtable address of `MimallocArena`'s allocator. Set once by
/// `bun_runtime::allocators::mimalloc_arena` at init.
static MIMALLOC_ARENA_VTABLE: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Register a higher-tier allocator's vtable so `alloc::has_ptr` recognizes it.
pub fn register_alloc_vtable(vtable: &'static bun_alloc::AllocatorVTable) {
    KNOWN_ALLOC_VTABLES
        .write()
        .push(VTablePtr(vtable as *const _ as *const ()));
}

/// Record the `MimallocArena` allocator vtable (single distinguished entry).
pub fn register_mimalloc_arena_vtable(vtable: &'static bun_alloc::AllocatorVTable) {
    MIMALLOC_ARENA_VTABLE.store(vtable as *const _ as *mut (), Ordering::Relaxed);
}

#[inline]
pub(crate) fn known_alloc_vtable(alloc: bun_alloc::StdAllocator) -> bool {
    let needle = VTablePtr(alloc.vtable as *const _ as *const ());
    KNOWN_ALLOC_VTABLES.read().contains(&needle)
}

#[inline]
pub(crate) fn is_mimalloc_arena(alloc: bun_alloc::StdAllocator) -> bool {
    let v = MIMALLOC_ARENA_VTABLE.load(Ordering::Relaxed);
    !v.is_null() && core::ptr::eq(alloc.vtable as *const _ as *const (), v)
}

/// Dump a captured trace via the T0 fallback (raw addresses / std::backtrace).
/// Crash-report symbolication lives in `bun_crash_handler` and is invoked
/// from there directly.
#[inline]
pub fn dump_stored_trace(trace: &bun_core::StoredTrace) {
    bun_core::dump_stack_trace(
        &trace.trace(),
        bun_core::DumpStackTraceOptions { frame_count: 10, stop_at_jsc_llint: true, ..Default::default() },
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/safety.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; sibling modules ported separately
// ──────────────────────────────────────────────────────────────────────────
