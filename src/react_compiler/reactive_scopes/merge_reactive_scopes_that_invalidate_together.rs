// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! MergeReactiveScopesThatInvalidateTogether — merges adjacent or nested scopes
//! that share dependencies (and thus invalidate together) to reduce memoization overhead.
//!
//! Corresponds to `src/ReactiveScopes/MergeReactiveScopesThatInvalidateTogether.ts`.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};

use crate::collections::{FxHashMap, IdMap};
use crate::diagnostics::CompilerError;
use crate::hir::{
    AstAlloc, DeclarationId, DependencyPathEntry, EvaluationOrder, HirVec, IdentifierId,
    InstructionKind, InstructionValue, Place, ReactiveBlock, ReactiveFunction, ReactiveScopeBlock,
    ReactiveScopeDeclaration, ReactiveScopeDependency, ReactiveStatement, ReactiveValue, ScopeId,
    Type,
    environment::Environment,
    object_shape::{BUILT_IN_ARRAY_ID, BUILT_IN_FUNCTION_ID, BUILT_IN_JSX_ID, BUILT_IN_OBJECT_ID},
};

use crate::reactive_scopes::visitors::{
    ReactiveFunctionTransform, ReactiveFunctionVisitor, Transformed, transform_reactive_function,
    visit_reactive_function,
};

// =============================================================================
// Public entry point
// =============================================================================

/// Merges adjacent reactive scopes that share dependencies (invalidate together).
/// TS: `mergeReactiveScopesThatInvalidateTogether`
pub(crate) fn merge_reactive_scopes_that_invalidate_together(
    func: &mut ReactiveFunction,
    env: &mut Environment,
) -> Result<(), CompilerError> {
    // Pass 1: find last usage of each declaration
    let visitor = FindLastUsageVisitor { env: &*env };
    let mut last_usage: IdMap<DeclarationId, EvaluationOrder> = IdMap::new();
    visit_reactive_function(func, &visitor, &mut last_usage);

    // Pass 2+3: merge scopes
    let mut transform = MergeTransform {
        env,
        last_usage,
        temporaries: IdMap::new(),
    };
    let mut state: Option<HirVec<ReactiveScopeDependency>> = None;
    transform_reactive_function(func, &mut transform, &mut state)
}

// =============================================================================
// Pass 1: FindLastUsageVisitor
// =============================================================================

/// TS: `class FindLastUsageVisitor extends ReactiveFunctionVisitor<void>`
struct FindLastUsageVisitor<'a> {
    env: &'a Environment,
}

impl<'a> ReactiveFunctionVisitor for FindLastUsageVisitor<'a> {
    type State = IdMap<DeclarationId, EvaluationOrder>;

    fn env(&self) -> &Environment {
        self.env
    }

    fn visit_place(&self, id: EvaluationOrder, place: &Place, state: &mut Self::State) {
        let decl_id = self.env.identifiers[place.identifier.0 as usize].declaration_id;
        let entry = state.entry(decl_id).or_insert(id);
        if id > *entry {
            *entry = id;
        }
    }
}

// =============================================================================
// Pass 2+3: MergeTransform
// =============================================================================

/// TS: `class Transform extends ReactiveFunctionTransform<ReactiveScopeDependencies | null>`
struct MergeTransform<'a> {
    env: &'a mut Environment,
    last_usage: IdMap<DeclarationId, EvaluationOrder>,
    temporaries: IdMap<DeclarationId, DeclarationId>,
}

impl<'a> ReactiveFunctionTransform for MergeTransform<'a> {
    type State = Option<HirVec<ReactiveScopeDependency>>;

    fn env(&self) -> &Environment {
        self.env
    }

    /// TS: `override transformScope(scopeBlock, state)`
    fn transform_scope(
        &mut self,
        scope: &mut ReactiveScopeBlock,
        state: &mut Self::State,
    ) -> Result<Transformed<ReactiveStatement>, CompilerError> {
        let scope_deps = self.env.scopes[scope.scope.0 as usize].dependencies.clone();
        // Save parent state and recurse with this scope's deps as state
        let parent_state = state.take();
        *state = Some(scope_deps.clone());
        self.visit_scope(scope, state)?;
        // Restore parent state
        *state = parent_state;

        // If parent has deps and they match, flatten the inner scope
        if let Some(parent_deps) = state.as_ref() {
            if are_equal_dependencies(parent_deps, &scope_deps, self.env) {
                let instructions = std::mem::take(&mut scope.instructions);
                return Ok(Transformed::ReplaceMany(instructions));
            }
        }
        Ok(Transformed::Keep)
    }

    /// TS: `override visitBlock(block, state)`
    fn visit_block(
        &mut self,
        block: &mut ReactiveBlock,
        state: &mut Self::State,
    ) -> Result<(), CompilerError> {
        // Pass 1: traverse nested (scope flattening handled by transform_scope)
        self.traverse_block(block, state)?;
        // Pass 2+3: merge consecutive scopes in this block
        self.merge_scopes_in_block(block)?;
        Ok(())
    }
}

impl<'a> MergeTransform<'a> {
    /// Identify and merge consecutive scopes that invalidate together.
    fn merge_scopes_in_block(&mut self, block: &mut ReactiveBlock) -> Result<(), CompilerError> {
        // Pass 2: identify scopes for merging
        struct MergedScope {
            scope_id: ScopeId,
            from: usize,
            to: usize,
            lvalues: HashSet<DeclarationId>,
            declarations: CandidateDeclarations,
        }

        let mut current: Option<MergedScope> = None;
        let mut merged: Vec<MergedScope> = Vec::new();

        let block_len = block.len();
        for i in 0..block_len {
            match &block[i] {
                ReactiveStatement::Terminal(_) => {
                    // Don't merge across terminals
                    if let Some(c) = current.take() {
                        if c.to > c.from + 1 {
                            merged.push(c);
                        }
                    }
                }
                ReactiveStatement::PrunedScope(_) => {
                    // Don't merge across pruned scopes
                    if let Some(c) = current.take() {
                        if c.to > c.from + 1 {
                            merged.push(c);
                        }
                    }
                }
                ReactiveStatement::Instruction(instr) => {
                    match &instr.value {
                        ReactiveValue::Instruction(iv) => {
                            match iv {
                                InstructionValue::BinaryExpression { .. }
                                | InstructionValue::ComputedLoad { .. }
                                | InstructionValue::JSXText { .. }
                                | InstructionValue::LoadGlobal { .. }
                                | InstructionValue::LoadLocal { .. }
                                | InstructionValue::Primitive { .. }
                                | InstructionValue::PropertyLoad { .. }
                                | InstructionValue::TemplateLiteral { .. }
                                | InstructionValue::UnaryExpression { .. } => {
                                    if let Some(ref mut c) = current {
                                        if let Some(lvalue) = &instr.lvalue {
                                            let decl_id = self.env.identifiers
                                                [lvalue.identifier.0 as usize]
                                                .declaration_id;
                                            c.lvalues.insert(decl_id);
                                            if let InstructionValue::LoadLocal { place, .. } = iv {
                                                let src_decl = self.env.identifiers
                                                    [place.identifier.0 as usize]
                                                    .declaration_id;
                                                self.temporaries.insert(decl_id, src_decl);
                                            }
                                        }
                                    }
                                }
                                InstructionValue::StoreLocal { lvalue, value, .. } => {
                                    if let Some(ref mut c) = current {
                                        if lvalue.kind == InstructionKind::Const {
                                            // Add the instruction lvalue (if any)
                                            if let Some(instr_lvalue) = &instr.lvalue {
                                                let decl_id = self.env.identifiers
                                                    [instr_lvalue.identifier.0 as usize]
                                                    .declaration_id;
                                                c.lvalues.insert(decl_id);
                                            }
                                            // Add the StoreLocal's lvalue place
                                            let store_decl = self.env.identifiers
                                                [lvalue.place.identifier.0 as usize]
                                                .declaration_id;
                                            c.lvalues.insert(store_decl);
                                            // Track temporary mapping
                                            let value_decl = self.env.identifiers
                                                [value.identifier.0 as usize]
                                                .declaration_id;
                                            let mapped = self
                                                .temporaries
                                                .get(value_decl)
                                                .copied()
                                                .unwrap_or(value_decl);
                                            self.temporaries.insert(store_decl, mapped);
                                        } else {
                                            // Non-const StoreLocal — reset
                                            let c = current.take().unwrap();
                                            if c.to > c.from + 1 {
                                                merged.push(c);
                                            }
                                        }
                                    }
                                }
                                _ => {
                                    // Other instructions prevent merging
                                    if let Some(c) = current.take() {
                                        if c.to > c.from + 1 {
                                            merged.push(c);
                                        }
                                    }
                                }
                            }
                        }
                        _ => {
                            // Non-Instruction reactive values prevent merging
                            if let Some(c) = current.take() {
                                if c.to > c.from + 1 {
                                    merged.push(c);
                                }
                            }
                        }
                    }
                }
                ReactiveStatement::Scope(scope_block) => {
                    let next_scope_id = scope_block.scope;
                    if let Some(ref mut c) = current {
                        let current_scope_id = c.scope_id;
                        if can_merge_scopes(
                            current_scope_id,
                            &c.declarations,
                            next_scope_id,
                            self.env,
                            &self.temporaries,
                        ) && are_lvalues_last_used_by_scope(
                            next_scope_id,
                            &c.lvalues,
                            &self.last_usage,
                            self.env,
                        ) {
                            // Merge: extend the current scope's range
                            let next_range_end =
                                self.env.scopes[next_scope_id.0 as usize].range.end;
                            let current_range_end =
                                self.env.scopes[current_scope_id.0 as usize].range.end;
                            let range_end =
                                EvaluationOrder(current_range_end.0.max(next_range_end.0));
                            self.env.scopes[current_scope_id.0 as usize].range.end = range_end;

                            // Merge declarations from next into current
                            c.declarations
                                .extend(next_scope_id, &self.last_usage, self.env);

                            // Prune declarations that are no longer used after the merged scope
                            c.declarations.update_scope_declarations(range_end);

                            c.to = i + 1;
                            c.lvalues.clear();

                            if !scope_is_eligible_for_merging(next_scope_id, self.env) {
                                let c = current.take().unwrap();
                                if c.to > c.from + 1 {
                                    merged.push(c);
                                }
                            }
                        } else {
                            // Cannot merge — reset
                            let c = current.take().unwrap();
                            if c.to > c.from + 1 {
                                merged.push(c);
                            }
                            // Start new candidate if eligible
                            if scope_is_eligible_for_merging(next_scope_id, self.env) {
                                current = Some(MergedScope {
                                    scope_id: next_scope_id,
                                    from: i,
                                    to: i + 1,
                                    lvalues: HashSet::new(),
                                    declarations: CandidateDeclarations::new(
                                        next_scope_id,
                                        &self.last_usage,
                                        self.env,
                                    ),
                                });
                            }
                        }
                    } else {
                        // No current — start new candidate if eligible
                        if scope_is_eligible_for_merging(next_scope_id, self.env) {
                            current = Some(MergedScope {
                                scope_id: next_scope_id,
                                from: i,
                                to: i + 1,
                                lvalues: HashSet::new(),
                                declarations: CandidateDeclarations::new(
                                    next_scope_id,
                                    &self.last_usage,
                                    self.env,
                                ),
                            });
                        }
                    }
                }
            }
        }
        // Flush remaining
        if let Some(c) = current.take() {
            if c.to > c.from + 1 {
                merged.push(c);
            }
        }

        // Pass 3: apply merges
        if merged.is_empty() {
            return Ok(());
        }

        let mut next_instructions: Vec<ReactiveStatement> = Vec::new();
        let mut index = 0;
        let all_stmts: Vec<ReactiveStatement> = std::mem::take(block);

        for entry in merged {
            // Push everything before the merge range
            while index < entry.from {
                next_instructions.push(all_stmts[index].clone());
                index += 1;
            }
            // The first item in the merge range must be a scope
            let mut merged_scope = match &all_stmts[entry.from] {
                ReactiveStatement::Scope(s) => s.clone(),
                _ => {
                    return Err(crate::diagnostics::cold_invariant(
                        "MergeConsecutiveScopes: Expected scope at starting index",
                        None,
                        None,
                    ));
                }
            };
            self.env.scopes[merged_scope.scope.0 as usize].declarations =
                entry.declarations.into_declarations();
            index += 1;
            while index < entry.to {
                let stmt = &all_stmts[index];
                index += 1;
                match stmt {
                    ReactiveStatement::Scope(inner_scope) => {
                        merged_scope
                            .instructions
                            .extend(inner_scope.instructions.clone());
                        self.env.scopes[merged_scope.scope.0 as usize]
                            .merged
                            .push(inner_scope.scope);
                    }
                    _ => {
                        merged_scope.instructions.push(stmt.clone());
                    }
                }
            }
            next_instructions.push(ReactiveStatement::Scope(merged_scope));
        }
        // Push remaining
        while index < all_stmts.len() {
            next_instructions.push(all_stmts[index].clone());
            index += 1;
        }

        *block = next_instructions;
        Ok(())
    }
}

// =============================================================================
// Helper functions
// =============================================================================

/// Not in upstream: the declarations of a merge candidate. TS updates the `Map` of the scope.
/// The scope here holds a `HirVec`, and a search and a `retain` of it per merged scope take
/// time quadratic in the number of scopes that merge into one. Pass 3 stores the result in the
/// scope.
struct CandidateDeclarations {
    /// Each declaration with its position in the insertion order of the `Map`. RenameVariables
    /// names the declarations in that order.
    entries: FxHashMap<IdentifierId, (u32, ReactiveScopeDeclaration)>,
    next_position: u32,
    /// The entries that a later range end removes, earliest last usage first.
    by_last_usage: BinaryHeap<Reverse<(EvaluationOrder, IdentifierId, DeclarationId)>>,
    /// The number of entries per declaration id.
    declaration_ids: FxHashMap<DeclarationId, u32>,
}

impl CandidateDeclarations {
    fn new(
        scope_id: ScopeId,
        last_usage: &IdMap<DeclarationId, EvaluationOrder>,
        env: &Environment,
    ) -> Self {
        let mut declarations = Self {
            entries: FxHashMap::default(),
            next_position: 0,
            by_last_usage: BinaryHeap::new(),
            declaration_ids: FxHashMap::default(),
        };
        declarations.extend(scope_id, last_usage, env);
        declarations
    }

    /// TS: `declarations.set(key, value)` for each declaration of the scope.
    fn extend(
        &mut self,
        scope_id: ScopeId,
        last_usage: &IdMap<DeclarationId, EvaluationOrder>,
        env: &Environment,
    ) {
        for (key, value) in &env.scopes[scope_id.0 as usize].declarations {
            // The key of a declaration is its identifier, so a new value for a key has the
            // same last usage.
            debug_assert_eq!(*key, value.identifier);
            match self.entries.entry(*key) {
                std::collections::hash_map::Entry::Occupied(mut existing) => {
                    existing.get_mut().1 = value.clone();
                }
                std::collections::hash_map::Entry::Vacant(vacant) => {
                    vacant.insert((self.next_position, value.clone()));
                    self.next_position += 1;
                    let declaration_id =
                        env.identifiers[value.identifier.0 as usize].declaration_id;
                    *self.declaration_ids.entry(declaration_id).or_insert(0) += 1;
                    // If not tracked, keep the declaration (conservative)
                    if let Some(&last_used_at) = last_usage.get(declaration_id) {
                        self.by_last_usage
                            .push(Reverse((last_used_at, *key, declaration_id)));
                    }
                }
            }
        }
    }

    /// Updates scope declarations to remove any that are not used after the scope.
    fn update_scope_declarations(&mut self, range_end: EvaluationOrder) {
        while let Some(&Reverse((last_used_at, key, declaration_id))) = self.by_last_usage.peek() {
            if last_used_at >= range_end {
                break;
            }
            self.by_last_usage.pop();
            self.entries.remove(&key);
            if let Some(count) = self.declaration_ids.get_mut(&declaration_id) {
                *count -= 1;
            }
        }
    }

    fn len(&self) -> usize {
        self.entries.len()
    }

    fn iter(&self) -> impl Iterator<Item = &ReactiveScopeDeclaration> {
        self.entries.values().map(|(_position, decl)| decl)
    }

    fn has_declaration_id(&self, declaration_id: DeclarationId) -> bool {
        self.declaration_ids
            .get(&declaration_id)
            .is_some_and(|count| *count > 0)
    }

    fn into_declarations(self) -> HirVec<(IdentifierId, ReactiveScopeDeclaration)> {
        let mut entries: Vec<_> = self.entries.into_iter().collect();
        bun_collections::index_sort::sort_slice_unstable_by(
            &mut entries,
            |(_, (a, _)), (_, (b, _))| a.cmp(b),
        );
        AstAlloc::vec_from_iter(
            entries
                .into_iter()
                .map(|(key, (_position, decl))| (key, decl)),
        )
    }
}

/// Returns whether all lvalues are last used at or before the given scope.
fn are_lvalues_last_used_by_scope(
    scope_id: ScopeId,
    lvalues: &HashSet<DeclarationId>,
    last_usage: &IdMap<DeclarationId, EvaluationOrder>,
    env: &Environment,
) -> bool {
    let range_end = env.scopes[scope_id.0 as usize].range.end;
    for lvalue in lvalues {
        if let Some(&last_used_at) = last_usage.get(*lvalue) {
            if last_used_at >= range_end {
                return false;
            }
        }
    }
    true
}

/// Check if two scopes can be merged.
fn can_merge_scopes(
    current_id: ScopeId,
    current_declarations: &CandidateDeclarations,
    next_id: ScopeId,
    env: &Environment,
    temporaries: &IdMap<DeclarationId, DeclarationId>,
) -> bool {
    let current = &env.scopes[current_id.0 as usize];
    let next = &env.scopes[next_id.0 as usize];

    // Don't merge scopes with reassignments
    if !current.reassignments.is_empty() || !next.reassignments.is_empty() {
        return false;
    }

    // Merge scopes whose dependencies are identical
    if are_equal_dependencies(&current.dependencies, &next.dependencies, env) {
        return true;
    }

    // Merge scopes where outputs of current are inputs of next
    // Not in upstream: `are_equal_dependencies` compares the lengths first, so the synthetic
    // dependencies are built only when the lengths match.
    if current_declarations.len() == next.dependencies.len() {
        // Build synthetic dependencies from current's declarations
        let current_decl_deps: Vec<ReactiveScopeDependency> = current_declarations
            .iter()
            .map(|decl| ReactiveScopeDependency {
                identifier: decl.identifier,
                reactive: true,
                path: crate::hir_vec![],
                loc: None,
            })
            .collect();

        if are_equal_dependencies(&current_decl_deps, &next.dependencies, env) {
            return true;
        }
    }

    // Check if all next deps have empty paths, always-invalidating types,
    // and correspond to current declarations (possibly through temporaries)
    !next.dependencies.is_empty()
        && next.dependencies.iter().all(|dep| {
            if !dep.path.is_empty() {
                return false;
            }
            let dep_type = &env.types[env.identifiers[dep.identifier.0 as usize].type_.0 as usize];
            if !is_always_invalidating_type(dep_type) {
                return false;
            }
            let dep_decl = env.identifiers[dep.identifier.0 as usize].declaration_id;
            current_declarations.has_declaration_id(dep_decl)
                || temporaries
                    .get(dep_decl)
                    .is_some_and(|decl_id| current_declarations.has_declaration_id(*decl_id))
        })
}

/// Check if a type is always invalidating (guaranteed to change when inputs change).
pub fn is_always_invalidating_type(ty: &Type) -> bool {
    match ty {
        Type::Object { shape_id } => {
            matches!(
                *shape_id,
                Some(
                    BUILT_IN_ARRAY_ID | BUILT_IN_OBJECT_ID | BUILT_IN_FUNCTION_ID | BUILT_IN_JSX_ID
                )
            )
        }
        Type::Function { .. } => true,
        _ => false,
    }
}

/// Check if two dependency lists are equal.
fn are_equal_dependencies(
    a: &[ReactiveScopeDependency],
    b: &[ReactiveScopeDependency],
    env: &Environment,
) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for a_val in a {
        let a_decl = env.identifiers[a_val.identifier.0 as usize].declaration_id;
        let found = b.iter().any(|b_val| {
            let b_decl = env.identifiers[b_val.identifier.0 as usize].declaration_id;
            a_decl == b_decl && are_equal_paths(&a_val.path, &b_val.path)
        });
        if !found {
            return false;
        }
    }
    true
}

/// Check if two dependency paths are equal.
fn are_equal_paths(a: &[DependencyPathEntry], b: &[DependencyPathEntry]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .all(|(ai, bi)| ai.property == bi.property && ai.optional == bi.optional)
}

/// Check if a scope is eligible for merging with subsequent scopes.
fn scope_is_eligible_for_merging(scope_id: ScopeId, env: &Environment) -> bool {
    let scope = &env.scopes[scope_id.0 as usize];
    if scope.dependencies.is_empty() {
        // No dependencies means output never changes — eligible
        return true;
    }
    scope.declarations.iter().any(|(_key, decl)| {
        let ty = &env.types[env.identifiers[decl.identifier.0 as usize].type_.0 as usize];
        is_always_invalidating_type(ty)
    })
}
