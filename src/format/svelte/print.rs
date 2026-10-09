//! `prettier-plugin-svelte` 4.1: `print/index.ts`, `print/node-helpers.ts`, `print/helpers.ts` and what `embed.ts` does
//! to the tree. The names of its functions are at those that stand for them.

use super::ast::{
    Comment, DirectiveKind, Element, ElementKind, Expression, ExpressionKind, FragmentId, Id, Kind,
    Pattern, Tree, Value,
};
use super::doc::{
    Code, Doc, EMPTY, Js, JsKind, Parser, dedent, group, indent, owned, text, trim_left, trim_right,
};
use super::snip::{self, ATTRIBUTE};
use crate::html::preprocess::slice;
use crate::options::{
    AttributePosition, FormatOptions, HtmlWhitespaceSensitivity, SvelteOptions, SveltePart as Part,
};
use crate::text::{
    has_newline, has_newline_backwards, is_previous_line_empty, skip_newline, skip_spaces, trim,
    trim_end,
};
use bun_core::strings;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;

/// What the plugin cannot print.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Failure {
    /// It throws.
    Thrown,
    /// There is no stack left to go on.
    NestedTooDeeply,
}

const SELF_CLOSING_TAGS: [&[u8]; 14] = [
    b"area", b"base", b"br", b"col", b"embed", b"hr", b"img", b"input", b"link", b"meta", b"param",
    b"source", b"track", b"wbr",
];

const BLOCK_ELEMENTS: [&[u8]; 33] = [
    b"address",
    b"article",
    b"aside",
    b"blockquote",
    b"details",
    b"dialog",
    b"dd",
    b"div",
    b"dl",
    b"dt",
    b"fieldset",
    b"figcaption",
    b"figure",
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
    b"li",
    b"main",
    b"nav",
    b"ol",
    b"p",
    b"pre",
    b"section",
    b"table",
    b"ul",
];

/// `[\t\n\f\r ]`
fn is_collapsible(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' ')
}

/// `isOnlyHtmlCollapseWhitespace`
fn is_only_collapsible(text: &[u8]) -> bool {
    text.iter().all(|&byte| is_collapsible(byte))
}

/// `startsWithLinebreak`
fn starts_with_linebreak(mut text: &[u8], lines: usize) -> bool {
    for _ in 0..lines {
        let blanks = (text.iter()).take_while(|it| matches!(it, b'\t' | 0x0C | b'\r' | b' '));
        match text.get(blanks.count()..) {
            Some([b'\n', rest @ ..]) => text = rest,
            _ => return false,
        }
    }
    true
}

/// `endsWithLinebreak`
fn ends_with_linebreak(mut text: &[u8], lines: usize) -> bool {
    for _ in 0..lines {
        let blanks = (text.iter().rev()).take_while(|it| matches!(it, b'\t' | 0x0C | b'\r' | b' '));
        match &text[..text.len() - blanks.count()] {
            [rest @ .., b'\n'] => text = rest,
            _ => return false,
        }
    }
    true
}

fn starts_with_white_space(text: &[u8]) -> bool {
    text.first().is_some_and(|&it| is_collapsible(it))
}

fn ends_with_white_space(text: &[u8]) -> bool {
    text.last().is_some_and(|&it| is_collapsible(it))
}

/// `printWhitespace`
fn print_whitespace<'a>(text: &[u8]) -> Doc<'a> {
    // `/\n\r?[\t\n\f\r ]*\n\r?/`
    let first = strings::index_of_char_usize(text, b'\n');
    let has_two = first.is_some_and(|first| {
        let rest = &text[first + 1..];
        let blanks = rest.iter().take_while(|&&it| is_collapsible(it)).count();
        strings::contains_char(&rest[..blanks], b'\n')
    });
    match (has_two, first) {
        (true, _) => Doc::List(vec![Doc::Hardline, Doc::Hardline]),
        (false, Some(_)) => Doc::Hardline,
        (false, None) if !text.is_empty() => Doc::Line,
        _ => EMPTY,
    }
}

/// `text.split("\n")`, with `literalline` in between.
fn lines_as_they_are<'a>(text: &Cow<'a, [u8]>) -> Doc<'a> {
    let (mut parts, mut start) = (Vec::new(), 0);
    loop {
        let end = strings::index_of_char_usize(&text[start..], b'\n').map(|at| start + at);
        parts.push(Doc::Text(slice(text, start, end.unwrap_or(text.len()))));
        match end {
            Some(end) => start = end + 1,
            None => return Doc::List(parts),
        }
        parts.push(Doc::Literalline);
    }
}

/// `replaceEndOfLineWith(text, literalline)`
fn replace_end_of_line<'a>(text: &Cow<'a, [u8]>) -> Doc<'a> {
    let mut parts = Vec::new();
    let mut start = 0;
    loop {
        let end = strings::index_of_char_usize(&text[start..], b'\n').map(|at| start + at);
        let line_end = end.unwrap_or(text.len());
        let without_return = line_end - usize::from(text[start..line_end].ends_with(b"\r"));
        if start > 0 {
            parts.push(Doc::Literalline);
        }
        parts.push(Doc::Text(slice(text, start, without_return)));
        match end {
            Some(end) => start = end + 1,
            None => return Doc::List(parts),
        }
    }
}

/// `splitTextToDocs`
fn split_text_to_docs<'a>(text: &Cow<'a, [u8]>) -> Vec<Doc<'a>> {
    let mut docs = Vec::new();
    let mut at = 0;
    while at < text.len() {
        let start = at;
        if is_collapsible(text[at]) {
            while at < text.len() && is_collapsible(text[at]) {
                at += 1;
            }
            docs.push(Doc::Line);
        } else {
            while at < text.len() && !is_collapsible(text[at]) {
                at += 1;
            }
            docs.push(Doc::Text(slice(text, start, at)));
        }
    }
    if starts_with_linebreak(text, 1)
        && let Some(first) = docs.first_mut()
    {
        *first = Doc::Hardline;
    }
    if starts_with_linebreak(text, 2) {
        docs.insert(0, Doc::Hardline);
    }
    if ends_with_linebreak(text, 1)
        && let Some(last) = docs.last_mut()
    {
        *last = Doc::Hardline;
    }
    if ends_with_linebreak(text, 2) {
        docs.push(Doc::Hardline);
    }
    docs
}

/// What is done to the text of a `class`: the blanks after a word become one, those at the end of a line go.
fn with_collapsed_blanks(raw: &[u8], is_last: bool) -> Vec<u8> {
    let is_blank = |byte: u8| matches!(byte, b' ' | b'\t');
    let mut out = Vec::with_capacity(raw.len());
    let mut at = 0;
    while at < raw.len() {
        let byte = raw[at];
        out.push(byte);
        at += 1;
        // `([^ \t\n])(([ \t]+$)|([ \t]+(\r?\n))|[ \t]+)`
        if is_blank(byte) || byte == b'\n' {
            continue;
        }
        let blanks = raw[at..].iter().take_while(|&&it| is_blank(it)).count();
        if blanks == 0 {
            continue;
        }
        match &raw[at + blanks..] {
            [] => out.extend_from_slice(&raw[at..]),
            [b'\n', ..] => out.push(b'\n'),
            [b'\r', b'\n', ..] => out.extend_from_slice(b"\r\n"),
            _ => out.push(b' '),
        }
        at += blanks
            + match &raw[at + blanks..] {
                [b'\n', ..] => 1,
                [b'\r', b'\n', ..] => 2,
                _ => 0,
            };
    }
    // `/([^ \t\n])[ \t]+$/`
    let kept = out.len() - out.iter().rev().take_while(|&&it| is_blank(it)).count();
    if kept < out.len() && kept > 0 && out[kept - 1] != b'\n' {
        out.truncate(kept);
        if !is_last {
            out.push(b' ');
        }
    }
    out
}

/// `preformattedBody`
pub(crate) fn preformatted_body(content: &[u8]) -> Doc<'_> {
    if content.is_empty() {
        return EMPTY;
    }
    let mut body = content;
    // `/^[\t\f\r ]*\n/`, `/\n[\t\f\r ]*$/`
    if starts_with_linebreak(body, 1) {
        body = &body[strings::index_of_char_usize(body, b'\n').map_or(0, |at| at + 1)..];
    }
    if ends_with_linebreak(body, 1) {
        body = &body[..strings::last_index_of_char(body, b'\n').unwrap_or(body.len())];
    }
    // The writer takes a line break at the end of a string for one that it knows of.
    let without = body.len() - body.iter().rev().take_while(|&&it| it == b'\n').count();
    let mut parts = vec![Doc::Literalline, text(&body[..without])];
    parts.extend(body[without..].iter().map(|_| Doc::Literalline));
    parts.push(Doc::Hardline);
    Doc::List(parts)
}

/// A comment that has been taken out of the markup, and whether an empty line follows it.
type LeadingComment = (Id, bool);

/// What a value is the value of.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Owner {
    Attribute,
    /// The attribute `class` of a `RegularElement`.
    ClassOfElement,
    StyleDirective,
}

/// Where a node is.
#[derive(Copy, Clone)]
struct Place {
    /// The fragment that it is in.
    fragment: FragmentId,
    /// The element that the fragment is of.
    element: Option<Id>,
}

pub(crate) struct Printer<'a, 'o> {
    pub(crate) tree: Tree<'a>,
    /// `options.originalText`: the snipped text.
    pub(crate) text: &'a [u8],
    /// What has been snipped.
    pub(crate) contents: &'a [Vec<u8>],
    pub(crate) options: &'o FormatOptions,
    pub(crate) svelte: SvelteOptions,
    /// Prints a pattern: `expandNode` without the type.
    pub(crate) expand: &'o mut dyn FnMut(&[u8]) -> Option<Vec<u8>>,
    ignore_next: bool,
    ignore_range: bool,
    /// How many of the nodes around make `isPreTagContent` true.
    pre_depth: u32,
    /// The same for `isInsideQuotedAttribute`.
    quoted_depth: u32,
    failure: Option<Failure>,
    stack_check: bun_core::StackCheck,
    /// `comments` of the module, the instance and the style sheet.
    comments: [Vec<LeadingComment>; 3],
    /// `comments` of the attributes: those that lead, and those that trail.
    comments_of_attributes: FxHashMap<Id, [Vec<Comment>; 2]>,
}

impl<'a, 'o> Printer<'a, 'o> {
    pub(crate) fn new(
        tree: Tree<'a>,
        (text, contents): (&'a [u8], &'a [Vec<u8>]),
        (options, svelte): (&'o FormatOptions, SvelteOptions),
        expand: &'o mut dyn FnMut(&[u8]) -> Option<Vec<u8>>,
    ) -> Self {
        Printer {
            tree,
            text,
            contents,
            options,
            svelte,
            expand,
            ignore_next: false,
            ignore_range: false,
            pre_depth: 0,
            quoted_depth: 0,
            failure: None,
            stack_check: bun_core::StackCheck::init(),
            comments: Default::default(),
            comments_of_attributes: FxHashMap::default(),
        }
    }

    // ───────────── node-helpers.ts ─────────────

    fn bracket_same_line(&self) -> bool {
        self.options.bracket_same_line.value()
    }

    /// `getUnencodedText`, of a `Text`.
    fn raw(&self, id: Id) -> Option<&Cow<'a, [u8]>> {
        match &self.tree[id].kind {
            Kind::Text { raw } => Some(raw),
            _ => None,
        }
    }

    fn element(&self, id: Id) -> Option<&Element<'a>> {
        match &self.tree[id].kind {
            Kind::Element(element) => Some(element),
            _ => None,
        }
    }

    fn is_empty_text(&self, id: Id) -> bool {
        self.raw(id).is_some_and(|it| is_only_collapsible(it))
    }

    /// Whether `id` is a comment that says `directive`.
    fn is_directive(&self, id: Id, directive: &[u8]) -> bool {
        matches!(self.tree[id].kind, Kind::Comment { data } if trim(data) == directive)
    }

    fn is_ignore_directive(&self, id: Id) -> bool {
        self.is_directive(id, b"prettier-ignore")
    }

    fn is_ignore_start_directive(&self, id: Id) -> bool {
        self.is_directive(id, b"prettier-ignore-start")
    }

    fn is_ignore_end_directive(&self, id: Id) -> bool {
        self.is_directive(id, b"prettier-ignore-end")
    }

    /// A comment that is none of the two that are around what is ignored.
    fn is_plain_comment(&self, id: Id) -> bool {
        matches!(self.tree[id].kind, Kind::Comment { .. })
            && !self.is_ignore_start_directive(id)
            && !self.is_ignore_end_directive(id)
    }

    fn text_starts_with_linebreak(&self, id: Id, lines: usize) -> bool {
        self.raw(id)
            .is_some_and(|it| starts_with_linebreak(it, lines))
    }

    fn text_ends_with_linebreak(&self, id: Id, lines: usize) -> bool {
        self.raw(id)
            .is_some_and(|it| ends_with_linebreak(it, lines))
    }

    fn text_starts_with_white_space(&self, id: Id) -> bool {
        self.raw(id).is_some_and(|it| starts_with_white_space(it))
    }

    fn text_ends_with_white_space(&self, id: Id) -> bool {
        self.raw(id).is_some_and(|it| ends_with_white_space(it))
    }

    fn trim_text_left(&mut self, id: Id) {
        if let Kind::Text { raw } = &mut self.tree[id].kind {
            let blanks = raw.iter().take_while(|&&it| is_collapsible(it)).count();
            *raw = slice(raw, blanks, raw.len());
        }
    }

    fn trim_text_right(&mut self, id: Id) {
        if let Kind::Text { raw } = &mut self.tree[id].kind {
            let blanks = raw
                .iter()
                .rev()
                .take_while(|&&it| is_collapsible(it))
                .count();
            *raw = slice(raw, 0, raw.len() - blanks);
        }
    }

    /// `trimChildren`
    fn trim_children(&mut self, fragment: FragmentId) {
        let children = self.tree.fragment(fragment).to_vec();
        let Some(last) = children.len().checked_sub(1) else {
            return;
        };
        let first_full = children.iter().position(|&it| !self.is_empty_text(it));
        let last_full = children.iter().rposition(|&it| !self.is_empty_text(it));
        for &child in &children[..=first_full.unwrap_or(last)] {
            self.trim_text_left(child);
        }
        for &child in &children[last_full.unwrap_or(0)..] {
            self.trim_text_right(child);
        }
    }

    fn is_block_element(&self, id: Id) -> bool {
        self.element(id).is_some_and(|element| {
            element.kind == ElementKind::RegularElement
                && match self.options.html_whitespace_sensitivity {
                    HtmlWhitespaceSensitivity::Strict => false,
                    HtmlWhitespaceSensitivity::Ignore => true,
                    HtmlWhitespaceSensitivity::Css => BLOCK_ELEMENTS.contains(&element.name),
                }
        })
    }

    /// `isInlineElement`, where `isPreTagContent` is what it is here.
    fn is_inline_element(&self, id: Id) -> bool {
        (self.element(id)).is_some_and(|it| it.kind == ElementKind::RegularElement)
            && !self.is_block_element(id)
            && self.pre_depth == 0
    }

    /// `getAttributeTextValue`
    fn attribute_text_value(&self, attributes: &[Id], name: &[u8]) -> Option<&Cow<'a, [u8]>> {
        let value = attributes
            .iter()
            .find_map(|&it| match &self.tree[it].kind {
                Kind::Attribute { name: its, value } if *its == name => Some(value),
                Kind::Directive { name: its, .. } | Kind::StyleDirective { name: its, .. }
                    if *its == name =>
                {
                    Some(&Value::True)
                }
                _ => None,
            })?;
        match value {
            Value::True | Value::Tag(_) => None,
            Value::Parts(parts) => parts.iter().find_map(|&it| self.raw(it)),
        }
    }

    /// `getLangAttribute`
    fn lang(&self, attributes: &[Id]) -> Option<&[u8]> {
        let value = (self
            .attribute_text_value(attributes, b"lang")
            .filter(|it| !it.is_empty()))
        .or_else(|| self.attribute_text_value(attributes, b"type"))?;
        Some(value.strip_prefix(b"text/").unwrap_or(&value[..]))
    }

    /// `isNodeSupportedLanguage`
    fn is_supported_language(&self, attributes: &[Id]) -> bool {
        !matches!(
            self.lang(attributes),
            Some(b"coffee" | b"coffeescript" | b"styl" | b"stylus" | b"sass")
        )
    }

    /// `isLoneMustacheTag`: the tag.
    fn lone_mustache_tag(&self, value: &Value) -> Option<Id> {
        match value {
            Value::True => None,
            Value::Tag(tag) => Some(*tag),
            Value::Parts(parts) => match parts[..] {
                [only] if matches!(self.tree[only].kind, Kind::ExpressionTag(_)) => Some(only),
                _ => None,
            },
        }
    }

    /// Whether `expression` is the name `name`.
    fn is_name(&self, expression: Expression, name: &[u8]) -> bool {
        expression.kind == ExpressionKind::Identifier && expression.span.of(self.text) == name
    }

    /// `isOrCanBeConvertedToShorthand`
    fn can_be_shorthand(&self, name: &[u8], value: &Value) -> bool {
        self.lone_mustache_tag(value).is_some_and(
            |tag| matches!(self.tree[tag].kind, Kind::ExpressionTag(it) if self.is_name(it, name)),
        )
    }

    /// `shouldHugStart`, `shouldHugEnd`
    fn should_hug(&self, id: Id, is_supported_language: bool, is_start: bool) -> bool {
        let Some(element) = self.element(id) else {
            return false;
        };
        if !is_supported_language {
            return true;
        }
        if element.kind == ElementKind::SvelteBoundary || self.is_block_element(id) {
            return false;
        }
        let children = self.tree.fragment(element.fragment);
        let child = match is_start {
            true => children.first(),
            false => children.last(),
        };
        let Some(&child) = child else {
            return true;
        };
        if self.options.html_whitespace_sensitivity == HtmlWhitespaceSensitivity::Ignore {
            return false;
        }
        match is_start {
            true => !self.text_starts_with_white_space(child),
            false => !self.text_ends_with_white_space(child),
        }
    }

    /// `checkWhitespaceAtStartOfSvelteBlock`: 0 for none, 1 for a space, 2 for a line.
    fn white_space_at_start_of_block(&self, fragment: FragmentId) -> u8 {
        let Some(&first) = self.tree.fragment(fragment).first() else {
            return 0;
        };
        if self.text_starts_with_linebreak(first, 1) {
            return 2;
        }
        if self.text_starts_with_white_space(first) {
            return 1;
        }
        let start = self.tree[first].start as usize;
        let until = (start + 1).min(self.text.len());
        if let Some(opening_end) = strings::last_index_of_char(&self.text[..until], b'}')
            && opening_end > 0
            && start > opening_end + 1
        {
            let between = &self.text[opening_end + 1..start];
            if is_only_collapsible(between) {
                return 1 + u8::from(starts_with_linebreak(between, 1));
            }
        }
        0
    }

    /// `checkWhitespaceAtEndOfSvelteBlock`
    fn white_space_at_end_of_block(&self, fragment: FragmentId) -> u8 {
        let Some(&last) = self.tree.fragment(fragment).last() else {
            return 0;
        };
        if self.text_ends_with_linebreak(last, 1) {
            return 2;
        }
        if self.text_ends_with_white_space(last) {
            return 1;
        }
        let end = (self.tree[last].end as usize).min(self.text.len());
        if let Some(found) = strings::index_of_char_usize(&self.text[end..], b'{')
            && found > 0
        {
            let between = &self.text[end..end + found];
            if is_only_collapsible(between) {
                return 1 + u8::from(ends_with_linebreak(between, 1));
            }
        }
        0
    }

    /// `canOmitSoftlineBeforeClosingTag`
    fn can_omit_softline_before_closing_tag(&self, id: Id, place: Place) -> bool {
        if !self.bracket_same_line() {
            return false;
        }
        // `hugsStartOfNextNode`
        let hugs_next =
            (self.text.get(self.tree[id].end as usize)).is_some_and(|&next| !is_collapsible(next));
        // `isLastChildWithinParentBlockElement`
        let is_last_in_block = place.element.is_some_and(|it| self.is_block_element(it))
            && (self.tree.fragment(place.fragment).iter().rev())
                .find(|&&it| !self.is_empty_text(it))
                == Some(&id);
        !hugs_next || is_last_in_block
    }

    /// The sibling that ends where `id` starts.
    fn previous_sibling(&self, siblings: &[Id], start: u32) -> Option<usize> {
        let at = siblings.partition_point(|&it| self.tree[it].end < start);
        (siblings.get(at))
            .filter(|&&it| self.tree[it].end == start)
            .map(|_| at)
    }

    /// `getLeadingComment`
    fn leading_comment(&self, id: Id, place: Place) -> Option<Id> {
        let siblings = self.tree.fragment(place.fragment);
        let mut start = self.tree[id].start;
        while let Some(at) = self.previous_sibling(siblings, start) {
            let previous = siblings[at];
            if self.is_plain_comment(previous) {
                return Some(previous);
            }
            if !self.is_empty_text(previous) || self.tree[previous].start >= start {
                return None;
            }
            start = self.tree[previous].start;
        }
        None
    }

    /// `printRaw`
    fn print_raw(&self, fragment: FragmentId, strips_line_breaks: bool) -> &'a [u8] {
        let children = self.tree.fragment(fragment);
        let (Some(&first), Some(&last)) = (children.first(), children.last()) else {
            return b"";
        };
        let (start, end) = (
            self.tree[first].start as usize,
            self.tree[last].end as usize,
        );
        let mut raw = self.text.get(start..end).unwrap_or_default();
        if !strips_line_breaks {
            return raw;
        }
        if starts_with_linebreak(raw, 1) {
            raw = &raw[strings::index_of_char_usize(raw, b'\n').map_or(0, |at| at + 1)..];
        }
        if ends_with_linebreak(raw, 1) {
            raw = &raw[..strings::last_index_of_char(raw, b'\n').unwrap_or(raw.len())];
            raw = raw.strip_suffix(b"\r").unwrap_or(raw);
        }
        raw
    }

    // ───────────── embed.ts ─────────────

    /// `getText(node, options, true)`
    fn js_text(&self, start: u32, end: u32) -> Cow<'a, [u8]> {
        let text = self
            .text
            .get(start as usize..end as usize)
            .unwrap_or_default();
        snip::unsnip(text, self.contents)
    }

    fn js(&self, expression: Expression) -> Js<'a> {
        Js {
            text: self.js_text(expression.from, expression.span.end),
            kind: JsKind::Expression,
            has_single_quotes: false,
            is_on_one_line: false,
            is_without_parentheses: false,
        }
    }

    fn code(js: Js<'a>) -> Doc<'a> {
        Doc::Code(Box::new(Code::Js(js)))
    }

    /// An expression with nothing asked of it.
    fn print_js(&self, expression: Expression) -> Doc<'a> {
        Self::code(self.js(expression))
    }

    /// `printSvelteBlockJS`
    fn print_block_js(&self, expression: Expression) -> Doc<'a> {
        Self::code(Js {
            is_on_one_line: true,
            ..self.js(expression)
        })
    }

    /// `printJsExpression`
    fn print_js_in_braces(&self, expression: Expression) -> Doc<'a> {
        Doc::List(vec![
            Doc::Token("{"),
            self.print_js(expression),
            Doc::Token("}"),
        ])
    }

    /// `expandNode`
    fn expand_node(&mut self, pattern: Option<Pattern>) -> Doc<'a> {
        let Some(pattern) = pattern else {
            return EMPTY;
        };
        let end = match pattern.annotation {
            // The pattern ends before the `:`.
            Some(annotation) => {
                let before = &self.text[pattern.span.start as usize..annotation.start as usize];
                let before = trim_end(before);
                let before = trim_end(before.strip_suffix(b":").unwrap_or(before));
                pattern.span.start as usize + before.len()
            }
            None => pattern.span.end as usize,
        };
        let written = &self.text[pattern.span.start as usize..end.max(pattern.span.start as usize)];
        let Some(mut expanded) = (self.expand)(written) else {
            self.failure = Some(Failure::Thrown);
            return EMPTY;
        };
        if let Some(annotation) = pattern.annotation {
            expanded.extend_from_slice(b": ");
            expanded.extend_from_slice(annotation.of(self.text));
        }
        owned(expanded)
    }

    /// `removeAndGetLeadingComments`
    fn remove_and_get_leading_comments(&mut self, current: Id) -> Vec<LeadingComment> {
        let root = self.tree.fragment;
        let siblings = self.tree.fragment(root).to_vec();
        let (mut comments, mut newlines): (Vec<Id>, Vec<Option<Id>>) = (Vec::new(), Vec::new());
        let mut start = self.tree[current].start;
        while let Some(at) = self.previous_sibling(&siblings, start) {
            let previous = siblings[at];
            if self.is_plain_comment(previous) {
                comments.push(previous);
                if comments.len() != newlines.len() {
                    newlines.push(None);
                }
            } else if self.is_empty_text(previous) {
                newlines.push(Some(previous));
            } else {
                break;
            }
            if self.tree[previous].start >= start {
                break;
            }
            start = self.tree[previous].start;
        }
        newlines.resize(comments.len(), None);
        // `siblings.splice(siblings.indexOf(it), 1)` for each: what is not there has the index -1, and the last goes.
        let nodes = &mut self.tree.fragments[root as usize];
        let mut gone: FxHashSet<Id> = comments.iter().copied().collect();
        let mut tail = nodes.len();
        for text in &newlines {
            if text.is_some_and(|it| gone.insert(it)) {
                continue;
            }
            while tail > 0 {
                tail -= 1;
                if gone.insert(nodes[tail]) {
                    break;
                }
            }
        }
        nodes.retain(|it| !gone.contains(it));
        let mut result: Vec<LeadingComment> = (comments.iter().zip(&newlines))
            .map(|(&comment, text)| {
                let lines = text
                    .and_then(|it| self.raw(it))
                    .map_or(0, |it| strings::count_char(it, b'\n'));
                (comment, lines > 1)
            })
            .collect();
        result.reverse();
        result
    }

    /// `getSnippedContent`
    fn snipped_content(&self, attributes: &[Id]) -> &'a [u8] {
        (self.attribute_text_value(attributes, ATTRIBUTE))
            .and_then(|it| std::str::from_utf8(it).ok()?.parse::<usize>().ok())
            .and_then(|index| self.contents.get(index))
            .map_or(&b""[..], |it| &it[..])
    }

    /// `path.map(printWithPrependedAttributeLine(node, options, print), "attributes")`
    fn print_attributes(&mut self, owner: Id, attributes: &[Id], has_this: bool) -> Vec<Doc<'a>> {
        let line = self.attribute_line(attributes, has_this);
        let mut docs = Vec::with_capacity(attributes.len());
        for &attribute in attributes {
            if matches!(self.tree[attribute].kind, Kind::Attribute { name, .. } if name == ATTRIBUTE)
            {
                continue;
            }
            let printed = self.print_attribute(attribute, owner);
            let printed = self.print_comments(attribute, printed);
            docs.push(Doc::List(vec![line.clone(), printed]));
        }
        docs
    }

    /// `attachAttributeComments`
    fn attach_attribute_comments(&mut self) {
        if self.tree.comments.is_empty() {
            return;
        }
        let comments = std::mem::take(&mut self.tree.comments);
        // Those from `start` on that end at `end` or before.
        let between = |start: u32, end: u32| {
            let from = comments.partition_point(|it| it.span.start < start);
            let count = comments[from..]
                .iter()
                .take_while(|it| it.span.end <= end)
                .count();
            comments[from..from + count].to_vec()
        };
        for id in 0..self.tree.nodes.len() as Id {
            let Some(element) = self.element(id).filter(|_| Some(id) != self.tree.options) else {
                continue;
            };
            let (Some(&first), Some(&last)) =
                (element.attributes.first(), element.attributes.last())
            else {
                continue;
            };
            let mut found = vec![(
                first,
                0,
                between(self.tree[id].start + 2, self.tree[first].start),
            )];
            for (&before, &behind) in element.attributes.iter().zip(&element.attributes[1..]) {
                let comments = between(self.tree[before].end, self.tree[behind].start);
                found.push((behind, 0, comments));
            }
            let last_end = self.tree[last].end;
            let tag_end = (self.text.get(last_end as usize..))
                .and_then(|rest| strings::index_of_char_usize(rest, b'>'))
                .map(|at| last_end + at as u32);
            if let Some(tag_end) = tag_end.filter(|&it| it <= self.tree[id].end) {
                found.push((last, 1, between(last_end, tag_end)));
            }
            for (attribute, which, comments) in found {
                if !comments.is_empty() {
                    self.comments_of_attributes.entry(attribute).or_default()[which]
                        .extend(comments);
                }
            }
        }
    }

    /// The text of a comment: the plugin's `printComment`.
    fn print_js_comment(&self, comment: Comment) -> Doc<'a> {
        let written = comment.span.of(self.text);
        text(match comment.is_block {
            true => written,
            false => written.strip_suffix(b"\r").unwrap_or(written),
        })
    }

    /// Prettier's `printComments`, for an attribute.
    fn print_comments(&mut self, attribute: Id, printed: Doc<'a>) -> Doc<'a> {
        let Some([leading, trailing]) = self.comments_of_attributes.remove(&attribute) else {
            return printed;
        };
        let mut parts = Vec::new();
        // `printLeadingComment`
        for comment in leading {
            let (start, end) = (comment.span.start as usize, comment.span.end as usize);
            parts.push(self.print_js_comment(comment));
            parts.push(match (comment.is_block, has_newline(self.text, end)) {
                (false, _) => Doc::Hardline,
                (true, false) => Doc::Token(" "),
                (true, true) if has_newline_backwards(self.text, start) => Doc::Hardline,
                (true, true) => Doc::Line,
            });
            if has_newline(
                self.text,
                skip_newline(self.text, skip_spaces(self.text, end)),
            ) {
                parts.push(Doc::Hardline);
            }
        }
        parts.push(printed);
        // `printTrailingComment`. Whether the one before has a line suffix, and whether it is a block.
        let mut previous: Option<(bool, bool)> = None;
        for comment in trailing {
            let start = comment.span.start as usize;
            let contents = self.print_js_comment(comment);
            let follows_line_comment = previous == Some((true, false));
            let has_line_suffix = if follows_line_comment || has_newline_backwards(self.text, start)
            {
                let empty_line = match is_previous_line_empty(self.text, start) {
                    true => Doc::Hardline,
                    false => EMPTY,
                };
                let suffix = Doc::List(vec![Doc::Hardline, empty_line, contents]);
                parts.push(Doc::LineSuffix(Box::new(suffix)));
                true
            } else if !comment.is_block || previous.is_some_and(|it| it.0) {
                let suffix = Doc::List(vec![Doc::Token(" "), contents]);
                parts.push(Doc::LineSuffix(Box::new(suffix)));
                if !comment.is_block {
                    parts.push(Doc::BreakParent);
                }
                true
            } else {
                parts.extend([Doc::Token(" "), contents]);
                false
            };
            previous = Some((has_line_suffix, comment.is_block));
        }
        Doc::List(parts)
    }

    /// `getAttributeLine`
    fn attribute_line(&self, attributes: &[Id], has_this: bool) -> Doc<'a> {
        let count = (attributes.iter())
            .filter(|&&it| !matches!(self.tree[it].kind, Kind::Attribute { name, .. } if name == ATTRIBUTE))
            .count();
        let is_one_per_line = self.options.attribute_position == AttributePosition::Multiline;
        match is_one_per_line && (count > 1 || (count > 0 && has_this)) {
            true => Doc::Hardline,
            false => Doc::Line,
        }
    }

    /// `embedTag`. `comments`: `previousComments`.
    fn embed_tag(
        &mut self,
        (id, tag): (Id, &'static str),
        attributes: &[Id],
        content: &'a [u8],
        comments: &[LeadingComment],
        is_top_level: bool,
    ) -> Doc<'a> {
        let lang = self.lang(attributes).unwrap_or_default();
        let parser = match tag {
            "script" if matches!(lang, b"typescript" | b"ts") => Some(Parser::TypeScript),
            "script" if lang.ends_with(b"json") || lang.ends_with(b"importmap") => {
                Some(Parser::Json)
            }
            "script" => Some(Parser::BabelTs),
            "style" if lang == b"less" => Some(Parser::Less),
            "style" if matches!(lang, b"sass" | b"scss") => Some(Parser::Scss),
            "style" => Some(Parser::Css),
            // There is no plugin for Pug.
            _ => None,
        };
        let is_ignored = comments
            .last()
            .is_some_and(|it| self.is_ignore_directive(it.0));
        let body = match parser.filter(|_| self.is_supported_language(attributes) && !is_ignored) {
            Some(parser) if !trim(content).is_empty() => {
                Doc::Code(Box::new(Code::Body { content, parser }))
            }
            Some(_) if content.is_empty() => EMPTY,
            Some(_) => Doc::Hardline,
            None => preformatted_body(content),
        };
        // This is printed before anything else is: nothing is ignored yet.
        let ignored = (
            std::mem::take(&mut self.ignore_next),
            std::mem::take(&mut self.ignore_range),
        );
        let mut in_tag = self.print_attributes(id, attributes, false);
        (self.ignore_next, self.ignore_range) = ignored;
        if !self.bracket_same_line() {
            in_tag.push(dedent(Doc::Softline));
        }
        let opening_tag = group(vec![
            Doc::Token("<"),
            Doc::Token(tag),
            indent(vec![group(in_tag)]),
            Doc::Token(">"),
        ]);
        let result = group(vec![
            opening_tag,
            body,
            Doc::Token("</"),
            Doc::Token(tag),
            Doc::Token(">"),
        ]);
        if !is_top_level {
            return result;
        }
        let mut parts = Vec::new();
        for &(comment, has_empty_line_after) in comments {
            if let Kind::Comment { data } = self.tree[comment].kind {
                parts.extend([
                    Doc::Token("<!--"),
                    text(data),
                    Doc::Token("-->"),
                    Doc::Hardline,
                ]);
            }
            if has_empty_line_after {
                parts.push(Doc::Hardline);
            }
        }
        parts.push(result);
        if self.svelte.sort_order.is_some() {
            parts.push(Doc::Hardline);
        }
        Doc::List(parts)
    }

    /// What `embed` returns for a script or a style sheet of the root.
    fn embed_top_level(&mut self, id: Id, which: usize) -> Doc<'a> {
        let (tag, attributes) = match &self.tree[id].kind {
            Kind::Script { attributes, .. } => ("script", attributes.clone()),
            Kind::StyleSheet { attributes } => ("style", attributes.clone()),
            _ => return EMPTY,
        };
        let content = self.snipped_content(&attributes);
        let comments = std::mem::take(&mut self.comments[which]);
        self.embed_tag((id, tag), &attributes, content, &comments, true)
    }

    /// What `embed` returns for an element, if it is one that it has something for.
    fn embed_element(&mut self, id: Id, place: Place) -> Option<Doc<'a>> {
        let element = self.element(id)?;
        if element.kind != ElementKind::RegularElement
            || !matches!(element.name, b"script" | b"style" | b"template")
        {
            return None;
        }
        let (attributes, fragment) = (element.attributes.clone(), element.fragment);
        let tag = match element.name {
            b"script" => "script",
            b"style" => "style",
            b"template" if self.lang(&attributes) == Some(&b"pug"[..]) => "template",
            _ => return None,
        };
        let content = match tag {
            "template" => self.print_raw(fragment, false),
            _ => self.snipped_content(&attributes),
        };
        let comments: Vec<LeadingComment> = (self
            .leading_comment(id, place)
            .map(|it| (it, false))
            .into_iter())
        .collect();
        Some(self.embed_tag((id, tag), &attributes, content, &comments, false))
    }

    // ───────────── print/index.ts ─────────────

    /// What is printed in the place of a node that is ignored.
    fn print_ignored(&mut self, id: Id) -> Option<Doc<'a>> {
        let is_ignored =
            self.ignore_next || (self.ignore_range && !self.is_ignore_end_directive(id));
        if !is_ignored || self.is_empty_text(id) {
            return None;
        }
        self.ignore_next = false;
        let (start, end) = (self.tree[id].start as usize, self.tree[id].end as usize);
        // The plugin prints the text that it has parsed: what is in a `<script>` or a `<style>` in it is lost, but for its
        // Base64. Here it is put back.
        let written = self.text.get(start..end).unwrap_or_default();
        Some(lines_as_they_are(&snip::unsnip(written, self.contents)))
    }

    /// `printComment`
    fn print_comment(&self, id: Id) -> Doc<'a> {
        let Kind::Comment { data } = self.tree[id].kind else {
            return EMPTY;
        };
        group(vec![
            Doc::Token("<!--"),
            Doc::Text(snip::unsnip(data, self.contents)),
            Doc::Token("-->"),
        ])
    }

    /// `["|", join("|", node.modifiers)]`
    fn print_modifiers(modifiers: &[&'a [u8]]) -> Doc<'a> {
        let mut parts = Vec::with_capacity(modifiers.len() * 2);
        for modifier in modifiers {
            parts.extend([Doc::Token("|"), text(*modifier)]);
        }
        Doc::List(parts)
    }

    /// `printAttributeNodeValue`
    fn print_attribute_value(&mut self, value: &Value, owner: Owner) -> Doc<'a> {
        let parts = value.parts();
        let mut docs = Vec::with_capacity(parts.len());
        for (index, &part) in parts.iter().enumerate() {
            docs.push(self.print_in_value(part, owner, index + 1 == parts.len()));
        }
        Doc::List(docs)
    }

    /// A `Text` or an `ExpressionTag` in the value of `owner`. `is_last`: it is the last part of it.
    fn print_in_value(&mut self, id: Id, owner: Owner, is_last: bool) -> Doc<'a> {
        if let Some(ignored) = self.print_ignored(id) {
            return ignored;
        }
        match &self.tree[id].kind {
            Kind::Text { raw } if self.pre_depth == 0 => self.print_text(raw),
            Kind::Text { raw } => match owner {
                Owner::ClassOfElement => {
                    replace_end_of_line(&Cow::Owned(with_collapsed_blanks(raw, is_last)))
                }
                Owner::Attribute => replace_end_of_line(raw),
                Owner::StyleDirective => Doc::Text(raw.clone()),
            },
            Kind::ExpressionTag(expression) => Doc::List(vec![
                Doc::Token("{"),
                Self::code(Js {
                    has_single_quotes: self.quoted_depth > 0,
                    ..self.js(*expression)
                }),
                Doc::Token("}"),
            ]),
            _ => EMPTY,
        }
    }

    /// A `Text` that is not in `<pre>` and the like.
    fn print_text(&self, raw: &Cow<'a, [u8]>) -> Doc<'a> {
        match is_only_collapsible(raw) {
            true => print_whitespace(raw),
            false => Doc::Fill(split_text_to_docs(raw)),
        }
    }

    /// `name`, `=` and the value in quotes, or without.
    fn print_name_and_value(
        &mut self,
        prefix: Vec<Doc<'a>>,
        value: &Value,
        owner: Owner,
    ) -> Doc<'a> {
        let has_quotes = self.lone_mustache_tag(value).is_none();
        let is_attribute = owner != Owner::StyleDirective;
        self.pre_depth += u32::from(is_attribute);
        self.quoted_depth += u32::from(has_quotes);
        let printed = self.print_attribute_value(value, owner);
        self.pre_depth -= u32::from(is_attribute);
        self.quoted_depth -= u32::from(has_quotes);
        let mut parts = prefix;
        parts.push(Doc::Token("="));
        match has_quotes {
            true => parts.extend([Doc::Token("\""), printed, Doc::Token("\"")]),
            false => parts.push(printed),
        }
        Doc::List(parts)
    }

    /// What is in the list of attributes of `owner`.
    fn print_attribute(&mut self, id: Id, owner: Id) -> Doc<'a> {
        if let Some(ignored) = self.print_ignored(id) {
            return ignored;
        }
        let allows_shorthand = self.svelte.allows_shorthand;
        // `["=", ...printJsExpression()]`
        let with_value = |printer: &Self, expression: Option<Expression>| match expression {
            Some(it) => Doc::List(vec![Doc::Token("="), printer.print_js_in_braces(it)]),
            None => EMPTY,
        };
        match self.tree[id].kind.clone() {
            Kind::Attribute { name, value } => {
                if self.can_be_shorthand(name, &value) {
                    return Doc::List(match allows_shorthand {
                        true => vec![Doc::Token("{"), text(name), Doc::Token("}")],
                        false => vec![text(name), Doc::Token("={"), text(name), Doc::Token("}")],
                    });
                }
                if value == Value::True {
                    return text(name);
                }
                let is_class_of_element = name == b"class"
                    && (self.element(owner))
                        .is_some_and(|it| it.kind == ElementKind::RegularElement);
                let owner = match is_class_of_element {
                    true => Owner::ClassOfElement,
                    false => Owner::Attribute,
                };
                self.print_name_and_value(vec![text(name)], &value, owner)
            }
            Kind::SpreadAttribute(expression) => Doc::List(vec![
                Doc::Token("{..."),
                self.print_js(expression),
                Doc::Token("}"),
            ]),
            Kind::AttachTag(expression) => Doc::List(vec![
                Doc::Token("{@attach "),
                self.print_js(expression),
                Doc::Token("}"),
            ]),
            Kind::StyleDirective {
                name,
                modifiers,
                value,
            } => {
                let mut prefix = vec![
                    Doc::Token("style:"),
                    text(name),
                    Self::print_modifiers(&modifiers),
                ];
                if self.can_be_shorthand(name, &value) || value == Value::True {
                    if !allows_shorthand {
                        prefix.extend([Doc::Token("={"), text(name), Doc::Token("}")]);
                    }
                    return Doc::List(prefix);
                }
                self.print_name_and_value(prefix, &value, Owner::StyleDirective)
            }
            Kind::Directive {
                kind,
                name,
                modifiers,
                expression,
            } => {
                let is_own_name = expression.is_some_and(|it| self.is_name(it, name));
                let (prefix, has_modifiers, value) = match kind {
                    DirectiveKind::On => ("on:", true, with_value(self, expression)),
                    DirectiveKind::Bind if is_own_name && allows_shorthand => {
                        ("bind:", false, EMPTY)
                    }
                    DirectiveKind::Bind => ("bind:", false, self.print_binding(expression)),
                    DirectiveKind::Class if is_own_name && allows_shorthand => {
                        ("class:", false, EMPTY)
                    }
                    DirectiveKind::Class => ("class:", false, with_value(self, expression)),
                    DirectiveKind::Let if is_own_name => ("let:", false, EMPTY),
                    DirectiveKind::Let => ("let:", false, with_value(self, expression)),
                    DirectiveKind::Transition(true, true) => {
                        ("transition:", true, with_value(self, expression))
                    }
                    DirectiveKind::Transition(true, false) => {
                        ("in:", true, with_value(self, expression))
                    }
                    DirectiveKind::Transition(..) => ("out:", true, with_value(self, expression)),
                    DirectiveKind::Use => ("use:", false, with_value(self, expression)),
                    DirectiveKind::Animate => ("animate:", false, with_value(self, expression)),
                };
                let modifiers = match has_modifiers {
                    true => Self::print_modifiers(&modifiers),
                    false => EMPTY,
                };
                Doc::List(vec![Doc::Token(prefix), text(name), modifiers, value])
            }
            _ => EMPTY,
        }
    }

    /// `=` and the expression of `bind:`, which has `surroundWithSoftline`.
    fn print_binding(&self, expression: Option<Expression>) -> Doc<'a> {
        let Some(expression) = expression else {
            return EMPTY;
        };
        let js = Self::code(Js {
            is_without_parentheses: expression.kind == ExpressionKind::Sequence,
            ..self.js(expression)
        });
        Doc::List(vec![
            Doc::Token("={"),
            group(vec![indent(vec![
                Doc::Softline,
                group(vec![js]),
                dedent(Doc::Softline),
            ])]),
            Doc::Token("}"),
        ])
    }

    /// `printSvelteBlockChildren`
    fn print_block_fragment(&mut self, fragment: FragmentId) -> Doc<'a> {
        let (Some(&first), Some(&last)) = (
            self.tree.fragment(fragment).first(),
            self.tree.fragment(fragment).last(),
        ) else {
            return EMPTY;
        };
        let at_start = self.white_space_at_start_of_block(fragment);
        let at_end = self.white_space_at_end_of_block(fragment);
        let line = |here: u8| match here {
            0 => EMPTY,
            _ if at_start == 2 || at_end == 2 => Doc::Hardline,
            _ => Doc::Line,
        };
        let (start_line, end_line) = (line(at_start), line(at_end));
        self.trim_text_left(first);
        self.trim_text_right(last);
        let place = Place {
            fragment,
            element: None,
        };
        let children = self.print_children(place);
        Doc::List(vec![
            indent(vec![start_line, Doc::Group(Box::new(children))]),
            end_line,
        ])
    }

    /// `printIfBlockAlternate`
    fn print_if_block_alternate(&mut self, alternate: FragmentId, parts: &mut Vec<Doc<'a>>) {
        let mut alternate = Some(alternate);
        while let Some(fragment) = alternate.take() {
            if let [only] = self.tree.fragment(fragment)[..]
                && let Kind::IfBlock {
                    is_else_if: true,
                    test,
                    consequent,
                    alternate: next,
                } = self.tree[only].kind
            {
                parts.extend([
                    Doc::Token("{:else if "),
                    self.print_block_js(test),
                    Doc::Token("}"),
                ]);
                parts.push(self.print_block_fragment(consequent));
                alternate = next;
            } else {
                parts.push(Doc::Token("{:else}"));
                parts.push(self.print_block_fragment(fragment));
            }
        }
    }

    /// `printPre`
    fn print_pre(&mut self, place: Place) -> Doc<'a> {
        let children = self.tree.fragment(place.fragment).to_vec();
        let mut result = Vec::new();
        for child in children {
            if self.raw(child).is_none() {
                result.push(self.print(child, place));
                continue;
            }
            let (start, end) = (
                self.tree[child].start as usize,
                self.tree[child].end as usize,
            );
            let written = self.text.get(start..end).unwrap_or_default();
            for (index, line) in strings::split(written, b"\n").enumerate() {
                if index > 0 {
                    result.push(Doc::Literalline);
                }
                result.push(text(line.strip_suffix(b"\r").unwrap_or(line)));
            }
        }
        Doc::List(result)
    }

    /// `printChildren`
    fn print_children(&mut self, place: Place) -> Doc<'a> {
        let children = self.tree.fragment(place.fragment).to_vec();
        if self.pre_depth > 0 {
            return Doc::List(children.iter().map(|&it| self.print(it, place)).collect());
        }
        // `prepareChildren`
        let prepared: Vec<Id> = (children.into_iter())
            .filter(|&it| self.raw(it).is_none_or(|raw| !raw.is_empty()))
            .collect();
        if prepared.is_empty() {
            return EMPTY;
        }
        let mut docs: Vec<Doc<'a>> = Vec::with_capacity(prepared.len());
        let mut handles_white_space_of_previous_text = false;
        for (index, &child) in prepared.iter().enumerate() {
            let previous = index.checked_sub(1).map(|it| prepared[it]);
            let next = prepared.get(index + 1).copied();
            if self.raw(child).is_some() {
                // `handleTextChild`
                handles_white_space_of_previous_text = false;
                if let (Some(previous), Some(next)) = (previous, next) {
                    if self.text_starts_with_white_space(child) && !self.is_empty_text(child) {
                        let starts_with_linebreak = self.text_starts_with_linebreak(child, 1);
                        if self.is_inline_element(previous) && !starts_with_linebreak {
                            self.trim_text_left(child);
                            if let Some(last) = docs.pop() {
                                docs.push(group(vec![last, Doc::Line]));
                            }
                        }
                        if self.is_block_element(previous) && !starts_with_linebreak {
                            self.trim_text_left(child);
                        }
                    }
                    if self.text_ends_with_white_space(child) {
                        if self.is_inline_element(next) && !self.text_ends_with_linebreak(child, 1)
                        {
                            handles_white_space_of_previous_text = !self.is_block_element(previous);
                            self.trim_text_right(child);
                        }
                        if self.is_block_element(next) && !self.text_ends_with_linebreak(child, 2) {
                            handles_white_space_of_previous_text = !self.is_block_element(previous);
                            self.trim_text_right(child);
                        }
                    }
                }
                docs.push(self.print(child, place));
            } else if self.is_block_element(child) {
                // `handleBlockChild`
                if let Some(previous) = previous
                    && !self.is_block_element(previous)
                    && (self.raw(previous).is_none()
                        || handles_white_space_of_previous_text
                        || !self.text_ends_with_white_space(previous))
                {
                    docs.push(Doc::Softline);
                }
                docs.push(self.print(child, place));
                if let Some(next) = next
                    && (self.raw(next).is_none()
                        || ((!self.is_empty_text(next)
                            || (prepared.get(index + 2))
                                .is_some_and(|&it| self.is_inline_element(it)))
                            && !self.text_starts_with_linebreak(next, 1)))
                {
                    docs.push(Doc::Softline);
                }
                handles_white_space_of_previous_text = false;
            } else if self.is_inline_element(child) {
                // `handleInlineChild`
                let printed = self.print(child, place);
                docs.push(match handles_white_space_of_previous_text {
                    true => group(vec![Doc::Line, printed]),
                    false => printed,
                });
                handles_white_space_of_previous_text = false;
            } else {
                docs.push(self.print(child, place));
                handles_white_space_of_previous_text = false;
            }
        }
        if prepared.len() > 1 && prepared.iter().any(|&it| self.is_block_element(it)) {
            docs.push(Doc::BreakParent);
        }
        Doc::List(docs)
    }

    /// An element that `embed` has nothing for.
    fn print_element(&mut self, id: Id, place: Place) -> Doc<'a> {
        let Some(element) = self.element(id).cloned() else {
            return EMPTY;
        };
        let (name, kind) = (element.name, element.kind);
        let is_pre = kind == ElementKind::RegularElement
            && (name.eq_ignore_ascii_case(b"pre") || name.eq_ignore_ascii_case(b"textarea"));
        self.pre_depth += u32::from(is_pre);
        let printed = self.print_element_in_place(id, &element, place);
        self.pre_depth -= u32::from(is_pre);
        printed
    }

    fn print_element_in_place(&mut self, id: Id, element: &Element<'a>, place: Place) -> Doc<'a> {
        let (name, kind) = (element.name, element.kind);
        let bracket_same_line = self.bracket_same_line();
        let is_pre = self.pre_depth > 0;
        let is_supported_language =
            name != b"template" || self.is_supported_language(&element.attributes);
        let children = self.tree.fragment(element.fragment).to_vec();
        let is_empty = children.iter().all(|&it| self.is_empty_text(it));
        let is_doctype = name.eq_ignore_ascii_case(b"!doctype");
        let did_self_close = (self.tree[id].end as usize)
            .checked_sub(2)
            .and_then(|at| self.text.get(at))
            == Some(&b'/');
        let is_self_closing = is_empty
            && (did_self_close
                || kind == ElementKind::SvelteWindow
                || SELF_CLOSING_TAGS.contains(&name)
                || is_doctype);
        let this = element.this.filter(|_| {
            matches!(
                kind,
                ElementKind::SvelteComponent | ElementKind::SvelteElement
            )
        });
        let attributes = self.print_attributes(id, &element.attributes, this.is_some());
        let mut in_tag = Vec::with_capacity(attributes.len() + 2);
        if let Some(this) = this {
            let line = self.attribute_line(&element.attributes, true);
            let value = match this.kind {
                ExpressionKind::StringLiteral if kind == ElementKind::SvelteElement => {
                    self.print_tag_name(this)
                }
                _ => self.print_js_in_braces(this),
            };
            in_tag.push(Doc::List(vec![line, Doc::Token("this="), value]));
        }
        in_tag.extend(attributes);
        let opening = |last: Doc<'a>, mut in_tag: Vec<Doc<'a>>| {
            in_tag.push(last);
            vec![Doc::Token("<"), text(name), indent(vec![group(in_tag)])]
        };
        if is_self_closing {
            let mut parts = opening(
                match bracket_same_line || is_doctype {
                    true => EMPTY,
                    false => dedent(Doc::Line),
                },
                in_tag,
            );
            parts.push(Doc::Token(
                match (bracket_same_line && !is_doctype, is_doctype) {
                    (true, _) => " />",
                    (false, true) => ">",
                    (false, false) => "/>",
                },
            ));
            return group(parts);
        }
        let (first, last) = (children.first().copied(), children.last().copied());
        let hugs_start = self.should_hug(id, is_supported_language, true);
        let hugs_end = self.should_hug(id, is_supported_language, false);
        let is_inline = self.is_inline_element(id);
        // Asked before the text is trimmed.
        let has_line_in_it =
            is_inline && first.is_some_and(|it| self.text_starts_with_white_space(it));
        let inner = Place {
            fragment: element.fragment,
            element: Some(id),
        };
        let mut parts = opening(
            match (hugs_start && !is_empty) || bracket_same_line || is_pre {
                true => EMPTY,
                false => dedent(Doc::Softline),
            },
            in_tag,
        );
        let closing_tag =
            |end: &'static str| Doc::List(vec![Doc::Token("</"), text(name), Doc::Token(end)]);
        if !is_supported_language && !is_empty {
            parts.extend([
                Doc::Token(">"),
                group(vec![
                    Doc::Hardline,
                    text(self.print_raw(element.fragment, true)),
                    Doc::Hardline,
                ]),
                closing_tag(">"),
            ]);
            return group(parts);
        }
        if hugs_start && hugs_end {
            let body = self.print_body(inner, (is_empty, has_line_in_it));
            let hugged = vec![
                Doc::Softline,
                group(vec![Doc::Token(">"), body, closing_tag("")]),
            ];
            let omits_softline = (is_empty && !bracket_same_line)
                || self.can_omit_softline_before_closing_tag(id, place);
            parts.extend([
                match is_empty {
                    true => group(hugged),
                    false => group(vec![indent(hugged)]),
                },
                match omits_softline {
                    true => EMPTY,
                    false => Doc::Softline,
                },
                Doc::Token(">"),
            ]);
            return group(parts);
        }
        let (mut separator_start, mut separator_end) = (Doc::Softline, Doc::Softline);
        if is_pre {
            (separator_start, separator_end) = (EMPTY, EMPTY);
        } else {
            let mut did_set_end_separator = false;
            if !hugs_start && let Some(first) = first.filter(|&it| self.raw(it).is_some()) {
                if self.text_starts_with_linebreak(first, 1)
                    && Some(first) != last
                    && (!is_inline || last.is_some_and(|it| self.text_ends_with_white_space(it)))
                {
                    (separator_start, separator_end) = (Doc::Hardline, Doc::Hardline);
                    did_set_end_separator = true;
                } else if is_inline {
                    separator_start = Doc::Line;
                }
                self.trim_text_left(first);
            }
            if !hugs_end && let Some(last) = last.filter(|&it| self.raw(it).is_some()) {
                if is_inline && !did_set_end_separator {
                    separator_end = Doc::Line;
                }
                self.trim_text_right(last);
            }
        }
        let body = self.print_body(inner, (is_empty, has_line_in_it));
        if hugs_start {
            parts.extend([
                indent(vec![Doc::Softline, group(vec![Doc::Token(">"), body])]),
                separator_end,
                closing_tag(">"),
            ]);
        } else if hugs_end {
            parts.extend([
                Doc::Token(">"),
                indent(vec![separator_start, group(vec![body, closing_tag("")])]),
                match self.can_omit_softline_before_closing_tag(id, place) {
                    true => EMPTY,
                    false => Doc::Softline,
                },
                Doc::Token(">"),
            ]);
        } else if is_empty {
            parts.extend([Doc::Token(">"), body, closing_tag(">")]);
        } else {
            parts.extend([
                Doc::Token(">"),
                indent(vec![separator_start, body]),
                separator_end,
                closing_tag(">"),
            ]);
        }
        group(parts)
    }

    /// `this=` of `<svelte:element>` with a string.
    fn print_tag_name(&self, tag: Expression) -> Doc<'a> {
        let written = tag.span.of(self.text);
        let is_in_braces = (tag.span.start as usize)
            .checked_sub(1)
            .and_then(|at| self.text.get(at))
            == Some(&b'{');
        // A literal has its quotes, the text of an attribute has not.
        let value = match written {
            [open @ (b'"' | b'\''), inner @ .., close] if open == close => inner,
            _ => written,
        };
        Doc::List(vec![
            Doc::Token(if is_in_braces { "{\"" } else { "\"" }),
            text(value),
            Doc::Token(if is_in_braces { "\"}" } else { "\"" }),
        ])
    }

    /// `body()`
    fn print_body(&mut self, inner: Place, (is_empty, has_line_in_it): (bool, bool)) -> Doc<'a> {
        if is_empty {
            return match (has_line_in_it, self.bracket_same_line()) {
                (true, _) => Doc::Line,
                (false, true) => Doc::Softline,
                (false, false) => EMPTY,
            };
        }
        match self.pre_depth > 0 {
            true => self.print_pre(inner),
            false => self.print_children(inner),
        }
    }

    /// `print`, for what is in a fragment.
    fn print(&mut self, id: Id, place: Place) -> Doc<'a> {
        if !self.stack_check.is_safe_to_recurse() {
            self.failure = Some(Failure::NestedTooDeeply);
            return EMPTY;
        }
        if let Some(embedded) = self.embed_element(id, place) {
            return embedded;
        }
        if let Some(which) = [self.tree.module, self.tree.instance, self.tree.css]
            .iter()
            .position(|&it| it == Some(id))
        {
            return self.embed_top_level(id, which);
        }
        if let Some(ignored) = self.print_ignored(id) {
            return ignored;
        }
        // `["{..", printJS(..), "}"]`
        let tag = |open: &'static str, js: Doc<'a>| {
            Doc::List(vec![Doc::Token(open), js, Doc::Token("}")])
        };
        if let Some(element) = self.element(id) {
            return match element.kind {
                ElementKind::SvelteOptions => group(vec![self.print_options_tag(id)]),
                _ => self.print_element(id, place),
            };
        }
        match self.tree[id].kind.clone() {
            Kind::Text { raw } => match self.pre_depth > 0 {
                true => Doc::Text(raw),
                false => self.print_text(&raw),
            },
            Kind::Comment { .. } => {
                let is_top_level = place.fragment == self.tree.fragment;
                if self.is_ignore_start_directive(id) && is_top_level {
                    self.ignore_range = true;
                } else if self.is_ignore_end_directive(id) && is_top_level {
                    self.ignore_range = false;
                } else if self.is_ignore_directive(id) {
                    self.ignore_next = true;
                }
                self.print_comment(id)
            }
            Kind::ExpressionTag(expression) => tag(
                "{",
                Self::code(Js {
                    has_single_quotes: self.quoted_depth > 0,
                    ..self.js(expression)
                }),
            ),
            Kind::HtmlTag(expression) => tag("{@html ", self.print_js(expression)),
            Kind::RenderTag(expression) => tag("{@render ", self.print_js(expression)),
            Kind::ConstTag(declarator) => tag(
                "{@const ",
                Self::code(Js {
                    text: self.js_text(declarator.start, declarator.end),
                    kind: JsKind::Expression,
                    has_single_quotes: false,
                    is_on_one_line: false,
                    is_without_parentheses: true,
                }),
            ),
            Kind::DeclarationTag(declaration) => tag(
                "{",
                Self::code(Js {
                    text: self.js_text(declaration.start, declaration.end),
                    kind: JsKind::Statement,
                    has_single_quotes: false,
                    is_on_one_line: false,
                    is_without_parentheses: false,
                }),
            ),
            Kind::DebugTag(identifiers) => {
                let mut parts = vec![Doc::Token("{@debug")];
                for (index, identifier) in identifiers.iter().enumerate() {
                    parts.push(Doc::Token(if index == 0 { " " } else { ", " }));
                    parts.push(text(identifier.of(self.text)));
                }
                parts.push(Doc::Token("}"));
                Doc::List(parts)
            }
            Kind::IfBlock {
                test,
                consequent,
                alternate,
                ..
            } => {
                let mut parts = vec![
                    Doc::Token("{#if "),
                    self.print_block_js(test),
                    Doc::Token("}"),
                ];
                parts.push(self.print_block_fragment(consequent));
                if let Some(alternate) = alternate {
                    self.print_if_block_alternate(alternate, &mut parts);
                }
                parts.push(Doc::Token("{/if}"));
                group(vec![Doc::List(parts), Doc::BreakParent])
            }
            Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback,
            } => {
                let mut parts = vec![Doc::Token("{#each "), self.print_block_js(expression)];
                if context.is_some() {
                    parts.extend([Doc::Token(" as"), self.expand_node(context)]);
                }
                if let Some(index) = index {
                    parts.extend([Doc::Token(", "), text(index)]);
                }
                if let Some(key) = key {
                    parts.extend([Doc::Token(" ("), self.print_block_js(key), Doc::Token(")")]);
                }
                parts.push(Doc::Token("}"));
                parts.push(self.print_block_fragment(body));
                if let Some(fallback) = fallback {
                    parts.push(Doc::Token("{:else}"));
                    parts.push(self.print_block_fragment(fallback));
                }
                parts.push(Doc::Token("{/each}"));
                group(vec![Doc::List(parts), Doc::BreakParent])
            }
            Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            } => {
                let full = |printer: &Self, fragment: Option<FragmentId>| {
                    fragment.filter(|&it| {
                        printer
                            .tree
                            .fragment(it)
                            .iter()
                            .any(|&it| !printer.is_empty_text(it))
                    })
                };
                let (pending, then, catch) =
                    (full(self, pending), full(self, then), full(self, catch));
                let mut block = Vec::new();
                let head = vec![Doc::Token("{#await "), self.print_block_js(expression)];
                let clause = |mut head: Vec<Doc<'a>>, word: &'static str, pattern: Doc<'a>| {
                    head.extend([Doc::Token(word), pattern, Doc::Token("}")]);
                    group(head)
                };
                match (pending, then, catch) {
                    (None, Some(then), _) => {
                        let pattern = self.expand_node(value);
                        block.push(clause(head, " then", pattern));
                        block.push(self.print_block_fragment(then));
                    }
                    (None, None, Some(catch)) => {
                        let pattern = self.expand_node(error);
                        block.push(clause(head, " catch", pattern));
                        block.push(self.print_block_fragment(catch));
                    }
                    _ => {
                        block.push(clause(head, "", EMPTY));
                        if let Some(pending) = pending {
                            block.push(self.print_block_fragment(pending));
                        }
                        if let Some(then) = then {
                            let pattern = self.expand_node(value);
                            block.push(clause(Vec::new(), "{:then", pattern));
                            block.push(self.print_block_fragment(then));
                        }
                    }
                }
                if let Some(catch) = catch.filter(|_| pending.is_some() || then.is_some()) {
                    let pattern = self.expand_node(error);
                    block.push(clause(Vec::new(), "{:catch", pattern));
                    block.push(self.print_block_fragment(catch));
                }
                block.push(Doc::Token("{/await}"));
                group(block)
            }
            Kind::KeyBlock {
                expression,
                fragment,
            } => {
                let parts = vec![
                    Doc::Token("{#key "),
                    self.print_block_js(expression),
                    Doc::Token("}"),
                    self.print_block_fragment(fragment),
                    Doc::Token("{/key}"),
                ];
                group(vec![Doc::List(parts), Doc::BreakParent])
            }
            Kind::SnippetBlock {
                expression,
                last_parameter_end,
                body,
            } => {
                let from = last_parameter_end.unwrap_or(expression.end) as usize;
                let end = (self.text.get(from..))
                    .and_then(|rest| strings::index_of_char_usize(rest, b')'))
                    .map_or(0, |at| from + at + 1);
                let head = Self::code(Js {
                    text: self.js_text(expression.start, (end as u32).max(expression.start)),
                    kind: JsKind::Function,
                    has_single_quotes: false,
                    is_on_one_line: false,
                    is_without_parentheses: false,
                });
                Doc::List(vec![
                    Doc::Token("{#snippet "),
                    head,
                    Doc::Token("}"),
                    self.print_block_fragment(body),
                    Doc::Token("{/snippet}"),
                ])
            }
            _ => EMPTY,
        }
    }

    // ───────────── the root ─────────────

    /// `<svelte:options>`
    fn print_options_tag(&mut self, id: Id) -> Doc<'a> {
        let attributes = (self.element(id).map(|it| it.attributes.clone())).unwrap_or_default();
        let mut in_tag = self.print_attributes(id, &attributes, false);
        let bracket_same_line = self.bracket_same_line();
        if !bracket_same_line {
            in_tag.push(dedent(Doc::Line));
        }
        Doc::List(vec![
            Doc::Token("<svelte:options"),
            indent(vec![group(in_tag)]),
            Doc::Token(if bracket_same_line { " />" } else { "/>" }),
        ])
    }

    /// The case `"Fragment"` of `print`.
    fn print_root_fragment(&mut self) -> Doc<'a> {
        let fragment = self.tree.fragment;
        if self
            .tree
            .fragment(fragment)
            .iter()
            .all(|&it| self.is_empty_text(it))
        {
            return EMPTY;
        }
        self.trim_children(fragment);
        let place = Place {
            fragment,
            element: None,
        };
        let mut output = vec![self.print_children(place)];
        trim_left(&mut output, Doc::is_white_space_of_fragment);
        trim_right(&mut output, Doc::is_white_space_of_fragment);
        if output.iter().all(Doc::is_empty) {
            return EMPTY;
        }
        output.push(Doc::Hardline);
        group(output)
    }

    /// `mergeAdjacentTextNodesInFragment`
    fn merge_adjacent_texts(&mut self) {
        let root = self.tree.fragment as usize;
        let nodes = std::mem::take(&mut self.tree.fragments[root]);
        let mut merged: Vec<Id> = Vec::with_capacity(nodes.len());
        for node in nodes {
            let Some(next) = self.raw(node).cloned() else {
                merged.push(node);
                continue;
            };
            match merged.last().copied().filter(|&it| self.raw(it).is_some()) {
                Some(current) => {
                    self.trim_text_right(current);
                    self.tree[current].end = self.tree[node].end;
                    if let Kind::Text { raw } = &mut self.tree[current].kind {
                        match raw.is_empty() {
                            true => *raw = next,
                            false => raw.to_mut().extend_from_slice(&next),
                        }
                    }
                }
                None => merged.push(node),
            }
        }
        self.tree.fragments[root] = merged;
    }

    /// `extractRegionEndTrailAfterHoistedEnd`: the white space and the comment.
    fn extract_region_end_trail(&mut self, hoisted_end: u32) -> Option<(Option<Id>, Id)> {
        let root = self.tree.fragment;
        let nodes = self.tree.fragment(root);
        let index = nodes
            .iter()
            .position(|&it| self.tree[it].start >= hoisted_end)?;
        let mut white_space = None;
        for at in index..(index + 2).min(nodes.len()) {
            let child = nodes[at];
            if self.is_empty_text(child) {
                white_space = Some(child);
                continue;
            }
            let Kind::Comment { data } = self.tree[child].kind else {
                return None;
            };
            if !says_end_of_region(data) {
                return None;
            }
            self.tree.fragments[root as usize].drain(index..=at);
            return Some((white_space, child));
        }
        None
    }

    /// `doc`, with `printRegionEndTrailDoc(trail)` behind it.
    fn with_region_end_trail(&self, doc: Doc<'a>, trail: Option<(Option<Id>, Id)>) -> Doc<'a> {
        let Some((white_space, comment)) = trail else {
            return doc;
        };
        let mut pieces = Vec::new();
        if let Some(raw) = white_space.and_then(|it| self.raw(it)) {
            let raw = (raw
                .strip_prefix(b"\r\n")
                .or_else(|| raw.strip_prefix(b"\n")))
            .unwrap_or(&raw[..]);
            pieces.push(print_whitespace(raw));
        }
        pieces.push(self.print_comment(comment));
        pieces.push(Doc::Hardline);
        group(vec![doc, group(pieces)])
    }

    /// `stripSvelteOptionsComment`
    fn strip_options_comment(&mut self, options: Id) -> Option<Doc<'a>> {
        let (root, start) = (self.tree.fragment, self.tree[options].start);
        let nodes = self.tree.fragment(root);
        for (index, &node) in nodes.iter().enumerate() {
            if !self.is_plain_comment(node) {
                continue;
            }
            let count = if self.tree[node].end == start {
                1
            } else if (nodes.get(index + 1))
                .is_some_and(|&next| self.is_empty_text(next) && self.tree[next].end == start)
            {
                2
            } else {
                continue;
            };
            let printed = self.print_comment(node);
            self.tree.fragments[root as usize].drain(index..index + count);
            return Some(printed);
        }
        None
    }

    /// Puts the scripts, the style sheet and the options back where they were: `svelteSortOrder: "none"`.
    fn put_top_level_parts_back(&mut self) {
        let root = self.tree.fragment as usize;
        let mut children = std::mem::take(&mut self.tree.fragments[root]);
        if let Some(options) = self.tree.options {
            children.push(options);
            crate::sort::sort_by_key(&mut children, |&it| self.tree[it].start);
        }
        let mut parts: Vec<Id> = [self.tree.module, self.tree.instance, self.tree.css]
            .into_iter()
            .flatten()
            .collect();
        // Those that have been put in by their ends can still be found by their starts.
        let by_start = parts.clone();
        let mut index = 0;
        while index < children.len() {
            let (start, end) = (
                self.tree[children[index]].start,
                self.tree[children[index]].end,
            );
            if let Some(at) = parts.iter().rposition(|&it| self.tree[it].end == start) {
                children.insert(index, parts.remove(at));
            } else if index == children.len() - 1
                && let Some(&part) = by_start.iter().rfind(|&&it| self.tree[it].start == end)
                && children.len() < 1 << 20
            {
                children.push(part);
            }
            index += 1;
        }
        // So far the plugin, which loses a part that nothing is next to, as in a component that is one script, and can have
        // one twice. Each is there once.
        for part in by_start {
            if children.iter().filter(|&&it| it == part).count() != 1 {
                children.retain(|&it| it != part);
                let start = self.tree[part].start;
                let at = children.partition_point(|&it| self.tree[it].start < start);
                children.insert(at, part);
                // With the white space that was before it, which went when it was the end of the markup.
                let before = at.checked_sub(1).map(|it| self.tree[children[it]].end);
                if let Some(from) = before.filter(|&it| it < start) {
                    let (raw, to) = (Cow::Borrowed(&b"\n"[..]), start as usize);
                    let blank = self.tree.add(Kind::Text { raw }, from as usize, to);
                    children.insert(at, blank);
                }
            }
        }
        self.tree.fragments[root] = children;
    }

    /// `printTopLevelParts`, after what `embed` does to the root.
    pub(crate) fn print_root(mut self) -> Result<Doc<'a>, Failure> {
        self.attach_attribute_comments();
        // `assignCommentsToNodes`
        let hoisted = [self.tree.module, self.tree.instance, self.tree.css];
        for (which, part) in hoisted.into_iter().enumerate() {
            if let Some(part) = part {
                self.comments[which] = self.remove_and_get_leading_comments(part);
            }
        }
        let has_pragma = has_pragma(self.text);
        let with_pragma =
            |doc: Doc<'a>| Doc::List(vec![Doc::Token("<!-- @format -->"), Doc::Hardline, doc]);
        let Some(order) = self.svelte.sort_order else {
            self.put_top_level_parts_back();
            self.merge_adjacent_texts();
            let result = self.print_root_fragment();
            return match (self.failure, self.options.insert_pragma && !has_pragma) {
                (Some(failure), _) => Err(failure),
                (None, true) => Ok(with_pragma(result)),
                (None, false) => Ok(result),
            };
        };
        // `hoistedEndsDescending`
        let mut ends: Vec<(usize, u32)> =
            (hoisted.into_iter().chain([self.tree.options]).enumerate())
                .filter_map(|(which, part)| Some((which, self.tree[part?].end)))
                .collect();
        // Of two that end at the same place the options are first, then the module, the instance, the style sheet.
        crate::sort::sort_by_key(&mut ends, |&(which, end)| {
            (std::cmp::Reverse(end), (which + 1) % 4)
        });
        let mut trails = [None; 4];
        for (which, end) in ends {
            trails[which] = self.extract_region_end_trail(end);
        }
        let (mut scripts, mut styles, mut options, mut markup) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for (which, part) in hoisted.into_iter().enumerate() {
            if let Some(part) = part {
                let doc = self.embed_top_level(part, which);
                let doc = self.with_region_end_trail(doc, trails[which]);
                match which {
                    2 => styles.push(doc),
                    _ => scripts.push(doc),
                }
            }
        }
        if let Some(id) = self.tree.options {
            let comment = self.strip_options_comment(id);
            let mut doc = group(vec![self.print_options_tag(id), Doc::Hardline]);
            if let Some(comment) = comment {
                doc = group(vec![comment, Doc::Hardline, doc]);
            }
            options.push(self.with_region_end_trail(doc, trails[3]));
        }
        self.merge_adjacent_texts();
        let html = self.print_root_fragment();
        if !matches!(html, Doc::Token("")) {
            markup.push(html);
        }
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        let mut docs = Vec::new();
        for part in order {
            docs.append(match part {
                Part::Options => &mut options,
                Part::Scripts => &mut scripts,
                Part::Markup => &mut markup,
                Part::Styles => &mut styles,
            });
        }
        if self.options.is_in_markdown
            && let Some(last) = docs.pop()
        {
            let mut last = vec![last];
            trim_right(&mut last, Doc::is_line);
            docs.append(&mut last);
        }
        if self.options.insert_pragma && !has_pragma {
            return Ok(with_pragma(group(docs)));
        }
        let mut joined = Vec::with_capacity(docs.len() * 2);
        for (index, doc) in docs.into_iter().enumerate() {
            if index > 0 {
                joined.push(Doc::Hardline);
            }
            joined.push(doc);
        }
        Ok(group(joined))
    }
}

/// `/#\s*endregion\b/i.test(data)`
fn says_end_of_region(data: &[u8]) -> bool {
    let mut rest = data;
    while let Some(at) = strings::index_of_char_usize(rest, b'#') {
        rest = &rest[at + 1..];
        let word = crate::text::trim_start(rest);
        if word
            .get(..9)
            .is_some_and(|it| it.eq_ignore_ascii_case(b"endregion"))
            && word
                .get(9)
                .is_none_or(|&it| !crate::text::is_word_character(it))
        {
            return true;
        }
    }
    false
}

/// `hasPragma`: `/^\s*<!--\s*@(format|prettier)\W/`
pub(crate) fn has_pragma(text: &[u8]) -> bool {
    let Some(comment) = crate::text::trim_start(text).strip_prefix(b"<!--") else {
        return false;
    };
    let Some(word) = crate::text::trim_start(comment).strip_prefix(b"@") else {
        return false;
    };
    (word
        .strip_prefix(b"format")
        .or_else(|| word.strip_prefix(b"prettier")))
    .and_then(|rest| rest.first())
    .is_some_and(|&it| !crate::text::is_word_character(it))
}
