//! Unix-epoch nanosecond timestamps from the monotonic clock, anchored once.
//! Reading CLOCK_REALTIME per span would expose spans to NTP slew mid-trace;
//! anchoring matches what the reference SDKs do with `performance.timeOrigin`.

use core::sync::atomic::{AtomicU64, Ordering};

/// `epoch_ns - mono_ns` at the anchor (wrapping); 0 = not yet anchored.
static OFFSET: AtomicU64 = AtomicU64::new(0);

#[inline]
fn mono_now() -> u64 {
    let t = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
    (t.sec as u64)
        .wrapping_mul(1_000_000_000)
        .wrapping_add(t.nsec as u64)
}

#[cold]
fn anchor() -> u64 {
    let epoch_ns = bun_core::time::nano_timestamp() as u64;
    let off = epoch_ns.wrapping_sub(mono_now()).max(1);
    match OFFSET.compare_exchange(0, off, Ordering::Relaxed, Ordering::Relaxed) {
        Ok(_) => off,
        Err(existing) => existing,
    }
}

/// Nanoseconds since the Unix epoch. Monotonic within the process.
#[inline]
pub fn now_unix_nanos() -> u64 {
    let mut off = OFFSET.load(Ordering::Relaxed);
    if off == 0 {
        off = anchor();
    }
    mono_now().wrapping_add(off).max(1)
}
