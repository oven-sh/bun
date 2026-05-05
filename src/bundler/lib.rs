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
#[cfg(any())]
pub mod OutputFile;
#[cfg(any())]
pub mod cache;
#[cfg(any())]
pub mod ThreadPool;
pub mod entry_points;
#[cfg(any())]
pub mod AstBuilder;
pub mod analyze_transpiled_module;
#[cfg(any())]
pub mod linker;
#[cfg(any())]
pub mod defines;
#[cfg(any())]
pub mod barrel_imports;
#[cfg(any())]
pub mod LinkerGraph;
#[cfg(any())]
pub mod Chunk;
#[path = "defines-table.rs"]
pub mod defines_table;
#[cfg(any())]
pub mod transpiler;
#[cfg(any())]
pub mod ParseTask;
#[cfg(any())]
pub mod options;
#[cfg(any())]
pub mod LinkerContext;
#[cfg(any())]
pub mod bundle_v2;

// ---------------------------------------------------------------------------
// Minimal stub surface for downstream crates (B-1). Opaque newtypes + todo!()
// bodies; real impls live in the gated modules above and will be un-gated in
// B-2.
// ---------------------------------------------------------------------------

/// Stub: see gated `bundle_v2` module.
pub struct BundleV2(());
/// Stub: see gated `transpiler` module.
pub struct Transpiler(());
/// Stub: see gated `options` module.
pub struct BundleOptions(());
/// Stub: see gated `OutputFile` module.
pub struct OutputFile(());
/// Stub: see gated `Chunk` module.
pub struct Chunk(());
/// Stub: see gated `LinkerContext` module.
pub struct LinkerContext(());
/// Stub: see gated `LinkerGraph` module.
pub struct LinkerGraph(());
pub use Graph::Graph as GraphStruct;
/// Stub: see gated `ParseTask` module.
pub struct ParseTask(());
/// Stub: see gated `entry_points` module.
pub struct EntryPoint(());
/// Stub: see gated `defines` module.
pub struct Define(());
/// Stub: see gated `cache` module.
pub struct Cache(());
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

// Re-export stub modules under their original names so `bun_bundler::options::X`
// style paths resolve to *something* during B-1.
pub mod options {
    pub use super::BundleOptions;
    pub type Options = super::BundleOptions;
    // Type-only enums live in `bun_options_types` (lower tier); re-export here so
    // intra-crate `crate::options::Loader` paths resolve while the full `options`
    // module remains gated.
    pub use bun_options_types::BundleEnums::{Loader, LoaderHashTable, Target};
    pub use bun_options_types::schema::api::DotEnvBehavior as EnvBehavior;
    pub use super::OutputFile;
    pub use super::output_file::Value as OutputValue;
    pub use super::output_file::Value as OutputFileValue;

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
    /// lives in a higher-tier crate; opaque placeholder until bake types move
    /// in.
    #[derive(Default)]
    pub struct Framework(());

    pub mod jsx {
        /// `api.JsxRuntime` (schema.zig:771). Defined locally — peechy codegen
        /// hasn't emitted it into `bun_options_types::schema` yet.
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
        pub enum Runtime {
            #[default]
            Automatic,
            Classic,
            Solid,
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
pub mod transpiler {
    pub use super::Transpiler;
    /// Stub: plugin runner placeholder.
    pub struct PluginRunner(());
}
pub mod bundle_v2 {
    pub use super::BundleV2;
    pub use super::ParseTask;
    pub use super::options::Loader;
    /// Stub: see gated `BundleThread` module (`BundleThread.zig` — owns the
    /// worker pool + completion queue for `BundleV2`).
    pub struct BundleThread(());
}

/// `OutputFile.zig` payload union — exported separately because dependents
/// (`bundler_jsc::output_file_jsc`, `standalone_graph`) reach for the value
/// enum directly.
pub mod output_file {
    pub use super::OutputFile;
    /// Re-export under the name dependents use (`OutputFileValue`).
    pub use self::Value as OutputFileValue;

    /// `OutputFile.zig:FileOperation` — minimal field set referenced by
    /// `Value::Move`/`Value::Copy`. `fd`/`dir` are stored as raw ints to avoid
    /// pulling `bun_sys::FD` (still stabilising) into the type surface.
    #[derive(Default)]
    pub struct FileOperation {
        pub pathname: Box<[u8]>,
        pub fd: i32,
        pub dir: i32,
        pub is_tmpdir: bool,
        pub is_outdir: bool,
        pub close_handle_on_complete: bool,
        pub autowatch: bool,
    }

    /// `OutputFile.zig:SavedFile`.
    #[derive(Default)]
    pub struct SavedFile {
        pub byte_size: u64,
    }

    /// `OutputFile.zig` `Value = union(enum)`. `Pending(resolver::Result)` is
    /// represented opaquely — `bun_resolver` is a *dependent* of this crate, so
    /// the concrete type would create a cycle.
    pub enum Value {
        Move(FileOperation),
        Copy(FileOperation),
        Noop,
        Buffer { bytes: Box<[u8]> },
        // TODO(b2): real payload is `bun_resolver::Result`; resolver depends on
        // bundler so this stays opaque until the type moves to a leaf crate.
        Pending(()),
        Saved(SavedFile),
    }

    impl Value {
        pub fn as_slice(&self) -> &[u8] {
            match self {
                Value::Buffer { bytes } => bytes,
                _ => b"",
            }
        }
    }
}

/// `cache.zig` — JSON/CSS/JS parse caches. Opaque placeholders until the gated
/// `cache` module compiles (blocked on `bun_js_parser` AST surface).
pub mod cache {
    /// `cache.zig:Json` — wraps `JSON.parse` with a per-source LRU.
    #[derive(Default)]
    pub struct Json(());
    /// `cache.zig:Set` — bundle of `Fs`/`Json`/`JavaScript`/`Css` caches.
    #[derive(Default)]
    pub struct Set(());
}
