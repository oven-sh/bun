use crate::mal_prelude::*;
use bun_alloc::Arena;
use bun_ast::{ImportKind, ImportRecordFlags};
use bun_collections::{ArrayHashMap, AutoBitSet, MapEntry};

use crate::linker_context_mod::debug;
use crate::options::Target;
use crate::{EntryPoint, Index, LinkerContext, WrapKind};

bun_core::define_scoped_log!(debug_merge, MergeChunks, hidden);

/// `Part::can_be_removed_if_unused` (`Parser::stmts_can_be_removed_if_unused`)
/// is the parser's tree-shaking verdict, which also says "keep" for statements
/// that do nothing at the top level but must survive for other reasons:
/// `export * from` / `export {} from` (the re-exports are tracked separately),
/// the linker's empty entry-point part, and a text loader's `export default "…"`.
fn part_has_no_side_effects(part: &bun_ast::Part) -> bool {
    use bun_ast::StmtData;
    part.can_be_removed_if_unused
        || part.stmts.slice().iter().all(|stmt| match &stmt.data {
            StmtData::SImport(_)
            | StmtData::SExportStar(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportClause(_)
            | StmtData::SFunction(_)
            | StmtData::SEmpty(_) => true,
            StmtData::SLazyExport(expr) => bun_ast::expr::Tag::is_primitive_literal(expr.tag()),
            _ => false,
        })
}

impl LinkerContext<'_> {
    /// None of the file's live parts run anything at the top level:
    /// declarations only, `"sideEffects": false`, or a lazily initialized
    /// `__esm` / `__commonJS` wrapper. An entry point never qualifies (its
    /// tail runs it), nor does top-level await. A static import of a wrapped module is printed as a
    /// top-level `init_x()` / `require_x()` call in the importer, and one of
    /// an external module loads it (hoisted out of a wrapper, too); either
    /// counts as running something. An import of an unwrapped bundled file
    /// does not: that file is judged on its own.
    pub(crate) fn loading_file_has_no_side_effects(&self, source_index: u32) -> bool {
        let flags = self.graph.meta.items_flags();
        if self.graph.files.items_entry_point_kind()[source_index as usize].is_entry_point()
            || flags[source_index as usize].is_async_or_has_async_dependency
        {
            return false;
        }
        // `"sideEffects": false` vouches for the file's own statements, not
        // for what importing a wrapped or external module from it runs.
        let declared_pure = self.file_has_no_side_effects(source_index);
        let wrapped = flags[source_index as usize].wrap != WrapKind::None;
        let records = &self.graph.ast.items_import_records()[source_index as usize];
        let import_has_no_side_effects = |record: &bun_ast::ImportRecord| {
            record.flags.contains(ImportRecordFlags::IS_UNUSED)
                || match record.kind {
                    ImportKind::Stmt => {
                        if record.source_index.is_valid() {
                            wrapped
                                || flags[record.source_index.get() as usize].wrap == WrapKind::None
                        } else {
                            record
                                .flags
                                .contains(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS)
                        }
                    }
                    // A top-level `require()` runs the module unless this
                    // file's own wrapper defers it.
                    ImportKind::Require => wrapped,
                    _ => true,
                }
        };
        let parts_live = &self.graph.parts_live[source_index as usize];
        self.graph.ast.items_parts()[source_index as usize]
            .as_slice()
            .iter()
            .enumerate()
            .all(|(part_index, part)| {
                !parts_live.is_set(part_index)
                    || ((wrapped || declared_pure || part_has_no_side_effects(part))
                        && part
                            .import_record_indices
                            .iter()
                            .all(|&i| import_has_no_side_effects(&records[i as usize])))
            })
    }
}

/// The files sharing one chunk key (`File.entry_bits`).
struct Group {
    /// Summed source bytes (plus those folded in).
    size: u64,
    /// `None` once two files disagree. An entry chunk keeps its entry's side
    /// (`IS_BROWSER_CHUNK_FROM_SERVER_BUILD`), so a browser-target group must
    /// not fold into a server one.
    target: Option<Target>,
    bits: AutoBitSet,
    /// Entries whose loading implies this group is loaded. Starts as `bits`
    /// and only grows: folding adds the target's entries to everything the
    /// target newly imports. Every static dependency's `loaded` is a superset
    /// of its importer's.
    loaded: AutoBitSet,
    loaded_count: usize,
    /// Neither merged nor merged into.
    pinned: bool,
    /// Every live part of every file is side-effect free.
    pure: bool,
    /// Groups holding files that this group's live parts statically import
    /// or depend on.
    deps: Vec<usize>,
    /// `Some(target)` once folded into another group.
    merged_into: Option<usize>,
}

/// Fold `from` into `into`: `into` inherits the size, dependencies, load
/// conditions and impurity; the files are re-keyed through `resolve` at the
/// end.
fn fold(groups: &mut [Group], from: usize, into: usize) {
    let deps = core::mem::take(&mut groups[from].deps);
    let (size, pure) = (groups[from].size, groups[from].pure);
    groups[from].merged_into = Some(into);
    let (from, target) = if from < into {
        let (a, b) = groups.split_at_mut(into);
        (&a[from], &mut b[0])
    } else {
        let (a, b) = groups.split_at_mut(from);
        (&b[0], &mut a[into])
    };
    target.size += size;
    target.pure &= pure;
    target.loaded.set_union(&from.loaded);
    target.deps.extend(deps);
    target.deps.sort_unstable();
    target.deps.dedup();
    target.deps.retain(|&d| d != into);
}

/// Follow `merged_into` links to the group that now owns the files.
fn resolve(groups: &[Group], mut index: usize) -> usize {
    while let Some(into) = groups[index].merged_into {
        index = into;
    }
    index
}

/// Per-attempt scratch for `collect_newly_loaded`; `visited` is epoch-stamped
/// so each attempt resets it in O(1).
struct Scratch {
    visited: Vec<u32>,
    epoch: u32,
    stack: Vec<usize>,
    /// `candidate` plus the side-effect-free groups the target's extra entries
    /// would start loading.
    newly_loaded: Vec<usize>,
}

/// Walks `candidate`'s dependencies: each must already be loaded wherever
/// `target` is, or be side-effect free itself (the target's extra entries then
/// load it too, which only costs bytes) with dependencies that pass the same
/// test. Fills `scratch.newly_loaded`; false when a dependency with side
/// effects would be loaded earlier.
fn collect_newly_loaded(
    groups: &[Group],
    candidate: usize,
    target: usize,
    scratch: &mut Scratch,
) -> bool {
    scratch.epoch += 1;
    let epoch = scratch.epoch;
    scratch.visited[candidate] = epoch;
    scratch.visited[target] = epoch;
    scratch.stack.clear();
    scratch
        .stack
        .extend(groups[candidate].deps.iter().map(|&d| resolve(groups, d)));
    scratch.newly_loaded.clear();
    scratch.newly_loaded.push(candidate);
    let target_loaded = &groups[target].loaded;
    while let Some(d) = scratch.stack.pop() {
        if core::mem::replace(&mut scratch.visited[d], epoch) == epoch {
            continue;
        }
        let dep = &groups[d];
        if target_loaded.subset_of(&dep.loaded) {
            continue;
        }
        if !dep.pure {
            return false;
        }
        scratch.newly_loaded.push(d);
        scratch
            .stack
            .extend(dep.deps.iter().map(|&e| resolve(groups, e)));
    }
    true
}

/// Folds code-splitting chunks into other chunks where that is unobservable,
/// so fewer modules are loaded at runtime.
///
/// A chunk is keyed by the set of entry points that statically reach its files
/// (`File.entry_bits`). Two rules; the first always runs (it never makes an
/// entry load more code), the second only for chunks smaller than
/// `min_chunk_size` (summed source bytes):
///
/// 1. An `import()` entry point `D` is redundant in a key when some other entry
///    in that key is guaranteed to already be loaded whenever `D` is loaded
///    (`guaranteed` below). Keys that are equal after dropping their redundant
///    entries describe chunks that are always loaded together: with one user
///    entry `main` and a lazy `import("./x")` only reachable from `main`, the
///    `{main, x}` chunk is loaded iff `main` runs, the same as `main`'s own
///    chunk, so its files can live there and `x`'s chunk imports what it needs
///    from the `main` chunk.
/// 2. A chunk whose live parts have no top-level side effects may join a chunk
///    loaded by a superset of its entries, as long as everything it imports is
///    already loaded wherever that target is (or is side-effect free too); the
///    extra entries then carry some unused definitions, but no side effect
///    runs earlier than before. What an entry gains this way is capped
///    relative to what it already loaded.
///
/// Runs before `compute_chunks` groups files by `entry_bits`; it rewrites
/// `File.entry_bits` in place so everything downstream (chunk membership,
/// cross-chunk imports) sees the merged layout.
pub(crate) fn merge_small_chunks(
    this: &mut LinkerContext,
    temp: &Arena,
    min_chunk_size: u64,
) -> crate::Result<()> {
    let _trace = bun_core::perf::trace("Bundler.mergeSmallChunks");
    debug_assert!(this.graph.code_splitting);

    let entry_points_len = this.graph.entry_points.len();
    let sources = this.parse_graph().input_files.items_source();
    let entry_source_indices = this.graph.entry_points.items_source_index();
    let kinds = this.graph.files.items_entry_point_kind();
    let fold_pure = min_chunk_size > 0;
    if !fold_pure
        && !entry_source_indices
            .iter()
            .any(|&source_index| kinds[source_index as usize] == EntryPoint::Kind::DynamicImport)
    {
        return Ok(());
    }
    let css_asts = this.graph.ast.items_css();
    let ast_targets = this.graph.ast.items_target();
    let import_records = this.graph.ast.items_import_records();
    let parts = this.graph.ast.items_parts();
    let flags = this.graph.meta.items_flags();
    let file_entry_bits = this.graph.files.items_entry_bits();
    let files_len = this.graph.files.len();

    let entry_id_by_source: &mut [u32] = temp.alloc_slice_fill_copy(files_len, u32::MAX);
    for (entry_id, &source_index) in entry_source_indices.iter().enumerate() {
        let slot = &mut entry_id_by_source[source_index as usize];
        if *slot == u32::MAX {
            *slot = entry_id as u32;
        }
    }
    let is_dynamic_entry = |entry_id: usize| {
        kinds[entry_source_indices[entry_id] as usize] == EntryPoint::Kind::DynamicImport
    };
    let is_live_js = |source_index: u32| {
        this.graph.files_live.is_set(source_index as usize)
            && css_asts[source_index as usize].is_none()
    };

    // Which entries statically contain a live `import()` of each dynamic entry.
    let mut importer_bits: Vec<AutoBitSet> = Vec::with_capacity(entry_points_len);
    for _ in 0..entry_points_len {
        importer_bits.push(AutoBitSet::init_empty(entry_points_len)?);
    }
    // Dynamic entries some live split `require()` loads. The call
    // runs while its importer is still evaluating, so no importer is
    // guaranteed to precede the target; folding shared code into the
    // importer's chunk could place it after the call site.
    let mut required_sync = AutoBitSet::init_empty(entry_points_len)?;
    for source_index in this.graph.reachable_files.iter() {
        let source_index = source_index.get();
        if !is_live_js(source_index) {
            continue;
        }
        let records = &import_records[source_index as usize];
        let parts_live = &this.graph.parts_live[source_index as usize];
        for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }
            for &record_index in part.import_record_indices.iter() {
                let record = &records[record_index as usize];
                if !record.source_index.is_valid()
                    || !this.is_external_dynamic_import(record, source_index)
                {
                    continue;
                }
                let target_entry = entry_id_by_source[record.source_index.get() as usize];
                if target_entry == u32::MAX {
                    continue;
                }
                if record
                    .flags
                    .contains(ImportRecordFlags::CROSS_CHUNK_REQUIRE)
                {
                    required_sync.set(target_entry as usize);
                } else {
                    importer_bits[target_entry as usize]
                        .set_union(&file_entry_bits[source_index as usize]);
                }
            }
        }
    }

    // An entry whose chunk (or a chunk it imports) uses top-level await can
    // still be mid-evaluation when an `import()` it started links, so it
    // guarantees nothing: a chunk that `import()` target then imported from
    // it would wait on it forever.
    let mut awaits = AutoBitSet::init_empty(entry_points_len)?;
    for source_index in this.graph.reachable_files.iter() {
        let source_index = source_index.get();
        if is_live_js(source_index) && flags[source_index as usize].is_async_or_has_async_dependency
        {
            awaits.set_union(&file_entry_bits[source_index as usize]);
        }
    }

    // `guaranteed[D]`: entries that are already evaluated whenever the dynamic
    // entry `D` is loaded, excluding `D` itself. Greatest fixpoint of
    //   guaranteed[D] = ∩ over importers E of D: ({E} ∪ guaranteed[E])
    // where an importer is an entry that statically reaches a file holding an
    // `import()` of D. User entries are process roots, even when something
    // also `import()`s them: nothing precedes them. A dynamic entry no live
    // code imports is left alone (empty set).
    let mut guaranteed: Vec<AutoBitSet> = Vec::with_capacity(entry_points_len);
    let has_guarantors = |entry_id: usize| {
        is_dynamic_entry(entry_id)
            && !required_sync.is_set(entry_id)
            && importer_bits[entry_id].find_first_set().is_some()
    };
    for entry_id in 0..entry_points_len {
        let mut bits = AutoBitSet::init_empty(entry_points_len)?;
        if has_guarantors(entry_id) {
            bits.set_all(true);
            bits.unset(entry_id);
        }
        guaranteed.push(bits);
    }
    let mut next = AutoBitSet::init_empty(entry_points_len)?;
    loop {
        let mut changed = false;
        for (entry_id, importers) in importer_bits.iter().enumerate() {
            if !has_guarantors(entry_id) {
                continue;
            }
            next.set_all(true);
            let mut iter = importers.iterator::<true, true>();
            while let Some(importer) = iter.next() {
                if awaits.is_set(importer) {
                    next.set_all(false);
                    break;
                }
                let keep = next.is_set(importer);
                next.set_intersection(&guaranteed[importer]);
                if keep {
                    next.set(importer);
                }
            }
            next.unset(entry_id);
            if !next.eql(&guaranteed[entry_id]) {
                core::mem::swap(&mut guaranteed[entry_id], &mut next);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    // Group the live JS files by their chunk key, and the groups by their
    // load-condition class (the key with redundant dynamic entries removed).
    //
    // An entry point's own chunk neither folds nor absorbs a fold when the
    // entry point has exports: absorbing one adds the bindings other chunks
    // need to its module namespace (Rollup's `preserveEntrySignatures:
    // "exports-only"`). Chunks loaded together with it still fold into each
    // other. `--compile` keys the user entry point's module at
    // `/$bunfs/root/<outfile>` after linking (see `js_bundle_completion_task`
    // / `build_command`), so a chunk importing from that chunk would name a
    // path that no longer exists in the executable; leave those alone too.
    let export_aliases = this.graph.meta.items_sorted_and_filtered_export_aliases();
    let pin_entry_chunk = |entry_id: usize| {
        let source_index = entry_source_indices[entry_id] as usize;
        (this.options.compile_mode.is_executable() && !is_dynamic_entry(entry_id))
            || flags[source_index].wrap == WrapKind::Cjs
            || flags[source_index].needs_synthetic_default_export
            || !export_aliases[source_index].is_empty()
    };
    let group_of_file: &mut [usize] = temp.alloc_slice_fill_copy(files_len, usize::MAX);
    let mut groups: ArrayHashMap<&[u8], Group> = ArrayHashMap::new();
    let mut classes: ArrayHashMap<&[u8], (AutoBitSet, Vec<usize>)> = ArrayHashMap::new();
    for source_index in this.graph.reachable_files.iter() {
        let source_index = source_index.get();
        if !is_live_js(source_index) {
            continue;
        }
        let bits = &file_entry_bits[source_index as usize];
        let target = ast_targets[source_index as usize];
        // Only the runtime helpers a chunk uses are emitted, so its source
        // size says nothing about the chunk's; count it as free.
        let size = if source_index == Index::RUNTIME.value() {
            0
        } else {
            sources[source_index as usize].contents().len() as u64
        };
        // Loading a file earlier than before is only unobservable when none
        // of its live parts run anything at the top level.
        let wrapped = flags[source_index as usize].wrap != WrapKind::None;
        let pure = fold_pure && this.loading_file_has_no_side_effects(source_index);
        if fold_pure && !pure {
            debug_merge!(
                "not side-effect free: {}{}",
                bstr::BStr::new(sources[source_index as usize].path.text),
                if wrapped {
                    " (wrapped entry point)"
                } else {
                    ""
                },
            );
        }
        let entry = groups.entry(temp.alloc_slice_copy(bits.bytes(entry_points_len)));
        let group_index = match &entry {
            MapEntry::Occupied(entry) => entry.index(),
            MapEntry::Vacant(entry) => entry.index(),
        };
        group_of_file[source_index as usize] = group_index;
        match entry {
            MapEntry::Occupied(entry) => {
                let group = entry.into_mut();
                group.size += size;
                group.pure &= pure;
                if group.target != Some(target) {
                    group.target = None;
                }
            }
            MapEntry::Vacant(entry) => {
                // Drop each dynamic entry that some entry still in `class` is
                // guaranteed to precede; `guaranteed[d]` never contains `d`.
                let mut class = bits.clone()?;
                let mut iter = bits.iterator::<true, true>();
                while let Some(entry_id) = iter.next() {
                    if is_dynamic_entry(entry_id) && class.has_intersection(&guaranteed[entry_id]) {
                        class.unset(entry_id);
                    }
                }
                match classes.entry(temp.alloc_slice_copy(class.bytes(entry_points_len))) {
                    MapEntry::Occupied(e) => e.into_mut().1.push(group_index),
                    MapEntry::Vacant(e) => {
                        e.insert((class, vec![group_index]));
                    }
                }
                let pinned = bits.count() == 1
                    && pin_entry_chunk(bits.find_first_set().expect("one bit set"));
                entry.insert(Group {
                    size,
                    target: Some(target),
                    bits: bits.clone()?,
                    loaded: bits.clone()?,
                    loaded_count: 0,
                    pinned,
                    pure,
                    deps: Vec::new(),
                    merged_into: None,
                });
            }
        }
    }

    // An entry point's JS chunk exists even when no file is keyed by exactly
    // its bit (its own file is also reached from an `import()` target that
    // imports back from it); give its class that chunk to fold into.
    for class_index in 0..classes.count() {
        let key = classes.keys()[class_index];
        let class = &classes.values()[class_index].0;
        if class.count() != 1 || groups.contains(&key) {
            continue;
        }
        let entry_id = class.find_first_set().expect("one bit set");
        let source_index = entry_source_indices[entry_id];
        if !is_live_js(source_index) {
            continue;
        }
        let group = Group {
            size: 0,
            target: Some(ast_targets[source_index as usize]),
            bits: class.clone()?,
            loaded: class.clone()?,
            loaded_count: 0,
            pinned: pin_entry_chunk(entry_id),
            pure: false,
            deps: Vec::new(),
            merged_into: None,
        };
        classes.values_mut()[class_index].1.push(groups.count());
        groups.put(key, group)?;
    }

    // Static dependencies between groups, from the live parts' import records
    // and symbol dependencies. Only rule 2 consults them.
    for (source_index, &group_index) in group_of_file.iter().enumerate() {
        if !fold_pure {
            break;
        }
        if group_index == usize::MAX {
            continue;
        }
        let parts_live = &this.graph.parts_live[source_index];
        let deps = &mut groups.values_mut()[group_index].deps;
        for (part_index, part) in parts[source_index].as_slice().iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }
            for &record_index in part.import_record_indices.iter() {
                let record = &import_records[source_index][record_index as usize];
                if record.source_index.is_valid()
                    && !this.is_external_dynamic_import(record, source_index as u32)
                {
                    deps.push(group_of_file[record.source_index.get() as usize]);
                }
            }
            for dependency in part.dependencies.iter() {
                deps.push(group_of_file[dependency.source_index.get() as usize]);
            }
        }
    }
    for (group_index, group) in groups.values_mut().iter_mut().enumerate() {
        group.deps.sort_unstable();
        group.deps.dedup();
        group.deps.retain(|&d| d != usize::MAX && d != group_index);
    }

    // Rule 1: groups loaded under identical conditions fold into the class's
    // parent — the group keyed by exactly the reduced key (e.g. an entry
    // point's own chunk) if there is one, else the largest member. Ties break
    // on the key for determinism. A member folded into the largest-member
    // parent loses bits its files had; it still runs before they do because
    // an entry that remains in the key precedes them and imports every chunk
    // with side effects carrying its bit (`compute_cross_chunk_dependencies`).
    let mut folded_same = 0usize;
    for (class_key, (_, members)) in classes.keys().iter().zip(classes.values()) {
        let unpinned = || {
            members
                .iter()
                .copied()
                .filter(|&i| !groups.values()[i].pinned)
        };
        let Some(target_index) = unpinned().max_by(|&a, &b| {
            (groups.keys()[a] == *class_key)
                .cmp(&(groups.keys()[b] == *class_key))
                .then_with(|| groups.values()[a].size.cmp(&groups.values()[b].size))
                .then_with(|| groups.keys()[b].cmp(groups.keys()[a]))
        }) else {
            continue;
        };
        let Some(target_platform) = groups.values()[target_index].target else {
            continue;
        };
        for &member in members {
            let group = &groups.values()[member];
            if member == target_index || group.pinned || group.target != Some(target_platform) {
                continue;
            }
            fold(groups.values_mut(), member, target_index);
            folded_same += 1;
        }
    }
    if !fold_pure {
        rekey_files(this, group_of_file, groups.values())?;
        debug!(
            "mergeSmallChunks: {} chunks folded into chunks with the same load conditions",
            folded_same
        );
        return Ok(());
    }

    // A parent's extra entries now reach everything the folded members
    // imported; propagate so every dependency's `loaded` covers its
    // importer's.
    let group_count = groups.count();
    loop {
        let mut changed = false;
        for group_index in 0..group_count {
            if groups.values()[group_index].merged_into.is_some() {
                continue;
            }
            for dep_index in 0..groups.values()[group_index].deps.len() {
                let dep = resolve(
                    groups.values(),
                    groups.values()[group_index].deps[dep_index],
                );
                if dep == group_index
                    || groups.values()[group_index]
                        .loaded
                        .subset_of(&groups.values()[dep].loaded)
                {
                    continue;
                }
                let loaded = groups.values()[group_index].loaded.clone()?;
                groups.values_mut()[dep].loaded.set_union(&loaded);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    // Rule 2 (see the doc comment). Targets with the fewest extra entries are
    // preferred, then the largest. The bytes an entry gains are capped at a
    // small fraction of what it loaded to begin with, so a lean entry point
    // (a CLI's `--version` fast path) cannot end up carrying a lazily loaded
    // subsystem, and a big one does not trade the module records it saves
    // for noticeably more code to parse.
    const EXTRA_LOAD_DIVISOR: u64 = 64;
    let mut folded_pure = 0usize;
    let mut load_size: Vec<u64> = vec![0; entry_points_len];
    for group in groups.values().iter() {
        if group.merged_into.is_some() {
            continue;
        }
        let mut iter = group.loaded.iterator::<true, true>();
        while let Some(entry_id) = iter.next() {
            load_size[entry_id] += group.size;
        }
    }
    let mut extra_loaded: Vec<u64> = vec![0; entry_points_len];
    let mut gained: Vec<(usize, u64)> = Vec::new();
    // Groups loaded by each entry: a target must be loaded by every entry of
    // the candidate, so scanning the candidate's rarest entry's list suffices.
    let mut groups_by_entry: Vec<Vec<usize>> = vec![Vec::new(); entry_points_len];
    let mut scratch = Scratch {
        visited: vec![0; group_count],
        epoch: 0,
        stack: Vec::new(),
        newly_loaded: Vec::new(),
    };
    loop {
        // Sizes and load conditions change as groups absorb others; rebuild
        // the lists in preference order once per pass so the first target
        // that passes every check wins.
        for list in groups_by_entry.iter_mut() {
            list.clear();
        }
        for (group_index, group) in groups.values_mut().iter_mut().enumerate() {
            if group.merged_into.is_some() {
                continue;
            }
            group.loaded_count = group.loaded.count();
            let mut iter = group.loaded.iterator::<true, true>();
            while let Some(entry_id) = iter.next() {
                groups_by_entry[entry_id].push(group_index);
            }
        }
        for list in groups_by_entry.iter_mut() {
            list.sort_unstable_by(|&a, &b| {
                let (ga, gb) = (&groups.values()[a], &groups.values()[b]);
                ga.loaded_count
                    .cmp(&gb.loaded_count)
                    .then_with(|| gb.size.cmp(&ga.size))
                    .then_with(|| a.cmp(&b))
            });
        }
        let mut progressed = false;
        for candidate in 0..group_count {
            let c = &groups.values()[candidate];
            if c.merged_into.is_some()
                || c.pinned
                || !c.pure
                || c.size >= min_chunk_size
                || c.target.is_none()
            {
                continue;
            }
            let mut rarest: Option<usize> = None;
            let mut iter = c.loaded.iterator::<true, true>();
            while let Some(entry_id) = iter.next() {
                if rarest.is_none_or(|r| groups_by_entry[entry_id].len() < groups_by_entry[r].len())
                {
                    rarest = Some(entry_id);
                }
            }
            let Some(rarest) = rarest else {
                continue;
            };
            let chosen = groups_by_entry[rarest].iter().copied().find(|&target| {
                let t = &groups.values()[target];
                if target == candidate
                    || t.merged_into.is_some()
                    || t.pinned
                    || t.target != c.target
                    || !c.loaded.subset_of(&t.loaded)
                    || !collect_newly_loaded(groups.values(), candidate, target, &mut scratch)
                {
                    return false;
                }
                gained.clear();
                let mut iter = t.loaded.iterator::<true, true>();
                while let Some(entry_id) = iter.next() {
                    let bytes: u64 = scratch
                        .newly_loaded
                        .iter()
                        .map(|&g| &groups.values()[g])
                        .filter(|g| !g.loaded.is_set(entry_id))
                        .map(|g| g.size)
                        .sum();
                    if bytes == 0 {
                        continue;
                    }
                    if extra_loaded[entry_id] + bytes > load_size[entry_id] / EXTRA_LOAD_DIVISOR {
                        return false;
                    }
                    gained.push((entry_id, bytes));
                }
                true
            });
            if let Some(target) = chosen {
                for &(entry_id, bytes) in &gained {
                    extra_loaded[entry_id] += bytes;
                }
                let target_loaded = groups.values()[target].loaded.clone()?;
                for &g in &scratch.newly_loaded {
                    groups.values_mut()[g].loaded.set_union(&target_loaded);
                }
                // Keep a shared chunk's `bits` covering every entry that
                // statically reaches its files (route manifests read
                // `File.entry_bits` directly). A single bit is an entry
                // point's own chunk, which must stay keyed by that bit; only
                // `import()` entries it precedes can be missing there.
                if groups.values()[target].bits.count() > 1 {
                    let candidate_bits = groups.values()[candidate].bits.clone()?;
                    groups.values_mut()[target].bits.set_union(&candidate_bits);
                }
                fold(groups.values_mut(), candidate, target);
                folded_pure += 1;
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }

    rekey_files(this, group_of_file, groups.values())?;
    debug!(
        "mergeSmallChunks: {} chunks folded into chunks with the same load conditions, {} side-effect-free chunks folded into a superset (min size {} bytes)",
        folded_same, folded_pure, min_chunk_size
    );
    Ok(())
}

fn rekey_files(
    this: &mut LinkerContext,
    group_of_file: &[usize],
    groups: &[Group],
) -> crate::Result<()> {
    let file_entry_bits = this.graph.files.items_entry_bits_mut();
    for (source_index, &group_index) in group_of_file.iter().enumerate() {
        if group_index == usize::MAX {
            continue;
        }
        let bits = &groups[resolve(groups, group_index)].bits;
        if !file_entry_bits[source_index].eql(bits) {
            file_entry_bits[source_index] = bits.clone()?;
        }
    }
    Ok(())
}
