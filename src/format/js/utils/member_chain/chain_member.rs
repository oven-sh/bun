use crate::js::comments::inner_of_link;
use crate::js::format::{
    FormatNonNullMarks, identifier, no_comment_trails_what_is_before_another,
    write_trailing_comments_of,
};
use crate::js::print::call_like_expression::FormatTypeArguments;
use crate::js::print::call_like_expression::arguments::FormatArguments;
use crate::js::print::member_expression::write_lookup_without_comments;
use crate::js::utils::call_expression::write_callee_trailing_comments;
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

    /// Where what the link follows ends. `None` for what the chain starts with.
    pub(super) fn inner_end(&self) -> Option<u32> {
        match *self {
            Self::Node(_) => None,
            _ => inner_of_link(self.expr()).map(|inner| inner.span().end),
        }
    }
}

/// Prettier attaches every comment between the links of a chain to one of them, which it leads or trails: see
/// `attach_in_link`. oxfmt goes by what is around a comment when it comes to it.
pub(super) fn comments_are_attached_to_links(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
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

/// `a.b⏎// comment⏎.c()`: for oxfmt the comment stays on its line, before `.c`.
fn comment_that_starts_line_leads_next_link(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt() && no_comment_trails_what_is_before_another(f)
}

/// The comments behind a link of the chain.
fn write_trailing_comments_of_member<'a>(member: Expr<'a>, f: &mut Formatter<'a>) {
    match call_of_callee(member) {
        Some(call) => {
            write_callee_trailing_comments(call, member.span().end, f);
        }
        None if comment_that_starts_line_leads_next_link(f) => {}
        None => write_trailing_comments_of(member.as_chain_element(), f),
    }
}

/// `?.`, the type arguments and the arguments of a call.
fn write_call_without_callee<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) {
    let Some(call) = expression
        .call()
        .filter(|_| expression.tag() == ExprTag::Call)
    else {
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
        if f.is_quiet() {
            return self.write_without_comments(f);
        }
        if comments_are_attached_to_links(f) {
            return self.write_with_attached_comments(f);
        }
        if !comments_lead_a_later_link(self.expr(), f) {
            return self.write_with_comments_around(f);
        }
        // No comment is seen while this link is written.
        let previous_limit = f.comments_mut().limit_comments_up_to(0);
        self.write_with_comments_around(f);
        f.comments_mut().restore_view_limit(previous_limit);
    }
}

impl<'a> ChainMember<'a> {
    /// What the link adds to what it follows.
    fn write_without_comments(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::StaticMember(member) if f.is_quiet() => write_lookup_without_comments(member, f),
            Self::StaticMember(member) => {
                let ExprKind::Dot { name, .. } = member.kind() else {
                    return;
                };
                write!(
                    f,
                    [
                        member.is_optional().then_some("?"),
                        ".",
                        identifier(name, member.as_chain_element())
                    ]
                );
            }
            Self::TSNonNullExpression(e) => write!(f, FormatNonNullMarks(e)),
            Self::CallExpression { expression, .. } => write_call_without_callee(expression, f),
            Self::ComputedMember(member) => {
                write!(f, FormatComputedMemberExpressionWithoutObject(member));
            }
            Self::Node(node) => write!(f, FormatNodeWithoutTrailingComments(&node)),
        }
    }

    /// See [`comments_are_attached_to_links`].
    fn write_with_attached_comments(&self, f: &mut Formatter<'a>) {
        // The comments around the last call are around the chain.
        if let Self::CallExpression {
            position: CallExpressionPosition::End,
            ..
        } = self
        {
            return self.write_without_comments(f);
        }
        if let Some(inner_end) = self.inner_end() {
            FormatLeadingComments::Comments(f.comments().comments_leading_link(inner_end)).fmt(f);
        }
        self.write_without_comments(f);
        let end = self.expr().span().end;
        FormatTrailingComments::Comments(f.comments().comments_trailing_link(end)).fmt(f);
    }

    fn write_with_comments_around(&self, f: &mut Formatter<'a>) {
        match *self {
            Self::StaticMember(member) => {
                // Those after the `.` are before it too.
                let name_start = member
                    .member_name_start()
                    .unwrap_or_else(|| member.span().end);
                let comments = f.comments().comments_before(name_start);
                FormatLeadingComments::Comments(comments).fmt(f);
            }
            Self::CallExpression {
                position: CallExpressionPosition::End,
                ..
            } => return self.write_without_comments(f),
            Self::Node(node) if call_of_callee(node).is_none() => return write!(f, node),
            Self::Node(_) => {}
            _ => format_leading_comments(self.expr().span()).fmt(f),
        }
        self.write_without_comments(f);
        write_trailing_comments_of_member(self.expr(), f);
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
        // name. For oxfmt it stays where it is.
        if !f.is_quiet()
            && (matches!(index.kind(), ExprKind::Ident(_)) || f.options().flavor.is_oxfmt())
        {
            let comments = f
                .comments()
                .comments_before_character(member.span().start, b'[');
            write!(f, FormatLeadingComments::Comments(comments));
        }

        let optional = member.is_optional().then_some("?.");
        if matches!(index.kind(), ExprKind::Number(_))
            && !breaks_around_a_number_with_comments(member, f)
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
