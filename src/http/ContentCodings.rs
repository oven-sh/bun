use bun_core::strings;
use bun_http_types::Encoding::Encoding;

use crate::HeaderValueIterator;

/// Upper bound on the number of content codings the client will chain.
/// Real responses carry one (occasionally two, e.g. an origin that applied
/// `br` behind a proxy that re-applied `gzip`); a longer list is treated as
/// unsupported so a hostile response can't make us allocate an unbounded
/// number of decoder states.
pub const MAX_CONTENT_CODINGS: usize = 8;

/// The response's `Content-Encoding` codings in the order they were applied,
/// i.e. the order they are listed in the header (RFC 9110 section 8.4), across
/// every `Content-Encoding` field line. The body is decoded in the reverse of
/// this order.
///
/// A coding we can't decode (an unknown token, or more than
/// [`MAX_CONTENT_CODINGS`] of them) marks the whole list unsupported:
/// `is_compressed()` turns false and stays false, so the body is handed over
/// exactly as received. The one thing this type must never allow is decoding
/// only some of the layers and reporting the remaining compressed bytes as the
/// response body.
#[derive(Copy, Clone)]
pub struct ContentCodings {
    list: [Encoding; MAX_CONTENT_CODINGS],
    len: u8,
    unsupported: bool,
}

impl Default for ContentCodings {
    fn default() -> Self {
        Self::new()
    }
}

impl ContentCodings {
    pub const fn new() -> Self {
        Self {
            list: [Encoding::Identity; MAX_CONTENT_CODINGS],
            len: 0,
            unsupported: false,
        }
    }

    /// Parse one `Content-Encoding` field value (a `#content-coding` list,
    /// so possibly several comma-separated codings) and append the codings
    /// in order. Returns whether the response still has a coding chain we
    /// will decode afterwards.
    pub fn append_header_value(&mut self, value: &[u8]) -> bool {
        let mut tokens = HeaderValueIterator::init(value);
        while let Some(token) = tokens.next() {
            // RFC 9110 section 8.4.1: coding names are case-insensitive.
            // `x-gzip` is a registered deprecated alias of `gzip`.
            let coding = if strings::eql_case_insensitive_ascii_check_length(token, b"gzip")
                || strings::eql_case_insensitive_ascii_check_length(token, b"x-gzip")
            {
                Encoding::Gzip
            } else if strings::eql_case_insensitive_ascii_check_length(token, b"deflate") {
                Encoding::Deflate
            } else if strings::eql_case_insensitive_ascii_check_length(token, b"br") {
                Encoding::Brotli
            } else if strings::eql_case_insensitive_ascii_check_length(token, b"zstd") {
                Encoding::Zstd
            } else if strings::eql_case_insensitive_ascii_check_length(token, b"identity") {
                // "identity" means "no transformation": it contributes no
                // decoder but doesn't make the rest of the list undecodable.
                continue;
            } else {
                self.set_unsupported();
                return false;
            };
            if self.unsupported || self.len as usize == MAX_CONTENT_CODINGS {
                self.set_unsupported();
                return false;
            }
            self.list[self.len as usize] = coding;
            self.len += 1;
        }
        self.is_compressed()
    }

    fn set_unsupported(&mut self) {
        self.unsupported = true;
        self.len = 0;
    }

    /// The codings in the order they were applied. Empty when the response
    /// is not compressed or lists a coding we won't decode.
    #[inline]
    pub fn as_slice(&self) -> &[Encoding] {
        &self.list[..self.len as usize]
    }

    /// True when there is at least one coding to decode.
    #[inline]
    pub fn is_compressed(&self) -> bool {
        self.len != 0
    }

    /// The response's only coding, when exactly one was listed.
    #[inline]
    pub fn single(&self) -> Option<Encoding> {
        if self.len == 1 {
            Some(self.list[0])
        } else {
            None
        }
    }
}
