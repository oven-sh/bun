use crate::mal_prelude::*;
#[allow(unused_imports)]
use bun_collections::VecExt as _VecExt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_alloc::Arena;
use bun_ast::ImportRecord;
use bun_ast::Ref;
use bun_ast::Symbol;
use bun_ast::{self as js_ast, B, Binding, E, Expr, ExprData, G, Part, S, Stmt, StmtData};
use bun_ast::{Loc, Log, Source};
use bun_collections::{ArrayHashMap, VecExt};
use bun_core::fmt as bun_fmt;
use bun_js_parser::js_lexer;

use crate::bun_css::properties::css_modules::Specifier as CssSpecifier;
use crate::bun_css::{BundlerStyleSheet, CssRef, CssRefTag};
use crate::{Index, IndexInt, LinkerContext};
use bun_collections::DynamicBitSetUnmanaged as BitSet;

type SymbolList = Vec<Symbol>;

/// `ArrayHashAdapter` so `LocalScope` (`ArrayHashMap<Box<[u8]>, LocalEntry>`)
/// can be queried by borrowed `&[u8]` (CSS idents are arena `*const [u8]`).
struct SliceBoxAdapter;
impl bun_collections::array_hash_map::ArrayHashAdapter<[u8], Box<[u8]>> for SliceBoxAdapter {
    fn hash(&self, key: &[u8]) -> u32 {
        // Match `LocalScope`'s default `AutoContext` hashing for `Box<[u8]>`.
        use bun_collections::array_hash_map::{ArrayHashContext, AutoContext};
        AutoContext::default().hash(key)
    }
    fn eql(&self, a: &[u8], b: &Box<[u8]>, _i: usize) -> bool {
        a == &**b
    }
}

pub fn generate_code_for_lazy_export(
    this: &mut LinkerContext,
    source_index: IndexInt,
) -> Result<(), AllocError> {
    let exports_kind = this.graph.ast.items_exports_kind()[source_index as usize];
    // PORT NOTE: reshaped for borrowck — take `parts` as a raw pointer *before* the
    // long-lived immutable `items_css()` borrow below; re-borrowed again later as needed.
    let parts: *mut [Part] = this.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
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

            let symbols: &SymbolList = &this.graph.ast.items_symbols()[source_index as usize];
            let all_import_records: &[Vec<ImportRecord>] = this.graph.ast.items_import_records();

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

            struct Visitor<'a> {
                inner_visited: &'a mut BitSet,
                // Zig: `std.AutoArrayHashMap(Ref, void)` → `ArrayHashMap` per collections map.
                composes_visited: &'a mut ArrayHashMap<Ref, ()>,
                parts: &'a mut Vec<E::TemplatePart>,
                all_import_records: &'a [Vec<ImportRecord>],
                // `BundledAst.css` SoA column.
                all_css_asts: &'a [crate::bundled_ast::CssCol],
                all_sources: &'a [Source],
                all_symbols: &'a [SymbolList],
                source_index: IndexInt,
                log: &'a mut Log,
                loc: Loc,
                // PERF(port): was `std.mem.Allocator` (arena) — bundler is an AST crate; thread `&'bump Bump`.
                arena: &'a Arena,
            }

            impl<'a> Visitor<'a> {
                fn clear_all(&mut self) {
                    self.inner_visited.set_all(false);
                    self.composes_visited.clear_retaining_capacity();
                }

                fn visit_name(&mut self, ast: &BundlerStyleSheet, ref_: CssRef, idx: IndexInt) {
                    debug_assert!(ref_.can_be_composed());
                    let real_ref = ref_.to_real_ref(idx);
                    let from_this_file = ref_.source_index(idx) == self.source_index;
                    if (from_this_file && self.inner_visited.is_set(ref_.inner_index() as usize))
                        || (!from_this_file && self.composes_visited.contains_key(&real_ref))
                    {
                        return;
                    }

                    self.visit_composes(ast, ref_, idx);
                    // PERF(port): was assume-OOM `catch |err| bun.handleOom(err)`; Vec::push aborts on OOM.
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

                    if from_this_file {
                        self.inner_visited.set(ref_.inner_index() as usize);
                    } else {
                        self.composes_visited.insert(real_ref, ());
                    }
                }

                fn warn_non_single_class_composes(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    css_ref: CssRef,
                    idx: IndexInt,
                    compose_loc: Loc,
                ) {
                    let _ = self.arena;
                    let syms: &SymbolList = &self.all_symbols[css_ref.source_index(idx) as usize];
                    // `Symbol.original_name: StoreStr` — arena-owned for the link pass.
                    let name: &[u8] = syms
                        .at(css_ref.inner_index() as usize)
                        .original_name
                        .slice();
                    let loc = ast
                        .local_scope
                        .get_adapted(name, SliceBoxAdapter)
                        .unwrap()
                        .loc;

                    // PORT NOTE: was `catch |err| bun.handleOom(err)` — crash on OOM.
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

                fn visit_composes(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    css_ref: CssRef,
                    idx: IndexInt,
                ) {
                    let ref_ = css_ref.to_real_ref(idx);
                    if ast.composes.count() > 0 {
                        let Some(composes) = ast.composes.get(&ref_) else {
                            return;
                        };
                        // while parsing we check that we only allow `composes` on single class selectors
                        debug_assert!(css_ref.tag().contains(CssRefTag::CLASS));

                        for compose in composes.composes.slice() {
                            match &compose.from {
                                // it is imported
                                Some(CssSpecifier::ImportRecordIndex(import_record_idx)) => {
                                    let import_records: &Vec<ImportRecord> =
                                        &self.all_import_records[idx as usize];
                                    let import_record =
                                        import_records.at(*import_record_idx as usize);
                                    if import_record.source_index.is_valid() {
                                        let Some(other_file) = self.all_css_asts
                                            [import_record.source_index.get() as usize]
                                            .as_deref()
                                        else {
                                            self.log.add_error_fmt(
                                                &self.all_sources[idx as usize],
                                                compose.loc,
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
                                            let name_v = name.v();
                                            let Some(other_name_entry) = other_file
                                                .local_scope
                                                .get_adapted(name_v, SliceBoxAdapter)
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
                                }
                                Some(CssSpecifier::Global) => {
                                    // E.g.: `composes: foo from global`
                                    //
                                    // In this example `foo` is global and won't be rewritten to a locally scoped
                                    // name, so we can just add it as a string.
                                    for name in compose.names.slice() {
                                        let name_v = name.v();
                                        self.parts.push(E::TemplatePart {
                                            value: Expr::init(E::String::init(name_v), self.loc),
                                            tail: E::TemplateContents::Cooked(E::String::init(
                                                b" ",
                                            )),
                                            tail_loc: self.loc,
                                        });
                                    }
                                }
                                None => {
                                    // it is from the current file
                                    for name in compose.names.slice() {
                                        let name_v = name.v();
                                        let Some(name_entry) =
                                            ast.local_scope.get_adapted(name_v, SliceBoxAdapter)
                                        else {
                                            self.log.add_error_fmt(
                                                &self.all_sources[idx as usize],
                                                compose.loc,
                                                format_args!(
                                                    "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                                    bun_fmt::quote(name_v),
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
            }

            // PORT NOTE: Zig left `parts: undefined` and rebound per-iteration; Rust
            // forbids uninit refs, so the Visitor is constructed inside the loop with
            // a fresh `parts` borrow each time (reshaped for borrowck).
            let all_symbols = this.graph.ast.items_symbols();
            // SAFETY: `LinkerContext::arena()` returns a stable `&Arena` valid for the
            // link pass; detach via raw-pointer round-trip so it doesn't hold a `&self`
            // borrow across the `this.log` reborrow inside the Visitor below.
            let arena: &Arena = unsafe { bun_ptr::detach_lifetime_ref::<Arena>(this.arena()) };

            for entry in values {
                let ref_ = entry.ref_;
                debug_assert!(ref_.inner_index() < symbols.len() as u32);

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
                    // Split-borrow — see `LinkerContext::log_disjoint`.
                    log: this.log_disjoint(),
                    all_sources,
                    arena,
                    all_symbols,
                };
                visitor.clear_all();
                visitor.inner_visited.set(ref_.inner_index() as usize);
                if ref_.tag().contains(CssRefTag::CLASS) {
                    visitor.visit_composes(css_ast, ref_, source_index);
                }

                if !template_parts.is_empty() {
                    template_parts.push(E::TemplatePart {
                        value,
                        tail_loc: stmt.loc,
                        tail: E::TemplateContents::Cooked(E::String::init(b"")),
                    });
                    // PORT NOTE: Zig used an arena-backed ArrayList and moved `.items`
                    // into `E.Template`; mirror that by moving into the linker arena
                    // (freed when the linker arena drops).
                    let parts_slice = bun_ast::StoreSlice::new_mut(
                        arena.alloc_slice_fill_iter(template_parts.into_iter()),
                    );
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
                let key: &[u8] = symbols
                    .at(ref_.inner_index() as usize)
                    .original_name
                    .slice();
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
            // PORT NOTE: Zig `part.stmts.len = 0` truncates the slice.
            part.stmts = bun_ast::StoreSlice::EMPTY;

            if let ExprData::EObject(e_object) = &expr.data {
                for property in e_object.properties.slice() {
                    let _: &G::Property = property;
                    // PORT NOTE: `Expr`/`ExprData`/`StoreRef<_>` are `Copy`. Copy `key` out so
                    // `key_str: StoreRef<E::EString>` is a mutable local — `slice()` resolves
                    // the rope in-place via `DerefMut` into the arena slot (matches Zig's
                    // `property.key.?.data.e_string.slice(...)` which takes `*String`).
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
                    // PERF(port): was `this.arena().alloc(Stmt, 1)` (arena).
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
                    // PORT NOTE: `parts.ptr[generated[1]]` — re-borrow `parts` here for borrowck.
                    let parts = this.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
                    parts[generated.1 as usize].stmts = bun_ast::StoreSlice::new_mut(new_stmts);
                }
            }

            {
                // PERF(port): was `std.fmt.allocPrint` into arena; building into Vec<u8> then arena-dupe.
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
                                ref_: Some(generated.0),
                                loc: stmt.loc,
                            },
                            value: bun_ast::StmtOrExpr::Expr(expr),
                        },
                        stmt.loc,
                    )));
                let parts = this.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
                parts[generated.1 as usize].stmts = bun_ast::StoreSlice::new_mut(new_stmts);
            }
        }
    }

    Ok(())
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/linker_context/generateCodeForLazyExport.zig
