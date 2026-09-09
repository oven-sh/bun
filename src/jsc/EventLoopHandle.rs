//! `jsc.EventLoopHandle` — non-owning reference to either the JS event loop or
//! the mini event loop.
//!
//! LAYERING: many tier-≤4 crates (`bun_install`, `bun_spawn`, `bun_shell`)
//! need `EventLoopHandle` without pulling in `bun_jsc`, so the type lives in
//! [`bun_event_loop::any_event_loop`] (`src/event_loop/AnyEventLoop.rs`),
//! where the `.js` arm holds an erased `*mut ()` and dispatches through
//! link-time `extern "Rust"` shims defined in `bun_jsc::event_loop`.
//!
//! This module is the thin shim that keeps the `bun_jsc::event_loop_handle`
//! path compiling. All behaviour lives in the lower crate; nothing here owns
//! logic.

pub use bun_event_loop::any_event_loop::{EnteredEventLoop, EventLoopHandle, EventLoopTask};

use crate::JSGlobalObject;
use crate::virtual_machine::VirtualMachine;

/// The typed JS side of an [`EventLoopHandle`] (the lower crate only has the
/// erased pointers).
pub trait EventLoopHandleJs {
    /// The VM this handle's loop belongs to; `None` for a mini loop.
    fn js_vm(&self) -> Option<&'static VirtualMachine>;
    /// That VM's global; `None` for a mini loop.
    fn js_global(&self) -> Option<&'static JSGlobalObject>;
}

impl EventLoopHandleJs for EventLoopHandle {
    #[inline]
    fn js_vm(&self) -> Option<&'static VirtualMachine> {
        let vm = self.bun_vm().cast::<VirtualMachine>();
        // SAFETY: for the `Js` arm this is the owning `jsc::EventLoop`'s VM,
        // the per-thread singleton that outlives every handle to its loop (the
        // same pointer `VirtualMachine::get()` hands out as `&'static`); null
        // only for the never-dispatched placeholder handle.
        (!vm.is_null()).then(|| unsafe { &*vm })
    }
    #[inline]
    fn js_global(&self) -> Option<&'static JSGlobalObject> {
        let global = self.global_object();
        (!global.is_null()).then(|| JSGlobalObject::opaque_ref(global.cast()))
    }
}
