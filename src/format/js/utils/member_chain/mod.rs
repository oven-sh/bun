//! Chains of calls and member accesses: `a.b().c().d()`. Prettier's `printMemberChain`.
//!
//! The links are put in groups, `a`, `.b()`, `.c()`, `.d()`, which are written on one line if that
//! fits and the chain is short and simple, and otherwise each on its own line.

pub(crate) mod chain_member;
mod groups;
pub(crate) mod simple_argument;

use self::chain_member::{
    CallExpressionPosition, ChainMember, call_of_callee, comments_lead_a_later_link,
};
use self::groups::{FormatMemberChainGroup, should_insert_empty_line_after};
use self::simple_argument::SimpleArgument;
use super::call_expression::{callee_trailing_comments, is_call_expression, is_member_expression};
use super::is_long_curried_call;
use super::typecast::is_cast_target;
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::prelude::*;
use crate::{best_fitting, write};
use smallvec::SmallVec;

type Members<'a> = SmallVec<[ChainMember<'a>; 8]>;

struct MemberChain<'a, 'b> {
    root: Expr<'a>,
    /// The links, from the first to the last.
    members: &'b [ChainMember<'a>],
    /// Where each group ends in `members`. The first group is the head, the others are the tail.
    group_ends: SmallVec<[u32; 8]>,
}

/// Writes the call `call_expression`, whose callee is a member access.
pub(crate) fn write_member_chain<'a>(call_expression: Expr<'a>, f: &mut Formatter<'a>) {
    let mut members = Members::new();
    let has_inner_call = push_chain_members(call_expression, &mut members, f);
    if !is_one_group_after_the_head(has_inner_call, f) {
        members.reverse();
        return MemberChain::new(call_expression, &members, f).fmt(f);
    }
    let content = format_with(|f| {
        for member in members.iter().rev() {
            write!(f, member);
        }
    });
    match is_long_curried_call(call_expression, f) {
        true => write!(f, content),
        false => write!(f, group(&content)),
    }
}

/// The statement that the code is parsed as is not there for Prettier: the root is a `JsExpressionRoot` or an `NGRoot`.
fn is_all_of_expression_in_html(f: &Formatter<'_>) -> bool {
    !matches!(
        f.options().in_html.root,
        HtmlRoot::None | HtmlRoot::Program | HtmlRoot::VueEventBinding
    )
}

/// `a[B].c().d()`: for Prettier `B` looks like a factory, and `.c()` stays on its line. oxfmt only looks at `a.B`.
fn name_in_brackets_can_be_factory(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// A group ends before a member access that follows a call, and after a comment. Without either, a
/// chain has at most one group after the head, and no call that an empty line could follow.
fn is_one_group_after_the_head(has_inner_call: bool, f: &Formatter<'_>) -> bool {
    !has_inner_call && f.is_quiet()
}

impl<'a, 'b> MemberChain<'a, 'b> {
    /// `members`: the links of the chain that ends with the call `root`, from the first to the last.
    fn new(root: Expr<'a>, members: &'b [ChainMember<'a>], f: &Formatter<'a>) -> Self {
        let head_end = get_split_index_of_head_and_tail_groups(members, f);
        let mut group_ends = SmallVec::new();
        group_ends.push(head_end as u32);
        push_ends_of_remaining_groups(members, head_end, &mut group_ends, f);

        let mut member_chain = Self {
            root,
            members,
            group_ends,
        };
        // The first group of the tail may belong to the head.
        if member_chain.tail_len() > 0 && member_chain.should_merge_tail_with_head(f) {
            member_chain.group_ends.remove(0);
        }
        member_chain
    }

    fn group(&self, index: usize) -> &[ChainMember<'a>] {
        let start = index
            .checked_sub(1)
            .and_then(|previous| self.group_ends.get(previous))
            .map_or(0, |&end| end as usize);
        let end = self
            .group_ends
            .get(index)
            .map_or(start, |&end| end as usize);
        self.members.get(start..end).unwrap_or_default()
    }

    fn groups(&self) -> impl Iterator<Item = &[ChainMember<'a>]> {
        (0..self.group_ends.len()).map(|index| self.group(index))
    }

    fn head(&self) -> &[ChainMember<'a>] {
        self.group(0)
    }

    fn tail_len(&self) -> usize {
        self.group_ends.len().saturating_sub(1)
    }

    fn should_merge_tail_with_head(&self, f: &Formatter<'a>) -> bool {
        let Some(first_member) = self.group(1).first() else {
            return false;
        };
        if !f.is_quiet()
            && (has_leading_comment(first_member, f)
                || has_trailing_comment(first_member.expr(), f))
        {
            return false;
        }
        let has_computed_property = first_member.is_computed_expression();

        if let [ChainMember::Node(node)] = self.head() {
            match node.tag() {
                ExprTag::Ident => {
                    let name = node.text();
                    has_computed_property
                        || is_factory(name)
                        // A name that is shorter than the indentation: the `.` would not even be
                        // to the right of it.
                        || (name.len() <= f.options().indent_width.value() as usize
                            && matches!(self.root.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr)
                            && !is_all_of_expression_in_html(f))
                }
                ExprTag::This => true,
                _ => false,
            }
        } else {
            // Prettier looks at the name in `[]` as well.
            let name = match self
                .head()
                .last()
                .map(|member| (member, member.expr().kind()))
            {
                Some((ChainMember::StaticMember(_), ExprKind::Dot { name, .. }))
                    if !name.bytes().starts_with(b"#") =>
                {
                    name.bytes()
                }
                Some((ChainMember::ComputedMember(_), ExprKind::Index { index, .. }))
                    if matches!(index.kind(), ExprKind::Ident(_))
                        && name_in_brackets_can_be_factory(f) =>
                {
                    index.text()
                }
                _ => return false,
            };
            has_computed_property || is_factory(name)
        }
    }

    /// Before which groups of the tail an empty line is kept, and whether one of them is after a
    /// call, which takes breaking the chain. One after the head, if that does not end with a call,
    /// is only kept if the chain breaks.
    fn find_empty_lines(&self, f: &Formatter<'a>) -> (SmallVec<[bool; 8]>, bool) {
        let mut has_empty_line_after_call = false;
        let mut previous = self.head().last();
        let needs_empty_line = (self.groups().skip(1).enumerate())
            .map(|(index, group)| {
                let needs_empty_line = match previous {
                    Some(ChainMember::CallExpression { expression, .. }) => {
                        let is_followed_by_empty_line =
                            should_insert_empty_line_after(*expression, f);
                        has_empty_line_after_call |= is_followed_by_empty_line;
                        is_followed_by_empty_line
                    }
                    // Not after a call that the chain starts with: `fn()\n\n.bar()` is `fn().bar()`.
                    Some(ChainMember::Node(node)) if is_call_expression(*node, f) => false,
                    Some(member) => index == 0 && should_insert_empty_line_after(member.expr(), f),
                    None => false,
                };
                previous = group.last();
                needs_empty_line
            })
            .collect();
        (needs_empty_line, has_empty_line_after_call)
    }

    /// Prettier's `shouldMerge`'s counterpart `shouldNotWrap`, and the tests on complexity.
    ///
    /// `formatted`: what is written for each group.
    fn groups_should_break(&self, formatted: &[Option<FormatElement>], f: &Formatter<'a>) -> bool {
        let mut call_expressions = self
            .members
            .iter()
            .filter_map(|member| match member {
                ChainMember::CallExpression { expression, .. } => expression.call(),
                ChainMember::Node(expression) if is_call_expression(*expression, f) => {
                    expression.call()
                }
                _ => None,
            })
            .peekable();

        let mut calls_count = 0;
        let mut has_function_like_argument = false;
        let mut has_complex_args = false;
        while let Some(call) = call_expressions.next() {
            calls_count += 1;
            if call_expressions.peek().is_some() {
                has_function_like_argument = has_function_like_argument
                    || call
                        .args()
                        .iter()
                        .any(|argument| argument.as_fn().is_some());
            }
            has_complex_args = has_complex_args
                || !call
                    .args()
                    .iter()
                    .all(|argument| SimpleArgument::new(argument, f).is_simple());
            if calls_count > 2 && has_complex_args {
                return true;
            }
        }

        let will_break =
            |group: &Option<FormatElement>| group.is_some_and(|formatted| formatted.will_break(f));
        let ([head, tail @ ..], Some(last)) = (formatted, formatted.last()) else {
            return false;
        };
        let ends_with_call = matches!(
            self.members.last(),
            Some(ChainMember::CallExpression { .. })
        );
        (!tail.is_empty() && will_break(head))
            || (has_function_like_argument && ends_with_call && will_break(last))
            || tail.iter().rev().skip(1).any(will_break)
    }

    /// Prettier's `nodeHasComment`.
    fn has_comment(&self, f: &Formatter<'a>) -> bool {
        !f.is_quiet()
            && self.members.iter().any(|member| {
                has_leading_comment(member, f)
                    || (!matches!(
                        member,
                        ChainMember::CallExpression {
                            position: CallExpressionPosition::End,
                            ..
                        }
                    ) && has_trailing_comment(member.expr(), f))
            })
    }
}

impl<'a> Format<'a> for MemberChain<'a, '_> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let has_comment = self.has_comment(f);
        let (needs_empty_line, has_empty_line_after_call) = self.find_empty_lines(f);

        if self.tail_len() <= 1 && !has_comment && !has_empty_line_after_call {
            let content = format_with(|f| {
                for group in self.groups() {
                    write!(f, FormatMemberChainGroup(group));
                }
            });
            return match is_long_curried_call(self.root, f) {
                true => write!(f, content),
                false => write!(f, group(&content)),
            };
        }

        // The groups are asked about, and written in two ways. They are formatted in order, for the
        // sake of the comments.
        let formatted: SmallVec<[Option<FormatElement>; 8]> = self
            .groups()
            .map(|group| f.intern(&FormatMemberChainGroup(group)))
            .collect();
        let write_group = |group: &Option<FormatElement>, f: &mut Formatter<'a>| {
            if let Some(formatted) = *group {
                f.write_element(formatted);
            }
        };

        let format_one_line = format_with(|f| {
            for group in &formatted {
                write_group(group, f);
            }
        });
        let format_tail = format_with(|f| {
            for (group, &needs_empty_line) in formatted.iter().skip(1).zip(&needs_empty_line) {
                match needs_empty_line {
                    true => write!(f, empty_line()),
                    false => write!(f, hard_line_break()),
                }
                write_group(group, f);
            }
        });
        let format_expanded = format_with(|f| {
            if let Some(head) = formatted.first() {
                write_group(head, f);
            }
            write!(f, indent(&format_tail));
        });

        let format_content = format_with(|f| {
            if has_comment || has_empty_line_after_call || self.groups_should_break(&formatted, f) {
                write!(f, group(&format_expanded));
            } else {
                let has_empty_line_before_tail = needs_empty_line.first() == Some(&true);
                let last_group_breaks = formatted
                    .last()
                    .is_some_and(|last| last.is_some_and(|it| it.will_break(f)));
                if has_empty_line_before_tail || last_group_breaks {
                    write!(f, expand_parent());
                }
                write!(f, best_fitting!(format_one_line, format_expanded));
            }
        });

        write!(
            f,
            labelled(LabelId::of(JsLabels::MemberChain), &format_content)
        );
    }
}

/// Whether a comment leads `member`: it is on a line of its own before the `.`, or before the `[` of
/// `[name]`. Prettier's `handleMemberExpressionComments`.
fn has_leading_comment<'a>(member: &ChainMember<'a>, f: &Formatter<'a>) -> bool {
    if matches!(member, ChainMember::Node(node) if comments_lead_a_later_link(*node, f)) {
        return true;
    }
    let (object, character) = match member.expr().kind() {
        ExprKind::Dot { obj, .. } if matches!(member, ChainMember::StaticMember(_)) => (obj, b'.'),
        ExprKind::Index { obj, index, .. }
            if matches!(member, ChainMember::ComputedMember(_))
                && matches!(index.kind(), ExprKind::Ident(_)) =>
        {
            (obj, b'[')
        }
        _ => return false,
    };
    f.comments()
        .comments_before_character(object.span().end, character)
        .iter()
        .any(|comment| comment.preceded_by_newline())
}

/// Whether a comment trails `expression`, a link of a chain that is not the last.
fn has_trailing_comment<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    let end = expression.span().end;
    match call_of_callee(expression) {
        Some(call) => {
            let comments = callee_trailing_comments(call, end, f);
            match comments_stay_between_head_and_body(f) {
                // All before the `(` are among them. A block comment on its line separates nothing.
                true => comments
                    .iter()
                    .any(|comment| comment.preceded_by_newline() || comment.followed_by_newline()),
                false => !comments.is_empty(),
            }
        }
        // A comment on its own line leads the next member, or what is in its brackets.
        None => f
            .comments()
            .comments_after(end)
            .first()
            .is_some_and(|comment| {
                !comment.preceded_by_newline()
                    && f.source_text()
                        .all_bytes(Span::before(end, comment.span), |b| {
                            b.is_ascii_whitespace() || b == b')'
                        })
            }),
    }
}

fn is_computed_array_member_access(member: &ChainMember<'_>) -> bool {
    matches!(member, ChainMember::ComputedMember(expression)
        if matches!(expression.kind(), ExprKind::Index { index, .. } if matches!(index.kind(), ExprKind::Number(_))))
}

/// Where the head ends. It is the first member, the calls and `[0]`s right after it, and, unless
/// it starts with a call, the member accesses up to the last before a call:
/// `a()()`, `a[0][1]`, `this.a.b` of `this.a.b.c()`.
fn get_split_index_of_head_and_tail_groups<'a>(
    members: &[ChainMember<'a>],
    f: &Formatter<'a>,
) -> usize {
    let non_call_or_array_member_access_start = members
        .iter()
        .skip(1)
        .position(|member| match member {
            ChainMember::CallExpression { .. } | ChainMember::TSNonNullExpression(_) => false,
            ChainMember::ComputedMember(_) => !is_computed_array_member_access(member),
            _ => true,
        })
        .map_or(members.len(), |index| index + 1);

    let starts_with_call = members.first().is_some_and(|first| match first {
        ChainMember::CallExpression { .. } => true,
        ChainMember::Node(expression) => is_call_expression(*expression, f),
        _ => false,
    });
    if starts_with_call {
        return non_call_or_array_member_access_start;
    }
    let rest = members
        .get(non_call_or_array_member_access_start..)
        .unwrap_or_default();
    let member_end = rest
        .iter()
        .position(|member| {
            !matches!(
                member,
                ChainMember::StaticMember(_) | ChainMember::ComputedMember(_)
            )
        })
        .map_or(rest.len(), |index| index.saturating_sub(1));
    non_call_or_array_member_access_start + member_end
}

/// Where the groups after the head end: each is some member accesses and the calls after them.
///
/// `start`: where the head ends in `members`.
fn push_ends_of_remaining_groups<'a>(
    members: &[ChainMember<'a>],
    start: usize,
    group_ends: &mut SmallVec<[u32; 8]>,
    f: &Formatter<'a>,
) {
    let mut has_seen_call_expression = false;
    let mut group_start = start;

    for (index, member) in members.iter().enumerate().skip(start) {
        match member {
            // `[0]` goes with what is before it.
            ChainMember::ComputedMember(_) if is_computed_array_member_access(member) => {}
            ChainMember::StaticMember(_) | ChainMember::ComputedMember(_)
                if has_seen_call_expression =>
            {
                group_ends.push(index as u32);
                group_start = index;
                has_seen_call_expression = false;
            }
            ChainMember::CallExpression { .. } => has_seen_call_expression = true,
            _ => {}
        }

        // So that the comment stays behind what it is written behind.
        if !f.is_quiet() && has_trailing_comment(member.expr(), f) {
            group_ends.push(index as u32 + 1);
            group_start = index + 1;
            has_seen_call_expression = false;
        }
    }
    if group_start < members.len() {
        group_ends.push(members.len() as u32);
    }
}

/// A name that starts with a capital letter, or consists of `_` and `$`, is likely to be a factory
/// or a namespace: `Object.keys(a)`, `_.map(a)`, `$.ajax()`.
fn is_factory(name: &[u8]) -> bool {
    match name.split_first() {
        Some((b'_' | b'$', rest)) => rest.iter().all(|b| matches!(b, b'_' | b'$')),
        Some((first, _)) => first.is_ascii_uppercase(),
        None => false,
    }
}

/// Whether the call `expression` is written as a member chain that can break before each group: it
/// has more than one group after the head, or a comment between its links.
pub(crate) fn is_member_call_chain<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut members = Members::new();
    if is_one_group_after_the_head(push_chain_members(expression, &mut members, f), f) {
        return false;
    }
    members.reverse();
    let chain = MemberChain::new(expression, &members, f);
    chain.tail_len() > 1 || chain.has_comment(f)
}

/// Appends the links of the chain that ends with the call `root`, from the last to the first. Returns
/// whether there is another call among them. The chain starts where something needs parentheses.
fn push_chain_members<'a>(root: Expr<'a>, members: &mut Members<'a>, f: &Formatter<'a>) -> bool {
    members.push(ChainMember::CallExpression {
        expression: root,
        position: CallExpressionPosition::End,
    });
    let has_type_casts = f.comments().has_type_cast_comments();
    let mut has_inner_call = false;
    let mut next = root.callee();

    while let Some(expression) = next.take() {
        let tag = expression.tag();
        let is_link = matches!(
            tag,
            ExprTag::Call | ExprTag::Dot | ExprTag::Index | ExprTag::NonNull
        );
        // A link is in a link: nothing that it would need parentheses in, unless an optional chain
        // ends with it.
        if (has_type_casts && is_cast_target(expression, f))
            || ((!is_link
                || ((tag == ExprTag::NonNull || expression.chain() != Chain::No)
                    && is_chain_root(expression)))
                && expression_needs_parentheses(expression, f))
        {
            members.push(ChainMember::Node(expression));
            break;
        }

        members.push(match tag {
            ExprTag::Call
                if expression.callee().is_some_and(|callee| {
                    is_member_expression(callee, f) || is_call_expression(callee, f)
                }) =>
            {
                next = expression.callee();
                has_inner_call = true;
                ChainMember::CallExpression {
                    expression,
                    position: CallExpressionPosition::Middle,
                }
            }
            ExprTag::Dot => {
                next = expression.object();
                ChainMember::StaticMember(expression)
            }
            ExprTag::Index => {
                next = expression.object();
                ChainMember::ComputedMember(expression)
            }
            ExprTag::NonNull => {
                next = expression.operand();
                ChainMember::TSNonNullExpression(expression)
            }
            _ => ChainMember::Node(expression),
        });
    }
    has_inner_call
}
