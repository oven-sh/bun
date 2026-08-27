//! Unix-epoch nanosecond timestamps derived from the monotonic clock plus an
//! `epoch - monotonic` offset. The offset is re-measured when a new trace
//! starts in this process (at most once a second), so a clock step, NTP
//! `makestep` or a suspend — after which CLOCK_MONOTONIC and CLOCK_REALTIME
//! have drifted apart — is picked up by the next trace instead of skewing
//! every later span for the life of the process. The offset is process-wide,
//! so a span open *across* such a step sees the old offset at start and the
//! new one at end: its exported duration is off by the step (the encoder
//! clamps end >= start), the same exposure `@opentelemetry/sdk-trace-base`
//! has by deriving its offset from `Date.now()` per span. Everything else —
//! export deadlines, retry backoff — is a duration and uses [`MonoInstant`].

use core::sync::atomic::{AtomicU64, Ordering};
use core::time::Duration;

/// `epoch_ns - mono_ns` (wrapping); 0 = not yet measured.
static OFFSET: AtomicU64 = AtomicU64::new(0);
/// Monotonic time of the last re-measure.
static ANCHORED_AT: AtomicU64 = AtomicU64::new(0);
const REANCHOR_INTERVAL_NS: u64 = 1_000_000_000;

#[inline]
fn mono_ns() -> u64 {
    bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns()
}

/// A CLOCK_MONOTONIC reading; only comparable with other `MonoInstant`s.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct MonoInstant(u64);

impl MonoInstant {
    pub const FAR_FUTURE: MonoInstant = MonoInstant(u64::MAX);

    #[inline]
    pub fn now() -> MonoInstant {
        MonoInstant(mono_ns())
    }

    /// Saturating `self - earlier`.
    #[inline]
    pub fn since(self, earlier: MonoInstant) -> Duration {
        Duration::from_nanos(self.0.saturating_sub(earlier.0))
    }

    /// Time left until `self` from now (zero if passed).
    #[inline]
    pub fn remaining(self) -> Duration {
        self.since(MonoInstant::now())
    }
}

impl core::ops::Add<Duration> for MonoInstant {
    type Output = MonoInstant;
    #[inline]
    fn add(self, d: Duration) -> MonoInstant {
        MonoInstant(
            self.0
                .saturating_add(u64::try_from(d.as_nanos()).unwrap_or(u64::MAX)),
        )
    }
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
    let mono = mono_ns();
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
        measure(mono_ns());
    }
}

/// `ns`, or now when it is 0 (the ABI's "unspecified" timestamp).
#[inline]
pub fn or_now(ns: u64) -> u64 {
    if ns == 0 { now_unix_nanos() } else { ns }
}
