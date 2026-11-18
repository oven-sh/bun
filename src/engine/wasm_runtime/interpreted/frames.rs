//! Frames on the native stack that the host walks like those of compiled code.

use core::cell::Cell;
use core::mem::offset_of;
use core::num::NonZeroUsize;
use core::ptr;
use core::sync::atomic::{Ordering, compiler_fence};

use bun_engine_wasm_compiler::abi::{ENTRY_CALLEE, STUB_CALLEE, Trap, callee_word, frame, func_of};
use bun_engine_wasm_format::FuncIndex;

use super::{Callee, Context, Slots};
use crate::instance::Instance;
use crate::outcome::{Decoded, Failure};
use crate::value::HostCell;

/// Where a function goes on after a call. It is not zero, and means something to the interpreter only.
pub type Site = usize;

#[repr(C)]
pub(crate) struct Header {
    pub(crate) caller: Cell<usize>,
    pub(crate) return_address: Cell<Site>,
    pub(crate) instance: Cell<usize>,
    pub(crate) callee: Cell<u64>,
    /// The address of the `Slots`.
    pub(crate) slots: usize,
}

/// A chain of them, all with the same type of data, ends in that of an [`super::Entry`].
#[repr(C)]
pub struct Frame<'a, T> {
    caller: Cell<usize>,
    return_address: Cell<Site>,
    instance: Cell<usize>,
    callee: Cell<u64>,
    slots: &'a Slots,
    data: T,
}

const _: () = {
    assert!(offset_of!(Header, instance) == frame::INSTANCE as usize);
    assert!(offset_of!(Header, callee) == frame::CALLEE as usize);
    assert!(offset_of!(Header, instance) == offset_of!(Frame<'_, u64>, instance));
    assert!(offset_of!(Header, callee) == offset_of!(Frame<'_, u64>, callee));
    assert!(offset_of!(Header, slots) == offset_of!(Frame<'_, u64>, slots));
};

impl<T> core::ops::Deref for Frame<'_, T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        &self.data
    }
}

impl<'a, T> Frame<'a, T> {
    #[inline(always)]
    pub(super) fn new(
        [caller, return_address]: [usize; 2],
        instance: HostCell,
        callee: u32,
        slots: &'a Slots,
        data: T,
    ) -> Self {
        Self {
            caller: Cell::new(caller),
            return_address: Cell::new(return_address),
            instance: Cell::new(instance.address()),
            callee: Cell::new(callee.into()),
            slots,
            data,
        }
    }

    #[inline(always)]
    pub(super) fn address(&self) -> usize {
        ptr::from_ref(self).expose_provenance()
    }

    #[inline(always)]
    pub fn slots(&self) -> &'a Slots {
        self.slots
    }

    /// Of the frame of a function.
    #[inline]
    pub fn func(&self) -> FuncIndex {
        func_of(self.callee.get() as u32)
    }

    /// With the place where it goes on. `None` if the host has called.
    #[inline]
    pub fn caller(&self) -> Option<(&Self, Site)> {
        let is_entry = |frame: &Self| frame.callee.get() == ENTRY_CALLEE.into();
        if is_entry(self) {
            return None;
        }
        // SAFETY: what makes a frame takes such a caller, which outlives it.
        let caller = unsafe { &*ptr::with_exposed_provenance::<Self>(self.caller.get()) };
        (!is_entry(caller)).then(|| (caller, self.return_address.get()))
    }

    /// For another function of the same instance.
    #[inline(always)]
    pub fn reuse_for(&self, func: FuncIndex) {
        self.callee.set(callee_word(func).into());
    }

    /// For any function. To be returned to whoever has made the frame, who finds it with [`Context::successor`].
    pub fn hand_over(&self, callee: Callee<'a>) -> Failure {
        self.instance.set(callee.instance.cell().address());
        self.reuse_for(callee.func);
        Failure::REPLACED
    }

    pub(super) fn turn_into_stub(&self, instance: &Instance) {
        self.instance.set(instance.cell().address());
        self.callee.set(STUB_CALLEE.into());
    }
}

impl<'a> Context<'a> {
    #[inline(always)]
    pub(super) fn set_top_frame(&self, address: usize) {
        // A profiler that stops the thread finds the frame complete.
        compiler_fence(Ordering::Release);
        // SAFETY: the word of the VM.
        unsafe { self.top_frame.write(address) };
    }

    #[inline(always)]
    fn in_frame<'f, T, R>(
        &self,
        caller: &'f Frame<'a, T>,
        site: Site,
        callee: u32,
        slots: &'a Slots,
        data: T,
        run: impl FnOnce(&Frame<'a, T>) -> R,
    ) -> (R, &'f Frame<'a, T>) {
        let frame = Frame::new([caller.address(), site], self.cell, callee, slots, data);
        self.set_top_frame(frame.address());
        let result = run(&frame);
        // SAFETY: `caller`, which does not have to be saved a second time.
        (result, unsafe {
            &*ptr::with_exposed_provenance(frame.caller.get())
        })
    }

    /// Runs a function of this instance, and gives `caller` back. [`Context::return_to`] has to follow.
    #[inline(always)]
    pub fn call<'f, T, R>(
        &self,
        caller: &'f Frame<'a, T>,
        site: Site,
        func: FuncIndex,
        slots: &'a Slots,
        data: T,
        run: impl FnOnce(&Frame<'a, T>) -> R,
    ) -> (R, &'f Frame<'a, T>) {
        self.in_frame(caller, site, callee_word(func), slots, data, run)
    }

    #[inline(always)]
    pub fn return_to<T>(&self, caller: &Frame<'a, T>) {
        self.set_top_frame(caller.address());
    }

    /// In a frame for no function, which tells the host where `caller` is.
    #[inline]
    pub fn call_out<T, R>(
        &self,
        caller: &Frame<'a, T>,
        site: Site,
        slots: &'a Slots,
        data: T,
        run: impl FnOnce(&Frame<'a, T>) -> R,
    ) -> R {
        let (result, caller) = self.in_frame(caller, site, STUB_CALLEE, slots, data, run);
        self.return_to(caller);
        result
    }

    /// Runs a function of this instance as if the caller of `old` had called it. If that hands over in its turn,
    /// `old` tells to whom.
    pub fn call_in_place_of<T, R>(
        &self,
        old: &Frame<'a, T>,
        func: FuncIndex,
        data: T,
        run: impl FnOnce(&Frame<'a, T>) -> R,
    ) -> R {
        let linkage = [old.caller.get(), old.return_address.get()];
        let frame = Frame::new(linkage, self.cell, callee_word(func), old.slots, data);
        self.set_top_frame(frame.address());
        let result = run(&frame);
        old.instance.set(frame.instance.get());
        old.callee.set(frame.callee.get());
        self.set_top_frame(old.address());
        result
    }

    fn instance_of<T>(&self, frame: &Frame<'a, T>) -> &'a Instance {
        let cell = NonZeroUsize::new(frame.instance.get()).map(HostCell);
        // SAFETY: the frame keeps it alive.
        let instance = cell.and_then(|it| unsafe { Instance::of_cell(self.instance.engine(), it) });
        instance.expect("a frame has an instance")
    }

    /// See [`Frame::hand_over`].
    pub fn successor<T>(&self, frame: &Frame<'a, T>) -> Callee<'a> {
        let (instance, func) = (self.instance_of(frame), frame.func());
        Callee { instance, func }
    }

    /// Whether [`Context::check`] is due, at the entry of a function and at a jump backwards.
    #[inline(always)]
    pub fn must_check<T>(&self, frame: &Frame<'a, T>) -> bool {
        ptr::from_ref(frame).addr() < self.entry_limit.load(Ordering::Relaxed)
    }

    pub fn has_room<T>(&self, frame: &Frame<'a, T>) -> bool {
        frame.address() >= self.instance.store().stack_limit()
    }

    /// For room on the stack and for what other threads ask. After [`Context::keep`].
    pub fn check<T>(&self, frame: &Frame<'a, T>) -> Result<(), Failure> {
        if !self.has_room(frame) {
            return Err(Trap::StackOverflow.into());
        }
        // SAFETY: inside the call of an entry.
        Ok(unsafe { self.instance.engine().host().interrupt(self.instance) }?)
    }

    /// Makes the host throw for a trap in the innermost frame. Other failures stay as they are.
    pub fn raise<T>(&self, frame: &Frame<'a, T>, failure: Failure) -> Failure {
        let Decoded::Trap(trap) = failure.decode() else {
            return failure;
        };
        let host = self.instance.engine().host();
        host.throw_trap(self.instance_of(frame), trap);
        Failure::THROWN
    }
}
