//! Reads the common kinds of PNG row by row, and is quick where a screenshot is flat.

use crate::bun::Inflater;
use crate::codec::png_chunks;

/// 3 for RGB and 4 for RGBA, with 8 bits each, unless it takes more than `read` to decode it.
pub fn channels(bytes: &[u8]) -> Option<usize> {
    let channels = match png_chunks(bytes).next()? {
        (b"IHDR", [_, _, _, _, _, _, _, _, 8, 2, 0, 0, 0]) => 3,
        (b"IHDR", [_, _, _, _, _, _, _, _, 8, 6, 0, 0, 0]) => 4,
        _ => return None,
    };
    png_chunks(bytes)
        .all(|it| !matches!(it, (b"tRNS" | b"eXIf", _)))
        .then_some(channels)
}

#[inline(always)]
fn paeth(left: u8, above: u8, corner: u8) -> u8 {
    let threshold = i16::from(corner) * 3 - i16::from(left) - i16::from(above);
    let (low, high) = (left.min(above), left.max(above));
    let unless_high = if i16::from(high) <= threshold {
        low
    } else {
        corner
    };
    if threshold <= i16::from(low) {
        high
    } else {
        unless_high
    }
}

fn unfilter<const N: usize>(
    filter: u8,
    raw: &[[u8; N]],
    above: &[[u8; N]],
    row: &mut [[u8; N]],
) -> Option<()> {
    const RUN: usize = 16;
    let add = |a: [u8; N], b: [u8; N]| std::array::from_fn(|it| a[it].wrapping_add(b[it]));
    let is_zero = |raw: &[[u8; N]]| raw.as_flattened().iter().fold(0, |all, it| all | it) == 0;
    let runs = row
        .chunks_mut(RUN)
        .zip(raw.chunks(RUN))
        .zip(above.chunks(RUN));
    let (mut left, mut corner) = ([0; N], [0; N]);
    match filter {
        0 => row.copy_from_slice(raw),
        1 => runs.for_each(|((row, raw), _)| match is_zero(raw) {
            true => row.fill(left),
            false => row.iter_mut().zip(raw).for_each(|(pixel, raw)| {
                left = add(*raw, left);
                *pixel = left;
            }),
        }),
        2 => {
            let bytes = row
                .as_flattened_mut()
                .iter_mut()
                .zip(raw.as_flattened())
                .zip(above.as_flattened());
            bytes.for_each(|((byte, raw), above)| *byte = raw.wrapping_add(*above));
        }
        3 => row
            .iter_mut()
            .zip(raw)
            .zip(above)
            .for_each(|((pixel, raw), above)| {
                left = add(*raw, std::array::from_fn(|it| left[it].midpoint(above[it])));
                *pixel = left;
            }),
        4 => runs.for_each(|((row, raw), above)| {
            // The prediction is what is above, so that the same holds for the next pixel.
            if left == corner && is_zero(raw) {
                row.copy_from_slice(above);
                left = above[above.len() - 1];
                corner = left;
                return;
            }
            for ((pixel, raw), above) in row.iter_mut().zip(raw).zip(above) {
                left = add(
                    *raw,
                    std::array::from_fn(|it| paeth(left[it], above[it], corner[it])),
                );
                (*pixel, corner) = (left, *above);
            }
        }),
        _ => return None,
    }
    Some(())
}

fn unfilter_in_place(filter: u8, row: &mut [u8], above: &[u8], step: usize) -> Option<()> {
    let up = |at: usize| above.get(at).copied().unwrap_or(0);
    for at in 0..row.len() {
        let (left, corner) = at.checked_sub(step).map_or((0, 0), |it| (row[it], up(it)));
        row[at] = row[at].wrapping_add(match filter {
            0 => return Some(()),
            1 => left,
            2 => up(at),
            3 => left.midpoint(up(at)),
            4 => paeth(left, up(at), corner),
            _ => return None,
        });
    }
    Some(())
}

/// Any kind of PNG, as RGBA. For the small ones in fonts, which the app draws for pages in other processes.
pub fn decode(bytes: &[u8], most_pixels: usize) -> Option<(u32, u32, Vec<u8>)> {
    const INTERLACED: [[usize; 4]; 7] = [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
    ];
    let (
        b"IHDR",
        &[
            a,
            b,
            c,
            d,
            e,
            f,
            g,
            h,
            depth,
            kind,
            0,
            0,
            is_interlaced @ 0..=1,
        ],
    ) = png_chunks(bytes).next()?
    else {
        return None;
    };
    let (width, height) = (
        u32::from_be_bytes([a, b, c, d]) as usize,
        u32::from_be_bytes([e, f, g, h]) as usize,
    );
    let channels = match (kind, depth) {
        (0, 1 | 2 | 4 | 8 | 16) | (3, 1 | 2 | 4 | 8) => 1,
        (4, 8 | 16) => 2,
        (2, 8 | 16) => 3,
        (6, 8 | 16) => 4,
        _ => return None,
    };
    let (depth, pixels) = (
        usize::from(depth),
        width
            .checked_mul(height)
            .filter(|it| (1..=most_pixels).contains(it))?,
    );
    let passes = if is_interlaced == 1 {
        &INTERLACED[..]
    } else {
        &[[0, 0, 1, 1]]
    }
    .iter()
    .filter(|it| it[0] < width && it[1] < height);
    let stride = |[x, _, across, _]: [usize; 4]| {
        ((width - x).div_ceil(across) * channels * depth).div_ceil(8) + 1
    };
    let mut inflated = vec![
        0;
        passes
            .clone()
            .map(|it| stride(*it) * (height - it[1]).div_ceil(it[3]))
            .sum()
    ];
    let (mut inflater, mut end) = (Inflater::new()?, 0);
    for (_, input) in png_chunks(bytes).filter(|it| it.0 == b"IDAT") {
        end += inflater.inflate(input, &mut inflated[end..])?.1;
        if end == inflated.len() {
            break;
        }
    }
    if end < inflated.len() {
        return None;
    }
    let chunk = |name: &[u8; 4]| {
        png_chunks(bytes)
            .find(|it| it.0 == name)
            .map_or(&[][..], |it| it.1)
    };
    let (palette, transparency) = (chunk(b"PLTE").as_chunks::<3>().0, chunk(b"tRNS"));
    let is_transparent = |color: &[u16]| {
        transparency
            .as_chunks()
            .0
            .iter()
            .map(|it| u16::from_be_bytes(*it))
            .eq(color.iter().copied())
    };
    let narrow = |it: u16| {
        if depth == 16 {
            (it >> 8) as u8
        } else {
            (usize::from(it) * 255 / ((1 << depth) - 1)) as u8
        }
    };
    let (mut rgba, mut rest) = (vec![[0; 4]; pixels], &mut inflated[..]);
    for &[left, top, across, down] in passes {
        let mut above = &[][..];
        for y in (top..height).step_by(down) {
            let (row, after) =
                std::mem::take(&mut rest).split_at_mut(stride([left, top, across, down]));
            let (filter, row) = row.split_first_mut()?;
            unfilter_in_place(*filter, row, above, (channels * depth).div_ceil(8))?;
            (above, rest) = (row, after);
            let sample = |at: usize| match depth {
                16 => u16::from_be_bytes([above[at * 2], above[at * 2 + 1]]),
                _ => {
                    u16::from(above[at * depth / 8]) >> (8 - depth - at * depth % 8)
                        & ((1 << depth) - 1)
                }
            };
            for (at, pixel) in rgba[y * width + left..(y + 1) * width]
                .iter_mut()
                .step_by(across)
                .enumerate()
            {
                let color: [u16; 4] = std::array::from_fn(|it| {
                    if it < channels {
                        sample(at * channels + it)
                    } else {
                        0
                    }
                });
                let [a, b, c, d] = color.map(narrow);
                let opacity = || {
                    if is_transparent(&color[..channels]) {
                        0
                    } else {
                        255
                    }
                };
                *pixel = match kind {
                    0 => [a, a, a, opacity()],
                    2 => [a, b, c, opacity()],
                    4 => [a, a, a, b],
                    6 => [a, b, c, d],
                    _ => {
                        let [r, g, b] = *palette.get(usize::from(color[0]))?;
                        [
                            r,
                            g,
                            b,
                            transparency
                                .get(usize::from(color[0]))
                                .copied()
                                .unwrap_or(255),
                        ]
                    }
                };
            }
        }
    }
    Some((width as u32, height as u32, rgba.into_flattened()))
}

/// Up to the first error.
pub fn read<const N: usize>(
    bytes: &[u8],
    (width, height): (u32, u32),
    mut take: impl FnMut(&[u8]),
) -> Option<()> {
    let stride = width as usize * N + 1;
    let (mut above, mut row) = (vec![[0; N]; width as usize], vec![[0; N]; width as usize]);
    let (mut inflated, mut end) = (vec![0; (128usize << 10).next_multiple_of(stride)], 0);
    let (mut inflater, mut rows_left) = (Inflater::new()?, height as usize);
    for mut input in png_chunks(bytes)
        .filter(|it| it.0 == b"IDAT")
        .map(|it| it.1)
    {
        loop {
            let (consumed, produced, is_done) = inflater.inflate(input, &mut inflated[end..])?;
            (input, end) = (&input[consumed..], end + produced);
            let (rows, is_full) = ((end / stride).min(rows_left), end == inflated.len());
            for raw in inflated.chunks_exact(stride).take(rows) {
                unfilter(raw[0], raw[1..].as_chunks().0, &above, &mut row)?;
                take(row.as_flattened());
                std::mem::swap(&mut above, &mut row);
            }
            rows_left -= rows;
            if rows_left == 0 || is_done {
                return Some(());
            }
            inflated.copy_within(rows * stride..end, 0);
            end -= rows * stride;
            if !is_full && (input.is_empty() || consumed + produced == 0) {
                break;
            }
        }
    }
    Some(())
}
