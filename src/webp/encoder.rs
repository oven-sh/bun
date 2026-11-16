//! 8-bit RGBA to WebP, with the settings of libwebp's `WebPEncodeRGBA()` and `WebPEncodeLosslessRGBA()`.

use crate::error::{Error, Result};
use crate::riff::{self, Bitstream};
use crate::{alpha, lossless, lossy, slice};

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/webp/encode.h#L298
const MAX_DIMENSION: u32 = 16383;

#[derive(Clone, Copy)]
pub enum Compression {
    /// Keeps every pixel but the color of the fully transparent ones.
    Lossless,
    /// `quality` is 0 to 100. The alpha channel stays lossless.
    Lossy { quality: u8 },
}

pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    compression: Compression,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    if !(1..=MAX_DIMENSION).contains(&width) || !(1..=MAX_DIMENSION).contains(&height) {
        return Err(Error::InvalidDimensions);
    }
    let (width, height) = (width as usize, height as usize);
    let (pixels, rest) = rgba.as_chunks::<4>();
    if pixels.len() != width * height || !rest.is_empty() {
        return Err(Error::InvalidBufferSize);
    }
    let has_alpha = pixels.chunks(256).any(|run| {
        let all = run.iter().map(|&it| u32::from_le_bytes(it));
        all.fold(u32::MAX, |all, it| all & it) >> 24 != 255
    });
    let icc_profile = icc_profile.filter(|profile| !profile.is_empty());
    slice::checked(|| match compression {
        Compression::Lossless => {
            let image = lossless::encoder::encode(pixels, width, height, has_alpha)?;
            let bitstream = Bitstream::Lossless { image: &image };
            riff::write(width, height, has_alpha, bitstream, icc_profile)
        }
        Compression::Lossy { quality } => {
            let image = lossy::encoder::encode(pixels, width, height, has_alpha, quality.min(100))?;
            let alpha = has_alpha
                .then(|| alpha::encoder::encode(pixels, width, height))
                .transpose()?;
            let bitstream = Bitstream::Lossy {
                image: &image,
                alpha: alpha.as_deref(),
            };
            riff::write(width, height, has_alpha, bitstream, icc_profile)
        }
    })
}
