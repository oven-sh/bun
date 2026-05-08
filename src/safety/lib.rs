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
// Upward hooks (PORTING.md §Dispatch).
//
// Low-tier `bun_safety` cannot name `bun_crash_handler` / `bun_bundler` /
// `bun_runtime::allocators` directly (upward edges). Stack-dump goes via
// link-time `extern "Rust"` (single provider); allocator predicates remain
// runtime-registered AtomicPtr slots (multi-provider — folds 8 higher-tier
// `is_instance` checks).
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, Ordering};

unsafe extern "Rust" {
    /// `bun_crash_handler::dump_stack_trace` (frame_count=10, stop_at_jsc_llint=true).
    /// Body is `#[no_mangle]` in `bun_crash_handler`; link-time resolved.
    fn __bun_safety_dump_stack(trace: &bun_core::StoredTrace);
}

/// Erased signature: `unsafe fn(alloc: bun_alloc::StdAllocator) -> bool`.
///
/// Provider (registered by `bun_runtime::init()`) folds the higher-tier
/// `is_instance` checks that `bun_safety` cannot name directly:
/// `std.heap.ArenaAllocator` vtable, `allocation_scope`, `LinuxMemFdAllocator`,
/// `MaxHeapAllocator`, `MimallocArena`, `CachedBytecode`,
/// `bundle_v2::allocator_has_pointer`, `heap_breakdown::Zone`.
pub static ALLOC_HAS_PTR: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Erased signature: `unsafe fn(alloc: bun_alloc::StdAllocator) -> bool`.
/// Provider: `bun_runtime::allocators::mimalloc_arena::is_instance`.
pub static IS_MIMALLOC_ARENA: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Symbolicate and print a captured `StoredTrace` via `bun_crash_handler`.
#[inline]
pub fn dump_stored_trace(trace: &bun_core::StoredTrace) {
    // SAFETY: link-time `extern "Rust"`; body in `bun_crash_handler` only reads `trace`.
    unsafe { __bun_safety_dump_stack(trace) };
}

/// Call through an allocator-predicate hook if registered; `false` otherwise.
#[inline]
pub(crate) fn call_alloc_predicate(hook: &AtomicPtr<()>, alloc: bun_alloc::StdAllocator) -> bool {
    let p = hook.load(Ordering::Relaxed);
    if p.is_null() {
        return false;
    }
    // SAFETY: `bun_runtime::init()` stores a fn ptr with this exact signature.
    let f: unsafe fn(bun_alloc::StdAllocator) -> bool = unsafe { core::mem::transmute(p) };
    unsafe { f(alloc) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/safety.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; sibling modules ported separately
// ──────────────────────────────────────────────────────────────────────────
