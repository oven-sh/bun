//! JS testing/debugging bindings for the crash handler. Keeps
//! `src/crash_handler/` free of JSC types.

use bun_analytics as analytics;
use bun_collections::BoundedArray;
use bun_core::String as BunString;
use bun_core::{Environment, Global};
use bun_crash_handler as crash_handler;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, StringJsc};

pub mod js_bindings {
    use super::*;

    pub fn generate(global: &JSGlobalObject) -> JSValue {
        // `#[bun_jsc::host_fn]` emits an `extern "C"` shim named `__jsc_host_<fn>`; that
        // shim is the `JSHostFn` value passed to `JSFunction::create`.
        const ENTRIES: &[(&str, bun_jsc::JSHostFn)] = &[
            (
                "getMachOImageZeroOffset",
                __jsc_host_js_get_mach_o_image_zero_offset,
            ),
            ("getFeaturesAsVLQ", __jsc_host_js_get_features_as_vlq),
            ("getFeatureData", __jsc_host_js_get_feature_data),
            ("getCurrentAction", __jsc_host_js_get_current_action),
            ("segfault", __jsc_host_js_segfault),
            ("segfaultInDll", __jsc_host_js_segfault_in_dll),
            ("panic", __jsc_host_js_panic),
            ("rootError", __jsc_host_js_root_error),
            ("outOfMemory", __jsc_host_js_out_of_memory),
            ("abort", __jsc_host_js_abort),
            ("trap", __jsc_host_js_trap),
            (
                "raiseIgnoringPanicHandler",
                __jsc_host_js_raise_ignoring_panic_handler,
            ),
        ];
        let obj = JSValue::create_empty_object(global, ENTRIES.len());
        for &(name, func) in ENTRIES {
            obj.put(
                global,
                name,
                JSFunction::create(global, name, func, 1, Default::default()),
            );
        }
        obj
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_get_mach_o_image_zero_offset(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(not(target_os = "macos"))]
        {
            return Ok(JSValue::UNDEFINED);
        }
        #[cfg(target_os = "macos")]
        {
            unsafe extern "C" {
                safe fn _dyld_get_image_header(image_index: u32) -> *const core::ffi::c_void;
                safe fn _dyld_get_image_vmaddr_slide(image_index: u32) -> isize;
            }
            let header = _dyld_get_image_header(0);
            if header.is_null() {
                return Ok(JSValue::UNDEFINED);
            }
            let base_address = header as usize;
            let vmaddr_slide = _dyld_get_image_vmaddr_slide(0) as usize;

            Ok(JSValue::js_number((base_address - vmaddr_slide) as f64))
        }
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_get_current_action(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        use crash_handler::Action;
        let name: &'static [u8] = match crash_handler::current_action() {
            None => return Ok(JSValue::UNDEFINED),
            Some(Action::Parse(_)) => b"parse",
            Some(Action::Visit(_)) => b"visit",
            Some(Action::Print(_)) => b"print",
            Some(Action::BundleGenerateChunk(_)) => b"bundleGenerateChunk",
            Some(Action::Resolver(_)) => b"resolver",
            Some(Action::Dlopen(_)) => b"dlopen",
        };
        BunString::static_(name).to_js(global)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_segfault(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        // Under ASAN the SIGSEGV handler is intentionally not installed
        // (`reset_on_posix()` early-returns so ASAN's own DEADLYSIGNAL diagnostic
        // stays in charge of real faults). A bare deref here would route to ASAN's
        // handler — no trace string, no upload — and the `segfault should report`
        // test times out waiting for a POST that never comes. Invoke the handler
        // directly with the address it *would* have received from `siginfo_t`; the
        // code path under test (`crash_handler(SegmentationFault, …)` → trace
        // string → `report()`) is exactly what `handle_segfault_posix` calls.
        if Environment::ENABLE_ASAN {
            crash_handler::crash_handler(
                crash_handler::CrashReason::SegmentationFault(0xDEADBEEF),
                crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
            );
        }
        // SAFETY: intentionally dereferencing an invalid address to trigger SIGSEGV for testing.
        unsafe {
            let ptr = 0xDEADBEEFusize as *mut u64;
            core::ptr::write_unaligned(ptr, 0xDEADBEEF);
            core::hint::black_box(ptr);
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Triggers a segfault with the fault PC inside a system DLL rather than
    /// inside bun.exe. Exercises the Windows fault-context unwinder: the walk
    /// must recover the bun frames that called into the DLL.
    #[bun_jsc::host_fn]
    pub(crate) fn js_segfault_in_dll(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        #[cfg(windows)]
        {
            // `RtlFillMemory` is exported by ntdll.dll, so the faulting
            // instruction is outside bun.exe's image.
            #[link(name = "ntdll")]
            unsafe extern "system" {
                fn RtlFillMemory(dest: *mut core::ffi::c_void, length: usize, fill: u8);
            }
            // SAFETY: intentionally writing to an invalid address to trigger an
            // access violation inside ntdll.dll for testing.
            unsafe { RtlFillMemory(0xDEADBEEFusize as *mut _, 8, 0) };
        }
        #[cfg(not(windows))]
        {
            // No equivalent on POSIX (the fault-context walk is fp-based and
            // doesn't care which image the fault is in); fall through to the
            // in-bun segfault so the test hook is defined everywhere.
            return js_segfault(_global, _frame);
        }
        #[allow(unreachable_code)]
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_panic(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        crash_handler::panic_impl(b"invoked crashByPanic() handler", None, None);
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_abort(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        // Under ASAN the POSIX signal handlers are not installed; invoke the
        // handler directly so the reporter test still observes the upload.
        if Environment::ENABLE_ASAN || cfg!(windows) {
            crash_handler::crash_handler(
                crash_handler::CrashReason::Abort,
                crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
            );
        }
        #[cfg(unix)]
        // SAFETY: libc::abort has no preconditions; never returns.
        unsafe {
            libc::abort();
        }
        #[allow(unreachable_code)]
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_trap(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        if Environment::ENABLE_ASAN || cfg!(windows) {
            crash_handler::crash_handler(
                crash_handler::CrashReason::Trap(0),
                crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
            );
        }
        // int3 on x86_64 / brk on aarch64: both deliver SIGTRAP, matching the
        // instruction WTF's CRASH()/RELEASE_ASSERT emits.
        #[cfg(all(unix, target_arch = "x86_64"))]
        // SAFETY: single trap instruction; no inputs/outputs.
        unsafe {
            core::arch::asm!("int3", options(nomem, nostack));
        }
        #[cfg(all(unix, target_arch = "aarch64"))]
        // SAFETY: single trap instruction; no inputs/outputs.
        unsafe {
            core::arch::asm!("brk #0", options(nomem, nostack));
        }
        #[cfg(all(unix, not(any(target_arch = "x86_64", target_arch = "aarch64"))))]
        crash_handler::crash_handler(
            crash_handler::CrashReason::Trap(0),
            crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
        );
        #[allow(unreachable_code)]
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_root_error(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        crash_handler::handle_root_error("Unexpected", None);
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_out_of_memory(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        bun_core::out_of_memory();
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_raise_ignoring_panic_handler(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        crash_handler::suppress_core_dumps_if_necessary();
        Global::raise_ignoring_panic_handler(bun_core::SignalCode::SIGSEGV);
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_get_features_as_vlq(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let bits = analytics::packed_features();
        let mut buf = BoundedArray::<u8, 16>::default();
        // PackedFeatures is repr(transparent) u64; `.bits()` exposes the raw value.
        crash_handler::write_u64_as_two_vlqs(buf.writer(), bits.bits() as usize)
            // there is definitely enough space in the bounded array
            .expect("unreachable");
        let mut str = BunString::clone_latin1(buf.slice());
        str.transfer_to_js(global)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_get_feature_data(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 5);
        let list = analytics::PACKED_FEATURES_LIST;
        let array = JSValue::create_array_from_iter(global, list.iter(), |feature| {
            BunString::static_(feature).to_js(global)
        })?;
        obj.put(global, "features", array);
        obj.put(
            global,
            "version",
            BunString::init(Global::package_json_version).to_js(global)?,
        );
        obj.put(
            global,
            "is_canary",
            JSValue::js_boolean(Environment::IS_CANARY),
        );

        // This is the source of truth for the git sha.
        // Not the github ref or the git tag.
        obj.put(
            global,
            "revision",
            BunString::init(Environment::GIT_SHA).to_js(global)?,
        );

        obj.put(
            global,
            "generated_at",
            JSValue::js_number_from_int64(bun_core::time::milli_timestamp().max(0)),
        );
        Ok(obj)
    }
}
