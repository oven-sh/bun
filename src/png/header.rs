//! IHDR and what follows from it: the size of a row and the Adam7 passes.

use crate::error::{Error, Result};

/// The largest width, height and chunk length the format allows.
pub(crate) const MAX_U31: u32 = i32::MAX as u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorType {
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
    pub bit_depth: u8,
    pub color_type: ColorType,
    pub interlaced: bool,
}

/// The rows of one reduced image. An image that is not interlaced has one, the image itself.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Pass {
    pub(crate) width: u32,
    pub(crate) height: u32,
    /// Without the filter byte.
    pub(crate) row_bytes: usize,
    pub(crate) x_start: usize,
    pub(crate) x_step: usize,
    pub(crate) y_start: usize,
    pub(crate) y_step: usize,
}

/// `(x_start, y_start, x_step, y_step)`
const ADAM7: [(u8, u8, u8, u8); 7] = [
    (0, 0, 8, 8),
    (4, 0, 8, 8),
    (0, 4, 4, 8),
    (2, 0, 4, 4),
    (0, 2, 2, 4),
    (1, 0, 2, 2),
    (0, 1, 1, 2),
];
const WHOLE: [(u8, u8, u8, u8); 1] = [(0, 0, 1, 1)];

impl Header {
    /// The 13 bytes of an IHDR chunk.
    pub(crate) fn parse(data: &[u8; 13]) -> Result<Self> {
        let [
            w0,
            w1,
            w2,
            w3,
            h0,
            h1,
            h2,
            h3,
            bit_depth,
            color,
            compression,
            filter,
            interlace,
        ] = *data;
        let color_type = match color {
            0 => ColorType::Grayscale,
            2 => ColorType::Truecolor,
            3 => ColorType::Indexed,
            4 => ColorType::GrayscaleAlpha,
            6 => ColorType::TruecolorAlpha,
            _ => return Err(Error::InvalidHeader),
        };
        if compression != 0 || filter != 0 || interlace > 1 {
            return Err(Error::InvalidHeader);
        }
        let header = Self {
            width: u32::from_be_bytes([w0, w1, w2, w3]),
            height: u32::from_be_bytes([h0, h1, h2, h3]),
            bit_depth,
            color_type,
            interlaced: interlace == 1,
        };
        header.check()?;
        Ok(header)
    }

    pub(crate) fn to_bytes(self) -> [u8; 13] {
        let [w0, w1, w2, w3] = self.width.to_be_bytes();
        let [h0, h1, h2, h3] = self.height.to_be_bytes();
        let color = self.color_type as u8;
        let interlace = u8::from(self.interlaced);
        [
            w0,
            w1,
            w2,
            w3,
            h0,
            h1,
            h2,
            h3,
            self.bit_depth,
            color,
            0,
            0,
            interlace,
        ]
    }

    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L2030
    pub(crate) fn check(self) -> Result<()> {
        if self.width == 0 || self.width > MAX_U31 || self.height == 0 || self.height > MAX_U31 {
            return Err(Error::InvalidHeader);
        }
        let depth_fits = match self.color_type {
            ColorType::Grayscale => matches!(self.bit_depth, 1 | 2 | 4 | 8 | 16),
            ColorType::Indexed => matches!(self.bit_depth, 1 | 2 | 4 | 8),
            ColorType::Truecolor | ColorType::GrayscaleAlpha | ColorType::TruecolorAlpha => {
                matches!(self.bit_depth, 8 | 16)
            }
        };
        if !depth_fits {
            return Err(Error::InvalidHeader);
        }
        // With its filter byte a row has to fit in 32 bits.
        // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L563
        if self
            .passes()
            .any(|pass| pass.row_bytes >= u32::MAX as usize)
        {
            return Err(Error::RowTooLong);
        }
        Ok(())
    }

    /// The distance between a byte and the one the filters pair it with.
    pub(crate) fn bytes_per_pixel(self) -> usize {
        usize::from(self.color_type.channels() * self.bit_depth / 8).max(1)
    }

    fn row_bytes(self, width: u32) -> usize {
        let bits = u64::from(self.color_type.channels() * self.bit_depth) * u64::from(width);
        bits.div_ceil(8) as usize
    }

    /// The passes that have pixels, in the order they are stored.
    pub(crate) fn passes(self) -> impl Iterator<Item = Pass> {
        let passes: &[_] = if self.interlaced { &ADAM7 } else { &WHOLE };
        passes
            .iter()
            .filter_map(move |&(x_start, y_start, x_step, y_step)| {
                let width = self
                    .width
                    .saturating_sub(u32::from(x_start))
                    .div_ceil(u32::from(x_step));
                let height = self
                    .height
                    .saturating_sub(u32::from(y_start))
                    .div_ceil(u32::from(y_step));
                (width != 0 && height != 0).then(|| Pass {
                    width,
                    height,
                    row_bytes: self.row_bytes(width),
                    x_start: usize::from(x_start),
                    x_step: usize::from(x_step),
                    y_start: usize::from(y_start),
                    y_step: usize::from(y_step),
                })
            })
    }
}
