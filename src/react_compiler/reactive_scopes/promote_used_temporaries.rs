// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! PromoteUsedTemporaries — promotes temporary variables to named variables
//! if they're used by scopes.
//!
//! Corresponds to `src/ReactiveScopes/PromoteUsedTemporaries.ts`.

use std::collections::HashSet;

use crate::collections::IdMap;
use crate::hir::ArrayElement;
use crate::hir::DeclarationId;
use crate::hir::FunctionId;
use crate::hir::IdentifierId;
use crate::hir::IdentifierName;
use crate::hir::InstructionKind;
use crate::hir::InstructionValue;
use crate::hir::JsxAttribute;
use crate::hir::JsxTag;
use crate::hir::ObjectPropertyOrSpread;
use crate::hir::ParamPattern;
use crate::hir::Place;
use crate::hir::ReactiveBlock;
use crate::hir::ReactiveFunction;
use crate::hir::ReactiveInstruction;
use crate::hir::ReactiveStatement;
use crate::hir::ReactiveTerminal;
use crate::hir::ReactiveTerminalStatement;
use crate::hir::ReactiveValue;
use crate::hir::ScopeId;
use crate::hir::environment::Environment;
use crate::hir::is_primitive_type;

// =============================================================================
// State
// =============================================================================

struct State {
    tags: HashSet<DeclarationId>,
    promoted: HashSet<DeclarationId>,
    pruned: IdMap<DeclarationId, PrunedInfo>,
}

struct PrunedInfo {
    active_scopes: Vec<ScopeId>,
    used_outside_scope: bool,
}

// =============================================================================
// Public entry point
// =============================================================================

/// Promotes temporary (unnamed) identifiers used in scopes to named identifiers.
/// TS: `promoteUsedTemporaries`
pub(crate) fn promote_used_temporaries(
    func: &mut ReactiveFunction,
    env: &mut Environment,
    inline_macro_operands: &HashSet<IdentifierId>,
) {
    let mut state = State {
        tags: HashSet::new(),
        promoted: HashSet::new(),
        pruned: IdMap::new(),
    };

    // Phase 1: collect promotable temporaries (jsx tags, pruned scope usage)
    let mut active_scopes: Vec<ScopeId> = Vec::new();
    collect_promotable_block(&func.body, &mut state, &mut active_scopes, env);

    // Promote params
    for param in &func.params {
        let place = param.place();
        let identifier = &env.identifiers[place.identifier.0 as usize];
        if identifier.name.is_none() {
            promote_identifier(place.identifier, &mut state, env);
        }
    }

    // Phase 2: promote identifiers used in scopes
    promote_temporaries_block(&func.body, &mut state, env);

    // Phase 3: promote interposed temporaries
    let mut consts: HashSet<IdentifierId> = HashSet::new();
    let mut globals: HashSet<IdentifierId> = HashSet::new();
    for param in &func.params {
        match param {
            ParamPattern::Place(p) => {
                consts.insert(p.identifier);
            }
            ParamPattern::Spread(s) => {
                consts.insert(s.place.identifier);
            }
        }
    }
    let mut inter_state = InterState::new(inline_macro_operands);
    promote_interposed_block(
        &func.body,
        &mut state,
        &mut inter_state,
        &mut consts,
        &mut globals,
        env,
    );

    // Phase 4: promote all instances of promoted declaration IDs
    promote_all_instances_params(func, &mut state, env);
    promote_all_instances_block(&func.body, &mut state, env);
}

// =============================================================================
// Phase 1: CollectPromotableTemporaries
// =============================================================================

fn collect_promotable_block(
    block: &ReactiveBlock,
    state: &mut State,
    active_scopes: &mut Vec<ScopeId>,
    env: &Environment,
) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instr) => {
                collect_promotable_instruction(instr, state, active_scopes, env);
            }
            ReactiveStatement::Scope(scope) => {
                let scope_id = scope.scope;
                active_scopes.push(scope_id);
                collect_promotable_block(&scope.instructions, state, active_scopes, env);
                active_scopes.pop();
            }
            ReactiveStatement::PrunedScope(scope) => {
                let scope_data = &env.scopes[scope.scope.0 as usize];
                for (_id, decl) in &scope_data.declarations {
                    let identifier = &env.identifiers[decl.identifier.0 as usize];
                    state.pruned.insert(
                        identifier.declaration_id,
                        PrunedInfo {
                            active_scopes: active_scopes.clone(),
                            used_outside_scope: false,
                        },
                    );
                }
                collect_promotable_block(&scope.instructions, state, active_scopes, env);
            }
            ReactiveStatement::Terminal(terminal) => {
                collect_promotable_terminal(terminal, state, active_scopes, env);
            }
        }
    }
}

fn collect_promotable_place(
    place: &Place,
    state: &mut State,
    active_scopes: &[ScopeId],
    env: &Environment,
) {
    if !active_scopes.is_empty() {
        let identifier = &env.identifiers[place.identifier.0 as usize];
        if let Some(pruned) = state.pruned.get_mut(identifier.declaration_id) {
            if let Some(last) = active_scopes.last() {
                if !pruned.active_scopes.contains(last) {
                    pruned.used_outside_scope = true;
                }
            }
        }
    }
}

fn collect_promotable_instruction(
    instr: &ReactiveInstruction,
    state: &mut State,
    active_scopes: &mut Vec<ScopeId>,
    env: &Environment,
) {
    collect_promotable_value(&instr.value, state, active_scopes, env);
}

fn collect_promotable_value(
    value: &ReactiveValue,
    state: &mut State,
    active_scopes: &mut Vec<ScopeId>,
    env: &Environment,
) {
    match value {
        ReactiveValue::Instruction(instr_value) => {
            // Visit operands
            for place in crate::hir::visitors::each_instruction_value_operand(instr_value, env) {
                collect_promotable_place(&place, state, active_scopes, env);
            }
            // Check for JSX tag
            if let InstructionValue::JsxExpression {
                tag: JsxTag::Place(place),
                ..
            } = instr_value
            {
                let identifier = &env.identifiers[place.identifier.0 as usize];
                state.tags.insert(identifier.declaration_id);
            }
        }
        ReactiveValue::SequenceExpression {
            instructions,
            value: inner,
            ..
        } => {
            for instr in instructions {
                collect_promotable_instruction(instr, state, active_scopes, env);
            }
            collect_promotable_value(inner, state, active_scopes, env);
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            collect_promotable_value(test, state, active_scopes, env);
            collect_promotable_value(consequent, state, active_scopes, env);
            collect_promotable_value(alternate, state, active_scopes, env);
        }
        ReactiveValue::LogicalExpression { left, right, .. } => {
            collect_promotable_value(left, state, active_scopes, env);
            collect_promotable_value(right, state, active_scopes, env);
        }
        ReactiveValue::OptionalExpression { value: inner, .. } => {
            collect_promotable_value(inner, state, active_scopes, env);
        }
    }
}

fn collect_promotable_terminal(
    stmt: &ReactiveTerminalStatement,
    state: &mut State,
    active_scopes: &mut Vec<ScopeId>,
    env: &Environment,
) {
    match &stmt.terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            collect_promotable_place(value, state, active_scopes, env);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_block,
            ..
        } => {
            collect_promotable_value(init, state, active_scopes, env);
            collect_promotable_value(test, state, active_scopes, env);
            collect_promotable_block(loop_block, state, active_scopes, env);
            if let Some(update) = update {
                collect_promotable_value(update, state, active_scopes, env);
            }
        }
        ReactiveTerminal::ForOf {
            init,
            test,
            loop_block,
            ..
        } => {
            collect_promotable_value(init, state, active_scopes, env);
            collect_promotable_value(test, state, active_scopes, env);
            collect_promotable_block(loop_block, state, active_scopes, env);
        }
        ReactiveTerminal::ForIn {
            init, loop_block, ..
        } => {
            collect_promotable_value(init, state, active_scopes, env);
            collect_promotable_block(loop_block, state, active_scopes, env);
        }
        ReactiveTerminal::DoWhile {
            loop_block, test, ..
        } => {
            collect_promotable_block(loop_block, state, active_scopes, env);
            collect_promotable_value(test, state, active_scopes, env);
        }
        ReactiveTerminal::While {
            test, loop_block, ..
        } => {
            collect_promotable_value(test, state, active_scopes, env);
            collect_promotable_block(loop_block, state, active_scopes, env);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            collect_promotable_place(test, state, active_scopes, env);
            collect_promotable_block(consequent, state, active_scopes, env);
            if let Some(alt) = alternate {
                collect_promotable_block(alt, state, active_scopes, env);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            collect_promotable_place(test, state, active_scopes, env);
            for case in cases {
                if let Some(t) = &case.test {
                    collect_promotable_place(t, state, active_scopes, env);
                }
                if let Some(block) = &case.block {
                    collect_promotable_block(block, state, active_scopes, env);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => {
            collect_promotable_block(block, state, active_scopes, env);
        }
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            collect_promotable_block(block, state, active_scopes, env);
            if let Some(binding) = handler_binding {
                collect_promotable_place(binding, state, active_scopes, env);
            }
            collect_promotable_block(handler, state, active_scopes, env);
        }
    }
}

// =============================================================================
// Phase 2: PromoteTemporaries
// =============================================================================

fn promote_temporaries_block(block: &ReactiveBlock, state: &mut State, env: &mut Environment) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instr) => {
                promote_temporaries_value(&instr.value, state, env);
            }
            ReactiveStatement::Scope(scope) => {
                let scope_id = scope.scope;
                let scope_data = &env.scopes[scope_id.0 as usize];
                // Collect all IDs to promote first
                let mut ids_to_check: Vec<IdentifierId> = Vec::new();
                ids_to_check.extend(scope_data.dependencies.iter().map(|d| d.identifier));
                ids_to_check.extend(scope_data.declarations.iter().map(|(_, d)| d.identifier));
                for id in ids_to_check {
                    let identifier = &env.identifiers[id.0 as usize];
                    if identifier.name.is_none() {
                        promote_identifier(id, state, env);
                    }
                }
                promote_temporaries_block(&scope.instructions, state, env);
            }
            ReactiveStatement::PrunedScope(scope) => {
                let scope_id = scope.scope;
                let scope_data = &env.scopes[scope_id.0 as usize];
                let decls: Vec<(IdentifierId, DeclarationId)> = scope_data
                    .declarations
                    .iter()
                    .map(|(_, d)| {
                        let identifier = &env.identifiers[d.identifier.0 as usize];
                        (d.identifier, identifier.declaration_id)
                    })
                    .collect();
                for (id, decl_id) in decls {
                    let identifier = &env.identifiers[id.0 as usize];
                    if identifier.name.is_none() {
                        if let Some(pruned) = state.pruned.get(decl_id) {
                            if pruned.used_outside_scope {
                                promote_identifier(id, state, env);
                            }
                        }
                    }
                }
                promote_temporaries_block(&scope.instructions, state, env);
            }
            ReactiveStatement::Terminal(terminal) => {
                promote_temporaries_terminal(terminal, state, env);
            }
        }
    }
}

fn promote_temporaries_value(value: &ReactiveValue, state: &mut State, env: &mut Environment) {
    match value {
        ReactiveValue::Instruction(instr_value) => {
            // Visit inner functions: promote params and recurse into nested functions
            // TS: visitHirFunction(value.loweredFunc.func, state)
            match instr_value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    visit_hir_function_for_promotion(lowered_func.func, state, env);
                }
                _ => {}
            }
        }
        ReactiveValue::SequenceExpression {
            instructions,
            value: inner,
            ..
        } => {
            for instr in instructions {
                promote_temporaries_value(&instr.value, state, env);
            }
            promote_temporaries_value(inner, state, env);
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            promote_temporaries_value(test, state, env);
            promote_temporaries_value(consequent, state, env);
            promote_temporaries_value(alternate, state, env);
        }
        ReactiveValue::LogicalExpression { left, right, .. } => {
            promote_temporaries_value(left, state, env);
            promote_temporaries_value(right, state, env);
        }
        ReactiveValue::OptionalExpression { value: inner, .. } => {
            promote_temporaries_value(inner, state, env);
        }
    }
}

fn promote_temporaries_terminal(
    stmt: &ReactiveTerminalStatement,
    state: &mut State,
    env: &mut Environment,
) {
    match &stmt.terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { .. } | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_block,
            ..
        } => {
            promote_temporaries_value(init, state, env);
            promote_temporaries_value(test, state, env);
            promote_temporaries_block(loop_block, state, env);
            if let Some(update) = update {
                promote_temporaries_value(update, state, env);
            }
        }
        ReactiveTerminal::ForOf {
            init,
            test,
            loop_block,
            ..
        } => {
            promote_temporaries_value(init, state, env);
            promote_temporaries_value(test, state, env);
            promote_temporaries_block(loop_block, state, env);
        }
        ReactiveTerminal::ForIn {
            init, loop_block, ..
        } => {
            promote_temporaries_value(init, state, env);
            promote_temporaries_block(loop_block, state, env);
        }
        ReactiveTerminal::DoWhile {
            loop_block, test, ..
        } => {
            promote_temporaries_block(loop_block, state, env);
            promote_temporaries_value(test, state, env);
        }
        ReactiveTerminal::While {
            test, loop_block, ..
        } => {
            promote_temporaries_value(test, state, env);
            promote_temporaries_block(loop_block, state, env);
        }
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            promote_temporaries_block(consequent, state, env);
            if let Some(alt) = alternate {
                promote_temporaries_block(alt, state, env);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &case.block {
                    promote_temporaries_block(block, state, env);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => {
            promote_temporaries_block(block, state, env);
        }
        ReactiveTerminal::Try { block, handler, .. } => {
            promote_temporaries_block(block, state, env);
            promote_temporaries_block(handler, state, env);
        }
    }
}

// =============================================================================
// Helper: visit inner HIR function for promotion (mirrors TS visitHirFunction)
// =============================================================================

/// Promotes params and recursively visits nested functions for param promotion.
/// Specialized version of the TS `visitHirFunction` pattern for the PromoteTemporaries
/// phase — only promotes unnamed params and recurses into nested functions.
/// Other `visitHirFunction` behaviors (visitPlace on terminal operands, visitInstruction
/// on all instructions) are no-ops for this phase and are intentionally omitted.
fn visit_hir_function_for_promotion(func_id: FunctionId, state: &mut State, env: &mut Environment) {
    // Promote params of this function
    let param_ids: Vec<IdentifierId> = {
        let func = &env.functions[func_id.0 as usize];
        func.params
            .iter()
            .map(|param| param.place().identifier)
            .collect()
    };
    for id in param_ids {
        let identifier = &env.identifiers[id.0 as usize];
        if identifier.name.is_none() {
            promote_identifier(id, state, env);
        }
    }

    // Find nested FunctionExpression/ObjectMethod in body instructions
    let nested_func_ids: Vec<FunctionId> = {
        let func = &env.functions[func_id.0 as usize];
        let mut nested = Vec::new();
        for (_, block) in &func.body.blocks {
            for &instr_id in &block.instructions {
                let instr = &func.instructions[instr_id.0 as usize];
                match &instr.value {
                    InstructionValue::FunctionExpression { lowered_func, .. }
                    | InstructionValue::ObjectMethod { lowered_func, .. } => {
                        nested.push(lowered_func.func);
                    }
                    _ => {}
                }
            }
        }
        nested
    };
    for nested_id in nested_func_ids {
        visit_hir_function_for_promotion(nested_id, state, env);
    }
}

// =============================================================================
// Phase 3: PromoteInterposedTemporaries
// =============================================================================

/// Two evaluations conflict when one writes state and the other reads or writes it.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Effect {
    None,
    Read,
    Write,
}

#[derive(Clone, Copy)]
struct Temporary {
    position: u32,
    effect: Effect,
}

/// Positions of the last statement that reads and of the last statement that writes.
#[derive(Clone, Copy, Default)]
struct Statements {
    read: u32,
    write: u32,
}

/// Not in upstream: a use promotes a temporary when a statement after its definition conflicts.
struct InterState<'a> {
    /// By declaration, as in codegen: a value block result has another identifier at its use.
    temporaries: IdMap<DeclarationId, Temporary>,
    position: u32,
    statements: Statements,
    /// Statements that print in place inside the value block being visited. They count only there.
    value_block_statements: Option<Statements>,
    /// fbt wants these inside the macro call: they stay inline and their operands get the names.
    inline_macro_operands: &'a HashSet<IdentifierId>,
    operands_of_macro_operands: IdMap<DeclarationId, Vec<Place>>,
}

impl<'a> InterState<'a> {
    fn new(inline_macro_operands: &'a HashSet<IdentifierId>) -> Self {
        InterState {
            temporaries: IdMap::new(),
            position: 0,
            statements: Statements::default(),
            value_block_statements: None,
            inline_macro_operands,
            operands_of_macro_operands: IdMap::new(),
        }
    }

    fn temporary(&mut self, id: DeclarationId, effect: Effect) {
        self.position += 1;
        self.temporaries.insert(
            id,
            Temporary {
                position: self.position,
                effect,
            },
        );
    }

    fn statement(&mut self, effect: Effect) {
        self.position += 1;
        let statements = self
            .value_block_statements
            .as_mut()
            .unwrap_or(&mut self.statements);
        match effect {
            Effect::None => {}
            Effect::Read => statements.read = self.position,
            Effect::Write => statements.write = self.position,
        }
    }

    fn promoted(&mut self, temporary: Temporary) {
        let statements = &mut self.statements;
        match temporary.effect {
            Effect::None => {}
            Effect::Read => statements.read = statements.read.max(temporary.position),
            Effect::Write => statements.write = statements.write.max(temporary.position),
        }
    }

    fn conflicts(&self, temporary: Temporary) -> bool {
        let in_value_block = self.value_block_statements.unwrap_or_default();
        let read = self.statements.read.max(in_value_block.read);
        let write = self.statements.write.max(in_value_block.write);
        match temporary.effect {
            Effect::None => false,
            Effect::Read => write > temporary.position,
            Effect::Write => read.max(write) > temporary.position,
        }
    }

    fn enter_value_block(&mut self) -> Option<Statements> {
        let outer = self.value_block_statements;
        self.value_block_statements = Some(outer.unwrap_or_default());
        outer
    }

    fn exit_value_block(&mut self, outer: Option<Statements>) {
        self.value_block_statements = outer;
    }
}

fn promote_interposed_block(
    block: &ReactiveBlock,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &mut HashSet<IdentifierId>,
    globals: &mut HashSet<IdentifierId>,
    env: &mut Environment,
) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instr) => {
                promote_interposed_instruction(instr, state, inter_state, consts, globals, env);
            }
            ReactiveStatement::Scope(scope) => {
                // The memo block compares its dependencies before anything inside it runs.
                let dependencies = &env.scopes[scope.scope.0 as usize].dependencies;
                if dependencies.iter().any(|dependency| {
                    !dependency.path.is_empty()
                        || is_reassignable(dependency.identifier, consts, env)
                }) {
                    inter_state.statement(Effect::Read);
                }
                promote_interposed_block(
                    &scope.instructions,
                    state,
                    inter_state,
                    consts,
                    globals,
                    env,
                );
            }
            ReactiveStatement::PrunedScope(scope) => {
                promote_interposed_block(
                    &scope.instructions,
                    state,
                    inter_state,
                    consts,
                    globals,
                    env,
                );
            }
            ReactiveStatement::Terminal(terminal) => {
                promote_interposed_terminal(terminal, state, inter_state, consts, globals, env);
            }
        }
    }
}

/// The temporary that prints in place of `place`, if it has no name yet.
fn inline_temporary(
    place: &Place,
    state: &State,
    inter_state: &InterState<'_>,
    env: &Environment,
) -> Option<Temporary> {
    let identifier = &env.identifiers[place.identifier.0 as usize];
    if identifier.name.is_some() || state.promoted.contains(&identifier.declaration_id) {
        return None;
    }
    inter_state
        .temporaries
        .get(identifier.declaration_id)
        .copied()
}

/// Returns the effect that the place adds to the expression that uses it.
fn promote_interposed_place(
    place: &Place,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &HashSet<IdentifierId>,
    env: &mut Environment,
) -> Effect {
    let Some(temporary) = inline_temporary(place, state, inter_state, env) else {
        return Effect::None;
    };
    if !inter_state.conflicts(temporary) || consts.contains(&place.identifier) {
        return temporary.effect;
    }
    if inter_state
        .inline_macro_operands
        .contains(&place.identifier)
    {
        let declaration_id = env.identifiers[place.identifier.0 as usize].declaration_id;
        if let Some(operands) = inter_state
            .operands_of_macro_operands
            .swap_remove(declaration_id)
        {
            promote_interposed_operands(operands, state, inter_state, consts, env);
        }
        return temporary.effect;
    }
    promote_identifier(place.identifier, state, env);
    inter_state.promoted(temporary);
    Effect::None
}

/// Last defined first: a promoted operand becomes a statement ahead of the earlier operands.
fn promote_interposed_operands(
    mut operands: Vec<Place>,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &HashSet<IdentifierId>,
    env: &mut Environment,
) -> Effect {
    operands.sort_by_key(|place| {
        let declaration_id = env.identifiers[place.identifier.0 as usize].declaration_id;
        std::cmp::Reverse(
            inter_state
                .temporaries
                .get(declaration_id)
                .map(|temporary| temporary.position),
        )
    });
    let mut effect = Effect::None;
    for place in &operands {
        effect = effect.max(promote_interposed_place(
            place,
            state,
            inter_state,
            consts,
            env,
        ));
    }
    effect
}

/// A const cannot change between being loaded and being used.
fn is_reassignable(id: IdentifierId, consts: &HashSet<IdentifierId>, env: &Environment) -> bool {
    let identifier = &env.identifiers[id.0 as usize];
    matches!(identifier.name, Some(IdentifierName::Named(_))) && !consts.contains(&id)
}

/// The effect of the instruction itself, without the operands that print inside it.
fn instruction_effect(
    iv: &InstructionValue,
    operands: &[Place],
    consts: &HashSet<IdentifierId>,
    globals: &HashSet<IdentifierId>,
    env: &Environment,
) -> Effect {
    match iv {
        InstructionValue::CallExpression { .. }
        | InstructionValue::MethodCall { .. }
        | InstructionValue::NewExpression { .. }
        | InstructionValue::TaggedTemplateExpression { .. }
        | InstructionValue::Await { .. }
        | InstructionValue::GetIterator { .. }
        | InstructionValue::IteratorNext { .. }
        | InstructionValue::NextPropertyOf { .. }
        | InstructionValue::PropertyStore { .. }
        | InstructionValue::PropertyDelete { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::ComputedDelete { .. }
        | InstructionValue::PostfixUpdate { .. }
        | InstructionValue::PrefixUpdate { .. }
        | InstructionValue::StoreGlobal { .. }
        // An array pattern runs an iterator, and an object pattern can run a getter.
        | InstructionValue::Destructure { .. } => Effect::Write,
        // A declaration writes a variable that nothing before it can read.
        InstructionValue::StoreLocal { lvalue, .. }
        | InstructionValue::StoreContext { lvalue, .. } => {
            if lvalue.kind == InstructionKind::Reassign {
                Effect::Write
            } else {
                Effect::None
            }
        }
        InstructionValue::LoadLocal { place, .. } | InstructionValue::LoadContext { place, .. } => {
            if is_reassignable(place.identifier, consts, env) {
                Effect::Read
            } else {
                Effect::None
            }
        }
        InstructionValue::PropertyLoad { object, .. }
        | InstructionValue::ComputedLoad { object, .. } => {
            if globals.contains(&object.identifier) {
                Effect::None
            } else {
                Effect::Read
            }
        }
        // An operator converts an operand that is an object, and `in` looks into one.
        InstructionValue::BinaryExpression { .. }
        | InstructionValue::UnaryExpression { .. }
        | InstructionValue::TemplateLiteral { .. }
            if operands.iter().any(|operand| {
                let identifier = &env.identifiers[operand.identifier.0 as usize];
                !is_primitive_type(&env.types[identifier.type_.0 as usize])
            }) =>
        {
            Effect::Read
        }
        InstructionValue::ArrayExpression { elements, .. }
            if elements
                .iter()
                .any(|element| matches!(element, ArrayElement::Spread(_))) =>
        {
            Effect::Read
        }
        InstructionValue::ObjectExpression { properties, .. }
            if properties
                .iter()
                .any(|property| matches!(property, ObjectPropertyOrSpread::Spread(_))) =>
        {
            Effect::Read
        }
        InstructionValue::JsxExpression { props, .. }
            if props
                .iter()
                .any(|prop| matches!(prop, JsxAttribute::SpreadAttribute { .. })) =>
        {
            Effect::Read
        }
        _ => Effect::None,
    }
}

/// Returns the effect of the expression that the instruction prints as.
fn promote_interposed_instruction(
    instr: &ReactiveInstruction,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &mut HashSet<IdentifierId>,
    globals: &mut HashSet<IdentifierId>,
    env: &mut Environment,
) -> Effect {
    let effect = match &instr.value {
        // Codegen prints nothing for these, so they do not evaluate their operands.
        ReactiveValue::Instruction(
            InstructionValue::StartMemoize { .. } | InstructionValue::FinishMemoize { .. },
        ) => return Effect::None,
        ReactiveValue::Instruction(iv) => {
            match iv {
                InstructionValue::StoreContext { lvalue, .. }
                | InstructionValue::StoreLocal { lvalue, .. }
                | InstructionValue::DeclareContext { lvalue, .. }
                | InstructionValue::DeclareLocal { lvalue, .. } => {
                    if lvalue.kind == InstructionKind::Const
                        || lvalue.kind == InstructionKind::HoistedConst
                    {
                        consts.insert(lvalue.place.identifier);
                    }
                }
                InstructionValue::Destructure { lvalue, .. } => {
                    if lvalue.kind == InstructionKind::Const
                        || lvalue.kind == InstructionKind::HoistedConst
                    {
                        for operand in crate::hir::visitors::each_pattern_operand(&lvalue.pattern) {
                            consts.insert(operand.identifier);
                        }
                    }
                }
                InstructionValue::MethodCall { property, .. } => {
                    // Treat property of method call as constlike so we don't promote it.
                    consts.insert(property.identifier);
                }
                InstructionValue::PropertyLoad { object, .. }
                | InstructionValue::ComputedLoad { object, .. } => {
                    if let Some(lvalue) = &instr.lvalue {
                        if globals.contains(&object.identifier) {
                            globals.insert(lvalue.identifier);
                        }
                    }
                }
                InstructionValue::LoadGlobal { .. } => {
                    if let Some(lvalue) = &instr.lvalue {
                        globals.insert(lvalue.identifier);
                    }
                }
                _ => {}
            }
            promote_interposed_value(&instr.value, state, inter_state, consts, globals, env)
        }
        _ => {
            let outer = inter_state.enter_value_block();
            let effect =
                promote_interposed_value(&instr.value, state, inter_state, consts, globals, env);
            inter_state.exit_value_block(outer);
            effect
        }
    };
    let temporary = instr.lvalue.as_ref().and_then(|lvalue| {
        let identifier = &env.identifiers[lvalue.identifier.0 as usize];
        (identifier.name.is_none() && !state.promoted.contains(&identifier.declaration_id))
            .then_some(identifier.declaration_id)
    });
    match temporary {
        Some(declaration_id) => {
            if let (Some(lvalue), ReactiveValue::Instruction(iv)) = (&instr.lvalue, &instr.value)
                && inter_state
                    .inline_macro_operands
                    .contains(&lvalue.identifier)
            {
                inter_state.operands_of_macro_operands.insert(
                    declaration_id,
                    crate::hir::visitors::each_instruction_value_operand(iv, env),
                );
            }
            inter_state.temporary(declaration_id, effect);
        }
        // With no lvalue, or a named one, codegen emits this instruction as a statement.
        _ => inter_state.statement(effect),
    }
    effect
}

/// Returns the effect of the expression that the value prints as.
fn promote_interposed_value(
    value: &ReactiveValue,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &mut HashSet<IdentifierId>,
    globals: &mut HashSet<IdentifierId>,
    env: &mut Environment,
) -> Effect {
    match value {
        ReactiveValue::Instruction(iv) => {
            let operands = crate::hir::visitors::each_instruction_value_operand(iv, env);
            instruction_effect(iv, &operands, consts, globals, env).max(
                promote_interposed_operands(operands, state, inter_state, consts, env),
            )
        }
        ReactiveValue::SequenceExpression {
            instructions,
            value: inner,
            ..
        } => {
            let mut effect = Effect::None;
            for instr in instructions {
                effect = effect.max(promote_interposed_instruction(
                    instr,
                    state,
                    inter_state,
                    consts,
                    globals,
                    env,
                ));
            }
            effect.max(promote_interposed_value(
                inner,
                state,
                inter_state,
                consts,
                globals,
                env,
            ))
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            let test = promote_interposed_value(test, state, inter_state, consts, globals, env);
            let consequent =
                promote_interposed_value(consequent, state, inter_state, consts, globals, env);
            let alternate =
                promote_interposed_value(alternate, state, inter_state, consts, globals, env);
            test.max(consequent).max(alternate)
        }
        ReactiveValue::LogicalExpression { left, right, .. } => {
            let left = promote_interposed_value(left, state, inter_state, consts, globals, env);
            let right = promote_interposed_value(right, state, inter_state, consts, globals, env);
            left.max(right)
        }
        ReactiveValue::OptionalExpression { value: inner, .. } => {
            promote_interposed_value(inner, state, inter_state, consts, globals, env)
        }
    }
}

/// The value of a terminal prints as part of the statement of that terminal.
fn promote_interposed_terminal_value(
    value: &ReactiveValue,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &mut HashSet<IdentifierId>,
    globals: &mut HashSet<IdentifierId>,
    env: &mut Environment,
) {
    let outer = inter_state.enter_value_block();
    let effect = promote_interposed_value(value, state, inter_state, consts, globals, env);
    inter_state.exit_value_block(outer);
    inter_state.statement(effect);
}

fn promote_interposed_terminal_place(
    place: &Place,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &HashSet<IdentifierId>,
    env: &mut Environment,
) {
    let effect = promote_interposed_place(place, state, inter_state, consts, env);
    inter_state.statement(effect);
}

fn promote_interposed_terminal(
    stmt: &ReactiveTerminalStatement,
    state: &mut State,
    inter_state: &mut InterState<'_>,
    consts: &mut HashSet<IdentifierId>,
    globals: &mut HashSet<IdentifierId>,
    env: &mut Environment,
) {
    match &stmt.terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            promote_interposed_terminal_place(value, state, inter_state, consts, env);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_block,
            ..
        } => {
            promote_interposed_terminal_value(init, state, inter_state, consts, globals, env);
            promote_interposed_terminal_value(test, state, inter_state, consts, globals, env);
            promote_interposed_block(loop_block, state, inter_state, consts, globals, env);
            if let Some(update) = update {
                promote_interposed_terminal_value(update, state, inter_state, consts, globals, env);
            }
        }
        ReactiveTerminal::ForOf {
            init,
            test,
            loop_block,
            ..
        } => {
            // `for (const item of collection)` prints the collection once, for init and test.
            let outer = inter_state.enter_value_block();
            let init = promote_interposed_value(init, state, inter_state, consts, globals, env);
            let test = promote_interposed_value(test, state, inter_state, consts, globals, env);
            inter_state.exit_value_block(outer);
            inter_state.statement(init.max(test));
            promote_interposed_block(loop_block, state, inter_state, consts, globals, env);
        }
        ReactiveTerminal::ForIn {
            init, loop_block, ..
        } => {
            promote_interposed_terminal_value(init, state, inter_state, consts, globals, env);
            promote_interposed_block(loop_block, state, inter_state, consts, globals, env);
        }
        ReactiveTerminal::DoWhile {
            loop_block, test, ..
        } => {
            promote_interposed_block(loop_block, state, inter_state, consts, globals, env);
            promote_interposed_terminal_value(test, state, inter_state, consts, globals, env);
        }
        ReactiveTerminal::While {
            test, loop_block, ..
        } => {
            promote_interposed_terminal_value(test, state, inter_state, consts, globals, env);
            promote_interposed_block(loop_block, state, inter_state, consts, globals, env);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            promote_interposed_terminal_place(test, state, inter_state, consts, env);
            promote_interposed_block(consequent, state, inter_state, consts, globals, env);
            if let Some(alt) = alternate {
                promote_interposed_block(alt, state, inter_state, consts, globals, env);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            // Case tests are lowered before the discriminant and print after it: never name them.
            let mut effect = promote_interposed_place(test, state, inter_state, consts, env);
            for case in cases {
                if let Some(t) = &case.test {
                    let temporary = inline_temporary(t, state, inter_state, env);
                    effect = effect.max(temporary.map_or(Effect::None, |t| t.effect));
                }
            }
            inter_state.statement(effect);
            for case in cases {
                if let Some(block) = &case.block {
                    promote_interposed_block(block, state, inter_state, consts, globals, env);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => {
            promote_interposed_block(block, state, inter_state, consts, globals, env);
        }
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            promote_interposed_block(block, state, inter_state, consts, globals, env);
            if let Some(binding) = handler_binding {
                promote_interposed_place(binding, state, inter_state, consts, env);
            }
            promote_interposed_block(handler, state, inter_state, consts, globals, env);
        }
    }
}

// =============================================================================
// Phase 4: PromoteAllInstancesOfPromotedTemporaries
// =============================================================================

fn promote_all_instances_params(func: &ReactiveFunction, state: &mut State, env: &mut Environment) {
    for param in &func.params {
        let place = param.place();
        let identifier = &env.identifiers[place.identifier.0 as usize];
        if identifier.name.is_none() && state.promoted.contains(&identifier.declaration_id) {
            promote_identifier(place.identifier, state, env);
        }
    }
}

fn promote_all_instances_block(block: &ReactiveBlock, state: &mut State, env: &mut Environment) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instr) => {
                promote_all_instances_instruction(instr, state, env);
            }
            ReactiveStatement::Scope(scope) => {
                promote_all_instances_block(&scope.instructions, state, env);
                promote_all_instances_scope_identifiers(scope.scope, state, env);
            }
            ReactiveStatement::PrunedScope(scope) => {
                promote_all_instances_block(&scope.instructions, state, env);
                promote_all_instances_scope_identifiers(scope.scope, state, env);
            }
            ReactiveStatement::Terminal(terminal) => {
                promote_all_instances_terminal(terminal, state, env);
            }
        }
    }
}

fn promote_all_instances_scope_identifiers(
    scope_id: ScopeId,
    state: &mut State,
    env: &mut Environment,
) {
    let scope_data = &env.scopes[scope_id.0 as usize];

    // Collect identifiers to promote
    let decl_ids: Vec<IdentifierId> = scope_data
        .declarations
        .iter()
        .map(|(_, d)| d.identifier)
        .collect();
    let dep_ids: Vec<IdentifierId> = scope_data
        .dependencies
        .iter()
        .map(|d| d.identifier)
        .collect();
    let reassign_ids: Vec<IdentifierId> = scope_data.reassignments.to_vec();

    for id in decl_ids {
        let identifier = &env.identifiers[id.0 as usize];
        if identifier.name.is_none() && state.promoted.contains(&identifier.declaration_id) {
            promote_identifier(id, state, env);
        }
    }
    for id in dep_ids {
        let identifier = &env.identifiers[id.0 as usize];
        if identifier.name.is_none() && state.promoted.contains(&identifier.declaration_id) {
            promote_identifier(id, state, env);
        }
    }
    for id in reassign_ids {
        let identifier = &env.identifiers[id.0 as usize];
        if identifier.name.is_none() && state.promoted.contains(&identifier.declaration_id) {
            promote_identifier(id, state, env);
        }
    }
}

fn promote_all_instances_place(place: &Place, state: &mut State, env: &mut Environment) {
    let identifier = &env.identifiers[place.identifier.0 as usize];
    if identifier.name.is_none() && state.promoted.contains(&identifier.declaration_id) {
        promote_identifier(place.identifier, state, env);
    }
}

fn promote_all_instances_instruction(
    instr: &ReactiveInstruction,
    state: &mut State,
    env: &mut Environment,
) {
    if let Some(lvalue) = &instr.lvalue {
        promote_all_instances_place(lvalue, state, env);
    }
    promote_all_instances_value(&instr.value, state, env);
}

fn promote_all_instances_value(value: &ReactiveValue, state: &mut State, env: &mut Environment) {
    match value {
        ReactiveValue::Instruction(iv) => {
            for place in crate::hir::visitors::each_instruction_value_operand(iv, env) {
                promote_all_instances_place(&place, state, env);
            }
            // Visit inner functions
            match iv {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    let func_id = lowered_func.func;
                    let inner_func = &env.functions[func_id.0 as usize];
                    let param_ids: Vec<IdentifierId> = inner_func
                        .params
                        .iter()
                        .map(|p| p.place().identifier)
                        .collect();
                    for id in param_ids {
                        let identifier = &env.identifiers[id.0 as usize];
                        if identifier.name.is_none()
                            && state.promoted.contains(&identifier.declaration_id)
                        {
                            promote_identifier(id, state, env);
                        }
                    }
                }
                _ => {}
            }
        }
        ReactiveValue::SequenceExpression {
            instructions,
            value: inner,
            ..
        } => {
            for instr in instructions {
                promote_all_instances_instruction(instr, state, env);
            }
            promote_all_instances_value(inner, state, env);
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            promote_all_instances_value(test, state, env);
            promote_all_instances_value(consequent, state, env);
            promote_all_instances_value(alternate, state, env);
        }
        ReactiveValue::LogicalExpression { left, right, .. } => {
            promote_all_instances_value(left, state, env);
            promote_all_instances_value(right, state, env);
        }
        ReactiveValue::OptionalExpression { value: inner, .. } => {
            promote_all_instances_value(inner, state, env);
        }
    }
}

fn promote_all_instances_terminal(
    stmt: &ReactiveTerminalStatement,
    state: &mut State,
    env: &mut Environment,
) {
    match &stmt.terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            promote_all_instances_place(value, state, env);
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_block,
            ..
        } => {
            promote_all_instances_value(init, state, env);
            promote_all_instances_value(test, state, env);
            promote_all_instances_block(loop_block, state, env);
            if let Some(update) = update {
                promote_all_instances_value(update, state, env);
            }
        }
        ReactiveTerminal::ForOf {
            init,
            test,
            loop_block,
            ..
        } => {
            promote_all_instances_value(init, state, env);
            promote_all_instances_value(test, state, env);
            promote_all_instances_block(loop_block, state, env);
        }
        ReactiveTerminal::ForIn {
            init, loop_block, ..
        } => {
            promote_all_instances_value(init, state, env);
            promote_all_instances_block(loop_block, state, env);
        }
        ReactiveTerminal::DoWhile {
            loop_block, test, ..
        } => {
            promote_all_instances_block(loop_block, state, env);
            promote_all_instances_value(test, state, env);
        }
        ReactiveTerminal::While {
            test, loop_block, ..
        } => {
            promote_all_instances_value(test, state, env);
            promote_all_instances_block(loop_block, state, env);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            promote_all_instances_place(test, state, env);
            promote_all_instances_block(consequent, state, env);
            if let Some(alt) = alternate {
                promote_all_instances_block(alt, state, env);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            promote_all_instances_place(test, state, env);
            for case in cases {
                if let Some(t) = &case.test {
                    promote_all_instances_place(t, state, env);
                }
                if let Some(block) = &case.block {
                    promote_all_instances_block(block, state, env);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => {
            promote_all_instances_block(block, state, env);
        }
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            promote_all_instances_block(block, state, env);
            if let Some(binding) = handler_binding {
                promote_all_instances_place(binding, state, env);
            }
            promote_all_instances_block(handler, state, env);
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

fn promote_identifier(identifier_id: IdentifierId, state: &mut State, env: &mut Environment) {
    let identifier = &env.identifiers[identifier_id.0 as usize];
    assert!(
        identifier.name.is_none(),
        "promoteTemporary: Expected to be called only for temporary variables"
    );
    let decl_id = identifier.declaration_id;
    if state.tags.contains(&decl_id) {
        env.promote_temporary_jsx_tag(identifier_id);
    } else {
        env.promote_temporary(identifier_id);
    }
    state.promoted.insert(decl_id);
}
