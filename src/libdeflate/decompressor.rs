//! The decompressor that callers see, and the gzip wrapper it takes off a DEFLATE stream.

use bun_core::strings;
use bun_zlib::crc32_bytes;

use crate::constants::*;
pub use crate::deflate_decompress::ByteCounts;
use crate::deflate_decompress::{self, Tables};
use crate::error::{Error, Result};
use crate::output::Output;

/// What the DEFLATE stream comes wrapped in. Nothing gives a [`Decompressor`] a zlib stream.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Decoding {
    /// Nothing (RFC 1951).
    Deflate,
    /// One member (RFC 1952).
    Gzip,
}

/// Decompresses any number of streams, one after the other. No result depends on the streams before it.
pub struct Decompressor(Box<Tables>);

impl Default for Decompressor {
    fn default() -> Self {
        Self::new()
    }
}

/// What follows the header of the member that `input` starts with, less the size of a footer.
fn gzip_body(input: &[u8]) -> Option<&[u8]> {
    let (&[id1, id2, method, flags, ..], mut rest) =
        input.split_first_chunk::<GZIP_MIN_HEADER_SIZE>()?;
    if id1 != GZIP_ID1
        || id2 != GZIP_ID2
        || method != GZIP_CM_DEFLATE
        || flags & GZIP_FRESERVED != 0
    {
        return None;
    }
    if flags & GZIP_FEXTRA != 0 {
        let (len, after) = rest.split_first_chunk()?;
        rest = after.get(usize::from(u16::from_le_bytes(*len))..)?;
    }
    for zero_terminated in [GZIP_FNAME, GZIP_FCOMMENT] {
        if flags & zero_terminated != 0 {
            rest = rest.get(strings::index_of_char_usize(rest, 0)? + 1..)?;
        }
    }
    if flags & GZIP_FHCRC != 0 {
        rest = rest.get(2..)?;
    }
    rest.get(..rest.len().checked_sub(GZIP_FOOTER_SIZE)?)
}

impl Decompressor {
    pub fn new() -> Self {
        Self(Box::new(Tables::new()))
    }

    /// Decompresses the stream at the start of `input` into the start of `output`.
    pub fn decompress(
        &mut self,
        input: &[u8],
        output: &mut [u8],
        decoding: Decoding,
    ) -> Result<ByteCounts> {
        self.decompress_to(input, &mut Output::Slice(output), decoding)
    }

    /// Appends to `out` within its spare capacity. `out` is unchanged after an error.
    pub fn decompress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        decoding: Decoding,
    ) -> Result<ByteCounts> {
        let spare = out.capacity() - out.len();
        self.decompress_to_vec_grow(input, out, decoding, spare)
    }

    /// Appends at most `max_len` bytes to `out`, reserving more as needed. `out` holds what it held after an error.
    pub fn decompress_to_vec_grow(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        decoding: Decoding,
        max_len: usize,
    ) -> Result<ByteCounts> {
        let start = out.len();
        let mut output = Output::Vec {
            vec: out,
            start,
            max_len,
        };
        let result = self.decompress_to(input, &mut output, decoding);
        out.truncate(start + result.map_or(0, |counts| counts.written));
        result
    }

    fn decompress_to(
        &mut self,
        input: &[u8],
        output: &mut Output<'_>,
        decoding: Decoding,
    ) -> Result<ByteCounts> {
        match decoding {
            Decoding::Deflate => deflate_decompress::decompress(&mut self.0, input, output),
            Decoding::Gzip => self.gunzip(input, output),
        }
    }

    /// One member. The header's optional fields are skipped, its CRC-16 unchecked.
    fn gunzip(&mut self, input: &[u8], output: &mut Output<'_>) -> Result<ByteCounts> {
        let body = gzip_body(input).ok_or(Error::BadData)?;
        let header_size = input.len() - GZIP_FOOTER_SIZE - body.len();
        let ByteCounts { read, written } =
            deflate_decompress::decompress(&mut self.0, body, output)?;

        let footer_start = header_size + read;
        let footer = input
            .get(footer_start..)
            .and_then(|rest| rest.first_chunk());
        let &[c0, c1, c2, c3, s0, s1, s2, s3] = footer.ok_or(Error::BadData)?;
        let written_bytes = output.bytes().get(..written).ok_or(Error::BadData)?;
        if crc32_bytes(0, written_bytes) != u32::from_le_bytes([c0, c1, c2, c3])
            || written as u32 != u32::from_le_bytes([s0, s1, s2, s3])
        {
            return Err(Error::BadData);
        }
        Ok(ByteCounts {
            read: footer_start + GZIP_FOOTER_SIZE,
            written,
        })
    }
}
