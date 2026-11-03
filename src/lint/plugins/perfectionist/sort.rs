//! `sort-nodes.ts`, `sort-nodes-by-groups.ts`, `sort-nodes-by-dependencies.ts`,
//! `compute-nodes-in-circular-dependencies.ts`. An order is a list of original indices, one per sorted position.

use super::SortingNode;
use super::compare::compare;
use super::groups::options_by_group_index;
use super::options::{Configuration, SortBy, SortOptions};
use bun_lint::utils::sort::{merge_sort_indices, sort_indices};
use std::cell::Cell;
use std::cmp::Ordering;

/// `sortNodesExcludingEslintDisabled(false)` and `(true)`.
pub(crate) struct Sorted {
    pub(crate) all: Vec<u32>,
    pub(crate) without_disabled: Vec<u32>,
}

/// Upstream's `isNodeIgnoredForGroup`: which nodes of a group keep their place instead of being sorted.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum IgnoredForGroup {
    /// `sort-objects` and `sort-union-types` pass none.
    Nothing,
    /// `sort-object-types` and `sort-interfaces`: a member without a value (a method, an index signature) is not
    /// moved by a group whose `sortBy` is `"value"`.
    ValuelessWhenSortedByValue,
}

impl IgnoredForGroup {
    fn ignores(self, node: &SortingNode<'_>, options: SortOptions) -> bool {
        match self {
            IgnoredForGroup::Nothing => false,
            IgnoredForGroup::ValuelessWhenSortedByValue => {
                options.sort_by == SortBy::Value && node.value.is_empty()
            }
        }
    }
}

/// `sortNodes` on `order`, in place. `reached_invalid_locale` is set by a comparison that upstream's `localeCompare`
/// throws for (see [`compare`]).
pub(crate) fn sort_nodes<'a>(
    nodes: &[SortingNode<'a>],
    order: &mut [u32],
    is_ignored: &dyn Fn(&SortingNode<'a>) -> bool,
    options: SortOptions,
    config: &Configuration,
    reached_invalid_locale: &Cell<bool>,
) {
    let mut cmp = |a: u32, b: u32| -> Ordering {
        compare(
            &nodes[a as usize],
            &nodes[b as usize],
            options,
            config,
            reached_invalid_locale,
        )
    };
    if !order.iter().any(|&i| is_ignored(&nodes[i as usize])) {
        merge_sort_indices(order, &mut cmp);
        return;
    }
    let mut kept: Vec<u32> = order
        .iter()
        .copied()
        .filter(|&i| !is_ignored(&nodes[i as usize]))
        .collect();
    merge_sort_indices(&mut kept, &mut cmp);
    let mut next = kept.iter();
    for slot in order.iter_mut() {
        if is_ignored(&nodes[*slot as usize]) {
            continue;
        }
        if let Some(&i) = next.next() {
            *slot = i;
        }
    }
}

/// `sortNodesByGroups` over each partition in turn (`sortingNodeGroups.flatMap(..)`).
pub(crate) fn sort_nodes_by_groups<'a>(
    nodes: &[SortingNode<'a>],
    config: &Configuration,
    ignore_eslint_disabled: bool,
    ignored_for_group: IgnoredForGroup,
    reached_invalid_locale: &Cell<bool>,
) -> Vec<u32> {
    let mut order: Vec<u32> = (0..nodes.len() as u32).collect();
    let mut sorted: Vec<u32> = Vec::new();
    let mut start = 0;
    while start < nodes.len() {
        let partition = nodes[start].partition_id;
        let mut end = start + 1;
        while end < nodes.len() && nodes[end].partition_id == partition {
            end += 1;
        }
        sort_partition_by_groups(
            nodes,
            &mut order[start..end],
            &mut sorted,
            config,
            ignore_eslint_disabled,
            ignored_for_group,
            reached_invalid_locale,
        );
        start = end;
    }
    order
}

/// `sortNodesByGroups` for one partition, whose indices are `order`. `sorted` is scratch space.
fn sort_partition_by_groups<'a>(
    nodes: &[SortingNode<'a>],
    order: &mut [u32],
    sorted: &mut Vec<u32>,
    config: &Configuration,
    ignore_eslint_disabled: bool,
    ignored_for_group: IgnoredForGroup,
    reached_invalid_locale: &Cell<bool>,
) {
    let is_excluded = |node: &SortingNode<'a>| ignore_eslint_disabled && node.is_eslint_disabled;
    sorted.clear();
    sorted.extend(
        order
            .iter()
            .copied()
            .filter(|&i| !is_excluded(&nodes[i as usize])),
    );
    // `nodesByNonIgnoredGroupIndex` in the order of the group index: a stable sort by it keeps the nodes of a
    // group in their source order.
    sort_indices(sorted, &mut |a, b| {
        nodes[a as usize]
            .group_index
            .cmp(&nodes[b as usize].group_index)
    });
    let mut start = 0;
    while start < sorted.len() {
        let group_index = nodes[sorted[start] as usize].group_index;
        let mut end = start + 1;
        while end < sorted.len() && nodes[sorted[end] as usize].group_index == group_index {
            end += 1;
        }
        let options = options_by_group_index(config, group_index);
        let is_ignored = |node: &SortingNode<'a>| ignored_for_group.ignores(node, options);
        sort_nodes(
            nodes,
            &mut sorted[start..end],
            &is_ignored,
            options,
            config,
            reached_invalid_locale,
        );
        start = end;
    }
    let mut next = sorted.iter();
    for slot in order.iter_mut() {
        if is_excluded(&nodes[*slot as usize]) {
            continue;
        }
        if let Some(&i) = next.next() {
            *slot = i;
        }
    }
}

/// Upstream's `isNodeDependentOnOtherNode`: whether `other` reads a name that `node` binds. Upstream's self check
/// is the caller's: the two are never one node here.
pub(crate) fn is_node_dependent_on_other_node<'a>(
    node: &SortingNode<'a>,
    other: &SortingNode<'a>,
) -> bool {
    node.dependency_names
        .iter()
        .any(|name| other.dependencies.contains(name))
}

/// `computeNodesInCircularDependencies`. `order` decides which of two nodes binding one name a dependency leads to.
pub(crate) fn nodes_in_circular_dependencies(
    nodes: &[SortingNode<'_>],
    order: &[u32],
) -> Vec<bool> {
    let mut search = CycleSearch {
        nodes,
        order,
        in_cycle: vec![false; nodes.len()],
        state: vec![Visit::Unvisited; nodes.len()],
        path: Vec::new(),
    };
    for &element in order {
        search.depth_first(element);
    }
    search.in_cycle
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Visit {
    Unvisited,
    Visiting,
    Visited,
}

struct CycleSearch<'n, 'a> {
    nodes: &'n [SortingNode<'a>],
    order: &'n [u32],
    in_cycle: Vec<bool>,
    state: Vec<Visit>,
    path: Vec<u32>,
}

impl CycleSearch<'_, '_> {
    fn depth_first(&mut self, element: u32) {
        let at = element as usize;
        match self.state.get(at) {
            Some(Visit::Visited) | None => return,
            Some(Visit::Visiting) => {
                if let Some(cycle_start) = self.path.iter().position(|&it| it == element) {
                    for &on_cycle in &self.path[cycle_start..] {
                        self.in_cycle[on_cycle as usize] = true;
                    }
                }
                return;
            }
            Some(Visit::Unvisited) => {}
        }
        self.state[at] = Visit::Visiting;
        let depth = self.path.len();
        self.path.push(element);
        let (nodes, order) = (self.nodes, self.order);
        for dependency in &nodes[at].dependencies {
            let dependency_element = order.iter().copied().find(|&other| {
                other != element && nodes[other as usize].dependency_names.contains(dependency)
            });
            if let Some(dependency_element) = dependency_element {
                self.depth_first(dependency_element);
            }
        }
        self.path.truncate(depth);
        self.state[at] = Visit::Visited;
    }
}

/// `sortNodesByDependencies` over `order`, the nodes sorted by groups.
pub(crate) fn sort_nodes_by_dependencies(
    nodes: &[SortingNode<'_>],
    order: &[u32],
    ignore_eslint_disabled: bool,
) -> Vec<u32> {
    if nodes.iter().all(|node| node.dependency_names.is_empty()) {
        return order.to_vec();
    }
    let in_cycle = nodes_in_circular_dependencies(nodes, order);
    let mut walk = DependencyWalk {
        nodes,
        order,
        in_cycle,
        ignore_eslint_disabled,
        state: vec![Visit::Unvisited; nodes.len()],
        result: Vec::with_capacity(order.len()),
    };
    for &node in order {
        walk.visit(node);
    }
    walk.result
}

struct DependencyWalk<'n, 'a> {
    nodes: &'n [SortingNode<'a>],
    order: &'n [u32],
    in_cycle: Vec<bool>,
    ignore_eslint_disabled: bool,
    state: Vec<Visit>,
    result: Vec<u32>,
}

impl DependencyWalk<'_, '_> {
    fn visit(&mut self, sorting_node: u32) {
        let at = sorting_node as usize;
        // Upstream returns only for a visited node. A node that is still being visited is reached again only
        // through a cycle its cycle search missed (two nodes bind one name), where upstream overflows its stack.
        if self.state.get(at).is_none_or(|it| *it != Visit::Unvisited) {
            return;
        }
        self.state[at] = Visit::Visiting;
        let (nodes, order) = (self.nodes, self.order);
        let node = &nodes[at];
        for &dependent in order {
            let candidate = &nodes[dependent as usize];
            if self.in_cycle[dependent as usize]
                || dependent == sorting_node
                || !is_node_dependent_on_other_node(candidate, node)
            {
                continue;
            }
            if !self.ignore_eslint_disabled || !candidate.is_eslint_disabled {
                self.visit(dependent);
            }
        }
        self.state[at] = Visit::Visited;
        self.result.push(sorting_node);
    }
}
