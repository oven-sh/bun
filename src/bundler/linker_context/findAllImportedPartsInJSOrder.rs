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

    let (plan, mut walks) = WalkPlan::new(this, chunks);
    {
        struct WalkCtx<'a, 'f> {
            c: bun_ptr::ParentRef<LinkerContext<'a>, bun_ptr::Mut>,
            plan: &'f WalkPlan,
            chunks: &'f [Chunk],
        }
        let walk_ctx = WalkCtx {
            // SAFETY: `this` is the live `&mut LinkerContext` for the link step.
            c: unsafe {
                bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(this))
            },
            plan: &plan,
            chunks: &*chunks,
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
            &mut walks,
        );
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
        ..
    } = layout;
    let mut parts_in_chunk_order: Vec<PartRange> =
        Vec::with_capacity(part_ranges.len() + parts_prefix.len());
    parts_in_chunk_order.extend_from_slice(&parts_prefix);
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
}

impl WalkPlan {
    fn new(c: &LinkerContext, chunks: &[Chunk]) -> (WalkPlan, Vec<EntryWalk>) {
        let files_len = c.graph.files.len();
        let entry_points = c.graph.entry_points.items_source_index();
        let code_splitting = c.graph.code_splitting;
        let mut plan = WalkPlan {
            chunk_of_file: Vec::new(),
            owner_of_chunk: vec![u32::MAX; chunks.len()],
            slot_of_chunk: vec![0; chunks.len()],
            entry_id_of_file: Vec::new(),
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
        let mut rank = Vec::new();
        if code_splitting {
            plan.entry_id_of_file = vec![u32::MAX; files_len];
            for (entry_id, &source_index) in entry_points.iter().enumerate() {
                let slot = &mut plan.entry_id_of_file[source_index as usize];
                if *slot == u32::MAX {
                    *slot = entry_id as u32;
                }
            }
            rank = load_rank(c, &plan.entry_id_of_file);
        }
        let mut walk_of_entry = vec![u32::MAX; entry_points.len()];
        let mut walks: Vec<EntryWalk> = Vec::new();
        for (chunk_index, chunk) in chunks.iter().enumerate() {
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }
            let owner = if code_splitting {
                let mut bits = chunk.entry_bits().iterator::<true, true>();
                let mut owner = u32::MAX;
                while let Some(entry_id) = bits.next() {
                    if owner == u32::MAX || rank[entry_id] < rank[owner as usize] {
                        owner = entry_id as u32;
                    }
                }
                owner
            } else {
                chunk.entry_point.entry_point_id()
            };
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
                });
            }
            let walk = &mut walks[*walk_index as usize];
            plan.owner_of_chunk[chunk_index] = owner;
            plan.slot_of_chunk[chunk_index] = walk.owned.len() as u32;
            walk.owned.push(OwnedChunk {
                chunk_index: chunk_index as u32,
                runs: Vec::new(),
            });
        }
        (plan, walks)
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
fn for_each_edge(
    c: &LinkerContext,
    source_index: IndexInt,
    runs: bool,
    mut each: impl FnMut(u32, Edge),
) {
    let records = c.graph.ast.items_import_records()[source_index as usize].as_slice();
    if c.graph.ast.items_css()[source_index as usize].is_some()
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
    for (part_index, part) in parts.iter().enumerate() {
        let runs_here = runs && parts_live.is_set(part_index);
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
        // A file that the `import` statements did not reach: ahead of the part that uses it.
        if runs_here && part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX {
            for dependency in part.dependencies.iter() {
                each(part_index, Edge::Import(dependency.source_index.get()));
            }
        }
    }
    // The namespace export part is ahead of the `import` statements and only holds getters.
    if let Some(namespace_export) = parts.get(bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize)
        && runs
        && parts_live.is_set(bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize)
    {
        for dependency in namespace_export.dependencies.iter() {
            each(
                parts.len() as u32,
                Edge::Import(dependency.source_index.get()),
            );
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

struct OwnedChunk {
    chunk_index: u32,
    /// The runs placed so far.
    runs: Vec<PartRun>,
}

/// One walk from an entry point. It lays out the chunks that the entry point owns.
struct EntryWalk {
    entry_id: u32,
    owned: Vec<OwnedChunk>,
    /// With code splitting: the files placed, in the order the walk entered them.
    entered: Vec<IndexInt>,
}

impl EntryWalk {
    fn run(&mut self, c: &LinkerContext, plan: &WalkPlan, chunks: &[Chunk]) {
        let mut seen = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.files.len()));
        let mut stack: Vec<WalkFrame> = Vec::new();
        let mut css_placed: HashMap<u64, ()> = HashMap::default();
        let root = c.graph.entry_points.items_source_index()[self.entry_id as usize];
        self.walk(c, plan, &mut seen, &mut stack, &mut css_placed, root);

        // Chunk folding can move a file into a chunk whose entry points do not import it. It goes last there.
        let runtime = Index::RUNTIME.value();
        for slot in 0..self.owned.len() {
            let chunk = &chunks[self.owned[slot].chunk_index as usize];
            for &source_index in chunk.files_with_parts_in_chunk.keys() {
                if source_index != runtime && !seen.is_set(source_index as usize) {
                    self.walk(
                        c,
                        plan,
                        &mut seen,
                        &mut stack,
                        &mut css_placed,
                        source_index,
                    );
                }
            }
        }
    }

    /// Depth first along every `import` statement, also through dropped files; places the files of the owned chunks.
    fn walk(
        &mut self,
        c: &LinkerContext,
        plan: &WalkPlan,
        seen: &mut AutoBitSet,
        stack: &mut Vec<WalkFrame>,
        css_placed: &mut HashMap<u64, ()>,
        root: IndexInt,
    ) {
        let entry_id = self.entry_id;
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
                    self.owned[slot as usize].runs.push(run);
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

            // The parts ahead of the one that imports `other` print before `other` does.
            let mut import = |part_index: u32, other: IndexInt, loader: u32| {
                if other == Index::RUNTIME.value() || seen.is_set(other as usize) {
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
                let end = part_index.max(bun_ast::NAMESPACE_EXPORT_PART_INDEX + 1);
                if let Some(slot) = slot
                    && splits
                    && end > begin
                {
                    stack.push(WalkFrame::Place {
                        run: PartRun {
                            source_index,
                            begin,
                            end,
                        },
                        slot,
                    });
                    begin = end;
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
    // Holds files of a pinned entry point's chunk, which ran after every chunk that it imports.
    let mut last = AutoBitSet::init_empty(chunks_len)?;
    let mut visited = AutoBitSet::init_empty(c.graph.files.len())?;
    let mut stack: Vec<Frame> = Vec::new();

    for &root in core::iter::once(&Index::RUNTIME.value()).chain(&roots) {
        stack.push(Frame::Enter(root));
        while let Some(frame) = stack.pop() {
            let source_index = match frame {
                Frame::Leave(source_index) => {
                    // Post-order: when the unbundled program would have run this file.
                    let other = chunk_of_file[source_index as usize];
                    if other == u32::MAX || other == chunk_index {
                        continue;
                    }
                    if c.left_entry_chunk
                        .as_ref()
                        .is_some_and(|left| left.is_set(source_index as usize))
                    {
                        last.set(other as usize);
                    }
                    if !reached_set.is_set(other as usize) {
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
    reached.sort_by_key(|&other| last.is_set(other as usize));
    Ok(reached)
}
