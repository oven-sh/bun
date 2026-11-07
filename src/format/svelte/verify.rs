//! Checks that formatting didn't lose or invent anything. Used by `bun fmt --debug-check`.
//!
//! The output is parsed and compared with the input, the way `html/verify.rs` does it:
//!
//! - The elements, blocks and tags are the same, in the same order and with the same nesting, and the elements have
//!   the same attributes and directives in the same order. The scripts, the style sheet and `<svelte:options>` can be
//!   anywhere, and so can comments, which move with them.
//! - The code in the markup has the same tokens in the same order: expressions, declarations, patterns, snippet
//!   heads. A formatter's usual changes are allowed: parentheses, `,` and `;`, a string's quote style and whether a
//!   key is quoted, how a number is written, an escape in a name, the order of regular expression flags and of
//!   modifiers, the `|` before a union's first type, and the text of a template that can hold another language. So
//!   `(a + b) * c` equals `a + b * c` here. Code that doesn't parse on its own must have the same letters, each the
//!   same number of times.
//! - Everything that's text has the same letters, each the same number of times: comments, scripts, style sheets.
//! - The number of comments is the same: in the markup, between attributes, and in and around the code in the markup,
//!   where `prettier-plugin-svelte` drops them: `{a /* b */}`.
//! - An attribute's value is the same byte for byte. The value of `class` and of a `style:` directive is the same
//!   word for word, because it's wrapped like text.
//! - The markup's text has the same words in the same order, with whitespace between the same words, and between
//!   words and their neighbors. Whitespace doesn't count next to a block element, or at the ends of the markup, of a
//!   block element and of a component, even inside an inline element that's the first or last thing there. In `<pre>`
//!   and `<textarea>` every byte counts.

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

/// The prefix and suffix that turn a piece of code into a program.
type Wrapper = (&'static [u8], &'static [u8]);
const EXPRESSION: Wrapper = (b"(", b"\n)");
const STATEMENT: Wrapper = (b"", b"\n");
const DECLARATOR: Wrapper = (b"const ", b"\n");
const FUNCTION: Wrapper = (b"function ", b" {}");
const PARAMETER: Wrapper = (BEFORE_PATTERN, b"\n) {}");

struct Check<'t, 'a> {
    tree: &'t Tree<'a>,
    text: &'a [u8],
    /// Parses a program.
    parse: Parse<'t>,
    reader: Reader,
    comments: u32,
    sensitivity: HtmlWhitespaceSensitivity,
}

/// How the text in a fragment is compared.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Text {
    /// Words. The flags say whether whitespace is insignificant at the fragment's start and at its end. For a node,
    /// they say whether whitespace before it and after it would be insignificant.
    Words(bool, bool),
    /// Words in a Svelte block. Whitespace at the ends counts like whitespace between two words, unless the block
    /// holds nothing else.
    WordsInBlock,
    /// `<pre>`, `<textarea>`
    Preformatted,
    /// A script, a style sheet, a template in another language.
    Code,
}

/// An item on the stack of things still to read.
enum Next {
    /// A node, with the `Text` of the fragment that contains it.
    Node(Id, Text),
    /// An optional fragment. Present and absent each get their own mark.
    Fragment(Option<FragmentId>, Text),
    End,
}

impl Check<'_, '_> {
    #[optimize(size)]
    fn span(&mut self, span: Span) {
        self.reader.count(span.of(self.text));
    }

    /// Counts the comments between `start` and `end`, a range where every `/` is part of a comment.
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

    /// Reads the comments around `expression`, but not the expression itself.
    #[optimize(size)]
    fn comments_around(&mut self, expression: Expression) {
        let (outer, inner) = (expression.outer, expression.span);
        for (start, end) in [(outer.start, inner.start), (inner.end, outer.end)] {
            self.span(Span { start, end });
            self.count_comments(start, end);
        }
    }

    /// Reads the code at `span`, with its comments. `ignored_keys` holds the spans of the keys in it
    /// that don't count, in order.
    #[optimize(size)]
    fn code(&mut self, (prefix, suffix): Wrapper, span: Span, ignored_keys: &[(usize, usize)]) {
        let program = [prefix, span.of(self.text), suffix].concat();
        let (reader, comments) = (&mut self.reader, &mut self.comments);
        let mut is_read = false;
        let path = path_of(self.tree.uses_typescript);
        self.parse.call(path, &program, false, &mut |file| {
            let is_jsx =
                |it: Token<'_>| matches!(it.kind(), TokenKind::JsxText | TokenKind::JsxIdentifier);
            if file.has_parse_errors() || file.tokens().any(is_jsx) {
                return;
            }
            is_read = true;
            reader.mark(50);
            read_tokens(file, prefix.len(), ignored_keys, reader);
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
            // `{ a: a }` is the same as `{ a }`.
            let pattern_text = pattern.span.of(self.text);
            let mut keys = match strings::contains_char(pattern_text, b':') {
                true => repeated_keys(self.parse, pattern_text, self.tree.uses_typescript),
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

    /// The expression of a value that's a single expression tag.
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

    /// `is_in_words` means the whitespace in it may change.
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
                    // `let:a={a}` is the same as `let:a`, but `class:a-b={a-b}` isn't the same as `class:a-b`.
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
                    // `style:color={color}` is the same as `style:color`.
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

    /// True if it holds only whitespace.
    #[optimize(size)]
    fn is_whitespace_only(&self, fragment: FragmentId) -> bool {
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

    /// Reads the text nodes in `run`, which otherwise holds only comments. `is_free` is true where whitespace
    /// is insignificant: at its start, and at its end. Returns true if it contains a word.
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
        let merged = decode_whitespace_entities(merged);
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

    /// Reads the text in `fragment` and its position among the other children, which are pushed onto `next` in
    /// reverse order.
    #[optimize(size)]
    fn enter_fragment(&mut self, fragment: FragmentId, mode: Text, next: &mut Vec<Next>) {
        let tree = self.tree;
        let children = tree.fragment(fragment);
        let from = next.len();
        if matches!(mode, Text::Code) {
            next.extend(children.iter().rev().map(|&id| Next::Node(id, mode)));
            return;
        }
        let is_text = |id: &Id| matches!(tree[*id].kind, Kind::Text { .. } | Kind::Comment { .. });
        let is_whitespace_only = children.iter().all(|&id| match &tree[id].kind {
            Kind::Text { raw } => raw.trim_ascii().is_empty(),
            Kind::Comment { .. } => true,
            _ => false,
        });
        let is_free_at = match mode {
            Text::Words(start, end) => (start, end),
            _ => (is_whitespace_only, is_whitespace_only),
        };
        let (mut at, mut previous) = (0, None);
        while at < children.len() {
            let len = children[at..].iter().take_while(|it| is_text(it)).count();
            let following = children.get(at + len).copied();
            let is_free_before = previous.map_or(is_free_at.0, |it| self.is_block_element(it));
            let is_free_after = following.map_or(is_free_at.1, |it| self.is_block_element(it));
            let run = &children[at..at + len];
            let has_words = len > 0
                && self.texts(
                    run,
                    (is_free_before, is_free_after),
                    mode == Text::Preformatted,
                );
            // Now we know what comes after `previous`.
            if let Some(Next::Node(_, Text::Words(_, free_after_previous))) =
                next.last_mut().filter(|_| previous.is_some())
            {
                *free_after_previous = !has_words && is_free_after;
            }
            next.extend(run.iter().map(|&id| Next::Node(id, mode)));
            if let Some(following) = following {
                self.reader.mark(9);
                next.push(Next::Node(
                    following,
                    match mode {
                        Text::Preformatted => mode,
                        // What comes after it is filled in once that has been read, unless it's the last child.
                        _ => Text::Words(!has_words && is_free_before, is_free_at.1),
                    },
                ));
            }
            (at, previous) = (at + len + 1, following);
        }
        next[from..].reverse();
    }

    /// Reads `id` and pushes its contents onto `next` in reverse order.
    #[optimize(size)]
    fn enter(&mut self, id: Id, enclosing: Text, next: &mut Vec<Next>) {
        let is_pre = enclosing == Text::Preformatted;
        let tree = self.tree;
        let node = &tree[id];
        let whole = Span {
            start: node.start,
            end: node.end,
        };
        let mut fragments: [Option<Option<FragmentId>>; 3] = [None; 3];
        let mut mode = match enclosing {
            Text::Preformatted | Text::Code => enclosing,
            _ => Text::WordsInBlock,
        };
        match &node.kind {
            // Other text was already read with its fragment.
            Kind::Text { raw } if enclosing == Text::Code => return self.reader.count(raw),
            Kind::Text { .. } => return,
            Kind::Comment { data } => {
                self.comments += 1;
                return self.reader.count(data);
            }
            Kind::Element(element) => {
                self.reader.mark(10 + element.kind as u8);
                self.reader.name(b"", element.name);
                match (element.multipart_this_attribute, element.this) {
                    (Some(this_span), _) => self.span(this_span),
                    // `this={"a"}` is the same as `this="a"`, unless the text would mean something other than the
                    // string.
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
                mode = match element.name {
                    _ if enclosing == Text::Code => Text::Code,
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
                        match enclosing {
                            Text::Words(..) => enclosing,
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
                // `{#await a}{:then b}` is the same as `{#await a then b}`, and `{#await a then b}{/await}` is the
                // same as `{#await a}{/await}`. An empty `{:catch}` still counts, and so does an empty
                // `{:then b /* c */}`.
                let has_comment = value.is_some_and(|it| it.has_comments);
                let pending = pending.filter(|&it| !self.is_whitespace_only(it));
                let then = then.filter(|&it| has_comment || !self.is_whitespace_only(it));
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
        next.extend((fragments.into_iter().rev().flatten()).map(|it| Next::Fragment(it, mode)));
    }
}

/// True if `token` ends an operand, so an operator can follow. If not, a `|` after it is the one before a union's
/// first type.
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

/// Sorted start offsets of the expressions with one of `tags` for which `predicate` returns true.
#[optimize(size)]
fn starts_of<'a>(
    file: &'a File<'a>,
    tags: &[ExprTag],
    predicate: impl Fn(Expr<'a>) -> bool,
) -> Vec<u32> {
    let all = tags.iter().flat_map(|&tag| file.exprs_of_kind(tag));
    let mut starts: Vec<u32> = all
        .filter(|&it| predicate(it))
        .map(|it| it.span().start)
        .collect();
    crate::sort::sort(&mut starts[..]);
    starts
}

/// The content of `string` without its quotes, with escaped quotes unescaped.
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

/// Reads `file`'s tokens, except for the changes that the module docs allow. `before` is the length of the prefix
/// before the code. For `ignored_keys`, see [`Check::code`].
#[optimize(size)]
fn read_tokens<'a>(
    file: &'a File<'a>,
    before: usize,
    ignored_keys: &[(usize, usize)],
    reader: &mut Reader,
) {
    let mut ignored_keys = ignored_keys.iter().peekable();
    // A token is classified from the tree and not from its neighbors, which may change. A string that isn't one of
    // these is a key, a type or a module name.
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
    // A word like `static` that isn't one of these is a modifier or a key.
    let names = starts_of(file, &[ExprTag::Ident], |it| {
        is_spelled_like_modifier(it.text())
    });
    // `` css`a {}` ``, `` /* HTML */ `<a></a>` ``, `` test.each`a | b` ``
    let free_templates = starts_of(file, &[ExprTag::Template, ExprTag::String], |it| {
        it.text().starts_with(b"`") && (is_in_another_language(it) || is_table(it))
    });
    // For each open template, whether it's one of `free_templates`.
    let mut templates = Vec::new();
    let (mut previous, mut is_after_key) = (None, false);
    for token in file.tokens() {
        let (text, at) = (
            token.text(),
            (token.start() as usize).saturating_sub(before),
        );
        let was_after_key = std::mem::take(&mut is_after_key);
        while ignored_keys.next_if(|it| it.1 <= at).is_some() {}
        if ignored_keys.peek().is_some_and(|it| it.0 <= at) {
            is_after_key = true;
            continue;
        }
        match token.kind() {
            TokenKind::Punctuator => match text {
                b"(" | b")" | b"," | b";" => {}
                b":" if was_after_key => {}
                b"|" | b"&" if !previous.is_some_and(ends_operand) => {}
                _ => reader.exact(text),
            },
            TokenKind::String => {
                // A key can gain or lose its quotes. A value can't: `"a"` isn't `a`.
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
            // `static private` is the same as `private static`.
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

/// `text` with `&nbsp;`, `&#xA0;` and the like decoded, if the character is whitespace in JavaScript.
#[optimize(size)]
fn decode_whitespace_entities(text: Cow<'_, [u8]>) -> Cow<'_, [u8]> {
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
            Next::Node(id, enclosing) => check.enter(id, enclosing, &mut next),
            Next::End => check.reader.mark(0),
            Next::Fragment(None, _) => check.reader.mark(6),
            Next::Fragment(Some(fragment), mode) => {
                check.reader.mark(7);
                check.enter_fragment(fragment, mode, &mut next);
            }
        }
    }
    for comment in &tree.comments {
        check.comments += 1;
        check.span(comment.span);
    }
    Some((check.reader.finish(), check.comments))
}

/// True if `after`, the formatted form of `before`, has the same content as `before`. Both use `\n` line endings and
/// have no byte order mark.
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
