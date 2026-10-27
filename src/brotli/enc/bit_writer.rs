//! Writes the output bit by bit, least significant bit first.

use crate::util::{Checked, SliceExt};

pub(crate) struct BitWriter<'a> {
    /// Every write sets the 8 bytes from the current one on, so there has to be room for 7 more bytes than are used. The
    /// bits of the current byte that are not written yet are 0.
    storage: &'a mut [u8],
    /// How many bits were written.
    pos: usize,
}

impl<'a> BitWriter<'a> {
    /// Goes on after the first `pos` bits of `storage`.
    pub(crate) fn new(storage: &'a mut [u8], pos: usize) -> Checked<Self> {
        let mut writer = Self { storage, pos };
        writer.rewind(pos)?;
        Ok(writer)
    }

    /// How many bits were written.
    #[inline(always)]
    pub(crate) fn pos(&self) -> usize {
        self.pos
    }

    /// What was written, and the room for more.
    pub(crate) fn storage(&mut self) -> &mut [u8] {
        self.storage
    }

    /// Writes the low `n_bits` of `bits`. The others are 0, and `n_bits` is at most 56.
    #[inline(always)]
    pub(crate) fn write_bits(&mut self, n_bits: usize, bits: u64) -> Checked {
        debug_assert!(n_bits <= 56 && bits >> n_bits == 0);
        let p: &mut [u8; 8] = self.storage.array_at_mut(self.pos >> 3)?;
        let v = u64::from(p[0]) | (bits << (self.pos & 7));
        *p = v.to_le_bytes();
        self.pos += n_bits;
        Ok(())
    }

    /// Forgets all but the first `pos` bits of `storage`.
    pub(crate) fn rewind(&mut self, pos: usize) -> Checked {
        self.pos = pos;
        *self.storage.at_mut(pos >> 3)? &= ((1u32 << (pos & 7)) - 1) as u8;
        Ok(())
    }

    /// Fills the current byte up with zeros, if any of its bits is written.
    pub(crate) fn jump_to_byte_boundary(&mut self) -> Checked {
        self.pos = (self.pos + 7) & !7;
        self.storage.put(self.pos >> 3, 0)
    }

    /// Appends whole bytes. The position has to be at a byte boundary.
    pub(crate) fn write_bytes(&mut self, bytes: &[u8]) -> Checked {
        debug_assert!(self.pos & 7 == 0);
        self.storage.write_at(self.pos >> 3, bytes)?;
        self.pos += bytes.len() << 3;
        self.storage.put(self.pos >> 3, 0)
    }
}
