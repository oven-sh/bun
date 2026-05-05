//! Barrel optimization: detect pure re-export barrel files and defer loading
//! of unused submodules. Uses a persistent `requested_exports` map to track
//! which exports have been requested from each barrel, providing cross-call
//! deduplication and cycle detection (inspired by Rolldown's pattern).
//!
//! Import requests are recorded eagerly as each file is processed — before
//! barrels are known. When a barrel later loads, applyBarrelOptimization reads
//! `requested_exports` to see what's already been requested. No graph scan needed.

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_js_parser::{BundledAst as JSAst, Index};
use bun_options_types::ImportRecord;

use crate::bundle_v2::BundleV2;
use crate::parse_task::ParseTask;

bun_output::declare_scope!(barrel, hidden);

pub enum RequestedExports {
    All,
    Partial(StringArrayHashMap<()>),
}

// PORT NOTE: 'a borrows arena-backed AST alias strings (named_imports/named_exports).
struct BarrelExportResolution<'a> {
    import_record_index: u32,
    /// The original alias in the source module (e.g. "d" for `export { d as c }`)
    original_alias: Option<&'a [u8]>,
    /// True when the underlying import is `import * as ns` — propagation
    /// through this export must treat the target as needing all exports.
    alias_is_star: bool,
}

/// Look up an export name → import_record_index by chasing
/// named_exports[alias].ref through named_imports.
/// Also returns the original alias from the source module for BFS propagation.
fn resolve_barrel_export<'a>(
    alias: &[u8],
    named_exports: &'a JSAst::NamedExports,
    named_imports: &'a JSAst::NamedImports,
) -> Option<BarrelExportResolution<'a>> {
    let export_entry = named_exports.get(alias)?;
    let import_entry = named_imports.get(export_entry.r#ref)?;
    Some(BarrelExportResolution {
        import_record_index: import_entry.import_record_index,
        original_alias: import_entry.alias,
        alias_is_star: import_entry.alias_is_star,
    })
}

/// Analyze a parsed file to determine if it's a barrel and mark unneeded
/// import records as is_unused so they won't be resolved. Runs BEFORE resolution.
///
/// A file qualifies as a barrel if:
/// 1. It has `sideEffects: false` or is in `optimize_imports`, AND
/// 2. All named exports are re-exports (no local definitions), AND
/// 3. It is not an export star target of another barrel.
///
/// Export * records are never deferred (always resolved) to avoid circular races.
pub fn apply_barrel_optimization(this: &mut BundleV2, parse_result: &mut ParseTask::Result) {
    // bun.handleOom: Rust aborts on OOM via the global allocator; unwrap is for
    // bun_collections ops that still surface AllocError.
    apply_barrel_optimization_impl(this, parse_result).expect("OOM");
}

fn apply_barrel_optimization_impl(
    this: &mut BundleV2,
    parse_result: &mut ParseTask::Result,
) -> Result<(), AllocError> {
    let result = &mut parse_result.value.success;
    let ast = &mut result.ast;
    let source_index = result.source.index.get();

    let is_explicit = if let Some(oi) = &this.transpiler.options.optimize_imports {
        oi.map.contains(result.package_name)
    } else {
        false
    };
    let is_side_effects_false = result.side_effects == SideEffects::NoSideEffectsPackageJson;
    if !is_explicit && !is_side_effects_false {
        return Ok(());
    }
    if ast.import_records.len() == 0 {
        return Ok(());
    }
    if ast.named_exports.count() == 0 && ast.export_star_import_records.len() == 0 {
        return Ok(());
    }

    let named_exports = &ast.named_exports;
    let named_imports = &ast.named_imports;

    // Verify pure barrel: all named exports must be re-exports
    for (_, entry) in named_exports.iter() {
        if named_imports.get(entry.r#ref).is_none() {
            return Ok(());
        }
    }

    // If this barrel is a star target of another barrel, can't safely defer
    if this.graph.input_files.items_flags()[source_index as usize].is_export_star_target {
        return Ok(());
    }

    // Check requested_exports to see which exports were already requested by
    // files parsed before this barrel. scheduleBarrelDeferredImports records
    // requests eagerly as each file is processed, so we don't need to scan
    // the graph.
    if let Some(existing) = this.requested_exports.get(&source_index) {
        match existing {
            RequestedExports::All => return Ok(()), // import * already seen — load everything
            RequestedExports::Partial(_) => {}
        }
    }

    // Build the set of needed import_record_indices from already-requested
    // export names. Export * records are always needed.
    // PERF(port): was stack-fallback (8192) — profile in Phase B
    let mut needed_records: ArrayHashMap<u32, ()> = ArrayHashMap::default();

    for record_idx in ast.export_star_import_records.iter() {
        needed_records.put(*record_idx, ())?;
    }

    if let Some(existing) = this.requested_exports.get(&source_index) {
        match existing {
            RequestedExports::All => unreachable!(), // handled above
            RequestedExports::Partial(partial) => {
                for (key, _) in partial.iter() {
                    if let Some(resolution) = resolve_barrel_export(key, named_exports, named_imports) {
                        needed_records.put(resolution.import_record_index, ())?;
                    }
                }
            }
        }
    }

    // Dev server: also include exports persisted from previous builds. This
    // handles the case where file A imports Alpha from the barrel (previous
    // build) and file B adds Beta (current build). Without this, Alpha would
    // be re-deferred because only B's requests are in requested_exports.
    if let Some(dev) = this.dev_server_handle() {
        // SAFETY: barrel_needed_exports is owned by DevServer; bundler runs on the bundle
        // thread which holds the DevServer lock during this callback.
        let needed = unsafe { &*(dev.vtable.barrel_needed_exports)(dev.owner) };
        if let Some(persisted) = needed.get(result.source.path.text) {
            for alias in persisted.keys() {
                if let Some(resolution) = resolve_barrel_export(alias, named_exports, named_imports) {
                    needed_records.put(resolution.import_record_index, ())?;
                }
            }
        }
    }

    // When HMR is active, ConvertESMExportsForHmr deduplicates import records
    // by path — two `export { ... } from './utils.js'` blocks get merged into
    // one record. The surviving record might be the one barrel optimization
    // would mark as unused (its exports not needed), while the other record
    // (whose exports ARE needed) gets marked unused by HMR dedup. To prevent
    // both records from ending up unused, promote needed_records to cover ALL
    // import records that share a path with any needed record.
    if this.dev_server_handle().is_some() {
        // Collect paths of needed records.
        // PERF(port): was stack-fallback (4096) — profile in Phase B
        let mut needed_paths: StringArrayHashMap<()> = StringArrayHashMap::default();

        for rec_idx in needed_records.keys() {
            if (*rec_idx as usize) < ast.import_records.len() {
                needed_paths.put(ast.import_records.slice()[*rec_idx as usize].path.text, ())?;
            }
        }

        // Add all records sharing a needed path to the needed set.
        for (_, entry) in named_exports.iter() {
            if let Some(imp) = named_imports.get(entry.r#ref) {
                if (imp.import_record_index as usize) < ast.import_records.len() {
                    if needed_paths
                        .contains(ast.import_records.slice()[imp.import_record_index as usize].path.text)
                    {
                        needed_records.put(imp.import_record_index, ())?;
                    }
                }
            }
        }
    }

    // Mark unneeded named re-export records as is_unused.
    let mut has_deferrals = false;
    for (_, entry) in named_exports.iter() {
        if let Some(imp) = named_imports.get(entry.r#ref) {
            if !needed_records.contains(&imp.import_record_index) {
                if (imp.import_record_index as usize) < ast.import_records.len() {
                    // PORT NOTE: reshaped for borrowck — index into mut slice while iterating named_exports
                    ast.import_records.slice_mut()[imp.import_record_index as usize]
                        .flags
                        .is_unused = true;
                    has_deferrals = true;
                }
            }
        }
    }

    if has_deferrals {
        bun_output::scoped_log!(
            barrel,
            "barrel detected: {} (source={}, {} deferred, {} needed)",
            bstr::BStr::new(if !result.package_name.is_empty() {
                result.package_name
            } else {
                result.source.path.text
            }),
            source_index,
            named_exports.count().saturating_sub(needed_records.count()),
            needed_records.count(),
        );

        // Merge with existing entry (keep already-requested names) or create new
        let gop = this.requested_exports.get_or_put(source_index)?;
        if !gop.found_existing {
            *gop.value_ptr = RequestedExports::Partial(StringArrayHashMap::default());
        }

        // Register with DevServer so isFileCached returns null for this barrel,
        // ensuring it gets re-parsed on every incremental build. This is needed
        // because the set of needed exports can change when importing files change.
        if let Some(dev) = this.dev_server_handle() {
            // CYCLEBREAK: barrel_files_with_deferrals get_or_put + key dupe encapsulated
            // in DevServerVTable. PERF(port): was direct hashmap access.
            unsafe { (dev.vtable.register_barrel_with_deferrals)(dev.owner, result.source.path.text) }?;
        }
    }

    Ok(())
}

/// Clear is_unused on a deferred barrel record. Returns true if the record was un-deferred.
fn un_defer_record(import_records: &mut ImportRecord::List, record_idx: u32) -> bool {
    if record_idx as usize >= import_records.len() {
        return false;
    }
    let rec = &mut import_records.slice_mut()[record_idx as usize];
    if rec.flags.is_internal || !rec.flags.is_unused {
        return false;
    }
    rec.flags.is_unused = false;
    true
}

/// BFS work queue item: un-defer an export from a barrel.
// PORT NOTE: 'a borrows arena-backed AST alias strings.
struct BarrelWorkItem<'a> {
    barrel_source_index: u32,
    alias: &'a [u8],
    is_star: bool,
}

/// Resolve, process, and patch import records for a single barrel.
/// Used to inline-resolve deferred records whose source_index is still invalid.
fn resolve_barrel_records(
    this: &mut BundleV2,
    barrel_idx: u32,
    barrels_to_resolve: &mut ArrayHashMap<u32, ()>,
) -> i32 {
    let graph_ast = this.graph.ast.slice();
    let barrel_ir = &mut graph_ast.items_import_records()[barrel_idx as usize];
    let target = graph_ast.items_target()[barrel_idx as usize];
    // TODO(port): resolveImportRecords arg struct — match BundleV2 method signature in Phase B
    let mut resolve_result = this.resolve_import_records(ResolveImportRecordsArgs {
        import_records: barrel_ir,
        source: &this.graph.input_files.items_source()[barrel_idx as usize],
        loader: this.graph.input_files.items_loader()[barrel_idx as usize],
        target,
    });
    // resolve_result.resolve_queue dropped at end of scope (was `defer .deinit()`)
    let scheduled = this.process_resolve_queue(resolve_result.resolve_queue, target, barrel_idx);
    // Re-derive pointer after processResolveQueue may have reallocated graph.ast
    let barrel_ir_updated = &mut this.graph.ast.slice().items_import_records()[barrel_idx as usize];
    this.patch_import_record_source_indices(
        barrel_ir_updated,
        PatchImportRecordSourceIndicesArgs {
            source_index: Index::init(barrel_idx),
            source_path: this.graph.input_files.items_source()[barrel_idx as usize].path.text,
            loader: this.graph.input_files.items_loader()[barrel_idx as usize],
            target,
            force_save: true,
        },
    );
    let _ = barrels_to_resolve.swap_remove(&barrel_idx);
    scheduled
}

/// After a new file's import records are patched with source_indices,
/// record what this file requests from each target in requested_exports
/// (eagerly, before barrels are known), then BFS through barrel chains
/// to un-defer needed records. Un-deferred records are re-resolved through
/// resolveImportRecords (same path as initial resolution).
/// Returns the number of newly scheduled parse tasks.
pub fn schedule_barrel_deferred_imports(
    this: &mut BundleV2,
    result: &mut ParseTask::Result::Success,
) -> Result<i32, AllocError> {
    let file_import_records = &result.ast.import_records;

    // Phase 1: Seed — eagerly record what this file requests from each target.
    // This runs for every file, even before any barrels are known. When a barrel
    // is later parsed, applyBarrelOptimization reads these pre-recorded requests
    // to decide which exports to keep. O(file's imports) per file.

    // Build a set of import_record_indices that have named_imports entries,
    // so we can detect bare imports (those with no specific export bindings).
    // PERF(port): was stack-fallback (4096) — profile in Phase B
    let mut named_ir_indices: ArrayHashMap<u32, ()> = ArrayHashMap::default();

    // In dev server mode, patchImportRecordSourceIndices skips saving source_indices
    // on import records (the dev server uses path-based identifiers instead). But
    // barrel optimization requires source_indices to seed requested_exports and to
    // BFS un-defer records. Resolve paths → source_indices here as a fallback.
    let path_to_source_index_map = if this.dev_server_handle().is_some() {
        Some(this.path_to_source_index_map(result.ast.target))
    } else {
        None
    };

    // In HMR, ConvertESMExportsForHmr deduplicates import records by path:
    // two `import { X } from 'mod'` statements become one, and the second
    // record is marked is_unused=true. resolveImportRecords then skips those
    // records, so their path.text stays as the raw specifier while the
    // surviving record's path.text becomes the resolved absolute path.
    // named_imports entries created for the dedup'd record still point at
    // its index, so the direct path lookup below fails for those entries.
    // Build a fallback: raw specifier → surviving record's resolved path
    // text, using non-unused records in this file. See #28886.
    // TODO(port): lifetime — keys/values borrow from file_import_records for fn duration
    let mut dedup_fallback: StringArrayHashMap<&[u8]> = StringArrayHashMap::default();
    if this.dev_server_handle().is_some() {
        for ir_probe in file_import_records.slice() {
            if ir_probe.flags.is_unused || ir_probe.flags.is_internal {
                continue;
            }
            if ir_probe.original_path.is_empty() {
                continue;
            }
            if ir_probe.original_path == ir_probe.path.text {
                continue;
            }
            dedup_fallback.put(ir_probe.original_path, ir_probe.path.text)?;
        }
    }

    for (_, ni) in result.ast.named_imports.iter() {
        if ni.import_record_index as usize >= file_import_records.len() {
            continue;
        }
        named_ir_indices.put(ni.import_record_index, ())?;
        let ir = &file_import_records.slice()[ni.import_record_index as usize];
        // In dev server mode, source_index may not be patched — resolve via
        // path map as a read-only fallback. Do NOT write back to the import
        // record — the dev server intentionally leaves source_indices unset
        // and other code (IncrementalGraph, printer) depends on that.
        // For dedup'd HMR records (is_unused), fall back to a sibling's
        // resolved path text since the record itself still has the raw
        // specifier in path.text.
        let resolved_path_text = if ir.flags.is_unused {
            dedup_fallback.get(ir.path.text).copied().unwrap_or(ir.path.text)
        } else {
            ir.path.text
        };
        let target = if ir.source_index.is_valid() {
            ir.source_index.get()
        } else if let Some(map) = &path_to_source_index_map {
            match map.get(resolved_path_text) {
                Some(t) => t,
                None => continue,
            }
        } else {
            continue;
        };

        let gop = this.requested_exports.get_or_put(target)?;
        if ni.alias_is_star {
            *gop.value_ptr = RequestedExports::All;
        } else if let Some(alias) = ni.alias {
            if gop.found_existing {
                match gop.value_ptr {
                    RequestedExports::All => {}
                    RequestedExports::Partial(p) => p.put(alias, ())?,
                }
            } else {
                *gop.value_ptr = RequestedExports::Partial(StringArrayHashMap::default());
                if let RequestedExports::Partial(p) = gop.value_ptr {
                    p.put(alias, ())?;
                }
            }
            // Persist the export request on DevServer so it survives across builds.
            if let Some(dev) = this.dev_server_handle() {
                persist_barrel_export(dev, resolved_path_text, alias);
            }
        } else if !gop.found_existing {
            *gop.value_ptr = RequestedExports::Partial(StringArrayHashMap::default());
        }
    }

    // Handle import records without named bindings (not in named_imports).
    // - `import "x"` (bare statement): tree-shakeable with sideEffects: false — skip.
    // - `require("x")`: synchronous, needs full module — always mark as .all.
    // - `import("x")`: returns the full module namespace at runtime — consumer
    //   can destructure or access any export. Must mark as .all. We cannot
    //   safely assume which exports will be used.
    for (idx, ir) in file_import_records.slice().iter().enumerate() {
        let target = if ir.source_index.is_valid() {
            ir.source_index.get()
        } else if let Some(map) = &path_to_source_index_map {
            match map.get_path(&ir.path) {
                Some(t) => t,
                None => continue,
            }
        } else {
            continue;
        };
        if ir.flags.is_internal {
            continue;
        }
        if named_ir_indices.contains(&u32::try_from(idx).unwrap()) {
            continue;
        }
        if ir.flags.was_originally_bare_import {
            continue;
        }
        if ir.kind == ImportKind::Require {
            let gop = this.requested_exports.get_or_put(target)?;
            *gop.value_ptr = RequestedExports::All;
        } else if ir.kind == ImportKind::Dynamic {
            // import() returns the full module namespace — must preserve all exports.
            let gop = this.requested_exports.get_or_put(target)?;
            *gop.value_ptr = RequestedExports::All;
        }
    }

    // Phase 2: BFS — un-defer barrel records that are now needed.
    // Build work queue from this file's named_imports, then propagate
    // through chains of barrels. Only runs real work when barrels exist
    // (targets with deferred records).
    // PERF(port): was stack-fallback (8192) — profile in Phase B
    let mut queue: Vec<BarrelWorkItem> = Vec::new();

    for (_, ni) in result.ast.named_imports.iter() {
        if ni.import_record_index as usize >= file_import_records.len() {
            continue;
        }
        let ir = &file_import_records.slice()[ni.import_record_index as usize];
        let resolved_path_text = if ir.flags.is_unused {
            dedup_fallback.get(ir.path.text).copied().unwrap_or(ir.path.text)
        } else {
            ir.path.text
        };
        let ir_target = if ir.source_index.is_valid() {
            ir.source_index.get()
        } else if let Some(map) = &path_to_source_index_map {
            match map.get(resolved_path_text) {
                Some(t) => t,
                None => continue,
            }
        } else {
            continue;
        };

        if ni.alias_is_star {
            queue.push(BarrelWorkItem {
                barrel_source_index: ir_target,
                alias: b"",
                is_star: true,
            });
        } else if let Some(alias) = ni.alias {
            queue.push(BarrelWorkItem {
                barrel_source_index: ir_target,
                alias,
                is_star: false,
            });
        }
    }

    // Add bare require/dynamic-import targets to BFS as star imports — both
    // always need the full namespace.
    for (idx, ir) in file_import_records.slice().iter().enumerate() {
        let target = if ir.source_index.is_valid() {
            ir.source_index.get()
        } else if let Some(map) = &path_to_source_index_map {
            match map.get_path(&ir.path) {
                Some(t) => t,
                None => continue,
            }
        } else {
            continue;
        };
        if ir.flags.is_internal {
            continue;
        }
        if named_ir_indices.contains(&u32::try_from(idx).unwrap()) {
            continue;
        }
        if ir.flags.was_originally_bare_import {
            continue;
        }
        let should_add = ir.kind == ImportKind::Require || ir.kind == ImportKind::Dynamic;
        if should_add {
            queue.push(BarrelWorkItem {
                barrel_source_index: target,
                alias: b"",
                is_star: true,
            });
        }
    }

    // Also seed the BFS with exports previously requested from THIS file
    // that couldn't propagate because this file wasn't parsed yet.
    // This handles the case where file A requests export "d" from file B,
    // but B hadn't been parsed when A's BFS ran, so B's export * records
    // were empty and the propagation stopped.
    let this_source_index = result.source.index.get();
    if let Some(existing) = this.requested_exports.get(&this_source_index) {
        match existing {
            RequestedExports::All => queue.push(BarrelWorkItem {
                barrel_source_index: this_source_index,
                alias: b"",
                is_star: true,
            }),
            RequestedExports::Partial(partial) => {
                for (key, _) in partial.iter() {
                    queue.push(BarrelWorkItem {
                        barrel_source_index: this_source_index,
                        alias: key,
                        is_star: false,
                    });
                }
            }
        }
    }

    if queue.is_empty() {
        return Ok(0);
    }

    // Items [0, initial_queue_len) are from this file's imports and were
    // already recorded in requested_exports during seeding (phase 1).
    // Skip dedup for them so un-deferral proceeds correctly.
    // Items added during BFS propagation (>= initial_queue_len) use normal
    // dedup via requested_exports to prevent cycles.
    let initial_queue_len = queue.len();

    // PERF(port): was stack-fallback (1024) — profile in Phase B
    let mut barrels_to_resolve: ArrayHashMap<u32, ()> = ArrayHashMap::default();

    let mut newly_scheduled: i32 = 0;
    let mut qi: usize = 0;
    while qi < queue.len() {
        // PORT NOTE: reshaped for borrowck — copy item fields out before pushing to queue later
        let item_barrel_idx = queue[qi].barrel_source_index;
        let item_alias = queue[qi].alias;
        let item_is_star = queue[qi].is_star;
        let barrel_idx = item_barrel_idx;

        // For BFS-propagated items (not from initial queue), use
        // requested_exports for dedup and cycle detection.
        if qi >= initial_queue_len {
            let gop = this.requested_exports.get_or_put(barrel_idx)?;
            if item_is_star {
                *gop.value_ptr = RequestedExports::All;
            } else if gop.found_existing {
                match gop.value_ptr {
                    RequestedExports::All => {
                        qi += 1;
                        continue;
                    }
                    RequestedExports::Partial(p) => {
                        let alias_gop = p.get_or_put(item_alias)?;
                        if alias_gop.found_existing {
                            qi += 1;
                            continue;
                        }
                    }
                }
            } else {
                *gop.value_ptr = RequestedExports::Partial(StringArrayHashMap::default());
                if let RequestedExports::Partial(p) = gop.value_ptr {
                    p.put(item_alias, ())?;
                }
            }
        }

        if barrel_idx as usize >= this.graph.ast.len() {
            qi += 1;
            continue;
        }

        // Use a helper to get barrel_ir freshly each time, since
        // resolveBarrelRecords can reallocate graph.ast and invalidate pointers.
        // PORT NOTE: reshaped for borrowck — re-borrow graph.ast slice after each mutation
        let mut barrel_ir = &mut this.graph.ast.slice().items_import_records()[barrel_idx as usize];

        if item_is_star {
            // PORT NOTE: reshaped for borrowck — collect indices first, then mutate
            let len = barrel_ir.len();
            for idx in 0..len {
                let rec = &barrel_ir.slice()[idx];
                if rec.flags.is_unused && !rec.flags.is_internal {
                    if un_defer_record(barrel_ir, u32::try_from(idx).unwrap()) {
                        barrels_to_resolve.put(barrel_idx, ())?;
                    }
                }
            }
            qi += 1;
            continue;
        }

        let alias = item_alias;
        let graph_ast_snapshot = this.graph.ast.slice();
        let resolution = resolve_barrel_export(
            alias,
            &graph_ast_snapshot.items_named_exports()[barrel_idx as usize],
            &graph_ast_snapshot.items_named_imports()[barrel_idx as usize],
        );
        let Some(resolution) = resolution else {
            // Name not in named re-exports — might come from export *.
            // TODO(port): borrowck — iterating export_star_import_records while mutating barrel_ir
            let star_records = graph_ast_snapshot.items_export_star_import_records()[barrel_idx as usize].to_vec();
            for star_idx in star_records {
                if star_idx as usize >= barrel_ir.len() {
                    continue;
                }
                if un_defer_record(barrel_ir, star_idx) {
                    barrels_to_resolve.put(barrel_idx, ())?;
                }
                let mut star_rec = barrel_ir.slice()[star_idx as usize];
                if !star_rec.source_index.is_valid() {
                    // Deferred record was never resolved — resolve inline now.
                    newly_scheduled += resolve_barrel_records(this, barrel_idx, &mut barrels_to_resolve);
                    // Re-derive pointer after resolution may have mutated slices.
                    barrel_ir = &mut this.graph.ast.slice().items_import_records()[barrel_idx as usize];
                    star_rec = barrel_ir.slice()[star_idx as usize];
                }
                if star_rec.source_index.is_valid() {
                    queue.push(BarrelWorkItem {
                        barrel_source_index: star_rec.source_index.get(),
                        alias,
                        is_star: false,
                    });
                }
            }
            qi += 1;
            continue;
        };

        if un_defer_record(barrel_ir, resolution.import_record_index) {
            barrels_to_resolve.put(barrel_idx, ())?;
        }

        let propagate_alias = resolution.original_alias.unwrap_or(alias);
        if (resolution.import_record_index as usize) < barrel_ir.len() {
            let mut rec = barrel_ir.slice()[resolution.import_record_index as usize];
            if !rec.source_index.is_valid() {
                // Deferred record was never resolved — resolve inline now.
                newly_scheduled += resolve_barrel_records(this, barrel_idx, &mut barrels_to_resolve);
                barrel_ir = &mut this.graph.ast.slice().items_import_records()[barrel_idx as usize];
                rec = barrel_ir.slice()[resolution.import_record_index as usize];
            }
            if rec.source_index.is_valid() {
                // When the barrel re-exports a namespace import (`import * as X; export { X }`),
                // propagate as a star import so the target barrel loads all exports.
                queue.push(BarrelWorkItem {
                    barrel_source_index: rec.source_index.get(),
                    alias: propagate_alias,
                    is_star: resolution.alias_is_star,
                });
            }
        }

        qi += 1;
    }

    // Re-resolve any remaining un-deferred records through the normal resolution path.
    while barrels_to_resolve.count() > 0 {
        let barrel_source_index = barrels_to_resolve.keys()[0];
        newly_scheduled += resolve_barrel_records(this, barrel_source_index, &mut barrels_to_resolve);
    }

    Ok(newly_scheduled)
}

/// Persist an export name for a barrel file on the DevServer. Called during
/// seeding so that exports requested in previous builds are not lost when the
/// barrel is re-parsed in an incremental build where the requesting file is
/// not stale.
fn persist_barrel_export(dev: &crate::dispatch::DevServerHandle, barrel_path: &[u8], alias: &[u8]) {
    // CYCLEBREAK GENUINE: bun_runtime::bake::DevServer → vtable. PERF(port): was inline switch.
    // SAFETY: vtable.barrel_needed_exports returns &mut map tied to dev.owner lifetime.
    let barrel_needed_exports = unsafe { &mut *(dev.vtable.barrel_needed_exports)(dev.owner) };
    let Ok(outer_gop) = barrel_needed_exports.get_or_put(barrel_path) else {
        return;
    };
    if !outer_gop.found_existing {
        // TODO(port): dev.allocator().dupe — DevServer-owned key/value storage
        *outer_gop.key_ptr = Box::<[u8]>::from(barrel_path);
        *outer_gop.value_ptr = Default::default();
    }
    let Ok(inner_gop) = outer_gop.value_ptr.get_or_put(alias) else {
        return;
    };
    if !inner_gop.found_existing {
        *inner_gop.key_ptr = Box::<[u8]>::from(alias);
    }
}

// TODO(port): these placeholder types reference cross-file items; Phase B wires real imports
use bun_options_types::ImportKind;
use crate::bundle_v2::{PatchImportRecordSourceIndicesArgs, ResolveImportRecordsArgs};
use crate::options::SideEffects;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/barrel_imports.zig (562 lines)
//   confidence: medium
//   todos:      6
//   notes:      MultiArrayList .items(.field) accessors stubbed as items_field(); heavy borrowck reshaping needed in BFS loop (overlapping &mut graph.ast); get_or_put GOP API assumed on bun_collections maps
// ──────────────────────────────────────────────────────────────────────────
