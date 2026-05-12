use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for JSC's `MarkedArgumentBuffer` (a GC-rooted argument list).
    /// Nomicon extern-type pattern: zero-sized, `!Send + !Sync + !Unpin`.
    pub struct MarkedArgumentBuffer;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    safe fn MarkedArgumentBuffer__append(args: &MarkedArgumentBuffer, value: JSValue);
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
    /// scoped-borrow constructor like Zig's `MarkedArgumentBuffer.run`.
    pub fn new<R>(f: impl FnOnce(&mut MarkedArgumentBuffer) -> R) -> R {
        struct Ctx<F, R> {
            f: Option<F>,
            r: Option<R>,
        }
        extern "C" fn run<F, R>(ctx: *mut Ctx<F, R>, args: *mut MarkedArgumentBuffer)
        where
            F: FnOnce(&mut MarkedArgumentBuffer) -> R,
        {
            // SAFETY: `ctx` is the `&mut ctx` passed to `run` below; `args` is the
            // live stack-allocated buffer C++ hands us.
            let ctx = unsafe { &mut *ctx };
            let f = ctx.f.take().unwrap();
            ctx.r = Some(f(unsafe { &mut *args }));
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

    pub fn run<T>(ctx: &mut T, func: extern "C" fn(ctx: *mut T, args: *mut MarkedArgumentBuffer)) {
        // Mirrors Zig `@ptrCast` of both ctx and func — `MarkedArgumentBuffer__run`
        // round-trips `ctx` opaquely back to `func`, and `func`'s ABI is identical modulo the
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

/// Port of `MarkedArgumentBuffer.wrap`.
///
/// Zig's `wrap` is a `comptime` fn that takes a
/// `fn(*JSGlobalObject, *CallFrame, *MarkedArgumentBuffer) bun.JSError!JSValue`
/// and returns a `jsc.JSHostFnZig`. Rust cannot parameterize a `fn` item by a const
/// fn-pointer, so this is a macro that expands to a `#[bun_jsc::host_fn]` wrapper.
// TODO(port): consider a proc-macro attribute (`#[bun_jsc::with_marked_argument_buffer]`)
// instead of `macro_rules!` once the host_fn codegen is settled.
#[macro_export]
macro_rules! marked_argument_buffer_wrap {
    ($function:path) => {{
        #[$crate::host_fn]
        pub fn wrapper(
            global_this: &$crate::JSGlobalObject,
            callframe: &$crate::CallFrame,
        ) -> $crate::JsResult<$crate::JSValue> {
            struct Context<'a> {
                result: $crate::JsResult<$crate::JSValue>,
                global_this: &'a $crate::JSGlobalObject,
                callframe: &'a $crate::CallFrame,
            }
            extern "C" fn run(
                this: *mut Context<'_>,
                marked_argument_buffer: *mut $crate::MarkedArgumentBuffer,
            ) {
                // SAFETY: `this` is the `&mut ctx` passed to `MarkedArgumentBuffer::run` below;
                // `marked_argument_buffer` is the live stack-allocated buffer C++ hands us.
                let this = unsafe { &mut *this };
                this.result = $function(this.global_this, this.callframe, unsafe {
                    &mut *marked_argument_buffer
                });
            }

            let mut ctx = Context {
                global_this,
                callframe,
                // PORT NOTE: Zig used `undefined`; init with a placeholder since `run`
                // unconditionally overwrites it before we read.
                result: ::core::result::Result::Ok($crate::JSValue::ZERO),
            };
            $crate::MarkedArgumentBuffer::run(&mut ctx, run);
            ctx.result
        }
        wrapper
    }};
}

// ported from: src/jsc/MarkedArgumentBuffer.zig
