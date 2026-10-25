//! JSC bridge for `bun.sys.Error`. Keeps `src/sys/` free of JSC types.

use bun_sys::Error;

use crate::{JSGlobalObject, JSPromise, JSValue, JsResult, SystemErrorJsc};

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

pub(crate) mod testing_apis {
    use crate::generated_bindgen::error_jsc::SigactionLayout;

    /// Exposes NTSTATUS -> `bun.sys.E` translation so tests can feed NTSTATUS
    /// values that filter drivers and cloud-sync placeholders return in the
    /// wild (STATUS_CANNOT_DELETE etc.) and verify they map to a sensible
    /// errno rather than `UNKNOWN`. Windows-only; returns `undefined` elsewhere.
    #[cfg(windows)]
    pub(crate) fn translate_nt_status_to_e(status: f64) -> Option<&'static str> {
        let status = bun_sys::windows::NTSTATUS::from_raw(status as u32);
        let result = bun_sys::windows::translate_nt_status_to_errno(status);
        Some(<&'static str>::from(result))
    }
    #[cfg(not(windows))]
    pub(crate) fn translate_nt_status_to_e(_: f64) -> Option<&'static str> {
        None
    }

    /// Exposes libuv -> `bun.sys.E` translation so tests can feed out-of-range
    /// negative values and verify it does not panic. Windows-only.
    #[cfg(windows)]
    pub(crate) fn translate_uv_error_to_e(code: f64) -> Option<&'static str> {
        let result = bun_sys::windows::translate_uv_error_to_e(code as core::ffi::c_int);
        Some(<&'static str>::from(result))
    }
    #[cfg(not(windows))]
    pub(crate) fn translate_uv_error_to_e(_: f64) -> Option<&'static str> {
        None
    }

    /// Exposes the `bun.sys.Sigaction` struct layout via a SIGUSR2 install /
    /// readback / restore round-trip so `test/internal/sigaction-layout.test.ts`
    /// can verify that the libc's sigaction sees the handler+flags we set
    /// (regression test for the bionic LP64 layout fix). The Rust port uses the
    /// `libc` crate's `sigaction`/`sigset_t` directly, which already has the
    /// correct per-target layout (bionic included), so this is a sanity check
    /// rather than a fix-carrier.
    pub(crate) fn sigaction_layout() -> Option<SigactionLayout> {
        #[cfg(not(unix))]
        {
            None
        }
        #[cfg(unix)]
        {
            use crate::generated_bindgen::error_jsc::SigactionHandlerAndFlags;
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
                let mut act = core::mem::MaybeUninit::<Sigaction>::zeroed().assume_init();
                act.sa_sigaction = sentry as *const () as usize;
                act.sa_mask = mask.assume_init();
                act.sa_flags = SA_RESTART;
                let mut prev = core::mem::MaybeUninit::<Sigaction>::zeroed();
                let mut readback = core::mem::MaybeUninit::<Sigaction>::zeroed();
                sigaction(SIGUSR2, &raw const act, prev.as_mut_ptr());
                sigaction(SIGUSR2, core::ptr::null(), readback.as_mut_ptr());
                sigaction(SIGUSR2, prev.as_ptr(), core::ptr::null_mut());
                let readback = readback.assume_init();
                (
                    act.sa_flags & SA_RESTART,
                    readback.sa_sigaction,
                    readback.sa_flags & SA_RESTART,
                )
            };

            Some(SigactionLayout {
                installed: SigactionHandlerAndFlags {
                    handler: sentry as *const () as usize,
                    flags: act_flags,
                },
                readback: SigactionHandlerAndFlags {
                    handler: rb_handler,
                    flags: rb_flags,
                },
                size: core::mem::size_of::<Sigaction>(),
            })
        }
    }
}
