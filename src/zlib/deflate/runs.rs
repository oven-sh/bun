//! The strategies that do without hash chains.

use super::window::{SCAN_LEN, byte, chunk};
use super::{Deflater, Flush, Io, Progress, Stretch};
use crate::format::{MAX_MATCH, MIN_MATCH};

/// How many bytes at the start are `repeated`, at most `MAX_MATCH`.
#[inline(always)]
fn run_len(bytes: &[u8; SCAN_LEN], repeated: u8) -> u32 {
    let repeated = u64::from_le_bytes([repeated; 8]);
    for (len, &word) in (0..).step_by(8).zip(bytes.as_chunks().0) {
        let difference = u64::from_le_bytes(word) ^ repeated;
        if difference != 0 {
            return (len + difference.trailing_zeros() / 8).min(MAX_MATCH as u32);
        }
    }
    MAX_MATCH as u32
}

impl Deflater {
    pub(super) fn compress_literals(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        loop {
            match self.next_stretch(io, flush, 1) {
                Stretch::Until(_) => {}
                Stretch::NeedsInput => return Progress::NeedsMore,
                Stretch::End => break,
            }
            let range = self.window.position as usize..self.window.end as usize;
            let literals = self.window.bytes.get(range).unwrap_or_default();
            self.window.position += self.block.push_literals(literals) as u32;
            if self.block.is_full() && !self.flush_block(io, false) {
                return Progress::NeedsMore;
            }
        }
        self.window.unhashed = 0;
        self.flush_rest(io, flush)
    }

    #[inline(never)]
    pub(super) fn compress_runs(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        loop {
            let stop = match self.next_stretch(io, flush, MAX_MATCH as u32 + 1) {
                Stretch::Until(stop) => stop,
                Stretch::NeedsInput => return Progress::NeedsMore,
                Stretch::End => break,
            };
            let (window, end) = (self.window.bytes.as_slice(), self.window.end);
            let mut position = self.window.position;
            while position < stop && !self.block.is_full() {
                let current = byte(window, position);
                let mut len = 0;
                if position != 0
                    && byte(window, position - 1) == current
                    && let Some(ahead) = chunk(window, position)
                {
                    len = run_len(ahead, current).min(end - position);
                }
                if len >= MIN_MATCH as u32 {
                    self.block.push_match(1, len);
                    position += len;
                } else {
                    self.block.push_literal(current);
                    position += 1;
                }
            }
            self.window.position = position;
            if self.block.is_full() && !self.flush_block(io, false) {
                return Progress::NeedsMore;
            }
        }
        self.window.unhashed = 0;
        self.flush_rest(io, flush)
    }
}
