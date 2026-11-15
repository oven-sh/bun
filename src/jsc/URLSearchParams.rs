use core::ffi::c_void;

use crate::{JSValue, Wrapped};
use bun_core::EncodedSlice;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::URLSearchParams (lives on the C++ side).
    pub struct URLSearchParams;
}

unsafe extern "C" {
    safe fn URLSearchParams__fromJS(value: JSValue) -> *mut URLSearchParams;
    fn URLSearchParams__toString(
        self_: &URLSearchParams,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(ctx: *mut c_void, str: &EncodedSlice),
    );
}

impl URLSearchParams {
    pub fn from_js(value: JSValue) -> Option<Wrapped<URLSearchParams>> {
        // SAFETY: a `JSURLSearchParams` holds a ref on what it wraps.
        unsafe { Wrapped::new(value, URLSearchParams__fromJS(value)) }
    }

    pub fn to_string<Ctx>(&self, ctx: &mut Ctx, callback: fn(ctx: &mut Ctx, str: EncodedSlice)) {
        // A fn pointer cannot be a const generic, so pack (ctx, callback) on the
        // stack and pass the pair through the C trampoline's void* context.
        struct Wrap<'a, Ctx> {
            ctx: &'a mut Ctx,
            callback: fn(&mut Ctx, EncodedSlice),
        }

        unsafe extern "C" fn cb<Ctx>(c: *mut c_void, str: &EncodedSlice) {
            // SAFETY: `c` is the &mut Wrap<Ctx> we passed below; the callback is
            // invoked synchronously so `w` is live for the entire call.
            let w = unsafe { bun_ptr::callback_ctx::<Wrap<'_, Ctx>>(c) };
            (w.callback)(w.ctx, *str);
        }

        let mut w = Wrap { ctx, callback };
        // SAFETY: `w` lives for the duration of the call (URLSearchParams__toString invokes
        // the callback synchronously, does not retain it).
        unsafe { URLSearchParams__toString(self, (&raw mut w).cast::<c_void>(), cb::<Ctx>) };
    }
}
