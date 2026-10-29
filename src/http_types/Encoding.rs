#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Encoding {
    Identity,
    Gzip,
    Deflate,
    Brotli,
    Zstd,
    Chunked,
}

impl Encoding {
    /// Parses one case-insensitive coding token (RFC 9110 §8.4.1 / RFC 9112 §7); `None` if unrecognized.
    pub fn from_token(token: &[u8]) -> Option<Encoding> {
        use bun_core::strings::eql_case_insensitive_ascii_check_length as eql;
        if eql(token, b"gzip") || eql(token, b"x-gzip") {
            Some(Encoding::Gzip)
        } else if eql(token, b"deflate") {
            Some(Encoding::Deflate)
        } else if eql(token, b"br") {
            Some(Encoding::Brotli)
        } else if eql(token, b"zstd") {
            Some(Encoding::Zstd)
        } else if eql(token, b"identity") {
            Some(Encoding::Identity)
        } else if eql(token, b"chunked") {
            Some(Encoding::Chunked)
        } else {
            None
        }
    }

    pub fn can_use_lib_deflate(self) -> bool {
        matches!(self, Encoding::Gzip | Encoding::Deflate)
    }

    pub fn is_compressed(self) -> bool {
        matches!(
            self,
            Encoding::Brotli | Encoding::Gzip | Encoding::Deflate | Encoding::Zstd
        )
    }
}
