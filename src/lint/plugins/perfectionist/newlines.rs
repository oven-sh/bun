//! The blank lines between two nodes of one list: `get-newlines-between-option.ts` decides how many there should be
//! from `newlinesBetween`, `newlinesInside` and the `groups` entries between the two groups,
//! `get-newlines-between-errors.ts` reports `missedSpacing` / `extraSpacing` and `make-newlines-between-fixes.ts`
//! removes or inserts them. `partition::lines_between` counts them.
//!
//! `newlinesBetweenValueGetter` is `sort-classes`' and `sort-modules`'; the four rules pass none.

use super::fixes::node_range;
use super::options::{
    Configuration, GroupEntry, GroupNames, Newlines, NewlinesInside, PartitionByComment,
};
use super::partition::lines_between;
use super::{Messages, SortingNode};
use bun_core::strings;
use bun_lint::prelude::*;

/// Upstream's `getNewlinesBetweenOption`: how many blank lines belong between a node of the group at `group_index`
/// and the next node, whose group is at `next_group_index` (neither before the other, as the callers check).
pub(crate) fn newlines_between_option(
    config: &Configuration,
    group_index: u32,
    next_group_index: u32,
) -> Newlines {
    if group_index == next_group_index {
        return newlines_inside_option(config, group_index);
    }
    if next_group_index >= group_index + 2 {
        return newlines_between_for_different_groups(config, group_index, next_group_index);
    }
    config.newlines_between
}

/// Upstream's `computeNewlinesBetweenOptionForDifferentGroups`: the `{ newlinesBetween }` entry right between the
/// two groups, or, over a longer stretch, the largest of the entries in it and of `newlinesBetween` wherever two
/// groups of it are adjacent; `'ignore'` if none is a count of at least one, and `0` if none is `'ignore'` either.
fn newlines_between_for_different_groups(
    config: &Configuration,
    group_index: u32,
    next_group_index: u32,
) -> Newlines {
    let groups = &config.groups;
    if next_group_index == group_index + 2 {
        return match groups.get(group_index as usize + 1) {
            Some(GroupEntry::NewlinesBetween(newlines)) => *newlines,
            _ => config.newlines_between,
        };
    }

    let start = (group_index as usize).min(groups.len());
    let end = (next_group_index as usize + 1).min(groups.len());
    let (mut max, mut has_ignore): (Option<f64>, bool) = (None, false);
    let mut consider = |newlines: Newlines| match newlines {
        Newlines::Ignore => has_ignore = true,
        Newlines::Count(count) => max = Some(max.map_or(count, |current| current.max(count))),
    };
    let mut previous_is_group = false;
    for entry in groups.get(start..end).unwrap_or_default() {
        match entry {
            GroupEntry::NewlinesBetween(newlines) => {
                consider(*newlines);
                previous_is_group = false;
            }
            GroupEntry::Names(_) | GroupEntry::Overrides(_) => {
                if previous_is_group {
                    consider(config.newlines_between);
                }
                previous_is_group = true;
            }
        }
    }
    match max {
        Some(max) if max >= 1.0 => Newlines::Count(max),
        _ if has_ignore => Newlines::Ignore,
        _ => Newlines::Count(0.0),
    }
}

/// Upstream's `computeNewlinesInsideOption`: the custom group's `newlinesInside`, else the `{ group }` entry's,
/// else the top-level one. An entry that is an array of names is no custom group's name.
fn newlines_inside_option(config: &Configuration, group_index: u32) -> Newlines {
    let global = match config.newlines_inside {
        NewlinesInside::FollowsNewlinesBetween => match config.newlines_between {
            Newlines::Ignore => Newlines::Ignore,
            Newlines::Count(_) => Newlines::Count(0.0),
        },
        NewlinesInside::Fixed(newlines) => newlines,
    };
    let (names, group_override) = match config.groups.get(group_index as usize) {
        Some(GroupEntry::Names(names)) => (names, None),
        Some(GroupEntry::Overrides(overrides)) => (&overrides.names, overrides.newlines_inside),
        Some(GroupEntry::NewlinesBetween(_)) | None => return global,
    };
    let custom_group = match names {
        GroupNames::One(name) => config
            .custom_groups
            .iter()
            .find(|custom| custom.name == *name)
            .and_then(|custom| custom.newlines_inside),
        GroupNames::Many(_) => None,
    };
    custom_group.or(group_override).unwrap_or(global)
}

/// Upstream's `getNewlinesBetweenErrors`: the spacing message for two adjacent nodes, if the blank lines between
/// them are not what the options ask for. Nothing across partitions, or where `left`'s group comes after `right`'s
/// (that pair gets an order error instead).
pub(crate) fn newlines_between_errors<'a>(
    file: &'a File<'a>,
    config: &Configuration,
    messages: &Messages,
    left: &SortingNode<'a>,
    right: &SortingNode<'a>,
) -> Option<&'static Message> {
    if left.group_index > right.group_index || left.partition_id != right.partition_id {
        return None;
    }
    let Newlines::Count(expected) =
        newlines_between_option(config, left.group_index, right.group_index)
    else {
        return None;
    };
    let actual = f64::from(lines_between(file, left.span, right.span));
    if actual < expected {
        Some(messages.missed_spacing)
    } else if actual > expected {
        Some(messages.extra_spacing)
    } else {
        None
    }
}

/// Upstream's `makeNewlinesBetweenFixes`: for each pair of adjacent positions whose sorted nodes want a count of
/// blank lines that the original nodes there do not have, replaces the text between the original nodes (their
/// parentheses and the comments that move with the next one excluded) with that count of blank lines.
pub(crate) fn newlines_between_fixes<'a>(
    file: &'a File<'a>,
    nodes: &[SortingNode<'a>],
    sorted: &[u32],
    config: &Configuration,
    fixes: &mut Vec<Fix>,
) {
    let sorted_at = |i: usize| nodes.get(*sorted.get(i)? as usize);
    for i in 0..sorted.len().saturating_sub(1) {
        let (Some(node), Some(next_node)) = (nodes.get(i), nodes.get(i + 1)) else {
            break;
        };
        let (Some(sorted_node), Some(next_sorted_node)) = (sorted_at(i), sorted_at(i + 1)) else {
            break;
        };
        if sorted_node.partition_id != next_sorted_node.partition_id
            || sorted_node.group_index > next_sorted_node.group_index
        {
            continue;
        }
        let Newlines::Count(expected) = newlines_between_option(
            config,
            sorted_node.group_index,
            next_sorted_node.group_index,
        ) else {
            continue;
        };
        if f64::from(lines_between(file, node.span, next_node.span)) == expected {
            continue;
        }
        let gap = Span::new(
            node_range(file, node, &PartitionByComment::Off).end,
            node_range(file, next_node, &PartitionByComment::Off).start,
        );
        let is_on_same_line = file.line_of(node.span.end) == file.line_of(next_node.span.start);
        fixes.push(Fix {
            span: gap,
            text: range_replacement(file.slice(gap), expected, is_on_same_line),
        });
    }
}

/// Upstream's `computeRangeReplacement`: the text between two nodes with its blank lines removed, then one line
/// break added before its first for each blank line wanted. Nodes on one line get one more: the first break only
/// separates them.
fn range_replacement(text: &[u8], newlines_between: f64, is_on_same_line: bool) -> Vec<u8> {
    let mut replacement = without_invalid_newlines(text);
    if newlines_between == 0.0 {
        return replacement;
    }
    let mut index = 0.0;
    while index < newlines_between {
        add_newline_before_first_newline(&mut replacement);
        index += 1.0;
    }
    if is_on_same_line {
        add_newline_before_first_newline(&mut replacement);
    }
    replacement
}

/// Upstream's `addNewlineBeforeFirstNewline`.
fn add_newline_before_first_newline(value: &mut Vec<u8>) {
    match strings::index_of_char_usize(value, b'\n') {
        Some(at) => value.insert(at, b'\n'),
        None => value.push(b'\n'),
    }
}

/// Upstream's `getStringWithoutInvalidNewlines`: `value.replaceAll(/\n\s*\n/gu, '\n')`. Each `\n` followed by
/// whitespace with another `\n` in it becomes one `\n`, up to the last `\n` of that whitespace. The
/// `replaceAll(/\n+/gu, '\n')` that follows upstream changes nothing: after this, no two `\n` are adjacent.
fn without_invalid_newlines(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'\n') {
        let (before, after) = rest.split_at(at);
        out.extend_from_slice(before);
        out.push(b'\n');
        let after = after.get(1..).unwrap_or_default();
        let whitespace_len = after.len() - strings::trim_js_whitespace_start(after).len();
        let whitespace = after.get(..whitespace_len).unwrap_or_default();
        rest = match strings::last_index_of_char(whitespace, b'\n') {
            Some(last) => after.get(last + 1..).unwrap_or_default(),
            None => after,
        };
    }
    out.extend_from_slice(rest);
    out
}
