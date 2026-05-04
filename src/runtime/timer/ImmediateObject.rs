use core::cell::Cell;

use bun_jsc::{CallFrame, Debugger, EnsureStillAlive, JSGlobalObject, JSValue, JsResult, VirtualMachine};

// bun.api.Timer.* — sibling modules under src/runtime/timer/
// TODO(port): verify module path once crate layout is wired in Phase B
use super::{EventLoopTimer, TimerObjectInternals, ID};

// bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread refcount.
// `ref`/`deref` are provided by IntrusiveRc over the `ref_count` field; `deref` calls
// `deinit` when the count reaches zero.
// TODO(port): wire bun_ptr::IntrusiveRc<ImmediateObject> drop hook to Self::deinit
pub type ImmediateObjectRc = bun_ptr::IntrusiveRc<ImmediateObject>;

// jsc.Codegen.JSImmediate — the C++ JSCell wrapper stays generated; this struct is the
// `m_ctx` payload. `#[bun_jsc::JsClass]` wires toJS/fromJS/fromJSDirect.
#[bun_jsc::JsClass]
pub struct ImmediateObject {
    ref_count: Cell<u32>,
    pub event_loop_timer: EventLoopTimer,
    pub internals: TimerObjectInternals,
}

impl ImmediateObject {
    pub fn init(
        global_this: &JSGlobalObject,
        id: i32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        // internals are initialized by init()
        let immediate = Box::into_raw(Box::new(Self {
            ref_count: Cell::new(1),
            event_loop_timer: EventLoopTimer {
                next: super::event_loop_timer::Next::EPOCH,
                tag: super::event_loop_timer::Tag::ImmediateObject,
                ..Default::default()
            },
            // SAFETY: Zig wrote `internals = undefined`; every field is overwritten by
            // `internals.init()` below before any read.
            // TODO(port): TimerObjectInternals::init is an out-param constructor — once
            // ported to `fn init(...) -> Self`, replace zeroed()+in-place with a direct value.
            internals: unsafe { core::mem::zeroed() },
        }));
        // SAFETY: just allocated above; sole owner until toJS hands it to the JS wrapper.
        let immediate_ref = unsafe { &mut *immediate };

        let js_value = immediate_ref.to_js(global_this);
        let _keep = EnsureStillAlive(js_value);
        immediate_ref.internals.init(
            js_value,
            global_this,
            id,
            super::Kind::SetImmediate,
            0,
            callback,
            arguments,
        );

        if global_this.bun_vm().is_inspector_enabled() {
            Debugger::did_schedule_async_call(
                global_this,
                Debugger::AsyncCallType::DOMTimer,
                ID::async_id(&ID { id, kind: super::Kind::SetImmediate }),
                true,
            );
        }

        js_value
    }

    // Called by IntrusiveRc when ref_count hits zero. Not `impl Drop` — this is a
    // `.classes.ts` payload whose lifetime is managed by the JS wrapper + intrusive RC.
    fn deinit(this: *mut Self) {
        // SAFETY: caller (IntrusiveRc::deref) guarantees `this` is the last live reference.
        unsafe {
            (*this).internals.deinit();
            drop(Box::from_raw(this));
        }
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global_object: &JSGlobalObject, _call_frame: &CallFrame) -> JsResult<*mut Self> {
        global_object.throw("Immediate is not constructible", format_args!(""))
    }

    /// returns true if an exception was thrown
    pub fn run_immediate_task(&mut self, vm: &mut VirtualMachine) -> bool {
        self.internals.run_immediate_task(vm)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_primitive(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.to_primitive()
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.do_ref(global_this, call_frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.do_unref(global_this, call_frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn has_ref(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.has_ref()
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called on the mutator thread during lazy sweep; `this` is the m_ctx payload.
        unsafe { (*this).internals.finalize() }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_destroyed(this: &Self, _global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(this.internals.get_destroyed()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &mut Self, global_this: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.cancel(global_this.bun_vm());
        Ok(JSValue::UNDEFINED)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/ImmediateObject.zig (106 lines)
//   confidence: medium
//   todos:      3
//   notes:      .classes.ts payload + intrusive RC; internals uses out-param init (zeroed placeholder); sibling-module paths (EventLoopTimer/ID/Kind) need Phase-B fixup
// ──────────────────────────────────────────────────────────────────────────
