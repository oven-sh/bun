//! Pure enum/struct option types extracted from `bundler/options.zig` so
//! `cli/` and other tiers can reference them without depending on `bundler/`.
//! Aliased back at original locations — call sites unchanged.

use bun_collections;
use bun_schema::api;
use bun_str::strings;
use enum_map::{Enum, EnumMap};
use phf;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Format {
    /// ES module format
    /// This is the default format
    Esm,

    /// Immediately-invoked function expression
    /// (function(){
    ///     ...
    /// })();
    Iife,

    /// CommonJS
    Cjs,

    /// Bake uses a special module format for Hot-module-reloading. It includes a
    /// runtime payload, sourced from src/bake/hmr-runtime-{side}.ts.
    ///
    /// ((unloadedModuleRegistry, config) => {
    ///   ... runtime code ...
    /// })({
    ///   "module1.ts": ...,
    ///   "module2.ts": ...,
    /// }, { ...metadata... });
    InternalBakeDev,
}

impl Format {
    pub fn keep_es6_import_export_syntax(self) -> bool {
        self == Format::Esm
    }

    #[inline]
    pub fn is_esm(self) -> bool {
        self == Format::Esm
    }

    #[inline]
    pub fn is_always_strict_mode(self) -> bool {
        self == Format::Esm
    }

    pub const MAP: phf::Map<&'static [u8], Format> = phf::phf_map! {
        b"esm" => Format::Esm,
        b"cjs" => Format::Cjs,
        b"iife" => Format::Iife,

        // TODO: Disable this outside of debug builds
        b"internal_bake_dev" => Format::InternalBakeDev,
    };

    // `fromJS` alias to `bundler_jsc/options_jsc.zig` deleted — see PORTING.md
    // (`to_js`/`from_js` live as extension-trait methods in the `*_jsc` crate).

    pub fn from_string(slice: &[u8]) -> Option<Format> {
        // Zig: Map.getWithEql(slice, bun.strings.eqlComptime) — eqlComptime is
        // exact byte equality, which is phf's default lookup.
        Self::MAP.get(slice).copied()
    }
}

#[derive(Default)]
pub struct WindowsOptions {
    pub hide_console: bool,
    // TODO(port): lifetime — Zig `?[]const u8` fields with no `deinit` in this
    // file; conservatively owned as Box<[u8]> for Phase A.
    pub icon: Option<Box<[u8]>>,
    pub title: Option<Box<[u8]>>,
    pub publisher: Option<Box<[u8]>>,
    pub version: Option<Box<[u8]>>,
    pub description: Option<Box<[u8]>>,
    pub copyright: Option<Box<[u8]>>,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BundlePackage {
    Always,
    Never,
}

impl BundlePackage {
    // Zig: `bun.StringArrayHashMapUnmanaged(BundlePackage)` — insertion-ordered,
    // string-keyed. Maps to bun_collections per PORTING.md §Collections.
    pub type Map = bun_collections::StringArrayHashMap<BundlePackage>;
}

// ─── move-in: TYPE_ONLY from bun_bundler::options ─────────────────────────

/// `bundler/options.zig` `ModuleType` — package.json `"type"` field.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum ModuleType {
    #[default]
    Unknown,
    Cjs,
    Esm,
}

impl ModuleType {
    pub const LIST: phf::Map<&'static [u8], ModuleType> = phf::phf_map! {
        b"commonjs" => ModuleType::Cjs,
        b"module" => ModuleType::Esm,
    };
}

/// `bundler/options.zig` `Target` — bundle target platform.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash, Enum)]
pub enum Target {
    Browser,
    Bun,
    BunMacro,
    Node,
    /// This is used by bake.Framework.ServerComponents.separate_ssr_graph
    BakeServerComponentsSsr,
}

impl Target {
    pub const MAP: phf::Map<&'static [u8], Target> = phf::phf_map! {
        b"browser" => Target::Browser,
        b"bun" => Target::Bun,
        b"bun_macro" => Target::BunMacro,
        b"macro" => Target::BunMacro,
        b"node" => Target::Node,
    };

    // `from_js` lives in bundler_jsc as an extension trait — see PORTING.md.

    pub fn to_api(self) -> api::Target {
        match self {
            Target::Node => api::Target::node,
            Target::Browser => api::Target::browser,
            Target::Bun | Target::BakeServerComponentsSsr => api::Target::bun,
            Target::BunMacro => api::Target::bun_macro,
        }
    }

    #[inline]
    pub fn is_server_side(self) -> bool {
        matches!(
            self,
            Target::BunMacro | Target::Node | Target::Bun | Target::BakeServerComponentsSsr
        )
    }

    #[inline]
    pub fn is_bun(self) -> bool {
        matches!(self, Target::BunMacro | Target::Bun | Target::BakeServerComponentsSsr)
    }

    #[inline]
    pub fn is_node(self) -> bool {
        matches!(self, Target::Node)
    }

    #[inline]
    pub fn process_browser_define_value(self) -> Option<&'static str> {
        match self {
            Target::Browser => Some("true"),
            _ => Some("false"),
        }
    }

    // `bake_graph()` stays in bun_bake (would back-edge into tier-6).
    // `out_extensions()` stays in bun_bundler (allocator-heavy, only used there).

    pub fn from(plat: Option<api::Target>) -> Target {
        match plat.unwrap_or(api::Target::_none) {
            api::Target::node => Target::Node,
            api::Target::browser => Target::Browser,
            api::Target::bun => Target::Bun,
            api::Target::bun_macro => Target::BunMacro,
            _ => Target::Browser,
        }
    }

    const MAIN_FIELD_NAMES: [&'static str; 4] = [
        "browser",
        "module",
        "main",
        // https://github.com/jsforum/jsforum/issues/5
        // Older packages might use jsnext:main in place of module
        "jsnext:main",
    ];

    pub fn default_main_fields(self) -> &'static [&'static str] {
        // Zig: `std.EnumArray(Target, []const string)` initialized at comptime.
        // See bundler/options.zig for the rationale comments on each ordering.
        const NODE: &[&str] = &[Target::MAIN_FIELD_NAMES[2], Target::MAIN_FIELD_NAMES[1]];
        const BROWSER: &[&str] = &[
            Target::MAIN_FIELD_NAMES[0],
            Target::MAIN_FIELD_NAMES[1],
            Target::MAIN_FIELD_NAMES[3],
            Target::MAIN_FIELD_NAMES[2],
        ];
        const BUN: &[&str] = &[
            Target::MAIN_FIELD_NAMES[1],
            Target::MAIN_FIELD_NAMES[2],
            Target::MAIN_FIELD_NAMES[3],
        ];
        match self {
            Target::Node => NODE,
            Target::Browser => BROWSER,
            Target::Bun | Target::BunMacro | Target::BakeServerComponentsSsr => BUN,
        }
    }

    pub fn default_conditions(self) -> &'static [&'static str] {
        match self {
            Target::Node => &["node"],
            Target::Browser => &["browser", "module"],
            Target::Bun => &["bun", "node"],
            Target::BakeServerComponentsSsr => &["bun", "node"],
            Target::BunMacro => &["macro", "bun", "node"],
        }
    }
}

/// `bundler/options.zig` `Loader`.
///
/// The max integer value in this enum can only be appended to.
/// It has dependencies in several places:
/// - bun-native-bundler-plugin-api/bundler_plugin.h
/// - src/jsc/bindings/headers-handwritten.h
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash, Enum)]
pub enum Loader {
    Jsx = 0,
    Js = 1,
    Ts = 2,
    Tsx = 3,
    Css = 4,
    File = 5,
    Json = 6,
    Jsonc = 7,
    Toml = 8,
    Wasm = 9,
    Napi = 10,
    Base64 = 11,
    Dataurl = 12,
    Text = 13,
    Bunsh = 14,
    Sqlite = 15,
    SqliteEmbedded = 16,
    Html = 17,
    Yaml = 18,
    Json5 = 19,
    Md = 20,
}

/// `Loader.Optional` — `enum(u8) { none = 254, _ }` niche-packed optional.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct LoaderOptional(u8);

impl LoaderOptional {
    pub const NONE: LoaderOptional = LoaderOptional(254);

    pub fn unwrap(self) -> Option<Loader> {
        if self.0 == 254 {
            None
        } else {
            // SAFETY: discriminants 0..=20 are valid Loader; producers only
            // ever store a valid Loader discriminant or 254.
            Some(unsafe { core::mem::transmute::<u8, Loader>(self.0) })
        }
    }

    pub fn from_api(loader: api::Loader) -> LoaderOptional {
        if loader == api::Loader::_none {
            LoaderOptional::NONE
        } else {
            LoaderOptional(Loader::from_api(loader) as u8)
        }
    }
}

impl From<Loader> for LoaderOptional {
    fn from(l: Loader) -> Self {
        LoaderOptional(l as u8)
    }
}

impl Loader {
    pub type HashTable = bun_collections::StringArrayHashMap<Loader>;

    #[inline]
    pub fn is_css(self) -> bool {
        self == Loader::Css
    }

    #[inline]
    pub fn is_js_like(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn disable_html(self) -> Loader {
        match self {
            Loader::Html => Loader::File,
            other => other,
        }
    }

    #[inline]
    pub fn is_sqlite(self) -> bool {
        matches!(self, Loader::Sqlite | Loader::SqliteEmbedded)
    }

    pub fn should_copy_for_bundling(self) -> bool {
        matches!(
            self,
            Loader::File
                | Loader::Napi
                | Loader::Sqlite
                | Loader::SqliteEmbedded
                // TODO: loader for reading bytes and creating module or instance
                | Loader::Wasm
        )
    }

    pub fn handles_empty_file(self) -> bool {
        matches!(self, Loader::Wasm | Loader::File | Loader::Text)
    }

    // `to_mime_type` / `from_mime_type` stay in bun_http_types as extension
    // methods (would back-edge into bun_http::MimeType).

    pub fn can_have_source_map(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn can_be_run_by_bun(self) -> bool {
        matches!(
            self,
            Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx | Loader::Wasm | Loader::Bunsh
        )
    }

    #[inline]
    pub fn stdin_name(self) -> &'static str {
        match self {
            Loader::Jsx => "input.jsx",
            Loader::Js => "input.js",
            Loader::Ts => "input.ts",
            Loader::Tsx => "input.tsx",
            Loader::Css => "input.css",
            Loader::File => "input",
            Loader::Json => "input.json",
            Loader::Toml => "input.toml",
            Loader::Yaml => "input.yaml",
            Loader::Json5 => "input.json5",
            Loader::Wasm => "input.wasm",
            Loader::Napi => "input.node",
            Loader::Text => "input.txt",
            Loader::Bunsh => "input.sh",
            Loader::Html => "input.html",
            Loader::Md => "input.md",
            _ => "",
        }
    }

    // `from_js` lives in bundler_jsc as an extension trait.

    pub const NAMES: phf::Map<&'static [u8], Loader> = phf::phf_map! {
        b"js" => Loader::Js,
        b"mjs" => Loader::Js,
        b"cjs" => Loader::Js,
        b"cts" => Loader::Ts,
        b"mts" => Loader::Ts,
        b"jsx" => Loader::Jsx,
        b"ts" => Loader::Ts,
        b"tsx" => Loader::Tsx,
        b"css" => Loader::Css,
        b"file" => Loader::File,
        b"json" => Loader::Json,
        b"jsonc" => Loader::Jsonc,
        b"toml" => Loader::Toml,
        b"yaml" => Loader::Yaml,
        b"json5" => Loader::Json5,
        b"wasm" => Loader::Wasm,
        b"napi" => Loader::Napi,
        b"node" => Loader::Napi,
        b"dataurl" => Loader::Dataurl,
        b"base64" => Loader::Base64,
        b"txt" => Loader::Text,
        b"text" => Loader::Text,
        b"sh" => Loader::Bunsh,
        b"sqlite" => Loader::Sqlite,
        b"sqlite_embedded" => Loader::SqliteEmbedded,
        b"html" => Loader::Html,
        b"md" => Loader::Md,
        b"markdown" => Loader::Md,
    };

    pub const API_NAMES: phf::Map<&'static [u8], api::Loader> = phf::phf_map! {
        b"js" => api::Loader::js,
        b"mjs" => api::Loader::js,
        b"cjs" => api::Loader::js,
        b"cts" => api::Loader::ts,
        b"mts" => api::Loader::ts,
        b"jsx" => api::Loader::jsx,
        b"ts" => api::Loader::ts,
        b"tsx" => api::Loader::tsx,
        b"css" => api::Loader::css,
        b"file" => api::Loader::file,
        b"json" => api::Loader::json,
        b"jsonc" => api::Loader::json,
        b"toml" => api::Loader::toml,
        b"yaml" => api::Loader::yaml,
        b"json5" => api::Loader::json5,
        b"wasm" => api::Loader::wasm,
        b"node" => api::Loader::napi,
        b"dataurl" => api::Loader::dataurl,
        b"base64" => api::Loader::base64,
        b"txt" => api::Loader::text,
        b"text" => api::Loader::text,
        b"sh" => api::Loader::file,
        b"sqlite" => api::Loader::sqlite,
        b"html" => api::Loader::html,
        b"md" => api::Loader::md,
        b"markdown" => api::Loader::md,
    };

    pub fn from_string(slice_: &[u8]) -> Option<Loader> {
        let slice = if !slice_.is_empty() && slice_[0] == b'.' {
            &slice_[1..]
        } else {
            slice_
        };
        // Zig: names.getWithEql(slice, strings.eqlCaseInsensitiveASCIIICheckLength)
        // TODO(port): phf is case-sensitive; Phase B may need a lowercase pass or
        // bun_str::strings::eql_case_insensitive_ascii lookup over NAMES.entries().
        Self::NAMES.get(slice).copied().or_else(|| {
            Self::NAMES
                .entries()
                .find(|(k, _)| strings::eql_case_insensitive_ascii_i_check_length(k, slice))
                .map(|(_, v)| *v)
        })
    }

    pub fn supports_client_entry_point(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn to_api(self) -> api::Loader {
        match self {
            Loader::Jsx => api::Loader::jsx,
            Loader::Js => api::Loader::js,
            Loader::Ts => api::Loader::ts,
            Loader::Tsx => api::Loader::tsx,
            Loader::Css => api::Loader::css,
            Loader::Html => api::Loader::html,
            Loader::File | Loader::Bunsh => api::Loader::file,
            Loader::Json => api::Loader::json,
            Loader::Jsonc => api::Loader::json,
            Loader::Toml => api::Loader::toml,
            Loader::Yaml => api::Loader::yaml,
            Loader::Json5 => api::Loader::json5,
            Loader::Wasm => api::Loader::wasm,
            Loader::Napi => api::Loader::napi,
            Loader::Base64 => api::Loader::base64,
            Loader::Dataurl => api::Loader::dataurl,
            Loader::Text => api::Loader::text,
            Loader::SqliteEmbedded | Loader::Sqlite => api::Loader::sqlite,
            Loader::Md => api::Loader::md,
        }
    }

    pub fn from_api(loader: api::Loader) -> Loader {
        match loader {
            api::Loader::_none => Loader::File,
            api::Loader::jsx => Loader::Jsx,
            api::Loader::js => Loader::Js,
            api::Loader::ts => Loader::Ts,
            api::Loader::tsx => Loader::Tsx,
            api::Loader::css => Loader::Css,
            api::Loader::file => Loader::File,
            api::Loader::json => Loader::Json,
            api::Loader::jsonc => Loader::Jsonc,
            api::Loader::toml => Loader::Toml,
            api::Loader::yaml => Loader::Yaml,
            api::Loader::json5 => Loader::Json5,
            api::Loader::wasm => Loader::Wasm,
            api::Loader::napi => Loader::Napi,
            api::Loader::base64 => Loader::Base64,
            api::Loader::dataurl => Loader::Dataurl,
            api::Loader::text => Loader::Text,
            api::Loader::bunsh => Loader::Bunsh,
            api::Loader::html => Loader::Html,
            api::Loader::sqlite => Loader::Sqlite,
            api::Loader::sqlite_embedded => Loader::SqliteEmbedded,
            api::Loader::md => Loader::Md,
            _ => Loader::File,
        }
    }

    #[inline]
    pub fn is_jsx(self) -> bool {
        self == Loader::Jsx || self == Loader::Tsx
    }

    #[inline]
    pub fn is_typescript(self) -> bool {
        self == Loader::Tsx || self == Loader::Ts
    }

    #[inline]
    pub fn is_javascript_like(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn is_javascript_like_or_json(self) -> bool {
        matches!(
            self,
            Loader::Jsx
                | Loader::Js
                | Loader::Ts
                | Loader::Tsx
                | Loader::Json
                | Loader::Jsonc
                // toml, yaml, and json5 are included because we can serialize to the same AST as JSON
                | Loader::Toml
                | Loader::Yaml
                | Loader::Json5
        )
    }

    // `for_file_name` is generic over `anytype` map; callers in bun_bundler
    // implement it locally with their concrete map type.

    pub fn side_effects(self) -> SideEffects {
        match self {
            Loader::Text
            | Loader::Json
            | Loader::Jsonc
            | Loader::Toml
            | Loader::Yaml
            | Loader::Json5
            | Loader::File
            | Loader::Md => SideEffects::NoSideEffectsPureData,
            _ => SideEffects::HasSideEffects,
        }
    }
}

// ─── move-in: TYPE_ONLY from bun_resolver ─────────────────────────────────

/// `resolver/resolver.zig` `SideEffects`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum SideEffects {
    /// The default value conservatively considers all files to have side effects.
    #[default]
    HasSideEffects,

    /// This file was listed as not having side effects by a "package.json"
    /// file in one of our containing directories with a "sideEffects" field.
    NoSideEffectsPackageJson,

    /// This file is considered to have no side effects because the AST was empty
    /// after parsing finished. This should be the case for ".d.ts" files.
    NoSideEffectsEmptyAst,

    /// This file was loaded using a data-oriented loader (e.g. "text") that is
    /// known to not have side effects.
    NoSideEffectsPureData,

    // /// Same as above but it came from a plugin. We don't want to warn about
    // /// unused imports to these files since running the plugin is a side effect.
    // /// Removing the import would not call the plugin which is observable.
    // NoSideEffectsPureDataFromPlugin,
}

// ─── move-in: TYPE_ONLY from bun_runtime::bake::framework ──────────────────────────

/// `bake/bake.zig` `Framework.BuiltInModule` — virtual module backing for a
/// framework-declared built-in: either an import path to redirect to, or
/// inline source code.
#[derive(Clone, Debug)]
pub enum BuiltInModule {
    // TODO(port): lifetime — Zig `[]const u8`; arena-owned in bake.UserOptions.
    Import(Box<[u8]>),
    Code(Box<[u8]>),
}

// ─── move-in: TYPE_ONLY from bun_js_parser::ast ───────────────────────────

/// `js_parser/ast/base.zig` `Index` — source-file / part index newtype.
///
/// In some parts of Bun, we have many different IDs pointing to different
/// things. It's easy for them to get mixed up, so we use this type to make
/// sure we don't.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct Index {
    pub value: u32,
}

pub type IndexInt = u32;

impl Index {
    pub const INVALID: Index = Index { value: u32::MAX };
    pub const RUNTIME: Index = Index { value: 0 };
    pub const BAKE_SERVER_DATA: Index = Index { value: 1 };
    pub const BAKE_CLIENT_DATA: Index = Index { value: 2 };

    pub fn set(&mut self, val: u32) {
        self.value = val;
    }

    /// If you are within the parser, use `p.is_source_runtime()` instead, as the
    /// runtime index (0) is used as the id for single-file transforms.
    #[inline]
    pub fn is_runtime(self) -> bool {
        self.value == Self::RUNTIME.value
    }

    #[inline]
    pub fn source(num: impl Into<u32>) -> Index {
        // Zig: @as(Int, @truncate(num)) — `Into<u32>` covers the integer call sites.
        Index { value: num.into() }
    }

    #[inline]
    pub fn part(num: impl Into<u32>) -> Index {
        Index { value: num.into() }
    }

    pub fn init<N>(num: N) -> Index
    where
        N: TryInto<u32>,
        N::Error: core::fmt::Debug,
    {
        // Zig: @intCast(num) under allow_assert, else also @intCast — collapse to a
        // single debug-asserting conversion.
        #[cfg(debug_assertions)]
        {
            Index { value: num.try_into().expect("Index::init overflow") }
        }
        #[cfg(not(debug_assertions))]
        {
            // SAFETY: callers guarantee `num` fits in u32; matches Zig release behaviour.
            Index { value: unsafe { num.try_into().unwrap_unchecked() } }
        }
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        self.value != Self::INVALID.value
    }

    #[inline]
    pub fn is_invalid(self) -> bool {
        !self.is_valid()
    }

    #[inline]
    pub fn get(self) -> u32 {
        self.value
    }
}

impl Default for Index {
    fn default() -> Self {
        Self::INVALID
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/BundleEnums.zig (75 lines)
//               + move-in TYPE_ONLY: bundler/options.zig (ModuleType, Target, Loader),
//                 resolver/resolver.zig (SideEffects), bake/bake.zig (BuiltInModule),
//                 js_parser/ast/base.zig (Index)
//   confidence: high (Format/WindowsOptions/BundlePackage), medium (move-in types)
//   todos:      3
//   notes:      WindowsOptions string fields conservatively Box<[u8]>; inherent
//               `type` alias needs Rust 1.79+ or move to module scope; Loader::from_string
//               case-insensitive fallback is O(n) over phf entries.
// ──────────────────────────────────────────────────────────────────────────
