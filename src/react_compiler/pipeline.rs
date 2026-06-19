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
use crate::hir::VariableBinding;
use crate::imports::ProgramContext;
use crate::lowering::{self, FunctionNode};
use crate::program::Host;
use indexmap::IndexMap;

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
    env.output_mode = OutputMode::Client;
    env.code = context.code.clone();
    env.filename = context.filename.clone();
    env.instrument_fn_name = context.instrument_fn_name.clone();
    env.instrument_gating_name = context.instrument_gating_name.clone();
    env.hook_guard_name = context.hook_guard_name.clone();
    let known: HashSet<String> = context.known_referenced_names().iter().cloned().collect();
    env.seed_uid_known_names(&known);

    let mut hir = lowering::lower(func, fn_name, &*host, &mut env, import_bindings)?;

    // Copy renames from lowering to context (keep on env for codegen to apply to type annotations)
    if !env.renames.is_empty() {
        context.renames.extend(env.renames.iter().cloned());
    }

    // Check for Invariant errors after lowering, before logging HIR.
    // In TS, Invariant errors throw from recordError(), aborting lower() before
    // the HIR entry is logged. The thrown error contains ONLY the Invariant error,
    // not other recorded (non-Invariant) errors.
    if env.has_invariant_errors() {
        return Err(env.take_invariant_errors());
    }

    let (reactive_fn, unique_identifiers) = run_hir_passes(&mut hir, &mut env, context)?;

    // Codegen emits the memo-cache call as `ident_expr("useMemoCache", ..)`;
    // seed that name with the import's local `Ref` so the call site and the
    // emitted `import { c as _c }` resolve to the same symbol. Opt-out
    // functions are filtered before this call (see `maybe_compile_node`), so a
    // spurious import is only possible when codegen itself errors below.
    let memo_cache = context.add_memo_cache_import(host);
    let mut cg = Codegen::new(
        host,
        arena,
        [("useMemoCache".to_string(), memo_cache.name_ref)],
    );
    let codegen_result =
        codegen::codegen_function(&reactive_fn, &mut env, &mut cg, unique_identifiers)?;

    // Simulate unexpected exception for testing (matches TS Pipeline.ts)
    if env.config.throw_unknown_exception_testonly {
        let mut err = CompilerError::new();
        err.push_error_detail(crate::diagnostics::CompilerErrorDetail {
            category: crate::diagnostics::ErrorCategory::Invariant,
            reason: "unexpected error".to_string(),
            description: None,
            loc: None,
            suggestions: None,
        });
        return Err(err);
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
            context.merge_uid_known_names(&uid_names.into_iter().collect());
        }
        return Err(env.take_errors());
    }

    // Re-compile outlined functions through the full pipeline.
    // This mirrors TS behavior where outlined functions from JSX outlining
    // are pushed back onto the compilation queue and compiled as components.
    let mut compiled_outlined: Vec<OutlinedFunction> = Vec::new();
    for o in codegen_result.outlined {
        if let Some(fn_type) = o.fn_type {
            let outlined_name = o.func.name_hint.clone();
            match compile_outlined_fn(
                o.func,
                outlined_name.as_deref(),
                host,
                arena,
                fn_type,
                env_config,
                context,
                import_bindings,
            ) {
                Ok(compiled) => {
                    compiled_outlined.push(OutlinedFunction {
                        func: compiled,
                        fn_type: Some(fn_type),
                    });
                }
                Err(_err) => {
                    // If re-compilation fails, skip the outlined function
                }
            }
        } else {
            compiled_outlined.push(o);
        }
    }

    if let Some(uid_names) = env.take_uid_known_names() {
        context.merge_uid_known_names(&uid_names.into_iter().collect());
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
    env.output_mode = OutputMode::Client;

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

    if env.has_invariant_errors() {
        return Err(env.take_invariant_errors());
    }

    let (reactive_fn, unique_identifiers) = run_hir_passes(&mut hir, &mut env, context)?;

    let memo_cache = context.add_memo_cache_import(host);
    let mut cg = Codegen::new(
        host,
        arena,
        [("useMemoCache".to_string(), memo_cache.name_ref)],
    );
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
    crate::optimization::prune_maybe_throws(hir, &mut env.functions)?;

    crate::validation::validate_context_variable_lvalues(hir, env)?;

    let _void_memo_errors = crate::validation::validate_use_memo(hir, env);

    crate::optimization::drop_manual_memoization(hir, env)?;

    crate::optimization::inline_immediately_invoked_function_expressions(hir, env);

    crate::optimization::merge_consecutive_blocks::merge_consecutive_blocks(
        hir,
        &mut env.functions,
    );

    crate::ssa::enter_ssa(hir, env).map_err(|diag| {
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
    })?;

    crate::ssa::eliminate_redundant_phi(hir, env);

    crate::optimization::constant_propagation(hir, env);

    crate::typeinference::infer_types(hir, env)?;

    if env.enable_validations() {
        if env.config.validate_hooks_usage {
            crate::validation::validate_hooks_usage(hir, env)?;
        }

        if env.config.validate_no_jsx_in_try_statements {
            let errors = crate::validation::validate_no_jsx_in_try_statement(hir);
            env.errors.merge(errors);
        }

        if env.config.validate_no_capitalized_calls.is_some() {
            crate::validation::validate_no_capitalized_calls(hir, env)?;
        }
    }

    crate::optimization::optimize_props_method_calls(hir, env);

    crate::inference::analyse_functions(hir, env, &mut |_inner_func, _inner_env| {})?;

    if env.has_invariant_errors() {
        return Err(env.take_invariant_errors());
    }

    crate::inference::infer_mutation_aliasing_effects(hir, env, false)?;

    if env.output_mode == OutputMode::Ssr {
        crate::optimization::optimize_for_ssr(hir, env);
    }

    crate::optimization::dead_code_elimination(hir, env);

    crate::optimization::prune_maybe_throws(hir, &mut env.functions)?;

    crate::inference::infer_mutation_aliasing_ranges(hir, env, false)?;

    if env.enable_validations() {
        crate::validation::validate_locals_not_reassigned_after_render(hir, env);

        if env.config.validate_ref_access_during_render {
            crate::validation::validate_no_ref_access_in_render(hir, env);
        }

        if env.config.validate_no_set_state_in_render {
            crate::validation::validate_no_set_state_in_render(hir, env)?;
        }

        if env.config.validate_no_set_state_in_effects {
            let errors = crate::validation::validate_no_set_state_in_effects(hir, env)?;
            env.errors.merge(errors);
        }

        if env.config.validate_no_derived_computations_in_effects {
            crate::validation::validate_no_derived_computations_in_effects(hir, env)?;
        }

        crate::validation::validate_no_freezing_known_mutable_functions(hir, env);

        if env.config.validate_static_components {
            let errors = crate::validation::validate_static_components(hir);
            env.errors.merge(errors);
        }
    }

    crate::inference::infer_reactive_places(hir, env)?;

    if env.enable_validations() {
        crate::validation::validate_exhaustive_dependencies(hir, env)?;
    }

    crate::ssa::rewrite_instruction_kinds_based_on_reassignment(hir, env)?;

    if env.enable_memoization() {
        crate::inference::infer_reactive_scope_variables(hir, env)?;
    }

    let fbt_operands = crate::inference::memoize_fbt_and_macro_operands_in_same_scope(hir, env);

    if env.config.enable_jsx_outlining {
        crate::optimization::outline_jsx(hir, env);
    }

    if env.config.enable_name_anonymous_functions {
        crate::optimization::name_anonymous_functions(hir, env);
    }

    if env.config.enable_function_outlining {
        crate::optimization::outline_functions(hir, env, &fbt_operands);
    }

    crate::inference::align_method_call_scopes(hir, env);
    crate::inference::align_object_method_scopes(hir, env);

    crate::optimization::prune_unused_labels_hir(hir);

    crate::inference::align_reactive_scopes_to_block_scopes_hir(hir, env);
    crate::inference::merge_overlapping_reactive_scopes_hir(hir, env);

    crate::inference::build_reactive_scope_terminals_hir(hir, env);

    crate::inference::flatten_reactive_loops_hir(hir);
    crate::inference::flatten_scopes_with_hooks_or_use_hir(hir, env)?;

    crate::inference::propagate_scope_dependencies_hir(hir, env);

    let mut reactive_fn = crate::reactive_scopes::build_reactive_function(hir, env)?;

    crate::reactive_scopes::assert_well_formed_break_targets(&reactive_fn, env);

    crate::reactive_scopes::prune_unused_labels(&mut reactive_fn, env)?;

    crate::reactive_scopes::assert_scope_instructions_within_scopes(&reactive_fn, env)?;

    crate::reactive_scopes::prune_non_escaping_scopes(&mut reactive_fn, env)?;
    crate::reactive_scopes::prune_non_reactive_dependencies(&mut reactive_fn, env);
    crate::reactive_scopes::prune_unused_scopes(&mut reactive_fn, env)?;
    crate::reactive_scopes::merge_reactive_scopes_that_invalidate_together(&mut reactive_fn, env)?;
    crate::reactive_scopes::prune_always_invalidating_scopes(&mut reactive_fn, env)?;
    crate::reactive_scopes::propagate_early_returns(&mut reactive_fn, env);
    crate::reactive_scopes::prune_unused_lvalues(&mut reactive_fn, env);
    crate::reactive_scopes::promote_used_temporaries(&mut reactive_fn, env);
    crate::reactive_scopes::extract_scope_declarations_from_destructuring(&mut reactive_fn, env)?;
    crate::reactive_scopes::stabilize_block_ids(&mut reactive_fn, env);

    let unique_identifiers = crate::reactive_scopes::rename_variables(&mut reactive_fn, env);

    for name in &unique_identifiers {
        context.add_new_reference(name.clone());
    }

    crate::reactive_scopes::prune_hoisted_contexts(&mut reactive_fn, env)?;

    if env.config.enable_preserve_existing_memoization_guarantees
        || env.config.validate_preserve_existing_memoization_guarantees
    {
        crate::validation::validate_preserved_manual_memoization(&reactive_fn, env);
    }

    let _ = fbt_operands;
    Ok((reactive_fn, unique_identifiers))
}
