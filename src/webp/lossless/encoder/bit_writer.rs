//! Bits, the lowest of a byte first.

use crate::error::{Error, Result};
use crate::slice::{InBounds, known};
use crate::vec;

#[derive(Default)]
pub(super) struct BitWriter {
    /// With zeros behind the first `whole` bytes, as room.
    bytes: Vec<u8>,
    whole: usize,
    /// Those that do not make a byte yet.
    pending: u64,
    pending_len: u32,
    is_out_of_memory: bool,
}

impl BitWriter {
    /// The most bits that `put()` takes at once.
    const MAX_PUT: u32 = 56;

    pub(super) fn try_clone(&self) -> Result<Self> {
        Ok(Self {
            bytes: vec::copied(&self.bytes)?,
            ..*self
        })
    }

    /// For `put()`.
    pub(super) fn make_room(&mut self, bits: usize) {
        let missing =
            (self.whole + bits / 8 + 1 + size_of::<u64>()).saturating_sub(self.bytes.len());
        if self.bytes.try_reserve(missing).is_ok() {
            self.bytes.resize(self.bytes.len() + missing, 0);
        } else {
            self.is_out_of_memory = true;
        }
    }

    /// `bits` has nothing above the lowest `len`.
    #[inline(always)]
    pub(super) fn put(&mut self, bits: u64, len: u32) {
        debug_assert!(len <= Self::MAX_PUT && bits >> len == 0);
        self.pending |= bits << self.pending_len;
        self.pending_len += len;
        let room = self.bytes.get_mut(self.whole..).unwrap_or_default();
        if let Some(to) = room.first_chunk_mut() {
            *to = self.pending.to_le_bytes();
        } else {
            known(self.is_out_of_memory.then_some(()));
        }
        self.whole += self.pending_len as usize / 8;
        self.pending >>= self.pending_len & !7;
        self.pending_len &= 7;
    }

    pub(super) fn put_flag(&mut self, is_set: bool) {
        self.put(is_set.into(), 1);
    }

    /// `put()` that makes its own room.
    pub(super) fn append(&mut self, bits: u64, len: u32) {
        self.make_room(len as usize);
        self.put(bits, len);
    }

    pub(super) fn append_flag(&mut self, is_set: bool) {
        self.append(is_set.into(), 1);
    }

    /// In bytes, if `more` bits were written.
    pub(super) fn len_with(&self, more: usize) -> usize {
        self.whole + (self.pending_len as usize + more).div_ceil(8)
    }

    /// That no room was refused.
    pub(super) fn check(&self) -> Result<()> {
        if self.is_out_of_memory {
            return Err(Error::Alloc(bun_alloc::AllocError));
        }
        Ok(())
    }

    pub(super) fn finish(mut self) -> Result<Vec<u8>> {
        self.check()?;
        let len = self.bytes.part(..self.len_with(0)).len();
        self.bytes.truncate(len);
        Ok(self.bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slice::checked;

    #[test]
    fn nothing_is_put_without_room() {
        let result = checked(|| {
            let mut writer = BitWriter::default();
            writer.put_flag(true);
            writer.append_flag(true);
            writer.finish()
        });
        assert_eq!(result, Err(Error::Internal));
    }

    #[test]
    fn nothing_comes_of_a_writer_that_was_refused_room() {
        let writer = BitWriter {
            is_out_of_memory: true,
            ..BitWriter::default()
        };
        assert_eq!(writer.finish(), Err(Error::Alloc(bun_alloc::AllocError)));
    }
}
