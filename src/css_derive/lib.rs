//! Proc-macro derives for `bun_css`.
//!
//! `#[derive(DeepClone)]` is the compile-time port of Zig's
//! `css.implementDeepClone(@This(), this, allocator)` (`src/css/generics.zig`).
//! The Zig original is `@typeInfo(T)` reflection that walks struct fields /
//! union variants and calls `.deepClone(allocator)` on each. Rust has no
//! reflection, so the derive emits the equivalent field-wise / variant-wise
//! recursion as an `impl bun_css::generics::DeepClone<'bump> for T`.
//!
//! The generated body intentionally uses **method-syntax** dispatch
//! (`field.deep_clone(bump)`) rather than the fully-qualified trait path so
//! that — exactly like the Zig — a leaf type may satisfy the call with either
//! an inherent `pub fn deep_clone(&self, &Arena) -> Self` *or* a
//! `DeepClone` trait impl. The trait is brought into scope inside the
//! generated fn body so the blanket impls in `bun_css::generics` (Option,
//! Vec, Box, slices, primitives, …) resolve transparently.
//!
//! Generics handling:
//!   * If the deriving type already carries a lifetime parameter, the **first**
//!     one is reused as the arena lifetime (`DeepClone<'that>`). Every CSS AST
//!     type that borrows from the parser arena threads exactly one `'bump`.
//!   * Otherwise a fresh `'__bump` is introduced on the impl.
//!   * Each type parameter `T` gets a `T: DeepClone<'bump>` where-bound so
//!     generic containers like `CssRule<R>` constrain their payload.

use proc_macro::TokenStream;
use proc_macro2::{Span, TokenStream as TokenStream2};
use quote::{format_ident, quote};
use syn::{
    parse_macro_input, parse_quote, Attribute, Data, DeriveInput, Fields, GenericParam, Lifetime,
    LifetimeParam, Meta,
};

#[proc_macro_derive(DeepClone)]
pub fn derive_deep_clone(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_deep_clone(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

// ════════════════════════════════════════════════════════════════════════════
// `CssEql` / `CssHash`
// ════════════════════════════════════════════════════════════════════════════
//
// Port of `implementEql` / `implementHash` in `src/css/generics.zig`.
//
// Zig's `implementEql` / `implementHash` use `@typeInfo(T)` to walk struct
// fields or `union(enum)` variants and recurse via `eql(field.type, …)` /
// `hash(field.type, …)`, which in turn dispatch to `T.eql` / `T.hash` if the
// type `@hasDecl`s one. The derives below preserve that two-level dispatch by
// emitting **method-syntax** calls (`field.eql(other)`, `field.hash(hasher)`)
// with the trait brought into scope inside the body — so a field type may
// satisfy the recursion either with an inherent `pub fn eql/hash` *or* a
// `CssEql`/`CssHash` impl (Option, slices, primitives, … from
// `bun_css::generics`).
//
// Unions: Zig prefixes the hash with `bun.writeAnyToHasher(@intFromEnum(this))`.
// The derive feeds the variant index as a `u32` (CSS hashing is in-process
// dedup only — self-consistency, not Zig-byte-identity, is the contract).

#[proc_macro_derive(CssEql)]
pub fn derive_css_eql(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_css_eql(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

#[proc_macro_derive(CssHash)]
pub fn derive_css_hash(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_css_hash(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// Clone the input generics and append `where T: $trait_path` for every type
/// parameter so generic containers (`Foo<T>`) constrain their payload.
fn with_trait_bounds(input: &DeriveInput, trait_path: TokenStream2) -> syn::Generics {
    let mut g = input.generics.clone();
    let ty_params: Vec<_> = input.generics.type_params().map(|tp| tp.ident.clone()).collect();
    if !ty_params.is_empty() {
        let wc = g.make_where_clause();
        for ident in ty_params {
            wc.predicates.push(parse_quote! { #ident: #trait_path });
        }
    }
    g
}

fn expand_css_eql(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let generics = with_trait_bounds(&input, quote!(::bun_css::generics::CssEql));
    let (impl_g, ty_g, where_g) = generics.split_for_impl();

    let body = match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Unit => quote! { true },
            Fields::Unnamed(fs) => {
                let idx = (0..fs.unnamed.len()).map(syn::Index::from);
                quote! { #( self.#idx.eql(&__other.#idx) )&&* }
            }
            Fields::Named(fs) => {
                let names: Vec<_> = fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                if names.is_empty() {
                    quote! { true }
                } else {
                    quote! { #( self.#names.eql(&__other.#names) )&&* }
                }
            }
        },
        Data::Enum(e) => {
            let arms = e.variants.iter().map(|v| {
                let vname = &v.ident;
                match &v.fields {
                    Fields::Unit => quote! {
                        (Self::#vname, Self::#vname) => true,
                    },
                    Fields::Unnamed(fs) => {
                        let la: Vec<_> = (0..fs.unnamed.len())
                            .map(|i| format_ident!("__l{}", i))
                            .collect();
                        let ra: Vec<_> = (0..fs.unnamed.len())
                            .map(|i| format_ident!("__r{}", i))
                            .collect();
                        let cmp = if la.is_empty() {
                            quote! { true }
                        } else {
                            quote! { #( #la.eql(#ra) )&&* }
                        };
                        quote! {
                            (Self::#vname( #(#la),* ), Self::#vname( #(#ra),* )) => #cmp,
                        }
                    }
                    Fields::Named(fs) => {
                        let fnames: Vec<_> =
                            fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                        let la: Vec<_> =
                            fnames.iter().map(|n| format_ident!("__l_{}", n)).collect();
                        let ra: Vec<_> =
                            fnames.iter().map(|n| format_ident!("__r_{}", n)).collect();
                        let cmp = if fnames.is_empty() {
                            quote! { true }
                        } else {
                            quote! { #( #la.eql(#ra) )&&* }
                        };
                        quote! {
                            (Self::#vname { #(#fnames: #la),* },
                             Self::#vname { #(#fnames: #ra),* }) => #cmp,
                        }
                    }
                }
            });
            // Zig: `if (@intFromEnum(this) != @intFromEnum(other)) return false;`
            // — i.e. mismatched tags are simply unequal.
            quote! {
                match (self, __other) {
                    #(#arms)*
                    #[allow(unreachable_patterns)]
                    _ => false,
                }
            }
        }
        Data::Union(_) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(CssEql)] is not supported on `union`s",
            ));
        }
    };

    Ok(quote! {
        #[automatically_derived]
        impl #impl_g ::bun_css::generics::CssEql for #name #ty_g #where_g {
            #[inline]
            fn eql(&self, __other: &Self) -> bool {
                #[allow(unused_imports)]
                use ::bun_css::generics::CssEql as _;
                #body
            }
        }
    })
}

fn expand_css_hash(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let generics = with_trait_bounds(&input, quote!(::bun_css::generics::CssHash));
    let (impl_g, ty_g, where_g) = generics.split_for_impl();

    let body = match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Unit => quote! {},
            Fields::Unnamed(fs) => {
                let idx = (0..fs.unnamed.len()).map(syn::Index::from);
                quote! { #( self.#idx.hash(__hasher); )* }
            }
            Fields::Named(fs) => {
                let names: Vec<_> = fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                quote! { #( self.#names.hash(__hasher); )* }
            }
        },
        Data::Enum(e) => {
            let arms = e.variants.iter().enumerate().map(|(i, v)| {
                let vname = &v.ident;
                let disc = i as u32;
                // Zig: `bun.writeAnyToHasher(hasher, @intFromEnum(this))`.
                let tag = quote! { __hasher.update(&(#disc as u32).to_ne_bytes()); };
                match &v.fields {
                    Fields::Unit => quote! {
                        Self::#vname => { #tag }
                    },
                    Fields::Unnamed(fs) => {
                        let binds: Vec<_> = (0..fs.unnamed.len())
                            .map(|j| format_ident!("__f{}", j))
                            .collect();
                        quote! {
                            Self::#vname( #(#binds),* ) => {
                                #tag
                                #( #binds.hash(__hasher); )*
                            }
                        }
                    }
                    Fields::Named(fs) => {
                        let fnames: Vec<_> =
                            fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                        quote! {
                            Self::#vname { #(#fnames),* } => {
                                #tag
                                #( #fnames.hash(__hasher); )*
                            }
                        }
                    }
                }
            });
            quote! { match self { #(#arms)* } }
        }
        Data::Union(_) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(CssHash)] is not supported on `union`s",
            ));
        }
    };

    Ok(quote! {
        #[automatically_derived]
        impl #impl_g ::bun_css::generics::CssHash for #name #ty_g #where_g {
            #[inline]
            fn hash(&self, __hasher: &mut ::bun_css::generics::Wyhash) {
                #[allow(unused_imports)]
                use ::bun_css::generics::CssHash as _;
                let _ = __hasher;
                #body
            }
        }
    })
}

#[proc_macro_derive(DeepCloneDummy_DoNotUse)]
pub fn _derive_deep_clone_dummy(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_deep_clone(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_deep_clone(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;

    // Pick the arena lifetime: reuse the type's first lifetime param, or mint
    // a fresh `'__bump` if it has none.
    let existing_lt = input
        .generics
        .lifetimes()
        .next()
        .map(|l| l.lifetime.clone());
    let bump_lt = existing_lt
        .clone()
        .unwrap_or_else(|| Lifetime::new("'__bump", Span::call_site()));

    // Build the impl-side generics (may need an extra lifetime + where-bounds).
    let mut impl_generics = input.generics.clone();
    if existing_lt.is_none() {
        impl_generics.params.insert(
            0,
            GenericParam::Lifetime(LifetimeParam::new(bump_lt.clone())),
        );
    }
    {
        // `T: DeepClone<'bump>` for every type parameter.
        let ty_params: Vec<_> = input
            .generics
            .type_params()
            .map(|tp| tp.ident.clone())
            .collect();
        if !ty_params.is_empty() {
            let wc = impl_generics.make_where_clause();
            for ident in ty_params {
                wc.predicates.push(parse_quote! {
                    #ident: ::bun_css::generics::DeepClone<#bump_lt>
                });
            }
        }
    }

    let (impl_g, _, where_g) = impl_generics.split_for_impl();
    let (_, ty_g, _) = input.generics.split_for_impl();

    let body = match &input.data {
        Data::Struct(s) => clone_fields(&s.fields, quote!(Self)),
        Data::Enum(e) => {
            let arms = e.variants.iter().map(|v| {
                let vname = &v.ident;
                match &v.fields {
                    Fields::Unit => quote! { Self::#vname => Self::#vname, },
                    Fields::Unnamed(fs) => {
                        let binds: Vec<_> = (0..fs.unnamed.len())
                            .map(|i| format_ident!("__f{}", i))
                            .collect();
                        quote! {
                            Self::#vname( #(#binds),* ) =>
                                Self::#vname( #( #binds.deep_clone(__bump) ),* ),
                        }
                    }
                    Fields::Named(fs) => {
                        let names: Vec<_> =
                            fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                        quote! {
                            Self::#vname { #(#names),* } =>
                                Self::#vname { #( #names: #names.deep_clone(__bump) ),* },
                        }
                    }
                }
            });
            quote! { match self { #(#arms)* } }
        }
        Data::Union(_) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(DeepClone)] is not supported on `union`s",
            ));
        }
    };

    Ok(quote! {
        #[automatically_derived]
        impl #impl_g ::bun_css::generics::DeepClone<#bump_lt> for #name #ty_g #where_g {
            #[inline]
            fn deep_clone(&self, __bump: & #bump_lt ::bun_alloc::Arena) -> Self {
                #[allow(unused_imports)]
                use ::bun_css::generics::DeepClone as _;
                let _ = __bump;
                #body
            }
        }
    })
}

// ════════════════════════════════════════════════════════════════════════════
// `DefineEnumProperty` / `DeriveParse` / `DeriveToCss`
// ════════════════════════════════════════════════════════════════════════════
//
// Port of `src/css/css_parser.zig`:
//
//   pub fn DefineEnumProperty(comptime T: type) type {
//       const fields = std.meta.fields(T);
//       return struct {
//           pub fn parse(input)  → expectIdent → eqlCaseInsensitiveASCII vs field.name
//           pub fn toCss(this)   → dest.writeStr(@tagName(this.*))
//           pub fn eql / hash / deepClone …
//       };
//   }
//
// Zig's `@tagName` yields the literal field identifier (`@"table-row-group"`),
// so the CSS keyword is encoded directly in the variant name. Rust variant
// names are PascalCase, so the derive maps `TableRowGroup → "table-row-group"`
// by default and accepts an explicit `#[css(name = "…")]` / `#[css("…")]`
// override where the kebab-case mapping doesn't round-trip (e.g.
// `Preserve3d → "preserve-3d"`).
//
// Generated surface for a unit-only enum `T`:
//   * `impl From<T> for &'static str` — satisfies `EnumProperty: Into<&'static str>`
//   * `impl bun_css::EnumProperty for T { fn from_ascii_case_insensitive }`
//   * inherent `T::as_str` / `T::parse` / `T::to_css` so call-sites needn't
//     import the trait (mirrors Zig's `pub const parse = css_impl.parse;`)
//
// `DeriveParse` / `DeriveToCss` (exposed under both their Zig names and the
// shorter `Parse` / `ToCss` aliases used by some ported leaves) handle
// `union(enum)`-shaped Rust enums: unit variants serialize as keywords,
// single-payload tuple variants delegate to the payload's own
// `parse` / `to_css`. Ordering follows the Zig `generateCode` contract: void
// and payload variants must each be contiguous; whichever group is declared
// first is attempted first.

/// Convert a Rust `PascalCase` identifier to a CSS kebab-case keyword.
/// `TableRowGroup` → `table-row-group`, `RunIn` → `run-in`, `Nowrap` → `nowrap`.
fn pascal_to_kebab(ident: &str) -> String {
    let mut out = String::with_capacity(ident.len() + 4);
    for (i, ch) in ident.char_indices() {
        if ch.is_ascii_uppercase() {
            if i != 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Extract an explicit CSS keyword from `#[css(name = "…")]`, `#[css("…")]`,
/// or (for compatibility with already-ported leaves) `#[strum(serialize = "…")]`.
fn css_keyword_attr(attrs: &[Attribute]) -> Option<String> {
    for attr in attrs {
        if attr.path().is_ident("css") {
            // `#[css("literal")]` — bare string in a paren list.
            if let Meta::List(list) = &attr.meta {
                if let Ok(lit) = syn::parse2::<syn::LitStr>(list.tokens.clone()) {
                    return Some(lit.value());
                }
            }
            // `#[css(name = "literal")]`
            let mut found = None;
            let _ = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("name") || meta.path.is_ident("keyword") {
                    let lit: syn::LitStr = meta.value()?.parse()?;
                    found = Some(lit.value());
                }
                Ok(())
            });
            if found.is_some() {
                return found;
            }
        }
        if attr.path().is_ident("strum") {
            let mut found = None;
            let _ = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("serialize") {
                    let lit: syn::LitStr = meta.value()?.parse()?;
                    found = Some(lit.value());
                }
                Ok(())
            });
            if found.is_some() {
                return found;
            }
        }
    }
    None
}

fn variant_keyword(ident: &syn::Ident, attrs: &[Attribute]) -> String {
    css_keyword_attr(attrs).unwrap_or_else(|| pascal_to_kebab(&ident.to_string()))
}

#[proc_macro_derive(DefineEnumProperty, attributes(css))]
pub fn derive_define_enum_property(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_enum_property(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_enum_property(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            name,
            "#[derive(DefineEnumProperty)] is only valid on field-less enums",
        ));
    };

    let mut to_str_arms = Vec::with_capacity(data.variants.len());
    let mut from_ident_arms = Vec::with_capacity(data.variants.len());

    for v in &data.variants {
        if !matches!(v.fields, Fields::Unit) {
            return Err(syn::Error::new_spanned(
                &v.ident,
                "#[derive(DefineEnumProperty)] requires every variant to be a unit \
                 (keyword) variant; use #[derive(Parse, ToCss)] for payload-carrying enums",
            ));
        }
        let vname = &v.ident;
        let kw = variant_keyword(vname, &v.attrs);
        let kw_bytes = syn::LitByteStr::new(kw.as_bytes(), vname.span());
        to_str_arms.push(quote! { #name::#vname => #kw, });
        from_ident_arms.push(quote! {
            if __ident.eq_ignore_ascii_case(#kw_bytes) {
                return ::core::option::Option::Some(#name::#vname);
            }
        });
    }

    Ok(quote! {
        #[automatically_derived]
        impl ::core::convert::From<#name> for &'static str {
            #[inline]
            fn from(__v: #name) -> &'static str {
                match __v { #(#to_str_arms)* }
            }
        }

        #[automatically_derived]
        impl ::bun_css::EnumProperty for #name {
            #[inline]
            fn from_ascii_case_insensitive(__ident: &[u8]) -> ::core::option::Option<Self> {
                #(#from_ident_arms)*
                ::core::option::Option::None
            }
        }

        #[automatically_derived]
        #[allow(dead_code)]
        impl #name {
            /// CSS keyword for this variant (Zig: `@tagName`).
            #[inline]
            pub const fn as_str(&self) -> &'static str {
                match *self { #(#to_str_arms)* }
            }
            #[inline]
            pub fn parse(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
            ) -> ::bun_css::Result<Self> {
                <Self as ::bun_css::EnumProperty>::parse(__input)
            }
            #[inline]
            pub fn to_css(
                &self,
                __dest: &mut ::bun_css::printer::Printer<'_>,
            ) -> ::core::result::Result<(), ::bun_css::PrintErr> {
                <Self as ::bun_css::EnumProperty>::to_css(self, __dest)
            }
        }
    })
}

// ───────────────────────── DeriveParse / DeriveToCss ─────────────────────────

#[proc_macro_derive(Parse, attributes(css))]
pub fn derive_parse(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_derive_parse(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

#[proc_macro_derive(DeriveParse, attributes(css))]
pub fn derive_derive_parse(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_derive_parse(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

#[proc_macro_derive(ToCss, attributes(css))]
pub fn derive_to_css(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_derive_to_css(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

#[proc_macro_derive(DeriveToCss, attributes(css))]
pub fn derive_derive_to_css(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_derive_to_css(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// One variant of a `union(enum)` shape.
enum VariantShape<'a> {
    /// `Foo` — keyword
    Unit { ident: &'a syn::Ident, keyword: String },
    /// `Foo(Payload)` — single unnamed field
    Payload { ident: &'a syn::Ident, ty: &'a syn::Type },
}

fn classify<'a>(data: &'a syn::DataEnum) -> syn::Result<Vec<VariantShape<'a>>> {
    let mut out = Vec::with_capacity(data.variants.len());
    for v in &data.variants {
        match &v.fields {
            Fields::Unit => out.push(VariantShape::Unit {
                ident: &v.ident,
                keyword: variant_keyword(&v.ident, &v.attrs),
            }),
            Fields::Unnamed(fs) if fs.unnamed.len() == 1 => out.push(VariantShape::Payload {
                ident: &v.ident,
                ty: &fs.unnamed.first().unwrap().ty,
            }),
            _ => {
                return Err(syn::Error::new_spanned(
                    &v.ident,
                    "#[derive(Parse/ToCss)] supports unit variants and single-field tuple \
                     variants only (Zig `union(enum)` shape)",
                ));
            }
        }
    }
    Ok(out)
}

fn expand_derive_to_css(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new_spanned(name, "#[derive(ToCss)] is only valid on enums"));
    };
    let shapes = classify(data)?;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    let arms = shapes.iter().map(|s| match s {
        VariantShape::Unit { ident, keyword } => {
            let kw = syn::LitByteStr::new(keyword.as_bytes(), ident.span());
            quote! { #name::#ident => __dest.write_str(#kw), }
        }
        VariantShape::Payload { ident, .. } => {
            quote! { #name::#ident(__inner) => __inner.to_css(__dest), }
        }
    });

    Ok(quote! {
        #[automatically_derived]
        #[allow(dead_code)]
        impl #impl_g #name #ty_g #where_g {
            pub fn to_css(
                &self,
                __dest: &mut ::bun_css::printer::Printer<'_>,
            ) -> ::core::result::Result<(), ::bun_css::PrintErr> {
                match self { #(#arms)* }
            }
        }
    })
}

fn expand_derive_parse(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new_spanned(name, "#[derive(Parse)] is only valid on enums"));
    };
    let shapes = classify(data)?;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();

    // Zig `DeriveParse` requires void variants and payload variants to each be
    // contiguous, and tries them in declaration-block order. We honour the same
    // contract: split into the two contiguous groups and emit whichever is
    // declared first, first.
    let mut units: Vec<(&syn::Ident, String)> = Vec::new();
    let mut payloads: Vec<(&syn::Ident, &syn::Type)> = Vec::new();
    let units_first = matches!(shapes.first(), Some(VariantShape::Unit { .. }));
    for s in &shapes {
        match s {
            VariantShape::Unit { ident, keyword } => units.push((ident, keyword.clone())),
            VariantShape::Payload { ident, ty } => payloads.push((ident, ty)),
        }
    }

    // Unit-variant block: try to match a single ident against the keyword set.
    // Uses `try_parse` so the parser cursor rewinds on no-match (Zig:
    // `input.tryParse(parseIdentMatching, .{...})`).
    let unit_block = if units.is_empty() {
        quote! {}
    } else {
        let arms = units.iter().map(|(ident, kw)| {
            let kw = syn::LitByteStr::new(kw.as_bytes(), ident.span());
            quote! {
                if __id.eq_ignore_ascii_case(#kw) {
                    return ::core::result::Result::Ok(#name::#ident);
                }
            }
        });
        quote! {
            if let ::core::result::Result::Ok(__v) = __input.try_parse(
                |__p: &mut ::bun_css::css_parser::Parser<'_>| -> ::bun_css::Result<Self> {
                    let __loc = __p.current_source_location();
                    let __id = __p.expect_ident()?;
                    #(#arms)*
                    ::core::result::Result::Err(
                        __loc.new_unexpected_token_error(::bun_css::Token::Ident(
                            // SAFETY: `__id` is a sub-slice of the parser's source
                            // buffer (see `enum_property_util::parse`).
                            unsafe { ::bun_css::css_parser::src_str(__id) },
                        )),
                    )
                },
            ) {
                return ::core::result::Result::Ok(__v);
            }
        }
    };

    // Payload block: try each payload's inherent/trait `parse` in order; the
    // last one is non-`try` so its error propagates (Zig: last_payload_index).
    let payload_block = if payloads.is_empty() {
        quote! {}
    } else {
        let last = payloads.len() - 1;
        let stmts = payloads.iter().enumerate().map(|(i, (ident, ty))| {
            if i == last {
                quote! {
                    return <#ty>::parse(__input).map(#name::#ident);
                }
            } else {
                quote! {
                    if let ::core::result::Result::Ok(__v) =
                        __input.try_parse(<#ty>::parse)
                    {
                        return ::core::result::Result::Ok(#name::#ident(__v));
                    }
                }
            }
        });
        quote! { #(#stmts)* }
    };

    // Tail error for the (units-only / units-after-payload) case where neither
    // block returned. Mirrors Zig's `newErrorForNextToken()`.
    let tail_err = quote! {
        ::core::result::Result::Err(__input.new_error_for_next_token())
    };

    let body = if units_first {
        quote! { #unit_block #payload_block #[allow(unreachable_code)] #tail_err }
    } else {
        quote! { #payload_block #unit_block #[allow(unreachable_code)] #tail_err }
    };

    Ok(quote! {
        #[automatically_derived]
        #[allow(dead_code)]
        impl #impl_g #name #ty_g #where_g {
            pub fn parse(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
            ) -> ::bun_css::Result<Self> {
                #body
            }
        }
    })
}

/// Field-wise clone body for a struct (or a single enum variant's payload).
/// `ctor` is the path to construct (`Self` or `Self::Variant`).
fn clone_fields(fields: &Fields, ctor: TokenStream2) -> TokenStream2 {
    match fields {
        Fields::Unit => quote! { #ctor },
        Fields::Unnamed(fs) => {
            let idx = (0..fs.unnamed.len()).map(syn::Index::from);
            quote! { #ctor( #( self.#idx.deep_clone(__bump) ),* ) }
        }
        Fields::Named(fs) => {
            let names: Vec<_> = fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
            quote! { #ctor { #( #names: self.#names.deep_clone(__bump) ),* } }
        }
    }
}
