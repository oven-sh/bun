// `bun.schema.api.StringPointer` — canonical type is `bun_core::StringPointer`;
// `bun_http_types` re-exports it. Public: downstream crates (e.g.
// bun_install::NetworkTask) build raw `Entry` records and need the field type.
pub mod api {
    pub use bun_http_types::ETag::StringPointer;
}

// LAYERING: `Headers` (and its tier-safe inherent methods: `memory_cost`,
// `get`, `append`, `get_content_*`, `as_str`, `Clone`) is owned by
// `bun_http_types` (T3) so the ETag matcher and bake DevServer can name the
// same type. The `FetchHeaders`-taking constructor lives in
// `bun_http_jsc::headers_jsc::from_fetch_headers` (it needs to name
// `bun_jsc::FetchHeaders`).
pub use bun_http_types::ETag::{HeaderEntry as Entry, HeaderEntryList as EntryList, Headers};

// to_fetch_headers lives as an extension-trait method in bun_http_jsc.

// `entries` and `buf` are both Drop types — no explicit Drop impl needed.

/// Compute the ETag for `bytes` (xxhash64, hex-lowered, quoted) and append it as
/// an `etag` header. Re-exported from `bun_http_types` now that `Headers` is
/// the same type in both crates.
#[inline]
pub fn append_etag(bytes: &[u8], headers: &mut Headers) {
    bun_http_types::ETag::append_to_headers(bytes, headers);
}
