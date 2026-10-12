use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::{Assertion, Kind as RegexKind, NodeType};
use bun_lint::regex::{self, Mode, parse_pattern};
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap, get_string_if_constant};
use bun_lint_oxlint::regex_pattern::run_on_regex_node;
use smallvec::SmallVec;

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

/// Whether some `\` in `pattern` is before what a backreference goes on with.
fn may_have_backreference(pattern: &[u8]) -> bool {
    let mut rest = pattern;
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        if matches!(rest.get(at + 1), Some(b'1'..=b'9' | b'k')) {
            return true;
        }
        rest = rest.get(at + 1..).unwrap_or_default();
    }
    false
}

/// `node` is the regular expression: a literal, or a call of `RegExp`.
fn check_regex<'a>(node: Expr<'a>, pattern: &[u8], flags: &[u8], cx: &Cx<'a, NoUselessBackreference>) {
    check_pattern(pattern, Mode::of_flags(flags), &|_| node.span(), &|it| it.raw().to_vec(), cx);
}

/// `place`: where a backreference is reported. `shown`: what is said of a backreference and of a group.
fn check_pattern<'a>(
    pattern: &[u8],
    mode: Mode,
    place: &dyn Fn(regex::Node<'_>) -> Span,
    shown: &dyn Fn(regex::Node<'_>) -> Vec<u8>,
    cx: &Cx<'a, NoUselessBackreference>,
) {
    if !may_have_backreference(pattern) {
        return;
    }
    let Ok(ast) = parse_pattern(pattern, mode, regex::Options::default()) else {
        return;
    };
    for bref in ast.root().descendants() {
        let RegexKind::Backreference { resolved, .. } = bref.kind() else {
            continue;
        };
        let mut problems: SmallVec<[(Message, regex::Node<'_>); 2]> = SmallVec::new();
        problems.extend(resolved.iter().map_while(|group| Some((problem_of(bref, group)?, group))));
        if problems.len() != resolved.len() {
            continue;
        }
        // The groups in other alternatives do not matter if there is one in the same.
        if problems.iter().any(|problem| problem.0.id != DISJUNCTIVE.id) {
            problems.retain(|problem| problem.0.id != DISJUNCTIVE.id);
        }
        let Some(&(message, group)) = problems.first() else {
            continue;
        };
        let other_groups = match problems.len() - 1 {
            0 => String::new(),
            1 => " and another group".to_owned(),
            count => format!(" and other {count} groups"),
        };
        cx.report(place(bref), message)
            .data("bref", shown(bref))
            .data("group", shown(group))
            .data("otherGroups", other_groups);
    }
}

impl Rule for NoUselessBackreference {
    const META: Meta = Meta::eslint("no-useless-backreference", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Regex, ExprTag::New]).calls_named(&["RegExp"]).finish();
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessBackreference
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Regex]);
        match (file.mentions("RegExp"), file.language().is_oxlint) {
            (false, _) => on,
            (true, true) => on.exprs(&[ExprTag::New]).calls_named(&["RegExp"]),
            // Finding the calls takes resolving every name of the file.
            (true, false) => on.finish(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint reads a pattern that is written where `RegExp` is called, and points at the backreference.
        if cx.language().is_oxlint {
            if let Some(pattern) = run_on_regex_node(e) {
                let place = |it: regex::Node<'_>| pattern.span(it.start(), it.end());
                check_pattern(pattern.text(), pattern.mode, &place, &|it| cx.slice(place(it)).to_vec(), cx);
            }
            return;
        }
        if let Some(literal) = e.as_regex() {
            check_regex(e, literal.pattern(), literal.flags(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
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
