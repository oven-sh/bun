use crate::mal_prelude::*;
use bun_ast::{ImportKind, ImportRecord};
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

    // With code splitting the chunks share one evaluation order, so one walk lays out all of them.
    let split_order = if this.graph.code_splitting {
        Some(EvaluationWalk::over_all_entry_points(this, chunks))
    } else {
        None
    };

    struct Ctx<'a, 'f> {
        inner: crate::linker_context_mod::GenerateChunkCtx<'a>,
        chunk_of_file: &'f [u32],
        split_order: Option<&'f SplitOrder>,
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
        split_order: split_order.as_ref(),
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
                ctx.split_order,
                chunks_len,
            ));
        },
        chunks,
    );
    Ok(())
}

/// Each part range is printed as one task, so a range stops growing once it
/// spans this many source bytes and a large unwrapped file prints on several
/// threads. A constant, not derived from the thread count: range boundaries
/// reach the output (blank lines between ranges) and the chunk hash.
const RANGE_SOURCE_BYTES_MAX: i32 = 128 * 1024;

/// Lays out the chunk's files in the order an `EvaluationWalk` placed them.
pub(crate) fn find_imported_parts_in_js_order(
    this: &LinkerContext,
    chunk: &mut Chunk,
    chunk_index: u32,
    chunk_of_file: &[u32],
    split_order: Option<&SplitOrder>,
    chunks_len: usize,
) -> Result<(), bun_alloc::AllocError> {
    let flags = this.graph.meta.items_flags();

    // Without code splitting each entry point keeps its own module order: walk from this one.
    let own_runs: Vec<PartRun>;
    let runs: &[PartRun] = match split_order {
        Some(order) => &order.runs_of_chunk[chunk_index as usize],
        None => {
            own_runs = EvaluationWalk::from_entry_point(this, chunk.entry_point);
            &own_runs
        }
    };

    let mut layout = ChunkLayout {
        c: this,
        flags,
        parts: this.graph.ast.items_parts(),
        files: Vec::with_capacity(chunk.files_with_parts_in_chunk.count()),
        part_ranges: Vec::new(),
        parts_prefix: Vec::new(),
        chunk_index,
        // The one column written through a shared `&LinkerContext` (see `place`).
        entry_point_chunk_indices: this.graph.files.slice().split_raw().entry_point_chunk_index,
        with_scb: this.graph.is_scb_bitset.bit_length > 0,
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
        ..
    } = layout;
    let mut parts_in_chunk_order: Vec<PartRange> =
        Vec::with_capacity(part_ranges.len() + parts_prefix.len());
    parts_in_chunk_order.extend_from_slice(&parts_prefix);
    parts_in_chunk_order.extend_from_slice(&part_ranges);

    let reached_chunks = match split_order {
        Some(order) => {
            reached_chunks_in_order(this, chunk, chunk_index, chunk_of_file, order, chunks_len)?
        }
        None => Vec::new(),
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

/// What `EvaluationWalk::over_all_entry_points` recorded.
pub(crate) struct SplitOrder {
    runs_of_chunk: Vec<Vec<PartRun>>,
    /// Per file: when a walk placed it (`u32::MAX`: never).
    entered: Vec<u32>,
}

#[derive(Clone, Copy)]
enum WalkFrame {
    Enter {
        source_index: IndexInt,
        entry_id: u32,
    },
    /// `Enter` for a split `require()` that runs at load, unless a walk of the chunk of `entry_id` has started.
    EnterChunk {
        source_index: IndexInt,
        entry_id: u32,
    },
    /// The chunk of `entry_id` loads on demand: it joins `on_demand`, unless a walk of it has started.
    Later { entry_id: u32 },
    /// The walk is past what `run` waits for: `run` goes at the end of `lists[list]`.
    Place { run: PartRun, list: u32 },
    /// The class-name object of a CSS file goes at the end of `lists[list]`, unless the list has it.
    PlaceCss { source_index: IndexInt, list: u32 },
}

/// The files a walk visited: one walk without code splitting, a stamp per walk with it.
enum Seen {
    Once(AutoBitSet),
    Stamps(Vec<u32>),
}

impl Seen {
    fn has(&self, source_index: IndexInt, stamp: u32) -> bool {
        match self {
            Seen::Once(files) => files.is_set(source_index as usize),
            Seen::Stamps(stamps) => stamps[source_index as usize] == stamp,
        }
    }

    /// False when the walk visited the file before.
    fn add(&mut self, source_index: IndexInt, stamp: u32) -> bool {
        match self {
            Seen::Once(files) => {
                let is_new = !files.is_set(source_index as usize);
                files.set(source_index as usize);
                is_new
            }
            Seen::Stamps(stamps) => {
                core::mem::replace(&mut stamps[source_index as usize], stamp) != stamp
            }
        }
    }
}

/// Depth first along every `import` statement, also through dropped files; places what its entry point loads.
struct EvaluationWalk<'a, 'ctx> {
    c: &'a LinkerContext<'ctx>,
    stack: Vec<WalkFrame>,
    /// The stamp of a walk is 1 + its entry point id.
    seen: Seen,
    /// The runs placed so far: one list per chunk with code splitting, else one list.
    lists: Vec<Vec<PartRun>>,
    /// `list << 32 | file`. A CSS file is in no JS chunk: its class-name object prints in each chunk that imports it.
    css_placed: HashMap<u64, ()>,
    split: Option<SplitWalk>,
}

/// With code splitting a file is in one chunk. The first walk whose entry point loads it places it.
struct SplitWalk {
    /// Per file: the JS chunk that holds it (`u32::MAX`: none).
    list_of_file: Vec<u32>,
    entered: Vec<u32>,
    next_tick: u32,
    /// The entry point id of each entry point's file, `u32::MAX` for the others.
    entry_id_of_file: Vec<u32>,
    /// Per entry point id: its walk has started.
    walked: Vec<bool>,
    /// Per entry point id: it is in `on_demand`.
    queued: Vec<bool>,
    /// Entry point ids of the chunks that load on demand, in the order the walks met them.
    on_demand: Vec<u32>,
}

impl<'a, 'ctx> EvaluationWalk<'a, 'ctx> {
    fn new(c: &'a LinkerContext<'ctx>, lists: usize, split: Option<SplitWalk>) -> Self {
        EvaluationWalk {
            c,
            stack: Vec::new(),
            seen: match split {
                Some(_) => Seen::Stamps(vec![0; c.graph.files.len()]),
                None => Seen::Once(bun_core::handle_oom(AutoBitSet::init_empty(
                    c.graph.files.len(),
                ))),
            },
            lists: vec![Vec::new(); lists],
            css_placed: HashMap::default(),
            split,
        }
    }

    /// Without code splitting: the runs of the chunk of `entry_point`.
    fn from_entry_point(
        c: &'a LinkerContext<'ctx>,
        entry_point: chunk::EntryPoint,
    ) -> Vec<PartRun> {
        let mut walk = Self::new(c, 1, None);
        walk.walk(entry_point.entry_point_id(), entry_point.source_index());
        walk.lists.pop().unwrap_or_default()
    }

    /// With code splitting. Load order: the user's entry points, then on-demand chunks as met, then the rest.
    fn over_all_entry_points(c: &'a LinkerContext<'ctx>, chunks: &[Chunk]) -> SplitOrder {
        let files_len = c.graph.files.len();
        let entry_points = c.graph.entry_points.items_source_index();
        let entry_point_kinds = c.graph.files.items_entry_point_kind();

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
        let mut list_of_file = vec![u32::MAX; files_len];
        for source_index in c.graph.reachable_files.iter() {
            let file = source_index.get() as usize;
            if c.graph.files_live.is_set(file)
                && css[file].is_none()
                && let Some(&chunk_index) =
                    chunk_of_key.get(file_entry_bits[file].bytes(entry_points.len()))
            {
                list_of_file[file] = chunk_index;
            }
        }
        let mut entry_id_of_file = vec![u32::MAX; files_len];
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            let slot = &mut entry_id_of_file[source_index as usize];
            if *slot == u32::MAX {
                *slot = entry_id as u32;
            }
        }

        let mut walk = Self::new(
            c,
            chunks.len(),
            Some(SplitWalk {
                list_of_file,
                entered: vec![u32::MAX; files_len],
                next_tick: 0,
                entry_id_of_file,
                walked: vec![false; entry_points.len()],
                queued: vec![false; entry_points.len()],
                on_demand: Vec::new(),
            }),
        );
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            if entry_point_kinds[source_index as usize] != EntryPoint::Kind::DynamicImport {
                walk.walk_entry_point(entry_id as u32, source_index);
            }
        }
        let (mut met, mut unmet) = (0, 0);
        loop {
            let split = walk.split.as_ref().expect("set above");
            if let Some(&entry_id) = split.on_demand.get(met) {
                met += 1;
                walk.walk_entry_point(entry_id, entry_points[entry_id as usize]);
                continue;
            }
            while unmet < entry_points.len() && split.walked[unmet] {
                unmet += 1;
            }
            if unmet == entry_points.len() {
                break;
            }
            walk.walk_entry_point(unmet as u32, entry_points[unmet]);
        }

        // Chunk folding can move a file into a chunk whose entry points do not import it. It goes last there.
        let runtime = Index::RUNTIME.value();
        for chunk in chunks {
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }
            for &source_index in chunk.files_with_parts_in_chunk.keys() {
                let split = walk.split.as_ref().expect("set above");
                if source_index != runtime
                    && split.entered[source_index as usize] == u32::MAX
                    && let Some(entry_id) = file_entry_bits[source_index as usize].find_first_set()
                {
                    walk.walk(entry_id as u32, source_index);
                }
            }
        }

        let EvaluationWalk { lists, split, .. } = walk;
        let entered = split.expect("set above").entered;
        if cfg!(debug_assertions) {
            for chunk in chunks {
                if matches!(chunk.content, chunk::Content::Javascript(_)) {
                    for &source_index in chunk.files_with_parts_in_chunk.keys() {
                        debug_assert!(
                            source_index == runtime || entered[source_index as usize] != u32::MAX,
                            "no walk placed file {source_index}"
                        );
                    }
                }
            }
        }
        SplitOrder {
            runs_of_chunk: lists,
            entered,
        }
    }

    fn walk_entry_point(&mut self, entry_id: u32, root: IndexInt) {
        let walked = &mut self.split.as_mut().expect("code splitting").walked;
        if !core::mem::replace(&mut walked[entry_id as usize], true) {
            self.walk(entry_id, root);
        }
    }

    fn walk(&mut self, entry_id: u32, root: IndexInt) {
        let Self {
            c,
            stack,
            seen,
            lists,
            css_placed,
            split,
        } = self;
        let c: &LinkerContext = c;
        let files_live = &c.graph.files_live;
        let entry_bits = c.graph.files.items_entry_bits();
        let flags = c.graph.meta.items_flags();
        let css = c.graph.ast.items_css();
        let loaders = c.parse_graph().input_files.items_loader();
        let parts = c.graph.ast.items_parts();
        let import_records = c.graph.ast.items_import_records();
        let loads = |source_index: IndexInt, entry_id: u32| {
            files_live.is_set(source_index as usize)
                && entry_bits[source_index as usize].is_set(entry_id as usize)
        };

        debug_assert!(stack.is_empty());
        stack.push(WalkFrame::Enter {
            source_index: root,
            entry_id,
        });
        while let Some(frame) = stack.pop() {
            let (source_index, entry_id) = match frame {
                WalkFrame::Place { run, list } => {
                    lists[list as usize].push(run);
                    continue;
                }
                WalkFrame::PlaceCss { source_index, list } => {
                    let key = u64::from(list) << 32 | u64::from(source_index);
                    if !bun_core::handle_oom(css_placed.get_or_put(key)).found_existing {
                        lists[list as usize].push(PartRun {
                            source_index,
                            begin: 0,
                            end: u32::MAX,
                        });
                    }
                    continue;
                }
                WalkFrame::Later { entry_id } => {
                    let split = split.as_mut().expect("code splitting");
                    if !split.walked[entry_id as usize]
                        && !core::mem::replace(&mut split.queued[entry_id as usize], true)
                    {
                        split.on_demand.push(entry_id);
                    }
                    continue;
                }
                WalkFrame::EnterChunk {
                    source_index,
                    entry_id,
                } => {
                    let split = split.as_mut().expect("code splitting");
                    if core::mem::replace(&mut split.walked[entry_id as usize], true) {
                        continue;
                    }
                    (source_index, entry_id)
                }
                WalkFrame::Enter {
                    source_index,
                    entry_id,
                } => (source_index, entry_id),
            };
            let stamp = entry_id + 1;
            if !seen.add(source_index, stamp) {
                continue;
            }
            // An earlier walk placed this file and walked what it imports.
            if let Some(split) = split.as_ref()
                && split.entered[source_index as usize] != u32::MAX
            {
                continue;
            }

            // The walk places a file that its entry point loads. It goes through the others.
            let mut list: Option<u32> = None;
            if loads(source_index, entry_id) {
                list = match split.as_mut() {
                    None => Some(0),
                    Some(split) => {
                        split.entered[source_index as usize] = split.next_tick;
                        split.next_tick += 1;
                        Some(split.list_of_file[source_index as usize])
                            .filter(|&list| list != u32::MAX)
                    }
                };
            }
            // Wrapped files can't be split because they are all inside the wrapper
            let splits = list.is_some() && flags[source_index as usize].wrap == Wrap::None;
            let mut begin = 0;
            let mark = stack.len();

            // The parts ahead of the one that imports `other` print before `other` does.
            let mut import = |part_index: u32, other: IndexInt, other_entry: u32, later: bool| {
                if later {
                    stack.push(WalkFrame::Later {
                        entry_id: other_entry,
                    });
                    return;
                }
                if other == Index::RUNTIME.value() || seen.has(other, other_entry + 1) {
                    return;
                }
                let is_css = css[other as usize].is_some();
                if is_css {
                    let Some(list) = list else { return };
                    if !loads(other, entry_id) {
                        return;
                    }
                    let key = u64::from(list) << 32 | u64::from(other);
                    if css_placed.contains(&key) {
                        return;
                    }
                }
                let end = part_index.max(bun_ast::NAMESPACE_EXPORT_PART_INDEX + 1);
                if let Some(list) = list
                    && splits
                    && end > begin
                {
                    stack.push(WalkFrame::Place {
                        run: PartRun {
                            source_index,
                            begin,
                            end,
                        },
                        list,
                    });
                    begin = end;
                }
                stack.push(match list {
                    Some(list) if is_css => WalkFrame::PlaceCss {
                        source_index: other,
                        list,
                    },
                    _ if other_entry != entry_id => WalkFrame::EnterChunk {
                        source_index: other,
                        entry_id: other_entry,
                    },
                    _ => WalkFrame::Enter {
                        source_index: other,
                        entry_id: other_entry,
                    },
                });
            };

            let records = import_records[source_index as usize].as_slice();
            if css[source_index as usize].is_some()
                || loaders[source_index as usize] == Loader::Html
            {
                // A CSS or HTML file has no parts; every record counts.
                for record in records {
                    if record.source_index.is_valid() {
                        import(0, record.source_index.get(), entry_id, false);
                    }
                }
            } else {
                let parts_live = &c.graph.parts_live[source_index as usize];
                for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate()
                {
                    let runs_here = list.is_some() && parts_live.is_set(part_index);
                    let part_index = part_index as u32;
                    for &record_id in part.import_record_indices.slice() {
                        let record: &ImportRecord = &records[record_id as usize];
                        if !record.source_index.is_valid()
                            || !(record.kind == ImportKind::Stmt || runs_here)
                        {
                            continue;
                        }
                        let other = record.source_index.get();
                        if !c.is_external_dynamic_import(record, source_index) {
                            import(part_index, other, entry_id, false);
                            continue;
                        }
                        let Some(split) = split.as_ref() else {
                            continue;
                        };
                        let other_entry = split.entry_id_of_file[other as usize];
                        if !split.walked[other_entry as usize] {
                            // A `require()` in a part that runs at load walks the chunk here, from its own entry point.
                            let runs_at_load = record.kind == ImportKind::Require
                                && !part_has_no_side_effects(part);
                            import(part_index, other, other_entry, !runs_at_load);
                        }
                    }
                    // A file that the `import` statements did not reach: ahead of the part that uses it.
                    if runs_here && part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX {
                        for dependency in part.dependencies.iter() {
                            import(part_index, dependency.source_index.get(), entry_id, false);
                        }
                    }
                }
                // The namespace export part is ahead of the `import` statements and only holds getters.
                let file_parts = parts[source_index as usize].as_slice();
                if let Some(namespace_export) =
                    file_parts.get(bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize)
                    && list.is_some()
                    && parts_live.is_set(bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize)
                {
                    let after_all_parts = file_parts.len() as u32;
                    for dependency in namespace_export.dependencies.iter() {
                        import(
                            after_all_parts,
                            dependency.source_index.get(),
                            entry_id,
                            false,
                        );
                    }
                }
            }
            if let Some(list) = list {
                stack.push(WalkFrame::Place {
                    run: PartRun {
                        source_index,
                        begin,
                        end: u32::MAX,
                    },
                    list,
                });
            }
            stack[mark..].reverse();
        }
    }
}

struct ChunkLayout<'a, 'ctx> {
    c: &'a LinkerContext<'ctx>,
    flags: &'a [crate::js_meta::Flags],
    parts: &'a [bun_ast::PartList<'ctx>],
    files: Vec<IndexInt>,
    part_ranges: Vec<PartRange>,
    parts_prefix: Vec<PartRange>,
    chunk_index: u32,
    /// Raw `entry_point_chunk_index` column, for the one write in `place`.
    entry_point_chunk_indices: *mut [u32],
    with_scb: bool,
}

impl ChunkLayout<'_, '_> {
    fn append_or_extend_range(
        &mut self,
        in_prefix: bool,
        source_index: IndexInt,
        part_index: IndexInt,
    ) {
        let parts = self.parts[source_index as usize].as_slice();
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
        let parts = self.parts[source_index as usize].as_slice();
        let leaves = run.end == u32::MAX;
        // Wrapped files can't be split because they are all inside the wrapper
        let can_be_split = self.flags[source_index as usize].wrap == Wrap::None;
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
                    self.append_or_extend_range(
                        source_index == Index::RUNTIME.value() && !is_namespace_export,
                        source_index,
                        part_index,
                    );
                }
            }
        }
        if !leaves {
            return;
        }

        if self.with_scb && self.c.graph.is_scb_bitset.is_set(source_index as usize) {
            // SAFETY: `entry_point_chunk_indices` is the raw column pointer
            // for `entry_point_chunk_index` (distinct from every column read
            // through `self.c` / `self.flags` / `self.parts`), valid for
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
    order: &SplitOrder,
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
