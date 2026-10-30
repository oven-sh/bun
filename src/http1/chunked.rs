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
    size_digits: u32,
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

const MAX_SIZE_DIGITS: u32 = usize::BITS / 4;

impl ChunkedDecoder {
    /// Decodes the next piece of the body in place. The trailer section is read and dropped.
    ///
    /// No status is the last one. A call after [`ChunkedStatus::Complete`] or [`ChunkedStatus::Malformed`] goes on from
    /// the state the decoder stopped in, as with picohttpparser, and there are callers that make one. After
    /// [`ChunkedStatus::Complete`] that state is the start of a line of the trailer section.
    ///
    /// Only CRLF ends a chunk's size line and its data; a line of the trailer section may end in LF alone. A chunk
    /// extension is dropped unread, and no whitespace may come between it and the size, as in llhttp (Node.js).
    pub fn decode(&mut self, buf: &mut [u8]) -> Decoded {
        let (mut src, mut dst) = (0, 0);
        // Locals, and an `if` per state in the order in which they follow each other: going on to the next state is
        // then falling through, where a `match` in a loop jumps through a table for every byte.
        let Self {
            mut chunk_remaining,
            mut size_digits,
            mut state,
        } = *self;
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
                let end = loop {
                    let Some(&byte) = buf.get(src) else {
                        break 'decode ChunkedStatus::Incomplete;
                    };
                    let Some(digit) = hex_digit(byte) else {
                        break byte;
                    };
                    if size_digits == MAX_SIZE_DIGITS {
                        break 'decode ChunkedStatus::Malformed;
                    }
                    chunk_remaining = (chunk_remaining << 4) | usize::from(digit);
                    size_digits += 1;
                    src += 1;
                };
                if size_digits == 0 {
                    break ChunkedStatus::Malformed;
                }
                state = match end {
                    b'\r' => {
                        src += 1;
                        State::SizeLineFeed
                    }
                    // LF is for `State::Extension` to refuse, which is then the state after the error.
                    b';' | b'\n' => State::Extension,
                    _ => break ChunkedStatus::Malformed,
                };
                size_digits = 0;
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
                state = if chunk_remaining == 0 {
                    State::TrailerLineStart
                } else {
                    State::Data
                };
            }
            if state == State::Data {
                let available = buf.len() - src;
                // Its own case, and not the smaller of the two lengths, so that a whole chunk has less to keep across
                // the call that moves it.
                if available < chunk_remaining {
                    if dst != src {
                        buf.copy_within(src.., dst);
                    }
                    src += available;
                    dst += available;
                    chunk_remaining -= available;
                    break ChunkedStatus::Incomplete;
                }
                if dst != src {
                    buf.copy_within(src..src + chunk_remaining, dst);
                }
                src += chunk_remaining;
                dst += chunk_remaining;
                chunk_remaining = 0;
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
        *self = Self {
            chunk_remaining,
            size_digits,
            state,
        };
        if dst != src && src != buf.len() {
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
