#![allow(dead_code, unused_variables, unused_imports, unused_mut)]
use bun_collections::VecExt;
use core::ffi::c_void;
use std::io::Write as _;

use bun_ast as js_ast;
use bun_collections::{ArrayHashMap, MultiArrayList, StringArrayHashMap};
use bun_core::Output;
use bun_core::strings;
use bun_js_parser::lexer as js_lexer;
use bun_paths::{self as resolve_path, PathBuffer, SEP_STR};
use bun_semver as Semver;
use bun_semver::String as SemverString;

use bun_options_types::bundle_enums::ModuleType;
use bun_sys::Fd;

use crate as resolver;
use crate::fs;
use bun_alloc::Arena as Bump;
use bun_wyhash::Wyhash;

// ── bun_install types (MOVE_DOWN: bun_install_types) ──────────────────────
// Note: bun_resolver cannot depend on bun_install (would loop). The
// auto-install path is dormant until `bun_install` writes `r.package_manager`;
// all install-tier value types are the canonical `bun_install_types` shapes.

pub use ::bun_install_types::resolver_hooks::{
    Architecture, AutoInstaller, Behavior as DepBehavior, Dependency, DependencyGroup,
    DependencyVersion, DependencyVersionTag, OperatingSystem,
};
pub use ::bun_install_types::resolver_hooks::{INVALID_PACKAGE_ID, PackageID};

/// Compat namespace: older callers spell `install_stubs::Version::Tag` etc.
/// Everything re-exports `bun_install_types::resolver_hooks` — no local stubs.
#[allow(non_snake_case)]
pub mod install_stubs {
    pub use ::bun_install_types::resolver_hooks::{
        Architecture, AutoInstaller, Behavior as DepBehavior, Dependency, DependencyGroup,
        DependencyVersion, OperatingSystem,
    };
    pub mod Version {
        pub use ::bun_install_types::resolver_hooks::DependencyVersion as Version;
        pub use ::bun_install_types::resolver_hooks::DependencyVersionTag as Tag;
    }
}
// TODO(b2-blocked): bun_bundler::options::{Framework, RouteConfig} — local opaque
// FORWARD_DECL: legacy `options::Framework` and friends. The Zig
// `package_json.zig:loadFramework*` block references `options.Framework`, which
// no longer exists in `options.zig` (removed upstream); the loaders have no
// callers. Port the field-shape locally so the bodies compile as-written —
// MOVE_DOWN to `bun_options_types` if/when `bun_bundler` revives these.
pub mod options {
    use bun_options_types::schema::api;

    pub use api::DotEnvBehavior as EnvBehavior;

    #[derive(Default, Clone)]
    pub struct EnvDefault {
        pub key: Box<[u8]>,
        pub value: Box<[u8]>,
    }

    #[derive(Default, Clone)]
    pub struct Env {
        pub behavior: EnvBehavior,
        pub prefix: Box<[u8]>,
        pub defaults: Vec<EnvDefault>,
    }
    impl Env {
        pub fn init() -> Env {
            Env::default()
        }
        /// `options.zig` Env::setBehaviorFromPrefix.
        pub fn set_behavior_from_prefix(&mut self, prefix: Box<[u8]>) {
            self.behavior = EnvBehavior::disable;
            self.prefix = Box::default();
            if &*prefix == b"*" {
                self.behavior = EnvBehavior::load_all;
            } else if !prefix.is_empty() {
                self.behavior = EnvBehavior::prefix;
                self.prefix = prefix;
            }
        }
    }

    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub enum EntryPointKind {
        Client,
        Server,
        Fallback,
        #[default]
        Disabled,
    }

    #[derive(Default, Clone)]
    pub struct EntryPoint {
        pub path: Box<[u8]>,
        pub env: Env,
        pub kind: EntryPointKind,
    }
    impl EntryPoint {
        pub fn is_enabled(&self) -> bool {
            self.kind != EntryPointKind::Disabled && !self.path.is_empty()
        }
    }

    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub enum CssInJs {
        #[default]
        AutoOnimportcss,
        Facade,
        FacadeOnimportcss,
    }

    #[derive(Default)]
    pub struct Framework {
        pub client: EntryPoint,
        pub server: EntryPoint,
        pub fallback: EntryPoint,
        pub client_css_in_js: CssInJs,
        pub override_modules: api::StringMap,
        pub display_name: Box<[u8]>,
        pub version: Box<[u8]>,
        pub package: Box<[u8]>,
        pub development: bool,
        pub from_bundle: bool,
        pub resolved_dir: Box<[u8]>,
    }

    #[derive(Default)]
    pub struct RouteConfig {
        pub static_dir: Box<[u8]>,
        pub static_dir_enabled: bool,
        pub asset_prefix_path: Box<[u8]>,
        pub routes_enabled: bool,
        pub dir: Box<[u8]>,
        pub possible_dirs: Box<[Box<[u8]>]>,
    }
}
use bun_options_types::schema::api;
// TODO(b2-blocked): bun_collections::StringMap (array-backed string→string map)
pub type StringMap = StringArrayHashMap<Box<[u8]>>;
pub use bun_collections::StringHashMapUnownedKey;
use bun_glob as glob;

// Assume they're not going to have hundreds of main fields or browser map
// so use an array-backed hash table instead of bucketed
pub type BrowserMap = StringMap;
/// Values are owned (Zig: `[]const u8` borrowing the package.json source
/// buffer). Owned `Box<[u8]>` here so callers (CLI bunfig → bundler options)
/// can populate without `unsafe` lifetime-extension casts.
pub type MacroImportReplacementMap = StringArrayHashMap<Box<[u8]>>;
pub type MacroMap = StringArrayHashMap<MacroImportReplacementMap>;

type ScriptsMap = StringArrayHashMap<&'static [u8]>; // TODO(port): lifetime — values borrow source buffer

pub type MainFieldMap = StringMap;

#[derive(Default)]
pub struct DependencyMap {
    pub map: DependencyHashMap,
    // TODO(port): lifetime — borrows the package.json source contents
    pub source_buf: &'static [u8],
}

impl Clone for DependencyMap {
    /// Zig copies `DependencyMap` by value (the inner `ArrayHashMap` is a
    /// pointer + len, so the copy aliases the same backing storage). Rust
    /// owns the storage, so we deep-clone the small key/value vecs instead —
    /// `SemverString`/`Dependency` are POD over `source_buf`, so semantics
    /// match the Zig shallow copy.
    fn clone(&self) -> Self {
        Self {
            map: self.map.clone().expect("OOM"),
            source_buf: self.source_buf,
        }
    }
}

// PORT NOTE: Zig had `DependencyMap.HashMap` as a nested decl; Rust inherent impls cannot carry associated type aliases (stable), so use a free alias.
pub type DependencyHashMap =
    ArrayHashMap<SemverString, Dependency /* , SemverString::ArrayHashContext */>;
// TODO(port): ArrayHashMap context param — Zig used String.ArrayHashContext with store_hash=false

pub struct PackageJSON {
    pub name: Box<[u8]>,
    pub source: bun_ast::Source,
    /// PORT NOTE: owns the file bytes that `source.contents` (and the
    /// `&'static [u8]` map values below) borrow. Replaces the prior
    /// `mem::forget` leak — forbidden per docs/PORTING.md §Forbidden patterns.
    /// Zig (`package_json.zig:615`) used `bun.default_allocator` and never
    /// freed on success because the DirInfo cache is process-lifetime; here the
    /// `PackageJSON` itself is the owner so the bytes free if it ever drops.
    // TODO(port): lifetime — once `bun_ast::Source::contents` becomes
    // `Cow<'static, [u8]>`, fold this into `source` and drop the re-borrow.
    pub source_contents: Box<[u8]>,
    pub main_fields: MainFieldMap,
    pub module_type: ModuleType,
    pub version: Box<[u8]>,

    pub scripts: Option<Box<ScriptsMap>>,
    pub config: Option<Box<StringArrayHashMap<&'static [u8]>>>, // TODO(port): value lifetime

    pub arch: Architecture,
    pub os: OperatingSystem,

    pub package_manager_package_id: PackageID,
    pub dependencies: DependencyMap,

    pub side_effects: SideEffects,

    // Populated if the "browser" field is present. This field is intended to be
    // used by bundlers and lets you redirect the paths of certain 3rd-party
    // modules that don't work in the browser to other modules that shim that
    // functionality. That way you don't have to rewrite the code for those 3rd-
    // party modules. For example, you might remap the native "util" node module
    // to something like https://www.npmjs.com/package/util so it works in the
    // browser.
    //
    // This field contains a mapping of absolute paths to absolute paths. Mapping
    // to an empty path indicates that the module is disabled. As far as I can
    // tell, the official spec is an abandoned GitHub repo hosted by a user account:
    // https://github.com/defunctzombie/package-browser-field-spec. The npm docs
    // say almost nothing: https://docs.npmjs.com/files/package.json.
    //
    // Note that the non-package "browser" map has to be checked twice to match
    // Webpack's behavior: once before resolution and once after resolution. It
    // leads to some unintuitive failure cases that we must emulate around missing
    // file extensions:
    //
    // * Given the mapping "./no-ext": "./no-ext-browser.js" the query "./no-ext"
    //   should match but the query "./no-ext.js" should NOT match.
    //
    // * Given the mapping "./ext.js": "./ext-browser.js" the query "./ext.js"
    //   should match and the query "./ext" should ALSO match.
    //
    pub browser_map: BrowserMap,

    pub exports: Option<ExportsMap>,
    pub imports: Option<ExportsMap>,
}

// PORT NOTE: hand-rolled `Default` because `#[derive(Default)]` would zero
// `package_manager_package_id` (a valid lockfile id — typically the root
// package). Spec `package_json.zig:68` declares the field default as
// `Install.invalid_package_id` (= `u32::MAX`); `node_fallbacks.rs` relies on
// `..Default::default()` matching that. Likewise `arch`/`os` default to
// `*::all()` (zig:65-66).
impl Default for PackageJSON {
    fn default() -> Self {
        PackageJSON {
            name: Box::default(),
            source: bun_ast::Source::default(),
            source_contents: Box::default(),
            main_fields: MainFieldMap::default(),
            module_type: ModuleType::default(),
            version: Box::default(),
            scripts: None,
            config: None,
            arch: Architecture::all(),
            os: OperatingSystem::all(),
            package_manager_package_id: INVALID_PACKAGE_ID,
            dependencies: DependencyMap::default(),
            side_effects: SideEffects::default(),
            browser_map: BrowserMap::default(),
            exports: None,
            imports: None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LoadFramework {
    None,
    Development,
    Production,
}

pub struct FrameworkRouterPair<'a> {
    pub framework: &'a mut options::Framework,
    pub router: &'a mut options::RouteConfig,
    pub loaded_routes: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IncludeScripts {
    IgnoreScripts,
    IncludeScripts,
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum IncludeDependencies {
    Main,
    Local,
    None,
}

const NODE_MODULES_PATH: &str = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR);

impl ::bun_install_types::resolver_hooks::PackageJsonView for PackageJSON {
    fn name(&self) -> &[u8] {
        &self.name
    }
    fn version(&self) -> &[u8] {
        &self.version
    }
    fn source_path(&self) -> &[u8] {
        self.source.path.text
    }
    fn dependency_source_buf(&self) -> &[u8] {
        self.dependencies.source_buf
    }
    fn arch(&self) -> Architecture {
        self.arch
    }
    fn os(&self) -> OperatingSystem {
        self.os
    }
    fn dependency_iter(&self) -> Box<dyn Iterator<Item = (&[u8], &Dependency)> + '_> {
        let buf = self.dependencies.source_buf;
        Box::new(
            self.dependencies
                .map
                .iter()
                .map(move |(k, v)| (k.slice(buf), v)),
        )
    }
}

impl PackageJSON {
    // pub const new = bun.TrivialNew(@This());
    // pub const deinit = bun.TrivialDeinit(@This());
    // TODO(port): TrivialNew/TrivialDeinit — use Box::new / Drop

    pub fn name_for_import(&self) -> Result<Box<[u8]>, bun_core::Error> {
        // TODO(port): narrow error set
        if strings::index_of(self.source.path.text, NODE_MODULES_PATH.as_bytes()).is_some() {
            Ok(Box::from(&*self.name))
        } else {
            let parent = self.source.path.name.dir_with_trailing_slash();
            let top_level_dir = fs::FileSystem::instance().top_level_dir;
            if let Some(i) = strings::index_of(parent, top_level_dir) {
                let relative_dir = &parent[i + top_level_dir.len()..];
                let mut out_dir = vec![0u8; relative_dir.len() + 2];
                out_dir[2..].copy_from_slice(relative_dir);
                out_dir[0] = b'.';
                out_dir[1] = bun_paths::SEP;
                return Ok(out_dir.into_boxed_slice());
            }

            Ok(Box::from(&*self.name))
        }
    }

    /// Normalize path separators to forward slashes for glob matching
    /// This is needed because glob patterns use forward slashes but Windows uses backslashes
    fn normalize_path_for_glob(path: &[u8]) -> Result<Vec<u8>, bun_alloc::AllocError> {
        let mut normalized = path.to_vec();
        bun_paths::slashes_to_posix_in_place(&mut normalized[..]);
        Ok(normalized)
    }
}

pub enum SideEffects {
    /// either `package.json` is missing "sideEffects", it is true, or some
    /// other unsupported value. Treat all files as side effects
    Unspecified,
    /// "sideEffects": false
    False,
    /// "sideEffects": ["file.js", "other.js"]
    Map(SideEffectsMap),
    /// "sideEffects": ["side_effects/*.js"]
    Glob(GlobList),
    /// "sideEffects": ["file.js", "side_effects/*.js"] - mixed patterns
    Mixed(MixedPatterns),
}

impl Default for SideEffects {
    fn default() -> Self {
        SideEffects::Unspecified
    }
}

// TODO(port): std.HashMapUnmanaged with StringHashMapUnowned.Key/Adapter and 80% load factor
pub type SideEffectsMap = bun_collections::HashMap<StringHashMapUnownedKey, ()>;

pub type GlobList = Vec<Box<[u8]>>;

pub struct MixedPatterns {
    pub exact: SideEffectsMap,
    pub globs: GlobList,
}

impl SideEffects {
    pub fn has_side_effects(&self, path: &[u8]) -> bool {
        match self {
            SideEffects::Unspecified => true,
            SideEffects::False => false,
            SideEffects::Map(map) => map.contains_key(&StringHashMapUnownedKey::init(path)),
            SideEffects::Glob(glob_list) => {
                // Normalize path for cross-platform glob matching
                let Ok(normalized_path) = PackageJSON::normalize_path_for_glob(path) else {
                    return true;
                };

                for pattern in glob_list.iter() {
                    if glob::r#match(pattern, &normalized_path).matches() {
                        return true;
                    }
                }
                false
            }
            SideEffects::Mixed(mixed) => {
                // First check exact matches
                if mixed
                    .exact
                    .contains_key(&StringHashMapUnownedKey::init(path))
                {
                    return true;
                }
                // Then check glob patterns with normalized path
                let Ok(normalized_path) = PackageJSON::normalize_path_for_glob(path) else {
                    return true;
                };

                for pattern in mixed.globs.iter() {
                    if glob::r#match(pattern, &normalized_path).matches() {
                        return true;
                    }
                }
                false
            }
        }
    }
}

// ── Local extension shims so `parse` can call shapes that live in higher-tier
//    crates (full FileSystem). Bodies forward to bun_paths. ────────────────
//
// PORT NOTE: the former `JsonCachePackageJsonExt` shim trait is removed —
// `JsonCacheVTable` now has a real `parse_package_json` slot and `JsonCache`
// exposes the inherent forwarder (tsconfig_json.rs).
// `bun_bundler::cache::JSON_CACHE_VTABLE` wires it to `bun_parsers::json`.

/// The Zig body calls the threadlocal-buffer `abs`/`join`/`normalize` and
/// immediately dupes the result. Thin extension trait that delegates to
/// `bun_paths::resolve_path` and returns owned `Box<[u8]>` so no `'static`
/// lifetime is fabricated from a threadlocal scratch buffer (forbidden per
/// docs/PORTING.md §Forbidden patterns — "`unsafe { &*(p as *const _) }` to
/// extend a lifetime"). `crate::fs::FileSystem` already has an inherent
/// borrowing `abs(&self) -> &[u8]` (lib.rs); that wins method resolution at
/// call-sites that only need a transient borrow.
pub trait FileSystemPackageJsonExt {
    fn abs_owned(&self, parts: &[&[u8]]) -> Box<[u8]>;
    fn join(&self, parts: &[&[u8]]) -> &'static [u8];
    fn normalize(&self, str: &[u8]) -> Box<[u8]>;
}
impl FileSystemPackageJsonExt for crate::fs::FileSystem {
    fn abs_owned(&self, parts: &[&[u8]]) -> Box<[u8]> {
        // PORT NOTE: Zig `FileSystem.abs` joins against `top_level_dir` into a
        // threadlocal buffer; caller immediately dupes. Return owned to avoid
        // laundering the threadlocal borrow into `'static`.
        let out = resolve_path::resolve_path::join_abs_string::<
            resolve_path::resolve_path::platform::Loose,
        >(self.top_level_dir, parts);
        Box::from(out)
    }
    fn join(&self, parts: &[&[u8]]) -> &'static [u8] {
        resolve_path::resolve_path::join::<resolve_path::resolve_path::platform::Loose>(parts)
    }
    fn normalize(&self, str: &[u8]) -> Box<[u8]> {
        // PORT NOTE: Zig `FileSystem.normalize` (fs.zig) is
        // `path_handler.normalizeString(str, true, .auto)` — collapses `.`/`..`/dup-separators
        // only; it does NOT join against cwd. Writes into a threadlocal buffer;
        // caller immediately dupes. Return owned to avoid laundering the
        // threadlocal borrow into `'static`.
        let out = resolve_path::resolve_path::normalize_string::<
            true,
            resolve_path::resolve_path::platform::Auto,
        >(str);
        Box::from(&*out)
    }
}

// TODO(b2-blocked): bun_bundler::options + bun_ast::Expr full API + bun_install + bun_schema
// — framework/define loaders stay gated until bun_bundler::options lands.

impl PackageJSON {
    fn load_define_defaults(
        env: &mut options::Env,
        json: &js_ast::E::Object,
        bump: &Bump,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut valid_count: usize = 0;
        for prop in json.properties.slice() {
            if !matches!(
                prop.value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .data,
                js_ast::ExprData::EString(_)
            ) {
                continue;
            }
            valid_count += 1;
        }

        env.defaults.truncate(0);
        let _ = env.defaults.reserve(valid_count);

        for prop in json.properties.slice() {
            if !matches!(
                prop.value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .data,
                js_ast::ExprData::EString(_)
            ) {
                continue;
            }
            // PERF(port): was appendAssumeCapacity
            env.defaults.push(options::EnvDefault {
                key: Box::from(
                    prop.key
                        .as_ref()
                        .expect("infallible: prop has key")
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .string(bump)
                        .expect("unreachable"),
                ),
                value: Box::from(
                    prop.value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .string(bump)
                        .expect("unreachable"),
                ),
            });
        }
        Ok(())
    }

    fn load_overrides(framework: &mut options::Framework, json: &js_ast::E::Object, bump: &Bump) {
        let mut valid_count: usize = 0;
        for prop in json.properties.slice() {
            if !matches!(
                prop.value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .data,
                js_ast::ExprData::EString(_)
            ) {
                continue;
            }
            valid_count += 1;
        }

        let mut buffer: Vec<Box<[u8]>> = vec![Box::default(); valid_count * 2];
        // TODO(port): Zig used a single allocation split into keys/values; Rust uses two Vecs
        let mut keys: Vec<Box<[u8]>> = Vec::with_capacity(valid_count);
        let mut values: Vec<Box<[u8]>> = Vec::with_capacity(valid_count);
        let _ = buffer; // unused after reshaping
        for prop in json.properties.slice() {
            if !matches!(
                prop.value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .data,
                js_ast::ExprData::EString(_)
            ) {
                continue;
            }
            keys.push(Box::from(
                prop.key
                    .as_ref()
                    .expect("infallible: prop has key")
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .string(bump)
                    .expect("unreachable"),
            ));
            values.push(Box::from(
                prop.value
                    .as_ref()
                    .expect("infallible: prop has value")
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .string(bump)
                    .expect("unreachable"),
            ));
        }
        framework.override_modules = api::StringMap { keys, values };
    }

    fn load_define_expression(
        env: &mut options::Env,
        json: &js_ast::E::Object,
        bump: &Bump,
    ) -> Result<(), bun_core::Error> {
        for prop in json.properties.slice() {
            match &prop.key.as_ref().expect("infallible: prop has key").data {
                js_ast::ExprData::EString(e_str) => {
                    let str = e_str.string(bump).unwrap_or_default();

                    if str == b"defaults" {
                        match &prop
                            .value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .data
                        {
                            js_ast::ExprData::EObject(obj) => {
                                Self::load_define_defaults(env, obj, bump)?;
                            }
                            _ => {
                                env.defaults.truncate(0);
                            }
                        }
                    } else if str == b".env" {
                        match &prop
                            .value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .data
                        {
                            js_ast::ExprData::EString(value_str) => {
                                env.set_behavior_from_prefix(Box::from(
                                    value_str.string(bump).unwrap_or_default(),
                                ));
                            }
                            _ => {
                                env.behavior = options::EnvBehavior::disable;
                                env.prefix = Box::default();
                            }
                        }
                    }
                }
                _ => continue,
            }
        }
        Ok(())
    }

    fn load_framework_expression<const READ_DEFINE: bool>(
        framework: &mut options::Framework,
        json: js_ast::Expr,
        bump: &Bump,
    ) -> bool {
        if let Some(client) = json.as_property(b"client") {
            if let Some(str) = client.expr.as_string(bump) {
                if !str.is_empty() {
                    framework.client.path = str.into();
                    framework.client.kind = options::EntryPointKind::Client;
                }
            }
        }

        if let Some(client) = json.as_property(b"fallback") {
            if let Some(str) = client.expr.as_string(bump) {
                if !str.is_empty() {
                    framework.fallback.path = str.into();
                    framework.fallback.kind = options::EntryPointKind::Fallback;
                }
            }
        }

        if let Some(css_prop) = json.as_property(b"css") {
            if let Some(str) = css_prop.expr.as_string(bump) {
                if str == b"onimportcss" {
                    framework.client_css_in_js = options::CssInJs::FacadeOnimportcss;
                } else {
                    framework.client_css_in_js = options::CssInJs::Facade;
                }
            }
        }

        if let Some(override_) = json.as_property(b"override") {
            if let js_ast::ExprData::EObject(obj) = &override_.expr.data {
                Self::load_overrides(framework, obj, bump);
            }
        }

        if READ_DEFINE {
            if let Some(defines) = json.as_property(b"define") {
                let mut skip_fallback = false;
                if let Some(client) = defines.expr.as_property(b"client") {
                    if let js_ast::ExprData::EObject(object) = &client.expr.data {
                        framework.client.env = options::Env::init();

                        let _ =
                            Self::load_define_expression(&mut framework.client.env, object, bump);
                        framework.fallback.env = framework.client.env.clone();
                        skip_fallback = true;
                    }
                }

                if !skip_fallback {
                    if let Some(client) = defines.expr.as_property(b"fallback") {
                        if let js_ast::ExprData::EObject(object) = &client.expr.data {
                            framework.fallback.env = options::Env::init();

                            let _ = Self::load_define_expression(
                                &mut framework.fallback.env,
                                object,
                                bump,
                            );
                        }
                    }
                }

                if let Some(server) = defines.expr.as_property(b"server") {
                    if let js_ast::ExprData::EObject(object) = &server.expr.data {
                        framework.server.env = options::Env::init();

                        let _ =
                            Self::load_define_expression(&mut framework.server.env, object, bump);
                    }
                }
            }
        }

        if let Some(server) = json.as_property(b"server") {
            if let Some(str) = server.expr.as_string(bump) {
                if !str.is_empty() {
                    framework.server.path = str.into();
                    framework.server.kind = options::EntryPointKind::Server;
                }
            }
        }

        framework.client.is_enabled()
            || framework.server.is_enabled()
            || framework.fallback.is_enabled()
    }

    // PORT NOTE: Zig `comptime load_framework: LoadFramework` lowered to a runtime
    // arg — `LoadFramework` is a plain enum (no `ConstParamTy`), and the only
    // use is the trailing `match`. PERF(port): was comptime — irrelevant (dead).
    pub fn load_framework_with_preference<const READ_DEFINES: bool>(
        package_json: &PackageJSON,
        pair: &mut FrameworkRouterPair<'_>,
        json: js_ast::Expr,
        bump: &Bump,
        load_framework: LoadFramework,
    ) {
        let Some(framework_object) = json.as_property(b"framework") else {
            return;
        };

        if let Some(name) = framework_object.expr.as_property(b"displayName") {
            if let Some(str) = name.expr.as_string(bump) {
                if !str.is_empty() {
                    pair.framework.display_name = str.into();
                }
            }
        }

        if let Some(version) = json.get(b"version") {
            if let Some(str) = version.as_string(bump) {
                if !str.is_empty() {
                    pair.framework.version = str.into();
                }
            }
        }

        if let Some(static_prop) = framework_object.expr.as_property(b"static") {
            if let Some(str) = static_prop.expr.as_string(bump) {
                if !str.is_empty() {
                    pair.router.static_dir = str.into();
                    pair.router.static_dir_enabled = true;
                }
            }
        }

        if let Some(asset_prefix) = framework_object.expr.as_property(b"assetPrefix") {
            if let Some(_str) = asset_prefix.expr.as_string(bump) {
                let str = bun_core::trim(&_str, b" ");
                if !str.is_empty() {
                    pair.router.asset_prefix_path = Box::from(str);
                }
            }
        }

        if !pair.router.routes_enabled {
            if let Some(router) = framework_object.expr.as_property(b"router") {
                if let Some(route_dir) = router.expr.as_property(b"dir") {
                    match &route_dir.expr.data {
                        js_ast::ExprData::EString(estr) => {
                            let str = estr.string(bump).expect("unreachable");
                            if !str.is_empty() {
                                pair.router.dir = str.into();
                                pair.router.possible_dirs = Box::default();

                                pair.loaded_routes = true;
                            }
                        }
                        js_ast::ExprData::EArray(array) => {
                            let mut count: usize = 0;
                            let items = array.items.slice();
                            for item in items {
                                count += (matches!(&item.data, js_ast::ExprData::EString(s) if !s.data.is_empty()))
                                    as usize;
                            }
                            match count {
                                0 => {}
                                1 => {
                                    let str = items[0]
                                        .data
                                        .e_string()
                                        .expect("infallible: variant checked")
                                        .string(bump)
                                        .expect("unreachable");
                                    if !str.is_empty() {
                                        pair.router.dir = str.into();
                                        pair.router.possible_dirs = Box::default();

                                        pair.loaded_routes = true;
                                    }
                                }
                                _ => {
                                    let mut list: Vec<Box<[u8]>> = Vec::with_capacity(count);

                                    for item in items {
                                        if let js_ast::ExprData::EString(s) = &item.data {
                                            if !s.data.is_empty() {
                                                list.push(Box::from(
                                                    s.string(bump).expect("unreachable"),
                                                ));
                                            }
                                        }
                                    }

                                    pair.router.dir = list[0].clone();
                                    pair.router.possible_dirs = list.into_boxed_slice();

                                    pair.loaded_routes = true;
                                }
                            }
                        }
                        _ => {}
                    }
                }

                if let Some(extensions_expr) = router.expr.as_property(b"extensions") {
                    if let Some(array_const) = extensions_expr.expr.as_array() {
                        let mut array = array_const;
                        let mut valid_count: usize = 0;

                        while let Some(expr) = array.next() {
                            let js_ast::ExprData::EString(e_str) = &expr.data else {
                                continue;
                            };
                            if e_str.data.is_empty() || e_str.data[0] != b'.' {
                                continue;
                            }
                            valid_count += 1;
                        }

                        if valid_count > 0 {
                            let mut extensions: Vec<&[u8]> = Vec::with_capacity(valid_count);
                            array.index = 0;

                            // We don't need to allocate the strings because we keep the package.json source string in memory
                            while let Some(expr) = array.next() {
                                let js_ast::ExprData::EString(e_str) = &expr.data else {
                                    continue;
                                };
                                if e_str.data.is_empty() || e_str.data[0] != b'.' {
                                    continue;
                                }
                                extensions.push(e_str.data.slice());
                            }
                            // TODO(port): `extensions` is computed but never assigned anywhere (matches Zig)
                            let _ = extensions;
                        }
                    }
                }
            }
        }

        match load_framework {
            LoadFramework::Development => {
                if let Some(env) = framework_object.expr.as_property(b"development") {
                    if Self::load_framework_expression::<READ_DEFINES>(
                        pair.framework,
                        env.expr,
                        bump,
                    ) {
                        pair.framework.package =
                            package_json.name_for_import().expect("unreachable");
                        pair.framework.development = true;
                        if let Some(static_prop) = env.expr.as_property(b"static") {
                            if let Some(str) = static_prop.expr.as_string(bump) {
                                if !str.is_empty() {
                                    pair.router.static_dir = str.into();
                                    pair.router.static_dir_enabled = true;
                                }
                            }
                        }

                        return;
                    }
                }
            }
            LoadFramework::Production => {
                if let Some(env) = framework_object.expr.as_property(b"production") {
                    if Self::load_framework_expression::<READ_DEFINES>(
                        pair.framework,
                        env.expr,
                        bump,
                    ) {
                        pair.framework.package =
                            package_json.name_for_import().expect("unreachable");
                        pair.framework.development = false;

                        if let Some(static_prop) = env.expr.as_property(b"static") {
                            if let Some(str) = static_prop.expr.as_string(bump) {
                                if !str.is_empty() {
                                    pair.router.static_dir = str.into();
                                    pair.router.static_dir_enabled = true;
                                }
                            }
                        }

                        return;
                    }
                }
            }
            _ => unreachable!(), // @compileError("unreachable")
        }

        if Self::load_framework_expression::<READ_DEFINES>(
            pair.framework,
            framework_object.expr,
            bump,
        ) {
            pair.framework.package = package_json.name_for_import().expect("unreachable");
            pair.framework.development = false;
        }
    }
} // end  impl PackageJSON (framework loaders)

impl PackageJSON {
    pub fn parse_macros_json(
        macros: js_ast::Expr,
        log: &mut bun_ast::Log,
        json_source: &bun_ast::Source,
    ) -> MacroMap {
        let mut macro_map = MacroMap::default();
        let js_ast::ExprData::EObject(obj) = &macros.data else {
            return macro_map;
        };

        let properties = obj.properties.slice();

        for property in properties {
            let Some(key_expr) = property.key.as_ref() else {
                continue;
            };
            let Some(key) = key_expr.as_utf8_string_literal() else {
                continue;
            };
            if !resolver::is_package_path(key) {
                log.add_range_warning_fmt(
                    Some(json_source),
                    json_source.range_of_string(key_expr.loc),
                    format_args!(
                        "\"{}\" is not a package path. \"macros\" remaps package paths to macros. Skipping.",
                        bstr::BStr::new(key)
                    ),
                );
                continue;
            }

            let Some(value) = property.value.as_ref() else {
                continue;
            };
            let js_ast::ExprData::EObject(value_obj) = &value.data else {
                log.add_warning_fmt(
                    Some(json_source),
                    value.loc,
                    format_args!(
                        "Invalid macro remapping in \"{}\": expected object where the keys are import names and the value is a string path to replace",
                        bstr::BStr::new(key)
                    ),
                );
                continue;
            };

            let remap_properties = value_obj.properties.slice();
            if remap_properties.is_empty() {
                continue;
            }

            let mut map = MacroImportReplacementMap::default();
            map.reserve(remap_properties.len());
            for remap in remap_properties {
                let Some(remap_key) = remap.key.as_ref() else {
                    continue;
                };
                let Some(import_name) = remap_key.as_utf8_string_literal() else {
                    continue;
                };
                let Some(remap_value) = remap.value.as_ref() else {
                    continue;
                };
                let valid =
                    matches!(&remap_value.data, js_ast::ExprData::EString(s) if !s.data.is_empty());
                if !valid {
                    log.add_warning_fmt(
                        Some(json_source),
                        remap_value.loc,
                        format_args!(
                            "Invalid macro remapping for import \"{}\": expected string to remap to. e.g. \"graphql\": \"bun-macro-relay\" ",
                            bstr::BStr::new(import_name)
                        ),
                    );
                    continue;
                }

                let remap_value_str: &[u8] = match remap_value.data.e_string() {
                    Some(s) => s.data.slice(),
                    None => continue,
                };

                // PERF(port): was putAssumeCapacityNoClobber
                map.insert(import_name, Box::<[u8]>::from(remap_value_str));
            }

            if map.len() > 0 {
                macro_map.insert(key, map);
            }
        }

        macro_map
    }

    pub fn parse<const INCLUDE_DEPENDENCIES: IncludeDependencies>(
        r: &mut resolver::Resolver<'_>,
        input_path: &[u8],
        dirname_fd: Fd,
        package_id: Option<PackageID>,
        include_scripts_: IncludeScripts,
    ) -> Option<PackageJSON> {
        // PERF(port): include_scripts_ was a comptime enum param — profile in Phase B
        let include_scripts = include_scripts_ == IncludeScripts::IncludeScripts;

        // SAFETY: PORT (Stacked Borrows) — `r.fs()`/`r.log()` return RAW `*mut`
        // (see `Resolver::fs()` note in lib.rs). `fs` and `log` are DISTINCT
        // singletons so the two `&mut` projections below do not alias each other,
        // and no other `&mut *r.fs` / `&mut *r.log` retag occurs while they are
        // live in this function. Caller upholds the single-thread `Resolver`
        // aliasing contract (Zig had no borrow split here either — `r.fs`/`r.log`
        // are accessed freely throughout `parse`).
        let r_fs: &mut fs::FileSystem = unsafe { &mut *r.fs() };
        let r_log: &mut bun_ast::Log = unsafe { &mut *r.log() };

        // TODO: remove this extra copy
        let parts: [&[u8]; 2] = [input_path, b"package.json"];
        let package_json_path_ = r_fs.abs(&parts);
        let package_json_path = r_fs
            .dirname_store
            .append_slice(package_json_path_)
            .expect("unreachable");

        // DirInfo cache is reused globally
        // So we cannot free these
        // (allocator dropped — global mimalloc)

        let mut entry = match r.caches.fs.read_file_with_allocator(
            r_fs,
            package_json_path,
            dirname_fd,
            false,
            None,
            None,
        ) {
            Ok(e) => e,
            Err(err) => {
                if err != bun_core::err!("IsDir") {
                    r_log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Cannot read file \"{}\": {}",
                            bstr::BStr::new(input_path),
                            bstr::BStr::new(err.name())
                        ),
                    );
                }

                return None;
            }
        };
        // PORT NOTE: reshaped for borrowck — `mem::take` the contents (leaving
        // `Contents::Empty` behind) so `entry` stays whole for the close-guard.
        // Immediately convert to owned `Box<[u8]>`: `use_shared_buffer = false`
        // above guarantees `Contents::Owned`/`Empty`, so the match is exhaustive
        // in practice (the catch-all copy is unreachable but defensive).
        let entry_contents: Box<[u8]> = match core::mem::take(&mut entry.contents) {
            crate::cache::Contents::Owned(v) => v.into_boxed_slice(),
            crate::cache::Contents::Empty => Box::default(),
            other => Box::from(other.as_slice()),
        };
        let _close_guard = scopeguard::guard(entry, |mut e| {
            let _ = e.close_fd();
        });

        if let Some(debug) = r.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!(
                "The file \"{}\" exists",
                bstr::BStr::new(package_json_path)
            ));
        }

        // PORT NOTE: `bun_ast::Source.path` is the lightweight `bun_paths::fs::Path<'static>` (no
        // `pretty`/`is_node_module`); `key_path` is only used for `text`, so init the
        // source directly from the interned path.
        //
        // TODO(port): lifetime — `bun_ast::Source::contents` is `&'static [u8]`; once
        // it becomes `Cow<'static, [u8]>` move `entry_contents` straight into
        // `json_source` and delete this re-borrow.
        //
        // SAFETY: `entry_contents: Box<[u8]>` is the unique owner of these bytes.
        // On the success path it is *moved* (not leaked) into
        // `package_json.source_contents` at the bottom of this fn, so the heap
        // allocation lives for the life of the returned `PackageJSON` (Zig:
        // `bun.default_allocator`, never freed — "DirInfo cache is reused
        // globally"). On every early `return None` below `entry_contents` drops
        // and frees normally (Zig: `allocator.free(entry.contents)`), after
        // `json_source` is already dead. `Box<[u8]>` heap address is stable
        // across the move.
        let contents_static: &'static [u8] = unsafe { bun_ptr::detach_lifetime(&entry_contents) };
        let json_source = bun_ast::Source::init_path_string(package_json_path, contents_static);

        let json: js_ast::Expr = match r.caches.json.parse_package_json(r_log, &json_source, true) {
            Ok(Some(v)) => v,
            Ok(None) => return None,
            Err(err) => {
                if cfg!(debug_assertions) {
                    Output::print_error(&format_args!(
                        "{}: JSON parse error: {}",
                        bstr::BStr::new(package_json_path),
                        bstr::BStr::new(err.name())
                    ));
                }
                return None;
            }
        };

        if !matches!(json.data, js_ast::ExprData::EObject(_)) {
            // Invalid package.json in node_modules is noisy.
            // Let's just ignore it.
            // (allocator.free dropped — entry.contents owned by `entry`)
            return None;
        }

        let mut package_json = PackageJSON {
            name: Box::default(),
            version: Box::default(),
            // PORT NOTE: reshaped for borrowck — `json_source` stays a local until the
            // end so we can borrow it while mutating other `package_json` fields.
            source: bun_ast::Source::default(),
            // Filled at the bottom by moving `entry_contents` in (see SAFETY note above).
            source_contents: Box::default(),
            module_type: ModuleType::Unknown,
            browser_map: BrowserMap::default(),
            main_fields: MainFieldMap::default(),
            scripts: None,
            config: None,
            arch: Architecture::all(),
            os: OperatingSystem::all(),
            package_manager_package_id: INVALID_PACKAGE_ID,
            dependencies: DependencyMap::default(),
            side_effects: SideEffects::Unspecified,
            exports: None,
            imports: None,
        };
        // PORT NOTE: shadow as `&Source` so the body matches the Zig shape; the
        // owned value is reconstructed at the bottom (Source isn't `Clone`).
        let json_source = &json_source;

        // Note: we tried rewriting this to be fewer loops over all the properties (asProperty loops over each)
        // The end result was: it's not faster! Sometimes, it's slower.
        // It's hard to say why.
        // Feels like a codegen issue.
        // or that looping over every property doesn't really matter because most package.jsons are < 20 properties
        if let Some(version_json) = json.as_property(b"version") {
            if let Some(version_str) = version_json.expr.as_utf8_string_literal() {
                if !version_str.is_empty() {
                    package_json.version = Box::from(version_str);
                }
            }
        }

        if let Some(name_json) = json.as_property(b"name") {
            if let Some(name_str) = name_json.expr.as_utf8_string_literal() {
                if !name_str.is_empty() {
                    package_json.name = Box::from(name_str);
                }
            }
        }

        if let Some(type_json) = json.as_property(b"type") {
            if let Some(type_str) = type_json.expr.as_utf8_string_literal() {
                match ModuleType::LIST
                    .get(type_str)
                    .copied()
                    .unwrap_or(ModuleType::Unknown)
                {
                    ModuleType::Cjs => {
                        package_json.module_type = ModuleType::Cjs;
                    }
                    ModuleType::Esm => {
                        package_json.module_type = ModuleType::Esm;
                    }
                    ModuleType::Unknown => {
                        r_log
                            .add_range_warning_fmt(
                                Some(json_source),
                                json_source.range_of_string(type_json.loc),
                                format_args!(
                                    "\"{}\" is not a valid value for \"type\" field (must be either \"commonjs\" or \"module\")",
                                    bstr::BStr::new(type_str)
                                ),
                            );
                    }
                }
            } else {
                r_log.add_warning(
                    Some(json_source),
                    type_json.loc,
                    b"The value for \"type\" must be a string",
                );
            }
        }

        // Read the "main" fields
        for main in r.opts.main_fields.iter() {
            if let Some(main_json) = json.as_property(main) {
                let expr: &js_ast::Expr = &main_json.expr;

                if let Some(str) = expr.as_utf8_string_literal() {
                    if !str.is_empty() {
                        package_json
                            .main_fields
                            .put(main, Box::from(str))
                            .expect("unreachable");
                    }
                }
            }
        }

        // Read the "browser" property
        // Since we cache parsed package.json in-memory, we have to read the "browser" field
        // including when `target` is not `browser` since the developer may later
        // run a build for the browser in the same process (like the DevServer).
        {
            // We both want the ability to have the option of CJS vs. ESM and the
            // option of having node vs. browser. The way to do this is to use the
            // object literal form of the "browser" field like this:
            //
            //   "main": "dist/index.node.cjs.js",
            //   "module": "dist/index.node.esm.js",
            //   "browser": {
            //     "./dist/index.node.cjs.js": "./dist/index.browser.cjs.js",
            //     "./dist/index.node.esm.js": "./dist/index.browser.esm.js"
            //   },
            //
            if let Some(browser_prop) = json.as_property(b"browser") {
                match &browser_prop.expr.data {
                    js_ast::ExprData::EObject(obj) => {
                        // The value is an object

                        // Remap all files in the browser field
                        for prop in obj.properties.slice() {
                            let Some(key_expr) = prop.key.as_ref() else {
                                continue;
                            };
                            let Some(_key_str) = key_expr.as_utf8_string_literal() else {
                                continue;
                            };
                            let Some(value) = prop.value.as_ref() else {
                                continue;
                            };

                            // Normalize the path so we can compare against it without getting
                            // confused by "./". There is no distinction between package paths and
                            // relative paths for these values because some tools (i.e. Browserify)
                            // don't make such a distinction.
                            //
                            // This leads to weird things like a mapping for "./foo" matching an
                            // import of "foo", but that's actually not a bug. Or arguably it's a
                            // bug in Browserify but we have to replicate this bug because packages
                            // do this in the wild.
                            // PORT NOTE: inherent `FileSystem::normalize` (fs.rs)
                            // returns a threadlocal-backed `&[u8]` and shadows the
                            // owned-returning trait method; UFCS to get the `Box`.
                            let key: Box<[u8]> =
                                FileSystemPackageJsonExt::normalize(r_fs, _key_str);

                            match &value.data {
                                js_ast::ExprData::EString(str) => {
                                    // If this is a string, it's a replacement package
                                    package_json
                                        .browser_map
                                        .put(&key, Box::from(str.data.slice()))
                                        .expect("unreachable");
                                }
                                js_ast::ExprData::EBoolean(boolean) => {
                                    if !boolean.value {
                                        package_json
                                            .browser_map
                                            .put(&key, Box::default())
                                            .expect("unreachable");
                                    }
                                }
                                _ => {
                                    // Only print this warning if its not inside node_modules, since node_modules/ is not actionable.
                                    // PORT NOTE: `bun_paths::fs::Path<'static>` has no `is_node_module`; inline the check.
                                    if !strings::contains(
                                        json_source.path.text,
                                        NODE_MODULES_PATH.as_bytes(),
                                    ) {
                                        r_log.add_warning(
                                            Some(json_source),
                                            value.loc,
                                            b"Each \"browser\" mapping must be a string or boolean",
                                        );
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        if let Some(exports_prop) = json.as_property(b"exports") {
            if let Some(exports_map) =
                ExportsMap::parse(json_source, r_log, exports_prop.expr, exports_prop.loc)
            {
                package_json.exports = Some(exports_map);
            }
        }

        if let Some(imports_prop) = json.as_property(b"imports") {
            if let Some(imports_map) =
                ExportsMap::parse(json_source, r_log, imports_prop.expr, imports_prop.loc)
            {
                package_json.imports = Some(imports_map);
            }
        }

        if let Some(side_effects_field) = json.get(b"sideEffects") {
            if let Some(boolean) = side_effects_field.as_bool() {
                if !boolean {
                    package_json.side_effects = SideEffects::False;
                }
            } else if let js_ast::ExprData::EArray(e_array) = &side_effects_field.data {
                // Handle arrays, including empty arrays
                // PORT NOTE: reshaped — `ArrayIterator` is not `Clone`; iterate the
                // underlying `Vec<Expr>` slice directly for both passes.
                let items = e_array.items.slice();
                let mut map = SideEffectsMap::default();
                let mut glob_list = GlobList::default();
                let mut has_globs = false;
                let mut has_exact = false;

                // First pass: check if we have glob patterns and exact patterns
                for item in items {
                    if let Some(name) = item.as_utf8_string_literal() {
                        if strings::contains_char(name, b'*')
                            || strings::contains_char(name, b'?')
                            || strings::contains_char(name, b'[')
                            || strings::contains_char(name, b'{')
                        {
                            has_globs = true;
                        } else {
                            has_exact = true;
                        }
                    }
                }

                // If the array is empty, treat it as false (no side effects)
                if !has_globs && !has_exact {
                    package_json.side_effects = SideEffects::False;
                } else if has_globs && has_exact {
                    // Mixed patterns - use both exact and glob matching
                    map.reserve(items.len());
                    glob_list.reserve(items.len());

                    for item in items {
                        if let Some(name) = item.as_utf8_string_literal() {
                            // Skip CSS files as they're not relevant for tree-shaking
                            if bun_paths::extension(name) == b".css" {
                                continue;
                            }

                            // Store the pattern relative to the package directory
                            let joined: [&[u8]; 2] =
                                [json_source.path.name.dir_with_trailing_slash(), name];

                            let pattern = r_fs.join(&joined);

                            if strings::contains_char(name, b'*')
                                || strings::contains_char(name, b'?')
                                || strings::contains_char(name, b'[')
                                || strings::contains_char(name, b'{')
                            {
                                // Normalize pattern to use forward slashes for cross-platform compatibility
                                let normalized_pattern = Self::normalize_path_for_glob(pattern)
                                    .unwrap_or_else(|_| pattern.to_vec());
                                // PERF(port): was appendAssumeCapacity
                                glob_list.push(normalized_pattern.into_boxed_slice());
                            } else {
                                // PERF(port): was getOrPutAssumeCapacity
                                let _ = map.insert(StringHashMapUnownedKey::init(pattern), ());
                            }
                        }
                    }
                    package_json.side_effects = SideEffects::Mixed(MixedPatterns {
                        exact: map,
                        globs: glob_list,
                    });
                } else if has_globs {
                    // Only glob patterns
                    glob_list.reserve(items.len());
                    for item in items {
                        if let Some(name) = item.as_utf8_string_literal() {
                            // Skip CSS files as they're not relevant for tree-shaking
                            if bun_paths::extension(name) == b".css" {
                                continue;
                            }

                            // Store the pattern relative to the package directory
                            let joined: [&[u8]; 2] =
                                [json_source.path.name.dir_with_trailing_slash(), name];

                            let pattern = r_fs.join(&joined);
                            // Normalize pattern to use forward slashes for cross-platform compatibility
                            let normalized_pattern = Self::normalize_path_for_glob(pattern)
                                .unwrap_or_else(|_| pattern.to_vec());
                            // PERF(port): was appendAssumeCapacity
                            glob_list.push(normalized_pattern.into_boxed_slice());
                        }
                    }
                    package_json.side_effects = SideEffects::Glob(glob_list);
                } else {
                    // Only exact matches
                    map.reserve(items.len());
                    for item in items {
                        if let Some(name) = item.as_utf8_string_literal() {
                            let joined: [&[u8]; 2] =
                                [json_source.path.name.dir_with_trailing_slash(), name];

                            // PERF(port): was getOrPutAssumeCapacity
                            let _ =
                                map.insert(StringHashMapUnownedKey::init(r_fs.join(&joined)), ());
                        }
                    }
                    package_json.side_effects = SideEffects::Map(map);
                }
            }
        }

        // TODO(b2-blocked): bun_install::{Dependency, Architecture, OperatingSystem,
        // lockfile::Package::DependencyGroup, PackageManager}. The whole
        // dependencies/os/cpu block is install-tier.

        if INCLUDE_DEPENDENCIES == IncludeDependencies::Main
            || INCLUDE_DEPENDENCIES == IncludeDependencies::Local
        {
            'update_dependencies: {
                if let Some(pkg) = package_id {
                    package_json.package_manager_package_id = pkg;
                    break 'update_dependencies;
                }

                // // if there is a name & version, check if the lockfile has the package
                if !package_json.name.is_empty() && !package_json.version.is_empty() {
                    if let Some(pm) = r.auto_installer() {
                        let tag = pm.infer_dependency_tag(&package_json.version);

                        if tag == DependencyVersionTag::Npm {
                            let sliced = Semver::SlicedString::init(
                                &package_json.version,
                                &package_json.version,
                            );
                            if let Some(dependency_version) = pm.parse_dependency_with_tag(
                                SemverString::init(&package_json.name, &package_json.name),
                                Semver::semver_string::Builder::string_hash(&package_json.name),
                                &package_json.version,
                                DependencyVersionTag::Npm,
                                &sliced,
                                r_log,
                            ) {
                                if dependency_version.is_exact_npm() {
                                    if let Some(resolved) =
                                        pm.lockfile_resolve(&package_json.name, &dependency_version)
                                    {
                                        package_json.package_manager_package_id = resolved;
                                        if resolved > 0 {
                                            break 'update_dependencies;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(os_field) = json.get(b"cpu") {
                    if let Some(array_const) = os_field.as_array() {
                        let mut array = array_const;
                        let mut arch = Architecture::none().negatable();
                        while let Some(item) = array.next() {
                            if let Some(str) = item.as_utf8_string_literal() {
                                arch.apply(str);
                            }
                        }

                        package_json.arch = arch.combine();
                    }
                }

                if let Some(os_field) = json.get(b"os") {
                    let tmp = os_field.as_array();
                    if let Some(mut array) = tmp {
                        let mut os = OperatingSystem::none().negatable();
                        while let Some(item) = array.next() {
                            if let Some(str) = item.as_utf8_string_literal() {
                                os.apply(str);
                            }
                        }

                        package_json.os = os.combine();
                    }
                }

                type DependencyGroup = install_stubs::DependencyGroup;
                // TODO(port): comptime feature flags + comptime brk block — expanded inline below
                let dev_deps = INCLUDE_DEPENDENCIES == IncludeDependencies::Main;
                let dependency_groups: &[DependencyGroup] = if dev_deps {
                    &[
                        DependencyGroup::DEPENDENCIES,
                        DependencyGroup::DEV,
                        DependencyGroup::OPTIONAL,
                    ]
                } else {
                    &[DependencyGroup::DEPENDENCIES, DependencyGroup::OPTIONAL]
                };
                // PERF(port): was comptime monomorphization (inline for over comptime array) — profile in Phase B

                let mut total_dependency_count: usize = 0;
                for group in dependency_groups {
                    if let Some(group_json) = json.get(group.field) {
                        if let js_ast::ExprData::EObject(obj) = &group_json.data {
                            total_dependency_count += obj.properties.len_u32() as usize;
                        }
                    }
                }

                if total_dependency_count > 0 {
                    package_json.dependencies.map = DependencyHashMap::default();
                    // TODO(port): lifetime — source_buf borrows json_source.contents
                    package_json.dependencies.source_buf = contents_static;
                    // PORT NOTE: Zig used `SemverString.ArrayHashContext` (compares against
                    // `source_buf`); ArrayHashMap has no `*_context` variant yet — the
                    // generic `put_assume_capacity` path is sufficient because keys are
                    // `SemverString` (offset+len into `source_buf`, hashed by content).
                    package_json
                        .dependencies
                        .map
                        .ensure_total_capacity(total_dependency_count)
                        .expect("unreachable");

                    for group in dependency_groups {
                        if let Some(group_json) = json.get(group.field) {
                            if let js_ast::ExprData::EObject(group_obj) = &group_json.data {
                                for prop in group_obj.properties.slice() {
                                    let Some(name_prop) = prop.key.as_ref() else {
                                        continue;
                                    };
                                    let Some(name_str) = name_prop.as_utf8_string_literal() else {
                                        continue;
                                    };
                                    let name_hash =
                                        Semver::semver_string::Builder::string_hash(name_str);
                                    let name = SemverString::init(
                                        package_json.dependencies.source_buf,
                                        name_str,
                                    );
                                    let Some(version_value) = prop.value.as_ref() else {
                                        continue;
                                    };
                                    let Some(version_str) = version_value.as_utf8_string_literal()
                                    else {
                                        continue;
                                    };
                                    let sliced_str =
                                        Semver::SlicedString::init(version_str, version_str);

                                    // Zig's `Dependency.parse` accepts `?*PackageManager`;
                                    // the parser body lives in install-tier so route through
                                    // the AutoInstaller vtable when one is wired. When it
                                    // isn't, still record the dependency name (with an
                                    // uninitialized-tag version) — `bun run --filter` reads
                                    // only the map keys to compute workspace ordering.
                                    let dependency_version = match r.auto_installer() {
                                        Some(pm) => pm.parse_dependency(
                                            name,
                                            Some(name_hash),
                                            version_str,
                                            &sliced_str,
                                            r_log,
                                        ),
                                        None => Some(DependencyVersion::default()),
                                    };
                                    if let Some(dependency_version) = dependency_version {
                                        let dependency = Dependency {
                                            name,
                                            version: dependency_version,
                                            name_hash,
                                            behavior: group.behavior,
                                        };
                                        // Zig: `putAssumeCapacityContext(name, dep, ctx)` where
                                        // `ctx = SemverString.ArrayHashContext{arg_buf, existing_buf}`.
                                        let buf = package_json.dependencies.source_buf;
                                        let ctx = Semver::semver_string::ArrayHashContext {
                                            arg_buf: buf,
                                            existing_buf: buf,
                                        };
                                        package_json.dependencies.map.put_assume_capacity_context(
                                            dependency.name,
                                            dependency,
                                            |k| ctx.hash(*k),
                                            |a, b, i| ctx.eql(*a, *b, i),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // used by `bun run`
        // PORT NOTE: `Expr::as_property_string_map` returns
        // `ArrayHashMap<&'bump [u8], &'bump [u8]>` (bump-tied lifetimes), but
        // `ScriptsMap` stores `&'static [u8]` borrowing the package.json source
        // bytes (`contents_static`, see SAFETY note above). Inline the
        // string-map walk so values borrow the source buffer, not a temp bump.
        if include_scripts {
            // Local: build a `StringArrayHashMap<&'static [u8]>` for the named
            // top-level object property. Values are JSON string literals, so
            // `as_utf8_string_literal()` (no bump) returns slices into
            // `contents_static`.
            let property_string_map =
                |name: &[u8]| -> Option<Box<StringArrayHashMap<&'static [u8]>>> {
                    let prop = json.as_property(name)?;
                    let js_ast::ExprData::EObject(obj) = &prop.expr.data else {
                        return None;
                    };
                    if obj.properties.len_u32() == 0 {
                        return None;
                    }
                    let mut map = StringArrayHashMap::<&'static [u8]>::default();
                    map.ensure_total_capacity(obj.properties.len_u32() as usize)
                        .ok()?;
                    for p in obj.properties.slice() {
                        let Some(key) = p.key.as_ref().and_then(|k| k.as_utf8_string_literal())
                        else {
                            continue;
                        };
                        let Some(value) = p.value.as_ref().and_then(|v| v.as_utf8_string_literal())
                        else {
                            continue;
                        };
                        if key.is_empty() {
                            continue;
                        }
                        // SAFETY: `key`/`value` borrow `contents_static`; see SAFETY note
                        // on `contents_static` above (owned by the returned PackageJSON).
                        let value: &'static [u8] = unsafe { bun_ptr::detach_lifetime(value) };
                        map.put_assume_capacity(key, value);
                    }
                    Some(Box::new(map))
                };
            if let Some(scripts) = property_string_map(b"scripts") {
                package_json.scripts = Some(scripts);
            }
            if let Some(config) = property_string_map(b"config") {
                package_json.config = Some(config);
            }
        }
        let _ = (include_scripts, package_id);

        // PORT NOTE: reshaped for borrowck — assign source last (see struct init above).
        // `bun_ast::Source` isn't `Clone`; reconstruct from its (all-Copy/Clone) fields.
        package_json.source = bun_ast::Source {
            path: json_source.path.clone(),
            contents: std::borrow::Cow::Borrowed(contents_static),
            contents_is_recycled: json_source.contents_is_recycled,
            identifier_name: json_source.identifier_name.clone(),
            index: json_source.index,
        };
        // See SAFETY note on `contents_static` above — move ownership of the
        // backing buffer into the returned struct (replaces the prior
        // `mem::forget`, forbidden per docs/PORTING.md §Forbidden patterns).
        package_json.source_contents = entry_contents;
        Some(package_json)
    }
}

// TODO(b2-blocked): `self.hash` field referenced in Zig but not declared on
// PackageJSON; gate until the field lands.

impl PackageJSON {
    pub fn hash_module(&self, module: &[u8]) -> u32 {
        let mut hasher = Wyhash::init(0);
        // PORT NOTE: Zig referenced `this.hash`, which is not a declared field on
        // `PackageJSON` in either tree (dead body). Hash the package name as the
        // stable per-package seed instead so `hash_module` is deterministic.
        hasher.update(&self.name);
        hasher.update(module);

        hasher.final_() as u32
    }
} // end  impl PackageJSON

pub struct ExportsMap {
    pub root: Entry,
    pub exports_range: bun_ast::Range,
    pub property_key_loc: bun_ast::Loc,
}

impl ExportsMap {
    pub fn parse(
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        json: js_ast::Expr,
        property_key_loc: bun_ast::Loc,
    ) -> Option<ExportsMap> {
        let mut visitor = Visitor { source, log };

        let root = visitor.visit(json);

        if matches!(root.data, EntryData::Null) {
            return None;
        }

        Some(ExportsMap {
            root,
            exports_range: source.range_of_string(json.loc),
            property_key_loc,
        })
    }
}

pub struct Visitor<'a> {
    pub source: &'a bun_ast::Source,
    pub log: &'a mut bun_ast::Log,
}

impl<'a> Visitor<'a> {
    pub fn visit(&mut self, expr: js_ast::Expr) -> Entry {
        let mut first_token: bun_ast::Range = bun_ast::Range::NONE;

        match &expr.data {
            js_ast::ExprData::ENull(_) => {
                return Entry {
                    first_token: js_lexer::range_of_identifier(self.source, expr.loc),
                    data: EntryData::Null,
                };
            }
            js_ast::ExprData::EString(str) => {
                // PORT NOTE: JSON-parsed strings are always UTF-8 (latin1 source bytes);
                // `str.data` is the raw slice, no bump-arena transcode needed.
                debug_assert!(!str.is_utf16);
                return Entry {
                    data: EntryData::String(Box::from(str.data.slice())),
                    first_token: self.source.range_of_string(expr.loc),
                };
            }
            js_ast::ExprData::EArray(e_array) => {
                let mut array: Vec<Entry> = Vec::with_capacity(e_array.items.len_u32() as usize);
                for item in e_array.items.slice() {
                    array.push(self.visit(*item));
                }
                return Entry {
                    data: EntryData::Array(array.into_boxed_slice()),
                    first_token: bun_ast::Range {
                        loc: expr.loc,
                        len: 1,
                    },
                };
            }
            js_ast::ExprData::EObject(e_obj) => {
                let prop_len = e_obj.properties.len_u32() as usize;
                // PORT NOTE: reshaped for borrowck — Zig used MultiArrayList column slices;
                // EntryDataMapList is a Vec<MapEntry> placeholder until
                // bun_collections::MultiArrayList lands. Push whole entries instead of
                // writing through three parallel column slices.
                // TODO(b2-blocked): bun_collections::MultiArrayList column accessors
                let mut map_data: EntryDataMapList = Vec::with_capacity(prop_len);
                let mut expansion_keys: Vec<MapEntry> = Vec::with_capacity(prop_len);
                let mut is_conditional_sugar = false;
                first_token.loc = expr.loc;
                first_token.len = 1;
                for (i, prop) in e_obj.properties.slice().iter().enumerate() {
                    let prop_key = prop.key.as_ref().expect("infallible: prop has key");
                    let key: Box<[u8]> = match prop_key.data.e_string() {
                        Some(s) => Box::from(s.data.slice()),
                        None => Box::from([].as_slice()),
                    };
                    let key_range: bun_ast::Range = self.source.range_of_string(prop_key.loc);

                    // If exports is an Object with both a key starting with "." and a key
                    // not starting with ".", throw an Invalid Package Configuration error.
                    let cur_is_conditional_sugar = !strings::starts_with_char(&key, b'.');
                    if i == 0 {
                        is_conditional_sugar = cur_is_conditional_sugar;
                    } else if is_conditional_sugar != cur_is_conditional_sugar {
                        let prev = &map_data[i - 1];
                        self.log
                            .add_range_warning_fmt_with_note(
                                Some(self.source),
                                key_range,
                                format_args!(
                                    "This object cannot contain keys that both start with \".\" and don't start with \".\""
                                ),
                                format_args!(
                                    "The previous key \"{}\" is incompatible with the current key \"{}\"",
                                    bstr::BStr::new(&prev.key),
                                    bstr::BStr::new(&key)
                                ),
                                prev.key_range,
                            );
                        // map_data.deinit / allocator.free(expansion_keys) — drop handles cleanup
                        return Entry {
                            data: EntryData::Invalid,
                            first_token,
                        };
                    }

                    let value = self.visit(prop.value.expect("infallible: prop has value"));
                    map_data.push(MapEntry {
                        key: key.clone(),
                        key_range,
                        value: value.clone(),
                    });

                    // safe to use "/" on windows. exports in package.json does not use "\\"
                    if strings::ends_with(&key, b"/") || strings::contains_char(&key, b'*') {
                        expansion_keys.push(MapEntry {
                            value,
                            key,
                            key_range,
                        });
                    }
                }

                // this leaks a lil, but it's fine.
                // (Rust: Vec already sized correctly via push)

                // Let expansionKeys be the list of keys of matchObj either ending in "/"
                // or containing only a single "*", sorted by the sorting function
                // PATTERN_KEY_COMPARE which orders in descending order of specificity.
                expansion_keys.sort_by(|a, b| strings::glob_length_compare(&a.key, &b.key));

                return Entry {
                    data: EntryData::Map(EntryDataMap {
                        list: map_data,
                        expansion_keys: expansion_keys.into_boxed_slice(),
                    }),
                    first_token,
                };
            }
            js_ast::ExprData::EBoolean(_) => {
                first_token = js_lexer::range_of_identifier(self.source, expr.loc);
            }
            js_ast::ExprData::ENumber(_) => {
                // TODO: range of number
                first_token.loc = expr.loc;
                first_token.len = 1;
            }
            _ => {
                first_token.loc = expr.loc;
            }
        }

        self.log.add_range_warning(
            Some(self.source),
            first_token,
            b"This value must be a string, an object, an array, or null",
        );
        Entry {
            data: EntryData::Invalid,
            first_token,
        }
    }
}

#[derive(Clone)]
pub struct Entry {
    pub first_token: bun_ast::Range,
    pub data: EntryData,
}

#[derive(Clone)]
pub enum EntryData {
    Invalid,
    Null,
    Boolean(bool),
    String(Box<[u8]>), // TODO(port): lifetime — borrows source contents in Zig
    Array(Box<[Entry]>),
    Map(EntryDataMap),
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum EntryDataTag {
    Invalid,
    Null,
    Boolean,
    String,
    Array,
    Map,
}

#[derive(Clone)]
pub struct EntryDataMap {
    // This is not a std.ArrayHashMap because we also store the key_range which is a little weird
    pub expansion_keys: Box<[MapEntry]>,
    pub list: EntryDataMapList,
}

// TODO(b2-blocked): bun_collections::MultiArrayList<MapEntry> — needs MultiArrayElement derive +
// per-field column accessors. Using Vec<MapEntry> as a placeholder shape.
pub type EntryDataMapList = Vec<MapEntry>;

#[derive(Clone)]
pub struct MapEntry {
    pub key: Box<[u8]>, // TODO(port): lifetime — borrows source contents in Zig
    pub key_range: bun_ast::Range,
    pub value: Entry,
}

// TODO(port): MultiArrayList field selector enum
pub enum MapEntryField {
    Key,
    KeyRange,
    Value,
}

impl Entry {
    pub fn keys_start_with_dot(&self) -> bool {
        // TODO(b2-blocked): bun_collections::MultiArrayList column accessor; Vec placeholder.
        matches!(&self.data, EntryData::Map(m) if !m.list.is_empty() && strings::starts_with_char(&m.list[0].key, b'.'))
    }

    pub fn value_for_key(&self, key_: &[u8]) -> Option<Entry> {
        match &self.data {
            EntryData::Map(m) => {
                // TODO(b2-blocked): bun_collections::MultiArrayList column accessor; Vec placeholder.
                for entry in m.list.iter() {
                    if strings::eql(&entry.key, key_) {
                        return Some(entry.value.clone());
                    }
                }

                None
            }
            _ => None,
        }
    }
}

pub type ConditionsMap = StringArrayHashMap<()>;

pub struct ESModule<'a> {
    pub debug_logs: Option<&'a mut resolver::DebugLogs>,
    pub conditions: ConditionsMap,
    // allocator dropped — global mimalloc
    pub module_type: &'a mut ModuleType,
}

#[derive(Clone)]
pub struct Resolution {
    pub status: Status,
    // PORT NOTE: Zig returned slices into threadlocal PathBuffers / the package.json source
    // buffer. In Rust the source-buffer case (`EntryData::String(Box<[u8]>)`) is owned by a
    // possibly-temporary `Entry`, so borrowing would dangle. Copy out into an owned buffer.
    // PERF(port): Phase B — thread a real `'a` lifetime once `EntryData::String` is `&'a [u8]`.
    pub path: Box<[u8]>,
    pub debug: ResolutionDebug,
}

impl Default for Resolution {
    fn default() -> Self {
        Resolution {
            status: Status::Undefined,
            path: Box::default(),
            debug: ResolutionDebug::default(),
        }
    }
}

#[derive(Clone, Default)]
pub struct ResolutionDebug {
    // This is the range of the token to use for error messages
    pub token: bun_ast::Range,
    // If the status is "UndefinedNoConditionsMatch", this is the set of
    // conditions that didn't match. This information is used for error messages.
    pub unmatched_conditions: Box<[Box<[u8]>]>,
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Status {
    Undefined,
    UndefinedNoConditionsMatch, // A more friendly error message for when no conditions are matched
    Null,
    Exact,
    ExactEndsWithStar,
    Inexact, // This means we may need to try CommonJS-style extension suffixes

    /// Module specifier is an invalid URL, package name or package subpath specifier.
    InvalidModuleSpecifier,

    /// package.json configuration is invalid or contains an invalid configuration.
    InvalidPackageConfiguration,

    /// Package exports or imports define a target module for the package that is an invalid type or string target.
    InvalidPackageTarget,

    /// Package exports do not define or permit a target subpath in the package for the given module.
    PackagePathNotExported,

    /// The package or module requested does not exist.
    ModuleNotFound,

    /// The user just needs to add the missing extension
    ModuleNotFoundMissingExtension,

    /// The resolved path corresponds to a directory, which is not a supported target for module imports.
    UnsupportedDirectoryImport,

    /// The user just needs to add the missing "/index.js" suffix
    UnsupportedDirectoryImportMissingIndex,

    /// When a package path is explicitly set to null, that means it's not exported.
    PackagePathDisabled,

    // The internal #import specifier was not found
    PackageImportNotDefined,

    PackageResolve,
}

impl Status {
    #[inline]
    pub fn is_undefined(self) -> bool {
        matches!(self, Status::Undefined | Status::UndefinedNoConditionsMatch)
    }
}

#[derive(Clone, Copy)]
pub struct Package<'a> {
    /// Borrows from the `specifier` argument to `Package::parse`.
    pub name: &'a [u8],
    /// Borrows from the `specifier` argument to `Package::parse`.
    pub version: &'a [u8],
    /// Borrows from the `subpath_buf` argument to `Package::parse`.
    pub subpath: &'a [u8],
}

impl Default for Package<'_> {
    fn default() -> Self {
        Package {
            name: b"",
            version: b"",
            subpath: b"",
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct PackageExternal {
    pub name: Semver::String,
    pub version: Semver::String,
    pub subpath: Semver::String,
}

impl<'a> Package<'a> {
    pub fn count(self, builder: &mut Semver::semver_string::Builder) {
        builder.count(self.name);
        builder.count(self.version);
        builder.count(self.subpath);
    }

    pub fn clone(self, builder: &mut Semver::semver_string::Builder) -> PackageExternal {
        PackageExternal {
            name: builder.append_utf8_without_pool::<Semver::String>(self.name, 0),
            version: builder.append_utf8_without_pool::<Semver::String>(self.version, 0),
            subpath: builder.append_utf8_without_pool::<Semver::String>(self.subpath, 0),
        }
    }

    pub fn to_external(self, buffer: &[u8]) -> PackageExternal {
        PackageExternal {
            name: Semver::String::init(buffer, self.name),
            version: Semver::String::init(buffer, self.version),
            subpath: Semver::String::init(buffer, self.subpath),
        }
    }

    /// Allocate a fresh string buffer and clone `name`/`version`/`subpath`
    /// into it as offset-encoded `Semver::String`s. Mirrors the inline
    /// `count` → `allocate` → `clone` Builder dance the resolver does at the
    /// auto-install pending sites (resolver.zig), exposed as the `esm.copy`
    /// helper that `PendingResolution::init` expects.
    pub fn copy(self) -> Result<(PackageExternal, Vec<u8>), bun_core::Error> {
        let mut builder = Semver::semver_string::Builder::default();
        self.count(&mut builder);
        builder.allocate()?;
        let cloned = self.clone(&mut builder);
        let string_buf = builder.ptr.take().map(|b| b.into_vec()).unwrap_or_default();
        Ok((cloned, string_buf))
    }

    pub fn with_auto_version(self) -> Package<'a> {
        if self.version.is_empty() {
            return Package {
                name: self.name,
                subpath: self.subpath,
                version: b"latest",
            };
        }

        self
    }
    pub fn parse_name(specifier: &[u8]) -> Option<&[u8]> {
        let mut slash = strings::index_of_char_neg(specifier, b'/');
        if !strings::starts_with_char(specifier, b'@') {
            slash = if slash == -1 {
                i32::try_from(specifier.len()).expect("int cast")
            } else {
                slash
            };
            Some(&specifier[0..usize::try_from(slash).expect("int cast")])
        } else {
            if slash == -1 {
                return None;
            }

            let after = usize::try_from(slash).expect("int cast") + 1;
            let slash2 = strings::index_of_char(&specifier[after..], b'/')
                .map(|v| v as usize)
                .unwrap_or(specifier[u32::try_from(slash + 1).expect("int cast") as usize..].len());
            Some(&specifier[0..usize::try_from(slash + 1).expect("int cast") + slash2])
        }
    }

    pub fn parse_version(specifier_after_name: &[u8]) -> Option<&[u8]> {
        if let Some(slash) = strings::index_of_char(specifier_after_name, b'/') {
            // "foo@/bar" is not a valid specifier\
            // "foo@/"   is not a valid specifier
            // "foo/@/bar" is not a valid specifier
            // "foo@1/bar" is a valid specifier
            // "foo@^123.2.3+ba-ab/bar" is a valid specifier
            //      ^^^^^^^^^^^^^^
            //    this is the version

            let remainder = &specifier_after_name[0..slash as usize];
            if !remainder.is_empty() && remainder[0] == b'@' {
                return Some(&remainder[1..]);
            }

            return Some(remainder);
        }

        None
    }

    pub fn parse(specifier: &'a [u8], subpath_buf: &'a mut [u8]) -> Option<Package<'a>> {
        // TODO(port): lifetime — &'static is a placeholder; should be <'a>
        if specifier.is_empty() {
            return None;
        }
        let mut package = Package {
            name: Self::parse_name(specifier)?,
            subpath: b"",
            version: b"",
        };

        if strings::starts_with(package.name, b".")
            || strings::index_any_comptime(package.name, b"\\%").is_some()
        {
            return None;
        }

        // A version delimiter `@` is only valid within the package-name portion of
        // the specifier. Searching the entire specifier misparses wildcard subpaths
        // whose matched substring contains `@` (e.g. `test-pkg/@scope/sub/index.js`
        // or `ember-source/@ember/renderer/...`) as if the package had a version.
        let offset: usize = if package.name.is_empty() || package.name[0] != b'@' {
            0
        } else {
            1
        };
        if offset < package.name.len() {
            if let Some(at) = strings::index_of_char(&specifier[offset..package.name.len()], b'@') {
                let at = at as usize;
                package.version = Self::parse_version(&specifier[offset..][at..]).unwrap_or(b"");
                if package.version.is_empty() {
                    package.version = &specifier[offset..][at..];
                    if !package.version.is_empty() && package.version[0] == b'@' {
                        package.version = &package.version[1..];
                    }
                }
                package.name = &specifier[0..at + offset];

                Self::parse_subpath(
                    &mut package.subpath,
                    &specifier
                        [(package.name.len() + package.version.len() + 1).min(specifier.len())..],
                    subpath_buf,
                );
                return Some(package);
            }
        }
        Self::parse_subpath(
            &mut package.subpath,
            &specifier[package.name.len()..],
            subpath_buf,
        );

        Some(package)
    }

    pub fn parse_subpath(subpath: &mut &'a [u8], specifier: &[u8], subpath_buf: &'a mut [u8]) {
        if specifier.len() + 1 > subpath_buf.len() {
            *subpath = b"";
            return;
        }
        subpath_buf[0] = b'.';
        subpath_buf[1..1 + specifier.len()].copy_from_slice(specifier);
        *subpath = &subpath_buf[..specifier.len() + 1];
    }
}

// PERF(port): was comptime monomorphization (`comptime kind: ReverseKind`) — demoted to
// runtime arg per PORTING.md §Idiom map (only used in a `match` body, never in a type
// position; stable Rust rejects enum const-generics without `adt_const_params`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReverseKind {
    Exact,
    Pattern,
    Prefix,
}

// ── Local string helpers (TODO(b2-blocked): bun_core::{replacement_size, replace}) ──
// Minimal local impls so the ESModule resolution algorithm compiles; replace with the
// canonical bun_core versions once they land. Recorded in blocked_on.
use bun_core::trim_right;

/// Port of `std.mem.replacementSize` — total bytes after replacing every `needle` in
/// `input` with `replacement`.
#[inline]
fn replacement_size(input: &[u8], needle: &[u8], replacement: &[u8]) -> usize {
    if needle.is_empty() {
        return input.len();
    }
    let mut size = 0usize;
    let mut i = 0usize;
    while i < input.len() {
        if input[i..].starts_with(needle) {
            size += replacement.len();
            i += needle.len();
        } else {
            size += 1;
            i += 1;
        }
    }
    size
}

/// Port of `std.mem.replace` — replace every `needle` in `input` with `replacement`,
/// writing into `output`. Returns number of replacements.
#[inline]
fn replace(input: &[u8], needle: &[u8], replacement: &[u8], output: &mut [u8]) -> usize {
    if needle.is_empty() {
        output[..input.len()].copy_from_slice(input);
        return 0;
    }
    let mut i = 0usize;
    let mut o = 0usize;
    let mut count = 0usize;
    while i < input.len() {
        if input[i..].starts_with(needle) {
            output[o..o + replacement.len()].copy_from_slice(replacement);
            o += replacement.len();
            i += needle.len();
            count += 1;
        } else {
            output[o] = input[i];
            o += 1;
            i += 1;
        }
    }
    count
}

#[derive(Clone, Default)]
pub struct ReverseResolution {
    // PORT NOTE: Zig returned slices into threadlocal PathBuffers / the package.json source
    // buffer. Copy out into an owned buffer (see `Resolution.path` note above).
    // PERF(port): Phase B — thread a real `'a` lifetime once `EntryData::String` is `&'a [u8]`.
    pub subpath: Box<[u8]>,
    pub token: bun_ast::Range,
}

const INVALID_PERCENT_CHARS: [&[u8]; 4] = [b"%2f", b"%2F", b"%5c", b"%5C"];

struct ModuleBufs {
    resolved_path_buf_percent: PathBuffer,
    resolve_target_buf: PathBuffer,
    resolve_target_buf2: PathBuffer,
    resolve_target_reverse_prefix_buf: PathBuffer,
    resolve_target_reverse_prefix_buf2: PathBuffer,
}

thread_local! {
    // PORT NOTE: bun.ThreadlocalBuffers — Zig heap-allocates the buffer struct on first use and
    // stores only a pointer in TLS so the static-TLS template stays small (PE/COFF has no
    // TLS-BSS; ELF PT_TLS MemSiz scales with this — see test/js/bun/binary/tls-segment-size).
    // resolve_target / resolve_target_reverse are RECURSIVE (Map/Array arms call themselves), so a
    // RefCell + escaped `&mut PathBuffer` would create aliased `&mut` at the inner call → UB.
    // Use raw-pointer access; only form `&mut PathBuffer` inside the non-recursive `String` arms
    // where the buffers are actually written (no overlap with a live outer `&mut`).
    static MODULE_BUFS: core::cell::Cell<*mut ModuleBufs> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
}

#[inline]
fn module_bufs() -> *mut ModuleBufs {
    MODULE_BUFS.with(|c| {
        let mut p = c.get();
        if p.is_null() {
            p = bun_core::heap::into_raw(Box::new(ModuleBufs {
                resolved_path_buf_percent: PathBuffer::ZEROED,
                resolve_target_buf: PathBuffer::ZEROED,
                resolve_target_buf2: PathBuffer::ZEROED,
                resolve_target_reverse_prefix_buf: PathBuffer::ZEROED,
                resolve_target_reverse_prefix_buf2: PathBuffer::ZEROED,
            }));
            c.set(p);
        }
        p
    })
}

// PORT NOTE: Zig used `r: *const ESModule` (const ptr) but mutated `r.module_type.*`
// and `r.debug_logs.?.*` through interior pointers. In Rust those fields are `&'a mut T`,
// so reading/writing them requires `&mut self`. All resolution methods take `&mut self`.
impl<'a> ESModule<'a> {
    pub fn resolve(&mut self, package_url: &[u8], subpath: &[u8], exports: &Entry) -> Resolution {
        let r = self.resolve_exports(package_url, subpath, exports);
        Self::finalize(r)
    }

    pub fn resolve_imports(&mut self, specifier: &[u8], imports: &Entry) -> Resolution {
        if !matches!(imports.data, EntryData::Map(_)) {
            return Resolution {
                status: Status::InvalidPackageConfiguration,
                debug: ResolutionDebug {
                    token: bun_ast::Range::NONE,
                    ..Default::default()
                },
                ..Default::default()
            };
        }

        let result = self.resolve_imports_exports(specifier, imports, true, b"/");

        match result.status {
            Status::Undefined | Status::Null => Resolution {
                status: Status::PackageImportNotDefined,
                debug: ResolutionDebug {
                    token: result.debug.token,
                    ..Default::default()
                },
                ..Default::default()
            },
            _ => Self::finalize(result),
        }
    }

    pub fn finalize(result_: Resolution) -> Resolution {
        let mut result = result_;
        if result.status != Status::Exact
            && result.status != Status::ExactEndsWithStar
            && result.status != Status::Inexact
        {
            return result;
        }

        // If resolved contains any percent encodings of "/" or "\" ("%2f" and "%5C"
        // respectively), then throw an Invalid Module Specifier error.
        // This must be checked on the still-encoded path, before percent-decoding.
        if INVALID_PERCENT_CHARS
            .iter()
            .any(|p| strings::contains(&result.path, p))
        {
            return Resolution {
                status: Status::InvalidModuleSpecifier,
                path: result.path,
                debug: result.debug,
            };
        }

        // SAFETY: threadlocal UnsafeCell; finalize() does not recurse, so this is the unique
        // live `&mut` to resolved_path_buf_percent on this thread.
        let resolved_path_buf_percent: &mut PathBuffer =
            unsafe { &mut (*module_bufs()).resolved_path_buf_percent };
        // TODO(port): std.io.fixedBufferStream + PercentEncoding.decode
        let len = match bun_url::PercentEncoding::decode_into(
            &mut resolved_path_buf_percent.0,
            &result.path,
        ) {
            Ok(n) => n,
            Err(_) => {
                return Resolution {
                    status: Status::InvalidModuleSpecifier,
                    path: result.path,
                    debug: result.debug,
                };
            }
        };

        let resolved_path = &resolved_path_buf_percent.0[0..len as usize];

        // If resolved is a directory, throw an Unsupported Directory Import error.
        if strings::ends_with_any(resolved_path, b"/\\") {
            return Resolution {
                status: Status::UnsupportedDirectoryImport,
                path: result.path,
                debug: result.debug,
            };
        }

        // PORT NOTE: Zig returned a slice into the threadlocal resolved_path_buf_percent.
        // Copy out — see `Resolution.path` note. PERF(port): avoid alloc in Phase B.
        result.path = Box::<[u8]>::from(resolved_path);
        result
    }

    fn resolve_exports(
        &mut self,
        package_url: &[u8],
        subpath: &[u8],
        exports: &Entry,
    ) -> Resolution {
        if matches!(exports.data, EntryData::Invalid) {
            if let Some(logs) = self.debug_logs.as_deref_mut() {
                logs.add_note(b"Invalid package configuration".to_vec());
            }

            return Resolution {
                status: Status::InvalidPackageConfiguration,
                debug: ResolutionDebug {
                    token: exports.first_token,
                    ..Default::default()
                },
                ..Default::default()
            };
        }

        if subpath == b"." {
            let mut main_export = Entry {
                data: EntryData::Null,
                first_token: bun_ast::Range::NONE,
            };
            let cond = match &exports.data {
                EntryData::String(_) | EntryData::Array(_) => true,
                EntryData::Map(_) => !exports.keys_start_with_dot(),
                _ => false,
            };
            if cond {
                main_export = exports.clone();
            } else if matches!(exports.data, EntryData::Map(_)) {
                if let Some(value) = exports.value_for_key(b".") {
                    main_export = value;
                }
            }

            if !matches!(main_export.data, EntryData::Null) {
                let result = self.resolve_target::<false>(package_url, &main_export, b"", false);
                if result.status != Status::Null && result.status != Status::Undefined {
                    return result;
                }
            }
        } else if matches!(exports.data, EntryData::Map(_)) && exports.keys_start_with_dot() {
            let result = self.resolve_imports_exports(subpath, exports, false, package_url);
            if result.status != Status::Null && result.status != Status::Undefined {
                return result;
            }

            if result.status == Status::Null {
                return Resolution {
                    status: Status::PackagePathDisabled,
                    debug: ResolutionDebug {
                        token: exports.first_token,
                        ..Default::default()
                    },
                    ..Default::default()
                };
            }
        }

        if let Some(logs) = self.debug_logs.as_deref_mut() {
            logs.add_note_fmt(format_args!(
                "The path \"{}\" was not exported",
                bstr::BStr::new(subpath)
            ));
        }

        Resolution {
            status: Status::PackagePathNotExported,
            debug: ResolutionDebug {
                token: exports.first_token,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn resolve_imports_exports(
        &mut self,
        match_key: &[u8],
        match_obj: &Entry,
        is_imports: bool,
        package_url: &[u8],
    ) -> Resolution {
        if let Some(logs) = self.debug_logs.as_deref_mut() {
            logs.add_note_fmt(format_args!(
                "Checking object path map for \"{}\"",
                bstr::BStr::new(match_key)
            ));
        }

        // If matchKey is a key of matchObj and does not end in "/" or contain "*", then
        if !strings::ends_with_char(match_key, b'/') && !strings::contains_char(match_key, b'*') {
            if let Some(target) = match_obj.value_for_key(match_key) {
                if let Some(log) = self.debug_logs.as_deref_mut() {
                    log.add_note_fmt(format_args!("Found \"{}\"", bstr::BStr::new(match_key)));
                }

                return self.resolve_target::<false>(package_url, &target, b"", is_imports);
            }
        }

        if let EntryData::Map(map) = &match_obj.data {
            let expansion_keys = &map.expansion_keys;
            for expansion in expansion_keys.iter() {
                // If expansionKey contains "*", set patternBase to the substring of
                // expansionKey up to but excluding the first "*" character
                if let Some(star) = strings::index_of_char(&expansion.key, b'*') {
                    let star = star as usize;
                    let pattern_base = &expansion.key[0..star];
                    // If patternBase is not null and matchKey starts with but is not equal
                    // to patternBase, then
                    if strings::starts_with(match_key, pattern_base) {
                        // Let patternTrailer be the substring of expansionKey from the index
                        // after the first "*" character.
                        let pattern_trailer = &expansion.key[star + 1..];

                        // If patternTrailer has zero length, or if matchKey ends with
                        // patternTrailer and the length of matchKey is greater than or
                        // equal to the length of expansionKey, then
                        if pattern_trailer.is_empty()
                            || (strings::ends_with(match_key, pattern_trailer)
                                && match_key.len() >= expansion.key.len())
                        {
                            let target = &expansion.value;
                            let subpath = &match_key
                                [pattern_base.len()..match_key.len() - pattern_trailer.len()];
                            if let Some(log) = self.debug_logs.as_deref_mut() {
                                log.add_note_fmt(format_args!(
                                    "The key \"{}\" matched with \"{}\" left over",
                                    bstr::BStr::new(&expansion.key),
                                    bstr::BStr::new(subpath)
                                ));
                            }
                            return self.resolve_target::<true>(
                                package_url,
                                target,
                                subpath,
                                is_imports,
                            );
                        }
                    }
                } else {
                    // Otherwise if patternBase is null and matchKey starts with
                    // expansionKey, then
                    if strings::starts_with(match_key, &expansion.key) {
                        let target = &expansion.value;
                        let subpath = &match_key[expansion.key.len()..];
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.add_note_fmt(format_args!(
                                "The key \"{}\" matched with \"{}\" left over",
                                bstr::BStr::new(&expansion.key),
                                bstr::BStr::new(subpath)
                            ));
                        }
                        let mut result =
                            self.resolve_target::<false>(package_url, target, subpath, is_imports);
                        if result.status == Status::Exact
                            || result.status == Status::ExactEndsWithStar
                        {
                            // Return the object { resolved, exact: false }.
                            result.status = Status::Inexact;
                        }
                        return result;
                    }
                }

                if let Some(log) = self.debug_logs.as_deref_mut() {
                    log.add_note_fmt(format_args!(
                        "The key \"{}\" did not match",
                        bstr::BStr::new(&expansion.key)
                    ));
                }
            }
        }

        if let Some(log) = self.debug_logs.as_deref_mut() {
            log.add_note_fmt(format_args!(
                "No keys matched \"{}\"",
                bstr::BStr::new(match_key)
            ));
        }

        Resolution {
            status: Status::Null,
            debug: ResolutionDebug {
                token: match_obj.first_token,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn resolve_target<const PATTERN: bool>(
        &mut self,
        package_url: &[u8],
        target: &Entry,
        subpath: &[u8],
        internal: bool,
    ) -> Resolution {
        match &target.data {
            EntryData::String(str) => {
                // SAFETY: threadlocal UnsafeCell; the `String` arm does NOT recurse into
                // resolve_target, so these are the unique live `&mut`s on this thread for
                // the duration of this arm. Map/Array arms below DO recurse and must not
                // hold these — that's why acquisition is here, not at fn entry.
                let mb = module_bufs();
                let resolve_target_buf: &mut PathBuffer = unsafe { &mut (*mb).resolve_target_buf };
                let resolve_target_buf2: &mut PathBuffer =
                    unsafe { &mut (*mb).resolve_target_buf2 };
                let str: &[u8] = str;
                if let Some(log) = self.debug_logs.as_deref_mut() {
                    log.add_note_fmt(format_args!(
                        "Checking path \"{}\" against target \"{}\"",
                        bstr::BStr::new(subpath),
                        bstr::BStr::new(str)
                    ));
                    log.increase_indent();
                }
                // PORT NOTE: Zig had `defer log.decrease_indent()` capturing the unwrapped
                // `*DebugLogs`. Rust scopeguard cannot hold the &mut across the recursive
                // `&mut self` calls below; manual decrease at each return below.
                // TODO(port): errdefer — verify all return paths decrease_indent.
                macro_rules! dedent {
                    () => {
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.decrease_indent();
                        }
                    };
                }

                // If pattern is false, subpath has non-zero length and target
                // does not end with "/", throw an Invalid Module Specifier error.
                if !PATTERN {
                    if !subpath.is_empty() && !strings::ends_with_char(str, b'/') {
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.add_note_fmt(format_args!(
                                "The target \"{}\" is invalid because it doesn't end with a \"/\"",
                                bstr::BStr::new(str)
                            ));
                        }
                        dedent!();

                        return Resolution {
                            path: Box::<[u8]>::from(str),
                            status: Status::InvalidModuleSpecifier,
                            debug: ResolutionDebug {
                                token: target.first_token,
                                ..Default::default()
                            },
                        };
                    }
                }

                // If target does not start with "./", then...
                if !strings::starts_with(str, b"./") {
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because it doesn't start with a \"./\"",
                            bstr::BStr::new(str)
                        ));
                    }

                    if internal
                        && !strings::has_prefix(str, b"../")
                        && !strings::has_prefix(str, b"/")
                    {
                        if PATTERN {
                            // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                            let len = replacement_size(str, b"*", subpath);
                            let _ = replace(str, b"*", subpath, &mut resolve_target_buf2.0);
                            let result = &resolve_target_buf2.0[0..len];
                            if let Some(log) = self.debug_logs.as_deref_mut() {
                                log.add_note_fmt(format_args!(
                                    "Subsituted \"{}\" for \"*\" in \".{}\" to get \".{}\" ",
                                    bstr::BStr::new(subpath),
                                    bstr::BStr::new(str),
                                    bstr::BStr::new(result)
                                ));
                            }
                            dedent!();
                            return Resolution {
                                path: Box::<[u8]>::from(result),
                                status: Status::PackageResolve,
                                debug: ResolutionDebug {
                                    token: target.first_token,
                                    ..Default::default()
                                },
                            };
                        } else {
                            let parts2 = [str, subpath];
                            let result = resolve_path::resolve_path::join_string_buf::<
                                resolve_path::platform::Auto,
                            >(
                                &mut resolve_target_buf2.0, &parts2
                            );
                            if let Some(log) = self.debug_logs.as_deref_mut() {
                                log.add_note_fmt(format_args!(
                                    "Resolved \".{}\" to \".{}\"",
                                    bstr::BStr::new(str),
                                    bstr::BStr::new(result)
                                ));
                            }
                            let path = Box::<[u8]>::from(result);
                            dedent!();
                            return Resolution {
                                path,
                                status: Status::PackageResolve,
                                debug: ResolutionDebug {
                                    token: target.first_token,
                                    ..Default::default()
                                },
                            };
                        }
                    }
                    dedent!();
                    return Resolution {
                        path: Box::<[u8]>::from(str),
                        status: Status::InvalidPackageTarget,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            ..Default::default()
                        },
                    };
                }

                // If target split on "/" or "\" contains any ".", ".." or "node_modules"
                // segments after the first segment, throw an Invalid Package Target error.
                if let Some(invalid) = find_invalid_segment(str) {
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because it contains an invalid segment \"{}\"",
                            bstr::BStr::new(str),
                            bstr::BStr::new(invalid)
                        ));
                    }
                    dedent!();
                    return Resolution {
                        path: Box::<[u8]>::from(str),
                        status: Status::InvalidPackageTarget,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            ..Default::default()
                        },
                    };
                }

                // Let resolvedTarget be the URL resolution of the concatenation of packageURL and target.
                let parts = [package_url, str];
                let resolved_target = resolve_path::resolve_path::join_string_buf::<
                    resolve_path::platform::Auto,
                >(&mut resolve_target_buf.0, &parts);

                // If target split on "/" or "\" contains any ".", ".." or "node_modules"
                // segments after the first segment, throw an Invalid Package Target error.
                if let Some(invalid) = find_invalid_segment(resolved_target) {
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because it contains an invalid segment \"{}\"",
                            bstr::BStr::new(str),
                            bstr::BStr::new(invalid)
                        ));
                    }
                    dedent!();
                    return Resolution {
                        path: Box::<[u8]>::from(str),
                        status: Status::InvalidModuleSpecifier,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            ..Default::default()
                        },
                    };
                }

                if PATTERN {
                    // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                    let len = replacement_size(resolved_target, b"*", subpath);
                    let _ = replace(resolved_target, b"*", subpath, &mut resolve_target_buf2.0);
                    let result = &resolve_target_buf2.0[0..len];
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "Substituted \"{}\" for \"*\" in \".{}\" to get \".{}\" ",
                            bstr::BStr::new(subpath),
                            bstr::BStr::new(resolved_target),
                            bstr::BStr::new(result)
                        ));
                    }

                    let status: Status = if strings::ends_with_char_or_is_zero_length(result, b'*')
                        && strings::index_of_char(result, b'*').unwrap() as usize
                            == result.len() - 1
                    {
                        Status::ExactEndsWithStar
                    } else {
                        Status::Exact
                    };
                    dedent!();
                    return Resolution {
                        path: Box::<[u8]>::from(result),
                        status,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            ..Default::default()
                        },
                    };
                } else {
                    let parts2 = [package_url, str, subpath];
                    let result = resolve_path::resolve_path::join_string_buf::<
                        resolve_path::platform::Auto,
                    >(&mut resolve_target_buf2.0, &parts2);
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "Substituted \"{}\" for \"*\" in \".{}\" to get \".{}\" ",
                            bstr::BStr::new(subpath),
                            bstr::BStr::new(resolved_target),
                            bstr::BStr::new(result)
                        ));
                    }
                    let path = Box::<[u8]>::from(result);
                    dedent!();
                    return Resolution {
                        path,
                        status: Status::Exact,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            ..Default::default()
                        },
                    };
                }
            }
            EntryData::Map(object) => {
                let mut did_find_map_entry = false;
                let mut last_map_entry_i: usize = 0;

                // PORT NOTE: Zig used MultiArrayList column slices; Phase-A `EntryDataMapList`
                // is `Vec<MapEntry>` so iterate AoS directly.
                for (i, entry) in object.list.iter().enumerate() {
                    let key: &[u8] = &entry.key;
                    if self.conditions.contains_key(key) {
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.add_note_fmt(format_args!(
                                "The key \"{}\" matched",
                                bstr::BStr::new(key)
                            ));
                        }

                        let prev_module_type = *self.module_type;
                        let result = self.resolve_target::<PATTERN>(
                            package_url,
                            &entry.value,
                            subpath,
                            internal,
                        );
                        if result.status.is_undefined() {
                            did_find_map_entry = true;
                            last_map_entry_i = i;
                            *self.module_type = prev_module_type;
                            continue;
                        }

                        if key == b"import" {
                            *self.module_type = ModuleType::Esm;
                        }

                        if key == b"require" {
                            *self.module_type = ModuleType::Cjs;
                        }

                        return result;
                    }

                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "The key \"{}\" did not match",
                            bstr::BStr::new(key)
                        ));
                    }
                }

                if let Some(log) = self.debug_logs.as_deref_mut() {
                    log.add_note_fmt(format_args!("No keys matched"));
                }

                let mut return_target = target;
                // ALGORITHM DEVIATION: Provide a friendly error message if no conditions matched
                if !object.list.is_empty() && !target.keys_start_with_dot() {
                    let last_map_entry_value = &object.list[last_map_entry_i].value;
                    if did_find_map_entry
                        && matches!(&last_map_entry_value.data, EntryData::Map(m) if !m.list.is_empty())
                        && !last_map_entry_value.keys_start_with_dot()
                    {
                        // If a top-level condition did match but no sub-condition matched,
                        // complain about the sub-condition instead of the top-level condition.
                        // This leads to a less confusing error message. For example:
                        //
                        //   "exports": {
                        //     "node": {
                        //       "require": "./dist/bwip-js-node.js"
                        //     }
                        //   },
                        //
                        // We want the warning to say this:
                        //
                        //   note: None of the conditions provided ("require") match any of the
                        //         currently active conditions ("default", "import", "node")
                        //   14 |       "node": {
                        //      |               ^
                        //
                        // We don't want the warning to say this:
                        //
                        //   note: None of the conditions provided ("browser", "electron", "node")
                        //         match any of the currently active conditions ("default", "import", "node")
                        //   7 |   "exports": {
                        //     |              ^
                        //
                        // More information: https://github.com/evanw/esbuild/issues/1484
                        // PORT NOTE: reshaped for borrowck — return_target points into slice; clone keys below
                        return_target = last_map_entry_value;
                    }

                    let unmatched: Box<[Box<[u8]>]> = match &return_target.data {
                        EntryData::Map(m) => m
                            .list
                            .iter()
                            .map(|e| e.key.clone())
                            .collect::<Vec<_>>()
                            .into_boxed_slice(),
                        _ => Box::default(),
                    };

                    return Resolution {
                        path: Box::default(),
                        status: Status::UndefinedNoConditionsMatch,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            unmatched_conditions: unmatched,
                        },
                    };
                }

                return Resolution {
                    path: Box::default(),
                    status: Status::UndefinedNoConditionsMatch,
                    debug: ResolutionDebug {
                        token: target.first_token,
                        ..Default::default()
                    },
                };
            }
            EntryData::Array(array) => {
                if array.is_empty() {
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "The path \"{}\" is an empty array",
                            bstr::BStr::new(subpath)
                        ));
                    }

                    return Resolution {
                        path: Box::default(),
                        status: Status::Null,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            ..Default::default()
                        },
                    };
                }

                let mut last_exception = Status::Undefined;
                let mut last_debug = ResolutionDebug {
                    token: target.first_token,
                    ..Default::default()
                };

                for target_value in array.iter() {
                    // Let resolved be the result, continuing the loop on any Invalid Package Target error.
                    let prev_module_type = *self.module_type;
                    let result = self.resolve_target::<PATTERN>(
                        package_url,
                        target_value,
                        subpath,
                        internal,
                    );
                    if result.status == Status::InvalidPackageTarget
                        || result.status == Status::Null
                    {
                        last_debug = result.debug.clone();
                        last_exception = result.status;
                    }

                    if result.status.is_undefined() {
                        *self.module_type = prev_module_type;
                        continue;
                    }

                    return result;
                }

                return Resolution {
                    path: Box::default(),
                    status: last_exception,
                    debug: last_debug,
                };
            }
            EntryData::Null => {
                if let Some(log) = self.debug_logs.as_deref_mut() {
                    log.add_note_fmt(format_args!(
                        "The path \"{}\" is null",
                        bstr::BStr::new(subpath)
                    ));
                }

                return Resolution {
                    path: Box::default(),
                    status: Status::Null,
                    debug: ResolutionDebug {
                        token: target.first_token,
                        ..Default::default()
                    },
                };
            }
            _ => {}
        }

        if let Some(logs) = self.debug_logs.as_deref_mut() {
            logs.add_note_fmt(format_args!(
                "Invalid package target for path \"{}\"",
                bstr::BStr::new(subpath)
            ));
        }

        Resolution {
            status: Status::InvalidPackageTarget,
            debug: ResolutionDebug {
                token: target.first_token,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn resolve_exports_reverse(&mut self, query: &[u8], root: &Entry) -> Option<ReverseResolution> {
        if matches!(root.data, EntryData::Map(_)) && root.keys_start_with_dot() {
            if let Some(res) = self.resolve_imports_exports_reverse(query, root) {
                return Some(res);
            }
        }

        None
    }

    fn resolve_imports_exports_reverse(
        &mut self,
        query: &[u8],
        match_obj: &Entry,
    ) -> Option<ReverseResolution> {
        let EntryData::Map(map) = &match_obj.data else {
            return None;
        };

        if !strings::ends_with_char_or_is_zero_length(query, b'*') {
            // PORT NOTE: Zig used MultiArrayList column slices; iterate Vec<MapEntry> directly.
            for entry in map.list.iter() {
                if let Some(result) =
                    self.resolve_target_reverse(query, &entry.key, &entry.value, ReverseKind::Exact)
                {
                    return Some(result);
                }
            }
        }

        for expansion in map.expansion_keys.iter() {
            if strings::ends_with_char_or_is_zero_length(&expansion.key, b'*') {
                if let Some(result) = self.resolve_target_reverse(
                    query,
                    &expansion.key,
                    &expansion.value,
                    ReverseKind::Pattern,
                ) {
                    return Some(result);
                }
            }

            // TODO(port): Zig used `.reverse` here but ReverseKind has no `.reverse` variant — preserved as Prefix? Actually Zig defines {exact, pattern, prefix}; `.reverse` is a typo in Zig source
            if let Some(result) = self.resolve_target_reverse(
                query,
                &expansion.key,
                &expansion.value,
                ReverseKind::Prefix,
            ) {
                return Some(result);
            }
        }

        // TODO(port): Zig fn falls through with no return (implicit unreachable); returning None
        None
    }

    fn resolve_target_reverse(
        &mut self,
        query: &[u8],
        key: &[u8],
        target: &Entry,
        kind: ReverseKind,
    ) -> Option<ReverseResolution> {
        match &target.data {
            EntryData::String(str) => {
                // SAFETY: threadlocal UnsafeCell; the `String` arm does NOT recurse into
                // resolve_target_reverse, so these are the unique live `&mut`s on this thread.
                // Map/Array arms below recurse and must not hold these — see MODULE_BUFS note.
                let mb = module_bufs();
                let resolve_target_reverse_prefix_buf: &mut PathBuffer =
                    unsafe { &mut (*mb).resolve_target_reverse_prefix_buf };
                let resolve_target_reverse_prefix_buf2: &mut PathBuffer =
                    unsafe { &mut (*mb).resolve_target_reverse_prefix_buf2 };
                let str: &[u8] = str;
                match kind {
                    ReverseKind::Exact => {
                        if strings::eql(query, str) {
                            return Some(ReverseResolution {
                                subpath: Box::<[u8]>::from(str),
                                token: target.first_token,
                            });
                        }
                    }
                    ReverseKind::Prefix => {
                        if strings::starts_with(query, str) {
                            let buf = &mut resolve_target_reverse_prefix_buf.0;
                            let buf_len = buf.len();
                            let n = {
                                let mut w = &mut buf[..];
                                let _ = w.write_all(key);
                                let _ = w.write_all(&query[str.len()..]);
                                buf_len - w.len()
                            };
                            return Some(ReverseResolution {
                                subpath: Box::<[u8]>::from(&buf[..n]),
                                token: target.first_token,
                            });
                        }
                    }
                    ReverseKind::Pattern => {
                        let key_without_trailing_star = trim_right(key, b"*");

                        let Some(star) = strings::index_of_char(str, b'*') else {
                            // Handle the case of no "*"
                            if strings::eql(query, str) {
                                return Some(ReverseResolution {
                                    subpath: Box::<[u8]>::from(key_without_trailing_star),
                                    token: target.first_token,
                                });
                            }
                            return None;
                        };
                        let star = star as usize;

                        // Only support tracing through a single "*"
                        let prefix = &str[0..star];
                        let suffix = &str[star + 1..];
                        if strings::starts_with(query, prefix)
                            && !strings::contains_char(suffix, b'*')
                        {
                            let after_prefix = &query[prefix.len()..];
                            if strings::ends_with(after_prefix, suffix) {
                                let star_data = &after_prefix[0..after_prefix.len() - suffix.len()];
                                let buf = &mut resolve_target_reverse_prefix_buf2.0;
                                let buf_len = buf.len();
                                let n = {
                                    let mut w = &mut buf[..];
                                    let _ = w.write_all(key_without_trailing_star);
                                    let _ = w.write_all(star_data);
                                    buf_len - w.len()
                                };
                                return Some(ReverseResolution {
                                    subpath: Box::<[u8]>::from(&buf[..n]),
                                    token: target.first_token,
                                });
                            }
                        }
                    }
                }
            }
            EntryData::Map(map) => {
                // PORT NOTE: Zig used MultiArrayList column slices; iterate Vec<MapEntry> directly.
                for entry in map.list.iter() {
                    let map_key: &[u8] = &entry.key;
                    if self.conditions.contains_key(map_key) {
                        if let Some(result) =
                            self.resolve_target_reverse(query, key, &entry.value, kind)
                        {
                            if map_key == b"import" {
                                *self.module_type = ModuleType::Esm;
                            } else if map_key == b"require" {
                                *self.module_type = ModuleType::Cjs;
                            }

                            return Some(result);
                        }
                    }
                }
            }

            EntryData::Array(array) => {
                for target_value in array.iter() {
                    if let Some(result) =
                        self.resolve_target_reverse(query, key, target_value, kind)
                    {
                        return Some(result);
                    }
                }
            }

            _ => {}
        }

        None
    }
}

fn find_invalid_segment(path_: &[u8]) -> Option<&[u8]> {
    let Some(slash) = strings::index_any_comptime(path_, b"/\\") else {
        return Some(b"");
    };
    let mut path = &path_[slash + 1..];

    while !path.is_empty() {
        let mut segment = path;
        if let Some(new_slash) = strings::index_any_comptime(path, b"/\\") {
            segment = &path[0..new_slash];
            path = &path[new_slash + 1..];
        } else {
            path = b"";
        }

        match segment.len() {
            1 => {
                if segment == b"." {
                    return Some(segment);
                }
            }
            2 => {
                if segment == b".." {
                    return Some(segment);
                }
            }
            12 => {
                // "node_modules".len
                if segment == b"node_modules" {
                    return Some(segment);
                }
            }
            _ => {}
        }
    }

    None
}

// ported from: src/resolver/package_json.zig
