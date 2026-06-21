use bun_collections::VecExt;
use core::mem::size_of;

use bun_ast::Loc;
use bun_collections::MultiArrayList;
use bun_core::{self, ZigStringSlice};
use bun_core::{declare_scope, err, scoped_log};
use bun_semver::String as SemverString;

use crate::vlq::decode as decode_vlq;
use crate::{LineColumnOffset, Ordinal, ParseResult, ParseResultFail, ParsedSourceMap};

declare_scope!(SourceMap, visible);

// Typed SoA column accessors — thin wrappers over the reflection-backed
// `MultiArrayList::items::<"field", T>()` so callers don't repeat the type.
trait MappingColumns {
    fn items_generated(&self) -> &[LineColumnOffset];
    fn items_original(&self) -> &[LineColumnOffset];
    fn items_source_index(&self) -> &[i32];
}
impl MappingColumns for MultiArrayList<MappingWithoutName> {
    fn items_generated(&self) -> &[LineColumnOffset] {
        self.items::<"generated", LineColumnOffset>()
    }
    fn items_original(&self) -> &[LineColumnOffset] {
        self.items::<"original", LineColumnOffset>()
    }
    fn items_source_index(&self) -> &[i32] {
        self.items::<"source_index", i32>()
    }
}
impl MappingColumns for MultiArrayList<Mapping> {
    fn items_generated(&self) -> &[LineColumnOffset] {
        self.items::<"generated", LineColumnOffset>()
    }
    fn items_original(&self) -> &[LineColumnOffset] {
        self.items::<"original", LineColumnOffset>()
    }
    fn items_source_index(&self) -> &[i32] {
        self.items::<"source_index", i32>()
    }
}
trait MappingNameColumn {
    fn items_name_index(&self) -> &[i32];
}
impl MappingNameColumn for MultiArrayList<Mapping> {
    fn items_name_index(&self) -> &[i32] {
        self.items::<"name_index", i32>()
    }
}

#[derive(Clone, Copy)]
pub struct Mapping {
    pub generated: LineColumnOffset,
    pub original: LineColumnOffset,
    pub source_index: i32,
    pub name_index: i32, // = -1
}

impl Default for Mapping {
    fn default() -> Self {
        Self {
            generated: LineColumnOffset::default(),
            original: LineColumnOffset::default(),
            source_index: 0,
            name_index: -1,
        }
    }
}

/// Optimization: if we don't care about the "names" column, then don't store the names.
#[derive(Clone, Copy, Default)]
pub struct MappingWithoutName {
    pub generated: LineColumnOffset,
    pub original: LineColumnOffset,
    pub source_index: i32,
}

impl MappingWithoutName {
    pub(crate) fn to_named(&self) -> Mapping {
        Mapping {
            generated: self.generated,
            original: self.original,
            source_index: self.source_index,
            name_index: -1,
        }
    }
}

pub enum ListValue {
    WithoutNames(MultiArrayList<MappingWithoutName>),
    WithNames(MultiArrayList<Mapping>),
}

impl Default for ListValue {
    fn default() -> Self {
        ListValue::WithoutNames(MultiArrayList::default())
    }
}

/// Dispatch a single body over both `ListValue` arms. `$body` is duplicated
/// textually so each arm monomorphizes over its own `MultiArrayList<T>`; the
/// arms therefore need NOT have a common element type, only a common `$body`
/// result type. Match-ergonomics governs the borrow: pass `&v` / `&mut v` and
/// `$l` binds by-ref / by-ref-mut accordingly. Mirrors `any_dispatch!` at
/// src/uws_sys/Response.rs:581.
macro_rules! both_lists {
    ($v:expr, |$l:ident| $body:expr) => {
        match $v {
            ListValue::WithoutNames($l) => $body,
            ListValue::WithNames($l) => $body,
        }
    };
}

impl ListValue {
    pub(crate) fn memory_cost(&self) -> usize {
        both_lists!(self, |list| list.memory_cost())
    }

    pub(crate) fn ensure_total_capacity(
        &mut self,
        count: usize,
    ) -> Result<(), bun_alloc::AllocError> {
        both_lists!(self, |list| list.ensure_total_capacity(count))
    }
}

#[derive(Default)]
pub struct List {
    pub r#impl: ListValue,
    pub names: Box<[SemverString]>,
    pub names_buffer: Vec<u8>,
}

impl List {
    fn ensure_with_names(&mut self) -> Result<(), bun_alloc::AllocError> {
        if matches!(self.r#impl, ListValue::WithNames(_)) {
            return Ok(());
        }

        // Move the without_names list out, build the with_names list, then
        // assign back (satisfies the borrow checker). The old list drops at
        // end of scope.
        let ListValue::WithoutNames(without_names) = core::mem::replace(
            &mut self.r#impl,
            ListValue::WithNames(MultiArrayList::default()),
        ) else {
            unreachable!()
        };

        let mut with_names: MultiArrayList<Mapping> = MultiArrayList::default();
        with_names.ensure_total_capacity(without_names.len())?;
        // `without_names` drops at end of scope (was `defer without_names.deinit(allocator)`).

        // MultiArrayList has no
        // public `set_len`; rebuild element-wise (capacity already reserved, so no
        // realloc). PERF: revisit once typed mut-column accessors exist.
        for i in 0..without_names.len() {
            with_names.append_assume_capacity(without_names.get(i).to_named());
        }

        self.r#impl = ListValue::WithNames(with_names);
        Ok(())
    }

    fn find_index_from_generated(
        line_column_offsets: &[LineColumnOffset],
        line: Ordinal,
        column: Ordinal,
    ) -> Option<usize> {
        let mut count = line_column_offsets.len();
        let mut index: usize = 0;
        while count > 0 {
            let step = count / 2;
            let i: usize = index + step;
            let mapping = line_column_offsets[i];
            if mapping.lines.zero_based() < line.zero_based()
                || (mapping.lines.zero_based() == line.zero_based()
                    && mapping.columns.zero_based() <= column.zero_based())
            {
                index = i + 1;
                count = count.saturating_sub(step + 1);
            } else {
                count = step;
            }
        }

        if index > 0 {
            if line_column_offsets[index - 1].lines.zero_based() == line.zero_based() {
                return Some(index - 1);
            }
        }

        None
    }

    pub fn find_index(&self, line: Ordinal, column: Ordinal) -> Option<usize> {
        both_lists!(&self.r#impl, |list| Self::find_index_from_generated(
            list.items_generated(),
            line,
            column,
        ))
    }

    pub fn sort(&mut self) {
        // `MultiArrayList::sort(&mut self, ctx)` swaps the `generated` column
        // in place, so the comparator cannot hold a `&[LineColumnOffset]` over
        // it (that aliased the swap before this rewrite). Instead capture the
        // raw column base + len; the column is never reallocated during sort.
        both_lists!(&mut self.r#impl, |list| {
            let generated: *const LineColumnOffset =
                list.items_raw::<"generated", LineColumnOffset>();
            let len = list.len();
            list.sort(&SortContext { generated, len });
        })
    }

    pub fn append(&mut self, mapping: &Mapping) -> Result<(), bun_alloc::AllocError> {
        match &mut self.r#impl {
            ListValue::WithoutNames(list) => {
                list.append(MappingWithoutName {
                    generated: mapping.generated,
                    original: mapping.original,
                    source_index: mapping.source_index,
                })?;
            }
            ListValue::WithNames(list) => {
                list.append(*mapping)?;
            }
        }
        Ok(())
    }

    pub fn len(&self) -> usize {
        both_lists!(&self.r#impl, |list| list.len())
    }

    pub fn find(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        match &self.r#impl {
            ListValue::WithoutNames(list) => {
                if let Some(i) =
                    Self::find_index_from_generated(list.items_generated(), line, column)
                {
                    return Some(list.get(i).to_named());
                }
            }
            ListValue::WithNames(list) => {
                if let Some(i) =
                    Self::find_index_from_generated(list.items_generated(), line, column)
                {
                    return Some(*list.get(i));
                }
            }
        }

        None
    }

    pub fn generated(&self) -> &[LineColumnOffset] {
        both_lists!(&self.r#impl, |list| list.items_generated())
    }

    pub fn original(&self) -> &[LineColumnOffset] {
        both_lists!(&self.r#impl, |list| list.items_original())
    }

    pub fn source_index(&self) -> &[i32] {
        both_lists!(&self.r#impl, |list| list.items_source_index())
    }

    pub fn name_index(&self) -> &[i32] {
        match &self.r#impl {
            ListValue::WithoutNames(_list) => &[],
            ListValue::WithNames(list) => list.items_name_index(),
        }
    }

    // `deinit` dropped: all fields (`MultiArrayList`, `Vec<u8>`, `Box<[SemverString]>`)
    // own their storage and free on Drop.

    pub fn get_name(&self, index: i32) -> Option<&[u8]> {
        if index < 0 {
            return None;
        }
        let i = usize::try_from(index).expect("int cast");

        if i >= self.names.len() {
            return None;
        }

        if matches!(self.r#impl, ListValue::WithNames(_)) {
            let str: &SemverString = &self.names[i];
            return Some(str.slice(self.names_buffer.slice()));
        }

        None
    }

    pub fn memory_cost(&self) -> usize {
        self.r#impl.memory_cost()
            + self.names_buffer.memory_cost()
            + (self.names.len() * size_of::<SemverString>())
    }

    pub fn ensure_total_capacity(&mut self, count: usize) -> Result<(), bun_alloc::AllocError> {
        self.r#impl.ensure_total_capacity(count)
    }
}

struct SortContext {
    generated: *const LineColumnOffset,
    len: usize,
}

impl bun_collections::multi_array_list::SortContext for SortContext {
    fn less_than(&self, a_index: usize, b_index: usize) -> bool {
        debug_assert!(a_index < self.len && b_index < self.len);
        // SAFETY: indices are `< len`; `generated` is the column base pointer
        // captured before sort, which swaps elements in place but never
        // reallocates, so it remains valid for `len` reads throughout.
        let (a, b) = unsafe { (*self.generated.add(a_index), *self.generated.add(b_index)) };

        if a.lines.zero_based() != b.lines.zero_based() {
            return a.lines.zero_based() < b.lines.zero_based();
        }
        if a.columns.zero_based() != b.columns.zero_based() {
            return a.columns.zero_based() < b.columns.zero_based();
        }
        a_index < b_index
    }
}

pub struct Lookup {
    pub mapping: Mapping,
    pub source_map: Option<std::sync::Arc<ParsedSourceMap>>,
    /// Owned by default_allocator always
    /// use `get_source_code` to access this as a Slice
    pub prefetched_source_code: Option<Box<[u8]>>,

    pub name: Option<Box<[u8]>>,
}

impl Lookup {
    /// This creates a bun.String if the source remap *changes* the source url,
    /// which is only possible if the executed file differs from the source file:
    ///
    /// - `bun build --sourcemap`, it is another file on disk
    /// - `bun build --compile --sourcemap`, it is an embedded file.
    pub fn display_source_url_if_needed(&self, base_filename: &[u8]) -> Option<bun_core::String> {
        let source_map = self.source_map.as_deref()?;
        // See doc comment on `external_source_names`
        if source_map.external_source_names.len() == 0 {
            return None;
        }
        let source_idx = usize::try_from(self.mapping.source_index).ok()?;
        if source_idx >= source_map.external_source_names.len() {
            return None;
        }

        let name: &[u8] = &source_map.external_source_names[source_idx];

        if source_map.is_standalone_module_graph {
            return Some(bun_core::String::clone_utf8(name));
        }

        if bun_paths::is_absolute(base_filename) {
            // `platform::Auto` is a cfg-selected
            // type alias (Posix on unix, Windows on windows).
            let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(base_filename);
            return Some(bun_core::String::clone_utf8(
                bun_paths::resolve_path::join_abs::<bun_paths::platform::Auto>(dir, name),
            ));
        }

        Some(bun_core::String::borrow_utf8(name))
    }

    /// Only valid if `lookup.source_map.is_external()`
    /// This has the possibility of invoking a call to the filesystem.
    ///
    /// This data is freed after printed on the assumption that printing
    /// errors to the console are rare (this isnt used for error.stack)
    pub fn get_source_code(self, base_filename: &[u8]) -> Option<ZigStringSlice> {
        let bytes: Vec<u8> = 'bytes: {
            if let Some(code) = self.prefetched_source_code {
                break 'bytes code.into_vec();
            }

            let source_map = self.source_map.as_deref()?;
            debug_assert!(source_map.is_external());

            let provider = source_map.underlying_provider.provider()?;

            let index = usize::try_from(self.mapping.source_index).ok()?;

            // Standalone module graph source maps are stored (in memory) compressed.
            // They are decompressed on demand.
            if source_map.is_standalone_module_graph {
                let serialized = source_map.standalone_module_graph_data();
                if index >= source_map.external_source_names.len() {
                    return None;
                }

                // SAFETY: `standalone_module_graph_data` returns a pointer
                // owned by the standalone module graph trailer; lifetime is
                // process-static (mmapped). `source_file_contents` mutates the
                // decompression cache in-place.
                let code = unsafe { (*serialized).source_file_contents(index) };

                return Some(ZigStringSlice::from_utf8_never_free(code?));
            }

            if let Some(parsed) = provider.get_source_map(
                base_filename,
                source_map.underlying_provider.load_hint(),
                crate::ParseUrlResultHint::SourceOnly(u32::try_from(index).expect("int cast")),
            ) {
                if let Some(contents) = parsed.source_contents {
                    break 'bytes contents.into_vec();
                }
            }

            if index >= source_map.external_source_names.len() {
                return None;
            }

            let name: &[u8] = &source_map.external_source_names[index];

            let mut buf = bun_paths::PathBuffer::uninit();
            // `platform::Auto` is
            // cfg-selected (Posix on unix, Windows on windows).
            let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(base_filename);
            let normalized = bun_paths::resolve_path::join_abs_string_buf_z::<
                bun_paths::platform::Loose,
            >(dir, &mut buf, &[name]);
            match bun_sys::File::read_from(bun_sys::Fd::cwd(), normalized) {
                Ok(r) => break 'bytes r,
                Err(_) => return None,
            }
        };

        Some(ZigStringSlice::init_owned(bytes))
    }
}

impl Mapping {
    #[inline]
    pub fn generated_line(&self) -> i32 {
        self.generated.lines.zero_based()
    }

    #[inline]
    pub fn generated_column(&self) -> i32 {
        self.generated.columns.zero_based()
    }

    #[inline]
    pub fn source_index(&self) -> i32 {
        self.source_index
    }

    #[inline]
    pub fn original_line(&self) -> i32 {
        self.original.lines.zero_based()
    }

    #[inline]
    pub fn original_column(&self) -> i32 {
        self.original.columns.zero_based()
    }

    #[inline]
    pub fn name_index(&self) -> i32 {
        self.name_index
    }
}

#[derive(Default, Clone, Copy)]
pub struct ParseOptions {
    pub allow_names: bool,
    pub sort: bool,
}

const HALF_USIZE: usize = size_of::<usize>() / 2;
const SEMICOLON_RUN: [u8; HALF_USIZE] = [b';'; HALF_USIZE];

/// Below this input size the scalar loop is used unconditionally; above it,
/// the Highway kernel classifies whole blocks and the scalar loop only
/// handles the tail / anomalies. One block is 16–64 bytes depending on the
/// runtime-dispatched ISA; 128 bytes guarantees at least two full blocks.
const SIMD_THRESHOLD: usize = 128;

/// Output-column chunk size for the SIMD pass. The kernel writes directly
/// into the `MultiArrayList` column arrays (no intermediate buffer), so the
/// only per-chunk scratch is a `SIMD_CHUNK_ROWS` i32 name-index overflow
/// buffer for the without-names variant (4 KiB at 1 Ki rows), boxed rather
/// than stack-local because this path can run while formatting a
/// stack-overflow error.
const SIMD_CHUNK_ROWS: usize = 1024;

pub fn parse(
    bytes: &[u8],
    estimated_mapping_count: Option<usize>,
    sources_count: i32,
    input_line_count: usize,
    options: ParseOptions,
) -> ParseResult {
    scoped_log!(SourceMap, "parse mappings ({} bytes)", bytes.len());

    let mut mapping = List::default();
    // `errdefer mapping.deinit(allocator)` deleted: `List: Drop` and this fn returns no error union.

    if let Some(count) = estimated_mapping_count {
        if mapping.ensure_total_capacity(count).is_err() {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Out of memory",
                err: err!("OutOfMemory"),
                loc: Loc::default(),
                ..Default::default()
            });
        }
    }

    let mut generated = LineColumnOffset {
        lines: Ordinal::START,
        columns: Ordinal::START,
    };
    let mut original = LineColumnOffset {
        lines: Ordinal::START,
        columns: Ordinal::START,
    };
    let mut name_index: i32 = 0;
    let mut source_index: i32 = 0;
    let mut needs_sort = false;
    let mut remain = bytes;
    let mut has_names = false;

    if bytes.len() >= SIMD_THRESHOLD
        && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP::get()
            .unwrap_or(false)
    {
        match parse_simd(bytes, &mut mapping, sources_count, options) {
            SimdResult::Done {
                resume_at,
                state,
                has_names: simd_has_names,
            } => {
                generated.lines = Ordinal::from_zero_based(state.gen_line);
                generated.columns = Ordinal::from_zero_based(state.gen_col);
                original.lines = Ordinal::from_zero_based(state.orig_line);
                original.columns = Ordinal::from_zero_based(state.orig_col);
                source_index = state.src_idx;
                name_index = state.name_idx;
                needs_sort = state.needs_sort != 0;
                has_names = simd_has_names;
                remain = &bytes[resume_at..];
                scoped_log!(
                    SourceMap,
                    "simd consumed {}/{} bytes",
                    resume_at,
                    bytes.len()
                );
            }
            SimdResult::OutOfMemory => {
                return ParseResult::Fail(ParseResultFail {
                    msg: b"Out of memory",
                    err: err!("OutOfMemory"),
                    loc: Loc::default(),
                    ..Default::default()
                });
            }
        }
    }

    while remain.len() > 0 {
        if remain[0] == b';' {
            generated.columns = Ordinal::START;

            while remain.starts_with(&SEMICOLON_RUN) {
                generated.lines = generated.lines.add_scalar(HALF_USIZE as i32);
                remain = &remain[HALF_USIZE..];
            }

            while remain.len() > 0 && remain[0] == b';' {
                generated.lines = generated.lines.add_scalar(1);
                remain = &remain[1..];
            }

            if remain.len() == 0 {
                break;
            }
        }

        // Read the generated column
        let generated_column_delta = decode_vlq(remain, 0);

        if generated_column_delta.start == 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Missing generated column value",
                err: err!("MissingGeneratedColumnValue"),
                value: generated.columns.zero_based(),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }

        needs_sort = needs_sort || generated_column_delta.value < 0;

        generated.columns = generated.columns.add_scalar(generated_column_delta.value);
        if generated.columns.zero_based() < 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid generated column value",
                err: err!("InvalidGeneratedColumnValue"),
                value: generated.columns.zero_based(),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }

        remain = &remain[generated_column_delta.start..];

        // According to the specification, it's valid for a mapping to have 1,
        // 4, or 5 variable-length fields. Having one field means there's no
        // original location information, which is pretty useless. Just ignore
        // those entries.
        if remain.len() == 0 {
            break;
        }

        match remain[0] {
            b',' => {
                remain = &remain[1..];
                continue;
            }
            b';' => {
                continue;
            }
            _ => {}
        }

        // Read the original source
        let source_index_delta = decode_vlq(remain, 0);
        if source_index_delta.start == 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid source index delta",
                err: err!("InvalidSourceIndexDelta"),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
                ..Default::default()
            });
        }
        source_index += source_index_delta.value;

        if source_index < 0 || source_index >= sources_count {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid source index value",
                err: err!("InvalidSourceIndexValue"),
                value: source_index,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        remain = &remain[source_index_delta.start..];

        // Read the original line
        let original_line_delta = decode_vlq(remain, 0);
        if original_line_delta.start == 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Missing original line",
                err: err!("MissingOriginalLine"),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
                ..Default::default()
            });
        }

        original.lines = original.lines.add_scalar(original_line_delta.value);
        if original.lines.zero_based() < 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid original line value",
                err: err!("InvalidOriginalLineValue"),
                value: original.lines.zero_based(),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        remain = &remain[original_line_delta.start..];

        // Read the original column
        let original_column_delta = decode_vlq(remain, 0);
        if original_column_delta.start == 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Missing original column value",
                err: err!("MissingOriginalColumnValue"),
                value: original.columns.zero_based(),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }

        original.columns = original.columns.add_scalar(original_column_delta.value);
        if original.columns.zero_based() < 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid original column value",
                err: err!("InvalidOriginalColumnValue"),
                value: original.columns.zero_based(),
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        remain = &remain[original_column_delta.start..];

        if remain.len() > 0 {
            match remain[0] {
                b',' => {
                    // 4 column, but there's more on this line.
                    remain = &remain[1..];
                }
                // 4 column, and there's no more on this line.
                b';' => {}

                // 5th column: the name
                c => {
                    // Read the name index
                    let name_index_delta = decode_vlq(remain, 0);
                    if name_index_delta.start == 0 {
                        return ParseResult::Fail(ParseResultFail {
                            msg: b"Invalid name index delta",
                            err: err!("InvalidNameIndexDelta"),
                            value: i32::from(c),
                            loc: Loc {
                                start: i32::try_from(bytes.len() - remain.len())
                                    .unwrap_or(i32::MAX),
                            },
                        });
                    }
                    remain = &remain[name_index_delta.start..];

                    if options.allow_names {
                        name_index += name_index_delta.value;
                        if !has_names {
                            if mapping.ensure_with_names().is_err() {
                                return ParseResult::Fail(ParseResultFail {
                                    msg: b"Out of memory",
                                    err: err!("OutOfMemory"),
                                    loc: Loc {
                                        start: i32::try_from(bytes.len() - remain.len())
                                            .unwrap_or(i32::MAX),
                                    },
                                    ..Default::default()
                                });
                            }
                        }
                        has_names = true;
                    }

                    if remain.len() > 0 {
                        match remain[0] {
                            // There's more on this line.
                            b',' => {
                                remain = &remain[1..];
                            }
                            // That's the end of the line.
                            b';' => {}
                            _ => {}
                        }
                    }
                }
            }
        }
        // `catch |err| bun.handleOom(err)` → panic on OOM; do not silently drop the mapping.
        mapping
            .append(&Mapping {
                generated,
                original,
                source_index,
                name_index,
            })
            .expect("OOM");
    }

    if needs_sort && options.sort {
        mapping.sort();
    }

    let mut psm = ParsedSourceMap::default();
    psm.mappings = mapping;
    psm.input_line_count = input_line_count;
    ParseResult::Success(psm)
}

enum SimdResult {
    Done {
        resume_at: usize,
        state: bun_highway::ParseMappingsState,
        has_names: bool,
    },
    OutOfMemory,
}

/// SIMD fast path for `parse`: drives `bun_highway::parse_mappings` over
/// `bytes` in `SIMD_CHUNK_ROWS`-row chunks, writing decoded segments
/// DIRECTLY into the `MultiArrayList` column arrays (no intermediate
/// buffer). Returns the byte offset and accumulator state at which the
/// scalar loop should take over (the tail, or the first anomaly).
fn parse_simd(
    bytes: &[u8],
    mapping: &mut List,
    sources_count: i32,
    options: ParseOptions,
) -> SimdResult {
    use bun_highway::{ParseMappingsOut, ParseMappingsState};

    // `LineColumnOffset` is `#[repr(C)]` over two `#[repr(transparent)]`
    // i32s, so its column storage is byte-identical to `[[i32; 2]]`. That
    // lets the kernel write `{line, col}` pairs straight into the SoA
    // column with no per-row Rust copy.
    const _: () = assert!(size_of::<LineColumnOffset>() == size_of::<[i32; 2]>());
    const _: () = assert!(align_of::<LineColumnOffset>() == align_of::<[i32; 2]>());

    // name_index scratch for the WithoutNames variant (which has no
    // name_index column). Boxed rather than stack-local because this path
    // can run while formatting a stack-overflow error. Only allocated on
    // first use.
    let mut name_scratch: Option<Box<[i32; SIMD_CHUNK_ROWS]>> = None;

    let mut state = ParseMappingsState::default();
    let mut pos: usize = 0;
    let mut has_names = false;

    loop {
        // Reserve SIMD_CHUNK_ROWS slots on the list and hand the kernel raw
        // column pointers into that region. `ensure_unused_capacity` grows
        // geometrically (same policy as the scalar path's per-row append),
        // so peak memory matches scalar; there is no upfront over-reserve.
        let base = mapping.len();
        let (rows, err_at);
        match &mut mapping.r#impl {
            ListValue::WithoutNames(list) => {
                if list.ensure_unused_capacity(SIMD_CHUNK_ROWS).is_err() {
                    return SimdResult::OutOfMemory;
                }
                let ni = name_scratch.get_or_insert_with(|| Box::new([0i32; SIMD_CHUNK_ROWS]));
                let mut ea: usize = 0;
                // SAFETY: `ensure_unused_capacity(SIMD_CHUNK_ROWS)` guarantees
                // each column has at least `base + SIMD_CHUNK_ROWS` slots.
                // `items_raw` returns the column base; the kernel writes only
                // indices `[base, base+cap)`. `LineColumnOffset` is repr(C)
                // over two i32s so reinterpreting as `[[i32; 2]]` is sound.
                let r = unsafe {
                    let generated = core::slice::from_raw_parts_mut(
                        list.items_raw::<"generated", LineColumnOffset>()
                            .add(base)
                            .cast::<[i32; 2]>(),
                        SIMD_CHUNK_ROWS,
                    );
                    let original = core::slice::from_raw_parts_mut(
                        list.items_raw::<"original", LineColumnOffset>()
                            .add(base)
                            .cast::<[i32; 2]>(),
                        SIMD_CHUNK_ROWS,
                    );
                    let src_idx = core::slice::from_raw_parts_mut(
                        list.items_raw::<"source_index", i32>().add(base),
                        SIMD_CHUNK_ROWS,
                    );
                    bun_highway::parse_mappings(
                        &bytes[pos..],
                        &mut ParseMappingsOut {
                            generated,
                            original,
                            src_idx,
                            name_idx: &mut **ni,
                        },
                        sources_count,
                        &mut state,
                        &mut ea,
                    )
                };
                // SAFETY: capacity reserved above; every slot in
                // `base..base+r` was just initialized by the kernel.
                unsafe { list.set_len(base + r) };
                rows = r;
                err_at = ea;
            }
            ListValue::WithNames(list) => {
                if list.ensure_unused_capacity(SIMD_CHUNK_ROWS).is_err() {
                    return SimdResult::OutOfMemory;
                }
                let mut ea: usize = 0;
                // SAFETY: same as the WithoutNames arm above, plus the
                // name_index column.
                let r = unsafe {
                    let generated = core::slice::from_raw_parts_mut(
                        list.items_raw::<"generated", LineColumnOffset>()
                            .add(base)
                            .cast::<[i32; 2]>(),
                        SIMD_CHUNK_ROWS,
                    );
                    let original = core::slice::from_raw_parts_mut(
                        list.items_raw::<"original", LineColumnOffset>()
                            .add(base)
                            .cast::<[i32; 2]>(),
                        SIMD_CHUNK_ROWS,
                    );
                    let src_idx = core::slice::from_raw_parts_mut(
                        list.items_raw::<"source_index", i32>().add(base),
                        SIMD_CHUNK_ROWS,
                    );
                    let name_idx = core::slice::from_raw_parts_mut(
                        list.items_raw::<"name_index", i32>().add(base),
                        SIMD_CHUNK_ROWS,
                    );
                    bun_highway::parse_mappings(
                        &bytes[pos..],
                        &mut ParseMappingsOut {
                            generated,
                            original,
                            src_idx,
                            name_idx,
                        },
                        sources_count,
                        &mut state,
                        &mut ea,
                    )
                };
                // SAFETY: capacity reserved above; every slot in
                // `base..base+r` was just initialized by the kernel.
                unsafe { list.set_len(base + r) };
                rows = r;
                err_at = ea;
            }
        }

        // First 5-field segment seen: switch the list to the with-names
        // variant (copies existing rows; happens at most once). The rows
        // just appended carry over; their name_index column is filled from
        // `name_scratch` (which the kernel wrote the accumulated name index
        // to even while the list was WithoutNames).
        if options.allow_names && state.has_names != 0 && !has_names {
            if mapping.ensure_with_names().is_err() {
                return SimdResult::OutOfMemory;
            }
            if let (ListValue::WithNames(list), Some(ni)) =
                (&mut mapping.r#impl, name_scratch.as_ref())
            {
                let ni_ptr = list.items_raw::<"name_index", i32>();
                for i in 0..rows {
                    // SAFETY: `ensure_with_names` reserved `len()` slots and
                    // `base + i < base + rows = len()`.
                    unsafe { *ni_ptr.add(base + i) = ni[i] };
                }
            }
            has_names = true;
        }

        pos += err_at;

        // rows == cap and there's still input: the kernel stopped because
        // output filled, not because of an anomaly. Re-enter with fresh
        // capacity (state was already written back by the kernel).
        if rows == SIMD_CHUNK_ROWS && pos < bytes.len() {
            continue;
        }
        break;
    }

    scoped_log!(
        SourceMap,
        "simd fast={} slow={} blocks",
        state.fast_blocks,
        state.slow_blocks
    );

    // When !allow_names, the scalar path never accumulates name_index (it
    // decodes the 5th field but discards it), so it stays 0.
    if !options.allow_names {
        state.name_idx = 0;
    }

    SimdResult::Done {
        resume_at: pos,
        state,
        has_names,
    }
}
