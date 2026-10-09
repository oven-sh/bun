//! `yaml` 2.9: `compose/*.js`, with the options of `yaml-unist-parser`: `keepSourceTokens`, `merge`,
//! and `uniqueKeys: false`.
//!
//! Prettier rejects a text with an error, so the first one ends the composing. Warnings are nothing.
//! Of the values of scalars there is only what an error or Prettier's printer depends on.

use super::cst::{Item, SourceToken, Token, TokenType, Tree};
use crate::syntax_error::{Message, SyntaxError};
use crate::text;
use bun_core::strings;
use std::borrow::Cow;

type Result<T> = std::result::Result<T, SyntaxError>;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ScalarType {
    BlockFolded,
    BlockLiteral,
    Plain,
    QuoteDouble,
    QuoteSingle,
}

/// What `scalar.value` is, as far as anybody asks.
#[derive(Debug, Clone, PartialEq)]
enum ScalarValue {
    Null,
    Bool(bool),
    Number(f64),
    /// `scalar.source` says which.
    String,
}

#[derive(Debug)]
pub(crate) struct Pair<'t> {
    pub(crate) key: Node<'t>,
    pub(crate) value: Option<Node<'t>>,
    pub(crate) src_token: Option<&'t Item>,
}

#[derive(Debug)]
pub(crate) enum SeqItem<'t> {
    Node(Node<'t>),
    /// In a sequence with the tag `!!omap` or `!!pairs`.
    Pair(Pair<'t>),
}

#[derive(Debug)]
pub(crate) enum NodeKind<'t> {
    Alias,
    Scalar(ScalarType),
    Map { flow: bool, items: Vec<Pair<'t>> },
    Seq { flow: bool, items: Vec<SeqItem<'t>> },
}

#[derive(Debug)]
pub(crate) struct Node<'t> {
    pub(crate) kind: NodeKind<'t>,
    pub(crate) range: [u32; 3],
    /// `tag === "tag:yaml.org,2002:set"`
    pub(crate) has_set_tag: bool,
    has_tag: bool,
    /// Where the name of the anchor is.
    pub(crate) anchor: Option<(u32, u32)>,
    pub(crate) src_token: Option<&'t Token>,
    /// `comment || commentBefore`
    has_comment: bool,
}

impl Node<'_> {
    /// `scalar.source`
    fn source<'a>(&self, text: &'a [u8]) -> Cow<'a, [u8]> {
        let (start, end) = match self.src_token {
            Some(Token::BlockScalar { source, .. }) => *source,
            _ => (self.range[0], self.range[1]),
        };
        let written = text.get(start as usize..end as usize).unwrap_or_default();
        match self.kind {
            NodeKind::Scalar(kind) => scalar_source(kind, written),
            _ => Cow::Borrowed(written),
        }
    }

    /// `scalar.value`
    fn value(&self, text: &[u8]) -> ScalarValue {
        match self.kind {
            NodeKind::Scalar(ScalarType::Plain) if !self.has_tag => {
                value_by_test(&self.source(text))
            }
            _ => ScalarValue::String,
        }
    }
}

pub(crate) struct Document<'t> {
    pub(crate) contents: Option<Node<'t>>,
    pub(crate) range: [u32; 3],
}

/// The result of `resolveProps`.
#[derive(Default)]
struct Props {
    comma: Option<SourceToken>,
    found: Option<SourceToken>,
    /// `comment.length`
    comment_len: usize,
    has_newline: bool,
    anchor: Option<SourceToken>,
    tag: Option<SourceToken>,
    newline_after_prop: Option<SourceToken>,
    end: u32,
    start: u32,
}

/// What follows the tokens that `resolveProps` looks at.
#[derive(Copy, Clone)]
enum NextToken<'t> {
    Token(&'t Token),
    Source(SourceToken),
}

struct PropsOptions<'t> {
    is_flow: bool,
    indicator: TokenType,
    next: Option<NextToken<'t>>,
    offset: u32,
    parent_indent: u32,
    start_on_newline: bool,
}

/// Handles and prefixes.
type Tags<'a> = smallvec::SmallVec<[(&'a [u8], &'a [u8]); 2]>;

struct Directives<'a> {
    is_explicit: bool,
    is_version_1_1: bool,
    /// The last with a handle counts.
    tags: Tags<'a>,
    at_next_document: bool,
}

const DEFAULT_PREFIX: &[u8] = b"tag:yaml.org,2002:";

/// For white space, which is a few bytes.
static TAB: text::ByteSet = text::ByteSet::new(b"\t");

impl<'a> Directives<'a> {
    fn default_tags() -> Tags<'a> {
        smallvec::smallvec![(&b"!!"[..], DEFAULT_PREFIX)]
    }

    /// `atDocument`: those of the document that starts.
    fn at_document(&mut self) -> Directives<'a> {
        let result = Directives {
            is_explicit: self.is_explicit,
            is_version_1_1: self.is_version_1_1,
            tags: self.tags.clone(),
            at_next_document: false,
        };
        if self.is_version_1_1 {
            self.at_next_document = true;
        } else {
            self.at_next_document = false;
            self.is_explicit = false;
            self.tags = Self::default_tags();
        }
        result
    }

    /// `at`: where `line` is.
    fn add(&mut self, line: &'a [u8], at: u32) -> Result<()> {
        if self.at_next_document {
            self.is_explicit = false;
            self.is_version_1_1 = true;
            self.tags = Self::default_tags();
            self.at_next_document = false;
        }
        let mut parts =
            strings::split_any(text::trim(line), b" \t").filter(|part| !part.is_empty());
        let name = parts.next().unwrap_or_default();
        let parts: Vec<&[u8]> = parts.collect();
        match name {
            b"%TAG" => {
                let [handle, prefix] = parts[..] else {
                    return Err(SyntaxError(Message::InvalidDirective, at));
                };
                self.tags.push((handle, prefix));
            }
            b"%YAML" => {
                self.is_explicit = true;
                let [version] = parts[..] else {
                    return Err(SyntaxError(Message::InvalidDirective, at));
                };
                match version {
                    b"1.1" => self.is_version_1_1 = true,
                    b"1.2" => self.is_version_1_1 = false,
                    _ => {
                        // `/^\d+\.\d+$/`: only a warning.
                        let is_number =
                            |part: &[u8]| !part.is_empty() && part.iter().all(u8::is_ascii_digit);
                        let is_valid =
                            strings::index_of_char_usize(version, b'.').is_some_and(|dot| {
                                is_number(&version[..dot]) && is_number(&version[dot + 1..])
                            });
                        if !is_valid {
                            return Err(SyntaxError(Message::InvalidDirective, at));
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// `tagName`. `None` is the non-specific tag `!`. `at`: where `source` is.
    fn tag_name(&self, source: &[u8], at: u32) -> Result<Option<Vec<u8>>> {
        if source == b"!" {
            return Ok(None);
        }
        if source.get(1) == Some(&b'<') {
            let verbatim = source.get(2..source.len() - 1).unwrap_or_default();
            if matches!(verbatim, b"!" | b"!!") || !source.ends_with(b">") {
                return Err(SyntaxError(Message::InvalidTag, at));
            }
            return Ok(Some(verbatim.to_vec()));
        }
        // `/^(.*!)([^!]*)$/s`
        let handle_len = strings::last_index_of_char(source, b'!')
            .ok_or(SyntaxError(Message::InvalidTag, at))?
            + 1;
        let (handle, suffix) = source.split_at(handle_len);
        if suffix.is_empty() {
            return Err(SyntaxError(Message::InvalidTag, at));
        }
        match self.tags.iter().rev().find(|(it, _)| *it == handle) {
            Some((_, prefix)) if !prefix.is_empty() => {
                Ok(Some([*prefix, &decode_uri_component(suffix, at)?].concat()))
            }
            _ if handle == b"!" => Ok(Some(source.to_vec())),
            _ => Err(SyntaxError(Message::InvalidTag, at)),
        }
    }
}

/// `decodeURIComponent`. `at`: where an error is said to be.
fn decode_uri_component(text: &[u8], at: u32) -> Result<Vec<u8>> {
    if !strings::contains_char(text, b'%') {
        return Ok(text.to_vec());
    }
    let mut out = Vec::with_capacity(text.len());
    let mut decoded_from = None;
    let mut i = 0;
    while let Some(&byte) = text.get(i) {
        if byte != b'%' {
            // What is decoded has to be UTF-8 on its own.
            if let Some(from) = decoded_from.take()
                && std::str::from_utf8(&out[from..]).is_err()
            {
                return Err(SyntaxError(Message::InvalidTag, at));
            }
            out.push(byte);
            i += 1;
            continue;
        }
        let hex = |at: usize| text.get(at).and_then(|&b| (b as char).to_digit(16));
        let (Some(high), Some(low)) = (hex(i + 1), hex(i + 2)) else {
            return Err(SyntaxError(Message::InvalidTag, at));
        };
        decoded_from.get_or_insert(out.len());
        out.push((high * 16 + low) as u8);
        i += 3;
    }
    if let Some(from) = decoded_from
        && std::str::from_utf8(&out[from..]).is_err()
    {
        return Err(SyntaxError(Message::InvalidTag, at));
    }
    Ok(out)
}

struct Context<'t, 'a> {
    text: &'a [u8],
    tree: &'t Tree,
    at_key: bool,
    at_root: bool,
    directives: Directives<'a>,
}

/// `resolveEnd`, with `reqSpace`. Returns whether there is a comment, and the offset.
fn resolve_end(
    end: Option<&[SourceToken]>,
    mut offset: u32,
    req_space: bool,
) -> Result<(bool, u32)> {
    let mut has_comment = false;
    let mut has_space = false;
    for token in end.unwrap_or_default() {
        match token.kind {
            TokenType::Space => has_space = true,
            TokenType::Comment => {
                if req_space && !has_space {
                    return Err(SyntaxError(Message::ExpectedWhiteSpace, token.offset));
                }
                has_comment = true;
            }
            TokenType::Newline => has_space = true,
            _ => return Err(SyntaxError(Message::UnexpectedToken, token.offset)),
        }
        offset += token.len();
    }
    Ok((has_comment, offset))
}

/// `emptyScalarPosition`
fn empty_scalar_position(mut offset: u32, before: Option<&[SourceToken]>) -> u32 {
    let Some(before) = before else {
        return offset;
    };
    let mut i = before.len();
    while i > 0 {
        i -= 1;
        let st = before[i];
        if matches!(
            st.kind,
            TokenType::Space | TokenType::Comment | TokenType::Newline
        ) {
            offset -= st.len();
            continue;
        }
        // An empty scalar is right behind the last node that is not empty, and the spaces after it.
        for st in before[i + 1..]
            .iter()
            .take_while(|st| st.kind == TokenType::Space)
        {
            offset += st.len();
        }
        break;
    }
    offset
}

/// `containsNewline`
fn contains_newline(tree: &Tree, key: Option<&Token>, text: &[u8]) -> bool {
    let has_newline =
        |tokens: &[SourceToken]| tokens.iter().any(|st| st.kind == TokenType::Newline);
    match key {
        None => false,
        Some(Token::FlowScalar { token, end }) => {
            strings::contains_char(token.source(text), b'\n')
                || end.is_some_and(|end| has_newline(tree.list(end)))
        }
        Some(Token::FlowCollection { items, .. }) => items.iter().any(|it| {
            has_newline(tree.list(it.start))
                || it.sep.is_some_and(|sep| has_newline(tree.list(sep)))
                || contains_newline(tree, tree.get(it.key), text)
                || contains_newline(tree, tree.get(it.value), text)
        }),
        Some(_) => true,
    }
}

fn is_block(token: Option<&Token>) -> bool {
    matches!(token, Some(Token::BlockMap { .. } | Token::BlockSeq { .. }))
}

/// `foldLines`
fn fold_lines(source: &[u8]) -> Cow<'_, [u8]> {
    #[derive(Copy, Clone)]
    #[repr(u8)]
    enum Separator {
        Space = b' ',
        LineBreak = b'\n',
    }
    let Some(first_newline) = strings::index_of_char_usize(source, b'\n') else {
        return Cow::Borrowed(source);
    };
    let trim_end = |line: &[u8]| -> usize {
        line.iter()
            .rposition(|b| !matches!(b, b' ' | b'\t'))
            .map_or(0, |at| at + 1)
    };
    let trim_start = |line: &[u8]| -> usize {
        line.iter()
            .position(|b| !matches!(b, b' ' | b'\t'))
            .unwrap_or(line.len())
    };
    let mut result = source[..trim_end(&source[..first_newline])].to_vec();
    let mut sep = Separator::Space;
    let mut rest = &source[first_newline + 1..];
    while let Some(newline) = strings::index_of_char_usize(rest, b'\n') {
        let line = &rest[..newline];
        let line = &line[trim_start(line)..];
        let line = &line[..trim_end(line)];
        if line.is_empty() {
            match sep {
                Separator::LineBreak => result.push(b'\n'),
                Separator::Space => sep = Separator::LineBreak,
            }
        } else {
            result.push(sep as u8);
            result.extend_from_slice(line);
            sep = Separator::Space;
        }
        rest = &rest[newline + 1..];
    }
    result.push(sep as u8);
    result.extend_from_slice(&rest[trim_start(rest)..]);
    Cow::Owned(result)
}

/// The errors of `resolveFlowScalar`, for a scalar that is written `source`, at `at`.
fn check_flow_scalar(kind: ScalarType, source: &[u8], at: u32) -> Result<()> {
    let is_closed = |quote: &[u8]| source.ends_with(quote) && source.len() != 1;
    let (is_valid, message) = match kind {
        ScalarType::Plain => (
            !matches!(
                source.first(),
                Some(b'\t' | b',' | b'%' | b'|' | b'>' | b'@' | b'`')
            ),
            Message::InvalidStartOfPlainScalar,
        ),
        ScalarType::QuoteSingle => (is_closed(b"'"), Message::UnclosedString),
        ScalarType::QuoteDouble if !is_closed(b"\"") => (false, Message::UnclosedString),
        ScalarType::QuoteDouble => (double_quoted_value(source).1, Message::InvalidString),
        ScalarType::BlockFolded | ScalarType::BlockLiteral => return Ok(()),
    };
    match is_valid {
        true => Ok(()),
        false => Err(SyntaxError(message, at)),
    }
}

/// `scalar.source`, for a scalar that is written `source`. As in `yaml`, every text has one: whether the text is a
/// scalar is what `check_flow_scalar` says. Of a block scalar: all that is asked of it is what is in it apart from
/// white space.
pub(crate) fn scalar_source(kind: ScalarType, source: &[u8]) -> Cow<'_, [u8]> {
    match kind {
        ScalarType::Plain => fold_lines(source),
        ScalarType::QuoteSingle => single_quoted_value(source),
        ScalarType::QuoteDouble => double_quoted_value(source).0,
        ScalarType::BlockFolded | ScalarType::BlockLiteral => Cow::Borrowed(source),
    }
}

fn single_quoted_value(source: &[u8]) -> Cow<'_, [u8]> {
    let folded = fold_lines(
        source
            .get(1..source.len().saturating_sub(1))
            .unwrap_or_default(),
    );
    if !text::includes(&folded, b"''") {
        return folded;
    }
    let mut result = Vec::with_capacity(folded.len());
    let mut i = 0;
    while let Some(&byte) = folded.get(i) {
        result.push(byte);
        i += if byte == b'\'' && folded.get(i + 1) == Some(&b'\'') {
            2
        } else {
            1
        };
    }
    Cow::Owned(result)
}

/// The value, and whether `yaml` reports no error. An escape that is none stays as it is written.
fn double_quoted_value(source: &[u8]) -> (Cow<'_, [u8]>, bool) {
    let mut is_valid = source.ends_with(b"\"") && source.len() != 1;
    let end = source.len().saturating_sub(1);
    let inner = source.get(1..end).unwrap_or_default();
    if strings::index_of_any(inner, b"\\\n").is_none() {
        return (Cow::Borrowed(inner), is_valid);
    }
    let at = |i: usize| source.get(i).copied();
    let is_blank = |ch: Option<u8>| matches!(ch, Some(b' ' | b'\t'));
    let mut result = Vec::with_capacity(inner.len());
    let mut i = 1;
    while i < end {
        let ch = source[i];
        if ch == b'\n' {
            // `foldNewline`
            let mut fold = 0;
            while matches!(at(i + 1), Some(b' ' | b'\t' | b'\n')) {
                if at(i + 1) == Some(b'\n') {
                    fold += 1;
                }
                i += 1;
            }
            match fold {
                0 => result.push(b' '),
                _ => result.resize(result.len() + fold, b'\n'),
            }
        } else if ch == b'\\' {
            i += 1;
            let next = source[i];
            let escape: Option<&str> = match next {
                b'0' => Some("\0"),
                b'a' => Some("\x07"),
                b'b' => Some("\x08"),
                b'e' => Some("\x1b"),
                b'f' => Some("\x0C"),
                b'n' => Some("\n"),
                b'r' => Some("\r"),
                b't' => Some("\t"),
                b'v' => Some("\x0B"),
                b'N' => Some("\u{85}"),
                b'_' => Some("\u{a0}"),
                b'L' => Some("\u{2028}"),
                b'P' => Some("\u{2029}"),
                b' ' => Some(" "),
                b'"' => Some("\""),
                b'/' => Some("/"),
                b'\\' => Some("\\"),
                b'\t' => Some("\t"),
                _ => None,
            };
            if let Some(escape) = escape {
                result.extend_from_slice(escape.as_bytes());
            } else if next == b'\n' {
                // An escaped line break is nothing, and neither is the indentation of the next line.
                while is_blank(at(i + 1)) {
                    i += 1;
                }
            } else if matches!(next, b'x' | b'u' | b'U') {
                let length = match next {
                    b'x' => 2,
                    b'u' => 4,
                    _ => 8,
                };
                // `parseCharCode`
                let code = source
                    .get(i + 1..i + 1 + length)
                    .filter(|it| it.iter().all(u8::is_ascii_hexdigit))
                    .map(|digits| {
                        digits.iter().fold(0u32, |code, &digit| {
                            code * 16 + (digit as char).to_digit(16).unwrap_or(0)
                        })
                    })
                    .filter(|&code| code <= 0x10FFFF);
                match code {
                    Some(code) => {
                        let character = char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER);
                        result.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
                    }
                    None => {
                        is_valid = false;
                        result
                            .extend_from_slice(&source[i - 1..(i + 1 + length).min(source.len())]);
                    }
                }
                i += length;
            } else {
                is_valid = false;
                result.extend_from_slice(&source[i - 1..=i]);
            }
        } else if matches!(ch, b' ' | b'\t') {
            // White space at the end of a line is nothing.
            let start = i;
            while is_blank(at(i + 1)) {
                i += 1;
            }
            if at(i + 1) != Some(b'\n') {
                result.extend_from_slice(&source[start..=i]);
            }
        } else {
            result.push(ch);
        }
        i += 1;
    }
    (Cow::Owned(result), is_valid)
}

/// The value of a plain scalar without a tag, in the core schema and in that of YAML 1.1 alike as far as
/// anybody can tell.
fn value_by_test(value: &[u8]) -> ScalarValue {
    match value {
        b"" | b"~" | b"null" | b"Null" | b"NULL" => return ScalarValue::Null,
        b"true" | b"True" | b"TRUE" => return ScalarValue::Bool(true),
        b"false" | b"False" | b"FALSE" => return ScalarValue::Bool(false),
        _ => {}
    }
    let radix = |digits: &[u8], radix: u32| {
        (!digits.is_empty() && digits.iter().all(|&b| (b as char).is_digit(radix))).then(|| {
            digits.iter().fold(0f64, |all, &b| {
                all * f64::from(radix) + f64::from((b as char).to_digit(radix).unwrap_or(0))
            })
        })
    };
    if let Some(number) = value.strip_prefix(b"0o").and_then(|it| radix(it, 8)) {
        return ScalarValue::Number(number);
    }
    if let Some(number) = value.strip_prefix(b"0x").and_then(|it| radix(it, 16)) {
        return ScalarValue::Number(number);
    }
    // What is left are decimal numbers: `[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?`
    let unsigned = value
        .strip_prefix(b"-")
        .or_else(|| value.strip_prefix(b"+"))
        .unwrap_or(value);
    let looks_like_number = unsigned
        .first()
        .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
        && unsigned.iter().any(u8::is_ascii_digit)
        && unsigned
            .iter()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'-' | b'+'));
    if looks_like_number
        && let Some(number) = std::str::from_utf8(value)
            .ok()
            .and_then(|it| it.trim_start_matches('+').parse::<f64>().ok())
    {
        return ScalarValue::Number(number);
    }
    ScalarValue::String
}

/// Whether `atob` takes `value`.
fn is_base64(value: &[u8]) -> bool {
    let mut count = 0usize;
    let mut padding = 0usize;
    for &byte in value {
        match byte {
            b' ' | b'\t' | b'\n' | 0x0C | b'\r' => {}
            b'=' => padding += 1,
            _ if padding > 0 => return false,
            _ if byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/') => count += 1,
            _ => return false,
        }
    }
    match padding {
        0 => count % 4 != 1,
        1 | 2 => (count + padding).is_multiple_of(4),
        _ => false,
    }
}

/// The `test` of the tag `!!timestamp`.
fn is_timestamp(value: &[u8]) -> bool {
    fn digits(text: &[u8], min: usize, max: usize) -> Option<&[u8]> {
        let count = text
            .iter()
            .take(max)
            .take_while(|b| b.is_ascii_digit())
            .count();
        (count >= min).then(|| &text[count..])
    }
    fn skip(text: &[u8], byte: u8) -> Option<&[u8]> {
        text.strip_prefix(&[byte])
    }
    fn blanks(text: &[u8]) -> &[u8] {
        &text[text
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count()..]
    }
    let date = (|| {
        let rest = skip(digits(value, 4, 4)?, b'-')?;
        let rest = skip(digits(rest, 1, 2)?, b'-')?;
        digits(rest, 1, 2)
    })();
    let Some(rest) = date else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    let time = (|| {
        let rest = match rest {
            [b't' | b'T', rest @ ..] => rest,
            [b' ' | b'\t', ..] => blanks(rest),
            _ => return None,
        };
        let rest = skip(digits(rest, 1, 2)?, b':')?;
        let rest = skip(digits(rest, 1, 2)?, b':')?;
        let rest = digits(rest, 1, 2)?;
        Some(
            match skip(rest, b'.').and_then(|it| digits(it, 1, usize::MAX)) {
                Some(rest) => rest,
                None => rest,
            },
        )
    })();
    let Some(rest) = time else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    // `[ \t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?)`
    match blanks(rest) {
        b"Z" => true,
        [b'-' | b'+', zone @ ..] => {
            let (hours, minutes) = match strings::index_of_char_usize(zone, b':') {
                Some(colon) => (&zone[..colon], Some(&zone[colon + 1..])),
                None => (zone, None),
            };
            let are_hours = match hours {
                [b'0'..=b'2', b] | [b] => b.is_ascii_digit(),
                _ => false,
            };
            are_hours && minutes.is_none_or(|it| it.len() == 2 && it.iter().all(u8::is_ascii_digit))
        }
        _ => false,
    }
}

impl<'t, 'a> Context<'t, 'a> {
    fn resolve_props(&self, tokens: &[SourceToken], options: &PropsOptions<'_>) -> Result<Props> {
        let PropsOptions {
            is_flow,
            indicator,
            next,
            offset,
            parent_indent,
            start_on_newline,
        } = *options;
        let mut props = Props::default();
        let mut at_newline = start_on_newline;
        let mut has_space = start_on_newline;
        let mut comment_sep_len = 0;
        let mut req_space = false;
        let mut tab: Option<SourceToken> = None;
        let mut start = None;
        let next_is_flow_collection =
            matches!(next, Some(NextToken::Token(Token::FlowCollection { .. })));
        for &token in tokens {
            if req_space {
                if !matches!(
                    token.kind,
                    TokenType::Space | TokenType::Newline | TokenType::Comma
                ) {
                    return Err(SyntaxError(Message::ExpectedWhiteSpace, token.offset));
                }
                req_space = false;
            }
            if let Some(tab) = tab.take()
                && at_newline
                && !matches!(token.kind, TokenType::Comment | TokenType::Newline)
            {
                return Err(SyntaxError(Message::TabAsIndentation, tab.offset));
            }
            match token.kind {
                TokenType::Space => {
                    // At the level of the document, tabs at the start of a line can be white space
                    // instead of indentation. In a flow collection, only the parser looks at it.
                    if !is_flow
                        && (indicator != TokenType::DocStart || !next_is_flow_collection)
                        && TAB.find(token.source(self.text), 0).is_some()
                    {
                        tab = Some(token);
                    }
                    has_space = true;
                }
                TokenType::Comment => {
                    if !has_space {
                        return Err(SyntaxError(Message::ExpectedWhiteSpace, token.offset));
                    }
                    let len = (token.len() as usize - 1).max(1);
                    props.comment_len += if props.comment_len == 0 {
                        len
                    } else {
                        comment_sep_len + len
                    };
                    comment_sep_len = 0;
                    at_newline = false;
                }
                TokenType::Newline => {
                    if at_newline {
                        if props.comment_len > 0 {
                            props.comment_len += token.len() as usize;
                        }
                    } else {
                        comment_sep_len += token.len() as usize;
                    }
                    at_newline = true;
                    props.has_newline = true;
                    if props.anchor.is_some() || props.tag.is_some() {
                        props.newline_after_prop = Some(token);
                    }
                    has_space = true;
                }
                TokenType::Anchor | TokenType::Tag => {
                    let slot = if token.kind == TokenType::Anchor {
                        &mut props.anchor
                    } else {
                        &mut props.tag
                    };
                    if slot.replace(token).is_some() {
                        return Err(SyntaxError(Message::RepeatedProperty, token.offset));
                    }
                    start.get_or_insert(token.offset);
                    at_newline = false;
                    has_space = false;
                    req_space = true;
                }
                kind if kind == indicator => {
                    if props.anchor.is_some() || props.tag.is_some() || props.found.is_some() {
                        return Err(SyntaxError(Message::UnexpectedIndicator, token.offset));
                    }
                    props.found = Some(token);
                    at_newline =
                        matches!(indicator, TokenType::SeqItemInd | TokenType::ExplicitKeyInd);
                    has_space = false;
                }
                TokenType::Comma if is_flow => {
                    if props.comma.replace(token).is_some() {
                        return Err(SyntaxError(Message::UnexpectedToken, token.offset));
                    }
                    at_newline = false;
                    has_space = false;
                }
                _ => return Err(SyntaxError(Message::UnexpectedToken, token.offset)),
            }
        }
        props.end = tokens.last().map_or(offset, |last| last.end);
        if req_space {
            let is_separated = match next {
                None => true,
                Some(NextToken::Source(next)) => matches!(
                    next.kind,
                    TokenType::Space | TokenType::Newline | TokenType::Comma
                ),
                Some(NextToken::Token(Token::FlowScalar { token, .. })) => {
                    token.kind == TokenType::Scalar && token.len() == 0
                }
                Some(NextToken::Token(_)) => false,
            };
            if !is_separated {
                return Err(SyntaxError(Message::ExpectedWhiteSpace, props.end));
            }
        }
        if let Some(tab) = tab
            && ((at_newline && tab.indent <= parent_indent)
                || matches!(
                    next,
                    Some(NextToken::Token(
                        Token::BlockMap { .. } | Token::BlockSeq { .. }
                    ))
                ))
        {
            return Err(SyntaxError(Message::TabAsIndentation, tab.offset));
        }
        props.start = start.unwrap_or(props.end);
        Ok(props)
    }

    fn anchor_of(&self, anchor: Option<SourceToken>) -> Result<Option<(u32, u32)>> {
        match anchor {
            // An anchor cannot be an empty string.
            Some(anchor) if anchor.len() <= 1 => {
                Err(SyntaxError(Message::EmptyAnchor, anchor.offset))
            }
            Some(anchor) => Ok(Some((anchor.offset + 1, anchor.end))),
            None => Ok(None),
        }
    }

    fn compose_node(&mut self, token: &'t Token, props: &Props) -> Result<Node<'t>> {
        let mut node = match token {
            Token::FlowScalar { token: source, end } if source.kind == TokenType::Alias => {
                if props.anchor.is_some() || props.tag.is_some() || source.len() <= 1 {
                    return Err(SyntaxError(Message::InvalidAlias, source.offset));
                }
                let end = end.map(|end| self.tree.list(end));
                let (has_comment, offset) = resolve_end(end, source.end, true)?;
                Node {
                    kind: NodeKind::Alias,
                    range: [source.offset, source.end, offset],
                    has_set_tag: false,
                    has_tag: false,
                    anchor: None,
                    src_token: None,
                    has_comment,
                }
            }
            Token::FlowScalar { .. } | Token::BlockScalar { .. } => {
                self.compose_scalar(token, props.tag)?
            }
            Token::BlockMap { .. } | Token::BlockSeq { .. } | Token::FlowCollection { .. } => {
                self.compose_collection(token, props)?
            }
            _ => return Err(SyntaxError(Message::UnexpectedToken, token.offset())),
        };
        if !matches!(node.kind, NodeKind::Alias) {
            node.anchor = self.anchor_of(props.anchor)?;
        }
        node.has_comment |= props.comment_len > 0;
        node.src_token = Some(token);
        Ok(node)
    }

    fn compose_empty_node(
        &mut self,
        offset: u32,
        before: Option<&[SourceToken]>,
        props: &Props,
    ) -> Result<Node<'t>> {
        let offset = empty_scalar_position(offset, before);
        let mut node = self.finish_scalar(ScalarType::Plain, b"", [offset; 3], false, props.tag)?;
        node.anchor = self.anchor_of(props.anchor)?;
        if props.comment_len > 0 {
            node.has_comment = true;
            node.range[2] = props.end;
        }
        Ok(node)
    }

    /// The second half of `composeScalar`, for a scalar that is written `source`.
    fn finish_scalar(
        &mut self,
        kind: ScalarType,
        source: &[u8],
        range: [u32; 3],
        has_comment: bool,
        tag_token: Option<SourceToken>,
    ) -> Result<Node<'t>> {
        let tag_name = match tag_token {
            Some(tag) => self
                .directives
                .tag_name(tag.source(self.text), tag.offset)?,
            None => None,
        };
        match tag_name
            .as_deref()
            .and_then(|name| name.strip_prefix(DEFAULT_PREFIX))
        {
            Some(b"timestamp")
                if !self.directives.is_version_1_1
                    && !is_timestamp(&scalar_source(kind, source)) =>
            {
                return Err(SyntaxError(Message::ValueDoesNotFitTag, range[0]));
            }
            Some(b"binary") if !is_base64(&scalar_source(kind, source)) => {
                return Err(SyntaxError(Message::ValueDoesNotFitTag, range[0]));
            }
            _ => {}
        }
        Ok(Node {
            kind: NodeKind::Scalar(kind),
            range,
            has_set_tag: false,
            has_tag: tag_token.is_some(),
            anchor: None,
            src_token: None,
            has_comment,
        })
    }

    fn compose_scalar(
        &mut self,
        token: &'t Token,
        tag_token: Option<SourceToken>,
    ) -> Result<Node<'t>> {
        match token {
            Token::FlowScalar {
                token: source_token,
                end,
            } => {
                let source = source_token.source(self.text);
                let kind = match source_token.kind {
                    TokenType::Scalar => ScalarType::Plain,
                    TokenType::SingleQuotedScalar => ScalarType::QuoteSingle,
                    TokenType::DoubleQuotedScalar => ScalarType::QuoteDouble,
                    _ => return Err(SyntaxError(Message::UnexpectedToken, source_token.offset)),
                };
                check_flow_scalar(kind, source, source_token.offset)?;
                let end = end.map(|end| self.tree.list(end));
                let (has_comment, offset) = resolve_end(end, source_token.end, true)?;
                let range = [source_token.offset, source_token.end, offset];
                self.finish_scalar(kind, source, range, has_comment, tag_token)
            }
            Token::BlockScalar {
                offset,
                indent,
                props,
                source,
            } => {
                let (kind, range, has_comment) =
                    self.resolve_block_scalar(*offset, *indent, self.tree.list(*props), *source)?;
                let source = self
                    .text
                    .get(source.0 as usize..source.1 as usize)
                    .unwrap_or_default();
                self.finish_scalar(kind, source, range, has_comment, tag_token)
            }
            _ => Err(SyntaxError(Message::UnexpectedToken, token.offset())),
        }
    }

    /// `resolveBlockScalar`, without the value.
    fn resolve_block_scalar(
        &self,
        start: u32,
        scalar_indent: u32,
        props: &[SourceToken],
        source: (u32, u32),
    ) -> Result<(ScalarType, [u32; 3], bool)> {
        // `parseBlockScalarHeader`
        let [header, rest @ ..] = props else {
            return Err(SyntaxError(Message::InvalidBlockScalarHeader, start));
        };
        let header_source = header.source(self.text);
        let mut header_indent = 0usize;
        let mut has_chomp = false;
        for &ch in &header_source[1..] {
            if !has_chomp && matches!(ch, b'-' | b'+') {
                has_chomp = true;
            } else if header_indent == 0 && matches!(ch, b'1'..=b'9') {
                header_indent = usize::from(ch - b'0');
            } else {
                return Err(SyntaxError(
                    Message::InvalidBlockScalarHeader,
                    header.offset,
                ));
            }
        }
        let mut has_space = false;
        let mut has_comment = false;
        let mut length = header.len();
        for token in rest {
            match token.kind {
                TokenType::Space => has_space = true,
                TokenType::Newline => {}
                TokenType::Comment => {
                    if !has_space {
                        return Err(SyntaxError(Message::ExpectedWhiteSpace, token.offset));
                    }
                    has_comment = token.len() > 1;
                }
                _ => return Err(SyntaxError(Message::InvalidBlockScalarHeader, token.offset)),
            }
            length += token.len();
        }
        let kind = if header_source[0] == b'>' {
            ScalarType::BlockFolded
        } else {
            ScalarType::BlockLiteral
        };
        let end = start + length + (source.1 - source.0);
        let range = [start, end, end];

        // `splitLines`: the indentation and the rest of each line.
        let source = &self.text[source.0 as usize..source.1 as usize];
        let lines: Vec<(usize, &[u8])> = match source.is_empty() {
            true => Vec::new(),
            false => strings::split(source, b"\n")
                .map(|line| {
                    let indent = line.iter().take_while(|&&b| b == b' ').count();
                    (indent, &line[indent..])
                })
                .collect(),
        };
        let chomp_start = lines
            .iter()
            .rposition(|(_, content)| !content.is_empty())
            .map_or(0, |at| at + 1);
        if chomp_start == 0 {
            return Ok((kind, range, has_comment));
        }
        let mut trim_indent = scalar_indent as usize + header_indent;
        let mut content_start = 0;
        for (i, &(indent, content)) in lines[..chomp_start].iter().enumerate() {
            if content.is_empty() {
                if header_indent == 0 && indent > trim_indent {
                    trim_indent = indent;
                }
                continue;
            }
            if indent < trim_indent {
                return Err(SyntaxError(Message::BadIndentation, start));
            }
            if header_indent == 0 {
                trim_indent = indent;
            }
            content_start = i;
            if trim_indent == 0 && !self.at_root {
                return Err(SyntaxError(Message::BadIndentation, start));
            }
            break;
        }
        if lines[content_start..chomp_start]
            .iter()
            .any(|&(indent, content)| !content.is_empty() && indent < trim_indent)
        {
            return Err(SyntaxError(Message::BadIndentation, start));
        }
        Ok((kind, range, has_comment))
    }

    fn compose_collection(&mut self, token: &'t Token, props: &Props) -> Result<Node<'t>> {
        let tag_name = match props.tag {
            Some(tag) => self
                .directives
                .tag_name(tag.source(self.text), tag.offset)?,
            None => None,
        };
        if matches!(token, Token::BlockSeq { .. }) {
            let last_prop = match (props.anchor, props.tag) {
                (Some(anchor), Some(tag)) => Some(if anchor.offset > tag.offset {
                    anchor
                } else {
                    tag
                }),
                (anchor, tag) => anchor.or(tag),
            };
            if let Some(last_prop) = last_prop
                && props
                    .newline_after_prop
                    .is_none_or(|nl| nl.offset < last_prop.offset)
            {
                return Err(SyntaxError(Message::ExpectedLineBreak, last_prop.end));
            }
        }
        let mut node = match token {
            Token::BlockMap {
                offset,
                indent,
                items,
            } => self.resolve_block_map(*offset, *indent, items)?,
            Token::BlockSeq {
                offset,
                indent,
                items,
            } => self.resolve_block_seq(*offset, *indent, items)?,
            _ => self.resolve_flow_collection(token)?,
        };
        node.has_tag = props.tag.is_some();
        // The tags of YAML 1.1 for collections, which both schemas know.
        match (
            tag_name
                .as_deref()
                .and_then(|name| name.strip_prefix(DEFAULT_PREFIX)),
            &mut node.kind,
        ) {
            (Some(b"set"), NodeKind::Map { items, .. }) => {
                // `hasAllNullValues(true)`
                let are_all_null = items.iter().all(|pair| {
                    pair.value.as_ref().is_none_or(|value| {
                        matches!(value.kind, NodeKind::Scalar(_))
                            && value.value(self.text) == ScalarValue::Null
                            && !value.has_comment
                            && !value.has_tag
                    })
                });
                if !are_all_null {
                    return Err(SyntaxError(Message::ValueDoesNotFitTag, node.range[0]));
                }
                node.has_set_tag = true;
            }
            (Some(name @ (b"omap" | b"pairs")), NodeKind::Seq { items, .. }) => {
                // `resolvePairs`
                for item in items.iter_mut() {
                    let SeqItem::Node(node) = item else {
                        continue;
                    };
                    let NodeKind::Map { items: pairs, .. } = &mut node.kind else {
                        // `yaml-unist-parser` cannot cope with a pair that is made up.
                        return Err(SyntaxError(Message::ValueDoesNotFitTag, node.range[0]));
                    };
                    if pairs.len() != 1 {
                        return Err(SyntaxError(Message::ValueDoesNotFitTag, node.range[0]));
                    }
                    if let Some(pair) = pairs.pop() {
                        *item = SeqItem::Pair(pair);
                    }
                }
                if name == b"omap" {
                    let keys: Vec<(ScalarValue, Cow<'_, [u8]>)> = items
                        .iter()
                        .filter_map(|item| match item {
                            SeqItem::Pair(pair) if matches!(pair.key.kind, NodeKind::Scalar(_)) => {
                                Some((pair.key.value(self.text), pair.key.source(self.text)))
                            }
                            _ => None,
                        })
                        .collect();
                    let is_same =
                        |a: &(ScalarValue, Cow<'_, [u8]>), b: &(ScalarValue, Cow<'_, [u8]>)| {
                            a.0 == b.0 && (a.0 != ScalarValue::String || a.1 == b.1)
                        };
                    if (1..keys.len()).any(|i| keys[..i].iter().any(|key| is_same(key, &keys[i]))) {
                        return Err(SyntaxError(Message::ValueDoesNotFitTag, node.range[0]));
                    }
                }
            }
            _ => {}
        }
        Ok(node)
    }

    fn collection(kind: NodeKind<'t>, range: [u32; 3]) -> Node<'t> {
        Node {
            kind,
            range,
            has_set_tag: false,
            has_tag: false,
            anchor: None,
            src_token: None,
            has_comment: false,
        }
    }

    fn resolve_block_map(
        &mut self,
        map_offset: u32,
        map_indent: u32,
        items: &'t [Item],
    ) -> Result<Node<'t>> {
        let mut pairs = Vec::with_capacity(items.len());
        self.at_root = false;
        let mut offset = map_offset;
        let mut comment_end = None;
        for item in items {
            let Item {
                start,
                key,
                sep,
                value,
                ..
            } = item;
            let tree = self.tree;
            let (key, value) = (tree.get(*key), tree.get(*value));
            let (start, sep) = (tree.list(*start), sep.map(|sep| tree.list(sep)));
            let first_of_sep = sep.and_then(|sep| sep.first()).copied();
            let key_props = self.resolve_props(
                start,
                &PropsOptions {
                    is_flow: false,
                    indicator: TokenType::ExplicitKeyInd,
                    next: key
                        .map(NextToken::Token)
                        .or_else(|| first_of_sep.map(NextToken::Source)),
                    offset,
                    parent_indent: map_indent,
                    start_on_newline: true,
                },
            )?;
            let is_implicit_key = key_props.found.is_none();
            if is_implicit_key {
                if let Some(key) = key
                    && (matches!(key, Token::BlockSeq { .. })
                        || key.indent().is_some_and(|indent| indent != map_indent))
                {
                    return Err(SyntaxError(Message::BadIndentation, key.offset()));
                }
                if key_props.anchor.is_none() && key_props.tag.is_none() && sep.is_none() {
                    comment_end = Some(key_props.end);
                    continue;
                }
                if key_props.newline_after_prop.is_some()
                    || contains_newline(self.tree, key, self.text)
                {
                    return Err(SyntaxError(Message::KeyOverSeveralLines, key_props.start));
                }
            } else if let Some(found) = key_props.found
                && found.indent != map_indent
            {
                return Err(SyntaxError(Message::BadIndentation, found.offset));
            }

            self.at_key = true;
            let key_node = match key {
                Some(key) => self.compose_node(key, &key_props)?,
                None => self.compose_empty_node(key_props.end, Some(start), &key_props)?,
            };
            self.at_key = false;

            let value_props = self.resolve_props(
                sep.unwrap_or_default(),
                &PropsOptions {
                    is_flow: false,
                    indicator: TokenType::MapValueInd,
                    next: value.map(NextToken::Token),
                    offset: key_node.range[2],
                    parent_indent: map_indent,
                    start_on_newline: key
                        .is_none_or(|key| matches!(key, Token::BlockScalar { .. })),
                },
            )?;
            offset = value_props.end;
            let Some(found) = value_props.found else {
                // A key without a value.
                if is_implicit_key {
                    return Err(SyntaxError(Message::ExpectedColon, key_node.range[1]));
                }
                pairs.push(Pair {
                    key: key_node,
                    value: None,
                    src_token: Some(item),
                });
                continue;
            };
            if is_implicit_key
                && matches!(value, Some(Token::BlockMap { .. }))
                && !value_props.has_newline
            {
                return Err(SyntaxError(Message::MappingOnLineOfKey, value_props.end));
            }
            if is_implicit_key && i64::from(key_props.start) < i64::from(found.offset) - 1024 {
                return Err(SyntaxError(Message::KeyTooLong, key_props.start));
            }
            let value_node = match value {
                Some(value) => self.compose_node(value, &value_props)?,
                None => self.compose_empty_node(offset, sep, &value_props)?,
            };
            offset = value_node.range[2];
            pairs.push(Pair {
                key: key_node,
                value: Some(value_node),
                src_token: Some(item),
            });
        }
        if let Some(end) = comment_end
            && end != 0
            && end < offset
        {
            return Err(SyntaxError(Message::UnexpectedToken, end));
        }
        let kind = NodeKind::Map {
            flow: false,
            items: pairs,
        };
        Ok(Self::collection(
            kind,
            [map_offset, offset, comment_end.unwrap_or(offset)],
        ))
    }

    fn resolve_block_seq(
        &mut self,
        seq_offset: u32,
        seq_indent: u32,
        items: &'t [Item],
    ) -> Result<Node<'t>> {
        let mut nodes = Vec::with_capacity(items.len());
        self.at_root = false;
        self.at_key = false;
        let mut offset = seq_offset;
        let mut comment_end = None;
        for Item { start, value, .. } in items {
            let (start, value) = (self.tree.list(*start), self.tree.get(*value));
            let props = self.resolve_props(
                start,
                &PropsOptions {
                    is_flow: false,
                    indicator: TokenType::SeqItemInd,
                    next: value.map(NextToken::Token),
                    offset,
                    parent_indent: seq_indent,
                    start_on_newline: true,
                },
            )?;
            if props.found.is_none() {
                if props.anchor.is_some() || props.tag.is_some() || value.is_some() {
                    return Err(SyntaxError(Message::BadIndentation, props.end));
                }
                comment_end = Some(props.end);
                continue;
            }
            let node = match value {
                Some(value) => self.compose_node(value, &props)?,
                None => self.compose_empty_node(props.end, Some(start), &props)?,
            };
            offset = node.range[2];
            nodes.push(SeqItem::Node(node));
        }
        let kind = NodeKind::Seq {
            flow: false,
            items: nodes,
        };
        Ok(Self::collection(
            kind,
            [seq_offset, offset, comment_end.unwrap_or(offset)],
        ))
    }

    fn resolve_flow_collection(&mut self, token: &'t Token) -> Result<Node<'t>> {
        let Token::FlowCollection {
            offset: collection_offset,
            indent,
            start: collection_start,
            items,
            end,
        } = token
        else {
            return Err(SyntaxError(Message::UnexpectedToken, token.offset()));
        };
        let is_map = collection_start.kind == TokenType::FlowMapStart;
        let mut pairs = Vec::new();
        let mut nodes = Vec::new();
        self.at_root = false;
        self.at_key = false;
        let mut offset = collection_offset + collection_start.len();
        for (i, item) in items.iter().enumerate() {
            let Item {
                start,
                key,
                sep,
                value,
                ..
            } = item;
            let tree = self.tree;
            let (key, value) = (tree.get(*key), tree.get(*value));
            let (start, sep) = (tree.list(*start), sep.map(|sep| tree.list(sep)));
            let first_of_sep = sep.and_then(|sep| sep.first()).copied();
            let mut props = self.resolve_props(
                start,
                &PropsOptions {
                    is_flow: true,
                    indicator: TokenType::ExplicitKeyInd,
                    next: key
                        .map(NextToken::Token)
                        .or_else(|| first_of_sep.map(NextToken::Source)),
                    offset,
                    parent_indent: *indent,
                    start_on_newline: false,
                },
            )?;
            if props.found.is_none() {
                if props.anchor.is_none() && props.tag.is_none() && sep.is_none() && value.is_none()
                {
                    if (i == 0 && props.comma.is_some())
                        || (!(i == 0 && props.comma.is_some()) && i + 1 < items.len())
                    {
                        return Err(SyntaxError(Message::UnexpectedToken, props.start));
                    }
                    offset = props.end;
                    continue;
                }
                if !is_map && contains_newline(self.tree, key, self.text) {
                    return Err(SyntaxError(Message::KeyOverSeveralLines, props.start));
                }
            }
            if i == 0 {
                if let Some(comma) = props.comma {
                    return Err(SyntaxError(Message::UnexpectedToken, comma.offset));
                }
            } else {
                if props.comma.is_none() {
                    return Err(SyntaxError(Message::ExpectedComma, props.start));
                }
                if props.comment_len > 0 {
                    // A comment right behind the comma belongs to the item before.
                    let first = start
                        .iter()
                        .find(|st| !matches!(st.kind, TokenType::Comma | TokenType::Space));
                    let prev_item_comment_len = match first {
                        Some(st) if st.kind == TokenType::Comment => st.len() as usize - 1,
                        _ => 0,
                    };
                    if prev_item_comment_len > 0 {
                        props.comment_len =
                            props.comment_len.saturating_sub(prev_item_comment_len + 1);
                    }
                }
            }
            if !is_map && sep.is_none() && props.found.is_none() {
                // A value in a sequence.
                let value_node = match value {
                    Some(value) => self.compose_node(value, &props)?,
                    None => self.compose_empty_node(props.end, None, &props)?,
                };
                if is_block(value) {
                    return Err(SyntaxError(Message::BlockInFlow, value_node.range[0]));
                }
                offset = value_node.range[2];
                nodes.push(SeqItem::Node(value_node));
                continue;
            }
            // A pair of a key and a value.
            self.at_key = true;
            let key_node = match key {
                Some(key) => self.compose_node(key, &props)?,
                None => self.compose_empty_node(props.end, Some(start), &props)?,
            };
            if is_block(key) {
                return Err(SyntaxError(Message::BlockInFlow, key_node.range[0]));
            }
            self.at_key = false;
            let value_props = self.resolve_props(
                sep.unwrap_or_default(),
                &PropsOptions {
                    is_flow: true,
                    indicator: TokenType::MapValueInd,
                    next: value.map(NextToken::Token),
                    offset: key_node.range[2],
                    parent_indent: *indent,
                    start_on_newline: false,
                },
            )?;
            if let Some(found) = value_props.found {
                if !is_map && props.found.is_none() {
                    let before_found = sep
                        .unwrap_or_default()
                        .iter()
                        .take_while(|st| st.offset != found.offset);
                    if before_found.clone().any(|st| st.kind == TokenType::Newline) {
                        return Err(SyntaxError(Message::KeyOverSeveralLines, props.start));
                    }
                    if i64::from(props.start) < i64::from(found.offset) - 1024 {
                        return Err(SyntaxError(Message::KeyTooLong, props.start));
                    }
                }
            } else if value.is_some() {
                return Err(SyntaxError(Message::ExpectedCommaOrColon, value_props.end));
            }
            let value_node = match value {
                Some(value) => Some(self.compose_node(value, &value_props)?),
                None if value_props.found.is_some() => {
                    Some(self.compose_empty_node(value_props.end, sep, &value_props)?)
                }
                None => None,
            };
            if value_node.is_some() && is_block(value) {
                return Err(SyntaxError(Message::BlockInFlow, value_props.end));
            }
            offset = value_node
                .as_ref()
                .map_or(value_props.end, |node| node.range[2]);
            let end_range = value_node.as_ref().unwrap_or(&key_node).range;
            let range = [key_node.range[0], end_range[1], end_range[2]];
            let pair = Pair {
                key: key_node,
                value: value_node,
                src_token: Some(item),
            };
            if is_map {
                pairs.push(pair);
            } else {
                let kind = NodeKind::Map {
                    flow: true,
                    items: vec![pair],
                };
                nodes.push(SeqItem::Node(Self::collection(kind, range)));
            }
        }
        let expected_end = if is_map {
            TokenType::FlowMapEnd
        } else {
            TokenType::FlowSeqEnd
        };
        let [close, rest @ ..] = self.tree.list(*end) else {
            return Err(SyntaxError(Message::UnclosedBracket, *collection_offset));
        };
        if close.kind != expected_end {
            return Err(SyntaxError(Message::UnclosedBracket, *collection_offset));
        }
        let (_, end_offset) = resolve_end(Some(rest), close.end, true)?;
        let kind = match is_map {
            true => NodeKind::Map {
                flow: true,
                items: pairs,
            },
            false => NodeKind::Seq {
                flow: true,
                items: nodes,
            },
        };
        Ok(Self::collection(
            kind,
            [*collection_offset, close.end, end_offset],
        ))
    }
}

/// `composeDoc`. Returns the document and whether it has a `---`.
fn compose_doc<'t, 'a>(
    text: &'a [u8],
    tree: &'t Tree,
    directives: Directives<'a>,
    token: &'t Token,
) -> Result<(Document<'t>, bool)> {
    let Token::Document {
        offset,
        start,
        value,
        end,
    } = token
    else {
        return Err(SyntaxError(Message::UnexpectedToken, token.offset()));
    };
    let mut context = Context {
        text,
        tree,
        at_key: false,
        at_root: true,
        directives,
    };
    let value = tree.get(*value);
    let (start, end) = (tree.list(*start), end.map(|end| tree.list(end)));
    let first_of_end = end.and_then(|end| end.first()).copied();
    let props = context.resolve_props(
        start,
        &PropsOptions {
            is_flow: false,
            indicator: TokenType::DocStart,
            next: value
                .map(NextToken::Token)
                .or_else(|| first_of_end.map(NextToken::Source)),
            offset: *offset,
            parent_indent: 0,
            start_on_newline: true,
        },
    )?;
    if props.found.is_some() && is_block(value) && !props.has_newline {
        return Err(SyntaxError(Message::ExpectedLineBreak, props.end));
    }
    let contents = match value {
        Some(value) => context.compose_node(value, &props)?,
        None => context.compose_empty_node(props.end, Some(start), &props)?,
    };
    let content_end = contents.range[2];
    let (_, end_offset) = resolve_end(end, content_end, false)?;
    let document = Document {
        contents: Some(contents),
        range: [*offset, content_end, end_offset],
    };
    Ok((document, props.found.is_some()))
}

/// `[...new Composer(..).compose(tokens, true, text.length)]`
pub(crate) fn compose<'t>(text: &[u8], tree: &'t Tree) -> Result<Vec<Document<'t>>> {
    let mut documents: Vec<Document<'t>> = Vec::new();
    let mut directives = Directives {
        is_explicit: false,
        is_version_1_1: false,
        tags: Directives::default_tags(),
        at_next_document: false,
    };
    let mut at_directives = false;
    for token in &tree.tokens {
        match token {
            Token::Directive(directive) => {
                directives.add(directive.source(text), directive.offset)?;
                at_directives = true;
            }
            Token::Document { .. } => {
                let (document, has_doc_start) =
                    compose_doc(text, tree, directives.at_document(), token)?;
                if at_directives && !has_doc_start {
                    return Err(SyntaxError(
                        Message::ExpectedDocumentStart,
                        document.range[0],
                    ));
                }
                documents.push(document);
                at_directives = false;
            }
            Token::Source(_) => {}
            Token::DocEnd { token, end } => {
                let document = documents
                    .last_mut()
                    .ok_or(SyntaxError(Message::UnexpectedToken, token.offset))?;
                let (_, offset) = resolve_end(end.map(|end| tree.list(end)), token.end, true)?;
                document.range[2] = offset;
            }
            _ => return Err(SyntaxError(Message::UnexpectedToken, token.offset())),
        }
    }
    if at_directives {
        return Err(SyntaxError(
            Message::ExpectedDocumentStart,
            text.len() as u32,
        ));
    }
    if documents.is_empty() {
        let end = text.len() as u32;
        documents.push(Document {
            contents: None,
            range: [0, end, end],
        });
    }
    Ok(documents)
}
