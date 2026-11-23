//! Microseconds. The arithmetic saturates, as peers choose some of the operands.

use core::ops::{Add, Div, Mul, Sub};

/// On a monotonic clock of the caller's choice.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Instant(u64);

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Duration(u64);

impl Instant {
    /// The deadline of a timer that is not set.
    pub const NEVER: Self = Self(u64::MAX);

    pub const fn from_micros(micros: u64) -> Self {
        Self(micros)
    }

    pub const fn as_micros(self) -> u64 {
        self.0
    }
}

impl Duration {
    pub const ZERO: Self = Self(0);
    pub(crate) const MAX: Self = Self(u64::MAX);

    pub const fn from_micros(micros: u64) -> Self {
        Self(micros)
    }

    pub const fn from_millis(millis: u64) -> Self {
        Self(millis.saturating_mul(1000))
    }

    pub const fn from_secs(secs: u64) -> Self {
        Self(secs.saturating_mul(1_000_000))
    }

    pub const fn as_micros(self) -> u64 {
        self.0
    }

    pub const fn as_millis(self) -> u64 {
        self.0 / 1000
    }

    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub(crate) const fn abs_diff(self, other: Self) -> Self {
        Self(self.0.abs_diff(other.0))
    }
}

impl Add<Duration> for Instant {
    type Output = Self;

    #[inline]
    fn add(self, duration: Duration) -> Self {
        Self(self.0.saturating_add(duration.0))
    }
}

impl Sub<Duration> for Instant {
    type Output = Self;

    #[inline]
    fn sub(self, duration: Duration) -> Self {
        Self(self.0.saturating_sub(duration.0))
    }
}

impl Sub for Instant {
    type Output = Duration;

    #[inline]
    fn sub(self, earlier: Self) -> Duration {
        Duration(self.0.saturating_sub(earlier.0))
    }
}

impl Add for Duration {
    type Output = Self;

    #[inline]
    fn add(self, other: Self) -> Self {
        Self(self.0.saturating_add(other.0))
    }
}

impl Sub for Duration {
    type Output = Self;

    #[inline]
    fn sub(self, other: Self) -> Self {
        Self(self.0.saturating_sub(other.0))
    }
}

impl Mul<u64> for Duration {
    type Output = Self;

    #[inline]
    fn mul(self, factor: u64) -> Self {
        Self(self.0.saturating_mul(factor))
    }
}

impl Div<u64> for Duration {
    type Output = Self;

    /// Zero if `divisor` is.
    #[inline]
    fn div(self, divisor: u64) -> Self {
        Self(self.0.checked_div(divisor).unwrap_or(0))
    }
}
