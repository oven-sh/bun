use core::ffi::c_void;

use bun_core::String as BunString;

use crate::event_loop::ConcurrentTaskItem;
use crate::{
    self as jsc, ErrorableResolvedSource, JSGlobalObject, JSValue, JsError, JsResult,
    ResolvedSource,
};

bun_core::declare_scope!(AsyncModule, hidden);

#[derive(Default)]
pub struct Queue;

/// The `WakeHandler`'s context, kept for the VM's lifetime; the waking threads outlive any one VM.
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
    /// `this` is the VM's own queue; nothing is owned.
    unsafe fn release_unrun(_: *mut Self) {}
    /// A ping to the VM's own module queue.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

/// `module_loader`: the `JSModuleLoader` that fetched, or empty for the global object's.
pub(crate) fn fulfill(
    global_this: &JSGlobalObject,
    promise: JSValue,
    module_loader: JSValue,
    result: Result<ResolvedSource, crate::CrateError>,
    specifier: &BunString,
    referrer: &BunString,
    log: &mut bun_ast::Log,
) -> JsResult<()> {
    jsc::mark_binding();
    let mut errorable = match result {
        Ok(resolved_source) => ErrorableResolvedSource::ok(resolved_source),
        Err(crate::CrateError::JSError | crate::CrateError::Bundler(bun_bundler::Error::Js(_))) => {
            ErrorableResolvedSource::err(global_this.take_error(JsError::Thrown))
        }
        Err(e) => ErrorableResolvedSource::err(crate::virtual_machine::process_fetch_log(
            global_this,
            specifier,
            referrer,
            log,
            e,
        )),
    };
    bun_core::scoped_log!(AsyncModule, "fulfill: {}", specifier);

    jsc::from_js_host_call_generic(global_this, || {
        Bun__onFulfillAsyncModule(
            global_this,
            promise,
            module_loader,
            &mut errorable,
            specifier,
            referrer,
        )
    })
}

// safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*const`); `res` stays owned by this frame — C++
// takes the fields it keeps by transfer (zeroing them) and the rest drops here.
unsafe extern "C" {
    #[allow(improper_ctypes)]
    safe fn Bun__onFulfillAsyncModule(
        global_object: &JSGlobalObject,
        promise_value: JSValue,
        module_loader: JSValue,
        res: &mut ErrorableResolvedSource,
        specifier: &BunString,
        referrer: &BunString,
    );
}

impl Queue {
    /// `WakeHandler::handler` — runs on install / HTTP-callback threads
    /// (`PackageManager::wake_raw`). `ctx` is the [`WakeContext`] registered in
    /// `runtime/jsc_hooks.rs`; the VM is reached only through its handle.
    pub fn on_wake_handler(ctx: *mut c_void, _: *mut c_void) {
        bun_core::scoped_log!(AsyncModule, "onWake");
        // SAFETY: `ctx` is the leaked `WakeContext` registered with this handler.
        let ctx = unsafe { &*ctx.cast::<WakeContext>() };
        let task = ConcurrentTaskItem::create_from(ctx.queue);
        if let crate::vm_handle::Posted::Refused(task) = ctx.handle.post(ctx.kind, task) {
            // That VM has closed.
            // SAFETY: refused ⇒ we own the task box.
            unsafe { drop(bun_core::heap::take(task.as_ptr())) };
        }
    }

    /// A synchronous auto-install drains its own tasks; this only wakes the loop.
    pub fn on_poll(&mut self) {
        bun_core::scoped_log!(AsyncModule, "onPoll");
    }
}
