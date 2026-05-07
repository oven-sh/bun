use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, Debugger, EnsureStillAlive, JSGlobalObject, JSValue, JsClass, JsResult};
use bun_ptr::{RefCount, RefCounted};

use super::{EventLoopTimer, EventLoopTimerTag, Kind, KindBig, TimerObjectInternals, ID};

/// `jsc.Codegen.JSImmediate` — the C++ JSCell wrapper stays generated; this struct
/// is the `m_ctx` payload. `#[bun_jsc::JsClass]` wires `toJS`/`fromJS`/`fromJSDirect`
/// and emits the `Immediate__create`/`Immediate__fromJS` externs plus the
/// `${name}Class__construct`/`__finalize` shims.
#[bun_jsc::JsClass(name = "Immediate")]
pub struct ImmediateObject {
    pub ref_count: RefCount<Self>,
    pub event_loop_timer: EventLoopTimer,
    pub internals: TimerObjectInternals,
}

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread
// refcount mixin. The Zig comptime params (`field_name`, `destructor`, `options`)
// map to `RefCounted::{get_ref_count, destructor, DestructorCtx}`.
impl RefCounted for ImmediateObject {
    type DestructorCtx = ();

    #[inline]
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live `Self`.
        unsafe { &raw mut (*this).ref_count }
    }

    #[inline]
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: `raw_count == 0` ⇒ unique ownership; `deinit` consumes the
        // `Box::into_raw`'d allocation from `init()`.
        unsafe { Self::deinit(this) }
    }
}

impl Default for ImmediateObject {
    fn default() -> Self {
        Self {
            ref_count: RefCount::init(),
            // Zig: `.{ .next = .epoch, .tag = .ImmediateObject }` — `init_paused`
            // is exactly that (next=EPOCH, state=PENDING, heap zeroed).
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::ImmediateObject),
            // PORT NOTE: Zig left `internals = undefined` and assigned via `*self = .{..}`
            // in `internals.init()`. Rust default-constructs then overwrites — same
            // observable behavior, and avoids dropping an uninitialized `JsRef`.
            internals: TimerObjectInternals::default(),
        }
    }
}

impl ImmediateObject {
    // Zig: `pub const ref = RefCount.ref; pub const deref = RefCount.deref;`
    // — re-export the mixin's ops as inherent fns so `TimerObjectInternals`'s
    // `@fieldParentPtr` dispatch (`ImmediateObject::ref_`/`::deref`) resolves.

    /// Increment the intrusive refcount.
    ///
    /// # Safety
    /// `this` must point to a live, `Box::into_raw`-allocated `ImmediateObject`.
    #[inline]
    pub unsafe fn ref_(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { RefCount::<Self>::ref_(this) }
    }

    /// Decrement the intrusive refcount; on zero runs [`deinit`](Self::deinit)
    /// (drops `internals`, frees the `Box`). After this returns `this` may dangle.
    ///
    /// # Safety
    /// `this` must point to a live, `Box::into_raw`-allocated `ImmediateObject`.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { RefCount::<Self>::deref(this) }
    }

    pub fn init(
        global_this: &JSGlobalObject,
        id: i32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        // internals are initialized by init()
        // `bun.new(Self, .{...})` ⇒ heap-allocate; `*mut Self` is the `m_ctx`
        // payload of the codegen'd JSCell wrapper. Ownership transfers to the
        // wrapper via `to_js_ptr`; freed by `deref → deinit → Box::from_raw`.
        let immediate: *mut Self = Box::into_raw(Box::new(Self::default()));
        // SAFETY: `to_js_ptr` is the `#[JsClass]`-generated `Immediate__create`
        // shim; `immediate` is a fresh heap payload whose ownership transfers to
        // the GC wrapper.
        let js_value = unsafe { Self::to_js_ptr(immediate, global_this) };
        // Zig codegen: `bun.assert(value__.as(Immediate).? == this)` — round-trip ABI check.
        debug_assert!(
            <Self as JsClass>::from_js(js_value) == Some(immediate),
            "Immediate__create ABI mismatch",
        );
        let _keep = EnsureStillAlive(js_value);
        // SAFETY: `immediate` was just allocated above and is exclusively owned here;
        // `internals.init()` writes every field via `*self = Self { … }`.
        unsafe {
            (*immediate).internals.init(
                js_value,
                global_this,
                id,
                Kind::SetImmediate,
                0,
                callback,
                arguments,
            );
        }

        // SAFETY: `bun_vm()` returns the live per-thread VM pointer (non-null on the JS thread).
        if global_this.bun_vm().as_mut().is_inspector_enabled() {
            Debugger::did_schedule_async_call(
                global_this,
                Debugger::AsyncCallType::DOMTimer,
                ID { id, kind: KindBig::SetImmediate }.async_id(),
                true,
            );
        }

        js_value
    }

    /// Called via [`RefCounted::destructor`] when the refcount reaches zero.
    /// Not `impl Drop`: this fn frees the backing `Box` itself (Zig: `bun.destroy(self)`).
    ///
    /// # Safety
    /// `this` must be the unique owner (refcount == 0) of a `Box::into_raw`'d `Self`.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: `this` was allocated via `Box::into_raw` in `init` and the refcount
        // has reached zero, so we hold the unique reference.
        unsafe {
            (*this).internals.deinit();
            drop(Box::from_raw(this));
        }
    }

    // C-ABI shim (`ImmediateClass__construct`) is emitted by `#[bun_jsc::JsClass]`
    // on the struct via `host_fn_construct_result`; do not also annotate with
    // `#[host_fn]` here.
    pub fn constructor(global_object: &JSGlobalObject, _call_frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global_object.throw(format_args!("Immediate is not constructible")))
    }

    /// Spec ImmediateObject.zig `runImmediateTask` — thin forwarder to
    /// `internals.run_immediate_task`. Registered into
    /// `bun_jsc::event_loop::RUN_IMMEDIATE_HOOK` by
    /// [`crate::dispatch::install_dispatch_hooks`].
    ///
    /// Returns `true` if an exception was thrown.
    ///
    /// # Safety
    /// `this` was produced by `enqueue_immediate_task` from a live
    /// heap-allocated `ImmediateObject`; `vm` is the live per-thread VM.
    #[inline]
    pub unsafe fn run_immediate_task(this: *mut Self, vm: *mut VirtualMachine) -> bool {
        // SAFETY: per fn contract — `this` is live; `internals` is an embedded
        // field. Do NOT form `&mut *this` (the body may `deref()` and free).
        unsafe { (*this).internals.run_immediate_task(vm) }
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

    /// `.classes.ts` `finalize: true` — runs on the mutator thread during lazy sweep.
    /// Do not touch any `JSValue`/`Strong` content here.
    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen'd C++ `JSImmediate::~JSImmediate` finalizer with the
        // `m_ctx` pointer; the wrapper guarantees `this` is valid.
        unsafe { (*this).internals.finalize() }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_destroyed(this: &Self, _global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(this.internals.get_destroyed()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &mut Self, global_this: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.cancel(global_this.bun_vm_ptr());
        Ok(JSValue::UNDEFINED)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/ImmediateObject.zig (106 lines)
//   confidence: high
//   todos:      0
// ──────────────────────────────────────────────────────────────────────────
