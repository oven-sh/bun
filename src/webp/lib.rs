//! WebP, derived from libwebp v1.6.0 (LICENSE.md). Encodes to the same bytes, decodes to the same pixels as its C code.
#![forbid(unsafe_code)]
// Images come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod alpha;
mod container;
mod demux;
mod error;
mod riff;
mod util;
mod vp8;
mod vp8l;

pub use error::{DecodeError, EncodeError};
use util::{Bug, Checked, SliceExt};

/// Where the decoders write: non-premultiplied R, G, B, A bytes.
pub(crate) struct Output<'a> {
    rgba: &'a mut [u8],
    stride: usize,
}

impl Output<'_> {
    /// `WebPAllocateDecBuffer` for memory of the caller's.
    pub(crate) fn check(&self, width: usize, height: usize) -> Result<(), DecodeError> {
        let row = width.checked_mul(4).ok_or(DecodeError::InvalidParam)?;
        let last = height.checked_sub(1).ok_or(DecodeError::InvalidParam)?;
        // The last row needs no padding.
        let size = self
            .stride
            .checked_mul(last)
            .and_then(|size| size.checked_add(row))
            .ok_or(DecodeError::InvalidParam)?;
        if width == 0 || size > self.rgba.len() || self.stride < row {
            return Err(DecodeError::InvalidParam);
        }
        Ok(())
    }

    /// The `4 * width` bytes of row `y`.
    #[inline]
    pub(crate) fn row_mut(&mut self, y: usize, width: usize) -> Checked<&mut [u8]> {
        let start = y.checked_mul(self.stride).ok_or(Bug)?;
        self.rgba.sub_mut(start..)?.sub_mut(..4 * width)
    }
}

/// `WebPGetInfo`: the width and the height, from as little of the file as it takes.
pub fn get_info(data: &[u8]) -> Result<(u32, u32), DecodeError> {
    riff::get_info(data)
}

/// `WebPDecodeRGBAInto`. Rows are `stride` bytes apart. What `rgba` holds after an error is unspecified.
pub fn decode_rgba_into(data: &[u8], rgba: &mut [u8], stride: usize) -> Result<(), DecodeError> {
    let headers = riff::parse_headers(data)?;
    let mut output = Output { rgba, stride };
    if headers.is_lossless {
        vp8l::dec::decode(headers.bitstream, &mut output)
    } else {
        vp8::dec::decode(headers.bitstream, headers.alpha, &mut output)
    }
}

/// The ICC profile of a file, if it has one and the container is valid from start to end. It is not empty.
pub fn icc_profile(data: &[u8]) -> Option<&[u8]> {
    demux::icc_profile(data)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Compression {
    /// `WebPEncodeRGBA`: `quality` is 0 to 100.
    Lossy { quality: f32 },
    /// `WebPEncodeLosslessRGBA`.
    Lossless,
}

/// Non-premultiplied RGBA, rows `stride` bytes apart, to a WebP file, with the ICC profile if there is one.
pub fn encode_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    stride: usize,
    compression: Compression,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>, EncodeError> {
    let input = Input::new(rgba, width, height, stride)?;
    let image = match compression {
        Compression::Lossy { quality } => vp8::enc::encode(&input, quality)?,
        Compression::Lossless => vp8l::enc::encode(&input)?,
    };
    container::assemble(&image, icc_profile)
}

/// The largest width and height of a bitstream.
pub(crate) const MAX_DIMENSION: u32 = 16383;

/// What the encoders read: non-premultiplied R, G, B, A bytes.
pub(crate) struct Input<'a> {
    rgba: &'a [u8],
    pub(crate) width: usize,
    pub(crate) height: usize,
    stride: usize,
}

impl<'a> Input<'a> {
    fn new(rgba: &'a [u8], width: u32, height: u32, stride: usize) -> Result<Self, EncodeError> {
        if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
            return Err(EncodeError::BadDimension);
        }
        let (width, height) = (width as usize, height as usize);
        let size = stride
            .checked_mul(height - 1)
            .and_then(|size| size.checked_add(4 * width))
            .ok_or(EncodeError::BadDimension)?;
        if stride < 4 * width || rgba.len() < size {
            return Err(EncodeError::BadDimension);
        }
        Ok(Self {
            rgba,
            width,
            height,
            stride,
        })
    }

    /// The `4 * width` bytes of row `y`.
    #[inline]
    pub(crate) fn row(&self, y: usize) -> Checked<&'a [u8]> {
        let start = y.checked_mul(self.stride).ok_or(Bug)?;
        self.rgba.sub(start..)?.sub(..4 * self.width)
    }
}
