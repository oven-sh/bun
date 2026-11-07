//! From the components of the stream to pixels (jdcolor.c, jdcolext.c).

use crate::error::{Error, Result};
use crate::tables::color::{ONE_HALF, SCALEBITS, fix};

#[derive(Clone, Copy)]
pub(crate) enum Conversion {
    GrayToRgba,
    RgbToRgba,
    YccToRgba,
    /// CMYK as it is.
    Cmyk,
    YcckToCmyk,
}

/// What jdcolor.c's tables hold.
fn ycc_to_rgb(y: u8, cb: u8, cr: u8) -> [u8; 3] {
    let [y, cb, cr] = [i32::from(y), i32::from(cb) - 128, i32::from(cr) - 128];
    let r = y + ((fix(1.40200) * cr + ONE_HALF) >> SCALEBITS);
    let g = y + ((-fix(0.34414) * cb - fix(0.71414) * cr + ONE_HALF) >> SCALEBITS);
    let b = y + ((fix(1.77200) * cb + ONE_HALF) >> SCALEBITS);
    [r, g, b].map(|v| v.clamp(0, 255) as u8)
}

/// Appends a row of `width` pixels to `output`, which has room for it. `planes` has a row of each component.
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
        Conversion::YccToRgba => {
            if !bun_highway::jpeg::from_ycc(p0, p1, p2, None, output) {
                output.extend(p0.iter().zip(p1).zip(p2).map(|((&y, &cb), &cr)| {
                    let [r, g, b] = ycc_to_rgb(y, cb, cr);
                    [r, g, b, 255]
                }));
            }
        }
        Conversion::Cmyk => {
            let rows = p0.iter().zip(p1).zip(p2).zip(p3);
            output.extend(rows.map(|(((&c, &m), &y), &k)| [c, m, y, k]));
        }
        Conversion::YcckToCmyk => {
            if !bun_highway::jpeg::from_ycc(p0, p1, p2, Some(p3), output) {
                let rows = p0.iter().zip(p1).zip(p2).zip(p3);
                output.extend(rows.map(|(((&y, &cb), &cr), &k)| {
                    let [r, g, b] = ycc_to_rgb(y, cb, cr);
                    [255 - r, 255 - g, 255 - b, k]
                }));
            }
        }
    }
    if output.len() != end {
        return Err(Error::Internal);
    }
    Ok(())
}
