use crate::Graph::CssAsts;
use crate::mal_prelude::*;
use bun_collections::VecExt as _VecExt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_ast::{B, Binding, E, Expr, ExprData, G, S, Stmt, StmtData};
use bun_ast::{ImportRecord, Source};
use bun_js_parser::js_lexer;

use crate::bun_css::BundlerStyleSheet;
use crate::bun_css::css_modules::{ComposesGraph, ComposesVisitor, ExportedName};
use crate::{Index, IndexInt, LinkerContext};

type SymbolList<'a> = bun_ast::symbol::List<'a>;

/// What the `composes` walk of a CSS module reads of the graph.
struct CssModuleGraph<'a, 'bump> {
    all_import_records: &'a [bun_ast::import_record::List<'a>],
    all_css_asts: &'a CssAsts<'bump>,
    all_sources: &'a [Source<'a>],
}

impl<'bump> ComposesGraph<'bump> for CssModuleGraph<'_, 'bump> {
    fn stylesheet(&self, idx: IndexInt) -> Option<&BundlerStyleSheet<'bump>> {
        self.all_css_asts[idx as usize].as_deref()
    }

    fn source(&self, idx: IndexInt) -> &Source<'_> {
        &self.all_sources[idx as usize]
    }

    fn import_record(&self, idx: IndexInt, import_record_idx: u32) -> &ImportRecord<'_> {
        &self.all_import_records[idx as usize][import_record_idx as usize]
    }
}

/// Reports what is wrong with the `composes` of the stylesheet `source_index`. A JS stub of the
/// stylesheet walks the same names to export them, and reports nothing.
pub(crate) fn report_composes_errors(
    this: &LinkerContext,
    log: &mut bun_ast::Log,
    source_index: IndexInt,
) {
    let all_css_asts = &this.parse_graph().css_asts;
    let Some(css_ast) = all_css_asts[source_index as usize].as_deref() else {
        return;
    };
    if css_ast.composes.count() == 0 {
        return;
    }
    let graph = CssModuleGraph {
        all_import_records: this.graph.ast.items_import_records(),
        all_css_asts,
        all_sources: this.parse_graph().input_files.items_source(),
    };
    let mut visitor = ComposesVisitor::new(&graph);
    for entry in css_ast.local_scope.values() {
        visitor.exported_names(css_ast, entry.ref_, source_index, log);
    }
}

/// The object that JavaScript gets for the CSS module `stylesheet`: each local name with the class
/// names it stands for. `None`: the stylesheet has no local name.
pub(crate) fn css_module_exports(
    this: &LinkerContext,
    stylesheet: IndexInt,
    loc: bun_ast::Loc,
) -> Result<Option<E::Object>, AllocError> {
    let all_css_asts = &this.parse_graph().css_asts;
    let Some(css_ast) = all_css_asts[stylesheet as usize].as_deref() else {
        return Ok(None);
    };
    if css_ast.local_scope.count() == 0 {
        return Ok(None);
    }
    let mut exports = E::Object::default();

    let symbols: &SymbolList<'_> = &this.graph.ast.items_symbols()[stylesheet as usize];

    let graph = CssModuleGraph {
        all_import_records: this.graph.ast.items_import_records(),
        all_css_asts,
        all_sources: this.parse_graph().input_files.items_source(),
    };
    let mut visitor = ComposesVisitor::new(&graph);
    let arena = this.arena();
    // `report_composes_errors` reported them for the stylesheet.
    let mut unreported = bun_ast::Log::init();

    for entry in css_ast.local_scope.values() {
        let ref_ = entry.ref_;
        debug_assert!(ref_.inner_index() < symbols.len() as u32);

        let name_expr = |name: &ExportedName<'_>| match *name {
            ExportedName::Local(ref_) => Expr::init(
                E::NameOfSymbol {
                    ref_,
                    ..Default::default()
                },
                loc,
            ),
            ExportedName::Global(name) => Expr::init(E::String::init(name), loc),
        };
        let names = visitor.exported_names(css_ast, ref_, stylesheet, &mut unreported);
        let value = if let [name] = names {
            name_expr(name)
        } else {
            // Move the parts into the linker arena
            // (freed when the linker arena drops).
            let parts_slice = bun_ast::StoreSlice::new_mut(arena.alloc_slice_fill_iter(
                names.iter().enumerate().map(|(i, name)| {
                    let tail: &[u8] = if i + 1 == names.len() { b"" } else { b" " };
                    E::TemplatePart {
                        value: name_expr(name),
                        tail_loc: loc,
                        tail: E::TemplateContents::Cooked(E::String::init(tail)),
                    }
                }),
            ));
            Expr::init(
                E::Template {
                    tag: None,
                    parts: parts_slice,
                    head: E::TemplateContents::Cooked(E::String::init(b"")),
                },
                loc,
            )
        };

        // `Symbol.original_name: StoreStr` — arena-owned for the link pass.
        let key: &[u8] = symbols[ref_.inner_index() as usize].original_name.slice();
        exports.put(arena, key, value)?;
    }
    Ok(Some(exports))
}

pub(crate) fn generate_code_for_lazy_export(
    this: &mut LinkerContext,
    source_index: IndexInt,
) -> Result<(), AllocError> {
    let mut exports_kind = this.graph.ast.items_exports_kind()[source_index as usize];
    // The dev server's module format represents lazy-export modules (JSON,
    // TOML, CSS modules, ...) as CommonJS modules evaluated by the HMR
    // runtime, so always generate the `module.exports = ...` form below.
    // The ESM form would synthesize `export` parts that
    // `print_dev_server_module` cannot represent.
    if this.options.output_format == crate::options::OutputFormat::InternalBakeDev
        && exports_kind != bun_ast::ExportsKind::Cjs
    {
        exports_kind = bun_ast::ExportsKind::Cjs;
        this.graph.ast.items_exports_kind_mut()[source_index as usize] = exports_kind;
    }
    // If this JavaScript file is a stub from a CSS file, its exports are the local names of that CSS file.
    let stylesheet = this.parse_graph().css_js_stubs.stylesheet_of(source_index);
    let part = &mut this.graph.ast.items_parts_mut()[source_index as usize].as_mut_slice()[1];
    let stmts = part.stmts;
    if stmts.is_empty() {
        panic!("Internal error: expected at least one statement in the lazy export");
    }
    if exports_kind != bun_ast::ExportsKind::Cjs {
        part.stmts = bun_ast::StoreSlice::EMPTY;
        // The emptied part of a stub is in no chunk, as when the stylesheet had these parts: a chunk keeps the
        // part ranges that its hash is made of. The other lazy exports keep the part in their chunk.
        if stylesheet.is_some() {
            part.can_be_removed_if_unused = true;
        }
    }

    let all_sources = this.parse_graph().input_files.items_source();

    let module_ref = this.graph.ast.items_module_ref()[source_index as usize];

    // Handle css modules
    //
    // --- original comment from esbuild ---
    // If this JavaScript file is a stub from a CSS file, populate the exports of
    // this JavaScript stub with the local names from that CSS file. This is done
    // now instead of earlier because we need the whole bundle to be present.
    if let Some(stylesheet) = stylesheet {
        let stmt: Stmt = stmts[0];
        let StmtData::SLazyExport(mut slot) = stmt.data else {
            panic!("Internal error: expected top-level lazy export statement");
        };
        if let Some(exports) = css_module_exports(this, stylesheet, stmt.loc)? {
            // `StoreRef<ExprData>` is a Copy `NonNull` — write through the pointer.
            *slot = Expr::init(exports, stmt.loc).data;
        }
    }

    let stmt: Stmt = stmts[0];
    let StmtData::SLazyExport(lazy) = stmt.data else {
        panic!("Internal error: expected top-level lazy export statement");
    };
    let expr = Expr {
        data: *lazy,
        loc: stmt.loc,
    };

    // `require(<asset>)` prints as the runtime's `__require` outside CommonJS
    // output, so the part that holds the call must import it.
    let calls_runtime_require = matches!(expr.data, ExprData::ECall(ref c)
        if matches!(c.target.data, ExprData::ERequireCallTarget))
        && this.options.output_format != crate::options::OutputFormat::Cjs;

    match exports_kind {
        bun_ast::ExportsKind::Cjs => {
            stmts.slice_mut()[0] = Stmt::assign(
                Expr::init(
                    E::Dot {
                        target: Expr::init_identifier(module_ref, stmt.loc),
                        name: b"exports".as_slice().into(),
                        name_loc: stmt.loc,
                        ..Default::default()
                    },
                    stmt.loc,
                ),
                expr,
            );
            this.graph.generate_symbol_import_and_use(
                source_index,
                0,
                module_ref,
                1,
                Index::init(source_index),
            )?;

            if calls_runtime_require {
                this.graph.generate_runtime_symbol_import_and_use(
                    source_index,
                    Index::part(1u32),
                    b"__require",
                    1,
                )?;
            }
        }
        _ => {
            // Otherwise, generate ES6 export statements. These are added as additional
            // parts so they can be tree shaken individually.
            if let ExprData::EObject(e_object) = &expr.data {
                for property in e_object.properties.slice() {
                    let _: &G::Property = property;
                    let Some(key) = property.key else { continue };
                    let ExprData::EString(key_str) = key.data else {
                        continue;
                    };
                    let Some(value) = property.value else {
                        continue;
                    };
                    if key_str.eql_comptime(b"default") || key_str.eql_comptime(b"__esModule") {
                        continue;
                    }

                    let alloc = this.arena();
                    let name: &[u8] = bun_core::handle_oom(key_str.flattened(alloc).string(alloc));

                    // TODO: support non-identifier names
                    if !js_lexer::is_identifier(name) {
                        continue;
                    }

                    // This initializes the generated variable with a copy of the property
                    // value, which is INCORRECT for values that are objects/arrays because
                    // they will have separate object identity. This is fixed up later in
                    // "generateCodeForFileInChunkJS" by changing the object literal to
                    // reference this generated variable instead.
                    //
                    // Changing the object literal is deferred until that point instead of
                    // doing it now because we only want to do this for top-level variables
                    // that actually end up being used, and we don't know which ones will
                    // end up actually being used at this point (since import binding hasn't
                    // happened yet). So we need to wait until after tree shaking happens.
                    let generated =
                        this.generate_named_export_in_file(source_index, module_ref, name, name)?;
                    let new_stmts: &mut [Stmt] =
                        alloc.alloc_slice_fill_iter(core::iter::once(Stmt::alloc(
                            S::Local {
                                is_export: true,
                                decls: G::DeclList::from_slice(&[G::Decl {
                                    binding: Binding::alloc(
                                        alloc,
                                        B::Identifier { r#ref: generated.0 },
                                        expr.loc,
                                    ),
                                    value: Some(value),
                                }]),
                                ..Default::default()
                            },
                            key.loc,
                        )));
                    // Re-borrow `parts` here for borrowck.
                    let parts =
                        this.graph.ast.items_parts_mut()[source_index as usize].as_mut_slice();
                    parts[generated.1 as usize].stmts = bun_ast::StoreSlice::new_mut(new_stmts);
                }
            }

            {
                let mut name_buf: Vec<u8> = Vec::new();
                write!(
                    &mut name_buf,
                    "{}_default",
                    all_sources[source_index as usize].fmt_identifier()
                )
                .expect("write to Vec<u8> cannot fail");
                let alloc = this.arena();
                let name = alloc.alloc_slice_copy(&name_buf);

                let generated =
                    this.generate_named_export_in_file(source_index, module_ref, name, b"default")?;
                let new_stmts: &mut [Stmt] =
                    alloc.alloc_slice_fill_iter(core::iter::once(Stmt::alloc(
                        S::ExportDefault {
                            default_name: bun_ast::LocRef {
                                ref_: generated.0,
                                loc: stmt.loc,
                            },
                            value: bun_ast::StmtOrExpr::Expr(expr),
                        },
                        stmt.loc,
                    )));
                let parts = this.graph.ast.items_parts_mut()[source_index as usize].as_mut_slice();
                parts[generated.1 as usize].stmts = bun_ast::StoreSlice::new_mut(new_stmts);

                if calls_runtime_require {
                    this.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        Index::part(generated.1),
                        b"__require",
                        1,
                    )?;
                }
            }
        }
    }

    Ok(())
}
