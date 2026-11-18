//! Where a block goes, and what it can refer to.

use crate::error::{Error, Result};
use crate::format::BLOCK_LEN_MAX;
use crate::frame::FrameHeader;
use crate::output::Output;

/// How many bytes behind the end of a copy it may read and write.
pub(crate) const OVERSHOOT: usize = 32;
/// Positions in it and in the block behind it fit in 32 bits. Unit tests do not get that far.
const ADJACENT_HISTORY_MAX: usize = if cfg!(test) {
    700
} else {
    (1 << 32) - (1 << 19)
};
const _: () = assert!(ADJACENT_HISTORY_MAX + 3 * BLOCK_LEN_MAX <= u32::MAX as usize);

/// The content size in a header gets no more memory at once than this...
const RESERVED_AT_ONCE_MAX: u64 = 16 << 20;
/// ...or this many times what is written.
const RESERVED_AT_ONCE_FACTOR: u64 = 8;
/// Without the overshoot. The smaller takes less time to clear.
const STAND_IN_LENS: [usize; 2] = [224, 1024];
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
}

pub(crate) struct Loan<'a> {
    /// The end of the history before `out`.
    pub(crate) detached: &'a [u8],
    /// The rest of the history, and room for the block.
    pub(crate) out: &'a mut [u8],
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
        let written = self.history_len as u64;
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
            None => self.out.reserve(wanted),
        }
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

    /// `write` writes the start of the block and returns its length. A short, tight output gets a stand-in for that.
    #[inline(always)]
    pub(crate) fn with_overshoot<T>(
        &mut self,
        write: impl FnOnce(&mut Destination<'_, '_>) -> Result<(usize, T)>,
    ) -> Result<(usize, T)> {
        let is_short = self.history_len == 0 && self.limit <= STAND_IN_LENS[1] && !self.grows();
        let fits = matches!(self.frame.content_size, Some(size) if size <= self.limit as u64);
        if !(is_short && fits && self.limit + OVERSHOOT > self.out.room_with_slack()) {
            return write(self);
        }
        let (mut few_bytes, mut many_bytes);
        let bytes: &mut [u8] = if self.limit <= STAND_IN_LENS[0] {
            few_bytes = [0; STAND_IN_LENS[0] + OVERSHOOT];
            &mut few_bytes
        } else {
            many_bytes = [0; STAND_IN_LENS[1] + OVERSHOOT];
            &mut many_bytes
        };
        let mut out = Output::slice(bytes);
        let (len, rest) = write(&mut Destination::new(
            &mut out,
            self.frame,
            0,
            self.external,
            self.room,
        ))?;
        drop(out);
        (self.out).write_ahead(0, bytes.get(..len).ok_or(Error::Internal)?);
        Ok((len, rest))
    }

    /// To where the block starts, until the output moves.
    pub(crate) fn as_ptr(&self) -> *const u8 {
        self.out.room_ptr()
    }

    pub(crate) fn grows(&self) -> bool {
        self.out.grows()
    }

    /// About how far back matches can be.
    pub(crate) fn reach(&self) -> u64 {
        ((self.history_len + self.external.len()) as u64).min(self.frame.window_size)
    }

    /// Where the block starts in [`Loan::out`].
    #[inline]
    pub(crate) fn position(&self) -> usize {
        self.history_len.min(ADJACENT_HISTORY_MAX)
    }

    /// What [`Self::lend`] has behind the history.
    pub(crate) fn lend_room(&mut self, len: usize, more: usize) -> Result<&mut [u8]> {
        let position = self.position();
        (self.lend(len, more)?.out.get_mut(position..)).ok_or(Error::Internal)
    }

    /// With `len` bytes for the block, as far as it may go. If possible also `more`, and the overshoot.
    pub(crate) fn lend(&mut self, len: usize, more: usize) -> Result<Loan<'_>> {
        let wanted = (len + more).min(self.limit) + OVERSHOOT;
        let is_cheap_to_move = self.out.len_to_move() <= CHEAP_TO_MOVE;
        let overshoot = if is_cheap_to_move { OVERSHOOT } else { 0 };
        self.reserve(len.min(self.limit) + overshoot, wanted)?;
        let (mut detached, detached_len) = (self.external, self.history_len - self.position());
        let mut out = (self.out).lend_with_slack(self.history_len, wanted, self.limit + OVERSHOOT);
        if detached_len != 0 {
            detached = out.split_off_mut(..detached_len).ok_or(Error::Internal)?;
        }
        Ok(Loan { detached, out })
    }
}

#[cfg(test)]
mod tests {
    use crate::{Decoder, Dictionary, Output, Result, decompress};

    #[test]
    fn matches_reach_beyond_the_adjacent_history() -> Result<()> {
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
