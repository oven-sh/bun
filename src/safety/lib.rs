#![warn(unused_must_use)]
pub mod alloc;

#[path = "CriticalSection.rs"]
mod critical_section;
pub use critical_section::CriticalSection;

pub mod thread_id;

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
