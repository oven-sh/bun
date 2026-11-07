//! The chunks in front of the bitstream, as the decoder reads them (`webp_dec.c`).

use crate::util::{Checked, SliceExt};
use crate::{Error, Info, Result};
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

pub(crate) const fn le24([a, b, c]: [u8; 3]) -> u32 {
    u32::from_le_bytes([a, b, c, 0])
}

pub(crate) fn le32(data: &[u8], pos: usize) -> Checked<u32> {
    Ok(u32::from_le_bytes(*data.array_at(pos)?))
}

/// The size of a payload on disk: an odd one is followed by one byte of padding.
pub(crate) const fn padded(size: u32) -> u32 {
    size + (size & 1)
}

/// What the decoders are given.
pub(crate) struct Headers<'a> {
    /// The size that the bitstream announces.
    info: Info,
    /// From the first byte of the VP8 or VP8L bitstream to the end of the input, which can be past the end of the chunk.
    pub(crate) bitstream: &'a [u8],
    /// The payload of the last `ALPH` chunk in front of the bitstream.
    pub(crate) alpha: Option<&'a [u8]>,
    pub(crate) is_lossless: bool,
}

/// Skips the RIFF header if there is one and returns its size field, or 0.
fn parse_riff(data: &mut &[u8], have_all_data: bool) -> Result<u32> {
    if data.len() < RIFF_HEADER_SIZE || !data.starts_with(b"RIFF") {
        return Ok(0);
    }
    if data.sub(8..12)? != b"WEBP" {
        return Err(Error::BitstreamError);
    }
    let size = le32(data, TAG_SIZE)?;
    // At least one chunk: "WEBP" + "VP8?nnnn".
    if (size as usize) < TAG_SIZE + CHUNK_HEADER_SIZE || size > MAX_CHUNK_PAYLOAD {
        return Err(Error::BitstreamError);
    }
    if have_all_data && size as usize > data.len() - CHUNK_HEADER_SIZE {
        return Err(Error::NotEnoughData);
    }
    *data = data.sub(RIFF_HEADER_SIZE..)?;
    Ok(size)
}

struct Vp8x {
    flags: u32,
    canvas: Info,
}

/// Skips the `VP8X` chunk if the data starts with one.
fn parse_vp8x(data: &mut &[u8]) -> Result<Option<Vp8x>> {
    if data.len() < CHUNK_HEADER_SIZE {
        return Err(Error::NotEnoughData);
    }
    if !data.starts_with(b"VP8X") {
        return Ok(None);
    }
    if le32(data, TAG_SIZE)? as usize != VP8X_CHUNK_SIZE {
        return Err(Error::BitstreamError);
    }
    if data.len() < CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE {
        return Err(Error::NotEnoughData);
    }
    let flags = le32(data, 8)?;
    let width = 1 + le24(*data.array_at(12)?);
    let height = 1 + le24(*data.array_at(15)?);
    if u64::from(width) * u64::from(height) >= MAX_IMAGE_AREA {
        return Err(Error::BitstreamError);
    }
    *data = data.sub(CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE..)?;
    let canvas = Info { width, height };
    Ok(Some(Vp8x { flags, canvas }))
}

/// Skips to the next `VP8 ` or `VP8L` chunk header and returns the last `ALPH` payload on the way.
fn parse_optional_chunks<'a>(data: &mut &'a [u8], riff_size: u32) -> Result<Option<&'a [u8]>> {
    let mut total_size = (TAG_SIZE + CHUNK_HEADER_SIZE + VP8X_CHUNK_SIZE) as u64;
    let mut alpha = None;
    loop {
        let buf = *data;
        if buf.len() < CHUNK_HEADER_SIZE {
            return Err(Error::NotEnoughData);
        }
        let chunk_size = le32(buf, TAG_SIZE)?;
        if chunk_size > MAX_CHUNK_PAYLOAD {
            return Err(Error::BitstreamError);
        }
        let disk_chunk_size = CHUNK_HEADER_SIZE as u32 + padded(chunk_size);
        total_size += u64::from(disk_chunk_size);
        if riff_size > 0 && total_size > u64::from(riff_size) {
            return Err(Error::BitstreamError);
        }
        // Before the length check below, so that the bitstream chunk may be incomplete.
        if buf.starts_with(b"VP8 ") || buf.starts_with(b"VP8L") {
            return Ok(alpha);
        }
        if buf.len() < disk_chunk_size as usize {
            return Err(Error::NotEnoughData);
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
) -> Result<(usize, bool)> {
    let is_vp8 = data.starts_with(b"VP8 ");
    let is_vp8l = data.starts_with(b"VP8L");
    let minimal_size = (TAG_SIZE + CHUNK_HEADER_SIZE) as u32;
    if data.len() < CHUNK_HEADER_SIZE {
        return Err(Error::NotEnoughData);
    }
    if !is_vp8 && !is_vp8l {
        return Ok((data.len(), vp8l::dec::check_signature(data)));
    }
    let size = le32(data, TAG_SIZE)?;
    if riff_size >= minimal_size && size > riff_size - minimal_size {
        return Err(Error::BitstreamError);
    }
    if have_all_data && size as usize > data.len() - CHUNK_HEADER_SIZE {
        return Err(Error::NotEnoughData);
    }
    *data = data.sub(CHUNK_HEADER_SIZE..)?;
    Ok((size as usize, is_vp8l))
}

/// The RIFF header and the `VP8X` chunk, neither of which a file needs to have.
struct Prefix<'a> {
    /// What follows them.
    rest: &'a [u8],
    have_all_data: bool,
    /// The size field of the RIFF header, or 0.
    riff_size: u32,
    /// The size in the `VP8X` chunk.
    canvas: Option<Info>,
    is_animation: bool,
}

impl<'a> Prefix<'a> {
    /// `ParseHeadersInternal`, first half. `have_all_data`: a chunk that goes on past the end of the input is an error.
    fn parse(mut data: &'a [u8], have_all_data: bool) -> Result<Self> {
        if data.len() < RIFF_HEADER_SIZE {
            return Err(Error::NotEnoughData);
        }
        let riff_size = parse_riff(&mut data, have_all_data)?;
        let vp8x = parse_vp8x(&mut data)?;
        if riff_size == 0 && vp8x.is_some() {
            return Err(Error::BitstreamError);
        }
        Ok(Self {
            rest: data,
            have_all_data,
            riff_size,
            canvas: vp8x.as_ref().map(|vp8x| vp8x.canvas),
            is_animation: vp8x.is_some_and(|vp8x| vp8x.flags & ANIMATION_FLAG != 0),
        })
    }

    /// `ParseHeadersInternal`, second half: the chunks of a still image, up to the header of the bitstream.
    fn parse_image(&self) -> Result<Headers<'a>> {
        let mut data = self.rest;
        if data.len() < TAG_SIZE {
            return Err(Error::NotEnoughData);
        }
        let alpha = if self.canvas.is_some() || (self.riff_size == 0 && data.starts_with(b"ALPH")) {
            parse_optional_chunks(&mut data, self.riff_size)?
        } else {
            None
        };
        let (compressed_size, is_lossless) =
            parse_vp8_header(&mut data, self.have_all_data, self.riff_size)?;
        if compressed_size > MAX_CHUNK_PAYLOAD as usize {
            return Err(Error::BitstreamError);
        }
        let info = if is_lossless {
            if data.len() < vp8l::dec::FRAME_HEADER_SIZE {
                return Err(Error::NotEnoughData);
            }
            vp8l::dec::get_info(data).ok_or(Error::BitstreamError)?
        } else {
            if data.len() < vp8::common::FRAME_HEADER_SIZE {
                return Err(Error::NotEnoughData);
            }
            vp8::dec::get_info(data, compressed_size).ok_or(Error::BitstreamError)?
        };
        if self.canvas.is_some_and(|canvas| canvas != info) {
            return Err(Error::BitstreamError);
        }
        Ok(Headers {
            info,
            bitstream: data,
            alpha,
            is_lossless,
        })
    }
}

/// `WebPGetInfo`, from as little of the file as it takes.
pub fn get_info(data: &[u8]) -> Result<Info> {
    let have_all_data = false;
    let prefix = Prefix::parse(data, have_all_data)?;
    // The `VP8X` chunk answers for an animation, and for a file that ends in front of the bitstream.
    if let Some(canvas) = prefix.canvas
        && prefix.is_animation
    {
        return Ok(canvas);
    }
    match (prefix.parse_image(), prefix.canvas) {
        (Err(Error::NotEnoughData), Some(canvas)) => Ok(canvas),
        (result, _) => result.map(|headers| headers.info),
    }
}

/// `WebPParseHeaders` of a whole file.
pub(crate) fn parse_headers(data: &[u8]) -> Result<Headers<'_>> {
    let have_all_data = true;
    let prefix = Prefix::parse(data, have_all_data)?;
    match prefix.parse_image() {
        // libwebp parses an animation to the end before it refuses it.
        Ok(_) | Err(Error::NotEnoughData) if prefix.is_animation => Err(Error::UnsupportedFeature),
        result => result,
    }
}
