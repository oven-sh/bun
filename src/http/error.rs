#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("CompressionFailed")]
    CompressionFailed,
    #[error("Aborted")]
    Aborted,
    #[error("WriteFailed")]
    WriteFailed,
    #[error("HTTP2RefusedStream")]
    HTTP2RefusedStream,
    #[error("HTTP2ContentLengthMismatch")]
    HTTP2ContentLengthMismatch,
    #[error("HTTP2FrameSizeError")]
    HTTP2FrameSizeError,
    #[error("HTTP2ProtocolError")]
    HTTP2ProtocolError,
    #[error("HTTP2FlowControlError")]
    HTTP2FlowControlError,
    #[error("HTTP2EnhanceYourCalm")]
    HTTP2EnhanceYourCalm,
    #[error("HTTP2HeaderListTooLarge")]
    HTTP2HeaderListTooLarge,
    #[error("HTTP2StreamReset")]
    HTTP2StreamReset,
    #[error("HTTP2GoAway")]
    HTTP2GoAway,
    #[error("HTTP2CompressionError")]
    HTTP2CompressionError,
    #[error("Timeout")]
    Timeout,
    #[error("AbortedBeforeConnecting")]
    AbortedBeforeConnecting,
    #[error("InvalidURL")]
    InvalidURL,
    #[error("ERR_TLS_CERT_ALTNAME_INVALID")]
    ERR_TLS_CERT_ALTNAME_INVALID,
    #[error("ClientAborted")]
    ClientAborted,
    #[error("HTTP2Unsupported")]
    HTTP2Unsupported,
    #[error("ConnectionClosed")]
    ConnectionClosed,
    #[error("DNSResolveFailed")]
    DNSResolveFailed,
    #[error("ConnectionRefused")]
    ConnectionRefused,
    #[error("TooManyRedirects")]
    TooManyRedirects,
    #[error("HTTP3Unsupported")]
    HTTP3Unsupported,
    #[error("ResponseHeadersTooLarge")]
    ResponseHeadersTooLarge,
    #[error("UnrequestedUpgrade")]
    UnrequestedUpgrade,
    #[error("UnexpectedData")]
    UnexpectedData,
    #[error("InvalidHTTPResponse")]
    InvalidHTTPResponse,
    #[error("InvalidContentLength")]
    InvalidContentLength,
    #[error("UnsupportedTransferEncoding")]
    UnsupportedTransferEncoding,
    #[error("RequestBodyNotReusable")]
    RequestBodyNotReusable,
    #[error("UnsupportedRedirectProtocol")]
    UnsupportedRedirectProtocol,
    #[error("RedirectURLTooLong")]
    RedirectURLTooLong,
    #[error("RedirectURLInvalid")]
    RedirectURLInvalid,
    #[error("InvalidRedirectURL")]
    InvalidRedirectURL,
    #[error("UnexpectedRedirect")]
    UnexpectedRedirect,
    #[error("ShortRead")]
    ShortRead,
    #[error("WantRead")]
    WantRead,
    #[error("WantWrite")]
    WantWrite,
    #[error("HTTP3HandshakeFailed")]
    HTTP3HandshakeFailed,
    #[error("HTTP3ProtocolError")]
    HTTP3ProtocolError,
    #[error("Clear")]
    Clear,
    #[error("HTTP3HeaderEncodingError")]
    HTTP3HeaderEncodingError,
    #[error("DNSResolutionFailed")]
    DNSResolutionFailed,
    #[error("HTTP3StreamReset")]
    HTTP3StreamReset,
    #[error("HTTP3ContentLengthMismatch")]
    HTTP3ContentLengthMismatch,
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error("UnsupportedProxyProtocol")]
    UnsupportedProxyProtocol,
    #[error(transparent)]
    Cert(#[from] CertError),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Hpack(#[from] crate::lshpack::HpackError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Zlib(bun_zlib::ZlibError),
    #[error(transparent)]
    Brotli(bun_brotli::Error),
    #[error(transparent)]
    Zstd(bun_zstd::ZstdError),
    #[error(transparent)]
    Picohttp(bun_picohttp::ParseResponseError),
}

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum CertError {
    #[error("OK")]
    OK,
    #[error("UNABLE_TO_GET_ISSUER_CERT")]
    UNABLE_TO_GET_ISSUER_CERT,
    #[error("UNABLE_TO_GET_CRL")]
    UNABLE_TO_GET_CRL,
    #[error("UNABLE_TO_DECRYPT_CERT_SIGNATURE")]
    UNABLE_TO_DECRYPT_CERT_SIGNATURE,
    #[error("UNABLE_TO_DECRYPT_CRL_SIGNATURE")]
    UNABLE_TO_DECRYPT_CRL_SIGNATURE,
    #[error("UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY")]
    UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY,
    #[error("CERT_SIGNATURE_FAILURE")]
    CERT_SIGNATURE_FAILURE,
    #[error("CRL_SIGNATURE_FAILURE")]
    CRL_SIGNATURE_FAILURE,
    #[error("CERT_NOT_YET_VALID")]
    CERT_NOT_YET_VALID,
    #[error("CERT_HAS_EXPIRED")]
    CERT_HAS_EXPIRED,
    #[error("CRL_NOT_YET_VALID")]
    CRL_NOT_YET_VALID,
    #[error("CRL_HAS_EXPIRED")]
    CRL_HAS_EXPIRED,
    #[error("ERROR_IN_CERT_NOT_BEFORE_FIELD")]
    ERROR_IN_CERT_NOT_BEFORE_FIELD,
    #[error("ERROR_IN_CERT_NOT_AFTER_FIELD")]
    ERROR_IN_CERT_NOT_AFTER_FIELD,
    #[error("ERROR_IN_CRL_LAST_UPDATE_FIELD")]
    ERROR_IN_CRL_LAST_UPDATE_FIELD,
    #[error("ERROR_IN_CRL_NEXT_UPDATE_FIELD")]
    ERROR_IN_CRL_NEXT_UPDATE_FIELD,
    #[error("OUT_OF_MEM")]
    OUT_OF_MEM,
    #[error("DEPTH_ZERO_SELF_SIGNED_CERT")]
    DEPTH_ZERO_SELF_SIGNED_CERT,
    #[error("SELF_SIGNED_CERT_IN_CHAIN")]
    SELF_SIGNED_CERT_IN_CHAIN,
    #[error("UNABLE_TO_GET_ISSUER_CERT_LOCALLY")]
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
    #[error("UNABLE_TO_VERIFY_LEAF_SIGNATURE")]
    UNABLE_TO_VERIFY_LEAF_SIGNATURE,
    #[error("CERT_CHAIN_TOO_LONG")]
    CERT_CHAIN_TOO_LONG,
    #[error("CERT_REVOKED")]
    CERT_REVOKED,
    #[error("INVALID_CA")]
    INVALID_CA,
    #[error("PATH_LENGTH_EXCEEDED")]
    PATH_LENGTH_EXCEEDED,
    #[error("INVALID_PURPOSE")]
    INVALID_PURPOSE,
    #[error("CERT_UNTRUSTED")]
    CERT_UNTRUSTED,
    #[error("CERT_REJECTED")]
    CERT_REJECTED,
    #[error("SUBJECT_ISSUER_MISMATCH")]
    SUBJECT_ISSUER_MISMATCH,
    #[error("AKID_SKID_MISMATCH")]
    AKID_SKID_MISMATCH,
    #[error("AKID_ISSUER_SERIAL_MISMATCH")]
    AKID_ISSUER_SERIAL_MISMATCH,
    #[error("KEYUSAGE_NO_CERTSIGN")]
    KEYUSAGE_NO_CERTSIGN,
    #[error("UNABLE_TO_GET_CRL_ISSUER")]
    UNABLE_TO_GET_CRL_ISSUER,
    #[error("UNHANDLED_CRITICAL_EXTENSION")]
    UNHANDLED_CRITICAL_EXTENSION,
    #[error("KEYUSAGE_NO_CRL_SIGN")]
    KEYUSAGE_NO_CRL_SIGN,
    #[error("UNHANDLED_CRITICAL_CRL_EXTENSION")]
    UNHANDLED_CRITICAL_CRL_EXTENSION,
    #[error("INVALID_NON_CA")]
    INVALID_NON_CA,
    #[error("PROXY_PATH_LENGTH_EXCEEDED")]
    PROXY_PATH_LENGTH_EXCEEDED,
    #[error("KEYUSAGE_NO_DIGITAL_SIGNATURE")]
    KEYUSAGE_NO_DIGITAL_SIGNATURE,
    #[error("PROXY_CERTIFICATES_NOT_ALLOWED")]
    PROXY_CERTIFICATES_NOT_ALLOWED,
    #[error("INVALID_EXTENSION")]
    INVALID_EXTENSION,
    #[error("INVALID_POLICY_EXTENSION")]
    INVALID_POLICY_EXTENSION,
    #[error("NO_EXPLICIT_POLICY")]
    NO_EXPLICIT_POLICY,
    #[error("DIFFERENT_CRL_SCOPE")]
    DIFFERENT_CRL_SCOPE,
    #[error("UNSUPPORTED_EXTENSION_FEATURE")]
    UNSUPPORTED_EXTENSION_FEATURE,
    #[error("UNNESTED_RESOURCE")]
    UNNESTED_RESOURCE,
    #[error("PERMITTED_VIOLATION")]
    PERMITTED_VIOLATION,
    #[error("EXCLUDED_VIOLATION")]
    EXCLUDED_VIOLATION,
    #[error("SUBTREE_MINMAX")]
    SUBTREE_MINMAX,
    #[error("APPLICATION_VERIFICATION")]
    APPLICATION_VERIFICATION,
    #[error("UNSUPPORTED_CONSTRAINT_TYPE")]
    UNSUPPORTED_CONSTRAINT_TYPE,
    #[error("UNSUPPORTED_CONSTRAINT_SYNTAX")]
    UNSUPPORTED_CONSTRAINT_SYNTAX,
    #[error("UNSUPPORTED_NAME_SYNTAX")]
    UNSUPPORTED_NAME_SYNTAX,
    #[error("CRL_PATH_VALIDATION_ERROR")]
    CRL_PATH_VALIDATION_ERROR,
    #[error("SUITE_B_INVALID_VERSION")]
    SUITE_B_INVALID_VERSION,
    #[error("SUITE_B_INVALID_ALGORITHM")]
    SUITE_B_INVALID_ALGORITHM,
    #[error("SUITE_B_INVALID_CURVE")]
    SUITE_B_INVALID_CURVE,
    #[error("SUITE_B_INVALID_SIGNATURE_ALGORITHM")]
    SUITE_B_INVALID_SIGNATURE_ALGORITHM,
    #[error("SUITE_B_LOS_NOT_ALLOWED")]
    SUITE_B_LOS_NOT_ALLOWED,
    #[error("SUITE_B_CANNOT_SIGN_P_384_WITH_P_256")]
    SUITE_B_CANNOT_SIGN_P_384_WITH_P_256,
    #[error("HOSTNAME_MISMATCH")]
    HOSTNAME_MISMATCH,
    #[error("EMAIL_MISMATCH")]
    EMAIL_MISMATCH,
    #[error("IP_ADDRESS_MISMATCH")]
    IP_ADDRESS_MISMATCH,
    #[error("INVALID_CALL")]
    INVALID_CALL,
    #[error("STORE_LOOKUP")]
    STORE_LOOKUP,
    #[error("NAME_CONSTRAINTS_WITHOUT_SANS")]
    NAME_CONSTRAINTS_WITHOUT_SANS,
    #[error("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR")]
    UNKNOWN_CERTIFICATE_VERIFICATION_ERROR,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::CompressionFailed => "CompressionFailed",
            Self::Aborted => "Aborted",
            Self::WriteFailed => "WriteFailed",
            Self::HTTP2RefusedStream => "HTTP2RefusedStream",
            Self::HTTP2ContentLengthMismatch => "HTTP2ContentLengthMismatch",
            Self::HTTP2FrameSizeError => "HTTP2FrameSizeError",
            Self::HTTP2ProtocolError => "HTTP2ProtocolError",
            Self::HTTP2FlowControlError => "HTTP2FlowControlError",
            Self::HTTP2EnhanceYourCalm => "HTTP2EnhanceYourCalm",
            Self::HTTP2HeaderListTooLarge => "HTTP2HeaderListTooLarge",
            Self::HTTP2StreamReset => "HTTP2StreamReset",
            Self::HTTP2GoAway => "HTTP2GoAway",
            Self::HTTP2CompressionError => "HTTP2CompressionError",
            Self::Timeout => "Timeout",
            Self::AbortedBeforeConnecting => "AbortedBeforeConnecting",
            Self::InvalidURL => "InvalidURL",
            Self::ERR_TLS_CERT_ALTNAME_INVALID => "ERR_TLS_CERT_ALTNAME_INVALID",
            Self::ClientAborted => "ClientAborted",
            Self::HTTP2Unsupported => "HTTP2Unsupported",
            Self::ConnectionClosed => "ConnectionClosed",
            Self::DNSResolveFailed => "DNSResolveFailed",
            Self::ConnectionRefused => "ConnectionRefused",
            Self::TooManyRedirects => "TooManyRedirects",
            Self::HTTP3Unsupported => "HTTP3Unsupported",
            Self::ResponseHeadersTooLarge => "ResponseHeadersTooLarge",
            Self::UnrequestedUpgrade => "UnrequestedUpgrade",
            Self::UnexpectedData => "UnexpectedData",
            Self::InvalidHTTPResponse => "InvalidHTTPResponse",
            Self::InvalidContentLength => "InvalidContentLength",
            Self::UnsupportedTransferEncoding => "UnsupportedTransferEncoding",
            Self::RequestBodyNotReusable => "RequestBodyNotReusable",
            Self::UnsupportedRedirectProtocol => "UnsupportedRedirectProtocol",
            Self::RedirectURLTooLong => "RedirectURLTooLong",
            Self::RedirectURLInvalid => "RedirectURLInvalid",
            Self::InvalidRedirectURL => "InvalidRedirectURL",
            Self::UnexpectedRedirect => "UnexpectedRedirect",
            Self::ShortRead => "ShortRead",
            Self::WantRead => "WantRead",
            Self::WantWrite => "WantWrite",
            Self::HTTP3HandshakeFailed => "HTTP3HandshakeFailed",
            Self::HTTP3ProtocolError => "HTTP3ProtocolError",
            Self::Clear => "Clear",
            Self::HTTP3HeaderEncodingError => "HTTP3HeaderEncodingError",
            Self::DNSResolutionFailed => "DNSResolutionFailed",
            Self::HTTP3StreamReset => "HTTP3StreamReset",
            Self::HTTP3ContentLengthMismatch => "HTTP3ContentLengthMismatch",
            Self::FailedToOpenSocket => "FailedToOpenSocket",
            Self::UnsupportedProxyProtocol => "UnsupportedProxyProtocol",
            Self::Cert(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Hpack(e) => <&'static str>::from(e),
            Self::Core(e) => e.name(),
            Self::Sys(e) => <&'static str>::from(e),
            Self::Zlib(e) => <&'static str>::from(e),
            Self::Brotli(e) => e.name(),
            Self::Zstd(e) => <&'static str>::from(e),
            Self::Picohttp(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_zlib::ZlibError> for Error {
    fn from(e: bun_zlib::ZlibError) -> Self {
        match e {
            bun_zlib::ZlibError::ShortRead => Error::ShortRead,
            _ => Error::Zlib(e),
        }
    }
}

impl From<bun_brotli::Error> for Error {
    fn from(e: bun_brotli::Error) -> Self {
        match e {
            bun_brotli::Error::ShortRead => Error::ShortRead,
            _ => Error::Brotli(e),
        }
    }
}

impl From<bun_zstd::ZstdError> for Error {
    fn from(e: bun_zstd::ZstdError) -> Self {
        match e {
            bun_zstd::ZstdError::ShortRead => Error::ShortRead,
            _ => Error::Zstd(e),
        }
    }
}

impl From<bun_uws::ConnectError> for Error {
    fn from(_: bun_uws::ConnectError) -> Self {
        Error::FailedToOpenSocket
    }
}

impl From<bun_picohttp::ParseResponseError> for Error {
    fn from(e: bun_picohttp::ParseResponseError) -> Self {
        match e {
            bun_picohttp::ParseResponseError::ShortRead => Error::ShortRead,
            _ => Error::Picohttp(e),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
