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
    /// Decodes the next piece of the body in place. The trailer section is read and dropped.
    ///
    /// A caller that decodes again after a status other than [`ChunkedStatus::Incomplete`] gets what picohttpparser
    /// gave it: the decoder goes on from the state it stopped in. Both clients can do so. After
    /// [`ChunkedStatus::Complete`] that state is the start of a line of the trailer section.
    ///
    /// Only CRLF ends a chunk's size line and its data; a line of the trailer section may end in LF alone. A chunk
    /// extension is dropped unread, and no whitespace may come between it and the size, as in llhttp (Node.js).
    pub fn decode(&mut self, buf: &mut [u8]) -> Decoded {
        let (mut src, mut dst) = (0, 0);
        // A local, and an `if` per state in the order in which they follow each other: going on to the next state is
        // then falling through, where a `match` in a loop jumps through a table for every byte.
        let mut state = self.state;
        let status = 'decode: loop {
            /// Reads this byte and nothing else.
            macro_rules! expect {
                ($byte:literal) => {
                    match buf.get(src) {
                        None => break 'decode ChunkedStatus::Incomplete,
                        Some($byte) => src += 1,
                        Some(_) => break 'decode ChunkedStatus::Malformed,
                    }
                };
            }
            if state == State::Size {
                loop {
                    let Some(&byte) = buf.get(src) else {
                        break 'decode ChunkedStatus::Incomplete;
                    };
                    let Some(digit) = hex_digit(byte) else {
                        // LF is for `State::Extension` to refuse, which is then the state after the error.
                        if self.size_digits == 0 || !matches!(byte, b';' | b'\r' | b'\n') {
                            break 'decode ChunkedStatus::Malformed;
                        }
                        break;
                    };
                    if self.size_digits == MAX_SIZE_DIGITS {
                        break 'decode ChunkedStatus::Malformed;
                    }
                    self.chunk_remaining = (self.chunk_remaining << 4) | usize::from(digit);
                    self.size_digits += 1;
                    src += 1;
                }
                self.size_digits = 0;
                state = State::Extension;
            }
            if state == State::Extension {
                loop {
                    match buf.get(src) {
                        None => break 'decode ChunkedStatus::Incomplete,
                        Some(b'\r') => break,
                        Some(b'\n') => break 'decode ChunkedStatus::Malformed,
                        Some(_) => src += 1,
                    }
                }
                src += 1;
                state = State::SizeLineFeed;
            }
            if state == State::SizeLineFeed {
                expect!(b'\n');
                state = if self.chunk_remaining == 0 {
                    State::TrailerLineStart
                } else {
                    State::Data
                };
            }
            if state == State::Data {
                let len = self.chunk_remaining.min(buf.len() - src);
                if dst != src {
                    buf.copy_within(src..src + len, dst);
                }
                src += len;
                dst += len;
                self.chunk_remaining -= len;
                if self.chunk_remaining != 0 {
                    break ChunkedStatus::Incomplete;
                }
                state = State::DataCarriageReturn;
            }
            if state == State::DataCarriageReturn {
                expect!(b'\r');
                state = State::DataLineFeed;
            }
            if state == State::DataLineFeed {
                expect!(b'\n');
                state = State::Size;
                continue;
            }
            if state == State::TrailerLineStart {
                let first = loop {
                    match buf.get(src) {
                        None => break 'decode ChunkedStatus::Incomplete,
                        Some(b'\r') => src += 1,
                        Some(&byte) => break byte,
                    }
                };
                src += 1;
                if first == b'\n' {
                    break ChunkedStatus::Complete {
                        trailing: buf.len() - src,
                    };
                }
                state = State::TrailerLine;
            }
            // `State::TrailerLine`
            loop {
                let Some(&byte) = buf.get(src) else {
                    break 'decode ChunkedStatus::Incomplete;
                };
                src += 1;
                if byte == b'\n' {
                    break;
                }
            }
            state = State::TrailerLineStart;
        };
        self.state = state;
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
