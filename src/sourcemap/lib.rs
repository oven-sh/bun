//! SourceMap — port of src/sourcemap/sourcemap.zig
//!
//! In Zig this file is a top-level struct (`pub const SourceMap = @This();`).
//! In Rust the crate root is a module, so the top-level struct is named
//! `SourceMap` explicitly and the free functions become inherent/associated
//! items where it makes sense, or crate-level fns where the Zig called them
//! freestanding.

use core::cmp::Ordering;
use core::fmt;
use std::sync::Arc;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_core::{self, Ordinal, StringJoiner};
use bun_logger as logger;
use bun_str::{self as bstr, strings, MutableString, ZigString};

// ── module declarations (siblings under src/sourcemap/) ────────────────────
mod chunk;
mod internal_source_map;
mod line_offset_table;
mod mapping;
mod parsed_source_map;
mod vlq;

pub use chunk::Chunk;
pub use internal_source_map::InternalSourceMap;
pub use line_offset_table::LineOffsetTable;
pub use mapping::Mapping;
pub use parsed_source_map::ParsedSourceMap;
pub use vlq::VLQ;

use vlq::{decode as decode_vlq, decode_assume_valid as decode_vlq_assume_valid};

// ── move-in: types pulled down from higher tiers (jsc / standalone_graph) so
//    this crate has no upward edges. See docs/CYCLEBREAK.md "→ sourcemap". ──

/// `SavedSourceMap` proper (the path-hash → provider table that hangs off the
/// VirtualMachine) stays in tier-6 `bun_jsc` — its `Value` union names
/// `BakeSourceProvider` / `DevServerSourceProvider` / `js_printer` and so
/// cannot live here without a cycle. Only the leaf global state that this
/// crate's parse path actually touches is moved down.
#[allow(non_snake_case)]
pub mod SavedSourceMap {
    /// Process-global "we hit a file with no / a broken sourcemap" note,
    /// printed once after an error stack to nudge `--sourcemap`.
    ///
    /// Zig: `pub const MissingSourceMapNoteInfo = struct { pub var ... }` — a
    /// namespace of mutable globals. Ported as a module over atomics + a
    /// `parking_lot::Mutex` (PORTING.md §Concurrency: never bare `static mut`,
    /// never `std::sync::Mutex`). Contended only on the error path.
    pub mod MissingSourceMapNoteInfo {
        use core::sync::atomic::{AtomicBool, Ordering};

        static SEEN_INVALID: AtomicBool = AtomicBool::new(false);
        // Zig kept a `PathBuffer` static + a borrowed slice into it; here the
        // mutex *owns* the bytes so the (storage, view) split disappears.
        static PATH: parking_lot::Mutex<Option<Box<[u8]>>> = parking_lot::Mutex::new(None);

        #[inline]
        pub fn set_seen_invalid(v: bool) {
            SEEN_INVALID.store(v, Ordering::Relaxed);
        }

        #[inline]
        pub fn seen_invalid() -> bool {
            SEEN_INVALID.load(Ordering::Relaxed)
        }

        /// Record the most-recent path that had no sourcemap (last-wins, like
        /// the Zig `@memcpy` into the static buffer).
        pub fn set_path(path: &[u8]) {
            let mut guard = PATH.lock();
            match guard.as_mut() {
                Some(buf) if buf.len() >= path.len() => {
                    // Reuse existing allocation when it fits — mirrors the
                    // fixed-buffer behaviour without the MAX_PATH_BYTES cap.
                    let mut v = core::mem::take(&mut *guard).unwrap().into_vec();
                    v.clear();
                    v.extend_from_slice(path);
                    *guard = Some(v.into_boxed_slice());
                }
                _ => *guard = Some(path.to_vec().into_boxed_slice()),
            }
        }

        pub fn print() {
            if SEEN_INVALID.load(Ordering::Relaxed) {
                return;
            }
            if let Some(note) = PATH.lock().as_deref() {
                bun_core::Output::note(format_args!(
                    "missing sourcemaps for {}",
                    ::bstr::BStr::new(note)
                ));
                bun_core::Output::note(format_args!(
                    "consider bundling with '--sourcemap' to get unminified traces"
                ));
            }
        }
    }
}

/// Source-map serialization for `bun build --compile` standalone executables.
/// The bundler writes this blob; the runtime mmaps it and hands a
/// `SerializedSourceMap::Loaded` to `ParsedSourceMap` for on-demand source
/// retrieval. Moved down from `bun_standalone_graph` so `ParsedSourceMap` can
/// name `Loaded` without an upward dep.
///
/// Zig nests `Header` / `Loaded` inside the struct; Rust models that namespace
/// as a module so `crate::SerializedSourceMap::Loaded` resolves as a path.
#[allow(non_snake_case)]
pub mod SerializedSourceMap {
    use bun_str::StringPointer;
    use core::mem::size_of;

    /// Following the header bytes:
    /// - `source_files_count` × `StringPointer` — file names
    /// - `source_files_count` × `StringPointer` — zstd-compressed contents
    /// - the `InternalSourceMap` blob, `map_bytes_length` bytes
    /// - all the `StringPointer` payload bytes
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Header {
        pub source_files_count: u32,
        pub map_bytes_length: u32,
    }

    /// The on-disk view (`bytes` points into the standalone-graph trailer, so
    /// it lives for the process — modelled as `'static`).
    #[derive(Clone, Copy)]
    pub struct SerializedSourceMap {
        pub bytes: &'static [u8],
    }

    impl SerializedSourceMap {
        #[inline]
        pub fn header(self) -> Header {
            // Zig: `*align(1) const Header` — read_unaligned because the blob
            // sits at an arbitrary offset inside the executable.
            // SAFETY: callers guarantee `bytes.len() >= size_of::<Header>()`.
            unsafe { core::ptr::read_unaligned(self.bytes.as_ptr().cast::<Header>()) }
        }

        pub fn mapping_blob(self) -> Option<&'static [u8]> {
            if self.bytes.len() < size_of::<Header>() {
                return None;
            }
            let head = self.header();
            let start = size_of::<Header>()
                + head.source_files_count as usize * size_of::<StringPointer>() * 2;
            if start > self.bytes.len()
                || head.map_bytes_length as usize > self.bytes.len() - start
            {
                return None;
            }
            Some(&self.bytes[start..][..head.map_bytes_length as usize])
        }

        pub fn source_file_names(self) -> &'static [StringPointer] {
            let head = self.header();
            // SAFETY: layout per `Header` doc; `StringPointer` is `repr(C)`
            // `{u32,u32}` so unaligned reads through the slice are fine on all
            // targets we ship (x86_64 / aarch64).
            unsafe {
                core::slice::from_raw_parts(
                    self.bytes[size_of::<Header>()..].as_ptr().cast::<StringPointer>(),
                    head.source_files_count as usize,
                )
            }
        }

        fn compressed_source_files(self) -> &'static [StringPointer] {
            let head = self.header();
            // SAFETY: second contiguous `StringPointer` array immediately
            // follows the first (see `Header` layout doc).
            unsafe {
                core::slice::from_raw_parts(
                    self.bytes[size_of::<Header>()..]
                        .as_ptr()
                        .cast::<StringPointer>()
                        .add(head.source_files_count as usize),
                    head.source_files_count as usize,
                )
            }
        }
    }

    /// Once loaded, this map stores additional data for keeping track of
    /// source code. Held behind `ParsedSourceMap.underlying_provider` as a raw
    /// pointer (see `ParsedSourceMap::standalone_module_graph_data`).
    pub struct Loaded {
        pub map: SerializedSourceMap,
        /// Only decompress source code once! Once a file is decompressed,
        /// it is stored here. Decompression failure is recorded as an empty
        /// `Vec`, which `source_file_contents` treats as "no contents".
        pub decompressed_files: Box<[Option<Vec<u8>>]>,
    }

    impl Loaded {
        pub fn source_file_contents(&mut self, index: usize) -> Option<&[u8]> {
            if let Some(decompressed) = &self.decompressed_files[index] {
                return if decompressed.is_empty() {
                    None
                } else {
                    Some(decompressed)
                };
            }

            let compressed_codes = self.map.compressed_source_files();
            let compressed_file = compressed_codes[index].slice(self.map.bytes);
            let size = bun_zstd::get_decompressed_size(compressed_file);

            let mut bytes = vec![0u8; size];
            match bun_zstd::decompress(&mut bytes, compressed_file) {
                bun_zstd::Result::Err(err) => {
                    bun_core::Output::warn(format_args!(
                        "Source map decompression error: {}",
                        ::bstr::BStr::new(err.as_bytes())
                    ));
                    self.decompressed_files[index] = Some(Vec::new());
                    None
                }
                bun_zstd::Result::Success(n) => {
                    bytes.truncate(n);
                    self.decompressed_files[index] = Some(bytes);
                    self.decompressed_files[index].as_deref()
                }
            }
        }
    }
}

bun_core::declare_scope!(SourceMap, visible);

/// Coordinates in source maps are stored using relative offsets for size
/// reasons. When joining together chunks of a source map that were emitted
/// in parallel for different parts of a file, we need to fix up the first
/// segment of each chunk to be relative to the end of the previous chunk.
#[derive(Default, Clone, Copy)]
pub struct SourceMapState {
    /// This isn't stored in the source map. It's only used by the bundler to join
    /// source map chunks together correctly.
    pub generated_line: i32,

    /// These are stored in the source map in VLQ format.
    pub generated_column: i32,
    pub source_index: i32,
    pub original_line: i32,
    pub original_column: i32,
}

/// Top-level `SourceMap` struct (was `@This()` in Zig).
pub struct SourceMap {
    pub sources: Vec<Box<[u8]>>,
    pub sources_content: Vec<Box<[u8]>>,
    pub mapping: mapping::List,
    // allocator: dropped — global mimalloc
}

/// Dictates what parse_url/parse_json return.
#[derive(Clone, Copy)]
pub enum ParseUrlResultHint {
    MappingsOnly,
    /// Source Index to fetch
    SourceOnly(u32),
    /// In order to fetch source contents, you need to know the
    /// index, but you cant know the index until the mappings
    /// are loaded. So pass in line+col.
    All {
        line: i32,
        column: i32,
        include_names: bool,
    },
}

#[derive(Default)]
pub struct ParseUrl {
    /// Populated when `mappings_only` or `all`.
    pub map: Option<Arc<ParsedSourceMap>>,
    /// Populated when `all`
    /// May be `None` even when requested.
    pub mapping: Option<Mapping>,
    /// Populated when `source_only` or `all`
    /// May be `None` even when requested, if did not exist in map.
    pub source_contents: Option<Box<[u8]>>,
}

/// Parses an inline source map url like `data:application/json,....`
/// Currently does not handle non-inline source maps.
///
/// `source` must be in UTF-8 and can be freed after this call.
/// The mappings are owned by the global allocator.
/// Temporary allocations are made to the `arena` allocator, which
/// should be an arena allocator (caller is assumed to call `reset`).
pub fn parse_url(
    arena: &Arena,
    source: &[u8],
    hint: ParseUrlResultHint,
) -> Result<ParseUrl, bun_core::Error> {
    // TODO(port): narrow error set
    let json_bytes: &[u8] = 'json_bytes: {
        const DATA_PREFIX: &[u8] = b"data:application/json";

        'try_data_url: {
            if source.starts_with(DATA_PREFIX) && source.len() > DATA_PREFIX.len() + 1 {
                bun_core::scoped_log!(SourceMap, "parse (data url, {} bytes)", source.len());
                match source[DATA_PREFIX.len()] {
                    b';' => {
                        let after = &source[DATA_PREFIX.len() + 1..];
                        let encoding =
                            &after[..after.iter().position(|&b| b == b',').unwrap_or(after.len())];
                        if encoding != b"base64" {
                            break 'try_data_url;
                        }
                        let base64_data = &source[DATA_PREFIX.len() + b";base64,".len()..];

                        let len = bun_core::base64::decode_len(base64_data);
                        let bytes = arena.alloc_slice_fill_default::<u8>(len);
                        let decoded = bun_core::base64::decode(bytes, base64_data);
                        if !decoded.is_successful() {
                            return Err(bun_core::err!("InvalidBase64"));
                        }
                        break 'json_bytes &bytes[..decoded.count];
                    }
                    b',' => break 'json_bytes &source[DATA_PREFIX.len() + 1..],
                    _ => break 'try_data_url,
                }
            }
        }

        return Err(bun_core::err!("UnsupportedFormat"));
    };

    parse_json(arena, json_bytes, hint)
}

/// Parses a JSON source-map
///
/// `source` must be in UTF-8 and can be freed after this call.
/// The mappings are owned by the global allocator.
/// Temporary allocations are made to the `arena` allocator, which
/// should be an arena allocator (caller is assumed to call `reset`).
pub fn parse_json(
    arena: &Arena,
    source: &[u8],
    hint: ParseUrlResultHint,
) -> Result<ParseUrl, bun_core::Error> {
    // TODO(port): narrow error set
    let json_src = logger::Source::init_path_string("sourcemap.json", source);
    let mut log = logger::Log::init();
    // `defer log.deinit()` → Drop

    // the allocator given to the JS parser is not respected for all parts
    // of the parse, so we need to remember to reset the ast store
    bun_js_parser::Expr::data_store_reset();
    bun_js_parser::Stmt::data_store_reset();
    let _store_reset = scopeguard::guard((), |_| {
        // the allocator given to the JS parser is not respected for all parts
        // of the parse, so we need to remember to reset the ast store
        bun_js_parser::Expr::data_store_reset();
        bun_js_parser::Stmt::data_store_reset();
    });
    bun_core::scoped_log!(SourceMap, "parse (JSON, {} bytes)", source.len());
    let json = match bun_interchange::json::parse(&json_src, &mut log, arena, false) {
        Ok(j) => j,
        Err(_) => return Err(bun_core::err!("InvalidJSON")),
    };

    if let Some(version) = json.get(b"version") {
        // TODO(port): Expr.data variant matching — exact API TBD in bun_js_parser
        if !version.data.is_e_number() || version.data.as_e_number().value != 3.0 {
            return Err(bun_core::err!("UnsupportedVersion"));
        }
    }

    let Some(mappings_str) = json.get(b"mappings") else {
        return Err(bun_core::err!("UnsupportedVersion"));
    };

    if !mappings_str.data.is_e_string() {
        return Err(bun_core::err!("InvalidSourceMap"));
    }

    let sources_content = match json
        .get(b"sourcesContent")
        .ok_or(bun_core::err!("InvalidSourceMap"))?
        .data
        .as_e_array()
    {
        Some(arr) => arr,
        None => return Err(bun_core::err!("InvalidSourceMap")),
    };

    let sources_paths = match json
        .get(b"sources")
        .ok_or(bun_core::err!("InvalidSourceMap"))?
        .data
        .as_e_array()
    {
        Some(arr) => arr,
        None => return Err(bun_core::err!("InvalidSourceMap")),
    };

    if sources_content.items.len() != sources_paths.items.len() {
        return Err(bun_core::err!("InvalidSourceMap"));
    }

    let source_only = matches!(hint, ParseUrlResultHint::SourceOnly(_));

    // PORT NOTE: reshaped for borrowck — Zig used a counted index `i` with
    // errdefer freeing the prefix; Rust `Vec<Box<[u8]>>` drops automatically.
    let source_paths_slice: Option<Vec<Box<[u8]>>> = if !source_only {
        let mut v: Vec<Box<[u8]>> = Vec::with_capacity(sources_content.items.len());
        for item in sources_paths.items.slice() {
            if !item.data.is_e_string() {
                return Err(bun_core::err!("InvalidSourceMap"));
            }
            // TODO(port): e_string.string(alloc) — exact API TBD
            let s = item.data.as_e_string().string(arena)?;
            v.push(Box::<[u8]>::from(s));
        }
        Some(v)
    } else {
        None
    };

    let map: Option<Arc<ParsedSourceMap>> = if !source_only {
        let mut map_data = match Mapping::parse(
            mappings_str.data.as_e_string().slice(arena),
            None,
            i32::MAX,
            i32::MAX,
            mapping::ParseOptions {
                allow_names: matches!(
                    hint,
                    ParseUrlResultHint::All { include_names: true, .. }
                ),
                sort: true,
            },
        ) {
            ParseResult::Success(x) => x,
            ParseResult::Fail(fail) => return Err(fail.err),
        };

        if let ParseUrlResultHint::All { include_names: true, .. } = hint {
            if map_data.mappings.impl_.is_with_names() {
                if let Some(names) = json.get(b"names") {
                    if let Some(arr) = names.data.as_e_array() {
                        let mut names_list: Vec<bun_semver::String> =
                            Vec::with_capacity(arr.items.len());
                        let mut names_buffer: Vec<u8> = Vec::new();

                        for item in arr.items.slice() {
                            if !item.data.is_e_string() {
                                return Err(bun_core::err!("InvalidSourceMap"));
                            }

                            let str = item.data.as_e_string().string(arena)?;

                            // PERF(port): was assume_capacity
                            names_list.push(bun_semver::String::init_append_if_needed(
                                &mut names_buffer,
                                str,
                            )?);
                        }

                        map_data.mappings.names = names_list.into_boxed_slice();
                        map_data.mappings.names_buffer =
                            bun_collections::BabyList::move_from_vec(&mut names_buffer);
                    }
                }
            }
        }

        let mut psm = map_data;
        psm.external_source_names = source_paths_slice.unwrap();
        // TODO(port): ParsedSourceMap is ThreadSafeRefCount in Zig; LIFETIMES.tsv
        // says Arc. Phase B: confirm whether intrusive Arc is required for FFI.
        Some(Arc::new(psm))
    } else {
        None
    };
    // errdefer if (map) |m| m.deref(); → Arc drops on `?`

    let (found_mapping, source_index): (Option<Mapping>, Option<u32>) = match hint {
        ParseUrlResultHint::SourceOnly(index) => (None, Some(index)),
        ParseUrlResultHint::All { line, column, .. } => 'brk: {
            let Some(m) = map
                .as_ref()
                .unwrap()
                .find_mapping(Ordinal::from_zero_based(line), Ordinal::from_zero_based(column))
            else {
                break 'brk (None, None);
            };
            let idx = u32::try_from(m.source_index).ok();
            (Some(m), idx)
        }
        ParseUrlResultHint::MappingsOnly => (None, None),
    };

    let content_slice: Option<Box<[u8]>> = if !matches!(hint, ParseUrlResultHint::MappingsOnly)
        && source_index.is_some()
        && (source_index.unwrap() as usize) < sources_content.items.len()
    {
        'content: {
            let item = &sources_content.items.slice()[source_index.unwrap() as usize];
            if !item.data.is_e_string() {
                break 'content None;
            }

            // bun.handleOom(...) → panic on OOM, do not propagate
            let str = item.data.as_e_string().string(arena).expect("OOM");
            if str.is_empty() {
                break 'content None;
            }

            Some(Box::<[u8]>::from(str))
        }
    } else {
        None
    };

    Ok(ParseUrl {
        map,
        mapping: found_mapping,
        source_contents: content_slice,
    })
}

pub enum ParseResult {
    Fail(ParseResultFail),
    Success(ParsedSourceMap),
}

pub struct ParseResultFail {
    pub loc: logger::Loc,
    pub err: bun_core::Error,
    pub value: i32,
    pub msg: &'static [u8],
}

impl Default for ParseResultFail {
    fn default() -> Self {
        Self {
            loc: logger::Loc::default(),
            err: bun_core::err!("Unknown"), // TODO(port): Zig has no default for `err`
            value: 0,
            msg: b"",
        }
    }
}

impl ParseResultFail {
    pub fn to_data(&self, path: &[u8]) -> logger::Data {
        logger::Data {
            location: Some(logger::Location {
                file: Box::<[u8]>::from(path),
                offset: self.loc.to_usize(),
                // TODO: populate correct line and column information
                line: -1,
                column: -1,
                ..Default::default()
            }),
            text: self.msg,
            ..Default::default()
        }
    }
}

/// For some sourcemap loading code, this enum is used as a hint if it should
/// bother loading source code into memory. Most uses of source maps only care
/// about filenames and source mappings, and we should avoid loading contents
/// whenever possible.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SourceContentHandling {
    NoSourceContents,
    SourceContents,
}

/// For some sourcemap loading code, this enum is used as a hint if we already
/// know if the sourcemap is located on disk or inline in the source code.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SourceMapLoadHint {
    None,
    IsInlineMap,
    IsExternalMap,
}

/// Always returns UTF-8.
// TODO(port): Zig was generic over `comptime T: type` (u8/u16). Rust cannot
// express `[]const T` literals generically without a helper trait; split into
// two functions and dispatch at the (only) callsite.
fn find_source_mapping_url_u8(source: &[u8]) -> Option<ZigString::Slice<'_>> {
    const NEEDLE: &[u8] = b"\n//# sourceMappingURL=";
    // TODO(port): std.mem.lastIndexOf — bun_str::strings has no last_index_of yet
    let found = last_index_of(source, NEEDLE)?;
    let start = found + NEEDLE.len();
    let end = source[start..]
        .iter()
        .position(|&b| b == b'\n')
        .map(|p| start + p)
        .unwrap_or(source.len());
    let url = strings::trim_right(&source[start..end], b" \r");
    Some(ZigString::Slice::from_utf8_never_free(url))
}

fn find_source_mapping_url_u16(source: &[u16]) -> Option<ZigString::Slice<'static>> {
    let needle: &[u16] = bun_str::w!("\n//# sourceMappingURL=");
    let found = last_index_of_u16(source, needle)?;
    let start = found + needle.len();
    let end = source[start..]
        .iter()
        .position(|&c| c == b'\n' as u16)
        .map(|p| start + p)
        .unwrap_or(source.len());
    let mut url = &source[start..end];
    while let Some(&last) = url.last() {
        if last == b' ' as u16 || last == b'\r' as u16 {
            url = &url[..url.len() - 1];
        } else {
            break;
        }
    }
    // TODO(port): ZigString::Slice::init takes ownership of allocated UTF-8
    Some(ZigString::Slice::init_owned(strings::to_utf8_alloc(url)))
}

// TODO(port): move to bun_str::strings (these mirror std.mem.lastIndexOf)
fn last_index_of(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    let mut i = haystack.len() - needle.len();
    loop {
        if &haystack[i..i + needle.len()] == needle {
            return Some(i);
        }
        if i == 0 {
            return None;
        }
        i -= 1;
    }
}
fn last_index_of_u16(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    let mut i = haystack.len() - needle.len();
    loop {
        if &haystack[i..i + needle.len()] == needle {
            return Some(i);
        }
        if i == 0 {
            return None;
        }
        i -= 1;
    }
}

/// Abstraction over `SourceProviderMap` / `DevServerSourceProvider` /
/// `BakeSourceProvider` — Zig used `comptime SourceProviderKind: type` plus
/// `@hasDecl` checks; in Rust this is a trait with default-`None` optional
/// methods.
pub trait SourceProvider {
    fn get_source_slice(&self) -> bun_str::String;
    fn to_source_content_ptr(&self) -> parsed_source_map::SourceContentPtr;

    /// Returns the dev-server source map JSON, if this provider is a
    /// `DevServerSourceProvider`. Default: `None`.
    fn get_source_map_json(&self) -> Option<&[u8]> {
        None
    }

    /// Returns external data (Bake production build), if available.
    /// Default: `None`.
    fn get_external_data(&self, _source_filename: &[u8]) -> Option<&[u8]> {
        None
    }

    /// Whether this provider is a DevServerSourceProvider. Mirrors the Zig
    /// `comptime SourceProviderKind == DevServerSourceProvider` check.
    const IS_DEV_SERVER: bool = false;
    /// Mirrors `@hasDecl(SourceProviderKind, "getExternalData")`.
    const HAS_EXTERNAL_DATA: bool = false;
}

/// The last two arguments to this specify loading hints
pub fn get_source_map_impl<P: SourceProvider + ?Sized>(
    provider: &P,
    source_filename: &[u8],
    load_hint: SourceMapLoadHint,
    result: ParseUrlResultHint,
) -> Option<ParseUrl> {
    // This was previously 65535 but that is a size that can risk stack overflow
    // and due to the many layers of indirections and wrappers this function is called in, it
    // is difficult to reason about how deeply nested of a callstack this
    // function is called in. 1024 is a safer number.
    //
    // TODO: Experiment in debug builds calculating how much stack space we have left and using that to
    //       adjust the size
    // PERF(port): was stack-fallback (1024) + ArenaAllocator
    let arena = Arena::new();

    let (new_load_hint, parsed): (SourceMapLoadHint, ParseUrl) = 'parsed: {
        let mut inline_err: Option<bun_core::Error> = None;

        // try to get an inline source map
        if load_hint != SourceMapLoadHint::IsExternalMap {
            'try_inline: {
                let source = provider.get_source_slice();
                // defer source.deref() → Drop on bun_str::String
                debug_assert!(source.tag() == bun_str::Tag::ZigString);

                let maybe_found_url = if source.is_8bit() {
                    find_source_mapping_url_u8(source.latin1())
                } else {
                    find_source_mapping_url_u16(source.utf16())
                };

                let Some(found_url) = maybe_found_url else {
                    break 'try_inline;
                };
                // defer found_url.deinit() → Drop

                match parse_url(&arena, found_url.slice(), result) {
                    Ok(parsed) => break 'parsed (SourceMapLoadHint::IsInlineMap, parsed),
                    Err(err) => {
                        inline_err = Some(err);
                        break 'try_inline;
                    }
                }
            }
        }

        // try to load a .map file
        if load_hint != SourceMapLoadHint::IsInlineMap {
            'try_external: {
                if P::IS_DEV_SERVER {
                    // For DevServerSourceProvider, get the source map JSON directly
                    let Some(json_slice) = provider.get_source_map_json() else {
                        break 'try_external;
                    };

                    // Parse the JSON source map
                    match parse_json(&arena, json_slice, result) {
                        Ok(parsed) => {
                            break 'parsed (SourceMapLoadHint::IsExternalMap, parsed);
                        }
                        Err(err) => {
                            // Print warning even if this came from non-visible code like
                            // calling `error.stack`. This message is only printed if
                            // the sourcemap has been found but is invalid, such as being
                            // invalid JSON text or corrupt mappings.
                            bun_core::Output::warn(format_args!(
                                "Could not decode sourcemap in dev server runtime: {} - {}",
                                ::bstr::BStr::new(source_filename),
                                err.name(),
                            ));
                            // Disable the "try using --sourcemap=external" hint
                            crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(
                                true,
                            );
                            return None;
                        }
                    }
                }

                if P::HAS_EXTERNAL_DATA {
                    'fallback_to_normal: {
                        // BakeSourceProvider: if we're under Bake's production build the
                        // global object is a Bake::GlobalObject and the sourcemap is on it.
                        let Some(data) = provider.get_external_data(source_filename) else {
                            break 'fallback_to_normal;
                        };
                        match parse_json(&arena, data, result) {
                            Ok(parsed) => {
                                break 'parsed (SourceMapLoadHint::IsExternalMap, parsed);
                            }
                            Err(err) => {
                                // Print warning even if this came from non-visible code like
                                // calling `error.stack`. This message is only printed if
                                // the sourcemap has been found but is invalid, such as being
                                // invalid JSON text or corrupt mappings.
                                bun_core::Output::warn(format_args!(
                                    "Could not decode sourcemap in '{}': {}",
                                    ::bstr::BStr::new(source_filename),
                                    err.name(),
                                ));
                                // Disable the "try using --sourcemap=external" hint
                                crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(
                                    true,
                                );
                                return None;
                            }
                        }
                    }
                }

                let mut load_path_buf = bun_paths::path_buffer_pool().get();
                if source_filename.len() + 4 > load_path_buf.len() {
                    break 'try_external;
                }
                load_path_buf[..source_filename.len()].copy_from_slice(source_filename);
                load_path_buf[source_filename.len()..source_filename.len() + 4]
                    .copy_from_slice(b".map");

                let load_path = &load_path_buf[..source_filename.len() + 4];
                // TODO(port): bun.sys.File.readFrom — arena-backed read; using arena alloc
                let data = match bun_sys::File::read_from(bun_sys::Fd::cwd(), load_path, &arena) {
                    bun_sys::Result::Ok(data) => data,
                    bun_sys::Result::Err(_) => break 'try_external,
                };

                match parse_json(&arena, data, result) {
                    Ok(parsed) => break 'parsed (SourceMapLoadHint::IsExternalMap, parsed),
                    Err(err) => {
                        // Print warning even if this came from non-visible code like
                        // calling `error.stack`. This message is only printed if
                        // the sourcemap has been found but is invalid, such as being
                        // invalid JSON text or corrupt mappings.
                        bun_core::Output::warn(format_args!(
                            "Could not decode sourcemap in '{}': {}",
                            ::bstr::BStr::new(source_filename),
                            err.name(),
                        ));
                        // Disable the "try using --sourcemap=external" hint
                        crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(true);
                        return None;
                    }
                }
            }
        }

        if let Some(err) = inline_err {
            bun_core::Output::warn(format_args!(
                "Could not decode sourcemap in '{}': {}",
                ::bstr::BStr::new(source_filename),
                err.name(),
            ));
            // Disable the "try using --sourcemap=external" hint
            crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(true);
            return None;
        }

        return None;
    };
    if let Some(ptr) = parsed.map.as_ref() {
        // TODO(port): Arc<ParsedSourceMap> is immutable; Zig mutates via *T after
        // bun.new(). Phase B: ParsedSourceMap likely needs interior mutability
        // for `underlying_provider`, or build the value fully before Arc::new.
        let ptr = Arc::as_ptr(ptr) as *mut ParsedSourceMap;
        // SAFETY: freshly created in parse_json, sole owner here
        unsafe {
            (*ptr).underlying_provider = provider.to_source_content_ptr();
            (*ptr).underlying_provider.load_hint = new_load_hint;
        }
    }
    Some(parsed)
}

/// This is a pointer to a ZigSourceProvider that may or may not have a `//# sourceMappingURL` comment
/// when we want to lookup this data, we will then resolve it to a ParsedSourceMap if it does.
///
/// This is used for files that were pre-bundled with `bun build --target=bun --sourcemap`
#[repr(C)]
pub struct SourceProviderMap {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn ZigSourceProvider__getSourceSlice(this: *mut SourceProviderMap) -> bun_str::String;
}

impl SourceProviderMap {
    pub fn get_source_slice(&self) -> bun_str::String {
        // SAFETY: opaque FFI handle; pointer is valid by construction
        unsafe { ZigSourceProvider__getSourceSlice(self as *const _ as *mut _) }
    }

    pub fn to_source_content_ptr(&self) -> parsed_source_map::SourceContentPtr {
        parsed_source_map::SourceContentPtr::from_provider(self)
    }

    /// The last two arguments to this specify loading hints
    pub fn get_source_map(
        &self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        get_source_map_impl(self, source_filename, load_hint, result)
    }
}

impl SourceProvider for SourceProviderMap {
    fn get_source_slice(&self) -> bun_str::String {
        SourceProviderMap::get_source_slice(self)
    }
    fn to_source_content_ptr(&self) -> parsed_source_map::SourceContentPtr {
        SourceProviderMap::to_source_content_ptr(self)
    }
}

// `pub const BakeSourceProvider = @import("../sourcemap_jsc/...")` — *_jsc alias, deleted.

#[repr(C)]
pub struct DevServerSourceProvider {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

#[repr(C)]
pub struct DevServerSourceMapData {
    pub ptr: *const u8,
    pub length: usize,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn DevServerSourceProvider__getSourceSlice(this: *mut DevServerSourceProvider)
        -> bun_str::String;
    fn DevServerSourceProvider__getSourceMapJSON(
        this: *mut DevServerSourceProvider,
    ) -> DevServerSourceMapData;
}

impl DevServerSourceProvider {
    pub fn get_source_slice(&self) -> bun_str::String {
        // SAFETY: opaque FFI handle
        unsafe { DevServerSourceProvider__getSourceSlice(self as *const _ as *mut _) }
    }
    pub fn get_source_map_json_raw(&self) -> DevServerSourceMapData {
        // SAFETY: opaque FFI handle
        unsafe { DevServerSourceProvider__getSourceMapJSON(self as *const _ as *mut _) }
    }

    pub fn to_source_content_ptr(&self) -> parsed_source_map::SourceContentPtr {
        parsed_source_map::SourceContentPtr::from_dev_server_provider(self)
    }

    /// The last two arguments to this specify loading hints
    pub fn get_source_map(
        &self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        get_source_map_impl(self, source_filename, load_hint, result)
    }
}

impl SourceProvider for DevServerSourceProvider {
    const IS_DEV_SERVER: bool = true;

    fn get_source_slice(&self) -> bun_str::String {
        DevServerSourceProvider::get_source_slice(self)
    }
    fn to_source_content_ptr(&self) -> parsed_source_map::SourceContentPtr {
        DevServerSourceProvider::to_source_content_ptr(self)
    }
    fn get_source_map_json(&self) -> Option<&[u8]> {
        let d = self.get_source_map_json_raw();
        if d.length == 0 {
            return None;
        }
        // SAFETY: ptr/length come from C++ and are valid for the call duration
        Some(unsafe { core::slice::from_raw_parts(d.ptr, d.length) })
    }
}

/// The sourcemap spec says line and column offsets are zero-based
#[derive(Clone, Copy, Default)]
pub struct LineColumnOffset {
    /// The zero-based line offset
    pub lines: Ordinal,
    /// The zero-based column offset
    pub columns: Ordinal,
}

#[derive(Clone, Copy)]
pub enum LineColumnOffsetOptional {
    Null,
    Value(LineColumnOffset),
}

impl LineColumnOffsetOptional {
    pub fn advance(&mut self, input: &[u8]) {
        match self {
            Self::Null => {}
            Self::Value(v) => v.advance(input),
        }
    }

    pub fn reset(&mut self) {
        match self {
            Self::Null => {}
            Self::Value(_) => *self = Self::Value(LineColumnOffset::default()),
        }
    }
}

impl LineColumnOffset {
    pub fn add(&mut self, b: LineColumnOffset) {
        if b.lines.zero_based() == 0 {
            self.columns = self.columns.add(b.columns);
        } else {
            self.lines = self.lines.add(b.lines);
            self.columns = b.columns;
        }
    }

    pub fn advance(this_ptr: &mut LineColumnOffset, input: &[u8]) {
        // Instead of mutating `this_ptr` directly, copy the state to the stack and do
        // all the work here, then move it back to the input pointer. When sourcemaps
        // are enabled, this function is extremely hot.
        let mut this = *this_ptr;

        let mut offset: u32 = 0;
        while let Some(i) = strings::index_of_newline_or_non_ascii(input, offset) {
            debug_assert!(i >= offset);
            debug_assert!((i as usize) < input.len());

            let mut iter = strings::CodepointIterator::init_offset(input, i as usize);
            let mut cursor = strings::CodepointIterator::Cursor {
                i: iter.i as u32,
                ..Default::default()
            };
            let _ = iter.next(&mut cursor);

            // Given a null byte, cursor.width becomes 0
            // This can lead to integer overflow, crashes, or hangs.
            // https://github.com/oven-sh/bun/issues/10624
            if cursor.width == 0 {
                this.columns = this.columns.add_scalar(1);
                offset = i + 1;
                continue;
            }

            offset = i + cursor.width as u32;

            match cursor.c {
                '\r' | '\n' | '\u{2028}' | '\u{2029}' => {
                    // Handle Windows-specific "\r\n" newlines
                    if cursor.c == '\r'
                        && input.len() > (i as usize) + 1
                        && input[(i as usize) + 1] == b'\n'
                    {
                        this.columns = this.columns.add_scalar(1);
                        continue;
                    }

                    this.lines = this.lines.add_scalar(1);
                    this.columns = Ordinal::START;
                }
                c => {
                    // Mozilla's "source-map" library counts columns using UTF-16 code units
                    this.columns = this.columns.add_scalar(match c as u32 {
                        0..=0xFFFF => 1,
                        _ => 2,
                    });
                }
            }
        }

        let remain = &input[offset as usize..];

        if cfg!(debug_assertions) {
            debug_assert!(strings::is_all_ascii(remain));
            debug_assert!(strings::index_of_char(remain, b'\n').is_none());
            debug_assert!(strings::index_of_char(remain, b'\r').is_none());
        }

        this.columns = this
            .columns
            .add_scalar(i32::try_from(remain.len()).unwrap());

        *this_ptr = this;
    }

    pub fn comes_before(a: LineColumnOffset, b: LineColumnOffset) -> bool {
        a.lines.zero_based() < b.lines.zero_based()
            || (a.lines.zero_based() == b.lines.zero_based()
                && a.columns.zero_based() < b.columns.zero_based())
    }

    pub fn cmp(_ctx: (), a: LineColumnOffset, b: LineColumnOffset) -> Ordering {
        if a.lines.zero_based() != b.lines.zero_based() {
            return a.lines.zero_based().cmp(&b.lines.zero_based());
        }
        a.columns.zero_based().cmp(&b.columns.zero_based())
    }
}

#[derive(Default)]
pub struct SourceContent {
    pub value: Box<[u16]>,
    pub quoted: Box<[u8]>,
}

impl SourceMap {
    pub fn find(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        self.mapping.find(line, column)
    }
}

#[derive(Clone, Copy)]
pub struct SourceMapShifts {
    pub before: LineColumnOffset,
    pub after: LineColumnOffset,
}

pub struct SourceMapPieces {
    pub prefix: Vec<u8>,
    pub mappings: Vec<u8>,
    pub suffix: Vec<u8>,
}

impl SourceMapPieces {
    pub fn init() -> SourceMapPieces {
        SourceMapPieces {
            prefix: Vec::new(),
            mappings: Vec::new(),
            suffix: Vec::new(),
        }
    }

    pub fn has_content(&self) -> bool {
        (self.prefix.len() + self.mappings.len() + self.suffix.len()) > 0
    }

    pub fn finalize(
        &mut self,
        shifts_: &[SourceMapShifts],
    ) -> Result<Box<[u8]>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut shifts = shifts_;
        let mut start_of_run: usize = 0;
        let mut current: usize = 0;
        let mut generated = LineColumnOffset::default();
        let mut prev_shift_column_delta: i32 = 0;

        // the joiner's node allocator contains string join nodes as well as some vlq encodings
        // it doesnt contain json payloads or source code, so 16kb is probably going to cover
        // most applications.
        // PERF(port): was stack-fallback (16384)
        let mut j = StringJoiner::default();

        j.push_static(&self.prefix);
        let mappings = &self.mappings;

        while current < mappings.len() {
            if mappings[current] == b';' {
                generated.lines = generated.lines.add_scalar(1);
                generated.columns = Ordinal::START;
                prev_shift_column_delta = 0;
                current += 1;
                continue;
            }

            let potential_end_of_run = current;

            let decode_result = decode_vlq(mappings, current);
            generated.columns = generated.columns.add_scalar(decode_result.value);
            current = decode_result.start;

            let potential_start_of_run = current;

            current = decode_vlq_assume_valid(mappings, current).start;
            current = decode_vlq_assume_valid(mappings, current).start;
            current = decode_vlq_assume_valid(mappings, current).start;

            if current < mappings.len() {
                let c = mappings[current];
                if c != b',' && c != b';' {
                    current = decode_vlq_assume_valid(mappings, current).start;
                }
            }

            if current < mappings.len() && mappings[current] == b',' {
                current += 1;
            }

            let mut did_cross_boundary = false;
            if shifts.len() > 1 && LineColumnOffset::comes_before(shifts[1].before, generated) {
                shifts = &shifts[1..];
                did_cross_boundary = true;
            }

            if !did_cross_boundary {
                continue;
            }

            let shift = shifts[0];
            if shift.after.lines.zero_based() != generated.lines.zero_based() {
                continue;
            }

            j.push_static(&mappings[start_of_run..potential_end_of_run]);

            debug_assert!(shift.before.lines.zero_based() == shift.after.lines.zero_based());

            let shift_column_delta =
                shift.after.columns.zero_based() - shift.before.columns.zero_based();
            let vlq_value = decode_result.value + shift_column_delta - prev_shift_column_delta;
            let encode = VLQ::encode(vlq_value);
            j.push_cloned(encode.slice());
            prev_shift_column_delta = shift_column_delta;

            start_of_run = potential_start_of_run;
        }

        j.push_static(&mappings[start_of_run..]);

        let str = j.done_with_end(&self.suffix)?;
        debug_assert!(str[0] == b'{'); // invalid json
        Ok(str)
    }
}

// -- comment from esbuild --
// Source map chunks are computed in parallel for speed. Each chunk is relative
// to the zero state instead of being relative to the end state of the previous
// chunk, since it's impossible to know the end state of the previous chunk in
// a parallel computation.
//
// After all chunks are computed, they are joined together in a second pass.
// This rewrites the first mapping in each chunk to be relative to the end
// state of the previous chunk.
pub fn append_source_map_chunk(
    j: &mut StringJoiner,
    prev_end_state_: SourceMapState,
    start_state_: SourceMapState,
    source_map_: &[u8],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut prev_end_state = prev_end_state_;
    let mut start_state = start_state_;
    // Handle line breaks in between this mapping and the previous one
    if start_state.generated_line != 0 {
        j.push_owned(strings::repeating_alloc(
            usize::try_from(start_state.generated_line).unwrap(),
            b';',
        ));
        prev_end_state.generated_column = 0;
    }

    // Skip past any leading semicolons, which indicate line breaks
    let mut source_map = source_map_;
    if let Some(semicolons) = strings::index_of_not_char(source_map, b';') {
        if semicolons > 0 {
            j.push_static(&source_map[..semicolons]);
            source_map = &source_map[semicolons..];
            prev_end_state.generated_column = 0;
            start_state.generated_column = 0;
        }
    }

    // Strip off the first mapping from the buffer. The first mapping should be
    // for the start of the original file (the printer always generates one for
    // the start of the file).
    let mut i: usize = 0;
    let generated_column = decode_vlq_assume_valid(source_map, i);
    i = generated_column.start;
    let source_index = decode_vlq_assume_valid(source_map, i);
    i = source_index.start;
    let original_line = decode_vlq_assume_valid(source_map, i);
    i = original_line.start;
    let original_column = decode_vlq_assume_valid(source_map, i);
    i = original_column.start;

    source_map = &source_map[i..];

    // Rewrite the first mapping to be relative to the end state of the previous
    // chunk. We now know what the end state is because we're in the second pass
    // where all chunks have already been generated.
    start_state.source_index += source_index.value;
    start_state.generated_column += generated_column.value;
    start_state.original_line += original_line.value;
    start_state.original_column += original_column.value;

    let mut str = MutableString::init_empty();
    append_mapping_to_buffer(&mut str, j.last_byte(), prev_end_state, start_state);
    j.push_owned(str.into_slice());

    // Then append everything after that without modification.
    j.push_static(source_map);
    Ok(())
}

pub fn append_source_mapping_url_remote<W: bun_io::Write>(
    origin: &bun_core::Url, // TODO(port): bun.URL crate location unconfirmed
    source: &logger::Source,
    asset_prefix_path: &[u8],
    writer: &mut W,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    writer.write_all(b"\n//# sourceMappingURL=")?;
    writer.write_all(strings::without_trailing_slash(origin.href()))?;
    if !asset_prefix_path.is_empty() {
        writer.write_all(asset_prefix_path)?;
    }
    if !source.path.pretty.is_empty() && source.path.pretty[0] != b'/' {
        writer.write_all(b"/")?;
    }
    writer.write_all(&source.path.pretty)?;
    writer.write_all(b".map")?;
    Ok(())
}

/// This function is extremely hot.
pub fn append_mapping_to_buffer(
    buffer: &mut MutableString,
    last_byte: u8,
    prev_state: SourceMapState,
    current_state: SourceMapState,
) {
    let needs_comma = last_byte != 0 && last_byte != b';' && last_byte != b'"';

    let vlqs: [VLQ; 4] = [
        // Record the generated column (the line is recorded using ';' elsewhere)
        VLQ::encode(current_state.generated_column.saturating_sub(prev_state.generated_column)),
        // Record the generated source
        VLQ::encode(current_state.source_index.saturating_sub(prev_state.source_index)),
        // Record the original line
        VLQ::encode(current_state.original_line.saturating_sub(prev_state.original_line)),
        // Record the original column
        VLQ::encode(current_state.original_column.saturating_sub(prev_state.original_column)),
    ];

    // Count exactly how many bytes we need to write
    let total_len = vlqs[0].len as usize
        + vlqs[1].len as usize
        + vlqs[2].len as usize
        + vlqs[3].len as usize;

    // Instead of updating .len 5 times, we only need to update it once.
    let mut writable = buffer
        .writable_n_bytes(total_len + needs_comma as usize)
        .expect("unreachable");

    // Put commas in between mappings
    if needs_comma {
        writable[0] = b',';
        writable = &mut writable[1..];
    }

    // PERF(port): was `inline for` — plain loop relies on LLVM unroll
    for item in &vlqs {
        let n = item.len as usize;
        writable[..n].copy_from_slice(item.slice());
        writable = &mut writable[n..];
    }
}

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
/// https://github.com/getsentry/rfcs/blob/main/text/0081-sourcemap-debugid.md#the-debugid-format
#[derive(Default, Clone, Copy)]
pub struct DebugIDFormatter {
    pub id: u64,
}

impl fmt::Display for DebugIDFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The RFC asks for a UUID, which is 128 bits (32 hex chars). Our hashes are only 64 bits.
        // We fill the end of the id with "bun!bun!" hex encoded
        let mut buf = [0u8; 32];
        // TODO(port): bun.fmt.hexIntUpper — using core formatting; verify zero-pad width matches
        use std::io::Write as _;
        write!(&mut &mut buf[..], "{:016X}64756E2164756E21", self.id).expect("unreachable");
        // SAFETY: hex digits + ASCII literal are valid UTF-8
        f.write_str(unsafe { core::str::from_utf8_unchecked(&buf) })
    }
}

// `pub const coverage = @import("../sourcemap_jsc/CodeCoverage.zig");` — *_jsc alias, deleted.
// `pub const JSSourceMap = @import("../sourcemap_jsc/JSSourceMap.zig");` — *_jsc alias, deleted.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sourcemap/sourcemap.zig (931 lines)
//   confidence: medium
//   todos:      23
//   notes:      Arc<ParsedSourceMap> mutated post-construction (unsafe cast); SourceProvider trait replaces comptime type dispatch; SavedSourceMap moved down to this crate (b0); Expr.data variant accessors guessed
// ──────────────────────────────────────────────────────────────────────────
