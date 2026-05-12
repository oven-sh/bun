//! Pure enum/struct option types extracted from `bundler/options.zig` so
//! `cli/` and other tiers can reference them without depending on `bundler/`.
//! Aliased back at original locations — call sites unchanged.
//!
//! `Loader` / `Target` / `SideEffects` / `Index` are now canonical in
//! `bun_ast`; only the `schema::api`-coupled extension methods (`to_api`,
//! `from_api`, `API_NAMES`) remain here as sealed extension traits.

use crate::schema::api;
use bun_ast::{Loader, LoaderOptional, Target};
use bun_collections;
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

// Zig: `bun.StringArrayHashMapUnmanaged(BundlePackage)` — insertion-ordered,
// string-keyed. Maps to bun_collections per PORTING.md §Collections.
// (E0658: inherent assoc types are nightly-only; lifted to module scope.)
pub type BundlePackageMap = bun_collections::StringArrayHashMap<BundlePackage>;

// ─── move-in: TYPE_ONLY from bun_bundler::options ─────────────────────────

/// `bundler/options.zig:1815` `BundleOptions.ForceNodeEnv`.
///
/// Set by the process environment to override the JSX configuration. When
/// `Unspecified`, tsconfig.json drives the choice between "react-jsx" and
/// "react-jsx-dev-runtime".
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum ForceNodeEnv {
    #[default]
    Unspecified,
    Development,
    Production,
}

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

// ─── Target: schema-coupled extension methods ─────────────────────────────

mod sealed {
    pub trait Sealed {}
    impl Sealed for bun_ast::Target {}
    impl Sealed for bun_ast::Loader {}
    impl Sealed for bun_ast::LoaderOptional {}
    impl Sealed for bun_ast::ImportKind {}
}

/// `schema::api`-coupled methods on [`bun_ast::Target`]. Import alongside
/// `Target` where `to_api`/`from(api)` are needed.
pub trait TargetExt: sealed::Sealed {
    fn to_api(self) -> api::Target;
    fn from_api(plat: Option<api::Target>) -> Target;
}

impl TargetExt for Target {
    fn to_api(self) -> api::Target {
        match self {
            Target::Node => api::Target::node,
            Target::Browser => api::Target::browser,
            Target::Bun | Target::BakeServerComponentsSsr => api::Target::bun,
            Target::BunMacro => api::Target::bun_macro,
        }
    }

    fn from_api(plat: Option<api::Target>) -> Target {
        match plat.unwrap_or(api::Target::_none) {
            api::Target::node => Target::Node,
            api::Target::browser => Target::Browser,
            api::Target::bun => Target::Bun,
            api::Target::bun_macro => Target::BunMacro,
            _ => Target::Browser,
        }
    }
}

// ─── Loader: schema-coupled extension methods ─────────────────────────────

pub const LOADER_API_NAMES: phf::Map<&'static [u8], api::Loader> = phf::phf_map! {
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

/// `schema::api`-coupled methods on [`bun_ast::Loader`].
pub trait LoaderExt: sealed::Sealed {
    fn to_api(self) -> api::Loader;
    fn from_api(loader: api::Loader) -> Loader;
}

impl LoaderExt for Loader {
    fn to_api(self) -> api::Loader {
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

    fn from_api(loader: api::Loader) -> Loader {
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
}

/// `schema::api`-coupled methods on [`bun_ast::LoaderOptional`].
pub trait LoaderOptionalExt: sealed::Sealed {
    fn from_api(loader: api::Loader) -> LoaderOptional;
}

impl LoaderOptionalExt for LoaderOptional {
    fn from_api(loader: api::Loader) -> LoaderOptional {
        if loader == api::Loader::_none {
            LoaderOptional::NONE
        } else {
            LoaderOptional::from_loader(Loader::from_api(loader))
        }
    }
}

// ─── ImportKind: schema-coupled extension methods ─────────────────────────

/// `schema::api`-coupled methods on [`bun_ast::ImportKind`].
pub trait ImportKindExt: sealed::Sealed {
    fn to_api(self) -> api::ImportKind;
}

impl ImportKindExt for bun_ast::ImportKind {
    fn to_api(self) -> api::ImportKind {
        use bun_ast::ImportKind;
        // TODO(port): source Zig references `ImportKind.entry_point` which is not a declared variant
        // (only entry_point_run / entry_point_build exist). This compiles in Zig only because the
        // function is never analyzed. Mapping both entry-point variants to api::ImportKind::entry_point.
        match self {
            ImportKind::EntryPointRun | ImportKind::EntryPointBuild => api::ImportKind::entry_point,
            ImportKind::Stmt => api::ImportKind::stmt,
            ImportKind::Require => api::ImportKind::require,
            ImportKind::Dynamic => api::ImportKind::dynamic,
            ImportKind::RequireResolve => api::ImportKind::require_resolve,
            ImportKind::At => api::ImportKind::at,
            ImportKind::Url => api::ImportKind::url,
            _ => api::ImportKind::internal,
        }
    }
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

// `ExportsKind::to_module_type` — moved here from `bun_ast::nodes` to avoid
// the `bun_options_types → bun_ast → bun_options_types` cycle.
impl From<bun_ast::ExportsKind> for ModuleType {
    fn from(k: bun_ast::ExportsKind) -> Self {
        use bun_ast::ExportsKind as K;
        match k {
            K::None => ModuleType::Unknown,
            K::Cjs => ModuleType::Cjs,
            K::EsmWithDynamicFallback | K::EsmWithDynamicFallbackFromCjs | K::Esm => {
                ModuleType::Esm
            }
        }
    }
}

// ported from: src/options_types/BundleEnums.zig
