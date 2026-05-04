use bun_alloc::Arena as Bump;
use bun_collections::BabyList;
use bun_core::FeatureFlags;
use bun_js_parser::ast::{self as js_ast, Binding, Expr, ExprNodeList, Stmt};
use bun_js_parser::ast::{B, E, G, S};
use bun_js_parser::ast::BundledAst as JSAst;
use bun_logger::{self as logger, Loc};

use bun_bundler::{Chunk, WrapKind};
use bun_bundler::linker_context::{LinkerContext, StmtList, StmtListKind};

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
    c: &mut LinkerContext,
    source_index: u32,
    stmts: &mut StmtList,
    part_stmts: &[js_ast::Stmt],
    chunk: &mut Chunk,
    bump: &Bump,
    wrap: WrapKind,
    ast: &JSAst,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let should_extract_esm_stmts_for_wrap = wrap != WrapKind::None;
    let should_strip_exports = c.options.mode != bun_bundler::options::Mode::Passthrough
        || c.graph.files.items().entry_point_kind[source_index as usize] != bun_bundler::EntryPointKind::None;

    let flags = c.graph.meta.items().flags;
    let output_format = c.options.output_format;

    // If this file is a CommonJS entry point, double-write re-exports to the
    // external CommonJS "module.exports" object in addition to our internal ESM
    // export namespace object. The difference between these two objects is that
    // our internal one must not have the "__esModule" marker while the external
    // one must have the "__esModule" marker. This is done because an ES module
    // importing itself should not see the "__esModule" marker but a CommonJS module
    // importing us should see the "__esModule" marker.
    let mut module_exports_for_export: Option<Expr> = None;
    if output_format == bun_bundler::options::OutputFormat::Cjs && chunk.is_entry_point() {
        module_exports_for_export = Some(Expr::allocate(
            bump,
            E::Dot {
                target: Expr::allocate(
                    bump,
                    E::Identifier {
                        ref_: c.unbound_module_ref,
                    },
                    Loc::EMPTY,
                ),
                name: b"exports",
                name_loc: Loc::EMPTY,
            },
            Loc::EMPTY,
        ));
    }

    for stmt_ in part_stmts {
        let mut stmt = *stmt_;
        'process_stmt: {
            match stmt.data {
                js_ast::StmtData::SImport(s) => {
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
                        continue;
                    }

                    // Make sure these don't end up in the wrapper closure
                    if should_extract_esm_stmts_for_wrap {
                        stmts.append(StmtListKind::OutsideWrapperPrefix, stmt)?;
                        continue;
                    }
                }
                js_ast::StmtData::SExportStar(s) => {
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
                            continue;
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
                            stmts.append(StmtListKind::OutsideWrapperPrefix, stmt)?;
                            continue;
                        }

                        break 'process_stmt;
                    }

                    // "export * from 'path'"
                    let record = ast.import_records.at(s.import_record_index);

                    // Barrel optimization: deferred export * records should be dropped
                    if record.flags.is_unused {
                        continue;
                    }

                    if !should_strip_exports {
                        break 'process_stmt;
                    }

                    // Is this export star evaluated at run time?
                    if !record.source_index.is_valid() && c.options.output_format.keep_es6_import_export_syntax() {
                        if record.flags.calls_runtime_re_export_fn {
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
                            // PERF(port): was arena alloc of [Expr; N] — using bump slice
                            let args = bump.alloc_slice_fill_default::<Expr>(args_len);
                            args[0] = Expr::init(
                                E::Identifier {
                                    ref_: ast.exports_ref,
                                },
                                stmt.loc,
                            );
                            args[1] = Expr::init(
                                E::Identifier {
                                    ref_: s.namespace_ref,
                                },
                                stmt.loc,
                            );

                            if let Some(mod_) = module_exports_for_export {
                                // TODO(port): Zig writes args[3] which is out-of-bounds (len is 3); preserved verbatim — verify intent in Phase B (likely should be args[2])
                                args[3] = mod_;
                            }

                            stmts.inside_wrapper_prefix.append_non_dependency(
                                Stmt::alloc(
                                    S::SExpr {
                                        value: Expr::allocate(
                                            bump,
                                            E::Call {
                                                target: Expr::allocate(
                                                    bump,
                                                    E::Identifier {
                                                        ref_: export_star_ref,
                                                    },
                                                    stmt.loc,
                                                ),
                                                args: BabyList::<Expr>::from_owned_slice(args),
                                                ..Default::default()
                                            },
                                            stmt.loc,
                                        ),
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ),
                            )?;

                            // Make sure these don't end up in the wrapper closure
                            if should_extract_esm_stmts_for_wrap {
                                stmts.append(StmtListKind::OutsideWrapperPrefix, stmt)?;
                                continue;
                            }
                        }
                    } else {
                        if record.source_index.is_valid() {
                            let flag = flags[record.source_index.get() as usize];
                            let wrapper_ref = c.graph.ast.items().wrapper_ref[record.source_index.get() as usize];
                            if flag.wrap == WrapKind::Esm && wrapper_ref.is_valid() {
                                stmts.inside_wrapper_prefix.append_non_dependency(
                                    Stmt::alloc(
                                        S::SExpr {
                                            value: Expr::init(
                                                E::Call {
                                                    target: Expr::init(
                                                        E::Identifier {
                                                            ref_: wrapper_ref,
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
                                    ),
                                )?;
                            }
                        }

                        if record.flags.calls_runtime_re_export_fn {
                            let target: Expr = 'brk: {
                                if record.source_index.is_valid()
                                    && c.graph.ast.items().exports_kind[record.source_index.get() as usize]
                                        .is_esm_with_dynamic_fallback()
                                {
                                    // Prefix this module with "__reExport(exports, otherExports, module.exports)"
                                    break 'brk Expr::init_identifier(
                                        c.graph.ast.items().exports_ref[record.source_index.get() as usize],
                                        stmt.loc,
                                    );
                                }

                                break 'brk Expr::init(
                                    E::RequireString {
                                        import_record_index: s.import_record_index,
                                    },
                                    stmt.loc,
                                );
                            };

                            // Prefix this module with "__reExport(exports, require(path), module.exports)"
                            let export_star_ref = c.runtime_function(b"__reExport");
                            let args_len = 2 + usize::from(module_exports_for_export.is_some());
                            // PERF(port): was arena alloc of [Expr; N] — using bump slice
                            let args = bump.alloc_slice_fill_default::<Expr>(args_len);
                            args[0] = Expr::init(
                                E::Identifier {
                                    ref_: ast.exports_ref,
                                },
                                stmt.loc,
                            );
                            args[1] = target;

                            if let Some(mod_) = module_exports_for_export {
                                args[2] = mod_;
                            }

                            stmts.inside_wrapper_prefix.append_non_dependency(
                                Stmt::alloc(
                                    S::SExpr {
                                        value: Expr::init(
                                            E::Call {
                                                target: Expr::init(
                                                    E::Identifier {
                                                        ref_: export_star_ref,
                                                    },
                                                    stmt.loc,
                                                ),
                                                args: ExprNodeList::from_owned_slice(args),
                                                ..Default::default()
                                            },
                                            stmt.loc,
                                        ),
                                        ..Default::default()
                                    },
                                    stmt.loc,
                                ),
                            )?;
                        }

                        // Remove the export star statement
                        continue;
                    }
                }

                js_ast::StmtData::SExportFrom(s) => {
                    // "export {foo} from 'path'"
                    if c.should_remove_import_export_stmt(
                        stmts,
                        stmt.loc,
                        s.namespace_ref,
                        s.import_record_index,
                        bump,
                        ast,
                    )? {
                        continue;
                    }

                    if should_strip_exports {
                        // Turn this statement into "import {foo} from 'path'"
                        // TODO: is this allocation necessary?
                        let items = bump
                            .alloc_slice_fill_default::<js_ast::ClauseItem>(s.items.len());
                        // catch unreachable → expect (alloc-only path)
                        debug_assert_eq!(s.items.len(), items.len());
                        for (src, dest) in s.items.iter().zip(items.iter_mut()) {
                            *dest = js_ast::ClauseItem {
                                alias: src.original_name,
                                alias_loc: src.alias_loc,
                                name: src.name,
                                ..Default::default()
                            };
                        }

                        stmt = Stmt::alloc(
                            S::Import {
                                items,
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
                        stmts.append(StmtListKind::OutsideWrapperPrefix, stmt)?;
                        continue;
                    }
                }

                js_ast::StmtData::SExportClause(_) => {
                    // "export {foo}"

                    if should_strip_exports {
                        // Remove export statements entirely
                        continue;
                    }

                    // Make sure these don't end up in the wrapper closure
                    if should_extract_esm_stmts_for_wrap {
                        stmts.append(StmtListKind::OutsideWrapperPrefix, stmt)?;
                        continue;
                    }
                }

                js_ast::StmtData::SFunction(s) => {
                    // Strip the "export" keyword while bundling
                    if should_strip_exports && s.func.flags.contains(G::FnFlags::IS_EXPORT) {
                        // Be c areful to not modify the original statement
                        stmt = Stmt::alloc(
                            S::Function {
                                func: s.func,
                            },
                            stmt.loc,
                        );
                        // TODO(port): mutating freshly-allocated stmt payload via enum re-match
                        if let js_ast::StmtData::SFunction(new_s) = &mut stmt.data {
                            new_s.func.flags.remove(G::FnFlags::IS_EXPORT);
                        }
                    }
                }

                js_ast::StmtData::SClass(s) => {
                    // Strip the "export" keyword while bundling
                    if should_strip_exports && s.is_export {
                        // Be careful to not modify the original statement
                        stmt = Stmt::alloc(
                            S::Class {
                                class: s.class,
                                is_export: false,
                            },
                            stmt.loc,
                        );
                    }
                }

                js_ast::StmtData::SLocal(s) => {
                    // Strip the "export" keyword while bundling
                    if should_strip_exports && s.is_export {
                        // Be careful to not modify the original statement
                        stmt = Stmt::alloc(
                            (*s).clone(),
                            stmt.loc,
                        );
                        // TODO(port): mutating freshly-allocated stmt payload via enum re-match
                        if let js_ast::StmtData::SLocal(new_s) = &mut stmt.data {
                            new_s.is_export = false;
                        }
                    } else if FeatureFlags::UNWRAP_COMMONJS_TO_ESM && s.was_commonjs_export && wrap == WrapKind::Cjs {
                        debug_assert!(s.decls.len() == 1);
                        let decl = s.decls.ptr()[0];
                        if let Some(decl_value) = decl.value {
                            stmt = Stmt::alloc(
                                S::SExpr {
                                    value: Expr::init(
                                        E::Binary {
                                            op: js_ast::Op::BinAssign,
                                            left: Expr::init(
                                                E::CommonJSExportIdentifier {
                                                    // TODO(port): decl.binding.data.b_identifier.ref — depends on Binding enum shape
                                                    ref_: decl.binding.data.as_b_identifier().ref_,
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
                            continue;
                        }
                    }
                }

                js_ast::StmtData::SExportDefault(s) => {
                    // "export default foo"

                    if should_strip_exports {
                        match &s.value {
                            js_ast::StmtOrExpr::Stmt(stmt2) => {
                                match stmt2.data {
                                    js_ast::StmtData::SExpr(s2) => {
                                        // "export default foo;" => "var default = foo;"
                                        stmt = Stmt::alloc(
                                            S::Local {
                                                decls: G::Decl::List::from_slice(
                                                    bump,
                                                    &[G::Decl {
                                                        binding: Binding::alloc(
                                                            bump,
                                                            B::Identifier {
                                                                ref_: s.default_name.ref_.unwrap(),
                                                            },
                                                            s2.value.loc,
                                                        ),
                                                        value: Some(s2.value),
                                                    }],
                                                )?,
                                                ..Default::default()
                                            },
                                            stmt.loc,
                                        );
                                    }
                                    js_ast::StmtData::SFunction(s2) => {
                                        // "export default function() {}" => "function default() {}"
                                        // "export default function foo() {}" => "function foo() {}"

                                        // Be careful to not modify the original statement
                                        stmt = Stmt::alloc(
                                            S::Function {
                                                func: s2.func,
                                            },
                                            stmt.loc,
                                        );
                                        // TODO(port): mutating freshly-allocated stmt payload via enum re-match
                                        if let js_ast::StmtData::SFunction(new_s) = &mut stmt.data {
                                            new_s.func.name = Some(s.default_name);
                                        }
                                    }

                                    js_ast::StmtData::SClass(s2) => {
                                        // "export default class {}" => "class default {}"
                                        // "export default class foo {}" => "class foo {}"

                                        // Be careful to not modify the original statement
                                        stmt = Stmt::alloc(
                                            S::Class {
                                                class: s2.class,
                                                is_export: false,
                                            },
                                            stmt.loc,
                                        );
                                        // TODO(port): mutating freshly-allocated stmt payload via enum re-match
                                        if let js_ast::StmtData::SClass(new_s) = &mut stmt.data {
                                            new_s.class.class_name = Some(s.default_name);
                                        }
                                    }

                                    _ => unreachable!(
                                        "Unexpected type in source file {}",
                                        bstr::BStr::new(
                                            &c.parse_graph
                                                .input_files
                                                .get(c.graph.files.get(source_index as usize).input_file.get() as usize)
                                                .source
                                                .path
                                                .text
                                        ),
                                    ),
                                }
                            }
                            js_ast::StmtOrExpr::Expr(e) => {
                                stmt = Stmt::alloc(
                                    S::Local {
                                        decls: G::Decl::List::from_slice(
                                            bump,
                                            &[G::Decl {
                                                binding: Binding::alloc(
                                                    bump,
                                                    B::Identifier {
                                                        ref_: s.default_name.ref_.unwrap(),
                                                    },
                                                    e.loc,
                                                ),
                                                value: Some(*e),
                                            }],
                                        )?,
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

        stmts.append(StmtListKind::InsideWrapperSuffix, stmt)?;
    }

    Ok(())
}

pub use bun_bundler::DeferredBatchTask;
pub use bun_bundler::ThreadPool;
pub use bun_bundler::ParseTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/convertStmtsForChunk.zig (558 lines)
//   confidence: medium
//   todos:      6
//   notes:      AST node construction (Stmt::alloc/Expr::init) and StmtData enum shape are guesses; Zig has args[3] OOB write preserved verbatim; post-alloc payload mutation reshaped via re-match for borrowck.
// ──────────────────────────────────────────────────────────────────────────
