//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

use bun_sys::Error;

use crate::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, SystemErrorJsc};

// PORT NOTE: In Rust, `to_js`/`from_js` live as extension-trait methods in the
// `*_jsc` crate (per PORTING.md). The Zig free fns `toJS`/`toJSWithAsyncStack`
// become methods on this trait, impl'd for `bun_sys::Error`.
pub trait ErrorJsc {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;

    /// Like `to_js` but populates the error's stack trace with async frames from the
    /// given promise's await chain. Use when rejecting a promise from native code
    /// at the top of the event loop (threadpool callback) — otherwise the error
    /// will have an empty stack trace.
    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JsResult<JSValue>;
}

impl ErrorJsc for Error {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(self.to_system_error().to_error_instance(global))
    }

    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JsResult<JSValue> {
        Ok(self
            .to_system_error()
            .to_error_instance_with_async_stack(global, promise))
    }
}

// PORT NOTE: Zig `pub const TestingAPIs = struct { ... }` is a fieldless namespace
// struct. Mapped to a module (not `struct + impl`) because `#[bun_jsc::host_fn]`'s
// Free-kind shim emits `#fn_name(__g, __f)` without a `Self::` qualifier — the
// wrapped fn must resolve unqualified at module scope (same constraint as
// `install_jsc::install_binding::js_parse_lockfile`).
pub mod TestingAPIs {
    use super::*;

    /// Exercises Error.name() with from_libuv=true so tests can feed the
    /// negated-UV-code errno values that node_fs.zig stores and verify the
    /// integer overflow at translateUVErrorToE(-code) is fixed. Windows-only.
    #[bun_jsc::host_fn]
    pub fn sys_error_name_from_libuv(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        if arguments.is_empty() || !arguments[0].is_number() {
            return Err(global.throw(format_args!(
                "sysErrorNameFromLibuv: expected 1 number argument"
            )));
        }
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            let err = Error {
                // @intCast → checked narrowing; target is Error.errno's int type.
                errno: arguments[0]
                    .to_int32()
                    .try_into()
                    .expect("infallible: size matches"),
                syscall: bun_sys::Tag::open,
                from_libuv: true,
                ..Default::default()
            };
            return bun_jsc::bun_string_jsc::create_utf8_for_js(global, err.name());
        }
    }

    /// Exposes libuv -> `bun.sys.E` translation so tests can feed out-of-range
    /// negative values and verify it does not panic. Windows-only.
    #[bun_jsc::host_fn]
    pub fn translate_uv_error_to_e(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        if arguments.is_empty() || !arguments[0].is_number() {
            return Err(global.throw(format_args!(
                "translateUVErrorToE: expected 1 number argument"
            )));
        }
        #[cfg(not(windows))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(windows)]
        {
            let code: core::ffi::c_int = arguments[0].to_int32();
            let result = bun_sys::windows::translate_uv_error_to_e(code);
            // @tagName(result) → IntoStaticStr derive on the E enum.
            return bun_jsc::bun_string_jsc::create_utf8_for_js(
                global,
                <&'static str>::from(result).as_bytes(),
            );
        }
    }

    /// Exposes the `bun.sys.Sigaction` struct layout via a SIGUSR2 install /
    /// readback / restore round-trip so `test/internal/sigaction-layout.test.ts`
    /// can verify that the libc's sigaction sees the handler+flags we set
    /// (regression test for the bionic LP64 layout fix). The Rust port uses the
    /// `libc` crate's `sigaction`/`sigset_t` directly, which already has the
    /// correct per-target layout (bionic included), so this is a sanity check
    /// rather than a fix-carrier — the layout bug was Zig-stdlib-specific.
    #[bun_jsc::host_fn]
    pub fn sigaction_layout(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        #[cfg(not(unix))]
        {
            let _ = global;
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(unix)]
        {
            use bun_sys::posix::{Sigaction, sigaction, sigset_t};
            extern "C" fn sentry(_: core::ffi::c_int) {}
            unsafe extern "C" {
                fn sigemptyset(set: *mut sigset_t) -> core::ffi::c_int;
                fn sigaddset(set: *mut sigset_t, signum: core::ffi::c_int) -> core::ffi::c_int;
            }
            // From <signal.h>: SIGUSR2 is 12 on Linux/Android, 31 on macOS/FreeBSD.
            // SA_RESTART is 0x10000000 on Linux/Android, 0x0002 on macOS/FreeBSD.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            const SIGUSR2: core::ffi::c_int = 12;
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            const SIGUSR2: core::ffi::c_int = 31;
            #[cfg(any(target_os = "linux", target_os = "android"))]
            const SA_RESTART: core::ffi::c_int = 0x10000000;
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            const SA_RESTART: core::ffi::c_int = 0x0002;
            // SAFETY: sigemptyset/sigaddset/sigaction are thin libc wrappers;
            // the sigset_t/sigaction storage is fully owned and initialized
            // here, and SIGUSR2's previous disposition is restored before
            // return so no process-level side effect leaks.
            let (act_flags, rb_handler, rb_flags) = unsafe {
                let mut mask = core::mem::MaybeUninit::<sigset_t>::zeroed();
                sigemptyset(mask.as_mut_ptr());
                sigaddset(mask.as_mut_ptr(), SIGUSR2);
                let act = Sigaction {
                    sa_sigaction: sentry as *const () as usize,
                    sa_mask: mask.assume_init(),
                    sa_flags: SA_RESTART,
                    ..core::mem::zeroed()
                };
                let mut prev = core::mem::MaybeUninit::<Sigaction>::zeroed();
                let mut readback = core::mem::MaybeUninit::<Sigaction>::zeroed();
                sigaction(SIGUSR2, &act, prev.as_mut_ptr());
                sigaction(SIGUSR2, core::ptr::null(), readback.as_mut_ptr());
                sigaction(SIGUSR2, prev.as_ptr(), core::ptr::null_mut());
                let readback = readback.assume_init();
                (
                    act.sa_flags & SA_RESTART,
                    readback.sa_sigaction,
                    readback.sa_flags & SA_RESTART,
                )
            };

            let installed = JSValue::create_empty_object(global, 2);
            installed.put(
                global,
                b"handler",
                JSValue::js_number(sentry as *const () as usize as f64),
            );
            installed.put(global, b"flags", JSValue::js_number(act_flags as f64));
            let rb = JSValue::create_empty_object(global, 2);
            rb.put(global, b"handler", JSValue::js_number(rb_handler as f64));
            rb.put(global, b"flags", JSValue::js_number(rb_flags as f64));
            let out = JSValue::create_empty_object(global, 3);
            out.put(global, b"installed", installed);
            out.put(global, b"readback", rb);
            out.put(
                global,
                b"sizeof",
                JSValue::js_number(core::mem::size_of::<Sigaction>() as f64),
            );
            Ok(out)
        }
    }
}

// ported from: src/sys_jsc/error_jsc.zig
