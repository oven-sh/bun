//! The tokens of a text, all found before the first one is used.
//!
//! Reading a token where the one before it ends makes a chain in which every step waits for the last one. Here the
//! places where tokens can start come from bitmaps of the whole text, so no token waits for another.
//!
//! The rules are those of the lexer in `parser.rs`. What that refuses is [`Kind::Invalid`] here.

use super::parser::read_escape;
use bun_core::strings;
use bun_highway::ScannerStops;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Kind {
    /// White space and commas. Not a token.
    Ignored,
    // What a byte starts that more than the byte has to be looked at for. Not tokens.
    Hash,
    Quote,
    Dot,
    Digit,
    ByteOrderMark,
    /// No token starts here. It's the last token but [`Kind::End`].
    Invalid,
    /// From the `#` to the end of the line.
    Comment,
    End,
    // Tokens that their first byte tells.
    Bang,
    Dollar,
    Amp,
    ParenL,
    ParenR,
    Colon,
    Equals,
    At,
    BracketL,
    BracketR,
    BraceL,
    Pipe,
    BraceR,
    Name,
    // The others.
    Spread,
    Number,
    /// Printable ASCII without a backslash.
    String,
    /// Without a backslash.
    StringToMeasure,
    StringWithEscapes,
    BlockString,
    /// One that's written the way it's printed where it's indented like the quotes at its end: the quotes on lines of
    /// their own, every line indented at least like them and one no further, no empty line next to the quotes, no white
    /// space at the end of a line.
    BlockStringOnLines,
}

const KINDS: [Kind; 256] = {
    let mut kinds = [Kind::Invalid; 256];
    let mut byte = 0;
    while byte < 256 {
        kinds[byte] = match byte as u8 {
            b'\t' | b' ' | b',' | b'\n' | b'\r' => Kind::Ignored,
            b'#' => Kind::Hash,
            b'"' => Kind::Quote,
            b'.' => Kind::Dot,
            b'0'..=b'9' | b'-' => Kind::Digit,
            0xEF => Kind::ByteOrderMark,
            b'!' => Kind::Bang,
            b'$' => Kind::Dollar,
            b'&' => Kind::Amp,
            b'(' => Kind::ParenL,
            b')' => Kind::ParenR,
            b':' => Kind::Colon,
            b'=' => Kind::Equals,
            b'@' => Kind::At,
            b'[' => Kind::BracketL,
            b']' => Kind::BracketR,
            b'{' => Kind::BraceL,
            b'|' => Kind::Pipe,
            b'}' => Kind::BraceR,
            b'a'..=b'z' | b'A'..=b'Z' | b'_' => Kind::Name,
            _ => Kind::Invalid,
        };
        byte += 1;
    }
    kinds
};

#[derive(Copy, Clone)]
pub(super) struct Token {
    pub(super) kind: Kind,
    /// How many bytes between the token before it, or the start of the text, and this one are neither spaces nor tabs.
    /// 255 stands for more.
    pub(super) ignored_before: u8,
    pub(super) start: u32,
    pub(super) end: u32,
}

impl Token {
    pub(super) fn end_of(text: &[u8]) -> Token {
        Token {
            kind: Kind::End,
            ignored_before: 255,
            start: text.len() as u32,
            end: text.len() as u32,
        }
    }
}

pub(super) fn end_of_comment(text: &[u8], start: usize) -> usize {
    let rest = text.get(start..).unwrap_or_default();
    start + strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len())
}

fn end_of_digits(text: &[u8], start: usize) -> Option<usize> {
    let rest = text.get(start..).unwrap_or_default();
    match rest.iter().take_while(|byte| byte.is_ascii_digit()).count() {
        0 => None,
        count => Some(start + count),
    }
}

pub(super) fn end_of_number(text: &[u8], start: usize) -> Option<usize> {
    let byte = |at: usize| text.get(at).copied();
    let mut at = start;
    if byte(at) == Some(b'-') {
        at += 1;
    }
    if byte(at) == Some(b'0') {
        at += 1;
        if byte(at).is_some_and(|byte| byte.is_ascii_digit()) {
            return None;
        }
    } else {
        at = end_of_digits(text, at)?;
    }
    if byte(at) == Some(b'.') {
        at = end_of_digits(text, at + 1)?;
    }
    if matches!(byte(at), Some(b'E' | b'e')) {
        at += 1;
        if matches!(byte(at), Some(b'+' | b'-')) {
            at += 1;
        }
        at = end_of_digits(text, at)?;
    }
    match byte(at) {
        Some(byte) if byte == b'.' || KINDS[byte as usize] == Kind::Name => None,
        _ => Some(at),
    }
}

/// Returns the end of the name at `start`.
fn end_of_long_name(stops: ScannerStops<'_>, start: usize) -> usize {
    let end = stops.after_name.next(start);
    // A `$` ends it earlier. The next stop of `in_string` can be as far away as the end of the text, so it's only
    // looked for in the name.
    let mut at = start;
    while at < end {
        match stops.in_string.run(at) as usize {
            run @ ..57 => return end.min(at + run),
            _ => at += 56,
        }
    }
    end
}

/// Returns the end of the block string at `start`, and how many blanks or tabs are in front of the quotes at its end if
/// it's a [`Kind::BlockStringOnLines`].
#[inline(never)]
pub(super) fn end_of_block_string(
    text: &[u8],
    stops: ScannerStops<'_>,
    start: usize,
) -> Option<(usize, Option<usize>)> {
    let content_start = start + 3;
    let mut is_on_lines = true;
    // Of the lines that are more than white space, behind the first line: how far the one is indented that's indented
    // the least, and whether the line before this one is one of them.
    let (mut common_indent, mut follows_text) = (usize::MAX, false);
    let mut line_start = content_start;
    let mut at = content_start;
    loop {
        at = stops.in_string.next(at);
        match *text.get(at)? {
            b'\n' => {
                let len = at - line_start;
                let indent = (stops.after_blanks.run(line_start) as usize).min(len);
                if line_start == content_start {
                    is_on_lines &= len == 0;
                } else {
                    // An empty line follows the quotes, or the line ends with white space.
                    let is_first = line_start == content_start + 1;
                    is_on_lines &= len > indent || (len == 0 && !is_first);
                    is_on_lines &= len == 0 || !matches!(text[at - 1], b' ' | b'\t');
                    follows_text = len > indent;
                    if follows_text {
                        common_indent = common_indent.min(indent);
                    }
                }
                line_start = at + 1;
                at += 1;
            }
            b'"' if text[at..].starts_with(b"\"\"\"") => {
                // `\"""` doesn't end the string.
                if at > content_start && text[at - 1] == b'\\' {
                    at += 3;
                    continue;
                }
                let len = at - line_start;
                is_on_lines &= follows_text
                    && len == common_indent
                    && stops.after_blanks.run(line_start) as usize == len
                    && len < 56;
                return Some((at + 3, is_on_lines.then_some(len)));
            }
            _ => at += 1,
        }
    }
}

/// Returns the kind and the end of the token at `start`, whose first byte starts a `kind`. `Ignored` is a byte order
/// mark.
#[inline(never)]
fn long_token(
    text: &[u8],
    stops: ScannerStops<'_>,
    kind: Kind,
    start: usize,
) -> Option<(Kind, usize)> {
    let rest = text.get(start..)?;
    match kind {
        Kind::Hash => Some((Kind::Comment, end_of_comment(text, start))),
        Kind::Digit => Some((Kind::Number, end_of_number(text, start)?)),
        Kind::Dot if rest.starts_with(b"...") => Some((Kind::Spread, start + 3)),
        Kind::ByteOrderMark if rest.starts_with(crate::text::BOM) => {
            Some((Kind::Ignored, start + 3))
        }
        Kind::Quote if rest.starts_with(b"\"\"\"") => {
            Some(match end_of_block_string(text, stops, start)? {
                (end, Some(_)) => (Kind::BlockStringOnLines, end),
                (end, None) => (Kind::BlockString, end),
            })
        }
        Kind::Quote => {
            let (mut at, mut kind) = (start + 1, Kind::String);
            loop {
                at = stops.in_string.next(at);
                match *text.get(at)? {
                    b'"' => return Some((kind, at + 1)),
                    b'\\' => {
                        kind = Kind::StringWithEscapes;
                        at += read_escape(&text[at..])?.1;
                    }
                    b'\n' | b'\r' => return None,
                    byte => {
                        if !matches!(byte, b'\'' | b'`' | b'$') && kind == Kind::String {
                            kind = Kind::StringToMeasure;
                        }
                        at += 1;
                    }
                }
            }
        }
        _ => None,
    }
}

/// The number of bytes that a word of a bitmap stands for.
const WORD: usize = 64;

/// Writes the tokens of `text` from `from` on, where no token goes on, to the start of `tokens`, comments among them, and
/// returns their number. The last one is [`Kind::End`]. `stops` are those of `text`, which is shorter than 4 GB.
#[inline(never)]
pub(super) fn scan(
    text: &[u8],
    stops: ScannerStops<'_>,
    from: usize,
    tokens: &mut Vec<Token>,
) -> usize {
    let word = |plane: &[u8], index: usize| {
        plane
            .get(index * 8..index * 8 + 8)
            .and_then(|bytes| bytes.try_into().ok())
            .map_or(!0, u64::from_le_bytes)
    };
    let (after_name, after_blanks, in_string) = (
        stops.after_name.bytes(),
        stops.after_blanks.bytes(),
        stops.in_string.bytes(),
    );
    // To `after_name` a `$` is part of a name. `in_string` stops at it, and at nothing else in a name.
    let not_name_at = |index: usize| word(after_name, index) | word(in_string, index);
    let mut count = 0;
    let first_word = from / WORD;
    let mut next_not_name = not_name_at(first_word);
    // Whether the last byte of the previous word is part of a name.
    let mut follows_name = 0;
    // The end of the last token that's more than a short name or a byte.
    let mut resume_at = from;
    // For `Token::ignored_before`.
    let mut ignored = 0;
    'words: for index in first_word..text.len().div_ceil(WORD) {
        let not_name = next_not_name;
        next_not_name = not_name_at(index + 1);
        let mut starts = (!not_name & ((not_name << 1) | (follows_name ^ 1)))
            | (not_name & word(after_blanks, index));
        follows_name = !not_name >> 63;
        let first = index * WORD;
        if resume_at > first {
            if resume_at >= first + WORD {
                continue;
            }
            starts &= !0 << (resume_at - first);
        }
        // Past the end of the text there are bytes that no token starts with.
        let mut padded = [0; WORD];
        let bytes: &[u8; WORD] = match text[first..].first_chunk() {
            Some(bytes) => bytes,
            None => {
                padded[..text.len() - first].copy_from_slice(&text[first..]);
                &padded
            }
        };
        while starts != 0 {
            if tokens.len() < count + WORD + 2 {
                let len = (count + WORD + 2 + text.len() / 8).max(tokens.len() * 2);
                tokens.resize(len, Token::end_of(text));
            }
            let Some(slots) = tokens[count..].first_chunk_mut::<WORD>() else {
                return 0;
            };
            let written;
            (starts, written, ignored) = short_tokens(
                bytes,
                starts,
                not_name,
                next_not_name,
                first as u32,
                slots,
                ignored,
            );
            count += written;
            if starts == 0 {
                break;
            }
            // The first of `starts` is more than a short name or a byte.
            let start = first + starts.trailing_zeros() as usize;
            let Some(&byte) = text.get(start) else {
                break 'words;
            };
            let (kind, end) = match KINDS[byte as usize] {
                Kind::Name => (Kind::Name, end_of_long_name(stops, start)),
                kind => long_token(text, stops, kind, start).unwrap_or((Kind::Invalid, start + 1)),
            };
            resume_at = end;
            starts &= match end - first {
                len @ ..WORD => !0 << len,
                _ => 0,
            };
            if kind == Kind::Ignored {
                ignored = 255;
                continue;
            }
            tokens[count] = Token {
                kind,
                ignored_before: ignored as u8,
                start: start as u32,
                end: end as u32,
            };
            count += 1;
            ignored = 0;
            if kind == Kind::Invalid {
                break 'words;
            }
        }
    }
    match tokens.get_mut(count) {
        Some(token) => *token = Token::end_of(text),
        None => tokens.push(Token::end_of(text)),
    }
    count + 1
}

/// Writes the tokens that start at the bits of `starts`, up to the first one that takes more than its first byte and
/// the bitmaps of two words to read. Returns the bits that are left, the number of tokens written, and `ignored`, which
/// is [`Token::ignored_before`] of the next token. `bytes` are the bytes of the word, the first of which is at `first`
/// in the text.
#[inline(always)]
fn short_tokens(
    bytes: &[u8; WORD],
    mut starts: u64,
    not_name: u64,
    next_not_name: u64,
    first: u32,
    slots: &mut [Token; WORD],
    mut ignored: u32,
) -> (u64, usize, u32) {
    let mut count = 0;
    while starts != 0 {
        let offset = starts.trailing_zeros();
        let byte = bytes[offset as usize % WORD];
        let kind = KINDS[byte as usize];
        // The length of the name. 0 for anything else.
        let run = ((not_name >> offset) | ((next_not_name << 1) << (63 - offset))).trailing_zeros();
        if (kind > Kind::Ignored && kind < Kind::Bang) || run == 64 {
            break;
        }
        starts &= starts - 1;
        let start = first + offset;
        let end = start + run.max(1);
        slots[count % WORD] = Token {
            kind,
            ignored_before: ignored as u8,
            start,
            end,
        };
        let is_token = kind != Kind::Ignored;
        count += usize::from(is_token);
        ignored = (ignored + 1).min(255) * u32::from(!is_token);
    }
    (starts, count, ignored)
}
