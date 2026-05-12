//! Proc-macro derives for `bun_css`.
//!
//! `#[derive(DeepClone)]` is the compile-time port of Zig's
//! `css.implementDeepClone(@This(), this, allocator)` (`src/css/generics.zig`).
//! The Zig original is `@typeInfo(T)` reflection that walks struct fields /
//! union variants and calls `.deepClone(allocator)` on each. Rust has no
//! reflection, so the derive emits the equivalent field-wise / variant-wise
//! recursion as an `impl bun_css::generics::DeepClone<'bump> for T`.
//!
//! The generated body uses **UFCS** dispatch
//! (`::bun_css::generics::DeepClone::deep_clone(&field, bump)`), so the call
//! resolves *only* through the trait — never an inherent. This sidesteps Rust's
//! method-probe rule that selects an inherent by *name only* (and would
//! otherwise let an unrelated `Vec::deep_clone(&self) -> Result<_,_>`
//! shadow the blanket `impl DeepClone for Vec<T>` and fail E0061).
//!
//! Consequence: every leaf type reached by a derive **must** carry a real
//! `DeepClone` (or `CssEql`/`CssHash`/`IsCompatible`) trait impl — an
//! inherent `pub fn deep_clone` alone is no longer sufficient. The blanket
//! impls in `bun_css::generics` cover Option, Vec, Box, slices, primitives,
//! `SmallList`, `Vec`, …; everything else derives or hand-implements the
//! trait.
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
    Attribute, Data, DeriveInput, Fields, GenericParam, Lifetime, LifetimeParam, Meta,
    parse_macro_input, parse_quote,
};

// ════════════════════════════════════════════════════════════════════════════
// CANONICAL: the existing `bun_css_derive` proc-macros — **NO new code required**.
// ════════════════════════════════════════════════════════════════════════════
//
// The five derives below already exist (entry points: `DeepClone`, `CssEql`,
// `IsCompatible`, `Parse`, `ToCss`) and already emit exactly the per-variant
// dispatch the hand-expansions at the listed sites spell out by hand. They are
// the direct Rust port of Zig's `css.DeriveParse` / `css.DeriveToCss` /
// `css.implementDeepClone` / `css.implementEql` / `comptime is_compatible`
// field-walks. Nothing is added here; this comment is the contract surface the
// `css-value-enum-to_css-deep_clone-hand-dispatch` migration relies on.

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
// type `@hasDecl`s one. The derives below emit **UFCS** calls
// (`::bun_css::generics::CssEql::eql(&field, other)`,
//  `::bun_css::generics::CssHash::hash(&field, hasher)`) so dispatch is
// *always* through the trait — an inherent `eql`/`hash` on a field type is
// ignored and never shadows. Every field type reached by the derive must
// therefore carry a real `CssEql`/`CssHash` impl (blanket or derived).
//
// Unions: Zig prefixes the hash with `bun.writeAnyToHasher(@intFromEnum(this))`.
// The derive feeds the variant index as a `u32` (CSS hashing is in-process
// dedup only — self-consistency, not Zig-byte-identity, is the contract).

#[proc_macro_derive(CssEql, attributes(css))]
pub fn derive_css_eql(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_css_eql(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

#[proc_macro_derive(CssHash, attributes(css))]
pub fn derive_css_hash(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_css_hash(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// `#[css(skip)]` on a field (or variant) excludes it from the derived
/// `eql` / `hash` / `is_compatible` body. Mirrors the Zig pattern where some
/// struct fields (e.g. `loc: bun.logger.Loc`, `vendor_prefix: VendorPrefix`)
/// are not part of value identity / browser-compat.
fn has_css_skip(attrs: &[Attribute]) -> bool {
    for attr in attrs {
        if !attr.path().is_ident("css") {
            continue;
        }
        let mut skip = false;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("skip") {
                skip = true;
            }
            Ok(())
        });
        if skip {
            return true;
        }
    }
    false
}

/// Clone the input generics and append `where T: $trait_path` for every type
/// parameter so generic containers (`Foo<T>`) constrain their payload.
fn with_trait_bounds(input: &DeriveInput, trait_path: TokenStream2) -> syn::Generics {
    let mut g = input.generics.clone();
    let ty_params: Vec<_> = input
        .generics
        .type_params()
        .map(|tp| tp.ident.clone())
        .collect();
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
                let idx: Vec<_> = fs
                    .unnamed
                    .iter()
                    .enumerate()
                    .filter(|(_, f)| !has_css_skip(&f.attrs))
                    .map(|(i, _)| syn::Index::from(i))
                    .collect();
                if idx.is_empty() {
                    quote! { true }
                } else {
                    quote! { #( ::bun_css::generics::CssEql::eql(&self.#idx, &__other.#idx) )&&* }
                }
            }
            Fields::Named(fs) => {
                let names: Vec<_> = fs
                    .named
                    .iter()
                    .filter(|f| !has_css_skip(&f.attrs))
                    .map(|f| f.ident.clone().unwrap())
                    .collect();
                if names.is_empty() {
                    quote! { true }
                } else {
                    quote! { #( ::bun_css::generics::CssEql::eql(&self.#names, &__other.#names) )&&* }
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
                        let n = fs.unnamed.len();
                        let la: Vec<_> = (0..n).map(|i| format_ident!("__l{}", i)).collect();
                        let ra: Vec<_> = (0..n).map(|i| format_ident!("__r{}", i)).collect();
                        let kept: Vec<_> = fs
                            .unnamed
                            .iter()
                            .enumerate()
                            .filter(|(_, f)| !has_css_skip(&f.attrs))
                            .map(|(i, _)| i)
                            .collect();
                        let cmp = if kept.is_empty() {
                            quote! { true }
                        } else {
                            let lk = kept.iter().map(|&i| &la[i]);
                            let rk = kept.iter().map(|&i| &ra[i]);
                            quote! { #( ::bun_css::generics::CssEql::eql(#lk, #rk) )&&* }
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
                        let kept: Vec<_> = fs
                            .named
                            .iter()
                            .enumerate()
                            .filter(|(_, f)| !has_css_skip(&f.attrs))
                            .map(|(i, _)| i)
                            .collect();
                        let cmp = if kept.is_empty() {
                            quote! { true }
                        } else {
                            let lk = kept.iter().map(|&i| &la[i]);
                            let rk = kept.iter().map(|&i| &ra[i]);
                            quote! { #( ::bun_css::generics::CssEql::eql(#lk, #rk) )&&* }
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
            #[allow(unused_variables)]
            fn eql(&self, __other: &Self) -> bool {
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
                let idx = fs
                    .unnamed
                    .iter()
                    .enumerate()
                    .filter(|(_, f)| !has_css_skip(&f.attrs))
                    .map(|(i, _)| syn::Index::from(i));
                quote! { #( ::bun_css::generics::CssHash::hash(&self.#idx, __hasher); )* }
            }
            Fields::Named(fs) => {
                let names: Vec<_> = fs
                    .named
                    .iter()
                    .filter(|f| !has_css_skip(&f.attrs))
                    .map(|f| f.ident.clone().unwrap())
                    .collect();
                quote! { #( ::bun_css::generics::CssHash::hash(&self.#names, __hasher); )* }
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
                        let kept: Vec<_> = fs
                            .unnamed
                            .iter()
                            .enumerate()
                            .filter(|(_, f)| !has_css_skip(&f.attrs))
                            .map(|(j, _)| binds[j].clone())
                            .collect();
                        quote! {
                            Self::#vname( #(#binds),* ) => {
                                #tag
                                #( ::bun_css::generics::CssHash::hash(#kept, __hasher); )*
                            }
                        }
                    }
                    Fields::Named(fs) => {
                        let fnames: Vec<_> =
                            fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                        let kept: Vec<_> = fs
                            .named
                            .iter()
                            .filter(|f| !has_css_skip(&f.attrs))
                            .map(|f| f.ident.clone().unwrap())
                            .collect();
                        quote! {
                            Self::#vname { #(#fnames),* } => {
                                #tag
                                #( ::bun_css::generics::CssHash::hash(#kept, __hasher); )*
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
            #[allow(unused_variables)]
            fn hash(&self, __hasher: &mut ::bun_css::generics::Wyhash) {
                let _ = __hasher;
                #body
            }
        }
    })
}

// ════════════════════════════════════════════════════════════════════════════
// `IsCompatible`
// ════════════════════════════════════════════════════════════════════════════
//
// Port of `isCompatible` in `src/css/generics.zig`. The Zig dispatches via
// `@hasDecl(T, "isCompatible")` for leaf types, dereferences pointers, and
// iterates list containers — anything else is a `@compileError`. The trait
// blanket impls in `bun_css::generics` cover refs/containers; this derive
// handles the *compound* shapes the Zig leaves to per-type `isCompatible`
// methods:
//
//   * structs → AND of every (non-`#[css(skip)]`) field's `.is_compatible(b)`
//     (the hand-written pattern in e.g. `BorderImageRepeat`, `Rect<T>`,
//     `Size2D<T>`).
//   * enums   → unit variants are always compatible; payload variants delegate
//     to the payload's `.is_compatible(b)` (the hand-written pattern in e.g.
//     `FontWeight`, `BorderSideWidth`, `FontFamily`).
//
// As with `CssEql`/`CssHash`, the body uses **UFCS** dispatch
// (`::bun_css::generics::IsCompatible::is_compatible(&field, b)`) so the call
// resolves only through the trait — every payload type must carry an
// `IsCompatible` impl (blanket or derived); inherent methods are ignored.

#[proc_macro_derive(IsCompatible, attributes(css))]
pub fn derive_is_compatible(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_is_compatible(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_is_compatible(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let generics = with_trait_bounds(&input, quote!(::bun_css::generics::IsCompatible));
    let (impl_g, ty_g, where_g) = generics.split_for_impl();

    let body = match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Unit => quote! { true },
            Fields::Unnamed(fs) => {
                let idx: Vec<_> = fs
                    .unnamed
                    .iter()
                    .enumerate()
                    .filter(|(_, f)| !has_css_skip(&f.attrs))
                    .map(|(i, _)| syn::Index::from(i))
                    .collect();
                if idx.is_empty() {
                    quote! { true }
                } else {
                    quote! { #( ::bun_css::generics::IsCompatible::is_compatible(&self.#idx, __browsers) )&&* }
                }
            }
            Fields::Named(fs) => {
                let names: Vec<_> = fs
                    .named
                    .iter()
                    .filter(|f| !has_css_skip(&f.attrs))
                    .map(|f| f.ident.clone().unwrap())
                    .collect();
                if names.is_empty() {
                    quote! { true }
                } else {
                    quote! { #( ::bun_css::generics::IsCompatible::is_compatible(&self.#names, __browsers) )&&* }
                }
            }
        },
        Data::Enum(e) => {
            let arms = e.variants.iter().map(|v| {
                let vname = &v.ident;
                // `#[css(skip)]` on a variant → always compatible (used for
                // keyword-only variants that map to no `Feature`).
                if has_css_skip(&v.attrs) {
                    return quote! { Self::#vname { .. } => true, };
                }
                match &v.fields {
                    Fields::Unit => quote! { Self::#vname => true, },
                    Fields::Unnamed(fs) => {
                        let binds: Vec<_> = (0..fs.unnamed.len())
                            .map(|j| format_ident!("__f{}", j))
                            .collect();
                        let kept: Vec<_> = fs
                            .unnamed
                            .iter()
                            .enumerate()
                            .filter(|(_, f)| !has_css_skip(&f.attrs))
                            .map(|(j, _)| binds[j].clone())
                            .collect();
                        let body = if kept.is_empty() {
                            quote! { true }
                        } else {
                            quote! { #( ::bun_css::generics::IsCompatible::is_compatible(#kept, __browsers) )&&* }
                        };
                        quote! { Self::#vname( #(#binds),* ) => #body, }
                    }
                    Fields::Named(fs) => {
                        let fnames: Vec<_> =
                            fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                        let kept: Vec<_> = fs
                            .named
                            .iter()
                            .filter(|f| !has_css_skip(&f.attrs))
                            .map(|f| f.ident.clone().unwrap())
                            .collect();
                        let body = if kept.is_empty() {
                            quote! { true }
                        } else {
                            quote! { #( ::bun_css::generics::IsCompatible::is_compatible(#kept, __browsers) )&&* }
                        };
                        quote! { Self::#vname { #(#fnames),* } => #body, }
                    }
                }
            });
            quote! {
                match self {
                    #(#arms)*
                }
            }
        }
        Data::Union(_) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(IsCompatible)] is not supported on `union`s",
            ));
        }
    };

    Ok(quote! {
        #[automatically_derived]
        impl #impl_g ::bun_css::generics::IsCompatible for #name #ty_g #where_g {
            #[inline]
            #[allow(unused_variables)]
            fn is_compatible(&self, __browsers: ::bun_css::targets::Browsers) -> bool {
                #body
            }
        }
    })
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
                                Self::#vname( #(
                                    ::bun_css::generics::DeepClone::deep_clone(#binds, __bump)
                                ),* ),
                        }
                    }
                    Fields::Named(fs) => {
                        let names: Vec<_> =
                            fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
                        quote! {
                            Self::#vname { #(#names),* } =>
                                Self::#vname { #(
                                    #names: ::bun_css::generics::DeepClone::deep_clone(#names, __bump)
                                ),* },
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
// `Parse` / `ToCss` (port of Zig's `DeriveParse` / `DeriveToCss`) handle
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

        // ── generics::{ToCss, Parse, ParseWithOptions} ────────────────────────
        // `Property::value_to_css` / `Property::parse` dispatch through
        // `css::generic::{to_css, parse_with_options}` (free fns bounded on the
        // trait), so the inherent `to_css`/`parse` alone don't satisfy the call
        // site — emit the trait impls too. They forward to the `EnumProperty`
        // defaults so behaviour is identical to the inherents.
        #[automatically_derived]
        impl ::bun_css::generics::ToCss for #name {
            #[inline]
            fn to_css(
                &self,
                __dest: &mut ::bun_css::printer::Printer<'_>,
            ) -> ::core::result::Result<(), ::bun_css::PrintErr> {
                <Self as ::bun_css::EnumProperty>::to_css(self, __dest)
            }
        }
        #[automatically_derived]
        impl ::bun_css::generics::Parse for #name {
            #[inline]
            fn parse(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
            ) -> ::bun_css::Result<Self> {
                <Self as ::bun_css::EnumProperty>::parse(__input)
            }
        }
        #[automatically_derived]
        impl ::bun_css::generics::ParseWithOptions for #name {
            #[inline]
            fn parse_with_options(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
                _: &::bun_css::css_parser::ParserOptions,
            ) -> ::bun_css::Result<Self> {
                <Self as ::bun_css::EnumProperty>::parse(__input)
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

// ───────────────────────── Parse / ToCss ─────────────────────────

#[proc_macro_derive(Parse, attributes(css))]
pub fn derive_parse(input: TokenStream) -> TokenStream {
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

/// One variant of a `union(enum)` shape.
enum VariantShape<'a> {
    /// `Foo` — keyword
    Unit {
        ident: &'a syn::Ident,
        keyword: String,
    },
    /// `Foo(Payload)` — single unnamed field
    Payload {
        ident: &'a syn::Ident,
        ty: &'a syn::Type,
    },
    /// `Foo { f1, f2, … }` — inline struct payload. Direct Rust analogue of the
    /// Zig `union(enum)` arm carrying an anonymous `struct { … __generateToCss }`;
    /// the printer is the field sequence (see [`gen_field_seq_to_css`]).
    NamedFields {
        ident: &'a syn::Ident,
        fields: &'a syn::FieldsNamed,
    },
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
            Fields::Named(fs) => out.push(VariantShape::NamedFields {
                ident: &v.ident,
                fields: fs,
            }),
            _ => {
                return Err(syn::Error::new_spanned(
                    &v.ident,
                    "#[derive(Parse/ToCss)] supports unit variants, single-field tuple \
                     variants, and named-field struct variants (Zig `union(enum)` shape)",
                ));
            }
        }
    }
    Ok(out)
}

/// `true` if any `#[css(...)]` attr in `attrs` carries the bare flag `flag`
/// (e.g. `#[css(generate_to_css)]`). Unknown sibling keys are ignored.
fn has_css_flag(attrs: &[Attribute], flag: &str) -> bool {
    for attr in attrs {
        if !attr.path().is_ident("css") {
            continue;
        }
        let mut hit = false;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident(flag) {
                hit = true;
            } else if meta.input.peek(syn::Token![=]) {
                // Consume `key = value` so a later flag in the same list is still seen.
                let _ = meta.value().and_then(|v| v.parse::<syn::Expr>());
            }
            Ok(())
        });
        if hit {
            return true;
        }
    }
    false
}

/// Emit the `__generateToCss` field-sequence body shared by the struct branch
/// and named-field enum variants: each field is `to_css`'d in declaration
/// order, `Option<_>` fields are unwrapped, and a single space is written
/// between fields (unconditionally — matching the Zig, which does not elide the
/// separator when an optional field is `None`).
///
/// `access` maps a field ident to the expression that reads it (`self.f` for
/// a struct, the binding name for a destructured enum variant).
fn gen_field_seq_to_css<'a>(
    fields: impl ExactSizeIterator<Item = &'a syn::Field> + Clone,
    access: impl Fn(&syn::Ident) -> TokenStream2,
) -> TokenStream2 {
    let len = fields.len();
    let last = len.saturating_sub(1);
    let stmts = fields.enumerate().map(|(j, f)| {
        let fname = f.ident.as_ref().unwrap();
        let slot = access(fname);
        let body = if is_option_type(&f.ty) {
            quote! {
                if let ::core::option::Option::Some(__v) = &#slot {
                    __v.to_css(__dest)?;
                }
            }
        } else {
            quote! { #slot.to_css(__dest)?; }
        };
        let sep = if len > 1 && j != last {
            quote! { __dest.write_char(b' ')?; }
        } else {
            quote! {}
        };
        quote! { #body #sep }
    });
    quote! { #(#stmts)* }
}

/// `true` when `ty` is spelled `Option<…>` (any path ending in `Option` with one
/// generic argument). Used by the struct branch of `expand_derive_to_css` to
/// mirror Zig's `@typeInfo(field.type) == .optional` unwrap.
fn is_option_type(ty: &syn::Type) -> bool {
    let syn::Type::Path(tp) = ty else {
        return false;
    };
    let Some(seg) = tp.path.segments.last() else {
        return false;
    };
    if seg.ident != "Option" {
        return false;
    }
    matches!(
        &seg.arguments,
        syn::PathArguments::AngleBracketed(ab) if ab.args.len() == 1
    )
}

fn expand_derive_to_css(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    // Trait-impl generics carry `T: generics::ToCss` for every type parameter
    // so generic containers (`Foo<T>`) constrain their payload. The inherent
    // forwarder reuses the same bounds (it calls the trait method).
    let bounded = with_trait_bounds(&input, quote!(::bun_css::generics::ToCss));
    let (impl_g, ty_g, where_g) = bounded.split_for_impl();

    let body = match &input.data {
        // ── Struct branch ──────────────────────────────────────────────────
        // Port of the `__generateToCss` auto-serializer in Zig's
        // `DeriveToCss` (`src/css/css_parser.zig:821-843`): for a payload
        // struct whose Zig original carried `pub fn __generateToCss() void {}`,
        // the printer is the field sequence, space-separated, with optionals
        // unwrapped (and the inter-field space emitted unconditionally — that
        // is what the Zig does, so we do not second-guess it here).
        //
        // The Zig dispatched this from inside the *enum*'s `toCss` via
        // `@typeInfo` reflection on the payload type. Rust proc-macros cannot
        // see through a type name, so the equivalent is deriving `ToCss`
        // directly on the payload struct; the enum arm's
        // `__inner.to_css(__dest)` then resolves to this generated impl.
        Data::Struct(s) => {
            let Fields::Named(named) = &s.fields else {
                return Err(syn::Error::new_spanned(
                    name,
                    "#[derive(ToCss)] on a struct requires named fields \
                     (Zig `__generateToCss` shape)",
                ));
            };
            // `#[css(generate_to_css)]` is accepted (and recommended) as an
            // explicit opt-in marker mirroring Zig's `pub fn __generateToCss()`,
            // but the behaviour is identical with or without it — deriving
            // `ToCss` on a named-field struct always emits the field-sequence
            // printer. The flag exists so the port can record intent at the
            // declaration site without a doc-comment.
            let _ = has_css_flag(&input.attrs, "generate_to_css");
            let seq = gen_field_seq_to_css(named.named.iter(), |f| quote! { self.#f });
            quote! { #seq ::core::result::Result::Ok(()) }
        }
        Data::Enum(data) => {
            let shapes = classify(data)?;
            let arms = shapes.iter().map(|s| match s {
                VariantShape::Unit { ident, keyword } => {
                    let kw = syn::LitByteStr::new(keyword.as_bytes(), ident.span());
                    quote! { #name::#ident => __dest.write_str(#kw), }
                }
                VariantShape::Payload { ident, .. } => {
                    // The payload type is opaque to a proc-macro, so we delegate. If
                    // the payload is a ported "anonymous struct" (Zig
                    // `__generateToCss`), give it `#[derive(ToCss)]` — the struct
                    // branch above generates the matching field-sequence printer.
                    quote! { #name::#ident(__inner) => __inner.to_css(__dest), }
                }
                VariantShape::NamedFields { ident, fields } => {
                    // Inline `__generateToCss` path: destructure and emit fields.
                    let bind: Vec<_> = fields
                        .named
                        .iter()
                        .map(|f| f.ident.clone().unwrap())
                        .collect();
                    let seq = gen_field_seq_to_css(fields.named.iter(), |f| quote! { #f });
                    quote! {
                        #name::#ident { #(#bind),* } => {
                            #seq
                            ::core::result::Result::Ok(())
                        }
                    }
                }
            });
            quote! { match self { #(#arms)* } }
        }
        Data::Union(_) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(ToCss)] is only valid on enums and named-field structs",
            ));
        }
    };

    // Emit the body in the **trait** impl so `css::generic::to_css(v, dest)`
    // (bounded on `T: generics::ToCss`) resolves. An inherent `to_css` is kept
    // as a thin forwarder so call sites that don't import the trait (the
    // majority of the ported leaves) keep compiling unchanged. The body uses
    // method-syntax dispatch with the trait brought into scope, so a field /
    // payload type may satisfy the recursion with either an inherent
    // `pub fn to_css` *or* a `generics::ToCss` impl (`f32`, `Option<T>`, …).
    Ok(quote! {
        #[automatically_derived]
        impl #impl_g ::bun_css::generics::ToCss for #name #ty_g #where_g {
            #[allow(unused_variables)]
            fn to_css(
                &self,
                __dest: &mut ::bun_css::printer::Printer<'_>,
            ) -> ::core::result::Result<(), ::bun_css::PrintErr> {
                #[allow(unused_imports)]
                use ::bun_css::generics::ToCss as _;
                #body
            }
        }

        #[automatically_derived]
        #[allow(dead_code)]
        impl #impl_g #name #ty_g #where_g {
            #[inline]
            pub fn to_css(
                &self,
                __dest: &mut ::bun_css::printer::Printer<'_>,
            ) -> ::core::result::Result<(), ::bun_css::PrintErr> {
                <Self as ::bun_css::generics::ToCss>::to_css(self, __dest)
            }
        }
    })
}

fn expand_derive_parse(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            name,
            "#[derive(Parse)] is only valid on enums",
        ));
    };
    let shapes = classify(data)?;
    let (_, ty_g, _) = input.generics.split_for_impl();

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
            VariantShape::NamedFields { ident, .. } => {
                // Zig `DeriveParse` only dispatches on void variants and
                // payload types that themselves expose `parse`; the inline
                // `__generateToCss` structs in align.zig each hand-write
                // `parse`. The Rust port lifts those into named structs with a
                // `parse` inherent and wraps them in a single-field tuple
                // variant, so this arm is unreachable for any faithful port.
                return Err(syn::Error::new_spanned(
                    ident,
                    "#[derive(Parse)] does not support named-field variants; lift the \
                     payload into a struct with its own `parse` and use a single-field \
                     tuple variant",
                ));
            }
        }
    }

    // Build the unit-variant matcher as a closure body. When this is the *last*
    // attempted group it is invoked directly (its error propagates); when a
    // payload group follows, it is wrapped in `try_parse` so the cursor rewinds
    // on no-match (Zig: `input.tryParse(Parser.expectIdent, .{})` then
    // `input.reset(&state)`).
    let unit_matcher = {
        let arms = units.iter().map(|(ident, kw)| {
            let kw = syn::LitByteStr::new(kw.as_bytes(), ident.span());
            quote! {
                if __id.eq_ignore_ascii_case(#kw) {
                    return ::core::result::Result::Ok(#name::#ident);
                }
            }
        });
        quote! {
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
            }
        }
    };

    // Payload block builder. `terminal` controls whether the *last* payload
    // propagates its error (Zig: `i == last_payload_index && last > void_index`)
    // or is `try_parse`d like the others so a following unit block can run.
    let payload_block = |terminal: bool| -> TokenStream2 {
        if payloads.is_empty() {
            return quote! {};
        }
        let last = payloads.len() - 1;
        let stmts = payloads.iter().enumerate().map(|(i, (ident, ty))| {
            if terminal && i == last {
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

    let body = match (units.is_empty(), payloads.is_empty()) {
        (true, true) => {
            return Err(syn::Error::new_spanned(
                name,
                "#[derive(Parse)] on empty enum",
            ));
        }
        // Only payload variants — last one's error propagates.
        (true, false) => {
            let p = payload_block(true);
            quote! { #p }
        }
        // Only unit variants — direct ident match, error propagates.
        (false, true) => {
            quote! { return (#unit_matcher)(__input); }
        }
        // Mixed: whichever group is declared first is tried first; the
        // *second* group is terminal.
        (false, false) if units_first => {
            let p = payload_block(true);
            quote! {
                if let ::core::result::Result::Ok(__v) = __input.try_parse(#unit_matcher) {
                    return ::core::result::Result::Ok(__v);
                }
                #p
            }
        }
        (false, false) => {
            let p = payload_block(false);
            quote! {
                #p
                return (#unit_matcher)(__input);
            }
        }
    };

    // Emit the body in the **trait** impl so `css::generic::parse[_with_options]`
    // (bounded on `T: generics::Parse[WithOptions]`) resolves. An inherent
    // `parse` is kept as a thin forwarder for call sites that don't import the
    // trait. `ParseWithOptions` ignores options (Zig fallthrough) — types that
    // genuinely consume options hand-write their own impl instead of deriving.
    let bounded = with_trait_bounds(&input, quote!(::bun_css::generics::Parse));
    let (b_impl_g, _, b_where_g) = bounded.split_for_impl();

    Ok(quote! {
        #[automatically_derived]
        impl #b_impl_g ::bun_css::generics::Parse for #name #ty_g #b_where_g {
            #[allow(unreachable_code)]
            fn parse(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
            ) -> ::bun_css::Result<Self> {
                #[allow(unused_imports)]
                use ::bun_css::generics::Parse as _;
                #body
            }
        }

        #[automatically_derived]
        impl #b_impl_g ::bun_css::generics::ParseWithOptions for #name #ty_g #b_where_g {
            #[inline]
            fn parse_with_options(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
                _: &::bun_css::css_parser::ParserOptions,
            ) -> ::bun_css::Result<Self> {
                <Self as ::bun_css::generics::Parse>::parse(__input)
            }
        }

        #[automatically_derived]
        #[allow(dead_code)]
        impl #b_impl_g #name #ty_g #b_where_g {
            #[inline]
            pub fn parse(
                __input: &mut ::bun_css::css_parser::Parser<'_>,
            ) -> ::bun_css::Result<Self> {
                <Self as ::bun_css::generics::Parse>::parse(__input)
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
            quote! {
                #ctor( #(
                    ::bun_css::generics::DeepClone::deep_clone(&self.#idx, __bump)
                ),* )
            }
        }
        Fields::Named(fs) => {
            let names: Vec<_> = fs.named.iter().map(|f| f.ident.clone().unwrap()).collect();
            quote! {
                #ctor { #(
                    #names: ::bun_css::generics::DeepClone::deep_clone(&self.#names, __bump)
                ),* }
            }
        }
    }
}
