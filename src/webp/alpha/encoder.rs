//! The alpha channel, filtered or not, whichever is smaller.

use super::{Filter, LOSSLESS_COMPRESSION, NO_COMPRESSION, gradient};
use crate::array::At;
use crate::error::Result;
use crate::lossless::encoder::encode_green;
use crate::vec;

/// The payload of an `ALPH` chunk.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/alpha_enc.c#L241
pub(crate) fn encode(rgba: &[[u8; 4]], width: usize, height: usize) -> Result<Vec<u8>> {
    const MAX_LEVELS_NOT_WORTH_FILTERING: usize = 16;
    let mut alpha = vec::with_room(rgba.len())?;
    alpha.extend(rgba.iter().map(|&[.., alpha]| alpha));
    let is_used = used_values(&alpha);
    let unfiltered = chunk(&alpha, width, height, &is_used, Filter::None)?;
    if is_used.iter().filter(|&&is_used| is_used).count() <= MAX_LEVELS_NOT_WORTH_FILTERING {
        return Ok(unfiltered);
    }
    let filter = likely_best_filter(&alpha, width);
    if filter == Filter::None {
        return Ok(unfiltered);
    }
    let alpha = filtered(&alpha, width, filter)?;
    let filtered = chunk(&alpha, width, height, &used_values(&alpha), filter)?;
    Ok(if filtered.len() < unfiltered.len() {
        filtered
    } else {
        unfiltered
    })
}

fn used_values(samples: &[u8]) -> [bool; 256] {
    let mut is_used = [false; 256];
    let (chunks, rest) = samples.as_chunks::<16>();
    let chunks = chunks.iter().map(|chunk @ [first, ..]| {
        if *chunk == [*first; _] {
            core::slice::from_ref(first)
        } else {
            chunk
        }
    });
    for &sample in chunks.chain([rest]).flatten() {
        *is_used.at_mut(sample.into()) = true;
    }
    is_used
}

fn chunk(
    samples: &[u8],
    width: usize,
    height: usize,
    is_used: &[bool; 256],
    filter: Filter,
) -> Result<Vec<u8>> {
    let compressed = encode_green(samples, width, height, is_used)?;
    let (compression, data) = if compressed.len() > samples.len() {
        (NO_COMPRESSION, samples)
    } else {
        (LOSSLESS_COMPRESSION, compressed.as_slice())
    };
    let mut chunk = vec::with_room(1 + data.len())?;
    chunk.push(compression | (filter as u8) << 2);
    chunk.extend_from_slice(data);
    Ok(chunk)
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/filters_utils.c#L32
// Once it is inlined, the four predictions may not be compared with vector instructions any more.
#[inline(never)]
fn likely_best_filter(alpha: &[u8], width: usize) -> Filter {
    // For each filter a bit for each sixteenth of the range that a prediction is off by.
    let mut seen = [0u16; 4];
    let rows = alpha.chunks(width.max(1));
    let inner_rows = rows.len().saturating_sub(1);
    let mut rows = rows.take(inner_rows).skip(1);
    while let (Some([_, above @ .., _]), Some([first, row @ .., _])) = (rows.next(), rows.next()) {
        let mut mean = *first;
        let pairs = row.as_chunks().0.iter().zip(above.as_chunks().0);
        for (&[left, sample], &[above_left, above]) in pairs {
            let predictions = [mean, left, above, gradient(left, above, above_left)];
            for (seen, prediction) in seen.iter_mut().zip(predictions) {
                *seen |= 1 << (sample.abs_diff(prediction) >> 4);
            }
            mean = ((3 * u16::from(mean) + u16::from(sample) + 2) >> 2) as u8;
        }
    }
    let score = |seen: u16| -> u16 { (0..16).filter(|bit| seen >> bit & 1 != 0).sum() };
    let filters = [
        Filter::None,
        Filter::Horizontal,
        Filter::Vertical,
        Filter::Gradient,
    ];
    let best = filters.into_iter().zip(seen);
    let best = best.min_by_key(|&(_, seen)| score(seen));
    best.map_or(Filter::None, |(filter, _)| filter)
}

fn filtered(alpha: &[u8], width: usize, filter: Filter) -> Result<Vec<u8>> {
    let mut filtered = vec::with_room(alpha.len())?;
    let mut above: &[u8] = &[];
    for row in alpha.chunks(width.max(1)) {
        let first = |row: &[u8]| row.first().copied().unwrap_or(0);
        filtered.push(first(row).wrapping_sub(first(above)));
        let pairs = row.array_windows();
        if filter == Filter::Horizontal || above.is_empty() {
            filtered.extend(pairs.map(|&[left, sample]| sample.wrapping_sub(left)));
        } else if filter == Filter::Vertical {
            let pairs = row.iter().zip(above).skip(1);
            filtered.extend(pairs.map(|(&sample, &above)| sample.wrapping_sub(above)));
        } else {
            let pairs = pairs.zip(above.array_windows());
            filtered.extend(pairs.map(|(&[left, sample], &[above_left, above])| {
                sample.wrapping_sub(gradient(left, above, above_left))
            }));
        }
        above = row;
    }
    Ok(filtered)
}
