//! B-2 un-gate support — types and crate aliases extracted from `bundle_v2`
//! so `Chunk.rs` / `LinkerContext.rs` / `ParseTask.rs` / `Graph.rs` can
//! compile against real surfaces.
//!
//! These are pure value types with no T6 deps. `bundle_v2.rs` re-exports the
//! whole set from here (its draft duplicates were collapsed in DEDUP D059);
//! nothing here owns behavior that belongs elsewhere.

#![allow(unused)]
#![warn(unused_must_use)]

use bun_collections::VecExt;
use bun_core::strings;
// `Ref` is re-exported (pub use) below for `crate::Ref`; the local `use` here
// is intentionally folded into that to avoid duplicate-import errors.

use crate::{Index, IndexInt, options};

// ──────────────────────────────────────────────────────────────────────────
// Crate-name shims for Phase-A draft modules. These map the names the draft
// bodies use (`bun_str`, `bun_fs`, `bun_node_fallbacks`, `bun_output`,
// `bun_css`) onto the real crates / re-export modules so `use crate::…`
// resolves. The Phase-A drafts wrote bare extern-crate paths; un-gated
// modules import from here via `use crate::ungate_support::… as …`.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_core as bun_str;
/// `bun_output` is a thin re-export crate over `bun_core` that isn't a
/// workspace member yet; alias `bun_core` (which exports `declare_scope!` /
/// `scoped_log!` at its root) so `bun_output::declare_scope!(…)` resolves.
pub use bun_core as bun_output;
pub use bun_resolver::fs as bun_fs;
pub use bun_resolver::node_fallbacks as bun_node_fallbacks;
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

/// Bundler-facing surface for `bun_css`. Several types carry a `'bump`
/// lifetime that `Chunk`/`ParseTask` don't yet thread, so this module remains
/// the canonical re-export point (and adds `CssModuleConfig`/`LayerName`
/// aliases). Once `Chunk` gains a `'bump` lifetime this collapses to a plain
/// `pub use ::bun_css`.
pub mod bun_css {
    // `bun_css` is an UNCONDITIONAL dep (`bun_js_parser` already pulls it in
    // for `BundledAst.css`'s field type). Glob-re-export always.
    pub use ::bun_css::css_modules::Config as CssModuleConfig;
    pub use ::bun_css::*;

    /// `LayerName` for `Chunk::Layers`. The real `bun_css::css_parser::LayerName`
    /// (its `'bump` lifetime is already laundered to `'static` in
    /// `rules/layer.rs`, so no thread needed here).
    pub use ::bun_css::css_parser::LayerName;
}

// ──────────────────────────────────────────────────────────────────────────
// Value types extracted from `bundle_v2.zig`.
// ──────────────────────────────────────────────────────────────────────────

/// `bundle_v2.zig:PartRange`.
///
/// PORT NOTE: defined here (not in `bundle_v2`) so `Chunk.rs`
/// (`parts_in_chunk_in_order: Box<[PartRange]>`) and the `bundle_v2.rs`
/// `compute_chunks` body that fills it (via `crate::ungate_support::PartRange`)
/// agree on a single nominal type.
#[derive(Clone, Copy, Default)]
pub struct PartRange {
    pub source_index: Index,
    pub part_index_begin: u32,
    pub part_index_end: u32,
}

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
    pub name_loc: bun_ast::Loc,
    pub import_ref: Ref,
}

/// `bundle_v2.zig:CrossChunkImport.Item`.
#[derive(Default, Clone)]
pub struct CrossChunkImportItem {
    pub export_alias: Box<[u8]>,
    pub r#ref: Ref,
}
pub type CrossChunkImportItemList = Vec<CrossChunkImportItem>;
/// `bundle_v2.zig:CrossChunkImport`.
#[derive(Default)]
pub struct CrossChunkImport {
    pub chunk_index: IndexInt,
    /// Borrowed view into `ImportsFromOtherChunks` — Zig's `BabyList` has no
    /// destructor, so dropping `CrossChunkImport` must not free this buffer.
    pub sorted_import_items: core::mem::ManuallyDrop<CrossChunkImportItemList>,
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
#[derive(Clone)]
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

    /// Consume `self` and yield the owned code buffer. Used when the
    /// `StringJoiner` must outlive the `CompileResult` local that produced it
    /// (Zig `j.push(code, allocator)` ownership-transfer semantics).
    pub fn into_code(self) -> Box<[u8]> {
        match self {
            CompileResult::Javascript { result, .. } => match result {
                bun_js_printer::PrintResult::Result(r) => r.code,
                bun_js_printer::PrintResult::Err(_) => Box::default(),
            },
            CompileResult::Css { result, .. } => result.unwrap_or_default(),
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

// PORT NOTE: manual `Clone` because `bun_js_printer::PrintResult` doesn't
// derive it (its fields are all `Clone`-able, so destructure and rebuild).
// `vec![CompileResult::default(); n]` in `generateChunksInParallel.rs` needs
// this to pre-size the per-chunk result buffers — Zig used `arena.alloc`
// (uninit), Rust fills with defaults.
impl Clone for CompileResult {
    fn clone(&self) -> Self {
        match self {
            CompileResult::Javascript {
                source_index,
                result,
                decls,
            } => CompileResult::Javascript {
                source_index: *source_index,
                result: match result {
                    bun_js_printer::PrintResult::Result(r) => {
                        bun_js_printer::PrintResult::Result(bun_js_printer::PrintResultSuccess {
                            code: r.code.clone(),
                            source_map: r.source_map.clone(),
                        })
                    }
                    bun_js_printer::PrintResult::Err(e) => bun_js_printer::PrintResult::Err(*e),
                },
                decls: decls.clone(),
            },
            CompileResult::Css {
                result,
                source_index,
                source_map,
            } => CompileResult::Css {
                result: result.clone(),
                source_index: *source_index,
                source_map: source_map.clone(),
            },
            CompileResult::Html {
                source_index,
                code,
                script_injection_offset,
            } => CompileResult::Html {
                source_index: *source_index,
                code: code.clone(),
                script_injection_offset: *script_injection_offset,
            },
        }
    }
}

// PORT NOTE: `Default` so `CompileResult::Javascript { .., ..Default::default() }`
// FRU sites in `postProcessJSChunk.rs` compile. Returns the `Javascript`
// variant (the only one those FRU sites construct).
impl Default for CompileResult {
    fn default() -> Self {
        CompileResult::Javascript {
            source_index: 0,
            result: bun_js_printer::PrintResult::Result(bun_js_printer::PrintResultSuccess {
                code: Box::new([]),
                source_map: None,
            }),
            decls: Box::new([]),
        }
    }
}

/// `bundle_v2.zig:genericPathWithPrettyInitialized`. This assigns a concise,
/// predictable, and unique `.pretty` attribute to a Path. DevServer relies on
/// pretty paths for identifying modules, so they must be unique.
///
/// PORT NOTE: signature uses `bun_paths::fs::Path<'static>` (= `bun_paths::fs::Path<'static>`,
/// the type stored on `bun_ast::Source.path`). `dupe_alloc_fix_pretty` interns into
/// `FilenameStore` (process-static), so the `'static` return is satisfied.
pub fn generic_path_with_pretty_initialized(
    path: bun_paths::fs::Path<'static>,
    target: options::Target,
    top_level_dir: &[u8],
    _bump: &bun_alloc::Arena,
) -> Result<bun_paths::fs::Path<'static>, bun_core::Error> {
    use bun_fs::PathResolverExt as _;
    use bun_io::Write as _;

    let mut buf = bun_paths::path_buffer_pool::get();

    let is_node = path.namespace == b"node";
    if is_node
        && (strings::has_prefix(path.text, bun_node_fallbacks::IMPORT_PATH)
            || !bun_paths::is_absolute(path.text))
    {
        return Ok(path);
    }

    // "file" namespace should use the relative file path for its display name.
    // the "node" namespace is also put through this code path so that the
    // "node:" prefix is not emitted.
    if path.is_file() || is_node {
        let mut buf2 = bun_paths::path_buffer_pool::get();
        // TODO(port): in Zig buf2 aliases buf when target != ssr.
        let rel = bun_paths::resolve_path::relative_platform_buf::<
            bun_paths::resolve_path::platform::Loose,
            false,
        >(&mut **buf2, top_level_dir, path.text);
        // D090: `bun_paths::fs::Path<'static>` and `bun_fs::Path` are the same type;
        // covariance lets `path_clone` widen to `Path<'_>` for the temp `pretty`.
        let mut path_clone: bun_fs::Path<'_> = path;
        // stack-allocated temporary is not leaked because dupeAlloc on the path will
        // move .pretty into the heap. that function also fixes some slash issues.
        if target == options::Target::BakeServerComponentsSsr {
            // the SSR graph needs different pretty names or else HMR mode will
            // confuse the two modules.
            let mut fbs = bun_io::FixedBufferStream::new_mut(&mut buf.0[..]);
            // PORT NOTE: Zig `bufPrint(buf, "ssr:{s}", .{rel})` writes bytes
            // verbatim; routing through `bstr::BStr` Display lossily replaces
            // non-UTF-8 path bytes (legal on Linux) with U+FFFD, corrupting
            // metafile `inputs` keys / HMR module identity. Write raw bytes.
            let _ = fbs.write_all(b"ssr:");
            let _ = fbs.write_all(rel);
            let written = fbs.pos;
            path_clone.pretty = &buf.0[..written];
        } else {
            path_clone.pretty = rel;
        }
        path_clone.dupe_alloc_fix_pretty()
    } else {
        // in non-file namespaces, standard filesystem rules do not apply.
        let mut path_clone: bun_fs::Path<'_> = path;
        let mut fbs = bun_io::FixedBufferStream::new_mut(&mut buf.0[..]);
        // PORT NOTE: raw byte writes (not `write!` over `bstr::BStr`) — see
        // the `ssr:` branch above; namespace/text may carry non-UTF-8 bytes.
        if target == options::Target::BakeServerComponentsSsr {
            let _ = fbs.write_all(b"ssr:");
        }
        // make sure that a namespace including a colon wont collide with anything
        let _ = write_escaped_namespace(&mut fbs, path_clone.namespace);
        let _ = fbs.write_all(b":");
        let _ = fbs.write_all(path_clone.text);
        let written = fbs.pos;
        path_clone.pretty = &buf.0[..written];
        path_clone.dupe_alloc_fix_pretty()
    }
}

/// `bundle_v2.zig:fmtEscapedNamespace`. Doubles every `:` so a namespace
/// containing colons cannot collide with the `<ns>:<path>` separator.
///
/// PORT NOTE: byte-level `Write::write_all` (not `core::fmt::Display` over
/// `bstr::BStr`) — Zig `writer.writeAll` emits raw bytes, and plugins may set
/// arbitrary (non-UTF-8) namespace bytes that `BStr`'s Display would lossily
/// replace with U+FFFD.
fn write_escaped_namespace<W: bun_io::Write + ?Sized>(w: &mut W, slice: &[u8]) -> bun_io::Result {
    let mut rest = slice;
    while let Some(i) = strings::index_of_char(rest, b':') {
        w.write_all(&rest[..i as usize])?;
        w.write_all(b"::")?;
        rest = &rest[i as usize + 1..];
    }
    w.write_all(rest)
}

/// `bundle_v2.zig:CompileResultForSourceMap`.

pub struct CompileResultForSourceMap {
    pub source_map_chunk: bun_sourcemap::Chunk,
    pub generated_offset: bun_sourcemap::LineColumnOffset,
    pub source_index: u32,
}

bun_collections::multi_array_columns! {
    pub trait CompileResultForSourceMapColumns for CompileResultForSourceMap {
        source_map_chunk: bun_sourcemap::Chunk,
        generated_offset: bun_sourcemap::LineColumnOffset,
        source_index: u32,
    }
}

/// `bundle_v2.zig:ContentHasher` — `std.hash.XxHash64` (seed 0). xxhash64
/// outperforms wyhash above ~1KB.
#[derive(Default)]
pub struct ContentHasher {
    pub hasher: bun_hash::XxHash64Streaming,
}
// `bun.Output.scoped(.ContentHasher, .hidden)` (bundle_v2.zig:4258). The static
// (value namespace) deliberately puns the struct name (type namespace) — brace
// structs only occupy the type namespace, so the two coexist.
bun_core::declare_scope!(ContentHasher, hidden);
impl ContentHasher {
    pub fn write(&mut self, bytes: &[u8]) {
        bun_core::scoped_log!(
            ContentHasher,
            "HASH_UPDATE {}:\n{}\n----------\n",
            bytes.len(),
            bstr::BStr::new(bytes)
        );
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
        bun_core::scoped_log!(ContentHasher, "HASH_UPDATE: {:?}\n", i);
        self.hasher.update(bytemuck::cast_slice::<u32, u8>(i));
    }
    pub fn digest(&self) -> u64 {
        self.hasher.digest()
    }
}

/// `bundle_v2.zig:cheapPrefixNormalizer` — moved down to `bun_string`
/// (lower-tier crate shared with `css::printer`). Re-exported here so the
/// existing `crate::cheap_prefix_normalizer` chain in `bundle_v2.rs` and the
/// bundler call-sites keep working unchanged.
pub use bun_core::cheap_prefix_normalizer;

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
        pub fn name_for_symbol(&mut self, ref_: bun_ast::Ref) -> &[u8] {
            match self {
                ChunkRenamer::None => unreachable!("ChunkRenamer not initialized"),
                ChunkRenamer::Number(r) => r.name_for_symbol(ref_),
                ChunkRenamer::Minify(r) => r.name_for_symbol(ref_),
            }
        }
        pub fn as_renamer(&mut self) -> bun_js_printer::renamer::Renamer<'_, '_> {
            match self {
                ChunkRenamer::None => unreachable!("ChunkRenamer not initialized"),
                ChunkRenamer::Number(r) => bun_js_printer::renamer::Renamer::NumberRenamer(r),
                // PORT NOTE: `Renamer<'r,'src>` borrows the concrete renamer
                // (`&'r mut MinifyRenamer`); `ChunkRenamer` owns the `Box`, so
                // the deref-coerced `&mut **r` yields a per-call borrowed view
                // exactly like the Zig tag+ptr union.
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
    use crate::HTMLImportManifest as real;
    use crate::{LinkerGraph, chunk::Chunk};

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
        real::HTMLImportManifest {
            index,
            graph,
            chunks,
            linker_graph,
        }
        .format_escaped_json()
    }

    /// HTMLImportManifest.zig:98 `writeEscapedJSON` — fixed-buffer variant.
    /// `Chunk.rs` passes a `&mut &mut [u8]` cursor (Zig `fixedBufferStream`);
    /// route through [`bun_io::FixedBufferStream`] and advance the caller's
    /// slice in place so it can recover `pos = before_len - cursor.len()`.
    pub fn write_escaped_json(
        index: u32,
        graph: &Graph,
        linker_graph: &LinkerGraph,
        chunks: &[Chunk],
        w: &mut &mut [u8],
    ) -> Result<(), core::fmt::Error> {
        let taken = core::mem::take(w);
        let mut fbs = bun_io::FixedBufferStream::new_mut(taken);
        real::write_escaped_json(index, graph, linker_graph, chunks, &mut fbs)
            .map_err(|_| core::fmt::Error)?;
        let bun_io::FixedBufferStream { buffer, pos } = fbs;
        *w = &mut buffer[pos..];
        Ok(())
    }
}

/// `HTMLScanner` — re-export of the real un-gated module so
/// `crate::html_scanner::HTMLScanner` (the path ParseTask imports) resolves to
/// the lol-html-backed implementation in `HTMLScanner.rs`. The previous local
/// stub here was a no-op `scan()` that silently dropped every `<script>`/`<link>`
/// import record; with the real module un-gated there is no reason to shadow it.
pub use crate::HTMLScanner as html_scanner;

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

pub use crate::options_impl::PathTemplate;
pub(crate) use bun_ast::ServerComponentBoundary;
pub(crate) use bun_ast::UseDirective;

/// `bundle_v2.zig:MangledProps`.
pub use bun_js_printer::MangledProps;

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate surface for `LinkerGraph.rs` + `linker_context/scanImportsAndExports.rs`.
// Real value-type defs extracted from the gated `bundle_v2.rs` draft body
// (JSMeta, EntryPoint, ImportData, ExportData, …) so the freshly un-gated
// modules can name them at `crate::*`. Once `bundle_v2.rs` un-gates its draft
// body these collapse to re-exports.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.logger` — alias used by Phase-A drafts as `crate::bun_ast::Source`.

/// `js_ast.BundledAst` (the bundler-facing AST view).
///
/// PORT NOTE: lifetime-erased to `'static`. `BundledAst<'arena>` borrows the
/// per-file parse arena (`hashbang`/`url_for_css`/`export_star_import_records`
/// slices). The bundler owns those arenas for the entire link (see
/// `LinkerGraph.bump: *const Arena` "stays `'static`-ish" note); `JSAst` is
/// stored in a `MultiArrayList` SoA inside `LinkerGraph`/`Graph`, neither of
/// which carries a lifetime parameter yet. Pin to `'static` until Phase B
/// threads `'bump` through `Chunk`/`LinkerGraph`/`LinkerContext`.
pub type JSAst = crate::BundledAst<'static>;
pub(crate) use bun_ast::{Part, Ref, Symbol};

/// `bundle_v2.zig:EntryPoint` — both a struct and (via the sibling module
/// below) a namespace for `Kind`. Rust keeps types and modules in separate
/// namespaces, so `use crate::EntryPoint` imports both.
pub mod entry_point {
    use bun_collections::MultiArrayList;
    use bun_core::PathString;

    #[derive(Default)]
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

    bun_collections::multi_array_columns! {
        pub trait EntryPointColumns for EntryPoint {
            output_path: PathString,
            source_index: crate::IndexInt,
            output_path_was_auto_generated: bool,
        }
    }

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

/// `bundle_v2.zig:ImportData` / `ExportData` / `JSMeta` — see the gated
/// `bundle_v2.rs` draft body for full doc-comments.
pub mod js_meta {
    use bun_ast::{Dependency, Ref};
    use bun_collections::{ArrayHashMap, StringArrayHashMap, VecExt};

    use crate::{ImportTracker, Index, WrapKind};

    #[derive(Default)]
    pub struct ImportData {
        pub re_exports: Vec<Dependency>,
        pub data: ImportTracker,
    }
    /// Alias used by `LinkerGraph::generate_symbol_import_and_use`.
    pub type ImportToBind = ImportData;

    #[derive(Default)]
    pub struct ExportData {
        pub potentially_ambiguous_export_star_refs: Vec<ImportData>,
        pub data: ImportTracker,
    }
    /// Alias used by `LinkerGraph::load`.
    pub type ResolvedExport = ExportData;

    pub type RefImportData = ArrayHashMap<Ref, ImportData>;
    pub type ResolvedExports = StringArrayHashMap<ExportData>;
    pub type TopLevelSymbolToParts = bun_ast::ast_result::TopLevelSymbolToParts;

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

    #[derive(Default)]
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

    bun_collections::multi_array_columns! {
        pub trait JSMetaColumns for JSMeta {
            probably_typescript_type: ArrayHashMap<Ref, ()>,
            imports_to_bind: RefImportData,
            resolved_exports: ResolvedExports,
            resolved_export_star: ExportData,
            sorted_and_filtered_export_aliases: Box<[Box<[u8]>]>,
            top_level_symbol_to_parts_overlay: TopLevelSymbolToParts,
            cjs_export_copies: Box<[Ref]>,
            wrapper_part_index: Index,
            entry_point_part_index: Index,
            flags: Flags,
        }
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
    ExportData, ImportData, JSMeta, JSMetaColumns, RefImportData, ResolvedExports,
    TopLevelSymbolToParts,
};

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate surface for `bundle_v2.rs::on_parse_task_complete`.
// `` now emits `InputFileColumns` with the full
// `items_<field>()` / `items_<field>_mut()` set; this alias keeps the old
// ambiguity (same trait, two names).
// ──────────────────────────────────────────────────────────────────────────

/// Re-export of the SoA accessor trait so callers can
/// `use crate::ungate_support::EntryPointColumns as _;`.
pub use entry_point::EntryPointColumns;

/// `bundle_v2.zig` aliased `EventLoop = bun.jsc.AnyEventLoop`; the bundler only
/// stores it on `LinkerContext.loop` (already typed there as
/// `Option<NonNull<()>>` — erased handle) and calls `.tick(...)` from
/// `wait_for_parse`. Re-export the LinkerContext alias so `bundle_v2.rs` and
/// `ParseTask.rs` agree on the spelling.
pub use crate::linker_context_mod::EventLoop;

// crate-private aliases mirroring Zig's `Index.Int` / `Part.List` /
// `ImportRecord.List` nesting.
pub(crate) mod index {
    pub(crate) use bun_ast::{Index, IndexInt as Int};
}
pub(crate) mod part {
    pub(crate) use bun_ast::{Dependency, PartList as List, symbol::Use as SymbolUse};
}
pub(crate) mod import_record {
    pub(crate) use bun_ast::import_record::List;
}
