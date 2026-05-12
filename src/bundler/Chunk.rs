use crate::mal_prelude::*;
use core::cell::UnsafeCell;
use core::fmt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_ast::{ImportKind, ImportRecord};
use bun_ast::{Ref, Stmt};
use bun_collections::{ArrayHashMap, AutoBitSet, VecExt};
use bun_core::{FeatureFlags, Output};
// PORT NOTE: `bun.ast.Index` is mirrored as both `crate::Index`
// (`bun_ast::Index`) and `bun_ast::Index` via a
// TYPE_ONLY split. `CssImportOrderKind::SourceIndex` carries the js_parser
// flavor because its sole producer (`findImportedFilesInCSSOrder`) constructs
// it from parser-side indices; all consumers only call `.get()`.
use bun_ast::Index;
use bun_core::{immutable as strings, string_joiner::StringJoiner};
use bun_sourcemap as source_map;

use crate::analyze_transpiled_module;
use crate::bun_css;
use crate::bun_fs;
use crate::bun_renamer;

use crate::Graph::{Graph, InputFileColumns as _};
use crate::html_import_manifest as HTMLImportManifest;
use crate::options::{self, Loader};
use crate::{
    AdditionalFile, CompileResult, CrossChunkImport, LinkerContext, LinkerGraph, PartRange,
    PathTemplate, cheap_prefix_normalizer,
};

use crate::IndexInt;

pub struct ChunkImport {
    pub chunk_index: u32,
    pub import_kind: ImportKind,
}

// TODO(port): arena lifetime — string/slice fields below borrow from the bundler arena
// (no deinit in Zig). Phase A uses &'static [u8] / Box<[T]> as placeholders; Phase B
// should thread a `'bump` lifetime or use arena slice newtypes.
pub struct Chunk {
    /// This is a random string and is used to represent the output path of this
    /// chunk before the final output path has been computed. See OutputPiece
    /// for more info on this technique.
    pub unique_key: &'static [u8],

    /// Maps source index to bytes contributed to this chunk's output (for metafile).
    /// The value is updated during parallel chunk generation to track bytesInOutput.
    /// CONCURRENCY: the key set is frozen before codegen starts; worker threads
    /// only `fetch_add` the per-source counters (see
    /// `generate_compile_result_for_{js,css}_chunk`), so the value type is
    /// `AtomicUsize` rather than `usize` to avoid materializing aliased `&mut`.
    pub files_with_parts_in_chunk: ArrayHashMap<IndexInt, core::sync::atomic::AtomicUsize>,

    /// We must not keep pointers to this type until all chunks have been allocated.
    // TODO(port): was `= undefined` in Zig (set before use)
    pub entry_bits: AutoBitSet,

    /// PORT NOTE: Zig stored this as an arena-owned `[]const u8` (linker arena);
    /// the Rust `Chunk` owns it as a `Box<[u8]>` so dropping the chunk slice
    /// frees it (matches `c.arena().dupe(u8, ..)` ownership without leaking).
    pub final_rel_path: Box<[u8]>,
    /// The path template used to generate `final_rel_path`
    pub template: PathTemplate,

    /// For code splitting
    pub cross_chunk_imports: Vec<ChunkImport>,

    pub content: Content,

    pub entry_point: EntryPoint,

    pub output_source_map: source_map::SourceMapPieces,

    pub intermediate_output: IntermediateOutput,
    pub isolated_hash: u64,

    // TODO(port): was `= undefined` in Zig (set before use). The Zig field is
    // the `renamer.Renamer` union; the Rust enum borrows from the symbol table
    // (`Renamer<'r,'src>`), which can't live in a 'static-ish struct yet.
    // `ChunkRenamer` is an owned-erased placeholder (see `crate::bun_renamer`).
    pub renamer: bun_renamer::ChunkRenamer,

    pub compile_results_for_chunk: CompileResultSlots,

    /// Pre-built JSON fragment for this chunk's metafile output entry.
    /// Generated during parallel chunk generation, joined at the end.
    /// PORT NOTE: owned `Box<[u8]>` (was arena-owned `[]const u8` in Zig).
    pub metafile_chunk_json: Box<[u8]>,

    /// Pack boolean flags to reduce padding overhead.
    /// Previously 3 separate bool fields caused ~21 bytes of padding waste.
    pub flags: Flags,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const IS_EXECUTABLE = 1 << 0;
        const HAS_HTML_CHUNK = 1 << 1;
        const IS_BROWSER_CHUNK_FROM_SERVER_BUILD = 1 << 2;
        // _padding: u5 = 0
    }
}

impl Default for Content {
    fn default() -> Self {
        Content::Javascript(JavaScriptChunk::default())
    }
}

// SAFETY: `Chunk` is processed across the bundler thread pool (see
// `computeCrossChunkDependencies`, `generateChunksInParallel`). Raw-pointer
// fields (`Layers::Borrowed`, `StringJoiner` nodes, `ChunkRenamer` arena)
// point into bundler-arena storage that outlives the
// pool join and is only mutated by the owning task. Zig has no Send/Sync
// distinction; mirror `InputFile`'s blanket impls (bundle_v2.rs).
//
// CONCURRENCY: during the `generate_compile_result_for_*_chunk` fan-out, many
// `PendingPartRange` tasks share ONE `*mut Chunk` and each writes a disjoint
// `compile_results_for_chunk[i]`. That field is therefore [`CompileResultSlots`]
// (UnsafeCell-per-slot) so the per-task write is routed through interior
// mutability and never requires an aliased `&mut Chunk` /
// `&mut [CompileResult]` — see [`Chunk::write_compile_result_slot`].
// `files_with_parts_in_chunk` values are bumped via atomic RMW (Zig
// `@atomicRmw`); the renamer is fully populated before fan-out and treated as
// read-only by the printer.
// TODO(ub-audit): `Renamer<'r>` still borrows `&'r mut {Number,Minify}Renamer`,
// so the per-chunk renamer is reborrowed mutably from each part-range task;
// the printer never writes through it, but the borrow should become `&'r`.
unsafe impl Send for Chunk {}
unsafe impl Sync for Chunk {}

/// Disjoint-slot output buffer for [`Chunk::compile_results_for_chunk`].
///
/// Allocated single-threaded in `generate_chunks_in_parallel` *before* the
/// `generate_compile_result_for_*_chunk` fan-out, written concurrently by
/// worker threads at **disjoint** indices (one slot per `PendingPartRange.i`),
/// then read single-threaded after `worker_pool.wait_for_all()`. Wrapping each
/// slot in `UnsafeCell` makes the per-task write sound through a shared view —
/// worker callbacks never need to materialize an aliased `&mut Chunk` or
/// `&mut [CompileResult]` to publish their result.
#[derive(Default)]
#[repr(transparent)]
pub struct CompileResultSlots(Box<[UnsafeCell<CompileResult>]>);

// SAFETY: writes target disjoint slots (unique `i` per task); reads happen
// only after the pool join (happens-before via `wait_for_all`).
// `CompileResult` itself is `Send`.
unsafe impl Sync for CompileResultSlots {}

impl CompileResultSlots {
    pub fn new(len: usize) -> Self {
        let mut v = Vec::with_capacity(len);
        v.resize_with(len, || UnsafeCell::new(CompileResult::default()));
        Self(v.into_boxed_slice())
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Post-join read view. Single-threaded callers only (after `wait_for_all`).
    #[inline]
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &CompileResult> + '_ {
        // SAFETY: reads happen only after the pool join; no concurrent writer.
        self.0.iter().map(|c| unsafe { &*c.get() })
    }
}

impl core::ops::Index<usize> for CompileResultSlots {
    type Output = CompileResult;
    #[inline]
    fn index(&self, i: usize) -> &CompileResult {
        // SAFETY: reads happen only after the pool join; no concurrent writer.
        unsafe { &*self.0[i].get() }
    }
}

impl Default for Chunk {
    fn default() -> Self {
        Chunk {
            unique_key: b"",
            files_with_parts_in_chunk: ArrayHashMap::new(),
            // Zig: `entry_bits: AutoBitSet = undefined` — static-arm zero init.
            entry_bits: AutoBitSet::init_empty(0).expect("static AutoBitSet"),
            final_rel_path: Box::default(),
            template: PathTemplate::default(),
            cross_chunk_imports: Vec::new(),
            content: Content::default(),
            entry_point: EntryPoint::default(),
            output_source_map: source_map::SourceMapPieces::default(),
            intermediate_output: IntermediateOutput::default(),
            isolated_hash: u64::MAX,
            renamer: bun_renamer::ChunkRenamer::default(),
            compile_results_for_chunk: CompileResultSlots::default(),
            metafile_chunk_json: Box::default(),
            flags: Flags::default(),
        }
    }
}

impl Chunk {
    /// Write `result` into `compile_results_for_chunk[i]` through a raw
    /// `*mut Chunk`, for the `generate_compile_result_for_*_chunk` worker
    /// callbacks.
    ///
    /// Many `PendingPartRange` tasks share one `*mut Chunk` and each writes a
    /// unique `i`. The write is routed entirely through raw-pointer field
    /// projection (`addr_of_mut!`) and `UnsafeCell::get`, so no `&Chunk`,
    /// `&mut Chunk`, or `&mut [CompileResult]` is ever materialized — only a
    /// raw `*mut CompileResult` to this task's slot. That keeps the write
    /// sound under Stacked Borrows even while peer tasks hold their own raw
    /// views into the same `Chunk`.
    ///
    /// # Safety
    /// - `chunk` must point to a live `Chunk` whose `compile_results_for_chunk`
    ///   was sized by `generate_chunks_in_parallel` (so `i` is in-bounds).
    /// - No two concurrent callers may pass the same `i` for the same `chunk`.
    /// - No reader may observe slot `i` until after the worker-pool join.
    #[inline]
    pub unsafe fn write_compile_result_slot(chunk: *mut Chunk, i: usize, result: CompileResult) {
        // SAFETY: per fn contract — `chunk` is live, `i` in-bounds, slot
        // exclusively owned by this caller.
        unsafe {
            // Project to the slots field with no intermediate `&`/`&mut Chunk`.
            let slots: *mut CompileResultSlots =
                core::ptr::addr_of_mut!((*chunk).compile_results_for_chunk);
            // `CompileResultSlots` is `repr(transparent)` over
            // `Box<[UnsafeCell<CompileResult>]>`; reading the boxed-slice fat
            // pointer in place (no move/drop) yields `*mut [UnsafeCell<_>]`
            // without forming `&Box`. `Box<T>` is documented to have the same
            // layout/ABI as `*mut T` (and `NonNull<T>`).
            let cells: *mut [UnsafeCell<CompileResult>] =
                core::ptr::read(slots.cast::<*mut [UnsafeCell<CompileResult>]>());
            debug_assert!(
                i < cells.len(),
                "compile_results_for_chunk slot out of bounds"
            );
            let cell: *mut UnsafeCell<CompileResult> =
                cells.cast::<UnsafeCell<CompileResult>>().add(i);
            // `UnsafeCell` is `repr(transparent)` — `*mut UnsafeCell<T>` and
            // `*mut T` address the same byte. Drop the previous (default)
            // value in place and store the result.
            *cell.cast::<CompileResult>() = result;
        }
    }

    #[inline]
    pub fn is_entry_point(&self) -> bool {
        self.entry_point.is_entry_point()
    }

    /// Returns the HTML closing tag that must be escaped when this chunk's content
    /// is inlined into a standalone HTML file (e.g. "</script" for JS, "</style" for CSS).
    pub fn closing_tag_for_content(&self) -> &'static [u8] {
        match self.content {
            Content::Javascript(_) => b"</script",
            Content::Css(_) => b"</style",
            Content::Html => unreachable!(),
        }
    }

    pub fn get_js_chunk_for_html<'a>(&self, chunks: &'a mut [Chunk]) -> Option<&'a mut Chunk> {
        let entry_point_id = self.entry_point.entry_point_id();
        for other in chunks.iter_mut() {
            if matches!(other.content, Content::Javascript(_)) {
                if other.entry_point.entry_point_id() == entry_point_id {
                    return Some(other);
                }
            }
        }
        None
    }

    pub fn get_css_chunk_for_html<'a>(&self, chunks: &'a mut [Chunk]) -> Option<&'a mut Chunk> {
        // Look up the CSS chunk via the JS chunk's css_chunks indices.
        // This correctly handles deduplicated CSS chunks that are shared
        // across multiple HTML entry points (see issue #23668).
        // PORT NOTE: reshaped for borrowck — Zig calls getJSChunkForHTML(chunks) and then
        // indexes into the same `chunks`. Here we scan immutably for the JS chunk, copy the
        // css-chunk index into a local, drop the borrow, then re-borrow mutably.
        let entry_point_id = self.entry_point.entry_point_id();
        let css_idx: Option<usize> = 'find: {
            for other in chunks.iter() {
                if let Content::Javascript(js) = &other.content {
                    if other.entry_point.entry_point_id() == entry_point_id {
                        let css_chunk_indices = &js.css_chunks[..];
                        if !css_chunk_indices.is_empty() {
                            break 'find Some(css_chunk_indices[0] as usize);
                        }
                        break 'find None;
                    }
                }
            }
            None
        };
        if let Some(idx) = css_idx {
            return Some(&mut chunks[idx]);
        }
        // Fallback: match by entry_point_id for cases without a JS chunk.
        for other in chunks.iter_mut() {
            if matches!(other.content, Content::Css(_)) {
                if other.entry_point.entry_point_id() == entry_point_id {
                    return Some(other);
                }
            }
        }
        None
    }

    #[inline]
    pub fn entry_bits(&self) -> &AutoBitSet {
        &self.entry_bits
    }
}

#[derive(Clone, Copy, Default)]
pub struct Order {
    pub source_index: IndexInt,
    pub distance: u32,
    pub tie_breaker: u32,
}

impl Order {
    pub fn less_than(_ctx: Order, a: Order, b: Order) -> bool {
        (a.distance < b.distance) || (a.distance == b.distance && a.tie_breaker < b.tie_breaker)
    }

    /// Sort so files closest to an entry point come first. If two files are
    /// equidistant to an entry point, then break the tie by sorting on the
    /// stable source index derived from the DFS over all entry points.
    pub fn sort(a: &mut [Order]) {
        // std.sort.pdq → unstable sort
        a.sort_unstable_by(|a, b| {
            if Order::less_than(Order::default(), *a, *b) {
                core::cmp::Ordering::Less
            } else if Order::less_than(Order::default(), *b, *a) {
                core::cmp::Ordering::Greater
            } else {
                core::cmp::Ordering::Equal
            }
        });
    }
}

/// TODO: rewrite this
/// This implementation is just slow.
/// Can we make the JSPrinter itself track this without increasing
/// complexity a lot?
pub enum IntermediateOutput {
    /// If the chunk has references to other chunks, then "pieces" contains
    /// the contents of the chunk. Another joiner will have to be
    /// constructed later when merging the pieces together.
    ///
    /// See OutputPiece's documentation comment for more details.
    Pieces(OutputPieces),

    /// If the chunk doesn't have any references to other chunks, then
    /// `joiner` contains the contents of the chunk. This is more efficient
    /// because it avoids doing a join operation twice.
    Joiner(StringJoiner),

    Empty,
}

/// Owns the joined output buffer alongside the `OutputPiece` slices that
/// point into it.
///
/// PORT NOTE: In Zig, `breakOutputIntoPieces` calls `j.done(alloc)` with the
/// per-worker arena, so the joined buffer outlives the chunk by construction
/// and `OutputPiece.data` stays valid. The Rust `StringJoiner::done()`
/// returns a `Box<[u8]>`; if that box is dropped at the end of
/// `break_output_into_pieces`, every piece's `data` slice dangles (ASAN
/// use-after-poison in `generate_isolated_hash`). Keep the box alive next to
/// the pieces so their raw-pointer slices remain valid for the chunk's
/// lifetime.
pub struct OutputPieces {
    pieces: Vec<OutputPiece>,
    /// Backing storage for every `OutputPiece::data` in `pieces`.
    /// Never read directly — only pins the allocation.
    _buffer: Box<[u8]>,
}

impl OutputPieces {
    #[inline]
    pub fn new(pieces: Vec<OutputPiece>, buffer: Box<[u8]>) -> Self {
        OutputPieces {
            pieces,
            _buffer: buffer,
        }
    }

    #[inline]
    pub fn slice(&self) -> &[OutputPiece] {
        &self.pieces
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.pieces.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.pieces.is_empty()
    }
}

impl Default for IntermediateOutput {
    fn default() -> Self {
        IntermediateOutput::Empty
    }
}

pub struct CodeResult {
    pub buffer: Box<[u8]>,
    pub shifts: Vec<source_map::SourceMapShifts>,
}

// PORT NOTE: Zig used `std.mem.Allocator`; the Rust crate exposes a global
// mimalloc — we don't need a vtable here yet. `()` is kept as a token so the
// caller's `Option<&DynAlloc>` plumbing matches the Zig signature; the actual
// allocation goes through `alloc_buf` (global mimalloc) regardless. Real
// arena threading (page_allocator vs default_allocator) lands when
// `bun_alloc::Allocator` is a stable trait object.
type DynAlloc = ();

/// `arena.alloc(u8, n)` — until `DynAlloc` is a real trait object, route
/// through the global arena. PERF(port): Zig picked page_allocator for
/// `n >= 512KiB`; mimalloc handles large allocations via mmap already so this
/// is a behavior match in practice.
#[inline]
fn alloc_buf(_arena: &DynAlloc, n: usize) -> Result<Box<[u8]>, AllocError> {
    // Zero-fill is required for soundness: `set_len` over uninit bytes violates
    // `Vec`'s safety contract, and `into_boxed_slice` may shrink-realloc (memcpy
    // of uninit). The memset cost is negligible next to the subsequent memcpy
    // that fully overwrites the buffer.
    let mut v: Vec<u8> = Vec::new();
    v.try_reserve_exact(n).map_err(|_| AllocError)?;
    v.resize(n, 0);
    Ok(v.into_boxed_slice())
}

/// Extract the `OutputFile` index from a trailing `AdditionalFile` entry.
/// Zig: `files.last().output_file` (untagged-union field read; bundler always
/// pushes `.output_file = …` for asset additional-files, see bundle_v2.zig).
#[inline]
fn additional_output_file_index(f: &AdditionalFile) -> usize {
    match *f {
        AdditionalFile::OutputFile(i) => i as usize,
        AdditionalFile::SourceIndex(_) => {
            unreachable!("asset additional_files entry must be .output_file")
        }
    }
}

impl IntermediateOutput {
    pub fn allocator_for_size(_size: usize) -> &'static DynAlloc {
        // PERF(port): Zig picks page_allocator for large buffers vs mimalloc default.
        // TODO(port): expose page_allocator / default_allocator as &'static dyn Allocator
        &()
    }

    /// Count occurrences of a closing HTML tag (e.g. `</script`, `</style`) in content.
    /// Used to calculate the extra bytes needed when escaping `</` → `<\/`.
    fn count_closing_tags(content: &[u8], close_tag: &[u8]) -> usize {
        let tag_suffix = &close_tag[2..];
        let mut count: usize = 0;
        let mut remaining = content;
        while let Some(idx) = strings::index_of(remaining, b"</") {
            remaining = &remaining[idx + 2..];
            if remaining.len() >= tag_suffix.len()
                && strings::eql_case_insensitive_ascii_ignore_length(
                    &remaining[..tag_suffix.len()],
                    tag_suffix,
                )
            {
                count += 1;
                remaining = &remaining[tag_suffix.len()..];
            }
        }
        count
    }

    /// Copy `content` into `dest`, escaping occurrences of `close_tag` by
    /// replacing `</` with `<\/`. Returns the number of bytes written.
    /// Caller must ensure `dest` has room for `content.len + countClosingTags(...)` bytes.
    fn memcpy_escaping_closing_tags(dest: &mut [u8], content: &[u8], close_tag: &[u8]) -> usize {
        let tag_suffix = &close_tag[2..];
        let mut remaining = content;
        let mut dst: usize = 0;
        while let Some(idx) = strings::index_of(remaining, b"</") {
            dest[dst..][..idx].copy_from_slice(&remaining[..idx]);
            dst += idx;
            remaining = &remaining[idx + 2..];

            if remaining.len() >= tag_suffix.len()
                && strings::eql_case_insensitive_ascii_ignore_length(
                    &remaining[..tag_suffix.len()],
                    tag_suffix,
                )
            {
                dest[dst] = b'<';
                dest[dst + 1] = b'\\';
                dest[dst + 2] = b'/';
                dst += 3;
            } else {
                dest[dst] = b'<';
                dest[dst + 1] = b'/';
                dst += 2;
            }
        }
        dest[dst..][..remaining.len()].copy_from_slice(remaining);
        dst += remaining.len();
        dst
    }

    pub fn get_size(&self) -> usize {
        match self {
            IntermediateOutput::Pieces(pieces) => {
                let mut total: usize = 0;
                for piece in pieces.slice() {
                    total += piece.data.len();
                }
                total
            }
            IntermediateOutput::Joiner(joiner) => joiner.len,
            IntermediateOutput::Empty => 0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn code<'d>(
        &mut self,
        allocator_to_use: Option<&DynAlloc>,
        parse_graph: &Graph,
        linker_graph: &LinkerGraph,
        import_prefix: &[u8],
        // PORT NOTE: Zig passed `*Chunk` / `[]Chunk` (freely aliased — `chunk`
        // is `&chunks[i]`). The body only reads both, so take `&` to avoid
        // overlapping `&mut Chunk` + `&mut [Chunk]` UB at every call site.
        chunk: &Chunk,
        chunks: &[Chunk],
        // PORT NOTE: `?*usize` in Zig — accept both `&mut usize` and
        // `Option<&mut usize>` so call sites that ported either way compile.
        display_size: impl Into<Option<&'d mut usize>>,
        force_absolute_path: bool,
        enable_source_map_shifts: bool,
    ) -> Result<CodeResult, AllocError> {
        let display_size: Option<&mut usize> = display_size.into();
        // switch (enable_source_map_shifts) { inline else => |b| ... }
        if enable_source_map_shifts {
            self.code_with_source_map_shifts::<true>(
                allocator_to_use,
                parse_graph,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                force_absolute_path,
                None,
            )
        } else {
            self.code_with_source_map_shifts::<false>(
                allocator_to_use,
                parse_graph,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                force_absolute_path,
                None,
            )
        }
    }

    /// Like `code()` but with standalone HTML support.
    /// When `standalone_chunk_contents` is provided, chunk piece references are
    /// resolved to inline code content instead of file paths. Asset references
    /// are resolved to data: URIs from url_for_css.
    #[allow(clippy::too_many_arguments)]
    pub fn code_standalone<'d>(
        &mut self,
        allocator_to_use: Option<&DynAlloc>,
        parse_graph: &Graph,
        linker_graph: &LinkerGraph,
        import_prefix: &[u8],
        // See `code()` PORT NOTE — `chunk` aliases `chunks[i]`; body is read-only.
        chunk: &Chunk,
        chunks: &[Chunk],
        // PORT NOTE: `?*usize` in Zig — accept both `&mut usize` and
        // `Option<&mut usize>` so call sites that ported either way compile.
        display_size: impl Into<Option<&'d mut usize>>,
        force_absolute_path: bool,
        enable_source_map_shifts: bool,
        standalone_chunk_contents: &[Option<Box<[u8]>>],
    ) -> Result<CodeResult, AllocError> {
        let display_size: Option<&mut usize> = display_size.into();
        if enable_source_map_shifts {
            self.code_with_source_map_shifts::<true>(
                allocator_to_use,
                parse_graph,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                force_absolute_path,
                Some(standalone_chunk_contents),
            )
        } else {
            self.code_with_source_map_shifts::<false>(
                allocator_to_use,
                parse_graph,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                force_absolute_path,
                Some(standalone_chunk_contents),
            )
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn code_with_source_map_shifts<const ENABLE_SOURCE_MAP_SHIFTS: bool>(
        &mut self,
        allocator_to_use: Option<&DynAlloc>,
        graph: &Graph,
        linker_graph: &LinkerGraph,
        import_prefix: &[u8],
        // See `code()` PORT NOTE — `chunk` aliases `chunks[i]`; body is read-only.
        chunk: &Chunk,
        chunks: &[Chunk],
        display_size: Option<&mut usize>,
        force_absolute_path: bool,
        standalone_chunk_contents: Option<&[Option<Box<[u8]>>]>,
    ) -> Result<CodeResult, AllocError> {
        // B-2 second pass: un-gated. `Graph.input_files` SoA accessors are now
        // real (`Graph::InputFileColumns`); `LinkerGraph.files` SoA
        // (`items_entry_point_chunk_index`) lands with the LinkerGraph un-gate.
        // `bun_paths` / `bun_core::fmt::count` / `bun_alloc::alloc_slice`
        // surfaces are tracked upstream.
        // TODO(port): MultiArrayList SoA accessors — assuming `.items(.field)` → method returning slice
        let additional_files = graph.input_files.items_additional_files();
        let unique_key_for_additional_files =
            graph.input_files.items_unique_key_for_additional_file();
        let mut relative_platform_buf = bun_paths::path_buffer_pool::get();
        let mut file_path_buf = bun_paths::path_buffer_pool::get();
        match self {
            IntermediateOutput::Pieces(pieces) => {
                let entry_point_chunks_for_scb = linker_graph.files.items_entry_point_chunk_index();

                let mut shift = source_map::SourceMapShifts {
                    after: Default::default(),
                    before: Default::default(),
                };
                let mut shifts: Vec<source_map::SourceMapShifts> = if ENABLE_SOURCE_MAP_SHIFTS {
                    Vec::with_capacity(pieces.len() as usize + 1)
                } else {
                    Vec::new()
                };

                if ENABLE_SOURCE_MAP_SHIFTS {
                    // PERF(port): was assume_capacity
                    shifts.push(shift);
                }

                let mut count: usize = 0;
                let mut from_chunk_dir = bun_paths::resolve_path::dirname::<
                    bun_paths::platform::Posix,
                >(&chunk.final_rel_path);
                if from_chunk_dir == b"." {
                    from_chunk_dir = b"";
                }

                let urls_for_css: &[&[u8]] = if standalone_chunk_contents.is_some() {
                    graph.ast.items_url_for_css()
                } else {
                    &[]
                };

                for piece in pieces.slice() {
                    count += piece.data.len();

                    match piece.query.kind() {
                        QueryKind::Chunk
                        | QueryKind::Asset
                        | QueryKind::Scb
                        | QueryKind::HtmlImport => {
                            let index = piece.query.index() as usize;

                            // In standalone mode, inline chunk content and asset data URIs
                            if let Some(scc) = standalone_chunk_contents {
                                match piece.query.kind() {
                                    QueryKind::Chunk => {
                                        if let Some(content) = scc[index].as_deref() {
                                            // Account for escaping </script or </style inside inline content.
                                            // Each occurrence of the closing tag adds 1 byte (`</` → `<\/`).
                                            count += content.len()
                                                + Self::count_closing_tags(
                                                    content,
                                                    chunks[index].closing_tag_for_content(),
                                                );
                                            continue;
                                        }
                                    }
                                    QueryKind::Asset => {
                                        // Use data: URI from url_for_css if available
                                        if index < urls_for_css.len()
                                            && !urls_for_css[index].is_empty()
                                        {
                                            count += urls_for_css[index].len();
                                            continue;
                                        }
                                    }
                                    _ => {}
                                }
                            }

                            let file_path: &[u8] = match piece.query.kind() {
                                QueryKind::Asset => {
                                    let files = &additional_files[index];
                                    if !(files.len() > 0) {
                                        Output::panic(format_args!(
                                            "Internal error: missing asset file"
                                        ));
                                    }

                                    let output_file =
                                        additional_output_file_index(files.slice().last().unwrap());

                                    &graph.additional_output_files.as_slice()[output_file].dest_path
                                }
                                QueryKind::Chunk => &chunks[index].final_rel_path,
                                QueryKind::Scb => {
                                    &chunks[entry_point_chunks_for_scb[index] as usize]
                                        .final_rel_path
                                }

                                QueryKind::HtmlImport => {
                                    // TODO(port): std.fmt.count → counting writer; assuming bun_core::fmt::count
                                    count += bun_core::fmt::count(format_args!(
                                        "{}",
                                        HTMLImportManifest::format_escaped_json(
                                            piece.query.index(),
                                            graph,
                                            chunks,
                                            linker_graph,
                                        )
                                    ));
                                    continue;
                                }
                                QueryKind::None => unreachable!(),
                            };

                            let cheap_normalizer = cheap_prefix_normalizer(
                                import_prefix,
                                if from_chunk_dir.is_empty() || force_absolute_path {
                                    file_path
                                } else {
                                    bun_paths::resolve_path::relative_platform_buf::<
                                        bun_paths::platform::Posix,
                                        false,
                                    >(
                                        &mut relative_platform_buf[..], from_chunk_dir, file_path
                                    )
                                },
                            );
                            count += cheap_normalizer[0].len() + cheap_normalizer[1].len();
                        }
                        QueryKind::None => {}
                    }
                }

                if let Some(amt) = display_size {
                    *amt = count;
                }

                let debug_id_len = if ENABLE_SOURCE_MAP_SHIFTS && FeatureFlags::SOURCE_MAP_DEBUG_ID
                {
                    // TODO(port): std.fmt.count → counting writer
                    bun_core::fmt::count(format_args!(
                        "\n//# debugId={}\n",
                        source_map::DebugIDFormatter {
                            id: chunk.isolated_hash
                        }
                    ))
                } else {
                    0
                };

                let arena = allocator_to_use.unwrap_or_else(|| Self::allocator_for_size(count));
                let mut total_buf = alloc_buf(arena, count + debug_id_len)?;
                let mut remain: &mut [u8] = &mut total_buf;

                for piece in pieces.slice() {
                    let data = piece.data();

                    if ENABLE_SOURCE_MAP_SHIFTS {
                        let mut data_offset = source_map::LineColumnOffset::default();
                        data_offset.advance(data);
                        shift.before.add(data_offset);
                        shift.after.add(data_offset);
                    }

                    if !data.is_empty() {
                        remain[..data.len()].copy_from_slice(data);
                    }

                    remain = &mut remain[data.len()..];

                    match piece.query.kind() {
                        QueryKind::Asset
                        | QueryKind::Chunk
                        | QueryKind::Scb
                        | QueryKind::HtmlImport => {
                            let index = piece.query.index() as usize;

                            // In standalone mode, inline chunk content and asset data URIs
                            if let Some(scc) = standalone_chunk_contents {
                                let inline_content: Option<&[u8]> = match piece.query.kind() {
                                    QueryKind::Chunk => scc[index].as_deref(),
                                    QueryKind::Asset => {
                                        if index < urls_for_css.len()
                                            && !urls_for_css[index].is_empty()
                                        {
                                            Some(urls_for_css[index])
                                        } else {
                                            None
                                        }
                                    }
                                    _ => None,
                                };
                                if let Some(content) = inline_content {
                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        match piece.query.kind() {
                                            QueryKind::Chunk => {
                                                shift.before.advance(chunks[index].unique_key)
                                            }
                                            QueryKind::Asset => shift
                                                .before
                                                .advance(&unique_key_for_additional_files[index]),
                                            _ => {}
                                        }
                                        shift.after.advance(content);
                                        // PERF(port): was assume_capacity
                                        shifts.push(shift);
                                    }
                                    // For chunk content, escape closing tags (</script, </style)
                                    // that would prematurely terminate the inline tag.
                                    if piece.query.kind() == QueryKind::Chunk {
                                        let written = Self::memcpy_escaping_closing_tags(
                                            remain,
                                            content,
                                            chunks[index].closing_tag_for_content(),
                                        );
                                        remain = &mut remain[written..];
                                    } else {
                                        remain[..content.len()].copy_from_slice(content);
                                        remain = &mut remain[content.len()..];
                                    }
                                    continue;
                                }
                            }

                            let file_path: &[u8] = match piece.query.kind() {
                                QueryKind::Asset => 'brk: {
                                    let files = &additional_files[index];
                                    debug_assert!(files.len() > 0);

                                    let output_file =
                                        additional_output_file_index(files.slice().last().unwrap());

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        shift
                                            .before
                                            .advance(&unique_key_for_additional_files[index]);
                                    }

                                    break 'brk &graph.additional_output_files.as_slice()
                                        [output_file]
                                        .dest_path;
                                }
                                QueryKind::Chunk => 'brk: {
                                    let piece_chunk = &chunks[index];

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        shift.before.advance(piece_chunk.unique_key);
                                    }

                                    break 'brk &piece_chunk.final_rel_path;
                                }
                                QueryKind::Scb => 'brk: {
                                    let piece_chunk =
                                        &chunks[entry_point_chunks_for_scb[index] as usize];

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        shift.before.advance(piece_chunk.unique_key);
                                    }

                                    break 'brk &piece_chunk.final_rel_path;
                                }

                                QueryKind::HtmlImport => {
                                    // TODO(port): std.io.fixedBufferStream → write into &mut [u8]
                                    let mut cursor: &mut [u8] = remain;
                                    let before_len = cursor.len();
                                    HTMLImportManifest::write_escaped_json(
                                        piece.query.index(),
                                        graph,
                                        linker_graph,
                                        chunks,
                                        &mut cursor,
                                    )
                                    .expect("unreachable");
                                    let pos = before_len - cursor.len();
                                    remain = &mut remain[pos..];

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        shift.before.advance(chunk.unique_key);
                                        // PERF(port): was assume_capacity
                                        shifts.push(shift);
                                    }
                                    continue;
                                }
                                _ => unreachable!(),
                            };

                            // normalize windows paths to '/'
                            // Zig does `@constCast(file_path)` and mutates the bundler-owned
                            // storage in place. In Rust the source slices are reachable only
                            // through `&Graph` / `&[Chunk]` here; materialising `&mut` from a
                            // shared-provenance pointer is UB regardless of whether the write
                            // happens. Copy into a pooled scratch buffer and normalise that.
                            let file_path: &[u8] = {
                                let n = file_path.len();
                                let dst = &mut file_path_buf[..n];
                                dst.copy_from_slice(file_path);
                                bun_paths::resolve_path::platform_to_posix_in_place::<u8>(dst);
                                dst
                            };
                            let cheap_normalizer = cheap_prefix_normalizer(
                                import_prefix,
                                if from_chunk_dir.is_empty() || force_absolute_path {
                                    file_path
                                } else {
                                    bun_paths::resolve_path::relative_platform_buf::<
                                        bun_paths::platform::Posix,
                                        false,
                                    >(
                                        &mut relative_platform_buf[..], from_chunk_dir, file_path
                                    )
                                },
                            );

                            if !cheap_normalizer[0].is_empty() {
                                remain[..cheap_normalizer[0].len()]
                                    .copy_from_slice(cheap_normalizer[0]);
                                remain = &mut remain[cheap_normalizer[0].len()..];
                                if ENABLE_SOURCE_MAP_SHIFTS {
                                    shift.after.advance(cheap_normalizer[0]);
                                }
                            }

                            if !cheap_normalizer[1].is_empty() {
                                remain[..cheap_normalizer[1].len()]
                                    .copy_from_slice(cheap_normalizer[1]);
                                remain = &mut remain[cheap_normalizer[1].len()..];
                                if ENABLE_SOURCE_MAP_SHIFTS {
                                    shift.after.advance(cheap_normalizer[1]);
                                }
                            }

                            if ENABLE_SOURCE_MAP_SHIFTS {
                                // PERF(port): was assume_capacity
                                shifts.push(shift);
                            }
                        }
                        QueryKind::None => {}
                    }
                }

                if ENABLE_SOURCE_MAP_SHIFTS && FeatureFlags::SOURCE_MAP_DEBUG_ID {
                    // This comment must go before the //# sourceMappingURL comment
                    let mut cursor: &mut [u8] = remain;
                    let before_len = cursor.len();
                    write!(
                        &mut cursor,
                        "\n//# debugId={}\n",
                        source_map::DebugIDFormatter {
                            id: chunk.isolated_hash
                        }
                    )
                    .unwrap_or_else(|_| panic!("unexpected NoSpaceLeft error from bufPrint"));
                    let written = before_len - cursor.len();
                    remain = &mut remain[written..];
                }

                debug_assert!(remain.is_empty());
                debug_assert!(total_buf.len() == count + debug_id_len);

                Ok(CodeResult {
                    buffer: total_buf,
                    shifts: if ENABLE_SOURCE_MAP_SHIFTS {
                        shifts
                    } else {
                        Vec::new()
                    },
                })
            }
            IntermediateOutput::Joiner(joiner) => {
                let arena =
                    allocator_to_use.unwrap_or_else(|| Self::allocator_for_size(joiner.len));

                if let Some(amt) = display_size {
                    *amt = joiner.len;
                }

                let buffer = 'brk: {
                    if ENABLE_SOURCE_MAP_SHIFTS && FeatureFlags::SOURCE_MAP_DEBUG_ID {
                        // This comment must go before the //# sourceMappingURL comment
                        // TODO(port): graph.heap.arena() — arena arena from Graph
                        let mut debug_id_fmt = Vec::new();
                        write!(
                            &mut debug_id_fmt,
                            "\n//# debugId={}\n",
                            source_map::DebugIDFormatter {
                                id: chunk.isolated_hash
                            }
                        )
                        .ok();

                        let _ = arena; // PORT NOTE: StringJoiner::done* allocates from global mimalloc; arena token is plumbing-only.
                        break 'brk joiner.done_with_end(&debug_id_fmt)?;
                    }

                    let _ = arena;
                    break 'brk joiner.done()?;
                };

                Ok(CodeResult {
                    buffer,
                    shifts: Vec::new(),
                })
            }
            IntermediateOutput::Empty => Ok(CodeResult {
                buffer: Box::default(),
                shifts: Vec::new(),
            }),
        }
    }
}

/// An issue with asset files and server component boundaries is they
/// contain references to output paths, but those paths are not known until
/// very late in the bundle. The solution is to have a magic word in the
/// bundle text (BundleV2.unique_key, a random u64; impossible to guess).
/// When a file wants a path to an emitted chunk, it emits the unique key
/// in hex followed by the kind of path it wants:
///
///     `74f92237f4a85a6aA00000009` --> `./some-asset.png`
///      ^--------------^|^------- .query.index
///      unique_key      .query.kind
///
/// An output piece is the concatenation of source code text and an output
/// path, in that order. An array of pieces makes up an entire file.
///
/// PORT NOTE: Zig split ptr+u32 len to shave 8 bytes. The Rust port stores a
/// `RawSlice` (encapsulates the unsafe re-borrow) — the per-chunk piece count
/// is bounded by the number of unique-key boundaries, so the extra word per
/// piece is negligible against the safety win.
pub struct OutputPiece {
    /// Borrows `OutputPieces::_buffer`; `RawSlice` invariant (backing outlives
    /// holder) is upheld by `OutputPieces` keeping the box alongside `pieces`.
    data: bun_ptr::RawSlice<u8>,
    pub query: Query,
}

impl OutputPiece {
    pub fn data(&self) -> &[u8] {
        self.data.slice()
    }

    pub fn init(data_slice: &[u8], query: Query) -> OutputPiece {
        OutputPiece {
            data: bun_ptr::RawSlice::new(data_slice),
            query,
        }
    }
}

/// packed struct(u32) { index: u29, kind: Kind(u3) }
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Query(u32);

impl Query {
    const INDEX_MASK: u32 = (1 << 29) - 1;

    pub const NONE: Query = Query(0);

    pub fn new(index: u32, kind: QueryKind) -> Query {
        debug_assert!(index <= Self::INDEX_MASK);
        Query((index & Self::INDEX_MASK) | ((kind as u32) << 29))
    }

    #[inline]
    pub fn index(self) -> u32 {
        self.0 & Self::INDEX_MASK
    }

    #[inline]
    pub fn kind(self) -> QueryKind {
        // Zig `enum(u3)` type-checks the field on assignment so 5..=7 are
        // unrepresentable; match exhaustively (out-of-range tag would be UB).
        match (self.0 >> 29) as u8 {
            0 => QueryKind::None,
            1 => QueryKind::Asset,
            2 => QueryKind::Chunk,
            3 => QueryKind::Scb,
            4 => QueryKind::HtmlImport,
            _ => unreachable!("Query: invalid kind tag"),
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum QueryKind {
    /// The last piece in an array uses this to indicate it is just data
    None = 0,
    /// Given a source index, print the asset's output
    Asset = 1,
    /// Given a chunk index, print the chunk's output path
    Chunk = 2,
    /// Given a server component boundary index, print the chunk's output path
    Scb = 3,
    /// Given an HTML import index, print the manifest
    HtmlImport = 4,
}

impl QueryKind {
    /// Single-ASCII-letter tag used in the [`UniqueKey`] wire format.
    /// `None` has no on-the-wire encoding.
    #[inline]
    pub const fn letter(self) -> u8 {
        match self {
            QueryKind::Asset => b'A',
            QueryKind::Chunk => b'C',
            QueryKind::Scb => b'S',
            QueryKind::HtmlImport => b'H',
            QueryKind::None => unreachable!(),
        }
    }

    /// Inverse of [`letter`]; used by the output-piece scanner.
    #[inline]
    pub const fn from_letter(b: u8) -> Option<Self> {
        match b {
            b'A' => Some(QueryKind::Asset),
            b'C' => Some(QueryKind::Chunk),
            b'S' => Some(QueryKind::Scb),
            b'H' => Some(QueryKind::HtmlImport),
            _ => None,
        }
    }
}

/// Length of the lowercase-hex `unique_key` prefix (16 nibbles of a `u64`).
pub const UNIQUE_KEY_PREFIX_LEN: usize = 16;
/// Total byte length of a [`UniqueKey`] on the wire: `hex16 + KIND + idx08`.
pub const UNIQUE_KEY_LEN: usize = UNIQUE_KEY_PREFIX_LEN + 1 + 8;

/// 25-byte unique-key wire format `{hex16(prefix)}{KIND}{index:08}` shared by
/// every emitter (ParseTask file/napi/sqlite loaders, server-component
/// boundaries, HTML-import manifest, chunk IDs) and consumed by exactly one
/// scanner (`LinkerContext::break_output_into_pieces`). Mirrors Zig
/// `"{f}{LETTER}{d:0>8}"` with `bun.fmt.hexIntLower` byte-for-byte.
#[derive(Clone, Copy)]
pub struct UniqueKey {
    pub prefix: u64,
    pub kind: QueryKind,
    pub index: u32,
}

impl fmt::Display for UniqueKey {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}{}{:08}",
            bun_core::fmt::hex_int_lower::<16>(self.prefix),
            self.kind.letter() as char,
            self.index,
        )
    }
}

pub type OutputPieceIndex = Query;

/// packed struct(u64) { source_index: u32, entry_point_id: u30, is_entry_point: bool, is_html: bool }
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct EntryPoint(u64);

/// so `EntryPoint` can be a u64
// TODO(port): Rust has no native u30 — using u32 with mask. Zig: `pub const ID = u30;`
pub type EntryPointId = u32;

impl EntryPoint {
    const ENTRY_POINT_ID_MASK: u64 = (1 << 30) - 1;

    pub fn new(
        source_index: u32,
        entry_point_id: u32,
        is_entry_point: bool,
        is_html: bool,
    ) -> Self {
        debug_assert!((entry_point_id as u64) <= Self::ENTRY_POINT_ID_MASK);
        EntryPoint(
            (source_index as u64)
                | (((entry_point_id as u64) & Self::ENTRY_POINT_ID_MASK) << 32)
                | ((is_entry_point as u64) << 62)
                | ((is_html as u64) << 63),
        )
    }

    #[inline]
    pub fn source_index(self) -> u32 {
        self.0 as u32
    }

    #[inline]
    pub fn entry_point_id(self) -> u32 {
        ((self.0 >> 32) & Self::ENTRY_POINT_ID_MASK) as u32
    }

    #[inline]
    pub fn is_entry_point(self) -> bool {
        (self.0 >> 62) & 1 != 0
    }

    #[inline]
    pub fn is_html(self) -> bool {
        (self.0 >> 63) & 1 != 0
    }

    // Zig callers mutate packed fields directly (e.g. `chunk.entry_point.is_entry_point = true`).
    #[inline]
    pub fn set_source_index(&mut self, v: u32) {
        self.0 = (self.0 & !0xFFFF_FFFF) | (v as u64);
    }

    #[inline]
    pub fn set_entry_point_id(&mut self, v: EntryPointId) {
        debug_assert!((v as u64) <= Self::ENTRY_POINT_ID_MASK);
        self.0 = (self.0 & !(Self::ENTRY_POINT_ID_MASK << 32))
            | (((v as u64) & Self::ENTRY_POINT_ID_MASK) << 32);
    }

    #[inline]
    pub fn set_is_entry_point(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << 62)) | ((v as u64) << 62);
    }

    #[inline]
    pub fn set_is_html(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << 63)) | ((v as u64) << 63);
    }
}

#[derive(Default)]
pub struct JavaScriptChunk {
    pub files_in_chunk_order: Box<[IndexInt]>,
    pub parts_in_chunk_in_order: Box<[PartRange]>,

    // for code splitting
    // TODO(port): Zig uses ArrayHashMapUnmanaged(Ref, string, Ref.ArrayHashCtx, false) — custom hash ctx
    pub exports_to_other_chunks: ArrayHashMap<Ref, &'static [u8]>,
    pub imports_from_other_chunks: ImportsFromOtherChunks,
    pub cross_chunk_prefix_stmts: Vec<Stmt>,
    pub cross_chunk_suffix_stmts: Vec<Stmt>,

    /// Indexes to CSS chunks. Currently this will only ever be zero or one
    /// items long, but smarter css chunking will allow multiple js entry points
    /// share a css file, or have an entry point contain multiple css files.
    ///
    /// Mutated while sorting chunks in `computeChunks`
    pub css_chunks: Box<[u32]>,

    /// Serialized ModuleInfo for ESM bytecode (--compile --bytecode --format=esm)
    pub module_info_bytes: Option<Box<[u8]>>,
    /// Unserialized ModuleInfo for deferred serialization (after chunk paths are resolved)
    pub module_info: Option<Box<analyze_transpiled_module::ModuleInfo>>,
}

pub struct CssChunk {
    pub imports_in_chunk_in_order: Vec<CssImportOrder>,
    /// When creating a chunk, this is to be an uninitialized slice with
    /// length of `imports_in_chunk_in_order`
    ///
    /// Multiple imports may refer to the same file/stylesheet, but may need to
    /// wrap them in conditions (e.g. a layer).
    ///
    /// When we go through the `prepareCssAstsForChunk()` step, each import will
    /// create a shallow copy of the file's AST (just dereferencing the pointer).
    pub asts: Box<[bun_css::BundlerStyleSheet]>,
}

impl Drop for CssChunk {
    fn drop(&mut self) {
        // Zig `asts: []BundlerStyleSheet` is an arena slice of bitwise shallow
        // copies (see `prepareCssAstsForChunk` `ptr::read`). Multiple slots may
        // alias the same source AST's heap buffers when a file is imported more
        // than once, so element-wise drop would double-free.
        core::mem::forget(core::mem::take(&mut self.asts));
    }
}

/// Zig: `const CssImportKind = enum { source_index, external_path, import_layers }` is the
/// (private) tag enum for `CssImportOrder.kind: union(enum) { ... }`. In Rust the tagged
/// union is `CssImportOrderKind`; callers that switch on `css_import.kind` reference it via
/// the Zig-spelled name, so re-export it here.
pub type CssImportKind = CssImportOrderKind;

pub struct CssImportOrder {
    pub conditions: Vec<bun_css::ImportConditions>,
    pub condition_import_records: Vec<ImportRecord>,

    pub kind: CssImportOrderKind,
}

impl Drop for CssImportOrder {
    fn drop(&mut self) {
        // `conditions`: bitwise-shared across multiple order entries by
        // `findImportedFilesInCSSOrder` (`bitwise_copy(wrapping_conditions)`);
        // freeing here would double-free. Global-backed → leaks until the
        // aliasing is replaced (PORTING.md §CSS-import-order).
        core::mem::forget(core::mem::take(&mut self.conditions));
        // `condition_import_records`: every populated value is uniquely owned
        // (moved `all_import_records`) or an empty-Vec bitwise copy (cap == 0,
        // drop is a no-op). Normal drop frees the owned buffers; no
        // double-free path exists.
    }
}

#[derive(strum::IntoStaticStr)]
pub enum CssImportOrderKind {
    /// Represents earlier imports that have been made redundant by later ones (see `isConditionalImportRedundant`)
    /// We don't want to redundantly print the rules of these redundant imports
    /// BUT, the imports may include layers.
    /// We'll just print layer name declarations so that the original ordering is preserved.
    #[strum(serialize = "layers")]
    Layers(Layers),
    #[strum(serialize = "external_path")]
    ExternalPath(bun_fs::Path<'static>),
    #[strum(serialize = "source_index")]
    SourceIndex(Index),
}

// TODO(port): bun.ptr.Cow(Vec<LayerName>, { copy = deepCloneInfallible, deinit = clearAndFree })
// LayerName payload allocations live in the arena, so the Zig deinit is a shallow clearAndFree.
// `std::borrow::Cow<'_, Vec<_>>` requires `Vec: Clone` (not implemented). Port the
// Zig `bun.ptr.Cow` shape directly: a tag + raw pointer for the borrowed arm. Phase B should
// thread `'bump` (arena-borrowed) and confirm Clone semantics match deepCloneInfallible.
pub enum Layers {
    /// Borrowed from another `CssImportOrder`'s `Layers` or the parsed stylesheet.
    Borrowed(bun_ptr::BackRef<Vec<bun_css::LayerName>>),
    Owned(Vec<bun_css::LayerName>),
}

impl Layers {
    #[inline]
    pub fn inner(&self) -> &Vec<bun_css::LayerName> {
        match self {
            Layers::Borrowed(p) => p.get(),
            Layers::Owned(b) => b,
        }
    }

    /// Zig: `Chunk.CssImportOrder.Layers.borrow(ptr)` — Cow::Borrowed.
    ///
    /// Takes `NonNull` (not `&Vec`) because the sole caller in
    /// `findImportedFilesInCSSOrder.rs` type-puns the lifetime-erased shadow
    /// `crate::bun_css::LayerName` to the real `::bun_css::LayerName` via a
    /// raw-pointer cast — that nominal-type erasure cannot go through `&`.
    /// The pointee is arena-owned storage that outlives the chunk pipeline
    /// (see TODO(port) above re: `'bump`); `BackRef` encapsulates that
    /// invariant so `inner()`/`to_owned()` deref sites are safe.
    #[inline]
    pub fn borrow(p: core::ptr::NonNull<Vec<bun_css::LayerName>>) -> Self {
        Layers::Borrowed(bun_ptr::BackRef::from(p))
    }

    /// Zig: `bun.ptr.Cow.replace` — drop owned (arena-backed, so no-op) and
    /// install a fresh owned value.
    #[inline]
    pub fn replace(&mut self, new: Vec<bun_css::LayerName>) {
        *self = Layers::Owned(new);
    }

    /// Zig: `bun.ptr.Cow.toOwned` — if borrowed, deep-clone into an owned
    /// list and return `&mut` to it; if already owned, return as-is.
    pub fn to_owned(&mut self) -> &mut Vec<bun_css::LayerName> {
        if let Layers::Borrowed(p) = *self {
            *self = Layers::Owned(p.deep_clone_with(|l| l.clone()));
        }
        match self {
            Layers::Owned(b) => b,
            Layers::Borrowed(_) => unreachable!(),
        }
    }
}

impl CssImportOrder {
    // TODO(port): hasher: anytype — Zig hasher protocol has .update([]const u8)
    pub fn hash<H: bun_core::Hasher + ?Sized>(&self, hasher: &mut H) {
        // TODO: conditions, condition_import_records

        // Zig: bun.writeAnyToHasher(hasher, std.meta.activeTag(this.kind)) — feeds the small-int
        // tag bytes. core::mem::Discriminant is opaque/pointer-sized; hash an explicit u8 instead.
        // TODO(port): activeTag byte width — Zig's Tag(union) here is u2; u8 keeps hash stable.
        let tag: u8 = match &self.kind {
            CssImportOrderKind::Layers(_) => 0,
            CssImportOrderKind::ExternalPath(_) => 1,
            CssImportOrderKind::SourceIndex(_) => 2,
        };
        bun_core::write_any_to_hasher(hasher, &tag);
        match &self.kind {
            CssImportOrderKind::Layers(layers) => {
                for layer in layers.inner().slice() {
                    for (i, layer_name) in layer.v.slice().iter().enumerate() {
                        let is_last = i == layers.inner().len() as usize - 1;
                        if is_last {
                            hasher.update(layer_name);
                        } else {
                            hasher.update(layer_name);
                            hasher.update(b".");
                        }
                    }
                }
                hasher.update(b"\x00");
            }
            CssImportOrderKind::ExternalPath(path) => hasher.update(path.text),
            // PORT NOTE: `Index` is a `#[repr(transparent)]` u32 newtype but
            // doesn't impl `AsBytes`; hash the inner u32 (Zig hashed the
            // `Index.Int` bytes directly).
            CssImportOrderKind::SourceIndex(idx) => {
                bun_core::write_any_to_hasher(hasher, &idx.get())
            }
        }
    }

    pub fn fmt<'a, 'ctx>(&'a self, ctx: &'a LinkerContext<'ctx>) -> CssImportOrderDebug<'a, 'ctx> {
        CssImportOrderDebug { inner: self, ctx }
    }
}

pub struct CssImportOrderDebug<'a, 'ctx> {
    inner: &'a CssImportOrder,
    // PORT NOTE: split lifetimes — `LinkerContext<'ctx>` is invariant over `'ctx`,
    // so coupling the borrow lifetime to the struct param (`&'a LinkerContext<'a>`)
    // forces every caller's `&CssImportOrder` and `&LinkerContext` to share one
    // region. The Display impl only reads `ctx.parse_graph` (a raw `*mut Graph`),
    // so the inner `'ctx` need not relate to `'a`.
    ctx: &'a LinkerContext<'ctx>,
}

impl<'a, 'ctx> fmt::Display for CssImportOrderDebug<'a, 'ctx> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(writer, "{} = ", <&'static str>::from(&self.inner.kind))?;
        match &self.inner.kind {
            CssImportOrderKind::Layers(layers) => {
                write!(writer, "[")?;
                let l = layers.inner();
                for (i, layer) in l.slice_const().iter().enumerate() {
                    if i > 0 {
                        write!(writer, ", ")?;
                    }
                    write!(writer, "\"{}\"", layer)?;
                }

                write!(writer, "]")?;
            }
            CssImportOrderKind::ExternalPath(path) => {
                write!(writer, "\"{}\"", bstr::BStr::new(&path.pretty))?;
            }
            CssImportOrderKind::SourceIndex(source_index) => {
                // SAFETY: `parse_graph` is a backref into `BundleV2.graph`, valid
                // for the lifetime of the link step that owns this LinkerContext.
                let source =
                    &self.ctx.parse_graph().input_files.items_source()[source_index.get() as usize];
                write!(
                    writer,
                    "{} ({})",
                    source_index.get(),
                    bstr::BStr::new(&source.path.text)
                )?;
            }
        }
        Ok(())
    }
}

pub type ImportsFromOtherChunks = ArrayHashMap<IndexInt, crate::cross_chunk_import::ItemList>;
// TODO(port): CrossChunkImport.Item.List — assuming exported as ItemList from cross_chunk_import module

pub enum Content {
    Javascript(JavaScriptChunk),
    Css(CssChunk),
    Html,
}

impl Content {
    #[inline]
    pub fn is_javascript(&self) -> bool {
        matches!(self, Content::Javascript(_))
    }
    #[inline]
    pub fn is_css(&self) -> bool {
        matches!(self, Content::Css(_))
    }
    #[inline]
    pub fn is_html(&self) -> bool {
        matches!(self, Content::Html)
    }
    bun_core::enum_unwrap!(pub Content, Javascript => fn javascript / javascript_mut -> JavaScriptChunk);
    bun_core::enum_unwrap!(pub Content, Css        => fn css        / css_mut        -> CssChunk);

    pub fn sourcemap(&self, default: options::SourceMapOption) -> options::SourceMapOption {
        match self {
            Content::Javascript(_) => default,
            Content::Css(_) => options::SourceMapOption::None, // TODO: css source maps
            Content::Html => options::SourceMapOption::None,
        }
    }

    pub fn loader(&self) -> Loader {
        match self {
            Content::Javascript(_) => Loader::Js,
            Content::Css(_) => Loader::Css,
            Content::Html => Loader::Html,
        }
    }

    pub fn ext(&self) -> &'static [u8] {
        match self {
            Content::Javascript(_) => b"js",
            Content::Css(_) => b"css",
            Content::Html => b"html",
        }
    }
}

// Re-exports (Zig: pub const X = ...)
pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/Chunk.zig
