//! `bit_writer_utils.c`: `VP8LBitWriter`. Bits fill each byte from its least significant end.

use crate::Result;
use crate::util::try_with_capacity;
use bun_alloc::AllocError;

pub(crate) struct BitWriter {
    buf: Vec<u8>,
    /// The bits that are not in `buf` yet.
    bits: u64,
    /// How many of `bits` are in use. At most 63.
    used: u32,
    /// `buf` could not grow, so that what it holds is worthless. `finish` reports it.
    error: bool,
}

/// Where a `BitWriter` was, to go back there.
#[derive(Clone, Copy)]
pub(crate) struct Position {
    len: usize,
    bits: u64,
    used: u32,
}

impl BitWriter {
    pub(crate) const fn new() -> Self {
        Self {
            buf: Vec::new(),
            bits: 0,
            used: 0,
            error: false,
        }
    }

    pub(crate) fn try_clone(&self) -> Result<Self> {
        let mut buf = try_with_capacity(self.buf.len())?;
        buf.extend_from_slice(&self.buf);
        Ok(Self { buf, ..*self })
    }

    pub(crate) fn num_bytes(&self) -> usize {
        self.buf.len() + self.used.div_ceil(8) as usize
    }

    pub(crate) fn position(&self) -> Position {
        Position {
            len: self.buf.len(),
            bits: self.bits,
            used: self.used,
        }
    }

    /// `VP8LBitWriterReset`: forgets what was written since `position`.
    pub(crate) fn reset(&mut self, position: Position) {
        self.buf.truncate(position.len);
        self.bits = position.bits;
        self.used = position.used;
    }

    fn flush_bits(&mut self) {
        if self.buf.try_reserve(4).is_ok() {
            self.buf
                .extend_from_slice(&(self.bits as u32).to_le_bytes());
        } else {
            self.error = true;
        }
        self.bits >>= 32;
        self.used -= 32;
    }

    /// Writes the low `n_bits` of `bits`, at most 32. The others are 0.
    #[inline]
    pub(crate) fn put_bits(&mut self, bits: u32, n_bits: u32) {
        debug_assert!(n_bits <= 32 && u64::from(bits) >> n_bits == 0);
        if self.used >= 32 {
            self.flush_bits();
        }
        self.bits |= u64::from(bits) << self.used;
        self.used += n_bits;
    }

    pub(crate) fn finish(mut self) -> Result<Vec<u8>> {
        let rest = self.used.div_ceil(8) as usize;
        if self.error || self.buf.try_reserve_exact(rest).is_err() {
            return Err(AllocError.into());
        }
        self.buf
            .extend(self.bits.to_le_bytes().into_iter().take(rest));
        Ok(self.buf)
    }
}
