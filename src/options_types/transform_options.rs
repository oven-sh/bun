//! The option bag the CLI (`Arguments.rs`) and `bunfig.toml` populate and
//! `BundleOptions::from_transform_options` projects into bundler options.

use bun_ast::Target;
use bun_dotenv::DotEnvBehavior;

use crate::bundle_enums::{PackagesOption, SourceMapOption};
use crate::jsx;
use crate::schema::api::LoaderMap;

/// Ordered `(name, value)` pairs, e.g. `--define` entries.
pub type StringPairs = Vec<(Box<[u8]>, Box<[u8]>)>;

/// LIFECYCLE: `BundleOptions::from_transform_options` parks this in an `Arc` whose final ref
/// lives on the process-lifetime `Transpiler` (LSan-rooted in build_command.rs).
#[derive(Clone, Debug, Default)]
pub struct TransformOptions {
    pub jsx: Option<jsx::Options>,
    pub tsconfig_override: Option<Box<[u8]>>,
    pub origin: Option<Box<[u8]>>,
    pub absolute_working_dir: Option<Box<[u8]>>,
    pub define: StringPairs,
    pub drop: Vec<Box<[u8]>>,
    /// DCE via `import { feature } from "bun:bundle"`
    pub feature_flags: Vec<Box<[u8]>>,
    pub preserve_symlinks: Option<bool>,
    pub entry_points: Vec<Box<[u8]>>,
    pub write: Option<bool>,
    pub output_dir: Option<Box<[u8]>>,
    pub external: Vec<Box<[u8]>>,
    pub loaders: Option<LoaderMap>,
    pub main_fields: Vec<Box<[u8]>>,
    pub target: Option<Target>,
    pub env_files: Vec<Box<[u8]>>,
    pub disable_default_env_files: bool,
    pub extension_order: Vec<Box<[u8]>>,
    pub port: Option<u16>,
    pub log_level: Option<bun_ast::Level>,
    pub source_map: Option<SourceMapOption>,
    pub conditions: Vec<Box<[u8]>>,
    pub packages: Option<PackagesOption>,
    pub ignore_dce_annotations: bool,

    /// e.g. `[serve.static] plugins = ["tailwindcss"]`
    pub serve_plugins: Option<Vec<Box<[u8]>>>,
    pub serve_minify_syntax: Option<bool>,
    pub serve_minify_whitespace: Option<bool>,
    pub serve_minify_identifiers: Option<bool>,
    pub serve_env_behavior: Option<DotEnvBehavior>,
    pub serve_env_prefix: Option<Box<[u8]>>,
    pub serve_splitting: bool,
    pub serve_public_path: Option<Box<[u8]>>,
    pub serve_hmr: Option<bool>,
    pub serve_define: StringPairs,

    /// from `--no-addons`. `None` == `true`.
    pub allow_addons: Option<bool>,
    /// from `--unhandled-rejections`; default is `Bun`.
    pub unhandled_rejections: Option<UnhandledRejections>,

    pub bunfig_path: Box<[u8]>,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum UnhandledRejections {
    Strict,
    Throw,
    Warn,
    None,
    WarnWithErrorCode,
    #[default]
    Bun,
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
    /// Deliberately omits `"bun"` (it's the implicit default).
    pub const MAP: __ComptimeStringMap_UNHANDLED_REJECTIONS_MAP =
        __ComptimeStringMap_UNHANDLED_REJECTIONS_MAP(());
}
