//! The integers and byte strings that packets and frames are made of (RFC 9000 §16).

pub(crate) const MAX_VARINT: u64 = (1 << 62) - 1;
const _: () = assert!(MAX_VARINT as usize as u64 == MAX_VARINT);

/// Takes values off the front of a slice. `None` means that the slice is too short.
pub(crate) trait Read<'a> {
    fn u8(&mut self) -> Option<u8>;
    fn varint(&mut self) -> Option<u64>;
    fn bytes(&mut self, len: u64) -> Option<&'a [u8]>;
    fn array<const N: usize>(&mut self) -> Option<[u8; N]>;

    /// Bytes behind their length as a varint.
    #[inline]
    fn prefixed_bytes(&mut self) -> Option<&'a [u8]> {
        let len = self.varint()?;
        self.bytes(len)
    }
}

impl<'a> Read<'a> for &'a [u8] {
    #[inline]
    fn u8(&mut self) -> Option<u8> {
        self.split_off_first().copied()
    }

    #[inline]
    fn varint(&mut self) -> Option<u64> {
        let first = *self.first()?;
        let len = 1 << (first >> 6);
        let word = match self.first_chunk() {
            Some(&word) => u64::from_be_bytes(word),
            None => short_word(self),
        };
        self.split_off(..len)?;
        Some((word & MAX_VARINT) >> (64 - 8 * len))
    }

    #[inline]
    fn bytes(&mut self, len: u64) -> Option<&'a [u8]> {
        self.split_off(..len as usize)
    }

    #[inline]
    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        let (&first, rest) = self.split_first_chunk()?;
        *self = rest;
        Some(first)
    }
}

/// Fewer than eight bytes, in the highest bits.
fn short_word(bytes: &[u8]) -> u64 {
    let shifts = (0..8).rev().map(|at| 8 * at);
    (bytes.iter().zip(shifts)).fold(0, |word, (&byte, shift)| word | u64::from(byte) << shift)
}

#[inline]
pub(crate) const fn varint_len(value: u64) -> usize {
    match value {
        ..0x40 => 1,
        0x40..0x4000 => 2,
        0x4000..0x4000_0000 => 4,
        _ => 8,
    }
}

pub(crate) trait Write {
    /// `value` is at most [`MAX_VARINT`].
    fn varint(&mut self, value: u64);
    fn prefixed_bytes(&mut self, bytes: &[u8]);
}

impl Write for Vec<u8> {
    #[inline]
    fn varint(&mut self, value: u64) {
        debug_assert!(value <= MAX_VARINT);
        match varint_len(value) {
            1 => self.push(value as u8),
            2 => self.extend_from_slice(&two_byte_varint(value as usize)),
            4 => self.extend_from_slice(&(value as u32 | 0b10 << 30).to_be_bytes()),
            _ => self.extend_from_slice(&(value | 0b11 << 62).to_be_bytes()),
        }
    }

    #[inline]
    fn prefixed_bytes(&mut self, bytes: &[u8]) {
        self.varint(bytes.len() as u64);
        self.extend_from_slice(bytes);
    }
}

/// For a length that is known only after what follows it has been written. `value` is less than 2^14.
#[inline]
#[cfg_attr(mordant, allow(bound_checked_only_in_debug))]
pub(crate) fn two_byte_varint(value: usize) -> [u8; 2] {
    debug_assert!(value < 0x4000);
    (value as u16 | 0b01 << 14).to_be_bytes()
}

/// A varint that arrives in pieces, as on a stream.
#[derive(Default, Clone, Copy)]
pub(crate) struct PartialVarint {
    value: u64,
    missing: u8,
}

impl PartialVarint {
    /// Takes all of `input` if it returns `None`.
    #[inline]
    pub(crate) fn read(&mut self, input: &mut &[u8]) -> Option<u64> {
        if self.missing == 0 {
            if let Some(value) = input.varint() {
                return Some(value);
            }
            let first = input.u8()?;
            self.value = (first & 0x3f).into();
            self.missing = (1 << (first >> 6)) - 1;
        }
        while self.missing > 0 {
            self.value = self.value << 8 | u64::from(input.u8()?);
            self.missing -= 1;
        }
        Some(self.value)
    }

    pub(crate) fn is_started(&self) -> bool {
        self.missing > 0
    }
}
