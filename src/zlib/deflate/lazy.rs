//! Levels 7 to 9: a match is only taken if there is no longer one at the next position.

use super::chains::HASHED_LEN;
use super::matcher::Match;
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
    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_slow.c#L17
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
            let mut matcher = tuning.matcher(&mut self.chains, &self.window);
            let window = matcher.index.window;
            let (mut position, end) = (self.window.position, self.window.end);
            let (mut previous, mut is_undecided) = (self.lazy.previous, self.lazy.is_undecided);
            // With a full output it goes no further than the next literal.
            let (is_out_full, mut must_stop) = (io.is_full(), false);
            self.block.tally(|mut block| {
                while position < stop
                    && !block.is_full()
                    && let Some(target) = matcher.target(position, end - position)
                {
                    let (lookahead, mut found) = (target.lookahead, Match::NONE);
                    if lookahead >= HASHED_LEN {
                        let candidate = matcher.index.insert::<ROLLING>(position, target.hashed());
                        if matcher.reaches(position, candidate) && previous.len < tuning.max_lazy {
                            found = if ROLLING {
                                matcher.longest_match_on_any_chain(
                                    position, lookahead, candidate, previous,
                                )
                            } else {
                                matcher.longest_match(target, candidate, previous)
                            };
                            if is_filtered && found.len <= MAX_FILTERED_LEN {
                                found = Match::NONE;
                            }
                        }
                    }

                    if previous.len >= MIN_MATCH as u32 && found.len <= previous.len {
                        block.push_match(previous.distance(window, position - 1), previous.len);
                        let hashable = lookahead.saturating_sub(MIN_MATCH as u32);
                        matcher
                            .index
                            .insert_all::<ROLLING>(position + 1, hashable.min(previous.len - 2));
                        position += previous.len - 1;
                        (previous, is_undecided) = (Match::NONE, false);
                        continue;
                    }
                    let was_undecided = core::mem::replace(&mut is_undecided, true);
                    previous = found;
                    position += 1;
                    if was_undecided {
                        block.push_literal(byte(window, position - 2));
                        if is_out_full {
                            must_stop = true;
                            break;
                        }
                    }
                }
            });
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
            self.block.tally(|mut block| block.push_literal(last));
        }
        self.window.leave_end_unhashed();
        self.flush_rest(io, flush)
    }
}
