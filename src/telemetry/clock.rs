//! Unix-epoch nanosecond timestamps derived from the monotonic clock plus an
//! `epoch - monotonic` offset. Within a trace every timestamp comes from the
//! monotonic clock, so durations and parent/child ordering never see a wall
//! clock step. The offset itself is re-measured when a new root span starts
//! (at most once a second), so a clock step, NTP `makestep` or a suspend —
//! after which CLOCK_MONOTONIC and CLOCK_REALTIME have drifted apart — is
//! picked up by the next trace instead of skewing every later span for the
//! life of the process. (`@opentelemetry/sdk-trace-base` similarly re-derives
//! its offset per span from `Date.now()`; Java's SDK anchors per root span.)

use core::sync::atomic::{AtomicU64, Ordering};

/// `epoch_ns - mono_ns` (wrapping); 0 = not yet measured.
static OFFSET: AtomicU64 = AtomicU64::new(0);
/// Monotonic time of the last re-measure.
static ANCHORED_AT: AtomicU64 = AtomicU64::new(0);
const REANCHOR_INTERVAL_NS: u64 = 1_000_000_000;

#[inline]
fn mono_now() -> u64 {
    bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns()
}

#[cold]
fn measure(mono: u64) -> u64 {
    let epoch_ns = bun_core::time::nano_timestamp() as u64;
    let off = epoch_ns.wrapping_sub(mono).max(1);
    OFFSET.store(off, Ordering::Relaxed);
    ANCHORED_AT.store(mono.max(1), Ordering::Relaxed);
    off
}

/// Nanoseconds since the Unix epoch.
#[inline]
pub fn now_unix_nanos() -> u64 {
    let mono = mono_now();
    let mut off = OFFSET.load(Ordering::Relaxed);
    if off == 0 {
        off = measure(mono);
    }
    mono.wrapping_add(off).max(1)
}

/// Called when a new trace starts in this process: re-measure the epoch
/// offset (rate-limited), so one trace is internally consistent while a
/// long-running process still tracks the wall clock.
/// `now_ns` is a value from [`now_unix_nanos`] (used to skip a clock read).
#[inline]
pub fn reanchor(now_ns: u64) {
    let mono = now_ns.wrapping_sub(OFFSET.load(Ordering::Relaxed));
    if mono.wrapping_sub(ANCHORED_AT.load(Ordering::Relaxed)) >= REANCHOR_INTERVAL_NS {
        measure(mono_now());
    }
}

/// `ns`, or now when it is 0 (the ABI's "unspecified" timestamp).
#[inline]
pub fn or_now(ns: u64) -> u64 {
    if ns == 0 { now_unix_nanos() } else { ns }
}
