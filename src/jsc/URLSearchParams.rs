use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue};
use bun_str::ZigString;

/// Opaque FFI handle to WebCore::URLSearchParams (lives on the C++ side).
#[repr(C)]
pub struct URLSearchParams {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn URLSearchParams__create(global_object: *mut JSGlobalObject, init: *const ZigString) -> JSValue;
    fn URLSearchParams__fromJS(value: JSValue) -> Option<NonNull<URLSearchParams>>;
    fn URLSearchParams__toString(
        self_: *mut URLSearchParams,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(ctx: *mut c_void, str: *const ZigString),
    );
}

impl URLSearchParams {
    pub fn create(global_object: &JSGlobalObject, init: ZigString) -> JSValue {
        // SAFETY: global_object is a valid &JSGlobalObject; init outlives the call.
        unsafe {
            URLSearchParams__create(
                global_object as *const JSGlobalObject as *mut JSGlobalObject,
                &init,
            )
        }
    }

    // TODO(port): lifetime — opaque handle is owned by the JS GC heap, not by `value`.
    pub fn from_js(value: JSValue) -> Option<NonNull<URLSearchParams>> {
        // SAFETY: JSValue is a #[repr(transparent)] i64; FFI returns null when not a URLSearchParams.
        unsafe { URLSearchParams__fromJS(value) }
    }

    pub fn to_string<Ctx>(&mut self, ctx: &mut Ctx, callback: fn(ctx: &mut Ctx, str: ZigString)) {
        // PORT NOTE: reshaped — Zig captured `callback` at comptime so the C trampoline
        // only needed `ctx` through the void*. Rust cannot take a fn pointer as a const
        // generic, so pack (ctx, callback) on the stack and pass that instead.
        struct Wrap<'a, Ctx> {
            ctx: &'a mut Ctx,
            callback: fn(&mut Ctx, ZigString),
        }

        unsafe extern "C" fn cb<Ctx>(c: *mut c_void, str: *const ZigString) {
            // SAFETY: `c` is the &mut Wrap<Ctx> we passed below; `str` is a valid
            // *const ZigString for the duration of this callback (borrowed from C++).
            let w = unsafe { &mut *(c as *mut Wrap<'_, Ctx>) };
            let str = unsafe { *str };
            (w.callback)(w.ctx, str);
        }

        let mut w = Wrap { ctx, callback };
        // SAFETY: self is a valid *mut URLSearchParams; w lives for the duration of the call
        // (URLSearchParams__toString invokes the callback synchronously, does not retain it).
        unsafe {
            URLSearchParams__toString(self, &mut w as *mut Wrap<'_, Ctx> as *mut c_void, cb::<Ctx>);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/URLSearchParams.zig (46 lines)
//   confidence: medium
//   todos:      2
//   notes:      to_string reshaped (comptime callback → stack-packed fn ptr); from_js returns NonNull pending lifetime decision
// ──────────────────────────────────────────────────────────────────────────
