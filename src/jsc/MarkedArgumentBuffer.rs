use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's `MarkedArgumentBuffer` (a GC-rooted argument list).
    /// Nomicon extern-type pattern: zero-sized, `!Send + !Sync + !Unpin`.
    pub struct MarkedArgumentBuffer;
}

unsafe extern "C" {
    safe fn MarkedArgumentBuffer__append(args: &MarkedArgumentBuffer, value: JSValue);
    safe fn MarkedArgumentBuffer__size(args: &MarkedArgumentBuffer) -> usize;
    safe fn MarkedArgumentBuffer__constructArray(
        args: &MarkedArgumentBuffer,
        global: &JSGlobalObject,
    ) -> JSValue;
    // safe: `ctx` is an opaque round-trip pointer C++ only forwards to `f`
    // (never dereferenced as Rust data) — same contract as
    // `JSC__VM__holdAPILock` / `JSC__JSGlobalObject__queueMicrotaskCallback`.
    safe fn MarkedArgumentBuffer__run(
        ctx: *mut c_void,
        f: extern "C" fn(ctx: *mut c_void, args: *mut c_void),
    );
}

impl MarkedArgumentBuffer {
    /// Stack-construct a `MarkedArgumentBuffer` and pass it to `f`. There is no
    /// heap-allocated owning form (the C++ type is non-movable); `new` is a
    /// scoped-borrow constructor.
    pub fn new<R>(f: impl FnOnce(&mut MarkedArgumentBuffer) -> R) -> R {
        struct Ctx<F, R> {
            f: Option<F>,
            r: Option<R>,
        }
        extern "C" fn run<F, R>(ctx: *mut Ctx<F, R>, args: *mut MarkedArgumentBuffer)
        where
            F: FnOnce(&mut MarkedArgumentBuffer) -> R,
        {
            // SAFETY: `ctx` is the `&mut ctx` passed to `run` below; nothing
            // `f` runs can reach it.
            let f = unsafe { (*ctx).f.take() }.unwrap();
            // SAFETY: `args` is the live stack-allocated `MarkedArgumentBuffer` C++
            // hands us for the duration of this callback.
            let r = f(unsafe { &mut *args });
            // SAFETY: as above.
            unsafe { (*ctx).r = Some(r) };
        }
        let mut ctx = Ctx {
            f: Some(f),
            r: None,
        };
        Self::run(&mut ctx, run::<_, R>);
        ctx.r.unwrap()
    }

    pub fn append(&mut self, value: JSValue) {
        MarkedArgumentBuffer__append(self, value)
    }

    pub fn size(&self) -> usize {
        MarkedArgumentBuffer__size(self)
    }

    /// A `JSArray` of the values.
    #[track_caller]
    pub fn construct_array(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        crate::call_zero_is_throw(global, || {
            MarkedArgumentBuffer__constructArray(self, global)
        })
    }

    fn run<T>(ctx: &mut T, func: extern "C" fn(ctx: *mut T, args: *mut MarkedArgumentBuffer)) {
        // `MarkedArgumentBuffer__run` round-trips `ctx` opaquely back to `func`,
        // and `func`'s ABI is identical modulo the
        // pointee types (both params are thin pointers).
        MarkedArgumentBuffer__run(
            std::ptr::from_mut::<T>(ctx).cast::<c_void>(),
            // SAFETY: both fn-pointer signatures are `extern "C"` with two
            // thin-pointer params; ABI-identical modulo pointee type.
            unsafe {
                bun_ptr::cast_fn_ptr::<
                    extern "C" fn(*mut T, *mut MarkedArgumentBuffer),
                    extern "C" fn(*mut c_void, *mut c_void),
                >(func)
            },
        )
    }
}
