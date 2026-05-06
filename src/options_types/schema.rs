// GENERATED: re-run peechy (src/api/schema.peechy) with .rs output
// source: src/options_types/schema.zig (3224 lines)
// PORT STATUS: skipped — generated file (see PORTING.md §Don't translate)
//
// B-2: minimal hand-stubbed `api` namespace so Context.rs / BundleEnums.rs
// struct fields type-check. Full body arrives when peechy emits .rs.
pub mod api {
    /// schema.zig:1172 — `enum(u32)`
    #[repr(u32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum DotEnvBehavior {
        #[default]
        _none,
        disable,
        prefix,
        load_all,
        load_all_without_inlining,
    }

    /// schema.zig:1639 — opaque until peechy codegen lands.
    #[derive(Default, Debug)]
    pub struct TransformOptions {
        _opaque: (), // TODO(b2): peechy-generated fields
    }

    /// schema.zig:2973 — opaque until peechy codegen lands.
    #[derive(Default, Debug)]
    pub struct BunInstall {
        _opaque: (), // TODO(b2): peechy-generated fields
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
        pub const EMPTY: StringMap = StringMap { keys: Vec::new(), values: Vec::new() };
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
}
