//! The error function, the gamma function, integer powers and remainders.

use super::Real;
use crate::{Isa, MaskOf, Simd, Width};

#[macro_use]
#[path = "special_tables.rs"]
mod tables;

#[cold]
#[inline(never)]
fn remainders<T: Real>(lanes: &mut [T], by: &[T]) {
    lanes.iter_mut().zip(by).for_each(|(lane, &by)| *lane = lane.remainder(by));
}

/// What both gamma functions start with.
struct Parts<S: Isa, T: Real, W: Width> {
    /// `|x|` is `n + u`, where `n` is an integer.
    n: Simd<T, W, S>,
    u: Simd<T, W, S>,
    /// The sign bit says whether `n` is odd.
    odd: Simd<T, W, S>,
    /// Where Stirling's series is good enough.
    large: MaskOf<T, W, S>,
}

impl<S: Isa, T: Real, W: Width> Simd<T, W, S> {
    #[op]
    fn at_most(self, single: f64, double: f64) -> Self {
        let limit = self.k2(single, double);
        self.simd_gt(limit).if_then_else(limit, self)
    }

    /// The error function. 2.3 ULP.
    #[inline(always)]
    pub fn erf(self) -> Self {
        apart!(self.s, {
            crate::half::in_f32!(half self => |x| x.erf());
            let (x, one) = (self.abs(), self.k(1.0));
            let large = x.simd_ge(one);
            let small = always!(|| special!(erf_small x * x).mul_add_relaxed(x, x));
            if large.none() {
                return small() | self.sign();
            }
            let y = one - (-special!(erf_large x.at_most(4.0, 6.0) - one)).exp();
            (if large.all() { y } else { large.if_then_else(y, small()) }) | self.sign()
        })
    }
    /// `1 - erf(self)`, which is precise where it is small. 4.7 ULP.
    #[inline(always)]
    pub fn erfc(self) -> Self {
        apart!(self.s, {
            crate::half::in_f32!(half self => |x| x.erfc());
            let (x, one, k) = (self.abs().at_most(10.5, 27.5), self.k(1.0), self.k2(2.5, 4.0));
            let t = x / (x + k);
            let p = special!(erfc t - x.k(7.0 / 16.0));
            let (square, low) = x.two_product(x);
            // Times exp(-low).
            let p = p.mul_add_relaxed(low.neg_mul_add(t, t), -low);
            let y = (-square).exp();
            let y = y.mul_add_relaxed(p, y) / x.mul_add_relaxed(x.k(2.0), one);
            self.is_negative().if_then_else(x.k(2.0) - y, y)
        })
    }

    #[op]
    fn gamma_parts(self) -> Parts<S, T, W> {
        let round = self.k((1u64 << Self::MANTISSA) as f64);
        let rounded = self + round;
        let n = self.simd_lt(round).if_then_else(rounded - round, self);
        Parts {
            n,
            u: self - n,
            odd: (rounded.cast_unsigned() << (T::BITS - 1)).bitcast(),
            large: n.simd_ge(self.k(3.5)),
        }
    }
    /// `gamma(n + u) / gamma(1 + u)`, for `n` from 1 to 3. The factors are exact.
    #[op]
    fn falling(n: Self, u: Self) -> Self {
        let factor = always!(|i: f64| n.simd_gt(n.k(i)).if_then_else(u + n.k(i), n.k(1.0)));
        factor(1.0) * factor(2.0)
    }
    /// `1 / gamma(1 + self)`, near zero.
    #[op]
    fn inverse_gamma(self) -> Self {
        special!(inverse_gamma self).mul_add_relaxed(self, self.k(1.0))
    }
    /// `x * u * g(u) * g(-u)` where `x` is large, or that times `gamma(x)`, with `g(u) = 1 / gamma(1 + u)`.
    #[op]
    fn reflection(self, n: Self, u: Self, large: MaskOf<T, W, S>, g: Self, product: Self) -> Self {
        let (small, square) = (g * n.simd_eq(n.k(0.0)).if_then_else(self, self * u * product), u * u);
        if large.none() {
            small
        } else {
            large.if_then_else(special!(sinc square).mul_add_relaxed(square * u, u) * self, small)
        }
    }
    /// `ln(gamma(self)) - (ln(2 * PI) - 1) / 2 + constant`, in two parts.
    #[op]
    fn stirling(self, constant: Self, constant_low: Self) -> (Self, Self) {
        let (m, e, _) = self.split_any();
        let (ln, ln_low) = Self::precise_ln(m, e);
        let (less, inverse) = (self - self.k(0.5), self.k(1.0) / self);
        let (product, low) = less.two_product(ln - self.k(1.0));
        let sum = product + constant;
        let part = sum - product;
        let lost = (product - (sum - part)) + (constant - part);
        let series = special!(stirling inverse * inverse)
            .mul_add_relaxed(inverse, less.mul_add_relaxed(ln_low, low) + lost + constant_low);
        sum.two_sum(series)
    }

    /// The gamma function: `gamma(n + 1)` is the factorial of `n`. 3 ULP, and 5.2 for negative arguments.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f64x2::from([1.0, 5.0]).gamma().round(), [1.0, 24.0]);
    /// # } example()
    /// ```
    #[inline(always)]
    pub fn gamma(self) -> Self {
        apart!(self.s, {
            crate::half::in_f32!(half self => |x| x.gamma());
            let (x, one, negative, which) = (self.abs(), self.k(1.0), self.is_negative(), (T::BITS / 64) as usize);
            let Parts { n, u, odd, large } = x.gamma_parts();
            let zero = n.simd_eq(x.k(0.0));
            // gamma(-x) = (-1)^(n + 1) / (x * u * g(u) * g(-u) * gamma(x)), where g(u) = 1 / gamma(1 + u).
            let (mut above, mut below) = (one, one);
            if !large.all() || negative.any() {
                let (g, product) = ((u ^ self.sign()).inverse_gamma(), Self::falling(n, u));
                above = negative.if_then_else(one, product);
                below = g * zero.if_then_else(x, one);
                if negative.any() {
                    let reflected = -x.reflection(n, u, large, g, product) ^ odd;
                    below = negative
                        .if_then_else((u.simd_eq(x.k(0.0)) & !zero).if_then_else(x.k(f64::NAN), reflected), below);
                }
            }
            if large.none() {
                return above / below;
            }
            // Scaled, so that the exponential function neither overflows nor underflows too early.
            let (down, up) = (tables::STIRLING_DOWN[which], tables::STIRLING_UP[which]);
            let limited = negative.if_then_else(x.at_most(45.0, 190.0), x.at_most(36.0, 172.0));
            let (high, low) = limited.stirling(
                negative.if_then_else(x.k(up[0]), x.k(down[0])),
                negative.if_then_else(x.k(up[1]), x.k(down[1])),
            );
            let power = (high ^ self.sign()).exp();
            let power = power.mul_add_relaxed(low ^ self.sign(), power);
            if negative.none() {
                let y = power * x.k(256.0);
                return if large.all() { y } else { large.if_then_else(y, above / below) };
            }
            let back =
                negative.if_then_else(x.k2(1.0 / (1u64 << 48) as f64, f64::from_bits((1023 - 128) << 52)), x.k(256.0));
            large.if_then_else(power, above) / (large & !negative).if_then_else(one, below)
                * large.if_then_else(back, one)
        })
    }
    /// The logarithm of the absolute value of [`gamma`](Self::gamma). 5.3 ULP. For negative arguments, a result between -1 and 1
    /// has the error that 1 would have.
    #[inline(always)]
    pub fn ln_gamma(self) -> Self {
        apart!(self.s, {
            crate::half::in_f32!(half self => |x| x.ln_gamma());
            let (x, one, infinity, negative) = (self.abs(), self.k(1.0), self.k(f64::INFINITY), self.is_negative());
            let Parts { n, u, large, .. } = x.gamma_parts();
            let (constant, inverse_e) =
                (tables::STIRLING[(T::BITS / 64) as usize], tables::INVERSE_E[(T::BITS / 64) as usize]);
            // The result is factor * ln(of) + rest.
            let (mut factor, mut of, mut rest) = (one, one, one);
            if large.any() {
                let inverse = one / x;
                (factor, of) = (x - x.k(0.5), x * x.k(inverse_e[0]));
                let series = special!(stirling inverse * inverse).mul_add_relaxed(inverse, x.k(constant[0]));
                rest = factor.at_most(f32::MAX as f64, f64::MAX).mul_add_relaxed(x.k(inverse_e[1]), series);
            }
            if !large.all() {
                // From gamma(x + 1), gamma(x) or gamma(x - 1), whose inverse is 1 + w.
                let (below, above) = (x.simd_lt(x.k(0.75)), x.simd_gt(x.k(2.5)));
                let less = x - below.if_then_zero_else(above.if_then_else(x.k(2.0), one));
                let w = special!(two_zeros less - x.k2(41.0 / 64.0, 40.0 / 64.0)) * (less * (less - one));
                let inverse = w + one;
                let lost = w - (inverse - one);
                of =
                    large.if_then_else(of, below.if_then_else(inverse * x, inverse / above.if_then_else(x - one, one)));
                (factor, rest) =
                    (large.if_then_else(factor, one.negated()), large.if_then_else(rest, w.mul_sub(lost, lost)));
            }
            let mut y = factor.mul_add_relaxed(of.ln(), rest);
            if negative.any() {
                let (high, low) = x.stirling(x.k(constant[0]), x.k(constant[1]));
                let below = x.reflection(n, u, large, (-u).inverse_gamma(), Self::falling(n, u)).abs();
                let (m, e, _) = below.split_any();
                let (ln, ln_low) = Self::precise_ln(m, e);
                // The product with zero passes NaN on.
                let reflected = -((ln + large.if_then_else_zero(high))
                    + (u.mul_add_relaxed(x.k(0.0), ln_low) + large.if_then_else_zero(low)));
                y = negative
                    .if_then_else((u.simd_eq(x.k(0.0)) | x.simd_eq(infinity)).if_then_else(infinity, reflected), y);
            }
            y
        })
    }

    /// `self` to the power of `n`, by squaring. It rounds about 2 * log2(n) times, and the error can grow to `n` ULP.
    /// A negative `n` gives the reciprocal, for which this holds if the power is a normal `f32` or `f64`. The result is the same on all targets.
    #[op]
    pub fn powi(self, n: i32) -> Self {
        halves_if!(Self::HALF && W::BYTES > 32, |this: Self = self, n: i32 = n| this.tag().combine(this.upper_half().powi(n), this.lower_half().powi(n)));
        return_if!(Self::HALF, self.tag().cast(self.cast::<f32>().powi(n)));
        apart!(self.s, {
            let (mut left, mut square, mut y) = (n.unsigned_abs(), self, self.k(1.0));
            loop {
                if left & 1 == 1 {
                    y *= square;
                }
                left >>= 1;
                if left == 0 {
                    return if n < 0 { self.k(1.0) / y } else { y };
                }
                square = square * square;
            }
        })
    }

    /// `self` less a multiple of `by`, which is exact.
    #[inline(always)]
    fn less_multiple(self, by: Self) -> Self {
        apart_unoptimized!(self.s, {
            let q = (self / by).trunc();
            return_if!(S::HAS_FMA, q.neg_mul_add(by, self));
            let upper = self.bits2(0xffff_f000, 0xffff_ffff_f800_0000).bitcast();
            let (q, high) = (q & upper, by & upper);
            self - q * high - q * (by - high)
        })
    }
    #[inline(always)]
    pub(crate) fn fmod(self, by: Self) -> Self {
        apart_unoptimized!(self.s, {
            let (x, y) = (self.abs(), by.abs());
            // By a power of two from 1 on, the quotient doesn't overflow, and it is exact unless it is below 1.
            let (lanes, mut powers) = (by.cast_unsigned().to_array(), true);
            unrolled!(32, for i in 0..const (if crate::OPTIMIZED { Self::LANES } else { 0 }) {
                let bits = crate::lane::Int::to_u64(lanes.as_ref()[i]) << (65 - T::BITS);
                let bias = Self::EXPONENT_BIAS as u64;
                powers &= bits << (T::BITS - 1 - Self::MANTISSA) == 0
                    && (bits >> (65 - T::BITS + Self::MANTISSA)).wrapping_sub(bias) <= bias;
            });
            if crate::OPTIMIZED && crate::arithmetic::known(powers) {
                return (x - (x / y).trunc() * y) | self.sign();
            }
            let mut left = x.less_multiple(y);
            let mut other = self.tag().mask_false();
            if !left.abs().simd_lt(y).all() {
                // The quotient or a product can overflow.
                let limit = self.k2(1e38, 1e307);
                other = !((x / y).simd_lt(limit) & (x + y).simd_lt(limit));
                let y = other.if_then_else(self.k(1.0), y);
                left = other.if_then_zero_else(left);
                while left.abs().simd_ge(y).any() {
                    left = left.less_multiple(y);
                }
            }
            let left = (left + left.simd_lt(self.k(0.0)).if_then_else_zero(y)).abs() | self.sign();
            if other.none() {
                return left;
            }
            let mut lanes = self.to_array();
            remainders(lanes.as_mut(), by.to_array().as_ref());
            other.if_then_else(self.tag().from_array(lanes), left)
        })
    }
}
