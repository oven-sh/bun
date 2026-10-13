//! A check that formatting has not lost or made up anything: `bun fmt --debug-check`.
//!
//! What would be written is parsed, and compared with the file, as `html/verify.rs` does it:
//!
//! - The elements, blocks and tags are the same, in the same order and in each other the same way, and the elements have
//!   the same attributes and directives in the same order. The scripts, the style sheet and `<svelte:options>` can be
//!   anywhere, and so can comments, which go with them.
//! - All that is text has the same letters as often: text, comments, scripts, style sheets, the values of attributes,
//!   expressions. An expression counts with the comments around it, which `prettier-plugin-svelte` loses: `{a /* b */}`.
//! - There are as many comments: in the markup, between attributes, and around expressions.
//! - The text of the markup has the same words in the same order, with white space between the same of them, and between
//!   them and what is next to them. White space is nothing next to a block element, and at the ends of the markup, of a
//!   block element and of a component. In `<pre>` and `<textarea>` every byte counts.

use super::Parsers;
use super::ast::{
    ElementKind, Expression, ExpressionKind, FragmentId, Id, Kind, Pattern, Span, Tree, Value,
};
use super::print::is_block_element_name;
use crate::html::verify::{Reader, Signature};
use crate::options::HtmlWhitespaceSensitivity;
use bun_core::strings;
use std::borrow::Cow;

struct Check<'t, 'a> {
    tree: &'t Tree<'a>,
    text: &'a [u8],
    reader: Reader,
    comments: u32,
    sensitivity: HtmlWhitespaceSensitivity,
}

/// What the text in a fragment is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Text {
    /// Words. The white space at the ends of the fragment is nothing.
    Words,
    /// The same, and the white space at the ends is what it is between two words: an inline element.
    WordsWithEnds,
    /// The same, unless there is nothing else in the fragment: a block of Svelte.
    WordsWithEndsAroundThem,
    /// `<pre>`, `<textarea>`
    Preformatted,
    /// A script, a style sheet, a template in another language.
    Code,
}

/// What is still to be read.
enum Next {
    /// With what the text of the fragment is that it is in.
    Node(Id, Text),
    /// One that is there or not, after a mark of its own.
    Fragment(Option<FragmentId>, Text),
    End,
}

impl Check<'_, '_> {
    #[optimize(size)]
    fn span(&mut self, span: Span) {
        self.reader.count(span.of(self.text));
    }

    /// Counts the comments from `start` to `end`, where no `/` is anything else than part of one.
    #[optimize(size)]
    fn count_comments(&mut self, start: u32, end: u32) {
        let mut rest = Span { start, end }.of(self.text);
        while let Some(at) = strings::index_of_char_usize(rest, b'/') {
            let comment = &rest[at..];
            let len = match comment.get(1) {
                Some(b'*') => strings::index_of(&comment[2..], b"*/").map(|it| it + 4),
                _ => strings::index_of_any(comment, b"\n\r"),
            };
            self.comments += 1;
            rest = comment
                .get(len.unwrap_or(comment.len())..)
                .unwrap_or_default();
        }
    }

    /// Counts the comments around `expression`.
    #[optimize(size)]
    fn count_comments_around(&mut self, expression: Expression) {
        self.count_comments(expression.outer.start, expression.span.start);
        self.count_comments(expression.span.end, expression.outer.end);
    }

    /// The comments around `expression`, and nothing of it.
    #[optimize(size)]
    fn comments_around(&mut self, expression: Expression) {
        let (outer, inner) = (expression.outer, expression.span);
        for (start, end) in [(outer.start, inner.start), (inner.end, outer.end)] {
            self.span(Span { start, end });
        }
        self.count_comments_around(expression);
    }

    #[optimize(size)]
    fn expression(&mut self, expression: Expression) {
        self.span(expression.span);
        self.comments_around(expression);
    }

    #[optimize(size)]
    fn pattern(&mut self, pattern: Option<Pattern>) {
        self.reader.mark(u8::from(pattern.is_some()));
        if let Some(pattern) = pattern {
            self.span(pattern.span);
            // The span of a name does not have it.
            match pattern.annotation {
                Some(annotation) if annotation.end > pattern.span.end => self.span(annotation),
                _ => {}
            }
        }
    }

    #[optimize(size)]
    fn is_name(&self, expression: Expression, name: &[u8]) -> bool {
        expression.kind == ExpressionKind::Identifier && expression.span.of(self.text) == name
    }

    /// The expression of a tag that is all there is to a value.
    #[optimize(size)]
    fn lone_expression(&self, value: &Value) -> Option<Expression> {
        let &[tag] = value.parts() else {
            return None;
        };
        match self.tree[tag].kind {
            Kind::ExpressionTag(expression) => Some(expression),
            _ => None,
        }
    }

    #[optimize(size)]
    fn value(&mut self, value: &Value) {
        let tree = self.tree;
        for &part in value.parts() {
            let node = &tree[part];
            match &node.kind {
                Kind::Text { raw } => self.reader.count_value(raw),
                kind => {
                    if let Kind::ExpressionTag(expression) = kind {
                        self.count_comments_around(*expression);
                    }
                    self.reader.mark(1);
                    self.span(Span {
                        start: node.start,
                        end: node.end,
                    });
                }
            }
        }
    }

    #[optimize(size)]
    fn attributes(&mut self, attributes: &[Id]) {
        let tree = self.tree;
        for &id in attributes {
            let node = &tree[id];
            match &node.kind {
                Kind::Attribute { name, value } => {
                    self.reader.mark(2);
                    self.reader.name(b"", name);
                    self.value(value);
                }
                Kind::Directive {
                    kind,
                    name,
                    modifiers,
                    expression,
                } => {
                    self.reader.mark(3);
                    self.reader.name(kind.name().as_bytes(), name);
                    for modifier in modifiers {
                        self.reader.name(b"|", modifier);
                    }
                    // `let:a={a}` is `let:a`. `class:a-b={a-b}` is not `class:a-b`.
                    match *expression {
                        Some(expression) if self.is_name(expression, name) => {
                            self.comments_around(expression);
                        }
                        Some(expression) => self.expression(expression),
                        None => {}
                    }
                }
                Kind::StyleDirective {
                    name,
                    modifiers,
                    value,
                } => {
                    self.reader.mark(4);
                    self.reader.name(b"style", name);
                    for modifier in modifiers {
                        self.reader.name(b"|", modifier);
                    }
                    // `style:color={color}` is `style:color`.
                    match self.lone_expression(value) {
                        Some(expression) if self.is_name(expression, name) => {
                            self.comments_around(expression);
                        }
                        _ => self.value(value),
                    }
                }
                // `{...a}`, `{@attach a}`
                kind => {
                    if let Kind::SpreadAttribute(expression) | Kind::AttachTag(expression) = kind {
                        self.count_comments_around(*expression);
                    }
                    self.reader.mark(5);
                    self.span(Span {
                        start: node.start,
                        end: node.end,
                    });
                }
            }
        }
    }

    /// Whether there is nothing in it but white space.
    #[optimize(size)]
    fn is_blank(&self, fragment: FragmentId) -> bool {
        self.tree
            .fragment(fragment)
            .iter()
            .all(|&id| matches!(&self.tree[id].kind, Kind::Text { raw } if bun_core::strings::trim_js_whitespace(raw).is_empty()))
    }

    #[optimize(size)]
    fn is_block_element(&self, id: Id) -> bool {
        matches!(&self.tree[id].kind, Kind::Element(it) if it.kind == ElementKind::RegularElement
        && match self.sensitivity {
            HtmlWhitespaceSensitivity::Strict => false,
            HtmlWhitespaceSensitivity::Ignore => true,
            HtmlWhitespaceSensitivity::Css => is_block_element_name(it.name),
        })
    }

    /// The texts in `run`, which has nothing else in it but comments, and is between `previous` and `next`.
    #[optimize(size)]
    fn texts(&mut self, run: &[Id], (previous, next): (Option<Id>, Option<Id>), how: Text) {
        let tree = self.tree;
        let mut texts = run.iter().filter_map(|&it| match &tree[it].kind {
            Kind::Text { raw } => Some(&raw[..]),
            _ => None,
        });
        let first = texts.next().unwrap_or_default();
        let merged = texts.fold(Cow::Borrowed(first), |mut all, it| {
            all.to_mut().extend_from_slice(it);
            all
        });
        let merged = with_white_space_decoded(merged);
        if how == Text::Preformatted {
            return self.reader.exact(&merged);
        }
        let mut words = strings::split_any(&merged, b" \t\n\r\x0C").filter(|it| !it.is_empty());
        let is_all_there_is =
            previous.is_none() && next.is_none() && merged.trim_ascii().is_empty();
        let is_free_at_end = match how {
            Text::WordsWithEnds => false,
            Text::WordsWithEndsAroundThem => is_all_there_is,
            _ => true,
        };
        let is_free_next_to =
            |it: Option<Id>| it.map_or(is_free_at_end, |it| self.is_block_element(it));
        let (is_free_before, is_free_behind) = (is_free_next_to(previous), is_free_next_to(next));
        let Some(first) = words.next() else {
            if !merged.is_empty() && !is_free_before && !is_free_behind {
                self.reader.mark(8);
            }
            return;
        };
        if merged.first().is_some_and(u8::is_ascii_whitespace) && !is_free_before {
            self.reader.mark(8);
        }
        self.reader.exact(first);
        for word in words {
            self.reader.mark(8);
            self.reader.exact(word);
        }
        if merged.last().is_some_and(u8::is_ascii_whitespace) && !is_free_behind {
            self.reader.mark(8);
        }
    }

    /// The text in `fragment`, and where it is among what else is in it.
    #[optimize(size)]
    fn texts_of(&mut self, fragment: FragmentId, how: Text) {
        let tree = self.tree;
        let children = tree.fragment(fragment);
        let is_text = |id: &Id| matches!(tree[*id].kind, Kind::Text { .. } | Kind::Comment { .. });
        let (mut at, mut previous) = (0, None);
        while at < children.len() {
            let len = children[at..].iter().take_while(|it| is_text(it)).count();
            let next = children.get(at + len).copied();
            if len > 0 {
                self.texts(&children[at..at + len], (previous, next), how);
            }
            if next.is_some() {
                self.reader.mark(9);
            }
            (at, previous) = (at + len + 1, next);
        }
    }

    /// Reads `id`, and says in `next` what is in it, the last first.
    #[optimize(size)]
    fn enter(&mut self, id: Id, around: Text, next: &mut Vec<Next>) {
        let is_pre = around == Text::Preformatted;
        let tree = self.tree;
        let node = &tree[id];
        let whole = Span {
            start: node.start,
            end: node.end,
        };
        let mut fragments: [Option<Option<FragmentId>>; 3] = [None; 3];
        let mut how = match is_pre {
            true => Text::Preformatted,
            false => Text::WordsWithEndsAroundThem,
        };
        match &node.kind {
            // The rest has been read with the fragment.
            Kind::Text { raw } if around == Text::Code => return self.reader.count(raw),
            Kind::Text { .. } => return,
            Kind::Comment { data } => {
                self.comments += 1;
                return self.reader.count(data);
            }
            Kind::Element(element) => {
                self.reader.mark(10 + element.kind as u8);
                self.reader.name(b"", element.name);
                match (element.this_with_more, element.this) {
                    (Some(written), _) => self.span(written),
                    (None, Some(this)) => self.expression(this),
                    (None, None) => {}
                }
                self.attributes(&element.attributes);
                fragments[0] = Some(Some(element.fragment));
                let is_regular = element.kind == ElementKind::RegularElement;
                how = match element.name {
                    b"script" | b"style" | b"template" if is_regular => Text::Code,
                    _ if is_pre => Text::Preformatted,
                    name if is_regular
                        && (name.eq_ignore_ascii_case(b"pre")
                            || name.eq_ignore_ascii_case(b"textarea")) =>
                    {
                        Text::Preformatted
                    }
                    // One without an end tag goes on up to the end tag of what it is in, with the white space before that.
                    _ if is_regular
                        && !self.is_block_element(id)
                        && self.sensitivity != HtmlWhitespaceSensitivity::Ignore
                        && has_end_tag(whole.of(self.text), element.name) =>
                    {
                        Text::WordsWithEnds
                    }
                    _ => Text::Words,
                };
            }
            Kind::Script {
                is_module,
                attributes,
                content,
            } => {
                self.reader.mark(40 + u8::from(*is_module));
                self.attributes(attributes);
                self.span(*content);
            }
            Kind::StyleSheet {
                attributes,
                content,
            } => {
                self.reader.mark(42);
                self.attributes(attributes);
                self.span(*content);
            }
            Kind::IfBlock {
                is_else_if,
                test,
                consequent,
                alternate,
            } => {
                self.reader.mark(43 + u8::from(*is_else_if));
                self.expression(*test);
                fragments = [Some(Some(*consequent)), Some(*alternate), None];
            }
            Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback,
            } => {
                self.reader.mark(45);
                self.expression(*expression);
                self.pattern(*context);
                self.reader.count(index.unwrap_or_default());
                if let Some(key) = *key {
                    self.expression(key);
                }
                fragments = [Some(Some(*body)), Some(*fallback), None];
            }
            Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            } => {
                self.reader.mark(46);
                self.expression(*expression);
                // `{#await a}{:then b}` is `{#await a then b}`, and `{#await a then b}{/await}` is `{#await a}{/await}`. A
                // `{:catch}` with nothing in it is not nothing.
                let [pending, then] = [pending, then].map(|it| it.filter(|&it| !self.is_blank(it)));
                self.pattern(value.filter(|_| then.is_some()));
                self.pattern(error.filter(|_| catch.is_some()));
                fragments = [Some(pending), Some(then), Some(*catch)];
            }
            Kind::KeyBlock {
                expression,
                fragment,
            } => {
                self.reader.mark(47);
                self.expression(*expression);
                fragments[0] = Some(Some(*fragment));
            }
            Kind::SnippetBlock {
                expression,
                last_parameter_end,
                body,
            } => {
                self.reader.mark(48);
                self.span(Span {
                    start: expression.start,
                    end: last_parameter_end.unwrap_or(expression.end),
                });
                fragments[0] = Some(Some(*body));
            }
            // Tags.
            kind => {
                match kind {
                    Kind::ExpressionTag(expression)
                    | Kind::HtmlTag(expression)
                    | Kind::RenderTag(expression)
                    | Kind::ConstTag(_, expression) => self.count_comments_around(*expression),
                    Kind::DebugTag(_) => self.count_comments(whole.start, whole.end),
                    _ => {}
                }
                self.reader.mark(49);
                return self.span(whole);
            }
        }
        next.push(Next::End);
        next.extend((fragments.into_iter().rev().flatten()).map(|it| Next::Fragment(it, how)));
    }
}

/// Whether `written`, an element with the name `name`, ends with `</name>`.
#[optimize(size)]
fn has_end_tag(written: &[u8], name: &[u8]) -> bool {
    strings::last_index_of(written, b"</")
        .and_then(|at| written[at + 2..].strip_prefix(name))
        .is_some_and(|behind| strings::trim_js_whitespace(behind) == b">")
}

/// `text` with the characters in the place of `&nbsp;` and of `&#xA0;` and the like, if they are white space to JavaScript.
#[optimize(size)]
fn with_white_space_decoded(text: Cow<'_, [u8]>) -> Cow<'_, [u8]> {
    if !strings::contains_char(&text, b'&') {
        return text;
    }
    let (mut out, mut rest) = (Vec::with_capacity(text.len()), &text[..]);
    while let Some(at) = strings::index_of_char_usize(rest, b'&') {
        out.extend_from_slice(&rest[..at]);
        rest = &rest[at..];
        let end = strings::index_of_char_usize(rest, b';').unwrap_or(0);
        let decoded = match &rest[..end] {
            b"&nbsp" => Some('\u{A0}'),
            [b'&', b'#', b'x', digits @ ..] => (std::str::from_utf8(digits).ok())
                .and_then(|it| u32::from_str_radix(it, 16).ok())
                .and_then(char::from_u32),
            _ => None,
        };
        let mut bytes = [0; 4];
        match decoded.map(|it| it.encode_utf8(&mut bytes).as_bytes()) {
            Some(it) if strings::js_whitespace_len(it) == it.len() && !it.is_empty() => {
                out.extend_from_slice(it);
                rest = &rest[end + 1..];
            }
            _ => {
                out.push(b'&');
                rest = &rest[1..];
            }
        }
    }
    out.extend_from_slice(rest);
    Cow::Owned(out)
}

#[optimize(size)]
fn signature(
    text: &[u8],
    parsers: Parsers<'_>,
    sensitivity: HtmlWhitespaceSensitivity,
) -> Option<(Signature, u32)> {
    let text = super::trimmed(text);
    let tree = parsers.tree_of(text).ok()?;
    let mut check = Check {
        tree: &tree,
        text,
        reader: Reader::default(),
        comments: 0,
        sensitivity,
    };
    let mut next = vec![Next::Fragment(Some(tree.fragment), Text::Words)];
    next.extend(
        ([tree.css, tree.instance, tree.module, tree.options].into_iter())
            .flatten()
            .map(|id| Next::Node(id, Text::Words)),
    );
    while let Some(it) = next.pop() {
        match it {
            Next::Node(id, around) => check.enter(id, around, &mut next),
            Next::End => check.reader.mark(0),
            Next::Fragment(None, _) => check.reader.mark(6),
            Next::Fragment(Some(fragment), how) => {
                check.reader.mark(7);
                if how != Text::Code {
                    check.texts_of(fragment, how);
                }
                next.extend(
                    tree.fragment(fragment)
                        .iter()
                        .rev()
                        .map(|&id| Next::Node(id, how)),
                );
            }
        }
    }
    for comment in &tree.comments {
        check.comments += 1;
        check.span(comment.span);
    }
    Some((check.reader.finish(), check.comments))
}

/// Whether `after`, which is what has become of `before`, has all that is in `before` and nothing else. Both have `\n` at
/// the ends of their lines and no byte order mark.
#[optimize(size)]
pub(crate) fn has_same_content(
    before: &[u8],
    after: &[u8],
    parsers: Parsers<'_>,
    sensitivity: HtmlWhitespaceSensitivity,
) -> bool {
    match (
        signature(before, parsers, sensitivity),
        signature(after, parsers, sensitivity),
    ) {
        (Some(before), Some(after)) => before == after,
        _ => false,
    }
}
