//! Level 2: takes the first match it finds.

use super::chains::HASHED_LEN;
use super::window::MIN_LOOKAHEAD;
use super::{Deflater, Flush, Io, Progress, Tuning};

impl Deflater {
    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_fast.c#L19
    #[inline(never)]
    pub(super) fn compress_greedily(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        tuning: Tuning,
    ) -> Progress {
        let is_done = self.fill_blocks(io, flush, MIN_LOOKAHEAD, |this, stop| {
            let mut matcher = tuning.matcher(&mut this.chains, &this.window);
            let (mut position, end) = (this.window.position, this.window.end);
            this.block.tally(|mut block| {
                while position < stop
                    && !block.is_full()
                    && let Some(target) = matcher.target(position, end - position)
                {
                    let found = matcher.insert_and_match::<false>(target);
                    if found.len < HASHED_LEN {
                        block.push_literal(target.scan[0]);
                        position += 1;
                        continue;
                    }
                    block.push_match(found.distance(matcher.index.window, position), found.len);
                    if found.len <= tuning.max_lazy && target.lookahead - found.len >= HASHED_LEN {
                        matcher
                            .index
                            .insert_all::<false>(position + 1, found.len - 1);
                    } else {
                        matcher.index.insert_at(position + found.len - 1);
                    }
                    position += found.len;
                }
            });
            this.window.position = position;
        });
        if !is_done {
            return Progress::NeedsMore;
        }
        self.window.leave_end_unhashed();
        self.flush_rest(io, flush)
    }
}
