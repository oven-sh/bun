use crate::mal_prelude::*;
use bun_ast::{Dependency, ImportKind, StmtData, StmtOrExpr};
use bun_collections::{AutoBitSet, StringHashMap};
use bun_core::perf;

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::merge_small_chunks::EntryLoadGraph;
use crate::linker_context_mod::InteropUseCounts;
use crate::options::Loader;
use crate::{Index, IndexInt, LinkerContext, WrapKind};

const NONE: u32 = u32::MAX;

/// A chunk prints its files in one order. An import cycle can make two entry points evaluate a file and a binding that
/// it reads at load in opposite orders, and then no order serves both. Such a file gets an `__esm` wrapper: it runs
/// where each entry point imports it. Returns whether a file was wrapped, which changes what is live.
pub(crate) fn wrap_contested_files(this: &mut LinkerContext) -> crate::Result<bool> {
    let _trace = perf::trace("Bundler.wrapContestedFiles");
    debug_assert!(this.graph.code_splitting);
    let Some(wrapped) = CycleAnalysis::find_files_to_wrap(this)? else {
        return Ok(false);
    };
    wrap_files_as_esm(this, &wrapped)?;
    Ok(true)
}

struct CycleAnalysis<'c, 'a> {
    c: &'c LinkerContext<'a>,
    entry_id_by_source: Vec<u32>,
    /// The sets of entry points that can each be the first to load a file (`EntryLoadGraph::load_class`).
    load_classes: Vec<AutoBitSet>,
    /// Per file: its index in `load_classes`. `NONE`: one entry point loads it, or it does not run when its chunk loads.
    load_class_ids: Vec<u32>,
    import_graph: ImportGraph,
    /// Per file: the import cycle that it is on (`NONE`: it is on none).
    cycle_ids: Vec<u32>,
    /// Per entry point: `EvalOrderWalk::order`, once a step has asked for it.
    eval_orders: Vec<Option<Vec<IndexInt>>>,
    /// Per file: the index of its first part among the parts of all files.
    part_id_offsets: Vec<u32>,
}

/// The files of one class that a cycle leads to, itself included, and where each entry point of the class runs them.
struct CycleRegion {
    /// Per file: its slot in the region, valid while `generations[file] == generation`.
    slots: Vec<u32>,
    generations: Vec<u32>,
    generation: u32,
    len: usize,
    /// Per entry point of the class, `len` ranks. The first entry point is the one that the others are compared with.
    ranks: Vec<u32>,
    /// Per slot: some entry point runs the file on the other side of another file of the region.
    is_reordered: Vec<bool>,
}

impl CycleRegion {
    fn slot_of(&self, source_index: IndexInt) -> Option<usize> {
        (self.generations[source_index as usize] == self.generation)
            .then(|| self.slots[source_index as usize] as usize)
    }

    /// Two entry points run the two files in opposite orders.
    fn is_pair_reordered(&self, a: usize, b: usize) -> bool {
        let mut ranks = self.ranks.chunks_exact(self.len);
        let first = ranks.next().is_some_and(|ranks| ranks[a] < ranks[b]);
        ranks.any(|ranks| (ranks[a] < ranks[b]) != first)
    }
}

impl<'c, 'a> CycleAnalysis<'c, 'a> {
    fn find_files_to_wrap(c: &'c LinkerContext<'a>) -> crate::Result<Option<AutoBitSet>> {
        let files_len = c.graph.files.len();
        let entry_points = c.graph.entry_points.items_source_index();
        if entry_points.len() < 2 {
            return Ok(None);
        }
        let import_graph = ImportGraph::new(c);
        let Some(cycle_ids) = import_graph.find_cycles()? else {
            return Ok(None);
        };

        let mut this = CycleAnalysis {
            c,
            entry_id_by_source: vec![NONE; files_len],
            load_classes: Vec::new(),
            load_class_ids: vec![NONE; files_len],
            import_graph,
            cycle_ids,
            eval_orders: Vec::new(),
            part_id_offsets: Vec::with_capacity(files_len),
        };
        this.eval_orders.resize_with(entry_points.len(), || None);
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            let slot = &mut this.entry_id_by_source[source_index as usize];
            if *slot == NONE {
                *slot = entry_id as u32;
            }
        }
        this.compute_load_classes()?;
        if !(0..files_len as u32).any(|file| this.is_candidate(file)) {
            return Ok(None);
        }

        let mut parts_len: u32 = 0;
        for parts in c.graph.ast.items_parts() {
            this.part_id_offsets.push(parts_len);
            parts_len += parts.len() as u32;
        }
        let reaches_state = this.find_parts_reaching_state(parts_len as usize)?;
        let mut candidates: Vec<IndexInt> = (0..files_len as u32)
            .filter(|&file| {
                this.is_candidate(file)
                    && this.load_time_parts(file).any(|part_index| {
                        this.part_dependencies(file, part_index)
                            .any(|(other, other_part, id)| {
                                reaches_state.is_set(id)
                                    || (other != file
                                        && this.is_shared_state_part(other, other_part))
                            })
                    })
            })
            .collect();
        if candidates.is_empty() {
            return Ok(None);
        }

        let mut loaders = AutoBitSet::init_empty(entry_points.len())?;
        for &file in &candidates {
            loaders.set_union(&this.load_classes[this.load_class_ids[file as usize] as usize]);
        }
        this.compute_eval_orders(&loaders);
        candidates.sort_unstable_by_key(|&file| {
            (
                this.cycle_ids[file as usize],
                this.load_class_ids[file as usize],
                file,
            )
        });
        let contested =
            this.find_contested_files(&candidates, &reaches_state, parts_len as usize)?;
        if contested.is_empty() {
            return Ok(None);
        }
        Ok(Some(this.expand_wrap_set(contested)?))
    }

    fn compute_load_classes(&mut self) -> crate::Result<()> {
        let c = self.c;
        let entry_points_len = c.graph.entry_points.len();
        let entry_bits = c.graph.files.items_entry_bits();
        let mut load_graph = EntryLoadGraph::new(c)?;
        let mut class_id_by_key: StringHashMap<u32> = StringHashMap::default();
        let mut class_id_by_bits: StringHashMap<u32> = StringHashMap::default();
        for source_index in c.graph.reachable_files.iter() {
            let file = source_index.get();
            if !c.graph.files_live.is_set(file as usize) || !is_unwrapped_js(c, file) {
                continue;
            }
            let key = &entry_bits[file as usize];
            let class = match class_id_by_key.get(key.bytes(entry_points_len)) {
                Some(&class) => class,
                None => {
                    let index = if key.count() < 2 {
                        NONE
                    } else {
                        let class = load_graph.load_class(key)?;
                        match class_id_by_bits.get(class.bytes(entry_points_len)) {
                            Some(&index) => index,
                            None => {
                                let index = self.load_classes.len() as u32;
                                class_id_by_bits.put(class.bytes(entry_points_len), index)?;
                                self.load_classes.push(class);
                                index
                            }
                        }
                    };
                    class_id_by_key.put(key.bytes(entry_points_len), index)?;
                    index
                }
            };
            self.load_class_ids[file as usize] = class;
        }
        Ok(())
    }

    /// Two entry points can each be the first to load the file.
    fn has_multiple_loaders(&self, source_index: IndexInt) -> bool {
        let class = self.load_class_ids[source_index as usize];
        class != NONE && self.load_classes[class as usize].count() > 1
    }

    /// Off a cycle, a file runs after everything that it imports, whatever loads it.
    fn is_candidate(&self, source_index: IndexInt) -> bool {
        self.cycle_ids[source_index as usize] != NONE && self.has_multiple_loaders(source_index)
    }

    /// Fills `eval_orders` for the entry points that have none yet.
    fn compute_eval_orders(&mut self, loaders: &AutoBitSet) {
        let mut walks: Vec<EvalOrderWalk> = Vec::new();
        let mut loaders = loaders.iterator::<true, true>();
        while let Some(entry_id) = loaders.next() {
            if self.eval_orders[entry_id].is_none() {
                walks.push(EvalOrderWalk {
                    entry_id,
                    is_first_loader: self
                        .load_classes
                        .iter()
                        .map(|class| class.is_set(entry_id))
                        .collect(),
                    order: Vec::new(),
                });
            }
        }
        struct Ctx<'c, 'a> {
            c: &'c LinkerContext<'a>,
            entry_id_by_source: &'c [u32],
            load_class_ids: &'c [u32],
        }
        self.c.worker_pool().each_ptr(
            Ctx {
                c: self.c,
                entry_id_by_source: &self.entry_id_by_source,
                load_class_ids: &self.load_class_ids,
            },
            |ctx: &Ctx, walk: *mut EvalOrderWalk, _: usize| {
                // SAFETY: `each_ptr` hands each task a distinct `*mut EvalOrderWalk`.
                unsafe { &mut *walk }.run(ctx.c, ctx.entry_id_by_source, ctx.load_class_ids);
            },
            &mut walks,
        );
        for walk in walks {
            self.eval_orders[walk.entry_id] = Some(walk.order);
        }
    }

    /// The part runs code, or gives a binding its value, when its file runs. A function declaration is hoisted, and the
    /// namespace objects print ahead of every file of the chunk.
    fn is_load_time_part(&self, source_index: IndexInt, part_index: u32) -> bool {
        if part_index == bun_ast::NAMESPACE_EXPORT_PART_INDEX {
            return false;
        }
        let c = self.c;
        let part =
            &c.graph.ast.items_parts()[source_index as usize].as_slice()[part_index as usize];
        let records = c.graph.ast.items_import_records()[source_index as usize].as_slice();
        let flags = c.graph.meta.items_flags();
        // An `import` of a wrapped file prints as `init_x()` or `require_x()`.
        part.import_record_indices.iter().any(|&record_index| {
            let record = &records[record_index as usize];
            record.kind == ImportKind::Stmt
                && record.source_index.is_valid()
                && flags[record.source_index.get() as usize].wrap != WrapKind::None
        }) || !part.stmts.slice().iter().all(|stmt| match &stmt.data {
            StmtData::SImport(_)
            | StmtData::SExportStar(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportClause(_)
            | StmtData::SFunction(_)
            | StmtData::SComment(_)
            | StmtData::SDirective(_)
            | StmtData::STypeScript(_)
            | StmtData::SEmpty(_) => true,
            StmtData::SExportDefault(default) => matches!(
                &default.value,
                StmtOrExpr::Stmt(stmt) if matches!(stmt.data, StmtData::SFunction(_))
            ),
            _ => false,
        })
    }

    fn load_time_parts(&self, source_index: IndexInt) -> impl Iterator<Item = u32> + '_ {
        let parts_live = &self.c.graph.parts_live[source_index as usize];
        (0..self.c.graph.ast.items_parts()[source_index as usize].len() as u32).filter(
            move |&part_index| {
                parts_live.is_set(part_index as usize)
                    && self.is_load_time_part(source_index, part_index)
            },
        )
    }

    /// The parts of unwrapped files whose bindings the part names: the file, the part, and its index among all parts.
    fn part_dependencies(
        &self,
        source_index: IndexInt,
        part_index: u32,
    ) -> impl Iterator<Item = (IndexInt, u32, usize)> + '_ {
        self.c.graph.ast.items_parts()[source_index as usize].as_slice()[part_index as usize]
            .dependencies
            .iter()
            .filter(|dependency| is_unwrapped_js(self.c, dependency.source_index.get()))
            .map(|dependency| {
                let other = dependency.source_index.get();
                (
                    other,
                    dependency.part_index,
                    (self.part_id_offsets[other as usize] + dependency.part_index) as usize,
                )
            })
    }

    /// The part gives a binding its value at load, in a file that two entry points can load first.
    fn is_shared_state_part(&self, source_index: IndexInt, part_index: u32) -> bool {
        self.has_multiple_loaders(source_index) && self.is_load_time_part(source_index, part_index)
    }

    /// The parts that reach an `is_shared_state_part` along `part_dependencies`.
    fn find_parts_reaching_state(&self, parts_len: usize) -> crate::Result<AutoBitSet> {
        let c = self.c;
        let for_each_dependency = |each: &mut dyn FnMut(usize, usize)| {
            for source_index in c.graph.reachable_files.iter() {
                let file = source_index.get();
                if !c.graph.files_live.is_set(file as usize) || !is_unwrapped_js(c, file) {
                    continue;
                }
                let parts_live = &c.graph.parts_live[file as usize];
                for part_index in 0..c.graph.ast.items_parts()[file as usize].len() as u32 {
                    if parts_live.is_set(part_index as usize) {
                        let from = (self.part_id_offsets[file as usize] + part_index) as usize;
                        for (_, _, to) in self.part_dependencies(file, part_index) {
                            each(from, to);
                        }
                    }
                }
            }
        };
        // `dependents[offsets[part]..offsets[part + 1]]`: the parts that depend on `part`.
        let mut offsets: Vec<u32> = vec![0; parts_len + 2];
        for_each_dependency(&mut |_, to| offsets[to + 2] += 1);
        for i in 2..offsets.len() {
            offsets[i] += offsets[i - 1];
        }
        let mut dependents: Vec<u32> = vec![0; offsets[parts_len + 1] as usize];
        for_each_dependency(&mut |from, to| {
            dependents[offsets[to + 1] as usize] = from as u32;
            offsets[to + 1] += 1;
        });

        let mut reaches_state = AutoBitSet::init_empty(parts_len)?;
        let mut queue: Vec<u32> = Vec::new();
        let mut mark_dependents = |id: u32, queue: &mut Vec<u32>| {
            for &dependent in
                &dependents[offsets[id as usize] as usize..offsets[id as usize + 1] as usize]
            {
                if !reaches_state.is_set(dependent as usize) {
                    reaches_state.set(dependent as usize);
                    queue.push(dependent);
                }
            }
        };
        for file in 0..c.graph.files.len() as u32 {
            if self.has_multiple_loaders(file) {
                for part_index in self.load_time_parts(file) {
                    mark_dependents(self.part_id_offsets[file as usize] + part_index, &mut queue);
                }
            }
        }
        while let Some(id) = queue.pop() {
            mark_dependents(id, &mut queue);
        }
        Ok(reaches_state)
    }

    /// The candidates that can read, when they run, a binding of a file that runs before them under one entry point and
    /// after them under another. `candidates` has the files of one cycle and one class side by side.
    fn find_contested_files(
        &self,
        candidates: &[IndexInt],
        reaches_state: &AutoBitSet,
        parts_len: usize,
    ) -> crate::Result<Vec<IndexInt>> {
        let files_len = self.c.graph.files.len();
        let mut region = CycleRegion {
            slots: vec![0; files_len],
            generations: vec![0; files_len],
            generation: 0,
            len: 0,
            ranks: Vec::new(),
            is_reordered: Vec::new(),
        };
        // Per part: the search that met it last.
        let mut visited: Vec<u32> = vec![0; parts_len];
        let mut queue: Vec<(IndexInt, u32)> = Vec::new();
        let mut contested: Vec<IndexInt> = Vec::new();
        let group_key = |file: IndexInt| {
            (
                self.cycle_ids[file as usize],
                self.load_class_ids[file as usize],
            )
        };
        for group in candidates.chunk_by(|&a, &b| group_key(a) == group_key(b)) {
            self.build_region(&mut region, group[0])?;
            if !region.is_reordered.contains(&true) {
                continue;
            }
            'files: for &source_index in group {
                let Some(index) = region
                    .slot_of(source_index)
                    .filter(|&i| region.is_reordered[i])
                else {
                    continue;
                };
                let search_id = source_index + 1;
                queue.clear();
                queue.extend(
                    self.load_time_parts(source_index)
                        .map(|part_index| (source_index, part_index)),
                );
                while let Some((file, part_index)) = queue.pop() {
                    for (other, other_part, id) in self.part_dependencies(file, part_index) {
                        if visited[id] == search_id {
                            continue;
                        }
                        visited[id] = search_id;
                        if other != source_index
                            && let Some(other_index) = region.slot_of(other)
                            && region.is_reordered[other_index]
                            && region.is_pair_reordered(index, other_index)
                            && self.is_load_time_part(other, other_part)
                        {
                            contested.push(source_index);
                            continue 'files;
                        }
                        if reaches_state.is_set(id) {
                            queue.push((other, other_part));
                        }
                    }
                }
            }
        }
        Ok(contested)
    }

    /// The region of the cycle and the class of `source_index`.
    fn build_region(&self, region: &mut CycleRegion, source_index: IndexInt) -> crate::Result<()> {
        let c = self.c;
        let class = self.load_class_ids[source_index as usize];
        region.generation += 1;
        region.len = 0;
        let mut seen = AutoBitSet::init_empty(c.graph.files.len())?;
        let mut stack = vec![source_index];
        seen.set(source_index as usize);
        while let Some(file) = stack.pop() {
            if self.load_class_ids[file as usize] == class {
                region.slots[file as usize] = region.len as u32;
                region.generations[file as usize] = region.generation;
                region.len += 1;
            }
            for &other in self.import_graph.successors(file) {
                if !seen.is_set(other as usize) {
                    seen.set(other as usize);
                    stack.push(other);
                }
            }
        }

        region.ranks.clear();
        region.is_reordered.clear();
        region.is_reordered.resize(region.len, false);
        // The region in the order of one entry point, as ranks under the first one.
        let mut sequence: Vec<u32> = Vec::with_capacity(region.len);
        let mut loaders = self.load_classes[class as usize].iterator::<true, true>();
        while let Some(entry_id) = loaders.next() {
            let first = region.ranks.len();
            region.ranks.resize(first + region.len, NONE);
            sequence.clear();
            for &file in self.eval_orders[entry_id].iter().flatten() {
                if let Some(index) = region.slot_of(file) {
                    region.ranks[first + index] = sequence.len() as u32;
                    sequence.push(index as u32);
                }
            }
            // A file is on the other side of another one when a higher rank precedes it or a lower one follows it.
            let mut max_rank = 0;
            for &index in &sequence {
                let rank = region.ranks[index as usize];
                region.is_reordered[index as usize] |= rank < max_rank;
                max_rank = max_rank.max(rank);
            }
            let mut min_rank = NONE;
            for &index in sequence.iter().rev() {
                let rank = region.ranks[index as usize];
                region.is_reordered[index as usize] |= rank > min_rank;
                min_rank = min_rank.min(rank);
            }
        }
        Ok(())
    }

    /// A wrapped file runs when some code calls it, and an unwrapped one when its chunk loads, which is earlier. So a file
    /// that imports a wrapped file is wrapped too, and so is a file that some load runs after a wrapped one.
    fn expand_wrap_set(&mut self, contested: Vec<IndexInt>) -> crate::Result<AutoBitSet> {
        let c = self.c;
        let files_len = c.graph.files.len();
        let entry_bits = c.graph.files.items_entry_bits();
        // `"sideEffects": false` vouches for the file's statements, not for the wrapped files that it calls at load.
        let has_no_load_effects = |file: IndexInt| {
            c.file_has_no_side_effects(file) && c.loading_file_has_no_side_effects(file)
        };
        let loaders_of_files = c.parse_graph().input_files.items_loader();
        let mut importers: Vec<Vec<IndexInt>> = vec![Vec::new(); files_len];
        let mut is_imported = AutoBitSet::init_empty(files_len)?;
        for source_index in c.graph.reachable_files.iter() {
            let file = source_index.get();
            // A page imports its scripts, and never gets a wrapper.
            let is_page = loaders_of_files[file as usize] == Loader::Html;
            if !is_page && !is_unwrapped_js(c, file) {
                continue;
            }
            let records = c.graph.ast.items_import_records()[file as usize].as_slice();
            let parts_live = &c.graph.parts_live[file as usize];
            for (part_index, part) in c.graph.ast.items_parts()[file as usize]
                .as_slice()
                .iter()
                .enumerate()
            {
                for &record_index in part.import_record_indices.iter() {
                    let record = &records[record_index as usize];
                    // `wrap_files_as_esm` keeps an unused `import` statement of a wrapped file.
                    if !record.source_index.is_valid()
                        || (record.kind != ImportKind::Stmt && !parts_live.is_set(part_index))
                        || c.is_external_dynamic_import(record, file)
                    {
                        continue;
                    }
                    let other = record.source_index.get();
                    if is_unwrapped_js(c, other) {
                        is_imported.set(other as usize);
                        if !is_page {
                            importers[other as usize].push(file);
                        }
                    }
                }
            }
        }

        // An entry point that no file imports is alone in its chunk, whatever this pass brings back. It is the last file of
        // its load, and prints each `init_x()` in place.
        let mut pinned = AutoBitSet::init_empty(files_len)?;
        for &file in c.graph.entry_points.items_source_index() {
            if !is_imported.is_set(file as usize) {
                pinned.set(file as usize);
            }
        }

        let mut wrapped = AutoBitSet::init_empty(files_len)?;
        for &source_index in &contested {
            wrapped.set(source_index as usize);
        }
        let mut worklist = contested;
        let mut loaders = AutoBitSet::init_empty(self.eval_orders.len())?;
        while !worklist.is_empty() {
            while let Some(source_index) = worklist.pop() {
                loaders.set_union(match self.load_class_ids[source_index as usize] {
                    NONE => &entry_bits[source_index as usize],
                    class => &self.load_classes[class as usize],
                });
                // A dropped file comes back with its wrapper, and brings the files with side effects that only it imports.
                if !c.graph.files_live.is_set(source_index as usize) {
                    for record in c.graph.ast.items_import_records()[source_index as usize].iter() {
                        if record.kind != ImportKind::Stmt || !record.source_index.is_valid() {
                            continue;
                        }
                        let other = record.source_index.get();
                        if is_unwrapped_js(c, other)
                            && !c.graph.files_live.is_set(other as usize)
                            && !c.file_has_no_side_effects(other)
                            && !wrapped.is_set(other as usize)
                        {
                            wrapped.set(other as usize);
                            worklist.push(other);
                        }
                    }
                }
                for &importer in &importers[source_index as usize] {
                    if !wrapped.is_set(importer as usize) && !pinned.is_set(importer as usize) {
                        wrapped.set(importer as usize);
                        worklist.push(importer);
                    }
                }
            }
            self.compute_eval_orders(&loaders);
            let mut loaders = loaders.iterator::<true, true>();
            while let Some(entry_id) = loaders.next() {
                let mut seen_wrapped = false;
                for &source_index in self.eval_orders[entry_id].iter().flatten() {
                    if wrapped.is_set(source_index as usize) {
                        seen_wrapped = true;
                    } else if seen_wrapped
                        && c.graph.files_live.is_set(source_index as usize)
                        && !pinned.is_set(source_index as usize)
                        && !has_no_load_effects(source_index)
                    {
                        wrapped.set(source_index as usize);
                        worklist.push(source_index);
                    }
                }
            }
        }
        Ok(wrapped)
    }
}

/// One walk from an entry point.
struct EvalOrderWalk {
    entry_id: usize,
    /// Per class: the entry point is in it, so its load can be the one that runs the files of the class.
    is_first_loader: Vec<bool>,
    /// Those files and the ones of no class, in the order in which the unbundled program evaluates them.
    order: Vec<IndexInt>,
}

impl EvalOrderWalk {
    /// The walk of `EntryWalk`.
    fn run(&mut self, c: &LinkerContext, entry_id_by_source: &[u32], load_class_ids: &[u32]) {
        #[derive(Clone, Copy)]
        enum Frame {
            Enter { source_index: IndexInt, loader: u32 },
            Leave(IndexInt),
        }
        let entry_id = self.entry_id;
        let entry_bits = c.graph.files.items_entry_bits();
        let loads = |source_index: IndexInt, loader: usize| {
            c.graph.files_live.is_set(source_index as usize)
                && entry_bits[source_index as usize].is_set(loader)
        };
        let mut order: Vec<IndexInt> = Vec::new();
        let mut seen = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.files.len()));
        let mut stack = vec![Frame::Enter {
            source_index: c.graph.entry_points.items_source_index()[entry_id],
            loader: entry_id as u32,
        }];
        while let Some(frame) = stack.pop() {
            let (source_index, loader) = match frame {
                Frame::Leave(source_index) => {
                    let class = load_class_ids[source_index as usize];
                    if is_unwrapped_js(c, source_index)
                        && (class == NONE || self.is_first_loader[class as usize])
                    {
                        order.push(source_index);
                    }
                    continue;
                }
                Frame::Enter {
                    source_index,
                    loader,
                } => (source_index, loader),
            };
            if seen.is_set(source_index as usize) {
                continue;
            }
            seen.set(source_index as usize);
            let runs = loads(source_index, entry_id) || loads(source_index, loader as usize);
            let mark = stack.len();
            for_each_edge(c, source_index, runs, |_, edge| {
                let (other, loader) = match edge {
                    Edge::Import(other) => (other, loader),
                    Edge::LoadNow(other) => (other, entry_id_by_source[other as usize]),
                    Edge::LoadLater(_) => return,
                };
                // What a wrapped file imports is wrapped.
                if is_unwrapped_js(c, other) && !seen.is_set(other as usize) {
                    stack.push(Frame::Enter {
                        source_index: other,
                        loader,
                    });
                }
            });
            stack.push(Frame::Leave(source_index));
            stack[mark..].reverse();
        }
        self.order = order;
    }
}

/// A JS file that runs when its chunk loads, if it is live.
fn is_unwrapped_js(c: &LinkerContext, source_index: IndexInt) -> bool {
    source_index != Index::RUNTIME.value()
        && c.graph.meta.items_flags()[source_index as usize].wrap == WrapKind::None
        && c.graph.ast.items_css()[source_index as usize].is_none()
        && c.parse_graph().input_files.items_loader()[source_index as usize] != Loader::Html
}

/// The unwrapped files that each unwrapped file leads to under the same load (`for_each_edge`), in evaluation order.
struct ImportGraph {
    /// `edges[offsets[file]..offsets[file + 1]]`
    offsets: Vec<u32>,
    edges: Vec<IndexInt>,
}

impl ImportGraph {
    fn new(c: &LinkerContext) -> ImportGraph {
        let files_len = c.graph.files.len();
        let mut graph = ImportGraph {
            offsets: Vec::with_capacity(files_len + 1),
            edges: Vec::new(),
        };
        for file in 0..files_len as u32 {
            graph.offsets.push(graph.edges.len() as u32);
            if is_unwrapped_js(c, file) {
                let runs = c.graph.files_live.is_set(file as usize);
                for_each_edge(c, file, runs, |_, edge| match edge {
                    Edge::Import(other) | Edge::LoadNow(other) if is_unwrapped_js(c, other) => {
                        graph.edges.push(other);
                    }
                    _ => {}
                });
            }
        }
        graph.offsets.push(graph.edges.len() as u32);
        graph
    }

    fn successors(&self, source_index: IndexInt) -> &[IndexInt] {
        &self.edges[self.offsets[source_index as usize] as usize
            ..self.offsets[source_index as usize + 1] as usize]
    }

    /// Tarjan's strongly connected components. Per file: the id of its component, `NONE` for a component of one file.
    /// `None`: every component has one file.
    fn find_cycles(&self) -> crate::Result<Option<Vec<u32>>> {
        let files_len = self.offsets.len() - 1;
        let mut index: Vec<u32> = vec![NONE; files_len];
        let mut lowlink: Vec<u32> = vec![0; files_len];
        let mut next_index: u32 = 0;
        let mut scc_stack: Vec<IndexInt> = Vec::new();
        let mut on_stack = AutoBitSet::init_empty(files_len)?;
        // Each file with the index in `edges` of its next edge.
        let mut call_stack: Vec<(IndexInt, u32)> = Vec::new();
        let mut cycle_ids: Vec<u32> = vec![NONE; files_len];
        let mut cycle_count: u32 = 0;

        for root in 0..files_len as u32 {
            if index[root as usize] != NONE || self.successors(root).is_empty() {
                continue;
            }
            let mut enter = Some(root);
            loop {
                if let Some(source_index) = enter.take() {
                    index[source_index as usize] = next_index;
                    lowlink[source_index as usize] = next_index;
                    next_index += 1;
                    scc_stack.push(source_index);
                    on_stack.set(source_index as usize);
                    call_stack.push((source_index, self.offsets[source_index as usize]));
                }
                let Some((source_index, next)) = call_stack.last_mut() else {
                    break;
                };
                let source_index = *source_index as usize;
                if *next < self.offsets[source_index + 1] {
                    let other = self.edges[*next as usize];
                    *next += 1;
                    if index[other as usize] == NONE {
                        enter = Some(other);
                    } else if on_stack.is_set(other as usize) {
                        lowlink[source_index] = lowlink[source_index].min(index[other as usize]);
                    }
                    continue;
                }
                call_stack.pop();
                if let Some(&(parent, _)) = call_stack.last() {
                    lowlink[parent as usize] = lowlink[parent as usize].min(lowlink[source_index]);
                }
                if lowlink[source_index] != index[source_index] {
                    continue;
                }
                let is_trivial = scc_stack
                    .last()
                    .is_some_and(|&last| last as usize == source_index);
                while let Some(member) = scc_stack.pop() {
                    on_stack.unset(member as usize);
                    if !is_trivial {
                        cycle_ids[member as usize] = cycle_count;
                    }
                    if member as usize == source_index {
                        break;
                    }
                }
                cycle_count += u32::from(!is_trivial);
            }
        }
        Ok((cycle_count > 0).then_some(cycle_ids))
    }
}

/// What `scan_imports_and_exports` does for a file that it wraps.
fn wrap_files_as_esm(this: &mut LinkerContext, wrapped: &AutoBitSet) -> crate::Result<()> {
    let mut name: Vec<u8> = Vec::new();
    let mut files = wrapped.iterator::<true, true>();
    while let Some(id) = files.next() {
        let source_index = id as IndexInt;
        this.graph.meta.items_flags_mut()[id].wrap = WrapKind::Esm;
        let wrapper_ref = this.graph.ast.items_wrapper_ref()[id];
        let mut wrapper_part_index = this.graph.meta.items_wrapper_part_index()[id];
        this.create_wrapper_for_file(
            WrapKind::Esm,
            wrapper_ref,
            &mut wrapper_part_index,
            source_index,
        );
        this.graph.meta.items_wrapper_part_index_mut()[id] = wrapper_part_index;

        name.clear();
        name.extend_from_slice(b"init_");
        let source = this.get_source(source_index);
        if source.identifier_name.is_empty() {
            core::fmt::Write::write_fmt(
                &mut bun_core::fmt::VecWriter(&mut name),
                format_args!("{}", source.fmt_identifier()),
            )
            .expect("infallible: VecWriter never errors");
        } else {
            name.extend_from_slice(&source.identifier_name);
        }
        let name = bun_ast::StoreStr::new(this.graph.arena().alloc_slice_copy(&name));
        // SAFETY: with code splitting the parser and `AstBuilder` give every file a wrapper symbol, and nothing else
        // borrows the symbols here.
        unsafe { this.graph.symbol_mut(wrapper_ref) }.original_name = name;

        let entry_point_part_index = this.entry_point_part_indices[id];
        if entry_point_part_index != u32::MAX {
            this.graph.ast.items_parts_mut()[id].as_mut_slice()[entry_point_part_index as usize]
                .dependencies
                .push(Dependency {
                    source_index: bun_ast::Index::source(id),
                    part_index: wrapper_part_index.get(),
                });
        }
    }

    for i in 0..this.graph.reachable_files.len() {
        let source_index = this.graph.reachable_files[i].get();
        let id = source_index as usize;
        if this.graph.ast.items_css()[id].is_some() {
            continue;
        }
        for part_index in 0..this.graph.ast.items_parts()[id].len() {
            let mut uses = InteropUseCounts::default();
            let records_len = this.graph.ast.items_parts()[id].as_slice()[part_index]
                .import_record_indices
                .len();
            for i in 0..records_len {
                let import_record_index = this.graph.ast.items_parts()[id].as_slice()[part_index]
                    .import_record_indices[i];
                let record = &this.graph.ast.items_import_records()[id].as_slice()
                    [import_record_index as usize];
                if !record.source_index.is_valid()
                    || !wrapped.is_set(record.source_index.get() as usize)
                    || this.is_external_dynamic_import(record, source_index)
                {
                    continue;
                }
                // `eval_orders` counts an `import` statement that nothing uses, as the unbundled program runs it.
                if record.kind == ImportKind::Stmt {
                    this.graph.ast.items_parts_mut()[id].as_mut_slice()[part_index]
                        .can_be_removed_if_unused = false;
                }
                let more =
                    this.bind_wrapped_import(source_index, part_index as u32, import_record_index)?;
                uses.to_esm += more.to_esm;
                uses.to_common_js += more.to_common_js;
            }
            let part = Index::part(part_index as u32);
            this.graph.generate_runtime_symbol_import_and_use(
                source_index,
                part,
                b"__toESM",
                uses.to_esm,
            )?;
            this.graph.generate_runtime_symbol_import_and_use(
                source_index,
                part,
                b"__toCommonJS",
                uses.to_common_js,
            )?;
        }
        this.bind_promise_all_helper(source_index)?;
    }
    Ok(())
}
