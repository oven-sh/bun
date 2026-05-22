// ── time ──────────────────────────────────────────────────────────────────
// Port of `std.time` (vendor/zig/lib/std/time.zig:80-107) — the full
// `comptime_int` constant ladder plus `{nano,milli,}timestamp()`. Zig's
// `comptime_int` coerces to any numeric type; Rust callers `as`-cast at the
// use-site (`NS_PER_S as i128`, `MS_PER_S as f64`, …). Every value fits in
// `u64` (and the ≤per-second constants in `i32`), so all such casts —
// including to `f64` — are lossless.
// ns
pub const NS_PER_US: u64 = 1_000;
pub const NS_PER_MS: u64 = 1_000_000;
pub const NS_PER_S: u64 = 1_000_000_000;
pub const NS_PER_MIN: u64 = 60 * NS_PER_S;
pub const NS_PER_HOUR: u64 = 60 * NS_PER_MIN;
pub const NS_PER_DAY: u64 = 24 * NS_PER_HOUR;
pub const NS_PER_WEEK: u64 = 7 * NS_PER_DAY;
// us
pub const US_PER_MS: u64 = 1_000;
pub const US_PER_S: u64 = 1_000_000;
// ms
pub const MS_PER_S: u64 = 1_000;
pub const MS_PER_DAY: u64 = 86_400_000;
// s
pub const S_PER_DAY: u32 = 86_400;

#[cfg(unix)]
unsafe extern "C" {
    /// `&mut libc::timespec` is ABI-identical to libc's `struct timespec *`
    /// (thin non-null pointer to a `#[repr(C)]` struct); the type encodes the
    /// only pointer-validity precondition, so `safe fn` discharges the
    /// link-time proof and `nano_timestamp`/`Timespec::now_real` call it
    /// directly.
    pub(crate) safe fn clock_gettime(
        clk_id: libc::clockid_t,
        tp: &mut libc::timespec,
    ) -> core::ffi::c_int;
}

/// `std.time.nanoTimestamp()` — wall-clock nanoseconds since the Unix epoch.
#[inline]
pub fn nano_timestamp() -> i128 {
    #[cfg(unix)]
    {
        let mut ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        clock_gettime(libc::CLOCK_REALTIME, &mut ts);
        (ts.tv_sec as i128) * NS_PER_S as i128 + (ts.tv_nsec as i128)
    }
    #[cfg(not(unix))]
    {
        // SystemTime is backed by GetSystemTimePreciseAsFileTime on Windows.
        match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
            Ok(d) => d.as_nanos() as i128,
            Err(e) => -(e.duration().as_nanos() as i128),
        }
    }
}
/// `std.time.milliTimestamp()`
#[inline]
pub fn milli_timestamp() -> i64 {
    (nano_timestamp() / NS_PER_MS as i128) as i64
}
/// `std.time.timestamp()` — wall-clock seconds since the Unix epoch.
#[inline]
pub fn timestamp() -> i64 {
    (nano_timestamp() / NS_PER_S as i128) as i64
}

/// `std.time.Timer` — monotonic stopwatch.
#[derive(Clone, Copy, Debug)]
pub struct Timer {
    start: std::time::Instant,
}
impl Timer {
    #[inline]
    pub fn start() -> Result<Self, crate::Error> {
        Ok(Self {
            start: std::time::Instant::now(),
        })
    }
    #[inline]
    pub fn read(&self) -> u64 {
        self.start.elapsed().as_nanos() as u64
    }
    #[inline]
    pub fn lap(&mut self) -> u64 {
        let now = std::time::Instant::now();
        let ns = now.duration_since(self.start).as_nanos() as u64;
        self.start = now;
        ns
    }
    #[inline]
    pub fn reset(&mut self) {
        self.start = std::time::Instant::now();
    }
}
