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

pub fn append_to_headers(bytes: &[u8], headers: &mut crate::Headers) -> Result<(), bun_core::Error> {
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
    headers.append(b"etag", etag_str);
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

// ═══════════════════════════════════════════════════════════════════════
// MOVE_DOWN: bun_http::Headers → http_types (CYCLEBREAK.md §→http_types)
// Source: src/http/Headers.zig
//
// Core struct + tier-safe methods only. The following stay in `bun_http`
// (T5) as they pull in higher-tier or sibling deps that http_types (T3)
// must not name:
//   - `Options` / `from()`       — FetchHeaders + Blob (T6, vtabled in bun_http)
//   - `from_pico_http_headers()` — bun_picohttp (kept beside its only caller)
//   - `to_fetch_headers`         — extension-trait in bun_http_jsc
// ═══════════════════════════════════════════════════════════════════════

/// `bun.schema.api.StringPointer` — inlined to avoid a same-tier dep on
/// `options_types` (T3). Layout MUST match
/// `extern struct { offset: u32, length: u32 }` (asserted in Zig:
/// `@alignOf == @alignOf(u32)`, `@sizeOf == @sizeOf(u64)`).
#[repr(C)]
#[derive(Copy, Clone, Default, Debug)]
pub struct StringPointer {
    pub offset: u32,
    pub length: u32,
}

#[derive(Copy, Clone, Default)]
pub struct HeaderEntry {
    pub name: StringPointer,
    pub value: StringPointer,
}

pub type HeaderEntryList = bun_collections::MultiArrayList<HeaderEntry>;

#[derive(Default)]
pub struct Headers {
    pub entries: HeaderEntryList,
    pub buf: Vec<u8>,
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator`; non-AST crate →
    // global mimalloc, field dropped (PORTING.md §allocators).
}

impl Headers {
    pub fn memory_cost(&self) -> usize {
        self.buf.len() + self.entries.memory_cost()
    }

    // PORT NOTE: Zig `!Headers`; only fallible calls were allocator.clone — Vec
    // clone aborts on OOM in this codebase.
    pub fn clone(&self) -> Headers {
        Headers {
            entries: self.entries.clone(),
            buf: self.buf.clone(),
        }
    }

    pub fn get(&self, name: &[u8]) -> Option<&[u8]> {
        let entries = self.entries.slice();
        // TODO(port): MultiArrayList<HeaderEntry> column accessors — assuming
        // .items_name()/.items_value() codegen; verify against bun_collections.
        let names = entries.items_name();
        let values = entries.items_value();
        for (i, name_ptr) in names.iter().enumerate() {
            if strings::eql_case_insensitive_ascii(self.as_str(*name_ptr), name, true) {
                return Some(self.as_str(values[i]));
            }
        }
        None
    }

    // PORT NOTE: was `!void`; only `try` sites were allocations.
    pub fn append(&mut self, name: &[u8], value: &[u8]) {
        let mut offset: u32 = self.buf.len() as u32;
        self.buf.reserve(name.len() + value.len());
        let name_ptr = StringPointer {
            offset,
            length: name.len() as u32,
        };
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        self.buf.extend_from_slice(name);
        offset = self.buf.len() as u32;
        self.buf.extend_from_slice(value);

        let value_ptr = StringPointer {
            offset,
            length: value.len() as u32,
        };
        self.entries.append(HeaderEntry {
            name: name_ptr,
            value: value_ptr,
        });
    }

    // PORT NOTE: Zig `deinit()` — handled by Drop on Vec/MultiArrayList.

    pub fn get_content_disposition(&self) -> Option<&[u8]> {
        self.get(b"content-disposition")
    }
    pub fn get_content_encoding(&self) -> Option<&[u8]> {
        self.get(b"content-encoding")
    }
    pub fn get_content_type(&self) -> Option<&[u8]> {
        self.get(b"content-type")
    }

    pub fn as_str(&self, ptr: StringPointer) -> &[u8] {
        if (ptr.offset + ptr.length) as usize <= self.buf.len() {
            &self.buf[ptr.offset as usize..][..ptr.length as usize]
        } else {
            b""
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// MOVE_DOWN: bun_jsc::wtf → http_types (CYCLEBREAK.md §→http_types,
//            requested by `resolver`)
// Source: src/jsc/WTF.zig (writeHTTPDate only — the rest of `wtf` is
// string-builder/date-parse machinery that stays jsc-side).
// ═══════════════════════════════════════════════════════════════════════

pub mod wtf {
    extern "C" {
        // SAFETY: implemented in C++ (bindings); `buffer` must point to ≥32 bytes.
        fn Bun__writeHTTPDate(buffer: *mut u8, length: usize, timestamp_ms: u64) -> core::ffi::c_int;
    }

    /// Format `timestamp_ms` as an RFC 7231 IMF-fixdate into `buffer`.
    /// Returns the written prefix; empty slice on `timestamp_ms == 0` or error.
    pub fn write_http_date(buffer: &mut [u8; 32], timestamp_ms: u64) -> &[u8] {
        if timestamp_ms == 0 {
            return &buffer[..0];
        }

        let res = unsafe { Bun__writeHTTPDate(buffer.as_mut_ptr(), 32, timestamp_ms) };
        if res < 1 {
            return &buffer[..0];
        }

        &buffer[..res as usize]
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/ETag.zig (65 lines)
//   confidence: medium
//   todos:      3
//   notes:      XxHash64 needs a crate; strings::trim/trim_left assumed in bun_str
// ──────────────────────────────────────────────────────────────────────────
