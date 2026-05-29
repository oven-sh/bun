use core::sync::atomic::{AtomicBool, Ordering};

use bun_alloc::Arena as Bump;
use bun_core::{self, Global, Output, ZStr, feature_flags};
use bun_core::{MutableString, strings};
use bun_js_parser as js_parser;
use bun_resolver::fs as fs_mod;
use bun_sys::{self, Fd};

// B-3 UNIFIED: `Define` is now the single canonical `bun_js_parser::defines::Define`
// (re-exported via `crate::defines`); `JavaScript::parse`/`scan` and the bundler's
// `BundleOptions.define` share the same nominal type.
use js_parser::defines::Define;

use bun_ast::RuntimeTranspilerCache;

/// Bump when the cache wire format or parser output changes. Mirrors
/// `expected_version` in src/jsc/RuntimeTranspilerCache.zig.
pub const RUNTIME_TRANSPILER_CACHE_VERSION: u32 = 20;

pub static DISABLED: AtomicBool = AtomicBool::new(false);

/// Extension surface for the canonical `RuntimeTranspilerCache` (defined in
/// `bun_js_parser`). Separate trait so the env-var-dependent bodies stay in
/// this crate without an orphan-rule violation.
pub trait RuntimeTranspilerCacheExt {
    /// Mirrors the Zig `pub var is_disabled` namespaced const — kept as an
    /// associated fn so call-sites read `RuntimeTranspilerCache::disabled()`.
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

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CacheEncoding {
    #[default]
    None = 0,
    Utf8 = 1,
    Utf16 = 2,
    Latin1 = 3,
}

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
    pub fn init(_arena: &Bump) -> Set {
        Set {
            js: JavaScript::init(),
            fs: Fs {
                shared_buffer: MutableString::init(0).expect("unreachable"),
                macro_shared_buffer: MutableString::init(0).expect("unreachable"),
                use_alternate_source_cache: false,
                stream: false,
            },
            json: Json::init(),
        }
    }
}

bun_core::declare_scope!(fs, visible);

pub struct Fs {
    pub shared_buffer: MutableString,
    pub macro_shared_buffer: MutableString,

    pub use_alternate_source_cache: bool,
    pub stream: bool,
}

impl Default for Fs {
    fn default() -> Self {
        Self {
            shared_buffer: MutableString::init(0).expect("unreachable"),
            macro_shared_buffer: MutableString::init(0).expect("unreachable"),
            use_alternate_source_cache: false,
            stream: false,
        }
    }
}

pub use bun_resolver::cache::{Contents, Entry, ExternalFreeFunction};

/// Legacy alias — several call sites import `crate::cache::CacheEntry`
/// (mirrors Zig's `bun.transpiler.cache.Fs.Entry` qualified name).
pub type CacheEntry = Entry;

impl Fs {
    // When we are in a macro, the shared buffer may be in use by the in-progress macro.
    // so we have to dynamically switch it out.
    #[inline]
    pub fn shared_buffer(&mut self) -> &mut MutableString {
        if !self.use_alternate_source_cache {
            &mut self.shared_buffer
        } else {
            &mut self.macro_shared_buffer
        }
    }

    pub fn reset_shared_buffer(&mut self, buffer: *const MutableString) -> MutableString {
        if core::ptr::eq(buffer, &raw const self.shared_buffer) {
            core::mem::replace(&mut self.shared_buffer, MutableString::init_empty())
        } else if core::ptr::eq(buffer, &raw const self.macro_shared_buffer) {
            core::mem::replace(&mut self.macro_shared_buffer, MutableString::init_empty())
        } else {
            unreachable!("resetSharedBuffer: invalid buffer");
        }
    }

    // TODO(port): Zig `Fs.deinit` references `c.entries` which is not a field on `Fs` —
    // dead code (Zig lazy compilation never instantiated it). No Drop impl needed beyond
    // the auto-drop of `shared_buffer` / `macro_shared_buffer`.
}

// File reads route through the canonical `bun_resolver::fs::read_file_contents`
// (one body for the stat→grow→pread-loop→BOM-strip path); these methods only
// handle open/seek/close around it.
impl Fs {
    /// Read `path` into the caller's `shared` buffer (HMR / dev-server path).
    pub fn read_file_shared(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &ZStr,
        cached_file_descriptor: Option<Fd>,
        shared: &mut MutableString,
    ) -> Result<Entry, bun_core::Error> {
        let rfs = &_fs.fs;

        let mut owned: Option<bun_sys::File> = None;
        let fd: Fd = if let Some(fd) = cached_file_descriptor {
            // `try handle.seekTo(0)` — rewind a cached fd before re-reading.
            bun_sys::File::borrow(&fd)
                .seek_to(0)
                .map_err(bun_core::Error::from)?;
            fd
        } else {
            let f = bun_sys::open_file_absolute_z(path, bun_sys::OpenFlags::READ_ONLY)
                .map_err(bun_core::Error::from)?;
            let raw = f.handle();
            owned = Some(f);
            raw
        };
        let file_handle = bun_sys::File::borrow(&fd);

        let contents = match fs_mod::read_file_contents(
            file_handle,
            path.as_bytes(),
            true,
            shared,
            self.stream,
        )
        .map(Contents::from)
        {
            Ok(c) => c,
            Err(err) => {
                if cfg!(debug_assertions) {
                    Output::print_error(format_args!(
                        "{}: readFile error -- {}",
                        bstr::BStr::new(path.as_bytes()),
                        bstr::BStr::new(err.name()),
                    ));
                }
                return Err(err);
            }
        };

        let will_close = cached_file_descriptor.is_none() && rfs.need_to_close_files();
        let publish_fd = feature_flags::STORE_FILE_DESCRIPTORS && !will_close;
        if publish_fd {
            if let Some(f) = owned.take() {
                let _ = f.into_raw();
            }
        }
        Ok(Entry {
            contents,
            fd: if publish_fd { fd } else { Fd::INVALID },
            external_free_function: ExternalFreeFunction::NONE,
        })
    }

    pub fn read_file(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        use_shared_buffer: bool,
        _file_handle: Option<Fd>,
    ) -> Result<Entry, bun_core::Error> {
        self.read_file_with_allocator(_fs, path, dirname_fd, use_shared_buffer, _file_handle, None)
    }

    pub fn read_file_with_allocator(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        use_shared_buffer: bool,
        _file_handle: Option<Fd>,
        arena: Option<&bun_alloc::Arena>,
    ) -> Result<Entry, bun_core::Error> {
        let rfs = &_fs.fs;

        // PORT NOTE: reshaped — Zig declared `file_handle = undefined` then assigned on each
        // branch; restructured into a single let-expression to avoid `mem::zeroed()` on a
        // type that may have niche (NonZero) fields.
        let mut _owned: Option<bun_sys::File> = None;
        let will_close: bool;
        let fd: Fd = if let Some(f) = _file_handle {
            bun_sys::File::borrow(&f)
                .seek_to(0)
                .map_err(bun_core::Error::from)?;
            _owned = None;
            will_close = false;
            f
        } else {
            let opened = if feature_flags::STORE_FILE_DESCRIPTORS && dirname_fd.is_valid() {
                match bun_sys::File::openat(
                    dirname_fd,
                    bun_paths::basename(path),
                    bun_sys::O::RDONLY,
                    0,
                ) {
                    Ok(f) => f,
                    Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                        let handle = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                            .map_err(bun_core::Error::from)?;
                        Output::pretty_errorln(format_args!(
                            "<r><d>Internal error: directory mismatch for directory \"{}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                            bstr::BStr::new(path),
                            dirname_fd,
                        ));
                        handle
                    }
                    Err(err) => return Err(err.into()),
                }
            } else {
                bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)
                    .map_err(bun_core::Error::from)?
            };
            let raw = opened.handle();
            will_close = rfs.need_to_close_files();
            _owned = Some(opened);
            raw
        };
        let file_handle = bun_sys::File::borrow(&fd);

        #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
        bun_core::scoped_log!(
            fs,
            "openat({}, {}) = {}",
            dirname_fd,
            bstr::BStr::new(path),
            fd
        );

        // PORT NOTE: reshaped for borrowck — capture `stream` scalar before borrowing
        // the shared buffer.
        let stream = self.stream;

        let contents = match (use_shared_buffer, arena) {
            (false, Some(arena)) => {
                match fs_mod::read_file_contents_in_arena(file_handle, path, arena) {
                    Ok((_, 0)) => Contents::Empty,
                    Ok((ptr, len)) => Contents::Arena { ptr, len },
                    Err(err) => {
                        if cfg!(debug_assertions) {
                            Output::print_error(format_args!(
                                "{}: readFile error -- {}",
                                bstr::BStr::new(path),
                                bstr::BStr::new(err.name()),
                            ));
                        }
                        return Err(err);
                    }
                }
            }
            _ => {
                let shared = self.shared_buffer();
                match fs_mod::read_file_contents(
                    file_handle,
                    path,
                    use_shared_buffer,
                    shared,
                    stream,
                )
                .map(Contents::from)
                {
                    Ok(c) => c,
                    Err(err) => {
                        if cfg!(debug_assertions) {
                            Output::print_error(format_args!(
                                "{}: readFile error -- {}",
                                bstr::BStr::new(path),
                                bstr::BStr::new(err.name()),
                            ));
                        }
                        return Err(err);
                    }
                }
            }
        };

        let publish_fd = feature_flags::STORE_FILE_DESCRIPTORS && !will_close;
        if publish_fd {
            if let Some(f) = _owned.take() {
                let _ = f.into_raw();
            }
        }
        Ok(Entry {
            contents,
            fd: if publish_fd { fd } else { Fd::INVALID },
            external_free_function: ExternalFreeFunction::NONE,
        })
    }
}

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
    ) -> Result<CssResult, bun_core::Error> {
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
    ) -> Result<Option<js_parser::Result<'a>>, bun_core::Error> {
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
    ) -> Result<(), bun_core::Error> {
        if strings::trim(source.contents(), b"\n\t\r ").is_empty() {
            return Ok(());
        }

        let mut temp_log = bun_ast::Log::init();
        // PORT NOTE: reshaped for borrowck — Zig `defer temp_log.appendToMaybeRecycled(log, source)`;
        // scopeguard cannot capture &mut temp_log while it's used below. Explicit calls at each exit.

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
        res
    }
}

// `cache::Json` moved down into `bun_resolver::tsconfig_json::JsonCache` —
// the resolver already depends on `bun_parsers::json_parser`, so the
// vtable seam was redundant.
pub use bun_resolver::tsconfig_json::{JsonCache as Json, JsonMode};

// ported from: src/bundler/cache.zig
