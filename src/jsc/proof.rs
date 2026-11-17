//! What it takes to reach this thread's VM, and to run script.
//!
//! A method says `self: &Js<Self>` or `self: &Vm<Self>`, whichever is the weaker that it needs. Where no shared
//! reference can carry the proof, it is a parameter: `js: Js`. It starts at a global object, `cx`, `heap`, the receiver
//! of a binding or a parameter of a `HOST_EXPORT`. `assume` is for where C calls in, a thread starts, and `Drop`.

use core::marker::PhantomData;
use core::ops::Deref;

use bun_core::Loop;
use bun_core::proof::{Pointer, Proof};

use crate::virtual_machine::VirtualMachine;

/// This thread has a VM, which stays allocated.
#[fundamental]
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Vm<'a, T = ()>(PhantomData<(&'a (), *mut ())>, T);

impl<T> Deref for Vm<'_, T> {
    type Target = T;
    #[inline(always)]
    fn deref(&self) -> &T {
        &self.1
    }
}

// SAFETY: see the struct.
unsafe impl<'a, T> Proof for Vm<'a, T> {
    type Of = T;
    type On<U> = Vm<'a, U>;
}

impl<'a> Vm<'a> {
    /// # Safety
    /// `VirtualMachine::init` has installed a VM and its `RuntimeState` on this thread. What is reached through the
    /// proof is allocated. While `scope` is borrowed, only a call after which no proof of the thread is used frees it.
    /// This may be inside an allocation, a sweep or `~VM`. After `~VM`, teardown frees the loop, then the
    /// `RuntimeState`, then the VM.
    #[inline(always)]
    pub unsafe fn assume<S: ?Sized>(_scope: &'a S) -> Self {
        Self(PhantomData, ())
    }
}

impl<'a, T> Vm<'a, T> {
    #[inline(always)]
    pub fn as_vm(&self) -> Vm<'a> {
        Vm(PhantomData, ())
    }

    #[inline(always)]
    pub fn bun_vm(&self) -> &'a VirtualMachine {
        // SAFETY: allocated for `'a`.
        unsafe { &*VirtualMachine::get_mut_ptr(self.as_vm()) }
    }

    /// The same proof on something else.
    #[inline(always)]
    pub fn on<'b, P: Pointer<'b>>(&self, p: P) -> P::To<Vm<'b, P::Of>>
    where
        'a: 'b,
    {
        // SAFETY: `self` is the proof.
        unsafe { p.cast() }
    }
}

/// Script may run here.
#[fundamental]
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct Js<'a, T = ()>(Vm<'a, T>);

impl<'a, T> Deref for Js<'a, T> {
    type Target = Vm<'a, T>;
    #[inline(always)]
    fn deref(&self) -> &Vm<'a, T> {
        &self.0
    }
}

// SAFETY: see the struct.
unsafe impl<'a, T> Proof for Js<'a, T> {
    type Of = T;
    type On<U> = Js<'a, U>;
}

impl<'a> Js<'a> {
    /// # Safety
    /// As [`Vm::assume`] and [`Loop::assume`].
    #[inline(always)]
    pub unsafe fn assume<S: ?Sized>(_scope: &'a S) -> Self {
        Self(Vm(PhantomData, ()))
    }
}

impl<'a, T> Js<'a, T> {
    #[inline(always)]
    pub fn js(&self) -> Js<'a> {
        Js(self.as_vm())
    }

    #[inline(always)]
    pub fn as_loop(&self) -> Loop<'a> {
        // SAFETY: `self` proves more.
        unsafe { Loop::assume(&()) }
    }

    #[inline(always)]
    pub fn bun_vm(&self) -> &'a Js<'a, VirtualMachine> {
        self.on(self.as_vm().bun_vm())
    }

    /// The same proof on something else.
    #[inline(always)]
    pub fn on<'b, P: Pointer<'b>>(&self, p: P) -> P::To<Js<'b, P::Of>>
    where
        'a: 'b,
    {
        // SAFETY: `self` is the proof.
        unsafe { p.cast() }
    }
}
