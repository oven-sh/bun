//! Proc-macros for `bun_jsc`.
//!
//! These generate the JSC host-function glue. Rust cannot accept a macro in
//! `extern "<abi>"` position, so the JSC calling convention (`"sysv64"` on
//! Windows-x64, `"C"` elsewhere) is encoded by emitting two `#[cfg]`-gated
//! shims from a proc-macro instead.

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{
    FnArg, Ident, ItemFn, LitStr, Token,
    parse::{Parse, ParseStream},
    parse_macro_input,
    spanned::Spanned,
};

// ──────────────────────────────────────────────────────────────────────────
// #[bun_jsc::host_call] — bare ABI rewrite for non-JSHostFn signatures
// (e.g. a static getter, `fn(*mut JSGlobalObject, JSValue, *const c_void) -> JSValue`).
// ──────────────────────────────────────────────────────────────────────────

#[proc_macro_attribute]
pub fn host_call(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let func = parse_macro_input!(item as ItemFn);
    let vis = &func.vis;
    let sig = &func.sig;
    let block = &func.block;
    let attrs = &func.attrs;
    // Re-emit the user fn twice with the per-target ABI; no result-mapping.
    let name = &sig.ident;
    let inputs = &sig.inputs;
    let output = &sig.output;
    let (impl_generics, _ty_generics, where_clause) = sig.generics.split_for_impl();
    // No implicit `#[no_mangle]`: types share method names. A C symbol comes from the caller's `export_name` attribute.
    quote! {
        #[cfg(all(windows, target_arch = "x86_64"))]
        #(#attrs)*
        #vis unsafe extern "sysv64" fn #name #impl_generics(#inputs) #output #where_clause #block

        #[cfg(not(all(windows, target_arch = "x86_64")))]
        #(#attrs)*
        #vis unsafe extern "C" fn #name #impl_generics(#inputs) #output #where_clause #block
    }
    .into()
}

// ──────────────────────────────────────────────────────────────────────────
// #[uws_callback] / #[uws_callback(export = "Name", no_catch)]
//
// Wraps a `&self` / `&mut self` method in an `extern "C"` thunk suitable for
// registration with uWS / uSockets / any C-ABI callback that round-trips a
// type-erased `*mut c_void` user-data pointer. The thunk:
//
//   - takes `*mut c_void` (or `*const c_void` for `&self`) as the receiver
//     position and casts it back to `Self`;
//   - lowers each `&[T]` / `&mut [T]` parameter to a `(ptr, len)` pair and
//     reconstructs the slice via `slice::from_raw_parts{,_mut}`. A `&mut [T]`
//     argument **must not alias any memory reachable through `*self`** — the
//     macro cannot check this and the thunk holds both borrows live;
//   - passes every other parameter through verbatim (so FFI-safe scalars,
//     raw pointers, and `#[repr(C)]` structs are forwarded unchanged).
//     `&T` / `Option<&T>` are intentionally passed straight across the ABI
//     boundary as thin pointers — the *caller* upholds non-null/aligned/live,
//     same as the hand-written thunks this macro replaces.
//
// With `panic = "abort"` Rust panics terminate inside the crash-handler hook
// before unwinding starts, so no `catch_unwind` wrapper is emitted — the body
// runs directly. `no_catch` is still accepted for source compatibility but is
// now a no-op.
//
// The user body contains **no `unsafe`** — all pointer reconstruction lives in
// the generated thunk under a single `// SAFETY:` umbrella whose
// invariant is: the registered ctx pointer is the same `*mut Self`
// the caller passed to the C side, and any `(ptr, len)` pair describes a slice
// valid for the duration of the callback.
//
// The generated thunk is named `__<method>_c`.
// `export = "Sym"` adds `#[unsafe(export_name = "Sym")]` for link-time
// dispatch shims (cycle-break externs).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct UwsCallbackArgs {
    export: Option<LitStr>,
    no_catch: bool,
}

impl Parse for UwsCallbackArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let mut out = UwsCallbackArgs::default();
        while !input.is_empty() {
            let ident: Ident = input.parse()?;
            match ident.to_string().as_str() {
                "no_catch" => out.no_catch = true,
                "export" => {
                    input.parse::<Token![=]>()?;
                    out.export = Some(input.parse()?);
                }
                other => {
                    return Err(syn::Error::new(
                        ident.span(),
                        format!("unknown #[uws_callback] argument `{other}`"),
                    ));
                }
            }
            if input.peek(Token![,]) {
                input.parse::<Token![,]>()?;
            }
        }
        Ok(out)
    }
}

#[proc_macro_attribute]
pub fn uws_callback(attr: TokenStream, item: TokenStream) -> TokenStream {
    let args = parse_macro_input!(attr as UwsCallbackArgs);
    let func = parse_macro_input!(item as ItemFn);
    expand_uws_callback(&args, &func)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_uws_callback(args: &UwsCallbackArgs, func: &ItemFn) -> syn::Result<TokenStream2> {
    let fn_name = &func.sig.ident;
    let vis = &func.vis;

    // Receiver: `&self` → `*const c_void`, `&mut self` → `*mut c_void`.
    let recv = match func.sig.inputs.first() {
        Some(FnArg::Receiver(r)) => r,
        _ => {
            return Err(syn::Error::new(
                func.sig.ident.span(),
                "#[uws_callback] requires `&self` or `&mut self` as the first parameter",
            ));
        }
    };
    let recv_mut = recv.mutability.is_some();
    let (ctx_ty, recv_expr) = if recv_mut {
        (
            quote! { *mut ::core::ffi::c_void },
            quote! { &mut *__ctx.cast::<Self>() },
        )
    } else {
        (
            quote! { *const ::core::ffi::c_void },
            quote! { &*__ctx.cast::<Self>() },
        )
    };

    // Lower each non-receiver parameter.
    let mut thunk_params: Vec<TokenStream2> = vec![quote! { __ctx: #ctx_ty }];
    let mut prelude: Vec<TokenStream2> = Vec::new();
    let mut call_args: Vec<TokenStream2> = Vec::new();

    for (i, arg) in func.sig.inputs.iter().enumerate().skip(1) {
        let FnArg::Typed(pt) = arg else {
            return Err(syn::Error::new(arg.span(), "unexpected receiver"));
        };
        let name = match &*pt.pat {
            syn::Pat::Ident(id) => id.ident.clone(),
            _ => format_ident!("__arg{}", i),
        };
        match classify_uws_arg(&pt.ty) {
            UwsArg::Slice { elem, mutable } => {
                let p = format_ident!("{}_ptr", name);
                let l = format_ident!("{}_len", name);
                let ptr_ty = if mutable {
                    quote! { *mut #elem }
                } else {
                    quote! { *const #elem }
                };
                thunk_params.push(quote! { #p: #ptr_ty });
                thunk_params.push(quote! { #l: usize });
                // Tolerate (null, 0) — uWS passes this for empty buffers, and
                // `from_raw_parts(null, 0)` is UB. Use an explicit, obviously-sound
                // construction per mutability instead of `(&mut [][..]) as _`,
                // which borrows a temporary and relies on a non-existent
                // `&mut [T] -> &[T]` `as`-cast.
                prelude.push(if mutable {
                    quote! {
                        // SAFETY: caller guarantees `#p[..#l]` valid for the call;
                        // for #l == 0 a dangling well-aligned pointer is the
                        // canonical empty `&mut [T]`.
                        let #name: &mut [#elem] = unsafe {
                            ::core::slice::from_raw_parts_mut(
                                if #l == 0 {
                                    ::core::ptr::NonNull::<#elem>::dangling().as_ptr()
                                } else {
                                    #p
                                },
                                #l,
                            )
                        };
                    }
                } else {
                    quote! {
                        let #name: &[#elem] = if #l == 0 {
                            &[]
                        } else {
                            // SAFETY: caller guarantees `#p[..#l]` valid for the call.
                            unsafe { ::core::slice::from_raw_parts(#p, #l) }
                        };
                    }
                });
                call_args.push(quote! { #name });
            }
            UwsArg::PassThrough(ty) => {
                thunk_params.push(quote! { #name: #ty });
                call_args.push(quote! { #name });
            }
        }
    }

    let ret = match &func.sig.output {
        syn::ReturnType::Default => quote! { () },
        syn::ReturnType::Type(_, t) => quote! { #t },
    };

    let thunk_ident = format_ident!("__{}_c", fn_name);
    let export_attr = args.export.as_ref().map(|l| {
        quote! { #[unsafe(export_name = #l)] }
    });

    let inner_call = quote! {
        // Slice args are reconstructed from (ptr, len) pairs the caller
        // guarantees valid for the call. Do this *before* borrowing `__this`
        // so a future `&mut [T]` arg that (incorrectly) aliased `*self` would
        // at least not be lexically interleaved with the receiver borrow.
        #(#prelude)*
        // SAFETY: `__ctx` is the `*Self` registered with the C side; uWS / the
        // caller guarantees it is live and exclusively accessed for the
        // duration of the callback.
        let __this = unsafe { #recv_expr };
        Self::#fn_name(__this, #(#call_args),*)
    };

    // `panic = "abort"` → no unwind ever reaches the thunk, so call the body
    // directly. `no_catch` is parsed but ignored (kept for source compat).
    let _ = args.no_catch;
    let body = quote! { #inner_call };

    let thunk = quote! {
        #export_attr
        #[doc(hidden)]
        #[allow(improper_ctypes_definitions, clippy::not_unsafe_ptr_arg_deref)]
        #vis unsafe extern "C" fn #thunk_ident(#(#thunk_params),*) -> #ret {
            #body
        }
    };

    Ok(quote! {
        #func
        #thunk
    })
}

enum UwsArg {
    Slice { elem: syn::Type, mutable: bool },
    PassThrough(syn::Type),
}

fn classify_uws_arg(ty: &syn::Type) -> UwsArg {
    if let syn::Type::Reference(r) = ty {
        if let syn::Type::Slice(s) = &*r.elem {
            return UwsArg::Slice {
                elem: (*s.elem).clone(),
                mutable: r.mutability.is_some(),
            };
        }
    }
    UwsArg::PassThrough(ty.clone())
}

/// `#[derive(JsAffine)]` — the struct/enum may be (part of) a job's `Js`
/// half (`bun_jsc::JobContext::Js`): every field must itself be
/// `JsAffine`, which the expansion checks with one bound per field type, so
/// a field that owns process memory (a `Vec`, a `Box`, a C library handle) is
/// a compile error here rather than a leak-or-UAF decision at teardown.
#[proc_macro_derive(JsAffine)]
pub fn derive_js_affine(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as syn::DeriveInput);
    let name = &input.ident;
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();
    let mut field_tys: Vec<&syn::Type> = Vec::new();
    match &input.data {
        syn::Data::Struct(s) => field_tys.extend(s.fields.iter().map(|f| &f.ty)),
        syn::Data::Enum(e) => {
            for v in &e.variants {
                field_tys.extend(v.fields.iter().map(|f| &f.ty));
            }
        }
        syn::Data::Union(u) => {
            return syn::Error::new_spanned(u.union_token, "JsAffine: unions are not supported")
                .to_compile_error()
                .into();
        }
    }
    let checks = field_tys.iter().map(|ty| {
        quote! { __assert_js_affine::<#ty>(); }
    });
    // The field checks sit in an associated const on the type itself, so its
    // generic parameters are in scope and nothing is left unused.
    quote! {
        // SAFETY: every field is `JsAffine` (checked below).
        unsafe impl #impl_g ::bun_jsc::job::JsAffine for #name #ty_g #where_g {}
        #[doc(hidden)]
        impl #impl_g #name #ty_g #where_g {
            pub const __JS_AFFINE_FIELDS: () = {
                const fn __assert_js_affine<T: ?Sized + ::bun_jsc::job::JsAffine>() {}
                #(#checks)*
            };
        }
    }
    .into()
}
