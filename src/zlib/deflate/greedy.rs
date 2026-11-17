//! Level 2: takes the first match it finds.

use super::chains::{HASHED_LEN, Match, Search};
use super::window::{MIN_LOOKAHEAD, byte};
use super::{Deflater, Flush, Io, Progress, Stretch, Tuning};

impl Deflater {
    #[inline(never)]
    pub(super) fn compress_greedily(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        tuning: Tuning,
    ) -> Progress {
        loop {
            let stop = match self.next_stretch(io, flush, MIN_LOOKAHEAD) {
                Stretch::Until(stop) => stop,
                Stretch::NeedsInput => return Progress::NeedsMore,
                Stretch::End => break,
            };
            let search = self.search(tuning);
            let (window, end) = (self.window.bytes.as_slice(), self.window.end);
            let mut position = self.window.position;
            while position < stop && !self.block.is_full() {
                let lookahead = end - position;
                let mut found = Match::NONE;
                if lookahead >= HASHED_LEN {
                    let candidate = self.chains.insert::<false>(window, position);
                    let search = Search {
                        position,
                        lookahead,
                        ..search
                    };
                    if search.reaches(candidate) {
                        found = self.chains.longest_match(window, search, candidate, found);
                    }
                }
                if found.len < HASHED_LEN || found.start >= position {
                    self.block.push_literal(byte(window, position));
                    position += 1;
                    continue;
                }
                self.block
                    .push_match(found.distance(window, position), found.len);
                if found.len <= tuning.max_lazy && lookahead - found.len >= HASHED_LEN {
                    self.chains
                        .insert_all::<false>(window, position + 1, found.len - 1);
                } else {
                    self.chains
                        .insert::<false>(window, position + found.len - 1);
                }
                position += found.len;
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
