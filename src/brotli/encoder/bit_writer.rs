use super::matching::{load32, put_bytes};
use crate::memory::{self, Result};

const WORD: usize = size_of::<u64>();
/// For the short fields between two reservations. The most are a command, its distance and two block switches.
const SPARE: usize = 64;

/// The low `count` bits of `value`, whose other bits are zero.
#[derive(Clone, Copy)]
pub(super) struct Bits {
    pub(super) count: u32,
    pub(super) value: u64,
}

impl Bits {
    pub(super) const EMPTY: Self = Self::new(0, 0);
    /// For one write.
    pub(super) const MAX_COUNT: u32 = 56;

    #[inline(always)]
    pub(super) const fn new(count: u32, value: u64) -> Self {
        Self { count, value }
    }

    #[inline(always)]
    pub(super) fn then(self, next: Self) -> Self {
        Self::new(
            self.count + next.count,
            self.value | (next.value << self.count),
        )
    }
}

#[derive(Default)]
pub(super) struct BitWriter {
    /// Longer than what is written. The unused bits of the incomplete byte are zero.
    buffer: Vec<u8>,
    position: u32,
}

impl BitWriter {
    /// Writing `bytes` more bytes will not allocate.
    pub(super) fn try_reserve(&mut self, bytes: usize) -> Result<()> {
        let needed = self.complete_count() + bytes + SPARE;
        let additional = needed.saturating_sub(self.buffer.len());
        memory::try_reserve(&mut self.buffer, additional)
    }

    #[inline(always)]
    fn complete_count(&self) -> usize {
        self.position as usize / 8
    }

    pub(super) fn complete_bytes(&self) -> &[u8] {
        &self.buffer[..self.complete_count()]
    }

    pub(super) fn forget_complete_bytes(&mut self) {
        let incomplete = self.buffer.get(self.complete_count());
        self.buffer[0] = incomplete.copied().unwrap_or(0);
        self.position %= 8;
    }

    pub(super) fn is_at_byte_boundary(&self) -> bool {
        self.position.is_multiple_of(8)
    }

    /// In bits.
    pub(super) fn position(&self) -> usize {
        self.position as usize
    }

    pub(super) fn rewind(&mut self, position: usize) {
        self.position = position as u32;
        self.buffer[position / 8] &= (1 << (position % 8)) - 1;
    }

    /// For a loop that writes up to `bytes` bytes.
    #[inline(always)]
    pub(super) fn with_room(&mut self, bytes: usize) -> Room<'_> {
        let mut room = Room {
            position: self.position,
            writer: self,
        };
        room.ensure(bytes);
        room
    }

    #[cold]
    fn grow(&mut self, needed: usize) {
        let with_spare = (needed + 256).min(self.buffer.capacity());
        self.buffer.resize(needed.max(with_spare), 0);
    }

    pub(super) fn write_bits(&mut self, bits: Bits) {
        self.with_room(0).write_bits(bits);
    }

    pub(super) fn write(&mut self, count: u32, value: u64) {
        self.write_bits(Bits::new(count, value));
    }

    pub(super) fn align(&mut self) {
        self.write(self.position.wrapping_neg() % 8, 0);
    }

    /// At a byte boundary.
    pub(super) fn write_bytes(&mut self, bytes: &[u8]) {
        debug_assert!(self.is_at_byte_boundary());
        let start = self.complete_count();
        let (fit, rest) = bytes.split_at(bytes.len().min(self.buffer.len() - start));
        self.buffer[start..][..fit.len()].copy_from_slice(fit);
        self.buffer.extend_from_slice(rest);
        self.position += 8 * bytes.len() as u32;
        if let Some(incomplete) = self.buffer.get_mut(start + bytes.len()) {
            *incomplete = 0;
        }
    }

    /// Replaces up to 25 bits, more than four bytes before the position.
    pub(super) fn overwrite(&mut self, position: usize, count: u32, value: u32) {
        let shift = position % 8;
        let old = load32(&self.buffer, position / 8);
        let new = (old & !(((1 << count) - 1) << shift)) | (value << shift);
        put_bytes(&mut self.buffer, position / 8, new.to_le_bytes());
    }
}

pub(super) struct Room<'a> {
    writer: &'a mut BitWriter,
    position: u32,
}

impl Room<'_> {
    /// For up to `bytes` bytes from here.
    #[inline(always)]
    pub(super) fn ensure(&mut self, bytes: usize) {
        let needed = self.position as usize / 8 + bytes + WORD;
        if needed > self.writer.buffer.len() {
            self.writer.grow(needed);
        }
    }

    #[inline(always)]
    pub(super) fn write_bits(&mut self, bits: Bits) {
        debug_assert!(bits.count <= Bits::MAX_COUNT && bits.value >> bits.count == 0);
        let at = self.position as usize / 8;
        let word = &mut self.writer.buffer[at..at + WORD];
        let joined = u64::from(word[0]) | (bits.value << (self.position % 8));
        put_bytes(word, 0, joined.to_le_bytes());
        self.position += bits.count;
    }

    /// At once if they fit, as they do most of the time.
    #[inline(always)]
    pub(super) fn write_both(&mut self, first: Bits, second: Bits) {
        if first.count + second.count <= Bits::MAX_COUNT {
            self.write_bits(first.then(second));
        } else {
            self.write_bits(first);
            self.write_bits(second);
        }
    }
}

impl Drop for Room<'_> {
    #[inline(always)]
    fn drop(&mut self) {
        self.writer.position = self.position;
    }
}
