use crate::js::format::{FormatNonNullMarks, identifier, write_trailing_comments_of};
use crate::js::print::call_like_expression::FormatTypeArguments;
use crate::js::print::call_like_expression::arguments::FormatArguments;
use crate::js::print::member_expression::write_lookup_without_comments;
use crate::js::utils::call_expression::callee_trailing_comments;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::{format_args, write};

#[derive(Copy, Clone, Debug)]
pub(crate) enum CallExpressionPosition {
    /// The `b()` of `a.b().c()`
    Middle,
    /// The `c()` of `a.b.c()`: the root
    End,
}

/// A link of a chain of member accesses and calls. Only what the link adds to its object or its
/// callee is written for it.
#[derive(Copy, Clone, Debug)]
pub(crate) enum ChainMember<'a> {
    /// `.b`, `.#b`
    StaticMember(Expr<'a>),
    /// `(..)`
    CallExpression {
        expression: Expr<'a>,
        position: CallExpressionPosition,
    },
    /// `[b]`
    ComputedMember(Expr<'a>),
    /// `!`, `!!`
    TSNonNullExpression(Expr<'a>),
    /// What the chain starts with.
    Node(Expr<'a>),
}

impl<'a> ChainMember<'a> {
    pub(crate) const fn is_computed_expression(&self) -> bool {
        matches!(self, Self::ComputedMember(_))
    }

    pub(crate) fn expr(&self) -> Expr<'a> {
        match *self {
            Self::StaticMember(e)
            | Self::TSNonNullExpression(e)
            | Self::CallExpression { expression: e, .. }
            | Self::ComputedMember(e)
            | Self::Node(e) => e,
        }
    }
}

/// The call that `callee` is the callee of.
pub(super) fn call_of_callee(callee: Expr<'_>) -> Option<Call<'_>> {
    match callee.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Call(call) if call.callee() == callee => Some(call),
            _ => None,
        },
        _ => None,
    }
}

/// The comments behind a link of the chain.
fn write_trailing_comments_of_member<'a>(member: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    match call_of_callee(member) {
        Some(call) => {
            let comments = callee_trailing_comments(call, member.span().end, f);
            write!(f, FormatTrailingComments::Comments(comments));
        }
        None => write_trailing_comments_of(member.as_chain_element(), f),
    }
}

/// `?.`, the type arguments and the arguments of a call.
fn write_call_without_callee<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(call) = expression.call().filter(|_| expression.tag() == ExprTag::Call) else {
        return;
    };
    write!(
        f,
        [
            call.is_optional().then_some("?."),
            FormatTypeArguments(expression, call),
            FormatArguments::of_call(expression, call)
        ]
    );
}

/// `(// comment\n a.b()).c()`: whether the next comment is in the parentheses of a later link than
/// `link`, which starts at the same place. It leads that one, and is written before its `()`.
pub(super) fn comments_lead_a_later_link<'a>(link: Expr<'a>, f: &Formatter<'a>) -> bool {
    let Some(first) = f.comments().comments_before(link.span().start).first() else {
        return false;
    };
    let mut e = link;
    loop {
        if let Some(parentheses) = e.parens().next() {
            return e != link && first.span.start > parentheses.start;
        }
        e = match e.parent() {
            Node::Expr(parent)
                if parent.object() == Some(e)
                    || matches!(parent.kind(), ExprKind::Call(call) if call.callee() == e)
                    || matches!(parent.kind(), ExprKind::NonNull(it) if it == e) =>
            {
                parent
            }
            _ => return false,
        };
    }
}

impl<'a> Format<'a> for ChainMember<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() || !comments_lead_a_later_link(self.expr(), f) {
            return self.write(f);
        }
        // No comment is seen while this link is written.
        let previous_limit = f.comments_mut().limit_comments_up_to(0);
        self.write(f);
        f.comments_mut().restore_view_limit(previous_limit);
    }
}

impl<'a> ChainMember<'a> {
    fn write(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::StaticMember(member) => {
                if f.is_quiet() {
                    return write_lookup_without_comments(member, f);
                }
                let ExprKind::Dot { obj, name, .. } = member.kind() else {
                    return;
                };
                let lookup =
                    format_args!(member.is_optional().then_some("?"), ".", identifier(name, member.as_chain_element()));
                // The comments after the `.` lead the name.
                let object_end = obj.span().end;
                let end = f.comments().comments_before_character(object_end, b'.').last().map_or(object_end, |it| it.span.end);
                write!(f, [FormatLeadingComments::Comments(f.comments().comments_before(end)), lookup]);
                write_trailing_comments_of_member(member, f);
            }
            Self::TSNonNullExpression(e) => {
                write!(f, [format_leading_comments(e.span()), FormatNonNullMarks(e)]);
                write_trailing_comments_of_member(e, f);
            }
            Self::CallExpression {
                expression,
                position,
            } => match position {
                CallExpressionPosition::Middle => {
                    format_leading_comments(expression.span()).fmt(f);
                    write_call_without_callee(expression, f);
                    write_trailing_comments_of_member(expression, f);
                }
                CallExpressionPosition::End => write_call_without_callee(expression, f),
            },
            Self::ComputedMember(member) => {
                write!(
                    f,
                    [format_leading_comments(member.span()), FormatComputedMemberExpressionWithoutObject(member)]
                );
                write_trailing_comments_of_member(member, f);
            }
            Self::Node(node) if f.is_quiet() || call_of_callee(node).is_none() => write!(f, node),
            Self::Node(node) => {
                write!(f, FormatNodeWithoutTrailingComments(&node));
                write_trailing_comments_of_member(node, f);
            }
        }
    }
}

/// oxfmt writes `a[0 /* comment */]` like `a[b /* comment */]`, with a way to break after the `[`.
fn breaks_around_a_number_with_comments<'a>(member: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt() && f.comments().has_comment_before(member.span().end)
}

/// The `[b]` or `?.[b]` of `a[b]`.
pub(crate) struct FormatComputedMemberExpressionWithoutObject<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatComputedMemberExpressionWithoutObject<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let member = self.0;
        let ExprKind::Index { index, .. } = member.kind() else {
            return;
        };
        // A comment on its own line before the `[` leads what is in the brackets, unless that is a
        // name.
        if !f.is_quiet() && matches!(index.kind(), ExprKind::Ident(_)) {
            let comments = f.comments().comments_before_character(member.span().start, b'[');
            write!(f, FormatLeadingComments::Comments(comments));
        }

        let optional = member.is_optional().then_some("?.");
        if matches!(index.kind(), ExprKind::Number(_)) && !breaks_around_a_number_with_comments(member, f) {
            write!(f, [optional, "[", index, "]"]);
        } else {
            write!(f, group(&format_args!(optional, "[", soft_block_indent(&index), "]")));
        }
    }
}
