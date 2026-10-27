//! The chunked transfer coding (RFC 9112 section 7.1).

/// What the next byte belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum State {
    #[default]
    Size,
    Extension,
    SizeLineFeed,
    Data,
    DataCarriageReturn,
    DataLineFeed,
    TrailerLineStart,
    TrailerLine,
}

/// Takes a chunked body in pieces of any size and leaves the data of the chunks. Start with `default()`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ChunkedDecoder {
    /// Bytes of the chunk's data still to come. While the size is being read, the digits so far.
    chunk_remaining: usize,
    size_digits: u8,
    state: State,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkedStatus {
    /// The piece ended before the body did.
    Incomplete,
    /// The last chunk and the trailer section were read. `trailing` bytes of the piece come after them.
    Complete {
        trailing: usize,
    },
    Malformed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decoded {
    /// The piece now starts with this many bytes of data, whatever `status` is. The bytes that were not read, if any,
    /// directly follow them.
    pub len: usize,
    pub status: ChunkedStatus,
}

const MAX_SIZE_DIGITS: u8 = (usize::BITS / 4) as u8;

impl ChunkedDecoder {
    /// Decodes the next piece of the body in place. The trailer section is read and dropped. Nothing may be decoded
    /// after a status other than [`ChunkedStatus::Incomplete`].
    ///
    /// Only CRLF ends a chunk's size line and its data; a line of the trailer section may end in LF alone. A chunk
    /// extension is dropped unread, and no whitespace may come between it and the size, as in llhttp (Node.js).
    pub fn decode(&mut self, buf: &mut [u8]) -> Decoded {
        let (mut src, mut dst) = (0, 0);
        let status = loop {
            let Some(&byte) = buf.get(src) else {
                break ChunkedStatus::Incomplete;
            };
            match self.state {
                State::Size => match hex_digit(byte) {
                    Some(_) if self.size_digits == MAX_SIZE_DIGITS => {
                        break ChunkedStatus::Malformed;
                    }
                    Some(digit) => {
                        self.chunk_remaining = (self.chunk_remaining << 4) | usize::from(digit);
                        self.size_digits += 1;
                        src += 1;
                    }
                    None if self.size_digits != 0 && matches!(byte, b';' | b'\r') => {
                        self.size_digits = 0;
                        self.state = State::Extension;
                    }
                    None => break ChunkedStatus::Malformed,
                },
                State::Extension => match byte {
                    b'\r' => {
                        src += 1;
                        self.state = State::SizeLineFeed;
                    }
                    b'\n' => break ChunkedStatus::Malformed,
                    _ => src += 1,
                },
                State::SizeLineFeed => {
                    if byte != b'\n' {
                        break ChunkedStatus::Malformed;
                    }
                    src += 1;
                    self.state = if self.chunk_remaining == 0 {
                        State::TrailerLineStart
                    } else {
                        State::Data
                    };
                }
                State::Data => {
                    let len = self.chunk_remaining.min(buf.len() - src);
                    if dst != src {
                        buf.copy_within(src..src + len, dst);
                    }
                    src += len;
                    dst += len;
                    self.chunk_remaining -= len;
                    if self.chunk_remaining == 0 {
                        self.state = State::DataCarriageReturn;
                    }
                }
                State::DataCarriageReturn => {
                    if byte != b'\r' {
                        break ChunkedStatus::Malformed;
                    }
                    src += 1;
                    self.state = State::DataLineFeed;
                }
                State::DataLineFeed => {
                    if byte != b'\n' {
                        break ChunkedStatus::Malformed;
                    }
                    src += 1;
                    self.state = State::Size;
                }
                State::TrailerLineStart => {
                    src += 1;
                    match byte {
                        b'\r' => {}
                        b'\n' => {
                            break ChunkedStatus::Complete {
                                trailing: buf.len() - src,
                            };
                        }
                        _ => self.state = State::TrailerLine,
                    }
                }
                State::TrailerLine => {
                    src += 1;
                    if byte == b'\n' {
                        self.state = State::TrailerLineStart;
                    }
                }
            }
        };
        if dst != src {
            buf.copy_within(src.., dst);
        }
        Decoded { len: dst, status }
    }

    /// Whether the last chunk was read, so that the data is whole and only the trailer section may be cut short.
    pub fn is_in_trailers(&self) -> bool {
        matches!(self.state, State::TrailerLineStart | State::TrailerLine)
    }
}

const fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}
