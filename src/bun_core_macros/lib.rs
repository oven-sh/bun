//! Proc-macros for `bun_core`.
//!
//! `pretty_fmt!(FMT, true|false)` is the compile-time port of Zig's
//! `Output.prettyFmt` (`src/bun_core/output.zig`). It rewrites Bun's `<tag>`
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
    Data, DeriveInput, Expr, ExprLit, ExprMacro, Fields, Lit, LitBool, LitStr, Meta, Token,
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

/// 1:1 port of `prettyFmt` from output.zig, plus Zig→Rust format-spec rewrites
/// (`{s}`/`{d}` → `{}`, `{any}`/`{?}` → `{:?}`).
///
/// Colour table lives in `bun_output_tags`; the state machine is kept duplicated
/// vs `bun_core::output::pretty_fmt_runtime` because the two intentionally
/// diverge in the `{` arm (this side rewrites Zig specs `{s}`→`{}` for the
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
                // stray closer — Zig drops it
                i += 1;
            }
            b'{' => {
                // copy `{ ... }` verbatim, optionally rewriting Zig-style specs
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

// ──────────────────────────────────────────────────────────────────────────
// #[derive(CellRefCounted)] / #[derive(ThreadSafeRefCounted)]
// ──────────────────────────────────────────────────────────────────────────
//
// Replaces the former `impl_cell_ref_counted` declarative macro and
// the ~80 hand-written `ref_count: Cell<u32>` + `unsafe impl` pairs. The
// derive locates the intrusive refcount field and emits the trait impl, the
// `AnyRefCounted` bridge (so `RefPtr`/`ScopedRef` accept the type), and
// inherent `ref_()`/`deref()` forwarders so existing call sites keep working
// without importing the trait.
//
// Field selection (first match wins):
//   1. a field annotated `#[ref_count]`
//   2. a field literally named `ref_count`
//
// There is no type-based fallback. An earlier draft fell back on "the unique
// field whose type's last path segment is `Cell`", but that matched any
// `Cell<_>` (e.g. `Cell<bool>`), turning the helpful "no ref_count field
// found" diagnostic into a buried type-mismatch inside generated code. The
// Zig spec (`@FieldType(T, "ref_count")` in src/ptr/ref_count.zig) requires
// the literal name anyway, so rules 1+2 are sufficient and exhaustive.
//
// Custom destructor: `#[ref_count(destroy = Self::deinit)]` on the struct
// routes the trait's `destroy` to that path instead of the default
// `drop(Box::from_raw(this))`.

/// Locate the refcount field per the rules above.
fn find_ref_count_field(fields: &Fields) -> Result<&syn::Ident, syn::Error> {
    let named = match fields {
        Fields::Named(n) => &n.named,
        _ => {
            return Err(syn::Error::new(
                Span::call_site(),
                "ref-count derive: only named-field structs are supported",
            ));
        }
    };

    // 1. explicit #[ref_count] attr (bare, not the struct-level destroy form)
    for f in named {
        if f.attrs
            .iter()
            .any(|a| a.path().is_ident("ref_count") && matches!(a.meta, Meta::Path(_)))
        {
            return Ok(f.ident.as_ref().unwrap());
        }
    }
    // 2. field named `ref_count`
    for f in named {
        if f.ident.as_ref().is_some_and(|i| i == "ref_count") {
            return Ok(f.ident.as_ref().unwrap());
        }
    }
    Err(syn::Error::new(
        Span::call_site(),
        "ref-count derive: no `ref_count` field found; name it `ref_count` or annotate with #[ref_count]",
    ))
}

/// Parse the optional struct-level `#[ref_count(destroy = path)]` attribute.
fn find_destroy_path(attrs: &[syn::Attribute]) -> Result<Option<syn::Expr>, syn::Error> {
    for a in attrs {
        if !a.path().is_ident("ref_count") {
            continue;
        }
        // Only the list form carries `destroy = …`; a bare `#[ref_count]` on
        // the struct is meaningless but tolerated.
        if let Meta::List(_) = &a.meta {
            let mut out = None;
            a.parse_nested_meta(|meta| {
                if meta.path.is_ident("destroy") {
                    let value: syn::Expr = meta.value()?.parse()?;
                    out = Some(value);
                    Ok(())
                } else {
                    Err(meta.error("unknown ref_count attribute key"))
                }
            })?;
            return Ok(out);
        }
    }
    Ok(None)
}

/// `#[derive(CellRefCounted)]` — see module comment above.
#[proc_macro_derive(CellRefCounted, attributes(ref_count))]
pub fn derive_cell_ref_counted(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let fields = match &input.data {
        Data::Struct(s) => &s.fields,
        _ => {
            return syn::Error::new_spanned(name, "CellRefCounted: only structs are supported")
                .to_compile_error()
                .into();
        }
    };

    let field = match find_ref_count_field(fields) {
        Ok(f) => f,
        Err(e) => return e.to_compile_error().into(),
    };
    let destroy = match find_destroy_path(&input.attrs) {
        Ok(d) => d,
        Err(e) => return e.to_compile_error().into(),
    };

    let destroy_impl = destroy.map(|path| {
        quote! {
            #[inline]
            unsafe fn destroy(this: *mut Self) {
                // SAFETY: trait contract — refcount hit zero, `this` is the
                // sole live owner of its allocation.
                #[allow(unused_unsafe)]
                unsafe { (#path)(this) }
            }
        }
    });

    let expanded = quote! {
        unsafe impl #impl_g ::bun_ptr::CellRefCounted for #name #ty_g #where_g {
            #[inline]
            fn ref_count(&self) -> &::core::cell::Cell<u32> { &self.#field }
            #[inline]
            unsafe fn ref_count_raw<'a>(this: *const Self) -> &'a ::core::cell::Cell<u32> {
                // SAFETY: caller contract — `this` is live. Project to the
                // `Cell<u32>` field only; never form `&Self` (callers may hold
                // a live `&mut` on a sibling field — Stacked Borrows).
                unsafe { &*::core::ptr::addr_of!((*this).#field) }
            }
            #destroy_impl
        }
        impl #impl_g ::bun_ptr::AnyRefCounted for #name #ty_g #where_g {
            type DestructorCtx = ();
            #[inline]
            unsafe fn rc_ref(this: *mut Self) {
                // SAFETY: caller contract — `this` is live. Raw field
                // projection; no `&Self` is formed (see `ref_count_raw`).
                let rc = unsafe { &*::core::ptr::addr_of!((*this).#field) };
                rc.set(rc.get() + 1);
            }
            #[inline]
            unsafe fn rc_deref_with_context(this: *mut Self, (): ()) {
                // SAFETY: caller contract — `this` is live.
                unsafe { <Self as ::bun_ptr::CellRefCounted>::deref(this) }
            }
            #[inline]
            unsafe fn rc_has_one_ref(this: *const Self) -> bool {
                // SAFETY: caller contract — `this` is live. Raw field projection.
                unsafe { &*::core::ptr::addr_of!((*this).#field) }.get() == 1
            }
            #[inline]
            unsafe fn rc_assert_no_refs(this: *const Self) {
                debug_assert_eq!(
                    // SAFETY: caller contract — `this` is live. Raw field projection.
                    unsafe { &*::core::ptr::addr_of!((*this).#field) }.get(),
                    0,
                );
            }
            #[cfg(debug_assertions)]
            #[inline]
            unsafe fn rc_debug_data(_this: *mut Self) -> *mut dyn ::bun_ptr::ref_count::DebugDataOps {
                ::bun_ptr::ref_count::noop_debug_data()
            }
        }
        // Inherent forwarders so callers don't need the trait in scope.
        impl #impl_g #name #ty_g #where_g {
            #[inline]
            pub fn ref_(&self) {
                <Self as ::bun_ptr::CellRefCounted>::ref_(self)
            }
            /// # Safety
            /// `this` must point to a live `Self` and the caller must own one
            /// ref. After this call `this` may be dangling.
            #[inline]
            pub unsafe fn deref(this: *mut Self) {
                // SAFETY: forwarded caller contract.
                unsafe { <Self as ::bun_ptr::CellRefCounted>::deref(this) }
            }
        }
    };
    expanded.into()
}

// ──────────────────────────────────────────────────────────────────────────
// #[derive(Anchored)]
// ──────────────────────────────────────────────────────────────────────────
//
// Locates the (unique) field of type `LiveMarker` / `bun_ptr::LiveMarker` /
// `bun_ptr::parent_ref::LiveMarker` (or one annotated `#[live_marker]`) and
// emits the trivial `Anchored` impl. Expands to `::bun_ptr::…` paths so the
// canonical spelling is `#[derive(bun_ptr::Anchored)]`.

fn find_live_marker_field(fields: &Fields) -> Result<&syn::Ident, syn::Error> {
    let named = match fields {
        Fields::Named(n) => &n.named,
        _ => {
            return Err(syn::Error::new(
                Span::call_site(),
                "Anchored derive: only named-field structs are supported",
            ));
        }
    };
    // 1. explicit #[live_marker] attr
    for f in named {
        if f.attrs.iter().any(|a| a.path().is_ident("live_marker")) {
            return Ok(f.ident.as_ref().unwrap());
        }
    }
    // 2. field whose type's last path segment is `LiveMarker`
    let mut found: Option<&syn::Ident> = None;
    for f in named {
        if let syn::Type::Path(tp) = &f.ty {
            if tp
                .path
                .segments
                .last()
                .is_some_and(|s| s.ident == "LiveMarker")
            {
                if found.is_some() {
                    return Err(syn::Error::new_spanned(
                        &f.ty,
                        "Anchored derive: multiple LiveMarker fields; annotate one with #[live_marker]",
                    ));
                }
                found = Some(f.ident.as_ref().unwrap());
            }
        }
    }
    found.ok_or_else(|| {
        syn::Error::new(
            Span::call_site(),
            "Anchored derive: no `LiveMarker` field found; add one or annotate with #[live_marker]",
        )
    })
}

/// `#[derive(Anchored)]` — see `bun_ptr::parent_ref` module docs.
#[proc_macro_derive(Anchored, attributes(live_marker))]
pub fn derive_anchored(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let fields = match &input.data {
        Data::Struct(s) => &s.fields,
        _ => {
            return syn::Error::new_spanned(name, "Anchored: only structs are supported")
                .to_compile_error()
                .into();
        }
    };
    let field = match find_live_marker_field(fields) {
        Ok(f) => f,
        Err(e) => return e.to_compile_error().into(),
    };

    quote! {
        impl #impl_g ::bun_ptr::Anchored for #name #ty_g #where_g {
            #[inline]
            fn live_marker(&self) -> &::bun_ptr::LiveMarker { &self.#field }
        }
    }
    .into()
}

/// `#[derive(ThreadSafeRefCounted)]` — locates the embedded
/// `ThreadSafeRefCount<Self>` field and emits the trait impl plus the
/// `AnyRefCounted` bridge. Custom destructor via `#[ref_count(destroy = …)]`.
#[proc_macro_derive(ThreadSafeRefCounted, attributes(ref_count))]
pub fn derive_thread_safe_ref_counted(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let fields = match &input.data {
        Data::Struct(s) => &s.fields,
        _ => {
            return syn::Error::new_spanned(
                name,
                "ThreadSafeRefCounted: only structs are supported",
            )
            .to_compile_error()
            .into();
        }
    };

    let field = match find_ref_count_field(fields) {
        Ok(f) => f,
        Err(e) => return e.to_compile_error().into(),
    };
    let destroy = match find_destroy_path(&input.attrs) {
        Ok(d) => d,
        Err(e) => return e.to_compile_error().into(),
    };

    let destroy_impl = destroy.map(|path| {
        quote! {
            #[inline]
            unsafe fn destructor(this: *mut Self) {
                // SAFETY: trait contract — refcount hit zero.
                #[allow(unused_unsafe)]
                unsafe { (#path)(this) }
            }
        }
    });

    let expanded = quote! {
        impl #impl_g ::bun_ptr::ThreadSafeRefCounted for #name #ty_g #where_g {
            #[inline]
            unsafe fn get_ref_count(this: *mut Self) -> *mut ::bun_ptr::ThreadSafeRefCount<Self> {
                // SAFETY: caller contract — `this` is live; project the field.
                unsafe { &raw mut (*this).#field }
            }
            #destroy_impl
        }
        impl #impl_g ::bun_ptr::AnyRefCounted for #name #ty_g #where_g {
            type DestructorCtx = ();
            #[inline]
            unsafe fn rc_ref(this: *mut Self) {
                // SAFETY: caller contract — `this` points to a live Self.
                unsafe { ::bun_ptr::ThreadSafeRefCount::<Self>::ref_(this) }
            }
            #[inline]
            unsafe fn rc_deref_with_context(this: *mut Self, (): ()) {
                // SAFETY: caller contract — `this` points to a live Self.
                unsafe { ::bun_ptr::ThreadSafeRefCount::<Self>::deref(this) }
            }
            #[inline]
            unsafe fn rc_has_one_ref(this: *const Self) -> bool {
                // SAFETY: caller contract — `this` points to a live Self.
                unsafe {
                    (*<Self as ::bun_ptr::ThreadSafeRefCounted>::get_ref_count(this.cast_mut()))
                        .has_one_ref()
                }
            }
            #[inline]
            unsafe fn rc_assert_no_refs(this: *const Self) {
                // SAFETY: caller contract — `this` points to a live Self.
                unsafe {
                    (*<Self as ::bun_ptr::ThreadSafeRefCounted>::get_ref_count(this.cast_mut()))
                        .assert_no_refs()
                }
            }
            #[cfg(debug_assertions)]
            #[inline]
            unsafe fn rc_debug_data(this: *mut Self) -> *mut dyn ::bun_ptr::ref_count::DebugDataOps {
                // SAFETY: caller contract — `this` points to a live Self.
                unsafe {
                    (*<Self as ::bun_ptr::ThreadSafeRefCounted>::get_ref_count(this)).debug_data_ptr()
                }
            }
        }
    };
    expanded.into()
}

// ──────────────────────────────────────────────────────────────────────────
// #[derive(RefCounted)]  — intrusive single-thread `RefCount<Self>` mixin
// ──────────────────────────────────────────────────────────────────────────
//
// Third sibling of CellRefCounted / ThreadSafeRefCounted. Ports Zig's
// `bun.ptr.RefCount(@This(), "ref_count", destructor, .{ .debug_name = … })`
// comptime mixin (src/ptr/ref_count.zig:67) — the form taken by ~17 Rust
// hand-rolls that all spell out `type DestructorCtx = (); get_ref_count =
// &raw mut (*this).ref_count; destructor = drop(heap::take(this))`.
//
// Struct-level attribute:
//   #[ref_count(destroy = <path>)]      — `unsafe fn(*mut Self)`; default is
//                                         `drop(::bun_core::heap::take(this))`
//   #[ref_count(debug_name = "Name")]   — overrides `RefCounted::debug_name()`
//                                         (Zig `.{ .debug_name = … }` option)
//
// Field selection follows the shared `find_ref_count_field` rules (a
// `#[ref_count]`-annotated field, else a field literally named `ref_count`).
//
// Unlike `CellRefCounted` this emits **no** inherent `ref_()`/`deref()`
// forwarders and **no** `AnyRefCounted` impl: `bun_ptr::ref_count` already
// provides a blanket `impl<T: RefCounted> AnyRefCounted for T`, and several
// migrated structs keep their own bespoke `ref_`/`r#ref`/`deref` thin
// wrappers — emitting inherent fns here would collide.

/// Parse the struct-level `#[ref_count(destroy = …, debug_name = "…")]`
/// attribute (both keys optional, either order).
fn parse_ref_count_attrs(
    attrs: &[syn::Attribute],
) -> Result<(Option<syn::Expr>, Option<LitStr>), syn::Error> {
    let mut destroy = None;
    let mut debug_name = None;
    for a in attrs {
        if !a.path().is_ident("ref_count") {
            continue;
        }
        if let Meta::List(_) = &a.meta {
            a.parse_nested_meta(|meta| {
                if meta.path.is_ident("destroy") {
                    destroy = Some(meta.value()?.parse::<syn::Expr>()?);
                    Ok(())
                } else if meta.path.is_ident("debug_name") {
                    debug_name = Some(meta.value()?.parse::<LitStr>()?);
                    Ok(())
                } else {
                    Err(meta.error("unknown ref_count attribute key"))
                }
            })?;
        }
    }
    Ok((destroy, debug_name))
}

/// `#[derive(RefCounted)]` — see module comment above.
#[proc_macro_derive(RefCounted, attributes(ref_count))]
pub fn derive_ref_counted(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let fields = match &input.data {
        Data::Struct(s) => &s.fields,
        _ => {
            return syn::Error::new_spanned(name, "RefCounted: only structs are supported")
                .to_compile_error()
                .into();
        }
    };

    let field = match find_ref_count_field(fields) {
        Ok(f) => f,
        Err(e) => return e.to_compile_error().into(),
    };
    let (destroy, debug_name) = match parse_ref_count_attrs(&input.attrs) {
        Ok(v) => v,
        Err(e) => return e.to_compile_error().into(),
    };

    let destructor_body = match destroy {
        Some(path) => quote! {
            // SAFETY: trait contract — refcount hit zero, `this` is the
            // sole live owner of its allocation.
            #[allow(unused_unsafe)]
            unsafe { (#path)(this) }
        },
        None => quote! {
            // SAFETY: trait contract — refcount hit zero; allocated via
            // `heap::alloc`/`Box::into_raw`. `Drop` runs on the boxed value.
            drop(unsafe { ::bun_core::heap::take(this) });
        },
    };
    let debug_name_impl = debug_name.map(|lit| {
        quote! {
            #[inline]
            fn debug_name() -> &'static str { #lit }
        }
    });

    quote! {
        impl #impl_g ::bun_ptr::RefCounted for #name #ty_g #where_g {
            type DestructorCtx = ();
            #debug_name_impl
            #[inline]
            unsafe fn get_ref_count(this: *mut Self) -> *mut ::bun_ptr::RefCount<Self> {
                // SAFETY: caller contract — `this` points to a live Self.
                unsafe { &raw mut (*this).#field }
            }
            #[inline]
            unsafe fn destructor(this: *mut Self, _ctx: ()) {
                #destructor_body
            }
        }
    }
    .into()
}

// ──────────────────────────────────────────────────────────────────────────
// #[derive(EnumTag)]
// ──────────────────────────────────────────────────────────────────────────
//
// Rust port of Zig's `union(Tag)` / `std.meta.Tag(T)` language built-in.
// Every Zig tagged-union ported to a Rust `enum` lost the implicit
// data→discriminant projection and grew a hand-written
// `fn tag(&self) -> Tag { match self { Self::A(..) => Tag::A, … } }` (14
// copies, 160+ arms total — see ast/expr.rs, ast/stmt.rs, shell_parser, etc.;
// stmt.rs:466 literally comments "Zig got this for free from `union(Tag)`").
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
                /// Data → discriminant projection (Zig `union(Tag)` built-in).
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
            /// Data → discriminant projection (Zig `union(Tag)` built-in).
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
