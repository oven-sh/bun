//! The gzip container (RFC 1952). DEFLATE itself is in `bun_zlib`.

use crate::error::{Error, Result};
use crate::output::Output;
use crate::reader::Dialect;
use bun_core::strings;
use bun_deflate::gzip::{
    HAS_COMMENT, HAS_EXTRA, HAS_HEADER_CRC, HAS_NAME, HEADER_LEN, MAGIC_AND_METHOD, RESERVED,
    TRAILER_LEN, UNKNOWN_SYSTEM, plain_header, trailer_for,
};
use bun_highway::crc32;
use bun_zlib::{Deflater, GZIP_ID, Inflater, deflate, inflate};

const FLAGS: usize = MAGIC_AND_METHOD.len();
/// The length of the extra field, and the CRC-16 of the header.
const SHORT_SIZE: usize = 2;

fn fixed_header_flags(fixed: &[u8; HEADER_LEN]) -> Option<u8> {
    let flags = fixed[FLAGS];
    (fixed.starts_with(&MAGIC_AND_METHOD) && flags & RESERVED == 0).then_some(flags)
}

/// All that npm looks at.
pub(crate) fn starts_with_id(data: &[u8]) -> bool {
    data.starts_with(&GZIP_ID)
}

/// Whether `data` starts like a gzip header. The optional fields are not looked at.
pub fn starts_like_header(data: &[u8]) -> bool {
    data.first_chunk::<HEADER_LEN>()
        .is_some_and(|fixed| fixed_header_flags(fixed).is_some())
}

fn is_zero(bytes: &[u8]) -> bool {
    strings::index_of_not_char(bytes, 0).is_none()
}

// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_read_support_filter_gzip.c#L120
/// Only for a header that goes on past the piece of input it starts in.
const SPILLED_HEADER_LIMIT: usize = 1024 * 1024;

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
    /// Zeros behind a member.
    Padding,
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

/// Decompresses a sequence of gzip members, checking the CRCs and the size of each.
pub struct Decoder {
    state: State,
    inflater: Inflater,
    flags: u8,
    small: [u8; HEADER_LEN],
    small_len: usize,
    /// How much of the current header is behind us.
    header_len: usize,
    /// Of the current header, up to its CRC-16.
    header_crc: u32,
    /// The current header started in an earlier piece of input.
    header_spilled: bool,
    npm: bool,
    /// Something other than zeros was found behind the last member.
    left_data: bool,
    crc: u32,
    /// Modulo 2^32, like the field it is compared with.
    size: u32,
}

impl Decoder {
    pub fn new(dialect: Dialect) -> Self {
        Self {
            state: State::Fixed,
            inflater: Inflater::new(inflate::Container::Raw),
            flags: 0,
            small: [0; HEADER_LEN],
            small_len: 0,
            header_len: 0,
            header_crc: 0,
            header_spilled: false,
            npm: dialect == Dialect::Npm,
            left_data: false,
            crc: 0,
            size: 0,
        }
    }

    /// After [`Progress::Done`]: npm may find more to decompress. Always `false` in the other dialect.
    pub(crate) fn left_data_for_npm(&self) -> bool {
        self.npm && self.left_data
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
        self.state = if from <= Field::Extra && has(HAS_EXTRA) {
            State::ExtraLength
        } else if from <= Field::Name && has(HAS_NAME) {
            State::Name
        } else if from <= Field::Comment && has(HAS_COMMENT) {
            State::Comment
        } else if from <= Field::HeaderCrc && has(HAS_HEADER_CRC) {
            State::HeaderCrc
        } else {
            self.crc = 0;
            self.size = 0;
            self.left_data = false;
            State::Body
        };
    }

    /// Fills `out` up to `limit` bytes. A call that fails appends nothing, and every later one fails too.
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
            let in_header = !matches!(self.state, State::Body | State::Trailer);
            let before_header_crc = matches!(
                self.state,
                State::Fixed | State::ExtraLength | State::Extra(_) | State::Name | State::Comment
            );
            let step = self.step(rest, eof, out, limit, &mut used);
            pos = pos.saturating_add(used);
            if before_header_crc {
                let header = rest.get(..used).unwrap_or_default();
                self.header_crc = crc32(self.header_crc, header);
            }
            if in_header {
                self.header_len = self.header_len.saturating_add(used);
                if matches!(step, Ok(Some(Progress::NeedInput))) {
                    self.header_spilled = self.header_len > 0;
                }
            }
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
        // A header that the input ends in the middle of is not one: the stream ended before it.
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
                let gathered = self.gather(HEADER_LEN, input, used);
                self.left_data |= !is_zero(input.get(..*used).unwrap_or_default());
                if !gathered {
                    return Ok(starved(self));
                }
                let Some(flags) = fixed_header_flags(&self.small) else {
                    self.state = if self.npm {
                        State::Padding
                    } else {
                        State::Done
                    };
                    return Ok(None);
                };
                self.flags = flags;
                self.next_header_field(Field::Extra);
                Ok(None)
            }
            State::ExtraLength => {
                if !self.gather(SHORT_SIZE, input, used) {
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
                    if eof && self.flags & (HAS_NAME | HAS_COMMENT | HAS_HEADER_CRC) == 0 {
                        return Err(Error::TruncatedGzip);
                    }
                    return Ok(starved(self));
                }
                self.next_header_field(Field::Name);
                Ok(None)
            }
            State::Name | State::Comment => {
                let not_a_header = |this: &mut Self| {
                    this.state = State::Done;
                    Ok(Some(Progress::Done))
                };
                let header_limit = if self.npm {
                    usize::MAX
                } else {
                    SPILLED_HEADER_LIMIT
                };
                let looked_at = if self.header_spilled {
                    let room = header_limit
                        .saturating_add(1)
                        .saturating_sub(self.header_len);
                    input.get(..room.min(input.len())).unwrap_or_default()
                } else {
                    input
                };
                let Some(end) = strings::index_of_char_usize(looked_at, 0) else {
                    *used = looked_at.len();
                    if looked_at.len() < input.len()
                        || self.header_len.saturating_add(input.len()) > header_limit
                    {
                        return not_a_header(self);
                    }
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
                if !self.gather(SHORT_SIZE, input, used) {
                    return Ok(starved(self));
                }
                if self.small[..SHORT_SIZE] != self.header_crc.to_le_bytes()[..SHORT_SIZE] {
                    return Err(Error::GzipHeaderMismatch);
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
                out.try_reserve(room)?;
                let (start, mut rest) = (out.len(), input);
                let status = self.inflater.inflate_to_vec(&mut rest, out, room);
                *used = input.len().saturating_sub(rest.len());
                let produced = out.get(start..).unwrap_or_default();
                self.crc = crc32(self.crc, produced);
                self.size = self.size.wrapping_add(produced.len() as u32);
                match status {
                    Ok(inflate::Status::StreamEnd) => {
                        self.inflater.reset();
                        self.state = State::Trailer;
                        Ok(None)
                    }
                    Ok(_) => Ok(None),
                    Err(bun_zlib::Error::Alloc(error)) => Err(Error::Alloc(error)),
                    Err(_) => Err(Error::GzipDecompressionFailed),
                }
            }
            State::Trailer => {
                if !self.gather(TRAILER_LEN, input, used) {
                    if eof {
                        return Err(Error::TruncatedGzip);
                    }
                    return Ok(Some(Progress::NeedInput));
                }
                if !self.small.starts_with(&trailer_for(self.crc, self.size)) {
                    return Err(Error::GzipTrailerMismatch);
                }
                self.state = State::Fixed;
                self.header_len = 0;
                self.header_crc = 0;
                self.header_spilled = false;
                // What follows a member is not looked at for a block that is already full.
                Ok((out.len() >= limit).then_some(Progress::OutputFull))
            }
            State::Padding => {
                self.left_data |= !is_zero(input);
                if self.left_data {
                    self.state = State::Done;
                    return Ok(None);
                }
                *used = input.len();
                Ok(starved(self))
            }
        }
    }
}

/// One gzip member with no name and no time, so the same input always gives the same bytes.
pub struct Encoder<O: Output> {
    out: O,
    deflater: Box<Deflater>,
    buffer: Vec<u8>,
    crc: u32,
    size: u32,
}

// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_write_add_filter_gzip.c#L206
/// At level 0 the room `deflate()` is shown decides where a stored block ends.
const ENCODER_BUFFER: usize = 61440;

fn compression_error(error: bun_zlib::Error) -> Error {
    match error {
        bun_zlib::Error::Alloc(error) => Error::Alloc(error),
        _ => Error::GzipCompressionFailed,
    }
}

impl<O: Output> Encoder<O> {
    /// `level` is 0 to 9.
    pub fn new(out: O, level: u8) -> Result<Self> {
        let options = deflate::Options {
            level: i32::from(level).try_into().map_err(compression_error)?,
            ..Default::default()
        };
        let mut buffer = Vec::new();
        buffer.try_reserve_exact(ENCODER_BUFFER)?;
        let extra_flags = match level {
            9 => 2,
            1 => 4,
            _ => 0,
        };
        buffer.extend_from_slice(&plain_header(extra_flags, UNKNOWN_SYSTEM));
        Ok(Self {
            out,
            deflater: Deflater::new(deflate::Container::Raw, options).map_err(compression_error)?,
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
            let flush = if finishing {
                deflate::Flush::Finish
            } else {
                deflate::Flush::None
            };
            let status = self
                .deflater
                .deflate_limited(&mut input, &mut self.buffer, room, flush)
                .map_err(compression_error)?;
            if status == deflate::Status::StreamEnd {
                return Ok(());
            }
        }
    }

    pub fn finish(mut self) -> Result<O> {
        self.drive(&[], true)?;
        self.out.write(&self.buffer)?;
        self.out.write(&trailer_for(self.crc, self.size))?;
        Ok(self.out)
    }
}

impl<O: Output> Output for Encoder<O> {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.crc = crc32(self.crc, bytes);
        self.size = self.size.wrapping_add(bytes.len() as u32);
        self.drive(bytes, false)
    }
}
