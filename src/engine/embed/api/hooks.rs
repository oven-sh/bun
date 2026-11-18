//! What a realm asks of the `GlobalObjectMethodTable` of its global object.

use bun_engine_text::StringRef;
use bun_engine_vm::{
    Cx, Exception, Gc, GlobalObject, JsObject, JsPromise, PromiseRejectionOperation, RealmHooks,
    ScriptExecutionStatus, Value,
};

unsafe extern "C" {
    safe fn engine_host_track_promise_rejection(
        cx: &Cx,
        promise: Gc<JsPromise>,
        operation: PromiseRejectionOperation,
    );
    safe fn engine_host_report_uncaught_exception(cx: &mut Cx, exception: Gc<Exception>);
    safe fn engine_host_current_script_execution_owner(cx: &Cx) -> Gc<JsObject>;
    safe fn engine_host_script_execution_status(
        cx: &Cx,
        owner: Gc<JsObject>,
    ) -> ScriptExecutionStatus;
    safe fn engine_host_derive_shadow_realm(cx: &mut Cx) -> Option<Gc<GlobalObject>>;
    safe fn engine_host_compile_wasm_streaming(
        cx: &mut Cx,
        promise: Gc<JsPromise>,
        source: Value,
        options: Value,
    );
    safe fn engine_host_instantiate_wasm_streaming(
        cx: &mut Cx,
        promise: Gc<JsPromise>,
        source: Value,
        imports: Option<Gc<JsObject>>,
        options: Value,
    );
}

pub(super) const REALM_HOOKS_WITH_WASM_STREAMING: RealmHooks = RealmHooks {
    compile_wasm_streaming: Some(|cx, promise, source, options| {
        engine_host_compile_wasm_streaming(cx, promise, source, options);
    }),
    instantiate_wasm_streaming: Some(|cx, promise, source, imports, options| {
        engine_host_instantiate_wasm_streaming(cx, promise, source, imports, options);
    }),
    ..REALM_HOOKS
};

pub(super) const REALM_HOOKS: RealmHooks = RealmHooks {
    modules: super::module_hooks::MODULE_HOOKS,
    promise_rejection_tracker: |cx, promise, operation| {
        engine_host_track_promise_rejection(cx, promise, operation);
    },
    report_uncaught_exception: |cx, exception| engine_host_report_uncaught_exception(cx, exception),
    current_script_execution_owner: |cx| engine_host_current_script_execution_owner(cx),
    script_execution_status: |cx, owner| engine_host_script_execution_status(cx, owner),
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| {
        let global = engine_host_derive_shadow_realm(cx);
        cx.check_exception()?;
        Ok(global.expect("a realm or an exception"))
    },
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};
