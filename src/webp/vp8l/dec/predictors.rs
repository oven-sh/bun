//! `lossless.c`: pixels in blocks of 16 bytes, operations on which the compiler turns into vector instructions.

use crate::vp8l::common::ARGB_BLACK;
use crate::vp8l::predictors::Pixels;

/// The blue, green, red and alpha of a pixel.
pub(super) type Pixel = [u8; 4];

/// Four pixels.
pub(super) type Block = [u8; 16];

pub(super) const BLACK: Pixel = ARGB_BLACK.to_le_bytes();

/// `pixel`, followed by three pixels of no interest.
#[inline(always)]
pub(super) fn block_of(pixel: Pixel) -> Block {
    let [b, g, r, a] = pixel;
    [b, g, r, a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

#[inline(always)]
pub(super) fn first_pixel(block: Block) -> Pixel {
    let [b, g, r, a, ..] = block;
    [b, g, r, a]
}

#[inline(always)]
fn zip_with(a: Block, b: Block, f: impl Fn(u8, u8) -> u8) -> Block {
    let mut out = [0; 16];
    for ((out, a), b) in out.iter_mut().zip(a).zip(b) {
        *out = f(a, b);
    }
    out
}

/// `VP8LAddPixels`
#[inline(always)]
pub(super) fn add_pixels(a: Block, b: Block) -> Block {
    zip_with(a, b, u8::wrapping_add)
}

/// `VP8LAddPixels` of a single pixel.
pub(super) fn add_pixel(a: Pixel, b: Pixel) -> Pixel {
    first_pixel(add_pixels(block_of(a), block_of(b)))
}

/// The sum over the channels of the first pixel of the absolute differences.
#[inline(always)]
fn distance(a: Block, b: Block) -> u32 {
    first_pixel(zip_with(a, b, u8::abs_diff))
        .into_iter()
        .map(u32::from)
        .sum()
}

impl Pixels for Block {
    const BLACK: Self = {
        let [b, g, r, a] = BLACK;
        [b, g, r, a, b, g, r, a, b, g, r, a, b, g, r, a]
    };

    #[inline(always)]
    fn average2(a0: Self, a1: Self) -> Self {
        zip_with(a0, a1, |a0, a1| {
            ((u16::from(a0) + u16::from(a1)) >> 1) as u8
        })
    }

    /// Goes by the first pixel alone, which is all that a caller needs: this predictor looks at the pixel to the left.
    #[inline(always)]
    fn select(a: Self, b: Self, c: Self) -> Self {
        if distance(b, c) <= distance(a, c) {
            a
        } else {
            b
        }
    }

    #[inline(always)]
    fn clamped_add_subtract_full(c0: Self, c1: Self, c2: Self) -> Self {
        let up = zip_with(c1, c2, u8::saturating_sub);
        let down = zip_with(c2, c1, u8::saturating_sub);
        zip_with(
            zip_with(c0, up, u8::saturating_add),
            down,
            u8::saturating_sub,
        )
    }

    #[inline(always)]
    fn clamped_add_subtract_half(c0: Self, c1: Self, c2: Self) -> Self {
        zip_with(Self::average2(c0, c1), c2, |ave, c2| {
            let diff = i16::from(ave) - i16::from(c2);
            // The division rounds towards zero.
            let half = (diff + ((diff >> 15) & 1)) >> 1;
            (i16::from(ave) + half).clamp(0, 255) as u8
        })
    }
}
