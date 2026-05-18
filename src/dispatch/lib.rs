//! Closed-set cross-crate dispatch over link-time symbols.
//!
//! Lets a low-tier crate declare an interface whose variant types live in
//! higher-tier crates, without a vtable. Dispatch is `match kind { … }` over
//! per-variant `extern "Rust"` direct calls; under `-Clinker-plugin-lto` the
//! whole thing inlines to the same code an in-crate enum would. Think
//! `enum_dispatch` where the impls don't have to be in the declaring crate —
//! the cross-crate Rust spelling of Zig's `union(enum)` switch.
//!
//! `link_interface!` in the low-tier crate emits the handle type **and** a
//! `link_impl_<Iface>!` macro (re-exported at that crate's root) which the
//! high-tier crates call once per variant. The impl-macro carries the
//! interface's signatures, so the impl side never respells types and a
//! mismatch is a compile error, not silent UB.
//!
//! ```ignore
//! // ── in bun_io (low tier) ──
//! bun_dispatch::link_interface! {
//!     pub EventLoopOps[Js, Mini] {
//!         fn platform_loop() -> *mut Loop;
//!         fn set_after_cb(cb: Option<Cb>, ctx: *mut c_void);
//!     }
//! }
//!
//! // ── in bun_event_loop (high tier) ──
//! bun_io::link_impl_EventLoopOps! {
//!     Mini for MiniEventLoop<'static> => |this| {
//!         platform_loop()        => (*this).loop_ptr(),
//!         set_after_cb(cb, ctx)  => { (*this).cb = cb; (*this).ctx = ctx; },
//!     }
//! }
//! ```
//!
//! `this` is `*mut T`; bodies run inside a macro-provided `unsafe { }` so
//! `(*this)` derefs are bare. The validity invariant ("`owner` is a live
//! `*mut T` matching `kind`") is established once at `unsafe fn
//! <Iface>::new()` — that's the only `unsafe` the caller writes.
//!
//! Every interface method must appear exactly once in each `link_impl_*!`
//! call (an unknown name is a compile error from the generated macro; a
//! missing one surfaces as a link error naming
//! `__bun_dispatch__<Iface>__<Variant>__<method>`).

use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::fold::Fold;
use syn::parse::{Parse, ParseStream};
use syn::punctuated::Punctuated;
use syn::{
    Ident, Lifetime, ReturnType, Token, Type, TypeReference, Visibility, braced, bracketed,
    parenthesized,
};

struct Interface {
    vis: Visibility,
    name: Ident,
    variants: Vec<Ident>,
    methods: Vec<Method>,
}

struct Method {
    name: Ident,
    args: Vec<(Ident, Type)>,
    ret: ReturnType,
}

impl Parse for Interface {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let vis = input.parse()?;
        let name = input.parse()?;
        let inner;
        bracketed!(inner in input);
        let variants = Punctuated::<Ident, Token![,]>::parse_terminated(&inner)?
            .into_iter()
            .collect();
        let body;
        braced!(body in input);
        let mut methods = Vec::new();
        while !body.is_empty() {
            body.parse::<Token![fn]>()?;
            let mname: Ident = body.parse()?;
            let argp;
            parenthesized!(argp in body);
            let mut args = Vec::new();
            while !argp.is_empty() {
                let an: Ident = argp.parse()?;
                argp.parse::<Token![:]>()?;
                let at: Type = argp.parse()?;
                args.push((an, at));
                if argp.peek(Token![,]) {
                    argp.parse::<Token![,]>()?;
                }
            }
            let ret: ReturnType = body.parse()?;
            body.parse::<Token![;]>()?;
            methods.push(Method {
                name: mname,
                args,
                ret,
            });
        }
        Ok(Interface {
            vis,
            name,
            variants,
            methods,
        })
    }
}

fn sym(iface: &Ident, variant: &Ident, method: &Ident) -> Ident {
    format_ident!("__bun_dispatch__{}__{}__{}", iface, variant, method)
}

// Rewrite elided lifetimes (`&T`, `&mut T`, `'_`) to a single named `'__a` so
// the type can stand in a `pub type X<'__a> = …;` alias. The alias is consumed
// as `X<'_>` in fn-param position, where `'_` is late-bound, so collapsing
// multiple elisions onto one lifetime is ABI-identical (lifetimes erase).
struct NameElided(Lifetime);
impl Fold for NameElided {
    fn fold_type_reference(&mut self, mut r: TypeReference) -> TypeReference {
        if r.lifetime.is_none() {
            r.lifetime = Some(self.0.clone());
        }
        r.elem = Box::new(self.fold_type(*r.elem));
        r
    }
    fn fold_lifetime(&mut self, lt: Lifetime) -> Lifetime {
        if lt.ident == "_" { self.0.clone() } else { lt }
    }
}
fn aliasable(t: &Type) -> Type {
    NameElided(Lifetime::new("'__a", proc_macro2::Span::call_site())).fold_type(t.clone())
}

/// See the crate docs.
#[proc_macro]
pub fn link_interface(input: TokenStream) -> TokenStream {
    let Interface {
        vis,
        name,
        variants,
        methods,
    } = syn::parse_macro_input!(input as Interface);
    let name = &name;
    let variants = &variants;
    let methods = &methods;
    let kind = format_ident!("{}Kind", name);
    let impl_macro = format_ident!("link_impl_{}", name);

    // ── per-method type aliases ──
    // The interface's arg/return types are tokens resolved at the *declare*
    // site. The generated impl-macro is `#[macro_export]` (so its `$crate` is
    // the declaring crate) but its body tokens are pasted at the *impl* site —
    // a bare `Loop` there means the impl crate's `Loop`. Anchor each type at
    // the declare site by emitting a `pub type` alias there and having the
    // impl-macro spell it as `$crate::<alias>`, which always resolves back.
    let sig_aliases = methods.iter().map(|m| {
        let mn = &m.name;
        let ret_alias = format_ident!("__{}__{}__ret", name, mn);
        let ret_ty = match &m.ret {
            ReturnType::Default => quote! { () },
            ReturnType::Type(_, t) => quote! { #t },
        };
        let arg_aliases = m.args.iter().map(|(an, at)| {
            let a = format_ident!("__{}__{}__arg_{}", name, mn, an);
            let at = aliasable(at);
            quote! { #[doc(hidden)] #[allow(non_camel_case_types, unused_lifetimes, clippy::extra_unused_lifetimes)] pub type #a<'__a> = #at; }
        });
        quote! {
            #[doc(hidden)] #[allow(non_camel_case_types)] pub type #ret_alias = #ret_ty;
            #(#arg_aliases)*
        }
    });

    // ── extern decls (variant × method) ──
    // Nested in a private module so that a `link_impl_*!` in the *same* module
    // as `link_interface!` (e.g. tests, or a variant whose type lives in the
    // declaring crate) doesn't collide with the decl in the value namespace.
    let externs_mod = format_ident!("__{}_externs", name);
    let externs = variants.iter().flat_map(|v| {
        methods.iter().map(move |m| {
            let s = sym(name, v, &m.name);
            let an = m.args.iter().map(|(n, _)| n);
            let at = m.args.iter().map(|(_, t)| t);
            let ret = &m.ret;
            quote! { pub(super) fn #s(owner: *mut () #(, #an: #at)*) #ret; }
        })
    });

    // ── dispatcher methods ──
    let dispatchers = methods.iter().map(|m| {
        let mn = &m.name;
        let an: Vec<_> = m.args.iter().map(|(n, _)| n).collect();
        let at = m.args.iter().map(|(_, t)| t);
        let ret = &m.ret;
        let arms = variants.iter().map(|v| {
            let s = sym(name, v, mn);
            quote! {
                #kind::#v => {
                    // SAFETY: established by `unsafe fn new()`.
                    unsafe { #externs_mod::#s(self.owner #(, #an)*) }
                }
            }
        });
        quote! {
            #[inline]
            pub fn #mn(&self #(, #an: #at)*) #ret {
                match self.kind { #(#arms),* }
            }
        }
    });

    // ── generated impl-macro ──
    // One arm per variant; matches the methods in *interface declaration
    // order* and emits all bodies in a single expansion (no self-recursion —
    // recursive `$crate::…!` is rejected in the declaring crate, and textual
    // recursion is unresolved downstream, so neither works universally). The
    // method names are matched as literals, so a missing/reordered/unknown
    // method is "no rules expected `<found>`" pointing at the offending line.
    // Arg/return types come from the `$crate::__<Iface>__<m>__*` aliases above.
    //
    // Macro hygiene: the impl body's arg references carry the impl call-site
    // span; capture them as metavars (`$k:ident`) and use those in the fn sig
    // so `k` in the body resolves to the parameter. The metavar *names* come
    // from the interface (so the impl must spell them the same — which is the
    // point), but the bound idents carry the impl's span.
    let entry_arms = variants.iter().map(|v| {
        // Per-method pieces, all in declaration order so the single
        // `macro_rules!` arm can splice them positionally.
        let mn: Vec<_> = methods.iter().map(|m| &m.name).collect();
        let s: Vec<_> = methods.iter().map(|m| sym(name, v, &m.name)).collect();
        let ret_alias: Vec<_> = methods
            .iter()
            .map(|m| format_ident!("__{}__{}__ret", name, m.name))
            .collect();
        // `$<method>__<arg>` — distinct per method so two methods sharing an arg
        // name (e.g. `key`) don't collide as duplicate matcher bindings.
        let an_mv: Vec<Vec<_>> = methods
            .iter()
            .map(|m| {
                m.args
                    .iter()
                    .map(|(n, _)| {
                        let mv = format_ident!("{}__{}", m.name, n);
                        quote! { $#mv }
                    })
                    .collect()
            })
            .collect();
        let at_alias: Vec<Vec<_>> = methods
            .iter()
            .map(|m| {
                m.args
                    .iter()
                    .map(|(an, _)| format_ident!("__{}__{}__arg_{}", name, m.name, an))
                    .collect()
            })
            .collect();
        // `$e_<method>` — distinct expr metavar per method (a single `$e` would
        // collide across the outer repetition).
        let e_mv: Vec<_> = methods
            .iter()
            .map(|m| {
                let e = format_ident!("e_{}", m.name);
                quote! { $#e }
            })
            .collect();

        quote! {
            ( #v for $T:ty => | $th:ident | {
                #( #mn ( #( #an_mv:ident ),* ) => #e_mv:expr , )*
            } ) => {
                const _: () = {
                    #(
                        #[unsafe(no_mangle)]
                        #[doc(hidden)]
                        #[allow(non_snake_case)]
                        unsafe fn #s(
                            __owner: *mut () #(, #an_mv: $crate::#at_alias<'_>)*
                        ) -> $crate::#ret_alias {
                            let $th: *mut $T = __owner.cast();
                            let _ = $th;
                            #[allow(
                                unused_unsafe,
                                clippy::macro_metavars_in_unsafe,
                                unreachable_code,
                            )]
                            unsafe { #e_mv }
                        }
                    )*
                };
            };
        }
    });

    quote! {
        #[repr(u8)]
        #[derive(Copy, Clone, PartialEq, Eq, Debug)]
        #vis enum #kind { #(#variants),* }

        #[derive(Copy, Clone)]
        #vis struct #name {
            pub kind: #kind,
            pub owner: *mut (),
        }

        impl #name {
            /// SAFETY: `owner` must be a live `*mut T` where `T` is the
            /// concrete type the `kind` variant's `link_impl_*!` was written
            /// for, and must remain live for every dispatch through the
            /// returned handle. This is the only place the caller writes
            /// `unsafe` for this interface — the dispatch methods are safe
            /// given this precondition.
            #[inline]
            pub unsafe fn new<T: ?Sized>(kind: #kind, owner: *mut T) -> Self {
                Self { kind, owner: owner as *mut () }
            }
            #[inline]
            pub fn is(&self, kind: #kind) -> bool { self.kind == kind }
        }

        #(#sig_aliases)*

        #[allow(non_snake_case)]
        mod #externs_mod {
            use super::*;
            unsafe extern "Rust" { #(#externs)* }
        }

        impl #name { #(#dispatchers)* }

        // `#[macro_export]` hoists this to the *crate root* of whichever crate
        // calls `link_interface!`, regardless of the call-site module — so
        // high-tier crates address it as `<declaring_crate>::link_impl_<Iface>!`.
        // Emitted under its public name directly (no hidden-name + `pub use`
        // alias) so that path actually resolves; a module-local re-export
        // wouldn't reach the crate root.
        #[macro_export]
        macro_rules! #impl_macro {
            #(#entry_arms)*
        }
    }
    .into()
}
