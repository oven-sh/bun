//! `/** @type {T} */ (e)`: a type cast in the Closure Compiler and in TypeScript's JavaScript support. It's only a cast
//! with the parentheses, so they stay: Prettier keeps the `ParenthesizedExpression` that Babel has for them. Layout
//! code that checks an expression's kind sees that node and not its content, so it calls [`is_cast_target`].

use super::suppressed::FormatSuppressedNode;
use crate::js::comments::OwnedComments;
use crate::js::print::jsx::ignored_jsx_gets_no_parentheses;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// True if `e` is in parentheses that stay.
#[inline]
pub(crate) fn is_cast_target<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.comments().has_type_cast_comments()
        && e.is_parenthesized()
        && !cast_parentheses(e, f).is_empty()
}

/// The same, for the places where only Prettier sees the parentheses as the node. oxfmt looks inside them: in the
/// argument of `return` and `throw`, in a branch of a conditional expression, in the object of a member access.
#[inline]
pub(crate) fn is_cast_target_that_hides_its_kind<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    is_cast_target(e, f) && !f.options().flavor.is_oxfmt()
}

/// The parentheses around `e` that stay, outermost first.
pub(crate) fn cast_parentheses<'a>(e: Expr<'a>, f: &Formatter<'a>) -> SmallVec<[Span; 2]> {
    e.parens()
        .rev()
        .filter(|it| f.comments().is_cast_parenthesis(it.start))
        .collect()
}

/// The comments printed before and after `e`. If `e` is in type cast parentheses, they're the outermost
/// `ParenthesizedExpression`'s. If `e` is an optional chain, they're the member access's or the call's, even where
/// Prettier has a `ChainExpression` around that. For Prettier's `hasComment(node)`, use [`comments_of_outermost_node`].
pub(crate) fn comments_of_expression<'a>(e: Expr<'a>, f: &Formatter<'a>) -> OwnedComments<'a> {
    if f.comments().has_type_cast_comments()
        && e.is_parenthesized()
        && let Some(outermost) = cast_parentheses(e, f).first()
    {
        return f.comments().of_cast_parens(outermost.start);
    }
    f.comments().of_node(e.as_chain_element())
}

/// typescript-estree wraps an optional chain in a `ChainExpression`. Prettier attaches comments to the member access or
/// the call in it, so `hasComment(node)` is false for the node that corresponds to `e`. In oxfmt the comments count as
/// `e`'s.
pub(crate) fn is_chain_expression_without_comments<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    e.is_chain_root()
        && !f.context().has_babel_tree()
        && !f.options().flavor.is_oxfmt()
        && !is_cast_target(e, f)
}

/// Prettier's `hasComment(node)`.
///
/// This and the functions below can be called for the expression that's being printed. Its leading and trailing
/// comments are outside it, so [`Formatter::is_quiet`] doesn't cover them.
pub(crate) fn has_comments<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    !comments_of_outermost_node(e, f).is_empty()
}

/// `node.comments` of the node that Prettier has in place of `e`. The same as [`comments_of_expression`], except for an
/// optional chain with typescript-estree: the node is then a `ChainExpression`, which has no comments.
pub(crate) fn comments_of_outermost_node<'a>(e: Expr<'a>, f: &Formatter<'a>) -> OwnedComments<'a> {
    match is_chain_expression_without_comments(e, f) {
        true => OwnedComments::NONE,
        false => comments_of_expression(e, f),
    }
}

/// `!a(/* comment */)`: the comment is inside `a()`. To Prettier `a()` has a comment. oxfmt only looks at the comments
/// before and after it.
fn comments_inside_count(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// Prettier's `hasComment(node)`, where oxfmt checks less: see [`comments_inside_count`].
pub(crate) fn has_comments_that_count<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let comments = comments_of_outermost_node(e, f);
    !comments.leading.is_empty()
        || !comments.trailing.is_empty()
        || (!comments.dangling.is_empty() && comments_inside_count(f))
}

/// Prettier's `hasLeadingOwnLineComment`: true if a leading comment of `e` is the last thing on its line. A JSX element
/// wraps its own comments in parentheses, unless it's ignored.
pub(crate) fn has_leading_own_line_comment<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    if e.tag() == ExprTag::Jsx && !is_cast_target(e, f) {
        return ignored_jsx_gets_no_parentheses(f) && f.comments().is_ignored(e.as_ast_nodes());
    }
    let comments = comments_of_outermost_node(e, f).leading;
    comments.iter().any(|comment| comment.has_newline_after())
}

/// If `e` is in parentheses that stay, prints them with the comments they own, and `e` inside them with `write_target`.
/// Returns true if it did.
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

/// Prettier's `ParenthesizedExpression`s around `target`, outermost first, each with the comments it owns.
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
        // The parentheses inside aren't printed through `Expr`, so the stack check has to happen here.
        if !f.context_mut().has_stack_left() {
            return;
        }
        let skip_trailing = f.context_mut().take_skip_trailing_comments();
        let owned = f.comments().of_cast_parens(span.start);
        FormatLeadingComments::Comments(owned.leading).fmt(f);
        if owned.is_ignored {
            FormatSuppressedNode(span).fmt(f);
        } else {
            self.write_parentheses(inner, f);
        }
        if !skip_trailing {
            FormatTrailingComments::Comments(owned.trailing).fmt(f);
        }
    }
}

impl<'a> FormatParenthesizedExpression<'a, '_> {
    fn write_parentheses(&self, inner: &[Span], f: &mut Formatter<'a>) {
        let comments = f.comments().of_node(self.target.as_chain_element());
        let hugs = inner.is_empty()
            && matches!(self.target.kind(), ExprKind::Object(_) | ExprKind::Array(_))
            && comments.is_empty();
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
