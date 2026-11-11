// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! RenameVariables — renames variables for output, assigns unique names,
//! handles SSA renames.
//!
//! Corresponds to `src/ReactiveScopes/RenameVariables.ts`.

use crate::collections::FxHashMap as HashMap;
use crate::collections::FxHashSet as HashSet;

use crate::collections::IdMap;
use crate::hir::DeclarationId;
use crate::hir::EvaluationOrder;
use crate::hir::FunctionId;
use crate::hir::IdentifierName;
use crate::hir::InstructionValue;
use crate::hir::Place;
use crate::hir::PrunedReactiveScopeBlock;
use crate::hir::ReactiveBlock;
use crate::hir::ReactiveFunction;
use crate::hir::ReactiveScopeBlock;
use crate::hir::ReactiveValue;
use crate::hir::StoreStr;
use crate::hir::environment::{Environment, OutputMode};

use crate::reactive_scopes::visitors::ReactiveFunctionVisitor;
use crate::reactive_scopes::visitors::{self};

// =============================================================================
// Scopes
// =============================================================================

struct Scopes {
    seen: IdMap<DeclarationId, IdentifierName>,
    stack: Vec<HashMap<StoreStr, DeclarationId>>,
    /// For each of `stack`: all `t0`, `t1`, .. below the first number and all `T0`, `T1`, .. below the second are taken.
    taken: Vec<[u32; 2]>,
    globals: HashSet<StoreStr>,
    names: HashSet<StoreStr>,
}

impl Scopes {
    fn new(globals: HashSet<StoreStr>) -> Self {
        Self {
            seen: IdMap::new(),
            stack: vec![HashMap::default()],
            taken: vec![[0; 2]],
            globals,
            names: HashSet::default(),
        }
    }

    fn visit_identifier(&mut self, identifier_id: crate::hir::IdentifierId, env: &Environment) {
        let identifier = &env.identifiers[identifier_id.0 as usize];
        let original_name = match &identifier.name {
            Some(name) => name,
            None => return,
        };
        let declaration_id = identifier.declaration_id;

        if self.seen.contains_key(declaration_id) {
            return;
        }

        let original_value: &[u8] = original_name.value();
        let is_promoted = matches!(original_name, IdentifierName::Promoted(_));
        let is_promoted_temp = is_promoted && original_value.starts_with(b"#t");
        let is_promoted_jsx = is_promoted && original_value.starts_with(b"#T");

        let mut name: Vec<u8> = Vec::with_capacity(original_value.len() + 4);
        let mut itoa = bun_core::fmt::ItoaBuf::new();
        let mut id: u32 = match is_promoted_temp || is_promoted_jsx {
            true => self.taken.last().unwrap()[usize::from(is_promoted_jsx)],
            false => 0,
        };
        let mut regen = |buf: &mut Vec<u8>, n: u32| {
            buf.clear();
            if is_promoted_temp {
                buf.push(b't');
            } else if is_promoted_jsx {
                buf.push(b'T');
            } else {
                buf.extend_from_slice(original_value);
                buf.push(b'$');
            }
            buf.extend_from_slice(itoa.format(n).as_bytes());
        };
        if is_promoted_temp || is_promoted_jsx {
            regen(&mut name, id);
            id += 1;
        } else {
            name.extend_from_slice(original_value);
        }

        while self.lookup(&name).is_some() || self.globals.contains(name.as_slice()) {
            regen(&mut name, id);
            id += 1;
        }
        if is_promoted_temp || is_promoted_jsx {
            self.taken.last_mut().unwrap()[usize::from(is_promoted_jsx)] = id;
        }

        let stored = StoreStr::new(bun_ast::data_store_dupe_str(&name));
        self.seen
            .insert(declaration_id, IdentifierName::Named(stored));
        self.stack
            .last_mut()
            .unwrap()
            .insert(stored, declaration_id);
        self.names.insert(stored);
    }

    fn lookup(&self, name: &[u8]) -> Option<DeclarationId> {
        for scope in self.stack.iter().rev() {
            if let Some(id) = scope.get(name) {
                return Some(*id);
            }
        }
        None
    }

    fn enter(&mut self) {
        self.stack.push(HashMap::default());
        self.taken.push(*self.taken.last().unwrap());
    }

    fn leave(&mut self) {
        self.stack.pop();
        self.taken.pop();
    }
}

// =============================================================================
// Visitor — TS: `class Visitor extends ReactiveFunctionVisitor<Scopes>`
// =============================================================================

struct Visitor<'a> {
    env: &'a Environment,
}

impl Visitor<'_> {
    /// Walk an inner HIR function, visiting params, instructions (with lvalues,
    /// value-lvalues and operands), and terminal operands, as if each instruction
    /// were one of the reactive function.
    /// TS: `visitHirFunction`
    /// Upstream recurses into a nested function twice, which walks depth `d` 2^d times.
    fn visit_hir_function(&self, func_id: FunctionId, state: &mut Scopes) {
        let env = self.env;
        if !env.has_stack() {
            return;
        }
        let inner_func = &env.functions[func_id.0 as usize];
        for param in &inner_func.params {
            state.visit_identifier(param.place().identifier, env);
        }
        for block in inner_func.body.blocks.values() {
            for instr_id in &block.instructions {
                let instr = &inner_func.instructions[instr_id.0 as usize];
                for lvalue in crate::hir::visitors::lvalues(instr) {
                    state.visit_identifier(lvalue.identifier, env);
                }
                for place in crate::hir::visitors::operands(&instr.value, &env.functions) {
                    state.visit_identifier(place.identifier, env);
                }
                if let InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } = &instr.value
                {
                    self.visit_hir_function(lowered_func.func, state);
                }
            }
            for operand in crate::hir::visitors::terminal_operands(&block.terminal) {
                state.visit_identifier(operand.identifier, env);
            }
        }
    }
}

impl ReactiveFunctionVisitor for Visitor<'_> {
    type State = Scopes;

    fn env(&self) -> &Environment {
        self.env
    }

    /// TS: `visitParam(place, state) { state.visit(place.identifier) }`
    fn visit_param(&self, place: &Place, state: &mut Scopes) {
        state.visit_identifier(place.identifier, self.env);
    }

    /// TS: `visitLValue(_id, lvalue, state) { state.visit(lvalue.identifier) }`
    fn visit_lvalue(&self, _id: EvaluationOrder, lvalue: &Place, state: &mut Scopes) {
        state.visit_identifier(lvalue.identifier, self.env);
    }

    /// TS: `visitPlace(_id, place, state) { state.visit(place.identifier) }`
    fn visit_place(&self, _id: EvaluationOrder, place: &Place, state: &mut Scopes) {
        state.visit_identifier(place.identifier, self.env);
    }

    /// TS: `visitBlock(block, state) { state.enter(() => { this.traverseBlock(block, state) }) }`
    fn visit_block(&self, block: &ReactiveBlock, state: &mut Scopes) {
        state.enter();
        self.traverse_block(block, state);
        state.leave();
    }

    /// TS: `visitPrunedScope(scopeBlock, state) { this.traverseBlock(scopeBlock.instructions, state) }`
    /// No enter/leave — names assigned inside pruned scopes remain visible in
    /// the enclosing scope, preventing name reuse.
    fn visit_pruned_scope(&self, scope: &PrunedReactiveScopeBlock, state: &mut Scopes) {
        self.traverse_block(&scope.instructions, state);
    }

    /// TS: `visitScope(scope, state) { for (const [_, decl] of scope.scope.declarations) state.visit(decl.identifier); this.traverseScope(scope, state) }`
    fn visit_scope(&self, scope: &ReactiveScopeBlock, state: &mut Scopes) {
        let scope_data = &self.env.scopes[scope.scope.0 as usize];
        for (_, declaration) in &scope_data.declarations {
            state.visit_identifier(declaration.identifier, self.env);
        }
        self.traverse_scope(scope, state);
    }

    /// TS: `visitValue(id, value, state) { this.traverseValue(id, value, state); if (value.kind === 'FunctionExpression' || value.kind === 'ObjectMethod') this.visitHirFunction(value.loweredFunc.func, state) }`
    fn visit_value(&self, id: EvaluationOrder, value: &ReactiveValue, state: &mut Scopes) {
        self.traverse_value(id, value, state);
        if let ReactiveValue::Instruction(iv) = value {
            match iv {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    self.visit_hir_function(lowered_func.func, state);
                }
                _ => {}
            }
        }
    }
}

// =============================================================================
// Public entry point
// =============================================================================

/// Renames variables for output — assigns unique names, handles SSA renames.
/// Returns a Set of all unique variable names used.
/// TS: `renameVariables`
pub(crate) fn rename_variables(
    func: &mut ReactiveFunction,
    env: &mut Environment,
) -> HashSet<String> {
    rename_variables_with_parent(func, env, None)
}

fn rename_variables_with_parent(
    func: &mut ReactiveFunction,
    env: &mut Environment,
    parent_names: Option<&HashSet<StoreStr>>,
) -> HashSet<String> {
    let globals = collect_referenced_globals(&func.body, env);

    // Phase 1: Use ReactiveFunctionVisitor to compute the rename mapping.
    // This collects DeclarationId -> IdentifierName without mutating env.
    let mut scopes = Scopes::new(globals.clone());
    // If parent names are provided (for outlined functions), pre-populate
    // the scope stack so that parameter names don't collide with parent
    // variables. In the TS compiler, outlined functions are placed in the
    // parent function body and processed within the parent's scope context.
    if let Some(parent) = parent_names {
        scopes.enter();
        for &name in parent {
            scopes
                .stack
                .last_mut()
                .unwrap()
                .insert(name, DeclarationId(u32::MAX));
            scopes.names.insert(name);
        }
    }
    rename_variables_impl(func, &Visitor { env }, &mut scopes);

    // Phase 2: Apply the computed renames to all identifiers in env.
    for identifier in env.identifiers.iter_mut() {
        if let Some(mapped_name) = scopes.seen.get(identifier.declaration_id) {
            if identifier.name.is_some() {
                identifier.name = Some(mapped_name.clone());
            }
        }
    }

    // The names are for what is generated.
    if env.output_mode == OutputMode::Lint {
        return HashSet::default();
    }

    let mut result: HashSet<String> =
        HashSet::with_capacity_and_hasher(scopes.names.len() + globals.len(), Default::default());
    for n in scopes.names.iter().chain(globals.iter()) {
        result.insert(bun_core::BStr::new(n.slice()).to_string());
    }
    result
}

/// TS: `renameVariablesImpl`
fn rename_variables_impl(func: &ReactiveFunction, visitor: &Visitor, scopes: &mut Scopes) {
    scopes.enter();
    for param in &func.params {
        let place = param.place();
        visitor.visit_param(place, scopes);
    }
    visitors::visit_reactive_function(func, visitor, scopes);
    scopes.leave();
}

// =============================================================================
// CollectReferencedGlobals
// =============================================================================

/// Collects all globally referenced names from the reactive function.
/// TS: `collectReferencedGlobals`
fn collect_referenced_globals(block: &ReactiveBlock, env: &Environment) -> HashSet<StoreStr> {
    let mut globals = HashSet::default();
    collect_globals_block(block, &mut globals, env);
    globals
}

fn collect_globals_block(
    block: &ReactiveBlock,
    globals: &mut HashSet<StoreStr>,
    env: &Environment,
) {
    if !env.has_stack() {
        return;
    }

    for stmt in block {
        match stmt {
            crate::hir::ReactiveStatement::Instruction(instr) => {
                collect_globals_value(&instr.value, globals, env);
            }
            crate::hir::ReactiveStatement::Scope(scope) => {
                collect_globals_block(&scope.instructions, globals, env);
            }
            crate::hir::ReactiveStatement::PrunedScope(scope) => {
                collect_globals_block(&scope.instructions, globals, env);
            }
            crate::hir::ReactiveStatement::Terminal(terminal) => {
                collect_globals_terminal(terminal, globals, env);
            }
        }
    }
}

fn collect_globals_value(
    value: &ReactiveValue,
    globals: &mut HashSet<StoreStr>,
    env: &Environment,
) {
    if !env.has_stack() {
        return;
    }

    match value {
        ReactiveValue::Instruction(iv) => {
            if let InstructionValue::LoadGlobal { binding, .. } = iv {
                globals.insert(StoreStr::new(binding.name()));
            }
            // Visit inner functions
            match iv {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    collect_globals_hir_function(lowered_func.func, globals, env);
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
                collect_globals_value(&instr.value, globals, env);
            }
            collect_globals_value(inner, globals, env);
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            collect_globals_value(test, globals, env);
            collect_globals_value(consequent, globals, env);
            collect_globals_value(alternate, globals, env);
        }
        ReactiveValue::LogicalExpression { left, right, .. } => {
            collect_globals_value(left, globals, env);
            collect_globals_value(right, globals, env);
        }
        ReactiveValue::OptionalExpression { value: inner, .. } => {
            collect_globals_value(inner, globals, env);
        }
    }
}

/// Recursively collects LoadGlobal names from an inner HIR function.
fn collect_globals_hir_function(
    func_id: FunctionId,
    globals: &mut HashSet<StoreStr>,
    env: &Environment,
) {
    if !env.has_stack() {
        return;
    }

    let inner_func = &env.functions[func_id.0 as usize];
    for block in inner_func.body.blocks.values() {
        for instr_id in &block.instructions {
            let instr = &inner_func.instructions[instr_id.0 as usize];
            if let InstructionValue::LoadGlobal { binding, .. } = &instr.value {
                globals.insert(StoreStr::new(binding.name()));
            }
            // Recurse into nested function expressions
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    collect_globals_hir_function(lowered_func.func, globals, env);
                }
                _ => {}
            }
        }
    }
}

fn collect_globals_terminal(
    stmt: &crate::hir::ReactiveTerminalStatement,
    globals: &mut HashSet<StoreStr>,
    env: &Environment,
) {
    match &stmt.terminal {
        crate::hir::ReactiveTerminal::Break { .. }
        | crate::hir::ReactiveTerminal::Continue { .. } => {}
        crate::hir::ReactiveTerminal::Return { .. }
        | crate::hir::ReactiveTerminal::Throw { .. } => {}
        crate::hir::ReactiveTerminal::For {
            init,
            test,
            update,
            loop_block,
            ..
        } => {
            collect_globals_value(init, globals, env);
            collect_globals_value(test, globals, env);
            collect_globals_block(loop_block, globals, env);
            if let Some(update) = update {
                collect_globals_value(update, globals, env);
            }
        }
        crate::hir::ReactiveTerminal::ForOf {
            init,
            test,
            loop_block,
            ..
        } => {
            collect_globals_value(init, globals, env);
            collect_globals_value(test, globals, env);
            collect_globals_block(loop_block, globals, env);
        }
        crate::hir::ReactiveTerminal::ForIn {
            init, loop_block, ..
        } => {
            collect_globals_value(init, globals, env);
            collect_globals_block(loop_block, globals, env);
        }
        crate::hir::ReactiveTerminal::DoWhile {
            loop_block, test, ..
        } => {
            collect_globals_block(loop_block, globals, env);
            collect_globals_value(test, globals, env);
        }
        crate::hir::ReactiveTerminal::While {
            test, loop_block, ..
        } => {
            collect_globals_value(test, globals, env);
            collect_globals_block(loop_block, globals, env);
        }
        crate::hir::ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            collect_globals_block(consequent, globals, env);
            if let Some(alt) = alternate {
                collect_globals_block(alt, globals, env);
            }
        }
        crate::hir::ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &case.block {
                    collect_globals_block(block, globals, env);
                }
            }
        }
        crate::hir::ReactiveTerminal::Label { block, .. } => {
            collect_globals_block(block, globals, env);
        }
        crate::hir::ReactiveTerminal::Try { block, handler, .. } => {
            collect_globals_block(block, globals, env);
            collect_globals_block(handler, globals, env);
        }
    }
}
