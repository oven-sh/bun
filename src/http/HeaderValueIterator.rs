use bun_core::strings;

pub struct HeaderValueIterator<'a> {
    remaining: &'a [u8],
}

impl<'a> HeaderValueIterator<'a> {
    pub fn init(input: &'a [u8]) -> HeaderValueIterator<'a> {
        HeaderValueIterator {
            // std.mem.tokenizeScalar(u8, std.mem.trim(u8, input, " \t"), ',')
            remaining: strings::trim(input, b" \t"),
        }
    }

    pub fn next(&mut self) -> Option<&'a [u8]> {
        // tokenizeScalar semantics: skip leading delimiters, take until next delimiter.
        while let Some((&b',', rest)) = self.remaining.split_first() {
            self.remaining = rest;
        }
        if self.remaining.is_empty() {
            return None;
        }
        let end = self
            .remaining
            .iter()
            .position(|&b| b == b',')
            .unwrap_or(self.remaining.len());
        let token = &self.remaining[..end];
        self.remaining = &self.remaining[end..];

        let slice = strings::trim(token, b" \t");
        if slice.is_empty() {
            return self.next();
        }

        Some(slice)
    }
}

// ported from: src/http/HeaderValueIterator.zig
