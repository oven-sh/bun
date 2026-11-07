//! `perfectionist/sort-union-types`: `rules/sort-union-types.ts` and `rules/sort-union-or-intersection-types/*` of
//! eslint-plugin-perfectionist. `crate::perfectionist` sorts and reports.

use crate::perfectionist::configuration_if::Subject;
use crate::perfectionist::fixes::{FixOptions, range_to_diff};
use crate::perfectionist::options::{RuleKind, RuleOptions};
use crate::perfectionist::sort::{IgnoredForGroup, Sorted};
use crate::perfectionist::{FileState, Messages, SortingNode, groups, partition, report, sort};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::Cell;

/// `addSafetySemicolonWhenInline: false` on every sorting node.
const FIX_OPTIONS: FixOptions = FixOptions {
    add_safety_semicolon_when_inline: false,
};

/// Enforce sorted union types.
pub struct SortUnionTypes {
    options: RuleOptions,
}

pub struct State(pub(crate) FileState);

const ORDER: &Message = &Message::new(
    "unexpectedUnionTypesOrder",
    "Expected \"{{right}}\" to come before \"{{left}}\".",
);
const GROUP_ORDER: &Message = &Message::new(
    "unexpectedUnionTypesGroupOrder",
    "Expected \"{{right}}\" ({{rightGroup}}) to come before \"{{left}}\" ({{leftGroup}}).",
);
const MISSED_SPACING: &Message = &Message::new(
    "missedSpacingBetweenUnionTypes",
    "Missed spacing between \"{{left}}\" and \"{{right}}\".",
);
const EXTRA_SPACING: &Message = &Message::new(
    "extraSpacingBetweenUnionTypes",
    "Extra spacing between \"{{left}}\" and \"{{right}}\".",
);

/// Upstream's `availableMessageIds`.
const MESSAGES: Messages = Messages {
    unexpected_order: ORDER,
    unexpected_group_order: GROUP_ORDER,
    unexpected_dependency_order: None,
    missed_spacing: MISSED_SPACING,
    extra_spacing: EXTRA_SPACING,
};

/// `context.id`, which an `eslint-disable` comment names.
const RULE_ID: &[u8] = b"perfectionist/sort-union-types";

/// Upstream's `tokenValueToIgnoreBefore`: a comment before the `|` of a member is the member's.
const TOKEN_TO_IGNORE_BEFORE: &str = "|";

/// The `switch` of `sortUnionOrIntersectionTypes` on the ESTree type. `typeof import("x")` is a `TSTypeQuery` there,
/// so it is an operator and not an import.
fn selectors(ty: TypeNode<'_>) -> &'static [&'static str] {
    match ty.kind() {
        TypeKind::Template(_)
        | TypeKind::StringLit(_)
        | TypeKind::NumberLit(_)
        | TypeKind::BigIntLit { .. }
        | TypeKind::BoolLit(_) => &["literal"],
        TypeKind::IndexedAccess { .. }
        | TypeKind::Ref { .. }
        | TypeKind::Array(_)
        | TypeKind::Infer(_) => &["named"],
        TypeKind::Intersection(_) => &["intersection"],
        TypeKind::Keyword(Keyword::Undefined | Keyword::Null | Keyword::Void) => &["nullish"],
        TypeKind::Cond { .. } => &["conditional"],
        TypeKind::Fn(_) => &["function"],
        TypeKind::Keyword(Keyword::Intrinsic) => &[],
        TypeKind::Keyword(_) => &["keyword"],
        TypeKind::Keyof(_)
        | TypeKind::Readonly(_)
        | TypeKind::UniqueSymbol
        | TypeKind::Unique(_)
        | TypeKind::Typeof { .. }
        | TypeKind::Import {
            is_typeof: true, ..
        } => &["operator"],
        TypeKind::Object(_) | TypeKind::Mapped(_) => &["object"],
        TypeKind::Import {
            is_typeof: false, ..
        } => &["import"],
        TypeKind::Tuple(_) => &["tuple"],
        TypeKind::Union(_) => &["union"],
        TypeKind::Error | TypeKind::Heritage { .. } | TypeKind::Predicate { .. } => &[],
    }
}

/// Upstream's `computeNodeName`: the member's text. A nested union or intersection starts at its leading `|` or
/// `&` when it has one, and loses it (`/^\s*[&|]\s*/u`) so that both spellings sort the same.
fn node_name<'a>(file: &'a File<'a>, ty: TypeNode<'a>) -> &'a [u8] {
    let text = file.slice(ty.span());
    if !matches!(ty.tag(), TypeTag::Union | TypeTag::Intersection) {
        return text;
    }
    let after_space = strings::trim_js_whitespace_start(text);
    match after_space
        .strip_prefix(b"|")
        .or_else(|| after_space.strip_prefix(b"&"))
    {
        Some(rest) => strings::trim_js_whitespace_start(rest),
        None => text,
    }
}

/// `getNodeRange`'s `isParenthesized` step: the member widened to the one pair of parentheses directly around it,
/// not to every pair like `TypeNode::outer_span`. For `B | ((A))` upstream moves `(A)` and leaves the outer pair.
fn outer_span_once<'a>(file: &'a File<'a>, span: Span) -> Span {
    let text = file.text();
    let before = file.end_of_token_before(span.start) as usize;
    if before == 0 || text.get(before - 1) != Some(&b'(') {
        return span;
    }
    let after = skip_trivia(text, span.end);
    if text.get(after as usize) != Some(&b')') {
        return span;
    }
    Span::new(before as u32 - 1, after + 1)
}

impl SortUnionTypes {
    /// Upstream's `sortUnionType`, through `sortUnionOrIntersectionTypes`.
    fn sort_union_type<'a>(
        &self,
        ty: TypeNode<'a>,
        types: List<'a, TypeNode<'a>>,
        cx: &mut Cx<'a, Self>,
    ) {
        let file = cx.file();
        let state = &cx.state.0;

        let names: SmallVec<[&'a [u8]; 8]> =
            types.iter().map(|member| node_name(file, member)).collect();
        let Some((config, _)) = state.pick(
            &self.options,
            Subject::Union(ty),
            &names.iter().copied(),
            cx,
            ty.span(),
        ) else {
            return;
        };
        if !report::can_report_errors(config, false) {
            return;
        }
        let disabled_lines = state.disabled_lines(file, RULE_ID);
        let for_comparison = |with_size: bool| {
            types.iter().zip(&names).map(move |(member, &name)| {
                let span = member.span();
                let size = if with_size { range_to_diff(file, span) } else { 0 };
                SortingNode::for_comparison(span, name, b"", size)
            })
        };
        if report::is_in_order_without_groups(config, false, disabled_lines, for_comparison) {
            return;
        }

        let mut nodes: Vec<SortingNode<'a>> = Vec::with_capacity(types.len());
        let mut partition_id = 1;
        let mut last: Option<Span> = None;
        for (member, &name) in types.iter().zip(&names) {
            let span = member.span();
            let group = match groups::compute_group(config, selectors(member), &[], name, b"") {
                Ok(group) => group,
                Err(message) => {
                    cx.throw(ty, "SyntaxError", message);
                    return;
                }
            };
            match partition::should_partition(
                file,
                config,
                last,
                span,
                Some(TOKEN_TO_IGNORE_BEFORE),
            ) {
                Ok(true) => partition_id += 1,
                Ok(false) => {}
                Err(message) => {
                    cx.throw(ty, "SyntaxError", message);
                    return;
                }
            }
            nodes.push(SortingNode {
                span,
                outer_span: outer_span_once(file, span),
                name: Cow::Borrowed(name),
                value: b"",
                size: range_to_diff(file, span),
                group,
                group_index: groups::group_index(config, group),
                partition_id,
                is_eslint_disabled: disabled_lines.contains(file, span),
                dependency_names: SmallVec::new(),
                dependencies: SmallVec::new(),
            });
            last = Some(span);
        }

        // `for (let nodes of formattedMembers) reportAllErrors(..)`: each partition is sorted, reported and fixed on
        // its own, so a fix never spans two partitions.
        let reached_invalid_locale = Cell::new(false);
        let mut start = 0;
        while let Some(first) = nodes.get(start) {
            let partition_id = first.partition_id;
            let mut end = start + 1;
            while nodes
                .get(end)
                .is_some_and(|node| node.partition_id == partition_id)
            {
                end += 1;
            }
            let partition = &nodes[start..end];
            start = end;

            // `sortNodesExcludingEslintDisabled`
            let sort_all = |ignore_eslint_disabled| {
                sort::sort_nodes_by_groups(
                    partition,
                    config,
                    ignore_eslint_disabled,
                    IgnoredForGroup::Nothing,
                    &reached_invalid_locale,
                )
            };
            let sorted = Sorted {
                all: sort_all(false),
                without_disabled: sort_all(true),
            };
            if reached_invalid_locale.get()
                && let Some(message) = &config.invalid_locale
            {
                cx.throw(ty, "RangeError", message.clone());
                return;
            }
            report::report_all_errors(cx, &MESSAGES, partition, &sorted, config, FIX_OPTIONS);
        }
    }
}

impl Rule for SortUnionTypes {
    const META: Meta = Meta::plugin(Plugin::Perfectionist, "sort-union-types", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_exit();
    const ON: On = On::new().types(&[TypeTag::Union]);
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        SortUnionTypes {
            options: RuleOptions::new(options, RuleKind::UnionTypes),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        RuleOptions::validate(options)
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        Some(State(self.options.file_state(file.settings())))
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Union(types) = ty.kind() {
            self.sort_union_type(ty, types, cx);
        }
    }
}
