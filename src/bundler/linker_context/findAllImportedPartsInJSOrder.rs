use crate::mal_prelude::*;
use bun_ast::{ImportKind, ImportRecord};
use bun_collections::{AutoBitSet, HashMap, VecExt};

use crate::{
    Chunk, Index, IndexInt, LinkerContext, PartRange,
    chunk::{self, Order},
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

    // With code splitting a live JS file prints in exactly one chunk; `u32::MAX`: none, or no code splitting.
    let mut chunk_of_file: Vec<u32> = vec![u32::MAX; this.graph.files.len()];
    let mut runs_when_loaded: Vec<bool> = vec![false; this.graph.files.len()];
    if this.graph.code_splitting {
        for (chunk_index, chunk) in chunks.iter().enumerate() {
            if !matches!(chunk.content, chunk::Content::Javascript(_)) {
                continue;
            }
            for &source_index in chunk.files_with_parts_in_chunk.keys() {
                chunk_of_file[source_index as usize] = chunk_index as u32;
                runs_when_loaded[source_index as usize] =
                    !this.loading_file_has_no_side_effects(source_index);
            }
        }
    }

    struct Ctx<'a, 'f> {
        inner: crate::linker_context_mod::GenerateChunkCtx<'a>,
        chunk_of_file: &'f [u32],
        runs_when_loaded: &'f [bool],
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
        runs_when_loaded: &runs_when_loaded,
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
                ctx.runs_when_loaded,
                chunks_len,
            ));
        },
        chunks,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn find_imported_parts_in_js_order(
    this: &LinkerContext,
    chunk: &mut Chunk,
    part_ranges_shared: &mut Vec<PartRange>,
    parts_prefix_shared: &mut Vec<PartRange>,
    chunk_index: u32,
    chunk_of_file: &[u32],
    runs_when_loaded: &[bool],
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

    let (files_in_chunk_order, parts_in_chunk_order, reached_chunks) = {
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
            runs_when_loaded,
            reached_chunks: Vec::new(),
            reached_chunk_set: AutoBitSet::init_empty(chunks_len)?,
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

        (visitor.files, parts_in_chunk_order, visitor.reached_chunks)
    };

    match &mut chunk.content {
        chunk::Content::Javascript(js) => {
            js.files_in_chunk_order = files_in_chunk_order.into_boxed_slice();
            js.parts_in_chunk_in_order = parts_in_chunk_order.into_boxed_slice();
            js.reached_chunks_in_order = reached_chunks.into_boxed_slice();
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
    /// The chunk each file prints in; `u32::MAX` when none (or no code splitting).
    chunk_of_file: &'a [u32],
    /// Files that run something when loaded.
    runs_when_loaded: &'a [bool],
    /// `JavaScriptChunk::reached_chunks_in_order` under construction.
    reached_chunks: Vec<u32>,
    reached_chunk_set: AutoBitSet,
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
        ranges: &mut Vec<PartRange>,
        source_index: IndexInt,
        part_index: IndexInt,
    ) {
        if let Some(last_range) = ranges.last_mut() {
            if last_range.source_index.get() == source_index
                && last_range.part_index_end == part_index
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
                        let js_parts = if source_index == Index::RUNTIME.value() {
                            &mut self.parts_prefix
                        } else {
                            &mut self.part_ranges
                        };
                        Self::append_or_extend_range(js_parts, source_index, part_index);
                    }
                    continue;
                }
                PartsFrame::File {
                    source_index,
                    is_file_in_chunk,
                    can_be_split,
                } => {
                    if is_file_in_chunk {
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
                            && self.runs_when_loaded[source_index as usize]
                            && !self.reached_chunk_set.is_set(other as usize)
                        {
                            self.reached_chunk_set.set(other as usize);
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
                        // when code splitting, the chunk that prints the file (none: the one keyed by its entry points)
                        match self.chunk_of_file[source_index as usize] {
                            u32::MAX => self
                                .entry_bits
                                .eql(&self.c.graph.files.items_entry_bits()[source_index as usize]),
                            chunk_index => chunk_index == self.chunk_index,
                        }
                    } else {
                        // when NOT code splitting, include the file in the chunk if ANY of the entry points overlap
                        self.entry_bits.has_intersection(
                            &self.c.graph.files.items_entry_bits()[source_index as usize],
                        )
                    };

                    // Wrapped files can't be split because they are all inside the wrapper
                    let can_be_split = self.flags[source_index as usize].wrap == Wrap::None;

                    let parts = self.parts[source_index as usize].as_slice();
                    let parts_live = &self.c.graph.parts_live[source_index as usize];
                    if can_be_split
                        && is_file_in_chunk
                        && parts_live.is_set(bun_ast::NAMESPACE_EXPORT_PART_INDEX as usize)
                    {
                        Self::append_or_extend_range(
                            &mut self.part_ranges,
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
