//! From the components of the stream to pixels (jdcolor.c, jdcolext.c).

use crate::error::{Error, Result};
use crate::tables::color::{ONE_HALF, fix};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Conversion {
    GrayToRgba,
    RgbToRgba,
    YccToRgba,
    /// CMYK as it is.
    Cmyk,
    YcckToCmyk,
}

/// `(a * b) >> 16`, which is one instruction (pmulhw).
#[inline(always)]
fn mul_high(a: i16, b: i16) -> i16 {
    ((i32::from(a) * i32::from(b)) >> 16) as i16
}

/// What jdcolor.c's tables hold, in 16 bits throughout, which lets the compiler put 8 pixels in a vector. The whole part
/// of a factor is added apart from its fraction, and a fraction is rounded by computing one more bit of the product.
#[inline(always)]
fn ycc_to_rgb(y: u8, cb: u8, cr: u8) -> [u8; 3] {
    const F_0_402: i16 = (fix(1.40200) - fix(1.0)) as i16;
    const MF_0_228: i16 = (fix(1.77200) - fix(2.0)) as i16;
    const MF_0_344: i16 = -fix(0.34414) as i16;
    const F_0_285: i16 = (fix(1.0) - fix(0.71414)) as i16;

    let y = i16::from(y);
    let cb = i16::from(cb) - 128;
    let cr = i16::from(cr) - 128;
    let r = y + cr + ((mul_high(2 * cr, F_0_402) + 1) >> 1);
    let b = y + 2 * cb + ((mul_high(2 * cb, MF_0_228) + 1) >> 1);
    // `(MF_0_344 * cb + F_0_285 * cr + ONE_HALF) >> SCALEBITS`: the high halves of the products, and what the sum of
    // their low halves and `ONE_HALF` carries.
    let low = cb.wrapping_mul(MF_0_344) as u16;
    let low_sum = low.wrapping_add(cr.wrapping_mul(F_0_285) as u16);
    let rounded = low_sum.wrapping_add(ONE_HALF as u16);
    let carry = i16::from(low_sum < low) + i16::from(rounded < low_sum);
    let g = y - cr + mul_high(cb, MF_0_344) + mul_high(cr, F_0_285) + carry;
    [r, g, b].map(|v| v.clamp(0, 255) as u8)
}

/// Pixels at a time in `pixels_from`.
const CHUNK: usize = 16;

/// Appends `pixel(p0[i], p1[i], p2[i], p3[i])` for every `i`.
///
/// The two halves of a pixel are put together apart from the arithmetic: with a number of 32 bits in the same loop the
/// compiler would only use half of each vector for the rest.
#[inline(always)]
fn pixels_from(
    planes: [&[u8]; 4],
    output: &mut Vec<[u8; 4]>,
    pixel: impl Fn(u8, u8, u8, u8) -> [u8; 4],
) {
    let [(c0, r0), (c1, r1), (c2, r2), (c3, r3)] = planes.map(|plane| plane.as_chunks::<CHUNK>());
    for (((c0, c1), c2), c3) in c0.iter().zip(c1).zip(c2).zip(c3) {
        let (mut low, mut high) = ([0u16; CHUNK], [0u16; CHUNK]);
        for (((((low, high), &v0), &v1), &v2), &v3) in low
            .iter_mut()
            .zip(&mut high)
            .zip(c0)
            .zip(c1)
            .zip(c2)
            .zip(c3)
        {
            let [b0, b1, b2, b3] = pixel(v0, v1, v2, v3);
            *low = u16::from_le_bytes([b0, b1]);
            *high = u16::from_le_bytes([b2, b3]);
        }
        let mut pixels = [[0u8; 4]; CHUNK];
        for ((out, low), high) in pixels.iter_mut().zip(low).zip(high) {
            *out = (u32::from(low) | u32::from(high) << 16).to_le_bytes();
        }
        output.extend_from_slice(&pixels);
    }
    let rest = r0.iter().zip(r1).zip(r2).zip(r3);
    output.extend(rest.map(|(((&v0, &v1), &v2), &v3)| pixel(v0, v1, v2, v3)));
}

/// Converts one row of `width` pixels and appends it to `output`, which has room for it. `planes` has a row of each
/// component.
pub(crate) fn convert(
    conversion: Conversion,
    planes: [&[u8]; 4],
    width: usize,
    output: &mut Vec<[u8; 4]>,
) -> Result<()> {
    let [p0, p1, p2, p3] = planes.map(|row| row.get(..width).unwrap_or(row));
    let end = output.len() + width;
    match conversion {
        Conversion::GrayToRgba => output.extend(p0.iter().map(|&v| [v, v, v, 255])),
        Conversion::RgbToRgba => {
            output.extend(
                p0.iter()
                    .zip(p1)
                    .zip(p2)
                    .map(|((&r, &g), &b)| [r, g, b, 255]),
            );
        }
        Conversion::YccToRgba => pixels_from([p0, p1, p2, p2], output, |y, cb, cr, _| {
            let [r, g, b] = ycc_to_rgb(y, cb, cr);
            [r, g, b, 255]
        }),
        Conversion::Cmyk => {
            let rows = p0.iter().zip(p1).zip(p2).zip(p3);
            output.extend(rows.map(|(((&c, &m), &y), &k)| [c, m, y, k]));
        }
        Conversion::YcckToCmyk => pixels_from([p0, p1, p2, p3], output, |y, cb, cr, k| {
            let [r, g, b] = ycc_to_rgb(y, cb, cr);
            [255 - r, 255 - g, 255 - b, k]
        }),
    }
    if output.len() != end {
        return Err(Error::Internal);
    }
    Ok(())
}
