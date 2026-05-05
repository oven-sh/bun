use core::ffi::c_void;

use bun_alloc::Arena as Bump;
use bun_core::{self, feature_flags, Global, Output};
use bun_js_parser::{self as js_parser, ast as js_ast};
use bun_logger as logger;
use bun_fs as fs_mod;
use bun_str::{strings, MutableString, ZStr};
use bun_sys::{self, Fd};

use crate::defines::Define;

// TODO(port): verify crate path for `bun.json` (json_parser)
use bun_interchange::json_parser;

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

bun_output::declare_scope!(fs, visible);

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

pub struct Entry {
    // TODO(port): lifetime — `contents` is either allocator-owned (freed in deinit)
    // OR native-plugin-owned (freed via `external_free_function`). Phase B: model as
    // a tagged owner enum so `Drop` can dispatch correctly without an allocator param.
    pub contents: Box<[u8]>,
    pub fd: Fd,
    /// When `contents` comes from a native plugin, this field is populated
    /// with information on how to free it.
    pub external_free_function: ExternalFreeFunction,
}

impl Drop for Entry {
    fn drop(&mut self) {
        if let Some(func) = self.external_free_function.function {
            // SAFETY: ctx/function pair was supplied together by the native plugin
            unsafe { func(self.external_free_function.ctx) };
            // TODO(port): in this branch `contents` aliases plugin-owned memory; Box drop
            // below would double-free. Phase B: store contents as ManuallyDrop or raw slice.
            core::mem::forget(core::mem::take(&mut self.contents));
        } else {
            // contents (Box<[u8]>) drops automatically
        }
    }
}

impl Entry {
    pub fn close_fd(&mut self) -> Option<bun_sys::Error> {
        if self.fd.is_valid() {
            let fd = self.fd;
            self.fd = Fd::INVALID;
            // TODO(port): @returnAddress() has no stable Rust equivalent; pass null for now
            return fd.close_allowing_bad_file_descriptor(core::ptr::null());
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
    /// switch out the shared buffer so that it is not in use
    /// The caller must
    pub fn reset_shared_buffer(&mut self, buffer: *const MutableString) {
        if core::ptr::eq(buffer, &self.shared_buffer) {
            self.shared_buffer = MutableString::init_empty();
        } else if core::ptr::eq(buffer, &self.macro_shared_buffer) {
            self.macro_shared_buffer = MutableString::init_empty();
        } else {
            unreachable!("resetSharedBuffer: invalid buffer");
        }
    }

    // TODO(port): Zig `Fs.deinit` references `c.entries` which is not a field on `Fs` —
    // dead code (Zig lazy compilation never instantiated it). No Drop impl needed beyond
    // the auto-drop of `shared_buffer` / `macro_shared_buffer`.

    pub fn read_file_shared(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &ZStr,
        cached_file_descriptor: Option<Fd>,
        shared: &mut MutableString,
    ) -> Result<Entry, bun_core::Error> {
        // TODO(port): narrow error set
        let rfs = &mut _fs.fs;

        // TODO(port): Zig used `std.fs.File`; map to bun_sys::File / Fd. seekTo / openFileAbsoluteZ
        // need bun_sys equivalents.
        let file_handle: bun_sys::File = if let Some(fd) = cached_file_descriptor {
            let handle = bun_sys::File::from_fd(fd);
            handle.seek_to(0)?;
            handle
        } else {
            bun_sys::open_file_absolute_z(path, bun_sys::OpenFlags::READ_ONLY)?
        };

        let will_close = rfs.need_to_close_files() && cached_file_descriptor.is_none();
        let file_handle = scopeguard::guard(file_handle, |fh| {
            if will_close {
                fh.close();
            }
        });

        let file = if self.stream {
            match rfs.read_file_with_handle(path.as_bytes(), None, &*file_handle, true, shared, true) {
                Ok(f) => f,
                Err(err) => {
                    if cfg!(debug_assertions) {
                        Output::print_error(format_args!(
                            "{}: readFile error -- {}",
                            bstr::BStr::new(path.as_bytes()),
                            err.name()
                        ));
                    }
                    return Err(err);
                }
            }
        } else {
            match rfs.read_file_with_handle(path.as_bytes(), None, &*file_handle, true, shared, false) {
                Ok(f) => f,
                Err(err) => {
                    if cfg!(debug_assertions) {
                        Output::print_error(format_args!(
                            "{}: readFile error -- {}",
                            bstr::BStr::new(path.as_bytes()),
                            err.name()
                        ));
                    }
                    return Err(err);
                }
            }
        };

        Ok(Entry {
            contents: file.contents,
            fd: if feature_flags::STORE_FILE_DESCRIPTORS {
                file_handle.fd()
            } else {
                // TODO(port): Zig used `0` here; map to Fd::from_raw(0) or Fd::INVALID
                Fd::INVALID
            },
            external_free_function: ExternalFreeFunction::NONE,
        })
    }

    pub fn read_file<const USE_SHARED_BUFFER: bool>(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        _file_handle: Option<Fd>,
    ) -> Result<Entry, bun_core::Error> {
        self.read_file_with_allocator::<USE_SHARED_BUFFER>(_fs, path, dirname_fd, _file_handle)
    }

    pub fn read_file_with_allocator<const USE_SHARED_BUFFER: bool>(
        &mut self,
        _fs: &mut fs_mod::FileSystem,
        path: &[u8],
        dirname_fd: Fd,
        _file_handle: Option<Fd>,
    ) -> Result<Entry, bun_core::Error> {
        // TODO(port): narrow error set
        // TODO(port): Zig took `allocator: std.mem.Allocator` and forwarded it to
        // `readFileWithHandleAndAllocator`. In-file caller passes `bun.default_allocator`,
        // so the param is dropped here; Phase B: confirm no external caller passes an arena.
        let rfs = &mut _fs.fs;

        // TODO(port): Zig used `std.fs.File` + `.stdFile()`; using bun_sys::File here.
        // PORT NOTE: reshaped — Zig declared `file_handle = undefined` then assigned on each
        // branch; restructured into a single let-expression to avoid `mem::zeroed()` on a
        // type that may have niche (NonZero) fields.
        let file_handle: bun_sys::File = if let Some(f) = _file_handle {
            let handle = f.std_file();
            handle.seek_to(0)?;
            handle
        } else if feature_flags::STORE_FILE_DESCRIPTORS && dirname_fd.is_valid() {
            'brk: {
                match bun_sys::openat_a(dirname_fd, bun_paths::basename(path), bun_sys::O::RDONLY, 0)
                    .unwrap_result()
                {
                    Ok(fd) => fd,
                    Err(err) if err == bun_core::err!("ENOENT") => {
                        let handle = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)?;
                        Output::pretty_errorln(format_args!(
                            "<r><d>Internal error: directory mismatch for directory \"{}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                            bstr::BStr::new(path),
                            dirname_fd,
                        ));
                        break 'brk Fd::from_std_file(handle);
                    }
                    Err(err) => return Err(err),
                }
            }
            .std_file()
        } else {
            bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)?
        };

        #[cfg(not(windows))] // skip on Windows because NTCreateFile will do it.
        bun_output::scoped_log!(
            fs,
            "openat({}, {}) = {}",
            dirname_fd,
            bstr::BStr::new(path),
            Fd::from_std_file(&file_handle)
        );

        let will_close = rfs.need_to_close_files() && _file_handle.is_none();
        let file_handle = scopeguard::guard(file_handle, move |fh| {
            if will_close {
                bun_output::scoped_log!(
                    fs,
                    "readFileWithAllocator close({})",
                    fs_mod::print_handle(fh.fd())
                );
                fh.close();
            }
        });

        // PORT NOTE: reshaped for borrowck — capture `stream` scalar before borrowing the
        // shared buffer. `self` and `_fs` are disjoint params, so `shared` (&mut into self)
        // does not conflict with `rfs` (&mut into _fs).
        let stream = self.stream;
        let shared = self.shared_buffer();

        let file = if stream {
            match rfs.read_file_with_handle_and_allocator(
                path,
                None,
                &*file_handle,
                USE_SHARED_BUFFER,
                shared,
                true,
            ) {
                Ok(f) => f,
                Err(err) => {
                    if cfg!(debug_assertions) {
                        Output::print_error(format_args!(
                            "{}: readFile error -- {}",
                            bstr::BStr::new(path),
                            err.name()
                        ));
                    }
                    return Err(err);
                }
            }
        } else {
            match rfs.read_file_with_handle_and_allocator(
                path,
                None,
                &*file_handle,
                USE_SHARED_BUFFER,
                shared,
                false,
            ) {
                Ok(f) => f,
                Err(err) => {
                    if cfg!(debug_assertions) {
                        Output::print_error(format_args!(
                            "{}: readFile error -- {}",
                            bstr::BStr::new(path),
                            err.name()
                        ));
                    }
                    return Err(err);
                }
            }
        };

        Ok(Entry {
            contents: file.contents,
            fd: if feature_flags::STORE_FILE_DESCRIPTORS && !will_close {
                Fd::from_std_file(&*file_handle)
            } else {
                Fd::INVALID
            },
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

    // For now, we're not going to cache JavaScript ASTs.
    // It's probably only relevant when bundling for production.
    pub fn parse(
        &self,
        bump: &Bump,
        opts: js_parser::parser::Options,
        defines: &mut Define,
        log: &mut logger::Log,
        source: &logger::Source,
    ) -> Result<Option<js_ast::Result>, bun_core::Error> {
        let mut temp_log = logger::Log::init(bump);
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
                if temp_log.errors == 0 {
                    log.add_range_error(source, parser.lexer.range(), err.name())
                        .expect("unreachable");
                }
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Ok(None);
            }
        };

        let _ = temp_log.append_to_maybe_recycled(log, source);
        Ok(Some(result))
    }

    pub fn scan(
        &mut self,
        bump: &Bump,
        scan_pass_result: &mut js_parser::ScanPassResult,
        opts: js_parser::parser::Options,
        defines: &mut Define,
        log: &mut logger::Log,
        source: &logger::Source,
    ) -> Result<(), bun_core::Error> {
        if strings::trim(source.contents(), b"\n\t\r ").is_empty() {
            return Ok(());
        }

        let mut temp_log = logger::Log::init(bump);
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

    fn parse<F, const FORCE_UTF8: bool>(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
        func: F,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error>
    where
        F: FnOnce(&logger::Source, &mut logger::Log, &Bump, bool) -> Result<js_ast::Expr, bun_core::Error>,
    {
        let mut temp_log = logger::Log::init(bump);
        // PORT NOTE: reshaped for borrowck — Zig `defer temp_log.appendToMaybeRecycled(...)`
        let result = match func(source, &mut temp_log, bump, FORCE_UTF8) {
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
    ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
        // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
        // They are JSON files with comments and trailing commas.
        // Sometimes tooling expects this to work.
        if mode == JsonMode::Jsonc {
            return self.parse::<_, FORCE_UTF8>(log, source, bump, json_parser::parse_ts_config);
        }

        self.parse::<_, FORCE_UTF8>(log, source, bump, json_parser::parse)
    }

    pub fn parse_package_json<const FORCE_UTF8: bool>(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
        self.parse::<_, FORCE_UTF8>(log, source, bump, json_parser::parse_ts_config)
    }

    pub fn parse_ts_config(
        &mut self,
        log: &mut logger::Log,
        source: &logger::Source,
        bump: &Bump,
    ) -> Result<Option<js_ast::Expr>, bun_core::Error> {
        self.parse::<_, true>(log, source, bump, json_parser::parse_ts_config)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/cache.zig (334 lines)
//   confidence: medium
//   todos:      11
//   notes:      Entry.contents has dual ownership (allocator vs plugin); Fs.deinit was dead Zig; std.fs.File mapped to bun_sys::File with stub method names
// ──────────────────────────────────────────────────────────────────────────
