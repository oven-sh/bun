//! `demux.c`: finds the ICC profile. libwebp hands out chunks only if the whole container is valid, so this walks it.

use crate::Info;
use crate::riff::{
    self, ALPHA_FLAG, ANIMATION_FLAG, CHUNK_HEADER_SIZE, ICCP_FLAG, MAX_CHUNK_PAYLOAD,
    MAX_IMAGE_AREA, RIFF_HEADER_SIZE, TAG_SIZE, VP8X_CHUNK_SIZE,
};

const ANMF_CHUNK_SIZE: usize = 16;
const ANIM_CHUNK_SIZE: usize = 6;
const EXIF_FLAG: u32 = 0x08;
const XMP_FLAG: u32 = 0x04;
const ALL_VALID_FLAGS: u32 = ALPHA_FLAG | ANIMATION_FLAG | EXIF_FLAG | ICCP_FLAG | XMP_FLAG;

/// A cursor over the RIFF chunk.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }

    fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
        let bytes = *self.buf.get(self.pos..)?.first_chunk::<N>()?;
        self.pos += N;
        Some(bytes)
    }

    fn skip(&mut self, size: usize) -> Option<()> {
        if size > self.remaining() {
            return None;
        }
        self.pos += size;
        Some(())
    }

    fn le24(&mut self) -> Option<u32> {
        let [a, b, c] = self.take()?;
        Some(u32::from_le_bytes([a, b, c, 0]))
    }

    /// The tag, the size of the payload and that size with padding, of a chunk that is all there.
    fn chunk_header(&mut self) -> Option<([u8; TAG_SIZE], usize, usize)> {
        let tag = self.take()?;
        let size = u32::from_le_bytes(self.take()?);
        if size > MAX_CHUNK_PAYLOAD {
            return None;
        }
        let padded = (size + (size & 1)) as usize;
        if padded > self.remaining() {
            return None;
        }
        Some((tag, size as usize, padded))
    }

    /// After a chunk: whether the file ends here. What follows is otherwise at least a chunk header.
    fn at_end(&self) -> Option<bool> {
        match self.remaining() {
            0 => Some(true),
            CHUNK_HEADER_SIZE.. => Some(false),
            _ => None,
        }
    }
}

#[derive(Default)]
struct Frame {
    x_offset: u32,
    y_offset: u32,
    width: u32,
    height: u32,
    /// Where the `VP8 ` or `VP8L` chunk starts.
    image: Option<usize>,
    /// Where the `ALPH` chunk starts.
    alpha: Option<usize>,
}

impl Frame {
    /// The image chunks at the cursor: at most one `ALPH` and one `VP8 ` or `VP8L`.
    fn store(&mut self, reader: &mut Reader<'_>, min_size: usize) -> Option<()> {
        if reader.remaining() < CHUNK_HEADER_SIZE.max(min_size) {
            return None;
        }
        loop {
            let start = reader.pos;
            let (tag, _, padded) = reader.chunk_header()?;
            match &tag {
                b"ALPH" if self.alpha.is_none() => self.alpha = Some(start),
                b"VP8L" if self.alpha.is_some() => return None,
                b"VP8 " | b"VP8L" if self.image.is_none() => {
                    let chunk = reader.buf.get(start..start + CHUNK_HEADER_SIZE + padded)?;
                    Info {
                        width: self.width,
                        height: self.height,
                    } = riff::get_info(chunk).ok()?;
                    self.image = Some(start);
                }
                _ => {
                    reader.pos = start;
                    return Some(());
                }
            }
            reader.skip(padded)?;
            if reader.at_end()? {
                return Some(());
            }
        }
    }

    fn is_valid(&self, is_animation: bool, canvas_width: u32, canvas_height: u32) -> bool {
        let Some(image) = self.image else {
            return false;
        };
        if self.alpha.is_some_and(|alpha| alpha > image) {
            return false;
        }
        if is_animation {
            u64::from(self.width) + u64::from(self.x_offset) <= u64::from(canvas_width)
                && u64::from(self.height) + u64::from(self.y_offset) <= u64::from(canvas_height)
        } else {
            (self.x_offset, self.y_offset) == (0, 0)
                && (self.width, self.height) == (canvas_width, canvas_height)
        }
    }
}

/// `WebPDemux`, `WebPDemuxGetI(WEBP_FF_FORMAT_FLAGS)` and `WebPDemuxGetChunk("ICCP", 1)`.
pub(crate) fn icc_profile(data: &[u8]) -> Option<&[u8]> {
    if data.len() < RIFF_HEADER_SIZE + CHUNK_HEADER_SIZE
        || !data.starts_with(b"RIFF")
        || data.get(8..12)? != b"WEBP"
    {
        return None;
    }
    let riff_size = riff::le32(data, TAG_SIZE).ok()?;
    if (riff_size as usize) < CHUNK_HEADER_SIZE || riff_size > MAX_CHUNK_PAYLOAD {
        return None;
    }
    let mut reader = Reader {
        buf: data.get(..riff_size as usize + CHUNK_HEADER_SIZE)?,
        pos: RIFF_HEADER_SIZE,
    };

    // Only the extended format has a profile.
    let (tag, vp8x_size, vp8x_size_padded) = reader.chunk_header()?;
    if &tag != b"VP8X" || vp8x_size < VP8X_CHUNK_SIZE {
        return None;
    }
    let [flags, _, _, _] = reader.take()?;
    let flags = u32::from(flags);
    let canvas_width = 1 + reader.le24()?;
    let canvas_height = 1 + reader.le24()?;
    if u64::from(canvas_width) * u64::from(canvas_height) >= MAX_IMAGE_AREA {
        return None;
    }
    reader.skip(vp8x_size_padded - VP8X_CHUNK_SIZE)?;
    if reader.remaining() < CHUNK_HEADER_SIZE {
        return None;
    }

    let is_animation = flags & ANIMATION_FLAG != 0;
    let mut has_anim_chunk = false;
    let mut has_frame = false;
    let mut profile = None;
    loop {
        let start = reader.pos;
        let (tag, size, padded) = reader.chunk_header()?;
        match &tag {
            b"VP8X" => return None,
            b"ALPH" | b"VP8 " | b"VP8L" => {
                // The frames of an animation are all in `ANMF` chunks, and a still image has one frame.
                if has_anim_chunk || is_animation || has_frame {
                    return None;
                }
                reader.pos = start;
                let mut frame = Frame::default();
                frame.store(&mut reader, 0)?;
                if flags & ALPHA_FLAG == 0 {
                    frame.alpha = None;
                }
                if !frame.is_valid(is_animation, canvas_width, canvas_height) {
                    return None;
                }
                has_frame = true;
            }
            b"ANIM" if !has_anim_chunk => {
                if padded < ANIM_CHUNK_SIZE {
                    return None;
                }
                has_anim_chunk = true;
                reader.skip(padded)?;
            }
            b"ANIM" if padded < ANIM_CHUNK_SIZE => return None,
            b"ANMF" => {
                if !has_anim_chunk || padded < ANMF_CHUNK_SIZE {
                    return None;
                }
                let mut frame = Frame {
                    x_offset: 2 * reader.le24()?,
                    y_offset: 2 * reader.le24()?,
                    width: 1 + reader.le24()?,
                    height: 1 + reader.le24()?,
                    ..Frame::default()
                };
                // The duration, and how to dispose of the frame and blend it.
                reader.skip(4)?;
                if u64::from(frame.width) * u64::from(frame.height) >= MAX_IMAGE_AREA {
                    return None;
                }
                let payload_size = padded - ANMF_CHUNK_SIZE;
                let payload_start = reader.pos;
                frame.store(&mut reader, payload_size)?;
                if reader.pos - payload_start > payload_size {
                    return None;
                }
                if is_animation && (frame.image.is_some() || frame.alpha.is_some()) {
                    if !frame.is_valid(is_animation, canvas_width, canvas_height) {
                        return None;
                    }
                    has_frame = true;
                }
            }
            _ => {
                if &tag == b"ICCP" && profile.is_none() {
                    let payload = start + CHUNK_HEADER_SIZE;
                    profile = Some(reader.buf.get(payload..payload + size)?);
                }
                reader.skip(padded)?;
            }
        }
        if reader.at_end()? {
            break;
        }
    }
    if !has_frame || flags & !ALL_VALID_FLAGS != 0 || flags & ICCP_FLAG == 0 {
        return None;
    }
    profile.filter(|profile| !profile.is_empty())
}
