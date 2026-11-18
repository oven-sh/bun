//! Calls between the host and WebAssembly, for functions of any type.

use core::ptr;

use bun_engine_asm::{Bank, Reg};
use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Place;
use bun_engine_wasm_format::{FuncIndex, ValType};

use crate::host::Interrupted;
use crate::instance::Instance;
use crate::interpreted::slot_count;
use crate::outcome::{Failure, Outcome};
use crate::slot;
use crate::suspension::Frames;
use crate::value::{Bits, HostCell, Reference};

/// What the stub that enters has below its frame pointer, and above the frame of the function.
pub struct EntryFrame;

impl EntryFrame {
    /// The `funcref`.
    pub const FUNCTION: i32 = -16;
    pub(crate) const VALUES: i32 = Self::FUNCTION - Registers::SIZE;
    pub const SIZE: u32 = Self::VALUES.unsigned_abs();
}

/// What a stub that calls the host has below its frame pointer at least.
pub struct ExitFrame;

impl ExitFrame {
    /// That of the import.
    pub const SLOT: i32 = -16;
    pub const SIZE: u32 = Self::SLOT.unsigned_abs();
}

/// Where stubs put the registers for arguments and results, by their numbers.
pub(crate) struct Registers;

impl Registers {
    const GPRS: i32 = 10;
    const FPRS: i32 = 8;
    pub(crate) const SIZE: i32 = Self::GPRS * 8 + Self::FPRS * 16;

    pub(crate) fn offset(reg: Reg) -> i32 {
        match reg.bank() {
            Bank::Gpr => i32::from(reg.gpr().number()) * 8,
            Bank::Fpr => Self::GPRS * 8 + i32::from(reg.fpr().number()) * 16,
        }
    }
}

/// The arguments or the results of a call. They are on the stack, where the collector finds them.
struct Values<'a> {
    types: &'a [ValType],
    places: Places<'a>,
}

enum Places<'a> {
    OfCompiledCode {
        places: &'a [Place],
        registers: *mut u8,
        /// The frame pointer of the callee.
        callee_frame: *mut u8,
    },
    /// From this one on.
    Slots(*mut u8),
    SlotsWithVectors(*mut u8),
}

impl<'a> Values<'a> {
    #[inline]
    fn in_slots(types: &'a [ValType], first: *mut u8) -> Self {
        let places = match slot_count(types) == types.len() {
            true => Places::Slots(first),
            false => Places::SlotsWithVectors(first),
        };
        Self { types, places }
    }

    #[inline]
    fn address(&self, index: usize) -> *mut u8 {
        match self.places {
            Places::OfCompiledCode {
                places,
                registers,
                callee_frame,
            } => match places[index] {
                Place::Register(reg) => registers.wrapping_add(Registers::offset(reg) as usize),
                Place::Stack(offset) => callee_frame.wrapping_add(offset as usize),
            },
            Places::Slots(first) => first.wrapping_add(index * 8),
            Places::SlotsWithVectors(first) => {
                first.wrapping_add(slot_count(&self.types[..index]) * 8)
            }
        }
    }
}

/// From WebAssembly.
pub struct Incoming<'a>(Values<'a>);

impl<'a> Incoming<'a> {
    /// # Safety
    /// Values of these types are in the slots from `first` on.
    #[inline]
    pub(crate) unsafe fn in_slots(types: &'a [ValType], first: *mut u8) -> Self {
        Self(Values::in_slots(types, first))
    }

    /// In terms of the module of the instance.
    pub fn types(&self) -> &'a [ValType] {
        self.0.types
    }

    #[inline]
    pub fn get(&self, index: usize) -> Bits {
        // SAFETY: a stub or compiled code put it there.
        unsafe { slot::read(self.0.address(index), self.0.types[index]) }
    }
}

/// To WebAssembly.
pub struct Outgoing<'a>(Values<'a>);

impl<'a> Outgoing<'a> {
    /// # Safety
    /// There is room for values of these types in the slots from `first` on.
    #[inline]
    pub(crate) unsafe fn in_slots(types: &'a [ValType], first: *mut u8) -> Self {
        Self(Values::in_slots(types, first))
    }

    /// In terms of the module of the instance.
    pub fn types(&self) -> &'a [ValType] {
        self.0.types
    }

    #[inline]
    pub fn set(&mut self, index: usize, value: Bits) {
        // SAFETY: a stub or the caller made room.
        unsafe { slot::write(self.0.address(index), self.0.types[index], value) };
    }
}

/// A call of an import.
pub struct HostCall<'a> {
    instance: &'a Instance,
    func: FuncIndex,
    fp: usize,
    arguments: Incoming<'a>,
    results: Outgoing<'a>,
}

impl<'a> HostCall<'a> {
    /// # Safety
    /// `fp` is the address of the innermost frame of an interpreter. The arguments are in the slots from `first` on,
    /// where there is room for the results.
    #[inline]
    pub(crate) unsafe fn in_slots(
        instance: &'a Instance,
        func: FuncIndex,
        fp: usize,
        first: *mut u8,
    ) -> Self {
        let ty = instance.module().func_type(func);
        Self {
            instance,
            func,
            fp,
            arguments: Incoming(Values::in_slots(ty.params, first)),
            results: Outgoing(Values::in_slots(ty.results, first)),
        }
    }

    /// The one that imports.
    pub fn instance(&self) -> &'a Instance {
        self.instance
    }

    pub fn func(&self) -> FuncIndex {
        self.func
    }

    /// What was given to [`Instance::link_host_function`].
    pub fn function(&self) -> (Reference, usize) {
        // SAFETY: it is in the cell of the instance, and does not change any more.
        let import = unsafe { &*self.instance.import(self.func) };
        (Reference(import.host_function), import.host_data)
    }

    pub fn arguments(&self) -> &Incoming<'a> {
        &self.arguments
    }

    /// Those that lead to the call, if they can be saved.
    pub fn frames(&self) -> Option<Frames<'a>> {
        // SAFETY: the frame of the stub, which is there during the call.
        unsafe { Frames::above(self.instance, self.func, self.fp) }
    }

    /// They may take the places of arguments.
    pub fn into_results(self) -> Outgoing<'a> {
        self.results
    }
}

/// The arguments and the results.
fn values_of(
    instance: &Instance,
    func: FuncIndex,
    registers: *mut u8,
    callee_frame: *mut u8,
) -> (Values<'_>, Values<'_>) {
    let ty = instance.module().func_type(func);
    let signature = instance.module().signature(func);
    let values = |types, places| Values {
        types,
        places: Places::OfCompiledCode {
            places,
            registers,
            callee_frame,
        },
    };
    (
        values(ty.params, &signature.params),
        values(ty.results, &signature.results),
    )
}

/// # Safety
/// The frame is that of the stub that enters a function of the instance.
unsafe fn callee_of(instance: &Instance, fp: usize) -> (HostCell, FuncIndex) {
    let place = fp.wrapping_add_signed(EntryFrame::FUNCTION as isize);
    // SAFETY: the caller's.
    let (callee, callable) = unsafe {
        let callee = ptr::with_exposed_provenance::<HostCell>(place).read();
        (callee, instance.engine().callable_of(callee))
    };
    (callee, instance.func_with_slot(callable.slot))
}

/// # Safety
/// For the stub that enters.
#[native_abi]
pub(crate) unsafe fn put_arguments(
    instance: &Instance,
    fp: usize,
    registers: *mut u8,
    callee_frame: *mut u8,
) -> Outcome {
    instance.store().set_top_frame(fp);
    // SAFETY: the caller's.
    let (function, func) = unsafe { callee_of(instance, fp) };
    let (arguments, _) = values_of(instance, func, registers, callee_frame);
    // SAFETY: the host has called the stub.
    unsafe {
        instance
            .engine()
            .host()
            .put_arguments(instance, function, fp, Outgoing(arguments))
    }
    .into()
}

/// # Safety
/// For the stub that enters.
#[native_abi]
pub(crate) unsafe fn take_results(
    instance: &Instance,
    fp: usize,
    registers: *mut u8,
    callee_frame: *mut u8,
) -> Outcome {
    instance.store().set_top_frame(fp);
    // SAFETY: the caller's.
    let (_, func) = unsafe { callee_of(instance, fp) };
    let (_, results) = values_of(instance, func, registers, callee_frame);
    // SAFETY: the host has called the stub.
    unsafe {
        instance
            .engine()
            .host()
            .take_results(instance, fp, Incoming(results))
    }
    .into()
}

/// The value tells whether to call the import again.
///
/// # Safety
/// For the stub that is in `slot`, in an import of the instance.
#[native_abi]
pub(crate) unsafe fn call_host(
    instance: &Instance,
    slot: usize,
    registers: *mut u8,
    fp: *mut u8,
) -> Outcome {
    instance.store().set_top_frame(fp.addr());
    let func = instance.func_with_slot(slot);
    let (arguments, results) = values_of(instance, func, registers, fp);
    let call = HostCall {
        instance,
        func,
        fp: fp.addr(),
        arguments: Incoming(arguments),
        results: Outgoing(results),
    };
    match instance.engine().host().call(call) {
        Ok(()) => Outcome::value(0),
        Err(Interrupted::Redirected) => Outcome::value(1),
        Err(Interrupted::Thrown) => Outcome::failure(Failure::THROWN),
        Err(Interrupted::Suspended) => Outcome::failure(Failure::SUSPENDED),
    }
}

/// # Safety
/// As above.
#[native_abi]
pub(crate) unsafe fn put_results(
    instance: &Instance,
    slot: usize,
    registers: *mut u8,
    fp: *mut u8,
    returned: u64,
) -> Outcome {
    instance.store().set_top_frame(fp.addr());
    let (_, results) = values_of(instance, instance.func_with_slot(slot), registers, fp);
    let host = instance.engine().host();
    // SAFETY: the host has jumped to the stub.
    unsafe { host.put_results(instance, returned, Outgoing(results)) }.into()
}
