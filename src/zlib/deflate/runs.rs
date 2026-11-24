//! The strategies that do without hash chains.

use bun_deflate::format::{MAX_MATCH_LEN, MIN_MATCH_LEN};

use super::window::{byte, chunk, match_len};
use super::{Deflater, Flush, Io, Progress};

/// How many bytes from `position` on are like the one in front of it, if they are enough for a match.
#[inline(always)]
fn run_len(window: &[u8], position: u32) -> Option<u32> {
    let before = chunk(window, position.checked_sub(1)?)?;
    let start = u32::from_le_bytes(*chunk(before, 0)?);
    if (start ^ start >> 8) % (1 << (8 * MIN_MATCH_LEN)) != 0 {
        return None;
    }
    Some(match_len(before, chunk(window, position)?))
}

impl Deflater {
    pub(super) fn compress_literals(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        let is_done = self.fill_blocks(io, flush, 1, |this, _| {
            let range = this.window.position as usize..this.window.end as usize;
            let literals = this.window.bytes.get(range).unwrap_or_default();
            this.window.position += this.block.push_literals(literals) as u32;
        });
        if !is_done {
            return Progress::NeedsMore;
        }
        self.window.unhashed = 0;
        self.flush_rest(io, flush)
    }

    #[inline(never)]
    pub(super) fn compress_runs(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        let is_done = self.fill_blocks(io, flush, MAX_MATCH_LEN as u32 + 1, |this, stop| {
            let (window, end) = (this.window.bytes.as_slice(), this.window.end);
            let mut position = this.window.position;
            this.block.tally(|mut block| {
                while position < stop && !block.is_full() {
                    let len = run_len(window, position).map_or(0, |len| len.min(end - position));
                    if len >= MIN_MATCH_LEN as u32 {
                        block.push_match(1, len);
                        position += len;
                    } else {
                        block.push_literal(byte(window, position));
                        position += 1;
                    }
                }
            });
            this.window.position = position;
        });
        if !is_done {
            return Progress::NeedsMore;
        }
        self.window.unhashed = 0;
        self.flush_rest(io, flush)
    }
}
