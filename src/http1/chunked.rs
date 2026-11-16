use crate::byte_sets::{CONTENT, QUOTED_TEXT, TOKEN};
use crate::{Error, Result};

const MAX_SIZE_DIGITS: usize = 16;
const MAX_SIZE_LINE_LEN: usize = 16 * 1024;
const MAX_TRAILERS_LEN: u64 = 64 * 1024;
const AFTER_ALL_DATA: &[u8] = b"\r\n0\r\n\r\n";

/// What the next byte belongs to, in the order of the message.
#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
enum State {
    #[default]
    Size,
    Extension,
    QuotedExtension,
    EscapedExtension,
    SizeLf,
    Data,
    DataCr,
    DataLf,
    TrailerStart,
    TrailerName,
    TrailerValue,
    TrailerLf,
    LastLf,
    Done,
}

enum Stop {
    Invalid,
    Short,
}

/// Decodes a chunked body (RFC 9112 §7.1) read by read, dropping extensions and trailers.
#[derive(Clone, Copy, Default)]
pub struct ChunkedDecoder {
    state: State,
    /// Of the chunk size line so far.
    line_len: usize,
    /// Of the chunk's data, or of [`MAX_TRAILERS_LEN`] after the last chunk.
    remaining: u64,
}

impl ChunkedDecoder {
    /// Appends the data in `input` to `body`. Once the message has ended, returns what is left.
    pub fn decode<'a>(
        &mut self,
        mut input: &'a [u8],
        body: &mut Vec<u8>,
    ) -> Result<Option<&'a [u8]>> {
        let capacity = body.len() + input.len();
        while !self.has_whole_body() {
            let step = if self.is_in_extension() {
                self.skip_extension(input)
            } else {
                // A copy stays in registers.
                let mut copy = *self;
                let step = copy.decode_chunks(input, body, capacity);
                *self = copy;
                step
            };
            input = match step {
                Ok(rest) => rest,
                Err(Stop::Short) => return Ok(None),
                Err(Stop::Invalid) => return Err(Error::MalformedChunk),
            };
        }
        // A shortcut: few messages have trailers.
        if let (State::TrailerStart, [b'\r', b'\n', rest @ ..]) = (self.state, input) {
            self.state = State::Done;
            return Ok(Some(rest));
        }
        Ok(self.skip_trailers(input))
    }

    /// Whether the last chunk has arrived.
    pub fn has_whole_body(&self) -> bool {
        self.state >= State::TrailerStart
    }

    fn is_in_extension(&self) -> bool {
        State::Size < self.state && self.state < State::SizeLf
    }

    /// Up to an extension or the trailer section.
    #[inline(always)]
    fn decode_chunks<'a>(
        &mut self,
        mut input: &'a [u8],
        body: &mut Vec<u8>,
        capacity: usize,
    ) -> Result<&'a [u8], Stop> {
        loop {
            if self.state == State::Size {
                input = self.parse_size(input)?;
                if self.is_in_extension() {
                    return Ok(input);
                }
            }
            if self.state == State::SizeLf {
                input = expect(b'\n', input)?;
                if self.remaining == 0 {
                    self.remaining = MAX_TRAILERS_LEN;
                    self.state = State::TrailerStart;
                    return Ok(input);
                }
                self.state = State::Data;
            }
            if self.state == State::Data {
                self.line_len = 0;
                let len = usize::try_from(self.remaining).unwrap_or(usize::MAX);
                let Some((data, rest)) = input.split_at_checked(len) else {
                    append(body, input, capacity);
                    self.remaining -= input.len() as u64;
                    return Err(Stop::Short);
                };
                if body.capacity() == 0 && AFTER_ALL_DATA.starts_with(rest) {
                    // No more data in this read, so it needs no more room.
                    *body = data.to_vec();
                } else if let Some(block) = input.first_chunk::<16>()
                    && len <= block.len()
                {
                    // A copy of a fixed size needs no call.
                    let end = body.len() + len;
                    append(body, block, capacity);
                    body.truncate(end);
                } else {
                    append(body, data, capacity);
                }
                input = rest;
                self.remaining = 0;
                self.state = State::DataCr;
            }
            if self.state == State::DataCr {
                input = expect(b'\r', input)?;
                self.state = State::DataLf;
            }
            input = expect(b'\n', input)?;
            self.state = State::Size;
        }
    }

    #[inline(always)]
    fn parse_size<'a>(&mut self, mut input: &'a [u8]) -> Result<&'a [u8], Stop> {
        loop {
            let (&byte, rest) = input.split_first().ok_or(Stop::Short)?;
            input = rest;
            let Some(digit) = char::from(byte).to_digit(16) else {
                self.state = match byte {
                    _ if self.line_len == 0 => return Err(Stop::Invalid),
                    b'\r' => State::SizeLf,
                    b';' => State::Extension,
                    _ => return Err(Stop::Invalid),
                };
                return Ok(input);
            };
            if self.line_len == MAX_SIZE_DIGITS {
                return Err(Stop::Invalid);
            }
            self.line_len += 1;
            self.remaining = (self.remaining << 4) | u64::from(digit);
        }
    }

    // Inlined, it slows down the loop over small chunks.
    #[inline(never)]
    fn skip_extension<'a>(&mut self, mut input: &'a [u8]) -> Result<&'a [u8], Stop> {
        loop {
            let plain = match self.state {
                State::EscapedExtension => 0,
                _ => QUOTED_TEXT.prefix_len(input),
            };
            self.line_len += plain;
            if self.line_len > MAX_SIZE_LINE_LEN {
                return Err(Stop::Invalid);
            }
            let Some([byte, rest @ ..]) = input.get(plain..) else {
                return Err(Stop::Short);
            };
            input = rest;
            self.state = match (self.state, byte) {
                (State::Extension, b'\r') => {
                    self.state = State::SizeLf;
                    return Ok(input);
                }
                _ if !CONTENT.contains(*byte) => return Err(Stop::Invalid),
                (State::Extension, b'"') | (State::EscapedExtension, _) => State::QuotedExtension,
                (State::QuotedExtension, b'\\') => State::EscapedExtension,
                _ => State::Extension,
            };
            self.line_len += 1;
        }
    }

    /// The body is whole by now, so a byte that cannot be part of the section ends the message.
    // Inlined, it slows down the loop over small chunks.
    #[inline(never)]
    fn skip_trailers<'a>(&mut self, mut input: &'a [u8]) -> Option<&'a [u8]> {
        while self.state != State::Done {
            let (byte, rest) = input.split_first()?;
            (self.state, input) = match (self.state, byte) {
                (State::TrailerStart, b'\r') => (State::LastLf, rest),
                (State::TrailerName, b':') => (State::TrailerValue, rest),
                (State::TrailerValue, b'\r') => (State::TrailerLf, rest),
                (State::TrailerLf, b'\n') => (State::TrailerStart, rest),
                (State::LastLf, b'\n') => (State::Done, rest),
                (State::TrailerLf | State::LastLf, _) => (State::Done, input),
                (state, _) => {
                    let (len, state) = match state {
                        State::TrailerValue => (CONTENT.prefix_len(input), state),
                        _ => (TOKEN.prefix_len(input), State::TrailerName),
                    };
                    let len = self.remaining.min(len as u64);
                    self.remaining -= len;
                    let state = if len == 0 { State::Done } else { state };
                    (state, input.get(len as usize..).unwrap_or_default())
                }
            };
        }
        Some(input)
    }
}

/// Grows `body` once per read.
fn append(body: &mut Vec<u8>, data: &[u8], capacity: usize) {
    if body.capacity() - body.len() < data.len() {
        body.reserve(capacity - body.len());
    }
    body.extend_from_slice(data);
}

fn expect(expected: u8, input: &[u8]) -> Result<&[u8], Stop> {
    match input {
        [] => Err(Stop::Short),
        [byte, rest @ ..] if *byte == expected => Ok(rest),
        _ => Err(Stop::Invalid),
    }
}
