//! WebP decode/encode for `Bun.Image`, on `bun_webp`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use super::codecs;

/// `failed` is what every error but running out of memory becomes.
fn convert(failed: codecs::Error) -> impl FnOnce(bun_webp::Error) -> codecs::Error {
    move |error| {
        debug_assert_ne!(error, bun_webp::Error::Bug);
        match error {
            bun_webp::Error::Alloc(_) => codecs::Error::OutOfMemory,
            _ => failed,
        }
    }
}

/// The width and the height, from the headers alone.
pub(crate) fn probe(bytes: &[u8]) -> Result<(u32, u32), codecs::Error> {
    let info = bun_webp::get_info(bytes).map_err(convert(codecs::Error::DecodeFailed))?;
    Ok((info.width, info.height))
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    // Header-only probe first so the pixel guard fires before anything is allocated.
    let (w, h) = probe(bytes)?;
    codecs::guard(w, h, max_pixels)?;
    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still WRITE
    // (the pin only blocks detach), so the decoder can see a different image
    // than the probe did. It fails if that image is bigger than `out`.
    // If it's smaller, the rest of `out` is zero.
    let stride: usize = (w as usize) * 4;
    let mut out: Vec<u8> = vec![0; stride * (h as usize)];
    bun_webp::decode_rgba_into(bytes, &mut out, stride)
        .map_err(convert(codecs::Error::DecodeFailed))?;

    // Without its profile a Display P3 or Adobe RGB image is read as sRGB (#30197). A malformed container has none.
    let icc = bun_webp::icc_profile(bytes).map(<[u8]>::to_vec);
    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile: icc,
    })
}

pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    quality: u8,
    lossless: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let compression = if lossless {
        bun_webp::Compression::Lossless
    } else {
        bun_webp::Compression::Lossy {
            quality: f32::from(quality),
        }
    };
    bun_webp::encode_rgba(rgba, w, h, (w as usize) * 4, compression, icc_profile)
        .map(codecs::Encoded::from_owned)
        .map_err(convert(codecs::Error::EncodeFailed))
}
