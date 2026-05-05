pub mod alloc;
pub use alloc::CheckedAllocator;

mod critical_section;
pub use critical_section::CriticalSection;

mod thread_lock;
pub use thread_lock::ThreadLock;

pub mod thread_id;

// ──────────────────────────────────────────────────────────────────────────
// Debug-hook registration (CYCLEBREAK §Debug-hook, pattern 3).
//
// Low-tier `bun_safety` cannot name `bun_crash_handler` / `bun_bundler` /
// `bun_str` directly (upward edges). Instead we expose AtomicPtr<()> slots
// that `bun_runtime::init()` populates with erased fn-ptrs at startup. Calls
// through an unset hook are no-ops.
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, Ordering};

/// Erased signature: `unsafe fn(trace: &bun_core::StoredTrace)`.
/// Provider: `bun_crash_handler::dump_stack_trace` (frame_count=10, stop_at_jsc_llint=true).
pub static DUMP_STACK: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Erased signature: `unsafe fn(alloc: *const ()) -> bool` (alloc = `&dyn Allocator` data ptr).
/// Provider: `bun_bundler::allocator_has_pointer`.
pub static ALLOC_HAS_PTR: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Erased signature: `unsafe fn(alloc: *const ()) -> bool`.
/// Provider: `bun_str::String::is_wtf_allocator`.
pub static IS_WTF_ALLOCATOR: AtomicPtr<()> = AtomicPtr::new(null_mut());

/// Call through `DUMP_STACK` if registered; no-op otherwise.
#[inline]
pub fn dump_stored_trace(trace: &bun_core::StoredTrace) {
    let p = DUMP_STACK.load(Ordering::Relaxed);
    if p.is_null() {
        return;
    }
    // SAFETY: `bun_runtime::init()` stores a fn ptr with this exact signature.
    let f: unsafe fn(&bun_core::StoredTrace) = unsafe { core::mem::transmute(p) };
    unsafe { f(trace) };
}

/// Call through an allocator-predicate hook if registered; `false` otherwise.
#[inline]
pub(crate) fn call_alloc_predicate(hook: &AtomicPtr<()>, alloc: *const ()) -> bool {
    let p = hook.load(Ordering::Relaxed);
    if p.is_null() {
        return false;
    }
    // SAFETY: `bun_runtime::init()` stores a fn ptr with this exact signature.
    let f: unsafe fn(*const ()) -> bool = unsafe { core::mem::transmute(p) };
    unsafe { f(alloc) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/safety.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; sibling modules ported separately
// ──────────────────────────────────────────────────────────────────────────
