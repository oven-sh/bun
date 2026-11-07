//! `get-newlines-between-option.ts`, `get-newlines-between-errors.ts`, `make-newlines-between-fixes.ts`, without
//! `newlinesBetweenValueGetter`, which these rules never pass.

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

/// `computeNewlinesBetweenOptionForDifferentGroups`
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

/// `getNewlinesBetweenErrors`
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

/// `makeNewlinesBetweenFixes`. `None` for a `newlinesBetween` that [`Fixer::repeat`] refuses: upstream adds the
/// newlines one at a time and never finishes for such a number.
pub(crate) fn newlines_between_fixes<'a>(
    fixer: Fixer<'a>,
    nodes: &[SortingNode<'a>],
    sorted: &[u32],
    config: &Configuration,
    fixes: &mut Vec<Fix>,
) -> Option<()> {
    let file = fixer.file();
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
            text: range_replacement(fixer, file.slice(gap), expected, is_on_same_line)?,
        });
    }
    Some(())
}

/// `computeRangeReplacement`
fn range_replacement(
    fixer: Fixer<'_>,
    text: &[u8],
    newlines_between: f64,
    is_on_same_line: bool,
) -> Option<Vec<u8>> {
    let mut replacement = without_invalid_newlines(text);
    if newlines_between == 0.0 {
        return Some(replacement);
    }
    let count = (newlines_between.ceil() as u64).saturating_add(u64::from(is_on_same_line));
    let newlines = fixer.repeat(b'\n', count)?;
    // Upstream's `addNewlineBeforeFirstNewline`, `count` times at once.
    let at = strings::index_of_char_usize(&replacement, b'\n').unwrap_or(replacement.len());
    replacement.splice(at..at, newlines);
    Some(replacement)
}

/// `getStringWithoutInvalidNewlines`: `value.replaceAll(/\n\s*\n/gu, '\n')`. Upstream's second `replaceAll(/\n+/gu,
/// '\n')` changes nothing after that.
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
