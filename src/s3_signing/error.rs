use core::num::NonZeroU16;

use crate::Error;

pub struct ErrorCodeAndMessage {
    pub code: &'static [u8],
    pub message: &'static [u8],
}

pub fn get_sign_error_message(e: Error) -> &'static [u8] {
    match e {
        Error::MissingCredentials => b"Missing S3 credentials. 'accessKeyId', 'secretAccessKey', 'bucket', and 'endpoint' are required",
        Error::InvalidMethod => b"Method must be GET, PUT, DELETE or HEAD when using s3:// protocol",
        Error::InvalidPath => b"Invalid S3 bucket, key combination",
        Error::InvalidEndpoint => b"Invalid S3 endpoint",
        Error::InvalidSessionToken => b"Invalid session token",
        _ => b"Failed to retrieve S3 content. Are the credentials correct?",
    }
}

pub fn get_sign_error_code_and_message(e: Error) -> ErrorCodeAndMessage {
    // keep error codes consistent for internal errors
    match e {
        Error::MissingCredentials => ErrorCodeAndMessage {
            code: b"ERR_S3_MISSING_CREDENTIALS",
            message: get_sign_error_message(Error::MissingCredentials),
        },
        Error::InvalidMethod => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_METHOD",
            message: get_sign_error_message(Error::InvalidMethod),
        },
        Error::InvalidPath => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_PATH",
            message: get_sign_error_message(Error::InvalidPath),
        },
        Error::InvalidEndpoint => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_ENDPOINT",
            message: get_sign_error_message(Error::InvalidEndpoint),
        },
        Error::InvalidSessionToken => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_SESSION_TOKEN",
            message: get_sign_error_message(Error::InvalidSessionToken),
        },
        _ => ErrorCodeAndMessage {
            code: b"ERR_S3_INVALID_SIGNATURE",
            message: get_sign_error_message(Error::SignError),
        },
    }
}

// `getJSSignError` / `throwSignError` live as extension-trait methods in the
// `*_jsc` crate (see PORTING.md §Idiom map).

// `code` / `message` are borrowed slices valid only for the duration of the
// callback invocation (callers parse them out of an XML response body). Field
// ownership is *not* `'static` — modeled with an explicit `<'a>`.
pub struct S3Error<'a> {
    pub code: &'a [u8],
    pub message: &'a [u8],
    /// Private: every error is built through `from_response` or `local`, so a
    /// new site has to say whether it reports a response.
    status: Option<NonZeroU16>,
    // `toJS` / `toJSWithAsyncStack` are implemented as extension-trait methods
    // in the `*_jsc` crate.
}

impl<'a> S3Error<'a> {
    /// An error that Bun raises itself. It has no status.
    pub const fn local(code: &'a [u8], message: &'a [u8]) -> Self {
        Self {
            code,
            message,
            status: None,
        }
    }

    /// An error that reports a response with this HTTP status (0: none arrived).
    /// Only an error status is kept. The default error handlers of web
    /// frameworks answer with an error's `status`: a 2xx there reads as a
    /// success (a request can fail under a 200), and browsers cache a 301.
    pub fn from_response(code: &'a [u8], message: &'a [u8], status: u32) -> Self {
        let status = match status {
            400..=599 => u16::try_from(status).ok().and_then(NonZeroU16::new),
            _ => None,
        };
        Self {
            code,
            message,
            status,
        }
    }

    /// The HTTP status of the response the error came with, when it is 400 to 599.
    pub const fn status(&self) -> Option<NonZeroU16> {
        self.status
    }

    /// The same error under another code and message.
    pub fn with_text(self, code: &'a [u8], message: &'a [u8]) -> Self {
        Self {
            code,
            message,
            status: self.status,
        }
    }
}
