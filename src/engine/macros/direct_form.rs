use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::{FnArg, ForeignItemFn, Ident, ItemFn, Meta, Pat, ReturnType, Signature, Token, Type};

const CONTEXT_NAMES: [&str; 3] = ["cx", "vm", "global"];

#[derive(Default)]
struct Options {
    is_pure: bool,
    only_lacks_room: bool,
    gives_new: bool,
    gives_the_same: bool,
    reads: Vec<Ident>,
    writes: Vec<Ident>,
    needs: Vec<Ident>,
    makes: Vec<Ident>,
}

impl Options {
    fn parse(arguments: TokenStream) -> syn::Result<Options> {
        let mut options = Options::default();
        for meta in Punctuated::<Meta, Token![,]>::parse_terminated.parse2(arguments)? {
            let names = || {
                let parser = Punctuated::<Ident, Token![,]>::parse_terminated;
                let names = meta.require_list()?.parse_args_with(parser)?;
                syn::Result::Ok(names.into_iter().collect())
            };
            match meta.path().require_ident()?.to_string().as_str() {
                "pure" => options.is_pure = true,
                "only_lacks_room" => options.only_lacks_room = true,
                "gives_new" => options.gives_new = true,
                "gives_the_same" => options.gives_the_same = true,
                "reads" => options.reads = names()?,
                "writes" => options.writes = names()?,
                "needs" => options.needs = names()?,
                "makes" => options.makes = names()?,
                _ => return Err(syn::Error::new_spanned(meta, "unknown option")),
            }
        }
        Ok(options)
    }

    fn states_effects(&self) -> bool {
        self.is_pure || !self.reads.is_empty() || !self.writes.is_empty()
    }
}

struct Parameter<'a> {
    name: String,
    ty: &'a Type,
}

impl Parameter<'_> {
    fn is_passed(&self) -> bool {
        !self.name.starts_with('_')
    }
}

fn parameters_of(signature: &Signature) -> syn::Result<Vec<Parameter<'_>>> {
    let parameter = |input| match input {
        &FnArg::Typed(syn::PatType {
            ref pat, ref ty, ..
        }) => match &**pat {
            Pat::Wild(_) => Ok(Parameter {
                name: "_".into(),
                ty,
            }),
            Pat::Ident(name) => Ok(Parameter {
                name: name.ident.to_string(),
                ty,
            }),
            other => Err(syn::Error::new_spanned(other, "expected a name")),
        },
        other => Err(syn::Error::new_spanned(other, "expected a free function")),
    };
    signature.inputs.iter().map(parameter).collect()
}

pub(crate) fn expand(arguments: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let options = Options::parse(arguments)?;
    let (function, signature) = match syn::parse2::<ForeignItemFn>(item.clone()) {
        Ok(declaration) => (None, declaration.sig),
        Err(_) => {
            let function: ItemFn = syn::parse2(item)?;
            let signature = function.sig.clone();
            (Some(function), signature)
        }
    };
    let parameters = parameters_of(&signature)?;
    let (context, operands) = match &parameters[..] {
        [first, rest @ ..] if CONTEXT_NAMES.contains(&first.name.as_str()) => (Some(first), rest),
        all => (None, all),
    };
    if options.states_effects() != function.is_some() {
        let message = "what is called is `pure`, `reads` or `writes`, and nothing else is";
        return Err(syn::Error::new_spanned(&signature.ident, message));
    }

    let direct = quote!(crate::direct);
    let name = &signature.ident;
    let result = match &signature.output {
        ReturnType::Type(_, result) => result,
        ReturnType::Default => {
            return Err(syn::Error::new_spanned(&signature, "expected a result"));
        }
    };
    let context_type = context.map_or_else(|| quote!(()), |Parameter { ty, .. }| quote!(#ty));
    let takes_this = (operands.first()).is_some_and(|it| it.name.trim_start_matches('_') == "this");
    let descriptions = operands.iter().map(|operand| {
        let (ty, is_passed) = (operand.ty, operand.is_passed());
        quote!(#direct::Operand { kind: <#ty as #direct::Parameter>::KIND, is_passed: #is_passed })
    });
    let state =
        |names: &[Ident]| quote!(#direct::State::empty() #(.union(#direct::State::#names))*);
    let (reads, writes) = (state(&options.reads), state(&options.writes));
    let (needs, makes) = (&options.needs, &options.makes);
    let only_lacks_room = options.only_lacks_room;
    let (gives_new, gives_the_same) = (options.gives_new, options.gives_the_same);

    let passed = operands.iter().filter(|it| it.is_passed());
    let types: Vec<_> = passed.map(|it| it.ty).collect();
    let names: Vec<_> = (0..types.len())
        .map(|index| format_ident!("operand{index}"))
        .collect();
    let (context_parameter, context_argument, checked_context) = match context {
        Some(_) => (
            quote!(context: #context_type,),
            quote!(context,),
            quote!(&context),
        ),
        None => (quote!(), quote!(), quote!(&())),
    };
    let (function, entry, address) = match function {
        Some(mut function) => {
            let inputs = core::mem::take(&mut function.sig.inputs).into_iter();
            function.sig.inputs = (inputs.zip(&parameters))
                .filter_map(|(input, parameter)| parameter.is_passed().then_some(input))
                .collect();
            let entry = quote! {
                #[::bun_engine_macros::native_abi]
                fn entry(#context_parameter #(#names: #types),*) -> <#result as #direct::Outcome>::Register {
                    #[cfg(debug_assertions)]
                    let check = {
                        let registers = [#(#direct::Passed::to_register(&#names)),*];
                        #direct::Check::begin(&#name::FORM, #checked_context, &registers)
                    };
                    let result = #direct::Outcome::into_register(#name(#context_argument #(#names),*));
                    #[cfg(debug_assertions)]
                    check.end(result);
                    result
                }
            };
            let function = quote! {
                #[inline(always)]
                #[allow(clippy::needless_pass_by_value)]
                #function
            };
            (function, entry, quote!(entry as *const ()))
        }
        None => (quote!(), quote!(), quote!(::core::ptr::null())),
    };

    Ok(quote! {
        #function

        #[allow(non_camel_case_types)]
        pub(super) enum #name {}

        impl #name {
            pub(super) const FORM: #direct::DirectForm = {
                #entry
                #direct::DirectForm::new::<#context_type, #result>(&#direct::Declaration {
                    takes_this: #takes_this,
                    operands: &[#(#descriptions),*],
                    reads: #reads,
                    writes: #writes,
                    needs: &[#(crate::RealmWatchpoint::#needs),*],
                    makes: &[#(crate::RealmSlot::#makes),*],
                    only_lacks_room: #only_lacks_room,
                    gives_new: #gives_new,
                    gives_the_same: #gives_the_same,
                    entry: #address,
                })
            };
        }
    })
}
