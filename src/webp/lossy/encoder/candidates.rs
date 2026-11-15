//! Access to what the kernels make of a block with each prediction mode.

use bun_highway::webp::Candidates;

use super::border::{Border, joined};
use super::cost::LevelCosts;
use super::tokens::Residual;
use crate::array::At;
use crate::lossy::MacroblockMode;

pub(super) const MACROBLOCK_MODES: [MacroblockMode; 4] = {
    use MacroblockMode::*;
    [Dc, TrueMotion, Vertical, Horizontal]
};

#[inline(always)]
pub(super) fn residual<const PAIRS: usize>(
    block: &Candidates<PAIRS>,
    mode: usize,
    end: u8,
) -> Residual {
    let (pair, shift) = (mode / 2, 8 * (mode % 2));
    let rows = block.levels.each_ref().map(|it| *it.at(pair));
    let symbols = block.symbols.each_ref().map(|it| *it.at(pair));
    Residual {
        levels: core::array::from_fn(|i| (rows.at(i / 4).at(i % 4) >> (2 * shift)) as i16),
        symbols: core::array::from_fn(|i| (symbols.at(i / 8).at(i % 8) >> shift) as u8),
        end,
    }
}

/// The bottom row and the right column of the decoded block.
pub(super) fn edges<const PAIRS: usize>(block: &Candidates<PAIRS>, mode: usize) -> [u32; 2] {
    let edges = u64::from_le_bytes(*block.edges.at(mode / 2).at(mode % 2));
    [edges as u32, (edges >> 24) as u32]
}

pub(super) fn bottom(blocks: [&Candidates<2>; 4], mode: usize) -> Border {
    Some(joined(blocks.map(|it| edges(it, mode)[0])))
}

pub(super) fn right(blocks: [&Candidates<2>; 4], mode: usize) -> Border {
    Some(joined(blocks.map(|it| edges(it, mode)[1])))
}

/// Adds the cost of 8 blocks for each `MacroblockMode`.
#[inline(always)]
pub(super) fn add_costs(
    levels: &LevelCosts,
    first: usize,
    blocks: &[Candidates<2>; 8],
    [ends, more_ends]: &[[[u8; 2]; 8]; 2],
    costs: &mut [[i32; 2]; 2],
) {
    let mut common = 0;
    for (block, (&[a, b], &[c, d])) in blocks.iter().zip(ends.iter().zip(more_ends)) {
        let last_end = a.max(b).max(c.max(d));
        common += levels.add(first, block, 0, [[a, b], [c, d]], last_end, costs);
    }
    for cost in costs.as_flattened_mut() {
        *cost += common;
    }
}
