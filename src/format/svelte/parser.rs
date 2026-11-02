//! Svelte's `compiler/phases/1-parse`, 5.57: `index.js`, `state/*.js`, `read/{expression,context,script,options}.js`,
//! `utils/bracket.js`. Loose mode isn't ported.
//!
//! Only a JavaScript parser can tell where an expression ends. That's what [`Js`] is for.

use super::ast::{
    Comment, DirectiveKind, Element, ElementKind, Expression, ExpressionKind, FragmentId, Id, Kind,
    Pattern, Span, Tree, Value,
};
use crate::syntax_error::{Message, SyntaxError};
use bun_core::strings;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::cell::Cell;

/// `Err` is the error that Svelte throws.
type Result<T> = std::result::Result<T, SyntaxError>;

#[cold]
fn fail<T>(message: Message, at: usize) -> Result<T> {
    Err(SyntaxError(message, at as u32))
}

/// The result of acorn's `parseExpressionAt`.
#[derive(Debug, Copy, Clone)]
pub(crate) struct ParsedExpression {
    /// Without its surrounding parentheses.
    pub(crate) expression: Expression,
    /// `node.end`, which is after the parentheses.
    pub(crate) end: u32,
    /// For a sequence, its first expression without parentheses.
    pub(crate) first: Option<Expression>,
    /// The outermost `a as T` that ends where the expression (or a sequence's first expression) ends, given as the
    /// end of `a` and the start of `T`.
    pub(crate) assertion: Option<(u32, u32)>,
}

/// The result of acorn's `parseStatement`.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Statement {
    /// `let` or `const`, with the declaration's end offset.
    Declaration(u32),
    /// `var`, `using`.
    OtherDeclaration,
    Expression,
    Other,
}

/// A JavaScript and TypeScript parser. `text` is the component, cut off where the parser must stop looking, and `at`
/// is where parsing starts. `Err` is the offset of the first error.
pub(crate) trait Js {
    /// Sets whether the code that follows is TypeScript.
    fn start(&mut self, is_typescript: bool);
    /// Parses one expression, which can be a comma sequence.
    fn expression_at(
        &mut self,
        text: &[u8],
        at: usize,
    ) -> std::result::Result<ParsedExpression, usize>;
    /// Called when `text` has no valid expression at `at` because of whatever is at `until`. Returns the offsets
    /// where an expression before `until` could end, which is the end of every subexpression that isn't inside
    /// brackets or the like.
    fn ends_of_expressions(&mut self, text: &[u8], at: usize, until: usize) -> Vec<usize>;
    /// Parses one statement.
    fn statement_at(&mut self, text: &[u8], at: usize) -> std::result::Result<Statement, usize>;
    /// Parses one type. Returns its span, and true if there's a comment before or inside it.
    fn type_at(&mut self, text: &[u8], at: usize) -> std::result::Result<(Span, bool), usize>;
    /// Checks `pattern`, which is in brackets or braces, as the left side of an assignment. Returns true if it
    /// contains a comment.
    fn check_pattern(&mut self, text: &[u8], pattern: Span) -> std::result::Result<bool, usize>;
    /// Checks `parameters`, which run from a `<` or `(` to a `)`, as an arrow function's parameters.
    fn check_parameters(&mut self, text: &[u8], parameters: Span)
    -> std::result::Result<(), usize>;
}

const VOID_ELEMENT_NAMES: [&[u8]; 16] = [
    b"area", b"base", b"br", b"col", b"command", b"embed", b"hr", b"img", b"input", b"keygen",
    b"link", b"meta", b"param", b"source", b"track", b"wbr",
];

/// `is_void`
fn is_void(name: &[u8]) -> bool {
    VOID_ELEMENT_NAMES.contains(&name) || name.eq_ignore_ascii_case(b"!doctype")
}

pub(crate) const RESERVED_WORDS: [&[u8]; 48] = [
    b"arguments",
    b"await",
    b"break",
    b"case",
    b"catch",
    b"class",
    b"const",
    b"continue",
    b"debugger",
    b"default",
    b"delete",
    b"do",
    b"else",
    b"enum",
    b"eval",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"function",
    b"if",
    b"implements",
    b"import",
    b"in",
    b"instanceof",
    b"interface",
    b"let",
    b"new",
    b"null",
    b"package",
    b"private",
    b"protected",
    b"public",
    b"return",
    b"static",
    b"super",
    b"switch",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"typeof",
    b"var",
    b"void",
    b"while",
    b"with",
    b"yield",
];

/// `closing_tag_omitted(current, next)`
pub(crate) fn closing_tag_omitted(current: &[u8], next: &[u8]) -> bool {
    let closing: &[&[u8]] = match current {
        b"li" => &[b"li"],
        b"dt" | b"dd" => &[b"dt", b"dd"],
        b"p" => &[
            b"address",
            b"article",
            b"aside",
            b"blockquote",
            b"div",
            b"dl",
            b"fieldset",
            b"footer",
            b"form",
            b"h1",
            b"h2",
            b"h3",
            b"h4",
            b"h5",
            b"h6",
            b"header",
            b"hgroup",
            b"hr",
            b"main",
            b"menu",
            b"nav",
            b"ol",
            b"p",
            b"pre",
            b"section",
            b"table",
            b"ul",
        ],
        b"rt" | b"rp" => &[b"rt", b"rp"],
        b"optgroup" => &[b"optgroup"],
        b"option" => &[b"option", b"optgroup"],
        b"thead" | b"tbody" => &[b"tbody", b"tfoot"],
        b"tfoot" => &[b"tbody"],
        b"tr" => &[b"tr", b"tbody"],
        b"td" | b"th" => &[b"td", b"th", b"tr"],
        _ => &[],
    };
    closing.contains(&next)
}

fn code_points(text: &[u8]) -> impl Iterator<Item = u32> + '_ {
    strings::wtf8_codepoints(text).map(|it| it.1)
}

/// `PCENChar`, minus the ASCII characters.
fn is_custom_element_character(c: u32) -> bool {
    matches!(c,
        0xB7 | 0xC0..=0xD6 | 0xD8..=0xF6 | 0xF8..=0x37D | 0x37F..=0x1FFF | 0x200C..=0x200D
        | 0x203F..=0x2040 | 0x2070..=0x218F | 0x2C00..=0x2FEF | 0x3001..=0xD7FF
        | 0xF900..=0xFDCF | 0xFDF0..=0xFFFD | 0x10000..=0xEFFFF)
}

const RESERVED_TAG_NAMES: [&[u8]; 8] = [
    b"annotation-xml",
    b"color-profile",
    b"font-face",
    b"font-face-src",
    b"font-face-uri",
    b"font-face-format",
    b"font-face-name",
    b"missing-glyph",
];

/// `regex_valid_tag_name` in `read/options.js`: `^[a-z]${tag_name_char}*-${tag_name_char}*$`
fn is_valid_custom_element_name(name: &[u8]) -> bool {
    let is_character = |c: u32| {
        matches!(c, 0x61..=0x7A | 0x30..=0x39 | 0x5F | 0x2E | 0x2D)
            || is_custom_element_character(c)
    };
    name.first().is_some_and(u8::is_ascii_lowercase)
        && strings::contains_char(name, b'-')
        && code_points(name).all(is_character)
}

/// `is_valid_element_name`
fn is_valid_element_name(name: &[u8]) -> bool {
    let is_letter = u8::is_ascii_alphabetic;
    let is_letter_or_digit = u8::is_ascii_alphanumeric;
    // `/^![a-zA-Z]+$/`
    if let [b'!', rest @ ..] = name
        && !rest.is_empty()
        && rest.iter().all(is_letter)
    {
        return true;
    }
    // `/^[a-zA-Z][a-zA-Z0-9]*:[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/`
    if let Some((before, following)) = strings::split_once_char(name, b':')
        && before.first().is_some_and(is_letter)
        && before.iter().all(is_letter_or_digit)
        && let [first, middle @ .., last] = following
        && is_letter(first)
        && is_letter_or_digit(last)
        && middle
            .iter()
            .all(|it| is_letter_or_digit(it) || *it == b'-')
    {
        return true;
    }
    // `REGEX_VALID_TAG_NAME`
    let plain = name.iter().take_while(|it| is_letter_or_digit(*it)).count();
    name.first().is_some_and(is_letter)
        && match &name[plain..] {
            [] => true,
            [b'-', rest @ ..] => code_points(rest).all(|c| {
                matches!(c, 0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x2E | 0x2D | 0x5F)
                    || is_custom_element_character(c)
            }),
            _ => false,
        }
}

/// `regex_valid_component_name`
fn is_valid_component_name(name: &[u8]) -> bool {
    // `[$\u200c\u200d\p{ID_Continue}]`
    let is_part = |c: u32| bun_core::lexer::is_type_script_identifier_part(c as i32);
    let Some(first) = code_points(name).next() else {
        return false;
    };
    // `\p{Lu}[$\u200c\u200d\p{ID_Continue}.]*`
    if char::from_u32(first).is_some_and(char::is_uppercase)
        && (code_points(name).skip(1)).all(|c| is_part(c) || c == u32::from(b'.'))
    {
        return true;
    }
    // `\p{ID_Start}[..]*(?:\.[..]+)+`
    let mut parts = strings::split(name, b".");
    let head = parts.next().unwrap_or_default();
    let mut head = code_points(head);
    let starts_well = (head.next()).is_some_and(|c| {
        bun_core::lexer::is_identifier_start(c) && c != u32::from(b'$') && c != u32::from(b'_')
    });
    let mut count = 0;
    starts_well
        && head.all(is_part)
        && parts.all(|part| {
            count += 1;
            !part.is_empty() && code_points(part).all(is_part)
        })
        && count > 0
}

fn meta_tag(name: &[u8]) -> Option<ElementKind> {
    Some(match name {
        b"svelte:head" => ElementKind::SvelteHead,
        b"svelte:options" => ElementKind::SvelteOptions,
        b"svelte:window" => ElementKind::SvelteWindow,
        b"svelte:document" => ElementKind::SvelteDocument,
        b"svelte:body" => ElementKind::SvelteBody,
        b"svelte:element" => ElementKind::SvelteElement,
        b"svelte:component" => ElementKind::SvelteComponent,
        b"svelte:self" => ElementKind::SvelteSelf,
        b"svelte:fragment" => ElementKind::SvelteFragment,
        b"svelte:boundary" => ElementKind::SvelteBoundary,
        _ => return None,
    })
}

fn is_root_only(kind: ElementKind) -> bool {
    matches!(
        kind,
        ElementKind::SvelteHead
            | ElementKind::SvelteOptions
            | ElementKind::SvelteWindow
            | ElementKind::SvelteDocument
            | ElementKind::SvelteBody
    )
}

/// `get_directive_type`. `Err(())` means `style`.
fn directive_kind(name: &[u8]) -> Option<std::result::Result<DirectiveKind, ()>> {
    Some(Ok(match name {
        b"use" => DirectiveKind::Use,
        b"animate" => DirectiveKind::Animate,
        b"bind" => DirectiveKind::Bind,
        b"class" => DirectiveKind::Class,
        b"style" => return Some(Err(())),
        b"on" => DirectiveKind::On,
        b"let" => DirectiveKind::Let,
        b"in" => DirectiveKind::Transition(true, false),
        b"out" => DirectiveKind::Transition(false, true),
        b"transition" => DirectiveKind::Transition(true, true),
        _ => return None,
    }))
}

/// Where a sequence of text and expression tags ends.
#[derive(Copy, Clone)]
enum SequenceEnd {
    /// At this quote.
    Quote(u8),
    /// `regex_invalid_unquoted_attribute_value`
    Unquoted,
    /// `regex_closing_textarea_tag`
    Textarea,
}

struct Parser<'a, 'j> {
    /// `template`
    text: &'a [u8],
    /// `template.length`, which `{#each}` temporarily shortens.
    len: usize,
    index: usize,
    tree: Tree<'a>,
    /// `stack`, without the root.
    stack: Vec<Id>,
    /// For each entry of `stack`, the `parent_is_head` and `parent_is_shadowroot_template` that its children see.
    ancestor_flags: Vec<(bool, bool)>,
    /// A cache: where the last search for a `>` started, and where it found one. The text's length means there's
    /// none.
    next_end_of_tag: Cell<(usize, usize)>,
    fragments: Vec<FragmentId>,
    /// `meta_tags`
    seen_meta_tags: Vec<ElementKind>,
    /// `tag` and `depth`.
    last_auto_closed_tag: Option<(&'a [u8], usize)>,
    /// `ts`
    is_typescript: bool,
    js: &'j mut dyn Js,
}

impl<'a> Parser<'a, '_> {
    fn template(&self) -> &'a [u8] {
        &self.text[..self.len]
    }

    fn rest(&self) -> &'a [u8] {
        self.text.get(self.index..self.len).unwrap_or_default()
    }

    fn matches(&self, text: &[u8]) -> bool {
        self.rest().starts_with(text)
    }

    fn eat(&mut self, text: &[u8]) -> bool {
        let is_next = self.matches(text);
        if is_next {
            self.index += text.len();
        }
        is_next
    }

    /// `eat(text, true)`
    fn expect(&mut self, text: &[u8]) -> Result<()> {
        if self.eat(text) {
            return Ok(());
        }
        let message = match text {
            b"}" => Message::ExpectedClosingBrace,
            b">" => Message::ExpectedEndOfTag,
            b"(" => Message::ExpectedOpeningParenthesis,
            b")" => Message::ExpectedClosingParenthesis,
            b"=" => Message::ExpectedEquals,
            _ => Message::UnexpectedToken,
        };
        fail(message, self.index)
    }

    /// Like `expect`, for the terminator of something that starts at `start`. The error points at `start`.
    fn expect_end(&mut self, text: &[u8], message: Message, start: usize) -> Result<()> {
        match self.eat(text) {
            true => Ok(()),
            false => fail(message, start),
        }
    }

    fn allow_whitespace(&mut self) {
        while let len @ 1.. = strings::js_whitespace_len(self.rest()) {
            self.index += len;
        }
    }

    fn require_whitespace(&mut self) -> Result<()> {
        if strings::js_whitespace_len(self.rest()) == 0 {
            return fail(Message::ExpectedWhiteSpace, self.index);
        }
        self.allow_whitespace();
        Ok(())
    }

    /// `read_until(delimiter)`
    fn read_until(&mut self, delimiter: &[u8]) -> Result<&'a [u8]> {
        if self.index >= self.len {
            return fail(Message::UnexpectedEnd, self.len);
        }
        let rest = self.rest();
        let read = &rest[..strings::index_of(rest, delimiter).unwrap_or(rest.len())];
        self.index += read.len();
        Ok(read)
    }

    /// `read_identifier`. Returns an empty span if there's no identifier.
    fn read_identifier(&mut self) -> Result<Span> {
        let start = self.index;
        let rest = self.rest();
        let mut len = 0;
        for (at, c) in strings::wtf8_codepoints(rest) {
            let is_in_name = match at {
                0 => bun_core::lexer::is_identifier_start(c),
                _ => bun_core::lexer::is_type_script_identifier_part(c as i32),
            };
            if !is_in_name {
                break;
            }
            len = at + char::from_u32(c).map_or(1, char::len_utf8);
        }
        self.index += len;
        if RESERVED_WORDS.contains(&&rest[..len]) {
            return fail(Message::ReservedWord, start);
        }
        Ok(Span::new(start, self.index))
    }

    fn current(&self) -> Option<Id> {
        self.stack.last().copied()
    }

    fn append(&mut self, id: Id) {
        if let Some(fragment) =
            (self.fragments.last()).and_then(|&it| self.tree.fragments.get_mut(it as usize))
        {
            fragment.push(id);
        }
    }

    fn push(&mut self, id: Id, fragment: FragmentId) {
        let (is_in_head, is_in_template) = self.ancestor_flags.last().copied().unwrap_or_default();
        let element = self.element(id);
        self.ancestor_flags.push((
            match element.map(|it| it.kind) {
                Some(ElementKind::SvelteHead) => true,
                Some(ElementKind::RegularElement | ElementKind::Component) => false,
                _ => is_in_head,
            },
            is_in_template
                || element.is_some_and(|element| {
                    element.kind == ElementKind::RegularElement
                        && element.attributes.iter().any(|&it| {
                            matches!(
                                self.tree[it].kind,
                                Kind::Attribute {
                                    name: b"shadowrootmode",
                                    ..
                                }
                            )
                        })
                }),
        ));
        self.stack.push(id);
        self.fragments.push(fragment);
    }

    fn pop(&mut self) {
        self.fragments.pop();
        self.stack.pop();
        self.ancestor_flags.pop();
    }

    fn element(&self, id: Id) -> Option<&Element<'a>> {
        match &self.tree[id].kind {
            Kind::Element(element) => Some(element),
            _ => None,
        }
    }

    // ───────────── read/expression.js ─────────────

    /// Skips the comments that follow. The JavaScript parser already skipped them when it read the next token.
    fn skip_comments(&mut self) {
        let mut at = self.index;
        loop {
            let Some(rest) = self.text.get(at..self.len) else {
                return;
            };
            let rest = strings::trim_js_whitespace_start(rest);
            let start = self.len - rest.len();
            let end = match rest {
                [b'/', b'/', ..] => {
                    start + strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len())
                }
                [b'/', b'*', inner @ ..] => match strings::index_of(inner, b"*/") {
                    Some(len) => start + 2 + len + 2,
                    None => return,
                },
                _ => return,
            };
            (at, self.index) = (end, end);
        }
    }

    /// `read_expression`
    fn read_whole_expression(&mut self) -> Result<ParsedExpression> {
        let (template, index) = (self.template(), self.index);
        match self.js.expression_at(template, index) {
            Ok(mut parsed) => {
                self.index = parsed.end as usize;
                self.skip_comments();
                parsed.expression.outer = Span::new(index, self.index);
                Ok(parsed)
            }
            Err(at) => fail(Message::UnexpectedToken, at),
        }
    }

    /// Used between the names in `{@debug a, b}`.
    fn allow_whitespace_and_comments(&mut self) {
        loop {
            self.allow_whitespace();
            let rest = self.rest();
            let len = match rest {
                [b'/', b'*', ..] => strings::index_of(rest, b"*/").map(|at| at + 2),
                [b'/', b'/', ..] => strings::index_of_char_usize(rest, b'\n'),
                _ => None,
            };
            match len {
                Some(len) => self.index += len,
                None => return,
            }
        }
    }

    fn read_expression(&mut self) -> Result<Expression> {
        Ok(self.read_whole_expression()?.expression)
    }

    // ───────────── utils/bracket.js ─────────────

    /// `match_bracket`. `is_angle` means the brackets are `<` and `>`. Returns the end of the pair that opens at
    /// `start`.
    fn match_bracket(&self, start: usize, is_angle: bool) -> Result<usize> {
        // The brackets that are currently open.
        let mut open: Vec<u8> = Vec::new();
        let text = self.template();
        let mut i = start;
        // `open.len()` at the `${` of each enclosing template literal.
        let mut floors: Vec<usize> = vec![0];
        while i < text.len() {
            let char = text[i];
            i += 1;
            if matches!(char, b'\'' | b'"' | b'`') {
                // `${`
                if self.match_quote(&mut i, char)? {
                    floors.push(open.len());
                }
                continue;
            }
            let (is_open, is_close) = match floors.len() > 1 || !is_angle {
                true => (
                    matches!(char, b'{' | b'(' | b'['),
                    matches!(char, b'}' | b')' | b']'),
                ),
                false => (char == b'<', char == b'>'),
            };
            if is_open {
                open.push(char);
            } else if is_close {
                let floor = floors.last().copied().unwrap_or(0);
                let popped = (open.len() > floor).then(|| open.pop()).flatten();
                let expected = match popped {
                    Some(b'{') => b'}',
                    Some(b'(') => b')',
                    Some(b'[') => b']',
                    Some(b'<') => b'>',
                    _ => 0,
                };
                if char != expected {
                    return fail(Message::UnexpectedToken, i - 1);
                }
                if open.len() == floor {
                    if floors.len() == 1 {
                        return Ok(i);
                    }
                    // A template's `${..}` ends here, so continue with the template.
                    floors.pop();
                    if self.match_quote(&mut i, b'`')? {
                        floors.push(open.len());
                    }
                }
            }
        }
        fail(Message::UnexpectedEnd, text.len())
    }

    /// `match_quote`. Scans from just after the opening quote to the end of the string, or to a `${`. For a `${` it
    /// stops before the `{` and returns `true`.
    fn match_quote(&self, i: &mut usize, quote: u8) -> Result<bool> {
        let text = self.template();
        let start = *i;
        let mut is_escaped = false;
        while *i < text.len() {
            let char = text[*i];
            *i += 1;
            if is_escaped {
                is_escaped = false;
                continue;
            }
            if char == quote {
                return Ok(false);
            }
            if char == b'\\' {
                is_escaped = true;
            }
            if quote == b'`' && char == b'$' && text.get(*i) == Some(&b'{') {
                return Ok(true);
            }
        }
        fail(Message::UnclosedString, start)
    }

    // ───────────── read/context.js ─────────────

    /// `read_type_annotation`. Returns its span, and true if it contains a comment.
    fn read_type_annotation(&mut self) -> Result<Option<(Span, bool)>> {
        let start = self.index;
        self.allow_whitespace();
        if !self.eat(b":") {
            self.index = start;
            return Ok(None);
        }
        if !self.is_typescript {
            return fail(Message::TypeScriptInJavaScript, self.index - 1);
        }
        let (template, index) = (self.template(), self.index);
        match self.js.type_at(template, index) {
            Ok((span, has_comments)) => {
                self.index = span.end as usize;
                // The plugin drops the comment in `a: /* b */ C`.
                let before = template.get(index..span.start as usize).unwrap_or_default();
                let comments = strings::trim_js_whitespace_start(before).len();
                let span = Span::new(span.start as usize - comments, self.index);
                Ok(Some((span, has_comments)))
            }
            Err(at) => fail(Message::UnexpectedToken, at),
        }
    }

    /// `read_pattern`
    fn read_pattern(&mut self) -> Result<Pattern> {
        let start = self.index;
        let name = self.read_identifier()?;
        if name.end > name.start {
            let annotation = self.read_type_annotation()?;
            return Ok(Pattern {
                span: name,
                annotation: annotation.map(|it| it.0),
                has_comments: annotation.is_some_and(|it| it.1),
            });
        }
        if !matches!(self.text.get(start), Some(b'{' | b'[')) || start >= self.len {
            return fail(Message::ExpectedPattern, start);
        }
        self.index = self.match_bracket(start, false)?;
        let span = Span::new(start, self.index);
        let template = self.template();
        let has_comments = match self.js.check_pattern(template, span) {
            Ok(has_comments) => has_comments,
            Err(at) => return fail(Message::UnexpectedToken, at),
        };
        let annotation = self.read_type_annotation()?;
        Ok(Pattern {
            span: Span::new(start, self.index),
            annotation: annotation.map(|it| it.0),
            has_comments: has_comments || annotation.is_some_and(|it| it.1),
        })
    }

    // ───────────── state/element.js ─────────────

    /// `read_tag_name`
    fn read_tag_name(&mut self, is_attribute: bool) -> Result<&'a [u8]> {
        if self.index >= self.len {
            return fail(Message::UnexpectedEnd, self.len);
        }
        let rest = self.rest();
        let mut len = 0;
        while len < rest.len() {
            let byte = rest[len];
            if matches!(byte, b'/' | b'>')
                || (is_attribute && matches!(byte, b'"' | b'\'' | b'='))
                || strings::js_whitespace_len(&rest[len..]) > 0
            {
                break;
            }
            len += 1;
        }
        self.index += len;
        Ok(&rest[..len])
    }

    /// `parent_is_head`
    fn parent_is_head(&self) -> bool {
        self.ancestor_flags.last().is_some_and(|it| it.0)
    }

    /// `parent_is_shadowroot_template`
    fn parent_is_shadowroot_template(&self) -> bool {
        self.ancestor_flags.last().is_some_and(|it| it.1)
    }

    /// Reads `</name>`, starting just after the `/`. `start` is the offset of the `<`.
    fn close_element(&mut self, start: usize) -> Result<()> {
        let name = self.read_tag_name(false)?;
        self.allow_whitespace();
        self.expect(b">")?;
        if is_void(name) {
            return fail(Message::EndTagOfVoidElement, start);
        }
        // Implicitly close the elements that have no end tag: `<div><p></div>`.
        loop {
            let parent = self.current();
            let element = parent.and_then(|it| self.element(it));
            if element.is_some_and(|it| it.name == name) {
                break;
            }
            if element.is_none_or(|it| it.kind != ElementKind::RegularElement) {
                return match self.last_auto_closed_tag {
                    Some((tag, _)) if tag == name => fail(Message::EndTagOfClosedElement, start),
                    _ => fail(Message::EndTagWithoutStartTag, start),
                };
            }
            if let Some(parent) = parent {
                self.tree[parent].end = start as u32;
            }
            self.pop();
        }
        if let Some(parent) = self.current() {
            self.tree[parent].end = self.index as u32;
        }
        self.pop();
        // Svelte's stack also counts the root.
        if (self.last_auto_closed_tag).is_some_and(|(_, depth)| self.stack.len() + 1 < depth) {
            self.last_auto_closed_tag = None;
        }
        Ok(())
    }

    /// `element`
    fn read_element(&mut self) -> Result<()> {
        let start = self.index;
        self.index += 1;
        if self.eat(b"!--") {
            let data = self.read_until(b"-->")?;
            self.expect_end(b"-->", Message::UnclosedComment, start)?;
            let comment = self.tree.add(Kind::Comment { data }, start, self.index);
            self.append(comment);
            return Ok(());
        }
        if self.eat(b"/") {
            return self.close_element(start);
        }
        let name = self.read_tag_name(false)?;
        let meta = meta_tag(name);
        if name.starts_with(b"svelte:") && meta.is_none() {
            return fail(Message::UnknownSvelteElement, start + 1);
        }
        let is_component = is_valid_component_name(name);
        if !is_valid_element_name(name) && !is_component {
            return fail(Message::InvalidTagName, start + 1);
        }
        if let Some(kind) = meta.filter(|&it| is_root_only(it)) {
            if self.seen_meta_tags.contains(&kind) {
                return fail(Message::RepeatedElement, start);
            }
            if !self.stack.is_empty() {
                return fail(Message::NotAtTopLevel, start);
            }
            self.seen_meta_tags.push(kind);
        }
        let kind = match meta {
            Some(kind) => kind,
            None if is_component => ElementKind::Component,
            None if name == b"title" && self.parent_is_head() => ElementKind::TitleElement,
            None if name == b"slot" && !self.parent_is_shadowroot_template() => {
                ElementKind::SlotElement
            }
            None => ElementKind::RegularElement,
        };
        self.allow_whitespace();
        if let Some(parent) = self.current()
            && let Some(element) = self.element(parent)
            && element.kind == ElementKind::RegularElement
            && closing_tag_omitted(element.name, name)
        {
            let parent_name = element.name;
            self.tree[parent].end = start as u32;
            self.pop();
            self.last_auto_closed_tag = Some((parent_name, self.stack.len() + 1));
        }
        let is_top_level_script_or_style =
            matches!(name, b"script" | b"style") && self.stack.is_empty();
        // The kind and name of each attribute that may appear only once.
        let mut unique_names: FxHashSet<(u8, &'a [u8])> = FxHashSet::default();
        let mut attributes: Vec<Id> = Vec::new();
        loop {
            let attribute = match is_top_level_script_or_style {
                true => self.read_static_attribute()?,
                false => self.read_attribute()?,
            };
            let Some(attribute) = attribute else {
                break;
            };
            let unique = match &self.tree[attribute].kind {
                Kind::Attribute { name, .. } => Some((0, *name)),
                Kind::Directive {
                    kind: DirectiveKind::Bind,
                    name,
                    ..
                } => Some((0, *name)),
                Kind::StyleDirective { name, .. } => Some((1, *name)),
                Kind::Directive {
                    kind: DirectiveKind::Class,
                    name,
                    ..
                } => Some((2, *name)),
                _ => None,
            };
            if let Some(unique) = unique {
                if unique_names.contains(&unique) {
                    return fail(
                        Message::RepeatedAttribute,
                        self.tree[attribute].start as usize,
                    );
                }
                // `<svelte:element bind:this this=..>` is allowed.
                if unique.1 != b"this" {
                    unique_names.insert(unique);
                }
            }
            attributes.push(attribute);
            self.allow_whitespace();
        }
        let (mut this, mut multipart_this_attribute) = (None, None);
        if matches!(
            kind,
            ElementKind::SvelteComponent | ElementKind::SvelteElement
        ) {
            let is_component = kind == ElementKind::SvelteComponent;
            let index = attributes.iter().position(|&it| {
                matches!(self.tree[it].kind, Kind::Attribute { name: b"this", .. })
            });
            let Some(index) = index else {
                return fail(Message::MissingThis, start);
            };
            let definition = attributes.remove(index);
            let at = self.tree[definition].start as usize;
            let Kind::Attribute { value, .. } = &self.tree[definition].kind else {
                return fail(Message::MissingThis, at);
            };
            // `is_expression_attribute`, `get_attribute_expression`
            let first = match value {
                Value::True if is_component => return fail(Message::InvalidThis, at),
                Value::True => return fail(Message::MissingThis, at),
                Value::Tag(tag) => (*tag, true),
                Value::Parts(parts) => match parts[..] {
                    [only] => (only, true),
                    [first, ..] => (first, false),
                    [] => return fail(Message::MissingThis, at),
                },
            };
            if !first.1 {
                multipart_this_attribute = Some(Span {
                    start: self.tree[definition].start,
                    end: self.tree[definition].end,
                });
            }
            this = Some(match (&self.tree[first.0].kind, first.1) {
                (Kind::ExpressionTag(expression), true) => *expression,
                _ if is_component => return fail(Message::InvalidThis, at),
                (Kind::ExpressionTag(expression), false) => *expression,
                // Svelte makes a `Literal` that spans the text.
                _ => Expression::new(
                    Span {
                        start: self.tree[first.0].start,
                        end: self.tree[first.0].end,
                    },
                    ExpressionKind::Text,
                ),
            });
        }
        if matches!(name, b"script" | b"style") {
            // `/\slang=["']?ts["']?/`
            self.tree.uses_typescript |= attributes.iter().any(|&it| match &self.tree[it].kind {
                Kind::Attribute {
                    name: b"lang",
                    value,
                } => (self.attribute_text(value)).is_some_and(|it| it.starts_with(b"ts")),
                _ => false,
            });
        }
        if is_top_level_script_or_style {
            self.expect(b">")?;
            return match name {
                b"script" => self.read_script(start, attributes),
                _ => self.read_style(start, attributes),
            };
        }
        let fragment = self.tree.add_fragment();
        let element = Element {
            kind,
            name,
            attributes,
            fragment,
            this,
            multipart_this_attribute,
            start_tag_end: self.index as u32,
        };
        let id = self
            .tree
            .add(Kind::Element(Box::new(element)), start, start);
        self.append(id);
        let is_self_closing = self.eat(b"/") || is_void(name);
        self.expect(b">")?;
        if is_self_closing {
            // It's never pushed onto the stack.
        } else if name == b"textarea" {
            let nodes = self.read_sequence(SequenceEnd::Textarea)?;
            self.tree.fragments[fragment as usize] = nodes;
            self.index += self.closing_textarea_tag_len().unwrap_or(0);
        } else if matches!(name, b"script" | b"style") {
            let close_tag = [b"</", name, b">"].concat();
            let text_start = self.index;
            let rest = self.rest();
            let raw = &rest[..strings::index_of(rest, &close_tag).unwrap_or(rest.len())];
            self.index += raw.len();
            let text = self.add_text(text_start, self.index);
            self.tree.fragments[fragment as usize].push(text);
            self.expect_end(&close_tag, Message::UnclosedElement, start)?;
        } else {
            self.push(id, fragment);
            return Ok(());
        }
        self.tree[id].end = self.index as u32;
        Ok(())
    }

    /// Length of the match of `regex_closing_textarea_tag`, `/<\/textarea(\s[^>]*)?>/iy`.
    fn closing_textarea_tag_len(&self) -> Option<usize> {
        let rest = self.rest();
        let name = rest.get(..10)?;
        if !name.eq_ignore_ascii_case(b"</textarea") {
            return None;
        }
        match &rest[10..] {
            [b'>', ..] => Some(11),
            following if strings::js_whitespace_len(following) > 0 => {
                let from = self.index + 10;
                let (searched_from, mut end) = self.next_end_of_tag.get();
                if !(searched_from..=end).contains(&from) {
                    end = strings::index_of_char_usize(following, b'>')
                        .map_or(self.len, |it| from + it);
                    self.next_end_of_tag.set((from, end));
                }
                (end < self.len).then(|| end + 1 - self.index)
            }
            _ => None,
        }
    }

    fn add_text(&mut self, start: usize, end: usize) -> Id {
        let raw = Cow::Borrowed(&self.text[start..end]);
        self.tree.add(Kind::Text { raw }, start, end)
    }

    /// The source text of node `id`.
    fn source_text(&self, id: Id) -> &'a [u8] {
        &self.text[self.tree[id].start as usize..self.tree[id].end as usize]
    }

    /// `read_static_attribute`
    fn read_static_attribute(&mut self) -> Result<Option<Id>> {
        let start = self.index;
        let name = self.read_tag_name(true)?;
        if name.is_empty() {
            return Ok(None);
        }
        let mut value = Value::True;
        if self.eat(b"=") {
            self.allow_whitespace();
            // `/(?:"([^"]*)"|'([^'])*'|([^>\s]+))/y`
            let rest = self.rest();
            let quoted = match rest {
                [quote @ (b'"' | b'\''), inner @ ..] => strings::index_of_char_usize(inner, *quote),
                _ => None,
            };
            let text = match quoted {
                Some(len) => {
                    self.index += len + 2;
                    (self.index - len - 1, self.index - 1)
                }
                // Svelte reads this as an unquoted value but still strips its first and last characters: `lang="ts>`
                // is `t`. Where it ends depends on whether a quote follows anywhere in the component, so the element
                // can't be moved.
                None if matches!(rest, [b'"' | b'\'', ..]) => {
                    return fail(Message::UnclosedString, self.index);
                }
                None => {
                    let mut len = 0;
                    while len < rest.len()
                        && rest[len] != b'>'
                        && strings::js_whitespace_len(&rest[len..]) == 0
                    {
                        len += 1;
                    }
                    if len == 0 {
                        return fail(Message::ExpectedValue, self.index);
                    }
                    self.index += len;
                    (self.index - len, self.index)
                }
            };
            value = Value::Parts(vec![self.add_text(text.0, text.1)]);
        }
        if matches!(self.rest(), [b'"' | b'\'', ..]) {
            return fail(Message::ExpectedEquals, self.index);
        }
        let kind = Kind::Attribute { name, value };
        Ok(Some(self.tree.add(kind, start, self.index)))
    }

    /// `read_comment`
    fn read_comment(&mut self) -> Result<bool> {
        let start = self.index;
        let is_block = if self.eat(b"//") {
            self.read_until(b"\n")?;
            false
        } else if self.eat(b"/*") {
            self.read_until(b"*/")?;
            self.eat(b"*/");
            true
        } else {
            return Ok(false);
        };
        self.tree.comments.push(Comment {
            span: Span::new(start, self.index),
            is_block,
        });
        Ok(true)
    }

    /// `read_attribute`
    fn read_attribute(&mut self) -> Result<Option<Id>> {
        while self.read_comment()? {
            self.allow_whitespace();
        }
        let start = self.index;
        if self.eat(b"{") {
            self.allow_whitespace();
            if self.eat(b"@attach") {
                self.require_whitespace()?;
                let expression = self.read_expression()?;
                self.allow_whitespace();
                self.expect(b"}")?;
                let kind = Kind::AttachTag(expression);
                return Ok(Some(self.tree.add(kind, start, self.index)));
            }
            if self.eat(b"...") {
                let expression = self.read_expression()?;
                self.allow_whitespace();
                self.expect(b"}")?;
                let kind = Kind::SpreadAttribute(expression);
                return Ok(Some(self.tree.add(kind, start, self.index)));
            }
            let id = self.read_identifier()?;
            if id.end == id.start {
                return fail(Message::ExpectedName, start);
            }
            self.allow_whitespace();
            self.expect(b"}")?;
            let expression = Expression::new(id, ExpressionKind::Identifier);
            let (tag_start, tag_end) = (id.start as usize, id.end as usize);
            let tag = (self.tree).add(Kind::ExpressionTag(expression), tag_start, tag_end);
            let kind = Kind::Attribute {
                name: id.of(self.text),
                value: Value::Tag(tag),
            };
            return Ok(Some(self.tree.add(kind, start, self.index)));
        }
        let name = self.read_tag_name(true)?;
        if name.is_empty() {
            return Ok(None);
        }
        let mut end = self.index;
        self.allow_whitespace();
        let colon = strings::index_of_char_usize(name, b':');
        let directive = colon.and_then(|colon| directive_kind(&name[..colon]));
        let mut value = Value::True;
        if self.eat(b"=") {
            self.allow_whitespace();
            if self.matches(b"/>") {
                self.index += 1;
                value = Value::Parts(vec![self.add_text(self.index - 1, self.index)]);
            } else {
                value = self.read_attribute_value()?;
            }
            end = self.index;
        } else if matches!(self.rest(), [b'"' | b'\'', ..]) {
            return fail(Message::ExpectedEquals, self.index);
        }
        let (Some(directive), Some(colon)) = (directive, colon) else {
            return Ok(Some(self.tree.add(
                Kind::Attribute { name, value },
                start,
                end,
            )));
        };
        let mut parts = strings::split(&name[colon + 1..], b"|");
        let directive_name = parts.next().unwrap_or_default();
        let modifiers: Vec<&'a [u8]> = parts.collect();
        if directive_name.is_empty() {
            return fail(Message::DirectiveWithoutName, start);
        }
        let Ok(kind) = directive else {
            let kind = Kind::StyleDirective {
                name: directive_name,
                modifiers,
                value,
            };
            return Ok(Some(self.tree.add(kind, start, end)));
        };
        let first = match &value {
            Value::True => None,
            Value::Tag(tag) => Some((*tag, 1)),
            Value::Parts(parts) => parts.first().map(|&it| (it, parts.len())),
        };
        let mut expression = None;
        if let Some((first, count)) = first {
            match &self.tree[first].kind {
                Kind::ExpressionTag(it) if count == 1 => expression = Some(*it),
                _ => {
                    return fail(
                        Message::InvalidDirectiveValue,
                        self.tree[first].start as usize,
                    );
                }
            }
        }
        // The name doubles as the expression: `<p class:isRed />`.
        if matches!(kind, DirectiveKind::Bind | DirectiveKind::Class) && expression.is_none() {
            let name_start = start + colon + 1;
            let name = Span::new(name_start, name_start + directive_name.len());
            expression = Some(Expression::new(name, ExpressionKind::Identifier));
        }
        let kind = Kind::Directive {
            kind,
            name: directive_name,
            modifiers,
            expression,
        };
        Ok(Some(self.tree.add(kind, start, end)))
    }

    /// `read_attribute_value`
    fn read_attribute_value(&mut self) -> Result<Value> {
        let quote = match self.rest() {
            [quote @ (b'\'' | b'"'), ..] => Some(*quote),
            _ => None,
        };
        if let Some(quote) = quote {
            self.index += 1;
            if self.eat(&[quote]) {
                return Ok(Value::Parts(vec![
                    self.add_text(self.index - 1, self.index - 1),
                ]));
            }
        }
        let value = self.read_sequence(quote.map_or(SequenceEnd::Unquoted, SequenceEnd::Quote))?;
        if value.is_empty() && quote.is_none() {
            return fail(Message::ExpectedValue, self.index);
        }
        if quote.is_some() {
            self.index += 1;
        }
        let only = match value[..] {
            [only] if quote.is_none() && matches!(self.tree[only].kind, Kind::ExpressionTag(_)) => {
                Some(only)
            }
            _ => None,
        };
        Ok(only.map_or_else(|| Value::Parts(value), Value::Tag))
    }

    fn is_done(&self, done: SequenceEnd) -> bool {
        match done {
            SequenceEnd::Quote(quote) => self.rest().first() == Some(&quote),
            // `/(\/>|[\s"'=<>`])/y`
            SequenceEnd::Unquoted => {
                let rest = self.rest();
                rest.starts_with(b"/>")
                    || matches!(rest, [b'"' | b'\'' | b'=' | b'<' | b'>' | b'`', ..])
                    || strings::js_whitespace_len(rest) > 0
            }
            SequenceEnd::Textarea => self.closing_textarea_tag_len().is_some(),
        }
    }

    /// `read_sequence`
    fn read_sequence(&mut self, done: SequenceEnd) -> Result<Vec<Id>> {
        let mut chunks = Vec::new();
        let mut chunk_start = self.index;
        while self.index < self.len {
            let index = self.index;
            if self.is_done(done) {
                if index > chunk_start {
                    chunks.push(self.add_text(chunk_start, index));
                }
                return Ok(chunks);
            }
            if !self.eat(b"{") {
                self.index += 1;
                continue;
            }
            if self.matches(b"#") {
                return fail(Message::MisplacedBlock, index);
            }
            if self.matches(b"@") {
                return fail(Message::MisplacedTag, index);
            }
            if index > chunk_start {
                chunks.push(self.add_text(chunk_start, index));
            }
            self.allow_whitespace();
            let expression = self.read_expression()?;
            self.allow_whitespace();
            self.expect(b"}")?;
            chunks.push((self.tree).add(Kind::ExpressionTag(expression), index, self.index));
            chunk_start = self.index;
        }
        fail(Message::UnexpectedEnd, self.len)
    }

    // ───────────── read/script.js, read/style.js ─────────────

    /// The attribute value's text, if the value is a single `Text` node.
    fn attribute_text(&self, value: &Value) -> Option<&'a [u8]> {
        match value {
            Value::Parts(parts) => match parts[..] {
                [only] => match self.tree[only].kind {
                    Kind::Text { .. } => Some(self.source_text(only)),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    /// Moves past the first `/<\/script\s*>/` at or after `search`, or the same for `</style`. Returns the span of
    /// the content before it. `start` is the element's start.
    fn read_raw_content(
        &mut self,
        end_tag: &[u8],
        start: usize,
        mut search: usize,
    ) -> Result<Span> {
        let from = self.index;
        loop {
            let Some(found) = strings::index_of(&self.text[search..self.len], end_tag) else {
                return fail(Message::UnclosedElement, start);
            };
            let content_end = search + found;
            search = content_end + end_tag.len();
            let following = strings::trim_js_whitespace_start(&self.text[search..self.len]);
            if following.first() == Some(&b'>') {
                self.index = self.len - following.len() + 1;
                return Ok(Span::new(from, content_end));
            }
        }
    }

    /// `read_script`. The content isn't parsed.
    fn read_script(&mut self, start: usize, attributes: Vec<Id>) -> Result<()> {
        let content = self.read_raw_content(b"</script", start, self.index)?;
        let mut is_module = false;
        for &attribute in &attributes {
            let at = self.tree[attribute].start as usize;
            let Kind::Attribute { name, value } = &self.tree[attribute].kind else {
                continue;
            };
            match *name {
                b"server" | b"client" | b"worker" | b"test" | b"default" => {
                    return fail(Message::ReservedScriptAttribute, at);
                }
                b"module" => {
                    if *value != Value::True {
                        return fail(Message::ValueOfModuleAttribute, at);
                    }
                    is_module = true;
                }
                b"context" => {
                    if self.attribute_text(value) != Some(&b"module"[..]) {
                        return fail(Message::InvalidScriptContext, at);
                    }
                    is_module = true;
                }
                _ => {}
            }
        }
        let kind = Kind::Script {
            is_module,
            attributes,
            content,
        };
        let script = self.tree.add(kind, start, self.index);
        let slot = match is_module {
            true => &mut self.tree.module,
            false => &mut self.tree.instance,
        };
        if slot.replace(script).is_some() {
            return fail(Message::RepeatedElement, start);
        }
        Ok(())
    }

    /// `read_value`. Returns the offset of the `;`, `{` or `}` that ends the value starting at `start`. `is_prelude`
    /// means it's an at-rule's prelude. Otherwise, a value that ends at a `{` is read by `read_selector_list`, which
    /// throws at a `<` and at the end of `--a:`.
    ///
    /// Also returns `None` where Svelte reads on but the CSS formatter would either change a `</style` or stop
    /// reading:
    /// - a `</style` outside a string, a comment or `url(..)`
    /// - a string or `url(..)` that continues on the next line
    /// - `url(a"b")`, which the formatter rewrites
    /// - an unclosed parenthesis or bracket, which Svelte ignores
    fn end_of_css_value(&self, start: usize, is_prelude: bool) -> Option<usize> {
        let text = &self.text[..self.len];
        let (mut at, mut is_in_url, mut quote, mut has_angle) = (start, false, None, false);
        // The number of open parentheses and brackets, and the end of the last `url(`.
        let (mut open, mut url) = (0usize, start);
        loop {
            at += strings::index_of_any(text.get(at..)?, b"\\\"'()[]/;{}<\n")?;
            match text[at] {
                b'\n' if quote.is_some() || is_in_url => return None,
                b'<' if quote.is_none() && !is_in_url => {
                    if text[at..].starts_with(b"</style") {
                        return None;
                    }
                    has_angle = true;
                }
                b'\\' => at += 1,
                byte if quote == Some(byte) => quote = None,
                byte @ (b')' | b']') => {
                    if quote.is_none() && !is_in_url {
                        open = open.checked_sub(1)?;
                    }
                    is_in_url &= byte != b')';
                }
                byte @ (b'"' | b'\'') if quote.is_none() => {
                    if is_in_url && !text[url..at].trim_ascii().is_empty() {
                        return None;
                    }
                    quote = Some(byte);
                }
                byte @ (b'(' | b'[') => {
                    // Svelte also counts `aurl(` as a `url(`, and a `url(` inside a string.
                    let is_url = byte == b'('
                        && quote.is_none()
                        && matches!(&text[start..at], [before @ .., b'u', b'r', b'l']
                            if !before.last().is_some_and(|&it| !it.is_ascii() || is_in_css_name(it)));
                    open += usize::from(!is_url && quote.is_none() && !is_in_url);
                    is_in_url |= is_url;
                    if is_url {
                        url = at + 1;
                    }
                }
                b';' | b'{' | b'}' if !is_in_url && quote.is_none() && open > 0 => return None,
                b'{' if !is_in_url
                    && quote.is_none()
                    && !is_prelude
                    && (has_angle || text[start..at].trim_ascii_end().ends_with(b":")) =>
                {
                    return None;
                }
                b';' | b'{' | b'}' if !is_in_url && quote.is_none() => return Some(at),
                b'/' if !is_in_url && quote.is_none() && text.get(at + 1) == Some(&b'*') => {
                    at += css_comment_len(&text[at..])? - 1;
                }
                _ => {}
            }
            at += 1;
        }
    }

    /// Returns the offset where `read_style` finds the `</style` that ends the style sheet starting here. It only
    /// looks for one between rules, so not in `a { b: "</style>" }`. Returns `None` if `read_style` throws, and in
    /// the cases listed at [`Parser::end_of_css_value`].
    fn end_of_css(&self) -> Option<usize> {
        let text = &self.text[..self.len];
        let (mut at, mut depth) = (self.index, 0usize);
        loop {
            // `allow_comment_or_whitespace`, except for `<!-- -->`, which the CSS formatter doesn't treat as a
            // comment.
            let rest = strings::trim_js_whitespace_start(text.get(at..)?);
            at = text.len() - rest.len();
            if rest.starts_with(b"/*") {
                at += css_comment_len(rest)?;
                continue;
            }
            match rest.first()? {
                b'<' if depth == 0 && rest.starts_with(b"</style") => return Some(at),
                b'}' => depth = depth.checked_sub(1)?,
                // Neither a selector nor a declaration.
                b'{' | b';' => return None,
                // `read_at_rule`. The name isn't part of the prelude.
                b'@' => {
                    let name = rest[1..]
                        .iter()
                        .take_while(|&&it| !it.is_ascii() || is_in_css_name(it));
                    at = self.end_of_css_value(at + 1 + name.count(), true)?;
                    match text[at] {
                        b'{' => depth += 1,
                        b';' => {}
                        _ => return None,
                    }
                }
                _ => {
                    at = self.end_of_css_value(at, false)?;
                    match text[at] {
                        b'{' => depth += 1,
                        b';' => {}
                        _ => continue,
                    }
                }
            }
            at += 1;
        }
    }

    /// `read_style`. The content isn't parsed. With a `lang`, a preprocessor sees it first, and for a preprocessor it
    /// ends at the first end tag. The same goes for content that Svelte can't read.
    fn read_style(&mut self, start: usize, attributes: Vec<Id>) -> Result<()> {
        let is_css = attributes.iter().all(|&it| match &self.tree[it].kind {
            Kind::Attribute { name, value } if matches!(*name, b"lang" | b"type") => {
                matches!(self.attribute_text(value), Some(b"css" | b"text/css"))
            }
            _ => true,
        });
        let search = (is_css.then(|| self.end_of_css()).flatten()).unwrap_or(self.index);
        let content = self.read_raw_content(b"</style", start, search)?;
        let kind = Kind::StyleSheet {
            attributes,
            content,
        };
        let style = self.tree.add(kind, start, self.index);
        if self.tree.css.replace(style).is_some() {
            return fail(Message::RepeatedElement, start);
        }
        Ok(())
    }

    // ───────────── state/tag.js ─────────────

    /// `/\s*}/y`
    fn is_before_closing_brace(&self) -> bool {
        strings::trim_js_whitespace_start(self.rest()).first() == Some(&b'}')
    }

    /// True if `word` is next and isn't followed by a word character: `/word\b/y`.
    fn matches_word(&self, word: &[u8]) -> bool {
        (self.rest().strip_prefix(word)).is_some_and(|following| {
            following
                .first()
                .is_none_or(|&it| !strings::is_regexp_word_byte(it))
        })
    }

    /// `tag`
    fn read_tag(&mut self) -> Result<()> {
        let start = self.index;
        self.index += 1;
        self.allow_whitespace();
        if self.eat(b"#") {
            return self.open(start);
        }
        if self.eat(b":") {
            return self.next(start);
        }
        if self.eat(b"@") {
            return self.special(start);
        }
        if self.matches(b"/") && !self.matches(b"/*") && !self.matches(b"//") {
            self.index += 1;
            return self.close();
        }
        if let Some(declaration) = self.read_declaration()? {
            let tag = (self.tree).add(Kind::DeclarationTag(declaration), start, self.index);
            self.append(tag);
            return Ok(());
        }
        let expression = self.read_expression()?;
        self.allow_whitespace();
        self.expect(b"}")?;
        let tag = (self.tree).add(Kind::ExpressionTag(expression), start, self.index);
        self.append(tag);
        Ok(())
    }

    /// `read_declaration`
    fn read_declaration(&mut self) -> Result<Option<Span>> {
        let start = self.index;
        if [&b"var"[..], b"interface", b"enum"]
            .iter()
            .any(|it| self.matches_word(it))
        {
            return fail(Message::InvalidDeclarationTag, start);
        }
        if ![&b"let"[..], b"const", b"type"]
            .iter()
            .any(|it| self.matches_word(it))
        {
            return Ok(None);
        }
        let template = self.template();
        let end = match self.js.statement_at(template, start) {
            Ok(Statement::Declaration(end)) => end as usize,
            Ok(Statement::Expression) => return Ok(None),
            Ok(Statement::OtherDeclaration | Statement::Other) => {
                return fail(Message::InvalidDeclarationTag, start);
            }
            Err(at) if at == self.len => return fail(Message::UnexpectedEnd, at),
            Err(at) => return fail(Message::UnexpectedToken, at),
        };
        // The declaration includes its `;`.
        let semicolon = skip_trivia(template, end);
        let end = match template.get(semicolon) {
            Some(b';') => semicolon + 1,
            _ => end,
        };
        self.index = end;
        self.allow_whitespace();
        self.expect(b"}")?;
        Ok(Some(Span::new(start, end)))
    }

    fn add_block(&mut self, kind: Kind<'a>, start: usize, fragment: FragmentId) -> Result<()> {
        let block = self.tree.add(kind, start, start);
        self.append(block);
        self.push(block, fragment);
        Ok(())
    }

    /// Reads the expression of `{#each`.
    fn read_each_expression(&mut self) -> Result<ParsedExpression> {
        let index = self.index;
        let error = match self.read_whole_expression() {
            Ok(parsed) => return Ok(parsed),
            Err(error) => error,
        };
        // The `x as { y = z }` in `{#each x as { y = z }}` isn't an expression. Svelte cuts the text off at the last
        // `as` before the error and retries until what's left parses. It parses exactly where an unnested
        // subexpression ends, so the retries stop at the last such end that's followed by an `as`.
        let (template, until) = (self.template(), error.1 as usize);
        let ends = self.js.ends_of_expressions(template, index, until);
        let end = ends.into_iter().filter_map(|it| {
            let word = skip_trivia(&template[..until], it);
            (template[word..until].starts_with(b"as")).then_some(word)
        });
        let Some(end) = end.max() else {
            return Err(error);
        };
        let len = std::mem::replace(&mut self.len, end);
        self.index = index;
        let parsed = self.read_whole_expression();
        self.len = len;
        parsed.or(Err(error))
    }

    /// `open`
    fn open(&mut self, start: usize) -> Result<()> {
        if self.eat(b"if") {
            self.require_whitespace()?;
            let test = self.read_expression()?;
            self.allow_whitespace();
            self.expect(b"}")?;
            let consequent = self.tree.add_fragment();
            let kind = Kind::IfBlock {
                is_else_if: false,
                test,
                consequent,
                alternate: None,
            };
            return self.add_block(kind, start, consequent);
        }
        if self.eat(b"each") {
            self.require_whitespace()?;
            let parsed = self.read_each_expression()?;
            let mut expression = parsed.expression;
            self.allow_whitespace();
            // A context should follow: `{#each list as item}`.
            if !self.matches(b"as") {
                // The `as` may have been parsed as a TypeScript assertion.
                if let Some(first) = parsed.first {
                    // `outer` keeps the comments before it and has nothing after it.
                    let (start, end) = (expression.outer.start, first.span.end);
                    expression = Expression {
                        outer: Span { start, end },
                        ..first
                    };
                }
                if let Some((end, annotation)) = parsed.assertion {
                    expression.span.end = end;
                    expression.outer.end = end;
                    expression.kind = ExpressionKind::Other;
                    let mut at = (annotation as usize).saturating_sub(2);
                    while at > start && !self.text[at..].starts_with(b"as") {
                        at -= 1;
                    }
                    self.index = at;
                    // `outer` includes the comments before the `as`.
                    let following = self.text.get(end as usize..at).unwrap_or_default();
                    expression.outer.end = end + following.trim_ascii_end().len() as u32;
                }
            }
            let mut context = None;
            if self.eat(b"as") {
                self.require_whitespace()?;
                context = Some(self.read_pattern()?);
            } else {
                // `{#each Array.from({ length: 10 }), i}` was parsed as a sequence.
                self.index = expression.span.end as usize;
            }
            self.allow_whitespace();
            let mut index = None;
            if self.eat(b",") {
                self.allow_whitespace();
                let name = self.read_identifier()?;
                if name.end == name.start {
                    return fail(Message::ExpectedName, self.index);
                }
                index = Some(name.of(self.text));
                self.allow_whitespace();
            }
            let mut key = None;
            if self.eat(b"(") {
                self.allow_whitespace();
                key = Some(self.read_expression()?);
                self.allow_whitespace();
                self.expect(b")")?;
                self.allow_whitespace();
            }
            self.expect(b"}")?;
            let body = self.tree.add_fragment();
            let kind = Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback: None,
            };
            return self.add_block(kind, start, body);
        }
        if self.eat(b"await") {
            self.require_whitespace()?;
            let expression = self.read_expression()?;
            self.allow_whitespace();
            let (mut value, mut error) = (None, None);
            let (mut pending, mut then, mut catch) = (None, None, None);
            let fragment = self.tree.add_fragment();
            let clause = if self.eat(b"then") {
                then = Some(fragment);
                Some(&mut value)
            } else if self.eat(b"catch") {
                catch = Some(fragment);
                Some(&mut error)
            } else {
                pending = Some(fragment);
                None
            };
            if let Some(pattern) = clause {
                if self.is_before_closing_brace() {
                    self.allow_whitespace();
                } else {
                    self.require_whitespace()?;
                    *pattern = Some(self.read_pattern()?);
                    self.allow_whitespace();
                }
            }
            self.expect(b"}")?;
            let kind = Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            };
            return self.add_block(kind, start, fragment);
        }
        if self.eat(b"key") {
            self.require_whitespace()?;
            let expression = self.read_expression()?;
            self.allow_whitespace();
            self.expect(b"}")?;
            let fragment = self.tree.add_fragment();
            let kind = Kind::KeyBlock {
                expression,
                fragment,
            };
            return self.add_block(kind, start, fragment);
        }
        if self.eat(b"snippet") {
            self.require_whitespace()?;
            let name = self.read_identifier()?;
            if name.end == name.start {
                return fail(Message::ExpectedName, self.index);
            }
            self.allow_whitespace();
            let parameters_start = self.index;
            // `{#snippet foo<T>(..)}`
            if self.is_typescript && self.matches(b"<") {
                self.index = self.match_bracket(self.index, true)?;
            }
            self.allow_whitespace();
            self.expect(b"(")?;
            let mut parentheses = 1;
            while self.index < self.len && (!self.matches(b")") || parentheses != 1) {
                if self.matches(b"(") {
                    parentheses += 1;
                }
                if self.matches(b")") {
                    parentheses -= 1;
                }
                self.index += 1;
            }
            self.expect(b")")?;
            let (template, parameters) = (self.template(), Span::new(parameters_start, self.index));
            if let Err(at) = self.js.check_parameters(template, parameters) {
                return fail(Message::UnexpectedToken, at);
            }
            self.allow_whitespace();
            self.expect(b"}")?;
            let body = self.tree.add_fragment();
            let kind = Kind::SnippetBlock {
                expression: name,
                end_of_parameters: parameters.end,
                body,
            };
            return self.add_block(kind, start, body);
        }
        fail(Message::UnknownBlock, self.index)
    }

    /// Replaces the fragment that's being filled with a new one.
    fn next_fragment(&mut self) -> FragmentId {
        let fragment = self.tree.add_fragment();
        self.fragments.pop();
        self.fragments.push(fragment);
        fragment
    }

    /// `next`. `brace` is the offset of the `{`.
    fn next(&mut self, brace: usize) -> Result<()> {
        let start = self.index - 1;
        let Some(block) = self.current() else {
            return fail(Message::MisplacedClause, start);
        };
        match self.tree[block].kind {
            Kind::IfBlock { alternate, .. } => {
                if !self.eat(b"else") {
                    return fail(Message::MisplacedClause, start);
                }
                if self.eat(b"if") {
                    return fail(Message::ElseIfInOneWord, start);
                }
                if alternate.is_some() {
                    return fail(Message::RepeatedClause, start);
                }
                self.allow_whitespace();
                let fragment = self.next_fragment();
                if let Kind::IfBlock { alternate, .. } = &mut self.tree[block].kind {
                    *alternate = Some(fragment);
                }
                if !self.eat(b"if") {
                    self.allow_whitespace();
                    return self.expect(b"}");
                }
                self.require_whitespace()?;
                let test = self.read_expression()?;
                self.allow_whitespace();
                self.expect(b"}")?;
                let consequent = self.tree.add_fragment();
                let kind = Kind::IfBlock {
                    is_else_if: true,
                    test,
                    consequent,
                    alternate: None,
                };
                let child = self.tree.add(kind, brace, brace);
                self.append(child);
                self.fragments.pop();
                self.push(child, consequent);
                Ok(())
            }
            Kind::EachBlock { fallback, .. } => {
                if !self.eat(b"else") {
                    return fail(Message::MisplacedClause, start);
                }
                if fallback.is_some() {
                    return fail(Message::RepeatedClause, start);
                }
                self.allow_whitespace();
                self.expect(b"}")?;
                let fragment = self.next_fragment();
                if let Kind::EachBlock { fallback, .. } = &mut self.tree[block].kind {
                    *fallback = Some(fragment);
                }
                Ok(())
            }
            Kind::AwaitBlock { then, catch, .. } => {
                let is_then = self.eat(b"then");
                if !is_then && !self.eat(b"catch") {
                    return fail(Message::MisplacedClause, start);
                }
                if (if is_then { then } else { catch }).is_some() {
                    return fail(Message::RepeatedClause, start);
                }
                let mut pattern = None;
                if !self.eat(b"}") {
                    self.require_whitespace()?;
                    pattern = Some(self.read_pattern()?);
                    self.allow_whitespace();
                    self.expect(b"}")?;
                }
                let fragment = self.next_fragment();
                if let Kind::AwaitBlock {
                    value,
                    error,
                    then,
                    catch,
                    ..
                } = &mut self.tree[block].kind
                {
                    match is_then {
                        true => (*then, *value) = (Some(fragment), pattern.or(*value)),
                        false => (*catch, *error) = (Some(fragment), pattern.or(*error)),
                    }
                }
                Ok(())
            }
            _ => fail(Message::MisplacedClause, start),
        }
    }

    /// `close`
    fn close(&mut self) -> Result<()> {
        let start = self.index - 1;
        let Some(mut block) = self.current() else {
            return fail(Message::UnexpectedEndOfBlock, start);
        };
        let name: &[u8] = match self.tree[block].kind {
            Kind::IfBlock { .. } => b"if",
            Kind::EachBlock { .. } => b"each",
            Kind::KeyBlock { .. } => b"key",
            Kind::AwaitBlock { .. } => b"await",
            Kind::SnippetBlock { .. } => b"snippet",
            _ => return fail(Message::UnexpectedEndOfBlock, start),
        };
        self.expect_end(name, Message::WrongNameAtEndOfBlock, self.index)?;
        self.allow_whitespace();
        self.expect(b"}")?;
        while matches!(
            self.tree[block].kind,
            Kind::IfBlock {
                is_else_if: true,
                ..
            }
        ) {
            self.tree[block].end = self.index as u32;
            // An `{:else if}` replaced a fragment when it was pushed, so there's no fragment to pop.
            self.stack.pop();
            self.ancestor_flags.pop();
            match self.current() {
                Some(outer) => block = outer,
                None => break,
            }
        }
        self.tree[block].end = self.index as u32;
        self.pop();
        Ok(())
    }

    /// `special`
    fn special(&mut self, start: usize) -> Result<()> {
        let kind = if self.eat(b"html") {
            self.require_whitespace()?;
            let expression = self.read_expression()?;
            self.allow_whitespace();
            self.expect(b"}")?;
            Kind::HtmlTag(expression)
        } else if self.eat(b"debug") {
            let mut identifiers = Vec::new();
            if self.is_before_closing_brace() {
                self.allow_whitespace();
                self.index += 1;
            } else {
                // Only comma-separated identifiers are allowed, plus comments.
                let span = self.read_whole_expression()?.expression.span;
                let (after, end) = (self.index, span.end as usize);
                self.index = span.start as usize;
                loop {
                    self.allow_whitespace_and_comments();
                    let name = self.read_identifier()?;
                    if name.end == name.start {
                        return fail(Message::InvalidDebugTag, self.index);
                    }
                    identifiers.push(name);
                    self.allow_whitespace_and_comments();
                    if self.index >= end || !self.eat(b",") {
                        break;
                    }
                }
                if self.index < end {
                    return fail(Message::InvalidDebugTag, self.index);
                }
                self.index = after;
                self.allow_whitespace();
                self.expect(b"}")?;
            }
            Kind::DebugTag(identifiers)
        } else if self.eat(b"const") {
            self.require_whitespace()?;
            let id = self.read_pattern()?;
            self.allow_whitespace();
            self.expect(b"=")?;
            self.allow_whitespace();
            let expression_start = self.index;
            let init = self.read_expression()?;
            let declarator_end = self.index;
            let before =
                &self.text[expression_start..(init.span.start as usize).max(expression_start)];
            if init.kind == ExpressionKind::Sequence && !strings::contains_char(before, b'(') {
                return fail(Message::SequenceInConstTag, init.span.start as usize);
            }
            self.allow_whitespace();
            self.expect(b"}")?;
            Kind::ConstTag(Span::new(id.span.start as usize, declarator_end), init)
        } else if self.eat(b"render") {
            self.require_whitespace()?;
            let expression = self.read_expression()?;
            if expression.kind != ExpressionKind::Call {
                return fail(Message::InvalidRenderTag, expression.span.start as usize);
            }
            self.allow_whitespace();
            self.expect(b"}")?;
            Kind::RenderTag(expression)
        } else {
            return fail(Message::UnknownTag, self.index);
        };
        let tag = self.tree.add(kind, start, self.index);
        self.append(tag);
        Ok(())
    }

    // ───────────── index.js ─────────────

    fn read_text(&mut self) {
        let start = self.index;
        let rest = self.rest();
        self.index += strings::index_of_any(rest, b"<{").unwrap_or(rest.len());
        let text = self.add_text(start, self.index);
        self.append(text);
    }

    fn run(&mut self) -> Result<()> {
        while self.index < self.len {
            match self.text[self.index] {
                b'<' => self.read_element()?,
                b'{' => self.read_tag()?,
                _ => self.read_text(),
            }
        }
        if let Some(current) = self.current() {
            let is_element =
                (self.element(current)).is_some_and(|it| it.kind == ElementKind::RegularElement);
            return fail(
                match is_element {
                    true => Message::UnclosedElement,
                    false => Message::UnclosedBlock,
                },
                self.tree[current].start as usize,
            );
        }
        let root = self.tree.fragment as usize;
        let options = self.tree.fragments[root].iter().position(|&it| {
            matches!(&self.tree[it].kind, Kind::Element(it) if it.kind == ElementKind::SvelteOptions)
        });
        if let Some(index) = options {
            let options = self.tree.fragments[root].remove(index);
            self.tree.options = Some(options);
            self.check_options(options)?;
        }
        Ok(())
    }

    // ───────────── read/options.js ─────────────

    /// `get_static_value`. Returns the text, or the raw content of a string literal. `Ok(None)` means `true` and
    /// `Err` means `null`.
    fn static_value(&self, value: &Value) -> std::result::Result<Option<&'a [u8]>, ()> {
        let (chunk, count) = match value {
            Value::True => return Ok(None),
            Value::Tag(tag) => (*tag, 1),
            Value::Parts(parts) => match parts.first() {
                Some(&first) => (first, parts.len()),
                None => return Ok(None),
            },
        };
        match self.tree[chunk].kind {
            _ if count > 1 => Err(()),
            Kind::Text { .. } => Ok(Some(self.source_text(chunk))),
            Kind::ExpressionTag(Expression {
                span,
                kind: ExpressionKind::StringLiteral,
                ..
            }) => Ok(Some(match span.of(self.text) {
                [_, inner @ .., _] => inner,
                _ => b"",
            })),
            _ => Err(()),
        }
    }

    /// The first part of `value`, if it's text.
    fn first_part_text(&self, value: &Value) -> Option<&'a [u8]> {
        match value {
            Value::Parts(parts) => (parts.first().copied())
                .filter(|&it| matches!(self.tree[it].kind, Kind::Text { .. }))
                .map(|it| self.source_text(it)),
            _ => None,
        }
    }

    /// True if `get_boolean_value` finds a boolean.
    fn has_boolean_value(&self, value: &Value) -> bool {
        match value {
            Value::True => true,
            Value::Tag(tag) => matches!(self.tree[*tag].kind, Kind::ExpressionTag(it)
                if matches!(it.span.of(self.text), b"true" | b"false")),
            Value::Parts(parts) => match parts[..] {
                [] => true,
                [only] => matches!(self.tree[only].kind, Kind::ExpressionTag(it)
                    if matches!(it.span.of(self.text), b"true" | b"false")),
                _ => false,
            },
        }
    }

    /// `read_options`, `disallow_children`. The contents of `customElement`'s object aren't checked.
    fn check_options(&self, options: Id) -> Result<()> {
        let Some(element) = self.element(options) else {
            return Ok(());
        };
        for &attribute in &element.attributes {
            let at = self.tree[attribute].start as usize;
            let Kind::Attribute { name, value } = &self.tree[attribute].kind else {
                return fail(Message::NotStaticOption, at);
            };
            match *name {
                b"runes" | b"immutable" | b"preserveWhitespace" | b"accessors" => {
                    if !self.has_boolean_value(value) {
                        return fail(Message::InvalidOptionValue, at);
                    }
                }
                b"tag" => return fail(Message::DeprecatedTagOption, at),
                b"customElement" => {
                    // A text, an object, or `null`.
                    let is_fine =
                        value
                            .parts()
                            .first()
                            .is_some_and(|&first| match self.tree[first].kind {
                                Kind::ExpressionTag(it) => {
                                    it.kind == ExpressionKind::Object
                                        || it.span.of(self.text) == b"null"
                                }
                                _ => true,
                            });
                    if !is_fine {
                        return fail(Message::InvalidCustomElementOption, at);
                    }
                    // `validate_tag`
                    if let Some(tag) = self.first_part_text(value).filter(|it| !it.is_empty()) {
                        if !is_valid_custom_element_name(tag) {
                            return fail(Message::InvalidCustomElementName, at);
                        }
                        if RESERVED_TAG_NAMES.contains(&tag) {
                            return fail(Message::ReservedCustomElementName, at);
                        }
                    }
                }
                b"namespace" => {
                    let is_known = matches!(
                        self.static_value(value),
                        Ok(Some(
                            b"html"
                                | b"mathml"
                                | b"svg"
                                | b"http://www.w3.org/2000/svg"
                                | b"http://www.w3.org/1998/Math/MathML"
                        ))
                    );
                    if !is_known {
                        return fail(Message::InvalidOptionValue, at);
                    }
                }
                b"css" => {
                    if !matches!(self.static_value(value), Ok(Some(b"injected"))) {
                        return fail(Message::InvalidOptionValue, at);
                    }
                }
                _ => return fail(Message::UnknownOption, at),
            }
        }
        match self.tree.fragment(element.fragment).first() {
            Some(&first) => fail(Message::ChildrenNotAllowed, self.tree[first].start as usize),
            None => Ok(()),
        }
    }
}

/// Matches `lang=(["'])?([^"' >]+)\1[^>]*>` at `at` and returns the second group. `last_end` is the offset of the
/// last `>` in `text`.
fn lang_at(text: &[u8], at: usize, last_end: usize) -> Option<&[u8]> {
    let value = text.get(at..last_end)?.strip_prefix(b"lang=")?;
    let (quote, value) = match value {
        [quote @ (b'"' | b'\''), rest @ ..] => (Some(*quote), rest),
        _ => (None, value),
    };
    let len = (value.iter())
        .take_while(|it| !matches!(it, b'"' | b'\'' | b' ' | b'>'))
        .count();
    (len > 0 && quote.is_none_or(|quote| value.get(len) == Some(&quote))).then(|| &value[..len])
}

/// `\s+`: the end of the whitespace at `at`, or `None` if there isn't any.
fn end_of_whitespace(text: &[u8], mut at: usize) -> Option<usize> {
    let start = at;
    while let len @ 1.. = strings::js_whitespace_len(text.get(at..)?) {
        at += len;
    }
    (at > start).then_some(at)
}

/// Finds the first of `bytes` at or after an offset. The last result is cached and reused for any offset between
/// where that search started and what it found.
struct CachedSearch<'a> {
    text: &'a [u8],
    bytes: &'static [u8],
    searched_from: usize,
    /// The text's length if nothing was found.
    found: usize,
}

impl<'a> CachedSearch<'a> {
    fn new(text: &'a [u8], bytes: &'static [u8]) -> CachedSearch<'a> {
        CachedSearch {
            text,
            bytes,
            searched_from: 0,
            found: strings::index_of_any(text, bytes).unwrap_or(text.len()),
        }
    }

    fn from(&mut self, at: usize) -> usize {
        if !(self.searched_from..=self.found).contains(&at) {
            let found = strings::index_of_any(&self.text[at..], self.bytes);
            (self.searched_from, self.found) = (at, found.map_or(self.text.len(), |it| at + it));
        }
        self.found
    }
}

/// Matches `(?:[^=>'"/]+=(?:"[^"]*"|'[^']*'|[^>\s]+)\s+)*lang=..` at `start`. Returns the value of a `lang` that
/// comes after attributes with values, which can contain a `>`. `failed` collects the offsets, across the whole text,
/// where no match starts. `end_of_name` finds the end of `[^=>'"/]+`.
fn lang_after_attributes<'a>(
    text: &'a [u8],
    (start, last_end): (usize, usize),
    (failed, end_of_name): (&mut FxHashSet<usize>, &mut CachedSearch<'a>),
) -> Option<&'a [u8]> {
    // A backtracking stack. Each entry is an offset where an attribute may start and what to try there next: 0 is a
    // quoted value, 1 an unquoted value, 2 no more attributes.
    let mut stack = vec![(start, 0u8)];
    while let Some((at, way)) = stack.pop() {
        if way == 2 {
            match lang_at(text, at, last_end) {
                Some(lang) => return Some(lang),
                None => _ = failed.insert(at),
            }
            continue;
        }
        if failed.contains(&at) {
            continue;
        }
        stack.push((at, way + 1));
        let equals = end_of_name.from(at);
        if equals == at || text.get(equals) != Some(&b'=') {
            continue;
        }
        let value = equals + 1;
        let end = match (way, text.get(value)) {
            (0, Some(quote @ (b'"' | b'\''))) => {
                strings::index_of_char_usize(&text[value + 1..], *quote).map(|len| value + len + 2)
            }
            (0, _) => None,
            _ => {
                let mut end = value;
                while end < text.len()
                    && text[end] != b'>'
                    && strings::js_whitespace_len(&text[end..]) == 0
                {
                    end += 1;
                }
                (end > value).then_some(end)
            }
        };
        if let Some(next) = end.and_then(|it| end_of_whitespace(text, it)) {
            stack.push((next, 0));
        }
    }
    None
}

/// `regex_lang_attribute`. True if the first `<script>` with a `lang` has `ts`, whether it's the module or the
/// instance script.
fn is_typescript(text: &[u8]) -> bool {
    let (mut at, mut has_comment_end) = (0, true);
    // A `<script` before this offset is inside an earlier one's attributes, which were already searched for a `lang=`
    // without a match.
    let mut checked_until = 0;
    let mut failed = FxHashSet::default();
    let (mut end_of_tag, mut end_of_name) = (
        CachedSearch::new(text, b">"),
        CachedSearch::new(text, b"=>'\"/"),
    );
    let Some(last_end) = strings::last_index_of_char(text, b'>') else {
        return false;
    };
    while let Some(found) = strings::index_of_char_usize(&text[at..], b'<') {
        at += found + 1;
        let rest = &text[at..];
        if let Some(comment) = rest.strip_prefix(b"!--") {
            match (has_comment_end.then(|| strings::index_of(comment, b"-->"))).flatten() {
                Some(len) => at += 3 + len + 3,
                None => has_comment_end = false,
            }
            continue;
        }
        let Some(attributes) = (rest.starts_with(b"script"))
            .then(|| end_of_whitespace(text, at + 6))
            .flatten()
        else {
            continue;
        };
        // There's no `>` after this point.
        let Some(end) = (end_of_tag.from(attributes).checked_sub(attributes))
            .filter(|it| attributes + it < text.len())
        else {
            return false;
        };
        // `[^>]*lang=..` matches the last `lang=` before the first `>` that has a value, no matter what it's part of.
        let mut until = match attributes >= checked_until {
            true => attributes + end,
            false => attributes,
        };
        while let Some(lang) = strings::last_index_of(&text[attributes..until], b"lang=") {
            until = attributes + lang;
            if let Some(lang) = lang_at(text, until, last_end) {
                return lang == b"ts";
            }
        }
        checked_until = checked_until.max(attributes + end);
        let known = (&mut failed, &mut end_of_name);
        if let Some(lang) = lang_after_attributes(text, (attributes, last_end), known) {
            return lang == b"ts";
        }
    }
    false
}

/// `/[a-zA-Z0-9_-]/`, plus the `@` and `\\` that a name can start with or contain.
fn is_in_css_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'@' | b'\\')
}

/// Length of the comment at the start of `text`. Also returns `None` for a comment that contains a `</style` and then
/// a `<style`. That comment is really unclosed, and the `*/` belongs to the second style sheet. Svelte reads on
/// there.
fn css_comment_len(text: &[u8]) -> Option<usize> {
    let len = 2 + strings::index_of(text.get(2..)?, b"*/")? + 2;
    let end_tag = strings::index_of(&text[..len], b"</style");
    match end_tag.is_some_and(|at| strings::contains(&text[at..len], b"<style")) {
        true => None,
        false => Some(len),
    }
}

/// Skips the whitespace and comments at `at` and returns the offset after them.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        let rest = strings::trim_js_whitespace_start(&text[at..]);
        at = text.len() - rest.len();
        at += match rest {
            [b'/', b'/', ..] => strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len()),
            [b'/', b'*', inner @ ..] => match strings::index_of(inner, b"*/") {
                Some(len) => len + 4,
                None => return at,
            },
            _ => return at,
        };
    }
}

/// `parse(text, { modern: true })`
pub(crate) fn parse<'a>(text: &'a [u8], js: &mut dyn Js) -> Result<Tree<'a>> {
    let text = strings::trim_js_whitespace_end(text);
    js.start(is_typescript(text));
    let mut tree = Tree::default();
    // It gets id 0, which is `tree.fragment`'s default.
    let fragment = tree.add_fragment();
    let mut parser = Parser {
        text,
        len: text.len(),
        index: 0,
        is_typescript: is_typescript(text),
        tree,
        stack: Vec::new(),
        ancestor_flags: Vec::new(),
        next_end_of_tag: Cell::new((0, 0)),
        fragments: vec![fragment],
        seen_meta_tags: Vec::new(),
        last_auto_closed_tag: None,
        js,
    };
    parser.run()?;
    // Code that was parsed as TypeScript is printed as TypeScript. Svelte also accepts `data-lang="ts"`, but the
    // plugin doesn't, and it turns `f<T>(a)` into `f < T > a`.
    parser.tree.uses_typescript |= parser.is_typescript;
    Ok(parser.tree)
}
