//! Prefix codes. The first bits of a code select a slot, which tells its length.

pub const SLOT_BITS: u32 = 6;
pub const SLOTS: usize = 1 << SLOT_BITS;
pub const MAX_LENGTH: usize = 15;

const LENGTH_BITS: u32 = 4;
pub const MAX_VALUES: usize = 1 << (16 - LENGTH_BITS);

/// For each slot, what to add to a code to get its value, and its length. Shorter codes have lower values.
pub type Code = [[u8; 2]; SLOTS];

/// `counts` has the number of slots for each length from 1 on.
pub fn code_of(counts: &[u8], first_value: usize) -> Code {
    const STEP: usize = 8;
    let (mut code, mut first_slot, mut value) = ([[0; 2]; SLOTS + STEP], 0, first_value);
    for (length, &count) in (1..).zip(counts) {
        let (count, scale) = (usize::from(count), |slots| slots << length >> SLOT_BITS);
        let slot = (value.wrapping_sub(scale(first_slot)) << LENGTH_BITS | length) as u16;
        let (mut at, end) = (first_slot, first_slot + count);
        // Perf: the next length overwrites what is too much.
        while let Some(slots) = code.get_mut(at..).and_then(<[_]>::first_chunk_mut) {
            *slots = [slot.to_le_bytes(); STEP];
            at += STEP;
            if at >= end {
                break;
            }
        }
        (first_slot, value) = (end, value + scale(count));
    }
    code.first_chunk().copied().unwrap_or([[0; 2]; _])
}

/// Reads bytes from the top bit down.
pub(crate) struct Bits<'a> {
    bytes: &'a [u8],
    position: usize,
    buffer: u64,
}

impl<'a> Bits<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            position: 0,
            buffer: 0,
        }
    }

    /// Makes 57 bits available. Returns `None` unless eight bytes follow.
    #[inline(always)]
    pub(crate) fn refill(&mut self) -> Option<()> {
        let at = self.position / 8;
        let next = self.bytes.get(at..at + 8)?.first_chunk()?;
        self.buffer = u64::from_be_bytes(*next) << (self.position % 8);
        Some(())
    }

    /// `count` is not 0.
    #[inline(always)]
    pub(crate) fn take(&mut self, count: u32) -> usize {
        let bits = self.buffer.wrapping_shr(count.wrapping_neg());
        self.buffer = self.buffer.wrapping_shl(count);
        self.position += count as usize;
        bits as usize
    }

    #[inline(always)]
    pub(crate) fn slot(&self, code: &Code) -> u16 {
        let slot = code.get((self.buffer >> (64 - SLOT_BITS)) as usize);
        slot.map_or(0, |&slot| u16::from_le_bytes(slot))
    }

    #[inline(always)]
    pub(crate) fn take_value(&mut self, slot: u16) -> usize {
        let bits = self.take(u32::from(slot) % (1 << LENGTH_BITS));
        (bits + usize::from(slot >> LENGTH_BITS)) % MAX_VALUES
    }
}
