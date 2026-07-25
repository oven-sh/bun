// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Compilation pipeline for a single function.
//!
//! Analogous to TS `Pipeline.ts` (`compileFn` → `run` → `runWithEnvironment`).
//!
//! Port of `react_compiler/entrypoint/pipeline.rs` — see DESIGN.md.
//!
//! Upstream's `ProgramContext` carries `timing` / `debug_enabled` /
//! `log_debug` / `log_event`; the Bun port's [`ProgramContext`] does not (Bun
//! has no Babel-shim debug surface), so the per-pass timing and
//! `log_debug(DebugLogEntry::new(...))` calls are dropped. The pass *sequence*
//! and gating predicates are kept byte-identical with upstream.

#![allow(
    clippy::disallowed_types,
    reason = "interops with vendored react_compiler_hir which uses std::collections"
)]

use std::collections::HashSet;

use crate::diagnostics::CompilerError;
use crate::hir::ReactFunctionType;
use crate::hir::environment::{Environment, OutputMode};
use crate::hir::environment_config::EnvironmentConfig;

use crate::codegen::{self, Codegen, CodegenFunction, OutlinedFunction};
use crate::collections::IndexMap;
use crate::hir::{StoreStr, VariableBinding};
use crate::imports::ProgramContext;
use crate::lowering::{self, FunctionNode};
use crate::program::Host;

// ---------------------------------------------------------------------------
// Per-pass timing (BUN_REACT_COMPILER_TIMING=1) — fixture/dev builds only.
// ---------------------------------------------------------------------------

#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
mod timing {
    use std::collections::BTreeMap;
    use std::sync::{Mutex, Once, OnceLock};

    static PASS_TIMING: Mutex<BTreeMap<&'static str, (u64, u32)>> = Mutex::new(BTreeMap::new());
    static TIMING_REGISTER: Once = Once::new();

    #[allow(clippy::disallowed_methods)]
    pub(super) fn enabled() -> bool {
        static ENABLED: OnceLock<bool> = OnceLock::new();
        *ENABLED.get_or_init(|| std::env::var_os("BUN_REACT_COMPILER_TIMING").is_some())
    }

    #[inline]
    pub(super) fn record(name: &'static str, ns: u64) {
        let mut m = PASS_TIMING.lock().unwrap();
        let e = m.entry(name).or_insert((0, 0));
        e.0 += ns;
        e.1 += 1;
    }

    #[allow(clippy::disallowed_macros)]
    extern "C" fn dump() {
        let m = PASS_TIMING.lock().unwrap();
        if m.is_empty() {
            return;
        }
        let mut v: Vec<_> = m.iter().collect();
        v.sort_unstable_by_key(|(_, (ns, _))| std::cmp::Reverse(*ns));
        let total: u64 = v.iter().map(|(_, (ns, _))| *ns).sum();
        eprintln!("── react_compiler pass timing ──");
        for (name, (ns, calls)) in v {
            eprintln!(
                "  {:>10.2}ms {:>5.1}%  {:>6}×  {}",
                *ns as f64 / 1e6,
                *ns as f64 / total as f64 * 100.0,
                calls,
                name
            );
        }
        eprintln!("  {:>10.2}ms total", total as f64 / 1e6);
    }

    pub(super) fn ensure_dump_registered() {
        if enabled() {
            TIMING_REGISTER.call_once(|| bun_core::add_exit_callback(dump));
        }
    }
}

#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
pub(crate) fn ensure_timing_dump_registered() {
    timing::ensure_dump_registered();
}
#[cfg(not(any(debug_assertions, bun_asan, feature = "fixtures")))]
#[inline(always)]
pub(crate) fn ensure_timing_dump_registered() {}

#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
macro_rules! timed {
    ($name:literal, $body:expr) => {{
        if timing::enabled() {
            let t0 = std::time::Instant::now();
            let r = $body;
            timing::record($name, t0.elapsed().as_nanos() as u64);
            r
        } else {
            $body
        }
    }};
}
#[cfg(not(any(debug_assertions, bun_asan, feature = "fixtures")))]
macro_rules! timed {
    ($name:literal, $body:expr) => {
        $body
    };
}

/// Run the compilation pipeline on a single function.
#[allow(clippy::too_many_arguments)]
pub fn compile_fn(
    func: &FunctionNode<'_>,
    fn_name: Option<&str>,
    host: &mut dyn Host,
    arena: &bun_alloc::Arena,
    fn_type: ReactFunctionType,
    env_config: &EnvironmentConfig,
    context: &mut ProgramContext,
    import_bindings: &IndexMap<bun_ast::Ref, VariableBinding>,
) -> Result<CodegenFunction, CompilerError> {
    let mut env = Environment::with_config(env_config.clone());
    env.fn_type = fn_type;
    env.output_mode = context.output_mode;
    // ProgramContext owns these `String`s for the whole compile; `StoreStr`
    // borrows their bytes under the same lifetime contract as arena slices.
    let borrow = |s: &Option<String>| s.as_deref().map(|s| StoreStr::new(s.as_bytes()));
    env.code = borrow(&context.code);
    env.filename = borrow(&context.filename);
    env.instrument_fn_name = borrow(&context.instrument_fn_name);
    env.instrument_gating_name = borrow(&context.instrument_gating_name);
    env.hook_guard_name = borrow(&context.hook_guard_name);
    let known: HashSet<StoreStr> = context
        .known_referenced_names()
        .iter()
        .map(|s| StoreStr::new(s.as_bytes()))
        .collect();
    env.seed_uid_known_names(&known);

    ensure_timing_dump_registered();

    let mut hir = timed!(
        "Lowering",
        lowering::lower(func, fn_name, &*host, &mut env, import_bindings)
    )?;

    // Copy renames from lowering to context (keep on env for codegen to apply to type annotations)
    if !env.renames.is_empty() {
        context.renames.extend(env.renames.iter().cloned());
    }

    // Upstream `lower()` ends with `if (builder.errors.hasAnyErrors()) return Err(...)`
    // before `builder.build()`, so any error recorded during lowering — Todo
    // (throw-in-try, var, …), Syntax, or Invariant — short-circuits the
    // pipeline. The Bun port records to `env.errors` instead; the equivalent
    // gate lives here so a function known to be rejected does not pay for
    // `run_hir_passes`.
    if env.has_errors() {
        return Err(env.take_errors());
    }

    let (reactive_fn, unique_identifiers) = run_hir_passes(&mut hir, &mut env, context)?;

    // Codegen emits the memo-cache call as `ident_expr("useMemoCache", ..)`;
    // seed that name with the import's local `Ref` so the call site and the
    // emitted `import { c as _c }` resolve to the same symbol. Opt-out
    // functions are filtered before this call (see `maybe_compile_node`), so a
    // spurious import is only possible when codegen itself errors below.
    // SSR mode never allocates memo slots, so skip the import to avoid emitting
    // an unused `react/compiler-runtime` import.
    let memo_seed = (context.output_mode == OutputMode::Client).then(|| {
        let memo_cache = context.add_memo_cache_import(host);
        memo_cache.name_ref
    });
    let mut cg = Codegen::new(host, arena, memo_seed);
    let codegen_result = timed!(
        "Codegen",
        codegen::codegen_function(&reactive_fn, &mut env, &mut cg, unique_identifiers)
    )?;

    #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
    if env.config.throw_unknown_exception_testonly {
        return Err(crate::diagnostics::cold_invariant(
            "unexpected error",
            None,
            None,
        ));
    }

    // Check for accumulated errors at the end of the pipeline
    // (matches TS Pipeline.ts: env.hasErrors() → Err at the end)
    if env.has_errors() {
        // Merge UIDs even on error: in TS, Babel's scope.generateUid() permanently
        // registers names in the scope's `uids` map regardless of whether the function
        // compilation succeeds or fails. Without this merge, failed compilations would
        // "leak" _temp names that subsequent successful compilations wouldn't see,
        // causing numbering mismatches vs TS.
        if let Some(uid_names) = env.take_uid_known_names() {
            context.merge_uid_known_names(
                &uid_names
                    .into_iter()
                    .map(|s| bun_core::BStr::new(s.slice()).to_string())
                    .collect(),
            );
        }
        return Err(env.take_errors());
    }

    // Re-compile outlined functions through the full pipeline.
    // This mirrors TS behavior where outlined functions from JSX outlining
    // are pushed back onto the compilation queue and compiled as components.
    // `fn_type` is only `Some` for entries produced by `outline_jsx`, which is
    // fixture-gated; without the feature, every entry passes through unchanged.
    let mut compiled_outlined: Vec<OutlinedFunction> = Vec::new();
    for o in codegen_result.outlined {
        #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
        if let Some(fn_type) = o.fn_type {
            let outlined_name = o.func.name_hint.clone();
            if let Ok(compiled) = compile_outlined_fn(
                o.func,
                outlined_name.as_deref(),
                host,
                arena,
                fn_type,
                env_config,
                context,
                import_bindings,
            ) {
                compiled_outlined.push(OutlinedFunction {
                    func: compiled,
                    fn_type: Some(fn_type),
                });
            }
            continue;
        }
        compiled_outlined.push(o);
    }

    if let Some(uid_names) = env.take_uid_known_names() {
        context.merge_uid_known_names(
            &uid_names
                .into_iter()
                .map(|s| bun_core::BStr::new(s.slice()).to_string())
                .collect(),
        );
    }

    Ok(CodegenFunction {
        outlined: compiled_outlined,
        ..codegen_result
    })
}

/// Compile an outlined function's codegen AST through the full pipeline.
///
/// Upstream builds a synthetic `FunctionDeclaration` + flat single-scope
/// `ScopeInfo` keyed by fake positions. Bun's lowering reads `Ref` directly
/// off identifier nodes, so the fake-position scaffolding is unnecessary: the
/// outlined `CodegenFunction` is wrapped in a `G::Fn` and re-lowered as-is.
#[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
#[allow(clippy::too_many_arguments)]
pub fn compile_outlined_fn(
    codegen_fn: CodegenFunction,
    fn_name: Option<&str>,
    host: &mut dyn Host,
    arena: &bun_alloc::Arena,
    fn_type: ReactFunctionType,
    env_config: &EnvironmentConfig,
    context: &mut ProgramContext,
    import_bindings: &IndexMap<bun_ast::Ref, VariableBinding>,
) -> Result<CodegenFunction, CompilerError> {
    use bun_alloc::AstAlloc;
    use bun_ast::{G, Loc, StoreSlice, flags};

    let mut env = Environment::with_config(env_config.clone());
    env.fn_type = fn_type;
    env.output_mode = context.output_mode;

    // Build a FunctionDeclaration from the codegen output
    let mut params: bun_alloc::AstVec<G::Arg> =
        AstAlloc::vec_with_capacity(codegen_fn.params.len());
    for p in codegen_fn.params {
        params.push(p);
    }
    let mut body: bun_alloc::AstVec<bun_ast::Stmt> =
        AstAlloc::vec_with_capacity(codegen_fn.body.len());
    for s in codegen_fn.body {
        body.push(s);
    }
    let mut fn_flags = flags::FUNCTION_NONE;
    if codegen_fn.is_async {
        fn_flags |= flags::Function::IsAsync;
    }
    if codegen_fn.generator {
        fn_flags |= flags::Function::IsGenerator;
    }
    if codegen_fn.has_rest_arg {
        fn_flags |= flags::Function::HasRestArg;
    }
    let outlined_decl = G::Fn {
        name: codegen_fn.id,
        args: StoreSlice::new_mut(params.leak()),
        body: G::FnBody {
            loc: Loc::EMPTY,
            stmts: StoreSlice::new_mut(body.leak()),
        },
        flags: fn_flags,
        ..G::Fn::default()
    };

    let func_node = FunctionNode::Function(&outlined_decl);
    let mut hir = lowering::lower(&func_node, fn_name, &*host, &mut env, import_bindings)?;

    if env.has_errors() {
        return Err(env.take_errors());
    }

    let (reactive_fn, unique_identifiers) = run_hir_passes(&mut hir, &mut env, context)?;

    let memo_seed = (context.output_mode == OutputMode::Client).then(|| {
        let memo_cache = context.add_memo_cache_import(host);
        memo_cache.name_ref
    });
    let mut cg = Codegen::new(host, arena, memo_seed);
    let codegen_result =
        codegen::codegen_function(&reactive_fn, &mut env, &mut cg, unique_identifiers)?;

    if env.has_errors() {
        return Err(env.take_errors());
    }

    Ok(codegen_result)
}

/// Run the compilation pipeline passes on an HIR function (everything after lowering).
///
/// This is extracted from `compile_fn` to allow reuse for outlined functions.
fn run_hir_passes(
    hir: &mut crate::hir::HirFunction,
    env: &mut Environment,
    context: &mut ProgramContext,
) -> Result<(crate::hir::reactive::ReactiveFunction, HashSet<String>), CompilerError> {
    timed!(
        "PruneMaybeThrows",
        crate::optimization::prune_maybe_throws(hir, &mut env.functions)
    )?;

    timed!(
        "ValidateContextVariableLValues",
        crate::validation::validate_context_variable_lvalues(hir, env)
    )?;

    let _void_memo_errors = timed!(
        "ValidateUseMemo",
        crate::validation::validate_use_memo(hir, env)
    );

    timed!(
        "DropManualMemoization",
        crate::optimization::drop_manual_memoization(hir, env)
    )?;

    timed!(
        "InlineImmediatelyInvokedFunctionExpressions",
        crate::optimization::inline_immediately_invoked_function_expressions(hir, env)
    );

    timed!(
        "MergeConsecutiveBlocks",
        crate::optimization::merge_consecutive_blocks::merge_consecutive_blocks(
            hir,
            &mut env.functions,
        )
    );

    timed!("EnterSSA", crate::ssa::enter_ssa(hir, env)).map_err(ssa_diag_to_error)?;

    timed!(
        "EliminateRedundantPhi",
        crate::ssa::eliminate_redundant_phi(hir, env)
    );

    timed!(
        "ConstantPropagation",
        crate::optimization::constant_propagation(hir, env)
    );

    timed!("InferTypes", crate::typeinference::infer_types(hir, env))?;

    if env.enable_validations() {
        if env.config.validate_hooks_usage {
            timed!(
                "ValidateHooksUsage",
                crate::validation::validate_hooks_usage(hir, env)
            )?;
        }

        #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
        if env.config.validate_no_jsx_in_try_statements && env.output_mode == OutputMode::Lint {
            let _ = timed!(
                "ValidateNoJSXInTryStatement",
                crate::validation::validate_no_jsx_in_try_statement(hir)
            );
        }

        #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
        if env.config.validate_no_capitalized_calls.is_some() {
            timed!(
                "ValidateNoCapitalizedCalls",
                crate::validation::validate_no_capitalized_calls(hir, env)
            )?;
        }
    }

    timed!(
        "OptimizePropsMethodCalls",
        crate::optimization::optimize_props_method_calls(hir, env)
    );

    timed!(
        "AnalyseFunctions",
        crate::inference::analyse_functions(hir, env, &mut |_inner_func, _inner_env| {})
    )?;

    if env.has_invariant_errors() {
        return Err(env.take_invariant_errors());
    }

    timed!(
        "InferMutationAliasingEffects",
        crate::inference::infer_mutation_aliasing_effects(hir, env, false)
    )?;

    if env.output_mode == OutputMode::Ssr {
        timed!(
            "OptimizeForSSR",
            crate::optimization::optimize_for_ssr(hir, env)
        );
    }

    timed!(
        "DeadCodeElimination",
        crate::optimization::dead_code_elimination(hir, env)
    );

    timed!(
        "PruneMaybeThrows2",
        crate::optimization::prune_maybe_throws(hir, &mut env.functions)
    )?;

    timed!(
        "InferMutationAliasingRanges",
        crate::inference::infer_mutation_aliasing_ranges(hir, env, false)
    )?;

    if env.enable_validations() {
        timed!(
            "ValidateLocalsNotReassignedAfterRender",
            crate::validation::validate_locals_not_reassigned_after_render(hir, env)
        );

        if env.config.validate_ref_access_during_render {
            timed!(
                "ValidateNoRefAccessInRender",
                crate::validation::validate_no_ref_access_in_render(hir, env)
            );
        }

        if env.config.validate_no_set_state_in_render {
            timed!(
                "ValidateNoSetStateInRender",
                crate::validation::validate_no_set_state_in_render(hir, env)
            )?;
        }

        #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
        if env.config.validate_no_set_state_in_effects && env.output_mode == OutputMode::Lint {
            let _ = timed!(
                "ValidateNoSetStateInEffects",
                crate::validation::validate_no_set_state_in_effects(hir, env)
            );
        }

        #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
        if env.config.validate_no_derived_computations_in_effects {
            timed!(
                "ValidateNoDerivedComputationsInEffects",
                crate::validation::validate_no_derived_computations_in_effects(hir, env)
            )?;
        }

        timed!(
            "ValidateNoFreezingKnownMutableFunctions",
            crate::validation::validate_no_freezing_known_mutable_functions(hir, env)
        );

        #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
        if env.config.validate_static_components && env.output_mode == OutputMode::Lint {
            let _ = timed!(
                "ValidateStaticComponents",
                crate::validation::validate_static_components(hir)
            );
        }
    }

    // Upstream `.unwrap()`s the four validations above, so a recorded error
    // throws here. The Bun ports record into `env.errors` and return `()`;
    // gate explicitly so the reactive-scope passes are not run on a function
    // the end-of-pipeline `has_errors()` check is going to discard anyway.
    if env.has_errors() {
        return Err(env.take_errors());
    }

    timed!(
        "InferReactivePlaces",
        crate::inference::infer_reactive_places(hir, env)
    )?;

    if env.enable_validations() {
        timed!(
            "ValidateExhaustiveDependencies",
            crate::validation::validate_exhaustive_dependencies(hir, env)
        )?;
    }

    timed!(
        "RewriteInstructionKindsBasedOnReassignment",
        crate::ssa::rewrite_instruction_kinds_based_on_reassignment(hir, env)
    )?;

    if env.enable_memoization() {
        timed!(
            "InferReactiveScopeVariables",
            crate::inference::infer_reactive_scope_variables(hir, env)
        )?;
    }

    let fbt_operands = timed!(
        "MemoizeFbtAndMacroOperandsInSameScope",
        crate::inference::memoize_fbt_and_macro_operands_in_same_scope(hir, env)
    );

    #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
    if env.config.enable_jsx_outlining {
        timed!("OutlineJSX", crate::optimization::outline_jsx(hir, env));
    }

    #[cfg(any(debug_assertions, bun_asan, feature = "fixtures"))]
    if env.config.enable_name_anonymous_functions {
        timed!(
            "NameAnonymousFunctions",
            crate::optimization::name_anonymous_functions(hir, env)
        );
    }

    if env.config.enable_function_outlining {
        timed!(
            "OutlineFunctions",
            crate::optimization::outline_functions(hir, env, &fbt_operands)
        );
    }

    timed!(
        "AlignMethodCallScopes",
        crate::inference::align_method_call_scopes(hir, env)
    );
    timed!(
        "AlignObjectMethodScopes",
        crate::inference::align_object_method_scopes(hir, env)
    );

    timed!(
        "PruneUnusedLabelsHIR",
        crate::optimization::prune_unused_labels_hir(hir)
    );

    timed!(
        "AlignReactiveScopesToBlockScopesHIR",
        crate::inference::align_reactive_scopes_to_block_scopes_hir(hir, env)
    );
    timed!(
        "MergeOverlappingReactiveScopesHIR",
        crate::inference::merge_overlapping_reactive_scopes_hir(hir, env)
    );

    timed!(
        "BuildReactiveScopeTerminalsHIR",
        crate::inference::build_reactive_scope_terminals_hir(hir, env)
    );

    timed!(
        "FlattenReactiveLoopsHIR",
        crate::inference::flatten_reactive_loops_hir(hir)
    );
    timed!(
        "FlattenScopesWithHooksOrUseHIR",
        crate::inference::flatten_scopes_with_hooks_or_use_hir(hir, env)
    )?;

    timed!(
        "PropagateScopeDependenciesHIR",
        crate::inference::propagate_scope_dependencies_hir(hir, env)
    );

    let mut reactive_fn = timed!(
        "BuildReactiveFunction",
        crate::reactive_scopes::build_reactive_function(hir, env)
    )?;

    timed!(
        "AssertWellFormedBreakTargets",
        crate::reactive_scopes::assert_well_formed_break_targets(&reactive_fn, env)
    );

    timed!(
        "PruneUnusedLabels",
        crate::reactive_scopes::prune_unused_labels(&mut reactive_fn, env)
    )?;

    timed!(
        "AssertScopeInstructionsWithinScopes",
        crate::reactive_scopes::assert_scope_instructions_within_scopes(&reactive_fn, env)
    )?;

    timed!(
        "PruneNonEscapingScopes",
        crate::reactive_scopes::prune_non_escaping_scopes(&mut reactive_fn, env)
    )?;
    timed!(
        "PruneNonReactiveDependencies",
        crate::reactive_scopes::prune_non_reactive_dependencies(&mut reactive_fn, env)
    );
    timed!(
        "PruneUnusedScopes",
        crate::reactive_scopes::prune_unused_scopes(&mut reactive_fn, env)
    )?;
    timed!(
        "MergeReactiveScopesThatInvalidateTogether",
        crate::reactive_scopes::merge_reactive_scopes_that_invalidate_together(
            &mut reactive_fn,
            env
        )
    )?;
    timed!(
        "PruneAlwaysInvalidatingScopes",
        crate::reactive_scopes::prune_always_invalidating_scopes(&mut reactive_fn, env)
    )?;
    timed!(
        "PropagateEarlyReturns",
        crate::reactive_scopes::propagate_early_returns(&mut reactive_fn, env)
    );
    timed!(
        "PruneUnusedLValues",
        crate::reactive_scopes::prune_unused_lvalues(&mut reactive_fn, env)
    );
    timed!(
        "PromoteUsedTemporaries",
        crate::reactive_scopes::promote_used_temporaries(&mut reactive_fn, env)
    );
    timed!(
        "ExtractScopeDeclarationsFromDestructuring",
        crate::reactive_scopes::extract_scope_declarations_from_destructuring(
            &mut reactive_fn,
            env
        )
    )?;
    timed!(
        "StabilizeBlockIds",
        crate::reactive_scopes::stabilize_block_ids(&mut reactive_fn, env)
    );

    let unique_identifiers = timed!(
        "RenameVariables",
        crate::reactive_scopes::rename_variables(&mut reactive_fn, env)
    );

    for name in &unique_identifiers {
        context.add_new_reference(name.clone());
    }

    timed!(
        "PruneHoistedContexts",
        crate::reactive_scopes::prune_hoisted_contexts(&mut reactive_fn, env)
    )?;

    if env.config.enable_preserve_existing_memoization_guarantees
        || env.config.validate_preserve_existing_memoization_guarantees
    {
        timed!(
            "ValidatePreservedManualMemoization",
            crate::validation::validate_preserved_manual_memoization(&reactive_fn, env)
        );
    }

    let _ = fbt_operands;
    Ok((reactive_fn, unique_identifiers))
}

#[cold]
#[inline(never)]
fn ssa_diag_to_error(diag: crate::diagnostics::CompilerDiagnostic) -> CompilerError {
    let loc = diag.primary_location().cloned();
    let mut err = CompilerError::new();
    err.push_error_detail(crate::diagnostics::CompilerErrorDetail {
        category: diag.category,
        reason: diag.reason,
        description: diag.description,
        loc,
        suggestions: diag.suggestions,
    });
    err
}
