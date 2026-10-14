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

/// `a + b`, of numbers that the headers of the executable say.
pub(crate) fn plus(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(Error::InvalidExecutable)
}
/// `a - b`, of numbers that the headers of the executable say.
pub(crate) fn minus(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(Error::InvalidExecutable)
}
/// A number that goes into a field of 32 bits.
pub(crate) fn narrow(value: u64) -> Result<u32> {
    u32::try_from(value).map_err(|_| Error::InvalidExecutable)
}
/// The whole pages of `range`, but for a little at either end: vector code reads a few bytes more than it was given.
pub(crate) fn whole_pages(
    range: &core::ops::Range<u64>,
    page: u64,
) -> Option<core::ops::Range<u64>> {
    let start = range
        .start
        .checked_add(64)?
        .checked_next_multiple_of(page)?;
    let pages = start..range.end.saturating_sub(64) / page * page;
    (pages.start < pages.end).then_some(pages)
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

/// A name in a field of a fixed size, padded with NUL.
pub(crate) fn fixed_name(field: &[u8]) -> &[u8] {
    core::ffi::CStr::from_bytes_until_nul(field).map_or(field, core::ffi::CStr::to_bytes)
}

/// The numbers of a table: LEB128.
pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }

    pub(crate) fn number(&mut self) -> Result<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = self.bytes.split_first().ok_or(Error::InvalidTable)?;
            self.bytes = rest;
            value |= u64::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                return Ok(value);
            }
        }
        Err(Error::InvalidTable)
    }

    /// A number of things that each take at least a byte, so no more than there are bytes left.
    pub(crate) fn count(&mut self) -> Result<usize> {
        match self.number()? {
            count if count <= self.bytes.len() as u64 => Ok(count as usize),
            _ => Err(Error::InvalidTable),
        }
    }

    /// An index into something that has `length` entries.
    pub(crate) fn index(&mut self, length: usize) -> Result<usize> {
        match self.number()? {
            index if index < length as u64 => Ok(index as usize),
            _ => Err(Error::InvalidTable),
        }
    }

    pub(crate) fn blob(&mut self) -> Result<&'a [u8]> {
        let length = self.count()?;
        let (taken, rest) = self.bytes.split_at(length);
        self.bytes = rest;
        Ok(taken)
    }
}
