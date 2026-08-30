use bun_core::strings;

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

bun_core::bool_enum!(pub ConnectionHeader { Close, KeepAlive });

/// `Some(Close)` if any token is `close` (wins), `Some(KeepAlive)` if `keep-alive`, else `None`.
pub fn connection_header_keep_alive(value: &[u8]) -> Option<ConnectionHeader> {
    let mut keep_alive = None;
    for token in HeaderValueIterator::init(value) {
        if strings::eql_case_insensitive_ascii_check_length(token, b"close") {
            return Some(ConnectionHeader::Close);
        }
        if strings::eql_case_insensitive_ascii_check_length(token, b"keep-alive") {
            keep_alive = Some(ConnectionHeader::KeepAlive);
        }
    }
    keep_alive
}
