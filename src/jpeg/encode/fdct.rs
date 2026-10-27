//! The forward DCT and quantization (jcdctmgr.c, jfdctint.c).

use super::Block;
use crate::lanes::{I16x8, add16, add32, descale, madd, sub16, transpose, zip};
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

/// pmulhuw
#[inline(always)]
fn mul_high(a: [u16; 8], b: [u16; 8]) -> [u16; 8] {
    zip(a, b, |a, b| ((u32::from(a) * u32::from(b)) >> 16) as u16)
}

/// One dimension of the transform, along the first index and for eight lanes at once. With samples of 8 bits nothing here
/// overflows.
#[inline(always)]
fn pass<const FIRST: bool>([d0, d1, d2, d3, d4, d5, d6, d7]: [I16x8; 8]) -> [I16x8; 8] {
    let shift = if FIRST {
        CONST_BITS - PASS1_BITS
    } else {
        CONST_BITS + PASS1_BITS
    };

    let (tmp0, tmp7) = (add16(d0, d7), sub16(d0, d7));
    let (tmp1, tmp6) = (add16(d1, d6), sub16(d1, d6));
    let (tmp2, tmp5) = (add16(d2, d5), sub16(d2, d5));
    let (tmp3, tmp4) = (add16(d3, d4), sub16(d3, d4));

    let (tmp10, tmp13) = (add16(tmp0, tmp3), sub16(tmp0, tmp3));
    let (tmp11, tmp12) = (add16(tmp1, tmp2), sub16(tmp1, tmp2));

    let rescale = |v: I16x8| {
        if FIRST {
            v.map(|v| v << PASS1_BITS)
        } else {
            v.map(|v| v.wrapping_add(1 << (PASS1_BITS - 1)) >> PASS1_BITS)
        }
    };
    let out0 = rescale(add16(tmp10, tmp11));
    let out4 = rescale(sub16(tmp10, tmp11));
    let out2 = descale(madd(tmp13, F_0_541 + F_0_765, tmp12, F_0_541), shift);
    let out6 = descale(madd(tmp13, F_0_541, tmp12, F_0_541 - F_1_847), shift);

    let z3 = add16(tmp4, tmp6);
    let z4 = add16(tmp5, tmp7);
    let (z3, z4) = (
        madd(z3, F_1_175 - F_1_961, z4, F_1_175),
        madd(z3, F_1_175, z4, F_1_175 - F_0_390),
    );
    let out7 = descale(
        add32(madd(tmp4, F_0_298 - F_0_899, tmp7, -F_0_899), z3),
        shift,
    );
    let out1 = descale(
        add32(madd(tmp4, -F_0_899, tmp7, F_1_501 - F_0_899), z4),
        shift,
    );
    let out5 = descale(
        add32(madd(tmp5, F_2_053 - F_2_562, tmp6, -F_2_562), z4),
        shift,
    );
    let out3 = descale(
        add32(madd(tmp5, -F_2_562, tmp6, F_3_072 - F_2_562), z3),
        shift,
    );

    [out0, out1, out2, out3, out4, out5, out6, out7]
}

/// The quantized coefficients of 8 rows of 8 samples, in zigzag order.
#[inline]
pub(crate) fn forward(samples: &[[u8; 8]; 8], divisors: &Divisors) -> Block {
    let centered = samples.map(|row| row.map(|s| i16::from(s) - 128));
    // Rows first: the two passes round differently.
    let coefs = pass::<false>(transpose(&pass::<true>(transpose(&centered))));

    let mut quantized = [[0i16; 8]; 8];
    for ((((out, coefs), &reciprocal), &correction), &scale) in quantized
        .iter_mut()
        .zip(coefs)
        .zip(&divisors.reciprocal)
        .zip(&divisors.correction)
        .zip(&divisors.scale)
    {
        let magnitude = zip(coefs.map(i16::unsigned_abs), correction, u16::wrapping_add);
        let quotient = mul_high(mul_high(magnitude, reciprocal), scale);
        *out = zip(coefs, quotient, |coef, q| {
            if coef < 0 { -(q as i16) } else { q as i16 }
        });
    }

    let quantized = quantized.as_flattened();
    let mut block = [0i16; 64];
    for (out, &position) in block.iter_mut().zip(&NATURAL_ORDER) {
        *out = quantized.get(usize::from(position)).copied().unwrap_or(0);
    }
    block
}
