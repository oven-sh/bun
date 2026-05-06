use core::cmp::Ordering;

use bun_js_parser::ast::bundled_ast::{BundledAstField as AstField, Flags as AstFlags};
use bun_js_parser::ast::symbol;
use bun_js_parser::ast::{CharFreq, Scope, StmtData};
use bun_js_parser::{Part, PartList, Ref, SlotCounts};
use bun_options_types::import_record;

use crate::bun_renamer as renamer;
use crate::bun_renamer::{ChunkRenamer, MinifyRenamer, NumberRenamer, StableSymbolCount};
use crate::chunk::Content;
use crate::ungate_support::js_meta::{self, JSMetaField};
use crate::{Chunk, LinkerContext, StableRef, WrapKind};

/// TODO: investigate if we need to parallelize this function
/// esbuild does parallelize it.
// TODO(port): narrow error set
// TODO(port): bundler is an AST crate (PORTING.md §Allocators) — verify whether caller passes
// an arena vs default_allocator for the dropped `allocator: std.mem.Allocator` param; if arena,
// thread `bump: &'bump Bump` and switch working Vecs to bumpalo::collections::Vec<'bump, T>.
pub fn rename_symbols_in_chunk(
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    files_in_order: &[u32],
) -> Result<ChunkRenamer, bun_core::Error> {
    let _trace = bun_core::perf::trace("Bundler.renameSymbolsInChunk");

    // ── cache SoA column base pointers ────────────────────────────────────
    // `MultiArrayList` never reallocates inside this function (read-only over
    // graph.ast/graph.meta). Distinct columns are disjoint by construction, so
    // raw column pointers are valid for the whole body and may be dereferenced
    // alongside other `&c.graph.*` borrows.
    macro_rules! col_ptr {
        ($slice:ident, $field_enum:ident :: $field:ident, $ty:ty) => {{
            let len = $slice.len();
            // SAFETY: `$ty` is exactly the column type for `$field`; the derive
            // guarantees the field-enum ↔ type pairing.
            let p: *mut $ty = unsafe { $slice.items_raw::<$ty>($field_enum::$field) };
            core::ptr::slice_from_raw_parts_mut(p, len)
        }};
    }
    macro_rules! col {
        ($p:expr) => {
            // SAFETY: see `col_ptr!`. No aliasing `&mut` to the same column is
            // live across this deref.
            unsafe { &*$p }
        };
    }
    macro_rules! col_mut {
        ($p:expr) => {
            // SAFETY: see `col_ptr!`. No aliasing borrow of the same column is
            // live across this deref.
            unsafe { &mut *$p }
        };
    }

    let ast = c.graph.ast.slice();
    let meta = c.graph.meta.slice();

    let all_module_scopes: *mut [Scope] = col_ptr!(ast, AstField::module_scope, Scope);
    let all_flags: *mut [js_meta::Flags] = col_ptr!(meta, JSMetaField::flags, js_meta::Flags);
    let all_parts: *mut [PartList] = col_ptr!(ast, AstField::parts, PartList);
    let all_wrapper_refs: *mut [Ref] = col_ptr!(ast, AstField::wrapper_ref, Ref);
    let all_import_records: *mut [import_record::List] =
        col_ptr!(ast, AstField::import_records, import_record::List);

    // PORT NOTE: `symbol::Map` is not `Clone`/`Copy`; Zig passed the struct
    // (slice header) by value. Build a non-owning shallow view via
    // `from_bump_slice` so the renamer's `Map` does not free graph storage on
    // drop.
    // SAFETY: `c.graph.symbols` outlives the returned `ChunkRenamer` (both are
    // owned by the link step). No growth is performed on the view.
    let symbols_ptr: *mut symbol::Map = core::ptr::addr_of_mut!(c.graph.symbols);
    let make_symbols_view = || -> symbol::Map {
        unsafe {
            let inner = (*symbols_ptr).symbols_for_source.slice_mut();
            symbol::Map { symbols_for_source: bun_collections::BabyList::from_bump_slice(inner) }
        }
    };

    let mut reserved_names = renamer::compute_initial_reserved_names(c.options.output_format)?;
    for &source_index in files_in_order {
        renamer::compute_reserved_names_for_scope(
            &col!(all_module_scopes)[source_index as usize],
            // SAFETY: disjoint from the column borrows above.
            unsafe { &*symbols_ptr },
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
            count += item.len;
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
            let nested_scope_slot_counts: *mut [SlotCounts] =
                col_ptr!(ast, AstField::nested_scope_slot_counts, SlotCounts);
            for &i in files_in_order {
                slots.union_max(col!(nested_scope_slot_counts)[i as usize].clone());
            }
            slots
        };

        let mut minify_renamer =
            MinifyRenamer::init(make_symbols_view(), first_top_level_slots, reserved_names)?;

        let mut top_level_symbols: Vec<StableSymbolCount> = Vec::new();
        let mut top_level_symbols_all: Vec<StableSymbolCount> = Vec::new();

        let stable_source_indices = c.graph.stable_source_indices.slice();
        let mut freq = CharFreq { freqs: [0i32; 64] };
        let ast_flags_list: *mut [AstFlags] = col_ptr!(ast, AstField::flags, AstFlags);

        let mut capacity = sorted_imports_from_other_chunks.len();
        {
            let char_freqs: *mut [CharFreq] = col_ptr!(ast, AstField::char_freq, CharFreq);

            for &source_index in files_in_order {
                if col!(ast_flags_list)[source_index as usize].contains(AstFlags::HAS_CHAR_FREQ) {
                    freq.include(&col!(char_freqs)[source_index as usize]);
                }
            }
        }

        let exports_ref_list: *mut [Ref] = col_ptr!(ast, AstField::exports_ref, Ref);
        let module_ref_list: *mut [Ref] = col_ptr!(ast, AstField::module_ref, Ref);
        let parts_list: *mut [PartList] = col_ptr!(ast, AstField::parts, PartList);

        for &source_index in files_in_order {
            let ast_flags = col!(ast_flags_list)[source_index as usize];
            let uses_exports_ref = ast_flags.contains(AstFlags::USES_EXPORTS_REF);
            let uses_module_ref = ast_flags.contains(AstFlags::USES_MODULE_REF);
            let exports_ref = col!(exports_ref_list)[source_index as usize];
            let module_ref = col!(module_ref_list)[source_index as usize];
            let parts = &col!(parts_list)[source_index as usize];

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

        let mut minifier = freq.compile();
        minify_renamer.assign_names_by_frequency(&mut minifier)?;

        let _ = capacity;
        return Ok(ChunkRenamer::Minify(minify_renamer));
    }

    let mut r = NumberRenamer::init(make_symbols_view(), reserved_names)?;
    for stable_ref in &sorted_imports_from_other_chunks {
        // PORT NOTE: `StableRef` is `repr(packed)`; copy the field to avoid an unaligned ref.
        r.add_top_level_symbol({ stable_ref.r#ref });
    }

    // PORT NOTE: Zig used `r.temp_allocator` for this list; allocator param dropped
    let mut sorted: Vec<u32> = Vec::new();

    for &source_index in files_in_order {
        let wrap = col!(all_flags)[source_index as usize].wrap;
        // PORT NOTE: need `&mut [Part]` for `add_top_level_declared_symbols`.
        let parts: &mut [Part] = col_mut!(all_parts)[source_index as usize].slice_mut();

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
                r.add_top_level_symbol(col!(all_wrapper_refs)[source_index as usize]);

                // External import statements will be hoisted outside of the CommonJS
                // wrapper if the output format supports import statements. We need to
                // add those symbols to the top-level scope to avoid causing name
                // collisions. This code special-cases only those symbols.
                if c.options.output_format.keep_es6_import_export_syntax() {
                    let import_records = col!(all_import_records)[source_index as usize].slice();
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
                    &mut col_mut!(all_module_scopes)[source_index as usize],
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
                r.add_top_level_symbol(col!(all_wrapper_refs)[source_index as usize]);
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
