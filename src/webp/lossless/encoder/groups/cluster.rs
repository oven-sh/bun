//! What it costs to code some tiles with the same prefix codes.

use super::super::entropy::{self, Block, Cost, Estimate, Sums, least_code_cost, set_bits, x_log2};
use super::super::histogram::{Alphabet, BLOCK_LEN, BLOCKS};
use super::tiles::{Entry, Part, Tile, cost};
use crate::array::At;
use crate::error::Result;
use crate::slice::InBounds;
use crate::vec;

pub(super) struct Counts {
    pub(super) parts: [Part; 5],
    non_zero: [u64; BLOCKS],
    x_log2_sums: [Cost; BLOCKS],
    /// A `BySymbol` that ends one symbol behind the last block of the last alphabet.
    by_symbol: Vec<u32>,
}

impl Counts {
    pub(super) fn empty(alphabets: &[Alphabet; 5]) -> Result<Self> {
        let [last, ..] = alphabets;
        Ok(Self {
            parts: Default::default(),
            non_zero: [0; _],
            x_log2_sums: [0; _],
            by_symbol: vec::filled(0, last.blocks().end * BLOCK_LEN + 1)?,
        })
    }

    /// `self` is empty.
    pub(super) fn fill(&mut self, tile: &Tile, entries: &[Entry]) {
        self.parts = tile.parts;
        for entry in entries {
            let (block, i) = (entry.symbol() / BLOCK_LEN, entry.symbol() % BLOCK_LEN);
            *self.non_zero.at_mut(block) |= 1 << i;
            *self.x_log2_sums.at_mut(block) += x_log2(entry.count());
            self.by_symbol.set(entry.symbol(), entry.count());
        }
    }

    /// Undoes `fill()`.
    pub(super) fn clear(&mut self, entries: &[Entry]) {
        (self.non_zero, self.x_log2_sums) = ([0; _], [0; _]);
        for entry in entries {
            self.by_symbol.set(entry.symbol(), 0);
        }
    }

    /// With the count before and the one after.
    #[inline(always)]
    fn block(&self, index: usize) -> &[u32; 1 + BLOCK_LEN + 1] {
        let counts = self.by_symbol.get(index * BLOCK_LEN - 1..);
        counts
            .and_then(<[_]>::first_chunk)
            .unwrap_or(&const { [0; _] })
    }
}

/// The sum of the histograms of some tiles, and what it takes to tell the cost of adding more from what is added.
pub(super) struct Cluster {
    /// How many were made before it.
    pub(super) id: usize,
    /// By alphabet.
    code_cost: [i32; 5],
    code_costs: [i32; BLOCKS],
    repeats: [u64; BLOCKS],
    pub(super) counts: Counts,
}

impl Cluster {
    /// Adds a new one to `all`, which has room for it.
    pub(super) fn push(
        all: &mut Vec<Self>,
        counts: &Counts,
        alphabets: &[Alphabet; 5],
    ) -> Result<()> {
        let empty = all.push_mut(Self {
            id: all.len(),
            code_cost: [0; _],
            code_costs: [0; _],
            repeats: [0; _],
            counts: Counts::empty(alphabets)?,
        });
        for (alphabet, code_cost) in alphabets.iter().zip(&mut empty.code_cost) {
            let mut before = 0;
            for (index, start) in alphabet.blocks().zip((0..).step_by(BLOCK_LEN)) {
                let block = Block {
                    non_zero: 0,
                    repeats: entropy::can_repeat(start, alphabet.len),
                };
                *code_cost += block.code_cost(before);
                *empty.code_costs.at_mut(index) = block.code_cost(before);
                *empty.repeats.at_mut(index) = block.repeats;
                before = block.repeats;
            }
        }
        empty.add(counts, alphabets, i64::MAX);
        Ok(())
    }

    /// Unless the cost would be `limit` or more. Returns whether it has.
    pub(super) fn add(&mut self, other: &Counts, alphabets: &[Alphabet; 5], limit: i64) -> bool {
        let (mut repeats, mut code_costs) = (self.repeats, self.code_costs);
        let (mut parts, mut by_part) = (self.counts.parts, self.code_cost);
        let mut x_log2_sums = self.counts.x_log2_sums;
        for (part, &alphabet) in alphabets.iter().enumerate() {
            let changed = |index, new_repeats, code_cost, x_log2_sum| {
                *repeats.at_mut(index) = new_repeats;
                *code_costs.at_mut(index) = code_cost;
                *x_log2_sums.at_mut(index) = x_log2_sum;
            };
            let estimate = self.estimate_with::<true>(other, part, alphabet, changed);
            *by_part.at_mut(part) = estimate.code_cost;
            *parts.at_mut(part) = Part::new(&estimate, alphabet);
        }
        if cost(&parts) >= limit {
            return false;
        }
        (self.counts.parts, self.code_cost) = (parts, by_part);
        (self.repeats, self.code_costs) = (repeats, code_costs);
        self.counts.x_log2_sums = x_log2_sums;
        let (blocks, _) = self.counts.by_symbol.as_chunks_mut::<BLOCK_LEN>();
        let blocks = blocks.iter_mut().zip(&mut self.counts.non_zero);
        let (more, _) = other.by_symbol.as_chunks::<BLOCK_LEN>();
        let more = more.iter().zip(other.non_zero);
        for ((block, non_zero), (more, added)) in blocks.zip(more) {
            if added != 0 {
                *non_zero |= added;
                *block = core::array::from_fn(|i| block.at(i) + more.at(i));
            }
        }
        true
    }

    pub(super) fn symbols(&self) -> u32 {
        let parts = self.counts.parts.iter();
        parts.map(|part| part.population.symbols).sum()
    }

    /// If `IN_FULL`, calls `changed` with the index of each block that would change, and what is kept about it.
    #[inline(always)]
    fn estimate_with<const IN_FULL: bool>(
        &self,
        other: &Counts,
        part: usize,
        alphabet: Alphabet,
        mut changed: impl FnMut(usize, u64, i32, Cost),
    ) -> Estimate {
        const FEW: u32 = 10;
        const ENDS: u64 = 0b11 << 62 | 0b11;
        let population = &self.counts.parts.at(part).population;
        let mut estimate = Estimate {
            population: population.with(&other.parts.at(part).population),
            code_cost: *self.code_cost.at(part),
        };
        let (mut added_before, mut repeats_before, mut changed_before) = (0, 0, 0);
        for (index, start) in alphabet.blocks().zip((0..).step_by(BLOCK_LEN)) {
            let (added, old_repeats) = (*other.non_zero.at(index), *self.repeats.at(index));
            let follows_added = added_before >> 63;
            if added | follows_added | changed_before >> 61 == 0 {
                (added_before, repeats_before, changed_before) = (0, old_repeats, 0);
                continue;
            }
            let old = *self.counts.non_zero.at(index);
            let (non_zero, in_both) = (old | added, old & added);
            // Whether a count repeats only matters in a run of four.
            let third = non_zero & non_zero << 1 & non_zero << 2;
            let may_repeat = added & (third | third >> 2 | ENDS) | follows_added;
            let (a, b) = (self.counts.block(index), other.block(index));
            let mut x_log2_sum = 0;
            let mut repeats = old_repeats & !(added | added << 1 | follows_added);
            if IN_FULL || (in_both | may_repeat).count_ones() > FEW {
                let sums = Sums::new(a, b);
                let apart = self.counts.x_log2_sums.at(index) + other.x_log2_sums.at(index);
                estimate.population.join_all(&sums, apart);
                (repeats, x_log2_sum) = (sums.repeats, sums.x_log2_sum);
            } else {
                for i in set_bits(in_both) {
                    estimate.population.join(*a.at(i + 1), *b.at(i + 1));
                }
                for i in set_bits(may_repeat) {
                    let [before, count, after] = [i, i + 1, i + 2].map(|i| a.at(i) + b.at(i));
                    repeats |= (u64::from(before == count) | u64::from(after == count) << 1) << i;
                }
            }
            let repeats = repeats & entropy::can_repeat(start, alphabet.len);
            let code_cost = Block { non_zero, repeats }.code_cost(repeats_before);
            changed(index, repeats, code_cost, x_log2_sum);
            estimate.code_cost += code_cost - self.code_costs.at(index);
            estimate.population.symbols -= in_both.count_ones();
            (added_before, repeats_before) = (added, repeats);
            changed_before = repeats ^ old_repeats;
        }
        estimate
    }

    /// Not if nothing is added, or more of the only symbol.
    #[inline(always)]
    fn costs_more_with(&self, other: &Counts, part: usize, alphabet: Alphabet) -> bool {
        let symbols = |counts: &Counts| counts.parts.at(part).population.symbols;
        match (symbols(&self.counts), symbols(other)) {
            (_, 0) => false,
            (1, 1) => alphabet
                .blocks()
                .all(|index| self.counts.non_zero.at(index) & other.non_zero.at(index) == 0),
            _ => true,
        }
    }

    /// Close to the cost if the symbols are scattered. `None` if they turn out not to be.
    #[inline(always)]
    fn least_cost_with(&self, other: &Counts, part: usize, alphabet: Alphabet) -> Option<Cost> {
        let population = &self.counts.parts.at(part).population;
        let mut population = population.with(&other.parts.at(part).population);
        let (mut stretches, mut before) = (0, 0);
        for index in alphabet.blocks() {
            let (old, added) = (*self.counts.non_zero.at(index), *other.non_zero.at(index));
            let (non_zero, in_both) = (old | added, old & added);
            stretches += (non_zero & !(non_zero << 1 | before >> 63)).count_ones();
            before = non_zero;
            match in_both.count_ones() {
                0 => continue,
                count @ ..=16 => population.symbols -= count,
                _ => return None,
            }
            let (a, b) = (self.counts.block(index), other.block(index));
            for i in set_bits(in_both) {
                population.join(*a.at(i + 1), *b.at(i + 1));
            }
        }
        Some(population.cost() + least_code_cost(alphabet.len, population.symbols, stretches))
    }

    /// Unless that is `limit` or more, for which it pays to take a quick look first if it `is_likely`.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L426
    pub(super) fn cost_with(
        &self,
        other: &Counts,
        alphabets: &[Alphabet; 5],
        limit: i64,
        is_likely: bool,
    ) -> Option<i64> {
        let costs_more: [bool; 5] =
            core::array::from_fn(|part| self.costs_more_with(other, part, *alphabets.at(part)));
        let mut least_costs: [Cost; 5] = core::array::from_fn(|part| {
            let (a, b) = (self.counts.parts.at(part), other.parts.at(part));
            if !costs_more.at(part) {
                return a.cost;
            }
            let symbols = a.population.symbols.max(b.population.symbols);
            a.least_cost + b.least_cost + least_code_cost(alphabets.at(part).len, symbols, 1)
        });
        let mut total = least_costs.iter().sum::<Cost>() as i64;
        for (part, (&alphabet, least_cost)) in alphabets.iter().zip(&mut least_costs).enumerate() {
            if is_likely
                && *costs_more.at(part)
                && let Some(closer) = self.least_cost_with(other, part, alphabet)
            {
                total += closer as i64 - core::mem::replace(least_cost, closer) as i64;
                if total >= limit {
                    return None;
                }
            }
        }
        for (part, (&alphabet, least_cost)) in alphabets.iter().zip(least_costs).enumerate() {
            if *costs_more.at(part) {
                let estimate = self.estimate_with::<false>(other, part, alphabet, |_, _, _, _| {});
                let cost = estimate.cost(alphabet.len);
                debug_assert!(cost >= least_cost);
                total += cost as i64 - least_cost as i64;
            }
            if total >= limit {
                return None;
            }
        }
        Some(total)
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::histogram::Histogram;
    use super::super::tiles::TileHistograms;
    use super::*;
    use crate::error::Error;

    /// `count` says how often two tiles have each red.
    fn costs_what_the_sum_costs(count: impl Fn(usize) -> [u32; 2]) -> Result<()> {
        let mut tiles = TileHistograms::new(3, 0)?;
        let alphabets @ [_, reds, ..] = tiles.alphabets;
        let [histogram] = &mut *vec::array(Histogram::EMPTY)?;
        for [has_first, has_second] in [[1, 0], [0, 1], [1, 1]] {
            for (red, to) in histogram.get_mut(reds.symbols()).iter_mut().enumerate() {
                let [first, second] = count(red);
                *to = has_first * first + has_second * second;
            }
            tiles.push(histogram)?;
        }
        let counts = |tile| -> Result<_> {
            let mut counts = Counts::empty(&alphabets)?;
            counts.fill(tile, tiles.entries(tile));
            Ok(counts)
        };
        let [first, second, sum] = tiles.tiles.as_array().ok_or(Error::Internal)?;
        let (mut clusters, second, sum) = (vec::with_room(1)?, counts(second)?, cost(&sum.parts));
        Cluster::push(&mut clusters, &counts(first)?, &alphabets)?;
        let mut cluster = clusters.pop().ok_or(Error::Internal)?;
        for is_likely in [false, true] {
            let below = |limit| cluster.cost_with(&second, &alphabets, limit, is_likely);
            assert_eq!([below(sum), below(sum + 1)], [None, Some(sum)]);
        }
        assert!(cluster.add(&second, &alphabets, sum + 1));
        assert_eq!(cost(&cluster.counts.parts), sum);
        Ok(())
    }

    #[test]
    fn runs_go_on_in_the_next_block() -> Result<()> {
        for counts in 0..3u32.pow(7) {
            for added in 0..7 {
                costs_what_the_sum_costs(|red| match red.wrapping_sub(BLOCK_LEN - 4) {
                    i @ ..7 => [counts / 3u32.pow(i as u32) % 3, (i == added).into()],
                    _ => [0; 2],
                })?;
            }
        }
        Ok(())
    }

    #[test]
    fn no_sum_is_ruled_out_for_the_errors_of_the_logarithm() -> Result<()> {
        (1..600).try_for_each(|count| costs_what_the_sum_costs(|_| [count; 2]))
    }
}
