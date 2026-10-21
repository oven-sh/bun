//! Chains of calls and member accesses: `a.b().c().d()`. Prettier's `printMemberChain`.
//!
//! The links are put in groups, `a`, `.b()`, `.c()`, `.d()`, which are printed on one line if that fits and the chain
//! is short and simple. Otherwise each group goes on its own line.

pub(crate) mod chain_member;
mod groups;
pub(crate) mod simple_argument;

use self::chain_member::{CallExpressionPosition, ChainMember};
use self::groups::{FormatMemberChainGroup, should_insert_empty_line_after};
use self::simple_argument::SimpleArgument;
use super::call_expression::{is_call_expression, is_member_expression};
use super::is_long_curried_call;
use super::typecast::is_cast_target;
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::prelude::*;
use crate::{best_fitting, write};
use smallvec::SmallVec;

type Members<'a> = SmallVec<[ChainMember<'a>; 8]>;

struct MemberChain<'a, 'b> {
    root: Expr<'a>,
    /// The links, first to last.
    members: &'b [ChainMember<'a>],
    /// Where each group ends in `members`. The first group is the head, the others are the tail.
    group_ends: SmallVec<[u32; 8]>,
}

/// Prints the call `call_expression`, whose callee is a member access.
pub(crate) fn write_member_chain<'a>(call_expression: Expr<'a>, f: &mut Formatter<'a>) {
    let mut members = Members::new();
    let has_inner_call = push_chain_members(call_expression, &mut members, f);
    if !has_single_group_after_head(has_inner_call, f)
        || (lays_out_by_comment_position(f)
            && (members.iter())
                .any(|member| needs_empty_line_before_for_oxfmt(std::slice::from_ref(member), f)))
    {
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

/// Returns the head of the member chain that ends with the call `call_expression`. The head is printed first. Each link
/// after it is printed with its comments directly before it.
pub(crate) fn head_of_member_chain<'a>(
    call_expression: Expr<'a>,
    f: &Formatter<'a>,
) -> Option<Expr<'a>> {
    let mut members = Members::new();
    push_chain_members(call_expression, &mut members, f);
    match members.last() {
        Some(ChainMember::Node(head)) => Some(*head),
        _ => None,
    }
}

/// The code is parsed as a statement here, but Prettier has no such node: its root is a `JsExpressionRoot` or an
/// `NGRoot`.
fn is_whole_expression_in_html(f: &Formatter<'_>) -> bool {
    !matches!(
        f.options().in_html.root,
        HtmlRoot::None | HtmlRoot::Program | HtmlRoot::VueEventBinding
    )
}

/// `a[B].c().d()`: to Prettier `B` looks like a factory, so `.c()` stays on its line. oxfmt only looks at `a.B`.
fn name_in_brackets_can_be_factory(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// A group ends before a member access that follows a call, and after a comment. Without either, a
/// chain has at most one group after the head, and no call that an empty line could follow.
fn has_single_group_after_head(has_inner_call: bool, f: &Formatter<'_>) -> bool {
    !has_inner_call && f.is_quiet()
}

impl<'a, 'b> MemberChain<'a, 'b> {
    /// `members` are the links of the chain that ends with the call `root`, first to last.
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
        if match lays_out_by_comment_position(f) {
            true => !f.is_quiet() && has_comment_in_member_for_oxfmt(first_member, f),
            false => has_leading_comment(first_member, f) || has_trailing_comment(first_member, f),
        } {
            return false;
        }
        let has_computed_property = first_member.is_computed_expression();

        if let [ChainMember::Node(node)] = self.head() {
            match node.tag() {
                ExprTag::Ident => {
                    let name = node.text();
                    has_computed_property
                        || is_factory(name)
                        // A name that's shorter than the indentation: the `.` wouldn't even be to the right of it.
                        || (name.len() <= f.options().indent_width.value() as usize
                            && matches!(self.root.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr)
                            && !is_whole_expression_in_html(f))
                }
                ExprTag::This => true,
                _ => false,
            }
        } else {
            // Prettier also looks at the name in `[]`.
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

    /// Returns which groups of the tail keep an empty line before them, and true if one of those lines is after a call,
    /// which forces the chain to break. An empty line after the head, if the head doesn't end with a call, is only kept
    /// if the chain breaks.
    fn find_empty_lines(&self, f: &Formatter<'a>) -> (SmallVec<[bool; 8]>, bool) {
        if lays_out_by_comment_position(f) {
            let needs_empty_line: SmallVec<[bool; 8]> = (self.groups().skip(1))
                .map(|group| needs_empty_line_before_for_oxfmt(group, f))
                .collect();
            let breaks_chain = needs_empty_line.contains(&true);
            return (needs_empty_line, breaks_chain);
        }
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
                    // Not after a call at the head of the chain: `fn()\n\n.bar()` prints as `fn().bar()`.
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

    /// Prettier's `shouldMerge`'s counterpart `shouldNotWrap`, and the complexity checks.
    ///
    /// `formatted` is each group's output.
    fn groups_should_break(&self, formatted: &[Option<FormatElement>], f: &Formatter<'a>) -> bool {
        let mut call_expressions = self
            .members
            .iter()
            .filter_map(|member| match member {
                ChainMember::CallExpression { expression, .. } => expression.as_call_like(),
                ChainMember::Node(expression) if is_call_expression(*expression, f) => {
                    expression.as_call_like()
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
        if f.is_quiet() {
            return false;
        }
        if lays_out_by_comment_position(f) {
            return (self.members.iter()).any(|member| has_comment_in_member_for_oxfmt(member, f));
        }
        let Some((_, all_but_last)) = self.members.split_last() else {
            return false;
        };
        (all_but_last.iter().skip(1)).any(|member| has_leading_comment(member, f))
            || (all_but_last.iter()).any(|member| has_trailing_comment(member, f))
            || (self.group(2).first()).is_some_and(|member| has_leading_comment(member, f))
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

        // The groups are inspected and then printed in two layouts. They're formatted in order because of the comments.
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

fn has_leading_comment<'a>(member: &ChainMember<'a>, f: &Formatter<'a>) -> bool {
    !f.is_quiet() && !member.comments(f).leading.is_empty()
}

/// `a! /* comment */ !`: the comment dangles from `a!!`. In Prettier it trails the inner `a!`, which is also a link.
fn has_trailing_comment<'a>(member: &ChainMember<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() {
        return false;
    }
    let comments = member.comments(f);
    !comments.trailing.is_empty()
        || (matches!(member, ChainMember::TSNonNullExpression(_)) && !comments.dangling.is_empty())
}

/// oxfmt lays out a chain by where the comments are, not by which nodes own them.
fn lays_out_by_comment_position(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// True if only whitespace and comments are between `expression` and `comment`, which comes after it.
fn is_directly_after(comment: Comment<'_>, expression: Expr<'_>) -> bool {
    comment.prev_token_end() == expression.span().end
}

/// oxfmt's `has_comment_in_member`: `member` is `.b` and has a comment between its object and its name, or a comment
/// after it that ends the line.
fn has_comment_in_member_for_oxfmt<'a>(member: &ChainMember<'a>, f: &Formatter<'a>) -> bool {
    let ChainMember::StaticMember(expression) = *member else {
        return false;
    };
    let (Some(object), Some(name_start)) = (expression.object(), expression.member_name_start())
    else {
        return false;
    };
    (f.comments()).has_comment_in_span(Span::after(object.span(), name_start))
        || (member.comments(f).trailing.iter())
            .take_while(|comment| {
                !comment.has_newline_before() && is_directly_after(*comment, expression)
            })
            .any(|comment| comment.is_line() || comment.has_newline_after())
}

/// oxfmt's `needs_empty_line_before`: `group` starts with `.b`, and there's an empty line between the object and the
/// `.`, or between the object and the first comment before the name.
fn needs_empty_line_before_for_oxfmt<'a>(group: &[ChainMember<'a>], f: &Formatter<'a>) -> bool {
    let Some(ChainMember::StaticMember(expression)) = group.first() else {
        return false;
    };
    let (Some(object), Some(name_start)) = (expression.object(), expression.member_name_start())
    else {
        return false;
    };
    // Not after a call at the head of the chain: `fn()\n\n.bar()` prints as `fn().bar()`.
    if matches!(object.kind(), ExprKind::Call(call)
        if !matches!(call.callee().tag(), ExprTag::Dot | ExprTag::Index | ExprTag::Call))
    {
        return false;
    }
    let between = Span::after(object.span(), name_start);
    let end = match f.is_quiet() {
        true => None,
        false => f.comments().comments_in_span(between).first(),
    }
    .map_or(name_start, |comment| comment.span().start);
    let mut start = between.start;
    while let Some(line_break) =
        bun_core::strings::index_of_any(f.source_text().text_for(&Span::new(start, end)), b"\r\n")
    {
        start += line_break as u32;
        if f.source_text().lines_after(start) > 1 {
            return true;
        }
        start += 1;
    }
    false
}

/// True if a group of the chain ends after `member`, which `next` follows, so that a comment stays after the link it
/// follows in the source. In oxfmt that's any comment directly after `member`, even one that starts a line.
fn is_followed_by_comment<'a>(
    member: &ChainMember<'a>,
    next: Option<&ChainMember<'a>>,
    f: &Formatter<'a>,
) -> bool {
    if !lays_out_by_comment_position(f) {
        return has_trailing_comment(member, f);
    }
    let first_before_next = next.and_then(|next| match next {
        ChainMember::StaticMember(_) => next.leading_comments(f).first(),
        ChainMember::ComputedMember(_) => next.comments(f).dangling.first(),
        _ => None,
    });
    (member.comments(f).trailing.first().into_iter())
        .chain(first_before_next)
        .any(|comment| is_directly_after(comment, member.expr()))
}

fn is_computed_array_member_access(member: &ChainMember<'_>) -> bool {
    matches!(member, ChainMember::ComputedMember(expression)
        if matches!(expression.kind(), ExprKind::Index { index, .. } if matches!(index.kind(), ExprKind::Number(_))))
}

/// The index where the head ends. The head is the first member, the calls and `[0]`s right after it, and, unless it
/// starts with a call, the member accesses up to the last one before a call: `a()()`, `a[0][1]`, the `this.a.b` in
/// `this.a.b.c()`.
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

/// Pushes the end of each group after the head. Each group is some member accesses and the calls after them.
///
/// `start` is where the head ends in `members`.
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
            // `[0]` belongs with what's before it.
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

        // So that the comment stays after the link it follows in the source.
        if !f.is_quiet() && is_followed_by_comment(member, members.get(index + 1), f) {
            group_ends.push(index as u32 + 1);
            group_start = index + 1;
            has_seen_call_expression = false;
        }
    }
    if group_start < members.len() {
        group_ends.push(members.len() as u32);
    }
}

/// A name that starts with a capital letter, or consists of `_` and `$`, is likely a factory or a namespace:
/// `Object.keys(a)`, `_.map(a)`, `$.ajax()`.
fn is_factory(name: &[u8]) -> bool {
    match name.split_first() {
        Some((b'_' | b'$', rest)) => rest.iter().all(|b| matches!(b, b'_' | b'$')),
        Some((first, _)) => first.is_ascii_uppercase(),
        None => false,
    }
}

/// True if the call `expression` is printed as a member chain that can break before each group: it has more than one
/// group after the head, or a comment between its links.
pub(crate) fn is_member_call_chain<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut members = Members::new();
    if has_single_group_after_head(push_chain_members(expression, &mut members, f), f) {
        return false;
    }
    members.reverse();
    let chain = MemberChain::new(expression, &members, f);
    chain.tail_len() > 1 || chain.has_comment(f)
}

/// `a.#b().c()`: in oxfmt `a.#b` isn't a link of the chain. It, or the call of it, is the head of the chain.
fn starts_chain(member: Expr<'_>, f: &Formatter<'_>) -> bool {
    member.is_private_member() && f.options().flavor.is_oxfmt()
}

/// Appends the links of the chain that ends with the call `root`, last to first. Returns true if there's another call
/// among them. The chain starts where something needs parentheses.
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
        // A link's parent is another link, where it never needs parentheses unless an optional chain ends with it.
        if (has_type_casts && is_cast_target(expression, f))
            || ((!is_link
                || ((tag == ExprTag::NonNull || expression.chain() != Chain::No)
                    && expression.is_chain_root()))
                && expression_needs_parentheses(expression, f))
        {
            members.push(ChainMember::Node(expression));
            break;
        }

        members.push(match tag {
            ExprTag::Call
                if expression.callee().is_some_and(|callee| {
                    (is_member_expression(callee, f) && !starts_chain(callee, f))
                        || is_call_expression(callee, f)
                }) =>
            {
                next = expression.callee();
                has_inner_call = true;
                ChainMember::CallExpression {
                    expression,
                    position: CallExpressionPosition::Middle,
                }
            }
            ExprTag::Dot if !starts_chain(expression, f) => {
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
