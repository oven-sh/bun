use crate::BundledAst as JSAst;
use crate::mal_prelude::*;
use bun_alloc::Arena as Bump;
use bun_ast::ImportRecordFlags;
use bun_ast::Loc;
use bun_ast::{self as js_ast, Binding, Expr, ExprNodeList, Stmt};
use bun_ast::{B, E, G, S};
use bun_collections::VecExt;
use bun_core::FeatureFlags;

use crate::EntryPoint;
use crate::chunk::Chunk;
use crate::linker_context_mod::{LinkerContext, LinkerOptionsMode, StmtList, StmtListWhich};
use crate::options::Format;
use crate::ungate_support::WrapKind;

/// Code we ultimately include in the bundle is potentially wrapped
///
/// In that case, we do a final pass over the statements list to figure out
/// where it needs to go in the wrapper, following the syntax of the output
/// format ESM import and export statements to always be top-level, so they
/// can never be inside the wrapper.
///
///      prefix - outer
///      ...
///      var init_foo = __esm(() => {
///          prefix - inner
///          ...
///          suffix - inenr
///      });
///      ...
///      suffix - outer
///
/// Keep in mind that we may need to wrap ES modules in some cases too
/// Consider:
///   import * as foo from 'bar';
///   foo[computedProperty]
///
/// In that case, when bundling, we still need to preserve that module
/// namespace object (foo) because we cannot know what they are going to
/// attempt to access statically
pub fn convert_stmts_for_chunk(
    c: &mut LinkerContext<'_>,
    source_index: u32,
    stmts: &mut StmtList,
    part_stmts: &[bun_ast::Stmt],
    chunk: &mut Chunk,
    bump: &Bump,
    wrap: WrapKind,
    ast: &JSAst,
) -> Result<(), bun_core::Error> {
    let _ = bump;
    let should_extract_esm_stmts_for_wrap = wrap != WrapKind::None;
    let should_strip_exports = c.options.mode != LinkerOptionsMode::Passthrough
        || c.graph.files.items_entry_point_kind()[source_index as usize] != EntryPoint::Kind::None;

    let output_format = c.options.output_format;

    // If this file is a CommonJS entry point, double-write re-exports to the
    // external CommonJS "module.exports" object in addition to our internal ESM
    // export namespace object. The difference between these two objects is that
    // our internal one must not have the "__esModule" marker while the external
    // one must have the "__esModule" marker. This is done because an ES module
    // importing itself should not see the "__esModule" marker but a CommonJS module
    // importing us should see the "__esModule" marker.
    let mut module_exports_for_export: Option<Expr> = None;
    if output_format == Format::Cjs && chunk.is_entry_point() {
        module_exports_for_export = Some(Expr::allocate(
            bump,
            E::Dot {
                target: Expr::allocate(
                    bump,
                    E::Identifier {
                        ref_: c.unbound_module_ref,
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
                name: b"exports".into(),
                name_loc: Loc::EMPTY,
                ..Default::default()
            },
            Loc::EMPTY,
        ));
    }

    'stmt_loop: for stmt_ in part_stmts {
        let mut stmt = *stmt_;
        'process_stmt: {
            match stmt.data {
                bun_ast::StmtData::SImport(s) => {
                    // "import * as ns from 'path'"
                    // "import {foo} from 'path'"
                    if c.should_remove_import_export_stmt(
                        stmts,
                        stmt.loc,
                        s.namespace_ref,
                        s.import_record_index,
                        bump,
                        ast,
                    )? {
                        continue 'stmt_loop;
                    }

                    // Make sure these don't end up in the wrapper closure
                    if should_extract_esm_stmts_for_wrap {
                        stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                        continue 'stmt_loop;
                    }
                }
                bun_ast::StmtData::SExportStar(s) => {
                    // "export * as ns from 'path'"
                    if let Some(alias) = &s.alias {
                        if c.should_remove_import_export_stmt(
                            stmts,
                            stmt.loc,
                            s.namespace_ref,
                            s.import_record_index,
                            bump,
                            ast,
                        )? {
                            continue 'stmt_loop;
                        }

                        if should_strip_exports {
                            // Turn this statement into "import * as ns from 'path'"
                            stmt = Stmt::alloc(
                                S::Import {
                                    namespace_ref: s.namespace_ref,
                                    import_record_index: s.import_record_index,
                                    star_name_loc: Some(alias.loc),
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                        }

                        // Make sure these don't end up in the wrapper closure
                        if should_extract_esm_stmts_for_wrap {
                            stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                            continue 'stmt_loop;
                        }

                        break 'process_stmt;
                    }

                    // "export * from 'path'"
                    let record = ast.import_records.at(s.import_record_index as usize);

                    // Barrel optimization: deferred export * records should be dropped
                    if record.flags.contains(ImportRecordFlags::IS_UNUSED) {
                        continue 'stmt_loop;
                    }

                    if !should_strip_exports {
                        break 'process_stmt;
                    }

                    // Is this export star evaluated at run time?
                    if !record.source_index.is_valid()
                        && c.options.output_format.keep_es6_import_export_syntax()
                    {
                        if record
                            .flags
                            .contains(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN)
                        {
                            // Turn this statement into "import * as ns from 'path'"
                            stmt = Stmt::alloc(
                                S::Import {
                                    namespace_ref: s.namespace_ref,
                                    import_record_index: s.import_record_index,
                                    star_name_loc: Some(stmt.loc),
                                    ..Default::default()
                                },
                                stmt.loc,
                            );

                            // Prefix this module with "__reExport(exports, ns, module.exports)"
                            let export_star_ref = c.runtime_function(b"__reExport");
                            let args_len = 2 + usize::from(module_exports_for_export.is_some());
                            // PERF(port): was arena alloc of [Expr; N] — using Vec→Box
                            let mut args: Vec<Expr> = Vec::with_capacity(args_len);
                            args.push(Expr::init(
                                E::Identifier {
                                    ref_: ast.exports_ref,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                            args.push(Expr::init(
                                E::Identifier {
                                    ref_: s.namespace_ref,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));

                            if let Some(mod_) = module_exports_for_export {
                                // TODO(port): Zig writes args[3] which is out-of-bounds (len is 3); preserved as args[2] — verify intent in Phase B
                                args.push(mod_);
                            }

                            stmts
                                .inside_wrapper_prefix
                                .append_non_dependency(Stmt::alloc(
                                    S::SExpr {
                                        value: Expr::allocate(
                                            bump,
                                            E::Call {
                                                target: Expr::allocate(
                                                    bump,
                                                    E::Identifier {
                                                        ref_: export_star_ref,
                                                        ..Default::default()
                                                    },
                                                    stmt.loc,
                                                ),
                                                args: bun_ast::ExprNodeList::from_owned_slice(
                                                    args.into_boxed_slice(),
                                                ),
                                                ..Default::default()
                                            },
                                            stmt.loc,
                                        ),
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ))?;

                            // Make sure these don't end up in the wrapper closure
                            if should_extract_esm_stmts_for_wrap {
                                stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                                continue 'stmt_loop;
                            }
                        }
                    } else {
                        if record.source_index.is_valid() {
                            let flag =
                                c.graph.meta.items_flags()[record.source_index.get() as usize];
                            let wrapper_ref =
                                c.graph.ast.items_wrapper_ref()[record.source_index.get() as usize];
                            if flag.wrap == WrapKind::Esm && wrapper_ref.is_valid() {
                                stmts
                                    .inside_wrapper_prefix
                                    .append_non_dependency(Stmt::alloc(
                                        S::SExpr {
                                            value: Expr::init(
                                                E::Call {
                                                    target: Expr::init(
                                                        E::Identifier {
                                                            ref_: wrapper_ref,
                                                            ..Default::default()
                                                        },
                                                        stmt.loc,
                                                    ),
                                                    ..Default::default()
                                                },
                                                stmt.loc,
                                            ),
                                            ..Default::default()
                                        },
                                        stmt.loc,
                                    ))?;
                            }
                        }

                        if record
                            .flags
                            .contains(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN)
                        {
                            let target: Expr = 'brk: {
                                if record.source_index.is_valid()
                                    && c.graph.ast.items_exports_kind()
                                        [record.source_index.get() as usize]
                                        .is_esm_with_dynamic_fallback()
                                {
                                    // Prefix this module with "__reExport(exports, otherExports, module.exports)"
                                    break 'brk Expr::init_identifier(
                                        c.graph.ast.items_exports_ref()
                                            [record.source_index.get() as usize],
                                        stmt.loc,
                                    );
                                }

                                break 'brk Expr::init(
                                    E::RequireString {
                                        import_record_index: s.import_record_index,
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                );
                            };

                            // Prefix this module with "__reExport(exports, require(path), module.exports)"
                            let export_star_ref = c.runtime_function(b"__reExport");
                            let args_len = 2 + usize::from(module_exports_for_export.is_some());
                            // PERF(port): was arena alloc of [Expr; N] — using Vec→Box
                            let mut args: Vec<Expr> = Vec::with_capacity(args_len);
                            args.push(Expr::init(
                                E::Identifier {
                                    ref_: ast.exports_ref,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                            args.push(target);

                            if let Some(mod_) = module_exports_for_export {
                                args.push(mod_);
                            }

                            stmts
                                .inside_wrapper_prefix
                                .append_non_dependency(Stmt::alloc(
                                    S::SExpr {
                                        value: Expr::init(
                                            E::Call {
                                                target: Expr::init(
                                                    E::Identifier {
                                                        ref_: export_star_ref,
                                                        ..Default::default()
                                                    },
                                                    stmt.loc,
                                                ),
                                                args: ExprNodeList::from_owned_slice(
                                                    args.into_boxed_slice(),
                                                ),
                                                ..Default::default()
                                            },
                                            stmt.loc,
                                        ),
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ))?;
                        }

                        // Remove the export star statement
                        continue 'stmt_loop;
                    }
                }

                bun_ast::StmtData::SExportFrom(s) => {
                    // "export {foo} from 'path'"
                    if c.should_remove_import_export_stmt(
                        stmts,
                        stmt.loc,
                        s.namespace_ref,
                        s.import_record_index,
                        bump,
                        ast,
                    )? {
                        continue 'stmt_loop;
                    }

                    if should_strip_exports {
                        // Turn this statement into "import {foo} from 'path'"
                        // TODO: is this allocation necessary?
                        let src_items: &[bun_ast::ClauseItem] = s.items.slice();
                        let items =
                            bump.alloc_slice_fill_default::<bun_ast::ClauseItem>(src_items.len());
                        for (src, dest) in src_items.iter().zip(items.iter_mut()) {
                            *dest = bun_ast::ClauseItem {
                                alias: src.original_name,
                                alias_loc: src.alias_loc,
                                name: src.name,
                                ..Default::default()
                            };
                        }

                        stmt = Stmt::alloc(
                            S::Import {
                                items: items.into(),
                                import_record_index: s.import_record_index,
                                namespace_ref: s.namespace_ref,
                                is_single_line: s.is_single_line,
                                ..Default::default()
                            },
                            stmt.loc,
                        );
                    }

                    // Make sure these don't end up in the wrapper closure
                    if should_extract_esm_stmts_for_wrap {
                        stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                        continue 'stmt_loop;
                    }
                }

                bun_ast::StmtData::SExportClause(_) => {
                    // "export {foo}"

                    if should_strip_exports {
                        // Remove export statements entirely
                        continue 'stmt_loop;
                    }

                    // Make sure these don't end up in the wrapper closure
                    if should_extract_esm_stmts_for_wrap {
                        stmts.append(StmtListWhich::OutsideWrapperPrefix, stmt);
                        continue 'stmt_loop;
                    }
                }

                bun_ast::StmtData::SFunction(s) => {
                    // Strip the "export" keyword while bundling
                    if should_strip_exports && s.func.flags.contains(G::FnFlags::IsExport) {
                        // Be c areful to not modify the original statement
                        stmt = Stmt::alloc(
                            S::Function {
                                // SAFETY: shallow bitwise copy of arena-backed G::Fn (matches Zig `s.func`).
                                func: unsafe { core::ptr::read(&raw const s.func) },
                            },
                            stmt.loc,
                        );
                        stmt.data
                            .s_function_mut()
                            .unwrap()
                            .func
                            .flags
                            .remove(G::FnFlags::IsExport);
                    }
                }

                bun_ast::StmtData::SClass(s) => {
                    // Strip the "export" keyword while bundling
                    if should_strip_exports && s.is_export {
                        // Be careful to not modify the original statement
                        stmt = Stmt::alloc(
                            S::Class {
                                // SAFETY: shallow bitwise copy of arena-backed E::Class (matches Zig `s.class`).
                                class: unsafe { core::ptr::read(&raw const s.class) },
                                is_export: false,
                            },
                            stmt.loc,
                        );
                    }
                }

                bun_ast::StmtData::SLocal(s) => {
                    // Strip the "export" keyword while bundling
                    if should_strip_exports && s.is_export {
                        // Be careful to not modify the original statement
                        // SAFETY: shallow bitwise copy of arena-backed S::Local (matches Zig `s.*`).
                        let copied: S::Local = unsafe { core::ptr::read(s.as_ptr()) };
                        stmt = Stmt::alloc(copied, stmt.loc);
                        stmt.data.s_local_mut().unwrap().is_export = false;
                    } else if FeatureFlags::UNWRAP_COMMONJS_TO_ESM
                        && s.was_commonjs_export
                        && wrap == WrapKind::Cjs
                    {
                        debug_assert!(s.decls.len() == 1);
                        let decl = *s.decls.at(0);
                        if let Some(decl_value) = decl.value {
                            let ident_ref = match decl.binding.data {
                                B::B::BIdentifier(id) => id.r#ref,
                                _ => unreachable!(),
                            };
                            stmt = Stmt::alloc(
                                S::SExpr {
                                    value: Expr::init(
                                        E::Binary {
                                            op: js_ast::OpCode::BinAssign,
                                            left: Expr::init(
                                                E::CommonJSExportIdentifier {
                                                    ref_: ident_ref,
                                                    ..Default::default()
                                                },
                                                decl.binding.loc,
                                            ),
                                            right: decl_value,
                                        },
                                        stmt.loc,
                                    ),
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                        } else {
                            continue 'stmt_loop;
                        }
                    }
                }

                bun_ast::StmtData::SExportDefault(s) => {
                    // "export default foo"

                    if should_strip_exports {
                        match &s.value {
                            bun_ast::StmtOrExpr::Stmt(stmt2) => {
                                match stmt2.data {
                                    bun_ast::StmtData::SExpr(s2) => {
                                        // "export default foo;" => "var default = foo;"
                                        stmt = Stmt::alloc(
                                            S::Local {
                                                decls: G::DeclList::from_slice(&[G::Decl {
                                                    binding: Binding::alloc(
                                                        bump,
                                                        B::Identifier {
                                                            r#ref: s
                                                                .default_name
                                                                .ref_
                                                                .expect("infallible: ref bound"),
                                                        },
                                                        s2.value.loc,
                                                    ),
                                                    value: Some(s2.value),
                                                }]),
                                                ..Default::default()
                                            },
                                            stmt.loc,
                                        );
                                    }
                                    bun_ast::StmtData::SFunction(s2) => {
                                        // "export default function() {}" => "function default() {}"
                                        // "export default function foo() {}" => "function foo() {}"

                                        // Be careful to not modify the original statement
                                        stmt = Stmt::alloc(
                                            S::Function {
                                                // SAFETY: shallow bitwise copy of arena-backed G::Fn (matches Zig `s2.func`).
                                                func: unsafe {
                                                    core::ptr::read(&raw const s2.func)
                                                },
                                            },
                                            stmt.loc,
                                        );
                                        stmt.data.s_function_mut().unwrap().func.name =
                                            Some(s.default_name);
                                    }

                                    bun_ast::StmtData::SClass(s2) => {
                                        // "export default class {}" => "class default {}"
                                        // "export default class foo {}" => "class foo {}"

                                        // Be careful to not modify the original statement
                                        stmt = Stmt::alloc(
                                            S::Class {
                                                // SAFETY: shallow bitwise copy of arena-backed E::Class (matches Zig `s2.class`).
                                                class: unsafe {
                                                    core::ptr::read(&raw const s2.class)
                                                },
                                                is_export: false,
                                            },
                                            stmt.loc,
                                        );
                                        stmt.data.s_class_mut().unwrap().class.class_name =
                                            Some(s.default_name);
                                    }

                                    _ => unreachable!(
                                        "Unexpected type in source file {}",
                                        bstr::BStr::new(
                                            &c.parse_graph()
                                                .input_files
                                                .get(
                                                    c.graph
                                                        .files
                                                        .get(source_index as usize)
                                                        .input_file
                                                        .get()
                                                        as usize
                                                )
                                                .source
                                                .path
                                                .text
                                        ),
                                    ),
                                }
                            }
                            bun_ast::StmtOrExpr::Expr(e) => {
                                stmt = Stmt::alloc(
                                    S::Local {
                                        decls: G::DeclList::from_slice(&[G::Decl {
                                            binding: Binding::alloc(
                                                bump,
                                                B::Identifier {
                                                    r#ref: s
                                                        .default_name
                                                        .ref_
                                                        .expect("infallible: ref bound"),
                                                },
                                                e.loc,
                                            ),
                                            value: Some(*e),
                                        }]),
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                );
                            }
                        }
                    }
                }

                _ => {}
            }
        }

        stmts.append(StmtListWhich::InsideWrapperSuffix, stmt);
    }

    Ok(())
}

pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/linker_context/convertStmtsForChunk.zig
