//! The forward DCT and quantization (jcdctmgr.c, jfdctint.c).

use super::Block;
use crate::lanes::{column, descale, from_columns, transpose};
use crate::tables::NATURAL_ORDER;
use crate::tables::dct::*;

/// Division by the steps of a quantization table, done as multiplication. In row-major order.
pub(crate) struct Divisors {
    reciprocal: [[u16; 8]; 8],
    /// Half of the divisor, to round to nearest, and a correction for the error of the reciprocal.
    correction: [[u16; 8]; 8],
    /// A power of two: multiplying by it and taking the upper half shifts right.
    scale: [[u16; 8]; 8],
}

impl Divisors {
    /// `quant` is in row-major order, each step from 1 to 255.
    pub(crate) fn new(quant: &[u16; 64]) -> Self {
        let mut divisors = Divisors {
            reciprocal: [[0; 8]; 8],
            correction: [[0; 8]; 8],
            scale: [[0; 8]; 8],
        };
        for (((&step, reciprocal), correction), scale) in quant
            .iter()
            .zip(divisors.reciprocal.as_flattened_mut())
            .zip(divisors.correction.as_flattened_mut())
            .zip(divisors.scale.as_flattened_mut())
        {
            // The DCT leaves its results scaled up by 8.
            let divisor = u32::from(step.max(1)) << 3;
            let mut r = 16 + divisor.ilog2();
            let mut fq = (1u32 << r) / divisor;
            let fr = (1u32 << r) % divisor;
            let mut c = divisor / 2;
            if fr == 0 {
                fq >>= 1;
                r -= 1;
            } else if fr <= divisor / 2 {
                c += 1;
            } else {
                fq += 1;
            }
            *reciprocal = fq as u16;
            *correction = c as u16;
            *scale = (1u32 << (32 - r)) as u16;
        }
        divisors
    }
}

/// One dimension of the transform. With samples of 8 bits nothing here overflows.
#[inline(always)]
fn fdct8<const FIRST: bool>([d0, d1, d2, d3, d4, d5, d6, d7]: [i16; 8]) -> [i16; 8] {
    let shift = if FIRST {
        CONST_BITS - PASS1_BITS
    } else {
        CONST_BITS + PASS1_BITS
    };
    let madd = |a: i16, ca: i32, b: i16, cb: i32| i32::from(a) * ca + i32::from(b) * cb;
    let rounded = |sum: i32| descale(sum + (1 << (shift - 1)), shift);

    let (tmp0, tmp7) = (d0 + d7, d0 - d7);
    let (tmp1, tmp6) = (d1 + d6, d1 - d6);
    let (tmp2, tmp5) = (d2 + d5, d2 - d5);
    let (tmp3, tmp4) = (d3 + d4, d3 - d4);

    let (tmp10, tmp13) = (tmp0 + tmp3, tmp0 - tmp3);
    let (tmp11, tmp12) = (tmp1 + tmp2, tmp1 - tmp2);

    let rescale = |v: i16| {
        if FIRST {
            v << PASS1_BITS
        } else {
            // -32768 is the sum of 64 samples of 0.
            v.wrapping_add(1 << (PASS1_BITS - 1)) >> PASS1_BITS
        }
    };
    let z3 = tmp4 + tmp6;
    let z4 = tmp5 + tmp7;
    let (z3, z4) = (
        madd(z3, F_1_175 - F_1_961, z4, F_1_175),
        madd(z3, F_1_175, z4, F_1_175 - F_0_390),
    );

    [
        rescale(tmp10.wrapping_add(tmp11)),
        rounded(madd(tmp4, -F_0_899, tmp7, F_1_501 - F_0_899) + z4),
        rounded(madd(tmp13, F_0_541 + F_0_765, tmp12, F_0_541)),
        rounded(madd(tmp5, -F_2_562, tmp6, F_3_072 - F_2_562) + z3),
        rescale(tmp10 - tmp11),
        rounded(madd(tmp5, F_2_053 - F_2_562, tmp6, -F_2_562) + z4),
        rounded(madd(tmp13, F_0_541, tmp12, F_0_541 - F_1_847)),
        rounded(madd(tmp4, F_0_298 - F_0_899, tmp7, -F_0_899) + z3),
    ]
}

/// Each column of `samples` is a row of the block, and so it is with the result.
#[inline(never)]
fn rows_pass(samples: &[[u8; 8]; 8]) -> [[i16; 8]; 8] {
    from_columns(|lane| fdct8::<true>(column(samples, lane).map(|s| i16::from(s) - 128)))
}

#[inline(never)]
fn columns_pass(data: &[[i16; 8]; 8]) -> [[i16; 8]; 8] {
    from_columns(|lane| fdct8::<false>(column(data, lane)))
}

#[inline(never)]
fn quantize(coefs: &[[i16; 8]; 8], divisors: &Divisors) -> [[i16; 8]; 8] {
    // pmulhuw
    let mul_high = |a: u16, b: u16| ((u32::from(a) * u32::from(b)) >> 16) as u16;
    let mut out = [[0i16; 8]; 8];
    for ((((out, &coef), &reciprocal), &correction), &scale) in out
        .as_flattened_mut()
        .iter_mut()
        .zip(coefs.as_flattened())
        .zip(divisors.reciprocal.as_flattened())
        .zip(divisors.correction.as_flattened())
        .zip(divisors.scale.as_flattened())
    {
        let magnitude = coef.unsigned_abs() + correction;
        let quotient = mul_high(mul_high(magnitude, reciprocal), scale) as i16;
        *out = if coef < 0 { -quotient } else { quotient };
    }
    out
}

/// The quantized coefficients of 8 rows of 8 samples, in zigzag order.
#[inline]
pub(crate) fn forward(samples: &[[u8; 8]; 8], divisors: &Divisors) -> Block {
    // Rows first: the two passes round differently.
    let coefs = columns_pass(&transpose(&rows_pass(&transpose(samples))));
    let quantized = quantize(&coefs, divisors);

    let quantized = quantized.as_flattened();
    let mut block = [0i16; 64];
    for (out, &position) in block.iter_mut().zip(&NATURAL_ORDER) {
        *out = quantized.get(usize::from(position)).copied().unwrap_or(0);
    }
    block
}
