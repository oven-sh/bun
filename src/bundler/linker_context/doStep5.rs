//! Port of `src/bundler/linker_context/doStep5.zig`.
//!
//! PORT NOTE: like `scanImportsAndExports.rs`, the Zig body holds many
//! overlapping `&mut` column slices out of `LinkerGraph.{ast,meta}` while also
//! calling `&self` methods. The SoA columns are physically disjoint and never
//! reallocate during this step, so we cache raw column pointers and deref at
//! each use site.

use crate::mal_prelude::*;
use core::mem::{MaybeUninit, offset_of};

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVecExt as _;
use bun_ast::Loc;
use bun_collections::{ArrayHashMap, HashMap, VecExt};
use bun_core::strings;

use crate::bundled_ast::{BundledAstColumns as _, Flags as AstFlags};
use bun_ast::symbol::Use as SymbolUse;
use bun_ast::{
    self as js_ast, Binding, DeclaredSymbol, DeclaredSymbolList, Dependency, E, Expr, G, Part,
    PartSymbolUseMap, Ref, S, Stmt,
};

use crate::options::Format;
use crate::ungate_support::perf;
use crate::{BundleV2, Index, LinkerContext, RefImportData, ResolvedExports, js_meta};

pub use crate::ThreadPool;

impl LinkerContext<'_> {
    /// Step 5: Create namespace exports for every file. This is always necessary
    /// for CommonJS files, and is also necessary for other files if they are
    /// imported using an import star statement.
    ///
    // CONCURRENCY: `each` callback — runs on worker threads, one task per
    // `source_index`. Writes: `graph.{ast,meta}[source_index]` SoA cells
    // (per-row disjoint). Reads `graph.symbols`/`options`/`ts_enums` shared.
    // Never forms `&mut LinkerContext`; per-row writes via `split_raw()` raw
    // pointers (root provenance). See `# Safety` for full invariant.
    /// # Safety
    ///
    /// Runs concurrently on worker-pool threads (one task per `source_index`).
    /// The body never materializes `&mut LinkerContext` — it derefs `this` to a
    /// shared `&LinkerContext` for read-only access (`symbols`, `ts_enums`,
    /// `top_level_symbols_to_parts`, options) and writes only to its own
    /// `source_index` row of the `graph.{ast,meta}` SoA columns via raw
    /// per-row pointers obtained from `split_raw()` (root provenance, no
    /// `&mut [T]` intermediate). Disjoint rows ⇒ no overlapping `&mut`.
    pub unsafe fn do_step5(this: *mut LinkerContext<'_>, source_index_: Index, _: usize) {
        let source_index = source_index_.get();
        let _trace = perf::trace("Bundler.CreateNamespaceExports");

        // Shared-ref view for all read-only access. Multiple worker threads may
        // hold `&LinkerContext` simultaneously; the SoA buffers live behind raw
        // pointers inside `MultiArrayList`, so this borrow does not assert
        // immutability over the heap cells we write below.
        let c: &LinkerContext<'_> = unsafe { &*this };

        let id = source_index;
        if id as usize >= c.graph.meta.len() {
            return;
        }

        // SAFETY: `this` points to `BundleV2.linker` (caller is the worker-pool
        // dispatch from `scanImportsAndExports`); `container_of` shape.
        // `Worker::get` only needs `&BundleV2`, so derive a shared ref — never
        // form `&mut BundleV2` here (concurrent tasks would alias it).
        let bundle_v2: &BundleV2<'_> = unsafe { &*LinkerContext::bundle_v2_ptr(this) };
        let worker = ThreadPool::Worker::get(bundle_v2);
        // Zig: `defer worker.unget()`. `Worker::get` returns the thread-local worker
        // (not RAII), so balance explicitly via scopeguard.
        let worker = scopeguard::guard(worker, |w| w.unget());

        // we must use this arena here
        // SAFETY: `Worker::create` initializes `arena` to point at
        // `worker.heap`; valid for the worker's lifetime.
        let arena: &Bump = worker.arena();

        // ── raw SoA column pointers (root provenance) ─────────────────────
        // `split_raw()` derives `*mut [T]` directly from the buffer base with
        // no `&mut` intermediate, so per-row writes through these pointers are
        // sound under Stacked Borrows even with N concurrent tasks. We index
        // by raw `.add(id)` (never `(*col)[id]`, which would form a transient
        // `&[T]` over the whole column and race with other rows' writes).
        let ast = c.graph.ast.split_raw();
        let meta = c.graph.meta.split_raw();
        macro_rules! row_mut {
            ($col:expr, $ty:ty, $i:expr) => {{
                // SAFETY: `$col: *mut [$ty]` from `split_raw()`; `$i < len`
                // (guarded above for `meta`, and `ast.len == meta.len`). The
                // `as *mut $ty` fat→thin cast preserves the raw provenance
                // from `split_raw()`.
                unsafe { &mut *(($col as *mut $ty).add($i as usize)) }
            }};
        }

        let resolved_exports: *mut ResolvedExports =
            (meta.resolved_exports as *mut ResolvedExports).wrapping_add(id as usize);
        // Read-only columns (never written during step 5) — whole-column
        // shared slices are fine here.
        // SAFETY: `split_raw()` columns are valid for `meta.len()` elements;
        // no task mutates `imports_to_bind` / `probably_typescript_type`.
        let (imports_to_bind, probably_typescript_type): (
            &[RefImportData],
            &[ArrayHashMap<Ref, ()>],
        ) = unsafe { (&*meta.imports_to_bind, &*meta.probably_typescript_type) };

        // Now that all exports have been resolved, sort and filter them to create
        // something we can iterate over later.
        // SAFETY: SoA column pointers stay valid for the worker step (no realloc).
        let mut aliases = bun_alloc::ArenaVec::<&[u8]>::with_capacity_in(
            unsafe { (*resolved_exports).count() },
            arena,
        );

        // counting in here saves us an extra pass through the array
        let mut re_exports_count: usize = 0;

        {
            // SAFETY: see above.
            let mut alias_iter = unsafe { (*resolved_exports).iterator() };
            'next_alias: while let Some(entry) = alias_iter.next() {
                let export_ = entry.value_ptr;
                let alias: &[u8] = entry.key_ptr;
                let this_id = export_.data.source_index.get();
                let mut inner_count: usize = 0;
                // Re-exporting multiple symbols with the same name causes an ambiguous
                // export. These names cannot be used and should not end up in generated code.
                if export_.potentially_ambiguous_export_star_refs.len() > 0 {
                    let main_data =
                        match imports_to_bind[this_id as usize].get(&export_.data.import_ref) {
                            Some(b) => b.data,
                            None => export_.data,
                        };
                    for ambig in export_.potentially_ambiguous_export_star_refs.slice() {
                        let _id = ambig.data.source_index.get();
                        let ambig_ref = if let Some(bound) =
                            imports_to_bind[_id as usize].get(&ambig.data.import_ref)
                        {
                            bound.data.import_ref
                        } else {
                            ambig.data.import_ref
                        };
                        if main_data.import_ref != ambig_ref {
                            continue 'next_alias;
                        }
                        inner_count += ambig.re_exports.len() as usize;
                    }
                }

                // Ignore re-exported imports in TypeScript files that failed to be
                // resolved. These are probably just type-only imports so the best thing to
                // do is to silently omit them from the export list.
                if probably_typescript_type[this_id as usize].contains(&export_.data.import_ref) {
                    continue;
                }
                re_exports_count += inner_count;

                aliases.push(alias);
                // PERF(port): was appendAssumeCapacity
            }
        }
        // TODO: can this be u32 instead of a string?
        // if yes, we could just move all the hidden exports to the end of the array
        // and only store a count instead of an array
        strings::sort_desc(aliases.as_mut_slice());
        let export_aliases = aliases.into_bump_slice();
        *row_mut!(meta.sorted_and_filtered_export_aliases, Box<[Box<[u8]>]>, id) =
            // PORT NOTE: SoA column is `Box<[Box<[u8]>]>`; the worker arena slices
            // are `&'bump [u8]`. Re-own into `Box` for now — once `JSMeta` grows
            // an `'arena` lifetime this collapses to a borrowing slice. PERF(port).
            export_aliases.iter().map(|s| (*s).to_vec().into_boxed_slice()).collect();

        // Export creation uses "sortedAndFilteredExportAliases" so this must
        // come second after we fill in that array
        c.create_exports_for_file(
            arena,
            id,
            // SAFETY: `resolved_exports` points at one slot of the
            // `meta.resolved_exports` SoA column; `imports_to_bind` is a
            // distinct SoA column (disjoint allocation). The earlier iterator
            // over `*resolved_exports` ended above, so this is the sole live
            // `&mut` into that slot. `create_exports_for_file` writes only via
            // this param + the three per-row cells below and never re-borrows
            // those columns through `self`.
            unsafe { &mut *resolved_exports },
            imports_to_bind,
            export_aliases,
            re_exports_count,
            // Per-row mutable SoA cells (own `id` only — disjoint across tasks).
            row_mut!(meta.flags, js_meta::Flags, id),
            row_mut!(ast.flags, AstFlags, id),
            row_mut!(ast.parts, bun_ast::PartList, id),
        );

        // Each part tracks the other parts it depends on within this file
        let mut local_dependencies: HashMap<u32, u32> = HashMap::default();

        // PORT NOTE: reshaped for borrowck — multiple `&mut` into graph SoA;
        // raw per-row pointers via `split_raw()` so concurrent tasks never
        // hold overlapping `&mut [T]`.
        let parts_slice: *mut [Part] = row_mut!(ast.parts, bun_ast::PartList, id).slice_mut();
        let named_imports: *mut crate::bundled_ast::NamedImports =
            (ast.named_imports as *mut crate::bundled_ast::NamedImports).wrapping_add(id as usize);
        // SAFETY: `named_imports` is a stable column pointer (see above). We
        // hoist the emptiness check so the per-symbol-use inner loop skips
        // the lookup entirely for files with no imports (≈ all leaf modules).
        let named_imports_is_empty = unsafe { (*named_imports).is_empty() };

        // PERF(port): hoist this file's two `top_level_symbols_to_parts`
        // sub-maps. The Zig version reaches them through
        // `c.topLevelSymbolsToParts(id, ref)` per symbol-use, which is fine
        // when the underlying ArrayHashMap has its index_header (O(1) get).
        // In the port, perf showed `find_hash` falling through to the linear
        // scan branch here (≈87% of step5 self-time on three.js), so we (a)
        // hoist the per-file column pointer math out of the J×K inner loop
        // and (b) ensure the accelerator index is built on the large
        // `top_level_symbols_to_parts[id]` map before probing it J times.
        // SAFETY: both columns are SoA rows owned by this task's `id`; the
        // overlay row may be written by `create_exports_for_file` above (this
        // borrow begins after it returns) and the ast row is parser-built and
        // never reallocated during step 5. No other task touches row `id`.
        let (tlsp_overlay, tlsp_ast): (
            &bun_ast::ast_result::TopLevelSymbolToParts,
            &bun_ast::ast_result::TopLevelSymbolToParts,
        ) = unsafe {
            (
                &*(meta.top_level_symbol_to_parts_overlay
                    as *const bun_ast::ast_result::TopLevelSymbolToParts)
                    .add(id as usize),
                &*(ast.top_level_symbols_to_parts
                    as *const bun_ast::ast_result::TopLevelSymbolToParts)
                    .add(id as usize),
            )
        };

        let our_imports_to_bind: &RefImportData = &imports_to_bind[id as usize];
        // SAFETY: see above.
        'outer: for (part_index, part) in unsafe { (*parts_slice).iter_mut().enumerate() } {
            // Now that all files have been parsed, determine which property
            // accesses off of imported symbols are inlined enum values and
            // which ones aren't
            // PORT NOTE: reshaped for borrowck — Zig iterates keys()/values() while
            // holding a mutable getPtr into part.symbol_uses; collect refs first.
            // PERF(port): the property-use map is empty for the overwhelming
            // majority of parts (it only fills for `import * as ns`/enum
            // property accesses); skip the `to_vec()` alloc-round-trip in
            // that case.
            let prop_use_refs: Vec<Ref> = if part.import_symbol_property_uses.is_empty() {
                Vec::new()
            } else {
                part.import_symbol_property_uses.keys().to_vec()
            };
            for ref_ in &prop_use_refs {
                // Re-fetch each iteration to avoid overlapping &mut.
                let properties: *const _ = part.import_symbol_property_uses.get(ref_).unwrap();
                let use_: &mut SymbolUse = part.symbol_uses.get_ptr_mut(ref_).unwrap();

                // Rare path: this import is a TypeScript enum
                if let Some(import_data) = our_imports_to_bind.get(ref_) {
                    let import_ref = import_data.data.import_ref;
                    if let Some(symbol) = c.graph.symbols.get_const(import_ref) {
                        if symbol.kind == bun_ast::symbol::Kind::TsEnum {
                            if let Some(enum_data) = c.graph.ts_enums.get(&import_ref) {
                                let mut found_non_inlined_enum = false;

                                // SAFETY: `properties` points into
                                // `part.import_symbol_property_uses` which is not
                                // mutated for the lifetime of this borrow.
                                for (name, prop_use) in unsafe { (*properties).iter() } {
                                    if enum_data.get(name).is_none() {
                                        found_non_inlined_enum = true;
                                        use_.count_estimate += prop_use.count_estimate;
                                    }
                                }

                                if !found_non_inlined_enum {
                                    if use_.count_estimate == 0 {
                                        let _ = part.symbol_uses.swap_remove(ref_);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                }

                // Common path: this import isn't a TypeScript enum
                // SAFETY: see above.
                for prop_use in unsafe { (*properties).values() } {
                    use_.count_estimate += prop_use.count_estimate;
                }
            }

            // TODO: inline function calls here

            // TODO: Inline cross-module constants
            // if (c.graph.const_values.count() > 0) {
            //     // First, find any symbol usage that points to a constant value.
            //     // This will be pretty rare.
            //     const first_constant_i: ?usize = brk: {
            //         for (part.symbol_uses.keys(), 0..) |ref, j| {
            //             if (c.graph.const_values.contains(ref)) {
            //                 break :brk j;
            //             }
            //         }
            //
            //         break :brk null;
            //     };
            //     if (first_constant_i) |j| {
            //         var end_i: usize = 0;
            //         // symbol_uses is an array
            //         var keys = part.symbol_uses.keys()[j..];
            //         var values = part.symbol_uses.values()[j..];
            //         for (keys, values) |ref, val| {
            //             if (c.graph.const_values.contains(ref)) {
            //                 continue;
            //             }
            //
            //             keys[end_i] = ref;
            //             values[end_i] = val;
            //             end_i += 1;
            //         }
            //         part.symbol_uses.entries.len = end_i + j;
            //
            //         if (part.symbol_uses.entries.len == 0 and part.can_be_removed_if_unused) {
            //             part.tag = .dead_due_to_inlining;
            //             part.dependencies.len = 0;
            //             continue :outer;
            //         }
            //
            //         part.symbol_uses.reIndex(arena) catch unreachable;
            //     }
            // }
            if false {
                break 'outer;
            } // this `if` is here to preserve the unused
            //                          block label from the above commented code.

            // Now that we know this, we can determine cross-part dependencies
            // PERF(port): iterate the keys slice directly (the index-based
            // form re-loaded `keys.len()` and bounds-checked each access).
            let part_index_u32 = part_index as u32;
            let dependencies = &mut part.dependencies;
            for &ref_ in part.symbol_uses.keys() {
                debug_assert!({
                    let j = part
                        .symbol_uses
                        .keys()
                        .iter()
                        .position(|k| *k == ref_)
                        .unwrap();
                    part.symbol_uses.values()[j].count_estimate > 0
                });

                // Inlined `c.top_level_symbols_to_parts(id, ref_)` against the
                // hoisted per-file maps so the column pointer math (and the
                // `&LinkerContext` deref) is out of the inner loop.
                let other_parts: &[u32] = if let Some(overlay) = tlsp_overlay.get(&ref_) {
                    overlay.as_slice()
                } else if let Some(list) = tlsp_ast.get(&ref_) {
                    list.as_slice()
                } else {
                    &[]
                };

                for &other_part_index in other_parts {
                    let local = local_dependencies
                        .get_or_put(other_part_index)
                        .expect("unreachable");
                    if !local.found_existing || *local.value_ptr != part_index_u32 {
                        *local.value_ptr = part_index_u32;
                        // note: if we crash on append, it is due to threadlocal heaps in mimalloc
                        dependencies.push(Dependency {
                            source_index: bun_ast::Index::source(source_index as usize),
                            part_index: other_part_index,
                        });
                    }
                }

                // Also map from imports to parts that use them
                if !named_imports_is_empty {
                    // SAFETY: `named_imports` is a stable column pointer; this
                    // task owns row `id` exclusively (see split_raw note).
                    if let Some(existing) = unsafe { (*named_imports).get_ptr_mut(&ref_) } {
                        existing.local_parts_with_uses.push(part_index_u32);
                    }
                }
            }
        }
    }

    /// Spec: `linker_context/doStep5.zig:createExportsForFile`.
    ///
    /// WARNING: This method is run in parallel over all files. Do not mutate data
    /// for other files within this method or you will create a data race.
    ///
    /// PORT NOTE: takes `&self` (read-only) plus the three SoA row cells it
    /// mutates as explicit `&mut` params, so the parallel `do_step5` dispatch
    /// never forms a concurrent `&mut LinkerContext` / whole-column `&mut [T]`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_exports_for_file(
        &self,
        arena: &Bump,
        id: u32,
        resolved_exports: &mut ResolvedExports,
        imports_to_bind: &[RefImportData],
        export_aliases: &[&[u8]],
        re_exports_count: usize,
        meta_flags: &mut js_meta::Flags,
        ast_flags: &mut AstFlags,
        ast_parts: &mut bun_ast::PartList,
    ) {
        // PORT NOTE: Zig toggled `Stmt.Disabler`/`Expr.Disabler` (debug-only
        // re-entrancy guards around the global Store). `Disabler::scope()`
        // calls `disable()` and re-`enable()`s on drop — currently no-op stubs
        // until the thread-local toggle lands (`js_parser/ast/mod.rs`).
        let _stmt_guard = bun_ast::stmt::Disabler::scope();
        let _expr_guard = bun_ast::expr::Disabler::scope();

        // 1 property per export
        let mut properties =
            bun_alloc::ArenaVec::<G::Property>::with_capacity_in(export_aliases.len(), arena);

        let mut ns_export_symbol_uses = PartSymbolUseMap::default();
        ns_export_symbol_uses
            .ensure_total_capacity(export_aliases.len())
            .expect("OOM");

        let initial_flags = *meta_flags;
        let needs_exports_variable = initial_flags.needs_exports_variable;
        let force_include_exports_for_entry_point = self.options.output_format == Format::Cjs
            && initial_flags.force_include_exports_for_entry_point;

        let stmts_count =
            // 1 statement for every export
            export_aliases.len() +
            // + 1 if there are non-zero exports
            (!export_aliases.is_empty()) as usize +
            // + 1 if we need to inject the exports variable
            needs_exports_variable as usize +
            // + 1 if we need to do module.exports = __toCommonJS(exports)
            force_include_exports_for_entry_point as usize;

        // PORT NOTE: Zig used `Stmt.Batcher` (preallocated arena slice +
        // cursor). `Batcher::<T>::init` requires `T: Default` which `Stmt`
        // doesn't satisfy, so we hand-roll the same shape: one arena slab of
        // `stmts_count` `MaybeUninit<Stmt>`, sliced front-to-back. `eat1`
        // becomes a `write` + sub-slice carve. The slab is held as a safe
        // `&mut [MaybeUninit<Stmt>]` borrow of the arena allocation; each
        // carve borrows it briefly and hands the result to `StoreSlice`
        // (raw-ptr wrapper, no lifetime), so successive carves don't alias.
        let stmts_slab: &mut [MaybeUninit<Stmt>] =
            arena.alloc_slice_fill_with(stmts_count, |_| MaybeUninit::uninit());
        let mut stmts_head: usize = 0;
        macro_rules! stmts_eat1 {
            ($value:expr) => {{
                // `MaybeUninit::write` returns `&mut T` to the now-initialized slot.
                let written: &mut Stmt = stmts_slab[stmts_head].write($value);
                stmts_head += 1;
                bun_ast::StoreSlice::new_mut(core::slice::from_mut(written))
            }};
        }
        let loc = Loc::EMPTY;
        // todo: investigate if preallocating this array is faster
        let mut ns_export_dependencies = Vec::<Dependency>::init_capacity(re_exports_count);
        for &alias in export_aliases {
            let exp = resolved_exports.get_mut(alias).unwrap();
            let mut exp_data = exp.data;

            // If this is an export of an import, reference the symbol that the import
            // was eventually resolved to. We need to do this because imports have
            // already been resolved by this point, so we can't generate a new import
            // and have that be resolved later.
            if let Some(import_data) =
                imports_to_bind[exp_data.source_index.get() as usize].get(&exp_data.import_ref)
            {
                exp_data.import_ref = import_data.data.import_ref;
                exp_data.source_index = import_data.data.source_index;
                ns_export_dependencies.append_slice(import_data.re_exports.slice());
            }

            // Exports of imports need EImportIdentifier in case they need to be re-
            // written to a property access later on
            // note: this is stack allocated
            let value: Expr = 'brk: {
                if let Some(symbol) = self.graph.symbols.get_const(exp_data.import_ref) {
                    if symbol.namespace_alias.is_some() {
                        break 'brk Expr::init(
                            E::ImportIdentifier {
                                ref_: exp_data.import_ref,
                                ..Default::default()
                            },
                            loc,
                        );
                    }
                }

                Expr::init(
                    E::Identifier {
                        ref_: exp_data.import_ref,
                        ..Default::default()
                    },
                    loc,
                )
            };

            let fn_body = G::FnBody {
                stmts: stmts_eat1!(Stmt::allocate(arena, S::Return { value: Some(value) }, loc,)),
                loc,
            };
            properties.push(G::Property {
                key: Some(Expr::allocate(
                    arena,
                    // TODO: test emoji work as expected (relevant for WASM exports)
                    // SAFETY: `alias` borrows the worker arena which outlives the
                    // link pass; `E::String::data: &'static [u8]` is the arena
                    // erasure used throughout the AST.
                    E::String::init(unsafe { bun_ptr::detach_lifetime(alias) }),
                    loc,
                )),
                value: Some(Expr::allocate(
                    arena,
                    E::Arrow {
                        prefer_expr: true,
                        body: fn_body,
                        ..Default::default()
                    },
                    loc,
                )),
                ..Default::default()
            });
            // PERF(port): was appendAssumeCapacity
            ns_export_symbol_uses
                .put_assume_capacity(exp_data.import_ref, SymbolUse { count_estimate: 1 });

            // Make sure the part that declares the export is included
            let parts =
                self.top_level_symbols_to_parts(exp_data.source_index.get(), exp_data.import_ref);
            ns_export_dependencies.ensure_unused_capacity(parts.len());
            for &part_id in parts {
                // Use a non-local dependency since this is likely from a different
                // file if it came in through an export star
                ns_export_dependencies.append_assume_capacity(Dependency {
                    source_index: bun_ast::Index::source(exp_data.source_index.get() as usize),
                    part_index: part_id,
                });
            }
        }

        let mut declared_symbols = DeclaredSymbolList::default();
        let exports_ref = self.graph.ast.items_exports_ref()[id as usize];
        let all_export_stmts_len = needs_exports_variable as usize
            + (!properties.is_empty()) as usize
            + force_include_exports_for_entry_point as usize;
        // PORT NOTE: the trailing `all_export_stmts_len` slots of `stmts_slab`
        // (after the per-export `eat1`s above) are filled below in the order
        // {var exports={}, __export(...), module.exports=__toCommonJS(...)}.
        let all_export_stmts_base = stmts_head;
        macro_rules! emit_export_stmt {
            ($value:expr) => {{
                stmts_slab[stmts_head].write($value);
                stmts_head += 1;
            }};
        }

        // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
        if needs_exports_variable {
            emit_export_stmt!(Stmt::allocate(
                arena,
                S::Local {
                    decls: G::DeclList::from_slice(&[G::Decl {
                        binding: Binding::alloc(
                            arena,
                            bun_ast::b::Identifier { r#ref: exports_ref },
                            loc,
                        ),
                        value: Some(Expr::allocate(arena, E::Object::default(), loc)),
                    }]),
                    ..Default::default()
                },
                loc,
            ));
            declared_symbols
                .append(DeclaredSymbol {
                    ref_: exports_ref,
                    is_top_level: true,
                })
                .expect("unreachable");
        }

        // "__export(exports, { foo: () => foo })"
        let mut export_ref = Ref::NONE;
        if !properties.is_empty() {
            export_ref = self.runtime_function(b"__export");
            // PORT NOTE: `bumpalo::Vec` → `Vec` via the global heap;
            // `G::PropertyList` is `Vec<Property>` and currently has no
            // arena-backed `move_from_list`, so re-own. PERF(port).
            let mut owned_props: Vec<G::Property> = Vec::with_capacity(properties.len());
            owned_props.extend(properties.drain(..));
            emit_export_stmt!(Stmt::allocate(
                arena,
                S::SExpr {
                    value: Expr::allocate(
                        arena,
                        E::Call {
                            target: Expr::init_identifier(export_ref, loc),
                            args: bun_ast::ExprNodeList::from_slice(&[
                                Expr::init_identifier(exports_ref, loc),
                                Expr::allocate(
                                    arena,
                                    E::Object {
                                        properties: G::PropertyList::move_from_list(owned_props),
                                        ..Default::default()
                                    },
                                    loc,
                                ),
                            ]),
                            ..Default::default()
                        },
                        loc,
                    ),
                    ..Default::default()
                },
                loc,
            ));
            // Make sure this file depends on the "__export" symbol
            let parts = self.top_level_symbols_to_parts_for_runtime(export_ref);
            ns_export_dependencies.ensure_unused_capacity(parts.len());
            for &part_index in parts {
                ns_export_dependencies.append_assume_capacity(Dependency {
                    source_index: bun_ast::Index::RUNTIME,
                    part_index,
                });
            }

            // Make sure the CommonJS closure, if there is one, includes "exports"
            ast_flags.insert(AstFlags::USES_EXPORTS_REF);
        }

        // Decorate "module.exports" with the "__esModule" flag to indicate that
        // we used to be an ES module. This is done by wrapping the exports object
        // instead of by mutating the exports object because other modules in the
        // bundle (including the entry point module) may do "import * as" to get
        // access to the exports object and should NOT see the "__esModule" flag.
        if force_include_exports_for_entry_point {
            let to_common_js_ref = self.runtime_function(b"__toCommonJS");
            emit_export_stmt!(Stmt::assign(
                Expr::allocate(
                    arena,
                    E::Dot {
                        name: b"exports".into(),
                        name_loc: Loc::EMPTY,
                        target: Expr::init_identifier(self.unbound_module_ref, Loc::EMPTY),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
                Expr::allocate(
                    arena,
                    E::Call {
                        target: Expr::init_identifier(to_common_js_ref, Loc::EMPTY),
                        args: bun_ast::ExprNodeList::from_slice(&[Expr::init_identifier(
                            exports_ref,
                            Loc::EMPTY,
                        )]),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ),
            ));
        }

        debug_assert_eq!(stmts_head - all_export_stmts_base, all_export_stmts_len); // all must be used

        // No need to generate a part if it'll be empty
        if all_export_stmts_len > 0 {
            // - we must already have preallocated the parts array
            // - if the parts list is completely empty, we shouldn't have gotten here in the first place

            // Initialize the part that was allocated for us earlier. The information
            // here will be used after this during tree shaking.
            ast_parts.slice_mut()[bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize] = Part {
                stmts: if self.options.output_format != Format::InternalBakeDev {
                    let init = &mut stmts_slab[all_export_stmts_base..stmts_head];
                    debug_assert_eq!(init.len(), all_export_stmts_len);
                    // SAFETY: the `[all_export_stmts_base..stmts_head]` window of
                    // `stmts_slab` is fully initialized above (`debug_assert_eq!`
                    // just verified head == base+len); same-layout cast
                    // `[MaybeUninit<Stmt>]` → `[Stmt]`. The worker arena
                    // outlives the link pass.
                    bun_ast::StoreSlice::new_mut(unsafe {
                        &mut *(init as *mut [MaybeUninit<Stmt>] as *mut [Stmt])
                    })
                } else {
                    bun_ast::StoreSlice::EMPTY
                },
                symbol_uses: ns_export_symbol_uses,
                dependencies: ns_export_dependencies,
                declared_symbols,

                // This can be removed if nothing uses it
                can_be_removed_if_unused: true,

                // Make sure this is trimmed if unused even if tree shaking is disabled
                force_tree_shaking: true,

                ..Default::default()
            };

            // Pull in the "__export" symbol if it was used
            if export_ref.is_valid() {
                meta_flags.needs_export_symbol_from_runtime = true;
            }
        }
    }
}

// ported from: src/bundler/linker_context/doStep5.zig
