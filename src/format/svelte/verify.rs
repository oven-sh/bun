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

use super::Parsers;
use super::ast::{Expression, ExpressionKind, FragmentId, Id, Kind, Pattern, Span, Tree, Value};
use crate::html::verify::{Reader, Signature};
use bun_core::strings;

struct Check<'t, 'a> {
    tree: &'t Tree<'a>,
    text: &'a [u8],
    reader: Reader,
    comments: u32,
}

/// What is still to be read.
enum Next {
    Node(Id),
    /// One that is there or not, after a mark of its own.
    Fragment(Option<FragmentId>),
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

    /// Reads `id`, and says in `next` what is in it, the last first.
    #[optimize(size)]
    fn enter(&mut self, id: Id, next: &mut Vec<Next>) {
        let tree = self.tree;
        let node = &tree[id];
        let whole = Span {
            start: node.start,
            end: node.end,
        };
        let mut fragments: [Option<Option<FragmentId>>; 3] = [None; 3];
        match &node.kind {
            Kind::Text { raw } => return self.reader.count(raw),
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
        next.extend(fragments.into_iter().rev().flatten().map(Next::Fragment));
    }
}

#[optimize(size)]
fn signature(text: &[u8], parsers: Parsers<'_>) -> Option<(Signature, u32)> {
    let text = super::trimmed(text);
    let tree = parsers.tree_of(text).ok()?;
    let mut check = Check {
        tree: &tree,
        text,
        reader: Reader::default(),
        comments: 0,
    };
    let mut next = vec![Next::Fragment(Some(tree.fragment))];
    next.extend(
        ([tree.css, tree.instance, tree.module, tree.options].into_iter())
            .flatten()
            .map(Next::Node),
    );
    while let Some(it) = next.pop() {
        match it {
            Next::Node(id) => check.enter(id, &mut next),
            Next::End => check.reader.mark(0),
            Next::Fragment(None) => check.reader.mark(6),
            Next::Fragment(Some(fragment)) => {
                check.reader.mark(7);
                next.extend(
                    tree.fragment(fragment)
                        .iter()
                        .rev()
                        .map(|&id| Next::Node(id)),
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
pub(crate) fn has_same_content(before: &[u8], after: &[u8], parsers: Parsers<'_>) -> bool {
    match (signature(before, parsers), signature(after, parsers)) {
        (Some(before), Some(after)) => before == after,
        _ => false,
    }
}
