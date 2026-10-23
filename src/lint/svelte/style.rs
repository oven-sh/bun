//! eslint-plugin-svelte's `parseStyleAttributeValue` (`utils/css-utils/style-attribute.js`), as far as its rules about
//! a start tag's declarations read it. A `style` attribute's value is parsed the way its `TemplateSafeParser` parses it
//! (`bun_format::css::parse_safe_template`), with each mustache in it as a word. A mustache between declarations is an
//! inline style: the declarations of the strings and templates its expression can evaluate to, through `?:`, `&&`, `||`
//! and `??`.

use bun_core::StackCheck;
use bun_format::css::{SafeStatement, parse_safe_template};
use bun_lint::ast::svelte::{Role, SvelteNode, SvelteTag};
use bun_lint::prelude::*;

/// A declaration: the property as written, and its span in the component.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Declaration<'a> {
    pub(crate) prop: &'a [u8],
    pub(crate) span: Span,
}

/// The rules' `iterateStyleDeclSetFromAttrs` for the start tag `tag`: each `style:` directive's declaration, and for
/// each `style` attribute the plugin reads, one set per declaration and one per inline style, with the declarations of
/// every value it can have.
pub(crate) fn declaration_sets<'a>(tag: SvelteNode<'a>) -> Vec<Vec<Declaration<'a>>> {
    let file = tag.file();
    let Some(text) = file.svelte().map(|it| it.text()) else {
        return Vec::new();
    };
    let mut sets = Vec::new();
    for attribute in tag.nodes(Role::Attributes) {
        match attribute.tag() {
            SvelteTag::StyleDirective => {
                let Some(key) = attribute.child(Role::Key) else {
                    continue;
                };
                let span = match (key.child(Role::Name), key.code(Role::Name)) {
                    (Some(name), _) => name.span(),
                    (None, Some(code)) => code.span(),
                    (None, None) => continue,
                };
                sets.push(vec![Declaration {
                    prop: attribute.name(),
                    span,
                }]);
            }
            SvelteTag::Attribute if attribute.name() == b"style" => {
                let parts: Vec<SvelteNode<'a>> = attribute.nodes(Role::Value).collect();
                let (Some(first), Some(last)) = (parts.first(), parts.last()) else {
                    continue;
                };
                let start = first.span().start;
                let Some(css) = text.get(start as usize..last.span().end as usize) else {
                    continue;
                };
                let mustaches = (parts.iter())
                    .filter(|it| it.tag() == SvelteTag::MustacheTag)
                    .map(|it| {
                        let expression = it.code(Role::Expression).and_then(|it| it.node());
                        let expression = match expression {
                            Some(Node::Expr(e)) => Some(e),
                            _ => None,
                        };
                        (it.span(), expression)
                    })
                    .collect();
                let style = Style {
                    file,
                    text,
                    stack: StackCheck::init(),
                };
                if let Some(items) = style.root(css, start, mustaches) {
                    style.sets(&items, &mut sets);
                }
            }
            _ => {}
        }
    }
    sets
}

/// A `convertRoot` node, of the kinds the rules read.
enum Item<'a> {
    Declaration(Declaration<'a>),
    Comment,
    /// `SvelteStyleInline`: an interpolation (a mustache or a template substitution), and its expression.
    Inline(Option<Expr<'a>>),
}

struct Style<'a> {
    file: &'a File<'a>,
    /// The component's.
    text: &'a [u8],
    stack: StackCheck,
}

impl<'a> Style<'a> {
    /// `convertRoot` of the style sheet `css`, which starts at `start` in the component and contains `interpolations`,
    /// each with its component span. `None` if the plugin doesn't read it.
    fn root(
        &self,
        css: &'a [u8],
        start: u32,
        interpolations: Vec<(Span, Option<Expr<'a>>)>,
    ) -> Option<Vec<Item<'a>>> {
        let statements = parse_safe_template(css)?;
        let mut items = Vec::with_capacity(statements.len() + interpolations.len());
        let mut pending = interpolations.into_iter().peekable();
        for statement in statements {
            let (range, item) = match statement {
                SafeStatement::Declaration {
                    start: from,
                    end,
                    prop,
                } => {
                    let range = Span::new(start + from, start + end);
                    let span = Span::new(range.start, start + prop_end(css, from, prop));
                    let prop = css
                        .get(prop.0 as usize..prop.1 as usize)
                        .unwrap_or_default();
                    (range, Item::Declaration(Declaration { prop, span }))
                }
                SafeStatement::Comment { start: from, end } => {
                    (Span::new(start + from, start + end), Item::Comment)
                }
            };
            while let Some(&(at, expression)) = pending.peek() {
                if at.end <= range.start {
                    items.push(Item::Inline(expression));
                } else if at.start < range.end {
                    // An interpolation in a comment.
                    if matches!(item, Item::Comment) {
                        return None;
                    }
                } else {
                    break;
                }
                pending.next();
            }
            items.push(item);
        }
        items.extend(pending.map(|(_, expression)| Item::Inline(expression)));
        Some(items)
    }

    /// `iterateStyleDeclSetFromStyleRoot`
    fn sets(&self, items: &[Item<'a>], into: &mut Vec<Vec<Declaration<'a>>>) {
        for item in items {
            match item {
                Item::Declaration(declaration) => into.push(vec![*declaration]),
                Item::Inline(expression) => {
                    let mut all = Vec::new();
                    for style in expression.map(inline_styles).unwrap_or_default() {
                        if let Some(items) = self.inline_style(style) {
                            let mut sets = Vec::new();
                            self.sets(&items, &mut sets);
                            all.extend(sets.into_iter().flatten());
                        }
                    }
                    into.push(all);
                }
                Item::Comment => {}
            }
        }
    }

    /// `getInlineStyle` of a string or a template whose text is a style sheet.
    fn inline_style(&self, e: Expr<'a>) -> Option<Vec<Item<'a>>> {
        if !self.stack.is_safe_to_recurse() {
            return None;
        }
        let view = self.file.view()?;
        let span = e.span();
        // The lowering keeps the code as written, so its contents are at the code's position.
        let base = view.in_file(span.start);
        let in_component = |offset: u32| base + offset.saturating_sub(span.start);
        let start = in_component(span.start) + 1;
        let end = in_component(span.end).checked_sub(1)?;
        let css = self.text.get(start as usize..end as usize)?;
        match e.kind() {
            ExprKind::String(_) => self.root(css, start, Vec::new()),
            ExprKind::Template(template) => {
                let substitutions = (template.exprs().iter().enumerate())
                    .map(|(i, it)| {
                        let from = template.quasi_span(i).end.saturating_sub(2);
                        let to = template.quasi_span(i + 1).start + 1;
                        (Span::new(in_component(from), in_component(to)), Some(it))
                    })
                    .collect();
                self.root(css, start, substitutions)
            }
            _ => None,
        }
    }
}

/// `extractExpressions`: the strings and templates `e` can evaluate to, in order.
fn inline_styles(e: Expr<'_>) -> Vec<Expr<'_>> {
    let (mut found, mut pending) = (Vec::new(), vec![e]);
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::String(_) | ExprKind::Template(_) => found.push(e),
            ExprKind::Cond { yes, no, .. } => pending.extend([no, yes]),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => pending.extend([right, left]),
            _ => {}
        }
    }
    found
}

/// The end of the property of the declaration that starts at `start` in `css`, for the plugin: `start` plus as many
/// UTF-16 code units as `prop` has. Without a `_` or `*` before it, that's where it ends, otherwise one code unit
/// earlier.
fn prop_end(css: &[u8], start: u32, prop: (u32, u32)) -> u32 {
    if prop.0 == start {
        return prop.1;
    }
    let written = css.get(start as usize..prop.1 as usize).unwrap_or_default();
    let last = written
        .iter()
        .rev()
        .take_while(|&&it| it & 0xC0 == 0x80)
        .count()
        + 1;
    prop.1.saturating_sub(last as u32)
}
