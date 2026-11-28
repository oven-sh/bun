use bun_collections::VecExt;
use core::mem::size_of;
use core::slice::from_raw_parts_mut;

use bun_ast::Loc;
use bun_collections::MultiArrayList;
use bun_core::{self, Utf8Bytes};
use bun_core::{declare_scope, scoped_log};
use bun_paths::portable::from_portable_rooted;
use bun_semver::String as SemverString;
use bun_simd_kernels::sourcemap as simd;

use crate::vlq::decode as decode_vlq;
use crate::{LineColumnOffset, Ordinal, ParseFail, ParseResult, ParsedSourceMap};

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
#[derive(Clone, Copy)]
pub struct Mapping {
    pub generated: LineColumnOffset,
    pub original: LineColumnOffset,
    pub source_index: i32,
    pub name_index: i32, // = -1
}

/// Optimization: if we don't care about the "names" column, then don't store the names.
#[derive(Clone, Copy, Default)]
pub struct MappingWithoutName {
    pub(crate) generated: LineColumnOffset,
    pub(crate) original: LineColumnOffset,
    pub(crate) source_index: i32,
}

impl MappingWithoutName {
    fn to_named(&self) -> Mapping {
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
    fn memory_cost(&self) -> usize {
        both_lists!(self, |list| list.memory_cost())
    }

    fn ensure_total_capacity(&mut self, count: usize) -> Result<(), bun_alloc::AllocError> {
        both_lists!(self, |list| list.ensure_total_capacity(count))
    }

    /// Empties the list and lends the whole capacity of each column.
    fn clear_columns(&mut self) -> simd::Columns<'_> {
        const _: () = assert!(size_of::<LineColumnOffset>() == size_of::<[i32; 2]>());
        const _: () = assert!(align_of::<LineColumnOffset>() == align_of::<[i32; 2]>());

        let name = match self {
            ListValue::WithoutNames(_) => None,
            ListValue::WithNames(list) => Some(list.items_raw::<"name_index", i32>()),
        };
        let (generated, original, source, rows) = both_lists!(self, |list| {
            list.clear_retaining_capacity();
            (
                list.items_raw::<"generated", LineColumnOffset>(),
                list.items_raw::<"original", LineColumnOffset>(),
                list.items_raw::<"source_index", i32>(),
                list.capacity(),
            )
        });
        // SAFETY: the columns are disjoint, aligned and have `rows` slots each, which `&mut self`
        // lends exclusively. `LineColumnOffset` is `repr(C)` over two `repr(transparent)` `i32`s.
        unsafe {
            simd::Columns {
                generated: from_raw_parts_mut(generated.cast(), rows),
                original: from_raw_parts_mut(original.cast(), rows),
                source: from_raw_parts_mut(source.cast(), rows),
                name: name.map(|name| from_raw_parts_mut(name.cast(), rows)),
            }
        }
    }
}

#[derive(Default)]
pub struct List {
    pub(crate) r#impl: ListValue,
    pub(crate) names: Box<[SemverString]>,
    pub(crate) names_buffer: Vec<u8>,
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

    pub(crate) fn sort(&mut self) {
        both_lists!(&mut self.r#impl, |list| {
            list.sort_by_column::<"generated", LineColumnOffset>(|a, b| {
                (a.lines.zero_based(), a.columns.zero_based())
                    .cmp(&(b.lines.zero_based(), b.columns.zero_based()))
            });
        })
    }

    pub(crate) fn append(&mut self, mapping: &Mapping) -> Result<(), bun_alloc::AllocError> {
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
        both_lists!(&self.r#impl, |list| list.items_generated())
    }

    pub fn original(&self) -> &[LineColumnOffset] {
        both_lists!(&self.r#impl, |list| list.items_original())
    }

    pub(crate) fn source_index(&self) -> &[i32] {
        both_lists!(&self.r#impl, |list| list.items_source_index())
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

    pub(crate) fn memory_cost(&self) -> usize {
        self.r#impl.memory_cost()
            + self.names_buffer.memory_cost()
            + (self.names.len() * size_of::<SemverString>())
    }

    pub(crate) fn ensure_total_capacity(
        &mut self,
        count: usize,
    ) -> Result<(), bun_alloc::AllocError> {
        self.r#impl.ensure_total_capacity(count)
    }
}

pub struct Lookup {
    pub mapping: Mapping,
    pub source_map: Option<std::sync::Arc<ParsedSourceMap>>,
    /// Owned by default_allocator always
    /// use `get_source_code` to access this as a Slice
    pub prefetched_source_code: Option<Box<[u8]>>,
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

        if source_map.standalone_module_graph.is_none() && bun_paths::is_absolute(base_filename) {
            let path = path_of_source(base_filename, name);
            return Some(bun_core::String::clone_utf8(&path));
        }

        Some(bun_core::String::clone_utf8(name))
    }

    /// Only valid if `lookup.source_map.is_external()`
    /// This has the possibility of invoking a call to the filesystem.
    ///
    /// This data is freed after printed on the assumption that printing
    /// errors to the console are rare (this isnt used for error.stack)
    pub fn get_source_code(self, base_filename: &[u8]) -> Option<Utf8Bytes<'static>> {
        let bytes: Vec<u8> = 'bytes: {
            if let Some(code) = self.prefetched_source_code {
                break 'bytes code.into_vec();
            }

            let source_map = self.source_map.as_deref()?;
            debug_assert!(source_map.is_external());

            let index = usize::try_from(self.mapping.source_index).ok()?;

            // Standalone module graph source maps are stored (in memory) compressed.
            // They are decompressed on demand.
            if let Some(serialized) = source_map.standalone_module_graph {
                if index >= source_map.external_source_names.len() {
                    return None;
                }

                let code = serialized.source_file_contents(index);

                return Some(Utf8Bytes::Borrowed(code?));
            }

            let provider = source_map.underlying_provider.provider()?;

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

            let path = path_of_source(base_filename, name);
            match bun_sys::File::read_from(bun_sys::Fd::cwd(), &path) {
                Ok(r) => break 'bytes r,
                Err(_) => return None,
            }
        };

        Some(Utf8Bytes::Owned(bytes))
    }
}

/// `source` is an entry of the `sources` of the map for `generated_file`.
fn path_of_source(generated_file: &[u8], source: &[u8]) -> bun_paths::Path {
    let dir = bun_paths::dirname_or_root(generated_file);
    let mut path = bun_paths::Path::resolve(&[dir, &from_portable_rooted(source)]);
    path.copy_trailing_sep_from(source);
    path
}

impl Mapping {
    #[inline]
    pub fn original_line(&self) -> i32 {
        self.original.lines.zero_based()
    }

    #[inline]
    pub fn original_column(&self) -> i32 {
        self.original.columns.zero_based()
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
/// the scalar loop only handles the last segment and anomalies.
const SIMD_THRESHOLD: usize = 128;

pub fn parse(
    bytes: &[u8],
    estimated_mapping_count: Option<usize>,
    sources_count: i32,
    options: ParseOptions,
) -> ParseResult {
    scoped_log!(SourceMap, "parse mappings ({} bytes)", bytes.len());

    let mut mapping = List::default();
    // `errdefer mapping.deinit(allocator)` deleted: `List: Drop` and this fn returns no error union.

    if let Some(count) = estimated_mapping_count {
        if mapping.ensure_total_capacity(count).is_err() {
            return Err(ParseFail {
                err: crate::Error::Alloc(bun_alloc::AllocError),
                loc: Loc::default(),
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
        let Ok(parsed) = parse_simd(bytes, &mut mapping, sources_count, options) else {
            return Err(ParseFail {
                err: crate::Error::Alloc(bun_alloc::AllocError),
                loc: Loc::default(),
            });
        };
        generated.lines = Ordinal::from_zero_based(parsed.generated_line);
        generated.columns = Ordinal::from_zero_based(parsed.generated_column);
        original.lines = Ordinal::from_zero_based(parsed.original_line);
        original.columns = Ordinal::from_zero_based(parsed.original_column);
        source_index = parsed.source;
        needs_sort = parsed.needs_sort;
        if options.allow_names {
            name_index = parsed.name;
            has_names = parsed.has_names;
        }
        remain = &bytes[parsed.resume_at..];
        scoped_log!(
            SourceMap,
            "simd consumed {}/{} bytes",
            parsed.resume_at,
            bytes.len()
        );
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
            return Err(ParseFail {
                err: crate::Error::MissingGeneratedColumnValue,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }

        needs_sort = needs_sort || generated_column_delta.value < 0;

        let generated_column = generated
            .columns
            .zero_based()
            .wrapping_add(generated_column_delta.value);
        if generated_column < 0 {
            return Err(ParseFail {
                err: crate::Error::InvalidGeneratedColumnValue,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        generated.columns = Ordinal::from_zero_based(generated_column);

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
            return Err(ParseFail {
                err: crate::Error::InvalidSourceIndexDelta,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        source_index = source_index.wrapping_add(source_index_delta.value);

        if source_index < 0 || source_index >= sources_count {
            return Err(ParseFail {
                err: crate::Error::InvalidSourceIndexValue,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        remain = &remain[source_index_delta.start..];

        // Read the original line
        let original_line_delta = decode_vlq(remain, 0);
        if original_line_delta.start == 0 {
            return Err(ParseFail {
                err: crate::Error::MissingOriginalLine,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }

        let original_line = original
            .lines
            .zero_based()
            .wrapping_add(original_line_delta.value);
        if original_line < 0 {
            return Err(ParseFail {
                err: crate::Error::InvalidOriginalLineValue,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        original.lines = Ordinal::from_zero_based(original_line);
        remain = &remain[original_line_delta.start..];

        // Read the original column
        let original_column_delta = decode_vlq(remain, 0);
        if original_column_delta.start == 0 {
            return Err(ParseFail {
                err: crate::Error::MissingOriginalColumnValue,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }

        let original_column = original
            .columns
            .zero_based()
            .wrapping_add(original_column_delta.value);
        if original_column < 0 {
            return Err(ParseFail {
                err: crate::Error::InvalidOriginalColumnValue,
                loc: Loc {
                    start: i32::try_from(bytes.len() - remain.len()).unwrap_or(i32::MAX),
                },
            });
        }
        original.columns = Ordinal::from_zero_based(original_column);
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
                _ => {
                    // Read the name index
                    let name_index_delta = decode_vlq(remain, 0);
                    if name_index_delta.start == 0 {
                        return Err(ParseFail {
                            err: crate::Error::InvalidNameIndexDelta,
                            loc: Loc {
                                start: i32::try_from(bytes.len() - remain.len())
                                    .unwrap_or(i32::MAX),
                            },
                        });
                    }
                    remain = &remain[name_index_delta.start..];

                    if options.allow_names {
                        name_index = name_index.wrapping_add(name_index_delta.value);
                        if !has_names {
                            if mapping.ensure_with_names().is_err() {
                                return Err(ParseFail {
                                    err: crate::Error::Alloc(bun_alloc::AllocError),
                                    loc: Loc {
                                        start: i32::try_from(bytes.len() - remain.len())
                                            .unwrap_or(i32::MAX),
                                    },
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
                // Rows before any 5-field segment surface as name_index -1.
                // Without the SIMD pre-pass this happens implicitly: the
                // list is WithoutNames so append discards this field, and
                // find()/ensure_with_names() later fill it with -1 via
                // to_named(). The SIMD pre-pass promotes to WithNames up
                // front when allow_names is true, so this loop's rows must
                // carry -1 explicitly until the first 5-field segment.
                name_index: if has_names { name_index } else { -1 },
            })
            .expect("OOM");
    }

    if needs_sort && options.sort {
        mapping.sort();
    }

    let mut psm = ParsedSourceMap::default();
    psm.mappings = mapping;
    Ok(psm)
}

/// SIMD fast path for `parse`: count delimiters to bound the row count,
/// reserve the `MultiArrayList` once, then decode the whole input in one
/// call that writes directly into the column arrays (no intermediate buffer,
/// no chunking, no geometric-growth reallocs). Returns the byte offset and
/// accumulator state at which the scalar loop should take over (the last
/// segment, or the first anomaly).
fn parse_simd(
    bytes: &[u8],
    mapping: &mut List,
    sources_count: i32,
    options: ParseOptions,
) -> Result<simd::Parsed, bun_alloc::AllocError> {
    // Segments on a line are comma-separated and lines are semicolon-
    // separated, so `delims + 1` upper-bounds the segment count (and
    // therefore the row count). This is within a few percent of the
    // actual count on real maps and lets us reserve exactly once instead
    // of paying ~log1.5(N) geometric-growth memcpys (the dominant cost of
    // the scalar path on large inputs). The final list is the same size
    // the scalar path ends up at; we just skip the intermediate copies.
    let seg_bound = simd::count_delimiters(bytes) + 1;

    // When the caller wants names, switch to the with-names variant
    // before reserving so the reserve lands on the right list. This uses
    // 24 bytes/row instead of 20 even when the input turns out to have no
    // 5-field segments; in exchange there is no mid-stream copy-on-
    // promotion and no name-index scratch buffer. Rows before the first
    // 5-field segment still get name_index == -1 (the kernel writes -1
    // until has_names flips), matching scalar's `to_named()` behaviour.
    if options.allow_names {
        mapping.ensure_with_names()?;
    }
    mapping.ensure_total_capacity(seg_bound)?;

    let parsed = simd::parse_mappings(bytes, mapping.r#impl.clear_columns(), sources_count);
    // SAFETY: the kernel initialized this many rows of every column.
    both_lists!(&mut mapping.r#impl, |list| unsafe {
        list.set_len(parsed.rows)
    });

    scoped_log!(
        SourceMap,
        "simd rows={} seg_bound={}",
        parsed.rows,
        seg_bound
    );
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_mappings_fill_the_columns() {
        for allow_names in [false, true] {
            let bytes = [&b"CAAC,".repeat(40)[..], b"CACAE;;AAAC,AAAC"].concat();
            let options = ParseOptions {
                allow_names,
                sort: true,
            };
            let Ok(parsed) = parse(&bytes, None, 1, options) else {
                panic!("does not parse");
            };
            let list = &parsed.mappings;
            assert_eq!(list.source_index(), [0; 43]);
            let name_at = |line, column| {
                let found = list.find(Ordinal(line), Ordinal(column)).unwrap();
                (
                    found.original_line(),
                    found.original_column(),
                    found.name_index,
                )
            };
            let name = if allow_names { 2 } else { -1 };
            assert_eq!(name_at(0, 40), (0, 40, -1));
            assert_eq!(name_at(0, 41), (1, 40, name));
            assert_eq!(name_at(2, 0), (1, 42, name));
        }
    }

    #[test]
    #[cfg_attr(miri, ignore = "takes too long")]
    fn the_last_segment_goes_on_from_the_one_before() {
        let bytes = [b"ECAA,DAAA,", &b"EAAA,".repeat(30)[..], b"CAAA"].concat();
        let options = ParseOptions {
            allow_names: false,
            sort: true,
        };
        let Ok(parsed) = parse(&bytes, None, 2, options) else {
            panic!("does not parse");
        };
        let columns = parsed.mappings.generated().iter().map(|it| it.columns.0);
        assert!(columns.eq((1..3).chain((3..62).step_by(2)).chain([62])));
        assert_eq!(parsed.mappings.source_index(), [1; 33]);
        let quick = parse_simd(&bytes, &mut List::default(), 2, options);
        assert!(quick.is_ok_and(|it| it.rows == 32));
        assert!(parse(&[b'A'; 130], None, 1, options).is_ok());
    }
}
