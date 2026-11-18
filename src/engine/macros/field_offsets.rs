use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Ident, LitByteStr};

pub(crate) fn offset_of_field<'a>(names: impl Iterator<Item = &'a Ident>) -> TokenStream {
    let arms = names.map(|name| {
        let text = LitByteStr::new(name.to_string().as_bytes(), name.span());
        quote!(#text => ::core::mem::offset_of!(Self, #name),)
    });
    quote! {
        /// For checking what other languages assume.
        pub const fn offset_of_field(name: &str) -> usize {
            match name.as_bytes() {
                #(#arms)*
                _ => panic!("no such field"),
            }
        }
    }
}

pub(crate) fn expand(item: TokenStream) -> syn::Result<TokenStream> {
    let input: DeriveInput = syn::parse2(item)?;
    let name = &input.ident;
    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(name, "expected a struct"));
    };
    let function = offset_of_field(data.fields.iter().filter_map(|it| it.ident.as_ref()));
    let (impl_generics, type_generics, where_clause) = input.generics.split_for_impl();
    Ok(quote!(impl #impl_generics #name #type_generics #where_clause { #function }))
}
