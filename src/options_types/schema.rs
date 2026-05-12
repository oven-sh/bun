// GENERATED: re-run peechy (src/api/schema.peechy) with .rs output
// source: src/options_types/schema.zig (3224 lines)
// PORT STATUS: skipped — generated file (see PORTING.md §Don't translate)
//
// B-2: minimal hand-stubbed `api` namespace so Context.rs / BundleEnums.rs
// struct fields type-check. Full body arrives when peechy emits .rs.

/// Port of `schema.Writer(WritableStream)` (schema.zig:169) specialised to a
/// `Vec<u8>` sink — the only instantiation reachable from Rust today
/// (`js_parser::runtime::Base64FallbackMessage::fmt`). The full generic shape
/// arrives with the peechy-generated body.
pub struct Writer<'a> {
    writable: &'a mut Vec<u8>,
}

impl<'a> Writer<'a> {
    #[inline]
    pub fn new(writable: &'a mut Vec<u8>) -> Self {
        Self { writable }
    }
    #[inline]
    pub fn write(&mut self, bytes: &[u8]) {
        self.writable.extend_from_slice(bytes);
    }
    #[inline]
    pub fn write_byte(&mut self, byte: u8) {
        self.writable.push(byte);
    }
    /// Zig: `writeInt` — `std.mem.asBytes(&int)` is native-endian raw bytes.
    #[inline]
    pub fn write_int<I: Copy>(&mut self, int: I) {
        let bytes = unsafe {
            core::slice::from_raw_parts((&raw const int).cast::<u8>(), core::mem::size_of::<I>())
        };
        self.writable.extend_from_slice(bytes);
    }
    #[inline]
    pub fn write_field_id(&mut self, id: u8) {
        self.write_byte(id);
    }
    #[inline]
    pub fn write_enum<E: Copy>(&mut self, val: E) {
        self.write_int(val);
    }
    /// Zig: `writeArray(u8, slice)` — length-prefixed byte slice.
    #[inline]
    pub fn write_array_u8(&mut self, slice: &[u8]) {
        self.write_int(u32::try_from(slice.len()).unwrap());
        self.write(slice);
    }
    #[inline]
    pub fn end_message(&mut self) {
        self.write_byte(0);
    }
}

pub mod api {
    /// schema.zig:1172 — canonical definition lives in bun_dotenv (lower tier).
    pub use bun_dotenv::DotEnvBehavior;

    /// schema.zig:711 — `enum(u8)` (open). Kept closed.
    /// Variants PascalCased to match the only downstream writers
    /// (`jsc/config.rs`, `runtime/cli/Arguments.rs` → `api::ResolveMode::Lazy`).
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum ResolveMode {
        #[default]
        _none = 0,
        Disable = 1,
        Lazy = 2,
        Dev = 3,
        Bundle = 4,
    }

    /// schema.zig:2295 — `enum(u32)` (open). Kept closed.
    /// PascalCased: `bun_ast::Kind::to_api` matches on `Err`/`Warn`/`Note`/`Debug`.
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

    /// schema.zig:1622 — `enum(u8)` (closed; not a peechy `smol`).
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

    impl UnhandledRejections {
        /// `UnhandledRejections.map` — `bun.ComptimeStringMap` → `phf::Map`.
        /// Note: Zig deliberately omits `"bun"` (it's the implicit default).
        pub const MAP: phf::Map<&'static [u8], UnhandledRejections> = phf::phf_map! {
            b"strict" => UnhandledRejections::Strict,
            b"throw" => UnhandledRejections::Throw,
            b"warn" => UnhandledRejections::Warn,
            b"none" => UnhandledRejections::None,
            b"warn-with-error-code" => UnhandledRejections::WarnWithErrorCode,
        };
    }

    /// schema.zig:1639 — peechy `message TransformOptions`. Full field set,
    /// hand-expanded so `bundler::options::BundleOptions::from_api` and the
    /// bunfig/CLI parsers can un-gate. Field order mirrors the Zig struct
    /// exactly so side-by-side diff stays readable.
    ///
    /// Type map (matches the convention block below):
    ///   `?T`                  → `Option<T>`
    ///   `[]const u8`          → `Box<[u8]>`
    ///   `?[]const u8`         → `Option<Box<[u8]>>`
    ///   `[]const []const u8`  → `Vec<Box<[u8]>>`
    ///   `?[:0]const u8`       → `Option<Box<[u8]>>`   (sentinel re-derived
    ///                            at use-site; see Context.rs `// TODO(port):
    ///                            owned ZStr repr` precedent)
    ///
    /// `Default` ⇔ `std.mem.zeroes(TransformOptions)` — every Option `None`,
    /// every slice empty, every scalar `0`/`false`.
    #[derive(Clone, Debug, Default)]
    pub struct TransformOptions {
        /// jsx
        pub jsx: Option<Jsx>,
        /// tsconfig_override
        pub tsconfig_override: Option<Box<[u8]>>,
        /// resolve
        pub resolve: Option<ResolveMode>,
        /// origin
        pub origin: Option<Box<[u8]>>,
        /// absolute_working_dir — Zig `?[:0]const u8`; sentinel dropped (see
        /// type-map note above).
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

        /// from `--no-addons`. `None` == `true`.
        pub allow_addons: Option<bool>,
        /// from `--unhandled-rejections`; default is `Bun`.
        pub unhandled_rejections: Option<UnhandledRejections>,

        pub bunfig_path: Box<[u8]>,
    }

    // ─── BunInstall + supporting types ───────────────────────────────────────

    /// schema.zig:2807 — `api.NpmRegistry`.
    /// `Default` ⇔ `std.mem.zeroes(NpmRegistry)` (empty slices).
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
        /// `NpmRegistry.dupe(allocator)` — Zig packs all five strings into one
        /// contiguous allocation and reslices. Rust can't hand back five
        /// `Box<[u8]>` views into one buffer without leaking, so this is a
        /// plain field-wise clone. PERF(port): single-buffer pack — Phase B.
        #[inline]
        pub fn dupe(&self) -> NpmRegistry {
            self.clone()
        }
    }

    /// schema.zig:2956 — `scopes: bun.StringArrayHashMapUnmanaged(NpmRegistry)`.
    #[derive(Default)]
    pub struct NpmRegistryMap {
        pub scopes: bun_collections::StringArrayHashMap<NpmRegistry>,
    }

    /// schema.zig:3041 — anonymous `?union(enum) { str, list }` field on
    /// `BunInstall.ca`; hoisted to a named type so callers can construct it.
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

    /// schema.zig:2973 — `api.BunInstall`. Full field set, order-faithful.
    /// `Default` ⇔ `std.mem.zeroes(Api.BunInstall)` (every field `None`/empty).
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
        /// native_bin_links
        pub native_bin_links: Vec<Box<[u8]>>,
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
    }

    /// schema.zig:1967 — `enum(u8)` (open). Generated body emits `_` open
    /// variant; Rust side keeps it closed since callers exhaustively match
    /// only the four named tags (see bundler/options.rs `SourceMapOption`).
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum SourceMapMode {
        #[default]
        None,
        Inline,
        External,
        Linked,
    }

    /// schema.zig:732 — `enum(u8)` (open). Kept closed; `BundleEnums::Target::from`
    /// guards the open tail with a `_ => Browser` arm.
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
        // `api::Target::Bun` while the schema enum body keeps the peechy
        // snake_case tags above.
        pub const Browser: Self = Self::browser;
        pub const Node: Self = Self::node;
        pub const Bun: Self = Self::bun;
        pub const BunMacro: Self = Self::bun_macro;
    }

    /// Alias: `runtime/cli/Arguments.rs` spells the schema type both ways.
    pub type SourceMap = SourceMapMode;
    /// Alias: `runtime/cli/Arguments.rs` spells the schema type both ways.
    pub type Packages = PackagesMode;

    /// schema.zig:325 — `enum(u8)` (open), `_none = 254`. Kept closed;
    /// `BundleEnums::Loader::from_api` guards the open tail with `_ => File`.
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
    }

    impl Loader {
        /// Zig `@enumFromInt` for the schema `Loader` (open `enum(u8)` in Zig).
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
                _ => Loader::_none,
            }
        }
    }

    /// schema.zig:2200 — `enum(u8)` (open). Kept closed.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum ImportKind {
        #[default]
        _none = 0,
        entry_point = 1,
        stmt = 2,
        require = 3,
        dynamic = 4,
        require_resolve = 5,
        at = 6,
        url = 7,
        internal = 8,
    }

    // ─── peechy batch 2: hand-expanded for downstream wfs ────────────────
    // Jsx / JsxRuntime / StringMap / EnvConfig / LoadedEnvConfig /
    // LoadedRouteConfig / RouteConfig / FrameworkEntryPoint{,Type,Map,Message} /
    // PackagesMode / CssInJsBehavior / LoaderMap / LoadedFramework.
    //
    // String mapping (matches Context.rs convention — proc-lifetime borrows
    // ported as owned heap):
    //   `[]const u8`          → `Box<[u8]>`
    //   `[]const []const u8`  → `Vec<Box<[u8]>>`  (or `Box<[Box<[u8]>]>` where
    //                            downstream `.clone()` target requires it)
    //
    // Enum variant names are PascalCase (idiomatic Rust, matches downstream
    // callers in bundler/options.rs + router/lib.rs); `_none` retained as the
    // zero-tag default where the Zig schema has it. Full peechy `.rs` emit
    // will replace this block wholesale.

    /// schema.zig:771 — `enum(u8)` (open). Kept closed.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum JsxRuntime {
        #[default]
        _none = 0,
        Automatic = 1,
        Classic = 2,
        Solid = 3,
    }

    /// schema.zig:789
    #[derive(Clone, Debug, Default)]
    pub struct Jsx {
        pub factory: Box<[u8]>,
        pub runtime: JsxRuntime,
        pub fragment: Box<[u8]>,
        pub development: bool,
        pub import_source: Box<[u8]>,
        pub side_effects: bool,
    }

    /// schema.zig:1130
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

    /// schema.zig:1151
    #[derive(Clone, Debug, Default)]
    pub struct LoaderMap {
        pub extensions: Vec<Box<[u8]>>,
        pub loaders: Vec<Loader>,
    }

    /// schema.zig:1193 — peechy `message` (all fields optional)
    #[derive(Clone, Debug, Default)]
    pub struct EnvConfig {
        pub prefix: Option<Box<[u8]>>,
        pub defaults: Option<StringMap>,
    }

    /// schema.zig:1247
    #[derive(Clone, Debug, Default)]
    pub struct LoadedEnvConfig {
        pub dotenv: DotEnvBehavior,
        pub defaults: StringMap,
        pub prefix: Box<[u8]>,
    }

    /// schema.zig:355 — `enum(u8)` (open). Kept closed.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum FrameworkEntryPointType {
        #[default]
        _none = 0,
        Client = 1,
        Server = 2,
        Fallback = 3,
    }

    /// schema.zig:1365
    #[derive(Clone, Debug, Default)]
    pub struct FrameworkEntryPoint {
        pub kind: FrameworkEntryPointType,
        pub path: Box<[u8]>,
        pub env: LoadedEnvConfig,
    }

    /// schema.zig:1391 — peechy `message` (all fields optional)
    #[derive(Clone, Debug, Default)]
    pub struct FrameworkEntryPointMap {
        pub client: Option<FrameworkEntryPoint>,
        pub server: Option<FrameworkEntryPoint>,
        pub fallback: Option<FrameworkEntryPoint>,
    }

    /// schema.zig:1444 — peechy `message` (all fields optional)
    #[derive(Clone, Debug, Default)]
    pub struct FrameworkEntryPointMessage {
        pub path: Option<Box<[u8]>>,
        pub env: Option<EnvConfig>,
    }

    /// schema.zig:1489
    #[derive(Clone, Debug, Default)]
    pub struct LoadedFramework {
        pub package: Box<[u8]>,
        pub display_name: Box<[u8]>,
        pub development: bool,
        pub entry_points: FrameworkEntryPointMap,
        pub client_css_in_js: CssInJsBehavior,
        pub override_modules: StringMap,
    }

    /// schema.zig:1528
    #[derive(Clone, Debug, Default)]
    pub struct LoadedRouteConfig {
        pub dir: Box<[u8]>,
        pub extensions: Box<[Box<[u8]>]>,
        pub static_dir: Box<[u8]>,
        pub asset_prefix: Box<[u8]>,
    }

    /// schema.zig:1559 — peechy `message` (array fields default empty,
    /// scalar fields optional)
    #[derive(Clone, Debug, Default)]
    pub struct RouteConfig {
        pub dir: Box<[Box<[u8]>]>,
        pub extensions: Box<[Box<[u8]>]>,
        pub static_dir: Option<Box<[u8]>>,
        pub asset_prefix: Option<Box<[u8]>>,
    }

    /// schema.zig:753 — `enum(u8)` (open). Kept closed.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum CssInJsBehavior {
        #[default]
        _none = 0,
        Facade = 1,
        FacadeOnimportcss = 2,
        AutoOnimportcss = 3,
    }

    /// schema.zig:1987 — `enum(u8)` (open, no `_none`). Kept closed.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum PackagesMode {
        #[default]
        Bundle = 0,
        External = 1,
    }

    // ── Fallback error-page wire types (schema.zig:548-708) ────────────────
    // Hand-stubbed subset so `js_parser::runtime::Fallback` un-gates. Full
    // bodies (with `decode`) arrive from the peechy generator.

    /// schema.zig:548 — `enum(u8)` (open).
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum FallbackStep {
        #[default]
        _none = 0,
        ssr_disabled = 1,
        create_vm = 2,
        configure_router = 3,
        configure_defines = 4,
        resolve_entry_point = 5,
        load_entry_point = 6,
        eval_entry_point = 7,
        fetch_event_handler = 8,
    }

    /// schema.zig:612 — peechy `struct Router`.
    #[derive(Clone, Debug, Default)]
    pub struct Router {
        pub routes: StringMap,
        pub route: i32,
        pub params: StringMap,
    }
    impl Router {
        pub fn encode(&self, w: &mut super::Writer<'_>) {
            self.routes.encode(w);
            w.write_int(self.route);
            self.params.encode(w);
        }
    }

    /// schema.zig:581 — peechy `struct Problems`.
    #[derive(Clone, Debug, Default)]
    pub struct Problems {
        pub code: u16,
        pub name: Box<[u8]>,
        pub exceptions: Vec<JsException>,
        pub build: Log,
    }
    impl Problems {
        pub fn encode(&self, w: &mut super::Writer<'_>) {
            w.write_int(self.code);
            w.write_array_u8(&self.name);
            w.write_int(u32::try_from(self.exceptions.len()).unwrap());
            for ex in &self.exceptions {
                ex.encode(w);
            }
            self.build.encode(w);
        }
    }

    /// schema.zig:475 — peechy `message JsException` (all fields optional).
    #[derive(Clone, Debug, Default)]
    pub struct JsException {
        pub name: Option<Box<[u8]>>,
        pub message: Option<Box<[u8]>>,
        pub runtime_type: Option<u16>,
        pub code: Option<u8>,
        // `stack: ?StackTrace` — omitted until StackTrace is ported.
    }
    impl JsException {
        pub fn encode(&self, w: &mut super::Writer<'_>) {
            if let Some(ref v) = self.name {
                w.write_field_id(1);
                w.write_array_u8(v);
            }
            if let Some(ref v) = self.message {
                w.write_field_id(2);
                w.write_array_u8(v);
            }
            if let Some(v) = self.runtime_type {
                w.write_field_id(3);
                w.write_int(v);
            }
            if let Some(v) = self.code {
                w.write_field_id(4);
                w.write_int(v);
            }
            w.end_message();
        }
    }

    impl StringMap {
        pub fn encode(&self, w: &mut super::Writer<'_>) {
            w.write_int(u32::try_from(self.keys.len()).unwrap());
            for k in &self.keys {
                w.write_array_u8(k);
            }
            w.write_int(u32::try_from(self.values.len()).unwrap());
            for v in &self.values {
                w.write_array_u8(v);
            }
        }
    }

    /// schema.zig — peechy `struct Log` (minimal: `warnings`, `errors`, `msgs`).
    #[derive(Clone, Debug, Default)]
    pub struct Log {
        pub warnings: u32,
        pub errors: u32,
        // `msgs: []Message` — omitted until `Message` is ported.
    }
    impl Log {
        pub fn encode(&self, w: &mut super::Writer<'_>) {
            w.write_int(self.warnings);
            w.write_int(self.errors);
            w.write_int(0u32); // msgs.len
        }
    }

    /// schema.zig:638 — peechy `message FallbackMessageContainer`.
    #[derive(Clone, Debug, Default)]
    pub struct FallbackMessageContainer {
        pub message: Option<Box<[u8]>>,
        pub router: Option<Router>,
        pub reason: Option<FallbackStep>,
        pub problems: Option<Problems>,
        pub cwd: Option<Box<[u8]>>,
    }
    impl FallbackMessageContainer {
        pub fn encode(&self, w: &mut super::Writer<'_>) {
            if let Some(ref message) = self.message {
                w.write_field_id(1);
                w.write_array_u8(message);
            }
            if let Some(ref router) = self.router {
                w.write_field_id(2);
                router.encode(w);
            }
            if let Some(reason) = self.reason {
                w.write_field_id(3);
                w.write_enum(reason);
            }
            if let Some(ref problems) = self.problems {
                w.write_field_id(4);
                problems.encode(w);
            }
            if let Some(ref cwd) = self.cwd {
                w.write_field_id(5);
                w.write_array_u8(cwd);
            }
            w.end_message();
        }
    }
}
