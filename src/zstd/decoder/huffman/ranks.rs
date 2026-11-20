//! What follows from the lengths of the codes.

use super::{HuffmanWeights, QUICK_LEN, QUICK_LOG};
use crate::array::At;

pub(super) struct Ranks<'a> {
    tree: &'a HuffmanWeights,
    /// By length: how many of the values of [`QUICK_LOG`] bits start with a code that is no longer.
    rows_up_to: [u32; 16],
    shortest: u32,
}

impl<'a> Ranks<'a> {
    #[inline(always)]
    pub(super) fn new(tree: &'a HuffmanWeights) -> Self {
        let longest = tree.table_log;
        let (mut shortest, mut rows_up_to, mut rows) = (0, [0; _], 0);
        for length in (1..longest + 1).rev() {
            if tree.count_of(length) != 0 {
                shortest = length;
            }
        }
        for length in shortest..QUICK_LOG + 1 {
            if length <= longest {
                rows += tree.count_of(length) << (QUICK_LOG - length);
            }
            *rows_up_to.at_mut(length as usize) = rows;
        }
        Self {
            tree,
            rows_up_to,
            shortest,
        }
    }

    /// Each length from `longest` down, with its symbols.
    #[inline(always)]
    pub(super) fn up_to(&self, longest: u32) -> impl Iterator<Item = (u32, &[u8])> {
        (self.shortest..longest.min(self.tree.table_log) + 1)
            .rev()
            .map(|length| {
                let symbols = self.tree.padded_symbols_of(length);
                let symbols = symbols.get(..self.tree.count_of(length) as usize);
                (length, symbols.unwrap_or_default())
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
