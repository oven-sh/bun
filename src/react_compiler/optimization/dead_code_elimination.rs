// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Dead code elimination pass.
//!
//! Eliminates instructions whose values are unused, reducing generated code size.
//! Performs mark-and-sweep analysis to identify and remove dead code while
//! preserving side effects and program semantics.
//!
//! Ported from TypeScript `src/Optimization/DeadCodeElimination.ts`.
//! Caught throws: https://github.com/oxc-project/oxc (Copyright VoidZero Inc. and contributors, MIT License).

use crate::collections::{FxHashSet as HashSet, IdBitSet};

use crate::hir::environment::{Environment, OutputMode};
use crate::hir::object_shape::HookKind;
use crate::hir::visitors;
use crate::hir::{
    ArrayPatternElement, AstAlloc, BlockId, BlockKind, HirFunction, HirVec, IdentifierId,
    IdentifierName, Instruction, InstructionId, InstructionKind, InstructionValue,
    ObjectPropertyOrSpread, Pattern, Terminal,
};
use crate::optimization::prune_maybe_throws::value_may_throw;

/// Implements dead-code elimination, eliminating instructions whose values are unused.
///
/// Note that unreachable blocks are already pruned during HIR construction.
///
/// Corresponds to TS `deadCodeElimination(fn: HIRFunction): void`.
pub(crate) fn dead_code_elimination(func: &mut HirFunction, env: &Environment) {
    // Phase 1: Find/mark all referenced identifiers
    let state = find_referenced_identifiers(func, env, true);

    // Phase 2: Prune / sweep unreferenced identifiers and instructions
    let instructions = &mut func.instructions;
    for block in func.body.blocks.values_mut() {
        // Remove unused phi nodes
        block
            .phis
            .retain(|phi| is_id_or_name_used(&state, &env.identifiers, phi.place.identifier));

        // Remove instructions with unused lvalues
        let is_used = |instr_id: &InstructionId| {
            let instr = &instructions[instr_id.0 as usize];
            is_id_or_name_used(&state, &env.identifiers, instr.lvalue.identifier)
        };
        debug_assert!(state.has_unmarked_instruction || block.instructions.iter().all(is_used));
        if state.has_unmarked_instruction {
            block.instructions.retain(is_used);
        }

        // Rewrite the retained instructions (not the block value)
        let retained_count = block.instructions.len();
        for i in 0..retained_count {
            let instr = &mut instructions[block.instructions[i].0 as usize];
            let is_destructure = match &instr.value {
                InstructionValue::Destructure { .. } => true,
                InstructionValue::StoreLocal { .. } => false,
                // Nothing else is rewritten.
                _ => continue,
            };
            let is_block_value = block.kind != BlockKind::Block && i == retained_count - 1;
            // To read a property that nothing uses can throw as well.
            let is_caught_destructure = is_destructure && is_caught(&block.terminal);
            if !is_block_value && !is_caught_destructure {
                rewrite_instruction(instr, &state, env);
            }
        }
    }

    // Remove unused context variables
    func.context
        .retain(|ctx_var| is_id_or_name_used(&state, &env.identifiers, ctx_var.identifier));
}

/// State for tracking referenced identifiers during mark phase.
struct State {
    /// SSA-specific usages (by IdentifierId)
    identifiers: IdBitSet<IdentifierId>,
    /// Named variable usages (any version)
    named: HashSet<crate::hir::StoreStr>,
    /// Whether the last walk passed over an instruction without marking its lvalue.
    has_unmarked_instruction: bool,
}

impl State {
    fn new(env: &Environment) -> Self {
        State {
            identifiers: IdBitSet::with_ids(env.identifiers.len()),
            named: HashSet::default(),
            has_unmarked_instruction: false,
        }
    }

    fn count(&self) -> usize {
        self.identifiers.len()
    }
}

/// Mark an identifier as being referenced (not dead code).
#[inline]
fn reference(
    state: &mut State,
    identifiers: &[crate::hir::Identifier],
    identifier_id: IdentifierId,
) {
    // Its name went in with the first reference.
    if state.identifiers.insert(identifier_id) {
        if let Some(name) = &identifiers[identifier_id.0 as usize].name {
            reference_name(state, name);
        }
    }
}

#[inline(never)]
fn reference_name(state: &mut State, name: &IdentifierName) {
    state.named.insert(crate::hir::StoreStr::new(name.value()));
}

/// Check if any version of the given identifier is used somewhere.
/// Checks both the specific SSA id and (for named identifiers) any usage of that name.
#[inline]
fn is_id_or_name_used(
    state: &State,
    identifiers: &[crate::hir::Identifier],
    identifier_id: IdentifierId,
) -> bool {
    state.identifiers.contains(identifier_id)
        || (identifiers[identifier_id.0 as usize].name.as_ref())
            .is_some_and(|name| is_name_used(state, name))
}

#[inline(never)]
fn is_name_used(state: &State, name: &IdentifierName) -> bool {
    state.named.contains(name.value())
}

/// Check if this specific SSA id is used.
#[inline]
fn is_id_used(state: &State, identifier_id: IdentifierId) -> bool {
    state.identifiers.contains(identifier_id)
}

/// Mark the operands of an instruction, as TS `eachInstructionValueOperand` gives them.
fn reference_operands(state: &mut State, env: &Environment, value: &InstructionValue) {
    for place in visitors::operands(value, &env.functions) {
        reference(state, &env.identifiers, place.identifier);
    }
}

/// Keep the declaration of each variable that a retained reassignment assigns.
///
/// Not in upstream, which prunes a declaration once nothing reads the variable. A store
/// to such a variable can still be retained: as the last instruction of a non-`Block`
/// block (a catch handler, a `for..of` test), or for its own value (`f(v = 1)`).
/// `rewrite_instruction_kinds_based_on_reassignment` then makes the first store left
/// the declaration, in a scope that need not enclose the other stores.
fn reference_reassigned_variables(
    state: &mut State,
    identifiers: &[crate::hir::Identifier],
    value: &InstructionValue,
) {
    match value {
        InstructionValue::StoreLocal { lvalue, .. } if lvalue.kind == InstructionKind::Reassign => {
            reference(state, identifiers, lvalue.place.identifier);
        }
        InstructionValue::Destructure { lvalue, .. }
            if lvalue.kind == InstructionKind::Reassign =>
        {
            for place in visitors::pattern_operands(&lvalue.pattern) {
                reference(state, identifiers, place.identifier);
            }
        }
        _ => {}
    }
}

/// What throws in a block that ends so goes to a handler.
fn is_caught(terminal: &Terminal) -> bool {
    matches!(
        terminal,
        Terminal::MaybeThrow {
            handler: Some(_),
            ..
        }
    )
}

/// Phase 1: Find all referenced identifiers via fixed-point iteration.
/// `preserve_caught_throws`: upstream takes `try { props.a.b; } catch { return null; }` for nothing.
fn find_referenced_identifiers(
    func: &HirFunction,
    env: &Environment,
    preserve_caught_throws: bool,
) -> State {
    let has_loop = has_back_edge(func);
    let mut state = State::new(env);
    let mut size;

    loop {
        size = state.count();
        state.has_unmarked_instruction = false;

        // In reverse order (postorder - successors before predecessors)
        for block in func.body.blocks.values().rev() {
            // Mark terminal operands
            for place in visitors::terminal_operands(&block.terminal) {
                reference(&mut state, &env.identifiers, place.identifier);
            }

            // Process instructions in reverse order
            let instr_count = block.instructions.len();
            for i in (0..instr_count).rev() {
                let instr_id = block.instructions[i];
                let instr = &func.instructions[instr_id.0 as usize];

                let is_block_value = block.kind != BlockKind::Block && i == instr_count - 1;

                if is_block_value {
                    // Last instr of a value block is never eligible for pruning
                    reference(&mut state, &env.identifiers, instr.lvalue.identifier);
                    reference_operands(&mut state, env, &instr.value);
                    // Nor is it rewritten, so every variable it reassigns stays assigned.
                    reference_reassigned_variables(&mut state, &env.identifiers, &instr.value);
                } else if is_id_or_name_used(&state, &env.identifiers, instr.lvalue.identifier)
                    // That it throws can be seen, even where nothing uses what it gives.
                    || (preserve_caught_throws
                        && is_caught(&block.terminal)
                        && value_may_throw(&instr.value))
                    || !pruneable_value(&instr.value, &state, env)
                {
                    reference(&mut state, &env.identifiers, instr.lvalue.identifier);

                    if let InstructionValue::StoreLocal { lvalue, value, .. } = &instr.value {
                        // If this is a Let/Const declaration, mark the initializer as referenced
                        // only if the SSA'd lval is also referenced
                        if lvalue.kind == InstructionKind::Reassign
                            || is_id_used(&state, lvalue.place.identifier)
                        {
                            reference(&mut state, &env.identifiers, value.identifier);
                        }
                        // A Destructure is left to rewrite_instruction, which prunes the
                        // pattern entries that nothing reads.
                        reference_reassigned_variables(&mut state, &env.identifiers, &instr.value);
                    } else {
                        reference_operands(&mut state, env, &instr.value);
                        if preserve_caught_throws && is_caught(&block.terminal) {
                            // Such a Destructure is not rewritten.
                            reference_reassigned_variables(
                                &mut state,
                                &env.identifiers,
                                &instr.value,
                            );
                        }
                    }
                } else {
                    state.has_unmarked_instruction = true;
                }
            }

            // Mark phi operands if phi result is used
            for phi in &block.phis {
                if is_id_or_name_used(&state, &env.identifiers, phi.place.identifier) {
                    for (_pred, operand) in &phi.operands {
                        reference(&mut state, &env.identifiers, operand.identifier);
                    }
                }
            }
        }

        if !(state.count() > size && has_loop) {
            break;
        }
    }

    state
}

/// By id: kept only because a handler sees it throw. A scope's guard is outside the `try`: only the root is read there.
pub(crate) fn find_semantic_only_caught_instructions(
    func: &HirFunction,
    env: &Environment,
) -> Option<Vec<bool>> {
    let mut candidates = Vec::new();
    for block in func.body.blocks.values() {
        if is_caught(&block.terminal) {
            candidates.extend(
                block.instructions.iter().copied().filter(|instr_id| {
                    value_may_throw(&func.instructions[instr_id.0 as usize].value)
                }),
            );
        }
    }
    if candidates.is_empty() {
        return None;
    }

    let state = find_referenced_identifiers(func, env, false);
    let mut semantic_only = vec![false; func.instructions.len()];
    for instr_id in candidates {
        let lvalue = func.instructions[instr_id.0 as usize].lvalue.identifier;
        semantic_only[instr_id.0 as usize] = !is_id_or_name_used(&state, &env.identifiers, lvalue);
    }
    Some(semantic_only)
}

/// Rewrite a retained instruction (destructuring cleanup, StoreLocal -> DeclareLocal).
fn rewrite_instruction(instr: &mut Instruction, state: &State, env: &Environment) {
    match &mut instr.value {
        InstructionValue::Destructure { lvalue, .. } => {
            match &mut lvalue.pattern {
                Pattern::Array(arr) => {
                    // For arrays, replace unused items with holes, truncate trailing holes
                    let mut last_entry_index = 0;
                    for i in 0..arr.items.len() {
                        match &arr.items[i] {
                            ArrayPatternElement::Place(p) => {
                                if !is_id_or_name_used(state, &env.identifiers, p.identifier) {
                                    arr.items[i] = ArrayPatternElement::Hole;
                                } else {
                                    last_entry_index = i;
                                }
                            }
                            ArrayPatternElement::Spread(s) => {
                                if !is_id_or_name_used(state, &env.identifiers, s.place.identifier)
                                {
                                    arr.items[i] = ArrayPatternElement::Hole;
                                } else {
                                    last_entry_index = i;
                                }
                            }
                            ArrayPatternElement::Hole => {}
                        }
                    }
                    arr.items.truncate(last_entry_index + 1);
                }
                Pattern::Object(obj) => {
                    // For objects, prune unused properties if rest element is unused or absent
                    let mut next_properties: Option<HirVec<ObjectPropertyOrSpread>> = None;
                    for prop in &obj.properties {
                        match prop {
                            ObjectPropertyOrSpread::Property(p) => {
                                if is_id_or_name_used(state, &env.identifiers, p.place.identifier) {
                                    next_properties
                                        .get_or_insert_with(AstAlloc::vec)
                                        .push(prop.clone());
                                }
                            }
                            ObjectPropertyOrSpread::Spread(s) => {
                                if is_id_or_name_used(state, &env.identifiers, s.place.identifier) {
                                    // Rest element is used, can't prune anything
                                    next_properties = None;
                                    break;
                                }
                            }
                        }
                    }
                    if let Some(props) = next_properties {
                        obj.properties = props;
                    }
                }
            }
        }
        InstructionValue::StoreLocal {
            lvalue,
            type_annotation,
            loc,
            ..
        } => {
            if lvalue.kind != InstructionKind::Reassign
                && !is_id_used(state, lvalue.place.identifier)
            {
                // This is a const/let declaration where the variable is accessed later,
                // but where the value is always overwritten before being read.
                // Rewrite to DeclareLocal so the initializer value can be DCE'd.
                let new_lvalue = lvalue.clone();
                let new_type_annotation = type_annotation.clone();
                let new_loc = *loc;
                instr.value = InstructionValue::DeclareLocal {
                    lvalue: new_lvalue,
                    type_annotation: new_type_annotation,
                    loc: new_loc,
                };
            }
        }
        _ => {}
    }
}

/// Returns true if it is safe to prune an instruction with the given value.
fn pruneable_value(value: &InstructionValue, state: &State, env: &Environment) -> bool {
    match value {
        InstructionValue::DeclareLocal { lvalue, .. } => {
            // Declarations are pruneable only if the named variable is never read later
            !is_id_or_name_used(state, &env.identifiers, lvalue.place.identifier)
        }
        InstructionValue::StoreLocal { lvalue, .. } => {
            if lvalue.kind == InstructionKind::Reassign {
                // Reassignments can be pruned if the specific instance being assigned is never read
                !is_id_used(state, lvalue.place.identifier)
            } else {
                // Declarations are pruneable only if the named variable is never read later
                !is_id_or_name_used(state, &env.identifiers, lvalue.place.identifier)
            }
        }
        InstructionValue::Destructure { lvalue, .. } => {
            let mut is_id_or_name_used_flag = false;
            let mut is_id_used_flag = false;
            for place in visitors::pattern_operands(&lvalue.pattern) {
                if is_id_used(state, place.identifier) {
                    is_id_or_name_used_flag = true;
                    is_id_used_flag = true;
                } else if is_id_or_name_used(state, &env.identifiers, place.identifier) {
                    is_id_or_name_used_flag = true;
                }
            }
            if lvalue.kind == InstructionKind::Reassign {
                !is_id_used_flag
            } else {
                !is_id_or_name_used_flag
            }
        }
        InstructionValue::PostfixUpdate { lvalue, .. }
        | InstructionValue::PrefixUpdate { lvalue, .. } => {
            // Updates are pruneable if the specific instance being assigned is never read
            !is_id_used(state, lvalue.identifier)
        }
        InstructionValue::Debugger { .. } => {
            // explicitly retain debugger statements
            false
        }
        InstructionValue::CallExpression { callee, .. } => {
            if env.output_mode == OutputMode::Ssr {
                let callee_ty =
                    &env.types[env.identifiers[callee.identifier.0 as usize].type_.0 as usize];
                if let Some(hook_kind) = env.get_hook_kind_for_type(callee_ty).ok().flatten() {
                    match hook_kind {
                        HookKind::UseState | HookKind::UseReducer | HookKind::UseRef => {
                            return true;
                        }
                        _ => {}
                    }
                }
            }
            false
        }
        InstructionValue::MethodCall { property, .. } => {
            if env.output_mode == OutputMode::Ssr {
                let callee_ty =
                    &env.types[env.identifiers[property.identifier.0 as usize].type_.0 as usize];
                if let Some(hook_kind) = env.get_hook_kind_for_type(callee_ty).ok().flatten() {
                    match hook_kind {
                        HookKind::UseState | HookKind::UseReducer | HookKind::UseRef => {
                            return true;
                        }
                        _ => {}
                    }
                }
            }
            false
        }
        InstructionValue::Await { .. }
        | InstructionValue::ComputedDelete { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::PropertyDelete { .. }
        | InstructionValue::PropertyStore { .. }
        | InstructionValue::StoreGlobal { .. } => {
            // Mutating instructions are not safe to prune
            false
        }
        InstructionValue::NewExpression { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::TaggedTemplateExpression { .. } => {
            // Potentially safe to prune, but we conservatively keep them
            false
        }
        InstructionValue::GetIterator { .. }
        | InstructionValue::NextPropertyOf { .. }
        | InstructionValue::IteratorNext { .. } => {
            // Iterator operations are always used downstream
            false
        }
        InstructionValue::LoadContext { .. }
        | InstructionValue::DeclareContext { .. }
        | InstructionValue::StoreContext { .. } => false,
        InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. } => false,
        InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::ComputedLoad { .. }
        | InstructionValue::ObjectMethod { .. }
        | InstructionValue::FunctionExpression { .. }
        | InstructionValue::LoadLocal { .. }
        | InstructionValue::JsxExpression { .. }
        | InstructionValue::JsxFragment { .. }
        | InstructionValue::JSXText { .. }
        | InstructionValue::ObjectExpression { .. }
        | InstructionValue::Primitive { .. }
        | InstructionValue::PropertyLoad { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::TypeCastExpression { .. }
        | InstructionValue::UnaryExpression { .. } => {
            // Definitely safe to prune since they are read-only
            true
        }
    }
}

/// Check if the CFG has any back edges (indicating loops).
fn has_back_edge(func: &HirFunction) -> bool {
    let mut visited: IdBitSet<BlockId> = IdBitSet::default();
    for (block_id, block) in &func.body.blocks {
        for &pred_id in &block.preds {
            if !visited.contains(pred_id) {
                return true;
            }
        }
        visited.insert(*block_id);
    }
    false
}
