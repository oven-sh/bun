//! Svelte's `compiler/phases/1-parse`, 5.57: `index.js`, `state/*.js`, `read/{expression,context,script,options}.js`,
//! `utils/bracket.js`. Not the loose mode.
//!
//! Where an expression ends only a parser of JavaScript can say: [`Js`].

use super::ast::{
    Comment, DirectiveKind, Element, ElementKind, Expression, ExpressionKind, FragmentId, Id, Kind,
    Pattern, Span, Tree, Value,
};
use bun_core::strings;
use rustc_hash::FxHashSet;
use std::borrow::Cow;

/// How many elements and blocks can be in each other.
const MAX_DEPTH: usize = 400;

/// What Svelte throws: its code, and where.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) struct Error {
    pub(crate) code: &'static str,
    pub(crate) at: u32,
}

type Result<T> = std::result::Result<T, Error>;

fn fail<T>(code: &'static str, at: usize) -> Result<T> {
    Err(Error {
        code,
        at: at as u32,
    })
}

/// What acorn's `parseExpressionAt` has found.
#[derive(Debug, Copy, Clone)]
pub(crate) struct ParsedExpression {
    /// Without the parentheses around it.
    pub(crate) expression: Expression,
    /// `node.end`: behind the parentheses.
    pub(crate) end: u32,
    /// Of a sequence: its first expression, without parentheses.
    pub(crate) first: Option<Expression>,
    /// The outermost `a as T` that ends where the expression ends, or the first of a sequence: where `a` ends, and where `T`
    /// starts.
    pub(crate) assertion: Option<(u32, u32)>,
}

/// What acorn's `parseStatement` has found.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Statement {
    /// `let` or `const`, and where the declaration ends.
    Declaration(u32),
    /// `var`, `using`.
    OtherDeclaration,
    Expression,
    Other,
}

/// A parser of JavaScript and TypeScript. `text` ends where the parser may not look any further, `at` is where it starts.
/// `Err`: where the first error is.
pub(crate) trait Js {
    /// Says whether what follows is TypeScript.
    fn start(&mut self, is_typescript: bool);
    /// One expression, commas included.
    fn expression_at(
        &mut self,
        text: &[u8],
        at: usize,
    ) -> std::result::Result<ParsedExpression, usize>;
    /// One statement.
    fn statement_at(&mut self, text: &[u8], at: usize) -> std::result::Result<Statement, usize>;
    /// One type. Returns where it is.
    fn type_at(&mut self, text: &[u8], at: usize) -> std::result::Result<Span, usize>;
    /// `pattern`, which is in brackets or braces, as the left side of an assignment.
    fn check_pattern(&mut self, text: &[u8], pattern: Span) -> std::result::Result<(), usize>;
    /// `parameters`, from a `<` or a `(` to a `)`, as those of an arrow function. Returns where the last ends, with its type.
    fn parameters(
        &mut self,
        text: &[u8],
        parameters: Span,
    ) -> std::result::Result<Option<u32>, usize>;
}

const VOID_ELEMENT_NAMES: [&[u8]; 16] = [
    b"area", b"base", b"br", b"col", b"command", b"embed", b"hr", b"img", b"input", b"keygen",
    b"link", b"meta", b"param", b"source", b"track", b"wbr",
];

/// `is_void`
fn is_void(name: &[u8]) -> bool {
    VOID_ELEMENT_NAMES.contains(&name) || name.eq_ignore_ascii_case(b"!doctype")
}

const RESERVED_WORDS: [&[u8]; 48] = [
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
fn closing_tag_omitted(current: &[u8], next: &[u8]) -> bool {
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

/// `PCENChar` without the ASCII ones.
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

/// `regex_valid_tag_name` of `read/options.js`: `^[a-z]${tag_name_char}*-${tag_name_char}*$`
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
    if let Some((before, behind)) = strings::split_once_char(name, b':')
        && before.first().is_some_and(is_letter)
        && before.iter().all(is_letter_or_digit)
        && let [first, middle @ .., last] = behind
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

/// `get_directive_type`. `Err(())`: `style`.
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

/// When a sequence of texts and expressions ends.
#[derive(Copy, Clone)]
enum Done {
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
    /// `template.length`, which `{#each}` makes less for a while.
    len: usize,
    index: usize,
    tree: Tree<'a>,
    /// `stack`, without the root.
    stack: Vec<Id>,
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
        match self.eat(text) {
            true => Ok(()),
            false => fail("expected_token", self.index),
        }
    }

    fn allow_whitespace(&mut self) {
        while let len @ 1.. = strings::js_whitespace_len(self.rest()) {
            self.index += len;
        }
    }

    fn require_whitespace(&mut self) -> Result<()> {
        if strings::js_whitespace_len(self.rest()) == 0 {
            return fail("expected_whitespace", self.index);
        }
        self.allow_whitespace();
        Ok(())
    }

    /// `read_until(delimiter)`
    fn read_until(&mut self, delimiter: &[u8]) -> Result<&'a [u8]> {
        if self.index >= self.len {
            return fail("unexpected_eof", self.len);
        }
        let rest = self.rest();
        let read = &rest[..strings::index_of(rest, delimiter).unwrap_or(rest.len())];
        self.index += read.len();
        Ok(read)
    }

    /// `read_identifier`. The name is empty if there is none.
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
            return fail("unexpected_reserved_word", start);
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

    fn push(&mut self, id: Id, fragment: FragmentId) -> Result<()> {
        self.stack.push(id);
        self.fragments.push(fragment);
        match self.stack.len() > MAX_DEPTH {
            true => fail("nested_too_deeply", self.index),
            false => Ok(()),
        }
    }

    fn pop(&mut self) {
        self.fragments.pop();
        self.stack.pop();
    }

    fn element(&self, id: Id) -> Option<&Element<'a>> {
        match &self.tree[id].kind {
            Kind::Element(element) => Some(element),
            _ => None,
        }
    }

    // ───────────── read/expression.js ─────────────

    /// Goes on behind the comments that follow: the parser has passed them when it looked at the next token.
    fn pass_comments(&mut self) {
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
            Ok(parsed) => {
                self.index = parsed.end as usize;
                self.pass_comments();
                Ok(parsed)
            }
            Err(at) => fail("js_parse_error", at),
        }
    }

    /// Between the names of `{@debug a, b}`.
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

    /// `match_bracket`. `is_pointed`: the brackets are `<` and `>`. Returns where what starts at `start` ends.
    fn match_bracket(&self, start: usize, is_pointed: bool) -> Result<usize> {
        // What is open: brackets, and the quotes of templates that an expression is open in.
        let mut open: Vec<u8> = Vec::new();
        let text = self.template();
        let mut i = start;
        // How many of `open` were there when the template was entered whose expression this is.
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
            let (is_open, is_close) = match floors.len() > 1 || !is_pointed {
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
                    return fail("expected_token", i - 1);
                }
                if open.len() == floor {
                    if floors.len() == 1 {
                        return Ok(i);
                    }
                    // The expression of a template ends: on with the template.
                    floors.pop();
                    if self.match_quote(&mut i, b'`')? {
                        floors.push(open.len());
                    }
                }
            }
        }
        fail("unexpected_eof", text.len())
    }

    /// `match_quote`, from behind the quote on, up to the end of the string or to a `${`, whose `{` is next then: it returns
    /// `true` for that.
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
        fail("unterminated_string_constant", start)
    }

    // ───────────── read/context.js ─────────────

    /// `read_type_annotation`
    fn read_type_annotation(&mut self) -> Result<Option<Span>> {
        let start = self.index;
        self.allow_whitespace();
        if !self.eat(b":") {
            self.index = start;
            return Ok(None);
        }
        let (template, index) = (self.template(), self.index);
        match self.js.type_at(template, index) {
            Ok(span) => {
                self.index = span.end as usize;
                Ok(Some(span))
            }
            Err(at) => fail("js_parse_error", at),
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
                annotation,
            });
        }
        if !matches!(self.text.get(start), Some(b'{' | b'[')) || start >= self.len {
            return fail("expected_pattern", start);
        }
        self.index = self.match_bracket(start, false)?;
        let span = Span::new(start, self.index);
        let template = self.template();
        if let Err(at) = self.js.check_pattern(template, span) {
            return fail("js_parse_error", at);
        }
        let annotation = self.read_type_annotation()?;
        Ok(Pattern {
            span: Span::new(start, self.index),
            annotation,
        })
    }

    // ───────────── state/element.js ─────────────

    /// `read_tag_name`
    fn read_tag_name(&mut self, is_attribute: bool) -> Result<&'a [u8]> {
        if self.index >= self.len {
            return fail("unexpected_eof", self.len);
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
        for &id in self.stack.iter().rev() {
            match self.element(id).map(|it| it.kind) {
                Some(ElementKind::SvelteHead) => return true,
                Some(ElementKind::RegularElement | ElementKind::Component) => return false,
                _ => {}
            }
        }
        false
    }

    /// `parent_is_shadowroot_template`
    fn parent_is_shadowroot_template(&self) -> bool {
        self.stack.iter().any(|&id| {
            self.element(id).is_some_and(|element| {
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
            })
        })
    }

    /// `</name>`, from behind the `/` on. `start`: where the `<` is.
    fn close_element(&mut self, start: usize) -> Result<()> {
        let name = self.read_tag_name(false)?;
        self.allow_whitespace();
        self.expect(b">")?;
        if is_void(name) {
            return fail("void_element_invalid_content", start);
        }
        // Elements that have no end tags of their own are closed: `<div><p></div>`.
        loop {
            let parent = self.current();
            let element = parent.and_then(|it| self.element(it));
            if element.is_some_and(|it| it.name == name) {
                break;
            }
            if element.is_none_or(|it| it.kind != ElementKind::RegularElement) {
                return match self.last_auto_closed_tag {
                    Some((tag, _)) if tag == name => {
                        fail("element_invalid_closing_tag_autoclosed", start)
                    }
                    _ => fail("element_invalid_closing_tag", start),
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
        // The root counts in Svelte's stack.
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
            self.expect(b"-->")?;
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
            return fail("svelte_meta_invalid_tag", start + 1);
        }
        let is_component = is_valid_component_name(name);
        if !is_valid_element_name(name) && !is_component {
            return fail("tag_invalid_name", start + 1);
        }
        if let Some(kind) = meta.filter(|&it| is_root_only(it)) {
            if self.seen_meta_tags.contains(&kind) {
                return fail("svelte_meta_duplicate", start);
            }
            if !self.stack.is_empty() {
                return fail("svelte_meta_invalid_placement", start);
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
        // The kind and the name of those that may be there once.
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
                    return fail("attribute_duplicate", self.tree[attribute].start as usize);
                }
                // `<svelte:element bind:this this=..>` is allowed.
                if unique.1 != b"this" {
                    unique_names.insert(unique);
                }
            }
            attributes.push(attribute);
            self.allow_whitespace();
        }
        let mut this = None;
        if matches!(
            kind,
            ElementKind::SvelteComponent | ElementKind::SvelteElement
        ) {
            let is_component = kind == ElementKind::SvelteComponent;
            let index = attributes.iter().position(|&it| {
                matches!(self.tree[it].kind, Kind::Attribute { name: b"this", .. })
            });
            let Some(index) = index else {
                return fail(
                    match is_component {
                        true => "svelte_component_missing_this",
                        false => "svelte_element_missing_this",
                    },
                    start,
                );
            };
            let definition = attributes.remove(index);
            let at = self.tree[definition].start as usize;
            let Kind::Attribute { value, .. } = &self.tree[definition].kind else {
                return fail("svelte_element_missing_this", at);
            };
            // `is_expression_attribute`, `get_attribute_expression`
            let first = match value {
                Value::True if is_component => return fail("svelte_component_invalid_this", at),
                Value::True => return fail("svelte_element_missing_this", at),
                Value::Tag(tag) => (*tag, true),
                Value::Parts(parts) => match parts[..] {
                    [only] => (only, true),
                    [first, ..] => (first, false),
                    [] => return fail("svelte_element_missing_this", at),
                },
            };
            this = Some(match (&self.tree[first.0].kind, first.1) {
                (Kind::ExpressionTag(expression), true) => *expression,
                _ if is_component => return fail("svelte_component_invalid_this", at),
                (Kind::ExpressionTag(expression), false) => *expression,
                // A `Literal` where the text is.
                _ => Expression::new(
                    Span {
                        start: self.tree[first.0].start,
                        end: self.tree[first.0].end,
                    },
                    ExpressionKind::StringLiteral,
                ),
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
        };
        let id = self
            .tree
            .add(Kind::Element(Box::new(element)), start, start);
        self.append(id);
        let is_self_closing = self.eat(b"/") || is_void(name);
        self.expect(b">")?;
        if is_self_closing {
            // Not on the stack.
        } else if name == b"textarea" {
            let nodes = self.read_sequence(Done::Textarea)?;
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
            self.expect(&close_tag)?;
        } else {
            return self.push(id, fragment);
        }
        self.tree[id].end = self.index as u32;
        Ok(())
    }

    /// `regex_closing_textarea_tag`, `/<\/textarea(\s[^>]*)?>/iy`: how long the match is.
    fn closing_textarea_tag_len(&self) -> Option<usize> {
        let rest = self.rest();
        let name = rest.get(..10)?;
        if !name.eq_ignore_ascii_case(b"</textarea") {
            return None;
        }
        match &rest[10..] {
            [b'>', ..] => Some(11),
            behind if strings::js_whitespace_len(behind) > 0 => {
                Some(10 + strings::index_of_char_usize(behind, b'>')? + 1)
            }
            _ => None,
        }
    }

    fn add_text(&mut self, start: usize, end: usize) -> Id {
        let raw = Cow::Borrowed(&self.text[start..end]);
        self.tree.add(Kind::Text { raw }, start, end)
    }

    /// The text that the node `id` is made of.
    fn written(&self, id: Id) -> &'a [u8] {
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
                None => {
                    let mut len = 0;
                    while len < rest.len()
                        && rest[len] != b'>'
                        && strings::js_whitespace_len(&rest[len..]) == 0
                    {
                        len += 1;
                    }
                    if len == 0 {
                        return fail("expected_attribute_value", self.index);
                    }
                    self.index += len;
                    match rest[0] {
                        // It counts as quoted all the same, and loses its ends.
                        b'"' | b'\'' => (self.index - len.saturating_sub(2) - 1, self.index - 1),
                        _ => (self.index - len, self.index),
                    }
                }
            };
            value = Value::Parts(vec![self.add_text(text.0, text.1)]);
        }
        if matches!(self.rest(), [b'"' | b'\'', ..]) {
            return fail("expected_token", self.index);
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
                return fail("attribute_empty_shorthand", start);
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
            return fail("expected_token", self.index);
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
            return fail("directive_missing_name", start);
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
                _ => return fail("directive_invalid_value", self.tree[first].start as usize),
            }
        }
        // The name is the expression: `<p class:isRed />`.
        if matches!(kind, DirectiveKind::Bind | DirectiveKind::Class) && expression.is_none() {
            let name = Span::new(start + colon + 1, end);
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
        let value = self.read_sequence(quote.map_or(Done::Unquoted, Done::Quote))?;
        if value.is_empty() && quote.is_none() {
            return fail("expected_attribute_value", self.index);
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

    fn is_done(&self, done: Done) -> bool {
        match done {
            Done::Quote(quote) => self.rest().first() == Some(&quote),
            // `/(\/>|[\s"'=<>`])/y`
            Done::Unquoted => {
                let rest = self.rest();
                rest.starts_with(b"/>")
                    || matches!(rest, [b'"' | b'\'' | b'=' | b'<' | b'>' | b'`', ..])
                    || strings::js_whitespace_len(rest) > 0
            }
            Done::Textarea => self.closing_textarea_tag_len().is_some(),
        }
    }

    /// `read_sequence`
    fn read_sequence(&mut self, done: Done) -> Result<Vec<Id>> {
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
                return fail("block_invalid_placement", index);
            }
            if self.matches(b"@") {
                return fail("tag_invalid_placement", index);
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
        fail("unexpected_eof", self.len)
    }

    // ───────────── read/script.js, read/style.js ─────────────

    /// The text of the attribute `id`, if that is all its value is.
    fn text_of_attribute(&self, value: &Value) -> Option<&'a [u8]> {
        match value {
            Value::Parts(parts) => match parts[..] {
                [only] => match self.tree[only].kind {
                    Kind::Text { .. } => Some(self.written(only)),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    /// `read_script`. What is in it has been snipped: it is `{}`.
    fn read_script(&mut self, start: usize, attributes: Vec<Id>) -> Result<()> {
        // `/<\/script\s*>/`
        let mut search = self.index;
        let end = loop {
            let Some(found) = strings::index_of(&self.text[search..self.len], b"</script") else {
                return fail("element_unclosed", self.len);
            };
            search += found + 8;
            let behind = strings::trim_js_whitespace_start(&self.text[search..self.len]);
            if behind.first() == Some(&b'>') {
                break self.len - behind.len() + 1;
            }
        };
        self.index = end;
        let mut is_module = false;
        for &attribute in &attributes {
            let at = self.tree[attribute].start as usize;
            let Kind::Attribute { name, value } = &self.tree[attribute].kind else {
                continue;
            };
            match *name {
                b"server" | b"client" | b"worker" | b"test" | b"default" => {
                    return fail("script_reserved_attribute", at);
                }
                b"module" => {
                    if *value != Value::True {
                        return fail("script_invalid_attribute_value", at);
                    }
                    is_module = true;
                }
                b"context" => {
                    if self.text_of_attribute(value) != Some(&b"module"[..]) {
                        return fail("script_invalid_context", at);
                    }
                    is_module = true;
                }
                _ => {}
            }
        }
        let kind = Kind::Script {
            is_module,
            attributes,
        };
        let script = self.tree.add(kind, start, self.index);
        let slot = match is_module {
            true => &mut self.tree.module,
            false => &mut self.tree.instance,
        };
        if slot.replace(script).is_some() {
            return fail("script_duplicate", start);
        }
        Ok(())
    }

    /// `read_style`. What is in it has been snipped: nothing is.
    fn read_style(&mut self, start: usize, attributes: Vec<Id>) -> Result<()> {
        self.allow_whitespace();
        self.expect(b"</style")?;
        self.allow_whitespace();
        self.eat(b">");
        let style = (self.tree).add(Kind::StyleSheet { attributes }, start, self.index);
        if self.tree.css.replace(style).is_some() {
            return fail("style_duplicate", start);
        }
        Ok(())
    }

    // ───────────── state/tag.js ─────────────

    /// `/\s*}/y`
    fn is_before_closing_brace(&self) -> bool {
        strings::trim_js_whitespace_start(self.rest()).first() == Some(&b'}')
    }

    /// Whether `word` is next, and no part of a name behind it: `/word\b/y`.
    fn matches_word(&self, word: &[u8]) -> bool {
        (self.rest().strip_prefix(word)).is_some_and(|behind| {
            behind
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
            return fail("declaration_tag_invalid_type", start);
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
                return fail("declaration_tag_invalid_type", start);
            }
            Err(at) if at == self.len => return fail("unexpected_eof", at),
            Err(at) => return fail("js_parse_error", at),
        };
        self.index = end;
        self.allow_whitespace();
        self.expect(b"}")?;
        Ok(Some(Span::new(start, end)))
    }

    fn add_block(&mut self, kind: Kind<'a>, start: usize, fragment: FragmentId) -> Result<()> {
        let block = self.tree.add(kind, start, start);
        self.append(block);
        self.push(block, fragment)
    }

    /// The expression of `{#each`.
    fn read_expression_of_each(&mut self, start: usize) -> Result<ParsedExpression> {
        // `{#each x as { y = z }}` is no expression. What is from an `as` on is hidden until there is one.
        let len = self.len;
        let parsed = loop {
            match self.read_whole_expression() {
                Ok(parsed) => break Ok(parsed),
                Err(error) => {
                    let mut end = (error.at as usize).saturating_sub(2).min(self.len);
                    while end > start && !self.template()[end..].starts_with(b"as") {
                        end -= 1;
                    }
                    if end <= start {
                        break Err(error);
                    }
                    self.len = end;
                }
            }
        };
        self.len = len;
        parsed
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
            let parsed = self.read_expression_of_each(start)?;
            let mut expression = parsed.expression;
            self.allow_whitespace();
            // A context has to follow: `{#each list as item}`.
            if !self.matches(b"as") {
                // It may have been taken for an assertion of TypeScript.
                if let Some(first) = parsed.first {
                    expression = first;
                }
                if let Some((end, annotation)) = parsed.assertion {
                    expression.span.end = end;
                    expression.kind = ExpressionKind::Other;
                    let mut at = (annotation as usize).saturating_sub(2);
                    while at > start && !self.text[at..].starts_with(b"as") {
                        at -= 1;
                    }
                    self.index = at;
                }
            }
            let mut context = None;
            if self.eat(b"as") {
                self.require_whitespace()?;
                context = Some(self.read_pattern()?);
            } else {
                // `{#each Array.from({ length: 10 }), i}` has been read as a sequence.
                self.index = expression.span.end as usize;
            }
            self.allow_whitespace();
            let mut index = None;
            if self.eat(b",") {
                self.allow_whitespace();
                let name = self.read_identifier()?;
                if name.end == name.start {
                    return fail("expected_identifier", self.index);
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
                return fail("expected_identifier", self.index);
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
            let last_parameter_end = match self.js.parameters(template, parameters) {
                Ok(end) => end,
                Err(at) => return fail("js_parse_error", at),
            };
            self.allow_whitespace();
            self.expect(b"}")?;
            let body = self.tree.add_fragment();
            let kind = Kind::SnippetBlock {
                expression: name,
                last_parameter_end,
                body,
            };
            return self.add_block(kind, start, body);
        }
        fail("expected_block_type", self.index)
    }

    /// Puts a new fragment in the place of the one that is being filled.
    fn next_fragment(&mut self) -> FragmentId {
        let fragment = self.tree.add_fragment();
        self.fragments.pop();
        self.fragments.push(fragment);
        fragment
    }

    /// `next`. `brace`: where the `{` is.
    fn next(&mut self, brace: usize) -> Result<()> {
        let start = self.index - 1;
        let Some(block) = self.current() else {
            return fail("block_invalid_continuation_placement", start);
        };
        match self.tree[block].kind {
            Kind::IfBlock { alternate, .. } => {
                if !self.eat(b"else") {
                    return fail("expected_token", start);
                }
                if self.eat(b"if") {
                    return fail("block_invalid_elseif", start);
                }
                if alternate.is_some() {
                    return fail("block_duplicate_clause", start);
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
                self.push(child, consequent)
            }
            Kind::EachBlock { fallback, .. } => {
                if !self.eat(b"else") {
                    return fail("expected_token", start);
                }
                if fallback.is_some() {
                    return fail("block_duplicate_clause", start);
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
                    return fail("expected_token", start);
                }
                if (if is_then { then } else { catch }).is_some() {
                    return fail("block_duplicate_clause", start);
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
            _ => fail("block_invalid_continuation_placement", start),
        }
    }

    /// `close`
    fn close(&mut self) -> Result<()> {
        let start = self.index - 1;
        let Some(mut block) = self.current() else {
            return fail("block_unexpected_close", start);
        };
        let name: &[u8] = match self.tree[block].kind {
            Kind::IfBlock { .. } => b"if",
            Kind::EachBlock { .. } => b"each",
            Kind::KeyBlock { .. } => b"key",
            Kind::AwaitBlock { .. } => b"await",
            Kind::SnippetBlock { .. } => b"snippet",
            _ => return fail("block_unexpected_close", start),
        };
        self.expect(name)?;
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
            self.stack.pop();
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
                // Names with commas in between: nothing else is allowed, but for comments.
                let span = self.read_whole_expression()?.expression.span;
                let (after, end) = (self.index, span.end as usize);
                self.index = span.start as usize;
                loop {
                    self.allow_whitespace_and_comments();
                    let name = self.read_identifier()?;
                    if name.end == name.start {
                        return fail("debug_tag_invalid_arguments", self.index);
                    }
                    identifiers.push(name);
                    self.allow_whitespace_and_comments();
                    if self.index >= end || !self.eat(b",") {
                        break;
                    }
                }
                if self.index < end {
                    return fail("debug_tag_invalid_arguments", self.index);
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
                return fail("const_tag_invalid_expression", init.span.start as usize);
            }
            self.allow_whitespace();
            self.expect(b"}")?;
            Kind::ConstTag(Span::new(id.span.start as usize, declarator_end))
        } else if self.eat(b"render") {
            self.require_whitespace()?;
            let expression = self.read_expression()?;
            if expression.kind != ExpressionKind::Call {
                return fail(
                    "render_tag_invalid_expression",
                    expression.span.start as usize,
                );
            }
            self.allow_whitespace();
            self.expect(b"}")?;
            Kind::RenderTag(expression)
        } else {
            return fail("expected_tag", self.index);
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
                    true => "element_unclosed",
                    false => "block_unclosed",
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

    /// `get_static_value`: a text, or what a literal is written as. `Ok(None)`: `true`. `Err`: `null`.
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
            Kind::Text { .. } => Ok(Some(self.written(chunk))),
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

    /// The text that `value` starts with.
    fn text_of_first_part(&self, value: &Value) -> Option<&'a [u8]> {
        match value {
            Value::Parts(parts) => (parts.first().copied())
                .filter(|&it| matches!(self.tree[it].kind, Kind::Text { .. }))
                .map(|it| self.written(it)),
            _ => None,
        }
    }

    /// `get_boolean_value`: whether there is one.
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

    /// `read_options`, `disallow_children`. What is in the object of `customElement` is not looked at.
    fn check_options(&self, options: Id) -> Result<()> {
        let Some(element) = self.element(options) else {
            return Ok(());
        };
        for &attribute in &element.attributes {
            let at = self.tree[attribute].start as usize;
            let Kind::Attribute { name, value } = &self.tree[attribute].kind else {
                return fail("svelte_options_invalid_attribute", at);
            };
            match *name {
                b"runes" | b"immutable" | b"preserveWhitespace" | b"accessors" => {
                    if !self.has_boolean_value(value) {
                        return fail("svelte_options_invalid_attribute_value", at);
                    }
                }
                b"tag" => return fail("svelte_options_deprecated_tag", at),
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
                        return fail("svelte_options_invalid_customelement", at);
                    }
                    // `validate_tag`
                    if let Some(tag) = self.text_of_first_part(value).filter(|it| !it.is_empty()) {
                        if !is_valid_custom_element_name(tag) {
                            return fail("svelte_options_invalid_tagname", at);
                        }
                        if RESERVED_TAG_NAMES.contains(&tag) {
                            return fail("svelte_options_reserved_tagname", at);
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
                        return fail("svelte_options_invalid_attribute_value", at);
                    }
                }
                b"css" => {
                    if !matches!(self.static_value(value), Ok(Some(b"injected"))) {
                        return fail("svelte_options_invalid_attribute_value", at);
                    }
                }
                _ => return fail("svelte_options_unknown_attribute", at),
            }
        }
        match self.tree.fragment(element.fragment).first() {
            Some(&first) => fail(
                "svelte_meta_invalid_content",
                self.tree[first].start as usize,
            ),
            None => Ok(()),
        }
    }
}

/// `regex_lang_attribute`: whether the first `<script>` with a `lang` says `ts`. Not for one with a `>` in an attribute
/// before it.
fn is_typescript(text: &[u8]) -> bool {
    let (mut at, mut has_comment_end) = (0, true);
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
        let Some(attributes) =
            (rest.strip_prefix(b"script")).filter(|it| strings::js_whitespace_len(it) > 0)
        else {
            continue;
        };
        let Some(end) = strings::index_of_char_usize(attributes, b'>') else {
            continue;
        };
        let attributes = &attributes[..end];
        // The last `lang=` that has a value.
        let mut until = attributes.len();
        while let Some(lang) = strings::last_index_of(&attributes[..until], b"lang=") {
            until = lang;
            let value = &attributes[lang + 5..];
            let (quote, value) = match value {
                [quote @ (b'"' | b'\''), rest @ ..] => (Some(*quote), rest),
                _ => (None, value),
            };
            let len = value
                .iter()
                .take_while(|it| !matches!(it, b'"' | b'\'' | b' '))
                .count();
            if len > 0 && quote.is_none_or(|quote| value.get(len) == Some(&quote)) {
                return &value[..len] == b"ts";
            }
        }
    }
    false
}

/// `parse(text, { modern: true })`
pub(crate) fn parse<'a>(text: &'a [u8], js: &mut dyn Js) -> Result<Tree<'a>> {
    let text = strings::trim_js_whitespace_end(text);
    js.start(is_typescript(text));
    let mut tree = Tree::default();
    // The first, which is what `tree.fragment` says.
    let fragment = tree.add_fragment();
    let mut parser = Parser {
        text,
        len: text.len(),
        index: 0,
        is_typescript: is_typescript(text),
        tree,
        stack: Vec::new(),
        fragments: vec![fragment],
        seen_meta_tags: Vec::new(),
        last_auto_closed_tag: None,
        js,
    };
    parser.run()?;
    Ok(parser.tree)
}
