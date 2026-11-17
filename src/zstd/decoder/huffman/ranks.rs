//! Sorting symbols by the length of their codes.

use super::{HuffmanWeights, QUICK_LEN, QUICK_LOG};
use crate::array::At;

/// The symbols in the order of their codes: from the longest to the shortest.
pub(super) struct Ranks {
    symbols: [u8; 256],
    /// By length: how many symbols come before those with shorter codes.
    ends: [u16; 16],
    /// By length: how many of the values of [`QUICK_LOG`] bits start with a code that is no longer.
    rows_up_to: [u32; 16],
    shortest: u32,
    longest: u32,
}

impl Ranks {
    pub(super) const EMPTY: Self = Self {
        symbols: [0; _],
        ends: [0; _],
        rows_up_to: [0; _],
        shortest: 0,
        longest: 0,
    };

    /// To be called on [`Self::EMPTY`].
    #[inline(always)]
    pub(super) fn sort(&mut self, tree: &HuffmanWeights) {
        let longest = tree.table_log;
        let count_of = |length: u32| *tree.rank_counts.at((longest + 1 - length) as usize);
        let unused = 4 * tree.quarter_len() - tree.symbol_count + tree.rank_counts[0] as usize;
        let (mut starts, mut end) = ([[0u8; 16]; 4], unused as u16);
        *self.ends.at_mut(longest as usize + 1) = end;
        for weight in 1..longest + 1 {
            let length = longest + 1 - weight;
            *starts[0].at_mut(weight as usize) = end as u8;
            end += count_of(length) as u16;
            *self.ends.at_mut(length as usize) = end;
            if count_of(length) != 0 {
                self.shortest = length;
            }
        }
        self.longest = longest;
        let mut before = starts[0];
        for (starts, counts) in starts.iter_mut().zip(&tree.counts_by_quarter) {
            *starts = before;
            for (before, &count) in before.iter_mut().zip(counts) {
                *before = before.wrapping_add(count);
            }
        }
        tree.for_each_in_quarters(
            #[inline(always)]
            |quarter, symbol, weight| {
                let start = starts.at_mut(quarter).at_mut(weight);
                *self.symbols.at_mut((*start).into()) = symbol;
                *start = start.wrapping_add(1);
            },
        );
        let mut rows = 0;
        for length in self.shortest..QUICK_LOG + 1 {
            if length <= longest {
                rows += count_of(length) << (QUICK_LOG - length);
            }
            *self.rows_up_to.at_mut(length as usize) = rows;
        }
    }

    /// Each length from `longest` down, with its symbols.
    #[inline(always)]
    pub(super) fn up_to(&self, longest: u32) -> impl Iterator<Item = (u32, &[u8])> {
        (self.shortest..longest.min(self.longest) + 1)
            .rev()
            .map(|length| {
                let [start, end] =
                    [length + 1, length].map(|it| usize::from(*self.ends.at(it as usize)));
                (length, self.symbols.get(start..end).unwrap_or_default())
            })
    }

    /// How many of the values of [`QUICK_LOG`] bits start with a code of more than `length` bits.
    #[inline(always)]
    pub(super) fn rows_beyond(&self, length: u32) -> usize {
        QUICK_LEN - *self.rows_up_to.at(length as usize) as usize
    }

    /// Whether looking up two codes at a time saves more time than it takes to fill the larger table.
    #[inline(always)]
    pub(super) fn are_pairs_quicker(&self, literals: usize) -> bool {
        // About in units of the time that a literal takes on its own.
        const FILL_TIME: usize = 800;
        const LOOKUP_TIME_IN_EIGHTHS: usize = 11;

        if literals <= FILL_TIME * 16 / (16 - LOOKUP_TIME_IN_EIGHTHS) {
            return false;
        }
        let up_to = |length: u32| *self.rows_up_to.at(length as usize);
        let paired = (1..QUICK_LOG)
            .map(|length| (up_to(length) - up_to(length - 1)) * up_to(QUICK_LOG - length));
        let codes_in_table = QUICK_LEN + (paired.sum::<u32>() >> QUICK_LOG) as usize;
        FILL_TIME + literals * QUICK_LEN / codes_in_table * LOOKUP_TIME_IN_EIGHTHS / 8 < literals
    }
}
