//! JSX. Prettier's `print/jsx.js`.

mod child_list;
mod element;
mod opening_element;

use self::element::AnyJsxTagWithChildren;
pub(crate) use self::element::ignored_jsx_gets_no_parentheses;
use crate::js::format::{ExprOptions, format_name, format_node, identifier, write_expression};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::tailwindcss::{InTailwindContext, context_of_attribute};
use crate::js::utils::typecast::{comments_of_expression, has_comments_that_count, is_cast_target};
use crate::prelude::*;
use crate::{format_args, write};

/// `<a>b</a>`, `<a />`, `<>b</>`
pub(crate) fn write_jsx_element<'a>(e: Expr<'a>, jsx: Jsx<'a>, f: &mut Formatter<'a>) {
    AnyJsxTagWithChildren { expr: e, jsx }.fmt(f);
}

/// A tag name: `a`, `a.b`, `a-b`, `a:b`.
struct FormatJsxName<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatJsxName<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let name = self.0;
        format_node(name.as_ast_nodes(), f, |f| match name.kind() {
            // The object isn't printed through `Expr`, so the stack check has to happen here.
            ExprKind::Dot { .. } if !f.context_mut().has_stack_left() => {}
            ExprKind::Dot {
                obj,
                name: property,
                ..
            } => write!(f, [FormatJsxName(obj), ".", identifier(property)]),
            _ => write_jsx_identifier(name.span(), f),
        });
    }
}

/// `a`, `a-b`, `a:b`, with the names' comments.
fn write_jsx_identifier<'a>(span: Span, f: &mut Formatter<'a>) {
    let text = f.source_text().text_for(&span);
    let is_part =
        |b: &&u8| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'-') || **b >= 0x80;
    let namespace_len = text.iter().take_while(is_part).count() as u32;
    if namespace_len == span.len() {
        return format_name(span, f, |f| write!(f, text_without_whitespace(text)));
    }
    let namespace = Span::new(span.start, span.start + namespace_len);
    let name = Span::new(
        span.end - text.iter().rev().take_while(is_part).count() as u32,
        span.end,
    );
    format_name(namespace, f, |f| write!(f, source_text(namespace)));
    write!(f, ":");
    format_name(name, f, |f| write!(f, source_text(name)));
}

/// `</a>`. Prettier's `printJsxClosingElement`.
fn write_jsx_closing_element<'a>(name: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return write!(f, ["</", FormatJsxName(name), ">"]);
    }
    let leading_comments = f.comments().of_node(name.as_ast_nodes()).leading;
    let name = FormatJsxName(name);
    write!(f, "</");
    if leading_comments.iter().any(|comment| comment.is_line()) {
        write!(
            f,
            [
                indent(&format_args!(hard_line_break(), name)),
                hard_line_break()
            ]
        );
    } else {
        write!(f, [(!leading_comments.is_empty()).then_some(space()), name]);
    }
    write!(f, ">");
}

/// Prettier leaves `< /* prettier-ignore */ >` as is. oxfmt prints `</* prettier-ignore */>`.
fn ignore_comment_applies_to_fragment_tag(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `<>` or `</>` at `tag`, with the `comments` inside the tag. Prettier's `printJsxOpeningClosingFragment`.
fn write_jsx_fragment_tag<'a>(
    tag: Span,
    comments: CommentList<'a>,
    is_closing: bool,
    f: &mut Formatter<'a>,
) {
    let open = if is_closing { "</" } else { "<" };
    if comments.is_empty() {
        return write!(f, [open, ">"]);
    }
    if ignore_comment_applies_to_fragment_tag(f)
        && (comments.iter()).any(|comment| f.comments().is_suppression_comment(comment))
    {
        return write!(f, FormatSuppressedNode(tag));
    }
    let has_line_comment = comments.iter().any(|comment| comment.is_line());
    let format_comments = format_with(|f| {
        if has_line_comment {
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
            has_line_comment.then_some(hard_line_break()),
            ">"
        ]
    );
}

/// An element's child or an attribute's value: text, an element, `{e}`, `{...e}`.
#[derive(Copy, Clone)]
pub(crate) struct FormatJsxChild<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatJsxChild<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let e = self.0;
        if e.jsx_container_span().is_none() {
            return e.fmt(f);
        }
        match e.kind() {
            ExprKind::Spread(argument) => {
                format_node(AstNodes::JSXSpreadChild(e), f, |f| {
                    write_jsx_spread(argument, f)
                });
            }
            _ => {
                let node = AstNodes::JSXExpressionContainer(e);
                format_node(node, f, |f| {
                    write_jsx_expression_container(e, node.parent(), f)
                });
            }
        }
    }
}

impl Spanned for FormatJsxChild<'_> {
    fn span(&self) -> Span {
        self.0.jsx_container_span().unwrap_or_else(|| self.0.span())
    }
}

/// `{e}`. Prettier's `printJsxExpressionContainer`.
fn write_jsx_expression_container<'a>(
    expression: Expr<'a>,
    parent: AstNodes<'a>,
    f: &mut Formatter<'a>,
) {
    if matches!(expression.kind(), ExprKind::Missing) {
        return write!(
            f,
            group(&format_args!(
                "{",
                FormatJsxEmptyExpression(expression),
                line_suffix_boundary(),
                "}"
            ))
        );
    }
    let is_child = matches!(parent, AstNodes::JSXElement(_) | AstNodes::JSXFragment(_));
    match should_inline_jsx_expression(expression, is_child, f) {
        true => write!(
            f,
            group(&format_args!("{", expression, line_suffix_boundary(), "}"))
        ),
        false => write!(
            f,
            group(&format_args!(
                "{",
                soft_block_indent(&expression),
                line_suffix_boundary(),
                "}"
            ))
        ),
    }
}

/// The content of the braces in `{/* comment */}`. Prettier's `printJsxEmptyExpression`.
struct FormatJsxEmptyExpression<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatJsxEmptyExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let comments = (f.comments()).of_node(AstNodes::JSXEmptyExpression(self.0));
        // `{   /* prettier-ignore */   }`: in Prettier the comment also applies to the `JSXEmptyExpression` that owns
        // it, which is everything between the braces, so the whitespace stays.
        if comments.is_ignored
            && let Some(braces) = self.0.jsx_container_span()
        {
            return write!(
                f,
                FormatSuppressedNode(Span::new(braces.start + 1, braces.end - 1))
            );
        }
        let comments = comments.dangling;
        let indent = match comments.iter().any(|comment| comment.is_line()) {
            true => DanglingIndentMode::Block,
            false => DanglingIndentMode::None,
        };
        write!(f, FormatDanglingComments::Comments { comments, indent });
    }
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
/// Prettier is on the left, oxfmt on the right. See [`has_comments_that_count`].
fn has_comments_in_braces<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    !f.is_quiet() && has_comments_that_count(expression, f)
}

/// Prettier's `shouldInline` in `printJsxExpressionContainer`: the expression starts right after the `{` and ends right
/// before the `}`, even if it breaks. `is_child` means the braces are a child of an element.
fn should_inline_jsx_expression<'a>(
    mut expression: Expr<'a>,
    mut is_child: bool,
    f: &Formatter<'a>,
) -> bool {
    loop {
        if has_comments_in_braces(expression, f) || is_cast_target(expression, f) {
            return false;
        }
        match expression.as_ast_nodes() {
            AstNodes::ArrayExpression(_)
            | AstNodes::ObjectExpression(_)
            | AstNodes::ArrowFunctionExpression(_)
            | AstNodes::Function(_)
            | AstNodes::TemplateLiteral(_)
            | AstNodes::TaggedTemplateExpression(_) => return true,
            AstNodes::AwaitExpression(it) => match it.argument() {
                Some(argument) if matches!(argument.as_ast_nodes(), AstNodes::JSXElement(_)) => {
                    return true;
                }
                Some(argument) => (expression, is_child) = (argument, false),
                None => return false,
            },
            AstNodes::ConditionalExpression(_)
            | AstNodes::LogicalExpression(_)
            | AstNodes::BinaryExpression(_)
            | AstNodes::PrivateInExpression(_) => return is_child,
            _ => {
                // Prettier's `stripChainElementWrappers`
                let mut callee = expression;
                while let ExprKind::NonNull(inner) = callee.kind() {
                    callee = inner;
                }
                return matches!(callee.as_chain_element(), AstNodes::CallExpression(_));
            }
        }
    }
}

/// `a="b"`, `a={b}`, `a`, `{...a}`
pub(crate) fn write_jsx_attribute<'a>(attribute: Prop<'a>, f: &mut Formatter<'a>) {
    if attribute.kind() == PropKind::Spread {
        if let Some(argument) = attribute.value() {
            write_jsx_spread(argument, f);
        }
        return;
    }
    if let Some(key) = attribute.key() {
        let span = key.span(f.file());
        write_jsx_identifier(span, f);
    }
    if let Some(value) = attribute.value() {
        let context = attribute
            .key()
            .and_then(|key| context_of_attribute(f.source_text().text_for(&key.span(f.file())), f));
        write!(
            f,
            [
                "=",
                InTailwindContext(context, FormatJsxAttributeValue(value))
            ]
        );
    }
}

/// Prettier prints `a=/* prettier-ignore */ 'b'` as `a=/* prettier-ignore */ "b"`: `printJsxAttribute` prints a string
/// itself, ignored or not. oxfmt copies it.
fn formats_ignored_attribute_string(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `"b"`, `{b}` or `<b />` after an attribute's `=`.
struct FormatJsxAttributeValue<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatJsxAttributeValue<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let value = self.0;
        if f.is_quiet() || value.jsx_container_span().is_some() {
            return FormatJsxChild(value).fmt(f);
        }
        let node = value.as_ast_nodes();
        if !matches!(node, AstNodes::StringLiteral(_))
            || !f.comments().is_ignored(node)
            || !formats_ignored_attribute_string(f)
        {
            return FormatJsxChild(value).fmt(f);
        }
        write!(f, leading_comments(node));
        write_expression(value, ExprOptions::None, f);
        write!(f, trailing_comments(node));
    }
}

/// `{...argument}`. Prettier's `printJsxSpreadAttributeOrChild`: the argument's comments are printed before the dots.
fn write_jsx_spread<'a>(argument: Expr<'a>, f: &mut Formatter<'a>) {
    if !has_comments_in_braces(argument, f) {
        return write!(f, ["{...", argument, "}"]);
    }
    let comments = comments_of_expression(argument, f);
    // `{⏎// prettier-ignore⏎...a⏎// comment⏎.b}`: a leading comment can be inside the argument. An ignored argument is
    // copied along with it.
    let leading_comments = match comments.is_ignored {
        true => {
            let count_before_argument = (comments.leading.iter())
                .take_while(|comment| comment.span().start < argument.span().start)
                .count();
            comments.leading.slice(0, count_before_argument)
        }
        false => comments.leading,
    };
    write!(
        f,
        [
            "{",
            soft_block_indent(&format_args!(
                FormatLeadingComments::Comments(leading_comments),
                "...", argument
            )),
            "}"
        ]
    );
}

/// `{...e}` as a child of an element. `e` is the `Spread`.
#[inline(never)]
pub(crate) fn write_jsx_spread_child<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if let ExprKind::Spread(argument) = e.kind() {
        write_jsx_spread(argument, f);
    }
}

/// Text that's printed as a whole. Text among an element's children is printed word by word in `child_list.rs`.
pub(crate) fn write_jsx_text<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, text(e.text()));
}
