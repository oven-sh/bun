//! `frame_enc.c`: the loop over the macroblocks that makes the token partition.

use super::Encoder;
use super::bit_writer::BitWriter;
use super::cost::{Proba, TYPE_CHROMA_A, TYPE_I4_AC, TYPE_I16_AC, TYPE_I16_DC, bit_cost};
use super::filter::adjust_filter_strength;
use super::iterator::EncIterator;
use super::quant::{ModeScore, decimate, set_segment_params};
use super::tables::{COEFFS_PROBA0, COEFFS_UPDATE_PROBA, NUM_MB_SEGMENTS, flatten, flatten_mut};
use super::token::TokenBuffer;
use crate::Result;
use crate::util::Checked;

/// The limit on the size of the first partition, with 2 KiB of headroom, in 1/256 bit.
const PARTITION0_SIZE_LIMIT: u64 = ((1 << 19) - 2048) << 11;

fn calc_token_proba(nb: i32, total: i32) -> i32 {
    255 - (nb * 255).checked_div(total).unwrap_or(0)
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
        let new_p = calc_token_proba(nb, total) as u8;
        let old_cost = branch_cost(nb, total, old_p)? + bit_cost(false, update_proba)?;
        let new_cost = branch_cost(nb, total, new_p)? + bit_cost(true, update_proba)? + 8 * 256;
        if old_cost > new_cost {
            *coeff = new_p;
            has_changed |= new_p != old_p;
        } else {
            *coeff = old_p;
        }
    }
    proba.dirty = has_changed;
    Ok(())
}

// The probabilities of the tree of the segments

fn get_proba(a: u64, b: u64) -> u8 {
    let total = a + b;
    (255 * a + total / 2).checked_div(total).unwrap_or(255) as u8
}

fn set_segment_probas(enc: &mut Encoder<'_>) -> Checked {
    if enc.segment_hdr.num_segments <= 1 {
        enc.segment_hdr.update_map = false;
        enc.segment_hdr.size = 0;
        return Ok(());
    }
    let mut p = [0u64; NUM_MB_SEGMENTS];
    for mb in &enc.mb_info {
        if let Some(count) = p.get_mut(usize::from(mb.segment)) {
            *count += 1;
        }
    }
    let [p0, p1, p2, p3] = p;
    let probas = [
        get_proba(p0 + p1, p2 + p3),
        get_proba(p0, p1),
        get_proba(p2, p3),
    ];
    enc.proba.segments = probas;
    enc.segment_hdr.update_map = probas != [255; 3];
    if !enc.segment_hdr.update_map {
        for mb in &mut enc.mb_info {
            mb.segment = 0;
        }
    }
    let cost = |bit0, bit1| -> Checked<u64> {
        let proba1 = if bit0 { probas[2] } else { probas[1] };
        Ok((bit_cost(bit0, probas[0])? + bit_cost(bit1, proba1)?) as u64)
    };
    enc.segment_hdr.size = p0 * cost(false, false)?
        + p1 * cost(false, true)?
        + p2 * cost(true, false)?
        + p3 * cost(true, true)?;
    Ok(())
}

//------------------------------------------------------------------------------

fn record_tokens(
    it: &mut EncIterator,
    rd: &ModeScore,
    proba: &mut Proba,
    tokens: &mut TokenBuffer,
) -> Result<()> {
    let stats = flatten_mut(&mut proba.stats);
    tokens.reserve(1 + 16 + 8)?;
    it.nz_to_bytes()?;
    let (first, coeff_type) = if rd.is_i16 {
        let ctx = it.top_nz[8] + it.left_nz[8];
        let non_zero = tokens.record_coeff_tokens(ctx, TYPE_I16_DC, 0, &rd.y_dc_levels, stats)?;
        it.top_nz[8] = u8::from(non_zero);
        it.left_nz[8] = u8::from(non_zero);
        (1, TYPE_I16_AC)
    } else {
        (0, TYPE_I4_AC)
    };

    let [top_y @ .., top_u0, top_u1, top_v0, top_v1, _] = &mut it.top_nz;
    let [left_y @ .., left_u0, left_u1, left_v0, left_v1, _] = &mut it.left_nz;
    let (top_y, left_y): (&mut [u8; 4], &mut [u8; 4]) = (top_y, left_y);
    for (levels, left_nz) in rd.y_ac_levels.as_chunks::<4>().0.iter().zip(left_y) {
        for (levels, top_nz) in levels.iter().zip(&mut *top_y) {
            let ctx = *top_nz + *left_nz;
            let non_zero = tokens.record_coeff_tokens(ctx, coeff_type, first, levels, stats)?;
            *top_nz = u8::from(non_zero);
            *left_nz = *top_nz;
        }
    }

    let planes = [
        ([top_u0, top_u1], [left_u0, left_u1]),
        ([top_v0, top_v1], [left_v0, left_v1]),
    ];
    for (levels, (mut top, left)) in rd.uv_levels.as_chunks::<4>().0.iter().zip(planes) {
        for (levels, left_nz) in levels.as_chunks::<2>().0.iter().zip(left) {
            for (levels, top_nz) in levels.iter().zip(&mut top) {
                let ctx = **top_nz + *left_nz;
                let non_zero = tokens.record_coeff_tokens(ctx, TYPE_CHROMA_A, 0, levels, stats)?;
                **top_nz = u8::from(non_zero);
                *left_nz = **top_nz;
            }
        }
    }
    it.bytes_to_nz()?;
    Ok(())
}

//------------------------------------------------------------------------------

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
    let mut tokens = TokenBuffer::default();

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
            let info = decimate(enc, &mut it)?;
            record_tokens(&mut it, &info, &mut enc.proba, &mut tokens)?;
            size_p0 += info.score.h as u64;
            it.save_boundary()?;
            if !it.next() {
                break;
            }
        }
        size_p0 += enc.segment_hdr.size;
        if enc.max_i4_header_bits == 0 || size_p0 <= PARTITION0_SIZE_LIMIT {
            break;
        }
        // The modes would not fit in the first partition: start over with less room for those of i4x4 macroblocks.
        enc.max_i4_header_bits >>= 1;
    }

    finalize_token_probas(&mut enc.proba)?;
    let mut bw = BitWriter::new(tokens.len() / 8)?;
    tokens.emit_tokens(&mut bw, flatten(&enc.proba.coeffs))?;
    adjust_filter_strength(enc);
    bw.finish()
}
