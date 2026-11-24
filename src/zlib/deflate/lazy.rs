//! Levels 7 to 9: a match is only taken if there is no longer one at the next position.

use bun_deflate::format::MIN_MATCH_LEN;

use super::matcher::Match;
use super::window::{MIN_LOOKAHEAD, byte};
use super::{Deflater, Flush, Io, Progress, Strategy, Tuning};

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
        let max_unwanted_len = if self.strategy == Strategy::Filtered {
            MAX_FILTERED_LEN
        } else {
            0
        };
        let is_done = self.in_stretches(io, flush, MIN_LOOKAHEAD, |this, io, stop| {
            let mut matcher = tuning.matcher(&mut this.chains, &this.window);
            let window = matcher.index.window;
            let (mut position, end) = (this.window.position, this.window.end);
            let (mut previous, mut is_undecided) = (this.lazy.previous, this.lazy.is_undecided);
            // With a full output it goes no further than the next literal.
            let (is_out_full, mut must_stop) = (io.is_full(), false);
            this.block.tally(|mut block| {
                while position < stop
                    && !block.is_full()
                    && let Some(target) = matcher.target(position, end - position)
                {
                    let mut found;
                    if previous.len < MIN_MATCH_LEN as u32 {
                        found = matcher.insert_and_match::<ROLLING>(target);
                    } else {
                        let is_good_enough = previous.len >= tuning.max_lazy;
                        found = matcher.insert_and_improve::<ROLLING>(
                            position,
                            target.lookahead,
                            previous,
                            is_good_enough,
                        );
                        if found.len <= previous.len {
                            block.push_match(previous.distance(window, position - 1), previous.len);
                            let hashable = target.lookahead.saturating_sub(MIN_MATCH_LEN as u32);
                            matcher.index.insert_all::<ROLLING>(
                                position + 1,
                                hashable.min(previous.len - 2),
                            );
                            position += previous.len - 1;
                            (previous, is_undecided) = (Match::NONE, false);
                            continue;
                        }
                    }
                    if found.len <= max_unwanted_len {
                        found = Match::NONE;
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
            this.lazy = Lazy {
                previous,
                is_undecided,
            };
            if this.block.is_full() {
                this.window.position = position - u32::from(is_undecided);
                must_stop = !this.flush_block(io, false);
            }
            this.window.position = position;
            !must_stop
        });
        if !is_done {
            return Progress::NeedsMore;
        }
        if core::mem::take(&mut self.lazy.is_undecided) {
            let last = byte(&self.window.bytes, self.window.position - 1);
            self.block.tally(|mut block| block.push_literal(last));
        }
        self.window.leave_end_unhashed();
        self.flush_rest(io, flush)
    }
}
