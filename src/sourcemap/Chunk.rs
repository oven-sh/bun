use bun_ast::{Loc, Source};
use bun_core::{MutableString, strings};
use bun_paths::{PathBuffer, fs::FileSystem};

use crate::{
    InternalSourceMap, LineOffsetTable, SourceMapState, append_mapping_to_buffer,
    internal_source_map, line_offset_table, line_offset_table::LineOffsetTableColumns as _,
};

#[derive(Clone)]
pub struct Chunk {
    pub buffer: MutableString,

    pub mappings_count: usize,

    /// This end state will be used to rewrite the start of the following source
    /// map chunk so that the delta-encoded VLQ numbers are preserved.
    pub end_state: SourceMapState,

    /// There probably isn't a source mapping at the end of the file (nor should
    /// there be) but if we're appending another source map chunk after this one,
    /// we'll need to know how many characters were in the last line we generated.
    pub final_generated_column: i32,

    /// ignore empty chunks
    pub should_ignore: bool,
}

impl Default for Chunk {
    fn default() -> Self {
        Self::init_empty()
    }
}

impl Chunk {
    pub fn init_empty() -> Chunk {
        Chunk {
            buffer: MutableString::init_empty(),
            mappings_count: 0,
            end_state: SourceMapState::default(),
            final_generated_column: 0,
            should_ignore: true,
        }
    }

    // `pub fn deinit` dropped — body only freed `self.buffer`, which `Drop` on
    // `MutableString` handles automatically.

    /// # Safety
    /// The returned `Chunk` aliases `self.buffer`'s allocation; at most one may be dropped.
    #[inline]
    pub unsafe fn alias(&self) -> Chunk {
        // SAFETY: `self` is a valid aligned reference; caller upholds the at-most-one-drop
        // contract above so the bitwise copy never causes a double free of `buffer`.
        unsafe { core::ptr::read(self) }
    }

    pub fn print_source_map_contents<const ASCII_ONLY: bool>(
        &self,
        source: &Source,
        mutable: &mut MutableString,
        include_sources_contents: bool,
    ) -> Result<(), crate::Error> {
        print_source_map_contents_json::<ASCII_ONLY>(
            source,
            mutable,
            include_sources_contents,
            self.buffer.list.as_slice(),
        )
    }

    /// `chunk.buffer` holds an InternalSourceMap blob (the runtime path). Re-encode
    /// to a standard VLQ "mappings" string before emitting JSON.
    pub fn print_source_map_contents_from_internal<const ASCII_ONLY: bool>(
        &self,
        source: &Source,
        mutable: &mut MutableString,
        include_sources_contents: bool,
    ) -> Result<(), crate::Error> {
        let ism = InternalSourceMap {
            data: self.buffer.list.as_ptr(),
        };
        let mut vlq = MutableString::init_empty();
        ism.append_vlq_to(&mut vlq);
        print_source_map_contents_json::<ASCII_ONLY>(
            source,
            mutable,
            include_sources_contents,
            vlq.list.as_slice(),
        )
    }
}

fn print_source_map_contents_json<const ASCII_ONLY: bool>(
    source: &Source,
    mutable: &mut MutableString,
    include_sources_contents: bool,
    mappings: &[u8],
) -> Result<(), crate::Error> {
    let mut filename_buf = PathBuffer::uninit();
    let mut filename: &[u8] = source.path.text;
    let top_level_dir: &[u8] = FileSystem::instance().top_level_dir();
    if strings::has_prefix(filename, top_level_dir) {
        filename = &filename[top_level_dir.len() - 1..];
    } else if !filename.is_empty() && filename[0] != b'/' {
        filename_buf[0] = b'/';
        filename_buf[1..][..filename.len()].copy_from_slice(filename);
        filename = &filename_buf[0..filename.len() + 1];
    }

    mutable
        .grow_if_needed(
            filename.len()
                + 2
                + (source.contents().len() * (include_sources_contents as usize))
                + mappings.len()
                + 32
                + 39
                + 29
                + 22
                + 20,
        )
        .expect("unreachable");
    mutable.append(b"{\n  \"version\":3,\n  \"sources\": [")?;

    bun_core::quote_for_json(filename, mutable, ASCII_ONLY)?;

    if include_sources_contents {
        mutable.append(b"],\n  \"sourcesContent\": [")?;
        bun_core::quote_for_json(source.contents(), mutable, ASCII_ONLY)?;
    }

    mutable.append(b"],\n  \"mappings\": ")?;
    bun_core::quote_for_json(mappings, mutable, ASCII_ONLY)?;
    mutable.append(b", \"names\": []\n}")?;
    Ok(())
}

// NOTE: `VLQSourceMap` is the only `SourceMapFormatCtx` implementor and
// `NewBuilder`'s hot methods are concretized on it
// (see the `impl NewBuilder<VLQSourceMap>` block below).

/// Trait capturing the methods `SourceMapFormat<T>` forwards to its `ctx`.
pub trait SourceMapFormatCtx: Sized {
    fn init(prepend_count: bool) -> Self;
    fn append_line_separator(&mut self) -> Result<(), crate::Error>;
    fn append(
        &mut self,
        current_state: SourceMapState,
        prev_state: SourceMapState,
    ) -> Result<(), crate::Error>;
    fn should_ignore(&self) -> bool;
    fn get_buffer(&mut self) -> &mut MutableString;
    fn take_buffer(&mut self) -> MutableString;
    fn get_count(&self) -> usize;
}

pub struct SourceMapFormat<T: SourceMapFormatCtx> {
    pub ctx: T,
}

impl<T: SourceMapFormatCtx> SourceMapFormat<T> {
    pub fn init(prepend_count: bool) -> Self {
        Self {
            ctx: T::init(prepend_count),
        }
    }

    #[inline(always)]
    pub fn append_line_separator(&mut self) -> Result<(), crate::Error> {
        self.ctx.append_line_separator()
    }

    #[inline(always)]
    pub fn append(
        &mut self,
        current_state: SourceMapState,
        prev_state: SourceMapState,
    ) -> Result<(), crate::Error> {
        self.ctx.append(current_state, prev_state)
    }

    #[inline]
    pub fn should_ignore(&self) -> bool {
        self.ctx.should_ignore()
    }

    #[inline]
    pub fn get_buffer(&mut self) -> &mut MutableString {
        // Returns `&mut` to avoid a double-ownership footgun;
        // callers mutate in place.
        self.ctx.get_buffer()
    }

    #[inline]
    pub fn take_buffer(&mut self) -> MutableString {
        self.ctx.take_buffer()
    }

    #[inline]
    pub fn get_count(&self) -> usize {
        self.ctx.get_count()
    }
}

pub struct VLQSourceMap {
    pub data: MutableString,
    pub internal: Option<internal_source_map::Builder>,
    pub count: usize,
    pub offset: usize,
    pub approximate_input_line_count: usize,
}

impl Default for VLQSourceMap {
    fn default() -> Self {
        Self {
            data: MutableString::init_empty(),
            internal: None,
            count: 0,
            offset: 0,
            approximate_input_line_count: 0,
        }
    }
}

impl SourceMapFormatCtx for VLQSourceMap {
    fn init(prepend_count: bool) -> VLQSourceMap {
        if prepend_count {
            return VLQSourceMap {
                data: MutableString::init_empty(),
                internal: Some(internal_source_map::Builder::init()),
                ..Default::default()
            };
        }

        VLQSourceMap {
            data: MutableString::init_empty(),
            ..Default::default()
        }
    }

    // PERF: `#[inline(always)]` — fat-LTO/CGU=1 was *not* inlining this trait
    // method into `add_source_mapping` (objdump showed 3× `call` per mapping;
    // 11.77% of `append` samples on the `push %rbp` prologue). Forcing it
    // leaves only the 64-mapping `flush_window` out-of-line.
    #[inline(always)]
    fn append_line_separator(&mut self) -> Result<(), crate::Error> {
        if let Some(b) = &mut self.internal {
            b.append_line_separator();
            return Ok(());
        }
        self.data.append_char(b';')?;
        Ok(())
    }

    #[inline(always)]
    fn append(
        &mut self,
        current_state: SourceMapState,
        prev_state: SourceMapState,
    ) -> Result<(), crate::Error> {
        if let Some(b) = &mut self.internal {
            b.append_mapping(&current_state);
            self.count += 1;
            return Ok(());
        }

        let last_byte: u8 = if self.data.list.len() > self.offset {
            self.data.list[self.data.list.len() - 1]
        } else {
            0
        };

        append_mapping_to_buffer(&mut self.data, last_byte, prev_state, current_state);
        self.count += 1;
        Ok(())
    }

    fn should_ignore(&self) -> bool {
        self.count == 0
    }

    fn get_buffer(&mut self) -> &mut MutableString {
        if let Some(b) = &mut self.internal {
            // Move the finalized buffer out and clear the builder.
            self.data = b.finalize_take();
            self.internal = None;
        }
        &mut self.data
    }

    fn take_buffer(&mut self) -> MutableString {
        if let Some(b) = &mut self.internal {
            self.data = b.finalize_take();
            self.internal = None;
        }
        core::mem::replace(&mut self.data, MutableString::init_empty())
    }

    fn get_count(&self) -> usize {
        self.count
    }
}

pub struct NewBuilder<T: SourceMapFormatCtx> {
    pub source_map: SourceMapFormat<T>,
    /// `ManuallyDrop` because in the bundler `printWithWriter` path this is a
    /// shallow bitwise copy of `LinkerGraph.files[i].line_offset_table` and
    /// must not be dropped here. The runtime/transpiler `printAst`/`printCommonJS`
    /// paths now defer table construction (see `lazy_line_offset_tables`), so
    /// this is left `EMPTY` there.
    pub line_offset_tables: core::mem::ManuallyDrop<line_offset_table::List<bun_alloc::AstAlloc>>,

    /// Lazily-generated, *owned* line-offset table for the runtime/transpiler
    /// print path. When no precomputed `line_offset_tables` is supplied and
    /// `deferred_source` is set, this stays `None` until the first
    /// `add_source_mapping` call, which fills it via `LineOffsetTable::generate`.
    /// `AstAlloc`-typed because the only caller that supplies a precomputed
    /// table is the bundler (`LinkerGraph.files[i].line_offset_table`), which
    /// builds it with `generate_in::<AstAlloc>` so the slab and every per-row
    /// `columns_for_non_ascii` payload bulk-free with the worker arena instead
    /// of needing a per-file teardown loop. Runtime/transpiler callers leave
    /// this `EMPTY` and use the `Global`-backed `lazy_line_offset_tables` below.
    /// Building the table only on demand means
    /// modules that emit no source mappings (asset/JSON shims, empty modules,
    /// fully-stripped files) never pay the full-source scan + `MultiArrayList`
    /// allocation. Unlike `line_offset_tables` (a `ManuallyDrop` bitwise alias
    /// of borrowed linker storage) this table is uniquely owned;
    /// [`OwnedLineOffsetTables`] drains its `columns_for_non_ascii` payloads on
    /// drop (`MultiArrayList::Drop` is slab-only).
    pub lazy_line_offset_tables: Option<OwnedLineOffsetTables>,

    /// Source bytes + approximate line count for the lazy path. `&'static` is a
    /// lifetime erasure of a borrow into `Source.contents` (same rationale as
    /// `line_offset_table_byte_offset_list` below — a real lifetime would infect
    /// every `Printer<'a, …>` instantiation). `None` ⇒ eager-table mode (a
    /// precomputed table was supplied, or source maps are disabled).
    pub deferred_source: Option<(&'static [u8], i32)>,

    pub prev_state: SourceMapState,
    pub last_generated_update: u32,
    pub generated_column: i32,
    pub prev_loc: Loc,
    pub has_prev_state: bool,

    /// Cached `byte_offset_to_start_of_line` column of whichever line-offset
    /// table is in use (`line_offset_tables` or `lazy_line_offset_tables`).
    ///
    /// Borrows the heap storage owned by that table; both variants keep the
    /// `MultiArrayList` header live and un-resized for the builder's lifetime
    /// (`line_offset_tables` is a `ManuallyDrop` alias of linker storage;
    /// `lazy_line_offset_tables` is built once and never mutated again), so the
    /// pointer is stable across moves of `Self`. `&'static` is a lifetime
    /// erasure of that self-borrow — threading a real `'a` would infect every
    /// `Printer<'a, …>` instantiation for a field that's only ever read in
    /// `add_source_mapping`. Populated lazily on the first mapping; reset to `&[]` when
    /// the lazy table is generated so it re-derives against the new storage.
    pub line_offset_table_byte_offset_list: &'static [u32],
    /// Cached `byte_offset_to_first_non_ascii` column; same lifetime invariant
    /// as `line_offset_table_byte_offset_list` above.
    pub line_offset_table_first_non_ascii: &'static [u32],

    // This is a workaround for a bug in the popular "source-map" library:
    // https://github.com/mozilla/source-map/issues/261. The library will
    // sometimes return null when querying a source map unless every line
    // starts with a mapping at column zero.
    //
    // The workaround is to replicate the previous mapping if a line ends
    // up not starting with a mapping. This is done lazily because we want
    // to avoid replicating the previous mapping if we don't need to.
    pub line_starts_with_mapping: bool,
    pub cover_lines_without_mappings: bool,

    pub approximate_input_line_count: usize,

    /// When generating sourcemappings for bun, we store a count of how many mappings there were
    pub prepend_count: bool,
}

impl<T: SourceMapFormatCtx + Default> Default for NewBuilder<T> {
    /// `get_source_map_builder` returns this when source maps are disabled, so
    /// it only needs to be inert (never read) — but we zero everything for sanity.
    fn default() -> Self {
        Self {
            source_map: SourceMapFormat { ctx: T::default() },
            line_offset_tables: core::mem::ManuallyDrop::new(line_offset_table::List::new_in(
                bun_alloc::AstAlloc,
            )),
            lazy_line_offset_tables: None,
            deferred_source: None,
            prev_state: SourceMapState::default(),
            last_generated_update: 0,
            generated_column: 0,
            prev_loc: Loc::EMPTY,
            has_prev_state: false,
            line_offset_table_byte_offset_list: &[],
            line_offset_table_first_non_ascii: &[],
            line_starts_with_mapping: false,
            cover_lines_without_mappings: false,
            approximate_input_line_count: 0,
            prepend_count: false,
        }
    }
}

/// A uniquely-owned [`line_offset_table::List`] whose per-row
/// `columns_for_non_ascii: Box<[i32]>` payloads are drained on drop.
///
/// `MultiArrayList::Drop` is **slab-only** — it frees the SoA buffer but never
/// runs column destructors (a bitwise `clone` can alias two lists onto the same
/// column heap pointers; see its docs). The bundler's eager
/// `print_ast`/`print_common_js` paths now use `List<AstAlloc>` (bulk-freed
/// with the per-worker AST heap) and leave `Builder.line_offset_tables` empty,
/// so they no longer need a guard. The lazily-built table here is `List<Global>`
/// and still needs the per-row drain, so wrap it in a type that does it
/// automatically. (A `Drop` impl on `NewBuilder` itself would forbid the
/// `..Default::default()` struct-update used to build it in
/// `get_source_map_builder`, hence the newtype.)
pub struct OwnedLineOffsetTables(pub line_offset_table::List);

impl Drop for OwnedLineOffsetTables {
    fn drop(&mut self) {
        // Run every row's destructors (drops the `columns_for_non_ascii` boxes);
        // the `MultiArrayList::Drop` that follows then frees the SoA slab.
        self.0.drop_elements();
    }
}

pub type SourceMapper<T> = SourceMapFormat<T>;

// PERF(codegen): the hot-path methods below are implemented on the *concrete*
// `NewBuilder<VLQSourceMap>` (the only instantiation — see `Builder` alias
// below) rather than on `impl<T: SourceMapFormatCtx> NewBuilder<T>`. When these
// were generic, rustc deferred monomorphization to every downstream crate that
// called them, so `add_source_mapping` + `update_generated_line_and_column`
// were re-emitted in `bun_js_printer`, `bun_bundler`, and `bun_runtime` CGUs
// (≈7.3 MB of duplicated text, each copy far from
// `internal_source_map::Builder::flush_window` which lives here). Making them
// concrete pins exactly one copy in the `bun_sourcemap` CGU, adjacent to
// `flush_window`, and downstream crates emit a plain `call`.
//
// `#[inline(never)]` is kept on the cross-crate entry points only
// (`generate_chunk`; `add_source_mapping` is the
// per-token call site from the printer).
//
// `update_generated_line_and_column` is split: the `#[inline]` wrapper holds
// *only* the ASCII-window fast path (bump `generated_column` by the window
// length and return), so it folds into both callers and the per-token path
// stays a single function with `generated_column`/`last_generated_update` in
// registers — no `call`+`ret`, no argument/return spill per emitted token.
// (As a standalone `pub fn` it was kept out of line and showed up as its own
// profile symbol.) The rare newline/non-ASCII case tail-calls
// `update_generated_line_and_column_slow`, which is `#[inline(never)] #[cold]`
// and lives once in this crate, adjacent to `flush_window`. The concrete
// (non-generic) impl is what pins one copy per CGU.
impl NewBuilder<VLQSourceMap> {
    #[inline(never)]
    pub fn generate_chunk(&mut self, output: &[u8]) -> Chunk {
        self.update_generated_line_and_column(output);
        // Capture scalars before borrowing `source_map` mutably via
        // `get_buffer`, to satisfy the borrow checker.
        if self.prepend_count {
            let count = self.source_map.get_count();
            let approx = self.approximate_input_line_count;
            let buffer = self.source_map.get_buffer();
            let len = buffer.list.len();
            buffer.list[0..8].copy_from_slice(&(len as u64).to_ne_bytes());
            buffer.list[8..16].copy_from_slice(&(count as u64).to_ne_bytes());
            buffer.list[16..24].copy_from_slice(&(approx as u64).to_ne_bytes());
        } else {
            // Finalize the internal builder eagerly; `take_buffer()` below
            // also finalizes, so the effect is preserved.
            let _ = self.source_map.get_buffer();
        }
        Chunk {
            buffer: self.source_map.take_buffer(),
            mappings_count: self.source_map.get_count(),
            end_state: self.prev_state,
            final_generated_column: self.generated_column,
            should_ignore: self.source_map.should_ignore(),
        }
    }

    // Scan over the printed text since the last source mapping and update the
    // generated line and column numbers.
    //
    // ASCII fast path: the window between two source mappings is almost always
    // pure printable ASCII with no `\r`/`\n` (e.g. eslint and most JS sources).
    // `index_of_newline_or_non_ascii` flags any byte `< 0x20` (except `\t`) or
    // `> 127`, so a `None` result means every byte in the window — including
    // any `\t` — advances the generated column by exactly 1 and never crosses a
    // line boundary. This `#[inline]` shim handles only that case so it folds
    // into the per-token callers (see the impl-level PERF note); the per-rune
    // WTF-8 decode loop is out of line in `_slow` and reached only when a
    // newline or non-ASCII byte actually exists in the window.
    #[inline]
    pub fn update_generated_line_and_column(&mut self, output: &[u8]) {
        let slice = &output[self.last_generated_update as usize..];
        // The window between consecutive mappings is usually a handful of bytes
        // (one token, often less under --minify). Below the narrowest highway
        // lane width the SIMD body never runs and the FFI dispatch is pure
        // overhead, so scan inline. Predicate matches
        // `IndexOfNewlineOrNonASCIIImpl`'s scalar tail (`> 127 || < 0x20`).
        let pure_ascii = if slice.len() < 16 {
            !slice.iter().any(|&b| b > 127 || b < 0x20)
        } else {
            strings::index_of_newline_or_non_ascii(slice, 0).is_none()
        };
        if pure_ascii {
            debug_assert!(slice.len() <= i32::MAX as usize);
            self.generated_column += slice.len() as i32;
            self.last_generated_update = output.len() as u32;
            return;
        }
        self.update_generated_line_and_column_slow(output);
    }

    #[inline(never)]
    #[cold]
    fn update_generated_line_and_column_slow(&mut self, output: &[u8]) {
        let slice = &output[self.last_generated_update as usize..];

        let mut needs_mapping = self.cover_lines_without_mappings
            && !self.line_starts_with_mapping
            && self.has_prev_state;

        let mut i: usize = 0;
        let n: usize = slice.len();
        let mut c: i32;
        while i < n {
            let len = strings::wtf8_byte_sequence_length_with_invalid(slice[i]);
            let mut cp_bytes = [0u8; 4];
            let take = (len as usize).min(n - i);
            cp_bytes[..take].copy_from_slice(&slice[i..i + take]);
            c = strings::decode_wtf8_rune_t::<i32>(
                cp_bytes,
                len,
                strings::UNICODE_REPLACEMENT as i32,
            );
            i += len as usize;

            match c {
                14..=127 => {
                    // Hot path: `i` is bounded by
                    // `slice.len()` (itself a sub-slice indexed by a `u32` offset), and
                    // column deltas are bounded by that same length, so these casts
                    // cannot truncate in practice. Keep the bound check in debug only.
                    debug_assert!(i <= u32::MAX as usize);
                    if let Some(j) = strings::index_of_newline_or_non_ascii(slice, i as u32) {
                        let advance = (j as usize - i) + 1;
                        debug_assert!(advance <= i32::MAX as usize);
                        self.generated_column += advance as i32;
                        i = j as usize;
                        continue;
                    } else {
                        let remaining = slice[i..].len();
                        debug_assert!(remaining <= i32::MAX as usize);
                        self.generated_column += remaining as i32 + 1;
                        break;
                    }
                }
                // '\r', '\n', U+2028, U+2029
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    // windows newline
                    if c == 0x0D {
                        let newline_check = self.last_generated_update as usize + i + 1;
                        if newline_check < output.len() && output[newline_check] == b'\n' {
                            continue;
                        }
                    }

                    // If we're about to move to the next line and the previous line didn't have
                    // any mappings, add a mapping at the start of the previous line.
                    if needs_mapping {
                        self.append_mapping_without_remapping(SourceMapState {
                            generated_line: self.prev_state.generated_line,
                            generated_column: 0,
                            source_index: self.prev_state.source_index,
                            original_line: self.prev_state.original_line,
                            original_column: self.prev_state.original_column,
                        });
                    }

                    self.prev_state.generated_line += 1;
                    self.prev_state.generated_column = 0;
                    self.generated_column = 0;
                    self.source_map
                        .append_line_separator()
                        .expect("unreachable");

                    // This new line doesn't have a mapping yet
                    self.line_starts_with_mapping = false;

                    needs_mapping = self.cover_lines_without_mappings
                        && !self.line_starts_with_mapping
                        && self.has_prev_state;
                }

                _ => {
                    // Mozilla's "source-map" library counts columns using UTF-16 code units
                    self.generated_column += (c > 0xFFFF) as i32 + 1;
                }
            }
        }

        self.last_generated_update = output.len() as u32;
    }

    #[inline(always)]
    pub fn append_mapping(&mut self, current_state: SourceMapState) {
        self.append_mapping_without_remapping(current_state);
    }

    #[inline(always)]
    pub fn append_mapping_without_remapping(&mut self, current_state: SourceMapState) {
        self.source_map
            .append(current_state, self.prev_state)
            .expect("unreachable");
        self.prev_state = current_state;
        self.has_prev_state = true;
    }

    /// Defer line-offset-table construction to the first `add_source_mapping`
    /// call. Use on the runtime/transpiler print path when no precomputed table
    /// is supplied, so modules that emit no mappings skip the table's
    /// full-source scan + allocation entirely. `contents` must point into the
    /// live `Source.contents` and outlive the builder.
    #[inline]
    pub fn set_deferred_line_offset_table(&mut self, contents: &[u8], approximate_line_count: i32) {
        debug_assert!(
            self.line_offset_tables.len() == 0,
            "deferred table requires no precomputed line_offset_tables",
        );
        // SAFETY: lifetime erased to `'static`; `contents` (`Source.contents`)
        // outlives the builder. Same erasure as `line_offset_table_byte_offset_list`.
        let contents: &'static [u8] =
            unsafe { core::slice::from_raw_parts(contents.as_ptr(), contents.len()) };
        self.deferred_source = Some((contents, approximate_line_count));
    }

    #[inline(never)]
    pub fn add_source_mapping(&mut self, loc: Loc, output: &[u8]) {
        if
        // don't insert mappings for same location twice
        self.prev_loc.eql(loc) ||
            // exclude generated code from source
            loc.start == Loc::EMPTY.start
        {
            return;
        }

        self.prev_loc = loc;

        // Lazily build the line-offset table on the first mapping. The
        // runtime/transpiler path passes `deferred_source` instead of a
        // precomputed table (see `set_deferred_line_offset_table`); modules that
        // never reach this point skip the full-source scan + allocation.
        if self.lazy_line_offset_tables.is_none() {
            if let Some((contents, approx)) = self.deferred_source {
                self.lazy_line_offset_tables = Some(OwnedLineOffsetTables(
                    LineOffsetTable::generate(contents, approx).unwrap_or_default(),
                ));
                // The byte-offset cache below must re-derive against the new table.
                self.line_offset_table_byte_offset_list = &[];
            }
        }

        // `line_offset_tables` (bundler-supplied, `AstAlloc`) and
        // `lazy_line_offset_tables` (runtime-generated, `Global`) are different
        // `List<A>` instantiations, so we can't unify them behind one `&List`.
        // Instead, cache the two `u32` columns the hot path reads (both are
        // `&[u32]` regardless of `A`) and re-dispatch only for the rare
        // `columns_for_non_ascii` lookup below.
        let list_len = match &self.lazy_line_offset_tables {
            Some(t) => t.0.len(),
            None => self.line_offset_tables.len(),
        };

        // We have no sourcemappings.
        // This happens for example when importing an asset which does not support sourcemaps
        // like a png or a jpg
        //
        // import foo from "./foo.png";
        //
        if list_len == 0 {
            return;
        }

        // PERF: cache the `byte_offset_to_start_of_line` / `…_first_non_ascii`
        // columns once. The backing storage is heap-owned by whichever table is
        // active — `line_offset_tables` (a `ManuallyDrop<MultiArrayList>`) or
        // `lazy_line_offset_tables` (built once just above) — and both are kept
        // live and un-resized for the builder's lifetime, so the slice stays
        // valid across moves of `self`. We lazy-init here on the first mapping.
        if self.line_offset_table_byte_offset_list.len() != list_len {
            let (start, first_na) = match &self.lazy_line_offset_tables {
                Some(t) => (
                    t.0.items_byte_offset_to_start_of_line(),
                    t.0.items_byte_offset_to_first_non_ascii(),
                ),
                None => (
                    self.line_offset_tables.items_byte_offset_to_start_of_line(),
                    self.line_offset_tables
                        .items_byte_offset_to_first_non_ascii(),
                ),
            };
            // SAFETY: lifetime widened to `'static` per the invariant above —
            // the backing table outlives every `add_source_mapping` call and is
            // never reallocated.
            self.line_offset_table_byte_offset_list =
                unsafe { core::slice::from_raw_parts(start.as_ptr(), start.len()) };
            // SAFETY: same invariant as above — backing table outlives every
            // `add_source_mapping` call and is never reallocated.
            self.line_offset_table_first_non_ascii =
                unsafe { core::slice::from_raw_parts(first_na.as_ptr(), first_na.len()) };
        }
        let byte_offsets = self.line_offset_table_byte_offset_list;

        // The printer emits mappings in (mostly) source order, so the previous
        // call's `original_line` is the right answer or one/two lines before
        // it >95% of the time. Seed `find_line_with_hint` with it; the
        // fallback is the same binary search as before.
        let original_line = LineOffsetTable::find_line_with_hint(
            byte_offsets,
            loc,
            self.prev_state.original_line as u32,
        );
        let idx = original_line.max(0) as usize;

        // PERF: read the three columns directly instead of `list.get(idx)`.
        // `MultiArrayList::get` builds a 272-byte `Slice` (`[*mut u8; 32]` +
        // len/cap) and then gathers *every* field via `ptr::read`; for the
        // hot per-token path that dominated `add_source_mapping`. Each
        // `items::<>` is a single `base + CONST*cap` pointer add.
        let mut original_column = loc.start - byte_offsets[idx] as i32;
        {
            // `first_non_ascii` is `i32::MAX as u32` for ASCII-only lines, so the
            // comparison below is false and the `columns_for_non_ascii` SoA column
            // (the largest, ~16 B/line) is never touched on the hot ASCII path.
            let first_non_ascii = self.line_offset_table_first_non_ascii[idx];
            if original_column >= first_non_ascii as i32 {
                let cols: &[i32] = match &self.lazy_line_offset_tables {
                    Some(t) => &t.0.items::<"columns_for_non_ascii", Box<[i32]>>()[idx],
                    None => &self
                        .line_offset_tables
                        .items::<"columns_for_non_ascii", Box<[i32], bun_alloc::AstAlloc>>()[idx],
                };
                if !cols.is_empty() {
                    original_column = cols[(original_column as u32 - first_non_ascii) as usize];
                }
            }
        }

        self.update_generated_line_and_column(output);

        // If this line doesn't start with a mapping and we're about to add a mapping
        // that's not at the start, insert a mapping first so the line starts with one.
        if self.cover_lines_without_mappings
            && !self.line_starts_with_mapping
            && self.generated_column > 0
            && self.has_prev_state
        {
            self.append_mapping_without_remapping(SourceMapState {
                generated_line: self.prev_state.generated_line,
                generated_column: 0,
                source_index: self.prev_state.source_index,
                original_line: self.prev_state.original_line,
                original_column: self.prev_state.original_column,
            });
        }

        self.append_mapping(SourceMapState {
            generated_line: self.prev_state.generated_line,
            generated_column: self.generated_column.max(0),
            source_index: self.prev_state.source_index,
            original_line: original_line.max(0),
            original_column: original_column.max(0),
        });

        // This line now has a mapping on it, so don't insert another one
        self.line_starts_with_mapping = true;
    }
}

pub type Builder = NewBuilder<VLQSourceMap>;
