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

/// A row handed to `undo()` is followed by this many bytes of any value, because a pixel is read as 1, 2, 4 or 8 bytes.
pub(crate) const PADDING: usize = 2;

/// The pixels of a row of `SRC` bytes each. A pixel of 3 or 6 bytes comes with the start of the next one.
#[inline(always)]
fn pixels<const SRC: usize>(line: &[u8]) -> impl Iterator<Item = &[u8]> {
    #[allow(clippy::disallowed_methods, reason = "not a search")]
    line.windows(SRC.next_power_of_two()).step_by(SRC)
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

    /// All bits of a lane set where `self <= other`.
    #[inline(always)]
    fn le(self, other: Self) -> Self {
        self.zip(other, |x, y| if x <= y { -1 } else { 0 })
    }

    /// `self` is what `le()` returned.
    #[inline(always)]
    fn select(self, then: Self, otherwise: Self) -> Self {
        let then = then.zip(self, |x, mask| x & mask);
        then.zip(otherwise.zip(self, |x, mask| x & !mask), |x, y| x | y)
    }

    #[inline(always)]
    fn add_bytes(self, other: Self) -> Self {
        self.zip(other, |x, y| (x + y) & 0xff)
    }
}

#[inline(always)]
fn add_bytes(mut x: [u8; 16], y: [u8; 16]) -> [u8; 16] {
    for (x, y) in x.iter_mut().zip(y) {
        *x = x.wrapping_add(y);
    }
    x
}

/// `undo()` for one size of pixel. `DST` is `SRC`, or 4 for an `SRC` of 3: RGB comes out as opaque RGBA.
///
/// In Sub, Average and Paeth a pixel cannot be started before the one to its left is done, so what counts is how
/// many operations lie between the two. The loops are written for what the compiler makes of them, and none is
/// inlined, because it makes something else of them inside a caller.
struct Undo<const SRC: usize, const DST: usize>;

impl<const SRC: usize, const DST: usize> Undo<SRC, DST> {
    #[inline(never)]
    fn none(line: &[u8], out: &mut [u8]) {
        if SRC == DST {
            for (out, x) in out.iter_mut().zip(line) {
                *out = *x;
            }
            return;
        }
        // Four pixels at a time.
        let (wide_out, rest) = out.as_chunks_mut::<16>();
        for (out, x) in wide_out.iter_mut().zip(line.as_chunks::<12>().0) {
            let [r0, g0, b0, r1, g1, b1, r2, g2, b2, r3, g3, b3] = *x;
            *out = [
                r0, g0, b0, 255, r1, g1, b1, 255, r2, g2, b2, 255, r3, g3, b3, 255,
            ];
        }
        let line = line.get(wide_out.len() * 12..).unwrap_or_default();
        for (out, x) in rest
            .as_chunks_mut::<DST>()
            .0
            .iter_mut()
            .zip(pixels::<SRC>(line))
        {
            Wide::load(x).store(out);
        }
    }

    #[inline(never)]
    fn sub(line: &[u8], out: &mut [u8]) {
        Self::none(line, out);
        let mut rest = out;
        let mut a = [0u8; DST];
        if DST == 4 {
            // Four pixels at a time: each takes on the one before it, then the two before those, then the last
            // of the four before.
            let (fours, few) = rest.as_chunks_mut::<16>();
            let mut last = [0u8; 16];
            for four in fours {
                let [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, ..] = *four;
                let one_before = [0, 0, 0, 0, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11];
                let sums = add_bytes(*four, one_before);
                let [p0, p1, p2, p3, p4, p5, p6, p7, ..] = sums;
                let two_before = [0, 0, 0, 0, 0, 0, 0, 0, p0, p1, p2, p3, p4, p5, p6, p7];
                *four = add_bytes(add_bytes(sums, two_before), last);
                let [.., r, g, b, a] = *four;
                last = [r, g, b, a, r, g, b, a, r, g, b, a, r, g, b, a];
            }
            for (a, last) in a.iter_mut().zip(last) {
                *a = last;
            }
            rest = few;
        }
        for pixel in rest.as_chunks_mut::<DST>().0 {
            for (x, a) in pixel.iter_mut().zip(&mut a) {
                *x = x.wrapping_add(*a);
                *a = *x;
            }
        }
    }

    #[inline(never)]
    fn up(line: &[u8], above: &[u8], out: &mut [u8]) {
        if SRC == DST {
            for ((out, x), b) in out.iter_mut().zip(line).zip(above) {
                *out = x.wrapping_add(*b);
            }
            return;
        }
        Self::none(line, out);
        for (out, b) in out.iter_mut().zip(above) {
            *out = out.wrapping_add(*b);
        }
    }

    #[inline(never)]
    fn average(line: &[u8], above: &[u8], out: &mut [u8]) {
        let mut a = Wide::ZERO;
        let out = out.as_chunks_mut::<DST>().0.iter_mut();
        for ((out, x), b) in out.zip(pixels::<SRC>(line)).zip(above.as_chunks::<DST>().0) {
            // x + (a + b) / 2 is (a + b + 2x) / 2, and b + 2x does not wait for `a`.
            let known = Wide::load(x).zip(Wide::load(b), |x, b| 2 * x + b);
            a = a.zip(known, |a, known| ((a + known) >> 1) & 0xff);
            a.store(out);
        }
    }

    #[inline(never)]
    fn paeth(line: &[u8], above: &[u8], out: &mut [u8]) {
        let Some((first, above)) = above.as_chunks::<DST>().0.split_first() else {
            return;
        };
        let mut a = Wide::ZERO;
        let mut b = Wide::load(first);
        let mut c = Wide::ZERO;
        // 3c - b, worked out one pixel ahead.
        let mut known = Wide::ZERO.zip(b, |zero, b| zero - b);
        let out = out.as_chunks_mut::<DST>().0.iter_mut();
        let next_b = above.iter().chain(core::iter::once(&[0; DST]));
        for ((out, x), next_b) in out.zip(pixels::<SRC>(line)).zip(next_b) {
            // stb_image's way to the predictor, the same for all a, b and c:
            //   threshold = 3c - (a + b)
            //   if threshold <= min(a, b) { max(a, b) } else if max(a, b) <= threshold { min(a, b) } else { c }
            // x is added to a, b and c before one is picked, not to the one picked.
            let x = Wide::load(x);
            let (with_a, with_b, with_c) = (x.add_bytes(a), x.add_bytes(b), x.add_bytes(c));
            let threshold = known.zip(a, |known, a| known - a);
            let a_is_min = a.le(b);
            let min = a.zip(b, i16::min);
            let max = a.zip(b, i16::max);
            let with_min = a_is_min.select(with_a, with_b);
            let with_max = a_is_min.select(with_b, with_a);
            let otherwise = max.le(threshold).select(with_min, with_c);
            a = threshold.le(min).select(with_max, otherwise);
            a.store(out);

            let next_b = Wide::load(next_b);
            known = b.zip(next_b, |c, b| 3 * c - b);
            c = b;
            b = next_b;
        }
    }

    fn undo(filter: u8, line: &[u8], above: &[u8], out: &mut [u8]) -> Result<()> {
        match filter {
            NONE => Self::none(line, out),
            SUB => Self::sub(line, out),
            UP => Self::up(line, above, out),
            AVERAGE => Self::average(line, above, out),
            PAETH => Self::paeth(line, above, out),
            _ => return Err(Error::InvalidFilter),
        }
        // Not done pixel by pixel above: with a byte of four that does not count, the compiler gives up on vectors.
        if SRC != DST {
            for pixel in out.as_chunks_mut::<DST>().0 {
                if let Some(alpha) = pixel.last_mut() {
                    *alpha = 255;
                }
            }
        }
        Ok(())
    }
}

/// Turns the filtered row at the start of `line` into the pixels of `out`. `above` is the row before it, turned
/// back already, and as long as `out`. Pixels of 3 bytes become 4 in `out` and `above`: opaque RGBA.
pub(crate) fn undo(
    filter: u8,
    bytes_per_pixel: usize,
    line: &[u8],
    above: &[u8],
    out: &mut [u8],
) -> Result<()> {
    match bytes_per_pixel {
        1 => Undo::<1, 1>::undo(filter, line, above, out),
        2 => Undo::<2, 2>::undo(filter, line, above, out),
        3 => Undo::<3, 4>::undo(filter, line, above, out),
        4 => Undo::<4, 4>::undo(filter, line, above, out),
        6 => Undo::<6, 6>::undo(filter, line, above, out),
        _ => Undo::<8, 8>::undo(filter, line, above, out),
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
        for (out, x) in none.iter_mut().skip(1).zip(row) {
            *out = *x;
        }
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
