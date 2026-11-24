//! What RFC 1952 puts around a stream.

use crate::{Error, Result};

pub const HEADER_LEN: usize = 10;
pub const TRAILER_LEN: usize = 8;

pub const MAGIC_AND_METHOD: [u8; 3] = [0x1F, 0x8B, 8];

pub const HAS_HEADER_CRC: u8 = 1 << 1;
pub const HAS_EXTRA: u8 = 1 << 2;
pub const HAS_NAME: u8 = 1 << 3;
pub const HAS_COMMENT: u8 = 1 << 4;
pub const RESERVED: u8 = 0b1110_0000;

pub const UNKNOWN_SYSTEM: u8 = 255;

/// With no name and no time.
pub const fn plain_header(effort: u8, system: u8) -> [u8; HEADER_LEN] {
    let [a, b, c] = MAGIC_AND_METHOD;
    [a, b, c, 0, 0, 0, 0, 0, effort, system]
}

/// `len` is modulo 2^32.
pub const fn trailer_for(crc: u32, len: u32) -> [u8; TRAILER_LEN] {
    (crc as u64 | (len as u64) << 32).to_le_bytes()
}

pub(crate) fn header(level: u8) -> [u8; HEADER_LEN] {
    let effort = match level {
        ..2 => 4,
        2..8 => 0,
        _ => 2,
    };
    plain_header(effort, UNKNOWN_SYSTEM)
}

pub(crate) fn trailer(data: &[u8]) -> [u8; TRAILER_LEN] {
    trailer_for(bun_highway::crc32(0, data), data.len() as u32)
}

/// Returns what follows the header.
pub(crate) fn skip_header(input: &[u8]) -> Result<&[u8]> {
    let Some((&[a, b, c, flags, ..], mut rest)) = input.split_first_chunk::<HEADER_LEN>() else {
        return Err(Error::BadData);
    };
    if [a, b, c] != MAGIC_AND_METHOD || flags & RESERVED != 0 {
        return Err(Error::BadData);
    }
    if flags & HAS_EXTRA != 0 {
        let (&len, extra) = rest.split_first_chunk().ok_or(Error::BadData)?;
        let len = usize::from(u16::from_le_bytes(len));
        rest = extra.get(len..).ok_or(Error::BadData)?;
    }
    for flag in [HAS_NAME, HAS_COMMENT] {
        if flags & flag != 0 {
            let len = bun_highway::index_of_char(rest, 0).ok_or(Error::BadData)?;
            rest = rest.get(len + 1..).unwrap_or_default();
        }
    }
    if flags & HAS_HEADER_CRC != 0 {
        let header = input.get(..input.len() - rest.len()).unwrap_or_default();
        let [low, high, ..] = bun_highway::crc32(0, header).to_le_bytes();
        rest = rest.strip_prefix(&[low, high]).ok_or(Error::BadData)?;
    }
    Ok(rest)
}
