//! `/** @type {T} */ (e)`: a type cast of the Closure Compiler and of TypeScript in JavaScript. It
//! only is one with the parentheses, so they stay: Prettier keeps the `ParenthesizedExpression` that
//! Babel has for them. What looks at the kind of an expression to lay something out sees that node
//! and not what is in it: it asks [`is_cast_target`].

use super::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// Whether `e` is in parentheses that stay.
#[inline]
pub(crate) fn is_cast_target<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.comments().has_type_cast_comments()
        && e.is_parenthesized()
        && !cast_parentheses(e, f).is_empty()
}

/// The same, where only Prettier takes the parentheses for what is there. oxfmt looks at what is in them: in the
/// argument of `return` and `throw`, in a branch of a conditional expression, in the object of a member access.
#[inline]
pub(crate) fn is_cast_target_that_hides_its_kind<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    is_cast_target(e, f) && !f.options().flavor.is_oxfmt()
}

/// The parentheses around `e` that stay, from the outside in.
fn cast_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> SmallVec<[Span; 2]> {
    e.parens()
        .rev()
        .filter(|it| f.comments().is_cast_parenthesis(it.start))
        .collect()
}

/// If `e` is in parentheses that stay, writes them with the comments they own, and `e` in them with `write_target`.
/// Returns whether it has.
pub(crate) fn write_type_casts<'a>(
    e: Expr<'a>,
    f: &mut Formatter<'a>,
    write_target: &dyn Fn(&mut Formatter<'a>),
) -> bool {
    if !f.comments().has_type_cast_comments() || !e.is_parenthesized() {
        return false;
    }
    let parentheses = cast_parentheses(e, f);
    if parentheses.is_empty() {
        return false;
    }
    FormatParenthesizedExpression {
        target: e,
        parentheses: &parentheses,
        write_target,
    }
    .fmt(f);
    true
}

/// Prettier's `ParenthesizedExpression`s around `target`, from the outside in, each with the comments it owns.
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
        // The parentheses in it are not written by way of `Expr`.
        if !f.context_mut().has_stack_left() {
            return;
        }
        let skip_trailing = f.context_mut().take_skip_trailing_comments();
        let owned = f.comments().of_cast_parens(span.start);
        FormatLeadingComments::Comments(owned.leading).fmt(f);
        if owned.is_ignored {
            FormatSuppressedNode(span).fmt(f);
        } else {
            self.write_parentheses(span, inner, f);
        }
        if !skip_trailing {
            FormatTrailingComments::Comments(owned.trailing).fmt(f);
        }
    }
}

impl<'a> FormatParenthesizedExpression<'a, '_> {
    fn write_parentheses(&self, span: Span, inner: &[Span], f: &mut Formatter<'a>) {
        let target = self.target.span();
        let hugs = inner.is_empty()
            && matches!(self.target.kind(), ExprKind::Object(_) | ExprKind::Array(_))
            && f.comments()
                .comments_in_span(Span::before(span.start, target))
                .is_empty()
            && f.comments()
                .comments_in_span(Span::after(target, span.end))
                .is_empty();
        let content = FormatParenthesizedExpression {
            parentheses: inner,
            ..*self
        };
        match hugs {
            true => write!(f, ["(", content, ")"]),
            false => write!(
                f,
                group(&format_args!("(", soft_block_indent(&content), ")"))
            ),
        }
    }
}
