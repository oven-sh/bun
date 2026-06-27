// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Port of ValidatePreservedManualMemoization.ts
//!
//! Validates that all explicit manual memoization (useMemo/useCallback) was
//! accurately preserved, and that no originally memoized values became
//! unmemoized in the output.

use std::collections::{HashMap, HashSet};

use bun_core::BStr;

use crate::collections::IdMap;
use crate::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, CompilerError, ErrorCategory, SourceLocation,
};
use crate::hir::environment::Environment;
use crate::hir::{
    AstAlloc, DeclarationId, DependencyPathEntry, HirVec, Identifier, IdentifierId, IdentifierName,
    InstructionKind, InstructionValue, ManualMemoDependency, ManualMemoDependencyRoot, Place,
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveValue, ScopeId,
};

/// State tracked during manual memo validation within a StartMemoize..FinishMemoize range.
struct ManualMemoBlockState {
    /// Reassigned temporaries (declaration_id -> set of identifier ids that were reassigned to it).
    reassignments: IdMap<DeclarationId, HashSet<IdentifierId>>,
    /// Source location of the StartMemoize instruction.
    loc: Option<SourceLocation>,
    /// Declarations produced within this manual memo block.
    decls: HashSet<DeclarationId>,
    /// Normalized deps from source (useMemo/useCallback dep array).
    deps_from_source: Option<HirVec<ManualMemoDependency>>,
    /// Manual memo id from StartMemoize.
    manual_memo_id: u32,
}

/// Top-level visitor state.
struct VisitorState<'a> {
    env: &'a mut Environment,
    manual_memo_state: Option<ManualMemoBlockState>,
    /// Completed (non-pruned) scope IDs.
    scopes: HashSet<ScopeId>,
    /// Completed pruned scope IDs.
    pruned_scopes: HashSet<ScopeId>,
    /// Map from identifier ID to its normalized manual memo dependency.
    temporaries: HashMap<IdentifierId, ManualMemoDependency>,
}

/// Validate that manual memoization (useMemo/useCallback) is preserved.
///
/// Walks the reactive function looking for StartMemoize/FinishMemoize instructions
/// and checks that:
/// 1. Dependencies' scopes have completed before the memo block starts
/// 2. Memoized values are actually within scopes (not unmemoized)
/// 3. Inferred scope dependencies match the source dependencies
pub fn validate_preserved_manual_memoization(func: &ReactiveFunction, env: &mut Environment) {
    let mut state = VisitorState {
        env,
        manual_memo_state: None,
        scopes: HashSet::new(),
        pruned_scopes: HashSet::new(),
        temporaries: HashMap::new(),
    };
    visit_block(&func.body, &mut state);
}

fn is_named(ident: &Identifier) -> bool {
    matches!(ident.name, Some(IdentifierName::Named(_)))
}

fn visit_block(block: &ReactiveBlock, state: &mut VisitorState) {
    for stmt in block {
        visit_statement(stmt, state);
    }
}

fn visit_statement(stmt: &ReactiveStatement, state: &mut VisitorState) {
    match stmt {
        ReactiveStatement::Instruction(instr) => {
            visit_instruction(instr, state);
        }
        ReactiveStatement::Terminal(terminal) => {
            visit_terminal(terminal, state);
        }
        ReactiveStatement::Scope(scope_block) => {
            visit_scope(scope_block, state);
        }
        ReactiveStatement::PrunedScope(pruned) => {
            visit_pruned_scope(pruned, state);
        }
    }
}

fn visit_terminal(terminal: &crate::hir::ReactiveTerminalStatement, state: &mut VisitorState) {
    use crate::hir::ReactiveTerminal;
    match &terminal.terminal {
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            visit_block(consequent, state);
            if let Some(alt) = alternate {
                visit_block(alt, state);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(ref block) = case.block {
                    visit_block(block, state);
                }
            }
        }
        ReactiveTerminal::For { loop_block, .. }
        | ReactiveTerminal::ForOf { loop_block, .. }
        | ReactiveTerminal::ForIn { loop_block, .. }
        | ReactiveTerminal::While { loop_block, .. }
        | ReactiveTerminal::DoWhile { loop_block, .. } => {
            visit_block(loop_block, state);
        }
        ReactiveTerminal::Label { block, .. } => {
            visit_block(block, state);
        }
        ReactiveTerminal::Try { block, handler, .. } => {
            visit_block(block, state);
            visit_block(handler, state);
        }
        _ => {}
    }
}

fn visit_scope(scope_block: &ReactiveScopeBlock, state: &mut VisitorState) {
    // Traverse the scope's instructions first
    visit_block(&scope_block.instructions, state);

    // After traversing, validate scope dependencies against manual memo deps
    if let Some(ref memo_state) = state.manual_memo_state {
        if let Some(ref deps_from_source) = memo_state.deps_from_source {
            let env = &mut *state.env;
            let scope = &env.scopes[scope_block.scope.0 as usize];
            for dep in &scope.dependencies {
                validate_inferred_dep(
                    dep.identifier,
                    &dep.path,
                    &state.temporaries,
                    &memo_state.decls,
                    deps_from_source,
                    &env.identifiers,
                    &mut env.errors,
                    memo_state.loc,
                );
            }
        }
    }

    // Mark scope and merged scopes as completed
    let scope = &state.env.scopes[scope_block.scope.0 as usize];
    state.scopes.insert(scope_block.scope);
    for &merged_id in scope.merged.iter() {
        state.scopes.insert(merged_id);
    }
}

fn visit_pruned_scope(pruned: &crate::hir::PrunedReactiveScopeBlock, state: &mut VisitorState) {
    visit_block(&pruned.instructions, state);
    state.pruned_scopes.insert(pruned.scope);
}

fn visit_instruction(instr: &ReactiveInstruction, state: &mut VisitorState) {
    // Record temporaries and deps in the instruction's value
    record_temporaries(instr, state);

    match &instr.value {
        ReactiveValue::Instruction(InstructionValue::StartMemoize {
            manual_memo_id,
            deps,
            has_invalid_deps,
            ..
        }) => {
            // TS: CompilerError.invariant(state.manualMemoState == null, ...)
            if state.manual_memo_state.is_some() {
                return;
            }

            // TS: if (value.hasInvalidDeps === true) { return; }
            if *has_invalid_deps {
                return;
            }

            let deps_from_source = deps.clone();

            state.manual_memo_state = Some(ManualMemoBlockState {
                loc: instr.loc,
                decls: HashSet::new(),
                deps_from_source,
                manual_memo_id: *manual_memo_id,
                reassignments: IdMap::new(),
            });

            // Check that each dependency's scope has completed before the memo
            // TS: for (const {identifier, loc} of eachInstructionValueOperand(value))
            if let Some(deps) = deps {
                for dep in deps {
                    let ManualMemoDependencyRoot::NamedLocal { value: place, .. } = &dep.root
                    else {
                        continue;
                    };
                    let ident = &state.env.identifiers[place.identifier.0 as usize];
                    if let Some(scope_id) = ident.scope {
                        if !state.scopes.contains(&scope_id)
                            && !state.pruned_scopes.contains(&scope_id)
                        {
                            record_dep_mutated_later_error(place.loc, state.env);
                        }
                    }
                }
            }
        }
        ReactiveValue::Instruction(InstructionValue::FinishMemoize {
            decl,
            pruned,
            manual_memo_id,
            ..
        }) => {
            if state.manual_memo_state.is_none() {
                // StartMemoize had invalid deps, skip validation
                return;
            }

            // TS: CompilerError.invariant(state.manualMemoState.manualMemoId === value.manualMemoId, ...)
            if state
                .manual_memo_state
                .as_ref()
                .map_or(true, |s| s.manual_memo_id != *manual_memo_id)
            {
                state.manual_memo_state = None;
                return;
            }

            let memo_state = state.manual_memo_state.take().unwrap();

            if !pruned {
                // Check if the declared value is unmemoized
                let decl_ident = &state.env.identifiers[decl.identifier.0 as usize];

                if decl_ident.scope.is_none() {
                    // If the manual memo was inlined (useMemo -> IIFE), check reassignments
                    let decls_to_check = memo_state
                        .reassignments
                        .get(decl_ident.declaration_id)
                        .map(|ids| ids.iter().copied().collect::<Vec<_>>())
                        .unwrap_or_else(|| vec![decl.identifier]);

                    for id in decls_to_check {
                        if is_unmemoized(id, &state.scopes, &state.env.identifiers) {
                            record_unmemoized_error(decl.loc, state.env);
                        }
                    }
                } else {
                    // Single identifier with scope
                    if is_unmemoized(decl.identifier, &state.scopes, &state.env.identifiers) {
                        record_unmemoized_error(decl.loc, state.env);
                    }
                }
            }
        }
        ReactiveValue::Instruction(InstructionValue::StoreLocal { lvalue, value, .. }) => {
            // Track reassignments from inlining of manual memo
            if state.manual_memo_state.is_some() && lvalue.kind == InstructionKind::Reassign {
                let decl_id =
                    state.env.identifiers[lvalue.place.identifier.0 as usize].declaration_id;
                state
                    .manual_memo_state
                    .as_mut()
                    .unwrap()
                    .reassignments
                    .entry(decl_id)
                    .or_default()
                    .insert(value.identifier);
            }
        }
        ReactiveValue::Instruction(InstructionValue::LoadLocal { place, .. }) => {
            if state.manual_memo_state.is_some() {
                let place_ident = &state.env.identifiers[place.identifier.0 as usize];
                if let Some(ref lvalue) = instr.lvalue {
                    let lvalue_ident = &state.env.identifiers[lvalue.identifier.0 as usize];
                    if place_ident.scope.is_some() && lvalue_ident.scope.is_none() {
                        state
                            .manual_memo_state
                            .as_mut()
                            .unwrap()
                            .reassignments
                            .entry(lvalue_ident.declaration_id)
                            .or_default()
                            .insert(place.identifier);
                    }
                }
            }
        }
        _ => {}
    }
}

#[cold]
#[inline(never)]
fn record_dep_mutated_later_error(loc: Option<SourceLocation>, env: &mut Environment) {
    let diag = CompilerDiagnostic::new(
        ErrorCategory::PreserveManualMemo,
        "Existing memoization could not be preserved",
        Some(
            "React Compiler has skipped optimizing this component because the existing manual memoization could not be preserved. \
             This dependency may be mutated later, which could cause the value to change unexpectedly".to_string(),
        ),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc,
        message: Some("This dependency may be modified later".to_string()),
        identifier_name: None,
    });
    env.record_diagnostic(diag);
}

#[cold]
#[inline(never)]
fn record_unmemoized_error(loc: Option<SourceLocation>, env: &mut Environment) {
    let diag = CompilerDiagnostic::new(
        ErrorCategory::PreserveManualMemo,
        "Existing memoization could not be preserved",
        Some(
            "React Compiler has skipped optimizing this component because the existing manual memoization could not be preserved. This value was memoized in source but not in compilation output".to_string(),
        ),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc,
        message: Some("Could not preserve existing memoization".to_string()),
        identifier_name: None,
    });
    env.record_diagnostic(diag);
}

/// Record temporaries from an instruction.
/// TS: `recordTemporaries`
fn record_temporaries(instr: &ReactiveInstruction, state: &mut VisitorState) {
    let lvalue = &instr.lvalue;
    let lv_id = lvalue.as_ref().map(|lv| lv.identifier);
    if let Some(id) = lv_id {
        if state.temporaries.contains_key(&id) {
            return;
        }
    }

    if let Some(ref lvalue) = instr.lvalue {
        let lv_ident = &state.env.identifiers[lvalue.identifier.0 as usize];
        if is_named(lv_ident) && state.manual_memo_state.is_some() {
            state
                .manual_memo_state
                .as_mut()
                .unwrap()
                .decls
                .insert(lv_ident.declaration_id);
        }
    }

    // Record deps from the instruction value first (before setting lvalue temporary)
    record_deps_in_value(&instr.value, state);

    // Then set the lvalue temporary (TS always sets this, even for unnamed lvalues)
    if let Some(ref lvalue) = instr.lvalue {
        state.temporaries.insert(
            lvalue.identifier,
            ManualMemoDependency {
                root: ManualMemoDependencyRoot::NamedLocal {
                    value: lvalue.clone(),
                    constant: false,
                },
                path: AstAlloc::vec(),
                loc: lvalue.loc,
            },
        );
    }
}

/// Record dependencies from a reactive value.
/// TS: `recordDepsInValue`
fn record_deps_in_value(value: &ReactiveValue, state: &mut VisitorState) {
    match value {
        ReactiveValue::SequenceExpression {
            instructions,
            value,
            ..
        } => {
            for instr in instructions {
                visit_instruction(instr, state);
            }
            record_deps_in_value(value, state);
        }
        ReactiveValue::OptionalExpression { value: inner, .. } => {
            record_deps_in_value(inner, state);
        }
        ReactiveValue::ConditionalExpression {
            test,
            consequent,
            alternate,
            ..
        } => {
            record_deps_in_value(test, state);
            record_deps_in_value(consequent, state);
            record_deps_in_value(alternate, state);
        }
        ReactiveValue::LogicalExpression { left, right, .. } => {
            record_deps_in_value(left, state);
            record_deps_in_value(right, state);
        }
        ReactiveValue::Instruction(iv) => {
            // TS: collectMaybeMemoDependencies(value, this.temporaries, false)
            // Upstream calls this for its side-effect: for StoreLocal whose
            // lvalue.place is an unnamed temporary, it inserts
            // `lvalue.place.id -> aliased rvalue dep` into `temporaries`.
            if let InstructionValue::StoreLocal { lvalue, .. } = iv {
                if let Some(dep) =
                    crate::optimization::drop_manual_memoization::collect_maybe_memo_dependencies(
                        iv,
                        &state.temporaries,
                        false,
                        state.env,
                    )
                {
                    state.temporaries.insert(lvalue.place.identifier, dep);
                }
            }

            // TS: if (value.kind === 'StoreLocal' || value.kind === 'StoreContext' || value.kind === 'Destructure')
            match iv {
                InstructionValue::StoreLocal { lvalue, .. }
                | InstructionValue::StoreContext { lvalue, .. } => {
                    let ident = &state.env.identifiers[lvalue.place.identifier.0 as usize];
                    let decl_id = ident.declaration_id;
                    let named = is_named(ident);
                    if let Some(ref mut memo_state) = state.manual_memo_state {
                        memo_state.decls.insert(decl_id);
                    }
                    if named {
                        state.temporaries.insert(
                            lvalue.place.identifier,
                            ManualMemoDependency {
                                root: ManualMemoDependencyRoot::NamedLocal {
                                    value: lvalue.place.clone(),
                                    constant: false,
                                },
                                path: AstAlloc::vec(),
                                loc: lvalue.place.loc,
                            },
                        );
                    }
                }
                InstructionValue::Destructure { lvalue, .. } => {
                    for place in destructure_lvalue_places(&lvalue.pattern) {
                        let ident = &state.env.identifiers[place.identifier.0 as usize];
                        let decl_id = ident.declaration_id;
                        let named = is_named(ident);
                        if let Some(ref mut memo_state) = state.manual_memo_state {
                            memo_state.decls.insert(decl_id);
                        }
                        if named {
                            state.temporaries.insert(
                                place.identifier,
                                ManualMemoDependency {
                                    root: ManualMemoDependencyRoot::NamedLocal {
                                        value: place.clone(),
                                        constant: false,
                                    },
                                    path: AstAlloc::vec(),
                                    loc: place.loc,
                                },
                            );
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// Get lvalue places from a Destructure pattern.
fn destructure_lvalue_places(pattern: &crate::hir::Pattern) -> Vec<&Place> {
    let mut result = Vec::new();
    match pattern {
        crate::hir::Pattern::Array(arr) => {
            for item in &arr.items {
                match item {
                    crate::hir::ArrayPatternElement::Place(place) => {
                        result.push(place);
                    }
                    crate::hir::ArrayPatternElement::Spread(spread) => {
                        result.push(&spread.place);
                    }
                    crate::hir::ArrayPatternElement::Hole => {}
                }
            }
        }
        crate::hir::Pattern::Object(obj) => {
            for entry in &obj.properties {
                match entry {
                    crate::hir::ObjectPropertyOrSpread::Property(prop) => {
                        result.push(&prop.place);
                    }
                    crate::hir::ObjectPropertyOrSpread::Spread(spread) => {
                        result.push(&spread.place);
                    }
                }
            }
        }
    }
    result
}

/// Check if an identifier is unmemoized (has a scope that hasn't completed).
fn is_unmemoized(
    id: IdentifierId,
    completed_scopes: &HashSet<ScopeId>,
    identifiers: &[Identifier],
) -> bool {
    let ident = &identifiers[id.0 as usize];
    if let Some(scope_id) = ident.scope {
        !completed_scopes.contains(&scope_id)
    } else {
        false
    }
}

// =============================================================================
// Dependency comparison (port of compareDeps / validateInferredDep)
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum CompareDependencyResult {
    Ok = 0,
    RootDifference = 1,
    PathDifference = 2,
    Subpath = 3,
    RefAccessDifference = 4,
}

fn compare_deps(
    inferred: &ManualMemoDependency,
    source: &ManualMemoDependency,
    identifiers: &[Identifier],
) -> CompareDependencyResult {
    let roots_equal = match (&inferred.root, &source.root) {
        (
            ManualMemoDependencyRoot::Global { identifier_name: a },
            ManualMemoDependencyRoot::Global { identifier_name: b },
        ) => a == b,
        (
            ManualMemoDependencyRoot::NamedLocal { value: a, .. },
            ManualMemoDependencyRoot::NamedLocal { value: b, .. },
        ) => {
            // Bun's arena HIR can hold distinct IdentifierIds for the same source
            // variable, so compare by declaration_id.
            a.identifier == b.identifier
                || identifiers[a.identifier.0 as usize].declaration_id
                    == identifiers[b.identifier.0 as usize].declaration_id
        }
        _ => false,
    };
    if !roots_equal {
        return CompareDependencyResult::RootDifference;
    }

    let min_len = inferred.path.len().min(source.path.len());
    let mut is_subpath = true;
    for i in 0..min_len {
        if inferred.path[i].property != source.path[i].property {
            is_subpath = false;
            break;
        } else if inferred.path[i].optional != source.path[i].optional {
            return CompareDependencyResult::PathDifference;
        }
    }

    if is_subpath
        && (source.path.len() == inferred.path.len()
            || (inferred.path.len() >= source.path.len()
                && !inferred.path.iter().any(|t| is_current_prop(&t.property))))
    {
        CompareDependencyResult::Ok
    } else if is_subpath {
        if source.path.iter().any(|t| is_current_prop(&t.property))
            || inferred.path.iter().any(|t| is_current_prop(&t.property))
        {
            CompareDependencyResult::RefAccessDifference
        } else {
            CompareDependencyResult::Subpath
        }
    } else {
        CompareDependencyResult::PathDifference
    }
}

#[inline]
fn is_current_prop(prop: &crate::hir::PropertyLiteral) -> bool {
    matches!(prop, crate::hir::PropertyLiteral::String(s) if *s == b"current")
}

fn write_identifier_name(out: &mut impl core::fmt::Write, ident: &Identifier) {
    let _ = match &ident.name {
        Some(name) => write!(out, "{}", BStr::new(name.value())),
        None => out.write_str("[unnamed]"),
    };
}

fn write_dep_path(out: &mut impl core::fmt::Write, path: &[DependencyPathEntry]) {
    for entry in path {
        let _ = out.write_str(if entry.optional { "?." } else { "." });
        let _ = write!(out, "{}", entry.property);
    }
}

/// Write a reactive scope dependency (e.g., `x.a.b?.c`)
fn write_scope_dependency(
    out: &mut impl core::fmt::Write,
    dep_id: IdentifierId,
    dep_path: &[DependencyPathEntry],
    identifiers: &[Identifier],
) {
    write_identifier_name(out, &identifiers[dep_id.0 as usize]);
    write_dep_path(out, dep_path);
}

/// Write a manual memo dependency for error messages.
fn write_manual_memo_dependency(
    out: &mut impl core::fmt::Write,
    dep: &ManualMemoDependency,
    identifiers: &[Identifier],
) {
    match &dep.root {
        ManualMemoDependencyRoot::NamedLocal { value, .. } => {
            write_identifier_name(out, &identifiers[value.identifier.0 as usize]);
        }
        ManualMemoDependencyRoot::Global { identifier_name } => {
            let _ = write!(out, "{}", BStr::new(identifier_name));
        }
    }
    write_dep_path(out, &dep.path);
}

fn get_compare_dependency_result_description(result: CompareDependencyResult) -> &'static str {
    match result {
        CompareDependencyResult::Ok => "Dependencies equal",
        CompareDependencyResult::RootDifference | CompareDependencyResult::PathDifference => {
            "Inferred different dependency than source"
        }
        CompareDependencyResult::RefAccessDifference => "Differences in ref.current access",
        CompareDependencyResult::Subpath => "Inferred less specific property than source",
    }
}

/// Validate that an inferred dependency matches a source dependency or was produced
/// within the manual memo block.
fn validate_inferred_dep(
    dep_id: IdentifierId,
    dep_path: &[DependencyPathEntry],
    temporaries: &HashMap<IdentifierId, ManualMemoDependency>,
    decls_within_memo_block: &HashSet<DeclarationId>,
    valid_deps_in_memo_block: &[ManualMemoDependency],
    identifiers: &[Identifier],
    errors: &mut CompilerError,
    memo_location: Option<SourceLocation>,
) {
    // Normalize the dependency through temporaries
    let normalized_dep = if let Some(temp) = temporaries.get(&dep_id) {
        let mut path = temp.path.clone();
        path.extend_from_slice(dep_path);
        ManualMemoDependency {
            root: temp.root.clone(),
            path,
            loc: temp.loc,
        }
    } else {
        let ident = &identifiers[dep_id.0 as usize];
        // TS: CompilerError.invariant(dep.identifier.name?.kind === 'named', ...)
        if !is_named(ident) {
            return;
        }
        ManualMemoDependency {
            root: ManualMemoDependencyRoot::NamedLocal {
                value: Place {
                    identifier: dep_id,
                    effect: crate::hir::Effect::Read,
                    reactive: false,
                    loc: ident.loc,
                },
                constant: false,
            },
            path: AstAlloc::vec_from_slice(dep_path),
            loc: ident.loc,
        }
    };

    // Check if the dep was declared within the memo block
    if let ManualMemoDependencyRoot::NamedLocal { value, .. } = &normalized_dep.root {
        let ident = &identifiers[value.identifier.0 as usize];
        if decls_within_memo_block.contains(&ident.declaration_id) {
            return;
        }
    }

    // Compare against each valid source dependency
    let mut error_diagnostic: Option<CompareDependencyResult> = None;
    for source_dep in valid_deps_in_memo_block {
        let result = compare_deps(&normalized_dep, source_dep, identifiers);
        if result == CompareDependencyResult::Ok {
            return;
        }
        error_diagnostic = Some(match error_diagnostic {
            Some(prev) => prev.max(result),
            None => result,
        });
    }

    record_dep_mismatch_error(
        dep_id,
        dep_path,
        valid_deps_in_memo_block,
        error_diagnostic,
        memo_location,
        identifiers,
        errors,
    );
}

#[cold]
#[inline(never)]
fn record_dep_mismatch_error(
    dep_id: IdentifierId,
    dep_path: &[DependencyPathEntry],
    valid_deps_in_memo_block: &[ManualMemoDependency],
    error_diagnostic: Option<CompareDependencyResult>,
    memo_location: Option<SourceLocation>,
    identifiers: &[Identifier],
    errors: &mut CompilerError,
) {
    let ident = &identifiers[dep_id.0 as usize];

    let mut description = String::new();
    description.push_str(
        "React Compiler has skipped optimizing this component because the existing manual memoization could not be preserved. \
         The inferred dependencies did not match the manually specified dependencies, which could cause the value to change more or less frequently than expected.",
    );

    if is_named(ident) {
        // Use the original dep_id/dep_path (matching TS prettyPrintScopeDependency(dep))
        description.push_str(" The inferred dependency was `");
        write_scope_dependency(&mut description, dep_id, dep_path, identifiers);
        description.push_str("`, but the source dependencies were [");
        for (i, d) in valid_deps_in_memo_block.iter().enumerate() {
            if i > 0 {
                description.push_str(", ");
            }
            write_manual_memo_dependency(&mut description, d, identifiers);
        }
        description.push_str("]. ");
        description.push_str(
            error_diagnostic
                .map(get_compare_dependency_result_description)
                .unwrap_or("Inferred dependency not present in source"),
        );
    }

    let diag = CompilerDiagnostic::new(
        ErrorCategory::PreserveManualMemo,
        "Existing memoization could not be preserved",
        Some(description),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc: memo_location,
        message: Some("Could not preserve existing manual memoization".to_string()),
        identifier_name: None,
    });
    errors.push_diagnostic(diag);
}
