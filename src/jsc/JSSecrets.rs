use std::sync::OnceLock;

use bun_threading::ThreadPool;
use bun_threading::thread_pool::{Config, DEFAULT_THREAD_STACK_SIZE};

use crate::{JSGlobalObject, JSValue, JsResult, Strong};

/// Threads for the platform credential calls. Such a call can block without
/// bound on something outside the process: a locked keyring whose unlock
/// prompt nobody answers, or a Secret Service that stopped replying. On the
/// shared `WorkPool` (one thread per core) that many stuck calls would queue
/// every file read and hash behind them for good, so the calls get a pool of
/// their own. The keyring daemon serializes them anyway, so a few threads are
/// enough.
const SECRETS_POOL_THREADS: u32 = 4;

// Opaque pointer to C++ SecretsJobOptions struct
bun_opaque::opaque_ffi! { pub struct SecretsJobOptions; }

// safe fn: `SecretsJobOptions` and `JSGlobalObject` are `opaque_ffi!` ZST
// handles (`!Freeze` via `UnsafeCell`); `&mut`/`&` are ABI-identical to
// non-null `*mut`/`*const` and C++ mutating job state through them is interior
// to the cell. `deinit` consumes/frees the C++ allocation and so stays
// `unsafe fn` (double-free precondition).
unsafe extern "C" {
    safe fn Bun__SecretsJobOptions__runTask(ctx: &mut SecretsJobOptions);
    safe fn Bun__SecretsJobOptions__runFromJS(
        ctx: &mut SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    fn Bun__SecretsJobOptions__deinit(ctx: *mut SecretsJobOptions);
}

/// The C++ `SecretsJobOptions` a job owns; plain data, freed wherever the job ends.
struct SecretsOptions(*mut SecretsJobOptions);
// SAFETY: an owned C++ heap object with no thread affinity.
unsafe impl Send for SecretsOptions {}
impl Drop for SecretsOptions {
    fn drop(&mut self) {
        // SAFETY: the pointer C++ handed to `Bun__Secrets__scheduleJob`; freed once, here.
        unsafe { Bun__SecretsJobOptions__deinit(self.0) };
    }
}

/// `Bun.secrets.{get,set,delete}` off the JS thread.
pub(crate) struct SecretsJob {
    options: SecretsOptions,
}

impl crate::JobContext for SecretsJob {
    type OffThread = Self;
    type Js = Strong;

    fn pool() -> &'static ThreadPool {
        static POOL: OnceLock<ThreadPool> = OnceLock::new();
        POOL.get_or_init(|| {
            ThreadPool::init(Config {
                max_threads: SECRETS_POOL_THREADS,
                stack_size: DEFAULT_THREAD_STACK_SIZE,
            })
        })
    }

    fn run(this: &mut Self, done: crate::Completion<Self>) -> Option<crate::Completion<Self>> {
        Bun__SecretsJobOptions__runTask(SecretsJobOptions::opaque_mut(this.options.0));
        Some(done)
    }

    fn then(this: Self, promise: Strong, cx: &crate::JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        // `Bun__SecretsJobOptions__runFromJS` opens a `DECLARE_THROW_SCOPE` and
        // returns via `RELEASE_AND_RETURN`, which simulates a throw to the parent
        // scope under `BUN_JSC_validateExceptionChecks=1`. Without an enclosing
        // scope here, `drainMicrotasks`'s `TopExceptionScope` ctor asserts on the
        // unchecked simulated throw — same shape as `JSCDeferredWorkTask::run`.
        crate::validation_scope!(scope, global);
        Bun__SecretsJobOptions__runFromJS(
            SecretsJobOptions::opaque_mut(this.options.0),
            global,
            promise.get(),
        );
        scope.assert_no_exception_except_termination()
    }
}

// Helper function for C++ to call with opaque pointer
#[unsafe(no_mangle)]
extern "C" fn Bun__Secrets__scheduleJob(
    global: &JSGlobalObject,
    options: *mut SecretsJobOptions,
    promise: JSValue,
) {
    let cx = global.js_thread();
    crate::Job::<SecretsJob>::schedule(
        &cx,
        SecretsJob {
            options: SecretsOptions(options),
        },
        Strong::create(promise, global),
    );
}
