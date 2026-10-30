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
use bun_core::strings;
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
    /// The package names that the build was given and, under `--target=node`, the Node builtins.
    pub node_modules: StringSet,
    /// The package names that the build was given: those of `external`, with the `node:` spelling
    /// of each Node builtin among them, and the dependencies of a library. They are decided
    /// before any lookup.
    pub user_names: ExternalNames,
}
impl Clone for ExternalModules {
    fn clone(&self) -> Self {
        // `StringSet::clone` is an inherent fallible method (returns
        // `Result<_, AllocError>`), so this can't be `#[derive(Clone)]`.
        Self {
            patterns: self.patterns.clone(),
            abs_paths: self.abs_paths.clone().expect("oom"),
            node_modules: self.node_modules.clone().expect("oom"),
            user_names: self.user_names.clone(),
        }
    }
}
impl ExternalModules {
    /// Adds a package name that the build was given.
    pub fn add_user_name(&mut self, name: &[u8]) {
        bun_core::handle_oom(self.node_modules.insert(name));
        self.user_names.insert(name);
    }
}

/// A set of package names, and the length of the longest one.
#[derive(Default)]
pub struct ExternalNames {
    names: StringSet,
    max_len: usize,
}
impl Clone for ExternalNames {
    fn clone(&self) -> Self {
        Self {
            names: self.names.clone().expect("oom"),
            max_len: self.max_len,
        }
    }
}
impl ExternalNames {
    pub fn insert(&mut self, name: &[u8]) {
        bun_core::handle_oom(self.names.insert(name));
        self.max_len = self.max_len.max(name.len());
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.names.count() == 0
    }

    /// Whether `import_path` is one of the packages, or a path into one.
    pub fn matches(&self, import_path: &[u8]) -> bool {
        !self.is_empty()
            && bun_paths::is_package_path(import_path)
            && match_name(&self.names, self.max_len, import_path).is_some()
    }
}

/// The key of `names` that is `import_path` or a package that holds it: `foo` for `foo/bar`.
///
/// `max_len` bounds the length of every key. No longer prefix is hashed, so the `/`s of a
/// megabyte `data:` URL cost nothing.
// Inlined: as a call, it costs every resolution a few instructions in `resolve_without_symlinks`.
#[inline(always)]
pub fn match_name<'a>(
    names: &StringSet,
    max_len: usize,
    import_path: &'a [u8],
) -> Option<&'a [u8]> {
    // Imports like "process/" need to resolve to the filesystem, not a builtin
    if import_path.ends_with(b"/") {
        return None;
    }
    let mut query = import_path;
    if query.len() > max_len {
        let slash = strings::last_index_of_char(&query[..=max_len], b'/')?;
        query = &query[..slash];
    }
    loop {
        if names.contains(query) {
            return Some(query);
        }
        // If the module "foo" has been marked as external, we also want to treat
        // paths into that module such as "foo/bar" as external too.
        let slash = strings::last_index_of_char(query, b'/')?;
        query = &query[..slash];
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
    /// `opts.extension_order.required_by_package`
    RequiredByPackage,
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
    /// Replaces `default.default` for a `require()` in a file under `node_modules`, unless it's empty.
    pub required_by_package: Box<[Box<[u8]>]>,
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
            ExtOrder::RequiredByPackage => &self.extension_order.required_by_package,
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
    /// The file at `tsconfig_override`, once `Resolver::tsconfig_override` has read it.
    /// `Some(None)`: it cannot be read.
    pub tsconfig_override_json: Option<Option<std::sync::Arc<crate::tsconfig_json::TSConfigJSON>>>,
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
    /// A package that probes the project with `require.resolve()` finds what it finds in Node.js, which doesn't add
    /// `.ts`. `extra_cjs_extensions` still count.
    pub fn packages_require_like_node(&mut self) {
        self.extension_order.required_by_package = owned_string_list(&[b".js", b".json", b".node"]);
    }

    pub fn set_production(&mut self, value: bool) {
        if self.force_node_env == ForceNodeEnv::Unspecified {
            self.production = value;
            self.jsx.development = !value;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bstr::BStr;

    fn with_names(names: &[&[u8]]) -> ExternalModules {
        let mut externals = ExternalModules::default();
        for name in names {
            externals.add_user_name(name);
        }
        externals
    }

    #[test]
    fn user_name_includes_subpaths() {
        let externals = with_names(&[b"@scope/pkg", b"foo"]);
        let inside: [&[u8]; 5] = [
            b"foo",
            b"foo/bar",
            b"foo/bar/baz.js",
            b"@scope/pkg",
            b"@scope/pkg/sub",
        ];
        for path in inside {
            let is_external = externals.user_names.matches(path);
            assert!(is_external, "{} is not external", BStr::new(path));
        }
        let outside: [&[u8]; 10] = [
            b"foobar",
            b"foo/",
            b"foo/bar/",
            b"fo",
            b"@scope",
            b"@scope/other",
            b"./foo",
            b"../foo/bar",
            b"/foo",
            b"",
        ];
        for path in outside {
            let is_external = externals.user_names.matches(path);
            assert!(!is_external, "{} is external", BStr::new(path));
        }
    }

    #[test]
    fn builtin_name_is_not_a_user_name() {
        let mut externals = ExternalModules::default();
        externals.node_modules.insert(b"fs").unwrap();
        assert!(!externals.user_names.matches(b"fs"));
        assert!(!externals.user_names.matches(b"fs/promises"));
    }

    #[test]
    fn user_name_is_also_in_node_modules() {
        let externals = with_names(&[b"foo"]);
        assert_eq!(
            match_name(&externals.node_modules, usize::MAX, b"foo/bar"),
            Some(&b"foo"[..])
        );
    }

    /// Every text of up to 8 bytes over `a`, `b` and `/`, a longer text with one `/` at each
    /// position, and a text shaped like a base64 `data:` URL.
    #[test]
    fn bound_on_name_length_changes_no_match() {
        let ExternalNames { names, max_len } =
            with_names(&[b"a", b"a/b", b"ab/a/b", b"b/a", b"data:a"]).user_names;
        assert_eq!(max_len, 6);

        let mut paths: Vec<Vec<u8>> = vec![Vec::new()];
        let mut start = 0;
        for _ in 0..8 {
            let end = paths.len();
            for index in start..end {
                for byte in *b"ab/" {
                    let mut path = paths[index].clone();
                    path.push(byte);
                    paths.push(path);
                }
            }
            start = end;
        }
        for slash in 0..64 {
            let mut path = vec![b'a'; 64];
            path[slash] = b'/';
            paths.push(path);
        }
        for mime in [&b"data:a/b;base64,"[..], b"data:ab/a;base64,"] {
            paths.push([mime, &b"ab/a+b/a".repeat(512)].concat());
        }

        let mut matched = 0;
        for path in &paths {
            let bounded = match_name(&names, max_len, path);
            let unbounded = match_name(&names, usize::MAX, path);
            assert_eq!(bounded, unbounded, "{}", BStr::new(path));
            matched += usize::from(bounded.is_some());
        }
        assert!(matched > 0 && matched < paths.len());
    }
}
