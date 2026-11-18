//! Bytes and LEB128 numbers. A read that fails stops after the last byte it looked at.

#[derive(Clone, Copy)]
pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}

/// The new position of a read, with `FAILED` set if it did. Two registers hold it and the value.
type Long<T> = (T, usize);

const FAILED: usize = 1 << (usize::BITS - 1);
const MORE: u8 = 0x80;
const SIGN: u8 = 0x40;

impl<'a> Reader<'a> {
    #[inline(always)]
    pub(crate) fn new(bytes: &'a [u8], position: usize) -> Self {
        Self { bytes, position }
    }

    #[inline(always)]
    pub(crate) fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    #[inline(always)]
    pub(crate) fn position(&self) -> usize {
        self.position
    }

    #[inline(always)]
    pub(crate) fn set_position(&mut self, position: usize) {
        self.position = position;
    }

    #[inline(always)]
    pub(crate) fn remaining(&self) -> usize {
        self.bytes.len() - self.position
    }

    #[inline(always)]
    pub(crate) fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    #[inline(always)]
    pub(crate) fn u8(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.position += 1;
        Some(byte)
    }

    /// A number of one byte.
    #[inline(always)]
    pub(crate) fn u7(&mut self) -> Option<u8> {
        self.u8().filter(|byte| byte & MORE == 0)
    }

    #[inline(always)]
    pub(crate) fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        let array = *self.bytes.get(self.position..)?.first_chunk()?;
        self.position += N;
        Some(array)
    }

    #[inline]
    pub(crate) fn slice(&mut self, length: usize) -> Option<&'a [u8]> {
        let slice = self.bytes.get(self.position..)?.get(..length)?;
        self.position += length;
        Some(slice)
    }

    #[inline(always)]
    pub(crate) fn u32(&mut self) -> Option<u32> {
        self.number(u32::from, |bytes, position| {
            let (value, end) = long_unsigned::<32>(bytes, position);
            (value as u32, end)
        })
    }

    #[inline(always)]
    pub(crate) fn u64(&mut self) -> Option<u64> {
        self.number(u64::from, long_unsigned::<64>)
    }

    #[inline(always)]
    pub(crate) fn i32(&mut self) -> Option<i32> {
        self.number(
            |byte| sign_extend7(byte).into(),
            |bytes, position| {
                let (value, end) = long_signed::<32>(bytes, position);
                (value as i32, end)
            },
        )
    }

    #[inline(always)]
    pub(crate) fn i64(&mut self) -> Option<i64> {
        self.number(|byte| sign_extend7(byte).into(), long_signed::<64>)
    }

    #[inline(always)]
    fn number<T>(
        &mut self,
        short: impl FnOnce(u8) -> T,
        long: impl FnOnce(&'a [u8], usize) -> Long<T>,
    ) -> Option<T> {
        if let Some(byte) = self.peek()
            && byte & MORE == 0
        {
            self.position += 1;
            return Some(short(byte));
        }
        let (value, end) = long(self.bytes, self.position);
        self.position = end & !FAILED;
        (end & FAILED == 0).then_some(value)
    }
}

#[inline(always)]
pub(crate) const fn sign_extend7(byte: u8) -> i8 {
    (byte << 1) as i8 >> 1
}

/// The low 7 bits of each byte, and the last byte.
#[inline(always)]
fn groups<const BITS: u32>(bytes: &[u8], mut position: usize) -> Long<(u64, u32, u8)> {
    if let Some(&chunk) = bytes.get(position..).and_then(<[u8]>::first_chunk) {
        let word = u64::from_le_bytes(chunk);
        let ends = !word & 0x80_8080_8080;
        if ends != 0 {
            let length = ends.trailing_zeros() / 8 + 1;
            let word = word & u64::MAX >> (64 - 8 * length);
            let value = (0..5).fold(0, |value, i| value | word >> i & 0x7f << (7 * i));
            let last = (word >> (8 * length - 8)) as u8;
            return ((value, 7 * length - 7, last), position + length as usize);
        }
    }
    let mut value = 0;
    let mut shift = 0;
    while shift < BITS {
        let Some(&byte) = bytes.get(position) else {
            break;
        };
        position += 1;
        value |= u64::from(byte & !MORE) << shift;
        if byte & MORE == 0 {
            return ((value, shift, byte), position);
        }
        shift += 7;
    }
    ((0, 0, 0), position | FAILED)
}

#[inline(never)]
fn long_unsigned<const BITS: u32>(bytes: &[u8], position: usize) -> Long<u64> {
    let ((value, shift, last), end) = groups::<BITS>(bytes, position);
    let too_large = BITS - shift < 7 && last >> (BITS - shift) != 0;
    (value, if too_large { end | FAILED } else { end })
}

#[inline(never)]
fn long_signed<const BITS: u32>(bytes: &[u8], position: usize) -> Long<i64> {
    let ((value, shift, last), end) = groups::<BITS>(bytes, position);
    let too_large = BITS - shift < 7 && !matches!(sign_extend7(last) >> (BITS - shift - 1), 0 | -1);
    let extension = if last & SIGN != 0 && shift + 7 < 64 {
        u64::MAX << (shift + 7)
    } else {
        0
    };
    let value = (value | extension) as i64;
    (value, if too_large { end | FAILED } else { end })
}

#[cfg(test)]
mod tests {
    use super::Reader;

    fn read<'a, T>(
        bytes: &'a [u8],
        number: fn(&mut Reader<'a>) -> Option<T>,
    ) -> (Option<T>, usize) {
        let mut reader = Reader::new(bytes, 0);
        (number(&mut reader), reader.position())
    }

    /// In exactly `length` bytes.
    fn encode(value: i128, length: usize) -> Vec<u8> {
        let more = |i| if i + 1 < length { 0x80 } else { 0 };
        (0..length)
            .map(|i| (value >> (7 * i)) as u8 & 0x7f | more(i))
            .collect()
    }

    #[test]
    fn numbers_of_every_length() {
        let powers = (0..70).map(|bit| 1i128 << bit);
        for value in powers.flat_map(|power| [power - 1, power, -power, -power - 1]) {
            for length in 1..=11 {
                let bytes = encode(value, length);
                let bits = 7 * length as u32;
                let unsigned = value & ((1 << bits) - 1);
                let signed = value << (128 - bits) >> (128 - bits);
                let (short, long) = (length <= 5, length <= 10);
                let expected = u32::try_from(unsigned).ok().filter(|_| short);
                assert_eq!(read(&bytes, Reader::u32), (expected, length.min(5)));
                let expected = i32::try_from(signed).ok().filter(|_| short);
                assert_eq!(read(&bytes, Reader::i32), (expected, length.min(5)));
                let expected = u64::try_from(unsigned).ok().filter(|_| long);
                assert_eq!(read(&bytes, Reader::u64), (expected, length.min(10)));
                let expected = i64::try_from(signed).ok().filter(|_| long);
                assert_eq!(read(&bytes, Reader::i64), (expected, length.min(10)));
            }
        }
    }

    #[test]
    fn the_end_comes_early() {
        assert_eq!(read(&[], Reader::u32), (None, 0));
        assert_eq!(read(&[0x80, 0x80], Reader::i64), (None, 2));
        assert_eq!(read(&[1, 2, 3], Reader::array::<4>), (None, 0));
        assert_eq!(read(&[0x80], Reader::u7), (None, 1));
    }
}
