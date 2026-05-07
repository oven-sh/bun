//! `jsc.EventLoopHandle` — non-owning reference to either the JS event loop or
//! the mini event loop.
//!
//! LAYERING: the type itself was relocated DOWN to
//! `bun_event_loop::any_event_loop` (see CYCLEBREAK.md §→event_loop) so that
//! tier-≤4 crates (`bun_spawn`, `bun_io`, `bun_install`, `bun_shell`) can name
//! it without a forward dep on `bun_jsc`. The `.js` arm there holds an erased
//! `*mut jsc::EventLoop` and dispatches through `JsEventLoopVTable` (registered
//! by `bun_runtime::init()`). Every method on the Zig spec —
//! `globalObject`/`stdout`/`stderr`/`bunVM`/`enter`/`exit`/`filePolls`/
//! `putFilePoll`/`enqueueTaskConcurrent`/`loop`/`pipeReadBuffer`/`ref`/`unref`/
//! `createNullDelimitedEnvMap`/`topLevelDir`/`env` — is implemented there.
//!
//! This file adds only the `bun_jsc`-tier pieces the lower crate could not
//! express without naming `VirtualMachine` / `jsc::EventLoop`:
//!   - the `*VirtualMachine` and `*jsc::EventLoop` arms of Zig
//!     `init(anytype)`, surfaced as `From` impls (orphan-rule-legal because
//!     `&VirtualMachine` / `&EventLoop` are local fundamental-covered types);
//!   - a typed `JsEventLoopHandleExt` extension trait that downcasts the
//!     erased `*mut ()` returns to their concrete jsc types.
//!
//! `cast(comptime tag)` is intentionally not ported: callers pattern-match on
//! the enum directly. `allocator()` is dropped per PORTING.md §Allocators
//! (non-AST crate uses the global mimalloc).

pub use bun_event_loop::any_event_loop::{
    EnteredEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr,
};

use crate::event_loop::EventLoop;
use crate::virtual_machine::VirtualMachine;
use crate::JSGlobalObject;

// ── `init(anytype)` jsc-tier arms ─────────────────────────────────────────
// Zig dispatched on `@TypeOf(context)`. The lower tier provides `init(*mut ())`
// (erased `*jsc.EventLoop`), `init_mini`, `from_any`, and `js_current`. The two
// arms below cover `*VirtualMachine` and `*jsc.EventLoop` for jsc-aware callers.

impl From<&'_ VirtualMachine> for EventLoopHandle {
    #[inline]
    fn from(vm: &VirtualMachine) -> Self {
        // `vm.event_loop()` returns the raw `*mut jsc::EventLoop` self-pointer
        // (never null once the VM is initialized).
        EventLoopHandle::init(vm.event_loop().cast::<()>())
    }
}

impl From<&'_ EventLoop> for EventLoopHandle {
    #[inline]
    fn from(el: &EventLoop) -> Self {
        EventLoopHandle::init((el as *const EventLoop as *mut EventLoop).cast::<()>())
    }
}

// ── typed downcasts for jsc-aware callers ─────────────────────────────────
// The lower-tier `EventLoopHandle::{global_object, bun_vm}` return erased
// `*mut ()` (they cannot name jsc types). jsc-tier callers use this trait to
// recover the concrete types.

pub trait JsEventLoopHandleExt {
    /// Typed [`EventLoopHandle::global_object`] — `Some` only for the `Js` arm.
    fn js_global_object(self) -> Option<*mut JSGlobalObject>;
    /// Typed [`EventLoopHandle::bun_vm`] — `Some` only for the `Js` arm.
    fn js_bun_vm(self) -> Option<*mut VirtualMachine>;
    /// Downcast the `Js` arm's erased owner back to `*mut jsc::EventLoop`.
    /// Panics on the `Mini` arm (matches Zig `cast(.js)`'s implicit assert).
    fn cast_js(self) -> *mut EventLoop;
}

impl JsEventLoopHandleExt for EventLoopHandle {
    #[inline]
    fn js_global_object(self) -> Option<*mut JSGlobalObject> {
        let p = self.global_object();
        (!p.is_null()).then(|| p.cast::<JSGlobalObject>())
    }

    #[inline]
    fn js_bun_vm(self) -> Option<*mut VirtualMachine> {
        let p = self.bun_vm();
        (!p.is_null()).then(|| p.cast::<VirtualMachine>())
    }

    #[inline]
    fn cast_js(self) -> *mut EventLoop {
        match self {
            EventLoopHandle::Js { owner, .. } => owner.cast::<EventLoop>(),
            EventLoopHandle::Mini(_) => unreachable!("EventLoopHandle::cast_js on Mini"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/EventLoopHandle.zig (180 lines)
//   confidence: high
//   notes:      type + all methods relocated to bun_event_loop::any_event_loop
//               (vtable-dispatched Js arm). This file re-exports and adds the
//               jsc-tier `init(anytype)` arms + typed downcasts only.
// ──────────────────────────────────────────────────────────────────────────
