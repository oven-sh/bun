//! Chains of calls and member accesses: `a.b().c().d()`. Prettier's `printMemberChain`.
//!
//! The links are put in groups, `a`, `.b()`, `.c()`, `.d()`, which are written on one line if that
//! fits and the chain is short and simple, and otherwise each on its own line.

pub(crate) mod chain_member;
pub(crate) mod groups;
pub(crate) mod simple_argument;

use self::chain_member::{CallExpressionPosition, ChainMember};
use self::groups::{MemberChainGroup, MemberChainGroupsBuilder, TailChainGroups};
use self::simple_argument::SimpleArgument;
use super::is_long_curried_call;
use super::typecast::is_type_cast_node;
use crate::prelude::*;
use crate::{best_fitting, write};
use smallvec::SmallVec;

pub(crate) struct MemberChain<'a> {
    root: Expr<'a>,
    head: MemberChainGroup<'a>,
    tail: TailChainGroups<'a>,
}

impl<'a> MemberChain<'a> {
    /// `call_expression`: a call.
    pub(crate) fn from_call_expression(call_expression: Expr<'a>, f: &Formatter<'a>) -> Self {
        let mut chain_members: SmallVec<[ChainMember<'a>; 4]> = chain_members_iter(call_expression, f).collect();
        chain_members.reverse();

        let remaining_members_start_index = get_split_index_of_head_and_tail_groups(&chain_members);
        let tail = compute_remaining_groups(chain_members.drain(remaining_members_start_index..), f);
        let head = MemberChainGroup::from(chain_members);

        let mut member_chain = Self {
            head,
            tail,
            root: call_expression,
        };
        // The first group of the tail may belong to the head.
        if member_chain.should_merge_tail_with_head(call_expression.as_chain_element().parent(), f)
            && let Some(group) = member_chain.tail.pop_first()
        {
            member_chain.head.extend_members(group.into_members());
        }
        member_chain
    }

    fn should_merge_tail_with_head(&self, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
        let Some(first_member) = self.tail.first().and_then(|group| group.members().first()) else {
            return false;
        };
        if Self::has_comment_in_member(first_member, f.comments()) {
            return false;
        }
        let has_computed_property = first_member.is_computed_expression();

        if let [ChainMember::Node(node)] = self.head.members() {
            match node.kind() {
                ExprKind::Ident(_) => {
                    let name = node.text();
                    has_computed_property
                        || is_factory(name)
                        // A name that is shorter than the indentation: the `.` would not even be
                        // to the right of it.
                        || (matches!(
                            parent.without_chain_expression(),
                            AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body()
                        ) && name.len() <= f.options().indent_width.value() as usize)
                }
                ExprKind::This => true,
                _ => false,
            }
        } else if let Some(ChainMember::StaticMember(expression)) = self.head.members().last()
            && let ExprKind::Dot { name, .. } = expression.kind()
        {
            has_computed_property || is_factory(name.bytes())
        } else {
            false
        }
    }

    fn inspect_member_chain_groups(&self, f: &mut Formatter<'a>) {
        self.head.inspect(false, f);
        for group in self.tail.iter() {
            group.inspect(true, f);
        }
    }

    /// Prettier's `shouldMerge`'s counterpart `shouldNotWrap`, and the tests on complexity.
    fn groups_should_break(&self, f: &Formatter<'a>) -> bool {
        let mut call_expressions = self
            .members()
            .filter_map(|member| match member {
                ChainMember::CallExpression { expression, .. } => expression.call(),
                _ => None,
            })
            .peekable();

        let mut calls_count = 0;
        let mut has_function_like_argument = false;
        let mut has_complex_args = false;
        while let Some(call) = call_expressions.next() {
            calls_count += 1;
            if call_expressions.peek().is_some() {
                has_function_like_argument =
                    has_function_like_argument || call.args().iter().any(|argument| argument.as_fn().is_some());
            }
            has_complex_args =
                has_complex_args || !call.args().iter().all(|argument| SimpleArgument::new(argument).is_simple());
            if calls_count > 2 && has_complex_args {
                return true;
            }
        }

        (!self.tail.is_empty() && self.head.will_break(f))
            || (self.last_call_breaks(f) && has_function_like_argument)
            || self.tail.any_except_last_will_break(f)
    }

    fn last_call_breaks(&self, f: &Formatter<'a>) -> bool {
        let last_group = self.last_group();
        matches!(last_group.members().last(), Some(ChainMember::CallExpression { .. })) && last_group.will_break(f)
    }

    fn last_group(&self) -> &MemberChainGroup<'a> {
        self.tail.last().unwrap_or(&self.head)
    }

    fn members(&self) -> impl Iterator<Item = &ChainMember<'a>> {
        self.head.members().iter().chain(self.tail.members())
    }

    /// Whether there is a comment between the object and the name, or behind the member at the
    /// end of the line.
    fn has_comment_in_member(member: &ChainMember<'a>, comments: &Comments<'a>) -> bool {
        let ChainMember::StaticMember(member) = member else {
            return false;
        };
        let ExprKind::Dot { obj, name, .. } = member.kind() else {
            return false;
        };
        comments.has_comment_in_range(obj.span().end, name.start())
            || comments.has_end_of_line_comment_after(member.span().end)
    }

    fn has_comment(&self, f: &Formatter<'a>) -> bool {
        !f.is_quiet() && self.members().any(|member| Self::has_comment_in_member(member, f.comments()))
    }
}

impl<'a> Format<'a> for MemberChain<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let has_comment = self.has_comment(f);
        let format_one_line = format_with(|f| {
            f.join().entries(std::iter::once(&self.head).chain(self.tail.iter()));
        });

        self.inspect_member_chain_groups(f);

        let has_new_line_or_comment_between = self.tail.iter().any(MemberChainGroup::needs_empty_line);

        if self.tail.len() <= 1 && !has_comment && !has_new_line_or_comment_between {
            return match is_long_curried_call(self.root) {
                true => write!(f, format_one_line),
                false => write!(f, group(&format_one_line)),
            };
        }

        let format_tail = format_with(|f| {
            for group in self.tail.iter() {
                match group.needs_empty_line() {
                    true => write!(f, empty_line()),
                    false => write!(f, hard_line_break()),
                }
                write!(f, group);
            }
        });
        let format_expanded = format_with(|f| write!(f, [self.head, indent(&format_tail)]));

        let format_content = format_with(|f| {
            if has_comment || has_new_line_or_comment_between || self.groups_should_break(f) {
                write!(f, group(&format_expanded));
            } else {
                let has_empty_line_before_tail = self.tail.first().is_some_and(MemberChainGroup::needs_empty_line);
                if has_empty_line_before_tail || self.last_group().will_break(f) {
                    write!(f, expand_parent());
                }
                write!(f, best_fitting!(format_one_line, format_expanded));
            }
        });

        write!(f, labelled(LabelId::of(JsLabels::MemberChain), &format_content));
    }
}

fn is_computed_array_member_access(member: &ChainMember<'_>) -> bool {
    matches!(member, ChainMember::ComputedMember(expression)
        if matches!(expression.kind(), ExprKind::Index { index, .. } if matches!(index.kind(), ExprKind::Number(_))))
}

/// Where the head ends. It is the first member, the calls and `[0]`s right after it, and, unless
/// it starts with a call, the member accesses up to the last before a call:
/// `a()()`, `a[0][1]`, `this.a.b` of `this.a.b.c()`.
fn get_split_index_of_head_and_tail_groups(members: &[ChainMember<'_>]) -> usize {
    let non_call_or_array_member_access_start = members
        .iter()
        .skip(1)
        .position(|member| match member {
            ChainMember::CallExpression { .. } | ChainMember::TSNonNullExpression(_) => false,
            ChainMember::ComputedMember(_) => !is_computed_array_member_access(member),
            _ => true,
        })
        .map_or(members.len(), |index| index + 1);

    if members.first().is_some_and(ChainMember::is_call_expression) {
        return non_call_or_array_member_access_start;
    }
    let rest = members.get(non_call_or_array_member_access_start..).unwrap_or_default();
    let member_end = rest
        .iter()
        .position(|member| !matches!(member, ChainMember::StaticMember(_) | ChainMember::ComputedMember(_)))
        .map_or(rest.len(), |index| index.saturating_sub(1));
    non_call_or_array_member_access_start + member_end
}

/// The groups after the head: each is some member accesses and the calls after them.
fn compute_remaining_groups<'a>(
    members: impl IntoIterator<Item = ChainMember<'a>>,
    f: &Formatter<'a>,
) -> TailChainGroups<'a> {
    let mut has_seen_call_expression = false;
    let mut groups_builder = MemberChainGroupsBuilder::default();

    for member in members {
        let span = member.span();
        let has_trailing_comment = !f.is_quiet()
            && f.comments().comments_after(span.end).first().is_some_and(|comment| {
                f.source_text().bytes_range(span.end, comment.span.start).trim_ascii().is_empty()
            });

        match member {
            // `[0]` goes with what is before it.
            ChainMember::ComputedMember(_) if is_computed_array_member_access(&member) => {
                groups_builder.start_or_continue_group(member);
            }
            ChainMember::StaticMember(_) | ChainMember::ComputedMember(_) => {
                if has_seen_call_expression {
                    groups_builder.close_group();
                    groups_builder.start_group(member);
                    has_seen_call_expression = false;
                } else {
                    groups_builder.start_or_continue_group(member);
                }
            }
            ChainMember::CallExpression { .. } => {
                groups_builder.start_or_continue_group(member);
                has_seen_call_expression = true;
            }
            ChainMember::TSNonNullExpression(_) | ChainMember::Node(_) => {
                groups_builder.start_or_continue_group(member);
            }
        }

        // So that the comment stays behind what it is written behind.
        if has_trailing_comment {
            groups_builder.close_group();
            has_seen_call_expression = false;
        }
    }
    groups_builder.finish()
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

/// Whether the call `expression` is a chain with more than one group after the head.
pub(crate) fn is_member_call_chain<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    MemberChain::from_call_expression(expression, f).tail.is_member_call_chain()
}

/// Whether the chain goes on in the callee of a call.
fn is_chain_callee(callee: Expr<'_>) -> bool {
    matches!(
        callee.as_ast_nodes(),
        AstNodes::StaticMemberExpression(_) | AstNodes::ComputedMemberExpression(_) | AstNodes::CallExpression(_)
    )
}

/// The links of the chain that ends with the call `root`, from the last to the first.
fn chain_members_iter<'a>(root: Expr<'a>, f: &Formatter<'a>) -> impl Iterator<Item = ChainMember<'a>> {
    let mut is_root = true;
    let mut next: Option<Expr<'a>> = None;

    std::iter::from_fn(move || {
        if is_root {
            is_root = false;
            next = root.callee().filter(|callee| is_chain_callee(*callee));
            return Some(ChainMember::CallExpression {
                expression: root,
                position: CallExpressionPosition::End,
            });
        }

        let expression = next.take()?;
        if is_type_cast_node(expression.span(), f).is_some() {
            return Some(ChainMember::Node(expression));
        }

        Some(match expression.as_ast_nodes() {
            AstNodes::CallExpression(_) => {
                next = expression.callee().filter(|callee| is_chain_callee(*callee));
                ChainMember::CallExpression {
                    expression,
                    position: match next.is_some() {
                        true => CallExpressionPosition::Middle,
                        false => CallExpressionPosition::Start,
                    },
                }
            }
            AstNodes::StaticMemberExpression(_) => {
                next = expression.object();
                ChainMember::StaticMember(expression)
            }
            AstNodes::ComputedMemberExpression(_) => {
                next = expression.object();
                ChainMember::ComputedMember(expression)
            }
            AstNodes::TSNonNullExpression(_) => {
                next = expression.expression();
                ChainMember::TSNonNullExpression(expression)
            }
            _ => ChainMember::Node(expression),
        })
    })
}
