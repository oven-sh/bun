use core::sync::atomic::{AtomicBool, Ordering};

use bun_alloc::Arena as Bump;
use bun_core::{self, Global, strings};
use bun_js_parser as js_parser;

// B-3 UNIFIED: `Define` is now the single canonical `bun_js_parser::defines::Define`
// (re-exported via `crate::defines`); `JavaScript::parse`/`scan` and the bundler's
// `BundleOptions.define` share the same nominal type.
use js_parser::defines::Define;

// ══════════════════════════════════════════════════════════════════════════
// B-3 UNIFIED: `RuntimeTranspilerCache` is canonical in `bun_js_parser`
// (lower tier) so `Features.runtime_transpiler_cache: Option<*mut RTC>` and
// `ParseOptions.runtime_transpiler_cache: Option<&mut RTC>` are the same
// nominal type. This crate adds the env-var-gated `disabled`/`set_disabled` via
// the `RuntimeTranspilerCacheExt` trait below — those need `bun_core::env_var`
// which sits a tier above js_parser. `Entry` / `Metadata` stay concrete here;
// the canonical
// struct stores them type-erased as `*mut ()`.
// ══════════════════════════════════════════════════════════════════════════
use bun_ast::RuntimeTranspilerCache;

/// Bump when the cache wire format or parser output changes. Mirrors
/// `EXPECTED_VERSION` in src/jsc/RuntimeTranspilerCache.rs.
pub const RUNTIME_TRANSPILER_CACHE_VERSION: u32 = 20;

/// Written by CLI argument parsing and `VirtualMachine` init, and flipped
/// lazily on cache-dir resolution failure. Module-level so those writers can
/// reach it; `disabled()` reads it.
pub static DISABLED: AtomicBool = AtomicBool::new(false);

/// Extension surface for the canonical `RuntimeTranspilerCache` (defined in
/// `bun_js_parser`). Separate trait so the env-var-dependent bodies stay in
/// this crate without an orphan-rule violation.
pub trait RuntimeTranspilerCacheExt {
    /// Kept as an associated fn so call-sites read
    /// `RuntimeTranspilerCache::disabled()`.
    fn disabled() -> bool;
    fn set_disabled(v: bool);
}

impl RuntimeTranspilerCacheExt for RuntimeTranspilerCache {
    #[inline]
    fn disabled() -> bool {
        DISABLED.load(Ordering::Relaxed)
            || bun_core::env_var::BUN_RUNTIME_TRANSPILER_CACHE_PATH
                .get()
                .map(|v| v.is_empty() || v == b"0")
                .unwrap_or(false)
    }

    #[inline]
    fn set_disabled(v: bool) {
        DISABLED.store(v, Ordering::Relaxed);
    }
}

/// This is the on-disk wire enum for `Metadata.output_encoding` —
/// NOT `js_parser::ExportsKind` (an unrelated `#[repr(u8)]` enum that happens
/// to start at 0). The bundler-side cache loader maps `Latin1`/`Utf16` blobs
/// into a `bun.String` and only feeds
/// `Utf8` through `cloneUTF8`; callers must dispatch on these discriminants.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CacheEncoding {
    #[default]
    None = 0,
    Utf8 = 1,
    Utf16 = 2,
    Latin1 = 3,
}

/// On-disk wire enum — NOT `options::ModuleType`: it has `Esm`/`Cjs`
/// **swapped** relative to the in-memory parser/options enum (`Unknown=0,
/// Cjs=1, Esm=2`). Comparing `metadata.module_type` against
/// `options::ModuleType::Cjs as u8` would test for `.esm`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MetadataModuleType {
    #[default]
    None = 0,
    Esm = 1,
    Cjs = 2,
}

/// Mirrors `RuntimeTranspilerCache.Entry` — on-disk blob handle.
#[derive(Default)]
pub struct RuntimeTranspilerCacheEntry {
    pub metadata: RuntimeTranspilerCacheMetadata,
    pub output_code: Box<[u8]>,
    pub sourcemap: Box<[u8]>,
    pub esm_record: Box<[u8]>,
    pub cache_file_path: Box<[u8]>,
}

/// Mirrors `RuntimeTranspilerCache.Metadata` — fixed-width LE header.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct RuntimeTranspilerCacheMetadata {
    pub cache_version: u32,
    pub output_encoding: u8, // Encoding
    pub module_type: MetadataModuleType,
    pub features_hash: u64,
    pub input_byte_length: u64,
    pub input_hash: u64,
    pub output_byte_offset: u64,
    pub output_byte_length: u64,
    pub output_hash: u64,
    pub sourcemap_byte_offset: u64,
    pub sourcemap_byte_length: u64,
    pub sourcemap_hash: u64,
    pub esm_record_byte_offset: u64,
    pub esm_record_byte_length: u64,
    pub esm_record_hash: u64,
}

impl Default for RuntimeTranspilerCacheMetadata {
    /// The wire format defaults `cache_version` to the expected version —
    /// derived `Default` would zero it,
    /// causing every freshly-written entry to be rejected as `error.StaleCache`
    /// on first read.
    fn default() -> Self {
        Self {
            cache_version: RUNTIME_TRANSPILER_CACHE_VERSION,
            output_encoding: 0, // Encoding::none
            module_type: MetadataModuleType::None,
            features_hash: 0,
            input_byte_length: 0,
            input_hash: 0,
            output_byte_offset: 0,
            output_byte_length: 0,
            output_hash: 0,
            sourcemap_byte_offset: 0,
            sourcemap_byte_length: 0,
            sourcemap_hash: 0,
            esm_record_byte_offset: 0,
            esm_record_byte_length: 0,
            esm_record_hash: 0,
        }
    }
}

pub struct Set {
    pub js: JavaScript,
    pub fs: Fs,
    pub json: Json,
}

impl Set {
    /// `arena` is unused — `MutableString::init`/`JavaScript::init` source
    /// from the global heap; param kept for caller compatibility
    /// (`crate::cache::Set::init(alloc)`).
    pub fn init(_arena: &Bump) -> Set {
        Set {
            js: JavaScript::init(),
            fs: Fs::default(),
            json: Json::init(),
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// `Fs`/`Entry`/`Contents`/`ExternalFreeFunction` are defined
// canonically in `bun_resolver::cache` (lower tier) because `Resolver.caches`
// is typed by them and the resolver crate cannot depend on the bundler.
// Re-export here so `crate::cache::Entry` and `bun_resolver::cache::Entry`
// are the SAME nominal type — `ParseTask::get_code_for_parse_task_*` receives
// a resolver-produced `Entry` and hands it to bundler-typed consumers without
// a structural shim. See src/resolver/lib.rs `pub mod cache`.
// ══════════════════════════════════════════════════════════════════════════
pub use bun_resolver::cache::{Contents, Entry, ExternalFreeFunction, Fs};

/// Legacy alias — several call sites import `crate::cache::CacheEntry`.
pub type CacheEntry = Entry;

pub struct Css {}

pub struct CssEntry {}

pub struct CssResult {
    pub ok: bool,
    pub value: (),
}

impl Css {
    pub fn parse(
        &mut self,
        _log: &mut bun_ast::Log,
        _source: bun_ast::Source,
    ) -> Result<CssResult, crate::Error> {
        Global::notimpl();
    }
}

pub struct JavaScript {}

pub type JavaScriptResult<'a> = js_parser::Result<'a>;

impl JavaScript {
    pub fn init() -> JavaScript {
        JavaScript {}
    }
}

impl JavaScript {
    // For now, we're not going to cache JavaScript ASTs.
    // It's probably only relevant when bundling for production.
    pub fn parse<'a>(
        &self,
        bump: &'a Bump,
        opts: js_parser::ParserOptions<'a>,
        defines: &'a Define,
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
    ) -> Result<Option<js_parser::Result<'a>>, crate::Error> {
        let mut temp_log = bun_ast::Log::init();
        temp_log.level = log.level;
        let parser = match js_parser::Parser::init(opts, &mut temp_log, source, defines, bump) {
            Ok(p) => p,
            Err(_) => {
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Ok(None);
            }
        };

        let result = match parser.parse() {
            Ok(r) => r,
            Err(err) => {
                // `Parser::parse` consumes `self`, so `parser` is gone in this
                // arm. The `&'a mut temp_log` it held is released, so read
                // `temp_log.errors` directly. The lexer range is lost; fall
                // back to `Range::None`.
                // TODO: thread the failing token range through the `Err`
                // payload (make `_parse` return a `(Error, Range)` pair) so the
                // diagnostic points at the failing token.
                if temp_log.errors == 0 {
                    log.add_range_error(Some(source), bun_ast::Range::None, err.name().as_bytes());
                }
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Ok(None);
            }
        };

        let _ = temp_log.append_to_maybe_recycled(log, source);
        Ok(Some(result))
    }

    pub fn scan<'a>(
        &mut self,
        bump: &'a Bump,
        scan_pass_result: &mut js_parser::ScanPassResult,
        opts: js_parser::ParserOptions<'a>,
        defines: &'a Define,
        log: &mut bun_ast::Log,
        source: &'a bun_ast::Source,
    ) -> Result<(), crate::Error> {
        if strings::trim(source.contents(), b"\n\t\r ").is_empty() {
            return Ok(());
        }

        let mut temp_log = bun_ast::Log::init();
        // scopeguard cannot capture &mut temp_log while it's used below;
        // explicit `append_to_maybe_recycled` calls at each exit.

        let mut parser = match js_parser::Parser::init(opts, &mut temp_log, source, defines, bump) {
            Ok(p) => p,
            Err(_) => {
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Ok(());
            }
        };

        let res = parser.scan_imports(scan_pass_result);
        drop(parser);
        let _ = temp_log.append_to_maybe_recycled(log, source);
        res.map_err(Into::into)
    }
}

// `cache::Json` moved down into `bun_resolver::tsconfig_json::JsonCache` —
// the resolver already depends on `bun_parsers::json_parser`, so the
// vtable seam was redundant.
pub use bun_resolver::tsconfig_json::{JsonCache as Json, JsonMode};
