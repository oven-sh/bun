use bun_str::strings;

// PORT NOTE: Zig anonymous return struct `{ tag: []const u8, is_weak: bool }`.
// Borrows from the input slice; not a persistent heap struct.
struct Parsed<'a> {
    tag: &'a [u8],
    is_weak: bool,
}

/// Parse a single entity tag from a string, returns the tag without quotes and whether it's weak
fn parse(tag_str: &[u8]) -> Parsed<'_> {
    let mut str = strings::trim(tag_str, b" \t");

    // Check for weak indicator
    let mut is_weak = false;
    if str.starts_with(b"W/") {
        is_weak = true;
        str = &str[2..];
        str = strings::trim_left(str, b" \t");
    }

    // Remove surrounding quotes
    if str.len() >= 2 && str[0] == b'"' && str[str.len() - 1] == b'"' {
        str = &str[1..str.len() - 1];
    }

    Parsed { tag: str, is_weak }
}

/// Perform weak comparison between two entity tags according to RFC 9110 Section 8.8.3.2
fn weak_match(tag1: &[u8], is_weak1: bool, tag2: &[u8], is_weak2: bool) -> bool {
    let _ = is_weak1;
    let _ = is_weak2;
    // For weak comparison, we only compare the opaque tag values, ignoring weak indicators
    tag1 == tag2
}

pub fn append_to_headers(bytes: &[u8], headers: &mut bun_http::Headers) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    // TODO(port): std.hash.XxHash64 — pick xxhash crate (e.g. xxhash-rust) or bun_core wrapper in Phase B
    let hash: u64 = xxhash64(0, bytes);

    let mut etag_buf = [0u8; 40];
    let len = {
        use std::io::Write;
        let mut cursor = &mut etag_buf[..];
        write!(cursor, "\"{:x}\"", hash).expect("unreachable");
        40 - cursor.len()
    };
    let etag_str = &etag_buf[..len];
    headers.append(b"etag", etag_str)?;
    Ok(())
}

// TODO(port): replace with real XxHash64 impl in Phase B (std.hash.XxHash64.hash(0, bytes))
fn xxhash64(_seed: u64, _bytes: &[u8]) -> u64 {
    unimplemented!("xxhash64")
}

pub fn if_none_match(
    /// "ETag" header
    etag: &[u8],
    /// "If-None-Match" header
    if_none_match: &[u8],
) -> bool {
    let our_parsed = parse(etag);

    // Handle "*" case
    if strings::trim(if_none_match, b" \t") == b"*" {
        return true; // Condition is false, so we should return 304
    }

    // Parse comma-separated list of entity tags
    for tag_str in if_none_match.split(|&b| b == b',') {
        let parsed = parse(tag_str);
        if weak_match(our_parsed.tag, our_parsed.is_weak, parsed.tag, parsed.is_weak) {
            return true; // Condition is false, so we should return 304
        }
    }

    false // Condition is true, continue with normal processing
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/ETag.zig (65 lines)
//   confidence: medium
//   todos:      3
//   notes:      XxHash64 needs a crate; strings::trim/trim_left assumed in bun_str
// ──────────────────────────────────────────────────────────────────────────
