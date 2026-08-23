use crate::BundledAst as JSAst;
use crate::mal_prelude::*;
use bun_alloc::ArenaVecExt as _;
use bun_alloc::{AllocError, Arena as Bump};
use bun_ast as js_ast;
use bun_ast::ArrayBinding;
use bun_ast::ImportRecordFlags;
use bun_ast::Loc;
use bun_ast::{Binding, E, Expr, ExprNodeList, G, S, Stmt, StmtData, b};
use bun_ast::{ImportRecordTag, Loader};
use bun_collections::VecExt;

use crate::linker_context_mod::{LinkerContext, StmtList, StmtListWhich};

/// For CommonJS, all statements are copied `inside_wrapper_suffix` and this returns.
/// The conversion logic is completely different for format .internal_bake_dev
///
/// For ESM, this function populates all three lists:
/// 1. outside_wrapper_prefix: all import statements, unmodified.
/// 2. inside_wrapper_prefix: the import bindings, `hmr.updateImport`, `hmr.exports` and the `yield`
/// 3. inside_wrapper_suffix: all non-import statements
///
/// The imports are rewritten at print time to fit the packed array format
/// that the HMR runtime can decode. This encoding is low on JS objects and
/// indentation.
///
/// 1 ┃ "module/esm": [ [
///   ┃   'module_1', 1, "add",
///   ┃   'module_2', 2, "mul", "div",
///   ┃   'module_3', 0, // bare or import star
///     ], [ "default" ], [], function*(hmr) {
/// 2 ┃   var module_1, module_2, module_3;
///   ┃   hmr.updateImport = [
///   ┃     (module) => (module_1 = module),
///   ┃     (module) => (module_2 = module),
///   ┃     (module) => (module_3 = module),
///   ┃   ];
///   ┃   hmr.exports = {
///   ┃     get default() { return default_export },
///   ┃   };
///   ┃   yield;
///   ┃   [module_1, module_2, module_3] = hmr.imports;
///
/// 3 ┃   console.log("my module", module_1.add(1, module_2.mul(2, 3));
///   ┃   const default_export = module_3.something(module_2.div);
///     }, false ],
///        ----- "is the module async?"
///
/// The module body is a generator, and the `yield` in step 2 separates the two
/// phases of the ESM link. Above the `yield` the module only instantiates: the
/// function declarations of the body are hoisted, the namespace object becomes
/// live and `updateImport` is registered. The HMR runtime instantiates a module
/// before it loads the dependencies of the module, and binds the import of the
/// importer through `updateImport` as soon as a dependency instantiates. So a
/// module that takes part in an import cycle reads a live namespace object of
/// a module that has not evaluated yet, not `null`.
pub(crate) fn convert_stmts_for_chunk_for_dev_server<'bump>(
    c: &mut LinkerContext,
    stmts: &mut StmtList,
    part_stmts: &[bun_ast::Stmt],
    bump: &'bump Bump,
    ast: &mut JSAst<'_>,
) -> Result<(), AllocError> {
    let hmr_api_ref = ast.wrapper_ref;
    let hmr_api_id = Expr::init_identifier(hmr_api_ref, Loc::EMPTY);
    let mut esm_decls: bun_alloc::ArenaVec<'bump, ArrayBinding> = bun_alloc::ArenaVec::new_in(bump);
    let mut esm_callbacks: Vec<Expr> = Vec::new();
    // A module with top-level await is emitted in one phase: an `async`
    // function has no `yield`. It keeps the layout of a module that knows no
    // cycle, and the HMR runtime repairs the bindings of its importers after
    // it evaluates.
    let uses_top_level_await = !ast.top_level_await_keyword.is_empty();
    // `hmr.exports = { ... }`, moved above the `yield` so that the namespace
    // object is live before any module of the cycle evaluates. A module that
    // uses `export *` keeps the assignment in its body: the object spread the
    // star lowers to is a copy, and a copy taken during instantiation is empty.
    let can_hoist_exports_object =
        ast.export_star_import_records.is_empty() && !uses_top_level_await;
    let mut hmr_exports_object_stmt: Option<Stmt> = None;

    let input_files = &c.parse_graph().input_files;
    let loaders = input_files.items_loader();
    let sources = input_files.items_source();
    for record in ast.import_records.as_mut_slice() {
        if record.path.is_disabled {
            continue;
        }
        if record.source_index.is_valid()
            && loaders[record.source_index.get() as usize] == Loader::Css
        {
            record.path.is_disabled = true;
            continue;
        }
        // Make sure the printer gets the resolved path
        if record.source_index.is_valid() {
            record.path = sources[record.source_index.get() as usize].path;
        }
    }

    // Modules which do not have side effects
    for stmt in part_stmts {
        match &stmt.data {
            StmtData::SImport(st) => {
                let record = &mut ast.import_records[st.import_record_index as usize];
                if record.path.is_disabled {
                    continue;
                }

                if record.flags.contains(ImportRecordFlags::IS_UNUSED) {
                    // Barrel optimization: this import was deferred (unused submodule).
                    // Don't add to dep array, but declare the namespace ref as an
                    // empty object so body code referencing it doesn't throw.
                    // SAFETY: `st.items` is an arena-owned fat ptr; len is always sound to read.
                    let items_len = st.items.len();
                    if !st.star_name_loc.is_empty() || items_len > 0 || st.default_name.is_some() {
                        stmts
                            .inside_wrapper_prefix
                            .append_non_dependency(Stmt::alloc(
                                S::Local {
                                    kind: js_ast::LocalKind::KVar,
                                    decls: G::DeclList::from_slice(&[G::Decl {
                                        binding: Binding::alloc(
                                            bump,
                                            b::Identifier {
                                                r#ref: st.namespace_ref,
                                            },
                                            stmt.loc,
                                        ),
                                        value: Some(Expr::init(E::Object::default(), stmt.loc)),
                                    }]),
                                    ..Default::default()
                                },
                                stmt.loc,
                            ))?;
                    }
                    continue;
                }

                let is_builtin = record.tag == ImportRecordTag::Builtin
                    || record.tag == ImportRecordTag::Bun
                    || record.tag == ImportRecordTag::Runtime;
                let is_bare_import =
                    st.star_name_loc.is_empty() && st.items.len() == 0 && st.default_name.is_none();

                if is_builtin {
                    if !is_bare_import {
                        // hmr.importBuiltin('...') or hmr.require('bun:wrap')
                        let call = Expr::init(
                            E::Call {
                                target: Expr::init(
                                    E::Dot {
                                        target: hmr_api_id,
                                        name: if record.tag == ImportRecordTag::Runtime {
                                            b"require".into()
                                        } else {
                                            b"builtin".into()
                                        },
                                        name_loc: stmt.loc,
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ),
                                args: ExprNodeList::from_slice(&[Expr::init(
                                    E::String {
                                        data: if record.tag == ImportRecordTag::Runtime {
                                            b"bun:wrap".into()
                                        } else {
                                            record.path.pretty.into()
                                        },
                                        ..Default::default()
                                    },
                                    record.range.loc,
                                )]),
                                ..Default::default()
                            },
                            stmt.loc,
                        );

                        // var namespace = ...;
                        stmts
                            .inside_wrapper_prefix
                            .append_non_dependency(Stmt::alloc(
                                S::Local {
                                    kind: js_ast::LocalKind::KVar, // remove a tdz
                                    decls: G::DeclList::from_slice(&[G::Decl {
                                        binding: Binding::alloc(
                                            bump,
                                            b::Identifier {
                                                r#ref: st.namespace_ref,
                                            },
                                            st.star_name_loc.to_nullable().unwrap_or(stmt.loc),
                                        ),
                                        value: Some(call),
                                    }]),
                                    ..Default::default()
                                },
                                stmt.loc,
                            ))?;
                    }
                } else {
                    let loc = st.star_name_loc.to_nullable().unwrap_or(stmt.loc);
                    if is_bare_import {
                        esm_decls.push(ArrayBinding {
                            binding: Binding {
                                data: b::B::BMissing(b::Missing {}),
                                loc: Loc::EMPTY,
                            },
                            default_value: None,
                        });
                        esm_callbacks.push(Expr::init(E::Arrow::NOOP_RETURN_UNDEFINED, Loc::EMPTY));
                    } else {
                        let binding = Binding::alloc(
                            bump,
                            b::Identifier {
                                r#ref: st.namespace_ref,
                            },
                            loc,
                        );
                        esm_decls.push(ArrayBinding {
                            binding,
                            default_value: None,
                        });
                        let arrow_args =
                            bun_ast::StoreSlice::new(core::slice::from_ref(bump.alloc(G::Arg {
                                binding: Binding::alloc(
                                    bump,
                                    b::Identifier {
                                        r#ref: ast.module_ref,
                                    },
                                    Loc::EMPTY,
                                ),
                                ..Default::default()
                            })));
                        esm_callbacks.push(Expr::init(
                            E::Arrow {
                                args: arrow_args,
                                prefer_expr: true,
                                body: G::FnBody::init_return_expr(
                                    bump,
                                    Expr::init(
                                        E::Binary {
                                            op: js_ast::OpCode::BinAssign,
                                            left: Expr::init_identifier(
                                                st.namespace_ref,
                                                Loc::EMPTY,
                                            ),
                                            right: Expr::init_identifier(
                                                ast.module_ref,
                                                Loc::EMPTY,
                                            ),
                                        },
                                        Loc::EMPTY,
                                    ),
                                )?,
                                ..Default::default()
                            },
                            Loc::EMPTY,
                        ));
                    }

                    stmts.append(StmtListWhich::OutsideWrapperPrefix, *stmt);
                }
            }
            _ => {
                if can_hoist_exports_object
                    && hmr_exports_object_stmt.is_none()
                    && is_hmr_exports_object_assignment(stmt, hmr_api_ref)
                {
                    hmr_exports_object_stmt = Some(*stmt);
                } else {
                    stmts.append(StmtListWhich::InsideWrapperSuffix, *stmt);
                }
            }
        }
    }

    if esm_decls.len() > 0 {
        // hmr.updateImport = [ ... ];
        // Capture len before moving `esm_callbacks` (borrowck).
        let callbacks_len = esm_callbacks.len();
        let update_import_stmt = Stmt::alloc(
            S::SExpr {
                value: Expr::init(
                    E::Binary {
                        op: js_ast::OpCode::BinAssign,
                        left: Expr::init(
                            E::Dot {
                                target: hmr_api_id,
                                name: b"updateImport".into(),
                                name_loc: Loc::EMPTY,
                                ..Default::default()
                            },
                            Loc::EMPTY,
                        ),
                        right: Expr::init(
                            E::Array {
                                items: ExprNodeList::move_from_list(esm_callbacks),
                                is_single_line: callbacks_len <= 2,
                                ..Default::default()
                            },
                            Loc::EMPTY,
                        ),
                    },
                    Loc::EMPTY,
                ),
                ..Default::default()
            },
            Loc::EMPTY,
        );
        let hmr_imports_expr = Expr::init(
            E::Dot {
                target: hmr_api_id,
                name: b"imports".into(),
                name_loc: Loc::EMPTY,
                ..Default::default()
            },
            Loc::EMPTY,
        );

        if uses_top_level_await {
            // var [module_1, module_2, module_3] = hmr.imports;
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(Stmt::alloc(
                    S::Local {
                        kind: js_ast::LocalKind::KVar, // remove a tdz
                        decls: G::DeclList::from_slice(&[G::Decl {
                            binding: Binding::alloc(
                                bump,
                                b::Array {
                                    items: bun_ast::StoreSlice::new_mut(
                                        esm_decls.into_bump_slice_mut(),
                                    ),
                                    has_spread: false,
                                    is_single_line: true,
                                },
                                Loc::EMPTY,
                            ),
                            value: Some(hmr_imports_expr),
                        }]),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ))?;
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(update_import_stmt)?;
        } else {
            // var module_1, module_2, module_3;
            // The bindings are declared here and assigned after the `yield`, so
            // that a function declared in the body can close over them while
            // the module is only instantiated.
            let mut import_decls: bun_alloc::ArenaVec<'bump, G::Decl> =
                bun_alloc::ArenaVec::new_in(bump);
            let mut import_targets: Vec<Expr> = Vec::with_capacity(esm_decls.len());
            for item in esm_decls.iter() {
                match item.binding.data {
                    b::B::BIdentifier(id) => {
                        import_decls.push(G::Decl {
                            binding: item.binding,
                            value: None,
                        });
                        import_targets.push(Expr::init_identifier(id.r#ref, item.binding.loc));
                    }
                    // A bare import declares no binding and leaves a hole in
                    // the assignment.
                    _ => import_targets.push(Expr::init(E::Missing {}, Loc::EMPTY)),
                }
            }
            if import_decls.len() > 0 {
                stmts
                    .inside_wrapper_prefix
                    .append_non_dependency(Stmt::alloc(
                        S::Local {
                            kind: js_ast::LocalKind::KVar, // remove a tdz
                            decls: G::DeclList::from_slice(import_decls.as_slice()),
                            ..Default::default()
                        },
                        Loc::EMPTY,
                    ))?;
            }
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(update_import_stmt)?;
            // hmr.exports = { ... };
            if let Some(exports_object_stmt) = hmr_exports_object_stmt.take() {
                stmts
                    .inside_wrapper_prefix
                    .append_non_dependency(exports_object_stmt)?;
            }
            // yield;
            // The boundary between instantiation and evaluation. A module with
            // no imports cannot take part in a cycle and gets no boundary; the
            // runtime then runs it whole in the instantiation phase.
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(Stmt::alloc(
                    S::SExpr {
                        value: Expr::init(
                            E::Yield {
                                value: None,
                                is_star: false,
                            },
                            Loc::EMPTY,
                        ),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ))?;
            // [module_1, module_2, module_3] = hmr.imports;
            stmts
                .inside_wrapper_prefix
                .append_non_dependency(Stmt::alloc(
                    S::SExpr {
                        value: Expr::assign(
                            Expr::init(
                                E::Array {
                                    items: ExprNodeList::move_from_list(import_targets),
                                    is_single_line: true,
                                    ..Default::default()
                                },
                                Loc::EMPTY,
                            ),
                            hmr_imports_expr,
                        ),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ))?;
        }
    }

    // A module that was left out of the hoist keeps the assignment in its body.
    if let Some(exports_object_stmt) = hmr_exports_object_stmt {
        stmts.append(StmtListWhich::InsideWrapperSuffix, exports_object_stmt);
    }

    Ok(())
}

/// Matches `hmr.exports = { ... };`, which `ConvertESMExportsForHmr::finalize`
/// (and the equivalent transform in `bundler/AstBuilder.rs`) appends to the
/// module body.
fn is_hmr_exports_object_assignment(stmt: &Stmt, hmr_api_ref: bun_ast::Ref) -> bool {
    let StmtData::SExpr(expr_stmt) = &stmt.data else {
        return false;
    };
    let bun_ast::expr::Data::EBinary(assign) = expr_stmt.value.data else {
        return false;
    };
    if assign.op != js_ast::OpCode::BinAssign {
        return false;
    }
    let bun_ast::expr::Data::EDot(dot) = assign.left.data else {
        return false;
    };
    if dot.name.slice() != b"exports" {
        return false;
    }
    matches!(dot.target.data, bun_ast::expr::Data::EIdentifier(id) if id.ref_ == hmr_api_ref)
}
