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
    let [b' ', rest @ ..] = rest else {
        return Err(ParseError::Malformed);
    };
    // Three digits, and the byte that shows there is no fourth.
    let [hundreds, tens, ones, after_status @ ..] = skip_spaces(rest) else {
        return Err(ParseError::Incomplete);
    };
    if after_status.is_empty() {
        return Err(ParseError::Incomplete);
    }
    let status_code = u16::from(digit(*hundreds)?) * 100
        + u16::from(digit(*tens)?) * 10
        + u16::from(digit(*ones)?);

    let (reason, mut rest) = line(after_status)?;
    if !matches!(reason, [] | [b' ', ..]) {
        return Err(ParseError::Malformed);
    }
    let reason = skip_spaces(reason);

    let mut header_count = 0;
    let mut has_folded_line = false;
    loop {
        match rest {
            [] | [b'\r'] => return Err(ParseError::Incomplete),
            [b'\r', b'\n', after @ ..] | [b'\n', after @ ..] => {
                rest = after;
                break;
            }
            [b'\r', ..] => return Err(ParseError::Malformed),
            _ => {}
        }
        // A folded line takes a slot too, so that it counts towards the limit.
        let Some(slot) = headers.get_mut(header_count) else {
            return Err(ParseError::Malformed);
        };
        header_count += 1;
        if header_count > 1 && matches!(rest, [b' ' | b'\t', ..]) {
            has_folded_line = true;
            (_, rest) = line(rest)?;
            continue;
        }
        let (name, after_colon) = field_name(rest)?;
        let value_start = skip_blanks(after_colon);
        if value_start.is_empty() {
            return Err(ParseError::Incomplete);
        }
        let value;
        (value, rest) = line(value_start)?;
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

/// `HTTP/1.x`, and what follows it, which is not empty.
fn http_version(buf: &[u8]) -> Result<(u8, &[u8]), ParseError> {
    let Some(([name @ .., minor], rest @ [_, ..])) = buf.split_first_chunk::<8>() else {
        return Err(ParseError::Incomplete);
    };
    if name != b"HTTP/1." {
        return Err(ParseError::Malformed);
    }
    Ok((digit(*minor)?, rest))
}

fn digit(byte: u8) -> Result<u8, ParseError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        _ => Err(ParseError::Malformed),
    }
}

/// The name before the colon, and what follows the colon.
fn field_name(buf: &[u8]) -> Result<(&[u8], &[u8]), ParseError> {
    // Nearly every name is letters, digits and hyphens, and that takes far fewer compares than all of `is_token`.
    let common = index_of(buf, |byte| {
        !(byte.is_ascii_alphabetic() | byte.is_ascii_digit() | (byte == b'-'))
    })
    .ok_or(ParseError::Incomplete)?;
    let uncommon = buf
        .get(common..)
        .and_then(|rest| rest.iter().position(|&byte| !is_token(byte)))
        .ok_or(ParseError::Incomplete)?;
    match buf.split_at_checked(common + uncommon) {
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
/// is a tab.
fn line(buf: &[u8]) -> Result<(&[u8], &[u8]), ParseError> {
    let len = index_of(buf, |byte| (byte < b' ') & (byte != b'\t') | (byte == 0x7f))
        .ok_or(ParseError::Incomplete)?;
    match buf.split_at_checked(len) {
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
