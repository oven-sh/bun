//! The loops of `raster.rs` and `warp.rs` for processors with AVX2 or NEON. The results are the same, but for rounding when interpolating.

use std::ops::Range;

use super::blend::Factor;
use super::blur::{Kernel, Strip, convolve_strips};
use super::edges::{Edges, Shape};
use super::raster::{self, IntRect, Outlined, Pixel};
use super::scan::{Floats, Scanner, Sink, Stored};
use super::slant::{Gauge, Slant};
use super::warp::Samples;

#[cfg_attr(target_arch = "x86_64", path = "wide/avx2.rs")]
#[cfg_attr(target_arch = "aarch64", path = "wide/neon.rs")]
mod lanes;

pub use lanes::is_available;
use lanes::{
    Eight, Numbers, Sampler, add, change, cover, is_clear, is_opaque, kept, prefetch, scale, splat,
    spread, spread_pairs, weigh,
};

macro_rules! wide {
    ($($function:item)*) => {
        $(
            #[cfg_attr(target_arch = "x86_64", target_feature(enable = "avx2"))]
            #[cfg_attr(target_arch = "aarch64", target_feature(enable = "neon"))]
            $function
        )*
    };
}

#[inline(always)]
fn load(pixels: [Pixel; 8]) -> Eight {
    // SAFETY: both are 32 bytes, for which any value will do.
    unsafe { std::mem::transmute(pixels) }
}

#[inline(always)]
fn store(pixels: Eight) -> [Pixel; 8] {
    // SAFETY: as above.
    unsafe { std::mem::transmute(pixels) }
}

#[inline(always)]
fn join<T: Copy>([a, b, c, d]: [T; 4], [e, f, g, h]: [T; 4]) -> [T; 8] {
    [a, b, c, d, e, f, g, h]
}

/// Only for functions that are wide.
struct Filler<'a> {
    pixels: &'a mut [Pixel],
    color: Pixel,
}

impl Sink<Numbers> for Filler<'_> {
    #[inline(always)]
    fn eights(&mut self, places: &[u32], alphas: &[Stored]) {
        // SAFETY: the processor has the instructions.
        unsafe { cover_eights(self.pixels, self.color, places, alphas) };
    }

    #[inline(always)]
    fn expect(&self, place: u32) {
        prefetch(self.pixels.as_ptr().wrapping_add(place as usize + 4));
    }

    fn some(&mut self, place: usize, alphas: &[u8]) {
        raster::fill_through(
            &mut self.pixels[place..][..alphas.len()],
            self.color,
            alphas,
        );
    }

    #[inline(always)]
    fn run(&mut self, places: Range<usize>, alpha: u8) {
        match alpha & self.color[3] {
            255 => raster::set_row(&mut self.pixels[places], self.color),
            _ => raster::fill_row(&mut self.pixels[places], raster::scale(self.color, alpha)),
        }
    }
}

wide! {

#[inline]
fn over(target: Eight, source: Eight) -> Eight {
    add(source, scale(target, kept(source)))
}

/// `f` returns `None` for what stays. Instead of a remainder there is a last run that overlaps with the one before.
#[inline]
fn update<T: Copy>(row: &mut [Pixel], source: &[T], f: impl Fn(&[Pixel; 8], &[T; 8]) -> Option<Eight>) {
    let source = &source[..row.len()];
    if let (Some(pixels), Some(last)) = (row.last_chunk(), source.last_chunk()) {
        let end = if row.len().is_multiple_of(8) { None } else { f(pixels, last) };
        for (pixels, source) in row.as_chunks_mut().0.iter_mut().zip(source.as_chunks().0) {
            if let Some(result) = f(pixels, source) {
                *pixels = store(result);
            }
        }
        if let (Some(result), Some(pixels)) = (end, row.last_chunk_mut()) {
            *pixels = store(result);
        }
    } else if let (Some(a), Some(b), Some(c), Some(d)) = (row.first_chunk(), row.last_chunk(), source.first_chunk(), source.last_chunk()) {
        let Some(result) = f(&join(*a, *b), &join(*c, *d)).map(store) else { return };
        let start = row.len() - 4;
        row[..4].copy_from_slice(&result[..4]);
        row[start..].copy_from_slice(&result[4..]);
    } else if let Some(last) = row.len().checked_sub(1) {
        let middle = row.len() / 2;
        let (pixels, source) = ([row[0], row[middle], row[last], row[0]], [source[0], source[middle], source[last], source[0]]);
        if let Some(result) = f(&join(pixels, pixels), &join(source, source)).map(store) {
            (row[0], row[middle], row[last]) = (result[0], result[1], result[2]);
        }
    }
}

pub fn fill_through<'a>(rows: impl Iterator<Item = (&'a mut [Pixel], &'a [u8])>, color: Pixel) {
    let (all, solid) = (load([color; 8]), if color[3] == 255 { u64::MAX } else { 0 });
    let eight = |pixels: &[Pixel; 8], coverage: &[u8; 8]| match u64::from_le_bytes(*coverage) {
        0 => None,
        it if it == solid => Some(all),
        it => Some(over(load(*pixels), scale(all, spread(it)))),
    };
    for (row, coverage) in rows {
        update(row, coverage, eight);
    }
}

pub fn fill_slant<'a>(rows: impl Iterator<Item = (&'a mut [Pixel], [f32; 2])>, slant: &Slant, color: Pixel) {
    let (all, gauge, none) = (load([color; 8]), Gauge::<Numbers>::new(slant), Numbers::new([1.; 8]));
    for (row, [mut x, y]) in rows {
        for run in row.chunks_mut(8) {
            let coverage = gauge.coverage([x, y]);
            x += 8.;
            match run.first_chunk_mut() {
                _ if coverage.above(none) == 0 => {}
                Some(run) => *run = store(cover(load(*run), all, coverage)),
                None => update(run, &coverage.bytes(), |pixels, coverage| Some(over(load(*pixels), scale(all, spread(u64::from_le_bytes(*coverage)))))),
            }
        }
    }
}

pub fn measure_slant<'a>(rows: impl Iterator<Item = (&'a mut [u8], [f32; 2])>, slant: &Slant) {
    Gauge::<Numbers>::new(slant).measure(rows);
}

pub fn write_alphas(scanner: &mut Scanner, edges: &Edges, shape: &Shape, rect: IntRect, alphas: &mut [u8]) {
    scanner.scan::<Numbers>(edges, shape, rect, alphas);
}

pub fn fill_shape(scanner: &mut Scanner, edges: &Edges, shape: &Shape, rect: IntRect, pixels: &mut [Pixel], color: Pixel) {
    scanner.scan(edges, shape, rect, Filler { pixels, color });
}

#[inline]
fn cover_eights(pixels: &mut [Pixel], color: Pixel, places: &[u32], alphas: &[Stored]) {
    let all = load([color; 8]);
    for (place, alphas) in places.iter().zip(alphas) {
        if let Some(eight) = pixels.get_mut(*place as usize..).and_then(|it| it.first_chunk_mut()) {
            *eight = store(cover(load(*eight), all, alphas.get()));
        }
    }
}

pub fn fill_outlined(row: &mut [Pixel], colors: &Outlined, coverage: &[[u8; 2]]) {
    let (fill, border) = (load([colors.fill; 8]), load([colors.border; 8]));
    let eight = |pixels: &[Pixel; 8], coverage: &[[u8; 2]; 8]| {
        let [outer, inner] = spread_pairs(*coverage);
        Some(over(load(*pixels), scale(over(fill, scale(border, inner)), outer)))
    };
    update(row, coverage, eight);
}

pub fn set<'a>(rows: impl Iterator<Item = &'a mut [Pixel]>, color: Pixel) {
    for row in rows {
        raster::set_row(row, color);
    }
}

pub fn tint<'a>(rows: impl Iterator<Item = &'a mut [Pixel]>, color: Pixel) {
    let (all, kept) = (load([color; 8]), splat(255 - color[3]));
    for row in rows {
        update(row, &vec![(); row.len()], |pixels, _| Some(add(all, scale(load(*pixels), kept))));
    }
}

pub fn blend<'a>(rows: impl Iterator<Item = (&'a mut [Pixel], &'a [Pixel])>, by: u8) {
    let shown = |colors: &[Pixel; 8]| Some(load(*colors)).filter(|it| !is_clear(*it));
    let all = splat(by);
    for (row, colors) in rows {
        match by {
            255 => update(row, colors, |pixels, colors| shown(colors).map(|it| if is_opaque(it) { it } else { over(load(*pixels), it) })),
            _ => update(row, colors, |pixels, colors| shown(colors).map(|it| over(load(*pixels), scale(it, all)))),
        }
    }
}

pub fn blend_through(row: &mut [Pixel], colors: &mut [Pixel], coverage: &[u8]) {
    let ((runs, rest), (all, more), (alphas, others)) = (row.as_chunks_mut(), colors.as_chunks_mut(), coverage.as_chunks());
    for ((pixels, colors), alphas) in runs.iter_mut().zip(all).zip(alphas) {
        match u64::from_le_bytes(*alphas) {
            0 => {}
            u64::MAX if is_opaque(load(*colors)) => *pixels = *colors,
            it => *pixels = store(over(load(*pixels), scale(load(*colors), spread(it)))),
        }
    }
    more.iter_mut().zip(others).for_each(|(color, by)| *color = raster::scale(*color, *by));
    update(rest, more, |pixels, colors| Some(over(load(*pixels), load(*colors))));
}

pub fn shade_between(ends: [[f32; 4]; 2], first: f32, step: f32, row: &mut [Pixel]) {
    super::gradient::between::<Numbers>(ends, first, step, row);
}

pub fn premultiply(row: &mut [[u8; 4]]) {
    let (black, opposite) = (load([[0, 0, 0, 255]; 8]), [splat(255); 2]);
    update(row, &vec![(); row.len()], |pixels, _| Some(load(*pixels)).filter(|it| !is_opaque(*it)).map(|it| scale(add(it, black), change(kept(it), opposite))));
}

pub fn demultiply(row: &mut [Pixel]) {
    update(row, &vec![(); row.len()], |pixels, _| {
        if is_opaque(load(*pixels)) || is_clear(load(*pixels)) {
            return None;
        }
        let mut straight = *pixels;
        for pixel in &mut straight {
            *pixel = raster::divide_by_alpha(*pixel);
        }
        Some(load(straight))
    });
}

pub fn stamp<'a>(runs: impl Iterator<Item = &'a mut [Pixel; 8]>, colors: [Pixel; 8]) {
    let (all, kept) = (load(colors), kept(load(colors)));
    for run in runs {
        *run = store(add(all, scale(load(*run), kept)));
    }
}

pub fn composite(row: &mut [Pixel], source: &[Pixel], factors: [Factor; 2]) {
    let [of_source, of_backdrop] = factors.map(|it| [splat(it.and), splat(it.xor)]);
    update(row, source, |below, above| {
        let (below, above) = (load(*below), load(*above));
        Some(weigh(above, change(kept(below), of_source), below, change(kept(above), of_backdrop)))
    });
}

pub fn convolve(source: &[Strip], start: i32, target: &mut [Strip], kernel: &Kernel) {
    convolve_strips(source, start, target, kernel);
}

pub fn draw_samples<'a>(rows: impl Iterator<Item = (&'a mut [Pixel], [i32; 2])>, source: &Samples, by: u8) {
    let (sampler, all, step) = (Sampler::new(source), splat(by), source.step);
    for (row, mut start) in rows {
        for run in row.chunks_mut(8) {
            let colors = sampler.at(start);
            start = [start[0].wrapping_add(step[0].wrapping_mul(8)), start[1].wrapping_add(step[1].wrapping_mul(8))];
            let colors = if by == 255 { colors } else { scale(colors, all) };
            match run.first_chunk_mut() {
                Some(run) if is_opaque(colors) => *run = store(colors),
                Some(run) => *run = store(over(load(*run), colors)),
                None => update(run, &store(colors), |pixels, colors| Some(over(load(*pixels), load(*colors)))),
            }
        }
    }
}

}

/// Whether the last column and the last row have another after them.
fn has_margin(source: &Samples) -> bool {
    let (
        &Samples {
            texels,
            width,
            last,
            ..
        },
        [column, row],
    ) = (source, source.last.map(|it| (it >> 16) as usize));
    last[0].min(last[1]) >= 0
        && column + 1 < width
        && width <= 1 << 15
        && (row + 2) * width <= texels.len()
}

#[cfg(test)]
mod tests {
    use super::super::blend::composite_pixel;
    use super::super::raster::{
        blend_row, fill_outlined, fill_row, fill_through, over, scale, stamp,
    };
    use super::super::warp::draw_samples;
    use super::*;

    #[test]
    fn rows_are_like_their_pixels() {
        let (mut state, mut sampled) = (1u32, 0u32);
        let mut byte = move || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            [0, 255, (state >> 16) as u8, (state >> 8) as u8][(state >> 29) as usize % 4]
        };
        for (length, round) in (0..40).flat_map(|length| (0..50).map(move |round| (length, round)))
        {
            let same = [0, 255, 77].get(round).copied();
            let mut pixel = || {
                scale(
                    [byte(), byte(), byte(), 255],
                    same.unwrap_or_else(&mut byte),
                )
            };
            let (row, colors): (Vec<_>, Vec<_>) = (0..length).map(|_| (pixel(), pixel())).unzip();
            let (texels, color, border): (Vec<_>, _, _) =
                ((0..63).map(|_| pixel()).collect(), pixel(), pixel());
            let pairs: Vec<_> = (0..length)
                .map(|_| [same.unwrap_or_else(&mut byte), byte()])
                .collect();
            let (by, coverage, outlined) = (
                byte(),
                pairs.iter().map(|it| it[0]).collect::<Vec<_>>(),
                Outlined::new(color, border),
            );
            let (start, step) = (
                [byte(), byte()].map(|it| (i32::from(it) - 20) * 2749),
                [byte(), byte()].map(|it| (i32::from(it) - 128) * 513),
            );
            let samples = Samples {
                texels: &texels,
                width: 9,
                step,
                last: [7 << 16, 5 << 16],
            };
            let check = |error: u8, all: &dyn Fn(&mut [Pixel]), source: &dyn Fn(usize) -> Pixel| {
                let (mut painted, expected) = (
                    row.clone(),
                    (0..length)
                        .map(|it| over(row[it], source(it)))
                        .collect::<Vec<_>>(),
                );
                all(&mut painted);
                let is_near = painted
                    .as_flattened()
                    .iter()
                    .zip(expected.as_flattened())
                    .all(|(a, b)| a.abs_diff(*b) <= error);
                assert!(is_near, "{painted:?} {expected:?}");
            };
            check(0, &|it| fill_row(it, color), &|_| color);
            check(0, &|it| fill_through(it, color, &coverage), &|it| {
                scale(color, coverage[it])
            });
            check(0, &|it| blend_row(it, &colors, by), &|it| {
                scale(colors[it], by)
            });
            check(0, &|it| fill_outlined(it, &outlined, &pairs), &|it| {
                outlined.at(pairs[it])
            });
            let (mut straight, mut back) = (
                colors.clone(),
                pairs
                    .iter()
                    .map(|&[a, b]| [b, !b, a ^ b, a])
                    .collect::<Vec<_>>(),
            );
            let expected: Vec<_> = back
                .iter()
                .map(|it| raster::premultiply(u32::from_be_bytes(*it)))
                .collect();
            raster::demultiply_row(&mut straight);
            raster::premultiply_row(&mut back);
            assert_eq!(
                (straight, back),
                (
                    colors.iter().map(|it| raster::demultiply(*it)).collect(),
                    expected
                )
            );
            let factors = [byte(), byte()].map(|it| {
                [Factor::NONE, Factor::ALL, Factor::COVERED, Factor::OPEN][usize::from(it) % 4]
            });
            let (mut composed, expected) = (
                row.clone(),
                (0..length)
                    .map(|it| composite_pixel(row[it], colors[it], factors))
                    .collect::<Vec<_>>(),
            );
            super::super::blend::composite(&mut composed, &colors, factors);
            assert_eq!(composed, expected);
            check(
                2,
                &|it| draw_samples(std::iter::once((it, start)), &samples, by),
                &|it| scale(samples.at(start, it as i32), by),
            );
            draw_samples(std::iter::once((&mut composed[..], start)), &samples, by);
            sampled = composed.iter().fold(sampled, |all, it| {
                all.wrapping_mul(31).wrapping_add(u32::from_le_bytes(*it))
            });
            if let (Some(mut run), Some(colors)) =
                (row.first_chunk().copied(), colors.first_chunk())
            {
                stamp(std::iter::once(&mut run), *colors);
                assert_eq!(run, std::array::from_fn(|it| over(row[it], colors[it])));
            }
        }
        assert!(sampled == 1_549_185_354 || !is_available(), "{sampled}");
    }
}
