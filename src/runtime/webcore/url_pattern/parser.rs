//! <https://urlpattern.spec.whatwg.org/#pattern-strings>

use core::ops::Range;

use bun_collections::smallvec::SmallVec;
use bun_core::{EncodedSlice, String};

use super::PatternError;
use super::canonicalize::{Encoding, Text, allocated, concat};
use super::tokenizer::{Policy, Token, TokenType, Tokens, is_valid_name_code_point, tokenize};

const FULL_WILDCARD_REGEXP: &[u8] = b".*";

#[derive(Clone, Copy)]
pub(super) struct Options {
    /// What the delimiter code point makes.
    segment_wildcard_regexp: &'static [u8],
    prefix: Option<u8>,
    pub(super) ignore_case: bool,
}

impl Options {
    pub(super) const DEFAULT: Self = Self {
        segment_wildcard_regexp: b"[^]+?",
        prefix: None,
        ignore_case: false,
    };
    pub(super) const HOSTNAME: Self = Self {
        segment_wildcard_regexp: br"[^\.]+?",
        ..Self::DEFAULT
    };
    pub(super) const PATHNAME: Self = Self {
        segment_wildcard_regexp: br"[^\/]+?",
        prefix: Some(b'/'),
        ..Self::DEFAULT
    };

    pub(super) fn with_ignore_case(self, ignore_case: bool) -> Self {
        Self {
            ignore_case,
            ..self
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PartType {
    FixedText,
    Regexp,
    SegmentWildcard,
    FullWildcard,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Modifier {
    None,
    Optional,
    ZeroOrMore,
    OneOrMore,
}

impl Modifier {
    fn as_bytes(self) -> &'static [u8] {
        match self {
            Self::None => b"",
            Self::Optional => b"?",
            Self::ZeroOrMore => b"*",
            Self::OneOrMore => b"+",
        }
    }
}

struct Part {
    kind: PartType,
    modifier: Modifier,
    /// In the input. Empty for fixed text and for a group that is numbered.
    name: Range<usize>,
    /// In `Parts::text`, as are `prefix` and `suffix`.
    value: Range<usize>,
    prefix: Range<usize>,
    suffix: Range<usize>,
}

pub(super) struct Parts<'i> {
    input: EncodedSlice<'i>,
    options: Options,
    list: SmallVec<[Part; 8]>,
    /// ASCII.
    text: SmallVec<[u8; 128]>,
}

/// A string being built. Once it is too long, or there is no memory for it, what is appended is dropped.
struct Builder {
    utf8: SmallVec<[u8; 128]>,
    /// In code units of the string that it becomes.
    remaining_length: usize,
    has_overflowed: bool,
}

impl Builder {
    fn new() -> Self {
        Self {
            utf8: SmallVec::new(),
            remaining_length: String::max_length(),
            has_overflowed: false,
        }
    }

    fn reserve(&mut self, length: usize, utf8_length: usize) -> bool {
        self.has_overflowed = self.has_overflowed
            || length > self.remaining_length
            || self.utf8.try_reserve(utf8_length).is_err();
        self.remaining_length = self.remaining_length.saturating_sub(length);
        !self.has_overflowed
    }

    #[inline(never)]
    fn append(&mut self, ascii: &[&[u8]]) {
        for piece in ascii {
            if self.reserve(piece.len(), piece.len()) {
                self.utf8.extend_from_slice(piece);
            }
        }
    }

    fn append_name(&mut self, name: EncodedSlice<'_>) {
        let utf8 = name.to_utf8();
        if self.reserve(name.len, utf8.len()) {
            self.utf8.extend_from_slice(&utf8);
        }
    }

    fn append_escaped(&mut self, ascii: &[u8], is_syntax: impl Fn(u8) -> bool) {
        let length = ascii.len() + ascii.iter().filter(|&&byte| is_syntax(byte)).count();
        if !self.reserve(length, length) {
            return;
        }
        for &byte in ascii {
            if is_syntax(byte) {
                self.utf8.push(b'\\');
            }
            self.utf8.push(byte);
        }
    }

    /// <https://urlpattern.spec.whatwg.org/#escape-a-regexp-string>
    fn append_escaped_regexp(&mut self, ascii: &[u8]) {
        self.append_escaped(ascii, |byte| {
            matches!(
                byte,
                b'.' | b'+'
                    | b'*'
                    | b'?'
                    | b'^'
                    | b'$'
                    | b'{'
                    | b'}'
                    | b'('
                    | b')'
                    | b'['
                    | b']'
                    | b'|'
                    | b'/'
                    | b'\\'
            )
        });
    }

    /// <https://urlpattern.spec.whatwg.org/#escape-a-pattern-string>
    fn append_escaped_pattern(&mut self, ascii: &[u8]) {
        self.append_escaped(ascii, |byte| {
            matches!(
                byte,
                b'+' | b'*' | b'?' | b':' | b'(' | b')' | b'\\' | b'{' | b'}'
            )
        });
    }

    fn finish(&self) -> Result<String, PatternError> {
        if self.has_overflowed {
            return Err(PatternError::OutOfMemory);
        }
        allocated(String::clone_utf8(&self.utf8))
    }
}

pub(super) fn escape_pattern_string(ascii: &[u8]) -> Result<String, PatternError> {
    let mut result = Builder::new();
    result.append_escaped_pattern(ascii);
    result.finish()
}

/// Indexes of tokens. The text is that of the characters among them, and the first and the last are characters.
type FixedText = Range<usize>;

struct Parser<'p, 'i> {
    tokens: Tokens,
    index: usize,
    encoding: Encoding,
    pending_fixed_value: FixedText,
    parts: &'p mut Parts<'i>,
}

impl<'i> Parser<'_, 'i> {
    fn value(&self, token: Token) -> EncodedSlice<'i> {
        self.parts.input_at(&token.value())
    }

    fn text(&self, fixed_text: FixedText) -> Result<Text<'i>, PatternError> {
        let tokens = &self.tokens[fixed_text];
        let (Some(first), Some(last)) = (tokens.first(), tokens.last()) else {
            return Ok(Text::EMPTY);
        };
        if tokens[1..]
            .iter()
            .all(|token| token.kind == TokenType::Char)
        {
            let range = first.value().start..last.value().end;
            return Ok(Text::Borrowed(self.parts.input_at(&range)));
        }
        let characters = tokens
            .iter()
            .filter(|token| matches!(token.kind, TokenType::Char | TokenType::EscapedChar));
        concat(characters.map(|&token| self.value(token))).map(Text::Owned)
    }

    fn add_canonical_text(&mut self, fixed_text: FixedText) -> Result<Range<usize>, PatternError> {
        let canonical = self.encoding.canonicalize(self.text(fixed_text)?.get())?;
        Ok(self.parts.add_text(canonical.get()))
    }

    fn add_fixed_text(
        &mut self,
        fixed_text: FixedText,
        modifier: Modifier,
    ) -> Result<(), PatternError> {
        if fixed_text.is_empty() {
            return Ok(());
        }
        let value = self.add_canonical_text(fixed_text)?;
        self.parts.list.push(Part {
            kind: PartType::FixedText,
            modifier,
            name: 0..0,
            value,
            prefix: 0..0,
            suffix: 0..0,
        });
        Ok(())
    }

    /// Nothing but `{` and `}` is between what is pending and `fixed_text`.
    fn append_to_pending_fixed_value(&mut self, fixed_text: FixedText) {
        if self.pending_fixed_value.is_empty() {
            self.pending_fixed_value = fixed_text;
        } else if !fixed_text.is_empty() {
            self.pending_fixed_value.end = fixed_text.end;
        }
    }

    fn add_pending_fixed_value(&mut self) -> Result<(), PatternError> {
        let pending = core::mem::take(&mut self.pending_fixed_value);
        self.add_fixed_text(pending, Modifier::None)
    }

    fn try_consume(&mut self, kind: TokenType) -> Option<Token> {
        let token = *self.tokens.get(self.index)?;
        if token.kind != kind {
            return None;
        }
        self.index += 1;
        Some(token)
    }

    fn try_consume_regexp_or_wildcard(&mut self, name: Option<Token>) -> Option<Token> {
        let regexp = self.try_consume(TokenType::Regexp);
        if regexp.is_none() && name.is_none() {
            return self.try_consume(TokenType::Asterisk);
        }
        regexp
    }

    fn consume_modifier(&mut self) -> Modifier {
        if let Some(token) = self.try_consume(TokenType::OtherModifier) {
            if self.value(token).eq_ascii(b"?") {
                return Modifier::Optional;
            }
            return Modifier::OneOrMore;
        }
        match self.try_consume(TokenType::Asterisk) {
            Some(_) => Modifier::ZeroOrMore,
            None => Modifier::None,
        }
    }

    fn consume_text(&mut self) -> FixedText {
        let start = self.index;
        while self.try_consume(TokenType::Char).is_some()
            || self.try_consume(TokenType::EscapedChar).is_some()
        {}
        start..self.index
    }

    fn consume_required(&mut self, kind: TokenType) -> Result<(), PatternError> {
        match self.try_consume(kind) {
            Some(_) => Ok(()),
            None => Err(PatternError::Type(
                "Null token was produced when consuming a required token.",
            )),
        }
    }

    /// <https://urlpattern.spec.whatwg.org/#add-a-part>
    fn add_part(
        &mut self,
        prefix: FixedText,
        name: Option<Token>,
        regexp_or_wildcard: Option<Token>,
        suffix: FixedText,
        modifier: Modifier,
    ) -> Result<(), PatternError> {
        let is_fixed_text = name.is_none() && regexp_or_wildcard.is_none();
        if is_fixed_text && modifier == Modifier::None {
            self.append_to_pending_fixed_value(prefix);
            return Ok(());
        }
        self.add_pending_fixed_value()?;
        if is_fixed_text {
            return self.add_fixed_text(prefix, modifier);
        }

        let (kind, value) = match regexp_or_wildcard {
            None => (PartType::SegmentWildcard, 0..0),
            Some(token) if token.kind == TokenType::Asterisk => (PartType::FullWildcard, 0..0),
            Some(token) => {
                let regexp = self.value(token);
                if regexp.eq_ascii(self.parts.options.segment_wildcard_regexp) {
                    (PartType::SegmentWildcard, 0..0)
                } else if regexp.eq_ascii(FULL_WILDCARD_REGEXP) {
                    (PartType::FullWildcard, 0..0)
                } else {
                    (PartType::Regexp, self.parts.add_text(regexp))
                }
            }
        };

        // Numbers do not repeat, and a name does not start with a digit.
        if let Some(name) = name.map(|name| self.value(name).byte_slice())
            && (self.parts.group_names()).any(|other| other.byte_slice() == name)
        {
            return Err(PatternError::Type(
                "Duplicate name token produced when adding to parser part list.",
            ));
        }

        let prefix = self.add_canonical_text(prefix)?;
        let suffix = self.add_canonical_text(suffix)?;
        self.parts.list.push(Part {
            kind,
            modifier,
            name: name.map_or(0..0, Token::value),
            value,
            prefix,
            suffix,
        });
        Ok(())
    }

    fn parse(&mut self) -> Result<(), PatternError> {
        while self.index < self.tokens.len() {
            let start = self.index;
            let char_token = self.try_consume(TokenType::Char);
            let mut prefix = start..self.index;
            let name = self.try_consume(TokenType::Name);
            let regexp_or_wildcard = self.try_consume_regexp_or_wildcard(name);
            if name.is_some() || regexp_or_wildcard.is_some() {
                let prefix_code_point = self.parts.options.prefix.as_slice();
                if char_token.is_some_and(|token| !self.value(token).eq_ascii(prefix_code_point)) {
                    self.append_to_pending_fixed_value(core::mem::take(&mut prefix));
                }
                self.add_pending_fixed_value()?;
                let modifier = self.consume_modifier();
                self.add_part(prefix, name, regexp_or_wildcard, 0..0, modifier)?;
                continue;
            }

            if char_token.is_some() || self.try_consume(TokenType::EscapedChar).is_some() {
                self.append_to_pending_fixed_value(start..self.index);
                continue;
            }

            if self.try_consume(TokenType::Open).is_some() {
                let prefix = self.consume_text();
                let name = self.try_consume(TokenType::Name);
                let regexp_or_wildcard = self.try_consume_regexp_or_wildcard(name);
                let suffix = self.consume_text();
                self.consume_required(TokenType::Close)?;
                let modifier = self.consume_modifier();
                self.add_part(prefix, name, regexp_or_wildcard, suffix, modifier)?;
                continue;
            }

            self.add_pending_fixed_value()?;
            self.consume_required(TokenType::End)?;
        }
        Ok(())
    }
}

impl<'i> Parts<'i> {
    pub(super) fn new(input: EncodedSlice<'i>, options: Options) -> Self {
        Self {
            input,
            options,
            list: SmallVec::new(),
            text: SmallVec::new(),
        }
    }

    /// <https://urlpattern.spec.whatwg.org/#parse-a-pattern-string>
    pub(super) fn parse(&mut self, encoding: Encoding) -> Result<(), PatternError> {
        let mut parser = Parser {
            tokens: Tokens::new(),
            index: 0,
            encoding,
            pending_fixed_value: 0..0,
            parts: self,
        };
        tokenize(parser.parts.input, Policy::Strict, &mut parser.tokens)?;
        parser.parse()
    }

    fn input_at(&self, range: &Range<usize>) -> EncodedSlice<'i> {
        self.input.substring_with_len(range.start, range.end)
    }

    fn add_text(&mut self, ascii: EncodedSlice<'_>) -> Range<usize> {
        let start = self.text.len();
        if ascii.is_16bit() {
            let units = ascii.utf16_slice().iter();
            self.text.extend(units.map(|&unit| unit as u8));
        } else {
            self.text.extend_from_slice(ascii.slice());
        }
        start..self.text.len()
    }

    fn text(&self, range: &Range<usize>) -> &[u8] {
        &self.text[range.clone()]
    }

    /// Empty for a group that is numbered.
    pub(super) fn group_names(&self) -> impl Iterator<Item = EncodedSlice<'i>> {
        self.list
            .iter()
            .filter(|part| part.kind != PartType::FixedText)
            .map(|part| self.input_at(&part.name))
    }

    pub(super) fn has_regexp_groups(&self) -> bool {
        self.list.iter().any(|part| part.kind == PartType::Regexp)
    }

    /// <https://urlpattern.spec.whatwg.org/#generate-a-regular-expression-and-name-list>
    pub(super) fn to_regexp(&self) -> Result<String, PatternError> {
        let mut result = Builder::new();
        result.append(&[b"^"]);
        for part in &self.list {
            let modifier = part.modifier.as_bytes();
            let regexp = match part.kind {
                PartType::FixedText if part.modifier == Modifier::None => {
                    result.append_escaped_regexp(self.text(&part.value));
                    continue;
                }
                PartType::FixedText => {
                    result.append(&[b"(?:"]);
                    result.append_escaped_regexp(self.text(&part.value));
                    result.append(&[b")", modifier]);
                    continue;
                }
                PartType::Regexp => self.text(&part.value),
                PartType::SegmentWildcard => self.options.segment_wildcard_regexp,
                PartType::FullWildcard => FULL_WILDCARD_REGEXP,
            };
            let (prefix, suffix) = (self.text(&part.prefix), self.text(&part.suffix));
            let repeats = matches!(part.modifier, Modifier::ZeroOrMore | Modifier::OneOrMore);
            if prefix.is_empty() && suffix.is_empty() {
                if repeats {
                    result.append(&[b"((?:", regexp, b")", modifier, b")"]);
                } else {
                    result.append(&[b"(", regexp, b")", modifier]);
                }
                continue;
            }
            result.append(&[b"(?:"]);
            result.append_escaped_regexp(prefix);
            if !repeats {
                result.append(&[b"(", regexp, b")"]);
                result.append_escaped_regexp(suffix);
                result.append(&[b")", modifier]);
                continue;
            }
            result.append(&[b"((?:", regexp, b")(?:"]);
            result.append_escaped_regexp(suffix);
            result.append_escaped_regexp(prefix);
            result.append(&[b"(?:", regexp, b"))*)"]);
            result.append_escaped_regexp(suffix);
            result.append(&[b")"]);
            if part.modifier == Modifier::ZeroOrMore {
                result.append(&[b"?"]);
            }
        }
        result.append(&[b"$"]);
        result.finish()
    }

    fn needs_grouping(&self, part: &Part, previous: Option<&Part>, next: Option<&Part>) -> bool {
        let prefix = self.text(&part.prefix);
        if !part.suffix.is_empty()
            || (!prefix.is_empty() && prefix != self.options.prefix.as_slice())
        {
            return true;
        }
        if !part.name.is_empty()
            && part.kind == PartType::SegmentWildcard
            && part.modifier == Modifier::None
            && let Some(next) = next
            && next.prefix.is_empty()
            && next.suffix.is_empty()
        {
            let continues_name = if next.kind == PartType::FixedText {
                let first = self.text(&next.value).first();
                first.is_some_and(|&first| is_valid_name_code_point(first.into(), false))
            } else {
                next.name.is_empty()
            };
            if continues_name {
                return true;
            }
        }
        prefix.is_empty()
            && self.options.prefix.is_some()
            && previous.is_some_and(|previous| {
                previous.kind == PartType::FixedText
                    && self.text(&previous.value).last().copied() == self.options.prefix
            })
    }

    /// <https://urlpattern.spec.whatwg.org/#generate-a-pattern-string>
    pub(super) fn to_pattern_string(&self) -> Result<String, PatternError> {
        let mut result = Builder::new();
        let mut previous = None::<&Part>;
        for (index, part) in self.list.iter().enumerate() {
            let previous = previous.replace(part);
            let modifier = part.modifier.as_bytes();
            if part.kind == PartType::FixedText {
                if part.modifier == Modifier::None {
                    result.append_escaped_pattern(self.text(&part.value));
                } else {
                    result.append(&[b"{"]);
                    result.append_escaped_pattern(self.text(&part.value));
                    result.append(&[b"}", modifier]);
                }
                continue;
            }

            let has_name = !part.name.is_empty();
            let needs_grouping = self.needs_grouping(part, previous, self.list.get(index + 1));
            let suffix = self.text(&part.suffix);
            if needs_grouping {
                result.append(&[b"{"]);
            }
            result.append_escaped_pattern(self.text(&part.prefix));
            if has_name {
                result.append(&[b":"]);
                result.append_name(self.input_at(&part.name));
            }
            match part.kind {
                PartType::FixedText => {}
                PartType::Regexp => result.append(&[b"(", self.text(&part.value), b")"]),
                PartType::SegmentWildcard if !has_name => {
                    result.append(&[b"(", self.options.segment_wildcard_regexp, b")"]);
                }
                PartType::SegmentWildcard => {
                    // The spec asks whether the suffix can continue a name. WebKit asks whether it can start one.
                    let first = suffix.first();
                    if first.is_some_and(|&first| is_valid_name_code_point(first.into(), true)) {
                        result.append(&[b"\\"]);
                    }
                }
                PartType::FullWildcard => {
                    let is_unambiguous = !has_name
                        && (needs_grouping
                            || !part.prefix.is_empty()
                            || previous.is_none_or(|previous| {
                                previous.kind == PartType::FixedText
                                    || previous.modifier != Modifier::None
                            }));
                    result.append(&[if is_unambiguous { b"*" } else { b"(.*)" }]);
                }
            }
            result.append_escaped_pattern(suffix);
            if needs_grouping {
                result.append(&[b"}"]);
            }
            result.append(&[modifier]);
        }
        result.finish()
    }
}
