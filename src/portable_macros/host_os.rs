//! `#[host_os]`: one definition of a function for one host OS, and the function that picks at run time.

use proc_macro2::TokenStream as Tokens;
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::punctuated::Punctuated;
use syn::{FnArg, Ident, ImplItemFn, Pat, Token};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Windows,
    Macos,
    Linux,
    Posix,
}

impl Kind {
    fn parse(ident: &Ident) -> syn::Result<Kind> {
        match ident.to_string().as_str() {
            "windows" => Ok(Kind::Windows),
            "macos" => Ok(Kind::Macos),
            "linux" => Ok(Kind::Linux),
            "posix" => Ok(Kind::Posix),
            _ => Err(syn::Error::new(
                ident.span(),
                "expected `windows`, `macos`, `linux` or `posix`",
            )),
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Kind::Windows => "windows",
            Kind::Macos => "macos",
            Kind::Linux => "linux",
            Kind::Posix => "posix",
        }
    }
}

struct Arguments {
    kind: Kind,
    /// The function is called through `Self`: an associated function that has no `self` argument and
    /// does not name `Self` in its signature says so with `associated`.
    associated: bool,
    dispatch: Option<Vec<Kind>>,
}

impl Parse for Arguments {
    fn parse(input: ParseStream) -> syn::Result<Arguments> {
        let kind = Kind::parse(&input.parse::<Ident>()?)?;
        let mut dispatch = None;
        let mut associated = false;
        while input.parse::<Option<Token![,]>>()?.is_some() && !input.is_empty() {
            let keyword: Ident = input.parse()?;
            if keyword == "associated" {
                associated = true;
                continue;
            }
            if keyword != "dispatch" {
                return Err(syn::Error::new(
                    keyword.span(),
                    "expected `associated` or `dispatch(..)`",
                ));
            }
            let list;
            syn::parenthesized!(list in input);
            let kinds = Punctuated::<Ident, Token![,]>::parse_terminated(&list)?;
            let kinds = kinds.iter().map(Kind::parse).collect::<syn::Result<Vec<_>>>()?;
            if !kinds.contains(&kind) {
                return Err(syn::Error::new(
                    keyword.span(),
                    "the list of `dispatch` names this definition too",
                ));
            }
            if kinds.contains(&Kind::Posix) && (kinds.contains(&Kind::Linux) && kinds.contains(&Kind::Macos)) {
                return Err(syn::Error::new(
                    keyword.span(),
                    "`posix` is never chosen next to both `linux` and `macos`",
                ));
            }
            dispatch = Some(kinds);
        }
        Ok(Arguments {
            kind,
            associated,
            dispatch,
        })
    }
}

pub(crate) fn expand(args: Tokens, item: Tokens) -> syn::Result<Tokens> {
    let arguments: Arguments = syn::parse2(args)?;
    // A free function parses as a method without a receiver, so one parser takes both.
    let mut function: ImplItemFn = syn::parse2(item)?;
    let name = function.sig.ident.clone();
    function.sig.ident = variant_name(&name, arguments.kind);

    let dispatcher = match &arguments.dispatch {
        Some(kinds) => dispatcher(&function, &name, kinds, arguments.associated)?,
        None => Tokens::new(),
    };
    Ok(quote! {
        #[doc(hidden)]
        #[allow(non_snake_case)]
        #function
        #dispatcher
    })
}

fn variant_name(name: &Ident, kind: Kind) -> Ident {
    format_ident!("{}__{}", name, kind.suffix(), span = name.span())
}

fn dispatcher(
    variant: &ImplItemFn,
    name: &Ident,
    kinds: &[Kind],
    associated: bool,
) -> syn::Result<Tokens> {
    let mut signature = variant.sig.clone();
    if let Some(asyncness) = &signature.asyncness {
        return Err(syn::Error::new_spanned(
            asyncness,
            "an `async fn` cannot be dispatched by host OS",
        ));
    }
    signature.ident = name.clone();
    // The host OS is read at run time.
    signature.constness = None;

    let mut forwarded = Vec::new();
    let mut has_receiver = false;
    for (index, input) in signature.inputs.iter_mut().enumerate() {
        match input {
            FnArg::Receiver(_) => {
                has_receiver = true;
                forwarded.push(quote!(self));
            }
            FnArg::Typed(typed) => {
                let ident = match &*typed.pat {
                    Pat::Ident(pattern) if pattern.subpat.is_none() && pattern.by_ref.is_none() => {
                        pattern.ident.clone()
                    }
                    _ => format_ident!("argument_{}", index),
                };
                *typed.pat = syn::parse_quote!(#ident);
                typed.attrs.clear();
                forwarded.push(quote!(#ident));
            }
        }
    }

    let call = |kind: Kind| {
        let target = variant_name(name, kind);
        let path = if has_receiver || associated || names_self(variant) {
            quote!(Self::#target)
        } else {
            quote!(#target)
        };
        let call = quote!(#path(#(#forwarded),*));
        if signature.unsafety.is_some() {
            // SAFETY: the caller's contract is the one of the definition that is called.
            quote!(unsafe { #call })
        } else {
            call
        }
    };

    let has = |kind: Kind| kinds.contains(&kind);
    let mut tests = Vec::new();
    if has(Kind::Windows) {
        let call = call(Kind::Windows);
        tests.push(quote!(if ::bun_core::host::is_windows() { return #call; }));
    }
    if has(Kind::Macos) {
        let call = call(Kind::Macos);
        tests.push(quote!(if ::bun_core::host::is_mac() { return #call; }));
    }
    let otherwise = if has(Kind::Posix) {
        if has(Kind::Linux) {
            let call = call(Kind::Linux);
            tests.push(quote!(if ::bun_core::host::is_linux() { return #call; }));
        }
        if has(Kind::Windows) {
            call(Kind::Posix)
        } else {
            let call = call(Kind::Posix);
            quote! {
                if ::bun_core::host::is_windows() {
                    ::bun_core::host::no_definition_for_this_host(concat!(module_path!(), "::", stringify!(#name)))
                }
                #call
            }
        }
    } else if has(Kind::Linux) && has(Kind::Windows) && has(Kind::Macos) {
        call(Kind::Linux)
    } else {
        if has(Kind::Linux) {
            let call = call(Kind::Linux);
            tests.push(quote!(if ::bun_core::host::is_linux() { return #call; }));
        }
        quote!(::bun_core::host::no_definition_for_this_host(concat!(module_path!(), "::", stringify!(#name))))
    };

    let attributes = variant
        .attrs
        .iter()
        .filter(|attribute| !attribute.path().is_ident("inline"));
    let visibility = &variant.vis;
    let defaultness = &variant.defaultness;
    Ok(quote! {
        #(#attributes)*
        #[inline]
        #visibility #defaultness #signature {
            #(#tests)*
            #otherwise
        }
    })
}

/// A free function cannot name `Self`, so a signature that does belongs to an associated function.
fn names_self(function: &ImplItemFn) -> bool {
    fn mentions_self(tokens: Tokens) -> bool {
        tokens.into_iter().any(|token| match token {
            proc_macro2::TokenTree::Ident(ident) => ident == "Self",
            proc_macro2::TokenTree::Group(group) => mentions_self(group.stream()),
            _ => false,
        })
    }
    let signature = &function.sig;
    mentions_self(quote!(#signature))
}
