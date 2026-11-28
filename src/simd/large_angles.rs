//! Sine, cosine and tangent of one number of any size, by the reduction of Payne and Hanek.

use core::f64::consts::PI;

/// 64 zeros, and then the bits of `2 / PI` after the point.
static TWO_OVER_PI: [u64; 20] = [
    0, 0xa2f9836e4e441529, 0xfc2757d1f534ddc0, 0xdb6295993c439041, 0xfe5163abdebbc561, 0xb7246e3a424dd2e0,
    0x06492eea09d1921c, 0xfe1deb1cb129a73e, 0xe88235f52ebb4484, 0xe99c7026b45f7e41, 0x3991d639835339f4,
    0x9c845f8bbdf9283b, 0x1ff897ffde05980f, 0xef2f118b5a0a6d1f, 0x6d367ecf27cb09b7, 0x4f463f669e5fea2d,
    0x7527bac7ebe5f17b, 0x3d0739f78a5292ea, 0x6bfb5fb11f8d5d08, 0x56033046fc7b6bab,
];

/// The number of quarter turns in `|x|` modulo 4, and what is left, which is within an eighth of a turn. `|x| > 1`.
fn reduce(x: f64) -> (u32, f64) {
    let (exponent, mantissa) = ((x.to_bits() >> 52 & 0x7ff) as usize, (x.to_bits() << 11 | 1 << 63) >> 11);
    // The bits before these add multiples of 4.
    let first = exponent + 62 - 1075;
    let word = |i: usize| {
        let pair = (TWO_OVER_PI[first / 64 + i] as u128) << 64 | TWO_OVER_PI[first / 64 + i + 1] as u128;
        (pair << (first % 64) >> 64) * mantissa as u128
    };
    // Two bits before the point and 126 after it, of which no number has more than 62 that are all zeros or all ones.
    let high = (word(0) << 64).wrapping_add(word(1)).wrapping_add(word(2) >> 64);
    let fraction = (high << 2) as i128;
    let quarters = (high >> 126) as u32 + (fraction < 0) as u32;
    let zeros = fraction.unsigned_abs().leading_zeros();
    let product = (fraction.unsigned_abs() << zeros >> 64) * 0xc90fdaa22168c235;
    // The lowest bit stands for those that are dropped.
    let left = ((product >> 65) as i64 | (product << 63 != 0) as i64) as f64
        * f64::from_bits((1023 - 62 - zeros as u64) << 52);
    (quarters, if fraction < 0 { -left } else { left })
}

/// The inverses of the factorials of `first`, `first + 2` and so on, with signs in turns.
const fn taylor(first: u32) -> [f64; 8] {
    let (mut all, mut factorial, mut n) = ([0.0; 8], 1.0, 1);
    while n < first + 16 {
        factorial *= n as f64;
        if n >= first && (n - first) % 2 == 0 {
            all[(n - first) as usize / 2] = if (n - first) % 4 == 0 { 1.0 } else { -1.0 } / factorial;
        }
        n += 1;
    }
    all
}

/// For the value of an `f32`, to its precision.
#[op]
fn single(x: f64) -> (f64, f64) {
    let (exponent, mantissa) = ((x.to_bits() >> 52) as usize, (x.to_bits() << 11 | 1 << 63) >> 40);
    // Without the sign.
    let first = (exponent + 62 - 1046) % 256;
    let word = |i: usize| {
        TWO_OVER_PI[first / 64 + i] << (first % 64) | TWO_OVER_PI[first / 64 + i + 1] >> 1 >> (63 - first % 64)
    };
    // A turn is 2^64. No number is nearer than 2^32 to a multiple of a quarter.
    let turns = word(0).wrapping_mul(mantissa).wrapping_add(((word(1) >> 24) * mantissa) >> 40);
    let sin = |turns: u64, sign: u64| {
        // Within a quarter of a turn, and with the same sine.
        let r = ((turns << 1) as i64 ^ (turns ^ turns << 1 ^ sign) as i64 >> 63) as f64 * (PI / (1u128 << 64) as f64);
        let (z, c) = (r * r, const { taylor(3) });
        let zz = z * z;
        r - r * z * (c[0] + z * c[1] + zz * (c[2] + z * c[3]) + zz * zz * (c[4] + z * c[5] + zz * c[6]))
    };
    (sin(turns, x.to_bits()), sin(turns.wrapping_add(1 << 62), 0))
}

// All results are NaN for `|x| <= 1`.
#[op]
pub fn sin_cos<T>(x: f64) -> (f64, f64) {
    if !(x.abs() > 1.0 && x.is_finite()) {
        return (f64::NAN, f64::NAN);
    }
    if size_of::<T>() == 4 {
        return single(x);
    }
    let (quarters, r) = reduce(x);
    let z = r * r;
    let series = |c: [f64; 8]| {
        let zz = z * z;
        z * (c[0] + z * (c[1] + z * (c[2] + z * c[3] + zz * (c[4] + z * c[5] + zz * (c[6] + z * c[7])))))
    };
    let (sin, cos) = (r - r * series(const { taylor(3) }), 1.0 - series(const { taylor(2) }));
    let (sin, cos) = core::hint::select_unpredictable(quarters & 1 == 0, (sin, cos), (cos, sin));
    let flipped = |it: f64, by: u32| f64::from_bits(it.to_bits() ^ (by as u64) >> 1 << 63);
    (flipped(sin, quarters ^ (2 * (x < 0.0) as u32)), flipped(cos, quarters + 1))
}

pub fn sin<T>(x: f64) -> f64 {
    sin_cos::<T>(x).0
}
pub fn cos<T>(x: f64) -> f64 {
    sin_cos::<T>(x).1
}
pub fn tan<T>(x: f64) -> f64 {
    let (sin, cos) = sin_cos::<T>(x);
    sin / cos
}

#[cfg(test)]
#[test]
#[cfg_attr(
    any(all(windows, target_env = "gnu"), all(target_vendor = "apple", target_arch = "x86_64")),
    ignore = "needs another C library"
)]
fn like_std() {
    let (sin, cos, tan) = (sin::<f64>, cos::<f64>, tan::<f64>);
    // The worst case for the reduction.
    assert_eq!(cos(6381956970095103.0 * 2f64.powi(797)), -4.687165924254628e-19);
    let mut bits = 1u64;
    for i in 0..200_000u64 {
        bits = bits.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let x = f64::from_bits(bits >> 12 | (1024 + i % 1023) << 52);
        for (got, want) in [(sin(x), x.sin()), (cos(-x), x.cos()), (tan(-x), -x.tan())] {
            assert!(got.to_bits().abs_diff(want.to_bits()) <= 3, "{x:e}: {got:e} {want:e}");
        }
    }
}

#[cfg(test)]
#[test]
#[cfg_attr(miri, ignore)]
fn single_like_double() {
    for bits in [0x6f79_be45, 0x7f7f_ffff].into_iter().chain((0x3f80_0001..0x7f80_0000).step_by(10_007)) {
        for x in [f32::from_bits(bits) as f64, -f32::from_bits(bits) as f64] {
            let (got, want) = (sin_cos::<f32>(x), sin_cos::<f64>(x));
            assert!((got.0 / want.0 - 1.0).abs() < 1e-10 && (got.1 / want.1 - 1.0).abs() < 1e-10, "{x:e}");
        }
    }
}
