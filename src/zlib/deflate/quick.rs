//! Level 1: one candidate for a match, written at once with the fixed codes.

use super::chains::HASHED_LEN;
use super::encoding::FIXED;
use super::pending::Bits;
use super::symbol::Symbol;
use super::window::{MIN_LOOKAHEAD, Scan, chunk, match_len};
use super::{Deflater, Flush, Io, Progress, Stretch};
use crate::format::FIXED_BLOCK;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum QuickBlock {
    None,
    Open,
    OpenAndLast,
}

impl Deflater {
    fn open_quick_block(&mut self, is_last: bool) {
        self.pending.put(Bits::block_header(FIXED_BLOCK, is_last));
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
        self.pending.put(FIXED.end_of_block());
        if is_last {
            self.pending.pad_to_byte_boundary();
        }
        self.quick_block = QuickBlock::None;
        self.window.start_block();
        self.pending.hand_out(&mut io.out);
        !io.is_full()
    }

    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_quick.c#L47
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

        loop {
            let stop = match self.next_stretch(io, flush, MIN_LOOKAHEAD) {
                Stretch::Until(stop) => stop,
                Stretch::NeedsInput => return Progress::NeedsMore,
                Stretch::End => break,
            };
            if self.quick_block == QuickBlock::None {
                self.open_quick_block(is_last);
            }
            let (mut position, end) = (self.window.position, self.window.end);
            let max_distance = self.window.max_distance();
            let window = self.window.scannable_below(stop);
            let mut index = self.chains.over(window);
            let max_len = (end - position) as usize * 9 / 8 + 1;
            self.pending.write_some(max_len, |writer| {
                while let Some::<&Scan>(scan) = chunk(window, position) {
                    let lookahead = end - position;
                    if lookahead >= HASHED_LEN {
                        let hashed = chunk(scan, 0).copied().unwrap_or_default();
                        let candidate = index.insert::<false>(position, hashed);
                        let distance = position.wrapping_sub(candidate);
                        if distance.wrapping_sub(1) < max_distance
                            && let Some::<&Scan>(other) = chunk(window, candidate)
                            && chunk(other, 0) == Some(&hashed)
                        {
                            let len = match_len(scan, other).min(lookahead);
                            position += len;
                            if !writer.put_and_check(FIXED.of(Symbol::for_match(distance, len))) {
                                break;
                            }
                            continue;
                        }
                    }
                    position += 1;
                    if !writer.put_and_check(FIXED.of_literal(scan[0])) {
                        break;
                    }
                }
            });
            self.window.position = position;
            if self.pending.is_almost_full() {
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
