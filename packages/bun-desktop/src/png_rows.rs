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
