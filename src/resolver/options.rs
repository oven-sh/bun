//! Resolver-tier `options` — the canonical resolver-input types.
//!
//! MOVE_DOWN COMPLETE for the resolver↔bundler cycle: these are the types the
//! resolver reads, defined at the lowest tier that can name all their parts
//! (`jsx::Pragma`/`ConditionsMap` live in this crate; `Target`/`Loader` in
//! `bun_options_types`). `bun_bundler::options::BundleOptions` is the ~200-field
//! CLI/config aggregate; `bun_bundler::transpiler::resolver_bundle_options_subset`
//! projects it into this struct for `Resolver::init1`. These are NOT a re-decl
//! of the bundler type — the bundler depends on this crate and re-exports them.

pub use crate::tsconfig_json::options::jsx;
pub(crate) use bun_ast::{Loader, Target};
pub use bun_options_types::bundle_enums::ModuleType;

/// Port of `bundler/options.zig` `Packages`.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Packages {
    #[default]
    Bundle,
    External,
}

/// Port of `bundler/options.zig` `ExternalModules`.
#[derive(Default)]
pub struct ExternalModules {
    pub patterns: Vec<WildcardPattern>,
    pub abs_paths: StringSet,
    pub node_modules: StringSet,
}
impl Clone for ExternalModules {
    fn clone(&self) -> Self {
        // `StringSet::clone` is an inherent fallible method (returns
        // `Result<_, AllocError>`), so this can't be `#[derive(Clone)]`.
        Self {
            patterns: self.patterns.clone(),
            abs_paths: self.abs_paths.clone().expect("oom"),
            node_modules: self.node_modules.clone().expect("oom"),
        }
    }
}
#[derive(Debug, Clone)]
pub struct WildcardPattern {
    pub prefix: Box<[u8]>,
    pub suffix: Box<[u8]>,
}
pub use bun_collections::StringSet;

/// Port of `bundler/options.zig` `Conditions`.
#[derive(Default)]
pub struct Conditions {
    pub import: crate::package_json::ConditionsMap,
    pub require: crate::package_json::ConditionsMap,
    pub style: crate::package_json::ConditionsMap,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) enum ExtOrder {
    /// `opts.extension_order.default.default`
    #[default]
    DefaultDefault,
    /// `opts.extension_order.default.esm`
    DefaultEsm,
    /// `opts.extension_order.node_modules.default`
    NodeModulesDefault,
    /// `opts.extension_order.node_modules.esm`
    NodeModulesEsm,
    /// `opts.extension_order.css` (Zig reads `Defaults.CssExtensionOrder` directly)
    Css,
    /// `opts.main_field_extension_order` — used when resolving the `"main"`
    /// package.json field (`resolver.zig:3703,3715,3721`).
    MainField,
}

/// Convert a `&[&[u8]]` default constant into the owned form the resolver
/// stores. Mirrors `bun_bundler::options::owned_string_list`.
pub fn owned_string_list(s: &[&[u8]]) -> Box<[Box<[u8]>]> {
    s.iter().map(|s| Box::<[u8]>::from(*s)).collect()
}

/// Port of `bundler/options.zig` `ResolveFileExtensions`.
pub struct ExtensionOrder {
    pub default: ExtensionOrderGroup,
    pub node_modules: ExtensionOrderGroup,
    /// Not on the bundler-side struct — the spec resolver reads
    /// `Defaults.CssExtensionOrder` directly. Stored here so every
    /// [`ExtOrder`] tag resolves into storage with the same owner/lifetime.
    pub css: Box<[Box<[u8]>]>,
}
pub struct ExtensionOrderGroup {
    pub default: Box<[Box<[u8]>]>,
    pub esm: Box<[Box<[u8]>]>,
}
impl Default for ExtensionOrderGroup {
    fn default() -> Self {
        ExtensionOrderGroup {
            default: owned_string_list(bundle_options::defaults::EXTENSION_ORDER),
            esm: owned_string_list(bundle_options::defaults::MODULE_EXTENSION_ORDER),
        }
    }
}
impl Default for ExtensionOrder {
    fn default() -> Self {
        ExtensionOrder {
            default: ExtensionOrderGroup::default(),
            node_modules: ExtensionOrderGroup {
                default: owned_string_list(bundle_options::defaults::node_modules::EXTENSION_ORDER),
                esm: owned_string_list(
                    bundle_options::defaults::node_modules::MODULE_EXTENSION_ORDER,
                ),
            },
            css: owned_string_list(bundle_options::defaults::CSS_EXTENSION_ORDER),
        }
    }
}
impl ExtensionOrder {
    /// Port of `options.zig` `ResolveFileExtensions.kind`. Returns the
    /// [`ExtOrder`] tag; resolve to a slice via
    /// [`BundleOptions::ext_order_slice`].
    pub fn kind(&self, kind: bun_ast::ImportKind, is_node_modules: bool) -> ExtOrder {
        use bun_ast::ImportKind as K;
        match kind {
            K::Url | K::AtConditional | K::At => ExtOrder::Css,
            K::Stmt | K::EntryPointBuild | K::EntryPointRun | K::Dynamic => {
                if is_node_modules {
                    ExtOrder::NodeModulesEsm
                } else {
                    ExtOrder::DefaultEsm
                }
            }
            _ => {
                if is_node_modules {
                    ExtOrder::NodeModulesDefault
                } else {
                    ExtOrder::DefaultDefault
                }
            }
        }
    }
}

impl BundleOptions {
    #[inline]
    pub fn ext_order_slice(&self, tag: ExtOrder) -> &[Box<[u8]>] {
        match tag {
            ExtOrder::DefaultDefault => &self.extension_order.default.default,
            ExtOrder::DefaultEsm => &self.extension_order.default.esm,
            ExtOrder::NodeModulesDefault => &self.extension_order.node_modules.default,
            ExtOrder::NodeModulesEsm => &self.extension_order.node_modules.esm,
            ExtOrder::Css => &self.extension_order.css,
            ExtOrder::MainField => &self.main_field_extension_order,
        }
    }
}

pub mod bundle_options {
    pub use super::ForceNodeEnv;
    pub mod defaults {
        pub const CSS_EXTENSION_ORDER: &[&[u8]] = &[b".css"];
        // Mirrors `bun_bundler::options::bundle_options_defaults::EXTENSION_ORDER`
        // / `MODULE_EXTENSION_ORDER` — duplicated so `Default for BundleOptions`
        // below is self-contained (resolver sits below bundler in the dep graph).
        pub(crate) const EXTENSION_ORDER: &[&[u8]] = &[
            b".tsx", b".ts", b".jsx", b".cts", b".cjs", b".js", b".mjs", b".mts", b".json",
        ];
        pub(crate) const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
            b".tsx", b".jsx", b".mts", b".ts", b".mjs", b".js", b".cts", b".cjs", b".json",
        ];
        /// Mirrors `bun_bundler::options::bundle_options_defaults::node_modules`.
        pub mod node_modules {
            pub(crate) const EXTENSION_ORDER: &[&[u8]] = &[
                b".jsx", b".cjs", b".js", b".mjs", b".mts", b".tsx", b".ts", b".cts", b".json",
            ];
            pub(crate) const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
                b".mjs", b".jsx", b".js", b".mts", b".tsx", b".ts", b".cjs", b".cts", b".json",
            ];
        }
    }
}

pub use ::bun_options_types::ForceNodeEnv;

/// Port of `bundler/options.zig` `Framework` (Bake) — only the
/// `built_in_modules` field, which is the sole resolver-read member.
pub struct Framework {
    pub built_in_modules: bun_collections::StringArrayHashMap<bun_options_types::BuiltInModule>,
}

pub struct BundleOptions {
    pub target: Target,
    pub packages: Packages,
    pub jsx: jsx::Pragma,
    pub extension_order: ExtensionOrder,
    pub conditions: Conditions,
    pub external: ExternalModules,
    pub extra_cjs_extensions: Box<[Box<[u8]>]>,
    pub framework: Option<Framework>,
    pub global_cache: bun_options_types::global_cache::GlobalCache,
    pub install: Option<core::ptr::NonNull<bun_options_types::schema::api::BunInstall>>,
    pub load_package_json: bool,
    pub load_tsconfig_json: bool,
    pub main_field_extension_order: Box<[Box<[u8]>]>,
    pub main_fields: Box<[Box<[u8]>]>,
    pub main_fields_is_default: bool,
    pub mark_builtins_as_external: bool,
    pub polyfill_node_globals: bool,
    pub prefer_offline_install: bool,
    pub preserve_symlinks: bool,
    pub rewrite_jest_for_tests: bool,
    pub tsconfig_override: Option<Box<[u8]>>,
    pub production: bool,
    pub force_node_env: ForceNodeEnv,
    // Bundler-only fields read via `c.resolver.opts` in
    // `linker_context/*` (Zig stores the full `BundleOptions` on the
    // resolver). Projected by `bun_bundler` at link time.
    pub output_dir: Box<[u8]>,
    pub root_dir: Box<[u8]>,
    pub public_path: Box<[u8]>,
    pub compile: bool,
    pub supports_multiple_outputs: bool,
    pub tree_shaking: bool,
    pub allow_runtime: bool,
}

impl Default for BundleOptions {
    fn default() -> Self {
        BundleOptions {
            target: Target::default(),
            packages: Packages::default(),
            jsx: jsx::Pragma::default(),
            extension_order: ExtensionOrder::default(),
            conditions: Conditions::default(),
            external: ExternalModules::default(),
            extra_cjs_extensions: Box::default(),
            framework: None,
            global_cache: Default::default(),
            install: None,
            load_package_json: true,
            load_tsconfig_json: true,
            main_field_extension_order: owned_string_list(
                bundle_options::defaults::EXTENSION_ORDER,
            ),
            main_fields: owned_string_list(DEFAULT_MAIN_FIELDS.get(Target::default())),
            main_fields_is_default: true,
            mark_builtins_as_external: false,
            polyfill_node_globals: false,
            prefer_offline_install: false,
            preserve_symlinks: false,
            rewrite_jest_for_tests: false,
            tsconfig_override: None,
            output_dir: Box::default(),
            root_dir: Box::default(),
            public_path: Box::default(),
            compile: false,
            supports_multiple_outputs: true,
            tree_shaking: false,
            allow_runtime: true,
            production: false,
            force_node_env: ForceNodeEnv::default(),
        }
    }
}

impl BundleOptions {
    /// Port of `options.zig:1825 BundleOptions.setProduction`.
    pub fn set_production(&mut self, value: bool) {
        if self.force_node_env == ForceNodeEnv::Unspecified {
            self.production = value;
            self.jsx.development = !value;
        }
    }
}

pub(crate) struct TargetMainFields;

static DEFAULT_MAIN_FIELDS_NODE: &[&[u8]] = &[b"main", b"module"];

static DEFAULT_MAIN_FIELDS_BROWSER: &[&[u8]] = &[b"browser", b"module", b"jsnext:main", b"main"];
static DEFAULT_MAIN_FIELDS_BUN: &[&[u8]] = &[b"module", b"main", b"jsnext:main"];

impl TargetMainFields {
    pub(crate) fn get(&self, t: Target) -> &'static [&'static [u8]] {
        match t {
            Target::Node => DEFAULT_MAIN_FIELDS_NODE,
            Target::Browser => DEFAULT_MAIN_FIELDS_BROWSER,
            Target::Bun | Target::BunMacro | Target::BakeServerComponentsSsr => {
                DEFAULT_MAIN_FIELDS_BUN
            }
        }
    }
}
pub(crate) const DEFAULT_MAIN_FIELDS: TargetMainFields = TargetMainFields;
