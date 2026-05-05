#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod mime_type_list_enum;
pub mod FetchRedirect;
pub mod FetchRequestMode;
pub mod FetchCacheMode;
pub mod Encoding;
pub mod URLPath;
pub mod Method;
pub mod ETag;

// B-2: module un-gated. Items depending on the not-yet-generated
// `mime_type_list_enum::MimeTypeList` (`Table`, `Compact`, `EXTENSIONS`,
// `sniff`, `by_loader`, `from_table`, `create_hash_table`, `ALL`) remain
// individually `#[cfg(any())]`-gated inside MimeType.rs. Everything else
// (struct, Category, init, by_name, constants) compiles for real.
pub mod MimeType;
