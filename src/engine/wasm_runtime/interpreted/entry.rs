//! Calls from the host.

use core::mem::offset_of;
use core::num::NonZeroUsize;

use bun_engine_wasm_compiler::abi::{ENTRY_CALLEE, Trap, func_of};
use bun_engine_wasm_format::{FuncIndex, FuncType};

use super::{Callee, Context, Frame, Site, Slots, slot_count};
use crate::call::{Incoming, Outgoing};
use crate::engine::Engine;
use crate::host::Thrown;
use crate::instance::Instance;
use crate::outcome::Failure;
use crate::suspension::{Record, Saved};
use crate::value::HostCell;

/// Of the innermost frame, in which the host calls. The frame of the entry is seen in its place.
#[derive(Clone, Copy)]
pub struct Linkage {
    pub frame: usize,
    pub caller: usize,
    pub return_address: usize,
}

pub struct Entry<'a> {
    context: Context<'a>,
    function: HostCell,
    func: FuncIndex,
    linkage: Linkage,
}

impl<'a> Entry<'a> {
    /// # Safety
    /// `function` is a `funcref` of this thread that lives for `'a`, and the host could call compiled code here.
    ///
    /// Only an interpreter gets the result, which does what the validated code of the modules says. So operands have
    /// the types that validation has found, offsets are those of the layouts for what the instruction names, a
    /// [`super::View`] is not used after anything that can make a memory grow, and what a frame gives access to is
    /// not used after the frame has been handed over.
    #[inline]
    pub unsafe fn new(
        engine: &Engine,
        function: HostCell,
        linkage: Linkage,
    ) -> Result<Self, Thrown> {
        // SAFETY: the caller's.
        let (callable, instance) = unsafe {
            let callable = engine.callable_of(function);
            (callable, Instance::of_callable(engine, &callable))
        };
        let Some(stack) = instance.store().value_stack() else {
            engine.host().throw_trap(instance, Trap::OutOfMemory);
            return Err(Thrown);
        };
        Ok(Self {
            context: Context::new(instance, stack),
            function,
            func: instance.func_with_slot(callable.slot),
            linkage,
        })
    }

    #[inline]
    pub fn context(&self) -> &Context<'a> {
        &self.context
    }

    #[inline]
    pub fn callee(&self) -> Callee<'a> {
        let (instance, func) = (self.context.instance, self.func);
        Callee { instance, func }
    }

    /// For what fails before there is a frame.
    pub fn throw(&self, trap: Trap) -> Thrown {
        let instance = self.context.instance;
        instance.engine().host().throw_trap(instance, trap);
        Thrown
    }

    /// `run` gets the frame of the entry, leaves the results in its first slots, and leaves no trap to be raised.
    /// `None` if the call is suspended.
    #[inline(always)]
    fn in_frame<T, R>(
        &self,
        data: T,
        run: impl FnOnce(&Frame<'a, T>, FuncType<'a>) -> Result<(), Failure>,
        take: impl FnOnce(Incoming<'_>) -> Result<R, Thrown>,
    ) -> Result<Option<R>, Thrown> {
        let cx = &self.context;
        let base = cx.in_use.get();
        let slots = cx.values.get(base..).and_then(<[_]>::first_chunk);
        let slots: &Slots = slots.ok_or_else(|| self.throw(Trap::StackOverflow))?;
        let linkage = [self.linkage.caller, self.linkage.return_address];
        let frame = EntryFrame {
            function: self.function,
            frame: Frame::new(linkage, cx.cell, ENTRY_CALLEE, slots, data),
        };
        const { assert!(offset_of!(EntryFrame<'a, T>, frame) == size_of::<HostCell>()) };
        let frame = &frame.frame;
        cx.set_top_frame(frame.address());
        let ty = cx.module().func_type(self.func);
        let outcome = match run(frame, ty) {
            Ok(()) => {
                cx.keep(slots, slot_count(ty.results));
                // SAFETY: a window has room for them.
                take(unsafe { Incoming::in_slots(ty.results, first_byte(slots)) }).map(Some)
            }
            Err(Failure::SUSPENDED) => Ok(None),
            Err(failure) => {
                assert!(failure == Failure::THROWN);
                Err(Thrown)
            }
        };
        cx.in_use.set(base);
        cx.set_top_frame(self.linkage.frame);
        outcome
    }

    /// `put` sets every argument to a value of its type.
    #[inline(always)]
    pub fn call<T, R>(
        &self,
        data: T,
        put: impl FnOnce(Outgoing<'_>) -> Result<(), Thrown>,
        run: impl FnOnce(&Frame<'a, T>) -> Result<(), Failure>,
        take: impl FnOnce(Incoming<'_>) -> Result<R, Thrown>,
    ) -> Result<Option<R>, Thrown> {
        let start = |frame: &Frame<'a, T>, ty: FuncType<'a>| {
            self.context.keep(frame.slots(), slot_count(ty.params));
            // SAFETY: a window has room for them.
            put(unsafe { Outgoing::in_slots(ty.params, first_byte(frame.slots())) })?;
            run(frame)
        };
        self.in_frame(data, start, take)
    }
}

/// What it takes to go on after a suspension is just below the frame.
#[repr(C)]
struct EntryFrame<'a, T> {
    function: HostCell,
    frame: Frame<'a, T>,
}

fn first_byte(slots: &Slots) -> *mut u8 {
    slots.as_ptr().cast::<u8>().cast_mut()
}

/// A call that was suspended.
pub struct Parked<'a> {
    entry: Entry<'a>,
    saved: Saved<'a>,
}

impl<'a> Parked<'a> {
    /// # Safety
    /// As for [`Entry::new`]. The words are from [`crate::suspension::Frames::save`] on this thread, have not been
    /// used for this before, and what they refer to is alive.
    pub unsafe fn new(
        engine: &Engine,
        words: &'a [usize],
        linkage: Linkage,
    ) -> Result<Self, Thrown> {
        let saved = Saved::new(words);
        // SAFETY: the caller's.
        let entry = unsafe { Entry::new(engine, saved.function(), linkage) }?;
        Ok(Self { entry, saved })
    }

    pub fn entry(&self) -> &Entry<'a> {
        &self.entry
    }

    /// Of functions.
    pub fn frame_count(&self) -> usize {
        self.saved.record_count() - 1
    }

    /// Counting from the outermost, the function that a frame is for, the first of its slots, and where its caller
    /// goes on. After those of functions comes that of the import which has suspended the call. They may be gone
    /// after the next collection unless the frames are there again.
    pub fn frame(&self, index: usize) -> (Callee<'a>, u32, Site) {
        let Record([instance, callee, site, first]) = self.saved.record(index);
        let engine = self.entry.context.instance.engine();
        let cell = NonZeroUsize::new(instance).map(HostCell);
        // SAFETY: the promise of the maker.
        let instance = cell.and_then(|it| unsafe { Instance::of_cell(engine, it) });
        let (instance, func) = (instance.expect("it had one"), func_of(callee as u32));
        (Callee { instance, func }, first as u32, site)
    }

    /// `run` finds the slots as they were.
    pub fn resume<T, R>(
        &self,
        data: T,
        run: impl FnOnce(&Frame<'a, T>) -> Result<(), Failure>,
        take: impl FnOnce(Incoming<'_>) -> Result<R, Thrown>,
    ) -> Result<Option<R>, Thrown> {
        let start = |frame: &Frame<'a, T>, _| {
            let (cx, saved) = (&self.entry.context, self.saved.values());
            let Some(slots) = cx.range(frame.slots(), 0, saved.len()) else {
                return Err(self.entry.throw(Trap::StackOverflow).into());
            };
            (slots.iter().zip(saved)).for_each(|(slot, &value)| slot.set(value as u64));
            cx.keep(frame.slots(), saved.len());
            run(frame)
        };
        self.entry.in_frame(data, start, take)
    }
}

impl<'a> Context<'a> {
    /// Ends the call of the host that was suspended. `put` sets every result to a value of its type.
    pub fn end_host_call<T>(
        &self,
        frame: &Frame<'a, T>,
        Callee { instance, func }: Callee<'a>,
        put: impl FnOnce(&Instance, Outgoing<'_>) -> Result<(), Thrown>,
    ) -> Result<(), Failure> {
        let results = instance.module().func_type(func).results;
        frame.turn_into_stub(instance);
        self.keep(frame.slots(), slot_count(results));
        // SAFETY: a window has room for them.
        let results = unsafe { Outgoing::in_slots(results, first_byte(frame.slots())) };
        Ok(put(instance, results)?)
    }
}
