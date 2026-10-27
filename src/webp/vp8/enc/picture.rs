//! `picture_csp_enc.c`, `picture_tools_enc.c` and `dsp/yuv.h`: from RGBA to the YUV 4:2:0 planes that get encoded.

use super::tables::{GAMMA_TO_LINEAR, LINEAR_TO_GAMMA};
use crate::util::{Checked, SliceExt, try_vec};
use crate::{Input, Result};

pub(super) struct Picture {
    pub(super) width: usize,
    pub(super) height: usize,
    /// `width * height` samples.
    pub(super) y: Vec<u8>,
    /// The width of `u` and `v`.
    pub(super) uv_width: usize,
    pub(super) u: Vec<u8>,
    pub(super) v: Vec<u8>,
    /// `width * height` samples, if one of them is not 255.
    pub(super) a: Option<Vec<u8>>,
}

// Gamma correction, which makes up for the resolution that subsampling the chroma loses

/// The precision of the fractional part of an index into `LINEAR_TO_GAMMA`.
const GAMMA_TAB_FIX: u32 = 7;

#[inline(always)]
fn gamma_to_linear(v: u8) -> Checked<u32> {
    Ok(u32::from(GAMMA_TO_LINEAR.at(usize::from(v))?))
}

/// From four times a linear value to four times a sample.
#[inline(always)]
fn linear_to_gamma(v: u32) -> Checked<u16> {
    let tab_pos = (v >> (GAMMA_TAB_FIX + 2)) as usize;
    let scale = 1 << (GAMMA_TAB_FIX + 2);
    let x = (v & (scale - 1)) as i32;
    let v0 = LINEAR_TO_GAMMA.at(tab_pos)?;
    let v1 = LINEAR_TO_GAMMA.at(tab_pos + 1)?;
    let y = v1 * x + v0 * (scale as i32 - x);
    Ok(((y + (1 << GAMMA_TAB_FIX >> 1)) >> GAMMA_TAB_FIX) as u16)
}

// RGB -> YUV conversion

const YUV_FIX: u32 = 16;
const YUV_HALF: i32 = 1 << (YUV_FIX - 1);

#[inline(always)]
fn rgb_to_y(r: u8, g: u8, b: u8) -> u8 {
    let luma = 16839 * i32::from(r) + 33059 * i32::from(g) + 6420 * i32::from(b);
    ((luma + YUV_HALF + (16 << YUV_FIX)) >> YUV_FIX) as u8
}

/// `uv` is for the sum of four pixels.
#[inline(always)]
fn clip_uv(uv: i32) -> u8 {
    ((uv + (YUV_HALF << 2) + (128 << (YUV_FIX + 2))) >> (YUV_FIX + 2)).clamp(0, 255) as u8
}

fn convert_row_to_y(rgba: &[u8], dst: &mut [u8]) {
    for (&[r, g, b, _], dst) in rgba.as_chunks().0.iter().zip(dst) {
        *dst = rgb_to_y(r, g, b);
    }
}

/// Returns whether the row is opaque.
fn extract_alpha(rgba: &[u8], dst: &mut [u8]) -> bool {
    let mut alpha_mask = 0xff;
    for (&[_, _, _, a], dst) in rgba.as_chunks().0.iter().zip(dst) {
        *dst = a;
        alpha_mask &= a;
    }
    alpha_mask == 0xff
}

fn is_opaque(rgba: &[u8]) -> bool {
    let alpha_mask = rgba.as_chunks().0.iter();
    alpha_mask.fold(0xff, |mask, &[_, _, _, a]| mask & a) == 0xff
}

/// Four times the average of four samples.
#[inline(always)]
fn sum4(samples: [u8; 4]) -> Checked<u16> {
    let [a, b, c, d] = samples;
    linear_to_gamma(
        gamma_to_linear(a)? + gamma_to_linear(b)? + gamma_to_linear(c)? + gamma_to_linear(d)?,
    )
}

/// `sum4` with the alpha values, which add up to `total_a`, as weights.
#[inline(always)]
fn linear_to_gamma_weighted(samples: [u8; 4], alphas: [u8; 4], total_a: u32) -> Checked<u16> {
    const ALPHA_FIX: u32 = 19;
    let mut sum = 0;
    for (sample, alpha) in samples.into_iter().zip(alphas) {
        sum += u32::from(alpha) * gamma_to_linear(sample)?;
    }
    // Not quite `4 * sum / total_a`.
    let inv_alpha = (1 << ALPHA_FIX) / total_a.max(1);
    linear_to_gamma((sum * inv_alpha) >> (ALPHA_FIX - 2))
}

/// R, G and B for 2x2 pixels, each four times its average.
type Rgb = [u16; 3];

/// The four pixels of each 2x2 block of two rows. The last column of an odd width counts twice.
fn blocks_2x2<'a>(row0: &'a [u8], row1: &'a [u8]) -> impl Iterator<Item = [[u8; 4]; 4]> + 'a {
    let (pairs0, last0) = row0.as_chunks::<8>();
    let (pairs1, last1) = row1.as_chunks::<8>();
    let split = |&[r0, g0, b0, a0, r1, g1, b1, a1]: &[u8; 8]| [[r0, g0, b0, a0], [r1, g1, b1, a1]];
    let pairs = pairs0.iter().zip(pairs1).map(move |(pair0, pair1)| {
        let ([p0, p1], [p2, p3]) = (split(pair0), split(pair1));
        [p0, p1, p2, p3]
    });
    let last = last0.as_chunks().0.iter().zip(last1.as_chunks().0);
    pairs.chain(last.map(|(&p0, &p1)| [p0, p0, p1, p1]))
}

#[inline(always)]
fn channels(pixels: [[u8; 4]; 4]) -> [[u8; 4]; 4] {
    let [
        [r0, g0, b0, a0],
        [r1, g1, b1, a1],
        [r2, g2, b2, a2],
        [r3, g3, b3, a3],
    ] = pixels;
    [
        [r0, r1, r2, r3],
        [g0, g1, g2, g3],
        [b0, b1, b2, b3],
        [a0, a1, a2, a3],
    ]
}

fn accumulate_rgb(row0: &[u8], row1: &[u8], dst: &mut [Rgb]) -> Checked {
    for (pixels, dst) in blocks_2x2(row0, row1).zip(dst) {
        let [r, g, b, _] = channels(pixels);
        *dst = [sum4(r)?, sum4(g)?, sum4(b)?];
    }
    Ok(())
}

fn accumulate_rgba(row0: &[u8], row1: &[u8], dst: &mut [Rgb]) -> Checked {
    for (pixels, dst) in blocks_2x2(row0, row1).zip(dst) {
        let [r, g, b, a] = channels(pixels);
        let total_a = a.iter().map(|&a| u32::from(a)).sum();
        *dst = if total_a == 4 * 0xff || total_a == 0 {
            [sum4(r)?, sum4(g)?, sum4(b)?]
        } else {
            [
                linear_to_gamma_weighted(r, a, total_a)?,
                linear_to_gamma_weighted(g, a, total_a)?,
                linear_to_gamma_weighted(b, a, total_a)?,
            ]
        };
    }
    Ok(())
}

fn convert_rgb_to_uv(rgb: &[Rgb], u: &mut [u8], v: &mut [u8]) {
    for ((rgb, u), v) in rgb.iter().zip(u).zip(v) {
        let [r, g, b] = rgb.map(i32::from);
        *u = clip_uv(-9719 * r - 19081 * g + 28800 * b);
        *v = clip_uv(28800 * r - 24116 * g - 4684 * b);
    }
}

impl Picture {
    /// `ImportYUVAFromRGBA`
    pub(super) fn import(input: &Input<'_>) -> Result<Self> {
        let (width, height) = (input.width, input.height);
        let mut has_alpha = false;
        for y in 0..height {
            if !is_opaque(input.row(y)?) {
                has_alpha = true;
                break;
            }
        }

        let (uv_width, uv_height) = (width.div_ceil(2), height.div_ceil(2));
        let mut pic = Self {
            width,
            height,
            y: try_vec(0, width * height)?,
            uv_width,
            u: try_vec(0, uv_width * uv_height)?,
            v: try_vec(0, uv_width * uv_height)?,
            a: None,
        };
        let mut alpha = try_vec(0, if has_alpha { width * height } else { 0 })?;
        let mut tmp_rgb = try_vec([0; 3], uv_width)?;

        let uv_rows = pic
            .u
            .chunks_exact_mut(uv_width)
            .zip(pic.v.chunks_exact_mut(uv_width));
        // Two rows at a time. The last row of an odd height counts twice.
        for ((i, dst_y), (dst_u, dst_v)) in pic.y.chunks_mut(2 * width).enumerate().zip(uv_rows) {
            let row0 = input.row(2 * i)?;
            let row1 = input.row((2 * i + 1).min(height - 1))?;
            for (dst_y, row) in dst_y.chunks_exact_mut(width).zip([row0, row1]) {
                convert_row_to_y(row, dst_y);
            }
            let mut rows_have_alpha = false;
            let dst_a = alpha.chunks_exact_mut(width).skip(2 * i);
            for (dst_a, row) in dst_a.zip([row0, row1]) {
                rows_have_alpha |= !extract_alpha(row, dst_a);
            }
            if rows_have_alpha {
                accumulate_rgba(row0, row1, &mut tmp_rgb)?;
            } else {
                accumulate_rgb(row0, row1, &mut tmp_rgb)?;
            }
            convert_rgb_to_uv(&tmp_rgb, dst_u, dst_v);
        }
        pic.a = has_alpha.then_some(alpha);
        Ok(pic)
    }

    /// `WebPCleanupTransparentArea`: what cannot be seen may as well be easy to compress.
    pub(super) fn cleanup_transparent_area(&mut self) -> Checked {
        const SIZE: usize = 8;
        let Some(alpha) = &self.a else {
            return Ok(());
        };
        for y in (0..self.height).step_by(SIZE) {
            let h = SIZE.min(self.height - y);
            let mut values = None;
            for x in (0..self.width).step_by(SIZE) {
                let w = SIZE.min(self.width - x);
                let start = y * self.width + x;
                let transparent = smoothen_block(alpha, &mut self.y, self.width, start, w, h)?;
                if w < SIZE || h < SIZE {
                    continue;
                }
                if !transparent {
                    values = None;
                    continue;
                }
                // A run of transparent blocks takes the color of the first sample of the first one.
                let uv_start = y / 2 * self.uv_width + x / 2;
                let [value_y, value_u, value_v] = match values {
                    Some(values) => values,
                    None => [
                        self.y.at(start)?,
                        self.u.at(uv_start)?,
                        self.v.at(uv_start)?,
                    ],
                };
                values = Some([value_y, value_u, value_v]);
                flatten(&mut self.y, value_y, self.width, start, SIZE)?;
                flatten(&mut self.u, value_u, self.uv_width, uv_start, SIZE / 2)?;
                flatten(&mut self.v, value_v, self.uv_width, uv_start, SIZE / 2)?;
            }
        }
        Ok(())
    }
}

fn flatten(plane: &mut [u8], value: u8, stride: usize, start: usize, size: usize) -> Checked {
    for row in plane.sub_mut(start..)?.chunks_mut(stride).take(size) {
        row.sub_mut(..size)?.fill(value);
    }
    Ok(())
}

/// Gives the transparent pixels of a block the average luma of the others. Returns whether all are transparent.
fn smoothen_block(
    alpha: &[u8],
    luma: &mut [u8],
    stride: usize,
    start: usize,
    w: usize,
    h: usize,
) -> Checked<bool> {
    let alpha = alpha.sub(start..)?;
    let luma = luma.sub_mut(start..)?;
    let (mut sum, mut count) = (0, 0);
    for (alpha, luma) in alpha.chunks(stride).zip(luma.chunks(stride)).take(h) {
        for (&alpha, &luma) in alpha.iter().zip(luma).take(w) {
            if alpha != 0 {
                count += 1;
                sum += u32::from(luma);
            }
        }
    }
    if count > 0 && count < (w * h) as u32 {
        let avg = (sum / count) as u8;
        let rows = alpha.chunks(stride).zip(luma.chunks_mut(stride));
        for (alpha, luma) in rows.take(h) {
            for (&alpha, luma) in alpha.iter().zip(luma).take(w) {
                if alpha == 0 {
                    *luma = avg;
                }
            }
        }
    }
    Ok(count == 0)
}
