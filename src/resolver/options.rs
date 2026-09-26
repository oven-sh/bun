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
pub(crate) use bun_ast::Target;
pub use bun_options_types::bundle_enums::ModuleType;

// Byte view of the canonical `Target::MAIN_FIELD_NAMES`; `PackageJSON::parse` reads the whole union.
pub const ALL_DEFAULT_MAIN_FIELD_NAMES: [&[u8]; 4] = [
    Target::MAIN_FIELD_NAMES[0].as_bytes(),
    Target::MAIN_FIELD_NAMES[1].as_bytes(),
    Target::MAIN_FIELD_NAMES[2].as_bytes(),
    Target::MAIN_FIELD_NAMES[3].as_bytes(),
];

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Packages {
    #[default]
    Bundle,
    External,
}

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
/// Re-export the real set type so `bun_bundler` can project user-supplied
/// `--external` `abs_paths`/`node_modules` through. The previous local ZST
/// stub returned `count() == 0` / `contains(..) == false`, so the resolver
/// silently ignored every `--external` absolute path / package name.
pub use bun_collections::StringSet;

#[derive(Default)]
pub struct Conditions {
    pub import: crate::package_json::ConditionsMap,
    pub require: crate::package_json::ConditionsMap,
    pub style: crate::package_json::ConditionsMap,
}

/// `Copy` tag selecting one of the extension-order lists owned by
/// [`BundleOptions`]. Replaces the previous `*const [Box<[u8]>]`
/// self-reference (`Resolver.extension_order` pointing into
/// `Resolver.opts`) with a value type. The tag is
/// `Copy`, and the actual slice is resolved on demand via
/// [`BundleOptions::ext_order_slice`] / [`Resolver::extension_order`].
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
    /// `opts.extension_order.css`
    Css,
    /// `opts.main_field_extension_order` — used when resolving the `"main"`
    /// package.json field.
    MainField,
}

/// Convert a `&[&[u8]]` default constant into the owned form the resolver
/// stores. Mirrors `bun_bundler::options::owned_string_list`.
pub fn owned_string_list(s: &[&[u8]]) -> Box<[Box<[u8]>]> {
    s.iter().map(|s| Box::<[u8]>::from(*s)).collect()
}

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
impl ExtensionOrder {
    /// Returns the
    /// [`ExtOrder`] tag; resolve to a slice via
    /// [`BundleOptions::ext_order_slice`].
    pub(crate) fn kind(&self, kind: bun_ast::ImportKind, is_node_modules: bool) -> ExtOrder {
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
    /// Resolve an [`ExtOrder`] tag to the slice it names inside `self`.
    /// All targets are `Box<[Box<[u8]>]>` owned by `self` and never
    /// reallocated after `Resolver::init1`, so the returned borrow is
    /// stable for the resolver's lifetime.
    #[inline]
    pub(crate) fn ext_order_slice(&self, tag: ExtOrder) -> &[Box<[u8]>] {
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
    pub mod defaults {
        pub const CSS_EXTENSION_ORDER: &[&[u8]] = &[b".css"];
    }
}

// B-3 UNIFIED: FORWARD_DECL dropped — canonical type moved down to
// `bun_options_types::bundle_enums::ForceNodeEnv`. Re-exported so the
// `options::ForceNodeEnv` path and the field on the local `BundleOptions`
// subset stay source-compatible.
pub use ::bun_options_types::ForceNodeEnv;

/// Bake `Framework` — only the
/// `built_in_modules` field, which is the sole resolver-read member.
pub struct Framework {
    pub built_in_modules: bun_collections::StringArrayHashMap<bun_options_types::BuiltInModule>,
}

/// Resolver-tier `BundleOptions` — the canonical resolver-input struct.
/// `bun_bundler::options::BundleOptions` (the ~200-field CLI/config
/// aggregate) projects into this via
/// `bun_bundler::transpiler::resolver_bundle_options_subset`; the bundler
/// depends on this crate, so this type is the lower-tier source of truth
/// for everything resolution reads.
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
    // The bundler
    // projects this from its own `Option<NonNull<api::BunInstall>>` field
    // (CLI-owned `Box<BunInstall>`, process-lifetime).
    pub install: Option<core::ptr::NonNull<bun_options_types::schema::api::BunInstall>>,
    pub load_package_json: bool,
    pub load_tsconfig_json: bool,
    pub main_field_extension_order: Box<[Box<[u8]>]>,
    pub main_fields: Box<[Box<[u8]>]>,
    /// `auto_main` compares the *pointer* of
    /// `opts.main_fields` against `Target.DefaultMainFields.get(target)` to
    /// detect "user did not pass --main-fields". The bundler stores an owned
    /// `Box<[Box<[u8]>]>` whose pointer can never match a static, so the
    /// bundler projects this flag explicitly instead.
    pub main_fields_is_default: bool,
    pub mark_builtins_as_external: bool,
    pub polyfill_node_globals: bool,
    pub install_preference: bun_options_types::offline_mode::OfflineMode,
    pub preserve_symlinks: bool,
    pub rewrite_jest_for_tests: bool,
    pub tsconfig_override: Option<Box<[u8]>>,
    pub production: bool,
    pub force_node_env: ForceNodeEnv,
    // Bundler-only fields read via `c.resolver.opts` in
    // `linker_context/*`. Projected by `bun_bundler` at link time.
    pub output_dir: Box<[u8]>,
    pub root_dir: Box<[u8]>,
    pub public_path: Box<[u8]>,
    pub compile: bool,
    pub supports_multiple_outputs: bool,
    pub tree_shaking: bool,
    pub allow_runtime: bool,
}

impl BundleOptions {
    pub fn set_production(&mut self, value: bool) {
        if self.force_node_env == ForceNodeEnv::Unspecified {
            self.production = value;
            self.jsx.development = !value;
        }
    }
}
