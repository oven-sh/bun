use crate::mal_prelude::*;
use bun_collections::VecExt as _VecExt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_alloc::Arena;
use bun_ast::{B, Binding, E, Expr, ExprData, G, Part, S, Stmt, StmtData};
use bun_ast::{ImportRecord, Source};
use bun_js_parser::js_lexer;

use crate::bun_css::BundlerStyleSheet;
use crate::bun_css::css_modules::{ComposesGraph, ComposesVisitor, ExportedName};
use crate::{Index, IndexInt, LinkerContext};

type SymbolList<'a> = bun_ast::symbol::List<'a>;

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
    // Take `parts` as a raw pointer *before* the
    // long-lived immutable `items_css()` borrow below; re-borrowed again later as needed.
    let parts: *mut [Part] = this.graph.ast.items_parts_mut()[source_index as usize].as_mut_slice();
    // SAFETY: parse_graph backref; raw deref because `all_sources` is held
    // across `&mut *this.log` below (split borrow).
    let all_sources = unsafe { &(*this.parse_graph).input_files }.items_source();
    let all_css_asts: &[crate::bundled_ast::CssCol] = this.graph.ast.items_css();
    let maybe_css_ast: Option<&BundlerStyleSheet> = all_css_asts[source_index as usize].as_deref();

    // SAFETY: `parts` is a stable SoA column slice valid for the link pass.
    if unsafe { (&*parts).len() } < 1 {
        panic!("Internal error: expected at least one part for lazy export");
    }

    // SAFETY: `parts.ptr[1]` — Vec raw indexing; using index 1 here.
    let part: &mut Part = unsafe { &mut (*parts)[1] };

    // `Part.stmts: StoreSlice<Stmt>` — safe `Deref` to `&[Stmt]`.
    if part.stmts.is_empty() {
        panic!("Internal error: expected at least one statement in the lazy export");
    }

    let module_ref = this.graph.ast.items_module_ref()[source_index as usize];

    // Handle css modules
    //
    // --- original comment from esbuild ---
    // If this JavaScript file is a stub from a CSS file, populate the exports of
    // this JavaScript stub with the local names from that CSS file. This is done
    // now instead of earlier because we need the whole bundle to be present.
    if let Some(css_ast) = maybe_css_ast {
        let stmt: Stmt = part.stmts[0];
        if !matches!(stmt.data, StmtData::SLazyExport(_)) {
            panic!("Internal error: expected top-level lazy export statement");
        }
        'out: {
            if css_ast.local_scope.count() == 0 {
                break 'out;
            }
            let mut exports = E::Object::default();

            let symbols: &SymbolList<'_> = &this.graph.ast.items_symbols()[source_index as usize];

            struct Graph<'a> {
                all_import_records: &'a [bun_ast::import_record::List<'a>],
                // `BundledAst.css` SoA column.
                all_css_asts: &'a [crate::bundled_ast::CssCol],
                all_sources: &'a [Source],
            }

            impl ComposesGraph for Graph<'_> {
                fn stylesheet(&self, idx: IndexInt) -> Option<&BundlerStyleSheet> {
                    self.all_css_asts[idx as usize].as_deref()
                }

                fn source(&self, idx: IndexInt) -> &Source {
                    &self.all_sources[idx as usize]
                }

                fn import_record(&self, idx: IndexInt, import_record_idx: u32) -> &ImportRecord {
                    &self.all_import_records[idx as usize][import_record_idx as usize]
                }
            }

            let graph = Graph {
                all_import_records: this.graph.ast.items_import_records(),
                all_css_asts,
                all_sources,
            };
            let mut visitor = ComposesVisitor::new(&graph);
            // SAFETY: `LinkerContext::arena()` returns a stable `&Arena` valid for the
            // link pass; detach via raw-pointer round-trip so it doesn't hold a `&self`
            // borrow across the `this.log` reborrow below.
            let arena: &Arena = unsafe { bun_ptr::detach_lifetime_ref::<Arena>(this.arena()) };

            for entry in css_ast.local_scope.values() {
                let ref_ = entry.ref_;
                debug_assert!(ref_.inner_index() < symbols.len() as u32);

                let name_expr = |name: &ExportedName<'_>| match *name {
                    ExportedName::Local(ref_) => Expr::init(
                        E::NameOfSymbol {
                            ref_,
                            ..Default::default()
                        },
                        stmt.loc,
                    ),
                    ExportedName::Global(name) => Expr::init(E::String::init(name), stmt.loc),
                };
                // Split-borrow — see `LinkerContext::log_disjoint`.
                let names =
                    visitor.exported_names(css_ast, ref_, source_index, this.log_disjoint());
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
                                tail_loc: stmt.loc,
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
                        stmt.loc,
                    )
                };

                // `Symbol.original_name: StoreStr` — arena-owned for the link pass.
                let key: &[u8] = symbols[ref_.inner_index() as usize].original_name.slice();
                exports.put(arena, key, value)?;
            }

            if let StmtData::SLazyExport(mut slot) = part.stmts[0].data {
                // `StoreRef<ExprData>` is a Copy `NonNull` — write through the pointer.
                *slot = Expr::init(exports, stmt.loc).data;
            }
        }
    }

    let stmt: Stmt = part.stmts[0];
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
            part.stmts.slice_mut()[0] = Stmt::assign(
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
            part.stmts = bun_ast::StoreSlice::EMPTY;

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

                    // SAFETY: `LinkerContext::arena()` returns a stable `&Arena` valid for the
                    // link pass; detach via raw-pointer round-trip so `name` doesn't borrow `this`
                    // across the `&mut self` call to `generate_named_export_in_file` below.
                    let alloc: &bun_alloc::Arena =
                        unsafe { bun_ptr::detach_lifetime_ref::<bun_alloc::Arena>(this.arena()) };
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
                    this.parse_graph().input_files.items_source()[source_index as usize]
                        .fmt_identifier()
                )
                .expect("write to Vec<u8> cannot fail");
                // SAFETY: `LinkerContext::arena()` returns a stable `&Arena` valid for the
                // link pass; detach via raw-pointer round-trip so `name` doesn't borrow `this`
                // across the `&mut self` call to `generate_named_export_in_file` below.
                let alloc: &bun_alloc::Arena =
                    unsafe { bun_ptr::detach_lifetime_ref::<bun_alloc::Arena>(this.arena()) };
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
