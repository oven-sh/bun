//! Picks the prediction mode for the chroma of a macroblock that gets the least distortion for its rate.

use bun_highway::webp::{self, ChromaCandidates, Macroblock};

use super::border::{self, Border};
use super::candidates::{MACROBLOCK_MODES, add_costs, bottom, residual, right};
use super::cost::{CHROMA_MODE_COSTS, FLATNESS_PENALTY, LevelCosts, add_excess};
use super::segments::Coding;
use super::tokens::Residual;
use crate::array::At;
use crate::lossy::{BlockType, MacroblockMode};

/// What a macroblock leaves to the one below it, or to the one on its right.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Neighbor {
    pub(super) samples: Border,
    /// For the blocks along the border.
    non_zero: [bool; 4],
    /// Of quantizing their DC, in the order that `try_chroma_modes()` takes.
    errors: [i16; 8],
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Around {
    pub(super) above: Neighbor,
    pub(super) left: Neighbor,
    pub(super) above_left: Border,
}

pub(super) struct Choice {
    pub(super) mode: MacroblockMode,
    pub(super) mode_cost: i32,
    pub(super) residuals: [Residual; 8],
    pub(super) bottom: Neighbor,
    pub(super) right: Neighbor,
}

impl Default for Choice {
    fn default() -> Self {
        Self {
            mode: MacroblockMode::Dc,
            mode_cost: 0,
            residuals: Default::default(),
            bottom: Neighbor::default(),
            right: Neighbor::default(),
        }
    }
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L1175
pub(super) fn choose(
    samples: &Macroblock,
    Around {
        above,
        left,
        above_left,
    }: &Around,
    coding: &Coding,
    costs: &[LevelCosts; 4],
    candidates: &mut ChromaCandidates,
    out: &mut Choice,
) {
    let errors = [above.errors, left.errors];
    let is_saturated = webp::try_chroma_modes(
        samples,
        &border::chroma_edges(above.samples, left.samples, *above_left),
        [above.non_zero, left.non_zero],
        &coding.chroma,
        coding.diffuses_errors.then_some(&errors),
        candidates,
    );
    let (blocks, ends) = (&candidates.blocks, &candidates.ends);
    let [dc, true_motion, vertical, horizontal] = CHROMA_MODE_COSTS.map(i32::from);
    let mut rates = [[dc, true_motion], [vertical, horizontal]];
    add_costs(
        costs.at(BlockType::Chroma as usize),
        0,
        blocks,
        ends,
        &mut rates,
    );
    if is_saturated {
        for block in blocks {
            add_excess(block, 0, &mut rates);
        }
    }
    let scores = rates
        .as_flattened()
        .iter()
        .enumerate()
        .map(|(mode, &rate)| {
            let is_flat = mode != 0 && *candidates.ac_counts.at(mode / 2)[0].at(mode % 2) <= 2;
            let rate = rate + if is_flat { 8 * FLATNESS_PENALTY } else { 0 };
            let distortion = 256 * i64::from(*candidates.squared_errors.at(mode));
            (i64::from(rate) * coding.chroma_lambda + distortion, mode)
        });
    let (_, mode) = scores.min().unwrap_or_default();

    out.mode = *MACROBLOCK_MODES.at(mode);
    out.mode_cost = (*CHROMA_MODE_COSTS.at(mode)).into();
    for ((to, block), end) in out.residuals.iter_mut().zip(blocks).zip(ends.at(mode / 2)) {
        *to = residual(block, mode, *end.at(mode % 2));
    }
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L915
    let errors = candidates.dc_errors.map(|it| *it.at(mode / 2));
    let [[upper_right, lower_left], [lower_right, _]] =
        errors.map(|blocks| blocks.map(|planes| planes.map(|it| *it.at(mode % 2))));
    let to_right = lower_right.map(|it| (3 * it) >> 2);
    let to_below = [lower_right[0] - to_right[0], lower_right[1] - to_right[1]];
    let twice = |[a, b]: [i16; 2], [c, d]: [i16; 2]| [a, a, b, b, c, c, d, d];
    let [_, u1, u2, u3, _, v1, v2, v3] = blocks;
    out.bottom = Neighbor {
        samples: bottom([u2, u3, v2, v3], mode),
        non_zero: [2, 3, 6, 7].map(|n| out.residuals.at(n).is_non_zero()),
        errors: twice(lower_left, to_below),
    };
    out.right = Neighbor {
        samples: right([u3, u1, v3, v1], mode),
        non_zero: [1, 3, 5, 7].map(|n| out.residuals.at(n).is_non_zero()),
        errors: twice(upper_right, to_right),
    };
}
