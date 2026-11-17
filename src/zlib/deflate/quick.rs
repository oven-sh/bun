//! Level 1: one candidate for a match, written at once with the fixed codes.

use super::block::{FIXED, Symbol};
use super::chains::HASHED_LEN;
use super::window::{MIN_LOOKAHEAD, byte, chunk, long_match_len, word};
use super::{Deflater, Flush, Io, Progress, Stretch};
use crate::format::FIXED_BLOCK;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum QuickBlock {
    None,
    Open,
    OpenAndLast,
}

#[inline(always)]
fn match_len(window: &[u8], position: u32, candidate: u32) -> Option<u32> {
    let difference = word(window, position)? ^ word(window, candidate)?;
    if difference != 0 {
        return Some(difference.trailing_zeros() / 8);
    }
    Some(long_match_len(
        chunk(window, position)?,
        chunk(window, candidate)?,
    ))
}

impl Deflater {
    fn open_quick_block(&mut self, is_last: bool) {
        self.pending
            .write_bits(1, |writer| writer.put_block_type(FIXED_BLOCK, is_last));
        self.quick_block = if is_last {
            QuickBlock::OpenAndLast
        } else {
            QuickBlock::Open
        };
        self.window.start_block();
    }

    /// Whether there is room left.
    fn close_quick_block(&mut self, io: &mut Io<'_, '_>, is_last: bool) -> bool {
        if self.quick_block == QuickBlock::None {
            return true;
        }
        self.pending.write_bits(2, |writer| {
            FIXED.put_end_of_block(writer);
            if is_last {
                writer.pad_to_byte_boundary();
            }
        });
        self.quick_block = QuickBlock::None;
        self.window.start_block();
        self.pending.hand_out(&mut io.out);
        !io.is_full()
    }

    #[inline(never)]
    pub(super) fn compress_quickly(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        let is_last = flush == Flush::Finish;
        if is_last && self.quick_block != QuickBlock::OpenAndLast {
            if !self.close_quick_block(io, false) {
                return Progress::NeedsMore;
            }
            self.open_quick_block(true);
        } else if self.quick_block == QuickBlock::None && self.window.lookahead() != 0 {
            self.open_quick_block(false);
        }

        let almost_full = self.pending.size() - 8;
        loop {
            let stop = match self.next_stretch(io, flush, MIN_LOOKAHEAD) {
                Stretch::Until(stop) => stop,
                Stretch::NeedsInput => {
                    self.pending.hold_back_partial_word();
                    return Progress::NeedsMore;
                }
                Stretch::End => break,
            };
            if self.quick_block == QuickBlock::None {
                self.open_quick_block(is_last);
            }
            let (window, end) = (self.window.bytes.as_slice(), self.window.end);
            let max_distance = self.window.max_distance();
            let mut position = self.window.position;
            let chains = &mut self.chains;
            let max_len = (end - position) as usize * 9 / 8 + 1;
            let len = self.pending.write_bits(max_len, |writer| {
                while position < stop && writer.len() < almost_full {
                    let lookahead = end - position;
                    if lookahead >= HASHED_LEN {
                        let candidate = chains.insert::<false>(window, position);
                        let distance = position.wrapping_sub(candidate);
                        if distance.wrapping_sub(1) < max_distance
                            && let Some(len @ HASHED_LEN..) = match_len(window, position, candidate)
                        {
                            let len = len.min(lookahead);
                            FIXED.put(writer, Symbol::for_match(distance, len));
                            position += len;
                            continue;
                        }
                    }
                    FIXED.put_literal(writer, byte(window, position));
                    position += 1;
                }
                writer.len()
            });
            self.window.position = position;
            if len >= almost_full {
                self.pending.hand_out(&mut io.out);
                if io.is_full() {
                    return Progress::NeedsMore;
                }
            }
        }

        self.window.leave_end_unhashed();
        match (self.close_quick_block(io, is_last), is_last) {
            (true, true) => Progress::LastBlockDone,
            (false, true) => Progress::LastBlockPending,
            (true, false) => Progress::BlockDone,
            (false, false) => Progress::NeedsMore,
        }
    }
}
