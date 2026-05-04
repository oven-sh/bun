// PORT NOTE: Zig stored a `std.mem.TokenIterator(u8, .scalar)` field. The Rust
// equivalent (`slice::Split<'_, u8, _>` + `.filter(..)`) has an unnameable
// closure type, so we store the remaining input slice and inline the
// tokenize-by-',' logic in `next()`. Behavior is identical.
pub struct HeaderValueIterator<'a> {
    remaining: &'a [u8],
}

impl<'a> HeaderValueIterator<'a> {
    pub fn init(input: &'a [u8]) -> HeaderValueIterator<'a> {
        HeaderValueIterator {
            // std.mem.tokenizeScalar(u8, std.mem.trim(u8, input, " \t"), ',')
            remaining: trim_sp_tab(input),
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

        let slice = trim_sp_tab(token);
        if slice.is_empty() {
            return self.next();
        }

        Some(slice)
    }
}

#[inline]
fn trim_sp_tab(s: &[u8]) -> &[u8] {
    // std.mem.trim(u8, s, " \t")
    let mut start = 0;
    let mut end = s.len();
    while start < end && matches!(s[start], b' ' | b'\t') {
        start += 1;
    }
    while end > start && matches!(s[end - 1], b' ' | b'\t') {
        end -= 1;
    }
    &s[start..end]
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/HeaderValueIterator.zig (18 lines)
//   confidence: high
//   todos:      0
//   notes:      TokenIterator field replaced with &[u8] + inline tokenize (closure type unnameable)
// ──────────────────────────────────────────────────────────────────────────
