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
    fn Bun__CModule__createExports(global: *const JSGlobalObject, module: *mut c_void) -> JSValue;
}

/// Resolves what the C source declares but does not define: whatever the process already has
/// loaded (libc, libm, Bun's own exported symbols such as `napi_*`).
unsafe extern "C" fn resolve_extern(name: *const c_char, name_len: usize) -> *mut c_void {
    // SAFETY: `name` is NUL-terminated with `name_len` bytes before the NUL.
    let name = unsafe { ZStr::from_raw(name.cast::<u8>(), name_len) };
    // Bun keeps the list itself (`at_exit`), on every platform.
    if name.as_bytes() == b"atexit" {
        return at_exit::atexit as *mut c_void;
    }
    #[cfg(not(windows))]
    if let Some(address) = compiler_runtime::find(name.as_bytes()) {
        return address;
    }
    if let Some(address) = bun_sys::dlsym_impl(None, name) {
        return address;
    }
    #[cfg(windows)]
    if let Some(address) =
        windows_libraries(name).or_else(|| windows_runtime::find(name.as_bytes()))
    {
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
/// and the `printf` and `scanf` families and `at_quick_exit`, which with the Universal C Runtime are
/// inline functions of its headers or part of a program's startup code (JSCFFIBridge.cpp has those).
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
        Bun__CModule__at_quick_exit
    );

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
            b"at_quick_exit" => Bun__CModule__at_quick_exit as *mut c_void,
            _ => return None,
        })
    }
}

/// Windows has no process-wide symbol lookup: every library is asked by name. These are the ones
/// Microsoft's toolchain links by default: the Universal C Runtime, the compiler's runtime (memcpy,
/// setjmp, ...), then the core system libraries.
#[cfg(windows)]
fn windows_libraries(name: &ZStr) -> Option<*mut c_void> {
    const LIBRARIES: [&core::ffi::CStr; 6] = [
        c"ucrtbase.dll",
        c"vcruntime140.dll",
        c"kernel32.dll",
        c"user32.dll",
        c"advapi32.dll",
        c"ws2_32.dll",
    ];
    LIBRARIES.iter().find_map(|library| {
        // SAFETY: a NUL-terminated name; loading (or re-finding) a system library has no preconditions.
        let handle = unsafe { bun_sys::windows::LoadLibraryA(library.as_ptr()) };
        if handle.is_null() {
            return None;
        }
        bun_sys::dlsym_impl(Some(handle), name)
    })
}

/// What compiled C registers with `atexit`, and its destructors: Bun keeps the list, on every
/// platform, and runs it, then writes out what C's stdio has buffered, when the process ends (once,
/// whichever way it ends) and when a C program that `--watch` or `--hot` will run again returns.
/// The first C module to load registers the hook with the way Bun leaves the process there:
/// `quick_exit` on Linux, which runs neither `atexit` handlers nor flushes anything itself, `exit`
/// on macOS, Bun's own exit callbacks on Windows (where the C code has a C runtime of its own,
/// ucrtbase.dll: Bun's is linked statically).
mod at_exit {
    use core::ffi::c_int;
    use core::sync::atomic::{AtomicBool, Ordering};

    static HANDLERS: bun_threading::Guarded<Vec<unsafe extern "C" fn()>> =
        bun_threading::Guarded::new(Vec::new());
    static RAN: AtomicBool = AtomicBool::new(false);

    /// Calls what compiled C has registered with `atexit` so far, last registered first (a handler
    /// may register another), then writes out what C's stdio has buffered.
    pub(super) fn run_handlers() {
        loop {
            let Some(handler) = HANDLERS.lock().pop() else {
                break;
            };
            // SAFETY: a `void f(void)` the C program passed to `atexit`.
            unsafe { handler() };
        }
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
            #[cfg(all(target_os = "linux", target_env = "gnu"))]
            {
                use core::ffi::c_void;
                unsafe extern "C" {
                    fn __cxa_atexit(
                        function: unsafe extern "C" fn(*mut c_void),
                        argument: *mut c_void,
                        dso_handle: *mut c_void,
                    ) -> c_int;
                    fn __cxa_at_quick_exit(
                        function: unsafe extern "C" fn(*mut c_void),
                        dso_handle: *mut c_void,
                    ) -> c_int;
                }
                unsafe extern "C" fn at_exit(_: *mut c_void) {
                    at_process_exit();
                }
                unsafe extern "C" fn at_quick_exit(_: *mut c_void) {
                    // `quick_exit` is how Bun itself leaves. A C program that calls it gets what C
                    // says it does: its `at_quick_exit` handlers, not its `atexit` ones, and no flush.
                    if bun_core::Global::is_exiting() {
                        at_process_exit();
                    }
                }
                // SAFETY: registers the two hooks with libc; a null dso handle means "not part of
                // a shared object".
                unsafe {
                    __cxa_atexit(at_exit, core::ptr::null_mut(), core::ptr::null_mut());
                    __cxa_at_quick_exit(at_quick_exit, core::ptr::null_mut());
                }
            }
            #[cfg(all(unix, not(all(target_os = "linux", target_env = "gnu"))))]
            {
                unsafe extern "C" {
                    fn atexit(handler: extern "C" fn()) -> c_int;
                }
                // SAFETY: registers the hook with libc.
                unsafe {
                    atexit(at_process_exit);
                }
            }
            #[cfg(windows)]
            {
                unsafe extern "C" {
                    safe fn Bun__CModule__runExitHandlers();
                }
                // Then what the C code's own C runtime does when a program ends: its
                // `at_quick_exit`-free half of `exit` (`_cexit`).
                extern "C" fn run() {
                    at_process_exit();
                    Bun__CModule__runExitHandlers();
                }
                bun_core::Global::add_exit_callback(run);
            }
        });
    }

    /// What compiled C gets for `atexit`.
    pub(super) unsafe extern "C" fn atexit(handler: unsafe extern "C" fn()) -> c_int {
        HANDLERS.lock().push(handler);
        0
    }
}

/// Writes out what the C library's stdio has buffered, in every open output stream.
fn flush_c_streams() {
    type Fflush = unsafe extern "C" fn(*mut c_void) -> core::ffi::c_int;
    #[cfg(unix)]
    let fflush: Fflush = {
        unsafe extern "C" {
            fn fflush(stream: *mut c_void) -> core::ffi::c_int;
        }
        fflush
    };
    // The C runtime the compiled code's own calls go to, not the one linked into Bun.
    #[cfg(windows)]
    let fflush: Fflush = {
        let Some(address) = windows_libraries(bun_core::zstr!("fflush")) else {
            return;
        };
        // SAFETY: `int fflush(FILE *)` of ucrtbase.dll.
        unsafe { core::mem::transmute::<*mut c_void, Fflush>(address) }
    };
    // SAFETY: a null stream means every open output stream.
    unsafe { fflush(core::ptr::null_mut()) };
}

/// glibc does not export these from libc.so: a C compiler links them from libc_nonshared.a, where
/// each is a few instructions that pass the program's `__dso_handle` to the function that is
/// exported. Code compiled here has no such object of its own, so it registers without one.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn glibc_static_stub(name: &[u8]) -> Option<*mut c_void> {
    unsafe extern "C" {
        fn __cxa_at_quick_exit(
            function: unsafe extern "C" fn(*mut c_void),
            dso_handle: *mut c_void,
        ) -> core::ffi::c_int;
        fn __register_atfork(
            prepare: Option<unsafe extern "C" fn()>,
            parent: Option<unsafe extern "C" fn()>,
            child: Option<unsafe extern "C" fn()>,
            dso_handle: *mut c_void,
        ) -> core::ffi::c_int;
    }
    // The handler takes no argument; being handed one it ignores is how glibc's own stub works.
    unsafe extern "C" fn at_quick_exit(
        function: unsafe extern "C" fn(*mut c_void),
    ) -> core::ffi::c_int {
        // SAFETY: registers `function` with libc; a null dso handle means "not part of a shared object".
        unsafe { __cxa_at_quick_exit(function, core::ptr::null_mut()) }
    }
    unsafe extern "C" fn pthread_atfork(
        prepare: Option<unsafe extern "C" fn()>,
        parent: Option<unsafe extern "C" fn()>,
        child: Option<unsafe extern "C" fn()>,
    ) -> core::ffi::c_int {
        // SAFETY: as above.
        unsafe { __register_atfork(prepare, parent, child, core::ptr::null_mut()) }
    }
    match name {
        b"at_quick_exit" => Some(at_quick_exit as *mut c_void),
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
    let source: Cow<'a, [u8]> = match contents {
        Some(contents) => Cow::Borrowed(contents),
        None => match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
            Ok(bytes) => Cow::Owned(bytes),
            Err(err) => {
                compiled.bir = Err(CCompileError::Read(err.with_path(path)));
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
    let Some(target) = bun_cc::Target::host() else {
        compiled.bir = Err(CCompileError::UnsupportedPlatform);
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
    run_main_if_any(global_this, frame.this(), vm.main(), &vm.argv)?;
    Ok(JSValue::UNDEFINED)
}

/// `bun program.c`: a C file that is the entry point and defines `main` is a program. Runs it with
/// the arguments after the file's name and ends the process with what it returns, the way
/// `process.exit(status)` does. With `--watch` or `--hot` a program that has run to its end is a
/// script that has: the process stays to run it again when a file changes.
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
        let Some(address) = windows_libraries(bun_core::zstr!("__p__environ")) else {
            return core::ptr::null();
        };
        // SAFETY: `char ***__p__environ(void)` of ucrtbase.dll.
        unsafe {
            let get: unsafe extern "C" fn() -> *mut *const *const c_char =
                core::mem::transmute(address);
            *get()
        }
    }
}

/// Bun turns buffering off for C's `stdout` when it starts, because it writes to the descriptor
/// itself. A C program that is the entry point has `stdout` to itself and gets what it would have
/// in an executable of its own: a line at a time to a terminal, a block at a time otherwise. What is
/// buffered when the program ends is written by the exit hook.
fn give_stdout_a_buffer() {
    #[cfg(unix)]
    {
        unsafe extern "C" {
            #[cfg_attr(target_os = "macos", link_name = "__stdoutp")]
            static stdout: *mut c_void;
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
        // The stream's for as long as the process runs. (Without a buffer of the caller's, glibc
        // keeps the one-byte buffer an unbuffered stream has.)
        struct Buffer(core::cell::UnsafeCell<[c_char; 8192]>);
        // SAFETY: only libc's stdio touches the bytes, under the stream's lock.
        unsafe impl Sync for Buffer {}
        static BUFFER: Buffer = Buffer(core::cell::UnsafeCell::new([0; 8192]));
        // Once: `--hot` runs the program again, and a stream's buffer is set before it is used.
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            // SAFETY: libc's `stdout`, and a buffer that outlives it.
            unsafe {
                let mode = if isatty(1) != 0 { IOLBF } else { IOFBF };
                setvbuf(stdout, BUFFER.0.get().cast::<c_char>(), mode, 8192);
            }
        });
    }
}
