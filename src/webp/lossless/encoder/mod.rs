//! Pixels to VP8L, as libwebp does it with method 4.

mod analysis;
mod bit_writer;
mod cache;
mod cheapest;
mod copies;
mod cross_color;
mod entropy;
mod groups;
mod histogram;
mod huffman;
mod image;
mod matches;
mod palette;
mod predictor;
mod prefix;
mod residuals;
mod tiles;

use self::analysis::Transforms;
use self::bit_writer::BitWriter;
use self::palette::{Colors, Palette};
use self::predictor::HiddenColors;
use super::{Argb, IMAGE_SIZE_BITS, SIGNATURE, TransformType, VERSION_BITS, bundle_bits};
use crate::array::At;
use crate::error::Result;
use crate::vec;

/// How hard to try, from 0 to 100.
#[derive(Clone, Copy)]
enum Quality {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L1466
    Palette = 20,
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/alpha_enc.c#L86
    Alpha = 32,
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/picture_enc.c#L290
    Picture = 70,
}

/// Each channel modulo 256.
#[inline(always)]
const fn sub(a: Argb, b: Argb) -> Argb {
    let alpha_green = (a | 0x00ff_00ff).wrapping_sub(b & 0xff00_ff00);
    let red_blue = (a | 0xff00_ff00).wrapping_sub(b & 0x00ff_00ff);
    (alpha_green & 0xff00_ff00) | (red_blue & 0x00ff_00ff)
}

/// The payload of a `VP8L` chunk.
// Out of line, so that the lossy encoder does not run on top of its stack frame.
#[inline(never)]
pub(crate) fn encode(
    rgba: &[[u8; 4]],
    width: usize,
    height: usize,
    has_alpha: bool,
) -> Result<Vec<u8>> {
    let hidden = if has_alpha {
        HiddenColors::Replaced
    } else {
        HiddenColors::Kept
    };
    let mut stream = Stream::new(width, height, Quality::Picture, hidden);
    let writer = &mut stream.writer;
    writer.append(SIGNATURE.into(), 8);
    writer.append(width as u64 - 1, IMAGE_SIZE_BITS);
    writer.append(height as u64 - 1, IMAGE_SIZE_BITS);
    writer.append_flag(has_alpha);
    writer.append(0, VERSION_BITS);

    let to_argb = |[red, green, blue, alpha]: [u8; 4]| match alpha {
        0 => 0,
        _ => Argb::from_le_bytes([blue, green, red, alpha]),
    };
    if let Some((bytes, colors, used)) = palette::index(rgba, to_argb)? {
        return stream.finish_with_bytes(&bytes, &colors, used);
    }
    let mut pixels = vec::with_room(rgba.len())?;
    pixels.extend(rgba.iter().map(|&pixel| to_argb(pixel)));
    let bits = stream.tile_bits(false);
    let tiles = tiles::count(width, height, bits.of_transforms);
    let transforms = analysis::for_colors(&pixels, width, tiles)?;
    stream.finish_with_colors(pixels, transforms, bits)
}

/// An image without a header, of which all channels but `green` are zero. `is_used` tells which values it has.
pub(crate) fn encode_green(
    green: &[u8],
    width: usize,
    height: usize,
    is_used: &[bool; 256],
) -> Result<Vec<u8>> {
    let mut colors = vec::array(0)?;
    for (color, green) in colors.iter_mut().zip(0..) {
        *color = green << 8;
    }
    let mut used = vec::with_room(is_used.len())?;
    used.extend((0..=u8::MAX).filter(|&green| *is_used.at(green.into())));
    let stream = Stream::new(width, height, Quality::Alpha, HiddenColors::Kept);
    stream.finish_with_bytes(green, &colors, used)
}

#[derive(Clone, Copy)]
struct TileBits {
    of_groups: u32,
    of_transforms: u32,
}

struct Stream {
    writer: BitWriter,
    width: usize,
    height: usize,
    quality: Quality,
    hidden: HiddenColors,
}

impl Stream {
    fn new(width: usize, height: usize, quality: Quality, hidden: HiddenColors) -> Self {
        Self {
            writer: BitWriter::default(),
            width,
            height,
            quality,
            hidden,
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L275
    fn tile_bits(&self, has_few_colors: bool) -> TileBits {
        const MAX_TILES: usize = 2600;
        let bits = if has_few_colors { 5 } else { 3 };
        let of_groups = tiles::fitted(bits, self.width, self.height, MAX_TILES);
        TileBits {
            of_groups,
            of_transforms: of_groups.min(cross_color::MAX_TILE_BITS),
        }
    }

    fn start_transform(&mut self, transform_type: TransformType) {
        self.writer.append_flag(true);
        self.writer.append(transform_type as u64, 2);
    }

    /// For an image that has a byte for each pixel, which stands for one of `colors`. Those that are `used` are sorted by it.
    fn finish_with_bytes(
        mut self,
        bytes: &[u8],
        colors: &Colors,
        used: Vec<u8>,
    ) -> Result<Vec<u8>> {
        let bits = self.tile_bits(true);
        let is_bundled = bundle_bits(used.len()) > 0;
        let tiles = tiles::count(self.width, self.height, bits.of_transforms);
        if !is_bundled
            && let Some(transforms) =
                analysis::for_bytes(bytes, colors, self.width, tiles, used.len())?
        {
            let mut pixels = vec::with_room(bytes.len())?;
            pixels.extend(bytes.iter().map(|&byte| *colors.at(byte.into())));
            return self.finish_with_colors(pixels, transforms, bits);
        }

        let palette = Palette::new(colors, used)?;
        let stored = palette.stored()?;
        self.start_transform(TransformType::ColorIndexing);
        self.writer.append(stored.len().saturating_sub(1) as u64, 8);
        image::write_subimage(&stored, stored.len(), Quality::Palette, &mut self.writer)?;
        let (pixels, width) = palette.apply(bytes, self.width)?;
        let options = image::Options {
            quality: self.quality,
            tile_bits: bits.of_groups,
            max_cache_bits: usize::BITS - palette.len().leading_zeros(),
            tries_near_copies: is_bundled,
        };
        self.finish(&pixels, width, options)
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L1512
    fn finish_with_colors(
        mut self,
        mut pixels: Vec<Argb>,
        transforms: Transforms,
        bits: TileBits,
    ) -> Result<Vec<u8>> {
        let (width, height, quality) = (self.width, self.height, self.quality);
        if transforms.subtract_green {
            self.start_transform(TransformType::SubtractGreen);
            for pixel in &mut pixels {
                let green = (*pixel >> 8) & 0xff;
                *pixel = sub(*pixel, green << 16 | green);
            }
        }
        if transforms.predictor {
            let (bits, hidden) = (bits.of_transforms, self.hidden);
            let modes = predictor::apply(&mut pixels, width, height, bits, hidden)?;
            self.start_transform(TransformType::Predictor);
            image::write_tiles(&modes, quality, &mut self.writer)?;
        }
        if transforms.cross_color {
            let tiles = cross_color::apply(&mut pixels, width, height, bits.of_transforms)?;
            self.start_transform(TransformType::CrossColor);
            image::write_tiles(&tiles, quality, &mut self.writer)?;
        }
        let options = image::Options {
            quality,
            tile_bits: bits.of_groups,
            max_cache_bits: cache::MAX_BITS,
            tries_near_copies: false,
        };
        self.finish(&pixels, width, options)
    }

    fn finish(mut self, pixels: &[Argb], width: usize, options: image::Options) -> Result<Vec<u8>> {
        self.writer.append_flag(false);
        image::finish_with(self.writer, pixels, width, self.height, options)
    }
}
