use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_alloc::Arena as Bump;
use bun_core::{self, feature_flags, Global, Output, ZStr};
use bun_interchange::json_parser;
use bun_js_parser::{self as js_parser, ast as js_ast};
use bun_logger as logger;
use bun_resolver::fs as fs_mod;
use bun_string::{strings, MutableString};
use bun_sys::{self, Fd};

// PORT NOTE: cache.zig pulled `Define` from `./defines.zig`. In the Rust split
// the parser crate carries its own CYCLEBREAK `defines::Define` (the type
// `Parser::init` actually accepts); the bundler's richer `crate::defines::Define`
// unifies with it once T3 round-D lands. `JavaScript::parse`/`scan` take the
// parser-crate type so the call into `Parser::init` typechecks today.
use js_parser::defines::Define;

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK(b0) MOVE_DOWN: `jsc::RuntimeTranspilerCache` (src/jsc/RuntimeTranspilerCache.zig:28)
// — TYPE_ONLY fields the parser writes through `ParseOptions.runtime_transpiler_cache`.
// The disk I/O (`get`/`put`/`Entry.load`) bodies stay here jsc-free; the
// `bun.String` output_code field becomes an owned byte buffer (the only
// JSC use was `bun.String.createLatin1` on the JS thread, which T6 wraps).
// ══════════════════════════════════════════════════════════════════════════

/// Bump when the cache wire format or parser output changes. Mirrors
/// `expected_version` in src/jsc/RuntimeTranspilerCache.zig.
pub const RUNTIME_TRANSPILER_CACHE_VERSION: u32 = 20;

pub struct RuntimeTranspilerCache {
    pub input_hash: Option<u64>,
    pub input_byte_length: Option<u64>,
    pub features_hash: Option<u64>,
    pub exports_kind: js_ast::ExportsKind,
    /// Zig: `?bun.String` — bundler only stores/reads the bytes; T6 owns the
    /// `bun.String` wrapper when surfacing to JS.
    pub output_code: Option<Box<[u8]>>,
    pub entry: Option<RuntimeTranspilerCacheEntry>,
    /// Set via env var `BUN_RUNTIME_TRANSPILER_CACHE=0`; T6 init writes this.
    pub is_disabled: bool,
}

impl Default for RuntimeTranspilerCache {
    fn default() -> Self {
        Self {
            input_hash: None,
            input_byte_length: None,
            features_hash: None,
            exports_kind: js_ast::ExportsKind::None,
            output_code: None,
            entry: None,
            is_disabled: false,
        }
    }
}

/// Mirrors the Zig `pub var is_disabled` mutable global — written by T6
/// (src/runtime/cli/Arguments.zig:1603, src/jsc/VirtualMachine.zig:1383) and
/// flipped lazily on cache-dir resolution failure. Module-level so those
/// writers can reach it; `disabled()` reads it.
pub static DISABLED: AtomicBool = AtomicBool::new(false);

impl RuntimeTranspilerCache {
    /// Mirrors the Zig `pub var is_disabled` namespaced const — kept as an
    /// associated fn so call-sites read `RuntimeTranspilerCache::is_disabled()`.
    #[inline]
    pub fn disabled() -> bool {
        DISABLED.load(Ordering::Relaxed)
            || bun_core::env_var::BUN_RUNTIME_TRANSPILER_CACHE_PATH
                .get()
                .map(|v| v.is_empty() || v == b"0")
                .unwrap_or(false)
    }

    #[inline]
    pub fn set_disabled(v: bool) {
        DISABLED.store(v, Ordering::Relaxed);
    }
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
#[derive(Default, Clone, Copy)]
pub struct RuntimeTranspilerCacheMetadata {
    pub cache_version: u32,
    pub output_encoding: u8, // Encoding
    pub module_type: u8,     // ModuleType
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

pub struct Set {
    pub js: JavaScript,
    pub fs: Fs,
    pub json: Json,
}

impl Set {
    pub fn init() -> Set {
        Set {
            js: JavaScript::init(),
            fs: Fs {
                shared_buffer: MutableString::init(0).expect("unreachable"),
                macro_shared_buffer: MutableString::init(0).expect("unreachable"),
                use_alternate_source_cache: false,
                stream: false,
            },
            json: Json {},
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

#[repr(C)]
pub struct ExternalFreeFunction {
    pub ctx: *mut c_void,
    pub function: Option<unsafe extern "C" fn(*mut c_void)>,
}

impl ExternalFreeFunction {
    pub const NONE: ExternalFreeFunction = ExternalFreeFunction {
        ctx: core::ptr::null_mut(),
        function: None,
    };

    pub fn call(&self) {
        if let Some(func) = self.function {
            // SAFETY: ctx was provided by the same native plugin that provided `function`
            unsafe { func(self.ctx) };
        }
    }
}

impl Default for ExternalFreeFunction {
    fn default() -> Self {
        Self::NONE
    }
}

/// Port of `Fs.Entry` (cache.zig:19). `contents` is a lifetime-erased slice
/// (`string` in Zig) that may borrow:
///   • the per-thread `shared_buffer` (when `use_shared_buffer`),
///   • a `Box::leak`ed allocation owned by this entry (default-allocator path),
///   • native-plugin memory freed via `external_free_function`, or
///   • static/arena bytes the caller keeps alive.
/// Ownership is **manual** (`deinit`), matching Zig — callers thread `Entry`
/// through `logger::Source.contents: &'static [u8]` and free explicitly.
pub struct Entry {
    pub contents: &'static [u8],
    pub fd: Fd,
    /// When `contents` comes from a native plugin, this field is populated
    /// with information on how to free it.
    pub external_free_function: ExternalFreeFunction,
}

impl Default for Entry {
    fn default() -> Self {
        Entry { contents: b"", fd: Fd::INVALID, external_free_function: ExternalFreeFunction::NONE }
    }
}

impl Entry {
    /// Convenience: take ownership of a heap buffer, leak it into the
    /// lifetime-erased `contents` slot. `deinit` reconstitutes and frees it.
    pub fn new(contents: Box<[u8]>, fd: Fd, external_free_function: ExternalFreeFunction) -> Entry {
        // PORT NOTE: Zig stored an allocator+slice pair; Rust leaks the Box
        // and reclaims it in `deinit` to keep `contents` a plain `&[u8]`
        // assignable to `logger::Source.contents`.
        let contents: &'static [u8] =
            if contents.is_empty() { b"" } else { Box::leak(contents) };
        Entry { contents, fd, external_free_function }
    }

    #[inline]
    pub fn contents(&self) -> &[u8] {
        self.contents
    }

    /// Port of `Entry.deinit` (cache.zig:39). NOT `Drop` — Zig callers free
    /// explicitly (and frequently hand `contents` off to a `Source` that
    /// outlives the `Entry`).
    pub fn deinit(&mut self) {
        if let Some(func) = self.external_free_function.function {
            // SAFETY: ctx/function pair was supplied together by the native plugin.
            unsafe { func(self.external_free_function.ctx) };
        } else if !self.contents.is_empty() {
            // SAFETY: ARENA — `contents` was produced by `Box::leak` in
            // `Entry::new` / `read_file*`; reconstructing the Box matches Zig's
            // `allocator.free(entry.contents)`. Callers that stored a borrowed
            // (shared-buffer / static) slice must NOT call `deinit` — same
            // contract as the Zig original.
            unsafe {
                drop(Box::<[u8]>::from_raw(core::ptr::slice_from_raw_parts_mut(
                    self.contents.as_ptr() as *mut u8,
                    self.contents.len(),
                )));
            }
            self.contents = b"";
        }
    }
}

impl Entry {
    pub fn close_fd(&mut self) -> Option<bun_sys::Error> {
        use bun_sys::FdExt as _;
        if self.fd.is_valid() {
            let fd = self.fd;
            self.fd = Fd::INVALID;
            // TODO(port): @returnAddress() has no stable Rust equivalent; pass None for now
            return fd.close_allowing_bad_file_descriptor(None);
        }
        None
    }
}

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
        if core::ptr::eq(buffer, &self.shared_buffer) {
            core::mem::replace(&mut self.shared_buffer, MutableString::init_empty())
        } else if core::ptr::eq(buffer, &self.macro_shared_buffer) {
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
    /// resolver's CYCLEBREAK `FsCache` forward-decl already pinned this shape.
    /// PERF(port): re-monomorphize once both callers stabilize.
    ///
    /// PORT NOTE: `allocator` is dropped — Zig forwarded it to
    /// `readFileWithHandleAndAllocator`; the only effect was choosing which
    /// heap owns the non-shared-buffer read. The Rust path always allocates
    /// from the global heap (via `Box::leak`); arena callers can pass through
    /// the resolver's bump-backed forward-decl instead.
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

    /// Inlined subset of `RealFS.readFileWithHandleAndAllocator` (fs.zig:1564) —
    /// the resolver's port of that method is still in the gated `fs_full` module,
    /// so we go to `bun_sys` directly. Returns a `'static` slice per the `Entry`
    /// contract above (borrows `shared_buffer` when `use_shared_buffer`, else a
    /// `Box::leak`).
    // TODO(port): switch back to `rfs.read_file_with_handle_and_allocator` once
    // `bun_resolver::fs_full` un-gates; this drops the BOM-strip / pread-loop
    // refinements that path carries.
    fn read_handle_into(
        file: &bun_sys::File,
        _path: &[u8],
        use_shared_buffer: bool,
        shared: &mut MutableString,
        _stream: bool,
    ) -> Result<&'static [u8], bun_core::Error> {
        if use_shared_buffer {
            shared.reset();
            let size = file.get_end_pos().map_err(bun_core::Error::from)?;
            if size == 0 {
                // SAFETY: ARENA — the empty slice into `shared.list` is what Zig
                // returned; callers treat it as borrowed-until-reset.
                return Ok(b"");
            }
            shared.list.reserve(size + 1);
            // SAFETY: capacity reserved above; `read_all` writes initialized bytes
            // and we set_len to exactly the count returned.
            let n = unsafe {
                let dst = core::slice::from_raw_parts_mut(
                    shared.list.as_mut_ptr(),
                    shared.list.capacity(),
                );
                let n = file.read_all(dst).map_err(bun_core::Error::from)?;
                shared.list.set_len(n);
                n
            };
            // Sentinel NUL past len when capacity allows (matches fs.zig:1671).
            if shared.list.capacity() > n {
                // SAFETY: capacity > len, so writing one byte past len is in-bounds.
                unsafe { *shared.list.as_mut_ptr().add(n) = 0 };
            }
            // SAFETY: ARENA — lifetime-erase the borrow of `shared.list`. Zig
            // hands this slice straight to `logger::Source.contents`; the
            // caller owns `shared` and resets it via `reset_shared_buffer`
            // before reuse.
            Ok(unsafe { core::slice::from_raw_parts(shared.list.as_ptr(), n) })
        } else {
            let bytes = file.read_to_end().map_err(bun_core::Error::from)?;
            if bytes.is_empty() {
                return Ok(b"");
            }
            // SAFETY: see `Entry::deinit` — reclaimed there via `Box::from_raw`.
            Ok(Box::leak(bytes.into_boxed_slice()))
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
                // PORT NOTE: reshaped for borrowck — `parser` holds `&'a mut temp_log`
                // (inside the lexer); reading `temp_log.errors` while that borrow is
                // live is rejected. Read through the parser's own handle instead.
                if parser.log_mut().errors == 0 {
                    log.add_range_error(Some(source), parser.lexer.range(), err.name())
                        .expect("unreachable");
                }
                drop(parser);
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Ok(None);
            }
        };

        drop(parser);
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

pub struct Json {}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JsonMode {
    Json,
    Jsonc,
}

impl Json {
    pub fn init() -> Json {
        Json {}
    }
}

// `bun_interchange::json_parser::Expr` is the real `bun_logger::js_ast::Expr`
// (T2 value-subset). Bodies call straight through to `json_parser::parse*`.
impl Json {
    fn parse<F>(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
        func: F,
    ) -> Result<Option<json_parser::Expr>, bun_core::Error>
    where
        F: FnOnce(&logger::Source, &mut logger::Log, &Bump) -> Result<json_parser::Expr, bun_core::Error>,
    {
        // PORT NOTE: `comptime force_utf8` is baked into `F` via turbofish at the
        // call site instead of forwarded as a runtime arg.
        let mut temp_log = logger::Log::init();
        // PORT NOTE: reshaped for borrowck — Zig `defer temp_log.appendToMaybeRecycled(...)`
        let result = match func(source, &mut temp_log, bump) {
            Ok(expr) => Some(expr),
            Err(_) => None,
        };
        let _ = temp_log.append_to_maybe_recycled(log, source);
        Ok(result)
    }

    pub fn parse_json<const FORCE_UTF8: bool>(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
        mode: JsonMode,
    ) -> Result<Option<json_parser::Expr>, bun_core::Error> {
        // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
        // They are JSON files with comments and trailing commas.
        // Sometimes tooling expects this to work.
        if mode == JsonMode::Jsonc {
            return self.parse(log, source, bump, json_parser::parse_ts_config::<FORCE_UTF8>);
        }

        self.parse(log, source, bump, json_parser::parse::<FORCE_UTF8>)
    }

    pub fn parse_package_json<const FORCE_UTF8: bool>(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
    ) -> Result<Option<json_parser::Expr>, bun_core::Error> {
        self.parse(log, source, bump, json_parser::parse_ts_config::<FORCE_UTF8>)
    }

    pub fn parse_ts_config(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
    ) -> Result<Option<json_parser::Expr>, bun_core::Error> {
        self.parse(log, source, bump, json_parser::parse_ts_config::<true>)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/cache.zig (334 lines)
//   confidence: medium
//   todos:      3
//   notes:      Entry.contents is lifetime-erased &'static [u8] (manual deinit) to flow into Source.contents;
//               Fs::read_handle_into inlines RealFS.readFileWithHandle until bun_resolver::fs_full un-gates;
//               Fs.deinit (Zig) was dead code (referenced nonexistent `c.entries`).
// ──────────────────────────────────────────────────────────────────────────
