use crate::js::format::{FormatNonNullMarks, identifier, write_trailing_comments_of};
use crate::js::print::call_like_expression::FormatTypeArguments;
use crate::js::print::call_like_expression::arguments::FormatArguments;
use crate::js::utils::call_expression::callee_trailing_comments;
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

    pub(crate) fn span(&self) -> Span {
        self.expr().span()
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
    let ExprKind::Call(call) = expression.kind() else {
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

impl<'a> Format<'a> for ChainMember<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::StaticMember(member) => {
                let ExprKind::Dot { obj, name, .. } = member.kind() else {
                    return;
                };
                let lookup =
                    format_args!(member.is_optional().then_some("?"), ".", identifier(name, member.as_chain_element()));
                if f.is_quiet() {
                    return write!(f, lookup);
                }
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
                    [
                        line_suffix_boundary(),
                        format_leading_comments(member.span()),
                        FormatComputedMemberExpressionWithoutObject(member)
                    ]
                );
                write_trailing_comments_of_member(member, f);
            }
            Self::Node(node) => write!(f, node),
        }
    }
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
            if !comments.is_empty() {
                write!(f, [soft_line_break(), FormatLeadingComments::Comments(comments)]);
            }
        }

        let optional = member.is_optional().then_some("?.");
        if matches!(index.kind(), ExprKind::Number(_)) {
            write!(f, [optional, "[", index, "]"]);
        } else {
            write!(f, group(&format_args!(optional, "[", soft_block_indent(&index), "]")));
        }
    }
}
