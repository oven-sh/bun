//! The compressor that callers see, and the zlib and gzip wrappers it puts around a DEFLATE stream.

use bun_alloc::AllocError;
use bun_zlib::{adler32_bytes, crc32_bytes};

use crate::constants::*;
pub use crate::deflate_compress::Level;
use crate::deflate_compress::{DeflateCompressor, compress_bound};
use crate::error::{Error, Result};
use crate::output::Output;

/// What a [`Compressor`] wraps the DEFLATE stream in.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Encoding {
    /// Nothing (RFC 1951).
    Deflate,
    /// A two-byte header and an Adler-32 (RFC 1950).
    Zlib,
    /// A ten-byte header, a CRC-32 and the length (RFC 1952).
    Gzip,
}

impl Encoding {
    const fn header_size(self) -> usize {
        match self {
            Self::Deflate => 0,
            Self::Zlib => ZLIB_MIN_HEADER_SIZE,
            Self::Gzip => GZIP_MIN_HEADER_SIZE,
        }
    }

    const fn footer_size(self) -> usize {
        match self {
            Self::Deflate => 0,
            Self::Zlib => ZLIB_FOOTER_SIZE,
            Self::Gzip => GZIP_FOOTER_SIZE,
        }
    }
}

/// Compresses any number of buffers at one level, one after the other. No result depends on the buffers before it.
pub struct Compressor {
    level: Level,
    deflate: Box<DeflateCompressor>,
}

impl Compressor {
    pub fn new(level: Level) -> Result<Self, AllocError> {
        Ok(Self {
            level,
            deflate: DeflateCompressor::new(level).ok_or(AllocError)?,
        })
    }

    /// The most bytes that compressing `input_len` bytes can take, at any level.
    pub fn max_bytes_needed(input_len: usize, encoding: Encoding) -> usize {
        compress_bound(input_len).saturating_add(encoding.header_size() + encoding.footer_size())
    }

    /// The header starts the array and is `encoding.header_size()` bytes long.
    fn header(&self, encoding: Encoding) -> [u8; GZIP_MIN_HEADER_SIZE] {
        let level = self.level.get();
        match encoding {
            Encoding::Deflate => [0; _],
            Encoding::Zlib => {
                let level_hint = match level {
                    ..2 => ZLIB_FASTEST_COMPRESSION,
                    2..6 => ZLIB_FAST_COMPRESSION,
                    6..8 => ZLIB_DEFAULT_COMPRESSION,
                    8.. => ZLIB_SLOWEST_COMPRESSION,
                };
                let bits =
                    (ZLIB_CM_DEFLATE << 8) | (ZLIB_CINFO_32K_WINDOW << 12) | (level_hint << 6);
                let [high, low] = (bits | (31 - bits % 31)).to_be_bytes();
                [high, low, 0, 0, 0, 0, 0, 0, 0, 0]
            }
            Encoding::Gzip => {
                let extra_flags = match level {
                    ..2 => GZIP_XFL_FASTEST_COMPRESSION,
                    2..8 => 0,
                    8.. => GZIP_XFL_SLOWEST_COMPRESSION,
                };
                // No flags and no modification time.
                [
                    GZIP_ID1,
                    GZIP_ID2,
                    GZIP_CM_DEFLATE,
                    0,
                    0,
                    0,
                    0,
                    0,
                    extra_flags,
                    GZIP_OS_UNKNOWN,
                ]
            }
        }
    }

    /// The footer starts the array and is `encoding.footer_size()` bytes long.
    fn footer(input: &[u8], encoding: Encoding) -> [u8; GZIP_FOOTER_SIZE] {
        match encoding {
            Encoding::Deflate => [0; _],
            Encoding::Zlib => {
                let [a0, a1, a2, a3] = adler32_bytes(1, input).to_be_bytes();
                [a0, a1, a2, a3, 0, 0, 0, 0]
            }
            Encoding::Gzip => {
                let [c0, c1, c2, c3] = crc32_bytes(0, input).to_le_bytes();
                let [s0, s1, s2, s3] = (input.len() as u32).to_le_bytes();
                [c0, c1, c2, c3, s0, s1, s2, s3]
            }
        }
    }

    /// Compresses `input` into the start of `output` and returns the size of the result.
    pub fn compress(
        &mut self,
        input: &[u8],
        output: &mut [u8],
        encoding: Encoding,
    ) -> Result<usize> {
        self.compress_to_slice(input, output, encoding)
            .ok_or(Error::InsufficientSpace)
    }

    fn compress_to_slice(
        &mut self,
        input: &[u8],
        output: &mut [u8],
        encoding: Encoding,
    ) -> Option<usize> {
        let (header_size, footer_size) = (encoding.header_size(), encoding.footer_size());
        if output.len() <= header_size + footer_size {
            return None;
        }
        let (header, rest) = output.split_at_mut_checked(header_size)?;
        header.copy_from_slice(self.header(encoding).get(..header_size)?);

        let body_room = rest.len() - footer_size;
        let body_size = self
            .deflate
            .compress(input, Output::Slice(rest.get_mut(..body_room)?))?;

        rest.get_mut(body_size..)?
            .get_mut(..footer_size)?
            .copy_from_slice(Self::footer(input, encoding).get(..footer_size)?);
        Some(header_size + body_size + footer_size)
    }

    /// Appends to `out`, which is unchanged after an error. Returns the number of bytes added.
    pub fn compress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
    ) -> Result<usize> {
        out.try_reserve_exact(Self::max_bytes_needed(input.len(), encoding))?;
        let start = out.len();
        if self.append(input, out, encoding).is_none() {
            out.truncate(start);
            return Err(Error::InsufficientSpace);
        }
        Ok(out.len() - start)
    }

    fn append(&mut self, input: &[u8], out: &mut Vec<u8>, encoding: Encoding) -> Option<()> {
        out.extend_from_slice(self.header(encoding).get(..encoding.header_size())?);

        let body_start = out.len();
        let body = Output::Vec {
            vec: out,
            start: body_start,
            max_len: compress_bound(input.len()),
        };
        let body_size = self.deflate.compress(input, body)?;
        out.truncate(body_start + body_size);

        out.extend_from_slice(Self::footer(input, encoding).get(..encoding.footer_size())?);
        Some(())
    }
}
