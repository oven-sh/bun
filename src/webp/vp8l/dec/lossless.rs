//! `lossless.c`: the inverse transforms and the conversion to RGBA.

use core::cell::Cell;
use core::mem::take;

use crate::util::{Bug, Checked, SliceExt};
use crate::vp8l::format_constants::{TransformType, sub_sample_size};
use crate::vp8l::predictors::{
    BLACK, Block, Pixel, add_pixels, block_of, first_pixel, predict, uses_left,
};

/// The size of `Transform::data` for `ColorIndexing`, whatever the number of colours, so that any index is valid.
pub(super) const COLOR_MAP_SIZE: usize = 256;

pub(super) struct Transform {
    pub(super) kind: TransformType,
    /// The blocks that share an entry of `data` are `1 << bits` pixels wide and high. For `ColorIndexing`, a pixel
    /// holds the indices of `1 << bits` pixels.
    pub(super) bits: u32,
    /// The size of the image that the inverse transform makes.
    pub(super) xsize: usize,
    pub(super) ysize: usize,
    /// Pixels as 0xAARRGGBB.
    pub(super) data: Vec<u32>,
}

/// `block` without its first pixel.
#[inline(always)]
fn shift(block: Block) -> Block {
    let [_, _, _, _, b0, b1, b2, b3, c0, c1, c2, c3, d0, d1, d2, d3] = block;
    [b0, b1, b2, b3, c0, c1, c2, c3, d0, d1, d2, d3, 0, 0, 0, 0]
}

/// `block` without its first pixel, followed by the first pixel of `last`.
#[inline(always)]
fn shift_in(block: Block, last: Block) -> Block {
    let [_, _, _, _, b0, b1, b2, b3, c0, c1, c2, c3, d0, d1, d2, d3] = block;
    let [l0, l1, l2, l3] = first_pixel(last);
    [
        b0, b1, b2, b3, c0, c1, c2, c3, d0, d1, d2, d3, l0, l1, l2, l3,
    ]
}

fn blocks(pixels: &[Pixel]) -> &[Block] {
    pixels.as_flattened().as_chunks().0
}

/// `VP8LPredictorsAdd[MODE]` for the pixels `x..x_end` of `row`, which is below `upper`. `x` is not 0.
// Not inlined, because the compiler makes better loops of the modes one at a time than of all in one function.
#[inline(never)]
fn predictor_add<const MODE: u32>(
    upper: &[Pixel],
    row: &mut [Pixel],
    x: usize,
    x_end: usize,
) -> Checked {
    let (done, out) = row.sub_mut(..x_end)?.halves_mut(x)?;
    let first = *done.first().ok_or(Bug)?;
    let mut left = block_of(*done.last().ok_or(Bug)?);
    let (top_left, top, top_right) = (upper.sub(x - 1..)?, upper.sub(x..)?, upper.sub(x + 1..)?);

    let num_whole = out.len().min(top_right.len()) & !3;
    let (whole, rest) = out.halves_mut(num_whole)?;
    let neighbors = blocks(top_left)
        .iter()
        .zip(blocks(top))
        .zip(blocks(top_right));
    let whole = whole.as_flattened_mut().as_chunks_mut().0;
    for (out, ((&top_left, &top), &top_right)) in whole.iter_mut().zip(neighbors) {
        if !uses_left(MODE) {
            *out = add_pixels(*out, predict(MODE, left, top_left, top, top_right));
            continue;
        }
        let (mut residuals, mut top_left, mut top, mut top_right) =
            (*out, top_left, top, top_right);
        for _ in 0..4 {
            left = add_pixels(residuals, predict(MODE, left, top_left, top, top_right));
            *out = shift_in(*out, left);
            residuals = shift(residuals);
            (top_left, top, top_right) = (shift(top_left), shift(top), shift(top_right));
        }
    }

    // To the top right of the last pixel of a row is the first pixel of that row.
    let top_right = top_right.sub(num_whole..)?.iter().chain([&first]);
    let (top_left, top) = (top_left.sub(num_whole..)?, top.sub(num_whole..)?);
    let neighbors = top_left.iter().zip(top).zip(top_right);
    for (out, ((&top_left, &top), &top_right)) in rest.iter_mut().zip(neighbors) {
        let (top_left, top, top_right) = (block_of(top_left), block_of(top), block_of(top_right));
        left = add_pixels(
            block_of(*out),
            predict(MODE, left, top_left, top, top_right),
        );
        *out = first_pixel(left);
    }
    Ok(())
}

fn predictor_add_mode(
    mode: u32,
    upper: &[Pixel],
    row: &mut [Pixel],
    x: usize,
    x_end: usize,
) -> Checked {
    match mode {
        1 => predictor_add::<1>(upper, row, x, x_end),
        2 => predictor_add::<2>(upper, row, x, x_end),
        3 => predictor_add::<3>(upper, row, x, x_end),
        4 => predictor_add::<4>(upper, row, x, x_end),
        5 => predictor_add::<5>(upper, row, x, x_end),
        6 => predictor_add::<6>(upper, row, x, x_end),
        7 => predictor_add::<7>(upper, row, x, x_end),
        8 => predictor_add::<8>(upper, row, x, x_end),
        9 => predictor_add::<9>(upper, row, x, x_end),
        10 => predictor_add::<10>(upper, row, x, x_end),
        11 => predictor_add::<11>(upper, row, x, x_end),
        12 => predictor_add::<12>(upper, row, x, x_end),
        13 => predictor_add::<13>(upper, row, x, x_end),
        _ => predictor_add::<0>(upper, row, x, x_end),
    }
}

/// `VP8LAddGreenToBlueAndRed`
fn add_green_to_blue_and_red(pixels: &mut [Pixel]) {
    for pixel in pixels {
        let argb = u32::from_le_bytes(*pixel);
        let green = (argb >> 8) & 0xff;
        let red_blue = (argb & 0x00ff_00ff) + ((green << 16) | green);
        *pixel = ((argb & 0xff00_ff00) | (red_blue & 0x00ff_00ff)).to_le_bytes();
    }
}

#[inline(always)]
fn color_transform_delta(color_pred: i8, color: i8) -> i32 {
    (i32::from(color_pred) * i32::from(color)) >> 5
}

/// `VP8LTransformColorInverse`, with the multipliers as `color_code` packs them.
#[inline]
fn transform_color_inverse(color_code: u32, pixels: &mut [Pixel]) {
    let [green_to_red, green_to_blue, red_to_blue, _] = color_code.to_le_bytes().map(|m| m as i8);
    for pixel in pixels {
        let argb = u32::from_le_bytes(*pixel);
        let green = (argb >> 8) as i8;
        let mut new_red = ((argb >> 16) & 0xff) as i32;
        let mut new_blue = (argb & 0xff) as i32;
        new_red += color_transform_delta(green_to_red, green);
        new_red &= 0xff;
        new_blue += color_transform_delta(green_to_blue, green);
        new_blue += color_transform_delta(red_to_blue, new_red as i8);
        new_blue &= 0xff;
        let argb = (argb & 0xff00_ff00) | ((new_red as u32) << 16) | new_blue as u32;
        *pixel = argb.to_le_bytes();
    }
}

impl Transform {
    /// `rows` starts with the row above `y_start`, if there is one.
    fn predictor_inverse(&self, y_start: usize, y_end: usize, mut rows: &mut [Pixel]) -> Checked {
        let width = self.xsize;
        let tile_width = 1 << self.bits;
        let tiles_per_row = sub_sample_size(width, self.bits);
        for y in y_start..y_end {
            let (upper, below) = take(&mut rows).halves_mut(width)?;
            let row = below.sub_mut(..width)?;
            let first = row.at_mut(0)?;
            let above = if y == 0 { BLACK } else { upper.at(0)? };
            *first = first_pixel(add_pixels(block_of(*first), block_of(above)));
            if y == 0 {
                if width > 1 {
                    predictor_add::<1>(upper, row, 1, width)?;
                }
            } else {
                let modes = self.data.sub((y >> self.bits) * tiles_per_row..)?;
                let mut modes = modes.iter().map(|mode| (mode >> 8) & 0xf).peekable();
                let mut x = 1;
                while x < width {
                    let mode = modes.next().ok_or(Bug)?;
                    let mut x_end = (x & !(tile_width - 1)) + tile_width;
                    // The tiles that follow with the same mode are done along with this one.
                    while modes
                        .next_if(|&next| next == mode && x_end < width)
                        .is_some()
                    {
                        x_end += tile_width;
                    }
                    let x_end = x_end.min(width);
                    predictor_add_mode(mode, upper, row, x, x_end)?;
                    x = x_end;
                }
            }
            rows = below;
        }
        Ok(())
    }

    fn color_space_inverse(&self, y_start: usize, rows: &mut [Pixel]) -> Checked {
        let tiles_per_row = sub_sample_size(self.xsize, self.bits);
        for (y, row) in (y_start..).zip(rows.chunks_exact_mut(self.xsize)) {
            let codes = self.data.sub((y >> self.bits) * tiles_per_row..)?;
            for (tile, &color_code) in row.chunks_mut(1 << self.bits).zip(codes) {
                // Without multipliers, which is common, nothing changes.
                if color_code & 0x00ff_ffff != 0 {
                    transform_color_inverse(color_code, tile);
                }
            }
        }
        Ok(())
    }

    /// Sets the rows `dst` to `value` of the colours. Each of `indices` holds the indices of `1 << bits` pixels of a
    /// row, the first one in the lowest bits.
    #[inline(always)]
    fn color_index_inverse<T>(
        &self,
        mut indices: impl Iterator<Item = u8>,
        dst: &[Cell<T>],
        value: impl Fn(u32) -> T,
    ) -> Checked {
        let color_map = self.data.array_at::<COLOR_MAP_SIZE>(0)?;
        if self.bits == 0 {
            for (dst, index) in dst.iter().zip(indices) {
                dst.set(value(color_map.at(index.into())?));
            }
            return Ok(());
        }
        let bits_per_pixel = 8 >> self.bits;
        let bit_mask = (1 << bits_per_pixel) - 1;
        for row in dst.chunks_exact(self.xsize) {
            for (pixels, mut packed_pixels) in row.chunks(1 << self.bits).zip(&mut indices) {
                for dst in pixels {
                    dst.set(value(color_map.at((packed_pixels & bit_mask).into())?));
                    packed_pixels >>= bits_per_pixel;
                }
            }
        }
        Ok(())
    }

    /// `VP8LColorIndexInverseTransformAlpha`: whole rows, of which only the green channel is stored.
    pub(super) fn color_index_inverse_alpha(&self, src: &[u8], dst: &mut [u8]) -> Checked {
        let dst = Cell::from_mut(dst).as_slice_of_cells();
        self.color_index_inverse(src.iter().copied(), dst, |argb| (argb >> 8) as u8)
    }

    /// `VP8LInverseTransform` of the rows `row_start..row_end`. They are in `rows_in`, or else already where they end
    /// up, which is from `cache[top]` on. What is in front of that belongs to the predictor transform, which keeps the
    /// last row it made there.
    pub(super) fn inverse(
        &self,
        row_start: usize,
        row_end: usize,
        rows_in: Option<&[u32]>,
        cache: &mut [Pixel],
        top: usize,
    ) -> Checked {
        let width = self.xsize;
        let num_rows = row_end.checked_sub(row_start).ok_or(Bug)?;
        let end = top + num_rows * width;
        // Bundled pixels go to the end, so that none is overwritten before it is read.
        let in_width = match self.kind {
            TransformType::ColorIndexing => sub_sample_size(width, self.bits),
            _ => width,
        };
        let in_start = end - num_rows * in_width;
        match rows_in {
            Some(rows_in) => copy_pixels(rows_in, cache.sub_mut(in_start..end)?),
            None if in_start != top => cache.move_within(top, in_start, end - in_start)?,
            None => {}
        }
        match self.kind {
            TransformType::SubtractGreen => add_green_to_blue_and_red(cache.sub_mut(top..end)?),
            TransformType::Predictor => {
                let rows = cache.sub_mut(top.checked_sub(width).ok_or(Bug)?..end)?;
                self.predictor_inverse(row_start, row_end, rows)?;
                if row_end != self.ysize {
                    rows.move_within(num_rows * width, 0, width)?;
                }
            }
            TransformType::CrossColor => {
                self.color_space_inverse(row_start, cache.sub_mut(top..end)?)?;
            }
            TransformType::ColorIndexing => {
                let out = Cell::from_mut(cache.sub_mut(top..end)?).as_slice_of_cells();
                let bundled = out.sub(in_start - top..)?;
                let indices = bundled.iter().map(|pixel| green(pixel.get()));
                self.color_index_inverse(indices, out, u32::to_le_bytes)?;
            }
        }
        Ok(())
    }
}

#[inline(always)]
pub(super) fn green(pixel: Pixel) -> u8 {
    let [_, green, _, _] = pixel;
    green
}

/// From 0xAARRGGBB.
pub(super) fn copy_pixels(src: &[u32], dst: &mut [Pixel]) {
    for (dst, argb) in dst.iter_mut().zip(src) {
        *dst = argb.to_le_bytes();
    }
}

/// `VP8LConvertBGRAToRGBA`
pub(super) fn convert_bgra_to_rgba(src: &[Pixel], dst: &mut [u8]) {
    for (dst, &[blue, green, red, alpha]) in dst.as_chunks_mut().0.iter_mut().zip(src) {
        *dst = [red, green, blue, alpha];
    }
}
