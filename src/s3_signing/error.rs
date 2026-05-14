use bun_core::{self, Error, err};

pub struct ErrorCodeAndMessage {
    pub code: &'static [u8],
    pub message: &'static [u8],
}

// PERF(port): originally a compile-time error parameter — demoted to runtime; profile in Phase B
// PORT NOTE: original return type was a sentinel-terminated literal; the only
// caller stores it into a plain byte slice, so the sentinel is dropped here.
pub fn get_sign_error_message(e: Error) -> &'static [u8] {
    match e {
        e if e == err!("MissingCredentials") => b"Missing S3 credentials. 'accessKeyId', 'secretAccessKey', 'bucket', and 'endpoint' are required",
        e if e == err!("InvalidMethod") => b"Method must be GET, PUT, DELETE or HEAD when using s3:// protocol",
        e if e == err!("InvalidPath") => b"Invalid S3 bucket, key combination",
        e if e == err!("InvalidEndpoint") => b"Invalid S3 endpoint",
        e if e == err!("InvalidSessionToken") => b"Invalid session token",
        _ => b"Failed to retrieve S3 content. Are the credentials correct?",
    }
}

pub fn get_sign_error_code_and_message(e: Error) -> ErrorCodeAndMessage {
    // keep error codes consistent for internal errors
    match e {
        e if e == err!("MissingCredentials") => ErrorCodeAndMessage {
            code: b"ERR_S3_MISSING_CREDENTIALS",
            message: get_sign_error_message(err!("MissingCredentials")),
        },
        e if e == err!("InvalidMethod") => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_METHOD",
            message: get_sign_error_message(err!("InvalidMethod")),
        },
        e if e == err!("InvalidPath") => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_PATH",
            message: get_sign_error_message(err!("InvalidPath")),
        },
        e if e == err!("InvalidEndpoint") => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_ENDPOINT",
            message: get_sign_error_message(err!("InvalidEndpoint")),
        },
        e if e == err!("InvalidSessionToken") => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_SESSION_TOKEN",
            message: get_sign_error_message(err!("InvalidSessionToken")),
        },
        _ => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_SIGNATURE",
            message: get_sign_error_message(err!("SignError")),
        },
    }
}

// PORT NOTE: the `getJSSignError` / `throwSignError` re-exports were dropped — in
// Rust these live as extension-trait methods in the `*_jsc` crate (see
// PORTING.md §Idiom map).

// PORT NOTE: `S3Error` carries borrowed slices that are valid only for the
// duration of the callback invocation (callers parse them out of an XML response
// body). Field ownership is *not* `'static` — modeled with an explicit `<'a>`.
pub struct S3Error<'a> {
    pub code: &'a [u8],
    pub message: &'a [u8],
    // PORT NOTE: `toJS` / `toJSWithAsyncStack` aliases were dropped —
    // implemented as extension-trait methods in the `*_jsc` crate.
}
