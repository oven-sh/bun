use core::marker::PhantomData;

use bun_io::{EventLoopCtx, KeepAlive};

use crate::Vm;
use crate::virtual_machine::VirtualMachine;

/// A [`KeepAlive`] on the JS thread's loop, released when it drops.
#[derive(Default)]
pub struct JsKeepAlive(KeepAlive, PhantomData<*mut ()>);

impl JsKeepAlive {
    pub fn active(vm: &VirtualMachine) -> Self {
        let this = Self::default();
        this.ref_(vm);
        this
    }

    pub fn is_active(&self) -> bool {
        self.0.is_active()
    }

    pub fn ref_(&self, vm: &VirtualMachine) {
        self.0.ref_(vm.loop_ctx());
    }

    pub fn unref(&self) {
        if let Some(armed_on) = self.armed_on() {
            self.0.unref(armed_on);
        }
    }

    pub fn unref_on_next_tick(&self) {
        if let Some(armed_on) = self.armed_on() {
            self.0.unref_on_next_tick(armed_on);
        }
    }

    pub fn disable(&self) {
        self.unref();
        self.0.disable_inactive();
    }

    fn armed_on(&self) -> Option<EventLoopCtx> {
        // SAFETY: arming took this thread's VM, and `self` cannot leave the thread. None is armed any more when
        // teardown frees the loop.
        self.is_active()
            .then(|| unsafe { Vm::assume(self) }.bun_vm().loop_ctx())
    }
}

impl Drop for JsKeepAlive {
    fn drop(&mut self) {
        self.unref();
    }
}
