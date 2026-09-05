//! Option/config structs shared by the CLI, bunfig, bundler and runtime
//! (`TransformOptions`, `BunInstall`, …).

pub mod api {
    /// Canonical definition lives in bun_dotenv (lower tier).
    pub use bun_dotenv::DotEnvBehavior;

    #[repr(u32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum MessageLevel {
        #[default]
        _none = 0,
        Err = 1,
        Warn = 2,
        Note = 3,
        Info = 4,
        Debug = 5,
    }

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum UnhandledRejections {
        Strict = 0,
        Throw = 1,
        Warn = 2,
        None = 3,
        WarnWithErrorCode = 4,
        #[default]
        Bun = 5,
    }

    bun_core::comptime_string_map! {
        #[doc(hidden)]
        pub static UNHANDLED_REJECTIONS_MAP: UnhandledRejections = {
            b"strict" => UnhandledRejections::Strict,
            b"throw" => UnhandledRejections::Throw,
            b"warn" => UnhandledRejections::Warn,
            b"none" => UnhandledRejections::None,
            b"warn-with-error-code" => UnhandledRejections::WarnWithErrorCode,
        };
    }

    impl UnhandledRejections {
        /// `UnhandledRejections.map` — `bun.ComptimeStringMap`.
        /// Note: deliberately omits `"bun"` (it's the implicit default).
        pub const MAP: __ComptimeStringMap_UNHANDLED_REJECTIONS_MAP =
            __ComptimeStringMap_UNHANDLED_REJECTIONS_MAP(());
    }

    /// The CLI/bunfig-populated option bag that `BundleOptions::from_api`
    /// projects into bundler options.
    ///
    /// `Default` is all-zero: every Option `None`, every slice empty, every
    /// scalar `0`/`false`.
    ///
    /// LIFECYCLE: `BundleOptions::from_api` parks this in an `Arc` whose final ref
    /// lives on the process-lifetime `Transpiler` (LSan-rooted in build_command.rs).
    #[derive(Clone, Debug, Default)]
    pub struct TransformOptions {
        /// jsx
        pub jsx: Option<Jsx>,
        /// tsconfig_override
        pub tsconfig_override: Option<Box<[u8]>>,
        /// origin
        pub origin: Option<Box<[u8]>>,
        /// absolute_working_dir
        pub absolute_working_dir: Option<Box<[u8]>>,
        /// define
        pub define: Option<StringMap>,
        /// drop
        pub drop: Vec<Box<[u8]>>,
        /// feature_flags — DCE via `import { feature } from "bun:bundle"`
        pub feature_flags: Vec<Box<[u8]>>,
        /// preserve_symlinks
        pub preserve_symlinks: Option<bool>,
        /// entry_points
        pub entry_points: Vec<Box<[u8]>>,
        /// write
        pub write: Option<bool>,
        /// inject
        pub inject: Vec<Box<[u8]>>,
        /// output_dir
        pub output_dir: Option<Box<[u8]>>,
        /// external
        pub external: Vec<Box<[u8]>>,
        /// loaders
        pub loaders: Option<LoaderMap>,
        /// main_fields
        pub main_fields: Vec<Box<[u8]>>,
        /// target
        pub target: Option<Target>,
        /// serve
        pub serve: Option<bool>,
        /// env_files
        pub env_files: Vec<Box<[u8]>>,
        /// disable_default_env_files
        pub disable_default_env_files: bool,
        /// extension_order
        pub extension_order: Vec<Box<[u8]>>,
        /// no_summary
        pub no_summary: Option<bool>,
        /// disable_hmr
        pub disable_hmr: bool,
        /// port
        pub port: Option<u16>,
        /// logLevel
        pub log_level: Option<MessageLevel>,
        /// source_map
        pub source_map: Option<SourceMapMode>,
        /// conditions
        pub conditions: Vec<Box<[u8]>>,
        /// packages
        pub packages: Option<PackagesMode>,
        /// ignore_dce_annotations
        pub ignore_dce_annotations: bool,

        /// e.g. `[serve.static] plugins = ["tailwindcss"]`
        pub serve_plugins: Option<Vec<Box<[u8]>>>,
        pub serve_minify_syntax: Option<bool>,
        pub serve_minify_whitespace: Option<bool>,
        pub serve_minify_identifiers: Option<bool>,
        pub serve_env_behavior: DotEnvBehavior,
        pub serve_env_prefix: Option<Box<[u8]>>,
        pub serve_splitting: bool,
        pub serve_public_path: Option<Box<[u8]>>,
        pub serve_hmr: Option<bool>,
        pub serve_define: Option<StringMap>,
        pub serve_sourcemap: Option<SourceMapMode>,

        /// from `--no-addons`. `None` == `true`.
        pub allow_addons: Option<bool>,
        /// from `--no-ffi-cc`. `None` == `true`.
        pub allow_ffi_cc: Option<bool>,
        /// from `--unhandled-rejections`; default is `Bun`.
        pub unhandled_rejections: Option<UnhandledRejections>,

        pub bunfig_path: Box<[u8]>,
    }

    // ─── BunInstall + supporting types ───────────────────────────────────────

    /// `Default` is empty slices.
    #[derive(Clone, Debug, Default)]
    pub struct NpmRegistry {
        /// url
        pub url: Box<[u8]>,
        /// username
        pub username: Box<[u8]>,
        /// password
        pub password: Box<[u8]>,
        /// token
        pub token: Box<[u8]>,
        /// email
        pub email: Box<[u8]>,
    }

    impl NpmRegistry {
        pub fn from_url(str: &[u8]) -> NpmRegistry {
            let url = bun_url::URL::parse(str);
            let mut registry = NpmRegistry::default();

            if url.username.is_empty() && !url.password.is_empty() {
                registry.token = Box::from(url.password);
                registry.url = url.href_without_auth();
            } else if !url.username.is_empty() && !url.password.is_empty() {
                registry.username = Box::from(url.username);
                registry.password = Box::from(url.password);
                registry.url = url.href_without_auth();
            } else {
                // Do not include a trailing slash. There might be parameters at the end.
                registry.url = Box::from(url.href);
            }

            registry
        }

        pub fn has_credentials(&self) -> bool {
            !self.token.is_empty() || !self.username.is_empty() || !self.password.is_empty()
        }
    }

    /// Per-scope npm registry overrides, keyed by scope name.
    #[derive(Default)]
    pub struct NpmRegistryMap {
        pub scopes: bun_collections::StringArrayHashMap<NpmRegistry>,
    }

    /// Value of `BunInstall.ca`; hoisted to a named type so callers can
    /// construct it.
    #[derive(Clone, Debug)]
    pub enum Ca {
        Str(Box<[u8]>),
        List(Box<[Box<[u8]>]>),
    }

    /// `NodeLinker` / `PnpmMatcher` are canonical in `bun_install_types`
    /// (lower crate). Re-export so `BunInstall.node_linker` /
    /// `BunInstall.hoist_pattern` and `bun_ini`'s callers all name the
    /// same type.
    pub use bun_install_types::NodeLinker::{NodeLinker, PnpmMatcher};
    /// Parsed `packageExtensions` entries; canonical in `bun_install_types`.
    pub use bun_install_types::PackageExtensions::PackageExtension;

    /// Full field set.
    /// `Default` is every field `None`/empty.
    ///
    /// No `Debug`/`Clone` derive: `NpmRegistryMap` wraps `StringArrayHashMap`
    /// which currently provides neither.
    #[derive(Default)]
    pub struct BunInstall {
        /// default_registry
        pub default_registry: Option<NpmRegistry>,
        /// scoped
        pub scoped: Option<NpmRegistryMap>,
        /// lockfile_path
        pub lockfile_path: Option<Box<[u8]>>,
        /// save_lockfile_path
        pub save_lockfile_path: Option<Box<[u8]>>,
        /// cache_directory
        pub cache_directory: Option<Box<[u8]>>,
        /// dry_run
        pub dry_run: Option<bool>,
        /// force
        pub force: Option<bool>,
        /// save_dev
        pub save_dev: Option<bool>,
        /// save_optional
        pub save_optional: Option<bool>,
        /// save_peer
        pub save_peer: Option<bool>,
        /// save_lockfile
        pub save_lockfile: Option<bool>,
        /// production
        pub production: Option<bool>,
        /// save_yarn_lockfile
        pub save_yarn_lockfile: Option<bool>,
        /// disable_cache
        pub disable_cache: Option<bool>,
        /// disable_manifest_cache
        pub disable_manifest_cache: Option<bool>,
        /// global_dir
        pub global_dir: Option<Box<[u8]>>,
        /// global_bin_dir
        pub global_bin_dir: Option<Box<[u8]>>,
        /// frozen_lockfile
        pub frozen_lockfile: Option<bool>,
        /// exact
        pub exact: Option<bool>,
        /// concurrent_scripts
        pub concurrent_scripts: Option<u32>,

        pub cafile: Option<Box<[u8]>>,
        pub save_text_lockfile: Option<bool>,
        pub ca: Option<Ca>,
        pub ignore_scripts: Option<bool>,
        pub link_workspace_packages: Option<bool>,
        pub node_linker: Option<NodeLinker>,
        pub global_store: Option<bool>,
        pub security_scanner: Option<Box<[u8]>>,
        pub minimum_release_age_ms: Option<f64>,
        pub minimum_release_age_excludes: Option<Vec<Box<[u8]>>>,
        pub public_hoist_pattern: Option<PnpmMatcher>,
        pub hoist_pattern: Option<PnpmMatcher>,
        pub hoist: Option<bool>,
        /// `offline = true`: `bun install` never touches the network.
        pub offline: Option<bool>,
        /// `[install.packageExtensions."<name>@<range>"]`
        pub package_extensions: Option<Vec<PackageExtension>>,
    }

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum SourceMapMode {
        #[default]
        None,
        Inline,
        External,
        Linked,
    }

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum Target {
        #[default]
        _none = 0,
        browser = 1,
        node = 2,
        bun = 3,
        bun_macro = 4,
    }

    impl Target {
        // PascalCase aliases — `runtime/cli/Arguments.rs` writes
        // `api::Target::Bun` while the enum body keeps the snake_case tags
        // that `bundle_enums.rs` matches on.
        pub const Browser: Self = Self::browser;
        pub const Node: Self = Self::node;
        pub const Bun: Self = Self::bun;
        pub const BunMacro: Self = Self::bun_macro;
    }

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum Loader {
        #[default]
        _none = 254,
        jsx = 1,
        js = 2,
        ts = 3,
        tsx = 4,
        css = 5,
        file = 6,
        json = 7,
        jsonc = 8,
        toml = 9,
        wasm = 10,
        napi = 11,
        base64 = 12,
        dataurl = 13,
        text = 14,
        bunsh = 15,
        sqlite = 16,
        sqlite_embedded = 17,
        html = 18,
        yaml = 19,
        json5 = 20,
        md = 21,
        xml = 22,
    }

    impl Loader {
        /// Converts a raw discriminant to the schema `Loader`.
        /// Unknown discriminants fall back to `_none`, matching how
        /// `BundleEnums::Loader::from_api` already guards the open tail.
        #[inline]
        pub const fn from_raw(n: u8) -> Loader {
            match n {
                1 => Loader::jsx,
                2 => Loader::js,
                3 => Loader::ts,
                4 => Loader::tsx,
                5 => Loader::css,
                6 => Loader::file,
                7 => Loader::json,
                8 => Loader::jsonc,
                9 => Loader::toml,
                10 => Loader::wasm,
                11 => Loader::napi,
                12 => Loader::base64,
                13 => Loader::dataurl,
                14 => Loader::text,
                15 => Loader::bunsh,
                16 => Loader::sqlite,
                17 => Loader::sqlite_embedded,
                18 => Loader::html,
                19 => Loader::yaml,
                20 => Loader::json5,
                21 => Loader::md,
                22 => Loader::xml,
                _ => Loader::_none,
            }
        }
    }

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum JsxRuntime {
        #[default]
        _none = 0,
        Automatic = 1,
        Classic = 2,
        Solid = 3,
    }

    /// JSX transform configuration (factory, fragment, runtime, …).
    #[derive(Clone, Debug, Default)]
    pub struct Jsx {
        pub factory: Box<[u8]>,
        pub runtime: JsxRuntime,
        pub fragment: Box<[u8]>,
        pub development: bool,
        pub import_source: Box<[u8]>,
        pub side_effects: bool,
    }

    /// Parallel-array string→string map as transmitted on the wire.
    #[derive(Clone, Debug, Default)]
    pub struct StringMap {
        pub keys: Vec<Box<[u8]>>,
        pub values: Vec<Box<[u8]>>,
    }

    impl StringMap {
        pub const EMPTY: StringMap = StringMap {
            keys: Vec::new(),
            values: Vec::new(),
        };
    }

    /// Parallel-array map from file extension to [`Loader`].
    #[derive(Clone, Debug, Default)]
    pub struct LoaderMap {
        pub extensions: Vec<Box<[u8]>>,
        pub loaders: Vec<Loader>,
    }

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum PackagesMode {
        #[default]
        Bundle = 0,
        External = 1,
    }
}
