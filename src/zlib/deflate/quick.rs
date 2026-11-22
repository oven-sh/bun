//! Level 1: one candidate for a match, written at once with the fixed codes.

use bun_deflate::format::STATIC;
use bun_highway::with_bmi2;

use super::chains::HASHED_LEN;
use super::encoding::FIXED;
use super::pending::Bits;
use super::symbol::Symbol;
use super::window::{MIN_LOOKAHEAD, Scan, chunk, match_len};
use super::{Deflater, Flush, Io, Progress};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum QuickBlock {
    None,
    Open,
    OpenAndLast,
}

impl Deflater {
    fn open_quick_block(&mut self, is_last: bool) {
        self.pending.put(Bits::block_header(STATIC, is_last));
        self.quick_block = if is_last {
            QuickBlock::OpenAndLast
        } else {
            QuickBlock::Open
        };
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

        let is_done = self.in_stretches(io, flush, MIN_LOOKAHEAD, |this, io, stop| {
            if this.quick_block == QuickBlock::None {
                this.open_quick_block(is_last);
            }
            compress_up_to(this, stop);
            if !this.pending.is_almost_full() {
                return true;
            }
            this.pending.hand_out(&mut io.out);
            !io.is_full()
        });
        if !is_done {
            return Progress::NeedsMore;
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

with_bmi2! {
    /// Or until `pending` is almost full.
    fn compress_up_to(this: &mut Deflater, stop: u32) -> () {
        let (mut position, end) = (this.window.position, this.window.end);
        let max_distance = this.window.max_distance();
        let window = this.window.scannable_below(stop);
        let mut index = this.chains.over(window);
        let max_len = (end - position) as usize * 9 / 8 + 1;
        this.pending.write_some(max_len, #[inline(always)] |writer| {
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
        this.window.position = position;
    }
}
