//! Levels 3 to 6. From level 5 on it finds the next match before it settles on one, as that may reach back over it.

use super::chains::{Chains, HASHED_LEN, Match, Search};
use super::window::{MIN_LOOKAHEAD, byte};
use super::{Deflater, Flush, Io, Progress, Stretch, Tuning};

/// A match, or with a length of 1 a literal, or with a length of 0 nothing.
#[derive(Clone, Copy, Default)]
struct Step {
    position: u32,
    match_start: u32,
    len: u32,
    /// The positions in front of it are in the chains.
    first_unhashed: u32,
}

#[inline(always)]
fn find(chains: &Chains, window: &[u8], search: Search, candidate: u32) -> Step {
    let mut found = Match::NONE;
    if search.reaches(candidate) {
        found = chains.longest_match(window, search, candidate, found);
    }
    let is_match = found.len >= HASHED_LEN && found.start < search.position;
    Step {
        position: search.position,
        match_start: found.start,
        len: if is_match { found.len } else { 1 },
        first_unhashed: search.position,
    }
}

#[inline(always)]
fn hash_match(chains: &mut Chains, window: &[u8], step: Step, max_len: u32) {
    let end = step.position + step.len;
    if step.len > max_len {
        chains.insert::<false>(window, end - 1);
        return;
    }
    let start = step.first_unhashed.max(step.position + 1);
    chains.insert_all::<false>(window, start, end.saturating_sub(start));
}

/// Extends `next` to the left if that leaves at most a literal of `current`.
#[inline(always)]
fn take_over(window: &[u8], current: &mut Step, next: &mut Step, max_distance: u32) {
    const MAX_LEN: u32 = 256;
    let needed = current.len - 1;
    if needed == 0
        || needed > next.match_start
        || byte(window, next.match_start - needed) != byte(window, next.position - needed)
    {
        return;
    }
    let limit = next.position.saturating_sub(max_distance);
    let max = (current.len)
        .min(next.position - limit)
        .min(MAX_LEN.saturating_sub(next.len))
        .min(next.match_start - 1);
    let moved = (1..=max)
        .take_while(|back| {
            byte(window, next.match_start - back) == byte(window, next.position - back)
        })
        .count() as u32;
    if moved >= needed {
        current.len -= moved;
        next.position -= moved;
        next.match_start -= moved;
        next.len += moved;
        next.first_unhashed += 1;
    }
}

impl Deflater {
    #[inline(never)]
    pub(super) fn compress_medium(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        tuning: Tuning,
    ) -> Progress {
        let looks_ahead = !tuning.effort.gives_up_early;
        let mut next = Step::default();
        loop {
            if self.window.lookahead() < MIN_LOOKAHEAD {
                next.len = 0;
            }
            let stop = match self.next_stretch(io, flush, MIN_LOOKAHEAD) {
                Stretch::Until(stop) => stop,
                Stretch::NeedsInput => return Progress::NeedsMore,
                Stretch::End => break,
            };
            let search = self.search(tuning);
            let slide_position = self.window.slide_position();
            let (window, end) = (self.window.bytes.as_slice(), self.window.end);
            let mut position = self.window.position;
            while position < stop && !self.block.is_full() {
                let lookahead = end - position;
                let search = |position| Search {
                    position,
                    lookahead,
                    ..search
                };
                let mut current = if next.len != 0 && lookahead >= MIN_LOOKAHEAD {
                    next
                } else {
                    let candidate = if lookahead >= HASHED_LEN {
                        self.chains.insert::<false>(window, position)
                    } else {
                        0
                    };
                    find(&self.chains, window, search(position), candidate)
                };
                if current.len >= HASHED_LEN && lookahead > current.len + HASHED_LEN {
                    hash_match(&mut self.chains, window, current, 16 * tuning.max_lazy);
                }

                let behind = position + current.len;
                if looks_ahead && lookahead > MIN_LOOKAHEAD && behind < slide_position {
                    let candidate = self.chains.insert::<false>(window, behind);
                    next = find(&self.chains, window, search(behind), candidate);
                    if next.len >= HASHED_LEN {
                        let max_distance = search(behind).max_distance;
                        take_over(window, &mut current, &mut next, max_distance);
                    }
                } else {
                    next.len = 0;
                }

                if current.len >= HASHED_LEN {
                    let (start, len) = (current.match_start, current.len);
                    let distance = Match { start, len }.distance(window, position);
                    self.block.push_match(distance, len);
                } else if current.len != 0 {
                    self.block.push_literal(byte(window, position));
                }
                position += current.len;
            }
            self.window.position = position;
            if self.block.is_full() && !self.flush_block(io, false) {
                return Progress::NeedsMore;
            }
        }
        self.window.leave_end_unhashed();
        self.flush_rest(io, flush)
    }
}
