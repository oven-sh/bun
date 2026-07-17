//! Consolidated proc-macro crate for Bun.
//!
//! `#[path]`-mounts the five former proc-macro crates and re-exposes each
//! `#[proc_macro*]` entry point as a thin root-level wrapper (rustc requires
//! proc-macro items to live at the crate root; re-exports do not satisfy it).

use proc_macro::TokenStream;

#[allow(unreachable_pub)]
#[path = "../bun_core_macros/lib.rs"]
mod core_macros_impl;
#[allow(unreachable_pub)]
#[path = "../clap_macros/lib.rs"]
mod clap_macros_impl;
#[allow(unreachable_pub)]
#[path = "../jsc_macros/lib.rs"]
mod jsc_macros_impl;
#[allow(unreachable_pub)]
#[path = "../css_derive/lib.rs"]
mod css_derive_impl;
#[allow(unreachable_pub)]
#[path = "../dispatch/lib.rs"]
mod dispatch_impl;

// ── bun_core_macros ────────────────────────────────────────────────────────

#[proc_macro]
pub fn pretty_fmt(t: TokenStream) -> TokenStream { core_macros_impl::pretty_fmt_impl(t) }

#[proc_macro]
pub fn comptime_string_map_impl(t: TokenStream) -> TokenStream { core_macros_impl::comptime_string_map_impl_impl(t) }

#[proc_macro]
pub fn comptime_string_set_impl(t: TokenStream) -> TokenStream { core_macros_impl::comptime_string_set_impl_impl(t) }

#[proc_macro_derive(CellRefCounted, attributes(ref_count))]
pub fn derive_cell_ref_counted(t: TokenStream) -> TokenStream { core_macros_impl::derive_cell_ref_counted_impl(t) }

#[proc_macro_derive(Anchored, attributes(live_marker))]
pub fn derive_anchored(t: TokenStream) -> TokenStream { core_macros_impl::derive_anchored_impl(t) }

#[proc_macro_derive(ThreadSafeRefCounted, attributes(ref_count))]
pub fn derive_thread_safe_ref_counted(t: TokenStream) -> TokenStream { core_macros_impl::derive_thread_safe_ref_counted_impl(t) }

#[proc_macro_derive(RefCounted, attributes(ref_count))]
pub fn derive_ref_counted(t: TokenStream) -> TokenStream { core_macros_impl::derive_ref_counted_impl(t) }

#[proc_macro_derive(EnumTag, attributes(enum_tag))]
pub fn derive_enum_tag(t: TokenStream) -> TokenStream { core_macros_impl::derive_enum_tag_impl(t) }

// ── bun_clap_macros ────────────────────────────────────────────────────────

#[proc_macro]
pub fn __parse_param_impl(t: TokenStream) -> TokenStream { clap_macros_impl::__parse_param_impl_impl(t) }

#[proc_macro]
pub fn __parse_params_impl(t: TokenStream) -> TokenStream { clap_macros_impl::__parse_params_impl_impl(t) }

// ── bun_jsc_macros ─────────────────────────────────────────────────────────

#[proc_macro_attribute]
pub fn host_fn(attr: TokenStream, item: TokenStream) -> TokenStream { jsc_macros_impl::host_fn_impl(attr, item) }

#[proc_macro]
pub fn codegen_cached_accessors(t: TokenStream) -> TokenStream { jsc_macros_impl::codegen_cached_accessors_impl(t) }

#[proc_macro_attribute]
pub fn host_call(attr: TokenStream, item: TokenStream) -> TokenStream { jsc_macros_impl::host_call_impl(attr, item) }

#[allow(non_snake_case)]
#[proc_macro_attribute]
pub fn JsClass(attr: TokenStream, item: TokenStream) -> TokenStream { jsc_macros_impl::JsClass_impl(attr, item) }

#[proc_macro_derive(JsClassDerive, attributes(js))]
pub fn js_class_derive(t: TokenStream) -> TokenStream { jsc_macros_impl::js_class_derive_impl(t) }

#[proc_macro_attribute]
pub fn uws_callback(attr: TokenStream, item: TokenStream) -> TokenStream { jsc_macros_impl::uws_callback_impl(attr, item) }

// ── bun_css_derive ─────────────────────────────────────────────────────────

#[proc_macro_derive(DeepClone)]
pub fn derive_deep_clone(t: TokenStream) -> TokenStream { css_derive_impl::derive_deep_clone_impl(t) }

#[proc_macro_derive(CssEql, attributes(css))]
pub fn derive_css_eql(t: TokenStream) -> TokenStream { css_derive_impl::derive_css_eql_impl(t) }

#[proc_macro_derive(CssHash, attributes(css))]
pub fn derive_css_hash(t: TokenStream) -> TokenStream { css_derive_impl::derive_css_hash_impl(t) }

#[proc_macro_derive(IsCompatible, attributes(css))]
pub fn derive_is_compatible(t: TokenStream) -> TokenStream { css_derive_impl::derive_is_compatible_impl(t) }

#[proc_macro_derive(DefineEnumProperty, attributes(css))]
pub fn derive_define_enum_property(t: TokenStream) -> TokenStream { css_derive_impl::derive_define_enum_property_impl(t) }

#[proc_macro_derive(Parse, attributes(css))]
pub fn derive_parse(t: TokenStream) -> TokenStream { css_derive_impl::derive_parse_impl(t) }

#[proc_macro_derive(ToCss, attributes(css))]
pub fn derive_to_css(t: TokenStream) -> TokenStream { css_derive_impl::derive_to_css_impl(t) }

// ── bun_dispatch ───────────────────────────────────────────────────────────

#[proc_macro]
pub fn link_interface(t: TokenStream) -> TokenStream { dispatch_impl::link_interface_impl(t) }
