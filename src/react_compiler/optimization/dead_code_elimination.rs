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
    ArrayPatternElement, AstAlloc, BasicBlock, BlockId, BlockKind, HirFunction, HirVec,
    IdentifierId, IdentifierName, Instruction, InstructionId, InstructionKind, InstructionValue,
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
    let state = find_referenced_identifiers(func, env, Keeps::BlockValuesAndCaughtThrows);

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

/// What a walk marks though nothing reads it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Keeps {
    /// What dead code elimination keeps: the value of a block that is not a `Block`, as upstream, and what a
    /// handler sees throw. Upstream takes `try { props.a.b; } catch { return null; }` for nothing.
    BlockValuesAndCaughtThrows,
    BlockValues,
    Nothing,
}

/// Phase 1: Find all referenced identifiers via fixed-point iteration.
fn find_referenced_identifiers(func: &HirFunction, env: &Environment, keeps: Keeps) -> State {
    let preserve_caught_throws = keeps == Keeps::BlockValuesAndCaughtThrows;
    let preserve_block_values = keeps != Keeps::Nothing;
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

                let is_block_value =
                    preserve_block_values && block.kind != BlockKind::Block && i == instr_count - 1;

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

/// By id: what is kept while nothing reads what it gives. A scope's guard is outside the `try` or the function
/// that holds the instruction: only the root of each operand is read there.
/// - Kept because a handler sees it throw.
/// - `unread_reads`, not in upstream: a read of a property kept only as the value of its block (`el?.x;`,
///   `d && el?.x;`). Upstream leaves the dependency of a read to what reads it. Nothing reads this one, so the
///   function that holds it is made once, or again only when what the read gives is another value.
pub(crate) fn find_semantic_only_instructions(
    func: &HirFunction,
    env: &Environment,
    unread_reads: bool,
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
    if candidates.is_empty() && !unread_reads {
        return None;
    }

    let mut semantic_only = Vec::new();
    let mut has_unread_caught_throw = false;
    let kept = (!candidates.is_empty())
        .then(|| find_referenced_identifiers(func, env, Keeps::BlockValues));
    if let Some(kept) = &kept {
        semantic_only = vec![false; func.instructions.len()];
        for instr_id in candidates {
            let lvalue = func.instructions[instr_id.0 as usize].lvalue.identifier;
            let is_unread = !is_id_or_name_used(kept, &env.identifiers, lvalue);
            semantic_only[instr_id.0 as usize] = is_unread;
            has_unread_caught_throw |= is_unread;
        }
    }

    let can_keep_an_unread_read =
        unread_reads && can_keep_an_unread_read(func, env, has_unread_caught_throw);
    // A debug build always looks, and asserts what it finds.
    if can_keep_an_unread_read || (unread_reads && cfg!(debug_assertions)) {
        let read = find_referenced_identifiers(func, env, Keeps::Nothing);
        for block in func.body.blocks.values() {
            for instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];
                let given = instr.lvalue.identifier;
                if is_member_read(&instr.value)
                    && !is_id_or_name_used(&read, &env.identifiers, given)
                    // What only a caught throw keeps is a candidate, or what a candidate reads: as on main.
                    && (kept.as_ref())
                        .is_none_or(|it| is_id_or_name_used(it, &env.identifiers, given))
                {
                    debug_assert!(
                        can_keep_an_unread_read,
                        "an unread read behind no block value"
                    );
                    if semantic_only.is_empty() {
                        semantic_only = vec![false; func.instructions.len()];
                    }
                    semantic_only[instr_id.0 as usize] = true;
                }
            }
        }
    }
    (!semantic_only.is_empty()).then_some(semantic_only)
}

/// A read of a property, which can run a getter.
fn is_member_read(value: &InstructionValue) -> bool {
    matches!(
        value,
        InstructionValue::PropertyLoad { .. } | InstructionValue::ComputedLoad { .. }
    )
}

/// How many stores, phis or blocks `can_keep_an_unread_read` follows for one value. Then it takes the answer
/// that runs the walk.
const HOLDER_STEPS: u32 = 16;

/// The test before the second walk of `find_semantic_only_instructions`: false only where that walk marks no
/// read. A block that is not a `Block` keeps what it gives. That can be a read of a property, or be made of one,
/// and be unread.
fn can_keep_an_unread_read(
    func: &HirFunction,
    env: &Environment,
    has_unread_caught_throw: bool,
) -> bool {
    let mut has_read_holder = false;
    for block in func.body.blocks.values() {
        if block.kind == BlockKind::Block {
            continue;
        }
        let Some(last) = (block.instructions.last()).map(|id| &func.instructions[id.0 as usize])
        else {
            continue;
        };
        let given = match &last.value {
            // What was thrown.
            InstructionValue::StoreLocal { lvalue, .. }
                if lvalue.kind == InstructionKind::Catch =>
            {
                continue;
            }
            InstructionValue::StoreLocal { lvalue, .. } => lvalue.place.identifier,
            _ => last.lvalue.identifier,
        };
        if !holds_a_read(func, block, given, HOLDER_STEPS) {
            continue;
        }
        if !is_read_next(func, env, block, given) {
            return true;
        }
        has_read_holder = true;
    }
    // What reads a holder can be unread too: a read kept only for its throw, or in a loop the holder itself.
    has_read_holder && (has_unread_caught_throw || has_loop(func))
}

/// Whether `id`, at the end of `block`, can be a read of a property or be made of one. It follows what a store
/// or a phi gave: `d && el?.x` stores the phi of `el?.x`. Where it cannot follow, the answer is yes.
fn holds_a_read(func: &HirFunction, block: &BasicBlock, id: IdentifierId, steps: u32) -> bool {
    if steps == 0 {
        return true;
    }
    for instr_id in block.instructions.iter().rev() {
        let instr = &func.instructions[instr_id.0 as usize];
        let gives = instr.lvalue.identifier == id;
        if gives || visitors::value_lvalues(&instr.value).any(|place| place.identifier == id) {
            return match &instr.value {
                // An assignment gives what it stores. `d && f()` stores its `d`, which the branch reads.
                InstructionValue::StoreLocal { value, .. } => {
                    let is_value = |place: &crate::hir::Place| place.identifier == value.identifier;
                    let is_branched_on = block.preds.iter().any(|pred| {
                        (func.body.blocks.get(pred)).is_some_and(|pred| {
                            visitors::terminal_operands(&pred.terminal).any(is_value)
                        })
                    });
                    !is_branched_on && holds_a_read(func, block, value.identifier, steps - 1)
                }
                value => can_hold_a_read(value),
            };
        }
    }
    let before = |pred: &BlockId, id: IdentifierId| {
        (func.body.blocks.get(pred)).is_none_or(|pred| holds_a_read(func, pred, id, steps - 1))
    };
    match (block.phis.iter()).find(|phi| phi.place.identifier == id) {
        Some(phi) => (phi.operands.iter()).any(|(pred, place)| before(pred, place.identifier)),
        // One block before this one, so no phi: `d && (f(), el?.x)` stores what the block of the comma stored.
        None => match block.preds.len() {
            // A parameter or a captured variable.
            0 => false,
            1 => block.preds.iter().any(|pred| before(pred, id)),
            _ => true,
        },
    }
}

/// Whether what this instruction gives, or the variable that it assigns, can be a read of a property or be made
/// of one while nothing reads it.
fn can_hold_a_read(value: &InstructionValue) -> bool {
    match value {
        InstructionValue::PropertyLoad { .. } | InstructionValue::ComputedLoad { .. } => true,
        // These only make a value of their operands, or of the variable that they name.
        InstructionValue::UnaryExpression { .. }
        | InstructionValue::BinaryExpression { .. }
        | InstructionValue::TemplateLiteral { .. }
        | InstructionValue::TypeCastExpression { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::ObjectExpression { .. }
        | InstructionValue::JsxExpression { .. }
        | InstructionValue::JsxFragment { .. }
        | InstructionValue::LoadLocal { .. }
        | InstructionValue::StoreLocal { .. }
        | InstructionValue::Destructure { .. }
        | InstructionValue::PrefixUpdate { .. }
        | InstructionValue::PostfixUpdate { .. }
        | InstructionValue::FunctionExpression { .. }
        | InstructionValue::ObjectMethod { .. } => true,
        // These have no operand.
        InstructionValue::Primitive { .. }
        | InstructionValue::JSXText { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::LoadGlobal { .. }
        | InstructionValue::DeclareLocal { .. }
        | InstructionValue::DeclareContext { .. }
        | InstructionValue::Debugger { .. } => false,
        // `pruneable_value` keeps these in client output, so what they read is read.
        InstructionValue::CallExpression { .. }
        | InstructionValue::MethodCall { .. }
        | InstructionValue::NewExpression { .. }
        | InstructionValue::TaggedTemplateExpression { .. }
        | InstructionValue::Await { .. }
        | InstructionValue::PropertyStore { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::PropertyDelete { .. }
        | InstructionValue::ComputedDelete { .. }
        | InstructionValue::StoreGlobal { .. }
        | InstructionValue::LoadContext { .. }
        | InstructionValue::StoreContext { .. }
        | InstructionValue::GetIterator { .. }
        | InstructionValue::IteratorNext { .. }
        | InstructionValue::NextPropertyOf { .. }
        | InstructionValue::StartMemoize { .. }
        | InstructionValue::FinishMemoize { .. }
        | InstructionValue::UnsupportedNode { .. } => false,
    }
}

/// Whether the terminal of `block`, a block that it goes to, or a block where the code goes on behind it names
/// `id`, which the last instruction of `block` gives. That is where the value of a block is read.
fn is_read_next(
    func: &HirFunction,
    env: &Environment,
    block: &BasicBlock,
    id: IdentifierId,
) -> bool {
    let is_id = |place: &crate::hir::Place| place.identifier == id;
    let names = |block: &BasicBlock| {
        (block.phis.iter()).any(|phi| phi.operands.values().any(is_id))
            || block.instructions.iter().any(|instr_id| {
                let value = &func.instructions[instr_id.0 as usize].value;
                visitors::operands(value, &env.functions).any(is_id)
            })
            || visitors::terminal_operands(&block.terminal).any(is_id)
    };
    if visitors::terminal_operands(&block.terminal).any(is_id)
        || (visitors::each_terminal_successor(&block.terminal).into_iter())
            .any(|next| func.body.blocks.get(&next).is_some_and(names))
    {
        return true;
    }
    let mut at = block;
    for _ in 0..HOLDER_STEPS {
        let next = match &at.terminal {
            Terminal::Goto { block, .. } => Some(*block),
            Terminal::MaybeThrow { continuation, .. } => Some(*continuation),
            terminal => visitors::terminal_fallthrough(terminal),
        };
        let Some(next) = next.and_then(|next| func.body.blocks.get(&next)) else {
            return false;
        };
        if names(next) {
            return true;
        }
        at = next;
    }
    false
}

/// A value that only its own loop reads is unread.
fn has_loop(func: &HirFunction) -> bool {
    func.body.blocks.values().any(|block| {
        matches!(
            block.terminal,
            Terminal::DoWhile { .. }
                | Terminal::While { .. }
                | Terminal::For { .. }
                | Terminal::ForOf { .. }
                | Terminal::ForIn { .. }
        )
    })
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
