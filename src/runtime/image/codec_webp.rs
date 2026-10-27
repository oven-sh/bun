//! WebP decode/encode for `Bun.Image`, on `bun_webp`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use super::codecs;

/// `failed` is what every error but running out of memory becomes.
fn convert(error: bun_webp::Error, failed: codecs::Error) -> codecs::Error {
    debug_assert_ne!(error, bun_webp::Error::Bug);
    match error {
        bun_webp::Error::Alloc(_) => codecs::Error::OutOfMemory,
        _ => failed,
    }
}

fn check<T>(result: bun_webp::Result<T>, failed: codecs::Error) -> Result<T, codecs::Error> {
    result.map_err(|error| convert(error, failed))
}

/// The width and the height, from the headers alone.
pub(crate) fn probe(bytes: &[u8]) -> Result<bun_webp::Info, codecs::Error> {
    check(bun_webp::get_info(bytes), codecs::Error::DecodeFailed)
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    // Header-only probe first so the pixel guard fires before anything is allocated.
    let bun_webp::Info {
        width: w,
        height: h,
    } = probe(bytes)?;
    codecs::guard(w, h, max_pixels)?;
    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still WRITE
    // (the pin only blocks detach), so the decoder can see a different image
    // than the probe did. It fails if that image is bigger than `out`.
    // If it's smaller, the rest of `out` is zero.
    let stride: usize = (w as usize) * 4;
    let mut out: Vec<u8> = vec![0; stride * (h as usize)];
    check(
        bun_webp::decode_rgba_into(bytes, &mut out, stride),
        codecs::Error::DecodeFailed,
    )?;

    // The pixels may be Display P3 / Adobe RGB / XYB, where "no profile"
    // reinterprets them as sRGB and visibly shifts colour (#30197). A malformed
    // container has no profile; the pixels decoded fine so the image is still usable.
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
    let bytes = bun_webp::encode_rgba(rgba, w, h, (w as usize) * 4, compression, icc_profile);
    check(bytes, codecs::Error::EncodeFailed).map(codecs::Encoded::from_owned)
}
