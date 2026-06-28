use bun_core::{self, Error, err};

pub struct ErrorCodeAndMessage {
    pub code: &'static [u8],
    pub message: &'static [u8],
}

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

/// Canonical S3 error code + message for an HTTP status. Used when the
/// response carries no XML error document (HEAD responses never have a body),
/// covering the statuses with exactly one canonical code in the S3 error table.
pub fn get_error_code_and_message_for_status(status: u32) -> Option<ErrorCodeAndMessage> {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
    Some(match status {
        403 => ErrorCodeAndMessage {
            code: b"AccessDenied",
            message: b"Access Denied",
        },
        404 => ErrorCodeAndMessage {
            code: b"NoSuchKey",
            message: b"The specified key does not exist.",
        },
        405 => ErrorCodeAndMessage {
            code: b"MethodNotAllowed",
            message: b"The specified method is not allowed against this resource.",
        },
        411 => ErrorCodeAndMessage {
            code: b"MissingContentLength",
            message: b"You must provide the Content-Length HTTP header.",
        },
        412 => ErrorCodeAndMessage {
            code: b"PreconditionFailed",
            message: b"At least one of the preconditions you specified did not hold.",
        },
        416 => ErrorCodeAndMessage {
            code: b"InvalidRange",
            message: b"The requested range is not satisfiable.",
        },
        500 => ErrorCodeAndMessage {
            code: b"InternalError",
            message: b"We encountered an internal error. Please try again.",
        },
        501 => ErrorCodeAndMessage {
            code: b"NotImplemented",
            message: b"A header you provided implies functionality that is not implemented.",
        },
        503 => ErrorCodeAndMessage {
            code: b"ServiceUnavailable",
            message: b"Service is unable to handle request.",
        },
        _ => return None,
    })
}

// `getJSSignError` / `throwSignError` live as extension-trait methods in the
// `*_jsc` crate (see PORTING.md §Idiom map).

// `code` / `message` are borrowed slices valid only for the duration of the
// callback invocation (callers parse them out of an XML response body). Field
// ownership is *not* `'static` — modeled with an explicit `<'a>`.
pub struct S3Error<'a> {
    pub code: &'a [u8],
    pub message: &'a [u8],
    // `toJS` / `toJSWithAsyncStack` are implemented as extension-trait methods
    // in the `*_jsc` crate.
}
