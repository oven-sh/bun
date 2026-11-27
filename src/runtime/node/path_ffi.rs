//! What path.rs, which forbids `unsafe`, needs from Path.cpp and BunProcess.cpp.

use bun_node_path::Platform;

use crate::jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use crate::jsc::{JSGlobalObject, JSString, JSValue, call_zero_is_throw};

/// The methods that other methods call through the object. `Bun::PathMethod` in Path.h.
#[derive(Clone, Copy)]
#[repr(u8)]
pub(super) enum Method {
    Normalize,
    Resolve,
}

// The enums are passed as `u8`: rustc declares a two-variant enum as `i1`, and LTO does not inline across the mismatch.
unsafe extern "C" {
    safe fn Bun__Path__isOriginal(global: &JSGlobalObject, platform: u8, method: u8) -> bool;
    safe fn Bun__Path__callMethod(
        global: &JSGlobalObject,
        platform: u8,
        method: u8,
        argument: JSValue,
    ) -> JSValue;
    safe fn Bun__Path__throwNotAString(
        global: &JSGlobalObject,
        index: usize,
        value: JSValue,
    ) -> JSValue;
    safe fn Bun__Process__cachedCwdUnlessReplaced(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Process__callCwd(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Process__isEnvOfProcess(global: &JSGlobalObject) -> bool;
    safe fn Bun__Process__getDriveCwdFromEnv(global: &JSGlobalObject, letter: u8) -> JSValue;
}

#[inline(always)]
fn call<'a>(
    cx: &mut JsScope<'a>,
    function: impl FnOnce(&JSGlobalObject) -> JSValue,
) -> bindgen::Result<'a, JsLocal<'a>> {
    let global = cx.global();
    let result = call_zero_is_throw(global, || function(global))?;
    Ok(JsLocal::new(&cx.heap, result))
}

/// Whether `path[platform][method]` is still the data property that the module defined.
#[inline(always)]
pub(super) fn is_original(cx: &mut JsScope<'_>, platform: Platform, method: Method) -> bool {
    Bun__Path__isOriginal(cx.global(), platform as u8, method as u8)
}

/// `path[platform][method](argument)`
#[cold]
pub(super) fn call_method<'a>(
    cx: &mut JsScope<'a>,
    platform: Platform,
    method: Method,
    argument: JsLocal<'a, JSString>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    call(cx, |global| {
        Bun__Path__callMethod(global, platform as u8, method as u8, argument.to_js())
    })
}

/// Describing `paths[index]` can run JavaScript.
#[cold]
pub(super) fn throw_not_a_string<'a>(
    cx: &mut JsScope<'a>,
    paths: &[JsLocal<'a>],
    index: usize,
) -> bindgen::Error<'a> {
    let value = paths[index].to_js();
    match call(cx, |global| {
        Bun__Path__throwNotAString(global, index, value)
    }) {
        Ok(_) => unreachable!(),
        Err(error) => error,
    }
}

/// The result of `process.cwd()` if calling it would have no effect.
#[inline(always)]
pub(super) fn cached_cwd<'a>(heap: &JsHeap<'a>) -> Option<JsLocal<'a, JSString>> {
    // SAFETY: it compares slots of `process` and returns a field. It neither runs JavaScript nor throws.
    let cwd = Bun__Process__cachedCwdUnlessReplaced(unsafe { heap.global() });
    (!cwd.is_empty())
        .then(|| JsLocal::new(heap, cwd))?
        .as_string()
}

/// `process.cwd()`
#[inline(always)]
pub(super) fn call_cwd<'a>(cx: &mut JsScope<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
    call(cx, Bun__Process__callCwd)
}

/// Whether `process.env` is neither replaced nor the copy that a Worker has.
pub(super) fn is_env_of_process(cx: &mut JsScope<'_>) -> bool {
    Bun__Process__isEnvOfProcess(cx.global())
}

/// ``process.env[`=${letter}:`]``
pub(super) fn drive_cwd_from_env<'a>(
    cx: &mut JsScope<'a>,
    letter: u8,
) -> bindgen::Result<'a, JsLocal<'a>> {
    call(cx, |global| {
        Bun__Process__getDriveCwdFromEnv(global, letter)
    })
}
