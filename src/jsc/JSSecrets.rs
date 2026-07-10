use core::ptr::NonNull;

use crate::{AnyTaskJob, AnyTaskJobCtx, JSGlobalObject, JSValue, JsResult, Strong};

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`SecretsJobOptions`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// C++ `SecretsJobOptions`. `&Self` is ABI-identical to a non-null
        /// `SecretsJobOptions*` and carries no `noalias`/`readonly` — the
        /// threadpool body writes `error`/`resultPassword`/`deleted` through it.
        pub struct SecretsJobOptions;
    }
}

// C++ `SecretsJobOptions::fromJS` does a plain `new`, handing Rust the sole
// ownership unit. `deinit` is the matching `delete`; the dtor memsets the
// service/name/password buffers, so dropping is load-bearing, not just free.
bun_opaque::foreign_owned!(sys::SecretsJobOptions, Bun__SecretsJobOptions__deinit);

/// Owned handle to a C++ `SecretsJobOptions`.
///
/// Holds one heap allocation; `Drop` runs the C++ `delete`, which zeroes the
/// secret buffers. Every method takes `&self`: the ZST is `UnsafeCell`-backed,
/// so C++ mutates the job's result fields through `&` and there is no `&mut`
/// exclusivity to claim — the work pool and the C++ side share the object.
#[repr(transparent)]
pub struct SecretsJobOptions(bun_opaque::ForeignRef<sys::SecretsJobOptions>);

// safe fn: `sys::SecretsJobOptions` and `JSGlobalObject` are `opaque_ffi!` ZST
// handles (`!Freeze` via `UnsafeCell`), so `&T` is ABI-identical to a non-null
// pointer and C++ mutating through it is interior to the cell.
unsafe extern "C" {
    safe fn Bun__SecretsJobOptions__runTask(opts: &sys::SecretsJobOptions, global: &JSGlobalObject);
    safe fn Bun__SecretsJobOptions__runFromJS(
        opts: &sys::SecretsJobOptions,
        global: &JSGlobalObject,
        promise: JSValue,
    );
    // safe: C++ `delete opts`. Freeing is not exclusive access, so the receiver
    // is `&`. Reachable only via `ForeignRef`'s `Drop`, which owns the one unit
    // it gives back — that pairing is the double-free proof.
    safe fn Bun__SecretsJobOptions__deinit(opts: &sys::SecretsJobOptions);
}

/// Ownership plumbing.
impl SecretsJobOptions {
    /// Adopt the allocation returned by C++ `new SecretsJobOptions`.
    ///
    /// # Safety
    /// `ptr` must be live and carry the sole ownership unit — no other handle
    /// may `delete` it.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<sys::SecretsJobOptions>) -> Self {
        // SAFETY: caller transfers the sole unit.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// Adopt a nullable owning pointer; `None` on null.
    ///
    /// # Safety
    /// A non-null `ptr` must satisfy [`Self::adopt`]'s contract.
    #[inline]
    unsafe fn adopt_ptr(ptr: *mut sys::SecretsJobOptions) -> Option<Self> {
        // SAFETY: caller contract.
        NonNull::new(ptr).map(|p| unsafe { Self::adopt(p) })
    }

    /// The C++ pointer, still owned by `self`.
    #[inline]
    pub fn as_ptr(&self) -> *mut sys::SecretsJobOptions {
        self.0.as_ptr()
    }

    /// Hand the allocation to a foreign owner. Pairs with a later [`Self::adopt`].
    #[inline]
    pub fn leak(self) -> NonNull<sys::SecretsJobOptions> {
        self.0.leak()
    }

    #[inline]
    fn raw(&self) -> &sys::SecretsJobOptions {
        &self.0
    }
}

/// Job body. `&self` throughout: C++ writes the result fields through the same
/// pointer, and neither call takes or gives back an ownership unit.
impl SecretsJobOptions {
    /// Runs OFF the JS thread; performs the platform keychain call.
    pub fn run_task(&self, global: &JSGlobalObject) {
        Bun__SecretsJobOptions__runTask(self.raw(), global)
    }

    /// Runs ON the JS thread; settles `promise` from the job's result fields.
    pub fn run_from_js(&self, global: &JSGlobalObject, promise: JSValue) {
        Bun__SecretsJobOptions__runFromJS(self.raw(), global, promise)
    }
}

/// Owns the job options for the life of the task; both fields drop themselves,
/// `options` before `promise`, exactly where the old hand-rolled `Drop` ran.
pub(crate) struct SecretsCtx {
    options: SecretsJobOptions,
    promise: Strong,
}

impl AnyTaskJobCtx for SecretsCtx {
    fn run(&mut self, global: *mut JSGlobalObject) {
        // `global` is the creating VM's global pointer, forwarded to C++ without
        // being dereferenced here; `opaque_ref` is the zero-byte deref proof.
        self.options.run_task(JSGlobalObject::opaque_ref(global));
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
        self.options.run_from_js(global, promise);
        scope.assert_no_exception_except_termination()
    }
}

pub(crate) type SecretsJob = AnyTaskJob<SecretsCtx>;

/// `jsSecretsGet`/`Set`/`Delete` hand over a fresh `new SecretsJobOptions`;
/// Rust adopts it and is solely responsible for the `delete`.
///
/// # Safety
/// `options` must be a live, uniquely-owned `SecretsJobOptions*`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__Secrets__scheduleJob(
    global: &JSGlobalObject,
    options: *mut sys::SecretsJobOptions,
    promise: JSValue,
) {
    // SAFETY: caller contract. Non-null: every call site does
    // `RETURN_IF_EXCEPTION` + `ASSERT(options)` after `fromJS`.
    let options = unsafe { SecretsJobOptions::adopt_ptr(options) }
        .expect("Bun__Secrets__scheduleJob: null SecretsJobOptions");
    // On `Err` the job is freed, running `SecretsCtx`'s drop.
    SecretsJob::create_and_schedule(
        global,
        SecretsCtx {
            options,
            promise: Strong::create(promise, global),
        },
    )
    .expect("SecretsCtx::init is infallible");
}
