//! `tree_dec.c`: the coefficient probabilities and the prediction modes, both from the first partition.

use super::MbData;
use super::bit_reader::BitReader;
use crate::util::{Checked, SliceExt};
use crate::vp8::common::{IntraMode, MB_FEATURE_TREE_PROBS, NUM_CTX, NUM_PROBAS, NUM_TYPES};
use crate::vp8::tables::{BANDS, BMODES_PROBA, COEFFS_PROBA0, COEFFS_UPDATE_PROBA};

/// The probabilities of one band, by context.
pub(super) type BandProbas = [[u8; NUM_PROBAS]; NUM_CTX];

/// The probabilities of one type of block, by the position of the coefficient rather than by its band.
pub(super) type TypeProbas = [BandProbas; 16 + 1];

pub(super) struct Proba {
    pub(super) segments: [u8; MB_FEATURE_TREE_PROBS],
    pub(super) bands: [TypeProbas; NUM_TYPES],
    /// The probability that a macroblock has no coefficients, if macroblocks say so at all.
    pub(super) skip_p: Option<u8>,
}

impl Proba {
    /// `VP8ParseProba`, paragraphs 13.4 and 9.11.
    pub(super) fn parse(
        br: &mut BitReader<'_>,
        segments: [u8; MB_FEATURE_TREE_PROBS],
    ) -> Checked<Self> {
        let mut bands = [[[[0; NUM_PROBAS]; NUM_CTX]; 16 + 1]; NUM_TYPES];
        for ((by_position, defaults), updates) in bands
            .iter_mut()
            .zip(&COEFFS_PROBA0)
            .zip(&COEFFS_UPDATE_PROBA)
        {
            let mut by_band = *defaults;
            let probas = by_band.as_flattened_mut().as_flattened_mut();
            for (proba, &update) in probas.iter_mut().zip(updates.as_flattened().as_flattened()) {
                if br.get_bit(update) {
                    *proba = br.get_value(8) as u8;
                }
            }
            for (probas, &band) in by_position.iter_mut().zip(&BANDS) {
                *probas = by_band.at(usize::from(band))?;
            }
        }
        let skip_p = br.get().then(|| br.get_value(8) as u8);
        Ok(Self {
            segments,
            bands,
            skip_p,
        })
    }
}

fn parse_mode4(br: &mut BitReader<'_>, prob: &[u8; 9]) -> IntraMode {
    if !br.get_bit(prob[0]) {
        IntraMode::Dc
    } else if !br.get_bit(prob[1]) {
        IntraMode::TrueMotion
    } else if !br.get_bit(prob[2]) {
        IntraMode::Vertical
    } else if !br.get_bit(prob[3]) {
        if !br.get_bit(prob[4]) {
            IntraMode::Horizontal
        } else if !br.get_bit(prob[5]) {
            IntraMode::DownRight
        } else {
            IntraMode::VerticalRight
        }
    } else if !br.get_bit(prob[6]) {
        IntraMode::DownLeft
    } else if !br.get_bit(prob[7]) {
        IntraMode::VerticalLeft
    } else if !br.get_bit(prob[8]) {
        IntraMode::HorizontalDown
    } else {
        IntraMode::HorizontalUp
    }
}

/// `top` and `left` are the modes of the 4x4 blocks along the macroblock's edges, and become those of its own last
/// row and column.
pub(super) fn parse_intra_mode(
    br: &mut BitReader<'_>,
    proba: &Proba,
    update_map: bool,
    top: &mut [IntraMode; 4],
    left: &mut [IntraMode; 4],
    block: &mut MbData,
) -> Checked {
    block.segment = if !update_map {
        0
    } else if !br.get_bit(proba.segments[0]) {
        u8::from(br.get_bit(proba.segments[1]))
    } else {
        u8::from(br.get_bit(proba.segments[2])) + 2
    };
    if let Some(skip_p) = proba.skip_p {
        block.skip = br.get_bit(skip_p);
    }

    block.is_i4x4 = !br.get_bit(145);
    if !block.is_i4x4 {
        let ymode = if br.get_bit(156) {
            if br.get_bit(128) {
                IntraMode::TrueMotion
            } else {
                IntraMode::Horizontal
            }
        } else if br.get_bit(163) {
            IntraMode::Vertical
        } else {
            IntraMode::Dc
        };
        block.imodes[0] = ymode;
        *top = [ymode; 4];
        *left = [ymode; 4];
    } else {
        for (modes, left) in block.imodes.as_chunks_mut::<4>().0.iter_mut().zip(left) {
            let mut ymode = *left;
            for top in top.iter_mut() {
                let prob = BMODES_PROBA.at_ref(*top as usize)?.at_ref(ymode as usize)?;
                ymode = parse_mode4(br, prob);
                *top = ymode;
            }
            *modes = *top;
            *left = ymode;
        }
    }
    block.uvmode = if !br.get_bit(142) {
        IntraMode::Dc
    } else if !br.get_bit(114) {
        IntraMode::Vertical
    } else if br.get_bit(183) {
        IntraMode::TrueMotion
    } else {
        IntraMode::Horizontal
    };
    Ok(())
}
