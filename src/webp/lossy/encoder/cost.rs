//! What things cost to store, in 256ths of a bit.

use bun_highway::webp::{Candidates, IS_FLAT, MAX_SYMBOL};

use crate::array::At;
use crate::error::Result;
use crate::lossy::tables::{
    BANDS, CATEGORY_3_TO_6, DEFAULT_COEFFICIENT_PROBABILITIES, SUBBLOCK_MODE_PROBABILITIES,
};
use crate::lossy::{BlockType, CoefficientProbabilities, SUBBLOCK_MODES};
use crate::vec;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/cost.c#L25
static ENTROPY_COSTS: [u16; 256] = [
    1792, 1792, 1792, 1536, 1536, 1408, 1366, 1280, 1280, 1216, 1178, 1152, 1110, 1076, 1061, 1024,
    1024, 992, 968, 951, 939, 911, 896, 878, 871, 854, 838, 820, 811, 794, 786, 768, 768, 752, 740,
    732, 720, 709, 704, 690, 683, 672, 666, 655, 647, 640, 631, 622, 615, 607, 598, 592, 586, 576,
    572, 564, 559, 555, 547, 541, 534, 528, 522, 512, 512, 504, 500, 494, 488, 483, 477, 473, 467,
    461, 458, 452, 448, 443, 438, 434, 427, 424, 419, 415, 410, 406, 403, 399, 394, 390, 384, 384,
    377, 374, 370, 366, 362, 359, 355, 351, 347, 342, 342, 336, 333, 330, 326, 323, 320, 316, 312,
    308, 305, 302, 299, 296, 293, 288, 287, 283, 280, 277, 274, 272, 268, 266, 262, 256, 256, 256,
    251, 248, 245, 242, 240, 237, 234, 232, 228, 226, 223, 221, 218, 216, 214, 211, 208, 205, 203,
    201, 198, 196, 192, 191, 188, 187, 183, 181, 179, 176, 175, 171, 171, 168, 165, 163, 160, 159,
    156, 154, 152, 150, 148, 146, 144, 142, 139, 138, 135, 133, 131, 128, 128, 125, 123, 121, 119,
    117, 115, 113, 111, 110, 107, 105, 103, 102, 100, 98, 96, 94, 92, 91, 89, 86, 86, 83, 82, 80,
    77, 76, 74, 73, 71, 69, 67, 66, 64, 63, 61, 59, 57, 55, 54, 52, 51, 49, 47, 46, 44, 43, 41, 40,
    38, 36, 35, 33, 32, 30, 29, 27, 25, 24, 22, 21, 19, 18, 16, 15, 13, 12, 10, 9, 7, 6, 4, 3,
];

#[expect(clippy::indexing_slicing, reason = "there is an entry for each u8")]
pub(super) const fn bit_cost(bit: bool, probability: u8) -> u16 {
    ENTROPY_COSTS[if bit { 255 - probability } else { probability } as usize]
}

/// By `MacroblockMode`.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/cost_enc.c#L103
pub(super) const CHROMA_MODE_COSTS: [u16; 4] = [302, 984, 439, 642];
pub(super) const LUMA_MODE_COSTS: [u16; 4] = [663, 919, 872, 919];
/// Of saying that there is a mode for each subblock.
pub(super) const SUBBLOCK_MODES_COST: i32 = bit_cost(false, 145) as i32;

/// By the modes above and to the left, and the mode.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
pub(super) static SUBBLOCK_MODE_COSTS: [[[u16; SUBBLOCK_MODES]; SUBBLOCK_MODES]; SUBBLOCK_MODES] = {
    let mut costs = [[[0; SUBBLOCK_MODES]; SUBBLOCK_MODES]; SUBBLOCK_MODES];
    let mut i = 0;
    while i < SUBBLOCK_MODES * SUBBLOCK_MODES {
        let (above, left) = (i / SUBBLOCK_MODES, i % SUBBLOCK_MODES);
        let [p0, p1, p2, p3, p4, p5, p6, p7, p8] = SUBBLOCK_MODE_PROBABILITIES[above][left];
        let not_dc = bit_cost(true, p0);
        let not_true_motion = not_dc + bit_cost(true, p1);
        let not_vertical = not_true_motion + bit_cost(true, p2);
        let first = not_vertical + bit_cost(false, p3);
        let not_horizontal = first + bit_cost(true, p4);
        let second = not_vertical + bit_cost(true, p3);
        let not_left_down = second + bit_cost(true, p6);
        let not_vertical_left = not_left_down + bit_cost(true, p7);
        costs[above][left] = [
            bit_cost(false, p0),
            not_dc + bit_cost(false, p1),
            not_true_motion + bit_cost(false, p2),
            first + bit_cost(false, p4),
            not_horizontal + bit_cost(false, p5),
            not_horizontal + bit_cost(true, p5),
            second + bit_cost(false, p6),
            not_left_down + bit_cost(false, p7),
            not_vertical_left + bit_cost(false, p8),
            not_vertical_left + bit_cost(true, p8),
        ];
        i += 1;
    }
    costs
};

/// The lowest of `SUBBLOCK_MODE_COSTS`.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
pub(super) const MIN_SUBBLOCK_MODE_COST: i32 = {
    let costs = SUBBLOCK_MODE_COSTS.as_flattened().as_flattened();
    let (mut min, mut i) = (u16::MAX, 0);
    while i < costs.len() {
        min = if costs[i] < min { costs[i] } else { min };
        i += 1;
    }
    min as i32
};

/// The lowest of `SUBBLOCK_MODE_COSTS` from the fifth mode on.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
pub(super) static MIN_DIAGONAL_MODE_COSTS: [[u16; SUBBLOCK_MODES]; SUBBLOCK_MODES] = {
    const N: usize = SUBBLOCK_MODES;
    let mut lowest = [[u16::MAX; N]; N];
    let mut i = 0;
    while i < N * N * N {
        let (above, left, mode) = (i / N / N, i / N % N, i % N);
        let cost = SUBBLOCK_MODE_COSTS[above][left][mode];
        if mode >= 4 && cost < lowest[above][left] {
            lowest[above][left] = cost;
        }
        i += 1;
    }
    lowest
};

/// Of the sign and the extra bits of each level, whose probabilities are fixed.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static FIXED_LEVEL_COSTS: [u16; 2048] = {
    let mut costs = [0; 2048];
    let mut level = 1;
    while level < costs.len() {
        costs[level] = 256
            + match level {
                ..=4 => 0,
                5 | 6 => bit_cost(level == 6, 159),
                7 | 8 => bit_cost(false, 165) + bit_cost(level == 8, 145),
                // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/cost.c#L61
                9 | 10 => 384,
                _ => {
                    let category = (level - 3).ilog2() as usize - 3;
                    let category = if category < 3 { category } else { 3 };
                    let extra = level - 3 - (8 << category);
                    let probabilities = CATEGORY_3_TO_6[category];
                    let (mut cost, mut i) = (0, 0);
                    while i < probabilities.len() {
                        let bit = (extra >> (probabilities.len() - 1 - i)) & 1;
                        cost += bit_cost(bit != 0, probabilities[i]);
                        i += 1;
                    }
                    cost
                }
            };
        level += 1;
    }
    costs
};

/// How many symbols there are for each context.
pub(super) const LEVELS: usize = MAX_SYMBOL as usize + 1;
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L43
pub(super) const FLATNESS_PENALTY: i32 = 140;

/// Of the levels of one `BlockType`.
pub(super) struct LevelCosts {
    /// By band and symbol.
    symbols: [[i32; 256]; 8],
    /// Of the end of a block, less what `symbols` has for the zeros from there on.
    ends: [i32; 256],
    /// Of zeros from positions 4, 8 and 12 on.
    zeros: [i32; 3],
}

impl Default for LevelCosts {
    fn default() -> Self {
        Self {
            symbols: [[0; 256]; 8],
            ends: [0; 256],
            zeros: [0; 3],
        }
    }
}

impl LevelCosts {
    /// `adapted` are the probabilities for everything but the first and the last decision about the end.
    fn update(&mut self, first: usize, adapted: &[[[u8; 11]; 3]; 8], current: &[[[u8; 11]; 3]; 8]) {
        let bands = self.symbols.iter_mut().zip(adapted).zip(current);
        for (band, ((symbols, adapted), current)) in bands.enumerate() {
            let contexts = symbols.as_chunks_mut().0.iter_mut().zip(adapted);
            for (context, (levels, adapted)) in contexts.enumerate() {
                let not_end = match context {
                    0 if band == first => bit_cost(true, current[0][0]),
                    // Behind a zero a block does not end.
                    0 => 0,
                    _ => bit_cost(true, adapted[0]),
                };
                fill_level_costs(levels, not_end, adapted);
            }
        }
        let mut zeros = 0;
        let (ends, flat_ends) = self.ends.split_at_mut(IS_FLAT.into());
        for (position, ends) in ends
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .enumerate()
            .take(16)
            .rev()
        {
            // A block without levels ends at its first position.
            let band = usize::from(*BANDS.at(position.max(first)));
            let symbols = self.symbols.at(band);
            let contexts = symbols.as_chunks::<LEVELS>().0.iter().zip(current.at(band));
            for (end, ([zero, ..], &[probability, ..])) in ends.iter_mut().zip(contexts) {
                *end = i32::from(bit_cost(false, probability)) - zero - zeros;
            }
            if position > first {
                zeros += symbols[0];
            }
            if position % 4 == 0 && position != 0 {
                *self.zeros.at_mut(position / 4 - 1) = zeros;
            }
        }
        for (flat, end) in flat_ends.iter_mut().zip(ends) {
            *flat = *end + FLATNESS_PENALTY;
        }
    }

    #[inline(always)]
    fn add_symbols<const PAIRS: usize, const USED: usize>(
        &self,
        start: usize,
        end: usize,
        candidates: &Candidates<PAIRS>,
        first_pair: usize,
        costs: &mut [[i32; 2]; USED],
    ) {
        for (pair, [even, odd]) in costs.iter_mut().enumerate() {
            for position in start..end {
                let band = self.symbols.at((*BANDS.at(position)).into());
                let symbols = candidates
                    .symbols
                    .at(position / 8)
                    .at(first_pair + pair)
                    .at(position % 8);
                let [low, high] = symbols.to_le_bytes();
                *even += band.at(low.into());
                *odd += band.at(high.into());
            }
        }
    }

    /// Adds what is not the same for all the candidates to `costs`, and returns the rest.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/cost.c#L329
    #[inline(always)]
    pub(super) fn add<const PAIRS: usize, const USED: usize>(
        &self,
        first: usize,
        candidates: &Candidates<PAIRS>,
        first_pair: usize,
        ends: [[u8; 2]; USED],
        last_end: u8,
        costs: &mut [[i32; 2]; USED],
    ) -> i32 {
        for (cost, &end) in costs.as_flattened_mut().iter_mut().zip(ends.as_flattened()) {
            *cost += self.ends.at(end.into());
        }
        self.add_symbols(first, 4, candidates, first_pair, costs);
        if last_end < 4 * 4 {
            return self.zeros[0];
        }
        self.add_symbols(4, 8, candidates, first_pair, costs);
        if last_end < 4 * 8 {
            return self.zeros[1];
        }
        self.add_symbols(8, 12, candidates, first_pair, costs);
        if last_end < 4 * 12 {
            return self.zeros[2];
        }
        self.add_symbols(12, 16, candidates, first_pair, costs);
        0
    }
}

/// Adds what the levels cost more than their symbols say.
#[cold]
pub(super) fn add_excess<const PAIRS: usize, const USED: usize>(
    candidates: &Candidates<PAIRS>,
    first_pair: usize,
    costs: &mut [[i32; 2]; USED],
) {
    let excess = |level: u32| {
        let magnitude = usize::from((level as i16).unsigned_abs()).max(LEVELS - 1);
        i32::from(*FIXED_LEVEL_COSTS.at(magnitude)) - i32::from(FIXED_LEVEL_COSTS[LEVELS - 1])
    };
    for row in &candidates.levels {
        for ([even, odd], levels) in costs.iter_mut().zip(row.iter().skip(first_pair)) {
            // From -64 to 63 the highest 10 bits are the same.
            if levels.iter().fold(0, |any, it| any | it ^ it << 1) & 0xff80_ff80 != 0 {
                for &levels in levels {
                    *even += excess(levels);
                    *odd += excess(levels >> 16);
                }
            }
        }
    }
}

pub(super) struct Costs {
    /// By `BlockType`.
    pub(super) levels: Box<[LevelCosts; 4]>,
    /// The last probabilities that were not the default ones.
    adapted: CoefficientProbabilities,
}

impl Costs {
    pub(super) fn new() -> Result<Self> {
        let mut costs = Self {
            levels: vec::default_array()?,
            adapted: DEFAULT_COEFFICIENT_PROBABILITIES,
        };
        costs.update(&DEFAULT_COEFFICIENT_PROBABILITIES);
        Ok(costs)
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/cost_enc.c#L66
    pub(super) fn update(&mut self, current: &CoefficientProbabilities) {
        if *current != DEFAULT_COEFFICIENT_PROBABILITIES {
            self.adapted = *current;
        }
        let types = self.levels.iter_mut().zip(&self.adapted).zip(current);
        for (block_type, ((costs, adapted), current)) in types.enumerate() {
            let first = usize::from(block_type == BlockType::LumaWithoutDc as usize);
            costs.update(first, adapted, current);
        }
    }
}

fn fill_level_costs(costs: &mut [i32; LEVELS], not_end: u16, probabilities: &[u8; 11]) {
    let [_, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10] = *probabilities;
    let not_zero = not_end + bit_cost(true, p1);
    let not_one = not_zero + bit_cost(true, p2);
    let to_four = not_one + bit_cost(false, p3);
    let three_or_four = to_four + bit_cost(true, p4);
    let from_five = not_one + bit_cost(true, p3);
    let to_ten = from_five + bit_cost(false, p6);
    let from_eleven = from_five + bit_cost(true, p6);
    let to_34 = from_eleven + bit_cost(false, p8);
    let from_35 = from_eleven + bit_cost(true, p8);
    let runs = [
        (1, not_end + bit_cost(false, p1)),
        (1, not_zero + bit_cost(false, p2)),
        (1, to_four + bit_cost(false, p4)),
        (1, three_or_four + bit_cost(false, p5)),
        (1, three_or_four + bit_cost(true, p5)),
        (2, to_ten + bit_cost(false, p7)),
        (4, to_ten + bit_cost(true, p7)),
        (8, to_34 + bit_cost(false, p9)),
        (16, to_34 + bit_cost(true, p9)),
        (32, from_35 + bit_cost(false, p10)),
        (1, from_35 + bit_cost(true, p10)),
    ];
    let mut levels = costs.iter_mut().zip(&FIXED_LEVEL_COSTS);
    for (len, variable) in runs {
        for (cost, fixed) in levels.by_ref().take(len) {
            *cost = (fixed + variable).into();
        }
    }
}
