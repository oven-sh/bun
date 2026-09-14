use crate::mal_prelude::*;
use bun_ast::{ImportKind, ImportRecord};
use bun_collections::{AutoBitSet, HashMap, VecExt};

use crate::{
    Chunk, Index, IndexInt, LinkerContext, PartRange,
    chunk::{self, Order, ReachedWhileEvaluating},
    js_meta::Wrap,
};
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
    // For `nest_cross_chunk_imports`; only kept where the build has a split `require()`.
    let mut files_that_run: Vec<u32> = Vec::new();
    let mut chunk_can_require: Vec<bool> = Vec::new();
    let mut file_can_require: Option<Box<[bool]>> = None;
    if this.graph.code_splitting {
        file_can_require = this.files_that_can_require_a_chunk();
        if file_can_require.is_some() {
            files_that_run.resize(chunks.len(), 0);
            chunk_can_require.resize(chunks.len(), false);
        }
        for (chunk_index, chunk) in chunks.iter_mut().enumerate() {
            let chunk::Content::Javascript(js) = &mut chunk.content else {
                continue;
            };
            for &source_index in chunk.files_with_parts_in_chunk.keys() {
                if !this.loading_file_has_no_side_effects(source_index) {
                    chunk_of_file[source_index as usize] = chunk_index as u32;
                    if let Some(files) = &file_can_require {
                        files_that_run[chunk_index] += 1;
                        if files[source_index as usize] {
                            chunk_can_require[chunk_index] = true;
                            js.can_require_a_chunk = true;
                        }
                    }
                }
            }
        }
    }

    struct Ctx<'a, 'f> {
        inner: crate::linker_context_mod::GenerateChunkCtx<'a>,
        chunk_of_file: &'f [u32],
        files_that_run: &'f [u32],
        chunk_can_require: &'f [bool],
        file_can_require: Option<&'f [bool]>,
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
        files_that_run: &files_that_run,
        chunk_can_require: &chunk_can_require,
        file_can_require: file_can_require.as_deref(),
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
                &mut Vec::new(),
                &mut Vec::new(),
                u32::try_from(index).expect("int cast"),
                ctx.chunk_of_file,
                ctx.file_can_require.map(|file_can_require| {
                    ChunksBeingEvaluated::new(
                        ctx.files_that_run,
                        ctx.chunk_can_require,
                        file_can_require,
                    )
                }),
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

pub(crate) fn find_imported_parts_in_js_order(
    this: &LinkerContext,
    chunk: &mut Chunk,
    part_ranges_shared: &mut Vec<PartRange>,
    parts_prefix_shared: &mut Vec<PartRange>,
    chunk_index: u32,
    chunk_of_file: &[u32],
    being_evaluated: Option<ChunksBeingEvaluated<'_>>,
    chunks_len: usize,
) -> Result<(), bun_alloc::AllocError> {
    let mut chunk_order_array: Vec<Order> =
        Vec::with_capacity(chunk.files_with_parts_in_chunk.count());
    {
        let distances = this.graph.files.items_distance_from_entry_point();
        let stable_source_indices = this.graph.stable_source_indices.slice();
        for &source_index in chunk.files_with_parts_in_chunk.keys() {
            chunk_order_array.push(Order {
                source_index,
                distance: distances[source_index as usize],
                tie_breaker: stable_source_indices[source_index as usize],
            });
        }
    }

    Order::sort(&mut chunk_order_array);

    // Without code splitting, a chunk holds every file that its entry point reaches.
    // Distances are the minimum over all entry points, so other entry points in this
    // chunk also sort at distance 0. Visit this chunk's own entry point first, so the
    // files print in the order that this entry point imports them.
    if !this.graph.code_splitting && chunk.entry_point.is_entry_point() {
        let entry_point = chunk.entry_point.source_index();
        if let Some(i) = chunk_order_array
            .iter()
            .position(|order| order.source_index == entry_point)
        {
            chunk_order_array[..=i].rotate_right(1);
        }
    }

    part_ranges_shared.clear();
    parts_prefix_shared.clear();

    // Capture before constructing the visitor (borrowck).
    let with_code_splitting = this.graph.code_splitting;
    let with_scb = this.graph.is_scb_bitset.bit_length > 0;

    // The visitor holds a LinkerContext alongside SoA column slices
    // borrowed from it, and mutates one column (`entry_point_chunk_index`).
    // Borrowck forbids the latter through a shared `&LinkerContext`, so cache that
    // single mutable column as a raw `*mut [u32]` (provenance via the
    // `MultiArrayList.bytes: *mut u8` raw-pointer field — see
    // `scanImportsAndExports.rs` for the same pattern). All other `c.*` accesses
    // are read-only.
    let entry_point_chunk_indices: *mut [u32] =
        this.graph.files.slice().split_raw().entry_point_chunk_index;

    let (files_in_chunk_order, parts_in_chunk_order, reached_chunks, reached_while_evaluating) = {
        let mut visitor = FindImportedPartsVisitor {
            files: Vec::new(),
            part_ranges: core::mem::take(part_ranges_shared),
            parts_prefix: core::mem::take(parts_prefix_shared),
            visited: HashMap::default(),
            flags: this.graph.meta.items_flags(),
            parts: this.graph.ast.items_parts(),
            import_records: this.graph.ast.items_import_records(),
            entry_bits: chunk.entry_bits(),
            c: this,
            chunk_index,
            entry_point_chunk_indices,
            stack: Vec::new(),
            chunk_of_file,
            reached_chunks: Vec::new(),
            reached_chunk_set: AutoBitSet::init_empty(chunks_len)?,
            being_evaluated,
        };

        match (with_code_splitting, with_scb) {
            (true, true) => run_visits::<true, true>(&mut visitor, &chunk_order_array),
            (true, false) => run_visits::<true, false>(&mut visitor, &chunk_order_array),
            (false, true) => run_visits::<false, true>(&mut visitor, &chunk_order_array),
            (false, false) => run_visits::<false, false>(&mut visitor, &chunk_order_array),
        }

        let mut parts_in_chunk_order: Vec<PartRange> =
            Vec::with_capacity(visitor.part_ranges.len() + visitor.parts_prefix.len());
        // bun.concat: parts_prefix first, then part_ranges
        parts_in_chunk_order.extend_from_slice(&visitor.parts_prefix);
        parts_in_chunk_order.extend_from_slice(&visitor.part_ranges);

        // No fallible ops remain past this point, so plain move-back works.
        *part_ranges_shared = visitor.part_ranges;
        *parts_prefix_shared = visitor.parts_prefix;
        // visitor.visited dropped implicitly

        (
            visitor.files,
            parts_in_chunk_order,
            visitor.reached_chunks,
            visitor
                .being_evaluated
                .map(|being_evaluated| being_evaluated.reached),
        )
    };

    match &mut chunk.content {
        chunk::Content::Javascript(js) => {
            js.files_in_chunk_order = files_in_chunk_order.into_boxed_slice();
            js.parts_in_chunk_in_order = parts_in_chunk_order.into_boxed_slice();
            js.reached_chunks_in_order = reached_chunks.into_boxed_slice();
            js.reached_while_evaluating = reached_while_evaluating
                .unwrap_or_default()
                .into_boxed_slice();
        }
        // Caller only invokes this for `.javascript` chunks (see
        // `find_all_imported_parts_in_js_order`).
        _ => unreachable!("findImportedPartsInJSOrder called on non-JS chunk"),
    }
    Ok(())
}

#[inline]
fn run_visits<const WITH_CODE_SPLITTING: bool, const WITH_SCB: bool>(
    visitor: &mut FindImportedPartsVisitor<'_, '_>,
    chunk_order_array: &[Order],
) {
    visitor.visit::<WITH_CODE_SPLITTING, WITH_SCB>(Index::RUNTIME.value());
    for order in chunk_order_array {
        visitor.visit::<WITH_CODE_SPLITTING, WITH_SCB>(order.source_index);
    }
}

pub(crate) struct FindImportedPartsVisitor<'a, 'ctx> {
    pub(crate) entry_bits: &'a AutoBitSet,
    pub(crate) flags: &'a [crate::js_meta::Flags],
    pub(crate) parts: &'a [bun_ast::PartList<'ctx>],
    pub(crate) import_records: &'a [bun_ast::import_record::List<'ctx>],
    pub(crate) files: Vec<IndexInt>,
    pub(crate) part_ranges: Vec<PartRange>,
    pub(crate) visited: HashMap<IndexInt, ()>,
    pub(crate) parts_prefix: Vec<PartRange>,
    pub(crate) c: &'a LinkerContext<'ctx>,
    pub(crate) chunk_index: u32,
    /// Raw column pointer into `c.graph.files` for the single mutable write in
    /// `visit` (see the raw-pointer note above).
    entry_point_chunk_indices: *mut [u32],
    stack: Vec<PartsFrame>,
    /// The chunk of each file that runs something when loaded; `u32::MAX`
    /// for the others (and everywhere without code splitting).
    chunk_of_file: &'a [u32],
    /// `JavaScriptChunk::reached_chunks_in_order` under construction.
    reached_chunks: Vec<u32>,
    reached_chunk_set: AutoBitSet,
    /// Only where the build has a split `require()`.
    being_evaluated: Option<ChunksBeingEvaluated<'a>>,
}

/// Which other chunks the walk is in the middle of while it reaches a chunk ("Nesting cross-chunk imports" in `README.md`).
pub(crate) struct ChunksBeingEvaluated<'a> {
    /// Per chunk, how many of its files run something when loaded.
    files_that_run: &'a [u32],
    /// Per chunk and per file, `LinkerContext::files_that_can_require_a_chunk`.
    chunk_can_require: &'a [bool],
    file_can_require: &'a [bool],
    /// The walk has left a file of its own chunk that can `require()` a chunk; what it reaches next may have run already.
    own_file_may_have_required: bool,
    /// Per other chunk not reached yet, how many of its files that run something the walk has entered and not left.
    open_files: Vec<u32>,
    /// The chunks with all of them open that can be relied on, outermost first, each with `requiring_reached` at that point.
    all_open: Vec<(u32, u32)>,
    /// How many chunks have only some open, or all after `own_file_may_have_required` or inside another one counted here.
    not_usable: u32,
    /// Per chunk in `all_open`, one more than the length of `reached_chunks` when it got there; 0 for the others.
    all_open_since: Vec<u32>,
    /// How many of the chunks reached so far can `require()` a chunk.
    requiring_reached: u32,
    /// `JavaScriptChunk::reached_while_evaluating` under construction.
    reached: Vec<ReachedWhileEvaluating>,
}

impl<'a> ChunksBeingEvaluated<'a> {
    fn new(
        files_that_run: &'a [u32],
        chunk_can_require: &'a [bool],
        file_can_require: &'a [bool],
    ) -> Self {
        ChunksBeingEvaluated {
            files_that_run,
            chunk_can_require,
            file_can_require,
            own_file_may_have_required: false,
            open_files: vec![0; files_that_run.len()],
            all_open: Vec::new(),
            not_usable: 0,
            all_open_since: vec![0; files_that_run.len()],
            requiring_reached: 0,
            reached: Vec::new(),
        }
    }

    /// The walk enters a file that runs something, of another chunk that is not reached yet.
    fn enter(&mut self, chunk: u32, reached: usize) {
        self.open_files[chunk as usize] += 1;
        let open = self.open_files[chunk as usize];
        let all = open == self.files_that_run[chunk as usize];
        if open > 1 && all {
            self.not_usable -= 1;
        }
        if all && !self.own_file_may_have_required && self.not_usable == 0 {
            self.all_open_since[chunk as usize] = reached as u32 + 1;
            self.all_open.push((chunk, self.requiring_reached));
        } else if all || open == 1 {
            self.not_usable += 1;
        }
    }

    /// The walk leaves the first such file of `chunk`: `chunk` is reached.
    fn reach(&mut self, chunk: u32, reached: usize) {
        debug_assert!(self.open_files[chunk as usize] > 0);
        let since = core::mem::take(&mut self.all_open_since[chunk as usize]);
        self.reached.push(if since == 0 {
            self.not_usable -= 1;
            ReachedWhileEvaluating {
                since: reached as u32,
                inside: u32::MAX,
                requires_inside: false,
            }
        } else {
            let innermost = self.all_open.pop();
            debug_assert_eq!(innermost.map(|(chunk, _)| chunk), Some(chunk));
            ReachedWhileEvaluating {
                since: since - 1,
                inside: self.all_open.last().map_or(u32::MAX, |&(chunk, _)| chunk),
                requires_inside: innermost
                    .is_some_and(|(_, requiring)| requiring != self.requiring_reached),
            }
        });
        if self.chunk_can_require[chunk as usize] {
            self.requiring_reached += 1;
        }
    }
}

#[derive(Copy, Clone)]
enum PartsFrame {
    Enter(IndexInt),
    /// Per-part post action: append this part's range after its imports.
    Part {
        source_index: IndexInt,
        part_index: IndexInt,
        can_be_split: bool,
    },
    /// Per-file post action: record the file after all of its parts.
    File {
        source_index: IndexInt,
        is_file_in_chunk: bool,
        can_be_split: bool,
    },
}

impl<'a, 'ctx> FindImportedPartsVisitor<'a, 'ctx> {
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

    // Traverse the graph using this stable order and linearize the files with
    // dependencies before dependents
    //
    // Explicit-stack DFS (was per-edge recursive). `Enter` expands a file,
    // queuing its imports interleaved with per-part `Part` markers and a
    // trailing `File` marker, then reverses the tail so LIFO pop reproduces
    // the original recursion order exactly.
    pub(crate) fn visit<const WITH_CODE_SPLITTING: bool, const WITH_SCB: bool>(
        &mut self,
        source_index: IndexInt,
    ) {
        debug_assert!(self.stack.is_empty());
        self.stack.push(PartsFrame::Enter(source_index));

        while let Some(frame) = self.stack.pop() {
            match frame {
                PartsFrame::Part {
                    source_index,
                    part_index,
                    can_be_split,
                } => {
                    let part = &self.parts[source_index as usize].as_slice()[part_index as usize];
                    if can_be_split
                        && part_index != bun_ast::NAMESPACE_EXPORT_PART_INDEX
                        && self.c.should_include_part(source_index, part)
                    {
                        self.append_or_extend_range(
                            source_index == Index::RUNTIME.value(),
                            source_index,
                            part_index,
                        );
                    }
                    continue;
                }
                PartsFrame::File {
                    source_index,
                    is_file_in_chunk,
                    can_be_split,
                } => {
                    if is_file_in_chunk {
                        if let Some(being_evaluated) = &mut self.being_evaluated
                            && being_evaluated.file_can_require[source_index as usize]
                        {
                            being_evaluated.own_file_may_have_required = true;
                        }
                        if WITH_SCB && self.c.graph.is_scb_bitset.is_set(source_index as usize) {
                            // SAFETY: `entry_point_chunk_indices` is the raw column pointer
                            // for `entry_point_chunk_index` (distinct from every
                            // column read through `self.c` / `self.flags` / `self.parts`),
                            // valid for `graph.files.len()` writes for the duration of the
                            // link step. Chunks run in parallel and, without code
                            // splitting, several may contain this file: highest index wins
                            // (unset is `u32::MAX`), as when this ran chunk by chunk.
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
                                    |cur| {
                                        (cur == u32::MAX || cur < self.chunk_index)
                                            .then_some(self.chunk_index)
                                    },
                                )
                            };
                        }

                        self.files.push(source_index);

                        // CommonJS files are all-or-nothing so all parts must be contiguous
                        if !can_be_split {
                            self.parts_prefix.push(PartRange {
                                source_index: Index::init(source_index),
                                part_index_begin: 0,
                                part_index_end: self.parts[source_index as usize].len() as u32,
                            });
                        }
                    } else {
                        // Post-order, like the files above: another chunk's
                        // first file with side effects finishes here exactly
                        // when the unbundled module would have run them.
                        let other = self.chunk_of_file[source_index as usize];
                        if other != u32::MAX
                            && other != self.chunk_index
                            && !self.reached_chunk_set.is_set(other as usize)
                        {
                            self.reached_chunk_set.set(other as usize);
                            if let Some(being_evaluated) = &mut self.being_evaluated {
                                being_evaluated.reach(other, self.reached_chunks.len());
                            }
                            self.reached_chunks.push(other);
                        }
                    }
                    continue;
                }
                PartsFrame::Enter(source_index) => {
                    if source_index == Index::INVALID.value() {
                        continue;
                    }
                    let visited_entry = bun_core::handle_oom(self.visited.get_or_put(source_index));
                    if visited_entry.found_existing {
                        continue;
                    }

                    let is_file_in_chunk = if WITH_CODE_SPLITTING
                        && self.c.graph.ast.items_css()[source_index as usize].is_none()
                    {
                        // when code splitting, include the file in the chunk if ALL of the entry points overlap
                        self.entry_bits
                            .eql(&self.c.graph.files.items_entry_bits()[source_index as usize])
                    } else {
                        // when NOT code splitting, include the file in the chunk if ANY of the entry points overlap
                        self.entry_bits.has_intersection(
                            &self.c.graph.files.items_entry_bits()[source_index as usize],
                        )
                    };

                    if !is_file_in_chunk && let Some(being_evaluated) = &mut self.being_evaluated {
                        let other = self.chunk_of_file[source_index as usize];
                        if other != u32::MAX
                            && other != self.chunk_index
                            && !self.reached_chunk_set.is_set(other as usize)
                        {
                            being_evaluated.enter(other, self.reached_chunks.len());
                        }
                    }

                    // Wrapped files can't be split because they are all inside the wrapper
                    let can_be_split = self.flags[source_index as usize].wrap == Wrap::None;

                    let parts = self.parts[source_index as usize].as_slice();
                    let parts_live = &self.c.graph.parts_live[source_index as usize];
                    if can_be_split
                        && is_file_in_chunk
                        && parts_live.is_set(bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize)
                    {
                        self.append_or_extend_range(
                            false,
                            source_index,
                            bun_ast::NAMESPACE_EXPORT_PART_INDEX,
                        );
                    }

                    let records = self.import_records[source_index as usize].as_slice();

                    let mark = self.stack.len();
                    for part_index_ in 0..parts.len() {
                        let part = &parts[part_index_];
                        let part_index = part_index_ as u32;
                        let is_part_in_this_chunk =
                            is_file_in_chunk && parts_live.is_set(part_index_);
                        for &record_id in part.import_record_indices.slice() {
                            let record: &ImportRecord = &records[record_id as usize];
                            if record.source_index.is_valid()
                                && (record.kind == ImportKind::Stmt || is_part_in_this_chunk)
                            {
                                if self.c.is_external_dynamic_import(record, source_index) {
                                    // Don't follow import() dependencies
                                    continue;
                                }
                                self.stack
                                    .push(PartsFrame::Enter(record.source_index.get()));
                            }
                        }

                        // Then include this part after the files it imports
                        if is_part_in_this_chunk {
                            self.stack.push(PartsFrame::Part {
                                source_index,
                                part_index,
                                can_be_split,
                            });
                        }
                    }
                    self.stack.push(PartsFrame::File {
                        source_index,
                        is_file_in_chunk,
                        can_be_split,
                    });
                    self.stack[mark..].reverse();
                }
            }
        }
    }
}
