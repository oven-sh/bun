//! JPEG XL: jxl-rs decodes, libjxl encodes (patches/libjxl/bun_jxl_encode.cc).

use core::ffi::c_int;
use core::ptr::NonNull;

use jxl::api::{
    Event, JxlColorEncoding, JxlColorProfile, JxlColorType, JxlDataFormat, JxlDecoder,
    JxlDecoderOptions, JxlOutputBuffer, JxlPixelFormat,
};

use super::codecs;
use super::exif;
use crate::encoded_wrap_free;

const CODESTREAM_SIGNATURE: [u8; 2] = [0xFF, 0x0A];
const CONTAINER_SIGNATURE: [u8; 12] = [
    0x00, 0x00, 0x00, 0x0C, b'J', b'X', b'L', b' ', 0x0D, 0x0A, 0x87, 0x0A,
];

pub(crate) fn sniff(bytes: &[u8]) -> bool {
    bytes.starts_with(&CODESTREAM_SIGNATURE) || bytes.starts_with(&CONTAINER_SIGNATURE)
}

fn map_err(e: &jxl::error::Error) -> codecs::Error {
    match e {
        jxl::error::Error::ImageSizeTooLarge(..) => codecs::Error::TooManyPixels,
        _ => codecs::Error::DecodeFailed,
    }
}

/// The whole file is in memory, so `NeedMoreInput` means it's truncated.
fn step(
    decoder: &mut JxlDecoder,
    input: &mut &[u8],
    buffers: Option<&mut [JxlOutputBuffer]>,
) -> Result<Event, codecs::Error> {
    match decoder.process(input, buffers, None) {
        Ok(Event::NeedMoreInput { .. }) => Err(codecs::Error::DecodeFailed),
        Ok(event) => Ok(event),
        Err(e) => Err(map_err(&e)),
    }
}

/// A decoder stopped at `BasicInfo`, and the input it hasn't read yet.
fn header(
    bytes: &[u8],
    sample_limit: Option<usize>,
    adjust_orientation: bool,
) -> Result<(JxlDecoder, &[u8]), codecs::Error> {
    let mut opts = JxlDecoderOptions::default();
    opts.sample_limit = sample_limit;
    opts.adjust_orientation = adjust_orientation;
    let mut decoder = JxlDecoder::new(opts);
    let mut input = bytes;
    match step(&mut decoder, &mut input, None)? {
        Event::BasicInfo => Ok((decoder, input)),
        _ => Err(codecs::Error::DecodeFailed),
    }
}

/// `basic_info` is `Some` once `header` has returned.
fn dims(decoder: &JxlDecoder) -> Result<(u32, u32), codecs::Error> {
    let (w, h) = decoder
        .basic_info()
        .ok_or(codecs::Error::DecodeFailed)?
        .size;
    match (u32::try_from(w), u32::try_from(h)) {
        (Ok(w), Ok(h)) => Ok((w, h)),
        _ => Err(codecs::Error::DecodeFailed),
    }
}

/// Stored dims, before the header's orientation, the way JPEG probes.
pub(crate) fn probe(bytes: &[u8]) -> Result<(u32, u32), codecs::Error> {
    dims(&header(bytes, None, false)?.0)
}

/// The header's orientation (EXIF numbering); a bad header reads as Normal, like `exif::read_jpeg`.
pub(crate) fn orientation(bytes: &[u8]) -> exif::Orientation {
    let Ok((decoder, _)) = header(bytes, None, false) else {
        return exif::Orientation::Normal;
    };
    decoder
        .basic_info()
        .and_then(|info| exif::Orientation::from_u16(info.orientation as u16))
        .unwrap_or(exif::Orientation::Normal)
}

/// `auto_orient` has jxl-rs apply the header's orientation as it renders, so it costs no extra pass.
pub(crate) fn decode(
    bytes: &[u8],
    max_pixels: u64,
    auto_orient: bool,
) -> Result<codecs::Decoded, codecs::Error> {
    // Stored dims: jxl-rs checks its sample limit before orienting.
    let (sw, sh, extra_channels) = {
        let (first, _) = header(bytes, None, false)?;
        let (w, h) = dims(&first)?;
        let extra = first
            .basic_info()
            .map_or(0, |info| info.extra_channels.len());
        (w, h, extra)
    };
    codecs::guard(sw, sh, max_pixels)?;
    // jxl-rs counts max(w, 16) × h × (3 + extra) samples per frame and rejects at >=; never refuse what `guard` passed.
    let per_pixel = 3 + extra_channels as u64;
    let canvas = u64::from(sw.max(16)) * u64::from(sh) * per_pixel;
    let limit = max_pixels
        .saturating_add(1)
        .saturating_mul(per_pixel)
        .max(canvas + 1);
    let (mut decoder, mut input) = header(
        bytes,
        Some(usize::try_from(limit).unwrap_or(usize::MAX)),
        auto_orient,
    )?;
    let (w, h) = dims(&decoder)?;

    let gray = decoder
        .current_pixel_format()
        .is_some_and(|f| f.color_type.is_grayscale());
    // jxl-rs refuses RGBA output for a one-channel image, so gray decodes as GA and widens below.
    let channels: usize = if gray { 2 } else { 4 };
    decoder
        .set_pixel_format(JxlPixelFormat {
            color_type: if gray {
                JxlColorType::GrayscaleAlpha
            } else {
                JxlColorType::Rgba
            },
            color_data_format: Some(JxlDataFormat::U8 { bit_depth: 8 }),
            extra_channel_format: vec![None; extra_channels],
        })
        .map_err(|_| codecs::Error::DecodeFailed)?;

    // The space the pixels render in. sRGB needs no profile; a gray one can't describe RGBA.
    let profile = decoder
        .output_color_profile()
        .ok_or(codecs::Error::DecodeFailed)?;
    let icc_profile = if gray
        || profile.same_color_encoding(&JxlColorProfile::Simple(JxlColorEncoding::srgb(false)))
    {
        None
    } else {
        profile.try_as_icc().map(|icc| icc.into_owned())
    };

    let row = (w as usize) * channels;
    let mut rgba: Vec<u8> = Vec::new();
    rgba.try_reserve_exact(row * (h as usize) * if gray { 2 } else { 1 })
        .map_err(|_| codecs::Error::OutOfMemory)?;
    rgba.resize(row * (h as usize), 0);

    let mut out = JxlOutputBuffer::new(&mut rgba, h as usize, row);
    loop {
        match step(
            &mut decoder,
            &mut input,
            Some(core::slice::from_mut(&mut out)),
        )? {
            Event::FrameHeader => {}
            Event::FrameComplete { .. } => break,
            _ => return Err(codecs::Error::DecodeFailed),
        }
    }

    if gray {
        // Back to front, so no GA pair is overwritten before it's read.
        let n = (w as usize) * (h as usize);
        rgba.resize(n * 4, 0);
        for i in (0..n).rev() {
            let (g, a) = (rgba[i * 2], rgba[i * 2 + 1]);
            rgba[i * 4..i * 4 + 4].copy_from_slice(&[g, g, g, a]);
        }
    }

    Ok(codecs::Decoded {
        rgba,
        width: w,
        height: h,
        icc_profile,
    })
}

unsafe extern "C" {
    fn bun_jxl_encode(
        rgba: *const u8,
        width: u32,
        height: u32,
        distance: f32,
        lossless: c_int,
        icc: *const u8,
        icc_len: usize,
        out: *mut *mut u8,
        out_len: *mut usize,
    ) -> c_int;
}

/// JxlEncoderDistanceFromQuality. 100 → distance 0 is lossless-only in libjxl, so `encode` routes it there.
fn distance_from_quality(quality: u8) -> f32 {
    let q = f32::from(quality);
    if q >= 30.0 {
        0.1 + (100.0 - q) * 0.09
    } else {
        53.0 / 3000.0 * q * q - 23.0 / 20.0 * q + 25.0
    }
}

pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    quality: u8,
    lossless: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    debug_assert_eq!(rgba.len(), (w as usize) * (h as usize) * 4);
    let lossless = lossless || quality >= 100;
    let icc = icc_profile.unwrap_or(&[]);
    let mut out: *mut u8 = core::ptr::null_mut();
    let mut out_len: usize = 0;
    // SAFETY: rgba is w*h*4 readable bytes; icc is a valid (ptr,len) slice
    // (len 0 means "no profile"); out/out_len are valid out-params.
    let rc = unsafe {
        bun_jxl_encode(
            rgba.as_ptr(),
            w,
            h,
            distance_from_quality(quality),
            c_int::from(lossless),
            icc.as_ptr(),
            icc.len(),
            &raw mut out,
            &raw mut out_len,
        )
    };
    match rc {
        0 if !out.is_null() => {}
        2 => return Err(codecs::Error::OutOfMemory),
        _ => return Err(codecs::Error::EncodeFailed),
    }
    Ok(codecs::Encoded {
        // SAFETY: on success `out` is a non-null malloc'd buffer of `out_len` bytes.
        bytes: unsafe { NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(out, out_len)) },
        free: encoded_wrap_free!(libc::free),
    })
}
