//! Sorts the macroblocks into segments by how well they take being quantized.

use bun_highway::webp::{self, Block, Histograms, Macroblock};

use super::border::{self, Border};
use super::memo::Memo;
use super::picture::Picture;
use crate::array::At;
use crate::error::Result;
use crate::lossy::SEGMENTS;
use crate::vec;

pub(super) struct Analysis {
    /// The segment of each macroblock.
    pub(super) map: Vec<u8>,
    pub(super) quantizer_susceptibilities: [i8; SEGMENTS],
    pub(super) filter_susceptibilities: [u8; SEGMENTS],
    pub(super) chroma_susceptibility: i32,
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/analysis_enc.c#L426
#[inline(never)]
pub(super) fn analyze(picture: &Picture) -> Result<Analysis> {
    let mut map = vec::with_room(picture.macroblocks.len())?;
    let mut histogram = [0; 256];
    let mut chroma_sum = 0;
    let mut last = Memo::default();
    let mut row_above: &[Macroblock] = &[];
    for row in picture.rows() {
        let (mut left, mut above_left) = ([None; 2], [None; 2]);
        for (x, samples) in row.iter().enumerate() {
            let above = row_above.get(x).map_or([None; 2], bottom);
            let &[luma, chroma] = last.get(samples, &[above, left, above_left], |it| {
                let luma = border::luma_edges(above[0], left[0], above_left[0]);
                let chroma = border::chroma_edges(above[1], left[1], above_left[1]);
                *it = webp::analyze(samples, &luma, &chroma).map(susceptibility);
            });
            let mixed = 255_u32.saturating_sub((3 * luma + chroma + 2) >> 2) as u8;
            *histogram.at_mut(mixed.into()) += 1;
            map.push(mixed);
            chroma_sum += u64::from(chroma);
            left = right(samples);
            above_left = above;
        }
        row_above = row;
    }
    let (centers, nearest, average) = cluster(&histogram);
    for entry in &mut map {
        *entry = *nearest.at((*entry).into());
    }
    let min = centers.into_iter().fold(255, i32::min);
    let range = (centers.into_iter().fold(0, i32::max) - min).max(1);
    Ok(Analysis {
        chroma_susceptibility: (chroma_sum / map.len().max(1) as u64) as i32,
        map,
        quantizer_susceptibilities: centers
            .map(|it| (255 * (it - average) / range).clamp(-127, 127) as i8),
        filter_susceptibilities: centers.map(|it| (255 * (it - min) / range) as u8),
    })
}

/// Of luma and of chroma.
fn bottom(samples: &Macroblock) -> [Border; 2] {
    let row = |blocks: [&Block; 4]| {
        core::array::from_fn(|i| (u32::from_le_bytes(*blocks.at(i / 4).at(i % 4)) >> 24) as u8)
    };
    let [.., y0, y1, y2, y3] = &samples.luma;
    let [_, _, u0, u1, _, _, v0, v1] = &samples.chroma;
    [Some(row([y0, y1, y2, y3])), Some(row([u0, u1, v0, v1]))]
}

fn right(samples: &Macroblock) -> [Border; 2] {
    let column = |blocks: [&Block; 4]| border::joined(blocks.map(|it| u32::from_be_bytes(it[3])));
    let [_, _, _, y0, _, _, _, y1, _, _, _, y2, _, _, _, y3] = &samples.luma;
    let [_, u0, _, u1, _, v0, _, v1] = &samples.chroma;
    [
        Some(column([y3, y2, y1, y0])),
        Some(column([u1, u0, v1, v0])),
    ]
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/analysis_enc.c#L117
fn susceptibility(histograms: Histograms) -> u32 {
    let pairs = histograms
        .last_bin
        .into_iter()
        .zip(histograms.highest_count);
    pairs
        .map(|(last, highest)| 510 * last / highest.max(1))
        .fold(0, u32::max)
}

/// k-means. Returns the centers, which of them is the nearest to each value, and their weighted average.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/analysis_enc.c#L136
fn cluster(histogram: &[i32; 256]) -> ([i32; SEGMENTS], [u8; 256], i32) {
    let min = histogram
        .iter()
        .position(|&count| count != 0)
        .unwrap_or_default() as i32;
    let max = histogram
        .iter()
        .rposition(|&count| count != 0)
        .unwrap_or_default() as i32;
    let mut centers = [1, 3, 5, 7].map(|n| min + n * (max - min) / 8);
    let mut nearest = [0; 256];
    let mut average = 0;
    for _ in 0..6 {
        let mut clusters = [(0, 0); SEGMENTS];
        let mut n = 0;
        for ((value, &count), nearest) in (0..).zip(histogram).zip(&mut nearest) {
            if count != 0 {
                while n + 1 < SEGMENTS
                    && (value - centers.at(n + 1)).abs() < (value - centers.at(n)).abs()
                {
                    n += 1;
                }
                *nearest = n as u8;
                let (sum, weight) = clusters.at_mut(n);
                *sum += value * count;
                *weight += count;
            }
        }
        let (mut displaced, mut total_sum, mut total_weight) = (0, 0, 0);
        for (center, (sum, weight)) in centers.iter_mut().zip(clusters) {
            if let Some(new_center) = i32::checked_div(sum + weight / 2, weight) {
                displaced += (*center - new_center).abs();
                *center = new_center;
                total_sum += new_center * weight;
                total_weight += weight;
            }
        }
        average = (total_sum + total_weight / 2) / total_weight.max(1);
        if displaced < 5 {
            break;
        }
    }
    (centers, nearest, average)
}
