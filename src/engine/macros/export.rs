use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::{FnArg, ItemFn, Pat, ReturnType, Type};

fn is_named(ty: &Type, name: &str) -> bool {
    matches!(ty, Type::Path(path) if path.path.segments.last().is_some_and(|it| it.ident == name))
}

pub(crate) fn expand(item: TokenStream) -> syn::Result<TokenStream> {
    let function: ItemFn = syn::parse2(item)?;
    let name = &function.sig.ident;
    let symbol = format!("engine_{name}");
    let (mut parameters, mut arguments) = (Vec::new(), Vec::new());
    for (index, input) in function.sig.inputs.iter().enumerate() {
        let FnArg::Typed(input) = input else {
            return Err(syn::Error::new_spanned(input, "expected a free function"));
        };
        if !matches!(*input.pat, Pat::Ident(_) | Pat::Wild(_)) {
            return Err(syn::Error::new_spanned(input, "expected a name"));
        }
        let (ty, argument) = (&*input.ty, format_ident!("argument{index}"));
        let length = format_ident!("length{index}");
        match ty {
            Type::Reference(reference) if let Type::Slice(slice) = &*reference.elem => {
                let element = &slice.elem;
                parameters.push(quote!(#argument: *const #element, #length: usize));
                arguments.push(quote!(unsafe { crate::abi::slice(#argument, #length) }));
            }
            _ if is_named(ty, "Text") => {
                let is_latin1 = format_ident!("is_latin1{index}");
                parameters.push(quote! {
                    #argument: *const ::core::ffi::c_void, #length: usize, #is_latin1: bool
                });
                arguments.push(quote!(unsafe { crate::abi::text(#argument, #length, #is_latin1) }));
            }
            _ if is_named(ty, "AsciiLiteral") => {
                parameters.push(quote!(#argument: *const u8, #length: usize));
                arguments.push(quote!(unsafe { crate::abi::literal(#argument, #length) }));
            }
            _ if is_named(ty, "Value") => {
                parameters.push(quote!(#argument: Option<#ty>));
                arguments.push(quote!(crate::abi::value(#argument)));
            }
            _ => {
                parameters.push(quote!(#argument: #ty));
                arguments.push(quote!(#argument));
            }
        }
    }
    let result = match &function.sig.output {
        ReturnType::Default => quote!(()),
        ReturnType::Type(_, ty) => quote!(#ty),
    };
    let generics = &function.sig.generics;
    let call = match function.sig.unsafety {
        Some(_) => quote!(unsafe { #name(#(#arguments),*) }),
        None => quote!(#name(#(#arguments),*)),
    };
    Ok(quote! {
        #[inline(always)]
        #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments, clippy::unnecessary_wraps)]
        #function

        const _: () = {
            #[unsafe(export_name = #symbol)]
            #[allow(unused_unsafe, clippy::too_many_arguments)]
            unsafe extern "C" fn exported #generics (#(#parameters),*) -> <#result as crate::abi::Returned>::Abi {
                crate::abi::Returned::into_abi(#call)
            }
        };
    })
}
