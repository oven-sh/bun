//! JS testing/debugging bindings for the crash handler. Keeps
//! `src/crash_handler/` free of JSC types.

use bun_analytics as analytics;
use bun_core::String as BunString;
use bun_core::{Environment, Global};
use bun_crash_handler as crash_handler;

use crate::generated_bindgen::crash_handler_jsc::FeatureData;

pub(crate) fn get_mach_o_image_zero_offset() -> Option<f64> {
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            safe fn _dyld_get_image_header(image_index: u32) -> *const core::ffi::c_void;
            safe fn _dyld_get_image_vmaddr_slide(image_index: u32) -> isize;
        }
        let header = _dyld_get_image_header(0);
        if header.is_null() {
            return None;
        }
        let base_address = header as usize;
        let vmaddr_slide = _dyld_get_image_vmaddr_slide(0) as usize;

        Some((base_address - vmaddr_slide) as f64)
    }
}

pub(crate) fn segfault() {
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
}

/// Triggers a segfault with the fault PC inside a system DLL rather than
/// inside bun.exe. Exercises the Windows fault-context unwinder: the walk
/// must recover the bun frames that called into the DLL.
pub(crate) fn segfault_in_dll() {
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
        segfault();
    }
}

pub(crate) fn panic() {
    crash_handler::suppress_core_dumps_if_necessary();
    crash_handler::panic_impl(b"invoked crashByPanic() handler", None);
}

pub(crate) fn abort() {
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
}

/// Dies like foreign native code, with Bun's crash handler provably out
/// of the way on both platforms: `__fastfail` on Windows (uncatchable,
/// exit code 0xC0000409, same as UCRT abort(), Rust aborts, /GS checks)
/// and a raw SIGABRT on POSIX (handlers reset first, like the
/// `raiseIgnoringPanicHandler` binding below). The `abort` binding
/// above is the opposite: it routes into the crash handler on purpose.
pub(crate) fn fastfail() {
    crash_handler::suppress_core_dumps_if_necessary();
    #[cfg(windows)]
    std::process::abort();
    #[cfg(not(windows))]
    Global::raise_ignoring_panic_handler(bun_core::SignalCode::SIGABRT);
}

pub(crate) fn trap() {
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
}

pub(crate) fn root_error() {
    crash_handler::handle_root_error("Unexpected");
}

pub(crate) fn out_of_memory() {
    crash_handler::suppress_core_dumps_if_necessary();
    bun_core::out_of_memory();
}

/// Calls `mi_new` or `mi_new_nothrow`, which back C++ `operator new` where mimalloc overrides it.
/// Only `mi_new_nothrow` may return null.
pub(crate) fn operator_new(nothrow: bool) -> Option<bool> {
    unsafe extern "C" {
        // safe: both accept any size, and the result is never dereferenced.
        safe fn mi_new(size: usize) -> *mut core::ffi::c_void;
        safe fn mi_new_nothrow(size: usize) -> *mut core::ffi::c_void;
    }
    if nothrow {
        let refused = mi_new_nothrow(usize::MAX / 2).is_null();
        return Some(refused);
    }
    crash_handler::suppress_core_dumps_if_necessary();
    let _ = mi_new(usize::MAX / 2);
    None
}

pub(crate) fn raise_ignoring_panic_handler() {
    crash_handler::suppress_core_dumps_if_necessary();
    Global::raise_ignoring_panic_handler(bun_core::SignalCode::SIGSEGV);
}

pub(crate) fn get_feature_data() -> FeatureData {
    FeatureData {
        // Not `static_`: a feature can be named like a common string ("s3").
        features: analytics::PACKED_FEATURES_LIST
            .iter()
            .map(|feature| BunString::clone_latin1(feature.as_ref()))
            .collect(),
        version: BunString::static_(Global::package_json_version),
        is_canary: Environment::IS_CANARY,
        // This is the source of truth for the git sha.
        // Not the github ref or the git tag.
        revision: BunString::static_(Environment::GIT_SHA),
        generated_at: bun_core::time::milli_timestamp().max(0) as u64,
    }
}
