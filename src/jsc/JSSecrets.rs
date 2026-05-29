use crate::{AnyTaskJob, AnyTaskJobCtx, JSGlobalObject, JSValue, JsResult, Strong};

// Opaque pointer to C++ SecretsJobOptions struct
bun_opaque::opaque_ffi! { pub struct SecretsJobOptions; }

unsafe extern "C" {
    safe fn Bun__SecretsJobOptions__runTask(ctx: &mut SecretsJobOptions, global: &JSGlobalObject);
    safe fn Bun__SecretsJobOptions__runFromJS(
        ctx: &mut SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    fn Bun__SecretsJobOptions__deinit(ctx: *mut SecretsJobOptions);
}

pub(crate) struct SecretsCtx {
    ctx: *mut SecretsJobOptions,
    promise: Strong,
}

impl AnyTaskJobCtx for SecretsCtx {
    fn run(&mut self, global: *mut JSGlobalObject) {
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

pub(crate) type SecretsJob = AnyTaskJob<SecretsCtx>;

// Helper function for C++ to call with opaque pointer
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Secrets__scheduleJob(
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
