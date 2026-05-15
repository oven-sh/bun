//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.
//!
//! B-2 un-gate (this round): structs + state machines are real. JS-facing
//! method bodies (`set_timeout`/`clear_timer`/`warn_invalid_countdown`/etc.)
//! remain ``-gated on `bun_jsc` (commented out in Cargo.toml).
//! `All::insert`/`remove`/`update`/`get_timeout`/`drain_timers` — the surface
//! `EventLoop::auto_tick` blocks on per keystone C — are real.
//!
//! Full Phase-A drafts are preserved gated under ` mod *_draft`
//! so this file can be diffed against `Timer.rs` once `bun_jsc` is green.

use core::mem::offset_of;

use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Mutex;

// Low-tier timer node + tag (per §Dispatch hot-path list, the `match tag`
// dispatch lives in this crate; `bun_event_loop` only stores `(tag, ptr)`).
pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};
// TODO(b2-blocked): bun_event_loop carries a local `Timespec` stub instead of
// `bun_core::Timespec`. Same `{sec: i64, nsec: i64}` shape; alias it here so
// `fire()`/`next` accesses type-check without a transmute. Remove once the
// lower tier switches to `bun_core::Timespec`.
pub(crate) use bun_event_loop::EventLoopTimer::Timespec as ElTimespec;

use crate::jsc::{JSGlobalObject, JSValue, JsResult};

// ─── JS-facing surface (`impl All { set_timeout / clear_* / … }`) ────────────
// Named `timer` so codegen (`generated_js2native.rs`) resolves
// `crate::timer::timer::internal_bindings::timer_clock_ms` per the
// `$zig(Timer.zig, …)` → `crate::<dir>::<file>` path-mapping.

#[path = "Timer.rs"]
pub mod timer;

// ─── impl_timer_object! ──────────────────────────────────────────────────────
// Shared scaffold for `TimeoutObject` / `ImmediateObject`: both are a
// `#[JsClass]` payload of `{ref_count, event_loop_timer, internals}` whose
// JS-facing host-fns are pure forwarders to `TimerObjectInternals`. Zig kept
// two hand-duplicated files; this macro emits the byte-identical parts so each
// `*.rs` file holds only its type-specific surface (`init`, `do_refresh`,
// cached-prop accessors, `run_immediate_task`).
//
// Emits, at the call-site module path (so `#[JsClass]`/`#[host_fn]` produce the
// same extern symbol names as before — `Timeout__create`, `TimeoutPrototype__*`,
// `ImmediateClass__construct`, …):
//   - `#[bun_jsc::JsClass(name = $js_name)] pub struct $T { … }`
//   - `bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer)`
//   - `impl RefCounted for $T` (intrusive `ref_count` field, `deinit` destructor)
//   - `impl Default for $T` (`EventLoopTimer::init_paused(EventLoopTimerTag::$tag)`)
//   - `impl $T`: `ref_`/`deref`/`deinit`/`init_with`/`constructor`/`finalize`
//     and the forwarder host-fns `to_primitive`/`do_ref`/`do_unref`/`has_ref`/
//     `get_destroyed`/`dispose`.
//
// Type-specific items (`init`, `do_refresh`, `close`, cached-prop get/set,
// `run_immediate_task`) go in a *second* `impl $T` block in the caller's file.
//
// Paths in the body are written `super::…` / `::crate_name::…` because the
// macro is invoked *from the child module* (`super::impl_timer_object!(…)`),
// so `super` at the expansion site resolves back here to `timer/mod.rs`.
macro_rules! impl_timer_object {
    ($T:ident, $tag:ident, $js_name:literal) => {
        #[::bun_jsc::JsClass(name = $js_name)]
        pub struct $T {
            pub ref_count: ::bun_ptr::RefCount<Self>,
            pub event_loop_timer: super::EventLoopTimer,
            pub internals: super::TimerObjectInternals,
        }

        ::bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer);

        // `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive
        // single-thread refcount mixin.
        impl ::bun_ptr::RefCounted for $T {
            type DestructorCtx = ();
            #[inline]
            unsafe fn get_ref_count(this: *mut Self) -> *mut ::bun_ptr::RefCount<Self> {
                // SAFETY: caller contract — `this` points to a live `Self`.
                unsafe { &raw mut (*this).ref_count }
            }
            #[inline]
            unsafe fn destructor(this: *mut Self, _ctx: ()) {
                // SAFETY: `raw_count == 0` ⇒ unique ownership; `deinit`
                // consumes the `heap::alloc`'d allocation from `init_with()`.
                unsafe { Self::deinit(this) }
            }
        }

        impl ::core::default::Default for $T {
            fn default() -> Self {
                Self {
                    ref_count: ::bun_ptr::RefCount::init(),
                    // Zig: `.{ .next = .epoch, .tag = .$T }` — `init_paused`
                    // is exactly that (next=EPOCH, state=PENDING, heap zeroed).
                    event_loop_timer: super::EventLoopTimer::init_paused(
                        super::EventLoopTimerTag::$tag,
                    ),
                    // PORT NOTE: Zig left `internals = undefined` and assigned
                    // in `init()`; Rust default-constructs then overwrites —
                    // same observable behavior.
                    internals: super::TimerObjectInternals::default(),
                }
            }
        }

        impl $T {
            // Zig: `pub const ref = RefCount.ref; pub const deref = RefCount.deref;`
            // — re-export the mixin's ops as inherent fns so
            // `TimerObjectInternals`'s `container_of` dispatch resolves.

            /// Increment the intrusive refcount.
            ///
            /// # Safety
            /// `this` must point to a live, `heap::alloc`-allocated `Self`.
            #[inline]
            pub unsafe fn ref_(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { ::bun_ptr::RefCount::<Self>::ref_(this) }
            }

            /// Decrement the intrusive refcount; on zero runs `deinit` (drops
            /// `internals`, frees the `Box`). After this returns `this` may
            /// dangle.
            ///
            /// # Safety
            /// `this` must point to a live, `heap::alloc`-allocated `Self`.
            #[inline]
            pub unsafe fn deref(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { ::bun_ptr::RefCount::<Self>::deref(this) }
            }

            /// Shared body of `TimeoutObject::init` / `ImmediateObject::init`:
            /// `bun.new(Self, .{...})` → `to_js_ptr` → `internals.init` →
            /// inspector `did_schedule_async_call`. The per-type `init` fn
            /// picks `kind`/`interval` and forwards here.
            pub fn init_with(
                global: &::bun_jsc::JSGlobalObject,
                id: i32,
                kind: super::Kind,
                interval: u32,
                callback: ::bun_jsc::JSValue,
                arguments: ::bun_jsc::JSValue,
            ) -> ::bun_jsc::JSValue {
                // `bun.new(Self, .{...})` ⇒ heap-allocate; `*mut Self` is the
                // `m_ctx` payload of the codegen'd JSCell wrapper. Ownership
                // transfers to the wrapper via `to_js_ptr`; freed by
                // `deref → deinit → heap::take`.
                let payload: *mut Self =
                    ::bun_core::heap::into_raw(::std::boxed::Box::new(Self::default()));
                // SAFETY: `to_js_ptr` is the `#[JsClass]`-generated `*__create`
                // shim; `payload` is a fresh heap allocation whose ownership
                // transfers to the GC wrapper.
                let js_value = unsafe { Self::to_js_ptr(payload, global) };
                // Zig codegen: `bun.assert(value__.as($T).? == this)` —
                // round-trip ABI check.
                debug_assert!(
                    <Self as ::bun_jsc::JsClass>::from_js(js_value) == Some(payload),
                    concat!($js_name, "__create ABI mismatch"),
                );
                let _keep = ::bun_jsc::EnsureStillAlive(js_value);
                // SAFETY: `payload` was just allocated above and is exclusively
                // owned here; `internals.init()` writes every field.
                unsafe {
                    (*payload).internals.init(
                        js_value, global, id, kind, interval, callback, arguments,
                    );
                }
                if global.bun_vm().as_mut().is_inspector_enabled() {
                    ::bun_jsc::Debugger::did_schedule_async_call(
                        global,
                        ::bun_jsc::Debugger::AsyncCallType::DOMTimer,
                        super::ID { id, kind: kind.big() }.async_id(),
                        kind != super::Kind::SetInterval,
                    );
                }
                js_value
            }

            /// Called via `RefCounted::destructor` when the refcount reaches
            /// zero. Not `impl Drop`: this fn frees the backing `Box` itself
            /// (Zig: `bun.destroy(self)`).
            ///
            /// # Safety
            /// `this` must be the unique owner (refcount == 0) of a
            /// `heap::alloc`'d `Self`.
            unsafe fn deinit(this: *mut Self) {
                // SAFETY: refcount has reached zero ⇒ unique reference.
                unsafe {
                    (*this).internals.deinit();
                    drop(::bun_core::heap::take(this));
                }
            }

            // C-ABI shim (`${name}Class__construct`) is emitted by
            // `#[bun_jsc::JsClass]` via `host_fn_construct_result`; do not also
            // annotate with `#[host_fn]` here.
            pub fn constructor(
                global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<*mut Self> {
                Err(global.throw(format_args!(concat!($js_name, " is not constructible"))))
            }

            #[::bun_jsc::host_fn(method)]
            pub fn to_primitive(
                this: &Self,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.to_primitive()
            }

            #[::bun_jsc::host_fn(method)]
            pub fn do_ref(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.do_ref(global, frame.this())
            }

            #[::bun_jsc::host_fn(method)]
            pub fn do_unref(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.do_unref(global, frame.this())
            }

            #[::bun_jsc::host_fn(method)]
            pub fn has_ref(
                this: &Self,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.has_ref()
            }

            /// `.classes.ts` `finalize: true` — runs on the mutator thread
            /// during lazy sweep. Do not touch any `JSValue`/`Strong` content.
            pub fn finalize(self: ::std::boxed::Box<Self>) {
                // Refcounted via `internals`: `internals.finalize()` derefs the
                // intrusive count; allocation may outlive this call if other
                // refs remain, so hand ownership back to the raw refcount.
                ::bun_core::heap::release(self).internals.finalize()
            }

            #[::bun_jsc::host_fn(getter)]
            pub fn get_destroyed(
                this: &Self,
                _global: &::bun_jsc::JSGlobalObject,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                Ok(::bun_jsc::JSValue::from(this.internals.get_destroyed()))
            }

            #[::bun_jsc::host_fn(method)]
            pub fn dispose(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.cancel(global.bun_vm_ptr());
                Ok(::bun_jsc::JSValue::UNDEFINED)
            }
        }
    };
}
pub(crate) use impl_timer_object;

#[path = "TimeoutObject.rs"]
pub mod timeout_object;

#[path = "ImmediateObject.rs"]
pub mod immediate_object;

#[path = "DateHeaderTimer.rs"]
mod date_header_timer_draft;

#[path = "EventLoopDelayMonitor.rs"]
mod event_loop_delay_monitor_draft;

// ─── TimerHeap ───────────────────────────────────────────────────────────────
// Zig: `heap.Intrusive(EventLoopTimer, void, EventLoopTimer.less)`.
//
// Real intrusive pairing-heap (meld/remove/combine_siblings) ported in
// `bun_io::heap::Intrusive`. `EventLoopTimer` now embeds the real
// `bun_io::heap::IntrusiveField` and impls `HeapNode` in its defining crate
// (`bun_event_loop`), so the orphan-rule block is gone. `TimerHeap` is a thin
// newtype that adapts `*mut T` ↔ `Option<*mut T>` for the existing call-sites
// (`All::insert/remove/next/get_timeout`).

/// `void` context for the heap comparator — Zig passes `{}`.
#[derive(Default)]
pub struct TimerHeapCtx;

impl bun_io::heap::HeapContext<EventLoopTimer> for TimerHeapCtx {
    #[inline]
    fn less(&self, a: *mut EventLoopTimer, b: *mut EventLoopTimer) -> bool {
        // SAFETY: `Intrusive` only ever calls `less` with non-null nodes that
        // are live members of the heap (caller invariant on insert/meld).
        EventLoopTimer::less((), unsafe { &*a }, unsafe { &*b })
    }
}

#[derive(Default)]
pub struct TimerHeap(bun_io::heap::Intrusive<EventLoopTimer, TimerHeapCtx>);

impl TimerHeap {
    #[inline]
    pub fn peek(&self) -> Option<*mut EventLoopTimer> {
        let r = self.0.peek();
        if r.is_null() { None } else { Some(r) }
    }

    /// # Safety
    /// `v` is a valid, exclusively-owned node not currently in any heap
    /// (its `IntrusiveField` links are null).
    #[inline]
    pub unsafe fn insert(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.insert(v) };
    }

    /// # Safety
    /// `v` is a node currently in *this* heap.
    #[inline]
    pub unsafe fn remove(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.remove(v) };
    }

    #[inline]
    pub fn delete_min(&mut self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live until popped (intrusive invariant maintained by `All`).
        let r = unsafe { self.0.delete_min() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub fn find_max(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live for the heap's lifetime (intrusive invariant maintained by `All`).
        let r = unsafe { self.0.find_max() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub fn count(&self) -> usize {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live for the heap's lifetime (intrusive invariant maintained by `All`).
        unsafe { self.0.count() }
    }
}

/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
pub type TimeoutMap = ArrayHashMap<i32, *mut EventLoopTimer>;

#[derive(Default)]
pub struct Maps {
    pub set_timeout: TimeoutMap,
    pub set_interval: TimeoutMap,
    pub set_immediate: TimeoutMap,
}

impl Maps {
    #[inline]
    pub fn get(&mut self, kind: Kind) -> &mut TimeoutMap {
        match kind {
            Kind::SetTimeout => &mut self.set_timeout,
            Kind::SetInterval => &mut self.set_interval,
            Kind::SetImmediate => &mut self.set_immediate,
        }
    }
}

// ─── FakeTimers ──────────────────────────────────────────────────────────────
// Real definition lives in `runtime/test_runner/timers/FakeTimers.rs` and
// depends on `TimerHeap` (defined above). Now that `pub mod test_runner` is
// declared in lib.rs, re-export so `All.fake_timers` and the test_runner
// host fns see the same nominal type.
pub use crate::test_runner::timers::fake_timers::FakeTimers;

// ─── DateHeaderTimer / EventLoopDelayMonitor (struct-only) ───────────────────
// Method bodies (`enable`/`run`) call `vm.timer.*` and `vm.uws_loop()` which
// need `VirtualMachine.timer: All` (currently `()` in bun_jsc). Struct shape
// is real so `All` embeds them by value with the correct layout.

pub struct DateHeaderTimer {
    pub event_loop_timer: EventLoopTimer,
}
impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::DateHeaderTimer),
        }
    }
}
impl DateHeaderTimer {
    #[inline]
    fn timer_all() -> *mut All {
        crate::jsc_hooks::timer_all()
    }

    /// Spec DateHeaderTimer.zig `run` — refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub fn run(&mut self, vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        // `uws_loop_mut` is the audited safe accessor (loop owned by the VM,
        // separate allocation from `RuntimeState.timer` so no aliasing with
        // `&mut self`).
        let loop_ = vm.uws_loop_mut();
        let now = Timespec::now(TimespecMockMode::AllowMockedTime);

        // Record when we last ran it.
        self.event_loop_timer.next = ElTimespec {
            sec: now.sec,
            nsec: now.nsec,
        };

        // updateDate() is an expensive function.
        loop_.update_date();

        if loop_.internal_loop_data.sweep_timer_count > 0 {
            // Reschedule it automatically for 1 second later.
            let next = now.add_ms(1000);
            self.event_loop_timer.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
            // `fake_timers`, disjoint from `date_header_timer` which `self` aliases.
            unsafe { (*Self::timer_all()).insert(elt) };
        }
    }
}

pub struct EventLoopDelayMonitor {
    // TODO(port): bare JSValue heap field — see EventLoopDelayMonitor.rs PORT NOTE
    js_histogram: JSValue,
    pub event_loop_timer: EventLoopTimer,
    pub resolution_ms: i32,
    pub last_fire_ns: u64,
    pub enabled: bool,
}
impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            js_histogram: JSValue::default(),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::EventLoopDelayMonitor),
            resolution_ms: 10,
            last_fire_ns: 0,
            enabled: false,
        }
    }
}
impl EventLoopDelayMonitor {
    #[inline]
    fn timer_all() -> *mut All {
        crate::jsc_hooks::timer_all()
    }

    pub fn enable(
        &mut self,
        _vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        histogram: JSValue,
        resolution_ms: i32,
    ) {
        if self.enabled {
            return;
        }
        self.js_histogram = histogram;
        self.resolution_ms = resolution_ms;
        self.enabled = true;

        // Schedule timer
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let next = now.add_ms(i64::from(resolution_ms));
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
        // `fake_timers`, disjoint from `event_loop_delay` which `self` aliases.
        unsafe { (*Self::timer_all()).insert(elt) };
    }

    pub fn disable(&mut self, _vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        if !self.enabled {
            return;
        }
        self.enabled = false;
        self.js_histogram = JSValue::default();
        self.last_fire_ns = 0;
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*Self::timer_all()).remove(elt) };
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled && !self.js_histogram.is_empty()
    }

    /// Spec EventLoopDelayMonitor.zig `onFire` — record `now - last_fire_ns`
    /// into the JS histogram and reschedule.
    pub fn on_fire(
        &mut self,
        _vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        now: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        if !self.enabled || self.js_histogram.is_empty() {
            return;
        }

        let now_ns = now.ns();
        if self.last_fire_ns > 0 {
            let expected_ns = u64::try_from(self.resolution_ms)
                .expect("int cast")
                .saturating_mul(1_000_000);
            let actual_ns = now_ns - self.last_fire_ns;

            if actual_ns > expected_ns {
                let delay_ns =
                    i64::try_from(actual_ns.saturating_sub(expected_ns)).expect("int cast");
                unsafe extern "C" {
                    safe fn JSNodePerformanceHooksHistogram_recordDelay(
                        histogram: JSValue,
                        delay_ns: i64,
                    );
                }
                JSNodePerformanceHooksHistogram_recordDelay(self.js_histogram, delay_ns);
            }
        }

        self.last_fire_ns = now_ns;

        // Reschedule
        let next = Timespec {
            sec: now.sec,
            nsec: now.nsec,
        }
        .add_ms(i64::from(self.resolution_ms));
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*Self::timer_all()).insert(elt) };
    }
}

// ─── TimerObjectInternals / TimeoutObject / ImmediateObject (struct-only) ───
// `Flags` is the real packed-u32 state machine; method bodies that touch
// `bun_jsc::JsRef`/`Debugger` stay gated.

pub mod timer_object_internals;
pub use timer_object_internals::{Flags as TimerFlags, TimerObjectInternals};

/// `jsc.WebCore.AbortSignal.Timeout` — real struct lives in `bun_jsc` (which
/// this crate depends on). Re-exported here so `All::update`'s
/// `@fieldParentPtr` epoch-bump and `dispatch::fire_timer` resolve the same
/// `event_loop_timer`/`flags` offsets the low tier wrote.
pub use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

pub use self::immediate_object::ImmediateObject;
pub use self::timeout_object::TimeoutObject;

/// Spec EventLoopTimer.zig:145 `jsTimerInternalsFlags` — recover the
/// [`TimerFlags`] slot for the three JS-timer container tags
/// (`TimeoutObject` / `ImmediateObject` / `AbortSignalTimeout`), else `None`.
///
/// Returns a raw `NonNull` so the caller decides read vs. write:
/// [`EventLoopTimer::less`] reads `.epoch()` on the heap-compare hot path;
/// [`All::update`] writes `.set_epoch()` under the timer lock. The two
/// `internals.flags` arms store `Cell<TimerFlags>`; `Cell<T>` is
/// `#[repr(transparent)]` so the `addr_of!` → `.cast()` is layout-sound.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] whose `tag` was set at
/// construction and never re-tagged (the JS-timer-tag invariant). When the
/// tag matches, `t` is the `event_loop_timer` field of the named container
/// with whole-container provenance.
#[inline]
pub unsafe fn js_timer_flags_ptr(
    t: *const EventLoopTimer,
) -> Option<core::ptr::NonNull<TimerFlags>> {
    use core::ptr::{NonNull, addr_of};
    // SAFETY: caller contract — `t` is live; tag invariant per fn docs.
    unsafe {
        let p: *const TimerFlags = match (*t).tag {
            EventLoopTimerTag::TimeoutObject => {
                let parent = TimeoutObject::from_timer_ptr(t);
                addr_of!((*parent).internals.flags).cast()
            }
            EventLoopTimerTag::ImmediateObject => {
                let parent = ImmediateObject::from_timer_ptr(t);
                addr_of!((*parent).internals.flags).cast()
            }
            // Spec EventLoopTimer.zig:157-160 — `AbortSignal.Timeout` stores
            // `flags` directly (not under `.internals`, not `Cell`-wrapped).
            EventLoopTimerTag::AbortSignalTimeout => {
                let parent = AbortSignalTimeout::from_timer_ptr(t);
                addr_of!((*parent).flags)
            }
            _ => return None,
        };
        Some(NonNull::new_unchecked(p as *mut TimerFlags))
    }
}

/// A timer created by WTF code and invoked by Bun's event loop.
#[path = "WTFTimer.rs"]
pub mod wtf_timer;
pub use wtf_timer::WTFTimer;

// ─── All ─────────────────────────────────────────────────────────────────────

pub struct All {
    pub last_id: i32,
    pub lock: Mutex,
    pub thread_id: std::thread::ThreadId,
    pub timers: TimerHeap,
    pub active_timer_count: i32,
    #[cfg(windows)]
    pub uv_timer: bun_sys::windows::libuv::Timer,
    /// Whether we have emitted a warning for passing a negative timeout duration
    pub warned_negative_number: bool,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    pub warned_not_number: bool,
    /// Incremented when timers are scheduled or rescheduled. See
    /// TimerObjectInternals.epoch. Zig u25 — masked on increment.
    pub epoch: u32,
    pub immediate_ref_count: i32,
    #[cfg(windows)]
    pub uv_idle: bun_sys::windows::libuv::uv_idle_t,
    pub event_loop_delay: EventLoopDelayMonitor,
    pub fake_timers: FakeTimers,
    pub maps: Maps,
    pub date_header_timer: DateHeaderTimer,
}

impl All {
    pub fn init() -> Self {
        Self {
            last_id: 1,
            lock: Mutex::default(),
            thread_id: std::thread::current().id(),
            timers: TimerHeap::default(),
            active_timer_count: 0,
            #[cfg(windows)]
            uv_timer: bun_core::ffi::zeroed(),
            warned_negative_number: false,
            warned_not_number: false,
            epoch: 0,
            immediate_ref_count: 0,
            #[cfg(windows)]
            uv_idle: bun_core::ffi::zeroed(),
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            maps: Maps::default(),
            date_header_timer: DateHeaderTimer::default(),
        }
    }

    pub fn insert(&mut self, timer: *mut EventLoopTimer) {
        self.lock.lock();
        // PORT NOTE: bun_threading::Mutex is lock()/unlock(), not RAII.
        let r = self.insert_lock_held(timer);
        self.lock.unlock();
        r
    }

    fn insert_lock_held(&mut self, timer: *mut EventLoopTimer) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // PORT NOTE (§Forbidden aliased-&mut): `TimerHeap::insert` forms a
        // fresh `&mut EventLoopTimer` via `(*a).heap()` for the same
        // allocation, so we must NOT hold a `&mut *timer` across that call.
        // Read `tag` and write `state`/`in_heap` via raw deref instead.
        let allow_fake = unsafe { (*timer).tag }.allow_fake_timers();
        if self.fake_timers.is_active() && allow_fake {
            // SAFETY: see fn contract
            unsafe {
                self.fake_timers.timers.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
                (*timer).in_heap = InHeap::Fake;
            }
        } else {
            // SAFETY: see fn contract
            unsafe {
                self.timers.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
                (*timer).in_heap = InHeap::Regular;
            }
            #[cfg(windows)]
            self.ensure_uv_timer();
        }
    }

    /// Spec Timer.zig:125-152 `ensureUVTimer` — lazily `uv_timer_init` the
    /// per-`All` libuv timer, then (re)start it for the soonest heap deadline.
    /// On Windows there is no epoll/kqueue fallback; this `uv_timer_t` is the
    /// ONLY thing that wakes `uv_run` for JS timers.
    ///
    /// PORT NOTE (b2-cycle): Zig recovers `*VirtualMachine` via
    /// `@fieldParentPtr("timer", this)` (the VM that *owns* this `All`) and
    /// reads `vm.uvLoop()` == `vm.event_loop_handle`. In Rust `All` is a field
    /// of `RuntimeState` (not `VirtualMachine`) and `RuntimeState` carries no
    /// back-pointer, so the lazy-init block falls back to the calling thread's
    /// TLS VM/loop. That equivalence holds **only** on the owning JS thread;
    /// `All.lock` exists precisely because `insert`/`update` may be entered
    /// cross-thread (WTFTimer), where TLS would resolve to the wrong loop or
    /// panic. The `debug_assert!` below makes that precondition loud. Once
    /// initialized, the re-arm path reads the loop back from the handle itself
    /// (`uv_handle_get_loop`), so the hot path is TLS-free and always targets
    /// the loop the timer was actually registered on.
    ///
    /// TODO(b2-cycle): thread `vm: *mut VirtualMachine` through
    /// `insert`/`insert_lock_held`/`update` (matching the Zig signature) once
    /// the `RuntimeHooks::timer_insert` slot widens — see jsc_hooks.rs.
    #[cfg(windows)]
    fn ensure_uv_timer(&mut self) {
        // Spec: `vm` is `@fieldParentPtr("timer", this)` — i.e. the OWNING VM,
        // not the calling thread's. Guard the TLS fallback so a cross-thread
        // caller fails loudly instead of silently arming a fresh `uv_loop_t`
        // on the wrong thread.
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "ensure_uv_timer: called off the owning JS thread; TLS loop/VM would diverge from vm.event_loop_handle",
        );
        if self.uv_timer.data.is_null() {
            self.uv_timer.init(uv::Loop::get());
            self.uv_timer.data =
                bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr().cast::<core::ffi::c_void>();
            self.uv_timer.unref();
        }

        if let Some(timer) = self.timers.peek() {
            // SAFETY: `uv_timer.data` is non-null past the lazy-init block, so
            // `uv_timer_init` has run and the handle's `loop` field points at
            // the owning VM's live `uv_loop_t` (== `vm.uvLoop()` per spec).
            unsafe { uv::uv_update_time(self.uv_timer.get_loop()) };
            let now = Timespec::now(TimespecMockMode::ForceRealTime);
            // SAFETY: `peek` returns a live heap node.
            let next = unsafe { &(*timer).next };
            let next_ts = Timespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            let wait = if next_ts.greater(&now) {
                next_ts.duration(&now)
            } else {
                Timespec { sec: 0, nsec: 0 }
            };

            // minimum 1ms
            // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
            let wait_ms = core::cmp::max(1, wait.ms_unsigned());

            self.uv_timer.start(wait_ms, 0, Some(Self::on_uv_timer));

            if self.active_timer_count > 0 {
                self.uv_timer.ref_();
            } else {
                self.uv_timer.unref();
            }
        }
    }

    /// Spec Timer.zig:154-159 `onUVTimer` — libuv timer callback; drain due
    /// timers then re-arm for the next deadline. Only ever invoked by libuv
    /// (coerces to the `uv_timer_cb` fn-pointer type at the `Timer::start`
    /// call site); body wraps its derefs explicitly.
    #[cfg(windows)]
    extern "C" fn on_uv_timer(uv_timer_t: *mut uv::Timer) {
        // SAFETY: `uv_timer_t` is the address of `All.uv_timer` (libuv passes
        // back exactly the handle pointer we registered in `ensure_uv_timer`);
        // recover the containing `All` via container_of.
        let all: *mut All = unsafe { bun_core::from_field_ptr!(All, uv_timer, uv_timer_t) };
        // SAFETY: `data` was set to the VM ptr in `ensure_uv_timer` (non-null).
        let vm: *mut () = unsafe { (*uv_timer_t).data.cast() };
        // SAFETY: callback fires on the JS thread (libuv invokes on the loop's
        // thread); `all` is live for the VM lifetime. `drain_timers` may
        // re-enter `(*runtime_state()).timer` — it forms only short-lived
        // `&mut All` around heap pop/peek, so the raw-ptr deref here is sound.
        unsafe { (*all).drain_timers(vm) };
        // SAFETY: see above; re-arm for the next-soonest deadline (if any).
        unsafe { (*all).ensure_uv_timer() };
    }

    pub fn remove(&mut self, timer: *mut EventLoopTimer) {
        self.lock.lock();
        self.remove_lock_held(timer);
        self.lock.unlock();
    }

    fn remove_lock_held(&mut self, timer: *mut EventLoopTimer) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // PORT NOTE (§Forbidden aliased-&mut): `TimerHeap::remove` forms a
        // fresh `&mut EventLoopTimer` via `(*v).heap()` for the same
        // allocation, so we must NOT hold a `&mut *timer` across that call.
        // Read `in_heap` and write the post-remove bookkeeping via raw deref.
        match unsafe { (*timer).in_heap } {
            InHeap::None => {
                // PORT NOTE: `Environment.ci_assert` → `debug_assertions` (see ptr/ref_count.rs).
                // can't remove a timer that was not inserted
                debug_assert!(false);
            }
            // SAFETY: timer is in `self.timers` per `in_heap`
            InHeap::Regular => unsafe { self.timers.remove(timer) },
            // SAFETY: timer is in `self.fake_timers.timers` per `in_heap`
            InHeap::Fake => unsafe { self.fake_timers.timers.remove(timer) },
        }
        // SAFETY: `timer` is still a valid live EventLoopTimer.
        unsafe {
            (*timer).in_heap = InHeap::None;
            (*timer).state = EventLoopTimerState::CANCELLED;
        }
    }

    /// Remove the EventLoopTimer if necessary, then re-insert at `time`.
    pub fn update(&mut self, timer: *mut EventLoopTimer, time: &Timespec) {
        self.lock.lock();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // Read `state` via raw deref so we don't hold a `&mut *timer` across
        // `remove_lock_held` (which also `&mut`-derefs the same pointer);
        // overlapping `&mut` is UB under Stacked Borrows.
        if unsafe { (*timer).state } == EventLoopTimerState::ACTIVE {
            self.remove_lock_held(timer);
        }

        // SAFETY: `timer` is still a valid live EventLoopTimer; safe to derive
        // an exclusive reference now that no other borrow is outstanding.
        let timer_ref = unsafe { &mut *timer };
        // PORT NOTE: Zig asserts `&timer.next != time` (threadsafety); the
        // EventLoopTimer.Timespec and bun_core::Timespec are distinct types
        // until the lower tier unifies them, so the pointer-compare is moot
        // here. Re-add once `bun_event_loop` switches to `bun_core::Timespec`.
        timer_ref.next.sec = time.sec;
        timer_ref.next.nsec = time.nsec;

        // Spec Timer.zig:117-120: bump the global epoch and write it back
        // into the per-timer flags so equal-deadline JS timers fire in
        // refresh order.
        // SAFETY: `timer` is live (caller contract); `timer_ref`'s last use
        // is above so the raw `(*timer).tag` read inside is SB-clean.
        if let Some(flags) = unsafe { js_timer_flags_ptr(timer) } {
            // Zig: `epoch: u25` with `+%= 1`.
            self.epoch = self.epoch.wrapping_add(1) & ((1u32 << 25) - 1);
            // SAFETY: exclusive under `self.lock`; `flags` points into the
            // live container recovered above.
            unsafe { (*flags.as_ptr()).set_epoch(self.epoch) };
        }

        self.insert_lock_held(timer);
        self.lock.unlock();
    }

    fn is_date_timer_active(&self) -> bool {
        self.date_header_timer.event_loop_timer.state == EventLoopTimerState::ACTIVE
    }

    /// Called from `EventLoop::auto_tick` to compute the epoll/kqueue timeout.
    /// Returns `true` if `spec` was written.
    ///
    /// PORT NOTE (b2): `vm` is erased per §Dispatch (the caller is in
    /// `bun_jsc::event_loop` which can't name `bun_runtime`). The two reads
    /// it needs — `event_loop.immediate_tasks.len()` and the QUIC tick — are
    /// passed in pre-computed until the cycle is broken.
    pub fn get_timeout(
        &mut self,
        spec: &mut Timespec,
        has_pending_immediate: bool,
        quic_next_tick_us: Option<i64>,
        vm: *mut (), /* erased *mut VirtualMachine, forwarded to fire() */
    ) -> bool {
        #[cfg(unix)]
        if has_pending_immediate {
            *spec = Timespec { sec: 0, nsec: 0 };
            return true;
        }
        #[cfg(not(unix))]
        let _ = has_pending_immediate;

        // PORT NOTE (§Forbidden aliased-&mut): the WTFTimer arm below calls
        // `(*min).fire(...)` → `WTFTimer__fire` → C++ may call back into
        // `WTFTimer__update` → `(*runtime_state()).timer.update(...)`, minting
        // a fresh `&mut All` to this same allocation while the outer
        // `&mut self` is live → aliased-`&mut` UB. Mirror `drain_timers`:
        // convert `self` to a raw pointer up-front and form *short-lived*
        // `&mut *this` borrows only around `peek()`/`delete_min()`, dropping
        // them before `fire()` so no `&mut All` is held across the re-entrant
        // call. Spec Timer.zig:247 takes `*All` (raw pointer) for the same
        // reason.
        //
        // TODO(b2): same caveat as `drain_timers` — the call-site auto-ref
        // still creates a `&mut All` for the call frame; switch the signature
        // to `this: *mut Self` (see jsc_hooks.rs:525).
        let this: *mut Self = self;
        let mut maybe_now: Option<Timespec> = None;
        loop {
            // SAFETY: `this` derived from `&mut self`; short-lived exclusive
            // borrow scoped to this `peek()` call only.
            let Some(min) = (unsafe { &mut *this }).timers.peek() else {
                break;
            };
            // SAFETY: peek returns a live heap node.
            // PORT NOTE (§Forbidden aliased-&mut): `delete_min()` writes
            // `(*min).heap` through a fresh `&mut EventLoopTimer`, so we must
            // NOT hold a `&mut *min` across it. Read `next`/`tag` via raw
            // deref and fire via raw deref (mirroring `drain_timers`).
            let (min_next_sec, min_next_nsec, min_tag) =
                unsafe { ((*min).next.sec, (*min).next.nsec, (*min).tag) };
            let now =
                *maybe_now.get_or_insert_with(|| Timespec::now(TimespecMockMode::AllowMockedTime));

            // bun_event_loop carries its own Timespec stub; compare field-wise.
            let min_next = Timespec {
                sec: min_next_sec,
                nsec: min_next_nsec,
            };
            match now.order(&min_next) {
                core::cmp::Ordering::Greater | core::cmp::Ordering::Equal => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if min_tag == EventLoopTimerTag::WTFTimer {
                        // SAFETY: short-lived `&mut All` scoped to
                        // `delete_min()`; dropped before `fire()`.
                        let _ = unsafe { &mut *this }.timers.delete_min();
                        let el_now = ElTimespec {
                            sec: now.sec,
                            nsec: now.nsec,
                        };
                        // SAFETY: `min` was just popped and is live; no `&mut`
                        // to `All` or to `*min` is held across `fire()`, which
                        // may re-enter `(*runtime_state()).timer`.
                        unsafe { EventLoopTimer::fire(min, &el_now, vm) };
                        continue;
                    }
                    *spec = Timespec { sec: 0, nsec: 0 };
                    return true;
                }
                core::cmp::Ordering::Less => {
                    *spec = min_next.duration(&now);
                    if let Some(us) = quic_next_tick_us {
                        if us >= 0 {
                            Self::clamp_to_quic(spec, us);
                        }
                    }
                    return true;
                }
            }
        }

        if let Some(us) = quic_next_tick_us {
            if us >= 0 {
                *spec = Timespec {
                    sec: us / US_PER_S,
                    nsec: (us % US_PER_S) * NS_PER_US,
                };
                return true;
            }
        }
        false
    }

    fn clamp_to_quic(spec: &mut Timespec, us: i64) {
        let cur_us = spec.sec * US_PER_S + spec.nsec / NS_PER_US;
        if us < cur_us {
            *spec = Timespec {
                sec: us / US_PER_S,
                nsec: (us % US_PER_S) * NS_PER_US,
            };
        }
    }

    /// Pop the next due timer (under lock). `now` is filled lazily on first
    /// call so we don't pay for `clock_gettime` when the heap is empty.
    fn next(&mut self, has_set_now: &mut bool, now: &mut Timespec) -> Option<*mut EventLoopTimer> {
        self.lock.lock();
        let out = (|| {
            let timer = self.timers.peek()?;
            if !*has_set_now {
                *now = Timespec::now(TimespecMockMode::AllowMockedTime);
                *has_set_now = true;
            }
            // SAFETY: peek returns a live heap node
            let next = unsafe { &(*timer).next };
            if (Timespec {
                sec: next.sec,
                nsec: next.nsec,
            })
            .greater(now)
            {
                return None;
            }
            let deleted = self.timers.delete_min().expect("peek succeeded");
            debug_assert!(core::ptr::eq(deleted, timer));
            Some(timer)
        })();
        self.lock.unlock();
        out
    }

    pub fn drain_timers(&mut self, vm: *mut () /* erased *mut VirtualMachine */) {
        // PORT NOTE (§Forbidden aliased-&mut): spec Timer.zig:346-354 takes
        // `*All` (raw pointer) because fired handlers re-enter `vm.timer`
        // (e.g. setInterval reschedule → `vm.timer.update(...)`, `cancel()` →
        // `vm.timer.remove(...)`). In Rust those re-entrant calls resolve to
        // `(*runtime_state()).timer.{update,remove}()`, minting a fresh
        // `&mut All` to this same allocation while the outer `&mut self` is
        // live → UB under Stacked Borrows. Convert `self` to a raw pointer
        // up-front and form a *short-lived* `&mut` only around `next()`,
        // dropping it before `fire()` so no `&mut All` is held across the
        // re-entrant call (mirroring the raw-ptr pattern in
        // `TimerObjectInternals::run_immediate_task`).
        //
        // TODO(b2): the call-site auto-ref at jsc_hooks.rs (`(*state).timer
        // .drain_timers(...)`) still creates a `&mut All` for the call frame
        // itself; switch it to `All::drain_timers(core::ptr::addr_of_mut!(
        // (*state).timer), vm)` and change this signature to `this: *mut Self`.
        let this: *mut Self = self;
        let mut now = Timespec { sec: 0, nsec: 0 };
        let mut has_set_now = false;
        loop {
            // SAFETY: `this` derived from `&mut self`; short-lived exclusive
            // borrow scoped to this `next()` call only — dropped before fire().
            let Some(t) = (unsafe { &mut *this }).next(&mut has_set_now, &mut now) else {
                break;
            };
            // PORT NOTE: re-pack into bun_event_loop's local Timespec stub
            // until the lower tier unifies on bun_core::Timespec.
            let el_now = ElTimespec {
                sec: now.sec,
                nsec: now.nsec,
            };
            // SAFETY: `t` was just popped from the intrusive heap and is live.
            // `fire` dispatches through the FIRE_TIMER hook (§Dispatch hot
            // path) and may re-enter `(*runtime_state()).timer` — no `&mut`
            // to `All` is live here.
            unsafe { EventLoopTimer::fire(t, &el_now, vm) };
        }
    }

    pub fn increment_immediate_ref(&mut self, delta: i32, uws_loop: *mut bun_uws_sys::Loop) {
        let old = self.immediate_ref_count;
        let new = old + delta;
        self.immediate_ref_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.ref_();
            #[cfg(windows)]
            {
                // Spec Timer.zig:168-179: lazy-init the idle handle and start
                // it with a no-op callback so `uv_run` does not block in poll
                // while immediates are pending (matches Node.js).
                if self.uv_idle.data.is_null() {
                    self.uv_idle.init(uv::Loop::get());
                    // PORT NOTE: Zig stashes `vm` here; only used as a
                    // non-null "initialized" sentinel — never dereferenced.
                    self.uv_idle.data = bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr()
                        .cast::<core::ffi::c_void>();
                }
                self.uv_idle.start(Some(Self::on_uv_idle_noop));
            }
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.unref();
            #[cfg(windows)]
            if !self.uv_idle.data.is_null() {
                self.uv_idle.stop();
            }
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }

    /// Spec Timer.zig:175-177 — empty `uv_idle` callback. Its presence alone
    /// keeps `uv_run` from blocking in the poll phase; the body is a no-op.
    /// No preconditions (the handle pointer is unused), so the fn is safe; the
    /// safe fn item coerces into the `uv_idle_cb` fn-pointer slot.
    #[cfg(windows)]
    extern "C" fn on_uv_idle_noop(_: *mut uv::uv_idle_t) {
        // prevent libuv from polling forever
    }

    pub fn increment_timer_ref(&mut self, delta: i32, uws_loop: *mut bun_uws_sys::Loop) {
        let old = self.active_timer_count;
        let new = old + delta;
        debug_assert!(new >= 0);
        self.active_timer_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.ref_();
            // Spec Timer.zig:207-213 calls `this.uv_timer.ref()` unconditionally
            // (no `data != null` guard). Invariant: every path that reaches a
            // positive `active_timer_count` first inserts a timer, and `insert`
            // → `ensure_uv_timer` lazily `uv_timer_init`s the handle. Guarding
            // here would silently drop the ref and let the loop exit early, so
            // match Zig exactly.
            #[cfg(windows)]
            self.uv_timer.ref_();
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.unref();
            #[cfg(windows)]
            self.uv_timer.unref();
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }
}

// ─── JS-facing surface (gated on bun_jsc) ────────────────────────────────────
// `set_timeout`/`set_interval`/`set_immediate`/`sleep`/`clear_*` and the
// host_fn export thunks all need `JSGlobalObject::bun_vm()`,
// `JSValue::to_number()`, `bun_core::String::transfer_to_js()`, etc.
// Kept gated until `bun_jsc.workspace = true` is re-enabled.

// TODO(port): JS-facing surface (`set_timeout`/`set_interval`/...) lives in
// `Timer.rs` and is wired via `#[cfg(feature = "jsc")]` once `bun_jsc` is
// re-enabled. The placeholder `include!` was non-compilable; removed.
impl All {}

// ─── enums / value types ─────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum TimeoutWarning {
    TimeoutOverflowWarning,
    TimeoutNegativeWarning,
    TimeoutNaNWarning,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum CountdownOverflowBehavior {
    /// `setTimeout` and friends.
    OneMs,
    /// `Bun.sleep`.
    Clamp,
}

// LAYERING: `Kind`/`KindBig` moved DOWN to `bun_event_loop` so `TimerFlags`
// (also moved down) can name them without a `bun_runtime` dep — needed by
// `bun_jsc::abort_signal::Timeout.flags`. `Kind::big()` lives next to the
// type so `TimeoutObject`/`TimerObjectInternals` can call it as a method.
pub use bun_event_loop::EventLoopTimer::{Kind, KindBig};

/// Sized to be the same as one pointer.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ID {
    pub id: i32,
    pub kind: KindBig,
}
impl Default for ID {
    fn default() -> Self {
        Self {
            id: 0,
            kind: KindBig::SetTimeout,
        }
    }
}
impl ID {
    #[inline]
    pub fn async_id(self) -> u64 {
        // Zig `@bitCast(extern struct { i32, u32 })`: 8 bytes, field order
        // `id` then `kind`. Reassemble via native-endian byte concat so the
        // value matches the prior bitcast on every supported target without
        // relying on struct-layout reinterpretation.
        let mut bytes = [0u8; 8];
        bytes[..4].copy_from_slice(&self.id.to_ne_bytes());
        bytes[4..].copy_from_slice(&(self.kind as u32).to_ne_bytes());
        u64::from_ne_bytes(bytes)
    }
    #[inline]
    pub fn repeats(self) -> bool {
        self.kind == KindBig::SetInterval
    }
}

const US_PER_S: i64 = bun_core::time::US_PER_S as i64;
const NS_PER_US: i64 = bun_core::time::NS_PER_US as i64;

// ported from: src/runtime/timer/Timer.zig
