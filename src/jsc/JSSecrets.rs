use crate::{AnyTaskJob, AnyTaskJobCtx, JSGlobalObject, JSValue, JsResult, Strong};

// Opaque pointer to C++ SecretsJobOptions struct
bun_opaque::opaque_ffi! { pub struct SecretsJobOptions; }

// TODO(port): move to <area>_sys
//
// safe fn: `SecretsJobOptions` and `JSGlobalObject` are `opaque_ffi!` ZST
// handles (`!Freeze` via `UnsafeCell`); `&mut`/`&` are ABI-identical to
// non-null `*mut`/`*const` and C++ mutating job state through them is interior
// to the cell. `deinit` consumes/frees the C++ allocation and so stays
// `unsafe fn` (double-free precondition).
unsafe extern "C" {
    safe fn Bun__SecretsJobOptions__runTask(ctx: &mut SecretsJobOptions, global: &JSGlobalObject);
    safe fn Bun__SecretsJobOptions__runFromJS(
        ctx: &mut SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    fn Bun__SecretsJobOptions__deinit(ctx: *mut SecretsJobOptions);
}

struct SecretsCtx {
    ctx: *mut SecretsJobOptions,
    promise: Strong,
}

impl AnyTaskJobCtx for SecretsCtx {
    fn run(&mut self, global: *mut JSGlobalObject) {
        // `ctx` is a valid C++ SecretsJobOptions* held alive until Drop;
        // `global` is the creating VM's global pointer. Both are `opaque_ffi!`
        // ZST handles, so `opaque_mut`/`opaque_ref` are the centralised
        // zero-byte deref proofs (panic on null).
        Bun__SecretsJobOptions__runTask(
            SecretsJobOptions::opaque_mut(self.ctx),
            JSGlobalObject::opaque_ref(global),
        );
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        let promise = self.promise.get();
        if promise.is_empty() {
            return Ok(());
        }
        // `Bun__SecretsJobOptions__runFromJS` opens a `DECLARE_THROW_SCOPE` and
        // returns via `RELEASE_AND_RETURN`, which simulates a throw to the parent
        // scope under `BUN_JSC_validateExceptionChecks=1`. Without an enclosing
        // scope here, `drainMicrotasks`'s `TopExceptionScope` ctor asserts on the
        // unchecked simulated throw — same shape as `JSCDeferredWorkTask::run`.
        crate::validation_scope!(scope, global);
        Bun__SecretsJobOptions__runFromJS(SecretsJobOptions::opaque_mut(self.ctx), global, promise);
        scope.assert_no_exception_except_termination()
    }
}

impl Drop for SecretsCtx {
    fn drop(&mut self) {
        // SAFETY: `ctx` is the C++ SecretsJobOptions* passed to `create`; C++ side owns cleanup.
        unsafe { Bun__SecretsJobOptions__deinit(self.ctx) };
        // `promise: Strong` drops automatically.
    }
}

pub type SecretsJob = AnyTaskJob<SecretsCtx>;

// Helper function for C++ to call with opaque pointer
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Secrets__scheduleJob(
    global: &JSGlobalObject,
    options: *mut SecretsJobOptions,
    promise: JSValue,
) {
    SecretsJob::create_and_schedule(
        global,
        SecretsCtx {
            ctx: options,
            promise: Strong::create(promise, global),
        },
    )
    .expect("SecretsCtx::init is infallible");
}

// Zig `fixDeadCodeElimination` + `comptime { _ = ... }` dropped:
// #[unsafe(no_mangle)] already prevents DCE of Bun__Secrets__scheduleJob in Rust.

// ported from: src/jsc/JSSecrets.zig
