//! JSC bridges for S3 signing errors. The pure error-code/message tables
//! stay in `s3_signing/`; the `*JSGlobalObject`-taking variants live here.

use bun_core::String as BunString;
use bun_jsc::{AbortSignalRef, ErrorCode, JSGlobalObject, JSPromise, JSValue, JsError};
use bun_s3_signing::Error as SignError;
use bun_s3_signing::error::{self as s3_error, get_sign_error_message};

pub(crate) use s3_error::S3Error;

// `get_sign_error_message` returns `&'static [u8]` of ASCII literals; reinterpret as
// `&str` for the `format_args!`-taking `JSGlobalObject::err()` builder.
#[inline]
fn msg(bytes: &'static [u8]) -> &'static str {
    // SAFETY: every value returned by `get_sign_error_message` is an ASCII string literal.
    unsafe { core::str::from_utf8_unchecked(bytes) }
}

pub(crate) fn get_js_sign_error(err: SignError, global_this: &JSGlobalObject) -> JSValue {
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

pub(crate) fn throw_sign_error(err: SignError, global_this: &JSGlobalObject) -> JsError {
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

impl JSS3Error {
    fn init(code: &[u8], message: &[u8], path: Option<&[u8]>) -> Self {
        Self {
            // lets make sure we can reuse code and message and keep it service independent
            code: BunString::create_atom_if_possible(code),
            message: BunString::create_atom_if_possible(message),
            path: if let Some(p) = path {
                BunString::from_bytes(p)
            } else {
                BunString::EMPTY
            },
        }
    }

    fn to_error_instance(self, global: &JSGlobalObject) -> JSValue {
        S3Error__toErrorInstance(&self, global)
    }
}

// C++ side defines `SYSV_ABI JSC::EncodedJSValue` (S3Error.cpp).
bun_jsc::jsc_abi_extern! {
    // C++ copies the three `BunString` fields out and does not write through
    // `this`, so `&JSS3Error` (readonly) is sound.
    safe fn S3Error__toErrorInstance(this: &JSS3Error, global: &JSGlobalObject) -> JSValue;
}

pub(crate) fn s3_error_to_js(
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

/// What an operation rejects with: the reason of its `signal` once that fired, the S3
/// error otherwise.
pub(crate) fn s3_rejection(
    err: &S3Error,
    signal: Option<&AbortSignalRef>,
    global_object: &JSGlobalObject,
    path: Option<&[u8]>,
) -> JSValue {
    if let Some(signal) = signal {
        if signal.aborted() {
            return signal.js_reason(global_object);
        }
    }
    s3_error_to_js(err, global_object, path)
}

/// As [`s3_rejection`], with the async frames of `promise` on the S3 error.
pub(crate) fn s3_rejection_with_async_stack(
    err: &S3Error,
    signal: Option<&AbortSignalRef>,
    global_object: &JSGlobalObject,
    path: Option<&[u8]>,
    promise: &JSPromise,
) -> JSValue {
    if let Some(signal) = signal {
        if signal.aborted() {
            return signal.js_reason(global_object);
        }
    }
    s3_error_to_js_with_async_stack(err, global_object, path, promise)
}

/// `options.signal` of one operation. It is the operation's, never the handle's: not
/// part of `S3CredentialsWithOptions`.
pub(crate) fn get_signal(
    options: Option<JSValue>,
    global_object: &JSGlobalObject,
) -> bun_jsc::JsResult<Option<AbortSignalRef>> {
    let Some(opts) = options else {
        return Ok(None);
    };
    if !opts.is_object() {
        return Ok(None);
    }
    let Some(value) = opts.fast_get(global_object, bun_jsc::BuiltinName::signal)? else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    match bun_jsc::AbortSignal::ref_from_js(value) {
        Some(signal) => Ok(Some(signal)),
        None => {
            Err(global_object.throw_invalid_property_type_value(b"signal", b"AbortSignal", value))
        }
    }
}

/// A promise already rejected with the reason of `signal`, when that fired before the
/// operation started.
pub(crate) fn rejected_if_aborted(
    signal: Option<&AbortSignalRef>,
    global_object: &JSGlobalObject,
) -> Option<JSValue> {
    let signal = signal?;
    if !signal.aborted() {
        return None;
    }
    Some(JSPromise::rejected_promise(global_object, signal.js_reason(global_object)).to_js())
}
