//! What `prettier-plugin-tailwindcss` does to a program: `transformJavaScript`.
//!
//! The plugin changes the strings and the templates of the tree before Prettier prints it. Here the text is changed and
//! parsed again, as for the plugins that sort imports. oxfmt has rules of its own: `js/utils/tailwindcss.rs`.

use super::{Ends, Tailwind, Tidies};
use crate::text;
use bun_core::strings;
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{BinOp, Expr, ExprKind, File, KeyKind, Node, Prop, Template};
use bun_lint::span::Span;

/// Which of the white space at the ends of a text has to stay, because of what is around it.
#[derive(Copy, Clone, Default)]
struct Kept {
    start: bool,
    end: bool,
}

/// An expression in a template.
struct InTemplate {
    /// Where the `${` before it ends.
    after_open: u32,
    start: u32,
    /// What has to be kept in it.
    kept: Kept,
    /// A line break has been taken out of it.
    has_lost_line_break: bool,
}

/// Something around what is visited that `canCollapseWhitespaceIn` looks at.
enum Around<'a> {
    /// `left + right`
    Concatenation(Span, Span),
    /// A template, with its expressions.
    Template(Vec<InTemplate>),
    /// What `sortInside` has been called with. What is further out does not count: it is sorted once for each, and
    /// white space that one of them takes away is gone.
    Root(Expr<'a>),
}

struct Sorter<'a, 't> {
    tailwind: &'t Tailwind,
    /// With each, what has to be kept because of those further out.
    around: Vec<(Around<'a>, Kept)>,
    /// How many of them are a `Root`.
    roots: usize,
    /// What is written in the place of what.
    changes: Vec<(Span, Vec<u8>)>,
    tidies: Tidies,
}

/// To Babel what is in an optional chain is no `CallExpression` and no `MemberExpression`.
fn is_other_node_to_babel(e: Expr<'_>) -> bool {
    e.file().is_javascript() && e.is_in_optional_chain()
}

/// To Babel `"use strict"` is no `StringLiteral`.
fn is_directive_to_babel(e: Expr<'_>) -> bool {
    e.file().is_javascript()
        // A file that is one expression has none.
        && e.file().path().first() != Some(&0)
        && matches!(e.parent(), Node::Stmt(it) if it.directive().is_some())
}

/// `isSortableExpression`
fn is_sortable(callee: Expr<'_>, tailwind: &Tailwind) -> bool {
    let mut node = callee;
    loop {
        if is_other_node_to_babel(node) {
            return false;
        }
        node = match node.kind() {
            ExprKind::Call(call) if !tailwind.is_plugin_before_0_7 => call.callee(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Ident(_) => return tailwind.functions.has(node.text()),
            _ => return false,
        };
    }
}

/// `matcher.hasStaticAttr(attribute.name.name)`
fn has_classes(attribute: Prop<'_>, tailwind: &Tailwind) -> bool {
    let file = attribute.file();
    attribute.is_jsx_attribute()
        && attribute.key().is_some_and(|key| {
            let name = file.slice(key.span(file));
            matches!(name, b"class" | b"className") || tailwind.attributes.has(name)
        })
}

/// The expressions of `template`. To the plugin an expression is next to the text before it, if there is nothing in
/// between, and to all texts behind it. The white space at the start can go if each of them starts with white space,
/// that at the end if each of those behind it ends with some. It goes by `start` and `end` of the nodes, which only the
/// trees of Babel have: elsewhere nothing has to be kept.
fn expressions_of(template: Template<'_>) -> Vec<InTemplate> {
    let mut all: Vec<InTemplate> = (template.exprs().iter().enumerate())
        .map(|(index, it)| {
            let (after_open, start) = (template.quasi_span(index).end, it.span().start);
            let keeps_start =
                start == after_open && !text::starts_with_white_space(template.raw(index));
            InTemplate {
                after_open,
                start,
                kept: Kept {
                    start: keeps_start && it.file().is_javascript(),
                    end: false,
                },
                has_lost_line_break: false,
            }
        })
        .collect();
    let is_babel = (template.exprs().iter().next()).is_some_and(|it| it.file().is_javascript());
    let mut behind = Kept::default();
    for (index, it) in all.iter_mut().enumerate().rev().filter(|_| is_babel) {
        let text = template.raw(index + 1);
        behind.start |= !text::starts_with_white_space(text);
        behind.end |= text::trim_end(text).len() == text.len();
        it.kept.start |= behind.start;
        it.kept.end = behind.end;
    }
    all
}

impl<'a> Sorter<'a, '_> {
    /// `canCollapseWhitespaceIn`, the other way around, for what is at `span`.
    fn kept_at(&self, span: Span) -> Kept {
        let Some((around, outer)) = self.around.last() else {
            return Kept::default();
        };
        let is_in = |operand: &Span| operand.start <= span.start && span.end <= operand.end;
        let here = match around {
            Around::Root(_) => Kept::default(),
            Around::Concatenation(left, right) => Kept {
                start: is_in(right),
                end: is_in(left),
            },
            Around::Template(expressions) => {
                let behind = expressions.partition_point(|it| it.start <= span.start);
                (behind.checked_sub(1).and_then(|at| expressions.get(at)))
                    .map_or_else(Kept::default, |it| it.kept)
            }
        };
        Kept {
            start: outer.start || here.start,
            end: outer.end || here.end,
        }
    }

    /// `span`: of what `around` is.
    fn push(&mut self, around: Around<'a>, span: Span) {
        let outer = match around {
            Around::Root(_) => Kept::default(),
            _ => self.kept_at(span),
        };
        self.around.push((around, outer));
    }

    /// `text`, which is at `span`, is text of a template, or what is between the quotes of a string. `index`, `count`: which of
    /// how many texts of the template.
    fn sort(&mut self, text: &[u8], span: Span, (index, count): (usize, usize), kept: Kept) {
        let ends = Ends {
            ignores_first: index > 0 && !text::starts_with_white_space(text),
            ignores_last: index + 1 < count && text::trim_end(text).len() == text.len(),
            collapses_start: !kept.start && index == 0,
            collapses_end: !kept.end && index + 1 == count,
        };
        let sorted = self.tailwind.sorted_with(text, ends, self.tidies);
        if *sorted == *text {
            return;
        }
        let sorted = sorted.into_owned();
        // Prettier asks the text as it was whether there is a line break between a `${` and its `}`.
        if strings::contains_char(text, b'\n') && !strings::contains_char(&sorted, b'\n') {
            for (around, _) in self.around.iter_mut().rev() {
                let Around::Template(expressions) = around else {
                    continue;
                };
                let behind = expressions.partition_point(|it| it.start <= span.start);
                let Some(it) = behind.checked_sub(1).and_then(|at| expressions.get_mut(at)) else {
                    continue;
                };
                // So have those further out.
                if std::mem::replace(&mut it.has_lost_line_break, true) {
                    break;
                }
                let place = Span::new(it.after_open, it.after_open);
                self.changes.push((place, b"\n".to_vec()));
            }
        }
        self.changes.push((span, sorted));
    }

    /// `sortStringLiteral`. `span`: of a string with its quotes, or of a template without expressions.
    fn sort_string(&mut self, file: &File<'_>, span: Span, kept: Kept) {
        if let [b'"' | b'\'' | b'`', content @ .., _] = file.slice(span) {
            let span = Span::new(span.start + 1, span.end - 1);
            self.sort(content, span, (0, 1), kept);
        }
    }

    /// `sortTemplateLiteral`
    fn sort_template(&mut self, template: Template<'_>, kept: Kept) {
        let count = template.quasi_count();
        for index in 0..count {
            let span = template.quasi_span(index);
            let end = span.end - if index + 1 == count { 1 } else { 2 };
            let span = Span::new(span.start + 1, end);
            self.sort(template.raw(index), span, (index, count), kept);
        }
    }

    /// Whether `sortInside` is called with `e`: it is an argument of a function for classes, or in the braces of an
    /// attribute for classes.
    fn is_root(&self, e: Expr<'a>) -> bool {
        match e.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Call(call) => {
                    call.callee() != e
                        && !is_other_node_to_babel(parent)
                        && is_sortable(call.callee(), self.tailwind)
                }
                _ => false,
            },
            Node::Prop(attribute) => {
                e.jsx_container_span().is_some() && has_classes(attribute, self.tailwind)
            }
            _ => false,
        }
    }
}

impl<'a> Visitor<'a> for Sorter<'a, '_> {
    fn enter(&mut self, node: Node<'a>) {
        let e = match node {
            Node::Expr(e) => e,
            // The key of a property is a string like another.
            Node::Prop(property) if self.roots > 0 => {
                if let Some(key) = property.key()
                    && matches!(key.kind(), KeyKind::String(_) | KeyKind::ComputedString(_))
                {
                    let file = property.file();
                    let span = key.inner_span(file);
                    self.sort_string(file, span, self.kept_at(span));
                }
                return;
            }
            _ => return,
        };
        if self.is_root(e) {
            self.push(Around::Root(e), e.span());
            self.roots += 1;
        }
        match e.kind() {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => self.push(Around::Concatenation(left.span(), right.span()), e.span()),
            ExprKind::String(_) if e.is_jsx_text() || is_directive_to_babel(e) => {}
            ExprKind::String(_) if self.roots > 0 => {
                self.sort_string(e.file(), e.span(), self.kept_at(e.span()));
            }
            // The value of an attribute, without braces.
            ExprKind::String(_) => {
                if matches!(e.parent(), Node::Prop(it) if has_classes(it, self.tailwind)) {
                    self.sort_string(e.file(), e.span(), Kept::default());
                }
            }
            ExprKind::Template(template) => {
                let has_tag = || {
                    matches!(e.parent(), Node::Expr(parent)
                        if matches!(parent.kind(), ExprKind::TaggedTemplate(call)
                            if call.template() == Some(e) && is_sortable(call.callee(), self.tailwind)))
                };
                if self.roots > 0 || has_tag() {
                    self.sort_template(template, self.kept_at(e.span()));
                }
                self.push(Around::Template(expressions_of(template)), e.span());
            }
            _ => {}
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        let Node::Expr(e) = node else {
            return;
        };
        if matches!(
            e.kind(),
            ExprKind::Binary { op: BinOp::Add, .. } | ExprKind::Template(_)
        ) {
            self.around.pop();
        }
        if matches!(self.around.last(), Some((Around::Root(root), _)) if *root == e) {
            self.around.pop();
            self.roots -= 1;
        }
    }
}

/// For `file`, which is the expression in the braces of an attribute for classes of Svelte: what is written in the place
/// of what. All its strings and templates are sorted, and nothing else is done to them.
pub fn sorted_in_svelte<'a>(file: &'a File<'a>, tailwind: &Tailwind) -> Vec<(Span, Vec<u8>)> {
    if file.has_parse_errors() {
        return Vec::new();
    }
    let mut sorter = Sorter {
        tailwind,
        around: Vec::new(),
        roots: 1,
        changes: Vec::new(),
        tidies: Tidies {
            collapses_white_space: false,
            removes_duplicates: false,
        },
    };
    walk(file, &mut sorter);
    sorter.changes
}

/// The text of `file` with the classes in it sorted. `None`: it is the same.
pub fn sorted_text<'a>(file: &'a File<'a>, tailwind: &Tailwind) -> Option<Vec<u8>> {
    let text = file.text();
    let (functions, attributes) = (&tailwind.functions, &tailwind.attributes);
    let mut names = [&b"class"[..]]
        .into_iter()
        .chain((functions.names().iter().chain(attributes.names())).map(|it| &it[..]));
    let may_have_classes = functions.has_patterns()
        || attributes.has_patterns()
        || names.any(|name| strings::contains(text, name));
    if !tailwind.follows_plugin || file.has_parse_errors() || !may_have_classes {
        return None;
    }
    let mut sorter = Sorter {
        tailwind,
        around: Vec::new(),
        roots: 0,
        changes: Vec::new(),
        tidies: tailwind.tidies(),
    };
    walk(file, &mut sorter);
    let mut changes = sorter.changes;
    if changes.is_empty() {
        return None;
    }
    // The texts of a template come before what is between them.
    crate::sort::sort_by_key(&mut changes[..], |it| it.0.start);
    let mut sorted = Vec::with_capacity(text.len());
    let mut from = 0;
    for (span, classes) in &changes {
        sorted.extend_from_slice(text.get(from..span.start as usize)?);
        sorted.extend_from_slice(classes);
        from = span.end as usize;
    }
    sorted.extend_from_slice(text.get(from..)?);
    Some(sorted)
}
