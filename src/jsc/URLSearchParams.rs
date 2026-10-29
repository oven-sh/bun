use core::ffi::c_void;

use crate::JSValue;
use bun_core::EncodedSlice;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to WebCore::URLSearchParams (lives on the C++ side).
    pub struct URLSearchParams;
}

unsafe extern "C" {
    safe fn URLSearchParams__fromJS<'a>(value: JSValue) -> Option<&'a URLSearchParams>;
    // safe: `URLSearchParams` is an `opaque_ffi!` ZST handle (`&` is
    // ABI-identical to a non-null `*mut`); `ctx` is an opaque round-trip pointer
    // C++ only forwards to `callback` with the address of a local (synchronous, never retained).
    safe fn URLSearchParams__toString(
        self_: &URLSearchParams,
        ctx: *mut c_void,
        callback: extern "C" fn(ctx: *mut c_void, str: &EncodedSlice),
    );
}

impl URLSearchParams {
    // The returned opaque handle is owned by the JS GC heap, not by `value`;
    // callers must keep the JS object alive while using it.
    pub fn from_js<'a>(value: JSValue) -> Option<&'a URLSearchParams> {
        URLSearchParams__fromJS(value)
    }

    pub fn to_string<Ctx>(&self, ctx: &mut Ctx, callback: fn(ctx: &mut Ctx, str: EncodedSlice)) {
        // A fn pointer cannot be a const generic, so pack (ctx, callback) on the
        // stack and pass the pair through the C trampoline's void* context.
        struct Wrap<'a, Ctx> {
            ctx: &'a mut Ctx,
            callback: fn(&mut Ctx, EncodedSlice),
        }

        extern "C" fn cb<Ctx>(c: *mut c_void, str: &EncodedSlice) {
            // SAFETY: `c` is the &mut Wrap<Ctx> we passed below; the callback is
            // invoked synchronously so `w` is live for the entire call.
            let w = unsafe { bun_ptr::callback_ctx::<Wrap<'_, Ctx>>(c) };
            (w.callback)(w.ctx, *str);
        }

        let mut w = Wrap { ctx, callback };
        // `w` lives for the duration of the call (URLSearchParams__toString invokes
        // the callback synchronously, does not retain it).
        URLSearchParams__toString(self, (&raw mut w).cast::<c_void>(), cb::<Ctx>);
    }
}
