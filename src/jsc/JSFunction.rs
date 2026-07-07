use core::ptr::NonNull;

use bun_core::{String as BunString, ZigString};

use crate::{CallFrame, JSGlobalObject, JSHostFn, JSValue, JsError, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::JSFunction`.
    pub struct JSFunction;
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum ImplementationVisibility {
    #[default]
    Public = 0,
    Private = 1,
    PrivateRecursive = 2,
}

/// In WebKit: Intrinsic.h
//
// Non-exhaustive — any u8 is a valid bit pattern, so a Rust `#[repr(u8)]`
// enum would be UB for unknown values. Use a newtype.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Intrinsic(u8);

impl Intrinsic {
    pub(crate) const NONE: Intrinsic = Intrinsic(0);
}

impl Default for Intrinsic {
    fn default() -> Self {
        Intrinsic::NONE
    }
}

#[derive(Copy, Clone, Default)]
pub struct CreateJSFunctionOptions {
    pub implementation_visibility: ImplementationVisibility,
    pub intrinsic: Intrinsic,
    pub constructor: Option<JSHostFn>,
}

// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; the remaining
// params are by-value scalars / `#[repr(C)]` PODs / fn-ptrs, so all three
// shims are declared `safe fn`. `getSourceCode` writes a `ZigString` view into
// the `&mut` out-param on success and leaves it untouched on failure — `&mut
// ZigString` is ABI-identical to a non-null `*mut ZigString`.
unsafe extern "C" {
    safe fn JSFunction__createFromZig(
        global: &JSGlobalObject,
        fn_name: BunString,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;

    pub(crate) safe fn JSC__JSFunction__optimizeSoon(value: JSValue);

    safe fn JSC__JSFunction__getSourceCode(value: JSValue, out: &mut ZigString) -> bool;
}

impl JSFunction {
    pub fn create(
        global: &JSGlobalObject,
        fn_name: impl Into<BunString>,
        implementation: JSHostFn,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) -> JSValue {
        JSFunction__createFromZig(
            global,
            fn_name.into(),
            implementation,
            function_length,
            options.implementation_visibility,
            options.intrinsic,
            options.constructor,
        )
    }

    /// Like [`JSFunction::create`] but accepts a safe Rust fn item
    /// (`fn(&JSGlobalObject, &CallFrame) -> JSValue` or `-> JsResult<JSValue>`)
    /// via [`IntoJsHostFn`].
    pub fn create_from_host_fn<M, F: IntoJsHostFn<M>>(
        global: &JSGlobalObject,
        name: &str,
        implementation: F,
        arg_count: u32,
        options: CreateJSFunctionOptions,
    ) -> JSValue {
        Self::create(
            global,
            BunString::init(name),
            implementation.into_js_host_fn(),
            arg_count,
            options,
        )
    }

    pub fn optimize_soon(value: JSValue) {
        JSC__JSFunction__optimizeSoon(value)
    }

    pub fn get_source_code(value: JSValue) -> Option<BunString> {
        let mut str = ZigString::EMPTY;
        // C++ overwrites `str` on success and leaves it untouched on failure.
        if JSC__JSFunction__getSourceCode(value, &mut str) {
            Some(BunString::init(str))
        } else {
            None
        }
    }
}

/// Marker-typed conversion from a safe Rust fn item to a [`JsHostFn`] thunk.
/// Bodies preserve the SQL bindings' exact error handling (OutOfMemory throws;
/// other errors leave the pending exception and return JSValue::ZERO).
///
/// [`JsHostFn`]: crate::host_fn::JsHostFn
pub trait IntoJsHostFn<Marker>: Sized {
    fn into_js_host_fn(self) -> JSHostFn;
}
#[doc(hidden)]
pub struct HostFnResult;
#[doc(hidden)]
pub struct HostFnPlain;

// `jsc_host_abi!` can't express a generic `where` clause, so cfg-split the
// thunk body manually (sysv64 on win-x64, C elsewhere — matches `JSHostFn`).
// The where-clause is bracketed to avoid `tt`-muncher ambiguity against `{`.
// Thunk bodies scope their raw-ptr derefs locally, so the fn itself has no
// caller preconditions; a safe `extern fn` coerces to the `JSHostFn` type.
macro_rules! jsc_host_fn_thunk {
    ($name:ident<$F:ident>($($args:tt)*) -> $ret:ty where [$($bound:tt)+] $body:block) => {
        #[cfg(all(windows, target_arch = "x86_64"))]
        extern "sysv64" fn $name<$F>($($args)*) -> $ret where $($bound)+ $body
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        extern "C" fn $name<$F>($($args)*) -> $ret where $($bound)+ $body
    };
}

impl<F> IntoJsHostFn<HostFnResult> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(
            core::mem::size_of::<F>(),
            0,
            "IntoJsHostFn: expected fn item (ZST)"
        );
        let _ = self;
        jsc_host_fn_thunk! {
            thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
            where [F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static]
            {
                let f: F = bun_core::ffi::conjure_zst::<F>();
                // JSC passes live non-null `*JSGlobalObject` / `*CallFrame`; both
                // strictly outlive the host-fn call, satisfying the `ParentRef`
                // invariant. Safe `From<NonNull>` + `Deref` collapse the per-thunk
                // raw `&*ptr` pair to one audited deref site in `bun_ptr`.
                let global = bun_ptr::ParentRef::from(NonNull::new(g).expect("JSC host fn: global non-null"));
                let frame = bun_ptr::ParentRef::from(NonNull::new(c).expect("JSC host fn: callframe non-null"));
                match f(&global, &frame) {
                    Ok(v) => v,
                    Err(JsError::OutOfMemory) => { let _ = global.throw_out_of_memory(); JSValue::ZERO }
                    Err(_) => JSValue::ZERO,
                }
            }
        }
        thunk::<F>
    }
}
impl<F> IntoJsHostFn<HostFnPlain> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(
            core::mem::size_of::<F>(),
            0,
            "IntoJsHostFn: expected fn item (ZST)"
        );
        let _ = self;
        jsc_host_fn_thunk! {
            thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
            where [F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static]
            {
                let f: F = bun_core::ffi::conjure_zst::<F>();
                // JSC passes live non-null pointers; both outlive the host-fn
                // call (the `ParentRef` invariant). Safe `Deref` recovers `&T`.
                let global = bun_ptr::ParentRef::from(NonNull::new(g).expect("JSC host fn: global non-null"));
                let frame = bun_ptr::ParentRef::from(NonNull::new(c).expect("JSC host fn: callframe non-null"));
                f(&global, &frame)
            }
        }
        thunk::<F>
    }
}
