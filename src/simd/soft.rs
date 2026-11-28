//! The float functions that core lacks, for targets without instructions for it.

macro_rules! whole { ($($m:ident $t:ident $u:ident $fraction:literal $bias:literal;)*) => {$(
    #[inline]
    pub fn trunc(x: $t) -> $t {
        let power = (x.abs().to_bits() >> $fraction) as i32 - $bias;
        if power >= $fraction {
            if x.is_nan() { x + x } else { x }
        } else {
            $t::from_bits(x.to_bits() & if power < 0 { !(!0 >> 1) } else { !0 << ($fraction - power) })
        }
    }
    #[inline]
    pub fn floor(x: $t) -> $t {
        let it = trunc(x);
        if x < it { it - 1.0 } else { it }
    }
    #[inline]
    pub fn ceil(x: $t) -> $t {
        let it = trunc(x);
        if x > it { it + 1.0 } else { it }
    }
    #[inline]
    pub fn round(x: $t) -> $t {
        let it = trunc(x);
        if (x - it).abs() >= 0.5 { it + (1.0 as $t).copysign(x) } else { it }
    }
    #[inline]
    pub fn round_ties_even(x: $t) -> $t {
        let it = trunc(x);
        let rest = (x - it).abs();
        if rest > 0.5 || rest == 0.5 && trunc(it * 0.5) != it * 0.5 { it + (1.0 as $t).copysign(x) } else { it }
    }
)*}; }

/// The bits, with an exponent below one for subnormal numbers. What has no root to compute returns.
macro_rules! normal {
    ($x:ident, $t:ident, $u:ident) => {{
        let (mut bits, least) = ($x.to_bits(), $t::MIN_POSITIVE.to_bits());
        if bits.wrapping_sub(least) >= $t::INFINITY.to_bits() - least {
            if bits.wrapping_sub(1) >= least {
                return if $x < 0.0 { $t::NAN } else { $x + $x };
            }
            let up = bits.leading_zeros() - least.leading_zeros();
            bits = (bits << up).wrapping_sub(least * up as $u);
        }
        bits
    }};
}
/// By the lowest bit of the exponent and six of the fraction. It has 16 bits after the point, of which 8 are right.
const INVERSE_ROOTS: [u16; 128] = {
    let (mut all, mut i) = ([0; 128], 0);
    while i < 128 {
        all[i] = ((1u64 << (38 + i / 64)) / (129 + i as u64 % 64 * 2)).isqrt() as u16;
        i += 1;
    }
    all
};
#[inline]
fn times(a: u32, b: u32) -> u32 {
    ((a as u64 * b as u64) >> 31) as u32
}
/// A step of Newton's. `x` is in 1..4 and has 30 bits after the point, and the inverse of its root 31.
#[inline]
fn better(x: u32, inverse: u32) -> u32 {
    times(inverse, (3 << 30) - times(times(x, inverse), inverse))
}

pub mod f32 {
    use super::*;
    whole! { f32 f32 u32 23 127; }
    #[inline]
    pub fn sqrt(x: f32) -> f32 {
        let bits = normal!(x, f32, u32);
        let digits = (bits << 8 | 1 << 31) >> (bits >> 23 & 1);
        let inverse = better(digits, (INVERSE_ROOTS[(bits >> 17) as usize % 128] as u32) << 15);
        let root = times(digits, inverse);
        let rest = digits.wrapping_sub(times(root << 1, root)) as i32;
        // This, or the next.
        let root = root.wrapping_add(((rest as i64 * inverse as i64) >> 32) as u32) >> 7;
        let up = root.wrapping_mul(root + 1).wrapping_sub(digits << 16) >> 31;
        f32::from_bits((bits.wrapping_add(125 << 23) >> 24 << 23) + root + up)
    }
    /// The product is exact, and the sum is rounded to odd.
    #[inline]
    pub fn mul_add(a: f32, b: f32, c: f32) -> f32 {
        let (product, c) = (a as f64 * b as f64, c as f64);
        let sum = product + c;
        let part = sum - product;
        let lost = (product - (sum - part)) + (c - part);
        if lost == 0.0 || !sum.is_finite() {
            return sum as f32;
        }
        f64::from_bits((sum.to_bits() - ((lost < 0.0) != (sum < 0.0)) as u64) | 1) as f32
    }
}

pub mod f64 {
    use super::*;
    whole! { f64 f64 u64 52 1023; }
    /// |x| is the first times two to the power of the second, which has 53 bits. It is finite and not zero.
    fn parts(x: f64) -> (u128, i32) {
        let (bits, exponent) = (x.to_bits() & !0 >> 12, (x.to_bits() >> 52 & 0x7ff) as i32);
        if exponent > 0 {
            return ((bits | 1 << 52) as u128, exponent - 1075);
        }
        let up = bits.leading_zeros() - 11;
        ((bits << up) as u128, -1074 - up as i32)
    }
    /// The lowest bit tells whether a bit was dropped.
    fn sticky(x: u128, by: u32) -> u128 {
        if by > 127 { (x != 0) as u128 } else { x >> by | (x & !(!0 << by) != 0) as u128 }
    }
    /// The nearest value.
    fn nearest(digits: u128, power: i32) -> f64 {
        let up = digits.leading_zeros();
        let (digits, top) = (digits << up, power - up as i32 + 127);
        if top > 1023 {
            return f64::INFINITY;
        }
        let (exponent, below) = if top < -1022 { (0, (-1022 - top) as u32) } else { ((top + 1022) as u64, 0) };
        let digits = sticky(digits, 73 + below) as u64;
        // The first digit adds one to the exponent, and so does a carry.
        f64::from_bits((exponent << 52) + ((digits + 1 + (digits >> 2 & 1)) >> 2))
    }
    #[inline]
    pub fn sqrt(x: f64) -> f64 {
        let bits = normal!(x, f64, u64);
        let digits = (bits << 11 | 1 << 63) >> (bits >> 52 & 1);
        let first = (digits >> 32) as u32;
        let inverse = better(first, better(first, (INVERSE_ROOTS[(bits >> 46) as usize % 128] as u32) << 15));
        let root = (first as u64 * inverse as u64) >> 30;
        let rest = digits.wrapping_sub(root.wrapping_mul(root)) as i64;
        // This, or the next.
        let root = (root << 24).wrapping_add((((rest >> 6) * inverse as i64) >> 33) as u64) >> 3;
        let up = root.wrapping_mul(root + 1).wrapping_sub(digits << 42) >> 63;
        f64::from_bits((bits.wrapping_add(1021 << 52) >> 53 << 52) + root + up)
    }
    pub fn mul_add(a: f64, b: f64, c: f64) -> f64 {
        if a == 0.0 || b == 0.0 || !a.is_finite() || !b.is_finite() {
            return a * b + c;
        }
        if !c.is_finite() {
            return c + c;
        }
        if c == 0.0 {
            return a * b;
        }
        let ((x, p), (y, q), (z, r)) = (parts(a), parts(b), parts(c));
        let (product, other) = (((x * y) << 20, p + q - 20), (z << 72, r - 72));
        let power = product.1.max(other.1);
        let signed = |(digits, at): (u128, i32), negative| {
            let digits = sticky(digits, (power - at) as u32) as i128;
            if negative { -digits } else { digits }
        };
        let sum = signed(product, (a < 0.0) != (b < 0.0)) + signed(other, c < 0.0);
        if sum == 0 { 0.0 } else { nearest(sum.unsigned_abs(), power).copysign(sum as f64) }
    }
}
