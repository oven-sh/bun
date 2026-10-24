//! Barrel optimization: detect pure re-export barrel files and defer loading
//! of unused submodules. Uses a persistent `requested_exports` map to track
//! which exports have been requested from each barrel, providing cross-call
//! deduplication and cycle detection (inspired by Rolldown's pattern).
//!
//! Import requests are recorded eagerly as each file is processed — before
//! barrels are known. When a barrel later loads, applyBarrelOptimization reads
//! `requested_exports` to see what's already been requested. No graph scan needed.

use crate::bundled_ast as JSAst;
use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_ast::{ImportKind, import_record};
use bun_collections::{ArrayHashMap, ArrayIdentityContextU64, AutoBitSet, StringArrayHashMap};

use crate::Graph::InputFileFlags;
use crate::Index;
use crate::UseDirective;
use crate::bake_types;
use crate::bundle_v2::BundleV2;
use crate::bundle_v2::bv2_impl::{PatchImportRecordsCtx, ResolveImportRecordCtx};
use crate::options_impl::TargetExt as _;
use crate::parse_task;

bun_core::declare_scope!(barrel, hidden);

pub enum RequestedExports {
    All,
    Partial(StringArrayHashMap<()>),
}

impl Default for RequestedExports {
    fn default() -> Self {
        RequestedExports::Partial(StringArrayHashMap::default())
    }
}

/// Dev server: the requests of earlier builds that a later parse of a barrel has to count.
#[derive(Default)]
pub struct TrackedBarrels {
    /// By `bake_types::Side`: the server and SSR copies of a file share one graph record.
    by_side: [StringArrayHashMap<RequestedExports>; 2],
    /// By side, the requests of a file that no later build repeats: what a build requested from a copy
    /// that it did not bundle, and every export of a file that the router reads. It forces no parse.
    kept: [StringArrayHashMap<RequestedExports>; 2],
}

impl TrackedBarrels {
    #[inline]
    fn get(&self, side: bake_types::Side, path: &[u8]) -> Option<&RequestedExports> {
        let barrels = &self.by_side[side as usize];
        // A lookup hashes the path: skip it for the projects that track no barrel.
        if barrels.is_empty() {
            return None;
        }
        barrels.get(path)
    }

    /// False in a session that keeps no record: that session looks up no kept request.
    #[inline]
    fn any_kept(&self) -> bool {
        !self.kept[0].is_empty() || !self.kept[1].is_empty()
    }

    /// The kept records that a copy of this file on `side` reads.
    fn kept_for<'a>(
        &'a self,
        side: bake_types::Side,
        path: &'a [u8],
        use_directive: UseDirective,
    ) -> impl Iterator<Item = &'a RequestedExports> {
        // The record of a "use client" file is for the graph of its importer, which can be server code.
        let importer = (side == bake_types::Side::Client && use_directive == UseDirective::Client)
            .then_some(bake_types::Side::Server);
        [Some(side), importer]
            .into_iter()
            .flatten()
            .filter_map(move |kept_side| self.kept[kept_side as usize].get(path))
    }

    /// The router reads every export of this file itself, and no build records that request.
    pub fn keep_all(&mut self, side: bake_types::Side, path: &[u8]) -> Result<(), AllocError> {
        *self.kept[side as usize].get_or_put(path)?.value_ptr = RequestedExports::All;
        Ok(())
    }

    /// True if the copy of this file on `side` has an entry.
    pub fn is_tracked(&self, side: bake_types::Side, path: &[u8]) -> bool {
        self.get(side, path).is_some()
    }

    /// A client component boundary reads the copy of the other side: either side's entry counts.
    pub fn must_reparse(&self, path: &[u8]) -> bool {
        self.by_side
            .iter()
            .any(|barrels| !barrels.is_empty() && barrels.contains_key(path))
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost = 0;
        for barrels in self.by_side.iter().chain(&self.kept) {
            cost += barrels.capacity()
                * (size_of::<Box<[u8]>>() + size_of::<RequestedExports>() + size_of::<u32>());
            for (path, requested) in barrels.iter() {
                cost += path.len();
                if let RequestedExports::Partial(names) = requested {
                    cost += names.capacity() * (size_of::<Box<[u8]>>() + size_of::<u32>());
                    cost += names.keys().iter().map(|name| name.len()).sum::<usize>();
                }
            }
        }
        cost
    }
}

/// Dev server: the source indices of a build by the hash of their path.
#[derive(Default)]
pub struct SourcesByPath {
    newest: ArrayHashMap<u64, u32, ArrayIdentityContextU64>,
    /// For each indexed source, the next older source with the same hash, or `u32::MAX`.
    older: Vec<u32>,
}

impl SourcesByPath {
    fn index_new_sources(&mut self, sources: &[bun_ast::Source]) -> Result<(), AllocError> {
        for index in self.older.len()..sources.len() {
            let gop = self
                .newest
                .get_or_put(bun_wyhash::hash(sources[index].path.text))?;
            self.older.push(if gop.found_existing {
                *gop.value_ptr
            } else {
                u32::MAX
            });
            *gop.value_ptr = index as u32;
        }
        Ok(())
    }

    /// The other indexed sources that have the path of `source_index`.
    fn others_with_path<'a>(
        &'a self,
        sources: &'a [bun_ast::Source],
        path: &'a [u8],
        source_index: u32,
    ) -> impl Iterator<Item = u32> + 'a {
        let mut next = self
            .newest
            .get(&bun_wyhash::hash(path))
            .copied()
            .unwrap_or(u32::MAX);
        core::iter::from_fn(move || {
            while next != u32::MAX {
                let index = next;
                next = self.older[index as usize];
                if index != source_index && sources[index as usize].path.text == path {
                    return Some(index);
                }
            }
            None
        })
    }
}

impl RequestedExports {
    /// `get_or_put`-shaped entry on the dense `Vec<Option<Self>>` storage.
    /// Returns `(found_existing, &mut value)`; inserts `Default` when absent.
    #[inline]
    fn entry(map: &mut Vec<Option<Self>>, idx: u32) -> (bool, &mut Self) {
        let i = idx as usize;
        if i >= map.len() {
            map.resize_with(i + 1, || None);
        }
        let slot = &mut map[i];
        let found = slot.is_some();
        (found, slot.get_or_insert_with(Self::default))
    }

    #[inline]
    fn lookup(map: &[Option<Self>], idx: u32) -> Option<&Self> {
        map.get(idx as usize).and_then(Option::as_ref)
    }

    /// Adds what `other` requests. Returns the number of names that are new.
    fn add(&mut self, other: &Self) -> Result<usize, AllocError> {
        let RequestedExports::Partial(kept) = self else {
            return Ok(0);
        };
        let mut added = 0;
        match other {
            RequestedExports::All => *self = RequestedExports::All,
            RequestedExports::Partial(names) => {
                for name in names.keys() {
                    added += !kept.get_or_put(name)?.found_existing as usize;
                }
            }
        }
        Ok(added)
    }
}

// `original_alias` is stored as the raw arena `*const [u8]` (the
// `NamedImport.alias` representation) instead of a tied `&'a [u8]` so the BFS
// loop can hold a `BarrelExportResolution` across a `&mut graph.ast` reborrow
// without the borrow checker seeing an overlap. The pointee outlives the
// bundler arena, so dereferencing later is sound.
struct BarrelExportResolution {
    import_record_index: u32,
    /// The original alias in the source module (e.g. "d" for `export { d as c }`)
    original_alias: Option<bun_ast::StoreStr>,
    /// True when the underlying import is `import * as ns` — propagation
    /// through this export must treat the target as needing all exports.
    alias_is_star: bool,
}

/// Look up an export name → import_record_index by chasing
/// named_exports[alias].ref through named_imports.
/// Also returns the original alias from the source module for BFS propagation.
fn resolve_barrel_export(
    alias: &[u8],
    named_exports: &JSAst::NamedExports,
    named_imports: &JSAst::NamedImports,
) -> Option<BarrelExportResolution> {
    let export_entry = named_exports.get(alias)?;
    let import_entry = named_imports.get(&export_entry.ref_)?;
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
pub(crate) fn apply_barrel_optimization(
    this: &mut BundleV2,
    parse_result: &mut parse_task::Result,
) {
    // bun.handleOom: Rust aborts on OOM via the global arena; unwrap is for
    // bun_collections ops that still surface AllocError.
    apply_barrel_optimization_impl(this, parse_result).expect("OOM");
}

fn apply_barrel_optimization_impl(
    this: &mut BundleV2,
    parse_result: &mut parse_task::Result,
) -> Result<(), AllocError> {
    let parse_task::ResultValue::Success(result) = &mut parse_result.value else {
        return Ok(());
    };
    let source_index = result.source.index.0;

    let is_explicit = if let Some(oi) = this.transpiler().options.optimize_imports {
        oi.map.contains(result.package_name.slice())
    } else {
        false
    };
    let is_side_effects_false =
        result.side_effects == bun_ast::SideEffects::NoSideEffectsPackageJson;
    if !is_explicit && !is_side_effects_false {
        return Ok(());
    }
    // An entry point's exports are the public interface of the build. No file
    // imports an entry point, so nothing seeds `requested_exports` for it and a
    // deferred record would never be un-deferred. The linked output would then
    // emit the export clause with the re-exported bindings shaken away.
    if this
        .graph
        .entry_points
        .iter()
        .any(|ep| ep.get() == source_index)
    {
        // Dev server: a saved file is an entry point too. A kept record tells what its importers request.
        let Some(dev) = this.dev_server_handle() else {
            return Ok(());
        };
        // SAFETY: see the read of `tracked_barrels` below.
        let tracked = unsafe { &*dev.tracked_barrels() };
        let side = result.ast.target.bake_graph().side();
        if !tracked.any_kept()
            || tracked
                .kept_for(side, result.source.path.text, result.use_directive)
                .next()
                .is_none()
        {
            return Ok(());
        }
    }

    let ast = &mut result.ast;
    if ast.import_records.len() == 0 {
        return Ok(());
    }
    if ast.named_exports.count() == 0 && ast.export_star_import_records.len() == 0 {
        return Ok(());
    }

    // Verify pure barrel: all named exports must be re-exports
    for entry in ast.named_exports.values() {
        if ast.named_imports.get(&entry.ref_).is_none() {
            return Ok(());
        }
    }

    // If this barrel is a star target of another barrel, can't safely defer
    if this.graph.input_files.items_flags()[source_index as usize]
        .contains(InputFileFlags::IS_EXPORT_STAR_TARGET)
    {
        return Ok(());
    }

    // Check requested_exports to see which exports were already requested by
    // files parsed before this barrel. scheduleBarrelDeferredImports records
    // requests eagerly as each file is processed, so we don't need to scan
    // the graph.
    let requested = match RequestedExports::lookup(&this.requested_exports, source_index) {
        Some(RequestedExports::All) => return Ok(()), // import * already seen — load everything
        Some(RequestedExports::Partial(partial)) => Some(partial),
        None => None,
    };

    // Build the set of needed import_record_indices from already-requested
    // export names. Export * records are always needed.
    let mut needed_records: ArrayHashMap<u32, ()> = ArrayHashMap::default();

    for record_idx in ast.export_star_import_records.iter() {
        needed_records.put(*record_idx, ())?;
    }

    if let Some(partial) = requested {
        for key in partial.keys() {
            if let Some(resolution) =
                resolve_barrel_export(key, &ast.named_exports, &ast.named_imports)
            {
                needed_records.put(resolution.import_record_index, ())?;
            }
        }
    }

    // Dev server: also include exports persisted from previous builds. This
    // handles the case where file A imports Alpha from the barrel (previous
    // build) and file B adds Beta (current build). Without this, Alpha would
    // be re-deferred because only B's requests are in requested_exports.
    // `DevServerHandle` is `Copy`; copied out so the `&self` borrow
    // doesn't conflict with later `&mut this.requested_exports`.
    let dev_handle = this.dev_server_handle().copied();
    let side = ast.target.bake_graph().side();
    if let Some(dev) = dev_handle {
        // A file that was not there to read has a second index: count the requests under the first.
        let sources = this.graph.input_files.items_source();
        this.sources_by_path.index_new_sources(sources)?;
        for other in
            this.sources_by_path
                .others_with_path(sources, result.source.path.text, source_index)
        {
            let Some(requested) = RequestedExports::lookup(&this.requested_exports, other) else {
                continue;
            };
            if copy_side(this, other).is_some_and(|other_side| other_side != side) {
                continue;
            }
            match requested {
                RequestedExports::All => return Ok(()),
                RequestedExports::Partial(partial) => {
                    for key in partial.keys() {
                        if let Some(resolution) =
                            resolve_barrel_export(key, &ast.named_exports, &ast.named_imports)
                        {
                            needed_records.put(resolution.import_record_index, ())?;
                        }
                    }
                }
            }
        }

        // SAFETY: the DevServer owns `tracked_barrels` and outlives the bundle. Only the JS thread
        // writes it, and no reference from this pointer is held across a call into the DevServer.
        let tracked = unsafe { &*dev.tracked_barrels() };
        let path = result.source.path.text;
        // False: the record requests every export.
        let mut count = |persisted: &RequestedExports| -> Result<bool, AllocError> {
            let RequestedExports::Partial(names) = persisted else {
                return Ok(false);
            };
            for alias in names.keys() {
                if let Some(resolution) =
                    resolve_barrel_export(alias, &ast.named_exports, &ast.named_imports)
                {
                    needed_records.put(resolution.import_record_index, ())?;
                }
            }
            Ok(true)
        };
        let entry = tracked.get(side, path);
        if let Some(entry) = entry
            && !count(entry)?
        {
            return Ok(());
        }
        let is_tracked = entry.is_some();
        let mut every_export = false;
        if tracked.any_kept() {
            for kept in tracked.kept_for(side, path, result.use_directive) {
                if !count(kept)? {
                    every_export = true;
                    break;
                }
            }
        }
        if every_export {
            // With an entry, each later build parses this path. The server and the SSR copy share one
            // graph record, and it can call a copy bundled that no build made.
            if side == bake_types::Side::Server && this.has_ssr_graph() {
                // SAFETY: see above. No reference from the read above is used after this write.
                *unsafe { &mut *dev.tracked_barrels() }.by_side[side as usize]
                    .get_or_put(path)?
                    .value_ptr = RequestedExports::All;
            }
            return Ok(());
        }
        // Bundled and not tracked: no copy deferred a record, and no build recorded a request.
        if !is_tracked && dev.has_file(result.source.path.key_for_incremental_graph(), side) {
            return Ok(());
        }
    }

    // When HMR is active, ConvertESMExportsForHmr deduplicates import records
    // by path — two `export { ... } from './utils.js'` blocks get merged into
    // one record. The surviving record might be the one barrel optimization
    // would mark as unused (its exports not needed), while the other record
    // (whose exports ARE needed) gets marked unused by HMR dedup. To prevent
    // both records from ending up unused, promote needed_records to cover ALL
    // import records that share a path with any needed record.
    if dev_handle.is_some() {
        // Collect paths of needed records.
        let mut needed_paths: StringArrayHashMap<()> = StringArrayHashMap::default();

        for rec_idx in needed_records.keys() {
            if (*rec_idx as usize) < ast.import_records.len() {
                needed_paths.put(
                    ast.import_records.as_slice()[*rec_idx as usize].path.text,
                    (),
                )?;
            }
        }

        // Add all records sharing a needed path to the needed set.
        for entry in ast.named_exports.values() {
            if let Some(imp) = ast.named_imports.get(&entry.ref_) {
                if (imp.import_record_index as usize) < ast.import_records.len() {
                    if needed_paths.contains(
                        ast.import_records.as_slice()[imp.import_record_index as usize]
                            .path
                            .text,
                    ) {
                        needed_records.put(imp.import_record_index, ())?;
                    }
                }
            }
        }
    }

    // Defer unneeded named re-export records: is_unused keeps them out of
    // resolution and linking, is_barrel_deferred lets un_defer_record tell them
    // from the records the parser marked is_unused.
    let mut has_deferrals = false;
    // Borrowck: collect (ref_, import_record_index)
    // pairs first so we can mutate `ast.import_records` without aliasing
    // `ast.named_exports`/`ast.named_imports`.
    for i in 0..ast.named_exports.count() {
        let entry = ast.named_exports.values()[i];
        if let Some(imp) = ast.named_imports.get(&entry.ref_) {
            let iri = imp.import_record_index;
            if !needed_records.contains(&iri) {
                if (iri as usize) < ast.import_records.len() {
                    ast.import_records.as_mut_slice()[iri as usize]
                        .flags
                        .insert(
                            import_record::Flags::IS_UNUSED
                                | import_record::Flags::IS_BARREL_DEFERRED,
                        );
                    has_deferrals = true;
                }
            }
        }
    }

    if has_deferrals {
        bun_core::scoped_log!(
            barrel,
            "barrel detected: {} (source={}, {} deferred, {} needed)",
            bstr::BStr::new(if !result.package_name.is_empty() {
                result.package_name.slice()
            } else {
                result.source.path.text
            }),
            source_index,
            ast.named_exports
                .count()
                .saturating_sub(needed_records.count()),
            needed_records.count(),
        );

        // Merge with existing entry (keep already-requested names) or create new
        let _ = RequestedExports::entry(&mut this.requested_exports, source_index);
    }

    if has_deferrals && let Some(dev) = dev_handle {
        // SAFETY: see the read of `tracked_barrels` above.
        unsafe { &mut *dev.tracked_barrels() }.by_side[side as usize]
            .get_or_put(result.source.path.text)?;
    }

    Ok(())
}

/// Dev server: the side of the copy with this source index. `None`: the file was not there to read.
pub(crate) fn copy_side(this: &BundleV2, source_index: u32) -> Option<bake_types::Side> {
    let index = source_index as usize;
    if this.graph.ast.items_parts()[index].len() != 0 {
        return Some(this.graph.ast.items_target()[index].bake_graph().side());
    }
    // A copy that did not parse has no target: the path map that still has it tells the side.
    let path = this.graph.input_files.items_source()[index].path.text;
    this.graph
        .build_graphs
        .iter()
        .find_map(|(target, path_to_source_index)| {
            (path_to_source_index.get(path) == Some(source_index))
                .then(|| target.bake_graph().side())
        })
}

/// Dev server: keeps what this build requested from a copy that it did not bundle. The importers of the
/// copy are bundled, so no later build repeats these requests.
fn keep_requests_of_copy(
    this: &BundleV2,
    tracked: &mut TrackedBarrels,
    index: u32,
    side: bake_types::Side,
) -> Result<(), AllocError> {
    let requested = RequestedExports::lookup(&this.requested_exports, index);
    // A saved file that no file of this build imports has no new importer.
    if requested.is_none() && this.graph.entry_points.iter().any(|ep| ep.get() == index) {
        return Ok(());
    }
    // Also with no name requested: a saved barrel defers only if it has a record.
    let path = this.graph.input_files.items_source()[index as usize]
        .path
        .text;
    let kept = tracked.kept[side as usize].get_or_put(path)?.value_ptr;
    if let Some(requested) = requested {
        kept.add(requested)?;
    }
    Ok(())
}

/// Dev server: a copy that has parts failed to print, after the build kept the requests of its other
/// failed copies.
pub fn keep_requests_of_unprinted_copy(
    this: &BundleV2,
    tracked: &mut TrackedBarrels,
    index: u32,
) -> Result<(), AllocError> {
    let side = this.graph.ast.items_target()[index as usize]
        .bake_graph()
        .side();
    keep_requests_of_copy(this, tracked, index, side)?;
    // A request under the generated copy of a client component boundary is for the original file.
    let boundaries = this.graph.server_component_boundaries.slice();
    for (&original, &generated) in boundaries
        .list
        .items_source_index()
        .iter()
        .zip(boundaries.list.items_reference_source_index())
    {
        if original == index
            && let Some(requested) = RequestedExports::lookup(&this.requested_exports, generated)
        {
            let path = this.graph.input_files.items_source()[index as usize]
                .path
                .text;
            tracked.kept[side as usize]
                .get_or_put(path)?
                .value_ptr
                .add(requested)?;
        }
    }
    Ok(())
}

/// Dev server, once per build: adds the requests of this build to `TrackedBarrels`.
pub(crate) fn persist_requests_of_tracked_barrels(
    this: &BundleV2,
    dev: &crate::dispatch::DevServerHandle,
) -> Result<(), AllocError> {
    // SAFETY: see the read of `tracked_barrels` in `apply_barrel_optimization_impl`.
    let tracked = unsafe { &mut *dev.tracked_barrels() };
    for &(index, side) in &this.unbundled_copies {
        keep_requests_of_copy(this, tracked, index, side)?;
    }
    if tracked.by_side.iter().all(|barrels| barrels.is_empty()) {
        return Ok(());
    }
    let sources = this.graph.input_files.items_source();
    let mut lookups: usize = 0;
    let mut names_added: usize = 0;
    // By source index: the path maps can point a path at another copy within a build.
    for (index, requested) in this.requested_exports.iter().enumerate() {
        let Some(requested) = requested else {
            continue;
        };
        let side = copy_side(this, index as u32);
        for (barrels_side, barrels) in tracked.by_side.iter_mut().enumerate() {
            if barrels.is_empty() || side.is_some_and(|side| side as usize != barrels_side) {
                continue;
            }
            lookups += 1;
            if let Some(kept) = barrels.get_mut(sources[index].path.text) {
                names_added += kept.add(requested)?;
            }
        }
    }
    // A request under the generated copy of a client component boundary is for the original file.
    let boundaries = this.graph.server_component_boundaries.slice();
    for (&original, &generated) in boundaries
        .list
        .items_source_index()
        .iter()
        .zip(boundaries.list.items_reference_source_index())
    {
        let Some(requested) = RequestedExports::lookup(&this.requested_exports, generated) else {
            continue;
        };
        let Some(side) = copy_side(this, original) else {
            continue;
        };
        lookups += 1;
        if let Some(kept) =
            tracked.by_side[side as usize].get_mut(sources[original as usize].path.text)
        {
            names_added += kept.add(requested)?;
        }
    }
    bun_core::scoped_log!(
        barrel,
        "persisted requests of tracked barrels: {} lookups, {} names added",
        lookups,
        names_added,
    );
    Ok(())
}

/// Make a record that `apply_barrel_optimization` deferred live again. Returns true if the
/// record was un-deferred. A record that is is_unused for another reason (an unused
/// TypeScript import, a macro import, an HMR duplicate) is not deferred and stays as it is.
fn un_defer_record(import_records: &mut import_record::List, record_idx: usize) -> bool {
    if record_idx >= import_records.len() {
        return false;
    }
    let rec = &mut import_records.as_mut_slice()[record_idx];
    if !rec.flags.contains(import_record::Flags::IS_BARREL_DEFERRED) {
        return false;
    }
    rec.flags
        .remove(import_record::Flags::IS_UNUSED | import_record::Flags::IS_BARREL_DEFERRED);
    true
}

/// The record's patched source_index, or (dev server, where indices are left
/// unset on import records) a path-map lookup.
#[inline]
fn record_target(
    rec: &bun_ast::ImportRecord,
    map: Option<bun_ptr::BackRef<crate::PathToSourceIndexMap::PathToSourceIndexMap>>,
) -> Option<u32> {
    if rec.source_index.is_valid() {
        return Some(rec.source_index.get());
    }
    map?.get_path(&rec.path)
}

/// The export names the result of `import()` / `require()` record `idx` can
/// be read by, when the parser accounted for every use of it: the names read
/// off it, and the one the call itself reads (`await` reads `then`; `require()`
/// of an ES module returns its `module.exports` export). `None`: every export.
fn call_reads(
    uses: &bun_ast::ast_result::DynamicImportAliases,
    dev_server: bool,
    idx: usize,
    kind: ImportKind,
) -> Option<impl Iterator<Item = &'static [u8]>> {
    if dev_server {
        return None;
    }
    let dynamic_use = uses.get(&(idx as u32))?;
    let implicit: &'static [u8] = if kind == ImportKind::Require {
        b"module.exports"
    } else {
        b"then"
    };
    Some(
        dynamic_use
            .aliases
            .slice()
            .iter()
            .map(|alias| alias.slice())
            .chain(core::iter::once(implicit)),
    )
}

/// BFS work queue item: un-defer an export from a barrel.
// `'a` borrows arena-backed AST alias strings.
struct BarrelWorkItem<'a> {
    barrel_source_index: u32,
    alias: &'a [u8],
    is_star: bool,
}

/// Resolve the records the BFS just un-deferred in one barrel (`un_deferred`,
/// ascending indices), schedule their modules, and patch their source indices.
fn resolve_barrel_records(this: &mut BundleV2, barrel_idx: u32, un_deferred: &[u32]) -> i32 {
    let idx = barrel_idx as usize;
    let target = this.graph.ast.items_target()[idx];
    let loader = this.graph.input_files.items_loader()[idx];
    // Move the column cells out so the `&mut self` method calls below don't
    // alias borrows into `graph.ast` / `graph.input_files`.
    let heap = this.graph.heap;
    let mut barrel_ir = core::mem::replace(
        &mut this.graph.ast.items_import_records_mut()[idx],
        bun_alloc::ArenaVec::new_in(heap),
    );
    let source = core::mem::take(&mut this.graph.input_files.items_source_mut()[idx]);
    let source_path: &'static [u8] = source.path.text;

    let resolve_result = this.resolve_import_records(&mut ResolveImportRecordCtx {
        import_records: &mut barrel_ir,
        source: &source,
        loader,
        target,
        only_records: Some(un_deferred),
    });

    this.graph.input_files.items_source_mut()[idx] = source;

    let scheduled = this.process_resolve_queue(&resolve_result.resolve_queue, target, barrel_idx);

    this.patch_import_record_source_indices(
        &mut barrel_ir,
        PatchImportRecordsCtx {
            source_index: Index::init(barrel_idx),
            source_path,
            loader,
            target,
            only_records: Some(un_deferred),
            ..Default::default()
        },
    );

    this.graph.ast.items_import_records_mut()[idx] = barrel_ir;

    scheduled
}

/// After a new file's import records are patched with source_indices,
/// record what this file requests from each target in requested_exports
/// (eagerly, before barrels are known), then BFS through barrel chains
/// to un-defer needed records. Each un-deferred record is resolved at once
/// through resolveImportRecords (same path as initial resolution), so the BFS
/// can continue into the module it points at.
/// Returns the number of newly scheduled parse tasks.
pub(crate) fn schedule_barrel_deferred_imports(
    this: &mut BundleV2,
    result_source_index: u32,
    result_ast_target: bun_ast::Target,
) -> Result<i32, AllocError> {
    // `result.ast` is *moved*
    // into `graph.ast` before this fn runs, so this fn reads the just-written
    // `graph.ast[result_source_index]`. Phase 1/2 only read
    // `import_records` / `named_imports` for THIS index; the BFS (Phase 3)
    // takes fresh `&mut graph.ast` borrows after these raw reads are dead.
    //
    // `graph.ast` SoA columns are not reallocated for the duration of this fn
    // (no `graph.ast.append`/`set`); `items_*_mut()` in the BFS only re-slices
    // the existing backing. The backrefs below are dereferenced only during
    // Phase 1/2 (queue seeding), strictly before the BFS takes any `&mut` to
    // the same column. `BackRef` detaches the borrowck lifetime so later
    // `&mut this.*` borrows don't conflict.
    let file_import_records: bun_ptr::BackRef<import_record::List> =
        bun_ptr::BackRef::new(&this.graph.ast.items_import_records()[result_source_index as usize]);
    let file_named_imports: bun_ptr::BackRef<JSAst::NamedImports> =
        bun_ptr::BackRef::new(&this.graph.ast.items_named_imports()[result_source_index as usize]);
    let file_dynamic_uses: bun_ptr::BackRef<bun_ast::ast_result::DynamicImportAliases> =
        bun_ptr::BackRef::new(
            &this.graph.ast.items_dynamic_import_aliases()[result_source_index as usize],
        );

    // `DevServerHandle` copied out so `&mut this.*` field borrows
    // don't conflict with the `&self` accessor.
    let dev_handle = this.dev_server_handle().copied();

    // Phase 1: Seed — eagerly record what this file requests from each target.
    // This runs for every file, even before any barrels are known. When a barrel
    // is later parsed, applyBarrelOptimization reads these pre-recorded requests
    // to decide which exports to keep. O(file's imports) per file.

    // In dev server mode, patchImportRecordSourceIndices skips saving source_indices
    // on import records (the dev server uses path-based identifiers instead). But
    // barrel optimization requires source_indices to seed requested_exports and to
    // BFS un-defer records. Resolve paths → source_indices here as a fallback.
    //
    // Borrowck: `path_to_source_index_map` borrows
    // `&mut this.graph`; wrap in `BackRef` so the long-lived read borrow
    // doesn't conflict with `&mut this.requested_exports` /
    // `&mut this.graph.ast` below. The map struct sits at a stable address in
    // `graph.build_graphs[target]`; `resolve_barrel_records` may grow it
    // through its own `&mut` reborrow, but no `&mut` is live when this
    // `BackRef` is dereferenced (`record_target` re-derefs fresh each call).
    let path_to_source_index_map: Option<
        bun_ptr::BackRef<crate::PathToSourceIndexMap::PathToSourceIndexMap>,
    > = if dev_handle.is_some() {
        Some(bun_ptr::BackRef::new(
            this.path_to_source_index_map(result_ast_target),
        ))
    } else {
        None
    };

    // Read-only deref — valid through Phase 2 (see the raw-read note above).
    let file_import_records = file_import_records.get();

    // Build a set of import_record_indices that have named_imports entries,
    // so we can detect bare imports (those with no specific export bindings).
    let mut named_ir_indices = AutoBitSet::init_empty(file_import_records.len())?;

    // In HMR, ConvertESMExportsForHmr deduplicates import records by path:
    // two `import { X } from 'mod'` statements become one, and the second
    // record is marked is_unused=true. resolveImportRecords then skips those
    // records, so their path.text stays as the raw specifier while the
    // surviving record's path.text becomes the resolved absolute path.
    // named_imports entries created for the dedup'd record still point at
    // its index, so the direct path lookup below fails for those entries.
    // Build a fallback: raw specifier → surviving record's resolved path
    // text, using non-unused records in this file. See #28886.
    let mut dedup_fallback: StringArrayHashMap<&'static [u8]> = StringArrayHashMap::default();
    if dev_handle.is_some() {
        for ir_probe in file_import_records.as_slice() {
            if ir_probe.flags.contains(import_record::Flags::IS_UNUSED)
                || ir_probe.flags.contains(import_record::Flags::IS_INTERNAL)
            {
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

    // Read-only deref — valid through Phase 2 (see the raw-read note above).
    for ni in file_named_imports.values() {
        if ni.import_record_index as usize >= file_import_records.len() {
            continue;
        }
        let ir = &file_import_records.as_slice()[ni.import_record_index as usize];
        // A name destructured from `import()` / `require()` is a named import
        // too, but the call needs every export (see below).
        if matches!(ir.kind, ImportKind::Require | ImportKind::Dynamic) {
            continue;
        }
        named_ir_indices.set(ni.import_record_index as usize);
        // In dev server mode, source_index may not be patched — resolve via
        // path map as a read-only fallback. Do NOT write back to the import
        // record — the dev server intentionally leaves source_indices unset
        // and other code (IncrementalGraph, printer) depends on that.
        // For dedup'd HMR records (is_unused), fall back to a sibling's
        // resolved path text since the record itself still has the raw
        // specifier in path.text.
        let resolved_path_text = if ir.flags.contains(import_record::Flags::IS_UNUSED) {
            dedup_fallback
                .get(ir.path.text)
                .copied()
                .unwrap_or(ir.path.text)
        } else {
            ir.path.text
        };
        let target = if ir.source_index.is_valid() {
            ir.source_index.get()
        } else if let Some(map) = path_to_source_index_map {
            match map.get().get(resolved_path_text) {
                Some(t) => t,
                None => continue,
            }
        } else {
            continue;
        };

        let (_, value) = RequestedExports::entry(&mut this.requested_exports, target);
        if ni.alias_is_star {
            *value = RequestedExports::All;
        } else if let Some(alias_ptr) = ni.alias {
            // SAFETY: arena-backed `*const [u8]` valid for the AST lifetime.
            let alias: &[u8] = alias_ptr.slice();
            match value {
                RequestedExports::All => {}
                RequestedExports::Partial(p) => {
                    p.put(alias, ())?;
                }
            }
        }
    }

    // Handle import records without named bindings (not in named_imports).
    // - `import "x"` (bare statement): tree-shakeable with sideEffects: false — skip.
    // - `require("x")`: synchronous, needs full module — always mark as .all.
    // - `import("x")`: returns the full module namespace at runtime — consumer
    //   can destructure or access any export. Must mark as .all. We cannot
    //   safely assume which exports will be used.
    for (idx, ir) in file_import_records.as_slice().iter().enumerate() {
        let Some(target) = record_target(ir, path_to_source_index_map) else {
            continue;
        };
        if ir.flags.contains(import_record::Flags::IS_INTERNAL) {
            continue;
        }
        if named_ir_indices.is_set(idx) {
            continue;
        }
        if ir
            .flags
            .contains(import_record::Flags::WAS_ORIGINALLY_BARE_IMPORT)
        {
            continue;
        }
        if matches!(ir.kind, ImportKind::Require | ImportKind::Dynamic) {
            // require() and import() expose the full module namespace: preserve
            // every export, unless the parser saw each name the result is read by.
            let (_, value) = RequestedExports::entry(&mut this.requested_exports, target);
            match call_reads(&file_dynamic_uses, dev_handle.is_some(), idx, ir.kind) {
                Some(names) => {
                    if let RequestedExports::Partial(p) = value {
                        for name in names {
                            p.put(name, ())?;
                        }
                    }
                }
                None => *value = RequestedExports::All,
            }
        }
    }

    // Phase 2: BFS — un-defer barrel records that are now needed.
    // Build work queue from this file's named_imports, then propagate
    // through chains of barrels. Only runs real work when barrels exist
    // (targets with deferred records).
    let mut seeded_partial_aliases: Vec<Box<[u8]>> = Vec::new();
    let mut queue: Vec<BarrelWorkItem> = Vec::new();

    // Read-only deref — valid through Phase 2 (see the raw-read note above).
    for ni in file_named_imports.values() {
        if ni.import_record_index as usize >= file_import_records.len() {
            continue;
        }
        let ir = &file_import_records.as_slice()[ni.import_record_index as usize];
        if matches!(ir.kind, ImportKind::Require | ImportKind::Dynamic) {
            continue;
        }
        let resolved_path_text = if ir.flags.contains(import_record::Flags::IS_UNUSED) {
            dedup_fallback
                .get(ir.path.text)
                .copied()
                .unwrap_or(ir.path.text)
        } else {
            ir.path.text
        };
        let ir_target = if ir.source_index.is_valid() {
            ir.source_index.get()
        } else if let Some(map) = path_to_source_index_map {
            match map.get().get(resolved_path_text) {
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
        } else if let Some(alias_ptr) = ni.alias {
            queue.push(BarrelWorkItem {
                barrel_source_index: ir_target,
                alias: alias_ptr.slice(),
                is_star: false,
            });
        }
    }

    // Add bare require/dynamic-import targets to BFS as star imports — both
    // always need the full namespace.
    for (idx, ir) in file_import_records.as_slice().iter().enumerate() {
        let Some(target) = record_target(ir, path_to_source_index_map) else {
            continue;
        };
        if ir.flags.contains(import_record::Flags::IS_INTERNAL) {
            continue;
        }
        if named_ir_indices.is_set(idx) {
            continue;
        }
        if ir
            .flags
            .contains(import_record::Flags::WAS_ORIGINALLY_BARE_IMPORT)
        {
            continue;
        }
        let should_add = ir.kind == ImportKind::Require || ir.kind == ImportKind::Dynamic;
        if should_add {
            match call_reads(&file_dynamic_uses, dev_handle.is_some(), idx, ir.kind) {
                Some(names) => {
                    for alias in names {
                        queue.push(BarrelWorkItem {
                            barrel_source_index: target,
                            alias,
                            is_star: false,
                        });
                    }
                }
                None => queue.push(BarrelWorkItem {
                    barrel_source_index: target,
                    alias: b"",
                    is_star: true,
                }),
            }
        }
    }

    // `export * from` re-exports every name of the target: request it in full.
    // (IS_EXPORT_STAR_TARGET only covers the exporter-parses-first order.)
    let star_record_indices: Vec<u32> =
        this.graph.ast.items_export_star_import_records()[result_source_index as usize].to_vec();
    for star_idx in star_record_indices {
        if star_idx as usize >= file_import_records.len() {
            continue;
        }
        let ir = &file_import_records.as_slice()[star_idx as usize];
        if ir.flags.contains(import_record::Flags::IS_INTERNAL) {
            continue;
        }
        let Some(target) = record_target(ir, path_to_source_index_map) else {
            continue;
        };
        let (found, value) = RequestedExports::entry(&mut this.requested_exports, target);
        if found && matches!(value, RequestedExports::All) {
            continue;
        }
        *value = RequestedExports::All;
        queue.push(BarrelWorkItem {
            barrel_source_index: target,
            alias: b"",
            is_star: true,
        });
    }

    // Also seed the BFS with exports previously requested from THIS file
    // that couldn't propagate because this file wasn't parsed yet.
    // This handles the case where file A requests export "d" from file B,
    // but B hadn't been parsed when A's BFS ran, so B's export * records
    // were empty and the propagation stopped.
    let this_source_index = result_source_index;
    if let Some(existing) = RequestedExports::lookup(&this.requested_exports, this_source_index) {
        match existing {
            RequestedExports::All => queue.push(BarrelWorkItem {
                barrel_source_index: this_source_index,
                alias: b"",
                is_star: true,
            }),
            RequestedExports::Partial(partial) => {
                for key in partial.keys() {
                    seeded_partial_aliases.push(key.to_vec().into_boxed_slice());
                }
            }
        }
    }
    for alias in &seeded_partial_aliases {
        queue.push(BarrelWorkItem {
            barrel_source_index: this_source_index,
            alias: &alias[..],
            is_star: false,
        });
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

    let mut newly_scheduled: i32 = 0;
    let mut qi: usize = 0;
    while qi < queue.len() {
        // Copy item fields out before pushing to `queue` later (borrowck).
        let item_barrel_idx = queue[qi].barrel_source_index;
        let item_alias = queue[qi].alias;
        let item_is_star = queue[qi].is_star;
        let barrel_idx = item_barrel_idx;

        // For BFS-propagated items (not from initial queue), use
        // requested_exports for dedup and cycle detection.
        if qi >= initial_queue_len {
            let (found, value) = RequestedExports::entry(&mut this.requested_exports, barrel_idx);
            if item_is_star {
                // Already-All barrels were propagated once; skipping here
                // terminates `export *` cycles.
                if found && matches!(value, RequestedExports::All) {
                    qi += 1;
                    continue;
                }
                *value = RequestedExports::All;
            } else {
                match value {
                    RequestedExports::All => {
                        if found {
                            qi += 1;
                            continue;
                        }
                    }
                    RequestedExports::Partial(p) => {
                        let alias_gop = p.get_or_put(item_alias)?;
                        if found && alias_gop.found_existing {
                            qi += 1;
                            continue;
                        }
                    }
                }
            }
        }

        if barrel_idx as usize >= this.graph.ast.len() {
            qi += 1;
            continue;
        }

        // Use a helper to get barrel_ir freshly each time, since
        // resolveBarrelRecords can reallocate graph.ast and invalidate pointers.
        // Re-borrow the `graph.ast` column after each mutation (borrowck).
        let barrel_ir = &mut this.graph.ast.items_import_records_mut()[barrel_idx as usize];

        if item_is_star {
            let mut un_deferred: Vec<u32> = Vec::new();
            for idx in 0..barrel_ir.len() {
                if un_defer_record(barrel_ir, idx) {
                    un_deferred.push(idx as u32);
                }
            }
            // Resolve now: propagation below needs source indices.
            if !un_deferred.is_empty() {
                newly_scheduled += resolve_barrel_records(this, barrel_idx, &un_deferred);
            }

            // A namespace request covers every export: request each
            // re-exported name from its source module and `export *` targets
            // in full, so already-parsed inner barrels un-defer too.
            struct StarPush {
                target: u32,
                alias: Option<bun_ast::StoreStr>,
                is_star: bool,
            }
            let mut pushes: Vec<StarPush> = Vec::new();
            {
                let irs = &this.graph.ast.items_import_records()[barrel_idx as usize];
                let named_exports = &this.graph.ast.items_named_exports()[barrel_idx as usize];
                let named_imports = &this.graph.ast.items_named_imports()[barrel_idx as usize];
                for entry in named_exports.values() {
                    let Some(imp) = named_imports.get(&entry.ref_) else {
                        continue;
                    };
                    if imp.import_record_index as usize >= irs.len() {
                        continue;
                    }
                    let rec = &irs.as_slice()[imp.import_record_index as usize];
                    if rec.flags.contains(import_record::Flags::IS_INTERNAL) {
                        continue;
                    }
                    let Some(target) = record_target(rec, path_to_source_index_map) else {
                        continue;
                    };
                    if imp.alias_is_star {
                        pushes.push(StarPush {
                            target,
                            alias: None,
                            is_star: true,
                        });
                    } else if imp.alias.is_some() {
                        pushes.push(StarPush {
                            target,
                            alias: imp.alias,
                            is_star: false,
                        });
                    }
                }
                for &star_idx in
                    this.graph.ast.items_export_star_import_records()[barrel_idx as usize].iter()
                {
                    if (star_idx as usize) >= irs.len() {
                        continue;
                    }
                    let rec = &irs.as_slice()[star_idx as usize];
                    if rec.flags.contains(import_record::Flags::IS_INTERNAL) {
                        continue;
                    }
                    let Some(target) = record_target(rec, path_to_source_index_map) else {
                        continue;
                    };
                    pushes.push(StarPush {
                        target,
                        alias: None,
                        is_star: true,
                    });
                }
            }
            for p in pushes {
                queue.push(BarrelWorkItem {
                    barrel_source_index: p.target,
                    // Arena-backed `StoreStr`, valid for the bundler-arena lifetime.
                    alias: match p.alias {
                        Some(a) => a.slice(),
                        None => b"",
                    },
                    is_star: p.is_star,
                });
            }
            qi += 1;
            continue;
        }

        let alias = item_alias;
        let resolution = resolve_barrel_export(
            alias,
            &this.graph.ast.items_named_exports()[barrel_idx as usize],
            &this.graph.ast.items_named_imports()[barrel_idx as usize],
        );
        let Some(resolution) = resolution else {
            // Name not in named re-exports — might come from export *.
            // Clone the small u32 slice so iterating it doesn't
            // alias the mutable `barrel_ir` borrow taken inside the loop.
            let star_records: Vec<u32> =
                this.graph.ast.items_export_star_import_records()[barrel_idx as usize].to_vec();
            for star_idx in star_records {
                let barrel_ir = &mut this.graph.ast.items_import_records_mut()[barrel_idx as usize];
                if star_idx as usize >= barrel_ir.len() {
                    continue;
                }
                if un_defer_record(barrel_ir, star_idx as usize) {
                    // Resolve now: propagation below needs the source index.
                    newly_scheduled += resolve_barrel_records(this, barrel_idx, &[star_idx]);
                }
                let star_rec_si = this.graph.ast.items_import_records()[barrel_idx as usize]
                    .as_slice()[star_idx as usize]
                    .source_index;
                if star_rec_si.is_valid() {
                    queue.push(BarrelWorkItem {
                        barrel_source_index: star_rec_si.get(),
                        alias,
                        is_star: false,
                    });
                }
            }
            qi += 1;
            continue;
        };

        let barrel_ir = &mut this.graph.ast.items_import_records_mut()[barrel_idx as usize];
        let went_live = un_defer_record(barrel_ir, resolution.import_record_index as usize);
        if went_live {
            // Resolve now: propagation below needs the source index.
            newly_scheduled +=
                resolve_barrel_records(this, barrel_idx, &[resolution.import_record_index]);
        }

        // `original_alias` is an arena-backed `StoreStr` valid for the
        // bundler-arena lifetime (see the comment on `BarrelExportResolution`).
        let propagate_alias: &[u8] = match resolution.original_alias {
            Some(p) => p.slice(),
            None => alias,
        };
        let rec_si = this.graph.ast.items_import_records()[barrel_idx as usize]
            .as_slice()
            .get(resolution.import_record_index as usize)
            .map(|rec| rec.source_index);
        if let Some(rec_si) = rec_si.filter(|si| si.is_valid()) {
            // When the barrel re-exports a namespace import (`import * as X; export { X }`),
            // propagate as a star import so the target barrel loads all exports.
            queue.push(BarrelWorkItem {
                barrel_source_index: rec_si.get(),
                alias: propagate_alias,
                is_star: resolution.alias_is_star,
            });

            // The record just went from deferred to live. Propagate every
            // other alias this barrel imports through it, exactly as Phase 1
            // seeding does for a record that is live when the barrel finishes
            // parsing. Propagating only the alias that triggered the un-defer
            // makes a downstream barrel's deferral set (and with it the
            // symbol binding the linker produces) depend on parse completion
            // order (#40657).
            if went_live {
                let named_imports = &this.graph.ast.items_named_imports()[barrel_idx as usize];
                for ni in named_imports.values() {
                    if ni.import_record_index != resolution.import_record_index {
                        continue;
                    }
                    if ni.alias_is_star {
                        queue.push(BarrelWorkItem {
                            barrel_source_index: rec_si.get(),
                            alias: b"",
                            is_star: true,
                        });
                    } else if let Some(alias_ptr) = ni.alias {
                        // Arena-backed `StoreStr`, valid for the bundler-arena lifetime.
                        queue.push(BarrelWorkItem {
                            barrel_source_index: rec_si.get(),
                            alias: alias_ptr.slice(),
                            is_star: false,
                        });
                    }
                }
            }
        }

        qi += 1;
    }

    Ok(newly_scheduled)
}

#[cfg(test)]
mod tests {
    use super::{RequestedExports, SourcesByPath, TrackedBarrels};
    use crate::UseDirective;
    use crate::bake_types::Side;
    use bun_collections::StringArrayHashMap;

    const BARREL: &[u8] = b"/node_modules/lib/index.js";

    fn names(requested: &[&[u8]]) -> RequestedExports {
        let mut map = StringArrayHashMap::default();
        for name in requested {
            map.put(name, ()).unwrap();
        }
        RequestedExports::Partial(map)
    }

    /// The names of each record that a copy reads. `None`: a record for every export.
    fn kept(
        tracked: &TrackedBarrels,
        side: Side,
        use_directive: UseDirective,
    ) -> Vec<Option<Vec<&[u8]>>> {
        tracked
            .kept_for(side, BARREL, use_directive)
            .map(|requested| match requested {
                RequestedExports::All => None,
                RequestedExports::Partial(map) => {
                    Some(map.keys().iter().map(|name| &**name).collect())
                }
            })
            .collect()
    }

    #[test]
    fn only_a_use_client_copy_in_the_client_graph_reads_the_record_of_the_other_side() {
        let mut tracked = TrackedBarrels::default();
        assert!(!tracked.any_kept());
        *tracked.kept[Side::Client as usize]
            .get_or_put(BARREL)
            .unwrap()
            .value_ptr = names(&[b"c"]);
        *tracked.kept[Side::Server as usize]
            .get_or_put(BARREL)
            .unwrap()
            .value_ptr = names(&[b"s"]);
        assert!(tracked.any_kept());

        let client: Vec<&[u8]> = vec![b"c"];
        let server: Vec<&[u8]> = vec![b"s"];
        for use_directive in [UseDirective::None, UseDirective::Server] {
            assert_eq!(
                kept(&tracked, Side::Client, use_directive),
                [Some(client.clone())]
            );
        }
        assert_eq!(
            kept(&tracked, Side::Client, UseDirective::Client),
            [Some(client), Some(server.clone())]
        );
        for use_directive in [
            UseDirective::None,
            UseDirective::Client,
            UseDirective::Server,
        ] {
            assert_eq!(
                kept(&tracked, Side::Server, use_directive),
                [Some(server.clone())]
            );
        }
    }

    #[test]
    fn keep_all_is_for_one_side_and_replaces_the_names_of_its_record() {
        let mut tracked = TrackedBarrels::default();
        *tracked.kept[Side::Server as usize]
            .get_or_put(BARREL)
            .unwrap()
            .value_ptr = names(&[b"s"]);
        tracked.keep_all(Side::Server, BARREL).unwrap();
        assert_eq!(kept(&tracked, Side::Server, UseDirective::None), [None]);
        assert_eq!(kept(&tracked, Side::Client, UseDirective::None), []);
        assert!(!tracked.must_reparse(BARREL));
    }

    fn sources(paths: &[&'static [u8]]) -> Vec<bun_ast::Source> {
        paths
            .iter()
            .map(|&text| {
                let mut source = bun_ast::Source::default();
                source.path.text = text;
                source
            })
            .collect()
    }

    fn others(index: &SourcesByPath, sources: &[bun_ast::Source], of: u32) -> Vec<u32> {
        index
            .others_with_path(sources, sources[of as usize].path.text, of)
            .collect()
    }

    #[test]
    fn sources_by_path_finds_the_other_indices_of_a_path() {
        let mut index = SourcesByPath::default();
        let mut all = sources(&[b"/p/a.js", b"/p/b.js"]);
        index.index_new_sources(&all).unwrap();
        assert_eq!(others(&index, &all, 0), [0u32; 0]);

        all.extend(sources(&[b"/p/a.js", b"/p/c.js", b"/p/a.js"]));
        index.index_new_sources(&all).unwrap();
        assert_eq!(others(&index, &all, 4), [2, 0]);
        assert_eq!(others(&index, &all, 2), [4, 0]);
        assert_eq!(others(&index, &all, 0), [4, 2]);
        assert_eq!(others(&index, &all, 1), [0u32; 0]);
        assert_eq!(others(&index, &all, 3), [0u32; 0]);
    }

    #[test]
    fn sources_by_path_keeps_two_paths_with_one_hash_apart() {
        // A 16-byte chunk that starts with wyhash's secret word zeroes the state: the next word is lost.
        const A: &[u8] = b"\xdb\x28\xb4\xa0\xd1\x7e\x03\xe7AAAAAAAA/node_modules/lib/index.js";
        const B: &[u8] = b"\xdb\x28\xb4\xa0\xd1\x7e\x03\xe7BBBBBBBB/node_modules/lib/index.js";
        assert_eq!(bun_wyhash::hash(A), bun_wyhash::hash(B));

        let all = sources(&[A, B, A]);
        let mut index = SourcesByPath::default();
        index.index_new_sources(&all).unwrap();
        assert_eq!(others(&index, &all, 2), [0]);
        assert_eq!(others(&index, &all, 1), [0u32; 0]);
    }
}
