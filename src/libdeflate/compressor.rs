use bun_alloc::AllocError;
use bun_zlib::{adler32_bytes, crc32_bytes};

use crate::compress::{Deflate, Sink, compress_bound};
use crate::error::{Error, Result};
use crate::{
    Encoding, GZIP_CM_DEFLATE, GZIP_FOOTER_SIZE, GZIP_ID1, GZIP_ID2, GZIP_MIN_HEADER_SIZE,
    ZLIB_CINFO_32K_WINDOW, ZLIB_CM_DEFLATE, ZLIB_FOOTER_SIZE, ZLIB_MIN_HEADER_SIZE,
};

pub const MIN_COMPRESSION_LEVEL: i32 = 0;
pub const MAX_COMPRESSION_LEVEL: i32 = 12;

const GZIP_XFL_SLOWEST_COMPRESSION: u8 = 0x02;
const GZIP_XFL_FASTEST_COMPRESSION: u8 = 0x04;
const GZIP_OS_UNKNOWN: u8 = 255;

/// Compresses any number of buffers at one level, one after the other. It keeps no state between them.
pub struct Compressor(Box<Deflate>);

impl Compressor {
    /// `None` if `level` is not one of [`MIN_COMPRESSION_LEVEL`] to [`MAX_COMPRESSION_LEVEL`], or if memory runs out.
    pub fn new(level: i32) -> Option<Self> {
        Some(Self(Deflate::new(u32::try_from(level).ok()?)?))
    }

    /// The most bytes that compressing `input_len` bytes can take, at any level.
    pub fn max_bytes_needed(input_len: usize, encoding: Encoding) -> usize {
        compress_bound(input_len) + Self::header_size(encoding) + Self::footer_size(encoding)
    }

    fn header_size(encoding: Encoding) -> usize {
        match encoding {
            Encoding::Deflate => 0,
            Encoding::Zlib => ZLIB_MIN_HEADER_SIZE,
            Encoding::Gzip => GZIP_MIN_HEADER_SIZE,
        }
    }

    fn footer_size(encoding: Encoding) -> usize {
        match encoding {
            Encoding::Deflate => 0,
            Encoding::Zlib => ZLIB_FOOTER_SIZE,
            Encoding::Gzip => GZIP_FOOTER_SIZE,
        }
    }

    fn header(&self, encoding: Encoding) -> ([u8; GZIP_MIN_HEADER_SIZE], usize) {
        let level = self.0.level;
        let mut header = [0; GZIP_MIN_HEADER_SIZE];
        match encoding {
            Encoding::Deflate => {}
            Encoding::Zlib => {
                let level_hint = match level {
                    0..2 => 0,
                    2..6 => 1,
                    6..8 => 2,
                    _ => 3,
                };
                let bits =
                    (ZLIB_CM_DEFLATE << 8) | (ZLIB_CINFO_32K_WINDOW << 12) | (level_hint << 6);
                let [high, low] = (bits | (31 - bits % 31)).to_be_bytes();
                [header[0], header[1]] = [high, low];
            }
            Encoding::Gzip => {
                let extra_flags = match level {
                    0..2 => GZIP_XFL_FASTEST_COMPRESSION,
                    2..8 => 0,
                    _ => GZIP_XFL_SLOWEST_COMPRESSION,
                };
                header = [
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
                ];
            }
        }
        (header, Self::header_size(encoding))
    }

    fn footer(input: &[u8], encoding: Encoding) -> ([u8; GZIP_FOOTER_SIZE], usize) {
        let mut footer = [0; GZIP_FOOTER_SIZE];
        let (first, second) = footer.split_at_mut(4);
        match encoding {
            Encoding::Deflate => {}
            Encoding::Zlib => first.copy_from_slice(&adler32_bytes(1, input).to_be_bytes()),
            Encoding::Gzip => {
                first.copy_from_slice(&crc32_bytes(0, input).to_le_bytes());
                second.copy_from_slice(&(input.len() as u32).to_le_bytes());
            }
        }
        (footer, Self::footer_size(encoding))
    }

    /// Compresses `input` into the start of `output` and returns the size of the result.
    pub fn compress(
        &mut self,
        input: &[u8],
        output: &mut [u8],
        encoding: Encoding,
    ) -> Result<usize> {
        self.compress_checked(input, output, encoding)
            .ok_or(Error::InsufficientSpace)
    }

    fn compress_checked(
        &mut self,
        input: &[u8],
        output: &mut [u8],
        encoding: Encoding,
    ) -> Option<usize> {
        let (header, header_size) = self.header(encoding);
        let footer_size = Self::footer_size(encoding);
        if encoding != Encoding::Deflate && output.len() <= header_size + footer_size {
            return None;
        }
        let (header_out, rest) = output.split_at_mut_checked(header_size)?;
        header_out.copy_from_slice(header.get(..header_size)?);

        let body_room = rest.len() - footer_size;
        let body_size = self
            .0
            .compress(input, Sink::Fixed(rest.get_mut(..body_room)?))?;

        let (footer, _) = Self::footer(input, encoding);
        rest.get_mut(body_size..)?
            .get_mut(..footer_size)?
            .copy_from_slice(footer.get(..footer_size)?);
        Some(header_size + body_size + footer_size)
    }

    /// Appends to `out`, which is unchanged after an error. Returns the number of bytes added.
    pub fn compress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
    ) -> Result<usize> {
        out.try_reserve_exact(Self::max_bytes_needed(input.len(), encoding))
            .map_err(|_| AllocError)?;
        let start = out.len();
        let (header, header_size) = self.header(encoding);
        out.extend_from_slice(header.get(..header_size).unwrap_or_default());

        let body_start = out.len();
        let Some(body_size) = self.0.compress(
            input,
            Sink::Spare {
                vec: out,
                start: body_start,
                limit: compress_bound(input.len()),
            },
        ) else {
            out.truncate(start);
            return Err(Error::InsufficientSpace);
        };
        out.truncate(body_start + body_size);

        let (footer, footer_size) = Self::footer(input, encoding);
        out.extend_from_slice(footer.get(..footer_size).unwrap_or_default());
        Ok(out.len() - start)
    }
}
