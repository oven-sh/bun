//! The `length, type, data, CRC` framing of a PNG file.

use crate::error::{Error, Result};
use crate::header::MAX_U31;

pub(crate) const SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

pub(crate) type ChunkType = [u8; 4];

pub(crate) const IHDR: ChunkType = *b"IHDR";
pub(crate) const PLTE: ChunkType = *b"PLTE";
pub(crate) const IDAT: ChunkType = *b"IDAT";
pub(crate) const IEND: ChunkType = *b"IEND";
pub(crate) const TRNS: ChunkType = *b"tRNS";
pub(crate) const ICCP: ChunkType = *b"iCCP";

pub(crate) const fn is_critical(chunk_type: ChunkType) -> bool {
    let [first, ..] = chunk_type;
    first & 0x20 == 0
}

/// What is left of the file.
pub(crate) struct Reader<'a> {
    unread: &'a [u8],
}

impl<'a> Reader<'a> {
    pub(crate) const fn new(bytes: &'a [u8]) -> Self {
        Self { unread: bytes }
    }

    pub(crate) fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let (taken, unread) = self
            .unread
            .split_at_checked(len)
            .ok_or(Error::UnexpectedEof)?;
        self.unread = unread;
        Ok(taken)
    }

    pub(crate) fn take_array<const N: usize>(&mut self) -> Result<[u8; N]> {
        let (taken, unread) = self
            .unread
            .split_first_chunk::<N>()
            .ok_or(Error::UnexpectedEof)?;
        self.unread = unread;
        Ok(*taken)
    }

    /// Passes over the CRC of the chunk that just ended, unchecked, and reads the next chunk's length and type.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1052
    pub(crate) fn next_chunk_header(&mut self) -> Result<(usize, ChunkType)> {
        let _crc: [u8; 4] = self.take_array()?;
        let len = u32::from_be_bytes(self.take_array()?);
        let chunk_type: ChunkType = self.take_array()?;
        if len > MAX_U31 {
            return Err(Error::ChunkTooLong);
        }
        Ok((len as usize, chunk_type))
    }
}

/// Appends `length, type` with the length still to come, and returns where the chunk starts.
pub(crate) fn begin(out: &mut Vec<u8>, chunk_type: ChunkType) -> Result<usize> {
    let start = out.len();
    out.try_reserve(8)?;
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&chunk_type);
    Ok(start)
}

/// Everything appended since `begin()` returned `start` is the chunk's data.
pub(crate) fn end(out: &mut Vec<u8>, start: usize) -> Result<()> {
    let (length_field, crc_input) = out
        .get_mut(start..)
        .and_then(|chunk| chunk.split_first_chunk_mut::<4>())
        .ok_or(Error::Internal)?;
    let len = u32::try_from(crc_input.len().saturating_sub(4)).map_err(|_| Error::ChunkTooLong)?;
    if len > MAX_U31 {
        return Err(Error::ChunkTooLong);
    }
    *length_field = len.to_be_bytes();
    let crc = bun_zlib::crc32_bytes(0, crc_input);
    out.try_reserve(4)?;
    out.extend_from_slice(&crc.to_be_bytes());
    Ok(())
}

pub(crate) fn write(out: &mut Vec<u8>, chunk_type: ChunkType, data: &[u8]) -> Result<()> {
    let start = begin(out, chunk_type)?;
    out.try_reserve(data.len())?;
    out.extend_from_slice(data);
    end(out, start)
}
