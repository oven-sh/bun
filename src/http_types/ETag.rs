use bun_core::strings;

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
        // bun_string has no multi-char trim_left; inline it (trailing
        // whitespace was already stripped above).
        while let [b' ' | b'\t', rest @ ..] = str {
            str = rest;
        }
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

/// Buffer large enough to hold [`format`]'s output (18 bytes used).
pub type FormatBuffer = [u8; 40];

/// Format `hash` as a quoted RFC 9110 entity tag: `"` + 16 lowercase hex
/// digits (zero-padded) + `"`. Returns the written prefix of `buf`.
pub fn format(hash: u64, buf: &mut FormatBuffer) -> &[u8] {
    let len = {
        use std::io::Write;
        let mut cursor = &mut buf[..];
        // Always emit exactly 16 hex chars (zero-padded); `{:x}` alone is
        // variable-width.
        write!(cursor, "\"{:016x}\"", hash).expect("unreachable");
        40 - cursor.len()
    };
    &buf[..len]
}

pub fn append_to_headers(bytes: &[u8], headers: &mut Headers) {
    let hash: u64 = xxhash64(0, bytes);
    let mut etag_buf: FormatBuffer = [0; 40];
    let etag_str = format(hash, &mut etag_buf);
    headers.append(b"etag", etag_str);
}

#[inline]
fn xxhash64(seed: u64, bytes: &[u8]) -> u64 {
    bun_core::hash::xxhash64(seed, bytes)
}

/// Split an `If-None-Match` list into entity-tag fragments, honoring RFC 9110
/// DQUOTE boundaries: a comma inside an opaque-tag (e.g. `"ab,cd"`) is part of
/// the tag, not a list separator.
struct EntityTagSplit<'a> {
    rest: &'a [u8],
    done: bool,
}

impl<'a> Iterator for EntityTagSplit<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        if self.done {
            return None;
        }
        let bytes = self.rest;
        let mut in_quotes = false;
        for (i, &b) in bytes.iter().enumerate() {
            match b {
                b'"' => in_quotes = !in_quotes,
                b',' if !in_quotes => {
                    let (head, tail) = bytes.split_at(i);
                    self.rest = &tail[1..];
                    return Some(head);
                }
                _ => {}
            }
        }
        self.done = true;
        Some(bytes)
    }
}

fn split_entity_tags(list: &[u8]) -> EntityTagSplit<'_> {
    EntityTagSplit {
        rest: list,
        done: false,
    }
}

pub fn if_none_match(
    // "ETag" header
    etag: &[u8],
    // "If-None-Match" header
    if_none_match: &[u8],
) -> bool {
    let our_parsed = parse(etag);

    // Handle "*" case
    if strings::trim(if_none_match, b" \t") == b"*" {
        return true; // Condition is false, so we should return 304
    }

    // Parse comma-separated list of entity tags
    for tag_str in split_entity_tags(if_none_match) {
        let parsed = parse(tag_str);
        if weak_match(
            our_parsed.tag,
            our_parsed.is_weak,
            parsed.tag,
            parsed.is_weak,
        ) {
            return true; // Condition is false, so we should return 304
        }
    }

    false // Condition is true, continue with normal processing
}

// ═══════════════════════════════════════════════════════════════════════
// Headers — moved from bun_http.
//
// Core struct + tier-safe methods only. The following stay in `bun_http`
// (T5) as they pull in higher-tier or sibling deps that http_types (T3)
// must not name:
//   - `Options` / `from()`       — FetchHeaders + Blob (T6, vtabled in bun_http)
//   - `from_pico_http_headers()` — bun_picohttp (kept beside its only caller)
//   - `to_fetch_headers`         — extension-trait in bun_http_jsc
// ═══════════════════════════════════════════════════════════════════════

/// `bun.schema.api.StringPointer` — canonical definition lives in `bun_core`
/// (T0, already a dep). Re-exported so `HeaderEntry`'s field type and
/// `bun_http::headers::api::StringPointer` keep resolving.
pub use bun_core::StringPointer;

#[derive(Copy, Clone, Default)]
pub struct HeaderEntry {
    pub name: StringPointer,
    pub value: StringPointer,
}

pub type HeaderEntryList = bun_collections::MultiArrayList<HeaderEntry>;

/// Column accessors for `HeaderEntry` MultiArrayList storage.
///
/// Returns a normal `&self`-tied borrow; `StringPointer` is `Copy` so callers
/// that need to mutate `header_entries` afterwards copy the index out first.
pub trait HeaderEntryColumns {
    fn items_name(&self) -> &[StringPointer];
    fn items_value(&self) -> &[StringPointer];
}
impl HeaderEntryColumns for bun_collections::multi_array_list::Slice<HeaderEntry> {
    #[inline]
    fn items_name(&self) -> &[StringPointer] {
        self.items::<"name", StringPointer>()
    }
    #[inline]
    fn items_value(&self) -> &[StringPointer] {
        self.items::<"value", StringPointer>()
    }
}
impl HeaderEntryColumns for HeaderEntryList {
    #[inline]
    fn items_name(&self) -> &[StringPointer] {
        self.items::<"name", StringPointer>()
    }
    #[inline]
    fn items_value(&self) -> &[StringPointer] {
        self.items::<"value", StringPointer>()
    }
}

#[derive(Default)]
pub struct Headers {
    pub entries: HeaderEntryList,
    pub buf: Vec<u8>,
    // No allocator field: non-AST crate → global mimalloc (PORTING.md §allocators).
}

impl Clone for Headers {
    // The only fallible calls are allocations — abort on OOM.
    fn clone(&self) -> Headers {
        Headers {
            entries: self
                .entries
                .clone()
                .unwrap_or_else(|_| bun_alloc::out_of_memory()),
            buf: self.buf.clone(),
        }
    }
}

impl Headers {
    pub fn memory_cost(&self) -> usize {
        self.buf.len() + self.entries.memory_cost()
    }

    pub fn get(&self, name: &[u8]) -> Option<&[u8]> {
        let entries = self.entries.slice();
        let names: &[StringPointer] = entries.items_name();
        let values: &[StringPointer] = entries.items_value();
        for (i, name_ptr) in names.iter().enumerate() {
            if strings::eql_case_insensitive_ascii(self.as_str(*name_ptr), name, true) {
                return Some(self.as_str(values[i]));
            }
        }
        None
    }

    // The only fallible calls are allocations — abort on OOM.
    pub fn append(&mut self, name: &[u8], value: &[u8]) {
        let mut offset: u32 = u32::try_from(self.buf.len()).unwrap();
        self.buf.reserve(name.len() + value.len());
        let name_ptr = StringPointer {
            offset,
            length: u32::try_from(name.len()).unwrap(),
        };
        self.buf.extend_from_slice(name);
        offset = u32::try_from(self.buf.len()).unwrap();
        self.buf.extend_from_slice(value);

        let value_ptr = StringPointer {
            offset,
            length: u32::try_from(value.len()).unwrap(),
        };
        self.entries
            .append(HeaderEntry {
                name: name_ptr,
                value: value_ptr,
            })
            .unwrap_or_else(|_| bun_alloc::out_of_memory());
    }

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
// wtf::writeHTTPDate — moved from bun_jsc (writeHTTPDate only — the rest of
// `wtf` is string-builder/date-parse machinery that stays jsc-side).
// ═══════════════════════════════════════════════════════════════════════

pub mod wtf {
    unsafe extern "C" {
        // Implemented in C++ (bindings). The only precondition is "buffer points to
        // ≥`length` writable bytes"; encoding that as `&mut [u8; 32]` (thin pointer,
        // ABI-identical to `*mut u8`) plus a fixed `length = 32` discharges it at the
        // type level, so the declaration is `safe fn`.
        safe fn Bun__writeHTTPDate(
            buffer: &mut [u8; 32],
            length: usize,
            timestamp_ms: u64,
        ) -> core::ffi::c_int;
    }

    /// Format `timestamp_ms` as an RFC 7231 IMF-fixdate into `buffer`.
    /// Returns the written prefix; empty slice on `timestamp_ms == 0` or error.
    pub fn write_http_date(buffer: &mut [u8; 32], timestamp_ms: u64) -> &[u8] {
        if timestamp_ms == 0 {
            return &buffer[..0];
        }

        let res = Bun__writeHTTPDate(buffer, 32, timestamp_ms);
        if res < 1 {
            return &buffer[..0];
        }

        &buffer[..res as usize]
    }
}
