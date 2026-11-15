//! Bits, the lowest of a byte first.

use crate::error::{Error, Result};
use crate::vec;

#[derive(Default)]
pub(super) struct BitWriter {
    /// With zeros behind the first `whole` bytes, as room.
    bytes: Vec<u8>,
    whole: usize,
    /// Those that do not make a byte yet.
    pending: u64,
    pending_len: u32,
}

impl BitWriter {
    /// The most bits that `put()` takes at once.
    pub(super) const MAX_PUT: u32 = 56;

    pub(super) fn try_clone(&self) -> Result<Self> {
        Ok(Self {
            bytes: vec::copied(&self.bytes)?,
            ..*self
        })
    }

    /// For `put()`.
    pub(super) fn make_room(&mut self, bits: usize) -> Result<()> {
        let missing =
            (self.whole + bits / 8 + 1 + size_of::<u64>()).saturating_sub(self.bytes.len());
        self.bytes.try_reserve(missing)?;
        self.bytes.resize(self.bytes.len() + missing, 0);
        Ok(())
    }

    /// `bits` has nothing above the lowest `len`.
    #[inline(always)]
    pub(super) fn put(&mut self, bits: u64, len: u32) {
        debug_assert!(len <= Self::MAX_PUT && bits >> len == 0);
        debug_assert!(self.whole + size_of::<u64>() <= self.bytes.len());
        self.pending |= bits << self.pending_len;
        self.pending_len += len;
        let room = self.bytes.get_mut(self.whole..).unwrap_or_default();
        if let Some(to) = room.first_chunk_mut() {
            *to = self.pending.to_le_bytes();
        }
        self.whole += self.pending_len as usize / 8;
        self.pending >>= self.pending_len & !7;
        self.pending_len &= 7;
    }

    pub(super) fn put_flag(&mut self, is_set: bool) {
        self.put(is_set.into(), 1);
    }

    /// In bytes, if `more` bits were written.
    pub(super) fn len_with(&self, more: usize) -> usize {
        self.whole + (self.pending_len as usize + more).div_ceil(8)
    }

    pub(super) fn finish(mut self) -> Result<Vec<u8>> {
        let len = self.len_with(0);
        if len > self.bytes.len() {
            return Err(Error::Internal);
        }
        self.bytes.truncate(len);
        Ok(self.bytes)
    }
}
