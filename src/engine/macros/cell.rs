use proc_macro2::{Span, TokenStream};
use quote::{format_ident, quote};
use syn::parse::Parser;
use syn::{Expr, Field, Fields, GenericArgument, Ident, ItemStruct, LitStr, PathArguments, Type};

use crate::{field_offsets, trace};

#[derive(Default)]
struct Options {
    name: Option<LitStr>,
    cell_type: Option<Ident>,
    exact_types: Option<(Ident, Ident)>,
    flags: Option<Expr>,
    cleared_flags: Option<Expr>,
    static_table: Option<Expr>,
    export: Option<LitStr>,
    ops: bool,
    hooks: Vec<Ident>,
}

const HOOKS: [&str; 5] = [
    "visit_children",
    "visit_output_constraints",
    "reconcile_weak_references",
    "estimated_size",
    "analyze_heap",
];

fn parse_options(arguments: TokenStream) -> syn::Result<Options> {
    let mut options = Options::default();
    let parser = syn::meta::parser(|meta| {
        let key = meta.path.require_ident()?.clone();
        match key.to_string().as_str() {
            "name" => options.name = Some(meta.value()?.parse()?),
            "shared_type" => options.cell_type = Some(meta.value()?.parse()?),
            "cell_type" => {
                let input = meta.value()?;
                let first: Ident = input.parse()?;
                let last = if input.peek(syn::Token![..=]) {
                    input.parse::<syn::Token![..=]>()?;
                    input.parse()?
                } else {
                    first.clone()
                };
                options.cell_type = Some(first.clone());
                options.exact_types = Some((first, last));
            }
            "flags" => options.flags = Some(meta.value()?.parse()?),
            "cleared_flags" => options.cleared_flags = Some(meta.value()?.parse()?),
            "static_table" => options.static_table = Some(meta.value()?.parse()?),
            "export" => options.export = Some(meta.value()?.parse()?),
            "ops" => options.ops = true,
            hook if HOOKS.contains(&hook) => options.hooks.push(key),
            _ => return Err(meta.error("unknown option")),
        }
        Ok(())
    });
    parser.parse2(arguments)?;
    Ok(options)
}

/// `Wrapper<T>` as its name and `T`.
fn wrapper(ty: &Type) -> Option<(&Ident, Option<&Type>)> {
    let Type::Path(path) = ty else { return None };
    let segment = path.path.segments.last()?;
    let argument = match &segment.arguments {
        PathArguments::AngleBracketed(arguments) => {
            arguments.args.iter().find_map(|argument| match argument {
                GenericArgument::Type(ty) => Some(ty),
                _ => None,
            })
        }
        _ => None,
    };
    Some((&segment.ident, argument))
}

struct Member {
    init_type: Option<TokenStream>,
    init_value: TokenStream,
    accessors: TokenStream,
}

fn member(field: &Field) -> Member {
    let name = field.ident.as_ref().expect("a named field");
    let (ty, visibility) = (&field.ty, &field.vis);
    let docs = field.attrs.iter().filter(|it| it.path().is_ident("doc"));
    // With the span of the macro, an accessor that nothing calls is no dead code.
    let getter = format_ident!("{}", name, span = Span::call_site());
    match wrapper(ty) {
        Some((wrapper, Some(value))) if wrapper == "Field" || wrapper == "WeakField" => {
            let setter = format_ident!("set_{}", getter);
            Member {
                init_type: Some(quote!(#value)),
                init_value: quote!(<#ty>::new(init.#name)),
                accessors: quote! {
                    #(#docs)*
                    #[inline(always)]
                    #visibility fn #getter(&self) -> #value { self.#name.get() }
                    #[inline(always)]
                    #visibility fn #setter(&self, value: #value) {
                        unsafe { self.#name.set(self.as_cell(), value) }
                    }
                },
            }
        }
        Some((wrapper, _))
            if ["FieldArray", "TracedVec", "TracedMap", "GcCell"]
                .iter()
                .any(|it| wrapper == it) =>
        {
            let (init_type, init_value) = if wrapper == "FieldArray" {
                (
                    Some(quote!(<#ty as ::bun_engine_vm::heap::OwnedField>::Init)),
                    quote!(<#ty>::new(init.#name)),
                )
            } else {
                (None, quote!(<#ty>::empty()))
            };
            Member {
                init_type,
                init_value,
                accessors: quote! {
                    #(#docs)*
                    #[inline(always)]
                    #visibility fn #getter(&self) -> ::bun_engine_vm::heap::Owned<'_, #ty> {
                        unsafe { ::bun_engine_vm::heap::Owned::new(self.as_cell(), &self.#name) }
                    }
                },
            }
        }
        _ => Member {
            init_type: Some(quote!(#ty)),
            init_value: quote!(init.#name),
            accessors: quote!(),
        },
    }
}

pub(crate) fn expand(arguments: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let options = parse_options(arguments)?;
    let item: ItemStruct = syn::parse2(item)?;
    let (name, visibility) = (&item.ident, &item.vis);
    let Fields::Named(fields) = &item.fields else {
        return Err(syn::Error::new_spanned(name, "expected named fields"));
    };
    let mut fields = fields.named.iter();
    let base = match fields.next() {
        Some(field) if field.ident.as_ref().is_some_and(|it| it == "base") => &field.ty,
        _ => return Err(syn::Error::new_spanned(name, "the first field is `base`")),
    };
    let fields: Vec<&Field> = fields.collect();
    let members: Vec<Member> = fields.iter().map(|field| member(field)).collect();
    let names: Vec<&Ident> = fields.iter().filter_map(|it| it.ident.as_ref()).collect();

    let init_name = format_ident!("{}Init", name);
    let class_static = format_ident!("CLASS_OF_{}", name);
    let init_fields = names.iter().zip(&members).filter_map(|(name, member)| {
        let ty = member.init_type.as_ref()?;
        Some(quote!(pub #name: #ty))
    });
    let init_values = members.iter().map(|member| &member.init_value);
    let accessors = members.iter().map(|member| &member.accessors);
    let trace_calls = names
        .iter()
        .map(|name| trace::trace_field(&quote!(&self.#name)));
    let imports = trace::imports();
    let forbid_drop = trace::forbid_drop(name, &item.generics);

    let vm = quote!(::bun_engine_vm);
    let base_kind = quote!(<#base as #vm::CellKind>);
    let has_hook = |hook: &str| options.hooks.iter().any(|it| it == hook);
    let custom_visit = has_hook("visit_children").then(|| quote!(self.visit_children(visitor);));
    let hooks = options
        .hooks
        .iter()
        .filter(|hook| *hook != "visit_children")
        .map(|hook| {
            let (parameter, returns) = match hook.to_string().as_str() {
                "visit_output_constraints" => (quote!(&mut #vm::Visitor), quote!()),
                "reconcile_weak_references" => (quote!(&#vm::heap::Survivors), quote!()),
                "estimated_size" => (quote!(&#vm::Vm), quote!(-> usize)),
                _ => (quote!(&mut #vm::heap::HeapAnalyzer), quote!()),
            };
            quote! {
                #[allow(improper_ctypes_definitions)]
                unsafe extern "C" fn #hook(this: &#vm::JsCell, argument: #parameter) #returns {
                    unsafe { #vm::Gc::from(this).cast_unchecked::<#name>() }.#hook(argument)
                }
                ops.#hook = #hook;
            }
        });
    let (override_ops, override_flags) = if options.ops {
        (
            quote!(ops = #name::override_ops(ops);),
            quote!(.union(#name::OVERRIDE_FLAGS)),
        )
    } else {
        (quote!(), quote!())
    };
    let flags = options.flags.as_ref().map(|flags| quote!(.union(#flags)));
    let cleared_flags = options
        .cleared_flags
        .as_ref()
        .map(|flags| quote!(.difference(#flags)));
    let (static_table, static_table_flag) = match &options.static_table {
        Some(table) => (
            quote!(Some(&#table)),
            quote!(.union(#vm::TypeFlags::HAS_STATIC_PROPERTY_TABLE)),
        ),
        None => (quote!(None), quote!()),
    };
    let cell_type = match &options.cell_type {
        Some(cell_type) => quote!(#vm::CellType::#cell_type),
        None => quote!(#base_kind::CELL_TYPE),
    };
    let (type_range, is) = match &options.exact_types {
        Some((first, last)) => (
            quote!(#vm::CellTypeRange::new(#vm::CellType::#first, #vm::CellType::#last)),
            quote!(Self::CLASS_TYPES.contains(cell.cell_type())),
        ),
        None => (
            quote!(#vm::CellTypeRange::NONE),
            quote!(cell.inherits(<Self as #vm::CellKind>::CLASS)),
        ),
    };
    let class_name = match &options.name {
        Some(class_name) => class_name.clone(),
        None => LitStr::new(&name.to_string(), name.span()),
    };
    let export = options
        .export
        .as_ref()
        .map(|export| quote!(#[unsafe(export_name = #export)]));
    let offsets = options
        .export
        .as_ref()
        .map(|_| field_offsets::offset_of_field(names.iter().copied()));

    Ok(quote! {
        #[repr(C)]
        #item

        #visibility struct #init_name {
            pub base: #base_kind::Init,
            #(#init_fields,)*
        }

        impl ::core::ops::Deref for #name {
            type Target = #base;

            #[inline(always)]
            fn deref(&self) -> &#base { &self.base }
        }

        impl #name {
            const CLASS_TYPES: #vm::CellTypeRange = #type_range;

            #(#accessors)*

            #offsets
        }

        #export
        #[allow(non_upper_case_globals)]
        static #class_static: #vm::Class =
            #vm::Class::new::<#name>(#vm::ascii_literal!(#class_name), #static_table, #name::CLASS_TYPES);

        impl !#vm::GcFree for #name {}

        unsafe impl<Ancestor> #vm::Extends<Ancestor> for #name where #base: #vm::Extends<Ancestor> {}

        unsafe impl #vm::CellKind for #name {
            type Base = #base;
            type Init = #init_name;

            const CLASS: &'static #vm::Class = &#class_static;
            const CELL_TYPE: #vm::CellType = #cell_type;
            const FLAGS: #vm::TypeFlags =
                #base_kind::FLAGS #override_flags #static_table_flag #flags #cleared_flags;
            const HOLDS_CLASS: bool = #base_kind::HOLDS_CLASS;
            const OPS: #vm::ClassOps = {
                let mut ops = #base_kind::OPS;
                ops.visit_children = #vm::heap::visit_children_of::<#name>;
                ops.destroy = #vm::heap::destroy::<#name>;
                #override_ops
                #(#hooks)*
                ops
            };

            #[inline(always)]
            fn is(cell: &#vm::JsCell) -> bool { #is }

            #[inline(always)]
            fn shape_of(init: &#init_name) -> #vm::Gc<#vm::Shape> { #base_kind::shape_of(&init.base) }

            #[inline(always)]
            unsafe fn initialize(this: *mut Self, init: #init_name) {
                unsafe {
                    #base_kind::initialize(&raw mut (*this).base, init.base);
                    #((&raw mut (*this).#names).write(#init_values);)*
                }
            }

            #[inline]
            fn trace_fields(&self, visitor: &mut #vm::Visitor) {
                #imports
                #base_kind::trace_fields(&self.base, visitor);
                #(#trace_calls)*
                #custom_visit
            }
        }

        #forbid_drop
    })
}
