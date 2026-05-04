use crate::fs;
use crate::package_json::PackageJSON;
use bun_logger as logger;

pub const IMPORT_PATH: &[u8] = b"/bun-vfs$$/node_modules/";

// Ensure that checking for the prefix should be a cheap lookup (bun_str::strings::has_prefix)
// because 24 bytes == 8 * 3 --> read and compare three u64s
const _: () = assert!(IMPORT_PATH.len() % 8 == 0);

pub struct FallbackModule {
    pub path: fs::Path,
    pub package_json: &'static PackageJSON,
    pub code: fn() -> &'static str,
}

impl FallbackModule {
    // This workaround exists to allow bun_core::runtime_embed_file to work.
    // Using `include_str!` forces you to wait for the native build to finish in
    // debug builds, even when you only changed JS builtins.
    //
    // PORT NOTE: Zig's `createSourceCodeGetter(comptime code_path: string)` returned a
    // `*const fn () string` by defining a nested struct with a `get` fn closing over the
    // comptime path. Rust fn pointers cannot close over const-generic `&str` on stable, so
    // this is expressed as a macro that expands to a local `fn get()` and yields its pointer.
    #[doc(hidden)]
    #[macro_export]
    macro_rules! __create_source_code_getter {
        ($code_path:expr) => {{
            fn get() -> &'static str {
                // TODO(port): `bun.Environment.codegen_embed` — verify the Rust cfg name in Phase B.
                #[cfg(feature = "codegen_embed")]
                {
                    return include_str!($code_path);
                }
                #[cfg(not(feature = "codegen_embed"))]
                {
                    return bun_core::runtime_embed_file(bun_core::EmbedDir::Codegen, $code_path);
                }
            }
            get as fn() -> &'static str
        }};
    }

    // PORT NOTE: Zig's `pub fn init(comptime name: string) FallbackModule` did comptime string
    // concatenation (`++`) and took the address of a comptime `PackageJSON` literal. In Rust this
    // must be a macro so `concatcp!` sees literals and the `&PackageJSON { .. }` is rvalue-static-
    // promoted to `&'static`. `@setEvalBranchQuota` has no Rust equivalent and is dropped.
    #[doc(hidden)]
    #[macro_export]
    macro_rules! __fallback_module_init {
        ($name:literal) => {{
            const _VERSION: &str = "0.0.0-polyfill";
            $crate::node_fallbacks::FallbackModule {
                path: $crate::fs::Path::init_with_namespace_virtual(
                    ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/index.js"),
                    "node",
                    $name,
                ),
                // TODO(port): requires `fs::Path::init_with_namespace_virtual` and
                // `logger::Source::init_path_string` to be `const fn` for static promotion.
                package_json: &$crate::package_json::PackageJSON {
                    name: $name,
                    version: _VERSION,
                    module_type: $crate::package_json::ModuleType::Esm,
                    // TODO(port): Zig used `undefined` for main_fields/browser_map (never read on
                    // this code path). Need a const-constructible "uninit" placeholder in Phase B.
                    main_fields: $crate::package_json::MainFieldMap::EMPTY,
                    browser_map: $crate::package_json::BrowserMap::EMPTY,
                    source: ::bun_logger::Source::init_path_string(
                        ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/package.json"),
                        "",
                    ),
                    side_effects: $crate::package_json::SideEffects::False,
                },
                code: $crate::__create_source_code_getter!(::const_format::concatcp!(
                    "node-fallbacks/",
                    $name,
                    ".js"
                )),
            }
        }};
    }

    // Re-exported under the type's namespace to mirror Zig's `FallbackModule.init(...)` callsites.
    pub use __fallback_module_init as init;
}

// TODO(port): `phf_map!` values must be const-evaluable; this depends on every constructor
// reached by `__fallback_module_init!` being `const fn`. Revisit in Phase B — if that proves
// intractable, fall back to a `once_cell::Lazy<HashMap<..>>` and leave a PERF(port) marker.
pub static MAP: phf::Map<&'static [u8], FallbackModule> = phf::phf_map! {
    b"assert"         => __fallback_module_init!("assert"),
    b"buffer"         => __fallback_module_init!("buffer"),
    b"console"        => __fallback_module_init!("console"),
    b"constants"      => __fallback_module_init!("constants"),
    b"crypto"         => __fallback_module_init!("crypto"),
    b"domain"         => __fallback_module_init!("domain"),
    b"events"         => __fallback_module_init!("events"),
    b"http"           => __fallback_module_init!("http"),
    b"https"          => __fallback_module_init!("https"),
    b"net"            => __fallback_module_init!("net"),
    b"os"             => __fallback_module_init!("os"),
    b"path"           => __fallback_module_init!("path"),
    b"process"        => __fallback_module_init!("process"),
    b"punycode"       => __fallback_module_init!("punycode"),
    b"querystring"    => __fallback_module_init!("querystring"),
    b"stream"         => __fallback_module_init!("stream"),
    b"string_decoder" => __fallback_module_init!("string_decoder"),
    b"sys"            => __fallback_module_init!("sys"),
    b"timers"         => __fallback_module_init!("timers"),
    b"tty"            => __fallback_module_init!("tty"),
    b"url"            => __fallback_module_init!("url"),
    b"util"           => __fallback_module_init!("util"),
    b"zlib"           => __fallback_module_init!("zlib"),
};

pub fn contents_from_path(path: &[u8]) -> Option<&'static str> {
    if cfg!(debug_assertions) {
        debug_assert!(path.starts_with(IMPORT_PATH));
    }

    let module_name = &path[IMPORT_PATH.len()..];
    let module_name = &module_name[..module_name
        .iter()
        .position(|&b| b == b'/')
        .unwrap_or(module_name.len())];

    if let Some(module) = MAP.get(module_name) {
        return Some((module.code)());
    }

    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/resolver/node_fallbacks.zig (99 lines)
//   confidence: medium
//   todos:      4
//   notes:      Heavy comptime init → macros + phf; needs const-fn ctors on Path/Source/PackageJSON in Phase B. LIFETIMES.tsv said code returns &'static str (vs &[u8]) — kept verbatim.
// ──────────────────────────────────────────────────────────────────────────
