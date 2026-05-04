use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// Opaque FFI handle for JSC's `MarkedArgumentBuffer` (a GC-rooted argument list).
/// Nomicon extern-type pattern: zero-sized, `!Send + !Sync + !Unpin`.
#[repr(C)]
pub struct MarkedArgumentBuffer {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn MarkedArgumentBuffer__append(args: *mut MarkedArgumentBuffer, value: JSValue);
    fn MarkedArgumentBuffer__run(
        ctx: *mut c_void,
        f: extern "C" fn(ctx: *mut c_void, args: *mut c_void),
    );
}

impl MarkedArgumentBuffer {
    pub fn append(&mut self, value: JSValue) {
        // SAFETY: `self` is a valid `*mut MarkedArgumentBuffer` by construction (only ever
        // obtained from C++ via `MarkedArgumentBuffer__run`'s callback).
        unsafe { MarkedArgumentBuffer__append(self, value) }
    }

    pub fn run<T>(
        ctx: &mut T,
        func: extern "C" fn(ctx: *mut T, args: *mut MarkedArgumentBuffer),
    ) {
        // SAFETY: mirrors Zig `@ptrCast` of both ctx and func — `MarkedArgumentBuffer__run`
        // round-trips `ctx` opaquely back to `func`, and `func`'s ABI is identical modulo the
        // pointee types (both params are thin pointers).
        unsafe {
            MarkedArgumentBuffer__run(
                (ctx as *mut T).cast::<c_void>(),
                core::mem::transmute::<
                    extern "C" fn(*mut T, *mut MarkedArgumentBuffer),
                    extern "C" fn(*mut c_void, *mut c_void),
                >(func),
            )
        }
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
                this.result =
                    $function(this.global_this, this.callframe, unsafe {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/MarkedArgumentBuffer.zig (39 lines)
//   confidence: medium
//   todos:      2
//   notes:      `wrap` ported as macro_rules! (Rust can't const-generic over fn ptr); externs need jsc_sys home
// ──────────────────────────────────────────────────────────────────────────
