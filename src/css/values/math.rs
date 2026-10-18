//! `f32` math that gives the same bits on every host.
//!
//! The CSS parser folds math functions (`sin()`, `atan2()`, `pow()`, ...) and converts colors
//! while it parses, and it prints the results. The `f32` functions of the C library (`sinf`,
//! `atan2f`, `powf`, `cbrtf`, ...) differ in the last bit between glibc, musl, Apple's libm and
//! the Windows CRT, so one stylesheet built to different bytes on each of them. Nothing in this
//! crate calls them: `test/internal/source-lints/css-host-math.test.ts` fails on a call.
//!
//! Every function here widens to `f64`, computes with code that is compiled into Bun, and rounds
//! once to `f32`. The kernels use only IEEE addition, subtraction, multiplication, division and
//! square root, so the processor does not change the result either. `src/sema/check/decl.rs`
//! has its own `exp`, `log` and `pow` because it needs `mul_add`, as Go compiles them for arm64.
//! `mul_add` is a library call on x64, and the color conversions call `pow` too often for that.
//!
//! The functions are `#[inline(never)]`, as a call to the C library was. The fold sites are
//! generic over the value type, and each instantiation would get a copy of the kernels.

#[inline(never)]
pub(crate) fn sin(x: f32) -> f32 {
    kernel::sin(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn cos(x: f32) -> f32 {
    kernel::cos(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn tan(x: f32) -> f32 {
    kernel::tan(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn asin(x: f32) -> f32 {
    kernel::asin(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn acos(x: f32) -> f32 {
    kernel::acos(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn atan(x: f32) -> f32 {
    kernel::atan(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn atan2(y: f32, x: f32) -> f32 {
    kernel::atan2(f64::from(y), f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn exp(x: f32) -> f32 {
    kernel::exp(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn ln(x: f32) -> f32 {
    kernel::ln(f64::from(x)) as f32
}

#[inline(never)]
pub(crate) fn log(x: f32, base: f32) -> f32 {
    (kernel::ln(f64::from(x)) / kernel::ln(f64::from(base))) as f32
}

/// `x` to the power `y`, with the special values of C99 F.10.4.4, which `f32::powf` has.
#[inline(never)]
pub(crate) fn pow(x: f32, y: f32) -> f32 {
    let (x, y) = (f64::from(x), f64::from(y));
    if y == 0.0 || x == 1.0 {
        return 1.0;
    }
    if x.is_nan() || y.is_nan() {
        return f32::NAN;
    }
    let magnitude = x.abs();
    if y.is_infinite() {
        return if magnitude == 1.0 {
            1.0
        } else if (magnitude < 1.0) == (y > 0.0) {
            0.0
        } else {
            f32::INFINITY
        };
    }
    let is_integer = y.fract() == 0.0;
    if x < 0.0 && x.is_finite() && !is_integer {
        return f32::NAN;
    }
    // Repeated squaring is exact while the power fits in an `f64`: `pow(x, 2)` is `x * x`.
    let result = if is_integer && y.abs() <= 64.0 {
        let power = kernel::powi(magnitude, y.abs() as u32);
        if y < 0.0 { 1.0 / power } else { power }
    } else {
        kernel::exp(y * kernel::ln(magnitude))
    };
    // Every `f32` from 2**24 up is an even integer.
    let is_odd = is_integer && y.abs() < 16777216.0 && (y as i64) & 1 == 1;
    (if is_odd && x.is_sign_negative() {
        -result
    } else {
        result
    }) as f32
}

pub(crate) fn cube(x: f32) -> f32 {
    let x = f64::from(x);
    (x * x * x) as f32
}

/// The squares of two `f32` are exact in `f64`, and their sum does not overflow.
#[inline(never)]
pub(crate) fn hypot(x: f32, y: f32) -> f32 {
    // C99 F.10.4.3: an infinity wins over a NaN.
    if x.is_infinite() || y.is_infinite() {
        return f32::INFINITY;
    }
    let (x, y) = (f64::from(x), f64::from(y));
    (x * x + y * y).sqrt() as f32
}

/// `cbrtf` of FreeBSD's msun (`s_cbrtf.c`): an estimate from the exponent, then two Newton steps
/// in `f64`.
#[inline(never)]
pub(crate) fn cbrt(x: f32) -> f32 {
    /// `(127 - 127.0 / 3 - 0.03306235651) * 2**23`
    const B1: u32 = 709958130;
    /// `(127 - 127.0 / 3 - 24 / 3 - 0.03306235651) * 2**23`
    const B2: u32 = 642849266;
    const SIGN: u32 = 1 << 31;
    let bits = x.to_bits();
    let magnitude = bits & !SIGN;
    if magnitude >= f32::INFINITY.to_bits() || magnitude == 0 {
        return x;
    }
    let estimate = if magnitude < f32::MIN_POSITIVE.to_bits() {
        // A subnormal, scaled by 2**24.
        ((x * 16777216.0).to_bits() & !SIGN) / 3 + B2
    } else {
        magnitude / 3 + B1
    };
    let x = f64::from(x);
    let mut t = f64::from(f32::from_bits((bits & SIGN) | estimate));
    for _ in 0..2 {
        let r = t * t * t;
        t = t * (x + x + r) / (x + r + r);
    }
    t as f32
}

/// `value * 10 ** exponent`, for the exponent of a number token. `POWERS` are the powers of ten
/// that an `f64` holds exactly, so each step rounds once.
pub(crate) fn scale_by_power_of_ten(mut value: f64, exponent: f64) -> f64 {
    const POWERS: [f64; 23] = [
        1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16,
        1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
    ];
    // No `f64` is finite and not zero after more than 632 powers of ten.
    let mut left = exponent.abs().min(700.0) as usize;
    while left > 0 {
        let step = left.min(POWERS.len() - 1);
        if exponent < 0.0 {
            value /= POWERS[step];
        } else {
            value *= POWERS[step];
        }
        left -= step;
    }
    value
}

// The kernels are ports of Go's `math` package, go1.24.4, Copyright 2009 The Go Authors, under
// its BSD 3-Clause license. Its `exp` and `log`, and `cbrtf` above, come from FreeBSD's msun,
// which has this notice:
//
//     Copyright (C) 1993, 2004 by Sun Microsystems, Inc. All rights reserved.
//     Developed at SunPro, a Sun Microsystems, Inc. business.
//     Permission to use, copy, modify, and distribute this software is freely granted,
//     provided that this notice is preserved.
//
// Go took `sin`, `cos`, `tan` and `atan` from the Cephes Math Library Release 2.8,
// Copyright 1984, 1987, 1989, 1992, 2000 by Stephen L. Moshier.
mod kernel {
    use core::f64::consts::{FRAC_1_SQRT_2, FRAC_2_PI, FRAC_PI_2, FRAC_PI_4, LOG2_E, PI};

    const EXPONENT_MASK: u64 = 0x7FF << 52;
    const LN2_HI: f64 = 6.93147180369123816490e-01;
    const LN2_LO: f64 = 1.90821492927058770002e-10;

    /// `trigReduce` of Go's math/trig_reduce.go: Payne-Hanek reduction of `x >= 2**29`. The
    /// caller widened `x` from an `f32`, so the first six of Go's twenty digits of 4/Pi are enough.
    fn reduce_large(x: f64) -> (u64, f64) {
        const FOUR_OVER_PI: [u64; 6] = [
            0x0000000000000001,
            0x45f306dc9c882a53,
            0xf84eafa3ea69bb81,
            0xb6c52b3278872083,
            0xfca2c757bd778ac3,
            0x6e48dc74849ba5c0,
        ];
        // `x` is positive: the bits above the mantissa are the exponent.
        let bits = x.to_bits();
        let mantissa = (bits & !EXPONENT_MASK) | (1 << 52);
        // Three digits of 4/Pi, placed so that the leading digit of the product has the exponent -61.
        let position = (bits >> 52) as u32 - (1023 + 52 - 61);
        let (digit, shift) = ((position / 64) as usize, position % 64);
        let at = |i: usize| {
            (FOUR_OVER_PI[i] << shift) | FOUR_OVER_PI[i + 1].checked_shr(64 - shift).unwrap_or(0)
        };
        // The upper two digits of the product.
        let middle = u128::from(at(digit + 1)) * u128::from(mantissa);
        let (low, carry) = (middle as u64)
            .overflowing_add((u128::from(at(digit + 2)) * u128::from(mantissa) >> 64) as u64);
        let high = at(digit)
            .wrapping_mul(mantissa)
            .wrapping_add((middle >> 64) as u64)
            .wrapping_add(u64::from(carry));
        // The top three bits are the octant. The bits after them are the fraction. `trigReduce`
        // takes the bits of `low` for it three places too high, which costs it precision next to a
        // multiple of Pi/4.
        let mut octant = high >> 61;
        let (high, low) = ((high << 3) | (low >> 61), low << 3);
        let zeros = high.leading_zeros() + 1;
        let high = high.checked_shl(zeros).unwrap_or(0) | low.checked_shr(64 - zeros).unwrap_or(0);
        let mut fraction = f64::from_bits((high >> 12) | (u64::from(1023 - zeros) << 52));
        if octant & 1 == 1 {
            octant = (octant + 1) & 7;
            fraction -= 1.0;
        }
        (octant, fraction * FRAC_PI_4)
    }

    /// How `Sin`, `Cos` and `Tan` of Go start: the octant of `x > 0`, moved to the next even one,
    /// and what is left of `x`, in `[-Pi/4, Pi/4]`.
    fn reduce(x: f64) -> (u64, f64) {
        // Pi/4 in three parts.
        const PI4A: f64 = 7.85398125648498535156e-1;
        const PI4B: f64 = 3.77489470793079817668e-8;
        const PI4C: f64 = 2.69515142907905952645e-15;
        if x >= (1u64 << 29) as f64 {
            return reduce_large(x);
        }
        let mut octant = (x * (2.0 * FRAC_2_PI)) as u64;
        octant += octant & 1;
        let y = octant as f64;
        (octant & 7, ((x - y * PI4A) - y * PI4B) - y * PI4C)
    }

    /// The sine of `z` in `[-Pi/4, Pi/4]`.
    fn sin_of_reduced(z: f64) -> f64 {
        const S: [f64; 6] = [
            1.58962301576546568060e-10,
            -2.50507477628578072866e-8,
            2.75573136213857245213e-6,
            -1.98412698295895385996e-4,
            8.33333333332211858878e-3,
            -1.66666666666666307295e-1,
        ];
        let zz = z * z;
        z + z * zz * (((((S[0] * zz + S[1]) * zz + S[2]) * zz + S[3]) * zz + S[4]) * zz + S[5])
    }

    /// The cosine of `z` in `[-Pi/4, Pi/4]`.
    fn cos_of_reduced(z: f64) -> f64 {
        const C: [f64; 6] = [
            -1.13585365213876817300e-11,
            2.08757008419747316778e-9,
            -2.75573141792967388112e-7,
            2.48015872888517045348e-5,
            -1.38888888888730564116e-3,
            4.16666666666665929218e-2,
        ];
        let zz = z * z;
        1.0 - 0.5 * zz
            + zz * zz * (((((C[0] * zz + C[1]) * zz + C[2]) * zz + C[3]) * zz + C[4]) * zz + C[5])
    }

    /// `math.Sin`
    pub(super) fn sin(x: f64) -> f64 {
        if x == 0.0 || x.is_nan() {
            return x;
        }
        if x.is_infinite() {
            return f64::NAN;
        }
        let (octant, z) = reduce(x.abs());
        let y = if octant & 2 == 2 {
            cos_of_reduced(z)
        } else {
            sin_of_reduced(z)
        };
        if (octant > 3) != (x < 0.0) { -y } else { y }
    }

    /// `math.Cos`
    pub(super) fn cos(x: f64) -> f64 {
        if !x.is_finite() {
            return f64::NAN;
        }
        let (octant, z) = reduce(x.abs());
        let y = if octant & 2 == 2 {
            sin_of_reduced(z)
        } else {
            cos_of_reduced(z)
        };
        if octant == 2 || octant == 4 { -y } else { y }
    }

    /// `math.Tan`
    pub(super) fn tan(x: f64) -> f64 {
        const P: [f64; 3] = [
            -1.30936939181383777646e4,
            1.15351664838587416140e6,
            -1.79565251976484877988e7,
        ];
        const Q: [f64; 4] = [
            1.36812963470692954678e4,
            -1.32089234440210967447e6,
            2.50083801823357915839e7,
            -5.38695755929454629881e7,
        ];
        if x == 0.0 || x.is_nan() {
            return x;
        }
        if x.is_infinite() {
            return f64::NAN;
        }
        let (octant, z) = reduce(x.abs());
        let zz = z * z;
        let mut y = z;
        if zz > 1e-14 {
            y += z
                * (zz * ((P[0] * zz + P[1]) * zz + P[2])
                    / ((((zz + Q[0]) * zz + Q[1]) * zz + Q[2]) * zz + Q[3]));
        }
        if octant & 2 == 2 {
            y = -1.0 / y;
        }
        if x < 0.0 { -y } else { y }
    }

    /// `satan` and `xatan` of Go's math/atan.go: the arc tangent of `x >= 0`.
    fn atan_of_positive(x: f64) -> f64 {
        /// `Pi/2` is `FRAC_PI_2 + MORE_BITS`.
        const MORE_BITS: f64 = 6.123233995736765886130e-17;
        /// The tangent of `3 * Pi / 8`.
        const TAN_3_PI_8: f64 = 2.41421356237309504880;
        fn series(x: f64) -> f64 {
            const P: [f64; 5] = [
                -8.750608600031904122785e-01,
                -1.615753718733365076637e+01,
                -7.500855792314704667340e+01,
                -1.228866684490136173410e+02,
                -6.485021904942025371773e+01,
            ];
            const Q: [f64; 5] = [
                2.485846490142306297962e+01,
                1.650270098316988542046e+02,
                4.328810604912902668951e+02,
                4.853903996359136964868e+02,
                1.945506571482613964425e+02,
            ];
            let z = x * x;
            let z = z * ((((P[0] * z + P[1]) * z + P[2]) * z + P[3]) * z + P[4])
                / (((((z + Q[0]) * z + Q[1]) * z + Q[2]) * z + Q[3]) * z + Q[4]);
            x * z + x
        }
        if x <= 0.66 {
            series(x)
        } else if x > TAN_3_PI_8 {
            FRAC_PI_2 - series(1.0 / x) + MORE_BITS
        } else {
            FRAC_PI_4 + series((x - 1.0) / (x + 1.0)) + 0.5 * MORE_BITS
        }
    }

    /// `math.Atan`
    pub(super) fn atan(x: f64) -> f64 {
        if x == 0.0 {
            return x;
        }
        atan_of_positive(x.abs()).copysign(x)
    }

    /// `math.Asin`
    pub(super) fn asin(x: f64) -> f64 {
        if x == 0.0 {
            return x;
        }
        let magnitude = x.abs();
        if magnitude > 1.0 {
            return f64::NAN;
        }
        let other_side = (1.0 - magnitude * magnitude).sqrt();
        let y = if magnitude > 0.7 {
            FRAC_PI_2 - atan_of_positive(other_side / magnitude)
        } else {
            atan_of_positive(magnitude / other_side)
        };
        y.copysign(x)
    }

    /// `math.Acos`
    pub(super) fn acos(x: f64) -> f64 {
        FRAC_PI_2 - asin(x)
    }

    /// `math.Atan2`
    pub(super) fn atan2(y: f64, x: f64) -> f64 {
        if y.is_nan() || x.is_nan() {
            return f64::NAN;
        }
        if y == 0.0 {
            return if x.is_sign_positive() {
                y
            } else {
                PI.copysign(y)
            };
        }
        if x == 0.0 {
            return FRAC_PI_2.copysign(y);
        }
        if x.is_infinite() {
            return match (x > 0.0, y.is_infinite()) {
                (true, true) => FRAC_PI_4,
                (true, false) => 0.0,
                (false, true) => 3.0 * FRAC_PI_4,
                (false, false) => PI,
            }
            .copysign(y);
        }
        if y.is_infinite() {
            return FRAC_PI_2.copysign(y);
        }
        let q = atan(y / x);
        if x > 0.0 {
            q
        } else if q <= 0.0 {
            q + PI
        } else {
            q - PI
        }
    }

    /// `math.Exp`
    pub(super) fn exp(x: f64) -> f64 {
        const P1: f64 = 1.66666666666666657415e-01;
        const P2: f64 = -2.77777777770155933842e-03;
        const P3: f64 = 6.61375632143793436117e-05;
        const P4: f64 = -1.65339022054652515390e-06;
        const P5: f64 = 4.13813679705723846039e-08;
        if x.is_nan() {
            return x;
        }
        if x > 7.09782712893383973096e+02 {
            return f64::INFINITY;
        }
        if x < -7.45133219101941108420e+02 {
            return 0.0;
        }
        if x.abs() < 1.0 / (1u64 << 28) as f64 {
            return 1.0 + x;
        }
        // `x` is `k * ln(2) + r`. `r` is `hi - lo`, for extra precision.
        let k = (LOG2_E * x + 0.5f64.copysign(x)) as i64;
        let hi = x - k as f64 * LN2_HI;
        let lo = k as f64 * LN2_LO;
        let r = hi - lo;
        let t = r * r;
        let c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
        let y = 1.0 - ((lo - (r * c) / (2.0 - c)) - hi);
        // `math.Ldexp(y, k)`. A subnormal result takes one more multiplication.
        let bits = y.to_bits();
        let mut exponent = ((bits & EXPONENT_MASK) >> 52) as i64 + k;
        let mut scale = 1.0;
        if exponent < 1 {
            exponent += 53;
            scale = 1.0 / (1u64 << 53) as f64;
        }
        scale * f64::from_bits((bits & !EXPONENT_MASK) | ((exponent as u64) << 52))
    }

    /// `math.Log`. The caller widened `x` from an `f32`, so it is not a subnormal.
    pub(super) fn ln(x: f64) -> f64 {
        const L1: f64 = 6.666666666666735130e-01;
        const L2: f64 = 3.999999999940941908e-01;
        const L3: f64 = 2.857142874366239149e-01;
        const L4: f64 = 2.222219843214978396e-01;
        const L5: f64 = 1.818357216161805012e-01;
        const L6: f64 = 1.531383769920937332e-01;
        const L7: f64 = 1.479819860511658591e-01;
        if x.is_nan() || x == f64::INFINITY {
            return x;
        }
        if x < 0.0 {
            return f64::NAN;
        }
        if x == 0.0 {
            return f64::NEG_INFINITY;
        }
        debug_assert!(x >= f64::MIN_POSITIVE);
        // `math.Frexp`: `x` is `f1 * 2 ** ki`, with `f1` in `[1/2, 1)`.
        let bits = x.to_bits();
        let mut f1 = f64::from_bits((bits & !EXPONENT_MASK) | (1022 << 52));
        let mut ki = ((bits & EXPONENT_MASK) >> 52) as i32 - 1022;
        if f1 < FRAC_1_SQRT_2 {
            f1 *= 2.0;
            ki -= 1;
        }
        let f = f1 - 1.0;
        let k = f64::from(ki);
        let s = f / (2.0 + f);
        let s2 = s * s;
        let s4 = s2 * s2;
        let t1 = s2 * (L1 + s4 * (L3 + s4 * (L5 + s4 * L7)));
        let t2 = s4 * (L2 + s4 * (L4 + s4 * L6));
        let r = t1 + t2;
        let hfsq = 0.5 * f * f;
        k * LN2_HI - ((hfsq - (s * (hfsq + r) + k * LN2_LO)) - f)
    }

    /// `base ** exponent` by repeated squaring.
    pub(super) fn powi(mut base: f64, mut exponent: u32) -> f64 {
        let mut result = 1.0;
        loop {
            if exponent & 1 == 1 {
                result *= base;
            }
            exponent >>= 1;
            if exponent == 0 {
                return result;
            }
            base *= base;
        }
    }
}
