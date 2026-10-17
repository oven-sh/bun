use crate::fs;
use crate::package_json::{PackageJSON, SideEffects};
use bun_options_types::bundle_enums::ModuleType;

pub const IMPORT_PATH: &[u8] = b"/bun-vfs$$/node_modules/";

// Ensure that checking for the prefix should be a cheap lookup (bun_core::has_prefix)
// because 24 bytes == 8 * 3 --> read and compare three u64s
const _: () = assert!(IMPORT_PATH.len().is_multiple_of(8));

pub(crate) struct FallbackModule {
    pub path: fs::Path<'static>,
    // PackageJSON has heap-backed fields (`Box<[u8]>`, hash maps) that cannot
    // be const-constructed, so the process-lifetime singleton below owns the
    // PackageJSONs and we hand out `&'static` borrows into it.
    pub package_json: &'static PackageJSON,
    pub code: fn() -> &'static str,
}

// This workaround exists to allow bun_core::runtime_embed_file to work.
// Using `include_str!` forces you to wait for the native build to finish in
// debug builds, even when you only changed JS builtins.
//
// Rust fn pointers cannot close over const-generic `&str` on stable, so this
// is expressed as a macro that expands to a local `fn get()` and yields its
// pointer.
//
// Release builds (`bun_codegen_embed`) embed the zstd-compressed `<name>.js.zst`
// written by the codegen step (src/node-fallbacks/build-fallbacks.ts) and
// decompress it lazily on first access; these polyfills are only ever read when
// bundling with `--target=browser`, so everything else stops paying ~1 MB of
// .rodata for the plain text. Debug builds keep loading the uncompressed `.js`
// from `BUN_CODEGEN_DIR` at runtime so JS-only edits don't need a native rebuild.
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

// PackageJSON is not const-constructible (Box<[u8]>/HashMap fields), so the
// table is built at runtime, once, on first access, from these const specs.
struct FallbackSpec {
    name: &'static [u8],
    index_path: &'static [u8],
    pretty: &'static [u8],
    pkgjson_path: &'static [u8],
    code: fn() -> &'static str,
}

macro_rules! fallback_spec {
    ($name:literal, $code_path:literal) => {
        FallbackSpec {
            name: $name.as_bytes(),
            index_path: ::const_format::concatcp!("/bun-vfs$$/node_modules/", $name, "/index.js")
                .as_bytes(),
            pretty: ::const_format::concatcp!("node:", $name).as_bytes(),
            pkgjson_path: ::const_format::concatcp!(
                "/bun-vfs$$/node_modules/",
                $name,
                "/package.json"
            )
            .as_bytes(),
            code: create_source_code_getter!($code_path),
        }
    };
}

static SPECS: [FallbackSpec; 23] = [
    fallback_spec!("assert", "node-fallbacks/assert.js"),
    fallback_spec!("buffer", "node-fallbacks/buffer.js"),
    fallback_spec!("console", "node-fallbacks/console.js"),
    fallback_spec!("constants", "node-fallbacks/constants.js"),
    fallback_spec!("crypto", "node-fallbacks/crypto.js"),
    fallback_spec!("domain", "node-fallbacks/domain.js"),
    fallback_spec!("events", "node-fallbacks/events.js"),
    fallback_spec!("http", "node-fallbacks/http.js"),
    fallback_spec!("https", "node-fallbacks/https.js"),
    fallback_spec!("net", "node-fallbacks/net.js"),
    fallback_spec!("os", "node-fallbacks/os.js"),
    fallback_spec!("path", "node-fallbacks/path.js"),
    fallback_spec!("process", "node-fallbacks/process.js"),
    fallback_spec!("punycode", "node-fallbacks/punycode.js"),
    fallback_spec!("querystring", "node-fallbacks/querystring.js"),
    fallback_spec!("stream", "node-fallbacks/stream.js"),
    fallback_spec!("string_decoder", "node-fallbacks/string_decoder.js"),
    fallback_spec!("sys", "node-fallbacks/sys.js"),
    fallback_spec!("timers", "node-fallbacks/timers.js"),
    fallback_spec!("tty", "node-fallbacks/tty.js"),
    fallback_spec!("url", "node-fallbacks/url.js"),
    fallback_spec!("util", "node-fallbacks/util.js"),
    fallback_spec!("zlib", "node-fallbacks/zlib.js"),
];

type FallbackEntry = (
    &'static [u8],
    PackageJSON,
    fs::Path<'static>,
    fn() -> &'static str,
);

// `PackageJSON` is `!Sync` (contains `StringArrayHashMap` with a `Cell<bool>`),
// so it cannot live in `LazyLock`/`OnceLock`. `RacyCell` + `Once` matches the
// "process-lifetime singleton, init once, read-only thereafter" shape. All
// reads go through `map()`, which initializes via `INIT.call_once(init_modules)`
// before touching the cells.
static MODULES: bun_core::RacyCell<Option<Box<[FallbackEntry]>>> = bun_core::RacyCell::new(None);
static MAP: bun_core::RacyCell<Option<bun_collections::StringHashMap<FallbackModule>>> =
    bun_core::RacyCell::new(None);
static INIT: std::sync::Once = std::sync::Once::new();

#[cold]
fn init_modules() {
    let modules: Box<[FallbackEntry]> = SPECS
        .iter()
        .map(|spec| {
            (
                spec.name,
                PackageJSON {
                    name: Box::from(spec.name),
                    version: Box::from(b"0.0.0-polyfill".as_slice()),
                    module_type: ModuleType::Esm,
                    // main_fields/browser_map are never read on this code path;
                    // Default::default() fills them safely.
                    source: bun_ast::Source::init_path_string(spec.pkgjson_path, b""),
                    side_effects: SideEffects::False,
                    ..Default::default()
                },
                fs::Path::init_with_namespace_virtual(spec.index_path, b"node", spec.pretty),
                spec.code,
            )
        })
        .collect();

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
    debug_assert!(path.starts_with(IMPORT_PATH));

    let module_name = &path[IMPORT_PATH.len()..];
    let module_name = &module_name
        [..bun_core::strings::index_of_char_usize(module_name, b'/').unwrap_or(module_name.len())];

    if let Some(module) = map().get(module_name) {
        return Some((module.code)().as_bytes());
    }

    None
}
