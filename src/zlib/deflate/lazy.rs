//! Levels 7 to 9: a match is only taken if there is no longer one at the next position.

use super::chains::{HASHED_LEN, Match, Search};
use super::window::{MIN_LOOKAHEAD, byte};
use super::{Deflater, Flush, Io, Progress, Strategy, Stretch, Tuning};
use crate::format::MIN_MATCH;

const MAX_FILTERED_LEN: u32 = 5;

pub(super) struct Lazy {
    /// For the byte in front of the position.
    previous: Match,
    /// That byte is not in the block yet.
    is_undecided: bool,
}

impl Default for Lazy {
    fn default() -> Self {
        Self {
            previous: Match::NONE,
            is_undecided: false,
        }
    }
}

impl Lazy {
    pub(super) fn slide(&mut self, window_size: u32) {
        match self.previous.start.checked_sub(window_size) {
            Some(start) => self.previous.start = start,
            None => self.previous = Match::NONE,
        }
    }
}

impl Deflater {
    #[inline(never)]
    pub(super) fn compress_lazily<const ROLLING: bool>(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        tuning: Tuning,
    ) -> Progress {
        let is_filtered = self.strategy == Strategy::Filtered;
        loop {
            let stop = match self.next_stretch(io, flush, MIN_LOOKAHEAD) {
                Stretch::Until(stop) => stop,
                Stretch::NeedsInput => return Progress::NeedsMore,
                Stretch::End => break,
            };
            let search = self.search(tuning);
            let (window, end) = (self.window.bytes.as_slice(), self.window.end);
            let mut position = self.window.position;
            let (mut previous, mut is_undecided) = (self.lazy.previous, self.lazy.is_undecided);
            let (is_out_full, mut must_stop) = (io.is_full(), false);
            while position < stop && !self.block.is_full() && !must_stop {
                let lookahead = end - position;
                let mut found = Match::NONE;
                if lookahead >= HASHED_LEN {
                    let candidate = self.chains.insert::<ROLLING>(window, position);
                    let search = Search {
                        position,
                        lookahead,
                        ..search
                    };
                    if search.reaches(candidate) && previous.len < tuning.max_lazy {
                        found = if ROLLING {
                            self.chains
                                .longest_match_on_any_chain(window, search, candidate, previous)
                        } else {
                            self.chains
                                .longest_match(window, search, candidate, previous)
                        };
                        if (is_filtered && found.len <= MAX_FILTERED_LEN) || found.start >= position
                        {
                            found = Match::NONE;
                        }
                    }
                }

                if previous.len >= MIN_MATCH as u32 && found.len <= previous.len {
                    self.block
                        .push_match(previous.distance(window, position - 1), previous.len);
                    let hashable = lookahead.saturating_sub(MIN_MATCH as u32);
                    self.chains.insert_all::<ROLLING>(
                        window,
                        position + 1,
                        hashable.min(previous.len - 2),
                    );
                    position += previous.len - 1;
                    (previous, is_undecided) = (Match::NONE, false);
                    continue;
                }
                if is_undecided {
                    self.block.push_literal(byte(window, position - 1));
                    must_stop = is_out_full;
                }
                (previous, is_undecided) = (found, true);
                position += 1;
            }
            self.lazy = Lazy {
                previous,
                is_undecided,
            };
            if self.block.is_full() {
                self.window.position = position - u32::from(is_undecided);
                must_stop = !self.flush_block(io, false);
            }
            self.window.position = position;
            if must_stop {
                return Progress::NeedsMore;
            }
        }
        if core::mem::take(&mut self.lazy.is_undecided) {
            let last = byte(&self.window.bytes, self.window.position - 1);
            self.block.push_literal(last);
        }
        self.window.leave_end_unhashed();
        self.flush_rest(io, flush)
    }
}
