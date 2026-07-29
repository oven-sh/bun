use bun_ast as js_ast;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::Output;
use bun_core::strings;
use bun_js_parser::lexer as js_lexer;
use bun_paths::{self as resolve_path, MAX_PATH_BYTES, PathBuffer, SEP_STR};
use bun_semver as Semver;
use bun_semver::String as SemverString;

use bun_options_types::bundle_enums::ModuleType;
use bun_sys::Fd;

use crate as resolver;
use crate::fs;
use bun_parsers::json_parser;

// ── bun_install types (MOVE_DOWN: bun_install_types) ──────────────────────
// Note: bun_resolver cannot depend on bun_install (would loop). The
// auto-install path is dormant until `bun_install` writes `r.package_manager`;
// all install-tier value types are the canonical `bun_install_types` shapes.

pub use ::bun_install_types::resolver_hooks::{
    Architecture, Dependency, DependencyGroup, DependencyVersion, DependencyVersionTag,
    OperatingSystem,
};
pub use ::bun_install_types::resolver_hooks::{INVALID_PACKAGE_ID, PackageID};
// Deliberately a bare alias rather than `bun_collections::StringMap` (which
// wraps the same `StringArrayHashMap<Box<[u8]>>` with a `dupe_keys` flag the
// resolver never needs); callers here use the map API directly.
pub type StringMap = StringArrayHashMap<Box<[u8]>>;
pub use bun_collections::StringHashMapUnownedKey;
use bun_glob as glob;

// Assume they're not going to have hundreds of main fields or browser map
// so use an array-backed hash table instead of bucketed
pub type BrowserMap = StringMap;
/// Values are owned `Box<[u8]>` so callers (CLI bunfig → bundler options)
/// can populate without `unsafe` lifetime-extension casts.
pub type MacroImportReplacementMap = StringArrayHashMap<Box<[u8]>>;
pub type MacroMap = StringArrayHashMap<MacroImportReplacementMap>;

// Values borrow the package.json source buffer; `'static` is a lifetime-erased
// borrow kept alive by `PackageJSON::source_contents` (the owning field).
type ScriptsMap = StringArrayHashMap<&'static [u8]>;

pub type MainFieldMap = StringMap;

#[derive(Default)]
pub struct DependencyMap {
    pub map: DependencyHashMap,
    // Borrows the package.json source contents; lifetime-erased to 'static,
    // kept alive by `PackageJSON::source_contents`.
    pub source_buf: &'static [u8],
}

impl Clone for DependencyMap {
    /// Deep-clones the small key/value vecs; `SemverString`/`Dependency` are
    /// POD over `source_buf`.
    fn clone(&self) -> Self {
        Self {
            map: self.map.clone().expect("OOM"),
            source_buf: self.source_buf,
        }
    }
}

// Inherent impls cannot carry associated type aliases (stable), so use a free alias.
pub type DependencyHashMap =
    ArrayHashMap<SemverString, Dependency /* , SemverString::ArrayHashContext */>;

pub struct PackageJSON {
    pub name: Box<[u8]>,
    pub source: bun_ast::Source,
    /// Owns the file bytes that `source.contents` (and the
    /// `&'static [u8]` map values below) borrow. Replaces the prior
    /// `mem::forget` leak — forbidden per docs/PORTING.md §Forbidden patterns.
    /// The `PackageJSON` itself is the owner so the bytes free if it ever drops.
    /// (`bun_ast::Source::contents` is `&'static [u8]`, so this separate owner
    /// field is what keeps that borrow — and the map values above — alive.)
    pub source_contents: Box<[u8]>,
    pub(crate) json_tape: Option<Box<js_ast::E::JsonTape>>,
    pub main_fields: MainFieldMap,
    pub module_type: ModuleType,
    pub version: Box<[u8]>,

    pub scripts: Option<Box<ScriptsMap>>,
    // Values borrow the source buffer (lifetime-erased; owned by `source_contents`).
    pub config: Option<Box<StringArrayHashMap<&'static [u8]>>>,

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

// hand-rolled `Default` because `#[derive(Default)]` would zero
// `package_manager_package_id` (a valid lockfile id — typically the root
// package). The field defaults to `Install.invalid_package_id` (= `u32::MAX`);
// `node_fallbacks.rs` relies on `..Default::default()` matching that. Likewise
// `arch`/`os` default to `*::all()`.
impl Default for PackageJSON {
    fn default() -> Self {
        PackageJSON {
            name: Box::default(),
            source: bun_ast::Source::default(),
            source_contents: Box::default(),
            json_tape: None,
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
    /// Normalize path separators to forward slashes for glob matching
    /// This is needed because glob patterns use forward slashes but Windows uses backslashes
    fn normalize_path_for_glob(path: &[u8]) -> Result<Vec<u8>, bun_alloc::AllocError> {
        let mut normalized = path.to_vec();
        bun_paths::slashes_to_posix_in_place(&mut normalized[..]);
        Ok(normalized)
    }
}

#[derive(Default)]
pub enum SideEffects {
    /// either `package.json` is missing "sideEffects", it is true, or some
    /// other unsupported value. Treat all files as side effects
    #[default]
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
// the former `JsonCachePackageJsonExt` shim trait is removed —
// `JsonCacheVTable` now has a real `parse_package_json` slot and `JsonCache`
// exposes the inherent forwarder (tsconfig_json.rs).
// `bun_bundler::cache::JSON_CACHE_VTABLE` wires it to `bun_parsers::json`.

/// Thin extension trait that delegates to
/// `bun_paths::resolve_path` and returns owned `Box<[u8]>` so no `'static`
/// lifetime is fabricated from a threadlocal scratch buffer (forbidden per
/// docs/PORTING.md §Forbidden patterns — "`unsafe { &*(p as *const _) }` to
/// extend a lifetime"). `crate::fs::FileSystem` already has an inherent
/// borrowing `abs(&self) -> &[u8]` (lib.rs); that wins method resolution at
/// call-sites that only need a transient borrow.
pub trait FileSystemPackageJsonExt {
    fn join(&self, parts: &[&[u8]]) -> &'static [u8];
    fn normalize(&self, str: &[u8]) -> Box<[u8]>;
}
impl FileSystemPackageJsonExt for crate::fs::FileSystem {
    fn join(&self, parts: &[&[u8]]) -> &'static [u8] {
        resolve_path::resolve_path::join::<resolve_path::resolve_path::platform::Loose>(parts)
    }
    fn normalize(&self, str: &[u8]) -> Box<[u8]> {
        // Collapses `.`/`..`/dup-separators only; does NOT join against cwd.
        let out = resolve_path::resolve_path::normalize_string::<
            true,
            resolve_path::resolve_path::platform::Auto,
        >(str);
        Box::from(&*out)
    }
}

impl PackageJSON {
    pub fn parse_macros_json(
        macros: js_ast::Expr,
        log: &mut bun_ast::Log,
        json_source: &bun_ast::Source,
    ) -> MacroMap {
        let mut macro_map = MacroMap::default();
        if !macros.is_object() {
            return macro_map;
        }

        macros.for_each_property(|key, key_loc, value| {
            if !resolver::is_package_path(key) {
                log.add_range_warning_fmt(
                    Some(json_source),
                    json_source.range_of_string(key_loc),
                    format_args!(
                        "\"{}\" is not a package path. \"macros\" remaps package paths to macros. Skipping.",
                        bstr::BStr::new(key)
                    ),
                );
                return;
            }

            if !value.is_object() {
                log.add_warning_fmt(
                    Some(json_source),
                    json_parser::value_loc_of_property(&json_source.contents, key_loc, &value),
                    format_args!(
                        "Invalid macro remapping in \"{}\": expected object where the keys are import names and the value is a string path to replace",
                        bstr::BStr::new(key)
                    ),
                );
                return;
            }

            let remap_count = value.property_count();
            if remap_count == 0 {
                return;
            }

            let mut map = MacroImportReplacementMap::default();
            map.reserve(remap_count);
            value.for_each_property(|import_name, remap_key_loc, remap_value| {
                let valid =
                    matches!(&remap_value.data, js_ast::ExprData::EString(s) if !s.data.is_empty());
                if !valid {
                    log.add_warning_fmt(
                        Some(json_source),
                        json_parser::value_loc_of_property(
                            &json_source.contents,
                            remap_key_loc,
                            &remap_value,
                        ),
                        format_args!(
                            "Invalid macro remapping for import \"{}\": expected string to remap to. e.g. \"graphql\": \"bun-macro-relay\" ",
                            bstr::BStr::new(import_name)
                        ),
                    );
                    return;
                }

                let remap_value_str: &[u8] = match remap_value.data.e_string() {
                    Some(s) => s.data.slice(),
                    None => return,
                };

                map.insert(import_name, Box::<[u8]>::from(remap_value_str));
            });

            if map.len() > 0 {
                macro_map.insert(key, map);
            }
        });

        macro_map
    }

    pub fn parse<const INCLUDE_DEPENDENCIES: IncludeDependencies>(
        r: &mut resolver::Resolver<'_>,
        input_path: &[u8],
        dirname_fd: Fd,
        package_id: Option<PackageID>,
        include_scripts_: IncludeScripts,
    ) -> Option<PackageJSON> {
        let include_scripts = include_scripts_ == IncludeScripts::IncludeScripts;

        // SAFETY: PORT (Stacked Borrows) — `r.fs()`/`r.log()` return RAW `*mut`
        // (see `Resolver::fs()` note in lib.rs). `fs` and `log` are DISTINCT
        // singletons so the two `&mut` projections below do not alias each other,
        // and no other `&mut *r.fs` / `&mut *r.log` retag occurs while they are
        // live in this function. Caller upholds the single-thread `Resolver`
        // aliasing contract.
        let r_fs: &mut fs::FileSystem = unsafe { &mut *r.fs() };
        // SAFETY: see above — `r.log()` points to a distinct singleton from `r.fs()`.
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
                if err != crate::Error::Sys(bun_errno::SystemErrno::EISDIR) {
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
        // Reshaped for borrowck — `mem::take` the contents (leaving
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

        // `bun_ast::Source.path` is the lightweight `bun_paths::fs::Path<'static>` (no
        // `pretty`/`is_node_module`); `key_path` is only used for `text`, so init the
        // source directly from the interned path.
        //
        // `bun_ast::Source::contents` is `&'static [u8]`, so `json_source`
        // re-borrows `entry_contents` (lifetime-erased) instead of owning it.
        //
        // SAFETY: `entry_contents: Box<[u8]>` is the unique owner of these bytes.
        // On the success path it is *moved* (not leaked) into
        // `package_json.source_contents` at the bottom of this fn, so the heap
        // allocation lives for the life of the returned `PackageJSON`. On every
        // early `return None` below `entry_contents` drops and frees normally, after
        // `json_source` is already dead. `Box<[u8]>` heap address is stable
        // across the move.
        let contents_static: &'static [u8] = unsafe { bun_ptr::detach_lifetime(&entry_contents) };
        let json_source = bun_ast::Source::init_path_string(package_json_path, contents_static);

        let parsed_json = match r.caches.json.parse_package_json(r_log, &json_source) {
            Ok(Some(v)) => v,
            Ok(None) => return None,
            Err(err) => {
                if cfg!(debug_assertions) {
                    Output::print_error(format_args!(
                        "{}: JSON parse error: {}",
                        bstr::BStr::new(package_json_path),
                        bstr::BStr::new(err.name())
                    ));
                }
                return None;
            }
        };
        let json: js_ast::Expr = parsed_json.root;

        if !json.is_object() {
            // Invalid package.json in node_modules is noisy.
            // Let's just ignore it.
            // (allocator.free dropped — entry.contents owned by `entry`)
            return None;
        }

        let mut package_json = PackageJSON {
            name: Box::default(),
            version: Box::default(),
            // Reshaped for borrowck — `json_source` stays a local until the
            // end so we can borrow it while mutating other `package_json` fields.
            source: bun_ast::Source::default(),
            // Filled at the bottom by moving `entry_contents` in (see SAFETY note above).
            source_contents: Box::default(),
            json_tape: None,
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
        // shadow as `&Source`; the owned value is reconstructed at the bottom
        // (Source isn't `Clone`).
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
                if let js_ast::ExprData::EObjectJSON(obj) = &browser_prop.expr.data {
                    // The value is an object

                    // Remap all files in the browser field
                    for prop in obj.get().properties() {
                        let _key_str = prop.key.slice();

                        // Normalize the path so we can compare against it without getting
                        // confused by "./". There is no distinction between package paths and
                        // relative paths for these values because some tools (i.e. Browserify)
                        // don't make such a distinction.
                        //
                        // This leads to weird things like a mapping for "./foo" matching an
                        // import of "foo", but that's actually not a bug. Or arguably it's a
                        // bug in Browserify but we have to replicate this bug because packages
                        // do this in the wild.
                        let key: Box<[u8]> = FileSystemPackageJsonExt::normalize(r_fs, _key_str);

                        match &prop.value {
                            js_ast::E::JsonValue::String(str) => {
                                // If this is a string, it's a replacement package
                                package_json
                                    .browser_map
                                    .put(&key, Box::from(str.slice()))
                                    .expect("unreachable");
                            }
                            js_ast::E::JsonValue::Boolean(boolean) => {
                                if !*boolean {
                                    package_json
                                        .browser_map
                                        .put(&key, Box::default())
                                        .expect("unreachable");
                                }
                            }
                            _ => {
                                // Only print this warning if its not inside node_modules, since node_modules/ is not actionable.
                                if !strings::contains(
                                    json_source.path.text,
                                    NODE_MODULES_PATH.as_bytes(),
                                ) {
                                    let value_loc = json_parser::property_value_loc(
                                        &json_source.contents,
                                        prop.key_loc,
                                    )
                                    .unwrap_or(prop.key_loc);
                                    r_log.add_warning(
                                        Some(json_source),
                                        value_loc,
                                        b"Each \"browser\" mapping must be a string or boolean",
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(exports_prop) = json.as_property(b"exports") {
            if let Some(exports_map) = ExportsMap::parse(json_source, r_log, exports_prop.expr) {
                package_json.exports = Some(exports_map);
            }
        }

        if let Some(imports_prop) = json.as_property(b"imports") {
            if let Some(imports_map) = ExportsMap::parse(json_source, r_log, imports_prop.expr) {
                package_json.imports = Some(imports_map);
            }
        }

        if let Some(side_effects_field) = json.get(b"sideEffects") {
            if let Some(boolean) = side_effects_field.as_bool() {
                if !boolean {
                    package_json.side_effects = SideEffects::False;
                }
            } else if let js_ast::ExprData::EArrayJSON(e_array) = &side_effects_field.data {
                // Handle arrays, including empty arrays
                let items = e_array.get().items();
                let mut map = SideEffectsMap::default();
                let mut glob_list = GlobList::default();
                let mut has_globs = false;
                let mut has_exact = false;

                // First pass: check if we have glob patterns and exact patterns
                for item in items {
                    if let Some(name) = item.as_str() {
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
                        if let Some(name) = item.as_str() {
                            // Skip CSS files as they're not relevant for tree-shaking
                            if bun_paths::extension(name) == b".css" {
                                continue;
                            }

                            // Store the pattern relative to the package directory
                            let joined: [&[u8]; 2] =
                                [json_source.path.name().dir_with_trailing_slash(), name];

                            let pattern = r_fs.join(&joined);

                            if strings::contains_char(name, b'*')
                                || strings::contains_char(name, b'?')
                                || strings::contains_char(name, b'[')
                                || strings::contains_char(name, b'{')
                            {
                                // Normalize pattern to use forward slashes for cross-platform compatibility
                                let normalized_pattern = Self::normalize_path_for_glob(pattern)
                                    .unwrap_or_else(|_| pattern.to_vec());
                                glob_list.push(normalized_pattern.into_boxed_slice());
                            } else {
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
                        if let Some(name) = item.as_str() {
                            // Skip CSS files as they're not relevant for tree-shaking
                            if bun_paths::extension(name) == b".css" {
                                continue;
                            }

                            // Store the pattern relative to the package directory
                            let joined: [&[u8]; 2] =
                                [json_source.path.name().dir_with_trailing_slash(), name];

                            let pattern = r_fs.join(&joined);
                            // Normalize pattern to use forward slashes for cross-platform compatibility
                            let normalized_pattern = Self::normalize_path_for_glob(pattern)
                                .unwrap_or_else(|_| pattern.to_vec());
                            glob_list.push(normalized_pattern.into_boxed_slice());
                        }
                    }
                    package_json.side_effects = SideEffects::Glob(glob_list);
                } else {
                    // Only exact matches
                    map.reserve(items.len());
                    for item in items {
                        if let Some(name) = item.as_str() {
                            let joined: [&[u8]; 2] =
                                [json_source.path.name().dir_with_trailing_slash(), name];

                            let _ =
                                map.insert(StringHashMapUnownedKey::init(r_fs.join(&joined)), ());
                        }
                    }
                    package_json.side_effects = SideEffects::Map(map);
                }
            }
        }

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
                                Some(&mut *r_log),
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

                let mut total_dependency_count: usize = 0;
                for group in dependency_groups {
                    if let Some(group_json) = json.get(group.field) {
                        total_dependency_count += group_json.property_count();
                    }
                }

                if total_dependency_count > 0 {
                    package_json.dependencies.map = DependencyHashMap::default();
                    // source_buf borrows json_source.contents (lifetime-erased;
                    // owned by `package_json.source_contents` on the success path).
                    package_json.dependencies.source_buf = contents_static;
                    // ArrayHashMap has no `*_context` variant yet — the
                    // generic `put_assume_capacity` path is sufficient because keys are
                    // `SemverString` (offset+len into `source_buf`, hashed by content).
                    package_json
                        .dependencies
                        .map
                        .ensure_total_capacity(total_dependency_count)
                        .expect("unreachable");

                    for group in dependency_groups {
                        if let Some(group_json) = json.get(group.field) {
                            if let js_ast::ExprData::EObjectJSON(group_obj) = &group_json.data {
                                for prop in group_obj.get().properties() {
                                    let name_str = prop.key.slice();
                                    if !bun_alloc::is_slice_in_buffer(
                                        name_str,
                                        package_json.dependencies.source_buf,
                                    ) {
                                        continue;
                                    }
                                    let name_hash =
                                        Semver::semver_string::Builder::string_hash(name_str);
                                    let name = SemverString::init(
                                        package_json.dependencies.source_buf,
                                        name_str,
                                    );
                                    let Some(version_str) = prop.value.as_str() else {
                                        continue;
                                    };
                                    let sliced_str =
                                        Semver::SlicedString::init(version_str, version_str);

                                    // The parser body lives in install-tier so route through
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
                                            Some(&mut *r_log),
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
        if include_scripts {
            // Local: build a `StringArrayHashMap<&'static [u8]>` for the named
            // top-level object property.
            let property_string_map =
                |name: &[u8]| -> Option<Box<StringArrayHashMap<&'static [u8]>>> {
                    let prop = json.as_property(name)?;
                    let js_ast::ExprData::EObjectJSON(obj) = &prop.expr.data else {
                        return None;
                    };
                    let obj = obj.get();
                    let mut map = StringArrayHashMap::<&'static [u8]>::default();
                    map.ensure_total_capacity(obj.properties().len()).ok()?;
                    for p in obj.properties() {
                        let key = p.key.slice();
                        let Some(value) = p.value.as_str() else {
                            continue;
                        };
                        // Drop entries where the key OR the value is empty.
                        // An empty-valued script (`{"scripts":{"build":""}}`)
                        // must NOT become a real (empty) script — report
                        // "Script not found".
                        // (npm actually runs empty scripts and exits 0; we
                        // intentionally diverge here to match released Bun.)
                        if key.is_empty() || value.is_empty() {
                            continue;
                        }
                        // SAFETY: `value` borrows `contents_static` or the tape; the returned PackageJSON owns both.
                        let value: &'static [u8] = unsafe { bun_ptr::detach_lifetime(value) };
                        map.put_assume_capacity(key, value);
                    }
                    // Return None when the FILTERED map is empty, not just when
                    // the raw object had no properties.
                    if map.is_empty() {
                        return None;
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

        // Reshaped for borrowck — assign source last (see struct init above).
        // `bun_ast::Source` isn't `Clone`; reconstruct from its (all-Copy/Clone) fields.
        package_json.source = bun_ast::Source {
            path: json_source.path,
            contents: std::borrow::Cow::Borrowed(contents_static),
            contents_is_recycled: json_source.contents_is_recycled,
            identifier_name: json_source.identifier_name.clone(),
            index: json_source.index,
        };
        // See SAFETY note on `contents_static` above — move ownership of the
        // backing buffer into the returned struct (replaces the prior
        // `mem::forget`, forbidden per docs/PORTING.md §Forbidden patterns).
        package_json.source_contents = entry_contents;
        package_json.json_tape = parsed_json.tape;
        Some(package_json)
    }
}

pub struct ExportsMap {
    pub root: Entry,
}

impl ExportsMap {
    pub fn parse(
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        json: js_ast::Expr,
    ) -> Option<ExportsMap> {
        let mut visitor = Visitor { source, log };

        let root = visitor.visit(json);

        if matches!(root.data, EntryData::Null) {
            return None;
        }

        Some(ExportsMap { root })
    }
}

pub struct Visitor<'a> {
    pub source: &'a bun_ast::Source,
    pub log: &'a mut bun_ast::Log,
}

impl<'a> Visitor<'a> {
    pub fn visit(&mut self, expr: js_ast::Expr) -> Entry {
        let vloc = json_parser::ValueLocation::Property(expr.loc);
        match &expr.data {
            js_ast::ExprData::ENull(_) => Entry {
                data: EntryData::Null,
            },
            js_ast::ExprData::EString(str) => {
                debug_assert!(!str.is_utf16);
                Entry {
                    data: EntryData::String(Box::from(str.data.slice())),
                }
            }
            js_ast::ExprData::EObjectJSON(e_obj) => self.visit_object(e_obj.get()),
            js_ast::ExprData::EArrayJSON(e_array) => self.visit_array(e_array.get(), &vloc),
            data => self.invalid_root(data, vloc),
        }
    }

    fn visit_value(
        &mut self,
        value: &js_ast::E::JsonValue,
        vloc: json_parser::ValueLocation<'_>,
    ) -> Entry {
        match value {
            js_ast::E::JsonValue::Null => Entry {
                data: EntryData::Null,
            },
            js_ast::E::JsonValue::String(str) => Entry {
                data: EntryData::String(Box::from(str.slice())),
            },
            js_ast::E::JsonValue::Object(e_obj) => self.visit_object(e_obj.get()),
            js_ast::E::JsonValue::Array(e_array) => self.visit_array(e_array.get(), &vloc),
            js_ast::E::JsonValue::Boolean(_) => {
                let loc = vloc.resolve(&self.source.contents);
                self.invalid(js_lexer::range_of_identifier(self.source, loc))
            }
            js_ast::E::JsonValue::Number(_) => {
                let loc = vloc.resolve(&self.source.contents);
                self.invalid(bun_ast::Range { loc, len: 1 })
            }
        }
    }

    fn visit_object(&mut self, e_obj: &js_ast::E::ObjectJSON) -> Entry {
        let rows = e_obj.properties();
        let mut map_data: EntryDataMapList = Vec::with_capacity(rows.len());
        let mut expansion_keys: Vec<MapEntry> = Vec::with_capacity(rows.len());
        let mut is_conditional_sugar = false;
        for (i, prop) in rows.iter().enumerate() {
            let key: Box<[u8]> = Box::from(prop.key.slice());
            let key_range: bun_ast::Range = self.source.range_of_string(prop.key_loc);

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
                return Entry {
                    data: EntryData::Invalid,
                };
            }

            let value = self.visit_value(
                &prop.value,
                json_parser::ValueLocation::Property(prop.key_loc),
            );

            // safe to use "/" on windows. exports in package.json does not use "\\"
            if strings::ends_with(&key, b"/") || strings::contains_char(&key, b'*') {
                expansion_keys.push(MapEntry {
                    value: value.clone(),
                    key: key.clone(),
                    key_range,
                });
            }

            map_data.push(MapEntry {
                key,
                key_range,
                value,
            });
        }

        // this leaks a lil, but it's fine.

        // Let expansionKeys be the list of keys of matchObj either ending in "/"
        // or containing only a single "*", sorted by the sorting function
        // PATTERN_KEY_COMPARE which orders in descending order of specificity.
        expansion_keys.sort_by(|a, b| strings::glob_length_compare(&a.key, &b.key));

        Entry {
            data: EntryData::Map(EntryDataMap {
                list: map_data,
                expansion_keys: expansion_keys.into_boxed_slice(),
            }),
        }
    }

    fn visit_array(
        &mut self,
        e_array: &js_ast::E::ArrayJSON,
        vloc: &json_parser::ValueLocation<'_>,
    ) -> Entry {
        let items = e_array.items();
        let mut array: Vec<Entry> = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            array.push(self.visit_value(item, json_parser::ValueLocation::ArrayItem(vloc, index)));
        }
        Entry {
            data: EntryData::Array(array.into_boxed_slice()),
        }
    }

    #[cold]
    fn invalid_root(
        &mut self,
        data: &js_ast::ExprData,
        vloc: json_parser::ValueLocation<'_>,
    ) -> Entry {
        let first_token = match data {
            js_ast::ExprData::EBoolean(_) => {
                js_lexer::range_of_identifier(self.source, vloc.resolve(&self.source.contents))
            }
            // TODO: range of number
            js_ast::ExprData::ENumber(_) => bun_ast::Range {
                loc: vloc.resolve(&self.source.contents),
                len: 1,
            },
            _ => bun_ast::Range {
                loc: vloc.resolve(&self.source.contents),
                ..bun_ast::Range::NONE
            },
        };
        self.invalid(first_token)
    }

    #[cold]
    fn invalid(&mut self, first_token: bun_ast::Range) -> Entry {
        self.log.add_range_warning(
            Some(self.source),
            first_token,
            b"This value must be a string, an object, an array, or null",
        );
        Entry {
            data: EntryData::Invalid,
        }
    }
}

#[derive(Clone)]
pub struct Entry {
    pub data: EntryData,
}

#[derive(Clone)]
pub enum EntryData {
    Invalid,
    Null,
    String(Box<[u8]>), // owned copy
    Array(Box<[Entry]>),
    Map(EntryDataMap),
}

#[derive(Clone)]
pub struct EntryDataMap {
    // This is not a std.ArrayHashMap because we also store the key_range which is a little weird
    pub expansion_keys: Box<[MapEntry]>,
    pub list: EntryDataMapList,
}

pub type EntryDataMapList = Vec<MapEntry>;

#[derive(Clone)]
pub struct MapEntry {
    pub key: Box<[u8]>, // owned copy
    pub key_range: bun_ast::Range,
    pub value: Entry,
}

impl Entry {
    pub fn keys_start_with_dot(&self) -> bool {
        matches!(&self.data, EntryData::Map(m) if !m.list.is_empty() && strings::starts_with_char(&m.list[0].key, b'.'))
    }

    pub fn value_for_key(&self, key_: &[u8]) -> Option<&Entry> {
        match &self.data {
            EntryData::Map(m) => {
                for entry in m.list.iter() {
                    if strings::eql(&entry.key, key_) {
                        return Some(&entry.value);
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
    pub conditions: &'a ConditionsMap,
    // allocator dropped — global mimalloc
    pub module_type: &'a mut ModuleType,
}

#[derive(Clone)]
pub struct Resolution {
    pub status: Status,
    // The source-buffer case (`EntryData::String(Box<[u8]>)`) is owned by a
    // possibly-temporary `Entry`, so borrowing would dangle. Copy out into an owned buffer.
    pub path: Box<[u8]>,
}

impl Default for Resolution {
    fn default() -> Self {
        Resolution {
            status: Status::Undefined,
            path: Box::default(),
        }
    }
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

    /// Allocate a fresh string buffer and clone `name`/`version`/`subpath`
    /// into it as offset-encoded `Semver::String`s. Mirrors the inline
    /// `count` → `allocate` → `clone` Builder dance the resolver does at the
    /// auto-install pending sites, exposed as the `esm.copy` helper.
    pub fn copy(self) -> crate::CrateResult<(PackageExternal, Vec<u8>)> {
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
                .unwrap_or_else(|| {
                    specifier[u32::try_from(slash + 1).expect("int cast") as usize..].len()
                });
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

use bun_core::strings::{replace, replacement_size};

const INVALID_PERCENT_CHARS: [&[u8]; 4] = [b"%2f", b"%2F", b"%5c", b"%5C"];

struct ModuleBufs {
    resolved_path_buf_percent: PathBuffer,
    resolve_target_buf: PathBuffer,
    resolve_target_buf2: PathBuffer,
}

// Heap-allocate the buffer struct on first use and store only a pointer in TLS
// so the static-TLS template stays small (PE/COFF has no TLS-BSS; ELF PT_TLS
// MemSiz scales with this — see test/js/bun/binary/tls-segment-size).
// resolve_target / resolve_target_reverse are RECURSIVE (Map/Array arms call
// themselves), so a RefCell + escaped `&mut PathBuffer` would create aliased
// `&mut` at the inner call → UB. Use raw-pointer access; only form
// `&mut PathBuffer` inside the non-recursive `String` arms where the buffers
// are actually written (no overlap with a live outer `&mut`).
//
// `ModuleBufsSlot::drop` reclaims the box so short-lived threads that touch
// the resolver (`bun_bundler::BundleThread` overflow threads) do not strand it.
struct ModuleBufsSlot(core::cell::Cell<*mut ModuleBufs>);
impl Drop for ModuleBufsSlot {
    fn drop(&mut self) {
        let p = self.0.get();
        if !p.is_null() {
            // SAFETY: produced by `heap::into_raw` in `module_bufs` below; this
            // thread is exiting so no `resolve_target*` frame holds a borrow.
            drop(unsafe { Box::from_raw(p) });
        }
    }
}
thread_local! {
    static MODULE_BUFS: ModuleBufsSlot =
        const { ModuleBufsSlot(core::cell::Cell::new(core::ptr::null_mut())) };
}

#[inline]
fn module_bufs() -> *mut ModuleBufs {
    MODULE_BUFS.with(|c| {
        let mut p = c.0.get();
        if p.is_null() {
            p = bun_core::heap::into_raw(Box::new(ModuleBufs {
                resolved_path_buf_percent: PathBuffer::ZEROED,
                resolve_target_buf: PathBuffer::ZEROED,
                resolve_target_buf2: PathBuffer::ZEROED,
            }));
            c.0.set(p);
        }
        p
    })
}

// `module_type` / `debug_logs` are `&'a mut T`, so reading/writing them
// requires `&mut self`. All resolution methods take `&mut self`.
impl<'a> ESModule<'a> {
    pub fn resolve(&mut self, package_url: &[u8], subpath: &[u8], exports: &Entry) -> Resolution {
        let r = self.resolve_exports(package_url, subpath, exports);
        Self::finalize(r)
    }

    pub fn resolve_imports(&mut self, specifier: &[u8], imports: &Entry) -> Resolution {
        if !matches!(imports.data, EntryData::Map(_)) {
            return Resolution {
                status: Status::InvalidPackageConfiguration,
                ..Default::default()
            };
        }

        let result = self.resolve_imports_exports(specifier, imports, true, b"/");

        match result.status {
            Status::Undefined | Status::Null => Resolution {
                status: Status::PackageImportNotDefined,
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

        // Fast path: without a '%' there is no percent-encoding, so INVALID_PERCENT_CHARS
        // cannot match, decode_into is the identity, and result.path is already the owned
        // decoded buffer. Only the directory check remains.
        if !strings::contains_char(&result.path, b'%') {
            if strings::ends_with_any(&result.path, b"/\\") {
                result.status = Status::UnsupportedDirectoryImport;
            }
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
            };
        }

        // SAFETY: threadlocal UnsafeCell; finalize() does not recurse, so this is the unique
        // live `&mut` to resolved_path_buf_percent on this thread.
        let resolved_path_buf_percent: &mut PathBuffer =
            unsafe { &mut (*module_bufs()).resolved_path_buf_percent };
        let len = match bun_url::PercentEncoding::decode_into(
            &mut resolved_path_buf_percent.0,
            &result.path,
        ) {
            Ok(n) => n,
            Err(_) => {
                return Resolution {
                    status: Status::InvalidModuleSpecifier,
                    path: result.path,
                };
            }
        };

        let resolved_path = &resolved_path_buf_percent.0[0..len as usize];

        // If resolved is a directory, throw an Unsupported Directory Import error.
        if strings::ends_with_any(resolved_path, b"/\\") {
            return Resolution {
                status: Status::UnsupportedDirectoryImport,
                path: result.path,
            };
        }

        // Copy out — see `Resolution.path` note.
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
                ..Default::default()
            };
        }

        if subpath == b"." {
            let main_export: Option<&Entry> = match &exports.data {
                EntryData::String(_) | EntryData::Array(_) => Some(exports),
                EntryData::Map(_) if !exports.keys_start_with_dot() => Some(exports),
                EntryData::Map(_) => exports.value_for_key(b"."),
                _ => None,
            };

            if let Some(main_export) = main_export {
                if !matches!(main_export.data, EntryData::Null) {
                    let result = self.resolve_target::<false>(package_url, main_export, b"", false);
                    if result.status != Status::Null && result.status != Status::Undefined {
                        return result;
                    }
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

                return self.resolve_target::<false>(package_url, target, b"", is_imports);
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
                let mb = module_bufs();
                // SAFETY: threadlocal UnsafeCell; the `String` arm does NOT recurse into
                // resolve_target, so these are the unique live `&mut`s on this thread for
                // the duration of this arm. Map/Array arms below DO recurse and must not
                // hold these — that's why acquisition is here, not at fn entry.
                let resolve_target_buf: &mut PathBuffer = unsafe { &mut (*mb).resolve_target_buf };
                // SAFETY: see above — disjoint field of the same threadlocal struct.
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
                // A scopeguard cannot hold the &mut across the recursive
                // `&mut self` calls below; every return path in this arm invokes
                // `dedent!()` manually instead (audited: every return in this arm dedents).
                macro_rules! dedent {
                    () => {
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.decrease_indent();
                        }
                    };
                }
                macro_rules! invalid_specifier_if_too_long {
                    ($len:expr) => {
                        if $len > MAX_PATH_BYTES {
                            if let Some(log) = self.debug_logs.as_deref_mut() {
                                log.add_note_fmt(format_args!(
                                    "The path \"{}\" is invalid because it is too long",
                                    bstr::BStr::new(subpath)
                                ));
                            }
                            dedent!();
                            return Resolution {
                                path: Box::<[u8]>::from(subpath),
                                status: Status::InvalidModuleSpecifier,
                            };
                        }
                    };
                }

                if package_url.len() + str.len() + subpath.len() + 8 > MAX_PATH_BYTES {
                    if let Some(log) = self.debug_logs.as_deref_mut() {
                        log.add_note_fmt(format_args!(
                            "The target \"{}\" is invalid because the resolved path would be too long",
                            bstr::BStr::new(str)
                        ));
                    }
                    dedent!();
                    return Resolution {
                        path: Box::<[u8]>::from(str),
                        status: Status::InvalidPackageTarget,
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
                        };
                    }
                }

                // If the wildcard match (or trailing-slash remainder) taken from
                // the import specifier contains any ".", ".." or "node_modules"
                // segments, throw an Invalid Module Specifier error. Node's
                // PACKAGE_TARGET_RESOLVE applies the same validation to
                // patternMatch; without it the specifier can substitute "../"
                // segments into the target and escape the package directory.
                if !subpath.is_empty() {
                    if let Some(invalid) = find_invalid_subpath_segment(subpath) {
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.add_note_fmt(format_args!(
                                "The path \"{}\" is invalid because it contains an invalid segment \"{}\"",
                                bstr::BStr::new(subpath),
                                bstr::BStr::new(invalid)
                            ));
                        }
                        dedent!();
                        return Resolution {
                            path: Box::<[u8]>::from(subpath),
                            status: Status::InvalidModuleSpecifier,
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
                            invalid_specifier_if_too_long!(len);
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
                            };
                        } else {
                            // Latent Windows bug (#30839): this branch runs when an
                            // `imports` target is itself a package specifier
                            // (e.g. `@myproject/resolver`) that we hand back to
                            // package-resolve. Per the Node.js packages spec these
                            // are URL-like specifiers and must keep forward slashes;
                            // `Auto` normalizes them to `\` on Windows and the
                            // scoped-name match fails, falling through to `main`.
                            let parts2 = [str, subpath];
                            let result = resolve_path::resolve_path::join_string_buf::<
                                resolve_path::platform::Posix,
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
                            };
                        }
                    }
                    dedent!();
                    return Resolution {
                        path: Box::<[u8]>::from(str),
                        status: Status::InvalidPackageTarget,
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
                    };
                }

                if PATTERN {
                    // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                    let len = replacement_size(resolved_target, b"*", subpath);
                    invalid_specifier_if_too_long!(len);
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

                    if let Some(invalid) = find_invalid_segment(result) {
                        if let Some(log) = self.debug_logs.as_deref_mut() {
                            log.add_note_fmt(format_args!(
                                "The path \"{}\" is invalid because it contains an invalid segment \"{}\"",
                                bstr::BStr::new(result),
                                bstr::BStr::new(invalid)
                            ));
                        }
                        dedent!();
                        return Resolution {
                            path: Box::<[u8]>::from(result),
                            status: Status::InvalidModuleSpecifier,
                        };
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
                    };
                }
            }
            EntryData::Map(object) => {
                for entry in object.list.iter() {
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

                return Resolution {
                    path: Box::default(),
                    status: Status::UndefinedNoConditionsMatch,
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
                    };
                }

                let mut last_exception = Status::Undefined;

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
            ..Default::default()
        }
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

        if is_invalid_segment(segment) {
            return Some(segment);
        }
    }

    None
}

// Like `find_invalid_segment`, but for the wildcard match (`patternMatch`)
// extracted from the import specifier rather than for a target string from
// package.json: every segment is validated, including the first, and a
// separator-less single-segment path is allowed.
fn find_invalid_subpath_segment(path_: &[u8]) -> Option<&[u8]> {
    let mut path = path_;
    while !path.is_empty() {
        let mut segment = path;
        if let Some(new_slash) = strings::index_any_comptime(path, b"/\\") {
            segment = &path[0..new_slash];
            path = &path[new_slash + 1..];
        } else {
            path = b"";
        }

        if is_invalid_segment(segment) {
            return Some(segment);
        }
    }

    None
}

// Node's PACKAGE_TARGET_RESOLVE rejects ".", "..", and "node_modules" segments
// case-insensitively and including percent-encoded variants. Decode the segment
// before comparing so spellings like "%2e%2e" or ".%2E" cannot survive the check
// only to be decoded into ".." by `finalize`.
fn is_invalid_segment(segment: &[u8]) -> bool {
    let mut decoded = [0u8; 12];
    let mut len = 0usize;
    let mut i = 0usize;
    while i < segment.len() {
        let b = segment[i];
        let c = if b == b'%' && i + 2 < segment.len() {
            match (
                bun_core::fmt::hex_digit_value(segment[i + 1]),
                bun_core::fmt::hex_digit_value(segment[i + 2]),
            ) {
                (Some(hi), Some(lo)) => {
                    i += 3;
                    (hi << 4) | lo
                }
                _ => {
                    i += 1;
                    b
                }
            }
        } else {
            i += 1;
            b
        };
        if len == decoded.len() {
            return false;
        }
        decoded[len] = c.to_ascii_lowercase();
        len += 1;
    }
    let d = &decoded[..len];
    d == b"." || d == b".." || d == b"node_modules"
}
