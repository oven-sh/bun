//! `#[capi]` forwards to `export!` in src/icu/capi/ffi/export.rs, so that rustfmt sees an ordinary function.

#![forbid(unsafe_code)]

use proc_macro::{Delimiter, Group, TokenStream, TokenTree};

#[proc_macro_attribute]
pub fn capi(_: TokenStream, function: TokenStream) -> TokenStream {
    let export: TokenStream = "crate::capi::ffi::export!".parse().unwrap_or_default();
    let arguments = TokenTree::from(Group::new(Delimiter::Brace, function));
    TokenStream::from_iter([export, arguments.into()])
}
