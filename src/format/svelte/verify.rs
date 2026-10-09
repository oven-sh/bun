//! A check that formatting has not lost or made up anything. `bun format` makes it before it writes a file.
//!
//! What has been written is parsed, and compared with the file, as `html/verify.rs` does it:
//!
//! - The elements, blocks and tags are the same, in the same order and in each other the same way, and the elements have
//!   the same attributes and directives in the same order. The scripts, the style sheet and `<svelte:options>` can be
//!   anywhere, and so can comments, which go with them.
//! - All that is text has the same letters as often: text, comments, scripts, style sheets, the values of attributes,
//!   expressions. A tag counts from `{` to `}`: `prettier-plugin-svelte` loses the comment of `{a /* b */}`.

use super::ast::{Expression, FragmentId, Id, Kind, Pattern, Span, Tree, Value};
use super::parser::{self, Js};
use super::snip::{self, ATTRIBUTE};
use crate::html::verify::{Reader, Signature};

struct Check<'t, 'a> {
    tree: &'t Tree<'a>,
    text: &'a [u8],
    contents: &'a [Vec<u8>],
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
    fn span(&mut self, span: Span) {
        // There can be a `<script>` in a string.
        let text = snip::unsnip(span.of(self.text), self.contents);
        self.reader.count(&text);
    }

    fn expression(&mut self, expression: Expression) {
        self.span(Span {
            start: expression.from,
            end: expression.span.end,
        });
    }

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

    /// The expression of a tag that is all there is to a value.
    fn lone_expression(&self, value: &Value) -> Option<Expression> {
        let &[tag] = value.parts() else {
            return None;
        };
        match self.tree[tag].kind {
            Kind::ExpressionTag(expression) => Some(expression),
            _ => None,
        }
    }

    fn value(&mut self, value: &Value) {
        let tree = self.tree;
        for &part in value.parts() {
            let node = &tree[part];
            match &node.kind {
                Kind::Text { raw } => self.reader.count_value(raw),
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

    fn attributes(&mut self, attributes: &[Id]) {
        let (tree, contents) = (self.tree, self.contents);
        for &id in attributes {
            let node = &tree[id];
            match &node.kind {
                // What has been in the element.
                Kind::Attribute { name, value } if *name == ATTRIBUTE => {
                    let index = match value {
                        Value::Parts(parts) => match parts[..] {
                            [part] => match &tree[part].kind {
                                Kind::Text { raw } => std::str::from_utf8(raw).ok(),
                                _ => None,
                            },
                            _ => None,
                        },
                        _ => None,
                    };
                    let content = index
                        .and_then(|it| it.parse::<usize>().ok())
                        .and_then(|it| contents.get(it));
                    self.reader.count(content.map_or(&b""[..], |it| &it[..]));
                }
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
                    // `let:a={a}` is `let:a`.
                    match *expression {
                        Some(expression) if expression.span.of(self.text) != *name => {
                            self.expression(expression);
                        }
                        _ => {}
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
                        Some(expression) if expression.span.of(self.text) == *name => {}
                        _ => self.value(value),
                    }
                }
                // `{...a}`, `{@attach a}`
                _ => {
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
    fn is_blank(&self, fragment: FragmentId) -> bool {
        self.tree
            .fragment(fragment)
            .iter()
            .all(|&id| matches!(&self.tree[id].kind, Kind::Text { raw } if bun_core::strings::trim_js_whitespace(raw).is_empty()))
    }

    /// Reads `id`, and says in `next` what is in it, the last first.
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
                if let Some(this) = element.this {
                    self.expression(this);
                }
                self.attributes(&element.attributes);
                fragments[0] = Some(Some(element.fragment));
            }
            Kind::Script {
                is_module,
                attributes,
            } => {
                self.reader.mark(40 + u8::from(*is_module));
                self.attributes(attributes);
            }
            Kind::StyleSheet { attributes } => {
                self.reader.mark(42);
                self.attributes(attributes);
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
                // `{#await a}{:then b}` is `{#await a then b}`, and `{#await a then b}{/await}` is `{#await a}{/await}`.
                let [pending, then, catch] =
                    [pending, then, catch].map(|it| it.filter(|&it| !self.is_blank(it)));
                self.pattern(value.filter(|_| then.is_some()));
                self.pattern(error.filter(|_| catch.is_some()));
                fragments = [Some(pending), Some(then), Some(catch)];
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
            _ => {
                self.reader.mark(49);
                return self.span(whole);
            }
        }
        next.push(Next::End);
        next.extend(fragments.into_iter().rev().flatten().map(Next::Fragment));
    }
}

fn signature(text: &[u8], js: &mut dyn Js) -> Option<(Signature, u32)> {
    let snipped = snip::snip(text);
    let tree = parser::parse(&snipped.text, js).ok()?;
    let mut check = Check {
        tree: &tree,
        text: &snipped.text,
        contents: &snipped.contents,
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
pub(crate) fn has_same_content(
    (before, after): (&[u8], &[u8]),
    (js_before, js_after): (&mut dyn Js, &mut dyn Js),
) -> bool {
    match (signature(before, js_before), signature(after, js_after)) {
        (Some(before), Some(after)) => before == after,
        _ => false,
    }
}
