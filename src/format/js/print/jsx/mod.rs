//! JSX. Prettier's `print/jsx.js`.

mod child_list;
mod element;
mod opening_element;

use self::element::AnyJsxTagWithChildren;
use crate::js::format::format_node;
use crate::prelude::*;
use crate::{format_args, write};

/// `<a>b</a>`, `<a />`, `<>b</>`
pub(crate) fn write_jsx_element<'a>(e: Expr<'a>, jsx: Jsx<'a>, f: &mut Formatter<'a>) {
    AnyJsxTagWithChildren { expr: e, jsx }.fmt(f);
}

/// The name in a tag: `a`, `a.b`, `a-b`, `a:b`. `parent`: the element.
struct FormatJsxName<'a> {
    name: Expr<'a>,
    parent: AstNodes<'a>,
}

impl<'a> Format<'a> for FormatJsxName<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let name = self.name;
        format_node(name.span(), || self.parent, f, |f| match name.kind() {
            ExprKind::Dot { obj, name: property, .. } => write!(
                f,
                [
                    FormatJsxName {
                        name: obj,
                        parent: self.parent
                    },
                    ".",
                    source_text(property.span())
                ]
            ),
            _ => write!(f, text_without_whitespace(name.text())),
        });
    }
}

/// `</a>`
fn write_jsx_closing_element<'a>(e: Expr<'a>, name: Expr<'a>, f: &mut Formatter<'a>) {
    let leading_comments = f.comments().comments_before(name.span().start);
    let name_has_leading_comment = !leading_comments.is_empty();
    let name_has_own_line_leading_comment = leading_comments.iter().any(|it| it.is_line());
    let name = FormatJsxName {
        name,
        parent: AstNodes::JSXElement(e),
    };

    write!(f, "</");
    if name_has_own_line_leading_comment {
        write!(f, [hard_line_break(), block_indent(&name), hard_line_break()]);
    } else {
        write!(f, [name_has_leading_comment.then_some(space()), name]);
    }
    write!(f, ">");
}

/// `<>` and `</>`. `span`: of the tag.
fn write_jsx_fragment_tag<'a>(span: Span, is_closing: bool, f: &mut Formatter<'a>) {
    let open = if is_closing { "</" } else { "<" };
    let comments = f.comments().comments_before(span.end);
    if comments.is_empty() {
        return write!(f, [open, ">"]);
    }
    let has_own_line_comment = comments.iter().any(|c| c.is_line());
    let format_comments = format_with(|f| {
        if has_own_line_comment {
            write!(f, hard_line_break());
        } else if is_closing {
            write!(f, space());
        }
        write!(
            f,
            FormatDanglingComments::Comments {
                comments,
                indent: DanglingIndentMode::None
            }
        );
    });
    write!(f, [open, indent(&format_comments), has_own_line_comment.then_some(hard_line_break()), ">"]);
}

/// A child of an element, or the value of an attribute: text, an element, `{e}`, `{...e}`.
#[derive(Copy, Clone)]
pub(crate) struct FormatJsxChild<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatJsxChild<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let e = self.0;
        match e.jsx_container_span() {
            Some(span) if !matches!(e.kind(), ExprKind::Spread(_)) => {
                let node = AstNodes::JSXExpressionContainer(e);
                format_node(span, || node.parent(), f, |f| write_jsx_expression_container(e, span, node.parent(), f));
            }
            _ => e.fmt(f),
        }
    }
}

impl Spanned for FormatJsxChild<'_> {
    fn span(&self) -> Span {
        self.0.jsx_container_span().unwrap_or_else(|| self.0.span())
    }
}

/// `{e}`. `span`: of the braces.
fn write_jsx_expression_container<'a>(expression: Expr<'a>, span: Span, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    let has_comment = !f.is_quiet()
        && (f.comments().has_comment_before(expression.span().start)
            || f.comments().has_comment_in_range(expression.span().end, span.end));
    let format_with_comments = format_with(|f| {
        write!(f, expression);
        let comments = f.comments().comments_before(span.end);
        write!(f, FormatTrailingComments::Comments(comments));
    });
    let format_indented = soft_block_indent(&format_with_comments);

    if !matches!(parent, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_)) {
        // The value of an attribute
        return match !has_comment && should_inline_jsx_expression(expression) {
            true => write!(f, ["{", expression, line_suffix_boundary(), "}"]),
            false => write!(f, group(&format_args!("{", format_indented, line_suffix_boundary(), "}"))),
        };
    }

    if matches!(expression.kind(), ExprKind::Missing) {
        // `{/* comment */}`
        let comments = f.comments().comments_before(span.end);
        write!(f, "{");
        if comments.iter().any(|c| c.is_line()) {
            write!(
                f,
                [
                    FormatDanglingComments::Comments {
                        comments,
                        indent: DanglingIndentMode::Block
                    },
                    format_dangling_comments(span).with_block_indent(),
                    hard_line_break()
                ]
            );
        } else {
            write!(
                f,
                FormatDanglingComments::Comments {
                    comments,
                    indent: DanglingIndentMode::None
                }
            );
        }
        return write!(f, "}");
    }

    let is_conditional_or_binary = matches!(
        expression.as_ast_nodes(),
        AstNodes::ConditionalExpression(_) | AstNodes::LogicalExpression(_) | AstNodes::BinaryExpression(_)
    );
    let should_inline = !has_comment && (is_conditional_or_binary || should_inline_jsx_expression(expression));
    let format_expression = format_with(|f| match should_inline {
        true => write!(f, expression),
        false => write!(f, format_indented),
    });
    write!(f, group(&format_args!("{", format_expression, line_suffix_boundary(), "}")));
}

/// Prettier's `shouldInline` in `printJsxExpressionContainer`: it starts right after the `{` and
/// ends right before the `}`, even if it breaks.
pub(crate) fn should_inline_jsx_expression(expression: Expr<'_>) -> bool {
    fn is_inlined(node: AstNodes<'_>) -> bool {
        matches!(
            node,
            AstNodes::ArrayExpression(_)
                | AstNodes::ObjectExpression(_)
                | AstNodes::ArrowFunctionExpression(_)
                | AstNodes::CallExpression(_)
                | AstNodes::ImportExpression(_)
                | AstNodes::MetaProperty(_)
                | AstNodes::Function(_)
                | AstNodes::TemplateLiteral(_)
                | AstNodes::TaggedTemplateExpression(_)
        )
    }
    match expression.as_ast_nodes() {
        AstNodes::ChainExpression(chain) => matches!(chain.kind(), ExprKind::Call(_)),
        AstNodes::AwaitExpression(it) => it.argument().is_some_and(|argument| {
            let node = argument.as_ast_nodes();
            is_inlined(node) || matches!(node, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_))
        }),
        node => is_inlined(node),
    }
}

/// `a="b"`, `a={b}`, `a`, `{...a}`
pub(crate) fn write_jsx_attribute<'a>(attribute: Prop<'a>, f: &mut Formatter<'a>) {
    if attribute.kind() == PropKind::Spread {
        if let Some(argument) = attribute.value() {
            write_jsx_spread(argument, attribute.span(), f);
        }
        return;
    }
    if let Some(key) = attribute.key() {
        let span = key.span(f.file());
        format_node(span, || AstNodes::JSXAttribute(attribute), f, |f| {
            write!(f, text_without_whitespace(f.source_text().text_for(&span)));
        });
    }
    if let Some(value) = attribute.value() {
        write!(f, ["=", FormatJsxChild(value)]);
    }
}

/// `{...argument}`. `span`: of the braces.
fn write_jsx_spread<'a>(argument: Expr<'a>, span: Span, f: &mut Formatter<'a>) {
    let has_comment = !f.is_quiet()
        && (f.comments().has_comment_before(argument.span().start)
            || f.comments().has_comment_in_range(argument.span().end, span.end));
    let format_inner = format_args!(format_leading_comments(argument.span()), "...", argument);
    write!(f, "{");
    match has_comment {
        true => write!(f, soft_block_indent(&format_inner)),
        false => write!(f, format_inner),
    }
    write!(f, "}");
}

/// `{...e}` among the children of an element. `e`: the `Spread`.
pub(crate) fn write_jsx_spread_child<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if let ExprKind::Spread(argument) = e.kind() {
        write_jsx_spread(argument, AstNodes::JSXSpreadChild(e).span(), f);
    }
}

/// Text that is written by itself. That among the children of an element is written word by word:
/// see `child_list.rs`.
pub(crate) fn write_jsx_text<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, text(e.text()));
}
