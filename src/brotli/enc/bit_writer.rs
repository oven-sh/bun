//! Writes the output bit by bit, least significant bit first.

use crate::util::{Checked, SliceExt};

pub(crate) struct BitWriter<'a> {
    /// Every write sets the 8 bytes from the current one on, so there has to be room for 7 more bytes than are used. The
    /// byte at `pos` holds the bits already written to it and is otherwise 0.
    pub(crate) storage: &'a mut [u8],
    /// In bits.
    pub(crate) pos: usize,
}

impl BitWriter<'_> {
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

    /// Clears the current byte, of which no bit was written yet.
    #[inline(always)]
    pub(crate) fn prepare_storage(&mut self) -> Checked {
        debug_assert!(self.pos & 7 == 0);
        self.storage.put(self.pos >> 3, 0)
    }

    pub(crate) fn jump_to_byte_boundary(&mut self) -> Checked {
        self.pos = (self.pos + 7) & !7;
        self.prepare_storage()
    }

    /// Appends whole bytes. The position has to be at a byte boundary.
    pub(crate) fn write_bytes(&mut self, bytes: &[u8]) -> Checked {
        debug_assert!(self.pos & 7 == 0);
        self.storage.write_at(self.pos >> 3, bytes)?;
        self.pos += bytes.len() << 3;
        Ok(())
    }
}
