use core::ffi::{c_char, c_int, c_long, c_void};
use core::fmt::{self, Write as _};
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::Once;

use bstr::BStr;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{env_var, fmt as bun_fmt, Output};
use bun_jsc::{
    self as jsc, host_fn, CallFrame, JSGlobalObject, JSObject, JSPropertyIterator, JSValue,
    JsError, JsResult, ModuleLoader, SystemError, VirtualMachine,
};
use bun_napi as napi;
use bun_paths::{self as path, PathBuffer, MAX_PATH_BYTES};
use bun_resolver::fs as Fs;
use bun_str::{strings, ZStr, ZigString};
use bun_sys::{self, Fd};

#[cfg(feature = "tinycc")]
use bun_tcc_sys as TCC;
#[cfg(not(feature = "tinycc"))]
mod TCC {
    // TODO(port): stub State when tinycc is disabled
    pub struct State;
    impl State {
        pub fn deinit(&mut self) {}
    }
}

bun_output::declare_scope!(TCC, visible);

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn pthread_jit_write_protect_np(enable: c_int);
}

/// Get the last dynamic library loading error message in a cross-platform way.
/// On POSIX systems, this calls dlerror().
/// On Windows, this uses GetLastError() and formats the error message.
/// Returns an allocated string that must be freed by the caller.
fn get_dl_error() -> Result<Box<[u8]>, bun_core::Error> {
    #[cfg(windows)]
    {
        // On Windows, we need to use GetLastError() and FormatMessageW()
        let err = bun_sys::windows::GetLastError();
        let err_int = err as u32;

        // For now, just return the error code as we'd need to implement FormatMessageW in Zig
        // This is still better than a generic message
        let mut v = Vec::new();
        write!(&mut v, "error code {}", err_int).ok();
        Ok(v.into_boxed_slice())
    }
    #[cfg(not(windows))]
    {
        // On POSIX systems, use dlerror() to get the actual system error
        // SAFETY: dlerror is safe to call from any thread
        let msg: &[u8] = unsafe {
            let p = libc::dlerror();
            if !p.is_null() {
                core::ffi::CStr::from_ptr(p).to_bytes()
            } else {
                b"unknown error"
            }
        };
        // Return a copy since dlerror() string is not stable
        Ok(Box::<[u8]>::from(msg))
    }
}

/// Run a function that needs to write to JIT-protected memory.
///
/// This is dangerous as it allows overwriting executable regions of memory.
/// Do not pass in user-defined functions (including JSFunctions).
fn dangerously_run_without_jit_protections<R>(func: impl FnOnce() -> R) -> R {
    const HAS_PROTECTION: bool = cfg!(all(target_arch = "aarch64", target_os = "macos"));
    if HAS_PROTECTION {
        // SAFETY: aarch64 macOS only; toggles W^X for the current thread
        unsafe { pthread_jit_write_protect_np(false as c_int) };
    }
    let _guard = scopeguard::guard((), |_| {
        if HAS_PROTECTION {
            // SAFETY: re-enable JIT write protection on scope exit
            unsafe { pthread_jit_write_protect_np(true as c_int) };
        }
    });
    // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
    func()
}

#[repr(C)]
struct Offsets {
    js_array_buffer_view_offset_of_length: u32,
    js_array_buffer_view_offset_of_byte_offset: u32,
    js_array_buffer_view_offset_of_vector: u32,
    js_cell_offset_of_type: u32,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    #[link_name = "Bun__FFI__offsets"]
    static mut BUN_FFI_OFFSETS: Offsets;
    #[link_name = "Bun__FFI__ensureOffsetsAreLoaded"]
    fn bun_ffi_ensure_offsets_are_loaded();
}

impl Offsets {
    fn load_once() {
        // SAFETY: extern "C" fn populating a static
        unsafe { bun_ffi_ensure_offsets_are_loaded() };
    }
    pub fn get() -> &'static Offsets {
        static ONCE: Once = Once::new();
        ONCE.call_once(Self::load_once);
        // SAFETY: BUN_FFI_OFFSETS is initialized by load_once and never mutated after
        unsafe { &*core::ptr::addr_of!(BUN_FFI_OFFSETS) }
    }
}

#[bun_jsc::JsClass]
pub struct FFI {
    pub dylib: Option<bun_sys::DynLib>, // TODO(port): std.DynLib equivalent
    pub functions: StringArrayHashMap<Function>,
    pub closed: bool,
    pub shared_state: Option<NonNull<TCC::State>>,
}

impl Default for FFI {
    fn default() -> Self {
        Self {
            dylib: None,
            functions: StringArrayHashMap::default(),
            closed: false,
            shared_state: None,
        }
    }
}

impl FFI {
    pub fn finalize(_this: *mut FFI) {}
}

// ─── CompileC ───────────────────────────────────────────────────────────────

struct CompileC {
    source: Source,
    current_file_for_errors: Box<ZStr>, // TODO(port): lifetime — Zig stored borrowed [:0]const u8
    libraries: StringArray,
    library_dirs: StringArray,
    include_dirs: StringArray,
    symbols: SymbolsMap,
    define: Vec<[Box<ZStr>; 2]>,
    /// Flags to replace the default flags
    flags: Box<ZStr>,
    deferred_errors: Vec<Box<[u8]>>,
}

impl Default for CompileC {
    fn default() -> Self {
        Self {
            source: Source::File(ZStr::empty()),
            current_file_for_errors: ZStr::empty(),
            libraries: StringArray::default(),
            library_dirs: StringArray::default(),
            include_dirs: StringArray::default(),
            symbols: SymbolsMap::default(),
            define: Vec::new(),
            flags: ZStr::empty(),
            deferred_errors: Vec::new(),
        }
    }
}

enum Source {
    File(Box<ZStr>),
    Files(Vec<Box<ZStr>>),
}

impl Source {
    pub fn first(&self) -> &ZStr {
        match self {
            Source::File(f) => f,
            Source::Files(files) => &files[0],
        }
    }

    pub fn add(
        &self,
        state: &mut TCC::State,
        current_file_for_errors: &mut Box<ZStr>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        match self {
            Source::File(file) => {
                *current_file_for_errors = file.clone(); // TODO(port): Zig stored borrowed slice
                state
                    .add_file(file)
                    .map_err(|_| bun_core::err!("CompilationError"))?;
                *current_file_for_errors = ZStr::empty();
            }
            Source::Files(files) => {
                for file in files {
                    *current_file_for_errors = file.clone();
                    state
                        .add_file(file)
                        .map_err(|_| bun_core::err!("CompilationError"))?;
                    *current_file_for_errors = ZStr::empty();
                }
            }
        }
        Ok(())
    }
}

// ─── stdarg ─────────────────────────────────────────────────────────────────

mod stdarg {
    use super::*;

    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        pub fn ffi_vfprintf(_: *mut c_void, _: *const c_char, ...) -> c_int;
        pub fn ffi_vprintf(_: *const c_char, ...) -> c_int;
        pub fn ffi_fprintf(_: *mut c_void, _: *const c_char, ...) -> c_int;
        pub fn ffi_printf(_: *const c_char, ...) -> c_int;
        pub fn ffi_fscanf(_: *mut c_void, _: *const c_char, ...) -> c_int;
        pub fn ffi_scanf(_: *const c_char, ...) -> c_int;
        pub fn ffi_sscanf(_: *const c_char, _: *const c_char, ...) -> c_int;
        pub fn ffi_vsscanf(_: *const c_char, _: *const c_char, ...) -> c_int;
        pub fn ffi_fopen(_: *const c_char, _: *const c_char) -> *mut c_void;
        pub fn ffi_fclose(_: *mut c_void) -> c_int;
        pub fn ffi_fgetc(_: *mut c_void) -> c_int;
        pub fn ffi_fputc(c: c_int, _: *mut c_void) -> c_int;
        pub fn ffi_feof(_: *mut c_void) -> c_int;
        pub fn ffi_fileno(_: *mut c_void) -> c_int;
        pub fn ffi_ungetc(c: c_int, _: *mut c_void) -> c_int;
        pub fn ffi_ftell(_: *mut c_void) -> c_long;
        pub fn ffi_fseek(_: *mut c_void, _: c_long, _: c_int) -> c_int;
        pub fn ffi_fflush(_: *mut c_void) -> c_int;

        pub fn calloc(nmemb: usize, size: usize) -> *mut c_void;
        pub fn perror(_: *const c_char);
    }

    #[cfg(target_os = "macos")]
    mod mac {
        use super::*;
        unsafe extern "C" {
            #[link_name = "__stdinp"]
            static mut FFI_STDINP: *mut c_void;
            #[link_name = "__stdoutp"]
            static mut FFI_STDOUTP: *mut c_void;
            #[link_name = "__stderrp"]
            static mut FFI_STDERRP: *mut c_void;
        }

        pub fn inject(state: &mut TCC::State) {
            // SAFETY: reading addresses of process-global FILE* pointers
            unsafe {
                state
                    .add_symbols(&[
                        ("__stdinp", FFI_STDINP),
                        ("__stdoutp", FFI_STDOUTP),
                        ("__stderrp", FFI_STDERRP),
                    ])
                    .expect("Failed to add macos symbols");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    mod mac {
        use super::*;
        pub fn inject(_: &mut TCC::State) {}
    }

    pub fn inject(state: &mut TCC::State) {
        // TODO(port): TCC::State::add_symbols API — Zig used addSymbolsComptime over a struct literal
        state
            .add_symbols(&[
                // printf family
                ("vfprintf", ffi_vfprintf as *const c_void),
                ("vprintf", ffi_vprintf as *const c_void),
                ("fprintf", ffi_fprintf as *const c_void),
                ("printf", ffi_printf as *const c_void),
                ("fscanf", ffi_fscanf as *const c_void),
                ("scanf", ffi_scanf as *const c_void),
                ("sscanf", ffi_sscanf as *const c_void),
                ("vsscanf", ffi_vsscanf as *const c_void),
                // files
                ("fopen", ffi_fopen as *const c_void),
                ("fclose", ffi_fclose as *const c_void),
                ("fgetc", ffi_fgetc as *const c_void),
                ("fputc", ffi_fputc as *const c_void),
                ("feof", ffi_feof as *const c_void),
                ("fileno", ffi_fileno as *const c_void),
                ("fwrite", libc::fwrite as *const c_void),
                ("ungetc", ffi_ungetc as *const c_void),
                ("ftell", ffi_ftell as *const c_void),
                ("fseek", ffi_fseek as *const c_void),
                ("fflush", ffi_fflush as *const c_void),
                ("fread", libc::fread as *const c_void),
                // memory
                ("malloc", libc::malloc as *const c_void),
                ("realloc", libc::realloc as *const c_void),
                ("calloc", calloc as *const c_void),
                ("free", libc::free as *const c_void),
                // error
                ("perror", perror as *const c_void),
            ])
            .expect("Failed to add std.c symbols");

        #[cfg(unix)]
        {
            state
                .add_symbols(&[
                    ("posix_memalign", libc::posix_memalign as *const c_void),
                    ("dlopen", libc::dlopen as *const c_void),
                    ("dlclose", libc::dlclose as *const c_void),
                    ("dlsym", libc::dlsym as *const c_void),
                    ("dlerror", libc::dlerror as *const c_void),
                ])
                .expect("Failed to add posix symbols");
        }

        mac::inject(state);
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum DeferredError {
    #[error("DeferredErrors")]
    DeferredErrors,
}

impl CompileC {
    pub extern "C" fn handle_compilation_error(
        this_: Option<&mut CompileC>,
        message: Option<NonNull<c_char>>,
    ) {
        let Some(this) = this_ else { return };
        // SAFETY: TCC guarantees message is a valid NUL-terminated string when non-null
        let mut msg: &[u8] = match message {
            Some(p) => unsafe { core::ffi::CStr::from_ptr(p.as_ptr()) }.to_bytes(),
            None => b"",
        };
        if msg.is_empty() {
            return;
        }

        let mut offset: usize = 0;
        // the message we get from TCC sometimes has garbage in it
        // i think because we're doing in-memory compilation
        while offset < msg.len() {
            if msg[offset] > 0x20 && msg[offset] < 0x7f {
                break;
            }
            offset += 1;
        }
        msg = &msg[offset..];

        this.deferred_errors.push(Box::<[u8]>::from(msg));
    }

    #[inline]
    fn has_deferred_errors(&self) -> bool {
        !self.deferred_errors.is_empty()
    }

    /// Returns DeferredError if any errors from tinycc were registered
    /// via `handle_compilation_error`
    #[inline]
    fn error_check(&self) -> Result<(), DeferredError> {
        if !self.deferred_errors.is_empty() {
            return Err(DeferredError::DeferredErrors);
        }
        Ok(())
    }

    pub const DEFAULT_TCC_OPTIONS: &'static str = "-std=c11 -Wl,--export-all-symbols -g -O2";

    // TODO(port): these mutable statics need a safe wrapper (RwLock or OnceLock<Box<ZStr>>)
    static mut CACHED_DEFAULT_SYSTEM_INCLUDE_DIR: &'static ZStr = ZStr::EMPTY;
    static mut CACHED_DEFAULT_SYSTEM_LIBRARY_DIR: &'static ZStr = ZStr::EMPTY;
    static CACHED_DEFAULT_SYSTEM_INCLUDE_DIR_ONCE: Once = Once::new();

    fn get_system_root_dir_once() {
        #[cfg(target_os = "macos")]
        {
            let mut which_buf = PathBuffer::uninit();

            let process = match bun_runtime::api::process::spawn_sync(
                &bun_runtime::api::process::SpawnOptions {
                    stdout: bun_runtime::api::process::Stdio::Buffer,
                    stdin: bun_runtime::api::process::Stdio::Ignore,
                    stderr: bun_runtime::api::process::Stdio::Ignore,
                    argv: &[
                        bun_core::which(
                            &mut which_buf,
                            // SAFETY: getenv result valid for process lifetime
                            unsafe {
                                let p = libc::getenv(b"PATH\0".as_ptr() as *const c_char);
                                if p.is_null() {
                                    b""
                                } else {
                                    bun_str::slice_to_nul(core::slice::from_raw_parts(
                                        p as *const u8,
                                        usize::MAX,
                                    ))
                                }
                            },
                            Fs::FileSystem::instance().top_level_dir,
                            b"xcrun",
                        )
                        .unwrap_or(b"/usr/bin/xcrun"),
                        b"-sdk",
                        b"macosx",
                        b"-show-sdk-path",
                    ],
                    // SAFETY: environ is process-global
                    envp: unsafe { libc::environ as _ },
                    ..Default::default()
                },
            ) {
                Ok(p) => p,
                Err(_) => return,
            };
            if let bun_sys::Result::Ok(result) = process {
                if result.is_ok() {
                    let stdout = result.stdout.as_slice();
                    if !stdout.is_empty() {
                        // SAFETY: writing once-initialized static under Once guard
                        unsafe {
                            CACHED_DEFAULT_SYSTEM_INCLUDE_DIR = Box::leak(
                                ZStr::from_bytes(strings::trim(stdout, b"\n\r")).into(),
                            );
                        }
                    }
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            // On Debian/Ubuntu, the lib and include paths are suffixed with {arch}-linux-gnu
            // e.g. x86_64-linux-gnu or aarch64-linux-gnu
            // On Alpine and RHEL-based distros, the paths are not suffixed

            #[cfg(target_arch = "x86_64")]
            {
                // SAFETY: writing once-initialized statics under Once guard
                unsafe {
                    if Fd::cwd()
                        .directory_exists_at(b"/usr/include/x86_64-linux-gnu")
                        .is_true()
                    {
                        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR =
                            ZStr::from_static(b"/usr/include/x86_64-linux-gnu\0");
                    } else if Fd::cwd().directory_exists_at(b"/usr/include").is_true() {
                        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR = ZStr::from_static(b"/usr/include\0");
                    }

                    if Fd::cwd()
                        .directory_exists_at(b"/usr/lib/x86_64-linux-gnu")
                        .is_true()
                    {
                        CACHED_DEFAULT_SYSTEM_LIBRARY_DIR =
                            ZStr::from_static(b"/usr/lib/x86_64-linux-gnu\0");
                    } else if Fd::cwd().directory_exists_at(b"/usr/lib64").is_true() {
                        CACHED_DEFAULT_SYSTEM_LIBRARY_DIR = ZStr::from_static(b"/usr/lib64\0");
                    }
                }
            }
            #[cfg(target_arch = "aarch64")]
            {
                // SAFETY: writing once-initialized statics under Once guard
                unsafe {
                    if Fd::cwd()
                        .directory_exists_at(b"/usr/include/aarch64-linux-gnu")
                        .is_true()
                    {
                        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR =
                            ZStr::from_static(b"/usr/include/aarch64-linux-gnu\0");
                    } else if Fd::cwd().directory_exists_at(b"/usr/include").is_true() {
                        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR = ZStr::from_static(b"/usr/include\0");
                    }

                    if Fd::cwd()
                        .directory_exists_at(b"/usr/lib/aarch64-linux-gnu")
                        .is_true()
                    {
                        CACHED_DEFAULT_SYSTEM_LIBRARY_DIR =
                            ZStr::from_static(b"/usr/lib/aarch64-linux-gnu\0");
                    } else if Fd::cwd().directory_exists_at(b"/usr/lib64").is_true() {
                        CACHED_DEFAULT_SYSTEM_LIBRARY_DIR = ZStr::from_static(b"/usr/lib64\0");
                    }
                }
            }
        }
    }

    fn get_system_include_dir() -> Option<&'static ZStr> {
        Self::CACHED_DEFAULT_SYSTEM_INCLUDE_DIR_ONCE.call_once(Self::get_system_root_dir_once);
        // SAFETY: read-only after Once initialization
        let dir = unsafe { CACHED_DEFAULT_SYSTEM_INCLUDE_DIR };
        if dir.is_empty() {
            return None;
        }
        Some(dir)
    }

    fn get_system_library_dir() -> Option<&'static ZStr> {
        Self::CACHED_DEFAULT_SYSTEM_INCLUDE_DIR_ONCE.call_once(Self::get_system_root_dir_once);
        // SAFETY: read-only after Once initialization
        let dir = unsafe { CACHED_DEFAULT_SYSTEM_LIBRARY_DIR };
        if dir.is_empty() {
            return None;
        }
        Some(dir)
    }

    pub fn compile(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> Result<NonNull<TCC::State>, bun_core::Error> {
        // TODO(port): narrow error set (DeferredErrors | JSError | OutOfMemory | JSTerminated)
        let compile_options: &ZStr = if !self.flags.is_empty() {
            &self.flags
        } else if let Some(tcc_options) = env_var::BUN_TCC_OPTIONS.get() {
            // TODO(port): @ptrCast from []const u8 to [:0]const u8 — env var must be NUL-terminated
            // SAFETY: env vars are NUL-terminated by the OS
            unsafe { ZStr::from_ptr(tcc_options.as_ptr()) }
        } else {
            ZStr::from_static(Self::DEFAULT_TCC_OPTIONS.as_bytes())
        };

        // TODO: correctly handle invalid user-provided options
        let state = match TCC::State::init::<CompileC>(
            TCC::InitOptions {
                options: compile_options,
                err: TCC::ErrHandler {
                    ctx: self,
                    handler: Self::handle_compilation_error,
                },
            },
            true,
        ) {
            Ok(s) => s,
            Err(e) if e == bun_core::err!("OutOfMemory") => {
                return Err(bun_core::err!("OutOfMemory"))
            }
            Err(_) => {
                debug_assert!(self.has_deferred_errors());
                return Err(bun_core::err!("DeferredErrors"));
            }
        };

        let mut pathbuf = PathBuffer::uninit();

        if let Some(compiler_rt_dir) = CompilerRT::dir() {
            if state.add_sys_include_path(compiler_rt_dir).is_err() {
                bun_output::scoped_log!(TCC, "TinyCC failed to add sysinclude path");
            }
        }

        #[cfg(target_os = "macos")]
        {
            'add_system_include_dir: {
                let dirs_to_try: [&[u8]; 2] = [
                    env_var::SDKROOT.get().unwrap_or(b""),
                    Self::get_system_include_dir()
                        .map(|s| s.as_bytes())
                        .unwrap_or(b""),
                ];

                for sdkroot in dirs_to_try {
                    if !sdkroot.is_empty() {
                        let include_dir = path::join_abs_string_buf_z(
                            sdkroot,
                            &mut pathbuf,
                            &[b"usr", b"include"],
                            path::Style::Auto,
                        );
                        if state.add_sys_include_path(include_dir).is_err() {
                            return global_this
                                .throw("TinyCC failed to add sysinclude path", &[])
                                .into();
                        }

                        let lib_dir = path::join_abs_string_buf_z(
                            sdkroot,
                            &mut pathbuf,
                            &[b"usr", b"lib"],
                            path::Style::Auto,
                        );
                        if state.add_library_path(lib_dir).is_err() {
                            return global_this
                                .throw("TinyCC failed to add library path", &[])
                                .into();
                        }

                        break 'add_system_include_dir;
                    }
                }
            }

            #[cfg(target_arch = "aarch64")]
            {
                if Fd::cwd()
                    .directory_exists_at(b"/opt/homebrew/include")
                    .is_true()
                {
                    if state
                        .add_sys_include_path(ZStr::from_static(b"/opt/homebrew/include\0"))
                        .is_err()
                    {
                        bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                    }
                }

                if Fd::cwd()
                    .directory_exists_at(b"/opt/homebrew/lib")
                    .is_true()
                {
                    if state
                        .add_library_path(ZStr::from_static(b"/opt/homebrew/lib\0"))
                        .is_err()
                    {
                        bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                    }
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(include_dir) = Self::get_system_include_dir() {
                if state.add_sys_include_path(include_dir).is_err() {
                    bun_output::scoped_log!(TCC, "TinyCC failed to add sysinclude path");
                }
            }

            if let Some(library_dir) = Self::get_system_library_dir() {
                if state.add_library_path(library_dir).is_err() {
                    bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                }
            }
        }

        #[cfg(unix)]
        {
            if Fd::cwd().directory_exists_at(b"/usr/local/include").is_true() {
                if state
                    .add_sys_include_path(ZStr::from_static(b"/usr/local/include\0"))
                    .is_err()
                {
                    bun_output::scoped_log!(TCC, "TinyCC failed to add sysinclude path");
                }
            }

            if Fd::cwd().directory_exists_at(b"/usr/local/lib").is_true() {
                if state
                    .add_library_path(ZStr::from_static(b"/usr/local/lib\0"))
                    .is_err()
                {
                    bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                }
            }

            // Check standard C compiler environment variables for include paths.
            // These are used by systems like NixOS where standard FHS paths don't exist.
            if let Some(c_include_path) = env_var::C_INCLUDE_PATH.get() {
                for path in c_include_path.split(|b| *b == b':') {
                    if !path.is_empty() {
                        let Ok(path_z) = ZStr::from_bytes(path) else {
                            continue;
                        };
                        if state.add_sys_include_path(&path_z).is_err() {
                            bun_output::scoped_log!(
                                TCC,
                                "TinyCC failed to add C_INCLUDE_PATH: {}",
                                BStr::new(path)
                            );
                        }
                    }
                }
            }

            // Check standard C compiler environment variable for library paths.
            if let Some(library_path) = env_var::LIBRARY_PATH.get() {
                for path in library_path.split(|b| *b == b':') {
                    if !path.is_empty() {
                        let Ok(path_z) = ZStr::from_bytes(path) else {
                            continue;
                        };
                        if state.add_library_path(&path_z).is_err() {
                            bun_output::scoped_log!(
                                TCC,
                                "TinyCC failed to add LIBRARY_PATH: {}",
                                BStr::new(path)
                            );
                        }
                    }
                }
            }
        }

        self.error_check()?;

        for include_dir in self.include_dirs.items.iter() {
            if state.add_sys_include_path(include_dir).is_err() {
                debug_assert!(self.has_deferred_errors());
                return Err(bun_core::err!("DeferredErrors"));
            }
        }

        self.error_check()?;

        CompilerRT::define(state);

        self.error_check()?;

        for symbol in self.symbols.map.values() {
            if symbol.needs_napi_env() {
                state
                    .add_symbol(
                        b"Bun__thisFFIModuleNapiEnv",
                        global_this.make_napi_env_for_ffi() as *const c_void,
                    )
                    .map_err(|_| bun_core::err!("DeferredErrors"))?;
                break;
            }
        }

        for define in self.define.iter() {
            state.define_symbol(&define[0], &define[1]);
            self.error_check()?;
        }

        if let Err(_) = self
            .source
            .add(state, &mut self.current_file_for_errors)
        {
            if !self.deferred_errors.is_empty() {
                return Err(bun_core::err!("DeferredErrors"));
            } else {
                if !global_this.has_exception() {
                    return global_this.throw("TinyCC failed to compile", &[]).into();
                }
                return Err(bun_core::err!("JSError"));
            }
        }

        CompilerRT::inject(state);
        stdarg::inject(state);

        self.error_check()?;

        for library_dir in self.library_dirs.items.iter() {
            // register all, even if some fail. Only fail after all have been registered.
            if state.add_library_path(library_dir).is_err() {
                bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
            }
        }
        self.error_check()?;

        for library in self.libraries.items.iter() {
            // register all, even if some fail.
            let _ = state.add_library(library);
        }
        self.error_check()?;

        // TinyCC now manages relocation memory internally
        if dangerously_run_without_jit_protections(|| state.relocate()).is_err() {
            if !self.has_deferred_errors() {
                self.deferred_errors
                    .push(Box::<[u8]>::from(&b"tcc_relocate returned a negative value"[..]));
            }
            return Err(bun_core::err!("DeferredErrors"));
        }

        // if errors got added, we would have returned in the relocation catch.
        debug_assert!(self.deferred_errors.is_empty());

        for (symbol, function) in self.symbols.map.iter_mut() {
            // FIXME: why are we duping here? can we at least use a stack
            // fallback allocator?
            let duped = ZStr::from_bytes(symbol);
            let Some(sym) = state.get_symbol(&duped) else {
                return global_this
                    .throw(
                        format_args!(
                            "{} is missing from {}. Was it included in the source code?",
                            bun_fmt::quote(symbol),
                            BStr::new(self.source.first().as_bytes())
                        ),
                        &[],
                    )
                    .into();
            };
            function.symbol_from_dynamic_library = Some(sym);
        }

        self.error_check()?;

        Ok(state)
    }
}

// ─── SymbolsMap ─────────────────────────────────────────────────────────────

#[derive(Default)]
struct SymbolsMap {
    map: StringArrayHashMap<Function>,
}

// ─── StringArray ────────────────────────────────────────────────────────────

#[derive(Default)]
struct StringArray {
    items: Vec<Box<ZStr>>,
}

impl Drop for StringArray {
    fn drop(&mut self) {
        for item in self.items.iter() {
            // Attempting to free an empty null-terminated slice will crash if it was a default value
            debug_assert!(!item.is_empty());
        }
        // Vec<Box<ZStr>> drops itself
    }
}

impl StringArray {
    pub fn from_js_array(
        global_this: &JSGlobalObject,
        value: JSValue,
        property: &'static str,
    ) -> JsResult<StringArray> {
        let mut iter = value.array_iterator(global_this)?;
        let mut items: Vec<Box<ZStr>> = Vec::new();

        while let Some(val) = iter.next(global_this)? {
            if !val.is_string() {
                // items dropped automatically
                return Err(global_this.throw_invalid_argument_type_value(
                    property,
                    "array of strings",
                    val,
                ));
            }
            let str = val.get_zig_string(global_this)?;
            if str.is_empty() {
                continue;
            }
            items.push(str.to_owned_slice_z());
        }

        Ok(StringArray { items })
    }

    pub fn from_js_string(
        global_this: &JSGlobalObject,
        value: JSValue,
        property: &'static str,
    ) -> JsResult<StringArray> {
        if value.is_undefined() {
            return Ok(StringArray::default());
        }
        if !value.is_string() {
            return Err(global_this.throw_invalid_argument_type_value(
                property,
                "array of strings",
                value,
            ));
        }
        let str = value.get_zig_string(global_this)?;
        if str.is_empty() {
            return Ok(StringArray::default());
        }
        let mut items: Vec<Box<ZStr>> = Vec::new();
        items.push(str.to_owned_slice_z());
        Ok(StringArray { items })
    }

    pub fn from_js(
        global_this: &JSGlobalObject,
        value: JSValue,
        property: &'static str,
    ) -> JsResult<StringArray> {
        if value.is_array() {
            return Self::from_js_array(global_this, value, property);
        }
        Self::from_js_string(global_this, value, property)
    }
}

// ─── FFI host functions ─────────────────────────────────────────────────────

impl FFI {
    #[bun_jsc::host_fn]
    pub fn bun_ffi_cc(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        #[cfg(not(feature = "tinycc"))]
        {
            return Err(global_this.throw(
                "bun:ffi cc() is not available in this build (TinyCC is disabled)",
                &[],
            ));
        }
        let arguments = callframe.arguments_old(1);
        let arguments = arguments.slice();
        if arguments.is_empty() || !arguments[0].is_object() {
            return Err(global_this.throw_invalid_arguments("Expected object", &[]));
        }

        // Step 1. compile the user's code

        let object = arguments[0];

        let mut compile_c = CompileC::default();

        let symbols_object: JSValue = object
            .get_own(global_this, "symbols")?
            .unwrap_or(JSValue::UNDEFINED);
        if !global_this.has_exception() && (symbols_object.is_empty() || !symbols_object.is_object())
        {
            return Err(global_this.throw_invalid_argument_type_value(
                "symbols",
                "object",
                symbols_object,
            ));
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        // SAFETY: already checked that symbols_object is an object
        if let Some(val) = generate_symbols(
            global_this,
            &mut compile_c.symbols.map,
            symbols_object.get_object().unwrap(),
        )? {
            if !val.is_empty() && !global_this.has_exception() {
                return Err(global_this.throw_value(val));
            }
            return Err(JsError::Thrown);
        }

        if compile_c.symbols.map.len() == 0 {
            return Err(global_this.throw("Expected at least one exported symbol", &[]));
        }

        if let Some(library_value) = object.get_own(global_this, "library")? {
            compile_c.libraries = StringArray::from_js(global_this, library_value, "library")?;
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(flags_value) = object.get_truthy(global_this, "flags")? {
            if flags_value.is_array() {
                let mut iter = flags_value.array_iterator(global_this)?;

                let mut flags: Vec<u8> = Vec::new();
                flags.extend_from_slice(CompileC::DEFAULT_TCC_OPTIONS.as_bytes());

                while let Some(value) = iter.next(global_this)? {
                    if !value.is_string() {
                        return Err(global_this.throw_invalid_argument_type_value(
                            "flags",
                            "array of strings",
                            value,
                        ));
                    }
                    let slice = value.to_slice(global_this)?;
                    if slice.len() == 0 {
                        continue;
                    }
                    flags.push(b' ');
                    flags.extend_from_slice(slice.slice());
                }
                flags.push(0);
                let len = flags.len() - 1;
                // SAFETY: flags[len] == 0 written above
                compile_c.flags = unsafe { ZStr::from_vec_with_nul(flags, len) };
            } else {
                if !flags_value.is_string() {
                    return Err(global_this.throw_invalid_argument_type_value(
                        "flags",
                        "string",
                        flags_value,
                    ));
                }

                let str = flags_value.get_zig_string(global_this)?;
                if !str.is_empty() {
                    compile_c.flags = str.to_owned_slice_z();
                }
            }
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(define_value) = object.get_truthy(global_this, "define")? {
            if let Some(define_obj) = define_value.get_object() {
                let mut iter = JSPropertyIterator::init(
                    global_this,
                    define_obj,
                    jsc::PropertyIteratorOptions {
                        include_value: true,
                        skip_empty_name: true,
                    },
                )?;
                while let Some(entry) = iter.next(global_this)? {
                    let key = entry.to_owned_slice_z();
                    let mut owned_value: Box<ZStr> = ZStr::empty();
                    if !iter.value.is_undefined_or_null() {
                        if iter.value.is_string() {
                            let value = iter.value.get_zig_string(global_this)?;
                            if value.len() > 0 {
                                owned_value = value.to_owned_slice_z();
                            }
                        }
                    }
                    if global_this.has_exception() {
                        return Err(JsError::Thrown);
                    }

                    compile_c.define.push([key, owned_value]);
                }
            }
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(include_value) = object.get_truthy(global_this, "include")? {
            compile_c.include_dirs = StringArray::from_js(global_this, include_value, "include")?;
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(source_value) = object.get_own(global_this, "source")? {
            if source_value.is_array() {
                compile_c.source = Source::Files(Vec::new());
                let mut iter = source_value.array_iterator(global_this)?;
                while let Some(value) = iter.next(global_this)? {
                    if !value.is_string() {
                        return Err(global_this.throw_invalid_argument_type_value(
                            "source",
                            "array of strings",
                            value,
                        ));
                    }
                    if let Source::Files(files) = &mut compile_c.source {
                        files.push(value.get_zig_string(global_this)?.to_owned_slice_z()?);
                    }
                }
            } else if !source_value.is_string() {
                return Err(global_this.throw_invalid_argument_type_value(
                    "source",
                    "string",
                    source_value,
                ));
            } else {
                let source_path = source_value.get_zig_string(global_this)?.to_owned_slice_z()?;
                compile_c.source = Source::File(source_path);
            }
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        // Now we compile the code with tinycc.
        let mut tcc_state: Option<NonNull<TCC::State>> = match compile_c.compile(global_this) {
            Ok(s) => Some(s),
            Err(err) => {
                if err == bun_core::err!("DeferredErrors") {
                    let mut combined: Vec<u8> = Vec::new();
                    let file_for_err = if !compile_c.current_file_for_errors.is_empty() {
                        compile_c.current_file_for_errors.as_bytes()
                    } else {
                        compile_c.source.first().as_bytes()
                    };
                    write!(
                        &mut combined,
                        "{} errors while compiling {}\n",
                        compile_c.deferred_errors.len(),
                        BStr::new(file_for_err)
                    )
                    .ok();

                    for deferred_error in compile_c.deferred_errors.iter() {
                        write!(&mut combined, "{}\n", BStr::new(deferred_error)).ok();
                    }

                    return Err(
                        global_this.throw(format_args!("{}", BStr::new(&combined)), &[])
                    );
                } else if err == bun_core::err!("JSError") {
                    return Err(JsError::Thrown);
                } else if err == bun_core::err!("OutOfMemory") {
                    return Err(JsError::OutOfMemory);
                } else if err == bun_core::err!("JSTerminated") {
                    return Err(JsError::Terminated);
                } else {
                    unreachable!()
                }
            }
        };
        let _tcc_guard = scopeguard::guard(&mut tcc_state, |s| {
            if let Some(state) = s {
                // SAFETY: state is a valid TCC::State pointer from compile()
                unsafe { state.as_mut().deinit() };
            }
        });

        let napi_env = make_napi_env_if_needed(compile_c.symbols.map.values(), global_this);

        let obj = JSValue::create_empty_object(global_this, compile_c.symbols.map.len());
        for function in compile_c.symbols.map.values_mut() {
            let function_name = function.base_name.as_ref().unwrap();

            if let Err(err) = function.compile(napi_env) {
                if !global_this.has_exception() {
                    let ret = global_this.to_invalid_arguments(format_args!(
                        "{} when translating symbol \"{}\"",
                        err.name(),
                        BStr::new(function_name.as_bytes())
                    ));
                    return Err(global_this.throw_value(ret));
                }
                return Err(JsError::Thrown);
            }
            match &mut function.step {
                Step::Failed { msg, .. } => {
                    let res = ZigString::init(msg).to_error_instance(global_this);
                    return Err(global_this.throw_value(res));
                }
                Step::Pending => {
                    return Err(
                        global_this.throw("Failed to compile (nothing happend!)", &[])
                    );
                }
                Step::Compiled(compiled) => {
                    let str = ZigString::init(function_name.as_bytes());
                    let cb = host_fn::new_runtime_function(
                        global_this,
                        &str,
                        u32::try_from(function.arg_types.len()).unwrap(),
                        // SAFETY: compiled.ptr is a valid JSHostFn entry point from TCC
                        unsafe { core::mem::transmute::<*mut c_void, *const jsc::JSHostFn>(compiled.ptr) },
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(global_this, &str, cb);
                }
            }
        }

        // TODO: pub const new = bun.TrivialNew(FFI)
        let lib = Box::new(FFI {
            dylib: None,
            shared_state: scopeguard::ScopeGuard::into_inner(_tcc_guard).take(),
            functions: core::mem::take(&mut compile_c.symbols.map),
            closed: false,
        });
        // PORT NOTE: reshaped for borrowck — Zig nulled tcc_state and symbols after move

        let js_object = lib.to_js(global_this);
        jsc::codegen::JSFFI::symbols_value_set_cached(js_object, global_this, obj);
        Ok(js_object)
    }

    pub fn close_callback(_global_this: &JSGlobalObject, ctx: JSValue) -> JSValue {
        // SAFETY: ctx encodes a Box::into_raw(*mut Function) created by `callback`
        drop(unsafe { Box::from_raw(ctx.as_ptr_address() as *mut Function) });
        JSValue::UNDEFINED
    }

    pub fn callback(
        global_this: &JSGlobalObject,
        interface: JSValue,
        js_callback: JSValue,
    ) -> JsResult<JSValue> {
        #[cfg(not(feature = "tinycc"))]
        {
            return Err(global_this.throw(
                "bun:ffi callback() is not available in this build (TinyCC is disabled)",
                &[],
            ));
        }
        jsc::mark_binding();
        if !interface.is_object() {
            return Ok(global_this.to_invalid_arguments("Expected object"));
        }

        if js_callback.is_empty_or_undefined_or_null() || !js_callback.is_callable() {
            return Ok(global_this.to_invalid_arguments("Expected callback function"));
        }

        let mut function = Function::default();
        let func = &mut function;

        if let Some(val) = generate_symbol_for_function(global_this, interface, func)
            .unwrap_or_else(|_| Some(ZigString::init(b"Out of memory").to_error_instance(global_this)))
        {
            return Ok(val);
        }

        // TODO: WeakRefHandle that automatically frees it?
        func.base_name = Some(ZStr::empty());
        js_callback.ensure_still_alive();

        if func
            .compile_callback(global_this, js_callback, func.threadsafe)
            .is_err()
        {
            return Ok(ZigString::init(b"Out of memory").to_error_instance(global_this));
        }
        match &func.step {
            Step::Failed { msg, .. } => {
                let message = ZigString::init(msg).to_error_instance(global_this);
                Ok(message)
            }
            Step::Pending => {
                Ok(ZigString::init(
                    b"Failed to compile, but not sure why. Please report this bug",
                )
                .to_error_instance(global_this))
            }
            Step::Compiled(_) => {
                let function_ = Box::into_raw(Box::new(core::mem::take(func)));
                // SAFETY: function_ is a valid Box::into_raw pointer
                let compiled_ptr = unsafe { (*function_).step.compiled_ptr() };
                Ok(JSValue::create_object_2(
                    global_this,
                    ZigString::static_(b"ptr"),
                    ZigString::static_(b"ctx"),
                    JSValue::from_ptr_address(compiled_ptr as usize),
                    JSValue::from_ptr_address(function_ as usize),
                ))
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(
        this: &mut FFI,
        _global_this: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        if this.closed {
            return Ok(JSValue::UNDEFINED);
        }
        this.closed = true;
        if let Some(mut dylib) = this.dylib.take() {
            dylib.close();
        }

        if let Some(mut state) = this.shared_state.take() {
            // SAFETY: state is a valid TCC::State pointer; we have exclusive ownership
            unsafe { state.as_mut().deinit() };
        }

        this.functions.clear();

        Ok(JSValue::UNDEFINED)
    }

    pub fn print_callback(global: &JSGlobalObject, object: JSValue) -> JSValue {
        jsc::mark_binding();

        if object.is_empty_or_undefined_or_null() || !object.is_object() {
            return global.to_invalid_arguments("Expected an object");
        }

        let mut function = Function::default();
        if let Some(val) = generate_symbol_for_function(global, object, &mut function)
            .unwrap_or_else(|_| Some(ZigString::init(b"Out of memory").to_error_instance(global)))
        {
            return val;
        }

        let mut arraylist: Vec<u8> = Vec::new();

        function.base_name = Some(ZStr::from_static(b"my_callback_function\0"));

        if function
            .print_callback_source_code(None, None, &mut arraylist)
            .is_err()
        {
            return ZigString::init(b"Error while printing code").to_error_instance(global);
        }
        ZigString::init(&arraylist).to_js(global)
    }

    pub fn print(
        global: &JSGlobalObject,
        object: JSValue,
        is_callback_val: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if let Some(is_callback) = is_callback_val {
            if is_callback.to_boolean() {
                return Ok(Self::print_callback(global, object));
            }
        }

        if object.is_empty_or_undefined_or_null() {
            return Ok(invalid_options_arg(global));
        }
        let Some(obj) = object.get_object() else {
            return Ok(invalid_options_arg(global));
        };

        let mut symbols = StringArrayHashMap::<Function>::default();
        if let Some(val) =
            generate_symbols(global, &mut symbols, obj).unwrap_or(Some(JSValue::ZERO))
        {
            // an error while validating symbols
            // keys/arg_types freed by Drop
            return Ok(val);
        }
        jsc::mark_binding();
        let mut strs: Vec<bun_str::String> = Vec::with_capacity(symbols.len());
        // PERF(port): was initCapacity assume_capacity
        for function in symbols.values_mut() {
            let mut arraylist: Vec<u8> = Vec::new();
            if function.print_source_code(&mut arraylist).is_err() {
                // an error while generating source code
                return Ok(
                    ZigString::init(b"Error while printing code").to_error_instance(global)
                );
            }
            strs.push(bun_str::String::clone_utf8(&arraylist));
            // PERF(port): was appendAssumeCapacity
        }

        let ret = bun_str::String::to_js_array(global, &strs)?;

        for str in strs.iter() {
            str.deref();
        }
        // symbols freed by Drop

        Ok(ret)
    }
}

/// Creates an Exception object indicating that options object is invalid.
/// The exception is not thrown on the VM.
fn invalid_options_arg(global: &JSGlobalObject) -> JSValue {
    global.to_invalid_arguments("Expected an options object with symbol names")
}

impl FFI {
    pub fn open(global: &JSGlobalObject, name_str: ZigString, object_value: JSValue) -> JSValue {
        #[cfg(not(feature = "tinycc"))]
        {
            let _ = global.throw(
                "bun:ffi dlopen() is not available in this build (TinyCC is disabled)",
                &[],
            );
            return JSValue::ZERO;
        }
        jsc::mark_binding();
        let vm = VirtualMachine::get();
        let name_slice = name_str.to_slice();

        if object_value.is_empty_or_undefined_or_null() {
            return invalid_options_arg(global);
        }
        let Some(object) = object_value.get_object() else {
            return invalid_options_arg(global);
        };

        let filepath_buf = bun_paths::path_buffer_pool().get();
        let name: &[u8] = 'brk: {
            let ext: &[u8] = match () {
                #[cfg(any(target_os = "linux", target_os = "freebsd"))]
                () => b"so",
                #[cfg(target_os = "macos")]
                () => b"dylib",
                #[cfg(windows)]
                () => b"dll",
                // TODO(port): wasm @compileError("TODO")
            };
            if let Some(resolved) =
                ModuleLoader::resolve_embedded_file(vm, &mut *filepath_buf, name_slice.slice(), ext)
            {
                filepath_buf[resolved.len()] = 0;
                break 'brk &filepath_buf[0..resolved.len()];
            }

            break 'brk name_slice.slice();
        };

        if name.is_empty() {
            return global.to_invalid_arguments("Invalid library name");
        }

        let mut symbols = StringArrayHashMap::<Function>::default();
        if let Some(val) =
            generate_symbols(global, &mut symbols, object).unwrap_or(Some(JSValue::ZERO))
        {
            // an error while validating symbols
            return val;
        }
        if symbols.len() == 0 {
            return global.to_invalid_arguments("Expected at least one symbol");
        }

        let mut dylib: bun_sys::DynLib = 'brk: {
            // First try using the name directly
            match bun_sys::DynLib::open(name) {
                Ok(d) => break 'brk d,
                Err(_) => {
                    let backup_name = Fs::FileSystem::instance().abs(&[name]);
                    // if that fails, try resolving the filepath relative to the current working directory
                    match bun_sys::DynLib::open(backup_name) {
                        Ok(d) => break 'brk d,
                        Err(_) => {
                            // Then, if that fails, report an error with the library name and system error
                            let dlerror_buf = get_dl_error().ok();
                            let dlerror_msg: &[u8] = dlerror_buf
                                .as_deref()
                                .unwrap_or(b"unknown error");

                            let mut msg = Vec::new();
                            write!(
                                &mut msg,
                                "Failed to open library \"{}\": {}",
                                BStr::new(name),
                                BStr::new(dlerror_msg)
                            )
                            .ok();
                            let system_error = SystemError {
                                code: bun_str::String::clone_utf8(b"ERR_DLOPEN_FAILED"),
                                message: bun_str::String::clone_utf8(&msg),
                                syscall: bun_str::String::clone_utf8(b"dlopen"),
                                ..Default::default()
                            };
                            return system_error.to_error_instance(global);
                        }
                    }
                }
            }
        };

        let mut size = symbols.values().len();
        if size >= 63 {
            size = 0;
        }
        let obj = JSValue::create_empty_object(global, size);
        obj.protect();
        let _obj_guard = scopeguard::guard((), |_| obj.unprotect());

        let napi_env = make_napi_env_if_needed(symbols.values(), global);

        for function in symbols.values_mut() {
            let function_name = function.base_name.as_ref().unwrap().clone();
            // PORT NOTE: reshaped for borrowck — clone base_name to drop &function borrow

            // optional if the user passed "ptr"
            if function.symbol_from_dynamic_library.is_none() {
                let Some(resolved_symbol) = dylib.lookup::<*mut c_void>(&function_name) else {
                    let ret = global.to_invalid_arguments(format_args!(
                        "Symbol \"{}\" not found in \"{}\"",
                        BStr::new(function_name.as_bytes()),
                        BStr::new(name)
                    ));
                    // symbols freed by Drop
                    dylib.close();
                    return ret;
                };

                function.symbol_from_dynamic_library = Some(resolved_symbol);
            }

            if let Err(err) = function.compile(napi_env) {
                let ret = global.to_invalid_arguments(format_args!(
                    "{} when compiling symbol \"{}\" in \"{}\"",
                    err.name(),
                    BStr::new(function_name.as_bytes()),
                    BStr::new(name)
                ));
                dylib.close();
                return ret;
            }
            match &mut function.step {
                Step::Failed { msg, .. } => {
                    let res = ZigString::init(msg).to_error_instance(global);
                    dylib.close();
                    return res;
                }
                Step::Pending => {
                    dylib.close();
                    return ZigString::init(b"Failed to compile (nothing happend!)")
                        .to_error_instance(global);
                }
                Step::Compiled(compiled) => {
                    let str = ZigString::init(function_name.as_bytes());
                    let cb = host_fn::new_runtime_function(
                        global,
                        &str,
                        u32::try_from(function.arg_types.len()).unwrap(),
                        // SAFETY: compiled.ptr is a valid JSHostFn entry point from TCC
                        unsafe {
                            core::mem::transmute::<*mut c_void, *const jsc::JSHostFn>(compiled.ptr)
                        },
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;
                    obj.put(global, &str, cb);
                }
            }
        }

        let lib = Box::new(FFI {
            dylib: Some(dylib),
            functions: symbols,
            ..Default::default()
        });

        let js_object = lib.to_js(global);
        jsc::codegen::JSFFI::symbols_value_set_cached(js_object, global, obj);
        js_object
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_symbols(_this: &FFI, _: &JSGlobalObject) -> JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        JSValue::UNDEFINED
    }

    pub fn link_symbols(global: &JSGlobalObject, object_value: JSValue) -> JSValue {
        #[cfg(not(feature = "tinycc"))]
        {
            let _ = global.throw(
                "bun:ffi linkSymbols() is not available in this build (TinyCC is disabled)",
                &[],
            );
            return JSValue::ZERO;
        }
        jsc::mark_binding();

        if object_value.is_empty_or_undefined_or_null() {
            return invalid_options_arg(global);
        }
        let Some(object) = object_value.get_object() else {
            return invalid_options_arg(global);
        };

        let mut symbols = StringArrayHashMap::<Function>::default();
        if let Some(val) =
            generate_symbols(global, &mut symbols, object).unwrap_or(Some(JSValue::ZERO))
        {
            // an error while validating symbols
            return val;
        }
        if symbols.len() == 0 {
            return global.to_invalid_arguments("Expected at least one symbol");
        }

        let obj = JSValue::create_empty_object(global, symbols.len());
        obj.ensure_still_alive();
        let _keep = jsc::EnsureStillAlive(obj);

        let napi_env = make_napi_env_if_needed(symbols.values(), global);

        for function in symbols.values_mut() {
            let function_name = function.base_name.as_ref().unwrap().clone();

            if function.symbol_from_dynamic_library.is_none() {
                let ret = global.to_invalid_arguments(format_args!(
                    "Symbol \"{}\" is missing a \"ptr\" field. When using linkSymbols() or CFunction(), you must provide a \"ptr\" field with the memory address of the native function.",
                    BStr::new(function_name.as_bytes())
                ));
                return ret;
            }

            if let Err(err) = function.compile(napi_env) {
                let ret = global.to_invalid_arguments(format_args!(
                    "{} when compiling symbol \"{}\"",
                    err.name(),
                    BStr::new(function_name.as_bytes())
                ));
                return ret;
            }
            match &mut function.step {
                Step::Failed { msg, .. } => {
                    let res = ZigString::init(msg).to_error_instance(global);
                    return res;
                }
                Step::Pending => {
                    return ZigString::static_(b"Failed to compile (nothing happend!)")
                        .to_error_instance(global);
                }
                Step::Compiled(compiled) => {
                    let name = ZigString::init(function_name.as_bytes());

                    let cb = host_fn::new_runtime_function(
                        global,
                        &name,
                        u32::try_from(function.arg_types.len()).unwrap(),
                        // SAFETY: compiled.ptr is a valid JSHostFn entry point from TCC
                        unsafe {
                            core::mem::transmute::<*mut c_void, *const jsc::JSHostFn>(compiled.ptr)
                        },
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    compiled.js_function = cb;

                    obj.put(global, &name, cb);
                }
            }
        }

        let lib = Box::new(FFI {
            dylib: None,
            functions: symbols,
            ..Default::default()
        });

        let js_object = lib.to_js(global);
        jsc::codegen::JSFFI::symbols_value_set_cached(js_object, global, obj);
        js_object
    }
}

pub fn generate_symbol_for_function(
    global: &JSGlobalObject,
    value: JSValue,
    function: &mut Function,
) -> JsResult<Option<JSValue>> {
    jsc::mark_binding();

    let mut abi_types: Vec<ABIType> = Vec::new();

    if let Some(args) = value.get_own(global, "args")? {
        if args.is_empty_or_undefined_or_null() || !args.js_type().is_array() {
            return Ok(Some(
                ZigString::static_(b"Expected an object with \"args\" as an array")
                    .to_error_instance(global),
            ));
        }

        let mut array = args.array_iterator(global)?;

        abi_types.reserve_exact(array.len());
        while let Some(val) = array.next(global)? {
            if val.is_empty_or_undefined_or_null() {
                return Ok(Some(
                    ZigString::static_(b"param must be a string (type name) or number")
                        .to_error_instance(global),
                ));
            }

            if val.is_any_int() {
                let int = val.to::<i32>();
                if (0..=ABIType::MAX).contains(&int) {
                    // SAFETY: range-checked above; ABIType is #[repr(i32)]
                    abi_types.push(unsafe { core::mem::transmute::<i32, ABIType>(int) });
                    // PERF(port): was appendAssumeCapacity
                    continue;
                } else {
                    return Ok(Some(
                        ZigString::static_(b"invalid ABI type").to_error_instance(global),
                    ));
                }
            }

            if !val.js_type().is_string_like() {
                return Ok(Some(
                    ZigString::static_(b"param must be a string (type name) or number")
                        .to_error_instance(global),
                ));
            }

            let type_name = val.to_slice(global)?;
            let Some(abi) = ABIType::LABEL.get(type_name.slice()).copied() else {
                return Ok(Some(global.to_type_error(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Unknown type {}", BStr::new(type_name.slice())),
                )));
            };
            abi_types.push(abi);
            // PERF(port): was appendAssumeCapacity
        }
    }
    // var function
    let mut return_type = ABIType::Void;

    let mut threadsafe = false;

    if let Some(threadsafe_value) = value.get_truthy(global, "threadsafe")? {
        threadsafe = threadsafe_value.to_boolean();
    }

    'brk: {
        if let Some(ret_value) = value.get_truthy(global, "returns")? {
            if ret_value.is_any_int() {
                let int = ret_value.to_int32();
                if (0..=ABIType::MAX).contains(&int) {
                    // SAFETY: range-checked above; ABIType is #[repr(i32)]
                    return_type = unsafe { core::mem::transmute::<i32, ABIType>(int) };
                    break 'brk;
                } else {
                    return Ok(Some(
                        ZigString::static_(b"invalid ABI type").to_error_instance(global),
                    ));
                }
            }

            let ret_slice = ret_value.to_slice(global)?;
            return_type = match ABIType::LABEL.get(ret_slice.slice()).copied() {
                Some(t) => t,
                None => {
                    return Ok(Some(global.to_type_error(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Unknown return type {}", BStr::new(ret_slice.slice())),
                    )));
                }
            };
        }
    }

    if return_type == ABIType::NapiEnv {
        return Ok(Some(
            ZigString::static_(b"Cannot return napi_env to JavaScript")
                .to_error_instance(global),
        ));
    }

    if return_type == ABIType::Buffer {
        return Ok(Some(
            ZigString::static_(
                b"Cannot return a buffer to JavaScript (since byteLength and byteOffset are unknown)",
            )
            .to_error_instance(global),
        ));
    }

    if function.threadsafe && return_type != ABIType::Void {
        return Ok(Some(
            ZigString::static_(b"Threadsafe functions must return void")
                .to_error_instance(global),
        ));
    }

    *function = Function {
        base_name: None,
        arg_types: abi_types,
        return_type,
        threadsafe,
        ..Default::default()
    };

    if let Some(ptr) = value.get(global, "ptr")? {
        if ptr.is_number() {
            let num = ptr.as_ptr_address();
            if num > 0 {
                function.symbol_from_dynamic_library = Some(num as *mut c_void);
            }
        } else if ptr.is_heap_big_int() {
            let num = ptr.to_uint64_no_truncate();
            if num > 0 {
                function.symbol_from_dynamic_library = Some(num as *mut c_void);
            }
        }
    }

    Ok(None)
}

pub fn generate_symbols(
    global: &JSGlobalObject,
    symbols: &mut StringArrayHashMap<Function>,
    object: &JSObject,
) -> JsResult<Option<JSValue>> {
    jsc::mark_binding();

    let mut symbols_iter = JSPropertyIterator::init(
        global,
        object,
        jsc::PropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
        },
    )?;

    symbols.reserve(symbols_iter.len());

    while let Some(prop) = symbols_iter.next(global)? {
        let value = symbols_iter.value;

        if value.is_empty_or_undefined_or_null() || !value.is_object() {
            return Ok(Some(global.to_type_error(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!("Expected an object for key \"{}\"", prop),
            )));
        }

        let mut function = Function::default();
        if let Some(val) = generate_symbol_for_function(global, value, &mut function)? {
            return Ok(Some(val));
        }
        let base_name = prop.to_owned_slice_z()?;
        let key = base_name.as_bytes().to_vec().into_boxed_slice();
        function.base_name = Some(base_name);

        symbols.insert(key, function);
        // PERF(port): was putAssumeCapacity
    }

    Ok(None)
}

// ─── Function ───────────────────────────────────────────────────────────────

pub struct Function {
    pub symbol_from_dynamic_library: Option<*mut c_void>,
    pub base_name: Option<Box<ZStr>>,
    pub state: Option<NonNull<TCC::State>>,

    pub return_type: ABIType,
    pub arg_types: Vec<ABIType>,
    pub step: Step,
    pub threadsafe: bool,
    // allocator field dropped — global mimalloc
}

impl Default for Function {
    fn default() -> Self {
        Self {
            symbol_from_dynamic_library: None,
            base_name: None,
            state: None,
            return_type: ABIType::Void,
            arg_types: Vec::new(),
            step: Step::Pending,
            threadsafe: false,
        }
    }
}

// TODO(port): mutable static — wrap in OnceLock or similar
pub static mut LIB_DIR_Z: *const c_char = b"\0".as_ptr() as *const c_char;

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn FFICallbackFunctionWrapper_destroy(_: *mut c_void);
}

impl Drop for Function {
    fn drop(&mut self) {
        // base_name, arg_types, Step::Failed.msg are owned and freed by drop glue.
        if let Some(mut state) = self.state.take() {
            // SAFETY: state is a valid TCC::State pointer; we own it
            unsafe { state.as_mut().deinit() };
        }
        if let Step::Compiled(compiled) = &mut self.step {
            if let Some(wrapper) = compiled.ffi_callback_function_wrapper.take() {
                // SAFETY: wrapper was created by Bun__createFFICallbackFunction
                unsafe { FFICallbackFunctionWrapper_destroy(wrapper.as_ptr()) };
            }
        }
    }
}

impl Function {
    pub fn needs_handle_scope(&self) -> bool {
        for arg in self.arg_types.iter() {
            if *arg == ABIType::NapiEnv || *arg == ABIType::NapiValue {
                return true;
            }
        }
        self.return_type == ABIType::NapiValue
    }

    fn fail(&mut self, msg: &'static [u8]) {
        if !matches!(self.step, Step::Failed { .. }) {
            // PORT NOTE: @branchHint(.likely) — Rust has no statement-level hint; left as-is
            self.step = Step::Failed {
                msg: Box::<[u8]>::from(msg),
                allocated: false,
            };
        }
    }

    pub fn ffi_header() -> &'static [u8] {
        // TODO(port): runtimeEmbedFile fallback when codegen_embed is off
        if cfg!(feature = "codegen_embed") {
            include_bytes!("./FFI.h")
        } else {
            bun_core::runtime_embed_file(bun_core::EmbedKind::Src, "runtime/ffi/FFI.h")
        }
    }

    pub extern "C" fn handle_tcc_error(ctx: Option<&mut Function>, message: *const c_char) {
        let this = ctx.unwrap();
        // SAFETY: TCC passes a valid NUL-terminated string
        let mut msg: &[u8] = unsafe { core::ffi::CStr::from_ptr(message) }.to_bytes();
        if !msg.is_empty() {
            let mut offset: usize = 0;
            // the message we get from TCC sometimes has garbage in it
            // i think because we're doing in-memory compilation
            while offset < msg.len() {
                if msg[offset] > 0x20 && msg[offset] < 0x7f {
                    break;
                }
                offset += 1;
            }
            msg = &msg[offset..];
        }

        this.step = Step::Failed {
            msg: Box::<[u8]>::from(msg),
            allocated: true,
        };
    }

    const TCC_OPTIONS: &'static str = if cfg!(debug_assertions) {
        "-std=c11 -nostdlib -Wl,--export-all-symbols -g"
    } else {
        "-std=c11 -nostdlib -Wl,--export-all-symbols"
    };

    pub fn compile(&mut self, napi_env: Option<&napi::NapiEnv>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut source_code: Vec<u8> = Vec::new();
        self.print_source_code(&mut source_code)?;

        source_code.push(0);
        let state = match TCC::State::init::<Function>(
            TCC::InitOptions {
                options: ZStr::from_static(Self::TCC_OPTIONS.as_bytes()),
                err: TCC::ErrHandler {
                    ctx: self,
                    handler: Self::handle_tcc_error,
                },
            },
            false,
        ) {
            Ok(s) => s,
            Err(_) => return Err(bun_core::err!("TCCMissing")),
        };

        self.state = Some(state);
        let _guard = scopeguard::guard(self as *mut Function, |this_ptr| {
            // SAFETY: this_ptr is &mut self for the duration of compile()
            let this = unsafe { &mut *this_ptr };
            if matches!(this.step, Step::Failed { .. }) {
                if let Some(mut s) = this.state.take() {
                    // SAFETY: we own the state
                    unsafe { s.as_mut().deinit() };
                }
            }
        });
        // SAFETY: state is non-null, just stored above
        let state = unsafe { self.state.unwrap().as_mut() };

        if let Some(env) = napi_env {
            if state
                .add_symbol(b"Bun__thisFFIModuleNapiEnv", env as *const _ as *const c_void)
                .is_err()
            {
                self.fail(b"Failed to add NAPI env symbol");
                return Ok(());
            }
        }

        CompilerRT::define(state);

        // SAFETY: source_code was NUL-terminated above
        if state
            .compile_string(unsafe { ZStr::from_raw(source_code.as_ptr(), source_code.len() - 1) })
            .is_err()
        {
            self.fail(b"Failed to compile source code");
            return Ok(());
        }

        CompilerRT::inject(state);
        if state
            .add_symbol(
                self.base_name.as_ref().unwrap().as_bytes(),
                self.symbol_from_dynamic_library.unwrap(),
            )
            .is_err()
        {
            debug_assert!(matches!(self.step, Step::Failed { .. }));
            return Ok(());
        }

        // TinyCC now manages relocation memory internally
        if dangerously_run_without_jit_protections(|| state.relocate()).is_err() {
            self.fail(b"tcc_relocate returned a negative value");
            return Ok(());
        }

        let Some(symbol) = state.get_symbol(b"JSFunctionCall") else {
            self.fail(b"missing generated symbol in source code");
            return Ok(());
        };

        self.step = Step::Compiled(Compiled {
            ptr: symbol,
            ..Default::default()
        });
        Ok(())
    }

    pub fn compile_callback(
        &mut self,
        js_context: &JSGlobalObject,
        js_function: JSValue,
        is_threadsafe: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        jsc::mark_binding();
        let mut source_code: Vec<u8> = Vec::new();
        // SAFETY: js_context/js_function are live for the call
        let ffi_wrapper = unsafe { Bun__createFFICallbackFunction(js_context, js_function) };
        self.print_callback_source_code(Some(js_context), Some(ffi_wrapper), &mut source_code)?;

        #[cfg(all(debug_assertions, unix))]
        'debug_write: {
            // TODO(port): uses std.posix directly in Zig — keep raw libc here for parity
            // SAFETY: best-effort debug write; failures are swallowed
            unsafe {
                let fd = libc::open(
                    b"/tmp/bun-ffi-callback-source.c\0".as_ptr() as *const c_char,
                    libc::O_CREAT | libc::O_WRONLY,
                    0o644,
                );
                if fd < 0 {
                    break 'debug_write;
                }
                let _ = libc::write(fd, source_code.as_ptr() as *const c_void, source_code.len());
                let _ = libc::ftruncate(fd, source_code.len() as libc::off_t);
                libc::close(fd);
            }
        }

        source_code.push(0);
        // defer source_code.deinit();

        let state = match TCC::State::init::<Function>(
            TCC::InitOptions {
                options: ZStr::from_static(Self::TCC_OPTIONS.as_bytes()),
                err: TCC::ErrHandler {
                    ctx: self,
                    handler: Self::handle_tcc_error,
                },
            },
            false,
        ) {
            Ok(s) => s,
            Err(e) if e == bun_core::err!("OutOfMemory") => {
                return Err(bun_core::err!("TCCMissing"))
            }
            // 1. .Memory is always a valid option, so InvalidOptions is
            //    impossible
            // 2. other throwable functions arent called, so their errors
            //    aren't possible
            Err(_) => unreachable!(),
        };
        self.state = Some(state);
        let _guard = scopeguard::guard(self as *mut Function, |this_ptr| {
            // SAFETY: this_ptr is &mut self for the duration of compile_callback()
            let this = unsafe { &mut *this_ptr };
            if matches!(this.step, Step::Failed { .. }) {
                if let Some(mut s) = this.state.take() {
                    // SAFETY: we own the state
                    unsafe { s.as_mut().deinit() };
                }
            }
        });
        // SAFETY: just stored above
        let state = unsafe { self.state.unwrap().as_mut() };

        if self.needs_napi_env() {
            if state
                .add_symbol(
                    b"Bun__thisFFIModuleNapiEnv",
                    js_context.make_napi_env_for_ffi() as *const c_void,
                )
                .is_err()
            {
                self.fail(b"Failed to add NAPI env symbol");
                return Ok(());
            }
        }

        CompilerRT::define(state);

        // SAFETY: source_code was NUL-terminated above
        if state
            .compile_string(unsafe { ZStr::from_raw(source_code.as_ptr(), source_code.len() - 1) })
            .is_err()
        {
            self.fail(b"Failed to compile source code");
            return Ok(());
        }

        CompilerRT::inject(state);
        let callback_sym: *const c_void = if is_threadsafe {
            FFI_Callback_threadsafe_call as *const c_void
        } else {
            // TODO: stage2 - make these ptrs
            match self.arg_types.len() {
                0 => FFI_Callback_call_0 as *const c_void,
                1 => FFI_Callback_call_1 as *const c_void,
                2 => FFI_Callback_call_2 as *const c_void,
                3 => FFI_Callback_call_3 as *const c_void,
                4 => FFI_Callback_call_4 as *const c_void,
                5 => FFI_Callback_call_5 as *const c_void,
                6 => FFI_Callback_call_6 as *const c_void,
                7 => FFI_Callback_call_7 as *const c_void,
                _ => FFI_Callback_call as *const c_void,
            }
        };
        if state.add_symbol(b"FFI_Callback_call", callback_sym).is_err() {
            self.fail(b"Failed to add FFI callback symbol");
            return Ok(());
        }
        // TinyCC now manages relocation memory internally
        if dangerously_run_without_jit_protections(|| state.relocate()).is_err() {
            self.fail(b"tcc_relocate returned a negative value");
            return Ok(());
        }

        let Some(symbol) = state.get_symbol(b"my_callback_function") else {
            self.fail(b"missing generated symbol in source code");
            return Ok(());
        };

        self.step = Step::Compiled(Compiled {
            ptr: symbol,
            js_function,
            js_context: Some(js_context as *const _ as *mut JSGlobalObject),
            ffi_callback_function_wrapper: NonNull::new(ffi_wrapper),
        });
        Ok(())
    }

    pub fn print_source_code(
        &self,
        writer: &mut impl std::io::Write,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if !self.arg_types.is_empty() {
            writer.write_all(b"#define HAS_ARGUMENTS\n")?;
        }

        'brk: {
            if self.return_type.is_floating_point() {
                writer.write_all(b"#define USES_FLOAT 1\n")?;
                break 'brk;
            }

            for arg in self.arg_types.iter() {
                // conditionally include math.h
                if arg.is_floating_point() {
                    writer.write_all(b"#define USES_FLOAT 1\n")?;
                    break;
                }
            }
        }

        writer.write_all(Self::ffi_header())?;

        // -- Generate the FFI function symbol
        writer.write_all(b"/* --- The Function To Call */\n")?;
        self.return_type.typename(writer)?;
        writer.write_all(b" ")?;
        writer.write_all(self.base_name.as_ref().unwrap().as_bytes())?;
        writer.write_all(b"(")?;
        let mut first = true;
        for (i, arg) in self.arg_types.iter().enumerate() {
            if !first {
                writer.write_all(b", ")?;
            }
            first = false;
            arg.param_typename(writer)?;
            write!(writer, " arg{}", i)?;
        }
        writer.write_all(
            b");\n\
              \n\
              /* ---- Your Wrapper Function ---- */\n\
              ZIG_REPR_TYPE JSFunctionCall(void* JS_GLOBAL_OBJECT, void* callFrame) {\n",
        )?;

        if self.needs_handle_scope() {
            writer.write_all(
                b"  void* handleScope = NapiHandleScope__open(&Bun__thisFFIModuleNapiEnv, false);\n",
            )?;
        }

        if !self.arg_types.is_empty() {
            writer.write_all(b"  LOAD_ARGUMENTS_FROM_CALL_FRAME;\n")?;
            for (i, arg) in self.arg_types.iter().enumerate() {
                if *arg == ABIType::NapiEnv {
                    write!(
                        writer,
                        "  napi_env arg{} = (napi_env)&Bun__thisFFIModuleNapiEnv;\n  argsPtr++;\n",
                        i
                    )?;
                } else if *arg == ABIType::NapiValue {
                    write!(
                        writer,
                        "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};\n",
                        i
                    )?;
                } else if arg.needs_a_cast_in_c() {
                    if i < self.arg_types.len() - 1 {
                        write!(
                            writer,
                            "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};\n",
                            i
                        )?;
                    } else {
                        write!(
                            writer,
                            "  EncodedJSValue arg{};\n  arg{}.asInt64 = *argsPtr;\n",
                            i, i
                        )?;
                    }
                } else {
                    if i < self.arg_types.len() - 1 {
                        write!(writer, "  int64_t arg{} = *argsPtr++;\n", i)?;
                    } else {
                        write!(writer, "  int64_t arg{} = *argsPtr;\n", i)?;
                    }
                }
            }
        }

        // try writer.writeAll(
        //     "(JSContext ctx, void* function, void* thisObject, size_t argumentCount, const EncodedJSValue arguments[], void* exception);\n\n",
        // );

        let mut arg_buf = [0u8; 512];

        writer.write_all(b"    ")?;
        if self.return_type != ABIType::Void {
            self.return_type.typename(writer)?;
            writer.write_all(b" return_value = ")?;
        }
        write!(
            writer,
            "{}(",
            BStr::new(self.base_name.as_ref().unwrap().as_bytes())
        )?;
        first = true;
        arg_buf[0..3].copy_from_slice(b"arg");
        for (i, arg) in self.arg_types.iter().enumerate() {
            if !first {
                writer.write_all(b", ")?;
            }
            first = false;
            writer.write_all(b"    ")?;

            // TODO(port): std.fmt.printInt → write!-into-slice helper
            let length_buf = {
                let mut cursor = std::io::Cursor::new(&mut arg_buf[3..]);
                write!(&mut cursor, "{}", i).ok();
                cursor.position() as usize
            };
            let arg_name = &arg_buf[0..3 + length_buf];
            if arg.needs_a_cast_in_c() {
                write!(writer, "{}", arg.to_c(arg_name))?;
            } else {
                writer.write_all(arg_name)?;
            }
        }
        writer.write_all(b");\n")?;

        if !first {
            writer.write_all(b"\n")?;
        }

        writer.write_all(b"    ")?;

        if self.needs_handle_scope() {
            writer.write_all(
                b"  NapiHandleScope__close(&Bun__thisFFIModuleNapiEnv, handleScope);\n",
            )?;
        }

        writer.write_all(b"return ")?;

        if self.return_type != ABIType::Void {
            write!(writer, "{}.asZigRepr", self.return_type.to_js(b"return_value"))?;
        } else {
            writer.write_all(b"ValueUndefined.asZigRepr")?;
        }

        writer.write_all(b";\n}\n\n")?;
        Ok(())
    }

    pub fn print_callback_source_code(
        &self,
        global_object: Option<&JSGlobalObject>,
        context_ptr: Option<*mut c_void>,
        writer: &mut impl std::io::Write,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        {
            let ptr = global_object
                .map(|g| g as *const _ as usize)
                .unwrap_or(0);
            let fmt = bun_fmt::hex_int_upper(ptr);
            write!(writer, "#define JS_GLOBAL_OBJECT (void*)0x{}ULL\n", fmt)?;
        }

        writer.write_all(b"#define IS_CALLBACK 1\n")?;

        'brk: {
            if self.return_type.is_floating_point() {
                writer.write_all(b"#define USES_FLOAT 1\n")?;
                break 'brk;
            }

            for arg in self.arg_types.iter() {
                // conditionally include math.h
                if arg.is_floating_point() {
                    writer.write_all(b"#define USES_FLOAT 1\n")?;
                    break;
                }
            }
        }

        writer.write_all(Self::ffi_header())?;

        // -- Generate the FFI function symbol
        writer.write_all(b"\n \n/* --- The Callback Function */\n")?;
        let mut first = true;
        self.return_type.typename(writer)?;

        writer.write_all(b" my_callback_function")?;
        writer.write_all(b"(")?;
        for (i, arg) in self.arg_types.iter().enumerate() {
            if !first {
                writer.write_all(b", ")?;
            }
            first = false;
            arg.typename(writer)?;
            write!(writer, " arg{}", i)?;
        }
        writer.write_all(b") {\n")?;

        if cfg!(debug_assertions) {
            writer.write_all(b"#ifdef INJECT_BEFORE\n")?;
            writer.write_all(b"INJECT_BEFORE;\n")?;
            writer.write_all(b"#endif\n")?;
        }

        first = true;
        let _ = first;

        if !self.arg_types.is_empty() {
            let mut arg_buf = [0u8; 512];
            write!(writer, " ZIG_REPR_TYPE arguments[{}];\n", self.arg_types.len())?;

            arg_buf[0..3].copy_from_slice(b"arg");
            for (i, arg) in self.arg_types.iter().enumerate() {
                let printed = {
                    let mut cursor = std::io::Cursor::new(&mut arg_buf[3..]);
                    write!(&mut cursor, "{}", i).ok();
                    cursor.position() as usize
                };
                let arg_name = &arg_buf[0..3 + printed];
                write!(writer, "arguments[{}] = {}.asZigRepr;\n", i, arg.to_js(arg_name))?;
            }
        }

        writer.write_all(b"  ")?;
        let mut inner_buf_ = [0u8; 372];
        let inner_buf: &[u8];

        {
            let ptr = context_ptr.map(|p| p as usize).unwrap_or(0);
            let fmt = bun_fmt::hex_int_upper(ptr);

            // TODO(port): std.fmt.bufPrint → write!-into-slice
            let written = if !self.arg_types.is_empty() {
                let mut cursor = std::io::Cursor::new(&mut inner_buf_[1..]);
                write!(
                    &mut cursor,
                    "FFI_Callback_call((void*)0x{}ULL, {}, arguments)",
                    fmt,
                    self.arg_types.len()
                )?;
                cursor.position() as usize
            } else {
                let mut cursor = std::io::Cursor::new(&mut inner_buf_[1..]);
                write!(
                    &mut cursor,
                    "FFI_Callback_call((void*)0x{}ULL, 0, (ZIG_REPR_TYPE*)0)",
                    fmt
                )?;
                cursor.position() as usize
            };
            inner_buf = &inner_buf_[1..1 + written];
        }

        if self.return_type == ABIType::Void {
            writer.write_all(inner_buf)?;
        } else {
            let len = inner_buf.len() + 1;
            let inner_buf = &mut inner_buf_[0..len];
            inner_buf[0] = b'_';
            write!(writer, "return {}", self.return_type.to_c_exact(inner_buf))?;
        }

        writer.write_all(b";\n}\n\n")?;
        Ok(())
    }

    fn needs_napi_env(&self) -> bool {
        for arg in self.arg_types.iter() {
            if *arg == ABIType::NapiEnv || *arg == ABIType::NapiValue {
                return true;
            }
        }
        false
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn FFI_Callback_call(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_0(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_1(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_2(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_3(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_4(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_5(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_threadsafe_call(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_6(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn FFI_Callback_call_7(_: *mut c_void, _: usize, _: *mut JSValue) -> JSValue;
    fn Bun__createFFICallbackFunction(_: &JSGlobalObject, _: JSValue) -> *mut c_void;
}

// ─── Step ───────────────────────────────────────────────────────────────────

pub enum Step {
    Pending,
    Compiled(Compiled),
    Failed { msg: Box<[u8]>, allocated: bool },
}

pub struct Compiled {
    pub ptr: *mut c_void,
    // TODO(port): bare JSValue on heap — rooted via JSFFI.symbolsValue own: property; revisit Strong/JsRef in Phase B
    pub js_function: JSValue,
    pub js_context: Option<*mut JSGlobalObject>,
    pub ffi_callback_function_wrapper: Option<NonNull<c_void>>,
}

impl Default for Compiled {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            js_function: JSValue::ZERO,
            js_context: None,
            ffi_callback_function_wrapper: None,
        }
    }
}

impl Step {
    fn compiled_ptr(&self) -> *mut c_void {
        match self {
            Step::Compiled(c) => c.ptr,
            _ => core::ptr::null_mut(),
        }
    }
}

// ─── ABIType ────────────────────────────────────────────────────────────────

// Must be kept in sync with JSFFIFunction.h version
#[repr(i32)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum ABIType {
    #[strum(serialize = "char")]
    Char = 0,

    #[strum(serialize = "int8_t")]
    Int8T = 1,
    #[strum(serialize = "uint8_t")]
    Uint8T = 2,

    #[strum(serialize = "int16_t")]
    Int16T = 3,
    #[strum(serialize = "uint16_t")]
    Uint16T = 4,

    #[strum(serialize = "int32_t")]
    Int32T = 5,
    #[strum(serialize = "uint32_t")]
    Uint32T = 6,

    #[strum(serialize = "int64_t")]
    Int64T = 7,
    #[strum(serialize = "uint64_t")]
    Uint64T = 8,

    #[strum(serialize = "double")]
    Double = 9,
    #[strum(serialize = "float")]
    Float = 10,

    #[strum(serialize = "bool")]
    Bool = 11,

    #[strum(serialize = "ptr")]
    Ptr = 12,

    #[strum(serialize = "void")]
    Void = 13,

    #[strum(serialize = "cstring")]
    CString = 14,

    #[strum(serialize = "i64_fast")]
    I64Fast = 15,
    #[strum(serialize = "u64_fast")]
    U64Fast = 16,

    #[strum(serialize = "function")]
    Function = 17,
    #[strum(serialize = "napi_env")]
    NapiEnv = 18,
    #[strum(serialize = "napi_value")]
    NapiValue = 19,
    #[strum(serialize = "buffer")]
    Buffer = 20,
}

impl ABIType {
    pub const MAX: i32 = ABIType::NapiValue as i32;

    /// Types that we can directly pass through as an `int64_t`
    pub fn needs_a_cast_in_c(self) -> bool {
        !matches!(
            self,
            ABIType::Char
                | ABIType::Int8T
                | ABIType::Uint8T
                | ABIType::Int16T
                | ABIType::Uint16T
                | ABIType::Int32T
                | ABIType::Uint32T
        )
    }

    pub static LABEL: phf::Map<&'static [u8], ABIType> = phf::phf_map! {
        b"bool" => ABIType::Bool,
        b"c_int" => ABIType::Int32T,
        b"c_uint" => ABIType::Uint32T,
        b"char" => ABIType::Char,
        b"char*" => ABIType::Ptr,
        b"double" => ABIType::Double,
        b"f32" => ABIType::Float,
        b"f64" => ABIType::Double,
        b"float" => ABIType::Float,
        b"i16" => ABIType::Int16T,
        b"i32" => ABIType::Int32T,
        b"i64" => ABIType::Int64T,
        b"i8" => ABIType::Int8T,
        b"int" => ABIType::Int32T,
        b"int16_t" => ABIType::Int16T,
        b"int32_t" => ABIType::Int32T,
        b"int64_t" => ABIType::Int64T,
        b"int8_t" => ABIType::Int8T,
        b"isize" => ABIType::Int64T,
        b"u16" => ABIType::Uint16T,
        b"u32" => ABIType::Uint32T,
        b"u64" => ABIType::Uint64T,
        b"u8" => ABIType::Uint8T,
        b"uint16_t" => ABIType::Uint16T,
        b"uint32_t" => ABIType::Uint32T,
        b"uint64_t" => ABIType::Uint64T,
        b"uint8_t" => ABIType::Uint8T,
        b"usize" => ABIType::Uint64T,
        b"size_t" => ABIType::Uint64T,
        b"buffer" => ABIType::Buffer,
        b"void*" => ABIType::Ptr,
        b"ptr" => ABIType::Ptr,
        b"pointer" => ABIType::Ptr,
        b"void" => ABIType::Void,
        b"cstring" => ABIType::CString,
        b"i64_fast" => ABIType::I64Fast,
        b"u64_fast" => ABIType::U64Fast,
        b"function" => ABIType::Function,
        b"callback" => ABIType::Function,
        b"fn" => ABIType::Function,
        b"napi_env" => ABIType::NapiEnv,
        b"napi_value" => ABIType::NapiValue,
    };

    // TODO(port): map_to_js_object — Zig builds a comptime "{...}" string from `map` via
    // EnumMapFormatter. Rust cannot iterate phf at const time; generate via build.rs or
    // const_format! in Phase B.
    pub const MAP_TO_JS_OBJECT: &'static str = ""; // placeholder

    pub fn is_floating_point(self) -> bool {
        matches!(self, ABIType::Double | ABIType::Float)
    }

    pub fn to_c(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter { tag: self, symbol, exact: false }
    }

    pub fn to_c_exact(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter { tag: self, symbol, exact: true }
    }

    pub fn to_js(self, symbol: &[u8]) -> ToJSFormatter<'_> {
        ToJSFormatter { tag: self, symbol }
    }

    pub fn typename(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn typename_label(self) -> &'static [u8] {
        match self {
            ABIType::Buffer | ABIType::Function | ABIType::CString | ABIType::Ptr => b"void*",
            ABIType::Bool => b"bool",
            ABIType::Int8T => b"int8_t",
            ABIType::Uint8T => b"uint8_t",
            ABIType::Int16T => b"int16_t",
            ABIType::Uint16T => b"uint16_t",
            ABIType::Int32T => b"int32_t",
            ABIType::Uint32T => b"uint32_t",
            ABIType::I64Fast | ABIType::Int64T => b"int64_t",
            ABIType::U64Fast | ABIType::Uint64T => b"uint64_t",
            ABIType::Double => b"double",
            ABIType::Float => b"float",
            ABIType::Char => b"char",
            ABIType::Void => b"void",
            ABIType::NapiEnv => b"napi_env",
            ABIType::NapiValue => b"napi_value",
        }
    }

    pub fn param_typename(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn param_typename_label(self) -> &'static [u8] {
        match self {
            ABIType::Function | ABIType::CString | ABIType::Ptr => b"void*",
            ABIType::Bool => b"bool",
            ABIType::Int8T => b"int8_t",
            ABIType::Uint8T => b"uint8_t",
            ABIType::Int16T => b"int16_t",
            ABIType::Uint16T => b"uint16_t",
            // see the comment in ffi.ts about why `uint32_t` acts as `int32_t`
            ABIType::Int32T | ABIType::Uint32T => b"int32_t",
            ABIType::I64Fast | ABIType::Int64T => b"int64_t",
            ABIType::U64Fast | ABIType::Uint64T => b"uint64_t",
            ABIType::Double => b"double",
            ABIType::Float => b"float",
            ABIType::Char => b"char",
            ABIType::Void => b"void",
            ABIType::NapiEnv => b"napi_env",
            ABIType::NapiValue => b"napi_value",
            ABIType::Buffer => b"buffer",
        }
    }
}

pub struct EnumMapFormatter<'a> {
    pub name: &'a [u8],
    pub entry: ABIType,
}

impl fmt::Display for EnumMapFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("['")?;
        // these are not all valid identifiers
        fmt::Display::fmt(BStr::new(self.name), f)?;
        f.write_str("']:")?;
        write!(f, "{}", self.entry as i32)?;
        f.write_str(",'")?;
        write!(f, "{}", self.entry as i32)?;
        f.write_str("':")?;
        write!(f, "{}", self.entry as i32)
    }
}

pub struct ToCFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
    pub exact: bool,
}

impl fmt::Display for ToCFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.tag {
            ABIType::Void => return Ok(()),
            ABIType::Bool => {
                if self.exact {
                    writer.write_str("(bool)")?;
                }
                writer.write_str("JSVALUE_TO_BOOL(")?;
            }
            ABIType::Char
            | ABIType::Int8T
            | ABIType::Uint8T
            | ABIType::Int16T
            | ABIType::Uint16T
            | ABIType::Int32T
            | ABIType::Uint32T => {
                if self.exact {
                    write!(writer, "({})", <&'static str>::from(self.tag))?;
                }
                writer.write_str("JSVALUE_TO_INT32(")?;
            }
            ABIType::I64Fast | ABIType::Int64T => {
                if self.exact {
                    writer.write_str("(int64_t)")?;
                }
                writer.write_str("JSVALUE_TO_INT64(")?;
            }
            ABIType::U64Fast | ABIType::Uint64T => {
                if self.exact {
                    writer.write_str("(uint64_t)")?;
                }
                writer.write_str("JSVALUE_TO_UINT64(")?;
            }
            ABIType::Function | ABIType::CString | ABIType::Ptr => {
                if self.exact {
                    writer.write_str("(void*)")?;
                }
                writer.write_str("JSVALUE_TO_PTR(")?;
            }
            ABIType::Double => {
                if self.exact {
                    writer.write_str("(double)")?;
                }
                writer.write_str("JSVALUE_TO_DOUBLE(")?;
            }
            ABIType::Float => {
                if self.exact {
                    writer.write_str("(float)")?;
                }
                writer.write_str("JSVALUE_TO_FLOAT(")?;
            }
            ABIType::NapiEnv => {
                writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)")?;
                return Ok(());
            }
            ABIType::NapiValue => {
                fmt::Display::fmt(BStr::new(self.symbol), writer)?;
                writer.write_str(".asNapiValue")?;
                return Ok(());
            }
            ABIType::Buffer => {
                writer.write_str("JSVALUE_TO_TYPED_ARRAY_VECTOR(")?;
            }
        }
        fmt::Display::fmt(BStr::new(self.symbol), writer)?;
        writer.write_str(")")
    }
}

pub struct ToJSFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
}

impl fmt::Display for ToJSFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sym = BStr::new(self.symbol);
        match self.tag {
            ABIType::Void => Ok(()),
            ABIType::Bool => write!(writer, "BOOLEAN_TO_JSVALUE({})", sym),
            ABIType::Char
            | ABIType::Int8T
            | ABIType::Uint8T
            | ABIType::Int16T
            | ABIType::Uint16T
            | ABIType::Int32T => write!(writer, "INT32_TO_JSVALUE((int32_t){})", sym),
            ABIType::Uint32T => write!(writer, "UINT32_TO_JSVALUE({})", sym),
            ABIType::I64Fast => {
                write!(writer, "INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t){})", sym)
            }
            ABIType::Int64T => {
                write!(writer, "INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::U64Fast => {
                write!(writer, "UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::Uint64T => {
                write!(writer, "UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::Function | ABIType::CString | ABIType::Ptr => {
                write!(writer, "PTR_TO_JSVALUE({})", sym)
            }
            ABIType::Double => write!(writer, "DOUBLE_TO_JSVALUE({})", sym),
            ABIType::Float => write!(writer, "FLOAT_TO_JSVALUE({})", sym),
            ABIType::NapiEnv => writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)"),
            ABIType::NapiValue => {
                write!(writer, "((EncodedJSValue) {{.asNapiValue = {} }} )", sym)
            }
            ABIType::Buffer => writer.write_str("0"),
        }
    }
}

// ─── CompilerRT ─────────────────────────────────────────────────────────────

struct CompilerRT;

// TODO(port): mutable static — wrap in OnceLock<Box<ZStr>>
static mut COMPILER_RT_DIR: &'static ZStr = ZStr::EMPTY;

struct CompilerRtSources;
impl CompilerRtSources {
    const SOURCES: &'static [(&'static str, &'static [u8])] = &[
        ("stdbool.h", include_bytes!("./ffi-stdbool.h")),
        ("stdarg.h", include_bytes!("./ffi-stdarg.h")),
        ("stdnoreturn.h", include_bytes!("./ffi-stdnoreturn.h")),
        ("stdalign.h", include_bytes!("./ffi-stdalign.h")),
        ("tgmath.h", include_bytes!("./ffi-tgmath.h")),
        ("stddef.h", include_bytes!("./ffi-stddef.h")),
        ("varargs.h", b"// empty"),
    ];
}

static CREATE_COMPILER_RT_DIR_ONCE: Once = Once::new();

impl CompilerRT {
    fn create_compiler_rt_dir() {
        let Ok(tmpdir) = Fs::FileSystem::instance().tmpdir() else {
            return;
        };
        // TODO(port): std.fs.Dir.makeOpenPath — using bun_sys equivalent
        let Ok(mut bun_cc) = tmpdir.make_open_path(b"bun-cc") else {
            return;
        };
        let _guard = scopeguard::guard(&mut bun_cc, |d| d.close());

        for (name, source) in CompilerRtSources::SOURCES {
            let _ = bun_cc.write_file(name.as_bytes(), source);
        }
        let mut path_buf = PathBuffer::uninit();
        let Ok(p) = bun_sys::get_fd_path(Fd::from_std_dir(&bun_cc), &mut path_buf) else {
            return;
        };
        // SAFETY: writing once-initialized static under Once guard
        unsafe {
            COMPILER_RT_DIR = Box::leak(ZStr::from_bytes(p).into());
        }
    }

    pub fn dir() -> Option<&'static ZStr> {
        CREATE_COMPILER_RT_DIR_ONCE.call_once(Self::create_compiler_rt_dir);
        // SAFETY: read-only after Once initialization
        let d = unsafe { COMPILER_RT_DIR };
        if d.is_empty() {
            return None;
        }
        Some(d)
    }

    #[inline(never)]
    extern "C" fn memset(dest: *mut u8, c: u8, byte_count: usize) {
        // SAFETY: caller (TCC-compiled code) guarantees dest[0..byte_count] is writable
        unsafe { core::slice::from_raw_parts_mut(dest, byte_count) }.fill(c);
    }

    #[inline(never)]
    extern "C" fn memcpy(dest: *mut u8, source: *const u8, byte_count: usize) {
        // SAFETY: caller (TCC-compiled code) guarantees non-overlapping valid ranges
        unsafe {
            core::slice::from_raw_parts_mut(dest, byte_count)
                .copy_from_slice(core::slice::from_raw_parts(source, byte_count));
        }
    }

    pub fn define(state: &mut TCC::State) {
        #[cfg(target_arch = "x86_64")]
        {
            state.define_symbol(b"NEEDS_COMPILER_RT_FUNCTIONS", b"1");
            if state
                .compile_string(ZStr::from_static(include_bytes!("libtcc1.c")))
                .is_err()
            {
                if cfg!(debug_assertions) {
                    panic!("Failed to compile libtcc1.c");
                }
            }
        }

        // TODO(port): @import("../../jsc/sizes.zig") → bun_jsc::sizes
        let offsets = Offsets::get();
        // TODO(port): TCC::State::define_symbols_comptime API — Zig used struct literal with int values
        state.define_symbols(&[
            (
                "Bun_FFI_PointerOffsetToArgumentsList",
                bun_jsc::sizes::Bun_FFI_PointerOffsetToArgumentsList,
            ),
            (
                "JSArrayBufferView__offsetOfLength",
                offsets.js_array_buffer_view_offset_of_length as i64,
            ),
            (
                "JSArrayBufferView__offsetOfVector",
                offsets.js_array_buffer_view_offset_of_vector as i64,
            ),
            ("JSCell__offsetOfType", offsets.js_cell_offset_of_type as i64),
            (
                "JSTypeArrayBufferViewMin",
                jsc::JSType::min_typed_array() as i64,
            ),
            (
                "JSTypeArrayBufferViewMax",
                jsc::JSType::max_typed_array() as i64,
            ),
        ]);
    }

    pub fn inject(state: &mut TCC::State) {
        state
            .add_symbol(b"memset", Self::memset as *const c_void)
            .expect("unreachable");
        state
            .add_symbol(b"memcpy", Self::memcpy as *const c_void)
            .expect("unreachable");
        state
            .add_symbol(
                b"NapiHandleScope__open",
                napi::NapiHandleScope::NapiHandleScope__open as *const c_void,
            )
            .expect("unreachable");
        state
            .add_symbol(
                b"NapiHandleScope__close",
                napi::NapiHandleScope::NapiHandleScope__close as *const c_void,
            )
            .expect("unreachable");

        state
            .add_symbol(b"JSVALUE_TO_INT64_SLOW", WORKAROUND.jsvalue_to_int64 as *const c_void)
            .expect("unreachable");
        state
            .add_symbol(b"JSVALUE_TO_UINT64_SLOW", WORKAROUND.jsvalue_to_uint64 as *const c_void)
            .expect("unreachable");
        state
            .add_symbol(b"INT64_TO_JSVALUE_SLOW", WORKAROUND.int64_to_jsvalue as *const c_void)
            .expect("unreachable");
        state
            .add_symbol(b"UINT64_TO_JSVALUE_SLOW", WORKAROUND.uint64_to_jsvalue as *const c_void)
            .expect("unreachable");
    }
}

struct MyFunctionSStructWorkAround {
    jsvalue_to_int64: extern "C" fn(JSValue) -> i64,
    jsvalue_to_uint64: extern "C" fn(JSValue) -> u64,
    int64_to_jsvalue: extern "C" fn(*mut JSGlobalObject, i64) -> JSValue,
    uint64_to_jsvalue: extern "C" fn(*mut JSGlobalObject, u64) -> JSValue,
    bun_call: extern "C" fn(
        // TODO(port): @TypeOf(jsc.C.JSObjectCallAsFunction) signature
        ctx: *mut c_void,
        function: *mut c_void,
        this_object: *mut c_void,
        argument_count: usize,
        arguments: *const JSValue,
        exception: *mut *mut c_void,
    ) -> *mut c_void,
}

// TODO(port): JSValue.exposed_to_ffi — these are static fn ptrs from headers
static WORKAROUND: MyFunctionSStructWorkAround = MyFunctionSStructWorkAround {
    jsvalue_to_int64: jsc::exposed_to_ffi::JSVALUE_TO_INT64,
    jsvalue_to_uint64: jsc::exposed_to_ffi::JSVALUE_TO_UINT64,
    int64_to_jsvalue: jsc::exposed_to_ffi::INT64_TO_JSVALUE,
    uint64_to_jsvalue: jsc::exposed_to_ffi::UINT64_TO_JSVALUE,
    bun_call: jsc::c::JSObjectCallAsFunction,
};

// ─── exports ────────────────────────────────────────────────────────────────

pub use FFI as Bun__FFI__cc_owner; // TODO(port): Zig re-exported FFI.Bun__FFI__cc at module level

fn make_napi_env_if_needed<'a>(
    functions: impl IntoIterator<Item = &'a Function>,
    global_this: &JSGlobalObject,
) -> Option<&'a napi::NapiEnv> {
    for function in functions {
        if function.needs_napi_env() {
            // TODO(port): lifetime — makeNapiEnvForFFI returns a heap-allocated env owned by VM
            return Some(global_this.make_napi_env_for_ffi());
        }
    }
    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/ffi/ffi.zig (2465 lines)
//   confidence: low
//   todos:      34
//   notes:      Heavy TCC/JSC interop; ZStr ownership, mutable statics, TCC::State API surface, map_to_js_object const generation, and borrowck reshaping all need Phase B attention. Function::deinit folded into Drop.
// ──────────────────────────────────────────────────────────────────────────
