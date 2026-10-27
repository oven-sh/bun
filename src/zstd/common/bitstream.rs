//! `bitstream.h`: a bit stream is written forward and read backward.

use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, highbit32, read_le64};

const CONTAINER_BYTES: usize = size_of::<u64>();
const CONTAINER_BITS: u32 = u64::BITS;

/// `BIT_CStream_t`
pub(crate) struct BitCStream<'a> {
    dst: &'a mut [u8],
    container: u64,
    bit_pos: u32,
    pos: usize,
    /// The last position a whole container can be written to.
    end: usize,
}

impl<'a> BitCStream<'a> {
    /// `BIT_initCStream`
    #[inline]
    pub(crate) fn new(dst: &'a mut [u8]) -> Result<Self> {
        if dst.len() <= CONTAINER_BYTES {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        let end = dst.len() - CONTAINER_BYTES;
        Ok(Self {
            dst,
            container: 0,
            bit_pos: 0,
            pos: 0,
            end,
        })
    }

    /// `BIT_addBits`: `nb_bits` is less than 32, and there is room for them in the container.
    #[inline(always)]
    pub(crate) fn add_bits(&mut self, value: u64, nb_bits: u32) {
        self.add_bits_fast(value & ((1u64 << (nb_bits & 31)) - 1), nb_bits);
    }

    /// `BIT_addBitsFast`: the bits of `value` above `nb_bits` are 0.
    #[inline(always)]
    pub(crate) fn add_bits_fast(&mut self, value: u64, nb_bits: u32) {
        debug_assert!(nb_bits + self.bit_pos < CONTAINER_BITS);
        self.container |= value << (self.bit_pos & (CONTAINER_BITS - 1));
        self.bit_pos += nb_bits;
    }

    #[inline(always)]
    fn flush(&mut self) {
        let nb_bytes = (self.bit_pos >> 3) as usize;
        if let Ok(out) = self.dst.array_at_mut(self.pos) {
            *out = self.container.to_le_bytes();
        }
        self.pos += nb_bytes;
        self.bit_pos &= 7;
        // All 8 bytes leave only if `add_bits` was given more than fits.
        self.container = self.container.checked_shr(nb_bytes as u32 * 8).unwrap_or(0);
    }

    /// `BIT_flushBitsFast`: the caller knows that the output is large enough.
    #[inline(always)]
    pub(crate) fn flush_bits_fast(&mut self) {
        self.flush();
    }

    /// `BIT_flushBits`: at the end of the output the stream stops advancing, which [`Self::close`] reports.
    #[inline(always)]
    pub(crate) fn flush_bits(&mut self) {
        self.flush();
        if self.pos > self.end {
            self.pos = self.end;
        }
    }

    /// `BIT_closeCStream`: the size of the stream, or 0 if it did not fit.
    #[inline]
    pub(crate) fn close(mut self) -> usize {
        self.add_bits_fast(1, 1);
        self.flush_bits();
        if self.pos >= self.end {
            return 0;
        }
        self.pos + usize::from(self.bit_pos > 0)
    }
}

/// `BIT_DStream_status`
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum DStreamStatus {
    Unfinished,
    EndOfBuffer,
    Completed,
    Overflow,
}

/// `BIT_DStream_t`
#[derive(Clone, Copy)]
pub(crate) struct BitDStream<'a> {
    src: &'a [u8],
    pub(crate) container: u64,
    pub(crate) bits_consumed: u32,
    /// Where `container` was read from.
    pos: usize,
}

impl<'a> BitDStream<'a> {
    /// `BIT_initDStream`
    #[inline]
    pub(crate) fn new(src: &'a [u8]) -> Result<Self> {
        let Some(&last_byte) = src.last() else {
            return Err(ErrorCode::SrcSizeWrong);
        };
        let padding = 8 - highbit32(u32::from(last_byte));
        if let Some(tail) = src.last_chunk::<CONTAINER_BYTES>() {
            if last_byte == 0 {
                return Err(ErrorCode::Generic);
            }
            return Ok(Self {
                src,
                container: u64::from_le_bytes(*tail),
                bits_consumed: padding,
                pos: src.len() - CONTAINER_BYTES,
            });
        }
        if last_byte == 0 {
            return Err(ErrorCode::CorruptionDetected);
        }
        let mut bytes = [0u8; CONTAINER_BYTES];
        bytes.write_at(0, src)?;
        Ok(Self {
            src,
            container: u64::from_le_bytes(bytes),
            bits_consumed: padding + (CONTAINER_BYTES - src.len()) as u32 * 8,
            pos: 0,
        })
    }

    /// A stream in the state that the 4-stream Huffman loops leave it in. `src` has at least 8 bytes from `pos` on.
    #[inline]
    pub(crate) fn resume(src: &'a [u8], pos: usize, bits_consumed: u32) -> Result<Self> {
        Ok(Self {
            src,
            container: read_le64(src, pos)?,
            bits_consumed,
            pos,
        })
    }

    /// `BIT_lookBits`: `nb_bits` is less than 32.
    #[inline(always)]
    pub(crate) fn look_bits(&self, nb_bits: u32) -> u64 {
        let start = CONTAINER_BITS
            .wrapping_sub(self.bits_consumed)
            .wrapping_sub(nb_bits);
        (self.container >> (start & (CONTAINER_BITS - 1))) & ((1u64 << (nb_bits & 31)) - 1)
    }

    /// `BIT_lookBitsFast`: `nb_bits` is at least 1.
    #[inline(always)]
    pub(crate) fn look_bits_fast(&self, nb_bits: u32) -> u64 {
        const MASK: u32 = CONTAINER_BITS - 1;
        (self.container << (self.bits_consumed & MASK))
            >> (CONTAINER_BITS.wrapping_sub(nb_bits) & MASK)
    }

    /// `BIT_skipBits`
    #[inline(always)]
    pub(crate) fn skip_bits(&mut self, nb_bits: u32) {
        self.bits_consumed = self.bits_consumed.wrapping_add(nb_bits);
    }

    /// `BIT_readBits`
    #[inline(always)]
    pub(crate) fn read_bits(&mut self, nb_bits: u32) -> u64 {
        let value = self.look_bits(nb_bits);
        self.skip_bits(nb_bits);
        value
    }

    /// `BIT_readBitsFast`
    #[inline(always)]
    pub(crate) fn read_bits_fast(&mut self, nb_bits: u32) -> u64 {
        let value = self.look_bits_fast(nb_bits);
        self.skip_bits(nb_bits);
        value
    }

    #[inline(always)]
    fn load(&mut self, pos: usize) {
        self.pos = pos;
        if let Ok(container) = read_le64(self.src, pos) {
            self.container = container;
        }
    }

    /// `BIT_reloadDStreamFast`
    #[inline(always)]
    pub(crate) fn reload_fast(&mut self) -> DStreamStatus {
        if self.pos < CONTAINER_BYTES {
            return DStreamStatus::Overflow;
        }
        self.reload_internal()
    }

    /// `BIT_reloadDStream_internal`: `pos` is at least 8 and at most 64 bits are consumed.
    #[inline(always)]
    fn reload_internal(&mut self) -> DStreamStatus {
        let pos = self.pos.wrapping_sub((self.bits_consumed >> 3) as usize);
        self.bits_consumed &= 7;
        self.load(pos);
        DStreamStatus::Unfinished
    }

    /// `BIT_reloadDStream`
    #[inline(always)]
    pub(crate) fn reload(&mut self) -> DStreamStatus {
        if self.bits_consumed > CONTAINER_BITS {
            return DStreamStatus::Overflow;
        }
        if self.pos >= CONTAINER_BYTES {
            return self.reload_internal();
        }
        if self.pos == 0 {
            if self.bits_consumed < CONTAINER_BITS {
                return DStreamStatus::EndOfBuffer;
            }
            return DStreamStatus::Completed;
        }
        let mut nb_bytes = (self.bits_consumed >> 3) as usize;
        let mut result = DStreamStatus::Unfinished;
        if self.pos < nb_bytes {
            nb_bytes = self.pos;
            result = DStreamStatus::EndOfBuffer;
        }
        self.bits_consumed -= nb_bytes as u32 * 8;
        self.load(self.pos - nb_bytes);
        result
    }

    /// `BIT_endOfDStream`
    #[inline(always)]
    pub(crate) fn is_at_end(&self) -> bool {
        self.pos == 0 && self.bits_consumed == CONTAINER_BITS
    }
}
