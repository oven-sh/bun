//! How long the strings are that are hashed.

use bun_highway::deflate::MAX_BATCH;
use core::mem::replace;

use super::block::Estimate;
use super::parser::{EARLY_LEN, Effort, SHORT_LEN};

#[derive(Clone, Copy, Default)]
pub(super) struct Grams {
    /// 0 until it has been chosen.
    pub(super) shortest: u8,
    needs_longer: bool,
    got_longer: bool,
    /// So many batches from the last change to the next, unless 3 has been tried in vain.
    patience: u8,
    batches: u32,
    /// Since then, with more weight on the latest.
    candidates: u32,
    matches: u32,
    short_matches: u32,
}

impl Grams {
    pub(super) fn for_dear_literals(min_len: u8) -> Self {
        Self {
            shortest: min_len,
            needs_longer: true,
            ..Self::default()
        }
    }

    /// The longest first.
    pub(super) fn lens(self, effort: Effort) -> &'static [u8] {
        let all: &[u8] = match (self.shortest, effort) {
            (3, Effort::Highest) => &[6, 4, 3],
            (3, _) => &[6, 3],
            (4, Effort::Highest) => &[12, 7, 4],
            (4, _) => &[7, 4],
            (5, Effort::Highest) => &[12, 8, 5],
            (5, _) => &[8, 5],
            (6, Effort::Highest) => &[16, 8, 6],
            (6, _) => &[8, 6],
            (_, Effort::Highest) => &[20, 13, 8],
            _ => &[13, 8],
        };
        match all.last_chunk::<1>() {
            _ if effort > Effort::Medium => all,
            Some(last) if effort < Effort::Medium || !self.needs_longer => last,
            _ => all,
        }
    }

    /// The same for [`Effort::Thorough`], after `len` bytes of input.
    pub(super) fn ladder(self, len: u32, passes: u8) -> &'static [u8] {
        match (len, passes) {
            _ if self.shortest == 8 => &[24, 16, 12, 8, 4],
            (..=SHORT_LEN, 1) => &[5, 3],
            (..=SHORT_LEN, 2) | (..=EARLY_LEN, 1) => &[10, 5, 3],
            (..=SHORT_LEN, _) => &[10, 5, 4, 3],
            (..=EARLY_LEN, 2) => &[20, 7, 4, 3],
            (..=EARLY_LEN, _) => &[24, 10, 7, 4, 3],
            (_, 1) => &[20, 10, 6, 4, 3],
            (_, 2) => &[20, 10, 7, 5, 4, 3],
            _ => &[24, 14, 10, 7, 5, 4, 3],
        }
    }

    /// The fewer different bytes there are, the more strings are alike by chance.
    pub(super) fn choose(&mut self, different: u32, is_binary: bool, len: usize, min_len: u8) {
        let is_short = len < SHORT_LEN as usize;
        self.shortest = min_len.max(match different {
            ..6 => 8,
            6..20 => 6,
            20..70 if min_len == 5 => 6,
            20..32 => 5 - u8::from(is_short),
            _ if !is_binary => 4,
            _ => 3,
        });
        self.needs_longer = different < 4;
    }

    /// After a whole batch.
    pub(super) fn adapt(
        &mut self,
        latest: &Estimate,
        candidates: u32,
        effort: Effort,
        min_len: u8,
    ) {
        let add = |sum: &mut u32, latest| *sum = *sum * 3 / 4 + latest;
        add(&mut self.candidates, candidates);
        add(&mut self.matches, latest.matches);
        add(&mut self.short_matches, latest.shortest_matches);
        self.batches = self.batches.saturating_add(1);
        if (self.batches <= self.patience.into() && self.shortest != 3)
            || candidates + latest.literals < 128
        {
            return;
        }
        // Many candidates for few matches mean that the nearest is often not the best.
        let tenths = 10 * self.candidates / (self.matches + 16);
        let are_dense = candidates > MAX_BATCH as u32 / 5;
        let is_binary = 16 * latest.high_bytes > latest.literals
            && latest.literal_cost > 6 * 256 * latest.literals;
        let (before, was) = (self.lens(effort), self.shortest);
        let (shortest, needs_longer) = match (was, before.len(), tenths) {
            (3, ..) if 10 * self.short_matches < self.matches || tenths > 50 => (4, false),
            (4 | 5, _, ..25) if min_len == 3 && is_binary && candidates > 128 => (3, false),
            (3, 1, 20..) => (3, true),
            (4, 1, 23..) if are_dense => (5, false),
            (4, _, 36..) | (6, _, ..24) | (5, 2, 19..24) => (5, false),
            (5, _, ..19) => (4, false),
            (5, 1, 28..33) if are_dense => (5, true),
            (5, 1, 33..) | (5, _, 40..) | (8, _, ..22) => (6, false),
            (6, _, 33..) => (8, false),
            _ => return,
        };
        (self.shortest, self.needs_longer) = (shortest.max(min_len), needs_longer);
        if self.lens(effort) != before {
            let is_longer = self.shortest >= was;
            if replace(&mut self.got_longer, is_longer) != is_longer {
                self.patience = (2 * self.patience + 1).min(63);
            }
            (
                self.batches,
                self.candidates,
                self.matches,
                self.short_matches,
            ) = (0, 0, 0, 0);
        }
    }
}
