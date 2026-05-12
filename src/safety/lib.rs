#![allow(unused, non_snake_case, clippy::all)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
pub mod alloc;

#[path = "CriticalSection.rs"]
mod critical_section;
pub use critical_section::CriticalSection;

#[path = "ThreadLock.rs"]
mod thread_lock;
pub use thread_lock::{ThreadLock, ThreadLockGuard};

pub mod thread_id;

// ──────────────────────────────────────────────────────────────────────────
// Allocator-identity registry (storage moved DOWN — data, not fn-ptrs).
//
// Low-tier `bun_safety` cannot name higher-tier allocator types
// (`MimallocArena`, `LinuxMemFdAllocator`, `MaxHeapAllocator`,
// `CachedBytecode`, `bundle_v2`, `heap_breakdown::Zone`)
// directly. Instead of an erased fn-ptr hook, those crates push their
// `&'static AllocatorVTable` addresses here at init; `alloc::has_ptr` then
// does a plain pointer-equality scan. This is the same predicate Zig's
// `is_instance` checks compute (vtable identity), just with the *data* moved
// down rather than the *code* called up.
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

/// Vtable addresses of allocators whose `StdAllocator.ptr` is meaningful
/// (i.e. distinct instances have distinct `.ptr`). Registered by higher-tier
/// crates at startup via [`register_alloc_vtable`].
///
/// Lock-free fixed-capacity array: writes happen once at init, reads sit on
/// `has_ptr()` (called from `CheckedAllocator` on debug paths). The Zig spec
/// is a chain of inline `ptr_eq` against compile-time-known vtable addresses,
/// so a Relaxed scan over ≤16 words matches that cost profile.
const KNOWN_ALLOC_CAP: usize = 16;
static KNOWN_ALLOC_VTABLES: [AtomicPtr<()>; KNOWN_ALLOC_CAP] =
    [const { AtomicPtr::new(null_mut()) }; KNOWN_ALLOC_CAP];
static KNOWN_ALLOC_LEN: AtomicUsize = AtomicUsize::new(0);

/// Register a higher-tier allocator's vtable so `alloc::has_ptr` recognizes it.
/// Called from `bun_runtime::allocators::register_safety_vtables` (and any
/// other crate that owns a `StdAllocator` vtable above this tier).
///
/// **Registration is single-threaded at startup** (`bun_bin::main` step 6,
/// before reader threads spawn), so cross-thread ordering is provided by the
/// thread-spawn happens-before edge — *not* by these atomics. All accesses are
/// therefore `Relaxed`; a `Release` on `fetch_add` would be dead weight (it
/// would publish `len` *before* the slot store, synchronizing nothing). The
/// slot index is claimed via `fetch_add` anyway so accidental concurrent
/// registration is at least slot-safe (no clobber); a reader racing the
/// `fetch_add → slot.store` window would see a null slot, which is a harmless
/// no-match (`needle` is always a non-null vtable address).
pub fn register_alloc_vtable(vtable: &'static bun_alloc::AllocatorVTable) {
    let p = vtable as *const _ as *mut ();
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
    let needle = alloc.vtable as *const _ as *mut ();
    let n = KNOWN_ALLOC_LEN.load(Ordering::Relaxed).min(KNOWN_ALLOC_CAP);
    KNOWN_ALLOC_VTABLES[..n]
        .iter()
        .any(|s| s.load(Ordering::Relaxed) == needle)
}

/// `MimallocArena.isInstance` — `bun_alloc` is below us, so call it directly
/// (no registry needed for this one).
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
