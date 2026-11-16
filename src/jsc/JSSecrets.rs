use crate::{JSGlobalObject, JSValue, JsResult, Strong};

// Opaque pointer to C++ SecretsJobOptions struct
bun_opaque::sealed_handle! { pub struct SecretsJobOptions; }

// safe fn: `&` is ABI-identical to a non-null pointer, and what C++ mutates is behind the cell. `deinit` frees the job.
unsafe extern "C" {
    safe fn Bun__SecretsJobOptions__runTask(ctx: &SecretsJobOptions);
    safe fn Bun__SecretsJobOptions__runFromJS(
        ctx: &SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    fn Bun__SecretsJobOptions__deinit(ctx: *mut SecretsJobOptions);
}

// SAFETY: only C++ makes one, as the argument of `Bun__Secrets__scheduleJob`.
bun_opaque::owned_handle! {
    /// The C++ `SecretsJobOptions` a job owns; plain data, freed wherever the job ends.
    struct SecretsOptions(SecretsJobOptions) => unsafe Bun__SecretsJobOptions__deinit;
}
// SAFETY: an owned C++ heap object with no thread affinity.
unsafe impl Send for SecretsOptions {}

/// `Bun.secrets.{get,set,delete}` off the JS thread.
pub(crate) struct SecretsJob {
    options: SecretsOptions,
}

impl crate::JobContext for SecretsJob {
    type OffThread = Self;
    type Js = Strong;

    fn run(this: &mut Self, _: &crate::Ticket) {
        Bun__SecretsJobOptions__runTask(&this.options);
    }

    fn then(this: Self, promise: Strong, cx: &crate::JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        // `Bun__SecretsJobOptions__runFromJS` opens a `DECLARE_THROW_SCOPE` and
        // returns via `RELEASE_AND_RETURN`, which simulates a throw to the parent
        // scope under `BUN_JSC_validateExceptionChecks=1`. Without an enclosing
        // scope here, `drainMicrotasks`'s `TopExceptionScope` ctor asserts on the
        // unchecked simulated throw — same shape as `JSCDeferredWorkTask::run`.
        crate::validation_scope!(scope, global);
        Bun__SecretsJobOptions__runFromJS(&this.options, global, promise.get());
        scope.assert_no_exception_except_termination()
    }
}

// Helper function for C++ to call with opaque pointer
#[unsafe(no_mangle)]
extern "C" fn Bun__Secrets__scheduleJob(
    global: &JSGlobalObject,
    options: SecretsOptions,
    promise: JSValue,
) {
    let cx = global.js_thread_of_caller();
    crate::Job::<SecretsJob>::schedule(
        &cx,
        SecretsJob { options },
        Strong::create(promise, global),
    );
}
