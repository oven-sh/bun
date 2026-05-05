#[allow(unused_imports)]
use crate::fs;
use crate::package_json::PackageJSON;
#[allow(unused_imports)]
use bun_logger as logger;

pub const IMPORT_PATH: &[u8] = b"/bun-vfs$$/node_modules/";

// Ensure that checking for the prefix should be a cheap lookup (bun_str::strings::has_prefix)
// because 24 bytes == 8 * 3 --> read and compare three u64s
const _: () = assert!(IMPORT_PATH.len() % 8 == 0);

pub struct FallbackModule {
    pub path: fs::Path<'static>,
    // PORT NOTE: Zig stored `*const PackageJSON` to a comptime literal (rvalue static
    // promotion). PackageJSON has heap-backed fields (`Box<[u8]>`, hash maps) that cannot
    // be const-constructed, so the LazyLock below owns the PackageJSONs and we hand out
    // `&'static` borrows into it.
    pub package_json: &'static PackageJSON,
    pub code: fn() -> &'static str,
}

// This workaround exists to allow bun_core::runtime_embed_file to work.
// Using `include_str!` forces you to wait for the native build to finish in
// debug builds, even when you only changed JS builtins.
//
// PORT NOTE: Zig's `createSourceCodeGetter(comptime code_path: string)` returned a
// `*const fn () string` by defining a nested struct with a `get` fn closing over the
// comptime path. Rust fn pointers cannot close over const-generic `&str` on stable, so
// this is expressed as a macro that expands to a local `fn get()` and yields its pointer.
macro_rules! create_source_code_getter {
    ($code_path:literal) => {{
        fn get() -> &'static str {
            // TODO(port): `bun.Environment.codegen_embed` — verify the Rust cfg name in Phase B.
            #[cfg(feature = "codegen_embed")]
            {
                include_str!($code_path)
            }
            #[cfg(not(feature = "codegen_embed"))]
            {
                ::bun_core::runtime_embed_file!(::bun_core::EmbedDir::Codegen, $code_path)
            }
        }
        get as fn() -> &'static str
    }};
}

// PORT NOTE: Zig's `pub fn init(comptime name: string) FallbackModule` did comptime string
// concatenation (`++`) and took the address of a comptime `PackageJSON` literal. PackageJSON
// is not const-constructible in Rust (Box<[u8]>/HashMap fields), so per PORTING.md
// §Concurrency this is a `LazyLock` runtime-init singleton. `@setEvalBranchQuota` is dropped.
//
// PERF(port): Zig used a comptime perfect-hash map; this builds at first access — profile in Phase B.
macro_rules! fallback_module_init {
    ($name:literal, $code_path:literal) => {{
        const _VERSION: &[u8] = b"0.0.0-polyfill";
        const _INDEX_PATH: &[u8] =
            ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/index.js").as_bytes();
        const _PRETTY: &[u8] = ::const_format::concatcp!("node:", $name).as_bytes();
        const _PKGJSON_PATH: &[u8] =
            ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/package.json").as_bytes();
        (
            $name.as_bytes(),
            PackageJSON {
                name: Box::from($name.as_bytes()),
                version: Box::from(_VERSION),
                module_type: ModuleType::Esm,
                // PORT NOTE: Zig used `undefined` for main_fields/browser_map (never read on
                // this code path); Default::default() is the closest safe equivalent.
                source: logger::Source::init_path_string(_PKGJSON_PATH, b""),
                side_effects: SideEffects::False,
                ..Default::default()
            },
            fs::Path::init_with_namespace_virtual(_INDEX_PATH, b"node", _PRETTY),
            create_source_code_getter!($code_path),
        )
    }};
}

type FallbackEntry = (&'static [u8], PackageJSON, fs::Path<'static>, fn() -> &'static str);

// TODO(b2-blocked): bun_collections::ArrayHashMap Sync — PackageJSON contains
// `StringArrayHashMap` which holds a `Cell<bool>`, making it `!Sync`, so it cannot
// live in a process-wide `LazyLock`. The Zig built this at comptime (no thread-safety
// concern). Un-gate once ArrayHashMap is `Sync` or PackageJSON sheds the !Sync field.
#[cfg(any())]
static MODULES: LazyLock<Box<[FallbackEntry]>> = LazyLock::new(|| {
    Box::new([
        fallback_module_init!("assert",         "node-fallbacks/assert.js"),
        fallback_module_init!("buffer",         "node-fallbacks/buffer.js"),
        fallback_module_init!("console",        "node-fallbacks/console.js"),
        fallback_module_init!("constants",      "node-fallbacks/constants.js"),
        fallback_module_init!("crypto",         "node-fallbacks/crypto.js"),
        fallback_module_init!("domain",         "node-fallbacks/domain.js"),
        fallback_module_init!("events",         "node-fallbacks/events.js"),
        fallback_module_init!("http",           "node-fallbacks/http.js"),
        fallback_module_init!("https",          "node-fallbacks/https.js"),
        fallback_module_init!("net",            "node-fallbacks/net.js"),
        fallback_module_init!("os",             "node-fallbacks/os.js"),
        fallback_module_init!("path",           "node-fallbacks/path.js"),
        fallback_module_init!("process",        "node-fallbacks/process.js"),
        fallback_module_init!("punycode",       "node-fallbacks/punycode.js"),
        fallback_module_init!("querystring",    "node-fallbacks/querystring.js"),
        fallback_module_init!("stream",         "node-fallbacks/stream.js"),
        fallback_module_init!("string_decoder", "node-fallbacks/string_decoder.js"),
        fallback_module_init!("sys",            "node-fallbacks/sys.js"),
        fallback_module_init!("timers",         "node-fallbacks/timers.js"),
        fallback_module_init!("tty",            "node-fallbacks/tty.js"),
        fallback_module_init!("url",            "node-fallbacks/url.js"),
        fallback_module_init!("util",           "node-fallbacks/util.js"),
        fallback_module_init!("zlib",           "node-fallbacks/zlib.js"),
    ])
});

// TODO(b2-blocked): bun_collections::ArrayHashMap Sync — see MODULES note above.
#[cfg(any())]
pub static MAP: LazyLock<StringHashMap<FallbackModule>> = LazyLock::new(|| {
    let mut map = StringHashMap::<FallbackModule>::default();
    for (name, pkg, path, code) in MODULES.iter() {
        map.insert(
            Box::from(*name),
            FallbackModule { path: path.clone(), package_json: pkg, code: *code },
        );
    }
    map
});

pub fn contents_from_path(path: &[u8]) -> Option<&'static [u8]> {
    if cfg!(debug_assertions) {
        debug_assert!(path.starts_with(IMPORT_PATH));
    }

    let module_name = &path[IMPORT_PATH.len()..];
    let module_name = &module_name[..module_name
        .iter()
        .position(|&b| b == b'/')
        .unwrap_or(module_name.len())];

    // TODO(b2-blocked): bun_collections::ArrayHashMap Sync — MAP gated above.
    #[cfg(any())]
    if let Some(module) = MAP.get(module_name) {
        return Some((module.code)().as_bytes());
    }
    let _ = module_name;

    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/node_fallbacks.zig (99 lines)
//   confidence: medium
//   todos:      4
//   notes:      Heavy comptime init → macros + phf; needs const-fn ctors on Path/Source/PackageJSON in Phase B. LIFETIMES.tsv pins struct field `code` to &'static str; free fn `contents_from_path` returns &'static [u8] per type-map rule.
// ──────────────────────────────────────────────────────────────────────────
