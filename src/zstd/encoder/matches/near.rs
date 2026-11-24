//! What the two fast strategies share when there is only the prefix to search.

use core::marker::ConstParamTy;

use super::{Bounds, Progress};
use crate::bytes::{AtLeast, likely, u32_at};
use crate::sequences::{Repeats, Sequences};
use crate::window::History;

/// What the tables hold.
#[derive(ConstParamTy, Clone, Copy, PartialEq, Eq)]
pub(super) enum Entries {
    /// The history starts at index 0.
    Positions,
    /// It does not, and few are out of reach.
    MostlyNear,
    Any,
}

/// The end of the prefix that is within reach of the whole block. One comparison tells whether a candidate is in it.
pub(super) struct Near<'a> {
    /// Starts at the first position that has something before it.
    pub(super) history: History<'a>,
    /// Offsets from earlier blocks can reach further.
    all: History<'a>,
    start: u32,
}

impl<'a> Near<'a> {
    /// Returns where the last match ends that `search` has found.
    pub(super) fn search<R>(
        all: &History<'a>,
        bounds: Bounds,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
        search: impl FnOnce(&Self, &mut Progress<'_>) -> R,
    ) -> u32 {
        let lowest = bounds.lowest_in_prefix(all.index(all.end()));
        let start = all.position(lowest);
        let history = History {
            prefix: all.prefix.get(start as usize..).unwrap_or_default(),
            prefix_index: lowest,
            start: (all.start - start).max(1),
            ..*all
        };
        let first = history.index(history.start);
        let max_offset = first - bounds.lowest_in_prefix(first);
        let mut progress = Progress::new(sequences, all.start - start, *repeats, max_offset);
        let all = *all;
        let near = Self {
            history,
            all,
            start,
        };
        search(&near, &mut progress);
        start + progress.finish(repeats, max_offset)
    }

    /// For a search of `chunks`, which are its prefix.
    #[inline(always)]
    pub(super) fn history_of<const ENTRIES: Entries, const N: usize>(
        &self,
        chunks: AtLeast<'a, N>,
    ) -> History<'a> {
        History {
            prefix: chunks.bytes,
            prefix_index: match ENTRIES {
                Entries::Positions => 0,
                _ => self.history.prefix_index,
            },
            ..self.history
        }
    }

    /// Whether `is_match` holds for the word at `at`, which is what an entry leads to.
    #[inline(always)]
    pub(super) fn matches_at<const ENTRIES: Entries, const N: usize>(
        history: &History<'_>,
        chunks: AtLeast<'_, N>,
        at: usize,
        is_match: impl FnOnce(u64) -> bool,
    ) -> bool {
        let is_used = || {
            // Keeps the compiler from testing this first, which is hard to predict.
            core::hint::black_box(());
            history.index(at as u32) != 0
        };
        match ENTRIES {
            Entries::Positions => chunks.matches_at::<false>(at, is_match) && is_used(),
            Entries::MostlyNear => chunks.matches_at::<false>(at, is_match),
            Entries::Any => chunks.matches_at::<true>(at, is_match) && is_used(),
        }
    }

    /// Whether the recent offsets lead to something near from `at` on. The second one may be missing.
    #[inline(always)]
    pub(super) fn has_repeats(progress: &Progress<'_>, at: u32) -> bool {
        progress.recent.wrapping_sub(1) < at && progress.second <= at
    }

    /// Whether `value` is `offset` bytes before `at` of the near `chunks`.
    #[inline(always)]
    pub(super) fn has_before<const HAS_REPEATS: bool, const N: usize>(
        &self,
        chunks: AtLeast<'_, N>,
        at: usize,
        offset: usize,
        value: u32,
    ) -> Option<bool> {
        if HAS_REPEATS {
            return Some(likely(chunks.word(at.wrapping_sub(offset)))? as u32 == value);
        }
        let back = (at as u32 + self.start).wrapping_sub(offset as u32);
        Some(offset != 0 && u32_at(self.all.prefix, back) == Some(value))
    }

    /// The history for matches at recent offsets, and where `at` of the near one is in it.
    #[inline(always)]
    pub(super) fn for_repeats<const HAS_REPEATS: bool>(
        &self,
        near: &History<'a>,
        at: u32,
    ) -> (History<'a>, u32) {
        if HAS_REPEATS {
            (*near, at)
        } else {
            (self.all, at + self.start)
        }
    }

    #[inline(always)]
    pub(super) fn repeat_len<const HAS_REPEATS: bool>(
        &self,
        near: &History<'a>,
        at: u32,
        offset: u32,
    ) -> u32 {
        let (history, at) = self.for_repeats::<HAS_REPEATS>(near, at);
        4 + history.match_len(at + 4, (at + 4).wrapping_sub(offset))
    }
}
