//! Proc-macros for `bun_core`.
//!
//! `pretty_fmt!(FMT, true|false)` rewrites Bun's `<tag>`
//! color markup into ANSI escape sequences (or strips them when the second
//! argument is `false`) and emits a string *literal* so the result is usable as
//! a `format_args!` / `concat!` template.
//!
//! The first argument may be a string literal, or a `concat!(..)` /
//! `stringify!(..)` tree built from string literals — those are evaluated here
//! so wrapper macros (`scoped_log!`, `note!`, …) can compose the template at
//! the call site.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::{
    Data, DeriveInput, Expr, ExprLit, ExprMacro, Fields, Lit, LitBool, LitStr, Token,
    parse::{Parse, ParseStream, Parser},
    parse_macro_input,
};

struct PrettyFmtInput {
    fmt: Expr,
    enabled: bool,
}

impl Parse for PrettyFmtInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let fmt: Expr = input.parse()?;
        input.parse::<Token![,]>()?;
        let enabled: LitBool = input.parse()?;
        // tolerate trailing comma
        if input.peek(Token![,]) {
            input.parse::<Token![,]>()?;
        }
        Ok(PrettyFmtInput {
            fmt,
            enabled: enabled.value,
        })
    }
}

/// Recursively flatten a string-literal / `concat!` / `stringify!` expression
/// into a single owned `String`. Anything else is a compile error.
fn eval_literal(expr: &Expr, out: &mut String) -> Result<(), syn::Error> {
    match expr {
        Expr::Lit(ExprLit {
            lit: Lit::Str(s), ..
        }) => {
            out.push_str(&s.value());
            Ok(())
        }
        Expr::Group(g) => eval_literal(&g.expr, out),
        Expr::Paren(p) => eval_literal(&p.expr, out),
        Expr::Macro(ExprMacro { mac, .. }) => {
            if mac.path.is_ident("concat") {
                let parser = syn::punctuated::Punctuated::<Expr, Token![,]>::parse_terminated;
                let parts = parser.parse2(mac.tokens.clone())?;
                for part in parts {
                    eval_literal(&part, out)?;
                }
                Ok(())
            } else if mac.path.is_ident("stringify") {
                out.push_str(&mac.tokens.to_string());
                Ok(())
            } else {
                Err(syn::Error::new_spanned(
                    expr,
                    "pretty_fmt!: format argument must be a string literal, concat!(), or stringify!()",
                ))
            }
        }
        _ => Err(syn::Error::new_spanned(
            expr,
            "pretty_fmt!: format argument must be a string literal, concat!(), or stringify!()",
        )),
    }
}

use bun_output_tags::{RESET, color_for};

/// Rewrites `<tag>` markup plus legacy format specs
/// (`{s}`/`{d}` → `{}`, `{any}`/`{?}` → `{:?}`).
///
/// Colour table lives in `bun_output_tags`; the state machine is kept duplicated
/// vs `bun_core::output::pretty_fmt_runtime` because the two intentionally
/// diverge in the `{` arm (this side rewrites legacy specs `{s}`→`{}` for the
/// emitted `format_args!` template; runtime copies braces verbatim) and on
/// unknown tags (this side `Err`→`compile_error!`; runtime emits `""`).
fn rewrite(fmt: &str, is_enabled: bool) -> Result<String, String> {
    let bytes = fmt.as_bytes();
    let mut out = String::with_capacity(bytes.len() * 2);
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 1;
                if i < bytes.len() {
                    match bytes[i] {
                        b'<' | b'>' => {
                            out.push(bytes[i] as char);
                            i += 1;
                        }
                        _ => {
                            out.push('\\');
                            out.push(bytes[i] as char);
                            i += 1;
                        }
                    }
                }
            }
            b'>' => {
                // stray closer — dropped
                i += 1;
            }
            b'{' => {
                // copy `{ ... }` verbatim, optionally rewriting legacy specs
                let start = i;
                while i < bytes.len() && bytes[i] != b'}' {
                    i += 1;
                }
                // bytes[start..i] is `{spec`, bytes[i] is `}` (or EOF)
                let spec = &fmt[start..i];
                match spec {
                    "{s" | "{d" | "{f" => out.push('{'),
                    "{any" | "{?" => out.push_str("{:?"),
                    _ => out.push_str(spec),
                }
                // `}` (if present) falls through to the `else` arm next iteration
            }
            b'<' => {
                i += 1;
                let mut is_reset = i < bytes.len() && bytes[i] == b'/';
                if is_reset {
                    i += 1;
                }
                let start = i;
                while i < bytes.len() && bytes[i] != b'>' {
                    i += 1;
                }
                let name = &fmt[start..i];
                let seq: &str = if let Some(c) = color_for(name) {
                    c
                } else if name == "r" {
                    is_reset = true;
                    ""
                } else {
                    return Err(format!(
                        "invalid color name passed to pretty_fmt!: <{name}>"
                    ));
                };
                if is_enabled {
                    out.push_str(if is_reset { RESET } else { seq });
                }
                // trailing `>` consumed by the `'>'` arm next iteration
            }
            _ => {
                // Preserve full UTF-8: push the char at this byte position.
                let ch = fmt[i..].chars().next().unwrap();
                out.push(ch);
                i += ch.len_utf8();
                continue;
            }
        }
    }
    Ok(out)
}

/// `pretty_fmt!("<red>hi {s}<r>", true)` → `"\u{1b}[31mhi {}\u{1b}[0m"`
/// `pretty_fmt!("<red>hi {s}<r>", false)` → `"hi {}"`
///
/// Expands to a string literal — valid in `format_args!` / `concat!` position.
#[proc_macro]
pub fn pretty_fmt(input: TokenStream) -> TokenStream {
    let PrettyFmtInput { fmt, enabled } = parse_macro_input!(input as PrettyFmtInput);

    let mut template = String::new();
    if let Err(e) = eval_literal(&fmt, &mut template) {
        return e.to_compile_error().into();
    }

    match rewrite(&template, enabled) {
        Ok(s) => {
            let lit = LitStr::new(&s, Span::call_site());
            quote!(#lit).into()
        }
        Err(msg) => syn::Error::new_spanned(&fmt, msg).to_compile_error().into(),
    }
}

mod comptime_string_map;

/// Implementation detail of `bun_core::comptime_string_map!` — invoke that
/// `macro_rules!` wrapper instead (it injects the `@crate_path` prefix).
#[proc_macro]
pub fn comptime_string_map_impl(input: TokenStream) -> TokenStream {
    comptime_string_map::expand_map(input.into())
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// Implementation detail of `bun_core::comptime_string_set!` — invoke that
/// `macro_rules!` wrapper instead (it injects the `@crate_path` prefix).
#[proc_macro]
pub fn comptime_string_set_impl(input: TokenStream) -> TokenStream {
    comptime_string_map::expand_set(input.into())
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

// ──────────────────────────────────────────────────────────────────────────
// #[derive(RefCounted)]
// ──────────────────────────────────────────────────────────────────────────

/// Implements `bun_ptr::RefCounted` over the field named `ref_count`.
///
/// `#[ref_count(destroy = path, did_ref = path, will_deref = path)]` on the
/// struct overrides the trait methods of those names.
#[proc_macro_derive(RefCounted, attributes(ref_count))]
pub fn derive_ref_counted(input: TokenStream) -> TokenStream {
    expand_ref_counted(&parse_macro_input!(input as DeriveInput))
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_ref_counted(input: &DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let count = match &input.data {
        Data::Struct(s) => s
            .fields
            .iter()
            .find(|f| f.ident.as_ref().is_some_and(|i| i == "ref_count")),
        _ => None,
    };
    let Some(syn::Field { ty: count, .. }) = count else {
        return Err(syn::Error::new_spanned(
            name,
            "RefCounted: expected a struct with a `ref_count` field",
        ));
    };

    let mut hooks = Vec::new();
    for attr in input.attrs.iter() {
        if !attr.path().is_ident("ref_count") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            let argument = if meta.path.is_ident("destroy") {
                quote! { ::bun_ptr::AliasableBox<Self> }
            } else if meta.path.is_ident("did_ref") || meta.path.is_ident("will_deref") {
                quote! { &::bun_ptr::RefPtr<Self> }
            } else {
                return Err(meta.error("unknown ref_count attribute key"));
            };
            let hook = &meta.path;
            let path: Expr = meta.value()?.parse()?;
            hooks.push(quote! {
                #[inline]
                fn #hook(this: #argument) {
                    (#path)(this)
                }
            });
            Ok(())
        })?;
    }

    Ok(quote! {
        // SAFETY: `OFFSET` is the offset of the `ref_count` field, which has this type.
        unsafe impl #impl_g ::bun_ptr::IntrusiveField<#count> for #name #ty_g #where_g {
            const OFFSET: usize = ::core::mem::offset_of!(Self, ref_count);
        }
        impl #impl_g ::bun_ptr::RefCounted for #name #ty_g #where_g {
            type Count = #count;
            #(#hooks)*
        }
    })
}

// ──────────────────────────────────────────────────────────────────────────
// #[derive(EnumTag)]
// ──────────────────────────────────────────────────────────────────────────
//
// Derives the data→discriminant projection that otherwise needs a
// hand-written
// `fn tag(&self) -> Tag { match self { Self::A(..) => Tag::A, … } }` (14
// copies, 160+ arms total — see ast/expr.rs, ast/stmt.rs, shell_parser, etc.).
//
// Two modes:
//
//   • `#[enum_tag(existing = path::to::Tag)]`  (PRIMARY — used by all 14
//     migrated sites). Emits ONLY the inherent `const fn tag(&self) -> Tag`
//     and `From<&Data> for Tag`. The tag type is left untouched — it may be a
//     real `enum`, a `#[repr(transparent)] struct Tag(u8)` with sparse
//     associated `pub const Variant: Tag`, or anything else that exposes a
//     `Tag::Variant` per data variant. No `From<Tag> for &'static str`, no
//     iterator — those belong on the existing tag type if needed.
//
//   • bare `#[derive(EnumTag)]` — also generates a fresh
//     `pub enum <Name>Tag { … }` mirror (one fieldless variant per data
//     variant). Unused by the current dedup but kept for future ports that
//     don't already have a hand-written tag enum to point at.
//
// The emitted `tag()` is `pub const fn` and matches every variant shape
// (unit / tuple / struct) by using `Self::V { .. }` arms.

/// `#[derive(EnumTag)]` — see module comment above.
#[proc_macro_derive(EnumTag, attributes(enum_tag))]
pub fn derive_enum_tag(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let variants = match &input.data {
        Data::Enum(e) => &e.variants,
        _ => {
            return syn::Error::new_spanned(name, "EnumTag: only enums are supported")
                .to_compile_error()
                .into();
        }
    };

    // Parse optional `#[enum_tag(existing = path::to::Tag)]`.
    let mut existing: Option<syn::Path> = None;
    for a in &input.attrs {
        if !a.path().is_ident("enum_tag") {
            continue;
        }
        let parsed = a.parse_nested_meta(|meta| {
            if meta.path.is_ident("existing") {
                existing = Some(meta.value()?.parse()?);
                Ok(())
            } else {
                Err(meta.error("unknown enum_tag attribute key; expected `existing = <path>`"))
            }
        });
        if let Err(e) = parsed {
            return e.to_compile_error().into();
        }
    }

    // Use `#name::V { .. }` (not `Self::V`) so the same arm tokens work in
    // both the inherent `impl #name` block AND the `impl From<&#name> for Tag`
    // block — inside the latter `Self` would resolve to the *tag* type.
    let arms = variants.iter().map(|v| {
        let ident = &v.ident;
        match &v.fields {
            Fields::Unit => quote! { #name::#ident },
            _ => quote! { #name::#ident { .. } },
        }
    });
    let tag_idents = variants.iter().map(|v| &v.ident);

    if let Some(tag_path) = existing {
        let arms2 = arms.clone();
        let tag_idents2 = tag_idents.clone();
        return quote! {
            impl #impl_g #name #ty_g #where_g {
                /// Data → discriminant projection.
                #[inline]
                pub const fn tag(&self) -> #tag_path {
                    match self {
                        #( #arms => #tag_path::#tag_idents, )*
                    }
                }
            }
            impl #impl_g ::core::convert::From<&#name #ty_g> for #tag_path #where_g {
                #[inline]
                fn from(d: &#name #ty_g) -> Self {
                    match d {
                        #( #arms2 => #tag_path::#tag_idents2, )*
                    }
                }
            }
        }
        .into();
    }

    // Fallback: synthesise `<Name>Tag`.
    let tag_name = syn::Ident::new(&format!("{name}Tag"), name.span());
    let tag_variants = variants.iter().map(|v| &v.ident);
    quote! {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum #tag_name { #( #tag_variants, )* }
        impl #impl_g #name #ty_g #where_g {
            /// Data → discriminant projection.
            #[inline]
            pub const fn tag(&self) -> #tag_name {
                match self {
                    #( #arms => #tag_name::#tag_idents, )*
                }
            }
        }
    }
    .into()
}
