#![allow(unexpected_cfgs)] // `feature = "tinycc"` is a Phase-C placeholder; `bun_codegen_embed` is set via RUSTFLAGS in scripts/build/rust.ts.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_long, c_void};
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::{Once, OnceLock};

use bstr::BStr;

use crate::napi;
use bun_collections::StringArrayHashMap;
use bun_core::{ZBox, env_var, fmt as bun_fmt, zstr};
use bun_core::{ZStr, ZigString};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSObject, JSPropertyIterator, JSValue, JsCell, JsClass,
    JsError, JsResult, SystemError, ZigStringJsc,
};
#[cfg(target_os = "macos")]
use bun_paths as path;
use bun_paths::PathBuffer;
use bun_resolver::fs as Fs;
use bun_sys;

// ─── Local shims for upstream surfaces not yet wired (Phase D) ───────────────

/// `bun.sys.directoryExistsAt(FD.cwd(), path).isTrue()` — local helper while
/// `bun_core::Fd` lacks an inherent forwarder.
#[cfg(unix)]
#[inline]
fn dir_exists(path: &'static [u8]) -> bool {
    // SAFETY: `path` is a NUL-free static literal; copy into a stack ZBox.
    let z = ZBox::from_bytes(path);
    bun_sys::directory_exists_at(bun_sys::Fd::cwd(), &z).unwrap_or(false)
}

/// `JSValue.createObject2` — local extern thunk; upstream `bun_jsc` hasn't
/// re-exported it yet.
#[inline]
fn create_object_2(
    global: &JSGlobalObject,
    key1: &ZigString,
    key2: &ZigString,
    value1: JSValue,
    value2: JSValue,
) -> JSValue {
    unsafe extern "C" {
        fn JSC__JSValue__createObject2(
            global: *const JSGlobalObject,
            key1: *const ZigString,
            key2: *const ZigString,
            value1: JSValue,
            value2: JSValue,
        ) -> JSValue;
    }
    // SAFETY: all pointers borrowed for the call; C++ clones key strings.
    unsafe { JSC__JSValue__createObject2(global, key1, key2, value1, value2) }
}

/// `bun.String.toJSArray` — local shim over `JSValue::create_array_from_iter`.
fn strings_to_js_array(global: &JSGlobalObject, strs: &[bun_core::String]) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, strs.iter(), |s| {
        jsc::bun_string_jsc::to_js(s, global)
    })
}

// Runtime availability is governed by `bun_core::Environment::ENABLE_TINYCC`
// via the early-return guards in the host-fns below.
use bun_tcc_sys as TCC;

bun_output::declare_scope!(TCC, visible);

unsafe extern "C" {
    fn pthread_jit_write_protect_np(enable: c_int);
}

use super::get_dl_error;

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
    scopeguard::defer! {
        if HAS_PROTECTION {
            // SAFETY: re-enable JIT write protection on scope exit
            unsafe { pthread_jit_write_protect_np(true as c_int) };
        }
    }
    func()
}

#[repr(C)]
struct Offsets {
    js_array_buffer_view_offset_of_length: u32,
    js_array_buffer_view_offset_of_byte_offset: u32,
    js_array_buffer_view_offset_of_vector: u32,
    js_cell_offset_of_type: u32,
}

unsafe extern "C" {
    // Written once by C++ before any Rust read. C++ mutates these bytes, so a
    // plain non-`mut` extern static would assert immutability to the optimizer
    // (UB). `RacyCell<T>` is `#[repr(transparent)]` over `UnsafeCell<T>`, so
    // the extern layout is identical to `Offsets`.
    #[link_name = "Bun__FFI__offsets"]
    static BUN_FFI_OFFSETS: bun_core::RacyCell<Offsets>;
    #[link_name = "Bun__FFI__ensureOffsetsAreLoaded"]
    fn bun_ffi_ensure_offsets_are_loaded();
}

// ─── Local extern thin-wrappers (codegen / `bun_jsc` surface not yet wired) ──
unsafe extern "C" {
    /// `host_fn::NewRuntimeFunction` — `Bun__CreateFFIFunctionValue`.
    fn Bun__CreateFFIFunctionValue(
        global: *const JSGlobalObject,
        symbol_name: *const ZigString,
        arg_count: u32,
        function_pointer: *const c_void,
        add_ptr_property: bool,
        input_function_ptr: *mut c_void,
    ) -> JSValue;
}

/// Raw extern fn pointers fed to the TCC-JIT'd C trampolines via `add_symbol`.
mod exposed_to_ffi {
    use super::{JSGlobalObject, JSValue};
    unsafe extern "C" {
        #[link_name = "JSC__JSValue__toInt64"]
        pub(super) fn JSVALUE_TO_INT64(value: JSValue) -> i64;
        #[link_name = "JSC__JSValue__toUInt64NoTruncate"]
        pub(super) fn JSVALUE_TO_UINT64(value: JSValue) -> u64;
        #[link_name = "JSC__JSValue__fromInt64NoTruncate"]
        pub(super) fn INT64_TO_JSVALUE(global: *mut JSGlobalObject, i: i64) -> JSValue;
        #[link_name = "JSC__JSValue__fromUInt64NoTruncate"]
        pub(super) fn UINT64_TO_JSVALUE(global: *mut JSGlobalObject, i: u64) -> JSValue;
    }
}

/// `host_fn::NewRuntimeFunction` thin wrapper. See host_fn.rs:310.
#[inline]
fn new_runtime_function(
    global: &JSGlobalObject,
    symbol_name: &ZigString,
    arg_count: u32,
    function_pointer: *const c_void,
    add_ptr_property: bool,
    input_function_ptr: Option<*mut c_void>,
) -> JSValue {
    // SAFETY: thin FFI wrapper; `global` is a live opaque JSC handle,
    // `function_pointer` is a JIT'd entry point owned by the caller.
    unsafe {
        Bun__CreateFFIFunctionValue(
            global,
            symbol_name,
            arg_count,
            function_pointer,
            add_ptr_property,
            input_function_ptr.unwrap_or(core::ptr::null_mut()),
        )
    }
}

/// `jsc::codegen::JSFFI::symbols_value_set_cached` thin wrapper.
#[inline]
fn symbols_value_set_cached(js_object: JSValue, global: &JSGlobalObject, obj: JSValue) {
    crate::generated_classes::js_FFI::symbols_value_set_cached(js_object, global, obj)
}

impl Offsets {
    fn load_once() {
        // SAFETY: extern "C" fn populating a static
        unsafe { bun_ffi_ensure_offsets_are_loaded() };
    }
    pub(crate) fn get() -> &'static Offsets {
        static ONCE: Once = Once::new();
        ONCE.call_once(Self::load_once);
        // SAFETY: BUN_FFI_OFFSETS is initialized by load_once and never mutated after
        unsafe { &*BUN_FFI_OFFSETS.get() }
    }
}

// R-2 (host-fn re-entrancy): the JS-exposed `close()` method takes `&self`;
// per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
// `close()` does not itself re-enter JS, but routing mutation through
// `UnsafeCell`-backed fields suppresses `noalias` on the `&Self` the codegen
// shim materialises from `m_ctx`, which is the systemic R-2 guarantee.
#[bun_jsc::JsClass(no_constructor)]
pub struct FFI {
    pub dylib: JsCell<Option<bun_sys::DynLib>>,
    pub functions: JsCell<StringArrayHashMap<Function>>,
    pub closed: Cell<bool>,
    pub shared_state: Cell<Option<NonNull<TCC::State>>>,
}

impl Default for FFI {
    fn default() -> Self {
        Self {
            dylib: JsCell::new(None),
            functions: JsCell::new(StringArrayHashMap::default()),
            closed: Cell::new(false),
            shared_state: Cell::new(None),
        }
    }
}

impl FFI {
    pub fn finalize(self: Box<Self>) {
        // INTENTIONAL no-op when not closed. Compiled trampolines / dlopen'd
        // symbols may still be reachable from JS after the wrapper is GC'd
        // (e.g. `const { fn } = dlopen(...).symbols`); teardown is owned by
        // `close()`. Dropping the Box would run `Function::drop` →
        // `tcc_delete()`, freeing the executable pages those JSFunctions still
        // jump into.
        //
        // When `close()` HAS run, the functions map is empty and the dylib /
        // shared TCC state are already gone, so the Box only owns the (empty)
        // hashmap's retained-capacity buffer. Drop it instead of leaking.
        if self.closed.get() {
            drop(self);
        } else {
            let _ = bun_core::heap::release(self);
        }
    }
}

// ─── CompileC ───────────────────────────────────────────────────────────────

struct CompileC {
    source: Source,
    current_file_for_errors: ZBox,
    libraries: StringArray,
    library_dirs: StringArray,
    include_dirs: StringArray,
    symbols: SymbolsMap,
    define: Vec<[ZBox; 2]>,
    /// Flags to replace the default flags
    flags: ZBox,
    deferred_errors: Vec<Box<[u8]>>,
}

impl Default for CompileC {
    fn default() -> Self {
        Self {
            source: Source::File(ZBox::from_bytes(b"")),
            current_file_for_errors: ZBox::from_bytes(b""),
            libraries: StringArray::default(),
            library_dirs: StringArray::default(),
            include_dirs: StringArray::default(),
            symbols: SymbolsMap::default(),
            define: Vec::new(),
            flags: ZBox::from_bytes(b""),
            deferred_errors: Vec::new(),
        }
    }
}

enum Source {
    File(ZBox),
    Files(Vec<ZBox>),
}

impl Source {
    pub(crate) fn first(&self) -> &ZStr {
        match self {
            Source::File(f) => f,
            Source::Files(files) => &files[0],
        }
    }

    pub(crate) fn add(
        &self,
        state: &mut TCC::State,
        current_file_for_errors: &mut ZBox,
    ) -> crate::Result<()> {
        match self {
            Source::File(file) => {
                *current_file_for_errors = ZBox::from_bytes(file.as_bytes());
                state
                    .add_file(file)
                    .map_err(|_| crate::Error::CompilationError)?;
                *current_file_for_errors = ZBox::from_bytes(b"");
            }
            Source::Files(files) => {
                for file in files {
                    *current_file_for_errors = ZBox::from_bytes(file.as_bytes());
                    state
                        .add_file(file)
                        .map_err(|_| crate::Error::CompilationError)?;
                    *current_file_for_errors = ZBox::from_bytes(b"");
                }
            }
        }
        Ok(())
    }
}

// ─── stdarg ─────────────────────────────────────────────────────────────────

mod stdarg {
    use super::*;

    unsafe extern "C" {
        pub(super) fn ffi_vfprintf(_: *mut c_void, _: *const c_char, ...) -> c_int;
        pub(super) fn ffi_vprintf(_: *const c_char, ...) -> c_int;
        pub(super) fn ffi_fprintf(_: *mut c_void, _: *const c_char, ...) -> c_int;
        pub(super) fn ffi_printf(_: *const c_char, ...) -> c_int;
        pub(super) fn ffi_fscanf(_: *mut c_void, _: *const c_char, ...) -> c_int;
        pub(super) fn ffi_scanf(_: *const c_char, ...) -> c_int;
        pub(super) fn ffi_sscanf(_: *const c_char, _: *const c_char, ...) -> c_int;
        pub(super) fn ffi_vsscanf(_: *const c_char, _: *const c_char, ...) -> c_int;
        pub(super) fn ffi_fopen(_: *const c_char, _: *const c_char) -> *mut c_void;
        pub(super) fn ffi_fclose(_: *mut c_void) -> c_int;
        pub(super) fn ffi_fgetc(_: *mut c_void) -> c_int;
        pub(super) fn ffi_fputc(c: c_int, _: *mut c_void) -> c_int;
        pub(super) fn ffi_feof(_: *mut c_void) -> c_int;
        pub(super) fn ffi_fileno(_: *mut c_void) -> c_int;
        pub(super) fn ffi_ungetc(c: c_int, _: *mut c_void) -> c_int;
        pub(super) fn ffi_ftell(_: *mut c_void) -> c_long;
        pub(super) fn ffi_fseek(_: *mut c_void, _: c_long, _: c_int) -> c_int;
        pub(super) fn ffi_fflush(_: *mut c_void) -> c_int;

        pub(super) fn calloc(nmemb: usize, size: usize) -> *mut c_void;
        pub(super) fn perror(_: *const c_char);
    }

    #[cfg(target_os = "macos")]
    mod mac {
        use super::*;
        use core::sync::atomic::AtomicPtr;
        // libc declares these as `FILE *__stdinp;` — `AtomicPtr<c_void>` is
        // `#[repr(C)]` over a single `*mut c_void`, so the extern layout is
        // identical. We never read them; we hand TinyCC the *address* of the
        // global so JIT'd code that references `__stdoutp` loads the FILE* from there.
        unsafe extern "C" {
            #[link_name = "__stdinp"]
            static FFI_STDINP: AtomicPtr<c_void>;
            #[link_name = "__stdoutp"]
            static FFI_STDOUTP: AtomicPtr<c_void>;
            #[link_name = "__stderrp"]
            static FFI_STDERRP: AtomicPtr<c_void>;
        }

        pub(super) fn inject(state: &mut TCC::State) {
            // Taking addresses of process-global FILE* pointers; the statics
            // live for the process and we never form a Rust reference to them
            // (only a raw `*const c_void` for tcc_add_symbol).
            state
                .add_symbols(&[
                    ("__stdinp", core::ptr::addr_of!(FFI_STDINP).cast::<c_void>()),
                    (
                        "__stdoutp",
                        core::ptr::addr_of!(FFI_STDOUTP).cast::<c_void>(),
                    ),
                    (
                        "__stderrp",
                        core::ptr::addr_of!(FFI_STDERRP).cast::<c_void>(),
                    ),
                ])
                .expect("Failed to add macos symbols");
        }
    }
    #[cfg(not(target_os = "macos"))]
    mod mac {
        use super::*;
        pub(super) fn inject(_: &mut TCC::State) {}
    }

    pub(super) fn inject(state: &mut TCC::State) {
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

#[derive(thiserror::Error, Debug)]
enum DeferredError {
    #[error("DeferredErrors")]
    DeferredErrors,
}

// Process-lifetime singletons — PORTING.md §Forbidden: use OnceLock, never
// `static mut` + leak. `ZBox` is the sanctioned owned-ZStr type
// (util.rs forbids `Box<ZStr>` because of DST dealloc-length mismatch).
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
static CACHED_DEFAULT_SYSTEM_INCLUDE_DIR: OnceLock<bun_core::ZBox> = OnceLock::new();
#[cfg(any(target_os = "linux", target_os = "android"))]
static CACHED_DEFAULT_SYSTEM_LIBRARY_DIR: OnceLock<bun_core::ZBox> = OnceLock::new();
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
static CACHED_DEFAULT_SYSTEM_INCLUDE_DIR_ONCE: Once = Once::new();

impl CompileC {
    /// # Safety
    /// `this_` is the `ConfigErr::ctx` pointer round-tripped through TinyCC; it
    /// must be null or point to a live `CompileC`. `message` is a NUL-terminated
    /// C string when non-null. Signature matches `ConfigErr::handler` exactly so
    /// it can be passed without an ABI-coercing cast.
    pub(crate) unsafe extern "C" fn handle_compilation_error(
        this_: *mut CompileC,
        message: *const c_char,
    ) {
        if this_.is_null() {
            return;
        }
        // SAFETY: TinyCC threads our own `&mut CompileC` back as `ctx`; we hold
        // the unique borrow for the duration of the callback.
        let this = unsafe { &mut *this_ };
        let mut msg: &[u8] = if message.is_null() {
            b""
        } else {
            // SAFETY: TCC guarantees `message` is a valid NUL-terminated string when non-null.
            unsafe { bun_core::ffi::cstr(message) }.to_bytes()
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

    pub(crate) const DEFAULT_TCC_OPTIONS: &'static str = "-std=c11 -Wl,--export-all-symbols -g -O2";

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn get_system_root_dir_once() {
        #[cfg(target_os = "macos")]
        {
            // Run `xcrun -sdk macosx -show-sdk-path` to auto-detect the
            // active SDK root. The Rust `bun::spawn_sync` helper isn't ported
            // yet (see install/repository.rs TODO), so use std::process as a
            // shim: inherit env, ignore stdin/stderr,
            // capture stdout, treat any spawn/exit failure as "not found".
            // `Command::new("xcrun")` does PATH lookup, and
            // /usr/bin is always in PATH on macOS.
            #[allow(clippy::disallowed_types, clippy::disallowed_methods)]
            let out = match std::process::Command::new("xcrun")
                .arg("-sdk")
                .arg("macosx")
                .arg("-show-sdk-path")
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output()
            {
                Ok(o) => o,
                Err(_) => return,
            };
            if !out.status.success() {
                return;
            }
            use bstr::ByteSlice as _;
            let stdout = out.stdout.as_slice();
            let trimmed: &[u8] = stdout.trim_with(|c| c == '\n' || c == '\r');
            if trimmed.is_empty() {
                return;
            }
            let _ = CACHED_DEFAULT_SYSTEM_INCLUDE_DIR.set(bun_core::ZBox::from_bytes(trimmed));
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // On Debian/Ubuntu, the lib and include paths are suffixed with {arch}-linux-gnu
            // e.g. x86_64-linux-gnu or aarch64-linux-gnu
            // On Alpine and RHEL-based distros, the paths are not suffixed

            #[cfg(target_arch = "x86_64")]
            {
                if dir_exists(b"/usr/include/x86_64-linux-gnu") {
                    let _ =
                        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR.set(bun_core::ZBox::from_vec_with_nul(
                            b"/usr/include/x86_64-linux-gnu".to_vec(),
                        ));
                } else if dir_exists(b"/usr/include") {
                    let _ = CACHED_DEFAULT_SYSTEM_INCLUDE_DIR
                        .set(bun_core::ZBox::from_vec_with_nul(b"/usr/include".to_vec()));
                }

                if dir_exists(b"/usr/lib/x86_64-linux-gnu") {
                    let _ = CACHED_DEFAULT_SYSTEM_LIBRARY_DIR.set(
                        bun_core::ZBox::from_vec_with_nul(b"/usr/lib/x86_64-linux-gnu".to_vec()),
                    );
                } else if dir_exists(b"/usr/lib64") {
                    let _ = CACHED_DEFAULT_SYSTEM_LIBRARY_DIR
                        .set(bun_core::ZBox::from_vec_with_nul(b"/usr/lib64".to_vec()));
                }
            }
            #[cfg(target_arch = "aarch64")]
            {
                if dir_exists(b"/usr/include/aarch64-linux-gnu") {
                    let _ =
                        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR.set(bun_core::ZBox::from_vec_with_nul(
                            b"/usr/include/aarch64-linux-gnu".to_vec(),
                        ));
                } else if dir_exists(b"/usr/include") {
                    let _ = CACHED_DEFAULT_SYSTEM_INCLUDE_DIR
                        .set(bun_core::ZBox::from_vec_with_nul(b"/usr/include".to_vec()));
                }

                if dir_exists(b"/usr/lib/aarch64-linux-gnu") {
                    let _ = CACHED_DEFAULT_SYSTEM_LIBRARY_DIR.set(
                        bun_core::ZBox::from_vec_with_nul(b"/usr/lib/aarch64-linux-gnu".to_vec()),
                    );
                } else if dir_exists(b"/usr/lib64") {
                    let _ = CACHED_DEFAULT_SYSTEM_LIBRARY_DIR
                        .set(bun_core::ZBox::from_vec_with_nul(b"/usr/lib64".to_vec()));
                }
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn get_system_include_dir() -> Option<&'static ZStr> {
        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR_ONCE.call_once(Self::get_system_root_dir_once);
        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR
            .get()
            .map(|b| b.as_zstr())
            .filter(|d| !d.is_empty())
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn get_system_library_dir() -> Option<&'static ZStr> {
        CACHED_DEFAULT_SYSTEM_INCLUDE_DIR_ONCE.call_once(Self::get_system_root_dir_once);
        CACHED_DEFAULT_SYSTEM_LIBRARY_DIR
            .get()
            .map(|b| b.as_zstr())
            .filter(|d| !d.is_empty())
    }

    pub(crate) fn compile(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> crate::Result<NonNull<TCC::State>> {
        let tcc_options_owned: ZBox;
        let compile_options: &ZStr = if !self.flags.is_empty() {
            &self.flags
        } else if let Some(tcc_options) = env_var::BUN_TCC_OPTIONS.get() {
            // Copy into an owned NUL-terminated buffer instead of assuming the
            // OS env block provides a sentinel byte right after the slice.
            tcc_options_owned = ZBox::from_bytes(tcc_options);
            &tcc_options_owned
        } else {
            zstr!("-std=c11 -Wl,--export-all-symbols -g -O2")
        };

        // TODO: correctly handle invalid user-provided options
        let state_ptr = match TCC::State::init::<CompileC, true>(&TCC::Config {
            options: Some(NonNull::from(compile_options)),
            output_type: TCC::OutputFormat::Memory,
            err: TCC::ConfigErr {
                ctx: Some(std::ptr::from_mut::<CompileC>(self)),
                handler: Self::handle_compilation_error,
            },
        }) {
            Ok(s) => s,
            Err(TCC::Error::Alloc(bun_alloc::AllocError)) => {
                return Err(crate::Error::Alloc(bun_alloc::AllocError));
            }
            Err(_) => {
                debug_assert!(self.has_deferred_errors());
                return Err(crate::Error::DeferredErrors);
            }
        };
        // SAFETY: `state_ptr` was just returned non-null by `TCC::State::init`;
        // we hold the only reference for the rest of this function.
        let state: &mut TCC::State = unsafe { &mut *state_ptr.as_ptr() };

        if let Some(compiler_rt_dir) = CompilerRT::dir() {
            if state.add_sys_include_path(compiler_rt_dir).is_err() {
                bun_output::scoped_log!(TCC, "TinyCC failed to add sysinclude path");
            }
        }

        #[cfg(target_os = "macos")]
        {
            let mut pathbuf = PathBuffer::uninit();
            'add_system_include_dir: {
                let dirs_to_try: [&[u8]; 2] = [
                    env_var::SDKROOT.get().unwrap_or(b""),
                    Self::get_system_include_dir()
                        .map(|s| s.as_bytes())
                        .unwrap_or(b""),
                ];

                for sdkroot in dirs_to_try {
                    if !sdkroot.is_empty() {
                        let include_dir = path::resolve_path::join_abs_string_buf_z::<
                            path::platform::Auto,
                        >(
                            sdkroot, pathbuf.as_mut_slice(), &[b"usr", b"include"]
                        );
                        if state.add_sys_include_path(include_dir).is_err() {
                            global_this.throw(format_args!("TinyCC failed to add sysinclude path"));
                            return Err(crate::Error::JSError);
                        }

                        let lib_dir = path::resolve_path::join_abs_string_buf_z::<
                            path::platform::Auto,
                        >(
                            sdkroot, pathbuf.as_mut_slice(), &[b"usr", b"lib"]
                        );
                        if state.add_library_path(lib_dir).is_err() {
                            global_this.throw(format_args!("TinyCC failed to add library path"));
                            return Err(crate::Error::JSError);
                        }

                        break 'add_system_include_dir;
                    }
                }
            }

            #[cfg(target_arch = "aarch64")]
            {
                if dir_exists(b"/opt/homebrew/include") {
                    if state
                        .add_sys_include_path(zstr!("/opt/homebrew/include"))
                        .is_err()
                    {
                        bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                    }
                }

                if dir_exists(b"/opt/homebrew/lib") {
                    if state.add_library_path(zstr!("/opt/homebrew/lib")).is_err() {
                        bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                    }
                }
            }
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
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
            if dir_exists(b"/usr/local/include") {
                if state
                    .add_sys_include_path(zstr!("/usr/local/include"))
                    .is_err()
                {
                    bun_output::scoped_log!(TCC, "TinyCC failed to add sysinclude path");
                }
            }

            if dir_exists(b"/usr/local/lib") {
                if state.add_library_path(zstr!("/usr/local/lib")).is_err() {
                    bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
                }
            }

            // Check standard C compiler environment variables for include paths.
            // These are used by systems like NixOS where standard FHS paths don't exist.
            if let Some(c_include_path) = env_var::C_INCLUDE_PATH.get() {
                for path in c_include_path.split(|b| *b == b':') {
                    if !path.is_empty() {
                        let path_z = ZBox::from_bytes(path);
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
                        let path_z = ZBox::from_bytes(path);
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

        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        for include_dir in self.include_dirs.items.iter() {
            if state.add_sys_include_path(include_dir).is_err() {
                debug_assert!(self.has_deferred_errors());
                return Err(crate::Error::DeferredErrors);
            }
        }

        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        CompilerRT::define(state);

        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        for symbol in self.symbols.map.values() {
            if symbol.needs_napi_env() {
                // napi env is process-lifetime; valid for JIT'd code.
                state
                    .add_symbol(
                        zstr!("Bun__thisFFIModuleNapiEnv"),
                        global_this.make_napi_env_for_ffi().cast_const(),
                    )
                    .map_err(|_| crate::Error::DeferredErrors)?;
                break;
            }
        }

        for define in self.define.iter() {
            state.define_symbol(&define[0], &define[1]);
            self.error_check()
                .map_err(|_| crate::Error::DeferredErrors)?;
        }

        if self
            .source
            .add(state, &mut self.current_file_for_errors)
            .is_err()
        {
            if !self.deferred_errors.is_empty() {
                return Err(crate::Error::DeferredErrors);
            } else {
                if !global_this.has_exception() {
                    global_this.throw(format_args!("TinyCC failed to compile"));
                }
                return Err(crate::Error::JSError);
            }
        }

        CompilerRT::inject(state);
        stdarg::inject(state);

        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        for library_dir in self.library_dirs.items.iter() {
            // register all, even if some fail. Only fail after all have been registered.
            if state.add_library_path(library_dir).is_err() {
                bun_output::scoped_log!(TCC, "TinyCC failed to add library path");
            }
        }
        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        for library in self.libraries.items.iter() {
            // register all, even if some fail.
            let _ = state.add_library(library);
        }
        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        // TinyCC now manages relocation memory internally
        if dangerously_run_without_jit_protections(|| state.relocate()).is_err() {
            if !self.has_deferred_errors() {
                self.deferred_errors.push(Box::<[u8]>::from(
                    &b"tcc_relocate returned a negative value"[..],
                ));
            }
            return Err(crate::Error::DeferredErrors);
        }

        // if errors got added, we would have returned in the relocation catch.
        debug_assert!(self.deferred_errors.is_empty());

        let source_first = ZBox::from_bytes(self.source.first().as_bytes());
        let mut iter = self.symbols.map.iterator();
        while let Some(entry) = iter.next() {
            let symbol: &[u8] = &**entry.key_ptr;
            // FIXME: why are we duping here? can we at least use a stack
            // fallback allocator?
            let duped = ZBox::from_bytes(symbol);
            let Some(sym) = state.get_symbol(&duped) else {
                global_this.throw(format_args!(
                    "{} is missing from {}. Was it included in the source code?",
                    bun_fmt::quote(symbol),
                    BStr::new(source_first.as_bytes())
                ));
                return Err(crate::Error::JSError);
            };
            entry.value_ptr.symbol_from_dynamic_library = Some(sym.as_ptr().cast::<c_void>());
        }

        self.error_check()
            .map_err(|_| crate::Error::DeferredErrors)?;

        Ok(state_ptr)
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
    items: Vec<ZBox>,
}

impl Drop for StringArray {
    fn drop(&mut self) {
        for item in self.items.iter() {
            // Attempting to free an empty null-terminated slice will crash if it was a default value
            debug_assert!(!item.is_empty());
        }
        // Vec<ZBox> drops itself
    }
}

impl StringArray {
    pub(crate) fn from_js_array(
        global_this: &JSGlobalObject,
        value: JSValue,
        property: &'static str,
    ) -> JsResult<StringArray> {
        let mut iter = value.array_iterator(global_this)?;
        let mut items: Vec<ZBox> = Vec::new();

        while let Some(val) = iter.next()? {
            if !val.is_string() {
                // items dropped automatically
                return Err(global_this.throw_invalid_argument_type_value(
                    property.as_bytes(),
                    b"array of strings",
                    val,
                ));
            }
            let str = val.get_zig_string(global_this)?;
            if str.len == 0 {
                continue;
            }
            items.push(str.to_owned_slice_z());
        }

        Ok(StringArray { items })
    }

    pub(crate) fn from_js_string(
        global_this: &JSGlobalObject,
        value: JSValue,
        property: &'static str,
    ) -> JsResult<StringArray> {
        if value.is_undefined() {
            return Ok(StringArray::default());
        }
        if !value.is_string() {
            return Err(global_this.throw_invalid_argument_type_value(
                property.as_bytes(),
                b"array of strings",
                value,
            ));
        }
        let str = value.get_zig_string(global_this)?;
        if str.len == 0 {
            return Ok(StringArray::default());
        }
        let items: Vec<ZBox> = vec![str.to_owned_slice_z()];
        Ok(StringArray { items })
    }

    pub(crate) fn from_js(
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
    // No `#[bun_jsc::host_fn]` here — the `Free` shim it emits is a bare
    // `bun_ffi_cc(__g, __f)` call, which doesn't resolve inside `impl FFI`.
    // The C-ABI shim (`Bun__FFI__cc`) is supplied by the `.classes.ts` codegen.
    pub fn bun_ffi_cc(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        if !bun_core::Environment::ENABLE_TINYCC {
            return Err(global_this.throw(format_args!(
                "bun:ffi cc() is not available in this build (TinyCC is disabled)"
            )));
        }
        let arguments = callframe.arguments_old::<1>();
        let arguments = arguments.slice();
        if arguments.is_empty() || !arguments[0].is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected object")));
        }

        // Step 1. compile the user's code

        let object = arguments[0];

        let mut compile_c = CompileC::default();

        let symbols_object: JSValue = object
            .get_own(global_this, &bun_core::String::borrow_utf8(b"symbols"))?
            .unwrap_or(JSValue::UNDEFINED);
        if !global_this.has_exception()
            && (symbols_object.is_empty() || !symbols_object.is_object())
        {
            return Err(global_this.throw_invalid_argument_type_value(
                b"symbols",
                b"object",
                symbols_object,
            ));
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        // SAFETY: already checked that symbols_object is an object
        if let Some(val) = generate_symbols(global_this, &mut compile_c.symbols.map, unsafe {
            &*symbols_object.get_object().unwrap()
        })? {
            if !val.is_empty() && !global_this.has_exception() {
                return Err(global_this.throw_value(val));
            }
            return Err(JsError::Thrown);
        }

        if compile_c.symbols.map.len() == 0 {
            return Err(global_this.throw(format_args!("Expected at least one exported symbol")));
        }

        if let Some(library_value) =
            object.get_own(global_this, &bun_core::String::borrow_utf8(b"library"))?
        {
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

                while let Some(value) = iter.next()? {
                    if !value.is_string() {
                        return Err(global_this.throw_invalid_argument_type_value(
                            b"flags",
                            b"array of strings",
                            value,
                        ));
                    }
                    let slice = value.to_slice(global_this)?;
                    if slice.slice().is_empty() {
                        continue;
                    }
                    flags.push(b' ');
                    flags.extend_from_slice(slice.slice());
                }
                flags.push(0);
                compile_c.flags = ZBox::from_vec_with_nul(flags);
            } else {
                if !flags_value.is_string() {
                    return Err(global_this.throw_invalid_argument_type_value(
                        b"flags",
                        b"string",
                        flags_value,
                    ));
                }

                let str = flags_value.get_zig_string(global_this)?;
                if str.len > 0 {
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
                while let Some(entry) = iter.next()? {
                    let key = entry.to_owned_slice_z();
                    let mut owned_value: ZBox = ZBox::from_bytes(b"");
                    if !iter.value.is_undefined_or_null() {
                        if iter.value.is_string() {
                            let value = iter.value.get_zig_string(global_this)?;
                            if value.len > 0 {
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

        if let Some(source_value) =
            object.get_own(global_this, &bun_core::String::borrow_utf8(b"source"))?
        {
            if source_value.is_array() {
                compile_c.source = Source::Files(Vec::new());
                let mut iter = source_value.array_iterator(global_this)?;
                while let Some(value) = iter.next()? {
                    if !value.is_string() {
                        return Err(global_this.throw_invalid_argument_type_value(
                            b"source",
                            b"array of strings",
                            value,
                        ));
                    }
                    if let Source::Files(files) = &mut compile_c.source {
                        files.push(value.get_zig_string(global_this)?.to_owned_slice_z());
                    }
                }
            } else if !source_value.is_string() {
                return Err(global_this.throw_invalid_argument_type_value(
                    b"source",
                    b"string",
                    source_value,
                ));
            } else {
                let source_path = source_value.get_zig_string(global_this)?.to_owned_slice_z();
                compile_c.source = Source::File(source_path);
            }
        }

        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        // Now we compile the code with tinycc.
        let mut tcc_state: Option<NonNull<TCC::State>> = match compile_c.compile(global_this) {
            Ok(s) => Some(s),
            Err(err) => match err {
                crate::Error::DeferredErrors => {
                    let mut combined: Vec<u8> = Vec::new();
                    let file_for_err = if !compile_c.current_file_for_errors.is_empty() {
                        compile_c.current_file_for_errors.as_bytes()
                    } else {
                        compile_c.source.first().as_bytes()
                    };
                    writeln!(
                        &mut combined,
                        "{} errors while compiling {}",
                        compile_c.deferred_errors.len(),
                        BStr::new(file_for_err)
                    )
                    .ok();

                    for deferred_error in compile_c.deferred_errors.iter() {
                        writeln!(&mut combined, "{}", BStr::new(deferred_error)).ok();
                    }

                    return Err(global_this.throw(format_args!("{}", BStr::new(&combined))));
                }
                crate::Error::JSError => return Err(JsError::Thrown),
                crate::Error::Alloc(_) => return Err(JsError::OutOfMemory),
                crate::Error::JSTerminated => return Err(JsError::Terminated),
                other => {
                    return Err(global_this.throw(format_args!("compile failed: {}", other.name())));
                }
            },
        };
        let _tcc_guard = scopeguard::guard(&mut tcc_state, |s| {
            if let Some(state) = s {
                // SAFETY: state is a valid TCC::State pointer from compile()
                unsafe { TCC::State::destroy(state.as_ptr()) };
            }
        });

        let napi_env = make_napi_env_if_needed(compile_c.symbols.map.values(), global_this);

        let obj = JSValue::create_empty_object(global_this, compile_c.symbols.map.len());
        for function in compile_c.symbols.map.values_mut() {
            // Clone the name before `compile(&mut self)` so the
            // immutable borrow of `function.base_name` doesn't overlap.
            let function_name = function.base_name.clone().unwrap();

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
            match &function.step {
                Step::Failed { msg, .. } => {
                    let res = ZigString::init(msg).to_error_instance(global_this);
                    return Err(global_this.throw_value(res));
                }
                Step::Pending => {
                    return Err(
                        global_this.throw(format_args!("Failed to compile (nothing happend!)"))
                    );
                }
                Step::Compiled(compiled) => {
                    let str = ZigString::init(function_name.as_bytes());
                    let cb = new_runtime_function(
                        global_this,
                        &str,
                        u32::try_from(function.arg_types.len()).expect("int cast"),
                        compiled.ptr.cast_const(),
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    // `cb` is rooted by the `symbolsValue` cached own-property set below.
                    obj.put(global_this, str.slice(), cb);
                }
            }
        }

        // TODO: pub const new = bun.TrivialNew(FFI)
        let lib = Box::new(FFI {
            dylib: JsCell::new(None),
            shared_state: Cell::new(scopeguard::ScopeGuard::into_inner(_tcc_guard).take()),
            functions: JsCell::new(core::mem::take(&mut compile_c.symbols.map)),
            closed: Cell::new(false),
        });

        let js_object = lib.to_js(global_this);
        symbols_value_set_cached(js_object, global_this, obj);
        Ok(js_object)
    }

    pub fn close_callback(_global_this: &JSGlobalObject, ctx: JSValue) -> JSValue {
        // SAFETY: ctx encodes a heap::alloc(*mut Function) created by `callback`
        drop(unsafe { bun_core::heap::take(ctx.as_ptr_address() as *mut Function) });
        JSValue::UNDEFINED
    }

    pub fn callback(
        global_this: &JSGlobalObject,
        interface: JSValue,
        js_callback: JSValue,
    ) -> JsResult<JSValue> {
        if !bun_core::Environment::ENABLE_TINYCC {
            return Err(global_this.throw(format_args!(
                "bun:ffi callback() is not available in this build (TinyCC is disabled)"
            )));
        }
        jsc::mark_binding();
        if !interface.is_object() {
            return Ok(global_this.to_invalid_arguments(format_args!("Expected object")));
        }

        if js_callback.is_empty_or_undefined_or_null() || !js_callback.is_callable() {
            return Ok(global_this.to_invalid_arguments(format_args!("Expected callback function")));
        }

        let mut function = Function::default();
        let func = &mut function;

        if let Some(val) = generate_symbol_for_function(global_this, interface, func)? {
            return Ok(val);
        }

        // TODO: WeakRefHandle that automatically frees it?
        func.base_name = Some(ZBox::from_bytes(b""));
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
            Step::Pending => Ok(ZigString::init(
                b"Failed to compile, but not sure why. Please report this bug",
            )
            .to_error_instance(global_this)),
            Step::Compiled(_) => {
                let function_ = bun_core::heap::into_raw(Box::new(core::mem::take(func)));
                // SAFETY: function_ is a valid heap::alloc pointer
                let compiled_ptr = unsafe { (*function_).step.compiled_ptr() };
                Ok(create_object_2(
                    global_this,
                    &ZigString::static_(b"ptr"),
                    &ZigString::static_(b"ctx"),
                    JSValue::from_ptr_address(compiled_ptr as usize),
                    JSValue::from_ptr_address(function_ as usize),
                ))
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(&self, _global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding();
        if self.closed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        self.closed.set(true);
        if let Some(dylib) = self.dylib.replace(None) {
            dylib.close();
        }

        if let Some(state) = self.shared_state.take() {
            // SAFETY: state is a valid TCC::State pointer; we have exclusive ownership
            unsafe { TCC::State::destroy(state.as_ptr()) };
        }

        self.functions.with_mut(|f| f.clear_retaining_capacity());

        Ok(JSValue::UNDEFINED)
    }

    pub fn print_callback(global: &JSGlobalObject, object: JSValue) -> JsResult<JSValue> {
        jsc::mark_binding();

        if object.is_empty_or_undefined_or_null() || !object.is_object() {
            return Ok(global.to_invalid_arguments(format_args!("Expected an object")));
        }

        let mut function = Function::default();
        if let Some(val) = generate_symbol_for_function(global, object, &mut function)? {
            return Ok(val);
        }

        let mut arraylist: Vec<u8> = Vec::new();

        function.base_name = Some(ZBox::from_bytes(b"my_callback_function"));

        if function
            .print_callback_source_code(None, None, &mut arraylist)
            .is_err()
        {
            return Ok(ZigString::init(b"Error while printing code").to_error_instance(global));
        }
        jsc::bun_string_jsc::create_utf8_for_js(global, &arraylist)
    }

    pub fn print(
        global: &JSGlobalObject,
        object: JSValue,
        is_callback_val: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if let Some(is_callback) = is_callback_val {
            if is_callback.to_boolean() {
                return Self::print_callback(global, object);
            }
        }

        if object.is_empty_or_undefined_or_null() {
            return Ok(invalid_options_arg(global));
        }
        let Some(obj) = object.get_object() else {
            return Ok(invalid_options_arg(global));
        };

        let mut symbols = StringArrayHashMap::<Function>::default();
        // SAFETY: `get_object()` returned a non-null `*mut JSObject`; `object` keeps it alive.
        let obj = unsafe { &*obj };
        if let Some(val) = generate_symbols(global, &mut symbols, obj)? {
            // an error while validating symbols
            // keys/arg_types freed by Drop
            return Ok(val);
        }
        jsc::mark_binding();
        let mut strs: Vec<bun_core::String> = Vec::with_capacity(symbols.len());
        for function in symbols.values_mut() {
            let mut arraylist: Vec<u8> = Vec::new();
            if function.print_source_code(&mut arraylist).is_err() {
                // an error while generating source code
                return Ok(ZigString::init(b"Error while printing code").to_error_instance(global));
            }
            strs.push(bun_core::String::clone_utf8(&arraylist));
        }

        let ret = strings_to_js_array(global, &strs)?;

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
    global.to_invalid_arguments(format_args!("Expected an options object with symbol names"))
}

impl FFI {
    pub fn open(global: &JSGlobalObject, name_str: ZigString, object_value: JSValue) -> JSValue {
        if !bun_core::Environment::ENABLE_TINYCC {
            let _ = global.throw(format_args!(
                "bun:ffi dlopen() is not available in this build (TinyCC is disabled)"
            ));
            return JSValue::ZERO;
        }
        jsc::mark_binding();
        let vm = jsc::VirtualMachineRef::get();
        let name_slice = name_str.to_slice();

        if object_value.is_empty_or_undefined_or_null() {
            return invalid_options_arg(global);
        }
        let Some(object) = object_value.get_object() else {
            return invalid_options_arg(global);
        };

        let mut filepath_buf = bun_paths::path_buffer_pool::get();
        let name: &[u8] = 'brk: {
            let ext: &[u8] = match () {
                // Android shared libraries are `.so` (ELF, same as Linux/FreeBSD).
                #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
                () => b"so",
                #[cfg(target_os = "macos")]
                () => b"dylib",
                #[cfg(windows)]
                () => b"dll",
                // No arm for other targets (e.g. wasm) — the match fails to
                // compile there.
            };
            // Extract a bunfs-embedded shared
            // library (added via `import lib from "./lib.so" with { type:
            // "file" }` and shipped through `bun build --compile`) to a real
            // on-disk temp file, returning the tmpfile path; libc `dlopen(2)`
            // can't see the bunfs virtual FS. The helper lives in
            // `crate::jsc_hooks` — same crate, so a direct call.
            let _ = vm;
            if let Some(len) = crate::jsc_hooks::resolve_embedded_file_to_buf(
                name_slice.slice(),
                ext,
                &mut filepath_buf[..],
            ) {
                // NUL-terminate in place so `DynLib::open`
                // can pass the slice to libc without copying. `resolve_*_to_buf`
                // is bounded by `Fs::FileSystem::tmpname` + a tmpdir join (both
                // fit in `PATH_MAX`), so `filepath_buf[len]` is in bounds.
                filepath_buf[len] = 0;
                break 'brk &filepath_buf[0..len];
            }

            break 'brk name_slice.slice();
        };

        if name.is_empty() {
            return global.to_invalid_arguments(format_args!("Invalid library name"));
        }

        let mut symbols = StringArrayHashMap::<Function>::default();
        // SAFETY: `get_object()` returned a non-null `*mut JSObject`; `object_value` keeps it alive.
        if let Some(val) = generate_symbols(global, &mut symbols, unsafe { &*object })
            .unwrap_or(Some(JSValue::ZERO))
        {
            // an error while validating symbols
            return val;
        }
        if symbols.len() == 0 {
            return global.to_invalid_arguments(format_args!("Expected at least one symbol"));
        }

        let dylib: bun_sys::DynLib = 'brk: {
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
                            let dlerror_msg = get_dl_error();

                            let mut msg = Vec::new();
                            write!(
                                &mut msg,
                                "Failed to open library \"{}\": {}",
                                BStr::new(name),
                                BStr::new(&dlerror_msg)
                            )
                            .ok();
                            let system_error = SystemError {
                                code: bun_core::String::clone_utf8(b"ERR_DLOPEN_FAILED"),
                                message: bun_core::String::clone_utf8(&msg),
                                syscall: bun_core::String::clone_utf8(b"dlopen"),
                                errno: 0,
                                path: bun_core::String::EMPTY,
                                hostname: bun_core::String::EMPTY,
                                fd: -1,
                                dest: bun_core::String::EMPTY,
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
        let _obj_guard = obj.protected();

        let napi_env = make_napi_env_if_needed(symbols.values(), global);

        for function in symbols.values_mut() {
            let function_name = ZBox::from_bytes(function.base_name.as_ref().unwrap().as_bytes());
            // Reshaped for borrowck — clone base_name to drop &function borrow

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
            match &function.step {
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
                    let cb = new_runtime_function(
                        global,
                        &str,
                        u32::try_from(function.arg_types.len()).expect("int cast"),
                        compiled.ptr.cast_const(),
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    // `cb` is rooted by the `symbolsValue` cached own-property set below.
                    obj.put(global, str.slice(), cb);
                }
            }
        }

        let lib = Box::new(FFI {
            dylib: JsCell::new(Some(dylib)),
            functions: JsCell::new(symbols),
            ..Default::default()
        });

        let js_object = lib.to_js(global);
        symbols_value_set_cached(js_object, global, obj);
        js_object
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_symbols(_this: &FFI, _: &JSGlobalObject) -> JSValue {
        // This shouldn't be called. The cachedValue is what should be called.
        JSValue::UNDEFINED
    }

    pub fn link_symbols(global: &JSGlobalObject, object_value: JSValue) -> JSValue {
        if !bun_core::Environment::ENABLE_TINYCC {
            let _ = global.throw(format_args!(
                "bun:ffi linkSymbols() is not available in this build (TinyCC is disabled)"
            ));
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
        // SAFETY: `get_object()` returned a non-null `*mut JSObject`; `object_value` keeps it alive.
        if let Some(val) = generate_symbols(global, &mut symbols, unsafe { &*object })
            .unwrap_or(Some(JSValue::ZERO))
        {
            // an error while validating symbols
            return val;
        }
        if symbols.len() == 0 {
            return global.to_invalid_arguments(format_args!("Expected at least one symbol"));
        }

        let obj = JSValue::create_empty_object(global, symbols.len());
        obj.ensure_still_alive();
        let _keep = jsc::EnsureStillAlive(obj);

        let napi_env = make_napi_env_if_needed(symbols.values(), global);

        for function in symbols.values_mut() {
            let function_name = ZBox::from_bytes(function.base_name.as_ref().unwrap().as_bytes());

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
            match &function.step {
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

                    let cb = new_runtime_function(
                        global,
                        &name,
                        u32::try_from(function.arg_types.len()).expect("int cast"),
                        compiled.ptr.cast_const(),
                        true,
                        function.symbol_from_dynamic_library,
                    );
                    // `cb` is rooted by the `symbolsValue` cached own-property set below.
                    obj.put(global, name.slice(), cb);
                }
            }
        }

        let lib = Box::new(FFI {
            dylib: JsCell::new(None),
            functions: JsCell::new(symbols),
            ..Default::default()
        });

        let js_object = lib.to_js(global);
        symbols_value_set_cached(js_object, global, obj);
        js_object
    }
}

pub(super) fn generate_symbol_for_function(
    global: &JSGlobalObject,
    value: JSValue,
    function: &mut Function,
) -> JsResult<Option<JSValue>> {
    jsc::mark_binding();

    let mut abi_types: Vec<ABIType> = Vec::new();

    if let Some(args) = value.get_own(global, &bun_core::String::borrow_utf8(b"args"))? {
        if args.is_empty_or_undefined_or_null() || !args.js_type().is_array() {
            return Ok(Some(
                ZigString::static_(b"Expected an object with \"args\" as an array")
                    .to_error_instance(global),
            ));
        }

        let mut array = args.array_iterator(global)?;

        abi_types.reserve_exact(array.len as usize);
        while let Some(val) = array.next()? {
            if val.is_empty_or_undefined_or_null() {
                return Ok(Some(
                    ZigString::static_(b"param must be a string (type name) or number")
                        .to_error_instance(global),
                ));
            }

            if val.is_any_int() {
                let int = val.to_int32();
                // Reject Buffer (20); only the string-label path accepts it.
                if let Some(t) = ABIType::from_int(int).filter(|_| int <= ABIType::MAX) {
                    abi_types.push(t);
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
                // Reject Buffer (20); only the string-label path accepts it.
                if let Some(t) = ABIType::from_int(int).filter(|_| int <= ABIType::MAX) {
                    return_type = t;
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
            ZigString::static_(b"Cannot return napi_env to JavaScript").to_error_instance(global),
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
            ZigString::static_(b"Threadsafe functions must return void").to_error_instance(global),
        ));
    }

    *function = Function::default();
    function.base_name = None;
    function.arg_types = abi_types;
    function.return_type = return_type;
    function.threadsafe = threadsafe;

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

pub(super) fn generate_symbols(
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

    symbols.reserve(symbols_iter.len);

    while let Some(prop) = symbols_iter.next()? {
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
        let base_name = prop.to_owned_slice_z();
        let key = base_name.as_bytes().to_vec().into_boxed_slice();
        function.base_name = Some(base_name);

        symbols.insert(&key, function);
    }

    Ok(None)
}

// ─── Function ───────────────────────────────────────────────────────────────

pub struct Function {
    pub symbol_from_dynamic_library: Option<*mut c_void>,
    pub base_name: Option<ZBox>,
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

unsafe extern "C" {
    fn FFICallbackFunctionWrapper_destroy(_: *mut c_void);
}

impl Drop for Function {
    fn drop(&mut self) {
        // base_name, arg_types, Step::Failed.msg are owned and freed by drop glue.
        if let Some(state) = self.state.take() {
            // SAFETY: state is a valid TCC::State pointer; we own it
            unsafe { TCC::State::destroy(state.as_ptr()) };
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
    pub(crate) fn needs_handle_scope(&self) -> bool {
        for arg in self.arg_types.iter() {
            if *arg == ABIType::NapiEnv || *arg == ABIType::NapiValue {
                return true;
            }
        }
        self.return_type == ABIType::NapiValue
    }

    fn fail(&mut self, msg: &'static [u8]) {
        if !matches!(self.step, Step::Failed { .. }) {
            self.step = Step::Failed {
                msg: Box::<[u8]>::from(msg),
            };
        }
    }

    pub(crate) fn ffi_header() -> &'static [u8] {
        bun_core::runtime_embed_file!(Src, "runtime/ffi/FFI.h").as_bytes()
    }

    /// # Safety
    /// `ctx` is the `ConfigErr::ctx` pointer round-tripped through TinyCC and
    /// must point to a live `Function`. `message` is a NUL-terminated C string.
    /// Signature matches `ConfigErr::handler` exactly so it can be passed
    /// without an ABI-coercing cast.
    pub(crate) unsafe extern "C" fn handle_tcc_error(ctx: *mut Function, message: *const c_char) {
        debug_assert!(!ctx.is_null());
        // SAFETY: TinyCC threads our own `&mut Function` back as `ctx`.
        let this = unsafe { &mut *ctx };
        // SAFETY: TCC passes a valid NUL-terminated string
        let mut msg: &[u8] = unsafe { bun_core::ffi::cstr(message) }.to_bytes();
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
        };
    }

    pub(crate) fn compile(&mut self, napi_env: Option<&napi::NapiEnv>) -> crate::Result<()> {
        let mut source_code: Vec<u8> = Vec::new();
        self.print_source_code(&mut source_code)?;

        source_code.push(0);
        let tcc_options: &'static ZStr = if cfg!(debug_assertions) {
            zstr!("-std=c11 -nostdlib -Wl,--export-all-symbols -g")
        } else {
            zstr!("-std=c11 -nostdlib -Wl,--export-all-symbols")
        };
        let state = match TCC::State::init::<Function, false>(&TCC::Config {
            options: Some(NonNull::from(tcc_options)),
            output_type: TCC::OutputFormat::Memory,
            err: TCC::ConfigErr {
                ctx: Some(std::ptr::from_mut::<Function>(self)),
                handler: Self::handle_tcc_error,
            },
        }) {
            Ok(s) => s,
            Err(_) => return Err(crate::Error::TCCMissing),
        };

        self.state = Some(state);
        let _guard = scopeguard::guard(std::ptr::from_mut::<Function>(self), |this_ptr| {
            // SAFETY: this_ptr is &mut self for the duration of compile()
            let this = unsafe { &mut *this_ptr };
            if matches!(this.step, Step::Failed { .. }) {
                if let Some(s) = this.state.take() {
                    // SAFETY: we own the state
                    unsafe { TCC::State::destroy(s.as_ptr()) };
                }
            }
        });
        // SAFETY: state is non-null, just stored above
        let state = unsafe { self.state.unwrap().as_mut() };

        if let Some(env) = napi_env {
            // `env` is the live VM-owned napi env; process-lifetime.
            if state
                .add_symbol(
                    zstr!("Bun__thisFFIModuleNapiEnv"),
                    std::ptr::from_ref(env).cast::<c_void>(),
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
            .compile_string(ZStr::from_slice_with_nul(&source_code[..]))
            .is_err()
        {
            self.fail(b"Failed to compile source code");
            return Ok(());
        }

        CompilerRT::inject(state);
        // `symbol_from_dynamic_library` is a dlsym'd address; valid for the
        // loaded library's lifetime, which outlives the TCC state.
        if state
            .add_symbol(
                self.base_name.as_ref().unwrap(),
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

        let Some(symbol) = state.get_symbol(zstr!("JSFunctionCall")) else {
            self.fail(b"missing generated symbol in source code");
            return Ok(());
        };

        self.step = Step::Compiled(Compiled {
            ptr: symbol.as_ptr().cast::<c_void>(),
            ..Default::default()
        });
        Ok(())
    }

    pub(crate) fn compile_callback(
        &mut self,
        js_context: &JSGlobalObject,
        js_function: JSValue,
        is_threadsafe: bool,
    ) -> crate::Result<()> {
        jsc::mark_binding();
        let mut source_code: Vec<u8> = Vec::new();
        // SAFETY: js_context/js_function are live for the call
        let ffi_wrapper = unsafe { Bun__createFFICallbackFunction(js_context, js_function) };
        self.print_callback_source_code(Some(js_context), Some(ffi_wrapper), &mut source_code)?;

        #[cfg(all(debug_assertions, unix))]
        'debug_write: {
            // SAFETY: best-effort debug write; failures are swallowed
            unsafe {
                let fd = libc::open(
                    c"/tmp/bun-ffi-callback-source.c".as_ptr(),
                    libc::O_CREAT | libc::O_WRONLY,
                    0o644,
                );
                if fd < 0 {
                    break 'debug_write;
                }
                let _ = libc::write(fd, source_code.as_ptr().cast::<c_void>(), source_code.len());
                let _ = libc::ftruncate(fd, source_code.len() as libc::off_t);
                libc::close(fd);
            }
        }

        source_code.push(0);
        // defer source_code.deinit();

        let tcc_options: &'static ZStr = if cfg!(debug_assertions) {
            zstr!("-std=c11 -nostdlib -Wl,--export-all-symbols -g")
        } else {
            zstr!("-std=c11 -nostdlib -Wl,--export-all-symbols")
        };
        let state = match TCC::State::init::<Function, false>(&TCC::Config {
            options: Some(NonNull::from(tcc_options)),
            output_type: TCC::OutputFormat::Memory,
            err: TCC::ConfigErr {
                ctx: Some(std::ptr::from_mut::<Function>(self)),
                handler: Self::handle_tcc_error,
            },
        }) {
            Ok(s) => s,
            Err(TCC::Error::Alloc(bun_alloc::AllocError)) => {
                return Err(crate::Error::TCCMissing);
            }
            // 1. .Memory is always a valid option, so InvalidOptions is
            //    impossible
            // 2. other throwable functions arent called, so their errors
            //    aren't possible
            Err(_) => unreachable!(),
        };
        self.state = Some(state);
        let _guard = scopeguard::guard(std::ptr::from_mut::<Function>(self), |this_ptr| {
            // SAFETY: this_ptr is &mut self for the duration of compile_callback()
            let this = unsafe { &mut *this_ptr };
            if matches!(this.step, Step::Failed { .. }) {
                if let Some(s) = this.state.take() {
                    // SAFETY: we own the state
                    unsafe { TCC::State::destroy(s.as_ptr()) };
                }
            }
        });
        // SAFETY: just stored above
        let state = unsafe { self.state.unwrap().as_mut() };

        if self.needs_napi_env() {
            if state
                .add_symbol(
                    zstr!("Bun__thisFFIModuleNapiEnv"),
                    js_context.make_napi_env_for_ffi().cast_const(),
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
            .compile_string(ZStr::from_slice_with_nul(&source_code[..]))
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
        // `callback_sym` is one of the process-lifetime `FFI_Callback_call*`
        // extern fns.
        if state
            .add_symbol(zstr!("FFI_Callback_call"), callback_sym)
            .is_err()
        {
            self.fail(b"Failed to add FFI callback symbol");
            return Ok(());
        }
        // TinyCC now manages relocation memory internally
        if dangerously_run_without_jit_protections(|| state.relocate()).is_err() {
            self.fail(b"tcc_relocate returned a negative value");
            return Ok(());
        }

        let Some(symbol) = state.get_symbol(zstr!("my_callback_function")) else {
            self.fail(b"missing generated symbol in source code");
            return Ok(());
        };

        self.step = Step::Compiled(Compiled {
            ptr: symbol.as_ptr().cast::<c_void>(),
            ffi_callback_function_wrapper: NonNull::new(ffi_wrapper),
        });
        Ok(())
    }

    pub(crate) fn print_source_code(&self, writer: &mut impl std::io::Write) -> crate::Result<()> {
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
                    writeln!(
                        writer,
                        "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};",
                        i
                    )?;
                } else if arg.needs_a_cast_in_c() {
                    if i < self.arg_types.len() - 1 {
                        writeln!(
                            writer,
                            "  EncodedJSValue arg{} = {{ .asInt64 = *argsPtr++ }};",
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
                        writeln!(writer, "  int64_t arg{} = *argsPtr++;", i)?;
                    } else {
                        writeln!(writer, "  int64_t arg{} = *argsPtr;", i)?;
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

            let length_buf = bun_core::fmt::print_int(&mut arg_buf[3..], i);
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
            write!(
                writer,
                "{}.asZigRepr",
                self.return_type.to_js(b"return_value")
            )?;
        } else {
            writer.write_all(b"ValueUndefined.asZigRepr")?;
        }

        writer.write_all(b";\n}\n\n")?;
        Ok(())
    }

    pub(crate) fn print_callback_source_code(
        &self,
        global_object: Option<&JSGlobalObject>,
        context_ptr: Option<*mut c_void>,
        writer: &mut impl std::io::Write,
    ) -> crate::Result<()> {
        {
            let ptr = global_object
                .map(|g| std::ptr::from_ref(g) as usize)
                .unwrap_or(0);
            let fmt = bun_fmt::hex_int_upper::<16>(ptr as u64);
            writeln!(writer, "#define JS_GLOBAL_OBJECT (void*)0x{}ULL", fmt)?;
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
            writeln!(
                writer,
                " ZIG_REPR_TYPE arguments[{}];",
                self.arg_types.len()
            )?;

            arg_buf[0..3].copy_from_slice(b"arg");
            for (i, arg) in self.arg_types.iter().enumerate() {
                let printed = bun_core::fmt::print_int(&mut arg_buf[3..], i);
                let arg_name = &arg_buf[0..3 + printed];
                writeln!(
                    writer,
                    "arguments[{}] = {}.asZigRepr;",
                    i,
                    arg.to_js(arg_name)
                )?;
            }
        }

        writer.write_all(b"  ")?;
        let mut inner_buf_ = [0u8; 372];
        let inner_buf: &[u8];

        {
            let ptr = context_ptr.map(|p| p as usize).unwrap_or(0);
            let fmt = bun_fmt::hex_int_upper::<16>(ptr as u64);

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
    Failed { msg: Box<[u8]> },
}

/// Stores no JS function value: symbol functions are rooted by the
/// `symbolsValue` cached own-property on the FFI wrapper, callbacks by the
/// `JSC::Strong` inside `FFICallbackFunctionWrapper`.
pub struct Compiled {
    pub ptr: *mut c_void,
    pub ffi_callback_function_wrapper: Option<NonNull<c_void>>,
}

impl Default for Compiled {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
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
use super::abi_type::ABIType;

// ─── CompilerRT ─────────────────────────────────────────────────────────────

struct CompilerRT;

// Process-lifetime singleton — PORTING.md §Forbidden: use OnceLock, never
// `static mut` + leak.
static COMPILER_RT_DIR: OnceLock<bun_core::ZBox> = OnceLock::new();

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
        // `bun_resolver::fs::FileSystem` (the inline canonical surface) doesn't
        // yet expose an inherent `tmpdir()`; reuse the crate-local
        // `FileSystemTmpdirExt` shim already in service for `jsc_hooks`.
        use crate::cli::upgrade_command::FileSystemTmpdirExt as _;
        let Ok(tmpdir) = Fs::FileSystem::instance().tmpdir() else {
            return;
        };

        let Ok(bun_cc) = tmpdir.make_open_path(b"bun-cc", bun_sys::OpenDirOptions::default())
        else {
            return;
        };

        for (name, source) in CompilerRtSources::SOURCES {
            let name_z = ZBox::from_bytes(name.as_bytes());
            let _ = bun_sys::File::write_file(bun_cc.fd(), name_z.as_zstr(), source);
        }

        let mut path_buf = PathBuffer::uninit();
        let Ok(path) = bun_sys::get_fd_path(bun_cc.fd(), &mut path_buf) else {
            return;
        };
        // `ZBox::from_bytes` panics on OOM.
        let _ = COMPILER_RT_DIR.set(ZBox::from_bytes(&*path));
    }

    pub(crate) fn dir() -> Option<&'static ZStr> {
        CREATE_COMPILER_RT_DIR_ONCE.call_once(Self::create_compiler_rt_dir);
        COMPILER_RT_DIR
            .get()
            .map(|b| b.as_zstr())
            .filter(|d| !d.is_empty())
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
            bun_core::ffi::slice_mut(dest, byte_count)
                .copy_from_slice(bun_core::ffi::slice(source, byte_count));
        }
    }

    pub(crate) fn define(state: &mut TCC::State) {
        #[cfg(target_arch = "x86_64")]
        {
            state.define_symbol(zstr!("NEEDS_COMPILER_RT_FUNCTIONS"), zstr!("1"));
            // SAFETY: `libtcc1.c` is embedded with a manual trailing NUL guaranteed
            // by `include_bytes!` + the explicit length math below.
            const LIBTCC1: &[u8] = include_bytes!("libtcc1.c");
            let libtcc1_z = ZBox::from_bytes(LIBTCC1);
            if state.compile_string(&libtcc1_z).is_err() {
                if cfg!(debug_assertions) {
                    panic!("Failed to compile libtcc1.c");
                }
            }
        }

        let offsets = Offsets::get();
        state.define_symbols(&[
            (
                "Bun_FFI_PointerOffsetToArgumentsList",
                bun_jsc::sizes::BUN_FFI_POINTER_OFFSET_TO_ARGUMENTS_LIST as i64,
            ),
            (
                "JSArrayBufferView__offsetOfLength",
                offsets.js_array_buffer_view_offset_of_length as i64,
            ),
            (
                "JSArrayBufferView__offsetOfVector",
                offsets.js_array_buffer_view_offset_of_vector as i64,
            ),
            (
                "JSCell__offsetOfType",
                offsets.js_cell_offset_of_type as i64,
            ),
            (
                "JSTypeArrayBufferViewMin",
                jsc::JSType::MIN_TYPED_ARRAY.0 as i64,
            ),
            (
                "JSTypeArrayBufferViewMax",
                jsc::JSType::MAX_TYPED_ARRAY.0 as i64,
            ),
        ]);
    }

    pub(crate) fn inject(state: &mut TCC::State) {
        state
            .add_symbol(zstr!("memset"), Self::memset as *const c_void)
            .expect("unreachable");
        state
            .add_symbol(zstr!("memcpy"), Self::memcpy as *const c_void)
            .expect("unreachable");
        // Re-declare the C++ NapiHandleScope hooks locally — the canonical
        // declarations live in `crate::napi::napi_body` which is private, and
        // we only need the symbol addresses to hand to TCC. The canonical
        // signatures use `*mut NapiHandleScope` (an opaque type not re-exported
        // here); `*mut c_void` is ABI-identical for address-taking purposes.
        #[allow(clashing_extern_declarations)]
        unsafe extern "C" {
            fn NapiHandleScope__open(env: *mut napi::NapiEnv, escapable: bool) -> *mut c_void;
            fn NapiHandleScope__close(env: *mut napi::NapiEnv, current: *mut c_void);
        }
        state
            .add_symbol(
                zstr!("NapiHandleScope__open"),
                NapiHandleScope__open as *const c_void,
            )
            .expect("unreachable");
        state
            .add_symbol(
                zstr!("NapiHandleScope__close"),
                NapiHandleScope__close as *const c_void,
            )
            .expect("unreachable");

        state
            .add_symbol(
                zstr!("JSVALUE_TO_INT64_SLOW"),
                WORKAROUND.jsvalue_to_int64 as *const c_void,
            )
            .expect("unreachable");
        state
            .add_symbol(
                zstr!("JSVALUE_TO_UINT64_SLOW"),
                WORKAROUND.jsvalue_to_uint64 as *const c_void,
            )
            .expect("unreachable");
        state
            .add_symbol(
                zstr!("INT64_TO_JSVALUE_SLOW"),
                WORKAROUND.int64_to_jsvalue as *const c_void,
            )
            .expect("unreachable");
        state
            .add_symbol(
                zstr!("UINT64_TO_JSVALUE_SLOW"),
                WORKAROUND.uint64_to_jsvalue as *const c_void,
            )
            .expect("unreachable");
    }
}

struct MyFunctionSStructWorkAround {
    jsvalue_to_int64: unsafe extern "C" fn(JSValue) -> i64,
    jsvalue_to_uint64: unsafe extern "C" fn(JSValue) -> u64,
    int64_to_jsvalue: unsafe extern "C" fn(*mut JSGlobalObject, i64) -> JSValue,
    uint64_to_jsvalue: unsafe extern "C" fn(*mut JSGlobalObject, u64) -> JSValue,
}

static WORKAROUND: MyFunctionSStructWorkAround = MyFunctionSStructWorkAround {
    jsvalue_to_int64: exposed_to_ffi::JSVALUE_TO_INT64,
    jsvalue_to_uint64: exposed_to_ffi::JSVALUE_TO_UINT64,
    int64_to_jsvalue: exposed_to_ffi::INT64_TO_JSVALUE,
    uint64_to_jsvalue: exposed_to_ffi::UINT64_TO_JSVALUE,
};

// ─── exports ────────────────────────────────────────────────────────────────

/// `Bun__FFI__cc` — module-level re-export of `FFI::bun_ffi_cc`, so the
/// `js2native` codegen can resolve it as `crate::ffi::ffi::bun__ffi__cc`.
#[allow(non_snake_case)]
#[inline]
pub fn bun__ffi__cc(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    FFI::bun_ffi_cc(global, callframe)
}

fn make_napi_env_if_needed<'a>(
    functions: impl IntoIterator<Item = &'a Function>,
    global_this: &JSGlobalObject,
) -> Option<&'static napi::NapiEnv> {
    // Return is `'static`, not `'a` — the env is heap-allocated by C++
    // (`makeNapiEnvForFFI`) and owned by the VM for process lifetime; tying it
    // to `'a` (the iterator borrow) is over-restrictive and blocks the
    // immediate-after `values_mut()` loop at every call site.
    for function in functions {
        if function.needs_napi_env() {
            // SAFETY: C++ returns a non-null fresh NapiEnv; we hand back a shared `&` only.
            // `bun_jsc` exposes `*mut c_void` to avoid an upward dep on
            // `bun_runtime::napi`; the concrete type lives here, so cast at the boundary.
            return Some(unsafe { &*global_this.make_napi_env_for_ffi().cast::<napi::NapiEnv>() });
        }
    }
    None
}
