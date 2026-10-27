//! WebP, derived from libwebp v1.6.0 (LICENSE). Encodes to the same bytes, decodes to the same pixels as its C code.
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

pub use demux::icc_profile;
pub use error::{Error, Result};
pub use riff::get_info;
use util::{Bug, Checked, SliceExt};

/// `MIN_BUFFER_SIZE`: what `height` rows of `4 * width` bytes take. The last one needs no padding.
fn min_buffer_size(width: usize, height: usize, stride: usize) -> Option<usize> {
    let row = width.checked_mul(4)?;
    stride.checked_mul(height.checked_sub(1)?)?.checked_add(row)
}

/// Where the decoders write: non-premultiplied R, G, B, A bytes.
pub(crate) struct Output<'a> {
    rgba: &'a mut [u8],
    stride: usize,
}

impl Output<'_> {
    /// `CheckDecBuffer`: an image of this size fits.
    pub(crate) fn check(&self, width: usize, height: usize) -> Result<()> {
        let size = min_buffer_size(width, height, self.stride).ok_or(Error::InvalidParam)?;
        if width == 0 || size > self.rgba.len() || self.stride < 4 * width {
            return Err(Error::InvalidParam);
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Info {
    pub width: u32,
    pub height: u32,
}

/// `WebPDecodeRGBAInto`. Rows are `stride` bytes apart. What `rgba` holds after an error is unspecified.
pub fn decode_rgba_into(data: &[u8], rgba: &mut [u8], stride: usize) -> Result<()> {
    let headers = riff::parse_headers(data)?;
    let mut output = Output { rgba, stride };
    if headers.is_lossless {
        vp8l::dec::decode(headers.bitstream, &mut output)
    } else {
        vp8::dec::decode(headers.bitstream, headers.alpha, &mut output)
    }
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
) -> Result<Vec<u8>> {
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
    fn new(rgba: &'a [u8], width: u32, height: u32, stride: usize) -> Result<Self> {
        if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
            return Err(Error::BadDimension);
        }
        let (width, height) = (width as usize, height as usize);
        let size = min_buffer_size(width, height, stride).ok_or(Error::BadDimension)?;
        if stride < 4 * width || rgba.len() < size {
            return Err(Error::BadDimension);
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
