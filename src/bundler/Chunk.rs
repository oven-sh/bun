use core::fmt;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, AutoBitSet, BabyList};
use bun_core::{FeatureFlags, Output};
use bun_options_types::{ImportKind, ImportRecord};
use bun_js_parser::{Index, Ref, Stmt};
use bun_sourcemap as source_map;
use bun_str::{strings, StringJoiner};

use crate::analyze_transpiled_module;
use crate::html_import_manifest as HTMLImportManifest;
use crate::options::{self, Loader};
use crate::{
    cheap_prefix_normalizer, CompileResult, CrossChunkImport, Graph, LinkerContext, LinkerGraph,
    PartRange, PathTemplate,
};

// TODO(port): Index::Int — assuming bun_js_parser exports this alongside Index
type IndexInt = u32;

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
    /// The value is updated during chunk generation to track bytesInOutput.
    pub files_with_parts_in_chunk: ArrayHashMap<IndexInt, usize>,

    /// We must not keep pointers to this type until all chunks have been allocated.
    // TODO(port): was `= undefined` in Zig (set before use)
    pub entry_bits: AutoBitSet,

    pub final_rel_path: &'static [u8],
    /// The path template used to generate `final_rel_path`
    pub template: PathTemplate,

    /// For code splitting
    pub cross_chunk_imports: BabyList<ChunkImport>,

    pub content: Content,

    pub entry_point: EntryPoint,

    pub output_source_map: source_map::SourceMapPieces,

    pub intermediate_output: IntermediateOutput,
    pub isolated_hash: u64,

    // TODO(port): was `= undefined` in Zig (set before use)
    pub renamer: bun_renamer::Renamer,

    pub compile_results_for_chunk: Box<[CompileResult]>,

    /// Pre-built JSON fragment for this chunk's metafile output entry.
    /// Generated during parallel chunk generation, joined at the end.
    pub metafile_chunk_json: &'static [u8],

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

impl Chunk {
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
    Pieces(BabyList<OutputPiece>),

    /// If the chunk doesn't have any references to other chunks, then
    /// `joiner` contains the contents of the chunk. This is more efficient
    /// because it avoids doing a join operation twice.
    Joiner(StringJoiner),

    Empty,
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

impl IntermediateOutput {
    pub fn allocator_for_size(size: usize) -> &'static dyn bun_alloc::Allocator {
        // PERF(port): Zig picks page_allocator for large buffers vs mimalloc default.
        // TODO(port): expose page_allocator / default_allocator as &'static dyn Allocator
        if size >= 512 * 1024 {
            bun_alloc::page_allocator()
        } else {
            bun_alloc::default_allocator()
        }
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
                    total += piece.data_len as usize;
                }
                total
            }
            IntermediateOutput::Joiner(joiner) => joiner.len,
            IntermediateOutput::Empty => 0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn code(
        &mut self,
        allocator_to_use: Option<&dyn bun_alloc::Allocator>,
        parse_graph: &Graph,
        linker_graph: &LinkerGraph,
        import_prefix: &[u8],
        chunk: &mut Chunk,
        chunks: &mut [Chunk],
        display_size: Option<&mut usize>,
        force_absolute_path: bool,
        enable_source_map_shifts: bool,
    ) -> Result<CodeResult, AllocError> {
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
    pub fn code_standalone(
        &mut self,
        allocator_to_use: Option<&dyn bun_alloc::Allocator>,
        parse_graph: &Graph,
        linker_graph: &LinkerGraph,
        import_prefix: &[u8],
        chunk: &mut Chunk,
        chunks: &mut [Chunk],
        display_size: Option<&mut usize>,
        force_absolute_path: bool,
        enable_source_map_shifts: bool,
        standalone_chunk_contents: &[Option<&[u8]>],
    ) -> Result<CodeResult, AllocError> {
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
        allocator_to_use: Option<&dyn bun_alloc::Allocator>,
        graph: &Graph,
        linker_graph: &LinkerGraph,
        import_prefix: &[u8],
        chunk: &mut Chunk,
        chunks: &mut [Chunk],
        display_size: Option<&mut usize>,
        force_absolute_path: bool,
        standalone_chunk_contents: Option<&[Option<&[u8]>]>,
    ) -> Result<CodeResult, AllocError> {
        // TODO(port): MultiArrayList SoA accessors — assuming `.items(.field)` → method returning slice
        let additional_files = graph.input_files.items_additional_files();
        let unique_key_for_additional_files = graph.input_files.items_unique_key_for_additional_file();
        let mut relative_platform_buf = bun_paths::path_buffer_pool().get();
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
                let mut from_chunk_dir =
                    bun_paths::dirname_posix(chunk.final_rel_path).unwrap_or(b"");
                if from_chunk_dir == b"." {
                    from_chunk_dir = b"";
                }

                let urls_for_css: &[&[u8]] = if standalone_chunk_contents.is_some() {
                    graph.ast.items_url_for_css()
                } else {
                    &[]
                };

                for piece in pieces.slice() {
                    count += piece.data_len as usize;

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
                                        if let Some(content) = scc[index] {
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
                                        Output::panic("Internal error: missing asset file");
                                    }

                                    let output_file = files.last().unwrap().output_file;

                                    &graph.additional_output_files.as_slice()[output_file].dest_path
                                }
                                QueryKind::Chunk => chunks[index].final_rel_path,
                                QueryKind::Scb => {
                                    chunks[entry_point_chunks_for_scb[index] as usize].final_rel_path
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
                                    bun_paths::relative_platform_buf(
                                        &mut relative_platform_buf,
                                        from_chunk_dir,
                                        file_path,
                                        bun_paths::Platform::Posix,
                                        false,
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

                let debug_id_len = if ENABLE_SOURCE_MAP_SHIFTS && FeatureFlags::SOURCE_MAP_DEBUG_ID {
                    // TODO(port): std.fmt.count → counting writer
                    bun_core::fmt::count(format_args!(
                        "\n//# debugId={}\n",
                        source_map::DebugIDFormatter { id: chunk.isolated_hash }
                    ))
                } else {
                    0
                };

                let allocator =
                    allocator_to_use.unwrap_or_else(|| Self::allocator_for_size(count));
                // TODO(port): allocator.alloc(u8, n) — using bun_alloc::Allocator::alloc_slice
                let mut total_buf = allocator.alloc_slice::<u8>(count + debug_id_len)?;
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
                                    QueryKind::Chunk => scc[index],
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
                                                .advance(unique_key_for_additional_files[index]),
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

                                    let output_file = files.last().unwrap().output_file;

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        shift
                                            .before
                                            .advance(unique_key_for_additional_files[index]);
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

                                    break 'brk piece_chunk.final_rel_path;
                                }
                                QueryKind::Scb => 'brk: {
                                    let piece_chunk =
                                        &chunks[entry_point_chunks_for_scb[index] as usize];

                                    if ENABLE_SOURCE_MAP_SHIFTS {
                                        shift.before.advance(piece_chunk.unique_key);
                                    }

                                    break 'brk piece_chunk.final_rel_path;
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
                            // TODO(port): @constCast — Zig mutates the file_path bytes in place.
                            // This requires the underlying storage to be mutable. Phase B should
                            // verify ownership; for now cast through raw ptr.
                            // SAFETY: file_path points into mutable bundler-owned storage in Zig.
                            unsafe {
                                bun_paths::platform_to_posix_in_place::<u8>(
                                    core::slice::from_raw_parts_mut(
                                        file_path.as_ptr() as *mut u8,
                                        file_path.len(),
                                    ),
                                );
                            }
                            let cheap_normalizer = cheap_prefix_normalizer(
                                import_prefix,
                                if from_chunk_dir.is_empty() || force_absolute_path {
                                    file_path
                                } else {
                                    bun_paths::relative_platform_buf(
                                        &mut relative_platform_buf,
                                        from_chunk_dir,
                                        file_path,
                                        bun_paths::Platform::Posix,
                                        false,
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
                        source_map::DebugIDFormatter { id: chunk.isolated_hash }
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
                let allocator =
                    allocator_to_use.unwrap_or_else(|| Self::allocator_for_size(joiner.len));

                if let Some(amt) = display_size {
                    *amt = joiner.len;
                }

                let buffer = 'brk: {
                    if ENABLE_SOURCE_MAP_SHIFTS && FeatureFlags::SOURCE_MAP_DEBUG_ID {
                        // This comment must go before the //# sourceMappingURL comment
                        // TODO(port): graph.heap.allocator() — arena allocator from Graph
                        let mut debug_id_fmt = Vec::new();
                        write!(
                            &mut debug_id_fmt,
                            "\n//# debugId={}\n",
                            source_map::DebugIDFormatter { id: chunk.isolated_hash }
                        )
                        .ok();

                        break 'brk joiner.done_with_end(allocator, &debug_id_fmt)?;
                    }

                    break 'brk joiner.done(allocator)?;
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
pub struct OutputPiece {
    /// Pointer and length split to reduce struct size
    data_ptr: *const u8,
    data_len: u32,
    pub query: Query,
}

impl OutputPiece {
    pub fn data(&self) -> &[u8] {
        // SAFETY: data_ptr/data_len always set from a valid slice via `init()`
        unsafe { core::slice::from_raw_parts(self.data_ptr, self.data_len as usize) }
    }

    pub fn init(data_slice: &[u8], query: Query) -> OutputPiece {
        OutputPiece {
            data_ptr: data_slice.as_ptr(),
            data_len: u32::try_from(data_slice.len()).unwrap(),
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
        // SAFETY: top 3 bits always written from a QueryKind
        unsafe { core::mem::transmute::<u8, QueryKind>((self.0 >> 29) as u8) }
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

    pub fn new(source_index: u32, entry_point_id: u32, is_entry_point: bool, is_html: bool) -> Self {
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
        self.0 = (self.0 & !(Self::ENTRY_POINT_ID_MASK << 32)) | (((v as u64) & Self::ENTRY_POINT_ID_MASK) << 32);
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
    pub cross_chunk_prefix_stmts: BabyList<Stmt>,
    pub cross_chunk_suffix_stmts: BabyList<Stmt>,

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
    pub imports_in_chunk_in_order: BabyList<CssImportOrder>,
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

#[allow(dead_code)]
enum CssImportKind {
    SourceIndex,
    ExternalPath,
    ImportLayers,
}

pub struct CssImportOrder {
    pub conditions: BabyList<bun_css::ImportConditions>,
    pub condition_import_records: BabyList<ImportRecord>,

    pub kind: CssImportOrderKind,
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
    ExternalPath(bun_fs::Path),
    #[strum(serialize = "source_index")]
    SourceIndex(Index),
}

// TODO(port): bun.ptr.Cow(BabyList<LayerName>, { copy = deepCloneInfallible, deinit = clearAndFree })
// LayerName payload allocations live in the arena, so the Zig deinit is a shallow clearAndFree.
// Mapped to std::borrow::Cow per PORTING.md; Phase B should thread `'bump` (arena-borrowed) and
// confirm Clone semantics match deepCloneInfallible, or switch to Arc<BabyList<_>> + Arc::make_mut.
pub struct Layers(pub std::borrow::Cow<'static, BabyList<bun_css::LayerName>>);

impl Layers {
    pub fn inner(&self) -> &BabyList<bun_css::LayerName> {
        &*self.0
    }
}

impl CssImportOrder {
    // TODO(port): hasher: anytype — Zig hasher protocol has .update([]const u8)
    pub fn hash<H: bun_core::Hasher>(&self, hasher: &mut H) {
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
                for layer in layers.inner().slice_const() {
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
            CssImportOrderKind::ExternalPath(path) => hasher.update(&path.text),
            CssImportOrderKind::SourceIndex(idx) => bun_core::write_any_to_hasher(hasher, idx),
        }
    }

    pub fn fmt<'a>(&'a self, ctx: &'a LinkerContext) -> CssImportOrderDebug<'a> {
        CssImportOrderDebug { inner: self, ctx }
    }
}

pub struct CssImportOrderDebug<'a> {
    inner: &'a CssImportOrder,
    ctx: &'a LinkerContext,
}

impl<'a> fmt::Display for CssImportOrderDebug<'a> {
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
                let source =
                    &self.ctx.parse_graph.input_files.items_source()[source_index.get() as usize];
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
pub use bun_js_parser::Ref;
pub use bun_js_parser::Index;

pub use crate::DeferredBatchTask;
pub use crate::ThreadPool;
pub use crate::ParseTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/Chunk.zig (853 lines)
//   confidence: medium
//   todos:      18
//   notes:      arena-borrowed string fields use &'static [u8] placeholder; packed structs hand-rolled with get/set accessors; MultiArrayList SoA accessors guessed; @constCast on file_path needs ownership audit; Layers Cow lifetime is 'static placeholder for 'bump
// ──────────────────────────────────────────────────────────────────────────
