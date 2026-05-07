#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
#![warn(unreachable_pub)]
pub mod mime_type_list_enum;
pub mod FetchRedirect;
pub mod FetchRequestMode;
pub mod FetchCacheMode;
pub mod Encoding;
pub mod URLPath;
pub mod Method;
pub mod ETag;

// B-2: module un-gated. `mime_type_list_enum::MimeTypeList` is now a
// hand-generated `&'static str` newtype (PERF(port) stand-in for the Zig
// packed-u14 table), so `Table`/`Compact`/`EXTENSIONS`/`sniff`/`from_table`/
// `create_hash_table`/`ALL` all compile. Only `by_loader` remains gated
// (same-tier `bun_options_types::Loader`, intra-tier edge avoided).
pub mod MimeType;
