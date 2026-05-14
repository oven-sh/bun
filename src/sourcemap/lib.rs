#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
//! `bun_sourcemap` — B-2 un-gated.
//!
//! All sibling modules (`Chunk.rs`, `InternalSourceMap.rs`, `LineOffsetTable.rs`,
//! `Mapping.rs`, `ParsedSourceMap.rs`, `VLQ.rs`) compile with no ``
//! gates. `SerializedSourceMap`, `SourceMapPieces::finalize`,
//! `append_source_mapping_url_remote`, `Chunk::print_source_map_contents*`,
//! `ParsedSourceMap::write_vlqs`/`format_vlqs`, and `VLQ::write_to` are live.
//! `get_source_map_impl`, `find_source_mapping_url_{u8,u16}`, `parse_json`,
//! and the `SourceProvider` impls for `SourceProviderMap` /
//! `DevServerSourceProvider` are now live.

// ── crate aliases ─────────────────────────────────────────────────────────
// TODO(b1): Phase-A draft used `bun_str`; the workspace crate is `bun_string`.
#![warn(unreachable_pub)]
extern crate bun_core as bun_str;
use bun_collections::VecExt;

// ── B-2 un-gated sibling modules ──────────────────────────────────────────
#[path = "Chunk.rs"]
pub mod chunk;
#[path = "InternalSourceMap.rs"]
pub mod internal_source_map;
#[path = "LineOffsetTable.rs"]
pub mod line_offset_table;
#[path = "Mapping.rs"]
pub mod mapping;
#[path = "ParsedSourceMap.rs"]
pub mod parsed_source_map;

pub use bun_base64::vlq;
pub use vlq::{VLQ, encode as encode_vlq};
use vlq::{decode as decode_vlq, decode_assume_valid as decode_vlq_assume_valid};

pub use line_offset_table::{LineOffsetTable, LineOffsetTableColumns};
pub use mapping::{Lookup as MappingLookup, Mapping};
pub use parsed_source_map::{ParsedSourceMap, SourceContentPtr};

// `bun.Ordinal = OrdinalT(c_int)` lives in bun_core (lower tier). Re-export so
// `bun_sourcemap::Ordinal` and `bun_core::Ordinal` are the same type — callers
// in higher tiers (bun_jsc) pass values straight through without conversion.
pub use bun_core::Ordinal;

pub use chunk::Chunk;
pub use internal_source_map::InternalSourceMap;

/// Opaque FFI handle. The real type lives in `bun_jsc` (tier 6); this crate
/// only ever sees it as a pointer.
bun_opaque::opaque_ffi! { pub struct BakeSourceProvider; }

// TODO(port): move to <area>_sys
unsafe extern "C" {
    // C++ accessor is read-only (`provider->source()`). Taking `*const` avoids
    // casting away const from the `&self` borrow below; any interior mutation
    // lives behind the FFI boundary in C++-owned storage that Rust has no
    // provenance over (this type is an opaque ZST marker).
    fn BakeSourceProvider__getSourceSlice(this: *const BakeSourceProvider) -> bun_core::String;
}

unsafe extern "Rust" {
    /// Link-time-resolved by `bun_runtime::jsc_hooks` (same pattern as
    /// `__BUN_RUNTIME_HOOKS`). Spec sourcemap_jsc/source_provider.zig:20
    /// `BakeSourceProvider.getExternalData` — looks up the bundled `.map`
    /// JSON for `source_filename` via the live `Bake::GlobalObject`'s
    /// `PerThread.source_maps`. Returns `None` if not running under Bake
    /// (caller falls back to disk read), or `Some("")` if the table has no
    /// entry. The slice borrows `PerThread.bundled_outputs` (lives for the
    /// bake build session, which outlives any error-stack source-map
    /// resolution). Zig had no crate split here.
    static __BUN_BAKE_EXTERNAL_SOURCEMAP: fn(source_filename: &[u8]) -> Option<*const [u8]>;
}

impl BakeSourceProvider {
    #[inline]
    pub fn get_source_slice(&self) -> bun_core::String {
        // SAFETY: opaque FFI handle; address-only pass-through, callee does not
        // write Rust-visible memory.
        unsafe { BakeSourceProvider__getSourceSlice(self) }
    }

    pub fn to_source_content_ptr(&self) -> SourceContentPtr {
        // SAFETY: opaque ZST handle — `UnsafeCell<[u8; 0]>` at offset 0 grants
        // interior-mutability provenance, so deriving `*mut Self` from `&self`
        // is sound. C++ owns the real storage; the `*mut` exists only to match
        // `SourceContentPtr::from_bake_provider`'s signature (stores it as a
        // raw address in a packed u60).
        SourceContentPtr::from_bake_provider(self._p.get().cast::<Self>())
    }

    /// Returns the pre-bundled sourcemap JSON for `source_filename` if the
    /// current global is a `Bake::GlobalObject`; `None` otherwise (caller falls
    /// back to reading `<source>.map` from disk).
    pub fn get_external_data(&self, source_filename: &[u8]) -> Option<&[u8]> {
        // SAFETY: link-time-resolved `&'static` Rust-ABI static; the returned
        // slice borrows `PerThread.bundled_outputs`, which outlives this
        // `BakeSourceProvider` (the provider is created from a
        // `bundled_outputs` entry), so reborrowing as `&'self [u8]` is sound.
        let slice = unsafe { __BUN_BAKE_EXTERNAL_SOURCEMAP }(source_filename)?;
        // SAFETY: per the hook contract above.
        Some(unsafe { &*slice })
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

// PORT NOTE: Zig dispatched via `comptime SourceProviderKind: type` + `@hasDecl`;
// Rust uses a trait per PORTING.md §Dispatch.
impl SourceProvider for BakeSourceProvider {
    const HAS_EXTERNAL_DATA: bool = true;

    fn get_source_slice(&self) -> bun_core::String {
        Self::get_source_slice(self)
    }
    fn to_source_content_ptr(&self) -> SourceContentPtr {
        Self::to_source_content_ptr(self)
    }
    fn get_external_data(&self, source_filename: &[u8]) -> Option<&[u8]> {
        Self::get_external_data(self, source_filename)
    }
}

// ── leaf types that compile cleanly today ─────────────────────────────────

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
#[derive(Default)]
pub struct SourceMap {
    pub sources: Vec<Box<[u8]>>,
    pub sources_content: Vec<Box<[u8]>>,
    pub mapping: mapping::List,
}

impl SourceMap {
    pub fn find(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        self.mapping.find(line, column)
    }
}

/// For some sourcemap loading code, this enum is used as a hint if it should
/// bother loading source code into memory.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SourceContentHandling {
    NoSourceContents,
    SourceContents,
}

/// For some sourcemap loading code, this enum is used as a hint if we already
/// know if the sourcemap is located on disk or inline in the source code.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum SourceMapLoadHint {
    #[default]
    None,
    IsInlineMap,
    IsExternalMap,
}

/// Dictates what parse_url/parse_json return.
#[derive(Clone, Copy)]
pub enum ParseUrlResultHint {
    MappingsOnly,
    SourceOnly(u32),
    All {
        line: i32,
        column: i32,
        include_names: bool,
    },
}

#[derive(Default)]
pub struct ParseUrl {
    pub map: Option<std::sync::Arc<ParsedSourceMap>>,
    pub mapping: Option<Mapping>,
    pub source_contents: Option<Box<[u8]>>,
}

pub enum ParseResult {
    Fail(ParseResultFail),
    Success(ParsedSourceMap),
}

pub struct ParseResultFail {
    pub loc: bun_ast::Loc,
    pub err: bun_core::Error,
    pub value: i32,
    pub msg: &'static [u8],
}

impl Default for ParseResultFail {
    fn default() -> Self {
        Self {
            loc: bun_ast::Loc::default(),
            err: bun_core::err!("Unknown"), // TODO(port): Zig has no default for `err`
            value: 0,
            msg: b"",
        }
    }
}

#[derive(Default)]
pub struct SourceContent {
    pub value: Box<[u16]>,
    pub quoted: Box<[u8]>,
}

/// The sourcemap spec says line and column offsets are zero-based.
#[derive(Clone, Copy)]
pub struct LineColumnOffset {
    /// The zero-based line offset
    pub lines: Ordinal,
    /// The zero-based column offset
    pub columns: Ordinal,
}

// Spec sourcemap.zig:548 — Zig field defaults are `.start`, not `.invalid`
// (bun_core::Ordinal::default() is INVALID, so derive(Default) would be wrong).
impl Default for LineColumnOffset {
    #[inline]
    fn default() -> Self {
        Self {
            lines: Ordinal::START,
            columns: Ordinal::START,
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

    pub fn comes_before(a: LineColumnOffset, b: LineColumnOffset) -> bool {
        a.lines.zero_based() < b.lines.zero_based()
            || (a.lines.zero_based() == b.lines.zero_based()
                && a.columns.zero_based() < b.columns.zero_based())
    }

    pub fn cmp(_ctx: (), a: LineColumnOffset, b: LineColumnOffset) -> core::cmp::Ordering {
        if a.lines.zero_based() != b.lines.zero_based() {
            return a.lines.zero_based().cmp(&b.lines.zero_based());
        }
        a.columns.zero_based().cmp(&b.columns.zero_based())
    }

    pub fn advance(&mut self, input: &[u8]) {
        let this_ptr = self;
        use bun_core::strings;
        // Instead of mutating `this_ptr` directly, copy the state to the stack and do
        // all the work here, then move it back to the input pointer. When sourcemaps
        // are enabled, this function is extremely hot.
        let mut this = *this_ptr;

        let mut offset: u32 = 0;
        while let Some(i) = strings::index_of_newline_or_non_ascii(input, offset) {
            debug_assert!(i >= offset);
            debug_assert!((i as usize) < input.len());

            let iter = strings::CodepointIterator::init_offset(input, i as usize);
            let mut cursor = strings::Cursor {
                i,
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
                // '\r' | '\n' | U+2028 | U+2029
                0x0D | 0x0A | 0x2028 | 0x2029 => {
                    // Handle Windows-specific "\r\n" newlines
                    if cursor.c == 0x0D
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
                    this.columns = this.columns.add_scalar(if c > 0xFFFF { 2 } else { 1 });
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
            .add_scalar(i32::try_from(remain.len()).expect("int cast"));

        *this_ptr = this;
    }
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

#[derive(Clone, Copy)]
pub enum LineColumnOffsetOptional {
    Null,
    Value(LineColumnOffset),
}

#[derive(Clone, Copy)]
pub struct SourceMapShifts {
    pub before: LineColumnOffset,
    pub after: LineColumnOffset,
}

#[derive(Default)]
pub struct SourceMapPieces {
    pub prefix: Vec<u8>,
    pub mappings: Vec<u8>,
    pub suffix: Vec<u8>,
}

/// This function is extremely hot.
pub fn append_mapping_to_buffer(
    buffer: &mut bun_core::MutableString,
    last_byte: u8,
    prev_state: SourceMapState,
    current_state: SourceMapState,
) {
    let needs_comma = last_byte != 0 && last_byte != b';' && last_byte != b'"';

    let vlqs: [VLQ; 4] = [
        // Record the generated column (the line is recorded using ';' elsewhere)
        VLQ::encode(
            current_state
                .generated_column
                .saturating_sub(prev_state.generated_column),
        ),
        // Record the generated source
        VLQ::encode(
            current_state
                .source_index
                .saturating_sub(prev_state.source_index),
        ),
        // Record the original line
        VLQ::encode(
            current_state
                .original_line
                .saturating_sub(prev_state.original_line),
        ),
        // Record the original column
        VLQ::encode(
            current_state
                .original_column
                .saturating_sub(prev_state.original_column),
        ),
    ];

    // Count exactly how many bytes we need to write
    let total_len =
        vlqs[0].len as usize + vlqs[1].len as usize + vlqs[2].len as usize + vlqs[3].len as usize;

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

/// https://github.com/getsentry/rfcs/blob/main/text/0081-sourcemap-debugid.md
#[derive(Default, Clone, Copy)]
pub struct DebugIDFormatter {
    pub id: u64,
}

impl core::fmt::Display for DebugIDFormatter {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // The RFC asks for a UUID (128 bits / 32 hex chars). Our hashes are 64
        // bits; the tail is "bun!bun!" hex-encoded.
        write!(f, "{:016X}64756E2164756E21", self.id)
    }
}

/// This is a pointer to a ZigSourceProvider that may or may not have a `//# sourceMappingURL` comment
/// when we want to lookup this data, we will then resolve it to a ParsedSourceMap if it does.
///
/// This is used for files that were pre-bundled with `bun build --target=bun --sourcemap`
bun_opaque::opaque_ffi! { pub struct SourceProviderMap; }

// TODO(port): move to <area>_sys
unsafe extern "C" {
    // `SourceProviderMap` is an UnsafeCell-backed opaque ZST (Rust holds zero
    // bytes of it), so `&SourceProviderMap` carries no `readonly`/`noalias` —
    // the foreign side owns all state behind the handle and may mutate it. The
    // only param is that handle reference, so this is a `safe fn`.
    safe fn ZigSourceProvider__getSourceSlice(this: &SourceProviderMap) -> bun_core::String;
}

impl SourceProviderMap {
    pub fn get_source_slice(&self) -> bun_core::String {
        ZigSourceProvider__getSourceSlice(self)
    }

    pub fn to_source_content_ptr(&self) -> SourceContentPtr {
        SourceContentPtr::from_provider(self)
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
    fn get_source_slice(&self) -> bun_core::String {
        SourceProviderMap::get_source_slice(self)
    }
    fn to_source_content_ptr(&self) -> SourceContentPtr {
        SourceProviderMap::to_source_content_ptr(self)
    }
}

bun_opaque::opaque_ffi! { pub struct DevServerSourceProvider; }

#[repr(C)]
pub struct DevServerSourceMapData {
    pub ptr: *const u8,
    pub length: usize,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    // Both C++ accessors are read-only (`provider->source()` /
    // `provider->sourceMapJSON()`). Taking `*const` avoids casting away
    // const from the `&self` borrow below; any interior mutation lives behind
    // the FFI boundary in C++-owned storage that Rust has no provenance over
    // (this type is an opaque ZST marker).
    fn DevServerSourceProvider__getSourceSlice(
        this: *const DevServerSourceProvider,
    ) -> bun_core::String;
    fn DevServerSourceProvider__getSourceMapJSON(
        this: *const DevServerSourceProvider,
    ) -> DevServerSourceMapData;
}

impl DevServerSourceProvider {
    pub fn get_source_slice(&self) -> bun_core::String {
        // SAFETY: opaque FFI handle; address-only pass-through, callee does not
        // write Rust-visible memory.
        unsafe { DevServerSourceProvider__getSourceSlice(self) }
    }
    pub fn get_source_map_json_raw(&self) -> DevServerSourceMapData {
        // SAFETY: opaque FFI handle; address-only pass-through, callee does not
        // write Rust-visible memory.
        unsafe { DevServerSourceProvider__getSourceMapJSON(self) }
    }

    pub fn to_source_content_ptr(&self) -> SourceContentPtr {
        SourceContentPtr::from_dev_server_provider(self)
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

    fn get_source_slice(&self) -> bun_core::String {
        DevServerSourceProvider::get_source_slice(self)
    }
    fn to_source_content_ptr(&self) -> SourceContentPtr {
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

// ── SourceProvider trait + get_source_map_impl ─────────────────────────────

/// Abstraction over `SourceProviderMap` / `DevServerSourceProvider` /
/// `BakeSourceProvider` — Zig used `comptime SourceProviderKind: type` plus
/// `@hasDecl` checks; in Rust this is a trait with default-`None` optional
/// methods so each provider only overrides what it actually has.
pub trait SourceProvider {
    fn get_source_slice(&self) -> bun_core::String;
    fn to_source_content_ptr(&self) -> SourceContentPtr;

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

    /// Mirrors Zig `comptime SourceProviderKind == DevServerSourceProvider`.
    const IS_DEV_SERVER: bool = false;
    /// Mirrors `@hasDecl(SourceProviderKind, "getExternalData")`.
    const HAS_EXTERNAL_DATA: bool = false;
}

/// The last two arguments to this specify loading hints.
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
    let arena = bun_alloc::Arena::new();

    let (new_load_hint, mut parsed): (SourceMapLoadHint, ParseUrl) = 'parsed: {
        let mut inline_err: Option<bun_core::Error> = None;

        // try to get an inline source map
        if load_hint != SourceMapLoadHint::IsExternalMap {
            'try_inline: {
                let source = provider.get_source_slice();
                // defer source.deref() → Drop on bun_core::String
                debug_assert!(source.tag() == bun_core::Tag::ZigString);

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
                            bun_core::Output::warn(&format_args!(
                                "Could not decode sourcemap in dev server runtime: {} - {}",
                                ::bstr::BStr::new(source_filename),
                                ::bstr::BStr::new(err.name()),
                            ));
                            // Disable the "try using --sourcemap=external" hint
                            crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(true);
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
                                bun_core::Output::warn(&format_args!(
                                    "Could not decode sourcemap in '{}': {}",
                                    ::bstr::BStr::new(source_filename),
                                    ::bstr::BStr::new(err.name()),
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

                let mut load_path_buf = bun_paths::path_buffer_pool::get();
                // Zig wrote `+ 4` but we also need a trailing NUL for the
                // `&ZStr` open path; reserve `+ 5`.
                if source_filename.len() + 5 > load_path_buf.len() {
                    break 'try_external;
                }
                load_path_buf[..source_filename.len()].copy_from_slice(source_filename);
                load_path_buf[source_filename.len()..source_filename.len() + 4]
                    .copy_from_slice(b".map");
                load_path_buf[source_filename.len() + 4] = 0;
                // SAFETY: byte at `len` was just set to NUL; buffer outlives `load_path`.
                let load_path =
                    bun_core::ZStr::from_buf(&load_path_buf[..], source_filename.len() + 4);

                // PORT NOTE: Zig passed the arena allocator; the Rust
                // `bun_sys::File::read_from` returns an owned `Vec<u8>`. The
                // arena was only used to free the bytes on scope exit, which
                // `Vec` Drop already does.
                let data = match bun_sys::File::read_from(bun_core::Fd::cwd(), load_path) {
                    Ok(data) => data,
                    Err(_) => break 'try_external,
                };

                match parse_json(&arena, &data, result) {
                    Ok(parsed) => break 'parsed (SourceMapLoadHint::IsExternalMap, parsed),
                    Err(err) => {
                        // Print warning even if this came from non-visible code like
                        // calling `error.stack`. This message is only printed if
                        // the sourcemap has been found but is invalid, such as being
                        // invalid JSON text or corrupt mappings.
                        bun_core::Output::warn(&format_args!(
                            "Could not decode sourcemap in '{}': {}",
                            ::bstr::BStr::new(source_filename),
                            ::bstr::BStr::new(err.name()),
                        ));
                        // Disable the "try using --sourcemap=external" hint
                        crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(true);
                        return None;
                    }
                }
            }
        }

        if let Some(err) = inline_err {
            bun_core::Output::warn(&format_args!(
                "Could not decode sourcemap in '{}': {}",
                ::bstr::BStr::new(source_filename),
                ::bstr::BStr::new(err.name()),
            ));
            // Disable the "try using --sourcemap=external" hint
            crate::SavedSourceMap::MissingSourceMapNoteInfo::set_seen_invalid(true);
            return None;
        }

        return None;
    };
    if let Some(ptr) = parsed.map.as_mut() {
        // PORT NOTE: Zig mutates `ptr.underlying_provider` after `bun.new`.
        // The Arc is freshly created in `parse_json` and we hold the only ref
        // here, so `Arc::get_mut` succeeds. (PORTING.md §Pointers — no raw
        // *mut cast through Arc::as_ptr.)
        if let Some(map) = std::sync::Arc::get_mut(ptr) {
            map.underlying_provider = provider.to_source_content_ptr();
            map.underlying_provider.set_load_hint(new_load_hint);
        } else {
            debug_assert!(false, "ParsedSourceMap Arc should be unique here");
        }
    }
    Some(parsed)
}

// ── SavedSourceMap leaf state (compiles today; see Phase-A note) ──────────
#[allow(non_snake_case)]
pub mod SavedSourceMap {
    pub mod MissingSourceMapNoteInfo {
        use core::sync::atomic::{AtomicBool, Ordering};

        static SEEN_INVALID: AtomicBool = AtomicBool::new(false);
        static PATH: bun_core::Mutex<Option<Box<[u8]>>> = bun_core::Mutex::new(None);

        #[inline]
        pub fn set_seen_invalid(v: bool) {
            SEEN_INVALID.store(v, Ordering::Relaxed);
        }
        #[inline]
        pub fn seen_invalid() -> bool {
            SEEN_INVALID.load(Ordering::Relaxed)
        }

        pub fn set_path(path: &[u8]) {
            *PATH.lock() = Some(path.to_vec().into_boxed_slice());
        }

        pub fn print() {
            if SEEN_INVALID.load(Ordering::Relaxed) {
                return;
            }
            if let Some(note) = PATH.lock().as_deref() {
                bun_core::Output::note(&format_args!(
                    "missing sourcemaps for {}",
                    ::bstr::BStr::new(note),
                ));
                bun_core::Output::note(
                    "consider bundling with '--sourcemap' to get unminified traces",
                );
            }
        }
    }
}

// ── SerializedSourceMap (lifted from the gated draft block (now dissolved)) ──────────────────────
//
// Source-map serialization for `bun build --compile` standalone executables.
// The bundler writes this blob; the runtime mmaps it and hands a
// `SerializedSourceMap::Loaded` to `ParsedSourceMap` for on-demand source
// retrieval. Moved down from `bun_standalone_graph` so `ParsedSourceMap` can
// name `Loaded` without an upward dep.
//
// Zig nests `Header` / `Loaded` inside the struct; Rust models that namespace
// as a module so `crate::SerializedSourceMap::Loaded` resolves as a path.
#[allow(non_snake_case)]
pub mod SerializedSourceMap {
    use bun_core::StringPointer;
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
            if start > self.bytes.len() || head.map_bytes_length as usize > self.bytes.len() - start
            {
                return None;
            }
            Some(&self.bytes[start..][..head.map_bytes_length as usize])
        }

        /// Zig returns `[]align(1) const StringPointer` (StandaloneModuleGraph.zig)
        /// because the blob sits at an arbitrary offset in the executable. Rust
        /// cannot soundly form a `&[StringPointer]` here — that would require
        /// 4-byte alignment regardless of target. Return raw `(ptr, count)` and
        /// read each element via `ptr.add(i).read_unaligned()`.
        pub fn source_file_names(self) -> (*const StringPointer, usize) {
            let head = self.header();
            let ptr = self.bytes[size_of::<Header>()..]
                .as_ptr()
                .cast::<StringPointer>();
            (ptr, head.source_files_count as usize)
        }

        fn compressed_source_files(self) -> (*const StringPointer, usize) {
            let head = self.header();
            let count = head.source_files_count as usize;
            // SAFETY: second contiguous `StringPointer` array immediately
            // follows the first (see `Header` layout doc); the offset stays
            // within `bytes`. Same align(1) caveat as `source_file_names`.
            let ptr = unsafe {
                self.bytes[size_of::<Header>()..]
                    .as_ptr()
                    .cast::<StringPointer>()
                    .add(count)
            };
            (ptr, count)
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
            // PORT NOTE: reshaped for borrowck — Zig checked the cache, then
            // wrote and re-read in the same scope. Here we populate first if
            // empty, then take a single borrow at the end.
            if self.decompressed_files[index].is_none() {
                let (compressed_codes, _count) = self.map.compressed_source_files();
                // SAFETY: `index < source_files_count` is upheld by caller;
                // pointer is into the mmapped `'static` blob. Read unaligned
                // per Zig's `[]align(1) const StringPointer`.
                let sp = unsafe { compressed_codes.add(index).read_unaligned() };
                let compressed_file = sp.slice(self.map.bytes);
                let size = bun_zstd::get_decompressed_size(compressed_file);

                let mut bytes = vec![0u8; size];
                self.decompressed_files[index] =
                    Some(match bun_zstd::decompress(&mut bytes, compressed_file) {
                        bun_zstd::Result::Err(err) => {
                            bun_core::Output::warn(&format_args!(
                                "Source map decompression error: {}",
                                ::bstr::BStr::new(err.as_bytes()),
                            ));
                            Vec::new()
                        }
                        bun_zstd::Result::Success(n) => {
                            bytes.truncate(n);
                            bytes
                        }
                    });
            }

            let decompressed = self.decompressed_files[index].as_deref().unwrap();
            if decompressed.is_empty() {
                None
            } else {
                Some(decompressed)
            }
        }
    }
}

// ── SourceMapPieces impl (lifted from the gated draft block (now dissolved)) ─────────────────────

impl SourceMapPieces {
    pub fn init() -> SourceMapPieces {
        SourceMapPieces::default()
    }

    pub fn has_content(&self) -> bool {
        (self.prefix.len() + self.mappings.len() + self.suffix.len()) > 0
    }

    pub fn finalize(
        &mut self,
        shifts_: &[SourceMapShifts],
    ) -> Result<Box<[u8]>, bun_alloc::AllocError> {
        let mut shifts = shifts_;
        let mut start_of_run: usize = 0;
        let mut current: usize = 0;
        let mut generated = LineColumnOffset::default();
        let mut prev_shift_column_delta: i32 = 0;

        // the joiner's node allocator contains string join nodes as well as some vlq encodings
        // it doesnt contain json payloads or source code, so 16kb is probably going to cover
        // most applications.
        // PERF(port): was stack-fallback (16384)
        let mut j = bun_core::string_joiner::StringJoiner::default();

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

// ── parse entry points ────────────────────────────────────────────────────

/// Parses an inline source map url like `data:application/json,....`
/// Currently does not handle non-inline source maps.
///
/// `source` must be in UTF-8 and can be freed after this call.
/// The mappings are owned by the global allocator.
/// Temporary allocations are made to the `arena` allocator, which
/// should be an arena allocator (caller is assumed to call `reset`).
pub fn parse_url(
    arena: &bun_alloc::Arena,
    source: &[u8],
    hint: ParseUrlResultHint,
) -> Result<ParseUrl, bun_core::Error> {
    // TODO(port): narrow error set
    let json_bytes: &[u8] = 'json_bytes: {
        const DATA_PREFIX: &[u8] = b"data:application/json";

        'try_data_url: {
            if source.starts_with(DATA_PREFIX) && source.len() > DATA_PREFIX.len() + 1 {
                // PORT NOTE: `scoped_log!(SourceMap, ...)` dropped — `SourceMap`
                // names the top-level struct in this module; the debug scope
                // lives in `mapping::SourceMap` and `scoped_log!` only takes a
                // bare ident. Debug-only log; revisit if scopes become path-able.
                match source[DATA_PREFIX.len()] {
                    b';' => {
                        let after = &source[DATA_PREFIX.len() + 1..];
                        let Some(comma) = after.iter().position(|&b| b == b',') else {
                            break 'try_data_url;
                        };
                        if &after[..comma] != b"base64" {
                            break 'try_data_url;
                        }
                        let base64_data = &after[comma + 1..];

                        let len = bun_base64::decode_len(base64_data);
                        let bytes = arena.alloc_slice_fill_default::<u8>(len);
                        let decoded = bun_base64::decode(bytes, base64_data);
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
    arena: &bun_alloc::Arena,
    source: &[u8],
    hint: ParseUrlResultHint,
) -> Result<ParseUrl, bun_core::Error> {
    use crate::mapping::SourceMap as SourceMapLog;
    use bun_ast::StoreResetGuard as DataStoreScope;
    use std::sync::Arc;

    // TODO(port): narrow error set
    let json_src = bun_ast::Source::init_path_string("sourcemap.json", source);
    let mut log = bun_ast::Log::init();
    // `defer log.deinit()` → Drop

    // the allocator given to the JS parser is not respected for all parts
    // of the parse, so we need to remember to reset the ast store on entry
    // and on every exit path.
    let _store_scope = DataStoreScope::new();
    bun_core::scoped_log!(SourceMapLog, "parse (JSON, {} bytes)", source.len());
    let json = match bun_parsers::json::parse::<false>(&json_src, &mut log, arena) {
        Ok(j) => j,
        Err(_) => return Err(bun_core::err!("InvalidJSON")),
    };

    if let Some(version) = json.get(b"version") {
        match version.data.as_e_number() {
            Some(n) if n.value == 3.0 => {}
            _ => return Err(bun_core::err!("UnsupportedVersion")),
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

    if sources_content.items.len_u32() != sources_paths.items.len_u32() {
        return Err(bun_core::err!("InvalidSourceMap"));
    }

    let source_only = matches!(hint, ParseUrlResultHint::SourceOnly(_));

    // PORT NOTE: reshaped for borrowck — Zig used a counted index `i` with
    // errdefer freeing the prefix; Rust `Vec<Box<[u8]>>` drops automatically.
    let source_paths_slice: Option<Vec<Box<[u8]>>> = if !source_only {
        let mut v: Vec<Box<[u8]>> = Vec::with_capacity(sources_content.items.len_u32() as usize);
        for item in sources_paths.items.slice() {
            let Some(s) = item.data.as_e_string() else {
                return Err(bun_core::err!("InvalidSourceMap"));
            };
            // TODO(port): e_string.string(alloc) — exact API TBD
            let s = s.string(arena)?;
            v.push(Box::<[u8]>::from(s));
        }
        Some(v)
    } else {
        None
    };

    let map: Option<Arc<ParsedSourceMap>> = if !source_only {
        let mut map_data = match mapping::parse(
            mappings_str.data.as_e_string().unwrap().slice(arena),
            None,
            i32::MAX,
            i32::MAX as usize,
            mapping::ParseOptions {
                allow_names: matches!(
                    hint,
                    ParseUrlResultHint::All {
                        include_names: true,
                        ..
                    }
                ),
                sort: true,
            },
        ) {
            ParseResult::Success(x) => x,
            ParseResult::Fail(fail) => return Err(fail.err),
        };

        if let ParseUrlResultHint::All {
            include_names: true,
            ..
        } = hint
        {
            if matches!(map_data.mappings.r#impl, mapping::ListValue::WithNames(_)) {
                if let Some(names) = json.get(b"names") {
                    if let Some(arr) = names.data.as_e_array() {
                        let mut names_list: Vec<bun_semver::String> =
                            Vec::with_capacity(arr.items.len_u32() as usize);
                        let mut names_buffer: Vec<u8> = Vec::new();

                        for item in arr.items.slice() {
                            let Some(estr) = item.data.as_e_string() else {
                                return Err(bun_core::err!("InvalidSourceMap"));
                            };

                            let str = estr.string(arena)?;

                            // PERF(port): was assume_capacity
                            names_list.push(bun_semver::String::init_append_if_needed(
                                &mut names_buffer,
                                str,
                            )?);
                        }

                        map_data.mappings.names = names_list.into_boxed_slice();
                        map_data.mappings.names_buffer = names_buffer;
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
            let Some(m) = map.as_ref().unwrap().find_mapping(
                Ordinal::from_zero_based(line),
                Ordinal::from_zero_based(column),
            ) else {
                break 'brk (None, None);
            };
            let idx = u32::try_from(m.source_index).ok();
            (Some(m), idx)
        }
        ParseUrlResultHint::MappingsOnly => (None, None),
    };

    let content_slice: Option<Box<[u8]>> = if !matches!(hint, ParseUrlResultHint::MappingsOnly)
        && source_index.is_some()
        && (source_index.unwrap() as usize) < sources_content.items.len_u32() as usize
    {
        'content: {
            let item = &sources_content.items.slice()[source_index.unwrap() as usize];
            let Some(estr) = item.data.as_e_string() else {
                break 'content None;
            };

            // bun.handleOom(...) → panic on OOM, do not propagate
            let str = estr.string(arena).expect("OOM");
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
    j: &mut bun_core::string_joiner::StringJoiner,
    prev_end_state_: SourceMapState,
    start_state_: SourceMapState,
    source_map_: &[u8],
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut prev_end_state = prev_end_state_;
    let mut start_state = start_state_;
    // Handle line breaks in between this mapping and the previous one
    if start_state.generated_line != 0 {
        j.push_owned(bun_core::strings::repeating_alloc(
            usize::try_from(start_state.generated_line).expect("int cast"),
            b';',
        )?);
        prev_end_state.generated_column = 0;
    }

    // Skip past any leading semicolons, which indicate line breaks
    let mut source_map = source_map_;
    if let Some(semicolons) = bun_core::strings::index_of_not_char(source_map, b';') {
        let semicolons = semicolons as usize;
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

    let mut str = bun_core::MutableString::init_empty();
    append_mapping_to_buffer(&mut str, j.last_byte(), prev_end_state, start_state);
    j.push_owned(str.to_owned_slice());

    // Then append everything after that without modification.
    j.push_static(source_map);
    Ok(())
}

/// Always returns UTF-8.
// TODO(port): Zig was generic over `comptime T: type` (u8/u16). Rust cannot
// express `[]const T` literals generically without a helper trait; split into
// two functions and dispatch at the (only) callsite.
fn find_source_mapping_url_u8(source: &[u8]) -> Option<bun_core::zig_string::Slice> {
    const NEEDLE: &[u8] = b"\n//# sourceMappingURL=";
    let found = bun_core::strings::last_index_of(source, NEEDLE)?;
    let start = found + NEEDLE.len();
    let end = source[start..]
        .iter()
        .position(|&b| b == b'\n')
        .map(|p| start + p)
        .unwrap_or(source.len());
    let url = bun_core::strings::trim_right(&source[start..end], b" \r");
    Some(bun_core::zig_string::Slice::from_utf8_never_free(url))
}

fn find_source_mapping_url_u16(source: &[u16]) -> Option<bun_core::zig_string::Slice> {
    let needle: &[u16] = bun_core::w!("\n//# sourceMappingURL=");
    let found = bun_core::strings::last_index_of_t(source, needle)?;
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
    Some(bun_core::zig_string::Slice::init_owned(
        bun_core::strings::to_utf8_alloc(url),
    ))
}

pub fn append_source_mapping_url_remote<W: bun_io::Write + ?Sized>(
    origin: &bun_url::URL<'_>,
    source: &bun_ast::Source,
    asset_prefix_path: &[u8],
    writer: &mut W,
) -> bun_io::Result<()> {
    writer.write_all(b"\n//# sourceMappingURL=")?;
    writer.write_all(bun_core::strings::without_trailing_slash(origin.href))?;
    if !asset_prefix_path.is_empty() {
        writer.write_all(asset_prefix_path)?;
    }
    if !source.path.pretty.is_empty() && source.path.pretty[0] != b'/' {
        writer.write_all(b"/")?;
    }
    writer.write_all(source.path.pretty)?;
    writer.write_all(b".map")?;
    Ok(())
}
