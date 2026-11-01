use bun_core::strings;

use crate::Encoding;

/// Iterates comma-separated HTTP header list tokens, trimming OWS and skipping empties.
pub struct HeaderValueIterator<'a> {
    remaining: &'a [u8],
}

impl<'a> HeaderValueIterator<'a> {
    pub fn init(input: &'a [u8]) -> HeaderValueIterator<'a> {
        HeaderValueIterator {
            remaining: strings::trim(input, b" \t"),
        }
    }
}

impl<'a> Iterator for HeaderValueIterator<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        loop {
            while let Some((&b',', rest)) = self.remaining.split_first() {
                self.remaining = rest;
            }
            if self.remaining.is_empty() {
                return None;
            }
            let end = strings::index_of_char(self.remaining, b',')
                .map_or(self.remaining.len(), |i| i as usize);
            let token = strings::trim(&self.remaining[..end], b" \t");
            self.remaining = &self.remaining[end..];
            if !token.is_empty() {
                return Some(token);
            }
        }
    }
}

/// True if the request `Upgrade` header names any protocol other than `h2`/`h2c` (which we ignore).
pub fn upgrade_header_is_not_h2(value: &[u8]) -> bool {
    HeaderValueIterator::init(value)
        .any(|token| !strings::eql_any_case_insensitive_ascii(token, &[b"h2", b"h2c"]))
}

/// True if a comma-separated header value contains `token` (case-insensitive).
pub fn header_has_token(value: &[u8], token: &[u8]) -> bool {
    HeaderValueIterator::init(value)
        .any(|item| strings::eql_case_insensitive_ascii_check_length(item, token))
}

/// RFC 9112 §6.1: `chunked`, if present, must be the final coding. Called once per field line.
pub fn fold_transfer_encoding(value: &[u8], coding: &mut Encoding) -> crate::Result<()> {
    for token in HeaderValueIterator::init(value) {
        if *coding == Encoding::Chunked {
            return Err(crate::Error::UnsupportedTransferEncoding);
        }
        match Encoding::from_token(token) {
            Some(Encoding::Chunked) => *coding = Encoding::Chunked,
            Some(_) => {}
            None => return Err(crate::Error::UnsupportedTransferEncoding),
        }
    }
    Ok(())
}

/// True if a 206 holds exactly `bytes first-last/complete` of a known, longer `complete`.
pub fn is_stored_part(content_range: Option<&[u8]>, content_length: Option<usize>) -> bool {
    let Some(value) = content_range else {
        return false;
    };
    if value.len() < 6 || !strings::eql_case_insensitive_ascii(&value[..6], b"bytes ", true) {
        return false;
    }
    let Some((range, complete)) = strings::split_once_char(&value[6..], b'/') else {
        return false;
    };
    let Some((first, last)) = strings::split_once_char(range, b'-') else {
        return false;
    };
    let (Some(first), Some(last), Some(complete)) = (
        bun_http_types::parse_content_length_strict(first),
        bun_http_types::parse_content_length_strict(last),
        bun_http_types::parse_content_length_strict(complete),
    ) else {
        return false;
    };
    let Some(length) = last.checked_sub(first).and_then(|n| n.checked_add(1)) else {
        return false;
    };
    last < complete
        && length < complete
        && content_length.and_then(|n| u64::try_from(n).ok()) == Some(length)
}

/// `Some(false)` if any token is `close` (wins), `Some(true)` if `keep-alive`, else `None`.
pub fn connection_header_keep_alive(value: &[u8]) -> Option<bool> {
    let mut keep_alive = None;
    for token in HeaderValueIterator::init(value) {
        if strings::eql_case_insensitive_ascii_check_length(token, b"close") {
            return Some(false);
        }
        if strings::eql_case_insensitive_ascii_check_length(token, b"keep-alive") {
            keep_alive = Some(true);
        }
    }
    keep_alive
}
