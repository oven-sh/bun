// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Infers which `Place`s are reactive.
//!
//! Ported from TypeScript `src/Inference/InferReactivePlaces.ts`.
//!
//! A place is reactive if it derives from any source of reactivity:
//! 1. Props (component parameters may change between renders)
//! 2. Hooks (can access state or context)
//! 3. `use` operator (can access context)
//! 4. Mutation with reactive operands
//! 5. Conditional assignment based on reactive control flow

use crate::diagnostics::CompilerDiagnostic;
use crate::hir::dominator::post_dominator_frontiers;
use crate::hir::environment::Environment;
use crate::hir::object_shape::HookKind;
use crate::hir::visitors;
use crate::hir::{
    BlockId, Effect, FunctionId, HirFunction, IdentifierId, InstructionValue, Place, Terminal, Type,
};

use crate::utils::DisjointSet;

use crate::inference::infer_reactive_scope_variables::find_disjoint_mutable_values;

// =============================================================================
// Public API
// =============================================================================

/// Infer which places in a function are reactive.
///
/// Corresponds to TS `inferReactivePlaces(fn: HIRFunction): void`.
pub(crate) fn infer_reactive_places(
    func: &mut HirFunction,
    env: &mut Environment,
) -> Result<(), CompilerDiagnostic> {
    let aliased_identifiers = find_disjoint_mutable_values(func, env);
    let identifier_count = env.identifiers.len();
    let mut reactive_map = ReactivityMap::new(aliased_identifiers, identifier_count);
    let mut stable_sidemap = StableSidemap::new(identifier_count);

    // Mark all function parameters as reactive
    for param in &func.params {
        let place = param.place();
        reactive_map.mark_reactive(place.identifier);
    }

    // Compute control dominators
    let post_dominators =
        crate::hir::dominator::compute_post_dominator_tree(func, env.next_block_id().0, false)?;

    // The post-dominator frontier (and thus the set of control-test identifiers
    // per block) is a function of the CFG only, so compute it once here instead
    // of inside the fixpoint loop.
    let frontiers = post_dominator_frontiers(func, &post_dominators)?;
    let mut control_tests = ControlTests::new(env.next_block_id_counter as usize);
    for &block_id in func.body.blocks.keys() {
        let tests = &mut control_tests.tests;
        let start = tests.len() as u32;
        for frontier_block_id in frontiers.get(block_id).into_iter().flatten() {
            let control_block = func.body.blocks.get(frontier_block_id).unwrap();
            match &control_block.terminal {
                Terminal::If { test, .. } | Terminal::Branch { test, .. } => {
                    tests.push(test.identifier);
                }
                Terminal::Switch { test, cases, .. } => {
                    tests.push(test.identifier);
                    for case in cases {
                        if let Some(ref case_test) = case.test {
                            tests.push(case_test.identifier);
                        }
                    }
                }
                _ => {}
            }
        }
        control_tests.of_block[block_id.0 as usize] = (start, tests.len() as u32);
    }

    // Track phi operand reactive flags during fixpoint.
    // In TS, isReactive() sets place.reactive as a side effect. But when a phi
    // is already reactive, the TS `continue`s and skips operand processing.
    // We track which phi operand Places should be marked reactive: one flag
    // for each operand of each phi, in the order of the blocks.
    let phi_operand_count = func.body.blocks.values().flat_map(|block| &block.phis);
    let phi_operand_count = phi_operand_count.map(|phi| phi.operands.len()).sum();
    let mut phi_operand_reactive = vec![false; phi_operand_count];

    // Fixpoint iteration — compute reactive set
    let mut is_settled = false;
    loop {
        reactive_map.start_round();
        stable_sidemap.start_round();
        let mut next_phi_operand = 0;
        for (block_id, block) in &func.body.blocks {
            let has_reactive_control = control_tests.any_is_reactive(*block_id, &mut reactive_map);

            // Process phi nodes
            for phi in &block.phis {
                let first_operand = next_phi_operand;
                next_phi_operand += phi.operands.len();
                if reactive_map.is_reactive(phi.place.identifier) {
                    // TS does `continue` here — skips operand isReactive calls.
                    // phi operand reactive flags stay as they were from last visit.
                    continue;
                }
                let mut is_phi_reactive = false;
                for (op_idx, (_pred, operand)) in phi.operands.iter().enumerate() {
                    if reactive_map.is_reactive(operand.identifier) {
                        phi_operand_reactive[first_operand + op_idx] = true;
                        is_phi_reactive = true;
                        break; // TS breaks here — remaining operands NOT visited
                    }
                }
                if is_phi_reactive {
                    reactive_map.mark_reactive(phi.place.identifier);
                } else {
                    for (pred, _operand) in &phi.operands {
                        if control_tests.any_is_reactive(*pred, &mut reactive_map) {
                            reactive_map.mark_reactive(phi.place.identifier);
                            break;
                        }
                    }
                }
            }

            // Process instructions
            for instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];

                // Handle stable identifier sources
                stable_sidemap.handle_instruction(instr, env);

                let value = &instr.value;

                // Check if any operand is reactive
                let mut has_reactive_input = false;
                for operand in visitors::operands(value, &env.functions) {
                    let reactive = reactive_map.is_reactive(operand.identifier);
                    has_reactive_input = has_reactive_input || reactive;
                }

                // Hooks and `use` operator are sources of reactivity
                match value {
                    InstructionValue::CallExpression { callee, .. } => {
                        let callee_ty = &env.types
                            [env.identifiers[callee.identifier.0 as usize].type_.0 as usize];
                        if get_hook_kind_for_type(env, callee_ty)?.is_some()
                            || is_use_operator_type(callee_ty)
                        {
                            has_reactive_input = true;
                        }
                    }
                    InstructionValue::TaggedTemplateExpression { .. }
                        if env.config.tagged_templates_are_always_called =>
                    {
                        has_reactive_input = true;
                    }
                    InstructionValue::MethodCall { property, .. } => {
                        let property_ty = &env.types
                            [env.identifiers[property.identifier.0 as usize].type_.0 as usize];
                        if get_hook_kind_for_type(env, property_ty)?.is_some()
                            || is_use_operator_type(property_ty)
                        {
                            has_reactive_input = true;
                        }
                    }
                    _ => {}
                }

                if has_reactive_input {
                    // Mark lvalues reactive (unless stable)
                    for lvalue in visitors::lvalues(instr) {
                        if stable_sidemap.read(lvalue.identifier).unwrap_or(false) {
                            continue;
                        }
                        reactive_map.mark_reactive(lvalue.identifier);
                    }
                }

                if has_reactive_input || has_reactive_control {
                    // Mark mutable operands reactive
                    for op_place in visitors::operands(value, &env.functions) {
                        match op_place.effect {
                            Effect::Capture
                            | Effect::Store
                            | Effect::ConditionallyMutate
                            | Effect::ConditionallyMutateIterator
                            | Effect::Mutate => {
                                let op_range =
                                    &env.identifiers[op_place.identifier.0 as usize].mutable_range;
                                if op_range.contains(instr.id) {
                                    reactive_map.mark_reactive(op_place.identifier);
                                }
                            }
                            Effect::Freeze | Effect::Read => {
                                // no-op
                            }
                            Effect::Unknown => {
                                return Err(crate::diagnostics::cold_invariant(
                                    "Unexpected unknown effect",
                                    Some(format!("{:?}", op_place.loc)),
                                    None,
                                )
                                .into());
                            }
                        }
                    }
                }
            }
        }

        let had_changes = reactive_map.snapshot();
        debug_assert!(!is_settled || !had_changes && stable_sidemap.changed == Changed::Nothing);
        if !had_changes || is_settled {
            break;
        }
        // A round that has changed nothing after it had read it reads the same again, and so
        // writes the same again.
        is_settled = !reactive_map.has_changed_what_was_read
            && stable_sidemap.changed != Changed::WhatWasRead;
        if is_settled && !cfg!(debug_assertions) {
            break;
        }
    }

    // Now apply reactive flags by replaying the traversal pattern.
    apply_reactive_flags_replay(
        func,
        env,
        &reactive_map.reactive_ids(),
        &stable_sidemap,
        &phi_operand_reactive,
    );

    Ok(())
}

// =============================================================================
// ReactivityMap
// =============================================================================

struct ReactivityMap {
    has_changes: bool,
    has_changed_what_was_read: bool,
    round: u32,
    /// Indexed by `IdentifierId.0`: `REACTIVE`, or the last round that has found it not to be.
    reactive: Vec<u32>,
    /// Indexed by `IdentifierId.0`: what `aliased_identifiers` finds, or the identifier itself.
    canonical: Vec<IdentifierId>,
    aliased_identifiers: DisjointSet<IdentifierId>,
}

const REACTIVE: u32 = u32::MAX;

impl ReactivityMap {
    fn new(mut aliased_identifiers: DisjointSet<IdentifierId>, identifier_count: usize) -> Self {
        let mut canonical: Vec<IdentifierId> =
            (0..identifier_count as u32).map(IdentifierId).collect();
        aliased_identifiers.for_each(|id, group| canonical[id.0 as usize] = group);
        ReactivityMap {
            has_changes: false,
            has_changed_what_was_read: false,
            round: 0,
            reactive: vec![0; identifier_count],
            canonical,
            aliased_identifiers,
        }
    }

    fn start_round(&mut self) {
        self.round += 1;
        self.has_changed_what_was_read = false;
    }

    #[inline]
    fn canonical(&mut self, id: IdentifierId) -> IdentifierId {
        let canonical = self.canonical[id.0 as usize];
        debug_assert_eq!(
            canonical,
            self.aliased_identifiers.find_opt(id).unwrap_or(id)
        );
        canonical
    }

    #[inline]
    fn is_reactive(&mut self, id: IdentifierId) -> bool {
        let canonical = self.canonical(id);
        let slot = &mut self.reactive[canonical.0 as usize];
        if *slot == REACTIVE {
            return true;
        }
        *slot = self.round;
        false
    }

    #[inline]
    fn mark_reactive(&mut self, id: IdentifierId) {
        let canonical = self.canonical(id);
        let slot = &mut self.reactive[canonical.0 as usize];
        if *slot != REACTIVE {
            self.has_changed_what_was_read |= *slot == self.round;
            *slot = REACTIVE;
            self.has_changes = true;
        }
    }

    /// Reset change tracking, returns true if there were changes.
    fn snapshot(&mut self) -> bool {
        let had_changes = self.has_changes;
        self.has_changes = false;
        had_changes
    }

    /// `is_reactive` of each identifier, indexed by `IdentifierId.0`.
    fn reactive_ids(&self) -> Vec<bool> {
        let canonical = self.canonical.iter();
        canonical
            .map(|id| self.reactive[id.0 as usize] == REACTIVE)
            .collect()
    }
}

// =============================================================================
// StableSidemap
// =============================================================================

struct StableSidemap {
    /// Dense map indexed by `IdentifierId.0`. `None` = not tracked.
    map: Vec<Option<bool>>,
    /// Indexed by `IdentifierId.0`: the last round that has read `map`.
    read_in: Vec<u32>,
    round: u32,
    changed: Changed,
}

/// What a round has changed, at the most.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Changed {
    Nothing,
    WhatWasNotRead,
    WhatWasRead,
}

impl StableSidemap {
    fn new(identifier_count: usize) -> Self {
        StableSidemap {
            map: vec![None; identifier_count],
            read_in: vec![0; identifier_count],
            round: 0,
            changed: Changed::Nothing,
        }
    }

    fn start_round(&mut self) {
        self.round += 1;
        self.changed = Changed::Nothing;
    }

    #[inline]
    fn set(&mut self, id: IdentifierId, value: bool) {
        let slot = &mut self.map[id.0 as usize];
        if *slot != Some(value) {
            *slot = Some(value);
            self.changed = self
                .changed
                .max(match self.read_in[id.0 as usize] == self.round {
                    true => Changed::WhatWasRead,
                    false => Changed::WhatWasNotRead,
                });
        }
    }

    #[inline]
    fn read(&mut self, id: IdentifierId) -> Option<bool> {
        self.read_in[id.0 as usize] = self.round;
        self.map[id.0 as usize]
    }

    fn handle_instruction(&mut self, instr: &crate::hir::Instruction, env: &Environment) {
        let lvalue_id = instr.lvalue.identifier;
        let value = &instr.value;

        match value {
            InstructionValue::CallExpression { callee, .. } => {
                let callee_ty =
                    &env.types[env.identifiers[callee.identifier.0 as usize].type_.0 as usize];
                if evaluates_to_stable_type_or_container(env, callee_ty) {
                    let lvalue_ty =
                        &env.types[env.identifiers[lvalue_id.0 as usize].type_.0 as usize];
                    self.set(lvalue_id, is_stable_type(lvalue_ty));
                }
            }
            InstructionValue::MethodCall { property, .. } => {
                let property_ty =
                    &env.types[env.identifiers[property.identifier.0 as usize].type_.0 as usize];
                if evaluates_to_stable_type_or_container(env, property_ty) {
                    let lvalue_ty =
                        &env.types[env.identifiers[lvalue_id.0 as usize].type_.0 as usize];
                    self.set(lvalue_id, is_stable_type(lvalue_ty));
                }
            }
            InstructionValue::PropertyLoad { object, .. } => {
                let source_id = object.identifier;
                if self.read(source_id).is_some() {
                    let lvalue_ty =
                        &env.types[env.identifiers[lvalue_id.0 as usize].type_.0 as usize];
                    if is_stable_type_container(lvalue_ty) {
                        self.set(lvalue_id, false);
                    } else if is_stable_type(lvalue_ty) {
                        self.set(lvalue_id, true);
                    }
                }
            }
            InstructionValue::Destructure { value: val, .. } => {
                let source_id = val.identifier;
                if self.read(source_id).is_some() {
                    for place in visitors::lvalues(instr) {
                        let lid = place.identifier;
                        let lid_ty = &env.types[env.identifiers[lid.0 as usize].type_.0 as usize];
                        if is_stable_type_container(lid_ty) {
                            self.set(lid, false);
                        } else if is_stable_type(lid_ty) {
                            self.set(lid, true);
                        }
                    }
                }
            }
            InstructionValue::StoreLocal {
                lvalue, value: val, ..
            } => {
                if let Some(entry) = self.read(val.identifier) {
                    self.set(lvalue_id, entry);
                    self.set(lvalue.place.identifier, entry);
                }
            }
            InstructionValue::LoadLocal { place, .. } => {
                if let Some(entry) = self.read(place.identifier) {
                    self.set(lvalue_id, entry);
                }
            }
            _ => {}
        }
    }

    fn is_stable(&self, id: IdentifierId) -> bool {
        self.map[id.0 as usize].unwrap_or(false)
    }
}

// =============================================================================
// Control dominators (ported from ControlDominators.ts)
// =============================================================================

/// The identifiers that the terminals in the post-dominator frontier of each block test.
struct ControlTests {
    tests: Vec<IdentifierId>,
    /// Indexed by `BlockId.0`: from where to where in `tests`.
    of_block: Vec<(u32, u32)>,
}

impl ControlTests {
    fn new(block_count: usize) -> Self {
        ControlTests {
            tests: Vec::new(),
            of_block: vec![(0, 0); block_count],
        }
    }

    #[inline]
    fn any_is_reactive(&self, block_id: BlockId, reactive_map: &mut ReactivityMap) -> bool {
        let (start, end) = self.of_block[block_id.0 as usize];
        self.tests[start as usize..end as usize]
            .iter()
            .any(|&id| reactive_map.is_reactive(id))
    }
}

// =============================================================================
// Type helpers (ported from HIR.ts)
// =============================================================================

use crate::hir::is_use_operator_type;

fn get_hook_kind_for_type<'a>(
    env: &'a Environment,
    ty: &Type,
) -> Result<Option<&'a HookKind>, CompilerDiagnostic> {
    env.get_hook_kind_for_type(ty)
}

fn is_stable_type(ty: &Type) -> bool {
    match ty {
        Type::Function {
            shape_id: Some(id), ..
        } => {
            matches!(
                *id,
                "BuiltInSetState"
                    | "BuiltInSetActionState"
                    | "BuiltInDispatch"
                    | "BuiltInStartTransition"
                    | "BuiltInSetOptimistic"
            )
        }
        Type::Object { shape_id: Some(id) } => {
            matches!(*id, "BuiltInUseRefId")
        }
        _ => false,
    }
}

fn is_stable_type_container(ty: &Type) -> bool {
    match ty {
        Type::Object { shape_id: Some(id) } => {
            matches!(
                *id,
                "BuiltInUseState"
                    | "BuiltInUseActionState"
                    | "BuiltInUseReducer"
                    | "BuiltInUseOptimistic"
                    | "BuiltInUseTransition"
            )
        }
        _ => false,
    }
}

fn evaluates_to_stable_type_or_container(env: &Environment, callee_ty: &Type) -> bool {
    if let Some(hook_kind) = get_hook_kind_for_type(env, callee_ty).ok().flatten() {
        matches!(
            hook_kind,
            HookKind::UseState
                | HookKind::UseReducer
                | HookKind::UseActionState
                | HookKind::UseRef
                | HookKind::UseTransition
                | HookKind::UseOptimistic
        )
    } else {
        false
    }
}

// =============================================================================
// Apply reactive flags to the HIR (replay pass)
// =============================================================================

fn apply_reactive_flags_replay(
    func: &mut HirFunction,
    env: &mut Environment,
    reactive_ids: &[bool],
    stable_sidemap: &StableSidemap,
    phi_operand_reactive: &[bool],
) {
    // 1. Mark params
    for param in &mut func.params {
        let place = param.place_mut();
        place.reactive = true;
    }

    // 2. Walk blocks
    let mut phi_operand_reactive = phi_operand_reactive.iter();
    for block in func.body.blocks.values_mut() {
        // 2a. Phi nodes
        for phi in &mut block.phis {
            if reactive_ids[phi.place.identifier.0 as usize] {
                phi.place.reactive = true;
            }

            for (operand, &is_reactive) in phi.operands.values_mut().zip(&mut phi_operand_reactive)
            {
                if is_reactive {
                    operand.reactive = true;
                }
            }
        }

        // 2b. Instructions
        for instr_id in &block.instructions {
            let instr = &mut func.instructions[instr_id.0 as usize];

            // Value operands: set reactive flag using canonical visitor,
            // and compute hasReactiveInput
            let mut has_reactive_input = false;
            let mut apply = |place: &mut Place| {
                if reactive_ids[place.identifier.0 as usize] {
                    place.reactive = true;
                    has_reactive_input = true;
                }
            };
            visitors::for_each_instruction_value_operand_mut(&mut instr.value, &mut apply);
            // FunctionExpression/ObjectMethod context variables require env access
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } = &mut instr.value
            {
                let inner_func = &mut env.functions[lowered_func.func.0 as usize];
                inner_func.context.iter_mut().for_each(&mut apply);
            }

            // Check hooks/use
            match &instr.value {
                InstructionValue::CallExpression { callee, .. } => {
                    let callee_ty =
                        &env.types[env.identifiers[callee.identifier.0 as usize].type_.0 as usize];
                    if get_hook_kind_for_type(env, callee_ty)
                        .ok()
                        .flatten()
                        .is_some()
                        || is_use_operator_type(callee_ty)
                    {
                        has_reactive_input = true;
                    }
                }
                InstructionValue::TaggedTemplateExpression { .. }
                    if env.config.tagged_templates_are_always_called =>
                {
                    has_reactive_input = true;
                }
                InstructionValue::MethodCall { property, .. } => {
                    let property_ty = &env.types
                        [env.identifiers[property.identifier.0 as usize].type_.0 as usize];
                    if get_hook_kind_for_type(env, property_ty)
                        .ok()
                        .flatten()
                        .is_some()
                        || is_use_operator_type(property_ty)
                    {
                        has_reactive_input = true;
                    }
                }
                _ => {}
            }

            // Lvalues: markReactive is called only when hasReactiveInput
            if has_reactive_input {
                let lvalue_id = instr.lvalue.identifier;
                if !stable_sidemap.is_stable(lvalue_id) && reactive_ids[lvalue_id.0 as usize] {
                    instr.lvalue.reactive = true;
                }
                // Handle value lvalues — includes DeclareContext/StoreContext which
                // for_each_instruction_lvalue_mut skips, so we use a direct match.
                match &mut instr.value {
                    InstructionValue::DeclareLocal { lvalue, .. }
                    | InstructionValue::DeclareContext { lvalue, .. }
                    | InstructionValue::StoreLocal { lvalue, .. }
                    | InstructionValue::StoreContext { lvalue, .. } => {
                        let id = lvalue.place.identifier;
                        if !stable_sidemap.is_stable(id) && reactive_ids[id.0 as usize] {
                            lvalue.place.reactive = true;
                        }
                    }
                    InstructionValue::Destructure { lvalue, .. } => {
                        visitors::for_each_pattern_operand_mut(&mut lvalue.pattern, &mut |place| {
                            if !stable_sidemap.is_stable(place.identifier)
                                && reactive_ids[place.identifier.0 as usize]
                            {
                                place.reactive = true;
                            }
                        });
                    }
                    InstructionValue::PrefixUpdate { lvalue, .. }
                    | InstructionValue::PostfixUpdate { lvalue, .. } => {
                        let id = lvalue.identifier;
                        if !stable_sidemap.is_stable(id) && reactive_ids[id.0 as usize] {
                            lvalue.reactive = true;
                        }
                    }
                    _ => {}
                }
            }
        }

        // 2c. Terminal operands
        visitors::for_each_terminal_operand_mut(&mut block.terminal, &mut |place| {
            if reactive_ids[place.identifier.0 as usize] {
                place.reactive = true;
            }
        });
    }

    // 3. Apply to inner functions
    apply_reactive_flags_to_inner_functions(func, env, reactive_ids);
}

fn apply_reactive_flags_to_inner_functions(
    func: &HirFunction,
    env: &mut Environment,
    reactive_ids: &[bool],
) {
    for (_block_id, block) in &func.body.blocks {
        for instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    apply_reactive_flags_to_inner_func(lowered_func.func, env, reactive_ids);
                }
                _ => {}
            }
        }
    }
}

fn apply_reactive_flags_to_inner_func(
    func_id: FunctionId,
    env: &mut Environment,
    reactive_ids: &[bool],
) {
    if !env.has_stack() {
        return;
    }

    // Collect nested function IDs first to avoid borrow issues
    let nested_func_ids: Vec<FunctionId> = {
        let func = &env.functions[func_id.0 as usize];
        let mut ids = Vec::new();
        for (_block_id, block) in &func.body.blocks {
            for instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];
                match &instr.value {
                    InstructionValue::FunctionExpression { lowered_func, .. }
                    | InstructionValue::ObjectMethod { lowered_func, .. } => {
                        ids.push(lowered_func.func);
                    }
                    _ => {}
                }
            }
        }
        ids
    };

    // Apply reactive flags using canonical visitors
    let inner_func = &mut env.functions[func_id.0 as usize];
    for (_block_id, block) in inner_func.body.blocks.iter_mut() {
        for instr_id in &block.instructions {
            let instr = &mut inner_func.instructions[instr_id.0 as usize];
            visitors::for_each_instruction_value_operand_mut(&mut instr.value, &mut |place| {
                if reactive_ids[place.identifier.0 as usize] {
                    place.reactive = true;
                }
            });
        }
        visitors::for_each_terminal_operand_mut(&mut block.terminal, &mut |place| {
            if reactive_ids[place.identifier.0 as usize] {
                place.reactive = true;
            }
        });
    }

    // Recurse into nested functions, and set reactive on their context variables
    for nested_id in nested_func_ids {
        let nested_func = &mut env.functions[nested_id.0 as usize];
        for ctx in &mut nested_func.context {
            if reactive_ids[ctx.identifier.0 as usize] {
                ctx.reactive = true;
            }
        }
        apply_reactive_flags_to_inner_func(nested_id, env, reactive_ids);
    }
}
