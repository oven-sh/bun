//! This file is mostly the API schema but with all the options normalized.
//! Normalization is necessary because most fields in the API schema are optional

use bun_logger as logger;
use bun_str::strings;
use bun_core::{Output, Global};
use bun_collections::{StringHashMap, StringArrayHashMap, ArrayHashMap, MultiArrayList};
use bun_fs as Fs;
// TODO(b0-genuine): bun_resolver::package_json — same-tier (T5) mutual; revisit if resolver→bundler edge appears
use bun_resolver::{self as resolver, package_json::{MacroMap as MacroRemap, PackageJSON, ESModule::ConditionsMap}};
use bun_dotenv as DotEnv;
use bun_url::URL;
use bun_js_parser::runtime::Runtime;
use bun_schema::api;
use bun_analytics as analytics;
use enum_map::{EnumMap, Enum};

pub use crate::defines;
pub use defines::Define;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteDestination {
    Stdout,
    Disk,
    // eventually: wasm
}

pub fn validate_path(
    log: &mut logger::Log,
    _fs: &mut Fs::FileSystem::Implementation,
    cwd: &[u8],
    rel_path: &[u8],
    _path_kind: &[u8],
) -> Box<[u8]> {
    if rel_path.is_empty() {
        return Box::default();
    }
    let paths: [&[u8]; 2] = [cwd, rel_path];
    // TODO: switch to getFdPath()-based implementation
    // TODO(port): std.fs.path.resolve → bun_paths::resolve (allocating)
    match bun_paths::resolve(&paths) {
        Ok(out) => out,
        Err(err) => {
            log.add_error_fmt(
                None,
                logger::Loc::EMPTY,
                format_args!(
                    "<r><red>{}<r> resolving external: <b>\"{}\"<r>",
                    err.name(),
                    bstr::BStr::new(rel_path),
                ),
            )
            .expect("unreachable");
            Box::default()
        }
    }
}

// TODO(port): narrow error set
pub fn string_hash_map_from_arrays<M, K, V>(
    total_capacity: usize,
    keys: &[K],
    values: &[V],
) -> Result<M, bun_alloc::AllocError>
where
    M: Default,
    K: Clone,
    V: Clone,
    // TODO(port): M is a StringArrayHashMap-like; this is a structural constraint in Zig (anytype)
{
    // TODO(port): Zig used `t.init(allocator)`; in Rust the map type owns its allocator.
    let mut hash_map = M::default();
    if !keys.is_empty() {
        // TODO(port): ensureTotalCapacity / putAssumeCapacity — needs concrete map API
        let _ = u32::try_from(total_capacity).unwrap();
        for (i, key) in keys.iter().enumerate() {
            // hash_map.put_assume_capacity(key.clone(), values[i].clone());
            let _ = (key, &values[i]);
        }
        // PERF(port): was assume_capacity
    }
    let _ = total_capacity;
    Ok(hash_map)
    // TODO(port): this fn is generic over `comptime t: type` with `.init/.ensureTotalCapacity/.putAssumeCapacity`.
    // Phase B: replace callers with concrete StringArrayHashMap construction; this stub preserves signature.
}

#[derive(Debug, Clone)]
pub enum AllowUnresolved {
    /// Default. Skip all checks — current behavior.
    All,
    /// Always error on dynamic specifiers.
    None,
    /// Glob patterns; at least one must match the extracted shape.
    Patterns(Box<[Box<[u8]>]>),
}

impl Default for AllowUnresolved {
    fn default() -> Self {
        AllowUnresolved::All
    }
}

impl AllowUnresolved {
    pub const DEFAULT: AllowUnresolved = AllowUnresolved::All;

    /// Normalize from raw CLI/JS input.
    /// [] → .none, contains "*" → .all, else → .patterns
    pub fn from_strings(strs: Box<[Box<[u8]>]>) -> AllowUnresolved {
        if strs.is_empty() {
            return AllowUnresolved::None;
        }
        for s in strs.iter() {
            if &**s == b"*" {
                return AllowUnresolved::All;
            }
        }
        AllowUnresolved::Patterns(strs)
    }

    /// shape is the extracted template representation (may be "").
    pub fn allows(&self, shape: &[u8]) -> bool {
        match self {
            AllowUnresolved::All => true,
            AllowUnresolved::None => false,
            AllowUnresolved::Patterns(pats) => {
                for p in pats.iter() {
                    if bun_glob::r#match(p, shape).matches() {
                        return true;
                    }
                }
                false
            }
        }
    }
}

pub struct ExternalModules {
    pub node_modules: bun_collections::BufSet,
    pub abs_paths: bun_collections::BufSet,
    pub patterns: Box<[WildcardPattern]>,
}

#[derive(Debug, Clone)]
pub struct WildcardPattern {
    pub prefix: Box<[u8]>,
    pub suffix: Box<[u8]>,
}

impl ExternalModules {
    pub fn is_node_builtin(str: &[u8]) -> bool {
        bun_resolve_builtins::HardcodedModule::HardcodedModule::Alias::has(str, bun_resolve_builtins::HardcodedModule::RuntimeTarget::Node, Default::default())
    }

    const DEFAULT_WILDCARD_PATTERNS: &'static [(&'static [u8], &'static [u8])] = &[
        (b"/bun:", b""),
        // (b"/src:", b""),
        // (b"/blob:", b""),
    ];

    fn default_wildcard_patterns() -> Box<[WildcardPattern]> {
        Self::DEFAULT_WILDCARD_PATTERNS
            .iter()
            .map(|(p, s)| WildcardPattern { prefix: Box::from(*p), suffix: Box::from(*s) })
            .collect()
    }

    pub fn init(
        fs: &mut Fs::FileSystem::Implementation,
        cwd: &[u8],
        externals: &[&[u8]],
        log: &mut logger::Log,
        target: Target,
    ) -> ExternalModules {
        let mut result = ExternalModules {
            node_modules: bun_collections::BufSet::default(),
            abs_paths: bun_collections::BufSet::default(),
            patterns: Self::default_wildcard_patterns(),
        };

        match target {
            Target::Node => {
                // TODO: fix this stupid copy
                result.node_modules.reserve(NODE_BUILTIN_PATTERNS.len());
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

        let mut patterns: Vec<WildcardPattern> =
            Vec::with_capacity(Self::DEFAULT_WILDCARD_PATTERNS.len());
        // PERF(port): was appendSliceAssumeCapacity
        patterns.extend(Self::default_wildcard_patterns().into_vec());

        for external in externals {
            let path = *external;
            if let Some(i) = strings::index_of_char(path, b'*') {
                let i = i as usize;
                if strings::index_of_char(&path[i + 1..], b'*').is_some() {
                    log.add_error_fmt(
                        None,
                        logger::Loc::EMPTY,
                        format_args!(
                            "External path \"{}\" cannot have more than one \"*\" wildcard",
                            bstr::BStr::new(external)
                        ),
                    )
                    .expect("unreachable");
                    return result;
                }

                patterns.push(WildcardPattern {
                    prefix: Box::from(&external[0..i]),
                    suffix: Box::from(&external[i + 1..]),
                });
            } else if resolver::is_package_path(external) {
                result.node_modules.insert(external).expect("unreachable");
            } else {
                let normalized = validate_path(log, fs, cwd, external, b"external path");

                if !normalized.is_empty() {
                    result.abs_paths.insert(&normalized).expect("unreachable");
                }
            }
        }

        result.patterns = patterns.into_boxed_slice();

        result
    }
}

pub const NODE_BUILTIN_PATTERNS_RAW: &[&[u8]] = &[
    b"_http_agent",
    b"_http_client",
    b"_http_common",
    b"_http_incoming",
    b"_http_outgoing",
    b"_http_server",
    b"_stream_duplex",
    b"_stream_passthrough",
    b"_stream_readable",
    b"_stream_transform",
    b"_stream_wrap",
    b"_stream_writable",
    b"_tls_common",
    b"_tls_wrap",
    b"assert",
    b"async_hooks",
    b"buffer",
    b"child_process",
    b"cluster",
    b"console",
    b"constants",
    b"crypto",
    b"dgram",
    b"diagnostics_channel",
    b"dns",
    b"domain",
    b"events",
    b"fs",
    b"http",
    b"http2",
    b"https",
    b"inspector",
    b"module",
    b"net",
    b"os",
    b"path",
    b"perf_hooks",
    b"process",
    b"punycode",
    b"querystring",
    b"readline",
    b"repl",
    b"stream",
    b"string_decoder",
    b"sys",
    b"test",
    b"timers",
    b"tls",
    b"trace_events",
    b"tty",
    b"url",
    b"util",
    b"v8",
    b"vm",
    b"wasi",
    b"worker_threads",
    b"zlib",
];

// Zig: NodeBuiltinPatterns = NodeBuiltinPatternsRaw ++ (each prefixed with "node:")
pub const NODE_BUILTIN_PATTERNS: &[&[u8]] = &[
    // raw
    b"_http_agent", b"_http_client", b"_http_common", b"_http_incoming", b"_http_outgoing",
    b"_http_server", b"_stream_duplex", b"_stream_passthrough", b"_stream_readable",
    b"_stream_transform", b"_stream_wrap", b"_stream_writable", b"_tls_common", b"_tls_wrap",
    b"assert", b"async_hooks", b"buffer", b"child_process", b"cluster", b"console", b"constants",
    b"crypto", b"dgram", b"diagnostics_channel", b"dns", b"domain", b"events", b"fs", b"http",
    b"http2", b"https", b"inspector", b"module", b"net", b"os", b"path", b"perf_hooks",
    b"process", b"punycode", b"querystring", b"readline", b"repl", b"stream", b"string_decoder",
    b"sys", b"test", b"timers", b"tls", b"trace_events", b"tty", b"url", b"util", b"v8", b"vm",
    b"wasi", b"worker_threads", b"zlib",
    // node: prefixed
    b"node:_http_agent", b"node:_http_client", b"node:_http_common", b"node:_http_incoming",
    b"node:_http_outgoing", b"node:_http_server", b"node:_stream_duplex",
    b"node:_stream_passthrough", b"node:_stream_readable", b"node:_stream_transform",
    b"node:_stream_wrap", b"node:_stream_writable", b"node:_tls_common", b"node:_tls_wrap",
    b"node:assert", b"node:async_hooks", b"node:buffer", b"node:child_process", b"node:cluster",
    b"node:console", b"node:constants", b"node:crypto", b"node:dgram",
    b"node:diagnostics_channel", b"node:dns", b"node:domain", b"node:events", b"node:fs",
    b"node:http", b"node:http2", b"node:https", b"node:inspector", b"node:module", b"node:net",
    b"node:os", b"node:path", b"node:perf_hooks", b"node:process", b"node:punycode",
    b"node:querystring", b"node:readline", b"node:repl", b"node:stream", b"node:string_decoder",
    b"node:sys", b"node:test", b"node:timers", b"node:tls", b"node:trace_events", b"node:tty",
    b"node:url", b"node:util", b"node:v8", b"node:vm", b"node:wasi", b"node:worker_threads",
    b"node:zlib",
];

pub const BUN_NODE_BUILTIN_PATTERNS_COMPAT: &[&[u8]] = &[
    b"_http_agent",
    b"_http_client",
    b"_http_common",
    b"_http_incoming",
    b"_http_outgoing",
    b"_http_server",
    b"_stream_duplex",
    b"_stream_passthrough",
    b"_stream_readable",
    b"_stream_transform",
    b"_stream_wrap",
    b"_stream_writable",
    b"_tls_common",
    b"_tls_wrap",
    b"assert",
    b"async_hooks",
    // b"buffer",
    b"child_process",
    b"cluster",
    b"console",
    b"constants",
    b"crypto",
    b"dgram",
    b"diagnostics_channel",
    b"dns",
    b"domain",
    b"events",
    b"http",
    b"http2",
    b"https",
    b"inspector",
    b"module",
    b"net",
    b"os",
    // b"path",
    b"perf_hooks",
    // b"process",
    b"punycode",
    b"querystring",
    b"readline",
    b"repl",
    b"stream",
    b"string_decoder",
    b"sys",
    b"timers",
    b"tls",
    b"trace_events",
    b"tty",
    b"url",
    b"util",
    b"v8",
    b"vm",
    b"wasi",
    b"worker_threads",
    b"zlib",
];

pub static NODE_BUILTINS_MAP: phf::Set<&'static [u8]> = phf::phf_set! {
    b"_http_agent", b"_http_client", b"_http_common", b"_http_incoming", b"_http_outgoing",
    b"_http_server", b"_stream_duplex", b"_stream_passthrough", b"_stream_readable",
    b"_stream_transform", b"_stream_wrap", b"_stream_writable", b"_tls_common", b"_tls_wrap",
    b"assert", b"async_hooks", b"buffer", b"child_process", b"cluster", b"console", b"constants",
    b"crypto", b"dgram", b"diagnostics_channel", b"dns", b"domain", b"events", b"fs", b"http",
    b"http2", b"https", b"inspector", b"module", b"net", b"os", b"path", b"perf_hooks",
    b"process", b"punycode", b"querystring", b"readline", b"repl", b"stream", b"string_decoder",
    b"sys", b"timers", b"tls", b"trace_events", b"tty", b"url", b"util", b"v8", b"vm", b"wasi",
    b"worker_threads", b"zlib",
};

pub use bun_options_types::BundlePackage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleType {
    Unknown,
    Cjs,
    Esm,
}

// PORT NOTE: hoisted from `impl ModuleType` — Rust forbids `static` in inherent impls.
pub static MODULE_TYPE_LIST: phf::Map<&'static [u8], ModuleType> = phf::phf_map! {
    b"commonjs" => ModuleType::Cjs,
    b"module" => ModuleType::Esm,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Enum, enumset::EnumSetType, strum::IntoStaticStr)]
pub enum Target {
    Browser,
    Bun,
    BunMacro,
    Node,

    /// This is used by bake.Framework.ServerComponents.separate_ssr_graph
    BakeServerComponentsSsr,
}

// PORT NOTE: hoisted from `impl Target` — Rust forbids `static` in inherent impls.
pub static TARGET_MAP: phf::Map<&'static [u8], Target> = phf::phf_map! {
    b"browser" => Target::Browser,
    b"bun" => Target::Bun,
    b"bun_macro" => Target::BunMacro,
    b"macro" => Target::BunMacro,
    b"node" => Target::Node,
};

impl Target {
    // pub const fromJS — deleted: see PORTING.md "*_jsc alias" rule.
    // TODO(port): move to *_jsc — bun_bundler_jsc::options_jsc::target_from_js

    pub fn to_api(self) -> api::Target {
        match self {
            Target::Node => api::Target::Node,
            Target::Browser => api::Target::Browser,
            Target::Bun | Target::BakeServerComponentsSsr => api::Target::Bun,
            Target::BunMacro => api::Target::BunMacro,
        }
    }

    #[inline]
    pub fn is_server_side(self) -> bool {
        matches!(
            self,
            Target::BunMacro | Target::Node | Target::Bun | Target::BakeServerComponentsSsr
        )
    }

    #[inline]
    pub fn is_bun(self) -> bool {
        matches!(self, Target::BunMacro | Target::Bun | Target::BakeServerComponentsSsr)
    }

    #[inline]
    pub fn is_node(self) -> bool {
        matches!(self, Target::Node)
    }

    #[inline]
    pub fn process_browser_define_value(self) -> Option<&'static [u8]> {
        match self {
            Target::Browser => Some(b"true"),
            _ => Some(b"false"),
        }
    }

    pub fn bake_graph(self) -> crate::bake_types::Graph {
        // TODO(b0): bake::Graph arrives from move-in (TYPE_ONLY → bundler)
        match self {
            Target::Browser => crate::bake_types::Graph::Client,
            Target::BakeServerComponentsSsr => crate::bake_types::Graph::Ssr,
            Target::BunMacro | Target::Bun | Target::Node => crate::bake_types::Graph::Server,
        }
    }

    pub fn out_extensions(self) -> StringHashMap<&'static [u8]> {
        let mut exts = StringHashMap::<&'static [u8]>::default();

        const OUT_EXTENSIONS_LIST: &[&[u8]] =
            &[b".js", b".cjs", b".mts", b".cts", b".ts", b".tsx", b".jsx", b".json"];

        if self == Target::Node {
            exts.reserve(OUT_EXTENSIONS_LIST.len() * 2);
            for ext in OUT_EXTENSIONS_LIST {
                exts.insert(ext, b".mjs");
            }
        } else {
            exts.reserve(OUT_EXTENSIONS_LIST.len() + 1);
            exts.insert(b".mjs", b".js");
        }

        for ext in OUT_EXTENSIONS_LIST {
            exts.insert(ext, b".js");
        }

        exts
    }

    pub fn from(plat: Option<api::Target>) -> Target {
        match plat.unwrap_or(api::Target::None) {
            api::Target::Node => Target::Node,
            api::Target::Browser => Target::Browser,
            api::Target::Bun => Target::Bun,
            api::Target::BunMacro => Target::BunMacro,
            _ => Target::Browser,
        }
    }

    pub const MAIN_FIELD_NAMES: [&'static [u8]; 4] = [
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
    const DEFAULT_MAIN_FIELDS_NODE: &'static [&'static [u8]] =
        &[Self::MAIN_FIELD_NAMES[2], Self::MAIN_FIELD_NAMES[1]];

    // Note that this means if a package specifies "main", "module", and
    // "browser" then "browser" will win out over "module". This is the
    // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
    //
    // This is deliberate because the presence of the "browser" field is a
    // good signal that this should be preferred. Some older packages might only use CJS in their "browser"
    // but in such a case they probably don't have any ESM files anyway.
    const DEFAULT_MAIN_FIELDS_BROWSER: &'static [&'static [u8]] = &[
        Self::MAIN_FIELD_NAMES[0],
        Self::MAIN_FIELD_NAMES[1],
        Self::MAIN_FIELD_NAMES[3],
        Self::MAIN_FIELD_NAMES[2],
    ];
    const DEFAULT_MAIN_FIELDS_BUN: &'static [&'static [u8]] = &[
        Self::MAIN_FIELD_NAMES[1],
        Self::MAIN_FIELD_NAMES[2],
        Self::MAIN_FIELD_NAMES[3],
    ];

    // Original comment:
    // The neutral target is for people that don't want esbuild to try to
    // pick good defaults for their platform. In that case, the list of main
    // fields is empty by default. You must explicitly configure it yourself.
    // array.set(Target.neutral, &listc);
    pub fn default_main_fields() -> EnumMap<Target, &'static [&'static [u8]]> {
        enum_map::enum_map! {
            Target::Node => Self::DEFAULT_MAIN_FIELDS_NODE,
            Target::Browser => Self::DEFAULT_MAIN_FIELDS_BROWSER,
            Target::Bun => Self::DEFAULT_MAIN_FIELDS_BUN,
            Target::BunMacro => Self::DEFAULT_MAIN_FIELDS_BUN,
            Target::BakeServerComponentsSsr => Self::DEFAULT_MAIN_FIELDS_BUN,
        }
    }

    pub fn default_conditions_map() -> EnumMap<Target, &'static [&'static [u8]]> {
        enum_map::enum_map! {
            Target::Node => &[b"node" as &[u8]][..],
            Target::Browser => &[b"browser" as &[u8], b"module"][..],
            Target::Bun => &[b"bun" as &[u8], b"node"][..],
            Target::BakeServerComponentsSsr => &[b"bun" as &[u8], b"node"][..],
            Target::BunMacro => &[b"macro" as &[u8], b"bun", b"node"][..],
        }
    }

    pub fn default_conditions(self) -> &'static [&'static [u8]] {
        // TODO(port): Zig used a static EnumArray; we recompute via enum_map each call.
        // PERF(port): was comptime EnumArray — profile in Phase B
        Self::default_conditions_map()[self]
    }
}

pub use bun_options_types::Format;
pub use bun_options_types::WindowsOptions;

// The max integer value in this enum can only be appended to.
// It has dependencies in several places:
// - bun-native-bundler-plugin-api/bundler_plugin.h
// - src/jsc/bindings/headers-handwritten.h
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Enum, strum::IntoStaticStr)]
pub enum Loader {
    Jsx = 0,
    Js = 1,
    Ts = 2,
    Tsx = 3,
    Css = 4,
    File = 5,
    Json = 6,
    Jsonc = 7,
    Toml = 8,
    Wasm = 9,
    Napi = 10,
    Base64 = 11,
    Dataurl = 12,
    Text = 13,
    Bunsh = 14,
    Sqlite = 15,
    SqliteEmbedded = 16,
    Html = 17,
    Yaml = 18,
    Json5 = 19,
    Md = 20,
}

#[repr(transparent)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoaderOptional(u8);

impl LoaderOptional {
    pub const NONE: LoaderOptional = LoaderOptional(254);

    pub fn unwrap(self) -> Option<Loader> {
        if self.0 == 254 {
            None
        } else {
            // SAFETY: non-NONE values are constructed from valid Loader discriminants
            Some(unsafe { core::mem::transmute::<u8, Loader>(self.0) })
        }
    }

    pub fn from_api(loader: api::Loader) -> LoaderOptional {
        if loader == api::Loader::None {
            return LoaderOptional::NONE;
        }
        let l = Loader::from_api(loader);
        LoaderOptional(l as u8)
    }
}

// PORT NOTE: hoisted from `impl Loader` — Rust forbids `static` in inherent impls.
pub static LOADER_NAMES: phf::Map<&'static [u8], Loader> = phf::phf_map! {
    b"js" => Loader::Js,
    b"mjs" => Loader::Js,
    b"cjs" => Loader::Js,
    b"cts" => Loader::Ts,
    b"mts" => Loader::Ts,
    b"jsx" => Loader::Jsx,
    b"ts" => Loader::Ts,
    b"tsx" => Loader::Tsx,
    b"css" => Loader::Css,
    b"file" => Loader::File,
    b"json" => Loader::Json,
    b"jsonc" => Loader::Jsonc,
    b"toml" => Loader::Toml,
    b"yaml" => Loader::Yaml,
    b"json5" => Loader::Json5,
    b"wasm" => Loader::Wasm,
    b"napi" => Loader::Napi,
    b"node" => Loader::Napi,
    b"dataurl" => Loader::Dataurl,
    b"base64" => Loader::Base64,
    b"txt" => Loader::Text,
    b"text" => Loader::Text,
    b"sh" => Loader::Bunsh,
    b"sqlite" => Loader::Sqlite,
    b"sqlite_embedded" => Loader::SqliteEmbedded,
    b"html" => Loader::Html,
    b"md" => Loader::Md,
    b"markdown" => Loader::Md,
};

// PORT NOTE: hoisted from `impl Loader` — Rust forbids `static` in inherent impls.
pub static LOADER_API_NAMES: phf::Map<&'static [u8], api::Loader> = phf::phf_map! {
    b"js" => api::Loader::Js,
    b"mjs" => api::Loader::Js,
    b"cjs" => api::Loader::Js,
    b"cts" => api::Loader::Ts,
    b"mts" => api::Loader::Ts,
    b"jsx" => api::Loader::Jsx,
    b"ts" => api::Loader::Ts,
    b"tsx" => api::Loader::Tsx,
    b"css" => api::Loader::Css,
    b"file" => api::Loader::File,
    b"json" => api::Loader::Json,
    b"jsonc" => api::Loader::Json,
    b"toml" => api::Loader::Toml,
    b"yaml" => api::Loader::Yaml,
    b"json5" => api::Loader::Json5,
    b"wasm" => api::Loader::Wasm,
    b"node" => api::Loader::Napi,
    b"dataurl" => api::Loader::Dataurl,
    b"base64" => api::Loader::Base64,
    b"txt" => api::Loader::Text,
    b"text" => api::Loader::Text,
    b"sh" => api::Loader::File,
    b"sqlite" => api::Loader::Sqlite,
    b"html" => api::Loader::Html,
    b"md" => api::Loader::Md,
    b"markdown" => api::Loader::Md,
};

impl Loader {
    pub type Optional = LoaderOptional;

    pub fn is_css(self) -> bool {
        self == Loader::Css
    }

    pub fn is_js_like(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn disable_html(self) -> Loader {
        match self {
            Loader::Html => Loader::File,
            other => other,
        }
    }

    #[inline]
    pub fn is_sqlite(self) -> bool {
        matches!(self, Loader::Sqlite | Loader::SqliteEmbedded)
    }

    pub fn should_copy_for_bundling(self) -> bool {
        match self {
            Loader::File
            | Loader::Napi
            | Loader::Sqlite
            | Loader::SqliteEmbedded
            // TODO: loader for reading bytes and creating module or instance
            | Loader::Wasm => true,
            Loader::Css => false,
            Loader::Html => false,
            _ => false,
        }
    }

    pub fn handles_empty_file(self) -> bool {
        matches!(self, Loader::Wasm | Loader::File | Loader::Text)
    }

    pub fn to_mime_type(self, paths: &[&[u8]]) -> bun_http::MimeType {
        match self {
            Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx => bun_http::MimeType::JAVASCRIPT,
            Loader::Css => bun_http::MimeType::CSS,
            Loader::Toml | Loader::Yaml | Loader::Json | Loader::Jsonc | Loader::Json5 => {
                bun_http::MimeType::JSON
            }
            Loader::Wasm => bun_http::MimeType::WASM,
            Loader::Html | Loader::Md => bun_http::MimeType::HTML,
            _ => {
                for path in paths {
                    let mut extname = bun_paths::extension(path);
                    if strings::starts_with_char(extname, b'.') {
                        extname = &extname[1..];
                    }
                    if !extname.is_empty() {
                        if let Some(mime) = bun_http::MimeType::by_extension_no_default(extname) {
                            return mime;
                        }
                    }
                }

                bun_http::MimeType::OTHER
            }
        }
    }

    pub type HashTable = StringArrayHashMap<Loader>;

    pub fn can_have_source_map(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn can_be_run_by_bun(self) -> bool {
        matches!(
            self,
            Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx | Loader::Wasm | Loader::Bunsh
        )
    }

    pub type Map = EnumMap<Loader, &'static [u8]>;

    pub fn stdin_name_map() -> Self::Map {
        let mut map: Self::Map = EnumMap::from_array([b"" as &[u8]; 21]);
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

    #[inline]
    pub fn stdin_name(self) -> &'static [u8] {
        // PERF(port): was comptime EnumArray — profile in Phase B
        Self::stdin_name_map()[self]
    }

    // pub const fromJS — deleted: see PORTING.md "*_jsc alias" rule.
    // TODO(port): move to *_jsc — bun_bundler_jsc::options_jsc::loader_from_js

    pub fn from_string(slice_: &[u8]) -> Option<Loader> {
        let mut slice = slice_;
        if !slice.is_empty() && slice[0] == b'.' {
            slice = &slice[1..];
        }

        // TODO(port): phf custom hasher — Zig used getWithEql(.., eqlCaseInsensitiveASCIIICheckLength)
        LOADER_NAMES.get(slice).copied()
    }

    pub fn supports_client_entry_point(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn to_api(self) -> api::Loader {
        match self {
            Loader::Jsx => api::Loader::Jsx,
            Loader::Js => api::Loader::Js,
            Loader::Ts => api::Loader::Ts,
            Loader::Tsx => api::Loader::Tsx,
            Loader::Css => api::Loader::Css,
            Loader::Html => api::Loader::Html,
            Loader::File | Loader::Bunsh => api::Loader::File,
            Loader::Json => api::Loader::Json,
            Loader::Jsonc => api::Loader::Json,
            Loader::Toml => api::Loader::Toml,
            Loader::Yaml => api::Loader::Yaml,
            Loader::Json5 => api::Loader::Json5,
            Loader::Wasm => api::Loader::Wasm,
            Loader::Napi => api::Loader::Napi,
            Loader::Base64 => api::Loader::Base64,
            Loader::Dataurl => api::Loader::Dataurl,
            Loader::Text => api::Loader::Text,
            Loader::SqliteEmbedded | Loader::Sqlite => api::Loader::Sqlite,
            Loader::Md => api::Loader::Md,
        }
    }

    pub fn from_api(loader: api::Loader) -> Loader {
        match loader {
            api::Loader::None => Loader::File,
            api::Loader::Jsx => Loader::Jsx,
            api::Loader::Js => Loader::Js,
            api::Loader::Ts => Loader::Ts,
            api::Loader::Tsx => Loader::Tsx,
            api::Loader::Css => Loader::Css,
            api::Loader::File => Loader::File,
            api::Loader::Json => Loader::Json,
            api::Loader::Jsonc => Loader::Jsonc,
            api::Loader::Toml => Loader::Toml,
            api::Loader::Yaml => Loader::Yaml,
            api::Loader::Json5 => Loader::Json5,
            api::Loader::Wasm => Loader::Wasm,
            api::Loader::Napi => Loader::Napi,
            api::Loader::Base64 => Loader::Base64,
            api::Loader::Dataurl => Loader::Dataurl,
            api::Loader::Text => Loader::Text,
            api::Loader::Bunsh => Loader::Bunsh,
            api::Loader::Html => Loader::Html,
            api::Loader::Sqlite => Loader::Sqlite,
            api::Loader::SqliteEmbedded => Loader::SqliteEmbedded,
            api::Loader::Md => Loader::Md,
            _ => Loader::File,
        }
    }

    pub fn is_jsx(self) -> bool {
        self == Loader::Jsx || self == Loader::Tsx
    }

    pub fn is_type_script(self) -> bool {
        self == Loader::Tsx || self == Loader::Ts
    }

    pub fn is_java_script_like(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn is_java_script_like_or_json(self) -> bool {
        match self {
            Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx | Loader::Json | Loader::Jsonc => {
                true
            }
            // toml, yaml, and json5 are included because we can serialize to the same AST as JSON
            Loader::Toml | Loader::Yaml | Loader::Json5 => true,
            _ => false,
        }
    }

    pub fn for_file_name<M>(filename: &[u8], obj: &M) -> Option<Loader>
    where
        // TODO(port): `obj: anytype` — needs `.get(ext) -> Option<Loader>` method
        M: bun_collections::MapLike<Key = [u8], Value = Loader>,
    {
        let ext = bun_paths::extension(filename);
        if ext.is_empty() || (ext.len() == 1 && ext[0] == b'.') {
            return None;
        }

        obj.get(ext)
    }

    pub fn side_effects(self) -> bun_options_types::SideEffects {
        match self {
            Loader::Text
            | Loader::Json
            | Loader::Jsonc
            | Loader::Toml
            | Loader::Yaml
            | Loader::Json5
            | Loader::File
            | Loader::Md => bun_options_types::SideEffects::NoSideEffectsPureData,
            _ => bun_options_types::SideEffects::HasSideEffects,
        }
    }

    pub fn from_mime_type(mime_type: bun_http::MimeType) -> Loader {
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
        } else if mime_type.category == bun_http::MimeType::Category::Text {
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

// PERF(port): was inline field access on jsc::VirtualMachine
pub struct VmLoaderVTable {
    pub origin_host: unsafe fn(*const ()) -> &'static [u8],
    pub origin_path: unsafe fn(*const ()) -> &'static [u8],
    pub loaders: unsafe fn(*const ()) -> *const StringArrayHashMap<Loader>,
    pub eval_source: unsafe fn(*const ()) -> Option<*const logger::Source>,
    pub main: unsafe fn(*const ()) -> &'static [u8],
    pub read_dir_info_package_json: unsafe fn(*const (), &[u8]) -> Option<*const PackageJSON>,
    pub is_blob_url: unsafe fn(&[u8]) -> bool,
    pub resolve_blob: unsafe fn(&[u8]) -> Option<OpaqueBlob>,
    pub blob_loader: unsafe fn(OpaqueBlob, *const ()) -> Option<Loader>,
    pub blob_file_name: unsafe fn(OpaqueBlob) -> Option<&'static [u8]>,
    pub blob_needs_read_file: unsafe fn(OpaqueBlob) -> bool,
    pub blob_shared_view: unsafe fn(OpaqueBlob) -> &'static [u8],
    pub blob_deinit: unsafe fn(OpaqueBlob),
}

pub struct VmLoaderCtx {
    pub vm: *const (), // SAFETY: erased jsc::VirtualMachine
    pub vtable: &'static VmLoaderVTable,
}

// TODO(b0-genuine): bun_jsc::VirtualMachine — body still references VM fields
// directly; rewrite to go through `VmLoaderCtx` once runtime registers vtable.
pub fn normalize_specifier<'a>(
    jsc_vm: &VmLoaderCtx,
    slice_: &'a [u8],
) -> (&'a [u8], &'a [u8], &'a [u8]) {
    let mut slice = slice_;
    if slice.is_empty() {
        return (slice, slice, b"");
    }

    // SAFETY: vtable returns borrows tied to jsc_vm.vm lifetime
    let host = unsafe { (jsc_vm.vtable.origin_host)(jsc_vm.vm) };
    let opath = unsafe { (jsc_vm.vtable.origin_path)(jsc_vm.vm) };
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
    pub virtual_source: Option<&'a logger::Source>,
    pub path: Fs::Path,
    pub is_main: bool,
    pub specifier: &'a [u8],
    /// NOTE: This is always `null` for non-js-like loaders since it's not
    /// needed for them.
    pub package_json: Option<&'a PackageJSON>,
}

pub fn get_loader_and_virtual_source<'a>(
    specifier_str: &'a [u8],
    jsc_vm: &'a VmLoaderCtx,
    virtual_source_to_use: &'a mut Option<logger::Source>,
    blob_to_deinit: &mut Option<OpaqueBlob>,
    type_attribute_str: Option<&[u8]>,
) -> Result<LoaderResult<'a>, GetLoaderAndVirtualSourceErr> {
    let vt = jsc_vm.vtable;
    let (normalized_file_path_from_specifier, specifier, query) =
        normalize_specifier(jsc_vm, specifier_str);
    let mut path = Fs::Path::init(normalized_file_path_from_specifier);

    // SAFETY: vt.loaders returns a borrow tied to jsc_vm.vm
    let mut loader: Option<Loader> = path.loader(unsafe { &*(vt.loaders)(jsc_vm.vm) });
    let mut virtual_source: Option<&'a logger::Source> = None;

    if let Some(eval_source) = unsafe { (vt.eval_source)(jsc_vm.vm) } {
        // SAFETY: eval_source outlives jsc_vm
        let eval_source: &'a logger::Source = unsafe { &*eval_source };
        if strings::ends_with(specifier, bun_paths::path_literal!("/[eval]")) {
            virtual_source = Some(eval_source);
            loader = Some(Loader::Tsx);
        }
        if strings::ends_with(specifier, bun_paths::path_literal!("/[stdin]")) {
            virtual_source = Some(eval_source);
            loader = Some(Loader::Tsx);
        }
    }

    if unsafe { (vt.is_blob_url)(specifier) } {
        if let Some(blob) = unsafe { (vt.resolve_blob)(&specifier[b"blob:".len()..]) } {
            *blob_to_deinit = Some(blob);
            loader = unsafe { (vt.blob_loader)(blob, jsc_vm.vm) };

            // "file:" loader makes no sense for blobs
            // so let's default to tsx.
            if let Some(filename) = unsafe { (vt.blob_file_name)(blob) } {
                let current_path = Fs::Path::init(filename);

                // Only treat it as a file if is a Bun.file()
                if unsafe { (vt.blob_needs_read_file)(blob) } {
                    path = current_path;
                }
            }

            if !unsafe { (vt.blob_needs_read_file)(blob) } {
                *virtual_source_to_use = Some(logger::Source {
                    path: path.clone(),
                    contents: unsafe { (vt.blob_shared_view)(blob) },
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

    let is_main = strings::eql_long(specifier, unsafe { (vt.main)(jsc_vm.vm) }, true);

    let dir = path.name.dir.as_ref();
    // NOTE: we cannot trust `path.isFile()` since it's not always correct
    // NOTE: assume we may need a package.json when no loader is specified
    let is_js_like = loader.map(|l| l.is_js_like()).unwrap_or(true);
    let package_json: Option<&PackageJSON> = if is_js_like && bun_paths::is_absolute(dir) {
        unsafe { (vt.read_dir_info_package_json)(jsc_vm.vm, dir).map(|p| &*p) }
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

// TODO(port): Zig concatenated tuples at comptime; in Rust we expose a function or two slices.
#[cfg(windows)]
pub static DEFAULT_LOADERS: phf::Map<&'static [u8], Loader> = phf::phf_map! {
    b".jsx" => Loader::Jsx, b".json" => Loader::Json, b".js" => Loader::Jsx,
    b".mjs" => Loader::Js, b".cjs" => Loader::Js, b".css" => Loader::Css,
    b".ts" => Loader::Ts, b".tsx" => Loader::Tsx, b".mts" => Loader::Ts,
    b".cts" => Loader::Ts, b".toml" => Loader::Toml, b".yaml" => Loader::Yaml,
    b".yml" => Loader::Yaml, b".wasm" => Loader::Wasm, b".node" => Loader::Napi,
    b".txt" => Loader::Text, b".text" => Loader::Text, b".html" => Loader::Html,
    b".jsonc" => Loader::Jsonc, b".json5" => Loader::Json5, b".md" => Loader::Md,
    b".markdown" => Loader::Md, b".sh" => Loader::Bunsh,
};

#[cfg(not(windows))]
pub static DEFAULT_LOADERS: phf::Map<&'static [u8], Loader> = phf::phf_map! {
    b".jsx" => Loader::Jsx, b".json" => Loader::Json, b".js" => Loader::Jsx,
    b".mjs" => Loader::Js, b".cjs" => Loader::Js, b".css" => Loader::Css,
    b".ts" => Loader::Ts, b".tsx" => Loader::Tsx, b".mts" => Loader::Ts,
    b".cts" => Loader::Ts, b".toml" => Loader::Toml, b".yaml" => Loader::Yaml,
    b".yml" => Loader::Yaml, b".wasm" => Loader::Wasm, b".node" => Loader::Napi,
    b".txt" => Loader::Text, b".text" => Loader::Text, b".html" => Loader::Html,
    b".jsonc" => Loader::Jsonc, b".json5" => Loader::Json5, b".md" => Loader::Md,
    b".markdown" => Loader::Md,
};

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
        let default = self.default.clone();
        let import = self.import.clone();
        let require = self.require.clone();
        let style = self.style.clone();

        Ok(ESMConditions { default, import, require, style })
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

pub mod jsx {
    use super::*;

    pub use api::JsxRuntime as Runtime;

    #[derive(Debug, Clone, Copy)]
    pub struct RuntimeDevelopmentPair {
        pub runtime: Runtime,
        pub development: Option<bool>,
    }

    pub static RUNTIME_MAP: phf::Map<&'static [u8], RuntimeDevelopmentPair> = phf::phf_map! {
        b"classic" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
        b"automatic" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
        b"react" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
        b"react-jsx" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
        b"react-jsxdev" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
    };

    #[derive(Debug, Clone)]
    pub struct Pragma {
        // these need to be arrays
        pub factory: &'static [&'static [u8]], // TODO(port): may be heap-allocated; see member_list_to_components_if_different
        pub fragment: &'static [&'static [u8]],
        pub runtime: Runtime,
        pub import_source: ImportSource,

        /// Facilitates automatic JSX importing
        /// Set on a per file basis like this:
        /// /** @jsxImportSource @emotion/core */
        pub classic_import_source: Box<[u8]>,
        pub package_name: Box<[u8]>,

        /// Configuration Priority:
        /// - `--define=process.env.NODE_ENV=...`
        /// - `NODE_ENV=...`
        /// - tsconfig.json's `compilerOptions.jsx` (`react-jsx` or `react-jsxdev`)
        pub development: bool,
        pub parse: bool,
        pub side_effects: bool,
    }

    #[derive(Debug, Clone)]
    pub struct ImportSource {
        pub development: Box<[u8]>,
        pub production: Box<[u8]>,
    }

    impl Default for ImportSource {
        fn default() -> Self {
            ImportSource {
                development: Box::from(b"react/jsx-dev-runtime".as_slice()),
                production: Box::from(b"react/jsx-runtime".as_slice()),
            }
        }
    }

    impl Default for Pragma {
        fn default() -> Self {
            Pragma {
                factory: defaults::FACTORY,
                fragment: defaults::FRAGMENT,
                runtime: Runtime::Automatic,
                import_source: ImportSource::default(),
                classic_import_source: Box::from(b"react".as_slice()),
                package_name: Box::from(b"react".as_slice()),
                development: true,
                parse: true,
                side_effects: false,
            }
        }
    }

    impl Pragma {
        pub fn hash_for_runtime_transpiler(&self, hasher: &mut bun_wyhash::Wyhash) {
            for factory in self.factory {
                hasher.update(factory);
            }
            for fragment in self.fragment {
                hasher.update(fragment);
            }
            hasher.update(&self.import_source.development);
            hasher.update(&self.import_source.production);
            hasher.update(&self.classic_import_source);
            hasher.update(&self.package_name);
        }

        pub fn import_source(&self) -> &[u8] {
            if self.development {
                &self.import_source.development
            } else {
                &self.import_source.production
            }
        }

        pub fn parse_package_name(str: &[u8]) -> &[u8] {
            if str.is_empty() {
                return str;
            }
            if str[0] == b'@' {
                if let Some(first_slash) = strings::index_of_char(&str[1..], b'/') {
                    let first_slash = first_slash as usize;
                    let remainder = &str[1 + first_slash + 1..];

                    if let Some(last_slash) = strings::index_of_char(remainder, b'/') {
                        let last_slash = last_slash as usize;
                        return &str[0..first_slash + 1 + last_slash + 1];
                    }
                }
            }

            if let Some(first_slash) = strings::index_of_char(str, b'/') {
                return &str[0..first_slash as usize];
            }

            str
        }

        pub fn is_react_like(&self) -> bool {
            &*self.package_name == b"react"
                || &*self.package_name == b"@emotion/jsx"
                || &*self.package_name == b"@emotion/react"
        }

        pub fn set_import_source(&mut self) {
            strings::concat_if_needed(
                &mut self.import_source.development,
                &[&self.package_name, b"/jsx-dev-runtime"],
                &[defaults::IMPORT_SOURCE_DEV],
            )
            .expect("unreachable");

            strings::concat_if_needed(
                &mut self.import_source.production,
                &[&self.package_name, b"/jsx-runtime"],
                &[defaults::IMPORT_SOURCE],
            )
            .expect("unreachable");
        }

        pub fn set_production(&mut self, is_production: bool) {
            self.development = !is_production;
        }

        // "React.createElement" => ["React", "createElement"]
        // ...unless new is "React.createElement" and original is ["React", "createElement"]
        // saves an allocation for the majority case
        pub fn member_list_to_components_if_different(
            original: &'static [&'static [u8]],
            new: &[u8],
        ) -> Result<&'static [&'static [u8]], bun_core::Error> {
            // TODO(port): return type — Zig returns []const string which may be either the
            // original &'static slice OR a freshly allocated slice. Rust cannot express this
            // without Cow or leaking. Phase B: change Pragma.factory/fragment to Box<[Box<[u8]>]>.
            let count = strings::count_char(new, b'.') + 1;

            let mut needs_alloc = false;
            let mut current_i: usize = 0;
            for str in new.split(|b| *b == b'.') {
                if str.is_empty() {
                    continue;
                }
                if current_i >= original.len() {
                    needs_alloc = true;
                    break;
                }

                if original[current_i] != str {
                    needs_alloc = true;
                    break;
                }
                current_i += 1;
            }

            if !needs_alloc {
                return Ok(original);
            }

            // TODO(port): allocates Box<[&[u8]]> borrowing `new`; lifetime mismatch with return type.
            let mut out: Vec<&[u8]> = Vec::with_capacity(count);
            for str in new.split(|b| *b == b'.') {
                if str.is_empty() {
                    continue;
                }
                out.push(str);
            }
            // TODO(port): leaking to satisfy &'static; Phase B should restructure ownership.
            Ok(Box::leak(out.into_boxed_slice()))
        }

        pub fn from_api(jsx: api::Jsx) -> Result<Pragma, bun_core::Error> {
            let mut pragma = Pragma::default();

            if !jsx.fragment.is_empty() {
                pragma.fragment =
                    Self::member_list_to_components_if_different(pragma.fragment, &jsx.fragment)?;
            }

            if !jsx.factory.is_empty() {
                pragma.factory =
                    Self::member_list_to_components_if_different(pragma.factory, &jsx.factory)?;
            }

            pragma.runtime = jsx.runtime;
            pragma.side_effects = jsx.side_effects;

            if !jsx.import_source.is_empty() {
                pragma.package_name = jsx.import_source.clone();
                pragma.set_import_source();
                pragma.classic_import_source = pragma.package_name.clone();
            }

            pragma.development = jsx.development;
            pragma.parse = true;
            Ok(pragma)
        }
    }

    pub mod defaults {
        pub const FACTORY: &[&[u8]] = &[b"React", b"createElement"];
        pub const FRAGMENT: &[&[u8]] = &[b"React", b"Fragment"];
        pub const IMPORT_SOURCE_DEV: &[u8] = b"react/jsx-dev-runtime";
        pub const IMPORT_SOURCE: &[u8] = b"react/jsx-runtime";
        pub const JSX_FUNCTION: &[u8] = b"jsx";
        pub const JSX_STATIC_FUNCTION: &[u8] = b"jsxs";
        pub const JSX_FUNCTION_DEV: &[u8] = b"jsxDEV";
    }
}

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
    log: &mut logger::Log,
    maybe_input_define: Option<api::StringMap>,
    target: Target,
    env_loader: Option<&mut DotEnv::Loader>,
    framework_env: Option<&Env>,
    node_env: Option<&[u8]>,
    drop: &[&[u8]],
    omit_unused_global_calls: bool,
) -> Result<Box<defines::Define>, bun_core::Error> {
    let input_user_define = maybe_input_define.unwrap_or_default();

    // TODO(port): string_hash_map_from_arrays is generic stub; replace with concrete RawDefines builder
    let mut user_defines: defines::RawDefines = defines::RawDefines::default();
    user_defines.reserve(input_user_define.keys.len() + 4);
    for (i, key) in input_user_define.keys.iter().enumerate() {
        // PERF(port): was assume_capacity
        user_defines.insert(key.clone(), input_user_define.values[i].clone());
    }

    let mut environment_defines = defines::UserDefinesArray::default();

    let mut behavior = api::DotEnvBehavior::Disable;

    'load_env: {
        let Some(env) = env_loader else { break 'load_env };
        let Some(framework) = framework_env else { break 'load_env };

        if cfg!(debug_assertions) {
            debug_assert!(framework.behavior != api::DotEnvBehavior::None);
        }

        behavior = framework.behavior;
        if behavior == api::DotEnvBehavior::LoadAllWithoutInlining
            || behavior == api::DotEnvBehavior::Disable
        {
            break 'load_env;
        }

        env.copy_for_define(
            &mut user_defines,
            &mut environment_defines,
            framework.to_api().defaults,
            framework.behavior,
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
                        use std::io::Write;
                        let mut v = Vec::new();
                        write!(&mut v, "\"{}\"", bstr::BStr::new(node_env)).unwrap();
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
            user_defines
                .get_or_put_value(default_user_defines::process_browser_define::KEY, Box::from(value))?;
        }
    }

    if target.is_bun() {
        if !user_defines.contains(b"window") {
            environment_defines.get_or_put_value(
                b"window",
                defines::DefineData::init(defines::DefineDataInit {
                    valueless: true,
                    original_name: b"window".into(),
                    value: defines::DefineValue::EUndefined(Default::default()),
                }),
            )?;
        }
    }

    let resolved_defines = defines::DefineData::from_input(user_defines, drop, log)?;

    let drop_debugger = drop.iter().any(|item| *item == b"debugger");

    defines::Define::init(
        resolved_defines,
        environment_defines,
        drop_debugger,
        omit_unused_global_calls,
    )
}

const DEFAULT_LOADER_EXT_BUN: &[&[u8]] = &[b".node", b".html"];
const DEFAULT_LOADER_EXT: &[&[u8]] = &[
    b".jsx", b".json",
    b".js", b".mjs",
    b".cjs", b".css",
    // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/#new-file-extensions
    b".ts", b".tsx",
    b".mts", b".cts",
    b".toml", b".yaml",
    b".yml", b".wasm",
    b".txt", b".text",
    b".jsonc", b".json5",
];

// Only set it for browsers by default.
const DEFAULT_LOADER_EXT_BROWSER: &[&[u8]] = &[b".html"];

const NODE_MODULES_DEFAULT_LOADER_EXT: &[&[u8]] = &[
    b".jsx",
    b".js",
    b".cjs",
    b".mjs",
    b".ts",
    b".mts",
    b".toml",
    b".yaml",
    b".yml",
    b".txt",
    b".json",
    b".jsonc",
    b".json5",
    b".css",
    b".tsx",
    b".cts",
    b".wasm",
    b".text",
    b".html",
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
                esm: bundle_options_defaults::node_modules::MODULE_EXTENSION_ORDER,
                default: bundle_options_defaults::node_modules::EXTENSION_ORDER,
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

    pub fn kind(&self, kind_: bun_options_types::ImportKind, is_node_modules: bool) -> &[&[u8]] {
        use bun_options_types::ImportKind;
        match kind_ {
            ImportKind::Stmt
            | ImportKind::EntryPointBuild
            | ImportKind::EntryPointRun
            | ImportKind::Dynamic => self.group(is_node_modules).esm,
            _ => self.group(is_node_modules).default,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolveFileExtensionsGroup {
    pub esm: &'static [&'static [u8]],
    pub default: &'static [&'static [u8]],
}

impl Default for ResolveFileExtensionsGroup {
    fn default() -> Self {
        ResolveFileExtensionsGroup {
            esm: bundle_options_defaults::MODULE_EXTENSION_ORDER,
            default: bundle_options_defaults::EXTENSION_ORDER,
        }
    }
}

pub fn loaders_from_transform_options(
    _loaders: Option<api::LoaderMap>,
    target: Target,
) -> Result<StringArrayHashMap<Loader>, bun_alloc::AllocError> {
    let input_loaders = _loaders.unwrap_or_default();
    let mut loader_values: Vec<Loader> = Vec::with_capacity(input_loaders.loaders.len());

    for input in &input_loaders.loaders {
        loader_values.push(Loader::from_api(*input));
    }

    let total_capacity = input_loaders.extensions.len()
        + if target.is_bun() { DEFAULT_LOADER_EXT_BUN.len() } else { 0 }
        + if target == Target::Browser { DEFAULT_LOADER_EXT_BROWSER.len() } else { 0 }
        + DEFAULT_LOADER_EXT.len();

    let mut loaders = StringArrayHashMap::<Loader>::default();
    loaders.reserve(u32::try_from(total_capacity).unwrap() as usize);
    for (i, ext) in input_loaders.extensions.iter().enumerate() {
        // PERF(port): was assume_capacity
        loaders.insert(ext.clone(), loader_values[i]);
    }

    for ext in DEFAULT_LOADER_EXT {
        loaders.get_or_put_value(*ext, *DEFAULT_LOADERS.get(*ext).unwrap());
    }

    if target.is_bun() {
        for ext in DEFAULT_LOADER_EXT_BUN {
            loaders.get_or_put_value(*ext, *DEFAULT_LOADERS.get(*ext).unwrap());
        }
    }

    if target == Target::Browser {
        for ext in DEFAULT_LOADER_EXT_BROWSER {
            loaders.get_or_put_value(*ext, *DEFAULT_LOADERS.get(*ext).unwrap());
        }
    }

    Ok(loaders)
}

// TODO(port): std.fs.Dir — replace with bun_sys::Dir / Fd in Phase B
type Dir = bun_sys::Dir;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceMapOption {
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
            _ => PackagesOption::Bundle,
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
    pub footer: &'static [u8],
    pub banner: &'static [u8],
    pub define: Box<defines::Define>,
    pub drop: Box<[Box<[u8]>]>,
    /// Set of enabled feature flags for dead-code elimination via `import { feature } from "bun:bundle"`.
    /// Initialized once from the CLI --feature flags.
    pub bundler_feature_flags: Box<bun_core::StringSet>,
    pub loaders: Loader::HashTable,
    pub resolve_dir: &'static [u8],
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
    pub origin: URL,
    pub output_dir_handle: Option<Dir>,

    pub output_dir: Box<[u8]>,
    pub root_dir: Box<[u8]>,
    pub node_modules_bundle_url: &'static [u8],
    pub node_modules_bundle_pretty_path: &'static [u8],

    pub write: bool,
    pub preserve_symlinks: bool,
    pub preserve_extensions: bool,
    pub production: bool,

    // only used by bundle_v2
    pub output_format: Format,

    pub append_package_version_in_query_string: bool,

    pub tsconfig_override: Option<Box<[u8]>>,
    pub target: Target,
    pub main_fields: &'static [&'static [u8]],
    /// TODO: remove this in favor accessing bundler.log
    pub log: &'a mut logger::Log,
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
    pub transform_options: api::TransformOptions,
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
    pub install: Option<&'a api::BunInstall>,

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
    pub optimize_imports: Option<&'a bun_core::StringSet>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForceNodeEnv {
    Unspecified,
    Development,
    Production,
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

    pub fn load_defines(
        &mut self,
        loader_: Option<&mut DotEnv::Loader>,
        env: Option<&Env>,
    ) -> Result<(), bun_core::Error> {
        if self.defines_loaded {
            return Ok(());
        }
        let node_env: Option<Box<[u8]>> = 'node_env: {
            if let Some(e) = loader_.as_deref() {
                if let Some(env_) = e.map.get(b"BUN_ENV").or_else(|| e.map.get(b"NODE_ENV")) {
                    break 'node_env Some(Box::from(env_));
                }
            }

            if self.is_test() {
                break 'node_env Some(Box::from(b"\"test\"".as_slice()));
            }

            if self.production {
                break 'node_env Some(Box::from(b"\"production\"".as_slice()));
            }

            Some(Box::from(b"\"development\"".as_slice()))
        };
        // PORT NOTE: reshaped for borrowck — node_env computed before passing self.log
        self.define = defines_from_transform_options(
            self.log,
            self.transform_options.define.clone(),
            self.target,
            loader_,
            env,
            node_env.as_deref(),
            // TODO(port): &self.drop is Box<[Box<[u8]>]>, callee wants &[&[u8]]
            &self.drop.iter().map(|s| s.as_ref()).collect::<Vec<_>>(),
            self.dead_code_elimination && self.minify_syntax,
        )?;
        self.defines_loaded = true;
        Ok(())
    }

    pub fn loader(&self, ext: &[u8]) -> Loader {
        self.loaders.get(ext).copied().unwrap_or(Loader::File)
    }

    pub fn from_api(
        fs: &mut Fs::FileSystem,
        log: &'a mut logger::Log,
        transform: api::TransformOptions,
    ) -> Result<BundleOptions<'a>, bun_core::Error> {
        let target = Target::from(transform.target);
        let loaders = loaders_from_transform_options(transform.loaders.clone(), target)?;
        let bundler_feature_flags =
            Runtime::Features::init_bundler_feature_flags(&transform.feature_flags);

        // TODO(port): many fields below have Zig defaults via `= ...`; in Rust we initialize
        // each explicitly. Phase B: add a `Default`-ish builder.
        let mut opts = BundleOptions {
            footer: b"",
            banner: b"",
            log,
            // TODO(port): define is initialized as undefined in Zig and filled by loadDefines later.
            define: defines::Define::empty(),
            loaders,
            output_dir: Box::from(transform.output_dir.as_deref().unwrap_or(b"out")),
            target,
            write: transform.write.unwrap_or(false),
            external: ExternalModules {
                node_modules: Default::default(),
                abs_paths: Default::default(),
                patterns: Box::default(),
            }, // filled below
            entry_points: transform.entry_points.clone(),
            out_extensions: StringHashMap::default(), // filled below
            env: Env::init(),
            transform_options: transform.clone(),
            css_chunking: false,
            drop: transform.drop.clone(),
            bundler_feature_flags,

            resolve_dir: b"/",
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
            origin: URL::default(),
            output_dir_handle: None,
            root_dir: Box::default(),
            node_modules_bundle_url: b"",
            node_modules_bundle_pretty_path: b"",
            preserve_symlinks: false,
            preserve_extensions: false,
            production: false,
            output_format: Format::Esm,
            append_package_version_in_query_string: false,
            tsconfig_override: None,
            main_fields: Target::default_main_fields()[Target::Browser],
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
            global_cache: GlobalCache::Disable,
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

        analytics::Features::DEFINE.add(usize::from(transform.define.is_some()));
        analytics::Features::LOADERS.add(usize::from(transform.loaders.is_some()));

        opts.serve_plugins = transform.serve_plugins.clone();
        opts.bunfig_path = transform.bunfig_path.clone();

        if !transform.env_files.is_empty() {
            opts.env.files = transform.env_files.clone();
        }

        opts.env.disable_default_env_files = transform.disable_default_env_files;

        if let Some(origin) = &transform.origin {
            opts.origin = URL::parse(origin);
        }

        if let Some(jsx_opts) = &transform.jsx {
            opts.jsx = jsx::Pragma::from_api(jsx_opts.clone())?;
        }

        if !transform.extension_order.is_empty() {
            // TODO(port): extension_order.default.default expects &'static [&'static [u8]]; transform value is owned.
            // Phase B: change ResolveFileExtensionsGroup fields to Cow / Box.
            opts.extension_order.default.default =
                Box::leak(transform.extension_order.clone().into_boxed_slice());
        }

        if let Some(t) = transform.target {
            opts.target = Target::from(Some(t));
            opts.main_fields = Target::default_main_fields()[opts.target];
        }

        {
            // conditions:
            // 1. defaults
            // 2. node-addons
            // 3. user conditions
            opts.conditions = ESMConditions::init(
                opts.target.default_conditions(),
                transform.allow_addons.unwrap_or(true),
                &transform
                    .conditions
                    .iter()
                    .map(|s| s.as_ref())
                    .collect::<Vec<_>>(),
            )?;
        }

        match opts.target {
            Target::Node => {
                opts.import_path_format = ImportPathFormat::Relative;
                opts.allow_runtime = false;
            }
            Target::Bun => {
                opts.import_path_format = if opts.import_path_format == ImportPathFormat::AbsoluteUrl {
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
                    opts.extension_order.default.default = EXT_WITH_NODE;
                    opts.extension_order.node_modules.default = NM_EXT_WITH_NODE;
                }
            }
            _ => {}
        }

        if !transform.main_fields.is_empty() {
            // TODO(port): same lifetime issue as extension_order
            opts.main_fields = Box::leak(transform.main_fields.clone().into_boxed_slice());
        }

        // PORT NOTE: reshaped for borrowck — pass opts.log via raw mutable borrow
        opts.external = ExternalModules::init(
            &mut fs.fs,
            &fs.top_level_dir,
            &transform.external.iter().map(|s| s.as_ref()).collect::<Vec<_>>(),
            opts.log,
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

        if opts.origin.is_absolute() {
            opts.import_path_format = ImportPathFormat::AbsoluteUrl;
        }

        if opts.write && !opts.output_dir.is_empty() {
            opts.output_dir_handle = Some(open_output_dir(&opts.output_dir)?);
            opts.output_dir =
                fs.get_fd_path(bun_sys::Fd::from_std_dir(opts.output_dir_handle.as_ref().unwrap()))?;
        }

        opts.polyfill_node_globals = opts.target == Target::Browser;

        if let Some(tsconfig) = &transform.tsconfig_override {
            opts.tsconfig_override = Some(tsconfig.clone());
        }

        analytics::Features::MACROS.add(usize::from(opts.target == Target::BunMacro));
        analytics::Features::EXTERNAL.add(usize::from(!transform.external.is_empty()));
        Ok(opts)
    }
}

impl Drop for BundleOptions<'_> {
    fn drop(&mut self) {
        // self.define dropped automatically (Box<Define>)
        // Free bundler_feature_flags if it was allocated (not the static empty set)
        // TODO(port): Zig compared pointer to &Runtime.Features.empty_bundler_feature_flags;
        // in Rust the field is always Box-owned, so Drop handles it. If Phase B keeps a
        // shared static sentinel, switch to Option<Box<StringSet>> or Cow.
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

    pub const MAIN_FIELD_EXTENSION_ORDER: &[&[u8]] = &[
        b".js", b".cjs", b".cts", b".tsx", b".ts", b".jsx", b".json",
    ];

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
    // TODO(port): std.fs.cwd().openDir / makeDir — replace with bun_sys equivalents in Phase B
    match bun_sys::cwd().open_dir(output_dir, Default::default()) {
        Ok(d) => Ok(d),
        Err(_) => {
            if let Err(err) = bun_sys::cwd().make_dir(output_dir) {
                Output::print_errorln(format_args!(
                    "error: Unable to mkdir \"{}\": \"{}\"",
                    bstr::BStr::new(output_dir),
                    err.name(),
                ));
                Global::crash();
            }

            match bun_sys::cwd().open_dir(output_dir, Default::default()) {
                Ok(handle) => Ok(handle),
                Err(err2) => {
                    Output::print_errorln(format_args!(
                        "error: Unable to open \"{}\": \"{}\"",
                        bstr::BStr::new(output_dir),
                        err2.name(),
                    ));
                    Global::crash();
                }
            }
        }
    }
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
    pub entry_point: Fs::File,
    pub resolve_paths: bool,
    pub tsconfig_override: Option<Box<[u8]>>,

    pub target: Target,
    pub main_fields: &'static [&'static [u8]],
}

impl TransformOptions {
    pub fn init_uncached(entry_point_name: &[u8], code: &[u8]) -> Result<TransformOptions, bun_core::Error> {
        debug_assert!(!entry_point_name.is_empty());

        let entry_point = Fs::File {
            path: Fs::Path::init(entry_point_name),
            contents: Box::from(code),
        };

        let mut _cwd: Box<[u8]> = Box::from(b"/".as_slice());
        // TODO(port): Environment.isWasi
        #[cfg(any(target_os = "wasi", windows))]
        {
            _cwd = bun_sys::getcwd_alloc()?;
        }

        let mut define = StringHashMap::<Box<[u8]>>::default();
        define.reserve(1);
        // PERF(port): was assume_capacity
        define.insert(b"process.env.NODE_ENV".as_slice().into(), b"development".as_slice().into());

        let mut loader = Loader::File;
        if let Some(default_loader) = DEFAULT_LOADERS.get(entry_point.path.name.ext.as_ref()) {
            loader = *default_loader;
        }
        debug_assert!(!code.is_empty());

        Ok(TransformOptions {
            footer: b"",
            banner: b"",
            entry_point,
            define,
            loader,
            resolve_dir: entry_point.path.name.dir.clone(),
            // TODO(port): resolve_dir borrows from entry_point in Zig; cloned here
            main_fields: Target::default_main_fields()[Target::Browser],
            jsx: if loader.is_jsx() { Some(jsx::Pragma::default()) } else { None },
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

pub struct TransformResult {
    pub errors: Box<[logger::Msg]>,
    pub warnings: Box<[logger::Msg]>,
    pub output_files: Box<[OutputFile]>,
    pub outbase: Box<[u8]>,
    pub root_dir: Option<Dir>,
}

impl TransformResult {
    pub fn init(
        outbase: Box<[u8]>,
        output_files: Box<[OutputFile]>,
        log: &mut logger::Log,
    ) -> Result<TransformResult, bun_core::Error> {
        let mut errors: Vec<logger::Msg> = Vec::with_capacity(log.errors);
        let mut warnings: Vec<logger::Msg> = Vec::with_capacity(log.warnings);
        for msg in log.msgs.iter() {
            match msg.kind {
                logger::Kind::Err => {
                    errors.push(msg.clone());
                }
                logger::Kind::Warn => {
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

#[derive(Debug)]
pub struct Env {
    pub behavior: api::DotEnvBehavior,
    pub prefix: Box<[u8]>,
    pub defaults: EnvList,
    // allocator: dropped (global mimalloc)

    /// List of explicit env files to load (e..g specified by --env-file args)
    pub files: Box<[Box<[u8]>]>,

    /// If true, disable loading of default .env files (from --no-env-file flag or bunfig)
    pub disable_default_env_files: bool,
}

impl Default for Env {
    fn default() -> Self {
        Env {
            behavior: api::DotEnvBehavior::Disable,
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
            behavior: api::DotEnvBehavior::Disable,
            files: Box::default(),
            disable_default_env_files: false,
        }
    }

    pub fn ensure_total_capacity(&mut self, capacity: u64) -> Result<(), bun_alloc::AllocError> {
        self.defaults.ensure_total_capacity(capacity as usize)
    }

    pub fn set_defaults_map(&mut self, defaults: api::StringMap) -> Result<(), bun_alloc::AllocError> {
        self.defaults.shrink_retaining_capacity(0);

        if defaults.keys.is_empty() {
            return Ok(());
        }

        self.defaults.ensure_total_capacity(defaults.keys.len())?;

        for (i, key) in defaults.keys.iter().enumerate() {
            // PERF(port): was assume_capacity
            self.defaults.push(EnvEntry {
                key: key.clone(),
                value: defaults.values[i].clone(),
            });
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
        self.behavior = api::DotEnvBehavior::Disable;
        self.prefix = Box::default();

        if prefix == b"*" {
            self.behavior = api::DotEnvBehavior::LoadAll;
        } else if !prefix.is_empty() {
            self.behavior = api::DotEnvBehavior::Prefix;
            self.prefix = Box::from(prefix);
        }
    }

    pub fn set_from_loaded(&mut self, config: api::LoadedEnvConfig) -> Result<(), bun_alloc::AllocError> {
        self.behavior = match config.dotenv {
            api::DotEnvBehavior::Prefix => api::DotEnvBehavior::Prefix,
            api::DotEnvBehavior::LoadAll => api::DotEnvBehavior::LoadAll,
            _ => api::DotEnvBehavior::Disable,
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
                keys: slice.items_key().to_vec().into(),
                values: slice.items_value().to_vec().into(),
            },
        }
    }

    // For reading from package.json
    pub fn get_or_put_value(&mut self, key: &[u8], value: &[u8]) -> Result<(), bun_alloc::AllocError> {
        let slice = self.defaults.slice();
        let keys = slice.items_key();
        for _key in keys {
            if key == &**_key {
                return Ok(());
            }
        }

        self.defaults.push(EnvEntry { key: Box::from(key), value: Box::from(value) });
        Ok(())
    }
}

#[derive(Debug, Default)]
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
        let needle: &[u8] = const_format::concatcp!("node_modules", bun_paths::SEP_STR).as_bytes();
        if let Some(node_module_i) = strings::index_of(str, needle) {
            Ok(Box::from(&str[node_module_i + b"node_modules".len() + 1..]))
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

#[derive(Debug, Default)]
pub struct RouteConfig {
    pub dir: Box<[u8]>,
    pub possible_dirs: Box<[Box<[u8]>]>,

    // Frameworks like Next.js (and others) use a special prefix for bundled/transpiled assets
    // This is combined with "origin" when printing import paths
    pub asset_prefix_path: Box<[u8]>,

    // TODO: do we need a separate list for data-only extensions?
    // e.g. /foo.json just to get the data for the route, without rendering the html
    // I think it's fine to hardcode as .json for now, but if I personally were writing a framework
    // I would consider using a custom binary format to minimize request size
    // maybe like CBOR
    pub extensions: Box<[Box<[u8]>]>,
    pub routes_enabled: bool,
    // TODO(port): static_dir / static_dir_enabled are referenced by methods below but not
    // declared in the Zig struct as read; verify in Phase B (likely fields elided in source).
    pub static_dir: Box<[u8]>,
    pub static_dir_enabled: bool,
}

impl RouteConfig {
    pub fn to_api(&self) -> api::LoadedRouteConfig {
        api::LoadedRouteConfig {
            asset_prefix: self.asset_prefix_path.clone(),
            dir: if self.routes_enabled { self.dir.clone() } else { Box::default() },
            extensions: self.extensions.clone(),
            static_dir: if self.static_dir_enabled { self.static_dir.clone() } else { Box::default() },
        }
    }

    pub const DEFAULT_DIR: &'static [u8] = b"pages";
    pub const DEFAULT_STATIC_DIR: &'static [u8] = b"public";
    pub const DEFAULT_EXTENSIONS: &'static [&'static [u8]] =
        &[b"tsx", b"ts", b"mjs", b"jsx", b"js"];

    #[inline]
    pub fn zero() -> RouteConfig {
        RouteConfig {
            dir: Box::from(Self::DEFAULT_DIR),
            extensions: Self::DEFAULT_EXTENSIONS
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
            static_dir: Box::from(Self::DEFAULT_STATIC_DIR),
            routes_enabled: false,
            ..Default::default()
        }
    }

    pub fn from_loaded_routes(loaded: api::LoadedRouteConfig) -> RouteConfig {
        RouteConfig {
            extensions: loaded.extensions,
            routes_enabled: !loaded.dir.is_empty(),
            static_dir_enabled: !loaded.static_dir.is_empty(),
            dir: loaded.dir,
            asset_prefix_path: loaded.asset_prefix,
            static_dir: loaded.static_dir,
            possible_dirs: Box::default(),
        }
    }

    pub fn from_api(router_: api::RouteConfig) -> Result<RouteConfig, bun_core::Error> {
        let mut router = Self::zero();

        let static_dir: &[u8] =
            bun_str::strings::trim_right(router_.static_dir.as_deref().unwrap_or(b""), b"/\\");
        let asset_prefix: &[u8] =
            bun_str::strings::trim_right(router_.asset_prefix.as_deref().unwrap_or(b""), b"/\\");

        match router_.dir.len() {
            0 => {}
            1 => {
                router.dir = Box::from(bun_str::strings::trim_right(&router_.dir[0], b"/\\"));
                router.routes_enabled = !router.dir.is_empty();
            }
            _ => {
                router.possible_dirs = router_.dir.clone();
                for dir in router_.dir.iter() {
                    let trimmed = bun_str::strings::trim_right(dir, b"/\\");
                    if !trimmed.is_empty() {
                        router.dir = Box::from(trimmed);
                    }
                }

                router.routes_enabled = !router.dir.is_empty();
            }
        }

        if !static_dir.is_empty() {
            router.static_dir = Box::from(static_dir);
        }

        if !asset_prefix.is_empty() {
            router.asset_prefix_path = Box::from(asset_prefix);
        }

        if !router_.extensions.is_empty() {
            let mut count: usize = 0;
            for _ext in router_.extensions.iter() {
                let ext = bun_str::strings::trim_left(_ext, b".");

                if ext.is_empty() {
                    continue;
                }

                count += 1;
            }

            let mut extensions: Vec<Box<[u8]>> = Vec::with_capacity(count);

            for _ext in router_.extensions.iter() {
                let ext = bun_str::strings::trim_left(_ext, b".");

                if ext.is_empty() {
                    continue;
                }

                extensions.push(Box::from(ext));
            }

            router.extensions = extensions.into_boxed_slice();
        }

        Ok(router)
    }
}



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

impl PathTemplate {
    pub fn needs(&self, field: PlaceholderField) -> bool {
        // TODO(port): Zig used comptime @tagName concatenation; here we match explicitly.
        let needle: &[u8] = match field {
            PlaceholderField::Dir => b"[dir]",
            PlaceholderField::Name => b"[name]",
            PlaceholderField::Ext => b"[ext]",
            PlaceholderField::Hash => b"[hash]",
            PlaceholderField::Target => b"[target]",
        };
        strings::contains(&self.data, needle)
    }

    #[inline]
    fn write_replacing_slashes_on_windows<W: bun_io::Write>(
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
        placeholder: PlaceholderConst { name: b"chunk", ext: b"js", dir: b"", hash: None, target: b"" },
    };

    pub const CHUNK_WITH_TARGET: PathTemplateConst = PathTemplateConst {
        data: b"[dir]/[target]/chunk-[hash].[ext]",
        placeholder: PlaceholderConst { name: b"chunk", ext: b"js", dir: b"", hash: None, target: b"" },
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

    // PORT NOTE: Zig `format(self, comptime _, _, writer: anytype)` writes raw path bytes via
    // writer.writeAll; mapped to a byte-writer inherent method (not `core::fmt::Display`) per
    // PORTING.md "(comptime X: type, arg: X) writer → &mut impl bun_io::Write (bytes)".
    pub fn print<W: bun_io::Write>(&self, writer: &mut W) -> bun_io::Result<()> {
        let mut remain: &[u8] = &self.data;
        while let Some(j) = strings::index_of_char(remain, b'[') {
            let j = j as usize;
            Self::write_replacing_slashes_on_windows(writer, &remain[0..j])?;
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
                Self::write_replacing_slashes_on_windows(writer, placeholder)?;
                remain = &remain[end_len..];
                continue;
            };

            match field {
                PlaceholderField::Dir => Self::write_replacing_slashes_on_windows(
                    writer,
                    if !self.placeholder.dir.is_empty() { &self.placeholder.dir } else { b"." },
                )?,
                PlaceholderField::Name => {
                    Self::write_replacing_slashes_on_windows(writer, &self.placeholder.name)?
                }
                PlaceholderField::Ext => {
                    Self::write_replacing_slashes_on_windows(writer, &self.placeholder.ext)?
                }
                PlaceholderField::Hash => {
                    if let Some(hash) = self.placeholder.hash {
                        // TODO(port): bun_io::Write byte formatting for truncated_hash32
                        bun_io::write_fmt(writer, format_args!("{}", bun_core::fmt::truncated_hash32(hash)))?;
                    }
                }
                PlaceholderField::Target => {
                    Self::write_replacing_slashes_on_windows(writer, &self.placeholder.target)?
                }
            }
            remain = &remain[end_len + 1..];
        }

        Self::write_replacing_slashes_on_windows(writer, remain)
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
    pub const DEFAULT: PlaceholderConst =
        PlaceholderConst { dir: b"", name: b"", ext: b"", hash: None, target: b"" };
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/options.zig (2654 lines)
//   confidence: medium
//   todos:      34
//   notes:      string_hash_map_from_arrays is a stub (callers inlined); JSX.Pragma factory/fragment ownership needs Cow; several &'static [&'static [u8]] fields should become Box/Cow; PathTemplate::print uses bun_io::Write — callers expecting Display must adapt; std.fs.Dir → bun_sys::Dir pending.
// ──────────────────────────────────────────────────────────────────────────
