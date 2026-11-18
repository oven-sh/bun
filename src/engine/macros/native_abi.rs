use proc_macro2::TokenStream;
use quote::quote;
use syn::{Abi, Item, Type, parse_quote};

pub(crate) fn expand(item: TokenStream) -> syn::Result<TokenStream> {
    let item: Item = syn::parse2(item)?;
    let x86_64 = with_abi(&item, parse_quote!(extern "sysv64"))?;
    let other = with_abi(&item, parse_quote!(extern "C"))?;
    Ok(quote! {
        #[cfg(target_arch = "x86_64")]
        #[allow(improper_ctypes_definitions)]
        #x86_64
        #[cfg(not(target_arch = "x86_64"))]
        #[allow(improper_ctypes_definitions)]
        #other
    })
}

fn with_abi(item: &Item, abi: Abi) -> syn::Result<Item> {
    let mut item = item.clone();
    match &mut item {
        Item::Fn(function) => function.sig.abi = Some(abi),
        Item::Type(alias) => match &mut *alias.ty {
            Type::BareFn(pointer) => pointer.abi = Some(abi),
            other => {
                return Err(syn::Error::new_spanned(
                    other,
                    "expected a function pointer",
                ));
            }
        },
        other => return Err(syn::Error::new_spanned(other, "expected `fn` or `type`")),
    }
    Ok(item)
}
