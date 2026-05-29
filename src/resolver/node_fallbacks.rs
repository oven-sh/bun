use crate::fs;
use crate::package_json::{PackageJSON, SideEffects};
use bun_options_types::bundle_enums::ModuleType;

pub const IMPORT_PATH: &[u8] = b"/bun-vfs$$/node_modules/";

// Ensure that checking for the prefix should be a cheap lookup (bun_core::has_prefix)
// because 24 bytes == 8 * 3 --> read and compare three u64s
const _: () = assert!(IMPORT_PATH.len().is_multiple_of(8));

pub(crate) struct FallbackModule {
    pub path: fs::Path<'static>,
    pub package_json: &'static PackageJSON,
    pub code: fn() -> &'static str,
}

macro_rules! create_source_code_getter {
    ($code_path:literal) => {{
        // `$code_path` is relative to `BUN_CODEGEN_DIR` (codegen output, not
        // the source tree).
        fn get() -> &'static str {
            // `bun_codegen_embed` is set via RUSTFLAGS by scripts/build/rust.ts;
            // plain `cargo check` doesn't pass `--check-cfg` for it.
            #[allow(unexpected_cfgs)]
            let source: &'static str = {
                #[cfg(bun_codegen_embed)]
                {
                    static SOURCE: ::bun_core::Once<String> = ::bun_core::Once::new();
                    SOURCE
                        .get_or_init(|| {
                            let compressed: &'static [u8] =
                                ::core::include_bytes!(::core::concat!(
                                    ::core::env!("BUN_CODEGEN_DIR"),
                                    "/",
                                    $code_path,
                                    ".zst"
                                ));
                            let bytes = ::bun_zstd::decompress_alloc(compressed)
                                .expect("embedded node-fallback polyfill: invalid zstd frame");
                            String::from_utf8(bytes)
                                .expect("embedded node-fallback polyfill: invalid UTF-8")
                        })
                        .as_str()
                }
                #[cfg(not(bun_codegen_embed))]
                {
                    ::bun_core::runtime_embed_file!(Codegen, $code_path)
                }
            };
            source
        }
        get as fn() -> &'static str
    }};
}

macro_rules! fallback_module_init {
    ($name:literal, $code_path:literal) => {{
        const _VERSION: &[u8] = b"0.0.0-polyfill";
        const _INDEX_PATH: &[u8] =
            ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/index.js").as_bytes();
        const _PRETTY: &[u8] = ::const_format::concatcp!("node:", $name).as_bytes();
        const _PKGJSON_PATH: &[u8] =
            ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/package.json")
                .as_bytes();
        (
            $name.as_bytes(),
            PackageJSON {
                name: Box::from($name.as_bytes()),
                version: Box::from(_VERSION),
                module_type: ModuleType::Esm,
                // PORT NOTE: Zig used `undefined` for main_fields/browser_map (never read on
                // this code path); Default::default() is the closest safe equivalent.
                source: bun_ast::Source::init_path_string(_PKGJSON_PATH, b""),
                side_effects: SideEffects::False,
                ..Default::default()
            },
            fs::Path::init_with_namespace_virtual(_INDEX_PATH, b"node", _PRETTY),
            create_source_code_getter!($code_path),
        )
    }};
}

type FallbackEntry = (
    &'static [u8],
    PackageJSON,
    fs::Path<'static>,
    fn() -> &'static str,
);

static MODULES: bun_core::RacyCell<Option<Box<[FallbackEntry]>>> = bun_core::RacyCell::new(None);
static MAP: bun_core::RacyCell<Option<bun_collections::StringHashMap<FallbackModule>>> =
    bun_core::RacyCell::new(None);
static INIT: std::sync::Once = std::sync::Once::new();

#[cold]
fn init_modules() {
    let modules: Box<[FallbackEntry]> = Box::new([
        fallback_module_init!("assert", "node-fallbacks/assert.js"),
        fallback_module_init!("buffer", "node-fallbacks/buffer.js"),
        fallback_module_init!("console", "node-fallbacks/console.js"),
        fallback_module_init!("constants", "node-fallbacks/constants.js"),
        fallback_module_init!("crypto", "node-fallbacks/crypto.js"),
        fallback_module_init!("domain", "node-fallbacks/domain.js"),
        fallback_module_init!("events", "node-fallbacks/events.js"),
        fallback_module_init!("http", "node-fallbacks/http.js"),
        fallback_module_init!("https", "node-fallbacks/https.js"),
        fallback_module_init!("net", "node-fallbacks/net.js"),
        fallback_module_init!("os", "node-fallbacks/os.js"),
        fallback_module_init!("path", "node-fallbacks/path.js"),
        fallback_module_init!("process", "node-fallbacks/process.js"),
        fallback_module_init!("punycode", "node-fallbacks/punycode.js"),
        fallback_module_init!("querystring", "node-fallbacks/querystring.js"),
        fallback_module_init!("stream", "node-fallbacks/stream.js"),
        fallback_module_init!("string_decoder", "node-fallbacks/string_decoder.js"),
        fallback_module_init!("sys", "node-fallbacks/sys.js"),
        fallback_module_init!("timers", "node-fallbacks/timers.js"),
        fallback_module_init!("tty", "node-fallbacks/tty.js"),
        fallback_module_init!("url", "node-fallbacks/url.js"),
        fallback_module_init!("util", "node-fallbacks/util.js"),
        fallback_module_init!("zlib", "node-fallbacks/zlib.js"),
    ]);

    let mut m = bun_collections::StringHashMap::<FallbackModule>::default();
    // SAFETY: `init_modules` runs exactly once under `Once::call_once`; no other
    // thread observes `MODULES`/`MAP` until this returns.
    unsafe {
        *MODULES.get() = Some(modules);
        let modules_ref: &'static [FallbackEntry] = (*MODULES.get()).as_deref().unwrap();
        for (name, pkg, path, code) in modules_ref.iter() {
            m.put_assume_capacity(
                name,
                FallbackModule {
                    path: *path,
                    package_json: pkg,
                    code: *code,
                },
            );
        }
        *MAP.get() = Some(m);
    }
}

#[inline]
pub(crate) fn map() -> &'static bun_collections::StringHashMap<FallbackModule> {
    INIT.call_once(init_modules);
    // SAFETY: `INIT` guarantees `MAP` is `Some` and never written again.
    unsafe { (*MAP.get()).as_ref().unwrap() }
}

pub fn contents_from_path(path: &[u8]) -> Option<&'static [u8]> {
    if cfg!(debug_assertions) {
        debug_assert!(path.starts_with(IMPORT_PATH));
    }

    let module_name = &path[IMPORT_PATH.len()..];
    let module_name = &module_name[..module_name
        .iter()
        .position(|&b| b == b'/')
        .unwrap_or(module_name.len())];

    if let Some(module) = map().get(module_name) {
        return Some((module.code)().as_bytes());
    }

    None
}

// ported from: src/resolver/node_fallbacks.zig
