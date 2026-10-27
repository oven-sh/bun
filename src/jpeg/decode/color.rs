//! From the components of the stream to pixels (jdcolor.c, jdcolext.c).

const SCALEBITS: u32 = 16;
const ONE_HALF: i32 = 1 << (SCALEBITS - 1);

const fn fix(x: f64) -> i32 {
    (x * (1 << SCALEBITS) as f64 + 0.5) as i32
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Conversion {
    GrayToRgba,
    RgbToRgba,
    YccToRgba,
    /// CMYK as it is.
    Cmyk,
    YcckToCmyk,
}

#[inline(always)]
fn ycc_to_rgb(y: u8, cb: u8, cr: u8) -> [u8; 3] {
    let y = i32::from(y);
    let cb = i32::from(cb) - 128;
    let cr = i32::from(cr) - 128;
    let r = y + ((fix(1.40200) * cr + ONE_HALF) >> SCALEBITS);
    let g = y + ((-fix(0.34414) * cb + ONE_HALF - fix(0.71414) * cr) >> SCALEBITS);
    let b = y + ((fix(1.77200) * cb + ONE_HALF) >> SCALEBITS);
    [r, g, b].map(|v| v.clamp(0, 255) as u8)
}

/// Converts one row. `planes` has a row of each component, and `output` 4 bytes for each pixel.
pub(crate) fn convert(conversion: Conversion, planes: [&[u8]; 4], output: &mut [u8]) {
    let (pixels, _) = output.as_chunks_mut::<4>();
    let [p0, p1, p2, p3] = planes;
    match conversion {
        Conversion::GrayToRgba => {
            for (pixel, &v) in pixels.iter_mut().zip(p0) {
                *pixel = [v, v, v, 255];
            }
        }
        Conversion::RgbToRgba => {
            for (((pixel, &r), &g), &b) in pixels.iter_mut().zip(p0).zip(p1).zip(p2) {
                *pixel = [r, g, b, 255];
            }
        }
        Conversion::YccToRgba => {
            for (((pixel, &y), &cb), &cr) in pixels.iter_mut().zip(p0).zip(p1).zip(p2) {
                let [r, g, b] = ycc_to_rgb(y, cb, cr);
                *pixel = [r, g, b, 255];
            }
        }
        Conversion::Cmyk => {
            for ((((pixel, &c), &m), &y), &k) in pixels.iter_mut().zip(p0).zip(p1).zip(p2).zip(p3) {
                *pixel = [c, m, y, k];
            }
        }
        Conversion::YcckToCmyk => {
            for ((((pixel, &y), &cb), &cr), &k) in pixels.iter_mut().zip(p0).zip(p1).zip(p2).zip(p3)
            {
                let [r, g, b] = ycc_to_rgb(y, cb, cr);
                *pixel = [255 - r, 255 - g, 255 - b, k];
            }
        }
    }
}
