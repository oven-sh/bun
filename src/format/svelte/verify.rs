//! A check that formatting has not lost or made up anything: `bun fmt --debug-check`.
//!
//! What would be written is parsed, and compared with the file, as `html/verify.rs` does it:
//!
//! - The elements, blocks and tags are the same, in the same order and in each other the same way, and the elements have
//!   the same attributes and directives in the same order. The scripts, the style sheet and `<svelte:options>` can be
//!   anywhere, and so can comments, which go with them.
//! - The code in the markup has the same tokens in the same order: expressions, declarations, patterns, the heads of
//!   snippets. Free to change is what a formatter changes: parentheses, `,` and `;`, which quotes a string has and whether
//!   a key has any, how a number is written, an escape in a name, the order of the flags of a regular expression and of
//!   modifiers, the `|` before the first type of a union, and the text of a template that can be in another language. So
//!   `(a + b) * c` is `a + b * c` here. Code that cannot be parsed by itself has the same letters as often.
//! - All that is text has the same letters as often: comments, scripts, style sheets.
//! - There are as many comments: in the markup, between attributes, and in and around the code in the markup, where
//!   `prettier-plugin-svelte` loses them: `{a /* b */}`.
//! - The value of an attribute is the same byte for byte. That of `class` and of a `style:` directive is the same word for
//!   word: it is broken into lines like text.
//! - The text of the markup has the same words in the same order, with white space between the same of them, and between
//!   them and what is next to them. White space is nothing next to a block element, and at the ends of the markup, of a
//!   block element and of a component, also where it is in an inline element that is the first or the last thing there. In
//!   `<pre>` and `<textarea>` every byte counts.

use super::Parsers;
use super::ast::{
    ElementKind, Expression, ExpressionKind, FragmentId, Id, Kind, Pattern, Span, Tree, Value,
};
use super::pattern::{BEFORE_PATTERN, path_of, repeated_keys};
use super::print::is_block_element_name;
use crate::html::js::Parse;
use crate::html::verify::{Reader, Signature};
use crate::js::utils::number::format_trimmed_number;
use crate::options::HtmlWhitespaceSensitivity;
use crate::verify::{is_in_another_language, is_table, without_unicode_escapes};
use bun_core::strings;
use bun_lint::ast::{Expr, ExprKind, ExprTag, File, KeyKind};
use bun_lint::tokens::{Token, TokenKind};
use std::borrow::Cow;

/// What makes a program of a piece of code: what is put before it, and behind it.
type Around = (&'static [u8], &'static [u8]);
const EXPRESSION: Around = (b"(", b"\n)");
const STATEMENT: Around = (b"", b"\n");
const DECLARATOR: Around = (b"const ", b"\n");
const FUNCTION: Around = (b"function ", b" {}");
const PARAMETER: Around = (BEFORE_PATTERN, b"\n) {}");

struct Check<'t, 'a> {
    tree: &'t Tree<'a>,
    text: &'a [u8],
    /// Parses a program.
    parse: Parse<'t>,
    reader: Reader,
    comments: u32,
    sensitivity: HtmlWhitespaceSensitivity,
}

/// What the text in a fragment is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Text {
    /// Words. Whether the white space at the start of the fragment is nothing, and the same for its end. For a node: whether
    /// white space before it would be nothing, and behind it.
    Words(bool, bool),
    /// Words in a block of Svelte: the white space at the ends is what it is between two words, unless there is nothing else.
    WordsInBlock,
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

    /// The comments around `expression`, and nothing of it.
    #[optimize(size)]
    fn comments_around(&mut self, expression: Expression) {
        let (outer, inner) = (expression.outer, expression.span);
        for (start, end) in [(outer.start, inner.start), (inner.end, outer.end)] {
            self.span(Span { start, end });
            self.count_comments(start, end);
        }
    }

    /// The code at `span`, with its comments. `left_out`: where in it the keys are that do not count, in order.
    #[optimize(size)]
    fn code(&mut self, (before, behind): Around, span: Span, left_out: &[(usize, usize)]) {
        let program = [before, span.of(self.text), behind].concat();
        let (reader, comments) = (&mut self.reader, &mut self.comments);
        let mut is_read = false;
        let path = path_of(self.tree.says_typescript);
        self.parse.call(path, &program, false, &mut |file| {
            let is_jsx =
                |it: Token<'_>| matches!(it.kind(), TokenKind::JsxText | TokenKind::JsxIdentifier);
            if file.has_parse_errors() || file.tokens().any(is_jsx) {
                return;
            }
            is_read = true;
            reader.mark(50);
            read_tokens(file, before.len(), left_out, reader);
            for comment in file.comments() {
                *comments += 1;
                reader.count(comment.text());
            }
        });
        if !is_read {
            self.reader.mark(51);
            self.span(span);
        }
    }

    #[optimize(size)]
    fn expression(&mut self, expression: Expression) {
        self.code(EXPRESSION, expression.outer, &[]);
    }

    #[optimize(size)]
    fn pattern(&mut self, pattern: Option<Pattern>) {
        self.reader.mark(u8::from(pattern.is_some()));
        if let Some(pattern) = pattern {
            // `{ a: a }` is `{ a }`.
            let written = pattern.span.of(self.text);
            let mut keys = match strings::contains_char(written, b':') {
                true => repeated_keys(self.parse, written, self.tree.says_typescript),
                false => Vec::new(),
            };
            crate::sort::sort_by_key(&mut keys, |it| it.0);
            self.code(PARAMETER, pattern.with_annotation(), &keys);
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

    /// `is_in_words`: the white space in it is free to change.
    #[optimize(size)]
    fn value(&mut self, value: &Value, is_in_words: bool) {
        let tree = self.tree;
        for &part in value.parts() {
            let node = &tree[part];
            match &node.kind {
                Kind::Text { raw } if is_in_words => (strings::split_any(raw, b" \t\n\r\x0C"))
                    .filter(|it| !it.is_empty())
                    .for_each(|it| self.reader.exact(it)),
                Kind::Text { raw } => self.reader.exact(raw),
                Kind::ExpressionTag(expression) => {
                    self.reader.mark(1);
                    self.expression(*expression);
                }
                _ => {
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
                    self.value(value, *name == b"class");
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
                        _ => self.value(value, true),
                    }
                }
                Kind::SpreadAttribute(expression) => {
                    self.reader.mark(5);
                    self.expression(*expression);
                }
                Kind::AttachTag(expression) => {
                    self.reader.mark(52);
                    self.expression(*expression);
                }
                _ => {
                    self.reader.mark(53);
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

    /// The texts in `run`, which has nothing else in it but comments. `is_free`: whether white space is nothing at its start, and
    /// at its end. Returns whether there is a word in it.
    #[optimize(size)]
    fn texts(&mut self, run: &[Id], is_free: (bool, bool), is_preformatted: bool) -> bool {
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
        if is_preformatted {
            self.reader.exact(&merged);
            return true;
        }
        let mut words = strings::split_any(&merged, b" \t\n\r\x0C").filter(|it| !it.is_empty());
        let Some(first) = words.next() else {
            if !merged.is_empty() && !is_free.0 && !is_free.1 {
                self.reader.mark(8);
            }
            return false;
        };
        if merged.first().is_some_and(u8::is_ascii_whitespace) && !is_free.0 {
            self.reader.mark(8);
        }
        self.reader.exact(first);
        for word in words {
            self.reader.mark(8);
            self.reader.exact(word);
        }
        if merged.last().is_some_and(u8::is_ascii_whitespace) && !is_free.1 {
            self.reader.mark(8);
        }
        true
    }

    /// Reads the text in `fragment`, and where it is among what else is in it, which it says in `next`, the last first.
    #[optimize(size)]
    fn enter_fragment(&mut self, fragment: FragmentId, how: Text, next: &mut Vec<Next>) {
        let tree = self.tree;
        let children = tree.fragment(fragment);
        let from = next.len();
        if matches!(how, Text::Code) {
            next.extend(children.iter().rev().map(|&id| Next::Node(id, how)));
            return;
        }
        let is_text = |id: &Id| matches!(tree[*id].kind, Kind::Text { .. } | Kind::Comment { .. });
        let is_blank = children.iter().all(|&id| match &tree[id].kind {
            Kind::Text { raw } => raw.trim_ascii().is_empty(),
            Kind::Comment { .. } => true,
            _ => false,
        });
        let is_free_at = match how {
            Text::Words(start, end) => (start, end),
            _ => (is_blank, is_blank),
        };
        let (mut at, mut previous) = (0, None);
        while at < children.len() {
            let len = children[at..].iter().take_while(|it| is_text(it)).count();
            let following = children.get(at + len).copied();
            let is_free_before = previous.map_or(is_free_at.0, |it| self.is_block_element(it));
            let is_free_behind = following.map_or(is_free_at.1, |it| self.is_block_element(it));
            let run = &children[at..at + len];
            let has_words = len > 0
                && self.texts(
                    run,
                    (is_free_before, is_free_behind),
                    how == Text::Preformatted,
                );
            // Now it is known what is behind `previous`.
            if let Some(Next::Node(_, Text::Words(_, behind))) =
                next.last_mut().filter(|_| previous.is_some())
            {
                *behind = !has_words && is_free_behind;
            }
            next.extend(run.iter().map(|&id| Next::Node(id, how)));
            if let Some(following) = following {
                self.reader.mark(9);
                next.push(Next::Node(
                    following,
                    match how {
                        Text::Preformatted => how,
                        // What is behind it is known when it has been read, unless nothing is.
                        _ => Text::Words(!has_words && is_free_before, is_free_at.1),
                    },
                ));
            }
            (at, previous) = (at + len + 1, following);
        }
        next[from..].reverse();
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
        let mut how = match around {
            Text::Preformatted | Text::Code => around,
            _ => Text::WordsInBlock,
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
                    // `this={"a"}` is `this="a"`, unless the text stands for something else than the string.
                    (None, Some(this)) if this.kind == ExpressionKind::Text => {
                        self.reader.exact(this.span.of(self.text));
                    }
                    (None, Some(this)) if this.kind == ExpressionKind::StringLiteral => {
                        let string = without_quotes(this.span.of(self.text));
                        match strings::index_of_any(&string, b"\\&{") {
                            Some(_) => self.expression(this),
                            None => {
                                self.reader.exact(&string);
                                self.comments_around(this);
                            }
                        }
                    }
                    (None, Some(this)) => self.expression(this),
                    (None, None) => {}
                }
                self.attributes(&element.attributes);
                fragments[0] = Some(Some(element.fragment));
                let is_regular = element.kind == ElementKind::RegularElement;
                how = match element.name {
                    _ if around == Text::Code => Text::Code,
                    b"script" | b"style" | b"template" if is_regular => Text::Code,
                    _ if is_pre => Text::Preformatted,
                    name if is_regular
                        && (name.eq_ignore_ascii_case(b"pre")
                            || name.eq_ignore_ascii_case(b"textarea")) =>
                    {
                        Text::Preformatted
                    }
                    _ if is_regular
                        && !self.is_block_element(id)
                        && self.sensitivity != HtmlWhitespaceSensitivity::Ignore =>
                    {
                        match around {
                            Text::Words(..) => around,
                            _ => Text::Words(false, false),
                        }
                    }
                    _ => Text::Words(true, true),
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
                self.reader.exact(index.unwrap_or_default());
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
                // `{:catch}` with nothing in it is not nothing, nor is a `{:then b /* c */}`.
                let has_comment = value.is_some_and(|it| it.has_comments);
                let pending = pending.filter(|&it| !self.is_blank(it));
                let then = then.filter(|&it| has_comment || !self.is_blank(it));
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
                end_of_parameters,
                body,
            } => {
                self.reader.mark(48);
                let (start, end) = (expression.start, *end_of_parameters);
                self.code(FUNCTION, Span { start, end }, &[]);
                fragments[0] = Some(Some(*body));
            }
            Kind::ExpressionTag(expression) => {
                self.reader.mark(49);
                return self.expression(*expression);
            }
            Kind::HtmlTag(expression) => {
                self.reader.mark(54);
                return self.expression(*expression);
            }
            Kind::RenderTag(expression) => {
                self.reader.mark(55);
                return self.expression(*expression);
            }
            Kind::ConstTag(declarator, expression) => {
                self.reader.mark(56);
                let end = declarator.end.max(expression.outer.end);
                let start = declarator.start;
                return self.code(DECLARATOR, Span { start, end }, &[]);
            }
            Kind::DeclarationTag(declaration) => {
                self.reader.mark(57);
                return self.code(STATEMENT, *declaration, &[]);
            }
            Kind::DebugTag(names) => {
                self.reader.mark(58);
                names
                    .iter()
                    .for_each(|it| self.reader.exact(it.of(self.text)));
                self.count_comments(whole.start, whole.end);
                return self.span(whole);
            }
            _ => {
                self.reader.mark(59);
                return self.span(whole);
            }
        }
        next.push(Next::End);
        next.extend((fragments.into_iter().rev().flatten()).map(|it| Next::Fragment(it, how)));
    }
}

/// Whether something ends with `token` that an operator can follow. If not, a `|` behind it is before the first type of a
/// union.
#[optimize(size)]
fn ends_operand(token: Token<'_>) -> bool {
    match token.kind() {
        TokenKind::Punctuator => matches!(token.text(), b")" | b"]" | b"}" | b">"),
        TokenKind::Identifier | TokenKind::Keyword => {
            !matches!(token.text(), b"as" | b"satisfies" | b"extends" | b"is")
        }
        _ => true,
    }
}

#[optimize(size)]
fn is_spelled_like_modifier(word: &[u8]) -> bool {
    matches!(
        word,
        b"abstract"
            | b"accessor"
            | b"declare"
            | b"override"
            | b"private"
            | b"protected"
            | b"public"
            | b"readonly"
            | b"static"
    )
}

/// Where the expressions of the kinds `tags` start that `is_one` holds for, in order.
#[optimize(size)]
fn starts_of<'a>(
    file: &'a File<'a>,
    tags: &[ExprTag],
    is_one: impl Fn(Expr<'a>) -> bool,
) -> Vec<u32> {
    let all = tags.iter().flat_map(|&tag| file.exprs_of_kind(tag));
    let mut starts: Vec<u32> = all
        .filter(|&it| is_one(it))
        .map(|it| it.span().start)
        .collect();
    crate::sort::sort(&mut starts[..]);
    starts
}

/// What is between the quotes of `string`, where a quote is not escaped.
#[optimize(size)]
fn without_quotes(string: &[u8]) -> Vec<u8> {
    let mut rest = (string.get(1..string.len().saturating_sub(1))).unwrap_or_default();
    let mut out = Vec::with_capacity(rest.len());
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        out.extend_from_slice(&rest[..at]);
        let escaped = rest.get(at + 1).copied();
        if !matches!(escaped, Some(b'"' | b'\'')) {
            out.push(b'\\');
        }
        out.extend(escaped);
        rest = rest.get(at + 2..).unwrap_or_default();
    }
    out.extend_from_slice(rest);
    out
}

/// The tokens of `file`, but for what the head of this file says. `before`: how long what is before the code is.
/// `left_out`: see [`Check::code`].
#[optimize(size)]
fn read_tokens<'a>(
    file: &'a File<'a>,
    before: usize,
    left_out: &[(usize, usize)],
    reader: &mut Reader,
) {
    let mut left_out = left_out.iter().peekable();
    // What a token is does not depend on the tokens next to it, which are free to change. A string that is none of these is a
    // key, a type or the name of a module.
    let mut values = starts_of(file, &[ExprTag::String], |_| true);
    // `{ ["a"]: b }`: the tree has no expression for it.
    for object in file.exprs_of_kind(ExprTag::Object) {
        if let ExprKind::Object(properties) = object.kind() {
            let keys = properties.iter().filter_map(|it| it.key());
            let computed = keys.filter(|it| matches!(it.kind(), KeyKind::ComputedString(_)));
            values.extend(computed.map(|it| it.inner_span(file).start));
        }
    }
    crate::sort::sort(&mut values[..]);
    // A word like `static` that is none of these is a modifier or a key.
    let names = starts_of(file, &[ExprTag::Ident], |it| {
        is_spelled_like_modifier(it.text())
    });
    // `` css`a {}` ``, `` /* HTML */ `<a></a>` ``, `` test.each`a | b` ``
    let free_templates = starts_of(file, &[ExprTag::Template, ExprTag::String], |it| {
        it.text().starts_with(b"`") && (is_in_another_language(it) || is_table(it))
    });
    // For each template that is open: whether it is one of those.
    let mut templates = Vec::new();
    let (mut previous, mut is_behind_key) = (None, false);
    for token in file.tokens() {
        let (text, at) = (
            token.text(),
            (token.start() as usize).saturating_sub(before),
        );
        let was_behind_key = std::mem::take(&mut is_behind_key);
        while left_out.next_if(|it| it.1 <= at).is_some() {}
        if left_out.peek().is_some_and(|it| it.0 <= at) {
            is_behind_key = true;
            continue;
        }
        match token.kind() {
            TokenKind::Punctuator => match text {
                b"(" | b")" | b"," | b";" => {}
                b":" if was_behind_key => {}
                b"|" | b"&" if !previous.is_some_and(ends_operand) => {}
                _ => reader.exact(text),
            },
            TokenKind::String => {
                // A key can get and lose its quotes. A value cannot: `"a"` is not `a`.
                if values.binary_search(&token.start()).is_ok() {
                    reader.mark(60);
                }
                reader.exact(&without_quotes(text));
            }
            TokenKind::Numeric => reader.exact(&format_trimmed_number(text)),
            TokenKind::RegularExpression => {
                let flags = strings::last_index_of_char(text, b'/').map_or(text.len(), |it| it + 1);
                reader.exact(&text[..flags]);
                reader.count(&text[flags..]);
            }
            TokenKind::Template => {
                if text.starts_with(b"`") {
                    templates.push(free_templates.binary_search(&token.start()).is_ok());
                }
                match templates.last() {
                    Some(true) => reader.count(text),
                    _ => reader.exact(text),
                }
                if text.len() > 1 && text.ends_with(b"`") {
                    templates.pop();
                }
            }
            // `static private` is `private static`.
            TokenKind::Identifier | TokenKind::Keyword
                if is_spelled_like_modifier(text)
                    && names.binary_search(&token.start()).is_err() =>
            {
                reader.count(text)
            }
            _ if strings::contains_char(text, b'\\') => {
                reader.exact(&without_unicode_escapes(text))
            }
            _ => reader.exact(text),
        }
        previous = Some(token);
    }
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
        parse: parsers.program,
        reader: Reader::default(),
        comments: 0,
        sensitivity,
    };
    let mut next = vec![Next::Fragment(Some(tree.fragment), Text::Words(true, true))];
    next.extend(
        ([tree.css, tree.instance, tree.module, tree.options].into_iter())
            .flatten()
            .map(|id| Next::Node(id, Text::Words(true, true))),
    );
    while let Some(it) = next.pop() {
        match it {
            Next::Node(id, around) => check.enter(id, around, &mut next),
            Next::End => check.reader.mark(0),
            Next::Fragment(None, _) => check.reader.mark(6),
            Next::Fragment(Some(fragment), how) => {
                check.reader.mark(7);
                check.enter_fragment(fragment, how, &mut next);
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
