#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod ETag;
pub mod Encoding;
pub mod FetchCacheMode;
pub mod FetchRedirect;
pub mod FetchRequestMode;
pub mod Method;
pub mod URLPath;
pub mod h2;
pub mod mime_type_list_enum;
pub use ETag::wtf;

// `mime_type_list_enum::MimeTypeList` is a hand-generated `&'static str`
// newtype (PERF(port) stand-in for the Zig packed-u14 table), so
// `Table`/`Compact`/`EXTENSIONS`/`sniff`/`from_table`/`create_hash_table`/`ALL`
// all compile. Only `by_loader` remains gated
// (same-tier `bun_ast::Loader`, intra-tier edge avoided).
pub mod MimeType;

/// `std.fmt.parseInt(usize, value, 10) catch 0` — RFC 9110 Content-Length is
/// `1*DIGIT`, so any parse failure (empty / non-digit / overflow) maps to 0.
/// Zig has no dedicated helper (http.zig:2800, server.zig:2442, etc. all inline
/// the `catch 0`); this wrapper gives the Rust port ONE call shape across
/// bun_http / bun_runtime::server / s3. Backed by the std.fmt.parseInt port.
#[inline]
pub fn parse_content_length(value: &[u8]) -> usize {
    bun_core::parse_int::<usize>(value, 10).unwrap_or(0)
}
