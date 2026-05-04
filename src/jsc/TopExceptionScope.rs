use core::ffi::{c_char, c_uint};
use core::ptr::NonNull;

use crate::{Exception, JSGlobalObject, JSValue, JsError, JsResult};

// TODO(port): `Environment.allow_assert` is roughly `debug_assertions || is_test`;
// `Environment.enable_asan` is the ASAN build flag. Verify exact cfg names in Phase B.
#[cfg(any(debug_assertions, feature = "asan"))]
const SIZE: usize = 56;
#[cfg(not(any(debug_assertions, feature = "asan")))]
const SIZE: usize = 8;
const ALIGNMENT: usize = 8;

/// Mirrors `std.builtin.SourceLocation`. Rust's `core::panic::Location` lacks `fn_name`,
/// so callers must construct this via a macro that captures `module_path!()`/`file!()`/`line!()`.
// TODO(port): provide a `src!()` macro in bun_core that builds this with NUL-terminated strings.
pub struct SourceLocation {
    pub fn_name: *const c_char,
    pub file: *const c_char,
    pub line: u32,
}

/// Binding for JSC::TopExceptionScope. This should be used rarely, only at translation boundaries between
/// JSC's exception checking and Rust's. Make sure not to move it after creation. Use this if you are
/// making an external call that has no other way to indicate an exception.
///
/// ```ignore
/// // Declare a TopExceptionScope surrounding the call that may throw an exception
/// let mut scope = TopExceptionScope::uninit();
/// scope.init(global, src!());
/// // ... Drop is NOT used here; see PORT NOTE on destroy ...
///
/// let value: i32 = external_call(vm, foo, bar, baz);
/// // Calling return_if_exception() suffices to prove that we checked for an exception.
/// // This function's caller does not need to use a TopExceptionScope or ThrowScope
/// // because it can use Rust Result.
/// scope.return_if_exception()?;
/// unsafe { TopExceptionScope::destroy(&mut scope) };
/// return Ok(value);
/// ```
#[repr(C, align(8))]
pub struct TopExceptionScope {
    bytes: [u8; SIZE],
    /// Pointer to `bytes`, set by `init()`, used to assert that the location did not change
    #[cfg(feature = "ci_assert")]
    location: *const u8,
}

impl TopExceptionScope {
    // TODO(port): in-place init — `self` MUST NOT move after this call (C++ object is
    // placement-constructed into `bytes` and `location` self-references). Phase B should
    // wrap this in a Pin-based RAII guard or a `#[track_caller]` macro that stack-allocates.
    pub fn init(&mut self, global: &JSGlobalObject, src: SourceLocation) {
        // SAFETY: `bytes` is SIZE bytes, ALIGNMENT-aligned (via #[repr(align(8))]); the C++
        // side asserts size/alignment match.
        unsafe {
            TopExceptionScope__construct(
                &mut self.bytes,
                global,
                src.fn_name,
                src.file,
                src.line as c_uint,
                SIZE,
                ALIGNMENT,
            );
        }

        #[cfg(feature = "ci_assert")]
        {
            self.location = &self.bytes[0] as *const u8;
        }
    }

    /// Generate a useful message including where the exception was thrown.
    /// Only intended to be called when there is a pending exception.
    // TODO(port): JSC heap cell — NonNull instead of &Exception to avoid implying a Rust borrow lifetime.
    #[cold]
    fn assertion_failure(&mut self, proof: NonNull<Exception>) -> ! {
        let _ = proof;
        #[cfg(feature = "ci_assert")]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        // SAFETY: bytes was initialized by init().
        unsafe { TopExceptionScope__assertNoException(&mut self.bytes) };
        unreachable!("assertionFailure called without a pending exception");
    }

    pub fn has_exception(&mut self) -> bool {
        self.exception().is_some()
    }

    /// Get the thrown exception if it exists (like scope.exception() in C++)
    // TODO(port): JSC heap cell — NonNull instead of &Exception to avoid implying a Rust borrow lifetime.
    pub fn exception(&mut self) -> Option<NonNull<Exception>> {
        #[cfg(feature = "ci_assert")]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        // SAFETY: bytes was initialized by init().
        unsafe { NonNull::new(TopExceptionScope__pureException(&mut self.bytes)) }
    }

    pub fn clear_exception(&mut self) {
        #[cfg(feature = "ci_assert")]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        // SAFETY: bytes was initialized by init().
        unsafe { TopExceptionScope__clearException(&mut self.bytes) }
    }

    /// Get the thrown exception if it exists, or if an unhandled trap causes an exception to be thrown
    // TODO(port): JSC heap cell — NonNull instead of &Exception to avoid implying a Rust borrow lifetime.
    pub fn exception_including_traps(&mut self) -> Option<NonNull<Exception>> {
        #[cfg(feature = "ci_assert")]
        debug_assert!(core::ptr::eq(self.location, &self.bytes[0]));
        // SAFETY: bytes was initialized by init().
        unsafe { NonNull::new(TopExceptionScope__exceptionIncludingTraps(&mut self.bytes)) }
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
        #[cfg(feature = "ci_assert")]
        {
            if let Some(e) = self.exception() {
                // TerminationException can be raised at any safepoint (worker
                // terminate(), worker process.exit()) regardless of what the host
                // function returned, so it's never a return-value/exception
                // mismatch — let the caller's safepoint observe it.
                if JSValue::from_cell(e).is_termination_exception() {
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
        #[cfg(feature = "ci_assert")]
        {
            if should_have_exception {
                debug_assert!(self.has_exception(), "Expected an exception to be thrown");
            } else {
                self.assert_no_exception();
            }
        }
        #[cfg(not(feature = "ci_assert"))]
        let _ = should_have_exception;
    }

    /// If no exception, returns.
    /// If termination exception, returns JSTerminated (so you can `?`)
    /// If non-termination exception, assertion failure.
    // TODO(port): narrow error set — Zig is `bun.JSTerminated!void` (error{JSTerminated}).
    pub fn assert_no_exception_except_termination(&mut self) -> Result<(), JsError> {
        if let Some(e) = self.exception() {
            if JSValue::from_cell(e).is_termination_exception() {
                return Err(JsError::Terminated);
            } else {
                #[cfg(feature = "ci_assert")]
                self.assertion_failure(e);
                // Unconditionally panicking here is worse for our users.
            }
        }
        Ok(())
    }

    // PORT NOTE: explicit FFI destroy (not Drop) — the C++ object is placement-constructed
    // into `bytes` via FFI and the struct may exist in an uninitialized state before `init()`;
    // a blanket `Drop` would destruct uninit memory. Phase B should wrap init/destroy in an
    // RAII guard type once the Pin story is settled.
    /// # Safety
    /// `this` must point to a scope previously initialized via `init()` and not yet destroyed.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract.
        let this = unsafe { &mut *this };
        #[cfg(feature = "ci_assert")]
        debug_assert!(core::ptr::eq(this.location, &this.bytes[0]));
        // SAFETY: bytes was initialized by init().
        unsafe { TopExceptionScope__destruct(&mut this.bytes) };
        // this.bytes = undefined; — no-op in Rust
    }
}

/// Limited subset of TopExceptionScope functionality, for when you have a different way to detect
/// exceptions and you only need a TopExceptionScope to prove that you are checking exceptions correctly.
/// Gated by `cfg(feature = "ci_assert")`.
///
/// ```ignore
/// let mut scope = ExceptionValidationScope::uninit();
/// // these do nothing when ci_assert is off
/// scope.init(global, src!());
/// // defer ExceptionValidationScope::destroy(&mut scope);
///
/// let maybe_empty: JSValue = external_function(global, foo, bar, baz);
/// // does nothing when ci_assert is off
/// // with assertions on, this call serves as proof that you checked for an exception
/// scope.assert_exception_presence_matches(maybe_empty.is_empty());
/// // you decide whether to return JSError using the return value instead of the scope
/// return if value.is_empty() { Err(JsError::Thrown) } else { Ok(value) };
/// ```
pub struct ExceptionValidationScope {
    #[cfg(feature = "ci_assert")]
    scope: TopExceptionScope,
    #[cfg(not(feature = "ci_assert"))]
    scope: (),
}

impl ExceptionValidationScope {
    pub fn init(&mut self, global: &JSGlobalObject, src: SourceLocation) {
        #[cfg(feature = "ci_assert")]
        self.scope.init(global, src);
        #[cfg(not(feature = "ci_assert"))]
        let _ = (global, src);
    }

    /// Asserts there has not been any exception thrown.
    pub fn assert_no_exception(&mut self) {
        #[cfg(feature = "ci_assert")]
        self.scope.assert_no_exception();
    }

    /// Asserts that there is or is not an exception according to the value of `should_have_exception`.
    /// Prefer over `assert(scope.has_exception() == ...)` because if there is an unexpected exception,
    /// this function prints a trace of where it was thrown.
    pub fn assert_exception_presence_matches(&mut self, should_have_exception: bool) {
        #[cfg(feature = "ci_assert")]
        self.scope.assert_exception_presence_matches(should_have_exception);
        #[cfg(not(feature = "ci_assert"))]
        let _ = should_have_exception;
    }

    /// If no exception, returns.
    /// If termination exception, returns JSTerminated (so you can `?`)
    /// If non-termination exception, assertion failure.
    // TODO(port): narrow error set — Zig is `bun.JSTerminated!void`.
    pub fn assert_no_exception_except_termination(&mut self) -> Result<(), JsError> {
        #[cfg(feature = "ci_assert")]
        return self.scope.assert_no_exception_except_termination();
        #[cfg(not(feature = "ci_assert"))]
        Ok(())
    }

    /// Inconveniently named on purpose; this is only needed for some weird edge cases
    pub fn has_exception_or_false_when_assertions_are_disabled(&mut self) -> bool {
        #[cfg(feature = "ci_assert")]
        return self.scope.has_exception();
        #[cfg(not(feature = "ci_assert"))]
        false
    }

    /// # Safety
    /// `this` must point to a scope previously initialized via `init()` and not yet destroyed.
    pub unsafe fn destroy(this: *mut Self) {
        #[cfg(feature = "ci_assert")]
        unsafe { TopExceptionScope::destroy(&mut (*this).scope) };
        #[cfg(not(feature = "ci_assert"))]
        let _ = this;
    }
}

// TODO(port): move to jsc_sys
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
    fn TopExceptionScope__pureException(ptr: *mut [u8; SIZE]) -> *mut Exception;
    fn TopExceptionScope__clearException(ptr: *mut [u8; SIZE]);
    /// returns if an exception was already thrown, or if a trap (like another thread requesting
    /// termination) causes an exception to be thrown
    fn TopExceptionScope__exceptionIncludingTraps(ptr: *mut [u8; SIZE]) -> *mut Exception;
    fn TopExceptionScope__assertNoException(ptr: *mut [u8; SIZE]);
    fn TopExceptionScope__destruct(ptr: *mut [u8; SIZE]);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/TopExceptionScope.zig (216 lines)
//   confidence: medium
//   todos:      9
//   notes:      self-referential + in-place FFI construct; needs Pin/RAII wrapper in Phase B; ci_assert/asan cfg names need verification; NonNull<Exception> kept over &Exception (JSC heap cell)
// ──────────────────────────────────────────────────────────────────────────
