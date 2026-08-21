//! Auto-install glue between the package manager and the JS thread:
//!
//! * [`Queue`] receives the package manager's wake-ups (posted from install /
//!   HTTP threads through [`Queue::on_wake_handler`]) and drains the
//!   manager's finished tasks on the JS thread.
//! * [`fulfill`] hands a finished concurrent transpile back to the module
//!   loader (`Bun__onFulfillAsyncModule`).

use core::ffi::c_void;
use core::sync::atomic::Ordering;

use bun_core::{OwnedString, String as BunString};
use bun_install::dependency::Dependency;
use bun_install::package_manager::run_tasks;
use bun_install::{DependencyID, LogLevel, PackageID, Resolution};

use crate::event_loop::ConcurrentTaskItem;
use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorCode, ErrorableResolvedSource, JSGlobalObject, JSValue, JsError, JsResult,
    ResolvedSource,
};

bun_core::declare_scope!(AsyncModule, hidden);

#[derive(Default)]
pub struct Queue {}

/// What the resolver's `WakeHandler` carries as its opaque context: the
/// queue (the task payload) and the VM's weak handle (for wake-ups from the
/// process-wide install / HTTP threads, which outlive any one VM). Allocated
/// once per VM at registration and kept for the VM's lifetime.
pub struct WakeContext {
    pub queue: *mut Queue,
    pub handle: crate::VmHandle,
    pub kind: crate::LoopKind,
}

// Taskable: `Queue` is enqueued via `ConcurrentTask::create_from(this)` in
// `on_wake_handler` and dispatched in `bun_runtime::dispatch::run_task` →
// `vm.modules.on_poll()`. The pointer is a
// borrow into `VirtualMachine.modules`, never freed by the dispatcher.
impl bun_event_loop::Taskable for Queue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::PollPendingModulesTask;
    /// A "poll the package manager" ping from an install thread: `this` is
    /// the VM's own queue; nothing is owned.
    unsafe fn release_unrun(_: *mut Self) {}
}

/// `RunTasksCallbacks` impl for the auto-install wake path; `progress_bar`
/// selected via const generic to match the `enable_ansi_colors_stderr` branch.
///
/// The two error hooks are registered but do nothing: while a hook is
/// registered, `run_tasks` hands the failure to it instead of writing it to
/// the install log, and this path has never reported those failures anywhere.
struct QueueRunTasksCallbacks<const PROGRESS: bool>;

impl<const PROGRESS: bool> run_tasks::RunTasksCallbacks for QueueRunTasksCallbacks<PROGRESS> {
    type Ctx = Queue;

    const PROGRESS_BAR: bool = PROGRESS;
    const HAS_ON_PACKAGE_MANIFEST_ERROR: bool = true;
    const HAS_ON_PACKAGE_DOWNLOAD_ERROR: bool = true;
    const HAS_ON_RESOLVE: bool = true;

    fn on_resolve(_: &mut Queue) {
        bun_core::scoped_log!(AsyncModule, "onResolve");
    }

    fn on_package_manifest_error(_: &mut Queue, name: &[u8], _: bun_install::Error, _: &[u8]) {
        bun_core::scoped_log!(
            AsyncModule,
            "onPackageManifestError: {}",
            bstr::BStr::new(name)
        );
    }

    fn on_package_download_error_pkg(
        _: &mut Queue,
        _: PackageID,
        name: &[u8],
        _: &Resolution,
        _: bun_install::Error,
        _: &[u8],
    ) {
        bun_core::scoped_log!(
            AsyncModule,
            "onPackageDownloadError: {}",
            bstr::BStr::new(name)
        );
    }
}

impl Queue {
    /// `WakeHandler::on_dependency_error` — JS thread. No module is ever
    /// waiting on a root dependency, so this only logs.
    ///
    /// # Safety
    /// `_ctx` must point to a live [`Queue`] (the `WakeHandler::context`
    /// registered in `runtime::jsc_hooks`).
    pub unsafe fn on_dependency_error(
        _ctx: *mut c_void,
        dependency: &Dependency,
        _root_dependency_id: DependencyID,
        _err: &'static str,
    ) {
        bun_core::scoped_log!(
            AsyncModule,
            "onDependencyError: {}",
            bstr::BStr::new(
                VirtualMachine::get()
                    .as_mut()
                    .package_manager()
                    .lockfile
                    .str(&dependency.name)
            )
        );
    }

    /// `WakeHandler::on_dependency_error` context accessor — JS thread.
    ///
    /// # Safety
    /// `ctx` is the leaked `WakeContext` registered in `runtime/jsc_hooks.rs`.
    pub unsafe fn queue_from_wake_context(ctx: *mut c_void) -> *mut Queue {
        // SAFETY: fn contract.
        unsafe { (*ctx.cast::<WakeContext>()).queue }
    }

    /// `WakeHandler::handler` — runs on install / HTTP-callback threads
    /// (`PackageManager::wake_raw`). `ctx` is the [`WakeContext`] registered in
    /// `runtime/jsc_hooks.rs`; the VM is reached only through its handle.
    pub fn on_wake_handler(ctx: *mut c_void, _: *mut c_void) {
        bun_core::scoped_log!(AsyncModule, "onWake");
        // SAFETY: `ctx` is the leaked `WakeContext` registered with this handler.
        let ctx = unsafe { &*ctx.cast::<WakeContext>() };
        let task = ConcurrentTaskItem::create_from(ctx.queue);
        if let crate::vm_handle::Posted::Refused(task) = ctx.handle.post(ctx.kind, task) {
            // That VM has closed: nobody is waiting on the package manager any more.
            // SAFETY: refused ⇒ we own the task box.
            unsafe { drop(bun_core::heap::take(task.as_ptr())) };
        }
    }

    pub fn on_poll(&mut self) {
        bun_core::scoped_log!(AsyncModule, "onPoll");
        self.run_tasks();

        // S017: per-thread VM singleton (safe accessor) instead of
        // `container_of`-derived `*mut` reborrow. The package manager is a
        // separate heap allocation, disjoint from `self` (= `vm.modules`).
        let pm = VirtualMachine::get().as_mut().package_manager();
        if pm.pending_tasks.load(Ordering::Relaxed) > 0 {
            return;
        }
        // ensure we always end the progress bar
        pm.end_progress_bar();
    }

    pub(crate) fn run_tasks(&mut self) {
        // The `run_tasks` free fn takes both
        // `&mut PackageManager` and `&mut Queue`; the package manager is a
        // separate heap allocation (`NonNull<dyn AutoInstaller>` on the
        // resolver), so the two borrows are disjoint.
        // S017: per-thread VM singleton (safe accessor) instead of
        // `container_of`-derived `*mut` reborrow.
        let pm = VirtualMachine::get().as_mut().package_manager();

        if bun_core::output::enable_ansi_colors_stderr() {
            pm.start_progress_bar_if_none();
            run_tasks::run_tasks::<QueueRunTasksCallbacks<true>>(pm, self, true, LogLevel::Default)
                .expect("unreachable");
        } else {
            run_tasks::run_tasks::<QueueRunTasksCallbacks<false>>(
                pm,
                self,
                true,
                LogLevel::DefaultNoProgress,
            )
            .expect("unreachable");
        }
    }
}

/// Dispatch the (possibly errored) transpile
/// result back into JSC via `Bun__onFulfillAsyncModule`. This is the entry
/// point `RuntimeTranspilerStore::run_from_js_thread` calls when a
/// concurrent transpile job finishes.
pub(crate) fn fulfill(
    global_this: &JSGlobalObject,
    promise: JSValue,
    resolved_source: &mut ResolvedSource,
    err: Option<crate::CrateError>,
    specifier_: BunString,
    referrer_: BunString,
    log: &mut bun_ast::Log,
) -> JsResult<()> {
    jsc::mark_binding();
    let mut specifier = specifier_;
    let mut referrer = referrer_;
    // BunString is `Copy` (no Drop), so deref the held
    // refcounts explicitly via scopeguard. The `TopExceptionScope` is
    // omitted: `from_js_host_call_generic` already checks the VM for a
    // pending exception after the FFI call (host_fn.rs).
    //
    // The guard captures raw pointers to the locals (not by-value copies)
    // so the deref observes the *post-FFI* value of the variable —
    // `Bun__onFulfillAsyncModule` receives
    // `&mut specifier`/`&mut referrer` and is free to overwrite them.
    // Safety: `specifier`/`referrer` are declared above this guard, so
    // they outlive it (locals drop in reverse order); the `&mut` reborrow
    // passed to FFI below is dead by the time the guard runs.
    let sp: *mut BunString = &raw mut specifier;
    let rp: *mut BunString = &raw mut referrer;
    let _strings_guard = scopeguard::guard((), move |()| {
        // SAFETY: `sp`/`rp` point at `specifier`/`referrer` declared above
        // this guard; locals drop in reverse order so they outlive it, and
        // the `&mut` reborrows passed to FFI are dead by the time this runs.
        unsafe {
            (*sp).deref();
            (*rp).deref();
        }
    });

    let mut errorable: ErrorableResolvedSource;
    if let Some(e) = err {
        // `OwnedString` derefs on Drop at the end
        // of this `if` arm; `None` is the no-op path.
        let _source_code_guard = if resolved_source.source_code_needs_deref {
            resolved_source.source_code_needs_deref = false;
            Some(OwnedString::new(resolved_source.source_code))
        } else {
            None
        };

        if e == crate::CrateError::JSError {
            errorable = ErrorableResolvedSource::err(
                ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                global_this.take_error(JsError::Thrown),
            );
        } else {
            // `process_fetch_log` synthesizes a JS
            // Error/AggregateError from the parser log and writes it into
            // `errorable.result.err.value`. Without this the import promise
            // would reject with `undefined` (ModuleLoader.cpp:473).
            // call the `virtual_machine` impl directly (takes
            // `&JSGlobalObject`) instead of the `module_loader` shim that
            // takes `*mut` — avoids a `&T as *const T as *mut T` cast,
            // which is UB-adjacent under Stacked Borrows even when the
            // callee never writes through it.
            errorable = ErrorableResolvedSource::err(
                ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                JSValue::UNDEFINED,
            );
            crate::virtual_machine::process_fetch_log(
                global_this,
                specifier,
                referrer,
                log,
                &mut errorable,
                e,
            );
        }
    } else {
        errorable = ErrorableResolvedSource::ok(*resolved_source);
    }
    bun_core::scoped_log!(AsyncModule, "fulfill: {}", specifier);

    jsc::from_js_host_call_generic(global_this, || {
        Bun__onFulfillAsyncModule(
            global_this,
            promise,
            &mut errorable,
            &mut specifier,
            &mut referrer,
        )
    })
}

// safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*const`); `ErrorableResolvedSource`/`BunString`
// are `#[repr(C)]` payloads whose `&mut` is exclusive for the call. C++ reads
// from / writes through these in-place; no caller-side raw-pointer precondition.
unsafe extern "C" {
    safe fn Bun__onFulfillAsyncModule(
        global_object: &JSGlobalObject,
        promise_value: JSValue,
        res: &mut ErrorableResolvedSource,
        specifier: &mut BunString,
        referrer: &mut BunString,
    );
}
