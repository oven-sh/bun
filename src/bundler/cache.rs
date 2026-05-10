use core::sync::atomic::{AtomicBool, Ordering};

use bun_alloc::Arena as Bump;
use bun_core::{self, feature_flags, Global, Output, ZStr};
use bun_interchange::json_parser;
use bun_js_parser::{self as js_parser, ast as js_ast};
use bun_logger as logger;
use bun_resolver::fs as fs_mod;
use bun_string::{strings, MutableString};
use bun_sys::{self, Fd};

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
pub use bun_js_parser::RuntimeTranspilerCache;

/// Bump when the cache wire format or parser output changes. Mirrors
/// `expected_version` in src/jsc/RuntimeTranspilerCache.zig.
pub const RUNTIME_TRANSPILER_CACHE_VERSION: u32 = 20;

/// Mirrors the Zig `pub var is_disabled` mutable global — written by T6
/// (src/runtime/cli/Arguments.zig:1603, src/jsc/VirtualMachine.zig:1383) and
/// flipped lazily on cache-dir resolution failure. Module-level so those
/// writers can reach it; `disabled()` reads it.
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

/// Mirrors `RuntimeTranspilerCache.Encoding` (RuntimeTranspilerCache.zig:405).
///
/// PORT NOTE: this is the on-disk wire enum for `Metadata.output_encoding` —
/// NOT `js_parser::ExportsKind` (an unrelated `#[repr(u8)]` enum that happens
/// to start at 0). The bundler-side cache loader maps `Latin1`/`Utf16` blobs
/// into a `bun.String` (RuntimeTranspilerCache.zig:310-318) and only feeds
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

/// Mirrors `RuntimeTranspilerCache.ModuleType` (RuntimeTranspilerCache.zig:399).
///
/// PORT NOTE: NOT `options::ModuleType` — the on-disk wire enum has `Esm`/`Cjs`
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
    /// Spec (src/jsc/RuntimeTranspilerCache.zig:42) defaults
    /// `cache_version: u32 = expected_version` — derived `Default` would zero it,
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
    /// Port of `Set.init` (cache.zig:6). PORT NOTE: `arena` is unused —
    /// `MutableString::init`/`JavaScript::init` source from the global heap in
    /// the Rust port; param kept so callers match the Zig signature
    /// (`crate::cache::Set::init(alloc)`).
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

// ══════════════════════════════════════════════════════════════════════════
// `Entry`/`Contents`/`ExternalFreeFunction` are defined
// canonically in `bun_resolver::cache` (lower tier) because `Resolver.caches`
// is typed by them and the resolver crate cannot depend on the bundler.
// Re-export here so `crate::cache::Entry` and `bun_resolver::cache::Entry`
// are the SAME nominal type — `ParseTask::get_code_for_parse_task_*` receives
// a resolver-produced `Entry` and hands it to bundler-typed consumers without
// a structural shim. See src/resolver/lib.rs `pub mod cache`.
// ══════════════════════════════════════════════════════════════════════════
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

    /// When we need to suspend/resume something that has pointers into the shared buffer, we need to
    /// switch out the shared buffer so that it is not in use.
    ///
    /// Ownership transfer: in Zig (cache.zig:77/79) the field is overwritten WITHOUT freeing
    /// the old buffer, because the suspended parse keeps pointers into it (see ModuleLoader.zig:488,
    /// "this shared buffer is about to become owned by the AsyncModule struct"). In Rust, plain
    /// field assignment would drop+free the old buffer → use-after-free on resume. So we return
    /// the detached buffer; the caller MUST take ownership of it and keep it alive for as long as
    /// `parse_result.source.contents` may be read.
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

// ── un-gated B-2 ──────────────────────────────────────────────────────────
// `bun_resolver::fs::RealFS::read_file_with_handle{,_and_allocator}` is still
// in the gated `fs_full` draft. The bodies below open + read via `bun_sys`
// directly (which is exactly what the resolver method would do) so the
// transpiler/ParseTask paths un-block without waiting on that crate.
//
// `RealFS::need_to_close_files()` is the only resolver call we actually need
// and is live on the inline `bun_resolver::fs::RealFS`.
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

        let file_handle: bun_sys::File = if let Some(fd) = cached_file_descriptor {
            // `try handle.seekTo(0)` — rewind a cached fd before re-reading.
            bun_sys::lseek(fd, 0, libc::SEEK_SET).map_err(bun_core::Error::from)?;
            bun_sys::File::from_fd(fd)
        } else {
            bun_sys::open_file_absolute_z(path, bun_sys::OpenFlags::READ_ONLY)
                .map_err(bun_core::Error::from)?
        };

        let will_close = rfs.need_to_close_files() && cached_file_descriptor.is_none();
        let fd = file_handle.handle();
        let file_handle = scopeguard::guard(file_handle, move |fh| {
            if will_close {
                let _ = fh.close();
            }
        });

        let contents =
            match Self::read_handle_into(&file_handle, path.as_bytes(), true, shared, self.stream) {
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

        Ok(Entry {
            contents,
            fd: if feature_flags::STORE_FILE_DESCRIPTORS { fd } else { Fd::INVALID },
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
        self.read_file_with_allocator(_fs, path, dirname_fd, use_shared_buffer, _file_handle)
    }

    /// Port of `Fs.readFileWithAllocator` (cache.zig:146).
    ///
    /// PORT NOTE: `comptime use_shared_buffer` is taken at runtime — the live
    /// callers (`ParseTask::get_code_for_parse_task_without_plugins`,
    /// `Transpiler::parse`) pass a value computed from runtime state, and the
    /// resolver's `FsCache` forward-decl already pinned this shape.
    /// PERF(port): re-monomorphize once both callers stabilize.
    ///
    /// PORT NOTE: `arena` is dropped — Zig forwarded it to
    /// `readFileWithHandleAndAllocator`; the only effect was choosing which
    /// heap owns the non-shared-buffer read. The Rust path always allocates
    /// from the global heap (`Contents::Owned(Vec<u8>)`); arena callers can
    /// pass through the resolver's bump-backed forward-decl instead.
    pub fn read_file_with_allocator(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        use_shared_buffer: bool,
        _file_handle: Option<Fd>,
    ) -> Result<Entry, bun_core::Error> {
        let rfs = &_fs.fs;

        // PORT NOTE: reshaped — Zig declared `file_handle = undefined` then assigned on each
        // branch; restructured into a single let-expression to avoid `mem::zeroed()` on a
        // type that may have niche (NonZero) fields.
        let file_handle: bun_sys::File = if let Some(f) = _file_handle {
            bun_sys::lseek(f, 0, libc::SEEK_SET).map_err(bun_core::Error::from)?;
            bun_sys::File::from_fd(f)
        } else if feature_flags::STORE_FILE_DESCRIPTORS && dirname_fd.is_valid() {
            match bun_sys::openat_a(dirname_fd, bun_paths::basename(path), bun_sys::O::RDONLY, 0) {
                Ok(fd) => bun_sys::File::from_fd(fd),
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

        let fd = file_handle.handle();

        #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
        bun_core::scoped_log!(fs, "openat({}, {}) = {}", dirname_fd, bstr::BStr::new(path), fd);

        let will_close = rfs.need_to_close_files() && _file_handle.is_none();
        let file_handle = scopeguard::guard(file_handle, move |fh| {
            if will_close {
                bun_core::scoped_log!(fs, "readFileWithAllocator close({})", fh.handle());
                let _ = fh.close();
            }
        });

        // PORT NOTE: reshaped for borrowck — capture `stream` scalar before borrowing
        // the shared buffer.
        let stream = self.stream;
        let shared = self.shared_buffer();

        let contents =
            match Self::read_handle_into(&file_handle, path, use_shared_buffer, shared, stream) {
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
            };

        Ok(Entry {
            contents,
            fd: if feature_flags::STORE_FILE_DESCRIPTORS && !will_close { fd } else { Fd::INVALID },
            external_free_function: ExternalFreeFunction::NONE,
        })
    }

    /// Inlined subset of `RealFS.readFileWithHandleAndAllocator` (fs.zig:1160) —
    /// the resolver's port of that method is still in the gated `fs_full` module,
    /// so we go to `bun_sys` directly. Returns provenance-tagged [`Contents`].
    // TODO(port): switch back to `rfs.read_file_with_handle_and_allocator` once
    // `bun_resolver::fs_full` un-gates.
    fn read_handle_into(
        file: &bun_sys::File,
        _path: &[u8],
        use_shared_buffer: bool,
        shared: &mut MutableString,
        stream: bool,
    ) -> Result<Contents, bun_core::Error> {
        // PORT NOTE: `strings::BOM` lives in the gated `unicode_draft` module
        // and is not yet re-exported; inline the UTF-8 BOM constant here so the
        // common case (UTF-8 BOM strip) is observable. UTF-16-LE BOM →UTF-8
        // transcode falls through to the gated path once it un-gates.
        // TODO(port): replace with `strings::BOM::detect` + `remove_and_convert_*`
        // once `bun_string::strings::BOM` is public.
        const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

        if use_shared_buffer {
            shared.reset();
            let mut size = file.get_end_pos().map_err(bun_core::Error::from)?;
            if size == 0 {
                return Ok(Contents::Empty);
            }
            shared.list.reserve(size + 1);

            // fs.zig:1200-1239 — pread loop; when `stream`, re-stat after each
            // read and grow if the file changed under us (HMR save race).
            let mut bytes_read: usize = 0;
            loop {
                // SAFETY: capacity reserved above; `read_all` writes initialized
                // bytes and we set_len to exactly bytes_read+read_count.
                let read_count = unsafe {
                    let cap = shared.list.capacity();
                    let dst = core::slice::from_raw_parts_mut(
                        shared.list.as_mut_ptr().add(bytes_read),
                        cap - bytes_read,
                    );
                    let n = file.read_all(dst).map_err(bun_core::Error::from)?;
                    shared.list.set_len(bytes_read + n);
                    n
                };

                if stream {
                    // check again that stat() didn't change the file size
                    let new_size = file.get_end_pos().map_err(bun_core::Error::from)?;
                    bytes_read += read_count;
                    // don't infinite loop if we're still not reading more
                    if read_count == 0 {
                        break;
                    }
                    if bytes_read < new_size {
                        shared.list.reserve(new_size - size);
                        size = new_size;
                        continue;
                    }
                }
                break;
            }

            let mut n = shared.list.len();

            // BOM strip (fs.zig:1244 `removeAndConvertToUTF8WithoutDealloc`).
            if shared.list.starts_with(&UTF8_BOM) {
                shared.list.copy_within(UTF8_BOM.len().., 0);
                n -= UTF8_BOM.len();
                // SAFETY: n <= prior len; bytes [0..n] were just initialized via copy_within.
                unsafe { shared.list.set_len(n) };
            }

            // Sentinel NUL past len when capacity allows (matches fs.zig:1241).
            if shared.list.capacity() > n {
                // SAFETY: capacity > len, so writing one byte past len is in-bounds.
                unsafe { *shared.list.as_mut_ptr().add(n) = 0 };
            }

            // Caller owns `shared` and resets it via `reset_shared_buffer` before
            // reuse; tag as borrowed so `deinit` is a no-op.
            Ok(Contents::SharedBuffer { ptr: shared.list.as_ptr(), len: n })
        } else {
            let mut bytes = file.read_to_end().map_err(bun_core::Error::from)?;
            if bytes.is_empty() {
                return Ok(Contents::Empty);
            }

            // BOM strip (fs.zig:1299 `removeAndConvertToUTF8AndFree`).
            if bytes.starts_with(&UTF8_BOM) {
                bytes.copy_within(UTF8_BOM.len().., 0);
                bytes.truncate(bytes.len() - UTF8_BOM.len());
            }

            // Sentinel NUL past len in spare capacity (matches fs.zig:1289
            // `buf[size] = 0`). `Contents::Owned` keeps the `Vec` so capacity
            // is preserved.
            bytes.reserve_exact(1);
            let len = bytes.len();
            // SAFETY: capacity >= len+1 after reserve_exact; write is in-bounds.
            unsafe { *bytes.as_mut_ptr().add(len) = 0 };

            Ok(Contents::Owned(bytes))
        }
    }
}

pub struct Css {}

pub struct CssEntry {}

pub struct CssResult {
    pub ok: bool,
    pub value: (),
}

impl Css {
    pub fn parse(&mut self, _log: &mut logger::Log, _source: logger::Source) -> Result<CssResult, bun_core::Error> {
        Global::notimpl();
    }
}

pub struct JavaScript {}

pub type JavaScriptResult = js_ast::Result;

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
        log: &mut logger::Log,
        source: &'a logger::Source,
    ) -> Result<Option<js_ast::Result>, bun_core::Error> {
        let mut temp_log = logger::Log::init();
        temp_log.level = log.level;
        let mut parser = match js_parser::Parser::init(opts, &mut temp_log, source, defines, bump) {
            Ok(p) => p,
            Err(_) => {
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Ok(None);
            }
        };

        let result = match parser.parse() {
            Ok(r) => r,
            Err(err) => {
                // PORT NOTE: `Parser::parse` consumes `self` (Zig took `*Parser`
                // — by-ref — but the Rust port owns the inner `P` by value), so
                // `parser` is gone in this arm. The `&'a mut temp_log` it held
                // is released, so read `temp_log.errors` directly. The lexer
                // range is lost; fall back to `Range::None` (Zig used
                // `parser.lexer.range()`).
                // TODO(port): thread the failing token range through the
                // `Err` payload once `_parse` returns a `(Error, Range)` pair.
                if temp_log.errors == 0 {
                    log.add_range_error(Some(source), logger::Range::None, err.name().as_bytes());
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
        log: &mut logger::Log,
        source: &'a logger::Source,
    ) -> Result<(), bun_core::Error> {
        if strings::trim(source.contents(), b"\n\t\r ").is_empty() {
            return Ok(());
        }

        let mut temp_log = logger::Log::init();
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
// the resolver already depends on `bun_interchange::json_parser`, so the
// vtable seam was redundant.
pub use bun_resolver::tsconfig_json::{JsonCache as Json, JsonMode};

// ported from: src/bundler/cache.zig
