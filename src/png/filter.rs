//! The five scanline filters. In all of them `a` is the byte one pixel to the left, `b` the byte above
//! and `c` the byte above `a`. Left of the row and above the image (or pass) they are zero.

use crate::error::{Error, Result};

const NONE: u8 = 0;
const SUB: u8 = 1;
const UP: u8 = 2;
const AVERAGE: u8 = 3;
const PAETH: u8 = 4;

#[inline(always)]
fn average(a: u8, b: u8) -> u8 {
    ((u16::from(a) + u16::from(b)) / 2) as u8
}

#[inline(always)]
fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let (wide_a, wide_b, wide_c) = (i16::from(a), i16::from(b), i16::from(c));
    let pa = (wide_b - wide_c).abs();
    let pb = (wide_a - wide_c).abs();
    let pc = (wide_a + wide_b - 2 * wide_c).abs();
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// Eight numbers side by side. Eight, whatever the pixel's size, because they fill a vector register.
#[derive(Clone, Copy)]
struct Wide([i16; 8]);

impl Wide {
    const ZERO: Self = Self([0; 8]);

    /// The lanes that `bytes` does not fill are zero.
    #[inline(always)]
    fn load(bytes: &[u8]) -> Self {
        let mut lanes = [0; 8];
        for (lane, byte) in lanes.iter_mut().zip(bytes) {
            *lane = i16::from(*byte);
        }
        Self(lanes)
    }

    /// The low byte of each lane.
    #[inline(always)]
    fn store(self, pixel: &mut [u8]) {
        for (byte, lane) in pixel.iter_mut().zip(self.0) {
            *byte = lane as u8;
        }
    }

    #[inline(always)]
    fn zip(mut self, other: Self, with: impl Fn(i16, i16) -> i16) -> Self {
        for (lane, other) in self.0.iter_mut().zip(other.0) {
            *lane = with(*lane, other);
        }
        self
    }

    #[inline(always)]
    fn map(mut self, with: impl Fn(i16) -> i16) -> Self {
        for lane in &mut self.0 {
            *lane = with(*lane);
        }
        self
    }

    #[inline(always)]
    fn gt(self, other: Self) -> Mask {
        Mask(self.zip(other, |x, y| if x > y { -1 } else { 0 }))
    }
}

/// All bits of a lane set, or none.
#[derive(Clone, Copy)]
struct Mask(Wide);

impl Mask {
    #[inline(always)]
    fn select(self, then: Wide, otherwise: Wide) -> Wide {
        let then = then.zip(self.0, |x, mask| x & mask);
        then.zip(otherwise.zip(self.0, |x, mask| x & !mask), |x, y| x | y)
    }
}

/// `undo()` for pixels of `SIZE` bytes. Plain and out of line, or a pixel does not stay in one vector register: after
/// a change, run bench/image/bench-png.mjs.
struct Undo<const SIZE: usize>;

impl<const SIZE: usize> Undo<SIZE> {
    /// `a` is the pixel before `row`.
    #[inline(never)]
    fn sub(mut a: [u8; SIZE], row: &mut [u8]) {
        for pixel in row.as_chunks_mut::<SIZE>().0 {
            for (x, a) in pixel.iter_mut().zip(&mut a) {
                *x = x.wrapping_add(*a);
                *a = *x;
            }
        }
    }

    #[inline(never)]
    fn average(row: &mut [u8], above: &[u8]) {
        let mut a = Wide::ZERO;
        let pixels = row.as_chunks_mut::<SIZE>().0.iter_mut();
        for (x, b) in pixels.zip(above.as_chunks::<SIZE>().0) {
            // x + (a + b) / 2 is (a + b + 2x) / 2, and b + 2x does not wait for `a`.
            let known = Wide::load(x).zip(Wide::load(b), |x, b| 2 * x + b);
            a = a.zip(known, |a, known| ((a + known) >> 1) & 0xff);
            a.store(x);
        }
    }

    /// `a` is the pixel before `row` and `c` the one before `above`.
    #[inline(never)]
    fn paeth(a: &[u8; SIZE], c: &[u8; SIZE], row: &mut [u8], above: &[u8]) {
        /// x plus what `paeth()` gives, for all a, b and c, in fewer steps from `a`. `known` is 3c - b.
        // https://github.com/nothings/stb/blob/013ac3beddff3dbffafd5177e7972067cd2b5083/stb_image.h#L4657
        #[inline(always)]
        fn next(x: &[u8], a: Wide, b: Wide, c: Wide, known: Wide) -> Wide {
            let threshold = known.zip(a, |known, a| known - a);
            let (min, max) = (a.zip(b, i16::min), a.zip(b, i16::max));
            let otherwise = max.gt(threshold).select(c, min);
            let nearest = threshold.gt(min).select(otherwise, max);
            Wide::load(x).zip(nearest, |x, nearest| x + nearest)
        }
        let Some((last, pixels)) = row.as_chunks_mut::<SIZE>().0.split_last_mut() else {
            return;
        };
        let Some((b, later_b)) = above.as_chunks::<SIZE>().0.split_first() else {
            return;
        };
        let (mut a, mut b, mut c) = (Wide::load(a), Wide::load(b), Wide::load(c));
        // Worked out one pixel ahead, or the compiler puts it on the way from one `a` to the next.
        let mut known = b.zip(c, |b, c| 3 * c - b);
        for (x, next_b) in pixels.iter_mut().zip(later_b) {
            let sum = next(x, a, b, c, known);
            a = sum.map(|sum| sum & 0xff);
            // The same bytes. From `a`, the compiler adds bytes, and widening them is on the way to the next `a` too.
            // From `sum`, it is slower with a pixel that it does not keep in one register.
            (if SIZE.is_multiple_of(4) { sum } else { a }).store(x);
            c = b;
            b = Wide::load(next_b);
            known = b.zip(c, |b, c| 3 * c - b);
        }
        next(last, a, b, c, known).store(last);
    }

    /// Where the row above repeats a pixel, b = c, so a is the nearest and Paeth is Sub, at a tenth of the cost.
    fn paeth_or_sub(row: &mut [u8], above: &[u8]) {
        const BLOCK: usize = 48;
        // After a block that is not flat this much is not looked at, or a photo would pay for the looking.
        const STRETCH: usize = 5 * BLOCK;
        const { assert!(BLOCK.is_multiple_of(SIZE)) };
        let is_flat = |at: usize| {
            let block = above.get(at..).and_then(|rest| rest.first_chunk::<BLOCK>());
            let shifted = at.checked_sub(SIZE).and_then(|at| above.get(at..));
            block.is_some() && block == shifted.and_then(|rest| rest.first_chunk::<BLOCK>())
        };
        fn last_pixel<const SIZE: usize>(bytes: &[u8]) -> &[u8; SIZE] {
            bytes.last_chunk().unwrap_or(&[0; SIZE])
        }
        let mut start = 0;
        while start < row.len() {
            let flat = is_flat(start);
            // Left of the row is not what the row above starts with, but after one pixel that is over.
            let busy = if start == 0 { SIZE } else { STRETCH };
            let mut end = start + if flat { BLOCK } else { busy };
            while flat && is_flat(end) {
                end += BLOCK;
            }
            let (done, rest) = row.split_at_mut_checked(start).unwrap_or_default();
            let len = rest.len().min(end - start);
            let part = rest.get_mut(..len).unwrap_or_default();
            if flat {
                Self::sub(*last_pixel(done), part);
            } else {
                let (above_done, above_rest) = above.split_at_checked(start).unwrap_or_default();
                Self::paeth(last_pixel(done), last_pixel(above_done), part, above_rest);
            }
            start = end;
        }
    }

    fn undo(filter: u8, row: &mut [u8], above: &[u8]) -> Result<()> {
        match filter {
            NONE => {}
            SUB => Self::sub([0; SIZE], row),
            UP => {
                for (x, b) in row.iter_mut().zip(above) {
                    *x = x.wrapping_add(*b);
                }
            }
            AVERAGE => Self::average(row, above),
            PAETH => Self::paeth_or_sub(row, above),
            _ => return Err(Error::InvalidFilter),
        }
        Ok(())
    }
}

/// Turns the filtered `row` back into pixels of `bytes_per_pixel`. `above` is the row before it, turned back already.
pub(crate) fn undo(filter: u8, bytes_per_pixel: usize, row: &mut [u8], above: &[u8]) -> Result<()> {
    debug_assert_eq!(row.len(), above.len());
    match bytes_per_pixel {
        1 => Undo::<1>::undo(filter, row, above),
        2 => Undo::<2>::undo(filter, row, above),
        4 => Undo::<4>::undo(filter, row, above),
        6 => Undo::<6>::undo(filter, row, above),
        8 => Undo::<8>::undo(filter, row, above),
        // 3 is not among them: see `push_rgb_as_rgba()`.
        _ => Err(Error::InvalidFilter),
    }
}

/// The alpha does not count: see `make_opaque()`. `rgba` has the room.
pub(crate) fn push_rgb_as_rgba(rgb: &[u8], rgba: &mut Vec<u8>) {
    // Four pixels at a time.
    let (fours, rest) = rgb.as_chunks::<12>();
    for &[r0, g0, b0, r1, g1, b1, r2, g2, b2, r3, g3, b3] in fours {
        rgba.extend_from_slice(&[r0, g0, b0, 0, r1, g1, b1, 0, r2, g2, b2, 0, r3, g3, b3, 0]);
    }
    for &[r, g, b] in rest.as_chunks().0 {
        rgba.extend_from_slice(&[r, g, b, 0]);
    }
}

pub(crate) fn make_opaque(rgba: &mut [u8]) {
    for [.., alpha] in rgba.as_chunks_mut::<4>().0 {
        *alpha = 255;
    }
}

#[inline(always)]
fn apply(
    bytes_per_pixel: usize,
    above: &[u8],
    row: &[u8],
    out: &mut [u8],
    filter: impl Fn(u8, u8, u8, u8) -> u8,
) {
    let first = out.iter_mut().zip(row).zip(above).take(bytes_per_pixel);
    for ((out, x), b) in first {
        *out = filter(*x, 0, *b, 0);
    }
    let out = out.get_mut(bytes_per_pixel..).unwrap_or_default();
    let x = row.get(bytes_per_pixel..).unwrap_or_default();
    let b = above.get(bytes_per_pixel..).unwrap_or_default();
    for ((((out, x), a), b), c) in out.iter_mut().zip(x).zip(row).zip(b).zip(above) {
        *out = filter(*x, *a, *b, *c);
    }
}

/// How far the bytes are from zero, taken as signed. The filter with the lowest sum is used.
// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1660
fn score(filtered: &[u8]) -> u32 {
    filtered
        .iter()
        .map(|&x| u32::from(x.min(x.wrapping_neg())))
        .sum()
}

/// One buffer per filter, each a filter byte and a row.
pub(crate) struct Lines {
    lines: [Vec<u8>; 5],
}

impl Lines {
    /// Without `choosing` there is only `unfiltered`.
    pub(crate) fn new(row_bytes: usize, choosing: bool) -> Result<Self> {
        let mut lines: [Vec<u8>; 5] = Default::default();
        let used = if choosing { lines.len() } else { 1 };
        for (filter, line) in (NONE..).zip(&mut lines).take(used) {
            line.try_reserve_exact(row_bytes.saturating_add(1))?;
            line.push(filter);
            line.resize(row_bytes.saturating_add(1), 0);
        }
        Ok(Self { lines })
    }

    /// `row` behind filter byte 0.
    pub(crate) fn unfiltered(&mut self, row: &[u8]) -> &[u8] {
        let [none, ..] = &mut self.lines;
        none.truncate(1);
        none.extend_from_slice(row);
        none
    }

    /// `row` behind the byte of the filter that libspng picks for it, filtered.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1666
    pub(crate) fn best(&mut self, bytes_per_pixel: usize, above: &[u8], row: &[u8]) -> &[u8] {
        self.unfiltered(row);
        for line in self.lines.iter_mut().skip(1) {
            let Some((&mut filter, out)) = line.split_first_mut() else {
                continue;
            };
            match filter {
                SUB => apply(bytes_per_pixel, above, row, out, |x, a, _, _| {
                    x.wrapping_sub(a)
                }),
                UP => apply(bytes_per_pixel, above, row, out, |x, _, b, _| {
                    x.wrapping_sub(b)
                }),
                AVERAGE => apply(bytes_per_pixel, above, row, out, |x, a, b, _| {
                    x.wrapping_sub(average(a, b))
                }),
                _ => apply(bytes_per_pixel, above, row, out, |x, a, b, c| {
                    x.wrapping_sub(paeth(a, b, c))
                }),
            }
        }
        // The first of equals.
        let best = self
            .lines
            .iter()
            .min_by_key(|line| score(line.get(1..).unwrap_or_default()));
        best.map(Vec::as_slice).unwrap_or_default()
    }
}
