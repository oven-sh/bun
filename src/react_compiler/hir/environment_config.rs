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
    /// `({ k: a, b } = o)` where a function captures `a` goes through temporaries, as `[a, b] = o` does. Upstream
    /// assigns `b` at once and `a` not, and fails: "Expected consistent kind for destructuring". So do both for `{ a, b }`.
    pub captured_targets_with_keys_force_temporaries: bool,
    /// Code that is not reached and has a function in it is reported at the first such function. Upstream reports it at
    /// its first instruction, which can be the declaration of a later function that the first one refers to.
    pub unreachable_code_is_reported_at_its_function: bool,
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
    pub validate_no_set_state_in_render: bool,
    pub enable_use_keyed_state: bool,
    pub validate_no_set_state_in_effects: bool,
    pub validate_no_derived_computations_in_effects: bool,
    pub validate_no_jsx_in_try_statements: bool,
    pub validate_static_components: bool,
    pub validate_no_capitalized_calls: Option<Vec<String>>,
    pub validate_blocklisted_imports: Option<Vec<String>>,
    pub validate_source_locations: bool,
    pub validate_no_impure_functions_in_render: bool,
    /// For `validate_no_impure_functions_in_render`: an async component renders once, for a request, so nothing in it
    /// is impure, nor in a function in it. An async hook is no component. Upstream reports it as in any component.
    pub async_components_render_once: bool,
    pub validate_no_freezing_known_mutable_functions: bool,
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
            jsx_can_be_reordered: true,
            arguments_of_no_alias_methods_escape: true,
            flat_map_and_for_each_have_aliasing_signatures: false,
            captured_targets_with_keys_force_temporaries: false,
            unreachable_code_is_reported_at_its_function: false,
            tagged_templates_are_always_called: false,
            branches_in_try_control_reactivity: false,
            throws_in_try_control_reactivity: false,
            outer_branches_control_reactivity: false,
            finally_blocks_are_lowered: false,
            pruned_throw_edges_are_removed_from_phis: false,
            react_is_known_by_its_module: true,
            dependencies_are_sorted_by_bytes: false,
            callback_dependencies_end_before_current: false,
            validate_no_set_state_in_render: true,
            enable_use_keyed_state: false,
            validate_no_set_state_in_effects: false,
            validate_no_derived_computations_in_effects: false,
            validate_no_jsx_in_try_statements: false,
            validate_static_components: false,
            validate_no_capitalized_calls: None,
            validate_blocklisted_imports: None,
            validate_source_locations: false,
            validate_no_impure_functions_in_render: false,
            async_components_render_once: false,
            validate_no_freezing_known_mutable_functions: false,
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
