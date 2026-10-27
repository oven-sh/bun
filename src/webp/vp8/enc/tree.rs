//! `tree_enc.c`: codes the prediction modes and the probabilities.

use super::Encoder;
use super::bit_writer::BitWriter;
use super::cost::Proba;
use super::dsp::{DC_PRED, H_PRED, TM_PRED, V_PRED};
use super::tables::{
    BMODES_PROBA, COEFFS_PROBA0, COEFFS_UPDATE_PROBA, MB_FEATURE_TREE_PROBS, NUM_BMODES, flatten,
};
use crate::util::{Checked, SliceExt};
use crate::vp8::common::IntraMode;

const B_DC_PRED: u8 = IntraMode::Dc as u8;
const B_TM_PRED: u8 = IntraMode::TrueMotion as u8;
const B_VE_PRED: u8 = IntraMode::Vertical as u8;
const B_HE_PRED: u8 = IntraMode::Horizontal as u8;
const B_RD_PRED: u8 = IntraMode::DownRight as u8;
const B_LD_PRED: u8 = IntraMode::DownLeft as u8;
const B_VL_PRED: u8 = IntraMode::VerticalLeft as u8;
const B_HD_PRED: u8 = IntraMode::HorizontalDown as u8;

fn put_i4_mode(bw: &mut BitWriter, mode: u8, prob: &[u8; NUM_BMODES - 1]) {
    if bw.put_bit(mode != B_DC_PRED, prob[0])
        && bw.put_bit(mode != B_TM_PRED, prob[1])
        && bw.put_bit(mode != B_VE_PRED, prob[2])
    {
        if !bw.put_bit(mode >= B_LD_PRED, prob[3]) {
            if bw.put_bit(mode != B_HE_PRED, prob[4]) {
                bw.put_bit(mode != B_RD_PRED, prob[5]);
            }
        } else if bw.put_bit(mode != B_LD_PRED, prob[6]) && bw.put_bit(mode != B_VL_PRED, prob[7]) {
            bw.put_bit(mode != B_HD_PRED, prob[8]);
        }
    }
}

fn put_i16_mode(bw: &mut BitWriter, mode: usize) {
    if bw.put_bit(mode == TM_PRED || mode == H_PRED, 156) {
        bw.put_bit(mode == TM_PRED, 128);
    } else {
        bw.put_bit(mode == V_PRED, 163);
    }
}

fn put_uv_mode(bw: &mut BitWriter, uv_mode: usize) {
    if bw.put_bit(uv_mode != DC_PRED, 142) && bw.put_bit(uv_mode != V_PRED, 114) {
        bw.put_bit(uv_mode != H_PRED, 183);
    }
}

fn put_segment(bw: &mut BitWriter, s: u8, p: [u8; MB_FEATURE_TREE_PROBS]) {
    let p = if bw.put_bit(s >= 2, p[0]) { p[2] } else { p[1] };
    bw.put_bit(s & 1 != 0, p);
}

pub(super) fn code_intra_modes(enc: &Encoder<'_>, bw: &mut BitWriter) -> Checked {
    for (y, mbs) in enc.mb_info.chunks_exact(enc.mb_w).enumerate() {
        for (x, mb) in mbs.iter().enumerate() {
            let pos = enc.preds_pos(x, y);
            if enc.segment_hdr.update_map {
                put_segment(bw, mb.segment, enc.proba.segments);
            }
            if bw.put_bit(mb.is_i16, 145) {
                put_i16_mode(bw, usize::from(enc.preds.at(pos)?));
            } else {
                for pos in (pos..).step_by(enc.preds_w).take(4) {
                    let top_preds = enc.preds.array_at::<4>(pos - enc.preds_w)?;
                    let [mut left, preds @ ..] = *enc.preds.array_at::<5>(pos - 1)?;
                    for (pred, &top) in preds.into_iter().zip(top_preds) {
                        let probas = BMODES_PROBA.at_ref(usize::from(top))?;
                        put_i4_mode(bw, pred, probas.at_ref(usize::from(left))?);
                        left = pred;
                    }
                }
            }
            put_uv_mode(bw, usize::from(mb.uv_mode));
        }
    }
    Ok(())
}

pub(super) fn write_probas(bw: &mut BitWriter, probas: &Proba) {
    let defaults = flatten(&COEFFS_PROBA0)
        .iter()
        .zip(flatten(&COEFFS_UPDATE_PROBA));
    for (&p0, (&default, &update_proba)) in flatten(&probas.coeffs).iter().zip(defaults) {
        if bw.put_bit(p0 != default, update_proba) {
            bw.put_bits(u32::from(p0), 8);
        }
    }
    // No probability for skipped macroblocks.
    bw.put_bit_uniform(false);
}
