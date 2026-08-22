use crate::mal_prelude::*;
use bun_collections::VecExt as _VecExt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_alloc::Arena;
use bun_ast::Ref;
use bun_ast::{B, Binding, E, Expr, ExprData, G, Part, S, Stmt, StmtData};
use bun_ast::{Loc, Log, Source};
use bun_collections::ArrayHashMap;
use bun_core::fmt as bun_fmt;
use bun_js_parser::js_lexer;

use crate::bun_css::properties::css_modules::Specifier as CssSpecifier;
use crate::bun_css::{BundlerStyleSheet, CssRef, CssRefTag};
use crate::{Index, IndexInt, LinkerContext};
use bun_collections::DynamicBitSetUnmanaged as BitSet;

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
            let all_import_records = this.graph.ast.items_import_records();

            let values = css_ast.local_scope.values();
            if values.len() == 0 {
                break 'out;
            }
            let size: u32 = 'size: {
                let mut size: u32 = 0;
                for entry in values {
                    size = size.max(entry.ref_.inner_index());
                }
                break 'size size + 1;
            };

            let mut inner_visited = BitSet::init_empty(size as usize)?;
            // `defer inner_visited.deinit(...)` — handled by Drop.
            let mut composes_visited: ArrayHashMap<Ref, ()> = ArrayHashMap::new();
            // `defer composes_visited.deinit()` — handled by Drop.
            let mut stack: Vec<Frame> = Vec::new();

            /// A class whose `composes` declarations are being walked, and
            /// how far along them the walk is.
            #[derive(Clone, Copy)]
            struct Frame {
                idx: IndexInt,
                css_ref: CssRef,
                compose_index: usize,
                name_index: usize,
                /// Append the class's own name once its `composes` are done.
                /// False for the root class, whose name the caller appends.
                append_name: bool,
            }

            impl Frame {
                fn next_name(&mut self) {
                    self.name_index += 1;
                }

                fn next_compose(&mut self) {
                    self.compose_index += 1;
                    self.name_index = 0;
                }
            }

            struct Visitor<'a> {
                inner_visited: &'a mut BitSet,
                composes_visited: &'a mut ArrayHashMap<Ref, ()>,
                stack: &'a mut Vec<Frame>,
                parts: &'a mut Vec<E::TemplatePart>,
                all_import_records: &'a [bun_ast::import_record::List<'a>],
                // `BundledAst.css` SoA column.
                all_css_asts: &'a [crate::bundled_ast::CssCol],
                all_sources: &'a [Source],
                all_symbols: &'a [SymbolList<'a>],
                source_index: IndexInt,
                log: &'a mut Log,
                loc: Loc,
                arena: &'a Arena,
            }

            impl<'a> Visitor<'a> {
                fn clear_all(&mut self) {
                    self.inner_visited.set_all(false);
                    self.composes_visited.clear_retaining_capacity();
                }

                /// Starts walking a composed class's own `composes` unless it has
                /// been reached already. Its name is appended when that walk
                /// completes, after the names it composes.
                ///
                /// The class is marked as reached on the way in. The recursive
                /// form marked it on the way out, which appended the same names
                /// in the same order whenever it terminated, but recursed forever
                /// on a `composes` cycle that did not pass through the root class.
                fn visit_name(&mut self, ref_: CssRef, idx: IndexInt) {
                    debug_assert!(ref_.can_be_composed());
                    let real_ref = ref_.to_real_ref(idx);
                    if idx == self.source_index {
                        if self.inner_visited.is_set(ref_.inner_index() as usize) {
                            return;
                        }
                        self.inner_visited.set(ref_.inner_index() as usize);
                    } else {
                        if self.composes_visited.contains_key(&real_ref) {
                            return;
                        }
                        self.composes_visited.insert(real_ref, ());
                    }

                    self.stack.push(Frame {
                        idx,
                        css_ref: ref_,
                        compose_index: 0,
                        name_index: 0,
                        append_name: true,
                    });
                }

                fn append_name(&mut self, real_ref: Ref) {
                    self.parts.push(E::TemplatePart {
                        value: Expr::init(
                            E::NameOfSymbol {
                                ref_: real_ref,
                                ..Default::default()
                            },
                            self.loc,
                        ),
                        tail: E::TemplateContents::Cooked(E::String::init(b" ")),
                        tail_loc: self.loc,
                    });
                }

                fn warn_non_single_class_composes(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    css_ref: CssRef,
                    idx: IndexInt,
                    compose_loc: Loc,
                ) {
                    let _ = self.arena;
                    let syms: &SymbolList<'_> = &self.all_symbols[idx as usize];
                    // `Symbol.original_name: StoreStr` — arena-owned for the link pass.
                    let name: &[u8] = syms[css_ref.inner_index() as usize].original_name.slice();
                    let loc = ast.local_scope.get(name).unwrap().loc;

                    self.log.add_range_error_fmt_with_note(
                        Some(&self.all_sources[idx as usize]),
                        bun_ast::Range { loc: compose_loc, ..Default::default() },
                        format_args!(
                            "The composes property cannot be used with {}, because it is not a single class name.",
                            bun_fmt::quote(name),
                        ),
                        format_args!(
                            "The definition of {} is here.",
                            bun_fmt::quote(name),
                        ),
                        bun_ast::Range { loc, ..Default::default() },
                    );
                }

                /// Appends the name of every class that `css_ref` (a class in
                /// the file `idx`, already marked as reached) transitively
                /// composes, each after the names it composes itself.
                ///
                /// Explicit-stack DFS (was recursive, one `visit_composes` and
                /// `visit_name` call per composed class). Each iteration handles
                /// one name of one `composes` declaration of the class on top of
                /// the stack, so the names, the `from global` strings and the
                /// diagnostics come out in the order the recursion produced them.
                fn visit_composes(&mut self, css_ref: CssRef, idx: IndexInt) {
                    debug_assert!(self.stack.is_empty());
                    self.stack.push(Frame {
                        idx,
                        css_ref,
                        compose_index: 0,
                        name_index: 0,
                        append_name: false,
                    });

                    let all_css_asts = self.all_css_asts;
                    while let Some(frame) = self.stack.last_mut() {
                        let idx = frame.idx;
                        let css_ref = frame.css_ref;
                        // Every class on the stack was found in a file's CSS AST.
                        let ast: &BundlerStyleSheet = all_css_asts[idx as usize]
                            .as_deref()
                            .expect("composed class comes from a CSS file");
                        let composes = ast.composes.get(&css_ref.to_real_ref(idx));
                        let Some(compose) = composes.and_then(|composes| {
                            composes.composes.slice().get(frame.compose_index)
                        }) else {
                            let frame = self.stack.pop().expect("stack is non-empty");
                            if frame.append_name {
                                self.append_name(css_ref.to_real_ref(idx));
                            }
                            continue;
                        };
                        // while parsing we check that we only allow `composes` on single class selectors
                        debug_assert!(css_ref.tag().contains(CssRefTag::CLASS));

                        match &compose.from {
                            // it is imported
                            Some(CssSpecifier::ImportRecordIndex(import_record_idx)) => {
                                let import_record = &self.all_import_records[idx as usize]
                                    [*import_record_idx as usize];
                                if !import_record.source_index.is_valid() {
                                    frame.next_compose();
                                    continue;
                                }
                                let other_idx = import_record.source_index.get();
                                let Some(other_file) = all_css_asts[other_idx as usize].as_deref()
                                else {
                                    frame.next_compose();
                                    self.log.add_error_fmt(
                                        &self.all_sources[idx as usize],
                                        compose.loc,
                                        format_args!(
                                            "Cannot use the \"composes\" property with the {} file (it is not a CSS file)",
                                            bun_fmt::quote(
                                                self.all_sources[other_idx as usize].path.pretty
                                            ),
                                        ),
                                    );
                                    continue;
                                };
                                let Some(name) = compose.names.slice().get(frame.name_index) else {
                                    frame.next_compose();
                                    continue;
                                };
                                frame.next_name();
                                let Some(other_name_entry) = other_file.local_scope.get(name.v())
                                else {
                                    continue;
                                };
                                let other_name_ref = other_name_entry.ref_;
                                if !other_name_ref.can_be_composed() {
                                    self.warn_non_single_class_composes(
                                        other_file,
                                        other_name_ref,
                                        other_idx,
                                        compose.loc,
                                    );
                                } else {
                                    self.visit_name(other_name_ref, other_idx);
                                }
                            }
                            Some(CssSpecifier::Global) => {
                                // E.g.: `composes: foo from global`
                                //
                                // In this example `foo` is global and won't be rewritten to a locally scoped
                                // name, so we can just add it as a string.
                                frame.next_compose();
                                for name in compose.names.slice() {
                                    let name_v = name.v();
                                    self.parts.push(E::TemplatePart {
                                        value: Expr::init(E::String::init(name_v), self.loc),
                                        tail: E::TemplateContents::Cooked(E::String::init(b" ")),
                                        tail_loc: self.loc,
                                    });
                                }
                            }
                            None => {
                                // it is from the current file
                                let Some(name) = compose.names.slice().get(frame.name_index) else {
                                    frame.next_compose();
                                    continue;
                                };
                                frame.next_name();
                                let name_v = name.v();
                                let Some(name_entry) = ast.local_scope.get(name_v) else {
                                    self.log.add_error_fmt(
                                        &self.all_sources[idx as usize],
                                        compose.loc,
                                        format_args!(
                                            "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                            bun_fmt::quote(name_v),
                                            bun_fmt::quote(self.all_sources[idx as usize].path.pretty),
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
                                    self.visit_name(name_ref, idx);
                                }
                            }
                        }
                    }
                }
            }

            // The Visitor is constructed inside the loop with a fresh `parts`
            // borrow each time (reshaped for borrowck).
            let all_symbols = this.graph.ast.items_symbols();
            // SAFETY: `LinkerContext::arena()` returns a stable `&Arena` valid for the
            // link pass; detach via raw-pointer round-trip so it doesn't hold a `&self`
            // borrow across the `this.log` reborrow inside the Visitor below.
            let arena: &Arena = unsafe { bun_ptr::detach_lifetime_ref::<Arena>(this.arena()) };

            for entry in values {
                let ref_ = entry.ref_;
                debug_assert!(ref_.inner_index() < symbols.len() as u32);

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
                    stack: &mut stack,
                    source_index,
                    parts: &mut template_parts,
                    all_import_records,
                    all_css_asts,
                    loc: stmt.loc,
                    // Split-borrow — see `LinkerContext::log_disjoint`.
                    log: this.log_disjoint(),
                    all_sources,
                    arena,
                    all_symbols,
                };
                visitor.clear_all();
                visitor.inner_visited.set(ref_.inner_index() as usize);
                if ref_.tag().contains(CssRefTag::CLASS) {
                    visitor.visit_composes(ref_, source_index);
                }

                if !template_parts.is_empty() {
                    template_parts.push(E::TemplatePart {
                        value,
                        tail_loc: stmt.loc,
                        tail: E::TemplateContents::Cooked(E::String::init(b"")),
                    });
                    // Move the parts into the linker arena
                    // (freed when the linker arena drops).
                    let parts_slice =
                        bun_ast::StoreSlice::new_mut(arena.alloc_slice_fill_iter(template_parts));
                    value = Expr::init(
                        E::Template {
                            tag: None,
                            parts: parts_slice,
                            head: E::TemplateContents::Cooked(E::String::init(b"")),
                        },
                        stmt.loc,
                    );
                }

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

            // If this is a .napi addon and it's not node, we need to generate a require() call to the runtime
            if matches!(expr.data, ExprData::ECall(ref c)
                if matches!(c.target.data, ExprData::ERequireCallTarget))
                // if it's commonjs, use require()
                && this.options.output_format != crate::options::OutputFormat::Cjs
            {
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
                    // `Expr`/`ExprData`/`StoreRef<_>` are `Copy`. Copy `key` out so
                    // `key_str: StoreRef<E::EString>` is a mutable local — `slice()` resolves
                    // the rope in-place via `DerefMut` into the arena slot.
                    let Some(key) = property.key else { continue };
                    let ExprData::EString(mut key_str) = key.data else {
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
                    let name = key_str.slice(alloc);

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
            }
        }
    }

    Ok(())
}
