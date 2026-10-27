//! The `length, type, data, CRC` framing of a PNG file.

use crate::error::{Error, Result};
use crate::header::MAX_U31;

pub(crate) const SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

pub(crate) type Type = [u8; 4];

pub(crate) const IHDR: Type = *b"IHDR";
pub(crate) const PLTE: Type = *b"PLTE";
pub(crate) const IDAT: Type = *b"IDAT";
pub(crate) const IEND: Type = *b"IEND";
pub(crate) const TRNS: Type = *b"tRNS";
pub(crate) const ICCP: Type = *b"iCCP";
pub(crate) const BKGD: Type = *b"bKGD";
pub(crate) const HIST: Type = *b"hIST";
pub(crate) const TEXT: Type = *b"tEXt";
pub(crate) const ZTXT: Type = *b"zTXt";
pub(crate) const ITXT: Type = *b"iTXt";
pub(crate) const SPLT: Type = *b"sPLT";
pub(crate) const EXIF: Type = *b"eXIf";

pub(crate) const fn is_critical(kind: Type) -> bool {
    let [first, ..] = kind;
    first & 0x20 == 0
}

/// What is left of the file.
pub(crate) struct Reader<'a> {
    rest: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(crate) const fn new(bytes: &'a [u8]) -> Self {
        Self { rest: bytes }
    }

    pub(crate) fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let (taken, rest) = self
            .rest
            .split_at_checked(len)
            .ok_or(Error::UnexpectedEof)?;
        self.rest = rest;
        Ok(taken)
    }

    pub(crate) fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        let (taken, rest) = self
            .rest
            .split_first_chunk::<N>()
            .ok_or(Error::UnexpectedEof)?;
        self.rest = rest;
        Ok(*taken)
    }

    /// Passes over the CRC of the chunk that just ended, unchecked, and reads the next chunk's length and type.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1052
    pub(crate) fn next_header(&mut self) -> Result<(usize, Type)> {
        let _crc: [u8; 4] = self.array()?;
        let len = u32::from_be_bytes(self.array()?);
        let kind: Type = self.array()?;
        if len > MAX_U31 {
            return Err(Error::ChunkTooLong);
        }
        Ok((len as usize, kind))
    }
}

/// Appends `length, type` with the length still to come, and returns where the chunk starts.
pub(crate) fn begin(out: &mut Vec<u8>, kind: Type) -> Result<usize> {
    let start = out.len();
    out.try_reserve(8)?;
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&kind);
    Ok(start)
}

/// Everything appended since `begin()` returned `start` is the chunk's data.
pub(crate) fn end(out: &mut Vec<u8>, start: usize) -> Result<()> {
    let (length, checked) = out
        .get_mut(start..)
        .and_then(|chunk| chunk.split_first_chunk_mut::<4>())
        .ok_or(Error::ChunkTooLong)?;
    let len = u32::try_from(checked.len().saturating_sub(4)).map_err(|_| Error::ChunkTooLong)?;
    if len > MAX_U31 {
        return Err(Error::ChunkTooLong);
    }
    *length = len.to_be_bytes();
    let crc = bun_zlib::crc32_bytes(0, checked);
    out.try_reserve(4)?;
    out.extend_from_slice(&crc.to_be_bytes());
    Ok(())
}

pub(crate) fn write(out: &mut Vec<u8>, kind: Type, data: &[u8]) -> Result<()> {
    let start = begin(out, kind)?;
    out.try_reserve(data.len())?;
    out.extend_from_slice(data);
    end(out, start)
}
