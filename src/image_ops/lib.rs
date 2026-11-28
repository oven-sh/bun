//! Resizes, rotates, flips and recolors images of 8-bit RGBA, for `Bun.Image`. All CPUs give the same bytes,
//! but for `modulate`, which can round differently without fused multiply-add.
#![forbid(unsafe_code)]

mod modulate;
mod palette;
mod resize;
mod rotate;

use bun_simd::mem::Output;
pub use resize::Filter;

pub type Pixel = [u8; 4];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// A word wide: with a one-byte error, a `Result` is copied in pieces that defeat store-to-load forwarding.
#[repr(usize)]
pub enum Error {
    /// Of an image that is empty or has fewer bytes than pixels, or of a palette.
    InvalidSize,
    OutOfMemory,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;

fn with_room<T>(len: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(len).map_err(|_| Error::OutOfMemory)?;
    Ok(vec)
}

/// Within the capacity. `Vec::resize` checks each element for overlap in hardened builds.
#[inline(always)]
fn fill_up<T: Copy>(vec: &mut Vec<T>, len: usize, value: T) {
    debug_assert!(len <= vec.capacity());
    vec.resize_with(len, || value);
}

fn filled<T: Copy>(len: usize, value: T) -> Result<Vec<T>> {
    let mut vec = with_room(len)?;
    fill_up(&mut vec, len, value);
    Ok(vec)
}

/// In pixels.
fn area(width: usize, height: usize) -> Result<usize> {
    match width.checked_mul(height) {
        Some(0) => Err(Error::InvalidSize),
        area => area.ok_or(Error::OutOfMemory),
    }
}

/// `width` by `height` pixels, and at least one.
#[derive(Clone, Copy)]
pub struct Image<'a> {
    pixels: &'a [Pixel],
    width: usize,
    height: usize,
}

impl<'a> Image<'a> {
    pub fn new(rgba: &'a [u8], width: u32, height: u32) -> Result<Self> {
        Self::of_pixels(rgba.as_chunks().0, width as usize, height as usize)
    }

    fn of_pixels(pixels: &'a [Pixel], width: usize, height: usize) -> Result<Self> {
        let pixels = pixels.get(..area(width, height)?);
        Ok(Self {
            pixels: pixels.ok_or(Error::InvalidSize)?,
            width,
            height,
        })
    }

    /// Across, then down: it needs memory for `width` by the height of `self` on the way.
    pub fn resize(self, width: u32, height: u32, filter: Filter) -> Result<Vec<u8>> {
        resize::resize(self, width as usize, height as usize, filter)
    }

    /// Clockwise, by 90, 180 or 270 degrees. Any other number makes a copy.
    pub fn rotate(self, degrees: u32) -> Result<Vec<u8>> {
        let mut out = with_room(self.pixels.len())?;
        match degrees {
            90 if self.height == 1 => out.extend_from_slice(self.pixels),
            270 if self.height == 1 => rotate::reverse_rows(self.pixels, self.width, &mut out),
            90 => rotate::quarter_turn::<true>(self, &mut out),
            180 if self.pixels.len() <= rotate::FEW => out.extend(self.pixels.iter().rev()),
            180 => rotate::reverse_rows(self.pixels, self.pixels.len(), &mut out),
            270 => rotate::quarter_turn::<false>(self, &mut out),
            _ => out.extend_from_slice(self.pixels),
        }
        Ok(out.into_flattened())
    }

    /// Left becomes right.
    pub fn flip_horizontally(self) -> Result<Vec<u8>> {
        let mut out = with_room(self.pixels.len())?;
        rotate::reverse_rows(self.pixels, self.width, &mut out);
        Ok(out.into_flattened())
    }

    /// Top becomes bottom.
    pub fn flip_vertically(self) -> Result<Vec<u8>> {
        let mut out = with_room(self.pixels.len())?;
        {
            let out = &mut Output::append(&mut out, self.pixels.len());
            let mut rest = self.pixels;
            // `rchunks_exact` divides.
            while let Some(above) = rest.len().checked_sub(self.width) {
                out.push(&rest[above..]);
                rest = &rest[..above];
            }
        }
        Ok(out.into_flattened())
    }

    /// For each pixel, the index of the first of the nearest colors in `palette`, which has 1 to 256.
    pub fn to_indices(self, palette: &[Pixel], dither: bool) -> Result<Vec<u8>> {
        if !(1..=256).contains(&palette.len()) {
            return Err(Error::InvalidSize);
        }
        let mut indices = filled(self.pixels.len(), 0)?;
        if dither {
            let mut errors = filled(self.width + 2, [0; 4])?;
            palette::dither(self, palette, &mut errors, &mut indices);
        } else {
            palette::nearest(self.pixels, palette, &mut indices);
        }
        Ok(indices)
    }
}

/// `saturation` moves each channel toward the luma of the pixel (0 is gray, 1 changes nothing) or away from it, and
/// `brightness` multiplies the result. Both are finite. Alpha stays as it is.
pub fn modulate(rgba: &mut [u8], brightness: f32, saturation: f32) {
    modulate::modulate(rgba.as_chunks_mut().0, brightness, saturation);
}

/// The least and the greatest value of each byte, from the lowest.
pub fn extremes(pixels: &[u32]) -> [Pixel; 2] {
    palette::extremes(pixels)
}
