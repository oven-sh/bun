//! PNG decode/encode for `Bun.Image`, on `bun_png`. Indexed-PNG encode quantises via
//! `quantize.rs`. Dispatch lives in codecs.rs; this file is the codec body.

use super::codecs;
use super::quantize;

fn decode_error(error: bun_png::Error) -> codecs::Error {
    match error {
        bun_png::Error::Alloc(_) => codecs::Error::OutOfMemory,
        // As `metadata()` calls it, which does not come here. Such a row alone has more pixels than the default limit.
        bun_png::Error::ImageTooLarge => codecs::Error::TooManyPixels,
        _ => codecs::Error::DecodeFailed,
    }
}

fn encode_error(error: bun_png::Error) -> codecs::Error {
    match error {
        bun_png::Error::Alloc(_) => codecs::Error::OutOfMemory,
        _ => codecs::Error::EncodeFailed,
    }
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let decoder = bun_png::Decoder::new(bytes).map_err(decode_error)?;
    let bun_png::Header { width, height, .. } = decoder.header();
    codecs::guard(width, height, max_pixels)?;
    let image = decoder.decode().map_err(decode_error)?;
    Ok(codecs::Decoded {
        rgba: image.rgba,
        width,
        height,
        icc_profile: image.icc_profile,
    })
}

pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    level: i8,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    bun_png::encode(rgba, w, h, None, level, icc_profile)
        .map(codecs::Encoded::from_owned)
        .map_err(encode_error)
}

/// Quantize RGBA to ≤ `colors` and emit an indexed (colour-type 3) PNG
/// with PLTE + tRNS. The quantizer is a small median-cut — see
/// quantize.rs. `icc_profile` carries the source colour space; median
/// cut operates on the raw RGB numbers without converting colour spaces,
/// so the palette entries are still in that space and need the profile
/// to be interpreted correctly — same contract as truecolour encode.
pub(crate) fn encode_indexed(
    rgba: &[u8],
    w: u32,
    h: u32,
    level: i8,
    colors: u16,
    dither: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let q = quantize::quantize(
        rgba,
        w,
        h,
        quantize::Options {
            max_colors: colors,
            dither,
        },
    )
    .map_err(|_| codecs::Error::OutOfMemory)?;
    let palette = bun_png::Palette {
        colors: q.palette.as_chunks().0,
        has_alpha: q.has_alpha,
    };
    bun_png::encode(&q.indices, w, h, Some(&palette), level, icc_profile)
        .map(codecs::Encoded::from_owned)
        .map_err(encode_error)
}
