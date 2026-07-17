use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};
use bun_core::ZigString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::URLSearchParams (lives on the C++ side).
    pub struct URLSearchParams;
}

unsafe extern "C" {
    safe fn URLSearchParams__create(global_object: &JSGlobalObject, init: &ZigString) -> JSValue;
    safe fn URLSearchParams__fromJS(value: JSValue) -> Option<NonNull<URLSearchParams>>;
    // safe: `URLSearchParams` is an `opaque_ffi!` ZST handle (`&mut` is
    // ABI-identical to a non-null `*mut`); `ctx` is an opaque round-trip pointer
    // C++ only forwards to `callback` (synchronous, never retained).
    safe fn URLSearchParams__toString(
        self_: &mut URLSearchParams,
        ctx: *mut c_void,
        callback: extern "C" fn(ctx: *mut c_void, str: *const ZigString),
    );
}

impl URLSearchParams {
    pub fn create(global_object: &JSGlobalObject, init: ZigString) -> JSValue {
        URLSearchParams__create(global_object, &init)
    }

    // The returned opaque handle is owned by the JS GC heap, not by `value`;
    // callers must keep the JS object alive while using it.
    pub fn from_js(value: JSValue) -> Option<NonNull<URLSearchParams>> {
        URLSearchParams__fromJS(value)
    }

    pub fn to_string<Ctx>(&mut self, ctx: &mut Ctx, callback: fn(ctx: &mut Ctx, str: ZigString)) {
        // A fn pointer cannot be a const generic, so pack (ctx, callback) on the
        // stack and pass the pair through the C trampoline's void* context.
        struct Wrap<'a, Ctx> {
            ctx: &'a mut Ctx,
            callback: fn(&mut Ctx, ZigString),
        }

        extern "C" fn cb<Ctx>(c: *mut c_void, str: *const ZigString) {
            // SAFETY: `c` is the &mut Wrap<Ctx> we passed below; the callback is
            // invoked synchronously so `w` is live for the entire call.
            let w = unsafe { bun_ptr::callback_ctx::<Wrap<'_, Ctx>>(c) };
            // SAFETY: C++ passes a non-null pointer to a stack ZigString that is
            // valid for the duration of this synchronous callback; ZigString is Copy.
            let str = unsafe { *str };
            (w.callback)(w.ctx, str);
        }

        let mut w = Wrap { ctx, callback };
        // `w` lives for the duration of the call (URLSearchParams__toString invokes
        // the callback synchronously, does not retain it).
        URLSearchParams__toString(self, (&raw mut w).cast::<c_void>(), cb::<Ctx>);
    }
}
