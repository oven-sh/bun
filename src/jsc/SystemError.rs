use core::ffi::c_int;
use core::fmt;

use bun_core::{OwnedString, String};

use crate::{JSGlobalObject, JSPromise, JSValue};

#[repr(C)]
#[derive(Clone)]
pub struct SystemError {
    pub errno: c_int,
    /// label for errno
    pub code: OwnedString,
    /// it is illegal to have an empty message
    pub message: OwnedString,
    pub path: OwnedString,
    pub syscall: OwnedString,
    pub hostname: OwnedString,
    /// MinInt = no file descriptor
    pub fd: c_int,
    pub dest: OwnedString,
}

impl Default for SystemError {
    fn default() -> Self {
        Self {
            errno: 0,
            code: OwnedString::default(),
            message: OwnedString::default(),
            path: OwnedString::default(),
            syscall: OwnedString::default(),
            hostname: OwnedString::default(),
            fd: c_int::MIN,
            dest: OwnedString::default(),
        }
    }
}

/// Reshape the T1 `bun_sys::SystemError` into the `#[repr(C)]` extern layout
/// C++ reads. Data (T1) is split from the JSC bridge (T6) — this `From` is
/// the canonical layering seam.
impl From<bun_sys::SystemError> for SystemError {
    fn from(e: bun_sys::SystemError) -> Self {
        let bun_sys::SystemError {
            errno,
            code,
            message,
            path,
            syscall,
            hostname,
            fd,
            dest,
        } = e;
        Self {
            errno: errno as c_int,
            code,
            message,
            path,
            syscall,
            hostname,
            fd: fd.unwrap_or(c_int::MIN),
            dest,
        }
    }
}

/// `core::result::Result` alias in Phase F so callers get `?` for free.
pub type Maybe<R> = core::result::Result<R, SystemError>;

// SAFETY (safe fn): `SystemError` is `#[repr(C)]` and read-only on the C++ side;
// `JSGlobalObject` is an opaque `UnsafeCell`-backed handle, so `&JSGlobalObject`
// is ABI-identical to a non-null `JSGlobalObject*` with write provenance.
unsafe extern "C" {
    safe fn SystemError__toErrorInstance(this: &SystemError, global: &JSGlobalObject) -> JSValue;
    safe fn SystemError__toErrorInstanceWithInfoObject(
        this: &SystemError,
        global: &JSGlobalObject,
    ) -> JSValue;
}

impl SystemError {
    #[inline]
    pub fn get_errno(&self) -> bun_sys::E {
        bun_sys::e_from_negated(self.errno)
    }

    /// Converts to a JS `Error`, consuming `self`. C++ only borrows the string
    /// fields; `Drop` releases them when `self` goes out of scope. `.clone()`
    /// first when two `Error`s are genuinely wanted.
    pub fn to_error_instance(self, global: &JSGlobalObject) -> JSValue {
        SystemError__toErrorInstance(&self, global)
    }

    /// Like `to_error_instance` but populates the error's stack trace with async
    /// frames from the given promise's await chain. Use when creating an error
    /// from native code at the top of the event loop (threadpool callback) to
    /// reject a promise — otherwise the error will have an empty stack.
    pub fn to_error_instance_with_async_stack(
        self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue {
        let value = self.to_error_instance(global);
        value.attach_async_stack_from_promise(global, promise);
        value
    }

    /// This constructs the ERR_SYSTEM_ERROR error object, which has an `info`
    /// property containing the details of the system error:
    ///
    /// SystemError [ERR_SYSTEM_ERROR]: A system error occurred: {syscall} returned {errno} ({message})
    /// {
    ///     name: "ERR_SYSTEM_ERROR",
    ///     info: {
    ///         errno: -{errno},
    ///         code: {code},        // string
    ///         message: {message},  // string
    ///         syscall: {syscall},  // string
    ///     },
    ///     errno: -{errno},
    ///     syscall: {syscall},
    /// }
    ///
    /// Before using this function, consider if the Node.js API it is
    /// implementing follows this convention. It is exclusively used
    /// to match the error code that `node:os` throws.
    pub fn to_error_instance_with_info_object(self, global: &JSGlobalObject) -> JSValue {
        SystemError__toErrorInstanceWithInfoObject(&self, global)
    }
}

/// `uws.us_bun_verify_error_t.toJS` — wrap a uSockets handshake-verify error
/// (`{code,reason}` C strings) as a JS `SystemError`.
///
/// LAYERING: lives here (not `bun_runtime::socket::uws_jsc`) so both
/// `bun_runtime` and `bun_sql_jsc` import the single canonical body — both
/// crates already depend on `bun_jsc` + `bun_uws`, and the body touches
/// nothing higher-tier.
pub fn verify_error_to_js(
    err: &bun_uws::us_bun_verify_error_t,
    global: &JSGlobalObject,
) -> crate::JsResult<JSValue> {
    let code: &[u8] = err.code_bytes();
    let reason: &[u8] = err.reason_bytes();

    let fallback = SystemError {
        code: String::clone_utf8(code).into(),
        message: String::clone_utf8(reason).into(),
        ..Default::default()
    };

    Ok(fallback.to_error_instance(global))
}

impl fmt::Display for SystemError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Note: `bun_core::pretty_fmt!` expands color tags in the format
        // string at compile time for both the colored and uncolored variants;
        // the runtime ANSI-support check selects between them via if/else.
        if !self.path.is_empty() {
            // TODO: remove this hardcoding
            if bun_core::Output::enable_ansi_colors_stderr() {
                write!(
                    f,
                    // bun.Output.prettyFmt("<r><red>{f}<r><d>:<r> <b>{f}<r>: {f} <d>({f}())<r>", true)
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> <b>{}<r>: {} <d>({}())<r>", true),
                    self.code, self.path, self.message, self.syscall,
                )
            } else {
                write!(
                    f,
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> <b>{}<r>: {} <d>({}())<r>", false),
                    self.code, self.path, self.message, self.syscall,
                )
            }
        } else {
            // TODO: remove this hardcoding
            if bun_core::Output::enable_ansi_colors_stderr() {
                write!(
                    f,
                    // bun.Output.prettyFmt("<r><red>{f}<r><d>:<r> {f} <d>({f}())<r>", true)
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> {} <d>({}())<r>", true),
                    self.code, self.message, self.syscall,
                )
            } else {
                write!(
                    f,
                    bun_core::pretty_fmt!("<r><red>{}<r><d>:<r> {} <d>({}())<r>", false),
                    self.code, self.message, self.syscall,
                )
            }
        }
    }
}
