//! Proc-macros for `bun_jsc`.
//!
//! These replace the Zig `comptime`/`@typeInfo` reflection in `host_fn.zig`
//! and the `.classes.ts` codegen (`src/codegen/generate-classes.ts`). Rust
//! cannot accept a macro in `extern "<abi>"` position, so the JSC calling
//! convention (`"sysv64"` on Windows-x64, `"C"` elsewhere) is encoded by
//! emitting two `#[cfg]`-gated shims from a proc-macro instead.
//!
//! See `docs/PORTING.md` §JSC types and §FFI.

use proc_macro::TokenStream;
use proc_macro2::{Span, TokenStream as TokenStream2};
use quote::{format_ident, quote};
use syn::{
    parse::{Parse, ParseStream},
    parse_macro_input, spanned::Spanned, FnArg, Ident, ItemEnum, ItemFn, ItemStruct, LitStr, Token,
};

// ──────────────────────────────────────────────────────────────────────────
// #[bun_jsc::host_fn] / #[bun_jsc::host_fn(method|getter|setter)] /
// #[bun_jsc::host_fn(export = "Name")]
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct HostFnArgs {
    kind: HostFnKind,
    export: Option<LitStr>,
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum HostFnKind {
    /// `fn(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>`
    #[default]
    Free,
    /// `fn(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>`
    Method,
    /// `fn(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue>`
    Getter,
    /// `fn(this: &mut Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool>`
    Setter,
}

impl Parse for HostFnArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let mut out = HostFnArgs::default();
        while !input.is_empty() {
            let ident: Ident = input.parse()?;
            match ident.to_string().as_str() {
                "method" => out.kind = HostFnKind::Method,
                "getter" => out.kind = HostFnKind::Getter,
                "setter" => out.kind = HostFnKind::Setter,
                "export" => {
                    input.parse::<Token![=]>()?;
                    out.export = Some(input.parse()?);
                }
                other => {
                    return Err(syn::Error::new(
                        ident.span(),
                        format!("unknown #[host_fn] argument `{other}`"),
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

/// Emit an extern shim with the JSC calling convention.
/// The body is duplicated under two `#[cfg]` arms because Rust does not accept
/// a macro/const in ABI-string position.
///
/// `export_name = None` means no `#[export_name]` is emitted (Rust mangling
/// applies); used for the default getter/setter/method case where the real
/// link name is owned by the `JsClass` codegen and the placeholder shim only
/// needs to type-check, not link.
fn jsc_extern_fn(
    export_name: Option<&str>,
    sig_args: TokenStream2,
    ret: TokenStream2,
    body: TokenStream2,
) -> TokenStream2 {
    let export_attr = export_name.map(|n| {
        let lit = LitStr::new(n, Span::call_site());
        quote! { #[unsafe(export_name = #lit)] }
    });
    quote! {
        #[cfg(all(windows, target_arch = "x86_64"))]
        #export_attr
        #[doc(hidden)]
        pub unsafe extern "sysv64" fn #sig_args -> #ret { #body }

        #[cfg(not(all(windows, target_arch = "x86_64")))]
        #export_attr
        #[doc(hidden)]
        pub unsafe extern "C" fn #sig_args -> #ret { #body }
    }
}

#[proc_macro_attribute]
pub fn host_fn(attr: TokenStream, item: TokenStream) -> TokenStream {
    let args = parse_macro_input!(attr as HostFnArgs);
    let func = parse_macro_input!(item as ItemFn);
    expand_host_fn(args, func)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_host_fn(args: HostFnArgs, func: ItemFn) -> syn::Result<TokenStream2> {
    let fn_name = &func.sig.ident;
    let fn_name_str = fn_name.to_string();

    // Detect a leading receiver (`&self` / `&mut self`). When present, the
    // shim is emitted *inside* the surrounding `impl` block so it can name
    // `Self`; the C-ABI signature passes `*mut Self` as the first argument
    // (the codegen'd C++ passes `m_ctx`).
    let has_receiver = func
        .sig
        .inputs
        .first()
        .is_some_and(|a| matches!(a, FnArg::Receiver(_)));

    // Shim symbol name. Only emitted when an explicit `export = "..."` is
    // supplied. In Zig, `@export(&toJSHostFn(f), .{ .name = ... })` always
    // received a caller-supplied unique name; defaulting to the bare Rust
    // ident here produces cross-module link collisions for common names
    // (`parse`, `getter`, `crc32`, …) once codegen runs. With no explicit
    // export, Rust mangling on `__jsc_host_<name>` keeps each module's shim
    // unique — same rationale as the getter/setter/method case below, where
    // the `.classes.ts` generator owns the link name (`TypePrototype__name`
    // etc.) and the `JsClass` macro re-emits with the proper name.
    let _ = fn_name_str;
    let export: Option<String> = args.export.as_ref().map(|l| l.value());
    let shim_ident = format_ident!("__jsc_host_{}", fn_name);

    let (sig_args, ret, body): (TokenStream2, TokenStream2, TokenStream2) = match args.kind {
        HostFnKind::Free if !has_receiver => (
            quote! {
                #shim_ident(
                    __global: *mut ::bun_jsc::JSGlobalObject,
                    __frame: *mut ::bun_jsc::CallFrame,
                )
            },
            quote! { ::bun_jsc::JSValue },
            quote! {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let __g = unsafe { &*__global };
                let __f = unsafe { &*__frame };
                ::bun_jsc::__macro_support::host_fn_result(__g, #fn_name(__g, __f))
            },
        ),
        // `Free` with a receiver == method-style (PORTING.md permits omitting
        // the `(method)` arg when the signature has `&self`).
        HostFnKind::Free | HostFnKind::Method => (
            quote! {
                #shim_ident(
                    __this: *mut Self,
                    __global: *mut ::bun_jsc::JSGlobalObject,
                    __frame: *mut ::bun_jsc::CallFrame,
                )
            },
            quote! { ::bun_jsc::JSValue },
            quote! {
                // SAFETY: `__this` is the wrapper's `m_ctx`; JSC guarantees the
                // remaining pointers are live for the call.
                let __t = unsafe { &mut *__this };
                let __g = unsafe { &*__global };
                let __f = unsafe { &*__frame };
                ::bun_jsc::__macro_support::host_fn_result(__g, Self::#fn_name(__t, __g, __f))
            },
        ),
        HostFnKind::Getter => (
            quote! {
                #shim_ident(
                    __this: *mut Self,
                    __global: *mut ::bun_jsc::JSGlobalObject,
                )
            },
            quote! { ::bun_jsc::JSValue },
            quote! {
                // SAFETY: see `Method`.
                let __t = unsafe { &*__this };
                let __g = unsafe { &*__global };
                ::bun_jsc::__macro_support::host_fn_result(__g, Self::#fn_name(__t, __g))
            },
        ),
        HostFnKind::Setter => (
            quote! {
                #shim_ident(
                    __this: *mut Self,
                    __global: *mut ::bun_jsc::JSGlobalObject,
                    __value: ::bun_jsc::JSValue,
                )
            },
            quote! { bool },
            quote! {
                // SAFETY: see `Method`.
                let __t = unsafe { &mut *__this };
                let __g = unsafe { &*__global };
                ::bun_jsc::__macro_support::host_fn_setter_result(
                    __g,
                    Self::#fn_name(__t, __g, __value),
                )
            },
        ),
    };

    let shim = jsc_extern_fn(export.as_deref(), sig_args, ret, body);

    Ok(quote! {
        #func
        #shim
    })
}

// ──────────────────────────────────────────────────────────────────────────
// bun_jsc::codegen_cached_accessors!("TypeName"; prop_a, prop_b, ...)
//
// Emits one `${snake}_get_cached` / `${snake}_set_cached` pair per listed
// property, each thin-wrapping the C++-side
//   `${TypeName}Prototype__${prop}GetCachedValue(JSValue) -> JSValue`
//   `${TypeName}Prototype__${prop}SetCachedValue(JSValue, *JSGlobalObject, JSValue)`
// shims that `src/codegen/generate-classes.ts` produces for every
// `cache: true` property. The getter maps `.zero` → `None` (matches the Zig
// `${name}GetCached` wrapper). Both extern blocks are duplicated under the
// JSC calling-convention `#[cfg]` split (see `jsc_extern_fn` above).
// ──────────────────────────────────────────────────────────────────────────

struct CachedAccessorsInput {
    type_name: LitStr,
    props: Vec<Ident>,
}

impl Parse for CachedAccessorsInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let type_name: LitStr = input.parse()?;
        // Accept either `;` or `,` between the type name and the prop list.
        if input.peek(Token![;]) {
            input.parse::<Token![;]>()?;
        } else if input.peek(Token![,]) {
            input.parse::<Token![,]>()?;
        }
        let mut props = Vec::new();
        while !input.is_empty() {
            props.push(input.parse()?);
            if input.peek(Token![,]) {
                input.parse::<Token![,]>()?;
            }
        }
        Ok(Self { type_name, props })
    }
}

#[proc_macro]
pub fn codegen_cached_accessors(input: TokenStream) -> TokenStream {
    let CachedAccessorsInput { type_name, props } = parse_macro_input!(input as CachedAccessorsInput);
    let ty = type_name.value();

    let mut out = TokenStream2::new();
    for prop in &props {
        let prop_str = prop.to_string();
        // C++ symbol uses the JS-side (camelCase) property name verbatim.
        let get_sym = LitStr::new(
            &format!("{ty}Prototype__{prop_str}GetCachedValue"),
            Span::call_site(),
        );
        let set_sym = LitStr::new(
            &format!("{ty}Prototype__{prop_str}SetCachedValue"),
            Span::call_site(),
        );
        // Rust-side wrapper names are snake_case (`idleTimeout` → `idle_timeout`).
        let snake = camel_to_snake(&prop_str);
        let get_fn = format_ident!("{snake}_get_cached");
        let set_fn = format_ident!("{snake}_set_cached");
        let get_ext = format_ident!("__{snake}_get_cached_value");
        let set_ext = format_ident!("__{snake}_set_cached_value");

        out.extend(quote! {
            #[cfg(all(windows, target_arch = "x86_64"))]
            unsafe extern "sysv64" {
                #[link_name = #get_sym]
                fn #get_ext(this_value: ::bun_jsc::JSValue) -> ::bun_jsc::JSValue;
                #[link_name = #set_sym]
                fn #set_ext(
                    this_value: ::bun_jsc::JSValue,
                    global: *mut ::bun_jsc::JSGlobalObject,
                    value: ::bun_jsc::JSValue,
                );
            }
            #[cfg(not(all(windows, target_arch = "x86_64")))]
            unsafe extern "C" {
                #[link_name = #get_sym]
                fn #get_ext(this_value: ::bun_jsc::JSValue) -> ::bun_jsc::JSValue;
                #[link_name = #set_sym]
                fn #set_ext(
                    this_value: ::bun_jsc::JSValue,
                    global: *mut ::bun_jsc::JSGlobalObject,
                    value: ::bun_jsc::JSValue,
                );
            }

            /// `JSC::WriteBarrier` slot read — `None` if never assigned.
            #[inline]
            pub fn #get_fn(this_value: ::bun_jsc::JSValue) -> ::core::option::Option<::bun_jsc::JSValue> {
                // SAFETY: pure FFI read of a `WriteBarrier<Unknown>` slot on the
                // C++ wrapper; `this_value` must be the codegen'd JSCell.
                let result = unsafe { #get_ext(this_value) };
                if result == ::bun_jsc::JSValue::ZERO { None } else { Some(result) }
            }

            /// `JSC::WriteBarrier` slot write — emits a GC write barrier.
            #[inline]
            pub fn #set_fn(
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
                value: ::bun_jsc::JSValue,
            ) {
                // SAFETY: `global` is live; FFI does `m_${prop}.set(vm, this, value)`.
                // `as_mut_ptr` derives `*mut` via the `UnsafeCell` interior, so the
                // C++ write barrier mutating VM/heap state is sound under Stacked
                // Borrows (a `&T as *const T as *mut T` cast would not be).
                unsafe { #set_ext(this_value, global.as_mut_ptr(), value) }
            }
        });
    }
    out.into()
}

fn camel_to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.char_indices() {
        if ch.is_ascii_uppercase() {
            if i != 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

// ──────────────────────────────────────────────────────────────────────────
// #[bun_jsc::host_call] — bare ABI rewrite for non-JSHostFn signatures
// (e.g. `hasPendingActivity: extern fn(*mut Self) -> bool`).
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
    let generics = &sig.generics;
    // No implicit `#[no_mangle]` — multiple types share method names
    // (`has_pending_activity`, `ptr_without_type_checks`, …) and collide at
    // codegen otherwise. The generated `.classes.ts` wrappers own the canonical
    // `${T}__hasPendingActivity` link names; callers needing a C symbol attach
    // `#[unsafe(export_name = "…")]` themselves (re-emitted via `#(#attrs)*`).
    quote! {
        #[cfg(all(windows, target_arch = "x86_64"))]
        #(#attrs)*
        #vis unsafe extern "sysv64" fn #name #generics(#inputs) #output #block

        #[cfg(not(all(windows, target_arch = "x86_64")))]
        #(#attrs)*
        #vis unsafe extern "C" fn #name #generics(#inputs) #output #block
    }
    .into()
}

// ──────────────────────────────────────────────────────────────────────────
// #[bun_jsc::JsClass] — emit `.classes.ts`-style C-ABI hooks.
//
// Mirrors `src/codegen/generate-classes.ts` symbol naming:
//   classSymbolName(T, "construct") → `${T}Class__construct`
//   classSymbolName(T, "finalize")  → `${T}Class__finalize`
//   symbolName(T, "estimatedSize")  → `${T}__estimatedSize`
//   `${T}__fromJS` / `${T}__fromJSDirect` / `${T}__create` (C++-side, imported)
//
// This is the *minimal* surface: getter/setter/method shims per
// `#[js(getter)]` etc. are emitted by `#[host_fn(..)]` on the impl methods;
// per-property `${T}Prototype__${name}` naming will be wired when the
// `.classes.ts` generator gains a `.rs` output mode.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct JsClassArgs {
    /// Override the C++-side type name (defaults to the Rust struct ident).
    name: Option<LitStr>,
    /// `finalize: false` in `.classes.ts` → skip the finalize hook.
    no_finalize: bool,
    /// `construct: false` → skip the construct hook.
    no_construct: bool,
    /// `noConstructor: true` in `.classes.ts` → C++ side does NOT emit
    /// `${T}__getConstructor` (generate-classes.ts:2449/2539). Skip the
    /// import-side extern so the linker doesn't see a dangling reference.
    no_constructor: bool,
    /// `estimatedSize: true` in `.classes.ts` → emit `${T}__estimatedSize`
    /// (generate-classes.ts:2170-2175). Off by default — the C++ side only
    /// links against this symbol when the class definition opts in.
    estimated_size: bool,
}

impl Parse for JsClassArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let mut out = JsClassArgs::default();
        while !input.is_empty() {
            let ident: Ident = input.parse()?;
            match ident.to_string().as_str() {
                "name" => {
                    input.parse::<Token![=]>()?;
                    out.name = Some(input.parse()?);
                }
                "no_finalize" => out.no_finalize = true,
                "no_construct" => out.no_construct = true,
                "no_constructor" => out.no_constructor = true,
                "estimated_size" => out.estimated_size = true,
                other => {
                    return Err(syn::Error::new(
                        ident.span(),
                        format!("unknown #[JsClass] argument `{other}`"),
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

#[allow(non_snake_case)]
#[proc_macro_attribute]
pub fn JsClass(attr: TokenStream, item: TokenStream) -> TokenStream {
    let args = parse_macro_input!(attr as JsClassArgs);
    // Accept both `struct` and `enum` payloads — Zig `.classes.ts` `m_ctx`
    // payloads are frequently `union(enum)`, which port to Rust `enum`s.
    let item2 = item.clone();
    if let Ok(strukt) = syn::parse::<ItemStruct>(item) {
        return expand_js_class(args, strukt)
            .unwrap_or_else(|e| e.to_compile_error())
            .into();
    }
    let enm = parse_macro_input!(item2 as ItemEnum);
    expand_js_class_enum(args, enm).into()
}

/// `#[derive(JsClass)]` form — same expansion, for callers that prefer derive
/// syntax. Field-level `#[js(...)]` attrs are accepted (and currently ignored;
/// method/getter shims live on the `impl` via `#[host_fn]`).
#[proc_macro_derive(JsClassDerive, attributes(js))]
pub fn js_class_derive(item: TokenStream) -> TokenStream {
    let strukt = parse_macro_input!(item as ItemStruct);
    // Derive can't see the struct tokens to re-emit them, so only emit the
    // hooks + trait impl.
    let hooks = js_class_hooks(&JsClassArgs::default(), &strukt.ident);
    hooks.into()
}

fn expand_js_class(args: JsClassArgs, strukt: ItemStruct) -> syn::Result<TokenStream2> {
    // Strip any helper `#[js(...)]` attrs from fields so the struct compiles
    // (they are metadata for the macro, not real attributes).
    let mut strukt = strukt;
    for field in strukt.fields.iter_mut() {
        field.attrs.retain(|a| !a.path().is_ident("js"));
    }
    let hooks = js_class_hooks(&args, &strukt.ident);
    Ok(quote! {
        #strukt
        #hooks
    })
}

fn expand_js_class_enum(args: JsClassArgs, enm: ItemEnum) -> TokenStream2 {
    let hooks = js_class_hooks(&args, &enm.ident);
    quote! {
        #enm
        #hooks
    }
}

fn js_class_hooks(args: &JsClassArgs, rust_ty: &Ident) -> TokenStream2 {
    let ty_name = args
        .name
        .as_ref()
        .map(|l| l.value())
        .unwrap_or_else(|| rust_ty.to_string());

    // C++→Rust export hooks (`${T}Class__construct` / `${T}Class__finalize` /
    // `${T}__estimatedSize` / `${T}__ZigStructSize`) are now emitted by
    // `generateRust()` in `src/codegen/generate-classes.ts` — see
    // `build/*/codegen/generated_classes.rs`. Emitting them here as well
    // produces duplicate-symbol link errors, so this macro is now *import-side
    // only*: it declares the C++ externs and supplies the `JsClass` trait impl.
    // The `no_finalize` / `no_construct` / `estimated_size` attribute knobs are
    // still accepted (call sites carry them, and they document the
    // `.classes.ts` shape), but no longer drive any token emission here.
    let _ = (args.no_finalize, args.no_construct, args.estimated_size);

    // Rust→C++ hooks (we import these; bodies live in generated C++).
    let from_js_sym = format!("{ty_name}__fromJS");
    let from_js_direct_sym = format!("{ty_name}__fromJSDirect");
    let create_sym = format!("{ty_name}__create");
    let get_ctor_sym = format!("{ty_name}__getConstructor");

    // `JsClass` trait impl — wraps the C++-side `fromJS`/`create` exports.
    // `callconv(jsc.conv)` on the import side: two cfg-gated `extern` blocks.
    let from_js_lit = LitStr::new(&from_js_sym, Span::call_site());
    let from_js_direct_lit = LitStr::new(&from_js_direct_sym, Span::call_site());
    let create_lit = LitStr::new(&create_sym, Span::call_site());
    let get_ctor_lit = LitStr::new(&get_ctor_sym, Span::call_site());

    // `noConstructor: true` classes have no C++-side `${T}__getConstructor`
    // export — emitting an `extern` for it produces a link-time undefined
    // symbol. Gate the decl + trait override; the `JsClass` trait supplies a
    // default `get_constructor` body so the impl stays well-formed.
    let (get_ctor_extern, get_ctor_impl) = if args.no_constructor {
        (quote! {}, quote! {})
    } else {
        (
            quote! {
                #[link_name = #get_ctor_lit]
                fn __get_constructor(global: *mut ::bun_jsc::JSGlobalObject) -> ::bun_jsc::JSValue;
            },
            quote! {
                fn get_constructor(global: &::bun_jsc::JSGlobalObject) -> ::bun_jsc::JSValue {
                    // SAFETY: `global` is live; C++ side returns the cached
                    // constructor (`WebCore::clientSubspaceFor*`-registered).
                    // `as_mut_ptr` derives `*mut` via `UnsafeCell` — the lazy
                    // init may mutate the global's constructor cache.
                    unsafe { __get_constructor(global.as_mut_ptr()) }
                }
            },
        )
    };

    let trait_impl = quote! {
        const _: () = {
            #[cfg(all(windows, target_arch = "x86_64"))]
            unsafe extern "sysv64" {
                #[link_name = #from_js_lit]
                fn __from_js(value: ::bun_jsc::JSValue) -> *mut #rust_ty;
                #[link_name = #from_js_direct_lit]
                fn __from_js_direct(value: ::bun_jsc::JSValue) -> *mut #rust_ty;
                #[link_name = #create_lit]
                fn __create(
                    global: *mut ::bun_jsc::JSGlobalObject,
                    ptr: *mut #rust_ty,
                ) -> ::bun_jsc::JSValue;
                #get_ctor_extern
            }
            #[cfg(not(all(windows, target_arch = "x86_64")))]
            unsafe extern "C" {
                #[link_name = #from_js_lit]
                fn __from_js(value: ::bun_jsc::JSValue) -> *mut #rust_ty;
                #[link_name = #from_js_direct_lit]
                fn __from_js_direct(value: ::bun_jsc::JSValue) -> *mut #rust_ty;
                #[link_name = #create_lit]
                fn __create(
                    global: *mut ::bun_jsc::JSGlobalObject,
                    ptr: *mut #rust_ty,
                ) -> ::bun_jsc::JSValue;
                #get_ctor_extern
            }

            impl ::bun_jsc::JsClass for #rust_ty {
                fn to_js(self, global: &::bun_jsc::JSGlobalObject) -> ::bun_jsc::JSValue {
                    let ptr = ::std::boxed::Box::into_raw(::std::boxed::Box::new(self));
                    // SAFETY: `global` is live; `ptr` ownership transfers to the
                    // C++ wrapper (freed via `${T}Class__finalize`). `as_mut_ptr`
                    // derives `*mut` via `UnsafeCell` so C++ allocating on the
                    // GC heap through this pointer is sound (no read-only
                    // provenance from `&JSGlobalObject`).
                    unsafe { __create(global.as_mut_ptr(), ptr) }
                }
                fn from_js(value: ::bun_jsc::JSValue) -> ::core::option::Option<*mut Self> {
                    // SAFETY: pure FFI downcast; returns null on type mismatch.
                    let p = unsafe { __from_js(value) };
                    if p.is_null() { None } else { Some(p) }
                }
                fn from_js_direct(value: ::bun_jsc::JSValue) -> ::core::option::Option<*mut Self> {
                    // SAFETY: pure FFI downcast; returns null on type mismatch.
                    let p = unsafe { __from_js_direct(value) };
                    if p.is_null() { None } else { Some(p) }
                }
                #get_ctor_impl
            }
        };
    };

    trait_impl
}

// ──────────────────────────────────────────────────────────────────────────
// Compile-time sanity: a `#[host_fn]` body must take refs, not raw pointers.
// (Best-effort lint; the real type-check happens when the shim calls the fn.)
// ──────────────────────────────────────────────────────────────────────────
#[allow(dead_code)]
fn assert_ref_args(func: &ItemFn) -> syn::Result<()> {
    for arg in &func.sig.inputs {
        if let FnArg::Typed(pt) = arg {
            if let syn::Type::Ptr(_) = &*pt.ty {
                return Err(syn::Error::new(
                    pt.ty.span(),
                    "#[host_fn] body takes references; the macro emits the raw-pointer shim",
                ));
            }
        }
    }
    Ok(())
}
