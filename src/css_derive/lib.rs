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
    parse_macro_input, parse_quote, Data, DeriveInput, Fields, GenericParam, Lifetime,
    LifetimeParam,
};

#[proc_macro_derive(DeepClone)]
pub fn derive_deep_clone(input: TokenStream) -> TokenStream {
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
