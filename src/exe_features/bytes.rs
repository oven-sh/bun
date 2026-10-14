//! Checked access to the bytes of an executable, and the numbers of a table.

use crate::{Error, Result};

fn array<const N: usize>(bytes: &[u8], at: usize) -> Result<[u8; N]> {
    bytes
        .get(at..)
        .and_then(|b| b.first_chunk::<N>())
        .copied()
        .ok_or(Error::InvalidExecutable)
}

fn array_mut<const N: usize>(bytes: &mut [u8], at: usize) -> Result<&mut [u8; N]> {
    bytes
        .get_mut(at..)
        .and_then(|b| b.first_chunk_mut::<N>())
        .ok_or(Error::InvalidExecutable)
}

pub(crate) fn u8_at(bytes: &[u8], at: usize) -> Result<u8> {
    bytes.get(at).copied().ok_or(Error::InvalidExecutable)
}
pub(crate) fn u16_at(bytes: &[u8], at: usize) -> Result<u16> {
    array(bytes, at).map(u16::from_le_bytes)
}
pub(crate) fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    array(bytes, at).map(u32::from_le_bytes)
}
pub(crate) fn i32_at(bytes: &[u8], at: usize) -> Result<i32> {
    array(bytes, at).map(i32::from_le_bytes)
}
pub(crate) fn u64_at(bytes: &[u8], at: usize) -> Result<u64> {
    array(bytes, at).map(u64::from_le_bytes)
}
/// A 64-bit field of `file` that is an offset or a size in it, so no more than it is long.
pub(crate) fn usize_at(file: &[u8], at: usize) -> Result<usize> {
    match u64_at(file, at)? {
        value if value <= file.len() as u64 => Ok(value as usize),
        _ => Err(Error::InvalidExecutable),
    }
}

/// `a - b`, of numbers that the headers of the executable say.
pub(crate) fn minus(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(Error::InvalidExecutable)
}

pub(crate) fn put_u16(bytes: &mut [u8], at: usize, value: u16) -> Result<()> {
    *array_mut(bytes, at)? = value.to_le_bytes();
    Ok(())
}
pub(crate) fn put_u32(bytes: &mut [u8], at: usize, value: u32) -> Result<()> {
    *array_mut(bytes, at)? = value.to_le_bytes();
    Ok(())
}
pub(crate) fn put_u64(bytes: &mut [u8], at: usize, value: u64) -> Result<()> {
    *array_mut(bytes, at)? = value.to_le_bytes();
    Ok(())
}

pub(crate) fn slice(bytes: &[u8], at: usize, length: usize) -> Result<&[u8]> {
    bytes
        .get(at..)
        .and_then(|b| b.get(..length))
        .ok_or(Error::InvalidExecutable)
}
pub(crate) fn slice_mut(bytes: &mut [u8], at: usize, length: usize) -> Result<&mut [u8]> {
    bytes
        .get_mut(at..)
        .and_then(|b| b.get_mut(..length))
        .ok_or(Error::InvalidExecutable)
}

/// `value + delta`, for an address or the contents of a field.
pub(crate) fn offset(value: u64, delta: i64) -> u64 {
    value.wrapping_add_signed(delta)
}

/// The numbers of a table: LEB128.
pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub(crate) fn byte(&mut self) -> Result<u8> {
        let (&first, rest) = self.bytes.split_first().ok_or(Error::InvalidTable)?;
        self.bytes = rest;
        Ok(first)
    }

    pub(crate) fn unsigned(&mut self) -> Result<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = self.byte()?;
            value |= u64::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                return Ok(value);
            }
        }
        Err(Error::InvalidTable)
    }

    pub(crate) fn signed(&mut self) -> Result<i64> {
        let value = self.unsigned()?;
        Ok((value >> 1).cast_signed() ^ -((value & 1).cast_signed()))
    }

    pub(crate) fn u32(&mut self) -> Result<u32> {
        u32::try_from(self.unsigned()?).map_err(|_| Error::InvalidTable)
    }

    /// A count of things that each take at least a byte, so that a corrupt one cannot ask for more memory than the table has.
    pub(crate) fn count(&mut self) -> Result<usize> {
        usize::try_from(self.unsigned()?).map_err(|_| Error::InvalidTable)
    }

    pub(crate) fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let (taken, rest) = self
            .bytes
            .split_at_checked(length)
            .ok_or(Error::InvalidTable)?;
        self.bytes = rest;
        Ok(taken)
    }

    pub(crate) fn blob(&mut self) -> Result<&'a [u8]> {
        let length = self.count()?;
        self.take(length)
    }
}

#[cfg(feature = "tool")]
#[derive(Default)]
pub(crate) struct Writer {
    pub(crate) bytes: Vec<u8>,
}

#[cfg(feature = "tool")]
impl Writer {
    pub(crate) fn unsigned(&mut self, mut value: u64) {
        while value >= 0x80 {
            self.bytes.push(value as u8 | 0x80);
            value >>= 7;
        }
        self.bytes.push(value as u8);
    }

    pub(crate) fn signed(&mut self, value: i64) {
        self.unsigned(((value << 1) ^ (value >> 63)).cast_unsigned());
    }

    pub(crate) fn blob(&mut self, bytes: &[u8]) {
        self.unsigned(bytes.len() as u64);
        self.bytes.extend_from_slice(bytes);
    }
}
