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

// B-1 gate: MimeType depends on generated mime_type_list_enum::MimeTypeList (not yet
// emitted by codegen for Rust), bun_options_types::Loader (crate not in deps), and
// has phf duplicate keys. Preserve Phase-A draft; un-gate in B-2.
#[cfg(any())]
pub mod MimeType;
#[cfg(not(any()))]
pub mod MimeType {
    // TODO(b1): stub surface — real impl gated above.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct Category(u8);
    pub struct MimeType {
        pub value: std::borrow::Cow<'static, [u8]>,
        pub category: Category,
    }
    pub fn by_extension(_ext: &[u8]) -> MimeType { todo!("b1-stub") }
    pub fn by_extension_no_default(_ext: &[u8]) -> Option<MimeType> { todo!("b1-stub") }
    pub fn by_name(_name: &[u8]) -> MimeType { todo!("b1-stub") }
}
