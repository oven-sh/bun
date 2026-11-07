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
    /// Upstream's recursive search with its own stack, so that a long chain of dependencies cannot exhaust the
    /// thread's.
    fn depth_first(&mut self, root: u32) {
        if self.state.get(root as usize) != Some(&Visit::Unvisited) {
            return;
        }
        let (nodes, order) = (self.nodes, self.order);
        self.state[root as usize] = Visit::Visiting;
        self.path.push(root);
        let mut stack: Vec<(u32, usize)> = vec![(root, 0)];
        while let Some((element, next)) = stack.last_mut() {
            let element = *element;
            let at = element as usize;
            let Some(dependency) = nodes[at].dependencies.get(*next) else {
                stack.pop();
                self.path.pop();
                self.state[at] = Visit::Visited;
                continue;
            };
            *next += 1;
            let dependency_element = order.iter().copied().find(|&other| {
                other != element && nodes[other as usize].dependency_names.contains(dependency)
            });
            let Some(dependency_element) = dependency_element else {
                continue;
            };
            match self.state.get(dependency_element as usize) {
                Some(Visit::Visited) | None => {}
                Some(Visit::Visiting) => {
                    if let Some(cycle_start) =
                        self.path.iter().position(|&it| it == dependency_element)
                    {
                        for &on_cycle in &self.path[cycle_start..] {
                            self.in_cycle[on_cycle as usize] = true;
                        }
                    }
                }
                Some(Visit::Unvisited) => {
                    self.state[dependency_element as usize] = Visit::Visiting;
                    self.path.push(dependency_element);
                    stack.push((dependency_element, 0));
                }
            }
        }
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
    /// Upstream's recursive `visitNode` with its own stack. Upstream returns only for a visited node: one that is
    /// still being visited is reached again only through a cycle its cycle search missed, where upstream overflows.
    fn visit(&mut self, root: u32) {
        if self.state.get(root as usize) != Some(&Visit::Unvisited) {
            return;
        }
        let (nodes, order) = (self.nodes, self.order);
        self.state[root as usize] = Visit::Visiting;
        let mut stack: Vec<(u32, usize)> = vec![(root, 0)];
        while let Some((sorting_node, next)) = stack.last_mut() {
            let sorting_node = *sorting_node;
            let Some(&dependent) = order.get(*next) else {
                stack.pop();
                self.state[sorting_node as usize] = Visit::Visited;
                self.result.push(sorting_node);
                continue;
            };
            *next += 1;
            let candidate = &nodes[dependent as usize];
            if self.in_cycle[dependent as usize]
                || dependent == sorting_node
                || !is_node_dependent_on_other_node(candidate, &nodes[sorting_node as usize])
                || (self.ignore_eslint_disabled && candidate.is_eslint_disabled)
                || self.state.get(dependent as usize) != Some(&Visit::Unvisited)
            {
                continue;
            }
            self.state[dependent as usize] = Visit::Visiting;
            stack.push((dependent, 0));
        }
    }
}
