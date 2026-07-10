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
    #[error("{0}")]
    Cert(&'static str),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Hpack(#[from] crate::lshpack::HpackError),
}

impl Error {
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
            Self::Cert(name) => name,
            Self::Alloc(_) => "OutOfMemory",
            Self::Hpack(e) => <&'static str>::from(e),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
