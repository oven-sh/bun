use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::parse::Parser;
use syn::{FnArg, ImplItem, ItemImpl, LitStr};

/// Each method: its name, the type flag that an override sets, what the table entry returns and how it gets there.
const OPS: &[(&str, Option<&str>, &str)] = &[
    ("call_data", Some("OVERRIDES_CALL_DATA"), "call_data"),
    ("construct_data", None, "call_data"),
    ("put", Some("OVERRIDES_PUT"), "bool"),
    ("put_by_index", None, "bool"),
    ("delete_property", None, "bool"),
    ("delete_property_by_index", None, "bool"),
    (
        "get_own_property_slot",
        Some("OVERRIDES_GET_OWN_PROPERTY_SLOT"),
        "bool",
    ),
    ("get_own_property_slot_by_index", None, "bool"),
    (
        "own_property_names",
        Some("OVERRIDES_OWN_PROPERTY_NAMES"),
        "unit",
    ),
    (
        "own_special_property_names",
        Some("OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES"),
        "unit",
    ),
    (
        "custom_has_instance",
        Some("IMPLEMENTS_HAS_INSTANCE"),
        "bool",
    ),
    ("define_own_property", None, "bool"),
    ("prevent_extensions", None, "bool"),
    ("is_extensible", Some("OVERRIDES_IS_EXTENSIBLE"), "bool"),
    ("set_prototype_of", None, "bool"),
    ("get_prototype_of", Some("OVERRIDES_GET_PROTOTYPE"), "value"),
];

pub(crate) fn expand(arguments: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let mut export: Option<LitStr> = None;
    let parser = syn::meta::parser(|meta| {
        if !meta.path.is_ident("export") {
            return Err(meta.error("unknown option"));
        }
        export = Some(meta.value()?.parse()?);
        Ok(())
    });
    parser.parse2(arguments)?;
    let mut block: ItemImpl = syn::parse2(item)?;
    let this_type = block.self_ty.clone();
    let mut entries = Vec::new();
    let mut flags = Vec::new();
    for item in &mut block.items {
        let ImplItem::Fn(method) = item else {
            return Err(syn::Error::new_spanned(item, "expected an internal method"));
        };
        let name = method.sig.ident.clone();
        let Some(&(_, flag, result)) = OPS.iter().find(|op| name == op.0) else {
            return Err(syn::Error::new_spanned(name, "not an internal method"));
        };
        let renamed = format_ident!("op_{}", name);
        method.sig.ident = renamed.clone();
        let types: Vec<_> = method
            .sig
            .inputs
            .iter()
            .filter_map(|input| match input {
                FnArg::Typed(typed) => Some(typed.ty.clone()),
                FnArg::Receiver(_) => None,
            })
            .collect();
        let arguments: Vec<_> = (0..types.len())
            .map(|index| format_ident!("argument{index}"))
            .collect();
        let call = quote! {
            unsafe { ::bun_engine_vm::Gc::from(this).cast_unchecked::<#this_type>() }.#renamed(#(#arguments),*)
        };
        let (out, returns, body) = match result {
            "bool" => (quote!(), quote!(-> bool), quote!(#call.unwrap_or(false))),
            "unit" => (quote!(), quote!(), quote!(let _ = #call;)),
            "value" => (
                quote!(),
                quote!(-> ::bun_engine_vm::JsResult<::bun_engine_vm::Value>),
                call,
            ),
            _ => (
                quote!(result: &mut ::bun_engine_vm::CallData),
                quote!(),
                quote!(*result = #call;),
            ),
        };
        let symbol = export.as_ref().map(|prefix| {
            let symbol = format!("{}_{name}", prefix.value());
            quote!(#[unsafe(export_name = #symbol)] #[inline(never)])
        });
        entries.push(quote! {
            #symbol
            #[allow(improper_ctypes_definitions)]
            unsafe extern "C" fn #name(this: &::bun_engine_vm::JsObject, #(#arguments: #types,)* #out) #returns { #body }
            ops.#name = #name;
        });
        flags.extend(flag.map(|flag| format_ident!("{flag}")));
    }
    Ok(quote! {
        #block
        impl #this_type {
            const OVERRIDE_FLAGS: ::bun_engine_vm::TypeFlags = ::bun_engine_vm::TypeFlags::empty()
                #(.union(::bun_engine_vm::TypeFlags::#flags))*;

            const fn override_ops(mut ops: ::bun_engine_vm::ClassOps) -> ::bun_engine_vm::ClassOps {
                #(#entries)*
                ops
            }
        }
    })
}
