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

use crate::collections::{FxHashSet as HashSet, IdBitSet, IdMap};

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
}

/// A table by identifier. A function expression has a few stretches of the identifiers of its
/// component, so there are only the pages that were written to.
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

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    Backwards,
    Forwards,
}

#[derive(Clone, Copy)]
struct QueueEntry {
    place: NodeAt,
    transitive: bool,
    direction: Direction,
    kind: MutationKind,
}

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

    /// What `Node::arrival` is not less than if the walk at hand has come to the node with this kind
    /// or a stronger one.
    #[inline]
    fn arrival(&self, kind: MutationKind) -> u32 {
        self.walks << 2 | kind as u32
    }

    fn render(&mut self, index: u32, start: IdentifierId, env: &mut Environment) {
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
            if node.transitive.is_some() || node.local.is_some() {
                continue;
            }
            match node.value {
                NodeValue::Missing => continue,
                NodeValue::Function { function_id } => append_function_errors(env, function_id),
                NodeValue::Object | NodeValue::Phi => {}
            }
            for list in [node.created_from, node.aliases, node.captures] {
                for link in list.iter(&self.links) {
                    if link.index >= index {
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

        while let Some(entry) = queue.pop() {
            let arrival = self.arrival(entry.kind);
            let conditional_arrival = self.arrival(MutationKind::Conditional);
            let node = &mut self.nodes[entry.place as usize];
            if node.arrival >= arrival || matches!(node.value, NodeValue::Missing) {
                continue;
            }
            node.arrival = arrival;

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
            let mut push = |entry: QueueEntry, arrival: u32| {
                if nodes[entry.place as usize].arrival < arrival {
                    queue.push(entry);
                }
            };

            // Forward edges: Capture a -> b, Alias a -> b: mutate(a) => mutate(b)
            for edge in edges.iter(&self.links) {
                if edge.index >= index {
                    break;
                }
                // MaybeAlias edges downgrade to conditional mutation
                let (kind, arrival) = if edge.kind == EdgeKind::MaybeAlias {
                    (MutationKind::Conditional, conditional_arrival)
                } else {
                    (entry.kind, arrival)
                };
                push(
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
                    push(
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
                    push(
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
