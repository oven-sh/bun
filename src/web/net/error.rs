use bun_core::strings;
use bun_errno::SystemErrno;

macro_rules! net_errors {
    ($($variant:ident = $name:literal, $code:literal;)*) => {
        /// Those of Chromium, which apps compare with.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum NetError {
            $($variant = $code,)*
        }

        impl NetError {
            pub fn message(self) -> &'static str {
                match self {
                    $(NetError::$variant => concat!("net::ERR_", $name),)*
                }
            }

            pub const ALL: &[NetError] = &[$(NetError::$variant),*];

            /// Of `ERR_FAILED`
            pub fn number_of(code: &str) -> Option<i32> {
                Self::ALL.iter().find(|it| it.code() == code).map(|it| *it as i32)
            }

            pub fn from_number(code: i32) -> NetError {
                match code {
                    $($code => NetError::$variant,)*
                    _ => NetError::Failed,
                }
            }

            pub fn from_message(message: &[u8]) -> Option<NetError> {
                Some(match message.strip_prefix(b"net::ERR_")? {
                    $(it if it == $name.as_bytes() => NetError::$variant,)*
                    _ => NetError::Failed,
                })
            }
        }
    };
}

net_errors! {
    Failed = "FAILED", -2;
    Aborted = "ABORTED", -3;
    FileNotFound = "FILE_NOT_FOUND", -6;
    TimedOut = "TIMED_OUT", -7;
    Unexpected = "UNEXPECTED", -9;
    AccessDenied = "ACCESS_DENIED", -10;
    NotImplemented = "NOT_IMPLEMENTED", -11;
    InsufficientResources = "INSUFFICIENT_RESOURCES", -12;
    UploadFileChanged = "UPLOAD_FILE_CHANGED", -14;
    BlockedByClient = "BLOCKED_BY_CLIENT", -20;
    NetworkChanged = "NETWORK_CHANGED", -21;
    BlockedByResponse = "BLOCKED_BY_RESPONSE", -27;
    BlockedByCsp = "BLOCKED_BY_CSP", -30;
    BlockedByOrb = "BLOCKED_BY_ORB", -32;
    ConnectionClosed = "CONNECTION_CLOSED", -100;
    ConnectionReset = "CONNECTION_RESET", -101;
    ConnectionRefused = "CONNECTION_REFUSED", -102;
    NameNotResolved = "NAME_NOT_RESOLVED", -105;
    InternetDisconnected = "INTERNET_DISCONNECTED", -106;
    SslProtocolError = "SSL_PROTOCOL_ERROR", -107;
    SslClientAuthCertNeeded = "SSL_CLIENT_AUTH_CERT_NEEDED", -110;
    TunnelConnectionFailed = "TUNNEL_CONNECTION_FAILED", -111;
    SocksConnectionFailed = "SOCKS_CONNECTION_FAILED", -120;
    SocksConnectionHostUnreachable = "SOCKS_CONNECTION_HOST_UNREACHABLE", -121;
    ProxyAuthRequested = "PROXY_AUTH_REQUESTED", -127;
    ProxyConnectionFailed = "PROXY_CONNECTION_FAILED", -130;
    MandatoryProxyConfigurationFailed = "MANDATORY_PROXY_CONFIGURATION_FAILED", -131;
    CertCommonNameInvalid = "CERT_COMMON_NAME_INVALID", -200;
    CertDateInvalid = "CERT_DATE_INVALID", -201;
    CertAuthorityInvalid = "CERT_AUTHORITY_INVALID", -202;
    CertRevoked = "CERT_REVOKED", -206;
    InvalidUrl = "INVALID_URL", -300;
    UnknownUrlScheme = "UNKNOWN_URL_SCHEME", -302;
    InvalidRedirect = "INVALID_REDIRECT", -303;
    TooManyRedirects = "TOO_MANY_REDIRECTS", -310;
    UnsafeRedirect = "UNSAFE_REDIRECT", -311;
    UnsafePort = "UNSAFE_PORT", -312;
    UnexpectedProxyAuth = "UNEXPECTED_PROXY_AUTH", -323;
    RequestRangeNotSatisfiable = "REQUEST_RANGE_NOT_SATISFIABLE", -328;
    ContentDecodingFailed = "CONTENT_DECODING_FAILED", -330;
    NetworkIoSuspended = "NETWORK_IO_SUSPENDED", -331;
    NoSupportedProxies = "NO_SUPPORTED_PROXIES", -336;
    Http2ProtocolError = "HTTP2_PROTOCOL_ERROR", -337;
    ResponseHeadersMultipleContentLength = "RESPONSE_HEADERS_MULTIPLE_CONTENT_LENGTH", -346;
    ContentLengthMismatch = "CONTENT_LENGTH_MISMATCH", -354;
    InvalidHttpResponse = "INVALID_HTTP_RESPONSE", -370;
    TooManyRetries = "TOO_MANY_RETRIES", -375;
    CacheMiss = "CACHE_MISS", -400;
}

impl NetError {
    /// `ERR_FAILED`
    pub fn code(self) -> &'static str {
        &self.message()["net::".len()..]
    }

    /// Of an error of `fetch()` or `node:fs`.
    pub(crate) fn from_code(code: &[u8]) -> NetError {
        match code {
            b"ConnectionRefused" | b"ECONNREFUSED" | b"FailedToOpenSocket" => {
                NetError::ConnectionRefused
            }
            b"ECONNRESET" | b"EPIPE" => NetError::ConnectionReset,
            b"ConnectionClosed" => NetError::ConnectionClosed,
            b"ENOTFOUND" | b"EAI_AGAIN" => NetError::NameNotResolved,
            b"ENETUNREACH" | b"ENETDOWN" | b"EHOSTUNREACH" => NetError::InternetDisconnected,
            b"Timeout" | b"ETIMEDOUT" => NetError::TimedOut,
            b"ENOENT" | b"EISDIR" | b"ENOTDIR" => NetError::FileNotFound,
            b"EACCES" | b"EPERM" => NetError::AccessDenied,
            _ if [&b"CERT"[..], b"ISSUER", b"SIGNATURE"]
                .iter()
                .any(|it| strings::contains(code, it)) =>
            {
                NetError::of_certificate(code)
            }
            _ => NetError::Failed,
        }
    }

    pub(crate) fn of_errno(errno: SystemErrno) -> NetError {
        use SystemErrno::*;
        match errno {
            ECONNREFUSED => NetError::ConnectionRefused,
            ECONNRESET | EPIPE => NetError::ConnectionReset,
            ENETUNREACH | ENETDOWN | EHOSTUNREACH => NetError::InternetDisconnected,
            ETIMEDOUT => NetError::TimedOut,
            ENOENT | EISDIR | ENOTDIR => NetError::FileNotFound,
            EACCES | EPERM => NetError::AccessDenied,
            _ => NetError::Failed,
        }
    }

    pub(crate) fn of_certificate(name: &[u8]) -> NetError {
        let has = |part: &[u8]| strings::contains(name, part);
        if has(b"ALTNAME") || has(b"HOSTNAME") || has(b"IP_ADDRESS") {
            NetError::CertCommonNameInvalid
        } else if has(b"EXPIRED") || has(b"NOT_YET_VALID") {
            NetError::CertDateInvalid
        } else if has(b"REVOKED") {
            NetError::CertRevoked
        } else {
            NetError::CertAuthorityInvalid
        }
    }
}

impl From<bun_sys::Error> for NetError {
    fn from(error: bun_sys::Error) -> NetError {
        NetError::of_errno(error.into())
    }
}

pub type Result<T> = core::result::Result<T, NetError>;
