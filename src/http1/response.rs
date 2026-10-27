//! The head of a response: the status line, the header fields and the empty line after them.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    Malformed,
    /// The buffer ends before the head does. Fewer than nine bytes are always this, whatever they are.
    Incomplete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Header<'a> {
    /// Never empty.
    pub name: &'a [u8],
    /// Without the spaces and tabs around it.
    pub value: &'a [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResponseHead<'a> {
    /// The `x` of `HTTP/1.x`.
    pub minor_version: u8,
    pub status_code: u16,
    /// Without the spaces before it. Whatever follows it on the line is part of it.
    pub reason: &'a [u8],
    /// How many of the caller's slots were written, from the first.
    pub header_count: usize,
    /// Bytes of the buffer the head takes up, with its empty line.
    pub len: usize,
}

/// Reads a head from the start of `buf`, one header field per slot of `headers`. More fields than slots is
/// [`ParseError::Malformed`]. On an error any number of slots may have been written.
///
/// A line may end in LF alone. A field continued on the next line (obs-fold, RFC 9112 section 5.2) is malformed, as
/// it is for Node.js, but only once the whole head is there.
pub fn parse_response<'a, H: From<Header<'a>>>(
    buf: &'a [u8],
    headers: &mut [H],
) -> Result<ResponseHead<'a>, ParseError> {
    let (minor_version, rest) = http_version(buf)?;
    let (status_code, after_status) = status_code(skip_spaces(rest))?;
    let (reason, mut rest) = reason(after_status, 0)?;

    let mut header_count = 0;
    let mut has_folded_line = false;
    loop {
        if let Some(after) = empty_line(rest)? {
            rest = after;
            break;
        }
        // A folded line takes a slot too, so that it counts towards the limit.
        let Some(slot) = headers.get_mut(header_count) else {
            return Err(ParseError::Malformed);
        };
        header_count += 1;
        if is_folded_line(rest, header_count) {
            has_folded_line = true;
            (_, rest) = line(rest, 0)?;
            continue;
        }
        let (name, after_colon) = field_name(rest, 0)?;
        let value;
        (value, rest) = line(value_start(after_colon)?, 0)?;
        *slot = H::from(Header {
            name,
            value: trim_blanks_end(value),
        });
    }
    if has_folded_line {
        return Err(ParseError::Malformed);
    }

    Ok(ResponseHead {
        minor_version,
        status_code,
        reason,
        header_count,
        len: buf.len() - rest.len(),
    })
}

/// Finds the end of a head that comes in pieces and reads no byte twice, as [`parse_response`] after each piece would.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HeadScanner {
    part: Part,
    /// Where `part` starts in the buffer.
    start: usize,
    /// How many bytes of `part` have been read and did not end it.
    known: usize,
    header_count: usize,
    has_folded_line: bool,
}

/// What [`parse_response`] reads one after the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum Part {
    #[default]
    Version,
    Status,
    Reason,
    /// The first bytes of a line after the status line, which tell what it is.
    LineStart,
    Name,
    Blanks,
    /// Or a folded line.
    Value,
}

impl HeadScanner {
    /// As [`parse_response`] of `buf` and `max_headers` slots. After `Incomplete`, the next `buf` begins with this one.
    pub fn scan(&mut self, buf: &[u8], max_headers: usize) -> Result<usize, ParseError> {
        loop {
            let part = buf.get(self.start..).unwrap_or_default();
            let (next, rest) = match self.part {
                Part::Version => (Part::Status, http_version(part)?.1),
                Part::Status => {
                    let digits = skip_spaces(part);
                    self.start = buf.len() - digits.len();
                    (Part::Reason, status_code(digits)?.1)
                }
                Part::Reason => (Part::LineStart, self.resume(reason, part)?),
                Part::LineStart => {
                    if let Some(rest) = empty_line(part)? {
                        if self.has_folded_line {
                            return Err(ParseError::Malformed);
                        }
                        // The next `buf` begins with another head.
                        *self = Self::default();
                        return Ok(buf.len() - rest.len());
                    }
                    if self.header_count >= max_headers {
                        return Err(ParseError::Malformed);
                    }
                    self.header_count += 1;
                    if is_folded_line(part, self.header_count) {
                        self.has_folded_line = true;
                        (Part::Value, part)
                    } else {
                        (Part::Name, part)
                    }
                }
                Part::Name => (Part::Blanks, self.resume(field_name, part)?),
                Part::Blanks => {
                    let value = skip_blanks(part);
                    self.start = buf.len() - value.len();
                    (Part::Value, value_start(value)?)
                }
                Part::Value => (Part::LineStart, self.resume(line, part)?),
            };
            self.part = next;
            self.start = buf.len() - rest.len();
            self.known = 0;
        }
    }

    /// How many bytes of the buffer the next call will not read.
    pub fn scanned(&self) -> usize {
        self.start + self.known
    }

    /// What follows `part`, which `read` reads without the bytes of it that are known.
    fn resume<'a>(
        &mut self,
        read: impl FnOnce(&'a [u8], usize) -> Result<(&'a [u8], &'a [u8]), ParseError>,
        part: &'a [u8],
    ) -> Result<&'a [u8], ParseError> {
        let result = read(part, self.known);
        if result == Err(ParseError::Incomplete) {
            // A CR at the end has yet to be told from the one of a CRLF.
            self.known = part.len() - usize::from(part.ends_with(b"\r"));
        }
        Ok(result?.1)
    }
}

/// The `x` of `HTTP/1.x`, and what follows the space after it.
fn http_version(buf: &[u8]) -> Result<(u8, &[u8]), ParseError> {
    let Some(([name @ .., minor], [space, rest @ ..])) = buf.split_first_chunk::<8>() else {
        return Err(ParseError::Incomplete);
    };
    if name != b"HTTP/1." || *space != b' ' {
        return Err(ParseError::Malformed);
    }
    Ok((digit(*minor)?, rest))
}

/// Three digits, and what follows them, which is not empty: its first byte shows that there is no fourth.
fn status_code(buf: &[u8]) -> Result<(u16, &[u8]), ParseError> {
    let [hundreds, tens, ones, rest @ ..] = buf else {
        return Err(ParseError::Incomplete);
    };
    if rest.is_empty() {
        return Err(ParseError::Incomplete);
    }
    let status_code = u16::from(digit(*hundreds)?) * 100
        + u16::from(digit(*tens)?) * 10
        + u16::from(digit(*ones)?);
    Ok((status_code, rest))
}

/// The reason without the spaces before it, and the bytes of the next lines. `known` is as for [`line`].
#[inline(always)]
fn reason(buf: &[u8], known: usize) -> Result<(&[u8], &[u8]), ParseError> {
    let (reason, rest) = line(buf, known)?;
    if !matches!(reason, [] | [b' ', ..]) {
        return Err(ParseError::Malformed);
    }
    Ok((skip_spaces(reason), rest))
}

/// What follows the empty line that ends the head, if `buf` starts with it.
fn empty_line(buf: &[u8]) -> Result<Option<&[u8]>, ParseError> {
    match buf {
        [] | [b'\r'] => Err(ParseError::Incomplete),
        [b'\r', b'\n', rest @ ..] | [b'\n', rest @ ..] => Ok(Some(rest)),
        [b'\r', ..] => Err(ParseError::Malformed),
        _ => Ok(None),
    }
}

/// `line` is the `header_count`th after the status line. The first has no field to continue.
fn is_folded_line(line: &[u8], header_count: usize) -> bool {
    header_count > 1 && matches!(line, [b' ' | b'\t', ..])
}

/// `after_colon` without the blanks before the value.
fn value_start(after_colon: &[u8]) -> Result<&[u8], ParseError> {
    match skip_blanks(after_colon) {
        [] => Err(ParseError::Incomplete),
        value_start => Ok(value_start),
    }
}

fn digit(byte: u8) -> Result<u8, ParseError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        _ => Err(ParseError::Malformed),
    }
}

/// The name before the colon, and what follows the colon. The first `known` bytes are known to be of the name.
#[inline(always)]
fn field_name(buf: &[u8], known: usize) -> Result<(&[u8], &[u8]), ParseError> {
    let unknown = buf.get(known..).ok_or(ParseError::Incomplete)?;
    // Nearly every name is letters, digits and hyphens, and that takes far fewer compares than all of `is_token`.
    let common = index_of(unknown, |byte| {
        !(byte.is_ascii_alphabetic() | byte.is_ascii_digit() | (byte == b'-'))
    })
    .ok_or(ParseError::Incomplete)?;
    let uncommon = unknown
        .get(common..)
        .and_then(|rest| rest.iter().position(|&byte| !is_token(byte)))
        .ok_or(ParseError::Incomplete)?;
    match buf.split_at_checked(known + common + uncommon) {
        Some((name @ [_, ..], [b':', rest @ ..])) => Ok((name, rest)),
        _ => Err(ParseError::Malformed),
    }
}

/// `tchar` of RFC 9110 section 5.6.2.
fn is_token(byte: u8) -> bool {
    // A bit per ASCII character, because the `matches!` alone compiles to an indirect jump per byte.
    const TOKENS: u128 = {
        let mut tokens = 0;
        let mut byte = 0u8;
        while byte.is_ascii() {
            if matches!(
                byte,
                b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
                    | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z'
            ) {
                tokens |= 1 << byte;
            }
            byte += 1;
        }
        tokens
    };
    byte.is_ascii() && (TOKENS >> byte) & 1 != 0
}

/// The bytes up to the end of the line, and the bytes of the next lines. The only control character a line may hold
/// is a tab. The first `known` bytes are known to be of the line, which inlined costs `parse_response` nothing.
#[inline(always)]
fn line(buf: &[u8], known: usize) -> Result<(&[u8], &[u8]), ParseError> {
    let len = buf
        .get(known..)
        .and_then(|unknown| {
            index_of(unknown, |byte| {
                ((byte < b' ') & (byte != b'\t')) | (byte == 0x7f)
            })
        })
        .ok_or(ParseError::Incomplete)?;
    match buf.split_at_checked(known + len) {
        Some((line, [b'\r', b'\n', rest @ ..] | [b'\n', rest @ ..])) => Ok((line, rest)),
        Some((_, [b'\r'])) => Err(ParseError::Incomplete),
        _ => Err(ParseError::Malformed),
    }
}

/// The first byte for which `predicate` holds. Parsing a head spends its time here.
#[inline(always)]
fn index_of(buf: &[u8], predicate: impl Fn(u8) -> bool) -> Option<usize> {
    let (blocks, tail) = buf.as_chunks::<16>();
    for (i, block) in blocks.iter().enumerate() {
        // Without a branch per byte, here or in `predicate`, this compiles to vector compares and a move-mask.
        let mut matches = 0u16;
        for (bit, &byte) in block.iter().enumerate() {
            matches |= u16::from(predicate(byte)) << bit;
        }
        if matches != 0 {
            return Some(i * 16 + matches.trailing_zeros() as usize);
        }
    }
    let in_tail = tail.iter().position(|&byte| predicate(byte))?;
    Some(blocks.len() * 16 + in_tail)
}

fn skip_spaces(mut buf: &[u8]) -> &[u8] {
    while let [b' ', rest @ ..] = buf {
        buf = rest;
    }
    buf
}

fn skip_blanks(mut buf: &[u8]) -> &[u8] {
    while let [b' ' | b'\t', rest @ ..] = buf {
        buf = rest;
    }
    buf
}

fn trim_blanks_end(mut buf: &[u8]) -> &[u8] {
    while let [rest @ .., b' ' | b'\t'] = buf {
        buf = rest;
    }
    buf
}
