//! The macros of bun_simd. They are not trusted: they write safe code.
//!
//! What is written here has the hygiene of a token of the item.
// It runs in the compiler, and depends on nothing of Bun.
#![allow(unreachable_pub, clippy::disallowed_methods, clippy::disallowed_types, clippy::cloned_ref_to_slice_refs)]
#![allow(
    clippy::clone_on_ref_ptr,
    clippy::format_collect,
    clippy::needless_pass_by_value,
    clippy::or_fun_call,
    clippy::redundant_clone
)]
#![cfg_attr(mordant, allow(generic_body_not_generic, bare_bool_args))]
#![forbid(unsafe_code)]
extern crate proc_macro;
use proc_macro::TokenStream;
mod rules;
mod simd;

#[proc_macro_attribute]
pub fn simd(args: TokenStream, item: TokenStream) -> TokenStream {
    simd::simd(args, item)
}
#[proc_macro_attribute]
pub fn kernel(args: TokenStream, item: TokenStream) -> TokenStream {
    simd::alone(args, item)
}
#[proc_macro_attribute]
pub fn only(args: TokenStream, item: TokenStream) -> TokenStream {
    simd::only_alone("only", args, item)
}
#[proc_macro_attribute]
pub fn except(args: TokenStream, item: TokenStream) -> TokenStream {
    simd::only_alone("except", args, item)
}
#[doc(hidden)]
#[proc_macro]
pub fn twins(input: TokenStream) -> TokenStream {
    simd::twins(input)
}
#[doc(hidden)]
#[proc_macro]
pub fn list(input: TokenStream) -> TokenStream {
    simd::list(input)
}
#[proc_macro_attribute]
pub fn shared(args: TokenStream, item: TokenStream) -> TokenStream {
    simd::shared(args, item)
}
/// See the trait.
#[proc_macro_derive(Plain)]
pub fn plain(item: TokenStream) -> TokenStream {
    simd::derive("Plain", &["struct", "for"], item)
}
/// See the trait.
#[proc_macro_derive(AsBytes)]
pub fn as_bytes(item: TokenStream) -> TokenStream {
    simd::derive("AsBytes", &["struct"], item)
}
/// For the library.
#[doc(hidden)]
#[proc_macro_attribute]
pub fn rules(_: TokenStream, item: TokenStream) -> TokenStream {
    rules::rules(item)
}
#[doc(hidden)]
#[proc_macro]
pub fn join(input: TokenStream) -> TokenStream {
    rules::join(input)
}
#[doc(hidden)]
#[proc_macro_derive(Kept, attributes(it))]
pub fn kept(item: TokenStream) -> TokenStream {
    rules::kept(item)
}
#[doc(hidden)]
#[proc_macro_attribute]
pub fn on(args: TokenStream, item: TokenStream) -> TokenStream {
    rules::forward("on_these", args, item)
}
/// For operations. Without optimization, each copy of a function has stack slots of its own, so these are calls.
#[doc(hidden)]
#[proc_macro_attribute]
pub fn op(_: TokenStream, item: TokenStream) -> TokenStream {
    let attributes = "#[cfg_attr(bun_simd_unoptimized, inline)] #[cfg_attr(not(bun_simd_unoptimized), inline(always))]";
    [attributes.parse().unwrap(), item].into_iter().collect()
}
#[doc(hidden)]
#[proc_macro_attribute]
pub fn sealed(_: TokenStream, item: TokenStream) -> TokenStream {
    rules::sealed(item)
}
/// `Rule<T>`, a type whose name is the text.
#[doc(hidden)]
#[proc_macro]
pub fn rule(text: TokenStream) -> TokenStream {
    let text = text.to_string().replace('<', "below");
    let name = text.split(|c: char| !c.is_alphanumeric()).filter(|it| !it.is_empty()).collect::<Vec<_>>().join("_");
    let item = format!("#[allow(non_camel_case_types)] struct {name}<T>(core::marker::PhantomData<T>);");
    format!("{item} type Rule<T> = {name}<T>;").parse().unwrap()
}
