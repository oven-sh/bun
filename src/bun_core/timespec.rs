// ── Timespec ──────────────────────────────────────────────────────────────
// Port of `bun.timespec` (bun.zig:3257). `extern struct { sec: i64, nsec: i64 }`.
// CANONICAL — the `bun` facade re-exports this as `bun::timespec`; do NOT
// re-port this struct elsewhere. The two `bun_sys::{linux,posix}::timespec`
// shims port DIFFERENT Zig types (`std.os.linux.timespec` / `std.posix.timespec`)
// for syscall ABI and intentionally do NOT alias this.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i64,
}
// SAFETY: two `i64` fields; all-zero is the epoch.
unsafe impl crate::ffi::Zeroable for Timespec {}
// SAFETY: `#[repr(C)]` with two `i64` fields → size 16, align 8, no padding,
// no interior mutability, `Copy + 'static`. Every byte is initialized.
unsafe impl bytemuck::NoUninit for Timespec {}

/// Lowercase alias (Zig spells it `bun.timespec`).
#[allow(non_camel_case_types)]
pub type timespec = Timespec;

impl Timespec {
    pub const EPOCH: Timespec = Timespec { sec: 0, nsec: 0 };
    const NS_PER_S: i64 = crate::time::NS_PER_S as i64;
    const NS_PER_MS: i64 = crate::time::NS_PER_MS as i64;

    #[inline]
    pub const fn new(sec: i64, nsec: i64) -> Self {
        Self { sec, nsec }
    }

    #[inline]
    pub fn eql(&self, other: &Timespec) -> bool {
        self == other
    }

    /// `self - other` (Zig: `duration`). Mimics C wrapping behaviour.
    pub fn duration(&self, other: &Timespec) -> Timespec {
        let mut sec = self.sec.wrapping_sub(other.sec);
        let mut nsec = self.nsec.wrapping_sub(other.nsec);
        if nsec < 0 {
            sec = sec.wrapping_sub(1);
            nsec = nsec.wrapping_add(Self::NS_PER_S);
        }
        Timespec { sec, nsec }
    }

    pub fn order(&self, other: &Timespec) -> core::cmp::Ordering {
        match self.sec.cmp(&other.sec) {
            core::cmp::Ordering::Equal => self.nsec.cmp(&other.nsec),
            o => o,
        }
    }

    /// Nanoseconds (saturating at `u64::MAX`).
    pub fn ns(&self) -> u64 {
        if self.sec <= 0 {
            return self.nsec.max(0) as u64;
        }
        let s_ns = (self.sec as u64).saturating_mul(Self::NS_PER_S as u64);
        // Zig-exact (bun.zig:3313 returns maxInt(i64))
        s_ns.checked_add(self.nsec.max(0) as u64)
            .unwrap_or(i64::MAX as u64)
    }

    /// Signed nanoseconds (wrapping). Port of `bun.timespec.nsSigned`.
    #[inline]
    pub fn ns_signed(&self) -> i64 {
        let ns_per_sec = self.sec.wrapping_mul(Self::NS_PER_S);
        let ns_from_nsec = self.nsec.div_euclid(Self::NS_PER_MS);
        ns_per_sec.wrapping_add(ns_from_nsec)
    }

    /// Milliseconds (signed, wrapping).
    #[inline]
    pub fn ms(&self) -> i64 {
        self.sec
            .wrapping_mul(1000)
            .wrapping_add(self.nsec.div_euclid(Self::NS_PER_MS))
    }
    #[inline]
    pub fn ms_unsigned(&self) -> u64 {
        self.ns() / Self::NS_PER_MS as u64
    }

    #[inline]
    pub fn greater(&self, other: &Timespec) -> bool {
        self.order(other).is_gt()
    }

    pub fn add_ms(&self, interval: i64) -> Timespec {
        let sec_inc = interval / 1000;
        let nsec_inc = (interval % 1000) * Self::NS_PER_MS;
        let mut t = *self;
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t.nsec.wrapping_add(nsec_inc);
        if t.nsec >= Self::NS_PER_S {
            t.sec = t.sec.wrapping_add(1);
            t.nsec -= Self::NS_PER_S;
        }
        t
    }

    /// Advance by a fractional millisecond count, preserving sub-ms precision
    /// as nanoseconds (matches sinon/fake-timers `tick(msFloat)` semantics).
    pub fn add_ms_float(&self, interval_ms: f64) -> Timespec {
        const MS_PER_S: i64 = 1000;
        let ns_per_ms_f = Self::NS_PER_MS as f64;
        let mut t = *self;
        let ms_inc = interval_ms.floor() as i64;
        // nanoRemainder: floor((msFloat * 1e6) % 1e6)
        let nsec_inc = (interval_ms * ns_per_ms_f).rem_euclid(ns_per_ms_f).floor() as i64;
        let sec_inc = ms_inc / MS_PER_S;
        let ms_remainder = ms_inc.rem_euclid(MS_PER_S);
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t
            .nsec
            .wrapping_add(ms_remainder * Self::NS_PER_MS + nsec_inc);
        if t.nsec >= Self::NS_PER_S {
            t.sec = t.sec.wrapping_add(1);
            t.nsec -= Self::NS_PER_S;
        } else if t.nsec < 0 {
            t.sec = t.sec.wrapping_sub(1);
            t.nsec += Self::NS_PER_S;
        }
        t
    }

    #[inline]
    pub fn min(a: Timespec, b: Timespec) -> Timespec {
        if a.order(&b).is_lt() { a } else { b }
    }
    #[inline]
    pub fn max(a: Timespec, b: Timespec) -> Timespec {
        if a.order(&b).is_gt() { a } else { b }
    }

    /// `bun.timespec.orderIgnoreEpoch` (bun.zig:3405) — EPOCH = "no timeout", treated as +∞.
    pub fn order_ignore_epoch(a: Timespec, b: Timespec) -> core::cmp::Ordering {
        if a == b {
            return core::cmp::Ordering::Equal;
        }
        if a == Self::EPOCH {
            return core::cmp::Ordering::Greater;
        }
        if b == Self::EPOCH {
            return core::cmp::Ordering::Less;
        }
        a.order(&b)
    }
    /// `bun.timespec.minIgnoreEpoch` (bun.zig:3411).
    #[inline]
    pub fn min_ignore_epoch(self, b: Timespec) -> Timespec {
        if Self::order_ignore_epoch(self, b).is_lt() {
            self
        } else {
            b
        }
    }

    /// Construct from a signed nanosecond count. Euclidean division keeps
    /// `nsec ∈ [0, 1e9)` for negative inputs so `ns()`/`order()` round-trip.
    #[inline]
    pub const fn from_ns(ns: i64) -> Timespec {
        Timespec {
            sec: ns.div_euclid(Self::NS_PER_S),
            nsec: ns.rem_euclid(Self::NS_PER_S),
        }
    }

    /// `bun.timespec.now(.allow_mocked_time)` — monotonic "rough tick". Port of
    /// `bun.getRoughTickCount` (bun.zig:3222): reads `hw_timer::now_ns()`
    /// (CNTVCT_EL0 / rdtsc, calibrated to the OS monotonic clock). Test-runner
    /// fake-timers write the mocked nanosecond value via `mock_time::set` /
    /// `mock_time::clear`.
    #[inline]
    pub fn now(mode: TimespecMockMode) -> Timespec {
        if matches!(mode, TimespecMockMode::AllowMockedTime) {
            if let Some(ns) = mock_time::get() {
                return Timespec::from_ns(ns);
            }
        }
        Self::now_real()
    }
    /// Convenience for `now(AllowMockedTime)` (downstream short-name).
    #[inline]
    pub fn now_allow_mocked_time() -> Timespec {
        Self::now(TimespecMockMode::AllowMockedTime)
    }

    fn now_real() -> Timespec {
        // Zig `getRoughTickCount`: `hw_timer.nowNs()` split into sec/nsec.
        let ns = crate::hw_timer::now_ns();
        Timespec {
            sec: (ns / Self::NS_PER_S as u64) as i64,
            nsec: (ns % Self::NS_PER_S as u64) as i64,
        }
    }

    #[inline]
    pub fn since_now(&self, mode: TimespecMockMode) -> u64 {
        Self::now(mode).duration(self).ns()
    }
    #[inline]
    pub fn ms_from_now(mode: TimespecMockMode, interval: i64) -> Timespec {
        Self::now(mode).add_ms(interval)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TimespecMockMode {
    AllowMockedTime,
    ForceRealTime,
}

/// `bun_core::timespec::Mode` namespace shim — Zig nested it under the struct;
/// Rust can't do inherent associated types stably, so expose a module with the
/// same path. Callers write `bun_core::timespec_mode::AllowMockedTime` or use
/// the `Timespec::now_allow_mocked_time()` helper.
pub mod timespec_mode {
    pub use super::TimespecMockMode::*;
    pub type Mode = super::TimespecMockMode;
}

/// Mocked-time storage. The data lives at T0 so `Timespec::now` reads it
/// directly; the test-runner (`useFakeTimers`) writes via `set`/`clear`
/// from `bun_runtime::test_runner::timers::FakeTimers::CurrentTime`.
/// Sentinel `i64::MIN` ⇒ not mocked.
pub mod mock_time {
    use core::sync::atomic::{AtomicI64, Ordering};

    static MOCKED_TIME_NS: AtomicI64 = AtomicI64::new(i64::MIN);

    /// Set the mocked monotonic time (nanoseconds). Called by fake-timers.
    #[inline]
    pub fn set(ns: i64) {
        MOCKED_TIME_NS.store(ns, Ordering::Relaxed);
    }
    /// Clear the mocked time so `Timespec::now(AllowMockedTime)` reads the
    /// real clock again.
    #[inline]
    pub fn clear() {
        MOCKED_TIME_NS.store(i64::MIN, Ordering::Relaxed);
    }
    /// Current mocked time, or `None` if not mocked.
    #[inline]
    pub fn get() -> Option<i64> {
        let v = MOCKED_TIME_NS.load(Ordering::Relaxed);
        if v == i64::MIN { None } else { Some(v) }
    }
}
