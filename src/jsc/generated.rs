//! Rust surface for the `.bindv2.ts` / `.classes.ts` codegen.
//!
//! Two distinct generators feed this file:
//!
//!   1. **bindgenv2 option-structs** (`src/codegen/bindgenv2`): `bindgen_generated.rs`, included below.
//!
//!   2. **per-class accessor modules** (`src/codegen/generate-classes.ts`).
//!      Each `JS${Type}` exposes
//!      `from_js` / `from_js_direct` / `to_js` / `get_constructor` thin-wrapping
//!      the `${Type}__fromJS` / `__fromJSDirect` / `__create` / `__getConstructor`
//!      C++ exports, plus one `${name}_get_cached` / `${name}_set_cached` pair
//!      per `cache: true` property.
//!
//! `generate-classes.ts` has no `.rs` backend yet, so this file ports its output by hand.
//!
//! Symbol-naming contract (kept in sync with generate-classes.ts):
//!   `${T}Prototype__${name}GetCachedValue(JSValue) -> JSValue`
//!   `${T}Prototype__${name}SetCachedValue(JSValue, *JSGlobalObject, JSValue)`
//!   `${T}__fromJS` / `${T}__fromJSDirect` / `${T}__create` / `${T}__getConstructor`

use core::ffi::c_uint;
use core::mem::MaybeUninit;

use crate::{JSCArrayBuffer, JSGlobalObject, JSValue, JsResult};

// ──────────────────────────────────────────────────────────────────────────
// Generic accessor wrappers.
//
// Per-field accessors come in two shapes: `.get()` (optional) /
// `.items()` (array). Dependents pattern-match on these without naming the
// wrapper type directly, so a pair of generic carriers covers every field.
// ──────────────────────────────────────────────────────────────────────────

/// Optional-value accessor: `field.get() -> Option<T>`.
#[derive(Debug, Default)]
pub struct GenOpt<T>(Option<T>);

impl<T> GenOpt<T> {
    #[inline]
    pub fn as_ref(&self) -> Option<&T> {
        self.0.as_ref()
    }
    #[inline]
    pub fn into_inner(self) -> Option<T> {
        self.0
    }
}

/// Required-value accessor: `field.get() -> T` (used inside tagged-union arms).
#[derive(Debug)]
pub struct GenVal<T>(T);

impl<T> GenVal<T> {
    #[inline]
    pub fn get(&self) -> T
    where
        T: Copy,
    {
        self.0
    }
    #[inline]
    pub fn as_ref(&self) -> &T {
        &self.0
    }
}

/// Array accessor: `field.items() -> &[T]`.
#[derive(Debug, Default)]
pub struct GenList<T>(Vec<T>);

impl<T> GenList<T> {
    #[inline]
    pub fn items(&self) -> &[T] {
        &self.0
    }
}

/// Bindgen option-structs for `BunObject.bind.ts`.
pub mod bun_object {
    /// `gen.BunObject.BracesOptions` — `#[repr(C)]` extern struct passed by
    /// pointer from the C++ dispatch shim. Field order is
    /// `parse`, `tokenize`.
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct BracesOptions {
        pub parse: bool,
        pub tokenize: bool,
    }
}

// Shorthand for the bindgen string payload. The real generator hands back a
// `bun.String` / `WTFStringImpl`; downstream code only calls `.length()` /
// `.to_utf8()` / `.to_owned_slice_z()` on it, all of which `bun_core::String`
// already provides.
pub type GenString = bun_core::String;

/// `bun.bun_js.jsc.JSCArrayBuffer.Ref` — adopted `*mut JSC::ArrayBuffer`
/// (refcount already +1 from C++). Stays a raw `Copy` pointer because it is
/// also embedded in the `#[repr(C)]` extern unions below, which require POD
/// arms; the +1 ref is released exactly once via
/// `release_gen_val_array_buffer` in the owning containers' `Drop` impls.
pub type GenArrayBuffer = *mut JSCArrayBuffer;

/// The codegen `m_ctx` `*mut webcore::Blob`, erased: `Blob` lives in `bun_runtime`.
pub type GenBlob = *mut core::ffi::c_void;

// The extern layouts and the adopt helpers that `bindgen_generated.rs` names.

type RawWTFStringImpl = *mut bun_core::WTFStringImplStruct;

/// `BindgenOptional(BindgenTrivial<T>).ExternType` — `T` has no custom
/// `OptionalExternType`, so the C++ side wraps it in a 2-arm tagged union
/// `{ data: union { _0: u8 /* unused */, _1: T }, tag: u8 }`.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternOptional<T: Copy> {
    data: ExternOptionalData<T>,
    tag: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union ExternOptionalData<T: Copy> {
    _0: u8,
    _1: T,
}

impl<T: Copy> ExternOptional<T> {
    #[inline]
    fn get(self) -> Option<T> {
        if self.tag == 0 {
            return None;
        }
        debug_assert_eq!(self.tag, 1);
        // SAFETY: tag == 1 ⇒ C++ initialized the `_1` arm.
        Some(unsafe { self.data._1 })
    }
}

/// `bindgen.ExternArrayList(T)` — `extern struct { data: ?[*]T, length: c_uint,
/// capacity: c_uint }`.
// Clone/Copy: bitwise OK — FFI mirror of a C++ buffer; Rust treats it as a
// borrowed view and adopts ownership exactly once at the call site.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternArrayList<T> {
    data: *mut T, // null = empty
    length: c_uint,
    capacity: c_uint,
}

#[inline]
fn adopt_string(ptr: RawWTFStringImpl) -> GenString {
    // C++ hands back a +1 ref; `adopt_wtf_impl` takes ownership (no inc).
    bun_core::String::adopt_wtf_impl(ptr)
}

#[inline]
fn adopt_opt_string(ptr: RawWTFStringImpl) -> GenOpt<GenString> {
    // `BindgenOptional(BindgenString).ExternType` is `?WTFStringImpl` — single-word
    // nullable ptr (custom `OptionalExternType`), NOT an `ExternTaggedUnion`.
    GenOpt(if ptr.is_null() {
        None
    } else {
        Some(adopt_string(ptr))
    })
}

// ── refcount release on drop ──────────────────────────────────────────────
//
// `adopt_string` adopts a +1 `WTF::StringImpl` ref into a `GenString`
// (= `bun_core::String`), which releases it on drop.
//
// `GenArrayBuffer` / `GenBlob` raw-pointer payloads carry an adopted +1 ref
// (C++ `ExternTraits<RefPtr<T>>::convertToExtern` calls `leakRef()`);
// released here via the matching `ExternalSharedDescriptor::ext_deref`.

#[inline]
fn release_gen_val_array_buffer(b: &GenVal<GenArrayBuffer>) {
    if !b.0.is_null() {
        // SAFETY: `b.0` is the `RefPtr<JSC::ArrayBuffer>::leakRef()` result from
        // C++ `ExternTraits` — a live `JSC::ArrayBuffer*` carrying +1.
        unsafe { <JSCArrayBuffer as bun_ptr::ExternalSharedDescriptor>::ext_deref(b.0) };
    }
}

#[inline]
fn release_gen_val_blob(b: &GenVal<GenBlob>) {
    if !b.0.is_null() {
        // SAFETY: `b.0` is the `RefPtr<BlobImpl>::leakRef()` result from C++
        // `ExternTraits` — a live heap-allocated `Blob*` carrying +1.
        unsafe {
            <crate::webcore_types::Blob as bun_ptr::ExternalSharedDescriptor>::ext_deref(
                b.0.cast::<crate::webcore_types::Blob>(),
            )
        };
    }
}

fn adopt_array<E: Copy, T>(list: ExternArrayList<E>, convert: impl Fn(E) -> T) -> GenList<T> {
    if list.data.is_null() {
        return GenList(Vec::new());
    }
    let len = list.length as usize;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        // SAFETY: C++ wrote `length` elements at `data`.
        out.push(convert(unsafe { *list.data.add(i) }));
    }
    // SAFETY: C++ gave up the buffer, which `MimallocMalloc` in ExternVectorTraits.h allocated with `mi_malloc`.
    unsafe { bun_alloc::basic::free_without_size(list.data.cast()) };
    GenList(out)
}

include!(concat!(env!("BUN_CODEGEN_DIR"), "/bindgen_generated.rs"));

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
// Thin host-fn forwarders for `cache: true` properties.
//
// `js_class_module!` / `generate-classes.ts` already emit
// `${prop}_get_cached`/`${prop}_set_cached` (and a `Gc` enum) per cached prop.
// Several JS classes (MySQLConnection, PostgresSQLConnection, RedisClient)
// then hand-write the *other* half — the `get_*`/`set_*` host-fns that the
// `.classes.ts` getter/setter thunks dispatch to — as pure forwarding shims.
// This macro stamps those out so the per-class `impl` block is one line per
// prop instead of ~10.
//
// `($get, $set => $prop)` maps the codegen-expected host-fn idents (snake-
// cased from the `.classes.ts` getter/setter names, e.g. `get_on_connect`)
// to the cached-accessor prop ident (`onconnect`). The two namings are NOT
// derivable from each other (`on_connect` vs `onconnect`), hence the explicit
// mapping. `lazy_array($get => $prop)` covers the `queries`-style getter that
// lazily seeds the slot with an empty `JSArray` on first read.
//
// The emitted setter returns `()` — `host_fn_setter_this_shared` accepts
// that via `IntoHostSetterReturn for ()` (≡ `true` at the ABI).
// ──────────────────────────────────────────────────────────────────────────

/// Stamp out trivial cached-prop getter/setter host-fns inside an `impl` block.
///
/// ```ignore
/// bun_jsc::cached_prop_hostfns! {
///     crate::jsc::codegen::JSPostgresSQLConnection;
///     lazy_array(get_queries => queries),
///     (get_on_connect, set_on_connect => onconnect),
///     (get_on_close,   set_on_close   => onclose),
/// }
/// ```
#[macro_export]
macro_rules! cached_prop_hostfns {
    ($gen:path; $($rest:tt)*) => {
        $crate::cached_prop_hostfns!(@loop $gen; $($rest)*);
    };
    (@loop $gen:path;) => {};
    // lazy-array getter (seeds an empty `JSArray` on first read).
    // `$gc/$sc` are the codegen'd `${prop}_get_cached`/`${prop}_set_cached`
    // free fns in `$gen` — passed explicitly because `macro_rules!` can't
    // camelCase→snake_case the prop ident.
    (@loop $gen:path; lazy_array($get:ident => $gc:ident, $sc:ident) $(, $($rest:tt)*)?) => {
        pub fn $get(
            _this: &Self,
            this_value: $crate::JSValue,
            global: &$crate::JSGlobalObject,
        ) -> $crate::JsResult<$crate::JSValue> {
            use $gen as __g;
            if let ::core::option::Option::Some(v) = __g::$gc(this_value) {
                return ::core::result::Result::Ok(v);
            }
            let array = $crate::JSValue::create_empty_array(global, 0)?;
            __g::$sc(this_value, global, array);
            ::core::result::Result::Ok(array)
        }
        $crate::cached_prop_hostfns!(@loop $gen; $($($rest)*)?);
    };
    // plain getter+setter pair
    (@loop $gen:path; ($get:ident, $set:ident => $gc:ident, $sc:ident) $(, $($rest:tt)*)?) => {
        pub fn $get(
            _this: &Self,
            this_value: $crate::JSValue,
            _global: &$crate::JSGlobalObject,
        ) -> $crate::JSValue {
            use $gen as __g;
            __g::$gc(this_value).unwrap_or($crate::JSValue::UNDEFINED)
        }
        pub fn $set(
            _this: &Self,
            this_value: $crate::JSValue,
            global: &$crate::JSGlobalObject,
            value: $crate::JSValue,
        ) {
            use $gen as __g;
            __g::$sc(this_value, global, value);
        }
        $crate::cached_prop_hostfns!(@loop $gen; $($($rest)*)?);
    };
}

/// Stamp out the `do_ref`/`do_unref` host-fn pair that forwards to a
/// `JsCell<KeepAlive>`-shaped field. Expands inside an `impl` block.
///
/// ```ignore
/// bun_jsc::poll_ref_hostfns!(field = poll_ref, ctx = vm_ctx);
/// bun_jsc::poll_ref_hostfns!(field = poll_ref, ctx = vm_ctx,
///     after = |this: &Self| this.update_has_pending_activity());
/// ```
#[macro_export]
macro_rules! poll_ref_hostfns {
    (field = $field:ident, ctx = $ctx:ident $(, after = $after:expr)? $(,)?) => {
        pub fn do_ref(
            this: &Self,
            _: &$crate::JSGlobalObject,
            _: &$crate::CallFrame,
        ) -> $crate::JsResult<$crate::JSValue> {
            let ctx = this.$ctx();
            this.$field.with_mut(|p| p.ref_(ctx));
            $( ($after)(this); )?
            ::core::result::Result::Ok($crate::JSValue::UNDEFINED)
        }
        pub fn do_unref(
            this: &Self,
            _: &$crate::JSGlobalObject,
            _: &$crate::CallFrame,
        ) -> $crate::JsResult<$crate::JSValue> {
            let ctx = this.$ctx();
            this.$field.with_mut(|p| p.unref(ctx));
            $( ($after)(this); )?
            ::core::result::Result::Ok($crate::JSValue::UNDEFINED)
        }
    };
}

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
/// by-value (e.g. `HTMLBundle`).
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

js_class_module!(JSTimeout   = "Timeout"   { callback, arguments, idleTimeout, repeat, idleStart });
js_class_module!(JSImmediate = "Immediate" { callback, arguments });
// Payload `Blob` lives in this crate (`webcore_types`) — pass it so the extern
// signatures unify with the typed declarations there.
js_class_module!(JSBlob      = "Blob"      as crate::webcore_types::Blob { name, stream });
js_class_module!(JSResponse  = "Response"  { body, headers, url, statusText, stream });
js_class_module!(JSRequest   = "Request"   { body, headers, url, signal, stream });
// `values: ["resolve", "reject"]` in src/runtime/api/Shell.classes.ts.
js_class_module!(JSShellInterpreter      = "ShellInterpreter"      { resolve, reject });
// `src/runtime/crypto/crypto.classes.ts` — one entry per `StaticCryptoHasher`
// monomorphization. Payload erased;
// the native struct lives in `bun_runtime::crypto`.
js_class_module!(JSMD4        = "MD4"        {});
js_class_module!(JSMD5        = "MD5"        {});
js_class_module!(JSSHA1       = "SHA1"       {});
js_class_module!(JSSHA224     = "SHA224"     {});
js_class_module!(JSSHA256     = "SHA256"     {});
js_class_module!(JSSHA384     = "SHA384"     {});
js_class_module!(JSSHA512     = "SHA512"     {});
js_class_module!(JSSHA512_256 = "SHA512_256" {});
