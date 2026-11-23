//! WebP decode/encode for `Bun.Image`, on `bun_webp`. Dispatch lives in codecs.rs; this file is the codec body.

use super::codecs;

fn decode_error(error: bun_webp::Error) -> codecs::Error {
    match error {
        bun_webp::Error::Alloc(_) => codecs::Error::OutOfMemory,
        _ => codecs::Error::DecodeFailed,
    }
}

fn encode_error(error: bun_webp::Error) -> codecs::Error {
    match error {
        bun_webp::Error::Alloc(_) => codecs::Error::OutOfMemory,
        _ => codecs::Error::EncodeFailed,
    }
}

pub(crate) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), codecs::Error> {
    let decoder = bun_webp::Decoder::new(bytes).map_err(decode_error)?;
    Ok((decoder.width(), decoder.height()))
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let decoder = bun_webp::Decoder::new(bytes).map_err(decode_error)?;
    let (width, height) = (decoder.width(), decoder.height());
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
    quality: u8,
    lossless: bool,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>, codecs::Error> {
    let compression = if lossless {
        bun_webp::Compression::Lossless
    } else {
        bun_webp::Compression::Lossy { quality }
    };
    bun_webp::encode(rgba, w, h, compression, icc_profile).map_err(encode_error)
}
