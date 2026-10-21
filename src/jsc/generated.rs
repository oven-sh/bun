//! Hand-written Rust surface for the `.classes.ts` codegen.
//!
//! One module per class downstream crates name directly, wrapping its `generate-classes.ts` C++ exports.
//!
//! Symbol-naming contract (kept in sync with generate-classes.ts):
//!   `${T}Prototype__${name}GetCachedValue(JSValue) -> JSValue`
//!   `${T}Prototype__${name}SetCachedValue(JSValue, *JSGlobalObject, JSValue)`
//!   `${T}__fromJS` / `${T}__fromJSDirect` / `${T}__create` / `${T}__getConstructor`

// ──────────────────────────────────────────────────────────────────────────
// Per-class cached-accessor modules.
//
// Each `JS${Type}` module exposes the C++-side hooks the `.classes.ts`
// generator emits: `from_js` / `from_js_direct` / `to_js` / `get_constructor`
// plus one `${name}_get_cached` / `${name}_set_cached` pair per
// `cache: true` property. The bodies are filled in by
// `bun_jsc::codegen_cached_accessors!` — see that macro for the extern-symbol
// contract.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// `impl_js_class_via_generated!` — single-source `JsClass` impl that delegates
// to a per-type generated accessor module (any module exposing the standard
// `from_js` / `from_js_direct` / `to_js` [/ `get_constructor`] free-fn surface:
// `crate::generated_classes::js_$T` from generate-classes.ts, the
// `js_class_module!` expansions in this file, or `bun_sql_jsc::jsc::codegen`).
//
// The three generators disagree on `from_js`'s return shape
// (`Option<NonNull<T>>` vs `Option<*mut T>` vs `Option<*mut ()>`); the
// [`IntoRawMut`] adapter erases that difference with a single `.cast()`, so
// one macro body compiles against all three. `to_js` uniformly takes
// `*mut <gen-payload>`, which `.cast()` reaches from `*mut Self` regardless of
// whether the payload is `Self`, `Self<'static>`, or type-erased `()`.
// ──────────────────────────────────────────────────────────────────────────

/// Adapter erasing the `from_js` return-type difference between accessor-module
/// generators (`NonNull<U>` vs `*mut U`). Used by
/// [`impl_js_class_via_generated!`]; not part of the public API.
#[doc(hidden)]
pub trait IntoRawMut<T> {
    fn into_raw_mut(self) -> *mut T;
}
#[doc(hidden)]
impl<T, U> IntoRawMut<T> for core::ptr::NonNull<U> {
    #[inline]
    fn into_raw_mut(self) -> *mut T {
        self.as_ptr().cast()
    }
}
#[doc(hidden)]
impl<T, U> IntoRawMut<T> for *mut U {
    #[inline]
    fn into_raw_mut(self) -> *mut T {
        self.cast()
    }
}

/// `impl JsClass for $T` that boxes `self` into the GC-owned `m_ctx` slot and
/// routes every method through `$gen` (a `js_$T`-shaped accessor module).
///
/// # Forms
/// ```ignore
/// impl_js_class_via_generated!(Foo => crate::generated_classes::js_Foo);
/// impl_js_class_via_generated!(Foo => path::to::JSFoo, no_constructor);
/// impl_js_class_via_generated!(for<'a> Foo<'a> => js_Foo, no_constructor);
/// ```
///
/// `no_constructor` skips `get_constructor` (the `.classes.ts` `noConstructor:
/// true` case — no `${T}__getConstructor` C++ export); the trait default
/// (`JSValue::UNDEFINED`) applies.
///
/// **Do not use** when `to_js` carries side-effects beyond box-and-hand-off
/// (e.g. `Request` runs `calculate_estimated_byte_size` + body-stream GC
/// migration) or when the payload is intrusively refcounted and never held
/// by-value.
#[macro_export]
macro_rules! impl_js_class_via_generated {
    // `for<…>` arms FIRST: a leading `for` would otherwise feed into the `:ty`
    // arm's fragment parser, which commits to HRTB syntax and hard-errors on
    // `for<'a> Struct<'a>` ("expected trait") instead of backtracking.
    (for<$($lt:lifetime),+> $T:ty => $gen:path) => {
        $crate::impl_js_class_via_generated!(@emit { $($lt),+ } $T => $gen { with_ctor });
    };
    (for<$($lt:lifetime),+> $T:ty => $gen:path, no_constructor) => {
        $crate::impl_js_class_via_generated!(@emit { $($lt),+ } $T => $gen {});
    };
    ($T:ty => $gen:path) => {
        $crate::impl_js_class_via_generated!(@emit {} $T => $gen { with_ctor });
    };
    ($T:ty => $gen:path, no_constructor) => {
        $crate::impl_js_class_via_generated!(@emit {} $T => $gen {});
    };
    (@emit { $($lt:lifetime),* } $T:ty => $gen:path { $($with_ctor:ident)? }) => {
        impl<$($lt),*> $crate::JsClass for $T {
            #[inline]
            fn from_js(v: $crate::JSValue) -> ::core::option::Option<*mut Self> {
                use $gen as __g;
                __g::from_js(v).map($crate::generated::IntoRawMut::into_raw_mut)
            }
            #[inline]
            fn from_js_direct(v: $crate::JSValue) -> ::core::option::Option<*mut Self> {
                use $gen as __g;
                __g::from_js_direct(v).map($crate::generated::IntoRawMut::into_raw_mut)
            }
            #[inline]
            fn to_js(self, g: &$crate::JSGlobalObject) -> $crate::JSValue {
                use $gen as __g;
                // Ownership of the boxed payload transfers to the C++ wrapper
                // (freed via `${T}Class__finalize`). `.cast()` erases any
                // payload-type / lifetime mismatch between `Self` and the
                // accessor module's monomorphized pointee.
                __g::to_js($crate::heap::into_raw(::std::boxed::Box::new(self)).cast(), g)
            }
            $(
                #[inline]
                fn get_constructor(g: &$crate::JSGlobalObject) -> $crate::JSValue {
                    let _: &str = ::core::stringify!($with_ctor); // bind the rep var
                    use $gen as __g;
                    __g::get_constructor(g)
                }
            )?
        }
    };
}

/// Expands to a `pub mod $mod` containing the standard `.classes.ts` codegen
/// surface for a JS wrapper class: `from_js` / `from_js_direct` / `from_js_ref`
/// / `to_js` / `to_js_unchecked` / `get_constructor`,
/// plus a cached-accessor pair per listed property.
///
/// One impl, generated once — see
/// `src/codegen/generate-classes.ts:2428`. All extern symbols use
/// `JSC_CALLCONV` (= sysv64 on win-x64, C otherwise).
///
/// `$Payload` is the native `m_ctx` payload type. When the payload struct is
/// defined in (or below) this crate — e.g. `webcore_types::Blob` — pass it so
/// the extern signatures here unify with that file's typed declarations
/// (avoids `clashing_extern_declarations`). When the payload lives in a
/// dependent crate (`bun_runtime`), pass `()` (type-erased; the dependent
/// crate casts).
///
/// # Forms
/// ```ignore
/// js_class_module!(JSFoo = "Foo" { propA, propB });                 // Payload = ()
/// js_class_module!(JSFoo = "Foo" as super::Foo { propA });          // typed Payload
/// js_class_module!(JSFoo = "Foo" as super::Foo, impl_js_class {});  // + impl JsClass for Foo
/// ```
#[macro_export]
macro_rules! js_class_module {
    // Shorthand: payload erased to `()` (lives in a higher crate).
    (
        $mod_name:ident = $TypeName:literal { $( $prop:ident ),* $(,)? }
    ) => {
        $crate::js_class_module!($mod_name = $TypeName as () { $( $prop ),* });
    };
    // Typed payload + auto-`impl JsClass for $Payload` delegating back into the
    // emitted module. Opt-in (some payloads — e.g. the SQL connection types —
    // hand-roll `JsClass` separately to layer on extra behaviour).
    (
        $mod_name:ident = $TypeName:literal as $Payload:ty, impl_js_class { $( $prop:ident ),* $(,)? }
    ) => {
        $crate::js_class_module!($mod_name = $TypeName as $Payload { $( $prop ),* });
        $crate::impl_js_class_via_generated!($Payload => $mod_name);
    };
    (
        $mod_name:ident = $TypeName:literal as $Payload:ty { $( $prop:ident ),* $(,)? }
    ) => {
        #[allow(non_snake_case)]
        pub mod $mod_name {
            use $crate::{JSGlobalObject, JSValue};
            $crate::codegen_cached_accessors!($TypeName; $( $prop ),*);

            type Payload = $Payload;

            // `${TypeName}__fromJS` / `__fromJSDirect` / `__create` /
            // `__getConstructor` — implemented in C++ by
            // `src/codegen/generate-classes.ts` (`symbolName(typeName, name)`
            // ⇒ `${typeName}__${name}`). All use `JSC_CALLCONV` (= sysv64 on
            // win-x64, C otherwise).
            //
            // `improper_ctypes`: when `$Payload` is a real Rust struct (e.g.
            // `Blob`) the lint recurses through its fields and flags
            // non-`#[repr(C)]` interiors. The pointer is opaque to C++ — only
            // Rust dereferences it — so the lint is a false positive here.
            // `safe fn`: `JSValue` is a by-value tagged i64 and `JSGlobalObject`
            // is an opaque `UnsafeCell`-backed ZST handle (`&` is ABI-identical
            // to a non-null `*mut`). `__from_js*` only type-check the encoded
            // value and return the stored `m_ctx` pointer (or null) — the C++
            // side never dereferences `Payload`, so there is no Rust-side
            // precondition.
            $crate::jsc_abi_extern! {
                #[allow(improper_ctypes)]
                {
                    #[link_name = concat!($TypeName, "__fromJS")]
                    safe fn __from_js(value: JSValue) -> *mut Payload;
                    #[link_name = concat!($TypeName, "__fromJSDirect")]
                    safe fn __from_js_direct(value: JSValue) -> *mut Payload;
                    #[link_name = concat!($TypeName, "__create")]
                    safe fn __create(global: *mut JSGlobalObject, ptr: *mut Payload) -> JSValue;
                    #[link_name = concat!($TypeName, "__getConstructor")]
                    safe fn __get_constructor(global: &JSGlobalObject) -> JSValue;
                }
            }

            /// Return the wrapped native pointer if `value` is (a subclass of)
            /// the JS wrapper type; `None` on type mismatch.
            #[inline]
            pub fn from_js(value: JSValue) -> ::core::option::Option<*mut Payload> {
                let ptr = __from_js(value);
                if ptr.is_null() { None } else { Some(ptr) }
            }

            /// As `from_js`, but only matches *direct* instances with the
            /// canonical structure (no subclass / no expando properties).
            #[inline]
            pub fn from_js_direct(value: JSValue) -> ::core::option::Option<*mut Payload> {
                let ptr = __from_js_direct(value);
                if ptr.is_null() { None } else { Some(ptr) }
            }

            /// [`from_js`] as a [`ParentRef`](::bun_ptr::ParentRef) — wraps the
            /// raw `m_ctx` backref deref. The payload is GC-rooted by the
            /// caller's `CallFrame` for the duration of the host call, so the
            /// `ParentRef` invariant (pointee outlives holder) holds for any
            /// stack-scoped use.
            #[inline]
            pub fn from_js_ref(v: JSValue) -> ::core::option::Option<::bun_ptr::ParentRef<Payload>> {
                from_js(v)
                    .and_then(::core::ptr::NonNull::new)
                    .map(::bun_ptr::ParentRef::from)
            }

            /// Create a new JS wrapper instance owning `ptr`. The C++ side
            /// allocates the JSCell with the cached structure and stores `ptr`
            /// in `m_ctx`; ownership transfers to the GC (`finalize` frees it).
            #[inline]
            pub fn to_js(ptr: *mut Payload, global: &JSGlobalObject) -> JSValue {
                __create(global.as_ptr(), ptr)
            }

            /// Alias for [`to_js`] with `(global, ptr)` argument
            /// order, so `Response::to_js` / `Request::to_js` call sites
            /// resolve without reordering.
            #[inline]
            pub fn to_js_unchecked(global: &JSGlobalObject, ptr: *mut Payload) -> JSValue {
                to_js(ptr, global)
            }

            /// Lazily fetch the constructor `JSFunction` from `globalObject`.
            #[inline]
            pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
                __get_constructor(global)
            }
        }
    };
}

// Payload `Blob` lives in this crate (`webcore_types`) — pass it so the extern
// signatures unify with the typed declarations there.
js_class_module!(JSBlob      = "Blob"      as crate::webcore_types::Blob { name, stream });
js_class_module!(JSResponse  = "Response"  { body, headers, url, statusText, stream });
js_class_module!(JSRequest   = "Request"   { body, headers, url, signal, stream });
// `values: ["resolve", "reject"]` in src/runtime/api/Shell.classes.ts.
js_class_module!(JSShellInterpreter      = "ShellInterpreter"      { resolve, reject });
