//! Gaussian blurs. Many lines are blurred at once, each byte of a `Strip` being of another one or of another channel.

use std::ops::Range;

use super::raster::{IntRect, prefer_wide};

/// The limits of `SkBlurImageFilter` and `SkBlurMaskFilter`.
pub const MAX_SIGMA: f32 = 532.;
pub const MAX_SIGMA_OF_SHADOWS: f32 = 128.;

const LANES: usize = 64;
pub type Strip = [u8; LANES];

/// How far it reaches.
pub fn extent(sigma: f32) -> i32 {
    (sigma.min(MAX_SIGMA) * 3.).ceil().max(0.) as i32
}

/// Where a position is in a line that is mirrored at its ends.
pub fn mirror(at: i32, length: usize) -> usize {
    let at = at.rem_euclid(length as i32 * 2) as usize;
    at.min(length * 2 - 1 - at)
}

pub enum Kernel {
    /// From the middle, of which it is half, in 65536ths.
    Exact(Vec<u16>),
    /// https://drafts.fxtf.org/filter-effects/#feGaussianBlurElement: two boxes of the first size, and one of the second.
    Boxes(usize, usize),
}

impl Kernel {
    fn new(sigma: f32) -> Kernel {
        const EXACT_UP_TO: f32 = 4.;
        if sigma > EXACT_UP_TO {
            let size = (sigma.min(MAX_SIGMA) * 3. * (2. * std::f32::consts::PI).sqrt() / 4. + 0.5)
                as usize;
            return Kernel::Boxes(size, size | 1);
        }
        let weight = |at: i32| {
            if at == 0 {
                0.5
            } else {
                (-(at * at) as f32 / (2. * sigma * sigma)).exp()
            }
        };
        let reach = if sigma >= 0.05 { extent(sigma) } else { 0 };
        let total = (0..=reach).map(weight).sum::<f32>() * 2.;
        Kernel::Exact(
            (0..=reach)
                .map(|at| (weight(at) / total * 65536. + 0.5) as u16)
                .collect(),
        )
    }

    fn reach(&self) -> i32 {
        match *self {
            Kernel::Exact(ref weights) => weights.len() as i32 - 1,
            Kernel::Boxes(first, last) => (first * 2 + last - 3) as i32 / 2,
        }
    }
}

trait Sum: Copy + Default {
    const UNIT: f32;
    fn of(change: i16) -> Self;
    fn plus(self, other: Self) -> Self;
    fn units(self) -> f32;
}

impl Sum for i32 {
    const UNIT: f32 = 1.;

    #[inline(always)]
    fn of(change: i16) -> i32 {
        change.into()
    }

    #[inline(always)]
    fn plus(self, other: i32) -> i32 {
        self.wrapping_add(other)
    }

    #[inline(always)]
    fn units(self) -> f32 {
        self as f32
    }
}

impl Sum for u64 {
    const UNIT: f32 = 256.;

    #[inline(always)]
    fn of(change: i16) -> u64 {
        i64::from(change).cast_unsigned()
    }

    #[inline(always)]
    fn plus(self, other: u64) -> u64 {
        self.wrapping_add(other)
    }

    #[inline(always)]
    fn units(self) -> f32 {
        (self >> 8) as i32 as f32
    }
}

#[inline(always)]
fn strip_at(source: &[Strip], at: usize) -> &Strip {
    source.get(at).unwrap_or(&[0; LANES])
}

/// Adding up three times makes boxes of differences.
#[inline(always)]
fn boxes<S: Sum>(source: &[Strip], end: usize, target: &mut [Strip], first: usize, last: usize) {
    const ROUNDS: f32 = (1 << 23) as f32;
    let (mut sums, scale, start) = (
        [[S::default(); LANES]; 3],
        S::UNIT / (first * first * last) as f32,
        end - target.len(),
    );
    for at in 0..end {
        let [a, b, c, d, e, f] = [0, first, last, first * 2, first + last, first * 2 + last]
            .map(|back| strip_at(source, at.wrapping_sub(back)));
        let [once, twice, thrice] = &mut sums;
        for lane in 0..LANES {
            let [a, b, c, d, e, f] =
                [a[lane], b[lane], c[lane], d[lane], e[lane], f[lane]].map(i16::from);
            once[lane] = once[lane].plus(S::of(a + d - c - f + (e - b) * 2));
            twice[lane] = twice[lane].plus(once[lane]);
            thrice[lane] = thrice[lane].plus(twice[lane]);
        }
        if let Some(target) = target.get_mut(at.wrapping_sub(start)) {
            *target = thrice.map(|it| (it.units() * scale + ROUNDS).to_bits() as u8);
        }
    }
}

/// The first of `target` is where the one at `start` of `source` is, which is at least minus the reach.
#[inline(always)]
pub fn convolve_strips(source: &[Strip], start: i32, target: &mut [Strip], kernel: &Kernel) {
    match *kernel {
        Kernel::Boxes(first, last) => {
            let end = (start + kernel.reach()) as usize + target.len();
            if last <= 200 {
                boxes::<i32>(source, end, target, first, last)
            } else {
                boxes::<u64>(source, end, target, first, last)
            }
        }
        Kernel::Exact(ref weights) => {
            for (at, target) in (start..).map(|it| it as usize).zip(target) {
                let mut sums = [64 + weights.len() as u16 / 2; LANES];
                for (distance, weight) in weights.iter().enumerate() {
                    let (a, b) = (
                        strip_at(source, at.wrapping_sub(distance)),
                        strip_at(source, at.wrapping_add(distance)),
                    );
                    for lane in 0..LANES {
                        let both = (u16::from(a[lane]) + u16::from(b[lane])) << 7;
                        sums[lane] += ((u32::from(both) * u32::from(*weight)) >> 16) as u16;
                    }
                }
                *target = sums.map(|it| (it >> 7).min(255) as u8);
            }
        }
    }
}

fn convolve(source: &[Strip], start: i32, target: &mut [Strip], kernel: &Kernel) {
    prefer_wide!(convolve(source, start, target, kernel));
    convolve_strips(source, start, target, kernel);
}

/// Where it is not transparent.
fn content<const N: usize>(pixels: &[[u8; N]], rect: IntRect) -> IntRect {
    let (mut all, mut rows) = (vec![0; rect.width() * N], None::<Range<i32>>);
    for (y, row) in (rect.top..).zip(pixels.as_flattened().chunks(all.len())) {
        let mut any = 0;
        for (all, byte) in all.iter_mut().zip(row) {
            (*all, any) = (*all | byte, any | byte);
        }
        if any != 0 {
            rows = Some(rows.map_or(y, |it| it.start)..y + 1);
        }
    }
    let (first, last) = (
        all.iter().position(|it| *it != 0),
        all.iter().rposition(|it| *it != 0),
    );
    let (Some(rows), Some(first), Some(last)) = (rows, first, last) else {
        return IntRect::default();
    };
    IntRect::new(
        rect.left + (first / N) as i32,
        rows.start,
        rect.left + (last / N) as i32 + 1,
        rows.end,
    )
}

/// Pixels of `N` bytes. `target` is transparent, and so is what is around `source` unless that is mirrored.
pub fn blur<const N: usize>(
    source: (&[[u8; N]], IntRect),
    target: (&mut [[u8; N]], IntRect),
    sigma: [f32; 2],
    is_mirrored: bool,
) {
    let ((source, whole), (target, wanted)) = (source, target);
    if whole.is_empty() || wanted.is_empty() {
        return;
    }
    // That leaves the average.
    let limited = |sigma: f32, length: usize| {
        if is_mirrored {
            sigma.min(length as f32 * 1.25)
        } else {
            sigma
        }
    };
    let (across, down) = (
        Kernel::new(limited(sigma[0], whole.width())),
        Kernel::new(limited(sigma[1], whole.height())),
    );
    let (x, y) = (across.reach(), down.reach());
    let reached = |it: IntRect| IntRect::new(it.left - x, it.top - y, it.right + x, it.bottom + y);
    let from = if is_mirrored {
        whole
    } else {
        content(source, whole).intersect(reached(wanted))
    };
    let to = reached(from).intersect(wanted);
    if from.is_empty() || to.is_empty() {
        return;
    }
    let (mut input, mut output) = (Vec::<Strip>::new(), Vec::<Strip>::new());
    let extend = |strips: &mut Vec<Strip>, by: i32| {
        let (by, length) = (by as usize, strips.len() - by as usize * 2);
        for distance in (0..by).filter(|_| is_mirrored) {
            let inside = mirror(distance as i32, length);
            (strips[by - 1 - distance], strips[by + length + distance]) =
                (strips[by + inside], strips[by + length - 1 - inside]);
        }
    };
    let (margin_x, margin_y) = if is_mirrored { (x, y) } else { (0, 0) };

    let (stride, per_strip) = ((to.width() * N).next_multiple_of(LANES), LANES / N);
    let mut between = vec![0; stride * from.height()];
    input.resize(from.width() + margin_x as usize * 2, [0; LANES]);
    output.resize(to.width(), [0; LANES]);
    let rows =
        &source[(from.top - whole.top) as usize * whole.width()..][..from.height() * whole.width()];
    for (rows, results) in rows
        .chunks(whole.width() * per_strip)
        .zip(between.chunks_mut(stride * per_strip))
    {
        for (lane, row) in rows.chunks(whole.width()).enumerate() {
            let row = &row[(from.left - whole.left) as usize..][..from.width()];
            input[margin_x as usize..]
                .iter_mut()
                .zip(row)
                .for_each(|(strip, pixel)| strip.as_chunks_mut().0[lane] = *pixel);
        }
        extend(&mut input, margin_x);
        convolve(&input, to.left - from.left + margin_x, &mut output, &across);
        for (lane, row) in results.chunks_mut(stride).enumerate() {
            row.as_chunks_mut::<N>()
                .0
                .iter_mut()
                .zip(&output)
                .for_each(|(pixel, strip)| *pixel = strip.as_chunks().0[lane]);
        }
    }

    input.resize(from.height() + margin_y as usize * 2, [0; LANES]);
    output.resize(to.height(), [0; LANES]);
    let (between, columns) = (between.as_chunks().0, stride / LANES);
    for column in 0..columns {
        input[margin_y as usize..]
            .iter_mut()
            .zip(between[column..].iter().step_by(columns))
            .for_each(|(strip, from)| *strip = *from);
        extend(&mut input, margin_y);
        convolve(&input, to.top - from.top + margin_y, &mut output, &down);
        let (start, count) = (
            (to.left - wanted.left) as usize + column * per_strip,
            per_strip.min(to.width() - column * per_strip),
        );
        for (row, strip) in target
            .chunks_mut(wanted.width())
            .skip((to.top - wanted.top) as usize)
            .zip(&output)
        {
            match (
                row[start..].as_flattened_mut().first_chunk_mut(),
                count == per_strip,
            ) {
                (Some(all), true) => *all = *strip,
                _ => row[start..start + count].copy_from_slice(&strip.as_chunks().0[..count]),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_is_the_convolution_wherever_it_is_cut() {
        let (whole, mut state) = (IntRect::new(-7, 3, 83, 73), 1u32);
        let mut byte = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            [if state >> 30 == 0 { 0 } else { 255 }]
        };
        let pixels: Vec<_> = (0..whole.area()).map(|_| byte()).collect();
        for (sigma, is_mirrored) in [0., 0.6, 3.9, 4.1, 5., 20., 50., 120., 1e9]
            .into_iter()
            .flat_map(|it| [(it, false), (it, true)])
        {
            let weights = |length: usize| match Kernel::new(if is_mirrored {
                f32::min(sigma, length as f32 * 1.25)
            } else {
                sigma
            }) {
                Kernel::Exact(half) => (1 - half.len() as i32..half.len() as i32)
                    .map(|at| {
                        f64::from(half[at.unsigned_abs() as usize])
                            / if at == 0 { 32768. } else { 65536. }
                    })
                    .collect(),
                Kernel::Boxes(first, last) => {
                    [first, first, last]
                        .into_iter()
                        .fold(vec![1.], |all, size| {
                            (0..all.len() + size - 1)
                                .map(|at| {
                                    all[(at + 1).saturating_sub(size)..all.len().min(at + 1)]
                                        .iter()
                                        .sum::<f64>()
                                        / size as f64
                                })
                                .collect()
                        })
                }
            };
            let (across, down) = (weights(whole.width()), weights(whole.height()));
            let along = |weights: &[f64], at: i32, length: usize| {
                let mut sums = vec![0.; length];
                for (at, weight) in (at - weights.len() as i32 / 2..)
                    .zip(weights)
                    .filter(|it| is_mirrored || (0..length as i32).contains(&it.0))
                {
                    sums[mirror(at, length)] += weight;
                }
                sums
            };
            for wanted in [whole, IntRect::new(10, 20, 15, 22), whole.outset(30)]
                .into_iter()
                .filter(|it| !is_mirrored || whole.contains(*it))
            {
                let mut blurred = vec![[0]; wanted.area() as usize];
                blur(
                    (&pixels, whole),
                    (&mut blurred, wanted),
                    [sigma; 2],
                    is_mirrored,
                );
                for (index, [value]) in blurred.iter().enumerate().step_by(37) {
                    let (x, y) = (
                        wanted.left + (index % wanted.width()) as i32,
                        wanted.top + (index / wanted.width()) as i32,
                    );
                    let (columns, rows) = (
                        along(&across, x - whole.left, whole.width()),
                        along(&down, y - whole.top, whole.height()),
                    );
                    let expected: f64 = pixels
                        .iter()
                        .enumerate()
                        .map(|(it, [value])| {
                            f64::from(*value)
                                * columns[it % whole.width()]
                                * rows[it / whole.width()]
                        })
                        .sum();
                    assert!(
                        (f64::from(*value) - expected).abs() < 1.2,
                        "{sigma} {is_mirrored} {x} {y}: {value} {expected}"
                    );
                }
            }
        }
    }
}
