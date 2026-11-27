// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Environment configuration, ported from EnvironmentConfigSchema in Environment.ts.
//!
//! Contains feature flags and custom hook definitions that control compiler behavior.

use crate::collections::FxHashMap as HashMap;

use crate::hir::Effect;
use crate::hir::type_config::{TypeConfig, ValueKind};

/// External function reference (source module + import name).
/// Corresponds to TS `ExternalFunction`.
#[derive(Debug, Clone)]
pub struct ExternalFunctionConfig {
    pub source: String,
    pub import_specifier_name: String,
}

/// Instrumentation configuration.
/// Corresponds to TS `InstrumentationSchema`.
#[derive(Debug, Clone)]
pub struct InstrumentationConfig {
    pub fn_: ExternalFunctionConfig,
    pub gating: Option<ExternalFunctionConfig>,
    pub global_gating: Option<String>,
}

/// Custom hook configuration, ported from TS `HookSchema`.
#[derive(Debug, Clone)]
pub struct HookConfig {
    pub effect_kind: Effect,
    pub value_kind: ValueKind,
    pub no_alias: bool,
    pub transitive_mixed_data: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExhaustiveEffectDepsMode {
    Off,
    All,
    MissingOnly,
    ExtraOnly,
}

/// Compiler environment configuration. Contains feature flags and settings.
///
/// Fields that would require passing JS functions across the JS/Rust boundary
/// are omitted with TODO comments. The Rust port uses hardcoded defaults for
/// these (e.g., `defaultModuleTypeProvider`).
#[derive(Debug, Clone)]
pub struct EnvironmentConfig {
    /// Custom hook type definitions, keyed by hook name.
    pub custom_hooks: HashMap<String, HookConfig>,

    /// Pre-resolved module type provider results.
    /// Map from module name to TypeConfig, computed by the JS shim.
    pub module_type_provider: Option<crate::collections::IndexMap<String, TypeConfig>>,

    /// Custom macro-like function names that should have their operands
    /// memoized in the same scope (similar to fbt).
    pub custom_macros: Option<Vec<String>>,

    /// If true, emit code to reset the memo cache on source file changes (HMR/fast refresh).
    /// If null (None), HMR detection is conditionally enabled based on NODE_ENV/__DEV__.
    pub enable_reset_cache_on_source_file_changes: Option<bool>,

    pub enable_preserve_existing_memoization_guarantees: bool,
    pub validate_preserve_existing_memoization_guarantees: bool,
    pub validate_exhaustive_memoization_dependencies: bool,
    pub validate_exhaustive_effect_dependencies: ExhaustiveEffectDepsMode,

    // TODO: flowTypeProvider — requires JS function callback.
    pub enable_optional_dependencies: bool,
    pub enable_name_anonymous_functions: bool,
    pub validate_hooks_usage: bool,
    pub validate_ref_access_during_render: bool,
    /// For `validate_ref_access_during_render`: a ref value that meets a value of another kind, at a
    /// phi or in an object, stays the ref value that it was. It is then reported where `.current`
    /// is read. Upstream forgets where that was, and reports it at each use.
    pub joined_ref_values_keep_their_place: bool,
    /// For `validate_ref_access_during_render`: a function or an object with no ref in it that grows where it is
    /// joined, as `x = { x }` in a loop does, asks for no other round. To upstream it does, each round, and fails:
    /// "Ref type environment did not converge".
    pub growth_of_ref_free_structures_is_no_change: bool,
    /// For `validate_ref_access_during_render`: a property whose type is a ref's, as `props.inputRef` in
    /// `<input ref={props.inputRef} />`, is a ref of its own. To upstream it stands for its object, which is then
    /// that ref, and `props.value` is reported as its value.
    pub ref_typed_properties_are_refs_of_their_own: bool,
    /// For `validate_ref_access_during_render`: `ref.current ?? (ref.current = init)` sets the ref once, as
    /// `if (ref.current == null) ref.current = init` does. Upstream reports both the read and the write.
    pub nullish_test_before_ref_init_is_a_guard: bool,
    /// An effect on a variable is reported where it is. Upstream puts the first effect of a kind on a variable for
    /// all the later ones, so that each write to a captured variable is reported at the first.
    pub effects_keep_their_place: bool,
    /// A function that is mutated calls, of the functions that it has captured, only those that it calls itself: a
    /// `map` callback that makes `() => save(item)` for `onClick` does not call `save`. To upstream it calls them all,
    /// and what `save` does is done during render.
    pub capturing_a_function_is_not_calling_it: bool,
    /// A function declaration has its value where its scope begins, so a frozen function that captured it earlier, as
    /// in `useHook(() => f())` before `function f() {}`, has not read it too early. Upstream reports the declaration as
    /// an access before it, and mostly loses the report when `PruneHoistedContexts` fails. A write to `f` is reported.
    pub function_declarations_are_initialized_on_entry: bool,
    /// The name that a function expression has in its own scope has the function for its value on entry, as a
    /// parameter has its argument: `HirFunction::self_binding`. The function does not capture it, and a write to it is
    /// a reassignment. Upstream has a variable for it that nothing defines, and fails where it is read: "Expected
    /// value kind to be initialized".
    pub function_expressions_define_their_own_name: bool,
    /// JSX that is a default, or in one, can be evaluated earlier if its operands can: the parser has made a call of
    /// it. Upstream does not compile such a function.
    pub jsx_can_be_reordered: bool,
    /// What is passed to a method of a mutable array escapes by the array, also for `map`, `filter` and the like, whose
    /// signatures say that they keep none of their arguments. To upstream nothing escapes so.
    pub arguments_of_no_alias_methods_escape: bool,
    /// `flatMap` and `forEach` of an array say, as `map` does, that they call their callback with an item of the array
    /// and what becomes of its result. The methods of arrays, sets and maps that take a callback or store a value have
    /// a name, and so have the constructors of the collections. Upstream says this of `map` only, knows no `forEach`
    /// of an array, and names none. The shapes are those of `globals::OXLINT_BASE`.
    pub flat_map_and_for_each_have_aliasing_signatures: bool,
    /// `x++` and `--x` of a variable that a function captures are lowered. Upstream has a todo for them. What is
    /// reassigned after render is found by `validate_captured_reassignments`, which follows the values that a captured
    /// variable holds, and what an async function reads of them, rather than by upstream's pass.
    pub captured_variables_can_be_updated: bool,
    /// `a.b++` and `--a[k]` update a copy of the member in a local and store the copy, and their value is a constant
    /// of its own. Upstream stores `a.b + 1`, and the value is what was loaded or what was stored.
    pub member_updates_go_through_a_local: bool,
    /// `({ k: a, b } = o)` where a function captures `a` goes through temporaries, as `[a, b] = o` does. Upstream
    /// assigns `b` at once and `a` not, and fails: "Expected consistent kind for destructuring". So do both for `{ a, b }`.
    pub captured_targets_with_keys_force_temporaries: bool,
    /// `a ??= b` is lowered as `a ?? (a = b)`, and so are `||=` and `&&=`. The target is evaluated once, before the
    /// test, and the object and the key of a member are kept in constants for the store. One to a `const` is a todo of
    /// its own and does not reassign it. Upstream has one todo for all of them.
    pub logical_assignments_are_lowered: bool,
    /// A chain of members, `a.b.c`, is lowered along its length and not by a call for each member, and one of more than
    /// 500 members is a todo. Upstream lowers each member by a call, as long as there is stack for it.
    pub member_chains_have_a_limit: bool,
    /// Code that is not reached and has a function in it is reported at the first such function. Upstream reports it at
    /// its first instruction, which can be the declaration of a later function that the first one refers to.
    pub unreachable_code_is_reported_at_its_function: bool,
    /// A class declaration or a `with` statement is an error and leaves no instruction. Upstream lowers an
    /// `UnsupportedNode` for it, and its temporary takes an identifier number, which the text of an invariant shows.
    pub unsupported_statements_leave_no_instruction: bool,
    /// A tag can make something new of the same template each time. So a tagged template is a source of reactivity, and
    /// no scope that it is in is kept, unless the signature of the tag says that it is pure. To upstream it is a call.
    pub tagged_templates_are_always_called: bool,
    /// For `infer_reactive_places`: what a branch in a `try` block assigns is reactive if what the branch tests is. To
    /// upstream the edge from each store to the `catch` hides the branch, and what is assigned is constant.
    pub branches_in_try_control_reactivity: bool,
    /// For `infer_reactive_places`: a block that may throw to a `catch` decides what follows it and what the `catch`
    /// assigns, as a branch does, if it reads a reactive value or something reactive decides it. To upstream a throw
    /// decides nothing.
    pub throws_in_try_control_reactivity: bool,
    /// For `infer_reactive_places`: what decides a branch decides what the branch decides. To upstream only `b` decides
    /// `x` in `if (a) { x = 1; if (b) return; }`.
    pub outer_branches_control_reactivity: bool,
    /// The `finally` block of a `try` is lowered after the rest of it, and so is the `try` block that has no `catch`:
    /// the function is not compiled, and the rules see what the blocks use. Upstream lowers neither.
    pub finally_blocks_are_lowered: bool,
    /// For `prune_maybe_throws`: with the edge to a `catch` go the operands that phis have for it and the phis that are
    /// then redundant, and a `catch` that is no longer reached is no predecessor of what follows the `try`. Upstream
    /// keeps them, and fails: "Found a block with a single predecessor but where a phi has multiple operands".
    pub pruned_throw_edges_are_removed_from_phis: bool,
    /// `React.useMemo` is React's if `React` is imported from React, under whatever name. To upstream it is if the name
    /// is `React`, wherever that comes from.
    pub react_is_known_by_its_module: bool,
    /// For `validate_exhaustive_*_dependencies`: the dependencies that are inferred are in the order of their bytes.
    /// Upstream's are in that of `localeCompare`: `a`, `A`, `b`.
    pub dependencies_are_sorted_by_bytes: bool,
    /// What a function depends on ends before `.current`: `x.a` for the `x.a.current.b` that a callback reads. `x` can
    /// be a ref whose type is not known, and its scope would read it during render. Upstream takes the whole path.
    pub callback_dependencies_end_before_current: bool,
    /// For a linter that wants neither a `Todo` nor an `Invariant`: what comes after the validations of the HIR runs
    /// only for a function that has `useMemo` or `useCallback` in its own body, and its reactivity is inferred only
    /// for that or for its own call of an effect hook. What the rest would throw then drops nothing that is recorded.
    /// For a linter that wants either, all of it runs for every function. Upstream runs all of it, and what a pass
    /// throws is all that is said of the function.
    pub unwanted_throws_are_not_looked_for: bool,
    /// `shared-runtime` and the other modules of upstream's test fixtures have no types: what is imported from one is
    /// as from any module. Upstream's test runner gives them types, which `default_module_type_provider` has.
    pub fixture_modules_have_no_types: bool,
    /// For what a block declares before the statement that refers to it: the tag of a JSX element is no such
    /// reference, in a nested function either, so `<Foo />` before `function Foo() {}` reads `Foo` before it is
    /// defined. And the early declaration is where the first such reference is. So it is upstream. Bun's lowering
    /// takes a tag for a reference, as `Foo()` is one, and has the early declaration at the declared name.
    /// What one statement declares early is in the order of those first references, as upstream. Bun's lowering has
    /// it in the order of the declarations. And nothing in a class is such a reference, not what it extends and not
    /// its members: that is oxc, whose index of references has none of a class. Upstream and Bun's lowering see them.
    pub jsx_tags_hoist_no_declaration: bool,
    /// For `infer_types`: an arithmetic or relational operator says nothing of the type of its operands, so `x` in
    /// `x - 1` can still be an object that is written to elsewhere. To upstream both operands are primitives wherever
    /// they are used, and a write to one or a dependency on one is not seen.
    pub operators_say_nothing_of_their_operands: bool,
    /// For `merge_reactive_scopes_that_invalidate_together`: in a `useMemo` callback a scope without dependencies is
    /// merged into the scope after it, and depends on what that one does. What is computed between the two is replaced
    /// by what it is computed from, reactive or not: `x` and `id` for the `x + id` between `new Map()` and the object
    /// that holds both. Upstream keeps the two scopes apart, and the `Map` is created once.
    pub scopes_without_dependencies_in_use_memo_are_merged: bool,
    /// For `propagate_scope_dependencies_hir`: a function that is given to JSX, as a prop or a child, is not assumed
    /// to be called, so what it reads is no dependency that is read during render. Upstream assumes the call.
    pub functions_given_to_jsx_are_not_assumed_called: bool,
    /// For `propagate_scope_dependencies_hir`: a call in a branch or in a loop does not show that a function is called
    /// during render, be it the function that is called or one given to a hook there. To upstream any call shows it.
    pub calls_in_branches_show_no_function_called: bool,
    /// For `propagate_scope_dependencies_hir`: what follows an optional link without `?.`, as `.b` in `x?.a.b`, is a
    /// dependency beside `x?.a`. If it cannot be read early, or is a call or a computed load, the dependency is the
    /// guard of the last optional link: `x.a.b` for `x.a.b?.c.d`. Upstream lets `x?.a` stand for all of it, and a
    /// scope that kept `undefined` for an `x` that was nullish does not run again to throw.
    pub optional_chains_keep_their_guards: bool,
    /// `1n` is a primitive, with its value in decimal. `constant_propagation` knows whether one is zero and whether
    /// two are equal, and does not fold `==` of one and a value of another kind, as `1n == null`. Upstream has a todo.
    pub bigint_literals_are_primitives: bool,
    /// For `constant_propagation`: a string with half of a surrogate pair has no known length, and is not joined with
    /// another, by `+` or in a template. To upstream it is a string as any other.
    pub lone_surrogates_are_not_folded: bool,
    pub validate_no_set_state_in_render: bool,
    pub enable_use_keyed_state: bool,
    pub validate_no_set_state_in_effects: bool,
    pub validate_no_derived_computations_in_effects: bool,
    pub validate_no_jsx_in_try_statements: bool,
    pub validate_static_components: bool,
    pub validate_no_capitalized_calls: Option<Vec<String>>,
    /// For `validate_no_capitalized_calls`: a method whose name is all in capitals, as `Date.UTC`, is no component, as
    /// a function with such a name is none. Upstream reports the call of any method whose name begins with a capital.
    pub methods_in_capitals_are_not_components: bool,
    pub validate_blocklisted_imports: Option<Vec<String>>,
    pub validate_source_locations: bool,
    pub validate_no_impure_functions_in_render: bool,
    /// For `validate_no_impure_functions_in_render`: an async component renders once, for a request, so nothing in it
    /// is impure, nor in a function in it. An async hook is no component. Upstream reports it as in any component.
    pub async_components_render_once: bool,
    pub validate_no_freezing_known_mutable_functions: bool,
    /// For `validate_no_freezing_known_mutable_functions`: a function that is frozen is reported where it is written,
    /// through the loads and the stores that brought it to where it is frozen. Upstream reports it there, which is
    /// the call of `useMemo` for a function that the callback of one returns.
    pub frozen_functions_are_reported_where_written: bool,
    pub enable_assume_hooks_follow_rules_of_react: bool,
    pub enable_transitively_freeze_function_expressions: bool,

    /// Hook guard configuration. When set, wraps hook calls with dispatcher guard calls.
    pub enable_emit_hook_guards: Option<ExternalFunctionConfig>,

    /// Instrumentation configuration. When set, emits calls to instrument functions.
    pub enable_emit_instrument_forget: Option<InstrumentationConfig>,

    pub enable_function_outlining: bool,
    pub enable_jsx_outlining: bool,
    pub assert_valid_mutable_ranges: bool,
    pub throw_unknown_exception_testonly: bool,
    pub enable_custom_type_definition_for_reanimated: bool,
    pub enable_treat_ref_like_identifiers_as_refs: bool,
    pub enable_treat_set_identifiers_as_state_setters: bool,
    pub validate_no_void_use_memo: bool,
    pub enable_allow_set_state_from_refs_in_effects: bool,
    pub enable_verbose_no_set_state_in_effect: bool,

    // 🌲
    pub enable_forest: bool,
}

impl Default for EnvironmentConfig {
    fn default() -> Self {
        Self {
            custom_hooks: HashMap::default(),
            enable_reset_cache_on_source_file_changes: None,
            module_type_provider: None,
            enable_preserve_existing_memoization_guarantees: true,
            validate_preserve_existing_memoization_guarantees: true,
            validate_exhaustive_memoization_dependencies: false,
            validate_exhaustive_effect_dependencies: ExhaustiveEffectDepsMode::Off,
            enable_optional_dependencies: true,
            enable_name_anonymous_functions: false,
            validate_hooks_usage: true,
            validate_ref_access_during_render: true,
            joined_ref_values_keep_their_place: false,
            growth_of_ref_free_structures_is_no_change: false,
            ref_typed_properties_are_refs_of_their_own: false,
            nullish_test_before_ref_init_is_a_guard: false,
            effects_keep_their_place: false,
            capturing_a_function_is_not_calling_it: false,
            function_declarations_are_initialized_on_entry: false,
            function_expressions_define_their_own_name: false,
            jsx_can_be_reordered: true,
            arguments_of_no_alias_methods_escape: true,
            flat_map_and_for_each_have_aliasing_signatures: false,
            captured_variables_can_be_updated: false,
            member_updates_go_through_a_local: false,
            captured_targets_with_keys_force_temporaries: false,
            logical_assignments_are_lowered: false,
            member_chains_have_a_limit: false,
            unreachable_code_is_reported_at_its_function: false,
            unsupported_statements_leave_no_instruction: false,
            tagged_templates_are_always_called: false,
            branches_in_try_control_reactivity: false,
            throws_in_try_control_reactivity: false,
            outer_branches_control_reactivity: false,
            finally_blocks_are_lowered: false,
            pruned_throw_edges_are_removed_from_phis: false,
            react_is_known_by_its_module: true,
            dependencies_are_sorted_by_bytes: false,
            callback_dependencies_end_before_current: false,
            unwanted_throws_are_not_looked_for: false,
            fixture_modules_have_no_types: false,
            jsx_tags_hoist_no_declaration: false,
            operators_say_nothing_of_their_operands: false,
            scopes_without_dependencies_in_use_memo_are_merged: false,
            functions_given_to_jsx_are_not_assumed_called: false,
            calls_in_branches_show_no_function_called: false,
            optional_chains_keep_their_guards: false,
            bigint_literals_are_primitives: false,
            lone_surrogates_are_not_folded: false,
            validate_no_set_state_in_render: true,
            enable_use_keyed_state: false,
            validate_no_set_state_in_effects: false,
            validate_no_derived_computations_in_effects: false,
            validate_no_jsx_in_try_statements: false,
            validate_static_components: false,
            validate_no_capitalized_calls: None,
            methods_in_capitals_are_not_components: false,
            validate_blocklisted_imports: None,
            validate_source_locations: false,
            validate_no_impure_functions_in_render: false,
            async_components_render_once: false,
            validate_no_freezing_known_mutable_functions: false,
            frozen_functions_are_reported_where_written: false,
            enable_assume_hooks_follow_rules_of_react: true,
            enable_transitively_freeze_function_expressions: true,
            enable_emit_hook_guards: None,
            enable_emit_instrument_forget: None,
            enable_function_outlining: true,
            enable_jsx_outlining: false,
            assert_valid_mutable_ranges: false,
            throw_unknown_exception_testonly: false,
            enable_custom_type_definition_for_reanimated: false,
            enable_treat_ref_like_identifiers_as_refs: true,
            enable_treat_set_identifiers_as_state_setters: false,
            validate_no_void_use_memo: true,
            enable_allow_set_state_from_refs_in_effects: true,
            enable_verbose_no_set_state_in_effect: false,
            enable_forest: false,
            custom_macros: None,
        }
    }
}
