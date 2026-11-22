//! Levels 3 to 6. From level 5 on it finds the next match before it settles on one, as that may reach back over it.

use super::chains::{HASHED_LEN, Index};
use super::matcher::{Match, Matcher};
use super::window::{MIN_LOOKAHEAD, byte};
use super::{Deflater, Flush, Io, Progress, Tuning};

/// A match, or a literal if it is too short for that, or nothing if it is empty.
#[derive(Clone, Copy, Default)]
struct Step {
    position: u32,
    match_start: u32,
    len: u32,
    /// The positions in front of it are in the chains.
    first_unhashed: u32,
}

#[inline(always)]
fn find(matcher: &mut Matcher<'_>, position: u32, lookahead: u32) -> Step {
    let found = match matcher.target(position, lookahead) {
        Some(target) => matcher.insert_and_match::<false>(target),
        None => Match::NONE,
    };
    Step {
        position,
        match_start: found.start,
        len: found.len,
        first_unhashed: position + 1,
    }
}

// https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_medium.c#L44
#[inline(always)]
fn hash_match(index: &mut Index<'_>, step: Step, max_len: u32) {
    let end = step.position + step.len;
    if step.len > max_len {
        return index.insert_at(end - 1);
    }
    index.insert_all::<false>(step.first_unhashed, end - step.first_unhashed);
}

/// Extends `next` to the left if that leaves at most a literal of `current`.
#[inline(always)]
fn take_over(window: &[u8], current: &mut Step, next: &mut Step) {
    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_medium.c#L97
    const MAX_LEN: u32 = 256;
    let needed = current.len - 1;
    if needed > next.match_start
        || byte(window, next.match_start - needed) != byte(window, next.position - needed)
    {
        return;
    }
    let max = (current.len)
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
    }
}

impl Deflater {
    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_medium.c#L160
    #[inline(never)]
    pub(super) fn compress_medium<const LOOKS_AHEAD: bool>(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        tuning: Tuning,
    ) -> Progress {
        let mut next = Step::default();
        let is_done = self.fill_blocks(io, flush, MIN_LOOKAHEAD, |this, stop| {
            let slide_position = this.window.slide_position();
            let mut matcher = tuning.matcher(&mut this.chains, &this.window);
            let window = matcher.index.window;
            let (mut position, end) = (this.window.position, this.window.end);
            this.block.tally(|mut block| {
                while position < stop && !block.is_full() {
                    let lookahead = end - position;
                    let mut current = if LOOKS_AHEAD && next.len != 0 && lookahead >= MIN_LOOKAHEAD
                    {
                        next
                    } else {
                        find(&mut matcher, position, lookahead)
                    };
                    let may_look_at = |behind| {
                        LOOKS_AHEAD && lookahead > MIN_LOOKAHEAD && behind < slide_position
                    };
                    next.len = 0;
                    if current.len < HASHED_LEN {
                        block.push_literal(byte(window, position));
                        position += 1;
                        if may_look_at(position) {
                            next = find(&mut matcher, position, lookahead);
                        }
                        continue;
                    }

                    if lookahead > current.len + HASHED_LEN {
                        hash_match(&mut matcher.index, current, 16 * tuning.max_lazy);
                    }
                    let behind = position + current.len;
                    if may_look_at(behind) {
                        next = find(&mut matcher, behind, lookahead);
                        if next.len >= HASHED_LEN {
                            take_over(window, &mut current, &mut next);
                        }
                    }
                    if current.len >= HASHED_LEN {
                        let (start, len) = (current.match_start, current.len);
                        let distance = Match { start, len }.distance(window, position);
                        block.push_match(distance, len);
                    } else if current.len != 0 {
                        block.push_literal(byte(window, position));
                    }
                    position += current.len;
                }
            });
            this.window.position = position;
            if end - position < MIN_LOOKAHEAD {
                next.len = 0;
            }
        });
        if !is_done {
            return Progress::NeedsMore;
        }
        self.window.leave_end_unhashed();
        self.flush_rest(io, flush)
    }
}
