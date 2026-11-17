//! What it takes to reach this thread's VM, and to run script.
//!
//! A method says `self: &Js<Self>` or `self: &Vm<Self>`, whichever is the weaker that it needs. Where no shared
//! reference can carry the proof, it is a parameter: `js: Js`. It starts at a global object, `cx`, `heap`, the receiver
//! of a binding or a parameter of a `HOST_EXPORT`. `assume` is for where C calls in, a thread starts, and `Drop`.

use bun_core::Loop;

use crate::virtual_machine::VirtualMachine;

bun_core::proof! {
    /// This thread has a VM, which stays allocated.
    Vm, as_vm => unsafe T;
    /// `VirtualMachine::init` has installed a VM and its `RuntimeState` on this thread. What is reached through the
    /// proof is allocated. While `scope` is borrowed, only a call after which no proof of the thread is used frees it.
    /// This may be inside an allocation, a sweep or `~VM`. After `~VM`, teardown frees the loop, then the
    /// `RuntimeState`, then the VM.
}

bun_core::proof! {
    /// Script may run here.
    Js, js => unsafe Vm<'a, T>;
    /// As [`Vm::assume`] and [`Loop::assume`].
}

impl<'a, T> Vm<'a, T> {
    #[inline(always)]
    pub fn bun_vm(&self) -> &'a VirtualMachine {
        // SAFETY: allocated for `'a`.
        unsafe { &*VirtualMachine::get_mut_ptr(self.as_vm()) }
    }
}

impl<'a, T> Js<'a, T> {
    #[inline(always)]
    pub fn as_loop(&self) -> Loop<'a> {
        // SAFETY: `self` proves more.
        unsafe { Loop::assume(&()) }
    }

    #[inline(always)]
    pub fn bun_vm(&self) -> &'a Js<'a, VirtualMachine> {
        self.on(self.as_vm().bun_vm())
    }
}
