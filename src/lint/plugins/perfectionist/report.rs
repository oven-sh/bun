//! `report-all-errors.ts`, `report-errors.ts`, `can-report-errors.ts`. Every message of a list carries the same fix,
//! made once.

use super::compare::compare;
use super::disabled::DisabledLines;
use super::fixes::{FixOptions, make_fixes};
use super::groups;
use super::newlines::{newlines_between_errors, newlines_between_option};
use super::options::{Configuration, Newlines, SortType};
use super::sort::{Sorted, is_node_dependent_on_other_node, nodes_in_circular_dependencies};
use super::{Messages, SortingNode};
use bun_core::strings;
use bun_lint::fix::IntoFix;
use bun_lint::prelude::*;
use std::borrow::Cow;
use std::cell::Cell;
use std::cmp::Ordering;

/// `canReportErrors`, with every rule having the order and spacing messages.
pub(crate) fn can_report_errors(config: &Configuration, can_have_dependencies: bool) -> bool {
    let has_groups = !config.groups.is_empty();
    has_groups
        || can_have_dependencies
        || config.sort.type_ != SortType::Unsorted
        || newlines_between_option(config, 0, 0) != Newlines::Ignore
}

/// Whether a list is in order without being built, to keep the common case off the path that allocates. Disabled
/// lines are excluded: a non-transitive comparator like `natural` can report a pair the sort moves apart.
pub(crate) fn is_in_order_without_groups<'a, N: Iterator<Item = SortingNode<'a>>>(
    config: &Configuration,
    can_have_dependencies: bool,
    disabled_lines: &DisabledLines,
    nodes: impl FnOnce(bool) -> N,
) -> bool {
    if !config.groups.is_empty()
        || can_have_dependencies
        || !disabled_lines.is_empty()
        || newlines_between_option(config, 0, 0) != Newlines::Ignore
        || config.has_invalid_pattern()
    {
        return false;
    }
    let options = groups::options_by_group_index(config, config.groups.len() as u32);
    let nodes = nodes(options.reads_size());
    let reached_invalid_locale = Cell::new(false);
    let mut previous: Option<SortingNode<'a>> = None;
    for node in nodes {
        if let Some(left) = &previous
            && compare(left, &node, options, config, &reached_invalid_locale) == Ordering::Greater
        {
            return false;
        }
        if reached_invalid_locale.get() {
            return false;
        }
        previous = Some(node);
    }
    true
}

/// Upstream's `reportAllErrors`. Every report in the list gets the same fix, `makeFixes` of the whole list.
pub(crate) fn report_all_errors<'a, R: Rule>(
    cx: &Cx<'a, R>,
    messages: &Messages,
    nodes: &[SortingNode<'a>],
    sorted: &Sorted,
    config: &Configuration,
    fix_options: FixOptions,
) {
    let file = cx.file();
    let index_in_all = inverse(&sorted.all, nodes.len());
    // Only `leftInfo.index >= indexOfRightExcludingEslintDisabled` reads this, for a disabled left node.
    let index_without_disabled = nodes
        .iter()
        .any(|it| it.is_eslint_disabled)
        .then(|| inverse(&sorted.without_disabled, nodes.len()));
    let in_cycle = messages.unexpected_dependency_order.map(|_| {
        let source_order: Vec<u32> = (0..nodes.len() as u32).collect();
        nodes_in_circular_dependencies(nodes, &source_order)
    });

    let mut cached_fix = None;
    let mut fix = |fixer: Fixer<'a>| -> Option<Fix> {
        cached_fix
            .get_or_insert_with(|| {
                make_fixes(fixer, nodes, &sorted.without_disabled, config, fix_options)?
                    .into_fix(file)
            })
            .clone()
    };

    for (i, right) in nodes.iter().enumerate() {
        let Some(left) = i.checked_sub(1).and_then(|at| nodes.get(at)) else {
            continue;
        };
        let left_index = index_in_all.get(i - 1).copied().unwrap_or(0);
        let right_index = index_in_all.get(i).copied().unwrap_or(0);

        let first_unordered_dependent = in_cycle
            .as_ref()
            .and_then(|in_cycle| first_unordered_node_dependent_on(nodes, in_cycle, i));

        let is_out_of_order = first_unordered_dependent.is_some()
            || left_index > right_index
            || (left.is_eslint_disabled
                && index_without_disabled
                    .as_ref()
                    .and_then(|it| it.get(i))
                    .is_some_and(|&right_without_disabled| left_index >= right_without_disabled));
        let order_message = is_out_of_order.then_some(
            match (
                first_unordered_dependent,
                messages.unexpected_dependency_order,
            ) {
                (Some(_), Some(message)) => message,
                _ if left.group_index == right.group_index => messages.unexpected_order,
                _ => messages.unexpected_group_order,
            },
        );
        let spacing_message = newlines_between_errors(file, config, messages, left, right);

        for message in [order_message, spacing_message].into_iter().flatten() {
            let mut report = cx
                .report(right.span, message)
                .data("left", single_line_name(left))
                .data("right", single_line_name(right));
            if std::ptr::eq(message, messages.unexpected_group_order) {
                report = report
                    .data("rightGroup", config.group_name(right.group).to_vec())
                    .data("leftGroup", config.group_name(left.group).to_vec());
            }
            if let Some(dependent) = first_unordered_dependent
                && messages
                    .unexpected_dependency_order
                    .is_some_and(|it| std::ptr::eq(message, it))
            {
                report = report.data("nodeDependentOnRight", dependent.name.clone());
            }
            report.fix(&mut fix);
        }
    }
}

/// Upstream's `createNodeIndexMap`: for each node, its position in `order`.
fn inverse(order: &[u32], len: usize) -> Vec<u32> {
    let mut index = vec![0; len];
    for (position, &node) in order.iter().enumerate() {
        if let Some(slot) = index.get_mut(node as usize) {
            *slot = position as u32;
        }
    }
    index
}

/// Upstream's `getFirstUnorderedNodeDependentOn`: the first node, in source order, before `node` that depends on
/// it and is not on a cycle.
fn first_unordered_node_dependent_on<'n, 'a>(
    nodes: &'n [SortingNode<'a>],
    in_cycle: &[bool],
    node: usize,
) -> Option<&'n SortingNode<'a>> {
    let right = nodes.get(node)?;
    nodes[..node]
        .iter()
        .enumerate()
        .find(|(i, before)| {
            !in_cycle.get(*i).copied().unwrap_or(false)
                && is_node_dependent_on_other_node(right, before)
        })
        .map(|(_, before)| before)
}

/// `toSingleLine(node.name)`, borrowed from the file where it can be.
fn single_line_name<'a>(node: &SortingNode<'a>) -> Cow<'a, [u8]> {
    match &node.name {
        Cow::Borrowed(name) => to_single_line(name),
        Cow::Owned(name) => Cow::Owned(to_single_line(name).into_owned()),
    }
}

/// Upstream's `toSingleLine`: `string.replaceAll(/\s{2,}/gu, ' ').trim()`. A single whitespace character stays
/// as it is; only runs of two or more become one space.
fn to_single_line(text: &[u8]) -> Cow<'_, [u8]> {
    let trimmed = strings::trim_js_whitespace(text);
    let mut out: Option<Vec<u8>> = None;
    let mut at = 0;
    while at < trimmed.len() {
        let rest = &trimmed[at..];
        let first = strings::js_whitespace_len(rest);
        if first == 0 {
            if let (Some(out), Some(&byte)) = (&mut out, rest.first()) {
                out.push(byte);
            }
            at += 1;
            continue;
        }
        let mut run = first;
        while run < rest.len() {
            let next = strings::js_whitespace_len(&rest[run..]);
            if next == 0 {
                break;
            }
            run += next;
        }
        if run > first {
            let out = out.get_or_insert_with(|| trimmed[..at].to_vec());
            out.push(b' ');
        } else if let Some(out) = &mut out {
            out.extend_from_slice(&rest[..run]);
        }
        at += run;
    }
    match out {
        Some(out) => Cow::Owned(out),
        None => Cow::Borrowed(trimmed),
    }
}
