//! `angular-html-parser` 10.12: `ml_parser/lexer.ts`, without the syntax that Prettier does not turn on.
//!
//! The text has `\n` only. What a token says is a part of the text, so a token has ranges of it.

use bun_core::strings;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum TokenType {
    TagOpenStart,
    TagOpenEnd,
    TagOpenEndVoid,
    TagClose,
    IncompleteTagOpen,
    Text,
    EscapableRawText,
    RawText,
    Interpolation,
    EncodedEntity,
    CommentStart,
    CommentEnd,
    InElementComment,
    CdataStart,
    CdataEnd,
    AttrName,
    AttrQuote,
    AttrValueText,
    AttrValueInterpolation,
    DocTypeStart,
    DocTypeEnd,
    ExpansionFormStart,
    ExpansionCaseValue,
    ExpansionCaseExpStart,
    ExpansionCaseExpEnd,
    ExpansionFormEnd,
    BlockOpenStart,
    BlockOpenEnd,
    BlockClose,
    BlockParameter,
    IncompleteBlockOpen,
    LetStart,
    LetValue,
    LetEnd,
    IncompleteLet,
    Eof,
}

#[derive(Debug, Copy, Clone, Default, PartialEq, Eq)]
pub(crate) struct Span {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

impl Span {
    pub(crate) fn new(start: u32, end: u32) -> Span {
        Span { start, end }
    }

    pub(crate) fn of(self, text: &[u8]) -> &[u8] {
        text.get(self.start as usize..self.end as usize).unwrap_or_default()
    }

    pub(crate) fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }
}

/// `token.parts`, where it is not all of the text of the token.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Parts {
    /// None, or the text of the token.
    None,
    /// The prefix and the name of a tag or an attribute.
    Name(Span, Span),
    /// The name of a block or a declaration, the value of a case.
    Value(Span),
    /// `else if`, however many blanks there are.
    ElseIf,
    /// `default never`, however many blanks there are.
    DefaultNever,
    /// What is in a comment in a start tag, and whether the comment ends with the line.
    Comment(Span, bool),
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct Token {
    pub(crate) kind: TokenType,
    pub(crate) span: Span,
    pub(crate) parts: Parts,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ContentType {
    RawText,
    EscapableRawText,
    ParsableData,
}

/// An attribute, for the one who decides what is in the element.
pub(crate) struct LexedAttribute<'a> {
    pub(crate) name: &'a [u8],
    /// The last piece of text in the value.
    pub(crate) value: Option<&'a [u8]>,
}

#[derive(Copy, Clone, Default)]
pub(crate) struct Options {
    /// `tokenizeExpansionForms` and `tokenizeBlocks`
    pub(crate) tokenize_angular_blocks: bool,
    pub(crate) tokenize_let: bool,
    pub(crate) can_self_close: bool,
    pub(crate) allow_htm_component_closing_tags: bool,
    pub(crate) allow_start_tag_comments: bool,
}

/// `getTagContentType(tagName, prefix, hasParent, attrs)`, without the prefix, which nobody looks at.
pub(crate) type GetTagContentType<'f> = &'f dyn Fn(&[u8], bool, &[LexedAttribute<'_>]) -> ContentType;

/// What is thrown.
enum Fail {
    /// A `ParseError`, with where its span starts.
    Parse(u32),
    /// A `CursorError`: the end of the text where there has to be more.
    Cursor(u32),
}

type Result<T> = std::result::Result<T, Fail>;

/// When a text with interpolations ends.
#[derive(Copy, Clone)]
enum End {
    Text,
    TagStart,
    Quote(u32),
    Name,
}

/// What ends a raw text.
#[derive(Copy, Clone)]
enum EndMarker<'a> {
    Str(&'static [u8]),
    GreaterThan,
    /// `</` and this name.
    TagClose(&'a [u8]),
}

const SUPPORTED_BLOCKS: [&[u8]; 13] = [
    b"@if",
    b"@else",
    b"@for",
    b"@switch",
    b"@case",
    b"@default",
    b"@empty",
    b"@defer",
    b"@placeholder",
    b"@loading",
    b"@boundary",
    b"@error",
    b"@content",
];

/// A character that is not ASCII and not a no-break space.
const OTHER: u32 = 0xFFFF;
const NBSP: u32 = 160;

fn is_whitespace(code: u32) -> bool {
    (9..=32).contains(&code) || code == NBSP
}

fn is_not_whitespace(code: u32) -> bool {
    !is_whitespace(code) || code == 0
}

fn is_ascii_letter(code: u32) -> bool {
    code < 128 && (code as u8).is_ascii_alphabetic()
}

fn is_digit(code: u32) -> bool {
    code < 128 && (code as u8).is_ascii_digit()
}

fn is_new_line(code: u32) -> bool {
    code == 10 || code == 13
}

fn is_quote(code: u32) -> bool {
    matches!(code, 39 | 34 | 96)
}

fn is_name_end(code: u32) -> bool {
    is_whitespace(code) || matches!(code, 62 | 60 | 47 | 39 | 34 | 61 | 0)
}

fn is_prefix_end(code: u32) -> bool {
    !is_ascii_letter(code) && !is_digit(code)
}

fn is_digit_entity_end(code: u32) -> bool {
    code == 59 || code == 0 || !(code < 128 && (code as u8).is_ascii_hexdigit())
}

fn is_named_entity_end(code: u32) -> bool {
    code == 59 || code == 0 || !(is_ascii_letter(code) || is_digit(code))
}

fn is_block_name_char(code: u32) -> bool {
    is_ascii_letter(code) || is_digit(code) || code == 95
}

fn is_block_parameter_char(code: u32) -> bool {
    code != 59 && is_not_whitespace(code)
}

fn is_attribute_terminator(code: u32) -> bool {
    matches!(code, 47 | 62 | 60 | 0)
}

/// `/^a[^\S\r\n]+b/`
fn is_two_words(text: &[u8], first: &[u8], second: &[u8]) -> bool {
    let Some(mut rest) = text.strip_prefix(first) else {
        return false;
    };
    let before = rest.len();
    while let Some(len) = crate::css::text::white_space_len_at_start(rest).filter(|_| !matches!(rest[0], b'\n' | b'\r')) {
        rest = &rest[len..];
    }
    rest.len() < before && rest.starts_with(second)
}

struct Tokenizer<'a, 'f> {
    text: &'a [u8],
    /// `_cursor`
    pos: usize,
    get_tag_content_type: GetTagContentType<'f>,
    options: Options,
    /// `_currentTokenStart` and `_currentTokenType`
    current: Option<(u32, TokenType)>,
    expansion_case_stack: Vec<TokenType>,
    /// The prefixes and the names.
    full_name_stack: Vec<(Span, Span)>,
    /// Of the start tag that is being read.
    attributes: Vec<LexedAttribute<'a>>,
    tokens: Vec<Token>,
    errors: Vec<u32>,
}

impl<'a> Tokenizer<'a, '_> {
    fn peek_at(&self, pos: usize) -> u32 {
        match self.text.get(pos) {
            None => 0,
            Some(&byte) if byte < 128 => u32::from(byte),
            Some(0xC2) if self.text.get(pos + 1) == Some(&0xA0) => NBSP,
            Some(_) => OTHER,
        }
    }

    fn peek(&self) -> u32 {
        self.peek_at(self.pos)
    }

    fn advance(&mut self) -> Result<()> {
        if self.pos >= self.text.len() {
            return Err(Fail::Cursor(self.pos as u32));
        }
        self.pos += if self.peek() == NBSP { 2 } else { 1 };
        Ok(())
    }

    fn span_from(&self, start: usize) -> Span {
        Span::new(start as u32, self.pos as u32)
    }

    fn begin_token(&mut self, kind: TokenType) {
        self.current = Some((self.pos as u32, kind));
    }

    fn begin_token_at(&mut self, kind: TokenType, start: usize) {
        self.current = Some((start as u32, kind));
    }

    /// Returns the index of the token.
    fn end_token_at(&mut self, parts: Parts, end: usize) -> Result<usize> {
        let (start, kind) = self.current.take().ok_or(Fail::Parse(end as u32))?;
        self.tokens.push(Token {
            kind,
            span: Span::new(start, end as u32),
            parts,
        });
        Ok(self.tokens.len() - 1)
    }

    fn end_token(&mut self, parts: Parts) -> Result<usize> {
        self.end_token_at(parts, self.pos)
    }

    /// `_createError`
    fn error(&mut self, start: usize) -> Fail {
        self.current = None;
        Fail::Parse(start as u32)
    }

    fn attempt_char_code(&mut self, code: u32) -> bool {
        if self.peek() == code && self.pos < self.text.len() {
            self.pos += 1;
            return true;
        }
        false
    }

    fn require_char_code(&mut self, code: u32) -> Result<()> {
        match self.attempt_char_code(code) {
            true => Ok(()),
            false => Err(self.error(self.pos)),
        }
    }

    fn peek_str(&self, chars: &[u8]) -> bool {
        self.text.get(self.pos..).is_some_and(|rest| rest.starts_with(chars))
    }

    fn attempt_str(&mut self, chars: &[u8]) -> bool {
        let is_next = self.peek_str(chars);
        if is_next {
            self.pos += chars.len();
        }
        is_next
    }

    /// What matches is consumed even if not all of it does.
    fn attempt_str_case_insensitive(&mut self, chars: &[u8]) -> bool {
        for expected in chars {
            match self.text.get(self.pos) {
                Some(byte) if byte.eq_ignore_ascii_case(expected) => self.pos += 1,
                _ => return false,
            }
        }
        true
    }

    fn require_str(&mut self, chars: &[u8]) -> Result<()> {
        match self.attempt_str(chars) {
            true => Ok(()),
            false => Err(self.error(self.pos)),
        }
    }

    fn attempt_char_code_until(&mut self, mut predicate: impl FnMut(u32) -> bool) -> Result<()> {
        while !predicate(self.peek()) {
            self.advance()?;
        }
        Ok(())
    }

    fn skip_whitespace(&mut self) {
        while !is_not_whitespace(self.peek()) {
            self.pos += if self.peek() == NBSP { 2 } else { 1 };
        }
    }

    fn require_char_code_until(&mut self, predicate: impl FnMut(u32) -> bool, len: usize) -> Result<()> {
        let start = self.pos;
        self.attempt_char_code_until(predicate)?;
        if self.pos - start < len {
            return Err(self.error(start));
        }
        Ok(())
    }

    fn attempt_until_ignore_quotes(&mut self, predicate: impl Fn(u32) -> bool) -> Result<()> {
        while self.peek() != 0 {
            let char = self.peek();
            if predicate(char) {
                break;
            }
            if is_quote(char) {
                self.advance()?;
                loop {
                    let inner = self.peek();
                    if inner == 92 {
                        self.advance()?;
                    } else if inner == char {
                        break;
                    }
                    self.advance()?;
                }
            }
            self.advance()?;
        }
        Ok(())
    }

    fn is_block_start(&self) -> bool {
        self.peek() == 64 && SUPPORTED_BLOCKS.iter().any(|name| self.peek_str(name))
    }

    fn is_let_start(&self) -> bool {
        self.peek_str(b"@let")
    }

    fn is_in_expansion_case(&self) -> bool {
        self.expansion_case_stack.last() == Some(&TokenType::ExpansionCaseExpStart)
    }

    fn is_in_expansion_form(&self) -> bool {
        self.expansion_case_stack.last() == Some(&TokenType::ExpansionFormStart)
    }

    fn is_expansion_form_start(&self) -> bool {
        self.peek() == 123 && !self.peek_str(b"{{")
    }

    fn is_tag_start(&self) -> bool {
        self.peek() == 60 && {
            let code = self.peek_at(self.pos + 1);
            is_ascii_letter(code) || matches!(code, 47 | 33 | 63)
        }
    }

    fn is_text_end(&self) -> bool {
        if self.is_tag_start() || self.peek() == 0 {
            return true;
        }
        if !self.options.tokenize_angular_blocks {
            return false;
        }
        if self.is_expansion_form_start() || (self.peek() == 125 && self.is_in_expansion_case()) {
            return true;
        }
        !self.is_in_expansion_case()
            && !self.is_in_expansion_form()
            && (self.is_block_start() || self.is_let_start() || self.peek() == 125)
    }

    fn is_end(&self, end: End) -> bool {
        match end {
            End::Text => self.is_text_end(),
            End::TagStart => self.is_tag_start(),
            End::Quote(quote) => self.peek() == quote,
            End::Name => is_name_end(self.peek()),
        }
    }

    /// Goes on to the next character that can end a text that `end` ends, or start something in it.
    fn skip_plain_text(&mut self, end: End) {
        let rest = self.text.get(self.pos..).unwrap_or_default();
        let next = match end {
            End::Text if self.options.tokenize_angular_blocks => strings::index_of_any(rest, b"<{&\0@}"),
            End::Text => strings::index_of_any(rest, b"<{&\0"),
            End::Quote(quote) => strings::index_of_any(rest, &[quote as u8, b'{', b'&']),
            End::TagStart | End::Name => return,
        };
        self.pos += next.unwrap_or(rest.len());
    }

    fn tokenize(&mut self) {
        while self.peek() != 0 {
            let start = self.pos;
            match self.tokenize_one() {
                // Nothing goes on from here.
                Ok(()) if self.pos == start => {
                    self.errors.push(start as u32);
                    break;
                }
                Ok(()) => {}
                Err(Fail::Parse(at)) => self.errors.push(at),
                Err(Fail::Cursor(at)) => {
                    self.current = None;
                    self.errors.push(at);
                }
            }
        }
        self.begin_token(TokenType::Eof);
        let _ = self.end_token(Parts::None);
    }

    fn tokenize_one(&mut self) -> Result<()> {
        let start = self.pos;
        let blocks = self.options.tokenize_angular_blocks;
        if self.attempt_char_code(60) {
            if self.attempt_char_code(33) {
                if self.attempt_str(b"[CDATA[") {
                    self.consume_delimited(start, TokenType::CdataStart, TokenType::CdataEnd, EndMarker::Str(b"]]>"))
                } else if self.attempt_str(b"--") {
                    self.consume_delimited(start, TokenType::CommentStart, TokenType::CommentEnd, EndMarker::Str(b"-->"))
                } else if self.attempt_str_case_insensitive(b"doctype") {
                    self.consume_delimited(start, TokenType::DocTypeStart, TokenType::DocTypeEnd, EndMarker::GreaterThan)
                } else {
                    self.consume_delimited(start, TokenType::CommentStart, TokenType::CommentEnd, EndMarker::GreaterThan)
                }
            } else if self.attempt_char_code(47) {
                self.consume_tag_close(start)
            } else if self.peek() == 63 {
                self.consume_delimited(start, TokenType::CommentStart, TokenType::CommentEnd, EndMarker::GreaterThan)
            } else {
                self.consume_tag_open(start)
            }
        } else if self.options.tokenize_let && self.is_let_start() {
            self.consume_let_declaration(start)
        } else if blocks && self.is_block_start() {
            self.consume_block_start(start)
        } else if blocks && !self.is_in_expansion_case() && !self.is_in_expansion_form() && self.attempt_char_code(125) {
            self.begin_token_at(TokenType::BlockClose, start);
            self.end_token(Parts::None).map(|_| ())
        } else if !(blocks && self.tokenize_expansion_form()?) {
            self.consume_with_interpolation(TokenType::Text, TokenType::Interpolation, End::Text, End::TagStart).map(|_| ())
        } else {
            Ok(())
        }
    }

    fn block_name(&mut self) -> Result<Parts> {
        let mut spaces_in_name_allowed = false;
        let start = self.pos;
        self.attempt_char_code_until(|code| {
            if is_whitespace(code) {
                return !spaces_in_name_allowed;
            }
            if is_block_name_char(code) {
                spaces_in_name_allowed = true;
                return false;
            }
            true
        })?;
        let name = trimmed(self.text, self.span_from(start));
        Ok(if is_two_words(name.of(self.text), b"else", b"if") {
            Parts::ElseIf
        } else if is_two_words(name.of(self.text), b"default", b"never") {
            Parts::DefaultNever
        } else {
            Parts::Value(name)
        })
    }

    fn empty_token(&mut self, kind: TokenType) -> Result<()> {
        self.begin_token(kind);
        self.end_token(Parts::None).map(|_| ())
    }

    fn consume_block_start(&mut self, start: usize) -> Result<()> {
        self.require_char_code(64)?;
        self.begin_token_at(TokenType::BlockOpenStart, start);
        let name = self.block_name()?;
        let start_token = self.end_token(name)?;
        if self.peek() == 40 {
            self.advance()?;
            self.consume_block_parameters()?;
            self.skip_whitespace();
            if self.attempt_char_code(41) {
                self.skip_whitespace();
            } else {
                self.tokens[start_token].kind = TokenType::IncompleteBlockOpen;
                return Ok(());
            }
        }
        if name == Parts::DefaultNever && self.attempt_char_code(59) {
            self.empty_token(TokenType::BlockOpenEnd)?;
            return self.empty_token(TokenType::BlockClose);
        }
        let is_case = matches!(name, Parts::Value(name) if matches!(name.of(self.text), b"case" | b"default"));
        if self.peek() == 123 {
            // The token starts behind the brace.
            self.pos += 1;
            self.empty_token(TokenType::BlockOpenEnd)?;
        } else if self.is_block_start() && is_case {
            self.empty_token(TokenType::BlockOpenEnd)?;
            self.empty_token(TokenType::BlockClose)?;
        } else {
            self.tokens[start_token].kind = TokenType::IncompleteBlockOpen;
        }
        Ok(())
    }

    fn consume_block_parameters(&mut self) -> Result<()> {
        self.attempt_char_code_until(is_block_parameter_char)?;
        while self.peek() != 41 && self.peek() != 0 {
            self.begin_token(TokenType::BlockParameter);
            let mut in_quote = None;
            let mut open_parens = 0u32;
            while (self.peek() != 59 && self.peek() != 0) || in_quote.is_some() {
                let char = self.peek();
                if char == 92 {
                    self.advance()?;
                } else if Some(char) == in_quote {
                    in_quote = None;
                } else if in_quote.is_none() && is_quote(char) {
                    in_quote = Some(char);
                } else if char == 40 && in_quote.is_none() {
                    open_parens += 1;
                } else if char == 41 && in_quote.is_none() {
                    if open_parens == 0 {
                        break;
                    }
                    open_parens -= 1;
                }
                self.advance()?;
            }
            self.end_token(Parts::None)?;
            self.attempt_char_code_until(is_block_parameter_char)?;
        }
        Ok(())
    }

    fn consume_let_declaration(&mut self, start: usize) -> Result<()> {
        self.require_str(b"@let")?;
        self.begin_token_at(TokenType::LetStart, start);
        if is_whitespace(self.peek()) {
            self.skip_whitespace();
        } else {
            let parts = Parts::Value(self.span_from(start));
            let token = self.end_token(parts)?;
            self.tokens[token].kind = TokenType::IncompleteLet;
            return Ok(());
        }
        let name_start = self.pos;
        let mut allow_digit = false;
        self.attempt_char_code_until(|code| {
            if is_ascii_letter(code) || code == 36 || code == 95 || (allow_digit && is_digit(code)) {
                allow_digit = true;
                return false;
            }
            true
        })?;
        let name = Parts::Value(self.span_from(name_start));
        let start_token = self.end_token(name)?;
        self.skip_whitespace();
        if !self.attempt_char_code(61) {
            self.tokens[start_token].kind = TokenType::IncompleteLet;
            return Ok(());
        }
        self.attempt_char_code_until(|code| is_not_whitespace(code) && !is_new_line(code))?;
        self.begin_token(TokenType::LetValue);
        self.attempt_until_ignore_quotes(|char| char == 59)?;
        self.end_token(Parts::None)?;
        if self.peek() == 59 {
            self.begin_token(TokenType::LetEnd);
            self.advance()?;
            self.end_token(Parts::None)?;
        } else {
            self.tokens[start_token].kind = TokenType::IncompleteLet;
            self.tokens[start_token].span = self.span_from(start);
        }
        Ok(())
    }

    /// Returns whether a token has been made.
    fn tokenize_expansion_form(&mut self) -> Result<bool> {
        if self.is_expansion_form_start() {
            self.consume_expansion_form_start()?;
            return Ok(true);
        }
        if self.peek() != 125 && self.is_in_expansion_form() {
            self.consume_expansion_case_start()?;
            return Ok(true);
        }
        if self.peek() == 125 {
            if self.is_in_expansion_case() {
                self.begin_token(TokenType::ExpansionCaseExpEnd);
                self.require_char_code(125)?;
                self.end_token(Parts::None)?;
                self.skip_whitespace();
                self.expansion_case_stack.pop();
                return Ok(true);
            }
            if self.is_in_expansion_form() {
                self.begin_token(TokenType::ExpansionFormEnd);
                self.require_char_code(125)?;
                self.end_token(Parts::None)?;
                self.expansion_case_stack.pop();
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn read_until(&mut self, char: u32) -> Result<Span> {
        let start = self.pos;
        self.attempt_char_code_until(|code| code == char)?;
        Ok(self.span_from(start))
    }

    fn consume_expansion_form_start(&mut self) -> Result<()> {
        self.begin_token(TokenType::ExpansionFormStart);
        self.require_char_code(123)?;
        self.end_token(Parts::None)?;
        self.expansion_case_stack.push(TokenType::ExpansionFormStart);
        for _ in 0..2 {
            self.begin_token(TokenType::RawText);
            self.read_until(44)?;
            self.end_token(Parts::None)?;
            self.require_char_code(44)?;
            self.skip_whitespace();
        }
        Ok(())
    }

    fn consume_expansion_case_start(&mut self) -> Result<()> {
        self.begin_token(TokenType::ExpansionCaseValue);
        let value = self.read_until(123)?;
        self.end_token(Parts::Value(trimmed(self.text, value)))?;
        self.skip_whitespace();
        self.begin_token(TokenType::ExpansionCaseExpStart);
        self.require_char_code(123)?;
        self.end_token(Parts::None)?;
        self.skip_whitespace();
        self.expansion_case_stack.push(TokenType::ExpansionCaseExpStart);
        Ok(())
    }

    fn consume_entity(&mut self, text_token_type: TokenType) -> Result<()> {
        self.begin_token(TokenType::EncodedEntity);
        let start = self.pos;
        self.advance()?;
        if self.attempt_char_code(35) {
            let is_hex = self.attempt_char_code(120) || self.attempt_char_code(88);
            let code_start = self.pos;
            self.attempt_char_code_until(is_digit_entity_end)?;
            if self.peek() != 59 {
                self.advance()?;
                return Err(self.error(self.pos));
            }
            let digits = &self.text[code_start..self.pos];
            self.advance()?;
            // `String.fromCodePoint(parseInt(digits, radix))`
            let radix = if is_hex { 16 } else { 10 };
            let mut code: Option<u32> = None;
            for digit in digits.iter().map_while(|&byte| (byte as char).to_digit(radix)) {
                code = Some(code.unwrap_or(0).saturating_mul(radix).saturating_add(digit));
            }
            if code.is_none_or(|code| code > 0x10FFFF) {
                return Err(self.error(self.pos));
            }
            self.end_token(Parts::None)?;
            return Ok(());
        }
        let name_start = self.pos;
        self.attempt_char_code_until(is_named_entity_end)?;
        if self.peek() != 59 {
            self.begin_token_at(text_token_type, start);
            self.pos = name_start;
            self.end_token(Parts::None)?;
            return Ok(());
        }
        self.advance()?;
        let entity = &self.text[start..self.pos];
        if entity != b"&ngsp;" && bun_md::helpers::decode_entity_to_utf8(entity, &mut [0; 8]).is_none() {
            return Err(self.error(start));
        }
        self.end_token(Parts::None)?;
        Ok(())
    }

    /// Whether what ends a raw text is next.
    fn is_at_end_marker(&self, marker: EndMarker<'_>) -> bool {
        match marker {
            EndMarker::Str(chars) => self.peek_str(chars),
            EndMarker::GreaterThan => self.peek() == 62,
            EndMarker::TagClose(name) => {
                if !self.peek_str(b"</") {
                    return false;
                }
                let skip_whitespace = |mut pos: usize| {
                    while !is_not_whitespace(self.peek_at(pos)) {
                        pos += if self.peek_at(pos) == NBSP { 2 } else { 1 };
                    }
                    pos
                };
                let pos = skip_whitespace(self.pos + 2);
                let is_name = self.text.get(pos..pos + name.len()).is_some_and(|it| it.eq_ignore_ascii_case(name));
                is_name && self.peek_at(skip_whitespace(pos + name.len())) == 62
            }
        }
    }

    fn consume_raw_text(&mut self, consume_entities: bool, marker: EndMarker<'_>) -> Result<()> {
        let kind = if consume_entities { TokenType::EscapableRawText } else { TokenType::RawText };
        let first = match marker {
            EndMarker::Str(chars) => chars[0],
            EndMarker::GreaterThan => b'>',
            EndMarker::TagClose(_) => b'<',
        };
        self.begin_token(kind);
        loop {
            // Nothing happens before the next character that something can start with.
            let rest = self.text.get(self.pos..).unwrap_or_default();
            let next = match consume_entities {
                true => strings::index_of_any(rest, &[first, b'&']),
                false => strings::index_of_char_usize(rest, first),
            };
            self.pos += next.unwrap_or(rest.len());
            if self.is_at_end_marker(marker) {
                break;
            }
            if consume_entities && self.peek() == 38 {
                self.end_token(Parts::None)?;
                self.consume_entity(TokenType::EscapableRawText)?;
                self.begin_token(TokenType::EscapableRawText);
            } else {
                self.advance()?;
            }
        }
        self.end_token(Parts::None)?;
        Ok(())
    }

    /// A comment, a CDATA section or a document type.
    fn consume_delimited(&mut self, start: usize, start_kind: TokenType, end_kind: TokenType, marker: EndMarker<'_>) -> Result<()> {
        self.begin_token_at(start_kind, start);
        self.end_token(Parts::None)?;
        self.consume_raw_text(false, marker)?;
        self.begin_token(end_kind);
        match marker {
            EndMarker::Str(chars) => self.require_str(chars)?,
            _ => self.advance()?,
        }
        self.end_token(Parts::None)?;
        Ok(())
    }

    fn consume_prefix_and_name(&mut self, end_predicate: impl FnMut(u32) -> bool) -> Result<Parts> {
        let name_or_prefix_start = self.pos;
        while self.peek() != 58 && !is_prefix_end(self.peek()) {
            self.advance()?;
        }
        let (prefix, name_start) = if self.peek() == 58 {
            let prefix = self.span_from(name_or_prefix_start);
            self.advance()?;
            (prefix, self.pos)
        } else {
            (Span::new(name_or_prefix_start as u32, name_or_prefix_start as u32), name_or_prefix_start)
        };
        self.require_char_code_until(end_predicate, usize::from(prefix.len() > 0))?;
        Ok(Parts::Name(prefix, self.span_from(name_start)))
    }

    fn consume_start_tag_comment(&mut self, start: usize, is_single_line: bool) -> Result<()> {
        let content_start = self.pos;
        if is_single_line {
            self.attempt_char_code_until(|code| is_new_line(code) || code == 0)?;
            let content = self.span_from(content_start);
            self.begin_token_at(TokenType::InElementComment, start);
            self.end_token(Parts::Comment(content, true))?;
            self.skip_whitespace();
            return Ok(());
        }
        while self.peek() != 0 && !self.peek_str(b"*/") {
            self.advance()?;
        }
        let content = self.span_from(content_start);
        let mut span_end = self.pos;
        if self.attempt_str(b"*/") {
            span_end = self.pos;
            self.skip_whitespace();
        }
        self.begin_token_at(TokenType::InElementComment, start);
        self.end_token_at(Parts::Comment(content, false), span_end)?;
        Ok(())
    }

    /// What is in the `try` of `_consumeTagOpen`. `open_token`: the index of the first token, once it is
    /// there.
    fn consume_tag_open_tokens(&mut self, start: usize, open_token: &mut Option<usize>) -> Result<()> {
        if !is_ascii_letter(self.peek()) {
            return Err(self.error(start));
        }
        self.begin_token_at(TokenType::TagOpenStart, start);
        let parts = self.consume_prefix_and_name(is_name_end)?;
        *open_token = Some(self.end_token(parts)?);
        self.skip_whitespace();
        loop {
            if self.options.allow_start_tag_comments {
                let comment_start = self.pos;
                if self.attempt_str(b"//") {
                    self.consume_start_tag_comment(comment_start, true)?;
                    continue;
                }
                if self.attempt_str(b"/*") {
                    self.consume_start_tag_comment(comment_start, false)?;
                    continue;
                }
            }
            if is_attribute_terminator(self.peek()) {
                break;
            }
            let (name, value) = self.consume_attribute()?;
            let text = self.text;
            self.attributes.push(LexedAttribute {
                name: name.of(text),
                value: value.map(|value| value.of(text)),
            });
        }
        let kind = if self.attempt_char_code(47) { TokenType::TagOpenEndVoid } else { TokenType::TagOpenEnd };
        self.begin_token(kind);
        self.require_char_code(62)?;
        self.end_token(Parts::None)?;
        Ok(())
    }

    fn consume_tag_open(&mut self, start: usize) -> Result<()> {
        let mut open_token = None;
        self.attributes.clear();
        match self.consume_tag_open_tokens(start, &mut open_token) {
            Ok(()) => {}
            Err(Fail::Parse(_)) => {
                match open_token {
                    Some(token) => self.tokens[token].kind = TokenType::IncompleteTagOpen,
                    None => {
                        self.begin_token_at(TokenType::Text, start);
                        self.end_token(Parts::None)?;
                    }
                }
                return Ok(());
            }
            Err(fail) => return Err(fail),
        }
        if self.options.can_self_close && self.tokens.last().is_some_and(|token| token.kind == TokenType::TagOpenEndVoid) {
            return Ok(());
        }
        let Some(Parts::Name(prefix, name)) = open_token.map(|token| self.tokens[token].parts) else {
            return Ok(());
        };
        let text = self.text;
        let content_type = (self.get_tag_content_type)(name.of(text), !self.full_name_stack.is_empty(), &self.attributes);
        // `_handleFullNameStackForTagOpen`
        if self.full_name_stack.last().is_none_or(|&last| self.is_same_name(last, (prefix, name))) {
            self.full_name_stack.push((prefix, name));
        }
        if content_type == ContentType::ParsableData {
            return Ok(());
        }
        // `_consumeRawTextWithTagClose`
        let full_name = Span::new(if prefix.len() > 0 { prefix.start } else { name.start }, name.end);
        self.consume_raw_text(content_type == ContentType::EscapableRawText, EndMarker::TagClose(full_name.of(text)))?;
        self.begin_token(TokenType::TagClose);
        self.require_char_code_until(|code| code == 62, 3)?;
        self.advance()?;
        self.end_token(Parts::Name(prefix, name))?;
        self.handle_full_name_stack_for_tag_close(prefix, name);
        Ok(())
    }

    fn is_same_name(&self, a: (Span, Span), b: (Span, Span)) -> bool {
        a.0.of(self.text) == b.0.of(self.text) && a.1.of(self.text) == b.1.of(self.text)
    }

    fn handle_full_name_stack_for_tag_close(&mut self, prefix: Span, name: Span) {
        if self.full_name_stack.last().is_some_and(|&last| self.is_same_name(last, (prefix, name))) {
            self.full_name_stack.pop();
        }
    }

    /// Returns the name and the last piece of text in the value.
    fn consume_attribute(&mut self) -> Result<(Span, Option<Span>)> {
        let name_start = self.peek();
        if name_start == 39 || name_start == 34 {
            return Err(self.error(self.pos));
        }
        self.begin_token(TokenType::AttrName);
        let parts = if name_start == 91 {
            let mut open_brackets = 0i32;
            self.consume_prefix_and_name(|code| {
                if code == 91 {
                    open_brackets += 1;
                } else if code == 93 {
                    open_brackets -= 1;
                }
                if open_brackets <= 0 { is_name_end(code) } else { is_new_line(code) }
            })?
        } else {
            self.consume_prefix_and_name(is_name_end)?
        };
        self.end_token(parts)?;
        let name = match parts {
            Parts::Name(_, name) => name,
            _ => Span::default(),
        };
        let mut value = None;
        self.skip_whitespace();
        if self.attempt_char_code(61) {
            self.skip_whitespace();
            let (text, interpolation) = (TokenType::AttrValueText, TokenType::AttrValueInterpolation);
            let quote = self.peek();
            value = Some(if quote == 39 || quote == 34 {
                self.consume_quote(quote)?;
                let value = self.consume_with_interpolation(text, interpolation, End::Quote(quote), End::Quote(quote))?;
                self.consume_quote(quote)?;
                value
            } else {
                self.consume_with_interpolation(text, interpolation, End::Name, End::Name)?
            });
        }
        self.skip_whitespace();
        Ok((name, value))
    }

    fn consume_quote(&mut self, quote: u32) -> Result<()> {
        self.begin_token(TokenType::AttrQuote);
        self.require_char_code(quote)?;
        self.end_token(Parts::None)?;
        Ok(())
    }

    fn consume_tag_close(&mut self, start: usize) -> Result<()> {
        self.begin_token_at(TokenType::TagClose, start);
        self.skip_whitespace();
        if self.options.allow_htm_component_closing_tags && self.attempt_char_code(47) {
            self.skip_whitespace();
            self.require_char_code(62)?;
            self.end_token(Parts::None)?;
            return Ok(());
        }
        let parts = self.consume_prefix_and_name(is_name_end)?;
        self.skip_whitespace();
        self.require_char_code(62)?;
        self.end_token(parts)?;
        if let Parts::Name(prefix, name) = parts {
            self.handle_full_name_stack_for_tag_close(prefix, name);
        }
        Ok(())
    }

    /// Returns the last piece of text.
    fn consume_with_interpolation(
        &mut self,
        text_token_type: TokenType,
        interpolation_token_type: TokenType,
        end: End,
        end_interpolation: End,
    ) -> Result<Span> {
        self.begin_token(text_token_type);
        let mut text_start = self.pos;
        loop {
            self.skip_plain_text(end);
            if self.is_end(end) {
                break;
            }
            let current = self.pos;
            if self.attempt_str(b"{{") {
                self.end_token_at(Parts::None, current)?;
                self.consume_interpolation(interpolation_token_type, current, end_interpolation)?;
                self.begin_token(text_token_type);
                text_start = self.pos;
            } else if self.peek() == 38 {
                self.end_token(Parts::None)?;
                self.consume_entity(text_token_type)?;
                self.begin_token(text_token_type);
                text_start = self.pos;
            } else {
                self.advance()?;
            }
        }
        self.end_token(Parts::None)?;
        Ok(self.span_from(text_start))
    }

    fn consume_interpolation(&mut self, kind: TokenType, start: usize, premature_end: End) -> Result<()> {
        self.begin_token_at(kind, start);
        let mut in_quote = None;
        let mut in_comment = false;
        while self.peek() != 0 && !self.is_end(premature_end) {
            if self.is_tag_start() {
                self.end_token(Parts::None)?;
                return Ok(());
            }
            if in_quote.is_none() {
                if self.attempt_str(b"}}") {
                    self.end_token(Parts::None)?;
                    return Ok(());
                }
                if self.attempt_str(b"//") {
                    in_comment = true;
                }
            }
            let char = self.peek();
            self.advance()?;
            if char == 92 {
                self.advance()?;
            } else if Some(char) == in_quote {
                in_quote = None;
            } else if !in_comment && in_quote.is_none() && is_quote(char) {
                in_quote = Some(char);
            }
        }
        self.end_token(Parts::None)?;
        Ok(())
    }
}

/// `text.trim()`
fn trimmed(text: &[u8], span: Span) -> Span {
    let all = span.of(text);
    let without_start = crate::css::text::trim_start(all);
    let start = span.start + (all.len() - without_start.len()) as u32;
    Span::new(start, start + crate::css::text::trim_end(without_start).len() as u32)
}

/// `tokenize`, from `start` on. Returns the tokens and where the errors are.
pub(crate) fn tokenize(
    text: &[u8],
    start: usize,
    get_tag_content_type: GetTagContentType<'_>,
    options: Options,
) -> (Vec<Token>, Vec<u32>) {
    let mut tokenizer = Tokenizer {
        text,
        pos: start,
        get_tag_content_type,
        options,
        current: None,
        expansion_case_stack: Vec::new(),
        full_name_stack: Vec::new(),
        attributes: Vec::new(),
        tokens: Vec::new(),
        errors: Vec::new(),
    };
    tokenizer.tokenize();
    // `mergeTextTokens`
    let mut merged: Vec<Token> = Vec::with_capacity(tokenizer.tokens.len());
    for token in tokenizer.tokens {
        match merged.last_mut() {
            Some(last) if last.kind == token.kind && matches!(token.kind, TokenType::Text | TokenType::AttrValueText) => {
                last.span.end = token.span.end;
            }
            _ => merged.push(token),
        }
    }
    (merged, tokenizer.errors)
}
