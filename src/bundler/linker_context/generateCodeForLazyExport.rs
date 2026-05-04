use std::io::Write as _;

use bun_alloc::{AllocError, Arena};
use bun_collections::{ArrayHashMap, BabyList, DynamicBitSet};
use bun_core::fmt as bun_fmt;
use bun_css::{self, BundlerStyleSheet, CssRef};
use bun_js_parser::ast::{self as js_ast, B, Binding, E, Expr, G, Part, S, Stmt, Symbol};
use bun_js_parser::js_lexer;
use bun_logger::{Loc, Log, Source};

use bun_bundler::{Index, LinkerContext, Ref};

type BitSet = DynamicBitSet;

pub fn generate_code_for_lazy_export(
    this: &mut LinkerContext,
    source_index: Index::Int,
) -> Result<(), AllocError> {
    let exports_kind = this.graph.ast.items().exports_kind[source_index as usize];
    let all_sources = this.parse_graph.input_files.items().source;
    let all_css_asts = this.graph.ast.items().css;
    let maybe_css_ast: Option<&BundlerStyleSheet> = all_css_asts[source_index as usize];
    // PORT NOTE: reshaped for borrowck — `parts` re-borrowed below after other graph borrows drop.
    let parts = &mut this.graph.ast.items_mut().parts[source_index as usize];

    if parts.len() < 1 {
        panic!("Internal error: expected at least one part for lazy export");
    }

    // TODO(port): `parts.ptr[1]` — BabyList raw indexing; using index 1 here.
    let part: &mut Part = &mut parts[1];

    if part.stmts.len() == 0 {
        panic!("Internal error: expected at least one statement in the lazy export");
    }

    let module_ref = this.graph.ast.items().module_ref[source_index as usize];

    // Handle css modules
    //
    // --- original comment from esbuild ---
    // If this JavaScript file is a stub from a CSS file, populate the exports of
    // this JavaScript stub with the local names from that CSS file. This is done
    // now instead of earlier because we need the whole bundle to be present.
    if let Some(css_ast) = maybe_css_ast {
        let stmt: Stmt = part.stmts[0];
        if !matches!(stmt.data, js_ast::Stmt::Data::SLazyExport(_)) {
            // TODO(port): exact tag check shape for Stmt.data
            panic!("Internal error: expected top-level lazy export statement");
        }
        'out: {
            if css_ast.local_scope.count() == 0 {
                break 'out;
            }
            let mut exports = E::Object::default();

            let symbols: &Symbol::List = &this.graph.ast.items().symbols[source_index as usize];
            let all_import_records: &[BabyList<bun_css::ImportRecord>] =
                this.graph.ast.items().import_records;

            let values = css_ast.local_scope.values();
            if values.len() == 0 {
                break 'out;
            }
            let size: u32 = 'size: {
                let mut size: u32 = 0;
                for entry in values {
                    size = size.max(entry.ref_.inner_index);
                }
                break 'size size + 1;
            };

            let mut inner_visited = BitSet::init_empty(size as usize);
            // `defer inner_visited.deinit(...)` — handled by Drop.
            let mut composes_visited: ArrayHashMap<Ref, ()> = ArrayHashMap::new();
            // `defer composes_visited.deinit()` — handled by Drop.

            struct Visitor<'a> {
                inner_visited: &'a mut BitSet,
                // TODO(port): LIFETIMES.tsv said `HashMap<Ref, ()>`; Zig is AutoArrayHashMap → ArrayHashMap per collections map.
                composes_visited: &'a mut ArrayHashMap<Ref, ()>,
                parts: &'a mut Vec<E::TemplatePart>,
                all_import_records: &'a [BabyList<bun_css::ImportRecord>],
                // TODO(port): lifetime — slice of optional refs into graph.ast SoA storage.
                all_css_asts: &'a [Option<&'a BundlerStyleSheet>],
                all_sources: &'a [Source],
                all_symbols: &'a [Symbol::List],
                source_index: Index::Int,
                log: &'a mut Log,
                loc: Loc,
                // PERF(port): was `std.mem.Allocator` (arena) — bundler is an AST crate; thread `&'bump Bump`.
                allocator: &'a Arena,
            }

            impl<'a> Visitor<'a> {
                fn clear_all(&mut self) {
                    self.inner_visited.set_all(false);
                    self.composes_visited.clear();
                }

                fn visit_name(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    ref_: CssRef,
                    idx: Index::Int,
                ) {
                    debug_assert!(ref_.can_be_composed());
                    let from_this_file = ref_.source_index(idx) == self.source_index;
                    if (from_this_file && self.inner_visited.is_set(ref_.inner_index() as usize))
                        || (!from_this_file
                            && self.composes_visited.contains_key(&ref_.to_real_ref(idx)))
                    {
                        return;
                    }

                    self.visit_composes(ast, ref_, idx);
                    // PERF(port): was assume-OOM `catch |err| bun.handleOom(err)`; Vec::push aborts on OOM.
                    self.parts.push(E::TemplatePart {
                        value: Expr::init(
                            E::NameOfSymbol {
                                ref_: ref_.to_real_ref(idx),
                                ..Default::default()
                            },
                            self.loc,
                        ),
                        tail: E::TemplatePart::Tail::Cooked(E::String::init(b" ")),
                        tail_loc: self.loc,
                    });

                    if from_this_file {
                        self.inner_visited.set(ref_.inner_index() as usize);
                    } else {
                        self.composes_visited.insert(ref_.to_real_ref(idx), ());
                    }
                }

                fn warn_non_single_class_composes(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    css_ref: CssRef,
                    idx: Index::Int,
                    compose_loc: Loc,
                ) {
                    let ref_ = css_ref.to_real_ref(idx);
                    let _ = ref_;
                    let syms: &Symbol::List = &self.all_symbols[css_ref.source_index(idx) as usize];
                    let name = &syms.at(css_ref.inner_index() as usize).original_name;
                    let loc = ast.local_scope.get(name).unwrap().loc;

                    // PERF(port): was `catch |err| bun.handleOom(err)`.
                    self.log.add_range_error_fmt_with_note(
                        &self.all_sources[idx as usize],
                        bun_logger::Range { loc: compose_loc, ..Default::default() },
                        self.allocator,
                        format_args!(
                            "The composes property cannot be used with {}, because it is not a single class name.",
                            bun_fmt::quote(name),
                        ),
                        format_args!(
                            "The definition of {} is here.",
                            bun_fmt::quote(name),
                        ),
                        bun_logger::Range { loc, ..Default::default() },
                    );
                }

                fn visit_composes(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    css_ref: CssRef,
                    idx: Index::Int,
                ) {
                    let ref_ = css_ref.to_real_ref(idx);
                    if ast.composes.count() > 0 {
                        let Some(composes) = ast.composes.get(&ref_) else {
                            return;
                        };
                        // while parsing we check that we only allow `composes` on single class selectors
                        debug_assert!(css_ref.tag.class);

                        for compose in composes.composes.slice() {
                            // it is imported
                            if compose.from.is_some() {
                                // TODO(port): exact enum shape of `compose.from` (Specifier union).
                                if matches!(
                                    compose.from.as_ref().unwrap(),
                                    bun_css::Specifier::ImportRecordIndex(_)
                                ) {
                                    let import_record_idx = match compose.from.as_ref().unwrap() {
                                        bun_css::Specifier::ImportRecordIndex(i) => *i,
                                        _ => unreachable!(),
                                    };
                                    let import_records: &BabyList<bun_css::ImportRecord> =
                                        &self.all_import_records[idx as usize];
                                    let import_record = import_records.at(import_record_idx as usize);
                                    if import_record.source_index.is_valid() {
                                        let Some(other_file) =
                                            self.all_css_asts[import_record.source_index.get() as usize]
                                        else {
                                            self.log.add_error_fmt(
                                                &self.all_sources[idx as usize],
                                                compose.loc,
                                                self.allocator,
                                                format_args!(
                                                    "Cannot use the \"composes\" property with the {} file (it is not a CSS file)",
                                                    bun_fmt::quote(
                                                        &self.all_sources
                                                            [import_record.source_index.get() as usize]
                                                            .path
                                                            .pretty
                                                    ),
                                                ),
                                            );
                                            continue;
                                        };
                                        for name in compose.names.slice() {
                                            let Some(other_name_entry) =
                                                other_file.local_scope.get(&name.v)
                                            else {
                                                continue;
                                            };
                                            let other_name_ref = other_name_entry.ref_;
                                            if !other_name_ref.can_be_composed() {
                                                self.warn_non_single_class_composes(
                                                    other_file,
                                                    other_name_ref,
                                                    import_record.source_index.get(),
                                                    compose.loc,
                                                );
                                            } else {
                                                self.visit_name(
                                                    other_file,
                                                    other_name_ref,
                                                    import_record.source_index.get(),
                                                );
                                            }
                                        }
                                    }
                                } else if matches!(
                                    compose.from.as_ref().unwrap(),
                                    bun_css::Specifier::Global
                                ) {
                                    // E.g.: `composes: foo from global`
                                    //
                                    // In this example `foo` is global and won't be rewritten to a locally scoped
                                    // name, so we can just add it as a string.
                                    for name in compose.names.slice() {
                                        self.parts.push(E::TemplatePart {
                                            value: Expr::init(
                                                E::String::init(&name.v),
                                                self.loc,
                                            ),
                                            tail: E::TemplatePart::Tail::Cooked(
                                                E::String::init(b" "),
                                            ),
                                            tail_loc: self.loc,
                                        });
                                    }
                                }
                            } else {
                                // it is from the current file
                                for name in compose.names.slice() {
                                    let Some(name_entry) = ast.local_scope.get(&name.v) else {
                                        self.log.add_error_fmt(
                                            &self.all_sources[idx as usize],
                                            compose.loc,
                                            self.allocator,
                                            format_args!(
                                                "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                                bun_fmt::quote(&name.v),
                                                bun_fmt::quote(&self.all_sources[idx as usize].path.pretty),
                                            ),
                                        );
                                        continue;
                                    };
                                    let name_ref = name_entry.ref_;
                                    if !name_ref.can_be_composed() {
                                        self.warn_non_single_class_composes(
                                            ast,
                                            name_ref,
                                            idx,
                                            compose.loc,
                                        );
                                    } else {
                                        self.visit_name(ast, name_ref, idx);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // TODO(port): `parts: undefined` — Rust forbids uninit refs; rebound per-iteration below.
            // PORT NOTE: reshaped for borrowck — Visitor constructed inside the loop with fresh `parts` borrow.
            let all_symbols = this.graph.ast.items().symbols;

            for entry in values {
                let ref_ = entry.ref_;
                debug_assert!((ref_.inner_index as u32) < symbols.len());

                // PERF(port): was arena-backed ArrayList (no deinit; `.items` moved into E.Template).
                let mut template_parts: Vec<E::TemplatePart> = Vec::new();
                let mut value = Expr::init(
                    E::NameOfSymbol {
                        ref_: ref_.to_real_ref(source_index),
                        ..Default::default()
                    },
                    stmt.loc,
                );

                let mut visitor = Visitor {
                    inner_visited: &mut inner_visited,
                    composes_visited: &mut composes_visited,
                    source_index,
                    parts: &mut template_parts,
                    all_import_records,
                    all_css_asts,
                    loc: stmt.loc,
                    log: this.log,
                    all_sources,
                    allocator: this.allocator(),
                    all_symbols,
                };
                visitor.clear_all();
                visitor.inner_visited.set(ref_.inner_index() as usize);
                if ref_.tag.class {
                    visitor.visit_composes(css_ast, ref_, source_index);
                }

                if !template_parts.is_empty() {
                    template_parts.push(E::TemplatePart {
                        value,
                        tail_loc: stmt.loc,
                        tail: E::TemplatePart::Tail::Cooked(E::String::init(b"")),
                    });
                    value = Expr::init(
                        E::Template {
                            // TODO(port): `template_parts.items` — arena slice vs Vec ownership.
                            parts: template_parts.into(),
                            head: E::Template::Head::Cooked(E::String::init(b"")),
                        },
                        stmt.loc,
                    );
                }

                let key = &symbols.at(ref_.inner_index() as usize).original_name;
                exports.put(this.allocator(), key, value)?;
            }

            // TODO(port): `part.stmts[0].data.s_lazy_export.* = ...` — exact union assignment shape.
            if let js_ast::Stmt::Data::SLazyExport(slot) = &mut part.stmts[0].data {
                **slot = Expr::init(exports, stmt.loc).data;
            }
        }
    }

    let stmt: Stmt = part.stmts[0];
    if !matches!(stmt.data, js_ast::Stmt::Data::SLazyExport(_)) {
        panic!("Internal error: expected top-level lazy export statement");
    }

    let expr = Expr {
        // TODO(port): `stmt.data.s_lazy_export.*` deref — exact union payload shape.
        data: match &stmt.data {
            js_ast::Stmt::Data::SLazyExport(d) => **d,
            _ => unreachable!(),
        },
        loc: stmt.loc,
    };

    match exports_kind {
        js_ast::ExportsKind::Cjs => {
            part.stmts[0] = Stmt::assign(
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

            // If this is a .napi addon and it's not node, we need to generate a require() call to the runtime
            if matches!(expr.data, js_ast::Expr::Data::ECall(ref c)
                if matches!(c.target.data, js_ast::Expr::Data::ERequireCallTarget(_)))
                // if it's commonjs, use require()
                && this.options.output_format != bun_bundler::options::OutputFormat::Cjs
            {
                this.graph.generate_runtime_symbol_import_and_use(
                    source_index,
                    Index::part(1),
                    b"__require",
                    1,
                )?;
            }
        }
        _ => {
            // Otherwise, generate ES6 export statements. These are added as additional
            // parts so they can be tree shaken individually.
            part.stmts.len = 0;
            // TODO(port): `part.stmts.len = 0` — BabyList field write; use `.clear()`/`.set_len(0)`.

            if let js_ast::Expr::Data::EObject(e_object) = &expr.data {
                for property_ in e_object.properties.slice() {
                    let property: &G::Property = property_;
                    if property.key.is_none()
                        || !matches!(
                            property.key.as_ref().unwrap().data,
                            js_ast::Expr::Data::EString(_)
                        )
                        || property.value.is_none()
                        || property
                            .key
                            .as_ref()
                            .unwrap()
                            .data
                            .as_e_string()
                            .eql_comptime(b"default")
                        || property
                            .key
                            .as_ref()
                            .unwrap()
                            .data
                            .as_e_string()
                            .eql_comptime(b"__esModule")
                    {
                        continue;
                    }

                    let name = property
                        .key
                        .as_ref()
                        .unwrap()
                        .data
                        .as_e_string()
                        .slice(this.allocator());

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
                    // TODO(port): `parts.ptr[generated[1]]` raw-ptr indexing; re-borrow `parts` here for borrowck.
                    let parts = &mut this.graph.ast.items_mut().parts[source_index as usize];
                    // PERF(port): was `this.allocator().alloc(Stmt, 1)` (arena) — use bump.alloc_slice in Phase B.
                    parts[generated.1 as usize].stmts =
                        this.allocator().alloc_slice_fill_default(1).into();
                    parts[generated.1 as usize].stmts[0] = Stmt::alloc(
                        S::Local {
                            is_export: true,
                            decls: js_ast::G::Decl::List::from_slice(
                                this.allocator(),
                                &[G::Decl {
                                    binding: Binding::alloc(
                                        this.allocator(),
                                        B::Identifier { ref_: generated.0 },
                                        expr.loc,
                                    ),
                                    value: property.value,
                                }],
                            )?,
                            ..Default::default()
                        },
                        property.key.as_ref().unwrap().loc,
                    );
                }
            }

            {
                // PERF(port): was `std.fmt.allocPrint` into arena; building into Vec<u8> then arena-dupe.
                let mut name_buf: Vec<u8> = Vec::new();
                write!(
                    &mut name_buf,
                    "{}_default",
                    this.parse_graph.input_files.items().source[source_index as usize]
                        .fmt_identifier()
                )
                .expect("write to Vec<u8> cannot fail");
                let name = this.allocator().alloc_slice_copy(&name_buf);

                let generated = this.generate_named_export_in_file(
                    source_index,
                    module_ref,
                    name,
                    b"default",
                )?;
                let parts = &mut this.graph.ast.items_mut().parts[source_index as usize];
                parts[generated.1 as usize].stmts =
                    this.allocator().alloc_slice_fill_default(1).into();
                parts[generated.1 as usize].stmts[0] = Stmt::alloc(
                    S::ExportDefault {
                        default_name: js_ast::LocRef {
                            ref_: generated.0,
                            loc: stmt.loc,
                        },
                        value: js_ast::StmtOrExpr::Expr(expr),
                    },
                    stmt.loc,
                );
            }
        }
    }

    Ok(())
}

pub use bun_bundler::DeferredBatchTask;
pub use bun_bundler::ParseTask;
pub use bun_bundler::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCodeForLazyExport.zig (421 lines)
//   confidence: medium
//   todos:      9
//   notes:      Heavy borrowck reshaping (Visitor moved into loop; `parts` re-borrowed); Stmt/Expr.Data union variant names guessed; arena allocator threading deferred to Phase B.
// ──────────────────────────────────────────────────────────────────────────
