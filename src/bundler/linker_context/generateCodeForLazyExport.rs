use std::io::Write as _;
use bun_js_parser::ast::bundled_ast::BundledAstListExt as _;
#[allow(unused_imports)]
use crate::ungate_support::js_meta::JSMetaListExt as _;
use crate::Graph::InputFileListExt as _;
#[allow(unused_imports)]
use crate::linker_graph::FileListExt as _;
#[allow(unused_imports)]
use crate::ungate_support::EntryPointListExt as _;

use bun_alloc::AllocError;
#[cfg(feature = "css")]
use bun_alloc::Arena;
#[cfg(feature = "css")]
use bun_collections::{ArrayHashMap, BabyList, DynamicBitSetUnmanaged};
#[cfg(feature = "css")]
use bun_core::fmt as bun_fmt;
use bun_js_parser::ast::{self as js_ast, B, Binding, E, Expr, ExprData, G, Part, S, Stmt, StmtData};
#[cfg(feature = "css")]
use bun_js_parser::ast::Symbol;
use bun_js_parser::js_lexer;
#[cfg(feature = "css")]
use bun_js_parser::Ref;
#[cfg(feature = "css")]
use bun_logger::{Loc, Log, Source};
#[cfg(feature = "css")]
use bun_options_types::ImportRecord;

#[cfg(feature = "css")]
use crate::bun_css::{BundlerStyleSheet, CssRef, CssRefTag};
#[cfg(feature = "css")]
use crate::bun_css::properties::css_modules::Specifier as CssSpecifier;
use crate::{Index, IndexInt, LinkerContext};

#[cfg(feature = "css")]
type BitSet = DynamicBitSetUnmanaged;
#[cfg(feature = "css")]
type SymbolList = BabyList<Symbol>;

/// `CssRef::to_real_ref` returns `bun_logger::Ref`; the bundler AST wants
/// `bun_js_parser::Ref`. Both are `#[repr(transparent)] u64` with the same
/// bit-packing (see base.rs / logger/lib.rs), so reinterpret.
#[cfg(feature = "css")]
#[inline]
fn to_js_ref(r: bun_logger::Ref) -> Ref {
    // SAFETY: both Ref types are `#[repr(transparent)]` wrappers over `u64`
    // with identical `{inner_index: u31, tag: u2, source_index: u31}` layout.
    unsafe { core::mem::transmute::<bun_logger::Ref, Ref>(r) }
}

/// `ArrayHashAdapter` so `LocalScope` (`ArrayHashMap<Box<[u8]>, LocalEntry>`)
/// can be queried by borrowed `&[u8]` (CSS idents are arena `*const [u8]`).
#[cfg(feature = "css")]
struct SliceBoxAdapter;
#[cfg(feature = "css")]
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
    #[cfg(feature = "css")]
    let all_sources = unsafe { &(*this.parse_graph).input_files }.items_source();
    #[cfg(feature = "css")]
    let all_css_asts: &[Option<*mut core::ffi::c_void>] = this.graph.ast.items_css();
    #[cfg(feature = "css")]
    // SAFETY: `css` SoA column is type-erased `*mut BundlerStyleSheet` (BundledAst.rs).
    let maybe_css_ast: Option<&BundlerStyleSheet> =
        all_css_asts[source_index as usize].map(|p| unsafe { &*(p as *const BundlerStyleSheet) });

    // SAFETY: `parts` is a stable SoA column slice valid for the link pass.
    if unsafe { (&*parts).len() } < 1 {
        panic!("Internal error: expected at least one part for lazy export");
    }

    // SAFETY: `parts.ptr[1]` — BabyList raw indexing; using index 1 here.
    let part: &mut Part = unsafe { &mut (*parts)[1] };

    // SAFETY: `stmts: *mut [Stmt]` is an arena slice valid for the link pass.
    if unsafe { (&*part.stmts).is_empty() } {
        panic!("Internal error: expected at least one statement in the lazy export");
    }

    let module_ref = this.graph.ast.items_module_ref()[source_index as usize];

    // Handle css modules
    //
    // --- original comment from esbuild ---
    // If this JavaScript file is a stub from a CSS file, populate the exports of
    // this JavaScript stub with the local names from that CSS file. This is done
    // now instead of earlier because we need the whole bundle to be present.
    //
    // PORT NOTE: gated on `feature = "css"` — the no-css shim's
    // `BundlerStyleSheet` lacks `composes`/`CssRef`/`LocalEntry`, and with CSS
    // disabled `items_css()` is always `None` so this branch is unreachable.
    #[cfg(feature = "css")]
    if let Some(css_ast) = maybe_css_ast {
        // SAFETY: `part.stmts` is a non-empty arena slice (checked above).
        let stmt: Stmt = unsafe { (*part.stmts)[0] };
        if !matches!(stmt.data, StmtData::SLazyExport(_)) {
            panic!("Internal error: expected top-level lazy export statement");
        }
        'out: {
            if css_ast.local_scope.count() == 0 {
                break 'out;
            }
            let mut exports = E::Object::default();

            let symbols: &SymbolList = &this.graph.ast.items_symbols()[source_index as usize];
            let all_import_records: &[BabyList<ImportRecord>] =
                this.graph.ast.items_import_records();

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
                all_import_records: &'a [BabyList<ImportRecord>],
                // Type-erased `*mut BundlerStyleSheet` SoA column (BundledAst.rs).
                all_css_asts: &'a [Option<*mut core::ffi::c_void>],
                all_sources: &'a [Source],
                all_symbols: &'a [SymbolList],
                source_index: IndexInt,
                log: &'a mut Log,
                loc: Loc,
                // PERF(port): was `std.mem.Allocator` (arena) — bundler is an AST crate; thread `&'bump Bump`.
                allocator: &'a Arena,
            }

            impl<'a> Visitor<'a> {
                fn clear_all(&mut self) {
                    self.inner_visited.set_all(false);
                    self.composes_visited.clear_retaining_capacity();
                }

                fn visit_name(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    ref_: CssRef,
                    idx: IndexInt,
                ) {
                    debug_assert!(ref_.can_be_composed());
                    let from_this_file = ref_.source_index(idx) == self.source_index;
                    if (from_this_file && self.inner_visited.is_set(ref_.inner_index() as usize))
                        || (!from_this_file
                            && self.composes_visited.contains_key(&to_js_ref(ref_.to_real_ref(idx))))
                    {
                        return;
                    }

                    self.visit_composes(ast, ref_, idx);
                    // PERF(port): was assume-OOM `catch |err| bun.handleOom(err)`; Vec::push aborts on OOM.
                    self.parts.push(E::TemplatePart {
                        value: Expr::init(
                            E::NameOfSymbol {
                                ref_: to_js_ref(ref_.to_real_ref(idx)),
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
                        self.composes_visited.insert(to_js_ref(ref_.to_real_ref(idx)), ());
                    }
                }

                fn warn_non_single_class_composes(
                    &mut self,
                    ast: &BundlerStyleSheet,
                    css_ref: CssRef,
                    idx: IndexInt,
                    compose_loc: Loc,
                ) {
                    let ref_ = css_ref.to_real_ref(idx);
                    let _ = ref_;
                    let _ = self.allocator;
                    let syms: &SymbolList = &self.all_symbols[css_ref.source_index(idx) as usize];
                    // SAFETY: `Symbol.original_name: *const [u8]` is arena-owned for the link pass.
                    let name: &[u8] =
                        unsafe { &*syms.at(css_ref.inner_index() as usize).original_name };
                    let loc = ast.local_scope.get_adapted(name, SliceBoxAdapter).unwrap().loc;

                    // PORT NOTE: was `catch |err| bun.handleOom(err)` — crash on OOM.
                    bun_core::handle_oom(self.log.add_range_error_fmt_with_note(
                        Some(&self.all_sources[idx as usize]),
                        bun_logger::Range { loc: compose_loc, ..Default::default() },
                        format_args!(
                            "The composes property cannot be used with {}, because it is not a single class name.",
                            bun_fmt::quote(name),
                        ),
                        format_args!(
                            "The definition of {} is here.",
                            bun_fmt::quote(name),
                        ),
                        bun_logger::Range { loc, ..Default::default() },
                    ));
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
                            // it is imported
                            if compose.from.is_some() {
                                if matches!(
                                    compose.from.as_ref().unwrap(),
                                    CssSpecifier::ImportRecordIndex(_)
                                ) {
                                    let import_record_idx = match compose.from.as_ref().unwrap() {
                                        CssSpecifier::ImportRecordIndex(i) => *i,
                                        _ => unreachable!(),
                                    };
                                    let import_records: &BabyList<ImportRecord> =
                                        &self.all_import_records[idx as usize];
                                    let import_record = import_records.at(import_record_idx as usize);
                                    if import_record.source_index.is_valid() {
                                        // SAFETY: type-erased `*mut BundlerStyleSheet` (BundledAst.rs SoA column).
                                        let Some(other_file) =
                                            self.all_css_asts[import_record.source_index.get() as usize]
                                                .map(|p| unsafe { &*(p as *const BundlerStyleSheet) })
                                        else {
                                            bun_core::handle_oom(self.log.add_error_fmt(
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
                                            ));
                                            continue;
                                        };
                                        for name in compose.names.slice() {
                                            // SAFETY: `CustomIdent.v: *const [u8]` borrows the source arena.
                                            let name_v = unsafe { &*name.v };
                                            let Some(other_name_entry) =
                                                other_file.local_scope.get_adapted(name_v, SliceBoxAdapter)
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
                                    CssSpecifier::Global
                                ) {
                                    // E.g.: `composes: foo from global`
                                    //
                                    // In this example `foo` is global and won't be rewritten to a locally scoped
                                    // name, so we can just add it as a string.
                                    for name in compose.names.slice() {
                                        // SAFETY: `CustomIdent.v: *const [u8]` borrows the source arena.
                                        let name_v = unsafe { &*name.v };
                                        self.parts.push(E::TemplatePart {
                                            value: Expr::init(
                                                E::String::init(name_v),
                                                self.loc,
                                            ),
                                            tail: E::TemplateContents::Cooked(
                                                E::String::init(b" "),
                                            ),
                                            tail_loc: self.loc,
                                        });
                                    }
                                }
                            } else {
                                // it is from the current file
                                for name in compose.names.slice() {
                                    // SAFETY: `CustomIdent.v: *const [u8]` borrows the source arena.
                                    let name_v = unsafe { &*name.v };
                                    let Some(name_entry) = ast.local_scope.get_adapted(name_v, SliceBoxAdapter) else {
                                        bun_core::handle_oom(self.log.add_error_fmt(
                                            &self.all_sources[idx as usize],
                                            compose.loc,
                                            format_args!(
                                                "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                                bun_fmt::quote(name_v),
                                                bun_fmt::quote(&self.all_sources[idx as usize].path.pretty),
                                            ),
                                        ));
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

            // PORT NOTE: Zig left `parts: undefined` and rebound per-iteration; Rust
            // forbids uninit refs, so the Visitor is constructed inside the loop with
            // a fresh `parts` borrow each time (reshaped for borrowck).
            let all_symbols = this.graph.ast.items_symbols();
            // SAFETY: `LinkerContext::allocator()` returns a stable `&Arena` valid for the
            // link pass; detach via raw-pointer round-trip so it doesn't hold a `&self`
            // borrow across the `this.log` reborrow inside the Visitor below.
            let allocator: &Arena = unsafe { &*(this.allocator() as *const Arena) };

            for entry in values {
                let ref_ = entry.ref_;
                debug_assert!(ref_.inner_index() < symbols.len);

                // PERF(port): was arena-backed ArrayList (no deinit; `.items` moved into E.Template).
                let mut template_parts: Vec<E::TemplatePart> = Vec::new();
                let mut value = Expr::init(
                    E::NameOfSymbol {
                        ref_: to_js_ref(ref_.to_real_ref(source_index)),
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
                    allocator,
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
                    let parts_slice: *mut [E::TemplatePart] =
                        allocator.alloc_slice_fill_iter(template_parts.into_iter());
                    value = Expr::init(
                        E::Template {
                            tag: None,
                            parts: parts_slice,
                            head: E::TemplateContents::Cooked(E::String::init(b"")),
                        },
                        stmt.loc,
                    );
                }

                // SAFETY: `Symbol.original_name: *const [u8]` is arena-owned for the link pass.
                let key: &[u8] =
                    unsafe { &*symbols.at(ref_.inner_index() as usize).original_name };
                exports.put(allocator, key, value)?;
            }

            // SAFETY: `part.stmts` non-empty (checked above).
            if let StmtData::SLazyExport(mut slot) = unsafe { (*part.stmts)[0] }.data {
                // `StoreRef<ExprData>` is a Copy `NonNull` — write through the pointer.
                *slot = Expr::init(exports, stmt.loc).data;
            }
        }
    }

    // SAFETY: `part.stmts` is a non-empty arena slice (checked above).
    let stmt: Stmt = unsafe { (*part.stmts)[0] };
    if !matches!(stmt.data, StmtData::SLazyExport(_)) {
        panic!("Internal error: expected top-level lazy export statement");
    }

    let expr = Expr {
        data: match stmt.data {
            StmtData::SLazyExport(d) => *d,
            _ => unreachable!(),
        },
        loc: stmt.loc,
    };

    match exports_kind {
        js_ast::ExportsKind::Cjs => {
            // SAFETY: `part.stmts` non-empty arena slice.
            // PORT NOTE: parenthesized — `unsafe { … }` at stmt-head parses as a block stmt, not an expr.
            (unsafe { &mut *part.stmts })[0] = Stmt::assign(
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
            part.stmts = &mut [];

            if let ExprData::EObject(e_object) = &expr.data {
                for property_ in e_object.properties.slice() {
                    let property: &G::Property = property_;
                    if property.key.is_none()
                        || !matches!(
                            property.key.as_ref().unwrap().data,
                            ExprData::EString(_)
                        )
                        || property.value.is_none()
                        || property
                            .key
                            .as_ref()
                            .unwrap()
                            .data
                            .as_e_string()
                            .unwrap()
                            .eql_comptime(b"default")
                        || property
                            .key
                            .as_ref()
                            .unwrap()
                            .data
                            .as_e_string()
                            .unwrap()
                            .eql_comptime(b"__esModule")
                    {
                        continue;
                    }

                    // SAFETY: `LinkerContext::allocator()` returns a stable `&Arena` valid for the
                    // link pass; detach via raw-pointer round-trip so `name` doesn't borrow `this`
                    // across the `&mut self` call to `generate_named_export_in_file` below.
                    let alloc: &bun_alloc::Arena =
                        unsafe { &*(this.allocator() as *const bun_alloc::Arena) };
                    let name = property
                        .key
                        .as_ref()
                        .unwrap()
                        .data
                        .as_e_string()
                        .unwrap()
                        .slice(alloc);

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
                    // PERF(port): was `this.allocator().alloc(Stmt, 1)` (arena).
                    let new_stmts: *mut [Stmt] = alloc.alloc_slice_fill_iter(core::iter::once(
                        Stmt::alloc(
                            S::Local {
                                is_export: true,
                                decls: G::DeclList::from_slice(&[G::Decl {
                                    binding: Binding::alloc(
                                        alloc,
                                        B::Identifier { r#ref: generated.0 },
                                        expr.loc,
                                    ),
                                    value: property.value,
                                }])?,
                                ..Default::default()
                            },
                            property.key.as_ref().unwrap().loc,
                        ),
                    ));
                    // PORT NOTE: `parts.ptr[generated[1]]` — re-borrow `parts` here for borrowck.
                    let parts = this.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
                    parts[generated.1 as usize].stmts = new_stmts;
                }
            }

            {
                // PERF(port): was `std.fmt.allocPrint` into arena; building into Vec<u8> then arena-dupe.
                let mut name_buf: Vec<u8> = Vec::new();
                write!(
                    &mut name_buf,
                    "{}_default",
                    unsafe { &(*this.parse_graph).input_files }.items_source()[source_index as usize]
                        .fmt_identifier()
                )
                .expect("write to Vec<u8> cannot fail");
                // SAFETY: `LinkerContext::allocator()` returns a stable `&Arena` valid for the
                // link pass; detach via raw-pointer round-trip so `name` doesn't borrow `this`
                // across the `&mut self` call to `generate_named_export_in_file` below.
                let alloc: &bun_alloc::Arena =
                    unsafe { &*(this.allocator() as *const bun_alloc::Arena) };
                let name = alloc.alloc_slice_copy(&name_buf);

                let generated = this.generate_named_export_in_file(
                    source_index,
                    module_ref,
                    name,
                    b"default",
                )?;
                let new_stmts: *mut [Stmt] = alloc.alloc_slice_fill_iter(core::iter::once(
                    Stmt::alloc(
                        S::ExportDefault {
                            default_name: js_ast::LocRef {
                                ref_: Some(generated.0),
                                loc: stmt.loc,
                            },
                            value: js_ast::StmtOrExpr::Expr(expr),
                        },
                        stmt.loc,
                    ),
                ));
                let parts = this.graph.ast.items_parts_mut()[source_index as usize].slice_mut();
                parts[generated.1 as usize].stmts = new_stmts;
            }
        }
    }

    Ok(())
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCodeForLazyExport.zig (421 lines)
//   confidence: medium
//   todos:      9
//   notes:      Heavy borrowck reshaping (Visitor moved into loop; `parts` re-borrowed); Stmt/Expr.Data union variant names guessed; arena allocator threading deferred to Phase B.
// ──────────────────────────────────────────────────────────────────────────
