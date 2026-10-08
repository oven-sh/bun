//! `/** @type {T} */ (e)`: a type cast of the Closure Compiler and of TypeScript in JavaScript. It
//! only is one with the parentheses, so they stay: Prettier keeps the `ParenthesizedExpression` that
//! Babel has for them. What looks at the kind of an expression to lay something out sees that node
//! and not what is in it: it asks [`is_cast_target`].

use super::suppressed::FormatSuppressedNode;
use crate::js::format::write_trailing_comments_of;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// Whether `e` is in parentheses that stay.
#[inline]
pub(crate) fn is_cast_target<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.comments().has_type_cast_comments() && e.is_parenthesized() && !cast_parentheses(e, f).is_empty()
}

/// The parentheses around `e` that stay, from the outside in.
fn cast_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> SmallVec<[Span; 2]> {
    e.parens().rev().filter(|it| f.comments().is_cast_parenthesis(it.start)).collect()
}

/// If `e` is in parentheses that stay, writes them with the comments around them, and `e` in them
/// with `write_target`. Returns whether it has.
///
/// `node`: `e`, or the `ChainExpression` around it.
pub(crate) fn write_type_casts<'a>(
    e: Expr<'a>,
    node: AstNodes<'a>,
    f: &mut Formatter<'a>,
    write_target: &dyn Fn(&mut Formatter<'a>),
) -> bool {
    if !f.comments().has_type_cast_comments() || !e.is_parenthesized() {
        return false;
    }
    let parentheses = cast_parentheses(e, f);
    let Some(&outermost) = parentheses.first() else {
        return false;
    };
    let is_suppressed =
        f.comments().is_suppressed(outermost.start) || f.comments().has_trailing_suppression_comment(outermost.end);
    write!(f, format_leading_comments(outermost));
    match is_suppressed {
        true => write!(f, FormatSuppressedNode(outermost)),
        false => write!(
            f,
            FormatParenthesizedExpression {
                target: e,
                parentheses: &parentheses,
                write_target,
            }
        ),
    }
    write_trailing_comments_of(node, f);
    true
}

/// Prettier's `ParenthesizedExpression`s around `target`, without the comments around the outermost.
struct FormatParenthesizedExpression<'a, 'b> {
    target: Expr<'a>,
    parentheses: &'b [Span],
    write_target: &'b dyn Fn(&mut Formatter<'a>),
}

impl<'a> Format<'a> for FormatParenthesizedExpression<'a, '_> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let Some((&span, inner)) = self.parentheses.split_first() else {
            return (self.write_target)(f);
        };
        // The comments in the parentheses are written in them, also where those after the
        // expression are left to somebody else.
        let previous_limit = f.comments_mut().show_comments_up_to(span.end);
        let target = self.target.span();
        let hugs = inner.is_empty()
            && matches!(self.target.kind(), ExprKind::Object(_) | ExprKind::Array(_))
            && !f.comments().has_comment_in_range(span.start, target.start)
            && !f.comments().has_comment_in_range(target.end, span.end);
        let content = format_with(|f| {
            if let Some(&next) = inner.first() {
                write!(f, format_leading_comments(next));
            }
            let expression = FormatParenthesizedExpression {
                parentheses: inner,
                ..*self
            };
            write!(f, expression);
            // Nothing follows the expression in here, so whatever is left trails it.
            let comments = f.comments().comments_before(span.end);
            write!(f, FormatTrailingComments::Comments(comments));
        });
        match hugs {
            true => write!(f, ["(", content, ")"]),
            false => write!(f, group(&format_args!("(", soft_block_indent(&content), ")"))),
        }
        f.comments_mut().restore_view_limit(previous_limit);
    }
}
