// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Infers mutable ranges for identifiers and populates Place effects.
//!
//! Ported from TypeScript `src/Inference/InferMutationAliasingRanges.ts`.
//!
//! This pass builds an abstract model of the heap and interprets the effects of
//! the given function in order to determine:
//! - The mutable ranges of all identifiers in the function
//! - The externally-visible effects of the function (mutations of params/context
//!   vars, aliasing between params/context-vars/return-value)
//! - The legacy `Effect` to store on each Place

use crate::collections::{FxHashMap, FxHashSet as HashSet, IdBitSet, IdMap};

use crate::diagnostics::{CompilerDiagnostic, cold_invariant};
use crate::hir::environment::Environment;
use crate::hir::type_config::{ValueKind, ValueReason};
use crate::hir::visitors::{
    for_each_instruction_value_lvalue_mut, for_each_instruction_value_operand_mut,
    for_each_terminal_operand_mut,
};
use crate::hir::{
    AliasingEffect, BlockId, Effect, EvaluationOrder, FunctionId, HirFunction, Identifier,
    IdentifierId, InstructionValue, MutationReason, Place, SourceLocation, is_jsx_type,
    is_primitive_type,
};

// =============================================================================
// MutationKind
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MutationKind {
    Conditional = 1,
    Definite = 2,
}

// =============================================================================
// Node and AliasingState
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EdgeKind {
    Capture,
    Alias,
    MaybeAlias,
    /// Not in upstream, like the four below. Such a link is in the place of a stretch of links:
    /// those from one node to the destinations of a [`Group`], or to one node from its sources.
    /// `Link::node` is the group, and `Link::index` is that of the first link of the stretch.
    ///
    /// In `edges` of a mutable source: a `Capture` to each mutable destination, and a `MaybeAlias`
    /// to each other one.
    DestinationsOfMutable,
    /// In `edges` of a context source: a `MaybeAlias` to each destination.
    DestinationsOfContext,
    /// In `captures` of a mutable destination: the mutable sources.
    MutableSources,
    /// In `maybe_aliases` of a mutable destination: the context sources.
    ContextSources,
    /// In `maybe_aliases` of a context destination: all sources.
    Sources,
}

impl EdgeKind {
    fn is_group(self) -> bool {
        !matches!(
            self,
            EdgeKind::Capture | EdgeKind::Alias | EdgeKind::MaybeAlias
        )
    }
}

/// The lists of a node that hold where its value comes from. Each has a node once, with the index
/// of the first edge from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Incoming {
    CreatedFrom,
    Captures,
    Aliases,
    MaybeAliases,
}

/// Where a node is in `AliasingState::nodes`.
type NodeAt = u32;

/// An item of a [`List`].
#[derive(Debug, Clone, Copy)]
struct Link {
    index: u32,
    node: NodeAt,
    kind: EdgeKind,
    next: u32,
}

/// A list, in the order of insertion, whose items are in `AliasingState::links`.
#[derive(Debug, Clone, Copy)]
struct List {
    first: u32,
    last: u32,
}

impl List {
    /// Past the end of any `links`.
    const NONE: u32 = u32::MAX;
    const EMPTY: List = List {
        first: List::NONE,
        last: List::NONE,
    };

    fn iter(self, links: &[Link]) -> impl Iterator<Item = &Link> {
        let mut at = self.first;
        std::iter::from_fn(move || {
            let link = links.get(at as usize)?;
            at = link.next;
            Some(link)
        })
    }

    fn push(&mut self, links: &mut Vec<Link>, index: u32, node: NodeAt, kind: EdgeKind) {
        let at = links.len() as u32;
        links.push(Link {
            index,
            node,
            kind,
            next: List::NONE,
        });
        match links.get_mut(self.last as usize) {
            Some(last) => last.next = at,
            None => self.first = at,
        }
        self.last = at;
    }

    /// The items with where each is in `links`. A later item is further on in `links`.
    fn positions(self, links: &[Link]) -> impl Iterator<Item = (u32, &Link)> {
        let mut at = self.first;
        std::iter::from_fn(move || {
            let link = links.get(at as usize)?;
            let here = at;
            at = link.next;
            Some((here, link))
        })
    }

    /// The items that are at `from..=to` of `links`, as a list of their own.
    fn stretch(self, links: &[Link], from: u32, to: u32) -> Option<List> {
        let mut within = self
            .positions(links)
            .map(|(at, _)| at)
            .skip_while(|&at| at < from)
            .take_while(|&at| at <= to);
        let first = within.next()?;
        let last = within.last().unwrap_or(first);
        Some(List { first, last })
    }

    /// The items of a list that `stretch` gave: in `links`, its last item has others after it.
    fn iter_stretch(self, links: &[Link]) -> impl Iterator<Item = &Link> {
        let mut at = self.first;
        std::iter::from_fn(move || {
            let link = links.get(at as usize)?;
            at = if at == self.last {
                List::NONE
            } else {
                link.next
            };
            Some(link)
        })
    }
}

/// Not in upstream. A call of a function that nothing is known of has an edge from each operand to
/// each other one, and a call of a closure has an edge for each two of the variables that the
/// closure keeps. A walk that comes to one of `n` such nodes comes to all, and reads the `n` links
/// of each. So the graph has the nodes of such a call once, and a list has one link in the place of
/// its links to them or from them: see [`EdgeKind::DestinationsOfMutable`]. A walk comes to the
/// same nodes, with the same entries, in the same order.
///
/// Each source has an edge to each destination but itself: a `Capture` where both are mutable, and
/// a `MaybeAlias` where one is a context value.
#[derive(Debug, Clone, Copy)]
struct Group {
    /// Whether the edges are source by source, as a call has them. Else they are destination by
    /// destination, as the effects of a closure are.
    by_source: bool,
    destinations: Members,
    sources: Members,
    mutable_sources: Members,
    context_sources: Members,
}

impl Group {
    /// How many edges of one node are a run: see `AliasingState::group_operands`. A walk reads the
    /// links of fewer nodes sooner than it goes through a group of them.
    const SHORTEST_RUN: usize = 32;

    /// Whether each walk is made without the group too: see `AliasingState::is_as_without_groups`.
    #[cfg(debug_assertions)]
    fn is_compared(&self) -> bool {
        self.destinations.len.max(self.sources.len) <= 64
    }
}

/// A stretch of `AliasingState::members`.
#[derive(Debug, Clone, Copy)]
struct Members {
    start: u32,
    len: u32,
}

#[derive(Debug, Clone, Copy)]
struct Member {
    node: NodeAt,
    /// On the side that the edges of the group are in the order of (`Group::by_source`): the index
    /// of the first edge of this node. A walk sees the edges of the nodes whose first edge is
    /// before its own index: the edges of a node follow one another, so no walk is between them.
    index: u32,
    is_mutable: bool,
}

/// Which members of a group a walk has come to, for every [`Cursor`] of that walk. A group has
/// `Arrived::PER_GROUP` of them: one for each sequence of members and each kind of mutation that a
/// walk comes to those members with.
#[derive(Debug, Clone, Default)]
struct Arrived {
    walk: u32,
    /// For each count of members from the first: that count less the members at its end that the
    /// walk has come to, as far as a cursor has found them.
    left: Vec<u32>,
}

impl Arrived {
    const PER_GROUP: usize = 6;

    /// How many of the first `count` members are left.
    fn left(&mut self, count: u32) -> u32 {
        let mut left = count;
        while self.left[left as usize] != left {
            left = self.left[left as usize];
        }
        let mut at = count;
        while at != left {
            at = std::mem::replace(&mut self.left[at as usize], left);
        }
        left
    }
}

/// Where a walk is in the members that a link of a group is in the place of. It is on the stack of
/// the walk where the entries of those members would be, and gives them one at a time from the last
/// to the first: the order in which a walk takes entries off. It passes over a member that the walk
/// has come to, whose entry would do nothing when its turn comes.
#[derive(Debug, Clone, Copy)]
struct Cursor {
    group: u32,
    kind: EdgeKind,
    /// How many members, from the first, it has yet to give.
    left: u32,
}

/// A table by identifier. A function expression has a few stretches of the identifiers of its
/// component, so there are only the pages that were written to.
#[cfg_attr(debug_assertions, derive(Clone))]
struct ByIdentifier<T> {
    /// Which of the pages in `entries` it is, counted from one. Zero: none.
    pages: Vec<u32>,
    entries: Vec<T>,
    empty: T,
}

impl<T: Copy> ByIdentifier<T> {
    const PAGE: usize = 32;

    fn new(identifiers: usize, empty: T) -> Self {
        ByIdentifier {
            pages: vec![0; identifiers.div_ceil(Self::PAGE)],
            entries: Vec::new(),
            empty,
        }
    }

    #[inline]
    fn get(&self, id: IdentifierId) -> T {
        let id = id.0 as usize;
        match self.pages[id / Self::PAGE] {
            0 => self.empty,
            page => self.entries[(page as usize - 1) * Self::PAGE + id % Self::PAGE],
        }
    }

    #[inline]
    fn entry(&mut self, id: IdentifierId) -> &mut T {
        let id = id.0 as usize;
        let page = &mut self.pages[id / Self::PAGE];
        if *page == 0 {
            let len = self.entries.len() + Self::PAGE;
            self.entries.resize(len, self.empty);
            *page = (len / Self::PAGE) as u32;
        }
        &mut self.entries[(*page as usize - 1) * Self::PAGE + id % Self::PAGE]
    }
}

#[derive(Debug, Clone)]
struct MutationInfo {
    kind: MutationKind,
    loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
enum NodeValue {
    /// Something was created from the identifier, which has no node, or none yet.
    Missing,
    Object,
    Phi,
    Function {
        function_id: FunctionId,
    },
}

#[derive(Debug, Clone)]
struct Node {
    id: IdentifierId,
    /// Of this node alone: another node made for the same identifier has another.
    serial: u32,
    created_from: List,
    captures: List,
    aliases: List,
    maybe_aliases: List,
    edges: List,
    transitive: Option<MutationInfo>,
    local: Option<MutationInfo>,
    last_mutated: u32,
    mutation_reason: Option<MutationReason>,
    value: NodeValue,
    /// The last walk that came here and the kind that it came with: see [`AliasingState::arrival`].
    arrival: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Direction {
    Backwards,
    Forwards,
    /// Not to a node: to the members of a group that a walk has yet to go to. `QueueEntry::place`
    /// is the [`Cursor`], and the rest is that of the entry whose node has the link of the group.
    Members,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct QueueEntry {
    place: NodeAt,
    transitive: bool,
    direction: Direction,
    kind: MutationKind,
}

// A function that has no group gives nothing for them: the link and the entry of a group are of
// the types that all have.
const _: () = assert!(size_of::<Link>() == 16 && size_of::<QueueEntry>() == 8);

/// An edge as `AliasingState::group_operands` reads it: a link of `Node::edges`, and the node that
/// has it.
struct Edge {
    /// Where the link is in `links`.
    at: u32,
    from: NodeAt,
    into: NodeAt,
    index: u32,
    kind: EdgeKind,
}

/// The edges `first..=last` of those that `AliasingState::group_operands` reads: all from `node`,
/// or all to it.
struct Run {
    first: usize,
    last: usize,
    node: NodeAt,
}

impl Run {
    /// The runs of the edges that are in none.
    fn all(edges: &[Edge], is_in_run: &mut [bool], shortest: usize, by_source: bool) -> Vec<Run> {
        let node_of = |edge: &Edge| if by_source { edge.from } else { edge.into };
        let is_in_a_group =
            |edge: &Edge| matches!(edge.kind, EdgeKind::Capture | EdgeKind::MaybeAlias);
        let mut runs = Vec::new();
        let mut first = 0;
        while let Some(edge) = edges.get(first) {
            let mut last = first;
            if is_in_a_group(edge) && !is_in_run[first] {
                while edges.get(last + 1).is_some_and(|next| {
                    is_in_a_group(next)
                        && !is_in_run[last + 1]
                        && next.index == edges[last].index + 1
                        && node_of(next) == node_of(edge)
                }) {
                    last += 1;
                }
                if last - first + 1 >= shortest {
                    is_in_run[first..=last].fill(true);
                    runs.push(Run {
                        first,
                        last,
                        node: node_of(edge),
                    });
                }
            }
            first = last + 1;
        }
        runs
    }

    /// The edges of the run but those from its node to itself: a walk at a node does not go to it.
    fn other_edges<'a>(
        &self,
        edges: &'a [Edge],
    ) -> impl Iterator<Item = &'a Edge> + Clone + use<'a> {
        (edges[self.first..=self.last].iter()).filter(|edge| edge.from != edge.into)
    }

    /// The other ends of those edges.
    fn others<'a>(
        &self,
        edges: &'a [Edge],
        by_source: bool,
    ) -> impl Iterator<Item = NodeAt> + Clone + use<'a> {
        self.other_edges(edges)
            .map(move |edge| if by_source { edge.into } else { edge.from })
    }

    /// The sequence that the other ends of this run and of `next` are, but that each run is without
    /// its own node.
    fn merged(&self, next: &Run, edges: &[Edge], by_source: bool) -> Option<Vec<NodeAt>> {
        let mut mine = self.others(edges, by_source).peekable();
        let mut theirs = next.others(edges, by_source).peekable();
        let mut merged = Vec::new();
        loop {
            match (mine.peek().copied(), theirs.peek().copied()) {
                (None, None) => return Some(merged),
                (Some(a), Some(b)) if a == b => {
                    merged.push(a);
                    mine.next();
                    theirs.next();
                }
                (_, Some(b)) if b == self.node => {
                    merged.push(b);
                    theirs.next();
                }
                (Some(a), _) if a == next.node => {
                    merged.push(a);
                    mine.next();
                }
                _ => return None,
            }
        }
    }
}

#[cfg_attr(debug_assertions, derive(Clone))]
struct AliasingState {
    nodes: Vec<Node>,
    /// Where the node of an identifier is, counted from one. Zero: nowhere.
    node_of: ByIdentifier<u32>,
    links: Vec<Link>,
    /// What is in the incoming lists that are too long to look through.
    long_lists: HashSet<(u32, Incoming, NodeAt)>,
    serials: u32,
    walks: u32,
    queue: Vec<QueueEntry>,
    /// Whether a transitive walk that no index holds back goes along every edge both ways,
    /// however it came to the node: there is no phi, and each edge is still in the lists of both
    /// its ends.
    is_symmetric: bool,
    /// None in most functions: see [`Group`].
    groups: Vec<Group>,
    members: Vec<Member>,
    arrived: Vec<Arrived>,
    cursors: Vec<Cursor>,
    /// The state as it was before it had groups: see `is_as_without_groups`.
    #[cfg(debug_assertions)]
    without_groups: Option<Box<AliasingState>>,
    /// The entries of the nodes that the walk in hand came to, in the two states that are compared.
    #[cfg(debug_assertions)]
    visits: Option<Vec<QueueEntry>>,
}

impl AliasingState {
    fn new(identifiers: usize, instructions: usize) -> Self {
        AliasingState {
            nodes: Vec::with_capacity(instructions),
            node_of: ByIdentifier::new(identifiers, 0),
            links: Vec::with_capacity(instructions * 2),
            long_lists: HashSet::default(),
            serials: 0,
            walks: 0,
            queue: Vec::new(),
            is_symmetric: true,
            groups: Vec::new(),
            members: Vec::new(),
            arrived: Vec::new(),
            cursors: Vec::new(),
            #[cfg(debug_assertions)]
            without_groups: None,
            #[cfg(debug_assertions)]
            visits: None,
        }
    }

    fn create(&mut self, id: IdentifierId, value: NodeValue) -> NodeAt {
        self.serials += 1;
        if matches!(value, NodeValue::Phi | NodeValue::Missing) {
            self.is_symmetric = false;
        }
        let node = Node {
            id,
            serial: self.serials,
            created_from: List::EMPTY,
            captures: List::EMPTY,
            aliases: List::EMPTY,
            maybe_aliases: List::EMPTY,
            edges: List::EMPTY,
            transitive: None,
            local: None,
            last_mutated: 0,
            mutation_reason: None,
            value,
            arrival: 0,
        };
        let node_of = self.node_of.entry(id);
        if *node_of == 0 {
            self.nodes.push(node);
            *node_of = self.nodes.len() as u32;
        } else {
            self.nodes[*node_of as usize - 1] = node;
            self.is_symmetric = false;
        }
        *node_of - 1
    }

    fn at(&self, id: IdentifierId) -> Option<NodeAt> {
        let at = self.node_of.get(id).checked_sub(1)?;
        let is_missing = matches!(self.nodes[at as usize].value, NodeValue::Missing);
        (!is_missing).then_some(at)
    }

    fn node(&self, id: IdentifierId) -> Option<&Node> {
        Some(&self.nodes[self.at(id)? as usize])
    }

    /// `from` goes into a list of `into`, if it is not in the list.
    fn add_incoming(&mut self, which: Incoming, index: u32, from: NodeAt, into: NodeAt) {
        const SHORT: usize = 8;
        let node = &mut self.nodes[into as usize];
        let list = match which {
            Incoming::CreatedFrom => &mut node.created_from,
            Incoming::Captures => &mut node.captures,
            Incoming::Aliases => &mut node.aliases,
            Incoming::MaybeAliases => &mut node.maybe_aliases,
        };
        let mut len = 0;
        for link in list.iter(&self.links).take(SHORT + 1) {
            if link.node == from {
                return;
            }
            len += 1;
        }
        if len >= SHORT {
            if len == SHORT {
                let short = list.iter(&self.links);
                self.long_lists
                    .extend(short.map(|link| (node.serial, which, link.node)));
            }
            if !self.long_lists.insert((node.serial, which, from)) {
                return;
            }
        }
        list.push(&mut self.links, index, from, EdgeKind::Alias);
    }

    fn create_from(&mut self, index: u32, from: IdentifierId, into: IdentifierId) {
        let into = self.create(into, NodeValue::Object);
        let from = match self.at(from) {
            Some(from) => {
                let edges = &mut self.nodes[from as usize].edges;
                edges.push(&mut self.links, index, into, EdgeKind::Alias);
                from
            }
            None => match self.node_of.get(from).checked_sub(1) {
                Some(missing) => missing,
                None => self.create(from, NodeValue::Missing),
            },
        };
        self.add_incoming(Incoming::CreatedFrom, index, from, into);
    }

    fn connect(
        &mut self,
        kind: EdgeKind,
        which: Incoming,
        index: u32,
        from: IdentifierId,
        into: IdentifierId,
    ) {
        let (Some(from), Some(into)) = (self.at(from), self.at(into)) else {
            return;
        };
        let edges = &mut self.nodes[from as usize].edges;
        edges.push(&mut self.links, index, into, kind);
        self.add_incoming(which, index, from, into);
    }

    fn capture(&mut self, index: u32, from: IdentifierId, into: IdentifierId) {
        self.connect(EdgeKind::Capture, Incoming::Captures, index, from, into);
    }

    fn assign(&mut self, index: u32, from: IdentifierId, into: IdentifierId) {
        self.connect(EdgeKind::Alias, Incoming::Aliases, index, from, into);
    }

    fn maybe_alias(&mut self, index: u32, from: IdentifierId, into: IdentifierId) {
        self.connect(
            EdgeKind::MaybeAlias,
            Incoming::MaybeAliases,
            index,
            from,
            into,
        );
    }

    fn is_mutated(&self, id: IdentifierId) -> bool {
        self.node(id)
            .is_some_and(|node| node.local.is_some() || node.transitive.is_some())
    }

    /// Whether a node has `count` or more nodes in the lists that can have the link of a group.
    fn has_list_of(&self, count: usize) -> bool {
        self.nodes.iter().any(|node| {
            let incoming = node
                .captures
                .iter(&self.links)
                .chain(node.maybe_aliases.iter(&self.links));
            incoming.take(count).count() == count
        })
    }

    /// Not in upstream: see [`Group`]. Finds the groups in the links as they are once every edge
    /// is in, and puts one link in the place of each stretch of links that is the members of a
    /// group in their order. A list whose links are not that stays as it is.
    ///
    /// A run is `shortest` or more `Capture` and `MaybeAlias` edges that follow one another, in
    /// `links` and by index, and are all from one node or all to one node. Runs that follow one
    /// another are a group if their other ends are one sequence of nodes, but that each run is
    /// without its own node.
    #[cold]
    fn group_operands(&mut self, shortest: usize) {
        #[cfg(debug_assertions)]
        let without_groups = self.clone();
        let mut from_of: Vec<NodeAt> = vec![List::NONE; self.links.len()];
        for (from, node) in self.nodes.iter().enumerate() {
            for (at, _) in node.edges.positions(&self.links) {
                from_of[at as usize] = from as NodeAt;
            }
        }
        let edges: Vec<Edge> = (from_of.iter().zip(&self.links).enumerate())
            .filter(|&(_, (&from, _))| from != List::NONE)
            .map(|(at, (&from, link))| Edge {
                at: at as u32,
                from,
                into: link.node,
                index: link.index,
                kind: link.kind,
            })
            .collect();
        drop(from_of);

        let mut is_in_run = vec![false; edges.len()];
        for by_source in [true, false] {
            let runs = Run::all(&edges, &mut is_in_run, shortest, by_source);
            let mut at = 0;
            while let Some(first) = runs.get(at) {
                // The runs of one group, and the sequence that their other ends are.
                let start = at;
                let mut members: Option<Vec<NodeAt>> = None;
                at += 1;
                while let Some(run) = runs.get(at) {
                    let is_of_group = run.first == runs[at - 1].last + 1
                        && match &members {
                            None if run.node == first.node => run
                                .others(&edges, by_source)
                                .eq(first.others(&edges, by_source)),
                            None => {
                                members = first.merged(run, &edges, by_source);
                                members.is_some()
                            }
                            Some(members) => run
                                .others(&edges, by_source)
                                .eq(members.iter().copied().filter(|&member| member != run.node)),
                        };
                    if !is_of_group {
                        break;
                    }
                    at += 1;
                }
                // The runs of one node have nothing in common with those of another.
                if let Some(members) = members {
                    self.group(&edges, &runs[start..at], &members, by_source);
                }
            }
        }

        // Without its groups, a walk over many members is long.
        #[cfg(debug_assertions)]
        if !self.groups.is_empty() && self.groups.iter().all(Group::is_compared) {
            self.visits = Some(Vec::new());
            self.without_groups = Some(Box::new(AliasingState {
                visits: Some(Vec::new()),
                ..without_groups
            }));
        }
    }

    /// A build with assertions makes each walk of a state that has groups a second time, in the
    /// state as it was before. Whether `walk`, which makes it there, came to the same nodes with
    /// the same entries in the same order: what a walk writes follows from that.
    #[cfg(debug_assertions)]
    fn is_as_without_groups(&mut self, walk: impl FnOnce(&mut AliasingState)) -> bool {
        let Some(state) = &mut self.without_groups else {
            return true;
        };
        walk(state);
        state.visits.replace(Vec::new()) == self.visits.replace(Vec::new())
    }

    /// Makes a group of `runs`, whose other ends are `members`, and gives the lists its links.
    fn group(&mut self, edges: &[Edge], runs: &[Run], members: &[NodeAt], by_source: bool) {
        // A run has a `Capture` only if its node is mutable, and only for the members that are.
        let mut run_is_mutable = vec![false; runs.len()];
        let mut member_is_mutable = vec![false; members.len()];
        for (run, run_is_mutable) in runs.iter().zip(&mut run_is_mutable) {
            let mut kinds = run.other_edges(edges).map(|edge| edge.kind);
            for (&member, member_is_mutable) in members.iter().zip(&mut member_is_mutable) {
                if member != run.node && kinds.next() == Some(EdgeKind::Capture) {
                    *run_is_mutable = true;
                    *member_is_mutable = true;
                }
            }
        }
        let is_capture_where_both_are_mutable =
            (runs.iter().zip(&run_is_mutable)).all(|(run, &run_is_mutable)| {
                let mut kinds = run.other_edges(edges).map(|edge| edge.kind);
                (members.iter().zip(&member_is_mutable)).all(|(&member, &member_is_mutable)| {
                    let is_capture = run_is_mutable && member_is_mutable;
                    member == run.node
                        || kinds
                            .next()
                            .is_some_and(|kind| (kind == EdgeKind::Capture) == is_capture)
                })
            });
        if !is_capture_where_both_are_mutable {
            return;
        }
        // A destination is there twice if it is two operands of a call. A source is there once.
        let mut is_mutable_of: FxHashMap<NodeAt, bool> = FxHashMap::default();
        for (&member, &is_mutable) in members.iter().zip(&member_is_mutable) {
            if (is_mutable_of.insert(member, is_mutable))
                .is_some_and(|before| !by_source || before != is_mutable)
            {
                return;
            }
        }

        let of_members =
            (members.iter().zip(&member_is_mutable)).map(|(&node, &is_mutable)| Member {
                node,
                index: 0,
                is_mutable,
            });
        let of_runs = (runs.iter().zip(&run_is_mutable)).map(|(run, &is_mutable)| Member {
            node: run.node,
            index: edges[run.first].index,
            is_mutable,
        });
        let (destinations, sources): (Vec<Member>, Vec<Member>) = if by_source {
            // A source that has two runs is two operands of a call. The lists of the destinations
            // have it from its first run.
            let mut sources: HashSet<NodeAt> = HashSet::default();
            let of_runs = of_runs.filter(|source| sources.insert(source.node));
            (of_members.collect(), of_runs.collect())
        } else {
            (of_runs.collect(), of_members.collect())
        };
        let is_mutable = |source: &Member| source.is_mutable;
        let is_context = |source: &Member| !source.is_mutable;
        let group = Group {
            by_source,
            destinations: self.add_members(destinations.iter().copied()),
            sources: self.add_members(sources.iter().copied()),
            mutable_sources: self.add_members(sources.iter().copied().filter(is_mutable)),
            context_sources: self.add_members(sources.iter().copied().filter(is_context)),
        };
        let at = self.groups.len() as u32;
        self.groups.push(group);
        self.arrived
            .resize_with(self.groups.len() * Arrived::PER_GROUP, Arrived::default);

        // In `links`, an edge is the link of its source, and then that of its destination if the
        // list had none from that source.
        let (Some(first), Some(last)) = (runs.first(), runs.last()) else {
            return;
        };
        let (first, last) = (edges[first.first].at, edges[last.last].at);
        let edges_kind = |is_mutable: bool| match is_mutable {
            true => EdgeKind::DestinationsOfMutable,
            false => EdgeKind::DestinationsOfContext,
        };
        if by_source {
            for (run, &is_mutable) in runs.iter().zip(&run_is_mutable) {
                let (first, last) = (edges[run.first].at, edges[run.last].at);
                let edges_of_node = self.nodes[run.node as usize].edges;
                if let Some(stretch) = edges_of_node.stretch(&self.links, first, last) {
                    debug_assert!(
                        stretch.iter_stretch(&self.links).count() == run.last - run.first + 1
                    );
                    self.put_link(run.node, None, stretch, at, edges_kind(is_mutable));
                }
            }
            for destination in &destinations {
                if is_mutable_of.remove(&destination.node).is_some() {
                    self.group_incoming(destination, first, last + 1, at, &group);
                }
            }
        } else {
            for (run, destination) in runs.iter().zip(&destinations) {
                let (first, last) = (edges[run.first].at, edges[run.last].at);
                self.group_incoming(destination, first, last + 1, at, &group);
            }
            for source in &sources {
                let edges_of_node = self.nodes[source.node as usize].edges;
                let Some(stretch) = edges_of_node.stretch(&self.links, first, last) else {
                    continue;
                };
                // A walk stops at the first edge that it does not see. So that it is one to another
                // node, the source has none to itself here.
                let mut found = (stretch.iter_stretch(&self.links))
                    .map(|link| (link.node, link.kind))
                    .peekable();
                let expected = (destinations.iter())
                    .filter(|destination| destination.node != source.node)
                    .map(
                        |destination| match source.is_mutable && destination.is_mutable {
                            true => (destination.node, EdgeKind::Capture),
                            false => (destination.node, EdgeKind::MaybeAlias),
                        },
                    );
                if found.peek().is_some() && found.eq(expected) {
                    self.put_link(
                        source.node,
                        None,
                        stretch,
                        at,
                        edges_kind(source.is_mutable),
                    );
                }
            }
        }
    }

    fn add_members(&mut self, members: impl Iterator<Item = Member>) -> Members {
        let start = self.members.len() as u32;
        self.members.extend(members);
        let len = self.members.len() as u32 - start;
        Members { start, len }
    }

    /// Gives the lists of a destination of `group`, which is group `at`, the links of the sources,
    /// where what a list has at `first..=last` of `links` is those sources in their order.
    fn group_incoming(
        &mut self,
        destination: &Member,
        first: u32,
        last: u32,
        at: u32,
        group: &Group,
    ) {
        for which in [Incoming::Captures, Incoming::MaybeAliases] {
            let node = &self.nodes[destination.node as usize];
            let (list, sources, kind) = match (which, destination.is_mutable) {
                (Incoming::Captures, true) => (
                    node.captures,
                    group.mutable_sources,
                    EdgeKind::MutableSources,
                ),
                (Incoming::Captures, false) => continue,
                (_, true) => (
                    node.maybe_aliases,
                    group.context_sources,
                    EdgeKind::ContextSources,
                ),
                (_, false) => (node.maybe_aliases, group.sources, EdgeKind::Sources),
            };
            let Some(stretch) = list.stretch(&self.links, first, last) else {
                continue;
            };
            // A source that the list had before has no link here: the stretch is not the sources.
            let mut found = (stretch.iter_stretch(&self.links))
                .filter(|link| link.kind.is_group() || link.node != destination.node)
                .map(|link| (link.node, link.kind.is_group()))
                .peekable();
            let expected = self.members[sources.start as usize..][..sources.len as usize]
                .iter()
                .filter(|source| source.node != destination.node)
                .map(|source| (source.node, false));
            if found.peek().is_some() && found.eq(expected) {
                self.put_link(destination.node, Some(which), stretch, at, kind);
            }
        }
    }

    /// Puts one link of `group` in the place of `stretch`, which is of the list `which` of `node`,
    /// or of its edges.
    fn put_link(
        &mut self,
        node: NodeAt,
        which: Option<Incoming>,
        stretch: List,
        group: u32,
        kind: EdgeKind,
    ) {
        let next = self.links[stretch.last as usize].next;
        let link = &mut self.links[stretch.first as usize];
        *link = Link {
            index: link.index,
            node: group,
            kind,
            next,
        };
        let node = &mut self.nodes[node as usize];
        let list = match which {
            None => &mut node.edges,
            Some(Incoming::Captures) => &mut node.captures,
            Some(_) => &mut node.maybe_aliases,
        };
        if list.last == stretch.last {
            list.last = stretch.first;
        }
    }

    /// What `Node::arrival` is not less than if the walk at hand has come to the node with this kind
    /// or a stronger one.
    #[inline]
    fn arrival(&self, kind: MutationKind) -> u32 {
        self.walks << 2 | kind as u32
    }

    fn render(&mut self, index: u32, start: IdentifierId, env: &mut Environment) {
        if self.groups.is_empty() {
            return self.render_in::<false>(index, start, Some(env));
        }
        self.render_in::<true>(index, start, Some(env));
        #[cfg(debug_assertions)]
        debug_assert!(
            self.is_as_without_groups(|state| state.render_in::<false>(index, start, None))
        );
    }

    /// With `GROUPS`, a list can have the link of a group. Without `env`, it records no error.
    fn render_in<const GROUPS: bool>(
        &mut self,
        index: u32,
        start: IdentifierId,
        mut env: Option<&mut Environment>,
    ) {
        let Some(start) = self.at(start) else {
            return;
        };
        self.walks += 1;
        let arrival = self.arrival(MutationKind::Definite);
        let mut queue: Vec<NodeAt> = vec![start];
        while let Some(current) = queue.pop() {
            let node = &mut self.nodes[current as usize];
            if node.arrival >= arrival {
                continue;
            }
            node.arrival = arrival;
            #[cfg(debug_assertions)]
            if let Some(visits) = &mut self.visits {
                visits.push(QueueEntry {
                    place: current,
                    transitive: false,
                    direction: Direction::Backwards,
                    kind: MutationKind::Definite,
                });
            }
            if node.transitive.is_some() || node.local.is_some() {
                continue;
            }
            match (&node.value, &mut env) {
                (NodeValue::Missing, _) => continue,
                (NodeValue::Function { function_id }, Some(env)) => {
                    append_function_errors(env, *function_id)
                }
                _ => {}
            }
            for list in [node.created_from, node.aliases, node.captures] {
                for link in list.iter(&self.links) {
                    if link.index >= index {
                        continue;
                    }
                    if GROUPS && link.kind.is_group() {
                        let (seen, _) = members_at(&self.groups, &self.members, link, index);
                        queue.extend(seen.iter().map(|member| member.node));
                        continue;
                    }
                    queue.push(link.node);
                }
            }
        }
    }

    fn mutate(
        &mut self,
        index: u32,
        start: IdentifierId,
        end: Option<EvaluationOrder>, // None for simulated mutations
        transitive: bool,
        start_kind: MutationKind,
        loc: Option<SourceLocation>,
        reason: Option<MutationReason>,
        env: &mut Environment,
        should_record_errors: bool,
    ) {
        if self.groups.is_empty() {
            return self.mutate_in::<false>(
                index,
                start,
                end,
                transitive,
                start_kind,
                loc,
                reason,
                env,
                should_record_errors,
            );
        }
        #[cfg(debug_assertions)]
        let same_reason = reason.clone();
        self.mutate_in::<true>(
            index,
            start,
            end,
            transitive,
            start_kind,
            loc,
            reason,
            env,
            should_record_errors,
        );
        // A walk comes to the same nodes whatever it writes: this one writes no range, no error.
        #[cfg(debug_assertions)]
        debug_assert!(self.is_as_without_groups(|state| {
            state.mutate_in::<false>(
                index,
                start,
                None,
                transitive,
                start_kind,
                loc,
                same_reason,
                env,
                false,
            )
        }));
    }

    /// With `GROUPS`, a list can have the link of a group: see [`Cursor`]. Else none is read.
    fn mutate_in<const GROUPS: bool>(
        &mut self,
        index: u32,
        start: IdentifierId,
        end: Option<EvaluationOrder>,
        transitive: bool,
        start_kind: MutationKind,
        loc: Option<SourceLocation>,
        reason: Option<MutationReason>,
        env: &mut Environment,
        should_record_errors: bool,
    ) {
        let Some(start) = self.at(start) else {
            return;
        };
        self.walks += 1;
        let mut queue = std::mem::take(&mut self.queue);
        queue.push(QueueEntry {
            place: start,
            transitive,
            direction: Direction::Backwards,
            kind: start_kind,
        });
        if GROUPS {
            self.cursors.clear();
        }

        while let Some(mut entry) = queue.pop() {
            if GROUPS && entry.direction == Direction::Members {
                match self.next_member(&mut queue, entry) {
                    Some(member) => entry = member,
                    None => continue,
                }
            }
            let arrival = self.arrival(entry.kind);
            let conditional_arrival = self.arrival(MutationKind::Conditional);
            let node = &mut self.nodes[entry.place as usize];
            if node.arrival >= arrival || matches!(node.value, NodeValue::Missing) {
                continue;
            }
            node.arrival = arrival;
            #[cfg(debug_assertions)]
            if let Some(visits) = &mut self.visits {
                visits.push(entry);
            }

            if node.mutation_reason.is_none() {
                node.mutation_reason = reason.clone();
            }
            node.last_mutated = node.last_mutated.max(index);

            if let Some(end_val) = end {
                let ident = &mut env.identifiers[node.id.0 as usize];
                ident.mutable_range.end = EvaluationOrder(ident.mutable_range.end.0.max(end_val.0));
            }

            if let NodeValue::Function { function_id } = &node.value {
                if node.transitive.is_none() && node.local.is_none() {
                    if should_record_errors {
                        append_function_errors(env, *function_id);
                    }
                }
            }

            let info = if entry.transitive {
                &mut node.transitive
            } else {
                &mut node.local
            };
            if info
                .as_ref()
                .is_none_or(|existing| existing.kind < entry.kind)
            {
                *info = Some(MutationInfo {
                    kind: entry.kind,
                    loc,
                });
            }

            let node_is_phi = matches!(node.value, NodeValue::Phi);
            let Node {
                edges,
                created_from,
                aliases,
                maybe_aliases,
                captures,
                ..
            } = *node;
            // A node that the walk has come to with the kind is passed over when its turn comes.
            let nodes = &self.nodes;
            let push = |queue: &mut Vec<QueueEntry>, entry: QueueEntry, arrival: u32| {
                if nodes[entry.place as usize].arrival < arrival {
                    queue.push(entry);
                }
            };
            // The members that the link of a group is in the place of, where the entries of its
            // links would be. Gives whether the walk sees each link: the node has none to itself.
            let (groups, members, cursors) = (&self.groups, &self.members, &mut self.cursors);
            let mut push_members = |queue: &mut Vec<QueueEntry>, link: &Link| {
                let (seen, others) = members_at(groups, members, link, index);
                if !seen.is_empty() {
                    queue.push(QueueEntry {
                        place: cursors.len() as u32,
                        transitive: entry.transitive,
                        direction: Direction::Members,
                        kind: entry.kind,
                    });
                    cursors.push(Cursor {
                        group: link.node,
                        kind: link.kind,
                        left: seen.len() as u32,
                    });
                }
                others.iter().all(|member| member.node == entry.place)
            };

            // Forward edges: Capture a -> b, Alias a -> b: mutate(a) => mutate(b)
            for edge in edges.iter(&self.links) {
                if edge.index >= index {
                    break;
                }
                if GROUPS && edge.kind.is_group() {
                    // The first link that the walk does not see ends the list.
                    if !push_members(&mut queue, edge) {
                        break;
                    }
                    continue;
                }
                // MaybeAlias edges downgrade to conditional mutation
                let (kind, arrival) = if edge.kind == EdgeKind::MaybeAlias {
                    (MutationKind::Conditional, conditional_arrival)
                } else {
                    (entry.kind, arrival)
                };
                push(
                    &mut queue,
                    QueueEntry {
                        place: edge.node,
                        transitive: entry.transitive,
                        direction: Direction::Forwards,
                        kind,
                    },
                    arrival,
                );
            }

            for alias in created_from.iter(&self.links) {
                if alias.index >= index {
                    continue;
                }
                push(
                    &mut queue,
                    QueueEntry {
                        place: alias.node,
                        transitive: true,
                        direction: Direction::Backwards,
                        kind: entry.kind,
                    },
                    arrival,
                );
            }

            if entry.direction == Direction::Backwards || !node_is_phi {
                // Backward alias edges
                for alias in aliases.iter(&self.links) {
                    if alias.index >= index {
                        continue;
                    }
                    push(
                        &mut queue,
                        QueueEntry {
                            place: alias.node,
                            transitive: entry.transitive,
                            direction: Direction::Backwards,
                            kind: entry.kind,
                        },
                        arrival,
                    );
                }
                // MaybeAlias backward edges (downgrade to conditional)
                for alias in maybe_aliases.iter(&self.links) {
                    if alias.index >= index {
                        continue;
                    }
                    if GROUPS && alias.kind.is_group() {
                        push_members(&mut queue, alias);
                        continue;
                    }
                    push(
                        &mut queue,
                        QueueEntry {
                            place: alias.node,
                            transitive: entry.transitive,
                            direction: Direction::Backwards,
                            kind: MutationKind::Conditional,
                        },
                        conditional_arrival,
                    );
                }
            }

            // Only transitive mutations affect captures backward
            if entry.transitive {
                for capture in captures.iter(&self.links) {
                    if capture.index >= index {
                        continue;
                    }
                    if GROUPS && capture.kind.is_group() {
                        push_members(&mut queue, capture);
                        continue;
                    }
                    push(
                        &mut queue,
                        QueueEntry {
                            place: capture.node,
                            transitive: entry.transitive,
                            direction: Direction::Backwards,
                            kind: entry.kind,
                        },
                        arrival,
                    );
                }
            }
        }
        self.queue = queue;
    }

    /// The entry of the last member that the cursor at `at` has yet to give and that the walk has
    /// not come to with the kind of that entry. The cursor goes back on the stack, below that
    /// entry, if it has more to give.
    fn next_member(&mut self, queue: &mut Vec<QueueEntry>, at: QueueEntry) -> Option<QueueEntry> {
        let cursor = &mut self.cursors[at.place as usize];
        let group = &self.groups[cursor.group as usize];
        let is_definite = at.kind == MutationKind::Definite;
        // Which `Arrived` of the group: one for each kind that a walk comes to the members with.
        let (members, which, direction) = match cursor.kind {
            EdgeKind::DestinationsOfMutable => (
                group.destinations,
                usize::from(is_definite),
                Direction::Forwards,
            ),
            EdgeKind::DestinationsOfContext => (group.destinations, 0, Direction::Forwards),
            EdgeKind::MutableSources => (
                group.mutable_sources,
                2 + usize::from(is_definite),
                Direction::Backwards,
            ),
            EdgeKind::ContextSources => (group.context_sources, 4, Direction::Backwards),
            _ => (group.sources, 5, Direction::Backwards),
        };
        let arrived = &mut self.arrived[cursor.group as usize * Arrived::PER_GROUP + which];
        if arrived.walk != self.walks {
            arrived.walk = self.walks;
            arrived.left.clear();
            arrived.left.extend(0..=members.len);
        }
        let members = &self.members[members.start as usize..][..members.len as usize];
        loop {
            let left = arrived.left(cursor.left);
            cursor.left = left.checked_sub(1)?;
            let member = members[cursor.left as usize];
            // As the link that this is in the place of: a `MaybeAlias` does not keep the kind.
            let kind = match cursor.kind {
                EdgeKind::MutableSources => at.kind,
                EdgeKind::DestinationsOfMutable if member.is_mutable => at.kind,
                _ => MutationKind::Conditional,
            };
            // `Self::arrival` of the kind.
            if self.nodes[member.node as usize].arrival >= (self.walks << 2 | kind as u32) {
                arrived.left[left as usize] = left - 1;
                continue;
            }
            if cursor.left > 0 {
                queue.push(at);
            }
            return Some(QueueEntry {
                place: member.node,
                transitive: at.transitive,
                direction,
                kind,
            });
        }
    }
}

/// The members that `link`, which is of a group, is in the place of links to or from: those whose
/// link a walk at `index` sees, and the others.
fn members_at<'a>(
    groups: &[Group],
    members: &'a [Member],
    link: &Link,
    index: u32,
) -> (&'a [Member], &'a [Member]) {
    let group = &groups[link.node as usize];
    let (of_link, is_in_order) = match link.kind {
        EdgeKind::DestinationsOfMutable | EdgeKind::DestinationsOfContext => {
            (group.destinations, !group.by_source)
        }
        EdgeKind::MutableSources => (group.mutable_sources, group.by_source),
        EdgeKind::ContextSources => (group.context_sources, group.by_source),
        _ => (group.sources, group.by_source),
    };
    let all = &members[of_link.start as usize..][..of_link.len as usize];
    // Where the links are not in the order of these members, they follow one another, and the walk
    // sees all of them or the first is past its index.
    let seen = match is_in_order {
        true => all.partition_point(|member| member.index < index),
        false => all.len(),
    };
    all.split_at(seen)
}

/// The legacy effect of each place of the instruction at hand.
struct OperandEffects {
    instruction: u32,
    /// The instruction that the effect is of, and the effect.
    effects: ByIdentifier<(u32, Effect)>,
}

impl OperandEffects {
    fn new(identifiers: usize) -> Self {
        OperandEffects {
            instruction: 0,
            effects: ByIdentifier::new(identifiers, (0, Effect::Unknown)),
        }
    }

    fn next_instruction(&mut self) {
        self.instruction += 1;
    }

    fn insert(&mut self, id: IdentifierId, effect: Effect) {
        *self.effects.entry(id) = (self.instruction, effect);
    }

    fn get(&self, id: IdentifierId) -> Option<Effect> {
        let (instruction, effect) = self.effects.get(id);
        (instruction == self.instruction).then_some(effect)
    }
}

/// A value that no mutation has given a range has the range of the instruction that makes it.
fn start_range_at(ident: &mut Identifier, eval_order: EvaluationOrder) {
    if ident.mutable_range.start == EvaluationOrder(0) {
        ident.mutable_range.start = eval_order;
    }
    if ident.mutable_range.end == EvaluationOrder(0) {
        ident.mutable_range.end =
            EvaluationOrder((eval_order.0 + 1).max(ident.mutable_range.end.0));
    }
}

/// `BUN_REACT_COMPILER_GROUP_RUNS=2`: a function has each group that it can have, for the tests
/// of the compiler to go through them, and a number that no run is as long as: it has none. The
/// builds that read it make each walk of a group without it too, and compare.
#[cfg(debug_assertions)]
#[allow(clippy::disallowed_methods)]
fn shortest_run_of_a_test() -> Option<usize> {
    static SHORTEST_RUN: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
    *SHORTEST_RUN.get_or_init(|| {
        let runs = std::env::var_os("BUN_REACT_COMPILER_GROUP_RUNS")?;
        runs.to_str()?.parse().ok()
    })
}
#[cfg(not(debug_assertions))]
#[inline(always)]
fn shortest_run_of_a_test() -> Option<usize> {
    None
}

// =============================================================================
// Helper: append function errors
// =============================================================================

fn append_function_errors(env: &mut Environment, function_id: FunctionId) {
    let func = &env.functions[function_id.0 as usize];
    if let Some(ref effects) = func.aliasing_effects {
        // Collect errors first to avoid borrow conflict
        let errors: Vec<_> = effects
            .iter()
            .filter_map(|effect| match effect {
                AliasingEffect::Impure { error, .. }
                | AliasingEffect::MutateFrozen { error, .. }
                | AliasingEffect::MutateGlobal { error, .. } => {
                    Some(CompilerDiagnostic::clone(error))
                }
                _ => None,
            })
            .collect();
        for error in errors {
            env.record_diagnostic(error);
        }
    }
}

// =============================================================================
// Public entry point
// =============================================================================

/// Infers mutable ranges for identifiers and populates Place effects.
///
/// Returns the externally-visible effects of the function (mutations of
/// params/context-vars, aliasing between params/context-vars/return).
///
/// Corresponds to TS `inferMutationAliasingRanges(fn, {isFunctionExpression})`.
pub(crate) fn infer_mutation_aliasing_ranges(
    func: &mut HirFunction,
    env: &mut Environment,
    is_function_expression: bool,
) -> Result<Vec<AliasingEffect>, CompilerDiagnostic> {
    let mut function_effects: Vec<AliasingEffect> = Vec::new();

    // =========================================================================
    // Part 1: Build data flow graph and infer mutable ranges
    // =========================================================================
    let mut state = AliasingState::new(env.identifiers.len(), func.instructions.len());

    struct PendingPhiOperand {
        from: IdentifierId,
        into: IdentifierId,
        index: u32,
    }
    let mut pending_phis: IdMap<BlockId, Vec<PendingPhiOperand>> = IdMap::new();

    struct PendingMutation {
        index: u32,
        id: EvaluationOrder,
        transitive: bool,
        kind: MutationKind,
        place: IdentifierId,
        loc: Option<SourceLocation>,
        reason: Option<MutationReason>,
    }
    let mut mutations: Vec<PendingMutation> = Vec::new();

    struct PendingRender {
        index: u32,
        place: IdentifierId,
    }
    let mut renders: Vec<PendingRender> = Vec::new();

    let mut index: u32 = 0;

    let should_record_errors = !is_function_expression && env.enable_validations();

    // Create nodes for params, context vars, and return
    for param in &func.params {
        state.create(param.place().identifier, NodeValue::Object);
    }
    for ctx in &func.context {
        state.create(ctx.identifier, NodeValue::Object);
    }
    state.create(func.returns.identifier, NodeValue::Object);

    let mut seen_blocks: IdBitSet<BlockId> = IdBitSet::new();

    for (&block_id, block) in &func.body.blocks {
        // Process phis
        for phi in &block.phis {
            state.create(phi.place.identifier, NodeValue::Phi);
            for (&pred, operand) in &phi.operands {
                if !seen_blocks.contains(pred) {
                    pending_phis
                        .entry(pred)
                        .or_default()
                        .push(PendingPhiOperand {
                            from: operand.identifier,
                            into: phi.place.identifier,
                            index,
                        });
                    index += 1;
                } else {
                    state.assign(index, operand.identifier, phi.place.identifier);
                    index += 1;
                }
            }
        }
        seen_blocks.insert(block_id);

        // Process instruction effects
        for instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            let instr_eval_order = instr.id;
            let Some(effects) = &instr.effects else {
                continue;
            };
            for effect in effects {
                match effect {
                    AliasingEffect::Create { into, .. } => {
                        state.create(into.identifier, NodeValue::Object);
                    }
                    AliasingEffect::CreateFunction {
                        into, function_id, ..
                    } => {
                        state.create(
                            into.identifier,
                            NodeValue::Function {
                                function_id: *function_id,
                            },
                        );
                    }
                    AliasingEffect::CreateFrom { from, into } => {
                        state.create_from(index, from.identifier, into.identifier);
                        index += 1;
                    }
                    AliasingEffect::Assign { from, into } => {
                        if state.at(into.identifier).is_none() {
                            state.create(into.identifier, NodeValue::Object);
                        }
                        state.assign(index, from.identifier, into.identifier);
                        index += 1;
                    }
                    AliasingEffect::Alias { from, into } => {
                        state.assign(index, from.identifier, into.identifier);
                        index += 1;
                    }
                    AliasingEffect::MaybeAlias { from, into } => {
                        state.maybe_alias(index, from.identifier, into.identifier);
                        index += 1;
                    }
                    AliasingEffect::Capture { from, into } => {
                        state.capture(index, from.identifier, into.identifier);
                        index += 1;
                    }
                    AliasingEffect::MutateTransitive { value }
                    | AliasingEffect::MutateTransitiveConditionally { value } => {
                        let is_transitive_conditional =
                            matches!(effect, AliasingEffect::MutateTransitiveConditionally { .. });
                        mutations.push(PendingMutation {
                            index,
                            id: instr_eval_order,
                            transitive: true,
                            kind: if is_transitive_conditional {
                                MutationKind::Conditional
                            } else {
                                MutationKind::Definite
                            },
                            reason: None,
                            place: value.identifier,
                            loc: value.loc,
                        });
                        index += 1;
                    }
                    AliasingEffect::Mutate { value, reason } => {
                        mutations.push(PendingMutation {
                            index,
                            id: instr_eval_order,
                            transitive: false,
                            kind: MutationKind::Definite,
                            reason: reason.clone(),
                            place: value.identifier,
                            loc: value.loc,
                        });
                        index += 1;
                    }
                    AliasingEffect::MutateConditionally { value } => {
                        mutations.push(PendingMutation {
                            index,
                            id: instr_eval_order,
                            transitive: false,
                            kind: MutationKind::Conditional,
                            reason: None,
                            place: value.identifier,
                            loc: value.loc,
                        });
                        index += 1;
                    }
                    AliasingEffect::MutateFrozen { error, .. }
                    | AliasingEffect::MutateGlobal { error, .. }
                    | AliasingEffect::Impure { error, .. } => {
                        if should_record_errors {
                            env.record_diagnostic(CompilerDiagnostic::clone(error));
                        }
                        function_effects.push(effect.clone());
                    }
                    AliasingEffect::Render { place } => {
                        renders.push(PendingRender {
                            index,
                            place: place.identifier,
                        });
                        index += 1;
                        function_effects.push(effect.clone());
                    }
                    // Other effects (Freeze, ImmutableCapture, Apply) are no-ops here
                    _ => {}
                }
            }
        }

        // Process pending phis for this block
        if let Some(block_phis) = pending_phis.swap_remove(block_id) {
            for pending in block_phis {
                state.assign(pending.index, pending.from, pending.into);
            }
        }

        // Handle return terminal
        let terminal = &block.terminal;
        if let crate::hir::Terminal::Return { value, .. } = terminal {
            state.assign(index, value.identifier, func.returns.identifier);
            index += 1;
        }

        // Handle terminal effects (MaybeThrow and Return)
        if let crate::hir::Terminal::MaybeThrow {
            effects: Some(effects),
            ..
        }
        | crate::hir::Terminal::Return {
            effects: Some(effects),
            ..
        } = terminal
        {
            for effect in effects {
                match effect {
                    AliasingEffect::Alias { from, into } => {
                        state.assign(index, from.identifier, into.identifier);
                        index += 1;
                    }
                    AliasingEffect::Freeze { .. } => {
                        // Expected for MaybeThrow terminals, skip
                    }
                    _ => {
                        // TS: CompilerError.invariant(effect.kind === 'Freeze', ...)
                        // We skip non-Alias, non-Freeze effects
                    }
                }
            }
        }
    }

    // Not in upstream: see `Group`. Each node of a group has a long list with the other nodes.
    let shortest_run = shortest_run_of_a_test();
    let is_with_groups = shortest_run.is_some()
        || (state.long_lists.len() >= Group::SHORTEST_RUN * (Group::SHORTEST_RUN - 1)
            && state.has_list_of(Group::SHORTEST_RUN - 1));
    if is_with_groups {
        state.group_operands(shortest_run.unwrap_or(Group::SHORTEST_RUN));
    }

    // Process mutations
    for mutation in &mutations {
        state.mutate(
            mutation.index,
            mutation.place,
            Some(EvaluationOrder(mutation.id.0 + 1)),
            mutation.transitive,
            mutation.kind,
            mutation.loc,
            mutation.reason.clone(),
            env,
            should_record_errors,
        );
    }

    // Process renders
    if should_record_errors {
        for render in &renders {
            state.render(render.index, render.place, env);
        }
    }

    // Collect function effects for context vars and params
    // NOTE: TS iterates [...fn.context, ...fn.params] — context first, then params
    for ctx in &func.context {
        collect_param_effects(&state, ctx, &mut function_effects);
    }
    for param in &func.params {
        let place = param.place();
        collect_param_effects(&state, place, &mut function_effects);
    }

    // Set effect on mutated params/context vars
    for param in &mut func.params {
        let place = param.place_mut();
        if state.is_mutated(place.identifier) {
            place.effect = Effect::Capture;
        }
    }
    for ctx in &mut func.context {
        if state.is_mutated(ctx.identifier) {
            ctx.effect = Effect::Capture;
        }
    }

    // =========================================================================
    // Part 2: Add legacy operand-specific effects based on instruction effects
    //         and mutable ranges. Also fix up mutable range start values.
    // =========================================================================
    let mut operand_effects = OperandEffects::new(env.identifiers.len());
    for block in func.body.blocks.values_mut() {
        // Process phis
        if !block.phis.is_empty() {
            let first_instr_id = block
                .instructions
                .first()
                .map(|id| func.instructions[id.0 as usize].id)
                .unwrap_or_else(|| block.terminal.evaluation_order());
            for phi in &mut block.phis {
                let ident = &mut env.identifiers[phi.place.identifier.0 as usize];
                let is_mutated_after_creation = ident.mutable_range.end > first_instr_id;
                phi.place.effect = Effect::Store;
                for operand in phi.operands.values_mut() {
                    operand.effect = if is_mutated_after_creation {
                        Effect::Capture
                    } else {
                        Effect::Read
                    };
                }
                if is_mutated_after_creation && ident.mutable_range.start == EvaluationOrder(0) {
                    ident.mutable_range.start = EvaluationOrder(first_instr_id.0.saturating_sub(1));
                }
            }
        }

        for instr_id in &block.instructions {
            let instr = &mut func.instructions[instr_id.0 as usize];
            let eval_order = instr.id;

            // Set lvalue effect to ConditionallyMutate and fix up mutable range
            // This covers the top-level lvalue
            start_range_at(
                &mut env.identifiers[instr.lvalue.identifier.0 as usize],
                eval_order,
            );
            instr.lvalue.effect = Effect::ConditionallyMutate;

            // Also handle value-level lvalues (DeclareLocal, StoreLocal, etc.)
            for_each_instruction_value_lvalue_mut(&mut instr.value, &mut |place| {
                start_range_at(
                    &mut env.identifiers[place.identifier.0 as usize],
                    eval_order,
                );
                place.effect = Effect::ConditionallyMutate;
            });

            let Some(effects) = &instr.effects else {
                // Set operand effects to Read
                for_each_instruction_value_operand_mut(&mut instr.value, &mut |place| {
                    place.effect = Effect::Read;
                });
                continue;
            };

            // Compute operand effects from instruction effects
            operand_effects.next_instruction();

            for effect in effects {
                match effect {
                    AliasingEffect::Assign { from, into, .. }
                    | AliasingEffect::Alias { from, into }
                    | AliasingEffect::Capture { from, into }
                    | AliasingEffect::CreateFrom { from, into }
                    | AliasingEffect::MaybeAlias { from, into } => {
                        let is_mutated_or_reassigned = env.identifiers[into.identifier.0 as usize]
                            .mutable_range
                            .end
                            > eval_order;
                        if is_mutated_or_reassigned {
                            operand_effects.insert(from.identifier, Effect::Capture);
                            operand_effects.insert(into.identifier, Effect::Store);
                        } else {
                            operand_effects.insert(from.identifier, Effect::Read);
                            operand_effects.insert(into.identifier, Effect::Store);
                        }
                    }
                    AliasingEffect::CreateFunction { .. } | AliasingEffect::Create { .. } => {
                        // no-op
                    }
                    AliasingEffect::Mutate { value, .. } => {
                        operand_effects.insert(value.identifier, Effect::Store);
                    }
                    AliasingEffect::Apply(_) => {
                        return Err(cold_invariant(
                            "[AnalyzeFunctions] Expected Apply effects to be replaced with more precise effects",
                            None,
                            None,
                        )
                        .into());
                    }
                    AliasingEffect::MutateTransitive { value, .. }
                    | AliasingEffect::MutateConditionally { value }
                    | AliasingEffect::MutateTransitiveConditionally { value } => {
                        operand_effects.insert(value.identifier, Effect::ConditionallyMutate);
                    }
                    AliasingEffect::Freeze { value, .. } => {
                        operand_effects.insert(value.identifier, Effect::Freeze);
                    }
                    AliasingEffect::ImmutableCapture { .. } => {
                        // no-op, Read is the default
                    }
                    AliasingEffect::Impure { .. }
                    | AliasingEffect::Render { .. }
                    | AliasingEffect::MutateFrozen { .. }
                    | AliasingEffect::MutateGlobal { .. } => {
                        // no-op
                    }
                }
            }

            // Apply operand effects to top-level lvalue
            if let Some(effect) = operand_effects.get(instr.lvalue.identifier) {
                instr.lvalue.effect = effect;
            }
            // Apply operand effects to value-level lvalues
            for_each_instruction_value_lvalue_mut(&mut instr.value, &mut |place| {
                if let Some(effect) = operand_effects.get(place.identifier) {
                    place.effect = effect;
                }
            });

            // Apply operand effects to value operands and fix up mutable ranges
            let apply = |place: &mut Place, identifiers: &mut [Identifier]| {
                // Fix up mutable range start
                let ident = &mut identifiers[place.identifier.0 as usize];
                if ident.mutable_range.end > eval_order
                    && ident.mutable_range.start == EvaluationOrder(0)
                {
                    ident.mutable_range.start = eval_order;
                }
                // Apply effect
                place.effect = operand_effects
                    .get(place.identifier)
                    .unwrap_or(Effect::Read);
            };
            for_each_instruction_value_operand_mut(&mut instr.value, &mut |place| {
                apply(place, &mut env.identifiers);
            });

            // FunctionExpression/ObjectMethod context variables are operands that
            // require env access (they live in env.functions[func_id].context).
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } = &instr.value
            {
                for ctx_place in &mut env.functions[lowered_func.func.0 as usize].context {
                    apply(ctx_place, &mut env.identifiers);
                }
            }

            // Handle StoreContext case: extend rvalue range if needed
            if let InstructionValue::StoreContext { value, .. } = &instr.value {
                let range = &mut env.identifiers[value.identifier.0 as usize].mutable_range;
                if range.end <= eval_order {
                    range.end = EvaluationOrder(eval_order.0 + 1);
                }
            }
        }

        // Set terminal operand effects
        match &mut block.terminal {
            crate::hir::Terminal::Return { value, .. } => {
                value.effect = if is_function_expression {
                    Effect::Read
                } else {
                    Effect::Freeze
                };
            }
            terminal => {
                for_each_terminal_operand_mut(terminal, &mut |place| {
                    place.effect = Effect::Read;
                });
            }
        }
    }

    // =========================================================================
    // Part 3: Finish populating the externally visible effects
    // =========================================================================
    let returns_id = func.returns.identifier;
    let returns_type_id = env.identifiers[returns_id.0 as usize].type_;
    let returns_type = &env.types[returns_type_id.0 as usize];
    let return_value_kind = if is_primitive_type(returns_type) {
        ValueKind::Primitive
    } else if is_jsx_type(returns_type) {
        ValueKind::Frozen
    } else {
        ValueKind::Mutable
    };

    function_effects.push(AliasingEffect::Create {
        into: func.returns.clone(),
        value: return_value_kind,
        reason: ValueReason::KnownReturnSignature,
    });

    // Determine precise data-flow effects by simulating transitive mutations
    let mut tracked: Vec<Place> = Vec::new();
    for param in &func.params {
        let place = param.place().clone();
        tracked.push(place);
    }
    for ctx in &func.context {
        tracked.push(ctx.clone());
    }
    tracked.push(func.returns.clone());

    let returns_identifier_id = func.returns.identifier;

    let first_simulated_index = index;
    let reached_in = |state: &AliasingState, mutation_index: u32| -> Vec<bool> {
        let is_reached = |place: &Place| {
            let node = state.node(place.identifier);
            node.is_some_and(|node| node.last_mutated == mutation_index)
        };
        tracked.iter().map(is_reached).collect()
    };

    for into in &tracked {
        let mut mutation_index = index;
        index += 1;

        // Where the walks are symmetric, each reaches all that is connected with its start. So a
        // walk from what an earlier one has reached would reach the same.
        let earlier_index = state
            .node(into.identifier)
            .map(|node| node.last_mutated)
            .filter(|&last_mutated| {
                state.is_symmetric
                    && first_simulated_index > 0
                    && last_mutated >= first_simulated_index
            });
        if earlier_index.is_none() || cfg!(debug_assertions) {
            let expected = earlier_index.map(|earlier_index| reached_in(&state, earlier_index));
            state.mutate(
                mutation_index,
                into.identifier,
                None, // simulated mutation
                true,
                MutationKind::Conditional,
                into.loc,
                None,
                env,
                false, // never record errors for simulated mutations
            );
            debug_assert!(expected.is_none_or(|it| it == reached_in(&state, mutation_index)));
        } else if let Some(earlier_index) = earlier_index {
            mutation_index = earlier_index;
        }

        for from in &tracked {
            if from.identifier == into.identifier || from.identifier == returns_identifier_id {
                continue;
            }

            let Some(from_node) = state.node(from.identifier) else {
                return Err(cold_invariant(
                    "Expected a node to exist for all parameters and context variables",
                    None,
                    None,
                )
                .into());
            };

            if from_node.last_mutated == mutation_index {
                if into.identifier == returns_identifier_id {
                    function_effects.push(AliasingEffect::Alias {
                        from: from.clone(),
                        into: into.clone(),
                    });
                } else {
                    function_effects.push(AliasingEffect::Capture {
                        from: from.clone(),
                        into: into.clone(),
                    });
                }
            }
        }
    }

    Ok(function_effects)
}

// =============================================================================
// Helper: collect param/context mutation effects
// =============================================================================

fn collect_param_effects(
    state: &AliasingState,
    place: &Place,
    function_effects: &mut Vec<AliasingEffect>,
) {
    let node = match state.node(place.identifier) {
        Some(n) => n,
        None => return,
    };

    if let Some(ref local) = node.local {
        match local.kind {
            MutationKind::Conditional => {
                function_effects.push(AliasingEffect::MutateConditionally {
                    value: Place {
                        loc: local.loc,
                        ..place.clone()
                    },
                });
            }
            MutationKind::Definite => {
                function_effects.push(AliasingEffect::Mutate {
                    value: Place {
                        loc: local.loc,
                        ..place.clone()
                    },
                    reason: node.mutation_reason.clone(),
                });
            }
        }
    }

    if let Some(ref transitive) = node.transitive {
        match transitive.kind {
            MutationKind::Conditional => {
                function_effects.push(AliasingEffect::MutateTransitiveConditionally {
                    value: Place {
                        loc: transitive.loc,
                        ..place.clone()
                    },
                });
            }
            MutationKind::Definite => {
                function_effects.push(AliasingEffect::MutateTransitive {
                    value: Place {
                        loc: transitive.loc,
                        ..place.clone()
                    },
                });
            }
        }
    }
}
