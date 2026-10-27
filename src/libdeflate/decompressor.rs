use bun_alloc::AllocError;
use bun_core::strings;
use bun_zlib::{adler32_bytes, crc32_bytes};

use crate::decompress::{Growth, Inflate, Progress, Tables};
use crate::error::{Error, Result};
use crate::{
    Encoding, GZIP_CM_DEFLATE, GZIP_FOOTER_SIZE, GZIP_ID1, GZIP_ID2, GZIP_MIN_HEADER_SIZE,
    GZIP_MIN_OVERHEAD, ZLIB_CINFO_32K_WINDOW, ZLIB_CM_DEFLATE, ZLIB_FOOTER_SIZE,
    ZLIB_MIN_HEADER_SIZE, ZLIB_MIN_OVERHEAD,
};

const GZIP_FHCRC: u8 = 0x02;
const GZIP_FEXTRA: u8 = 0x04;
const GZIP_FNAME: u8 = 0x08;
const GZIP_FCOMMENT: u8 = 0x10;
const GZIP_FRESERVED: u8 = 0xE0;

/// Decompresses any number of streams, one after the other. It keeps no state between them.
pub struct Decompressor(Box<Tables>);

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Decompressed {
    /// Where the stream ended in the input. Anything after that was not looked at.
    pub read: usize,
    pub written: usize,
}

impl Default for Decompressor {
    fn default() -> Self {
        Self::new()
    }
}

/// Where the output goes. Matches copy from it, so all of it has to be initialized memory.
trait Sink {
    fn bytes(&mut self) -> &mut [u8];
    fn growth(&self) -> Growth;
    /// Makes `bytes()` longer: `len` bytes or more, unless that takes a costlier kind of growth than `growth()` says.
    fn grow(&mut self, len: usize) -> Result<()>;
}

impl Sink for &mut [u8] {
    fn bytes(&mut self) -> &mut [u8] {
        self
    }
    fn growth(&self) -> Growth {
        Growth::None
    }
    fn grow(&mut self, _len: usize) -> Result<()> {
        Ok(())
    }
}

/// Appends to a `Vec`, lengthening it with zeros a step ahead of the output so that memory the stream does not reach stays untouched.
struct VecSink<'a> {
    vec: &'a mut Vec<u8>,
    start: usize,
    /// The most `bytes()` may grow to.
    limit: usize,
}

impl VecSink<'_> {
    const FIRST_STEP: usize = 4096;
    const MAX_STEP: usize = 256 * 1024;
}

impl Sink for VecSink<'_> {
    fn bytes(&mut self) -> &mut [u8] {
        self.vec.get_mut(self.start..).unwrap_or_default()
    }
    fn growth(&self) -> Growth {
        if self.vec.len() - self.start >= self.limit {
            Growth::None
        } else if self.vec.len() < self.vec.capacity() {
            Growth::Cheap
        } else {
            Growth::Costly
        }
    }
    fn grow(&mut self, len: usize) -> Result<()> {
        let current = self.vec.len() - self.start;
        let step = current.clamp(Self::FIRST_STEP, Self::MAX_STEP);
        let wanted = len.max(current + step).min(self.limit);
        if self.growth() == Growth::Costly {
            // A reallocation copies what was written so far, so the capacity at least doubles.
            let doubled = self.vec.capacity().saturating_mul(2) - self.start;
            self.vec
                .try_reserve_exact(doubled.max(wanted).min(self.limit) - current)
                .map_err(|_| AllocError)?;
        }
        let room = self.vec.capacity() - self.start;
        self.vec.resize(self.start + wanted.min(room), 0);
        Ok(())
    }
}

impl Decompressor {
    pub fn new() -> Self {
        Self(Box::new(Tables::new()))
    }

    /// Decompresses the stream at the start of `input` into the start of `output`.
    pub fn decompress(
        &mut self,
        input: &[u8],
        mut output: &mut [u8],
        encoding: Encoding,
    ) -> Result<Decompressed> {
        self.decompress_into(input, &mut output, encoding)
    }

    /// Appends to `out` within its spare capacity. `out` is unchanged after an error.
    pub fn decompress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
    ) -> Result<Decompressed> {
        let limit = out.capacity() - out.len();
        self.decompress_to_vec_sink(input, out, encoding, limit)
    }

    /// Replaces the contents of `out`, which grows to at most `max_len` bytes. `out` is empty after an error.
    pub fn decompress_to_vec_grow(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
        max_len: usize,
    ) -> Result<Decompressed> {
        out.clear();
        self.decompress_to_vec_sink(input, out, encoding, max_len)
    }

    fn decompress_to_vec_sink(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
        limit: usize,
    ) -> Result<Decompressed> {
        let start = out.len();
        let mut sink = VecSink {
            vec: out,
            start,
            limit,
        };
        let result = sink
            .grow(0)
            .and_then(|()| self.decompress_into(input, &mut sink, encoding));
        out.truncate(start + result.map_or(0, |decompressed| decompressed.written));
        result
    }

    fn decompress_into(
        &mut self,
        input: &[u8],
        sink: &mut impl Sink,
        encoding: Encoding,
    ) -> Result<Decompressed> {
        match encoding {
            Encoding::Deflate => self.deflate(input, sink),
            Encoding::Zlib => self.zlib(input, sink),
            Encoding::Gzip => self.gzip(input, sink),
        }
    }

    fn deflate(&mut self, input: &[u8], sink: &mut impl Sink) -> Result<Decompressed> {
        let mut inflate = Inflate::new();
        loop {
            let growth = sink.growth();
            match inflate.run(&mut self.0, input, sink.bytes(), growth)? {
                Progress::Done { read, written } => return Ok(Decompressed { read, written }),
                Progress::NeedsOutput(len) => sink.grow(len)?,
            }
        }
    }

    fn zlib(&mut self, input: &[u8], sink: &mut impl Sink) -> Result<Decompressed> {
        if input.len() < ZLIB_MIN_OVERHEAD {
            return Err(Error::BadData);
        }
        let (header, rest) = input.split_first_chunk().ok_or(Error::BadData)?;
        let header = u16::from_be_bytes(*header);
        let has_preset_dictionary = (header >> 5) & 1 != 0;
        if header % 31 != 0
            || (header >> 8) & 0xF != ZLIB_CM_DEFLATE
            || header >> 12 > ZLIB_CINFO_32K_WINDOW
            || has_preset_dictionary
        {
            return Err(Error::BadData);
        }

        let body = rest
            .get(..rest.len() - ZLIB_FOOTER_SIZE)
            .ok_or(Error::BadData)?;
        let Decompressed { read, written } = self.deflate(body, sink)?;

        let footer = rest
            .get(read..)
            .and_then(|rest| rest.first_chunk())
            .ok_or(Error::BadData)?;
        let output = sink.bytes().get(..written).ok_or(Error::BadData)?;
        if adler32_bytes(1, output) != u32::from_be_bytes(*footer) {
            return Err(Error::BadData);
        }
        Ok(Decompressed {
            read: ZLIB_MIN_HEADER_SIZE + read + ZLIB_FOOTER_SIZE,
            written,
        })
    }

    /// One member. The header's optional fields are skipped, its CRC-16 unchecked.
    fn gzip(&mut self, input: &[u8], sink: &mut impl Sink) -> Result<Decompressed> {
        if input.len() < GZIP_MIN_OVERHEAD {
            return Err(Error::BadData);
        }
        let (header, mut rest) = input
            .split_first_chunk::<GZIP_MIN_HEADER_SIZE>()
            .ok_or(Error::BadData)?;
        let [id1, id2, method, flags, ..] = *header;
        if id1 != GZIP_ID1
            || id2 != GZIP_ID2
            || method != GZIP_CM_DEFLATE
            || flags & GZIP_FRESERVED != 0
        {
            return Err(Error::BadData);
        }

        // After each field there has to be room for the footer at least.
        let skip = |rest: &mut &[u8], len: usize| {
            *rest = rest
                .get(len..)
                .filter(|rest| rest.len() >= GZIP_FOOTER_SIZE)?;
            Some(())
        };
        if flags & GZIP_FEXTRA != 0 {
            let (len, after) = rest.split_first_chunk().ok_or(Error::BadData)?;
            rest = after;
            skip(&mut rest, usize::from(u16::from_le_bytes(*len))).ok_or(Error::BadData)?;
        }
        for zero_terminated in [GZIP_FNAME, GZIP_FCOMMENT] {
            if flags & zero_terminated != 0 {
                let len = strings::index_of_char_usize(rest, 0).ok_or(Error::BadData)?;
                skip(&mut rest, len + 1).ok_or(Error::BadData)?;
            }
        }
        if flags & GZIP_FHCRC != 0 {
            skip(&mut rest, 2).ok_or(Error::BadData)?;
        }
        let header_size = input.len() - rest.len();

        let body = rest
            .get(..rest.len() - GZIP_FOOTER_SIZE)
            .ok_or(Error::BadData)?;
        let Decompressed { read, written } = self.deflate(body, sink)?;

        let footer: &[u8; GZIP_FOOTER_SIZE] = rest
            .get(read..)
            .and_then(|rest| rest.first_chunk())
            .ok_or(Error::BadData)?;
        let [c0, c1, c2, c3, s0, s1, s2, s3] = *footer;
        let output = sink.bytes().get(..written).ok_or(Error::BadData)?;
        if crc32_bytes(0, output) != u32::from_le_bytes([c0, c1, c2, c3])
            || written as u32 != u32::from_le_bytes([s0, s1, s2, s3])
        {
            return Err(Error::BadData);
        }
        Ok(Decompressed {
            read: header_size + read + GZIP_FOOTER_SIZE,
            written,
        })
    }
}
