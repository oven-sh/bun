use crate::js::format::{identifier, write_trailing_comments_of};
use crate::js::print::call_like_expression::arguments::FormatArguments;
use crate::js::print::type_parameters::type_arguments;
use crate::prelude::*;
use crate::{format_args, write};

#[derive(Copy, Clone, Debug)]
pub(crate) enum CallExpressionPosition {
    /// The `a()` of `a().b`
    Start,
    /// The `b()` of `a.b().c()`
    Middle,
    /// The `c()` of `a.b.c()`: the root
    End,
}

/// A link of a chain of member accesses and calls. Only what the link adds to its object or its
/// callee is written for it.
#[derive(Copy, Clone, Debug)]
pub(crate) enum ChainMember<'a> {
    /// `.b`
    StaticMember(Expr<'a>),
    /// `(..)`
    CallExpression {
        expression: Expr<'a>,
        position: CallExpressionPosition,
    },
    /// `[b]`
    ComputedMember(Expr<'a>),
    /// `!`
    TSNonNullExpression(Expr<'a>),
    /// What the chain starts with.
    Node(Expr<'a>),
}

impl<'a> ChainMember<'a> {
    pub(crate) const fn is_call_expression(&self) -> bool {
        matches!(self, Self::CallExpression { .. })
    }

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

/// `?.`, the type arguments and the arguments of a call.
fn write_call_without_callee<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) {
    let ExprKind::Call(call) = expression.kind() else {
        return;
    };
    write!(
        f,
        [
            call.is_optional().then_some("?."),
            type_arguments(call.type_args(), Node::Expr(expression)),
            FormatArguments::of_call(expression, call)
        ]
    );
}

impl<'a> Format<'a> for ChainMember<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::StaticMember(member) => {
                let ExprKind::Dot { name, .. } = member.kind() else {
                    return;
                };
                write!(
                    f,
                    [
                        FormatLeadingComments::Comments(f.comments().comments_before(name.start())),
                        member.is_optional().then_some("?"),
                        ".",
                        identifier(name, AstNodes::StaticMemberExpression(member))
                    ]
                );
                if f.is_quiet() {
                    return;
                }
                // `a.b /* comment */ (c)` is `a.b(/* comment */ c)`
                let node = member.as_chain_element();
                let is_plain_callee = matches!(
                    node.parent(),
                    AstNodes::CallExpression(parent)
                        if parent.call().is_some_and(|call| call.type_args().is_empty() && !call.is_optional())
                );
                if !is_plain_callee {
                    write_trailing_comments_of(node, f);
                }
            }
            Self::TSNonNullExpression(e) => {
                write!(f, [format_leading_comments(e.span()), "!"]);
                write_trailing_comments_of(e.as_chain_element(), f);
            }
            Self::CallExpression {
                expression,
                position,
            } => match position {
                CallExpressionPosition::Start => write!(f, expression),
                CallExpressionPosition::Middle => {
                    format_leading_comments(expression.span()).fmt(f);
                    write_call_without_callee(expression, f);
                    write_trailing_comments_of(expression.as_chain_element(), f);
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
                write_trailing_comments_of(member.as_chain_element(), f);
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
        if !f.is_quiet() {
            let comments = f.comments().comments_before_character(member.span().start, b'[');
            if !comments.is_empty() {
                write!(f, [soft_line_break(), FormatLeadingComments::Comments(comments)]);
            }
        }

        let optional = member.is_optional().then_some("?.");
        if matches!(index.kind(), ExprKind::Number(_)) && !f.comments().has_comment_before(member.span().end) {
            write!(f, [optional, "[", index, "]"]);
        } else {
            write!(f, group(&format_args!(optional, "[", soft_block_indent(&index), "]")));
        }
    }
}
