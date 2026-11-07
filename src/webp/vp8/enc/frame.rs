//! `frame_enc.c`: the loop over the macroblocks that makes the token partition.

use super::Encoder;
use super::bit_writer::BitWriter;
use super::cost::{
    Proba, TYPE_CHROMA, TYPE_I4_AC, TYPE_I16_AC, TYPE_I16_DC, bit_cost, flatten, flatten_mut,
};
use super::filter;
use super::iterator::EncIterator;
use super::quant::{ModeScore, decimate, set_segment_params};
use super::syntax::MAX_PARTITION0_SIZE;
use super::token::TokenBuffer;
use crate::Result;
use crate::util::{Checked, SliceExt};
use crate::vp8::common::{MB_FEATURE_TREE_PROBS, NUM_MB_SEGMENTS};
use crate::vp8::tables::{COEFFS_PROBA0, COEFFS_UPDATE_PROBA};

/// The limit on the size of the first partition, with 2 KiB of headroom, in 1/256 bit.
const PARTITION0_SIZE_LIMIT: u64 = (MAX_PARTITION0_SIZE as u64 - 2048) << 11;

fn token_proba(nb: i32, total: i32) -> u8 {
    (255 - (nb * 255).checked_div(total).unwrap_or(0)) as u8
}

/// The cost of coding `nb` ones and `total - nb` zeros with the probability `proba`.
fn branch_cost(nb: i32, total: i32, proba: u8) -> Checked<i32> {
    Ok(nb * bit_cost(true, proba)? + (total - nb) * bit_cost(false, proba)?)
}

/// Deduces the probabilities from the statistics, where that pays for the update.
fn finalize_token_probas(proba: &mut Proba) -> Checked {
    let mut has_changed = false;
    let defaults = flatten(&COEFFS_PROBA0)
        .iter()
        .zip(flatten(&COEFFS_UPDATE_PROBA));
    let coeffs = flatten_mut(&mut proba.coeffs)
        .iter_mut()
        .zip(flatten(&proba.stats));
    for ((coeff, &stats), (&old_p, &update_proba)) in coeffs.zip(defaults) {
        let nb = (stats & 0xffff) as i32;
        let total = (stats >> 16) as i32;
        let new_p = token_proba(nb, total);
        let old_cost = branch_cost(nb, total, old_p)? + bit_cost(false, update_proba)?;
        let new_cost = branch_cost(nb, total, new_p)? + bit_cost(true, update_proba)? + 8 * 256;
        *coeff = if old_cost > new_cost { new_p } else { old_p };
        has_changed |= *coeff != old_p;
    }
    proba.dirty = has_changed;
    Ok(())
}

/// `GetProba`: the probability of a 0, from how often each bit occurs.
fn branch_proba(zeros: u64, ones: u64) -> u8 {
    let total = zeros + ones;
    (255 * zeros + total / 2).checked_div(total).unwrap_or(255) as u8
}

fn set_segment_probas(enc: &mut Encoder<'_>) -> Checked {
    if enc.segment_hdr.num_segments <= 1 {
        enc.segment_hdr.update_map = false;
        enc.segment_hdr.map_cost = 0;
        return Ok(());
    }
    let mut p = [0u64; NUM_MB_SEGMENTS];
    for mb in &enc.mb_info {
        *p.at_mut(usize::from(mb.segment))? += 1;
    }
    let [p0, p1, p2, p3] = p;
    let probas = [
        branch_proba(p0 + p1, p2 + p3),
        branch_proba(p0, p1),
        branch_proba(p2, p3),
    ];
    enc.proba.segments = probas;
    enc.segment_hdr.update_map = probas != [255; MB_FEATURE_TREE_PROBS];
    if !enc.segment_hdr.update_map {
        for mb in &mut enc.mb_info {
            mb.segment = 0;
        }
    }
    let cost = |bit0, bit1| -> Checked<u64> {
        let proba1 = if bit0 { probas[2] } else { probas[1] };
        Ok((bit_cost(bit0, probas[0])? + bit_cost(bit1, proba1)?) as u64)
    };
    enc.segment_hdr.map_cost = p0 * cost(false, false)?
        + p1 * cost(false, true)?
        + p2 * cost(true, false)?
        + p3 * cost(true, true)?;
    Ok(())
}

fn record_tokens(
    it: &mut EncIterator,
    rd: &ModeScore,
    proba: &mut Proba,
    tokens: &mut TokenBuffer,
) -> Result<()> {
    let stats = flatten_mut(&mut proba.stats);
    it.nz_to_bytes()?;
    let (first, coeff_type) = if rd.is_i16 {
        let ctx = it.top_nz[8] + it.left_nz[8];
        let non_zero = tokens.record_coeff_tokens(TYPE_I16_DC, 0, ctx, &rd.y_dc_levels, stats)?;
        it.top_nz[8] = u8::from(non_zero);
        it.left_nz[8] = u8::from(non_zero);
        (1, TYPE_I16_AC)
    } else {
        (0, TYPE_I4_AC)
    };

    let (top_y, top_uv) = it.top_nz.split_at_mid(4)?;
    let (left_y, left_uv) = it.left_nz.split_at_mid(4)?;
    for (levels, left_nz) in rd.y_ac_levels.as_chunks::<4>().0.iter().zip(left_y) {
        for (levels, top_nz) in levels.iter().zip(&mut *top_y) {
            let ctx = *top_nz + *left_nz;
            let non_zero = tokens.record_coeff_tokens(coeff_type, first, ctx, levels, stats)?;
            *top_nz = u8::from(non_zero);
            *left_nz = *top_nz;
        }
    }

    let top_uv = top_uv.as_chunks_mut::<2>().0.iter_mut();
    let planes = top_uv.zip(left_uv.as_chunks_mut::<2>().0);
    for (levels, (top, left)) in rd.uv_levels.as_chunks::<4>().0.iter().zip(planes) {
        for (levels, left_nz) in levels.as_chunks::<2>().0.iter().zip(left) {
            for (levels, top_nz) in levels.iter().zip(&mut *top) {
                let ctx = *top_nz + *left_nz;
                let non_zero = tokens.record_coeff_tokens(TYPE_CHROMA, 0, ctx, levels, stats)?;
                *top_nz = u8::from(non_zero);
                *left_nz = *top_nz;
            }
        }
    }
    it.bytes_to_nz()?;
    Ok(())
}

fn set_loop_params(enc: &mut Encoder<'_>) -> Checked {
    set_segment_params(enc)?;
    set_segment_probas(enc)?;
    enc.proba.calculate_level_costs()
}

/// The least number of macroblocks between two updates of the probabilities.
const MIN_COUNT: usize = 96;

/// `VP8EncTokenLoop`: returns the token partition.
pub(super) fn token_loop(enc: &mut Encoder<'_>) -> Result<Vec<u8>> {
    // Refresh the probabilities about eight times.
    let max_count = ((enc.mb_w * enc.mb_h) >> 3).max(MIN_COUNT);
    let mut it = EncIterator::new(enc)?;
    // A page holds 4 to 24 tokens a macroblock: the lower the quality, the fewer the tokens.
    let scale = 1.0 + enc.quality * 5.0 / 100.0;
    let page_size = ((enc.mb_w * enc.mb_h * 4) as f32 * scale) as usize;
    let mut tokens = TokenBuffer::new(page_size)?;

    loop {
        let mut size_p0 = 0u64;
        let mut cnt = max_count;
        it.reset();
        set_loop_params(enc)?;
        flatten_mut(&mut enc.proba.stats).fill(0);
        tokens.clear();
        loop {
            it.import(enc.pic)?;
            if cnt == 0 {
                finalize_token_probas(&mut enc.proba)?;
                enc.proba.calculate_level_costs()?;
                cnt = max_count;
            } else {
                cnt -= 1;
            }
            let rd = decimate(enc, &mut it)?;
            record_tokens(&mut it, &rd, &mut enc.proba, &mut tokens)?;
            size_p0 += rd.h as u64;
            it.save_boundary()?;
            if !it.next() {
                break;
            }
        }
        size_p0 += enc.segment_hdr.map_cost;
        if enc.max_i4_header_bits == 0 || size_p0 <= PARTITION0_SIZE_LIMIT {
            break;
        }
        // The modes would not fit in the first partition: start over with less room for those of i4x4 macroblocks.
        enc.max_i4_header_bits >>= 1;
    }

    finalize_token_probas(&mut enc.proba)?;
    let mut bw = BitWriter::new(tokens.len() / 8)?;
    tokens.emit_tokens(&mut bw, flatten(&enc.proba.coeffs))?;
    filter::adjust_strength(enc);
    bw.finish()
}
