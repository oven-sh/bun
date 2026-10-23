//! The gzip container (RFC 1952). DEFLATE itself is zlib's.

use crate::error::{Error, Result};
use bun_alloc::AllocError;
use bun_core::strings;
use bun_zlib::{InflateDecoder, ReturnCode, crc32_bytes};

mod flag {
    pub(super) const HEADER_CRC: u8 = 2;
    pub(super) const EXTRA: u8 = 4;
    pub(super) const NAME: u8 = 8;
    pub(super) const COMMENT: u8 = 16;
    pub(super) const RESERVED: u8 = 0xe0;
}

const RAW_DEFLATE: core::ffi::c_int = -15;

fn fixed_header_flags(fixed: &[u8; 10]) -> Option<u8> {
    let flags = fixed[3];
    (fixed.starts_with(&[0x1f, 0x8b, 8]) && flags & flag::RESERVED == 0).then_some(flags)
}

/// Whether `data`, which is all there is, starts with a whole gzip header.
pub fn starts_with_header(data: &[u8]) -> bool {
    let Some((fixed, mut rest)) = data.split_first_chunk::<10>() else {
        return false;
    };
    let Some(flags) = fixed_header_flags(fixed) else {
        return false;
    };
    if flags & flag::EXTRA != 0 {
        let Some((len, tail)) = rest.split_first_chunk::<2>() else {
            return false;
        };
        // That the field itself is all there only matters if something is read behind it.
        rest = tail
            .get(usize::from(u16::from_le_bytes(*len))..)
            .unwrap_or_default();
        if rest.is_empty() && flags & (flag::NAME | flag::COMMENT | flag::HEADER_CRC) == 0 {
            return true;
        }
    }
    for text in [flag::NAME, flag::COMMENT] {
        if flags & text != 0 {
            let Some(end) = strings::index_of_char_usize(rest, 0) else {
                return false;
            };
            rest = rest.get(end.saturating_add(1)..).unwrap_or_default();
        }
    }
    flags & flag::HEADER_CRC == 0 || rest.len() >= 2
}

/// In the order they appear in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Field {
    Extra,
    Name,
    Comment,
    HeaderCrc,
    Body,
}

#[derive(Debug, Clone, Copy)]
enum State {
    Fixed,
    ExtraLength,
    Extra(u16),
    Name,
    Comment,
    HeaderCrc,
    Body,
    Trailer,
    Done,
    Failed(Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// All of the input was consumed and more is wanted.
    NeedInput,
    /// `out` has reached `limit`.
    OutputFull,
    /// The last member has ended. What follows it, if anything, is not gzip and is left alone.
    Done,
}

/// Decompresses a sequence of gzip members, checking the CRC-32 and the size of each.
pub struct Decoder {
    state: State,
    inflate: InflateDecoder,
    flags: u8,
    small: [u8; 10],
    small_len: usize,
    crc: u32,
    /// Modulo 2^32, like the field it is compared with.
    size: u32,
}

impl Decoder {
    pub fn new() -> Result<Self> {
        Ok(Self {
            state: State::Fixed,
            inflate: InflateDecoder::new(RAW_DEFLATE).map_err(|_| Error::Alloc(AllocError))?,
            flags: 0,
            small: [0; 10],
            small_len: 0,
            crc: 0,
            size: 0,
        })
    }

    /// Gathers `want` bytes in `small`. `false` when `input` ran out first.
    fn gather(&mut self, want: usize, input: &[u8], used: &mut usize) -> bool {
        let take = want.saturating_sub(self.small_len).min(input.len());
        if let (Some(dest), Some(src)) = (
            self.small
                .get_mut(self.small_len..self.small_len.saturating_add(take)),
            input.get(..take),
        ) {
            dest.copy_from_slice(src);
        }
        self.small_len = self.small_len.saturating_add(take);
        *used = take;
        if self.small_len < want {
            return false;
        }
        self.small_len = 0;
        true
    }

    /// Moves to the first optional field at or behind `from` that the flags announce.
    fn next_header_field(&mut self, from: Field) {
        let has = |flag: u8| self.flags & flag != 0;
        self.state = if from <= Field::Extra && has(flag::EXTRA) {
            State::ExtraLength
        } else if from <= Field::Name && has(flag::NAME) {
            State::Name
        } else if from <= Field::Comment && has(flag::COMMENT) {
            State::Comment
        } else if from <= Field::HeaderCrc && has(flag::HEADER_CRC) {
            State::HeaderCrc
        } else {
            self.crc = 0;
            self.size = 0;
            State::Body
        };
    }

    /// Appends to `out` until it holds `limit` bytes. Returns how much of `input` was consumed.
    /// A call that fails appends nothing, so an archive smaller than `limit` is checked in full
    /// before any of it is seen. From then on every call returns the same error.
    pub fn decode(
        &mut self,
        input: &[u8],
        eof: bool,
        out: &mut Vec<u8>,
        limit: usize,
    ) -> Result<(usize, Progress)> {
        let before = out.len();
        let mut pos = 0usize;
        loop {
            let rest = input.get(pos..).unwrap_or_default();
            let mut used = 0usize;
            let step = self.step(rest, eof, out, limit, &mut used);
            pos = pos.saturating_add(used);
            match step {
                Ok(None) => {}
                Ok(Some(progress)) => return Ok((pos, progress)),
                Err(error) => {
                    self.state = State::Failed(error);
                    out.truncate(before);
                    return Err(error);
                }
            }
        }
    }

    fn step(
        &mut self,
        input: &[u8],
        eof: bool,
        out: &mut Vec<u8>,
        limit: usize,
        used: &mut usize,
    ) -> Result<Option<Progress>> {
        // A header that the input ends in the middle of is not a header, so the stream ended with
        // the member before it.
        let starved = |this: &mut Self| {
            if eof {
                this.state = State::Done;
                Some(Progress::Done)
            } else {
                Some(Progress::NeedInput)
            }
        };
        match self.state {
            State::Failed(error) => Err(error),
            State::Done => Ok(Some(Progress::Done)),

            State::Fixed => {
                if !self.gather(10, input, used) {
                    return Ok(starved(self));
                }
                let Some(flags) = fixed_header_flags(&self.small) else {
                    self.state = State::Done;
                    return Ok(Some(Progress::Done));
                };
                self.flags = flags;
                self.next_header_field(Field::Extra);
                Ok(None)
            }
            State::ExtraLength => {
                if !self.gather(2, input, used) {
                    return Ok(starved(self));
                }
                self.state = State::Extra(u16::from_le_bytes([self.small[0], self.small[1]]));
                Ok(None)
            }
            State::Extra(left) => {
                let take = usize::from(left).min(input.len());
                *used = take;
                let left = left.saturating_sub(u16::try_from(take).unwrap_or(u16::MAX));
                if left > 0 {
                    self.state = State::Extra(left);
                    if eof && self.flags & (flag::NAME | flag::COMMENT | flag::HEADER_CRC) == 0 {
                        return Err(Error::TruncatedGzip);
                    }
                    return Ok(starved(self));
                }
                self.next_header_field(Field::Name);
                Ok(None)
            }
            State::Name | State::Comment => {
                let Some(end) = strings::index_of_char_usize(input, 0) else {
                    *used = input.len();
                    return Ok(starved(self));
                };
                *used = end.saturating_add(1);
                self.next_header_field(if matches!(self.state, State::Name) {
                    Field::Comment
                } else {
                    Field::HeaderCrc
                });
                Ok(None)
            }
            State::HeaderCrc => {
                if !self.gather(2, input, used) {
                    return Ok(starved(self));
                }
                self.next_header_field(Field::Body);
                Ok(None)
            }

            State::Body => {
                let room = limit.saturating_sub(out.len());
                if room == 0 {
                    return Ok(Some(Progress::OutputFull));
                }
                if input.is_empty() {
                    if eof {
                        return Err(Error::TruncatedGzip);
                    }
                    return Ok(Some(Progress::NeedInput));
                }
                let start = out.len();
                let (consumed, code) = self.inflate.step_limited(input, out, room);
                *used = consumed;
                let produced = out.get(start..).unwrap_or_default();
                self.crc = crc32_bytes(self.crc, produced);
                self.size = self.size.wrapping_add(produced.len() as u32);
                match code {
                    ReturnCode::Ok => Ok(None),
                    ReturnCode::StreamEnd => {
                        if self.inflate.reset() != ReturnCode::Ok {
                            return Err(Error::GzipDecompressionFailed);
                        }
                        self.state = State::Trailer;
                        Ok(None)
                    }
                    ReturnCode::MemError => Err(Error::Alloc(AllocError)),
                    _ => Err(Error::GzipDecompressionFailed),
                }
            }
            State::Trailer => {
                if !self.gather(8, input, used) {
                    if eof {
                        return Err(Error::TruncatedGzip);
                    }
                    return Ok(Some(Progress::NeedInput));
                }
                let [c0, c1, c2, c3, s0, s1, s2, s3, ..] = self.small;
                if u32::from_le_bytes([c0, c1, c2, c3]) != self.crc
                    || u32::from_le_bytes([s0, s1, s2, s3]) != self.size
                {
                    return Err(Error::GzipTrailerMismatch);
                }
                self.state = State::Fixed;
                Ok(None)
            }
        }
    }
}

/// Compresses into one gzip member with no name and no time in its header, so that the same input
/// always gives the same bytes.
pub struct Encoder<O: crate::writer::Output> {
    out: O,
    deflate: bun_zlib::DeflateEncoder,
    buffer: Vec<u8>,
    crc: u32,
    size: u32,
}

/// `deflate()` is shown what is left of a buffer of this size. At level 0 that decides where a
/// stored block ends, so it is part of what keeps the output stable.
const ENCODER_BUFFER: usize = 61440;
const OS_UNKNOWN: u8 = 255;

impl<O: crate::writer::Output> Encoder<O> {
    /// `level` is 0 to 9.
    pub fn new(out: O, level: u8) -> Result<Self> {
        let mut buffer = Vec::new();
        buffer
            .try_reserve_exact(ENCODER_BUFFER)
            .map_err(|_| Error::Alloc(AllocError))?;
        let extra_flags = match level {
            9 => 2,
            1 => 4,
            _ => 0,
        };
        buffer.extend_from_slice(&[0x1f, 0x8b, 8, 0, 0, 0, 0, 0, extra_flags, OS_UNKNOWN]);
        Ok(Self {
            out,
            deflate: bun_zlib::DeflateEncoder::new(i32::from(level), RAW_DEFLATE, 8, 0)
                .map_err(|_| Error::Alloc(AllocError))?,
            buffer,
            crc: 0,
            size: 0,
        })
    }

    fn drive(&mut self, mut input: &[u8], finishing: bool) -> Result<()> {
        loop {
            if self.buffer.len() >= ENCODER_BUFFER {
                self.out.write(&self.buffer)?;
                self.buffer.clear();
            }
            if !finishing && input.is_empty() {
                return Ok(());
            }
            let room = ENCODER_BUFFER.saturating_sub(self.buffer.len());
            let (used, code) = self.deflate.step_limited(
                input,
                &mut self.buffer,
                room,
                if finishing {
                    bun_zlib::FlushValue::Finish
                } else {
                    bun_zlib::FlushValue::NoFlush
                },
            );
            input = input.get(used..).unwrap_or_default();
            match code {
                ReturnCode::Ok => {}
                ReturnCode::StreamEnd => return Ok(()),
                ReturnCode::MemError => return Err(Error::Alloc(AllocError)),
                _ => return Err(Error::GzipCompressionFailed),
            }
        }
    }

    pub fn finish(mut self) -> Result<O> {
        self.drive(&[], true)?;
        self.out.write(&self.buffer)?;
        let mut trailer = [0u8; 8];
        trailer[..4].copy_from_slice(&self.crc.to_le_bytes());
        trailer[4..].copy_from_slice(&self.size.to_le_bytes());
        self.out.write(&trailer)?;
        Ok(self.out)
    }
}

impl<O: crate::writer::Output> crate::writer::Output for Encoder<O> {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.crc = crc32_bytes(self.crc, bytes);
        self.size = self.size.wrapping_add(bytes.len() as u32);
        self.drive(bytes, false)
    }
}
