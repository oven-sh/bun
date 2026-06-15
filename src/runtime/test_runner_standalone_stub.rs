//! `cfg(bun_standalone)` replacement for `crate::test_runner`.
//!
//! The real `test_runner` module (Jest runner, `expect()` matchers, snapshot
//! machinery, fake timers) is ~800 KB of code reachable only via the
//! `bun:test` module / `bun test` CLI — neither is available in a
//! `--compile`d standalone executable. Under `cfg(bun_standalone)` the real
//! module is gated out entirely (`lib.rs`); this file provides the minimal
//! stub surface every cross-module reference needs to compile, plus the
//! handful of `#[no_mangle]` symbols C++ references directly that are *not*
//! covered by the codegen `standaloneStub` mechanism (those are emitted as
//! ZST stubs in `generated_classes.rs` — see `jest.classes.ts`).
//!
//! Every stub here is either a `None`/`false`/no-op or throws the same
//! "bun:test is not available in standalone executables" TypeError the real
//! module-loader path already throws.

#![allow(dead_code, unused_variables)]

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

const UNAVAILABLE: &str = "bun:test is not available in standalone executables";

// ─── jest::Jest ──────────────────────────────────────────────────────────────
// `Jest::runner()` is checked from `jsc_hooks` / `js_bun_spawn_bindings` /
// `BunObject` to gate test-only behaviour; under standalone it's always `None`
// so every `if let Some(runner) = Jest::runner()` branch is dead.
pub mod jest {
    use super::*;

    pub struct Jest;
    /// Never constructed — `runner()` returns `None`.
    pub enum TestRunner {}

    impl Jest {
        #[inline(always)]
        pub fn runner() -> Option<&'static mut TestRunner> {
            None
        }

        /// `BunObject_callback_jest` (`Bun.jest()`). Called via
        /// `export_callbacks! { BunObject_callback_jest => Jest::call }` which
        /// expects a plain `(g, f) -> JsResult<JSValue>` callable.
        pub(crate) fn call(global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
            Err(global.throw_type_error(format_args!("{}", super::UNAVAILABLE)))
        }
    }

    /// `Bun__Jest__createTestModuleObject` — referenced by
    /// `ZigGlobalObject.cpp` (lazy `bun:test` module init).
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__Jest__createTestModuleObject(global: &JSGlobalObject) -> JSValue {
        let _ = global.throw_type_error(format_args!("{}", UNAVAILABLE));
        JSValue::ZERO
    }
}

// ─── timers::FakeTimers ──────────────────────────────────────────────────────
// Embedded by-value in `crate::timer::All`; the timer subsystem reads
// `.is_active()` and the `.timers` heap directly. Under standalone the heap
// stays empty and `is_active()` is always `false`, so the fake-timer branch
// in `All::insert` / `All::remove` is dead.
pub mod timers {
    pub mod fake_timers {
        use crate::timer::TimerHeap;

        #[derive(Default)]
        pub struct FakeTimers {
            pub timers: TimerHeap,
        }
        impl FakeTimers {
            #[inline(always)]
            pub fn is_active(&self) -> bool {
                false
            }
        }
    }
    pub use fake_timers::FakeTimers;
}

// ─── Manual `#[no_mangle]` symbols C++ references directly ───────────────────
// These live in `expect.rs` / `bun_test.rs` / `diff_format.rs` in the full
// build and already had per-symbol `cfg(bun_standalone)` stubs; with the
// whole module gated out they move here so the C++ externs still link.

/// `Expect_readFlagsAndProcessPromise` — called from
/// `bindings/bindings.cpp` (asymmetric-matcher deep-equals).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Expect_readFlagsAndProcessPromise(
    _instance_value: JSValue,
    _global: *mut JSGlobalObject,
    _out_flags: *mut u8,
    _value: *mut JSValue,
    _any_constructor_type: *mut u8,
) -> bool {
    false
}

/// `ExpectCustomAsymmetricMatcher__execute` — called from
/// `bindings/bindings.cpp` (asymmetric-matcher deep-equals).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ExpectCustomAsymmetricMatcher__execute(
    _this: *mut core::ffi::c_void,
    _this_value: JSValue,
    _global: *mut JSGlobalObject,
    _received: JSValue,
) -> bool {
    false
}

/// `ExpectMatcherUtils_createSigleton` (sic) — called from
/// `ZigGlobalObject.cpp` (lazy `expect.utils` singleton init).
#[unsafe(no_mangle)]
pub extern "C" fn ExpectMatcherUtils_createSigleton(global: &JSGlobalObject) -> JSValue {
    let _ = global.throw_type_error(format_args!("{}", UNAVAILABLE));
    JSValue::ZERO
}

/// `zig__renderDiff` — called from `BunAnalyzeTranspiledModule.cpp` for
/// `expect().toMatchInlineSnapshot()` diff rendering.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn zig__renderDiff(
    _expected_ptr: *const u8,
    _expected_len: usize,
    _received_ptr: *const u8,
    _received_len: usize,
    _global: &JSGlobalObject,
) {
}

// `Bun__TestScope__Describe2__bunTestThen` / `bunTestCatch` — referenced by
// identity from `ZigGlobalObject::promiseHandlerID` (C++) to map a
// `JSValue::then` reaction back to its handler ID. Under standalone no test
// promise is ever wired to these, so they're unreachable — but the symbols
// must link.
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__TestScope__Describe2__bunTestThen(
        _global: *mut JSGlobalObject,
        _callframe: *mut CallFrame,
    ) -> JSValue {
        JSValue::UNDEFINED
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__TestScope__Describe2__bunTestCatch(
        _global: *mut JSGlobalObject,
        _callframe: *mut CallFrame,
    ) -> JSValue {
        JSValue::UNDEFINED
    }
}
