use crate::mal_prelude::*;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, StmtData, StmtOrExpr};
use bun_collections::{AutoBitSet, HashMap, StringHashMap, VecExt};

use crate::linker_context::merge_small_chunks::part_has_no_side_effects;
use crate::options::Loader;
use crate::{Chunk, EntryPoint, Index, IndexInt, LinkerContext, PartRange, chunk, js_meta::Wrap};
use bun_core::perf;

pub(crate) fn find_all_imported_parts_in_js_order(
    this: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), crate::Error> {
    let _trace = perf::trace("Bundler.findAllImportedPartsInJSOrder");
    if chunks.is_empty() {
        return Ok(());
    }

    // With code splitting a live JS file is in exactly one chunk. The walk
    // below orders each chunk's cross-chunk imports by where it reaches the
    // files that run something when loaded; the rest (and every file without
    // code splitting) map to `u32::MAX`.
    let mut chunk_of_file: Vec<u32> = vec![u32::MAX; this.graph.files.len()];
    if this.graph.code_splitting {
        for (chunk_index, chunk) in chunks.iter().enumerate() {
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }
            for &source_index in chunk.files_with_parts_in_chunk.keys() {
                if !this.loading_file_has_no_side_effects(source_index) {
                    chunk_of_file[source_index as usize] = chunk_index as u32;
                }
            }
        }
    }

    let mut plan = WalkPlan::new(this, chunks);
    let mut walks = plan.create_walks(this);
    plan.watch = OrderWatch::new(this, chunks, &mut walks)?;
    run_walks(this, &plan, chunks, &mut walks);
    let safe_walks = plan.find_safe_walks(this, chunks, &walks);
    walks.extend(safe_walks);
    if let Some(watch) = &plan.watch {
        watch.report(this, &plan.rank, &walks);
    }
    let order = WalkOrder::collect(this, chunks.len(), walks);

    struct Ctx<'a, 'f> {
        inner: crate::linker_context_mod::GenerateChunkCtx<'a>,
        chunk_of_file: &'f [u32],
        order: &'f WalkOrder,
    }

    // One chunk per task. Each task writes only its own `Chunk` and, for
    // server-component files, that file's `entry_point_chunk_index` slot (a
    // file belongs to exactly one chunk), and reads the graph columns.
    let ctx = Ctx {
        inner: crate::linker_context_mod::GenerateChunkCtx {
            chunk: bun_ptr::BackRef::new_mut(&mut chunks[0]),
            // SAFETY: `this` is the live `&mut LinkerContext` for the link step.
            c: unsafe {
                bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(this))
            },
            chunks: bun_ptr::BackRef::new(&*chunks),
        },
        chunk_of_file: &chunk_of_file,
        order: &order,
    };
    let chunks_len = chunks.len();
    this.worker_pool().each_ptr(
        ctx,
        |ctx: &Ctx, chunk: *mut Chunk, index: usize| {
            // SAFETY: `each_ptr` hands each task a distinct `*mut Chunk`.
            let chunk = unsafe { &mut *chunk };
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                return; // CSS: `find_imported_css_files_in_js_order`; HTML: nothing
            }
            // SAFETY: shared for reading; see the note above on the one column written.
            let c: &LinkerContext = unsafe { &*ctx.inner.c.as_mut_ptr() };
            bun_core::handle_oom(find_imported_parts_in_js_order(
                c,
                chunk,
                u32::try_from(index).expect("int cast"),
                ctx.chunk_of_file,
                ctx.order,
                chunks_len,
            ));
        },
        chunks,
    );
    Ok(())
}

fn run_walks(this: &mut LinkerContext, plan: &WalkPlan, chunks: &[Chunk], walks: &mut [EntryWalk]) {
    struct WalkCtx<'a, 'f> {
        c: bun_ptr::ParentRef<LinkerContext<'a>, bun_ptr::Mut>,
        plan: &'f WalkPlan,
        chunks: &'f [Chunk],
    }
    let walk_ctx = WalkCtx {
        // SAFETY: `this` is the live `&mut LinkerContext` for the link step.
        c: unsafe { bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(this)) },
        plan,
        chunks,
    };
    this.worker_pool().each_ptr(
        walk_ctx,
        |ctx: &WalkCtx, walk: *mut EntryWalk, _: usize| {
            // SAFETY: `each_ptr` hands each task a distinct `*mut EntryWalk`.
            let walk = unsafe { &mut *walk };
            // SAFETY: the walks only read the graph.
            let c: &LinkerContext = unsafe { &*ctx.c.as_mut_ptr() };
            walk.run(c, ctx.plan, ctx.chunks);
        },
        walks,
    );
}

/// Each part range is printed as one task, so a range stops growing once it
/// spans this many source bytes and a large unwrapped file prints on several
/// threads. A constant, not derived from the thread count: range boundaries
/// reach the output (blank lines between ranges) and the chunk hash.
const RANGE_SOURCE_BYTES_MAX: i32 = 128 * 1024;

/// Lays out the chunk's files in the order its owner's `EntryWalk` placed them.
pub(crate) fn find_imported_parts_in_js_order(
    this: &LinkerContext,
    chunk: &mut Chunk,
    chunk_index: u32,
    chunk_of_file: &[u32],
    order: &WalkOrder,
    chunks_len: usize,
) -> Result<(), bun_alloc::AllocError> {
    let runs: &[PartRun] = &order.runs_of_chunk[chunk_index as usize];

    let mut layout = ChunkLayout {
        c: this,
        files: Vec::with_capacity(chunk.files_with_parts_in_chunk.count()),
        part_ranges: Vec::new(),
        parts_prefix: Vec::new(),
        namespace_objects: Vec::new(),
        chunk_index,
        // The one column written through a shared `&LinkerContext` (see `place`).
        entry_point_chunk_indices: this.graph.files.slice().split_raw().entry_point_chunk_index,
    };

    // The runtime goes first: every helper a file calls is declared above it.
    let runtime = Index::RUNTIME.value();
    if chunk.files_with_parts_in_chunk.contains(&runtime) {
        layout.place(PartRun {
            source_index: runtime,
            begin: 0,
            end: u32::MAX,
        });
    }
    for &run in runs {
        if run.source_index != runtime {
            layout.place(run);
        }
    }

    let ChunkLayout {
        files,
        part_ranges,
        parts_prefix,
        namespace_objects,
        ..
    } = layout;
    let mut parts_in_chunk_order: Vec<PartRange> =
        Vec::with_capacity(parts_prefix.len() + namespace_objects.len() + part_ranges.len());
    parts_in_chunk_order.extend_from_slice(&parts_prefix);
    parts_in_chunk_order.extend_from_slice(&namespace_objects);
    parts_in_chunk_order.extend_from_slice(&part_ranges);

    let reached_chunks = if this.graph.code_splitting {
        reached_chunks_in_order(this, chunk, chunk_index, chunk_of_file, order, chunks_len)?
    } else {
        Vec::new()
    };

    match &mut chunk.content {
        chunk::Content::Javascript(js) => {
            js.files_in_chunk_order = files.into_boxed_slice();
            js.parts_in_chunk_in_order = parts_in_chunk_order.into_boxed_slice();
            js.reached_chunks_in_order = reached_chunks.into_boxed_slice();
        }
        // Caller only invokes this for `.javascript` chunks (see
        // `find_all_imported_parts_in_js_order`).
        _ => unreachable!("findImportedPartsInJSOrder called on non-JS chunk"),
    }
    Ok(())
}

/// Parts `begin..end` of a file. They print together, ahead of the files that part `end` imports.
#[derive(Clone, Copy)]
struct PartRun {
    source_index: IndexInt,
    begin: u32,
    /// `u32::MAX`: the rest of the file. The walk leaves the file here.
    end: u32,
}

/// What the walks recorded.
pub(crate) struct WalkOrder {
    runs_of_chunk: Vec<Vec<PartRun>>,
    /// With code splitting, per file: when its walk entered it (`u32::MAX`: never).
    entered: Vec<u32>,
}

impl WalkOrder {
    fn collect(c: &LinkerContext, chunks_len: usize, walks: Vec<EntryWalk>) -> WalkOrder {
        let mut order = WalkOrder {
            runs_of_chunk: vec![Vec::new(); chunks_len],
            entered: vec![u32::MAX; c.graph.files.len()],
        };
        // A walk of `find_safe_walks` comes after the owner's, and replaces it.
        for walk in walks {
            for owned in walk.owned {
                order.runs_of_chunk[owned.chunk_index as usize] = owned.runs;
            }
            for (tick, &source_index) in walk.entered.iter().enumerate() {
                order.entered[source_index as usize] = tick as u32;
            }
        }
        order
    }
}

/// Which walk lays out which chunk. A chunk has one owner, so the walks share nothing they write.
struct WalkPlan {
    /// With code splitting, per file: the JS chunk that holds it (`u32::MAX`: none).
    chunk_of_file: Vec<u32>,
    /// Per chunk: the entry point id of the walk that lays it out (`u32::MAX`: not a JS chunk).
    owner_of_chunk: Vec<u32>,
    /// Per chunk: its index in `EntryWalk::owned` of its owner.
    slot_of_chunk: Vec<u32>,
    /// With code splitting: the entry point id of each entry point's file, `u32::MAX` for the others.
    entry_id_of_file: Vec<u32>,
    /// With code splitting: `load_rank`.
    rank: Vec<u32>,
    /// With code splitting, when another entry point than the owner can be the first to load a chunk.
    watch: Option<OrderWatch>,
}

impl WalkPlan {
    fn new(c: &LinkerContext, chunks: &[Chunk]) -> WalkPlan {
        let files_len = c.graph.files.len();
        let entry_points = c.graph.entry_points.items_source_index();
        let code_splitting = c.graph.code_splitting;
        let mut plan = WalkPlan {
            chunk_of_file: Vec::new(),
            owner_of_chunk: vec![u32::MAX; chunks.len()],
            slot_of_chunk: vec![0; chunks.len()],
            entry_id_of_file: Vec::new(),
            rank: Vec::new(),
            watch: None,
        };

        if code_splitting {
            // A file is in the chunk that has its entry bits as key, also when it prints nothing there.
            let file_entry_bits = c.graph.files.items_entry_bits();
            let css = c.graph.ast.items_css();
            let mut chunk_of_key: StringHashMap<u32> = StringHashMap::default();
            for (chunk_index, chunk) in chunks.iter().enumerate() {
                if matches!(chunk.content, chunk::Content::Javascript(_)) {
                    bun_core::handle_oom(chunk_of_key.put(
                        chunk.entry_bits().bytes(entry_points.len()),
                        chunk_index as u32,
                    ));
                }
            }
            plan.chunk_of_file = vec![u32::MAX; files_len];
            for source_index in c.graph.reachable_files.iter() {
                let file = source_index.get() as usize;
                if c.graph.files_live.is_set(file)
                    && css[file].is_none()
                    && let Some(&chunk_index) =
                        chunk_of_key.get(file_entry_bits[file].bytes(entry_points.len()))
                {
                    plan.chunk_of_file[file] = chunk_index;
                }
            }
        }

        // The entry point that loads first among the chunk's entry points owns the chunk.
        if code_splitting {
            plan.entry_id_of_file = vec![u32::MAX; files_len];
            for (entry_id, &source_index) in entry_points.iter().enumerate() {
                let slot = &mut plan.entry_id_of_file[source_index as usize];
                if *slot == u32::MAX {
                    *slot = entry_id as u32;
                }
            }
            plan.rank = load_rank(c, &plan.entry_id_of_file);
        }
        for (chunk_index, chunk) in chunks.iter().enumerate() {
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }
            plan.owner_of_chunk[chunk_index] = if code_splitting {
                let mut bits = chunk.entry_bits().iterator::<true, true>();
                let mut owner = u32::MAX;
                while let Some(entry_id) = bits.next() {
                    if owner == u32::MAX || plan.rank[entry_id] < plan.rank[owner as usize] {
                        owner = entry_id as u32;
                    }
                }
                owner
            } else {
                chunk.entry_point.entry_point_id()
            };
        }
        plan
    }

    /// One walk per entry point that owns a chunk.
    fn create_walks(&mut self, c: &LinkerContext) -> Vec<EntryWalk> {
        let mut walk_of_entry = vec![u32::MAX; c.graph.entry_points.len()];
        let mut walks: Vec<EntryWalk> = Vec::new();
        for (chunk_index, &owner) in self.owner_of_chunk.iter().enumerate() {
            if owner == u32::MAX {
                continue;
            }
            let walk_index = &mut walk_of_entry[owner as usize];
            if *walk_index == u32::MAX {
                *walk_index = walks.len() as u32;
                walks.push(EntryWalk {
                    entry_id: owner,
                    owned: Vec::new(),
                    entered: Vec::new(),
                    watch_slots: Vec::new(),
                    watched: Vec::new(),
                });
            }
            let walk = &mut walks[*walk_index as usize];
            self.slot_of_chunk[chunk_index] = walk.owned.len() as u32;
            walk.owned.push(OwnedChunk {
                chunk_index: chunk_index as u32,
                runs: Vec::new(),
                has_cycle: false,
            });
        }
        walks
    }

    /// A chunk prints its files in the order of its owner. On an import cycle, that order can put a part that runs at
    /// load ahead of a binding that it reads, where the order of another entry point of the chunk does not. Returns the
    /// walks of the first such entry point by rank, each with the chunks that it lays out in place of their owner.
    fn find_safe_walks(
        &mut self,
        this: &mut LinkerContext,
        chunks: &[Chunk],
        walks: &[EntryWalk],
    ) -> Vec<EntryWalk> {
        let mut reads: Option<LoadTimeReads> = None;
        // With the other entry points of the chunk, last by rank first.
        let mut unsafe_chunks: Vec<(usize, Vec<u32>)> = Vec::new();
        for owned in walks.iter().flat_map(|walk| &walk.owned) {
            let chunk_index = owned.chunk_index as usize;
            if !owned.has_cycle || chunks[chunk_index].entry_bits().count() < 2 {
                continue;
            }
            let reads = reads.get_or_insert_with(|| LoadTimeReads::new(this));
            if !reads.is_broken_by(this, &owned.runs) {
                continue;
            }
            let mut candidates: Vec<u32> = Vec::new();
            let mut bits = chunks[chunk_index].entry_bits().iterator::<true, true>();
            while let Some(entry_id) = bits.next() {
                if entry_id as u32 != self.owner_of_chunk[chunk_index] {
                    candidates.push(entry_id as u32);
                }
            }
            candidates
                .sort_unstable_by_key(|&entry_id| core::cmp::Reverse(self.rank[entry_id as usize]));
            unsafe_chunks.push((chunk_index, candidates));
        }

        let mut safe_walks: Vec<EntryWalk> = Vec::new();
        let Some(mut reads) = reads else {
            return safe_walks;
        };
        // One round tries the next entry point of every chunk, so chunks with the same entry points share a walk.
        let mut is_safe = vec![false; chunks.len()];
        loop {
            self.owner_of_chunk.fill(u32::MAX);
            unsafe_chunks.retain_mut(|(chunk_index, candidates)| {
                if is_safe[*chunk_index] {
                    return false;
                }
                let Some(candidate) = candidates.pop() else {
                    return false;
                };
                self.owner_of_chunk[*chunk_index] = candidate;
                true
            });
            if unsafe_chunks.is_empty() {
                return safe_walks;
            }
            let mut trials = self.create_walks(this);
            run_walks(this, self, chunks, &mut trials);
            for mut trial in trials {
                trial
                    .owned
                    .retain(|owned| !reads.is_broken_by(this, &owned.runs));
                for owned in &trial.owned {
                    is_safe[owned.chunk_index as usize] = true;
                }
                trial
                    .entered
                    .retain(|&file| is_safe[self.chunk_of_file[file as usize] as usize]);
                safe_walks.push(trial);
            }
        }
    }
}

/// A chunk prints its files in the order of one entry point, its owner. Another entry point that can be the first to
/// load the chunk then runs them in that order too, which can be another order than the one of its own imports.
/// `OrderWatch` finds such chunks before the walks, has the walks of those entry points record their order, and reports
/// the files that an entry point runs the other way round.
struct OrderWatch {
    /// Per chunk: its number among the watched chunks (`u32::MAX`: not watched).
    watch_of_chunk: Vec<u32>,
    /// Per file: the number of its chunk, when the file runs code at load there (`u32::MAX`: it does not).
    watch_of_file: Vec<u32>,
    /// How many chunks are watched. They are numbered from 0.
    chunks_len: u32,
    /// `files_with_bare_import`.
    has_bare_import: Vec<bool>,
    /// The log takes debug messages: every pair of files counts, not only a pair with a file of `has_bare_import`.
    all_pairs: bool,
}

impl OrderWatch {
    /// `None`: no chunk of the build is watched, and the walks record nothing.
    fn new(
        c: &LinkerContext,
        chunks: &[Chunk],
        walks: &mut [EntryWalk],
    ) -> Result<Option<OrderWatch>, crate::Error> {
        // Without chunk folding (only tests turn it off), no pass says which entry points can load a chunk first.
        if !c.graph.code_splitting || !c.options.fold_chunks {
            return Ok(None);
        }
        let entry_points_len = c.graph.entry_points.len();
        let mut watch = OrderWatch {
            watch_of_chunk: Vec::new(),
            watch_of_file: Vec::new(),
            chunks_len: 0,
            has_bare_import: Vec::new(),
            all_pairs: bun_ast::Kind::Debug.should_print(c.log().level),
        };
        let mut looked_for_bare_imports = false;
        // Per watched chunk: the entry points that can be the first to load it.
        let mut first_loaders_of_watch: Vec<&AutoBitSet> = Vec::new();
        for (chunk_index, chunk) in chunks.iter().enumerate() {
            if !matches!(chunk.content, chunk::Content::Javascript(_))
                || chunk.entry_bits().count() < 2
            {
                continue;
            }
            let first_loaders = match &c.first_loaders_of_key {
                // A chunk that has one first loader, or that a split `require()` loads, is not in the map.
                Some(first_loaders_of_key) => {
                    match first_loaders_of_key.get(chunk.entry_bits().bytes(entry_points_len)) {
                        Some(first_loaders) => first_loaders,
                        None => continue,
                    }
                }
                // `merge_small_chunks` returned at once: the build has no `import()` target, so every entry point of
                // the chunk is one that the build names, and each of them can load first.
                None => chunk.entry_bits(),
            };
            let files = chunk.files_with_parts_in_chunk.keys();
            let runs_code = |source_index: &&IndexInt| c.file_runs_code_in_chunk(**source_index);
            if files.iter().filter(runs_code).take(2).count() < 2 {
                continue;
            }
            // Only a build that comes this far reads its import records.
            if !looked_for_bare_imports {
                looked_for_bare_imports = true;
                watch.has_bare_import = files_with_bare_import(c);
            }
            if !watch.all_pairs
                && !files.iter().any(|&source_index| {
                    watch.has_bare_import(source_index) && c.file_runs_code_in_chunk(source_index)
                })
            {
                continue;
            }
            if watch.chunks_len == 0 {
                watch.watch_of_chunk = vec![u32::MAX; chunks.len()];
                watch.watch_of_file = vec![u32::MAX; c.graph.files.len()];
            }
            for &source_index in files.iter().filter(runs_code) {
                watch.watch_of_file[source_index as usize] = watch.chunks_len;
            }
            watch.watch_of_chunk[chunk_index] = watch.chunks_len;
            watch.chunks_len += 1;
            first_loaders_of_watch.push(first_loaders);
        }
        if watch.chunks_len == 0 {
            return Ok(None);
        }
        for walk in walks.iter_mut() {
            for (watch_index, first_loaders) in first_loaders_of_watch.iter().enumerate() {
                if !first_loaders.is_set(walk.entry_id as usize) {
                    continue;
                }
                if walk.watch_slots.is_empty() {
                    walk.watch_slots = vec![u32::MAX; watch.chunks_len as usize];
                }
                walk.watch_slots[watch_index] = walk.watched.len() as u32;
                walk.watched.push(Vec::new());
            }
        }
        Ok(Some(watch))
    }

    fn has_bare_import(&self, source_index: IndexInt) -> bool {
        self.has_bare_import
            .get(source_index as usize)
            .is_some_and(|&has_bare_import| has_bare_import)
    }

    /// One message for each watched chunk in which an entry point runs two files the other way round: a warning when an
    /// `import` statement names one of the two for its side effects only, so that where the file runs is something
    /// that the source asks for, and a debug message for another pair.
    fn report(&self, c: &LinkerContext, rank: &[u32], walks: &[EntryWalk]) {
        // The order that prints, and the entry point that it is the order of. A walk of `find_safe_walks` comes after
        // the owner's, and replaces it.
        let mut layouts: Vec<(u32, Vec<IndexInt>)> =
            vec![(u32::MAX, Vec::new()); self.chunks_len as usize];
        for walk in walks {
            for owned in &walk.owned {
                let watch_index = self.watch_of_chunk[owned.chunk_index as usize];
                if watch_index == u32::MAX {
                    continue;
                }
                let (owner, layout) = &mut layouts[watch_index as usize];
                *owner = walk.entry_id;
                layout.clear();
                layout.extend(
                    owned
                        .runs
                        .iter()
                        .filter(|run| {
                            run.end == u32::MAX
                                && self.watch_of_file[run.source_index as usize] == watch_index
                        })
                        .map(|run| run.source_index),
                );
            }
        }
        // The entry point that loads first is the one that a message names.
        let mut loaders: Vec<&EntryWalk> = walks
            .iter()
            .filter(|walk| !walk.watch_slots.is_empty())
            .collect();
        loaders.sort_by_key(|walk| rank[walk.entry_id as usize]);

        // Per file of the chunk at hand: 1 + its place in the order of the chunk (0: it has none).
        let mut chunk_place: Vec<u32> = vec![0; c.graph.files.len()];
        let mut conflicts: Vec<OrderConflict> = Vec::new();
        for (watch_index, (owner, layout)) in layouts.iter().enumerate() {
            for (index, &source_index) in layout.iter().enumerate() {
                chunk_place[source_index as usize] = index as u32 + 1;
            }
            let mut with_bare_import: Option<OrderConflict> = None;
            let mut other_pair: Option<OrderConflict> = None;
            for walk in &loaders {
                let slot = walk.watch_slots[watch_index];
                if slot == u32::MAX || walk.entry_id == *owner {
                    continue;
                }
                let theirs = &walk.watched[slot as usize];
                if theirs == layout {
                    continue;
                }
                // The chunk runs `runs_first` ahead of the file at `place`. This entry point runs it after that file.
                let conflict = |runs_first: IndexInt, place: u32, is_warning: bool| OrderConflict {
                    loader: walk.entry_id,
                    owner: *owner,
                    runs_first,
                    runs_second: layout[place as usize - 1],
                    is_warning,
                };
                // One pass over the order of this entry point. Of the files so far, `last` is the place of the one
                // that the chunk runs last, and `last_bare` the same among the files with a bare import.
                let (mut last, mut last_bare) = (0, 0);
                for &source_index in theirs {
                    let place = chunk_place[source_index as usize];
                    let has_bare_import = self.has_bare_import(source_index);
                    if place < last_bare || (has_bare_import && place < last) {
                        let other = if place < last_bare { last_bare } else { last };
                        with_bare_import = Some(conflict(source_index, other, true));
                        break;
                    }
                    if self.all_pairs && other_pair.is_none() && place < last {
                        other_pair = Some(conflict(source_index, last, false));
                    }
                    last = last.max(place);
                    if has_bare_import {
                        last_bare = last_bare.max(place);
                    }
                }
                if with_bare_import.is_some() {
                    break;
                }
            }
            for &source_index in layout {
                chunk_place[source_index as usize] = 0;
            }
            conflicts.extend(with_bare_import.or(other_pair));
        }

        let sources = c.parse_graph().input_files.items_source();
        let entry_points = c.graph.entry_points.items_source_index();
        let name =
            |source_index: IndexInt| bstr::BStr::new(sources[source_index as usize].path.pretty);
        let log = c.log_disjoint();
        for conflict in &conflicts {
            let loader = name(entry_points[conflict.loader as usize]);
            let owner = name(entry_points[conflict.owner as usize]);
            let (runs_first, runs_second) = (name(conflict.runs_first), name(conflict.runs_second));
            macro_rules! message {
                () => {
                    format_args!(
                        "The imports of \"{loader}\" run \"{runs_second}\" before \"{runs_first}\", but the chunk that holds both files follows \"{owner}\" and runs \"{runs_first}\" first"
                    )
                };
            }
            if !conflict.is_warning {
                log.add_debug_fmt(None, bun_ast::Loc::EMPTY, message!());
                continue;
            }
            if !bun_ast::Kind::Warn.should_print(log.level) {
                continue;
            }
            // The statement that asks for the file that the entry point runs first, if that is the one of the two.
            let bare_file = if self.has_bare_import(conflict.runs_second) {
                conflict.runs_second
            } else {
                conflict.runs_first
            };
            let (importer, range) = find_bare_import(c, bare_file, conflict.loader);
            // The file that the chunk runs first can only lead to the other one on an import cycle. Off a cycle, an
            // `import` of the other one in it puts that one first for every entry point.
            let note = if leads_to(c, conflict.runs_first, conflict.runs_second) {
                bun_ast::alloc_print(format_args!(
                    "A chunk runs its files in one order for every entry point that loads it. \"{runs_second}\" and \"{runs_first}\" are on an import cycle: which of the two runs first depends on the file that an entry point imports first."
                ))
            } else {
                bun_ast::alloc_print(format_args!(
                    "A chunk runs its files in one order for every entry point that loads it. If \"{runs_first}\" needs \"{runs_second}\" to run first, add an import of \"{runs_second}\" to \"{runs_first}\"."
                ))
            };
            let note = bun_ast::range_data(None, bun_ast::Range::NONE, note);
            log.add_range_warning_fmt_with_notes(
                Some(&sources[importer as usize]),
                range,
                Box::new([note]),
                message!(),
            );
        }
    }
}

/// Calls `each` with every `import "./file.js"` statement of a bundled JavaScript file that is written outside
/// `node_modules`, and with the file that holds it: the statement is there for what the file does when it runs, and
/// the author of the build can change it. `each` returns true to stop.
fn for_each_bare_import(c: &LinkerContext, mut each: impl FnMut(IndexInt, &ImportRecord) -> bool) {
    let css = c.graph.ast.items_css();
    let sources = c.parse_graph().input_files.items_source();
    for source_index in c.graph.reachable_files.iter() {
        let importer = source_index.get();
        if !c.graph.files_live.is_set(importer as usize) || css[importer as usize].is_some() {
            continue;
        }
        // Only a file with such a statement has its path read.
        let mut in_node_modules: Option<bool> = None;
        for record in c.graph.ast.items_import_records()[importer as usize].as_slice() {
            if record.kind != ImportKind::Stmt
                || !record.source_index.is_valid()
                || !record
                    .flags
                    .contains(ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT)
                || record.flags.contains(ImportRecordFlags::IS_UNUSED)
                || css[record.source_index.get() as usize].is_some()
            {
                continue;
            }
            if *in_node_modules
                .get_or_insert_with(|| sources[importer as usize].path.is_node_module())
            {
                break;
            }
            if each(importer, record) {
                return;
            }
        }
    }
}

/// Per file: a statement of `for_each_bare_import` names it. Empty: no file has one.
fn files_with_bare_import(c: &LinkerContext) -> Vec<bool> {
    let mut has_bare_import: Vec<bool> = Vec::new();
    for_each_bare_import(c, |_, record| {
        if has_bare_import.is_empty() {
            has_bare_import = vec![false; c.graph.files.len()];
        }
        has_bare_import[record.source_index.get() as usize] = true;
        false
    });
    has_bare_import
}

/// Where a warning about `bare_file` points: a statement of `for_each_bare_import` that names it. The first one in the
/// file of the entry point `loader` if there is one, else the first one in a file that `loader` loads.
fn find_bare_import(
    c: &LinkerContext,
    bare_file: IndexInt,
    loader: u32,
) -> (IndexInt, bun_ast::Range) {
    let entry_bits = c.graph.files.items_entry_bits();
    let loader_file = c.graph.entry_points.items_source_index()[loader as usize];
    // With how close the statement is to `loader`: 2 in its file, 1 in a file that it loads.
    let mut best: Option<(u8, IndexInt, bun_ast::Range)> = None;
    for_each_bare_import(c, |importer, record| {
        if record.source_index.get() != bare_file {
            return false;
        }
        let closeness = if importer == loader_file {
            2
        } else {
            u8::from(entry_bits[importer as usize].is_set(loader as usize))
        };
        if best.is_none_or(|(best, ..)| closeness > best) {
            best = Some((closeness, importer, record.range));
        }
        closeness == 2
    });
    best.map_or((bare_file, bun_ast::Range::NONE), |(_, importer, range)| {
        (importer, range)
    })
}

/// The `import` statements of `from`, and of the files that they name, lead to `to`.
fn leads_to(c: &LinkerContext, from: IndexInt, to: IndexInt) -> bool {
    let mut seen = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.files.len()));
    let mut stack = vec![from];
    while let Some(source_index) = stack.pop() {
        if source_index == to {
            return true;
        }
        if seen.is_set(source_index as usize) {
            continue;
        }
        seen.set(source_index as usize);
        for_each_edge(c, source_index, true, |_, edge| {
            if let Edge::Import(other) | Edge::LoadNow(other) = edge {
                stack.push(other);
            }
        });
    }
    false
}

/// When `loader` is the first to load their chunk, `runs_first` runs ahead of `runs_second`. In the import order of
/// `loader` it runs after it.
#[derive(Clone, Copy)]
struct OrderConflict {
    loader: u32,
    /// The entry point that the chunk has the order of.
    owner: u32,
    runs_first: IndexInt,
    runs_second: IndexInt,
    /// An `import` statement names one of the two for its side effects only.
    is_warning: bool,
}

/// What the live parts do at load, and which parts name a binding of which.
struct LoadTimeReads {
    /// Per file: the id of its part 0. The id of a part is that plus its index.
    first_part_id: Vec<u32>,
    file_of_part: Vec<IndexInt>,
    /// `Hoisted` also for a part that does not run where it prints.
    effects: Vec<LoadEffect>,
    /// `dependents[dependents_start[id]..dependents_start[id + 1]]`: the parts that name a binding of part `id`.
    dependents_start: Vec<u32>,
    dependents: Vec<u32>,
    /// Scratch for `is_broken_by`. Per part of the chunk that is not hoisted: the index of its run.
    position: Vec<u32>,
    visited: Vec<bool>,
}

impl LoadTimeReads {
    fn new(c: &LinkerContext) -> LoadTimeReads {
        let all_parts = c.graph.ast.items_parts();
        let flags = c.graph.meta.items_flags();
        let css = c.graph.ast.items_css();
        let mut first_part_id: Vec<u32> = Vec::with_capacity(all_parts.len());
        let mut file_of_part: Vec<IndexInt> = Vec::new();
        for (file, parts) in all_parts.iter().enumerate() {
            first_part_id.push(file_of_part.len() as u32);
            file_of_part.resize(file_of_part.len() + parts.len(), file as IndexInt);
        }
        let parts_len = file_of_part.len();

        let for_each_live_part = |each: &mut dyn FnMut(usize, u32, &bun_ast::Part)| {
            for source_index in c.graph.reachable_files.iter() {
                let file = source_index.get() as usize;
                if !c.graph.files_live.is_set(file) || css[file].is_some() {
                    continue;
                }
                for (part_index, part) in all_parts[file].as_slice().iter().enumerate() {
                    if c.graph.parts_live[file].is_set(part_index) {
                        each(file, first_part_id[file] + part_index as u32, part);
                    }
                }
            }
        };

        let mut effects = vec![LoadEffect::Hoisted; parts_len];
        let mut dependents_start: Vec<u32> = vec![0; parts_len + 2];
        for_each_live_part(&mut |file, id, part| {
            // A wrapped file runs when it is called, and a namespace object prints ahead of every file.
            if flags[file].wrap == Wrap::None
                && file as u32 != Index::RUNTIME.value()
                && id - first_part_id[file] != bun_ast::NAMESPACE_EXPORT_PART_INDEX
            {
                effects[id as usize] = LoadEffect::of(part);
            }
            for dependency in part.dependencies.iter() {
                let to =
                    first_part_id[dependency.source_index.get() as usize] + dependency.part_index;
                dependents_start[to as usize + 2] += 1;
            }
        });
        for i in 2..dependents_start.len() {
            dependents_start[i] += dependents_start[i - 1];
        }
        let mut dependents: Vec<u32> = vec![0; dependents_start[parts_len + 1] as usize];
        for_each_live_part(&mut |_, id, part| {
            for dependency in part.dependencies.iter() {
                let to =
                    first_part_id[dependency.source_index.get() as usize] + dependency.part_index;
                dependents[dependents_start[to as usize + 1] as usize] = id;
                dependents_start[to as usize + 1] += 1;
            }
        });

        LoadTimeReads {
            first_part_id,
            file_of_part,
            effects,
            dependents_start,
            dependents,
            position: vec![u32::MAX; parts_len],
            visited: vec![false; parts_len],
        }
    }

    /// Calls `each` with the index of the run and the id of each part of `runs` that is not hoisted, last run first.
    fn for_each_part_backward(
        &self,
        c: &LinkerContext,
        runs: &[PartRun],
        mut each: impl FnMut(u32, u32) -> bool,
    ) -> bool {
        for (run_index, run) in runs.iter().enumerate().rev() {
            let parts_len = c.graph.ast.items_parts()[run.source_index as usize].len() as u32;
            for part_index in run.begin..run.end.min(parts_len) {
                let id = self.first_part_id[run.source_index as usize] + part_index;
                if self.effects[id as usize] != LoadEffect::Hoisted && each(run_index as u32, id) {
                    return true;
                }
            }
        }
        false
    }

    /// Some part of `runs` that evaluates code names, itself or through the functions that it names, a binding that a
    /// later part of another file of `runs` gives its value.
    fn is_broken_by(&mut self, c: &LinkerContext, runs: &[PartRun]) -> bool {
        let mut position = core::mem::take(&mut self.position);
        let mut visited = core::mem::take(&mut self.visited);
        self.for_each_part_backward(c, runs, |run_index, id| {
            position[id as usize] = run_index;
            false
        });
        // Last run first: the first search that comes to a function is the one from the latest binding that it leads to.
        // `import` statements are hoisted, so a file that a part can name does not print between two parts of its file.
        let mut queue: Vec<u32> = Vec::new();
        let is_broken = self.for_each_part_backward(c, runs, |run_index, written| {
            queue.push(written);
            while let Some(id) = queue.pop() {
                let (start, end) = (
                    self.dependents_start[id as usize] as usize,
                    self.dependents_start[id as usize + 1] as usize,
                );
                for &dependent in &self.dependents[start..end] {
                    if self.effects[dependent as usize] == LoadEffect::Evaluates {
                        if position[dependent as usize] < run_index
                            && self.file_of_part[dependent as usize]
                                != self.file_of_part[written as usize]
                        {
                            return true;
                        }
                    } else if !visited[dependent as usize] {
                        visited[dependent as usize] = true;
                        queue.push(dependent);
                    }
                }
            }
            false
        });
        self.for_each_part_backward(c, runs, |_, id| {
            position[id as usize] = u32::MAX;
            false
        });
        visited.fill(false);
        self.position = position;
        self.visited = visited;
        is_broken
    }
}

/// What happens where a part prints.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum LoadEffect {
    /// Nothing: function declarations, imports, re-exports.
    Hoisted,
    /// A binding gets a value that evaluates nothing (`Expr::can_be_moved`): a function, a literal.
    Assigns,
    Evaluates,
}

impl LoadEffect {
    fn of(part: &bun_ast::Part) -> LoadEffect {
        let of_moved = |can_be_moved: bool| {
            if can_be_moved {
                LoadEffect::Assigns
            } else {
                LoadEffect::Evaluates
            }
        };
        let effects = part.stmts.slice().iter().map(|stmt| match &stmt.data {
            StmtData::SImport(_)
            | StmtData::SExportStar(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportClause(_)
            | StmtData::SFunction(_)
            | StmtData::SComment(_)
            | StmtData::SDirective(_)
            | StmtData::STypeScript(_)
            | StmtData::SEmpty(_) => LoadEffect::Hoisted,
            StmtData::SExportDefault(default) => match &default.value {
                StmtOrExpr::Stmt(stmt) if matches!(stmt.data, StmtData::SFunction(_)) => {
                    LoadEffect::Hoisted
                }
                _ => of_moved(default.can_be_moved()),
            },
            StmtData::SClass(class) => of_moved(class.class.can_be_moved()),
            StmtData::SLocal(local) => of_moved(
                local
                    .decls
                    .slice()
                    .iter()
                    .all(|decl| decl.value.is_none_or(|value| value.can_be_moved())),
            ),
            _ => LoadEffect::Evaluates,
        });
        effects.max().unwrap_or(LoadEffect::Hoisted)
    }
}

#[derive(Clone, Copy)]
enum Edge {
    /// `file` runs here, under the same load.
    Import(IndexInt),
    /// A split `require()` in a part that runs at load: the chunk of `file` runs here.
    LoadNow(IndexInt),
    /// An `import()`, or a split `require()` in a part that only declares.
    LoadLater(IndexInt),
}

/// The files that a file leads to, in evaluation order, with the part that leads there. `runs`: the load evaluates the file.
/// A file runs where it is imported, not where its bindings are used: `part.dependencies` does not order what runs.
fn for_each_edge(
    c: &LinkerContext,
    source_index: IndexInt,
    runs: bool,
    mut each: impl FnMut(u32, Edge),
) {
    let records = c.graph.ast.items_import_records()[source_index as usize].as_slice();
    let css = c.graph.ast.items_css();
    if css[source_index as usize].is_some()
        || c.parse_graph().input_files.items_loader()[source_index as usize] == Loader::Html
    {
        // A CSS or HTML file has no parts; every record counts.
        for record in records {
            if record.source_index.is_valid() {
                each(0, Edge::Import(record.source_index.get()));
            }
        }
        return;
    }

    let parts = c.graph.ast.items_parts()[source_index as usize].as_slice();
    let parts_live = &c.graph.parts_live[source_index as usize];
    // The namespace export part (index 0) counts last: what it names goes after what the `import` statements import.
    const _: () = assert!(bun_ast::NAMESPACE_EXPORT_PART_INDEX == 0);
    for part_index in 1..=parts.len() {
        let index = part_index % parts.len();
        let part = &parts[index];
        let runs_here = runs && parts_live.is_set(index);
        let part_index = part_index as u32;
        for &record_id in part.import_record_indices.slice() {
            let record: &ImportRecord = &records[record_id as usize];
            if !record.source_index.is_valid() || !(record.kind == ImportKind::Stmt || runs_here) {
                continue;
            }
            let other = record.source_index.get();
            each(
                part_index,
                if !c.is_external_dynamic_import(record, source_index) {
                    Edge::Import(other)
                } else if record.kind == ImportKind::Require && !part_has_no_side_effects(part) {
                    Edge::LoadNow(other)
                } else {
                    Edge::LoadLater(other)
                },
            );
        }
        // A chunk prints its own copy of the CSS class names that it uses, also when the `import` is in another chunk.
        if runs_here {
            for dependency in part.dependencies.iter() {
                let other = dependency.source_index.get();
                if css[other as usize].is_some() {
                    each(part_index, Edge::Import(other));
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
enum LoadFrame {
    /// `loader`: the entry point whose load reaches the file.
    Enter {
        source_index: IndexInt,
        loader: u32,
    },
    /// A split `require()` that runs at load: the entry point loads here.
    Load(u32),
    Later(u32),
}

/// Per entry point id: when it loads. The user's first, then the on-demand ones as evaluation meets them, then the rest.
fn load_rank(c: &LinkerContext, entry_id_of_file: &[u32]) -> Vec<u32> {
    const QUEUED: u32 = u32::MAX - 1;
    let files_len = c.graph.files.len();
    let entry_points = c.graph.entry_points.items_source_index();
    let entry_point_kinds = c.graph.files.items_entry_point_kind();
    let entry_bits = c.graph.files.items_entry_bits();

    // The load of an entry point that loads the file evaluated it.
    let mut visited = bun_core::handle_oom(AutoBitSet::init_empty(files_len));
    // Per file: 1 + the entry point of the last load that went through it and does not load it.
    let mut passed: Vec<u32> = vec![0; files_len];
    let mut rank: Vec<u32> = vec![u32::MAX; entry_points.len()];
    let mut next_rank = 0;
    let mut stack: Vec<LoadFrame> = Vec::new();
    let mut pending: Vec<u32> = (0..entry_points.len() as u32)
        .filter(|&entry_id| {
            entry_point_kinds[entry_points[entry_id as usize] as usize]
                != EntryPoint::Kind::DynamicImport
        })
        .collect();
    let (mut next, mut unmet) = (0, 0);
    loop {
        let entry_id = if let Some(&entry_id) = pending.get(next) {
            next += 1;
            entry_id
        } else {
            while unmet < entry_points.len() && rank[unmet] < QUEUED {
                unmet += 1;
            }
            if unmet == entry_points.len() {
                break;
            }
            unmet as u32
        };
        if rank[entry_id as usize] < QUEUED {
            continue;
        }
        stack.push(LoadFrame::Load(entry_id));
        while let Some(frame) = stack.pop() {
            let (source_index, loader) = match frame {
                LoadFrame::Load(entry_id) => {
                    if rank[entry_id as usize] >= QUEUED {
                        rank[entry_id as usize] = next_rank;
                        next_rank += 1;
                    }
                    (entry_points[entry_id as usize], entry_id)
                }
                LoadFrame::Later(entry_id) => {
                    if rank[entry_id as usize] == u32::MAX {
                        rank[entry_id as usize] = QUEUED;
                        pending.push(entry_id);
                    }
                    continue;
                }
                LoadFrame::Enter {
                    source_index,
                    loader,
                } => (source_index, loader),
            };
            if source_index == Index::RUNTIME.value() || visited.is_set(source_index as usize) {
                continue;
            }
            // A load evaluates the files that its entry point loads. It goes through the others.
            let evaluates = c.graph.files_live.is_set(source_index as usize)
                && entry_bits[source_index as usize].is_set(loader as usize);
            if evaluates {
                visited.set(source_index as usize);
            } else if core::mem::replace(&mut passed[source_index as usize], loader + 1)
                == loader + 1
            {
                continue;
            }

            let mark = stack.len();
            for_each_edge(c, source_index, evaluates, |_, edge| {
                stack.push(match edge {
                    Edge::Import(source_index) => LoadFrame::Enter {
                        source_index,
                        loader,
                    },
                    Edge::LoadNow(other) => LoadFrame::Load(entry_id_of_file[other as usize]),
                    Edge::LoadLater(other) => LoadFrame::Later(entry_id_of_file[other as usize]),
                });
            });
            stack[mark..].reverse();
        }
    }
    rank
}

#[derive(Clone, Copy)]
enum WalkFrame {
    /// `loader`: the entry point whose load runs the file. A split `require()` that runs at load changes it.
    Enter { source_index: IndexInt, loader: u32 },
    /// The walk is past what `run` waits for: `run` goes at the end of `owned[slot].runs`.
    Place { run: PartRun, slot: u32 },
    /// The class-name object of a CSS file goes at the end of `owned[slot].runs`, unless the list has it.
    PlaceCss { source_index: IndexInt, slot: u32 },
}

/// In the `slot` of a `WalkFrame::Place` of a walk that fills `watched`: the walk is past a file of a chunk of
/// `OrderWatch` that it does not lay out. The file goes at the end of `watched[slot]`, and of no `runs`. A flag and
/// not a variant of its own: a fourth variant made every walk slower, by about 3 instructions for each frame.
const WATCHED_ONLY: u32 = 1 << 31;

struct OwnedChunk {
    chunk_index: u32,
    /// The runs placed so far.
    runs: Vec<PartRun>,
    /// The walk came back to a file of the chunk that it had not left.
    has_cycle: bool,
}

/// One walk from an entry point. It lays out the chunks that the entry point owns.
struct EntryWalk {
    entry_id: u32,
    owned: Vec<OwnedChunk>,
    /// With code splitting: the files placed, in the order the walk entered them.
    entered: Vec<IndexInt>,
    /// Per chunk of `OrderWatch` that this entry point can be the first to load: its index in `watched`
    /// (`u32::MAX` for the other chunks). Empty: none.
    watch_slots: Vec<u32>,
    /// The files of such a chunk that run code at load, in the order in which the walk left them.
    watched: Vec<Vec<IndexInt>>,
}

impl EntryWalk {
    fn run(&mut self, c: &LinkerContext, plan: &WalkPlan, chunks: &[Chunk]) {
        let mut seen = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.files.len()));
        let mut left = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.files.len()));
        let mut stack: Vec<WalkFrame> = Vec::new();
        let mut css_placed: HashMap<u64, ()> = HashMap::default();
        let root = c.graph.entry_points.items_source_index()[self.entry_id as usize];
        self.walk_from(
            c,
            plan,
            &mut seen,
            &mut left,
            &mut stack,
            &mut css_placed,
            root,
        );

        // Chunk folding can move a file into a chunk whose entry points do not import it. It goes last there.
        let runtime = Index::RUNTIME.value();
        for slot in 0..self.owned.len() {
            let chunk = &chunks[self.owned[slot].chunk_index as usize];
            for &source_index in chunk.files_with_parts_in_chunk.keys() {
                if source_index != runtime && !seen.is_set(source_index as usize) {
                    self.walk_from(
                        c,
                        plan,
                        &mut seen,
                        &mut left,
                        &mut stack,
                        &mut css_placed,
                        source_index,
                    );
                }
            }
        }
    }

    /// `walk`, with `WATCH` only for an entry point that `OrderWatch` gave a list to fill.
    fn walk_from(
        &mut self,
        c: &LinkerContext,
        plan: &WalkPlan,
        seen: &mut AutoBitSet,
        left: &mut AutoBitSet,
        stack: &mut Vec<WalkFrame>,
        css_placed: &mut HashMap<u64, ()>,
        root: IndexInt,
    ) {
        if self.watch_slots.is_empty() {
            self.walk::<false>(c, plan, seen, left, stack, css_placed, root);
        } else {
            self.walk::<true>(c, plan, seen, left, stack, css_placed, root);
        }
    }

    /// Depth first along every `import` statement, also through dropped files; places the files of the owned chunks.
    /// With `WATCH`, it also fills `watched`.
    fn walk<const WATCH: bool>(
        &mut self,
        c: &LinkerContext,
        plan: &WalkPlan,
        seen: &mut AutoBitSet,
        left: &mut AutoBitSet,
        stack: &mut Vec<WalkFrame>,
        css_placed: &mut HashMap<u64, ()>,
        root: IndexInt,
    ) {
        let entry_id = self.entry_id;
        // Per file: the number of its chunk in `OrderWatch`, when this walk fills `watched`.
        let watch_of_file: &[u32] = match &plan.watch {
            Some(watch) if WATCH => &watch.watch_of_file,
            _ => &[],
        };
        // The list of `watched` that a file belongs in.
        let watch_slot_of = |watch_slots: &[u32], source_index: IndexInt| -> Option<u32> {
            let watch_index = *watch_of_file.get(source_index as usize)?;
            watch_slots
                .get(watch_index as usize)
                .copied()
                .filter(|&slot| slot != u32::MAX)
        };
        let files_live = &c.graph.files_live;
        let entry_bits = c.graph.files.items_entry_bits();
        let flags = c.graph.meta.items_flags();
        let css = c.graph.ast.items_css();
        let loads = |source_index: IndexInt, loader: u32| {
            files_live.is_set(source_index as usize)
                && entry_bits[source_index as usize].is_set(loader as usize)
        };
        // The slot of the owned chunk that holds the file.
        let slot_of = |source_index: IndexInt| -> Option<u32> {
            if !c.graph.code_splitting {
                return loads(source_index, entry_id).then_some(0);
            }
            if !files_live.is_set(source_index as usize) {
                return None;
            }
            let chunk_index = plan.chunk_of_file[source_index as usize];
            (chunk_index != u32::MAX && plan.owner_of_chunk[chunk_index as usize] == entry_id)
                .then(|| plan.slot_of_chunk[chunk_index as usize])
        };

        debug_assert!(stack.is_empty());
        stack.push(WalkFrame::Enter {
            source_index: root,
            loader: entry_id,
        });
        while let Some(frame) = stack.pop() {
            let (source_index, loader) = match frame {
                WalkFrame::Place { run, slot } => {
                    if WATCH && slot & WATCHED_ONLY != 0 {
                        self.watched[(slot & !WATCHED_ONLY) as usize].push(run.source_index);
                        continue;
                    }
                    self.owned[slot as usize].runs.push(run);
                    if run.end == u32::MAX {
                        left.set(run.source_index as usize);
                        if WATCH
                            && let Some(slot) = watch_slot_of(&self.watch_slots, run.source_index)
                        {
                            self.watched[slot as usize].push(run.source_index);
                        }
                    }
                    continue;
                }
                WalkFrame::PlaceCss { source_index, slot } => {
                    let key = u64::from(slot) << 32 | u64::from(source_index);
                    if !bun_core::handle_oom(css_placed.get_or_put(key)).found_existing {
                        self.owned[slot as usize].runs.push(PartRun {
                            source_index,
                            begin: 0,
                            end: u32::MAX,
                        });
                    }
                    continue;
                }
                WalkFrame::Enter {
                    source_index,
                    loader,
                } => (source_index, loader),
            };
            if seen.is_set(source_index as usize) {
                continue;
            }
            seen.set(source_index as usize);

            // The walk places a file of a chunk it owns. It goes through the others.
            let slot = slot_of(source_index);
            if slot.is_some() && c.graph.code_splitting {
                self.entered.push(source_index);
            }
            // The parts of a file run when the walk places it, or when its loader loads it into another chunk.
            let runs = slot.is_some() || loads(source_index, loader);
            // Wrapped files can't be split because they are all inside the wrapper
            let splits = slot.is_some() && flags[source_index as usize].wrap == Wrap::None;
            let mut begin = 0;
            let mark = stack.len();

            let owned = &mut self.owned;
            // The parts ahead of the one that imports `other` print before `other` does.
            let mut import = |part_index: u32, other: IndexInt, loader: u32| {
                if other == Index::RUNTIME.value() {
                    return;
                }
                if seen.is_set(other as usize) {
                    if !left.is_set(other as usize)
                        && let Some(slot) = slot_of(other)
                    {
                        owned[slot as usize].has_cycle = true;
                    }
                    return;
                }
                let is_css = css[other as usize].is_some();
                if is_css {
                    let Some(slot) = slot else { return };
                    // The chunk of the importer loads the CSS file, whatever load reached the importer.
                    let chunk_loads_css = if c.graph.code_splitting {
                        files_live.is_set(other as usize)
                            && entry_bits[other as usize]
                                .has_intersection(&entry_bits[source_index as usize])
                    } else {
                        loads(other, entry_id)
                    };
                    if !chunk_loads_css {
                        return;
                    }
                    let key = u64::from(slot) << 32 | u64::from(other);
                    if css_placed.contains(&key) {
                        return;
                    }
                }
                if let Some(slot) = slot
                    && splits
                    && part_index > begin
                {
                    stack.push(WalkFrame::Place {
                        run: PartRun {
                            source_index,
                            begin,
                            end: part_index,
                        },
                        slot,
                    });
                    begin = part_index;
                }
                stack.push(match slot {
                    Some(slot) if is_css => WalkFrame::PlaceCss {
                        source_index: other,
                        slot,
                    },
                    _ => WalkFrame::Enter {
                        source_index: other,
                        loader,
                    },
                });
            };

            for_each_edge(c, source_index, runs, |part_index, edge| match edge {
                Edge::Import(other) => import(part_index, other, loader),
                Edge::LoadNow(other) => {
                    import(part_index, other, plan.entry_id_of_file[other as usize])
                }
                Edge::LoadLater(_) => {}
            });
            if let Some(slot) = slot {
                stack.push(WalkFrame::Place {
                    run: PartRun {
                        source_index,
                        begin,
                        end: u32::MAX,
                    },
                    slot,
                });
            } else if WATCH && let Some(slot) = watch_slot_of(&self.watch_slots, source_index) {
                if stack.len() == mark {
                    // No file to walk first: the walk is past this one.
                    self.watched[slot as usize].push(source_index);
                } else {
                    stack.push(WalkFrame::Place {
                        run: PartRun {
                            source_index,
                            begin: 0,
                            end: u32::MAX,
                        },
                        slot: WATCHED_ONLY | slot,
                    });
                }
            }
            stack[mark..].reverse();
        }
    }
}

struct ChunkLayout<'a, 'ctx> {
    c: &'a LinkerContext<'ctx>,
    files: Vec<IndexInt>,
    part_ranges: Vec<PartRange>,
    parts_prefix: Vec<PartRange>,
    /// A namespace object exists before any file runs: these print ahead of `part_ranges`.
    namespace_objects: Vec<PartRange>,
    chunk_index: u32,
    /// Raw `entry_point_chunk_index` column, for the one write in `place`.
    entry_point_chunk_indices: *mut [u32],
}

impl ChunkLayout<'_, '_> {
    fn append_or_extend_range(
        &mut self,
        in_prefix: bool,
        source_index: IndexInt,
        part_index: IndexInt,
    ) {
        let parts = self.c.graph.ast.items_parts()[source_index as usize].as_slice();
        let part_start = |part_index: IndexInt| -> i32 {
            match parts[part_index as usize].stmts.slice().first() {
                Some(stmt) => stmt.loc.start,
                None => 0,
            }
        };
        let max = RANGE_SOURCE_BYTES_MAX;
        let ranges = if in_prefix {
            &mut self.parts_prefix
        } else {
            &mut self.part_ranges
        };
        if let Some(last_range) = ranges.last_mut() {
            if last_range.source_index.get() == source_index
                && last_range.part_index_end == part_index
                && part_start(part_index) - part_start(last_range.part_index_begin) < max
            {
                last_range.part_index_end += 1;
                return;
            }
        }

        ranges.push(PartRange {
            source_index: Index::init(source_index),
            part_index_begin: part_index,
            part_index_end: part_index + 1,
        });
    }

    fn place(&mut self, run: PartRun) {
        let source_index = run.source_index;
        let parts = self.c.graph.ast.items_parts()[source_index as usize].as_slice();
        let leaves = run.end == u32::MAX;
        // Wrapped files can't be split because they are all inside the wrapper
        let can_be_split =
            self.c.graph.meta.items_flags()[source_index as usize].wrap == Wrap::None;
        if can_be_split {
            let parts_live = &self.c.graph.parts_live[source_index as usize];
            let end = if leaves { parts.len() as u32 } else { run.end };
            for part_index in run.begin..end {
                let is_namespace_export = part_index == bun_ast::NAMESPACE_EXPORT_PART_INDEX;
                if parts_live.is_set(part_index as usize)
                    && (is_namespace_export
                        || self
                            .c
                            .should_include_part(source_index, &parts[part_index as usize]))
                {
                    let is_runtime = source_index == Index::RUNTIME.value();
                    // The part is empty in the dev server format, which takes one range per file.
                    if is_namespace_export
                        && !is_runtime
                        && !parts[part_index as usize].stmts.slice().is_empty()
                    {
                        self.namespace_objects.push(PartRange {
                            source_index: Index::init(source_index),
                            part_index_begin: part_index,
                            part_index_end: part_index + 1,
                        });
                    } else {
                        self.append_or_extend_range(
                            is_runtime && !is_namespace_export,
                            source_index,
                            part_index,
                        );
                    }
                }
            }
        }
        if !leaves {
            return;
        }

        if self.c.graph.is_scb_bitset.bit_length > 0
            && self.c.graph.is_scb_bitset.is_set(source_index as usize)
        {
            // SAFETY: `entry_point_chunk_indices` is the raw column pointer
            // for `entry_point_chunk_index` (distinct from every column read
            // through `self.c`), valid for
            // `graph.files.len()` writes for the duration of the link step.
            // Chunks run in parallel and, without code splitting, several may
            // contain this file: highest index wins (unset is `u32::MAX`), as
            // when this ran chunk by chunk.
            // Err = another chunk with a higher index already claimed it.
            let _ = unsafe {
                core::sync::atomic::AtomicU32::from_ptr(
                    (*self.entry_point_chunk_indices)
                        .as_mut_ptr()
                        .add(source_index as usize),
                )
                .try_update(
                    core::sync::atomic::Ordering::Relaxed,
                    core::sync::atomic::Ordering::Relaxed,
                    |cur| (cur == u32::MAX || cur < self.chunk_index).then_some(self.chunk_index),
                )
            };
        }

        self.files.push(source_index);

        // CommonJS files are all-or-nothing so all parts must be contiguous
        if !can_be_split {
            self.parts_prefix.push(PartRange {
                source_index: Index::init(source_index),
                part_index_begin: 0,
                part_index_end: parts.len() as u32,
            });
        }
    }
}

/// Ranks the other chunks for this chunk's `import` statements; it does not order files.
fn reached_chunks_in_order(
    c: &LinkerContext,
    chunk: &Chunk,
    chunk_index: u32,
    chunk_of_file: &[u32],
    order: &WalkOrder,
    chunks_len: usize,
) -> Result<Vec<u32>, bun_alloc::AllocError> {
    #[derive(Copy, Clone)]
    enum Frame {
        Enter(IndexInt),
        Leave(IndexInt),
    }

    let entry_bits = chunk.entry_bits();
    let file_entry_bits = c.graph.files.items_entry_bits();
    let css = c.graph.ast.items_css();
    let parts = c.graph.ast.items_parts();
    let import_records = c.graph.ast.items_import_records();

    // Start where the load enters this chunk.
    let mut roots: Vec<IndexInt> = chunk.files_with_parts_in_chunk.keys().to_vec();
    roots.sort_unstable_by_key(|&source_index| order.entered[source_index as usize]);

    let mut reached: Vec<u32> = Vec::new();
    let mut reached_set = AutoBitSet::init_empty(chunks_len)?;
    let mut visited = AutoBitSet::init_empty(c.graph.files.len())?;
    let mut stack: Vec<Frame> = Vec::new();

    for &root in core::iter::once(&Index::RUNTIME.value()).chain(&roots) {
        stack.push(Frame::Enter(root));
        while let Some(frame) = stack.pop() {
            let source_index = match frame {
                Frame::Leave(source_index) => {
                    // Post-order: when the unbundled program would have run this file.
                    let other = chunk_of_file[source_index as usize];
                    if other != u32::MAX
                        && other != chunk_index
                        && !reached_set.is_set(other as usize)
                    {
                        reached_set.set(other as usize);
                        reached.push(other);
                    }
                    continue;
                }
                Frame::Enter(source_index) => source_index,
            };
            if source_index == Index::INVALID.value() {
                continue;
            }
            if visited.is_set(source_index as usize) {
                continue;
            }
            visited.set(source_index as usize);

            let is_file_in_chunk = if css[source_index as usize].is_none() {
                entry_bits.eql(&file_entry_bits[source_index as usize])
            } else {
                entry_bits.has_intersection(&file_entry_bits[source_index as usize])
            };
            let parts_live = &c.graph.parts_live[source_index as usize];
            let records = import_records[source_index as usize].as_slice();

            let mark = stack.len();
            for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate() {
                let is_part_in_this_chunk = is_file_in_chunk && parts_live.is_set(part_index);
                for &record_id in part.import_record_indices.slice() {
                    let record: &ImportRecord = &records[record_id as usize];
                    if record.source_index.is_valid()
                        && (record.kind == ImportKind::Stmt || is_part_in_this_chunk)
                        // Don't follow import() dependencies
                        && !c.is_external_dynamic_import(record, source_index)
                    {
                        stack.push(Frame::Enter(record.source_index.get()));
                    }
                }
            }
            if !is_file_in_chunk {
                stack.push(Frame::Leave(source_index));
            }
            stack[mark..].reverse();
        }
    }
    Ok(reached)
}
