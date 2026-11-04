use crate::js::comments::OwnedComments;
use crate::js::format::FormatNonNullMarks;
use crate::js::print::call_like_expression::arguments::FormatArguments;
use crate::js::print::member_expression::{
    comments_in_member_access_stay, write_lookup, write_lookup_after_its_comments,
};
use crate::js::print::type_parameters::type_arguments;
use crate::js::utils::call_expression::{
    FormatCallee, keeps_comments_after_callee, write_comments_after_callee,
};
use crate::js::utils::typecast::{comments_of_outermost_node, has_comments};
use crate::prelude::*;
use crate::{format_args, write};

#[derive(Copy, Clone, Debug)]
pub(crate) enum CallExpressionPosition {
    /// The `b()` in `a.b().c()`
    Middle,
    /// The `c()` in `a.b.c()`: the root
    End,
}

/// A link in a chain of member accesses and calls. Only what the link adds to its object or callee is printed for it.
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
    /// The head of the chain.
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

    /// The comments attached to the node that Prettier's `printedNodes` has for the link.
    pub(super) fn comments(&self, f: &Formatter<'a>) -> OwnedComments<'a> {
        match *self {
            Self::Node(node) => comments_of_outermost_node(node, f),
            _ => f.comments().of_node(self.expr().as_chain_element()),
        }
    }

    /// The comments that are printed before the link. For `[b]` oxfmt puts them between a line break and the `[`, and
    /// [`FormatComputedMemberExpressionWithoutObject`] prints them.
    pub(super) fn leading_comments(&self, f: &Formatter<'a>) -> CommentList<'a> {
        match *self {
            Self::StaticMember(member) if comments_in_member_access_stay(f) => member
                .member_name_start()
                .map_or(CommentList::empty(), |start| {
                    f.comments().of_name(start).leading
                }),
            Self::ComputedMember(_) if comments_in_member_access_stay(f) => CommentList::empty(),
            _ => self.comments(f).leading,
        }
    }
}

/// A call's `?.`, type arguments and arguments.
fn write_call_without_callee<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(call) = expression
        .as_call_like()
        .filter(|_| expression.tag() == ExprTag::Call)
    else {
        return;
    };
    write!(
        f,
        [
            call.is_optional().then_some("?."),
            type_arguments(call.type_args(), Node::Expr(expression)),
            FormatArguments::from_call(expression, call)
        ]
    );
}

/// `(a?.b()) /* comment */?.c()`: oxfmt drops the parentheses and prints the comment before the `?.c`, not after
/// `a?.b()`. `link` is the `a?.b()`.
fn comments_after_inner_chain_lead_next_link<'a>(link: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt()
        && link.is_chain_root()
        && matches!(link.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Dot)
}

impl<'a> Format<'a> for ChainMember<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return self.write_link(f);
        }
        match *self {
            // The last call's comments are printed around the whole chain.
            Self::CallExpression {
                position: CallExpressionPosition::End,
                ..
            } => self.write_link(f),
            Self::Node(callee) => write!(
                f,
                FormatCallee {
                    callee,
                    is_in_member_chain: true
                }
            ),
            // A `prettier-ignore` comment has no effect on a link.
            _ => {
                if let Some(object) = (self.expr().object())
                    .filter(|object| comments_after_inner_chain_lead_next_link(*object, f))
                {
                    let comments = f.comments().of_node(object.as_chain_element()).trailing;
                    FormatLeadingComments::Comments(comments).fmt(f);
                }
                FormatLeadingComments::Comments(self.leading_comments(f)).fmt(f);
                self.write_link(f);
                let trailing_comments = self.comments(f).trailing;
                if keeps_comments_after_callee(self.expr(), true, f) {
                    write_comments_after_callee(trailing_comments, f);
                } else if !comments_after_inner_chain_lead_next_link(self.expr(), f) {
                    FormatTrailingComments::Comments(trailing_comments).fmt(f);
                }
            }
        }
    }
}

impl<'a> ChainMember<'a> {
    /// Prints what the link adds to its object or callee.
    fn write_link(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::StaticMember(member) => match comments_in_member_access_stay(f) {
                true => write_lookup_after_its_comments(member, f),
                false => write_lookup(member, f),
            },
            Self::TSNonNullExpression(e) => write!(f, FormatNonNullMarks(e)),
            Self::CallExpression { expression, .. } => write_call_without_callee(expression, f),
            Self::ComputedMember(member) => {
                let boundary = comments_in_member_access_stay(f).then_some(line_suffix_boundary());
                write!(
                    f,
                    [
                        boundary,
                        FormatComputedMemberExpressionWithoutObject(member)
                    ]
                );
            }
            Self::Node(node) => write!(f, node),
        }
    }
}

/// oxfmt prints `a[0 /* comment */]` like `a[b /* comment */]`, so it can break after the `[`.
fn breaks_around_a_number_with_comments<'a>(index: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.options().flavor.is_oxfmt() && !f.is_quiet() && has_comments(index, f)
}

/// The `[b]` or `?.[b]` in `a[b]`. Prettier's `printMemberLookup`.
pub(crate) struct FormatComputedMemberExpressionWithoutObject<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatComputedMemberExpressionWithoutObject<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let member = self.0;
        let ExprKind::Index { index, .. } = member.kind() else {
            return;
        };
        if !f.is_quiet() && comments_in_member_access_stay(f) {
            let comments = f.comments().of_node(member.as_chain_element()).dangling;
            if !comments.is_empty() {
                write!(
                    f,
                    [soft_line_break(), FormatLeadingComments::Comments(comments)]
                );
            }
        }
        let optional = member.is_optional().then_some("?.");
        if matches!(index.kind(), ExprKind::Number(_))
            && !breaks_around_a_number_with_comments(index, f)
        {
            write!(f, [optional, "[", index, "]"]);
        } else {
            write!(
                f,
                group(&format_args!(optional, "[", soft_block_indent(&index), "]"))
            );
        }
    }
}
