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

/// Up to [`Bits::MAX_COUNT`] bits at the top, and how many they are at the bottom. One shift makes room for them.
#[derive(Clone, Copy)]
pub(super) struct Code(u64);

impl Code {
    pub(super) const EMPTY: Self = Self(0);
    const LENGTH_BITS: u32 = 6;

    /// `top` has zeros below the `length` bits.
    #[inline(always)]
    pub(super) const fn new(length: u32, top: u64) -> Self {
        Self(top | length as u64)
    }

    #[inline(always)]
    pub(super) const fn length(self) -> u32 {
        self.0 as u32 % (1 << Self::LENGTH_BITS)
    }

    #[inline(always)]
    pub(super) const fn bits(self) -> Bits {
        let value = self.0 >> Self::LENGTH_BITS;
        Bits::new(
            self.length(),
            value >> (64 - Self::LENGTH_BITS - self.length()),
        )
    }

    /// For extra bits, which the length has already.
    #[inline(always)]
    pub(super) const fn plus(self, top: u64) -> Self {
        Self(self.0.wrapping_add(top))
    }

    #[inline(always)]
    pub(super) const fn prepend(&mut self, first: Self) {
        let length = first.length() as u64;
        *self = self.plus(((first.0 - length) >> self.length()) + length);
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

    pub(super) fn write_bits(&mut self, bits: Bits) {
        debug_assert!(bits.count <= Bits::MAX_COUNT && bits.value >> bits.count == 0);
        let at = self.complete_count();
        if at + WORD > self.buffer.len() {
            memory::grow(&mut self.buffer, at + WORD);
        }
        let word = &mut self.buffer[at..at + WORD];
        let joined = u64::from(word[0]) | (bits.value << (self.position % 8));
        put_bytes(word, 0, joined.to_le_bytes());
        self.position += bits.count;
    }

    /// `N` at once if they fit, as they do most of the time. Together they have less than 256 bits.
    #[inline(always)]
    pub(super) fn write_codes<const N: usize, T: Copy>(
        &mut self,
        items: &[T],
        code_of: impl Fn(T) -> Code,
    ) {
        let (groups, rest) = items.as_chunks::<N>();
        let mut groups = groups.iter();
        loop {
            let (buffer, mut end) = (&mut *self.buffer, self.position);
            let misfit = groups.find(|group| {
                let codes = group.iter().map(|&item| code_of(item));
                put_codes(buffer, end, codes)
                    .map(|next| end = next)
                    .is_none()
            });
            self.position = end;
            let Some(group) = misfit else {
                return self.write_each(rest, &code_of);
            };
            self.write_each(group, &code_of);
        }
    }

    #[cold]
    #[inline(never)]
    fn write_each<T: Copy>(&mut self, items: &[T], code_of: &impl Fn(T) -> Code) {
        for &item in items {
            self.write_bits(code_of(item).bits());
        }
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

/// Returns where `codes` end, unless they are too long for one write or there is no room.
#[inline(always)]
fn put_codes(buffer: &mut [u8], start: u32, codes: impl Iterator<Item = Code>) -> Option<u32> {
    let (mut joined, mut sum) = (0, 0u32);
    for code in codes {
        joined = (joined >> code.length()) | code.0;
        sum = sum.wrapping_add(code.0 as u32);
    }
    let end = start + u32::from(sum as u8);
    let shift = (start & !7).wrapping_sub(end);
    if (shift as i32) < Code::LENGTH_BITS as i32 - 64 {
        return None;
    }
    let at = start as usize / 8;
    let word = buffer.get_mut(at..at + WORD)?;
    let joined = u64::from(word[0]) | (joined >> (shift % 64));
    put_bytes(word, 0, joined.to_le_bytes());
    Some(end)
}
