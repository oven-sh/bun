//! The five scanline filters, whose loops are in src/jsc/bindings/highway_png.cpp. Above the image (or pass) are zeros.
//!
//! A line is a row behind the byte that says which filter it has, its filter type.

use crate::error::{Error, Result};

const NONE: u8 = 0;
const PAETH: u8 = 4;

/// What is above the first row.
pub(crate) fn zeros(len: usize) -> Result<Vec<u8>> {
    let mut zeros = Vec::new();
    zeros.try_reserve_exact(len)?;
    zeros.resize(len, 0);
    Ok(zeros)
}

/// Turns the filtered `row` back into pixels of `bytes_per_pixel`. `above` is the row before it, turned back already.
pub(crate) fn unfilter(
    filter_type: u8,
    bytes_per_pixel: usize,
    row: &mut [u8],
    above: &[u8],
) -> Result<()> {
    if filter_type > PAETH {
        return Err(Error::InvalidFilterType);
    }
    // 3 is not among them: see `push_rgb_as_rgba()`.
    if !matches!(bytes_per_pixel, 1 | 2 | 4 | 6 | 8) || row.len() != above.len() {
        return Err(Error::Internal);
    }
    if filter_type != NONE {
        bun_highway::png_unfilter(filter_type, bytes_per_pixel, row, above);
    }
    Ok(())
}

/// The alpha does not count: see `make_opaque()`.
pub(crate) fn push_rgb_as_rgba(rgb: &[u8], rgba: &mut Vec<u8>) -> Result<()> {
    rgba.try_reserve(rgb.len() / 3 * 4)?;
    // Four pixels at a time.
    let (fours, rest) = rgb.as_chunks::<12>();
    for &[r0, g0, b0, r1, g1, b1, r2, g2, b2, r3, g3, b3] in fours {
        rgba.extend_from_slice(&[r0, g0, b0, 0, r1, g1, b1, 0, r2, g2, b2, 0, r3, g3, b3, 0]);
    }
    for &[r, g, b] in rest.as_chunks().0 {
        rgba.extend_from_slice(&[r, g, b, 0]);
    }
    Ok(())
}

pub(crate) fn make_opaque(rgba: &mut [u8]) {
    for [.., alpha] in rgba.as_chunks_mut::<4>().0 {
        *alpha = 255;
    }
}

/// A line for each filter type, to pick one from.
pub(crate) struct CandidateLines {
    lines: [Vec<u8>; 5],
}

impl CandidateLines {
    /// Unless `adaptive`, there is only `unfiltered`.
    pub(crate) fn new(row_bytes: usize, adaptive: bool) -> Result<Self> {
        let mut lines: [Vec<u8>; 5] = Default::default();
        let used = if adaptive { lines.len() } else { 1 };
        for (filter_type, line) in (NONE..).zip(&mut lines).take(used) {
            line.try_reserve_exact(row_bytes.saturating_add(1))?;
            line.push(filter_type);
            line.resize(row_bytes.saturating_add(1), 0);
        }
        Ok(Self { lines })
    }

    /// `row` behind filter type 0.
    pub(crate) fn unfiltered(&mut self, row: &[u8]) -> &[u8] {
        let [none, ..] = &mut self.lines;
        none.truncate(1);
        none.extend_from_slice(row);
        none
    }

    /// `row`, of 4-byte pixels, behind the filter type that brings its bytes nearest to zero, filtered.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1666
    pub(crate) fn best(&mut self, row: &[u8], above: &[u8]) -> &[u8] {
        self.unfiltered(row);
        let [_, filtered @ ..] = &mut self.lines;
        let filtered = filtered
            .each_mut()
            .map(|line| line.get_mut(1..).unwrap_or_default());
        let sums = bun_highway::png_filter_rgba(row, above, filtered);
        // The first of equals.
        let best = self.lines.iter().zip(sums).min_by_key(|&(_, sum)| sum);
        best.map(|(line, _)| line.as_slice()).unwrap_or_default()
    }
}
