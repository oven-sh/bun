//! Highlights CSS, SCSS and Less.
//!
//! The tokens come from the tokenizer of `postcss` in its tolerant mode. A statement goes up to the next `{`, `;` or `}`, and
//! which one it is tells `a:hover {` from `a: hover;`. The parser decides the same way, but it stops at the first error. So
//! there's no tree here, and broken code takes the same path as valid code.
//!
//! A token of `postcss` is coarse: `.a.b>c` is one word, and so is `10px*2`. [`Highlighter::words`] scans words byte by byte.
//! Nothing calls itself: open brackets and interpolations are a list of [`Frame`]s.

use super::Parser as Syntax;
use super::misc::number_len;
use super::postcss::{TokenKind, Tokenizer};
use crate::highlight::{Language, Spans, Token};
use bun_core::strings;
use rustc_hash::FxHashMap;

pub(crate) fn highlight(code: &[u8], language: Language, spans: &mut Spans) {
    let syntax = match language {
        Language::Scss => Syntax::Scss,
        Language::Less => Syntax::Less,
        _ => Syntax::Css,
    };
    Highlighter::new(code, syntax, false, spans).run();
}

/// The value of a `style` attribute: declarations without a rule around them.
pub(crate) fn highlight_declarations(code: &[u8], spans: &mut Spans) {
    Highlighter::new(code, Syntax::Css, true, spans).run();
}

/// A token of `postcss`.
#[derive(Copy, Clone)]
struct Piece {
    kind: TokenKind,
    start: u32,
    end: u32,
}

impl Piece {
    fn is(self, control: u8) -> bool {
        self.kind == TokenKind::Control(control)
    }

    fn is_blank(self) -> bool {
        matches!(self.kind, TokenKind::Space | TokenKind::Comment)
    }
}

/// What ends a statement.
#[derive(Copy, Clone, PartialEq, Eq)]
enum End {
    /// `{`
    Block,
    /// `;`
    Semicolon,
    /// `}`
    Close,
    /// The end of the text, the end of the line after an unclosed string, or an at-rule.
    Nothing,
}

/// What the words in a part of a statement are.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Selector,
    /// The parameters of `@scope`: selectors in parentheses.
    Scope,
    /// In the `[ ]` of a selector.
    Attribute,
    /// The name of a declaration.
    Property,
    Value,
    /// In `:nth-child()`: a value, and a selector after `of`.
    Nth,
    /// The parameters of `@media`, `@supports` and `@container`.
    Query,
}

/// What's in a pair of parentheses.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Arguments {
    No,
    /// `rgb(..)`, `@include a(..)`
    Call,
    /// `@mixin a(..)`
    Definition,
}

#[derive(Copy, Clone)]
struct State {
    mode: Mode,
    arguments: Arguments,
    is_in_brackets: bool,
    /// There was a `:` since the bracket.
    has_colon: bool,
    /// An argument starts: there were only blanks since the `(`, `,` or `;`.
    is_first: bool,
    /// In `[ ]`: 0 before the operator, 1 after it, 2 after the value.
    attribute: u8,
    /// What the next name is: `Function` after `@include`.
    name: Option<Token>,
    /// What the name that ended at `Highlighter::glue_end` is. It goes on after an interpolation: `.a-#{$b}-c`.
    glue: Option<Token>,
}

impl State {
    fn new(mode: Mode) -> State {
        State {
            mode,
            arguments: Arguments::No,
            is_in_brackets: false,
            has_colon: false,
            is_first: false,
            attribute: 0,
            name: None,
            glue: None,
        }
    }
}

/// An open `{`.
#[derive(Copy, Clone)]
struct Block {
    is_keyframes: bool,
    /// How many of `Highlighter::declared` are the parameters of its mixin or function.
    parameters: u32,
}

/// An open bracket or interpolation.
#[derive(Copy, Clone)]
struct Frame {
    /// `)`, `]`, or `}` for an interpolation.
    close: u8,
    /// Of what's around it.
    state: State,
}

struct Highlighter<'a, 's> {
    code: &'a [u8],
    syntax: Syntax,
    spans: &'s mut Spans,
    /// The tokens of the statement, without the one that ends it.
    tokens: Vec<Piece>,
    end: End,
    blocks: Vec<Block>,
    /// The parameters of the mixins and functions around, without the `$` or `@`, in the order they're declared in.
    declared: Vec<&'a [u8]>,
    /// How often each of them is in `declared`.
    parameters: FxHashMap<&'a [u8], u32>,
    /// The text is what's in a rule.
    is_in_rule: bool,
    frames: Vec<Frame>,
    state: State,
    glue_end: usize,
    /// Everything before is highlighted. It can be in the middle of a token.
    from: usize,
    /// What's in the `(` that comes next.
    opens: Option<(Mode, Arguments)>,
    /// The names that are keywords in this statement, outside of brackets.
    keywords: (&'static [&'static [u8]], Token),
    /// What's in the parentheses after `State::name`.
    arguments_of_name: Arguments,
    /// `! important`
    is_after_bang: bool,
    /// A number, a name or a variable touches what comes next, so a `-` is an operator and not a sign.
    is_after_operand: bool,
    /// Less calls a mixin without parentheses: `.a;`
    is_call: bool,
}

fn is_name_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'\\') || byte >= 0x80
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_') || byte >= 0x80
}

/// The length of the escape sequence that `text` starts with: `\"`, `\201C `.
fn escape_len(text: &[u8]) -> usize {
    let rest = text.get(1..).unwrap_or_default();
    let hex = (rest.iter().take(6))
        .take_while(|byte| byte.is_ascii_hexdigit())
        .count();
    match rest.first() {
        None | Some(b'\n' | b'\r' | 0x0C) => 1,
        Some(_) if hex > 0 => 1 + hex + usize::from(matches!(rest.get(hex), Some(b' ' | b'\t'))),
        Some(0..0x80) => 2,
        // A span can't end in the middle of a character.
        Some(_) => {
            let more = rest.iter().skip(1).take(3);
            2 + more.take_while(|&&byte| byte & 0xC0 == 0x80).count()
        }
    }
}

/// What's in the parentheses of the pseudo-class `name`.
fn mode_in_pseudo(name: &[u8]) -> Mode {
    match name {
        _ if name.starts_with(b"nth-") => Mode::Nth,
        _ if name.starts_with(b"view-transition-") => Mode::Value,
        b"lang" | b"dir" | b"part" | b"state" | b"highlight" | b"active-view-transition-type" => {
            Mode::Value
        }
        _ => Mode::Selector,
    }
}

impl<'a, 's> Highlighter<'a, 's> {
    fn new(code: &'a [u8], syntax: Syntax, is_in_rule: bool, spans: &'s mut Spans) -> Self {
        Highlighter {
            code,
            syntax,
            spans,
            tokens: Vec::new(),
            end: End::Nothing,
            blocks: Vec::new(),
            declared: Vec::new(),
            parameters: FxHashMap::default(),
            is_in_rule,
            frames: Vec::new(),
            state: State::new(Mode::Value),
            glue_end: usize::MAX,
            from: 0,
            opens: None,
            keywords: (&[], Token::Keyword),
            arguments_of_name: Arguments::Call,
            is_after_bang: false,
            is_after_operand: false,
            is_call: false,
        }
    }

    fn run(&mut self) {
        let mut tokenizer = Tokenizer::new(self.code, self.syntax, 0);
        // The at-word that the last statement stopped at.
        let mut at_word = None;
        loop {
            self.tokens.clear();
            let mut parens = 0usize;
            let mut has_words = false;
            let mut end = None;
            let mut is_at_end = false;
            loop {
                let Some(token) = at_word.take().or_else(|| tokenizer.next_tolerant_token()) else {
                    is_at_end = true;
                    break;
                };
                match token.kind {
                    TokenKind::Control(b'{' | b'}') => {
                        end = Some(token);
                        break;
                    }
                    // Less has it between the arguments of a mixin.
                    TokenKind::Control(b';') if parens == 0 || self.syntax != Syntax::Less => {
                        end = Some(token);
                        break;
                    }
                    TokenKind::Control(b'(') => parens += 1,
                    TokenKind::Control(b')') => parens = parens.saturating_sub(1),
                    // Only Less has at-words in a statement. Elsewhere a `;` is missing, as after `${mixin}` in a template.
                    TokenKind::AtWord
                        if has_words
                            && parens == 0
                            && self.syntax != Syntax::Less
                            && self.tokens.last().is_some_and(|last| last.is_blank()) =>
                    {
                        at_word = Some(token);
                        break;
                    }
                    _ => {}
                }
                let piece = Piece {
                    kind: token.kind,
                    start: token.range.start,
                    end: token.range.end,
                };
                has_words |= !piece.is_blank();
                self.tokens.push(piece);
                // It has swallowed the `;` or `}`.
                if matches!(
                    token.kind,
                    TokenKind::UnclosedString | TokenKind::UnclosedUrl
                ) {
                    break;
                }
            }
            self.end = match end.map(|token| token.kind) {
                Some(TokenKind::Control(b'{')) => End::Block,
                Some(TokenKind::Control(b';')) => End::Semicolon,
                Some(_) => End::Close,
                None => End::Nothing,
            };
            let declared = self.declared.len();
            let is_keyframes = self.statement();
            if is_at_end {
                return;
            }
            let parameters = self.declared.len().saturating_sub(declared) as u32;
            if self.end == End::Block {
                self.blocks.push(Block {
                    is_keyframes,
                    parameters,
                });
            } else {
                self.forget_parameters(parameters);
            }
            if self.end == End::Close
                && let Some(block) = self.blocks.pop()
            {
                self.forget_parameters(block.parameters);
            }
            if let Some(end) = end {
                let token = match self.end {
                    End::Semicolon => Token::PunctuationDelimiter,
                    _ => Token::PunctuationBracket,
                };
                self.add(end.range.start as usize, end.range.end as usize, token);
            }
        }
    }

    /// The block that the last `count` parameters are for ends.
    fn forget_parameters(&mut self, count: u32) {
        for _ in 0..count {
            if let Some(name) = self.declared.pop()
                && let Some(times) = self.parameters.get_mut(name)
            {
                *times -= 1;
                if *times == 0 {
                    self.parameters.remove(name);
                }
            }
        }
    }

    fn is_in_keyframes(&self) -> bool {
        self.blocks.last().is_some_and(|block| block.is_keyframes)
    }

    #[inline]
    fn add(&mut self, start: usize, end: usize, token: Token) {
        self.spans.add_range(start..end, token);
    }

    /// Adds a name. If it's the last of its words, an interpolation after it is part of it.
    fn name(&mut self, start: usize, end: usize, words_end: usize, token: Token) {
        self.add(start, end, token);
        if end == words_end {
            self.state.glue = Some(token);
            self.glue_end = end;
        }
    }

    fn token(&self, index: usize) -> Option<Piece> {
        self.tokens.get(index).copied()
    }

    fn text(&self, start: usize, end: usize) -> &'a [u8] {
        self.code.get(start..end).unwrap_or_default()
    }

    /// The byte at `at`, or 0 from `end` on.
    #[inline]
    fn byte(&self, at: usize, end: usize) -> u8 {
        match self.code.get(at) {
            Some(&byte) if at < end => byte,
            _ => 0,
        }
    }

    /// Where the name that starts at `at` ends.
    fn name_end(&self, mut at: usize, end: usize) -> usize {
        loop {
            at += match self.byte(at, end) {
                b'\\' => escape_len(self.text(at, end)),
                byte if is_name_byte(byte) => 1,
                _ => return at.min(end),
            };
        }
    }

    /// Whether a `(` touches the words that end at `end`. `next`: the index of the token after them.
    fn is_before_paren(&self, next: usize, end: usize) -> bool {
        self.token(next)
            .is_some_and(|token| token.is(b'(') && token.start as usize == end)
    }

    /// Whether `control` is the first token from `index` on, blanks and comments aside.
    fn is_before(&self, index: usize, control: u8) -> bool {
        let rest = self.tokens.get(index..).unwrap_or_default();
        rest.iter()
            .find(|token| !token.is_blank())
            .is_some_and(|token| token.is(control))
    }

    /// Whether nothing but `!important` comes from `index` on.
    fn is_last_name(&self, index: usize) -> bool {
        let rest = self.tokens.get(index..).unwrap_or_default();
        rest.iter()
            .find(|token| !token.is_blank())
            .is_none_or(|token| self.code.get(token.start as usize) == Some(&b'!'))
    }

    /// Whether the name that ends at `at` is the `svg` of `svg|a`.
    fn is_namespace(&self, at: usize, end: usize) -> bool {
        let after = self.byte(at + 1, end);
        self.byte(at, end) == b'|' && (is_name_byte(after) || matches!(after, b'*' | b'\\'))
    }

    fn is_at_top(&self) -> bool {
        self.blocks.is_empty() && !self.is_in_rule
    }

    /// Highlights `self.tokens`. Returns whether it's `@keyframes`.
    fn statement(&mut self) -> bool {
        self.keywords = (&[], Token::Keyword);
        self.arguments_of_name = Arguments::Call;
        self.is_call = false;
        let len = self.tokens.len();
        let first = self.tokens.iter().position(|token| !token.is_blank());
        let Some((first, token)) = first.and_then(|first| Some((first, self.token(first)?))) else {
            self.emit(0, len, Mode::Value, None);
            return false;
        };
        if token.kind == TokenKind::AtWord {
            return self.at_rule(first, token);
        }
        let colon = self.colon(first);
        let sigil = match token.kind {
            TokenKind::Word => self.byte(token.start as usize, token.end as usize),
            _ => 0,
        };
        let is_selector = match token.kind {
            TokenKind::Control(b'[') => true,
            // `:root`, but not `: red`.
            TokenKind::Control(b':') => self.token(first + 1).is_some_and(|next| !next.is_blank()),
            // `+color: red;` is a hack for old browsers.
            _ if matches!(sigil, b'>' | b'+' | b'~') => self.end != End::Semicolon,
            _ => matches!(sigil, b'&' | b'.' | b'#' | b'%'),
        };
        if !is_selector
            && let Some(colon) = colon
            && self.is_declaration(first, token, colon)
        {
            self.declaration(colon);
        } else if self.end == End::Block || is_selector {
            self.is_call = self.syntax == Syntax::Less
                && matches!(self.end, End::Semicolon | End::Close)
                && colon.is_none()
                && matches!(sigil, b'.' | b'#');
            self.emit(0, len, Mode::Selector, None);
        } else {
            self.other(0, len);
        }
        false
    }

    /// The index of the first `:` from `from` on that is in no bracket and no interpolation.
    fn colon(&self, from: usize) -> Option<usize> {
        let mut depth = 0usize;
        for (index, token) in self.tokens.iter().enumerate().skip(from) {
            match token.kind {
                TokenKind::Control(b'(' | b'[') | TokenKind::InterpolationStart => depth += 1,
                TokenKind::Control(b')' | b']') | TokenKind::InterpolationEnd => {
                    depth = depth.saturating_sub(1);
                }
                TokenKind::Control(b':') if depth == 0 => return Some(index),
                _ => {}
            }
        }
        None
    }

    /// Whether the statement, which starts with `token` at `first` and has its first `:` at `colon`, is a declaration.
    fn is_declaration(&self, first: usize, token: Piece, colon: usize) -> bool {
        let name = self.text(token.start as usize, token.end as usize);
        let after = self.token(colon + 1);
        match self.end {
            End::Semicolon => true,
            // `--a: { .. }`
            End::Block if name.starts_with(b"--") => true,
            // SCSS: `font: 12px { family: a }` and `font: { family: a }`, but not `a:hover { }`.
            End::Block => {
                let before = self.tokens.get(first..colon).unwrap_or_default();
                let is_name = token.kind == TokenKind::InterpolationStart
                    || (token.kind == TokenKind::Word
                        && name
                            .first()
                            .is_some_and(|&byte| is_name_start(byte) || byte == b'-'));
                self.syntax == Syntax::Scss
                    && is_name
                    && !before.iter().any(|token| token.is_blank())
                    && after.is_none_or(|after| match after.kind {
                        TokenKind::Control(b':') | TokenKind::InterpolationStart => false,
                        TokenKind::Word => {
                            let byte = self.byte(after.start as usize, after.end as usize);
                            !byte.is_ascii_alphabetic() && !matches!(byte, b'#' | b'-')
                        }
                        _ => true,
                    })
            }
            // At the top of a style sheet, `a:hov` is a selector that is still being typed.
            End::Close | End::Nothing => {
                !self.is_at_top()
                    || name.starts_with(b"--")
                    || name.starts_with(b"$")
                    || after.is_some_and(|after| after.is_blank())
            }
        }
    }

    fn declaration(&mut self, colon: usize) {
        // The name is the last word before the colon: `${mixin}` on the line before it needs no `;`.
        let mut start = colon;
        while start > 0 && self.token(start - 1).is_some_and(|token| token.is_blank()) {
            start -= 1;
        }
        let mut depth = 0usize;
        while let Some(token) = start.checked_sub(1).and_then(|index| self.token(index)) {
            match token.kind {
                TokenKind::InterpolationEnd => depth += 1,
                TokenKind::InterpolationStart => depth = depth.saturating_sub(1),
                TokenKind::Space | TokenKind::Comment if depth == 0 => break,
                _ => {}
            }
            start -= 1;
        }
        self.other(0, start);
        self.emit(start, colon, Mode::Property, None);
        if let Some(token) = self.token(colon) {
            self.add(
                token.start as usize,
                token.end as usize,
                Token::PunctuationDelimiter,
            );
        }
        self.emit(colon + 1, self.tokens.len(), Mode::Value, None);
    }

    /// What's neither a declaration nor a rule: a name that is still being typed, `${mixin}` in a template, `...`.
    fn other(&mut self, from: usize, to: usize) {
        match self.is_at_top() || self.is_in_keyframes() {
            true => self.emit(from, to, Mode::Selector, None),
            false => self.emit(from, to, Mode::Value, Some(Token::Property)),
        }
    }

    /// The statement starts with the at-word `token` at `first`. Returns whether it's `@keyframes`.
    fn at_rule(&mut self, first: usize, token: Piece) -> bool {
        let len = self.tokens.len();
        let (start, end) = (token.start as usize, token.end as usize);
        let name_end = self.name_end(start + 1, end);
        let name = self.text(start + 1, name_end);
        let is_less = self.syntax == Syntax::Less;
        // Less: `@a: 1`, `@a();`
        let is_variable = is_less && {
            let has_colon = match name_end < end {
                true => self.byte(name_end, end) == b':',
                false => self.is_before(first + 1, b':'),
            };
            let is_call = self.end != End::Block && self.is_before_paren(first + 1, name_end);
            is_call || (has_colon && !matches!(name, b"page" | b"nest" | b"keyframes"))
        };
        if is_variable || name.is_empty() {
            self.emit(0, len, Mode::Value, None);
            return false;
        }

        let mut buffer = [0; 24];
        let lower = buffer.get_mut(..name.len()).unwrap_or_default();
        lower.copy_from_slice(name.get(..lower.len()).unwrap_or_default());
        lower.make_ascii_lowercase();
        let mut keyword = Token::KeywordDirective;
        let mut mode = Mode::Value;
        let mut first_name = None;
        match &*lower {
            b"if" | b"while" | b"return" => keyword = Token::KeywordControl,
            b"else" => {
                keyword = Token::KeywordControl;
                self.keywords = (&[b"if"], Token::KeywordControl);
            }
            b"each" => {
                keyword = Token::KeywordControl;
                self.keywords = (&[b"in"], Token::KeywordControl);
            }
            b"for" => {
                keyword = Token::KeywordControl;
                self.keywords = (&[b"from", b"through", b"to"], Token::KeywordControl);
            }
            b"import" => {
                keyword = Token::KeywordImport;
                // Less: `@import (reference) "a"`
                if !is_less {
                    mode = Mode::Query;
                }
            }
            b"use" | b"forward" => {
                keyword = Token::KeywordImport;
                self.keywords = (&[b"as", b"with", b"show", b"hide"], Token::KeywordImport);
            }
            b"media" | b"supports" | b"container" | b"custom-media" => mode = Mode::Query,
            b"include" | b"add-mixin" => {
                first_name = Some(Token::Function);
                self.keywords = (&[b"using"], Token::Keyword);
            }
            b"mixin" | b"function" | b"define-mixin" => {
                first_name = Some(Token::Function);
                self.arguments_of_name = Arguments::Definition;
            }
            b"extend" | b"nest" | b"at-root" | b"custom-selector" | b"page" => {
                mode = Mode::Selector;
            }
            b"scope" => mode = Mode::Scope,
            _ => {}
        }
        let is_keyframes = lower.ends_with(b"keyframes");
        self.emit(0, first, Mode::Value, None);
        self.add(start, name_end, keyword);
        self.from = name_end;
        self.emit(first, len, mode, first_name);
        is_keyframes
    }

    /// Highlights the tokens from `from` to `to`. `name`: what the first name is.
    fn emit(&mut self, from: usize, to: usize, mode: Mode, name: Option<Token>) {
        self.frames.clear();
        self.state = State {
            name,
            ..State::new(mode)
        };
        self.opens = None;
        self.is_after_bang = false;
        let mut index = from;
        while index < to
            && let Some(token) = self.token(index)
        {
            let (start, end) = (token.start as usize, token.end as usize);
            index += 1;
            match token.kind {
                TokenKind::Space => continue,
                TokenKind::Comment => {
                    let text = self.text(start, end);
                    let is_doc = text.starts_with(b"///")
                        || (text.starts_with(b"/**") && !text.starts_with(b"/**/"));
                    self.add(
                        start,
                        end,
                        if is_doc {
                            Token::CommentDoc
                        } else {
                            Token::Comment
                        },
                    );
                    continue;
                }
                TokenKind::Word | TokenKind::AtWord | TokenKind::Brackets => {
                    let (end, next) = self.end_of_words(index - 1, to);
                    self.words(start.max(self.from), end, next);
                    index = next;
                    continue;
                }
                _ => {}
            }
            self.state.is_first = false;
            match token.kind {
                TokenKind::String | TokenKind::UnclosedString => {
                    self.string(start, end);
                    self.state.attribute = 2;
                }
                TokenKind::Url | TokenKind::UnclosedUrl => {
                    self.add(start, end, Token::StringSpecial);
                }
                TokenKind::InterpolationStart => {
                    self.add(start, end, Token::PunctuationSpecial);
                    if self.glue_end != start {
                        self.state.glue = None;
                    }
                    self.frames.push(Frame {
                        close: b'}',
                        state: self.state,
                    });
                    // `@{a}` has nothing but the name of a variable in it.
                    self.state = State {
                        name: (self.byte(start, end) == b'@').then_some(Token::Variable),
                        ..State::new(Mode::Value)
                    };
                }
                TokenKind::InterpolationEnd => {
                    self.add(start, end, Token::PunctuationSpecial);
                    // Brackets that are still open in it have no end.
                    while let Some(frame) = self.frames.pop() {
                        if frame.close == b'}' {
                            self.state = frame.state;
                            self.glue_end = end;
                            break;
                        }
                    }
                }
                TokenKind::Control(b':')
                    if matches!(self.state.mode, Mode::Selector | Mode::Scope) =>
                {
                    index = self.pseudo(start, end, index, to);
                }
                TokenKind::Control(byte) => self.control(byte, start, end),
                _ => {}
            }
        }
    }

    /// Words that touch are scanned as one: `.a\:b` is `.a`, `\:` and `b`. `index`: of the first one.
    /// Returns where they end, and the index of the token after them.
    fn end_of_words(&self, mut index: usize, to: usize) -> (usize, usize) {
        let mut end = self.token(index).map_or(0, |token| token.end);
        index += 1;
        while index < to
            && let Some(token) = self.token(index)
            && matches!(token.kind, TokenKind::Word | TokenKind::AtWord)
            && token.start == end
        {
            end = token.end;
            index += 1;
        }
        (end as usize, index)
    }

    fn string(&mut self, start: usize, end: usize) {
        let code = self.code.get(..end).unwrap_or(self.code);
        let mut from = start;
        while let Some(escape) = strings::index_of_char_pos(code, b'\\', from) {
            let escape_end = escape + escape_len(self.text(escape, end));
            self.add(from, escape, Token::String);
            self.add(escape, escape_end, Token::StringEscape);
            from = escape_end;
        }
        self.add(from, end, Token::String);
    }

    /// `:hover`, `::before`, `:not(`. The first colon goes from `start` to `end`, and `index` is that of the token after it.
    /// Returns the index of the first token that isn't part of it.
    fn pseudo(&mut self, start: usize, mut end: usize, mut index: usize, to: usize) -> usize {
        while index < to
            && let Some(token) = self.token(index)
            && token.is(b':')
            && token.start as usize == end
        {
            end = token.end as usize;
            index += 1;
        }
        let kind = self
            .token(index)
            .filter(|token| index < to && token.start as usize == end)
            .map(|token| token.kind);
        match kind {
            Some(TokenKind::Word) => {}
            // `:#{$a}`
            Some(TokenKind::InterpolationStart) => {
                self.name(start, end, end, Token::SelectorPseudo);
                return index;
            }
            _ => {
                self.add(start, end, Token::PunctuationDelimiter);
                return index;
            }
        }
        let (words_end, next) = self.end_of_words(index, to);
        let name_end = self.name_end(end, words_end);
        self.name(start, name_end, words_end, Token::SelectorPseudo);
        if name_end < words_end {
            self.words(name_end, words_end, next);
        } else if self.is_before_paren(next, words_end) {
            self.opens = Some((mode_in_pseudo(self.text(end, name_end)), Arguments::No));
        }
        next
    }

    fn control(&mut self, byte: u8, start: usize, end: usize) {
        match byte {
            b'(' | b'[' => {
                self.add(start, end, Token::PunctuationBracket);
                let (mode, arguments) = match (self.opens.take(), byte, self.state.mode) {
                    (Some(opens), b'(', _) => opens,
                    (_, b'[', Mode::Selector | Mode::Scope) => (Mode::Attribute, Arguments::No),
                    (_, _, Mode::Scope) => (Mode::Selector, Arguments::No),
                    // Less: `.a when (@b)`
                    (_, _, Mode::Selector | Mode::Attribute | Mode::Property) => {
                        (Mode::Value, Arguments::No)
                    }
                    (_, _, mode) => (mode, Arguments::No),
                };
                self.frames.push(Frame {
                    close: if byte == b'(' { b')' } else { b']' },
                    state: self.state,
                });
                self.state = State {
                    arguments,
                    is_in_brackets: true,
                    is_first: true,
                    ..State::new(mode)
                };
            }
            b')' | b']' => {
                self.add(start, end, Token::PunctuationBracket);
                if let Some(frame) = self.frames.pop_if(|frame| frame.close == byte) {
                    self.state = frame.state;
                }
            }
            b':' => {
                self.add(start, end, Token::PunctuationDelimiter);
                self.state.has_colon = true;
            }
            // The `;` between the arguments of a mixin of Less.
            _ => {
                self.add(start, end, Token::PunctuationDelimiter);
                self.state.is_first = true;
            }
        }
    }

    /// Highlights the words from `start` to `end`, which have no blanks between them. `next`: the index of the token after
    /// them.
    fn words(&mut self, start: usize, end: usize, next: usize) {
        if start >= end {
            return;
        }
        let mut at = start;
        self.is_after_operand = false;
        let glue = self.state.glue.take();
        if self.glue_end == start {
            match (glue, self.state.mode) {
                // `#{&}-a`, `#{$a}__b`
                (None, Mode::Selector) => {
                    at = self.name_end(start, end);
                    self.name(start, at, end, Token::SelectorClass);
                }
                // `#{$a}px`
                (None, Mode::Value | Mode::Nth | Mode::Query) => at = self.unit(start, end),
                (None, _) => {}
                (Some(token), _) => {
                    at = self.name_end(start, end);
                    self.name(start, at, end, token);
                }
            }
            self.is_after_operand = at > start;
        }
        while at < end {
            let is_first = std::mem::take(&mut self.state.is_first);
            let part_end = match self.state.mode {
                Mode::Property => self.property(at, end),
                Mode::Attribute => self.attribute_word(at, end),
                Mode::Selector | Mode::Scope => self.selector_word(at, end, next),
                Mode::Value | Mode::Nth | Mode::Query => self.value_word(at, end, next, is_first),
            };
            at = part_end.max(at + 1);
        }
    }

    /// The name of a declaration, or what is left of it after an interpolation.
    fn property(&mut self, start: usize, end: usize) -> usize {
        let text = self.text(start, end);
        // Less merges with `a+: b` and `a+_: b`.
        let name = match self.syntax {
            Syntax::Less => text
                .strip_suffix(b"+_")
                .or_else(|| text.strip_suffix(b"+"))
                .unwrap_or(text),
            _ => text,
        };
        let token = match name {
            [b'$', name @ ..] if self.parameters.contains_key(name) => Token::VariableParameter,
            [b'$', ..] | [b'-', b'-', ..] => Token::Variable,
            _ => Token::Property,
        };
        let name_end = start + name.len();
        self.name(start, name_end, end, token);
        self.add(name_end, end, Token::Operator);
        end
    }

    /// One part of what's in `[ ]`. Like the ones below, it returns where the part ends.
    fn attribute_word(&mut self, at: usize, end: usize) -> usize {
        let byte = self.byte(at, end);
        match byte {
            b'=' | b'~' | b'|' | b'^' | b'$' | b'*' => {
                let has_equals = byte == b'=' || self.byte(at + 1, end) == b'=';
                let operator_end = at + 1 + usize::from(has_equals && byte != b'=');
                self.add(at, operator_end, Token::Operator);
                if has_equals {
                    self.state.attribute = 1;
                }
                operator_end
            }
            _ if is_name_byte(byte) || byte == b'\\' => {
                let name_end = self.name_end(at, end);
                let token = match self.state.attribute {
                    0 if self.is_namespace(name_end, end) => Token::Namespace,
                    0 => Token::Attribute,
                    1 => Token::String,
                    // `[a="b" i]`
                    _ => Token::KeywordModifier,
                };
                if self.state.attribute == 1 {
                    self.state.attribute = 2;
                }
                self.name(at, name_end, end, token);
                name_end
            }
            _ => at + 1,
        }
    }

    fn selector_word(&mut self, at: usize, end: usize, next: usize) -> usize {
        let (byte, after) = (self.byte(at, end), self.byte(at + 1, end));
        match byte {
            // The selectors of `@keyframes`.
            b'0'..=b'9' => self.number(at, end),
            b'.' | b'#' if after != byte => {
                let name_end = self.name_end(at + 1, end);
                // Less: `.a();`, `.a(@b) { }`, `.a (@b) { }`
                let is_less = self.syntax == Syntax::Less && self.frames.is_empty();
                let has_arguments = is_less && name_end == end && self.is_before(next, b'(');
                if has_arguments {
                    let arguments = match self.end {
                        End::Block => Arguments::Definition,
                        _ => Arguments::Call,
                    };
                    self.opens = Some((Mode::Value, arguments));
                }
                let token = match byte {
                    _ if has_arguments => Token::Function,
                    // `.a;`, `.a !important;`
                    _ if self.is_call && name_end == end && self.is_last_name(next) => {
                        Token::Function
                    }
                    // `#a > .b();`, `#a.b();`
                    _ if self.is_call => Token::Namespace,
                    b'.' => Token::SelectorClass,
                    _ => Token::SelectorId,
                };
                self.name(at, name_end, end, token);
                name_end
            }
            b'%' if is_name_start(after) || after == b'-' => {
                let name_end = self.name_end(at + 1, end);
                self.name(at, name_end, end, Token::SelectorClass);
                name_end
            }
            b'&' => {
                self.add(at, at + 1, Token::Selector);
                // `&-a`, `&__a`
                let name_end = self.name_end(at + 1, end);
                self.name(at + 1, name_end, end, Token::SelectorClass);
                name_end
            }
            b'*' => {
                self.add(at, at + 1, Token::Selector);
                at + 1
            }
            b',' | b':' => {
                self.add(at, at + 1, Token::PunctuationDelimiter);
                at + 1
            }
            // What a `<style>` for very old browsers starts and ends with.
            b'<' | b'-' if matches!(self.text(at, end), b"<!--" | b"-->") => {
                self.add(at, end, Token::Comment);
                end
            }
            // `>>>`, `||`, `...`
            b'>' | b'+' | b'~' | b'|' | b'/' | b'^' | b'=' | b'<' | b'%' | b'.' | b'#' => {
                let mut operator_end = at + 1;
                while self.byte(operator_end, end) == byte {
                    operator_end += 1;
                }
                self.add(at, operator_end, Token::Operator);
                operator_end
            }
            b'$' | b'@' => self.variable(at, end, next, false),
            b'!' => self.bang(at, end),
            _ if is_name_byte(byte) || byte == b'\\' => {
                let name_end = self.name_end(at, end);
                let name = self.text(at, name_end);
                let is_less = self.syntax == Syntax::Less;
                let token = if name_end == end && self.is_before_paren(next, end) {
                    // Less: `each(@list, { .. })`
                    self.opens = Some((Mode::Value, Arguments::Call));
                    Token::Function
                } else if self.is_namespace(name_end, end) {
                    Token::Namespace
                } else if is_less && name == b"when" && self.frames.is_empty() {
                    self.state.mode = Mode::Value;
                    Token::KeywordControl
                } else if is_less && name == b"all" && !self.frames.is_empty() {
                    // `:extend(.a all)`
                    Token::Keyword
                } else if self.state.mode == Mode::Scope && name == b"to" {
                    Token::KeywordOperator
                } else if matches!(name, b"from" | b"to")
                    && (self.is_in_keyframes() || self.blocks.is_empty())
                {
                    // In `@keyframes`, or at the top: a `keyframes` template of JavaScript has no `@keyframes`.
                    Token::Keyword
                } else {
                    Token::Tag
                };
                self.name(at, name_end, end, token);
                name_end
            }
            _ => at + 1,
        }
    }

    fn value_word(&mut self, at: usize, end: usize, next: usize, is_first: bool) -> usize {
        let (byte, after) = (self.byte(at, end), self.byte(at + 1, end));
        let is_after_operand = std::mem::replace(&mut self.is_after_operand, true);
        let (token, len) = match byte {
            b'0'..=b'9' => return self.number(at, end),
            b'.' if after.is_ascii_digit() => return self.number(at, end),
            b'+' | b'-'
                if !is_after_operand
                    && (after.is_ascii_digit()
                        || (after == b'.' && self.byte(at + 2, end).is_ascii_digit())) =>
            {
                return self.number(at, end);
            }
            // `--a`
            b'-' if after == b'-' && self.name_end(at, end) > at + 2 => {
                let name_end = self.name_end(at, end);
                self.name(at, name_end, end, Token::Variable);
                return name_end;
            }
            b'-' if !is_after_operand && is_name_start(after) => {
                return self.value_name(at, end, next);
            }
            b'$' | b'@' => return self.variable(at, end, next, is_first),
            // `#fff`
            b'#' => {
                let name_end = self.name_end(at + 1, end);
                if name_end > at + 1 {
                    self.name(at, name_end, end, Token::Constant);
                }
                return name_end;
            }
            b'!' if after != b'=' => return self.bang(at, end),
            b'&' => (Token::Selector, 1),
            b',' => {
                self.state.is_first = true;
                (Token::PunctuationDelimiter, 1)
            }
            // In an at-word of Less: `@a:`
            b':' => {
                self.state.has_colon = true;
                (Token::PunctuationDelimiter, 1)
            }
            b'.' if self.text(at, end).starts_with(b"...") => (Token::Operator, 3),
            b'.' => (Token::PunctuationDelimiter, 1),
            // `==`, `!=`, `<=`, `>=`, and `=<` in Less
            b'=' | b'<' | b'>' | b'!' => (
                Token::Operator,
                1 + usize::from(matches!(after, b'=' | b'<')),
            ),
            b'+' | b'-' | b'*' | b'/' | b'%' | b'~' | b'|' | b'^' => (Token::Operator, 1),
            _ if is_name_start(byte) => return self.value_name(at, end, next),
            _ => return at + 1,
        };
        self.is_after_operand = false;
        self.add(at, at + len, token);
        at + len
    }

    /// `10px`, `-.5em`, `50%`, `1e3`
    fn number(&mut self, start: usize, end: usize) -> usize {
        let digits = start + usize::from(matches!(self.byte(start, end), b'+' | b'-'));
        let text = self.text(digits, end);
        let mut len = number_len(text).unwrap_or(0);
        // In `1.a`, the `.` isn't part of the number.
        if text.get(..len).is_some_and(|number| number.ends_with(b".")) {
            len -= 1;
        }
        self.add(start, digits + len, Token::Number);
        self.unit(digits + len, end)
    }

    /// The `px` or `%` after a number.
    fn unit(&mut self, start: usize, end: usize) -> usize {
        let text = self.text(start, end);
        let len = match text.first() {
            Some(b'%') => 1,
            _ => (text.iter())
                .take_while(|byte| byte.is_ascii_alphabetic())
                .count(),
        };
        self.add(start, start + len, Token::NumberUnit);
        start + len
    }

    /// `!important`, `!default`
    fn bang(&mut self, at: usize, end: usize) -> usize {
        let name_end = self.name_end(at + 1, end);
        self.add(at, name_end, Token::KeywordModifier);
        self.is_after_bang = name_end == at + 1;
        name_end
    }

    /// `$a`, `@a`, `@@a`
    fn variable(&mut self, at: usize, end: usize, next: usize, is_first: bool) -> usize {
        let is_at_word = self.byte(at, end) == b'@';
        let name_start = at + 1 + usize::from(is_at_word && self.byte(at + 1, end) == b'@');
        let name_end = self.name_end(name_start, end);
        if name_end == name_start {
            return name_start;
        }
        let name = self.text(name_start, name_end);
        let token = match self.state.arguments {
            _ if is_at_word && self.syntax != Syntax::Less => Token::KeywordDirective,
            Arguments::Definition if is_first => {
                self.declared.push(name);
                *self.parameters.entry(name).or_default() += 1;
                Token::VariableParameter
            }
            _ if self.parameters.contains_key(name) => Token::VariableParameter,
            // `a($b: 1)`
            Arguments::Call
                if is_first
                    && match name_end < end {
                        true => self.byte(name_end, end) == b':',
                        false => self.is_before(next, b':'),
                    } =>
            {
                Token::VariableParameter
            }
            _ => Token::Variable,
        };
        self.name(at, name_end, end, token);
        name_end
    }

    fn value_name(&mut self, at: usize, end: usize, next: usize) -> usize {
        // `U+0025-00FF`, `u+4??`
        let third = self.byte(at + 2, end);
        if matches!(self.byte(at, end), b'u' | b'U')
            && self.byte(at + 1, end) == b'+'
            && (third.is_ascii_hexdigit() || third == b'?')
        {
            let rest = self.text(at + 2, end);
            let len = (rest.iter())
                .take_while(|byte| byte.is_ascii_hexdigit() || matches!(byte, b'?' | b'-'))
                .count();
            self.add(at, at + 2 + len, Token::Number);
            return at + 2 + len;
        }
        let name_end = self.name_end(at, end);
        // SCSS: `math.div()`, `config.$a`
        let member = self.byte(name_end + 1, end);
        if self.syntax == Syntax::Scss
            && self.byte(name_end, end) == b'.'
            && (is_name_start(member) || matches!(member, b'$' | b'-'))
        {
            self.add(at, name_end, Token::Namespace);
            self.add(name_end, name_end + 1, Token::PunctuationDelimiter);
            return name_end + 1;
        }
        let token = self.token_of_name(self.text(at, name_end), name_end == end, next, end);
        self.name(at, name_end, end, token);
        name_end
    }

    /// What `name` is in a value or a query. `is_last`: it's the last of its words, which end at `end`. `next`: the index of
    /// the token after them.
    fn token_of_name(&mut self, name: &[u8], is_last: bool, next: usize, end: usize) -> Token {
        let is = |words: &[&[u8]]| words.iter().any(|word| name.eq_ignore_ascii_case(word));
        let mode = self.state.mode;
        let is_call = is_last && self.is_before_paren(next, end);
        if ((mode == Mode::Query || self.syntax != Syntax::Css) && is(&[b"and", b"or", b"not"]))
            || (mode == Mode::Query && is(&[b"only"]))
        {
            // `not(a)` is no function.
            if is_call {
                self.opens = Some((mode, Arguments::No));
            }
            return Token::KeywordOperator;
        }
        if self.frames.is_empty() && self.keywords.0.contains(&name) {
            match name {
                // `@use "a" as b`
                b"as" => self.state.name = Some(Token::Namespace),
                // `@use "a" with ($b: 1)`
                b"with" => self.opens = Some((Mode::Value, Arguments::Call)),
                // `@include a using ($b)`
                b"using" => self.opens = Some((Mode::Value, Arguments::Definition)),
                _ => {}
            }
            return self.keywords.1;
        }
        let given = self.state.name.take();
        if is_call {
            let inner = match mode {
                Mode::Query if is(&[b"selector"]) => Mode::Selector,
                Mode::Query if is(&[b"style", b"supports", b"scroll-state"]) => Mode::Query,
                _ => Mode::Value,
            };
            let arguments = match given {
                Some(_) => self.arguments_of_name,
                None => Arguments::Call,
            };
            self.opens = Some((inner, arguments));
            return Token::Function;
        }
        match given {
            // `@{a}`
            Some(Token::Variable) if self.parameters.contains_key(name) => {
                return Token::VariableParameter;
            }
            Some(token) => return token,
            None => {}
        }
        if std::mem::take(&mut self.is_after_bang) {
            return Token::KeywordModifier;
        }
        match (mode, name) {
            (Mode::Nth, b"of") => {
                self.state.mode = Mode::Selector;
                Token::KeywordOperator
            }
            // `(hover)`, `(width > 100px)`, `(min-width: 100px)`
            (Mode::Query, _) if self.state.is_in_brackets && !self.state.has_colon => {
                Token::Property
            }
            (Mode::Query, _) => Token::Constant,
            // The key of a map of SCSS: `(a: 1, b: 2)`
            _ if self.state.is_in_brackets && is_last && self.is_before(next, b':') => {
                Token::Property
            }
            (_, b"true" | b"false") if self.syntax != Syntax::Css => Token::Boolean,
            (_, b"null") if self.syntax == Syntax::Scss => Token::ConstantBuiltin,
            _ => Token::Constant,
        }
    }
}
