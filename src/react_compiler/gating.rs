// Gating rewrite logic for compiled functions.
//
// When gating is enabled, the compiled function is wrapped in a conditional:
// `gating() ? optimized_fn : original_fn`
//
// For function declarations referenced before their declaration, a special
// hoisting pattern is used (see `insert_additional_function_declaration`).
//
// Ported from `Entrypoint/Gating.ts`.

use crate::diagnostics::CompilerDiagnostic;
use crate::diagnostics::ErrorCategory;
use bun_alloc::{Arena, AstAlloc};
use bun_ast::stmt::Data as StmtData;
use bun_ast::{
    Binding, Expr, Loc, LocRef, Ref, Stmt, StmtOrExpr, StoreSlice, b, e as E, flags, g as G, s as S,
};

use super::imports::ProgramContext;
use super::program::Host;

/// Gating configuration (port of upstream `plugin_options::GatingConfig`).
#[derive(Debug, Clone)]
pub(crate) struct GatingConfig {
    pub source: String,
    pub import_specifier_name: String,
}

/// A compiled function node, can be any function type.
pub(crate) enum CompiledFunctionNode {
    FunctionDeclaration(G::Fn),
    FunctionExpression(G::Fn),
    ArrowFunctionExpression(E::Arrow),
}

/// Represents a compiled function that needs gating.
/// In the Rust version, we work with indices into the program body
/// rather than Babel paths.
pub(crate) struct GatingRewrite {
    /// Index in program.body where the original function is
    pub original_index: usize,
    /// The compiled function AST node
    pub compiled_fn: CompiledFunctionNode,
    /// The gating config
    pub gating: GatingConfig,
    /// Whether the function is referenced before its declaration at top level
    pub referenced_before_declared: bool,
    /// Whether the parent statement is an ExportDefaultDeclaration
    pub is_export_default: bool,
}

/// Apply gating rewrites to the program.
/// This modifies program.body by replacing/inserting statements.
///
/// Corresponds to `insertGatedFunctionDeclaration` in the TS version,
/// but batched: all rewrites are collected first, then applied in reverse
/// index order to maintain validity of earlier indices.
pub(crate) fn apply_gating_rewrites(
    body: &mut Vec<Stmt>,
    mut rewrites: Vec<GatingRewrite>,
    context: &mut ProgramContext,
    host: &mut dyn Host,
    arena: &Arena,
) -> Result<(), CompilerDiagnostic> {
    // Sort rewrites in reverse order by original_index so that insertions
    // at higher indices don't invalidate lower indices.
    rewrites.sort_unstable_by_key(|r| core::cmp::Reverse(r.original_index));

    for rewrite in rewrites {
        let gating_imported = context.add_import_specifier(
            host,
            &rewrite.gating.source,
            &rewrite.gating.import_specifier_name,
            None,
        );
        let gating_imported_name = gating_imported.name.clone();
        let gating_imported_ref = gating_imported.name_ref;

        if rewrite.referenced_before_declared {
            // The referenced-before-declared case only applies to FunctionDeclarations
            if let CompiledFunctionNode::FunctionDeclaration(compiled) = rewrite.compiled_fn {
                insert_additional_function_declaration(
                    body,
                    rewrite.original_index,
                    compiled,
                    context,
                    host,
                    gating_imported_ref,
                    &gating_imported_name,
                    arena,
                )?;
            } else {
                return Err(CompilerDiagnostic::new(
                    ErrorCategory::Invariant,
                    "Expected compiled node type to match input type: \
                     got non-FunctionDeclaration but expected FunctionDeclaration",
                    None,
                ));
            }
        } else {
            let original_stmt = body[rewrite.original_index];
            // Read name/export info BEFORE extract_function_node_from_stmt: that
            // helper mem::take()s the G::Fn through a StoreRef, zeroing it in
            // the arena store, so any later read via original_stmt sees default().
            let fn_decl_name = get_fn_decl_name(&original_stmt);
            let is_export = matches!(original_stmt.data, StmtData::SFunction(f)
                if f.func.flags.contains(flags::Function::IsExport));
            let export_default_fn_name = get_fn_decl_name_from_export_default(&original_stmt);

            let original_fn = extract_function_node_from_stmt(&original_stmt)?;

            let gating_expression =
                build_gating_expression(rewrite.compiled_fn, original_fn, gating_imported_ref);

            // Determine how to rewrite based on context
            if !rewrite.is_export_default {
                if let Some(fn_name) = fn_decl_name {
                    // Convert function declaration to: const fnName = gating() ? compiled : original
                    let var_decl = make_const_decl(arena, fn_name, gating_expression, is_export);
                    body[rewrite.original_index] = var_decl;
                } else {
                    // Replace with the conditional expression directly (e.g. arrow/expression)
                    let expr_stmt = Stmt::alloc(
                        S::SExpr {
                            value: gating_expression,
                            does_not_affect_tree_shaking: false,
                        },
                        Loc::EMPTY,
                    );
                    body[rewrite.original_index] = expr_stmt;
                }
            } else {
                // ExportDefaultDeclaration case
                let default_name = match original_stmt.data {
                    StmtData::SExportDefault(ed) => ed.default_name,
                    _ => LocRef::default(),
                };
                if let Some(fn_name) = export_default_fn_name {
                    // Named export default function: replace with const + re-export
                    //   const fnName = gating() ? compiled : original;
                    //   export default fnName;
                    let var_decl = make_const_decl(arena, fn_name, gating_expression, false);
                    let re_export = Stmt::alloc(
                        S::ExportDefault {
                            default_name,
                            value: StmtOrExpr::Expr(make_identifier(fn_name)),
                        },
                        Loc::EMPTY,
                    );
                    // Replace the original statement with the var decl, then insert re-export after
                    body[rewrite.original_index] = var_decl;
                    body.insert(rewrite.original_index + 1, re_export);
                } else {
                    // Anonymous export default or arrow: replace the declaration content
                    // with the conditional expression
                    let export_default = Stmt::alloc(
                        S::ExportDefault {
                            default_name,
                            value: StmtOrExpr::Expr(gating_expression),
                        },
                        Loc::EMPTY,
                    );
                    body[rewrite.original_index] = export_default;
                }
            }
        }
    }
    Ok(())
}

/// Gating rewrite for function declarations which are referenced before their
/// declaration site.
///
/// ```js
/// // original
/// export default React.memo(Foo);
/// function Foo() { ... }
///
/// // React compiler optimized + gated
/// import {gating} from 'myGating';
/// export default React.memo(Foo);
/// const gating_result = gating();  // <- inserted
/// function Foo_optimized() {}      // <- inserted
/// function Foo_unoptimized() {}    // <- renamed from Foo
/// function Foo() {                 // <- inserted, hoistable by JS engines
///   if (gating_result) return Foo_optimized();
///   else return Foo_unoptimized();
/// }
/// ```
#[allow(clippy::too_many_arguments)]
fn insert_additional_function_declaration(
    body: &mut Vec<Stmt>,
    original_index: usize,
    mut compiled: G::Fn,
    context: &mut ProgramContext,
    host: &mut dyn Host,
    gating_function_identifier: Ref,
    gating_function_identifier_name: &str,
    arena: &Arena,
) -> Result<(), CompilerDiagnostic> {
    // Extract the original function declaration from body
    // (Bun: `export function Foo` is `SFunction` with `IsExport`, not a separate wrapper.)
    let mut original_fn_ref = match body[original_index].data {
        StmtData::SFunction(fd) => fd,
        _ => {
            return Err(CompilerDiagnostic::new(
                ErrorCategory::Invariant,
                "Expected function declaration at original_index",
                None,
            ));
        }
    };

    let original_fn_name =
        original_fn_ref.func.name.and_then(|n| n.ref_).expect(
            "Expected function declaration referenced elsewhere to have a named identifier",
        );
    let _compiled_id = compiled
        .name
        .and_then(|n| n.ref_)
        .expect("Expected compiled function declaration to have a named identifier");
    let original_params = original_fn_ref.func.args;
    let original_has_rest = original_fn_ref
        .func
        .flags
        .contains(flags::Function::HasRestArg);
    assert_eq!(
        original_params.len(),
        compiled.args.len(),
        "Expected compiled function to have the same number of parameters as source"
    );

    // Generate unique names
    let original_name_str = ref_name(host, original_fn_name);
    let gating_condition_name =
        context.new_uid(&format!("{gating_function_identifier_name}_result"));
    let unoptimized_fn_name = context.new_uid(&format!("{original_name_str}_unoptimized"));
    let optimized_fn_name = context.new_uid(&format!("{original_name_str}_optimized"));
    let gating_condition_ref = host.new_generated(gating_condition_name.as_bytes());
    let unoptimized_fn_ref = host.new_generated(unoptimized_fn_name.as_bytes());
    let optimized_fn_ref = host.new_generated(optimized_fn_name.as_bytes());

    // Step 1: rename existing functions
    compiled.name = Some(LocRef {
        loc: Loc::EMPTY,
        ref_: Some(optimized_fn_ref),
    });
    compiled.flags.remove(flags::Function::IsExport);

    // Rename the original function in-place to *_unoptimized
    original_fn_ref.func.name = Some(LocRef {
        loc: Loc::EMPTY,
        ref_: Some(unoptimized_fn_ref),
    });

    // Step 2: build new params and args for the dispatcher function
    let param_count = original_params.len();
    let mut new_args_optimized = AstAlloc::vec_with_capacity::<Expr>(param_count);
    let mut new_args_unoptimized = AstAlloc::vec_with_capacity::<Expr>(param_count);
    let new_params: &mut [G::Arg] = arena.alloc_slice_fill_with(param_count, |i| {
        let arg_name = context.new_uid(&format!("arg{i}"));
        let arg_ref = host.new_generated(arg_name.as_bytes());
        let is_rest = original_has_rest && i + 1 == param_count;
        if is_rest {
            new_args_optimized.push(Expr::init(
                E::Spread {
                    value: make_identifier(arg_ref),
                },
                Loc::EMPTY,
            ));
            new_args_unoptimized.push(Expr::init(
                E::Spread {
                    value: make_identifier(arg_ref),
                },
                Loc::EMPTY,
            ));
        } else {
            new_args_optimized.push(make_identifier(arg_ref));
            new_args_unoptimized.push(make_identifier(arg_ref));
        }
        G::Arg {
            binding: Binding::alloc(arena, b::Identifier { r#ref: arg_ref }, Loc::EMPTY),
            ..G::Arg::default()
        }
    });

    // Build the dispatcher function:
    // function Foo(...args) {
    //   if (gating_result) return Foo_optimized(...args);
    //   else return Foo_unoptimized(...args);
    // }
    let if_stmt = Stmt::alloc(
        S::If {
            test_: make_identifier(gating_condition_ref),
            yes: Stmt::alloc(
                S::Return {
                    value: Some(make_call(optimized_fn_ref, new_args_optimized)),
                },
                Loc::EMPTY,
            ),
            no: Some(Stmt::alloc(
                S::Return {
                    value: Some(make_call(unoptimized_fn_ref, new_args_unoptimized)),
                },
                Loc::EMPTY,
            )),
        },
        Loc::EMPTY,
    );
    let dispatcher_body: &mut [Stmt] = arena.alloc_slice_fill_with(1, |_| if_stmt);
    let mut dispatcher_flags = flags::FUNCTION_NONE;
    if original_has_rest {
        dispatcher_flags |= flags::Function::HasRestArg;
    }
    let dispatcher_fn = Stmt::alloc(
        S::Function {
            func: G::Fn {
                name: Some(LocRef {
                    loc: Loc::EMPTY,
                    ref_: Some(original_fn_name),
                }),
                args: StoreSlice::new_mut(new_params),
                body: G::FnBody {
                    loc: Loc::EMPTY,
                    stmts: StoreSlice::new_mut(dispatcher_body),
                },
                flags: dispatcher_flags,
                ..G::Fn::default()
            },
        },
        Loc::EMPTY,
    );

    // Build: const gating_result = gating();
    let gating_const = make_const_decl(
        arena,
        gating_condition_ref,
        make_call(gating_function_identifier, AstAlloc::vec()),
        false,
    );

    // Build: the compiled (optimized) function declaration
    let compiled_stmt = Stmt::alloc(S::Function { func: compiled }, Loc::EMPTY);

    // Insert statements. In the TS version:
    //   fnPath.insertBefore(gating_const)
    //   fnPath.insertBefore(compiled)
    //   fnPath.insertAfter(dispatcher_fn)
    //
    // This means the final order is:
    //   [before original_index]: gating_const
    //   [before original_index]: compiled (optimized fn)
    //   [at original_index]:     original fn (renamed to *_unoptimized)
    //   [after original_index]:  dispatcher fn
    //
    // We insert in order: first the ones before, then the one after.
    // Insert before original_index: gating_const, compiled
    body.insert(original_index, compiled_stmt);
    body.insert(original_index, gating_const);
    // The original (now renamed) fn is now at original_index + 2
    // Insert dispatcher after it
    body.insert(original_index + 3, dispatcher_fn);
    Ok(())
}

/// Expression-level gating wrapper for dynamic gating (`@dynamicGating`).
///
/// Builds `gate_ref() ? compiled : original`. Used by `maybe_compile_expr` for
/// `const Foo = ...` initializers and `export default ...` expressions, where
/// the rewrite replaces the initializer expression in place rather than a
/// top-level statement (port of upstream `Gating.ts`'s expression branch).
pub(crate) fn wrap_expr_with_gate(
    original: Expr,
    compiled: Expr,
    gate_ref: Ref,
    _arena: &Arena,
) -> Expr {
    let loc = original.loc;
    Expr::init(
        E::If {
            test_: make_call(gate_ref, AstAlloc::vec()),
            yes: compiled,
            no: original,
        },
        loc,
    )
}

/// Build a gating conditional expression:
/// `gating_fn() ? build_fn_expr(compiled) : build_fn_expr(original)`
fn build_gating_expression(
    compiled: CompiledFunctionNode,
    original: CompiledFunctionNode,
    gating_ref: Ref,
) -> Expr {
    Expr::init(
        E::If {
            test_: make_call(gating_ref, AstAlloc::vec()),
            yes: build_function_expression(compiled),
            no: build_function_expression(original),
        },
        Loc::EMPTY,
    )
}

/// Convert a compiled function node to an expression.
/// Function declarations are converted to function expressions;
/// arrow functions and function expressions are returned as-is.
fn build_function_expression(node: CompiledFunctionNode) -> Expr {
    match node {
        CompiledFunctionNode::ArrowFunctionExpression(arrow) => Expr::init(arrow, Loc::EMPTY),
        CompiledFunctionNode::FunctionExpression(func) => {
            Expr::init(E::Function { func }, Loc::EMPTY)
        }
        CompiledFunctionNode::FunctionDeclaration(mut func) => {
            // Convert FunctionDeclaration to FunctionExpression
            func.flags.remove(flags::Function::IsExport);
            Expr::init(E::Function { func }, Loc::EMPTY)
        }
    }
}

/// Helper to create a simple Identifier expression from a `Ref`.
fn make_identifier(ref_: Ref) -> Expr {
    Expr::init_identifier(ref_, Loc::EMPTY)
}

fn ref_name(host: &dyn Host, ref_: Ref) -> String {
    let bytes = host.symbols()[ref_.inner_index() as usize]
        .original_name
        .slice();
    core::str::from_utf8(bytes)
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn make_call(callee: Ref, args: bun_alloc::AstVec<Expr>) -> Expr {
    Expr::init(
        E::Call {
            target: make_identifier(callee),
            args,
            ..E::Call::default()
        },
        Loc::EMPTY,
    )
}

fn make_const_decl(arena: &Arena, ref_: Ref, init: Expr, is_export: bool) -> Stmt {
    let mut decls = AstAlloc::vec_with_capacity::<G::Decl>(1);
    decls.push(G::Decl {
        binding: Binding::alloc(arena, b::Identifier { r#ref: ref_ }, Loc::EMPTY),
        value: Some(init),
    });
    Stmt::alloc(
        S::Local {
            kind: S::Kind::KConst,
            decls,
            is_export,
            was_ts_import_equals: false,
            was_commonjs_export: false,
        },
        Loc::EMPTY,
    )
}

/// Extract the function name from a top-level Statement if it is a
/// FunctionDeclaration with an id.
fn get_fn_decl_name(stmt: &Stmt) -> Option<Ref> {
    match stmt.data {
        StmtData::SFunction(fd) => fd.func.name.and_then(|n| n.ref_),
        _ => None,
    }
}

/// Extract the function name from an ExportDefaultDeclaration's declaration,
/// if it is a named FunctionDeclaration.
fn get_fn_decl_name_from_export_default(stmt: &Stmt) -> Option<Ref> {
    match stmt.data {
        StmtData::SExportDefault(ed) => match ed.value {
            StmtOrExpr::Stmt(inner) => match inner.data {
                StmtData::SFunction(fd) => fd.func.name.and_then(|n| n.ref_),
                _ => None,
            },
            StmtOrExpr::Expr(_) => None,
        },
        _ => None,
    }
}

/// Extract a CompiledFunctionNode from a statement (for building the
/// "original" side of the gating expression).
fn extract_function_node_from_stmt(
    stmt: &Stmt,
) -> Result<CompiledFunctionNode, CompilerDiagnostic> {
    match stmt.data {
        StmtData::SFunction(mut fd) => Ok(CompiledFunctionNode::FunctionDeclaration(
            core::mem::take(&mut fd.func),
        )),
        StmtData::SExpr(es) => extract_function_node_from_expr(es.value),
        StmtData::SExportDefault(ed) => match ed.value {
            StmtOrExpr::Stmt(inner) => match inner.data {
                StmtData::SFunction(mut fd) => Ok(CompiledFunctionNode::FunctionDeclaration(
                    core::mem::take(&mut fd.func),
                )),
                _ => Err(CompilerDiagnostic::new(
                    ErrorCategory::Invariant,
                    "Expected function in export default declaration for gating",
                    None,
                )),
            },
            StmtOrExpr::Expr(expr) => extract_function_node_from_expr(expr),
        },
        StmtData::SLocal(vd) => {
            let init = vd.decls[0]
                .value
                .expect("Expected variable declarator to have an init for gating");
            extract_function_node_from_expr(init)
        }
        _ => Err(CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            "Unexpected statement type for gating rewrite",
            None,
        )),
    }
}

fn extract_function_node_from_expr(expr: Expr) -> Result<CompiledFunctionNode, CompilerDiagnostic> {
    use bun_ast::expr::Data as ExprData;
    match expr.data {
        ExprData::EArrow(mut arrow) => Ok(CompiledFunctionNode::ArrowFunctionExpression(
            core::mem::take(&mut *arrow),
        )),
        ExprData::EFunction(mut fe) => Ok(CompiledFunctionNode::FunctionExpression(
            core::mem::take(&mut fe.func),
        )),
        _ => Err(CompilerDiagnostic::new(
            ErrorCategory::Invariant,
            "Expected function expression for gating",
            None,
        )),
    }
}
