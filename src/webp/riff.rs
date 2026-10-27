//! The chunks in front of the bitstream, as the decoder reads them (`webp_dec.c`).

use crate::DecodeError;
use crate::util::{Checked, SliceExt};
use crate::{vp8, vp8l};

pub(crate) const TAG_SIZE: usize = 4;
pub(crate) const CHUNK_HEADER_SIZE: usize = 8;
pub(crate) const RIFF_HEADER_SIZE: usize = 12;
pub(crate) const VP8X_CHUNK_SIZE: usize = 10;
/// Such that adding the header and the padding does not overflow 32 bits.
pub(crate) const MAX_CHUNK_PAYLOAD: u32 = u32::MAX - CHUNK_HEADER_SIZE as u32 - 1;
pub(crate) const MAX_IMAGE_AREA: u64 = 1 << 32;

pub(crate) const ANIMATION_FLAG: u32 = 0x02;
pub(crate) const ALPHA_FLAG: u32 = 0x10;
pub(crate) const ICCP_FLAG: u32 = 0x20;

pub(crate) fn le24(data: &[u8], pos: usize) -> Checked<u32> {
    let [a, b, c] = *data.array_at(pos)?;
    Ok(u32::from_le_bytes([a, b, c, 0]))
}

pub(crate) fn le32(data: &[u8], pos: usize) -> Checked<u32> {
    Ok(u32::from_le_bytes(*data.array_at(pos)?))
}

/// What the decoders are given.
pub(crate) struct Headers<'a> {
    /// From the first byte of the VP8 or VP8L bitstream to the end of the input, which can be past the end of the chunk.
    pub(crate) bitstream: &'a [u8],
    /// The payload of the last `ALPH` chunk in front of the bitstream.
    pub(crate) alpha: Option<&'a [u8]>,
    pub(crate) is_lossless: bool,
}

struct Parsed<'a> {
    width: u32,
    height: u32,
    headers: Option<Headers<'a>>,
}

/// Skips the RIFF header if there is one and returns its size field, or 0.
fn parse_riff(data: &mut &[u8], have_all_data: bool) -> Result<u32, DecodeError> {
    if data.len() < RIFF_HEADER_SIZE || !data.starts_with(b"RIFF") {
        return Ok(0);
    }
    if data.sub(8..12)? != b"WEBP" {
        return Err(DecodeError::BitstreamError);
    }
    let size = le32(data, TAG_SIZE)?;
    // At least one chunk: "WEBP" + "VP8?nnnn".
    if (size as usize) < TAG_SIZE + CHUNK_HEADER_SIZE || size > MAX_CHUNK_PAYLOAD {
        return Err(DecodeError::BitstreamError);
    }
    if have_all_data && size as usize > data.len() - CHUNK_HEADER_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    *data = data.sub(RIFF_HEADER_SIZE..)?;
    Ok(size)
}

struct Vp8x {
    flags: u32,
    width: u32,
    height: u32,
}

/// Skips the `VP8X` chunk if the data starts with one.
fn parse_vp8x(data: &mut &[u8]) -> Result<Option<Vp8x>, DecodeError> {
    if data.len() < CHUNK_HEADER_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    if !data.starts_with(b"VP8X") {
        return Ok(None);
    }
    if le32(data, TAG_SIZE)? as usize != VP8X_CHUNK_SIZE {
        return Err(DecodeError::BitstreamError);
    }
    if data.len() < CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    let flags = le32(data, 8)?;
    let width = 1 + le24(data, 12)?;
    let height = 1 + le24(data, 15)?;
    if u64::from(width) * u64::from(height) >= MAX_IMAGE_AREA {
        return Err(DecodeError::BitstreamError);
    }
    *data = data.sub(CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE..)?;
    Ok(Some(Vp8x {
        flags,
        width,
        height,
    }))
}

/// Skips to the next `VP8 ` or `VP8L` chunk header and returns the last `ALPH` payload on the way.
fn parse_optional_chunks<'a>(
    data: &mut &'a [u8],
    riff_size: u32,
) -> Result<Option<&'a [u8]>, DecodeError> {
    let mut total_size = (TAG_SIZE + CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE) as u32;
    let mut alpha = None;
    loop {
        let buf = *data;
        if buf.len() < CHUNK_HEADER_SIZE {
            return Err(DecodeError::NotEnoughData);
        }
        let chunk_size = le32(buf, TAG_SIZE)?;
        if chunk_size > MAX_CHUNK_PAYLOAD {
            return Err(DecodeError::BitstreamError);
        }
        // An odd payload is followed by one byte of padding.
        let disk_chunk_size = (CHUNK_HEADER_SIZE as u32 + chunk_size + 1) & !1;
        total_size = total_size.wrapping_add(disk_chunk_size);
        if riff_size > 0 && total_size > riff_size {
            return Err(DecodeError::BitstreamError);
        }
        // Before the length check below, so that the bitstream chunk may be incomplete.
        if buf.starts_with(b"VP8 ") || buf.starts_with(b"VP8L") {
            return Ok(alpha);
        }
        if buf.len() < disk_chunk_size as usize {
            return Err(DecodeError::NotEnoughData);
        }
        if buf.starts_with(b"ALPH") {
            alpha = Some(buf.sub(CHUNK_HEADER_SIZE..CHUNK_HEADER_SIZE + chunk_size as usize)?);
        }
        *data = buf.sub(disk_chunk_size as usize..)?;
    }
}

/// Skips the `VP8 ` or `VP8L` chunk header if there is one. Returns the size of the bitstream and whether it is lossless.
fn parse_vp8_header(
    data: &mut &[u8],
    have_all_data: bool,
    riff_size: u32,
) -> Result<(usize, bool), DecodeError> {
    let is_vp8 = data.starts_with(b"VP8 ");
    let is_vp8l = data.starts_with(b"VP8L");
    let minimal_size = (TAG_SIZE + CHUNK_HEADER_SIZE) as u32;
    if data.len() < CHUNK_HEADER_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    if !is_vp8 && !is_vp8l {
        return Ok((data.len(), vp8l::dec::check_signature(data)));
    }
    let size = le32(data, TAG_SIZE)?;
    if riff_size >= minimal_size && size > riff_size - minimal_size {
        return Err(DecodeError::BitstreamError);
    }
    if have_all_data && size as usize > data.len() - CHUNK_HEADER_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    *data = data.sub(CHUNK_HEADER_SIZE..)?;
    Ok((size as usize, is_vp8l))
}

/// `want_headers`: the input is the whole file, and an animation is refused. Else it reads no further than the size.
fn parse(input: &[u8], want_headers: bool) -> Result<Parsed<'_>, DecodeError> {
    if input.len() < RIFF_HEADER_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    let mut data = input;
    let riff_size = parse_riff(&mut data, want_headers)?;
    let found_riff = riff_size > 0;
    let vp8x = parse_vp8x(&mut data)?;
    if !found_riff && vp8x.is_some() {
        return Err(DecodeError::BitstreamError);
    }
    let animated = vp8x
        .as_ref()
        .is_some_and(|vp8x| vp8x.flags & ANIMATION_FLAG != 0);
    let canvas = vp8x.as_ref().map(|vp8x| (vp8x.width, vp8x.height));
    // Without `want_headers` the `VP8X` chunk can answer alone.
    let from_canvas = canvas
        .filter(|_| !want_headers)
        .map(|(width, height)| Parsed {
            width,
            height,
            headers: None,
        });
    if animated && let Some(parsed) = from_canvas {
        return Ok(parsed);
    }
    match (
        parse_image(data, want_headers, riff_size, canvas),
        from_canvas,
    ) {
        // libwebp parses an animation to the end before it refuses it.
        (Ok(_) | Err(DecodeError::NotEnoughData), _) if animated => {
            Err(DecodeError::UnsupportedFeature)
        }
        (Err(DecodeError::NotEnoughData), Some(parsed)) => Ok(parsed),
        (result, _) => result,
    }
}

/// What follows the RIFF header and the `VP8X` chunk.
fn parse_image(
    mut data: &[u8],
    have_all_data: bool,
    riff_size: u32,
    canvas: Option<(u32, u32)>,
) -> Result<Parsed<'_>, DecodeError> {
    if data.len() < TAG_SIZE {
        return Err(DecodeError::NotEnoughData);
    }
    let found_riff = riff_size > 0;
    let mut alpha = None;
    if (found_riff && canvas.is_some())
        || (!found_riff && canvas.is_none() && data.starts_with(b"ALPH"))
    {
        alpha = parse_optional_chunks(&mut data, riff_size)?;
    }
    let (compressed_size, is_lossless) = parse_vp8_header(&mut data, have_all_data, riff_size)?;
    if compressed_size > MAX_CHUNK_PAYLOAD as usize {
        return Err(DecodeError::BitstreamError);
    }
    let (width, height) = if is_lossless {
        if data.len() < vp8l::dec::FRAME_HEADER_SIZE {
            return Err(DecodeError::NotEnoughData);
        }
        let info = vp8l::dec::get_info(data).ok_or(DecodeError::BitstreamError)?;
        (info.width, info.height)
    } else {
        if data.len() < vp8::dec::FRAME_HEADER_SIZE {
            return Err(DecodeError::NotEnoughData);
        }
        vp8::dec::get_info(data, compressed_size).ok_or(DecodeError::BitstreamError)?
    };
    if canvas.is_some_and(|canvas| canvas != (width, height)) {
        return Err(DecodeError::BitstreamError);
    }
    Ok(Parsed {
        width,
        height,
        headers: Some(Headers {
            bitstream: data,
            alpha,
            is_lossless,
        }),
    })
}

/// `WebPGetInfo`: the width and the height.
pub(crate) fn get_info(data: &[u8]) -> Result<(u32, u32), DecodeError> {
    let parsed = parse(data, false)?;
    Ok((parsed.width, parsed.height))
}

/// `WebPParseHeaders` of a whole file.
pub(crate) fn parse_headers(data: &[u8]) -> Result<Headers<'_>, DecodeError> {
    parse(data, true)?.headers.ok_or(DecodeError::Bug)
}
