use crate::mal_prelude::*;
use core::fmt;
use core::num::NonZeroU32;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_ast::ImportKind;
use bun_ast::{Ref, Stmt};
use bun_collections::{ArrayHashMap, AutoBitSet, VecExt, index_sort};
use bun_core::{FeatureFlags, Output};
// Note: `bun.ast.Index` is mirrored as both `crate::Index`
// (`bun_ast::Index`) and `bun_ast::Index` via a
// TYPE_ONLY split. `CssImportOrderKind::SourceIndex` carries the js_parser
// flavor because its sole producer (`findImportedFilesInCSSOrder`) constructs
// it from parser-side indices; all consumers only call `.get()`.
use bun_ast::Index;
use bun_core::{string_joiner::StringJoiner, strings};
use bun_sourcemap as source_map;

use crate::analyze_transpiled_module;
use crate::bun_css;
use crate::bun_fs;

use crate::BundleV2;
#[cfg(debug_assertions)]
use crate::LinkerContext;
use crate::html_import_manifest as HTMLImportManifest;
use crate::options::{self, Loader};
use crate::{
    AdditionalFile, CompileResult, LinkerGraph, PartRange, PathTemplate, cheap_prefix_normalizer,
};

use crate::IndexInt;

pub struct ChunkImport {
    pub(crate) chunk_index: u32,
    pub(crate) import_kind: ImportKind,
}

// `'a` is the bundler arena.
pub struct Chunk<'a> {
    /// This is a random string and is used to represent the output path of this
    /// chunk before the final output path has been computed. See OutputPiece
    /// for more info on this technique.
    pub(crate) unique_key: &'a [u8],
    /// Like `unique_key`, but replaced with `id()` rather than the chunk's path.
    pub(crate) id_key: &'a [u8],

    /// Maps source index to bytes contributed to this chunk's output (for metafile).
    /// The value is updated during parallel chunk generation to track bytesInOutput.
    /// CONCURRENCY: the key set is frozen before codegen starts; worker threads
    /// only `fetch_add` the per-source counters (see
    /// `generate_compile_result_for_{js,css}_chunk`), so the value type is
    /// `AtomicUsize` rather than `usize` to avoid materializing aliased `&mut`.
    pub(crate) files_with_parts_in_chunk: ArrayHashMap<IndexInt, core::sync::atomic::AtomicUsize>,

    /// We must not keep pointers to this type until all chunks have been allocated.
    pub(crate) entry_bits: AutoBitSet,

    /// Owned as a `Box<[u8]>` so dropping the chunk slice frees it.
    pub(crate) final_rel_path: Box<[u8]>,
    /// The path template used to generate `final_rel_path`
    pub(crate) template: PathTemplate,

    /// For code splitting
    pub(crate) cross_chunk_imports: Vec<ChunkImport>,

    pub content: Content<'a>,

    pub entry_point: EntryPoint,

    pub(crate) output_source_map: source_map::SourceMapPieces,

    pub intermediate_output: IntermediateOutput,
    pub(crate) isolated_hash: u64,

    /// The printer reads it through `LinkerContext::renamer_for_chunk`.
    pub(crate) renamer: bun_renamer::ChunkRenamer<'a>,
    /// The nested scopes still to name after `rename_symbols_in_chunk`
    /// (number renamer only), `(source_index, module-scope child)` grouped by
    /// file; each file becomes a `NestedRenamer` task.
    pub(crate) nested_scopes_to_rename: Vec<(u32, *const bun_ast::Scope)>,

    pub compile_results_for_chunk: Box<[CompileResult]>,

    /// Byte length of the output emitted for this chunk: what `code()` returned plus
    /// the source map comment. The metafile reports it as `outputs[..].bytes`.
    pub(crate) final_output_size: usize,

    /// Pack boolean flags to reduce padding overhead.
    /// Previously 3 separate bool fields caused ~21 bytes of padding waste.
    pub(crate) flags: Flags,
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

impl Default for Content<'_> {
    fn default() -> Self {
        Content::Javascript(JavaScriptChunk::default())
    }
}

// SAFETY: `Chunk` is processed across the bundler thread pool (see
// `computeCrossChunkDependencies`, `generateChunksInParallel`). Raw-pointer
// fields (`CssAstRef`, `ChunkRenamer` arena)
// point into the bundle's storage, which outlives the
// pool join and is only mutated by the owning task; this mirrors
// `InputFile`'s blanket impls (bundle_v2.rs).
unsafe impl Send for Chunk<'_> {}
// SAFETY: workers write only the atomic counters of `files_with_parts_in_chunk` through `&Chunk`.
unsafe impl Sync for Chunk<'_> {}

impl Default for Chunk<'_> {
    fn default() -> Self {
        Chunk {
            unique_key: b"",
            id_key: b"",
            files_with_parts_in_chunk: ArrayHashMap::new(),
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
            nested_scopes_to_rename: Vec::new(),
            compile_results_for_chunk: Box::default(),
            final_output_size: 0,
            flags: Flags::default(),
        }
    }
}

impl<'a> Chunk<'a> {
    #[inline]
    pub(crate) fn is_entry_point(&self) -> bool {
        self.entry_point.is_entry_point()
    }

    /// Whether `source_index` is the entry point of this chunk. Without code
    /// splitting, the files of other entry points can print in this chunk too.
    #[inline]
    pub(crate) fn is_entry_point_file(&self, source_index: u32) -> bool {
        self.entry_point.is_entry_point() && self.entry_point.source_index() == source_index
    }

    /// Stable short name for this chunk in generated code: its final content hash, as `[hash]` prints it.
    pub(crate) fn id(&self) -> bun_core::fmt::ContentHash {
        self.template
            .placeholder
            .hash
            .unwrap_or_else(|| bun_core::fmt::ContentHash::short(self.isolated_hash))
    }

    /// The chunks reachable from chunk `start` through cross-chunk imports of the given kinds, `start` first.
    pub(crate) fn reachable_chunks(
        chunks: &[Chunk],
        start: u32,
        kinds: &[ImportKind],
    ) -> Result<Vec<u32>, AllocError> {
        let mut seen = AutoBitSet::init_empty(chunks.len())?;
        let mut order = vec![start];
        seen.set(start as usize);
        let mut i = 0;
        while i < order.len() {
            for import in chunks[order[i] as usize].cross_chunk_imports.iter() {
                if kinds.contains(&import.import_kind) && !seen.is_set(import.chunk_index as usize)
                {
                    seen.set(import.chunk_index as usize);
                    order.push(import.chunk_index);
                }
            }
            i += 1;
        }
        Ok(order)
    }

    /// Returns the HTML closing tag that must be escaped when this chunk's content
    /// is inlined into a standalone HTML file (e.g. "</script" for JS, "</style" for CSS).
    pub(crate) fn closing_tag_for_content(&self) -> &'static [u8] {
        match self.content {
            Content::Javascript(_) => b"</script",
            Content::Css(_) => b"</style",
            Content::Html => unreachable!(),
        }
    }

    pub(crate) fn get_js_chunk_for_html<'c>(
        &self,
        chunks: &'c [Chunk<'a>],
    ) -> Option<&'c Chunk<'a>> {
        self.get_js_chunk_index_for_html(chunks).map(|i| &chunks[i])
    }

    pub(crate) fn get_js_chunk_index_for_html(&self, chunks: &[Chunk]) -> Option<usize> {
        // Non-entry chunks created under code splitting carry a default
        // entry_point_id of 0, so the id alone is ambiguous; require
        // is_entry_point to find the actual entry chunk.
        let entry_point_id = self.entry_point.entry_point_id();
        chunks.iter().position(|other| {
            matches!(other.content, Content::Javascript(_))
                && other.entry_point.is_entry_point()
                && other.entry_point.entry_point_id() == entry_point_id
        })
    }

    pub(crate) fn get_css_chunk_for_html<'c>(
        &self,
        chunks: &'c [Chunk<'a>],
    ) -> Option<&'c Chunk<'a>> {
        // Look up the CSS chunk via the JS chunk's css_chunks indices.
        // This correctly handles deduplicated CSS chunks that are shared
        // across multiple HTML entry points (see issue #23668).
        let entry_point_id = self.entry_point.entry_point_id();
        for other in chunks.iter() {
            if let Content::Javascript(js) = &other.content {
                if other.entry_point.is_entry_point()
                    && other.entry_point.entry_point_id() == entry_point_id
                {
                    if let Some(&css_idx) = js.css_chunks.first() {
                        return Some(&chunks[css_idx as usize]);
                    }
                    break;
                }
            }
        }
        // Fallback: match by entry_point_id for cases without a JS chunk.
        for other in chunks.iter() {
            if matches!(other.content, Content::Css(_))
                && other.entry_point.is_entry_point()
                && other.entry_point.entry_point_id() == entry_point_id
            {
                return Some(other);
            }
        }
        None
    }

    #[inline]
    pub(crate) fn entry_bits(&self) -> &AutoBitSet {
        &self.entry_bits
    }
}

/// TODO: rewrite this
/// This implementation is just slow.
/// Can we make the JSPrinter itself track this without increasing
/// complexity a lot?
#[derive(Default)]
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
    Joiner(StringJoiner<'static>),

    #[default]
    Empty,
}

/// Owns the joined output buffer alongside the `OutputPiece` slices that
/// point into it.
///
/// Note: `StringJoiner::done()`
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
    pub(crate) fn new(pieces: Vec<OutputPiece>, buffer: Box<[u8]>) -> Self {
        OutputPieces {
            pieces,
            _buffer: buffer,
        }
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[OutputPiece] {
        &self.pieces
    }

    #[inline]
    fn len(&self) -> usize {
        self.pieces.len()
    }
}

pub struct CodeResult {
    pub buffer: Box<[u8]>,
    pub(crate) shifts: Vec<source_map::SourceMapShifts>,
}

/// What the paths `code()` writes over a chunk's references to other outputs
/// are relative to. A public path makes them outdir-relative either way.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReferencePathStyle {
    /// The directory of the chunk being emitted, as in esbuild.
    ImporterRelative,
    /// The outdir, wherever the emitting chunk lands (`bun build --compile`).
    OutdirRelative,
}

impl ReferencePathStyle {
    /// An executable loads every chunk from one virtual root, except for the
    /// browser chunks a server build emits for its HTML imports: those are
    /// served over HTTP.
    pub(crate) fn for_chunk(chunk: &Chunk, compile: bool) -> ReferencePathStyle {
        if compile
            && !chunk
                .flags
                .contains(Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
        {
            ReferencePathStyle::OutdirRelative
        } else {
            ReferencePathStyle::ImporterRelative
        }
    }
}

/// Whether `code()` records how far each path it writes moves the text after it
/// (`CodeResult::shifts`, which the chunk's source map is corrected with) and
/// appends the `//# debugId` comment. Only wanted for a chunk that gets a map.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SourceMapShiftTracking {
    Disabled,
    Enabled,
}

impl SourceMapShiftTracking {
    pub(crate) fn for_source_map(source_map: options::SourceMapOption) -> SourceMapShiftTracking {
        if source_map == options::SourceMapOption::None {
            SourceMapShiftTracking::Disabled
        } else {
            SourceMapShiftTracking::Enabled
        }
    }
}

// A token for the callers' `Option<&DynAlloc>`: `alloc_buf` uses the global allocator regardless.
type DynAlloc = ();

/// Until `DynAlloc` is a real trait object, route
/// through the global arena; mimalloc handles large allocations via mmap
/// already. Returns an empty `Vec` with `n` bytes of capacity for the caller to fill.
#[inline]
fn alloc_buf(_arena: DynAlloc, n: usize) -> Result<Vec<u8>, AllocError> {
    let mut v: Vec<u8> = Vec::new();
    v.try_reserve_exact(n).map_err(|_| AllocError)?;
    Ok(v)
}

/// Extract the `OutputFile` index from a trailing `AdditionalFile` entry
/// (the bundler always pushes `.output_file = …` for asset additional-files,
/// see bundle_v2.rs).
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
    pub(crate) fn allocator_for_size(_size: usize) -> &'static DynAlloc {
        // mimalloc serves large allocations via mmap already, so the global
        // allocator suffices (see `alloc_buf`).
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

    /// Appends `content` to `dest`, with `</` replaced by `<\/` where it starts `close_tag`.
    fn append_escaping_closing_tags(dest: &mut Vec<u8>, content: &[u8], close_tag: &[u8]) {
        let tag_suffix = &close_tag[2..];
        let mut remaining = content;
        while let Some(idx) = strings::index_of(remaining, b"</") {
            dest.extend_from_slice(&remaining[..idx]);
            remaining = &remaining[idx + 2..];

            if remaining.len() >= tag_suffix.len()
                && strings::eql_case_insensitive_ascii_ignore_length(
                    &remaining[..tag_suffix.len()],
                    tag_suffix,
                )
            {
                dest.extend_from_slice(b"<\\/");
            } else {
                dest.extend_from_slice(b"</");
            }
        }
        dest.extend_from_slice(remaining);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn code<'d>(
        &mut self,
        allocator_to_use: Option<&DynAlloc>,
        bundle: &BundleV2<'_>,
        linker_graph: &LinkerGraph<'_>,
        import_prefix: &[u8],
        // Note: `chunk` aliases `&chunks[i]`. The body only reads both, so
        // take `&` to avoid
        // overlapping `&mut Chunk` + `&mut [Chunk]` UB at every call site.
        chunk: &Chunk,
        chunks: &[Chunk],
        // Accept both `&mut usize` and
        // `Option<&mut usize>` so call sites spelled either way compile.
        display_size: impl Into<Option<&'d mut usize>>,
        reference_path_style: ReferencePathStyle,
        shift_tracking: SourceMapShiftTracking,
    ) -> Result<CodeResult, AllocError> {
        let display_size: Option<&mut usize> = display_size.into();
        match shift_tracking {
            SourceMapShiftTracking::Enabled => self.code_with_source_map_shifts::<true>(
                allocator_to_use,
                bundle,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                reference_path_style,
                None,
            ),
            SourceMapShiftTracking::Disabled => self.code_with_source_map_shifts::<false>(
                allocator_to_use,
                bundle,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                reference_path_style,
                None,
            ),
        }
    }

    /// Like `code()` but with standalone HTML support.
    /// When `standalone_chunk_contents` is provided, chunk piece references are
    /// resolved to inline code content instead of file paths. Asset references
    /// are resolved to data: URIs from url_for_css.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn code_standalone<'d>(
        &mut self,
        allocator_to_use: Option<&DynAlloc>,
        bundle: &BundleV2<'_>,
        linker_graph: &LinkerGraph<'_>,
        import_prefix: &[u8],
        // See `code()` note — `chunk` aliases `chunks[i]`; body is read-only.
        chunk: &Chunk,
        chunks: &[Chunk],
        // Accept both `&mut usize` and
        // `Option<&mut usize>` so call sites spelled either way compile.
        display_size: impl Into<Option<&'d mut usize>>,
        reference_path_style: ReferencePathStyle,
        shift_tracking: SourceMapShiftTracking,
        standalone_chunk_contents: &[Option<Box<[u8]>>],
    ) -> Result<CodeResult, AllocError> {
        let display_size: Option<&mut usize> = display_size.into();
        match shift_tracking {
            SourceMapShiftTracking::Enabled => self.code_with_source_map_shifts::<true>(
                allocator_to_use,
                bundle,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                reference_path_style,
                Some(standalone_chunk_contents),
            ),
            SourceMapShiftTracking::Disabled => self.code_with_source_map_shifts::<false>(
                allocator_to_use,
                bundle,
                linker_graph,
                import_prefix,
                chunk,
                chunks,
                display_size,
                reference_path_style,
                Some(standalone_chunk_contents),
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn code_with_source_map_shifts<const ENABLE_SOURCE_MAP_SHIFTS: bool>(
        &mut self,
        allocator_to_use: Option<&DynAlloc>,
        bundle: &BundleV2<'_>,
        linker_graph: &LinkerGraph<'_>,
        import_prefix: &[u8],
        // See `code()` note — `chunk` aliases `chunks[i]`; body is read-only.
        chunk: &Chunk,
        chunks: &[Chunk],
        display_size: Option<&mut usize>,
        reference_path_style: ReferencePathStyle,
        standalone_chunk_contents: Option<&[Option<Box<[u8]>>]>,
    ) -> Result<CodeResult, AllocError> {
        // `Graph.input_files` SoA accessors live in `Graph::InputFileColumns`;
        // `LinkerGraph.files` SoA (`items_entry_point_chunk_index`) lands with
        // the LinkerGraph work. `bun_paths` / `bun_core::fmt::count` /
        // `bun_alloc::alloc_slice` surfaces are tracked upstream.
        let graph = &bundle.graph;
        let additional_files = graph.input_files.items_additional_files();
        let unique_key_for_additional_files =
            graph.input_files.items_unique_key_for_additional_file();
        let mut file_path_posix: Vec<u8> = Vec::new();
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
                    shifts.push(shift);
                }

                let mut count: usize = 0;
                let mut from_chunk_dir = bun_paths::resolve_path::dirname::<
                    bun_paths::platform::Posix,
                >(&chunk.final_rel_path);
                if from_chunk_dir == b"." {
                    from_chunk_dir = b"";
                }

                // esbuild's `pathBetweenChunks`: with a public path configured, every
                // reference is `publicPath + outdir-relative path`. Importer-relative
                // paths would escape the prefix from chunks in subdirectories.
                let use_outdir_relative_path = from_chunk_dir.is_empty()
                    || reference_path_style == ReferencePathStyle::OutdirRelative
                    || !import_prefix.is_empty();

                let urls_for_css: &[&[u8]] = if standalone_chunk_contents.is_some() {
                    graph.ast.items_url_for_css()
                } else {
                    &[]
                };

                for piece in pieces.slice() {
                    count += piece.data.len();

                    match piece.query.kind() {
                        QueryKind::ChunkId => {
                            count += chunks[piece.query.index() as usize].id().len()
                        }
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

                                    &linker_graph.additional_output_files[output_file].dest_path
                                }
                                QueryKind::Chunk => &chunks[index].final_rel_path,
                                QueryKind::Scb => {
                                    &chunks[entry_point_chunks_for_scb[index] as usize]
                                        .final_rel_path
                                }

                                QueryKind::HtmlImport => {
                                    count += HTMLImportManifest::count_escaped_json(
                                        piece.query.index(),
                                        bundle,
                                        linker_graph,
                                        chunks,
                                    );
                                    continue;
                                }
                                QueryKind::None | QueryKind::ChunkId => unreachable!(),
                            };

                            // Normalize like the write pass below so the counted length matches.
                            let file_path: &[u8] = {
                                file_path_posix.clear();
                                file_path_posix.extend_from_slice(file_path);
                                bun_paths::resolve_path::platform_to_posix_in_place::<u8>(
                                    &mut file_path_posix,
                                );
                                &file_path_posix
                            };
                            let cheap_normalizer = cheap_prefix_normalizer(
                                import_prefix,
                                if use_outdir_relative_path {
                                    file_path
                                } else {
                                    bun_paths::resolve_path::relative_platform::<
                                        bun_paths::platform::Posix,
                                        false,
                                    >(from_chunk_dir, file_path)
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
                let total_len = count + debug_id_len;
                let mut total_buf = alloc_buf(*arena, total_len)?;

                for piece in pieces.slice() {
                    let data = piece.data();

                    if ENABLE_SOURCE_MAP_SHIFTS {
                        let mut data_offset = source_map::LineColumnOffset::default();
                        data_offset.advance(data);
                        shift.before.add(data_offset);
                        shift.after.add(data_offset);
                    }

                    total_buf.extend_from_slice(data);

                    match piece.query.kind() {
                        QueryKind::ChunkId => {
                            let id = chunks[piece.query.index() as usize].id();
                            let (bytes, len) = (id.bytes(), id.len());
                            total_buf.extend_from_slice(&bytes[..len]);
                            if ENABLE_SOURCE_MAP_SHIFTS {
                                shift.before.advance(chunk.unique_key);
                                shift.after.advance(&bytes[..len]);
                                shifts.push(shift);
                            }
                        }
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
                                        shifts.push(shift);
                                    }
                                    // For chunk content, escape closing tags (</script, </style)
                                    // that would prematurely terminate the inline tag.
                                    if piece.query.kind() == QueryKind::Chunk {
                                        Self::append_escaping_closing_tags(
                                            &mut total_buf,
                                            content,
                                            chunks[index].closing_tag_for_content(),
                                        );
                                    } else {
                                        total_buf.extend_from_slice(content);
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

                                    break 'brk &linker_graph.additional_output_files[output_file]
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
                                    let start = total_buf.len();
                                    HTMLImportManifest::write_escaped_json(
                                        piece.query.index(),
                                        bundle,
                                        linker_graph,
                                        chunks,
                                        &mut total_buf,
                                    )
                                    .expect("unreachable");

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        // The placeholder was an HtmlImport unique key, which has
                                        // the same UNIQUE_KEY_LEN as this chunk's own key.
                                        shift.before.advance(chunk.unique_key);
                                        shift.after.advance(&total_buf[start..]);
                                        shifts.push(shift);
                                    }
                                    continue;
                                }
                                _ => unreachable!(),
                            };

                            // Normalize Windows paths to '/' in a copy because the source is borrowed immutably.
                            let file_path: &[u8] = {
                                file_path_posix.clear();
                                file_path_posix.extend_from_slice(file_path);
                                bun_paths::resolve_path::platform_to_posix_in_place::<u8>(
                                    &mut file_path_posix,
                                );
                                &file_path_posix
                            };
                            let cheap_normalizer = cheap_prefix_normalizer(
                                import_prefix,
                                if use_outdir_relative_path {
                                    file_path
                                } else {
                                    bun_paths::resolve_path::relative_platform::<
                                        bun_paths::platform::Posix,
                                        false,
                                    >(from_chunk_dir, file_path)
                                },
                            );

                            if !cheap_normalizer[0].is_empty() {
                                total_buf.extend_from_slice(cheap_normalizer[0]);
                                if ENABLE_SOURCE_MAP_SHIFTS {
                                    shift.after.advance(cheap_normalizer[0]);
                                }
                            }

                            if !cheap_normalizer[1].is_empty() {
                                total_buf.extend_from_slice(cheap_normalizer[1]);
                                if ENABLE_SOURCE_MAP_SHIFTS {
                                    shift.after.advance(cheap_normalizer[1]);
                                }
                            }

                            if ENABLE_SOURCE_MAP_SHIFTS {
                                shifts.push(shift);
                            }
                        }
                        QueryKind::None => {}
                    }
                }

                if ENABLE_SOURCE_MAP_SHIFTS && FeatureFlags::SOURCE_MAP_DEBUG_ID {
                    // This comment must go before the //# sourceMappingURL comment
                    let _ = write!(
                        &mut total_buf,
                        "\n//# debugId={}\n",
                        source_map::DebugIDFormatter {
                            id: chunk.isolated_hash
                        }
                    );
                }

                debug_assert!(total_buf.len() == total_len);

                Ok(CodeResult {
                    buffer: total_buf.into_boxed_slice(),
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
                        let mut debug_id_fmt = Vec::new();
                        let _ = write!(
                            &mut debug_id_fmt,
                            "\n//# debugId={}\n",
                            source_map::DebugIDFormatter {
                                id: chunk.isolated_hash
                            }
                        );

                        let _ = arena; // Note: StringJoiner::done* allocates from global mimalloc; arena token is plumbing-only.
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
/// ```text
/// `74f92237f4a85a6aA00000009` --> `./some-asset.png`
///  ^--------------^|^------- .query.index
///  unique_key      .query.kind
/// ```
///
/// An output piece is the concatenation of source code text and an output
/// path, in that order. An array of pieces makes up an entire file.
///
/// Note: stores a
/// `RawSlice` (encapsulates the unsafe re-borrow) — the per-chunk piece count
/// is bounded by the number of unique-key boundaries, so the extra word per
/// piece is negligible against the safety win.
pub(crate) struct OutputPiece {
    /// Borrows `OutputPieces::_buffer`; `RawSlice` invariant (backing outlives
    /// holder) is upheld by `OutputPieces` keeping the box alongside `pieces`.
    data: bun_ptr::RawSlice<u8>,
    pub query: Query,
}

impl OutputPiece {
    pub(crate) fn data(&self) -> &[u8] {
        self.data.slice()
    }

    pub(crate) fn init(data_slice: &[u8], query: Query) -> OutputPiece {
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

    pub(crate) const NONE: Query = Query(0);

    pub(crate) fn new(index: u32, kind: QueryKind) -> Query {
        debug_assert!(index <= Self::INDEX_MASK);
        Query((index & Self::INDEX_MASK) | ((kind as u32) << 29))
    }

    #[inline]
    pub(crate) fn index(self) -> u32 {
        self.0 & Self::INDEX_MASK
    }

    #[inline]
    pub(crate) fn kind(self) -> QueryKind {
        // Tags 5..=7 are never assigned; match exhaustively
        // (an out-of-range tag would be a bug, not UB).
        match (self.0 >> 29) as u8 {
            0 => QueryKind::None,
            1 => QueryKind::Asset,
            2 => QueryKind::Chunk,
            3 => QueryKind::Scb,
            4 => QueryKind::HtmlImport,
            5 => QueryKind::ChunkId,
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
    /// Given a chunk index, print the chunk's content hash as `[hash]` prints it
    ChunkId = 5,
}

impl QueryKind {
    /// Single-ASCII-letter tag used in the [`UniqueKey`] wire format.
    /// `None` has no on-the-wire encoding.
    #[inline]
    pub(crate) const fn letter(self) -> u8 {
        match self {
            QueryKind::Asset => b'A',
            QueryKind::Chunk => b'C',
            QueryKind::Scb => b'S',
            QueryKind::HtmlImport => b'H',
            QueryKind::ChunkId => b'I',
            QueryKind::None => unreachable!(),
        }
    }

    /// Inverse of [`letter`]; used by the output-piece scanner.
    #[inline]
    pub(crate) const fn from_letter(b: u8) -> Option<Self> {
        match b {
            b'A' => Some(QueryKind::Asset),
            b'C' => Some(QueryKind::Chunk),
            b'S' => Some(QueryKind::Scb),
            b'H' => Some(QueryKind::HtmlImport),
            b'I' => Some(QueryKind::ChunkId),
            _ => None,
        }
    }
}

/// Length of the lowercase-hex `unique_key` prefix (16 nibbles of a `u64`).
pub(crate) const UNIQUE_KEY_PREFIX_LEN: usize = 16;
/// Total byte length of a [`UniqueKey`] on the wire: `hex16 + KIND + idx08`.
pub(crate) const UNIQUE_KEY_LEN: usize = UNIQUE_KEY_PREFIX_LEN + 1 + 8;

/// 25-byte unique-key wire format `{hex16(prefix)}{KIND}{index:08}` shared by
/// every emitter (ParseTask file/napi/sqlite loaders, server-component
/// boundaries, HTML-import manifest, chunk IDs) and consumed by exactly one
/// scanner (`LinkerContext::break_output_into_pieces`).
#[derive(Clone, Copy)]
pub(crate) struct UniqueKey {
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

/// packed struct(u64) { source_index: u32, entry_point_id: u30, is_entry_point: bool, _: u1 }
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct EntryPoint(u64);

/// so `EntryPoint` can be a u64
pub(crate) type EntryPointId = u32;

impl EntryPoint {
    const ENTRY_POINT_ID_MASK: u64 = (1 << 30) - 1;
    const IS_ENTRY_POINT_BIT: u64 = 1 << 62;

    /// The chunk that entry point `entry_point_id` itself produces.
    pub(crate) fn entry_point(source_index: u32, entry_point_id: EntryPointId) -> Self {
        EntryPoint(Self::non_entry_point(source_index, entry_point_id).0 | Self::IS_ENTRY_POINT_BIT)
    }

    /// A chunk generated on behalf of `entry_point_id` (code-split, dev-server
    /// CSS/HTML) that is not itself an entry point.
    pub(crate) fn non_entry_point(source_index: u32, entry_point_id: EntryPointId) -> Self {
        debug_assert!((entry_point_id as u64) <= Self::ENTRY_POINT_ID_MASK);
        EntryPoint(
            (source_index as u64) | (((entry_point_id as u64) & Self::ENTRY_POINT_ID_MASK) << 32),
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
    pub(crate) fn is_entry_point(self) -> bool {
        self.0 & Self::IS_ENTRY_POINT_BIT != 0
    }

    #[inline]
    pub fn set_entry_point_id(&mut self, v: EntryPointId) {
        debug_assert!((v as u64) <= Self::ENTRY_POINT_ID_MASK);
        self.0 = (self.0 & !(Self::ENTRY_POINT_ID_MASK << 32))
            | (((v as u64) & Self::ENTRY_POINT_ID_MASK) << 32);
    }
}

#[derive(Default)]
pub struct JavaScriptChunk {
    pub(crate) files_in_chunk_order: Box<[IndexInt]>,
    pub parts_in_chunk_in_order: Box<[PartRange]>,

    // for code splitting
    /// The other chunks with top-level side effects that the walk ordering
    /// this chunk reaches, in the order it finishes their first file with
    /// side effects: the order the unbundled modules would run them in.
    /// `compute_cross_chunk_dependencies` sorts this chunk's `import`
    /// statements by it.
    pub(crate) reached_chunks_in_order: Box<[u32]>,
    /// Bindings declared in this chunk that another chunk imports; named by `cross_chunk_names`.
    pub(crate) exports_to_other_chunks: ArrayHashMap<Ref, ()>,
    pub(crate) imports_from_other_chunks: ImportsFromOtherChunks,
    pub(crate) cross_chunk_prefix_stmts: Vec<Stmt>,
    pub(crate) cross_chunk_suffix_stmts: Vec<Stmt>,

    /// Indexes to CSS chunks. Currently this will only ever be zero or one
    /// items long, but smarter css chunking will allow multiple js entry points
    /// share a css file, or have an entry point contain multiple css files.
    ///
    /// Mutated while sorting chunks in `computeChunks`
    pub(crate) css_chunks: Box<[u32]>,

    /// Serialized ModuleInfo for ESM bytecode (--compile --bytecode --format=esm)
    pub(crate) module_info_bytes: Option<Box<[u8]>>,
    /// Unserialized ModuleInfo for deferred serialization (after chunk paths are resolved)
    pub(crate) module_info: Option<Box<analyze_transpiled_module::ModuleInfo>>,
}

pub struct CssChunk<'a> {
    pub(crate) imports_in_chunk_in_order: Vec<CssImportOrder<'a>>,
}

/// Borrows from `Graph::css_asts`.
pub(crate) type CssAstRef<'a> = bun_ptr::BackRef<bun_css::BundlerStyleSheet<'a>>;

/// The conditions of an `@import` rule, found through the stylesheet that owns them.
#[derive(Copy, Clone)]
pub(crate) struct ImportConditionsRef<'a> {
    pub(crate) sheet: CssAstRef<'a>,
    /// Index into the top-level rules of `sheet`.
    pub(crate) rule_index: u32,
    /// Each visit of a bare `layer` import is a layer of its own.
    pub(crate) anonymous_layer_id: Option<NonZeroU32>,
}

impl<'a> core::ops::Deref for ImportConditionsRef<'a> {
    type Target = bun_css::ImportConditions<'a>;

    fn deref(&self) -> &Self::Target {
        match &self.sheet.rules.v[self.rule_index as usize] {
            bun_css::css_parser::BundlerCssRule::Import(rule) => &rule.conditions,
            _ => unreachable!(),
        }
    }
}

impl ImportConditionsRef<'_> {
    pub(crate) fn is_same_layer(&self, other: &Self) -> bool {
        self.anonymous_layer_id == other.anonymous_layer_id
            && bun_css::ImportConditions::layers_eql(self, other)
    }
}

#[derive(Copy, Clone)]
pub struct CssImportOrder<'a> {
    pub(crate) conditions: &'a [ImportConditionsRef<'a>],

    pub(crate) kind: CssImportOrderKind<'a>,
}

#[derive(Copy, Clone, strum::IntoStaticStr)]
pub enum CssImportOrderKind<'a> {
    /// Represents earlier imports that have been made redundant by later ones (see `isConditionalImportRedundant`)
    /// We don't want to redundantly print the rules of these redundant imports
    /// BUT, the imports may include layers.
    /// We'll just print layer name declarations so that the original ordering is preserved.
    #[strum(serialize = "layers")]
    Layers(Layers<'a>),
    #[strum(serialize = "external_path")]
    ExternalPath(bun_fs::Path<'a>),
    #[strum(serialize = "source_index")]
    SourceIndex(Index),
}

#[derive(Copy, Clone)]
pub enum Layers<'a> {
    None,
    PreImport(CssAstRef<'a>),
    PostImport(CssAstRef<'a>),
}

impl<'a> Layers<'a> {
    #[inline]
    pub(crate) fn names(&self) -> &[bun_css::LayerName<'a>] {
        match self {
            Layers::None => &[],
            Layers::PreImport(sheet) => &sheet.layers_pre_import,
            Layers::PostImport(sheet) => &sheet.layer_names,
        }
    }
}

impl<'a> CssImportOrder<'a> {
    pub(crate) fn hash<H: bun_core::Hasher + ?Sized>(&self, hasher: &mut H) {
        // Not an identity: it leaves out the conditions. `css_chunk_key` compares on a hit.

        // core::mem::Discriminant is opaque/pointer-sized; hash an explicit u8 tag instead.
        let tag: u8 = match &self.kind {
            CssImportOrderKind::Layers(_) => 0,
            CssImportOrderKind::ExternalPath(_) => 1,
            CssImportOrderKind::SourceIndex(_) => 2,
        };
        bun_core::write_any_to_hasher(hasher, tag);
        match &self.kind {
            CssImportOrderKind::Layers(layers) => {
                for layer in layers.names() {
                    for (i, layer_name) in layer.v.slice().iter().enumerate() {
                        let is_last = i == layers.names().len() - 1;
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
            CssImportOrderKind::SourceIndex(idx) => {
                bun_core::write_any_to_hasher(hasher, idx.get())
            }
        }
    }

    #[cfg(debug_assertions)]
    pub(crate) fn fmt<'r>(&'r self, ctx: &'r LinkerContext<'_, 'a>) -> CssImportOrderDebug<'r, 'a> {
        CssImportOrderDebug { inner: self, ctx }
    }
}

#[cfg(debug_assertions)]
pub(crate) struct CssImportOrderDebug<'r, 'a> {
    inner: &'r CssImportOrder<'a>,
    ctx: &'r LinkerContext<'r, 'a>,
}

#[cfg(debug_assertions)]
impl fmt::Display for CssImportOrderDebug<'_, '_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(writer, "{} = ", <&'static str>::from(&self.inner.kind))?;
        match &self.inner.kind {
            CssImportOrderKind::Layers(layers) => {
                write!(writer, "[")?;
                let l = layers.names();
                for (i, layer) in l.iter().enumerate() {
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

pub(crate) type ImportsFromOtherChunks = ArrayHashMap<IndexInt, CrossChunkImportItemList>;

#[derive(Default, Clone)]
pub struct CrossChunkImportItem {
    pub(crate) r#ref: Ref,
}
pub type CrossChunkImportItemList = Vec<CrossChunkImportItem>;

impl Chunk<'_> {
    /// Fills `order` with the indices of `imports_from_other_chunks`, in the order to import them.
    /// `evaluation_rank[other]` is the position of `other` in the importing
    /// chunk's `reached_chunks_in_order` (`u32::MAX` when the walk did not
    /// reach it). ESM hoists every `import` above the chunk's own code, so
    /// this order is the only part of the source evaluation order the
    /// statements can keep.
    pub(crate) fn sort_cross_chunk_imports(
        order: &mut Vec<u32>,
        chunks: &[Self],
        imports_from_other_chunks: &mut ImportsFromOtherChunks,
        stable_source_indices: &[u32],
        evaluation_rank: &[u32],
    ) {
        for i in 0..imports_from_other_chunks.count() {
            debug_assert!({
                let chunk_index = imports_from_other_chunks.keys()[i];
                let exports_to_other_chunks = &chunks[chunk_index as usize]
                    .content
                    .javascript()
                    .exports_to_other_chunks;
                imports_from_other_chunks.values()[i]
                    .iter()
                    .all(|item| exports_to_other_chunks.contains(&item.r#ref))
            });
            let import_items = &mut imports_from_other_chunks.values_mut()[i];
            // Deterministic order; the names are only known after renaming.
            index_sort::sort_slice_by(import_items.slice_mut(), |a, b| {
                (
                    stable_source_indices[a.r#ref.source_index() as usize],
                    a.r#ref.inner_index(),
                )
                    .cmp(&(
                        stable_source_indices[b.r#ref.source_index() as usize],
                        b.r#ref.inner_index(),
                    ))
            });
        }

        let chunk_indices = imports_from_other_chunks.keys();
        order.clear();
        order.extend(0..chunk_indices.len() as u32);
        index_sort::sort_indices(order, &mut |a, b| {
            let (a, b) = (chunk_indices[a as usize], chunk_indices[b as usize]);
            (evaluation_rank[a as usize], a).cmp(&(evaluation_rank[b as usize], b))
        });
    }
}

// `Chunk` is bump-arena-allocated (no Drop on free); boxing the large arm
// would leak. The CSS/JS chunk size diff is acceptable.
#[allow(clippy::large_enum_variant)]
pub enum Content<'a> {
    Javascript(JavaScriptChunk),
    Css(CssChunk<'a>),
    Html,
}

impl<'a> Content<'a> {
    #[inline]
    pub(crate) fn is_javascript(&self) -> bool {
        matches!(self, Content::Javascript(_))
    }
    bun_core::enum_unwrap!(pub Content, Javascript => fn javascript / javascript_mut -> JavaScriptChunk);

    pub(crate) fn sourcemap(&self, default: options::SourceMapOption) -> options::SourceMapOption {
        match self {
            Content::Javascript(_) => default,
            Content::Css(_) => options::SourceMapOption::None, // TODO: css source maps
            Content::Html => options::SourceMapOption::None,
        }
    }

    pub(crate) fn loader(&self) -> Loader {
        match self {
            Content::Javascript(_) => Loader::Js,
            Content::Css(_) => Loader::Css,
            Content::Html => Loader::Html,
        }
    }

    pub(crate) fn ext(&self) -> &'static [u8] {
        match self {
            Content::Javascript(_) => b"js",
            Content::Css(_) => b"css",
            Content::Html => b"html",
        }
    }
}

pub mod bun_renamer {
    pub use bun_js_printer::renamer::*;

    #[derive(Default)]
    pub enum ChunkRenamer<'a> {
        #[default]
        None,
        Number(Box<bun_js_printer::renamer::NumberRenamer<'a>>),
        Minify(Box<bun_js_printer::renamer::MinifyRenamer>),
    }
}
