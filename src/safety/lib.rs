#![warn(unused_must_use)]
pub mod alloc;

#[path = "CriticalSection.rs"]
mod critical_section;
pub use critical_section::CriticalSection;

#[path = "ThreadLock.rs"]
mod thread_lock;
pub use thread_lock::{ThreadLock, ThreadLockGuard};

pub mod thread_id;

use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

const KNOWN_ALLOC_CAP: usize = 16;
static KNOWN_ALLOC_VTABLES: [AtomicPtr<()>; KNOWN_ALLOC_CAP] =
    [const { AtomicPtr::new(null_mut()) }; KNOWN_ALLOC_CAP];
static KNOWN_ALLOC_LEN: AtomicUsize = AtomicUsize::new(0);

pub fn register_alloc_vtable(vtable: &'static bun_alloc::AllocatorVTable) {
    let p = std::ptr::from_ref(vtable) as *mut ();
    let i = KNOWN_ALLOC_LEN.fetch_add(1, Ordering::Relaxed);
    debug_assert!(
        i < KNOWN_ALLOC_CAP,
        "KNOWN_ALLOC_VTABLES overflow; bump KNOWN_ALLOC_CAP"
    );
    if i < KNOWN_ALLOC_CAP {
        KNOWN_ALLOC_VTABLES[i].store(p, Ordering::Relaxed);
    }
}

#[inline]
pub(crate) fn known_alloc_vtable(alloc: bun_alloc::StdAllocator) -> bool {
    let needle = std::ptr::from_ref(alloc.vtable) as *mut ();
    let n = KNOWN_ALLOC_LEN.load(Ordering::Relaxed).min(KNOWN_ALLOC_CAP);
    KNOWN_ALLOC_VTABLES[..n]
        .iter()
        .any(|s| s.load(Ordering::Relaxed) == needle)
}

/// `MimallocArena.isInstance` — `bun_alloc` is below us, so call it directly
/// (no registry needed for this one).
#[cfg(debug_assertions)]
#[inline]
pub(crate) fn is_mimalloc_arena(alloc: bun_alloc::StdAllocator) -> bool {
    bun_alloc::MimallocArena::is_instance(&alloc)
}

/// Dump a captured trace via the T0 fallback (raw addresses / std::backtrace).
/// Crash-report symbolication lives in `bun_crash_handler` and is invoked
/// from there directly.
#[inline]
pub fn dump_stored_trace(trace: &bun_core::StoredTrace) {
    bun_core::dump_stack_trace(
        &trace.trace(),
        bun_core::DumpStackTraceOptions {
            frame_count: 10,
            stop_at_jsc_llint: true,
            ..Default::default()
        },
    );
}

// ported from: src/safety/safety.zig
