//! Unix-epoch nanosecond timestamps from the monotonic clock, anchored once.
//! Reading CLOCK_REALTIME per span would expose spans to NTP slew mid-trace;
//! anchoring matches what the reference SDKs do with `performance.timeOrigin`.

use std::sync::OnceLock;

struct Anchor {
    epoch_ns: i128,
    mono_ns: u64,
}

static ANCHOR: OnceLock<Anchor> = OnceLock::new();

#[inline]
fn mono_now() -> u64 {
    bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns()
}

fn anchor() -> &'static Anchor {
    ANCHOR.get_or_init(|| Anchor { epoch_ns: bun_core::time::nano_timestamp(), mono_ns: mono_now() })
}

/// Nanoseconds since the Unix epoch. Monotonic within the process.
#[inline]
pub fn now_unix_nanos() -> u64 {
    let a = anchor();
    let elapsed = mono_now().wrapping_sub(a.mono_ns);
    (a.epoch_ns + elapsed as i128).max(1) as u64
}
