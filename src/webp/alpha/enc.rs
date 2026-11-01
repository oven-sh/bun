//! `alpha_enc.c`

use super::filters::{Filter, apply_filter, estimate_best_filter};
use super::{ALPHA_LOSSLESS_COMPRESSION, ALPHA_NO_COMPRESSION};
use crate::util::{try_vec, try_with_capacity};
use crate::vp8l::enc::{BitWriter, Config, encode_stream};
use crate::{Error, Result};

/// `EncodeLossless`: the plane becomes the green channel of an image. `header` comes first.
fn encode_lossless(header: u8, data: &[u8], width: usize, height: usize) -> Result<Vec<u8>> {
    let mut argb = try_vec(0u32, data.len())?;
    for (argb, &alpha) in argb.iter_mut().zip(data) {
        *argb = u32::from(alpha) << 8;
    }
    let mut bw = BitWriter::new();
    bw.put_bits(header.into(), 8);
    encode_stream(Config::AlphaPlane, argb, width, height, &mut bw)?;
    bw.finish()
}

/// `EncodeAlphaInternal`: the chunk for `data`, which `filter` has been applied to.
fn encode_filtered(data: &[u8], width: usize, height: usize, filter: Filter) -> Result<Vec<u8>> {
    let header = |method: u8| method | ((filter as u8) << 2);
    let compressed = encode_lossless(header(ALPHA_LOSSLESS_COMPRESSION), data, width, height)?;
    if compressed.len() <= 1 + data.len() {
        return Ok(compressed);
    }
    let mut chunk = try_with_capacity(1 + data.len())?;
    chunk.push(header(ALPHA_NO_COMPRESSION));
    chunk.extend_from_slice(data);
    Ok(chunk)
}

/// `GetNumColors`
fn count_levels(data: &[u8]) -> usize {
    let mut levels = [false; 256];
    for &value in data {
        if let Some(is_used) = levels.get_mut(usize::from(value)) {
            *is_used = true;
        }
    }
    levels.into_iter().filter(|&is_used| is_used).count()
}

/// `VP8EncStartAlpha`/`VP8EncFinishAlpha` with `alpha_compression` 1, `alpha_filtering` 1, `alpha_quality` 100.
pub(crate) fn encode(alpha: &[u8], width: usize, height: usize) -> Result<Vec<u8>> {
    const MIN_COLORS_FOR_FILTER_NONE: usize = 16;
    if width == 0 || height == 0 || alpha.len() != width * height {
        return Err(Error::Bug);
    }
    // At this `method`, `Filter::None` is always tried. So is the filter that looks best, unless there are few levels.
    let best = encode_filtered(alpha, width, height, Filter::None)?;
    if count_levels(alpha) <= MIN_COLORS_FOR_FILTER_NONE {
        return Ok(best);
    }
    let filter = estimate_best_filter(alpha, width, height)?;
    if filter == Filter::None {
        return Ok(best);
    }
    let mut filtered_alpha = try_vec(0u8, alpha.len())?;
    apply_filter(filter, alpha, width, &mut filtered_alpha)?;
    let trial = encode_filtered(&filtered_alpha, width, height, filter)?;
    Ok(if trial.len() < best.len() {
        trial
    } else {
        best
    })
}
