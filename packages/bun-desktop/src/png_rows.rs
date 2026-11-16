//! Reads the common kinds of PNG row by row, and is quick where a screenshot is flat.

use fdeflate::Decompressor;

fn chunks(bytes: &[u8]) -> impl Iterator<Item = (&[u8; 4], &[u8])> {
    let mut rest = bytes.strip_prefix(b"\x89PNG\r\n\x1a\n").unwrap_or_default();
    std::iter::from_fn(move || {
        let (length, after) = rest.split_first_chunk()?;
        let (kind, after) = after.split_first_chunk()?;
        let (data, after) = after.split_at((u32::from_be_bytes(*length) as usize).min(after.len()));
        rest = after.get(4..).unwrap_or_default();
        Some((kind, data))
    })
}

/// 3 for RGB and 4 for RGBA, with 8 bits each, unless it takes more than `read` to decode it.
pub fn channels(bytes: &[u8]) -> Option<usize> {
    let channels = match chunks(bytes).next()? {
        (b"IHDR", [_, _, _, _, _, _, _, _, 8, 2, 0, 0, 0]) => 3,
        (b"IHDR", [_, _, _, _, _, _, _, _, 8, 6, 0, 0, 0]) => 4,
        _ => return None,
    };
    chunks(bytes)
        .all(|it| !matches!(it, (b"tRNS" | b"eXIf", _) | (b"IDAT", [_])))
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
    const WINDOW: usize = 32 << 10;
    let stride = width as usize * N + 1;
    let (mut above, mut row) = (vec![[0; N]; width as usize], vec![[0; N]; width as usize]);
    let (mut inflated, mut start, mut end) = (vec![0; WINDOW * 5 + stride], 0, 0);
    let (mut decompressor, mut rows_left) = (Decompressor::new(), height);
    decompressor.ignore_adler32();
    let mut data = chunks(bytes)
        .filter(|it| it.0 == b"IDAT")
        .map(|it| it.1)
        .peekable();
    while let Some(mut input) = data.next() {
        loop {
            let (consumed, produced) = decompressor
                .read(input, &mut inflated, end, data.peek().is_none())
                .ok()?;
            (input, end) = (&input[consumed..], end + produced);
            while end - start >= stride && rows_left > 0 {
                unfilter(
                    inflated[start],
                    inflated[start + 1..start + stride].as_chunks().0,
                    &above,
                    &mut row,
                )?;
                take(row.as_flattened());
                std::mem::swap(&mut above, &mut row);
                (start, rows_left) = (start + stride, rows_left - 1);
            }
            if rows_left == 0 || decompressor.is_done() {
                return Some(());
            }
            if inflated.len() - end < WINDOW {
                let kept = start.min(end - WINDOW);
                inflated.copy_within(kept..end, 0);
                (start, end) = (start - kept, end - kept);
            } else if consumed == 0 && produced == 0 {
                break;
            }
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use image::ImageEncoder as _;
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};

    #[test]
    fn reads_what_was_encoded() {
        let (width, height) = (333, 700);
        let pixels: Vec<u8> = (0..width * height * 3)
            .map(|it: u32| {
                if it / 999 % 7 < 3 || it % 999 < 400 {
                    9
                } else {
                    (it.wrapping_mul(it) >> 7) as u8
                }
            })
            .collect();
        for filter in [
            FilterType::NoFilter,
            FilterType::Sub,
            FilterType::Up,
            FilterType::Avg,
            FilterType::Paeth,
            FilterType::Adaptive,
        ] {
            let (mut encoded, mut read) = (Vec::new(), Vec::<u8>::new());
            let encoder =
                PngEncoder::new_with_quality(&mut encoded, CompressionType::Default, filter);
            encoder
                .write_image(&pixels, width, height, image::ExtendedColorType::Rgb8)
                .unwrap();
            assert_eq!(super::channels(&encoded), Some(3));
            super::read::<3>(&encoded, (width, height), |row| read.extend(row));
            assert!(read == pixels, "{filter:?}");
            super::read::<3>(&encoded[..encoded.len() / 2], (width, height), |_| ());
        }
    }
}
