//! JSX. Prettier's `print/jsx.js`.

mod child_list;
mod element;
mod opening_element;

use self::element::AnyJsxTagWithChildren;
pub(crate) use self::element::ignored_jsx_gets_no_parentheses;
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
        format_node(
            name.span(),
            || self.parent,
            f,
            |f| match name.kind() {
                ExprKind::Dot { .. } if !f.context_mut().has_stack_left() => {}
                ExprKind::Dot {
                    obj,
                    name: property,
                    ..
                } => write!(
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
                _ => write_jsx_identifier(name.span(), f),
            },
        );
    }
}

/// `a`, `a-b`, `a:b`
fn write_jsx_identifier<'a>(span: Span, f: &mut Formatter<'a>) {
    let text = f.source_text().text_for(&span);
    let is_part =
        |b: &&u8| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'-') || **b >= 0x80;
    let namespace_len = text.iter().take_while(is_part).count() as u32;
    if namespace_len == span.len() {
        return write!(f, text_without_whitespace(text));
    }
    let namespace = Span::new(span.start, span.start + namespace_len);
    let name = Span::new(
        span.end - text.iter().rev().take_while(is_part).count() as u32,
        span.end,
    );
    let comments_before_colon = f.comments().comments_before_character(namespace.end, b':');
    write!(
        f,
        [
            source_text(namespace),
            FormatTrailingComments::Comments(comments_before_colon),
            ":"
        ]
    );
    let comments_after_colon = f.comments().comments_before(name.start);
    write!(
        f,
        [
            FormatLeadingComments::Comments(comments_after_colon),
            source_text(name)
        ]
    );
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
        write!(
            f,
            [hard_line_break(), block_indent(&name), hard_line_break()]
        );
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
    write!(
        f,
        [
            open,
            indent(&format_comments),
            has_own_line_comment.then_some(hard_line_break()),
            ">"
        ]
    );
}

/// A child of an element, or the value of an attribute: text, an element, `{e}`, `{...e}`.
#[derive(Copy, Clone)]
pub(crate) struct FormatJsxChild<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatJsxChild<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let e = self.0;
        let Some(span) = e.jsx_container_span() else {
            return e.fmt(f);
        };
        match e.kind() {
            ExprKind::Spread(argument) => {
                format_node(
                    span,
                    || AstNodes::JSXSpreadChild(e).parent(),
                    f,
                    |f| write_jsx_spread(argument, span, f),
                );
            }
            _ => {
                let node = AstNodes::JSXExpressionContainer(e);
                format_node(
                    span,
                    || node.parent(),
                    f,
                    |f| write_jsx_expression_container(e, span, node.parent(), f),
                );
            }
        }
    }
}

impl Spanned for FormatJsxChild<'_> {
    fn span(&self) -> Span {
        self.0.jsx_container_span().unwrap_or_else(|| self.0.span())
    }
}

/// `{e}`. `span`: of the braces.
fn write_jsx_expression_container<'a>(
    expression: Expr<'a>,
    span: Span,
    parent: AstNodes<'a>,
    f: &mut Formatter<'a>,
) {
    if matches!(expression.kind(), ExprKind::Missing) {
        // `{/* comment */}`
        let comments = f.comments().comments_before(span.end);
        let has_line_comment = comments.iter().any(|c| c.is_line());
        let indent = if has_line_comment {
            DanglingIndentMode::Block
        } else {
            DanglingIndentMode::None
        };
        return write!(
            f,
            group(&format_args!(
                "{",
                FormatDanglingComments::Comments { comments, indent },
                line_suffix_boundary(),
                "}"
            ))
        );
    }

    let has_comment = !f.is_quiet()
        && (f.comments().has_comment_before(expression.span().start)
            || f.comments()
                .has_comment_in_range(expression.span().end, span.end)
            || (has_only_comments(expression, f) && comments_alone_in_braces_are_not_hugged(f)));
    let is_child = matches!(parent, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_));
    if !has_comment && should_inline_jsx_expression(expression, is_child) {
        return write!(
            f,
            group(&format_args!("{", expression, line_suffix_boundary(), "}"))
        );
    }

    let format_with_comments = format_with(|f| {
        write!(f, expression);
        let comments = f.comments().comments_before(span.end);
        write!(f, FormatTrailingComments::Comments(comments));
    });
    write!(
        f,
        group(&format_args!(
            "{",
            soft_block_indent(&format_with_comments),
            line_suffix_boundary(),
            "}"
        ))
    );
}

/// `{}`, `[]` or the `()` of a call with nothing but comments in it, which are comments of `expression` for Prettier.
fn has_only_comments<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    let empty = match expression.kind() {
        ExprKind::Object(properties) if properties.is_empty() => expression.span(),
        ExprKind::Array(elements) if elements.is_empty() => expression.span(),
        ExprKind::Call(call) | ExprKind::New(call) if call.args().is_empty() => {
            Span::after(call.callee().outer_span(), expression.span().end)
        }
        _ => return false,
    };
    f.comments().has_comment_in_span(empty)
}

/// ```jsx
/// <a                 <a
///   b={                b={{
///     {                  // comment
///       // comment     }}
///     }              />
///   }
/// />
/// ```
///
/// Prettier on the left, oxfmt on the right.
fn comments_alone_in_braces_are_not_hugged(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// Prettier's `shouldInline` in `printJsxExpressionContainer`: it starts right after the `{` and
/// ends right before the `}`, even if it breaks. `is_child`: the braces are among the children of
/// an element.
fn should_inline_jsx_expression(expression: Expr<'_>, is_child: bool) -> bool {
    match expression.as_ast_nodes() {
        AstNodes::ArrayExpression(_)
        | AstNodes::ObjectExpression(_)
        | AstNodes::ArrowFunctionExpression(_)
        | AstNodes::Function(_)
        | AstNodes::TemplateLiteral(_)
        | AstNodes::TaggedTemplateExpression(_) => true,
        AstNodes::AwaitExpression(it) => it.argument().is_some_and(|argument| {
            should_inline_jsx_expression(argument, false)
                || matches!(argument.as_ast_nodes(), AstNodes::JSXElement(_))
        }),
        AstNodes::ConditionalExpression(_)
        | AstNodes::LogicalExpression(_)
        | AstNodes::BinaryExpression(_)
        | AstNodes::PrivateInExpression(_) => is_child,
        _ => {
            // Prettier's `stripChainElementWrappers`
            let mut callee = expression;
            while let ExprKind::NonNull(inner) = callee.kind() {
                callee = inner;
            }
            matches!(callee.as_chain_element(), AstNodes::CallExpression(_))
        }
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
        format_node(
            span,
            || AstNodes::JSXAttribute(attribute),
            f,
            |f| write_jsx_identifier(span, f),
        );
    }
    if let Some(value) = attribute.value() {
        write!(f, ["=", FormatJsxChild(value)]);
    }
}

/// `{...argument}`. `span`: of the braces.
fn write_jsx_spread<'a>(argument: Expr<'a>, span: Span, f: &mut Formatter<'a>) {
    let has_comment = !f.is_quiet()
        && (f.comments().has_comment_before(argument.span().start)
            || f.comments()
                .has_comment_in_range(argument.span().end, span.end));
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
