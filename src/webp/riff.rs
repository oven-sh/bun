//! The RIFF container: https://developers.google.com/speed/webp/docs/riff_container

use crate::error::{Error, Result};
use crate::{lossless, vec};

type Tag = [u8; 4];

const RIFF: Tag = *b"RIFF";
const WEBP: Tag = *b"WEBP";
const VP8X: Tag = *b"VP8X";
const VP8: Tag = *b"VP8 ";
const VP8L: Tag = *b"VP8L";
const ALPH: Tag = *b"ALPH";
const ICCP: Tag = *b"ICCP";

const HEADER_LEN: usize = 8;
const VP8X_LEN: usize = 10;
/// With its header and padding a chunk's length fits 32 bits.
const MAX_PAYLOAD_LEN: usize = u32::MAX as usize - HEADER_LEN - 1;

const ICCP_FLAG: u8 = 0x20;
const ALPHA_FLAG: u8 = 0x10;
const ANIMATION_FLAG: u8 = 0x02;

/// The payloads of the chunks that make up an image.
#[derive(Clone, Copy)]
pub(crate) enum Bitstream<'a> {
    Lossy {
        image: &'a [u8],
        alpha: Option<&'a [u8]>,
    },
    Lossless {
        image: &'a [u8],
    },
}

const fn padded(len: usize) -> usize {
    len + (len & 1)
}

/// What a VP8X chunk says.
#[derive(Clone, Copy)]
pub(crate) struct Canvas {
    pub(crate) width: u32,
    pub(crate) height: u32,
    flags: u8,
}

/// The `VP8 ` or `VP8L` chunk.
#[derive(Clone, Copy)]
pub(crate) struct ImageChunk<'a> {
    /// `image` goes on to the end of the file.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dec/webp_dec.c#L475
    pub(crate) bitstream: Bitstream<'a>,
    pub(crate) declared_len: usize,
}

/// A file that starts like a WebP file. The rest of it may be missing.
pub(crate) struct Container<'a> {
    pub(crate) canvas: Option<Canvas>,
    /// What the header says follows `WEBP`.
    declared_len: usize,
    /// What does.
    chunks: &'a [u8],
}

/// The tag, the length of the payload, and what follows the header.
fn split_header(bytes: &[u8]) -> Result<(Tag, usize, &[u8])> {
    let (&[t0, t1, t2, t3, l0, l1, l2, l3], rest) =
        bytes.split_first_chunk().ok_or(Error::UnexpectedEof)?;
    let len = u32::from_le_bytes([l0, l1, l2, l3]) as usize;
    Ok(([t0, t1, t2, t3], len, rest))
}

impl<'a> Container<'a> {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dec/webp_dec.c#L282
    pub(crate) fn new(bytes: &'a [u8]) -> Result<Self> {
        let (tag, len, rest) = split_header(bytes)?;
        let (&form, chunks) = rest.split_first_chunk().ok_or(Error::UnexpectedEof)?;
        if tag != RIFF
            || form != WEBP
            || !(WEBP.len() + HEADER_LEN..=MAX_PAYLOAD_LEN).contains(&len)
        {
            return Err(Error::InvalidContainer);
        }
        let canvas = match split_header(chunks)? {
            (VP8X, VP8X_LEN, payload) => Some(Canvas::parse(payload)?),
            _ => None,
        };
        Ok(Self {
            canvas,
            declared_len: len - WEBP.len(),
            chunks,
        })
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.declared_len <= self.chunks.len()
    }

    fn has_flag(&self, flag: u8) -> bool {
        self.canvas.is_some_and(|canvas| canvas.flags & flag != 0)
    }

    pub(crate) fn image_chunk(&self) -> Result<ImageChunk<'a>> {
        if self.has_flag(ANIMATION_FLAG) {
            return Err(Error::Animated);
        }
        let canvas_len = self.canvas.map_or(0, |_| HEADER_LEN + VP8X_LEN);
        let mut unread = self.chunks.get(canvas_len..).unwrap_or_default();
        let mut room = self.declared_len.saturating_sub(canvas_len);
        let mut alpha = None;
        loop {
            let (tag, len, rest) = split_header(unread)?;
            if self.canvas.is_none() && tag != VP8 && tag != VP8L {
                return Ok(ImageChunk::without_header(unread));
            }
            // An image that is the only chunk gets away without its padding.
            let needed = if self.canvas.is_some() {
                padded(len)
            } else {
                len
            };
            room = room
                .checked_sub(HEADER_LEN + needed)
                .ok_or(Error::InvalidContainer)?;
            let bitstream = match tag {
                VP8 => Bitstream::Lossy { image: rest, alpha },
                VP8L => Bitstream::Lossless { image: rest },
                _ => {
                    unread = rest.get(needed..).ok_or(Error::UnexpectedEof)?;
                    if tag == ALPH {
                        alpha = rest.get(..len);
                    }
                    continue;
                }
            };
            return Ok(ImageChunk {
                bitstream,
                declared_len: len,
            });
        }
    }

    /// The first ICCP chunk, as far as the chunks make sense.
    pub(crate) fn icc_profile(&self) -> Option<&'a [u8]> {
        if !self.has_flag(ICCP_FLAG) {
            return None;
        }
        let mut unread = self.chunks.get(..self.declared_len).unwrap_or_default();
        loop {
            let (tag, len, rest) = split_header(unread).ok()?;
            if tag == ICCP {
                return rest.get(..len).filter(|profile| !profile.is_empty());
            }
            unread = rest.get(padded(len)..)?;
        }
    }
}

impl<'a> ImageChunk<'a> {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dec/webp_dec.c#L264
    fn without_header(image: &'a [u8]) -> Self {
        Self {
            bitstream: match image.first() {
                Some(&lossless::SIGNATURE) => Bitstream::Lossless { image },
                _ => Bitstream::Lossy { image, alpha: None },
            },
            declared_len: image.len(),
        }
    }
}

impl Canvas {
    fn parse(payload: &[u8]) -> Result<Self> {
        let &[flags, _, _, _, w0, w1, w2, h0, h1, h2] = payload
            .first_chunk::<VP8X_LEN>()
            .ok_or(Error::UnexpectedEof)?;
        let width = 1 + u32::from_le_bytes([w0, w1, w2, 0]);
        let height = 1 + u32::from_le_bytes([h0, h1, h2, 0]);
        width.checked_mul(height).ok_or(Error::InvalidContainer)?;
        Ok(Self {
            width,
            height,
            flags,
        })
    }
}

/// What the header says of a file with chunks whose payloads have these lengths.
fn riff_len(payload_lens: impl Iterator<Item = usize>) -> Result<usize> {
    let riff_len = payload_lens.fold(WEBP.len(), |sum, len| {
        sum.saturating_add(HEADER_LEN + padded(len))
    });
    if riff_len > MAX_PAYLOAD_LEN {
        return Err(Error::TooLarge);
    }
    Ok(riff_len)
}

/// With room for them.
fn start_file(payload_lens: impl Iterator<Item = usize>) -> Result<Vec<u8>> {
    let riff_len = riff_len(payload_lens)?;
    let mut out = vec::with_room(HEADER_LEN + riff_len)?;
    out.extend_from_slice(&RIFF);
    out.extend_from_slice(&(riff_len as u32).to_le_bytes());
    out.extend_from_slice(&WEBP);
    Ok(out)
}

pub(crate) fn write(
    width: usize,
    height: usize,
    has_alpha: bool,
    bitstream: Bitstream,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let (image, alpha) = match bitstream {
        Bitstream::Lossy { image, alpha } => ((VP8, image), alpha),
        Bitstream::Lossless { image } => ((VP8L, image), None),
    };
    let flag = |is_set: bool, flag: u8| if is_set { flag } else { 0 };
    let flags = flag(icc_profile.is_some(), ICCP_FLAG) | flag(has_alpha, ALPHA_FLAG);
    let [w0, w1, w2, ..] = (width - 1).to_le_bytes();
    let [h0, h1, h2, ..] = (height - 1).to_le_bytes();
    let vp8x = [flags, 0, 0, 0, w0, w1, w2, h0, h1, h2];
    let is_extended = icc_profile.is_some() || alpha.is_some();
    let chunks = [
        is_extended.then_some((VP8X, vp8x.as_slice())),
        icc_profile.map(|profile| (ICCP, profile)),
        alpha.map(|alpha| (ALPH, alpha)),
        Some(image),
    ];
    let mut out = start_file(chunks.iter().flatten().map(|(_, payload)| payload.len()))?;
    for (tag, payload) in chunks.into_iter().flatten() {
        out.extend_from_slice(&tag);
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(payload);
        out.resize(padded(out.len()), 0);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_length_of_a_file_fits_its_header() {
        let most = MAX_PAYLOAD_LEN - WEBP.len() - 2 * HEADER_LEN - 2;
        assert_eq!(riff_len([1, most].into_iter()), Ok(MAX_PAYLOAD_LEN));
        assert_eq!(start_file([1, most + 1].into_iter()), Err(Error::TooLarge));
    }
}
