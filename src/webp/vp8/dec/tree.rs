//! `tree_dec.c`: the coefficient probabilities and the prediction modes, both from the first partition.

use super::MbData;
use super::bit_reader::BitReader;
use crate::util::{Checked, SliceExt};
use crate::vp8::common::{
    IntraMode, MB_FEATURE_TREE_PROBS, NUM_BMODES, NUM_CTX, NUM_POSITIONS, NUM_PROBAS, NUM_TYPES,
};
use crate::vp8::tables::{BANDS, BMODES_PROBA, COEFFS_PROBA0, COEFFS_UPDATE_PROBA};

/// The probabilities of one band, by context.
type BandProbas = [[u8; NUM_PROBAS]; NUM_CTX];

/// The probabilities of one type of block, by the position of the coefficient rather than by its band.
pub(super) type TypeProbas = [BandProbas; NUM_POSITIONS];

pub(super) struct Proba {
    pub(super) coeffs: [TypeProbas; NUM_TYPES],
    /// The probability that a macroblock has no coefficients, if macroblocks say so at all.
    pub(super) skip_p: Option<u8>,
}

impl Proba {
    /// `VP8ParseProba`, paragraphs 13.4 and 9.11.
    pub(super) fn parse(br: &mut BitReader<'_>) -> Checked<Self> {
        let mut coeffs = [[[[0; NUM_PROBAS]; NUM_CTX]; NUM_POSITIONS]; NUM_TYPES];
        for ((by_position, defaults), updates) in coeffs
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
        Ok(Self { coeffs, skip_p })
    }
}

fn parse_mode4(br: &mut BitReader<'_>, prob: &[u8; NUM_BMODES - 1]) -> IntraMode {
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

/// `top` and `left`: the modes of the 4x4 blocks along the edges, replaced by those of the last row and column of `mb`.
pub(super) fn parse_intra_mode(
    br: &mut BitReader<'_>,
    tree_probs: Option<[u8; MB_FEATURE_TREE_PROBS]>,
    skip_p: Option<u8>,
    top: &mut [IntraMode; 4],
    left: &mut [IntraMode; 4],
    mb: &mut MbData,
) -> Checked {
    mb.segment = match tree_probs {
        None => 0,
        Some([p0, p1, p2]) => {
            if !br.get_bit(p0) {
                u8::from(br.get_bit(p1))
            } else {
                u8::from(br.get_bit(p2)) + 2
            }
        }
    };
    mb.skip = skip_p.is_some_and(|p| br.get_bit(p));

    mb.is_i4x4 = !br.get_bit(145);
    if !mb.is_i4x4 {
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
        mb.imodes[0] = ymode;
        *top = [ymode; 4];
        *left = [ymode; 4];
    } else {
        for (modes, left) in mb.imodes.as_chunks_mut::<4>().0.iter_mut().zip(left) {
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
    mb.uvmode = if !br.get_bit(142) {
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
