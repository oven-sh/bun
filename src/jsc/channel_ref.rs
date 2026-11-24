//! Whether a `node:child_process` IPC channel holds the event loop, by the rules of Node's `Control`:
//! https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L559-L599

use core::cell::Cell;

use bun_io::{KeepAlive, js_vm_ctx};

/// A parent's is on the `SendQueue` of the channel. A child's is on its `VirtualMachine`, because its channel opens on first use.
#[derive(Default)]
pub struct ChannelRef {
    keep_alive: KeepAlive,
    /// `Control#refs`. A caller of `unrefCounted()` can take it below zero.
    refs: Cell<i32>,
    /// `Control#refExplicitlySet`: after `ref()` or `unref()` the count moves nothing.
    explicit: Cell<bool>,
    started: Cell<bool>,
}

impl ChannelRef {
    /// The reference that Node's `Pipe` has from the start in a parent. A child's has none: https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L181
    pub fn start(&self) {
        self.started.set(true);
        self.hold(true);
    }

    pub fn is_started(&self) -> bool {
        self.started.get()
    }

    /// `Control#ref()` and `Control#unref()`.
    pub fn set(&self, enabled: bool) {
        self.explicit.set(true);
        self.hold(enabled);
    }

    /// `delta` calls of `Control#refCounted()`, or of `Control#unrefCounted()` if it is negative.
    pub fn add_counted(&self, delta: i32) {
        let before = self.refs.get();
        let after = before.wrapping_add(delta);
        self.refs.set(after);
        if self.explicit.get() {
            return;
        }
        // Node refs on the call that counts up to 1 and unrefs on the call that counts down to 0.
        if before < 1 && after >= 1 {
            self.hold(true);
        } else if before > 0 && after <= 0 {
            self.hold(false);
        }
    }

    /// The channel is closed: it holds nothing from here on, whatever is called.
    pub fn disable(&self) {
        self.keep_alive.disable();
    }

    fn hold(&self, enabled: bool) {
        if enabled {
            self.keep_alive.ref_(js_vm_ctx());
        } else {
            self.keep_alive.unref(js_vm_ctx());
        }
    }
}
