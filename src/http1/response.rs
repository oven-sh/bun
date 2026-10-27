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
    let reason_at = buf.len() - after_status.len();
    let (reason, mut at) = reason(buf, reason_at, reason_at)?;

    let mut header_count = 0;
    let mut has_folded_line = false;
    loop {
        let is_folded = match line_start(buf, at, header_count)? {
            LineStart::EndOfHead(end) => {
                at = end;
                break;
            }
            LineStart::Folded => true,
            LineStart::Field => false,
        };
        // A folded line takes a slot too, so that it counts towards the limit.
        let Some(slot) = headers.get_mut(header_count) else {
            return Err(ParseError::Malformed);
        };
        header_count += 1;
        let mut name = &[][..];
        if is_folded {
            has_folded_line = true;
        } else {
            (name, at) = field_name(buf, at, at)?;
            while let Some(b' ' | b'\t') = buf.get(at) {
                at += 1;
            }
        }
        let value;
        (value, at) = line(buf, at, at)?;
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
        len: at,
    })
}

/// Finds the end of a head that comes in pieces without starting over at each, as [`parse_response`] would.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HeadScanner {
    part: Part,
    /// Where `part` starts in the buffer.
    start: usize,
    /// Where the bytes of `part` start that have not been searched for its end.
    unsearched: usize,
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
    LineStart,
    Name,
    /// With the blanks before it, or a folded line.
    Value,
}

impl HeadScanner {
    /// As [`parse_response`] of `buf` and `max_headers` slots. After `Incomplete`, the next `buf` begins with this one.
    pub fn scan(&mut self, buf: &[u8], max_headers: usize) -> Result<usize, ParseError> {
        loop {
            let Self {
                start, unsearched, ..
            } = *self;
            let (next, at) = match self.part {
                Part::Version => (Part::Status, buf.len() - http_version(buf)?.1.len()),
                Part::Status => {
                    let digits = skip_spaces(buf.get(start..).unwrap_or_default());
                    self.go_to(Part::Status, buf.len() - digits.len());
                    (Part::Reason, buf.len() - status_code(digits)?.1.len())
                }
                Part::Reason => (
                    Part::LineStart,
                    self.end_of_part(buf, reason(buf, start, unsearched))?,
                ),
                Part::LineStart => {
                    let line_start = line_start(buf, start, self.header_count)?;
                    if let LineStart::EndOfHead(end) = line_start {
                        if self.has_folded_line {
                            return Err(ParseError::Malformed);
                        }
                        // The next `buf` begins with another head.
                        *self = Self::default();
                        return Ok(end);
                    }
                    if self.header_count >= max_headers {
                        return Err(ParseError::Malformed);
                    }
                    self.header_count += 1;
                    if matches!(line_start, LineStart::Folded) {
                        self.has_folded_line = true;
                        (Part::Value, start)
                    } else {
                        (Part::Name, start)
                    }
                }
                Part::Name => (
                    Part::Value,
                    self.end_of_part(buf, field_name(buf, start, unsearched))?,
                ),
                Part::Value => (
                    Part::LineStart,
                    self.end_of_part(buf, line(buf, start, unsearched))?,
                ),
            };
            self.go_to(next, at);
        }
    }

    /// How many bytes of the buffer the next call will not read.
    pub fn scanned(&self) -> usize {
        self.unsearched
    }

    fn go_to(&mut self, part: Part, start: usize) {
        self.part = part;
        self.start = start;
        self.unsearched = start;
    }

    /// Where the part ends, from what [`line`], [`reason`] or [`field_name`] made of it.
    fn end_of_part(
        &mut self,
        buf: &[u8],
        part: Result<(&[u8], usize), ParseError>,
    ) -> Result<usize, ParseError> {
        if part == Err(ParseError::Incomplete) {
            // A CR at the end has yet to be told from the one of a CRLF.
            self.unsearched = buf.len() - usize::from(buf.ends_with(b"\r"));
        }
        Ok(part?.1)
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

/// [`line`] for the rest of the status line, without the spaces before the reason.
#[inline(always)]
fn reason(buf: &[u8], from: usize, unsearched: usize) -> Result<(&[u8], usize), ParseError> {
    let (reason, next_line) = line(buf, from, unsearched)?;
    if !matches!(reason, [] | [b' ', ..]) {
        return Err(ParseError::Malformed);
    }
    Ok((skip_spaces(reason), next_line))
}

enum LineStart {
    /// The line is empty, and ends here.
    EndOfHead(usize),
    Folded,
    Field,
}

/// What the first bytes of the line at `at` tell about it. `header_count` lines came between it and the status line.
#[inline(always)]
fn line_start(buf: &[u8], at: usize, header_count: usize) -> Result<LineStart, ParseError> {
    match buf.get(at..) {
        None | Some([] | [b'\r']) => Err(ParseError::Incomplete),
        Some([b'\r', b'\n', ..]) => Ok(LineStart::EndOfHead(at + 2)),
        Some([b'\n', ..]) => Ok(LineStart::EndOfHead(at + 1)),
        Some([b'\r', ..]) => Err(ParseError::Malformed),
        Some([b' ' | b'\t', ..]) if header_count > 0 => Ok(LineStart::Folded),
        Some(_) => Ok(LineStart::Field),
    }
}

fn digit(byte: u8) -> Result<u8, ParseError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        _ => Err(ParseError::Malformed),
    }
}

/// The name that starts at `from`, and where the byte after its colon is. `unsearched` is as for [`line`].
#[inline(always)]
fn field_name(buf: &[u8], from: usize, unsearched: usize) -> Result<(&[u8], usize), ParseError> {
    // Nearly every name is letters, digits and hyphens, and that takes far fewer compares than all of `is_token`.
    let mut end = index_of(buf, unsearched, |byte| {
        !(byte.is_ascii_alphabetic() | byte.is_ascii_digit() | (byte == b'-'))
    })
    .ok_or(ParseError::Incomplete)?;
    loop {
        match buf.get(end) {
            None => return Err(ParseError::Incomplete),
            Some(b':') => break,
            Some(&byte) if is_token(byte) => end += 1,
            Some(_) => return Err(ParseError::Malformed),
        }
    }
    match buf.get(from..end) {
        Some(name @ [_, ..]) => Ok((name, end + 1)),
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

/// The bytes from `from` up to the end of the line, and where the next line starts. The only control character a line
/// may hold is a tab. The bytes from `from` up to `unsearched` are known to be of the line.
#[inline(always)]
fn line(buf: &[u8], from: usize, unsearched: usize) -> Result<(&[u8], usize), ParseError> {
    let end = index_of(buf, unsearched, |byte| {
        ((byte < b' ') & (byte != b'\t')) | (byte == 0x7f)
    })
    .ok_or(ParseError::Incomplete)?;
    match (buf.get(from..end), buf.get(end..)) {
        (Some(line), Some([b'\r', b'\n', ..])) => Ok((line, end + 2)),
        (Some(line), Some([b'\n', ..])) => Ok((line, end + 1)),
        (_, Some([b'\r'])) => Err(ParseError::Incomplete),
        _ => Err(ParseError::Malformed),
    }
}

/// Where the first byte at or after `from` is for which `predicate` holds. Parsing a head spends its time here.
#[inline(always)]
fn index_of(buf: &[u8], from: usize, predicate: impl Fn(u8) -> bool) -> Option<usize> {
    let (blocks, tail) = buf.get(from..)?.as_chunks::<16>();
    for (i, block) in blocks.iter().enumerate() {
        let matches = matches_in(block, &predicate);
        if matches != 0 {
            return Some(from + i * 16 + matches.trailing_zeros() as usize);
        }
    }
    let in_tail = match buf.last_chunk() {
        // The bytes before the tail fill up a block, and the shift drops them again.
        Some(block) => match matches_in(block, &predicate) >> (16 - tail.len()) {
            0 => return None,
            matches => matches.trailing_zeros() as usize,
        },
        None => tail.iter().position(|&byte| predicate(byte))?,
    };
    Some(buf.len() - tail.len() + in_tail)
}

/// A bit for each byte for which `predicate` holds, the lowest for the first.
#[inline(always)]
fn matches_in(block: &[u8; 16], predicate: impl Fn(u8) -> bool) -> u32 {
    // Without a branch per byte, here or in `predicate`, this compiles to vector compares and a move-mask.
    let mut matches = 0;
    for (bit, &byte) in block.iter().enumerate() {
        matches |= u32::from(predicate(byte)) << bit;
    }
    matches
}

fn skip_spaces(mut buf: &[u8]) -> &[u8] {
    while let [b' ', rest @ ..] = buf {
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
