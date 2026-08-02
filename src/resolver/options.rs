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
        pub(crate) mod node_modules {
            pub(crate) const EXTENSION_ORDER: &[&[u8]] = &[
                b".jsx", b".cjs", b".js", b".mjs", b".mts", b".tsx", b".ts", b".cts", b".json",
            ];
            pub(crate) const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
                b".mjs", b".jsx", b".js", b".mts", b".tsx", b".ts", b".cjs", b".cts", b".json",
            ];
        }
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
    pub prefer_offline_install: bool,
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

impl Default for BundleOptions {
    /// Only the fields the resolver
    /// reads — `bun_bundler::Transpiler::init` overlays the per-field
    /// projections it can map (target/packages/jsx/bools/global_cache/…)
    /// before handing this to `Resolver::init1`.
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
    pub fn set_production(&mut self, value: bool) {
        if self.force_node_env == ForceNodeEnv::Unspecified {
            self.production = value;
            self.jsx.development = !value;
        }
    }
}

// These are the per-target default `--main-fields` orderings. `BundleOptions.main_fields`
// is initialised to alias one of these slices, and the
// resolver's `auto_main` heuristic at `load_as_main_field` compares the *pointer* of
// `opts.main_fields` against `DEFAULT_MAIN_FIELDS.get(opts.target)` to detect whether the
// user explicitly set a main-fields list. The previous `&[]` stub made that check always
// false, silently disabling the module-vs-main dual-resolution path.
struct TargetMainFields;

// Note that this means if a package specifies "module" and "main", the ES6
// module will not be selected. This means tree shaking will not work when
// targeting node environments.
//
// Some packages incorrectly treat the "module" field as "code for the browser". It
// actually means "code for ES6 environments" which includes both node and the browser.
//
// For example, the package "@firebase/app" prints a warning on startup about
// the bundler incorrectly using code meant for the browser if the bundler
// selects the "module" field instead of the "main" field.
//
// This is unfortunate but it's a problem on the side of those packages.
// They won't work correctly with other popular bundlers (with node as a target) anyway.
static DEFAULT_MAIN_FIELDS_NODE: &[&[u8]] = &[b"main", b"module"];

// Note that this means if a package specifies "main", "module", and
// "browser" then "browser" will win out over "module". This is the
// same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
//
// This is deliberate because the presence of the "browser" field is a
// good signal that this should be preferred. Some older packages might only use CJS in their "browser"
// but in such a case they probably don't have any ESM files anyway.
static DEFAULT_MAIN_FIELDS_BROWSER: &[&[u8]] = &[b"browser", b"module", b"jsnext:main", b"main"];
static DEFAULT_MAIN_FIELDS_BUN: &[&[u8]] = &[b"module", b"main", b"jsnext:main"];

impl TargetMainFields {
    fn get(&self, t: Target) -> &'static [&'static [u8]] {
        match t {
            Target::Node => DEFAULT_MAIN_FIELDS_NODE,
            Target::Browser => DEFAULT_MAIN_FIELDS_BROWSER,
            Target::Bun | Target::BunMacro | Target::ServerComponentsSsr => DEFAULT_MAIN_FIELDS_BUN,
        }
    }
}
const DEFAULT_MAIN_FIELDS: TargetMainFields = TargetMainFields;
