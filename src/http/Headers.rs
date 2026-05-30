use bun_picohttp as picohttp;

// `bun.schema.api.StringPointer` — canonical type is `bun_core::StringPointer`;
// `bun_http_types` re-exports it. Public: downstream crates (e.g.
// bun_install::NetworkTask) build raw `Entry` records and need the field type.
pub mod api {
    pub use bun_http_types::ETag::StringPointer;
}

// TYPE_ONLY moved-in: `bun_http_types::Method::HeaderName` is the `#[repr(u8)]`
// enum mirroring WebCore's `HTTPHeaderNames.in` (same discriminants as
// `bun_jsc::HTTPHeaderName`). Re-export for the `FetchHeadersRef::fast_has`
// signature so impls can forward the discriminant straight to
// `WebCore__FetchHeaders__fastHas_`.
pub use bun_http_types::Method::HeaderName;

// LAYERING: `Headers` (and its tier-safe inherent methods: `memory_cost`,
// `get`, `append`, `get_content_*`, `as_str`, `Clone`) is owned by
// `bun_http_types` (T3) so the ETag matcher and bake DevServer can name the
// same type. This crate adds the constructors that pull in T5 deps
// (`picohttp`). The `FetchHeaders`-taking constructor lives in
// `bun_http_jsc::headers_jsc::from_fetch_headers` (it needs to name
// `bun_jsc::FetchHeaders`).
pub use bun_http_types::ETag::{HeaderEntry as Entry, HeaderEntryList as EntryList, Headers};

// PORT NOTE: `pub const toFetchHeaders = @import("../http_jsc/headers_jsc.zig").toFetchHeaders;`
// deleted — to_fetch_headers lives as an extension-trait method in bun_http_jsc.

/// Extension constructors for `Headers` that depend on T5 crates
/// (`bun_picohttp`). Kept as a trait so callers can keep writing
/// `Headers::from_pico_http_headers(...)`.
pub trait HeadersExt {
    fn from_pico_http_headers(headers: &[picohttp::Header]) -> Headers;
}

impl HeadersExt for Headers {
    // PORT NOTE: was `!Headers`; all fallible calls were bun.handleOom-wrapped allocations.
    fn from_pico_http_headers(headers: &[picohttp::Header]) -> Headers {
        let header_count = headers.len();
        let mut result = Headers {
            entries: EntryList::default(),
            buf: Vec::new(),
        };

        let mut buf_len: usize = 0;
        for header in headers {
            buf_len += header.name().len() + header.value().len();
        }
        result
            .entries
            .ensure_total_capacity(header_count)
            .expect("OOM"); // Zig: bun.handleOom
        result.buf.reserve_exact(buf_len);
        for header in headers {
            let name = header.name();
            let value = header.value();
            // PORT NOTE: Zig used `@truncate` for offsets/lengths; mirror with `as u32`
            // (silent wrap on >4GiB aggregate headers) rather than `try_from().unwrap()`.
            let name_offset = result.buf.len() as u32;
            result.buf.extend_from_slice(name);
            let value_offset = result.buf.len() as u32;
            result.buf.extend_from_slice(value);

            // PORT NOTE: Zig pre-set `entries.len = headers.len` then `set(i, ..)`.
            // Rust `MultiArrayList` lacks `set_len`; capacity was reserved above
            // so use `append_assume_capacity` which is equivalent.
            result.entries.append_assume_capacity(Entry {
                name: api::StringPointer {
                    offset: name_offset,
                    length: name.len() as u32,
                },
                value: api::StringPointer {
                    offset: value_offset,
                    length: value.len() as u32,
                },
            });
        }
        result
    }
}

// PORT NOTE: `pub fn deinit` only freed `entries` and `buf`; both are Drop types now — no explicit Drop impl needed.

/// Compute the ETag for `bytes` (xxhash64, hex-lowered, quoted) and append it as
/// an `etag` header. Re-exported from `bun_http_types` now that `Headers` is
/// the same type in both crates.
#[inline]
pub fn append_etag(bytes: &[u8], headers: &mut Headers) {
    let _ = bun_http_types::ETag::append_to_headers(bytes, headers);
}

// ported from: src/http/Headers.zig
