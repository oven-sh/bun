use bun_engine_text::StringRef;

use crate::{Cx, Exception, Gc, GlobalObject, JsObject, JsPromise, JsResult, ModuleHooks, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PromiseRejectionOperation {
    /// Rejected without a handler.
    Reject,
    /// Got its first handler after that.
    Handle,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum ScriptExecutionStatus {
    Running,
    Suspended,
    Stopped,
}

/// What a realm asks of its embedder.
pub struct RealmHooks {
    pub modules: ModuleHooks,
    pub promise_rejection_tracker: fn(&Cx, Gc<JsPromise>, PromiseRejectionOperation),
    pub report_uncaught_exception: fn(&mut Cx, Gc<Exception>),
    pub current_script_execution_owner: fn(&Cx) -> Gc<JsObject>,
    pub script_execution_status: fn(&Cx, Gc<JsObject>) -> ScriptExecutionStatus,
    pub default_language: fn() -> StringRef,
    pub derive_shadow_realm: fn(&mut Cx) -> JsResult<Gc<GlobalObject>>,
    /// The source, the imports if it is to be instantiated too, and the options.
    pub compile_wasm_streaming: Option<fn(&mut Cx, Gc<JsPromise>, Value, Value)>,
    pub instantiate_wasm_streaming:
        Option<fn(&mut Cx, Gc<JsPromise>, Value, Option<Gc<JsObject>>, Value)>,
}
