//! Where a block goes, and what it can refer to.

use core::mem::MaybeUninit;

use bun_highway::unzstd::Tape;

use crate::error::{Error, Result};
use crate::format::BlockType;
use crate::frame::{BlockHeader, Blocks, FrameHeader};
use crate::output::Output;

/// How many bytes behind the end of a copy it may read and write.
pub(crate) const OVERSHOOT: usize = 32;

/// The content size in a header, or a guess, gets no more memory at once than this...
const RESERVED_AT_ONCE_MAX: u64 = 16 << 20;
/// ...or the former this many times what is written.
const RESERVED_AT_ONCE_FACTOR: u64 = 8;
/// Without the overshoot.
const STAND_IN_LEN: usize = 2048;
/// More output than this is not moved to make room for the overshoot, and does not double if its end is in sight.
const CHEAP_TO_MOVE: usize = 1 << 20;

pub(crate) struct Destination<'o, 'a> {
    out: &'o mut Output<'a>,
    frame: &'o FrameHeader,
    /// How many of the last bytes that `out` has written are history.
    history_len: usize,
    /// The end of the history before those.
    external: &'o [u8],
    /// That of the output or the ring, which `out` may be a part of or stand in for.
    room: usize,
    /// How long the block can get.
    limit: usize,
    /// As far as is known.
    pub(crate) is_last_frame: bool,
    /// This one and those behind it, if they are known.
    pub(crate) blocks: (Option<BlockHeader>, Blocks),
    /// Of the frame, to an output that grows.
    pub(crate) written: usize,
}

impl<'o, 'a> Destination<'o, 'a> {
    pub(crate) fn new(
        out: &'o mut Output<'a>,
        frame: &'o FrameHeader,
        history_len: usize,
        external: &'o [u8],
        room: usize,
    ) -> Self {
        Self {
            room,
            is_last_frame: false,
            blocks: (None, Blocks::default()),
            written: history_len,
            limit: frame.block_len_max().min(room),
            out,
            frame,
            history_len,
            external,
        }
    }

    pub(crate) fn block_len_max(&self) -> usize {
        self.frame.block_len_max()
    }

    pub(crate) fn room(&self) -> usize {
        self.room
    }

    #[inline]
    pub(crate) fn check_block_len(&self, len: usize) -> Result<()> {
        if len <= self.limit {
            Ok(())
        } else if len > self.room() {
            Err(Error::DstSizeTooSmall)
        } else {
            Err(Error::CorruptionDetected)
        }
    }

    /// Ends the block with `bytes`, behind `len` bytes of what was lent. Returns its length.
    pub(crate) fn finish(mut self, len: usize, bytes: &[u8]) -> Result<usize> {
        self.check_block_len(len + bytes.len())?;
        self.reserve(len + bytes.len(), len + bytes.len())?;
        self.out.commit(len);
        Ok(len + self.out.append(bytes))
    }

    /// `content` is that of an RLE block.
    pub(crate) fn finish_repeated(mut self, content: &[u8], count: usize) -> Result<usize> {
        self.check_block_len(count)?;
        self.reserve(count, count)?;
        (self.out).append_repeated(*content.first().ok_or(Error::Internal)?, count);
        Ok(count)
    }

    /// For `len` bytes from the start of the block on. If that takes more memory, for `wanted`, or the rest of the frame.
    #[inline(always)]
    fn reserve(&mut self, len: usize, wanted: usize) -> Result<()> {
        if self.out.grows() && len > self.out.reserved_room() {
            self.reserve_more(len, wanted)?;
        }
        Ok(())
    }

    #[cold]
    fn reserve_more(&mut self, len: usize, wanted: usize) -> Result<()> {
        let written = self.written as u64;
        let most = written.saturating_mul(RESERVED_AT_ONCE_FACTOR);
        let most = most.max(RESERVED_AT_ONCE_MAX);
        let size = self.frame.content_size.filter(|&size| size <= most);
        let len_to_move = self.out.len_to_move();
        match size.map(|size| size.saturating_sub(written) as usize + OVERSHOOT) {
            Some(left) if left < len => self.out.reserve(len),
            // More frames may come with the next call.
            Some(left) if self.is_last_frame && len_to_move > CHEAP_TO_MOVE => {
                self.out.reserve_exact(left.max(len_to_move / 4))
            }
            Some(left) => self.out.reserve(left),
            None if self.frame.content_size.is_some() => self.out.reserve(wanted),
            None => (self.reserve_for_all_blocks(wanted)).or_else(|_| self.out.reserve(wanted)),
        }
    }

    fn reserve_for_all_blocks(&mut self, wanted: usize) -> Result<()> {
        let ((block, left), full) = (self.blocks, self.block_len_max());
        let block = block.filter(|it| it.block_type() == BlockType::Compressed);
        let most = full * (left.compressed_count + 1) + left.plain_len + OVERSHOOT;
        let capacity = self.out.capacity();
        if self.is_last_frame && most < capacity && self.written > capacity / 2 {
            return self.out.reserve_exact(most.min(self.room).max(wanted));
        }
        let size = block.map_or(0, BlockHeader::size);
        let is_typical = left.compressed_count.saturating_sub(1) * size / 8 <= left.compressed_len;
        let is_full = size != 0 && left.count != 0 && wanted > full / 4 && is_typical;
        let this = if is_full { wanted.max(full) } else { wanted };
        // In sixteenths. A short block says little about the others, and one miss is enough.
        let ratio = match (24 * this).checked_div(size) {
            _ if this < 1024 || self.written > full => 0,
            ratio => ratio.unwrap_or(4 * 16),
        };
        let compressed =
            (left.compressed_len.saturating_mul(ratio) / 16).min(left.decompressed_len_max);
        let compressed = compressed.min(left.compressed_count * this);
        let likely = (this + compressed + left.plain_len).min(RESERVED_AT_ONCE_MAX as usize);
        self.out.reserve(likely.min(self.room).max(wanted))
    }

    /// Writes a sequence that fits behind the first `len` bytes of the block, and nothing behind it.
    pub(crate) fn write(
        &mut self,
        len: usize,
        literals: &[u8],
        offset: usize,
        match_len: usize,
    ) -> Result<()> {
        let end = len + literals.len() + match_len;
        if end > self.limit {
            return Err(Error::Internal);
        }
        self.reserve(end, end)?;
        self.out.write_ahead(len, literals);
        let mut ahead = len + literals.len();
        if let Some(distance @ 1..) = offset.checked_sub(self.history_len + ahead) {
            let from = self.external.len().checked_sub(distance);
            let from = from.and_then(|from| self.external.get(from..));
            let from = from.ok_or(Error::CorruptionDetected)?;
            let from = from.get(..match_len).unwrap_or(from);
            self.out.write_ahead(ahead, from);
            ahead += from.len();
        }
        if ahead < end {
            self.out.repeat_ahead(ahead, offset, end - ahead)?;
        }
        Ok(())
    }

    /// `write` writes the start of the block, and returns something and its end. A short, tight output gets a stand-in.
    #[inline(always)]
    pub(crate) fn with_overshoot<T>(
        &mut self,
        write: impl FnOnce(&mut Destination<'_, '_>) -> Result<(T, usize)>,
    ) -> Result<(T, usize)> {
        let is_short = self.history_len == 0 && self.limit <= STAND_IN_LEN && !self.out.grows();
        if !(is_short && self.limit + OVERSHOOT > self.out.room_with_slack()) {
            return write(self);
        }
        let mut bytes = [MaybeUninit::uninit(); STAND_IN_LEN + 2 * OVERSHOOT];
        let bytes = bytes.get_mut(..self.limit + 2 * OVERSHOOT);
        let mut out = Output::slice(bytes.ok_or(Error::Internal)?.write_filled(0));
        let mut stand_in = Destination::new(&mut out, self.frame, 0, self.external, self.room);
        let (other, len) = write(&mut stand_in)?;
        out.commit(len);
        self.out.write_ahead(0, out.last_written(len));
        Ok((other, len))
    }

    /// To where the block starts, until the output moves.
    pub(crate) fn as_ptr(&self) -> *const u8 {
        self.out.room_ptr()
    }

    /// Whether it is about to guess how much memory to ask for.
    pub(crate) fn has_to_guess(&self) -> bool {
        self.out.grows()
            && self.frame.content_size.is_none()
            && self.out.reserved_room() < OVERSHOOT
    }

    /// Where the block starts on the [`tape`](Self::tape).
    #[inline]
    pub(crate) fn position(&self) -> usize {
        self.history_len
    }

    /// Where it has to end there.
    #[inline]
    pub(crate) fn end(&self) -> usize {
        self.history_len + self.limit
    }

    /// The history in two parts, with room for `len` bytes of the block, and if possible `more` and the overshoot.
    #[inline]
    pub(crate) fn tape(&mut self, len: usize, more: usize) -> Result<(&[u8], Tape<'_>)> {
        let wanted = (len + more).min(self.limit) + OVERSHOOT;
        let is_cheap_to_move = self.out.len_to_move() <= CHEAP_TO_MOVE;
        let overshoot = if is_cheap_to_move { OVERSHOOT } else { 0 };
        self.reserve(len.min(self.limit) + overshoot, wanted)?;
        Ok((self.external, self.out.tape(self.history_len, wanted)))
    }
}

#[cfg(test)]
mod tests {
    use crate::{Decoder, Dictionary, Output, Result, decompress};

    #[test]
    fn all_kinds_of_output_get_the_same() -> Result<()> {
        /// 800 times "a", then "6789aaaa" from 804 bytes back. Like the others, it has a checksum.
        const INTO_DICTIONARY: &[u8] = b"\x28\xb5\x2f\xfd\x04\x00\x02\x19\x00a\x45\x00\x00\x00\x01\x54\x00\x09\x05\x27\x03\x5e\x3b\x9f\x43";
        let fixtures: [(&[u8], &[u8], usize); 3] = [
            (include_bytes!("tests/fixtures/generated.zst"), &[], 122576),
            (
                include_bytes!("tests/fixtures/small-window.zst"),
                &[],
                40000,
            ),
            (INTO_DICTIONARY, b"0123456789", 808),
        ];
        for (frames, dictionary, len) in fixtures {
            let (mut slice, mut vec) = (vec![0; 1 << 17], Vec::with_capacity(1 << 17));
            let shared = Dictionary::new(dictionary)?;
            decompress(frames, &mut Output::slice(&mut slice), Some(&shared))?;
            let mut spare = Output::spare_capacity(&mut vec, usize::MAX);
            decompress(frames, &mut spare, Some(&shared))?;
            drop(spare);

            let (mut decoder, mut streamed) = (Decoder::new(), Vec::new());
            decoder.load_dictionary(dictionary)?;
            for mut piece in frames.chunks(100) {
                while !piece.is_empty() {
                    let (consumed, status) = decoder.step_growing(piece, &mut streamed, usize::MAX);
                    status?;
                    assert!(consumed != 0);
                    piece = piece.get(consumed..).unwrap_or_default();
                }
            }
            assert!(vec.len() == len && streamed == vec && slice.starts_with(&vec));
        }
        Ok(())
    }
}
