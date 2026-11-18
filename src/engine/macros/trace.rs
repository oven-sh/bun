use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::{Data, DeriveInput, Fields, Ident, parse_quote};

/// Calls `Trace::trace` if the type has it, and otherwise demands that it is `GcFree`.
pub(crate) fn trace_field(field: &TokenStream) -> TokenStream {
    quote! { (&&::bun_engine_vm::heap::select_trace::Select(#field)).select_trace(visitor); }
}

pub(crate) fn imports() -> TokenStream {
    quote! {
        #[allow(unused_imports)]
        use ::bun_engine_vm::heap::select_trace::{ViaGcFree as _, ViaTrace as _};
    }
}

/// A destructor would see cells that are already gone.
pub(crate) fn forbid_drop(name: &Ident, generics: &syn::Generics) -> TokenStream {
    let (impl_generics, type_generics, where_clause) = generics.split_for_impl();
    quote! {
        const _: () = {
            trait MustNotImplementDrop {}
            #[allow(drop_bounds)]
            impl<T: ::core::ops::Drop> MustNotImplementDrop for T {}
            impl #impl_generics MustNotImplementDrop for #name #type_generics #where_clause {}
        };
    }
}

fn arm(path: &TokenStream, fields: &Fields) -> TokenStream {
    let bindings: Vec<Ident> = (0..fields.len())
        .map(|index| format_ident!("field{index}"))
        .collect();
    let members = fields.members();
    let calls = bindings
        .iter()
        .map(|binding| trace_field(&quote!(#binding)));
    quote! { #path { #(#members: #bindings),* } => { #(#calls)* } }
}

pub(crate) fn expand(item: TokenStream) -> syn::Result<TokenStream> {
    let mut input: DeriveInput = syn::parse2(item)?;
    let name = &input.ident;
    let arms = match &input.data {
        Data::Struct(data) => vec![arm(&quote!(Self), &data.fields)],
        Data::Enum(data) => data
            .variants
            .iter()
            .map(|variant| {
                let variant_name = &variant.ident;
                arm(&quote!(Self::#variant_name), &variant.fields)
            })
            .collect(),
        Data::Union(_) => return Err(syn::Error::new_spanned(name, "a union cannot be traced")),
    };
    let forbid_drop = forbid_drop(name, &input.generics);
    for parameter in input.generics.type_params_mut() {
        parameter.bounds.push(parse_quote!(::bun_engine_vm::Trace));
    }
    let (impl_generics, type_generics, where_clause) = input.generics.split_for_impl();
    let imports = imports();
    Ok(quote! {
        unsafe impl #impl_generics ::bun_engine_vm::Trace for #name #type_generics #where_clause {
            #[inline]
            fn trace(&self, visitor: &mut ::bun_engine_vm::Visitor) {
                #imports
                match self { #(#arms)* }
            }
        }
        #forbid_drop
    })
}
