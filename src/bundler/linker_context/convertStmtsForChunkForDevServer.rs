use bun_alloc::{AllocError, Arena as Bump};
use bun_js_parser as js_ast;
use bun_js_parser::{
    B, Binding, BindingData, E, Expr, ExprNodeList, FnBody, G, S, Stmt, StmtData,
    BundledAst as JSAst,
};
use bun_logger::{self as Logger, Loc};
use bun_options_types::{ImportRecordTag, Loader};

use crate::bundle_v2::LinkerContext;
use crate::bundle_v2::linker_context::{StmtList, StmtListKind};

/// For CommonJS, all statements are copied `inside_wrapper_suffix` and this returns.
/// The conversion logic is completely different for format .internal_bake_dev
///
/// For ESM, this function populates all three lists:
/// 1. outside_wrapper_prefix: all import statements, unmodified.
/// 2. inside_wrapper_prefix: a var decl line and a call to `module.retrieve`
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
///     ], [ "default" ], [], (hmr) => {
/// 2 ┃   var [module_1, module_2, module_3] = hmr.imports;
///   ┃   hmr.onUpdate = [
///   ┃     (module) => (module_1 = module),
///   ┃     (module) => (module_2 = module),
///   ┃     (module) => (module_3 = module),
///   ┃   ];
///
/// 3 ┃   console.log("my module", module_1.add(1, module_2.mul(2, 3));
///   ┃   module.exports = {
///   ┃     default: module_3.something(module_2.div),
///   ┃   };
///     }, false ],
///        ----- "is the module async?"
pub fn convert_stmts_for_chunk_for_dev_server<'bump>(
    c: &mut LinkerContext,
    stmts: &mut StmtList,
    part_stmts: &[js_ast::Stmt],
    bump: &'bump Bump,
    ast: &mut JSAst,
) -> Result<(), AllocError> {
    // TODO(port): narrow error set
    let hmr_api_ref = ast.wrapper_ref;
    let hmr_api_id = Expr::init_identifier(hmr_api_ref, Loc::EMPTY);
    let mut esm_decls: bumpalo::collections::Vec<'bump, B::ArrayItem> =
        bumpalo::collections::Vec::new_in(bump);
    let mut esm_callbacks: bumpalo::collections::Vec<'bump, Expr> =
        bumpalo::collections::Vec::new_in(bump);

    for record in ast.import_records.slice_mut() {
        if record.path.is_disabled {
            continue;
        }
        if record.source_index.is_valid()
            // TODO(port): MultiArrayList column accessor API
            && c.parse_graph.input_files.items().loader[record.source_index.get() as usize]
                == Loader::Css
        {
            record.path.is_disabled = true;
            continue;
        }
        // Make sure the printer gets the resolved path
        if record.source_index.is_valid() {
            record.path =
                c.parse_graph.input_files.items().source[record.source_index.get() as usize].path;
        }
    }

    // Modules which do not have side effects
    for stmt in part_stmts {
        match &stmt.data {
            StmtData::SImport(st) => {
                let record = ast.import_records.mut_(st.import_record_index);
                if record.path.is_disabled {
                    continue;
                }

                if record.flags.is_unused {
                    // Barrel optimization: this import was deferred (unused submodule).
                    // Don't add to dep array, but declare the namespace ref as an
                    // empty object so body code referencing it doesn't throw.
                    if st.star_name_loc.is_some() || st.items.len() > 0 || st.default_name.is_some()
                    {
                        stmts.inside_wrapper_prefix.append_non_dependency(Stmt::alloc(
                            S::Local {
                                kind: S::LocalKind::Var,
                                decls: G::DeclList::from_slice(
                                    bump,
                                    &[G::Decl {
                                        binding: Binding::alloc(
                                            bump,
                                            B::Identifier { ref_: st.namespace_ref },
                                            stmt.loc,
                                        ),
                                        value: Some(Expr::init(
                                            E::Object::default(),
                                            stmt.loc,
                                        )),
                                    }],
                                )?,
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
                    st.star_name_loc.is_none() && st.items.len() == 0 && st.default_name.is_none();

                if is_builtin {
                    if !is_bare_import {
                        // hmr.importBuiltin('...') or hmr.require('bun:wrap')
                        let call = Expr::init(
                            E::Call {
                                target: Expr::init(
                                    E::Dot {
                                        target: hmr_api_id,
                                        name: if record.tag == ImportRecordTag::Runtime {
                                            b"require"
                                        } else {
                                            b"builtin"
                                        },
                                        name_loc: stmt.loc,
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ),
                                args: ExprNodeList::from_owned_slice(bump.alloc_slice_copy(&[
                                    Expr::init(
                                        E::String {
                                            data: if record.tag == ImportRecordTag::Runtime {
                                                b"bun:wrap"
                                            } else {
                                                record.path.pretty
                                            },
                                            ..Default::default()
                                        },
                                        record.range.loc,
                                    ),
                                ])),
                                ..Default::default()
                            },
                            stmt.loc,
                        );

                        // var namespace = ...;
                        stmts.inside_wrapper_prefix.append_non_dependency(Stmt::alloc(
                            S::Local {
                                kind: S::LocalKind::Var, // remove a tdz
                                decls: G::DeclList::from_slice(
                                    bump,
                                    &[G::Decl {
                                        binding: Binding::alloc(
                                            bump,
                                            B::Identifier { ref_: st.namespace_ref },
                                            st.star_name_loc.unwrap_or(stmt.loc),
                                        ),
                                        value: Some(call),
                                    }],
                                )?,
                                ..Default::default()
                            },
                            stmt.loc,
                        ))?;
                    }
                } else {
                    let loc = st.star_name_loc.unwrap_or(stmt.loc);
                    if is_bare_import {
                        esm_decls.push(B::ArrayItem {
                            binding: Binding { data: BindingData::BMissing, loc: Loc::EMPTY },
                            ..Default::default()
                        });
                        // PERF(port): was assume_capacity-adjacent (arena append)
                        esm_callbacks.push(Expr::init(E::Arrow::NOOP_RETURN_UNDEFINED, Loc::EMPTY));
                    } else {
                        let binding =
                            Binding::alloc(bump, B::Identifier { ref_: st.namespace_ref }, loc);
                        esm_decls.push(B::ArrayItem { binding, ..Default::default() });
                        esm_callbacks.push(Expr::init(
                            E::Arrow {
                                args: bump.alloc_slice_copy(&[G::Arg {
                                    binding: Binding::alloc(
                                        bump,
                                        B::Identifier { ref_: ast.module_ref },
                                        Loc::EMPTY,
                                    ),
                                    ..Default::default()
                                }]),
                                prefer_expr: true,
                                body: FnBody::init_return_expr(
                                    bump,
                                    Expr::init(
                                        E::Binary {
                                            op: E::BinaryOp::BinAssign,
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

                    stmts.append(StmtListKind::OutsideWrapperPrefix, *stmt)?;
                }
            }
            _ => stmts.append(StmtListKind::InsideWrapperSuffix, *stmt)?,
        }
    }

    if esm_decls.len() > 0 {
        // var ...;
        stmts.inside_wrapper_prefix.append_non_dependency(Stmt::alloc(
            S::Local {
                kind: S::LocalKind::Var, // remove a tdz
                decls: G::DeclList::from_slice(
                    bump,
                    &[G::Decl {
                        binding: Binding::alloc(
                            bump,
                            B::Array {
                                items: esm_decls.into_bump_slice(),
                                is_single_line: true,
                                ..Default::default()
                            },
                            Loc::EMPTY,
                        ),
                        value: Some(Expr::init(
                            E::Dot {
                                target: hmr_api_id,
                                name: b"imports",
                                name_loc: Loc::EMPTY,
                                ..Default::default()
                            },
                            Loc::EMPTY,
                        )),
                    }],
                )?,
                ..Default::default()
            },
            Loc::EMPTY,
        ))?;
        // hmr.onUpdate = [ ... ];
        // PORT NOTE: reshaped for borrowck — capture len before moving esm_callbacks
        let callbacks_len = esm_callbacks.len();
        stmts.inside_wrapper_prefix.append_non_dependency(Stmt::alloc(
            S::SExpr {
                value: Expr::init(
                    E::Binary {
                        op: E::BinaryOp::BinAssign,
                        left: Expr::init(
                            E::Dot {
                                target: hmr_api_id,
                                name: b"updateImport",
                                name_loc: Loc::EMPTY,
                                ..Default::default()
                            },
                            Loc::EMPTY,
                        ),
                        right: Expr::init(
                            E::Array {
                                items: ExprNodeList::move_from_list(&mut esm_callbacks),
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
        ))?;
    }

    Ok(())
}

pub use crate::bundle_v2::DeferredBatchTask;
pub use crate::bundle_v2::ThreadPool;
pub use crate::bundle_v2::ParseTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/convertStmtsForChunkForDevServer.zig (192 lines)
//   confidence: medium
//   todos:      2
//   notes:      AST node init-struct shapes (E::*/S::*/B::*) and MultiArrayList column accessors are guessed; arena allocator threaded as &'bump Bump.
// ──────────────────────────────────────────────────────────────────────────
