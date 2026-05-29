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
    ) -> Result<(), bun_core::Error> {
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
    ) -> Result<(), bun_core::Error> {
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
) -> Result<(), bun_core::Error> {
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

/// Trait capturing the methods `SourceMapFormat<T>` forwards to its `ctx`.
/// In Zig this was structural (comptime duck typing on `Type`).
pub trait SourceMapFormatCtx: Sized {
    fn init(prepend_count: bool) -> Self;
    fn append_line_separator(&mut self) -> Result<(), bun_core::Error>;
    fn append(
        &mut self,
        current_state: SourceMapState,
        prev_state: SourceMapState,
    ) -> Result<(), bun_core::Error>;
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
    pub fn append_line_separator(&mut self) -> Result<(), bun_core::Error> {
        self.ctx.append_line_separator()
    }

    #[inline(always)]
    pub fn append(
        &mut self,
        current_state: SourceMapState,
        prev_state: SourceMapState,
    ) -> Result<(), bun_core::Error> {
        self.ctx.append(current_state, prev_state)
    }

    #[inline]
    pub fn should_ignore(&self) -> bool {
        self.ctx.should_ignore()
    }

    #[inline]
    pub fn get_buffer(&mut self) -> &mut MutableString {
        // PORT NOTE: Zig returned `MutableString` by value (struct copy sharing
        // the same backing allocation). Rust returns `&mut` to avoid a
        // double-ownership footgun; callers mutate in place.
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

    #[inline(always)]
    fn append_line_separator(&mut self) -> Result<(), bun_core::Error> {
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
    ) -> Result<(), bun_core::Error> {
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
            // PORT NOTE: Zig did `this.data = b.finalize().*; b.finalized = null;`
            // i.e. move the finalized buffer out and clear the builder.
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
    pub line_offset_tables: core::mem::ManuallyDrop<line_offset_table::List<bun_alloc::AstAlloc>>,

    pub lazy_line_offset_tables: Option<OwnedLineOffsetTables>,

    pub deferred_source: Option<(&'static [u8], i32)>,

    pub prev_state: SourceMapState,
    pub last_generated_update: u32,
    pub generated_column: i32,
    pub prev_loc: Loc,
    pub has_prev_state: bool,

    pub line_offset_table_byte_offset_list: &'static [u32],
    /// Cached `byte_offset_to_first_non_ascii` column; same lifetime invariant
    /// as `line_offset_table_byte_offset_list` above.
    pub line_offset_table_first_non_ascii: &'static [u32],

    pub line_starts_with_mapping: bool,
    pub cover_lines_without_mappings: bool,

    pub approximate_input_line_count: usize,

    /// When generating sourcemappings for bun, we store a count of how many mappings there were
    pub prepend_count: bool,
}

impl<T: SourceMapFormatCtx + Default> Default for NewBuilder<T> {
    /// Zig field-defaults; the Zig caller (`get_source_map_builder`) returned
    /// `undefined` when source maps are disabled, so this only needs to be
    /// inert (never read) — but we zero everything for sanity.
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

pub struct OwnedLineOffsetTables(pub line_offset_table::List);

impl Drop for OwnedLineOffsetTables {
    fn drop(&mut self) {
        // Run every row's destructors (drops the `columns_for_non_ascii` boxes);
        // the `MultiArrayList::Drop` that follows then frees the SoA slab.
        self.0.drop_elements();
    }
}

pub type SourceMapper<T> = SourceMapFormat<T>;

impl NewBuilder<VLQSourceMap> {
    #[inline(never)]
    pub fn generate_chunk(&mut self, output: &[u8]) -> Chunk {
        self.update_generated_line_and_column(output);
        // PORT NOTE: reshaped for borrowck — capture scalars before borrowing
        // `source_map` mutably via `get_buffer`.
        if self.prepend_count {
            let count = self.source_map.get_count();
            let approx = self.approximate_input_line_count;
            let buffer = self.source_map.get_buffer();
            let len = buffer.list.len();
            buffer.list[0..8].copy_from_slice(&(len as u64).to_ne_bytes());
            buffer.list[8..16].copy_from_slice(&(count as u64).to_ne_bytes());
            buffer.list[16..24].copy_from_slice(&(approx as u64).to_ne_bytes());
        } else {
            // Zig calls `getBuffer()` unconditionally (which finalizes the
            // internal builder). `take_buffer()` below also finalizes, so the
            // effect is preserved.
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

    #[inline]
    pub fn update_generated_line_and_column(&mut self, output: &[u8]) {
        let slice = &output[self.last_generated_update as usize..];
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

        if self.lazy_line_offset_tables.is_none() {
            if let Some((contents, approx)) = self.deferred_source {
                self.lazy_line_offset_tables = Some(OwnedLineOffsetTables(
                    LineOffsetTable::generate(contents, approx).unwrap_or_default(),
                ));
                // The byte-offset cache below must re-derive against the new table.
                self.line_offset_table_byte_offset_list = &[];
            }
        }

        let list_len = match &self.lazy_line_offset_tables {
            Some(t) => t.0.len(),
            None => self.line_offset_tables.len(),
        };

        if list_len == 0 {
            return;
        }

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
            // never reallocated. Same shape as Zig's cached `[]const u32`.
            self.line_offset_table_byte_offset_list =
                unsafe { core::slice::from_raw_parts(start.as_ptr(), start.len()) };
            // SAFETY: same invariant as above — backing table outlives every
            // `add_source_mapping` call and is never reallocated.
            self.line_offset_table_first_non_ascii =
                unsafe { core::slice::from_raw_parts(first_na.as_ptr(), first_na.len()) };
        }
        let byte_offsets = self.line_offset_table_byte_offset_list;

        let original_line = LineOffsetTable::find_line_with_hint(
            byte_offsets,
            loc,
            self.prev_state.original_line as u32,
        );
        let idx = original_line.max(0) as usize;

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

// ported from: src/sourcemap/Chunk.zig
