//! Native bindings for `internal/modules/customization_hooks.ts`
//! (`module.registerHooks()`).

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// `setModuleHooksCounts(resolveCount, loadCount)` — mirrors the JS-side hook
/// counts into the `VirtualMachine` so the native resolver/loader can gate the
/// hook chain on an integer check.
#[bun_jsc::host_fn]
pub(crate) fn set_module_hooks_counts(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let resolve_count = frame.argument(0).to_int32();
    let load_count = frame.argument(1).to_int32();
    let vm = global.bun_vm_ptr();
    // SAFETY: per-thread VM is live (host functions run on the JS thread).
    unsafe {
        (*vm).module_hooks_resolve_count = resolve_count.max(0) as u32;
        (*vm).module_hooks_load_count = load_count.max(0) as u32;
    }
    Ok(JSValue::UNDEFINED)
}

/// `defaultResolveForHooks(specifier, referrer, isESM, isUserRequireResolve)`
/// — the resolve hook chain's default step: Bun's normal resolution with the
/// hook consultation suppressed, so the default step cannot re-enter the
/// hooks.
#[bun_jsc::host_fn]
pub(crate) fn default_resolve_for_hooks(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let specifier = frame.argument(0);
    let referrer = frame.argument(1);
    let is_esm = frame.argument(2).is_truthy();
    let is_user_require_resolve = frame.argument(3).is_truthy();

    let vm = global.bun_vm_ptr();
    // SAFETY: per-thread VM is live; flag is cleared by the guard below on
    // every exit path.
    unsafe { (*vm).module_hooks_skip = true };
    scopeguard::defer! {
        // SAFETY: as above.
        unsafe { (*vm).module_hooks_skip = false };
    }

    let result = crate::api::bun_object::bun_resolve_sync(
        global,
        specifier,
        referrer,
        is_esm,
        is_user_require_resolve,
    );
    if result == JSValue::ZERO {
        return Err(bun_jsc::JsError::Thrown);
    }
    Ok(result)
}
