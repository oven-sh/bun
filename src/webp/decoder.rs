//! WebP to 8-bit RGBA.

use bun_alloc::Lender;

use crate::error::{Error, Result};
use crate::riff::{Bitstream, Container, ImageChunk};
use crate::{lossless, lossy, slice, vec};

pub struct Image<'a> {
    /// `width * height * 4` bytes, rows from the top, not premultiplied.
    pub rgba: Vec<u8, Lender<'a>>,
    pub icc_profile: Option<Vec<u8>>,
}

impl<'a> Image<'a> {
    fn new(
        pixels: Vec<[u8; 4], Lender<'a>>,
        len: usize,
        icc_profile: Option<Vec<u8>>,
    ) -> Result<Self> {
        if pixels.len() != len {
            return Err(Error::Internal);
        }
        debug_assert!(len == 0 || pixels.capacity() == len);
        Ok(Self {
            rgba: pixels.into_flattened(),
            icc_profile,
        })
    }
}

/// A file whose dimensions are known.
pub struct Decoder<'a> {
    container: Container<'a>,
    width: u32,
    height: u32,
    /// An animation or the start of a file has dimensions all the same.
    frame: Result<Frame<'a>>,
}

enum Frame<'a> {
    Lossy {
        header: lossy::decoder::Header<'a>,
        alpha: Option<&'a [u8]>,
    },
    Lossless(lossless::decoder::Header<'a>),
}

impl<'a> Frame<'a> {
    fn new(chunk: ImageChunk<'a>) -> Result<Self> {
        Ok(match chunk.bitstream {
            Bitstream::Lossy { image, alpha } => Self::Lossy {
                header: lossy::decoder::Header::parse(image, chunk.declared_len)?,
                alpha,
            },
            Bitstream::Lossless { image } => {
                Self::Lossless(lossless::decoder::Header::parse(image)?)
            }
        })
    }

    fn dimensions(&self) -> (u32, u32) {
        match self {
            Self::Lossy { header, .. } => (header.width.into(), header.height.into()),
            Self::Lossless(header) => (header.width.into(), header.height.into()),
        }
    }
}

impl<'a> Decoder<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        let container = Container::new(bytes)?;
        let frame = container.image_chunk().and_then(Frame::new);
        let canvas = container.canvas.map(|it| (it.width, it.height));
        let (width, height) = match (&frame, canvas) {
            (Ok(frame), None) => frame.dimensions(),
            (Ok(frame), Some(canvas)) if frame.dimensions() == canvas => canvas,
            (Ok(_), Some(_)) => return Err(Error::InvalidContainer),
            (Err(Error::Animated | Error::UnexpectedEof), Some(canvas)) => canvas,
            (Err(error), _) => return Err(*error),
        };
        Ok(Self {
            container,
            width,
            height,
            frame,
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn decode(self, lender: Lender) -> Result<Image> {
        if !self.container.is_complete() {
            return Err(Error::UnexpectedEof);
        }
        let pixels = slice::checked(|| match self.frame? {
            Frame::Lossless(header) => header.decode(lender),
            Frame::Lossy { header, alpha } => header.decode(alpha, lender),
        })?;
        Image::new(
            pixels,
            self.width as usize * self.height as usize,
            self.container.icc_profile().map(vec::copied).transpose()?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_has_all_of_its_pixels() {
        let empty = |len| Image::new(Vec::new_in(Lender::NONE), len, None);
        assert!(empty(0).is_ok());
        assert_eq!(empty(1).err(), Some(Error::Internal));
    }
}
