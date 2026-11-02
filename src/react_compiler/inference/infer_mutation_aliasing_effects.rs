// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Infers the mutation/aliasing effects for instructions and terminals.
//!
//! Ported from TypeScript `src/Inference/InferMutationAliasingEffects.ts`.
//!
//! This pass uses abstract interpretation to compute effects describing
//! creation, aliasing, mutation, freezing, and error conditions for each
//! instruction and terminal in the HIR.

use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::collections::{FxHashMap as HashMap, FxHashSet as HashSet, IdBitSet, IdMap};

use crate::diagnostics::CompilerDiagnostic;
use crate::diagnostics::CompilerDiagnosticDetail;
use crate::diagnostics::ErrorCategory;
use crate::hir::AliasingEffect;
use crate::hir::AliasingSignature;
use crate::hir::ApplyEffect;
use crate::hir::AstAlloc;
use crate::hir::BasicBlock;
use crate::hir::BlockId;
use crate::hir::DeclarationId;
use crate::hir::Effect;
use crate::hir::FunctionId;
use crate::hir::HirFunction;
use crate::hir::HirVec;
use crate::hir::IdentifierId;
use crate::hir::Instruction;
use crate::hir::InstructionKind;
use crate::hir::InstructionValue;
use crate::hir::MutationReason;
use crate::hir::ParamPattern;
use crate::hir::Place;
use crate::hir::PlaceOrSpread;
use crate::hir::PlaceOrSpreadOrHole;
use crate::hir::ReactFunctionType;
use crate::hir::SourceLocation;
use crate::hir::Terminal;
use crate::hir::Type;
use crate::hir::environment::Environment;
use crate::hir::object_shape::BUILT_IN_ARRAY_ID;
use crate::hir::object_shape::BUILT_IN_MAP_ID;
use crate::hir::object_shape::BUILT_IN_SET_ID;
use crate::hir::object_shape::FunctionSignature;
use crate::hir::object_shape::HookKind;
use crate::hir::type_config::ValueKind;
use crate::hir::type_config::ValueReason;
use crate::hir::type_config::ValueReasonSet;
use crate::hir::visitors;

// =============================================================================
// Public entry point
// =============================================================================

/// Infers mutation/aliasing effects for all instructions and terminals in `func`.
///
/// Corresponds to TS `inferMutationAliasingEffects(fn, {isFunctionExpression})`.
pub(crate) fn infer_mutation_aliasing_effects(
    func: &mut HirFunction,
    env: &mut Environment,
    is_function_expression: bool,
) -> Result<(), CompilerDiagnostic> {
    // ValueIds are dense and pass-local so `InferenceState.values` can be a
    // `ChunkedVec`; allocation starts at 0 and continues via `Context.next_value_id`.
    let mut next_value_id = 0u32;

    let mut initial_state = InferenceState::empty();

    // Map of blocks to the last (merged) incoming state that was processed
    let mut states_by_block: IdMap<BlockId, InferenceState> = IdMap::new();

    // Initialize context variables
    for ctx_place in &func.context {
        let value_id = ValueId(next_value_id);
        next_value_id += 1;
        initial_state.initialize(
            value_id,
            AbstractValue {
                kind: ValueKind::Context,
                reason: hashset_of(ValueReason::Other),
            },
        );
        initial_state.define(ctx_place.identifier, value_id);
    }

    let param_kind: AbstractValue = if is_function_expression {
        AbstractValue {
            kind: ValueKind::Mutable,
            reason: hashset_of(ValueReason::Other),
        }
    } else {
        AbstractValue {
            kind: ValueKind::Frozen,
            reason: hashset_of(ValueReason::ReactiveFunctionArgument),
        }
    };

    if func.fn_type == ReactFunctionType::Component {
        // Component: at most 2 params (props, ref)
        let params_len = func.params.len();
        if params_len > 0 {
            infer_param(
                &func.params[0],
                &mut initial_state,
                param_kind,
                &mut next_value_id,
            );
        }
        if params_len > 1 {
            let ref_place = func.params[1].place();
            let value_id = ValueId(next_value_id);
            next_value_id += 1;
            initial_state.initialize(
                value_id,
                AbstractValue {
                    kind: ValueKind::Mutable,
                    reason: hashset_of(ValueReason::Other),
                },
            );
            initial_state.define(ref_place.identifier, value_id);
        }
    } else {
        for param in &func.params {
            infer_param(param, &mut initial_state, param_kind, &mut next_value_id);
        }
    }

    let mut queued_states: IdMap<BlockId, InferenceState> = IdMap::new();

    // Queue helper. Clones a state that is lent only when actually inserting.
    fn queue(
        queued_states: &mut IdMap<BlockId, InferenceState>,
        states_by_block: &IdMap<BlockId, InferenceState>,
        block_id: BlockId,
        state: Cow<'_, InferenceState>,
    ) {
        if let Some(queued_state) = queued_states.get_mut(block_id) {
            queued_state.merge_from(&state);
        } else if let Some(prev) = states_by_block.get(block_id) {
            let mut next = prev.clone();
            if next.merge_from(&state) {
                queued_states.insert(block_id, next);
            }
        } else {
            queued_states.insert(block_id, state.into_owned());
        }
    }

    queue(
        &mut queued_states,
        &states_by_block,
        func.body.entry,
        Cow::Owned(initial_state),
    );

    let hoisted_context_declarations = find_hoisted_context_declarations(func, env);
    let non_mutating_spreads = find_non_mutated_destructure_spreads(func, env);

    let revisitable = blocks_reachable_from_back_edges(func);

    let mut instruction_signature_cache = Vec::new();
    if !revisitable.is_empty() {
        instruction_signature_cache.resize_with(func.instructions.len(), || None);
    }
    let mut context = Context {
        interned_effects: (!env.config.effects_keep_their_place).then(HashMap::default),
        instruction_signature_cache,
        signature: Vec::new(),
        effects: Vec::new(),
        catch_handlers: HashMap::default(),
        is_function_expression,
        hoisted_context_declarations,
        non_mutating_spreads,
        effect_value_id_cache: HashMap::with_capacity_and_hasher(
            func.instructions.len(),
            Default::default(),
        ),
        function_value_id_cache: HashMap::default(),
        function_values: Vec::new(),
        function_signature_cache: HashMap::default(),
        aliasing_config_temp_cache: HashMap::default(),
        next_value_id,
        fallback_value_ids: HashMap::default(),
    };

    let mut iteration_count = 0;

    while !queued_states.is_empty() {
        iteration_count += 1;
        if iteration_count > 100 {
            return Err(CompilerDiagnostic::new(
                ErrorCategory::Invariant,
                "[InferMutationAliasingEffects] Potential infinite loop: \
                 A value, temporary place, or effect was not cached properly",
                None,
            ));
        }

        for (&block_id, block) in func.body.blocks.iter_mut() {
            let incoming_state = match queued_states.swap_remove(block_id) {
                Some(s) => s,
                None => continue,
            };

            let is_revisitable = revisitable.contains(block_id);
            let mut state = if is_revisitable {
                let state = incoming_state.clone();
                states_by_block.insert(block_id, incoming_state);
                state
            } else {
                incoming_state
            };

            infer_block(
                &mut context,
                &mut state,
                block,
                is_revisitable,
                &mut func.instructions,
                env,
            )?;

            // Check for uninitialized identifier access (matches TS invariant:
            // "Expected value kind to be initialized")
            if let Some((uninitialized_id, usage_loc)) = state.uninitialized_access.get() {
                let ident_info = env.identifiers.get(uninitialized_id.0 as usize);
                let name = ident_info
                    .and_then(|ident| ident.name.as_ref())
                    .map(|n| bun_core::BStr::new(n.value()).to_string())
                    .unwrap_or_else(|| "".to_string());
                // Use usage_loc if available, otherwise fall back to identifier's own loc
                let error_loc = usage_loc.or_else(|| ident_info.and_then(|i| i.loc));
                // Match TS printPlace format: "<unknown> name$id:type"
                let type_str = ident_info
                    .map(|ident| {
                        let ty = &env.types[ident.type_.0 as usize];
                        format_type_for_print(ty)
                    })
                    .unwrap_or_default();
                let description = format!("<unknown> {}${}{}", name, uninitialized_id.0, type_str);
                let diag = CompilerDiagnostic::new(
                    ErrorCategory::Invariant,
                    "[InferMutationAliasingEffects] Expected value kind to be initialized",
                    Some(description),
                )
                .with_detail(CompilerDiagnosticDetail::Error {
                    loc: error_loc,
                    message: Some("this is uninitialized".to_string()),
                    identifier_name: None,
                });
                return Err(diag);
            }

            // Queue successors
            let mut successors = visitors::each_terminal_successor(&block.terminal);
            let last = successors.pop();
            for next_block_id in successors {
                let state = Cow::Borrowed(&state);
                queue(&mut queued_states, &states_by_block, next_block_id, state);
            }
            if let Some(next_block_id) = last {
                let state = Cow::Owned(state);
                queue(&mut queued_states, &states_by_block, next_block_id, state);
            }
        }
    }

    if !env.has_stack() {
        return Err(crate::lowering::nested_too_deeply());
    }
    Ok(())
}

/// Blocks that the fixpoint loop can queue again after it processed them.
///
/// A block is queued only when one of its predecessors is processed, and each
/// sweep processes blocks in `func.body.blocks` order. So a block is queued
/// after its own turn only if it is the target of an edge from the same or a
/// later block, or if such a target reaches it. Every other block is processed
/// exactly once and `states_by_block` never reads its incoming state back.
fn blocks_reachable_from_back_edges(func: &HirFunction) -> IdBitSet<BlockId> {
    let mut not_later: IdBitSet<BlockId> = IdBitSet::new();
    let mut worklist: Vec<BlockId> = Vec::new();
    for (&block_id, block) in &func.body.blocks {
        not_later.insert(block_id);
        for successor in visitors::each_terminal_successor(&block.terminal) {
            if not_later.contains(successor) {
                worklist.push(successor);
            }
        }
    }
    let mut reachable: IdBitSet<BlockId> = IdBitSet::new();
    while let Some(block_id) = worklist.pop() {
        if !reachable.insert(block_id) {
            continue;
        }
        if let Some(block) = func.body.blocks.get(&block_id) {
            worklist.extend(visitors::each_terminal_successor(&block.terminal));
        }
    }
    reachable
}

// =============================================================================
// ValueId: replaces InstructionValue identity as allocation-site key
// =============================================================================

/// Unique allocation-site identifier, replacing TS's object-identity on InstructionValue.
///
/// IDs are dense and pass-local (allocated via `Context.next_value_id`) so
/// `InferenceState.values` can be a `ChunkedVec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
struct ValueId(u32);

// =============================================================================
// AbstractValue
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AbstractValue {
    kind: ValueKind,
    reason: ValueReasonSet,
}

#[inline]
fn hashset_of(r: ValueReason) -> ValueReasonSet {
    ValueReasonSet::only(r)
}

/// An `Option<AbstractValue>` in a number. Zero is `None`.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct PackedValue(u32);

impl PackedValue {
    #[inline]
    fn new(value: AbstractValue) -> Self {
        let packed =
            PackedValue(1 | (value.kind as u32) << 1 | u32::from(value.reason.as_u16()) << 16);
        debug_assert!(packed.get() == Some(value));
        packed
    }

    #[inline]
    fn get(self) -> Option<AbstractValue> {
        if self.0 == 0 {
            return None;
        }
        const KINDS: [ValueKind; 8] = [
            ValueKind::Mutable,
            ValueKind::Frozen,
            ValueKind::Primitive,
            ValueKind::MaybeFrozen,
            ValueKind::Global,
            ValueKind::Context,
            ValueKind::Context,
            ValueKind::Context,
        ];
        Some(AbstractValue {
            kind: KINDS[(self.0 >> 1 & 7) as usize],
            reason: ValueReasonSet::from_u16_truncated((self.0 >> 16) as u16),
        })
    }
}

/// What a [`ChunkedVec`] holds: a number, so that a stretch of them is compared at once.
trait Packed: Copy + Default {
    fn bits(self) -> u32;
}

impl Packed for PackedValue {
    #[inline]
    fn bits(self) -> u32 {
        self.0
    }
}

impl Packed for ValueSet {
    #[inline]
    fn bits(self) -> u32 {
        self.0
    }
}

// =============================================================================
// ValueSet — compact points-to set
// =============================================================================

/// The points-to set of an identifier. Two that are equal are the same set; two that are not can be.
///
/// Typical cardinality is 1, and such a set is its `ValueId`. A larger one is a place in [`ValueSets`].
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct ValueSet(u32);

impl ValueSet {
    const EMPTY: ValueSet = ValueSet(0);

    #[inline]
    fn singleton(v: ValueId) -> Self {
        ValueSet(v.0 << 1 | 1)
    }

    #[inline]
    fn is_empty(self) -> bool {
        self.0 == 0
    }

    #[inline]
    fn as_singleton(self) -> Option<ValueId> {
        (self.0 & 1 == 1).then_some(ValueId(self.0 >> 1))
    }
}

/// The sets of more than one value, of all the states of a pass.
///
/// Each is a value added to a smaller set: the set of a phi at the end of n branches, or of the
/// binding of a handler after n calls, grows n times, and each time takes the room of one value.
#[derive(Default)]
struct ValueSets {
    added: Vec<(ValueId, ValueSet)>,
}

impl ValueSets {
    /// `set`, which is not empty, and a value that is not in it.
    fn with(&mut self, set: ValueSet, value: ValueId) -> ValueSet {
        self.added.push((value, set));
        ValueSet((self.added.len() as u32) << 1)
    }

    /// The value that was added last, and the set that it was added to.
    #[inline]
    fn split(&self, set: ValueSet) -> Option<(ValueId, ValueSet)> {
        if set.is_empty() {
            return None;
        }
        Some(match set.as_singleton() {
            Some(value) => (value, ValueSet::EMPTY),
            None => self.added[(set.0 >> 1) as usize - 1],
        })
    }

    fn newest_first(&self, set: ValueSet) -> impl Iterator<Item = ValueId> {
        let mut rest = set;
        std::iter::from_fn(move || {
            let (value, smaller) = self.split(rest)?;
            rest = smaller;
            Some(value)
        })
    }

    fn oldest_first(&self, set: ValueSet) -> SmallVec<[ValueId; 4]> {
        let mut values: SmallVec<[ValueId; 4]> = self.newest_first(set).collect();
        values.reverse();
        values
    }

    /// `mine`, then what only `theirs` has, in its order. It is `mine` itself if there is no such value.
    fn union(&mut self, mine: ValueSet, theirs: ValueSet) -> ValueSet {
        const FEW: usize = 16;
        if mine.is_empty() || mine == theirs {
            return theirs;
        }
        let mut members: SmallVec<[ValueId; FEW]> = SmallVec::new();
        let mut rest = mine;
        while let Some((value, smaller)) = self.split(rest) {
            // What is merged is most often an earlier state of the same set.
            if rest == theirs {
                return mine;
            }
            members.push(value);
            rest = smaller;
        }
        let mut rest = theirs;
        while let Some((_, smaller)) = self.split(rest) {
            // Or a later one.
            if smaller == mine {
                return theirs;
            }
            rest = smaller;
        }
        let theirs = self.oldest_first(theirs);
        let mut all = mine;
        if members.len() <= FEW || theirs.len() <= 1 {
            for value in theirs {
                if !members.contains(&value) {
                    all = self.with(all, value);
                }
            }
        } else {
            let members: HashSet<ValueId> = members.into_iter().collect();
            for value in theirs {
                if !members.contains(&value) {
                    all = self.with(all, value);
                }
            }
        }
        all
    }
}

const CHUNK: usize = 64;
const CHUNKS: usize = 16;

type Chunk<T> = Rc<[T; CHUNK]>;

/// A vector in chunks of chunks that its clones share until one of them writes to the chunk.
#[derive(Clone)]
struct ChunkedVec<T>(SmallVec<[Rc<[Chunk<T>; CHUNKS]>; 2]>);

impl<T: Packed> ChunkedVec<T> {
    fn new() -> Self {
        ChunkedVec(SmallVec::new())
    }

    #[cold]
    fn grow(&mut self, chunks_of_chunks: usize) {
        let empty = Rc::new([T::default(); CHUNK]);
        let empty = Rc::new(std::array::from_fn(|_| Rc::clone(&empty)));
        self.0.resize(chunks_of_chunks, empty);
    }

    /// The default where nothing was written.
    #[inline]
    fn get(&self, i: usize) -> T {
        match self.0.get(i / (CHUNK * CHUNKS)) {
            Some(chunks) => chunks[i / CHUNK % CHUNKS][i % CHUNK],
            None => T::default(),
        }
    }

    #[inline]
    fn set(&mut self, i: usize, value: T) {
        if i / (CHUNK * CHUNKS) >= self.0.len() {
            self.grow(i / (CHUNK * CHUNKS) + 1);
        }
        let chunks = Rc::make_mut(&mut self.0[i / (CHUNK * CHUNKS)]);
        Rc::make_mut(&mut chunks[i / CHUNK % CHUNKS])[i % CHUNK] = value;
    }

    /// Puts `merged(mine, theirs)` at each index where it is something, and copies no chunk for less. Whether it was.
    fn merge_from(&mut self, other: &Self, mut merged: impl FnMut(T, T) -> Option<T>) -> bool {
        if other.0.len() > self.0.len() {
            self.grow(other.0.len());
        }
        let mut changed = false;
        for (mine, theirs) in self.0.iter_mut().zip(&other.0) {
            if Rc::ptr_eq(mine, theirs) {
                continue;
            }
            for (chunk, theirs) in theirs.iter().enumerate() {
                if Rc::ptr_eq(&mine[chunk], theirs) {
                    continue;
                }
                const STRETCH: usize = 8;
                let before: &[T; CHUNK] = &mine[chunk];
                let mut all: Option<[T; CHUNK]> = None;
                for start in (0..CHUNK).step_by(STRETCH) {
                    let stretch = start..start + STRETCH;
                    let pairs = before[stretch.clone()].iter().zip(&theirs[stretch.clone()]);
                    if pairs.fold(0, |bits, (mine, theirs)| {
                        bits | (mine.bits() ^ theirs.bits())
                    }) == 0
                    {
                        continue;
                    }
                    for at in stretch {
                        if let Some(merged) = merged(before[at], theirs[at]) {
                            all.get_or_insert(*before)[at] = merged;
                        }
                    }
                }
                if let Some(all) = all {
                    let chunk = &mut Rc::make_mut(mine)[chunk];
                    match Rc::get_mut(chunk) {
                        Some(chunk) => *chunk = all,
                        None => *chunk = Rc::new(all),
                    }
                    changed = true;
                }
            }
        }
        changed
    }
}

// =============================================================================
// InferenceState
// =============================================================================

/// The abstract state tracked during inference.
#[derive(Clone)]
struct InferenceState {
    /// Kind of each allocation site, indexed by `ValueId.0`. `None` = unset.
    values: ChunkedVec<PackedValue>,
    /// Points-to set per identifier, indexed by `IdentifierId.0`.
    variables: ChunkedVec<ValueSet>,
    sets: Rc<RefCell<ValueSets>>,
    uninitialized_access: std::cell::Cell<Option<(IdentifierId, Option<SourceLocation>)>>,
}

impl InferenceState {
    fn empty() -> Self {
        InferenceState {
            values: ChunkedVec::new(),
            variables: ChunkedVec::new(),
            sets: Rc::default(),
            uninitialized_access: std::cell::Cell::new(None),
        }
    }

    #[inline]
    fn value(&self, id: ValueId) -> Option<AbstractValue> {
        self.values.get(id.0 as usize).get()
    }

    #[inline]
    fn set_of(&self, place_id: IdentifierId) -> ValueSet {
        self.variables.get(place_id.0 as usize)
    }

    #[inline]
    fn union(&self, mine: ValueSet, theirs: ValueSet) -> ValueSet {
        if theirs.is_empty() || mine == theirs {
            mine
        } else if mine.is_empty() {
            theirs
        } else {
            self.sets.borrow_mut().union(mine, theirs)
        }
    }

    /// Check the kind of a place, recording the usage location for error reporting.
    #[inline]
    fn kind_with_loc(
        &self,
        place_id: IdentifierId,
        usage_loc: Option<SourceLocation>,
    ) -> AbstractValue {
        if let Some(value_id) = self.set_of(place_id).as_singleton()
            && let Some(value) = self.value(value_id)
        {
            return value;
        }
        self.kind_of_any_set(place_id, usage_loc)
    }

    #[inline(never)]
    fn kind_of_any_set(
        &self,
        place_id: IdentifierId,
        usage_loc: Option<SourceLocation>,
    ) -> AbstractValue {
        let unknown = AbstractValue {
            kind: ValueKind::Mutable,
            reason: hashset_of(ValueReason::Other),
        };
        let values = self.set_of(place_id);
        if let Some(value_id) = values.as_singleton() {
            return self.value(value_id).unwrap_or(unknown);
        }
        if values.is_empty() {
            if self.uninitialized_access.get().is_none() {
                self.uninitialized_access.set(Some((place_id, usage_loc)));
            }
            return unknown;
        }
        let mut merged_kind: Option<AbstractValue> = None;
        for value_id in self.sets.borrow().newest_first(values) {
            let kind = match self.value(value_id) {
                Some(k) => k,
                None => continue,
            };
            merged_kind = Some(match merged_kind {
                Some(prev) => merge_abstract_values(prev, kind),
                None => kind,
            });
        }
        merged_kind.unwrap_or(unknown)
    }

    fn initialize(&mut self, value_id: ValueId, kind: AbstractValue) {
        self.values.set(value_id.0 as usize, PackedValue::new(kind));
    }

    fn define(&mut self, place_id: IdentifierId, value_id: ValueId) {
        self.variables
            .set(place_id.0 as usize, ValueSet::singleton(value_id));
    }

    fn assign(&mut self, into: IdentifierId, from: IdentifierId, context: &mut Context) {
        let mut values = self.set_of(from);
        if values.is_empty() {
            let fallback = context.fallback_value_id(from);
            if self.value(fallback).is_none() {
                self.initialize(
                    fallback,
                    AbstractValue {
                        kind: ValueKind::Mutable,
                        reason: hashset_of(ValueReason::Other),
                    },
                );
            }
            values = ValueSet::singleton(fallback);
        }
        self.variables.set(into.0 as usize, values);
    }

    /// No-op if either is undefined.
    fn append_alias(&mut self, place: IdentifierId, value: IdentifierId) {
        let values = self.set_of(place);
        if values.is_empty() {
            return;
        }
        let all = self.union(values, self.set_of(value));
        if all != values {
            self.variables.set(place.0 as usize, all);
        }
    }

    #[inline]
    fn is_defined(&self, place_id: IdentifierId) -> bool {
        !self.set_of(place_id).is_empty()
    }

    /// In the order in which they came into the set.
    fn values_for(&self, place_id: IdentifierId) -> SmallVec<[ValueId; 4]> {
        let values = self.set_of(place_id);
        match values.as_singleton() {
            Some(value_id) => smallvec::smallvec![value_id],
            None => self.sets.borrow().oldest_first(values),
        }
    }

    fn kind(&self, place_id: IdentifierId) -> AbstractValue {
        self.kind_with_loc(place_id, None)
    }

    fn freeze(&mut self, place_id: IdentifierId, reason: ValueReason) -> bool {
        if !self.is_defined(place_id) {
            return false;
        }
        let value = self.kind(place_id);
        match value.kind {
            ValueKind::Context | ValueKind::Mutable | ValueKind::MaybeFrozen => {
                for vid in self.values_for(place_id) {
                    self.freeze_value(vid, reason);
                }
                true
            }
            ValueKind::Frozen | ValueKind::Global | ValueKind::Primitive => false,
        }
    }

    fn freeze_value(&mut self, value_id: ValueId, reason: ValueReason) {
        self.initialize(
            value_id,
            AbstractValue {
                kind: ValueKind::Frozen,
                reason: hashset_of(reason),
            },
        );
    }

    fn mutate_with_loc(
        &self,
        variant: MutateVariant,
        place_id: IdentifierId,
        env: &Environment,
        usage_loc: Option<SourceLocation>,
    ) -> MutationResult {
        let ty = &env.types[env.identifiers[place_id.0 as usize].type_.0 as usize];
        if crate::hir::is_ref_or_ref_value(ty) {
            return MutationResult::MutateRef;
        }
        let kind = self.kind_with_loc(place_id, usage_loc).kind;
        match variant {
            MutateVariant::MutateConditionally | MutateVariant::MutateTransitiveConditionally => {
                match kind {
                    ValueKind::Mutable | ValueKind::Context => MutationResult::Mutate,
                    _ => MutationResult::None,
                }
            }
            MutateVariant::Mutate | MutateVariant::MutateTransitive => match kind {
                ValueKind::Mutable | ValueKind::Context => MutationResult::Mutate,
                ValueKind::Primitive => MutationResult::None,
                ValueKind::Frozen | ValueKind::MaybeFrozen => MutationResult::MutateFrozen,
                ValueKind::Global => MutationResult::MutateGlobal,
            },
        }
    }

    /// Merge `other` into `self` in place. Returns `true` if `self` changed.
    fn merge_from(&mut self, other: &InferenceState) -> bool {
        let values_changed = self.values.merge_from(&other.values, |value, ov| {
            if value == ov {
                return None;
            }
            let merged = match value.get() {
                Some(this) => PackedValue::new(merge_abstract_values(this, ov.get()?)),
                None => ov,
            };
            (value != merged).then_some(merged)
        });

        let sets = &self.sets;
        let variables_changed = self.variables.merge_from(&other.variables, |mine, theirs| {
            if theirs.is_empty() || mine == theirs {
                return None;
            }
            if mine.is_empty() {
                return Some(theirs);
            }
            let all = sets.borrow_mut().union(mine, theirs);
            (all != mine).then_some(all)
        });

        values_changed | variables_changed
    }

    fn infer_phi(
        &mut self,
        phi_place_id: IdentifierId,
        phi_operands: &crate::collections::IndexMap<BlockId, Place>,
    ) {
        let mut values = ValueSet::EMPTY;
        for operand in phi_operands.values() {
            // If not found, it's a backedge that will be handled later by merge
            values = self.union(values, self.set_of(operand.identifier));
        }
        if !values.is_empty() {
            self.variables.set(phi_place_id.0 as usize, values);
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum MutateVariant {
    Mutate,
    MutateConditionally,
    MutateTransitive,
    MutateTransitiveConditionally,
}

/// What a value is to an effect that lets data flow from it or into it. `None`: nothing to track.
#[derive(Clone, Copy, PartialEq, Eq)]
enum DataFlowType {
    Context,
    Mutable,
    Frozen,
}

impl DataFlowType {
    fn of_destination(kind: ValueKind) -> Option<Self> {
        match kind {
            ValueKind::Context => Some(DataFlowType::Context),
            ValueKind::Mutable | ValueKind::MaybeFrozen => Some(DataFlowType::Mutable),
            _ => None,
        }
    }

    fn of_source(kind: ValueKind) -> Option<Self> {
        match kind {
            ValueKind::Context => Some(DataFlowType::Context),
            ValueKind::Global | ValueKind::Primitive => None,
            ValueKind::MaybeFrozen | ValueKind::Frozen => Some(DataFlowType::Frozen),
            ValueKind::Mutable => Some(DataFlowType::Mutable),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MutationResult {
    None,
    Mutate,
    MutateFrozen,
    MutateGlobal,
    MutateRef,
}

// =============================================================================
// Context
// =============================================================================

struct Context {
    /// `None`: `EnvironmentConfig::effects_keep_their_place`
    interned_effects: Option<HashMap<EffectKey, Rc<AliasingEffect>>>,
    /// By index into `HirFunction::instructions`, for the blocks that can be visited again.
    instruction_signature_cache: Vec<Option<Vec<AliasingEffect>>>,
    /// The signature of the instruction at hand, in a block that is visited once.
    signature: Vec<AliasingEffect>,
    /// The effects of the instruction at hand.
    effects: Vec<AliasingEffect>,
    catch_handlers: HashMap<BlockId, Place>,
    is_function_expression: bool,
    hoisted_context_declarations: HashMap<DeclarationId, Option<Place>>,
    non_mutating_spreads: HashSet<IdentifierId>,
    /// Cache of ValueIds keyed by effect, ensuring stable allocation-site identity
    /// across fixpoint iterations. Mirrors TS `effectInstructionValueCache`.
    effect_value_id_cache: HashMap<ValueKey, ValueId>,
    /// The same for `CreateFunction`, whose key has no fixed size.
    function_value_id_cache: HashMap<EffectKey, ValueId>,
    /// Maps ValueId to FunctionId for function expressions, so we can look up
    /// locally-declared functions when processing Apply effects.
    function_values: Vec<Option<FunctionId>>,
    /// Cache of function expression signatures, keyed by FunctionId
    function_signature_cache: HashMap<FunctionId, Rc<AliasingSignature>>,
    /// Cache of temporary places created for aliasing signature config temporaries.
    /// Keyed by (lvalue_identifier_id, index into config.temporaries) to ensure
    /// stable allocation across fixpoint iterations.
    aliasing_config_temp_cache: HashMap<(IdentifierId, u32), Place>,
    /// Pass-local ValueId allocator.
    next_value_id: u32,
    /// Stable per-identifier fallback ValueIds for the read-before-define path
    /// (`assign()` from an undefined source).
    fallback_value_ids: HashMap<IdentifierId, ValueId>,
}

impl Context {
    /// `None`: the effect itself.
    #[inline]
    fn interned_effect(&mut self, effect: &AliasingEffect) -> Option<Rc<AliasingEffect>> {
        #[inline(never)]
        fn intern(
            interned_effects: &mut HashMap<EffectKey, Rc<AliasingEffect>>,
            effect: &AliasingEffect,
        ) -> Rc<AliasingEffect> {
            let interned = interned_effects
                .entry(effect_key(effect))
                .or_insert_with(|| Rc::new(effect.clone()));
            Rc::clone(interned)
        }
        Some(intern(self.interned_effects.as_mut()?, effect))
    }

    #[inline]
    fn intern_effect(&mut self, effect: AliasingEffect) -> AliasingEffect {
        match self.interned_effect(&effect) {
            Some(interned) => AliasingEffect::clone(&interned),
            None => effect,
        }
    }

    fn function_of(&self, value_id: ValueId) -> Option<FunctionId> {
        function_of(&self.function_values, value_id)
    }

    fn new_value_id(&mut self) -> ValueId {
        let id = ValueId(self.next_value_id);
        self.next_value_id += 1;
        id
    }

    fn fallback_value_id(&mut self, id: IdentifierId) -> ValueId {
        if let Some(v) = self.fallback_value_ids.get(&id) {
            return *v;
        }
        let v = self.new_value_id();
        self.fallback_value_ids.insert(id, v);
        v
    }

    /// Get or create a stable ValueId for a given effect, ensuring fixpoint convergence.
    fn value_id_of_key(&mut self, key: ValueKey) -> ValueId {
        *self.effect_value_id_cache.entry(key).or_insert_with(|| {
            let id = ValueId(self.next_value_id);
            self.next_value_id += 1;
            id
        })
    }

    /// `value_id_of_key` for a `CreateFunction`.
    fn value_id_of_function(&mut self, effect: &AliasingEffect) -> ValueId {
        let ids = &mut self.function_value_id_cache;
        *ids.entry(effect_key(effect)).or_insert_with(|| {
            let id = ValueId(self.next_value_id);
            self.next_value_id += 1;
            id
        })
    }
}

/// An effect that makes a value, with all that [`effect_key`] has of it.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum ValueKey {
    Create {
        into: IdentifierId,
        kind: u8,
        reason: u8,
    },
    CreateFrom {
        from: IdentifierId,
        into: IdentifierId,
    },
    /// `Assign` of a frozen value.
    AssignFrozen {
        from: IdentifierId,
        into: IdentifierId,
    },
    /// `Assign` of a global or a primitive.
    AssignCopied {
        from: IdentifierId,
        into: IdentifierId,
    },
}

fn function_of(function_values: &[Option<FunctionId>], value_id: ValueId) -> Option<FunctionId> {
    function_values.get(value_id.0 as usize).copied().flatten()
}

/// The places that the instruction at hand has initialized.
type Initialized = SmallVec<[IdentifierId; 8]>;

// =============================================================================
// Helper: effect_key
// =============================================================================

/// What TS `hashEffect` makes a string of: effects with the same key are one effect.
type EffectKey = SmallVec<[u32; 8]>;

fn effect_key(effect: &AliasingEffect) -> EffectKey {
    fn push_bytes(key: &mut EffectKey, bytes: &[u8]) {
        key.push(bytes.len() as u32);
        for word in bytes.chunks(4) {
            let mut padded = [0; 4];
            padded[..word.len()].copy_from_slice(word);
            key.push(u32::from_le_bytes(padded));
        }
    }
    fn push_error(key: &mut EffectKey, error: &CompilerDiagnostic) {
        key.push(error.severity() as u32);
        for position in
            (error.primary_location()).map_or([None; 2], |loc| [loc.start.index, loc.end.index])
        {
            key.extend([u32::from(position.is_some()), position.unwrap_or(0)]);
        }
        push_bytes(key, error.reason.as_bytes());
        push_bytes(key, error.description.as_deref().unwrap_or("").as_bytes());
    }

    let mut key = EffectKey::new();
    match effect {
        AliasingEffect::Apply(apply) => {
            key.extend([
                0,
                apply.receiver.identifier.0,
                apply.function.identifier.0,
                u32::from(apply.mutates_function),
                apply.into.identifier.0,
            ]);
            for a in apply.args.iter() {
                match a {
                    PlaceOrSpreadOrHole::Hole => key.push(0),
                    PlaceOrSpreadOrHole::Place(p) => key.extend([1, p.identifier.0]),
                    PlaceOrSpreadOrHole::Spread(s) => key.extend([2, s.place.identifier.0]),
                }
            }
        }
        AliasingEffect::CreateFrom { from, into } => {
            key.extend([1, from.identifier.0, into.identifier.0]);
        }
        AliasingEffect::ImmutableCapture { from, into } => {
            key.extend([2, from.identifier.0, into.identifier.0]);
        }
        AliasingEffect::Assign { from, into } => {
            key.extend([3, from.identifier.0, into.identifier.0]);
        }
        AliasingEffect::Alias { from, into } => {
            key.extend([4, from.identifier.0, into.identifier.0]);
        }
        AliasingEffect::Capture { from, into } => {
            key.extend([5, from.identifier.0, into.identifier.0]);
        }
        AliasingEffect::MaybeAlias { from, into } => {
            key.extend([6, from.identifier.0, into.identifier.0]);
        }
        AliasingEffect::Create {
            into,
            value,
            reason,
        } => key.extend([7, into.identifier.0, *value as u32, *reason as u32]),
        AliasingEffect::Freeze { value, reason } => {
            key.extend([8, value.identifier.0, *reason as u32]);
        }
        AliasingEffect::Impure { place, .. } => key.extend([9, place.identifier.0]),
        AliasingEffect::Render { place } => key.extend([10, place.identifier.0]),
        AliasingEffect::MutateFrozen { place, error } => {
            key.extend([11, place.identifier.0]);
            push_error(&mut key, error);
        }
        AliasingEffect::MutateGlobal { place, error } => {
            key.extend([12, place.identifier.0]);
            push_error(&mut key, error);
        }
        AliasingEffect::Mutate { value, .. } => key.extend([13, value.identifier.0]),
        AliasingEffect::MutateConditionally { value } => key.extend([14, value.identifier.0]),
        AliasingEffect::MutateTransitive { value } => key.extend([15, value.identifier.0]),
        AliasingEffect::MutateTransitiveConditionally { value } => {
            key.extend([16, value.identifier.0]);
        }
        AliasingEffect::CreateFunction {
            into,
            function_id,
            captures,
        } => {
            key.extend([17, into.identifier.0, function_id.0]);
            key.extend(captures.iter().map(|p| p.identifier.0));
        }
    }
    key
}

// =============================================================================
// merge helpers
// =============================================================================

fn merge_abstract_values(a: AbstractValue, b: AbstractValue) -> AbstractValue {
    AbstractValue {
        kind: merge_value_kinds(a.kind, b.kind),
        reason: a.reason | b.reason,
    }
}

fn merge_value_kinds(a: ValueKind, b: ValueKind) -> ValueKind {
    if a == b {
        return a;
    }
    if a == ValueKind::MaybeFrozen || b == ValueKind::MaybeFrozen {
        return ValueKind::MaybeFrozen;
    }
    if a == ValueKind::Mutable || b == ValueKind::Mutable {
        if a == ValueKind::Frozen || b == ValueKind::Frozen {
            return ValueKind::MaybeFrozen;
        } else if a == ValueKind::Context || b == ValueKind::Context {
            return ValueKind::Context;
        } else {
            return ValueKind::Mutable;
        }
    }
    if a == ValueKind::Context || b == ValueKind::Context {
        if a == ValueKind::Frozen || b == ValueKind::Frozen {
            return ValueKind::MaybeFrozen;
        } else {
            return ValueKind::Context;
        }
    }
    if a == ValueKind::Frozen || b == ValueKind::Frozen {
        return ValueKind::Frozen;
    }
    if a == ValueKind::Global || b == ValueKind::Global {
        return ValueKind::Global;
    }
    ValueKind::Primitive
}

// =============================================================================
// Pre-passes
// =============================================================================

fn find_hoisted_context_declarations(
    func: &HirFunction,
    env: &Environment,
) -> HashMap<DeclarationId, Option<Place>> {
    let mut hoisted: HashMap<DeclarationId, Option<Place>> = HashMap::default();

    fn visit(
        hoisted: &mut HashMap<DeclarationId, Option<Place>>,
        place: &Place,
        env: &Environment,
    ) {
        let decl_id = env.identifiers[place.identifier.0 as usize].declaration_id;
        if let Some(first_access @ None) = hoisted.get_mut(&decl_id) {
            *first_access = Some(place.clone());
        }
    }

    for (_block_id, block) in &func.body.blocks {
        for instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::DeclareContext { lvalue, .. } => {
                    let kind = lvalue.kind;
                    if kind == InstructionKind::HoistedConst
                        || kind == InstructionKind::HoistedFunction
                        || kind == InstructionKind::HoistedLet
                    {
                        let decl_id =
                            env.identifiers[lvalue.place.identifier.0 as usize].declaration_id;
                        hoisted.insert(decl_id, None);
                    }
                }
                _ if hoisted.is_empty() => {}
                _ => {
                    for operand in visitors::operands(&instr.value, &env.functions) {
                        visit(&mut hoisted, operand, env);
                    }
                }
            }
        }
        if hoisted.is_empty() {
            continue;
        }
        for operand in visitors::terminal_operands(&block.terminal) {
            visit(&mut hoisted, operand, env);
        }
    }
    hoisted
}

fn find_non_mutated_destructure_spreads(
    func: &HirFunction,
    env: &Environment,
) -> HashSet<IdentifierId> {
    let mut known_frozen: IdBitSet<IdentifierId> = IdBitSet::new();
    if func.fn_type == ReactFunctionType::Component {
        if let Some(param) = func.params.first() {
            if let ParamPattern::Place(p) = param {
                known_frozen.insert(p.identifier);
            }
        }
    } else {
        for param in &func.params {
            if let ParamPattern::Place(p) = param {
                known_frozen.insert(p.identifier);
            }
        }
    }

    let mut candidate_non_mutating_spreads: HashMap<IdentifierId, IdentifierId> =
        HashMap::default();
    for (_block_id, block) in &func.body.blocks {
        if !candidate_non_mutating_spreads.is_empty() {
            for phi in &block.phis {
                for (_, operand) in &phi.operands {
                    if let Some(spread) = candidate_non_mutating_spreads
                        .get(&operand.identifier)
                        .copied()
                    {
                        candidate_non_mutating_spreads.remove(&spread);
                    }
                }
            }
        }
        for instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            let lvalue_id = instr.lvalue.identifier;
            match &instr.value {
                InstructionValue::Destructure { lvalue, value, .. } => {
                    if !known_frozen.contains(value.identifier) {
                        continue;
                    }
                    if !(lvalue.kind == InstructionKind::Let
                        || lvalue.kind == InstructionKind::Const)
                    {
                        continue;
                    }
                    match &lvalue.pattern {
                        crate::hir::Pattern::Object(obj_pat) => {
                            for prop in &obj_pat.properties {
                                if let crate::hir::ObjectPropertyOrSpread::Spread(s) = prop {
                                    candidate_non_mutating_spreads
                                        .insert(s.place.identifier, s.place.identifier);
                                }
                            }
                        }
                        _ => continue,
                    }
                }
                InstructionValue::LoadLocal { place, .. } => {
                    if let Some(spread) = candidate_non_mutating_spreads
                        .get(&place.identifier)
                        .copied()
                    {
                        candidate_non_mutating_spreads.insert(lvalue_id, spread);
                    }
                }
                InstructionValue::StoreLocal {
                    lvalue: sl,
                    value: sv,
                    ..
                } => {
                    if let Some(spread) =
                        candidate_non_mutating_spreads.get(&sv.identifier).copied()
                    {
                        candidate_non_mutating_spreads.insert(lvalue_id, spread);
                        candidate_non_mutating_spreads.insert(sl.place.identifier, spread);
                    }
                }
                InstructionValue::JsxFragment { .. } | InstructionValue::JsxExpression { .. } => {
                    // Passing objects created with spread to jsx can't mutate them
                }
                InstructionValue::PropertyLoad { .. } => {
                    // Properties must be frozen since the original value was frozen
                }
                InstructionValue::CallExpression { callee, .. }
                | InstructionValue::MethodCall {
                    property: callee, ..
                } => {
                    let callee_ty =
                        &env.types[env.identifiers[callee.identifier.0 as usize].type_.0 as usize];
                    if get_hook_kind_for_type(env, callee_ty)
                        .ok()
                        .flatten()
                        .is_some()
                    {
                        if !is_ref_or_ref_value_for_id(env, lvalue_id) {
                            known_frozen.insert(lvalue_id);
                        }
                    } else if !candidate_non_mutating_spreads.is_empty() {
                        for operand in visitors::operands(&instr.value, &env.functions) {
                            if let Some(spread) = candidate_non_mutating_spreads
                                .get(&operand.identifier)
                                .copied()
                            {
                                candidate_non_mutating_spreads.remove(&spread);
                            }
                        }
                    }
                }
                _ => {
                    if !candidate_non_mutating_spreads.is_empty() {
                        for operand in visitors::operands(&instr.value, &env.functions) {
                            if let Some(spread) = candidate_non_mutating_spreads
                                .get(&operand.identifier)
                                .copied()
                            {
                                candidate_non_mutating_spreads.remove(&spread);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut non_mutating: HashSet<IdentifierId> = HashSet::default();
    for (key, value) in &candidate_non_mutating_spreads {
        if key == value {
            non_mutating.insert(*key);
        }
    }
    non_mutating
}

// =============================================================================
// inferParam
// =============================================================================

fn infer_param(
    param: &ParamPattern,
    state: &mut InferenceState,
    param_kind: AbstractValue,
    next_value_id: &mut u32,
) {
    let place = param.place();
    let value_id = ValueId(*next_value_id);
    *next_value_id += 1;
    state.initialize(value_id, param_kind);
    state.define(place.identifier, value_id);
}

// =============================================================================
// inferBlock
// =============================================================================

fn infer_block(
    context: &mut Context,
    state: &mut InferenceState,
    block: &mut BasicBlock,
    is_revisitable: bool,
    instructions: &mut [Instruction],
    env: &mut Environment,
) -> Result<(), CompilerDiagnostic> {
    // Process phis
    for phi in &block.phis {
        state.infer_phi(phi.place.identifier, &phi.operands);
    }

    // Process instructions
    let mut signature = std::mem::take(&mut context.signature);
    let mut effects = std::mem::take(&mut context.effects);
    for instr_id in &block.instructions {
        let instr_index = instr_id.0 as usize;
        let instr = &instructions[instr_index];

        if is_revisitable {
            let cached = match context.instruction_signature_cache[instr_index].take() {
                Some(cached) => cached,
                None => {
                    let mut computed = Vec::new();
                    compute_signature_for_instruction(context, env, instr, &mut computed);
                    computed
                }
            };
            apply_signature(context, state, &cached, instr, env, &mut effects)?;
            context.instruction_signature_cache[instr_index] = Some(cached);
        } else {
            signature.clear();
            compute_signature_for_instruction(context, env, instr, &mut signature);
            apply_signature(context, state, &signature, instr, env, &mut effects)?;
        }
        instructions[instr_index].effects = if effects.is_empty() {
            None
        } else {
            Some(AstAlloc::vec_from_iter(effects.drain(..)))
        };
    }
    context.signature = signature;
    context.effects = effects;

    // Process terminal
    match &mut block.terminal {
        Terminal::Try {
            handler,
            handler_binding: Some(binding),
            ..
        } => {
            context.catch_handlers.insert(*handler, binding.clone());
        }
        Terminal::MaybeThrow {
            handler: Some(handler_id),
            effects: term_effects,
            ..
        } => {
            if let Some(handler_param) = context.catch_handlers.get(handler_id).cloned() {
                if state.is_defined(handler_param.identifier) {
                    let mut terminal_effects: HirVec<AliasingEffect> = AstAlloc::vec();
                    for instr_id in &block.instructions {
                        let instr = &instructions[instr_id.0 as usize];
                        match &instr.value {
                            InstructionValue::CallExpression { .. }
                            | InstructionValue::MethodCall { .. } => {
                                state.append_alias(
                                    handler_param.identifier,
                                    instr.lvalue.identifier,
                                );
                                let kind = state.kind(instr.lvalue.identifier).kind;
                                if kind == ValueKind::Mutable || kind == ValueKind::Context {
                                    terminal_effects.push(context.intern_effect(
                                        AliasingEffect::Alias {
                                            from: instr.lvalue.clone(),
                                            into: handler_param.clone(),
                                        },
                                    ));
                                }
                            }
                            _ => {}
                        }
                    }
                    *term_effects = if terminal_effects.is_empty() {
                        None
                    } else {
                        Some(terminal_effects)
                    };
                }
            }
        }
        Terminal::Return {
            value,
            effects: term_effects,
            ..
        } => {
            if !context.is_function_expression {
                *term_effects = Some(crate::hir_vec![context.intern_effect(
                    AliasingEffect::Freeze {
                        value: value.clone(),
                        reason: ValueReason::JsxCaptured,
                    }
                )]);
            }
        }
        _ => {}
    }
    Ok(())
}

// =============================================================================
// applySignature
// =============================================================================

fn apply_signature(
    context: &mut Context,
    state: &mut InferenceState,
    signature: &[AliasingEffect],
    instr: &Instruction,
    env: &mut Environment,
    effects: &mut Vec<AliasingEffect>,
) -> Result<(), CompilerDiagnostic> {
    // For function instructions, validate frozen mutation
    match &instr.value {
        InstructionValue::FunctionExpression { lowered_func, .. }
        | InstructionValue::ObjectMethod { lowered_func, .. } => {
            let inner_func = &env.functions[lowered_func.func.0 as usize];
            if let Some(ref aliasing_effects) = inner_func.aliasing_effects {
                let mut context_ids: Option<HashSet<IdentifierId>> = None;
                for effect in aliasing_effects {
                    let (mutate_value, is_mutate) = match effect {
                        AliasingEffect::Mutate { value, .. } => (value, true),
                        AliasingEffect::MutateTransitive { value } => (value, false),
                        _ => continue,
                    };
                    let context_ids = context_ids.get_or_insert_with(|| {
                        inner_func.context.iter().map(|p| p.identifier).collect()
                    });
                    if !context_ids.contains(&mutate_value.identifier) {
                        continue;
                    }
                    if !state.is_defined(mutate_value.identifier) {
                        continue;
                    }
                    let value_abstract = state.kind(mutate_value.identifier);
                    if value_abstract.kind == ValueKind::Frozen {
                        let reason_str = get_write_error_reason(value_abstract);
                        let ident = &env.identifiers[mutate_value.identifier.0 as usize];
                        let variable = match &ident.name {
                            Some(crate::hir::IdentifierName::Named(n)) => {
                                format!("`{}`", bun_core::BStr::new(n.slice()))
                            }
                            _ => "value".to_string(),
                        };
                        let mut diagnostic = CompilerDiagnostic::new(
                            ErrorCategory::Immutability,
                            "This value cannot be modified",
                            Some(reason_str.to_string()),
                        );
                        diagnostic.details.push(
                            crate::diagnostics::CompilerDiagnosticDetail::Error {
                                loc: mutate_value.loc,
                                message: Some(format!("{} cannot be modified", variable)),
                                identifier_name: None,
                            },
                        );
                        if is_mutate {
                            if let AliasingEffect::Mutate {
                                reason: Some(MutationReason::AssignCurrentProperty),
                                ..
                            } = effect
                            {
                                diagnostic.details.push(crate::diagnostics::CompilerDiagnosticDetail::Hint {
                                    message: "Hint: If this value is a Ref (value returned by `useRef()`), rename the variable to end in \"Ref\".".to_string()
                                });
                            }
                        }
                        effects.push(AliasingEffect::MutateFrozen {
                            place: mutate_value.clone(),
                            error: Rc::new(diagnostic),
                        });
                    }
                }
            }
        }
        _ => {}
    }

    // Track which values we've already initialized
    let mut initialized = Initialized::new();

    for effect in signature {
        apply_effect(context, state, effect, &mut initialized, effects, env)?;
    }

    if !state.is_defined(instr.lvalue.identifier) {
        let reason = "Expected instruction lvalue to be initialized";
        return Err(crate::diagnostics::cold_invariant(reason, None, instr.loc).into());
    }

    Ok(())
}

// =============================================================================
// Transitive freeze helper
// =============================================================================

/// Recursively freeze through FunctionExpression captures. If `value_id`
/// corresponds to a FunctionExpression, freeze each of its context captures
/// and recurse into any that are themselves FunctionExpressions. This matches
/// the TS `freezeValue` → `freeze` → `freezeValue` recursion chain.
fn freeze_function_captures_transitive(
    state: &mut InferenceState,
    context: &Context,
    env: &Environment,
    value_id: ValueId,
    reason: ValueReason,
) {
    if let Some(func_id) = context.function_of(value_id) {
        if !env.has_stack() {
            return;
        }
        let ctx_ids: Vec<IdentifierId> = env.functions[func_id.0 as usize]
            .context
            .iter()
            .map(|p| p.identifier)
            .collect();
        for ctx_id in ctx_ids {
            // Replicate InferenceState::freeze() logic inline —
            // we need to recurse with context/env which freeze() doesn't have.
            if !state.is_defined(ctx_id) {
                continue;
            }
            let kind = state.kind(ctx_id).kind;
            match kind {
                ValueKind::Context | ValueKind::Mutable | ValueKind::MaybeFrozen => {
                    for vid in &state.values_for(ctx_id) {
                        state.freeze_value(*vid, reason);
                        // Recurse into nested function captures
                        freeze_function_captures_transitive(state, context, env, *vid, reason);
                    }
                }
                ValueKind::Frozen | ValueKind::Global | ValueKind::Primitive => {
                    // Already frozen or immutable — no-op
                }
            }
        }
    }
}

// =============================================================================
// applyEffect
// =============================================================================

/// What `apply_effect` does with an effect of which it is known that it changes no state and is kept
/// as it is: an `ImmutableCapture` of a frozen value, a `MaybeAlias` of one that is not.
#[inline]
fn keep_effect(context: &mut Context, effects: &mut Vec<AliasingEffect>, effect: AliasingEffect) {
    effects.push(context.intern_effect(effect));
}

fn apply_effect(
    context: &mut Context,
    state: &mut InferenceState,
    effect: &AliasingEffect,
    initialized: &mut Initialized,
    effects: &mut Vec<AliasingEffect>,
    env: &mut Environment,
) -> Result<(), CompilerDiagnostic> {
    let interned = context.interned_effect(effect);
    let effect = interned.as_deref().unwrap_or(effect);
    match effect {
        &AliasingEffect::Freeze { ref value, reason } => {
            let did_freeze = state.freeze(value.identifier, reason);
            if did_freeze {
                effects.extend_from_slice(std::slice::from_ref(effect));
                // Transitively freeze FunctionExpression captures if enabled
                // (matches TS freezeValue which recurses into func.context)
                let enable_transitive = env.config.enable_preserve_existing_memoization_guarantees
                    || env.config.enable_transitively_freeze_function_expressions;
                if enable_transitive {
                    // Recursively freeze through function captures. The TS
                    // freezeValue() calls freeze() on each capture, which
                    // calls freezeValue() again — creating a transitive
                    // closure through arbitrarily nested function captures.
                    for vid in &state.values_for(value.identifier) {
                        freeze_function_captures_transitive(state, context, env, *vid, reason);
                    }
                }
            }
        }
        &AliasingEffect::Create {
            ref into,
            value: kind,
            reason,
        } => {
            crate::diagnostics::invariant(
                !initialized.contains(&into.identifier),
                "[InferMutationAliasingEffects] Cannot re-initialize variable within an instruction",
            )?;
            initialized.push(into.identifier);
            let value_id = context.value_id_of_key(ValueKey::Create {
                into: into.identifier,
                kind: kind as u8,
                reason: reason as u8,
            });
            state.initialize(
                value_id,
                AbstractValue {
                    kind,
                    reason: hashset_of(reason),
                },
            );
            state.define(into.identifier, value_id);
            effects.extend_from_slice(std::slice::from_ref(effect));
        }
        AliasingEffect::ImmutableCapture { from, .. } => {
            let kind = state.kind(from.identifier).kind;
            match kind {
                ValueKind::Global | ValueKind::Primitive => {
                    // no-op: don't track data flow for copy types
                }
                _ => {
                    effects.extend_from_slice(std::slice::from_ref(effect));
                }
            }
        }
        AliasingEffect::CreateFrom { from, into } => {
            crate::diagnostics::invariant(
                !initialized.contains(&into.identifier),
                "[InferMutationAliasingEffects] Cannot re-initialize variable within an instruction",
            )?;
            initialized.push(into.identifier);
            let from_value = state.kind(from.identifier);
            let value_id = context.value_id_of_key(ValueKey::CreateFrom {
                from: from.identifier,
                into: into.identifier,
            });
            state.initialize(
                value_id,
                AbstractValue {
                    kind: from_value.kind,
                    reason: from_value.reason,
                },
            );
            state.define(into.identifier, value_id);
            match from_value.kind {
                ValueKind::Primitive | ValueKind::Global => {
                    let first_reason = primary_reason(from_value.reason);
                    effects.push(AliasingEffect::Create {
                        value: from_value.kind,
                        into: into.clone(),
                        reason: first_reason,
                    });
                }
                ValueKind::Frozen => {
                    let first_reason = primary_reason(from_value.reason);
                    effects.push(AliasingEffect::Create {
                        value: from_value.kind,
                        into: into.clone(),
                        reason: first_reason,
                    });
                    debug_assert!(matches!(
                        state.kind(from.identifier).kind,
                        ValueKind::Frozen | ValueKind::MaybeFrozen
                    ));
                    keep_effect(
                        context,
                        effects,
                        AliasingEffect::ImmutableCapture {
                            from: from.clone(),
                            into: into.clone(),
                        },
                    );
                }
                _ => {
                    effects.extend_from_slice(std::slice::from_ref(effect));
                }
            }
        }
        &AliasingEffect::CreateFunction {
            ref captures,
            function_id,
            ref into,
        } => {
            crate::diagnostics::invariant(
                !initialized.contains(&into.identifier),
                "[InferMutationAliasingEffects] Cannot re-initialize variable within an instruction",
            )?;
            initialized.push(into.identifier);
            effects.extend_from_slice(std::slice::from_ref(effect));

            // Check if function is mutable
            let has_captures = captures.iter().any(|capture| {
                if !state.is_defined(capture.identifier) {
                    return false;
                }
                let k = state.kind(capture.identifier).kind;
                k == ValueKind::Context || k == ValueKind::Mutable
            });

            let inner_func = &env.functions[function_id.0 as usize];
            let has_tracked_side_effects = inner_func
                .aliasing_effects
                .as_ref()
                .map(|effs| {
                    effs.iter().any(|e| {
                        matches!(
                            e,
                            AliasingEffect::MutateFrozen { .. }
                                | AliasingEffect::MutateGlobal { .. }
                                | AliasingEffect::Impure { .. }
                        )
                    })
                })
                .unwrap_or(false);

            let captures_ref = inner_func
                .context
                .iter()
                .any(|operand| is_ref_or_ref_value_for_id(env, operand.identifier));

            let is_mutable = has_captures || has_tracked_side_effects || captures_ref;

            // Update context variable effects
            for operand in &mut env.functions[function_id.0 as usize].context {
                if operand.effect != Effect::Capture {
                    continue;
                }
                if !state.is_defined(operand.identifier) {
                    continue;
                }
                let kind = state.kind(operand.identifier).kind;
                if kind == ValueKind::Primitive
                    || kind == ValueKind::Frozen
                    || kind == ValueKind::Global
                {
                    operand.effect = Effect::Read;
                }
            }

            let value_id = context.value_id_of_function(effect);
            // Track this value as a function expression so Apply can look it up
            let value_index = value_id.0 as usize;
            if context.function_values.len() <= value_index {
                context.function_values.resize(value_index + 1, None);
            }
            context.function_values[value_index] = Some(function_id);
            state.initialize(
                value_id,
                AbstractValue {
                    kind: if is_mutable {
                        ValueKind::Mutable
                    } else {
                        ValueKind::Frozen
                    },
                    reason: ValueReasonSet::empty(),
                },
            );
            state.define(into.identifier, value_id);

            for capture in captures {
                apply_effect(
                    context,
                    state,
                    &AliasingEffect::Capture {
                        from: capture.clone(),
                        into: into.clone(),
                    },
                    initialized,
                    effects,
                    env,
                )?;
            }
        }
        AliasingEffect::MaybeAlias { from, into }
        | AliasingEffect::Alias { from, into }
        | AliasingEffect::Capture { from, into } => {
            let is_capture = matches!(effect, AliasingEffect::Capture { .. });
            let is_maybe_alias = matches!(effect, AliasingEffect::MaybeAlias { .. });
            // For Alias, destination must already be initialized (Capture/MaybeAlias are exempt)
            crate::diagnostics::invariant(
                is_capture || is_maybe_alias || initialized.contains(&into.identifier),
                "[InferMutationAliasingEffects] Expected destination to already be initialized within this instruction",
            )?;

            // Check destination kind
            let into_kind = state.kind_with_loc(into.identifier, into.loc).kind;
            let destination_type = DataFlowType::of_destination(into_kind);

            let from_kind = state.kind_with_loc(from.identifier, from.loc).kind;
            let source_type = DataFlowType::of_source(from_kind);

            if source_type == Some(DataFlowType::Frozen) {
                debug_assert!(matches!(
                    state.kind(from.identifier).kind,
                    ValueKind::Frozen | ValueKind::MaybeFrozen
                ));
                keep_effect(
                    context,
                    effects,
                    AliasingEffect::ImmutableCapture {
                        from: from.clone(),
                        into: into.clone(),
                    },
                );
            } else if (source_type == Some(DataFlowType::Mutable)
                && destination_type == Some(DataFlowType::Mutable))
                || is_maybe_alias
            {
                effects.extend_from_slice(std::slice::from_ref(effect));
            } else if (source_type == Some(DataFlowType::Context) && destination_type.is_some())
                || (source_type == Some(DataFlowType::Mutable)
                    && destination_type == Some(DataFlowType::Context))
            {
                keep_effect(
                    context,
                    effects,
                    AliasingEffect::MaybeAlias {
                        from: from.clone(),
                        into: into.clone(),
                    },
                );
            }
        }
        AliasingEffect::Assign { from, into } => {
            crate::diagnostics::invariant(
                !initialized.contains(&into.identifier),
                "[InferMutationAliasingEffects] Cannot re-initialize variable within an instruction",
            )?;
            initialized.push(into.identifier);
            let from_value = state.kind_with_loc(from.identifier, from.loc);
            match from_value.kind {
                ValueKind::Frozen => {
                    debug_assert!(matches!(
                        state.kind(from.identifier).kind,
                        ValueKind::Frozen | ValueKind::MaybeFrozen
                    ));
                    keep_effect(
                        context,
                        effects,
                        AliasingEffect::ImmutableCapture {
                            from: from.clone(),
                            into: into.clone(),
                        },
                    );
                    let value_id = context.value_id_of_key(ValueKey::AssignFrozen {
                        from: from.identifier,
                        into: into.identifier,
                    });
                    state.initialize(
                        value_id,
                        AbstractValue {
                            kind: from_value.kind,
                            reason: from_value.reason,
                        },
                    );
                    state.define(into.identifier, value_id);
                }
                ValueKind::Global | ValueKind::Primitive => {
                    let value_id = context.value_id_of_key(ValueKey::AssignCopied {
                        from: from.identifier,
                        into: into.identifier,
                    });
                    state.initialize(
                        value_id,
                        AbstractValue {
                            kind: from_value.kind,
                            reason: from_value.reason,
                        },
                    );
                    state.define(into.identifier, value_id);
                }
                _ => {
                    state.assign(into.identifier, from.identifier, context);
                    effects.extend_from_slice(std::slice::from_ref(effect));
                }
            }
        }
        AliasingEffect::Apply(apply) => {
            let ApplyEffect {
                receiver,
                function,
                mutates_function,
                args,
                into,
                signature,
                loc,
            } = &**apply;
            // The one kind whose effects can be of its own kind: each cycle of calls comes through here.
            if !env.has_stack() {
                return Err(crate::lowering::nested_too_deeply());
            }
            // First, check if the callee is a locally-declared function expression
            // whose aliasing effects we already know (TS lines 1016-1068)
            if let Some(value_id) = state.set_of(function.identifier).as_singleton()
                && let Some(func_id) = context.function_of(value_id)
                && env.functions[func_id.0 as usize].aliasing_effects.is_some()
            {
                // Build or retrieve the signature from the function expression
                if !context.function_signature_cache.contains_key(&func_id) {
                    let sig = build_signature_from_function_expression(env, func_id);
                    context
                        .function_signature_cache
                        .insert(func_id, Rc::new(sig));
                }
                let sig = Rc::clone(&context.function_signature_cache[&func_id]);
                let inner_func = &env.functions[func_id.0 as usize];
                let context_places = inner_func.context.clone();
                let sig_effects = compute_effects_for_aliasing_signature(
                    env,
                    &sig,
                    into,
                    receiver,
                    args,
                    &context_places,
                    loc.as_ref(),
                )?;
                if let Some(sig_effs) = sig_effects {
                    // Conditionally mutate the function itself first
                    apply_effect(
                        context,
                        state,
                        &AliasingEffect::MutateTransitiveConditionally {
                            value: function.clone(),
                        },
                        initialized,
                        effects,
                        env,
                    )?;
                    for se in sig_effs {
                        apply_effect(context, state, &se, initialized, effects, env)?;
                    }
                    return Ok(());
                }
            }
            if let Some(sig) = signature {
                // Check known_incompatible (TS line 2351-2370)
                if let Some(incompatible_msg) = sig.known_incompatible {
                    if env.enable_validations() {
                        let mut diagnostic = CompilerDiagnostic::new(
                            ErrorCategory::IncompatibleLibrary,
                            "Use of incompatible library",
                            Some(
                                "This API returns functions which cannot be memoized without leading to stale UI. \
                                 To prevent this, by default React Compiler will skip memoizing this component/hook. \
                                 However, you may see issues if values from this API are passed to other components/hooks that are \
                                 memoized".to_string(),
                            ),
                        );
                        diagnostic.details.push(CompilerDiagnosticDetail::Error {
                            loc: receiver.loc,
                            message: Some(incompatible_msg.to_string()),
                            identifier_name: None,
                        });
                        // TS throws here, aborting compilation for this function
                        return Err(diagnostic);
                    }
                }

                if let Some(ref aliasing) = sig.aliasing {
                    let sig_effects = compute_effects_for_aliasing_signature_config(
                        env,
                        aliasing,
                        into,
                        receiver,
                        args,
                        &[],
                        loc.as_ref(),
                        &mut context.aliasing_config_temp_cache,
                    )?;
                    if let Some(sig_effs) = sig_effects {
                        for se in sig_effs {
                            apply_effect(context, state, &se, initialized, effects, env)?;
                        }
                        return Ok(());
                    }
                }

                // Legacy signature
                let mut todo_errors: Vec<crate::diagnostics::CompilerErrorDetail> = Vec::new();
                let legacy_effects = compute_effects_for_legacy_signature(
                    state,
                    sig,
                    into,
                    receiver,
                    args,
                    loc.as_ref(),
                    env,
                    &context.function_values,
                    &mut todo_errors,
                );
                // Todo errors should short-circuit (TS throws throwTodo)
                if let Some(err_detail) = todo_errors.into_iter().next() {
                    return Err(CompilerDiagnostic::from_detail(err_detail));
                }
                for le in legacy_effects {
                    apply_effect(context, state, &le, initialized, effects, env)?;
                }
            } else {
                // No signature: default behavior
                apply_effect(
                    context,
                    state,
                    &AliasingEffect::Create {
                        into: into.clone(),
                        value: ValueKind::Mutable,
                        reason: ValueReason::Other,
                    },
                    initialized,
                    effects,
                    env,
                )?;

                let all_operands = build_apply_operands(receiver, function, args);
                // None of the effects below changes the state. An effect that is interned is
                // applied even if nothing comes of it: it is the one that later ones are replaced by.
                let kinds: Option<SmallVec<[ValueKind; 8]>> =
                    context.interned_effects.is_none().then(|| {
                        let kind_of = |&(operand, _): &(&Place, bool)| {
                            state.kind_with_loc(operand.identifier, operand.loc).kind
                        };
                        all_operands.iter().map(kind_of).collect()
                    });
                for (at, &(operand, is_spread)) in all_operands.iter().enumerate() {
                    // In TS, the check is `operand !== effect.function || effect.mutatesFunction`.
                    // This compares by reference identity, so for CallExpression/NewExpression
                    // where receiver === function, BOTH are skipped when !mutatesFunction.
                    if operand.identifier == function.identifier && !*mutates_function {
                        // Don't mutate callee for non-mutating calls
                    } else {
                        apply_effect(
                            context,
                            state,
                            &AliasingEffect::MutateTransitiveConditionally {
                                value: operand.clone(),
                            },
                            initialized,
                            effects,
                            env,
                        )?;
                    }

                    if is_spread {
                        let ty = &env.types
                            [env.identifiers[operand.identifier.0 as usize].type_.0 as usize];
                        if let Some(mutate_iter) = conditionally_mutate_iterator(operand, ty) {
                            apply_effect(context, state, &mutate_iter, initialized, effects, env)?;
                        }
                    }

                    apply_effect(
                        context,
                        state,
                        &AliasingEffect::MaybeAlias {
                            from: operand.clone(),
                            into: into.clone(),
                        },
                        initialized,
                        effects,
                        env,
                    )?;

                    // In TS, `other === arg` compares the Place extracted from
                    // `otherArg` with the original `arg` element. For Identifier
                    // args, the extracted Place IS the arg, so this is a reference
                    // identity check. For Spread args, the extracted Place is
                    // `.place` which is never `===` the Spread wrapper object,
                    // so NO pairs are skipped when the outer arg is a Spread
                    // (including self-pairs, producing self-captures).
                    for (other_at, &(other, _)) in all_operands.iter().enumerate() {
                        if !is_spread && other.identifier == operand.identifier {
                            continue;
                        }
                        let is_tracked = kinds.as_ref().is_none_or(|kinds| {
                            match DataFlowType::of_source(kinds[at]) {
                                None => false,
                                Some(DataFlowType::Frozen) => true,
                                Some(_) => DataFlowType::of_destination(kinds[other_at]).is_some(),
                            }
                        });
                        if !is_tracked && !cfg!(debug_assertions) {
                            continue;
                        }
                        let effects_before = effects.len();
                        apply_effect(
                            context,
                            state,
                            &AliasingEffect::Capture {
                                from: operand.clone(),
                                into: other.clone(),
                            },
                            initialized,
                            effects,
                            env,
                        )?;
                        debug_assert!(is_tracked || effects.len() == effects_before);
                    }
                }
            }
        }
        eff @ (AliasingEffect::Mutate { .. }
        | AliasingEffect::MutateConditionally { .. }
        | AliasingEffect::MutateTransitive { .. }
        | AliasingEffect::MutateTransitiveConditionally { .. }) => {
            let (mutate_place, variant) = match eff {
                AliasingEffect::Mutate { value, .. } => (value, MutateVariant::Mutate),
                AliasingEffect::MutateConditionally { value } => {
                    (value, MutateVariant::MutateConditionally)
                }
                AliasingEffect::MutateTransitive { value } => {
                    (value, MutateVariant::MutateTransitive)
                }
                AliasingEffect::MutateTransitiveConditionally { value } => {
                    (value, MutateVariant::MutateTransitiveConditionally)
                }
                _ => unreachable!(),
            };
            let value = mutate_place;
            let mutation_kind = state.mutate_with_loc(variant, value.identifier, env, value.loc);
            if mutation_kind == MutationResult::Mutate {
                effects.extend_from_slice(std::slice::from_ref(effect));
            } else if mutation_kind == MutationResult::MutateRef {
                // no-op
            } else if mutation_kind != MutationResult::None
                && matches!(
                    variant,
                    MutateVariant::Mutate | MutateVariant::MutateTransitive
                )
            {
                let abstract_value = state.kind(value.identifier);

                let ident = &env.identifiers[value.identifier.0 as usize];
                let decl_id = ident.declaration_id;

                if mutation_kind == MutationResult::MutateFrozen
                    && context.hoisted_context_declarations.contains_key(&decl_id)
                {
                    let variable = match &ident.name {
                        Some(crate::hir::IdentifierName::Named(n)) => {
                            Some(format!("`{}`", bun_core::BStr::new(n.slice())))
                        }
                        _ => None,
                    };
                    let hoisted_access = context
                        .hoisted_context_declarations
                        .get(&decl_id)
                        .cloned()
                        .flatten();
                    let mut diagnostic = CompilerDiagnostic::new(
                        ErrorCategory::Immutability,
                        "Cannot access variable before it is declared",
                        Some(format!(
                            "{} is accessed before it is declared, which prevents the earlier access from updating when this value changes over time",
                            variable.as_deref().unwrap_or("This variable")
                        )),
                    );
                    if let Some(ref access) = hoisted_access {
                        if access.loc != value.loc {
                            diagnostic.details.push(
                                crate::diagnostics::CompilerDiagnosticDetail::Error {
                                    loc: access.loc,
                                    message: Some(format!(
                                        "{} accessed before it is declared",
                                        variable.as_deref().unwrap_or("variable")
                                    )),
                                    identifier_name: None,
                                },
                            );
                        }
                    }
                    diagnostic
                        .details
                        .push(crate::diagnostics::CompilerDiagnosticDetail::Error {
                            loc: value.loc,
                            message: Some(format!(
                                "{} is declared here",
                                variable.as_deref().unwrap_or("variable")
                            )),
                            identifier_name: None,
                        });
                    apply_effect(
                        context,
                        state,
                        &AliasingEffect::MutateFrozen {
                            place: value.clone(),
                            error: Rc::new(diagnostic),
                        },
                        initialized,
                        effects,
                        env,
                    )?;
                } else {
                    let reason_str = get_write_error_reason(abstract_value);
                    let variable = match &ident.name {
                        Some(crate::hir::IdentifierName::Named(n)) => {
                            format!("`{}`", bun_core::BStr::new(n.slice()))
                        }
                        _ => "value".to_string(),
                    };
                    let mut diagnostic = CompilerDiagnostic::new(
                        ErrorCategory::Immutability,
                        "This value cannot be modified",
                        Some(reason_str.to_string()),
                    );
                    diagnostic
                        .details
                        .push(crate::diagnostics::CompilerDiagnosticDetail::Error {
                            loc: value.loc,
                            message: Some(format!("{} cannot be modified", variable)),
                            identifier_name: None,
                        });

                    if let AliasingEffect::Mutate {
                        reason: Some(MutationReason::AssignCurrentProperty),
                        ..
                    } = effect
                    {
                        diagnostic.details.push(crate::diagnostics::CompilerDiagnosticDetail::Hint {
                            message: "Hint: If this value is a Ref (value returned by `useRef()`), rename the variable to end in \"Ref\".".to_string(),
                        });
                    }

                    let error_kind = if abstract_value.kind == ValueKind::Frozen {
                        AliasingEffect::MutateFrozen {
                            place: value.clone(),
                            error: Rc::new(diagnostic),
                        }
                    } else {
                        AliasingEffect::MutateGlobal {
                            place: value.clone(),
                            error: Rc::new(diagnostic),
                        }
                    };
                    apply_effect(context, state, &error_kind, initialized, effects, env)?;
                }
            }
        }
        AliasingEffect::Impure { .. }
        | AliasingEffect::Render { .. }
        | AliasingEffect::MutateFrozen { .. }
        | AliasingEffect::MutateGlobal { .. } => {
            effects.extend_from_slice(std::slice::from_ref(effect));
        }
    }
    Ok(())
}

// =============================================================================
// computeSignatureForInstruction
// =============================================================================

fn compute_signature_for_instruction(
    context: &Context,
    env: &Environment,
    instr: &Instruction,
    effects: &mut Vec<AliasingEffect>,
) {
    let lvalue = &instr.lvalue;
    let value = &instr.value;

    match value {
        InstructionValue::ArrayExpression { elements, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            for element in elements {
                match element {
                    crate::hir::ArrayElement::Place(p) => {
                        effects.push(AliasingEffect::Capture {
                            from: p.clone(),
                            into: lvalue.clone(),
                        });
                    }
                    crate::hir::ArrayElement::Spread(s) => {
                        let ty = &env.types
                            [env.identifiers[s.place.identifier.0 as usize].type_.0 as usize];
                        if let Some(mutate_iter) = conditionally_mutate_iterator(&s.place, ty) {
                            effects.push(mutate_iter);
                        }
                        effects.push(AliasingEffect::Capture {
                            from: s.place.clone(),
                            into: lvalue.clone(),
                        });
                    }
                    crate::hir::ArrayElement::Hole => {}
                }
            }
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            for property in properties {
                match property {
                    crate::hir::ObjectPropertyOrSpread::Property(p) => {
                        effects.push(AliasingEffect::Capture {
                            from: p.place.clone(),
                            into: lvalue.clone(),
                        });
                    }
                    crate::hir::ObjectPropertyOrSpread::Spread(s) => {
                        effects.push(AliasingEffect::Capture {
                            from: s.place.clone(),
                            into: lvalue.clone(),
                        });
                    }
                }
            }
        }
        InstructionValue::Await {
            value: await_value, ..
        } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::MutateTransitiveConditionally {
                value: await_value.clone(),
            });
            effects.push(AliasingEffect::Capture {
                from: await_value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::NewExpression { callee, args, loc } => {
            let sig = get_function_call_signature(env, callee.identifier)
                .ok()
                .flatten();
            effects.push(AliasingEffect::Apply(Rc::new(ApplyEffect {
                receiver: callee.clone(),
                function: callee.clone(),
                mutates_function: false,
                args: AstAlloc::vec_from_iter(args.iter().map(place_or_spread_to_hole)),
                into: lvalue.clone(),
                signature: sig,
                loc: *loc,
            })));
        }
        InstructionValue::CallExpression { callee, args, loc } => {
            let sig = get_function_call_signature(env, callee.identifier)
                .ok()
                .flatten();
            effects.push(AliasingEffect::Apply(Rc::new(ApplyEffect {
                receiver: callee.clone(),
                function: callee.clone(),
                mutates_function: true,
                args: AstAlloc::vec_from_iter(args.iter().map(place_or_spread_to_hole)),
                into: lvalue.clone(),
                signature: sig,
                loc: *loc,
            })));
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            loc,
        } => {
            let sig = get_function_call_signature(env, property.identifier)
                .ok()
                .flatten();
            effects.push(AliasingEffect::Apply(Rc::new(ApplyEffect {
                receiver: receiver.clone(),
                function: property.clone(),
                mutates_function: false,
                args: AstAlloc::vec_from_iter(args.iter().map(place_or_spread_to_hole)),
                into: lvalue.clone(),
                signature: sig,
                loc: *loc,
            })));
        }
        InstructionValue::PropertyDelete { object, .. }
        | InstructionValue::ComputedDelete { object, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::Mutate {
                value: object.clone(),
                reason: None,
            });
        }
        InstructionValue::PropertyLoad { object, .. }
        | InstructionValue::ComputedLoad { object, .. } => {
            let ty = &env.types[env.identifiers[lvalue.identifier.0 as usize].type_.0 as usize];
            if crate::hir::is_primitive_type(ty) {
                effects.push(AliasingEffect::Create {
                    into: lvalue.clone(),
                    value: ValueKind::Primitive,
                    reason: ValueReason::Other,
                });
            } else {
                effects.push(AliasingEffect::CreateFrom {
                    from: object.clone(),
                    into: lvalue.clone(),
                });
            }
        }
        InstructionValue::PropertyStore {
            object,
            property,
            value: store_value,
            ..
        } => {
            let mutation_reason: Option<MutationReason> = {
                let obj_ty =
                    &env.types[env.identifiers[object.identifier.0 as usize].type_.0 as usize];
                if let crate::hir::PropertyLiteral::String(prop_name) = property {
                    if prop_name.slice() == b"current" && matches!(obj_ty, Type::TypeVar { .. }) {
                        Some(MutationReason::AssignCurrentProperty)
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            effects.push(AliasingEffect::Mutate {
                value: object.clone(),
                reason: mutation_reason,
            });
            effects.push(AliasingEffect::Capture {
                from: store_value.clone(),
                into: object.clone(),
            });
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::ComputedStore {
            object,
            value: store_value,
            ..
        } => {
            effects.push(AliasingEffect::Mutate {
                value: object.clone(),
                reason: None,
            });
            effects.push(AliasingEffect::Capture {
                from: store_value.clone(),
                into: object.clone(),
            });
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::FunctionExpression { lowered_func, .. }
        | InstructionValue::ObjectMethod { lowered_func, .. } => {
            let inner_func = &env.functions[lowered_func.func.0 as usize];
            let captures = AstAlloc::vec_from_iter(
                inner_func
                    .context
                    .iter()
                    .filter(|operand| operand.effect == Effect::Capture)
                    .cloned(),
            );
            effects.push(AliasingEffect::CreateFunction {
                into: lvalue.clone(),
                function_id: lowered_func.func,
                captures,
            });
        }
        InstructionValue::GetIterator { collection, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Mutable,
                reason: ValueReason::Other,
            });
            let ty = &env.types[env.identifiers[collection.identifier.0 as usize].type_.0 as usize];
            if is_builtin_collection_type(ty) {
                effects.push(AliasingEffect::Capture {
                    from: collection.clone(),
                    into: lvalue.clone(),
                });
            } else {
                effects.push(AliasingEffect::Alias {
                    from: collection.clone(),
                    into: lvalue.clone(),
                });
                effects.push(AliasingEffect::MutateTransitiveConditionally {
                    value: collection.clone(),
                });
            }
        }
        InstructionValue::IteratorNext {
            iterator,
            collection,
            ..
        } => {
            effects.push(AliasingEffect::MutateConditionally {
                value: iterator.clone(),
            });
            effects.push(AliasingEffect::CreateFrom {
                from: collection.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::NextPropertyOf { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::JsxExpression {
            tag,
            props,
            children,
            ..
        } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Frozen,
                reason: ValueReason::JsxCaptured,
            });
            for operand in visitors::operands(value, &env.functions) {
                effects.push(AliasingEffect::Freeze {
                    value: operand.clone(),
                    reason: ValueReason::JsxCaptured,
                });
                effects.push(AliasingEffect::Capture {
                    from: operand.clone(),
                    into: lvalue.clone(),
                });
            }
            if let JsxTag::Place(tag_place) = tag {
                effects.push(AliasingEffect::Render {
                    place: tag_place.clone(),
                });
            }
            if let Some(ch) = children {
                for child in ch {
                    effects.push(AliasingEffect::Render {
                        place: child.clone(),
                    });
                }
            }
            for prop in props {
                if let crate::hir::JsxAttribute::Attribute {
                    place: prop_place, ..
                } = prop
                {
                    let prop_ty = &env.types
                        [env.identifiers[prop_place.identifier.0 as usize].type_.0 as usize];
                    if let Type::Function { return_type, .. } = prop_ty {
                        if crate::hir::is_jsx_type(return_type) || is_phi_with_jsx(return_type) {
                            effects.push(AliasingEffect::Render {
                                place: prop_place.clone(),
                            });
                        }
                    }
                }
            }
        }
        InstructionValue::JsxFragment { children: _, .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Frozen,
                reason: ValueReason::JsxCaptured,
            });
            for operand in visitors::operands(value, &env.functions) {
                effects.push(AliasingEffect::Freeze {
                    value: operand.clone(),
                    reason: ValueReason::JsxCaptured,
                });
                effects.push(AliasingEffect::Capture {
                    from: operand.clone(),
                    into: lvalue.clone(),
                });
            }
        }
        InstructionValue::DeclareLocal { lvalue: dl, .. } => {
            effects.push(AliasingEffect::Create {
                into: dl.place.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::Destructure {
            lvalue: dl,
            value: dest_value,
            ..
        } => {
            for pat_item in each_pattern_items(&dl.pattern) {
                match pat_item {
                    PatternItem::Place(place) => {
                        let ty = &env.types
                            [env.identifiers[place.identifier.0 as usize].type_.0 as usize];
                        if crate::hir::is_primitive_type(ty) {
                            effects.push(AliasingEffect::Create {
                                into: place.clone(),
                                value: ValueKind::Primitive,
                                reason: ValueReason::Other,
                            });
                        } else {
                            effects.push(AliasingEffect::CreateFrom {
                                from: dest_value.clone(),
                                into: place.clone(),
                            });
                        }
                    }
                    PatternItem::Spread(place) => {
                        let value_kind = if context.non_mutating_spreads.contains(&place.identifier)
                        {
                            ValueKind::Frozen
                        } else {
                            ValueKind::Mutable
                        };
                        effects.push(AliasingEffect::Create {
                            into: place.clone(),
                            reason: ValueReason::Other,
                            value: value_kind,
                        });
                        effects.push(AliasingEffect::Capture {
                            from: dest_value.clone(),
                            into: place.clone(),
                        });
                    }
                }
            }
            effects.push(AliasingEffect::Assign {
                from: dest_value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::LoadContext { place, .. } => {
            effects.push(AliasingEffect::CreateFrom {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::DeclareContext { lvalue: dcl, .. } => {
            let decl_id = env.identifiers[dcl.place.identifier.0 as usize].declaration_id;
            let kind = dcl.kind;
            if !context.hoisted_context_declarations.contains_key(&decl_id)
                || kind == InstructionKind::HoistedConst
                || kind == InstructionKind::HoistedFunction
                || kind == InstructionKind::HoistedLet
            {
                effects.push(AliasingEffect::Create {
                    into: dcl.place.clone(),
                    value: ValueKind::Mutable,
                    reason: ValueReason::Other,
                });
            } else {
                effects.push(AliasingEffect::Mutate {
                    value: dcl.place.clone(),
                    reason: None,
                });
            }
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::StoreContext {
            lvalue: scl,
            value: sc_value,
            ..
        } => {
            let decl_id = env.identifiers[scl.place.identifier.0 as usize].declaration_id;
            if scl.kind == InstructionKind::Reassign
                || context.hoisted_context_declarations.contains_key(&decl_id)
            {
                effects.push(AliasingEffect::Mutate {
                    value: scl.place.clone(),
                    reason: None,
                });
            } else {
                effects.push(AliasingEffect::Create {
                    into: scl.place.clone(),
                    value: ValueKind::Mutable,
                    reason: ValueReason::Other,
                });
            }
            effects.push(AliasingEffect::Capture {
                from: sc_value.clone(),
                into: scl.place.clone(),
            });
            effects.push(AliasingEffect::Assign {
                from: sc_value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::LoadLocal { place, .. } => {
            effects.push(AliasingEffect::Assign {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::StoreLocal {
            lvalue: sl,
            value: sl_value,
            ..
        } => {
            effects.push(AliasingEffect::Assign {
                from: sl_value.clone(),
                into: sl.place.clone(),
            });
            effects.push(AliasingEffect::Assign {
                from: sl_value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::PostfixUpdate {
            lvalue: pf_lvalue, ..
        }
        | InstructionValue::PrefixUpdate {
            lvalue: pf_lvalue, ..
        } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
            effects.push(AliasingEffect::Create {
                into: pf_lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        InstructionValue::StoreGlobal {
            name,
            value: sg_value,
            loc: _,
            ..
        } => {
            let variable = format!("`{}`", bun_core::BStr::new(name.slice()));
            let mut diagnostic = CompilerDiagnostic::new(
                ErrorCategory::Globals,
                "Cannot reassign variables declared outside of the component/hook",
                Some(format!(
                    "Variable {} is declared outside of the component/hook. Reassigning this value during render is a form of side effect, which can cause unpredictable behavior depending on when the component happens to re-render. If this variable is used in rendering, use useState instead. Otherwise, consider updating it in an effect. (https://react.dev/reference/rules/components-and-hooks-must-be-pure#side-effects-must-run-outside-of-render)",
                    variable
                )),
            );
            diagnostic
                .details
                .push(crate::diagnostics::CompilerDiagnosticDetail::Error {
                    loc: instr.loc,
                    message: Some(format!("{} cannot be reassigned", variable)),
                    identifier_name: None,
                });
            effects.push(AliasingEffect::MutateGlobal {
                place: sg_value.clone(),
                error: Rc::new(diagnostic),
            });
            effects.push(AliasingEffect::Assign {
                from: sg_value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::TypeCastExpression {
            value: tc_value, ..
        } => {
            effects.push(AliasingEffect::Assign {
                from: tc_value.clone(),
                into: lvalue.clone(),
            });
        }
        InstructionValue::LoadGlobal { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Global,
                reason: ValueReason::Global,
            });
        }
        InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => {
            if env.config.enable_preserve_existing_memoization_guarantees {
                for operand in visitors::operands(value, &env.functions) {
                    effects.push(AliasingEffect::Freeze {
                        value: operand.clone(),
                        reason: ValueReason::HookCaptured,
                    });
                }
            }
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
        // All primitive-creating instructions
        InstructionValue::TaggedTemplateExpression { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::JSXText { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::UnaryExpression { .. }
        | InstructionValue::UnsupportedNode { .. } => {
            effects.push(AliasingEffect::Create {
                into: lvalue.clone(),
                value: ValueKind::Primitive,
                reason: ValueReason::Other,
            });
        }
    }
}

// =============================================================================
// Legacy signature support
// =============================================================================

fn compute_effects_for_legacy_signature(
    state: &InferenceState,
    signature: &FunctionSignature,
    lvalue: &Place,
    receiver: &Place,
    args: &[PlaceOrSpreadOrHole],
    _loc: Option<&SourceLocation>,
    env: &Environment,
    function_values: &[Option<FunctionId>],
    todo_errors: &mut Vec<crate::diagnostics::CompilerErrorDetail>,
) -> Vec<AliasingEffect> {
    let return_value_reason = signature.return_value_reason.unwrap_or(ValueReason::Other);
    let mut effects: Vec<AliasingEffect> = Vec::new();

    effects.push(AliasingEffect::Create {
        into: lvalue.clone(),
        value: signature.return_value_kind,
        reason: return_value_reason,
    });

    if signature.impure && env.config.validate_no_impure_functions_in_render {
        let mut diagnostic = CompilerDiagnostic::new(
            ErrorCategory::Purity,
            "Cannot call impure function during render",
            Some(format!(
                "{}Calling an impure function can produce unstable results that update unpredictably when the component happens to re-render. (https://react.dev/reference/rules/components-and-hooks-must-be-pure#components-and-hooks-must-be-idempotent)",
                if let Some(ref name) = signature.canonical_name {
                    format!("`{}` is an impure function. ", name)
                } else {
                    String::new()
                }
            )),
        );
        diagnostic
            .details
            .push(crate::diagnostics::CompilerDiagnosticDetail::Error {
                loc: _loc.copied(),
                message: Some("Cannot call impure function".to_string()),
                identifier_name: None,
            });
        effects.push(AliasingEffect::Impure {
            place: receiver.clone(),
            error: Rc::new(diagnostic),
        });
    }

    // TODO: check signature.known_incompatible and throw (TS line 2351-2370)
    // This requires threading Result through apply_effect/apply_signature.

    // If the function is mutable only if operands are mutable, and all
    // arguments are immutable/non-mutating, short-circuit with simple aliasing.
    if signature.mutable_only_if_operands_are_mutable
        && are_arguments_immutable_and_non_mutating(state, args, env, function_values)
    {
        effects.push(AliasingEffect::Alias {
            from: receiver.clone(),
            into: lvalue.clone(),
        });
        for arg in args {
            match arg {
                PlaceOrSpreadOrHole::Hole => continue,
                PlaceOrSpreadOrHole::Place(place)
                | PlaceOrSpreadOrHole::Spread(crate::hir::SpreadPattern { place }) => {
                    effects.push(AliasingEffect::ImmutableCapture {
                        from: place.clone(),
                        into: lvalue.clone(),
                    });
                }
            }
        }
        return effects;
    }

    let mut stores: Vec<Place> = Vec::new();
    let mut captures: Vec<Place> = Vec::new();

    let mut visit = |place: &Place, effect: Effect, effects: &mut Vec<AliasingEffect>| match effect
    {
        Effect::Store => {
            effects.push(AliasingEffect::Mutate {
                value: place.clone(),
                reason: None,
            });
            stores.push(place.clone());
        }
        Effect::Capture => {
            captures.push(place.clone());
        }
        Effect::ConditionallyMutate => {
            effects.push(AliasingEffect::MutateTransitiveConditionally {
                value: place.clone(),
            });
        }
        Effect::ConditionallyMutateIterator => {
            let ty = &env.types[env.identifiers[place.identifier.0 as usize].type_.0 as usize];
            if let Some(mutate_iter) = conditionally_mutate_iterator(place, ty) {
                effects.push(mutate_iter);
            }
            effects.push(AliasingEffect::Capture {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        Effect::Freeze => {
            effects.push(AliasingEffect::Freeze {
                value: place.clone(),
                reason: return_value_reason,
            });
        }
        Effect::Mutate => {
            effects.push(AliasingEffect::MutateTransitive {
                value: place.clone(),
            });
        }
        Effect::Read => {
            effects.push(AliasingEffect::ImmutableCapture {
                from: place.clone(),
                into: lvalue.clone(),
            });
        }
        _ => {}
    };

    if signature.callee_effect != Effect::Capture {
        effects.push(AliasingEffect::Alias {
            from: receiver.clone(),
            into: lvalue.clone(),
        });
    }

    visit(receiver, signature.callee_effect, &mut effects);
    for (i, arg) in args.iter().enumerate() {
        match arg {
            PlaceOrSpreadOrHole::Hole => continue,
            PlaceOrSpreadOrHole::Place(place)
            | PlaceOrSpreadOrHole::Spread(crate::hir::SpreadPattern { place }) => {
                let is_spread = matches!(arg, PlaceOrSpreadOrHole::Spread(_));
                let sig_effect = if !is_spread && i < signature.positional_params.len() {
                    signature.positional_params[i]
                } else {
                    signature.rest_param.unwrap_or(Effect::ConditionallyMutate)
                };
                let (effect, err_detail) = get_argument_effect(sig_effect, is_spread, place.loc);
                if let Some(d) = err_detail {
                    todo_errors.push(d);
                }
                visit(place, effect, &mut effects);
            }
        }
    }

    if !captures.is_empty() {
        if stores.is_empty() {
            for capture in &captures {
                effects.push(AliasingEffect::Alias {
                    from: capture.clone(),
                    into: lvalue.clone(),
                });
            }
        } else {
            for capture in &captures {
                for store in &stores {
                    effects.push(AliasingEffect::Capture {
                        from: capture.clone(),
                        into: store.clone(),
                    });
                }
            }
        }
    }

    effects
}

fn get_argument_effect(
    sig_effect: Effect,
    is_spread: bool,
    spread_loc: Option<SourceLocation>,
) -> (Effect, Option<crate::diagnostics::CompilerErrorDetail>) {
    if !is_spread {
        (sig_effect, None)
    } else if sig_effect == Effect::Mutate || sig_effect == Effect::ConditionallyMutate {
        (sig_effect, None)
    } else {
        // Spread with Freeze effect is unsupported for hook arguments
        // (matches TS CompilerError.throwTodo)
        let detail = if sig_effect == Effect::Freeze {
            Some(crate::diagnostics::CompilerErrorDetail {
                reason: "Support spread syntax for hook arguments".to_string(),
                description: None,
                category: ErrorCategory::Todo,
                loc: spread_loc,
                suggestions: None,
            })
        } else {
            None
        };
        (Effect::ConditionallyMutateIterator, detail)
    }
}

/// Returns true if all of the arguments are both non-mutable (immutable or frozen)
/// _and_ are not functions which might mutate their arguments.
///
/// Corresponds to TS `areArgumentsImmutableAndNonMutating`.
fn are_arguments_immutable_and_non_mutating(
    state: &InferenceState,
    args: &[PlaceOrSpreadOrHole],
    env: &Environment,
    function_values: &[Option<FunctionId>],
) -> bool {
    for arg in args {
        match arg {
            PlaceOrSpreadOrHole::Hole => continue,
            PlaceOrSpreadOrHole::Place(place)
            | PlaceOrSpreadOrHole::Spread(crate::hir::SpreadPattern { place }) => {
                // Check if it's a function type with a known signature
                let is_place = matches!(arg, PlaceOrSpreadOrHole::Place(_));
                if is_place {
                    let ty =
                        &env.types[env.identifiers[place.identifier.0 as usize].type_.0 as usize];
                    if let Type::Function { .. } = ty {
                        let fn_shape = env.get_function_signature(ty).ok().flatten();
                        if let Some(fn_sig) = fn_shape {
                            let has_mutable_param = fn_sig
                                .positional_params
                                .iter()
                                .any(|e| is_known_mutable_effect(*e));
                            let has_mutable_rest = fn_sig
                                .rest_param
                                .map_or(false, |e| is_known_mutable_effect(e));
                            return !has_mutable_param && !has_mutable_rest;
                        }
                    }
                }

                let kind = state.kind(place.identifier);
                match kind.kind {
                    ValueKind::Primitive | ValueKind::Frozen => {
                        // Immutable values are ok, continue checking
                    }
                    _ => {
                        return false;
                    }
                }

                // Check if any value for this place is a function expression
                // that mutates its parameters (TS lines 2545-2557)
                let value_ids = state.values_for(place.identifier);
                for vid in &value_ids {
                    if let Some(func_id) = function_of(function_values, *vid) {
                        let inner_func = &env.functions[func_id.0 as usize];
                        let mutates_params = inner_func.params.iter().any(|param| {
                            let param_id = param.place().identifier;
                            let ident = &env.identifiers[param_id.0 as usize];
                            ident.mutable_range.end.0 > ident.mutable_range.start.0 + 1
                        });
                        if mutates_params {
                            return false;
                        }
                    }
                }
            }
        }
    }
    true
}

fn is_known_mutable_effect(effect: Effect) -> bool {
    matches!(
        effect,
        Effect::Store
            | Effect::Mutate
            | Effect::ConditionallyMutate
            | Effect::ConditionallyMutateIterator
    )
}

// =============================================================================
// Aliasing signature config support (new-style signatures)
// =============================================================================

fn compute_effects_for_aliasing_signature_config(
    env: &mut Environment,
    config: &crate::hir::type_config::AliasingSignatureConfig,
    lvalue: &Place,
    receiver: &Place,
    args: &[PlaceOrSpreadOrHole],
    _context: &[Place],
    _loc: Option<&SourceLocation>,
    temp_cache: &mut HashMap<(IdentifierId, u32), Place>,
) -> Result<Option<Vec<AliasingEffect>>, CompilerDiagnostic> {
    // Build substitutions from config strings to places
    let mut substitutions: HashMap<&'static str, Vec<Place>> = HashMap::default();
    substitutions.insert(config.receiver, vec![receiver.clone()]);
    substitutions.insert(config.returns, vec![lvalue.clone()]);

    let mut mutable_spreads: HashSet<IdentifierId> = HashSet::default();

    for (i, arg) in args.iter().enumerate() {
        match arg {
            PlaceOrSpreadOrHole::Hole => continue,
            PlaceOrSpreadOrHole::Place(place)
            | PlaceOrSpreadOrHole::Spread(crate::hir::SpreadPattern { place }) => {
                if i < config.params.len() && !matches!(arg, PlaceOrSpreadOrHole::Spread(_)) {
                    substitutions.insert(config.params[i], vec![place.clone()]);
                } else if let Some(rest) = config.rest {
                    substitutions.entry(rest).or_default().push(place.clone());
                } else {
                    return Ok(None);
                }

                if matches!(arg, PlaceOrSpreadOrHole::Spread(_)) {
                    let ty =
                        &env.types[env.identifiers[place.identifier.0 as usize].type_.0 as usize];
                    let mutate_iterator = conditionally_mutate_iterator(place, ty);
                    if mutate_iterator.is_some() {
                        mutable_spreads.insert(place.identifier);
                    }
                }
            }
        }
    }

    // Create temporaries (cached by lvalue + index to be stable across fixpoint iterations)
    for (temp_idx, &temp_name) in config.temporaries.iter().enumerate() {
        let cache_key = (lvalue.identifier, temp_idx as u32);
        let temp_place = temp_cache
            .entry(cache_key)
            .or_insert_with(|| create_temp_place(env, receiver.loc))
            .clone();
        substitutions.insert(temp_name, vec![temp_place]);
    }

    let mut effects: Vec<AliasingEffect> = Vec::new();

    for eff_config in &config.effects {
        match eff_config {
            crate::hir::type_config::AliasingEffectConfig::Freeze { value, reason } => {
                let values = substitutions.get(value).cloned().unwrap_or_default();
                for v in values {
                    if mutable_spreads.contains(&v.identifier) {
                        return Err(CompilerDiagnostic::todo(
                            "Support spread syntax for hook arguments",
                            v.loc,
                        ));
                    }
                    effects.push(AliasingEffect::Freeze {
                        value: v,
                        reason: *reason,
                    });
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Create {
                into,
                value,
                reason,
            } => {
                let intos = substitutions.get(into).cloned().unwrap_or_default();
                for v in intos {
                    effects.push(AliasingEffect::Create {
                        into: v,
                        value: *value,
                        reason: *reason,
                    });
                }
            }
            crate::hir::type_config::AliasingEffectConfig::CreateFrom { from, into } => {
                let froms = substitutions.get(from).cloned().unwrap_or_default();
                let intos = substitutions.get(into).cloned().unwrap_or_default();
                for f in &froms {
                    for t in &intos {
                        effects.push(AliasingEffect::CreateFrom {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Assign { from, into } => {
                let froms = substitutions.get(from).cloned().unwrap_or_default();
                let intos = substitutions.get(into).cloned().unwrap_or_default();
                for f in &froms {
                    for t in &intos {
                        effects.push(AliasingEffect::Assign {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Alias { from, into } => {
                let froms = substitutions.get(from).cloned().unwrap_or_default();
                let intos = substitutions.get(into).cloned().unwrap_or_default();
                for f in &froms {
                    for t in &intos {
                        effects.push(AliasingEffect::Alias {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Capture { from, into } => {
                let froms = substitutions.get(from).cloned().unwrap_or_default();
                let intos = substitutions.get(into).cloned().unwrap_or_default();
                for f in &froms {
                    for t in &intos {
                        effects.push(AliasingEffect::Capture {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            crate::hir::type_config::AliasingEffectConfig::ImmutableCapture { from, into } => {
                let froms = substitutions.get(from).cloned().unwrap_or_default();
                let intos = substitutions.get(into).cloned().unwrap_or_default();
                for f in &froms {
                    for t in &intos {
                        effects.push(AliasingEffect::ImmutableCapture {
                            from: f.clone(),
                            into: t.clone(),
                        });
                    }
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Impure { place } => {
                let values = substitutions.get(place).cloned().unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::Impure {
                        place: v,
                        error: Rc::new(CompilerDiagnostic::new(
                            ErrorCategory::Purity,
                            "Impure function call",
                            None,
                        )),
                    });
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Mutate { value } => {
                let values = substitutions.get(value).cloned().unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::Mutate {
                        value: v,
                        reason: None,
                    });
                }
            }
            crate::hir::type_config::AliasingEffectConfig::MutateTransitiveConditionally {
                value,
            } => {
                let values = substitutions.get(value).cloned().unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::MutateTransitiveConditionally { value: v });
                }
            }
            crate::hir::type_config::AliasingEffectConfig::Apply {
                receiver: r,
                function: f,
                mutates_function,
                args: a,
                into: i,
            } => {
                let recv = substitutions.get(r).and_then(|v| v.first()).cloned();
                let func = substitutions.get(f).and_then(|v| v.first()).cloned();
                let into = substitutions.get(i).and_then(|v| v.first()).cloned();
                if let (Some(recv), Some(func), Some(into)) = (recv, func, into) {
                    let mut apply_args: HirVec<PlaceOrSpreadOrHole> = AstAlloc::vec();
                    for arg in a {
                        match arg {
                            crate::hir::type_config::ApplyArgConfig::Hole { .. } => {
                                apply_args.push(PlaceOrSpreadOrHole::Hole);
                            }
                            crate::hir::type_config::ApplyArgConfig::Place(name) => {
                                if let Some(places) = substitutions.get(name) {
                                    if let Some(p) = places.first() {
                                        apply_args.push(PlaceOrSpreadOrHole::Place(p.clone()));
                                    }
                                }
                            }
                            crate::hir::type_config::ApplyArgConfig::Spread {
                                place: name, ..
                            } => {
                                if let Some(places) = substitutions.get(name) {
                                    if let Some(p) = places.first() {
                                        apply_args.push(PlaceOrSpreadOrHole::Spread(
                                            crate::hir::SpreadPattern { place: p.clone() },
                                        ));
                                    }
                                }
                            }
                        }
                    }
                    effects.push(AliasingEffect::Apply(Rc::new(ApplyEffect {
                        receiver: recv,
                        function: func,
                        mutates_function: *mutates_function,
                        args: apply_args,
                        into,
                        signature: None,
                        loc: _loc.copied(),
                    })));
                } else {
                    return Ok(None);
                }
            }
        }
    }

    Ok(Some(effects))
}

// =============================================================================
// Function expression signature building
// =============================================================================

/// Build an AliasingSignature from a function expression's params/returns/aliasing effects.
/// Corresponds to TS `buildSignatureFromFunctionExpression`.
fn build_signature_from_function_expression(
    env: &mut Environment,
    func_id: FunctionId,
) -> AliasingSignature {
    let inner_func = &env.functions[func_id.0 as usize];
    let mut params: HirVec<IdentifierId> = AstAlloc::vec();
    let mut rest: Option<IdentifierId> = None;
    for param in &inner_func.params {
        match param {
            ParamPattern::Place(p) => params.push(p.identifier),
            ParamPattern::Spread(s) => rest = Some(s.place.identifier),
        }
    }
    let returns = inner_func.returns.identifier;
    let aliasing_effects = inner_func
        .aliasing_effects
        .clone()
        .unwrap_or_else(AstAlloc::vec);
    let loc = inner_func.loc;

    if rest.is_none() {
        let temp = create_temp_place(env, loc);
        rest = Some(temp.identifier);
    }

    AliasingSignature {
        receiver: IdentifierId(0),
        params,
        rest,
        returns,
        effects: aliasing_effects,
        temporaries: AstAlloc::vec(),
    }
}

/// Compute effects by substituting an AliasingSignature (IdentifierId-based)
/// with actual arguments. Corresponds to TS `computeEffectsForSignature`.
fn compute_effects_for_aliasing_signature(
    env: &mut Environment,
    signature: &AliasingSignature,
    lvalue: &Place,
    receiver: &Place,
    args: &[PlaceOrSpreadOrHole],
    context: &[Place],
    _loc: Option<&SourceLocation>,
) -> Result<Option<Vec<AliasingEffect>>, CompilerDiagnostic> {
    if signature.params.len() > args.len()
        || (args.len() > signature.params.len() && signature.rest.is_none())
    {
        return Ok(None);
    }

    let mut mutable_spreads: HashSet<IdentifierId> = HashSet::default();
    let mut substitutions: HashMap<IdentifierId, Vec<Place>> = HashMap::default();
    substitutions.insert(signature.receiver, vec![receiver.clone()]);
    substitutions.insert(signature.returns, vec![lvalue.clone()]);

    for (i, arg) in args.iter().enumerate() {
        match arg {
            PlaceOrSpreadOrHole::Hole => continue,
            PlaceOrSpreadOrHole::Place(place)
            | PlaceOrSpreadOrHole::Spread(crate::hir::SpreadPattern { place }) => {
                let is_spread = matches!(arg, PlaceOrSpreadOrHole::Spread(_));
                if !is_spread && i < signature.params.len() {
                    substitutions.insert(signature.params[i], vec![place.clone()]);
                } else if let Some(rest_id) = signature.rest {
                    substitutions
                        .entry(rest_id)
                        .or_default()
                        .push(place.clone());
                } else {
                    return Ok(None);
                }

                if is_spread {
                    let ty =
                        &env.types[env.identifiers[place.identifier.0 as usize].type_.0 as usize];
                    let mutate_iterator = conditionally_mutate_iterator(place, ty);
                    if mutate_iterator.is_some() {
                        mutable_spreads.insert(place.identifier);
                    }
                }
            }
        }
    }

    // Add context variable substitutions (identity mapping)
    for operand in context {
        substitutions.insert(operand.identifier, vec![operand.clone()]);
    }

    // Create temporaries
    for temp in &signature.temporaries {
        let temp_place = create_temp_place(env, receiver.loc);
        substitutions.insert(temp.identifier, vec![temp_place]);
    }

    let mut effects: Vec<AliasingEffect> = Vec::new();

    for eff in &signature.effects {
        match eff {
            AliasingEffect::MaybeAlias { from, into }
            | AliasingEffect::Assign { from, into }
            | AliasingEffect::ImmutableCapture { from, into }
            | AliasingEffect::Alias { from, into }
            | AliasingEffect::CreateFrom { from, into }
            | AliasingEffect::Capture { from, into } => {
                let from_places = substitutions
                    .get(&from.identifier)
                    .cloned()
                    .unwrap_or_default();
                let to_places = substitutions
                    .get(&into.identifier)
                    .cloned()
                    .unwrap_or_default();
                for f in &from_places {
                    for t in &to_places {
                        effects.push(match eff {
                            AliasingEffect::MaybeAlias { .. } => AliasingEffect::MaybeAlias {
                                from: f.clone(),
                                into: t.clone(),
                            },
                            AliasingEffect::Assign { .. } => AliasingEffect::Assign {
                                from: f.clone(),
                                into: t.clone(),
                            },
                            AliasingEffect::ImmutableCapture { .. } => {
                                AliasingEffect::ImmutableCapture {
                                    from: f.clone(),
                                    into: t.clone(),
                                }
                            }
                            AliasingEffect::Alias { .. } => AliasingEffect::Alias {
                                from: f.clone(),
                                into: t.clone(),
                            },
                            AliasingEffect::CreateFrom { .. } => AliasingEffect::CreateFrom {
                                from: f.clone(),
                                into: t.clone(),
                            },
                            AliasingEffect::Capture { .. } => AliasingEffect::Capture {
                                from: f.clone(),
                                into: t.clone(),
                            },
                            _ => unreachable!(),
                        });
                    }
                }
            }
            AliasingEffect::Impure { place, error } => {
                let values = substitutions
                    .get(&place.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::Impure {
                        place: v,
                        error: Rc::clone(error),
                    });
                }
            }
            AliasingEffect::MutateFrozen { place, error } => {
                let values = substitutions
                    .get(&place.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::MutateFrozen {
                        place: v,
                        error: Rc::clone(error),
                    });
                }
            }
            AliasingEffect::MutateGlobal { place, error } => {
                let values = substitutions
                    .get(&place.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::MutateGlobal {
                        place: v,
                        error: Rc::clone(error),
                    });
                }
            }
            AliasingEffect::Render { place } => {
                let values = substitutions
                    .get(&place.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::Render { place: v });
                }
            }
            AliasingEffect::Mutate { value, reason } => {
                let values = substitutions
                    .get(&value.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::Mutate {
                        value: v,
                        reason: reason.clone(),
                    });
                }
            }
            AliasingEffect::MutateConditionally { value } => {
                let values = substitutions
                    .get(&value.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::MutateConditionally { value: v });
                }
            }
            AliasingEffect::MutateTransitive { value } => {
                let values = substitutions
                    .get(&value.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::MutateTransitive { value: v });
                }
            }
            AliasingEffect::MutateTransitiveConditionally { value } => {
                let values = substitutions
                    .get(&value.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    effects.push(AliasingEffect::MutateTransitiveConditionally { value: v });
                }
            }
            AliasingEffect::Freeze { value, reason } => {
                let values = substitutions
                    .get(&value.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in values {
                    if mutable_spreads.contains(&v.identifier) {
                        return Err(CompilerDiagnostic::todo(
                            "Support spread syntax for hook arguments",
                            v.loc,
                        ));
                    }
                    effects.push(AliasingEffect::Freeze {
                        value: v,
                        reason: *reason,
                    });
                }
            }
            AliasingEffect::Create {
                into,
                value,
                reason,
            } => {
                let intos = substitutions
                    .get(&into.identifier)
                    .cloned()
                    .unwrap_or_default();
                for v in intos {
                    effects.push(AliasingEffect::Create {
                        into: v,
                        value: *value,
                        reason: *reason,
                    });
                }
            }
            AliasingEffect::Apply(apply) => {
                let ApplyEffect {
                    receiver: r,
                    function: f,
                    mutates_function: mf,
                    args: a,
                    into: i,
                    signature: s,
                    loc: _l,
                } = &**apply;
                let recv = substitutions
                    .get(&r.identifier)
                    .and_then(|v| v.first())
                    .cloned();
                let func = substitutions
                    .get(&f.identifier)
                    .and_then(|v| v.first())
                    .cloned();
                let apply_into = substitutions
                    .get(&i.identifier)
                    .and_then(|v| v.first())
                    .cloned();
                if let (Some(recv), Some(func), Some(apply_into)) = (recv, func, apply_into) {
                    let mut apply_args: HirVec<PlaceOrSpreadOrHole> = AstAlloc::vec();
                    for arg in a {
                        match arg {
                            PlaceOrSpreadOrHole::Hole => apply_args.push(PlaceOrSpreadOrHole::Hole),
                            PlaceOrSpreadOrHole::Place(p) => {
                                if let Some(places) = substitutions.get(&p.identifier) {
                                    if let Some(place) = places.first() {
                                        apply_args.push(PlaceOrSpreadOrHole::Place(place.clone()));
                                    }
                                }
                            }
                            PlaceOrSpreadOrHole::Spread(sp) => {
                                if let Some(places) = substitutions.get(&sp.place.identifier) {
                                    if let Some(place) = places.first() {
                                        apply_args.push(PlaceOrSpreadOrHole::Spread(
                                            crate::hir::SpreadPattern {
                                                place: place.clone(),
                                            },
                                        ));
                                    }
                                }
                            }
                        }
                    }
                    effects.push(AliasingEffect::Apply(Rc::new(ApplyEffect {
                        receiver: recv,
                        function: func,
                        mutates_function: *mf,
                        args: apply_args,
                        into: apply_into,
                        signature: s.clone(),
                        loc: _loc.copied(),
                    })));
                } else {
                    return Ok(None);
                }
            }
            AliasingEffect::CreateFunction { .. } => {
                // Not supported in signature substitution
                return Ok(None);
            }
        }
    }

    Ok(Some(effects))
}

// =============================================================================
// Helpers
// =============================================================================

/// TS has `[...set][0]`, the reason that was inserted first, which a set of bits does not know.
/// It is for the `Create` among the effects of an instruction, whose reason nothing reads: the
/// value itself has the whole set, and `get_write_error_reason` chooses from that.
fn primary_reason(reasons: ValueReasonSet) -> ValueReason {
    for r in reasons.iter() {
        if r != ValueReason::Other {
            return r;
        }
    }
    ValueReason::Other
}

fn get_write_error_reason(abstract_value: AbstractValue) -> &'static str {
    if abstract_value.reason.contains(ValueReason::Global) {
        "Modifying a variable defined outside a component or hook is not allowed. Consider using an effect"
    } else if abstract_value.reason.contains(ValueReason::JsxCaptured) {
        "Modifying a value used previously in JSX is not allowed. Consider moving the modification before the JSX"
    } else if abstract_value.reason.contains(ValueReason::Context) {
        "Modifying a value returned from 'useContext()' is not allowed."
    } else if abstract_value
        .reason
        .contains(ValueReason::KnownReturnSignature)
    {
        "Modifying a value returned from a function whose return value should not be mutated"
    } else if abstract_value
        .reason
        .contains(ValueReason::ReactiveFunctionArgument)
    {
        "Modifying component props or hook arguments is not allowed. Consider using a local variable instead"
    } else if abstract_value.reason.contains(ValueReason::State) {
        "Modifying a value returned from 'useState()', which should not be modified directly. Use the setter function to update instead"
    } else if abstract_value.reason.contains(ValueReason::ReducerState) {
        "Modifying a value returned from 'useReducer()', which should not be modified directly. Use the dispatch function to update instead"
    } else if abstract_value.reason.contains(ValueReason::Effect) {
        "Modifying a value used previously in an effect function or as an effect dependency is not allowed. Consider moving the modification before calling useEffect()"
    } else if abstract_value.reason.contains(ValueReason::HookCaptured) {
        "Modifying a value previously passed as an argument to a hook is not allowed. Consider moving the modification before calling the hook"
    } else if abstract_value.reason.contains(ValueReason::HookReturn) {
        "Modifying a value returned from a hook is not allowed. Consider moving the modification into the hook where the value is constructed"
    } else {
        "This modifies a variable that React considers immutable"
    }
}

fn conditionally_mutate_iterator(place: &Place, ty: &Type) -> Option<AliasingEffect> {
    if !is_builtin_collection_type(ty) {
        Some(AliasingEffect::MutateTransitiveConditionally {
            value: place.clone(),
        })
    } else {
        None
    }
}

fn is_builtin_collection_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) }
        if *id == BUILT_IN_ARRAY_ID || *id == BUILT_IN_SET_ID || *id == BUILT_IN_MAP_ID
    )
}

fn get_function_call_signature(
    env: &Environment,
    callee_id: IdentifierId,
) -> Result<Option<FunctionSignature>, CompilerDiagnostic> {
    let ty = &env.types[env.identifiers[callee_id.0 as usize].type_.0 as usize];
    Ok(env.get_function_signature(ty)?.cloned())
}

fn is_ref_or_ref_value_for_id(env: &Environment, id: IdentifierId) -> bool {
    let ty = &env.types[env.identifiers[id.0 as usize].type_.0 as usize];
    crate::hir::is_ref_or_ref_value(ty)
}

fn get_hook_kind_for_type<'a>(
    env: &'a Environment,
    ty: &Type,
) -> Result<Option<&'a HookKind>, CompilerDiagnostic> {
    env.get_hook_kind_for_type(ty)
}

/// Format a Type for printPlace-style output, matching TS's `printType()`.
fn format_type_for_print(ty: &Type) -> String {
    if !crate::lowering::thread_has_stack() {
        return String::new();
    }

    match ty {
        Type::Primitive => String::new(),
        Type::Function {
            shape_id,
            return_type,
            ..
        } => {
            if let Some(sid) = shape_id {
                let ret = format_type_for_print(return_type);
                if ret.is_empty() {
                    format!(":TFunction<{}>()", sid)
                } else {
                    format!(":TFunction<{}>():  {}", sid, ret)
                }
            } else {
                ":TFunction".to_string()
            }
        }
        Type::Object { shape_id } => {
            if let Some(sid) = shape_id {
                format!(":TObject<{}>", sid)
            } else {
                ":TObject".to_string()
            }
        }
        Type::Poly => ":TPoly".to_string(),
        Type::Phi { .. } => ":TPhi".to_string(),
        Type::Property { .. } => ":TProperty".to_string(),
        Type::TypeVar { .. } => String::new(),
        Type::ObjectMethod => ":TObjectMethod".to_string(),
    }
}

fn is_phi_with_jsx(ty: &Type) -> bool {
    if let Type::Phi { operands } = ty {
        operands.iter().any(|op| crate::hir::is_jsx_type(op))
    } else {
        false
    }
}

fn place_or_spread_to_hole(pos: &PlaceOrSpread) -> PlaceOrSpreadOrHole {
    match pos {
        PlaceOrSpread::Place(p) => PlaceOrSpreadOrHole::Place(p.clone()),
        PlaceOrSpread::Spread(s) => PlaceOrSpreadOrHole::Spread(s.clone()),
    }
}

use crate::hir::JsxTag;

/// Each with whether it is spread.
fn build_apply_operands<'a>(
    receiver: &'a Place,
    function: &'a Place,
    args: &'a [PlaceOrSpreadOrHole],
) -> SmallVec<[(&'a Place, bool); 8]> {
    let mut result = smallvec::smallvec![(receiver, false), (function, false)];
    for arg in args {
        match arg {
            PlaceOrSpreadOrHole::Hole => continue,
            PlaceOrSpreadOrHole::Place(p) => result.push((p, false)),
            PlaceOrSpreadOrHole::Spread(s) => result.push((&s.place, true)),
        }
    }
    result
}

fn create_temp_place(env: &mut Environment, loc: Option<SourceLocation>) -> Place {
    let id = env.next_identifier_id();
    env.identifiers[id.0 as usize].loc = loc;
    Place {
        identifier: id,
        effect: Effect::Unknown,
        reactive: false,
        loc,
    }
}

/// Pattern item helper for Destructure.
///
/// NOTE: This cannot use `visitors::each_pattern_operand` because callers need
/// to distinguish Place from Spread elements — Spread elements get different
/// aliasing effects (Create + Capture) vs Place elements (Create or CreateFrom).
enum PatternItem<'a> {
    Place(&'a Place),
    Spread(&'a Place),
}

fn each_pattern_items(pattern: &crate::hir::Pattern) -> Vec<PatternItem<'_>> {
    let mut items = Vec::new();
    match pattern {
        crate::hir::Pattern::Array(arr) => {
            for el in &arr.items {
                match el {
                    crate::hir::ArrayPatternElement::Place(p) => items.push(PatternItem::Place(p)),
                    crate::hir::ArrayPatternElement::Spread(s) => {
                        items.push(PatternItem::Spread(&s.place))
                    }
                    crate::hir::ArrayPatternElement::Hole => {}
                }
            }
        }
        crate::hir::Pattern::Object(obj) => {
            for prop in &obj.properties {
                match prop {
                    crate::hir::ObjectPropertyOrSpread::Property(p) => {
                        items.push(PatternItem::Place(&p.place))
                    }
                    crate::hir::ObjectPropertyOrSpread::Spread(s) => {
                        items.push(PatternItem::Spread(&s.place))
                    }
                }
            }
        }
    }
    items
}
