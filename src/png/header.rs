//! IHDR and what follows from it: the size of a row and the Adam7 passes.

use crate::chunk::Reader;
use crate::error::{Error, Result};

/// The largest width, height and chunk length the format allows.
pub(crate) const MAX_U31: u32 = i32::MAX as u32;

pub(crate) const IHDR_LEN: u32 = 13;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ColorType {
    Grayscale = 0,
    Truecolor = 2,
    Indexed = 3,
    GrayscaleAlpha = 4,
    TruecolorAlpha = 6,
}

impl ColorType {
    const fn channels(self) -> u8 {
        match self {
            Self::Grayscale | Self::Indexed => 1,
            Self::GrayscaleAlpha => 2,
            Self::Truecolor => 3,
            Self::TruecolorAlpha => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub width: u32,
    pub height: u32,
    pub(crate) bit_depth: u8,
    pub(crate) color_type: ColorType,
    pub(crate) interlaced: bool,
}

/// The rows of one reduced image. An image that is not interlaced has one, the image itself.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Pass {
    pub(crate) width: usize,
    pub(crate) height: usize,
    /// Without the filter type.
    pub(crate) row_bytes: usize,
    pub(crate) x_start: usize,
    pub(crate) x_step: usize,
    pub(crate) y_start: usize,
    pub(crate) y_step: usize,
}

/// `(x_start, y_start, x_step, y_step)`
const ADAM7: [(usize, usize, usize, usize); 7] = [
    (0, 0, 8, 8),
    (4, 0, 8, 8),
    (0, 4, 4, 8),
    (2, 0, 4, 4),
    (0, 2, 2, 4),
    (1, 0, 2, 2),
    (0, 1, 1, 2),
];
const NOT_INTERLACED: [(usize, usize, usize, usize); 1] = [(0, 0, 1, 1)];

impl Header {
    /// `reader` is in front of the `IHDR_LEN` bytes of an IHDR chunk.
    pub(crate) fn parse(reader: &mut Reader) -> Result<Self> {
        let width = u32::from_be_bytes(reader.take_array()?);
        let height = u32::from_be_bytes(reader.take_array()?);
        let [
            bit_depth,
            color_type,
            compression_method,
            filter_method,
            interlace_method,
        ] = reader.take_array()?;
        let color_type = match color_type {
            0 => ColorType::Grayscale,
            2 => ColorType::Truecolor,
            3 => ColorType::Indexed,
            4 => ColorType::GrayscaleAlpha,
            6 => ColorType::TruecolorAlpha,
            _ => return Err(Error::InvalidHeader),
        };
        if compression_method != 0 || filter_method != 0 || interlace_method > 1 {
            return Err(Error::InvalidHeader);
        }
        Self::new(width, height, bit_depth, color_type, interlace_method == 1)
    }

    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L2030
    pub(crate) fn new(
        width: u32,
        height: u32,
        bit_depth: u8,
        color_type: ColorType,
        interlaced: bool,
    ) -> Result<Self> {
        if width == 0 || width > MAX_U31 || height == 0 || height > MAX_U31 {
            return Err(Error::InvalidHeader);
        }
        let depth_fits = match color_type {
            ColorType::Grayscale => matches!(bit_depth, 1 | 2 | 4 | 8 | 16),
            ColorType::Indexed => matches!(bit_depth, 1 | 2 | 4 | 8),
            ColorType::Truecolor | ColorType::GrayscaleAlpha | ColorType::TruecolorAlpha => {
                matches!(bit_depth, 8 | 16)
            }
        };
        if !depth_fits {
            return Err(Error::InvalidHeader);
        }
        let header = Self {
            width,
            height,
            bit_depth,
            color_type,
            interlaced,
        };
        // A row has to fit in 32 bits, behind its filter type as well as expanded to RGBA.
        let width = width as usize;
        if header.row_bytes(width).max(width * 4) >= u32::MAX as usize {
            return Err(Error::ImageTooLarge);
        }
        Ok(header)
    }

    /// The distance between a byte and the one the filters pair it with.
    pub(crate) fn bytes_per_pixel(self) -> usize {
        usize::from(self.color_type.channels() * self.bit_depth / 8).max(1)
    }

    fn row_bytes(self, width: usize) -> usize {
        (usize::from(self.color_type.channels() * self.bit_depth) * width).div_ceil(8)
    }

    /// The passes that have pixels, in the order they are stored.
    pub(crate) fn passes(self) -> impl Iterator<Item = Pass> {
        let passes: &[_] = if self.interlaced {
            &ADAM7
        } else {
            &NOT_INTERLACED
        };
        passes
            .iter()
            .filter_map(move |&(x_start, y_start, x_step, y_step)| {
                let width = (self.width as usize)
                    .saturating_sub(x_start)
                    .div_ceil(x_step);
                let height = (self.height as usize)
                    .saturating_sub(y_start)
                    .div_ceil(y_step);
                (width != 0 && height != 0).then(|| Pass {
                    width,
                    height,
                    row_bytes: self.row_bytes(width),
                    x_start,
                    x_step,
                    y_start,
                    y_step,
                })
            })
    }
}
