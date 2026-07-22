use core::ffi::c_int;
use core::fmt;

use bun_core::String;

use crate::{JSGlobalObject, JSPromise, JSValue};

#[repr(C)]
pub struct SystemError {
    pub errno: c_int,
    /// label for errno
    pub code: String,
    /// it is illegal to have an empty message
    pub message: String,
    pub path: String,
    pub syscall: String,
    pub hostname: String,
    /// MinInt = no file descriptor
    pub fd: c_int,
    pub dest: String,
}

impl Default for SystemError {
    fn default() -> Self {
        Self {
            errno: 0,
            code: String::default(),
            message: String::default(),
            path: String::default(),
            syscall: String::default(),
            hostname: String::default(),
            fd: c_int::MIN,
            dest: String::default(),
        }
    }
}

/// Reshape the T1 `bun_sys::SystemError` (non-`#[repr(C)]`, different field
/// order) into the `#[repr(C)]` extern layout C++ reads. Data (T1) is split
/// from the JSC bridge (T6) — this `From` is the canonical layering seam.
impl From<bun_sys::SystemError> for SystemError {
    fn from(e: bun_sys::SystemError) -> Self {
        Self {
            errno: e.errno as c_int,
            code: e.code,
            message: e.message,
            path: e.path,
            syscall: e.syscall,
            hostname: e.hostname,
            fd: e.fd as c_int,
            dest: e.dest,
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

    /// Releases one ref of every string field. Prefer letting
    /// [`to_error_instance`](Self::to_error_instance) consume the value: this
    /// is only for the paths that build no JS error at all.
    pub fn deref(self) {
        self.path.deref();
        self.code.deref();
        self.message.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }

    pub(crate) fn ref_(&mut self) {
        self.path.ref_();
        self.code.ref_();
        self.message.ref_();
        self.syscall.ref_();
        self.hostname.ref_();
        self.dest.ref_();
    }

    /// Bitwise-copy + bump every `bun_core::String` ref.
    /// `bun_core::String` has no `Clone` impl (intrusive WTF refcount), so
    /// `#[derive(Clone)]` is unavailable; this is the manual equivalent.
    pub fn dupe(&self) -> SystemError {
        // SAFETY: `SystemError` is `#[repr(C)]` and every field is either `c_int`
        // (trivially copyable) or `bun_core::String` — a `#[repr(C)]` smart-ptr
        // whose bitwise copy is sound provided we immediately bump each ref
        // (preventing a double-free on drop).
        let mut v: SystemError = unsafe { core::ptr::read(self) };
        v.ref_();
        v
    }

    /// Converts to a JS `Error`, consuming `self`: each string field's ref is
    /// released here, so converting the same `SystemError` twice would free
    /// strings the first `Error` still holds. Take `self` by value so the
    /// compiler rejects that; call [`dupe`](Self::dupe) when two `Error`s are
    /// genuinely wanted.
    pub fn to_error_instance(self, global: &JSGlobalObject) -> JSValue {
        let result = SystemError__toErrorInstance(&self, global);
        self.deref();
        result
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
        let result = SystemError__toErrorInstanceWithInfoObject(&self, global);
        self.deref();
        result
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
        code: String::clone_utf8(code),
        message: String::clone_utf8(reason),
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
