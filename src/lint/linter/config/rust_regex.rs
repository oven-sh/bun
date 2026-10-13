//! What Rust's `regex` says about a pattern that it cannot parse. oxlint compiles the patterns in the options of its rules with
//! it, and refuses a configuration file with these words.
//!
//! This is the parser of `regex-syntax` 0.8 without the tree: function by function, under the same names. Of what comes after the
//! parser it has what `(?-u)` makes wrong. It does not know the names of Unicode's properties that are longer than a letter, how
//! deep a pattern can be nested or how large a compiled one can be, and lets all that pass.

use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq)]
struct Position {
    offset: usize,
    line: usize,
    /// In characters, from 1.
    column: usize,
}

#[derive(Copy, Clone)]
struct Span {
    start: Position,
    end: Position,
}

struct Error {
    kind: &'static str,
    span: Span,
    /// Where the first of two is.
    original: Option<Span>,
}

type Parsed<T> = Result<T, Error>;

#[derive(Copy, Clone)]
enum Primitive {
    Literal(char),
    /// `\d`, `\pL`
    Class,
    /// `\b`
    Assertion,
}

/// What a repetition would repeat.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Last {
    Nothing,
    Flags,
    Expression,
}

/// What flags say about `x` and `u`.
#[derive(Copy, Clone, Default)]
struct Flags {
    ignore_whitespace: Option<bool>,
    unicode: Option<bool>,
}

/// Which of them are on.
#[derive(Copy, Clone)]
struct Modes {
    ignore_whitespace: bool,
    unicode: bool,
}

enum GroupState {
    /// With what holds again after it.
    Group {
        span: Span,
        modes: Modes,
    },
    Alternation,
}

enum Group {
    /// `(?x)`
    SetFlags(Flags),
    Open(Span, Flags),
}

const DECIMAL_EMPTY: &str = "decimal literal empty";
const COUNT_EMPTY: &str = "repetition quantifier expects a valid decimal";
const COUNT_UNCLOSED: &str = "unclosed counted repetition";
const REPETITION_MISSING: &str = "repetition operator missing expression";
const ESCAPE_EOF: &str = "incomplete escape sequence, reached end of pattern prematurely";
const BACKREFERENCE: &str = "backreferences are not supported";
const CLASS_UNCLOSED: &str = "unclosed character class";
const GROUP_UNCLOSED: &str = "unclosed group";
const GROUP_UNOPENED: &str = "unopened group";
const NAME_EOF: &str = "unclosed capture group name";
const HEX_INVALID: &str = "hexadecimal literal is not a Unicode scalar value";
const HEX_DIGIT: &str = "invalid hexadecimal digit";
const INVALID_UTF8: &str = "pattern can match invalid UTF-8";
const NO_UNICODE: &str = "Unicode not allowed here";

struct Parser<'p> {
    pattern: &'p str,
    pos: Position,
    modes: Modes,
    stack_group: Vec<GroupState>,
    /// A class that is open and whether it is negated, or `None` for an operator in one.
    stack_class: Vec<Option<(Span, bool)>>,
    capture_names: Vec<(&'p str, Span)>,
    /// The first thing that is refused after all of the pattern is parsed.
    later: Option<Error>,
}

#[optimize(size)]
fn is_meta_character(c: char) -> bool {
    matches!(
        c,
        '\\' | '.'
            | '+'
            | '*'
            | '?'
            | '('
            | ')'
            | '|'
            | '['
            | ']'
            | '{'
            | '}'
            | '^'
            | '$'
            | '#'
            | '&'
            | '-'
            | '~'
    )
}

#[optimize(size)]
fn is_escapeable_character(c: char) -> bool {
    is_meta_character(c) || (c.is_ascii() && !c.is_ascii_alphanumeric() && c != '<' && c != '>')
}

#[optimize(size)]
fn is_capture_char(c: char, is_first: bool) -> bool {
    match is_first {
        true => c == '_' || c.is_alphabetic(),
        false => c == '_' || c == '.' || c == '[' || c == ']' || c.is_alphanumeric(),
    }
}

#[optimize(size)]
fn error<T>(span: Span, kind: &'static str) -> Parsed<T> {
    Err(Error {
        kind,
        span,
        original: None,
    })
}

#[optimize(size)]
fn scalar_of(hex: &str) -> Option<char> {
    u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
}

impl<'p> Parser<'p> {
    #[optimize(size)]
    fn rest(&self) -> &'p str {
        self.pattern.get(self.pos.offset..).unwrap_or_default()
    }

    #[optimize(size)]
    fn char(&self) -> char {
        self.rest().chars().next().unwrap_or_default()
    }

    #[optimize(size)]
    fn is_eof(&self) -> bool {
        self.pos.offset >= self.pattern.len()
    }

    #[optimize(size)]
    fn bump(&mut self) -> bool {
        if self.is_eof() {
            return false;
        }
        let c = self.char();
        match c {
            '\n' => (self.pos.line, self.pos.column) = (self.pos.line + 1, 1),
            _ => self.pos.column += 1,
        }
        self.pos.offset += c.len_utf8();
        !self.is_eof()
    }

    #[optimize(size)]
    fn bump_if(&mut self, prefix: &str) -> bool {
        let is_there = self.rest().starts_with(prefix);
        if is_there {
            prefix.chars().for_each(|_| _ = self.bump());
        }
        is_there
    }

    #[optimize(size)]
    fn is_lookaround_prefix(&mut self) -> bool {
        self.bump_if("?=") || self.bump_if("?!") || self.bump_if("?<=") || self.bump_if("?<!")
    }

    #[optimize(size)]
    fn bump_and_bump_space(&mut self) -> bool {
        if !self.bump() {
            return false;
        }
        self.bump_space();
        !self.is_eof()
    }

    #[optimize(size)]
    fn bump_space(&mut self) {
        if !self.modes.ignore_whitespace {
            return;
        }
        while !self.is_eof() {
            if self.char().is_whitespace() {
                self.bump();
            } else if self.char() == '#' {
                self.bump();
                while !self.is_eof() {
                    let c = self.char();
                    self.bump();
                    if c == '\n' {
                        break;
                    }
                }
            } else {
                break;
            }
        }
    }

    #[optimize(size)]
    fn peek(&self) -> Option<char> {
        self.rest().chars().nth(1)
    }

    #[optimize(size)]
    fn peek_space(&self) -> Option<char> {
        if !self.modes.ignore_whitespace {
            return self.peek();
        }
        let mut is_in_comment = false;
        // Whatever is in a comment ends it, as there.
        self.rest().chars().skip(1).find(|&c| {
            if c.is_whitespace() {
                return false;
            }
            if !is_in_comment && c == '#' {
                is_in_comment = true;
                return false;
            }
            if is_in_comment && c == '\n' {
                is_in_comment = false;
                return false;
            }
            true
        })
    }

    #[optimize(size)]
    fn span(&self) -> Span {
        Span {
            start: self.pos,
            end: self.pos,
        }
    }

    #[optimize(size)]
    fn span_from(&self, start: Position) -> Span {
        Span {
            start,
            end: self.pos,
        }
    }

    #[optimize(size)]
    fn span_char(&self) -> Span {
        let c = self.char();
        let end = match c {
            '\n' => Position {
                offset: self.pos.offset + 1,
                line: self.pos.line + 1,
                column: 1,
            },
            _ => Position {
                offset: self.pos.offset + c.len_utf8(),
                line: self.pos.line,
                column: self.pos.column + 1,
            },
        };
        Span {
            start: self.pos,
            end,
        }
    }

    #[optimize(size)]
    fn refuse_after_parsing(&mut self, span: Span, kind: &'static str) {
        if self.later.is_none() {
            self.later = Some(Error {
                kind,
                span,
                original: None,
            });
        }
    }

    /// With `(?-u)` a pattern matches bytes, and must not match what is no UTF-8.
    #[optimize(size)]
    fn refuse_later(&mut self, span: Span, kind: &'static str) {
        if !self.modes.unicode {
            self.refuse_after_parsing(span, kind);
        }
    }

    #[optimize(size)]
    fn set_flags(&mut self, flags: Flags) {
        self.modes = Modes {
            ignore_whitespace: (flags.ignore_whitespace).unwrap_or(self.modes.ignore_whitespace),
            unicode: flags.unicode.unwrap_or(self.modes.unicode),
        };
    }

    #[optimize(size)]
    fn push_group(&mut self) -> Parsed<Last> {
        match self.parse_group()? {
            Group::SetFlags(flags) => {
                self.set_flags(flags);
                Ok(Last::Flags)
            }
            Group::Open(span, flags) => {
                self.stack_group.push(GroupState::Group {
                    span,
                    modes: self.modes,
                });
                self.set_flags(flags);
                Ok(Last::Nothing)
            }
        }
    }

    #[optimize(size)]
    fn pop_group(&mut self) -> Parsed<Last> {
        let mut top = self.stack_group.pop();
        if matches!(top, Some(GroupState::Alternation)) {
            top = self.stack_group.pop();
        }
        let Some(GroupState::Group { modes, .. }) = top else {
            return error(self.span_char(), GROUP_UNOPENED);
        };
        self.modes = modes;
        self.bump();
        Ok(Last::Expression)
    }

    #[optimize(size)]
    fn pop_group_end(&mut self) -> Parsed<()> {
        let mut top = self.stack_group.pop();
        if matches!(top, Some(GroupState::Alternation)) {
            top = self.stack_group.pop();
        }
        match top {
            Some(GroupState::Group { span, .. }) => error(span, GROUP_UNCLOSED),
            _ => Ok(()),
        }
    }

    #[optimize(size)]
    fn unclosed_class_error<T>(&self) -> Parsed<T> {
        let open = self.stack_class.iter().rev().find_map(|it| *it);
        error(open.map_or_else(|| self.span(), |it| it.0), CLASS_UNCLOSED)
    }

    #[optimize(size)]
    fn pop_class_op(&mut self) {
        if matches!(self.stack_class.last(), Some(None)) {
            self.stack_class.pop();
        }
    }

    #[optimize(size)]
    fn parse(&mut self) -> Parsed<()> {
        let mut last = Last::Nothing;
        loop {
            self.bump_space();
            if self.is_eof() {
                break;
            }
            last = match self.char() {
                '(' => self.push_group()?,
                ')' => self.pop_group()?,
                '|' => {
                    if !matches!(self.stack_group.last(), Some(GroupState::Alternation)) {
                        self.stack_group.push(GroupState::Alternation);
                    }
                    self.bump();
                    Last::Nothing
                }
                '[' => {
                    self.parse_set_class()?;
                    Last::Expression
                }
                '?' | '*' | '+' => self.parse_uncounted_repetition(last)?,
                '{' => self.parse_counted_repetition(last)?,
                _ => {
                    self.parse_primitive()?;
                    Last::Expression
                }
            };
        }
        self.pop_group_end()
    }

    #[optimize(size)]
    fn parse_uncounted_repetition(&mut self, last: Last) -> Parsed<Last> {
        if last != Last::Expression {
            return error(self.span(), REPETITION_MISSING);
        }
        if self.bump() && self.char() == '?' {
            self.bump();
        }
        Ok(Last::Expression)
    }

    #[optimize(size)]
    fn parse_counted_repetition(&mut self, last: Last) -> Parsed<Last> {
        let start = self.pos;
        if last != Last::Expression {
            return error(self.span(), REPETITION_MISSING);
        }
        if !self.bump_and_bump_space() {
            return error(self.span_from(start), COUNT_UNCLOSED);
        }
        let count_start = self.parse_count();
        if self.is_eof() {
            return error(self.span_from(start), COUNT_UNCLOSED);
        }
        let mut is_valid = true;
        if self.char() == ',' {
            if !self.bump_and_bump_space() {
                return error(self.span_from(start), COUNT_UNCLOSED);
            }
            let count_start = count_start?;
            if self.char() != '}' {
                is_valid = count_start <= self.parse_count()?;
            }
        } else {
            count_start?;
        }
        if self.is_eof() || self.char() != '}' {
            return error(self.span_from(start), COUNT_UNCLOSED);
        }
        if self.bump_and_bump_space() && self.char() == '?' {
            self.bump();
        }
        if !is_valid {
            return error(
                self.span_from(start),
                "invalid repetition count range, the start must be <= the end",
            );
        }
        Ok(Last::Expression)
    }

    #[optimize(size)]
    fn parse_group(&mut self) -> Parsed<Group> {
        let open_span = self.span_char();
        self.bump();
        self.bump_space();
        if self.is_lookaround_prefix() {
            return error(
                self.span_from(open_span.start),
                "look-around, including look-ahead and look-behind, is not supported",
            );
        }
        let inner_span = self.span();
        if self.bump_if("?P<") || self.bump_if("?<") {
            self.parse_capture_name()?;
            return Ok(Group::Open(open_span, Flags::default()));
        }
        if !self.bump_if("?") {
            return Ok(Group::Open(open_span, Flags::default()));
        }
        if self.is_eof() {
            return error(open_span, GROUP_UNCLOSED);
        }
        let (is_empty, flags) = self.parse_flags()?;
        let char_end = self.char();
        self.bump();
        match char_end {
            ')' if is_empty => error(inner_span, REPETITION_MISSING),
            ')' => Ok(Group::SetFlags(flags)),
            _ => Ok(Group::Open(open_span, flags)),
        }
    }

    #[optimize(size)]
    fn parse_capture_name(&mut self) -> Parsed<()> {
        if self.is_eof() {
            return error(self.span(), NAME_EOF);
        }
        let start = self.pos;
        while self.char() != '>' {
            if !is_capture_char(self.char(), self.pos == start) {
                return error(self.span_char(), "invalid capture group character");
            }
            if !self.bump() {
                break;
            }
        }
        let span = self.span_from(start);
        if self.is_eof() {
            return error(self.span(), NAME_EOF);
        }
        self.bump();
        let name = (self.pattern)
            .get(start.offset..span.end.offset)
            .unwrap_or_default();
        if name.is_empty() {
            let at = Span { start, end: start };
            return error(at, "empty capture group name");
        }
        if let Some(known) = self.capture_names.iter().find(|it| it.0 == name) {
            return Err(Error {
                kind: "duplicate capture group name",
                span,
                original: Some(known.1),
            });
        }
        self.capture_names.push((name, span));
        Ok(())
    }

    /// Whether there are none, and what they say.
    #[optimize(size)]
    fn parse_flags(&mut self) -> Parsed<(bool, Flags)> {
        let mut items: Vec<(char, Span)> = Vec::new();
        let mut last_was_negation = None;
        while self.char() != ':' && self.char() != ')' {
            let (c, span) = (self.char(), self.span_char());
            last_was_negation = (c == '-').then_some(span);
            if !matches!(c, '-' | 'i' | 'm' | 's' | 'U' | 'u' | 'R' | 'x') {
                return error(span, "unrecognized flag");
            }
            if let Some(known) = items.iter().find(|it| it.0 == c) {
                return Err(Error {
                    kind: match c {
                        '-' => "flag negation operator repeated",
                        _ => "duplicate flag",
                    },
                    span,
                    original: Some(known.1),
                });
            }
            items.push((c, span));
            if !self.bump() {
                return error(self.span(), "expected flag but got end of regex");
            }
        }
        if let Some(span) = last_was_negation {
            return error(span, "dangling flag negation operator");
        }
        let negation = items.iter().position(|it| it.0 == '-');
        let state_of = |flag: char| {
            let at = items.iter().position(|it| it.0 == flag)?;
            Some(negation.is_none_or(|negation| at < negation))
        };
        let flags = Flags {
            ignore_whitespace: state_of('x'),
            unicode: state_of('u'),
        };
        Ok((items.is_empty(), flags))
    }

    #[optimize(size)]
    fn parse_primitive(&mut self) -> Parsed<()> {
        match self.char() {
            '\\' => return self.parse_escape(false).map(|_| ()),
            '.' => self.refuse_later(self.span_char(), INVALID_UTF8),
            _ => {}
        }
        self.bump();
        Ok(())
    }

    #[optimize(size)]
    fn parse_escape(&mut self, is_in_class: bool) -> Parsed<(Primitive, Span)> {
        let start = self.pos;
        if !self.bump() {
            return error(self.span_from(start), ESCAPE_EOF);
        }
        let c = self.char();
        match c {
            '0'..='9' => {
                let end = self.span_char().end;
                return error(Span { start, end }, BACKREFERENCE);
            }
            'x' | 'u' | 'U' => {
                let (c, end, is_byte) = self.parse_hex()?;
                let span = Span { start, end };
                match c.is_ascii() {
                    false if is_byte => self.refuse_later(span, INVALID_UTF8),
                    false if is_in_class => self.refuse_later(span, NO_UNICODE),
                    _ => {}
                }
                return Ok((Primitive::Literal(c), span));
            }
            'p' | 'P' => {
                let is_known = self.parse_unicode_class()?;
                self.refuse_later(self.span_from(start), NO_UNICODE);
                if !is_known {
                    self.refuse_after_parsing(self.span_from(start), "Unicode property not found");
                }
                return Ok((Primitive::Class, self.span_from(start)));
            }
            'd' | 's' | 'w' | 'D' | 'S' | 'W' => {
                self.bump();
                if c.is_ascii_uppercase() {
                    self.refuse_later(self.span_from(start), INVALID_UTF8);
                }
                return Ok((Primitive::Class, self.span_from(start)));
            }
            _ => {}
        }
        self.bump();
        let span = self.span_from(start);
        if is_escapeable_character(c) {
            return Ok((Primitive::Literal(c), span));
        }
        let literal = |c| Ok((Primitive::Literal(c), span));
        match c {
            'a' => literal('\x07'),
            'f' => literal('\x0C'),
            't' => literal('\t'),
            'n' => literal('\n'),
            'r' => literal('\r'),
            'v' => literal('\x0B'),
            'b' => {
                if !self.is_eof() && self.char() == '{' {
                    self.maybe_parse_special_word_boundary(start)?;
                }
                Ok((Primitive::Assertion, self.span_from(start)))
            }
            'A' | 'z' | 'B' | '<' | '>' => Ok((Primitive::Assertion, span)),
            _ => error(span, "unrecognized escape sequence"),
        }
    }

    #[optimize(size)]
    fn maybe_parse_special_word_boundary(&mut self, wb_start: Position) -> Parsed<()> {
        let is_valid_char = |c: char| c.is_ascii_alphabetic() || c == '-';
        let start = self.pos;
        if !self.bump_and_bump_space() {
            return error(
                self.span_from(wb_start),
                "found either the beginning of a special word boundary or a bounded repetition on a \\b with an opening brace, but no closing brace",
            );
        }
        let start_contents = self.pos;
        if !is_valid_char(self.char()) {
            self.pos = start;
            return Ok(());
        }
        let mut name = String::new();
        while !self.is_eof() && is_valid_char(self.char()) {
            name.push(self.char());
            self.bump_and_bump_space();
        }
        if self.is_eof() || self.char() != '}' {
            return error(
                self.span_from(start),
                "special word boundary assertion is either unclosed or contains an invalid character",
            );
        }
        let contents = self.span_from(start_contents);
        self.bump();
        match &name[..] {
            "start" | "end" | "start-half" | "end-half" => Ok(()),
            _ => error(
                contents,
                "unrecognized special word boundary assertion, valid choices are: start, end, start-half or end-half",
            ),
        }
    }

    /// The character, where the literal ends, and whether it is `\xFF`, which is a byte with `(?-u)`.
    #[optimize(size)]
    fn parse_hex(&mut self) -> Parsed<(char, Position, bool)> {
        let digits = match self.char() {
            'x' => 2,
            'u' => 4,
            _ => 8,
        };
        if !self.bump_and_bump_space() {
            return error(self.span(), ESCAPE_EOF);
        }
        let (c, end) = match self.char() {
            '{' => return self.parse_hex_brace().map(|(c, end)| (c, end, false)),
            _ => self.parse_hex_digits(digits)?,
        };
        Ok((c, end, digits == 2))
    }

    #[optimize(size)]
    fn parse_hex_digits(&mut self, digits: usize) -> Parsed<(char, Position)> {
        let mut hex = String::new();
        let start = self.pos;
        for i in 0..digits {
            if i > 0 && !self.bump_and_bump_space() {
                return error(self.span(), ESCAPE_EOF);
            }
            if !self.char().is_ascii_hexdigit() {
                return error(self.span_char(), HEX_DIGIT);
            }
            hex.push(self.char());
        }
        self.bump_and_bump_space();
        match scalar_of(&hex) {
            Some(c) => Ok((c, self.pos)),
            None => error(self.span_from(start), HEX_INVALID),
        }
    }

    #[optimize(size)]
    fn parse_hex_brace(&mut self) -> Parsed<(char, Position)> {
        let mut hex = String::new();
        let brace_pos = self.pos;
        let start = self.span_char().end;
        while self.bump_and_bump_space() && self.char() != '}' {
            if !self.char().is_ascii_hexdigit() {
                return error(self.span_char(), HEX_DIGIT);
            }
            hex.push(self.char());
        }
        if self.is_eof() {
            return error(self.span_from(brace_pos), ESCAPE_EOF);
        }
        let end = self.pos;
        self.bump_and_bump_space();
        if hex.is_empty() {
            return error(self.span_from(brace_pos), "hexadecimal literal empty");
        }
        match scalar_of(&hex) {
            Some(c) => Ok((c, self.pos)),
            None => error(Span { start, end }, HEX_INVALID),
        }
    }

    #[optimize(size)]
    fn parse_decimal(&mut self) -> Parsed<u32> {
        let mut digits = String::new();
        while !self.is_eof() && self.char().is_whitespace() {
            self.bump();
        }
        let start = self.pos;
        while !self.is_eof() && self.char().is_ascii_digit() {
            digits.push(self.char());
            self.bump_and_bump_space();
        }
        let span = self.span_from(start);
        while !self.is_eof() && self.char().is_whitespace() {
            self.bump_and_bump_space();
        }
        if digits.is_empty() {
            return error(span, DECIMAL_EMPTY);
        }
        match digits.parse() {
            Ok(number) => Ok(number),
            Err(_) => error(span, "decimal literal invalid"),
        }
    }

    /// `parse_decimal` in a counted repetition.
    #[optimize(size)]
    fn parse_count(&mut self) -> Parsed<u32> {
        self.parse_decimal().map_err(|it| Error {
            kind: match it.kind {
                DECIMAL_EMPTY => COUNT_EMPTY,
                kind => kind,
            },
            ..it
        })
    }

    #[optimize(size)]
    fn parse_set_class(&mut self) -> Parsed<()> {
        loop {
            self.bump_space();
            if self.is_eof() {
                return self.unclosed_class_error();
            }
            match self.char() {
                '[' => {
                    if !self.stack_class.is_empty() && self.maybe_parse_ascii_class() {
                        continue;
                    }
                    let open = self.parse_set_class_open()?;
                    self.stack_class.push(Some(open));
                }
                ']' => {
                    self.pop_class_op();
                    let open = self.stack_class.pop().flatten();
                    self.bump();
                    if let Some((open, true)) = open {
                        self.refuse_later(self.span_from(open.start), INVALID_UTF8);
                    }
                    if self.stack_class.is_empty() {
                        return Ok(());
                    }
                }
                c @ ('&' | '-' | '~') if self.peek() == Some(c) => {
                    self.bump();
                    self.bump();
                    self.pop_class_op();
                    self.stack_class.push(None);
                }
                _ => self.parse_set_class_range()?,
            }
        }
    }

    #[optimize(size)]
    fn parse_set_class_range(&mut self) -> Parsed<()> {
        let (first, first_span) = self.parse_set_class_item()?;
        self.bump_space();
        if self.is_eof() {
            return self.unclosed_class_error();
        }
        if self.char() != '-' || matches!(self.peek_space(), Some(']' | '-')) {
            return match first {
                Primitive::Assertion => error(
                    first_span,
                    "invalid escape sequence found in character class",
                ),
                _ => Ok(()),
            };
        }
        if !self.bump_and_bump_space() {
            return self.unclosed_class_error();
        }
        let (second, second_span) = self.parse_set_class_item()?;
        const NO_LITERAL: &str = "invalid range boundary, must be a literal";
        let Primitive::Literal(start) = first else {
            return error(first_span, NO_LITERAL);
        };
        let Primitive::Literal(end) = second else {
            return error(second_span, NO_LITERAL);
        };
        if start > end {
            let span = Span {
                start: first_span.start,
                end: second_span.end,
            };
            return error(
                span,
                "invalid character class range, the start must be <= the end",
            );
        }
        Ok(())
    }

    #[optimize(size)]
    fn parse_set_class_item(&mut self) -> Parsed<(Primitive, Span)> {
        if self.char() == '\\' {
            return self.parse_escape(true);
        }
        let item = (Primitive::Literal(self.char()), self.span_char());
        if !self.char().is_ascii() {
            self.refuse_later(item.1, NO_UNICODE);
        }
        self.bump();
        Ok(item)
    }

    /// Where it is, and whether the class is negated.
    #[optimize(size)]
    fn parse_set_class_open(&mut self) -> Parsed<(Span, bool)> {
        let start = self.pos;
        if !self.bump_and_bump_space() {
            return error(self.span_from(start), CLASS_UNCLOSED);
        }
        let is_negated = self.char() == '^';
        if is_negated && !self.bump_and_bump_space() {
            return error(self.span_from(start), CLASS_UNCLOSED);
        }
        let mut is_empty = true;
        while self.char() == '-' {
            is_empty = false;
            if !self.bump_and_bump_space() {
                return error(Span { start, end: start }, CLASS_UNCLOSED);
            }
        }
        if is_empty && self.char() == ']' && !self.bump_and_bump_space() {
            return error(self.span_from(start), CLASS_UNCLOSED);
        }
        Ok((self.span_from(start), is_negated))
    }

    /// Whether `[:alpha:]` or the like was here.
    #[optimize(size)]
    fn maybe_parse_ascii_class(&mut self) -> bool {
        let start = self.pos;
        let mut is_negated = false;
        let mut parse = || {
            if !self.bump() || self.char() != ':' || !self.bump() {
                return false;
            }
            is_negated = self.char() == '^';
            if is_negated && !self.bump() {
                return false;
            }
            let name_start = self.pos.offset;
            while self.char() != ':' && self.bump() {}
            if self.is_eof() {
                return false;
            }
            let name = self.pattern.get(name_start..self.pos.offset);
            self.bump_if(":]")
                && matches!(
                    name.unwrap_or_default(),
                    "alnum"
                        | "alpha"
                        | "ascii"
                        | "blank"
                        | "cntrl"
                        | "digit"
                        | "graph"
                        | "lower"
                        | "print"
                        | "punct"
                        | "space"
                        | "upper"
                        | "word"
                        | "xdigit"
                )
        };
        let is_one = parse();
        if !is_one {
            self.pos = start;
        } else if is_negated {
            self.refuse_later(self.span_from(start), INVALID_UTF8);
        }
        is_one
    }

    /// Whether there can be such a class.
    #[optimize(size)]
    fn parse_unicode_class(&mut self) -> Parsed<bool> {
        if !self.bump_and_bump_space() {
            return error(self.span(), ESCAPE_EOF);
        }
        match self.char() {
            '{' => {
                while self.bump_and_bump_space() && self.char() != '}' {}
                if self.is_eof() {
                    return error(self.span(), ESCAPE_EOF);
                }
                self.bump();
                Ok(true)
            }
            '\\' => error(self.span_char(), "invalid Unicode character class"),
            c => {
                self.bump_and_bump_space();
                let category = c.to_ascii_uppercase();
                Ok(matches!(category, 'C' | 'L' | 'M' | 'N' | 'P' | 'S' | 'Z'))
            }
        }
    }
}

/// `str::lines`
#[optimize(size)]
fn lines(pattern: &[u8]) -> Vec<&[u8]> {
    let mut all: Vec<&[u8]> = strings::split(pattern, b"\n").collect();
    if pattern.is_empty() || pattern.ends_with(b"\n") {
        all.pop();
    }
    for line in &mut all {
        *line = line.strip_suffix(b"\r").unwrap_or(*line);
    }
    all
}

/// `Display` of `regex_syntax::Error`
#[optimize(size)]
fn describe(pattern: &[u8], error: &Error) -> Vec<u8> {
    let lines = lines(pattern);
    let line_count = lines.len() + usize::from(pattern.ends_with(b"\n"));
    let number_width = match line_count {
        0 | 1 => 0,
        _ => line_count.to_string().len(),
    };
    // In the order of the pattern.
    let spans: Vec<Span> = match error.original {
        Some(original) if original.start.offset <= error.span.start.offset => {
            vec![original, error.span]
        }
        Some(original) => vec![error.span, original],
        None => vec![error.span],
    };
    let is_multi_line = strings::contains_char(pattern, b'\n');
    let divider = [b'~'; 79];
    let mut out = b"regex parse error:\n".to_vec();
    if is_multi_line {
        out.extend_from_slice(&divider);
        out.push(b'\n');
    }
    for (at, line) in lines.iter().enumerate() {
        match number_width {
            0 => out.extend_from_slice(b"    "),
            width => out.extend_from_slice(format!("{:>width$}: ", at + 1).as_bytes()),
        }
        out.extend_from_slice(line);
        out.push(b'\n');
        let is_here = |it: &&Span| it.start.line == it.end.line && it.start.line == at + 1;
        if !spans.iter().any(|it| is_here(&it)) {
            continue;
        }
        let padding = match number_width {
            0 => 4,
            width => width + 2,
        };
        out.extend(std::iter::repeat_n(b' ', padding));
        let mut column = 0;
        for span in spans.iter().filter(is_here) {
            let blanks = (span.start.column - 1).saturating_sub(column);
            let carets = span.end.column.saturating_sub(span.start.column).max(1);
            out.extend(std::iter::repeat_n(b' ', blanks));
            out.extend(std::iter::repeat_n(b'^', carets));
            column += blanks + carets;
        }
        out.push(b'\n');
    }
    if is_multi_line {
        out.extend_from_slice(&divider);
        out.push(b'\n');
        for span in spans.iter().filter(|it| it.start.line != it.end.line) {
            let note = format!(
                "on line {} (column {}) through line {} (column {})\n",
                span.start.line,
                span.start.column,
                span.end.line,
                span.end.column - 1
            );
            out.extend_from_slice(note.as_bytes());
        }
    }
    out.extend_from_slice(b"error: ");
    out.extend_from_slice(error.kind.as_bytes());
    out
}

/// What `regex::Regex::new(pattern)` fails with, as it is printed. `None`: nothing is wrong with the syntax.
#[optimize(size)]
pub(super) fn syntax_error(pattern: &[u8]) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(pattern).ok()?;
    let mut parser = Parser {
        pattern: text,
        pos: Position {
            offset: 0,
            line: 1,
            column: 1,
        },
        modes: Modes {
            ignore_whitespace: false,
            unicode: true,
        },
        stack_group: Vec::new(),
        stack_class: Vec::new(),
        capture_names: Vec::new(),
        later: None,
    };
    let error = parser.parse().err().or(parser.later)?;
    Some(describe(pattern, &error))
}
