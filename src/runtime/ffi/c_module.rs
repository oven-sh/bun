//! C compiled by `bun_cc` and JavaScriptCore's B3: the implementation of `import … from "./x.c"`.
//!
//! `bun_cc` turns the C source into BIR (a small serialized IR); `JSC::FFI::CModule` lowers BIR to
//! machine code and hands back one `JSFFIFunction` per non-static C function, typed from its C
//! declaration. Calls go through the same FFI JIT as `dlopen` symbols, and the FTL can inline a
//! function's body because the module keeps its BIR.

use core::ffi::{c_char, c_void};

use bstr::BStr;

use bun_core::ZStr;
use bun_jsc::{self as jsc, ErrorCode, JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    fn Bun__CModule__create(
        global: *const JSGlobalObject,
        bir: *const u8,
        bir_len: usize,
        resolver_context: *mut c_void,
        resolve: unsafe extern "C" fn(*mut c_void, *const c_char, usize) -> *mut c_void,
        out: *mut *mut c_void,
    ) -> JSValue;
    fn Bun__CModule__deref(module: *mut c_void);
    fn Bun__CModule__registerDestructors(
        module: *mut c_void,
        add: unsafe extern "C" fn(unsafe extern "C" fn()),
    );
    fn Bun__CModule__createExports(global: *const JSGlobalObject, module: *mut c_void) -> JSValue;
}

/// Resolves what the C source declares but does not define: whatever the process already has
/// loaded (libc, libm, Bun's own exported symbols such as `napi_*`).
struct ExternResolver;

impl ExternResolver {
    unsafe extern "C" fn resolve(
        _context: *mut c_void,
        name: *const c_char,
        name_len: usize,
    ) -> *mut c_void {
        // SAFETY: `name` is NUL-terminated with `name_len` bytes before the NUL.
        let name = unsafe { ZStr::from_raw(name.cast::<u8>(), name_len) };
        if let Some(address) = bun_sys::dlsym_impl(None, name) {
            return address;
        }
        #[cfg(windows)]
        if let Some(address) = windows_libraries(name).or_else(|| windows_runtime::find(name.as_bytes())) {
            return address;
        }
        glibc_static_stub(name.as_bytes()).unwrap_or(core::ptr::null_mut())
    }
}

/// What a C toolchain on Windows links statically into every program, so no library exports it: the
/// 128-bit integer routines of the compiler's runtime (taking and returning `__int128` the way this
/// compiler passes any 16-byte object there: by address, the result through a hidden first pointer),
/// and the `printf` and `scanf` families and `atexit`, which with the Universal C Runtime are inline
/// functions of its headers or part of a program's startup code (JSCFFIBridge.cpp has those).
#[cfg(windows)]
mod windows_runtime {
    use core::ffi::c_void;

    macro_rules! binary {
        ($name:ident, $int:ty, $op:ident) => {
            unsafe extern "C" fn $name(out: *mut $int, a: *const $int, b: *const $int) -> *mut $int {
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
    unsafe extern "C" {
        pub(super) fn Bun__CModule__atexit(handler: unsafe extern "C" fn()) -> core::ffi::c_int;
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
            b"_setjmpex" => return super::windows_libraries(bun_core::zstr!("__intrinsic_setjmpex")),
            b"atexit" => Bun__CModule__atexit as *mut c_void,
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

/// Bun leaves the process with `quick_exit` on Linux, which neither runs `atexit` handlers nor flushes
/// C's stdio. Compiled C expects both of returning from `main` / the process ending, so the first C
/// module to load registers one hook, for both ways out, that does them once.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
mod at_exit {
    use core::ffi::{c_int, c_void};
    use core::sync::atomic::{AtomicBool, Ordering};

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
        fn fflush(stream: *mut c_void) -> c_int;
    }

    static HANDLERS: bun_threading::Guarded<Vec<unsafe extern "C" fn()>> =
        bun_threading::Guarded::new(Vec::new());
    static RAN: AtomicBool = AtomicBool::new(false);

    unsafe extern "C" fn run(_: *mut c_void) {
        if RAN.swap(true, Ordering::AcqRel) {
            return;
        }
        // Last registered runs first; a handler may register another.
        loop {
            let Some(handler) = HANDLERS.lock().pop() else {
                break;
            };
            // SAFETY: a `void f(void)` the C program passed to `atexit`.
            unsafe { handler() };
        }
        // SAFETY: a null stream means every open output stream.
        unsafe { fflush(core::ptr::null_mut()) };
    }

    pub(super) fn install() {
        static INSTALLED: std::sync::Once = std::sync::Once::new();
        INSTALLED.call_once(|| {
            // SAFETY: registers `run` with libc; a null dso handle means "not part of a shared object".
            unsafe {
                __cxa_atexit(run, core::ptr::null_mut(), core::ptr::null_mut());
                __cxa_at_quick_exit(run, core::ptr::null_mut());
            }
        });
    }

    /// What compiled C gets for `atexit`.
    pub(super) unsafe extern "C" fn atexit(handler: unsafe extern "C" fn()) -> c_int {
        HANDLERS.lock().push(handler);
        0
    }
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
        b"atexit" => Some(at_exit::atexit as *mut c_void),
        b"at_quick_exit" => Some(at_quick_exit as *mut c_void),
        b"pthread_atfork" => Some(pthread_atfork as *mut c_void),
        _ => None,
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn glibc_static_stub(_name: &[u8]) -> Option<*mut c_void> {
    None
}

/// `bun build` compiles C ahead of time and embeds the BIR under the original file name.
fn is_bir(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && &bytes[..3] == b"BIR" && bytes[3].is_ascii_digit()
}

/// Reads files for the compiler and remembers each one the program supplied (not the system's headers).
struct RecordingFiles<'a> {
    system_include_dirs: &'a [String],
    read: bun_threading::Guarded<Vec<String>>,
}

impl bun_cc::FileProvider for RecordingFiles<'_> {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        let contents = bun_cc::HostFiles.read(path)?;
        let is_system_header = self
            .system_include_dirs
            .iter()
            .any(|dir| {
                path.as_bytes()
                    .strip_prefix(dir.as_bytes())
                    .is_some_and(|rest| rest.first() == Some(&b'/'))
            });
        if !is_system_header {
            self.read.lock().push(path.to_owned());
        }
        Some(contents)
    }
}

/// C source -> BIR. `#include "…"` resolves next to `path`; `<…>` searches the compiler's own
/// headers, `C_INCLUDE_PATH`, then the system's.
fn compile_to_bir(
    global_this: &JSGlobalObject,
    path: &[u8],
    source: &[u8],
    on_file_read: &mut dyn FnMut(&[u8]),
) -> JsResult<Vec<u8>> {
    let target = bun_cc::Target::host();
    let mut system_include_dirs = bun_cc::default_system_include_dirs(target);
    // Microsoft's headers: where a developer prompt says, else the newest Visual Studio's and Windows SDK's.
    #[cfg(windows)]
    {
        let text = |value: Option<&'static [u8]>| value.and_then(|value| core::str::from_utf8(value).ok());
        let roots: Vec<&str> = [
            text(bun_core::env_var::PROGRAMFILES::platform_get()),
            text(bun_core::env_var::PROGRAMFILES_X86::platform_get()),
        ]
        .into_iter()
        .flatten()
        .collect();
        system_include_dirs.extend(bun_cc::msvc_system_include_dirs(
            text(bun_core::env_var::INCLUDE::platform_get()),
            &roots,
        ));
    }
    // What clang reads to find the SDK on macOS, when it is not where Xcode's tools put it.
    if let Some(sdk) = bun_core::env_var::SDKROOT::platform_get()
        && let Ok(sdk) = core::str::from_utf8(sdk)
        && !sdk.is_empty()
    {
        system_include_dirs.push(format!("{sdk}/usr/include"));
    }
    // What gcc and clang search as `-isystem` directories: ahead of the system's own, so that a
    // project's copy of a header (its zlib.h, its uv.h) is the one found.
    if let Some(list) = bun_core::env_var::C_INCLUDE_PATH.get() {
        let mut searched_first: Vec<String> = Vec::new();
        for directory in bun_core::strings::split(list, if cfg!(windows) { b";" } else { b":" }) {
            if let Ok(directory) = core::str::from_utf8(directory)
                && !directory.is_empty()
            {
                searched_first.push(directory.to_owned());
            }
        }
        searched_first.append(&mut system_include_dirs);
        system_include_dirs = searched_first;
    }
    let files = RecordingFiles {
        system_include_dirs: &system_include_dirs,
        read: bun_threading::Guarded::new(Vec::new()),
    };
    let mut options = bun_cc::CompileOptions::new(target);
    options.file_provider = &files;
    options.system_include_dirs = system_include_dirs.clone();

    // The compiler names files with `str`s (they end up in `#include` lookups and diagnostics).
    let Ok(filename) = core::str::from_utf8(path) else {
        return Err(global_this.throw(format_args!(
            "cannot compile {}: the path is not valid UTF-8",
            BStr::new(path)
        )));
    };
    let result = bun_cc::compile_many(&[(source, filename)], &options);
    on_file_read(path);
    for file in files.read.lock().iter() {
        on_file_read(file.as_bytes());
    }
    match result {
        Ok(output) => Ok(output.bir),
        Err(diagnostics) => {
            let mut combined = String::new();
            for diagnostic in diagnostics.iter() {
                use core::fmt::Write as _;
                let _ = writeln!(&mut combined, "{diagnostic}");
            }
            Err(global_this.throw(format_args!(
                "{} error(s) while compiling {}\n{}",
                diagnostics.len(),
                filename,
                combined
            )))
        }
    }
}

/// BIR -> machine code -> `{ name: function }` for every non-static C function. The functions
/// keep the module (its code and data) alive.
pub fn load_bir(global_this: &JSGlobalObject, bir: &[u8]) -> JsResult<JSValue> {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    at_exit::install();
    #[cfg(windows)]
    {
        // The C code has a C runtime of its own (ucrtbase.dll; Bun's is linked statically): when the
        // process ends, its atexit handlers run and its streams are flushed too.
        static EXIT_HANDLERS: std::sync::Once = std::sync::Once::new();
        EXIT_HANDLERS.call_once(|| {
            unsafe extern "C" {
                safe fn Bun__CModule__runExitHandlers();
            }
            extern "C" fn run() {
                Bun__CModule__runExitHandlers();
            }
            bun_core::Global::add_exit_callback(run);
        });
    }

    let mut module: *mut c_void = core::ptr::null_mut();
    // SAFETY: `bir` outlives the call; the resolver is only used during it.
    jsc::call_check_slow(global_this, || unsafe {
        Bun__CModule__create(
            global_this,
            bir.as_ptr(),
            bir.len(),
            core::ptr::null_mut(),
            ExternResolver::resolve,
            &raw mut module,
        )
    })?;
    assert!(!module.is_null(), "Bun__CModule__create succeeded without a module");
    // `__attribute__((destructor))` functions run when the process ends, after what the program
    // itself registers with atexit while it runs.
    unsafe extern "C" fn run_at_exit(handler: unsafe extern "C" fn()) {
        #[cfg(all(target_os = "linux", target_env = "gnu"))]
        // SAFETY: records `handler`, a `void f(void)` from the module, to be called at exit.
        unsafe {
            at_exit::atexit(handler);
        }
        #[cfg(windows)]
        {
            // SAFETY: the list of the C runtime the program itself calls `atexit` in, not Bun's.
            unsafe {
                windows_runtime::Bun__CModule__atexit(handler);
            }
        }
        #[cfg(not(any(windows, all(target_os = "linux", target_env = "gnu"))))]
        {
            unsafe extern "C" {
                fn atexit(handler: unsafe extern "C" fn()) -> core::ffi::c_int;
            }
            // SAFETY: as above, with libc's own list.
            unsafe {
                atexit(handler);
            }
        }
    }
    // SAFETY: `module` is the live module just created.
    unsafe { Bun__CModule__registerDestructors(module, run_at_exit) };
    let _module = scopeguard::guard(module, |m| {
        // SAFETY: the +1 reference from `Bun__CModule__create`; each exported function took its own.
        unsafe { Bun__CModule__deref(m) };
    });
    // SAFETY: `module` is live (guarded above).
    jsc::call_check_slow(global_this, || unsafe {
        Bun__CModule__createExports(global_this, module)
    })
}

/// What importing a `.c` file evaluates to. `contents` is the file when the module loader already
/// has it in memory (a standalone executable's embedded files).
/// `on_file_read` is told about the source file and each file it `#include`s from outside the
/// system's header directories, whether or not compiling them succeeds.
pub fn load(
    global_this: &JSGlobalObject,
    path: &[u8],
    contents: Option<&[u8]>,
    on_file_read: &mut dyn FnMut(&[u8]),
) -> JsResult<JSValue> {
    // Importing C runs native code the program supplied, like `bun:ffi`'s cc(): the same switch
    // (`--no-ffi-cc`) turns it off.
    if !global_this.bun_vm().allow_ffi_cc() {
        return Err(global_this
            .err(
                ErrorCode::FFI_CC_DISABLED,
                format_args!("Cannot import C code because the bun:ffi C compiler is disabled."),
            )
            .throw());
    }
    let read;
    let contents = match contents {
        Some(contents) => contents,
        None => {
            read = match bun_sys::File::read_from(bun_sys::Fd::cwd(), path) {
                Ok(bytes) => bytes,
                Err(err) => {
                    return Err(global_this.throw(format_args!(
                        "cannot read {}: {}",
                        BStr::new(path),
                        BStr::new(err.name())
                    )));
                }
            };
            &read
        }
    };
    if is_bir(contents) {
        let exports = load_bir(global_this, contents)?;
        // What `bun build` makes the entry point call when the entry point was a C file.
        exports.put_non_enumerable(
            global_this,
            RUN_MAIN_PROPERTY,
            bun_jsc::JSFunction::create(
                global_this,
                "main",
                __jsc_host_run_main_of_bundled_module,
                0,
                Default::default(),
            ),
        );
        return Ok(exports);
    }
    let bir = compile_to_bir(global_this, path, contents, on_file_read)?;
    load_bir(global_this, &bir)
}

/// The name `bun build` and the runtime agree on; see `run_main_of_bundled_module`.
pub const RUN_MAIN_PROPERTY: &[u8] = b"__bun_run_c_main__";

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
/// the arguments after the file's name and ends the process with what it returns.
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

    // `argv` and its strings belong to the program until the process ends.
    let strings: Vec<std::ffi::CString> = core::iter::once(path)
        .chain(arguments.iter().map(|argument| &**argument))
        .map(|bytes| {
            let end = bun_core::strings::index_of_char_usize(bytes, 0).unwrap_or(bytes.len());
            std::ffi::CString::new(&bytes[..end]).expect("no interior NUL")
        })
        .collect();
    let argc = strings.len();
    let mut argv: Vec<*const core::ffi::c_char> = strings.iter().map(|string| string.as_ptr()).collect();
    argv.push(core::ptr::null());
    core::mem::forget(strings);
    let argv = argv.leak().as_ptr();

    let parameter_count = main.get_length(global_this)?;
    let all = [
        JSValue::js_number(argc as f64),
        JSValue::js_number(argv as usize as f64),
    ];
    let status = main.call(
        global_this,
        JSValue::UNDEFINED,
        &all[..(parameter_count as usize).min(all.len())],
    )?;
    let status = if status.is_number() {
        status.to_int32()
    } else {
        0
    };
    bun_core::Global::exit(status as u8 as u32)
}
