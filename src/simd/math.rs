//! Elementary functions. The polynomials and the parts of constants are from `tools/coefficients.py`.
//!
//! All functions take any argument, and treat infinities, zeros, subnormal numbers and NaN as `std` does. The errors are
//! bounds, in units in the last place, a little above the largest that a test of all `f32` and searches among `f64` found.

// This began as a port of hwy/contrib/math/math-inl.h, Copyright 2020 Google LLC, Apache License 2.0, and was changed since. See NOTICE.

use crate::f16;
use crate::half::in_f32;
use crate::{Isa, MaskOf, Simd, Width};
use core::f64::consts::{FRAC_1_PI, FRAC_1_SQRT_2, FRAC_2_PI, LOG2_E};

use crate::Float as Real;

/// A part of [`Float`] that can't be named outside of this crate.
pub trait Parts: crate::Lane {
    #[doc(hidden)]
    fn bits(value: u64) -> Self::Unsigned;
    #[doc(hidden)]
    fn through_f64(self) -> f64;
    #[doc(hidden)]
    fn remainder(self, by: Self) -> Self;
}
impl Parts for f32 {
    #[inline(always)]
    fn bits(value: u64) -> u32 {
        value as u32
    }
    #[inline(always)]
    fn through_f64(self) -> f64 {
        self as f64
    }
    fn remainder(self, by: f32) -> f32 {
        self % by
    }
}
impl Parts for f64 {
    #[inline(always)]
    fn bits(value: u64) -> u64 {
        value
    }
    #[inline(always)]
    fn through_f64(self) -> f64 {
        self
    }
    fn remainder(self, by: f64) -> f64 {
        self % by
    }
}

macro_rules! halves { ($($t:ty)*) => {$(
    impl Parts for $t {
        #[inline(always)]
        fn bits(value: u64) -> u16 { value as u16 }
        fn through_f64(self) -> f64 { unreachable!() }
        fn remainder(self, _: Self) -> Self { unreachable!() }
    }
)*}; }
halves!(f16 crate::bf16);

/// `c0 + c1 * x + c2 * x * x + ..` by Estrin's scheme, but the last three or four terms by Horner's. Their square would underflow first, which takes long on Intel.
macro_rules! estrin {
    ($x:expr; $($c:expr),+) => {{ let x = $x; estrin!(@ x [] $(x.k($c)),+) }};
    (@ $x:ident [] $a:expr, $b:expr, $c:expr) => { $c.mul_add_relaxed($x, $b).mul_add_relaxed($x, $a) };
    (@ $x:ident [] $a:expr, $b:expr, $c:expr, $d:expr) => { $d.mul_add_relaxed($x, $c).mul_add_relaxed($x, $b).mul_add_relaxed($x, $a) };
    (@ $x:ident [$($done:expr),*] $a:expr, $b:expr $(, $rest:expr)*) => { estrin!(@ $x [$($done,)* $b.mul_add_relaxed($x, $a)] $($rest),*) };
    (@ $x:ident [] $a:expr) => { $a };
    (@ $x:ident [$a:expr]) => { $a };
    (@ $x:ident [$($done:expr),*] $($a:expr)?) => {{ let square = $x * $x; estrin!(@ square [] $($done),* $(, $a)?) }};
}
/// The same with the coefficients in memory. LLVM makes them of integers, in up to five instructions each.
macro_rules! loaded {
    ($x:expr, $row:ident; $($c:expr),+) => {{
        let (x, rows) = ($x, const { &crate::access::Aligned([$(crate::elementary::$row($c),)+ [0; 2]]).0 });
        let mut rows = rows[1 - crate::regs::count(1)..].iter();
        loaded!(@ x rows [] $($c),+)
    }};
    (@ $x:ident $rows:ident [$($done:ident)*] $c:expr $(, $rest:expr)*) => {{
        let it = $x.tag().resize_bitcast($x.s.fixed::<u64, crate::B16>().from_array(*$rows.next().unwrap()));
        loaded!(@ $x $rows [$($done)* it] $($rest),*)
    }};
    (@ $x:ident $rows:ident [$($done:ident)*]) => { estrin!(@ $x [] $($done),*) };
}
const fn singles(c: f64) -> [u64; 2] {
    [(c as f32).to_bits() as u64 * 0x1_0000_0001; 2]
}
const fn doubles(c: f64) -> [u64; 2] {
    [c.to_bits(); 2]
}
macro_rules! poly {
    ($x:expr; [$($single:expr),+] [$($double:expr),+]) => {
        choose! {
            S::A64 && Self::LOADS && T::BITS == 32 => loaded!($x, singles; $($single),+),
            S::A64 && Self::LOADS => loaded!($x, doubles; $($double),+),
            _ => poly!($x, 1.0; [$($single),+] [$($double),+]),
        }
    };
    ($x:expr, $times:expr; [$($single:expr),+] [$($double:expr),+]) => {
        if const { T::BITS == 32 } { estrin!($x; $($single * $times),+) } else { estrin!($x; $($double * $times),+) }
    };
}
/// The same, but the first term is added last, so that only one rounding is at its size.
macro_rules! first_last {
    ($x:expr; [$a:expr, $($single:expr),+] [$b:expr, $($double:expr),+]) => { poly!($x; [$($single),+] [$($double),+]).mul_add_relaxed($x, $x.k2($a, $b)) };
}

#[macro_use]
#[path = "math/tables.rs"]
mod tables;
#[path = "math/special.rs"]
mod special;

#[cold]
#[inline(never)]
fn one_by_one<T: Real>(lanes: &mut [T], f: fn(f64) -> f64) {
    lanes.iter_mut().for_each(|lane| *lane = T::from_f64(f(lane.through_f64())));
}
#[cold]
#[inline(never)]
fn both_one_by_one<T: Real>(sin: &mut [T], cos: &mut [T]) {
    for (sin, cos) in sin.iter_mut().zip(cos) {
        let both = crate::large_angles::sin_cos::<T>(sin.through_f64());
        (*sin, *cos) = (T::from_f64(both.0), T::from_f64(both.1));
    }
}

/// The sum of two numbers, for twice the precision.
type Two<V> = (V, V);

impl<S: Isa, T: Real, W: Width> Simd<T, W, S> {
    const MANTISSA: u32 = if T::BITS == 32 { 23 } else { 52 };
    const EXPONENT_BIAS: f64 = if T::BITS == 32 { 127.0 } else { 1023.0 };
    /// Adding this rounds to an integer, which is then in the lowest bits.
    const ROUND: f64 = (3u64 << (Self::MANTISSA - 1)) as f64;

    /// With several registers, it was as often slower as faster.
    const LOADS: bool = crate::OPTIMIZED && W::BYTES <= 16;

    #[op]
    fn k(self, value: f64) -> Self {
        self.tag().set(T::from_f64(value))
    }
    #[op]
    fn k2(self, single: f64, double: f64) -> Self {
        self.k(if const { T::BITS == 32 } { single } else { double })
    }
    #[op]
    fn part<const N: usize>(parts: [[f64; N]; 2], i: usize) -> f64 {
        parts[(T::BITS == 64) as usize][i]
    }
    #[op]
    fn bits2(self, single: u64, double: u64) -> Simd<T::Unsigned, W, S> {
        self.tag().to_unsigned().set(T::bits(if const { T::BITS == 32 } { single } else { double }))
    }
    #[inline(always)]
    fn sign(self) -> Self {
        self & self.k(-0.0)
    }
    /// `f` takes over in the lanes of `mask`.
    #[op]
    fn or_one_by_one(self, mask: MaskOf<T, W, S>, x: Self, f: fn(f64) -> f64) -> Self {
        if mask.none() {
            return self;
        }
        let mut lanes = mask.if_then_else_zero(x).to_array();
        one_by_one(lanes.as_mut(), f);
        mask.if_then_else(self.tag().from_array(lanes), self)
    }

    /// The integer next to `self * factor`, and what `power` and `times_power` take for it.
    #[op]
    fn scaled_exponent(self, factor: f64) -> (Self, Simd<T::Unsigned, W, S>) {
        self.exponent_plus(factor, 0.0)
    }
    /// The same, for a power that is `2^more` times as large.
    #[op]
    fn exponent_plus(self, factor: f64, more: f64) -> (Self, Simd<T::Unsigned, W, S>) {
        let round = self.k(Self::ROUND + Self::EXPONENT_BIAS + more);
        let rounded = self.mul_add_relaxed(self.k(factor), round);
        (rounded - round, rounded.cast_unsigned())
    }
    /// The power of two, which has to be a normal number.
    #[op]
    fn power(by: Simd<T::Unsigned, W, S>) -> Self {
        (by << Self::MANTISSA).bitcast()
    }
    /// Times two to the power of an integer, or zero if `by` is less than `least`. Intel takes long for what underflows.
    #[on(X86)]
    #[op]
    fn scaled_from(self, by: Self, least: Self) -> Self {
        self.with_bytes(self.s.scale_from::<W>(self.bytes(), by.bytes(), least.bytes(), T::BITS == 64))
    }
    /// The distance from the nearest integer, and zero for infinity.
    #[on(X86)]
    #[op]
    fn fraction(self) -> Self {
        choose! {
            T::BITS == 32 => self.with_bytes(self.s.fraction_f32::<W>(self.bytes())),
            _ => self.with_bytes(self.s.fraction_f64::<W>(self.bytes())),
        }
    }
    /// In two steps, since the power of two can be out of range where the product isn't.
    #[op]
    fn times_power(self, by: Simd<T::Unsigned, W, S>) -> Self {
        let by = by + self.bits2(127, 1023);
        let half = by >> 1;
        self * Self::power(half) * Self::power(by - half)
    }
    /// `self - q * ln(2)` is the first, which is exact, plus `q` times the second.
    #[op]
    fn minus_most_of_ln_2_times(self, q: Self) -> Two<Self> {
        let parts = if const { S::HAS_FMA } { tables::LN_2_FUSED } else { tables::LN_2 };
        (q.mul_add_relaxed(q.k(-Self::part(parts, 0)), self), q.k(-Self::part(parts, 1)))
    }
    #[op]
    fn minus_ln_2_times(self, q: Self) -> Self {
        let (high, rest) = self.minus_most_of_ln_2_times(q);
        q.mul_add_relaxed(rest, high)
    }
    #[inline(always)]
    fn small_expm1(self) -> Self {
        apart_unoptimized!(self.s, { table!(exp poly!(self)).mul_add_relaxed(self * self, self) })
    }
    /// `times_power`, but zero where `x` is below `low` and infinity above `high`. There `by` can be anything, which could underflow.
    #[op]
    fn times_power_within(self, by: Simd<T::Unsigned, W, S>, x: Self, low: Self, high: Self) -> Self {
        let (below, above) = (x.simd_lt(low), x.simd_gt(high));
        let y = (below | above).if_then_zero_else(self).times_power(by);
        above.if_then_else(x.k(f64::INFINITY), below.if_then_zero_else(y))
    }
    /// So far from subnormal numbers that the short way rounds like the long one, and a lane doesn't depend on the others.
    #[op]
    fn is_exponent(self) -> MaskOf<T, W, S> {
        let limit = self.k(Self::EXPONENT_BIAS - if const { S::HAS_FMA } { 1.0 } else { Self::MANTISSA as f64 + 4.0 });
        choose! {
            S::A64 => self.with_bytes::<T>(self.s.abs_greater::<W>(limit.bytes(), self.bytes(), T::BITS)).full_mask(),
            _ => self.abs().simd_lt(limit),
        }
    }

    /// `Exp`. 1.2 ULP.
    #[inline(always)]
    pub fn exp(self) -> Self {
        apart!(self.s, self.exp_here())
    }
    /// Shares what the caller has computed.
    #[op]
    fn exp_here(self) -> Self {
        in_f32!(half self => |x| x.exp());
        let (q, by) = self.scaled_exponent(LOG2_E);
        let y = self.minus_ln_2_times(q).small_expm1();
        return_if!(S::AVX512DQ, {
            let y = self.simd_le(self.k2(95.0, 800.0)).if_then_else(y + self.k(1.0), self.k(1.0));
            y.scaled_from(q, self.k2(-151.0, -1076.0))
        });
        if q.is_exponent().all() {
            return Self::power(by).mul_add_relaxed(y, Self::power(by));
        }
        core::hint::cold_path();
        (y + q.k(1.0)).times_power_within(by, q, q.k2(-160.0, -1100.0), q.k2(130.0, 1030.0))
    }
    /// `Exp2`. 1.2 ULP.
    #[inline(always)]
    pub fn exp2(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.exp2());
            return_if!(S::AVX512DQ, {
                let fraction = self.fraction();
                let y = table!(exp2 first_last!(fraction)).mul_add_relaxed(fraction, self.k(1.0));
                y.scaled_from(self - fraction, self.k2(-151.0, -1076.0))
            });
            let (q, by) = self.scaled_exponent(1.0);
            let fraction = self - q;
            let y = table!(exp2 first_last!(fraction)).mul_add_relaxed(fraction, self.k(1.0));
            if q.is_exponent().all() {
                return y * Self::power(by);
            }
            core::hint::cold_path();
            y.times_power_within(by, self, self.k2(-160.0, -1100.0), self.k2(130.0, 1030.0))
        })
    }
    /// Two to the power of `self * factor`, which is 1 or log2(e).
    #[inline(always)]
    fn rough_power(self, factor: f64) -> Self {
        apart_unoptimized!(self.s, {
            return_if!(S::AVX512DQ, {
                let power = always!(|it: Self| table!(rough_exp2 poly!(it)).mul_add_relaxed(it, self.k(1.0)));
                let least = self.k(1.0 - Self::EXPONENT_BIAS);
                if factor == 1.0 {
                    return power(self.fraction()).scaled_from(self - self.fraction(), least);
                }
                let (q, _) = self.scaled_exponent(factor);
                let y = power(self.mul_sub(self.k(factor), q));
                self.simd_le(self.k(1000.0)).if_then_else(y, self.k(1.0)).scaled_from(q, least)
            });
            return_if!(S::SVE2, {
                let round = Self::ROUND / 64.0 + Self::EXPONENT_BIAS;
                let by = if factor == 1.0 {
                    self + self.k(round)
                } else {
                    self.mul_add_relaxed(self.k(factor), self.k(round))
                };
                let by = by.simd_min_relaxed(self.k(round + Self::EXPONENT_BIAS + 1.0));
                let (power, q) =
                    (self.with_bytes::<T>(self.s.power_of_64ths::<W>(by.bytes(), T::BITS)), self.k(round) - by);
                let (r, c) = if factor == 1.0 {
                    (self + q, core::f64::consts::LN_2)
                } else {
                    (q.mul_add_relaxed(self.k(1.0 / factor), self), 1.0)
                };
                let first = if c == 1.0 { r + self.k(1.0) } else { r.mul_add_relaxed(self.k(c), self.k(1.0)) };
                let y = choose! {
                    T::BITS == 32 => first,
                    _ => r.mul_add_relaxed(self.k(c * c * c / 6.0), self.k(c * c / 2.0)).mul_add_relaxed(r * r, first),
                };
                by.simd_ge(self.k(round + 1.0 - Self::EXPONENT_BIAS)).if_then_else_zero(y * power)
            });
            let x = self.simd_clamp_relaxed(
                self.k(-Self::EXPONENT_BIAS / factor),
                self.k((Self::EXPONENT_BIAS + 1.0) / factor),
            );
            let (q, by) = x.scaled_exponent(factor);
            let fraction = choose! {
                S::A64 => x.mul_add_relaxed(x.k(factor), x.k(Self::ROUND + Self::EXPONENT_BIAS) - by.bitcast::<T>()),
                _ => x.mul_sub(x.k(factor), q),
            };
            table!(rough_exp2 poly!(fraction)).mul_add_relaxed(fraction, x.k(1.0)) * Self::power(by)
        })
    }
    /// Like [`exp`](Self::exp), with a relative error of up to 2^-16, or 2^-32 for `f64`, and without a branch. What is subnormal
    /// can become zero, and what is above half of the largest number infinity. The result is unspecified for NaN.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let x = f32x4::from([0.0, 1.0, -200.0, 200.0]);
    /// let sigmoid = ((-x).exp_relaxed() + 1.0).recip();
    /// assert!((sigmoid - [0.5, 0.7310586, 0.0, 1.0]).abs().simd_lt(1e-5).all());
    /// # } example()
    /// ```
    #[doc(alias("fast_exp", "FastExp", "exp_approx", "sigmoid", "softmax"))]
    #[op]
    pub fn exp_relaxed(self) -> Self {
        in_f32!(half self => |x| x.exp_relaxed());
        self.rough_power(LOG2_E)
    }
    /// Like [`exp2`](Self::exp2), with the limits of [`exp_relaxed`](Self::exp_relaxed).
    #[doc(alias("fast_exp2", "FastExp2"))]
    #[op]
    pub fn exp2_relaxed(self) -> Self {
        in_f32!(half self => |x| x.exp2_relaxed());
        self.rough_power(1.0)
    }
    /// `exp(self) - 1` if the exponent, which is the second, is that of a normal number.
    #[op]
    fn ordinary_exp_m1(self) -> Two<Self> {
        let (q, by) = self.scaled_exponent(LOG2_E);
        let ((high, rest), power) = (self.minus_most_of_ln_2_times(q), Self::power(by));
        let low = q * rest;
        let r = high + low;
        // The large terms first, which cancel.
        (
            power.mul_add_relaxed(
                table!(exp poly!(r)).mul_add_relaxed(r * r, low),
                power.mul_add_relaxed(high, power - self.k(1.0)),
            ),
            q,
        )
    }
    /// `Expm1`. 1.7 ULP.
    #[inline(always)]
    pub fn exp_m1(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.exp_m1());
            let (y, q) = self.ordinary_exp_m1();
            let (y, ordinary) = (y | self.sign(), q.is_exponent());
            if ordinary.all() {
                return y;
            }
            core::hint::cold_path();
            ordinary.if_then_else(y, self.exp_here() - self.k(1.0))
        })
    }

    /// `self` as `m * 2^e`, where `m` is near 1. It has to be positive and normal.
    #[op]
    fn mantissa_exponent(self) -> (Self, Self) {
        let (one, least) = (self.k(1.0).cast_unsigned(), self.k(FRAC_1_SQRT_2).cast_unsigned());
        let bits = self.cast_unsigned() + (one - least);
        let round = self.k(Self::ROUND);
        let e =
            ((bits >> Self::MANTISSA) | round.cast_unsigned()).bitcast() - self.k(Self::ROUND + Self::EXPONENT_BIAS);
        let m = (bits & self.bits2((1 << 23) - 1, (1 << 52) - 1)) + least;
        (m.bitcast(), e)
    }
    /// The same for subnormal numbers too, and whether any lane is not positive and normal.
    #[op]
    fn split_any(self) -> (Self, Self, bool) {
        let smallest = self.k2(f32::MIN_POSITIVE as f64, f64::MIN_POSITIVE);
        if self.all_within(smallest, self.tag().set(T::MAX)) {
            let (m, e) = self.mantissa_exponent();
            return (m, e, false);
        }
        core::hint::cold_path();
        let small = self.simd_lt(smallest);
        let (m, e) = small.if_then_else(self * self.k((1u64 << Self::MANTISSA) as f64), self).mantissa_exponent();
        (m, e - small.if_then_else_zero(self.k(Self::MANTISSA as f64)), true)
    }
    #[op]
    fn special_logs(self, x: Self) -> Self {
        core::hint::cold_path();
        let y = x.simd_lt(x.k(f64::INFINITY)).if_then_else(self, x);
        x.simd_le(x.k(0.0)).if_then_else(x.simd_eq(x.k(0.0)).if_then_else(x.k(f64::NEG_INFINITY), x.k(f64::NAN)), y)
    }
    /// `ln(1 + self) = 2 * atanh(z)` for `z = self / (2 + self)`, and `2 * z = self - z * self`. So it is `self + z * w`, of which
    /// the larger term is exact. This returns `z` and `w`.
    #[inline(always)]
    fn small_ln(self) -> Two<Self> {
        apart_unoptimized!(self.s, {
            let z = self / (self + self.k(2.0));
            let z2 = z * z;
            (z, table!(ln poly!(z2)).mul_sub(z2, self))
        })
    }
    /// The same times a factor in two parts. The sum is `self * factor[0] + z * w`, with `2 * z * factor[1]` in the second term.
    #[inline(always)]
    fn small_log(self, factor: [[f64; 2]; 2]) -> Two<Self> {
        apart_unoptimized!(self.s, {
            let (high, low) = (Self::part(factor, 0), Self::part(factor, 1));
            let z = self / (self + self.k(2.0));
            let z2 = z * z;
            (z, self.neg_mul_add(self.k(high), table!(ln poly!(z2, high)).mul_add_relaxed(z2, self.k(2.0 * low))))
        })
    }
    /// For positive limits, by one comparison of the bits.
    #[op]
    fn all_within(self, first: Self, last: Self) -> bool {
        self.cast_unsigned().in_range(first.cast_unsigned(), last.cast_unsigned()).all()
    }
    /// `ln(self + low)`, where `low` is what a rounding lost. If `self` or its inverse is not positive and normal in all lanes,
    /// it takes those where `self` is huge. There the result is `ln(self * 2^more)`.
    #[op]
    fn ln_of_two(self, low: Self, huge: Option<MaskOf<T, W, S>>, more: f64) -> Self {
        let (m, mut e) = self.mantissa_exponent();
        let mut low = low * (m.cast_unsigned() - self.cast_unsigned() + self.k(1.0).cast_unsigned()).bitcast();
        if let Some(huge) = huge {
            // Or LLVM does this for all, and selects.
            core::hint::cold_path();
            (e, low) = (e + huge.if_then_else_zero(self.k(more)), huge.if_then_zero_else(low));
        }
        let f = m - self.k(1.0);
        let (z, w) = (f + low).small_ln();
        let y = e.mul_add_relaxed(
            e.k(Self::part(tables::LN_2, 0)),
            f + z.mul_add_relaxed(w, e.mul_add_relaxed(e.k(Self::part(tables::LN_2, 1)), low)),
        );
        if huge.is_some() { y.special_logs(self) } else { y }
    }

    /// `Log`. 1.1 ULP.
    #[inline(always)]
    pub fn ln(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.ln());
            let (m, e, special) = self.split_any();
            let f = m - self.k(1.0);
            let (z, w) = f.small_ln();
            let y = e.mul_add_relaxed(
                e.k(Self::part(tables::LN_2, 0)),
                f + z.mul_add_relaxed(w, e * e.k(Self::part(tables::LN_2, 1))),
            );
            if special { y.special_logs(self) } else { y }
        })
    }
    /// `Log2`. 2 ULP, and exact for powers of two. As for all logarithms, a vector takes longer if a lane is not a positive normal number.
    #[inline(always)]
    pub fn log2(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.log2());
            let (m, e, special) = self.split_any();
            let f = m - self.k(1.0);
            let (z, w) = f.small_log(tables::LOG2_E);
            let y = f.mul_add_relaxed(f.k(Self::part(tables::LOG2_E, 0)), z * w) + e;
            if special { y.special_logs(self) } else { y }
        })
    }
    /// Like [`ln`](Self::ln), with a relative error of up to 2^-16, or 2^-32 for `f64`, and without a branch. It is for positive normal numbers.
    /// Zero and subnormal numbers give no more than the least of those, and the result is unspecified for all others.
    #[doc(alias("fast_log", "FastLog", "log_relaxed", "log_approx"))]
    #[op]
    pub fn ln_relaxed(self) -> Self {
        in_f32!(half self => |x| x.ln_relaxed());
        self.log2_relaxed() * self.k(core::f64::consts::LN_2)
    }
    /// Like [`log2`](Self::log2), with the limits of [`ln_relaxed`](Self::ln_relaxed). It is exact for powers of two. A product gives other bases.
    #[doc(alias("fast_log2", "FastLog2", "log10_relaxed", "decibel"))]
    #[inline(always)]
    pub fn log2_relaxed(self) -> Self {
        apart_unoptimized!(self.s, {
            in_f32!(half self => |x| x.log2_relaxed());
            return_if!(T::BITS == 64, {
                let (m, e) = self.mantissa_exponent();
                let z = (m - self.k(1.0)) / (m + self.k(1.0));
                table!(rough_atanh poly!(z * z)).mul_add_relaxed(z, e)
            });
            let above = self.cast_unsigned() - self.k(FRAC_1_SQRT_2).cast_unsigned();
            let m: Self = (self.cast_unsigned() - (above & self.bits2(0x1ff << 23, 0))).bitcast();
            let f = m - self.k(1.0);
            table!(rough_log2 poly!(f)).mul_add_relaxed(f, (above.cast_signed() >> 23).cast::<T>().same())
        })
    }
    /// `Log10`. 2 ULP.
    #[inline(always)]
    pub fn log10(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.log10());
            let (m, e, special) = self.split_any();
            let f = m - self.k(1.0);
            let (z, w) = f.small_log(tables::LOG10_E);
            let y = f.mul_add_relaxed(
                f.k(Self::part(tables::LOG10_E, 0)),
                z.mul_add_relaxed(w, e * e.k(Self::part(tables::LOG10_2, 1))),
            );
            let y = e.mul_add_relaxed(e.k(Self::part(tables::LOG10_2, 0)), y);
            if special { y.special_logs(self) } else { y }
        })
    }
    /// `Log1p`. 1.2 ULP.
    #[inline(always)]
    pub fn ln_1p(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.ln_1p());
            let y = self + self.k(1.0);
            let below = y.simd_lt(self.k2(1e37, 1e307));
            let huge = if (y.simd_gt(self.k(0.0)) & below).all() {
                None
            } else {
                core::hint::cold_path();
                Some(!below)
            };
            y.ln_of_two(self - (y - self.k(1.0)), huge, 0.0) | self.sign()
        })
    }

    #[inline(always)]
    fn two_product(self, other: Self) -> Two<Self> {
        apart_unoptimized!(self.s, {
            let high = self * other;
            return_if!(S::HAS_FMA, (high, self.mul_add_relaxed(other, -high)));
            let upper = self.bits2(!0 << 12, !0 << 27).bitcast();
            let (a, b) = (self & upper, other & upper);
            let (c, d) = (self - a, other - b);
            (high, a * b - high + a * d + c * b + c * d)
        })
    }
    /// For `|self| >= |other|`, or `self == 0`.
    #[op]
    fn two_sum(self, other: Self) -> Two<Self> {
        let high = self + other;
        (high, self - high + other)
    }
    #[inline(always)]
    fn precise_ln(m: Self, e: Self) -> Two<Self> {
        apart_unoptimized!(m.s, {
            let (f, (sum, sum_low)) = (m - m.k(1.0), m.k(2.0).two_sum(m - m.k(1.0)));
            let inverse = m.k(1.0) / sum;
            let z = f * inverse;
            let (back, back_low) = z.two_product(sum);
            let z_low = z.neg_mul_add(sum_low, f - back - back_low) * inverse;
            let (z2, z2_low) = z.two_product(z);
            let z2_low = (z + z).mul_add_relaxed(z_low, z2_low);
            let tail = z2 * table!(precise_ln first_last!(z2));
            let (p, p_low) = m.k(Self::part(tables::TWO_THIRDS, 0)).two_sum(tail);
            let p_low = p_low + z2_low.mul_add_relaxed(m.k(0.4), m.k(Self::part(tables::TWO_THIRDS, 1)));
            let (z3, z3_low) = z2.two_product(z);
            let z3_low = z2.mul_add_relaxed(z_low, z2_low.mul_add_relaxed(z, z3_low));
            let (c, c_low) = z3.two_product(p);
            let c_low = z3.mul_add_relaxed(p_low, z3_low.mul_add_relaxed(p, c_low));
            let (ln, ln_low) = (z + z).two_sum(c);
            let (high, low) = (e * m.k(Self::part(tables::LN_2, 0))).two_sum(ln);
            high.two_sum(e.mul_add_relaxed(m.k(Self::part(tables::LN_2, 1)), low) + (ln_low + c_low + (z_low + z_low)))
        })
    }
    /// `self` to the power of `y`. 1.5 ULP.
    #[op]
    #[doc(alias("pow", "Pow"))]
    pub fn powf(self, y: impl crate::Operand<T, W, S>) -> Self {
        let y = crate::Operand::vector(y, crate::Tag::new(self.s));
        apart!(self.s, {
            in_f32!(half self, y => |a, b| a.powf(b));
            let (x, one, infinity) = (self.abs(), self.k(1.0), self.k(f64::INFINITY));
            let (m, e, special) = x.split_any();
            let (ln, ln_low) = Self::precise_ln(m, e);
            let ln = if special { ln.special_logs(x) } else { ln };
            let (high, low) = ln.two_product(y);
            let (q, by) = high.scaled_exponent(LOG2_E);
            let small = high.minus_ln_2_times(q) + ln_low.mul_add_relaxed(y, low);
            let small = small.small_expm1();
            if !special && self.is_negative().and_not(q.is_exponent()).all() {
                return Self::power(by).mul_add_relaxed(small, Self::power(by));
            }
            let power = (small + one).times_power_within(by, high, x.k2(-110.0, -800.0), x.k2(95.0, 800.0));
            let half = y * self.k(0.5);
            let (integer, even) = (y.trunc().simd_eq(y), half.trunc().simd_eq(half));
            let power = power | even.and_not(integer).if_then_else_zero(self.sign());
            let power =
                integer.and_not(self.simd_lt(x.k(0.0)) & x.simd_lt(infinity)).if_then_else(x.k(f64::NAN), power);
            (y.simd_eq(x.k(0.0)) | self.simd_eq(one) | (x.simd_eq(one) & y.abs().simd_eq(infinity)))
                .if_then_else(one, power)
        })
    }
    /// `(self.log2_relaxed() * y).exp2_relaxed()`, for a finite `y` and a base within the limits of [`ln_relaxed`](Self::ln_relaxed). The relative error is up to 2^-16, or 2^-32 for `f64`, times
    /// one plus the magnitude of that product.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let gamma = (f32x4::from([0.0, 0.25, 0.5, 1.0]).powf_relaxed(1.0 / 2.2) * 255.0).round_cast::<u8>();
    /// assert_eq!(gamma, [0, 136, 186, 255]);
    /// # } example()
    /// ```
    #[doc(alias("fast_pow", "FastPow", "pow_approx", "gamma_correction"))]
    #[op]
    pub fn powf_relaxed(self, y: impl crate::Operand<T, W, S>) -> Self {
        let y = crate::Operand::vector(y, crate::Tag::new(self.s));
        in_f32!(half self, y => |a, b| a.powf_relaxed(b));
        (self.log2_relaxed() * y).exp2_relaxed()
    }
    /// The cube root. 1 ULP.
    #[inline(always)]
    pub fn cbrt(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.cbrt());
            let x = self.abs();
            let (m, e, special) = x.split_any();
            let (q, by) = e.scaled_exponent(1.0 / 3.0);
            let rest = q.mul_add_relaxed(x.k(-3.0), e);
            let m =
                m * rest.simd_eq(x.k(0.0)).if_then_else(x.k(1.0), rest.is_negative().if_then_else(x.k(0.5), x.k(2.0)));
            // Halley's method.
            let mut y = table!(cbrt poly!(m));
            for _ in 0..if const { T::BITS == 32 } { 1 } else { 2 } {
                let cube = y * y * y;
                y = y * (cube + (m + m)) / (cube + cube + m);
            }
            let (square, low) = y.two_product(y);
            let (cube, cube_low) = square.two_product(y);
            let error = cube - m + low.mul_add_relaxed(y, cube_low);
            let y = ((y - error * y / (cube + cube + m)) * Self::power(by)) | self.sign();
            if special { (x.simd_gt(x.k(0.0)) & x.simd_lt(x.k(f64::INFINITY))).if_then_else(y, self) } else { y }
        })
    }
    /// `Hypot`. 1.3 ULP.
    #[op]
    pub fn hypot(self, other: impl crate::Operand<T, W, S>) -> Self {
        let other = crate::Operand::vector(other, crate::Tag::new(self.s));
        apart!(self.s, {
            in_f32!(half self, other => |a, b| a.hypot(b));
            let (square, infinity) = (self.mul_add_relaxed(self, other * other), self.k(f64::INFINITY));
            if square.all_within(self.k2(1e-30, 1e-280), self.tag().set(T::MAX)) {
                return square.sqrt();
            }
            core::hint::cold_path();
            let (a, b) = (self.abs(), other.abs());
            let largest = a.if_greater(b);
            let (large, small) = (largest.simd_gt(a.k2(1e18, 1e150)), largest.simd_lt(a.k2(1e-15, 1e-140)));
            let power = |exponent: i64| f64::from_bits(((1023 + exponent) as u64) << 52);
            let (up, down) = (a.k2(power(90), power(600)), a.k2(power(-90), power(-600)));
            let scale = large.if_then_else(down, small.if_then_else(up, a.k(1.0)));
            let back = large.if_then_else(up, small.if_then_else(down, a.k(1.0)));
            let (c, d) = (a * scale, b * scale);
            (a.simd_eq(infinity) | b.simd_eq(infinity))
                .if_then_else(infinity, c.mul_add_relaxed(c, d * d).sqrt() * back)
        })
    }
}

impl<S: Isa, T: Real, W: Width> Simd<T, W, S> {
    /// `self - q * part * PI`, where `part` is a power of two.
    #[op]
    fn minus_pi_times(self, q: Self, part: f64) -> Self {
        return_if!(S::HAS_FMA, {
            let minus = |i| -part * Self::part(tables::PI_FUSED, i);
            q.mul_add_relaxed(q.k(minus(2)), q.mul_add_relaxed(q.k(minus(1)), q.mul_add_relaxed(q.k(minus(0)), self)))
        });
        let minus = |i| -part * Self::part(tables::PI, i);
        self + q * q.k(minus(0)) + q * q.k(minus(1)) + q * q.k(minus(2)) + q * q.k(minus(3))
    }
    #[op]
    fn too_large_an_angle(self) -> MaskOf<T, W, S> {
        self.abs().simd_gt(choose! { S::HAS_FMA => self.k2(131072.0, 1e12), _ => self.k2(6000.0, 1e7) })
    }
    #[op]
    fn small_sin(self) -> Self {
        let y = self * self;
        table!(sin_half_turn first_last!(y)).mul_add_relaxed(y * self, self)
    }
    /// `Sin`. 2.5 ULP, which can take it just beyond 1 or -1. Very large arguments are slow.
    #[inline(always)]
    pub fn sin(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.sin());
            let (x, round) = (self.abs(), self.k(Self::ROUND));
            let rounded = x.mul_add_relaxed(x.k(FRAC_1_PI), round);
            let sign = self.sign() ^ (rounded.cast_unsigned() << (T::BITS - 1)).bitcast();
            (x.minus_pi_times(rounded - round, 1.0).small_sin() ^ sign).or_one_by_one(
                x.too_large_an_angle(),
                self,
                crate::large_angles::sin::<T>,
            )
        })
    }
    /// `Cos`. 2.5 ULP, which can take it just beyond 1 or -1. Very large arguments are slow.
    #[inline(always)]
    pub fn cos(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.cos());
            // The number of quarter turns with some bits after the point. Without these, and with the lowest bit set, it is
            // the odd number next to it. The next bit is the sign.
            let (x, fraction) = (self.abs(), if const { T::BITS == 32 } { 6 } else { 8 });
            let round = x.k((1u64 << (Self::MANTISSA - fraction)) as f64 + 2.0);
            let turns = x.mul_add_relaxed(x.k(FRAC_2_PI), round).cast_unsigned();
            let odd: Self = (turns & x.bits2(!0 << 6, !0 << 8) | x.bits2(1 << 6, 1 << 8)).bitcast();
            let sign = x.k(-0.0) & (turns << (T::BITS - 2 - fraction)).bitcast();
            (x.minus_pi_times(odd - round, 0.5).small_sin() ^ sign).or_one_by_one(
                x.too_large_an_angle(),
                self,
                crate::large_angles::cos::<T>,
            )
        })
    }
    /// What is left of `|self|` after a number of quarter turns, its square, and that number.
    #[op]
    fn quarter(self) -> (Self, Self, Simd<T::Unsigned, W, S>) {
        let (x, round) = (self.abs(), self.k(Self::ROUND));
        let rounded = x.mul_add_relaxed(x.k(FRAC_2_PI), round);
        let r = x.minus_pi_times(rounded - round, 0.5);
        (r, r * r, rounded.cast_unsigned())
    }
    /// `SinCos`. 2.5 ULP. Very large arguments are slow.
    #[inline(always)]
    pub fn sin_cos(self) -> (Self, Self) {
        apart!(self.s, {
            return_if!(Self::HALF, (self.sin(), self.cos()));
            let (r, z, q) = self.quarter();
            let sin = table!(sin poly!(z)).mul_add_relaxed(z * r, r);
            let cos = table!(cos poly!(z)).mul_add_relaxed(z, z.k(-0.5)).mul_add_relaxed(z, z.k(1.0));
            let odd: Self = (q << (T::BITS - 1)).bitcast();
            let second: Self = (q << (T::BITS - 2)).bitcast();
            let (s, c) = (odd.to_mask().if_then_else(cos, sin), odd.to_mask().if_then_else(sin, cos));
            let (s, c, large) = (s ^ (second ^ self).sign(), c ^ (second ^ odd).sign(), self.too_large_an_angle());
            if large.none() {
                return (s, c);
            }
            core::hint::cold_path();
            let mut lanes = [large.if_then_else_zero(self).to_array(); 2];
            let [sin, cos] = &mut lanes;
            both_one_by_one(sin.as_mut(), cos.as_mut());
            (
                large.if_then_else(self.tag().from_array(lanes[0]), s),
                large.if_then_else(self.tag().from_array(lanes[1]), c),
            )
        })
    }
    /// 4 ULP. Very large arguments are slow.
    #[inline(always)]
    pub fn tan(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.tan());
            let (r, z, q) = self.quarter();
            // A rational function, and its inverse.
            let (sin, cos) = (
                table!(tan_above poly!(z)).mul_add_relaxed(z * r, r),
                table!(tan_below first_last!(z)).mul_add_relaxed(z, z.k(1.0)),
            );
            let odd: Self = (q << (T::BITS - 1)).bitcast();
            let tan = odd.to_mask().if_then_else(cos, sin) / odd.to_mask().if_then_else(sin, cos);
            (tan ^ odd ^ self.sign()).or_one_by_one(self.too_large_an_angle(), self, crate::large_angles::tan::<T>)
        })
    }

    /// Whether `|self| < 0.5`. If not, `asin(|self|) = PI / 2 - 2 * asin(y)` for `y = sqrt((1 - |self|) / 2)`. Then `y`, and the square of what is used.
    #[op]
    fn half_angle(self) -> (MaskOf<T, W, S>, Self, Self) {
        let (x, half) = (self.abs(), self.k(0.5));
        let small = x.simd_lt(half);
        let square = small.if_then_else(x * x, x.neg_mul_add(half, half));
        (small, square.sqrt(), square)
    }
    /// What stands for `n * PI / 4` in `plus_eighths`.
    #[op]
    fn eighths(self, n: f64) -> Self {
        self.k(n * Self::part(tables::FRAC_PI_4, 0))
    }
    /// `self + self * square * p` and a multiple of `PI / 4`.
    #[op]
    fn plus_eighths(self, square: Self, p: Self, eighths: Self) -> Self {
        eighths.mul_add_relaxed(self.k(Self::part(tables::FRAC_PI_4, 1)), self)
            + p.mul_add_relaxed(square * self, eighths)
    }
    /// `Asin`. 1.5 ULP.
    #[inline(always)]
    pub fn asin(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.asin());
            let (small, root, square) = self.half_angle();
            let y = small.if_then_else(self.abs(), root * self.k(-2.0));
            y.plus_eighths(square, table!(asin poly!(square)), small.if_then_zero_else(y.eighths(2.0))) | self.sign()
        })
    }
    /// `Acos`. 1.4 ULP.
    #[inline(always)]
    pub fn acos(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.acos());
            let (small, root, square) = self.half_angle();
            let y = small.if_then_else(-self, (root + root) | self.sign());
            let eighths = small.if_then_else(y.eighths(2.0), self.is_negative().if_then_else_zero(y.eighths(4.0)));
            y.plus_eighths(square, table!(asin poly!(square)), eighths)
        })
    }
    /// `atan(self / x) = atan(above / below) + n * PI / 4` for positive numbers, where `|above / below|` is at most 0.5, or 1 for `f32`.
    #[op]
    fn eighth(self, x: Self) -> (Self, Self, Self) {
        return_if!(T::BITS == 32, {
            let steep = self.simd_gt(x);
            (
                steep.if_then_else(x.negated(), self),
                steep.if_then_else(self, x),
                steep.if_then_else_zero(x.eighths(2.0)),
            )
        });
        let (middle, steep) = ((self + self).simd_gt(x), self.simd_gt(x + x));
        let (above, below) = (self - middle.if_then_else_zero(x), x + middle.if_then_else_zero(self));
        (
            steep.if_then_else(x.negated(), above),
            steep.if_then_else(self, below),
            steep.if_then_else(x.eighths(2.0), middle.if_then_else_zero(x.eighths(1.0))),
        )
    }
    #[op]
    fn small_atan(self, eighths: Self) -> Self {
        let y = self * self;
        self.plus_eighths(y, table!(atan first_last!(y)), eighths)
    }
    /// `Atan`. 1.7 ULP.
    #[inline(always)]
    pub fn atan(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.atan());
            return_if!(T::BITS == 32, {
                let x = self.abs();
                let steep = x.simd_gt(x.k(1.0));
                steep.if_then_else(x.k(-1.0) / x, x).small_atan(steep.if_then_else_zero(x.eighths(2.0))) | self.sign()
            });
            let (above, below, eighths) = self.abs().eighth(self.k(1.0));
            (above / below).small_atan(eighths) | self.sign()
        })
    }
    /// `Atan2`: the angle of the point `(x, self)`. 2 ULP.
    #[op]
    pub fn atan2(self, x: impl crate::Operand<T, W, S>) -> Self {
        let x = crate::Operand::vector(x, crate::Tag::new(self.s));
        apart!(self.s, {
            in_f32!(half self, x => |a, b| a.atan2(b));
            let (a, b, infinity) = (x.abs(), self.abs(), x.k(f64::INFINITY));
            let (above, below, mut eighths) = b.eighth(a);
            let mut quotient = above / below;
            // Zero by zero, infinity by infinity, or a sum that overflows.
            let ordinary = quotient.simd_eq(quotient);
            if !(choose! { T::BITS == 32 => ordinary, _ => ordinary & below.simd_lt(infinity) }).all() {
                core::hint::cold_path();
                let (sum, both) = (a + b, a.simd_eq(infinity) & b.simd_eq(infinity));
                let scale = sum.simd_eq(infinity).if_then_else(x.k(0.25), x.k(1.0));
                let a = (both | sum.simd_eq(x.k(0.0))).if_then_else(x.k(1.0), a * scale);
                let (above, below, instead) = both.if_then_else(x.k(1.0), b * scale).eighth(a);
                (quotient, eighths) = (above / below, instead);
            }
            (quotient ^ x.sign()).small_atan(x.is_negative().if_then_else(x.eighths(4.0) - eighths, eighths))
                | self.sign()
        })
    }

    /// For `self = q * ln(2) + r >= 0`: `sinh(r)` in two parts, `cosh(r) - 1`, and `2^q / 2` and `2^-q / 2`. `f` makes the result of them.
    #[op]
    fn hyperbolic(self, f: impl FnOnce(Two<Self>, Self, Two<Self>) -> Self) -> Self {
        let (q, by) = self.exponent_plus(LOG2_E, -1.0);
        let (high, rest) = self.minus_most_of_ln_2_times(q);
        let low = q * rest;
        let r = high + low;
        let z = r * r;
        let (low, cosh) = (table!(sinh poly!(z)).mul_add_relaxed(z * r, low), table!(cosh poly!(z)) * z);
        let up = Self::power(by);
        let y = f((high, low), cosh, (up, (self.bits2(252 << 23, 2044 << 52) - up.cast_unsigned()).bitcast()));
        let ordinary = self.simd_lt(self.k2(87.0, 708.0));
        if ordinary.all() {
            return y;
        }
        core::hint::cold_path();
        let above = self.simd_gt(self.k2(95.0, 800.0));
        let large = above.if_then_zero_else(self.k(1.0) + (high + (low + cosh))).times_power(by);
        ordinary.if_then_else(y, above.if_then_else(self.k(f64::INFINITY), large))
    }
    /// `Sinh`. 1.7 ULP.
    #[inline(always)]
    pub fn sinh(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.sinh());
            self.abs().hyperbolic(
                #[inline(always)]
                |(high, low), cosh, (up, down)| {
                    let (sum, difference) = (up + down, up - down);
                    sum.mul_add_relaxed(high, difference) + difference.mul_add_relaxed(cosh, sum * low)
                },
            ) | self.sign()
        })
    }
    /// 1.6 ULP.
    #[inline(always)]
    pub fn cosh(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.cosh());
            self.abs().hyperbolic(
                #[inline(always)]
                |(high, low), cosh, (up, down)| {
                    let sinh = high + low;
                    up + up.mul_add_relaxed(cosh + sinh, down.mul_add_relaxed(cosh - sinh, down))
                },
            )
        })
    }
    /// `Tanh`. 2.8 ULP.
    #[inline(always)]
    pub fn tanh(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.tanh());
            let (twice, most) = (self.abs() + self.abs(), self.k(40.0));
            let y = most.if_less(twice).ordinary_exp_m1().0;
            (y / (y + y.k(2.0))) | self.sign()
        })
    }
    /// `Asinh`. 1.7 ULP.
    #[inline(always)]
    pub fn asinh(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.asinh());
            let (x, one) = (self.abs(), self.k(1.0));
            let root = x.mul_add_relaxed(x, one).sqrt();
            let y = root + x;
            // The quotient is root - 1 with more digits.
            let low = (root - y + x) + (x * x / (root + one) - (root - one));
            let below = x.simd_lt(x.k2(1e18, 1e150));
            let (y, huge) = if below.all() {
                (y, None)
            } else {
                core::hint::cold_path();
                (below.if_then_else(y, x), Some(!below))
            };
            y.ln_of_two(low, huge, 1.0) | self.sign()
        })
    }
    /// `Acosh`. 2.2 ULP.
    #[inline(always)]
    pub fn acosh(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.acosh());
            let less = self - self.k(1.0);
            let root = less.mul_add_relaxed(less, less + less).sqrt();
            let y = self + root;
            let (low, most) = (self - y + root, y.k2(1e18, 1e150));
            let (y, huge) = if self.all_within(y.k(1.0), most) {
                (y, None)
            } else {
                core::hint::cold_path();
                let below = self.simd_lt(most);
                (self.simd_ge(y.k(1.0)).if_then_else(below.if_then_else(y, self), y.k(f64::NAN)), Some(!below))
            };
            y.ln_of_two(low, huge, 1.0)
        })
    }
    /// `Atanh`. 2.3 ULP.
    #[inline(always)]
    pub fn atanh(self) -> Self {
        apart!(self.s, {
            in_f32!(half self => |x| x.atanh());
            let (x, one) = (self.abs(), self.k(1.0));
            let quotient = (x + x) / (one - x);
            let y = quotient + one;
            let below = x.simd_lt(one);
            y.ln_of_two(
                quotient - (y - one),
                if below.all() {
                    None
                } else {
                    core::hint::cold_path();
                    Some(!below)
                },
                0.0,
            ) * (x.k(0.5) | self.sign())
        })
    }
}
