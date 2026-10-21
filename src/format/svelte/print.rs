//! `prettier-plugin-svelte` 4.1: `print/index.ts`, `print/node-helpers.ts`, `print/helpers.ts` and the changes that
//! `embed.ts` makes to the tree. Each function's doc comment names the plugin function that it ports.

use super::ast::{
    Comment, DirectiveKind, Element, ElementKind, Expression, ExpressionKind, FragmentId, Id, Kind,
    Pattern, Span, Tree, Value,
};
use super::doc::{
    Brace, Code, Doc, EMPTY, Js, JsKind, Parser, dedent, group, indent, owned, text, trim_left,
    trim_right,
};
use super::parser::{RESERVED_WORDS, closing_tag_omitted};
use crate::html::embed::infer_parser_by_type_attribute;
use crate::html::preprocess::slice;
use crate::options::{
    AttributePosition, FormatOptions, HtmlWhitespaceSensitivity, SvelteOptions, SveltePart as Part,
};
use crate::stack::Stack;
use crate::text::{
    has_newline, has_newline_backwards, is_previous_line_empty, skip_newline, skip_spaces,
};
use bun_core::strings;
use bun_lint::utils::text::is_identifier_name;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;

const SELF_CLOSING_TAGS: [&[u8]; 14] = [
    b"area", b"base", b"br", b"col", b"embed", b"hr", b"img", b"input", b"link", b"meta", b"param",
    b"source", b"track", b"wbr",
];

/// `type` values that mark a script as code, beyond those that `infer_parser_by_type_attribute` knows: the other
/// names for JavaScript and TypeScript, and Partytown's type, which runs the script in a worker.
const SCRIPT_CODE_TYPES: [&[u8]; 23] = [
    b"application/ecmascript",
    b"application/typescript",
    b"application/x-ecmascript",
    b"application/x-javascript",
    b"javascript",
    b"js",
    b"jsx",
    b"text/ecmascript",
    b"text/javascript1.0",
    b"text/javascript1.1",
    b"text/javascript1.2",
    b"text/javascript1.3",
    b"text/javascript1.4",
    b"text/javascript1.5",
    b"text/jscript",
    b"text/livescript",
    b"text/partytown",
    b"text/ts",
    b"text/typescript",
    b"text/x-ecmascript",
    b"text/x-javascript",
    b"ts",
    b"typescript",
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

pub(crate) fn is_block_element_name(name: &[u8]) -> bool {
    BLOCK_ELEMENTS.contains(&name)
}

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
        let inline_whitespace =
            (text.iter()).take_while(|it| matches!(it, b'\t' | 0x0C | b'\r' | b' '));
        match text.get(inline_whitespace.count()..) {
            Some([b'\n', rest @ ..]) => text = rest,
            _ => return false,
        }
    }
    true
}

/// `endsWithLinebreak`
fn ends_with_linebreak(mut text: &[u8], lines: usize) -> bool {
    for _ in 0..lines {
        let inline_whitespace =
            (text.iter().rev()).take_while(|it| matches!(it, b'\t' | 0x0C | b'\r' | b' '));
        match &text[..text.len() - inline_whitespace.count()] {
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
        let whitespace_len = rest.iter().take_while(|&&it| is_collapsible(it)).count();
        strings::contains_char(&rest[..whitespace_len], b'\n')
    });
    match (has_two, first) {
        (true, _) => Doc::List(vec![Doc::Hardline, Doc::Hardline]),
        (false, Some(_)) => Doc::Hardline,
        (false, None) if !text.is_empty() => Doc::Line,
        _ => EMPTY,
    }
}

/// `text.split("\n")`, joined with `literalline`.
fn verbatim_lines<'a>(text: &Cow<'a, [u8]>) -> Doc<'a> {
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

/// Prints a text node under `<!-- prettier-ignore -->`. The plugin prints the component's source from the node's
/// start to its end. That includes the whitespace at both ends, which is also printed around it, so it grows with
/// every run. It also includes any `<style>` in that range, which has already been printed elsewhere.
fn print_text_verbatim<'a>(raw: &Cow<'a, [u8]>) -> Doc<'a> {
    let start = raw.len() - raw.trim_ascii_start().len();
    let end = raw.trim_ascii_end().len().max(start);
    // Whitespace at the ends is printed as for any other text.
    let ends = [&raw[..start], b"a", &raw[end..]].concat();
    let mut docs = split_text_to_docs(&Cow::Owned(ends));
    for doc in &mut docs {
        if matches!(doc, Doc::Text(_)) {
            *doc = verbatim_lines(&slice(raw, start, end));
        }
    }
    Doc::Fill(docs)
}

/// Normalizes the text of a `class`: spaces and tabs after a word collapse into one space, and those at the end of a
/// line are removed.
fn with_collapsed_spaces(raw: &[u8], is_last: bool) -> Vec<u8> {
    let is_space_or_tab = |byte: u8| matches!(byte, b' ' | b'\t');
    let mut out = Vec::with_capacity(raw.len());
    let mut at = 0;
    while at < raw.len() {
        let byte = raw[at];
        out.push(byte);
        at += 1;
        // `([^ \t\n])(([ \t]+$)|([ \t]+(\r?\n))|[ \t]+)`
        if is_space_or_tab(byte) || byte == b'\n' {
            continue;
        }
        let spaces_len = raw[at..]
            .iter()
            .take_while(|&&it| is_space_or_tab(it))
            .count();
        if spaces_len == 0 {
            continue;
        }
        match &raw[at + spaces_len..] {
            [] => out.extend_from_slice(&raw[at..]),
            [b'\n', ..] => out.push(b'\n'),
            [b'\r', b'\n', ..] => out.extend_from_slice(b"\r\n"),
            _ => out.push(b' '),
        }
        at += spaces_len
            + match &raw[at + spaces_len..] {
                [b'\n', ..] => 1,
                [b'\r', b'\n', ..] => 2,
                _ => 0,
            };
    }
    // `/([^ \t\n])[ \t]+$/`
    let trimmed_len = out.len()
        - out
            .iter()
            .rev()
            .take_while(|&&it| is_space_or_tab(it))
            .count();
    if trimmed_len < out.len() && trimmed_len > 0 && out[trimmed_len - 1] != b'\n' {
        out.truncate(trimmed_len);
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
    // The writer would mistake a line break at the end of a string for one of its own.
    let without = body.len() - body.iter().rev().take_while(|&&it| it == b'\n').count();
    let mut parts = vec![Doc::Literalline, text(&body[..without])];
    parts.extend(body[without..].iter().map(|_| Doc::Literalline));
    parts.push(Doc::Hardline);
    Doc::List(parts)
}

/// A comment that was removed from the markup, and whether an empty line follows it.
type LeadingComment = (Id, bool);

/// The kind of node that a value belongs to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Owner {
    Attribute,
    /// A `RegularElement`'s `class` attribute.
    ElementClass,
    StyleDirective,
}

/// A node's parent in the tree.
#[derive(Copy, Clone)]
struct Parent {
    /// The fragment that contains it.
    fragment: FragmentId,
    /// The element that owns the fragment.
    element: Option<Id>,
}

pub(crate) struct Printer<'a, 'o> {
    pub(crate) tree: Tree<'a>,
    /// `options.originalText`
    pub(crate) text: &'a [u8],
    pub(crate) options: &'o FormatOptions,
    pub(crate) svelte: SvelteOptions,
    /// Prints a pattern. This is `expandNode` without the type annotation.
    pub(crate) expand: &'o mut dyn FnMut(&[u8]) -> Vec<u8>,
    ignore_next: bool,
    ignore_range: bool,
    /// Number of enclosing nodes that make `isPreTagContent` true.
    pre_depth: u32,
    /// The same for `isInsideQuotedAttribute`.
    quoted_depth: u32,
    stack: &'o Stack,
    /// `comments` of the module, the instance and the style sheet.
    comments: [Vec<LeadingComment>; 3],
    /// Each attribute's `comments`, split into leading and trailing.
    attribute_comments: FxHashMap<Id, [Vec<Comment>; 2]>,
    /// The comments in the start tags of elements without attributes.
    element_comments: FxHashMap<Id, Vec<Comment>>,
    /// Elements whose start tag ends with a comment that runs to the end of the line or is printed there.
    ends_tag_with_line_comment: FxHashSet<Id>,
}

impl<'a, 'o> Printer<'a, 'o> {
    pub(crate) fn new(
        tree: Tree<'a>,
        text: &'a [u8],
        (options, svelte): (&'o FormatOptions, SvelteOptions),
        expand: &'o mut dyn FnMut(&[u8]) -> Vec<u8>,
        stack: &'o Stack,
    ) -> Self {
        Printer {
            tree,
            text,
            options,
            svelte,
            expand,
            ignore_next: false,
            ignore_range: false,
            pre_depth: 0,
            quoted_depth: 0,
            stack,
            comments: Default::default(),
            attribute_comments: FxHashMap::default(),
            element_comments: FxHashMap::default(),
            ends_tag_with_line_comment: FxHashSet::default(),
        }
    }

    // ───────────── node-helpers.ts ─────────────

    fn bracket_same_line(&self) -> bool {
        self.options.bracket_same_line.value()
    }

    /// `getUnencodedText` for a `Text`.
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

    /// True if `id` is a comment whose trimmed text is `directive`.
    fn is_directive(&self, id: Id, directive: &[u8]) -> bool {
        matches!(self.tree[id].kind, Kind::Comment { data } if strings::trim_js_whitespace(data) == directive)
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

    /// True for a comment other than `prettier-ignore-start` and `prettier-ignore-end`.
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
            let whitespace_len = raw.iter().take_while(|&&it| is_collapsible(it)).count();
            *raw = slice(raw, whitespace_len, raw.len());
        }
    }

    fn trim_text_right(&mut self, id: Id) {
        if let Kind::Text { raw } = &mut self.tree[id].kind {
            let whitespace_len = raw
                .iter()
                .rev()
                .take_while(|&&it| is_collapsible(it))
                .count();
            *raw = slice(raw, 0, raw.len() - whitespace_len);
        }
    }

    /// `trimChildren`
    fn trim_children(&mut self, fragment: FragmentId) {
        let children = self.tree.fragment(fragment).to_vec();
        let Some(last) = children.len().checked_sub(1) else {
            return;
        };
        let first_non_empty = children.iter().position(|&it| !self.is_empty_text(it));
        let last_non_empty = children.iter().rposition(|&it| !self.is_empty_text(it));
        for &child in &children[..=first_non_empty.unwrap_or(last)] {
            self.trim_text_left(child);
        }
        for &child in &children[last_non_empty.unwrap_or(0)..] {
            self.trim_text_right(child);
        }
    }

    fn is_block_element(&self, id: Id) -> bool {
        self.element(id).is_some_and(|element| {
            element.kind == ElementKind::RegularElement
                && match self.options.html_whitespace_sensitivity {
                    HtmlWhitespaceSensitivity::Strict => false,
                    HtmlWhitespaceSensitivity::Ignore => true,
                    HtmlWhitespaceSensitivity::Css => is_block_element_name(element.name),
                }
        })
    }

    /// `isInlineElement`, with `isPreTagContent` taken from the printer's current position.
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

    /// The value of the `type` attribute, whose name is matched case-insensitively. It's either text or a string
    /// literal in braces.
    fn type_attribute_text(&self, attributes: &[Id]) -> Option<&[u8]> {
        let value = attributes
            .iter()
            .find_map(|&it| match &self.tree[it].kind {
                Kind::Attribute { name, value } if name.eq_ignore_ascii_case(b"type") => {
                    Some(value)
                }
                _ => None,
            })?;
        match self.lone_mustache_tag(value).map(|it| &self.tree[it].kind) {
            Some(Kind::ExpressionTag(it)) if it.kind == ExpressionKind::StringLiteral => {
                let string = it.span.of(self.text);
                string.get(1..string.len() - 1)
            }
            Some(_) => None,
            None => match value {
                Value::True | Value::Tag(_) => None,
                Value::Parts(parts) => parts.iter().find_map(|&it| Some(&self.raw(it)?[..])),
            },
        }
    }

    /// True if a script with these attributes contains code: it has a `lang`, no `type`, or a `type` that means code.
    /// Anything after a `;` in the `type` is ignored, and so is case.
    fn has_code_type(&self, attributes: &[Id]) -> bool {
        let lang = self.attribute_text_value(attributes, b"lang");
        let Some(kind) =
            (self.type_attribute_text(attributes)).filter(|_| lang.is_none_or(|it| it.is_empty()))
        else {
            return true;
        };
        let end = strings::index_of_char(kind, b';').map_or(kind.len(), |it| it as usize);
        let kind = kind[..end].trim_ascii().to_ascii_lowercase();
        kind.is_empty()
            || matches!(
                infer_parser_by_type_attribute(&kind),
                Some(b"babel" | b"typescript")
            )
            || SCRIPT_CODE_TYPES.contains(&&kind[..])
    }

    /// `isNodeSupportedLanguage`
    fn is_supported_language(&self, attributes: &[Id]) -> bool {
        !matches!(
            self.lang(attributes),
            Some(b"coffee" | b"coffeescript" | b"styl" | b"stylus" | b"sass")
        )
    }

    /// `isLoneMustacheTag`, but returns the tag.
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

    /// True if `expression` is the identifier `name` without comments. The plugin turns `a={a /* b */}` and
    /// `a={/* b */ a}` into `{a}`.
    fn is_name(&self, expression: Expression, name: &[u8]) -> bool {
        expression.kind == ExpressionKind::Identifier
            && expression.span.of(self.text) == name
            && !self.has_comments(expression)
    }

    /// True if `name`, which is short for `name={name}`, can be written out that way. The plugin turns `class:a-b`
    /// into `class:a-b={a-b}` and `class:if` into `class:if={if}`.
    fn is_variable(name: &[u8]) -> bool {
        is_identifier_name(name) && !RESERVED_WORDS.contains(&name)
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
    fn can_omit_softline_before_closing_tag(&self, id: Id, parent: Parent) -> bool {
        if !self.bracket_same_line() {
            return false;
        }
        // `hugsStartOfNextNode`
        let hugs_next =
            (self.text.get(self.tree[id].end as usize)).is_some_and(|&next| !is_collapsible(next));
        // `isLastChildWithinParentBlockElement`
        let is_last_in_block = parent.element.is_some_and(|it| self.is_block_element(it))
            && (self.tree.fragment(parent.fragment).iter().rev())
                .find(|&&it| !self.is_empty_text(it))
                == Some(&id);
        !hugs_next || is_last_in_block
    }

    /// Index of the sibling that ends at `start`.
    fn previous_sibling(&self, siblings: &[Id], start: u32) -> Option<usize> {
        let at = siblings.partition_point(|&it| self.tree[it].end < start);
        (siblings.get(at))
            .filter(|&&it| self.tree[it].end == start)
            .map(|_| at)
    }

    /// `getLeadingComment`
    fn leading_comment(&self, id: Id, parent: Parent) -> Option<Id> {
        let siblings = self.tree.fragment(parent.fragment);
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
        Cow::Borrowed(Span { start, end }.of(self.text))
    }

    /// True if there's a comment between `start` and `end`, a range that holds only parentheses, whitespace and
    /// comments.
    fn has_comment_between(&self, start: u32, end: u32) -> bool {
        let gap = self.text.get(start as usize..end as usize);
        gap.is_some_and(|it| strings::contains_char(it, b'/'))
    }

    /// True if there's a comment before or after the part of `expression` that the plugin prints: `{a /* b */}`,
    /// `{/* b */ (a)}`. The plugin does print the one in `{/* b */ a}`.
    fn has_comments_around(&self, expression: Expression) -> bool {
        self.has_comment_between(expression.outer.start, expression.from)
            || self.has_comment_between(expression.span.end, expression.outer.end)
    }

    /// True if there's a comment before or after `expression`. For callers that print something else in its place.
    fn has_comments(&self, expression: Expression) -> bool {
        self.has_comment_between(expression.outer.start, expression.span.start)
            || self.has_comment_between(expression.span.end, expression.outer.end)
    }

    fn js(&self, expression: Expression) -> Js<'a> {
        // The plugin drops these comments.
        let (start, end) = match self.has_comments_around(expression) {
            true => (expression.outer.start, expression.outer.end),
            false => (expression.from, expression.span.end),
        };
        Js {
            text: self.js_text(start, end),
            kind: JsKind::Expression,
            has_single_quotes: false,
            is_on_one_line: false,
            remove_parentheses: false,
            forbids_trailing_comment: false,
            follows: None,
        }
    }

    fn code(js: Js<'a>) -> Doc<'a> {
        Doc::Code(Box::new(Code::Js(js)))
    }

    /// Prints an expression with the default options.
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
            Self::code(Js {
                follows: Some(Brace::InValue),
                ..self.js(expression)
            }),
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
                let before = strings::trim_js_whitespace_end(before);
                let before =
                    strings::trim_js_whitespace_end(before.strip_suffix(b":").unwrap_or(before));
                pattern.span.start as usize + before.len()
            }
            None => pattern.span.end as usize,
        };
        let source = &self.text[pattern.span.start as usize..end.max(pattern.span.start as usize)];
        let mut expanded = (self.expand)(source);
        if let Some(annotation) = pattern.annotation {
            expanded.extend_from_slice(b": ");
            expanded.extend_from_slice(annotation.of(self.text));
        }
        match strings::contains_char(&expanded, b'\n') {
            true => verbatim_lines(&Cow::Owned(expanded)),
            false => owned(expanded),
        }
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
        // The plugin calls `siblings.splice(siblings.indexOf(it), 1)` for each. Where no whitespace follows a
        // comment, the index is -1, which removes the markup's last node.
        let mut gone: FxHashSet<Id> = comments.iter().copied().collect();
        // When the comments move elsewhere, this whitespace can be all that separates two words:
        // `a<!-- b -->\n<script>`, `c`. The plugin removes it even then.
        if self.svelte.sort_order.is_none() {
            gone.extend(newlines.iter().copied().flatten());
        }
        self.tree.fragments[root as usize].retain(|it| !gone.contains(it));
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

    /// `path.map(printWithPrependedAttributeLine(node, options, print), "attributes")`
    fn print_attributes(&mut self, owner: Id, attributes: &[Id], has_this: bool) -> Vec<Doc<'a>> {
        let line = self.attribute_line(attributes, has_this);
        let mut docs = Vec::with_capacity(attributes.len());
        for &attribute in attributes {
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
        // The comments that start at or after `start` and end at or before `end`.
        let between = |start: u32, end: u32| {
            let from = comments.partition_point(|it| it.span.start < start);
            let count = comments[from..]
                .iter()
                .take_while(|it| it.span.end <= end)
                .count();
            comments[from..from + count].to_vec()
        };
        for id in 0..self.tree.nodes.len() as Id {
            // The plugin skips `<svelte:options>` and drops the comments in it.
            let Some(element) = self.element(id) else {
                continue;
            };
            let tag_end = element.start_tag_end;
            let all = between(self.tree[id].start + 2, tag_end);
            let Some(last_comment) = all.last() else {
                continue;
            };
            let attributes = element.attributes.clone();
            let is_at_end_of_line = match attributes.last() {
                None => !last_comment.is_block,
                // `printTrailingComment` uses a line suffix for these, and for every comment after one.
                Some(&last) => {
                    (all.iter().filter(|it| it.span.start >= self.tree[last].end)).any(|it| {
                        !it.is_block || has_newline_backwards(self.text, it.span.start as usize)
                    })
                }
            };
            if is_at_end_of_line {
                self.ends_tag_with_line_comment.insert(id);
            }
            let (Some(&first), Some(&last)) = (attributes.first(), attributes.last()) else {
                // The plugin drops these.
                self.element_comments.insert(id, all);
                continue;
            };
            let mut found = vec![(
                first,
                0,
                between(self.tree[id].start + 2, self.tree[first].start),
            )];
            for (&before, &after) in attributes.iter().zip(&attributes[1..]) {
                let comments = between(self.tree[before].end, self.tree[after].start);
                found.push((after, 0, comments));
            }
            // The plugin searches for the next `>`, which can be inside a comment.
            found.push((last, 1, between(self.tree[last].end, tag_end)));
            for (attribute, which, comments) in found {
                if !comments.is_empty() {
                    self.attribute_comments.entry(attribute).or_default()[which].extend(comments);
                }
            }
        }
    }

    /// Prints a comment's text. The plugin's `printComment`.
    fn print_js_comment(&self, comment: Comment) -> Doc<'a> {
        let source = comment.span.of(self.text);
        text(match comment.is_block {
            true => source,
            false => source.strip_suffix(b"\r").unwrap_or(source),
        })
    }

    /// Prettier's `printComments`, for an attribute.
    fn print_comments(&mut self, attribute: Id, printed: Doc<'a>) -> Doc<'a> {
        let Some([leading, trailing]) = self.attribute_comments.remove(&attribute) else {
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
        // `printTrailingComment`. `previous` is whether the previous comment got a line suffix, and whether it's a
        // block comment.
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

    /// The doc before the `>` of `id`'s start tag. That's `usual`, unless a comment that ends its line comes right
    /// before the `>`. In that case the plugin prints the `>` before the comment whenever they're on the same line:
    /// `<b a>c</b // d`.
    fn line_before_end_of_tag(&self, id: Id, usual: Doc<'a>) -> Doc<'a> {
        match self.ends_tag_with_line_comment.contains(&id) {
            true => dedent(Doc::Hardline),
            false => usual,
        }
    }

    /// Prints the comments in the start tag of `id`, which has no attributes.
    fn print_element_comments(&mut self, id: Id) -> Vec<Doc<'a>> {
        let comments = self.element_comments.remove(&id).unwrap_or_default();
        (comments.into_iter())
            .map(|it| {
                let end = match it.is_block {
                    true => EMPTY,
                    false => Doc::BreakParent,
                };
                Doc::List(vec![Doc::Line, self.print_js_comment(it), end])
            })
            .collect()
    }

    /// `getAttributeLine`
    fn attribute_line(&self, attributes: &[Id], has_this: bool) -> Doc<'a> {
        let count = attributes.len();
        let is_one_per_line = self.options.attribute_position == AttributePosition::Multiline;
        match is_one_per_line && (count > 1 || (count > 0 && has_this)) {
            true => Doc::Hardline,
            false => Doc::Line,
        }
    }

    /// `embedTag`. `comments` is `previousComments`.
    fn embed_tag(
        &mut self,
        (id, tag): (Id, &'static str),
        attributes: &[Id],
        content: Span,
        comments: &[LeadingComment],
        is_top_level: bool,
    ) -> Doc<'a> {
        let (start, content) = (content.start, content.of(self.text));
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
            // The plugin parses every script as JavaScript: `<p>{{a}}</p>` in a `text/template` is JSX, which gets a
            // `;`, and `x^2 + y^2` in a `math/tex` becomes `x ^ (2 + y) ^ 2;`.
            Some(Parser::BabelTs) if !self.has_code_type(attributes) => {
                verbatim_lines(&Cow::Borrowed(content))
            }
            Some(parser) if !strings::trim_js_whitespace(content).is_empty() => {
                Doc::Code(Box::new(Code::Body {
                    content,
                    parser,
                    start,
                }))
            }
            Some(_) if content.is_empty() => EMPTY,
            Some(_) => Doc::Hardline,
            None => preformatted_body(content),
        };
        // The plugin prints this before anything else, when no `prettier-ignore` is in effect yet.
        let ignored = (
            std::mem::take(&mut self.ignore_next),
            std::mem::take(&mut self.ignore_range),
        );
        let mut in_tag = self.print_attributes(id, attributes, false);
        (self.ignore_next, self.ignore_range) = ignored;
        in_tag.extend(self.print_element_comments(id));
        in_tag.push(self.line_before_end_of_tag(
            id,
            match self.bracket_same_line() {
                true => EMPTY,
                false => dedent(Doc::Softline),
            },
        ));
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

    /// `embed`'s result for a top-level script or style sheet.
    fn embed_top_level(&mut self, id: Id, which: usize) -> Doc<'a> {
        let (tag, attributes, content) = match &self.tree[id].kind {
            Kind::Script {
                attributes,
                content,
                ..
            } => ("script", attributes.clone(), *content),
            Kind::StyleSheet {
                attributes,
                content,
            } => ("style", attributes.clone(), *content),
            _ => return EMPTY,
        };
        let comments = std::mem::take(&mut self.comments[which]);
        self.embed_tag((id, tag), &attributes, content, &comments, true)
    }

    /// `embed`'s result for an element, or `None` if `embed` doesn't handle it.
    fn embed_element(&mut self, id: Id, parent: Parent) -> Option<Doc<'a>> {
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
        let children = self.tree.fragment(fragment);
        let content = match (children.first(), children.last()) {
            (Some(&first), Some(&last)) => Span {
                start: self.tree[first].start,
                end: self.tree[last].end,
            },
            _ => Span::default(),
        };
        let comments: Vec<LeadingComment> = (self
            .leading_comment(id, parent)
            .map(|it| (it, false))
            .into_iter())
        .collect();
        Some(self.embed_tag((id, tag), &attributes, content, &comments, false))
    }

    // ───────────── print/index.ts ─────────────

    /// Prints an ignored node verbatim. Returns `None` if the node isn't ignored.
    fn print_ignored(&mut self, id: Id, parent: Option<Parent>) -> Option<Doc<'a>> {
        let is_ignored =
            self.ignore_next || (self.ignore_range && !self.is_ignore_end_directive(id));
        if !is_ignored || self.is_empty_text(id) {
            return None;
        }
        self.ignore_next = false;
        Some(match (self.raw(id), parent) {
            (Some(raw), _) if self.pre_depth == 0 => print_text_verbatim(raw),
            (None, Some(parent)) => self.print_element_verbatim(id, parent),
            _ => self.print_verbatim(id),
        })
    }

    /// Prints the node's source text unchanged.
    fn print_verbatim(&self, id: Id) -> Doc<'a> {
        let (start, end) = (self.tree[id].start, self.tree[id].end);
        verbatim_lines(&Cow::Borrowed(Span { start, end }.of(self.text)))
    }

    /// Same as `print_verbatim`, for a node in a fragment. An element without an end tag extends to the next tag,
    /// so it includes the whitespace before that tag. That whitespace is trimmed here and printed as a line, unless
    /// it's insignificant at that position.
    fn print_element_verbatim(&self, id: Id, parent: Parent) -> Doc<'a> {
        let (start, end) = (self.tree[id].start, self.tree[id].end);
        let source = Span { start, end }.of(self.text);
        let trimmed = source.trim_ascii_end();
        if self.pre_depth > 0 || trimmed.len() == source.len() {
            return self.print_verbatim(id);
        }
        let printed = verbatim_lines(&Cow::Borrowed(trimmed));
        let is_in_block = match parent.element {
            Some(element) => self.is_block_element(element),
            None => parent.fragment == self.tree.fragment,
        };
        let is_last = (self.tree.fragment(parent.fragment).iter().rev())
            .find(|&&it| !self.is_empty_text(it))
            == Some(&id);
        match self.is_block_element(id) || (is_in_block && is_last) {
            true => printed,
            false => Doc::List(vec![printed, Doc::Line]),
        }
    }

    /// `printComment`
    fn print_comment(&self, id: Id) -> Doc<'a> {
        let Kind::Comment { data } = self.tree[id].kind else {
            return EMPTY;
        };
        group(vec![Doc::Token("<!--"), text(data), Doc::Token("-->")])
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

    /// Prints a `Text` or `ExpressionTag` in `owner`'s value. `is_last` means it's the value's last part.
    fn print_in_value(&mut self, id: Id, owner: Owner, is_last: bool) -> Doc<'a> {
        if let Some(ignored) = self.print_ignored(id, None) {
            return ignored;
        }
        match &self.tree[id].kind {
            Kind::Text { raw } if self.pre_depth == 0 => self.print_text(raw),
            Kind::Text { raw } => match owner {
                Owner::ElementClass => {
                    replace_end_of_line(&Cow::Owned(with_collapsed_spaces(raw, is_last)))
                }
                Owner::Attribute => replace_end_of_line(raw),
                Owner::StyleDirective => Doc::Text(raw.clone()),
            },
            Kind::ExpressionTag(expression) => Doc::List(vec![
                Doc::Token("{"),
                Self::code(Js {
                    has_single_quotes: self.quoted_depth > 0,
                    follows: Some(Brace::InValue),
                    ..self.js(*expression)
                }),
                Doc::Token("}"),
            ]),
            _ => EMPTY,
        }
    }

    /// Prints a `Text` that isn't in `<pre>` or the like.
    fn print_text(&self, raw: &Cow<'a, [u8]>) -> Doc<'a> {
        match is_only_collapsible(raw) {
            true => print_whitespace(raw),
            false => Doc::Fill(split_text_to_docs(raw)),
        }
    }

    /// Prints `name`, `=` and the value, in quotes if it needs them.
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

    /// Prints one entry of `owner`'s attribute list.
    fn print_attribute(&mut self, id: Id, owner: Id) -> Doc<'a> {
        if let Some(ignored) = self.print_ignored(id, None) {
            return ignored;
        }
        let allows_shorthand = self.svelte.allows_shorthand;
        // `["=", ...printJsExpression()]`
        let with_value = |printer: &Self, expression: Option<Expression>| match expression {
            Some(it) => Doc::List(vec![Doc::Token("="), printer.print_js_in_braces(it)]),
            None => EMPTY,
        };
        // The plugin puts every value in double quotes, so `a='"'` becomes `a="""`. And `<script lang=ts'>`, which
        // Svelte treats as TypeScript, becomes `lang="ts'"`, which it doesn't, because it matches on the source text.
        let quotes: &[u8] = match (&self.tree[owner].kind, &self.tree[id].kind) {
            (Kind::Script { .. } | Kind::StyleSheet { .. }, Kind::Attribute { name, .. })
                if name.ends_with(b"lang") =>
            {
                b"\"'"
            }
            _ => b"\"",
        };
        if let Kind::Attribute { value, .. } | Kind::StyleDirective { value, .. } =
            &self.tree[id].kind
            && (value.parts().iter().filter_map(|&it| self.raw(it)))
                .any(|it| strings::index_of_any(it, quotes).is_some())
        {
            return self.print_verbatim(id);
        }
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
                let is_element_class = name == b"class"
                    && (self.element(owner))
                        .is_some_and(|it| it.kind == ElementKind::RegularElement);
                let owner = match is_element_class {
                    true => Owner::ElementClass,
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
                    if !allows_shorthand && Self::is_variable(name) {
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
                let allows_shorthand = allows_shorthand || !Self::is_variable(name);
                let (prefix, value) = match kind {
                    DirectiveKind::On => ("on:", with_value(self, expression)),
                    DirectiveKind::Bind if is_own_name && allows_shorthand => ("bind:", EMPTY),
                    DirectiveKind::Bind => ("bind:", self.print_binding(expression)),
                    DirectiveKind::Class if is_own_name && allows_shorthand => ("class:", EMPTY),
                    DirectiveKind::Class => ("class:", with_value(self, expression)),
                    DirectiveKind::Let if is_own_name => ("let:", EMPTY),
                    DirectiveKind::Let => ("let:", with_value(self, expression)),
                    DirectiveKind::Transition(true, true) => {
                        ("transition:", with_value(self, expression))
                    }
                    DirectiveKind::Transition(true, false) => ("in:", with_value(self, expression)),
                    DirectiveKind::Transition(..) => ("out:", with_value(self, expression)),
                    DirectiveKind::Use => ("use:", with_value(self, expression)),
                    DirectiveKind::Animate => ("animate:", with_value(self, expression)),
                };
                // The plugin only prints the modifiers of `on:` and the transitions.
                let modifiers = Self::print_modifiers(&modifiers);
                Doc::List(vec![Doc::Token(prefix), text(name), modifiers, value])
            }
            _ => EMPTY,
        }
    }

    /// Prints `=` and the expression of a `bind:`, which has `surroundWithSoftline`.
    fn print_binding(&self, expression: Option<Expression>) -> Doc<'a> {
        let Some(expression) = expression else {
            return EMPTY;
        };
        let js = Self::code(Js {
            remove_parentheses: expression.kind == ExpressionKind::Sequence,
            follows: Some(Brace::InValue),
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
        // The plugin indents it even in `<pre>`.
        if self.pre_depth > 0 {
            return self.print_pre(Parent {
                fragment,
                element: None,
            });
        }
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
        let parent = Parent {
            fragment,
            element: None,
        };
        let children = self.print_children(parent);
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
    fn print_pre(&mut self, parent: Parent) -> Doc<'a> {
        let children = self.tree.fragment(parent.fragment).to_vec();
        let mut result = Vec::new();
        for child in children {
            if self.raw(child).is_none() {
                result.push(self.print(child, parent));
                continue;
            }
            let (start, end) = (
                self.tree[child].start as usize,
                self.tree[child].end as usize,
            );
            let source = self.text.get(start..end).unwrap_or_default();
            for (index, line) in strings::split(source, b"\n").enumerate() {
                if index > 0 {
                    result.push(Doc::Literalline);
                }
                result.push(text(line.strip_suffix(b"\r").unwrap_or(line)));
            }
        }
        Doc::List(result)
    }

    /// `printChildren`
    fn print_children(&mut self, parent: Parent) -> Doc<'a> {
        let children = self.tree.fragment(parent.fragment).to_vec();
        if self.pre_depth > 0 {
            return Doc::List(children.iter().map(|&it| self.print(it, parent)).collect());
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
                            // The plugin only checks the first condition, and turns `<div></div>hello <b>` into
                            // `hello<b>`.
                            handles_white_space_of_previous_text =
                                !self.is_block_element(previous) || !self.is_empty_text(child);
                            self.trim_text_right(child);
                        }
                        if self.is_block_element(next) && !self.text_ends_with_linebreak(child, 2) {
                            handles_white_space_of_previous_text = !self.is_block_element(previous);
                            self.trim_text_right(child);
                        }
                    }
                } else if let (Some(previous), None) = (previous, next)
                    && self.is_block_element(previous)
                    && self.text_starts_with_white_space(child)
                    && !self.is_empty_text(child)
                    && !self.text_starts_with_linebreak(child, 1)
                {
                    // The plugin doesn't trim the last text: `<p>a</p> b` becomes `<p>a</p>`, a line break and ` b`.
                    // Formatting that output again removes the space. Here it's removed on the first pass.
                    self.trim_text_left(child);
                }
                docs.push(self.print(child, parent));
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
                docs.push(self.print(child, parent));
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
                let printed = self.print(child, parent);
                docs.push(match handles_white_space_of_previous_text {
                    true => group(vec![Doc::Line, printed]),
                    false => printed,
                });
                handles_white_space_of_previous_text = false;
            } else {
                docs.push(self.print(child, parent));
                handles_white_space_of_previous_text = false;
            }
        }
        if prepared.len() > 1 && prepared.iter().any(|&it| self.is_block_element(it)) {
            docs.push(Doc::BreakParent);
        }
        Doc::List(docs)
    }

    /// Prints an element that `embed` doesn't handle.
    fn print_element(&mut self, id: Id, parent: Parent) -> Doc<'a> {
        let Some(element) = self.element(id).cloned() else {
            return EMPTY;
        };
        let (name, kind) = (element.name, element.kind);
        // In `<tr><td>a<tr><td>b`, Svelte lets the second row close the cell but nests it in the first row. The
        // plugin adds every end tag, and then the second row closes the first.
        let would_close_element = |child: &Id| {
            (self.element(*child)).is_some_and(|it| {
                it.kind == ElementKind::RegularElement && closing_tag_omitted(name, it.name)
            })
        };
        if kind == ElementKind::RegularElement
            && (self.tree.fragment(element.fragment).iter()).any(would_close_element)
        {
            return self.print_element_verbatim(id, parent);
        }
        let is_pre = kind == ElementKind::RegularElement
            && (name.eq_ignore_ascii_case(b"pre") || name.eq_ignore_ascii_case(b"textarea"));
        self.pre_depth += u32::from(is_pre);
        let printed = self.print_element_inner(id, &element, parent);
        self.pre_depth -= u32::from(is_pre);
        printed
    }

    fn print_element_inner(&mut self, id: Id, element: &Element<'a>, parent: Parent) -> Doc<'a> {
        let (name, kind) = (element.name, element.kind);
        let bracket_same_line = self.bracket_same_line();
        let is_pre = self.pre_depth > 0;
        let is_supported_language =
            name != b"template" || self.is_supported_language(&element.attributes);
        let children = self.tree.fragment(element.fragment).to_vec();
        // The plugin treats whitespace as empty even in `<pre>`.
        let is_empty = match is_pre {
            true => children
                .iter()
                .all(|&it| self.raw(it).is_some_and(|it| it.is_empty())),
            false => children.iter().all(|&it| self.is_empty_text(it)),
        };
        let is_doctype = name.eq_ignore_ascii_case(b"!doctype");
        let did_self_close = (self.tree[id].end as usize)
            .checked_sub(2)
            .and_then(|at| self.text.get(at))
            == Some(&b'/');
        let is_self_closing = is_empty
            && (did_self_close
                || kind == ElementKind::SvelteWindow
                || SELF_CLOSING_TAGS.contains(&name)
                // Svelte treats these as void too. The plugin prints `<keygen></keygen>`, which Svelte rejects.
                || matches!(name, b"command" | b"keygen")
                || is_doctype);
        let this = element.this.filter(|_| {
            matches!(
                kind,
                ElementKind::SvelteComponent | ElementKind::SvelteElement
            )
        });
        let attributes = self.print_attributes(id, &element.attributes, this.is_some());
        let mut in_tag = Vec::with_capacity(attributes.len() + 2);
        if let Some(source) = element.multipart_this_attribute.filter(|_| this.is_some()) {
            // The plugin prints only the first part, which is all that Svelte looks at: `this="h"`.
            let line = self.attribute_line(&element.attributes, true);
            in_tag.push(Doc::List(vec![line, text(source.of(self.text))]));
        } else if let Some(this) = this {
            let line = self.attribute_line(&element.attributes, true);
            let value = match this.kind {
                ExpressionKind::Text => self.print_this_text(this.span),
                ExpressionKind::StringLiteral
                    if kind == ElementKind::SvelteElement && !self.has_comments(this) =>
                {
                    self.print_tag_name(this)
                }
                _ => self.print_js_in_braces(this),
            };
            in_tag.push(Doc::List(vec![line, Doc::Token("this="), value]));
        }
        in_tag.extend(attributes);
        in_tag.extend(self.print_element_comments(id));
        let has_own_line = self.ends_tag_with_line_comment.contains(&id);
        let opening = |last: Doc<'a>, mut in_tag: Vec<Doc<'a>>| {
            in_tag.push(last);
            vec![Doc::Token("<"), text(name), indent(vec![group(in_tag)])]
        };
        if is_self_closing {
            let mut parts = opening(
                self.line_before_end_of_tag(
                    id,
                    match bracket_same_line || is_doctype {
                        true => EMPTY,
                        false => dedent(Doc::Line),
                    },
                ),
                in_tag,
            );
            parts.push(Doc::Token(
                match (
                    bracket_same_line && !is_doctype && !has_own_line,
                    is_doctype,
                ) {
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
        // This has to be computed before the text is trimmed.
        let has_line_in_it =
            is_inline && first.is_some_and(|it| self.text_starts_with_white_space(it));
        let inner = Parent {
            fragment: element.fragment,
            element: Some(id),
        };
        let mut parts = opening(
            self.line_before_end_of_tag(
                id,
                match (hugs_start && !is_empty) || bracket_same_line || is_pre {
                    true => EMPTY,
                    false => dedent(Doc::Softline),
                },
            ),
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
                || self.can_omit_softline_before_closing_tag(id, parent);
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
                match self.can_omit_softline_before_closing_tag(id, parent) {
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

    /// Prints `this="a"`. The plugin puts every text in double quotes, so `this='a"b'` becomes `this="a"b"`.
    fn print_this_text(&self, source: Span) -> Doc<'a> {
        let before = (source.start as usize)
            .checked_sub(1)
            .and_then(|at| self.text.get(at));
        let quote = Doc::Token(match (before, source.of(self.text)) {
            (_, value) if !strings::contains_char(value, b'"') => "\"",
            (Some(b'\''), _) => "'",
            _ => "",
        });
        Doc::List(vec![quote.clone(), text(source.of(self.text)), quote])
    }

    /// Prints the value of `<svelte:element this=..>` when it's a string literal. The plugin prints `{"a"}` if the
    /// string comes right after the `{` and `"a"` otherwise, and it inserts the string's value unescaped:
    /// `this={'a"b'}` becomes `this={"a"b"}`, and the `&amp;` in `this={ "a&amp;b" }`, which isn't an entity there,
    /// becomes one.
    fn print_tag_name(&self, tag: Expression) -> Doc<'a> {
        let value = match tag.span.of(self.text) {
            [_, inner @ .., _] => inner,
            _ => b"",
        };
        let is_plain = |&it: &u8| {
            !it.is_ascii() || it.is_ascii_alphanumeric() || matches!(it, b'-' | b'_' | b':' | b'.')
        };
        if !value.iter().all(is_plain) {
            return self.print_js_in_braces(tag);
        }
        let is_in_braces = (tag.span.start as usize)
            .checked_sub(1)
            .and_then(|at| self.text.get(at))
            == Some(&b'{');
        Doc::List(vec![
            Doc::Token(if is_in_braces { "{\"" } else { "\"" }),
            text(value),
            Doc::Token(if is_in_braces { "\"}" } else { "\"" }),
        ])
    }

    /// `body()`
    fn print_body(&mut self, inner: Parent, (is_empty, has_line_in_it): (bool, bool)) -> Doc<'a> {
        if is_empty {
            // With `bracketSameLine` the plugin has a line here even in `<pre>`, and it breaks together with the
            // start tag.
            if self.pre_depth > 0 {
                return EMPTY;
            }
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

    /// `print`, for a node in a fragment.
    fn print(&mut self, id: Id, parent: Parent) -> Doc<'a> {
        if !self.stack.has_room() {
            return EMPTY;
        }
        if let Some(embedded) = self.embed_element(id, parent) {
            return embedded;
        }
        if let Some(which) = [self.tree.module, self.tree.instance, self.tree.css]
            .iter()
            .position(|&it| it == Some(id))
        {
            return self.embed_top_level(id, which);
        }
        if let Some(ignored) = self.print_ignored(id, Some(parent)) {
            return ignored;
        }
        // `["{..", printJS(..), "}"]`
        let tag = |open: &'static str, js: Doc<'a>| {
            Doc::List(vec![Doc::Token(open), js, Doc::Token("}")])
        };
        if let Some(element) = self.element(id) {
            return match element.kind {
                ElementKind::SvelteOptions => group(vec![self.print_options_tag(id)]),
                _ => self.print_element(id, parent),
            };
        }
        match self.tree[id].kind.clone() {
            Kind::Text { raw } => match self.pre_depth > 0 {
                true => Doc::Text(raw),
                false => self.print_text(&raw),
            },
            Kind::Comment { .. } => {
                let is_top_level = parent.fragment == self.tree.fragment;
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
                    follows: Some(Brace::InMarkup),
                    ..self.js(expression)
                }),
            ),
            Kind::HtmlTag(expression) => tag("{@html ", self.print_js(expression)),
            Kind::RenderTag(expression) => tag("{@render ", self.print_js(expression)),
            Kind::ConstTag(declarator, _) => tag(
                "{@const ",
                Self::code(Js {
                    text: self.js_text(declarator.start, declarator.end),
                    kind: JsKind::Expression,
                    has_single_quotes: false,
                    is_on_one_line: false,
                    remove_parentheses: true,
                    forbids_trailing_comment: false,
                    follows: None,
                }),
            ),
            Kind::DeclarationTag(declaration) => tag(
                "{",
                Self::code(Js {
                    text: self.js_text(declaration.start, declaration.end),
                    kind: JsKind::Statement,
                    has_single_quotes: false,
                    is_on_one_line: false,
                    remove_parentheses: false,
                    forbids_trailing_comment: true,
                    follows: None,
                }),
            ),
            Kind::DebugTag(identifiers) => {
                // It holds only names, commas and comments, and the plugin drops the comments.
                let (start, end) = (self.tree[id].start as usize, self.tree[id].end as usize);
                if (self.text.get(start..end)).is_some_and(|it| strings::contains_char(it, b'/')) {
                    return self.print_verbatim(id);
                }
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
                // Without an `as`, Svelte resumes where the expression ends, which is before any `)` or comment. The
                // plugin prints `{#each (a = 1)}`.
                let list = Self::code(Js {
                    is_on_one_line: true,
                    remove_parentheses: context.is_none(),
                    forbids_trailing_comment: context.is_none(),
                    ..self.js(expression)
                });
                let mut parts = vec![Doc::Token("{#each "), list];
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
                let non_empty = |printer: &Self, fragment: Option<FragmentId>| {
                    fragment.filter(|&it| {
                        printer
                            .tree
                            .fragment(it)
                            .iter()
                            // Whitespace counts as content in `<pre>`.
                            .any(|&it| printer.pre_depth > 0 || !printer.is_empty_text(it))
                    })
                };
                // The plugin also drops an empty `{:catch}`, but without one Svelte rethrows the error. And dropping
                // an empty `{:then a /* b */}` would lose the comment.
                let has_comment = value.is_some_and(|it| it.has_comments);
                let has_non_empty_then = non_empty(self, then).is_some();
                let (pending, then) = (
                    non_empty(self, pending),
                    then.filter(|_| has_non_empty_then || has_comment),
                );
                let has_non_empty_catch = non_empty(self, catch).is_some();
                let print_if = |printer: &mut Self, fragment: FragmentId, is_non_empty: bool| {
                    match is_non_empty {
                        true => printer.print_block_fragment(fragment),
                        false => EMPTY,
                    }
                };
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
                        block.push(print_if(self, then, has_non_empty_then));
                    }
                    (None, None, Some(catch)) => {
                        let pattern = self.expand_node(error);
                        block.push(clause(head, " catch", pattern));
                        block.push(print_if(self, catch, has_non_empty_catch));
                    }
                    _ => {
                        block.push(clause(head, "", EMPTY));
                        if let Some(pending) = pending {
                            block.push(self.print_block_fragment(pending));
                        }
                        if let Some(then) = then {
                            let pattern = self.expand_node(value);
                            block.push(clause(Vec::new(), "{:then", pattern));
                            block.push(print_if(self, then, has_non_empty_then));
                        }
                    }
                }
                if let Some(catch) = catch.filter(|_| pending.is_some() || then.is_some()) {
                    let pattern = self.expand_node(error);
                    block.push(clause(Vec::new(), "{:catch", pattern));
                    block.push(print_if(self, catch, has_non_empty_catch));
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
                end_of_parameters,
                body,
            } => {
                // The plugin reads up to the first `)` after the last parameter, which can be inside a comment:
                // `a(b /* () */)`.
                let head = Self::code(Js {
                    text: self.js_text(expression.start, end_of_parameters),
                    kind: JsKind::Function,
                    has_single_quotes: false,
                    is_on_one_line: false,
                    remove_parentheses: false,
                    forbids_trailing_comment: false,
                    follows: None,
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

    /// Prints `<svelte:options>`.
    fn print_options_tag(&mut self, id: Id) -> Doc<'a> {
        let attributes = (self.element(id).map(|it| it.attributes.clone())).unwrap_or_default();
        let mut in_tag = self.print_attributes(id, &attributes, false);
        in_tag.extend(self.print_element_comments(id));
        let bracket_same_line =
            self.bracket_same_line() && !self.ends_tag_with_line_comment.contains(&id);
        if !bracket_same_line {
            in_tag.push(self.line_before_end_of_tag(id, dedent(Doc::Line)));
        }
        Doc::List(vec![
            Doc::Token("<svelte:options"),
            indent(vec![group(in_tag)]),
            Doc::Token(if bracket_same_line { " />" } else { "/>" }),
        ])
    }

    /// Called when the markup comes first in the file. A leading U+FEFF is written as an entity, because it would
    /// otherwise be read as a byte order mark.
    fn keep_text_at_start_of_file(&mut self) {
        let root = self.tree.fragment;
        let first = (self.tree.fragment(root).iter())
            .find(|&&it| !self.is_empty_text(it))
            .copied();
        if let Some(Kind::Text { raw }) = first.map(|it| &mut self.tree[it].kind)
            && let Some(rest) = raw.trim_ascii_start().strip_prefix(crate::text::BOM)
        {
            *raw = Cow::Owned([b"&#xFEFF;", rest].concat());
        }
    }

    /// Called when the markup comes last in the file. If it ends with a character that's whitespace in JavaScript but
    /// text in HTML, like a no-break space, that character is written as an entity, because Svelte calls `trimEnd()`.
    /// The plugin lets Svelte trim it.
    fn keep_text_at_end_of_file(&mut self) {
        let root = self.tree.fragment;
        let last = (self.tree.fragment(root).iter().rev())
            .find(|&&it| !self.is_empty_text(it))
            .copied();
        let Some(Kind::Text { raw }) = last.map(|it| &mut self.tree[it].kind) else {
            return;
        };
        let text = raw.trim_ascii_end();
        let len = (1..=3).find(|&len| {
            (text.len().checked_sub(len))
                .is_some_and(|at| strings::js_whitespace_len(&text[at..]) == len)
        });
        let Some(at) = len.map(|len| text.len() - len) else {
            return;
        };
        let entity = match std::str::from_utf8(&text[at..])
            .ok()
            .and_then(|it| it.chars().next())
        {
            Some('\u{A0}') => "&nbsp;".to_owned(),
            Some(it) => format!("&#x{:X};", it as u32),
            None => return,
        };
        let after = raw[text.len()..].to_vec();
        let raw = raw.to_mut();
        raw.truncate(at);
        raw.extend_from_slice(entity.as_bytes());
        raw.extend_from_slice(&after);
    }

    /// The `"Fragment"` case of `print`.
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
        let parent = Parent {
            fragment,
            element: None,
        };
        let mut output = vec![self.print_children(parent)];
        trim_left(&mut output, Doc::is_fragment_whitespace);
        trim_right(&mut output, Doc::is_fragment_whitespace);
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
                    // The plugin always trims, and turns `a <script></script>b` into `ab`.
                    if starts_with_white_space(&next) {
                        self.trim_text_right(current);
                    }
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

    /// `extractRegionEndTrailAfterHoistedEnd`. Returns the whitespace and the comment.
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
            if !is_endregion_comment(data) {
                return None;
            }
            // The whitespace stays: see `remove_and_get_leading_comments`.
            self.tree.fragments[root as usize].remove(at);
            return Some((white_space, child));
        }
        None
    }

    /// `doc` followed by `printRegionEndTrailDoc(trail)`.
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
            let is_before_options = self.tree[node].end == start
                || (nodes.get(index + 1))
                    .is_some_and(|&next| self.is_empty_text(next) && self.tree[next].end == start);
            if !is_before_options {
                continue;
            }
            let printed = self.print_comment(node);
            // The whitespace stays: see `remove_and_get_leading_comments`.
            self.tree.fragments[root as usize].remove(index);
            return Some(printed);
        }
        None
    }

    /// For `svelteSortOrder: "none"`. Puts the scripts, the style sheet and the options back where they were.
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
        // A part that was already inserted by its end can still be matched by its start.
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
            {
                children.push(part);
            }
            index += 1;
        }
        // Everything up to here is what the plugin does. It drops a part that has no neighbor, as in a component
        // that's only a script, and it can insert a part twice. Make sure each part is printed exactly once.
        for part in by_start {
            if children.iter().filter(|&&it| it == part).count() != 1 {
                children.retain(|&it| it != part);
                let start = self.tree[part].start;
                let at = children.partition_point(|&it| self.tree[it].start < start);
                children.insert(at, part);
                // Restore the whitespace before it, which was trimmed when it was the end of the markup.
                let before = at.checked_sub(1).map(|it| self.tree[children[it]].end);
                if let Some(from) = before.filter(|&it| it < start) {
                    let (raw, to) = (Cow::Borrowed(&b"\n"[..]), start as usize);
                    let whitespace_node = self.tree.add(Kind::Text { raw }, from as usize, to);
                    children.insert(at, whitespace_node);
                }
            }
        }
        self.tree.fragments[root] = children;
    }

    /// `printTopLevelParts`, preceded by what `embed` does to the root.
    pub(crate) fn print_root(mut self) -> Doc<'a> {
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
            self.keep_text_at_start_of_file();
            self.keep_text_at_end_of_file();
            let result = self.print_root_fragment();
            return match self.options.insert_pragma && !has_pragma {
                true => with_pragma(result),
                false => result,
            };
        };
        // `hoistedEndsDescending`
        let mut ends: Vec<(usize, u32)> =
            (hoisted.into_iter().chain([self.tree.options]).enumerate())
                .filter_map(|(which, part)| Some((which, self.tree[part?].end)))
                .collect();
        // Ties on the end offset are ordered options, module, instance, style sheet.
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
        let is_present = |part: &Part| match part {
            Part::Options => !options.is_empty(),
            Part::Scripts => !scripts.is_empty(),
            Part::Styles => !styles.is_empty(),
            Part::Markup => true,
        };
        if order.iter().find(|it| is_present(it)) == Some(&Part::Markup) {
            self.keep_text_at_start_of_file();
        }
        if order.iter().rfind(|it| is_present(it)) == Some(&Part::Markup) {
            self.keep_text_at_end_of_file();
        }
        let html = self.print_root_fragment();
        if !matches!(html, Doc::Token("")) {
            markup.push(html);
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
        let mut joined = Vec::with_capacity(docs.len() * 2);
        for (index, doc) in docs.into_iter().enumerate() {
            if index > 0 {
                joined.push(Doc::Hardline);
            }
            joined.push(doc);
        }
        // After the pragma comment, the plugin omits the empty lines between the parts.
        match self.options.insert_pragma && !has_pragma {
            true => with_pragma(group(joined)),
            false => group(joined),
        }
    }
}

/// `/#\s*endregion\b/i.test(data)`
fn is_endregion_comment(data: &[u8]) -> bool {
    let mut rest = data;
    while let Some(at) = strings::index_of_char_usize(rest, b'#') {
        rest = &rest[at + 1..];
        let word = strings::trim_js_whitespace_start(rest);
        if word
            .get(..9)
            .is_some_and(|it| it.eq_ignore_ascii_case(b"endregion"))
            && word
                .get(9)
                .is_none_or(|&it| !strings::is_regexp_word_byte(it))
        {
            return true;
        }
    }
    false
}

/// `hasPragma`: `/^\s*<!--\s*@(format|prettier)\W/`
pub(crate) fn has_pragma(text: &[u8]) -> bool {
    let Some(comment) = strings::trim_js_whitespace_start(text).strip_prefix(b"<!--") else {
        return false;
    };
    let Some(word) = strings::trim_js_whitespace_start(comment).strip_prefix(b"@") else {
        return false;
    };
    (word
        .strip_prefix(b"format")
        .or_else(|| word.strip_prefix(b"prettier")))
    .and_then(|rest| rest.first())
    .is_some_and(|&it| !strings::is_regexp_word_byte(it))
}
