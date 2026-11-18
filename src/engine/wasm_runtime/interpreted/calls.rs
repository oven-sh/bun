//! Finding what a call leads to, and calling the host.

use core::cell::Cell;
use core::ptr;

use bun_engine_wasm_compiler::abi::{Callable, FunctionElement, FunctionSlot, TableView, Trap};
use bun_engine_wasm_format::{FuncIndex, Rtt};

use super::{Context, Frame, slot_count};
use crate::call::HostCall;
use crate::host::Interrupted;
use crate::instance::Instance;
use crate::outcome::Failure;
use crate::value::Reference;

/// A function that the instance defines, or has from the host.
#[derive(Clone, Copy)]
pub struct Callee<'a> {
    pub(super) instance: &'a Instance,
    pub(super) func: FuncIndex,
}

impl<'a> Callee<'a> {
    pub fn instance(self) -> &'a Instance {
        self.instance
    }

    pub fn func(self) -> FuncIndex {
        self.func
    }

    pub fn is_of_host(self) -> bool {
        self.func.0 < self.instance.module().imported().funcs
    }
}

impl<'a> Context<'a> {
    /// That of the instance of the callee.
    pub fn of(&self, callee: Callee<'a>) -> Self {
        let stack = callee.instance.store().existing_value_stack();
        Self::new(callee.instance, stack)
    }

    #[inline]
    pub fn import(&self, func: FuncIndex) -> Callable {
        // SAFETY: it is in the cell.
        unsafe { (*self.instance.import(func)).callable }
    }

    /// With the offset of the view of the table, and the address of the type that the function has to have.
    #[inline(always)]
    pub fn element(&self, table: u32, index: u64, expected: u64) -> Result<Callable, Trap> {
        // SAFETY: the view of a table of functions.
        let callable = unsafe {
            let view = &*self.cell.field::<TableView>(table as i32);
            if index >= view.length {
                return Err(Trap::IndirectCallOutOfBounds);
            }
            let elements = ptr::with_exposed_provenance::<FunctionElement>(view.elements);
            (*elements.add(index as usize)).callable
        };
        // SAFETY: an instance keeps the types of its module.
        if callable.rtt as u64 != expected && !unsafe { is_subtype(callable.rtt, expected) } {
            return Err(Trap::SignatureMismatch);
        }
        Ok(callable)
    }

    #[inline]
    pub fn referenced_function(&self, function: u64) -> Result<Callable, Trap> {
        let function = Reference(function).cell().ok_or(Trap::NullFunction)?;
        // SAFETY: validated.
        let callable = unsafe { self.instance.engine().callable_of(function) };
        // What the translation of a module has to have got right: the value is a reference to a function, and the
        // run time has filled in what it is. Assertions turn a mistake into a panic.
        debug_assert!(
            callable.instance != 0 && callable.rtt != 0,
            "a reference to no function"
        );
        Ok(callable)
    }

    /// The index of the function if this instance defines it. Otherwise `None`, or the index of none that it defines.
    #[inline(always)]
    pub fn defined_function(&self, callable: &Callable) -> Option<usize> {
        let distance = callable.slot.wrapping_sub(self.first_function_slot);
        (callable.instance == self.cell.address()).then_some(distance / FunctionSlot::SIZE)
    }

    /// With what one of the above has just given.
    pub fn callee(&self, callable: &Callable) -> Callee<'a> {
        // SAFETY: what has the callable keeps the instance until a frame does.
        let instance = unsafe { Instance::of_callable(self.instance.engine(), callable) };
        let func = instance.func_with_slot(callable.slot);
        Callee { instance, func }
    }

    /// The arguments are in the first slots of the frame, which is for no function from now on, and the results take
    /// their places.
    pub fn call_host<T>(&self, frame: &Frame<'a, T>, callee: Callee<'a>) -> Result<(), Failure> {
        let Callee { instance, func } = callee;
        let ty = instance.module().func_type(func);
        let values = frame.slots();
        frame.turn_into_stub(instance);
        self.keep(values, slot_count(ty.params).max(slot_count(ty.results)));
        if let Some(function) = instance.native_import(func) {
            let [first, second, third] = [0, 1, 2].map(|index| values[index].get());
            // SAFETY: it was linked for the type.
            let outcome = unsafe { function(first, second, third, instance.cell()) };
            return outcome.into_result().map(|result| values[0].set(result));
        }
        let first = values.as_ptr().cast::<Cell<u8>>().cast_mut().cast();
        // SAFETY: a window has room for as many values as a function can take or give.
        let call = unsafe { HostCall::in_slots(instance, func, frame.address(), first) };
        match instance.engine().host().call(call) {
            Ok(()) => Ok(()),
            Err(Interrupted::Thrown) => Err(Failure::THROWN),
            Err(Interrupted::Suspended) => Err(Failure::SUSPENDED),
            Err(Interrupted::Redirected) => unreachable!("there are no stubs"),
        }
    }
}

/// # Safety
/// The addresses of types, or zero for the first.
#[inline]
unsafe fn is_subtype(actual: usize, expected: u64) -> bool {
    // SAFETY: the caller's.
    unsafe {
        let actual = ptr::with_exposed_provenance::<Rtt>(actual).as_ref();
        actual.is_some_and(|it| it.is_subtype_of(&*ptr::with_exposed_provenance(expected as usize)))
    }
}
