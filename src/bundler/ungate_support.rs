//! B-2 un-gate support — types and crate aliases extracted from the gated
//! `bundle_v2::__phase_a_draft` so `Chunk.rs` / `LinkerContext.rs` /
//! `ParseTask.rs` / `Graph.rs` can compile against real surfaces.
//!
//! These are pure value types with no T6 deps. Once `bundle_v2.rs` un-gates
//! its draft body it re-exports from here; nothing here owns behavior that
//! belongs elsewhere.

#![allow(unused)]

use bun_collections::BabyList;
use bun_string::strings;
// `Ref` is re-exported (pub use) below for `crate::Ref`; the local `use` here
// is intentionally folded into that to avoid duplicate-import errors.

use crate::{options, Index, IndexInt};

// ──────────────────────────────────────────────────────────────────────────
// Crate-name shims for Phase-A draft modules. These map the names the draft
// bodies use (`bun_str`, `bun_fs`, `bun_node_fallbacks`, `bun_output`,
// `bun_css`) onto the real crates / re-export modules so `use crate::…`
// resolves. The Phase-A drafts wrote bare extern-crate paths; un-gated
// modules import from here via `use crate::ungate_support::… as …`.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_string as bun_str;
pub use bun_resolver::fs as bun_fs;
pub use bun_resolver::node_fallbacks as bun_node_fallbacks;
/// `bun_output` is a thin re-export crate over `bun_core` that isn't a
/// workspace member yet; alias `bun_core` (which exports `declare_scope!` /
/// `scoped_log!` at its root) so `bun_output::declare_scope!(…)` resolves.
pub use bun_core as bun_output;
/// `bun.perf.trace(...)` lives in `bun_perf`; the drafts wrote
/// `bun_core::perf::…`, so re-export under that name.
///
/// `bun_perf::trace` now takes the generated `PerfEvent` enum (Zig used a
/// `comptime [:0]const u8` and `@field(PerfEvent, name)`). The Rust generator
/// hasn't emitted real variants yet (`PerfEvent::_Stub` only), so the bundler
/// drafts that pass string literals would all be dead names. Shim a
/// string-taking `trace` here that routes through `_Stub` so call sites stay
/// 1:1 with the `.zig` literals.
/// TODO(b1): drop once `scripts/generate-perf-trace-events.sh` emits Rust.
pub mod perf {
    pub use bun_perf::{Ctx, PerfEvent};

    #[inline]
    pub fn trace(_name: &'static str) -> Ctx {
        bun_perf::trace(PerfEvent::_Stub)
    }
}

/// Type-surface shim for `bun_css` as seen by the bundler. The real crate's
/// `BundlerStyleSheet` is itself gated (`css_parser.rs: `) and
/// several types carry a `'bump` lifetime that `Chunk`/`ParseTask` don't yet
/// thread, so this module is the canonical bundler-facing surface for now —
/// it re-exports real types where they exist (under `feature = "css"`) and
/// stubs the rest. Once `Chunk` gains a `'bump` lifetime and `bun_css`
/// un-gates `BundlerStyleSheet`, this collapses to a plain `pub use ::bun_css`.
pub mod bun_css {
    use bun_collections::BabyList;

    // ── feature = "css" (default) ────────────────────────────────────────
    // The real crate now un-gates `BundlerStyleSheet` (= `StyleSheet<BundlerAtRule>`)
    // with real `parse_bundler` / `minify` / `empty` bodies (`css_parser.rs`),
    // so the bundler-facing surface is just a glob re-export. The previous
    // local stub struct shadowed the glob; that shadow is dropped here so
    // callers (`ParseTask.rs`, `prepareCssAstsForChunk.rs`) see the real type
    // directly.
    #[cfg(feature = "css")]
    pub use ::bun_css::*;
    #[cfg(feature = "css")]
    pub use ::bun_css::css_modules::Config as CssModuleConfig;

    // ── feature ≠ "css" ──────────────────────────────────────────────────
    // Type-only surface so the bundler builds without the CSS crate. With no
    // parser available these are data-free no-ops; the loader dispatch in
    // `ParseTask::get_ast` never reaches `.css` without the feature, so the
    // bodies below are the correct "css-disabled" semantics (empty sheet,
    // identity minify).
    #[cfg(not(feature = "css"))]
    pub use self::no_css::*;
    #[cfg(not(feature = "css"))]
    mod no_css {
        use bun_collections::BabyList;
        use bun_options_types::ImportRecord;

        /// `css::BundlerStyleSheet` — arena-backed stylesheet AST. The real
        /// type is `StyleSheet<BundlerAtRule>` (`css_parser.rs`).
        #[derive(Default)]
        pub struct BundlerStyleSheet {
            pub local_scope: bun_collections::StringArrayHashMap<()>,
        }
        impl BundlerStyleSheet {
            pub fn empty() -> Self {
                Self::default()
            }
            /// css_parser.zig:3238 `parseBundler` — without `bun_css` there is
            /// no parser; return an empty sheet.
            pub fn parse_bundler(
                _allocator: &bun_alloc::Arena,
                _code: &[u8],
                _options: ParserOptions,
                _import_records: &mut BabyList<ImportRecord>,
                _source_index: u32,
            ) -> core::result::Result<(Self, StylesheetExtra), ()> {
                Ok((Self::default(), StylesheetExtra::default()))
            }
            /// css_parser.zig `StyleSheet.minify` — identity when CSS disabled.
            pub fn minify(
                &mut self,
                _allocator: &bun_alloc::Arena,
                _options: MinifyOptions,
                _extra: &mut StylesheetExtra,
            ) -> core::result::Result<(), ()> {
                Ok(())
            }
        }
        #[derive(Default)]
        pub struct StylesheetExtra {
            pub symbols: BabyList<bun_js_parser::Symbol>,
        }
        pub struct ParserOptions {
            pub filename: &'static [u8],
            pub css_modules: Option<CssModuleConfig>,
        }
        impl ParserOptions {
            pub fn default(_allocator: &bun_alloc::Arena, _log: &mut bun_logger::Log) -> Self {
                Self { filename: b"", css_modules: None }
            }
        }
        #[derive(Default)]
        pub struct CssModuleConfig;
        #[derive(Default)]
        pub struct MinifyOptions {
            pub targets: Targets,
            pub unused_symbols: bun_collections::ArrayHashMap<Box<[u8]>, ()>,
        }
        #[derive(Default, Clone, Copy)]
        pub struct Targets;
        impl Targets {
            pub fn for_bundler_target(_t: crate::options::Target) -> Self {
                Self
            }
        }
        #[derive(Clone)]
        pub struct ImportConditions(());
        pub struct PrinterOptions;
        pub struct Printer;
    }
    /// Lifetime-erased `LayerName` for `Chunk::Layers`. The real
    /// `bun_css::rules::layer::LayerName<'bump>` borrows the arena; until
    /// `Chunk` threads `'bump`, this owns its parts.
    pub struct LayerName {
        pub v: BabyList<Box<[u8]>>,
    }
    // PORT NOTE: `BabyList<T>` has no blanket `Clone`; manual deep-clone via
    // `BabyList::from_slice` (matches Zig `deepCloneInfallible`). OOM on a
    // tiny layer-name list is unrecoverable — `handle_oom`.
    impl Clone for LayerName {
        fn clone(&self) -> Self {
            Self { v: bun_core::handle_oom(BabyList::from_slice(self.v.slice())) }
        }
    }
    impl LayerName {
        /// Mirror of `bun_css::LayerName::eql` for the lifetime-erased shadow
        /// type. Compares each dot-segment by bytes.
        pub fn eql(&self, rhs: &LayerName) -> bool {
            if self.v.len != rhs.v.len {
                return false;
            }
            for (l, r) in self.v.slice().iter().zip(rhs.v.slice()) {
                if **l != **r {
                    return false;
                }
            }
            true
        }
    }
    impl core::fmt::Display for LayerName {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            for (i, part) in self.v.slice().iter().enumerate() {
                if i > 0 {
                    f.write_str(".")?;
                }
                f.write_str(&String::from_utf8_lossy(part))?;
            }
            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Value types extracted from `bundle_v2.zig` (gated `__phase_a_draft`).
// ──────────────────────────────────────────────────────────────────────────

/// `bundle_v2.zig:PartRange`.
///
/// PORT NOTE: re-exported from `bundle_v2::__phase_a_draft` so `Chunk.rs`
/// (`parts_in_chunk_in_order: Box<[PartRange]>`) and the `bundle_v2.rs`
/// `compute_chunks` body that fills it agree on a single type. Once
/// `__phase_a_draft` un-gates, this collapses to a plain local def.
pub use crate::bundle_v2::__phase_a_draft::PartRange;

/// `bundle_v2.zig:StableRef` — `packed struct(u96)`.
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct StableRef {
    pub stable_source_index: IndexInt,
    pub r#ref: Ref,
}

impl StableRef {
    pub fn is_less_than(_: (), a: StableRef, b: StableRef) -> bool {
        let (a_idx, b_idx) = (a.stable_source_index, b.stable_source_index);
        a_idx < b_idx || (a_idx == b_idx && { a.r#ref }.inner_index() < { b.r#ref }.inner_index())
    }
}

// PORT NOTE: `#[repr(packed)]` forbids derived comparison (would take an
// unaligned `&self.field`). Manual impls copy the packed fields to locals
// first. Ordering matches `bundle_v2.zig:StableRef.isLessThan` —
// `(stable_source_index, ref.inner_index)` lexicographic — so
// `slice.sort_unstable()` reproduces Zig `std.sort.pdq(StableRef, …,
// isLessThan)` call sites.
impl PartialEq for StableRef {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        let (a_idx, a_ref) = (self.stable_source_index, self.r#ref);
        let (b_idx, b_ref) = (other.stable_source_index, other.r#ref);
        a_idx == b_idx && a_ref == b_ref
    }
}
impl Eq for StableRef {}
impl Ord for StableRef {
    #[inline]
    fn cmp(&self, other: &Self) -> core::cmp::Ordering {
        let (a_idx, a_ref) = (self.stable_source_index, self.r#ref);
        let (b_idx, b_ref) = (other.stable_source_index, other.r#ref);
        (a_idx, a_ref.inner_index()).cmp(&(b_idx, b_ref.inner_index()))
    }
}
impl PartialOrd for StableRef {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// `bundle_v2.zig:ImportTracker`.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct ImportTracker {
    pub source_index: Index,
    pub name_loc: bun_logger::Loc,
    pub import_ref: Ref,
}

/// `bundle_v2.zig:CrossChunkImport.Item`.
#[derive(Default, Clone)]
pub struct CrossChunkImportItem {
    pub export_alias: Box<[u8]>,
    pub r#ref: Ref,
}
pub type CrossChunkImportItemList = BabyList<CrossChunkImportItem>;
/// `bundle_v2.zig:CrossChunkImport`.
#[derive(Default)]
pub struct CrossChunkImport {
    pub chunk_index: IndexInt,
    pub sorted_import_items: CrossChunkImportItemList,
}
/// `Chunk.zig:ImportsFromOtherChunks`.
pub mod cross_chunk_import {
    pub type ItemList = super::CrossChunkImportItemList;
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DeclInfoKind {
    Declared,
    Lexical,
}
pub struct DeclInfo {
    pub name: Box<[u8]>,
    pub kind: DeclInfoKind,
}

/// `bundle_v2.zig:CompileResult`.
pub enum CompileResult {
    Javascript {
        source_index: IndexInt,
        result: bun_js_printer::PrintResult,
        /// Top-level declarations collected from converted statements during
        /// parallel printing. Used by postProcessJSChunk to populate
        /// ModuleInfo without re-scanning the original (unconverted) AST.
        decls: Box<[DeclInfo]>,
    },
    Css {
        result: Result<Box<[u8]>, bun_core::Error>,
        source_index: IndexInt,
        source_map: Option<bun_sourcemap::Chunk>,
    },
    Html {
        source_index: IndexInt,
        code: Box<[u8]>,
        /// Offsets are used for DevServer to inject resources without re-bundling.
        script_injection_offset: u32,
    },
}

impl CompileResult {
    pub fn source_index(&self) -> IndexInt {
        match self {
            CompileResult::Javascript { source_index, .. }
            | CompileResult::Css { source_index, .. }
            | CompileResult::Html { source_index, .. } => *source_index,
        }
    }

    /// bundle_v2.zig:4215-4230.
    pub fn code(&self) -> &[u8] {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result(r) => &r.code,
                bun_js_printer::PrintResult::Err(_) => b"",
            },
            CompileResult::Css { result, .. } => match result {
                Ok(v) => v,
                Err(_) => b"",
            },
            CompileResult::Html { code, .. } => code,
        }
    }

    /// bundle_v2.zig:4232-4241.
    pub fn source_map_chunk(&self) -> Option<&bun_sourcemap::Chunk> {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result(r) => r.source_map.as_ref(),
                bun_js_printer::PrintResult::Err(_) => None,
            },
            CompileResult::Css { source_map, .. } => source_map.as_ref(),
            CompileResult::Html { .. } => None,
        }
    }
}

/// `bundle_v2.zig:genericPathWithPrettyInitialized` — public copy of the body
/// in `bundle_v2::__phase_a_draft` (private module). This assigns a concise,
/// predictable, and unique `.pretty` attribute to a Path. DevServer relies on
/// pretty paths for identifying modules, so they must be unique.
///
/// PORT NOTE: duplicated here so `LinkerContext::path_with_pretty_initialized`
/// resolves; collapses to a re-export once `__phase_a_draft` un-gates.
pub fn generic_path_with_pretty_initialized(
    path: bun_fs::Path,
    target: options::Target,
    top_level_dir: &[u8],
    _bump: &bun_alloc::Arena,
) -> Result<bun_fs::Path, bun_core::Error> {
    use std::io::Write;
    let mut buf = bun_paths::path_buffer_pool::get();

    let is_node = path.namespace == b"node";
    if is_node
        && (strings::has_prefix(&path.text, bun_node_fallbacks::IMPORT_PATH)
            || !bun_paths::is_absolute(&path.text))
    {
        return Ok(path);
    }

    // "file" namespace should use the relative file path for its display name.
    // the "node" namespace is also put through this code path so that the
    // "node:" prefix is not emitted.
    if path.is_file() || is_node {
        let mut buf2 = bun_paths::path_buffer_pool::get();
        let rel = bun_paths::resolve_path::relative_platform_buf::<
            bun_paths::resolve_path::platform::Loose,
            false,
        >(&mut **buf2, top_level_dir, &path.text);
        let mut path_clone = path;
        // stack-allocated temporary is not leaked because dupeAlloc on the path will
        // move .pretty into the heap. that function also fixes some slash issues.
        if target == options::Target::BakeServerComponentsSsr {
            // the SSR graph needs different pretty names or else HMR mode will
            // confuse the two modules.
            let mut cursor = &mut buf.0[..];
            let buf_len = cursor.len();
            let _ = write!(cursor, "ssr:{}", bstr::BStr::new(rel));
            let written = buf_len - cursor.len();
            path_clone.pretty = &buf.0[..written];
        } else {
            path_clone.pretty = rel;
        }
        Ok(path_clone.dupe_alloc_fix_pretty()?)
    } else {
        // in non-file namespaces, standard filesystem rules do not apply.
        let mut path_clone = path;
        let mut cursor = &mut buf.0[..];
        let buf_len = cursor.len();
        let _ = write!(
            cursor,
            "{}{}:{}",
            if target == options::Target::BakeServerComponentsSsr { "ssr:" } else { "" },
            EscapedNamespace(&path.namespace),
            bstr::BStr::new(&path.text),
        );
        let written = buf_len - cursor.len();
        path_clone.pretty = &buf.0[..written];
        Ok(path_clone.dupe_alloc_fix_pretty()?)
    }
}

struct EscapedNamespace<'a>(&'a [u8]);
impl core::fmt::Display for EscapedNamespace<'_> {
    fn fmt(&self, w: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let mut rest = self.0;
        while let Some(i) = strings::index_of_char(rest, b':') {
            write!(w, "{}", bstr::BStr::new(&rest[..i as usize]))?;
            w.write_str("::")?;
            rest = &rest[i as usize + 1..];
        }
        write!(w, "{}", bstr::BStr::new(rest))
    }
}

/// `bundle_v2.zig:CompileResultForSourceMap`.
#[derive(bun_collections::MultiArrayElement)]
pub struct CompileResultForSourceMap {
    pub source_map_chunk: bun_sourcemap::Chunk,
    pub generated_offset: bun_sourcemap::LineColumnOffset,
    pub source_index: u32,
}

/// `bundle_v2.zig:ContentHasher` — `std.hash.XxHash64` (seed 0). xxhash64
/// outperforms wyhash above ~1KB.
#[derive(Default)]
pub struct ContentHasher {
    pub hasher: bun_hash::XxHash64Streaming,
}
impl ContentHasher {
    pub fn write(&mut self, bytes: &[u8]) {
        self.hasher.update(&(bytes.len() as u64).to_ne_bytes());
        self.hasher.update(bytes);
    }
    pub fn run(bytes: &[u8]) -> u64 {
        let mut h = ContentHasher::default();
        h.write(bytes);
        h.digest()
    }
    /// `bundle_v2.zig:ContentHasher.writeInts` — `std.mem.sliceAsBytes(i)`.
    pub fn write_ints(&mut self, i: &[u32]) {
        // SAFETY: [u32] is POD; reinterpret as bytes (std.mem.sliceAsBytes).
        let bytes = unsafe {
            core::slice::from_raw_parts(i.as_ptr().cast::<u8>(), core::mem::size_of_val(i))
        };
        self.hasher.update(bytes);
    }
    pub fn digest(&self) -> u64 {
        self.hasher.digest()
    }
}

/// `bundle_v2.zig:cheapPrefixNormalizer` — non-allocating, fast but not
/// 100% thorough; users can put a trailing slash if they want, this is just
/// being nice.
pub fn cheap_prefix_normalizer<'s>(prefix: &'s [u8], suffix: &'s [u8]) -> [&'s [u8]; 2] {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if suffix_no_slash.starts_with(b"../") { b"" } else { b"./" },
            suffix_no_slash,
        ];
    }
    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"] => "/foo/bar.js"
    if strings::ends_with_char(prefix, b'/')
        || (cfg!(windows) && strings::ends_with_char(prefix, b'\\'))
    {
        if strings::starts_with_char(suffix, b'/')
            || (cfg!(windows) && strings::starts_with_char(suffix, b'\\'))
        {
            return [prefix, &suffix[1..]];
        }
    }
    [prefix, strings::remove_leading_dot_slash(suffix)]
}

/// `bundle_v2.zig:targetFromHashbang`.
pub fn target_from_hashbang(buffer: &[u8]) -> Option<options::Target> {
    const HB: &[u8] = b"#!/usr/bin/env bun";
    if buffer.len() > HB.len() && buffer.starts_with(HB) {
        match buffer[HB.len()] {
            b'\n' | b' ' => return Some(options::Target::Bun),
            _ => {}
        }
    }
    None
}

/// `js_ast::renamer` — re-exported here so `Chunk.rs` can name it without
/// pulling `bun_js_printer` into its `use` set (the Phase-A draft used a
/// non-existent `bun_renamer` crate).
pub mod bun_renamer {
    pub use bun_js_printer::renamer::*;
    /// Owned renamer stored on `Chunk.renamer`. The Zig field is the union
    /// `renamer.Renamer` set late (`= undefined`); the Rust `Renamer<'r,'src>`
    /// enum has borrowed lifetimes that can't be stored in a 'static-ish
    /// struct, so this owns the boxed concrete renamer instead and produces a
    /// borrowed `Renamer` view on demand. TODO(port): thread `'bump` once
    /// Chunk gains a lifetime.
    #[derive(Default)]
    pub enum ChunkRenamer {
        #[default]
        None,
        Number(Box<bun_js_printer::renamer::NumberRenamer>),
        Minify(Box<bun_js_printer::renamer::MinifyRenamer>),
    }

    impl ChunkRenamer {
        pub fn name_for_symbol(&mut self, ref_: bun_js_parser::Ref) -> &[u8] {
            match self {
                ChunkRenamer::None => unreachable!("ChunkRenamer not initialized"),
                ChunkRenamer::Number(r) => r.name_for_symbol(ref_),
                ChunkRenamer::Minify(r) => r.name_for_symbol(ref_),
            }
        }
        pub fn as_renamer(&mut self) -> bun_js_printer::renamer::Renamer<'_> {
            match self {
                ChunkRenamer::None => unreachable!("ChunkRenamer not initialized"),
                ChunkRenamer::Number(r) => bun_js_printer::renamer::Renamer::NumberRenamer(r),
                ChunkRenamer::Minify(r) => bun_js_printer::renamer::Renamer::MinifyRenamer(r),
            }
        }
    }
}

/// `HTMLImportManifest` — bundler-calling-convention adapter over the real
/// `crate::HTMLImportManifest` module so `Chunk.rs::IntermediateOutput::code`
/// can call free functions matching the Zig surface (`std.fmt.count` /
/// `std.io.fixedBufferStream`).
pub mod html_import_manifest {
    use crate::Graph::Graph;
    use crate::{chunk::Chunk, LinkerGraph};
    use crate::HTMLImportManifest as real;

    pub use real::{EscapedJson, HTMLImportManifest};

    /// HTMLImportManifest.zig:116 `formatEscapedJSON` — returns a `Display`
    /// adapter that writes the manifest JSON, then re-escapes it as a JS string
    /// literal body (`writePreQuotedString`). Chunk.rs uses this with
    /// `bun_core::fmt::count` for the counting pass.
    #[inline]
    pub fn format_escaped_json<'a>(
        index: u32,
        graph: &'a Graph,
        chunks: &'a [Chunk],
        linker_graph: &'a LinkerGraph,
    ) -> real::EscapedJson<'a> {
        real::HTMLImportManifest { index, graph, chunks, linker_graph }.format_escaped_json()
    }

    /// HTMLImportManifest.zig:98 `writeEscapedJSON` — fixed-buffer variant.
    /// `Chunk.rs` passes a `&mut &mut [u8]` cursor (Zig `fixedBufferStream`);
    /// this adapter implements `fmt::Write` over that cursor and forwards to
    /// the generic [`real::write_escaped_json`].
    pub fn write_escaped_json(
        index: u32,
        graph: &Graph,
        linker_graph: &LinkerGraph,
        chunks: &[Chunk],
        w: &mut &mut [u8],
    ) -> Result<(), core::fmt::Error> {
        // PORT NOTE: Zig's `std.io.fixedBufferStream(remain).writer()` advances
        // the slice in place; mirror that with a `bun_io::Write` adapter so the
        // caller can recover `pos = before_len - cursor.len()`.
        struct FixedBufWriter<'a, 'b>(&'a mut &'b mut [u8]);
        impl bun_io::Write for FixedBufWriter<'_, '_> {
            fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
                if bytes.len() > self.0.len() {
                    // Zig: error.NoSpaceLeft => unreachable (buffer was sized
                    // by the counting pass).
                    return Err(bun_core::err!("NoSpaceLeft"));
                }
                let (head, tail) = core::mem::take(self.0).split_at_mut(bytes.len());
                head.copy_from_slice(bytes);
                *self.0 = tail;
                Ok(())
            }
        }
        real::write_escaped_json(index, graph, linker_graph, chunks, &mut FixedBufWriter(w))
            .map_err(|_| core::fmt::Error)
    }
}

/// `HTMLScanner` — gated module; ParseTask only constructs it.
pub mod html_scanner {
    use bun_collections::BabyList;
    use bun_options_types::ImportRecord;

    pub struct HTMLScanner {
        pub import_records: BabyList<ImportRecord>,
    }
    impl HTMLScanner {
        pub fn init(
            _bump: &bun_alloc::Arena,
            _log: &mut bun_logger::Log,
            _source: &bun_logger::Source,
        ) -> HTMLScanner {
            HTMLScanner { import_records: BabyList::default() }
        }
        pub fn scan(&mut self, _contents: &[u8]) -> Result<(), bun_core::Error> {
            // TODO(port): real body lives in `crate::HTMLScanner` (gated module).
            // ParseTask only needs `import_records` populated; un-gate forwards
            // to the real lol-html scanner.
            Ok(())
        }
    }
}

/// `LinkerGraph.zig:JSMeta` / `WrapKind` / `ExportData` — minimal surface so
/// `LinkerContext.rs` field types resolve while `LinkerGraph.rs` is gated.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum WrapKind {
    #[default]
    None = 0,
    Cjs,
    Esm,
}

pub use bun_js_parser::UseDirective;
pub use bun_js_parser::ServerComponentBoundary;
pub use crate::options_impl::PathTemplate;

/// `bundle_v2.zig:MangledProps`.
pub type MangledProps = bun_collections::ArrayHashMap<Ref, Box<[u8]>>;

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate surface for `LinkerGraph.rs` + `linker_context/scanImportsAndExports.rs`.
// Real value-type defs extracted from the gated `bundle_v2::__phase_a_draft`
// (JSMeta, EntryPoint, ImportData, ExportData, …) so the freshly un-gated
// modules can name them at `crate::*`. Once `bundle_v2.rs` un-gates its draft
// body these collapse to re-exports.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.logger` — alias used by Phase-A drafts as `crate::Logger::Source`.
pub use bun_logger as Logger;

/// `js_ast.BundledAst` (the bundler-facing AST view).
///
/// PORT NOTE: lifetime-erased to `'static`. `BundledAst<'arena>` borrows the
/// per-file parse arena (`hashbang`/`url_for_css`/`export_star_import_records`
/// slices). The bundler owns those arenas for the entire link (see
/// `LinkerGraph.bump: *const Arena` "stays `'static`-ish" note); `JSAst` is
/// stored in a `MultiArrayList` SoA inside `LinkerGraph`/`Graph`, neither of
/// which carries a lifetime parameter yet. Pin to `'static` until Phase B
/// threads `'bump` through `Chunk`/`LinkerGraph`/`LinkerContext`.
pub type JSAst = bun_js_parser::BundledAst<'static>;
pub use bun_js_parser::{Part, Ref, Symbol};

/// Lowercase-module aliases mirroring Zig's `Index.Int` / `Part.List` /
/// `ImportRecord.List` nesting so draft bodies that wrote `index::Int` /
/// `part::List` / `import_record::List` resolve.
pub mod index {
    pub use crate::IndexInt as Int;
    pub use crate::Index;
}
pub mod part {
    pub use bun_js_parser::Dependency;
    pub use bun_js_parser::PartList as List;
    /// `Part.SymbolUse` (Symbol.zig:Use).
    pub use bun_js_parser::ast::symbol::Use as SymbolUse;
}
pub mod import_record {
    pub use bun_options_types::import_record::List;
}

/// `bundle_v2.zig:EntryPoint` — both a struct and (via the sibling module
/// below) a namespace for `Kind`. Rust keeps types and modules in separate
/// namespaces, so `use crate::EntryPoint` imports both.
pub mod entry_point {
    use bun_collections::MultiArrayList;
    use bun_string::PathString;

    #[derive(Default, bun_collections::MultiArrayElement)]
    pub struct EntryPoint {
        /// This may be an absolute path or a relative path. If absolute, it will
        /// eventually be turned into a relative path by computing the path
        /// relative to the "outbase" directory. Then this relative path will be
        /// joined onto the "outdir" directory to form the final output path for
        /// this entry point.
        pub output_path: PathString,
        /// This is the source index of the entry point. This file must have a
        /// valid entry point kind (i.e. not "none").
        pub source_index: crate::IndexInt,
        /// Manually specified output paths are ignored when computing the
        /// default "outbase" directory.
        pub output_path_was_auto_generated: bool,
    }

    pub type List = MultiArrayList<EntryPoint>;

    /// `bundle_v2.zig:EntryPoint.Kind` — inherent associated type so
    /// `EntryPoint::Kind` resolves at every use-site (the explicit struct
    /// re-export at the crate root shadows any glob-imported module of the
    /// same name, so a sibling `mod EntryPoint { … }` is unreachable there).
    /// Requires `#![feature(inherent_associated_types)]` (enabled in lib.rs).
    impl EntryPoint {
        pub type Kind = Kind;
    }

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub enum Kind {
        #[default]
        None,
        UserSpecified,
        DynamicImport,
        Html,
    }
    impl Kind {
        #[inline]
        pub fn is_entry_point(self) -> bool {
            self != Self::None
        }
        #[inline]
        pub fn is_user_specified_entry_point(self) -> bool {
            self == Self::UserSpecified
        }
        #[inline]
        pub fn is_server_entry_point(self) -> bool {
            self == Self::UserSpecified
        }
        /// bundle_v2.zig:4021-4026.
        #[inline]
        pub fn output_kind(self) -> crate::options::OutputKind {
            match self {
                Self::UserSpecified => crate::options::OutputKind::EntryPoint,
                _ => crate::options::OutputKind::Chunk,
            }
        }
    }
}

/// `bundle_v2.zig:ImportData` / `ExportData` / `JSMeta` — see gated
/// `bundle_v2::__phase_a_draft` for full doc-comments.
pub mod js_meta {
    use bun_collections::{ArrayHashMap, BabyList, StringArrayHashMap};
    use bun_js_parser::{Dependency, Ref};

    use crate::{ImportTracker, Index, WrapKind};

    #[derive(Default)]
    pub struct ImportData {
        pub re_exports: BabyList<Dependency>,
        pub data: ImportTracker,
    }
    /// Alias used by `LinkerGraph::generate_symbol_import_and_use`.
    pub type ImportToBind = ImportData;

    #[derive(Default)]
    pub struct ExportData {
        pub potentially_ambiguous_export_star_refs: BabyList<ImportData>,
        pub data: ImportTracker,
    }
    /// Alias used by `LinkerGraph::load`.
    pub type ResolvedExport = ExportData;

    pub type RefImportData = ArrayHashMap<Ref, ImportData>;
    pub type ResolvedExports = StringArrayHashMap<ExportData>;
    pub type TopLevelSymbolToParts = bun_js_parser::ast::ast::TopLevelSymbolToParts;

    /// `bundle_v2.zig:JSMeta.Flags` — packed struct(u8). Field-style access
    /// (`flags.is_async_or_has_async_dependency = true`) is what the Phase-A
    /// drafts wrote, so this is a plain struct of bools + `wrap` for now;
    /// pack into a u8 once callers move to setters. PERF(port).
    #[derive(Clone, Copy, Default)]
    pub struct Flags {
        pub is_async_or_has_async_dependency: bool,
        pub needs_exports_variable: bool,
        pub force_include_exports_for_entry_point: bool,
        pub needs_export_symbol_from_runtime: bool,
        pub did_wrap_dependencies: bool,
        pub needs_synthetic_default_export: bool,
        pub wrap: WrapKind,
    }
    /// `JSMeta.Wrap` alias used by `linker_context/` submodules.
    pub use crate::WrapKind as Wrap;

    #[derive(Default, bun_collections::MultiArrayElement)]
    pub struct JSMeta {
        pub probably_typescript_type: ArrayHashMap<Ref, ()>,
        pub imports_to_bind: RefImportData,
        pub resolved_exports: ResolvedExports,
        pub resolved_export_star: ExportData,
        pub sorted_and_filtered_export_aliases: Box<[Box<[u8]>]>,
        pub top_level_symbol_to_parts_overlay: TopLevelSymbolToParts,
        pub cjs_export_copies: Box<[Ref]>,
        pub wrapper_part_index: Index,
        pub entry_point_part_index: Index,
        pub flags: Flags,
    }

    /// Inherent associated types so `JSMeta::Flags` / `JSMeta::Wrap` resolve
    /// (Zig nests them under the struct). A sibling `pub mod JSMeta` would
    /// collide with the struct re-export (E0255).
    impl JSMeta {
        pub type Flags = Flags;
        pub type Wrap = crate::WrapKind;
    }
}
pub use js_meta::{
    ExportData, ImportData, JSMeta, JSMetaField, JSMetaListExt, JSMetaSliceExt, RefImportData,
    ResolvedExports, TopLevelSymbolToParts,
};

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate surface for `bundle_v2.rs::on_parse_task_complete`.
// `#[derive(MultiArrayElement)]` now emits `InputFileListExt` with the full
// `items_<field>()` / `items_<field>_mut()` set; this alias keeps the old
// `InputFileListExtMut` import in `bundle_v2.rs` resolving without method
// ambiguity (same trait, two names).
// ──────────────────────────────────────────────────────────────────────────
pub use crate::Graph::InputFileListExt as InputFileListExtMut;

/// Re-exports of the `#[derive(MultiArrayElement)]`-generated SoA accessor
/// traits so callers can `use crate::ungate_support::FooListExt as _;` without
/// reaching into the defining submodule.
pub use entry_point::{EntryPointListExt, EntryPointSliceExt, EntryPointField};

/// `bundle_v2.zig` aliased `EventLoop = bun.jsc.AnyEventLoop`; the bundler only
/// stores it on `LinkerContext.loop` (already typed there as
/// `Option<NonNull<()>>` — erased handle) and calls `.tick(...)` from
/// `wait_for_parse`. Re-export the LinkerContext alias so `bundle_v2.rs` and
/// `ParseTask.rs` agree on the spelling.
pub use crate::linker_context_mod::EventLoop;
