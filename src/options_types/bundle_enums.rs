//! Pure enum/struct bundler option types, kept here so
//! `cli/` and other tiers can reference them without depending on `bundler/`.
//! Aliased back at original locations — call sites unchanged.

use crate::schema::api;
use bun_ast::Loader;

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
    pub fn is_always_strict_mode(self) -> bool {
        self == Format::Esm
    }

    pub const MAP: __ComptimeStringMap_FORMAT_MAP = __ComptimeStringMap_FORMAT_MAP(());

    // `to_js`/`from_js` live as extension-trait methods in the `*_jsc` crate.

    pub fn from_string(slice: &[u8]) -> Option<Format> {
        Self::MAP.get(slice).copied()
    }
}

bun_core::comptime_string_map! {
    #[doc(hidden)]
    pub static FORMAT_MAP: Format = {
        b"esm" => Format::Esm,
        b"cjs" => Format::Cjs,
        b"iife" => Format::Iife,

        // TODO: Disable this outside of debug builds
        b"internal_bake_dev" => Format::InternalBakeDev,
    };
}

#[derive(Default)]
pub struct WindowsOptions {
    pub hide_console: bool,
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

// ─── move-in: TYPE_ONLY from bun_bundler::options ─────────────────────────

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

/// package.json `"type"` field.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum ModuleType {
    #[default]
    Unknown,
    Cjs,
    Esm,
}

impl ModuleType {
    pub const LIST: __ComptimeStringMap_MODULE_TYPE_LIST = __ComptimeStringMap_MODULE_TYPE_LIST(());
}

bun_core::comptime_string_map! {
    #[doc(hidden)]
    pub static MODULE_TYPE_LIST: ModuleType = {
        b"commonjs" => ModuleType::Cjs,
        b"module" => ModuleType::Esm,
    };
}

mod sealed {
    pub trait Sealed {}
    impl Sealed for bun_ast::Loader {}
}

/// `--sourcemap` / `sourcemap:` setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SourceMapOption {
    #[default]
    None,
    Inline,
    External,
    Linked,
}

impl SourceMapOption {
    pub fn has_external_files(self) -> bool {
        matches!(self, SourceMapOption::Linked | SourceMapOption::External)
    }
}

bun_core::comptime_string_map! {
    pub static SOURCE_MAP_OPTION_MAP: SourceMapOption = {
        b"none" => SourceMapOption::None,
        b"inline" => SourceMapOption::Inline,
        b"external" => SourceMapOption::External,
        b"linked" => SourceMapOption::Linked,
    };
}

/// `--packages` / `packages:` setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PackagesOption {
    #[default]
    Bundle,
    External,
}

bun_core::comptime_string_map! {
    pub static PACKAGES_OPTION_MAP: PackagesOption = {
        b"external" => PackagesOption::External,
        b"bundle" => PackagesOption::Bundle,
    };
}

// ─── Loader: schema-coupled extension methods ─────────────────────────────

bun_core::comptime_string_map! {
pub static LOADER_API_NAMES: api::Loader = {
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
    b"xml" => api::Loader::xml,
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
}

/// Conversions between [`bun_ast::Loader`] and the [`api::Loader`] wire enum.
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
            Loader::Xml => api::Loader::xml,
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
            api::Loader::xml => Loader::Xml,
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
        }
    }
}

// ─── move-in: TYPE_ONLY from bun_runtime::bake::framework ──────────────────────────

/// Virtual module backing for a
/// framework-declared built-in: either an import path to redirect to, or
/// inline source code.
#[derive(Clone, Debug)]
pub enum BuiltInModule {
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
