use crate::mal_prelude::*;
use bun_collections::VecExt;
use core::cmp::Ordering;

use bun_js_parser::ast::bundled_ast::{Flags as AstFlags};
use bun_js_parser::ast::symbol;
use bun_js_parser::ast::StmtData;
use bun_js_parser::{Part, SlotCounts};

use crate::bun_renamer as renamer;
use crate::bun_renamer::{ChunkRenamer, MinifyRenamer, NumberRenamer, StableSymbolCount};
use crate::chunk::Content;
use crate::ungate_support::js_meta;
use crate::{Chunk, LinkerContext, StableRef, WrapKind};

/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
// TODO(port): narrow error set
// TODO(port): bundler is an AST crate (PORTING.md §Allocators) — verify whether caller passes
// an arena vs default_allocator for the dropped `arena: std.mem.Allocator` param; if arena,
// thread `bump: &'bump Bump` and switch working Vecs to bun_alloc::ArenaVec<'bump, T>.
pub fn rename_symbols_in_chunk(
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    files_in_order: &[u32],
) -> Result<ChunkRenamer, bun_core::Error> {
    let _trace = bun_core::perf::trace("Bundler.renameSymbolsInChunk");

    // ── split-borrow SoA columns ─────────────────────────────────────────
    // `MultiArrayList` never reallocates inside this function (read-only over
    // graph.ast/graph.meta), so one `split_mut` per list gives `&mut [T]` to
    // every column for the whole body. `c.graph.symbols` / `c.options` /
    // `c.graph.stable_source_indices` are sibling fields and stay accessible.
    let ast = c.graph.ast.split_mut();
    let meta = c.graph.meta.split_mut();

    let all_module_scopes = ast.module_scope;
    let all_flags: &[js_meta::Flags] = meta.flags;
    let all_parts = ast.parts;
    let all_wrapper_refs = ast.wrapper_ref;
    let all_import_records = ast.import_records;

    // PORT NOTE: `symbol::Map` is not `Clone`/`Copy`; Zig passed the struct
    // (slice header) by value. Build a non-owning shallow view via
    // `from_bump_slice` so the renamer's `Map` does not free graph storage on
    // drop.
    // SAFETY: `c.graph.symbols` outlives the returned `ChunkRenamer` (both are
    // owned by the link step). No growth is performed on the view.
    let symbols = &mut c.graph.symbols;
    let make_symbols_view = |symbols: &mut symbol::Map| -> symbol::Map {
        let inner = symbols.symbols_for_source.slice_mut();
        symbol::Map {
            symbols_for_source: core::mem::ManuallyDrop::into_inner(unsafe {
                <Vec<_> as bun_collections::VecExt<_>>::from_borrowed_slice_dangerous(inner)
            }),
        }
    };

    let mut reserved_names = renamer::compute_initial_reserved_names(c.options.output_format)?;
    for &source_index in files_in_order {
        renamer::compute_reserved_names_for_scope(
            &all_module_scopes[source_index as usize],
            symbols,
            &mut reserved_names,
        );
    }

    let sorted_imports_from_other_chunks: Vec<StableRef> = {
        let imports_from_other_chunks = match &chunk.content {
            Content::Javascript(js) => js.imports_from_other_chunks.values(),
            // Only JS chunks reach `rename_symbols_in_chunk`.
            _ => &[],
        };
        let mut count: u32 = 0;
        for item in imports_from_other_chunks {
            count += item.len() as u32;
        }

        // PERF(port): Zig pre-set len and filled via slice writes; using push() here
        let mut list: Vec<StableRef> = Vec::with_capacity(count as usize);
        let stable_source_indices = c.graph.stable_source_indices.slice();
        for item in imports_from_other_chunks {
            for ref_ in item.slice() {
                list.push(StableRef {
                    stable_source_index: stable_source_indices[ref_.r#ref.source_index() as usize],
                    r#ref: ref_.r#ref,
                });
            }
        }

        list.sort_unstable_by(|a, b| {
            if StableRef::is_less_than((), *a, *b) {
                Ordering::Less
            } else if StableRef::is_less_than((), *b, *a) {
                Ordering::Greater
            } else {
                Ordering::Equal
            }
        });
        list
    };

    if c.options.minify_identifiers {
        let first_top_level_slots: SlotCounts = {
            let mut slots = SlotCounts::default();
            for &i in files_in_order {
                slots.union_max(ast.nested_scope_slot_counts[i as usize].clone());
            }
            slots
        };

        let mut minify_renamer =
            MinifyRenamer::init(make_symbols_view(symbols), first_top_level_slots, reserved_names)?;

        let mut top_level_symbols: Vec<StableSymbolCount> = Vec::new();
        let mut top_level_symbols_all: Vec<StableSymbolCount> = Vec::new();

        let stable_source_indices = c.graph.stable_source_indices.slice();
        let mut freq = bun_js_parser::ast::CharFreq { freqs: [0i32; 64] };

        let mut capacity = sorted_imports_from_other_chunks.len();
        for &source_index in files_in_order {
            if ast.flags[source_index as usize].contains(AstFlags::HAS_CHAR_FREQ) {
                freq.include(&ast.char_freq[source_index as usize]);
            }
        }

        for &source_index in files_in_order {
            let ast_flags = ast.flags[source_index as usize];
            let uses_exports_ref = ast_flags.contains(AstFlags::USES_EXPORTS_REF);
            let uses_module_ref = ast_flags.contains(AstFlags::USES_MODULE_REF);
            let exports_ref = ast.exports_ref[source_index as usize];
            let module_ref = ast.module_ref[source_index as usize];
            let parts = &all_parts[source_index as usize];

            top_level_symbols.clear();

            if uses_exports_ref {
                minify_renamer.accumulate_symbol_use_count(
                    &mut top_level_symbols,
                    exports_ref,
                    1,
                    stable_source_indices,
                )?;
            }
            if uses_module_ref {
                minify_renamer.accumulate_symbol_use_count(
                    &mut top_level_symbols,
                    module_ref,
                    1,
                    stable_source_indices,
                )?;
            }

            for part in parts.slice() {
                if !part.is_live {
                    continue;
                }

                minify_renamer.accumulate_symbol_use_counts(
                    &mut top_level_symbols,
                    &part.symbol_uses,
                    stable_source_indices,
                )?;

                for declared_ref in part.declared_symbols.refs() {
                    minify_renamer.accumulate_symbol_use_count(
                        &mut top_level_symbols,
                        *declared_ref,
                        1,
                        stable_source_indices,
                    )?;
                }
            }

            top_level_symbols.sort_unstable_by(StableSymbolCount::less_than);
            capacity += top_level_symbols.len();
            top_level_symbols_all.extend_from_slice(&top_level_symbols);
        }

        top_level_symbols.clear();
        for stable_ref in &sorted_imports_from_other_chunks {
            // PORT NOTE: `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
            let ref_ = { stable_ref.r#ref };
            minify_renamer.accumulate_symbol_use_count(
                &mut top_level_symbols,
                ref_,
                1,
                stable_source_indices,
            )?;
        }
        top_level_symbols_all.extend_from_slice(&top_level_symbols);
        minify_renamer.allocate_top_level_symbol_slots(&top_level_symbols_all)?;

        let minifier = freq.compile();
        minify_renamer.assign_names_by_frequency(&minifier)?;

        let _ = capacity;
        return Ok(ChunkRenamer::Minify(minify_renamer));
    }

    let mut r = NumberRenamer::init(make_symbols_view(symbols), reserved_names)?;
    for stable_ref in &sorted_imports_from_other_chunks {
        // PORT NOTE: `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
        r.add_top_level_symbol({ stable_ref.r#ref });
    }

    // PORT NOTE: Zig used `r.temp_arena` for this list; arena param dropped
    let mut sorted: Vec<u32> = Vec::new();

    for &source_index in files_in_order {
        let wrap = all_flags[source_index as usize].wrap;
        // PORT NOTE: need `&mut [Part]` for `add_top_level_declared_symbols`.
        let parts: &mut [Part] = all_parts[source_index as usize].slice_mut();

        match wrap {
            // Modules wrapped in a CommonJS closure look like this:
            //
            //   // foo.js
            //   var require_foo = __commonJS((exports, module) => {
            //     exports.foo = 123;
            //   });
            //
            // The symbol "require_foo" is stored in "file.ast.WrapperRef". We want
            // to be able to minify everything inside the closure without worrying
            // about collisions with other CommonJS modules. Set up the scopes such
            // that it appears as if the file was structured this way all along. It's
            // not completely accurate (e.g. we don't set the parent of the module
            // scope to this new top-level scope) but it's good enough for the
            // renaming code.
            WrapKind::Cjs => {
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);

                // External import statements will be hoisted outside of the CommonJS
                // wrapper if the output format supports import statements. We need to
                // add those symbols to the top-level scope to avoid causing name
                // collisions. This code special-cases only those symbols.
                if c.options.output_format.keep_es6_import_export_syntax() {
                    let import_records = all_import_records[source_index as usize].slice();
                    for part in parts.iter() {
                        // SAFETY: `Part.stmts` is an arena-owned slice valid for the AST lifetime.
                        for stmt in unsafe { &*part.stmts } {
                            match stmt.data {
                                StmtData::SImport(import) => {
                                    if !import_records[import.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(import.namespace_ref);
                                        if let Some(default_name) = &import.default_name {
                                            if let Some(ref_) = default_name.ref_ {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }

                                        // SAFETY: `S::Import.items` is an arena-owned slice.
                                        for item in unsafe { &*import.items } {
                                            if let Some(ref_) = item.name.ref_ {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }
                                    }
                                }
                                StmtData::SExportStar(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(export_.namespace_ref);
                                    }
                                }
                                StmtData::SExportFrom(export_) => {
                                    if !import_records[export_.import_record_index as usize]
                                        .source_index
                                        .is_valid()
                                    {
                                        r.add_top_level_symbol(export_.namespace_ref);

                                        // SAFETY: `S::ExportFrom.items` is an arena-owned slice.
                                        for item in unsafe { &*export_.items } {
                                            if let Some(ref_) = item.name.ref_ {
                                                r.add_top_level_symbol(ref_);
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                // PORT NOTE: reshaped for borrowck — `&mut r.root` while `r` is the
                // `&mut self` receiver. Take a raw pointer; `assign_names_*` does
                // not touch `self.root` through `self`.
                let root: *mut renamer::NumberScope = core::ptr::addr_of_mut!(r.root);
                r.assign_names_recursive_with_number_scope(
                    root,
                    &mut all_module_scopes[source_index as usize],
                    source_index,
                    &mut sorted,
                );
                continue;
            }

            // Modules wrapped in an ESM closure look like this:
            //
            //   // foo.js
            //   var foo, foo_exports = {};
            //   __export(foo_exports, {
            //     foo: () => foo
            //   });
            //   let init_foo = __esm(() => {
            //     foo = 123;
            //   });
            //
            // The symbol "init_foo" is stored in "file.ast.WrapperRef". We need to
            // minify everything inside the closure without introducing a new scope
            // since all top-level variables will be hoisted outside of the closure.
            WrapKind::Esm => {
                r.add_top_level_symbol(all_wrapper_refs[source_index as usize]);
            }

            WrapKind::None => {}
        }

        for part in parts.iter_mut() {
            if !part.is_live {
                continue;
            }

            r.add_top_level_declared_symbols(&mut part.declared_symbols);
            // SAFETY: `Part.scopes` is an arena-owned slice of arena-allocated `*mut Scope`.
            for scope in unsafe { &*part.scopes } {
                let root: *mut renamer::NumberScope = core::ptr::addr_of_mut!(r.root);
                // SAFETY: each `*mut Scope` is a valid arena-allocated scope.
                r.assign_names_recursive_with_number_scope(
                    root,
                    unsafe { &mut **scope },
                    source_index,
                    &mut sorted,
                );
            }
            // Zig: `@TypeOf(r.number_scope_pool.hive.used).initEmpty()`.
            r.number_scope_pool.hive.used = bun_collections::IntegerBitSet::init_empty();
        }
    }

    Ok(ChunkRenamer::Number(r))
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/renameSymbolsInChunk.zig (276 lines)
//   confidence: medium
//   todos:      3
//   notes:      Returns owned `ChunkRenamer` (not borrowed `Renamer<'r,_>`); SoA columns accessed via raw `*mut [T]` pointers (matches scanImportsAndExports); `symbol::Map` shallow view via `from_bump_slice` to mirror Zig by-value pass without double-free.
// ──────────────────────────────────────────────────────────────────────────
