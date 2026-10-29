//! JPEG for `Bun.Image` on `bun_jpeg`: the scale, the limits and the ICC profile. Dispatch lives in codecs.rs.

use bun_jpeg::{ColorSpace, DecodeOptions, Decoder, EncodeOptions};

use super::codecs;

fn convert_error(err: bun_jpeg::Error, otherwise: codecs::Error) -> codecs::Error {
    debug_assert!(err != bun_jpeg::Error::Internal);
    match err {
        bun_jpeg::Error::Alloc(oom) => oom.into(),
        _ => otherwise,
    }
}

fn decode_error(err: bun_jpeg::Error) -> codecs::Error {
    convert_error(err, codecs::Error::DecodeFailed)
}

/// SOF dimensions. Reads up to the first scan and none of its data.
pub(crate) fn probe(bytes: &[u8]) -> Result<(u32, u32), codecs::Error> {
    let decoder = Decoder::new(bytes).map_err(decode_error)?;
    Ok((decoder.width(), decoder.height()))
}

pub(crate) fn decode(
    bytes: &[u8],
    max_pixels: u64,
    hint: codecs::DecodeHint,
) -> Result<codecs::Decoded, codecs::Error> {
    let decoder = Decoder::new(bytes).map_err(decode_error)?;
    let (src_w, src_h) = (decoder.width(), decoder.height());
    codecs::guard(src_w, src_h, max_pixels)?;
    // TurboJPEG's limit, an `int`, however high `max_pixels` is set.
    if u64::from(src_w) * u64::from(src_h) > i32::MAX as u64 {
        return Err(codecs::Error::DecodeFailed);
    }
    // 4-component JPEGs decode as packed CMYK (also 4 bytes/px) and are converted below.
    let cmyk = matches!(decoder.color_space(), ColorSpace::Cmyk | ColorSpace::Ycck);

    // DCT-domain scaling: the smallest M/8 still ≥ target. Less IDCT work, a smaller RGBA buffer; resize does the rest.
    let mut eighths = 8;
    if hint.target_w != 0
        && hint.target_h != 0
        && (hint.target_w < src_w || hint.target_h < src_h)
        && decoder.scalable()
    {
        let area = |(w, h): (u32, u32)| u64::from(w) * u64::from(h);
        for candidate in (1..8).rev() {
            let (sw, sh) = decoder.scaled_size(candidate);
            // Never go BELOW target: that would force an upscale and throw away detail the user asked for.
            if sw < hint.target_w || sh < hint.target_h {
                continue;
            }
            // The smallest output, and of the factors that round up to the same size the largest.
            if area((sw, sh)) < area(decoder.scaled_size(eighths)) {
                eighths = candidate;
            }
        }
    }
    let (width, height) = decoder.scaled_size(eighths);

    // A CMYK profile describes inks, not the RGBA made below. Others must survive, or P3 would pass for sRGB (#30197).
    let icc_profile = if cmyk {
        None
    } else {
        decoder.icc_profile().map_err(decode_error)?
    };

    let options = DecodeOptions {
        eighths,
        // What TurboJPEG's TJFLAG_LIMITSCANS stood for. Encoders make about 10.
        max_scans: 500,
    };
    let mut rgba = decoder.decode(&options).map_err(decode_error)?;
    if cmyk {
        codecs::cmyk_to_rgba(&mut rgba);
    }

    Ok(codecs::Decoded {
        rgba,
        width,
        height,
        icc_profile,
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
    let options = EncodeOptions {
        quality: quality.clamp(1, 100),
        // Multi-scan SOF2: same size ±1%, decodes coarse-to-fine, slower to encode, and some old decoders mishandle it.
        progressive,
        // The source colour profile, as APP2/ICC_PROFILE markers. See #30197.
        icc_profile: icc_profile.filter(|profile| !profile.is_empty()),
    };
    let bytes = bun_jpeg::encode(rgba, w, h, &options)
        .map_err(|err| convert_error(err, codecs::Error::EncodeFailed))?;
    Ok(codecs::Encoded::from_owned(bytes))
}
