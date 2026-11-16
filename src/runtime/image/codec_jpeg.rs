//! JPEG decode/encode for `Bun.Image`, on `bun_jpeg`. Dispatch lives in codecs.rs; this file is the codec body.

use super::codecs;

fn decode_error(error: bun_jpeg::Error) -> codecs::Error {
    debug_assert_ne!(error, bun_jpeg::Error::Internal);
    match error {
        bun_jpeg::Error::Alloc(_) => codecs::Error::OutOfMemory,
        _ => codecs::Error::DecodeFailed,
    }
}

fn encode_error(error: bun_jpeg::Error) -> codecs::Error {
    debug_assert_ne!(error, bun_jpeg::Error::Internal);
    match error {
        bun_jpeg::Error::Alloc(_) => codecs::Error::OutOfMemory,
        _ => codecs::Error::EncodeFailed,
    }
}

pub(crate) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), codecs::Error> {
    let header = bun_jpeg::Decoder::new(bytes)
        .map_err(decode_error)?
        .header();
    Ok((header.width, header.height))
}

/// The scale with the fewest pixels that is still no smaller than the target. The resize pass goes the rest of the way.
fn eighths(width: u32, height: u32, hint: codecs::DecodeHint) -> u8 {
    if hint.target_w == 0 || hint.target_h == 0 {
        return 8;
    }
    let scaled = |eighths: u8| [width, height].map(|size| (size * u32::from(eighths)).div_ceil(8));
    // Backwards, for the largest of the scales that give the same size.
    (1..=8)
        .rev()
        .filter(|&eighths| {
            let [w, h] = scaled(eighths);
            w >= hint.target_w && h >= hint.target_h
        })
        .min_by_key(|&eighths| scaled(eighths))
        .unwrap_or(8)
}

pub(crate) fn decode(
    bytes: &[u8],
    max_pixels: u64,
    hint: codecs::DecodeHint,
) -> Result<codecs::Decoded, codecs::Error> {
    let decoder = bun_jpeg::Decoder::new(bytes).map_err(decode_error)?;
    let bun_jpeg::Header { width, height } = decoder.header();
    codecs::guard(width, height, max_pixels)?;
    let image = decoder
        .decode(eighths(width, height, hint))
        .map_err(decode_error)?;
    Ok(codecs::Decoded {
        rgba: image.rgba,
        width: image.width,
        height: image.height,
        icc_profile: image.icc_profile,
    })
}

pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    quality: u8,
    progressive: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    bun_jpeg::encode(rgba, w, h, quality, progressive, icc_profile)
        .map(codecs::Encoded::from_owned)
        .map_err(encode_error)
}
