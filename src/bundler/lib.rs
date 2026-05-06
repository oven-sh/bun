#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all Phase-A draft modules are gated behind `#[cfg(any())]`
// so the crate compiles. Draft bodies are preserved on disk; un-gating happens
// in B-2 as lower-tier crate surfaces solidify.

pub mod IndexStringMap;
pub mod PathToSourceIndexMap;
pub mod DeferredBatchTask;
pub mod Graph;
#[cfg(any())]
pub mod BundleThread;
#[cfg(any())]
pub mod ServerComponentParseTask;
#[cfg(any())]
pub mod HTMLImportManifest;
#[cfg(any())]
pub mod HTMLScanner;
#[path = "OutputFile.rs"]
pub mod output_file;
pub mod cache;
#[cfg(any())]
pub mod ThreadPool;
pub mod entry_points;
#[cfg(any())]
pub mod AstBuilder;
pub mod analyze_transpiled_module;
#[cfg(any())]
pub mod linker;
pub mod defines;
pub mod barrel_imports;
#[cfg(any())]
pub mod LinkerGraph;
#[path = "Chunk.rs"]
pub mod chunk;
#[path = "defines-table.rs"]
pub mod defines_table;
pub mod transpiler;
#[path = "ParseTask.rs"]
pub mod parse_task;
#[path = "options.rs"]
pub mod options_impl;
#[path = "LinkerContext.rs"]
pub mod linker_context_mod;
pub mod bundle_v2;

// ---------------------------------------------------------------------------
// Minimal stub surface for downstream crates (B-1). Opaque newtypes + todo!()
// bodies; real impls live in the gated modules above and will be un-gated in
// B-2.
// ---------------------------------------------------------------------------

/// Real `BundleV2` (un-gated B-2). See `bundle_v2`.
pub use bundle_v2::BundleV2;
/// Real `Transpiler` (un-gated B-2). See `transpiler`.
pub use transpiler::Transpiler;
/// Real `BundleOptions` (un-gated B-2). See `options_impl`.
pub use options_impl::BundleOptions;
pub use output_file::OutputFile;
/// Real `Chunk` (un-gated B-2). See `chunk` module.
pub use chunk::Chunk;
/// Real `LinkerContext` (un-gated B-2). See `linker_context_mod` module.
pub use linker_context_mod::LinkerContext;
/// Stub: see gated `linker` module — `Transpiler.linker` field placeholder.
pub struct Linker(());
/// Stub: see gated `LinkerGraph` module.
pub struct LinkerGraph(());
pub use Graph::Graph as GraphStruct;
/// Real `ParseTask` (un-gated B-2). See `parse_task` module.
pub use parse_task::ParseTask;
/// Stub: see gated `entry_points` module.
pub struct EntryPoint(());
pub use defines::Define;
/// Stub: see gated `ThreadPool` module.
pub struct ThreadPool(());
/// Stub: defined in gated `bundle_v2` module (`bundle_v2.zig:AdditionalFile`).
pub enum AdditionalFile {
    SourceIndex(u32),
    OutputFile(u32),
}

/// `bun.ast.Index` — source-index newtype. Lives in `bun_options_types` (lower
/// tier) and is re-exported here because every `*.zig` in this crate aliases it
/// as `pub const Index = bun.ast.Index`.
pub use bun_options_types::BundleEnums::{Index, IndexInt};

// Re-export the real `options` module (un-gated B-2). Downstream crates that
// were compiled against the B-1 stub aliases (Loader/Target re-exported from
// `bun_options_types::BundleEnums`) keep those names; the file-backed
// `options_impl` module supplies the rest. The two `Loader`/`Target` enums are
// structurally identical — Phase B-3 collapses them once all callers move.
pub mod options {
    pub use super::options_impl::*;
    // PORT NOTE: shadow the file-backed Loader/Target with the lower-tier
    // `bun_options_types::BundleEnums` defs so downstream crates that already
    // depend on those exact types (via bun_options_types) keep compiling. The
    // file-backed defs are still reachable as `crate::options_impl::Loader` for
    // intra-crate use.
    pub use bun_options_types::BundleEnums::{Loader, LoaderHashTable, Target};
    pub use bun_options_types::schema::api::DotEnvBehavior as EnvBehavior;
    pub use super::OutputFile;
    pub use super::output_file::Value as OutputValue;
    pub use super::output_file::Value as OutputFileValue;
    pub type Options<'a> = super::BundleOptions<'a>;

    /// `jsc.API.BuildArtifact.OutputKind` (JSBundler.zig:1799). Re-exported by
    /// `options.zig` callers via `OutputFile.output_kind`.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum OutputKind {
        Chunk,
        Asset,
        EntryPoint,
        Sourcemap,
        Bytecode,
        ModuleInfo,
        MetafileJson,
        MetafileMarkdown,
    }

    impl OutputKind {
        /// JSBundler.zig:1809.
        pub fn is_file_in_standalone_mode(self) -> bool {
            !matches!(
                self,
                OutputKind::Sourcemap
                    | OutputKind::Bytecode
                    | OutputKind::ModuleInfo
                    | OutputKind::MetafileJson
                    | OutputKind::MetafileMarkdown
            )
        }
    }

    /// `bun.bake.Side` (bake.zig:874) — which graph an output belongs to.
    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Side {
        Client = 0,
        Server = 1,
    }

    /// `options.zig:2198`. Minimal real def — methods that pull in
    /// `api::StringMap`/`EnvConfig` stay gated until peechy codegen lands.
    #[derive(Clone, Default)]
    pub struct Env {
        pub behavior: EnvBehavior,
        pub prefix: Box<[u8]>,
        // Zig: `std.MultiArrayList(Entry)`. `Vec` for now —
        // `bun_collections::MultiArrayList` is not `Clone` and downstream
        // (`resolver/package_json.rs`) needs `Env: Clone`.
        pub defaults: Vec<EnvEntry>,
        /// List of explicit env files to load (e.g. specified by --env-file args)
        pub files: Box<[Box<[u8]>]>,
        /// If true, disable loading of default .env files (from --no-env-file
        /// flag or bunfig).
        pub disable_default_env_files: bool,
    }

    #[derive(Clone, Default)]
    pub struct EnvEntry {
        pub key: Box<[u8]>,
        pub value: Box<[u8]>,
    }
    /// Name used by `resolver/package_json.rs::load_define_defaults`.
    pub type EnvDefault = EnvEntry;

    impl Env {
        /// `options.zig:Env.init` — allocator argument dropped (global mimalloc).
        pub fn init() -> Env {
            Env::default()
        }

        /// `options.zig:Env.setBehaviorFromPrefix`.
        pub fn set_behavior_from_prefix(&mut self, prefix: &[u8]) {
            self.behavior = EnvBehavior::disable;
            self.prefix = Box::default();
            if prefix == b"*" {
                self.behavior = EnvBehavior::load_all;
            } else if !prefix.is_empty() {
                self.behavior = EnvBehavior::prefix;
                self.prefix = Box::from(prefix);
            }
        }
    }

    /// `options.zig:2388`.
    #[derive(Clone, Default)]
    pub struct RouteConfig {
        pub dir: Box<[u8]>,
        pub possible_dirs: Box<[Box<[u8]>]>,
        /// Frameworks like Next.js (and others) use a special prefix for
        /// bundled/transpiled assets. This is combined with "origin" when
        /// printing import paths.
        pub asset_prefix_path: Box<[u8]>,
        pub extensions: Box<[Box<[u8]>]>,
        pub routes_enabled: bool,
        pub static_dir: Box<[u8]>,
        pub static_dir_enabled: bool,
    }

    impl RouteConfig {
        pub const DEFAULT_DIR: &'static [u8] = b"pages";
        pub const DEFAULT_STATIC_DIR: &'static [u8] = b"public";
        pub const DEFAULT_EXTENSIONS: &'static [&'static [u8]] =
            &[b"tsx", b"ts", b"mjs", b"jsx", b"js"];

        #[inline]
        pub fn zero() -> RouteConfig {
            RouteConfig {
                dir: Box::from(Self::DEFAULT_DIR),
                extensions: Self::DEFAULT_EXTENSIONS
                    .iter()
                    .map(|s| Box::<[u8]>::from(*s))
                    .collect(),
                static_dir: Box::from(Self::DEFAULT_STATIC_DIR),
                routes_enabled: false,
                ..Default::default()
            }
        }
    }

    /// Legacy `options::Framework` (referenced by `resolver/package_json.zig`'s
    /// `FrameworkRouterPair`). The full struct is `bun.bake.Framework` which
    /// lives in a higher-tier crate; minimal real struct lives in `bake_types`.
    pub use crate::bake_types::Framework;

    pub mod jsx {
        /// `api.JsxRuntime` (schema.zig:771). Defined locally — peechy codegen
        /// hasn't emitted it into `bun_options_types::schema` yet.
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum Runtime {
            #[allow(non_camel_case_types)]
            _None = 0,
            Automatic = 1,
            Classic = 2,
            Solid = 3,
        }

        impl Default for Runtime {
            fn default() -> Self {
                Runtime::Automatic
            }
        }

        #[derive(Clone, Copy, Debug)]
        pub struct RuntimeDevelopmentPair {
            pub runtime: Runtime,
            pub development: Option<bool>,
        }

        pub static RUNTIME_MAP: phf::Map<&'static [u8], RuntimeDevelopmentPair> = phf::phf_map! {
            b"classic" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
            b"automatic" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
            b"react" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
            b"react-jsx" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
            b"react-jsxdev" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
        };

        #[derive(Clone, Debug)]
        pub struct ImportSource {
            pub development: Box<[u8]>,
            pub production: Box<[u8]>,
        }

        impl Default for ImportSource {
            fn default() -> Self {
                ImportSource {
                    development: Box::from(defaults::IMPORT_SOURCE_DEV),
                    production: Box::from(defaults::IMPORT_SOURCE),
                }
            }
        }

        /// `options.zig:JSX.Pragma`. Field-compatible subset; methods that
        /// allocate (`member_list_to_components_if_different`, `from_api`) stay
        /// gated until ownership of `factory`/`fragment` is restructured.
        #[derive(Clone, Debug)]
        pub struct Pragma {
            pub factory: &'static [&'static [u8]],
            pub fragment: &'static [&'static [u8]],
            pub runtime: Runtime,
            pub import_source: ImportSource,
            /// Facilitates automatic JSX importing.
            /// Set on a per file basis like this:
            /// /** @jsxImportSource @emotion/core */
            pub classic_import_source: Box<[u8]>,
            pub package_name: Box<[u8]>,
            /// Configuration Priority:
            /// - `--define=process.env.NODE_ENV=...`
            /// - `NODE_ENV=...`
            /// - tsconfig.json's `compilerOptions.jsx` (`react-jsx` or `react-jsxdev`)
            pub development: bool,
            pub parse: bool,
            pub side_effects: bool,
        }

        impl Default for Pragma {
            fn default() -> Self {
                Pragma {
                    factory: defaults::FACTORY,
                    fragment: defaults::FRAGMENT,
                    runtime: Runtime::Automatic,
                    import_source: ImportSource::default(),
                    classic_import_source: Box::from(b"react".as_slice()),
                    package_name: Box::from(b"react".as_slice()),
                    development: true,
                    parse: true,
                    side_effects: false,
                }
            }
        }

        impl Pragma {
            /// `options.zig:JSX.Pragma.parsePackageName` — extracts the npm
            /// package name from a path-like string (handles `@scope/pkg/sub`).
            pub fn parse_package_name(str: &[u8]) -> &[u8] {
                if str.is_empty() {
                    return str;
                }
                if str[0] == b'@' {
                    if let Some(first_slash) = str[1..].iter().position(|&b| b == b'/') {
                        let remainder = &str[1 + first_slash + 1..];
                        if let Some(last_slash) = remainder.iter().position(|&b| b == b'/') {
                            return &str[0..first_slash + 1 + last_slash + 1];
                        }
                    }
                }
                if let Some(first_slash) = str.iter().position(|&b| b == b'/') {
                    return &str[0..first_slash];
                }
                str
            }

            pub fn set_production(&mut self, is_production: bool) {
                self.development = !is_production;
            }

            pub fn set_import_source(&mut self) {
                let mut dev = Vec::with_capacity(self.package_name.len() + b"/jsx-dev-runtime".len());
                dev.extend_from_slice(&self.package_name);
                dev.extend_from_slice(b"/jsx-dev-runtime");
                self.import_source.development = dev.into_boxed_slice();

                let mut prod = Vec::with_capacity(self.package_name.len() + b"/jsx-runtime".len());
                prod.extend_from_slice(&self.package_name);
                prod.extend_from_slice(b"/jsx-runtime");
                self.import_source.production = prod.into_boxed_slice();
            }
        }

        pub mod defaults {
            pub const FACTORY: &[&[u8]] = &[b"React", b"createElement"];
            pub const FRAGMENT: &[&[u8]] = &[b"React", b"Fragment"];
            pub const IMPORT_SOURCE_DEV: &[u8] = b"react/jsx-dev-runtime";
            pub const IMPORT_SOURCE: &[u8] = b"react/jsx-runtime";
            pub const JSX_FUNCTION: &[u8] = b"jsx";
            pub const JSX_STATIC_FUNCTION: &[u8] = b"jsxs";
            pub const JSX_FUNCTION_DEV: &[u8] = b"jsxDEV";
        }
        /// Alias for downstream `options::jsx::pragma::Defaults::FACTORY`-style
        /// paths (Zig namespaced consts under `Pragma.Defaults`).
        pub mod pragma {
            pub use super::defaults as Defaults;
        }
    }
    pub use jsx as JSX;
}

pub use cache::Set as Cache;

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK(b0) TYPE_ONLY: pure value types from bake that bundler needs
// without depending on bun_runtime::bake (T6). Extracted from the gated
// `bundle_v2.rs::bake_types` so `options.rs` / `LinkerContext.rs` resolve
// `crate::bake_types::*`. The full set (HmrRuntime, EntryPointMap, virtual
// sources) stays gated until bun_logger::Source / OUT_DIR codegen are real.
// ──────────────────────────────────────────────────────────────────────────
pub mod bake_types {
    /// Mirrors src/bake/lib.zig `Side`.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Side {
        Client = 0,
        Server = 1,
    }
    /// Mirrors src/bake/lib.zig `Graph`.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Graph {
        Client = 0,
        Server = 1,
        Ssr = 2,
    }
    impl Side {
        pub fn graph(self) -> Graph {
            match self {
                Side::Client => Graph::Client,
                Side::Server => Graph::Server,
            }
        }
    }
    /// Mirrors src/bake/DevServer.zig `FileKind`.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum CacheKind {
        Unknown = 0,
        Js = 1,
        Asset = 2,
        Css = 3,
    }
    #[derive(Copy, Clone)]
    pub struct CacheEntry {
        pub kind: CacheKind,
    }
    /// Mirrors src/bake/DevServer.zig `ASSET_PREFIX`.
    pub const ASSET_PREFIX: &str = "/_bun/asset";
    pub const DEV_SERVER_ASSET_PREFIX: &str = ASSET_PREFIX;

    /// Mirrors src/bake/bake.zig:355 `BuiltInModule`.
    pub enum BuiltInModule {
        Import(Box<[u8]>),
        Code(Box<[u8]>),
    }

    /// Mirrors src/bake/bake.zig `Framework` — only the field bundler reads
    /// (`built_in_modules`). Remaining fields are opaque until tier-6 collapse.
    pub struct Framework {
        pub built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
        // TODO(b0-genuine): remaining Framework fields (server_components,
        // react_fast_refresh, file_system_router_types, ...) — bake constructs.
        _opaque_tail: (),
    }

    /// Alias used at the crate root (`crate::HmrRuntimeSide`); identical to `Side`.
    pub type HmrRuntimeSide = Side;
}

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK(b0) §Dispatch: erased DevServer handle. Extracted from the gated
// `bundle_v2.rs::dispatch` so `LinkerContext.rs` / `barrel_imports.rs` /
// `options.rs` resolve `crate::dispatch::DevServerHandle`. PERF(port): was
// inline switch in Zig.
// ──────────────────────────────────────────────────────────────────────────
pub mod dispatch {
    /// Erased handle to bake::DevServer.
    #[derive(Clone, Copy)]
    pub struct DevServerHandle {
        pub owner: *mut (),
        pub vtable: &'static DevServerVTable,
    }
    pub struct DevServerVTable {
        /// `dev.isFileCached(abs_path, side)` — DevServer.zig:2128.
        pub is_file_cached:
            unsafe fn(*mut (), &[u8], super::bake_types::Side) -> Option<super::bake_types::CacheEntry>,
        /// `dev.allocator().dupe(u8, ..)` — DevServer-owned bump for barrel keys.
        /// Returns an owned `Box<[u8]>` (caller stores it in the barrel map);
        /// previously `&'static [u8]` via `Box::leak`, which leaked on every
        /// incremental rebuild.
        pub dupe: unsafe fn(*mut (), &[u8]) -> Box<[u8]>,
        /// `dev.barrel_needed_exports.getOrPut(path)` etc. Opaque body lives in
        /// bun_runtime; bundler only registers.
        pub register_barrel_export: unsafe fn(*mut (), &[u8], &[u8]),
        // ── full slot set (finalize_bundle, handle_parse_task_failure,
        //    put_or_overwrite_asset, …) stays in the gated bundle_v2.rs draft
        //    until BundleV2/DevServerOutput types are real here.
    }
    impl DevServerHandle {
        #[inline]
        pub fn is_file_cached(
            &self,
            abs_path: &[u8],
            side: super::bake_types::Side,
        ) -> Option<super::bake_types::CacheEntry> {
            // SAFETY: owner is a live *mut DevServer per handle invariant.
            unsafe { (self.vtable.is_file_cached)(self.owner, abs_path, side) }
        }
    }
}
