//! From the components of the stream to pixels (jdcolor.c, jdcolext.c).

use crate::tables::color::{ONE_HALF, SCALEBITS, fix};

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

/// In 16 bits wherever that gives what jdcolor.c's tables hold, as in libjpeg-turbo's SIMD: the whole part of a factor is
/// added apart from its fraction, and a fraction is rounded by computing one more bit of the product.
#[inline(always)]
fn ycc_to_rgb(y: u8, cb: u8, cr: u8) -> [u8; 3] {
    const F_0_402: i16 = (fix(1.40200) - fix(1.0)) as i16;
    const MF_0_228: i16 = (fix(1.77200) - fix(2.0)) as i16;
    const F_0_285: i32 = fix(1.0) - fix(0.71414);

    let y = i16::from(y);
    let cb = i16::from(cb) - 128;
    let cr = i16::from(cr) - 128;
    let r = y + cr + ((mul_high(2 * cr, F_0_402) + 1) >> 1);
    let b = y + 2 * cb + ((mul_high(2 * cb, MF_0_228) + 1) >> 1);
    let g = -fix(0.34414) * i32::from(cb) + F_0_285 * i32::from(cr) + ONE_HALF;
    let g = y - cr + (g >> SCALEBITS) as i16;
    [r, g, b].map(|v| v.clamp(0, 255) as u8)
}

/// Converts one row of `width` pixels and appends it to `output`, which has room for it. `planes` has a row of each
/// component.
pub(crate) fn convert(
    conversion: Conversion,
    planes: [&[u8]; 4],
    width: usize,
    output: &mut Vec<[u8; 4]>,
) {
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
        Conversion::YccToRgba => {
            output.extend(p0.iter().zip(p1).zip(p2).map(|((&y, &cb), &cr)| {
                let [r, g, b] = ycc_to_rgb(y, cb, cr);
                [r, g, b, 255]
            }));
        }
        Conversion::Cmyk => {
            let rows = p0.iter().zip(p1).zip(p2).zip(p3);
            output.extend(rows.map(|(((&c, &m), &y), &k)| [c, m, y, k]));
        }
        Conversion::YcckToCmyk => {
            let rows = p0.iter().zip(p1).zip(p2).zip(p3);
            output.extend(rows.map(|(((&y, &cb), &cr), &k)| {
                let [r, g, b] = ycc_to_rgb(y, cb, cr);
                [255 - r, 255 - g, 255 - b, k]
            }));
        }
    }
    output.resize(end, [0; 4]);
}
