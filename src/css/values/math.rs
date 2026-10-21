//! `f32` math from IEEE `f64` arithmetic only: the same bits on every host, unlike the C library's.

// Not inlined: the fold sites are generic, and each instantiation would get a copy of the kernels.
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
pub(crate) fn ln(x: f32) -> f32 {
    kernel::ln(f64::from(x)) as f32
}

/// `f32::log` divides two `f32` logarithms, which makes `log(32768, 2)` less than 15.
#[inline(never)]
pub(crate) fn log(x: f32, base: f32) -> f32 {
    (kernel::ln(f64::from(x)) / kernel::ln(f64::from(base))) as f32
}

/// The squares of two `f32` are exact in `f64`, and their sum does not overflow.
#[inline(never)]
pub(crate) fn hypot(x: f32, y: f32) -> f32 {
    let (x, y) = (f64::from(x), f64::from(y));
    (x * x + y * y).sqrt() as f32
}

/// `cbrtf` of FreeBSD's msun: an estimate from the exponent, then two Halley steps in `f64`.
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

// Ports of Go's `math` (go1.24.4), and `cbrt` above of FreeBSD's msun. LICENSE.md has the notices.
mod kernel {
    use core::f64::consts::{FRAC_1_SQRT_2, FRAC_PI_2, FRAC_PI_4, PI};

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

    /// `math.Log`. The caller widened `x` from an `f32`, so it is not a subnormal.
    pub(super) fn ln(x: f64) -> f64 {
        const EXPONENT_MASK: u64 = 0x7FF << 52;
        const LN2_HI: f64 = 6.93147180369123816490e-01;
        const LN2_LO: f64 = 1.90821492927058770002e-10;
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
}
