//! Level 0.

use bun_deflate::encoder::Window;

use super::{Deflater, Flush, Io, Progress};
use crate::format::MAX_STORED_LEN;

impl Deflater {
    /// Blocks go straight to the output if they can be large enough there, and through `pending` if not.
    pub(super) fn store(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate_stored.c#L27
        let size = self.window.size as usize;
        let min_block = (self.pending.size() - 5).min(size);
        let input = io.input;
        let mut is_last = false;
        while !is_last {
            let header_len = self.pending.stored_header_len();
            let Some(room) = io.out.capacity().checked_sub(header_len) else {
                break;
            };
            let in_window = self.window.block(self.window.position).unwrap_or_default();
            let available = in_window.len() + io.input.len();
            let len = MAX_STORED_LEN.min(available).min(room);
            if len < min_block
                && ((len == 0 && flush != Flush::Finish)
                    || flush == Flush::None
                    || len != available)
            {
                break;
            }
            is_last = flush == Flush::Finish && len == available;
            self.pending
                .write_stored_header(len as u16, is_last, &mut io.out);
            let from_window = in_window.get(..len).unwrap_or(in_window);
            io.out.append(from_window);
            let from_input = io.take_input(len - from_window.len());
            self.window.block_start += from_window.len() as i64;
            self.checksum.copy(from_input, io.out.reborrow());
        }

        let copied = input.split_at(input.len() - io.input.len()).0;
        if let Some(start) = copied.len().checked_sub(size) {
            self.forget_history();
            self.add_history(copied.split_at(start).1);
        } else if !copied.is_empty() {
            if self.room() <= copied.len() {
                self.window.slide(self.window.size);
            }
            self.add_history(copied);
        }
        if is_last {
            return Progress::LastBlockDone;
        }
        let is_flush = flush != Flush::None;
        if is_flush
            && flush != Flush::Finish
            && io.input.is_empty()
            && self.window.block_start == i64::from(self.window.position)
        {
            return Progress::BlockDone;
        }

        if io.input.len() > self.room()
            && self.window.block_start >= i64::from(Window::START + self.window.size)
        {
            self.window.slide(self.window.size);
        }
        self.read_into_window(io, self.room());
        self.window.position = self.window.end;

        let room = (self.pending.size() - self.pending.stored_header_len()).min(MAX_STORED_LEN);
        let left = self.window.block(self.window.position).unwrap_or_default();
        if is_flush || left.len() >= room.min(size) {
            let block = left.get(..room).unwrap_or(left);
            is_last = flush == Flush::Finish && io.input.is_empty() && block.len() == left.len();
            self.pending.write_stored_block(block, is_last, &mut io.out);
            self.window.block_start += block.len() as i64;
        }
        if is_last {
            Progress::LastBlockPending
        } else {
            Progress::NeedsMore
        }
    }

    fn room(&self) -> usize {
        (Window::START + 2 * self.window.size - self.window.end) as usize
    }
}
