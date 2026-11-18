//! The functions of the Math object and the operators that are not single instructions.

mod hypot;
mod pow;
mod precise_sum;
mod remainder;

pub use hypot::{Hypot, hypot, hypot3};
pub use pow::{MAX_EXPONENT_BY_SQUARING, portable_pow, pow, pow_by_squaring};
pub use precise_sum::PreciseSum;
pub use remainder::remainder;

use core::f64::consts::FRAC_PI_4;

use crate::{float16_from_f64, float16_to_f64};

macro_rules! from_methods {
    ($($function:ident = $method:ident,)*) => {$(
        #[inline]
        pub fn $function(x: f64) -> f64 {
            x.$method()
        }
    )*};
}

from_methods! {
    abs = abs,
    acos = acos,
    acosh = acosh,
    asin = asin,
    asinh = asinh,
    atan = atan,
    cbrt = cbrt,
    ceil = ceil,
    cos = cos,
    cosh = cosh,
    exp = exp,
    expm1 = exp_m1,
    floor = floor,
    log = ln,
    log10 = log10,
    log1p = ln_1p,
    log2 = log2,
    sin = sin,
    sinh = sinh,
    sqrt = sqrt,
    tan = tan,
    tanh = tanh,
    trunc = trunc,
}

/// `f64::atan2` of two infinities is not the multiple of a quarter turn that the language asks for.
pub fn atan2(y: f64, x: f64) -> f64 {
    if x.is_infinite() && y.is_infinite() {
        let quarters = if x > 0.0 { 1.0 } else { 3.0 };
        return (quarters * FRAC_PI_4).copysign(y);
    }
    y.atan2(x)
}

/// `f64::atanh` is not the function of the C library, and is less accurate than this.
pub fn atanh(x: f64) -> f64 {
    let magnitude = x.abs();
    if magnitude < 1.0 / (1 << 28) as f64 {
        return x;
    }
    let twice = magnitude + magnitude;
    let ratio = if magnitude < 0.5 {
        twice + twice * magnitude / (1.0 - magnitude)
    } else {
        twice / (1.0 - magnitude)
    };
    (0.5 * ratio.ln_1p()).copysign(x)
}

/// Math.round, which rounds a half up and not away from zero.
#[inline]
pub fn round(x: f64) -> f64 {
    let ceiling = x.ceil();
    ceiling - if ceiling - 0.5 > x { 1.0 } else { 0.0 }
}

/// Math.sign
#[inline]
pub fn sign(x: f64) -> f64 {
    if x == 0.0 || x.is_nan() {
        return x;
    }
    1f64.copysign(x)
}

/// Math.max of two, where a NaN wins and zero is above negative zero.
#[inline]
pub fn max(a: f64, b: f64) -> f64 {
    a.maximum(b)
}

/// The same, downwards.
#[inline]
pub fn min(a: f64, b: f64) -> f64 {
    a.minimum(b)
}

/// Math.fround
#[inline]
pub fn fround(x: f64) -> f64 {
    f64::from(x as f32)
}

/// Math.f16round
#[inline]
pub fn f16round(x: f64) -> f64 {
    float16_to_f64(float16_from_f64(x))
}
