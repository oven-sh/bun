//! `analysis_enc.c`: measures how well each macroblock takes quantization, and groups the macroblocks into segments.

use super::dsp::{self, DC_PRED, Histogram, Lanes, TM_PRED};
use super::iterator::EncIterator;
use super::tables::NUM_MB_SEGMENTS;
use super::{Encoder, Error};
use crate::util::{Checked, SliceExt};

const MAX_ITERS_K_MEANS: usize = 6;

/// Susceptibilities have 8 bits of precision.
const MAX_ALPHA: i32 = 255;
const ALPHA_SCALE: i32 = 2 * MAX_ALPHA;

fn set_segment_alphas(enc: &mut Encoder<'_>, centers: &[i32; NUM_MB_SEGMENTS], mid: i32) {
    let min = centers
        .iter()
        .fold(i32::MAX, |min, &center| min.min(center));
    let max = centers.iter().fold(min + 1, |max, &center| max.max(center));
    for (dqm, center) in enc.dqm.iter_mut().zip(centers) {
        dqm.alpha = (255 * (center - mid) / (max - min)).clamp(-127, 127);
        dqm.beta = (255 * (center - min) / (max - min)).clamp(0, 255);
    }
}

/// The higher, the easier the macroblock is to compress.
fn get_alpha(histo: &Histogram) -> i32 {
    if histo.max_value > 1 {
        ALPHA_SCALE * histo.last_non_zero / histo.max_value
    } else {
        0
    }
}

/// A simplified k-means on the histogram of the susceptibilities.
fn assign_segments(enc: &mut Encoder<'_>, alphas: &[i32; MAX_ALPHA as usize + 1]) -> Checked {
    const NB: usize = NUM_MB_SEGMENTS;
    let mut map = [0u8; MAX_ALPHA as usize + 1];
    let mut weighted_average = 0;

    let min_a = alphas.iter().position(|&count| count != 0).unwrap_or(0);
    let max_a = alphas.iter().rposition(|&count| count != 0).unwrap_or(0);
    let range_a = (max_a - min_a) as i32;

    // Spread the initial centers evenly.
    let mut centers = [1, 3, 5, 7].map(|n| min_a as i32 + n * range_a / (2 * NB as i32));

    for _ in 0..MAX_ITERS_K_MEANS {
        let mut accum = [0; NB];
        let mut dist_accum = [0; NB];
        // Assign the nearest center to each susceptibility.
        let mut n = 0;
        for (a, (&count, map)) in alphas.iter().zip(&mut map).enumerate() {
            if count == 0 {
                continue;
            }
            let a = a as i32;
            while n + 1 < NB && (a - centers.at(n + 1)?).abs() < (a - centers.at(n)?).abs() {
                n += 1;
            }
            *map = n as u8;
            *dist_accum.at_mut(n)? += a * count;
            *accum.at_mut(n)? += count;
        }
        // Move each center to the middle of its cloud.
        let mut displaced = 0;
        let mut total_weight = 0;
        weighted_average = 0;
        for ((center, accum), dist_accum) in centers.iter_mut().zip(accum).zip(dist_accum) {
            if accum != 0 {
                let new_center = (dist_accum + accum / 2) / accum;
                displaced += (*center - new_center).abs();
                *center = new_center;
                weighted_average += new_center * accum;
                total_weight += accum;
            }
        }
        weighted_average = (weighted_average + total_weight / 2) / total_weight.max(1);
        if displaced < 5 {
            break;
        }
    }

    for mb in &mut enc.mb_info {
        mb.segment = map.at(usize::from(mb.alpha))?;
    }
    set_segment_alphas(enc, &centers, weighted_average);
    Ok(())
}

/// The best susceptibility that the prediction modes give.
fn best_alpha(histograms: impl Iterator<Item = Histogram>) -> i32 {
    histograms.fold(0, |best, histo| best.max(get_alpha(&histo)))
}

/// Returns the susceptibility of the macroblock and that of its chroma. Only the first two prediction modes are tried.
fn mb_analyze(it: &EncIterator) -> Checked<(u8, i32)> {
    let (has_left, has_top) = (it.x > 0, it.y > 0);
    let preds = dsp::intra16_preds(
        has_left.then_some(&it.y_left),
        has_top.then_some(it.y_top()?),
    );
    let src = Lanes::<u8, 16>::from_blocks(&it.y_in);
    let src = Lanes::<u8, 32>::concat([&src, &src]);
    let preds = Lanes::concat([&preds[DC_PRED], &preds[TM_PRED]]);
    let best_alpha_y = best_alpha(dsp::collect_histograms::<32, 16>(&src, &preds));

    let preds = dsp::intra_chroma_preds(
        has_left.then_some([&it.u_left, &it.v_left]),
        has_top.then_some(it.uv_top()?),
    );
    let src = Lanes::<u8, 8>::from_blocks(it.uv_in.as_flattened());
    let src = Lanes::<u8, 16>::concat([&src, &src]);
    let preds = Lanes::concat([&preds[DC_PRED], &preds[TM_PRED]]);
    let best_alpha_uv = best_alpha(dsp::collect_histograms::<16, 8>(&src, &preds));

    let mixed = (3 * best_alpha_y + best_alpha_uv + 2) >> 2;
    Ok(((MAX_ALPHA - mixed).clamp(0, MAX_ALPHA) as u8, best_alpha_uv))
}

/// `VP8EncAnalyze`
pub(super) fn analyze(enc: &mut Encoder<'_>) -> Result<(), Error> {
    let mut alphas = [0; MAX_ALPHA as usize + 1];
    let mut uv_alpha = 0i32;
    let mut it = EncIterator::new(enc)?;
    loop {
        it.import(enc.pic)?;
        it.import_boundary(enc.pic)?;
        let (alpha, best_alpha_uv) = mb_analyze(&it)?;
        *alphas.at_mut(usize::from(alpha))? += 1;
        enc.mb_mut(it.x, it.y)?.alpha = alpha;
        // libwebp adds these up in an `int` too, which a million macroblocks of the right noise can overflow.
        uv_alpha = uv_alpha.wrapping_add(best_alpha_uv);
        if !it.next() {
            break;
        }
    }
    enc.uv_alpha = uv_alpha / (enc.mb_w * enc.mb_h) as i32;
    assign_segments(enc, &alphas)?;
    Ok(())
}
