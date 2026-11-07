//! `compute-group.ts`, `get-group-index.ts`, `does-custom-group-match.ts`, `generate-predefined-groups.ts`,
//! `compute-overridden-options-by-group-index.ts`. Predefined group candidates are looked up in upstream's order.

use super::options::{
    Configuration, CustomGroup, CustomGroupMatch, CustomGroupMatcher, FallbackSort, GroupEntry,
    GroupNames, Order, SortBy, SortOptions, SortType,
};
use smallvec::SmallVec;

/// The name of a group, as an index into `Configuration::group_names`. The text is for the `leftGroup` /
/// `rightGroup` of a message; the engine compares ids.
pub(crate) type GroupId = u32;

/// `computeGroup`. The order of `selectors` and `modifiers` decides which predefined name wins. `Err` is the
/// `SyntaxError` of a pattern that does not compile.
pub(crate) fn compute_group<'c>(
    config: &'c Configuration,
    selectors: &[&str],
    modifiers: &[&str],
    name: &[u8],
    value: &[u8],
) -> Result<GroupId, &'c str> {
    for custom in &config.custom_groups {
        if does_custom_group_match(custom, selectors, modifiers, name, value)?
            && is_in_groups(config, custom.name)
        {
            return Ok(custom.name);
        }
    }
    Ok(find_predefined_group(config, selectors, modifiers).unwrap_or(config.unknown))
}

/// Upstream's `getGroupIndex`: the index of the `groups` entry that names `group`, or `groups.length`.
pub(crate) fn group_index(config: &Configuration, group: GroupId) -> u32 {
    config
        .groups_index
        .get(group as usize)
        .copied()
        .unwrap_or(config.groups.len() as u32)
}

/// `computeGroupsNames(options.groups).has(name)`
fn is_in_groups(config: &Configuration, group: GroupId) -> bool {
    group_index(config, group) < config.groups.len() as u32
}

/// Upstream's `doesCustomGroupMatch`.
fn does_custom_group_match<'c>(
    custom: &'c CustomGroup,
    selectors: &[&str],
    modifiers: &[&str],
    name: &[u8],
    value: &[u8],
) -> Result<bool, &'c str> {
    match &custom.matcher {
        CustomGroupMatcher::AnyOf(subgroups) => {
            for subgroup in subgroups {
                if does_single_custom_group_match(subgroup, selectors, modifiers, name, value)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        CustomGroupMatcher::Single(single) => {
            does_single_custom_group_match(single, selectors, modifiers, name, value)
        }
    }
}

/// Upstream's `doesSingleCustomGroupMatch`: every condition the custom group has must hold, tested in its order, so
/// a pattern that does not compile only throws if the selector and modifiers matched.
fn does_single_custom_group_match<'c>(
    custom: &'c CustomGroupMatch,
    selectors: &[&str],
    modifiers: &[&str],
    name: &[u8],
    value: &[u8],
) -> Result<bool, &'c str> {
    if let Some(selector) = &custom.selector
        && !selectors.contains(&selector.as_ref())
    {
        return Ok(false);
    }
    for modifier in &custom.modifiers {
        if !modifiers.contains(&modifier.as_ref()) {
            return Ok(false);
        }
    }
    if let Some(patterns) = &custom.element_name_pattern
        && !patterns.first_match(name)?
    {
        return Ok(false);
    }
    if let Some(patterns) = &custom.element_value_pattern
        && !patterns.first_match(value)?
    {
        return Ok(false);
    }
    Ok(true)
}

/// `generatePredefinedGroups` followed by `predefinedGroups.find(group => groupsSet.has(group))`, without building
/// the list.
fn find_predefined_group(
    config: &Configuration,
    selectors: &[&str],
    modifiers: &[&str],
) -> Option<GroupId> {
    let mut combination: SmallVec<[&str; 4]> = SmallVec::new();
    for selector in selectors {
        for size in (1..=modifiers.len()).rev() {
            combination.clear();
            if let Some(found) =
                find_in_combinations(config, modifiers, 0, size, &mut combination, selector)
            {
                return Some(found);
            }
        }
        if let Some(found) = find_group_named(config, &[], selector) {
            return Some(found);
        }
    }
    None
}

/// Upstream's `getArrayCombinations`: the combinations of `size` modifiers, in the order the backtracking visits
/// them. Each is permuted and looked up before the next is built.
fn find_in_combinations<'m>(
    config: &Configuration,
    modifiers: &[&'m str],
    start: usize,
    size: usize,
    combination: &mut SmallVec<[&'m str; 4]>,
    selector: &str,
) -> Option<GroupId> {
    if combination.len() == size {
        let mut permutation: SmallVec<[&str; 4]> = combination.clone();
        return find_in_permutations(config, &mut permutation, 0, selector);
    }
    for (i, &modifier) in modifiers.iter().enumerate().skip(start) {
        combination.push(modifier);
        let found = find_in_combinations(config, modifiers, i + 1, size, combination, selector);
        combination.pop();
        if found.is_some() {
            return found;
        }
    }
    None
}

/// Upstream's `getPermutations`: the permutations of `elements`, in the order its swapping backtracking produces
/// them, each joined with the selector and looked up.
fn find_in_permutations(
    config: &Configuration,
    elements: &mut [&str],
    first: usize,
    selector: &str,
) -> Option<GroupId> {
    if first >= elements.len() {
        return find_group_named(config, elements, selector);
    }
    for i in first..elements.len() {
        elements.swap(first, i);
        let found = find_in_permutations(config, elements, first + 1, selector);
        elements.swap(first, i);
        if found.is_some() {
            return found;
        }
    }
    None
}

/// The [`GroupId`] of `[...modifiers, selector].join('-')` if `groups` names it.
fn find_group_named(config: &Configuration, modifiers: &[&str], selector: &str) -> Option<GroupId> {
    config
        .group_names
        .iter()
        .enumerate()
        .filter(|(id, _)| is_in_groups(config, *id as GroupId))
        .find(|(_, name)| is_joined_name(name, modifiers, selector))
        .map(|(id, _)| id as GroupId)
}

/// Whether `name` is `modifiers` and `selector` joined with `-`, compared without building the joined text.
fn is_joined_name(name: &[u8], modifiers: &[&str], selector: &str) -> bool {
    let mut rest = name;
    for modifier in modifiers {
        let Some(after) = rest
            .strip_prefix(modifier.as_bytes())
            .and_then(|it| it.strip_prefix(b"-"))
        else {
            return false;
        };
        rest = after;
    }
    rest == selector.as_bytes()
}

/// Upstream's `computeGroupName`: the name of a `groups` entry that is a single name. An array of names and a
/// `{ newlinesBetween }` have none, so no custom group's overrides apply to them.
pub(crate) fn group_name_of(entry: &GroupEntry) -> Option<GroupId> {
    match entry {
        GroupEntry::Names(GroupNames::One(id)) => Some(*id),
        GroupEntry::Overrides(overrides) => match overrides.names {
            GroupNames::One(id) => Some(id),
            GroupNames::Many(_) => None,
        },
        GroupEntry::Names(GroupNames::Many(_)) | GroupEntry::NewlinesBetween(_) => None,
    }
}

/// The custom group whose name the `groups` entry at `group_index` is, if any.
pub(crate) fn custom_group_at(config: &Configuration, group_index: u32) -> Option<&CustomGroup> {
    let name = group_name_of(config.groups.get(group_index as usize)?)?;
    config.custom_groups.iter().find(|it| it.name == name)
}

/// `computeOverriddenOptionsByGroupIndex`
pub(crate) fn options_by_group_index(config: &Configuration, group_index: u32) -> SortOptions {
    let mut options = config.sort;
    if let Some(GroupEntry::Overrides(overrides)) = config.groups.get(group_index as usize) {
        override_sort_options(
            &mut options,
            overrides.type_,
            overrides.order,
            overrides.sort_by,
            overrides.fallback_sort,
        );
    }
    if let Some(custom) = custom_group_at(config, group_index) {
        override_sort_options(
            &mut options,
            custom.type_,
            custom.order,
            custom.sort_by,
            custom.fallback_sort,
        );
    }
    options
}

/// `{ ...options, ...overrides, fallbackSort: { ...options.fallbackSort, ...overrides.fallbackSort } }`
fn override_sort_options(
    options: &mut SortOptions,
    type_: Option<SortType>,
    order: Option<Order>,
    sort_by: Option<SortBy>,
    fallback_sort: Option<FallbackSort>,
) {
    if let Some(type_) = type_ {
        options.type_ = type_;
    }
    if let Some(order) = order {
        options.order = order;
    }
    if let Some(sort_by) = sort_by {
        options.sort_by = sort_by;
    }
    if let Some(fallback) = fallback_sort {
        options.fallback_sort = FallbackSort {
            type_: fallback.type_,
            order: fallback.order.or(options.fallback_sort.order),
            sort_by: fallback.sort_by.or(options.fallback_sort.sort_by),
        };
    }
}
