macro_rules! parse_errors {
    ($($code:literal { $($name:ident => $reason:literal,)+ })+) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum ParseError {
            $($($name,)+)+
        }

        impl ParseError {
            /// `err.code` in `node:http`.
            pub fn code(self) -> &'static str {
                match self {
                    $($(Self::$name)|+ => $code,)+
                }
            }

            /// `err.reason` in `node:http`.
            pub fn reason(self) -> &'static str {
                match self {
                    $($(Self::$name => $reason,)+)+
                }
            }
        }
    };
}

parse_errors! {
    "HPE_CB_HEADERS_COMPLETE" {
        HeadCompleteCallback => "User callback error",
    }
    "HPE_CB_MESSAGE_BEGIN" {
        MessageBeginCallback => "`on_message_begin` callback error",
    }
    "HPE_CB_MESSAGE_COMPLETE" {
        MessageCompleteCallback => "`on_message_complete` callback error",
    }
    "HPE_CHUNK_EXTENSIONS_OVERFLOW" {
        ExtensionsTooLong => "Chunk extensions overflow",
    }
    "HPE_CLOSED_CONNECTION" {
        DataAfterClose => "Data after `Connection: close`",
    }
    "HPE_CR_EXPECTED" {
        NoCrAfterStatusLine => "Missing expected CR after response line",
        NoCrAfterValue => "Missing expected CR after header value",
        NoCrAfterChunkSize => "Missing expected CR after chunk size",
        NoCrAfterExtensionName => "Missing expected CR after chunk extension name",
        NoCrAfterExtensionValue => "Missing expected CR after chunk extension value",
        NoCrAfterChunkData => "Missing expected CR after chunk data",
    }
    "HPE_HEADER_OVERFLOW" {
        SectionTooLong => "Header overflow",
    }
    "HPE_INVALID_CHUNK_SIZE" {
        ChunkSizeByte => "Invalid character in chunk size",
        ChunkSizeOverflow => "Chunk size overflow",
    }
    "HPE_INVALID_CONSTANT" {
        Protocol => "Expected HTTP/, RTSP/ or ICE/",
        MethodForHttp => "Invalid method for HTTP/x.x request",
        MethodForRtsp => "Invalid method for RTSP/x.x request",
        MethodForIce => "Expected SOURCE method for ICE/x.x request",
    }
    "HPE_INVALID_CONTENT_LENGTH" {
        EmptyContentLength => "Empty Content-Length",
        ContentLengthByte => "Invalid character in Content-Length",
        ContentLengthOverflow => "Content-Length overflow",
        ContentLengthAfterTransferEncoding => "Content-Length can't be present with Transfer-Encoding",
    }
    "HPE_INVALID_EOF_STATE" {
        UnexpectedEof => "Invalid EOF state",
    }
    "HPE_INVALID_HEADER_TOKEN" {
        NameByte => "Invalid header token",
        WhitespaceInName => "Invalid header field char",
        ValueByte => "Invalid header value char",
        FoldedValue => "Unexpected whitespace after header value",
    }
    "HPE_INVALID_METHOD" {
        Method => "Invalid method encountered",
        NoSpaceAfterMethod => "Expected space after method",
    }
    "HPE_INVALID_STATUS" {
        StatusCode => "Invalid status code",
        StatusLineByte => "Invalid response status",
    }
    "HPE_INVALID_TRANSFER_ENCODING" {
        EmptyTransferEncoding => "Empty Transfer-Encoding",
        CodingAfterChunked => "Invalid `Transfer-Encoding` header value",
        RequestNotChunked => "Request has invalid `Transfer-Encoding`",
        TransferEncodingAfterContentLength => "Transfer-Encoding can't be present with Content-Length",
    }
    "HPE_INVALID_URL" {
        WhitespaceInUrl => "Invalid characters in url",
        UrlStartByte => "Unexpected start char in url",
        SchemeByte => "Unexpected char in url schema",
        AuthorityByte => "Unexpected char in url server",
        DoubleAtInUrl => "Double @ in url",
        PathByte => "Invalid char in url path",
        QueryByte => "Invalid char in url query",
        FragmentByte => "Invalid char in url fragment start",
        NoCrlfAfterUrl => "Expected CRLF",
    }
    "HPE_INVALID_VERSION" {
        MajorVersion => "Invalid major version",
        NoDotInVersion => "Expected dot",
        MinorVersion => "Invalid minor version",
        Version => "Invalid HTTP version",
        NoCrAfterVersion => "Expected CRLF after version",
        NoSpaceAfterVersion => "Expected space after version",
        Http2PrefaceByte => "Expected HTTP/2 Connection Preface",
    }
    "HPE_LF_EXPECTED" {
        NoLfAfterValue => "Missing expected LF after header value",
    }
    "HPE_PAUSED" {
        Paused => "Paused",
        PausedAfterHead => "Paused by on_headers_complete",
    }
    "HPE_PAUSED_H2_UPGRADE" {
        Http2Preface => "Pause on PRI/Upgrade",
    }
    "HPE_STRICT" {
        NoLfAfterVersion => "Expected CRLF after version",
        NoLfAfterCr => "Expected LF after CR",
        NoLfAfterFields => "Expected LF after headers",
        NoLfAfterChunkSize => "Expected LF after chunk size",
        NoLfAfterChunkData => "Expected LF after chunk data",
        ExtensionStartByte => "Invalid character in chunk extensions",
        ExtensionNameByte => "Invalid character in chunk extensions name",
        ExtensionValueByte => "Invalid character in chunk extensions value",
        QuotedExtensionByte => "Invalid character in chunk extensions quoted value",
        EscapedExtensionByte => "Invalid quoted-pair in chunk extensions quoted value",
        AfterQuotedExtension => "Invalid character in chunk extensions quote value",
    }
    "HPE_UNEXPECTED_CONTENT_LENGTH" {
        DuplicateContentLength => "Duplicate Content-Length",
    }
    "HPE_UNEXPECTED_SPACE" {
        SpaceAfterStartLine => "Unexpected space after start line",
    }
    "HPE_JS_EXCEPTION" {
        Callback => "JS Exception",
    }
}
