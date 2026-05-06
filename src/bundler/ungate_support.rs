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
pub use bun_perf as perf;

/// Type-surface shim for `bun_css` as seen by the bundler. The real crate's
/// `BundlerStyleSheet` is itself gated (`css_parser.rs: #[cfg(any())]`) and
/// several types carry a `'bump` lifetime that `Chunk`/`ParseTask` don't yet
/// thread, so this module is the canonical bundler-facing surface for now —
/// it re-exports real types where they exist (under `feature = "css"`) and
/// stubs the rest. Once `Chunk` gains a `'bump` lifetime and `bun_css`
/// un-gates `BundlerStyleSheet`, this collapses to a plain `pub use ::bun_css`.
pub mod bun_css {
    use bun_collections::BabyList;

    #[cfg(feature = "css")]
    pub use ::bun_css::*;

    /// `css::BundlerStyleSheet` — arena-backed stylesheet AST. The real type
    /// is `StyleSheet<BundlerAtRule>` (gated in `css_parser.rs`).
    pub struct BundlerStyleSheet(());
    impl BundlerStyleSheet {
        pub fn empty(_bump: &bun_alloc::Arena) -> Self {
            Self(())
        }
        pub fn parse_bundler(
            _bump: &bun_alloc::Arena,
            _src: &[u8],
            _opts: ParserOptions,
            _idx: u32,
        ) -> Result<(Self, StylesheetExtra), ()> {
            todo!("b2-blocked: bun_css::BundlerStyleSheet (gated upstream)")
        }
        pub fn minify(
            &mut self,
            _bump: &bun_alloc::Arena,
            _opts: MinifyOptions,
            _extra: &mut StylesheetExtra,
        ) -> Result<(), ()> {
            todo!("b2-blocked: bun_css shim")
        }
    }
    #[derive(Default)]
    pub struct StylesheetExtra(());
    pub struct ParserOptions {
        pub css_modules: Option<CssModuleConfig>,
    }
    impl ParserOptions {
        pub fn default(_bump: &bun_alloc::Arena, _log: &mut bun_logger::Log) -> Self {
            Self { css_modules: None }
        }
    }
    #[derive(Default)]
    pub struct CssModuleConfig;
    #[derive(Default)]
    pub struct MinifyOptions {
        pub targets: Targets,
        pub unused_symbols: (),
    }
    #[cfg(not(feature = "css"))]
    #[derive(Default, Clone, Copy)]
    pub struct Targets;
    #[cfg(not(feature = "css"))]
    impl Targets {
        pub fn for_bundler_target(_t: crate::options::Target) -> Self {
            Self
        }
    }
    #[cfg(not(feature = "css"))]
    #[derive(Clone)]
    pub struct ImportConditions(());
    /// Lifetime-erased `LayerName` for `Chunk::Layers`. The real
    /// `bun_css::rules::layer::LayerName<'bump>` borrows the arena; until
    /// `Chunk` threads `'bump`, this owns its parts.
    #[derive(Clone)]
    pub struct LayerName {
        pub v: BabyList<Box<[u8]>>,
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
    #[cfg(not(feature = "css"))]
    pub struct PrinterOptions;
    #[cfg(not(feature = "css"))]
    pub struct Printer;
}

// ──────────────────────────────────────────────────────────────────────────
// Value types extracted from `bundle_v2.zig` (gated `__phase_a_draft`).
// ──────────────────────────────────────────────────────────────────────────

/// `bundle_v2.zig:PartRange`.
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

/// `bundle_v2.zig:ImportTracker`.
#[derive(Clone, Copy, Default)]
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
}

/// `bundle_v2.zig:CompileResultForSourceMap`.
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
    /// Owned-erased renamer placeholder for `Chunk.renamer`. The Zig field is
    /// the union `renamer.Renamer` set late (`= undefined`); the Rust enum has
    /// borrowed lifetimes (`Renamer<'r,'src>`) that can't be stored in a
    /// 'static-ish struct yet. TODO(port): thread `'bump` once Chunk gains a
    /// lifetime.
    pub type ChunkRenamer = Option<Box<bun_js_printer::renamer::NumberRenamer>>;
}

/// `HTMLImportManifest` — gated module; minimal callable surface so
/// `Chunk.rs::IntermediateOutput::code` typechecks.
// TODO(b2-blocked): real `HTMLImportManifest.rs` is gated. Call sites in
// `Chunk.rs::code_with_source_map_shifts` are likewise `#[cfg(any())]`-gated
// (PORTING.md §Forbidden: no `unimplemented!()` in live code).
#[cfg(any())]
pub mod html_import_manifest {
    use crate::Graph::Graph;
    use crate::{chunk::Chunk, LinkerGraph};
    pub fn format_escaped_json<'a>(
        _idx: u32,
        _graph: &'a Graph,
        _chunks: &'a [Chunk],
        _linker_graph: &'a LinkerGraph,
    ) -> impl core::fmt::Display + 'a {
        // TODO(b2-blocked): real HTMLImportManifest module is gated.
        struct D;
        impl core::fmt::Display for D {
            fn fmt(&self, _: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                unimplemented!("b2-blocked: HTMLImportManifest")
            }
        }
        D
    }
    pub fn write_escaped_json(
        _idx: u32,
        _graph: &Graph,
        _linker_graph: &LinkerGraph,
        _chunks: &[Chunk],
        _w: &mut &mut [u8],
    ) -> Result<(), core::fmt::Error> {
        unimplemented!("b2-blocked: HTMLImportManifest")
    }
}

/// `HTMLScanner` — gated module; ParseTask only constructs it.
pub mod html_scanner {
    pub struct HTMLScanner;
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
pub use bun_js_parser::BundledAst as JSAst;
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
    pub use super::EntryPoint::Kind;
}
/// Module-namespace twin of the `EntryPoint` struct so `EntryPoint::Kind`
/// resolves. Mirrors `bundle_v2.zig:EntryPoint.Kind`.
#[allow(non_snake_case)]
pub mod EntryPoint {
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
}
pub use js_meta::{
    ExportData, ImportData, JSMeta, JSMetaField, JSMetaListExt, JSMetaSliceExt, RefImportData,
    ResolvedExports, TopLevelSymbolToParts,
};
/// Module-namespace twin of the `JSMeta` struct so `JSMeta::Flags` /
/// `JSMeta::Wrap` resolve.
#[allow(non_snake_case)]
pub mod JSMeta {
    pub use super::js_meta::{Flags, Wrap};
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate surface for `bundle_v2.rs::on_parse_task_complete`.
// `#[derive(MultiArrayElement)]` now emits `InputFileListExt` with the full
// `items_<field>()` / `items_<field>_mut()` set; this alias keeps the old
// `InputFileListExtMut` import in `bundle_v2.rs` resolving without method
// ambiguity (same trait, two names).
// ──────────────────────────────────────────────────────────────────────────
pub use crate::Graph::InputFileListExt as InputFileListExtMut;

/// `bundle_v2.zig` aliased `EventLoop = bun.jsc.AnyEventLoop`; the bundler only
/// stores it on `LinkerContext.loop` (already typed there as
/// `Option<NonNull<()>>` — erased handle) and calls `.tick(...)` from
/// `wait_for_parse`. Re-export the LinkerContext alias so `bundle_v2.rs` and
/// `ParseTask.rs` agree on the spelling.
pub use crate::linker_context_mod::EventLoop;
