use bun_collections::{VecExt, index_sort};
use core::mem::size_of;
use std::collections::TryReserveError;

use bun_ast::Loc;
use bun_core::{self, Utf8Bytes};
use bun_core::{declare_scope, scoped_log};
use bun_semver::String as SemverString;
use bun_simd::spare_capacity;
use bun_simd_kernels::sourcemap::{Columns, MappingsState, count_delimiters, parse_mappings};

use crate::vlq::decode as decode_vlq;
use crate::{LineColumnOffset, Ordinal, ParseFail, ParseResult, ParsedSourceMap};

declare_scope!(SourceMap, visible);

#[derive(Clone, Copy)]
pub struct Mapping {
    pub generated: LineColumnOffset,
    pub original: LineColumnOffset,
    pub source_index: i32,
    pub name_index: i32, // = -1
}

/// A column for each field of [`Mapping`]. They are equally long.
#[derive(Default)]
pub struct List {
    generated: Vec<[i32; 2]>,
    original: Vec<[i32; 2]>,
    source_index: Vec<i32>,
    /// Optimization: if we don't care about the "names" column, then don't store the names.
    name_index: Option<Vec<i32>>,
    pub(crate) names: Box<[SemverString]>,
    pub(crate) names_buffer: Vec<u8>,
}

impl List {
    pub(crate) fn has_names(&self) -> bool {
        self.name_index.is_some()
    }

    fn ensure_with_names(&mut self) -> Result<(), TryReserveError> {
        if self.name_index.is_none() {
            let mut name_index = Vec::new();
            name_index.try_reserve_exact(self.source_index.capacity())?;
            name_index.resize(self.len(), -1);
            self.name_index = Some(name_index);
        }
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

    /// By the generated position. Ties keep their order.
    pub(crate) fn sort(&mut self) {
        let mut order = index_sort::identity(self.len());
        index_sort::sort_indices(&mut order, &mut |a, b| {
            self.generated[a as usize].cmp(&self.generated[b as usize])
        });
        index_sort::apply_permutation_by_swaps(&mut order, |a, b| {
            self.generated.swap(a, b);
            self.original.swap(a, b);
            self.source_index.swap(a, b);
            if let Some(name_index) = &mut self.name_index {
                name_index.swap(a, b);
            }
        });
    }

    pub(crate) fn append(&mut self, mapping: &Mapping) {
        let pair = |at: LineColumnOffset| [at.lines.zero_based(), at.columns.zero_based()];
        self.generated.push(pair(mapping.generated));
        self.original.push(pair(mapping.original));
        self.source_index.push(mapping.source_index);
        if let Some(name_index) = &mut self.name_index {
            name_index.push(mapping.name_index);
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.source_index.len()
    }

    pub fn find(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        let i = Self::find_index_from_generated(self.generated(), line, column)?;
        Some(Mapping {
            generated: self.generated()[i],
            original: self.original()[i],
            source_index: self.source_index[i],
            name_index: self.name_index.as_ref().map_or(-1, |column| column[i]),
        })
    }

    pub fn generated(&self) -> &[LineColumnOffset] {
        bun_core::cast_slice(&self.generated)
    }

    pub fn original(&self) -> &[LineColumnOffset] {
        bun_core::cast_slice(&self.original)
    }

    pub(crate) fn source_index(&self) -> &[i32] {
        &self.source_index
    }

    pub fn get_name(&self, index: i32) -> Option<&[u8]> {
        if index < 0 {
            return None;
        }
        let i = usize::try_from(index).expect("int cast");

        if i >= self.names.len() {
            return None;
        }

        if self.has_names() {
            let str: &SemverString = &self.names[i];
            return Some(str.slice(self.names_buffer.slice()));
        }

        None
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.generated.memory_cost()
            + self.original.memory_cost()
            + self.source_index.memory_cost()
            + self.name_index.as_ref().map_or(0, VecExt::memory_cost)
            + self.names_buffer.memory_cost()
            + (self.names.len() * size_of::<SemverString>())
    }

    fn reserve(&mut self, additional: usize) -> Result<(), TryReserveError> {
        self.generated.try_reserve_exact(additional)?;
        self.original.try_reserve_exact(additional)?;
        self.source_index.try_reserve_exact(additional)?;
        if let Some(name_index) = &mut self.name_index {
            name_index.try_reserve_exact(additional)?;
        }
        Ok(())
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

        let display = if source_map.standalone_module_graph.is_none()
            && bun_paths::is_absolute(base_filename)
        {
            // `platform::Auto` is a cfg-selected
            // type alias (Posix on unix, Windows on windows).
            let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(base_filename);
            bun_paths::resolve_path::join_abs::<bun_paths::platform::Auto>(dir, name)
        } else {
            name
        };

        Some(bun_core::String::clone_utf8(display))
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

            let mut buf = bun_paths::path_buffer_pool::get();
            // `platform::Auto` is
            // cfg-selected (Posix on unix, Windows on windows).
            let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(base_filename);
            // `name` comes from the source map and can be any length. A path too long for `buf` is too long to open.
            let path = bun_paths::resolve_path::join_abs_string_buf_checked::<
                bun_paths::platform::Loose,
            >(dir, &mut buf[..], &[name])?;
            match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
                Ok(r) => break 'bytes r,
                Err(_) => return None,
            }
        };

        Some(Utf8Bytes::Owned(bytes))
    }
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
/// the SIMD kernel classifies whole blocks and the scalar loop only
/// handles the tail / anomalies. One block is 16–32 bytes depending on the
/// runtime-dispatched ISA; 128 bytes guarantees at least two full blocks.
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
        if mapping.reserve(count).is_err() {
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
        let Ok((resume_at, state)) = parse_simd(bytes, &mut mapping, sources_count, options) else {
            return Err(ParseFail {
                err: crate::Error::Alloc(bun_alloc::AllocError),
                loc: Loc::default(),
            });
        };
        generated.lines = Ordinal::from_zero_based(state.gen_line);
        generated.columns = Ordinal::from_zero_based(state.gen_col);
        original.lines = Ordinal::from_zero_based(state.orig_line);
        original.columns = Ordinal::from_zero_based(state.orig_col);
        source_index = state.src_idx;
        needs_sort = state.needs_sort;
        if options.allow_names {
            (name_index, has_names) = (state.name_idx, state.has_names);
        }
        remain = &bytes[resume_at..];
        scoped_log!(
            SourceMap,
            "simd consumed {}/{} bytes",
            resume_at,
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
        mapping.append(&Mapping {
            generated,
            original,
            source_index,
            // The SIMD pre-pass adds the column before any segment has a name.
            name_index: if has_names { name_index } else { -1 },
        });
    }

    if needs_sort && options.sort {
        mapping.sort();
    }

    let mut psm = ParsedSourceMap::default();
    psm.mappings = mapping;
    Ok(psm)
}

/// SIMD fast path for `parse`: reserves the columns once and decodes into them. Returns the byte
/// offset and the state at which the scalar loop takes over (the tail, or the first anomaly).
fn parse_simd(
    bytes: &[u8],
    mapping: &mut List,
    sources_count: i32,
    options: ParseOptions,
) -> Result<(usize, MappingsState), TryReserveError> {
    // 24 bytes a row instead of 20 even if no segment has a name, but nothing to add halfway.
    if options.allow_names {
        mapping.ensure_with_names()?;
    }
    // A comma or a semicolon follows each segment but the last.
    mapping.reserve(count_delimiters(bytes) + 1)?;

    let (generated, to_generated) = spare_capacity(&mut mapping.generated);
    let (original, to_original) = spare_capacity(&mut mapping.original);
    let (src_idx, to_src_idx) = spare_capacity(&mut mapping.source_index);
    let (name_idx, to_name_idx) = mapping.name_index.as_mut().map(spare_capacity).unzip();
    let out = Columns {
        generated,
        original,
        src_idx,
        name_idx,
    };
    let mut state = MappingsState::default();
    let (rows, resume_at) = parse_mappings(bytes, out, sources_count, &mut state);
    to_generated.append(rows.generated);
    to_original.append(rows.original);
    to_src_idx.append(rows.src_idx);
    if let Some((to_name_idx, name_idx)) = to_name_idx.zip(rows.name_idx) {
        to_name_idx.append(name_idx);
    }
    Ok((resume_at, state))
}
