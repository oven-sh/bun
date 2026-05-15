use core::ffi::{c_char, c_uint};
use core::ptr::NonNull;

use crate::{Exception, JSGlobalObject, JSValue, JsError, JsResult};

// `Environment.ci_assert` is `isDebug || isTest || enable_asan || (ReleaseSafe && is_canary)`;
// the bun_jsc crate gates on the same predicate this file uses for `SIZE`.
#[cfg(any(debug_assertions, bun_asan))]
const SIZE: usize = 56;
#[cfg(not(any(debug_assertions, bun_asan)))]
const SIZE: usize = 8;
const ALIGNMENT: usize = 8;

/// Mirrors `std.builtin.SourceLocation`. Rust's `core::panic::Location` lacks `fn_name`
/// and is not NUL-terminated, so callers construct this via the [`src!`](crate::src) macro
/// (which captures `module_path!()`/`file!()`/`line!()` as NUL-terminated literals) or via
/// [`SourceLocation::from_caller`] which interns the runtime `Location` for `#[track_caller]`
/// chains where the macro can't reach.
#[derive(Clone, Copy)]
pub struct SourceLocation {
    pub fn_name: *const c_char,
    pub file: *const c_char,
    pub line: u32,
}

// SAFETY: both pointers always reference `'static` data — either compile-time literals
// from `concat!(file!(), "\0")` / `c"…"`, or leaked interned `CString`s from
// `intern_location_file`. They are never freed and never written through, so sharing
// across threads is sound.
unsafe impl Send for SourceLocation {}
unsafe impl Sync for SourceLocation {}

impl SourceLocation {
    /// Build from the runtime `#[track_caller]` location. The `file()` string is not
    /// NUL-terminated, so we intern it (leaked, bounded by the number of distinct call
    /// sites in the binary) to hand a stable `*const c_char` to the C++ scope ctor for
    /// `BUN_JSC_dumpSimulatedThrows` diagnostics.
    #[track_caller]
    #[inline]
    pub fn from_caller() -> Self {
        let loc = core::panic::Location::caller();
        Self {
            fn_name: c"<rust>".as_ptr(),
            file: intern_location_file(loc.file()),
            line: loc.line(),
        }
    }
}

/// Intern a `&'static str` (from `Location::file()`) as a leaked NUL-terminated C string.
/// Thread-local cache keyed by string-data pointer identity — `Location::file()` always
/// returns the same `&'static str` for a given call site, so the cache is bounded by the
/// number of distinct `#[track_caller]` sites that reach a scope ctor.
#[cfg(any(debug_assertions, bun_asan))]
fn intern_location_file(file: &'static str) -> *const c_char {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::CString;
    thread_local! {
        static CACHE: RefCell<HashMap<usize, *const c_char>> = RefCell::new(HashMap::new());
    }
    CACHE.with(|c| {
        *c.borrow_mut()
            .entry(file.as_ptr() as usize)
            .or_insert_with(|| {
                // `file!()` paths never contain interior NULs; fall back gracefully if one
                // somehow does.
                let cs = CString::new(file).unwrap_or_else(|_| CString::new("<rust>").unwrap());
                // Bounded leak — same lifetime semantics as the `concat!(file!(), "\0")` literals
                // the [`src!`] macro emits.
                Box::leak(cs.into_boxed_c_str()).as_ptr()
            })
    })
}
#[cfg(not(any(debug_assertions, bun_asan)))]
#[inline(always)]
fn intern_location_file(_file: &'static str) -> *const c_char {
    // Release builds don't compile the C++ scope-verification machinery; the file string
    // is never read. Avoid the HashMap.
    c"<rust>".as_ptr()
}

/// Expand to a [`SourceLocation`] for the call site, with `file`/`fn_name` as
/// NUL-terminated `&'static` byte literals (no interning). Prefer this over
/// `SourceLocation::from_caller()` when the call site is itself a macro expansion
/// (so `file!()`/`line!()` resolve to the user's code, not a helper).
#[macro_export]
macro_rules! src {
    () => {
        $crate::top_exception_scope::SourceLocation {
            fn_name: ::core::concat!(::core::module_path!(), "\0")
                .as_ptr()
                .cast::<::core::ffi::c_char>(),
            file: ::core::concat!(::core::file!(), "\0")
                .as_ptr()
                .cast::<::core::ffi::c_char>(),
            line: ::core::line!(),
        }
    };
}

/// Binding for JSC::ThrowScope/CatchScope. Use at the boundary between JSC's
/// exception-checking discipline and Rust's `JsResult` — typically wrapping a raw FFI call
/// into C++ that may set `vm.m_needExceptionCheck` (via `simulateThrow()` under
/// `BUN_JSC_validateExceptionChecks=1`). The scope's `exception()` accessor satisfies that
/// check; without it, the *next* scope ctor (e.g. inside `JSGlobalObject__hasException`)
/// asserts.
///
/// **Address stability**: the C++ `ExceptionScope` ctor stores `&bytes` into
/// `vm.m_topExceptionScope`, so this struct **must not move** between [`init`](Self::init)
/// and destruction. Rust does not guarantee NRVO, so a `-> Self` constructor is unsound.
/// Use the [`top_scope!`](crate::top_scope) macro, which declares stack storage at a
/// `let`-binding (stable address) and returns an RAII [`TopExceptionScopeGuard`] that
/// destroys on drop:
///
/// ```ignore
/// bun_jsc::top_scope!(scope, global);
/// let value: i32 = unsafe { external_call(vm, foo, bar, baz) };
/// scope.return_if_exception()?;
/// Ok(value)
/// // `scope` drops here → C++ dtor runs.
/// ```
#[repr(C, align(8))]
pub struct TopExceptionScope {
    bytes: [u8; SIZE],
    /// Pointer to `bytes`, set by `init()`, used to assert that the location did not change
    #[cfg(any(debug_assertions, bun_asan))]
    location: *const u8,
}

/// RAII guard for a [`TopExceptionScope`] whose backing storage lives in the caller's
/// stack frame. The guard itself is freely movable (it only holds a borrow); the storage
/// is pinned by the `let mut __storage = MaybeUninit::uninit()` binding the
/// [`top_scope!`](crate::top_scope) macro emits. Dropping the guard runs the C++ dtor.
pub struct TopExceptionScopeGuard<'a>(&'a mut TopExceptionScope);

impl<'a> core::ops::Deref for TopExceptionScopeGuard<'a> {
    type Target = TopExceptionScope;
    #[inline]
    fn deref(&self) -> &TopExceptionScope {
        self.0
    }
}
impl<'a> core::ops::DerefMut for TopExceptionScopeGuard<'a> {
    #[inline]
    fn deref_mut(&mut self) -> &mut TopExceptionScope {
        self.0
    }
}
impl Drop for TopExceptionScopeGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: the guard is only ever constructed by `init_guard`, which fully
        // initialized the scope; the borrow ensures it has not been destroyed.
        unsafe { TopExceptionScope::destroy(self.0) };
    }
}

impl TopExceptionScope {
    /// Convenience alias of [`init`](Self::init) accepting an explicit caller `Location`.
    /// The inner C++ scope only consumes file/line, which `init` already recovers via
    /// `#[track_caller]`; `_src` is accepted for API symmetry with
    /// `ExceptionValidationScope::new` so call sites can pass `Location::caller()` uniformly.
    #[track_caller]
    pub fn new<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
        _src: &'static core::panic::Location<'static>,
    ) -> &'a mut Self {
        Self::init(storage, global)
    }

    /// Construct in caller-owned storage. The C++ `ExceptionScope` ctor stores
    /// `&bytes` into `vm.m_topExceptionScope`, so the storage address must be
    /// stable from before this call until [`destroy`](Self::destroy) — which
    /// rules out a `-> Self` return (Rust does not guarantee NRVO, and ASAN's
    /// stack redzones make the local/return-slot mismatch observable).
    ///
    /// Prefer [`top_scope!`](crate::top_scope) (RAII) over calling this directly.
    #[track_caller]
    pub fn init<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
    ) -> &'a mut Self {
        Self::init_at(storage, global, SourceLocation::from_caller())
    }

    /// Like [`init`](Self::init) but with an explicit [`SourceLocation`] — used by the
    /// [`top_scope!`](crate::top_scope) macro to forward `file!()`/`line!()` literals.
    #[inline]
    pub fn init_at<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
        src: SourceLocation,
    ) -> &'a mut Self {
        // Seat the Rust struct first (zeroed bytes; `location` null) so
        // `init_in_place` sees a valid `&mut Self` at its final address.
        let this = storage.write(Self {
            bytes: [0u8; SIZE],
            #[cfg(any(debug_assertions, bun_asan))]
            location: core::ptr::null(),
        });
        this.init_in_place(global, src);
        this
    }

    /// RAII constructor: initialize in `storage` and return a guard that runs the C++
    /// dtor on drop. Called by [`top_scope!`](crate::top_scope); rarely needed directly.
    #[track_caller]
    #[inline]
    pub fn init_guard<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
    ) -> TopExceptionScopeGuard<'a> {
        TopExceptionScopeGuard(Self::init(storage, global))
    }

    /// RAII constructor with explicit [`SourceLocation`].
    #[inline]
    pub fn init_guard_at<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
        src: SourceLocation,
    ) -> TopExceptionScopeGuard<'a> {
        TopExceptionScopeGuard(Self::init_at(storage, global, src))
    }

    pub fn init_in_place(&mut self, global: &JSGlobalObject, src: SourceLocation) {
        // SAFETY: `bytes` is SIZE bytes, ALIGNMENT-aligned (via #[repr(align(8))]); the C++
        // side asserts size/alignment match.
        unsafe {
            TopExceptionScope__construct(
                &raw mut self.bytes,
                global,
                src.fn_name,
                src.file,
                src.line as c_uint,
                SIZE,
                ALIGNMENT,
            );
        }

        #[cfg(any(debug_assertions, bun_asan))]
        {
            self.location = core::ptr::from_ref::<u8>(&self.bytes[0]);
        }
    }

    /// Generate a useful message including where the exception was thrown.
    /// Only intended to be called when there is a pending exception.
    #[cold]
    fn assertion_failure(&mut self, proof: NonNull<Exception>) -> ! {
        let _ = proof;
        #[cfg(any(debug_assertions, bun_asan))]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        TopExceptionScope__assertNoException(&mut self.bytes);
        unreachable!("assertionFailure called without a pending exception");
    }

    pub fn has_exception(&mut self) -> bool {
        self.exception().is_some()
    }

    /// Get the thrown exception if it exists (like scope.exception() in C++)
    pub fn exception(&mut self) -> Option<NonNull<Exception>> {
        #[cfg(any(debug_assertions, bun_asan))]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        NonNull::new(TopExceptionScope__pureException(&mut self.bytes))
    }

    pub fn clear_exception(&mut self) {
        #[cfg(any(debug_assertions, bun_asan))]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        TopExceptionScope__clearException(&mut self.bytes)
    }

    /// Get the thrown exception if it exists, or if an unhandled trap causes an exception to be thrown
    pub fn exception_including_traps(&mut self) -> Option<NonNull<Exception>> {
        #[cfg(any(debug_assertions, bun_asan))]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        NonNull::new(TopExceptionScope__exceptionIncludingTraps(&mut self.bytes))
    }

    /// Intended for use with `?`. Returns if there is already a pending exception or if traps cause
    /// an exception to be thrown (this is the same as how RETURN_IF_EXCEPTION behaves in C++)
    pub fn return_if_exception(&mut self) -> JsResult<()> {
        if self.exception_including_traps().is_some() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }

    /// Asserts there has not been any exception thrown.
    pub fn assert_no_exception(&mut self) {
        #[cfg(any(debug_assertions, bun_asan))]
        {
            if let Some(e) = self.exception() {
                // TerminationException can be raised at any safepoint (worker
                // terminate(), worker process.exit()) regardless of what the host
                // function returned, so it's never a return-value/exception
                // mismatch — let the caller's safepoint observe it.
                if JSValue::from_cell(e.as_ptr()).is_termination_exception() {
                    return;
                }
                self.assertion_failure(e);
            }
        }
    }

    /// Asserts that there is or is not an exception according to the value of `should_have_exception`.
    /// Prefer over `assert(scope.has_exception() == ...)` because if there is an unexpected exception,
    /// this function prints a trace of where it was thrown.
    pub fn assert_exception_presence_matches(&mut self, should_have_exception: bool) {
        #[cfg(any(debug_assertions, bun_asan))]
        {
            if should_have_exception {
                // Must call `has_exception()` unconditionally inside this cfg block
                // (not via `debug_assert!`): release+ASAN builds enter here via
                // `bun_asan` with `debug_assertions` off, and the C++ scope's
                // destructor will fail `verifyExceptionCheckNeedIsSatisfied` unless
                // the underlying `VM::exception()` was actually invoked. Zig spec
                // uses `bun.assertf` (active under `ci_assert`, which includes ASAN).
                assert!(self.has_exception(), "Expected an exception to be thrown");
            } else {
                self.assert_no_exception();
            }
        }
        #[cfg(not(any(debug_assertions, bun_asan)))]
        let _ = should_have_exception;
    }

    /// If no exception, returns.
    /// If termination exception, returns JSTerminated (so you can `?`)
    /// If non-termination exception, assertion failure.
    pub fn assert_no_exception_except_termination(&mut self) -> Result<(), JsError> {
        if let Some(e) = self.exception() {
            if JSValue::from_cell(e.as_ptr()).is_termination_exception() {
                return Err(JsError::Terminated);
            }
            #[cfg(any(debug_assertions, bun_asan))]
            self.assertion_failure(e);
            // In release we deliberately fall through and return `Ok` — an
            // unconditional panic here is worse for our users.
        }
        Ok(())
    }

    /// # Safety
    /// `this` must point to a scope previously initialized via `init()` and not yet destroyed.
    /// Prefer dropping a [`TopExceptionScopeGuard`] instead.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract.
        let this = unsafe { &mut *this };
        #[cfg(any(debug_assertions, bun_asan))]
        debug_assert!(core::ptr::eq(this.location, &this.bytes[0]));
        // SAFETY: bytes was initialized by init().
        unsafe { TopExceptionScope__destruct(&raw mut this.bytes) };
        // this.bytes = undefined; — no-op in Rust
    }
}

/// Declare a [`TopExceptionScope`] on the caller's stack and bind an RAII guard.
///
/// Expands to two `let` bindings: backing `MaybeUninit` storage (address-stable for the
/// C++ `vm.m_topExceptionScope` link) and a [`TopExceptionScopeGuard`] that destroys on
/// drop. `macro_rules!` hygiene gives each invocation a distinct storage binding, so
/// nesting is safe.
///
/// ```ignore
/// bun_jsc::top_scope!(scope, global);
/// let r = unsafe { raw_ffi(global) };
/// scope.return_if_exception()?;
/// ```
#[macro_export]
macro_rules! top_scope {
    ($scope:ident, $global:expr) => {
        let mut __bun_top_scope_storage =
            ::core::mem::MaybeUninit::<$crate::TopExceptionScope>::uninit();
        #[allow(unused_mut)]
        let mut $scope = $crate::TopExceptionScope::init_guard_at(
            &mut __bun_top_scope_storage,
            $global,
            $crate::src!(),
        );
    };
}

/// Declare an [`ExceptionValidationScope`] on the caller's stack and bind an RAII guard.
///
/// Under `cfg(any(debug_assertions, bun_asan))` this is a real C++ scope (so the FFI
/// callee's `simulateThrow()` is satisfied by the following
/// `assert_exception_presence_matches`); in release it is a ZST and all methods are no-ops.
///
/// ```ignore
/// bun_jsc::validation_scope!(scope, global);
/// let v = unsafe { raw_ffi_returning_jsvalue(global) };
/// scope.assert_exception_presence_matches(v == JSValue::ZERO);
/// if v == JSValue::ZERO { Err(JsError::Thrown) } else { Ok(v) }
/// ```
#[macro_export]
macro_rules! validation_scope {
    ($scope:ident, $global:expr) => {
        let mut __bun_validation_scope_storage =
            ::core::mem::MaybeUninit::<$crate::ExceptionValidationScope>::uninit();
        #[allow(unused_mut)]
        let mut $scope = $crate::ExceptionValidationScope::init_guard_at(
            &mut __bun_validation_scope_storage,
            $global,
            $crate::src!(),
        );
    };
}

/// Limited subset of TopExceptionScope functionality, for when you have a different way to detect
/// exceptions and you only need a TopExceptionScope to prove that you are checking exceptions correctly.
/// Gated by `cfg(any(debug_assertions, bun_asan))` — Zig's `Environment.ci_assert` is
/// `isDebug || isTest || enable_asan || (ReleaseSafe && is_canary)`; the bun_jsc crate has no
/// `ci_assert` Cargo feature, so gate on the same predicate this file already uses for `SIZE`.
/// Without this, debug builds left the scope as a no-op while `debug_assert!` callers (e.g.
/// `bun_string_jsc::from_js`) still fired, panicking on every legitimate stringify exception.
///
/// Prefer the [`validation_scope!`](crate::validation_scope) macro over manual init/destroy.
pub struct ExceptionValidationScope {
    #[cfg(any(debug_assertions, bun_asan))]
    scope: TopExceptionScope,
    #[cfg(not(any(debug_assertions, bun_asan)))]
    scope: (),
}

/// RAII guard for an [`ExceptionValidationScope`]. See [`TopExceptionScopeGuard`].
pub struct ExceptionValidationScopeGuard<'a>(&'a mut ExceptionValidationScope);

impl<'a> core::ops::Deref for ExceptionValidationScopeGuard<'a> {
    type Target = ExceptionValidationScope;
    #[inline]
    fn deref(&self) -> &ExceptionValidationScope {
        self.0
    }
}
impl<'a> core::ops::DerefMut for ExceptionValidationScopeGuard<'a> {
    #[inline]
    fn deref_mut(&mut self) -> &mut ExceptionValidationScope {
        self.0
    }
}
impl Drop for ExceptionValidationScopeGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: only constructed by `init_guard*`, which fully initialized the scope.
        unsafe { ExceptionValidationScope::destroy(self.0) };
    }
}

impl ExceptionValidationScope {
    /// See [`TopExceptionScope::init`] for the storage-passing rationale.
    /// `src` is currently advisory (forwarded to the C++ scope when `ci_assert`
    /// is enabled via `init_in_place` callers); kept in the signature so call
    /// sites can pass `core::panic::Location::caller()` today and the value
    /// flows through once the C++ side consumes it.
    #[track_caller]
    pub fn new<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
        _src: &'static core::panic::Location<'static>,
    ) -> &'a mut Self {
        Self::init(storage, global)
    }

    /// See [`TopExceptionScope::init`] for the storage-passing rationale.
    #[track_caller]
    pub fn init<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
    ) -> &'a mut Self {
        Self::init_at(storage, global, SourceLocation::from_caller())
    }

    #[inline]
    pub fn init_at<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
        src: SourceLocation,
    ) -> &'a mut Self {
        #[cfg(any(debug_assertions, bun_asan))]
        {
            // Reinterpret the outer storage as storage for the inner
            // `TopExceptionScope` — the wrapper has no other fields under
            // `ci_assert`, so layouts match exactly.
            const _: () = assert!(
                core::mem::size_of::<ExceptionValidationScope>()
                    == core::mem::size_of::<TopExceptionScope>()
                    && core::mem::align_of::<ExceptionValidationScope>()
                        == core::mem::align_of::<TopExceptionScope>()
            );
            // SAFETY: layout assertion above; `MaybeUninit<T>` is `repr(transparent)`.
            let inner = unsafe {
                &mut *(storage as *mut core::mem::MaybeUninit<Self>
                    as *mut core::mem::MaybeUninit<TopExceptionScope>)
            };
            TopExceptionScope::init_at(inner, global, src);
            // SAFETY: `init_at` fully initialized the sole field.
            unsafe { storage.assume_init_mut() }
        }
        #[cfg(not(any(debug_assertions, bun_asan)))]
        {
            let _ = (global, src);
            storage.write(Self { scope: () })
        }
    }

    /// RAII constructor — see [`TopExceptionScope::init_guard`].
    #[track_caller]
    #[inline]
    pub fn init_guard<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
    ) -> ExceptionValidationScopeGuard<'a> {
        ExceptionValidationScopeGuard(Self::init(storage, global))
    }

    /// RAII constructor with explicit [`SourceLocation`].
    #[inline]
    pub fn init_guard_at<'a>(
        storage: &'a mut core::mem::MaybeUninit<Self>,
        global: &JSGlobalObject,
        src: SourceLocation,
    ) -> ExceptionValidationScopeGuard<'a> {
        ExceptionValidationScopeGuard(Self::init_at(storage, global, src))
    }

    pub fn init_in_place(&mut self, global: &JSGlobalObject, src: SourceLocation) {
        #[cfg(any(debug_assertions, bun_asan))]
        self.scope.init_in_place(global, src);
        #[cfg(not(any(debug_assertions, bun_asan)))]
        let _ = (global, src);
    }

    /// Asserts there has not been any exception thrown.
    pub fn assert_no_exception(&mut self) {
        #[cfg(any(debug_assertions, bun_asan))]
        self.scope.assert_no_exception();
    }

    /// Asserts that there is or is not an exception according to the value of `should_have_exception`.
    /// Prefer over `assert(scope.has_exception() == ...)` because if there is an unexpected exception,
    /// this function prints a trace of where it was thrown.
    pub fn assert_exception_presence_matches(&mut self, should_have_exception: bool) {
        #[cfg(any(debug_assertions, bun_asan))]
        self.scope
            .assert_exception_presence_matches(should_have_exception);
        #[cfg(not(any(debug_assertions, bun_asan)))]
        let _ = should_have_exception;
    }

    /// If no exception, returns.
    /// If termination exception, returns JSTerminated (so you can `?`)
    /// If non-termination exception, assertion failure.
    pub fn assert_no_exception_except_termination(&mut self) -> Result<(), JsError> {
        #[cfg(any(debug_assertions, bun_asan))]
        return self.scope.assert_no_exception_except_termination();
        #[cfg(not(any(debug_assertions, bun_asan)))]
        Ok(())
    }

    /// Inconveniently named on purpose; this is only needed for some weird edge cases
    pub fn has_exception_or_false_when_assertions_are_disabled(&mut self) -> bool {
        #[cfg(any(debug_assertions, bun_asan))]
        return self.scope.has_exception();
        #[cfg(not(any(debug_assertions, bun_asan)))]
        false
    }

    /// # Safety
    /// `this` must point to a scope previously initialized via `init()` and not yet destroyed.
    /// Prefer dropping an [`ExceptionValidationScopeGuard`] instead.
    pub unsafe fn destroy(this: *mut Self) {
        #[cfg(any(debug_assertions, bun_asan))]
        unsafe {
            TopExceptionScope::destroy(&mut (*this).scope)
        };
        #[cfg(not(any(debug_assertions, bun_asan)))]
        let _ = this;
    }
}

// ──────────────── per-mode FFI-call wrappers (Rust analogue of cpp.zig) ────────────────
//
// `src/codegen/cppbind.ts` parses C++ `[[ZIG_EXPORT(mode)]]` attributes and emits
// `build/<profile>/codegen/cpp.zig`, where each throwing FFI gets a typed wrapper that
// (a) opens an `ExceptionValidationScope`/`TopExceptionScope` *before* the call,
// (b) asserts the return-value sentinel agrees with the scope's exception state, and
// (c) converts to `error{JSError}`. The Rust port emits the same wrappers into
// `cpp.rs` (see `generateRustFn` in cppbind.ts), which `bun_jsc::cpp` `include!`s.
//
// These four helpers are the per-mode bodies the generated wrappers (and hand-written
// FFI shims in `JSValue.rs`/`JSPromise.rs`/etc.) delegate to. They are *not* the
// "indirection" the prior band-aid used: each is `#[inline]` and `#[track_caller]`,
// so the validation scope's diagnostics point at the user's call site, and the
// scope is RAII (dropped on every return path including `?`).

/// `[[ZIG_EXPORT(zero_is_throw)]]`: callee returns `JSValue::ZERO` ⟺ it threw.
///
/// `src` is the diagnostic location for `BUN_JSC_dumpSimulatedThrows`; pass [`src!`](crate::src)
/// to avoid the [`intern_location_file`] HashMap lookup that the `#[track_caller]`
/// convenience wrapper [`call_zero_is_throw`] pays.
#[inline]
pub fn call_zero_is_throw_at(
    global: &JSGlobalObject,
    src: SourceLocation,
    f: impl FnOnce() -> JSValue,
) -> JsResult<JSValue> {
    let mut storage = core::mem::MaybeUninit::uninit();
    let mut scope = ExceptionValidationScope::init_guard_at(&mut storage, global, src);
    let v = f();
    scope.assert_exception_presence_matches(v == JSValue::ZERO);
    if v == JSValue::ZERO {
        Err(JsError::Thrown)
    } else {
        Ok(v)
    }
}

/// `[[ZIG_EXPORT(zero_is_throw)]]` — `#[track_caller]` convenience wrapper.
/// Prefer [`call_zero_is_throw_at`] with [`src!`](crate::src) in hot paths (avoids the
/// debug-build thread-local intern of `Location::file()`).
#[track_caller]
#[inline]
pub fn call_zero_is_throw(
    global: &JSGlobalObject,
    f: impl FnOnce() -> JSValue,
) -> JsResult<JSValue> {
    call_zero_is_throw_at(global, SourceLocation::from_caller(), f)
}

/// `[[ZIG_EXPORT(false_is_throw)]]`: callee returns `false` ⟺ it threw.
#[inline]
pub fn call_false_is_throw_at(
    global: &JSGlobalObject,
    src: SourceLocation,
    f: impl FnOnce() -> bool,
) -> JsResult<()> {
    let mut storage = core::mem::MaybeUninit::uninit();
    let mut scope = ExceptionValidationScope::init_guard_at(&mut storage, global, src);
    let v = f();
    scope.assert_exception_presence_matches(!v);
    if v { Ok(()) } else { Err(JsError::Thrown) }
}

/// `[[ZIG_EXPORT(false_is_throw)]]` — `#[track_caller]` convenience wrapper.
#[track_caller]
#[inline]
pub fn call_false_is_throw(global: &JSGlobalObject, f: impl FnOnce() -> bool) -> JsResult<()> {
    call_false_is_throw_at(global, SourceLocation::from_caller(), f)
}

/// `[[ZIG_EXPORT(null_is_throw)]]`: callee returns null ⟺ it threw.
#[inline]
pub fn call_null_is_throw_at<T>(
    global: &JSGlobalObject,
    src: SourceLocation,
    f: impl FnOnce() -> *mut T,
) -> JsResult<NonNull<T>> {
    let mut storage = core::mem::MaybeUninit::uninit();
    let mut scope = ExceptionValidationScope::init_guard_at(&mut storage, global, src);
    let v = f();
    scope.assert_exception_presence_matches(v.is_null());
    NonNull::new(v).ok_or(JsError::Thrown)
}

/// `[[ZIG_EXPORT(null_is_throw)]]` — `#[track_caller]` convenience wrapper.
#[track_caller]
#[inline]
pub fn call_null_is_throw<T>(
    global: &JSGlobalObject,
    f: impl FnOnce() -> *mut T,
) -> JsResult<NonNull<T>> {
    call_null_is_throw_at(global, SourceLocation::from_caller(), f)
}

/// `[[ZIG_EXPORT(check_slow)]]`: callee's return value carries no exception sentinel;
/// the scope must be queried explicitly.
///
/// Under `cfg(any(debug_assertions, bun_asan))` this opens a real [`TopExceptionScope`]
/// so `simulateThrow()` is satisfied and the assertion fires on mismatch. In release
/// builds the C++ validation machinery is compiled out, so we match Zig's generated
/// `check_slow` wrapper exactly: single `Bun__RETURN_IF_EXCEPTION` FFI call after the
/// closure (1 FFI hop instead of 3).
#[inline]
pub fn call_check_slow_at<R>(
    global: &JSGlobalObject,
    src: SourceLocation,
    f: impl FnOnce() -> R,
) -> JsResult<R> {
    #[cfg(any(debug_assertions, bun_asan))]
    {
        let mut storage = core::mem::MaybeUninit::uninit();
        let mut scope = TopExceptionScope::init_guard_at(&mut storage, global, src);
        let r = f();
        scope.return_if_exception()?;
        Ok(r)
    }
    #[cfg(not(any(debug_assertions, bun_asan)))]
    {
        let _ = src;
        let r = f();
        // `[[ZIG_EXPORT(nothrow)]]` — cppbind emits a safe `&JSGlobalObject`
        // wrapper (reads `vm.m_exception` with trap check; same body as
        // `RETURN_IF_EXCEPTION` in C++).
        if crate::cpp::Bun__RETURN_IF_EXCEPTION(global) {
            Err(JsError::Thrown)
        } else {
            Ok(r)
        }
    }
}

/// `[[ZIG_EXPORT(check_slow)]]` — `#[track_caller]` convenience wrapper.
#[track_caller]
#[inline]
pub fn call_check_slow<R>(global: &JSGlobalObject, f: impl FnOnce() -> R) -> JsResult<R> {
    call_check_slow_at(global, SourceLocation::from_caller(), f)
}

/// Macro forms of the per-mode wrappers — expand [`src!`](crate::src) at the *call site* so
/// the debug-build diagnostic `SourceLocation` is a NUL-terminated literal (zero-cost),
/// not a `#[track_caller]` `Location::file()` interned through a thread-local HashMap.
/// Prefer these over the bare `call_*_is_throw` fns in hand-written hot-path shims.
#[macro_export]
macro_rules! call_zero_is_throw {
    ($global:expr, $f:expr $(,)?) => {
        $crate::top_exception_scope::call_zero_is_throw_at($global, $crate::src!(), $f)
    };
}
#[macro_export]
macro_rules! call_false_is_throw {
    ($global:expr, $f:expr $(,)?) => {
        $crate::top_exception_scope::call_false_is_throw_at($global, $crate::src!(), $f)
    };
}
#[macro_export]
macro_rules! call_null_is_throw {
    ($global:expr, $f:expr $(,)?) => {
        $crate::top_exception_scope::call_null_is_throw_at($global, $crate::src!(), $f)
    };
}
#[macro_export]
macro_rules! call_check_slow {
    ($global:expr, $f:expr $(,)?) => {
        $crate::top_exception_scope::call_check_slow_at($global, $crate::src!(), $f)
    };
}

// safe fn: `&mut [u8; SIZE]` is ABI-identical to a non-null `*mut [u8; SIZE]`
// (thin pointer to a fixed-size array). Every `&mut self.bytes` reachable here
// has been seated by `init_in_place` (the sole constructor path), so the C++
// `ExceptionScope` invariant is encoded in the `TopExceptionScope` type — no
// caller-side precondition. `__construct` keeps `unsafe fn` (NUL-terminated
// `*const c_char` precondition) and `__destruct` keeps `unsafe fn`
// (consumes; double-destruct is UB and is gated by `unsafe fn destroy`).
unsafe extern "C" {
    fn TopExceptionScope__construct(
        ptr: *mut [u8; SIZE],
        global: *const JSGlobalObject,
        function: *const c_char,
        file: *const c_char,
        line: c_uint,
        size: usize,
        alignment: usize,
    );
    /// only returns exceptions that have already been thrown. does not check traps
    safe fn TopExceptionScope__pureException(ptr: &mut [u8; SIZE]) -> *mut Exception;
    safe fn TopExceptionScope__clearException(ptr: &mut [u8; SIZE]);
    /// returns if an exception was already thrown, or if a trap (like another thread requesting
    /// termination) causes an exception to be thrown
    safe fn TopExceptionScope__exceptionIncludingTraps(ptr: &mut [u8; SIZE]) -> *mut Exception;
    safe fn TopExceptionScope__assertNoException(ptr: &mut [u8; SIZE]);
    fn TopExceptionScope__destruct(ptr: *mut [u8; SIZE]);
}

// ported from: src/jsc/TopExceptionScope.zig
