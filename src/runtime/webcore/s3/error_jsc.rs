//! JSC bridges for `s3_signing/error.zig`. The pure error-code/message tables
//! stay in `s3_signing/`; the `*JSGlobalObject`-taking variants live here.

use bun_core::{err, Error};
use bun_jsc::{ErrorCode, JSGlobalObject, JSPromise, JSValue, JsError};
use bun_s3_signing::error::{self as s3_error, get_sign_error_message};
use bun_str::String as BunString;

pub use s3_error::S3Error;

pub fn get_js_sign_error(err: Error, global_this: &JSGlobalObject) -> JSValue {
    // TODO(port): verify `JSGlobalObject::ERR(code, fmt, args)` builder API name/shape in bun_jsc
    match err {
        e if e == err!("MissingCredentials") => global_this
            .ERR(ErrorCode::S3_MISSING_CREDENTIALS, get_sign_error_message(err!("MissingCredentials")))
            .to_js(),
        e if e == err!("InvalidMethod") => global_this
            .ERR(ErrorCode::S3_INVALID_METHOD, get_sign_error_message(err!("InvalidMethod")))
            .to_js(),
        e if e == err!("InvalidPath") => global_this
            .ERR(ErrorCode::S3_INVALID_PATH, get_sign_error_message(err!("InvalidPath")))
            .to_js(),
        e if e == err!("InvalidEndpoint") => global_this
            .ERR(ErrorCode::S3_INVALID_ENDPOINT, get_sign_error_message(err!("InvalidEndpoint")))
            .to_js(),
        e if e == err!("InvalidSessionToken") => global_this
            .ERR(ErrorCode::S3_INVALID_SESSION_TOKEN, get_sign_error_message(err!("InvalidSessionToken")))
            .to_js(),
        _ => global_this
            .ERR(ErrorCode::S3_INVALID_SIGNATURE, get_sign_error_message(err!("SignError")))
            .to_js(),
    }
}

pub fn throw_sign_error(err: Error, global_this: &JSGlobalObject) -> JsError {
    match err {
        e if e == err!("MissingCredentials") => global_this
            .ERR(ErrorCode::S3_MISSING_CREDENTIALS, get_sign_error_message(err!("MissingCredentials")))
            .throw(),
        e if e == err!("InvalidMethod") => global_this
            .ERR(ErrorCode::S3_INVALID_METHOD, get_sign_error_message(err!("InvalidMethod")))
            .throw(),
        e if e == err!("InvalidPath") => global_this
            .ERR(ErrorCode::S3_INVALID_PATH, get_sign_error_message(err!("InvalidPath")))
            .throw(),
        e if e == err!("InvalidEndpoint") => global_this
            .ERR(ErrorCode::S3_INVALID_ENDPOINT, get_sign_error_message(err!("InvalidEndpoint")))
            .throw(),
        e if e == err!("InvalidSessionToken") => global_this
            .ERR(ErrorCode::S3_INVALID_SESSION_TOKEN, get_sign_error_message(err!("InvalidSessionToken")))
            .throw(),
        _ => global_this
            .ERR(ErrorCode::S3_INVALID_SIGNATURE, get_sign_error_message(err!("SignError")))
            .throw(),
    }
}

#[repr(C)]
struct JSS3Error {
    code: BunString,
    message: BunString,
    path: BunString,
}

impl Default for JSS3Error {
    fn default() -> Self {
        Self {
            code: BunString::empty(),
            message: BunString::empty(),
            path: BunString::empty(),
        }
    }
}

impl JSS3Error {
    pub fn init(code: &[u8], message: &[u8], path: Option<&[u8]>) -> Self {
        Self {
            // lets make sure we can reuse code and message and keep it service independent
            code: BunString::create_atom_if_possible(code),
            message: BunString::create_atom_if_possible(message),
            path: if let Some(p) = path { BunString::init(p) } else { BunString::empty() },
        }
    }

    // Zig `deinit` only deref'd the three `bun.String` fields; `bun_str::String: Drop`
    // handles that automatically, so no explicit `Drop` impl is needed here.

    pub fn to_error_instance(self, global: &JSGlobalObject) -> JSValue {
        // `defer this.deinit()` → `self` is consumed and dropped at scope exit.
        // SAFETY: `self` lives for the duration of the FFI call; C++ does not retain the pointer.
        unsafe { S3Error__toErrorInstance(&self, global) }
    }
}

// TODO(port): move to <area>_sys
// TODO(port): callconv(jsc.conv) — "sysv64" on Windows-x64, "C" elsewhere; Rust cannot
// take a macro in ABI position, so Phase B must cfg-gate or wrap via bun_jsc helper.
unsafe extern "C" {
    fn S3Error__toErrorInstance(this: *const JSS3Error, global: *const JSGlobalObject) -> JSValue;
}

pub fn s3_error_to_js(err: &S3Error, global_object: &JSGlobalObject, path: Option<&[u8]>) -> JSValue {
    let value = JSS3Error::init(&err.code, &err.message, path).to_error_instance(global_object);
    debug_assert!(!global_object.has_exception());
    value
}

/// Like `to_js` but populates the error's stack trace with async frames from
/// the given promise's await chain. Use when rejecting from an HTTP
/// callback at the top of the event loop.
pub fn s3_error_to_js_with_async_stack(
    err: &S3Error,
    global_object: &JSGlobalObject,
    path: Option<&[u8]>,
    promise: &JSPromise,
) -> JSValue {
    let value = s3_error_to_js(err, global_object, path);
    value.attach_async_stack_from_promise(global_object, promise);
    value
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/error_jsc.zig (74 lines)
//   confidence: medium
//   todos:      3
//   notes:      ERR() builder API + jsc.conv extern ABI need Phase B wiring; S3Error field types (code/message) assumed &[u8]-coercible
// ──────────────────────────────────────────────────────────────────────────
