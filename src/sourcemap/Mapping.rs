use bun_collections::VecExt;
use core::mem::{align_of, size_of};

use bun_collections::multi_array_list::{MultiArrayElement, Slice as MalSlice};
use bun_collections::{ByteVecExt, MultiArrayList};
use bun_core::{declare_scope, err, scoped_log};
use bun_logger::Loc;
use bun_semver::String as SemverString;
use bun_str::{self, ZigStringSlice};

use crate::vlq::decode as decode_vlq;
use crate::{LineColumnOffset, Ordinal, ParseResult, ParseResultFail, ParsedSourceMap};

declare_scope!(SourceMap, visible);

// ── manual MultiArrayElement impls (derive macro not yet available) ───────
// `Mapping` and `MappingWithoutName` have all-`Copy` fields with the same
// alignment (LineColumnOffset is two c_ints → align 4; i32 align 4), so the
// size-sorted order is identity.

#[repr(usize)]
#[derive(Copy, Clone)]
pub enum MappingField {
    Generated = 0,
    Original = 1,
    SourceIndex = 2,
    NameIndex = 3,
}

impl MultiArrayElement for Mapping {
    type Field = MappingField;
    const FIELD_COUNT: usize = 4;
    const ALIGN: usize = align_of::<LineColumnOffset>();
    const SIZES_BYTES: &'static [usize] = &[
        size_of::<LineColumnOffset>(),
        size_of::<LineColumnOffset>(),
        size_of::<i32>(),
        size_of::<i32>(),
    ];
    const SIZES_FIELDS: &'static [usize] = &[0, 1, 2, 3];
    #[inline] fn field_index(f: Self::Field) -> usize { f as usize }
    #[inline]
    unsafe fn scatter(self, ptrs: &[*mut u8], i: usize) {
        // SAFETY: caller guarantees valid columns with capacity > i.
        unsafe {
            ptrs[0].cast::<LineColumnOffset>().add(i).write(self.generated);
            ptrs[1].cast::<LineColumnOffset>().add(i).write(self.original);
            ptrs[2].cast::<i32>().add(i).write(self.source_index);
            ptrs[3].cast::<i32>().add(i).write(self.name_index);
        }
    }
    #[inline]
    unsafe fn gather(ptrs: &[*mut u8], i: usize) -> Self {
        // SAFETY: caller guarantees valid columns with len > i.
        unsafe {
            Mapping {
                generated: ptrs[0].cast::<LineColumnOffset>().add(i).read(),
                original: ptrs[1].cast::<LineColumnOffset>().add(i).read(),
                source_index: ptrs[2].cast::<i32>().add(i).read(),
                name_index: ptrs[3].cast::<i32>().add(i).read(),
            }
        }
    }
}

#[repr(usize)]
#[derive(Copy, Clone)]
pub enum MappingWithoutNameField {
    Generated = 0,
    Original = 1,
    SourceIndex = 2,
}

impl MultiArrayElement for MappingWithoutName {
    type Field = MappingWithoutNameField;
    const FIELD_COUNT: usize = 3;
    const ALIGN: usize = align_of::<LineColumnOffset>();
    const SIZES_BYTES: &'static [usize] = &[
        size_of::<LineColumnOffset>(),
        size_of::<LineColumnOffset>(),
        size_of::<i32>(),
    ];
    const SIZES_FIELDS: &'static [usize] = &[0, 1, 2];
    #[inline] fn field_index(f: Self::Field) -> usize { f as usize }
    #[inline]
    unsafe fn scatter(self, ptrs: &[*mut u8], i: usize) {
        // SAFETY: caller guarantees valid columns with capacity > i.
        unsafe {
            ptrs[0].cast::<LineColumnOffset>().add(i).write(self.generated);
            ptrs[1].cast::<LineColumnOffset>().add(i).write(self.original);
            ptrs[2].cast::<i32>().add(i).write(self.source_index);
        }
    }
    #[inline]
    unsafe fn gather(ptrs: &[*mut u8], i: usize) -> Self {
        // SAFETY: caller guarantees valid columns with len > i.
        unsafe {
            MappingWithoutName {
                generated: ptrs[0].cast::<LineColumnOffset>().add(i).read(),
                original: ptrs[1].cast::<LineColumnOffset>().add(i).read(),
                source_index: ptrs[2].cast::<i32>().add(i).read(),
            }
        }
    }
}

// Typed SoA column accessors — what `#[derive(MultiArrayElement)]` would emit.
// Implemented locally on `MultiArrayList<T>` via `Slice::items::<F>`.
trait MappingColumns {
    fn items_generated(&self) -> &[LineColumnOffset];
    fn items_original(&self) -> &[LineColumnOffset];
    fn items_source_index(&self) -> &[i32];
}
impl MappingColumns for MultiArrayList<MappingWithoutName> {
    fn items_generated(&self) -> &[LineColumnOffset] {
        // SAFETY: column 0 is `LineColumnOffset` per MultiArrayElement impl above.
        unsafe { &*(self.slice().items::<LineColumnOffset>(MappingWithoutNameField::Generated) as *const [_]) }
    }
    fn items_original(&self) -> &[LineColumnOffset] {
        // SAFETY: column 1 is `LineColumnOffset`.
        unsafe { &*(self.slice().items::<LineColumnOffset>(MappingWithoutNameField::Original) as *const [_]) }
    }
    fn items_source_index(&self) -> &[i32] {
        // SAFETY: column 2 is `i32`.
        unsafe { &*(self.slice().items::<i32>(MappingWithoutNameField::SourceIndex) as *const [_]) }
    }
}
impl MappingColumns for MultiArrayList<Mapping> {
    fn items_generated(&self) -> &[LineColumnOffset] {
        // SAFETY: column 0 is `LineColumnOffset` per MultiArrayElement impl above.
        unsafe { &*(self.slice().items::<LineColumnOffset>(MappingField::Generated) as *const [_]) }
    }
    fn items_original(&self) -> &[LineColumnOffset] {
        // SAFETY: column 1 is `LineColumnOffset`.
        unsafe { &*(self.slice().items::<LineColumnOffset>(MappingField::Original) as *const [_]) }
    }
    fn items_source_index(&self) -> &[i32] {
        // SAFETY: column 2 is `i32`.
        unsafe { &*(self.slice().items::<i32>(MappingField::SourceIndex) as *const [_]) }
    }
}
trait MappingNameColumn {
    fn items_name_index(&self) -> &[i32];
}
impl MappingNameColumn for MultiArrayList<Mapping> {
    fn items_name_index(&self) -> &[i32] {
        // SAFETY: column 3 is `i32`.
        unsafe { &*(self.slice().items::<i32>(MappingField::NameIndex) as *const [_]) }
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
    pub fn to_named(&self) -> Mapping {
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

impl ListValue {
    pub fn memory_cost(&self) -> usize {
        match self {
            ListValue::WithoutNames(list) => list.memory_cost(),
            ListValue::WithNames(list) => list.memory_cost(),
        }
    }

    pub fn ensure_total_capacity(&mut self, count: usize) -> Result<(), bun_alloc::AllocError> {
        match self {
            ListValue::WithoutNames(list) => list.ensure_total_capacity(count),
            ListValue::WithNames(list) => list.ensure_total_capacity(count),
        }
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

        // PORT NOTE: reshaped for borrowck — move the without_names list out, build the
        // with_names list, then assign back. The old list drops at end of scope.
        let ListValue::WithoutNames(without_names) =
            core::mem::replace(&mut self.r#impl, ListValue::WithNames(MultiArrayList::default()))
        else {
            unreachable!()
        };

        let mut with_names: MultiArrayList<Mapping> = MultiArrayList::default();
        with_names.ensure_total_capacity(without_names.len())?;
        // `without_names` drops at end of scope (was `defer without_names.deinit(allocator)`).

        // PORT NOTE: Zig set_len + per-column memcpy. Rust MultiArrayList has no
        // public `set_len`; rebuild element-wise (capacity already reserved, so no
        // realloc). PERF(port): revisit once typed mut-column accessors exist.
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
        match &self.r#impl {
            ListValue::WithoutNames(list) => {
                if let Some(i) =
                    Self::find_index_from_generated(list.items_generated(), line, column)
                {
                    return Some(i);
                }
            }
            ListValue::WithNames(list) => {
                if let Some(i) =
                    Self::find_index_from_generated(list.items_generated(), line, column)
                {
                    return Some(i);
                }
            }
        }

        None
    }

    pub fn sort(&mut self) {
        // PORT NOTE: reshaped for borrowck — `MultiArrayList::sort(&self, ctx)` takes
        // `&self` (it swaps via raw column ptrs internally), so the `generated` column
        // borrow does not conflict. The `Slice` is captured by-value so its lifetime
        // is detached from `list`.
        match &self.r#impl {
            ListValue::WithoutNames(list) => {
                let slice = list.slice();
                list.sort(SortContext { slice, field: MappingWithoutNameField::Generated as usize });
            }
            ListValue::WithNames(list) => {
                let slice = list.slice();
                list.sort(SortContext { slice, field: MappingField::Generated as usize });
            }
        }
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
        match &self.r#impl {
            ListValue::WithoutNames(list) => list.items_generated(),
            ListValue::WithNames(list) => list.items_generated(),
        }
    }

    pub fn original(&self) -> &[LineColumnOffset] {
        match &self.r#impl {
            ListValue::WithoutNames(list) => list.items_original(),
            ListValue::WithNames(list) => list.items_original(),
        }
    }

    pub fn source_index(&self) -> &[i32] {
        match &self.r#impl {
            ListValue::WithoutNames(list) => list.items_source_index(),
            ListValue::WithNames(list) => list.items_source_index(),
        }
    }

    pub fn name_index(&self) -> &[i32] {
        match &self.r#impl {
            // TODO(port): Zig `inline else` calls `.items(.name_index)` on both arms, but
            // `MappingWithoutName` has no `name_index` field — relies on Zig lazy analysis.
            // Return an empty slice for the without-names case.
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
        let i = usize::try_from(index).unwrap();

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

struct SortContext<T: MultiArrayElement> {
    slice: MalSlice<T>,
    field: usize,
}

impl<T: MultiArrayElement> SortContext<T> {
    #[inline]
    fn generated(&self, index: usize) -> LineColumnOffset {
        // SAFETY: `field` is the `Generated` column index for `T` (set in
        // `List::sort` above), whose element type is `LineColumnOffset`.
        unsafe {
            let f: T::Field = core::mem::transmute_copy(&self.field);
            self.slice.items::<LineColumnOffset>(f)[index]
        }
    }
}

impl<T: MultiArrayElement> bun_collections::multi_array_list::SortContext for SortContext<T> {
    fn less_than(&self, a_index: usize, b_index: usize) -> bool {
        let a = self.generated(a_index);
        let b = self.generated(b_index);

        if a.lines.zero_based() != b.lines.zero_based() {
            return a.lines.zero_based() < b.lines.zero_based();
        }
        if a.columns.zero_based() != b.columns.zero_based() {
            return a.columns.zero_based() < b.columns.zero_based();
        }
        a_index < b_index
    }
}

pub struct Lookup<'a> {
    pub mapping: Mapping,
    pub source_map: Option<&'a ParsedSourceMap>,
    /// Owned by default_allocator always
    /// use `get_source_code` to access this as a Slice
    // TODO(port): lifetime — comment says "owned by default_allocator"; ownership is
    // transferred into the returned ZigStringSlice in `get_source_code`.
    pub prefetched_source_code: Option<Box<[u8]>>,

    pub name: Option<&'a [u8]>,
}

impl<'a> Lookup<'a> {
    /// This creates a bun.String if the source remap *changes* the source url,
    /// which is only possible if the executed file differs from the source file:
    ///
    /// - `bun build --sourcemap`, it is another file on disk
    /// - `bun build --compile --sourcemap`, it is an embedded file.
    pub fn display_source_url_if_needed(&self, base_filename: &[u8]) -> Option<bun_str::String> {
        let source_map = self.source_map?;
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
            return Some(bun_str::String::clone_utf8(name));
        }

        if bun_paths::is_absolute(base_filename) {
            // PORT NOTE: Zig passed runtime `.auto` Platform; bun_paths exposes
            // const-generic `PlatformT` only. `platform::Auto` is a cfg-selected
            // type alias (Posix on unix, Windows on windows), which is what
            // `.auto` resolved to at comptime anyway.
            let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(base_filename);
            return Some(bun_str::String::clone_utf8(
                bun_paths::resolve_path::join_abs::<bun_paths::platform::Auto>(dir, name),
            ));
        }

        Some(bun_str::String::borrow_utf8(name))
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

            let source_map = self.source_map?;
            debug_assert!(source_map.is_external());

            let Some(provider) = source_map.underlying_provider.provider() else {
                return None;
            };

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
                crate::ParseUrlResultHint::SourceOnly(u32::try_from(index).unwrap()),
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
            // PORT NOTE: Zig passed runtime `.auto` / `.loose`; bun_paths
            // exposes const-generic `PlatformT` ZSTs. `platform::Auto` is
            // cfg-selected (Posix on unix, Windows on windows) — same result.
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

    let mut generated = LineColumnOffset { lines: Ordinal::START, columns: Ordinal::START };
    let mut original = LineColumnOffset { lines: Ordinal::START, columns: Ordinal::START };
    let mut name_index: i32 = 0;
    let mut source_index: i32 = 0;
    let mut needs_sort = false;
    let mut remain = bytes;
    let mut has_names = false;
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
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
            });
        }

        needs_sort = needs_sort || generated_column_delta.value < 0;

        generated.columns = generated.columns.add_scalar(generated_column_delta.value);
        if generated.columns.zero_based() < 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid generated column value",
                err: err!("InvalidGeneratedColumnValue"),
                value: generated.columns.zero_based(),
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
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
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
                ..Default::default()
            });
        }
        source_index += source_index_delta.value;

        if source_index < 0 || source_index >= sources_count {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid source index value",
                err: err!("InvalidSourceIndexValue"),
                value: source_index,
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
            });
        }
        remain = &remain[source_index_delta.start..];

        // Read the original line
        let original_line_delta = decode_vlq(remain, 0);
        if original_line_delta.start == 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Missing original line",
                err: err!("MissingOriginalLine"),
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
                ..Default::default()
            });
        }

        original.lines = original.lines.add_scalar(original_line_delta.value);
        if original.lines.zero_based() < 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid original line value",
                err: err!("InvalidOriginalLineValue"),
                value: original.lines.zero_based(),
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
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
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
            });
        }

        original.columns = original.columns.add_scalar(original_column_delta.value);
        if original.columns.zero_based() < 0 {
            return ParseResult::Fail(ParseResultFail {
                msg: b"Invalid original column value",
                err: err!("InvalidOriginalColumnValue"),
                value: original.columns.zero_based(),
                loc: Loc { start: i32::try_from(bytes.len() - remain.len()).unwrap() },
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
                                start: i32::try_from(bytes.len() - remain.len()).unwrap(),
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
                                        start: i32::try_from(bytes.len() - remain.len()).unwrap(),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap/Mapping.zig (605 lines)
//   confidence: medium
//   todos:      6
//   notes:      MultiArrayList SoA column accessor API is assumed; ParseResult/ParsedSourceMap/Loc field shapes from sibling files; List::sort has a borrowck hazard (column slice vs &mut self).
// ──────────────────────────────────────────────────────────────────────────
