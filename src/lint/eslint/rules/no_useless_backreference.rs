use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::{Assertion, Kind as RegexKind, NodeType, Nodes};
use bun_lint::regex::{self, Mode, parse_pattern};
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap, get_string_if_constant};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::ops::Range;

/// Disallow useless backreferences in regular expressions.
pub struct NoUselessBackreference;

const NESTED: Message = Message::new(
    "nested",
    "Backreference '{{ bref }}' will be ignored. It references group '{{ group }}'{{ otherGroups }} from within that group.",
);
const FORWARD: Message = Message::new(
    "forward",
    "Backreference '{{ bref }}' will be ignored. It references group '{{ group }}'{{ otherGroups }} which appears later in the pattern.",
);
const BACKWARD: Message = Message::new(
    "backward",
    "Backreference '{{ bref }}' will be ignored. It references group '{{ group }}'{{ otherGroups }} which appears before in the same lookbehind.",
);
const DISJUNCTIVE: Message = Message::new(
    "disjunctive",
    "Backreference '{{ bref }}' will be ignored. It references group '{{ group }}'{{ otherGroups }} which is in another alternative.",
);
const INTO_NEGATIVE_LOOKAROUND: Message = Message::new(
    "intoNegativeLookaround",
    "Backreference '{{ bref }}' will be ignored. It references group '{{ group }}'{{ otherGroups }} which is in a negative lookaround.",
);

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);

struct Lookaround {
    is_behind: bool,
    is_negative: bool,
}

fn as_lookaround(node: regex::Node<'_>) -> Option<Lookaround> {
    match node.kind() {
        RegexKind::Assertion(Assertion::Lookahead { negate, .. }) => Some(Lookaround {
            is_behind: false,
            is_negative: negate,
        }),
        RegexKind::Assertion(Assertion::Lookbehind { negate, .. }) => Some(Lookaround {
            is_behind: true,
            is_negative: negate,
        }),
        _ => None,
    }
}

/// Why `group` has not captured anything whenever `bref`, which refers to it, is matched.
fn problem_of<'r>(bref: regex::Node<'r>, group: regex::Node<'r>) -> Option<Message> {
    // Only its ancestors reach from where it starts to where it ends.
    let is_around_bref =
        |node: regex::Node<'r>| node.start() <= bref.start() && bref.end() <= node.end() && node != bref;
    if is_around_bref(group) {
        return Some(NESTED);
    }
    // From the group up to the lowest common ancestor, and the last node before that.
    let mut below_common = group;
    let mut is_in_negative_lookaround = false;
    let common = group.ancestors().find(|&ancestor| {
        if is_around_bref(ancestor) {
            return true;
        }
        is_in_negative_lookaround |= as_lookaround(ancestor).is_some_and(|it| it.is_negative);
        below_common = ancestor;
        false
    })?;
    if below_common.ty() == NodeType::Alternative {
        return Some(DISJUNCTIVE);
    }
    let lowest_common_lookaround = std::iter::once(common).chain(common.ancestors()).find_map(as_lookaround);
    let is_matching_backward = lowest_common_lookaround.is_some_and(|it| it.is_behind);
    if !is_matching_backward && bref.end() <= group.start() {
        return Some(FORWARD);
    }
    if is_matching_backward && group.end() <= bref.start() {
        return Some(BACKWARD);
    }
    is_in_negative_lookaround.then_some(INTO_NEGATIVE_LOOKAROUND)
}

/// From how many groups of one name they are not looked at one by one for each backreference.
const MANY_GROUPS: usize = 8;

/// The groups that the backreferences by one name refer to.
struct GroupsOfName<'r> {
    groups: Nodes<'r>,
    /// Where each starts. They ascend.
    starts: Vec<u32>,
    /// How many nodes are around the innermost negative lookaround that each is in, or 0: the second
    /// half. Each of the first half is the lower of the two at twice its index.
    negative_lookarounds: Vec<u32>,
}

impl<'r> GroupsOfName<'r> {
    /// `None` if they are not in the order of the pattern.
    fn new(groups: Nodes<'r>) -> Option<Self> {
        let starts: Vec<u32> = groups.iter().map(regex::Node::start).collect();
        if !starts.is_sorted_by(|a, b| a < b) {
            return None;
        }
        let mut negative_lookarounds = vec![0; starts.len()];
        negative_lookarounds.extend(groups.iter().map(|group| {
            let is_negative = |it: regex::Node<'r>| as_lookaround(it).is_some_and(|it| it.is_negative);
            group.ancestors().find(|it| is_negative(*it)).map_or(0, |it| it.ancestors().count() as u32)
        }));
        for at in (1..starts.len()).rev() {
            negative_lookarounds[at] = negative_lookarounds[2 * at].min(negative_lookarounds[2 * at + 1]);
        }
        Some(GroupsOfName {
            groups,
            starts,
            negative_lookarounds,
        })
    }

    /// Whether each of `range` is in a negative lookaround that has more than `depth` nodes around
    /// it.
    fn are_in_negative_lookarounds_below(&self, range: &Range<usize>, depth: u32) -> bool {
        let (mut from, mut to) = (range.start + self.starts.len(), range.end + self.starts.len());
        let mut lowest = u32::MAX;
        let at = |index: usize| self.negative_lookarounds.get(index).copied().unwrap_or(0);
        while from < to {
            if from % 2 == 1 {
                lowest = lowest.min(at(from));
                from += 1;
            }
            if to % 2 == 1 {
                to -= 1;
                lowest = lowest.min(at(to));
            }
            (from, to) = (from / 2, to / 2);
        }
        lowest > depth
    }

    /// What [`problem_of`] says of `bref` and each of the groups, if it has a problem with each: the
    /// first that is not `DISJUNCTIVE` with its group, and how many are not. If all are, the first
    /// and how many there are.
    ///
    /// The groups that are in an ancestor of `bref`, and not in the next one below, come one after
    /// the other, before `bref` or after it, and have the same problem. So it takes a few steps for
    /// each ancestor.
    fn problem_of(&self, bref: regex::Node<'r>) -> Option<(Message, regex::Node<'r>, usize)> {
        // With each: whether what is in it is matched backward.
        let mut ancestors: SmallVec<[(regex::Node<'r>, bool); 16]> = bref.ancestors().map(|it| (it, false)).collect();
        let mut is_matching_backward = false;
        for (ancestor, is_backward) in ancestors.iter_mut().rev() {
            is_matching_backward = as_lookaround(*ancestor).map_or(is_matching_backward, |it| it.is_behind);
            *is_backward = is_matching_backward;
        }

        let starts = &self.starts[..];
        let at = starts.partition_point(|&start| start < bref.start());
        // The groups in the ancestor below.
        let mut inner = at..at;
        let (mut first_before, mut first_after, mut count) = (None, None, 0);
        for (above, &(ancestor, is_backward)) in (0..ancestors.len() as u32).rev().zip(&ancestors) {
            // Most ancestors have no more groups in them than the one below.
            let (before, after) = (starts.get(..inner.start)?, starts.get(inner.end..)?);
            let from = match before.last() {
                Some(&last) if last >= ancestor.start() => before.partition_point(|&start| start < ancestor.start()),
                _ => inner.start,
            };
            let to = match after.first() {
                Some(&first) if first < ancestor.end() => inner.end + after.partition_point(|&start| start < ancestor.end()),
                _ => inner.end,
            };
            // Nothing else starts where a group starts.
            let is_nested = ancestor.ty() == NodeType::CapturingGroup && starts.get(from) == Some(&ancestor.start());
            let (before, after) = (from + usize::from(is_nested)..inner.start, inner.end..to);
            // What is in another alternative of the ancestor is `DISJUNCTIVE`.
            if ancestor.ty() == NodeType::Alternative {
                let into_negative_lookaround = |range: &Range<usize>| {
                    self.are_in_negative_lookarounds_below(range, above).then_some(INTO_NEGATIVE_LOOKAROUND)
                };
                if !before.is_empty() {
                    let message = if is_backward { BACKWARD } else { into_negative_lookaround(&before)? };
                    first_before = Some((message, before.start));
                    count += before.len();
                }
                if !after.is_empty() {
                    let message = if is_backward { into_negative_lookaround(&after)? } else { FORWARD };
                    first_after.get_or_insert((message, after.start));
                    count += after.len();
                }
            }
            if is_nested {
                first_before = Some((NESTED, from));
                count += 1;
            }
            inner = from..to;
        }
        let (message, first, count) = match first_before.or(first_after) {
            Some((message, first)) => (message, first, count),
            None => (DISJUNCTIVE, 0, starts.len()),
        };
        Some((message, self.groups.get(first)?, count))
    }
}

/// `node` is the regular expression: a literal, or a call of `RegExp`.
fn check_regex<'a>(node: Expr<'a>, pattern: &[u8], flags: &[u8], cx: &Cx<'a, NoUselessBackreference>) {
    if !strings::contains_char(pattern, b'\\') {
        return;
    }
    let Ok(ast) = parse_pattern(pattern, Mode::of_flags(flags), regex::Options::default()) else {
        return;
    };
    // By where the first of them starts.
    let mut groups_of_names: FxHashMap<u32, Option<GroupsOfName<'_>>> = FxHashMap::default();
    for bref in ast.root().descendants() {
        let RegexKind::Backreference { resolved, .. } = bref.kind() else {
            continue;
        };
        if cx.has_reported_too_much() {
            return;
        }
        let groups_of_name = (resolved.first().filter(|_| resolved.len() > MANY_GROUPS))
            .and_then(|first| groups_of_names.entry(first.start()).or_insert_with(|| GroupsOfName::new(resolved)).as_ref());
        let found = match groups_of_name {
            Some(groups) => groups.problem_of(bref),
            None => {
                let mut problems: SmallVec<[(Message, regex::Node<'_>); 2]> = SmallVec::new();
                problems.extend(resolved.iter().map_while(|group| Some((problem_of(bref, group)?, group))));
                if problems.len() != resolved.len() {
                    continue;
                }
                // The groups in other alternatives do not matter if there is one in the same.
                if problems.iter().any(|problem| problem.0.id != DISJUNCTIVE.id) {
                    problems.retain(|problem| problem.0.id != DISJUNCTIVE.id);
                }
                problems.first().map(|&(message, group)| (message, group, problems.len()))
            }
        };
        let Some((message, group, count)) = found else {
            continue;
        };
        let other_groups = match count - 1 {
            0 => String::new(),
            1 => " and another group".to_owned(),
            count => format!(" and other {count} groups"),
        };
        cx.report(node, message)
            .data("bref", bref.raw().to_vec())
            .data("group", group.raw().to_vec())
            .data("otherGroups", other_groups);
    }
}

impl NoUselessBackreference {
    fn check_literal<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Regex(literal) = e.kind() {
            check_regex(e, literal.pattern(), literal.flags(), cx);
        }
    }

    fn check_calls<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let scope = Some(file.scope());
        for reference in ReferenceTracker::new(file).iterate_global_references(&TRACE_MAP) {
            let (Some(node), Some(call)) = (reference.expr(), reference.call()) else {
                continue;
            };
            let argument = |i: usize| get_string_if_constant(call.args().get(i)?, scope);
            if let Some(pattern) = argument(0) {
                check_regex(node, &pattern, argument(1).as_deref().unwrap_or_default(), cx);
            }
        }
    }
}

impl Rule for NoUselessBackreference {
    const META: Meta = Meta::eslint("no-useless-backreference", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessBackreference
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.exprs([ExprTag::Regex], Self::check_literal);
        // Finding the calls takes resolving every name of the file.
        if file.mentions("RegExp") {
            on.finish(Self::check_calls);
        }
    }
}
