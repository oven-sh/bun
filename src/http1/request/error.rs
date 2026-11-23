/// The numbers are those of `HttpParserError` in `src/js/node/_http_server.ts`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestError {
    InvalidChunkedEncoding = 1,
    InvalidContentLength = 2,
    InvalidTransferEncoding = 3,
    MissingHost = 4,
    InvalidRequest = 5,
    HeadTooLarge = 6,
    InvalidVersion = 7,
    InvalidMethod = 9,
    InvalidField = 10,
    LfExpected = 11,
    ChunkExtensionsTooLarge = 12,
    Http2Preface = 13,
    ClosedConnection = 14,
    TrailersTooLarge = 15,
    ChunkTerminatorExpected = 16,
    ContentLengthInTrailers = 17,
    InvalidTarget = 18,
}

impl RequestError {
    pub fn response(self) -> &'static [u8] {
        match self {
            Self::InvalidVersion => {
                b"HTTP/1.1 505 HTTP Version Not Supported\r\nConnection: close\r\n\r\n"
            }
            Self::HeadTooLarge | Self::TrailersTooLarge => {
                b"HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n"
            }
            Self::ChunkExtensionsTooLarge => {
                b"HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n"
            }
            _ => b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
        }
    }
}
