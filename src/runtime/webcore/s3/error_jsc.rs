//! JSC bridges for S3 signing errors. The pure error-code/message tables
//! stay in `s3_signing/`; the `*JSGlobalObject`-taking variants live here.

use bun_core::String as BunString;
use bun_jsc::{ErrorCode, JSGlobalObject, JSPromise, JSValue, JsError};
use bun_s3_signing::Error as SignError;
use bun_s3_signing::error::{self as s3_error, get_sign_error_message};

pub use s3_error::S3Error;

// `get_sign_error_message` returns `&'static [u8]` of ASCII literals; reinterpret as
// `&str` for the `format_args!`-taking `JSGlobalObject::err()` builder.
#[inline]
fn msg(bytes: &'static [u8]) -> &'static str {
    // SAFETY: every value returned by `get_sign_error_message` is an ASCII string literal.
    unsafe { core::str::from_utf8_unchecked(bytes) }
}

pub fn get_js_sign_error(err: SignError, global_this: &JSGlobalObject) -> JSValue {
    match err {
        SignError::MissingCredentials => global_this
            .err(
                ErrorCode::S3_MISSING_CREDENTIALS,
                format_args!(
                    "{}",
                    msg(get_sign_error_message(SignError::MissingCredentials))
                ),
            )
            .to_js(),
        SignError::InvalidMethod => global_this
            .err(
                ErrorCode::S3_INVALID_METHOD,
                format_args!("{}", msg(get_sign_error_message(SignError::InvalidMethod))),
            )
            .to_js(),
        SignError::InvalidPath => global_this
            .err(
                ErrorCode::S3_INVALID_PATH,
                format_args!("{}", msg(get_sign_error_message(SignError::InvalidPath))),
            )
            .to_js(),
        SignError::InvalidEndpoint => global_this
            .err(
                ErrorCode::S3_INVALID_ENDPOINT,
                format_args!(
                    "{}",
                    msg(get_sign_error_message(SignError::InvalidEndpoint))
                ),
            )
            .to_js(),
        SignError::InvalidSessionToken => global_this
            .err(
                ErrorCode::S3_INVALID_SESSION_TOKEN,
                format_args!(
                    "{}",
                    msg(get_sign_error_message(SignError::InvalidSessionToken))
                ),
            )
            .to_js(),
        _ => global_this
            .err(
                ErrorCode::S3_INVALID_SIGNATURE,
                format_args!("{}", msg(get_sign_error_message(SignError::SignError))),
            )
            .to_js(),
    }
}

pub fn throw_sign_error(err: SignError, global_this: &JSGlobalObject) -> JsError {
    match err {
        SignError::MissingCredentials => global_this
            .err(
                ErrorCode::S3_MISSING_CREDENTIALS,
                format_args!(
                    "{}",
                    msg(get_sign_error_message(SignError::MissingCredentials))
                ),
            )
            .throw(),
        SignError::InvalidMethod => global_this
            .err(
                ErrorCode::S3_INVALID_METHOD,
                format_args!("{}", msg(get_sign_error_message(SignError::InvalidMethod))),
            )
            .throw(),
        SignError::InvalidPath => global_this
            .err(
                ErrorCode::S3_INVALID_PATH,
                format_args!("{}", msg(get_sign_error_message(SignError::InvalidPath))),
            )
            .throw(),
        SignError::InvalidEndpoint => global_this
            .err(
                ErrorCode::S3_INVALID_ENDPOINT,
                format_args!(
                    "{}",
                    msg(get_sign_error_message(SignError::InvalidEndpoint))
                ),
            )
            .throw(),
        SignError::InvalidSessionToken => global_this
            .err(
                ErrorCode::S3_INVALID_SESSION_TOKEN,
                format_args!(
                    "{}",
                    msg(get_sign_error_message(SignError::InvalidSessionToken))
                ),
            )
            .throw(),
        _ => global_this
            .err(
                ErrorCode::S3_INVALID_SIGNATURE,
                format_args!("{}", msg(get_sign_error_message(SignError::SignError))),
            )
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
    pub(crate) fn init(code: &[u8], message: &[u8], path: Option<&[u8]>) -> Self {
        Self {
            // lets make sure we can reuse code and message and keep it service independent
            code: BunString::create_atom_if_possible(code),
            message: BunString::create_atom_if_possible(message),
            path: if let Some(p) = path {
                BunString::init(p)
            } else {
                BunString::empty()
            },
        }
    }

    // The three `bun_core::String` fields deref themselves via `Drop`, so no
    // explicit `Drop` impl is needed here.

    pub(crate) fn to_error_instance(self, global: &JSGlobalObject) -> JSValue {
        // `defer this.deinit()` → `self` is consumed and dropped at scope exit.
        S3Error__toErrorInstance(&self, global)
    }
}

// C++ side defines `SYSV_ABI JSC::EncodedJSValue` (S3Error.cpp).
bun_jsc::jsc_abi_extern! {
    // C++ copies the three `BunString` fields out and does not write through
    // `this`, so `&JSS3Error` (readonly) is sound.
    safe fn S3Error__toErrorInstance(this: &JSS3Error, global: &JSGlobalObject) -> JSValue;
}

pub fn s3_error_to_js(
    err: &S3Error,
    global_object: &JSGlobalObject,
    path: Option<&[u8]>,
) -> JSValue {
    let value = JSS3Error::init(err.code, err.message, path).to_error_instance(global_object);
    debug_assert!(!global_object.has_exception());
    value
}

/// Like `to_js` but populates the error's stack trace with async frames from
/// the given promise's await chain. Use when rejecting from an HTTP
/// callback at the top of the event loop.
pub(crate) fn s3_error_to_js_with_async_stack(
    err: &S3Error,
    global_object: &JSGlobalObject,
    path: Option<&[u8]>,
    promise: &JSPromise,
) -> JSValue {
    let value = s3_error_to_js(err, global_object, path);
    value.attach_async_stack_from_promise(global_object, promise);
    value
}

/// Method-syntax extension over [`S3Error`] so call sites in `S3File` /
/// `blob::Store` can use the spelling `err.to_js_with_async_stack(…)`.
/// Forwards to the free fn above; returns `JsResult` because the consuming
/// `JSPromiseStrong::reject` takes `JsResult<JSValue>`.
pub trait S3ErrorJsc {
    fn to_js(&self, global_object: &JSGlobalObject, path: Option<&[u8]>) -> JSValue;
    fn to_js_with_async_stack(
        &self,
        global_object: &JSGlobalObject,
        path: Option<&[u8]>,
        promise: &JSPromise,
    ) -> bun_jsc::JsResult<JSValue>;
}
impl S3ErrorJsc for S3Error<'_> {
    #[inline]
    fn to_js(&self, global_object: &JSGlobalObject, path: Option<&[u8]>) -> JSValue {
        s3_error_to_js(self, global_object, path)
    }
    #[inline]
    fn to_js_with_async_stack(
        &self,
        global_object: &JSGlobalObject,
        path: Option<&[u8]>,
        promise: &JSPromise,
    ) -> bun_jsc::JsResult<JSValue> {
        Ok(s3_error_to_js_with_async_stack(
            self,
            global_object,
            path,
            promise,
        ))
    }
}
