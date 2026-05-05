use bun_str::{strings, MutableString};
use bun_paths::PathBuffer;
use bun_logger as logger;
use bun_logger::{Loc, Source};
// TODO(b0): FileSystem arrives from move-in (resolver::fs → sys, remapped fs target)
use bun_sys::FileSystem;
use bun_js_printer as js_printer;
use bun_alloc::AllocError;

use super::sourcemap::{
    append_mapping_to_buffer, InternalSourceMap, LineOffsetTable, SourceMapState,
};

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

    pub fn print_source_map_contents<const ASCII_ONLY: bool>(
        &self,
        source: &Source,
        mutable: &mut MutableString,
        include_sources_contents: bool,
    ) -> Result<(), AllocError> {
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
    ) -> Result<(), AllocError> {
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
) -> Result<(), AllocError> {
    let mut filename_buf = PathBuffer::uninit();
    let mut filename: &[u8] = source.path.text.as_ref();
    let top_level_dir: &[u8] = FileSystem::instance().top_level_dir.as_ref();
    if filename.starts_with(top_level_dir) {
        filename = &filename[top_level_dir.len() - 1..];
    } else if !filename.is_empty() && filename[0] != b'/' {
        filename_buf[0] = b'/';
        filename_buf[1..1 + filename.len()].copy_from_slice(filename);
        filename = &filename_buf[0..filename.len() + 1];
    }

    mutable
        .grow_if_needed(
            filename.len()
                + 2
                + (source.contents.len() * (include_sources_contents as usize))
                + mappings.len()
                + 32
                + 39
                + 29
                + 22
                + 20,
        )
        .expect("unreachable");
    mutable.append(b"{\n  \"version\":3,\n  \"sources\": [")?;

    js_printer::quote_for_json::<ASCII_ONLY>(filename, mutable)?;

    if include_sources_contents {
        mutable.append(b"],\n  \"sourcesContent\": [")?;
        js_printer::quote_for_json::<ASCII_ONLY>(source.contents.as_ref(), mutable)?;
    }

    mutable.append(b"],\n  \"mappings\": ")?;
    js_printer::quote_for_json::<ASCII_ONLY>(mappings, mutable)?;
    mutable.append(b", \"names\": []\n}")?;
    Ok(())
}

// TODO: remove the indirection by having generic functions for SourceMapFormat and NewBuilder. Source maps are always VLQ

/// Trait capturing the methods `SourceMapFormat<T>` forwards to its `ctx`.
/// In Zig this was structural (comptime duck typing on `Type`).
// TODO(port): Zig comment above says to remove this indirection entirely.
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

    #[inline]
    pub fn append_line_separator(&mut self) -> Result<(), bun_core::Error> {
        self.ctx.append_line_separator()
    }

    #[inline]
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
    pub internal: Option<super::sourcemap::internal_source_map::Builder>,
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
                internal: Some(super::sourcemap::internal_source_map::Builder::init()),
                ..Default::default()
            };
        }

        VLQSourceMap {
            data: MutableString::init_empty(),
            ..Default::default()
        }
    }

    fn append_line_separator(&mut self) -> Result<(), bun_core::Error> {
        if let Some(b) = &mut self.internal {
            b.append_line_separator();
            return Ok(());
        }
        self.data.append_char(b';')?;
        Ok(())
    }

    fn append(
        &mut self,
        current_state: SourceMapState,
        prev_state: SourceMapState,
    ) -> Result<(), bun_core::Error> {
        if let Some(b) = &mut self.internal {
            b.append_mapping(current_state);
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
    pub line_offset_tables: LineOffsetTable::List,
    pub prev_state: SourceMapState,
    pub last_generated_update: u32,
    pub generated_column: i32,
    pub prev_loc: Loc,
    pub has_prev_state: bool,

    // TODO(port): lifetime — borrowed view into `line_offset_tables`' byte_offset
    // column (a `MultiArrayList` slice). Using `&'static` placeholder in Phase A
    // to avoid a struct lifetime param; Phase B should derive this on demand or
    // thread `'a`.
    pub line_offset_table_byte_offset_list: &'static [u32],

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

pub type SourceMapper<T> = SourceMapFormat<T>;

impl<T: SourceMapFormatCtx> NewBuilder<T> {
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

    // Scan over the printed text since the last source mapping and update the
    // generated line and column numbers
    pub fn update_generated_line_and_column(&mut self, output: &[u8]) {
        let slice = &output[self.last_generated_update as usize..];
        let mut needs_mapping =
            self.cover_lines_without_mappings && !self.line_starts_with_mapping && self.has_prev_state;

        let mut i: usize = 0;
        let n: usize = slice.len();
        let mut c: i32;
        while i < n {
            let len = strings::wtf8_byte_sequence_length_with_invalid(slice[i]);
            // SAFETY: `decode_wtf8_rune_t` reads at most `len` bytes; the Zig
            // passes `.ptr[0..4]` (unchecked 4-byte view) and the decoder only
            // dereferences bytes covered by `len`.
            c = strings::decode_wtf8_rune_t(
                unsafe { &*(slice.as_ptr().add(i) as *const [u8; 4]) },
                len,
                strings::UNICODE_REPLACEMENT,
            );
            i += len as usize;

            match c {
                14..=127 => {
                    if let Some(j) =
                        strings::index_of_newline_or_non_ascii(slice, u32::try_from(i).unwrap())
                    {
                        self.generated_column +=
                            i32::try_from((j as usize - i) + 1).unwrap();
                        i = j as usize;
                        continue;
                    } else {
                        self.generated_column +=
                            i32::try_from(slice[i..].len()).unwrap() + 1;
                        i = n;
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
                    self.source_map.append_line_separator().expect("unreachable");

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

    pub fn append_mapping(&mut self, current_state: SourceMapState) {
        self.append_mapping_without_remapping(current_state);
    }

    pub fn append_mapping_without_remapping(&mut self, current_state: SourceMapState) {
        self.source_map
            .append(current_state, self.prev_state)
            .expect("unreachable");
        self.prev_state = current_state;
        self.has_prev_state = true;
    }

    pub fn add_source_mapping(&mut self, loc: Loc, output: &[u8]) {
        if
        // don't insert mappings for same location twice
        self.prev_loc == loc ||
            // exclude generated code from source
            loc.start == Loc::EMPTY.start
        {
            return;
        }

        self.prev_loc = loc;
        let list = &self.line_offset_tables;

        // We have no sourcemappings.
        // This happens for example when importing an asset which does not support sourcemaps
        // like a png or a jpg
        //
        // import foo from "./foo.png";
        //
        if list.len() == 0 {
            return;
        }

        let original_line =
            LineOffsetTable::find_line(self.line_offset_table_byte_offset_list, loc);
        let line = list.get(usize::try_from(original_line.max(0)).unwrap());

        // Use the line to compute the column
        let mut original_column =
            loc.start - i32::try_from(line.byte_offset_to_start_of_line).unwrap();
        if line.columns_for_non_ascii.len() > 0
            && original_column >= i32::try_from(line.byte_offset_to_first_non_ascii).unwrap()
        {
            original_column = line.columns_for_non_ascii.as_slice()
                [(u32::try_from(original_column).unwrap() - line.byte_offset_to_first_non_ascii)
                    as usize];
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap/Chunk.zig (400 lines)
//   confidence: medium
//   todos:      2
//   notes:      get_buffer() returns &mut instead of by-value copy; line_offset_table_byte_offset_list lifetime needs Phase B threading; InternalSourceMap.Builder.finalize_take() assumed to move out finalized buffer
// ──────────────────────────────────────────────────────────────────────────
