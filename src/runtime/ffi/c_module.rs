//! C compiled by `bun_cc` and JavaScriptCore's B3: the implementation of `import … from "./x.c"`.
//!
//! `bun_cc` turns the C source into BIR (a small serialized IR); `JSC::FFI::CModule` lowers BIR to
//! machine code and hands back one `JSFFIFunction` per non-static C function, typed from its C
//! declaration. Calls go through the same FFI JIT as `dlopen` symbols, and the FTL can inline a
//! function's body because the module keeps its BIR.

use core::ffi::{c_char, c_void};
use std::borrow::Cow;

use bstr::BStr;

use bun_core::ZStr;
use bun_jsc::module_loader::{CCompileError, CompiledC};
use bun_jsc::{self as jsc, ErrorCode, JSGlobalObject, JSValue, JsResult, SysErrorJsc as _};

unsafe extern "C" {
    fn Bun__CModule__create(
        bir: *const u8,
        bir_len: usize,
        resolve: unsafe extern "C" fn(*const c_char, usize) -> *mut c_void,
        out: *mut *mut c_void,
        error: *mut bun_core::String,
    ) -> bool;
    fn Bun__CModule__registerDestructors(
        module: *mut c_void,
        add: unsafe extern "C" fn(unsafe extern "C" fn()),
    );
    fn Bun__CModule__runConstructors(module: *mut c_void);
    fn Bun__CModule__createExports(global: *const JSGlobalObject, module: *mut c_void) -> JSValue;
}

/// Resolves what the C source declares but does not define: whatever the process already has
/// loaded (libc, libm, Bun's own exported symbols such as `napi_*`).
unsafe extern "C" fn resolve_extern(name: *const c_char, name_len: usize) -> *mut c_void {
    // SAFETY: `name` is NUL-terminated with `name_len` bytes before the NUL.
    let name = unsafe { ZStr::from_raw(name.cast::<u8>(), name_len) };
    // Bun keeps both lists itself (`at_exit`), on every platform.
    match name.as_bytes() {
        b"atexit" => return at_exit::atexit as *mut c_void,
        b"at_quick_exit" => return at_exit::at_quick_exit as *mut c_void,
        b"quick_exit" => return at_exit::quick_exit as *mut c_void,
        _ => {}
    }
    #[cfg(not(windows))]
    if let Some(address) = compiler_runtime::find(name.as_bytes()) {
        return address;
    }
    // What a toolchain links statically into a program is in no library: asked for first, so that
    // looking for it loads nothing.
    #[cfg(windows)]
    if let Some(address) = windows_runtime::find(name.as_bytes()) {
        return address;
    }
    if let Some(address) = bun_sys::dlsym_impl(None, name) {
        return address;
    }
    #[cfg(windows)]
    if let Some(address) = windows_libraries(name) {
        return address;
    }
    glibc_static_stub(name.as_bytes()).unwrap_or(core::ptr::null_mut())
}

/// The 128-bit integer routines of a C compiler's runtime library, which compiled code calls for what
/// the machine has no instruction for. A toolchain links them statically into each program, so whether
/// this process happens to export its own copies depends on how it was linked; these are the ones
/// compiled C gets. `__int128` is passed and returned by value here, in a register pair, as the
/// System V and AAPCS64 conventions have it (Windows passes it by address: `windows_runtime`).
#[cfg(not(windows))]
mod compiler_runtime {
    use core::ffi::c_void;

    macro_rules! binary {
        ($name:ident, $int:ty, $op:ident) => {
            extern "C" fn $name(a: $int, b: $int) -> $int {
                // Division by zero is undefined in C; it must not be a Rust panic through C frames.
                a.$op(b).unwrap_or(0)
            }
        };
    }
    binary!(udivti3, u128, checked_div);
    binary!(umodti3, u128, checked_rem);
    binary!(divti3, i128, checked_div);
    binary!(modti3, i128, checked_rem);

    macro_rules! convert {
        ($name:ident, $from:ty, $to:ty) => {
            extern "C" fn $name(value: $from) -> $to {
                value as $to
            }
        };
    }
    convert!(floattidf, i128, f64);
    convert!(floatuntidf, u128, f64);
    convert!(floattisf, i128, f32);
    convert!(floatuntisf, u128, f32);
    convert!(fixdfti, f64, i128);
    convert!(fixunsdfti, f64, u128);
    convert!(fixsfti, f32, i128);
    convert!(fixunssfti, f32, u128);

    pub(super) fn find(name: &[u8]) -> Option<*mut c_void> {
        Some(match name {
            b"__udivti3" => udivti3 as *mut c_void,
            b"__umodti3" => umodti3 as *mut c_void,
            b"__divti3" => divti3 as *mut c_void,
            b"__modti3" => modti3 as *mut c_void,
            b"__floattidf" => floattidf as *mut c_void,
            b"__floatuntidf" => floatuntidf as *mut c_void,
            b"__floattisf" => floattisf as *mut c_void,
            b"__floatuntisf" => floatuntisf as *mut c_void,
            b"__fixdfti" => fixdfti as *mut c_void,
            b"__fixunsdfti" => fixunsdfti as *mut c_void,
            b"__fixsfti" => fixsfti as *mut c_void,
            b"__fixunssfti" => fixunssfti as *mut c_void,
            _ => return None,
        })
    }
}

/// What a C toolchain on Windows links statically into every program, so no library exports it: the
/// 128-bit integer routines of the compiler's runtime (taking and returning `__int128` the way this
/// compiler passes any 16-byte object there: by address, the result through a hidden first pointer),
/// and the `printf` and `scanf` families, which with the Universal C Runtime are inline functions of
/// its headers (JSCFFIBridge.cpp has those).
#[cfg(windows)]
mod windows_runtime {
    use core::ffi::c_void;

    macro_rules! binary {
        ($name:ident, $int:ty, $op:ident) => {
            unsafe extern "C" fn $name(
                out: *mut $int,
                a: *const $int,
                b: *const $int,
            ) -> *mut $int {
                // SAFETY: the compiled code passes the addresses of three 16-byte objects of its own.
                unsafe {
                    let (a, b) = (a.read_unaligned(), b.read_unaligned());
                    // Division by zero is undefined in C; it must not be a Rust panic through C frames.
                    out.write_unaligned(a.$op(b).unwrap_or(0));
                }
                out
            }
        };
    }
    binary!(udivti3, u128, checked_div);
    binary!(umodti3, u128, checked_rem);
    binary!(divti3, i128, checked_div);
    binary!(modti3, i128, checked_rem);

    macro_rules! to_float {
        ($name:ident, $int:ty, $float:ty) => {
            unsafe extern "C" fn $name(value: *const $int) -> $float {
                // SAFETY: the address of a 16-byte object of the compiled code's.
                unsafe { value.read_unaligned() as $float }
            }
        };
    }
    to_float!(floattidf, i128, f64);
    to_float!(floatuntidf, u128, f64);
    to_float!(floattisf, i128, f32);
    to_float!(floatuntisf, u128, f32);

    macro_rules! from_float {
        ($name:ident, $float:ty, $int:ty) => {
            unsafe extern "C" fn $name(out: *mut $int, value: $float) -> *mut $int {
                // SAFETY: the address of a 16-byte object of the compiled code's.
                unsafe { out.write_unaligned(value as $int) };
                out
            }
        };
    }
    from_float!(fixdfti, f64, i128);
    from_float!(fixunsdfti, f64, u128);
    from_float!(fixsfti, f32, i128);
    from_float!(fixunssfti, f32, u128);

    macro_rules! in_the_bridge {
        ($($name:ident)*) => {
            unsafe extern "C" {
                $(fn $name();)*
            }
        };
    }
    in_the_bridge!(
        Bun__CModule__printf Bun__CModule__fprintf Bun__CModule__sprintf Bun__CModule__snprintf
        Bun__CModule__vprintf Bun__CModule__vfprintf Bun__CModule__vsprintf Bun__CModule__vsnprintf
        Bun__CModule__scanf Bun__CModule__fscanf Bun__CModule__sscanf
        Bun__CModule__vscanf Bun__CModule__vfscanf Bun__CModule__vsscanf
    );

    pub(super) const IOFBF: core::ffi::c_int = 0x0000;
    pub(super) const IONBF: core::ffi::c_int = 0x0004;

    // Calls into the C runtime compiled C uses, ucrtbase.dll (JSCFFIBridge.cpp).
    unsafe extern "C" {
        /// `setvbuf(stdout, NULL, mode, size)`.
        pub(super) safe fn Bun__CModule__bufferStdout(mode: core::ffi::c_int, size: usize);
        /// Puts `handler` on the list that runtime's `exit` runs.
        pub(super) safe fn Bun__CModule__atExitOfTheRuntime(handler: extern "C" fn());
        /// `_set_app_type(_crt_console_app)`.
        pub(super) safe fn Bun__CModule__thisIsAConsoleProgram();
        /// Whether descriptor 1 of that runtime is a console.
        pub(super) safe fn Bun__CModule__stdoutIsAConsole() -> bool;
        /// `fflush(NULL)`.
        pub(super) safe fn Bun__CModule__flushStreams();
        /// `fflush(stdout)`.
        pub(super) safe fn Bun__CModule__flushStdout();
        /// That runtime's `_environ`, made first if nothing has had it made yet.
        pub(super) safe fn Bun__CModule__environment() -> *const *const core::ffi::c_char;
        /// `_cexit()`: flushes and closes that runtime's streams.
        pub(super) safe fn Bun__CModule__runExitHandlers();
    }

    pub(super) fn find(name: &[u8]) -> Option<*mut c_void> {
        Some(match name {
            b"__udivti3" => udivti3 as *mut c_void,
            b"__umodti3" => umodti3 as *mut c_void,
            b"__divti3" => divti3 as *mut c_void,
            b"__modti3" => modti3 as *mut c_void,
            b"__floattidf" => floattidf as *mut c_void,
            b"__floatuntidf" => floatuntidf as *mut c_void,
            b"__floattisf" => floattisf as *mut c_void,
            b"__floatuntisf" => floatuntisf as *mut c_void,
            b"__fixdfti" => fixdfti as *mut c_void,
            b"__fixunsdfti" => fixunsdfti as *mut c_void,
            b"__fixsfti" => fixsfti as *mut c_void,
            b"__fixunssfti" => fixunssfti as *mut c_void,
            b"printf" => Bun__CModule__printf as *mut c_void,
            b"fprintf" => Bun__CModule__fprintf as *mut c_void,
            b"sprintf" => Bun__CModule__sprintf as *mut c_void,
            b"snprintf" => Bun__CModule__snprintf as *mut c_void,
            b"vprintf" => Bun__CModule__vprintf as *mut c_void,
            b"vfprintf" => Bun__CModule__vfprintf as *mut c_void,
            b"vsprintf" => Bun__CModule__vsprintf as *mut c_void,
            b"vsnprintf" => Bun__CModule__vsnprintf as *mut c_void,
            b"scanf" => Bun__CModule__scanf as *mut c_void,
            b"fscanf" => Bun__CModule__fscanf as *mut c_void,
            b"sscanf" => Bun__CModule__sscanf as *mut c_void,
            b"vscanf" => Bun__CModule__vscanf as *mut c_void,
            b"vfscanf" => Bun__CModule__vfscanf as *mut c_void,
            b"vsscanf" => Bun__CModule__vsscanf as *mut c_void,
            // Set by the statically linked part of Microsoft's runtime when the processor has AVX2, for
            // <wchar.h>'s inline wmemchr and friends to choose a path by. Zero is the portable path.
            b"_Avx2WmemEnabled" => {
                static AVX2_WMEM_ENABLED: core::ffi::c_int = 0;
                (&raw const AVX2_WMEM_ENABLED).cast_mut().cast::<c_void>()
            }
            // Microsoft's compiler turns a call to either into one to the function the runtime exports
            // under another name.
            b"_setjmp" => return super::windows_libraries(bun_core::zstr!("__intrinsic_setjmp")),
            b"_setjmpex" => {
                return super::windows_libraries(bun_core::zstr!("__intrinsic_setjmpex"));
            }
            _ => return None,
        })
    }
}

/// Windows has no process-wide symbol lookup: every library is asked by name. These are the ones
/// every program made with Microsoft's toolchain has: the Universal C Runtime, the compiler's
/// runtime (memcpy, setjmp, ...) and kernel32. Anything else (user32, advapi32, ws2_32, ...) is a
/// library the source names with `#pragma comment(lib, ...)`, as it is one the program names to
/// Microsoft's linker.
#[cfg(windows)]
fn windows_libraries(name: &ZStr) -> Option<*mut c_void> {
    use bun_sys::windows::kernel32::{GetModuleHandleW, LoadLibraryExW};
    const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0000_0800;
    // Handles are addresses that stay good for the life of the process.
    static LIBRARIES: std::sync::OnceLock<[usize; 3]> = std::sync::OnceLock::new();
    let libraries = LIBRARIES.get_or_init(|| {
        // SAFETY: NUL-terminated names. ucrtbase.dll and kernel32.dll are in every process;
        // vcruntime140.dll is looked for in the system directory only, never next to the
        // program or along `PATH`.
        unsafe {
            [
                LoadLibraryExW(
                    bun_core::wstr!("ucrtbase.dll").as_ptr(),
                    core::ptr::null_mut(),
                    LOAD_LIBRARY_SEARCH_SYSTEM32,
                ) as usize,
                LoadLibraryExW(
                    bun_core::wstr!("vcruntime140.dll").as_ptr(),
                    core::ptr::null_mut(),
                    LOAD_LIBRARY_SEARCH_SYSTEM32,
                ) as usize,
                GetModuleHandleW(bun_core::wstr!("kernel32.dll").as_ptr()) as usize,
            ]
        }
    });
    libraries
        .iter()
        .filter(|&&library| library != 0)
        .find_map(|&library| bun_sys::dlsym_impl(Some(library as *mut c_void), name))
}

/// What compiled C registers with `atexit` and `at_quick_exit`, and its destructors: Bun keeps the
/// lists, on every platform. The first runs, and what C's stdio has buffered is then written out,
/// when the process ends (once, whichever way it ends) and when a C program that `--watch` or
/// `--hot` will run again returns; the second only when C calls `quick_exit`. The first C module
/// to load puts the hook among Bun's own exit callbacks, which run however Bun leaves the process,
/// and where C's `exit` does not run those, on the list it does run.
mod at_exit {
    use core::ffi::c_int;
    use core::sync::atomic::{AtomicBool, Ordering};

    type Handlers = bun_threading::Guarded<Vec<unsafe extern "C" fn()>>;
    static HANDLERS: Handlers = bun_threading::Guarded::new(Vec::new());
    static QUICK_HANDLERS: Handlers = bun_threading::Guarded::new(Vec::new());
    static RAN: AtomicBool = AtomicBool::new(false);

    /// Calls what is on `handlers`, last registered first (a handler may register another).
    fn run(handlers: &Handlers) {
        loop {
            let Some(handler) = handlers.lock().pop() else {
                break;
            };
            // SAFETY: a `void f(void)` the C program registered.
            unsafe { handler() };
        }
    }

    /// Calls what compiled C has registered with `atexit` so far, then writes out what C's stdio
    /// has buffered.
    pub(super) fn run_handlers() {
        run(&HANDLERS);
        super::flush_c_streams();
    }

    extern "C" fn at_process_exit() {
        if !RAN.swap(true, Ordering::AcqRel) {
            run_handlers();
        }
    }

    pub(super) fn install() {
        static INSTALLED: std::sync::Once = std::sync::Once::new();
        INSTALLED.call_once(|| {
            #[cfg(not(windows))]
            bun_core::Global::add_exit_callback(at_process_exit);
            // C that calls `exit` itself: glibc's runs what `__cxa_atexit` registered, which
            // Bun's exit callbacks are not among. (On macOS they are.)
            #[cfg(all(target_os = "linux", target_env = "gnu"))]
            {
                use core::ffi::c_void;
                unsafe extern "C" {
                    fn __cxa_atexit(
                        function: unsafe extern "C" fn(*mut c_void),
                        argument: *mut c_void,
                        dso_handle: *mut c_void,
                    ) -> c_int;
                }
                unsafe extern "C" fn at_exit(_: *mut c_void) {
                    at_process_exit();
                }
                // SAFETY: registers the hook with libc; a null dso handle means "not part of a
                // shared object".
                unsafe {
                    __cxa_atexit(at_exit, core::ptr::null_mut(), core::ptr::null_mut());
                }
            }
            #[cfg(windows)]
            {
                use super::windows_runtime;
                // Then what the C code's own C runtime (ucrtbase.dll: Bun's is linked
                // statically) does when a program ends: `_cexit`.
                extern "C" fn at_exit_of_bun() {
                    at_process_exit();
                    windows_runtime::Bun__CModule__runExitHandlers();
                }
                bun_core::Global::add_exit_callback(at_exit_of_bun);
                // C that calls `exit` itself calls that runtime's, which ends the process without
                // Bun's exit callbacks: the hook is on its list as well.
                windows_runtime::Bun__CModule__atExitOfTheRuntime(at_process_exit);
                // That runtime's `stdout` is its own too, and gets what Bun gives its own when it
                // starts: no buffer, so that what C prints and what JavaScript prints come out
                // in the order they were printed.
                windows_runtime::Bun__CModule__bufferStdout(windows_runtime::IONBF, 0);
                // And it is told what a program's startup code tells it: this is a console
                // program, whose failed `assert` writes its message to `stderr`.
                windows_runtime::Bun__CModule__thisIsAConsoleProgram();
            }
        });
    }

    /// What compiled C gets for `atexit`.
    pub(super) unsafe extern "C" fn atexit(handler: unsafe extern "C" fn()) -> c_int {
        HANDLERS.lock().push(handler);
        0
    }

    /// What compiled C gets for `at_quick_exit`.
    pub(super) unsafe extern "C" fn at_quick_exit(handler: unsafe extern "C" fn()) -> c_int {
        QUICK_HANDLERS.lock().push(handler);
        0
    }

    /// What compiled C gets for `quick_exit`: its `at_quick_exit` handlers, then the process ends
    /// as `_Exit` ends it, without `atexit` handlers and without writing out any stream.
    pub(super) unsafe extern "C" fn quick_exit(status: c_int) -> ! {
        run(&QUICK_HANDLERS);
        #[cfg(unix)]
        // SAFETY: ends the process.
        unsafe {
            libc::_exit(status)
        }
        #[cfg(windows)]
        {
            unsafe extern "C" {
                safe fn Bun__lockThreadSuspensionForExit();
            }
            // No thread may hold this one suspended when `ExitProcess` ends it (`Global::exit`).
            Bun__lockThreadSuspensionForExit();
            bun_sys::windows::kernel32::ExitProcess(status as u32)
        }
    }
}

/// Writes out what the C library's stdio has buffered, in every open output stream.
fn flush_c_streams() {
    #[cfg(unix)]
    {
        unsafe extern "C" {
            fn fflush(stream: *mut c_void) -> core::ffi::c_int;
        }
        // SAFETY: a null stream means every open output stream.
        unsafe { fflush(core::ptr::null_mut()) };
    }
    // The C runtime the compiled code's own calls go to, not the one linked into Bun.
    #[cfg(windows)]
    windows_runtime::Bun__CModule__flushStreams();
}

/// glibc does not export this from libc.so: a C compiler links it from libc_nonshared.a, where it
/// is a few instructions that pass the program's `__dso_handle` to the function that is exported.
/// Code compiled here has no such object of its own, so it registers without one.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn glibc_static_stub(name: &[u8]) -> Option<*mut c_void> {
    unsafe extern "C" {
        fn __register_atfork(
            prepare: Option<unsafe extern "C" fn()>,
            parent: Option<unsafe extern "C" fn()>,
            child: Option<unsafe extern "C" fn()>,
            dso_handle: *mut c_void,
        ) -> core::ffi::c_int;
    }
    unsafe extern "C" fn pthread_atfork(
        prepare: Option<unsafe extern "C" fn()>,
        parent: Option<unsafe extern "C" fn()>,
        child: Option<unsafe extern "C" fn()>,
    ) -> core::ffi::c_int {
        // SAFETY: registers the handlers with libc; a null dso handle means "not part of a shared
        // object".
        unsafe { __register_atfork(prepare, parent, child, core::ptr::null_mut()) }
    }
    match name {
        b"pthread_atfork" => Some(pthread_atfork as *mut c_void),
        _ => None,
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn glibc_static_stub(_name: &[u8]) -> Option<*mut c_void> {
    None
}

/// `bun build` compiles C ahead of time: what a bundle loads in the file's place is its BIR.
fn is_bir(bytes: &[u8]) -> bool {
    bytes.starts_with(&bun_cc::BIR_MAGIC)
}

/// The C file at `path`, unless it is larger than the compiler takes: that is said without
/// reading it.
fn read_source(path: &[u8], log: &mut bun_ast::Log) -> Result<Vec<u8>, CCompileError> {
    let read = || -> bun_sys::Maybe<Option<Vec<u8>>> {
        let file = bun_sys::File::openat(bun_sys::Fd::cwd(), path, bun_sys::O::RDONLY, 0)?;
        if file.stat()?.st_size as u64 > bun_bundler::options::C_MAX_SOURCE_BYTES {
            return Ok(None);
        }
        file.read_to_end().map(Some)
    };
    match read() {
        Ok(Some(bytes)) => Ok(bytes),
        Ok(None) => {
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!("{}", bun_bundler::options::c_source_too_large(path)),
            );
            Err(CCompileError::Invalid)
        }
        Err(error) => Err(CCompileError::Read(error.with_path(path))),
    }
}

/// The half of importing the C file at `path` that touches no JavaScript state, so that it can be
/// done on any thread: reads the file (`contents` is the file when the module loader already has it
/// in memory: a standalone executable's embedded files, a plugin's answer) and compiles it.
/// `#include "…"` resolves next to `path`; `<…>` searches the compiler's own headers,
/// `C_INCLUDE_PATH`, then the system's. [`finish`] is the other half.
pub fn compile<'a>(path: &[u8], contents: Option<&'a [u8]>) -> CompiledC<'a> {
    let mut compiled = CompiledC {
        bir: Err(CCompileError::Invalid),
        precompiled: false,
        files_read: Vec::new(),
        log: bun_ast::Log::default(),
    };
    // Where compiled C runs, which is as true of the form `bun build` made of it (a module for
    // Linux x64 is a module for glibc) as of what is compiled here.
    let Some(target) = bun_cc::Target::host() else {
        compiled.bir = Err(CCompileError::UnsupportedPlatform);
        return compiled;
    };
    let source: Cow<'a, [u8]> = match contents {
        Some(contents) => Cow::Borrowed(contents),
        None => match read_source(path, &mut compiled.log) {
            Ok(bytes) => Cow::Owned(bytes),
            Err(error) => {
                compiled.bir = Err(error);
                return compiled;
            }
        },
    };
    if is_bir(&source) {
        compiled.bir = Ok(source);
        compiled.precompiled = true;
        return compiled;
    }
    // The compiler names files with `str`s (they end up in `#include` lookups and diagnostics).
    let Ok(filename) = core::str::from_utf8(path) else {
        compiled.bir = Err(CCompileError::PathNotUtf8);
        return compiled;
    };
    let unit = bun_cc::Unit {
        path: filename,
        contents: &source,
    };
    let compilation = bun_cc::compile(&[unit], target, &mut compiled.log);
    compiled.files_read = compilation.files_read;
    if let Some(output) = compilation.output {
        compiled.bir = Ok(Cow::Owned(output.bir));
    }
    compiled
}

/// The half of importing the C file at `path` that needs the VM: what [`compile`] made becomes
/// machine code and the object of its functions, or the error that says why not. `on_file_read`
/// is told about the source file and each file it `#include`s from outside the system's header
/// directories, whether or not compiling them succeeded.
pub fn finish(
    global_this: &JSGlobalObject,
    path: &[u8],
    mut compiled: CompiledC<'_>,
    on_file_read: &mut dyn FnMut(&[u8]),
) -> JsResult<JSValue> {
    for file in &compiled.files_read {
        on_file_read(file.as_bytes());
    }
    let bir = match compiled.bir {
        Ok(bir) => bir,
        Err(CCompileError::Read(err)) => return Err(err.throw(global_this)),
        Err(CCompileError::PathNotUtf8) => {
            return Err(global_this.throw(format_args!(
                "cannot compile {}: the path is not valid UTF-8",
                BStr::new(path)
            )));
        }
        Err(CCompileError::UnsupportedPlatform) => {
            return Err(global_this.throw(format_args!(
                "cannot import {}: compiling C is not supported on this platform yet (it is on {})",
                BStr::new(path),
                bun_cc::Target::SUPPORTED
            )));
        }
        // What a TypeScript file that does not parse is: a BuildMessage for each message of the log.
        Err(CCompileError::Invalid) => {
            let specifier = bun_core::String::borrow_utf8(path);
            let error = jsc::virtual_machine::process_fetch_log(
                global_this,
                &specifier,
                &bun_core::String::EMPTY,
                &mut compiled.log,
                jsc::CrateError::ParserError,
            );
            return Err(global_this.throw_value(error));
        }
    };
    if compiled.log.warnings > 0 {
        let _ = compiled
            .log
            .print(std::ptr::from_mut(bun_core::Output::error_writer()));
        bun_core::Output::flush();
    }
    let exports = load_bir(global_this, path, &bir)?;
    if compiled.precompiled {
        // What `bun build` makes the entry point call when the entry point was a C file.
        exports.put_non_enumerable(
            global_this,
            bun_bundler::options::C_RUN_MAIN_PROPERTY,
            bun_jsc::JSFunction::create(
                global_this,
                "main",
                __jsc_host_run_main_of_bundled_module,
                0,
                Default::default(),
            ),
        );
    }
    Ok(exports)
}

/// BIR -> machine code -> `{ name: function }` for every non-static C function.
///
/// The module (its code, data and the libraries it names) stays loaded until the process ends, as a
/// library opened with `dlopen` does: what C hands to the process (an `atexit` or signal handler, a
/// thread's start routine, a pointer to a static object) is an address inside it.
fn load_bir(global_this: &JSGlobalObject, path: &[u8], bir: &[u8]) -> JsResult<JSValue> {
    bun_analytics::features::c_module.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    at_exit::install();

    let mut module: *mut c_void = core::ptr::null_mut();
    let mut error = bun_core::String::EMPTY;
    // SAFETY: `bir` outlives the call; the resolver is only used during it.
    let created = unsafe {
        Bun__CModule__create(
            bir.as_ptr(),
            bir.len(),
            resolve_extern,
            &raw mut module,
            &raw mut error,
        )
    };
    if !created {
        // "x.c: undefined symbol 'f'": which of the program's C files does not load.
        return Err(global_this.throw_type_error(format_args!(
            "{}: {}",
            BStr::new(bun_paths::basename(path)),
            error
        )));
    }
    // `__attribute__((destructor))` functions run when the process ends, after what the program
    // itself registers with atexit while it runs.
    unsafe extern "C" fn run_at_exit(handler: unsafe extern "C" fn()) {
        // SAFETY: records `handler`, a `void f(void)` from the module, to be called at exit.
        unsafe {
            at_exit::atexit(handler);
        }
    }
    // SAFETY: `module` is the live module just created.
    unsafe { Bun__CModule__registerDestructors(module, run_at_exit) };
    // Constructors run once the destructors are on the list, so that what a constructor registers
    // with atexit runs before them, as it does in a linked program.
    // SAFETY: `module` is the live module just created; its constructors are `void f(void)`.
    unsafe { Bun__CModule__runConstructors(module) };
    // SAFETY: `module` holds the reference `Bun__CModule__create` returned, which is never released.
    jsc::call_check_slow(global_this, || unsafe {
        Bun__CModule__createExports(global_this, module)
    })
}

/// What importing a `.c` file evaluates to, all of it on this thread: [`compile`], then [`finish`].
pub fn load(
    global_this: &JSGlobalObject,
    path: &[u8],
    contents: Option<&[u8]>,
    on_file_read: &mut dyn FnMut(&[u8]),
) -> JsResult<JSValue> {
    check_enabled(global_this)?;
    finish(global_this, path, compile(path, contents), on_file_read)
}

/// Importing C runs native code the program supplied, like `bun:ffi`'s cc(): the same switch
/// (`--no-ffi-cc`) turns it off.
pub fn check_enabled(global_this: &JSGlobalObject) -> JsResult<()> {
    if global_this.bun_vm().allow_ffi_cc() {
        return Ok(());
    }
    Err(global_this
        .err(
            ErrorCode::FFI_CC_DISABLED,
            format_args!("Cannot import C code because the bun:ffi C compiler is disabled."),
        )
        .throw())
}

/// `require(asset).__bun_run_c_main__()`: what a bundle's entry point is when it was a C file.
#[bun_jsc::host_fn]
fn run_main_of_bundled_module(
    global_this: &JSGlobalObject,
    frame: &bun_jsc::CallFrame,
) -> JsResult<JSValue> {
    let vm = global_this.bun_vm();
    // A Worker whose entry point is a C file has its exports, bundled or not.
    if vm.worker_ref().is_none() {
        run_main_if_any(global_this, frame.this(), vm.main(), &vm.argv)?;
    }
    Ok(JSValue::UNDEFINED)
}

/// `bun program.c`: a C file that is the entry point and defines `main` is a program. Runs it with
/// the arguments after the file's name and ends the process with what it returns, the way
/// `process.exit(status)` does (the status is that one's too: the low eight bits, on every
/// platform). With `--watch` or `--hot` a program that has run to its end is a script that has:
/// the process stays to run it again when a file changes.
pub fn run_main_if_any(
    global_this: &JSGlobalObject,
    exports: JSValue,
    path: &[u8],
    arguments: &[Box<[u8]>],
) -> JsResult<()> {
    let Some(main) = exports.get(global_this, "main")? else {
        return Ok(());
    };
    if !main.is_callable() {
        return Ok(());
    }

    // In a standalone executable the entry point's path is inside the executable: the program's
    // own name, as a C program knows it, is the executable's.
    let program: &[u8] = match bun_standalone_graph::Graph::get_ref() {
        Some(_) => bun_core::self_exe_path().map_or(path, |exe| exe.as_bytes()),
        None => path,
    };
    // `argv` and its strings belong to the program until the process ends.
    let strings: Vec<std::ffi::CString> = core::iter::once(program)
        .chain(arguments.iter().map(|argument| &**argument))
        .map(|bytes| {
            let end = bun_core::strings::index_of_char_usize(bytes, 0).unwrap_or(bytes.len());
            std::ffi::CString::new(&bytes[..end]).expect("no interior NUL")
        })
        .collect();
    let strings = strings.leak();
    let argc = strings.len();
    let mut argv: Vec<*const core::ffi::c_char> =
        strings.iter().map(|string| string.as_ptr()).collect();
    argv.push(core::ptr::null());
    let argv = argv.leak().as_ptr();

    let parameter_count = main.get_length(global_this)?;
    let all = [
        JSValue::js_number(argc as f64),
        JSValue::js_number(argv as usize as f64),
        JSValue::js_number(environment() as usize as f64),
    ];
    give_stdout_a_buffer();
    let status = {
        let _running = bun_crash_handler::RunningCProgram::enter();
        main.call(
            global_this,
            JSValue::UNDEFINED,
            &all[..(parameter_count as usize).min(all.len())],
        )?
    };
    // `int` comes back as a number, a wider integer type as a BigInt; `void main` returns nothing.
    let status = if status.is_number() || status.is_big_int() {
        status.to_int64()
    } else {
        0
    };

    let vm = global_this.bun_vm().as_mut();
    if vm.is_watcher_enabled() {
        at_exit::run_handlers();
        return Ok(());
    }
    vm.exit_handler.exit_code = status as u8;
    vm.exit_handler.requested = true;
    vm.on_exit();
    vm.global_exit()
}

/// The third argument of `main`, for a program that declares one: the process's environment.
fn environment() -> *const *const c_char {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn _NSGetEnviron() -> *mut *const *const c_char;
        }
        // SAFETY: always returns the address of the process's `environ`.
        unsafe { *_NSGetEnviron() }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        unsafe extern "C" {
            static environ: *const *const c_char;
        }
        // SAFETY: libc's `environ`; read on the thread that runs JavaScript.
        unsafe { environ }
    }
    #[cfg(windows)]
    {
        // The environment of the C runtime the program's own calls (`getenv`) go to.
        windows_runtime::Bun__CModule__environment()
    }
}

/// libc's `stdout`, where C programs run (`bun_cc::Target::host`).
#[cfg(any(all(target_os = "linux", target_env = "gnu"), target_os = "macos"))]
fn c_stdout() -> *mut c_void {
    unsafe extern "C" {
        #[cfg_attr(target_os = "macos", link_name = "__stdoutp")]
        static stdout: *mut c_void;
    }
    // SAFETY: set by libc before anything of the program's runs.
    unsafe { stdout }
}

/// Whether [`give_stdout_a_buffer`] has: what C printed may then be waiting in it.
static STDOUT_HAS_A_BUFFER: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// Bun turns buffering off for C's `stdout` when it starts, because it writes to the descriptor
/// itself. A C program that is the entry point has `stdout` to itself and gets what it would have
/// in an executable of its own: a line at a time to a terminal (as it is printed, on Windows), a block
/// at a time otherwise. What is buffered is written out before JavaScript's `exit` listeners run
/// ([`Bun__CModule__flushStdoutOfAProgram`]) and by the exit hook.
fn give_stdout_a_buffer() {
    // Once: `--hot` runs the program again, and a stream's buffer is set before it is used.
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        STDOUT_HAS_A_BUFFER.store(true, core::sync::atomic::Ordering::Release);
        // The console is written as it is printed to; anything else a block at a time.
        #[cfg(windows)]
        if !windows_runtime::Bun__CModule__stdoutIsAConsole() {
            windows_runtime::Bun__CModule__bufferStdout(windows_runtime::IOFBF, 8192);
        }
        #[cfg(any(all(target_os = "linux", target_env = "gnu"), target_os = "macos"))]
        {
            unsafe extern "C" {
                fn setvbuf(
                    stream: *mut c_void,
                    buffer: *mut c_char,
                    mode: core::ffi::c_int,
                    size: usize,
                ) -> core::ffi::c_int;
                fn isatty(fd: core::ffi::c_int) -> core::ffi::c_int;
            }
            const IOFBF: core::ffi::c_int = 0;
            const IOLBF: core::ffi::c_int = 1;
            const SIZE: usize = 8192;
            // The stream's for as long as the process runs, so never freed. (Without a buffer of
            // the caller's, glibc keeps the one-byte buffer an unbuffered stream has.)
            let buffer: &'static mut [c_char; SIZE] = Box::leak(Box::new([0; SIZE]));
            // SAFETY: libc's `stdout`, and a buffer that outlives it.
            unsafe {
                let mode = if isatty(1) != 0 { IOLBF } else { IOFBF };
                setvbuf(c_stdout(), buffer.as_mut_ptr(), mode, SIZE);
            }
        }
    });
}

/// Writes out what a C program that is the entry point has printed so far. `process` calls this
/// before it runs JavaScript's `exit` listeners (BunProcess.cpp): what those print comes after
/// what the program printed before it ended, as it does when `stdout` is a terminal.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__CModule__flushStdoutOfAProgram() {
    if !STDOUT_HAS_A_BUFFER.load(core::sync::atomic::Ordering::Acquire) {
        return;
    }
    #[cfg(windows)]
    windows_runtime::Bun__CModule__flushStdout();
    #[cfg(any(all(target_os = "linux", target_env = "gnu"), target_os = "macos"))]
    {
        unsafe extern "C" {
            fn fflush(stream: *mut c_void) -> core::ffi::c_int;
        }
        // SAFETY: libc's `stdout`.
        unsafe { fflush(c_stdout()) };
    }
}
