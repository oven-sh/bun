//! The near-optimal parser, levels 10 to 12: the cheapest path through all of a block's matches, for symbol costs refined over several passes.

use crate::bt_matchfinder::{self, BtMatchfinder, LzMatch};
use crate::compress::{
    Common, Items, LENGTH_SLOT, Lens, MAX_BLOCK_LENGTH, MIN_BLOCK_LENGTH, NUM_OBSERVATION_TYPES,
    OutputBitstream, SOFT_MAX_BLOCK_LENGTH, Sequence, adjust_max_and_nice_len, at,
    calculate_min_match_len, choose_max_block_end, choose_min_match_len, new_vec,
};
use crate::constants::*;
use crate::matchfinder::WINDOW_SIZE;

/// Costs are in sixteenths of a bit.
const BIT_COST: u32 = 16;

/// The bits assumed for a symbol that the previous pass did not use.
const LITERAL_NOSTAT_BITS: u32 = 13;
const LENGTH_NOSTAT_BITS: u32 = 13;
const OFFSET_NOSTAT_BITS: u32 = 10;

/// A block ends when about this many matches have been found in it.
const MATCH_CACHE_LENGTH: usize = SOFT_MAX_BLOCK_LENGTH * 5;

/// No two matches at a position have the same length.
const MAX_MATCHES_PER_POS: usize = (MAX_MATCH_LEN - MIN_MATCH_LEN + 1) as usize;

const _: () = assert!(MIN_BLOCK_LENGTH * MAX_MATCHES_PER_POS <= MATCH_CACHE_LENGTH);

const NUM_OFFSET_SLOTS: usize = OFFSET_SLOT_BASE.len();
const NUM_LENGTHS: usize = MAX_MATCH_LEN as usize + 1;

#[derive(Clone)]
struct Costs {
    literal: [u32; NUM_LITERALS],
    length: [u32; NUM_LENGTHS],
    offset_slot: [u32; NUM_OFFSET_SLOTS],
}

/// A position in the block.
#[derive(Clone, Copy, Default)]
pub(crate) struct OptimumNode {
    /// The least cost of getting from here to the end of the block.
    cost_to_end: u32,
    /// The first step of that way: its length in the low nine bits, above them the offset, or the literal if the length is 1.
    pub(crate) item: u32,
}

pub(crate) const OPTIMUM_OFFSET_SHIFT: u32 = 9;
pub(crate) const OPTIMUM_LEN_MASK: u32 = (1 << OPTIMUM_OFFSET_SHIFT) - 1;

struct DefaultLitlenCosts {
    /// `int(-log2((1 - match_prob) / num_used_literals) * BIT_COST)`
    used_lits_to_lit_cost: [u8; 257],
    /// `int(-log2(match_prob / 29) * BIT_COST)`
    len_sym_cost: u8,
}

/// For a match probability of 0.25, 0.5 and 0.75.
static DEFAULT_LITLEN_COSTS: [DefaultLitlenCosts; 3] = [
    DefaultLitlenCosts {
        used_lits_to_lit_cost: [
            6, 6, 22, 32, 38, 43, 48, 51, 54, 57, 59, 61, 64, 65, 67, 69, 70, 72, 73, 74, 75, 76,
            77, 79, 80, 80, 81, 82, 83, 84, 85, 85, 86, 87, 88, 88, 89, 89, 90, 91, 91, 92, 92, 93,
            93, 94, 95, 95, 96, 96, 96, 97, 97, 98, 98, 99, 99, 99, 100, 100, 101, 101, 101, 102,
            102, 102, 103, 103, 104, 104, 104, 105, 105, 105, 105, 106, 106, 106, 107, 107, 107,
            108, 108, 108, 108, 109, 109, 109, 109, 110, 110, 110, 111, 111, 111, 111, 112, 112,
            112, 112, 112, 113, 113, 113, 113, 114, 114, 114, 114, 114, 115, 115, 115, 115, 115,
            116, 116, 116, 116, 116, 117, 117, 117, 117, 117, 118, 118, 118, 118, 118, 118, 119,
            119, 119, 119, 119, 120, 120, 120, 120, 120, 120, 121, 121, 121, 121, 121, 121, 121,
            122, 122, 122, 122, 122, 122, 123, 123, 123, 123, 123, 123, 123, 124, 124, 124, 124,
            124, 124, 124, 125, 125, 125, 125, 125, 125, 125, 125, 126, 126, 126, 126, 126, 126,
            126, 127, 127, 127, 127, 127, 127, 127, 127, 128, 128, 128, 128, 128, 128, 128, 128,
            128, 129, 129, 129, 129, 129, 129, 129, 129, 129, 130, 130, 130, 130, 130, 130, 130,
            130, 130, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 132, 132, 132, 132, 132,
            132, 132, 132, 132, 132, 133, 133, 133, 133, 133, 133, 133, 133, 133, 133, 134, 134,
            134, 134, 134, 134, 134, 134,
        ],
        len_sym_cost: 109,
    },
    DefaultLitlenCosts {
        used_lits_to_lit_cost: [
            16, 16, 32, 41, 48, 53, 57, 60, 64, 66, 69, 71, 73, 75, 76, 78, 80, 81, 82, 83, 85, 86,
            87, 88, 89, 90, 91, 92, 92, 93, 94, 95, 96, 96, 97, 98, 98, 99, 99, 100, 101, 101, 102,
            102, 103, 103, 104, 104, 105, 105, 106, 106, 107, 107, 108, 108, 108, 109, 109, 110,
            110, 110, 111, 111, 112, 112, 112, 113, 113, 113, 114, 114, 114, 115, 115, 115, 115,
            116, 116, 116, 117, 117, 117, 118, 118, 118, 118, 119, 119, 119, 119, 120, 120, 120,
            120, 121, 121, 121, 121, 122, 122, 122, 122, 122, 123, 123, 123, 123, 124, 124, 124,
            124, 124, 125, 125, 125, 125, 125, 126, 126, 126, 126, 126, 127, 127, 127, 127, 127,
            128, 128, 128, 128, 128, 128, 129, 129, 129, 129, 129, 129, 130, 130, 130, 130, 130,
            130, 131, 131, 131, 131, 131, 131, 131, 132, 132, 132, 132, 132, 132, 133, 133, 133,
            133, 133, 133, 133, 134, 134, 134, 134, 134, 134, 134, 134, 135, 135, 135, 135, 135,
            135, 135, 135, 136, 136, 136, 136, 136, 136, 136, 136, 137, 137, 137, 137, 137, 137,
            137, 137, 138, 138, 138, 138, 138, 138, 138, 138, 138, 139, 139, 139, 139, 139, 139,
            139, 139, 139, 140, 140, 140, 140, 140, 140, 140, 140, 140, 141, 141, 141, 141, 141,
            141, 141, 141, 141, 141, 142, 142, 142, 142, 142, 142, 142, 142, 142, 142, 142, 143,
            143, 143, 143, 143, 143, 143, 143, 143, 143, 144,
        ],
        len_sym_cost: 93,
    },
    DefaultLitlenCosts {
        used_lits_to_lit_cost: [
            32, 32, 48, 57, 64, 69, 73, 76, 80, 82, 85, 87, 89, 91, 92, 94, 96, 97, 98, 99, 101,
            102, 103, 104, 105, 106, 107, 108, 108, 109, 110, 111, 112, 112, 113, 114, 114, 115,
            115, 116, 117, 117, 118, 118, 119, 119, 120, 120, 121, 121, 122, 122, 123, 123, 124,
            124, 124, 125, 125, 126, 126, 126, 127, 127, 128, 128, 128, 129, 129, 129, 130, 130,
            130, 131, 131, 131, 131, 132, 132, 132, 133, 133, 133, 134, 134, 134, 134, 135, 135,
            135, 135, 136, 136, 136, 136, 137, 137, 137, 137, 138, 138, 138, 138, 138, 139, 139,
            139, 139, 140, 140, 140, 140, 140, 141, 141, 141, 141, 141, 142, 142, 142, 142, 142,
            143, 143, 143, 143, 143, 144, 144, 144, 144, 144, 144, 145, 145, 145, 145, 145, 145,
            146, 146, 146, 146, 146, 146, 147, 147, 147, 147, 147, 147, 147, 148, 148, 148, 148,
            148, 148, 149, 149, 149, 149, 149, 149, 149, 150, 150, 150, 150, 150, 150, 150, 150,
            151, 151, 151, 151, 151, 151, 151, 151, 152, 152, 152, 152, 152, 152, 152, 152, 153,
            153, 153, 153, 153, 153, 153, 153, 154, 154, 154, 154, 154, 154, 154, 154, 154, 155,
            155, 155, 155, 155, 155, 155, 155, 155, 156, 156, 156, 156, 156, 156, 156, 156, 156,
            157, 157, 157, 157, 157, 157, 157, 157, 157, 157, 158, 158, 158, 158, 158, 158, 158,
            158, 158, 158, 158, 159, 159, 159, 159, 159, 159, 159, 159, 159, 159, 160,
        ],
        len_sym_cost: 84,
    },
];

fn default_length_cost(len: usize, len_sym_cost: u32) -> Option<u32> {
    let slot = usize::from(at(&LENGTH_SLOT, len)?);
    Some(len_sym_cost + u32::from(at(&EXTRA_LENGTH_BITS, slot)?) * BIT_COST)
}

fn default_offset_slot_cost(slot: usize) -> Option<u32> {
    // All 30 offset symbols taken as equally likely: `int(-log2(1 / 30) * BIT_COST)`.
    let offset_sym_cost = 4 * BIT_COST + (907 * BIT_COST) / 1000;
    Some(offset_sym_cost + u32::from(at(&EXTRA_OFFSET_BITS, slot)?) * BIT_COST)
}

/// Moves a cost towards its default, further the more the block differs from the previous one.
#[inline(always)]
fn adjust_cost(cost: &mut u32, default_cost: u32, change_amount: u32) {
    *cost = match change_amount {
        0 => (default_cost + 3 * *cost) / 4,
        1 => (default_cost + *cost) / 2,
        2 => (5 * default_cost + 3 * *cost) / 8,
        _ => (3 * default_cost + *cost) / 4,
    };
}

impl Costs {
    fn set_from_codes(&mut self, lens: &Lens) -> Option<()> {
        let or = |bits: u32, nostat_bits: u32| if bits != 0 { bits } else { nostat_bits };
        for (sym, cost) in self.literal.iter_mut().enumerate() {
            *cost = or(lens.litlen(sym)?, LITERAL_NOSTAT_BITS) * BIT_COST;
        }
        for (len, cost) in self
            .length
            .iter_mut()
            .enumerate()
            .skip(MIN_MATCH_LEN as usize)
        {
            let slot = usize::from(at(&LENGTH_SLOT, len)?);
            let bits = or(lens.litlen(FIRST_LEN_SYM + slot)?, LENGTH_NOSTAT_BITS);
            *cost = (bits + u32::from(at(&EXTRA_LENGTH_BITS, slot)?)) * BIT_COST;
        }
        for (slot, cost) in self.offset_slot.iter_mut().enumerate() {
            let bits = or(lens.offset(slot)?, OFFSET_NOSTAT_BITS);
            *cost = (bits + u32::from(at(&EXTRA_OFFSET_BITS, slot)?)) * BIT_COST;
        }
        Some(())
    }

    fn set_default(&mut self, lit_cost: u32, len_sym_cost: u32) -> Option<()> {
        self.literal.fill(lit_cost);
        for (len, cost) in self
            .length
            .iter_mut()
            .enumerate()
            .skip(MIN_MATCH_LEN as usize)
        {
            *cost = default_length_cost(len, len_sym_cost)?;
        }
        for (slot, cost) in self.offset_slot.iter_mut().enumerate() {
            *cost = default_offset_slot_cost(slot)?;
        }
        Some(())
    }

    fn adjust(&mut self, lit_cost: u32, len_sym_cost: u32, change_amount: u32) -> Option<()> {
        for cost in &mut self.literal {
            adjust_cost(cost, lit_cost, change_amount);
        }
        for (len, cost) in self
            .length
            .iter_mut()
            .enumerate()
            .skip(MIN_MATCH_LEN as usize)
        {
            adjust_cost(cost, default_length_cost(len, len_sym_cost)?, change_amount);
        }
        for (slot, cost) in self.offset_slot.iter_mut().enumerate() {
            adjust_cost(cost, default_offset_slot_cost(slot)?, change_amount);
        }
        Some(())
    }
}

pub(crate) struct NearOptimal {
    bt_mf: BtMatchfinder,
    /// For each position of the block its matches, shortest first, then an entry with their number as `length` and the literal as `offset`.
    match_cache: Vec<LzMatch>,
    optimum_nodes: Vec<OptimumNode>,
    costs: Costs,
    costs_saved: Costs,
    offset_slot_full: Box<[u8; MAX_MATCH_OFFSET + 1]>,
    prev_observations: [u32; NUM_OBSERVATION_TYPES],
    prev_num_observations: u32,
    /// How often a greedy parse would use each match length, for the first costs of a block.
    new_match_len_freqs: [u32; NUM_LENGTHS],
    match_len_freqs: [u32; NUM_LENGTHS],
    max_optim_passes: u32,
    /// A pass that saves fewer bits than this is the last.
    min_improvement_to_continue: u32,
    /// An earlier pass has to have been better than the last by this many bits for its path to be computed again.
    min_bits_to_use_nonfinal_path: u32,
    /// Up to this block length, the best path for the static codes is tried as well.
    max_len_to_optimize_static_block: u32,
}

impl NearOptimal {
    pub(crate) fn new(
        max_optim_passes: u32,
        min_improvement_to_continue: u32,
        min_bits_to_use_nonfinal_path: u32,
        max_len_to_optimize_static_block: u32,
    ) -> Option<Box<Self>> {
        let mut offset_slot_full = new_vec(MAX_MATCH_OFFSET + 1)?;
        offset_slot_full.push(0);
        for (slot, &extra_bits) in EXTRA_OFFSET_BITS.iter().enumerate() {
            offset_slot_full.resize(offset_slot_full.len() + (1 << extra_bits), slot as u8);
        }
        let costs = Costs {
            literal: [0; _],
            length: [0; _],
            offset_slot: [0; _],
        };
        // Past the point where a full cache is noticed there can be one position's matches, then a skipped match.
        let match_cache_len = MATCH_CACHE_LENGTH + MAX_MATCHES_PER_POS + MAX_MATCH_LEN as usize - 1;
        Some(Box::new(Self {
            bt_mf: BtMatchfinder::new()?,
            match_cache: new_vec(match_cache_len)?,
            optimum_nodes: new_vec(MAX_BLOCK_LENGTH + 1)?,
            costs: costs.clone(),
            costs_saved: costs,
            offset_slot_full: offset_slot_full.into_boxed_slice().try_into().ok()?,
            prev_observations: [0; _],
            prev_num_observations: 0,
            new_match_len_freqs: [0; _],
            match_len_freqs: [0; _],
            max_optim_passes,
            min_improvement_to_continue,
            min_bits_to_use_nonfinal_path,
            max_len_to_optimize_static_block,
        }))
    }

    /// Counts the symbols of the minimum-cost path into `common.freqs`.
    fn tally_item_list(&self, common: &mut Common, block_length: usize) -> Option<()> {
        let mut cur = 0;
        while cur != block_length {
            let item = self.optimum_nodes.get(cur)?.item;
            let length = (item & OPTIMUM_LEN_MASK) as usize;
            let offset = (item >> OPTIMUM_OFFSET_SHIFT) as usize;
            if length == 1 {
                *common.freqs.litlen.get_mut(offset)? += 1;
            } else {
                let length_slot = usize::from(at(&LENGTH_SLOT, length)?);
                *common.freqs.litlen.get_mut(FIRST_LEN_SYM + length_slot)? += 1;
                let offset_slot = at(self.offset_slot_full.as_slice(), offset)?;
                *common.freqs.offset.get_mut(usize::from(offset_slot))? += 1;
            }
            cur += length.max(1);
        }
        *common.freqs.litlen.get_mut(END_OF_BLOCK)? += 1;
        Some(())
    }

    fn choose_default_litlen_costs(&self, common: &mut Common, block: &[u8]) -> Option<(u32, u32)> {
        let mut literal_freq = block.len() as u32;
        let cutoff = literal_freq >> 11;

        let literal_freqs = common.freqs.litlen.first_chunk_mut::<NUM_LITERALS>()?;
        literal_freqs.fill(0);
        for &byte in block {
            *literal_freqs.get_mut(usize::from(byte))? += 1;
        }
        let num_used_literals = literal_freqs
            .iter()
            .filter(|&&freq| freq > cutoff)
            .count()
            .max(1);

        // A greedy parse's share of matches stands in for the unknown share in the best parse.
        let mut match_freq = 0u32;
        let min_len =
            choose_min_match_len(num_used_literals as u32, common.max_search_depth) as usize;
        for (len, &freq) in self.match_len_freqs.iter().enumerate().skip(min_len) {
            match_freq = match_freq.wrapping_add(freq);
            literal_freq = literal_freq.wrapping_sub((len as u32).wrapping_mul(freq));
        }
        if (literal_freq as i32) < 0 {
            literal_freq = 0;
        }

        let costs = if match_freq > literal_freq {
            &DEFAULT_LITLEN_COSTS[2]
        } else if match_freq.wrapping_mul(4) > literal_freq {
            &DEFAULT_LITLEN_COSTS[1]
        } else {
            &DEFAULT_LITLEN_COSTS[0]
        };
        let lit_cost = at(&costs.used_lits_to_lit_cost, num_used_literals)?;
        Some((u32::from(lit_cost), u32::from(costs.len_sym_cost)))
    }

    /// Mixes the costs left by the previous block with the defaults, by how much the two blocks differ.
    fn adjust_costs(&mut self, common: &Common, lit_cost: u32, len_sym_cost: u32) -> Option<()> {
        let stats = &common.split_stats;
        let mut total_delta = 0u64;
        for (&prev, &cur) in self.prev_observations.iter().zip(&stats.observations) {
            let prev = u64::from(prev) * u64::from(stats.num_observations);
            let cur = u64::from(cur) * u64::from(self.prev_num_observations);
            total_delta += prev.abs_diff(cur);
        }
        let cutoff =
            u64::from(self.prev_num_observations) * u64::from(stats.num_observations) * 200 / 512;

        if total_delta > 3 * cutoff {
            self.costs.set_default(lit_cost, len_sym_cost)
        } else if 4 * total_delta > 9 * cutoff {
            self.costs.adjust(lit_cost, len_sym_cost, 3)
        } else if 2 * total_delta > 3 * cutoff {
            self.costs.adjust(lit_cost, len_sym_cost, 2)
        } else if 2 * total_delta > cutoff {
            self.costs.adjust(lit_cost, len_sym_cost, 1)
        } else {
            self.costs.adjust(lit_cost, len_sym_cost, 0)
        }
    }

    /// Finds the cheapest path under `self.costs`, backwards from `match_cache[cache_end]`, and sets `common.freqs` and `common.codes` from it.
    fn find_min_cost_path(
        &mut self,
        common: &mut Common,
        block_length: usize,
        cache_end: usize,
    ) -> Option<()> {
        let nodes = &mut self.optimum_nodes;
        let costs = &self.costs;
        let mut cache_idx = cache_end;

        nodes.get_mut(block_length)?.cost_to_end = 0;
        for cur in (0..block_length).rev() {
            cache_idx = cache_idx.checked_sub(1)?;
            let LzMatch {
                length: num_matches,
                offset: literal,
            } = at(&self.match_cache, cache_idx)?;
            let (num_matches, literal) = (usize::from(num_matches), u32::from(literal));

            let mut best_cost_to_end =
                at(&costs.literal, literal as usize)?.wrapping_add(nodes.get(cur + 1)?.cost_to_end);
            let mut best_item = (literal << OPTIMUM_OFFSET_SHIFT) | 1;

            // Every length up to the longest match's is tried, each with the nearest match that has it.
            if num_matches != 0 {
                let first_match = cache_idx.checked_sub(num_matches)?;
                let mut len = MIN_MATCH_LEN as usize;
                for lz_match in self.match_cache.get(first_match..cache_idx)? {
                    let offset = u32::from(lz_match.offset);
                    let offset_slot = at(self.offset_slot_full.as_slice(), offset as usize)?;
                    let offset_cost = at(&costs.offset_slot, usize::from(offset_slot))?;
                    loop {
                        let cost_to_end = offset_cost
                            .wrapping_add(at(&costs.length, len)?)
                            .wrapping_add(nodes.get(cur + len)?.cost_to_end);
                        if cost_to_end < best_cost_to_end {
                            best_cost_to_end = cost_to_end;
                            best_item = len as u32 | (offset << OPTIMUM_OFFSET_SHIFT);
                        }
                        len += 1;
                        if len > usize::from(lz_match.length) {
                            break;
                        }
                    }
                }
                cache_idx = first_match;
            }
            *nodes.get_mut(cur)? = OptimumNode {
                cost_to_end: best_cost_to_end,
                item: best_item,
            };
        }

        common.freqs.reset();
        self.tally_item_list(common, block_length)?;
        common.codes.make(&common.freqs)
    }

    /// Chooses the literals and matches of a block and writes it. Returns whether only literals were used.
    fn optimize_and_flush_block(
        &mut self,
        common: &mut Common,
        os: &mut OutputBitstream<'_>,
        block: &[u8],
        cache_end: usize,
        is_first_block: bool,
        is_final_block: bool,
    ) -> Option<bool> {
        let block_length = block.len();
        let mut best_true_cost = u32::MAX;
        let mut static_cost = u32::MAX;

        // On some data no matches at all is better than anything the passes below arrive at.
        choose_all_literals(common, block)?;
        let only_lits_cost = common.compute_true_cost()?;

        // Make any match that reaches past the end of the block too expensive to use.
        let past_end = (block_length + MAX_MATCH_LEN as usize).min(MAX_BLOCK_LENGTH + 1);
        self.optimum_nodes.clear();
        self.optimum_nodes
            .resize(block_length, OptimumNode::default());
        self.optimum_nodes.resize(
            past_end,
            OptimumNode {
                cost_to_end: 0x8000_0000,
                item: 0,
            },
        );

        if block_length <= self.max_len_to_optimize_static_block as usize {
            self.costs_saved.clone_from(&self.costs);
            self.costs.set_from_codes(&common.static_codes.lens)?;
            self.find_min_cost_path(common, block_length, cache_end)?;
            static_cost = self.optimum_nodes.first()?.cost_to_end / BIT_COST;
            static_cost += 7;
            self.costs.clone_from(&self.costs_saved);
        }

        let (lit_cost, len_sym_cost) = self.choose_default_litlen_costs(common, block)?;
        if is_first_block {
            self.costs.set_default(lit_cost, len_sym_cost)?;
        } else {
            self.adjust_costs(common, lit_cost, len_sym_cost)?;
        }

        let mut true_cost;
        let mut num_passes_remaining = self.max_optim_passes;
        loop {
            self.find_min_cost_path(common, block_length, cache_end)?;
            true_cost = common.compute_true_cost()?;
            if true_cost.wrapping_add(self.min_improvement_to_continue) > best_true_cost {
                break;
            }
            best_true_cost = true_cost;
            self.costs_saved.clone_from(&self.costs);
            self.costs.set_from_codes(&common.codes.lens)?;
            num_passes_remaining -= 1;
            if num_passes_remaining == 0 {
                break;
            }
        }

        let mut used_only_literals = false;
        if only_lits_cost.min(static_cost) < best_true_cost {
            if only_lits_cost < static_cost {
                choose_all_literals(common, block)?;
                self.costs.set_from_codes(&common.codes.lens)?;
                used_only_literals = true;
            } else {
                self.costs.set_from_codes(&common.static_codes.lens)?;
                self.find_min_cost_path(common, block_length, cache_end)?;
            }
        } else if true_cost >= best_true_cost.wrapping_add(self.min_bits_to_use_nonfinal_path) {
            self.costs.clone_from(&self.costs_saved);
            self.find_min_cost_path(common, block_length, cache_end)?;
            self.costs.set_from_codes(&common.codes.lens)?;
        }

        let all_literals = [Sequence::literals_only(block_length as u32)];
        let items = if used_only_literals {
            Items::Sequences(&all_literals)
        } else {
            Items::Path(&self.optimum_nodes, &self.offset_slot_full)
        };
        common.flush_block(os, block, items, is_final_block)?;
        Some(used_only_literals)
    }

    fn init_stats(&mut self, common: &mut Common) {
        common.split_stats = Default::default();
        self.new_match_len_freqs = [0; _];
        self.match_len_freqs = [0; _];
    }

    fn merge_stats(&mut self, common: &mut Common) {
        common.split_stats.merge_new_observations();
        for (total, new) in self
            .match_len_freqs
            .iter_mut()
            .zip(&mut self.new_match_len_freqs)
        {
            *total += core::mem::take(new);
        }
    }

    /// Keeps what [`Self::adjust_costs`] will compare the next block with.
    fn save_stats(&mut self, common: &Common) {
        self.prev_observations = common.split_stats.observations;
        self.prev_num_observations = common.split_stats.num_observations;
    }

    /// Forgets the block just written and keeps what has been seen of the next one.
    fn clear_old_stats(&mut self, common: &mut Common) {
        common.split_stats.observations = [0; _];
        common.split_stats.num_observations = 0;
        self.match_len_freqs = [0; _];
    }

    pub(crate) fn compress(
        &mut self,
        common: &mut Common,
        input: &[u8],
        os: &mut OutputBitstream<'_>,
    ) -> Option<()> {
        let in_end = input.len();
        let mut in_next = 0;
        let mut in_block_begin = 0;
        let mut in_cur_base = 0;
        let mut in_next_slide = in_end.min(WINDOW_SIZE);
        let mut max_len = MAX_MATCH_LEN;
        let mut nice_len = common.nice_match_length.min(max_len);
        let mut next_hashes = [0, 0];
        let mut prev_block_used_only_literals = false;
        let max_search_depth = common.max_search_depth;

        self.bt_mf.init();
        self.match_cache.clear();
        self.init_stats(common);

        loop {
            let in_max_block_end =
                choose_max_block_end(in_block_begin, in_end, SOFT_MAX_BLOCK_LENGTH);
            let mut prev_end_block_check = None;
            let mut change_detected = false;
            let mut next_observation = in_next;

            // This only steers the statistics. The parse weighs short matches by their cost.
            let min_len = if prev_block_used_only_literals {
                MAX_MATCH_LEN + 1
            } else {
                calculate_min_match_len(
                    input.get(in_block_begin..in_max_block_end)?,
                    max_search_depth,
                )
            };

            loop {
                let remaining = in_end - in_next;
                if in_next == in_next_slide {
                    self.bt_mf.slide_window();
                    in_cur_base = in_next;
                    in_next_slide = in_next + remaining.min(WINDOW_SIZE);
                }

                let matches_begin = self.match_cache.len();
                let mut best_len = 0;
                adjust_max_and_nice_len(&mut max_len, &mut nice_len, remaining);
                if max_len >= bt_matchfinder::REQUIRED_NBYTES {
                    self.bt_mf.get_matches(
                        input,
                        in_cur_base,
                        in_next - in_cur_base,
                        max_len,
                        nice_len,
                        max_search_depth,
                        &mut next_hashes,
                        &mut self.match_cache,
                    )?;
                    if self.match_cache.len() > matches_begin {
                        best_len = u32::from(self.match_cache.last()?.length);
                    }
                }
                let literal = at(input, in_next)?;
                if in_next >= next_observation {
                    if best_len >= min_len {
                        common.split_stats.observe_match(best_len);
                        next_observation = in_next + best_len as usize;
                        *self.new_match_len_freqs.get_mut(best_len as usize)? += 1;
                    } else {
                        common.split_stats.observe_literal(literal);
                        next_observation = in_next + 1;
                    }
                }

                self.match_cache.push(LzMatch {
                    length: (self.match_cache.len() - matches_begin) as u16,
                    offset: u16::from(literal),
                });
                in_next += 1;

                // Matches inside a very long match are not looked for: highly redundant data has far too many.
                if best_len >= MIN_MATCH_LEN && best_len >= nice_len {
                    for _ in 1..best_len {
                        let remaining = in_end - in_next;
                        if in_next == in_next_slide {
                            self.bt_mf.slide_window();
                            in_cur_base = in_next;
                            in_next_slide = in_next + remaining.min(WINDOW_SIZE);
                        }
                        adjust_max_and_nice_len(&mut max_len, &mut nice_len, remaining);
                        if max_len >= bt_matchfinder::REQUIRED_NBYTES {
                            self.bt_mf.skip_byte(
                                input,
                                in_cur_base,
                                in_next - in_cur_base,
                                nice_len,
                                max_search_depth,
                                &mut next_hashes,
                            )?;
                        }
                        self.match_cache.push(LzMatch {
                            length: 0,
                            offset: u16::from(at(input, in_next)?),
                        });
                        in_next += 1;
                    }
                }

                if in_next >= in_max_block_end || self.match_cache.len() >= MATCH_CACHE_LENGTH {
                    break;
                }
                if !common
                    .split_stats
                    .ready_to_check_block(in_block_begin, in_next, in_end)
                {
                    continue;
                }
                if common
                    .split_stats
                    .do_end_block_check((in_next - in_block_begin) as u32)
                {
                    change_detected = true;
                    break;
                }
                self.merge_stats(common);
                prev_end_block_check = Some(in_next);
            }

            let is_first = in_block_begin == 0;
            if let (true, Some(in_block_end)) = (change_detected, prev_end_block_check) {
                // The latest part is what differs, so the block ends before it and the next block starts with it.
                let mut cache_idx = self.match_cache.len();
                for _ in in_block_end..in_next {
                    cache_idx = cache_idx.checked_sub(1)?;
                    cache_idx = cache_idx
                        .checked_sub(usize::from(self.match_cache.get(cache_idx)?.length))?;
                }

                prev_block_used_only_literals = self.optimize_and_flush_block(
                    common,
                    os,
                    input.get(in_block_begin..in_block_end)?,
                    cache_idx,
                    is_first,
                    false,
                )?;
                self.match_cache.drain(..cache_idx);
                self.save_stats(common);
                self.clear_old_stats(common);
                in_block_begin = in_block_end;
            } else {
                self.merge_stats(common);
                prev_block_used_only_literals = self.optimize_and_flush_block(
                    common,
                    os,
                    input.get(in_block_begin..in_next)?,
                    self.match_cache.len(),
                    is_first,
                    in_next == in_end,
                )?;
                self.match_cache.clear();
                self.save_stats(common);
                self.init_stats(common);
                in_block_begin = in_next;
            }

            if in_next == in_end || os.overflow {
                return Some(());
            }
        }
    }
}

fn choose_all_literals(common: &mut Common, block: &[u8]) -> Option<()> {
    common.freqs.reset();
    for &byte in block {
        *common.freqs.litlen.get_mut(usize::from(byte))? += 1;
    }
    *common.freqs.litlen.get_mut(END_OF_BLOCK)? += 1;
    common.codes.make(&common.freqs)
}
