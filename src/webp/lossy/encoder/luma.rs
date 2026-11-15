//! Picks the prediction modes for the luma of a macroblock that get the least distortion for their rate.

use core::hint::select_unpredictable;

use bun_highway::webp::{
    self, Edges, IS_FLAT, LumaCandidates, LumaSaturation, Macroblock, Scratch, SubblockCandidates,
};

use super::border::{self, Border, joined};
use super::candidates::{MACROBLOCK_MODES, add_costs, bottom, edges, residual, right};
use super::cost::{
    FLATNESS_PENALTY, LUMA_MODE_COSTS, LevelCosts, MIN_DIAGONAL_MODE_COSTS, MIN_SUBBLOCK_MODE_COST,
    SUBBLOCK_MODE_COSTS, SUBBLOCK_MODES_COST, add_excess,
};
use super::segments::Coding;
use super::tokens::Residual;
use crate::array::At;
use crate::lossy::{BlockType, MacroblockMode, SUBBLOCK_MODES, SubblockMode};

#[derive(Clone, Copy)]
pub(super) enum Mode {
    Whole(MacroblockMode),
    Subblocks([[SubblockMode; 4]; 4]),
}

impl Mode {
    pub(super) fn bottom(self) -> [SubblockMode; 4] {
        match self {
            Self::Whole(mode) => [mode.into(); 4],
            Self::Subblocks([.., bottom]) => bottom,
        }
    }

    pub(super) fn right(self) -> [SubblockMode; 4] {
        match self {
            Self::Whole(mode) => [mode.into(); 4],
            Self::Subblocks(rows) => rows.map(|[.., right]| right),
        }
    }
}

/// What a macroblock leaves to the one below it, or to the one on its right.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Neighbor {
    pub(super) samples: Border,
    /// For the blocks along the border.
    modes: [SubblockMode; 4],
    non_zero: [bool; 4],
    /// Of the last macroblock in this direction that has such a block.
    y2_non_zero: bool,
}

impl Default for Neighbor {
    fn default() -> Self {
        Self {
            samples: None,
            modes: [SubblockMode::Dc; 4],
            non_zero: [false; 4],
            y2_non_zero: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Around {
    pub(super) above: Neighbor,
    pub(super) left: Neighbor,
    pub(super) above_left: Border,
    pub(super) above_right: Border,
}

pub(super) struct Choice {
    pub(super) mode: Mode,
    pub(super) mode_cost: i32,
    /// Only for `Mode::Whole`.
    pub(super) y2: Residual,
    pub(super) residuals: [Residual; 16],
    pub(super) bottom: Neighbor,
    pub(super) right: Neighbor,
    /// The biggest step between blocks that have nothing but a DC.
    pub(super) edge: u16,
}

impl Default for Choice {
    fn default() -> Self {
        Self {
            mode: Mode::Whole(MacroblockMode::Dc),
            mode_cost: 0,
            y2: Residual::default(),
            residuals: Default::default(),
            bottom: Neighbor::default(),
            right: Neighbor::default(),
            edge: 0,
        }
    }
}

pub(super) fn choose(
    samples: &Macroblock,
    around: &Around,
    coding: &Coding,
    costs: &[LevelCosts; 4],
    scratch: &mut Scratch,
    out: &mut Choice,
) {
    let (above, left) = (&around.above, &around.left);
    let edges = border::luma_edges(above.samples, left.samples, around.above_left);
    let saturation = webp::try_luma_modes(
        samples,
        &edges,
        [above.non_zero, left.non_zero],
        u8::from(above.y2_non_zero) + u8::from(left.y2_non_zero),
        [&coding.luma_without_dc, &coding.y2],
        &mut scratch.source,
        &mut scratch.luma,
    );
    let whole = &scratch.luma;
    let (mode, score) = best_whole(samples, coding, costs, whole, saturation, &mut out.edge);
    let costs = costs.at(BlockType::LumaWithDc as usize);
    if choose_subblocks(around, &edges, coding, costs, score, scratch, out) {
        out.bottom.y2_non_zero = above.y2_non_zero;
        out.right.y2_non_zero = left.y2_non_zero;
    } else {
        choose_whole(&scratch.luma, mode, out);
    }
    out.bottom.modes = out.mode.bottom();
    out.right.modes = out.mode.right();
    out.bottom.non_zero = [12, 13, 14, 15].map(|n| out.residuals.at(n).is_non_zero());
    out.right.non_zero = [3, 7, 11, 15].map(|n| out.residuals.at(n).is_non_zero());
}

/// The mode, and the score that subblocks have to beat.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L1008
fn best_whole(
    samples: &Macroblock,
    coding: &Coding,
    costs: &[LevelCosts; 4],
    candidates: &LumaCandidates,
    saturation: LumaSaturation,
    edge: &mut u16,
) -> (usize, i64) {
    let [ac_costs, y2_costs, ..] = costs;
    let [dc, true_motion, vertical, horizontal] = LUMA_MODE_COSTS.map(i32::from);
    let mut rates = [[dc, true_motion], [vertical, horizontal]];
    let y2_ends = candidates.y2_ends.map(|[it, ..]| it);
    y2_costs.add(0, &candidates.y2, 0, y2_ends, u8::MAX, &mut rates);
    for (blocks, ends) in candidates.blocks.as_chunks().0.iter().zip(&candidates.ends) {
        add_costs(ac_costs, 1, blocks, ends, &mut rates);
    }
    if saturation.y2 {
        add_excess(&candidates.y2, 0, &mut rates);
    }
    if saturation.blocks {
        for block in &candidates.blocks {
            add_excess(block, 0, &mut rates);
        }
    }
    let has_ac = |mode: usize| {
        let mut ends = candidates.ends.iter().flat_map(|it| it.at(mode / 2));
        ends.any(|it| *it.at(mode % 2) >= 4)
    };
    let mut is_flat = samples.luma == [[[samples.luma[0][0][0]; 4]; 4]; 16];
    let mut best = (i64::MAX, 0, 0, 0);
    for (mode, &rate) in rates.as_flattened().iter().enumerate() {
        is_flat = is_flat && !has_ac(mode);
        let factor = if is_flat { 2 } else { 1 };
        let error = i64::from(factor * candidates.squared_errors.at(mode));
        let texture = (coding.texture_lambda * candidates.texture_differences.at(mode) + 128) >> 8;
        let distortion = 256 * (error + i64::from(factor * texture));
        let score = |lambda| i64::from(rate) * lambda + distortion;
        if score(coding.luma_lambda) < best.0 {
            best = (
                score(coding.luma_lambda),
                mode,
                score(coding.mode_lambda),
                error,
            );
        }
    }
    let (_, mode, score, error) = best;
    *edge = 0;
    if error > coding.min_distortion && !has_ac(mode) {
        let [_, a, _, _, b, c, ..] = residual(&candidates.y2, mode, 0)
            .levels
            .map(i16::unsigned_abs);
        *edge = a.max(b).max(c);
    }
    (mode, score)
}

fn choose_whole(candidates: &LumaCandidates, mode: usize, out: &mut Choice) {
    out.mode = Mode::Whole(*MACROBLOCK_MODES.at(mode));
    out.mode_cost = (*LUMA_MODE_COSTS.at(mode)).into();
    let y2_end = *candidates.y2_ends.at(mode / 2)[0].at(mode % 2);
    out.y2 = residual(&candidates.y2, mode, y2_end);
    let ends = candidates.ends.iter().flat_map(|it| it.at(mode / 2));
    for ((to, block), end) in out.residuals.iter_mut().zip(&candidates.blocks).zip(ends) {
        *to = residual(block, mode, *end.at(mode % 2));
    }
    let [_, _, _, b3, _, _, _, b7, _, _, _, b11, b12, b13, b14, b15] = &candidates.blocks;
    out.bottom.samples = bottom([b12, b13, b14, b15], mode);
    out.right.samples = right([b15, b11, b7, b3], mode);
    out.bottom.y2_non_zero = out.y2.is_non_zero();
    out.right.y2_non_zero = out.y2.is_non_zero();
}

#[derive(Clone, Copy)]
struct Scored {
    score: i32,
    /// The mode is in the lowest 4 bits.
    rate_and_mode: i32,
}

impl Scored {
    #[inline(always)]
    fn or_better(self, other: Self) -> Self {
        select_unpredictable(other.score < self.score, other, self)
    }
}

/// Among the modes in so many `PAIRS` from `first_pair` on.
#[inline(always)]
fn best_subblock_mode<const PAIRS: usize>(
    candidates: &SubblockCandidates,
    first_pair: usize,
    last_end: u8,
    mode_costs: &[u16; SUBBLOCK_MODES],
    costs: &LevelCosts,
    lambda: i32,
) -> Scored {
    let modes = |pair| [0, 1].map(|i| 2 * (first_pair + pair) + i);
    let ends = core::array::from_fn(|pair| modes(pair).map(|it| *candidates.ends.at(it)));
    let mut rates: [[i32; 2]; PAIRS] =
        core::array::from_fn(|pair| modes(pair).map(|it| (*mode_costs.at(it)).into()));
    let block = &candidates.block;
    let common = costs.add(0, block, first_pair, ends, last_end, &mut rates);
    if last_end == u8::MAX {
        add_excess(block, first_pair, &mut rates);
    }
    let scored = |mode: usize, rate: i32| Scored {
        score: rate * lambda + candidates.distortions.at(mode),
        rate_and_mode: 16 * rate + mode as i32,
    };
    let pairs: [Scored; PAIRS] = core::array::from_fn(|pair| {
        let ([even, odd], [even_rate, odd_rate]) = (modes(pair), *rates.at(pair));
        scored(even, even_rate).or_better(scored(odd, odd_rate))
    });
    let best = pairs.into_iter().fold(*pairs.at(0), Scored::or_better);
    Scored {
        score: best.score + common * lambda,
        rate_and_mode: best.rate_and_mode + 16 * common,
    }
}

/// Whether that is better than `score_to_beat`.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L1078
fn choose_subblocks(
    around: &Around,
    around_samples: &Edges,
    coding: &Coding,
    costs: &LevelCosts,
    score_to_beat: i64,
    Scratch {
        source, subblock, ..
    }: &mut Scratch,
    out: &mut Choice,
) -> bool {
    use SubblockMode::*;
    const MODES: [SubblockMode; SUBBLOCK_MODES] = [
        Dc,
        TrueMotion,
        Vertical,
        Horizontal,
        RightDown,
        VerticalRight,
        LeftDown,
        VerticalLeft,
        HorizontalDown,
        HorizontalUp,
    ];
    let (quantizer, lambda) = (&coding.luma, coding.subblock_lambda);
    // Both include the least that the remaining blocks are going to add.
    let mut modes_cost = 16 * MIN_SUBBLOCK_MODE_COST;
    let mut score = i64::from(SUBBLOCK_MODES_COST + modes_cost) * coding.mode_lambda;
    let is_better =
        |score, modes_cost| score < score_to_beat && modes_cost <= coding.max_subblock_modes_cost;

    let above_right = match around.above_right {
        Some([a, b, c, d, ..]) => [a, b, c, d],
        None => [around_samples.above[15]; 4],
    };
    let parts = around_samples.above.as_chunks::<4>().0;
    let mut above: [u32; 5] =
        core::array::from_fn(|x| u32::from_le_bytes(*parts.get(x).unwrap_or(&above_right)));
    let mut above_non_zero = around.above.non_zero;
    let mut first_corner = around_samples.above_left[0];
    let mut modes = [around.above.modes; 5];
    let mut right = [0; 4];
    for (y, row) in out.residuals.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let mut left = (u128::from_le_bytes(around_samples.left) >> (96 - 32 * y)) as u32;
        let mut left_mode = *around.left.modes.at(y);
        let mut left_non_zero = *around.left.non_zero.at(y);
        let mut corner = core::mem::replace(&mut first_corner, left as u8);
        for (x, out) in row.iter_mut().enumerate() {
            if !is_better(score, modes_cost) {
                return false;
            }
            let block = webp::Subblock {
                index: 4 * y + x,
                edge: u128::from(left)
                    | u128::from(corner) << 32
                    | u128::from(*above.at(x)) << 40
                    | u128::from(*above.at(x + 1)) << 72,
                context: u8::from(*above_non_zero.at(x)) + u8::from(left_non_zero),
            };
            let (above_mode, texture_lambda) = (*modes.at(y).at(x), coding.texture_lambda);
            let mode_costs = SUBBLOCK_MODE_COSTS
                .at(above_mode as usize)
                .at(left_mode as usize);
            let last = webp::try_straight_modes(block, source, quantizer, texture_lambda, subblock);
            let mut best = best_subblock_mode::<2>(subblock, 0, last, mode_costs, costs, lambda);
            // What is not flat costs more than the penalty for the signs alone.
            let lowest = MIN_DIAGONAL_MODE_COSTS
                .at(above_mode as usize)
                .at(left_mode as usize);
            if best.score > (i32::from(*lowest) + FLATNESS_PENALTY) * lambda {
                let last =
                    webp::try_diagonal_modes(block, source, quantizer, texture_lambda, subblock);
                let other = best_subblock_mode::<3>(subblock, 2, last, mode_costs, costs, lambda);
                best = best.or_better(other);
            }

            let (mode, rate) = (best.rate_and_mode as usize % 16, best.rate_and_mode >> 4);
            score += i64::from(best.score - rate * lambda);
            score += i64::from(rate - MIN_SUBBLOCK_MODE_COST) * coding.mode_lambda;
            modes_cost += i32::from(*mode_costs.at(mode)) - MIN_SUBBLOCK_MODE_COST;
            *out = residual(&subblock.block, mode, subblock.ends.at(mode) & !IS_FLAT);
            corner = (above.at(x) >> 24) as u8;
            [*above.at_mut(x), left] = edges(&subblock.block, mode);
            left_mode = *MODES.at(mode);
            *modes.at_mut(y + 1).at_mut(x) = left_mode;
            left_non_zero = out.is_non_zero();
            *above_non_zero.at_mut(x) = left_non_zero;
        }
        *right.at_mut(3 - y) = left;
    }
    let ([bottom @ .., _], [_, modes @ ..]) = (above, modes);
    out.mode = Mode::Subblocks(modes);
    out.mode_cost = modes_cost + SUBBLOCK_MODES_COST;
    out.bottom.samples = Some(joined(bottom));
    out.right.samples = Some(joined(right));
    is_better(score, modes_cost)
}
