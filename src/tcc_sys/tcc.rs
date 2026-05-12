use core::ffi::{c_char, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_core::ZStr;

pub use State as TCCState;

/// Raw C error callback signature: `void (*)(void *opaque, const char *msg)`
pub type TCCErrorFunc = Option<unsafe extern "C" fn(opaque: *mut c_void, msg: *const c_char)>;

/// Typed error callback signature for a given context type.
///
/// Zig: `fn ErrorFunc(Ctx: type) type { return fn (ctx: ?*Ctx, msg: [*:0]const u8) callconv(.c) void; }`
pub type ErrorFunc<Ctx> = unsafe extern "C" fn(ctx: *mut Ctx, msg: *const c_char);

// `libtcc.a` is only built where `cfg.tinycc` is true (`scripts/build/config.ts`):
// not Windows/aarch64 (TinyCC has no aarch64-pe-coff backend), not Android, not
// FreeBSD (the vendored fork doesn't support those targets). On those platforms
// these `extern "C"` decls would be undefined at link. Zig's `comptime
// !Environment.enable_tinycc` early-returns in `ffi.zig` keep the *Zig*
// callers off the analysis graph, so the Zig externs never get emitted; Rust
// has no lazy analysis — `bun_runtime::ffi::ffi_body::{Source::add,
// CompileC::compile}` are reachable from `extern "C"` JS bindings and the
// monomorphized refs land in `libbun_rust.a` regardless of any
// `if !ENABLE_TINYCC { return }` runtime guard. Swap the `extern` block for
// stub *definitions* on those targets so the link resolves; the gated Rust
// callers never reach them at runtime (they early-return with "not available
// in this build"), and the `unreachable!()` makes any future gate regression
// loud rather than silently UB.
//
// Keep this predicate in sync with `cfg.tinycc` in `scripts/build/config.ts`.
macro_rules! tcc_externs {
    ($($(#[$attr:meta])* fn $name:ident($($arg:ident: $ty:ty),* $(,)?) $(-> $ret:ty)?;)*) => {
        #[cfg(not(any(target_os = "android", target_os = "freebsd", all(windows, target_arch = "aarch64"))))]
        // TODO(port): move to tcc_sys (already in *_sys crate — verify crate layout in Phase B)
        unsafe extern "C" {
            $($(#[$attr])* fn $name($($arg: $ty),*) $(-> $ret)?;)*
        }
        $(
            #[cfg(any(target_os = "android", target_os = "freebsd", all(windows, target_arch = "aarch64")))]
            #[allow(unused_variables, clippy::missing_safety_doc)]
            unsafe extern "C" fn $name($($arg: $ty),*) $(-> $ret)? {
                unreachable!(concat!(
                    stringify!($name),
                    " called but TinyCC is disabled on this target — keep the ",
                    "ENABLE_TINYCC early-returns in bun_runtime::ffi in sync with this stub"
                ));
            }
        )*
    };
}

tcc_externs! {
    fn tcc_new() -> *mut TCCState;
    fn tcc_delete(s: *mut TCCState);
    fn tcc_set_lib_path(s: *mut TCCState, path: *const c_char);
    fn tcc_set_error_func(s: *mut TCCState, error_opaque: *mut c_void, error_func: TCCErrorFunc);
    // NOTE: tcc_get_error_func / tcc_get_error_opaque were removed from the libtcc public API
    // (not present in vendor/tinycc/libtcc.h). tcc.zig:10-11 only escapes a link error via lazy
    // analysis. Do not declare them here — referencing them would fail to link.
    fn tcc_set_options(s: *mut TCCState, str_: *const c_char) -> c_int;
    fn tcc_add_include_path(s: *mut TCCState, pathname: *const c_char) -> c_int;
    fn tcc_add_sysinclude_path(s: *mut TCCState, pathname: *const c_char) -> c_int;
    fn tcc_define_symbol(s: *mut TCCState, sym: *const c_char, value: *const c_char);
    fn tcc_undefine_symbol(s: *mut TCCState, sym: *const c_char);
    fn tcc_add_file(s: *mut TCCState, filename: *const c_char) -> c_int;
    fn tcc_compile_string(s: *mut TCCState, buf: *const c_char) -> c_int;
    fn tcc_set_output_type(s: *mut TCCState, output_type: c_int) -> c_int;
    fn tcc_add_library_path(s: *mut TCCState, pathname: *const c_char) -> c_int;
    fn tcc_add_library(s: *mut TCCState, libraryname: *const c_char) -> c_int;
    fn tcc_add_symbol(s: *mut TCCState, name: *const c_char, val: *const c_void) -> c_int;
    fn tcc_output_file(s: *mut TCCState, filename: *const c_char) -> c_int;
    fn tcc_run(s: *mut TCCState, argc: c_int, argv: *mut *mut c_char) -> c_int;
    fn tcc_relocate(s1: *mut TCCState) -> c_int;
    fn tcc_get_symbol(s: *mut TCCState, name: *const c_char) -> *mut c_void;
    fn tcc_list_symbols(
        s: *mut TCCState,
        ctx: *mut c_void,
        symbol_cb: Option<unsafe extern "C" fn(*mut c_void, *const c_char, *const c_void)>,
    );
}

const TCC_OUTPUT_MEMORY: c_int = 1;
const TCC_OUTPUT_EXE: c_int = 2;
// NOTE: vendor/tinycc/libtcc.h defines OBJ=3, DLL=4 (Bun's fork swapped vs upstream).
// tcc.zig:30-31 has these reversed — that is a latent spec bug; match libtcc.h here.
const TCC_OUTPUT_OBJ: c_int = 3;
const TCC_OUTPUT_DLL: c_int = 4;
const TCC_OUTPUT_PREPROCESS: c_int = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum Error {
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("InvalidIncludePath")]
    InvalidIncludePath,
    #[error("CompileError")]
    CompileError,
    // output
    #[error("InvalidOutputType")]
    InvalidOutputType,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("InvalidLibraryPath")]
    InvalidLibraryPath,
    #[error("InvalidSymbol")]
    InvalidSymbol,
    #[error("ExecError")]
    ExecError,
    /// Could not get a symbol for some reason
    #[error("RelocationError")]
    RelocationError,
    // TODO(port): `OutputError` is returned by `output_file` in the Zig source but is NOT a
    // member of the Zig `Error` set — latent bug only unobserved because Zig analysis is lazy
    // and `outputFile` has no callers. Kept here so `output_file` type-checks; revisit in Phase B.
    #[error("OutputError")]
    OutputError,
}

bun_core::named_error_set!(Error);

#[repr(i32)] // Zig: enum(c_int) — c_int == i32 on all Bun targets
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    /// Output will be run in memory
    Memory = TCC_OUTPUT_MEMORY as _,
    /// Executable file
    Exe = TCC_OUTPUT_EXE as _,
    /// Dynamic library
    Dll = TCC_OUTPUT_DLL as _,
    /// Object file
    Obj = TCC_OUTPUT_OBJ as _,
    /// Only preprocess
    Preprocess = TCC_OUTPUT_PREPROCESS as _,
}

impl Default for OutputFormat {
    fn default() -> Self {
        OutputFormat::Memory
    }
}

/// Nominal type for some registered symbol. Used to force pointer-cast usage without
/// allowing for interop with other APIs taking `*mut c_void` pointers.
bun_opaque::opaque_ffi! { pub struct Symbol; }

/// Zig: `Symbol.Callback = fn (?*anyopaque, [*:0]const u8, ?*const Symbol) void`
pub type SymbolCallback =
    unsafe extern "C" fn(ctx: *mut c_void, name: *const c_char, val: *const Symbol);

bun_opaque::opaque_ffi! {
    /// Opaque TinyCC compilation state. Always handled via `*mut State` / `&mut State`.
    pub struct State;
}

/// Zig: `State.Config(ErrCtx).err` anonymous struct.
pub struct ConfigErr<ErrCtx> {
    pub ctx: Option<*mut ErrCtx>,
    pub handler: unsafe extern "C" fn(*mut ErrCtx, *const c_char),
}

/// Zig: `fn Config(ErrCtx: type) type { return struct { ... } }`
pub struct Config<ErrCtx> {
    // TODO(port): lifetime — call sites pass both literals (default_tcc_options) and runtime
    // strings (CompileC.flags / BUN_TCC_OPTIONS); raw ptr in Phase A, revisit borrow in Phase B.
    pub options: Option<NonNull<ZStr>>,
    pub output_type: OutputFormat,
    pub err: ConfigErr<ErrCtx>,
}

impl<ErrCtx> Default for Config<ErrCtx>
where
    ConfigErr<ErrCtx>: Default,
{
    fn default() -> Self {
        // TODO(port): Zig field defaults are `options = null, output_type = .Memory`; `err.handler`
        // has no default so a literal `.{}` is invalid in Zig too. This Default impl is best-effort.
        Self {
            options: None,
            output_type: OutputFormat::Memory,
            err: Default::default(),
        }
    }
}

impl State {
    /// Create a new TCC compilation context
    pub fn new() -> Result<NonNull<State>, bun_alloc::AllocError> {
        // SAFETY: tcc_new has no preconditions.
        NonNull::new(unsafe { tcc_new() }).ok_or(bun_alloc::AllocError)
    }

    /// Create and initialize a new TCC compilation context
    pub fn init<ErrCtx, const VALIDATE_OPTIONS: bool>(
        config: Config<ErrCtx>,
    ) -> Result<NonNull<State>, bun_core::Error> {
        // TODO(port): narrow error set to (AllocError | Error)
        let state_ptr = State::new()?;
        // errdefer state.destroy() — State is an FFI handle without Drop, so use scopeguard.
        let guard = scopeguard::guard(state_ptr, |p| {
            // SAFETY: p was returned by tcc_new and has not yet been deleted.
            unsafe { tcc_delete(p.as_ptr()) }
        });
        // SAFETY: state_ptr is valid and uniquely owned for the duration of this fn.
        let state: &mut State = unsafe { &mut *state_ptr.as_ptr() };

        // setOutputType has side effects that are conditional on existing
        // options, so this must be called after setOptions
        if !VALIDATE_OPTIONS {
            if let Some(options) = config.options {
                // SAFETY: caller guarantees `options` outlives this init call.
                match state.set_options(unsafe { options.as_ref() }) {
                    Ok(()) => {}
                    Err(_) => {
                        if cfg!(debug_assertions) {
                            panic!("Failed to set options");
                        }
                    }
                }
            }
        }

        // register error handler first so that other methods can stick error
        // data in the context
        state.set_error_func(config.err.ctx, config.err.handler);

        if VALIDATE_OPTIONS {
            if let Some(options) = config.options {
                // SAFETY: caller guarantees `options` outlives this init call.
                state.set_options(unsafe { options.as_ref() })?;
            }
        }

        state.set_output_type(config.output_type)?;

        let state_ptr = scopeguard::ScopeGuard::into_inner(guard);
        Ok(state_ptr)
    }

    /// Free a TCC compilation context
    ///
    /// # Safety
    /// `s` must have been returned by [`State::new`]/[`State::init`] and not yet freed.
    pub unsafe fn destroy(s: *mut State) {
        // PORT NOTE: opaque FFI handle — kept as explicit destroy fn, not `impl Drop`.
        unsafe { tcc_delete(s) }
    }

    /// Set `CONFIG_TCCDIR` at runtime
    pub fn set_lib_path(&mut self, path: &ZStr) {
        // SAFETY: self is a valid *mut TCCState; path is NUL-terminated.
        unsafe { tcc_set_lib_path(self, path.as_ptr()) }
    }

    /// Set error/warning display callback
    pub fn set_error_func<Context>(
        &mut self,
        error_opaque: Option<*mut Context>,
        error_func: ErrorFunc<Context>,
    ) {
        // SAFETY: ErrorFunc<Context> is ABI-identical to the untyped TCCErrorFunc inner fn
        // (both `extern "C" fn(*mut _, *const c_char)`, differing only in the opaque
        // pointee type); mirrors Zig `@ptrCast(errorFunc)`.
        let erased: TCCErrorFunc = Some(unsafe {
            bun_ptr::cast_fn_ptr::<
                ErrorFunc<Context>,
                unsafe extern "C" fn(*mut c_void, *const c_char),
            >(error_func)
        });
        let opaque = error_opaque.map_or(core::ptr::null_mut(), |p| p.cast::<c_void>());
        // SAFETY: self is a valid *mut TCCState.
        unsafe { tcc_set_error_func(self, opaque, erased) }
    }

    // NOTE: get_error_func / get_error_opaque wrappers removed — the underlying
    // tcc_get_error_func / tcc_get_error_opaque symbols were dropped from the vendored
    // libtcc.h and would fail to link if referenced. (tcc.zig:125-131 carries the same
    // dead wrappers, surviving only via lazy analysis.)

    /// Set options as from command line (multiple supported)
    pub fn set_options(&mut self, str_: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; str_ is NUL-terminated.
        if unsafe { tcc_set_options(self, str_.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidOptions);
        }
        Ok(())
    }

    // ======================== Preprocessor ========================

    /// Add include path
    pub fn add_include_path(&mut self, pathname: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; pathname is NUL-terminated.
        if unsafe { tcc_add_include_path(self, pathname.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidIncludePath);
        }
        Ok(())
    }

    /// Add in system include path
    pub fn add_sys_include_path(&mut self, pathname: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; pathname is NUL-terminated.
        if unsafe { tcc_add_sysinclude_path(self, pathname.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidIncludePath);
        }
        Ok(())
    }

    /// Define preprocessor symbol 'sym'. value can be NULL, sym can be "sym=val"
    ///
    /// ```c
    /// #define sym value
    /// ```
    pub fn define_symbol(&mut self, sym: &ZStr, value: &ZStr) {
        // SAFETY: self is a valid *mut TCCState; sym/value are NUL-terminated.
        unsafe { tcc_define_symbol(self, sym.as_ptr(), value.as_ptr()) }
    }

    /// Define multiple preprocessor symbols with integer values.
    ///
    /// Zig: `defineSymbolsComptime(s, symbols: anytype)` — iterated anonymous-struct fields via
    /// `@typeInfo`/`@field` and dispatched on field type at comptime. Per PORTING.md §Comptime
    /// reflection, homogenized to a slice + plain `for` since every call site passes ints (the
    /// Zig `.pointer` arm at tcc.zig:192 is dead and itself buggy — it passes `s` twice).
    ///
    /// ## Example
    /// ```ignore
    /// state.define_symbols(&[("foo", 1), ("baz", 42)]);
    /// ```
    pub fn define_symbols(&mut self, symbols: &[(&str, i64)]) {
        // Zig: `var buf: [256]u8 = undefined;`
        let mut buf = [0u8; 256];
        for &(name, value) in symbols {
            // Zig field names are `[:0]const u8` (comptime NUL-terminated); copy into the stack
            // buffer to recover that invariant for the C ABI.
            // PERF(port): was comptime monomorphization (zero-copy name) — profile in Phase B.
            let name_len = name.len();
            debug_assert!(name_len < buf.len());
            buf[..name_len].copy_from_slice(name.as_bytes());
            buf[name_len] = 0;
            let sym_ptr = buf.as_ptr().cast::<c_char>();

            // Zig: `std.fmt.bufPrintZ(&buf, "{d}", .{value}) catch unreachable`
            let mut ibuf = bun_core::fmt::ItoaBuf::new();
            let digits = bun_core::fmt::itoa(&mut ibuf, value);
            let val_off = name_len + 1;
            let val_end = val_off + digits.len();
            debug_assert!(val_end < buf.len());
            buf[val_off..val_end].copy_from_slice(digits);
            buf[val_end] = 0;
            let val_ptr = buf[val_off..].as_ptr().cast::<c_char>();

            // SAFETY: self is a valid *mut TCCState; both buffer regions are NUL-terminated and
            // outlive the FFI call (tcc_define_symbol copies its arguments).
            unsafe { tcc_define_symbol(self, sym_ptr, val_ptr) }
        }
    }

    /// Undefine preprocess symbol 'sym'
    ///
    /// ```c
    /// #undef sym
    /// ```
    pub fn undefine_symbol(&mut self, sym: &ZStr) {
        // SAFETY: self is a valid *mut TCCState; sym is NUL-terminated.
        unsafe { tcc_undefine_symbol(self, sym.as_ptr()) }
    }

    // ======================== Compiling ========================

    /// Add a file (C file, dll, object, library, ld script).
    ///
    /// ## Errors
    /// - File not found
    /// - Syntax/formatting error
    pub fn add_file(&mut self, filename: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; filename is NUL-terminated.
        if unsafe { tcc_add_file(self, filename.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::CompileError);
        }
        Ok(())
    }

    /// Compile a string containing a C source.
    pub fn compile_string(&mut self, buf: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; buf is NUL-terminated.
        if unsafe { tcc_compile_string(self, buf.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::CompileError);
        }
        Ok(())
    }

    // ======================== Linking Commands ========================

    /// Set output type. MUST BE CALLED before any compilation
    pub fn set_output_type(&mut self, output_type: OutputFormat) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState.
        if unsafe { tcc_set_output_type(self, output_type as c_int) } == -1 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidOutputType);
        }
        Ok(())
    }

    /// Add a library. Equivalent to `-Lpath` option
    pub fn add_library_path(&mut self, pathname: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; pathname is NUL-terminated.
        if unsafe { tcc_add_library_path(self, pathname.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidLibraryPath);
        }
        Ok(())
    }

    /// Add a library. The library name is the same as the argument of the `-l` option
    pub fn add_library(&mut self, libraryname: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; libraryname is NUL-terminated.
        if unsafe { tcc_add_library(self, libraryname.as_ptr()) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidLibraryPath);
        }
        Ok(())
    }

    /// Add a symbol to the compiled program
    pub fn add_symbol(&mut self, name: &ZStr, val: *const c_void) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; name is NUL-terminated; val is an opaque address.
        if unsafe { tcc_add_symbol(self, name.as_ptr(), val) } != 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::InvalidSymbol);
        }
        Ok(())
    }

    /// Add multiple symbols to the compiled program.
    ///
    /// Zig: `addSymbolsComptime(s, symbols: anytype)` — iterated anonymous-struct fields via
    /// `@typeInfo`/`@field` at comptime. Per PORTING.md §Comptime reflection, homogenized to a
    /// slice of `(name, *const c_void)` + plain `for` since every call site passes opaque
    /// function/data pointers.
    ///
    /// ## Example
    /// ```ignore
    /// state.add_symbols(&[
    ///     ("add", add as *const c_void),
    ///     ("sub", sub as *const c_void),
    /// ])?;
    /// ```
    pub fn add_symbols(&mut self, symbols: &[(&str, *const c_void)]) -> Result<(), Error> {
        // Zig field names are `[:0]const u8` (comptime NUL-terminated); copy into a stack buffer
        // to recover that invariant for the C ABI.
        // PERF(port): was comptime monomorphization (zero-copy name) — profile in Phase B.
        let mut buf = [0u8; 256];
        for &(name, val) in symbols {
            let len = name.len();
            debug_assert!(len < buf.len());
            buf[..len].copy_from_slice(name.as_bytes());
            buf[len] = 0;
            // Zig: `try s.addSymbol(field.name, value);`
            // SAFETY: self is a valid *mut TCCState; buf[..=len] is NUL-terminated and outlives
            // the FFI call (tcc_add_symbol copies the name); val is an opaque address.
            if unsafe { tcc_add_symbol(self, buf.as_ptr().cast::<c_char>(), val) } != 0 {
                // PERF(port): @branchHint(.unlikely)
                return Err(Error::InvalidSymbol);
            }
        }
        Ok(())
    }

    /// Output an executable, library or object file. DO NOT call `relocate` before.
    pub fn output_file(&mut self, filename: &ZStr) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState; filename is NUL-terminated.
        if unsafe { tcc_output_file(self, filename.as_ptr()) } == -1 {
            // PERF(port): @branchHint(.unlikely)
            // TODO(port): Zig source returns `error.OutputError` here, which is NOT in the Zig
            // `Error` set (latent compile error masked by lazy analysis). See enum note above.
            return Err(Error::OutputError);
        }
        Ok(())
    }

    /// Link and run `main()` function and return its value. DO NOT call `relocate` before.
    /// Returns the status code returned by the program's `main()` function.
    pub fn run(&mut self, argc: c_int, argv: *const *const c_char) -> c_int {
        // SAFETY: self is a valid *mut TCCState; argv points to argc NUL-terminated C strings.
        // Zig signature is `[*:0]const [*:0]const u8` but the extern takes `[*c][*c]u8`; cast
        // const away to match the C ABI (tcc does not mutate argv).
        unsafe { tcc_run(self, argc, argv as *mut *mut c_char) }
    }

    /// Do all relocations (needed before using `get_symbol`)
    /// Memory is allocated and managed internally by TinyCC.
    /// Returns Ok on success, error on failure.
    pub fn relocate(&mut self) -> Result<(), Error> {
        // SAFETY: self is a valid *mut TCCState.
        let ret = unsafe { tcc_relocate(self) };
        if ret < 0 {
            // PERF(port): @branchHint(.unlikely)
            return Err(Error::RelocationError);
        }
        Ok(())
    }

    /// Return symbol value or NULL if not found
    pub fn get_symbol(&mut self, name: &ZStr) -> Option<NonNull<Symbol>> {
        // SAFETY: self is a valid *mut TCCState; name is NUL-terminated.
        NonNull::new(unsafe { tcc_get_symbol(self, name.as_ptr()) }.cast::<Symbol>())
    }

    /// Return symbol value or NULL if not found
    pub fn list_symbols(&mut self, ctx: *mut c_void, symbol_cb: Option<SymbolCallback>) {
        // SAFETY: SymbolCallback is ABI-identical to the extern's callback type
        // (`*const Symbol` vs `*const c_void` in the last param); mirrors Zig's implicit ptrcast.
        let erased = symbol_cb.map(|f| unsafe {
            bun_ptr::cast_fn_ptr::<
                SymbolCallback,
                unsafe extern "C" fn(*mut c_void, *const c_char, *const c_void),
            >(f)
        });
        // SAFETY: self is a valid *mut TCCState.
        unsafe { tcc_list_symbols(self, ctx, erased) }
    }
}

// ported from: src/tcc_sys/tcc.zig
