use crate::mal_prelude::*;
use bun_ast::{Dependency, ImportKind, StmtData, StmtOrExpr};
use bun_collections::{AutoBitSet, StringHashMap};
use bun_core::perf;

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::merge_small_chunks::LoadClasses;
use crate::linker_context_mod::WrappedImportUses;
use crate::options::Loader;
use crate::{Index, IndexInt, LinkerContext, WrapKind};

const NONE: u32 = u32::MAX;

/// A chunk prints its files in one order. An import cycle can make two entry points evaluate a file and a binding that
/// it reads at load in opposite orders, and then no order serves both. Such a file gets an `__esm` wrapper: it runs
/// where each entry point imports it. Returns whether a file was wrapped, which changes what is live.
pub(crate) fn wrap_contested_files(this: &mut LinkerContext) -> crate::Result<bool> {
    let _trace = perf::trace("Bundler.wrapContestedFiles");
    debug_assert!(this.graph.code_splitting);
    let Some(wrapped) = Contest::find(this)? else {
        return Ok(false);
    };
    wrap(this, &wrapped)?;
    Ok(true)
}

struct Contest<'c, 'a> {
    c: &'c LinkerContext<'a>,
    entry_id_of_file: Vec<u32>,
    /// The sets of entry points that can each be the first to load a file (`LoadClasses::class_of`).
    classes: Vec<AutoBitSet>,
    /// Per file: its index in `classes`. `NONE`: it is in the chunk of its one entry point, or it does not run when its chunk loads.
    class_of_file: Vec<u32>,
    imports: ImportGraph,
    /// Per file: the import cycle that it is on (`NONE`: it is on none).
    cycle_of_file: Vec<u32>,
    /// Per entry point: `Walk::order`, once a step has asked for it.
    orders: Vec<Option<Vec<IndexInt>>>,
    /// Per file: the index of its first part among the parts of all files.
    part_offset: Vec<u32>,
}

/// The files of one class that a cycle leads to, itself included, and where each entry point of the class runs them.
struct Region {
    /// Per file: its index in the region, when `stamp_of_file` has the stamp of the region.
    index_of_file: Vec<u32>,
    stamp_of_file: Vec<u32>,
    stamp: u32,
    len: usize,
    /// Per entry point of the class, `len` ranks. The first entry point is the one that the others are compared with.
    ranks: Vec<u32>,
    /// Per index: some entry point runs the file on the other side of another file of the region.
    moved: Vec<bool>,
}

impl Region {
    fn index_of(&self, source_index: IndexInt) -> Option<usize> {
        (self.stamp_of_file[source_index as usize] == self.stamp)
            .then(|| self.index_of_file[source_index as usize] as usize)
    }

    /// Two entry points run the two files in opposite orders.
    fn is_order_contested(&self, a: usize, b: usize) -> bool {
        let mut ranks = self.ranks.chunks_exact(self.len);
        let first = ranks.next().is_some_and(|ranks| ranks[a] < ranks[b]);
        ranks.any(|ranks| (ranks[a] < ranks[b]) != first)
    }
}

impl<'c, 'a> Contest<'c, 'a> {
    /// The files to wrap.
    fn find(c: &'c LinkerContext<'a>) -> crate::Result<Option<AutoBitSet>> {
        let files_len = c.graph.files.len();
        let entry_points = c.graph.entry_points.items_source_index();
        if entry_points.len() < 2 {
            return Ok(None);
        }
        let imports = ImportGraph::new(c);
        let Some(cycle_of_file) = imports.cycles()? else {
            return Ok(None);
        };

        let mut this = Contest {
            c,
            entry_id_of_file: vec![NONE; files_len],
            classes: Vec::new(),
            class_of_file: vec![NONE; files_len],
            imports,
            cycle_of_file,
            orders: Vec::new(),
            part_offset: Vec::with_capacity(files_len),
        };
        this.orders.resize_with(entry_points.len(), || None);
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            let slot = &mut this.entry_id_of_file[source_index as usize];
            if *slot == NONE {
                *slot = entry_id as u32;
            }
        }
        this.classify()?;
        if !(0..files_len as u32).any(|file| this.can_be_contested(file)) {
            return Ok(None);
        }

        let mut parts_len: u32 = 0;
        for parts in c.graph.ast.items_parts() {
            this.part_offset.push(parts_len);
            parts_len += parts.len() as u32;
        }
        let leads_to_state = this.parts_that_lead_to_state(parts_len as usize)?;
        let mut candidates: Vec<IndexInt> = (0..files_len as u32)
            .filter(|&file| {
                this.can_be_contested(file)
                    && this.parts_run_at_load(file).any(|part_index| {
                        this.dependencies(file, part_index)
                            .any(|(other, other_part, id)| {
                                leads_to_state.is_set(id)
                                    || (other != file && this.is_state(other, other_part))
                            })
                    })
            })
            .collect();
        if candidates.is_empty() {
            return Ok(None);
        }

        let mut loaders = AutoBitSet::init_empty(entry_points.len())?;
        for &file in &candidates {
            loaders.set_union(&this.classes[this.class_of_file[file as usize] as usize]);
        }
        this.walk(&loaders);
        candidates.sort_unstable_by_key(|&file| {
            (
                this.cycle_of_file[file as usize],
                this.class_of_file[file as usize],
                file,
            )
        });
        let contested = this.contested_files(&candidates, &leads_to_state, parts_len as usize)?;
        if contested.is_empty() {
            return Ok(None);
        }
        Ok(Some(this.files_to_wrap(contested)?))
    }

    fn classify(&mut self) -> crate::Result<()> {
        let c = self.c;
        let entry_points_len = c.graph.entry_points.len();
        let entry_bits = c.graph.files.items_entry_bits();
        let mut load_classes = LoadClasses::new(c)?;
        let mut class_of_key: StringHashMap<u32> = StringHashMap::default();
        let mut index_of_class: StringHashMap<u32> = StringHashMap::default();
        for source_index in c.graph.reachable_files.iter() {
            let file = source_index.get();
            if !c.graph.files_live.is_set(file as usize) || !is_unwrapped_js(c, file) {
                continue;
            }
            let key = &entry_bits[file as usize];
            let class = match class_of_key.get(key.bytes(entry_points_len)) {
                Some(&class) => class,
                None => {
                    let index = if key.count() < 2 {
                        NONE
                    } else {
                        let class = load_classes.class_of(key)?;
                        match index_of_class.get(class.bytes(entry_points_len)) {
                            Some(&index) => index,
                            None => {
                                let index = self.classes.len() as u32;
                                index_of_class.put(class.bytes(entry_points_len), index)?;
                                self.classes.push(class);
                                index
                            }
                        }
                    };
                    class_of_key.put(key.bytes(entry_points_len), index)?;
                    index
                }
            };
            self.class_of_file[file as usize] = class;
        }
        Ok(())
    }

    /// Two entry points can each be the first to load the file.
    fn has_two_loaders(&self, source_index: IndexInt) -> bool {
        let class = self.class_of_file[source_index as usize];
        class != NONE && self.classes[class as usize].count() > 1
    }

    /// Off a cycle, a file runs after everything that it imports, whatever loads it.
    fn can_be_contested(&self, source_index: IndexInt) -> bool {
        self.cycle_of_file[source_index as usize] != NONE && self.has_two_loaders(source_index)
    }

    /// Fills `orders` for the entry points that have none yet.
    fn walk(&mut self, loaders: &AutoBitSet) {
        let mut walks: Vec<Walk> = Vec::new();
        let mut loaders = loaders.iterator::<true, true>();
        while let Some(entry_id) = loaders.next() {
            if self.orders[entry_id].is_none() {
                walks.push(Walk {
                    entry_id,
                    loads_class_first: self
                        .classes
                        .iter()
                        .map(|class| class.is_set(entry_id))
                        .collect(),
                    order: Vec::new(),
                });
            }
        }
        struct Ctx<'c, 'a> {
            c: &'c LinkerContext<'a>,
            entry_id_of_file: &'c [u32],
            class_of_file: &'c [u32],
        }
        self.c.worker_pool().each_ptr(
            Ctx {
                c: self.c,
                entry_id_of_file: &self.entry_id_of_file,
                class_of_file: &self.class_of_file,
            },
            |ctx: &Ctx, walk: *mut Walk, _: usize| {
                // SAFETY: `each_ptr` hands each task a distinct `*mut Walk`.
                unsafe { &mut *walk }.run(ctx.c, ctx.entry_id_of_file, ctx.class_of_file);
            },
            &mut walks,
        );
        for walk in walks {
            self.orders[walk.entry_id] = Some(walk.order);
        }
    }
    /// The part runs code, or gives a binding its value, when its file runs. A function declaration is hoisted, and the
    /// namespace objects print ahead of every file of the chunk.
    fn part_runs_at_load(&self, source_index: IndexInt, part_index: u32) -> bool {
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

    /// The live parts of the file that `part_runs_at_load`.
    fn parts_run_at_load(&self, source_index: IndexInt) -> impl Iterator<Item = u32> + '_ {
        let parts_live = &self.c.graph.parts_live[source_index as usize];
        (0..self.c.graph.ast.items_parts()[source_index as usize].len() as u32).filter(
            move |&part_index| {
                parts_live.is_set(part_index as usize)
                    && self.part_runs_at_load(source_index, part_index)
            },
        )
    }

    /// The parts of unwrapped files whose bindings the part names: the file, the part, and its index among all parts.
    fn dependencies(
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
                    (self.part_offset[other as usize] + dependency.part_index) as usize,
                )
            })
    }

    /// The part gives a binding its value at load, in a file that two entry points can load first.
    fn is_state(&self, source_index: IndexInt, part_index: u32) -> bool {
        self.has_two_loaders(source_index) && self.part_runs_at_load(source_index, part_index)
    }

    /// The parts that lead to a part that `is_state` along `dependencies`.
    fn parts_that_lead_to_state(&self, parts_len: usize) -> crate::Result<AutoBitSet> {
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
                        let from = (self.part_offset[file as usize] + part_index) as usize;
                        for (_, _, to) in self.dependencies(file, part_index) {
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

        let mut leads = AutoBitSet::init_empty(parts_len)?;
        let mut queue: Vec<u32> = Vec::new();
        let mut mark_dependents = |id: u32, queue: &mut Vec<u32>| {
            for &dependent in
                &dependents[offsets[id as usize] as usize..offsets[id as usize + 1] as usize]
            {
                if !leads.is_set(dependent as usize) {
                    leads.set(dependent as usize);
                    queue.push(dependent);
                }
            }
        };
        for file in 0..c.graph.files.len() as u32 {
            if self.has_two_loaders(file) {
                for part_index in self.parts_run_at_load(file) {
                    mark_dependents(self.part_offset[file as usize] + part_index, &mut queue);
                }
            }
        }
        while let Some(id) = queue.pop() {
            mark_dependents(id, &mut queue);
        }
        Ok(leads)
    }

    /// The candidates that can read, when they run, a binding of a file that runs before them under one entry point and
    /// after them under another. `candidates` has the files of one cycle and one class side by side.
    fn contested_files(
        &self,
        candidates: &[IndexInt],
        leads_to_state: &AutoBitSet,
        parts_len: usize,
    ) -> crate::Result<Vec<IndexInt>> {
        let files_len = self.c.graph.files.len();
        let mut region = Region {
            index_of_file: vec![0; files_len],
            stamp_of_file: vec![0; files_len],
            stamp: 0,
            len: 0,
            ranks: Vec::new(),
            moved: Vec::new(),
        };
        // Per part: the search that met it last.
        let mut visited: Vec<u32> = vec![0; parts_len];
        let mut queue: Vec<(IndexInt, u32)> = Vec::new();
        let mut contested: Vec<IndexInt> = Vec::new();
        let group_of = |file: IndexInt| {
            (
                self.cycle_of_file[file as usize],
                self.class_of_file[file as usize],
            )
        };
        for group in candidates.chunk_by(|&a, &b| group_of(a) == group_of(b)) {
            self.fill_region(&mut region, group[0])?;
            if !region.moved.contains(&true) {
                continue;
            }
            'files: for &source_index in group {
                let Some(index) = region.index_of(source_index).filter(|&i| region.moved[i]) else {
                    continue;
                };
                let search = source_index + 1;
                queue.clear();
                queue.extend(
                    self.parts_run_at_load(source_index)
                        .map(|part_index| (source_index, part_index)),
                );
                while let Some((file, part_index)) = queue.pop() {
                    for (other, other_part, id) in self.dependencies(file, part_index) {
                        if visited[id] == search {
                            continue;
                        }
                        visited[id] = search;
                        if other != source_index
                            && let Some(other_index) = region.index_of(other)
                            && region.moved[other_index]
                            && region.is_order_contested(index, other_index)
                            && self.part_runs_at_load(other, other_part)
                        {
                            contested.push(source_index);
                            continue 'files;
                        }
                        if leads_to_state.is_set(id) {
                            queue.push((other, other_part));
                        }
                    }
                }
            }
        }
        Ok(contested)
    }

    /// The region of the cycle and the class of `source_index`.
    fn fill_region(&self, region: &mut Region, source_index: IndexInt) -> crate::Result<()> {
        let c = self.c;
        let class = self.class_of_file[source_index as usize];
        region.stamp += 1;
        region.len = 0;
        let mut seen = AutoBitSet::init_empty(c.graph.files.len())?;
        let mut stack = vec![source_index];
        seen.set(source_index as usize);
        while let Some(file) = stack.pop() {
            if self.class_of_file[file as usize] == class {
                region.index_of_file[file as usize] = region.len as u32;
                region.stamp_of_file[file as usize] = region.stamp;
                region.len += 1;
            }
            for &other in self.imports.edges_of(file) {
                if !seen.is_set(other as usize) {
                    seen.set(other as usize);
                    stack.push(other);
                }
            }
        }

        region.ranks.clear();
        region.moved.clear();
        region.moved.resize(region.len, false);
        // The region in the order of one entry point, as ranks under the first one.
        let mut sequence: Vec<u32> = Vec::with_capacity(region.len);
        let mut loaders = self.classes[class as usize].iterator::<true, true>();
        while let Some(entry_id) = loaders.next() {
            let first = region.ranks.len();
            region.ranks.resize(first + region.len, NONE);
            sequence.clear();
            for &file in self.orders[entry_id].iter().flatten() {
                if let Some(index) = region.index_of(file) {
                    region.ranks[first + index] = sequence.len() as u32;
                    sequence.push(index as u32);
                }
            }
            // A file is on the other side of another one when a higher rank precedes it or a lower one follows it.
            let mut highest = 0;
            for &index in &sequence {
                let rank = region.ranks[index as usize];
                region.moved[index as usize] |= rank < highest;
                highest = highest.max(rank);
            }
            let mut lowest = NONE;
            for &index in sequence.iter().rev() {
                let rank = region.ranks[index as usize];
                region.moved[index as usize] |= rank > lowest;
                lowest = lowest.min(rank);
            }
        }
        Ok(())
    }

    /// A wrapped file runs when the code of a chunk calls it, which is after every chunk that the caller imports has
    /// run. So a file that imports a wrapped file, or that some load runs after one, is wrapped too, unless it is in
    /// the chunk of its one entry point: that chunk follows the order of the entry point, calls included.
    fn files_to_wrap(&mut self, contested: Vec<IndexInt>) -> crate::Result<AutoBitSet> {
        let c = self.c;
        let files_len = c.graph.files.len();
        let mut importers: Vec<Vec<IndexInt>> = vec![Vec::new(); files_len];
        for (file, &class) in self.class_of_file.iter().enumerate() {
            if class == NONE {
                continue;
            }
            let records = c.graph.ast.items_import_records()[file].as_slice();
            let parts_live = &c.graph.parts_live[file];
            for (part_index, part) in c.graph.ast.items_parts()[file]
                .as_slice()
                .iter()
                .enumerate()
            {
                if !parts_live.is_set(part_index) {
                    continue;
                }
                for &record_index in part.import_record_indices.iter() {
                    let record = &records[record_index as usize];
                    if record.source_index.is_valid()
                        && !c.is_external_dynamic_import(record, file as u32)
                        && self.class_of_file[record.source_index.get() as usize] != NONE
                    {
                        importers[record.source_index.get() as usize].push(file as u32);
                    }
                }
            }
        }

        let mut wrapped = AutoBitSet::init_empty(files_len)?;
        for &source_index in &contested {
            wrapped.set(source_index as usize);
        }
        let mut added = contested;
        let mut loaders = AutoBitSet::init_empty(self.orders.len())?;
        while !added.is_empty() {
            while let Some(source_index) = added.pop() {
                loaders
                    .set_union(&self.classes[self.class_of_file[source_index as usize] as usize]);
                for &importer in &importers[source_index as usize] {
                    if !wrapped.is_set(importer as usize) {
                        wrapped.set(importer as usize);
                        added.push(importer);
                    }
                }
            }
            self.walk(&loaders);
            let mut loaders = loaders.iterator::<true, true>();
            while let Some(entry_id) = loaders.next() {
                let mut after_wrapped = false;
                for &source_index in self.orders[entry_id].iter().flatten() {
                    if wrapped.is_set(source_index as usize) {
                        after_wrapped = true;
                    } else if after_wrapped {
                        wrapped.set(source_index as usize);
                        added.push(source_index);
                    }
                }
            }
        }
        Ok(wrapped)
    }
}

/// One walk from an entry point.
struct Walk {
    entry_id: usize,
    /// Per class: the entry point is in it, so its load can be the one that runs the files of the class.
    loads_class_first: Vec<bool>,
    /// Those files, in the order in which the unbundled program evaluates them.
    order: Vec<IndexInt>,
}

impl Walk {
    /// The walk of `EntryWalk`.
    fn run(&mut self, c: &LinkerContext, entry_id_of_file: &[u32], class_of_file: &[u32]) {
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
                    if {
                        let class = class_of_file[source_index as usize];
                        class != NONE && self.loads_class_first[class as usize]
                    } {
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
                    Edge::LoadNow(other) => (other, entry_id_of_file[other as usize]),
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

    fn edges_of(&self, source_index: IndexInt) -> &[IndexInt] {
        &self.edges[self.offsets[source_index as usize] as usize
            ..self.offsets[source_index as usize + 1] as usize]
    }

    /// Per file: a number that the files which import their way to each other share, `NONE` for a file that does not
    /// import its way back to itself (Tarjan's strongly connected components). `None`: no file does.
    fn cycles(&self) -> crate::Result<Option<Vec<u32>>> {
        let files_len = self.offsets.len() - 1;
        // Per file: when the search entered it (`NONE`: it has not), and the earliest open file that it leads back to.
        let mut entered: Vec<u32> = vec![NONE; files_len];
        let mut low: Vec<u32> = vec![0; files_len];
        let mut ticks: u32 = 0;
        // The files whose component is not complete.
        let mut open: Vec<IndexInt> = Vec::new();
        let mut is_open = AutoBitSet::init_empty(files_len)?;
        // The files that the search is in, each with the index in `edges` of the next edge to follow.
        let mut frames: Vec<(IndexInt, u32)> = Vec::new();
        let mut cycle_of_file: Vec<u32> = vec![NONE; files_len];
        let mut cycles: u32 = 0;

        for root in 0..files_len as u32 {
            if entered[root as usize] != NONE || self.edges_of(root).is_empty() {
                continue;
            }
            let mut enter = Some(root);
            loop {
                if let Some(source_index) = enter.take() {
                    entered[source_index as usize] = ticks;
                    low[source_index as usize] = ticks;
                    ticks += 1;
                    open.push(source_index);
                    is_open.set(source_index as usize);
                    frames.push((source_index, self.offsets[source_index as usize]));
                }
                let Some((source_index, next)) = frames.last_mut() else {
                    break;
                };
                let source_index = *source_index as usize;
                if *next < self.offsets[source_index + 1] {
                    let other = self.edges[*next as usize];
                    *next += 1;
                    if entered[other as usize] == NONE {
                        enter = Some(other);
                    } else if is_open.is_set(other as usize) {
                        low[source_index] = low[source_index].min(entered[other as usize]);
                    }
                    continue;
                }
                frames.pop();
                if let Some(&(parent, _)) = frames.last() {
                    low[parent as usize] = low[parent as usize].min(low[source_index]);
                }
                if low[source_index] != entered[source_index] {
                    continue;
                }
                // The component is `source_index` and the files opened after it.
                let alone = open
                    .last()
                    .is_some_and(|&last| last as usize == source_index);
                while let Some(member) = open.pop() {
                    is_open.unset(member as usize);
                    if !alone {
                        cycle_of_file[member as usize] = cycles;
                    }
                    if member as usize == source_index {
                        break;
                    }
                }
                cycles += u32::from(!alone);
            }
        }
        Ok((cycles > 0).then_some(cycle_of_file))
    }
}

/// What `scan_imports_and_exports` does for a file that it wraps.
fn wrap(this: &mut LinkerContext, wrapped: &AutoBitSet) -> crate::Result<()> {
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
        // SAFETY: with code splitting the parser gives every file a wrapper symbol; nothing else borrows the symbols here.
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
            let mut uses = WrappedImportUses::default();
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
                let more = this.bind_import_of_wrapped_file(
                    source_index,
                    part_index as u32,
                    import_record_index,
                )?;
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
        this.bind_promise_all_of_unwrapped_file(source_index)?;
    }
    Ok(())
}
