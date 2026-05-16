//! This file is mostly the API schema but with all the options normalized.
//! Normalization is necessary because most fields in the API schema are optional

use bun_collections::VecExt;
use bun_collections::{ArrayHashMap, MultiArrayList, StringArrayHashMap, StringHashMap};
use bun_core::strings;
use bun_core::{Global, Output};
#[allow(unused_imports)]
use bun_dotenv as DotEnv;
use bun_js_parser::parser::Runtime;
use bun_options_types::schema::api;
#[allow(unused_imports)]
use bun_resolver as resolver;
use bun_resolver::fs as Fs;
use bun_resolver::fs::PathResolverExt as _;
use bun_resolver::package_json::{MacroMap as MacroRemap, PackageJSON};
#[allow(unused_imports)]
use bun_url::URL;
use std::borrow::Cow;
// TODO(b2-blocked): bun_analytics — Cargo.toml does not yet list the dep
// (adding it triggers upstream rebuilds with in-progress breakage). The
// `analytics::features::*` counters are pure telemetry side effects; the
// increment call-sites below are ``-gated until the dep is wired
// so the no-op is explicit (PORTING.md §Forbidden patterns: silent no-ops).

mod analytics {
    #[allow(non_upper_case_globals)]
    pub mod features {
        use core::sync::atomic::AtomicUsize;
        // Zig: `analytics.Features.{define,loaders,macros,external} += n`.
        // Real statics live in `bun_analytics::features::*` (AtomicUsize).
        pub static define: AtomicUsize = AtomicUsize::new(0);
        pub static loaders: AtomicUsize = AtomicUsize::new(0);
        pub static macros: AtomicUsize = AtomicUsize::new(0);
        pub static external: AtomicUsize = AtomicUsize::new(0);
    }
}
use enum_map::{Enum, EnumMap};

pub use crate::defines;
pub use defines::Define;
// B-3: `Define::init` / `DefineData::{from_input,parse}` are extension-trait
// methods (the canonical types live in `bun_js_parser::defines`); bring the
// traits into scope so the associated-fn call syntax below resolves.
#[allow(unused_imports)]
use crate::defines::{DefineDataExt as _, DefineExt as _};
pub use bun_options_types::global_cache::GlobalCache;

// ── B-2 type aliases for incomplete lower-tier surfaces ──
// TODO(b2-blocked): bun_resolver::package_json::ESModule::ConditionsMap — module
// path doesn't expose this yet; local alias matches Zig `StringArrayHashMap(void)`.
pub type ConditionsMap = StringArrayHashMap<()>;
// TODO(b2-blocked): bun_sys::Dir — directory handle. Mapped to Fd for now
// (matches `bun.FD.fromStdDir` pattern).
pub type Dir = bun_sys::Fd;
/// `Loader.HashTable` (Zig nested type alias). Unified with the canonical
/// `bun_ast::LoaderHashTable` so the resolver and
/// bundler share one nominal map type (PORTING.md crate-tier rule).
pub(crate) use bun_ast::LoaderHashTable;
/// `Loader.Map` (Zig nested type alias).
pub type LoaderEnumMap = EnumMap<Loader, &'static [u8]>;

/// `bun.http.MimeType` lives in `bun_http_types` (lower tier), not `bun_http`.
mod bun_http {
    pub use bun_http_types::MimeType::MimeType;
}
/// `bun.StringSet` (re-exported for `BundleOptions.bundler_feature_flags`).
pub use bun_collections::StringSet;

/// `options.zig:Framework.ClientCssInJs` — TYPE_ONLY moved to top of module so
/// `entry_points.rs` (and the inline `options` mod) can resolve it before the
/// gated `Framework` impl block below.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClientCssInJs {
    #[default]
    AutoOnImportCss,
    Facade,
    FacadeOnImportCss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteDestination {
    Stdout,
    Disk,
    // eventually: wasm
}

pub fn validate_path(
    log: &mut bun_ast::Log,
    _fs: &mut Fs::Implementation,
    cwd: &[u8],
    rel_path: &[u8],
    path_kind: &[u8],
) -> Box<[u8]> {
    if rel_path.is_empty() {
        return Box::default();
    }
    // TODO: switch to getFdPath()-based implementation
    // PORT NOTE: Zig used `std.fs.path.resolve(arena, &.{cwd, rel_path})`;
    // `join_abs_string` resolves `.`/`..` against `cwd` into a threadlocal
    // buffer which is then boxed (matches the arena.dupe in the Zig path).
    let _ = path_kind;
    let out =
        bun_paths::resolve_path::join_abs_string::<bun_paths::platform::Auto>(cwd, &[rel_path]);
    if out.is_empty() {
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!(
                "Invalid {}: {}",
                bstr::BStr::new(path_kind),
                bstr::BStr::new(rel_path),
            ),
        );
        return Box::default();
    }
    Box::from(out)
}

// PORT NOTE: options.zig `stringHashMapFromArrays` — use `bun_core::util::{MapLike, from_entries}`
// or inline the construction (see definesFromTransformOptions / loadersFromTransformOptions below).
// Note `from_entries` reserves `iter.len()`; if you need the Zig over-reserve (`keys.len + N`),
// call `MapLike::ensure_unused_capacity(total_cap)` yourself before zipping keys/values.

// `AllowUnresolved` is defined canonically in
// `bun_js_parser::options` (lower tier) because the parser is the consumer
// (`P::should_allow_unresolved_dynamic_specifier`). Re-export here so
// `BundleOptions.allow_unresolved` and `Parser.Options.allow_unresolved` are
// the SAME nominal type and `ParseTask::run_with_source_code` can hand
// `&transpiler.options.allow_unresolved` straight through.
pub use bun_js_parser::options::AllowUnresolved;

// Canonical defs live in `bun_resolver::options` (lower tier; resolver is the
// runtime consumer of `.patterns`/`.abs_paths`/`.node_modules`). Re-export so
// `BundleOptions.external` and `Resolver.opts.external` are the SAME nominal
// type and the projection in `transpiler::resolver_bundle_options_subset` is a
// plain `.clone()`.
pub use bun_resolver::options::{ExternalModules, WildcardPattern};

/// `options.zig` `ExternalModules.isNodeBuiltin`. Free fn (not an inherent
/// method) because `ExternalModules` is now a foreign type and Rust forbids
/// inherent impls across crates (E0116).
pub fn is_node_builtin(str: &[u8]) -> bool {
    bun_resolve_builtins::Alias::has(str, bun_ast::Target::Node, Default::default())
}

const DEFAULT_WILDCARD_PATTERNS: &[(&[u8], &[u8])] = &[
    (b"/bun:", b""),
    // (b"/src:", b""),
    // (b"/blob:", b""),
];

fn default_wildcard_patterns() -> Vec<WildcardPattern> {
    DEFAULT_WILDCARD_PATTERNS
        .iter()
        .map(|(p, s)| WildcardPattern {
            prefix: Box::from(*p),
            suffix: Box::from(*s),
        })
        .collect()
}

/// `options.zig` `ExternalModules.init`. Free fn for the same orphan-rule
/// reason as [`is_node_builtin`]; stays at bundler tier because it needs
/// `Fs`/`logger`/`NODE_BUILTIN_PATTERNS`.
pub fn init_external_modules(
    fs: &mut Fs::Implementation,
    cwd: &[u8],
    externals: &[&[u8]],
    log: &mut bun_ast::Log,
    target: Target,
) -> ExternalModules {
    let mut result = ExternalModules {
        node_modules: StringSet::default(),
        abs_paths: StringSet::default(),
        patterns: default_wildcard_patterns(),
    };

    match target {
        Target::Node => {
            // TODO: fix this stupid copy
            let _ = result
                .node_modules
                .map
                .ensure_total_capacity(NODE_BUILTIN_PATTERNS.len());
            for pattern in NODE_BUILTIN_PATTERNS {
                result.node_modules.insert(pattern).expect("unreachable");
            }
        }
        Target::Bun => {
            // // TODO: fix this stupid copy
            // result.node_modules.hash_map.ensureTotalCapacity(BunNodeBuiltinPatternsCompat.len) catch unreachable;
            // for (BunNodeBuiltinPatternsCompat) |pattern| {
            //     result.node_modules.insert(pattern) catch unreachable;
            // }
        }
        _ => {}
    }

    if externals.is_empty() {
        return result;
    }

    let mut patterns: Vec<WildcardPattern> = Vec::with_capacity(DEFAULT_WILDCARD_PATTERNS.len());
    // PERF(port): was appendSliceAssumeCapacity
    patterns.extend(default_wildcard_patterns());

    for external in externals {
        let path = *external;
        if let Some(i) = strings::index_of_char(path, b'*') {
            let i = i as usize;
            if strings::index_of_char(&path[i + 1..], b'*').is_some() {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "External path \"{}\" cannot have more than one \"*\" wildcard",
                        bstr::BStr::new(external)
                    ),
                );
                return result;
            }

            patterns.push(WildcardPattern {
                prefix: Box::from(&external[0..i]),
                suffix: Box::from(&external[i + 1..]),
            });
        } else if bun_paths::is_package_path(external) {
            result.node_modules.insert(external).expect("unreachable");
        } else {
            let normalized = validate_path(log, fs, cwd, external, b"external path");

            if !normalized.is_empty() {
                result.abs_paths.insert(&normalized).expect("unreachable");
            }
        }
    }

    result.patterns = patterns;

    result
}

pub use bun_resolve_builtins::node_builtins::{
    BUN_NODE_BUILTIN_PATTERNS_COMPAT, NODE_BUILTIN_PATTERNS, NODE_BUILTIN_PATTERNS_RAW,
};
// NODE_BUILTINS_MAP removed: dead — `is_node_builtin` (line 142) already delegates to
// `bun_resolve_builtins::Alias::has`; no other reader. See node_builtins.rs header.

pub use bun_options_types::BundlePackage;

// Re-export of `bun_options_types::bundle_enums::ModuleType`.
// Re-exported so `crate::options_impl::ModuleType` and `js_ast::parser::options::ModuleType`
// (which also re-exports the BundleEnums def) are the *same* nominal type — kills the
// `to_parser_module_type` shim in transpiler.rs.
pub use bun_options_types::bundle_enums::ModuleType;

// Kept for callers that reference the module-level static name; forwards to the
// canonical const map on the upstream enum.
pub static MODULE_TYPE_LIST: phf::Map<&'static [u8], ModuleType> = ModuleType::LIST;

// Re-export of `bun_ast::Target`.
// Spec options.zig:379 has exactly ONE `Target`; re-export the canonical enum so
// `BundleOptions.target`, `js_printer::Options.target`, the resolver, and css
// targets all share one nominal type (kills the `to_bundle_enums_target` shim).
pub(crate) use bun_ast::Target;

// Forwarded to the canonical assoc-const so there is exactly one phf body.
// Kept as a module-level name for callers that pre-date `Target::MAP`.
pub static TARGET_MAP: phf::Map<&'static [u8], Target> = Target::MAP;

pub const TARGET_MAIN_FIELD_NAMES: [&[u8]; 4] = [
    b"browser",
    b"module",
    b"main",
    // https://github.com/jsforum/jsforum/issues/5
    // Older packages might use jsnext:main in place of module
    b"jsnext:main",
];

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
const DEFAULT_MAIN_FIELDS_NODE: &[&[u8]] =
    &[TARGET_MAIN_FIELD_NAMES[2], TARGET_MAIN_FIELD_NAMES[1]];

// Note that this means if a package specifies "main", "module", and
// "browser" then "browser" will win out over "module". This is the
// same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
//
// This is deliberate because the presence of the "browser" field is a
// good signal that this should be preferred. Some older packages might only use CJS in their "browser"
// but in such a case they probably don't have any ESM files anyway.
const DEFAULT_MAIN_FIELDS_BROWSER: &[&[u8]] = &[
    TARGET_MAIN_FIELD_NAMES[0],
    TARGET_MAIN_FIELD_NAMES[1],
    TARGET_MAIN_FIELD_NAMES[3],
    TARGET_MAIN_FIELD_NAMES[2],
];
const DEFAULT_MAIN_FIELDS_BUN: &[&[u8]] = &[
    TARGET_MAIN_FIELD_NAMES[1],
    TARGET_MAIN_FIELD_NAMES[2],
    TARGET_MAIN_FIELD_NAMES[3],
];

/// Bundler-only `Target` methods. Extension trait per PORTING.md crate-tier
/// rule — the canonical `Target` lives in `bun_options_types` (lower tier) and
/// cannot depend on `bake_types` / `StringHashMap`. Re-exported through
/// `bun_bundler::options` so `use bun_bundler::options::TargetExt;` makes
/// `.bake_graph()` etc. available on the single canonical type.
pub trait TargetExt: Copy {
    // pub const fromJS — deleted: see PORTING.md "*_jsc alias" rule.
    // TODO(port): move to *_jsc — bun_bundler_jsc::options_jsc::target_from_js

    fn bake_graph(self) -> crate::bake_types::Graph;
    fn out_extensions(self) -> StringHashMap<&'static [u8]>;

    // Original comment:
    // The neutral target is for people that don't want esbuild to try to
    // pick good defaults for their platform. In that case, the list of main
    // fields is empty by default. You must explicitly configure it yourself.
    // array.set(Target.neutral, &listc);
    fn default_main_fields_map() -> EnumMap<Target, &'static [&'static [u8]]> {
        enum_map::enum_map! {
            Target::Node => DEFAULT_MAIN_FIELDS_NODE,
            Target::Browser => DEFAULT_MAIN_FIELDS_BROWSER,
            Target::Bun => DEFAULT_MAIN_FIELDS_BUN,
            Target::BunMacro => DEFAULT_MAIN_FIELDS_BUN,
            Target::BakeServerComponentsSsr => DEFAULT_MAIN_FIELDS_BUN,
        }
    }

    fn default_conditions_map() -> EnumMap<Target, &'static [&'static [u8]]> {
        enum_map::enum_map! {
            Target::Node => &[b"node" as &[u8]][..],
            Target::Browser => &[b"browser" as &[u8], b"module"][..],
            Target::Bun => &[b"bun" as &[u8], b"node"][..],
            Target::BakeServerComponentsSsr => &[b"bun" as &[u8], b"node"][..],
            Target::BunMacro => &[b"macro" as &[u8], b"bun", b"node"][..],
        }
    }
}

impl TargetExt for Target {
    fn bake_graph(self) -> crate::bake_types::Graph {
        // TODO(b0): bake::Graph arrives from move-in (TYPE_ONLY → bundler)
        match self {
            Target::Browser => crate::bake_types::Graph::Client,
            Target::BakeServerComponentsSsr => crate::bake_types::Graph::Ssr,
            Target::BunMacro | Target::Bun | Target::Node => crate::bake_types::Graph::Server,
        }
    }

    fn out_extensions(self) -> StringHashMap<&'static [u8]> {
        let mut exts = StringHashMap::<&'static [u8]>::default();

        const OUT_EXTENSIONS_LIST: &[&[u8]] = &[
            b".js", b".cjs", b".mts", b".cts", b".ts", b".tsx", b".jsx", b".json",
        ];

        // PERF(port): keys were `&'static` in Zig; `StringHashMap` owns keys via
        // `Box<[u8]>` so `put` copies — tiny startup cost.
        if self == Target::Node {
            exts.ensure_total_capacity(OUT_EXTENSIONS_LIST.len() * 2)
                .expect("OOM");
            for ext in OUT_EXTENSIONS_LIST {
                exts.put(ext, b".mjs").expect("OOM");
            }
        } else {
            exts.ensure_total_capacity(OUT_EXTENSIONS_LIST.len() + 1)
                .expect("OOM");
            exts.put(b".mjs", b".js").expect("OOM");
        }

        for ext in OUT_EXTENSIONS_LIST {
            exts.put(ext, b".js").expect("OOM");
        }

        exts
    }
}

pub use bun_options_types::Format;
pub use bun_options_types::WindowsOptions;

// Re-export of `bun_ast::Loader`.
// Spec options.zig:568 has exactly ONE `Loader`; re-export so the bundler's
// `BundleOptions.loaders` and the resolver's `Path::loader()` operate on the
// same nominal type.
pub(crate) use bun_ast::{Loader, LoaderOptional};

pub use bun_options_types::LOADER_API_NAMES;

/// Bundler-only `Loader` methods. Extension trait per PORTING.md crate-tier
/// rule — the canonical `Loader` lives in `bun_options_types` (lower tier) and
/// cannot depend on `bun_http_types::MimeType`. Re-exported through
/// `bun_bundler::options` so `use bun_bundler::options::LoaderExt;` makes
/// `.to_mime_type()` etc. available on the single canonical type.
pub trait LoaderExt: Copy {
    fn to_mime_type(self, paths: &[&[u8]]) -> bun_http_types::MimeType::MimeType;
    fn from_mime_type(mime_type: bun_http::MimeType) -> Loader;

    // PORT NOTE: `pub type Map` hoisted to module-level `LoaderEnumMap`.

    fn stdin_name_map() -> LoaderEnumMap {
        let mut map: LoaderEnumMap = EnumMap::from_array([b"" as &[u8]; 21]);
        // TODO(port): EnumMap::from_array length must match variant count; verify in Phase B
        map[Loader::Jsx] = b"input.jsx";
        map[Loader::Js] = b"input.js";
        map[Loader::Ts] = b"input.ts";
        map[Loader::Tsx] = b"input.tsx";
        map[Loader::Css] = b"input.css";
        map[Loader::File] = b"input";
        map[Loader::Json] = b"input.json";
        map[Loader::Toml] = b"input.toml";
        map[Loader::Yaml] = b"input.yaml";
        map[Loader::Json5] = b"input.json5";
        map[Loader::Wasm] = b"input.wasm";
        map[Loader::Napi] = b"input.node";
        map[Loader::Text] = b"input.txt";
        map[Loader::Bunsh] = b"input.sh";
        map[Loader::Html] = b"input.html";
        map[Loader::Md] = b"input.md";
        map
    }

    // pub const fromJS — deleted: see PORTING.md "*_jsc alias" rule.
    // TODO(port): move to *_jsc — bun_bundler_jsc::options_jsc::loader_from_js

    // PORT NOTE: `is_type_script` / `is_java_script_like*` spelling-aliases
    // moved to inherent `impl Loader` in `bun_options_types::bundle_enums` so
    // cross-crate callers (bun_jsc / bun_runtime) resolve them without a trait
    // import.

    // TODO(port): `obj: anytype` — Zig duck-typed `.get(ext) -> Option<Loader>`.
    // Monomorphized to the only concrete map type callers pass (`LoaderHashTable`);
    // a `MapLike` trait is overkill for one call site.
    fn for_file_name(filename: &[u8], obj: &LoaderHashTable) -> Option<Loader> {
        let ext = bun_paths::extension(filename);
        if ext.is_empty() || (ext.len() == 1 && ext[0] == b'.') {
            return None;
        }

        obj.get(ext).copied()
    }
}

impl LoaderExt for Loader {
    fn to_mime_type(self, paths: &[&[u8]]) -> bun_http_types::MimeType::MimeType {
        use bun_http_types::MimeType;
        match self {
            Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx => MimeType::JAVASCRIPT,
            Loader::Css => MimeType::CSS,
            Loader::Toml | Loader::Yaml | Loader::Json | Loader::Jsonc | Loader::Json5 => {
                MimeType::JSON
            }
            Loader::Wasm => MimeType::WASM,
            Loader::Html | Loader::Md => MimeType::HTML,
            _ => {
                for path in paths {
                    let mut extname = bun_paths::extension(path);
                    if strings::starts_with_char(extname, b'.') {
                        extname = &extname[1..];
                    }
                    if !extname.is_empty() {
                        if let Some(mime) = MimeType::by_extension_no_default(extname) {
                            return mime;
                        }
                    }
                }

                MimeType::OTHER
            }
        }
    }

    fn from_mime_type(mime_type: bun_http::MimeType) -> Loader {
        if mime_type.value.starts_with(b"application/javascript-jsx") {
            Loader::Jsx
        } else if mime_type.value.starts_with(b"application/typescript-jsx") {
            Loader::Tsx
        } else if mime_type.value.starts_with(b"application/javascript") {
            Loader::Js
        } else if mime_type.value.starts_with(b"application/typescript") {
            Loader::Ts
        } else if mime_type.value.starts_with(b"application/json5") {
            Loader::Json5
        } else if mime_type.value.starts_with(b"application/jsonc") {
            Loader::Jsonc
        } else if mime_type.value.starts_with(b"application/json") {
            Loader::Json
        } else if mime_type.category == bun_http_types::MimeType::Category::Text {
            Loader::Text
        } else {
            // Be maximally permissive.
            Loader::Tsx
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK: jsc::VirtualMachine / jsc::WebCore::Blob are T6 GENUINE deps.
// `normalize_specifier` and `get_loader_and_virtual_source` reach into VM
// internals (origin, module_loader, ObjectURLRegistry) and are only called
// from the runtime side. They take an opaque vtable now; runtime supplies the
// static VmLoaderVTable instance (move-in pass).
// ──────────────────────────────────────────────────────────────────────────

/// Opaque erased blob handle. SAFETY: erased jsc::WebCore::Blob; bundler only
/// stores/drops via vtable, never dereferences.
pub type OpaqueBlob = *mut ();

pub use crate::{VmLoaderCtx, VmLoaderCtxKind};

pub fn normalize_specifier<'a>(
    jsc_vm: &VmLoaderCtx,
    slice_: &'a [u8],
) -> (&'a [u8], &'a [u8], &'a [u8]) {
    let mut slice = slice_;
    if slice.is_empty() {
        return (slice, slice, b"");
    }

    let host = jsc_vm.origin_host();
    let opath = jsc_vm.origin_path();
    if slice.starts_with(host) {
        slice = &slice[host.len()..];
    }

    if opath.len() > 1 {
        if slice.starts_with(opath) {
            slice = &slice[opath.len()..];
        }
    }

    let specifier = slice;
    let mut query: &[u8] = b"";

    if let Some(i) = strings::index_of_char(slice, b'?') {
        let i = i as usize;
        query = &slice[i..];
        slice = &slice[..i];
    }

    (slice, specifier, query)
}

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum GetLoaderAndVirtualSourceErr {
    #[error("BlobNotFound")]
    BlobNotFound,
}

pub struct LoaderResult<'a> {
    pub loader: Option<Loader>,
    pub virtual_source: Option<&'a bun_ast::Source>,
    pub path: Fs::Path<'a>,
    pub is_main: bool,
    pub specifier: &'a [u8],
    /// NOTE: This is always `null` for non-js-like loaders since it's not
    /// needed for them.
    pub package_json: Option<&'a PackageJSON>,
}

// TODO(b2-blocked): bun_paths::path_literal! + Fs::Path::loader + strings::eql_long
// arity — body touches VmLoaderCtx vtable which is real but the helper APIs are not.
pub fn get_loader_and_virtual_source<'a>(
    specifier_str: &'a [u8],
    jsc_vm: &'a VmLoaderCtx,
    virtual_source_to_use: &'a mut Option<bun_ast::Source>,
    blob_to_deinit: &mut Option<OpaqueBlob>,
    type_attribute_str: Option<&[u8]>,
) -> Result<LoaderResult<'a>, GetLoaderAndVirtualSourceErr> {
    let (normalized_file_path_from_specifier, specifier, query) =
        normalize_specifier(jsc_vm, specifier_str);
    let mut path = Fs::Path::init(normalized_file_path_from_specifier);

    // SAFETY: loaders() returns a borrow tied to jsc_vm.owner
    let mut loader: Option<Loader> = path.loader(unsafe { &*jsc_vm.loaders() });
    let mut virtual_source: Option<&'a bun_ast::Source> = None;

    if let Some(eval_source) = jsc_vm.eval_source() {
        // SAFETY: eval_source outlives jsc_vm
        let eval_source: &'a bun_ast::Source = unsafe { &*eval_source };
        // Spec: `bun.pathLiteral("/[eval]")` — the eval/stdin entry path is built
        // via `bun.pathLiteral` (cli.zig / run_command.zig / bun.js.zig), which
        // rewrites `/` → `\` on Windows, so the suffix uses the platform separator.
        const EVAL_SUFFIX: &[u8] = if cfg!(windows) {
            b"\\[eval]"
        } else {
            b"/[eval]"
        };
        const STDIN_SUFFIX: &[u8] = if cfg!(windows) {
            b"\\[stdin]"
        } else {
            b"/[stdin]"
        };
        if strings::ends_with(specifier, EVAL_SUFFIX) {
            virtual_source = Some(eval_source);
            loader = Some(Loader::Tsx);
        }
        if strings::ends_with(specifier, STDIN_SUFFIX) {
            virtual_source = Some(eval_source);
            loader = Some(Loader::Tsx);
        }
    }

    if jsc_vm.is_blob_url(specifier) {
        if let Some(blob) = jsc_vm.resolve_blob(&specifier[b"blob:".len()..]) {
            *blob_to_deinit = Some(blob);
            loader = jsc_vm.blob_loader(blob);

            // "file:" loader makes no sense for blobs
            // so let's default to tsx.
            if let Some(filename) = jsc_vm.blob_file_name(blob) {
                let current_path = Fs::Path::init(filename);

                // Only treat it as a file if is a Bun.file()
                if jsc_vm.blob_needs_read_file(blob) {
                    path = current_path;
                }
            }

            if !jsc_vm.blob_needs_read_file(blob) {
                // SAFETY: `path.text` aliases jsc_vm-owned storage (blob filename
                // or normalized specifier), which outlives the `virtual_source`
                // returned to the caller — matches Zig `getLoaderAndVirtualSource`
                // where `Fs.Path` and `logger.Source.path` share one type.
                let static_text: &'static [u8] = bun_ast::StoreStr::new(path.text).slice();
                *virtual_source_to_use = Some(bun_ast::Source {
                    path: bun_paths::fs::Path::init(static_text),
                    contents: Cow::Borrowed(jsc_vm.blob_shared_view(blob)),
                    ..Default::default()
                });
                virtual_source = virtual_source_to_use.as_ref();
            }
        } else {
            return Err(GetLoaderAndVirtualSourceErr::BlobNotFound);
        }
    }

    if query == b"?raw" {
        loader = Some(Loader::Text);
    }
    if let Some(attr_str) = type_attribute_str {
        if let Some(attr_loader) = Loader::from_string(attr_str) {
            loader = Some(attr_loader);
        }
    }

    let is_main = strings::eql_long(specifier, jsc_vm.main(), true);

    let dir = path.name.dir.as_ref();
    // NOTE: we cannot trust `path.isFile()` since it's not always correct
    // NOTE: assume we may need a package.json when no loader is specified
    let is_js_like = loader.map(|l| l.is_js_like()).unwrap_or(true);
    let package_json: Option<&PackageJSON> = if is_js_like && bun_paths::is_absolute(dir) {
        jsc_vm
            .read_dir_info_package_json(dir)
            .map(|p| unsafe { &*p })
    } else {
        None
    };

    Ok(LoaderResult {
        loader,
        virtual_source,
        path,
        is_main,
        specifier,
        package_json,
    })
}

const DEFAULT_LOADERS_POSIX: &[(&[u8], Loader)] = &[
    (b".jsx", Loader::Jsx),
    (b".json", Loader::Json),
    (b".js", Loader::Jsx),
    (b".mjs", Loader::Js),
    (b".cjs", Loader::Js),
    (b".css", Loader::Css),
    (b".ts", Loader::Ts),
    (b".tsx", Loader::Tsx),
    (b".mts", Loader::Ts),
    (b".cts", Loader::Ts),
    (b".toml", Loader::Toml),
    (b".yaml", Loader::Yaml),
    (b".yml", Loader::Yaml),
    (b".wasm", Loader::Wasm),
    (b".node", Loader::Napi),
    (b".txt", Loader::Text),
    (b".text", Loader::Text),
    (b".html", Loader::Html),
    (b".jsonc", Loader::Jsonc),
    (b".json5", Loader::Json5),
    (b".md", Loader::Md),
    (b".markdown", Loader::Md),
];

#[cfg(windows)]
const DEFAULT_LOADERS_WIN32_EXTRA: &[(&[u8], Loader)] = &[(b".sh", Loader::Bunsh)];

/// File-extension → default [`Loader`] map (options.zig `defaultLoaders`).
///
/// PERF(port): was `phf::Map<&[u8], Loader>`. phf hashes the full key (SipHash
/// over up to 9 bytes) + probes a displacement table + does a final memcmp on
/// every lookup. With only 22 keys bucketing into 5 distinct lengths
/// (3/4/5/6/9, all `.`-prefixed), a length-gated `match` is cheaper: one
/// `usize` compare rejects every wrong-length probe, and within each bucket
/// rustc lowers the fixed-width byte-slice arms to single u32/u64 compares (no
/// memcmp loop). This sits on the resolver hot path (`loaderFromPath` per
/// import) and on CLI startup (`arguments::parse`, `run_command`). Same
/// pattern as `clap::find_param` (12577e958d71). Unit struct keeps the
/// `DEFAULT_LOADERS.get(ext)` / `.contains_key(ext)` call-site shape so
/// callers in `run_command.rs` / `NodeModuleModule.rs` / `arguments.rs` /
/// `init_command.rs` / `multi_run.rs` are untouched.
pub struct DefaultLoaders;

pub static DEFAULT_LOADERS: DefaultLoaders = DefaultLoaders;

impl DefaultLoaders {
    #[inline]
    pub fn get(&self, ext: &[u8]) -> Option<&'static Loader> {
        // Length-gate first: almost every miss falls out on the single `usize`
        // compare. Within each arm, keys are fixed-width so `==` is a single
        // word compare (no memcmp loop).
        match ext.len() {
            3 => match ext {
                b".js" => Some(&Loader::Jsx),
                b".ts" => Some(&Loader::Ts),
                b".md" => Some(&Loader::Md),
                #[cfg(windows)]
                b".sh" => Some(&Loader::Bunsh),
                _ => None,
            },
            4 => match ext {
                b".jsx" => Some(&Loader::Jsx),
                b".tsx" => Some(&Loader::Tsx),
                b".mjs" => Some(&Loader::Js),
                b".cjs" => Some(&Loader::Js),
                b".mts" => Some(&Loader::Ts),
                b".cts" => Some(&Loader::Ts),
                b".css" => Some(&Loader::Css),
                b".yml" => Some(&Loader::Yaml),
                b".txt" => Some(&Loader::Text),
                _ => None,
            },
            5 => match ext {
                b".json" => Some(&Loader::Json),
                b".toml" => Some(&Loader::Toml),
                b".yaml" => Some(&Loader::Yaml),
                b".wasm" => Some(&Loader::Wasm),
                b".node" => Some(&Loader::Napi),
                b".text" => Some(&Loader::Text),
                b".html" => Some(&Loader::Html),
                _ => None,
            },
            6 => match ext {
                b".jsonc" => Some(&Loader::Jsonc),
                b".json5" => Some(&Loader::Json5),
                _ => None,
            },
            9 if ext == b".markdown" => Some(&Loader::Md),
            _ => None,
        }
    }

    #[inline]
    pub fn contains_key(&self, ext: &[u8]) -> bool {
        self.get(ext).is_some()
    }
}

#[cfg(test)]
#[test]
fn default_loaders_match_table() {
    // Guard against drift between the length-gated match and the canonical
    // tuple list above (Zig source of truth).
    for (ext, loader) in DEFAULT_LOADERS_POSIX {
        assert_eq!(DEFAULT_LOADERS.get(ext), Some(loader), "ext {:?}", ext);
    }
    #[cfg(windows)]
    for (ext, loader) in DEFAULT_LOADERS_WIN32_EXTRA {
        assert_eq!(DEFAULT_LOADERS.get(ext), Some(loader), "ext {:?}", ext);
    }
    // Spot-check misses across each length bucket.
    for ext in [
        b"".as_slice(),
        b".",
        b".rs",
        b".zig",
        b".json6",
        b".markdow",
        b".markdownn",
    ] {
        assert_eq!(DEFAULT_LOADERS.get(ext), None, "ext {:?}", ext);
    }
    #[cfg(not(windows))]
    assert_eq!(DEFAULT_LOADERS.get(b".sh"), None);
}

// https://webpack.js.org/guides/package-exports/#reference-syntax
pub struct ESMConditions {
    pub default: ConditionsMap,
    pub import: ConditionsMap,
    pub require: ConditionsMap,
    pub style: ConditionsMap,
}

impl ESMConditions {
    pub fn init(
        defaults: &[&[u8]],
        allow_addons: bool,
        conditions: &[&[u8]],
    ) -> Result<ESMConditions, bun_alloc::AllocError> {
        let mut default_condition_amp = ConditionsMap::default();

        let mut import_condition_map = ConditionsMap::default();
        let mut require_condition_map = ConditionsMap::default();
        let mut style_condition_map = ConditionsMap::default();

        let addon_extra = if allow_addons { 1 } else { 0 };
        default_condition_amp.reserve(defaults.len() + 2 + addon_extra + conditions.len());
        import_condition_map.reserve(defaults.len() + 2 + addon_extra + conditions.len());
        require_condition_map.reserve(defaults.len() + 2 + addon_extra + conditions.len());
        style_condition_map.reserve(defaults.len() + 2 + conditions.len());

        // PERF(port): was assume_capacity
        import_condition_map.insert(b"import".as_slice().into(), ());
        require_condition_map.insert(b"require".as_slice().into(), ());
        style_condition_map.insert(b"style".as_slice().into(), ());

        for condition in conditions {
            import_condition_map.insert((*condition).into(), ());
            require_condition_map.insert((*condition).into(), ());
            default_condition_amp.insert((*condition).into(), ());
        }

        for default in defaults {
            default_condition_amp.insert((*default).into(), ());
            import_condition_map.insert((*default).into(), ());
            require_condition_map.insert((*default).into(), ());
            style_condition_map.insert((*default).into(), ());
        }

        if allow_addons {
            default_condition_amp.insert(b"node-addons".as_slice().into(), ());
            import_condition_map.insert(b"node-addons".as_slice().into(), ());
            require_condition_map.insert(b"node-addons".as_slice().into(), ());

            // style is not here because you don't import N-API addons inside css files.
        }

        default_condition_amp.insert(b"default".as_slice().into(), ());
        import_condition_map.insert(b"default".as_slice().into(), ());
        require_condition_map.insert(b"default".as_slice().into(), ());
        style_condition_map.insert(b"default".as_slice().into(), ());

        Ok(ESMConditions {
            default: default_condition_amp,
            import: import_condition_map,
            require: require_condition_map,
            style: style_condition_map,
        })
    }

    pub fn clone(&self) -> Result<ESMConditions, bun_core::Error> {
        // TODO(port): narrow error set
        let default = self.default.clone()?;
        let import = self.import.clone()?;
        let require = self.require.clone()?;
        let style = self.style.clone()?;

        Ok(ESMConditions {
            default,
            import,
            require,
            style,
        })
    }

    pub fn append_slice(&mut self, conditions: &[&[u8]]) -> Result<(), bun_alloc::AllocError> {
        self.default.reserve(conditions.len());
        self.import.reserve(conditions.len());
        self.require.reserve(conditions.len());
        self.style.reserve(conditions.len());

        for condition in conditions {
            // PERF(port): was assume_capacity
            self.default.insert((*condition).into(), ());
            self.import.insert((*condition).into(), ());
            self.require.insert((*condition).into(), ());
            self.style.insert((*condition).into(), ());
        }
        Ok(())
    }

    pub fn append(&mut self, condition: &[u8]) -> Result<(), bun_alloc::AllocError> {
        self.default.insert(condition.into(), ());
        self.import.insert(condition.into(), ());
        self.require.insert(condition.into(), ());
        self.style.insert(condition.into(), ());
        Ok(())
    }
}

// D042: canonical `jsx::{Runtime, ImportSource, Pragma, RuntimeDevelopmentPair,
// RUNTIME_MAP, defaults, Defaults, pragma}` lives in `bun_options_types::jsx`.
// Re-exported so existing `crate::options::jsx::*` / `options_impl::jsx::*`
// paths resolve unchanged. The three field-wise `From<>` bridges to the
// resolver-/parser-side nominal copies are gone — all three crates now share
// the single `bun_options_types::jsx::Pragma` type.
pub use bun_options_types::jsx;
pub use jsx as JSX;

pub mod default_user_defines {
    // This must be globally scoped so it doesn't disappear
    pub mod node_env {
        pub const KEY: &[u8] = b"process.env.NODE_ENV";
        pub const VALUE: &[u8] = b"\"development\"";
    }
    pub mod process_browser_define {
        pub const KEY: &[u8] = b"process.browser";
        pub const VALUE: [&[u8]; 2] = [b"false", b"true"];
    }
}

pub use default_user_defines as DefaultUserDefines;

pub fn defines_from_transform_options(
    log: &mut bun_ast::Log,
    // PERF(port): borrowed, not owned — the caller (`load_defines`) holds
    // `transform_options` behind an `Arc`, so taking the `StringMap` by value
    // forced a full deep clone of the `--define` map *every* VM init even though
    // each value gets cloned again below on insert. Reading it through `&` keeps
    // the per-value clone (the owned `RawDefines` map needs `Box<[u8]>`s) but
    // drops the redundant outer `keys.clone() + values.clone()`.
    maybe_input_define: Option<&api::StringMap>,
    target: Target,
    env_loader: Option<&mut DotEnv::Loader>,
    framework_env: Option<&Env>,
    node_env: Option<&[u8]>,
    drop: &[&[u8]],
    omit_unused_global_calls: bool,
    bump: &bun_alloc::Arena,
) -> Result<Box<defines::Define>, bun_core::Error> {
    let (input_keys, input_values): (&[Box<[u8]>], &[Box<[u8]>]) = match maybe_input_define {
        Some(m) => (&m.keys, &m.values),
        None => (&[], &[]),
    };

    // PORT NOTE: Zig stringHashMapFromArrays — inlined as concrete RawDefines build (over-reserves +4).
    let mut user_defines: defines::RawDefines = defines::RawDefines::default();
    user_defines.reserve(input_keys.len() + 4);
    for (i, key) in input_keys.iter().enumerate() {
        // PERF(port): was assume_capacity
        user_defines.insert(key.as_ref(), input_values[i].clone());
    }

    let mut environment_defines = defines::UserDefinesArray::default();

    let mut behavior = api::DotEnvBehavior::disable;

    'load_env: {
        let Some(env) = env_loader else {
            break 'load_env;
        };
        let Some(framework) = framework_env else {
            break 'load_env;
        };

        if cfg!(debug_assertions) {
            debug_assert!(framework.behavior != api::DotEnvBehavior::None);
        }

        behavior = framework.behavior;
        if behavior == api::DotEnvBehavior::LoadAllWithoutInlining
            || behavior == api::DotEnvBehavior::disable
        {
            break 'load_env;
        }

        // PORT NOTE: flatten `api::StringMap` into parallel borrowed slices.
        // `api::DotEnvBehavior` is the same type as `DotEnv::DotEnvBehavior`
        // (re-export), so no conversion needed.
        let api_defaults = framework.to_api().defaults;
        let default_keys: Vec<&[u8]> = api_defaults.keys.iter().map(|k| k.as_ref()).collect();
        let default_values: Vec<&[u8]> = api_defaults.values.iter().map(|v| v.as_ref()).collect();
        defines::copy_env_for_define(
            env,
            &mut user_defines,
            &mut environment_defines,
            &default_keys,
            &default_values,
            behavior,
            &framework.prefix,
        )?;
    }

    if behavior != api::DotEnvBehavior::LoadAllWithoutInlining {
        let quoted_node_env: Box<[u8]> = 'brk: {
            if let Some(node_env) = node_env {
                if !node_env.is_empty() {
                    if (strings::starts_with_char(node_env, b'"')
                        && strings::ends_with_char(node_env, b'"'))
                        || (strings::starts_with_char(node_env, b'\'')
                            && strings::ends_with_char(node_env, b'\''))
                    {
                        break 'brk Box::from(node_env);
                    }

                    // avoid allocating if we can
                    if node_env == b"production" {
                        break 'brk Box::from(b"\"production\"".as_slice());
                    } else if node_env == b"development" {
                        break 'brk Box::from(b"\"development\"".as_slice());
                    } else if node_env == b"test" {
                        break 'brk Box::from(b"\"test\"".as_slice());
                    } else {
                        let mut v = Vec::with_capacity(node_env.len() + 2);
                        v.push(b'"');
                        v.extend_from_slice(node_env);
                        v.push(b'"');
                        break 'brk v.into_boxed_slice();
                    }
                }
            }
            Box::from(b"\"development\"".as_slice())
        };

        user_defines.get_or_put_value(b"process.env.NODE_ENV", quoted_node_env.clone())?;
        user_defines.get_or_put_value(b"process.env.BUN_ENV", quoted_node_env)?;

        // Automatically set `process.browser` to `true` for browsers and false for node+js
        // This enables some extra dead code elimination
        if let Some(value) = target.process_browser_define_value() {
            user_defines.get_or_put_value(
                default_user_defines::process_browser_define::KEY,
                Box::from(value.as_bytes()),
            )?;
        }
    }

    if target.is_bun() {
        if !user_defines.contains(b"window") {
            environment_defines.get_or_put_value(
                b"window",
                defines::DefineData::init(defines::DefineDataInit {
                    valueless: true,
                    original_name: Some(b"window".as_slice()),
                    value: defines::DefineValue::EUndefined(Default::default()),
                    ..Default::default()
                }),
            )?;
        }
    }

    let resolved_defines = defines::DefineData::from_input(&user_defines, drop, log, bump)?;

    let drop_debugger = drop.iter().any(|item| *item == b"debugger");

    Ok(defines::Define::init(
        Some(resolved_defines),
        Some(environment_defines),
        drop_debugger,
        omit_unused_global_calls,
    )?)
}

const DEFAULT_LOADER_EXT_BUN: &[&[u8]] = &[b".node", b".html"];
const DEFAULT_LOADER_EXT: &[&[u8]] = &[
    b".jsx", b".json", b".js", b".mjs", b".cjs", b".css",
    // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/#new-file-extensions
    b".ts", b".tsx", b".mts", b".cts", b".toml", b".yaml", b".yml", b".wasm", b".txt", b".text",
    b".jsonc", b".json5",
];

// Only set it for browsers by default.
const DEFAULT_LOADER_EXT_BROWSER: &[&[u8]] = &[b".html"];

const NODE_MODULES_DEFAULT_LOADER_EXT: &[&[u8]] = &[
    b".jsx", b".js", b".cjs", b".mjs", b".ts", b".mts", b".toml", b".yaml", b".yml", b".txt",
    b".json", b".jsonc", b".json5", b".css", b".tsx", b".cts", b".wasm", b".text", b".html",
];

#[derive(Debug, Clone)]
pub struct ResolveFileExtensions {
    pub node_modules: ResolveFileExtensionsGroup,
    pub default: ResolveFileExtensionsGroup,
}

impl Default for ResolveFileExtensions {
    fn default() -> Self {
        ResolveFileExtensions {
            node_modules: ResolveFileExtensionsGroup {
                esm: owned_string_list(
                    bundle_options_defaults::node_modules::MODULE_EXTENSION_ORDER,
                ),
                default: owned_string_list(bundle_options_defaults::node_modules::EXTENSION_ORDER),
            },
            default: ResolveFileExtensionsGroup::default(),
        }
    }
}

impl ResolveFileExtensions {
    #[inline]
    fn group(&self, is_node_modules: bool) -> &ResolveFileExtensionsGroup {
        if is_node_modules {
            &self.node_modules
        } else {
            &self.default
        }
    }

    pub fn kind(&self, kind_: bun_ast::ImportKind, is_node_modules: bool) -> &[Box<[u8]>] {
        use bun_ast::ImportKind;
        match kind_ {
            ImportKind::Stmt
            | ImportKind::EntryPointBuild
            | ImportKind::EntryPointRun
            | ImportKind::Dynamic => &self.group(is_node_modules).esm,
            _ => &self.group(is_node_modules).default,
        }
    }
}

/// Convert a static `&[&[u8]]` default into an owned `Box<[Box<[u8]>]>`.
/// PERF(port): the Zig kept these as borrowed `[]const string`; we own them so
/// user-provided lists (e.g. `transform.extension_order`) can be stored without
/// `Box::leak` (PORTING.md §Forbidden patterns).
#[inline]
pub(crate) fn owned_string_list(s: &[&[u8]]) -> Box<[Box<[u8]>]> {
    s.iter().map(|b| Box::<[u8]>::from(*b)).collect()
}

#[derive(Debug, Clone)]
pub struct ResolveFileExtensionsGroup {
    pub esm: Box<[Box<[u8]>]>,
    pub default: Box<[Box<[u8]>]>,
}

impl Default for ResolveFileExtensionsGroup {
    fn default() -> Self {
        ResolveFileExtensionsGroup {
            esm: owned_string_list(bundle_options_defaults::MODULE_EXTENSION_ORDER),
            default: owned_string_list(bundle_options_defaults::EXTENSION_ORDER),
        }
    }
}

pub fn loaders_from_transform_options(
    loaders: Option<&api::LoaderMap>,
    target: Target,
) -> Result<StringArrayHashMap<Loader>, bun_alloc::AllocError> {
    // Borrow the caller's `LoaderMap` (a `Vec<u8>` + `Vec<Box<[u8]>>`); this fn
    // only reads from it, so there's no need to clone it on every call.
    let empty = api::LoaderMap::default();
    let input_loaders = loaders.unwrap_or(&empty);
    let mut loader_values: Vec<Loader> = Vec::with_capacity(input_loaders.loaders.len());

    for input in &input_loaders.loaders {
        loader_values.push(<Loader as bun_options_types::LoaderExt>::from_api(*input));
    }

    let total_capacity = input_loaders.extensions.len()
        + if target.is_bun() {
            DEFAULT_LOADER_EXT_BUN.len()
        } else {
            0
        }
        + if target == Target::Browser {
            DEFAULT_LOADER_EXT_BROWSER.len()
        } else {
            0
        }
        + DEFAULT_LOADER_EXT.len();

    let mut loaders = StringArrayHashMap::<Loader>::default();
    loaders.reserve(u32::try_from(total_capacity).expect("int cast") as usize);
    for (i, ext) in input_loaders.extensions.iter().enumerate() {
        // PERF(port): was assume_capacity
        loaders.insert(ext, loader_values[i]);
    }

    // PORT NOTE: Zig `getOrPutValue` → contains+insert; `Loader` is not `Default`
    // so the `V: Default`-gated `StringArrayHashMap::get_or_put_value` does not
    // apply. Semantics are identical (insert only when absent).
    for ext in DEFAULT_LOADER_EXT {
        if !loaders.contains(*ext) {
            loaders.insert(*ext, *DEFAULT_LOADERS.get(*ext).unwrap());
        }
    }

    if target.is_bun() {
        for ext in DEFAULT_LOADER_EXT_BUN {
            if !loaders.contains(*ext) {
                loaders.insert(*ext, *DEFAULT_LOADERS.get(*ext).unwrap());
            }
        }
    }

    if target == Target::Browser {
        for ext in DEFAULT_LOADER_EXT_BROWSER {
            if !loaders.contains(*ext) {
                loaders.insert(*ext, *DEFAULT_LOADERS.get(*ext).unwrap());
            }
        }
    }

    Ok(loaders)
}

// PORT NOTE: `Dir` alias hoisted to top of file (= bun_sys::Fd).

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SourceMapOption {
    #[default]
    None,
    Inline,
    External,
    Linked,
}

impl SourceMapOption {
    pub fn from_api(source_map: Option<api::SourceMapMode>) -> SourceMapOption {
        match source_map.unwrap_or(api::SourceMapMode::None) {
            api::SourceMapMode::External => SourceMapOption::External,
            api::SourceMapMode::Inline => SourceMapOption::Inline,
            api::SourceMapMode::Linked => SourceMapOption::Linked,
            _ => SourceMapOption::None,
        }
    }

    pub fn to_api(source_map: Option<SourceMapOption>) -> api::SourceMapMode {
        match source_map.unwrap_or(SourceMapOption::None) {
            SourceMapOption::External => api::SourceMapMode::External,
            SourceMapOption::Inline => api::SourceMapMode::Inline,
            SourceMapOption::Linked => api::SourceMapMode::Linked,
            SourceMapOption::None => api::SourceMapMode::None,
        }
    }

    pub fn has_external_files(self) -> bool {
        matches!(self, SourceMapOption::Linked | SourceMapOption::External)
    }
}

// PORT NOTE: hoisted from `impl SourceMapOption` — Rust forbids `static` in inherent impls.
pub static SOURCE_MAP_OPTION_MAP: phf::Map<&'static [u8], SourceMapOption> = phf::phf_map! {
    b"none" => SourceMapOption::None,
    b"inline" => SourceMapOption::Inline,
    b"external" => SourceMapOption::External,
    b"linked" => SourceMapOption::Linked,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackagesOption {
    Bundle,
    External,
}

impl PackagesOption {
    pub fn from_api(packages: Option<api::PackagesMode>) -> PackagesOption {
        match packages.unwrap_or(api::PackagesMode::Bundle) {
            api::PackagesMode::External => PackagesOption::External,
            api::PackagesMode::Bundle => PackagesOption::Bundle,
        }
    }

    pub fn to_api(packages: Option<PackagesOption>) -> api::PackagesMode {
        match packages.unwrap_or(PackagesOption::Bundle) {
            PackagesOption::External => api::PackagesMode::External,
            PackagesOption::Bundle => api::PackagesMode::Bundle,
        }
    }
}

// PORT NOTE: hoisted from `impl PackagesOption` — Rust forbids `static` in inherent impls.
pub static PACKAGES_OPTION_MAP: phf::Map<&'static [u8], PackagesOption> = phf::phf_map! {
    b"external" => PackagesOption::External,
    b"bundle" => PackagesOption::Bundle,
};

/// BundleOptions is used when ResolveMode is not set to "disable".
/// BundleOptions is effectively webpack + babel
pub struct BundleOptions<'a> {
    pub footer: Cow<'static, [u8]>,
    pub banner: Cow<'static, [u8]>,
    pub define: Box<defines::Define>,
    pub drop: Box<[Box<[u8]>]>,
    /// Set of enabled feature flags for dead-code elimination via `import { feature } from "bun:bundle"`.
    /// Initialized once from the CLI --feature flags.
    ///
    /// Zig: `*const bun.StringSet = &Runtime.Features.empty_bundler_feature_flags`.
    /// `None` ≡ the static empty set; `Some` is the owned `Box` returned by
    /// `Runtime::Features::init_bundler_feature_flags` (freed on Drop, matching
    /// options.zig:1888-1892 which frees iff distinct from the static empty set).
    pub bundler_feature_flags: Option<Box<StringSet>>,
    pub loaders: LoaderHashTable,
    pub resolve_dir: Cow<'static, [u8]>,
    pub jsx: jsx::Pragma,
    pub emit_decorator_metadata: bool,
    pub experimental_decorators: bool,
    pub auto_import_jsx: bool,
    pub allow_runtime: bool,

    pub trim_unused_imports: Option<bool>,
    pub mark_builtins_as_external: bool,
    pub server_components: bool,
    pub hot_module_reloading: bool,
    pub react_fast_refresh: bool,
    pub inject: Option<Box<[Box<[u8]>]>>,
    // TODO(port): lifetime — `bun_url::URL<'a>` borrows its input string. Zig
    // stored it borrowing `transform_options.origin` (sibling field). Using the
    // owned variant so the struct is self-contained.
    pub origin: bun_url::OwnedURL,
    pub output_dir_handle: Option<Dir>,

    pub output_dir: Box<[u8]>,
    pub root_dir: Box<[u8]>,
    pub node_modules_bundle_url: Cow<'static, [u8]>,
    pub node_modules_bundle_pretty_path: Cow<'static, [u8]>,

    pub write: bool,
    pub preserve_symlinks: bool,
    pub preserve_extensions: bool,
    pub production: bool,

    // only used by bundle_v2
    pub output_format: Format,

    pub append_package_version_in_query_string: bool,

    pub tsconfig_override: Option<Box<[u8]>>,
    pub target: Target,
    pub main_fields: Box<[Box<[u8]>]>,
    /// TODO: remove this in favor accessing bundler.log
    /// PORT NOTE: raw `*mut` (not `&'a mut`) — Zig aliases the same `*Log`
    /// into `Transpiler.log` / `Resolver.log` / `Linker.log`. A stored
    /// `&'a mut` here would assert uniqueness for `'a` and make every access
    /// through those sibling raw pointers UB under stacked borrows.
    pub log: *mut bun_ast::Log,
    pub external: ExternalModules,
    pub allow_unresolved: AllowUnresolved,
    pub entry_points: Box<[Box<[u8]>]>,
    pub entry_naming: Box<[u8]>,
    pub asset_naming: Box<[u8]>,
    pub chunk_naming: Box<[u8]>,
    pub public_path: Box<[u8]>,
    pub extension_order: ResolveFileExtensions,
    pub main_field_extension_order: &'static [&'static [u8]],
    /// This list applies to all extension resolution cases. The runtime uses
    /// this for implementing `require.extensions`
    pub extra_cjs_extensions: Box<[Box<[u8]>]>,
    pub out_extensions: StringHashMap<&'static [u8]>,
    pub import_path_format: ImportPathFormat,
    pub defines_loaded: bool,
    pub env: Env,
    /// The raw API struct as passed to `from_api`. Kept around because a
    /// handful of places (jsx auto-detect, resolver `main_fields_is_default`,
    /// `configure_defines`, runtime VM/server config) re-read the original
    /// user-supplied flags after projection. `Arc` so `for_worker` is a
    /// pointer-clone instead of a deep clone of the (large) peechy struct —
    /// workers never mutate it.
    pub transform_options: std::sync::Arc<api::TransformOptions>,
    pub polyfill_node_globals: bool,
    pub transform_only: bool,
    pub load_tsconfig_json: bool,
    pub load_package_json: bool,

    pub rewrite_jest_for_tests: bool,

    pub macro_remap: MacroRemap,
    pub no_macros: bool,

    pub conditions: ESMConditions,
    pub tree_shaking: bool,
    pub code_splitting: bool,
    pub source_map: SourceMapOption,
    pub packages: PackagesOption,

    pub disable_transpilation: bool,

    pub global_cache: GlobalCache,
    pub prefer_offline_install: bool,
    pub prefer_latest_install: bool,
    /// Spec `options.zig:1753`: `?*const Api.BunInstall`. Stored as a raw
    /// `NonNull` (not `Option<&'a _>`) because every CLI caller borrows the
    /// process-lifetime `ctx.install: Box<BunInstall>` whose lifetime is
    /// unrelated to `'a`; a typed reference forced an `unsafe { &*(p as *const _) }`
    /// lifetime-extension cast at every call site (PORTING.md §Forbidden).
    /// The sole consumer (`PackageManager::init_with_runtime` via the resolver's
    /// erased `*const ()`) only reads through it.
    pub install: Option<core::ptr::NonNull<api::BunInstall>>,

    pub inlining: bool,
    pub inline_entrypoint_import_meta_main: bool,
    pub minify_whitespace: bool,
    pub minify_syntax: bool,
    pub minify_identifiers: bool,
    pub keep_names: bool,
    pub dead_code_elimination: bool,
    /// REPL mode: transforms code for interactive evaluation with vm.runInContext.
    /// Hoists declarations as var for persistence, wraps code in IIFE, and
    /// captures the last expression in { value: expr } for result extraction.
    pub repl_mode: bool,
    pub css_chunking: bool,

    pub ignore_dce_annotations: bool,
    pub emit_dce_annotations: bool,
    pub bytecode: bool,

    pub code_coverage: bool,
    pub debugger: bool,

    pub compile: bool,
    pub compile_to_standalone_html: bool,
    pub metafile: bool,
    /// Path to write JSON metafile (for Bun.build API)
    pub metafile_json_path: Box<[u8]>,
    /// Path to write markdown metafile (for Bun.build API)
    pub metafile_markdown_path: Box<[u8]>,

    /// Set when bake.DevServer is bundling.
    // SAFETY: erased bun_runtime::bake::DevServer (T6). bundler never dereferences fields
    // directly — all access goes through crate::dispatch::DevServerVTable.
    pub dev_server: *const (),
    /// Set when Bake is bundling. Affects module resolution.
    // TODO(b0): bake::Framework arrives from move-in (TYPE_ONLY → bundler)
    pub framework: Option<&'a crate::bake_types::Framework>,

    pub serve_plugins: Option<Box<[Box<[u8]>]>>,
    pub bunfig_path: Box<[u8]>,

    /// This is a list of packages which even when require() is used, we will
    /// instead convert to ESM import statements.
    ///
    /// This is not normally a safe transformation.
    ///
    /// So we have a list of packages which we know are safe to do this with.
    pub unwrap_commonjs_packages: &'static [&'static [u8]],

    pub supports_multiple_outputs: bool,

    /// This is set by the process environment, which is used to override the
    /// JSX configuration. When this is unspecified, the tsconfig.json is used
    /// to determine if a development jsx-runtime is used (by going between
    /// "react-jsx" or "react-jsx-dev-runtime")
    pub force_node_env: ForceNodeEnv,

    pub ignore_module_resolution_errors: bool,

    /// Package names whose barrel files should be optimized.
    /// When set, barrel files from these packages will only load submodules
    /// that are actually imported. Also, any file with sideEffects: false
    /// in its package.json is automatically a barrel candidate.
    pub optimize_imports: Option<&'a StringSet>,
}

// B-3 UNIFIED: was a local dup of `bun_options_types::bundle_enums::ForceNodeEnv`
// (resolver carried a second FORWARD_DECL copy). Canonical type now lives in
// bun_options_types; re-exported here so `options::ForceNodeEnv` call sites in
// bundle_v2.rs / transpiler.rs are unchanged.
pub use bun_options_types::ForceNodeEnv;

/// Manual deep clone for `MacroRemap` (= `StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>`).
/// The inner map's `clone()` is an inherent fallible method (not `impl Clone`),
/// so the outer `StringArrayHashMap::<V: Clone>::clone()` bound is unmet —
/// rebuild entrywise instead.
fn clone_macro_remap(src: &MacroRemap) -> MacroRemap {
    let mut out = MacroRemap::default();
    for (k, v) in src.iter() {
        bun_core::handle_oom(out.put(k, bun_core::handle_oom(v.clone())));
    }
    out
}

impl<'a> BundleOptions<'a> {
    pub fn is_test(&self) -> bool {
        self.rewrite_jest_for_tests
    }

    pub fn set_production(&mut self, value: bool) {
        if self.force_node_env == ForceNodeEnv::Unspecified {
            self.production = value;
            self.jsx.development = !value;
        }
    }

    /// Per-worker deep clone — replaces the prior bitwise
    /// `ptr::copy_nonoverlapping` of the parent `Transpiler` (which aliased
    /// every `Box`/`Vec` in here between parent and worker; reassigning any of
    /// them on the worker dropped the parent's allocation). Every owned field
    /// is `Clone`d; raw-pointer / `Copy` / `&'a` fields copy directly.
    ///
    /// PERF(port): Zig's `transpiler.* = from.*` is a shallow struct copy
    /// (slices alias the parent's arena). The Rust port owns these as `Box`,
    /// so a per-worker clone allocates. Profile in Phase B; the hot fields
    /// (`define`, `loaders`, `conditions`) are O(dozens) entries.
    pub fn for_worker(&self) -> BundleOptions<'a> {
        debug_assert!(
            self.defines_loaded,
            "BundleOptions::for_worker requires configure_defines() to have run on the parent (env.defaults is not cloned)",
        );
        BundleOptions {
            footer: self.footer.clone(),
            banner: self.banner.clone(),
            define: Box::new(defines::Define {
                identifiers: self.define.identifiers.clone(),
                dots: self.define.dots.clone(),
                drop_debugger: self.define.drop_debugger,
            }),
            drop: self.drop.clone(),
            bundler_feature_flags: self
                .bundler_feature_flags
                .as_deref()
                .map(|s| Box::new(bun_core::handle_oom(s.clone()))),
            loaders: bun_core::handle_oom(self.loaders.clone()),
            resolve_dir: self.resolve_dir.clone(),
            jsx: self.jsx.clone(),
            emit_decorator_metadata: self.emit_decorator_metadata,
            experimental_decorators: self.experimental_decorators,
            auto_import_jsx: self.auto_import_jsx,
            allow_runtime: self.allow_runtime,
            trim_unused_imports: self.trim_unused_imports,
            mark_builtins_as_external: self.mark_builtins_as_external,
            server_components: self.server_components,
            hot_module_reloading: self.hot_module_reloading,
            react_fast_refresh: self.react_fast_refresh,
            inject: self.inject.clone(),
            origin: self.origin.clone(),
            output_dir_handle: self.output_dir_handle,
            output_dir: self.output_dir.clone(),
            root_dir: self.root_dir.clone(),
            node_modules_bundle_url: self.node_modules_bundle_url.clone(),
            node_modules_bundle_pretty_path: self.node_modules_bundle_pretty_path.clone(),
            write: self.write,
            preserve_symlinks: self.preserve_symlinks,
            preserve_extensions: self.preserve_extensions,
            production: self.production,
            output_format: self.output_format,
            append_package_version_in_query_string: self.append_package_version_in_query_string,
            tsconfig_override: self.tsconfig_override.clone(),
            target: self.target,
            main_fields: self.main_fields.clone(),
            log: self.log,
            external: self.external.clone(),
            allow_unresolved: self.allow_unresolved.clone(),
            entry_points: self.entry_points.clone(),
            entry_naming: self.entry_naming.clone(),
            asset_naming: self.asset_naming.clone(),
            chunk_naming: self.chunk_naming.clone(),
            public_path: self.public_path.clone(),
            extension_order: self.extension_order.clone(),
            main_field_extension_order: self.main_field_extension_order,
            extra_cjs_extensions: self.extra_cjs_extensions.clone(),
            out_extensions: self.out_extensions.clone(),
            import_path_format: self.import_path_format,
            defines_loaded: self.defines_loaded,
            // `Env.defaults: MultiArrayList` has no `Clone`; workers never read
            // it (`configure_defines` early-returns on `defines_loaded`), so
            // carry the scalars + an empty list.
            env: Env {
                behavior: self.env.behavior,
                prefix: self.env.prefix.clone(),
                defaults: Default::default(),
                files: self.env.files.clone(),
                disable_default_env_files: self.env.disable_default_env_files,
            },
            transform_options: std::sync::Arc::clone(&self.transform_options),
            polyfill_node_globals: self.polyfill_node_globals,
            transform_only: self.transform_only,
            load_tsconfig_json: self.load_tsconfig_json,
            load_package_json: self.load_package_json,
            rewrite_jest_for_tests: self.rewrite_jest_for_tests,
            macro_remap: clone_macro_remap(&self.macro_remap),
            no_macros: self.no_macros,
            conditions: ESMConditions {
                default: bun_core::handle_oom(self.conditions.default.clone()),
                import: bun_core::handle_oom(self.conditions.import.clone()),
                require: bun_core::handle_oom(self.conditions.require.clone()),
                style: bun_core::handle_oom(self.conditions.style.clone()),
            },
            tree_shaking: self.tree_shaking,
            code_splitting: self.code_splitting,
            source_map: self.source_map,
            packages: self.packages,
            disable_transpilation: self.disable_transpilation,
            global_cache: self.global_cache,
            prefer_offline_install: self.prefer_offline_install,
            prefer_latest_install: self.prefer_latest_install,
            install: self.install,
            inlining: self.inlining,
            inline_entrypoint_import_meta_main: self.inline_entrypoint_import_meta_main,
            minify_whitespace: self.minify_whitespace,
            minify_syntax: self.minify_syntax,
            minify_identifiers: self.minify_identifiers,
            keep_names: self.keep_names,
            dead_code_elimination: self.dead_code_elimination,
            repl_mode: self.repl_mode,
            css_chunking: self.css_chunking,
            ignore_dce_annotations: self.ignore_dce_annotations,
            emit_dce_annotations: self.emit_dce_annotations,
            bytecode: self.bytecode,
            code_coverage: self.code_coverage,
            debugger: self.debugger,
            compile: self.compile,
            compile_to_standalone_html: self.compile_to_standalone_html,
            metafile: self.metafile,
            metafile_json_path: self.metafile_json_path.clone(),
            metafile_markdown_path: self.metafile_markdown_path.clone(),
            dev_server: self.dev_server,
            framework: self.framework,
            serve_plugins: self.serve_plugins.clone(),
            bunfig_path: self.bunfig_path.clone(),
            unwrap_commonjs_packages: self.unwrap_commonjs_packages,
            supports_multiple_outputs: self.supports_multiple_outputs,
            force_node_env: self.force_node_env,
            ignore_module_resolution_errors: self.ignore_module_resolution_errors,
            optimize_imports: self.optimize_imports,
        }
    }

    /// Shared-borrow the per-Transpiler `Log`.
    ///
    /// SAFETY: `self.log` is non-null once `from_api` / `Transpiler::init` has
    /// run (Zig spec `options.zig:1714`: `log: *logger.Log`, non-optional).
    /// The pointee is the caller-owned arena `Log` which outlives `self`. The
    /// same allocation is aliased into `Transpiler.log` / `Resolver.log` /
    /// `Linker.log` as raw `*mut`; a `&` here is sound so long as no caller
    /// holds a live `&mut Log` from one of those aliases concurrently.
    #[inline]
    pub fn log(&self) -> &bun_ast::Log {
        unsafe { &*self.log }
    }

    /// Reborrow the per-Transpiler `Log` mutably. `&self` receiver (not
    /// `&mut self`) so call sites can pass other `self.*` fields alongside the
    /// result without a borrowck conflict — mirrors `Transpiler::log_mut`.
    ///
    /// SAFETY: see [`BundleOptions::log`]. Callers must not hold two results
    /// live at once, nor hold a result across a `Resolver` / `Linker` call
    /// that itself writes through the aliased `*mut Log`.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn log_mut(&self) -> &mut bun_ast::Log {
        unsafe { &mut *self.log }
    }

    /// Read-only view of the parsed `bunfig.toml` `[install]` block, if any.
    ///
    /// SAFETY: when `Some`, the `NonNull` points at the process-lifetime
    /// `ctx.install: Box<BunInstall>` (see field doc), which outlives `self`
    /// and is never mutated after CLI parsing. The sole consumer
    /// (`PackageManager::init_with_runtime`) only reads through it.
    #[inline]
    pub fn install(&self) -> Option<&api::BunInstall> {
        self.install.map(|p| unsafe { p.as_ref() })
    }

    /// Whether `bake.DevServer` is driving this bundle. The stored pointer is
    /// erased (`*const ()` — runtime type lives behind `dispatch::DevServerVTable`),
    /// so no `&T` accessor is possible; bundler code only ever tests presence.
    #[inline]
    pub fn has_dev_server(&self) -> bool {
        !self.dev_server.is_null()
    }

    pub const DEFAULT_UNWRAP_COMMONJS_PACKAGES: &'static [&'static [u8]] = &[
        b"react",
        b"react-is",
        b"react-dom",
        b"scheduler",
        b"react-client",
        b"react-server",
        b"react-refresh",
    ];

    #[inline]
    pub fn css_import_behavior(&self) -> api::CssInJsBehavior {
        match self.target {
            Target::Browser => api::CssInJsBehavior::AutoOnimportcss,
            _ => api::CssInJsBehavior::Facade,
        }
    }

    pub fn are_defines_unset(&self) -> bool {
        !self.defines_loaded
    }

    // TODO(b2-blocked): defines_from_transform_options (see above) +
    // api::TransformOptions.define field (peechy `TransformOptions` body still
    // opaque).
    pub fn load_defines(
        &mut self,
        arena: &bun_alloc::Arena,
        loader_: Option<&mut DotEnv::Loader>,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: spec `loadDefines(..., env: ?*const options.Env)` had its
        // sole caller pass `&this.options.env` (transpiler.zig:334). Forwarding
        // that as `Option<&Env>` forced the caller into an aliased-`&mut` UB
        // raw-pointer dance under Stacked Borrows. Dropped the param and read
        // `&self.env` here instead — disjoint from the `self.define` /
        // `self.defines_loaded` writes below, so borrowck splits it cleanly.
        //
        // The `arena` param is kept (spec passes `this.arena`, i.e.
        // `bun.default_allocator`) because `DefineData::from_input` JSON-parses
        // each define value into `EString` nodes whose `.data` slices borrow
        // the arena — they must outlive `self.define`, not just this call.
        if self.defines_loaded {
            return Ok(());
        }
        // PERF(port): the spec uses borrowed static literals for the three
        // constant cases; only the env-loader case needs an owned copy (it has
        // to outlive the `&mut loader_` we pass below, so it can't stay a borrow
        // into the loader). `Cow` keeps the literals zero-alloc — matters because
        // every VM with no `NODE_ENV` in its env hits the `"development"` arm.
        let node_env: Option<Cow<[u8]>> = 'node_env: {
            if let Some(e) = loader_.as_deref() {
                if let Some(env_) = e.get_node_env() {
                    break 'node_env Some(Cow::Owned(env_.to_vec()));
                }
            }

            if self.is_test() {
                break 'node_env Some(Cow::Borrowed(b"\"test\"".as_slice()));
            }

            if self.production {
                break 'node_env Some(Cow::Borrowed(b"\"production\"".as_slice()));
            }

            Some(Cow::Borrowed(b"\"development\"".as_slice()))
        };
        // PORT NOTE: reshaped for borrowck — node_env computed before passing self.log
        self.define = defines_from_transform_options(
            // No other `&mut Log` is live across this call (see `log_mut`
            // caller contract).
            self.log_mut(),
            self.transform_options.define.as_ref(),
            self.target,
            loader_,
            Some(&self.env),
            node_env.as_deref(),
            // TODO(port): &self.drop is Box<[Box<[u8]>]>, callee wants &[&[u8]]
            &self.drop.iter().map(|s| s.as_ref()).collect::<Vec<_>>(),
            self.dead_code_elimination && self.minify_syntax,
            arena,
        )?;
        self.defines_loaded = true;
        Ok(())
    }

    pub fn loader(&self, ext: &[u8]) -> Loader {
        self.loaders.get(ext).copied().unwrap_or(Loader::File)
    }

    pub fn from_api(
        fs: &mut Fs::FileSystem,
        log: *mut bun_ast::Log,
        transform: api::TransformOptions,
    ) -> Result<BundleOptions<'a>, bun_core::Error> {
        use core::sync::atomic::Ordering;

        // Keep `transform` behind an `Arc` so stashing it in `transform_options`
        // is a refcount bump rather than a deep clone of ~30 heap fields, and so
        // dropping the local at the end of this fn is a refcount decrement rather
        // than recursive `drop_in_place` over every `Box<[u8]>`/`Vec`.
        let transform = std::sync::Arc::new(transform);

        let target = <Target as bun_options_types::TargetExt>::from_api(transform.target);
        let loaders = loaders_from_transform_options(transform.loaders.as_ref(), target)?;
        let bundler_feature_flags = Runtime::Features::init_bundler_feature_flags(
            &transform
                .feature_flags
                .iter()
                .map(|s| s.as_ref())
                .collect::<Vec<&[u8]>>(),
        );

        // TODO(port): many fields below have Zig defaults via `= ...`; in Rust we initialize
        // each explicitly. Phase B: add a `Default`-ish builder.
        let mut opts = BundleOptions {
            footer: Cow::Borrowed(b""),
            banner: Cow::Borrowed(b""),
            log,
            // PORT NOTE: `define` is `undefined` in Zig and filled by `loadDefines` later;
            // initialize empty so the struct is well-formed before `load_defines` runs.
            define: Box::new(defines::Define {
                identifiers: Default::default(),
                dots: Default::default(),
                drop_debugger: false,
            }),
            loaders,
            output_dir: Box::from(transform.output_dir.as_deref().unwrap_or(b"out")),
            target,
            write: transform.write.unwrap_or(false),
            external: ExternalModules::default(), // filled below
            entry_points: transform.entry_points.clone().into_boxed_slice(),
            out_extensions: StringHashMap::default(), // filled below
            env: Env::init(),
            transform_options: std::sync::Arc::clone(&transform),
            css_chunking: false,
            drop: transform.drop.clone().into_boxed_slice(),
            bundler_feature_flags,

            resolve_dir: Cow::Borrowed(b"/"),
            jsx: jsx::Pragma::default(),
            emit_decorator_metadata: false,
            experimental_decorators: false,
            auto_import_jsx: true,
            allow_runtime: true,
            trim_unused_imports: None,
            mark_builtins_as_external: false,
            server_components: false,
            hot_module_reloading: false,
            react_fast_refresh: false,
            inject: None,
            origin: bun_url::OwnedURL::from_href(Box::default()),
            output_dir_handle: None,
            root_dir: Box::default(),
            node_modules_bundle_url: Cow::Borrowed(b""),
            node_modules_bundle_pretty_path: Cow::Borrowed(b""),
            preserve_symlinks: false,
            preserve_extensions: false,
            production: false,
            output_format: Format::Esm,
            append_package_version_in_query_string: false,
            tsconfig_override: None,
            main_fields: owned_string_list(Target::default_main_fields_map()[Target::Browser]),
            allow_unresolved: AllowUnresolved::All,
            entry_naming: Box::default(),
            asset_naming: Box::default(),
            chunk_naming: Box::default(),
            public_path: Box::default(),
            extension_order: ResolveFileExtensions::default(),
            main_field_extension_order: bundle_options_defaults::MAIN_FIELD_EXTENSION_ORDER,
            extra_cjs_extensions: Box::default(),
            import_path_format: ImportPathFormat::Relative,
            defines_loaded: false,
            polyfill_node_globals: false,
            transform_only: false,
            load_tsconfig_json: true,
            load_package_json: true,
            rewrite_jest_for_tests: false,
            macro_remap: MacroRemap::default(),
            no_macros: false,
            conditions: ESMConditions {
                default: Default::default(),
                import: Default::default(),
                require: Default::default(),
                style: Default::default(),
            }, // filled below
            tree_shaking: false,
            code_splitting: false,
            source_map: SourceMapOption::None,
            packages: PackagesOption::Bundle,
            disable_transpilation: false,
            global_cache: GlobalCache::disable,
            prefer_offline_install: false,
            prefer_latest_install: false,
            install: None,
            inlining: false,
            inline_entrypoint_import_meta_main: false,
            minify_whitespace: false,
            minify_syntax: false,
            minify_identifiers: false,
            keep_names: false,
            dead_code_elimination: true,
            repl_mode: false,
            ignore_dce_annotations: false,
            emit_dce_annotations: false,
            bytecode: false,
            code_coverage: false,
            debugger: false,
            compile: false,
            compile_to_standalone_html: false,
            metafile: false,
            metafile_json_path: Box::default(),
            metafile_markdown_path: Box::default(),
            dev_server: core::ptr::null(),
            framework: None,
            serve_plugins: None,
            bunfig_path: Box::default(),
            unwrap_commonjs_packages: Self::DEFAULT_UNWRAP_COMMONJS_PACKAGES,
            supports_multiple_outputs: true,
            force_node_env: ForceNodeEnv::Unspecified,
            ignore_module_resolution_errors: false,
            optimize_imports: None,
        };

        // TODO(b2-blocked): bun_analytics dep not yet wired in bundler/Cargo.toml
        {
            analytics::features::define
                .fetch_add(usize::from(transform.define.is_some()), Ordering::Relaxed);
            analytics::features::loaders
                .fetch_add(usize::from(transform.loaders.is_some()), Ordering::Relaxed);
        }

        opts.serve_plugins = transform
            .serve_plugins
            .as_ref()
            .map(|v| v.clone().into_boxed_slice());
        opts.bunfig_path = transform.bunfig_path.clone();

        if !transform.env_files.is_empty() {
            opts.env.files = transform.env_files.clone().into_boxed_slice();
        }

        opts.env.disable_default_env_files = transform.disable_default_env_files;

        if let Some(origin) = &transform.origin {
            // PORT NOTE: ownership — `URL<'_>` borrows its input. The Zig
            // `URL.parse` borrowed `transform.origin` (a sibling of
            // `opts.transform_options`); here `OwnedURL` owns the href and
            // callers borrow via `.url()`.
            opts.origin = bun_url::OwnedURL::from_href(origin.clone());
        }

        if let Some(jsx_opts) = &transform.jsx {
            opts.jsx = jsx::Pragma::from_api(jsx_opts.clone())?;
        }

        if !transform.extension_order.is_empty() {
            opts.extension_order.default.default = transform
                .extension_order
                .iter()
                .map(|s| Box::<[u8]>::from(s.as_ref()))
                .collect();
        }

        if let Some(t) = transform.target {
            opts.target = <Target as bun_options_types::TargetExt>::from_api(Some(t));
            opts.main_fields = owned_string_list(Target::default_main_fields_map()[opts.target]);
        }

        {
            // conditions:
            // 1. defaults
            // 2. node-addons
            // 3. user conditions
            opts.conditions = ESMConditions::init(
                Target::default_conditions_map()[opts.target],
                transform.allow_addons.unwrap_or(true),
                &transform
                    .conditions
                    .iter()
                    .map(|s| &**s)
                    .collect::<Vec<&[u8]>>(),
            )?;
        }

        match opts.target {
            Target::Node => {
                opts.import_path_format = ImportPathFormat::Relative;
                opts.allow_runtime = false;
            }
            Target::Bun => {
                opts.import_path_format =
                    if opts.import_path_format == ImportPathFormat::AbsoluteUrl {
                        ImportPathFormat::AbsoluteUrl
                    } else {
                        ImportPathFormat::AbsolutePath
                    };

                opts.env.behavior = api::DotEnvBehavior::LoadAll;
                if transform.extension_order.is_empty() {
                    // we must also support require'ing .node files
                    // TODO(port): comptime concat — Phase B: precompute as static slices
                    static EXT_WITH_NODE: &[&[u8]] = &[
                        b".tsx", b".ts", b".jsx", b".cts", b".cjs", b".js", b".mjs", b".mts",
                        b".json", b".node",
                    ];
                    static NM_EXT_WITH_NODE: &[&[u8]] = &[
                        b".jsx", b".cjs", b".js", b".mjs", b".mts", b".tsx", b".ts", b".cts",
                        b".json", b".node",
                    ];
                    opts.extension_order.default.default = owned_string_list(EXT_WITH_NODE);
                    opts.extension_order.node_modules.default = owned_string_list(NM_EXT_WITH_NODE);
                }
            }
            _ => {}
        }

        if !transform.main_fields.is_empty() {
            opts.main_fields = transform
                .main_fields
                .iter()
                .map(|s| Box::<[u8]>::from(s.as_ref()))
                .collect();
        }

        // PORT NOTE: Zig passed `log` directly; reborrow the raw `*mut Log`
        // for the duration of this call only.
        opts.external = init_external_modules(
            &mut fs.fs,
            fs.top_level_dir,
            &transform
                .external
                .iter()
                .map(|s| s.as_ref())
                .collect::<Vec<&[u8]>>(),
            // sole live `&mut` for this call (struct not yet returned).
            opts.log_mut(),
            opts.target,
        );
        opts.out_extensions = opts.target.out_extensions();

        opts.source_map = SourceMapOption::from_api(transform.source_map);

        opts.packages = PackagesOption::from_api(transform.packages);

        opts.tree_shaking = opts.target.is_bun() || opts.production;
        opts.inlining = opts.tree_shaking;
        if opts.inlining {
            opts.minify_syntax = true;
        }

        if opts.origin.url().is_absolute() {
            opts.import_path_format = ImportPathFormat::AbsoluteUrl;
        }

        if opts.write && !opts.output_dir.is_empty() {
            let handle = open_output_dir(&opts.output_dir)?;
            opts.output_dir_handle = Some(handle);
            // PORT NOTE: Zig `fs.getFdPath(.fromStdDir(handle))` interns into
            // `dirname_store`; the inline `bun_resolver::fs::FileSystem` does
            // not yet expose `get_fd_path`, so resolve via `bun_sys` and box.
            let mut buf = bun_paths::PathBuffer::uninit();
            let dir = bun_sys::get_fd_path(handle, &mut buf).map_err(bun_core::Error::from)?;
            opts.output_dir = Box::from(&dir[..]);
        }

        opts.polyfill_node_globals = opts.target == Target::Browser;

        if let Some(tsconfig) = &transform.tsconfig_override {
            opts.tsconfig_override = Some(tsconfig.clone());
        }

        // TODO(b2-blocked): bun_analytics dep not yet wired in bundler/Cargo.toml
        {
            analytics::features::macros.fetch_add(
                usize::from(opts.target == Target::BunMacro),
                Ordering::Relaxed,
            );
            analytics::features::external.fetch_add(
                usize::from(!transform.external.is_empty()),
                Ordering::Relaxed,
            );
        }
        Ok(opts)
    }
}

impl Drop for BundleOptions<'_> {
    fn drop(&mut self) {
        // self.define dropped automatically (Box<Define>).
        //
        // bundler_feature_flags: Zig compared the pointer to
        // `&Runtime.Features.empty_bundler_feature_flags` and freed iff distinct.
        // In Rust the field is `Option<Box<StringSet>>`; `None` ≡ the static
        // empty set (nothing to free), `Some` drops the Box here automatically.
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportPathFormat {
    Relative,
    AbsoluteUrl,
    // omit file extension
    AbsolutePath,
    PackagePath,
}

pub mod bundle_options_defaults {
    pub const EXTENSION_ORDER: &[&[u8]] = &[
        b".tsx", b".ts", b".jsx", b".cts", b".cjs", b".js", b".mjs", b".mts", b".json",
    ];

    pub const MAIN_FIELD_EXTENSION_ORDER: &[&[u8]] =
        &[b".js", b".cjs", b".cts", b".tsx", b".ts", b".jsx", b".json"];

    pub const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
        b".tsx", b".jsx", b".mts", b".ts", b".mjs", b".js", b".cts", b".cjs", b".json",
    ];

    pub const CSS_EXTENSION_ORDER: &[&[u8]] = &[b".css"];

    pub mod node_modules {
        pub const EXTENSION_ORDER: &[&[u8]] = &[
            b".jsx", b".cjs", b".js", b".mjs", b".mts", b".tsx", b".ts", b".cts", b".json",
        ];

        pub const MODULE_EXTENSION_ORDER: &[&[u8]] = &[
            b".mjs", b".jsx", b".mts", b".js", b".cjs", b".tsx", b".ts", b".cts", b".json",
        ];
    }
}

pub fn open_output_dir(output_dir: &[u8]) -> Result<Dir, bun_core::Error> {
    // PORT NOTE: Zig used `std.fs.cwd().openDir/.makeDir`; routed through
    // `bun_sys` per CLAUDE.md (never `std::fs`).
    match bun_sys::open_dir_at(bun_sys::Fd::cwd(), output_dir) {
        Ok(d) => Ok(d),
        Err(_) => {
            // Zig: `std.fs.cwd().makeDir(output_dir)` — single-level mkdir
            // (fails ENOENT if parent missing). Do NOT use `make_path` (the
            // recursive `mkdir -p` variant) here.
            let mut buf = bun_paths::PathBuffer::uninit();
            let len = output_dir.len().min(buf.0.len() - 1);
            buf.0[..len].copy_from_slice(&output_dir[..len]);
            buf.0[len] = 0;
            // SAFETY: NUL-terminated above; `buf` outlives the `mkdirat` call.
            let z = bun_core::ZStr::from_buf(&buf.0[..], len);
            if let Err(err) = bun_sys::mkdirat(bun_sys::Fd::cwd(), z, 0o755) {
                let err: bun_core::Error = err.into();
                Output::print_errorln(format_args!(
                    "error: Unable to mkdir \"{}\": \"{}\"",
                    bstr::BStr::new(output_dir),
                    err.name(),
                ));
                Global::crash();
            }

            match bun_sys::open_dir_at(bun_sys::Fd::cwd(), output_dir) {
                Ok(handle) => Ok(handle),
                Err(err2) => {
                    Output::print_errorln(format_args!(
                        "error: Unable to open \"{}\": \"{}\"",
                        bstr::BStr::new(output_dir),
                        bstr::BStr::new(err2.name()),
                    ));
                    Global::crash();
                }
            }
        }
    }
}

/// Port of `fs.zig` `Fs.File` (path + contents pair). `bun_resolver::fs`
/// does not surface this type yet (TODO(b2-blocked)); local mirror keeps
/// `TransformOptions.entry_point` self-contained.
pub struct EntryPointFile {
    pub path: bun_paths::fs::Path<'static>,
    pub contents: Box<[u8]>,
}

pub struct TransformOptions {
    pub footer: &'static [u8],
    pub banner: &'static [u8],
    pub define: StringHashMap<Box<[u8]>>,
    pub loader: Loader,
    pub resolve_dir: Box<[u8]>,
    pub jsx: Option<jsx::Pragma>,
    pub react_fast_refresh: bool,
    pub inject: Option<Box<[Box<[u8]>]>>,
    pub origin: &'static [u8],
    pub preserve_symlinks: bool,
    pub entry_point: EntryPointFile,
    pub resolve_paths: bool,
    pub tsconfig_override: Option<Box<[u8]>>,

    pub target: Target,
    pub main_fields: &'static [&'static [u8]],
}

impl TransformOptions {
    pub fn init_uncached(
        entry_point_name: &'static [u8],
        code: &[u8],
    ) -> Result<TransformOptions, bun_core::Error> {
        debug_assert!(!entry_point_name.is_empty());

        let entry_point = EntryPointFile {
            path: bun_paths::fs::Path::init(entry_point_name),
            contents: Box::from(code),
        };

        let mut _cwd: Box<[u8]> = Box::from(b"/".as_slice());
        // TODO(port): Environment.isWasi
        #[cfg(any(target_os = "wasi", windows))]
        {
            // `getcwd_alloc` returns a NUL-terminated `ZBox`; strip the NUL
            // and reuse the allocation as a plain `Box<[u8]>`.
            let mut v = bun_sys::getcwd_alloc()?.into_vec_with_nul();
            v.pop();
            _cwd = v.into_boxed_slice();
        }

        let mut define = StringHashMap::<Box<[u8]>>::default();
        define.reserve(1);
        // PERF(port): was assume_capacity
        define.put_assume_capacity(b"process.env.NODE_ENV", b"development".as_slice().into());

        let mut loader = Loader::File;
        if let Some(default_loader) = DEFAULT_LOADERS.get(entry_point.path.name.ext) {
            loader = *default_loader;
        }
        debug_assert!(!code.is_empty());

        Ok(TransformOptions {
            footer: b"",
            banner: b"",
            define,
            loader,
            resolve_dir: Box::from(entry_point.path.name.dir),
            entry_point,
            // TODO(port): resolve_dir borrows from entry_point in Zig; cloned here
            main_fields: Target::default_main_fields_map()[Target::Browser],
            jsx: if loader.is_jsx() {
                Some(jsx::Pragma::default())
            } else {
                None
            },
            react_fast_refresh: false,
            inject: None,
            origin: b"",
            preserve_symlinks: false,
            resolve_paths: false,
            tsconfig_override: None,
            target: Target::Browser,
        })
    }
}

pub use crate::output_file::OutputFile;

#[derive(Default)]
pub struct TransformResult {
    pub errors: Box<[bun_ast::Msg]>,
    pub warnings: Box<[bun_ast::Msg]>,
    pub output_files: Box<[OutputFile]>,
    pub outbase: Box<[u8]>,
    pub root_dir: Option<Dir>,
}

impl TransformResult {
    pub fn init(
        outbase: Box<[u8]>,
        output_files: Box<[OutputFile]>,
        log: &mut bun_ast::Log,
    ) -> Result<TransformResult, bun_core::Error> {
        let mut errors: Vec<bun_ast::Msg> = Vec::with_capacity(log.errors as usize);
        let mut warnings: Vec<bun_ast::Msg> = Vec::with_capacity(log.warnings as usize);
        for msg in log.msgs.iter() {
            match msg.kind {
                bun_ast::Kind::Err => {
                    errors.push(msg.clone());
                }
                bun_ast::Kind::Warn => {
                    warnings.push(msg.clone());
                }
                _ => {}
            }
        }

        Ok(TransformResult {
            outbase,
            output_files,
            errors: errors.into_boxed_slice(),
            warnings: warnings.into_boxed_slice(),
            root_dir: None,
        })
    }
}

#[derive(Debug, Clone)]
pub struct EnvEntry {
    pub key: Box<[u8]>,
    pub value: Box<[u8]>,
}

type EnvList = MultiArrayList<EnvEntry>;

// PORT NOTE: `Debug` derive dropped — `MultiArrayList<T>` is not `Debug`.
pub struct Env {
    pub behavior: api::DotEnvBehavior,
    pub prefix: Box<[u8]>,
    pub defaults: EnvList,
    // arena: dropped (global mimalloc)
    /// List of explicit env files to load (e..g specified by --env-file args)
    pub files: Box<[Box<[u8]>]>,

    /// If true, disable loading of default .env files (from --no-env-file flag or bunfig)
    pub disable_default_env_files: bool,
}

impl Default for Env {
    fn default() -> Self {
        Env {
            behavior: api::DotEnvBehavior::disable,
            prefix: Box::default(),
            defaults: EnvList::default(),
            files: Box::default(),
            disable_default_env_files: false,
        }
    }
}

impl Env {
    pub fn init() -> Env {
        Env {
            defaults: EnvList::default(),
            prefix: Box::default(),
            behavior: api::DotEnvBehavior::disable,
            files: Box::default(),
            disable_default_env_files: false,
        }
    }

    pub fn ensure_total_capacity(&mut self, capacity: u64) -> Result<(), bun_alloc::AllocError> {
        self.defaults.ensure_total_capacity(capacity as usize)
    }

    pub fn set_defaults_map(
        &mut self,
        defaults: api::StringMap,
    ) -> Result<(), bun_alloc::AllocError> {
        self.defaults.shrink_retaining_capacity(0);

        if defaults.keys.is_empty() {
            return Ok(());
        }

        self.defaults.ensure_total_capacity(defaults.keys.len())?;

        for (i, key) in defaults.keys.iter().enumerate() {
            // PERF(port): was assume_capacity
            self.defaults.append(EnvEntry {
                key: key.clone(),
                value: defaults.values[i].clone(),
            })?;
        }
        Ok(())
    }

    // For reading from API
    pub fn set_from_api(&mut self, config: api::EnvConfig) -> Result<(), bun_alloc::AllocError> {
        self.set_behavior_from_prefix(config.prefix.as_deref().unwrap_or(b""));

        if let Some(defaults) = config.defaults {
            self.set_defaults_map(defaults)?;
        }
        Ok(())
    }

    pub fn set_behavior_from_prefix(&mut self, prefix: &[u8]) {
        self.behavior = api::DotEnvBehavior::disable;
        self.prefix = Box::default();

        if prefix == b"*" {
            self.behavior = api::DotEnvBehavior::load_all;
        } else if !prefix.is_empty() {
            self.behavior = api::DotEnvBehavior::prefix;
            self.prefix = Box::from(prefix);
        }
    }

    pub fn set_from_loaded(
        &mut self,
        config: api::LoadedEnvConfig,
    ) -> Result<(), bun_alloc::AllocError> {
        self.behavior = match config.dotenv {
            api::DotEnvBehavior::prefix => api::DotEnvBehavior::prefix,
            api::DotEnvBehavior::load_all => api::DotEnvBehavior::load_all,
            _ => api::DotEnvBehavior::disable,
        };

        self.prefix = config.prefix;

        self.set_defaults_map(config.defaults)
    }

    pub fn to_api(&self) -> api::LoadedEnvConfig {
        let slice = self.defaults.slice();

        api::LoadedEnvConfig {
            dotenv: self.behavior,
            prefix: self.prefix.clone(),
            defaults: api::StringMap {
                keys: slice.items::<"key", Box<[u8]>>().to_vec(),
                values: slice.items::<"value", Box<[u8]>>().to_vec(),
            },
        }
    }

    // For reading from package.json
    pub fn get_or_put_value(
        &mut self,
        key: &[u8],
        value: &[u8],
    ) -> Result<(), bun_alloc::AllocError> {
        let slice = self.defaults.slice();
        for _key in slice.items::<"key", Box<[u8]>>().iter() {
            if key == &**_key {
                return Ok(());
            }
        }

        self.defaults.append(EnvEntry {
            key: Box::from(key),
            value: Box::from(value),
        })
    }
}

// PORT NOTE: `Debug` derive dropped — `Env` is not `Debug` (MultiArrayList).
#[derive(Default)]
pub struct EntryPoint {
    pub path: Box<[u8]>,
    pub env: Env,
    pub kind: EntryPointKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EntryPointKind {
    Client,
    Server,
    Fallback,
    #[default]
    Disabled,
}

impl EntryPointKind {
    pub fn to_api(self) -> api::FrameworkEntryPointType {
        match self {
            EntryPointKind::Client => api::FrameworkEntryPointType::Client,
            EntryPointKind::Server => api::FrameworkEntryPointType::Server,
            EntryPointKind::Fallback => api::FrameworkEntryPointType::Fallback,
            _ => unreachable!(),
        }
    }
}

impl EntryPoint {
    pub fn is_enabled(&self) -> bool {
        self.kind != EntryPointKind::Disabled && !self.path.is_empty()
    }

    pub fn to_api(
        &self,
        toplevel_path: &[u8],
        kind: EntryPointKind,
    ) -> Result<Option<api::FrameworkEntryPoint>, bun_core::Error> {
        if self.kind == EntryPointKind::Disabled {
            return Ok(None);
        }

        Ok(Some(api::FrameworkEntryPoint {
            kind: kind.to_api(),
            env: self.env.to_api(),
            path: self.normalized_path(toplevel_path)?,
        }))
    }

    fn normalized_path(&self, toplevel_path: &[u8]) -> Result<Box<[u8]>, bun_core::Error> {
        debug_assert!(bun_paths::is_absolute(&self.path));
        let mut str: &[u8] = &self.path;
        if let Some(top) = strings::index_of(str, toplevel_path) {
            str = &str[top + toplevel_path.len()..];
        }

        // if it *was* a node_module path, we don't do any allocation, we just keep it as a package path
        if let Some(node_module_i) = strings::index_of(str, bun_paths::NODE_MODULES_TRAILING) {
            Ok(Box::from(
                &str[node_module_i + bun_paths::NODE_MODULES_TRAILING.len()..],
            ))
            // otherwise, we allocate a new string and copy the path into it with a leading "./"
        } else {
            let mut out = vec![0u8; str.len() + 2];
            out[0] = b'.';
            out[1] = b'/';
            out[2..].copy_from_slice(str);
            Ok(out.into_boxed_slice())
        }
    }

    pub fn from_loaded(
        &mut self,
        framework_entry_point: api::FrameworkEntryPoint,
        kind: EntryPointKind,
    ) -> Result<(), bun_core::Error> {
        self.path = framework_entry_point.path;
        self.kind = kind;
        let _ = self.env.set_from_loaded(framework_entry_point.env);
        Ok(())
    }

    pub fn from_api(
        &mut self,
        framework_entry_point: api::FrameworkEntryPointMessage,
        kind: EntryPointKind,
    ) -> Result<(), bun_core::Error> {
        self.path = framework_entry_point.path.unwrap_or_default();
        self.kind = kind;

        if self.path.is_empty() {
            self.kind = EntryPointKind::Disabled;
            return Ok(());
        }

        if let Some(env) = framework_entry_point.env {
            self.env.set_from_api(env)?;
        }
        Ok(())
    }
}

// MOVE_DOWN: RouteConfig moved to bun_router (lower-tier crate the bundler
// already depends on); re-export here so existing options::RouteConfig paths
// resolve to the single canonical definition.
pub use bun_router::RouteConfig;

#[derive(Debug, Clone, Default)]
pub struct PathTemplate {
    pub data: Box<[u8]>,
    pub placeholder: Placeholder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum PlaceholderField {
    Dir,
    Name,
    Ext,
    Hash,
    Target,
}

// Shared body for PathTemplate::needs / PathTemplateConst::needs (D064).
#[inline]
pub(crate) fn path_template_needs(data: &[u8], field: PlaceholderField) -> bool {
    // TODO(port): Zig used comptime @tagName concatenation; here we match explicitly.
    let needle: &[u8] = match field {
        PlaceholderField::Dir => b"[dir]",
        PlaceholderField::Name => b"[name]",
        PlaceholderField::Ext => b"[ext]",
        PlaceholderField::Hash => b"[hash]",
        PlaceholderField::Target => b"[target]",
    };
    strings::contains(data, needle)
}

// Shared body for PathTemplate::print / PathTemplateConst::print (D064).
// PORT NOTE: Zig `format(self, comptime _, _, writer: anytype)` writes raw path bytes via
// writer.writeAll; mapped to a byte-writer free fn (not `core::fmt::Display`) per
// PORTING.md "(comptime X: type, arg: X) writer → &mut impl bun_io::Write (bytes)".
pub(crate) fn path_template_print<W: bun_io::Write>(
    writer: &mut W,
    data: &[u8],
    dir: &[u8],
    name: &[u8],
    ext: &[u8],
    hash: Option<u64>,
    target: &[u8],
) -> bun_io::Result<()> {
    let mut remain: &[u8] = data;
    while let Some(j) = strings::index_of_char(remain, b'[') {
        let j = j as usize;
        PathTemplate::write_replacing_slashes_on_windows(writer, &remain[0..j])?;
        remain = &remain[j + 1..];
        if remain.is_empty() {
            // TODO: throw error
            writer.write_all(b"[")?;
            break;
        }

        let mut count: isize = 1;
        let mut end_len: usize = remain.len();
        for (idx, c) in remain.iter().enumerate() {
            count += match *c {
                b'[' => 1,
                b']' => -1,
                _ => 0,
            };

            if count == 0 {
                end_len = idx;
                debug_assert!(end_len <= remain.len());
                break;
            }
        }

        let placeholder = &remain[0..end_len];

        let Some(field) = PLACEHOLDER_MAP.get(placeholder).copied() else {
            PathTemplate::write_replacing_slashes_on_windows(writer, placeholder)?;
            remain = &remain[end_len..];
            continue;
        };

        match field {
            PlaceholderField::Dir => PathTemplate::write_replacing_slashes_on_windows(
                writer,
                if !dir.is_empty() { dir } else { b"." },
            )?,
            PlaceholderField::Name => {
                PathTemplate::write_replacing_slashes_on_windows(writer, name)?
            }
            PlaceholderField::Ext => PathTemplate::write_replacing_slashes_on_windows(writer, ext)?,
            PlaceholderField::Hash => {
                if let Some(hash) = hash {
                    writer.write_fmt(format_args!("{}", bun_core::fmt::truncated_hash32(hash)))?;
                }
            }
            PlaceholderField::Target => {
                PathTemplate::write_replacing_slashes_on_windows(writer, target)?
            }
        }
        remain = &remain[end_len + 1..];
    }

    PathTemplate::write_replacing_slashes_on_windows(writer, remain)
}

impl PathTemplate {
    pub fn needs(&self, field: PlaceholderField) -> bool {
        path_template_needs(&self.data, field)
    }

    #[inline]
    pub(crate) fn write_replacing_slashes_on_windows<W: bun_io::Write>(
        w: &mut W,
        slice: &[u8],
    ) -> bun_io::Result<()> {
        #[cfg(windows)]
        {
            let mut remain = slice;
            while let Some(i) = strings::index_of_char(remain, b'/') {
                let i = i as usize;
                w.write_all(&remain[0..i])?;
                w.write_all(&[b'\\'])?;
                remain = &remain[i + 1..];
            }
            w.write_all(remain)
        }
        #[cfg(not(windows))]
        {
            w.write_all(slice)
        }
    }

    pub const CHUNK: PathTemplateConst = PathTemplateConst {
        data: b"./chunk-[hash].[ext]",
        placeholder: PlaceholderConst {
            name: b"chunk",
            ext: b"js",
            dir: b"",
            hash: None,
            target: b"",
        },
    };

    pub const CHUNK_WITH_TARGET: PathTemplateConst = PathTemplateConst {
        data: b"[dir]/[target]/chunk-[hash].[ext]",
        placeholder: PlaceholderConst {
            name: b"chunk",
            ext: b"js",
            dir: b"",
            hash: None,
            target: b"",
        },
    };

    pub const FILE: PathTemplateConst = PathTemplateConst {
        data: b"[dir]/[name].[ext]",
        placeholder: PlaceholderConst::DEFAULT,
    };

    pub const FILE_WITH_TARGET: PathTemplateConst = PathTemplateConst {
        data: b"[dir]/[target]/[name].[ext]",
        placeholder: PlaceholderConst::DEFAULT,
    };

    pub const ASSET: PathTemplateConst = PathTemplateConst {
        data: b"./[name]-[hash].[ext]",
        placeholder: PlaceholderConst::DEFAULT,
    };

    pub const ASSET_WITH_TARGET: PathTemplateConst = PathTemplateConst {
        data: b"[dir]/[target]/[name]-[hash].[ext]",
        placeholder: PlaceholderConst::DEFAULT,
    };

    pub fn print<W: bun_io::Write>(&self, writer: &mut W) -> bun_io::Result<()> {
        path_template_print(
            writer,
            &self.data,
            &self.placeholder.dir,
            &self.placeholder.name,
            &self.placeholder.ext,
            self.placeholder.hash,
            &self.placeholder.target,
        )
    }
}

#[derive(Debug, Clone, Default)]
pub struct Placeholder {
    pub dir: Box<[u8]>,
    pub name: Box<[u8]>,
    pub ext: Box<[u8]>,
    pub hash: Option<u64>,
    pub target: Box<[u8]>,
}

// PORT NOTE: hoisted from `impl Placeholder` — Rust forbids `static` in inherent impls.
pub static PLACEHOLDER_MAP: phf::Map<&'static [u8], PlaceholderField> = phf::phf_map! {
    b"dir" => PlaceholderField::Dir,
    b"name" => PlaceholderField::Name,
    b"ext" => PlaceholderField::Ext,
    b"hash" => PlaceholderField::Hash,
    b"target" => PlaceholderField::Target,
};

// TODO(port): Zig PathTemplate constants used &'static str fields; Rust struct uses Box<[u8]>.
// PathTemplateConst is a const-friendly mirror; convert to PathTemplate at use sites.
#[derive(Debug, Clone, Copy)]
pub struct PathTemplateConst {
    pub data: &'static [u8],
    pub placeholder: PlaceholderConst,
}

#[derive(Debug, Clone, Copy)]
pub struct PlaceholderConst {
    pub dir: &'static [u8],
    pub name: &'static [u8],
    pub ext: &'static [u8],
    pub hash: Option<u64>,
    pub target: &'static [u8],
}

impl PlaceholderConst {
    pub const DEFAULT: PlaceholderConst = PlaceholderConst {
        dir: b"",
        name: b"",
        ext: b"",
        hash: None,
        target: b"",
    };
}

impl PathTemplateConst {
    /// Byte-writer form mirroring [`PathTemplate::print`] (Zig
    /// `PathTemplate.format`). Kept as an inherent method so callers writing
    /// to `Vec<u8>` via `write!(.., "{}", template)` resolve through the
    /// blanket [`core::fmt::Display`] impl below.
    pub fn print<W: bun_io::Write>(&self, writer: &mut W) -> bun_io::Result<()> {
        path_template_print(
            writer,
            self.data,
            self.placeholder.dir,
            self.placeholder.name,
            self.placeholder.ext,
            self.placeholder.hash,
            self.placeholder.target,
        )
    }

    pub fn needs(&self, field: PlaceholderField) -> bool {
        path_template_needs(self.data, field)
    }
}

impl core::fmt::Display for PathTemplateConst {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // PORT NOTE: Zig `format` writes raw bytes; route through a Vec then
        // emit via `write_str` (paths are UTF-8 in practice; lossy fallback
        // mirrors `bstr::BStr` Display semantics).
        let mut buf = Vec::<u8>::new();
        self.print(&mut buf).map_err(|_| core::fmt::Error)?;
        f.write_str(&String::from_utf8_lossy(&buf))
    }
}

impl core::fmt::Display for PathTemplate {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // PORT NOTE: Zig `PathTemplate.format` writes raw path bytes via
        // `writer.writeAll`; route through a Vec then emit via `write_str`
        // (paths are UTF-8 in practice; lossy fallback mirrors `bstr::BStr`
        // Display semantics). Mirrors `PathTemplateConst` Display above.
        let mut buf = Vec::<u8>::new();
        self.print(&mut buf).map_err(|_| core::fmt::Error)?;
        f.write_str(&String::from_utf8_lossy(&buf))
    }
}

impl From<PathTemplateConst> for PathTemplate {
    fn from(c: PathTemplateConst) -> Self {
        PathTemplate {
            data: Box::from(c.data),
            placeholder: Placeholder {
                dir: Box::from(c.placeholder.dir),
                name: Box::from(c.placeholder.name),
                ext: Box::from(c.placeholder.ext),
                hash: c.placeholder.hash,
                target: Box::from(c.placeholder.target),
            },
        }
    }
}

// ported from: src/bundler/options.zig
