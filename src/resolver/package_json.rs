use core::ffi::c_void;
use std::io::Write as _;

use bun_collections::{ArrayHashMap, MultiArrayList, StringArrayHashMap, StringMap};
use bun_core::Output;
use bun_glob as glob;
use bun_js_parser::ast as js_ast;
use bun_js_parser::lexer as js_lexer;
use bun_logger as logger;
use bun_paths::{self as resolve_path, PathBuffer, SEP_STR};
use bun_semver as Semver;
use bun_semver::String as SemverString;
use bun_str::strings;
use bun_wyhash::Wyhash;

use bun_bundler::options;
use bun_install::dependency::Dependency;
use bun_install::npm::{Architecture, OperatingSystem};
use bun_install::{self as Install, PackageID};
use bun_schema::api;
use bun_sys::Fd;

use crate::fs;
use crate::resolver;

// Assume they're not going to have hundreds of main fields or browser map
// so use an array-backed hash table instead of bucketed
pub type BrowserMap = StringMap;
pub type MacroImportReplacementMap = StringArrayHashMap<&'static [u8]>; // TODO(port): lifetime — values borrow source buffer
pub type MacroMap = StringArrayHashMap<MacroImportReplacementMap>;

type ScriptsMap = StringArrayHashMap<&'static [u8]>; // TODO(port): lifetime — values borrow source buffer

pub type MainFieldMap = StringMap;

#[derive(Default)]
pub struct DependencyMap {
    pub map: DependencyHashMap,
    // TODO(port): lifetime — borrows the package.json source contents
    pub source_buf: &'static [u8],
}

// PORT NOTE: Zig had `DependencyMap.HashMap` as a nested decl; Rust inherent impls cannot carry associated type aliases (stable), so use a free alias.
pub type DependencyHashMap = ArrayHashMap<SemverString, Dependency /* , SemverString::ArrayHashContext */>;
// TODO(port): ArrayHashMap context param — Zig used String.ArrayHashContext with store_hash=false

pub struct PackageJSON {
    pub name: Box<[u8]>,
    pub source: logger::Source,
    pub main_fields: MainFieldMap,
    pub module_type: options::ModuleType,
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IncludeDependencies {
    Main,
    Local,
    None,
}

const NODE_MODULES_PATH: &str = const_format::concatcp!(SEP_STR, "node_modules", SEP_STR);

impl PackageJSON {
    // pub const new = bun.TrivialNew(@This());
    // pub const deinit = bun.TrivialDeinit(@This());
    // TODO(port): TrivialNew/TrivialDeinit — use Box::new / Drop

    pub fn name_for_import(&self) -> Result<Box<[u8]>, bun_core::Error> {
        // TODO(port): narrow error set
        if strings::index_of(&self.source.path.text, NODE_MODULES_PATH.as_bytes()).is_some() {
            Ok(Box::from(&*self.name))
        } else {
            let parent = self.source.path.name.dir_with_trailing_slash();
            let top_level_dir = fs::FileSystem::instance().top_level_dir();
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
        for ch in normalized.iter_mut() {
            if *ch == b'\\' {
                *ch = b'/';
            }
        }
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
pub type SideEffectsMap = bun_collections::HashMap<bun_collections::StringHashMapUnownedKey, ()>;

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
            SideEffects::Map(map) => map.contains_key(&bun_collections::StringHashMapUnownedKey::init(path)),
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
                if mixed.exact.contains_key(&bun_collections::StringHashMapUnownedKey::init(path)) {
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

impl PackageJSON {
    fn load_define_defaults(
        env: &mut options::Env,
        json: &js_ast::E::Object,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut valid_count: usize = 0;
        for prop in json.properties.slice() {
            if !matches!(prop.value.as_ref().unwrap().data, js_ast::ExprData::EString(_)) {
                continue;
            }
            valid_count += 1;
        }

        env.defaults.truncate(0);
        let _ = env.defaults.reserve(valid_count);

        for prop in json.properties.slice() {
            if !matches!(prop.value.as_ref().unwrap().data, js_ast::ExprData::EString(_)) {
                continue;
            }
            // PERF(port): was appendAssumeCapacity
            env.defaults.push(options::EnvDefault {
                key: prop.key.as_ref().unwrap().data.e_string().string().expect("unreachable"),
                value: prop.value.as_ref().unwrap().data.e_string().string().expect("unreachable"),
            });
        }
        Ok(())
    }

    fn load_overrides(
        framework: &mut options::Framework,
        json: &js_ast::E::Object,
    ) {
        let mut valid_count: usize = 0;
        for prop in json.properties.slice() {
            if !matches!(prop.value.as_ref().unwrap().data, js_ast::ExprData::EString(_)) {
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
            if !matches!(prop.value.as_ref().unwrap().data, js_ast::ExprData::EString(_)) {
                continue;
            }
            keys.push(prop.key.as_ref().unwrap().data.e_string().string().expect("unreachable"));
            values.push(prop.value.as_ref().unwrap().data.e_string().string().expect("unreachable"));
        }
        framework.override_modules = api::StringMap { keys, values };
    }

    fn load_define_expression(
        env: &mut options::Env,
        json: &js_ast::E::Object,
    ) -> Result<(), bun_core::Error> {
        for prop in json.properties.slice() {
            match &prop.key.as_ref().unwrap().data {
                js_ast::ExprData::EString(e_str) => {
                    let str = e_str.string().unwrap_or_default();

                    if str.as_ref() == b"defaults" {
                        match &prop.value.as_ref().unwrap().data {
                            js_ast::ExprData::EObject(obj) => {
                                Self::load_define_defaults(env, obj)?;
                            }
                            _ => {
                                env.defaults.truncate(0);
                            }
                        }
                    } else if str.as_ref() == b".env" {
                        match &prop.value.as_ref().unwrap().data {
                            js_ast::ExprData::EString(value_str) => {
                                env.set_behavior_from_prefix(value_str.string().unwrap_or_default());
                            }
                            _ => {
                                env.behavior = options::EnvBehavior::Disable;
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
    ) -> bool {
        if let Some(client) = json.as_property(b"client") {
            if let Some(str) = client.expr.as_string() {
                if !str.is_empty() {
                    framework.client.path = str;
                    framework.client.kind = options::EntryPointKind::Client;
                }
            }
        }

        if let Some(client) = json.as_property(b"fallback") {
            if let Some(str) = client.expr.as_string() {
                if !str.is_empty() {
                    framework.fallback.path = str;
                    framework.fallback.kind = options::EntryPointKind::Fallback;
                }
            }
        }

        if let Some(css_prop) = json.as_property(b"css") {
            if let Some(str) = css_prop.expr.as_string() {
                if str.as_ref() == b"onimportcss" {
                    framework.client_css_in_js = options::CssInJs::FacadeOnimportcss;
                } else {
                    framework.client_css_in_js = options::CssInJs::Facade;
                }
            }
        }

        if let Some(override_) = json.as_property(b"override") {
            if let js_ast::ExprData::EObject(obj) = &override_.expr.data {
                Self::load_overrides(framework, obj);
            }
        }

        if READ_DEFINE {
            if let Some(defines) = json.as_property(b"define") {
                let mut skip_fallback = false;
                if let Some(client) = defines.expr.as_property(b"client") {
                    if let js_ast::ExprData::EObject(object) = &client.expr.data {
                        framework.client.env = options::Env::init();

                        let _ = Self::load_define_expression(&mut framework.client.env, object);
                        framework.fallback.env = framework.client.env.clone();
                        skip_fallback = true;
                    }
                }

                if !skip_fallback {
                    if let Some(client) = defines.expr.as_property(b"fallback") {
                        if let js_ast::ExprData::EObject(object) = &client.expr.data {
                            framework.fallback.env = options::Env::init();

                            let _ = Self::load_define_expression(&mut framework.fallback.env, object);
                        }
                    }
                }

                if let Some(server) = defines.expr.as_property(b"server") {
                    if let js_ast::ExprData::EObject(object) = &server.expr.data {
                        framework.server.env = options::Env::init();

                        let _ = Self::load_define_expression(&mut framework.server.env, object);
                    }
                }
            }
        }

        if let Some(server) = json.as_property(b"server") {
            if let Some(str) = server.expr.as_string() {
                if !str.is_empty() {
                    framework.server.path = str;
                    framework.server.kind = options::EntryPointKind::Server;
                }
            }
        }

        framework.client.is_enabled() || framework.server.is_enabled() || framework.fallback.is_enabled()
    }

    pub fn load_framework_with_preference<const READ_DEFINES: bool, const LOAD_FRAMEWORK: LoadFramework>(
        package_json: &PackageJSON,
        pair: &mut FrameworkRouterPair<'_>,
        json: js_ast::Expr,
    )
    where
        LoadFramework: core::marker::ConstParamTy, // TODO(port): derive ConstParamTy on LoadFramework
    {
        let Some(framework_object) = json.as_property(b"framework") else { return };

        if let Some(name) = framework_object.expr.as_property(b"displayName") {
            if let Some(str) = name.expr.as_string() {
                if !str.is_empty() {
                    pair.framework.display_name = str;
                }
            }
        }

        if let Some(version) = json.get(b"version") {
            if let Some(str) = version.as_string() {
                if !str.is_empty() {
                    pair.framework.version = str;
                }
            }
        }

        if let Some(static_prop) = framework_object.expr.as_property(b"static") {
            if let Some(str) = static_prop.expr.as_string() {
                if !str.is_empty() {
                    pair.router.static_dir = str;
                    pair.router.static_dir_enabled = true;
                }
            }
        }

        if let Some(asset_prefix) = framework_object.expr.as_property(b"assetPrefix") {
            if let Some(_str) = asset_prefix.expr.as_string() {
                let str = bun_str::strings::trim_right(&_str, b" ");
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
                            let str = estr.string().expect("unreachable");
                            if !str.is_empty() {
                                pair.router.dir = str;
                                pair.router.possible_dirs = Box::default();

                                pair.loaded_routes = true;
                            }
                        }
                        js_ast::ExprData::EArray(array) => {
                            let mut count: usize = 0;
                            let items = array.items.slice();
                            for item in items {
                                count += (matches!(&item.data, js_ast::ExprData::EString(s) if !s.data.is_empty())) as usize;
                            }
                            match count {
                                0 => {}
                                1 => {
                                    let str = items[0].data.e_string().string().expect("unreachable");
                                    if !str.is_empty() {
                                        pair.router.dir = str;
                                        pair.router.possible_dirs = Box::default();

                                        pair.loaded_routes = true;
                                    }
                                }
                                _ => {
                                    let mut list: Vec<Box<[u8]>> = Vec::with_capacity(count);

                                    for item in items {
                                        if let js_ast::ExprData::EString(s) = &item.data {
                                            if !s.data.is_empty() {
                                                list.push(s.string().expect("unreachable"));
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
                            let js_ast::ExprData::EString(e_str) = &expr.data else { continue };
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
                                let js_ast::ExprData::EString(e_str) = &expr.data else { continue };
                                if e_str.data.is_empty() || e_str.data[0] != b'.' {
                                    continue;
                                }
                                extensions.push(&e_str.data);
                            }
                            // TODO(port): `extensions` is computed but never assigned anywhere (matches Zig)
                            let _ = extensions;
                        }
                    }
                }
            }
        }

        match LOAD_FRAMEWORK {
            LoadFramework::Development => {
                if let Some(env) = framework_object.expr.as_property(b"development") {
                    if Self::load_framework_expression::<READ_DEFINES>(pair.framework, env.expr) {
                        pair.framework.package = package_json.name_for_import().expect("unreachable");
                        pair.framework.development = true;
                        if let Some(static_prop) = env.expr.as_property(b"static") {
                            if let Some(str) = static_prop.expr.as_string() {
                                if !str.is_empty() {
                                    pair.router.static_dir = str;
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
                    if Self::load_framework_expression::<READ_DEFINES>(pair.framework, env.expr) {
                        pair.framework.package = package_json.name_for_import().expect("unreachable");
                        pair.framework.development = false;

                        if let Some(static_prop) = env.expr.as_property(b"static") {
                            if let Some(str) = static_prop.expr.as_string() {
                                if !str.is_empty() {
                                    pair.router.static_dir = str;
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

        if Self::load_framework_expression::<READ_DEFINES>(pair.framework, framework_object.expr) {
            pair.framework.package = package_json.name_for_import().expect("unreachable");
            pair.framework.development = false;
        }
    }

    pub fn parse_macros_json(
        macros: js_ast::Expr,
        log: &mut logger::Log,
        json_source: &logger::Source,
    ) -> MacroMap {
        let mut macro_map = MacroMap::default();
        let js_ast::ExprData::EObject(obj) = &macros.data else {
            return macro_map;
        };

        let properties = obj.properties.slice();

        for property in properties {
            let Some(key) = property.key.as_ref().unwrap().as_string() else { continue };
            if !resolver::is_package_path(&key) {
                log.add_range_warning_fmt(
                    Some(json_source),
                    json_source.range_of_string(property.key.as_ref().unwrap().loc),
                    format_args!(
                        "\"{}\" is not a package path. \"macros\" remaps package paths to macros. Skipping.",
                        bstr::BStr::new(&key)
                    ),
                )
                .expect("unreachable");
                continue;
            }

            let value = property.value.as_ref().unwrap();
            let js_ast::ExprData::EObject(value_obj) = &value.data else {
                log.add_warning_fmt(
                    Some(json_source),
                    value.loc,
                    format_args!(
                        "Invalid macro remapping in \"{}\": expected object where the keys are import names and the value is a string path to replace",
                        bstr::BStr::new(&key)
                    ),
                )
                .expect("unreachable");
                continue;
            };

            let remap_properties = value_obj.properties.slice();
            if remap_properties.is_empty() {
                continue;
            }

            let mut map = MacroImportReplacementMap::default();
            map.reserve(remap_properties.len());
            for remap in remap_properties {
                let Some(import_name) = remap.key.as_ref().unwrap().as_string() else { continue };
                let remap_value = remap.value.as_ref().unwrap();
                let valid = matches!(&remap_value.data, js_ast::ExprData::EString(s) if !s.data.is_empty());
                if !valid {
                    log.add_warning_fmt(
                        Some(json_source),
                        remap_value.loc,
                        format_args!(
                            "Invalid macro remapping for import \"{}\": expected string to remap to. e.g. \"graphql\": \"bun-macro-relay\" ",
                            bstr::BStr::new(&import_name)
                        ),
                    )
                    .expect("unreachable");
                    continue;
                }

                let remap_value_str = remap_value.data.e_string().data();

                // PERF(port): was putAssumeCapacityNoClobber
                // TODO(port): lifetime — keys/values borrow json_source contents
                map.insert(import_name, remap_value_str);
            }

            if map.len() > 0 {
                macro_map.insert(key, map);
            }
        }

        macro_map
    }

    pub fn parse<const INCLUDE_DEPENDENCIES: IncludeDependencies>(
        r: &mut resolver::Resolver,
        input_path: &[u8],
        dirname_fd: Fd,
        package_id: Option<PackageID>,
        include_scripts_: IncludeScripts,
    ) -> Option<PackageJSON>
    where
        IncludeDependencies: core::marker::ConstParamTy, // TODO(port): derive ConstParamTy on IncludeDependencies
    {
        // PERF(port): include_scripts_ was a comptime enum param — profile in Phase B
        let include_scripts = include_scripts_ == IncludeScripts::IncludeScripts;

        // TODO: remove this extra copy
        let parts = [input_path, b"package.json"];
        let package_json_path_ = r.fs.abs(&parts);
        let package_json_path = r.fs.dirname_store.append(package_json_path_).expect("unreachable");

        // DirInfo cache is reused globally
        // So we cannot free these
        // (allocator dropped — global mimalloc)

        let mut entry = match r.caches.fs.read_file_with_allocator(
            r.fs,
            package_json_path,
            dirname_fd,
            false,
            None,
        ) {
            Ok(e) => e,
            Err(err) => {
                if err != bun_core::err!("IsDir") {
                    r.log
                        .add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "Cannot read file \"{}\": {}",
                                bstr::BStr::new(input_path),
                                err.name()
                            ),
                        )
                        .expect("unreachable");
                }

                return None;
            }
        };
        // defer _ = entry.closeFD(); — handled by RAII guard
        let _close_guard = scopeguard::guard((), |_| {
            let _ = entry.close_fd();
        });
        // TODO(port): scopeguard borrows `entry` — Phase B reshape

        if let Some(debug) = r.debug_logs.as_mut() {
            debug.add_note_fmt(format_args!("The file \"{}\" exists", bstr::BStr::new(package_json_path)));
        }

        let key_path = fs::Path::init(package_json_path);

        let mut json_source = logger::Source::init_path_string(key_path.text, entry.contents);
        json_source.path.pretty = json_source.path.text.clone();

        let json: js_ast::Expr = match r.caches.json.parse_package_json(r.log, &json_source, true) {
            Ok(Some(v)) => v,
            Ok(None) => return None,
            Err(err) => {
                if cfg!(debug_assertions) {
                    Output::print_error(format_args!(
                        "{}: JSON parse error: {}",
                        bstr::BStr::new(package_json_path),
                        err.name()
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
            source: json_source,
            module_type: options::ModuleType::Unknown,
            browser_map: BrowserMap::init(false),
            main_fields: MainFieldMap::init(false),
            scripts: None,
            config: None,
            arch: Architecture::all(),
            os: OperatingSystem::all(),
            package_manager_package_id: Install::INVALID_PACKAGE_ID,
            dependencies: DependencyMap::default(),
            side_effects: SideEffects::Unspecified,
            exports: None,
            imports: None,
        };
        // PORT NOTE: reshaped for borrowck — json_source moved into package_json; use package_json.source below
        let json_source = &package_json.source;

        // Note: we tried rewriting this to be fewer loops over all the properties (asProperty loops over each)
        // The end result was: it's not faster! Sometimes, it's slower.
        // It's hard to say why.
        // Feels like a codegen issue.
        // or that looping over every property doesn't really matter because most package.jsons are < 20 properties
        if let Some(version_json) = json.as_property(b"version") {
            if let Some(version_str) = version_json.expr.as_string() {
                if !version_str.is_empty() {
                    package_json.version = Box::from(version_str.as_ref());
                }
            }
        }

        if let Some(name_json) = json.as_property(b"name") {
            if let Some(name_str) = name_json.expr.as_string() {
                if !name_str.is_empty() {
                    package_json.name = Box::from(name_str.as_ref());
                }
            }
        }

        if let Some(type_json) = json.as_property(b"type") {
            if let Some(type_str) = type_json.expr.as_string() {
                match options::ModuleType::LIST.get(&type_str).copied().unwrap_or(options::ModuleType::Unknown) {
                    options::ModuleType::Cjs => {
                        package_json.module_type = options::ModuleType::Cjs;
                    }
                    options::ModuleType::Esm => {
                        package_json.module_type = options::ModuleType::Esm;
                    }
                    options::ModuleType::Unknown => {
                        r.log
                            .add_range_warning_fmt(
                                Some(json_source),
                                json_source.range_of_string(type_json.loc),
                                format_args!(
                                    "\"{}\" is not a valid value for \"type\" field (must be either \"commonjs\" or \"module\")",
                                    bstr::BStr::new(&type_str)
                                ),
                            )
                            .expect("unreachable");
                    }
                }
            } else {
                r.log
                    .add_warning(Some(json_source), type_json.loc, "The value for \"type\" must be a string")
                    .expect("unreachable");
            }
        }

        // Read the "main" fields
        for main in r.opts.main_fields.iter() {
            if let Some(main_json) = json.as_property(main) {
                let expr: &js_ast::Expr = &main_json.expr;

                if let Some(str) = expr.as_string() {
                    if !str.is_empty() {
                        package_json.main_fields.put(main, str).expect("unreachable");
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
                            let Some(key_expr) = prop.key.as_ref() else { continue };
                            let Some(_key_str) = key_expr.as_string() else { continue };
                            let Some(value) = prop.value.as_ref() else { continue };

                            // Normalize the path so we can compare against it without getting
                            // confused by "./". There is no distinction between package paths and
                            // relative paths for these values because some tools (i.e. Browserify)
                            // don't make such a distinction.
                            //
                            // This leads to weird things like a mapping for "./foo" matching an
                            // import of "foo", but that's actually not a bug. Or arguably it's a
                            // bug in Browserify but we have to replicate this bug because packages
                            // do this in the wild.
                            let key: Box<[u8]> = Box::from(r.fs.normalize(&_key_str));

                            match &value.data {
                                js_ast::ExprData::EString(str) => {
                                    // If this is a string, it's a replacement package
                                    package_json
                                        .browser_map
                                        .put(key, str.string().expect("unreachable"))
                                        .expect("unreachable");
                                }
                                js_ast::ExprData::EBoolean(boolean) => {
                                    if !boolean.value {
                                        package_json.browser_map.put(key, b"").expect("unreachable");
                                    }
                                }
                                _ => {
                                    // Only print this warning if its not inside node_modules, since node_modules/ is not actionable.
                                    if !json_source.path.is_node_module() {
                                        r.log
                                            .add_warning(
                                                Some(json_source),
                                                value.loc,
                                                "Each \"browser\" mapping must be a string or boolean",
                                            )
                                            .expect("unreachable");
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
            if let Some(exports_map) = ExportsMap::parse(json_source, r.log, exports_prop.expr, exports_prop.loc) {
                package_json.exports = Some(exports_map);
            }
        }

        if let Some(imports_prop) = json.as_property(b"imports") {
            if let Some(imports_map) = ExportsMap::parse(json_source, r.log, imports_prop.expr, imports_prop.loc) {
                package_json.imports = Some(imports_map);
            }
        }

        if let Some(side_effects_field) = json.get(b"sideEffects") {
            if let Some(boolean) = side_effects_field.as_bool() {
                if !boolean {
                    package_json.side_effects = SideEffects::False;
                }
            } else if matches!(side_effects_field.data, js_ast::ExprData::EArray(_)) {
                // Handle arrays, including empty arrays
                if let Some(array_) = side_effects_field.as_array() {
                    let mut array = array_.clone();
                    let mut map = SideEffectsMap::default();
                    let mut glob_list = GlobList::default();
                    let mut has_globs = false;
                    let mut has_exact = false;

                    // First pass: check if we have glob patterns and exact patterns
                    while let Some(item) = array.next() {
                        if let Some(name) = item.as_string() {
                            if strings::contains_char(&name, b'*')
                                || strings::contains_char(&name, b'?')
                                || strings::contains_char(&name, b'[')
                                || strings::contains_char(&name, b'{')
                            {
                                has_globs = true;
                            } else {
                                has_exact = true;
                            }
                        }
                    }

                    // Reset array for second pass
                    array = array_.clone();

                    // If the array is empty, treat it as false (no side effects)
                    if !has_globs && !has_exact {
                        package_json.side_effects = SideEffects::False;
                    } else if has_globs && has_exact {
                        // Mixed patterns - use both exact and glob matching
                        map.reserve(array.array.items.len());
                        glob_list.reserve(array.array.items.len());

                        while let Some(item) = array.next() {
                            if let Some(name) = item.as_string() {
                                // Skip CSS files as they're not relevant for tree-shaking
                                if bun_paths::extension(&name) == b".css" {
                                    continue;
                                }

                                // Store the pattern relative to the package directory
                                let joined = [
                                    json_source.path.name.dir_with_trailing_slash(),
                                    &name,
                                ];

                                let pattern = r.fs.join(&joined);

                                if strings::contains_char(&name, b'*')
                                    || strings::contains_char(&name, b'?')
                                    || strings::contains_char(&name, b'[')
                                    || strings::contains_char(&name, b'{')
                                {
                                    // Normalize pattern to use forward slashes for cross-platform compatibility
                                    let normalized_pattern =
                                        Self::normalize_path_for_glob(pattern).unwrap_or_else(|_| pattern.to_vec());
                                    // PERF(port): was appendAssumeCapacity
                                    glob_list.push(normalized_pattern.into_boxed_slice());
                                } else {
                                    // PERF(port): was getOrPutAssumeCapacity
                                    let _ = map.insert(
                                        bun_collections::StringHashMapUnownedKey::init(pattern),
                                        (),
                                    );
                                }
                            }
                        }
                        package_json.side_effects = SideEffects::Mixed(MixedPatterns { exact: map, globs: glob_list });
                    } else if has_globs {
                        // Only glob patterns
                        glob_list.reserve(array.array.items.len());
                        while let Some(item) = array.next() {
                            if let Some(name) = item.as_string() {
                                // Skip CSS files as they're not relevant for tree-shaking
                                if bun_paths::extension(&name) == b".css" {
                                    continue;
                                }

                                // Store the pattern relative to the package directory
                                let joined = [
                                    json_source.path.name.dir_with_trailing_slash(),
                                    &name,
                                ];

                                let pattern = r.fs.join(&joined);
                                // Normalize pattern to use forward slashes for cross-platform compatibility
                                let normalized_pattern =
                                    Self::normalize_path_for_glob(pattern).unwrap_or_else(|_| pattern.to_vec());
                                // PERF(port): was appendAssumeCapacity
                                glob_list.push(normalized_pattern.into_boxed_slice());
                            }
                        }
                        package_json.side_effects = SideEffects::Glob(glob_list);
                    } else {
                        // Only exact matches
                        map.reserve(array.array.items.len());
                        while let Some(item) = array.next() {
                            if let Some(name) = item.as_string() {
                                let joined = [
                                    json_source.path.name.dir_with_trailing_slash(),
                                    &name,
                                ];

                                // PERF(port): was getOrPutAssumeCapacity
                                let _ = map.insert(
                                    bun_collections::StringHashMapUnownedKey::init(r.fs.join(&joined)),
                                    (),
                                );
                            }
                        }
                        package_json.side_effects = SideEffects::Map(map);
                    }
                } else {
                    // Empty array - treat as false (no side effects)
                    package_json.side_effects = SideEffects::False;
                }
            }
        }

        if INCLUDE_DEPENDENCIES == IncludeDependencies::Main || INCLUDE_DEPENDENCIES == IncludeDependencies::Local {
            'update_dependencies: {
                if let Some(pkg) = package_id {
                    package_json.package_manager_package_id = pkg;
                    break 'update_dependencies;
                }

                // // if there is a name & version, check if the lockfile has the package
                if !package_json.name.is_empty() && !package_json.version.is_empty() {
                    if let Some(pm) = r.package_manager.as_ref() {
                        let tag = Dependency::Version::Tag::infer(&package_json.version);

                        if tag == Dependency::Version::Tag::Npm {
                            let sliced = Semver::SlicedString::init(&package_json.version, &package_json.version);
                            if let Some(dependency_version) = Dependency::parse_with_tag(
                                SemverString::init(&package_json.name, &package_json.name),
                                SemverString::Builder::string_hash(&package_json.name),
                                &package_json.version,
                                Dependency::Version::Tag::Npm,
                                &sliced,
                                r.log,
                                pm,
                            ) {
                                if dependency_version.value.npm().version.is_exact() {
                                    if let Some(resolved) = pm
                                        .lockfile
                                        .resolve_package_from_name_and_version(&package_json.name, &dependency_version)
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
                            if let Some(str) = item.as_string() {
                                arch.apply(&str);
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
                            if let Some(str) = item.as_string() {
                                os.apply(&str);
                            }
                        }

                        package_json.os = os.combine();
                    }
                }

                type DependencyGroup = Install::lockfile::Package::DependencyGroup;
                // TODO(port): comptime feature flags + comptime brk block — expanded inline below
                let dev_deps = INCLUDE_DEPENDENCIES == IncludeDependencies::Main;
                let dependency_groups: &[DependencyGroup] = if dev_deps {
                    &[
                        DependencyGroup::DEPENDENCIES,
                        DependencyGroup::DEV,
                        DependencyGroup::OPTIONAL,
                    ]
                } else {
                    &[
                        DependencyGroup::DEPENDENCIES,
                        DependencyGroup::OPTIONAL,
                    ]
                };
                // PERF(port): was comptime monomorphization (inline for over comptime array) — profile in Phase B

                let mut total_dependency_count: usize = 0;
                for group in dependency_groups {
                    if let Some(group_json) = json.get(group.field) {
                        if let js_ast::ExprData::EObject(obj) = &group_json.data {
                            total_dependency_count += obj.properties.len();
                        }
                    }
                }

                if total_dependency_count > 0 {
                    package_json.dependencies.map = DependencyHashMap::default();
                    // TODO(port): lifetime — source_buf borrows json_source.contents
                    package_json.dependencies.source_buf = json_source.contents;
                    let ctx = SemverString::ArrayHashContext {
                        arg_buf: json_source.contents,
                        existing_buf: json_source.contents,
                    };
                    package_json
                        .dependencies
                        .map
                        .ensure_total_capacity_context(total_dependency_count, &ctx)
                        .expect("unreachable");

                    for group in dependency_groups {
                        if let Some(group_json) = json.get(group.field) {
                            if let js_ast::ExprData::EObject(group_obj) = &group_json.data {
                                for prop in group_obj.properties.slice() {
                                    let Some(name_prop) = prop.key.as_ref() else { continue };
                                    let Some(name_str) = name_prop.as_string() else { continue };
                                    let name_hash = SemverString::Builder::string_hash(&name_str);
                                    let name = SemverString::init(package_json.dependencies.source_buf, &name_str);
                                    let Some(version_value) = prop.value.as_ref() else { continue };
                                    let Some(version_str) = version_value.as_string() else { continue };
                                    let sliced_str = Semver::SlicedString::init(&version_str, &version_str);

                                    if let Some(dependency_version) = Dependency::parse(
                                        name,
                                        name_hash,
                                        &version_str,
                                        &sliced_str,
                                        r.log,
                                        r.package_manager.as_deref(),
                                    ) {
                                        let dependency = Dependency {
                                            name,
                                            version: dependency_version,
                                            name_hash,
                                            behavior: group.behavior,
                                        };
                                        // PERF(port): was putAssumeCapacityContext
                                        package_json.dependencies.map.put_assume_capacity_context(
                                            dependency.name,
                                            dependency,
                                            &ctx,
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
        if include_scripts {
            if let Some(scripts) = json.as_property_string_map(b"scripts") {
                package_json.scripts = Some(scripts);
            }
            if let Some(config) = json.as_property_string_map(b"config") {
                package_json.config = Some(config);
            }
        }

        Some(package_json)
    }

    pub fn hash_module(&self, module: &[u8]) -> u32 {
        let mut hasher = Wyhash::init(0);
        // TODO(port): `this.hash` field referenced in Zig but not declared on PackageJSON; preserving call shape
        hasher.update(bytes_of(&self.hash));
        hasher.update(module);

        hasher.final_() as u32
    }
}

#[inline]
fn bytes_of<T>(v: &T) -> &[u8] {
    // SAFETY: reading the raw bytes of a Sized value
    unsafe { core::slice::from_raw_parts(v as *const T as *const u8, core::mem::size_of::<T>()) }
}

pub struct ExportsMap {
    pub root: Entry,
    pub exports_range: logger::Range,
    pub property_key_loc: logger::Loc,
}

impl ExportsMap {
    pub fn parse(
        source: &logger::Source,
        log: &mut logger::Log,
        json: js_ast::Expr,
        property_key_loc: logger::Loc,
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
    pub source: &'a logger::Source,
    pub log: &'a mut logger::Log,
}

impl<'a> Visitor<'a> {
    pub fn visit(&mut self, expr: js_ast::Expr) -> Entry {
        let mut first_token: logger::Range = logger::Range::NONE;

        match &expr.data {
            js_ast::ExprData::ENull => {
                return Entry {
                    first_token: js_lexer::range_of_identifier(self.source, expr.loc),
                    data: EntryData::Null,
                };
            }
            js_ast::ExprData::EString(str) => {
                return Entry {
                    data: EntryData::String(str.slice()),
                    first_token: self.source.range_of_string(expr.loc),
                };
            }
            js_ast::ExprData::EArray(e_array) => {
                let mut array: Vec<Entry> = Vec::with_capacity(e_array.items.len());
                for item in e_array.items.slice() {
                    array.push(self.visit(*item));
                }
                return Entry {
                    data: EntryData::Array(array.into_boxed_slice()),
                    first_token: logger::Range { loc: expr.loc, len: 1 },
                };
            }
            js_ast::ExprData::EObject(e_obj) => {
                let mut map_data = EntryDataMapList::default();
                map_data.ensure_total_capacity(e_obj.properties.len()).expect("unreachable");
                map_data.set_len(e_obj.properties.len());
                let mut expansion_keys: Vec<MapEntry> = Vec::with_capacity(e_obj.properties.len());
                let mut map_data_slices = map_data.slice();
                let map_data_keys = map_data_slices.items_mut::<{ MapEntryField::Key }>();
                let map_data_ranges = map_data_slices.items_mut::<{ MapEntryField::KeyRange }>();
                let map_data_entries = map_data_slices.items_mut::<{ MapEntryField::Value }>();
                // TODO(port): MultiArrayList slice column accessors — Phase B API
                let mut is_conditional_sugar = false;
                first_token.loc = expr.loc;
                first_token.len = 1;
                for (i, prop) in e_obj.properties.slice().iter().enumerate() {
                    let key: Box<[u8]> = prop.key.as_ref().unwrap().data.e_string().slice();
                    let key_range: logger::Range = self.source.range_of_string(prop.key.as_ref().unwrap().loc);

                    // If exports is an Object with both a key starting with "." and a key
                    // not starting with ".", throw an Invalid Package Configuration error.
                    let cur_is_conditional_sugar = !strings::starts_with_char(&key, b'.');
                    if i == 0 {
                        is_conditional_sugar = cur_is_conditional_sugar;
                    } else if is_conditional_sugar != cur_is_conditional_sugar {
                        let prev_key_range = map_data_ranges[i - 1];
                        let prev_key = &map_data_keys[i - 1];
                        self.log
                            .add_range_warning_fmt_with_note(
                                Some(self.source),
                                key_range,
                                format_args!(
                                    "This object cannot contain keys that both start with \".\" and don't start with \".\""
                                ),
                                format_args!(
                                    "The previous key \"{}\" is incompatible with the current key \"{}\"",
                                    bstr::BStr::new(prev_key),
                                    bstr::BStr::new(&key)
                                ),
                                prev_key_range,
                            )
                            .expect("unreachable");
                        // map_data.deinit / allocator.free(expansion_keys) — drop handles cleanup
                        return Entry {
                            data: EntryData::Invalid,
                            first_token,
                        };
                    }

                    map_data_keys[i] = key.clone();
                    map_data_ranges[i] = key_range;
                    map_data_entries[i] = self.visit(prop.value.unwrap());

                    // safe to use "/" on windows. exports in package.json does not use "\\"
                    if strings::ends_with(&key, b"/") || strings::contains_char(&key, b'*') {
                        expansion_keys.push(MapEntry {
                            value: map_data_entries[i].clone(),
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
                // TODO(port): strings.NewGlobLengthSorter — implement comparator in bun_str::strings
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

        self.log
            .add_range_warning(
                Some(self.source),
                first_token,
                "This value must be a string, an object, an array, or null",
            )
            .expect("unreachable");
        Entry {
            data: EntryData::Invalid,
            first_token,
        }
    }
}

#[derive(Clone)]
pub struct Entry {
    pub first_token: logger::Range,
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

pub type EntryDataMapList = MultiArrayList<MapEntry>;

#[derive(Clone)]
pub struct MapEntry {
    pub key: Box<[u8]>, // TODO(port): lifetime — borrows source contents in Zig
    pub key_range: logger::Range,
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
        matches!(&self.data, EntryData::Map(m) if m.list.len() > 0 && strings::starts_with_char(&m.list.items_key()[0], b'.'))
        // TODO(port): MultiArrayList .items(.key) accessor
    }

    pub fn value_for_key(&self, key_: &[u8]) -> Option<Entry> {
        match &self.data {
            EntryData::Map(m) => {
                let slice = m.list.slice();
                let keys = slice.items_key();
                for (i, key) in keys.iter().enumerate() {
                    if strings::eql(key, key_) {
                        return Some(slice.items_value()[i].clone());
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
    pub module_type: &'a mut options::ModuleType,
}

#[derive(Clone)]
pub struct Resolution {
    pub status: Status,
    // TODO(port): lifetime — points into threadlocal PathBuffer or input slices
    pub path: &'static [u8],
    pub debug: ResolutionDebug,
}

impl Default for Resolution {
    fn default() -> Self {
        Resolution {
            status: Status::Undefined,
            path: b"",
            debug: ResolutionDebug::default(),
        }
    }
}

#[derive(Clone, Default)]
pub struct ResolutionDebug {
    // This is the range of the token to use for error messages
    pub token: logger::Range,
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
pub struct Package {
    // TODO(port): lifetime — borrows from `specifier` / `subpath_buf`
    pub name: &'static [u8],
    pub version: &'static [u8],
    pub subpath: &'static [u8],
}

impl Default for Package {
    fn default() -> Self {
        Package { name: b"", version: b"", subpath: b"" }
    }
}

#[derive(Clone, Copy, Default)]
pub struct PackageExternal {
    pub name: Semver::String,
    pub version: Semver::String,
    pub subpath: Semver::String,
}

impl Package {
    pub fn count(self, builder: &mut Semver::string::Builder) {
        builder.count(self.name);
        builder.count(self.version);
        builder.count(self.subpath);
    }

    pub fn clone(self, builder: &mut Semver::string::Builder) -> PackageExternal {
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

    pub fn with_auto_version(self) -> Package {
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
            slash = if slash == -1 { i32::try_from(specifier.len()).unwrap() } else { slash };
            Some(&specifier[0..usize::try_from(slash).unwrap()])
        } else {
            if slash == -1 {
                return None;
            }

            let after = usize::try_from(slash).unwrap() + 1;
            let slash2 = strings::index_of_char(&specifier[after..], b'/')
                .map(|v| v as usize)
                .unwrap_or(specifier[u32::try_from(slash + 1).unwrap() as usize..].len());
            Some(&specifier[0..usize::try_from(slash + 1).unwrap() + slash2])
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

    pub fn parse(specifier: &'static [u8], subpath_buf: &'static mut [u8]) -> Option<Package> {
        // TODO(port): lifetime — &'static is a placeholder; should be <'a>
        if specifier.is_empty() {
            return None;
        }
        let mut package = Package {
            name: Self::parse_name(specifier)?,
            subpath: b"",
            version: b"",
        };

        if strings::starts_with(package.name, b".") || strings::index_any(package.name, b"\\%").is_some() {
            return None;
        }

        // A version delimiter `@` is only valid within the package-name portion of
        // the specifier. Searching the entire specifier misparses wildcard subpaths
        // whose matched substring contains `@` (e.g. `test-pkg/@scope/sub/index.js`
        // or `ember-source/@ember/renderer/...`) as if the package had a version.
        let offset: usize = if package.name.is_empty() || package.name[0] != b'@' { 0 } else { 1 };
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
                    &specifier[(package.name.len() + package.version.len() + 1).min(specifier.len())..],
                    subpath_buf,
                );
                return Some(package);
            }
        }
        Self::parse_subpath(&mut package.subpath, &specifier[package.name.len()..], subpath_buf);

        Some(package)
    }

    pub fn parse_subpath(subpath: &mut &[u8], specifier: &[u8], subpath_buf: &mut [u8]) {
        // TODO(port): lifetime — subpath borrows subpath_buf
        if specifier.len() + 1 > subpath_buf.len() {
            *subpath = b"";
            return;
        }
        subpath_buf[0] = b'.';
        subpath_buf[1..1 + specifier.len()].copy_from_slice(specifier);
        // SAFETY: subpath_buf outlives subpath at all call sites; Phase B will add proper lifetimes
        *subpath = unsafe { core::slice::from_raw_parts(subpath_buf.as_ptr(), specifier.len() + 1) };
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReverseKind {
    Exact,
    Pattern,
    Prefix,
}

#[derive(Clone, Default)]
pub struct ReverseResolution {
    // TODO(port): lifetime — borrows threadlocal buffer or input
    pub subpath: &'static [u8],
    pub token: logger::Range,
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
    // TODO(port): bun.ThreadlocalBuffers — using RefCell<ModuleBufs>; access via .with_borrow_mut
    static MODULE_BUFS: core::cell::RefCell<ModuleBufs> = const {
        core::cell::RefCell::new(ModuleBufs {
            resolved_path_buf_percent: PathBuffer::ZEROED,
            resolve_target_buf: PathBuffer::ZEROED,
            resolve_target_buf2: PathBuffer::ZEROED,
            resolve_target_reverse_prefix_buf: PathBuffer::ZEROED,
            resolve_target_reverse_prefix_buf2: PathBuffer::ZEROED,
        })
    };
}

impl<'a> ESModule<'a> {
    pub fn resolve(&self, package_url: &[u8], subpath: &[u8], exports: &Entry) -> Resolution {
        Self::finalize(self.resolve_exports(package_url, subpath, exports))
    }

    pub fn resolve_imports(&self, specifier: &[u8], imports: &Entry) -> Resolution {
        if !matches!(imports.data, EntryData::Map(_)) {
            return Resolution {
                status: Status::InvalidPackageConfiguration,
                debug: ResolutionDebug { token: logger::Range::NONE, ..Default::default() },
                ..Default::default()
            };
        }

        let result = self.resolve_imports_exports(specifier, imports, true, b"/");

        match result.status {
            Status::Undefined | Status::Null => Resolution {
                status: Status::PackageImportNotDefined,
                debug: ResolutionDebug { token: result.debug.token, ..Default::default() },
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
        // TODO(port): threadlocal buffer access via with_borrow_mut wrapper; using raw ptr to keep flow
        let resolved_path_buf_percent: &mut PathBuffer = MODULE_BUFS.with_borrow_mut(|b| {
            // SAFETY: threadlocal buffer lives for thread lifetime; result.path borrows it
            unsafe { &mut *(&mut b.resolved_path_buf_percent as *mut PathBuffer) }
        });
        // TODO(port): std.io.fixedBufferStream + PercentEncoding.decode
        let len = match bun_url::PercentEncoding::decode_into(resolved_path_buf_percent.as_mut_slice(), result.path) {
            Ok(n) => n,
            Err(_) => {
                return Resolution {
                    status: Status::InvalidModuleSpecifier,
                    path: result.path,
                    debug: result.debug,
                };
            }
        };

        let resolved_path = &resolved_path_buf_percent.as_slice()[0..len];

        let mut found: &[u8] = b"";
        if strings::contains(resolved_path, INVALID_PERCENT_CHARS[0]) {
            found = INVALID_PERCENT_CHARS[0];
        } else if strings::contains(resolved_path, INVALID_PERCENT_CHARS[1]) {
            found = INVALID_PERCENT_CHARS[1];
        } else if strings::contains(resolved_path, INVALID_PERCENT_CHARS[2]) {
            found = INVALID_PERCENT_CHARS[2];
        } else if strings::contains(resolved_path, INVALID_PERCENT_CHARS[3]) {
            found = INVALID_PERCENT_CHARS[3];
        }

        if !found.is_empty() {
            return Resolution {
                status: Status::InvalidModuleSpecifier,
                path: result.path,
                debug: result.debug,
            };
        }

        // If resolved is a directory, throw an Unsupported Directory Import error.
        if strings::ends_with_any(resolved_path, b"/\\") {
            return Resolution {
                status: Status::UnsupportedDirectoryImport,
                path: result.path,
                debug: result.debug,
            };
        }

        // TODO(port): lifetime — resolved_path borrows threadlocal buffer
        // SAFETY: resolved_path borrows the threadlocal resolved_path_buf_percent which lives for the thread lifetime
        result.path = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(resolved_path) };
        result
    }

    fn resolve_exports(&self, package_url: &[u8], subpath: &[u8], exports: &Entry) -> Resolution {
        if matches!(exports.data, EntryData::Invalid) {
            if let Some(logs) = &self.debug_logs {
                logs.add_note("Invalid package configuration");
            }

            return Resolution {
                status: Status::InvalidPackageConfiguration,
                debug: ResolutionDebug { token: exports.first_token, ..Default::default() },
                ..Default::default()
            };
        }

        if subpath == b"." {
            let mut main_export = Entry { data: EntryData::Null, first_token: logger::Range::NONE };
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
                    debug: ResolutionDebug { token: exports.first_token, ..Default::default() },
                    ..Default::default()
                };
            }
        }

        if let Some(logs) = &self.debug_logs {
            logs.add_note_fmt(format_args!("The path \"{}\" was not exported", bstr::BStr::new(subpath)));
        }

        Resolution {
            status: Status::PackagePathNotExported,
            debug: ResolutionDebug { token: exports.first_token, ..Default::default() },
            ..Default::default()
        }
    }

    fn resolve_imports_exports(
        &self,
        match_key: &[u8],
        match_obj: &Entry,
        is_imports: bool,
        package_url: &[u8],
    ) -> Resolution {
        if let Some(logs) = &self.debug_logs {
            logs.add_note_fmt(format_args!("Checking object path map for \"{}\"", bstr::BStr::new(match_key)));
        }

        // If matchKey is a key of matchObj and does not end in "/" or contain "*", then
        if !strings::ends_with_char(match_key, b'/') && !strings::contains_char(match_key, b'*') {
            if let Some(target) = match_obj.value_for_key(match_key) {
                if let Some(log) = &self.debug_logs {
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
                            || (strings::ends_with(match_key, pattern_trailer) && match_key.len() >= expansion.key.len())
                        {
                            let target = &expansion.value;
                            let subpath = &match_key[pattern_base.len()..match_key.len() - pattern_trailer.len()];
                            if let Some(log) = &self.debug_logs {
                                log.add_note_fmt(format_args!(
                                    "The key \"{}\" matched with \"{}\" left over",
                                    bstr::BStr::new(&expansion.key),
                                    bstr::BStr::new(subpath)
                                ));
                            }
                            return self.resolve_target::<true>(package_url, target, subpath, is_imports);
                        }
                    }
                } else {
                    // Otherwise if patternBase is null and matchKey starts with
                    // expansionKey, then
                    if strings::starts_with(match_key, &expansion.key) {
                        let target = &expansion.value;
                        let subpath = &match_key[expansion.key.len()..];
                        if let Some(log) = &self.debug_logs {
                            log.add_note_fmt(format_args!(
                                "The key \"{}\" matched with \"{}\" left over",
                                bstr::BStr::new(&expansion.key),
                                bstr::BStr::new(subpath)
                            ));
                        }
                        let mut result = self.resolve_target::<false>(package_url, target, subpath, is_imports);
                        if result.status == Status::Exact || result.status == Status::ExactEndsWithStar {
                            // Return the object { resolved, exact: false }.
                            result.status = Status::Inexact;
                        }
                        return result;
                    }
                }

                if let Some(log) = &self.debug_logs {
                    log.add_note_fmt(format_args!("The key \"{}\" did not match", bstr::BStr::new(&expansion.key)));
                }
            }
        }

        if let Some(log) = &self.debug_logs {
            log.add_note_fmt(format_args!("No keys matched \"{}\"", bstr::BStr::new(match_key)));
        }

        Resolution {
            status: Status::Null,
            debug: ResolutionDebug { token: match_obj.first_token, ..Default::default() },
            ..Default::default()
        }
    }

    fn resolve_target<const PATTERN: bool>(
        &self,
        package_url: &[u8],
        target: &Entry,
        subpath: &[u8],
        internal: bool,
    ) -> Resolution {
        // TODO(port): threadlocal buffer access — see MODULE_BUFS note in finalize()
        let (resolve_target_buf, resolve_target_buf2): (&mut PathBuffer, &mut PathBuffer) =
            MODULE_BUFS.with_borrow_mut(|b| unsafe {
                // SAFETY: threadlocal buffers live for thread lifetime; results borrow them
                (
                    &mut *(&mut b.resolve_target_buf as *mut PathBuffer),
                    &mut *(&mut b.resolve_target_buf2 as *mut PathBuffer),
                )
            });
        match &target.data {
            EntryData::String(str) => {
                let str: &[u8] = str;
                if let Some(log) = &self.debug_logs {
                    log.add_note_fmt(format_args!(
                        "Checking path \"{}\" against target \"{}\"",
                        bstr::BStr::new(subpath),
                        bstr::BStr::new(str)
                    ));
                    log.increase_indent();
                }
                let _indent_guard = scopeguard::guard((), |_| {
                    if let Some(log) = &self.debug_logs {
                        log.decrease_indent();
                    }
                });
                // TODO(port): scopeguard borrow of self.debug_logs — Phase B reshape

                // If pattern is false, subpath has non-zero length and target
                // does not end with "/", throw an Invalid Module Specifier error.
                if !PATTERN {
                    if !subpath.is_empty() && !strings::ends_with_char(str, b'/') {
                        if let Some(log) = &self.debug_logs {
                            log.add_note_fmt(format_args!(
                                "The target \"{}\" is invalid because it doesn't end with a \"/\"",
                                bstr::BStr::new(str)
                            ));
                        }

                        return Resolution {
                            path: tl_static(str),
                            status: Status::InvalidModuleSpecifier,
                            debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                        };
                    }
                }

                // If target does not start with "./", then...
                if !strings::starts_with(str, b"./") {
                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because it doesn't start with a \"./\"",
                            bstr::BStr::new(str)
                        ));
                    }

                    if internal && !strings::has_prefix(str, b"../") && !strings::has_prefix(str, b"/") {
                        if PATTERN {
                            // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                            let len = strings::replacement_size(str, b"*", subpath);
                            let _ = strings::replace(str, b"*", subpath, resolve_target_buf2.as_mut_slice());
                            let result = &resolve_target_buf2.as_slice()[0..len];
                            if let Some(log) = &self.debug_logs {
                                log.add_note_fmt(format_args!(
                                    "Subsituted \"{}\" for \"*\" in \".{}\" to get \".{}\" ",
                                    bstr::BStr::new(subpath),
                                    bstr::BStr::new(str),
                                    bstr::BStr::new(result)
                                ));
                            }

                            return Resolution {
                                path: tl_static(result),
                                status: Status::PackageResolve,
                                debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                            };
                        } else {
                            let parts2 = [str, subpath];
                            let result = resolve_path::join_string_buf(resolve_target_buf2.as_mut_slice(), &parts2, resolve_path::Platform::Auto);
                            if let Some(log) = &self.debug_logs {
                                log.add_note_fmt(format_args!(
                                    "Resolved \".{}\" to \".{}\"",
                                    bstr::BStr::new(str),
                                    bstr::BStr::new(result)
                                ));
                            }

                            return Resolution {
                                path: tl_static(result),
                                status: Status::PackageResolve,
                                debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                            };
                        }
                    }

                    return Resolution {
                        path: tl_static(str),
                        status: Status::InvalidPackageTarget,
                        debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                    };
                }

                // If target split on "/" or "\" contains any ".", ".." or "node_modules"
                // segments after the first segment, throw an Invalid Package Target error.
                if let Some(invalid) = find_invalid_segment(str) {
                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because it contains an invalid segment \"{}\"",
                            bstr::BStr::new(str),
                            bstr::BStr::new(invalid)
                        ));
                    }

                    return Resolution {
                        path: tl_static(str),
                        status: Status::InvalidPackageTarget,
                        debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                    };
                }

                // Let resolvedTarget be the URL resolution of the concatenation of packageURL and target.
                let parts = [package_url, str];
                let resolved_target = resolve_path::join_string_buf(resolve_target_buf.as_mut_slice(), &parts, resolve_path::Platform::Auto);

                // If target split on "/" or "\" contains any ".", ".." or "node_modules"
                // segments after the first segment, throw an Invalid Package Target error.
                if let Some(invalid) = find_invalid_segment(resolved_target) {
                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because it contains an invalid segment \"{}\"",
                            bstr::BStr::new(str),
                            bstr::BStr::new(invalid)
                        ));
                    }

                    return Resolution {
                        path: tl_static(str),
                        status: Status::InvalidModuleSpecifier,
                        debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                    };
                }

                if PATTERN {
                    // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                    let len = strings::replacement_size(resolved_target, b"*", subpath);
                    let _ = strings::replace(resolved_target, b"*", subpath, resolve_target_buf2.as_mut_slice());
                    let result = &resolve_target_buf2.as_slice()[0..len];
                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!(
                            "Substituted \"{}\" for \"*\" in \".{}\" to get \".{}\" ",
                            bstr::BStr::new(subpath),
                            bstr::BStr::new(resolved_target),
                            bstr::BStr::new(result)
                        ));
                    }

                    let status: Status = if strings::ends_with_char_or_is_zero_length(result, b'*')
                        && strings::index_of_char(result, b'*').unwrap() as usize == result.len() - 1
                    {
                        Status::ExactEndsWithStar
                    } else {
                        Status::Exact
                    };
                    return Resolution {
                        path: tl_static(result),
                        status,
                        debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                    };
                } else {
                    let parts2 = [package_url, str, subpath];
                    let result = resolve_path::join_string_buf(resolve_target_buf2.as_mut_slice(), &parts2, resolve_path::Platform::Auto);
                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!(
                            "Substituted \"{}\" for \"*\" in \".{}\" to get \".{}\" ",
                            bstr::BStr::new(subpath),
                            bstr::BStr::new(resolved_target),
                            bstr::BStr::new(result)
                        ));
                    }

                    return Resolution {
                        path: tl_static(result),
                        status: Status::Exact,
                        debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                    };
                }
            }
            EntryData::Map(object) => {
                let mut did_find_map_entry = false;
                let mut last_map_entry_i: usize = 0;

                let slice = object.list.slice();
                let keys = slice.items_key();
                for (i, key) in keys.iter().enumerate() {
                    if self.conditions.contains_key(key) {
                        if let Some(log) = &self.debug_logs {
                            log.add_note_fmt(format_args!("The key \"{}\" matched", bstr::BStr::new(key)));
                        }

                        let prev_module_type = *self.module_type;
                        let result = self.resolve_target::<PATTERN>(package_url, &slice.items_value()[i], subpath, internal);
                        if result.status.is_undefined() {
                            did_find_map_entry = true;
                            last_map_entry_i = i;
                            *self.module_type = prev_module_type;
                            // TODO(port): &self with &mut deref of module_type — needs interior mutability or &mut self
                            continue;
                        }

                        if key.as_ref() == b"import" {
                            *self.module_type = options::ModuleType::Esm;
                        }

                        if key.as_ref() == b"require" {
                            *self.module_type = options::ModuleType::Cjs;
                        }

                        return result;
                    }

                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!("The key \"{}\" did not match", bstr::BStr::new(key)));
                    }
                }

                if let Some(log) = &self.debug_logs {
                    log.add_note_fmt(format_args!("No keys matched"));
                }

                let mut return_target = target;
                // ALGORITHM DEVIATION: Provide a friendly error message if no conditions matched
                if !keys.is_empty() && !target.keys_start_with_dot() {
                    let last_map_entry = MapEntry {
                        key: keys[last_map_entry_i].clone(),
                        value: slice.items_value()[last_map_entry_i].clone(),
                        // key_range is unused, so we don't need to pull up the array for it.
                        key_range: logger::Range::NONE,
                    };
                    if did_find_map_entry
                        && matches!(&last_map_entry.value.data, EntryData::Map(m) if m.list.len() > 0)
                        && !last_map_entry.value.keys_start_with_dot()
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
                        return_target = &slice.items_value()[last_map_entry_i];
                    }

                    let unmatched = match &return_target.data {
                        EntryData::Map(m) => m.list.items_key().to_vec().into_boxed_slice(),
                        _ => Box::default(),
                    };

                    return Resolution {
                        path: b"",
                        status: Status::UndefinedNoConditionsMatch,
                        debug: ResolutionDebug {
                            token: target.first_token,
                            unmatched_conditions: unmatched,
                        },
                    };
                }

                return Resolution {
                    path: b"",
                    status: Status::UndefinedNoConditionsMatch,
                    debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                };
            }
            EntryData::Array(array) => {
                if array.is_empty() {
                    if let Some(log) = &self.debug_logs {
                        log.add_note_fmt(format_args!("The path \"{}\" is an empty array", bstr::BStr::new(subpath)));
                    }

                    return Resolution {
                        path: b"",
                        status: Status::Null,
                        debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                    };
                }

                let mut last_exception = Status::Undefined;
                let mut last_debug = ResolutionDebug { token: target.first_token, ..Default::default() };

                for target_value in array.iter() {
                    // Let resolved be the result, continuing the loop on any Invalid Package Target error.
                    let prev_module_type = *self.module_type;
                    let result = self.resolve_target::<PATTERN>(package_url, target_value, subpath, internal);
                    if result.status == Status::InvalidPackageTarget || result.status == Status::Null {
                        last_debug = result.debug.clone();
                        last_exception = result.status;
                    }

                    if result.status.is_undefined() {
                        *self.module_type = prev_module_type;
                        continue;
                    }

                    return result;
                }

                return Resolution { path: b"", status: last_exception, debug: last_debug };
            }
            EntryData::Null => {
                if let Some(log) = &self.debug_logs {
                    log.add_note_fmt(format_args!("The path \"{}\" is null", bstr::BStr::new(subpath)));
                }

                return Resolution {
                    path: b"",
                    status: Status::Null,
                    debug: ResolutionDebug { token: target.first_token, ..Default::default() },
                };
            }
            _ => {}
        }

        if let Some(logs) = &self.debug_logs {
            logs.add_note_fmt(format_args!("Invalid package target for path \"{}\"", bstr::BStr::new(subpath)));
        }

        Resolution {
            status: Status::InvalidPackageTarget,
            debug: ResolutionDebug { token: target.first_token, ..Default::default() },
            ..Default::default()
        }
    }

    fn resolve_exports_reverse(&self, query: &[u8], root: &Entry) -> Option<ReverseResolution> {
        if matches!(root.data, EntryData::Map(_)) && root.keys_start_with_dot() {
            if let Some(res) = self.resolve_imports_exports_reverse(query, root) {
                return Some(res);
            }
        }

        None
    }

    fn resolve_imports_exports_reverse(&self, query: &[u8], match_obj: &Entry) -> Option<ReverseResolution> {
        let EntryData::Map(map) = &match_obj.data else { return None };

        if !strings::ends_with_char_or_is_zero_length(query, b'*') {
            let slices = map.list.slice();
            let keys = slices.items_key();
            let values = slices.items_value();
            for (i, key) in keys.iter().enumerate() {
                if let Some(result) = self.resolve_target_reverse::<{ ReverseKind::Exact }>(query, key, &values[i]) {
                    return Some(result);
                }
            }
        }

        for expansion in map.expansion_keys.iter() {
            if strings::ends_with_char_or_is_zero_length(&expansion.key, b'*') {
                if let Some(result) =
                    self.resolve_target_reverse::<{ ReverseKind::Pattern }>(query, &expansion.key, &expansion.value)
                {
                    return Some(result);
                }
            }

            // TODO(port): Zig used `.reverse` here but ReverseKind has no `.reverse` variant — preserved as Prefix? Actually Zig defines {exact, pattern, prefix}; `.reverse` is a typo in Zig source
            if let Some(result) =
                self.resolve_target_reverse::<{ ReverseKind::Prefix }>(query, &expansion.key, &expansion.value)
            {
                return Some(result);
            }
        }

        // TODO(port): Zig fn falls through with no return (implicit unreachable); returning None
        None
    }

    fn resolve_target_reverse<const KIND: ReverseKind>(
        &self,
        query: &[u8],
        key: &[u8],
        target: &Entry,
    ) -> Option<ReverseResolution>
    where
        ReverseKind: core::marker::ConstParamTy, // TODO(port): derive ConstParamTy on ReverseKind
    {
        let (resolve_target_reverse_prefix_buf, resolve_target_reverse_prefix_buf2): (&mut PathBuffer, &mut PathBuffer) =
            MODULE_BUFS.with_borrow_mut(|b| unsafe {
                // SAFETY: threadlocal buffers live for thread lifetime
                (
                    &mut *(&mut b.resolve_target_reverse_prefix_buf as *mut PathBuffer),
                    &mut *(&mut b.resolve_target_reverse_prefix_buf2 as *mut PathBuffer),
                )
            });
        match &target.data {
            EntryData::String(str) => {
                let str: &[u8] = str;
                match KIND {
                    ReverseKind::Exact => {
                        if strings::eql(query, str) {
                            return Some(ReverseResolution { subpath: tl_static(str), token: target.first_token });
                        }
                    }
                    ReverseKind::Prefix => {
                        if strings::starts_with(query, str) {
                            let mut buf = resolve_target_reverse_prefix_buf.as_mut_slice();
                            let n = {
                                let mut w = &mut buf[..];
                                let _ = w.write_all(key);
                                let _ = w.write_all(&query[str.len()..]);
                                buf.len() - w.len()
                            };
                            return Some(ReverseResolution {
                                subpath: tl_static(&buf[..n]),
                                token: target.first_token,
                            });
                        }
                    }
                    ReverseKind::Pattern => {
                        let key_without_trailing_star = strings::trim_right(key, b"*");

                        let Some(star) = strings::index_of_char(str, b'*') else {
                            // Handle the case of no "*"
                            if strings::eql(query, str) {
                                return Some(ReverseResolution {
                                    subpath: tl_static(key_without_trailing_star),
                                    token: target.first_token,
                                });
                            }
                            return None;
                        };
                        let star = star as usize;

                        // Only support tracing through a single "*"
                        let prefix = &str[0..star];
                        let suffix = &str[star + 1..];
                        if strings::starts_with(query, prefix) && !strings::contains_char(suffix, b'*') {
                            let after_prefix = &query[prefix.len()..];
                            if strings::ends_with(after_prefix, suffix) {
                                let star_data = &after_prefix[0..after_prefix.len() - suffix.len()];
                                let mut buf = resolve_target_reverse_prefix_buf2.as_mut_slice();
                                let n = {
                                    let mut w = &mut buf[..];
                                    let _ = w.write_all(key_without_trailing_star);
                                    let _ = w.write_all(star_data);
                                    buf.len() - w.len()
                                };
                                return Some(ReverseResolution {
                                    subpath: tl_static(&buf[..n]),
                                    token: target.first_token,
                                });
                            }
                        }
                    }
                }
            }
            EntryData::Map(map) => {
                let slice = map.list.slice();
                let keys = slice.items_key();
                for (i, map_key) in keys.iter().enumerate() {
                    if self.conditions.contains_key(map_key) {
                        if let Some(result) = self.resolve_target_reverse::<KIND>(query, key, &slice.items_value()[i]) {
                            if map_key.as_ref() == b"import" {
                                *self.module_type = options::ModuleType::Esm;
                            } else if map_key.as_ref() == b"require" {
                                *self.module_type = options::ModuleType::Cjs;
                            }
                            // TODO(port): &self with &mut deref — needs interior mutability or &mut self

                            return Some(result);
                        }
                    }
                }
            }

            EntryData::Array(array) => {
                for target_value in array.iter() {
                    if let Some(result) = self.resolve_target_reverse::<KIND>(query, key, target_value) {
                        return Some(result);
                    }
                }
            }

            _ => {}
        }

        None
    }
}

// TODO(port): lifetime — helper to launder threadlocal-buffer slices as 'static for Resolution.path.
// Phase B: replace with proper lifetimes on Resolution / ReverseResolution.
#[inline]
fn tl_static(s: &[u8]) -> &'static [u8] {
    // SAFETY: caller guarantees `s` borrows a threadlocal PathBuffer or long-lived source buffer
    unsafe { core::mem::transmute::<&[u8], &'static [u8]>(s) }
}

fn find_invalid_segment(path_: &[u8]) -> Option<&[u8]> {
    let Some(slash) = strings::index_any(path_, b"/\\") else {
        return Some(b"");
    };
    let mut path = &path_[slash + 1..];

    while !path.is_empty() {
        let mut segment = path;
        if let Some(new_slash) = strings::index_any(path, b"/\\") {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/package_json.zig (2186 lines)
//   confidence: medium
//   todos:      41
//   notes:      Heavy use of threadlocal PathBuffer slices and source-buffer-borrowed strings; used &'static [u8] + tl_static() as placeholder — Phase B must add proper lifetimes. ESModule mutates module_type/debug_logs through &self (Zig *const) — needs Cell/&mut reshape. MultiArrayList column accessors stubbed.
// ──────────────────────────────────────────────────────────────────────────
