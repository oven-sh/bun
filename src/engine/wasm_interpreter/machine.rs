//! The registers of the interpreter, and how one handler gets to the next.

use core::cell::Cell;

use bun_engine_wasm_format::{FuncIndex, OutOfMemory};
use bun_engine_wasm_runtime::Outcome;
use bun_engine_wasm_runtime::interpreted::{self, Context, Slots, View};

use crate::code::{Code, Functions, Op, Pc, existing_functions, make_functions};
use crate::translate::translate;

/// Runs the rest of the function.
pub(crate) type Handler = for<'a, 'f> extern "rust-preserve-none" fn(
    Pc<'a>,
    &'a Slots,
    View,
    &'f Frame<'a, 'f>,
    &'f Cx<'a>,
    u64,
    f32,
    f64,
) -> Outcome;

pub(crate) type Frame<'a, 'f> = interpreted::Frame<'a, Running<'a, 'f>>;

pub(crate) struct Running<'a, 'f> {
    pub(crate) ops: Cell<&'a [Op]>,
    pub(crate) cx: &'f Cx<'a>,
}

impl<'a, 'f> Running<'a, 'f> {
    #[inline(always)]
    pub(crate) fn new(ops: &'a [Op], cx: &'f Cx<'a>) -> Self {
        let ops = Cell::new(ops);
        Self { ops, cx }
    }

    /// For a frame that is not that of a function.
    #[inline(always)]
    pub(crate) fn nothing(cx: &'f Cx<'a>) -> Self {
        Self::new(&[], cx)
    }
}

pub(crate) struct Cx<'a> {
    context: Context<'a>,
    functions: &'a Functions,
}

impl<'a> core::ops::Deref for Cx<'a> {
    type Target = Context<'a>;

    #[inline(always)]
    fn deref(&self) -> &Context<'a> {
        &self.context
    }
}

impl<'a> Cx<'a> {
    #[inline]
    pub(crate) fn new(context: Context<'a>) -> Result<Self, OutOfMemory> {
        let module = context.module();
        let functions = existing_functions(module).map_or_else(|| make_functions(module), Ok)?;
        Ok(Self { context, functions })
    }

    #[inline(always)]
    pub(crate) fn existing_code(&self, func: usize) -> Option<&'a Code> {
        self.functions.get(func)?.get()
    }

    /// Of a function that the module defines.
    #[inline]
    pub(crate) fn code(&self, func: FuncIndex) -> Result<&'a Code, OutOfMemory> {
        (self.existing_code(func.usize())).map_or_else(|| self.make_code(func), Ok)
    }

    #[cold]
    fn make_code(&self, func: FuncIndex) -> Result<&'a Code, OutOfMemory> {
        let code = translate(self.module(), func)?;
        let (place, size) = (&self.functions[func.usize()], code.size_in_bytes());
        if place.set(code).is_ok() {
            self.did_translate(size);
        }
        Ok(place.get().expect("by this thread or another"))
    }
}

/// An `i32` or `f32` has zeros in the upper half of its slot.
pub(crate) struct Machine<'a, 'f> {
    pub(crate) pc: Pc<'a>,
    pub(crate) slots: &'a Slots,
    /// The first.
    pub(crate) memory: View,
    pub(crate) frame: &'f Frame<'a, 'f>,
    pub(crate) cx: &'f Cx<'a>,
    /// The last result that is an integer or a reference, which is in its slot too.
    pub(crate) int: u64,
    pub(crate) single: f32,
    pub(crate) double: f64,
}

impl<'a> Machine<'a, '_> {
    #[inline(always)]
    pub(crate) fn get(&self, slot: u16) -> u64 {
        self.slots[usize::from(slot)].get()
    }

    #[inline(always)]
    pub(crate) fn set(&self, slot: u16, bits: u64) {
        self.slots[usize::from(slot)].set(bits);
    }

    #[inline(always)]
    pub(crate) fn vector(&self, slot: u16) -> u128 {
        let slot = usize::from(slot);
        u128::from(self.slots[slot].get()) | u128::from(self.slots[slot + 1].get()) << 64
    }

    #[inline(always)]
    pub(crate) fn set_vector(&self, slot: u16, bits: u128) {
        let slot = usize::from(slot);
        self.slots[slot].set(bits as u64);
        self.slots[slot + 1].set((bits >> 64) as u64);
    }

    #[inline(always)]
    pub(crate) fn read<T: Number, const IS_LAST: bool>(&self, slot: u16) -> T {
        match IS_LAST {
            true => T::last(self),
            false => T::from_slot(self.get(slot)),
        }
    }

    #[inline(always)]
    pub(crate) fn produce<T: Number>(&mut self, slot: u16, value: T) {
        value.make_last(self);
        self.set(slot, value.to_slot());
    }

    /// Slots that can be far. The prologue has seen to it that they are there.
    #[inline(always)]
    pub(crate) fn range(&self, first: u32, count: usize) -> Option<&'a [Cell<u64>]> {
        self.cx.range(self.slots, first, count)
    }

    #[inline(always)]
    pub(crate) fn operands<const N: usize>(&self, first: u32) -> Option<[u64; N]> {
        let slots = self.range(first, N)?.first_chunk::<N>()?;
        Some(slots.each_ref().map(Cell::get))
    }

    /// Before whatever may collect garbage or call back.
    #[inline(always)]
    pub(crate) fn keep_frame(&self) {
        let size = self.frame.ops.get().first().map_or(0, |first| first.imm);
        self.cx.keep(self.slots, size as usize);
    }

    /// In a handler that calls something, so that they are not saved.
    #[inline(always)]
    pub(crate) fn forget_last_results(&mut self) {
        (self.int, self.single, self.double) = (0, 0.0, 0.0);
    }
}

/// What a slot can hold.
pub(crate) trait Number: Copy {
    fn from_slot(bits: u64) -> Self;
    fn to_slot(self) -> u64;
    fn from_immediate(imm: u32) -> Self;
    fn last(m: &Machine<'_, '_>) -> Self;
    fn make_last(self, m: &mut Machine<'_, '_>);
}

macro_rules! numbers {
    ($($type:ty {
        $register:ident, |$bits:ident| $from_slot:expr, |$value:ident| $to_slot:expr, |$imm:ident| $from_imm:expr
    })*) => {$(
        impl Number for $type {
            #[inline(always)]
            fn from_slot($bits: u64) -> Self {
                $from_slot
            }

            #[inline(always)]
            fn to_slot(self) -> u64 {
                let $value = self;
                $to_slot
            }

            #[inline(always)]
            fn from_immediate($imm: u32) -> Self {
                $from_imm
            }

            #[inline(always)]
            fn last(m: &Machine<'_, '_>) -> Self {
                m.$register as Self
            }

            #[inline(always)]
            fn make_last(self, m: &mut Machine<'_, '_>) {
                m.$register = self.into();
            }
        }
    )*};
}

numbers! {
    u32 { int, |bits| bits as u32, |value| value.into(), |imm| imm }
    u64 { int, |bits| bits, |value| value, |imm| imm as i32 as u64 }
    f32 { single, |bits| f32::from_bits(bits as u32), |value| value.to_bits().into(), |imm| f32::from_bits(imm) }
    f64 { double, |bits| f64::from_bits(bits), |value| value.to_bits(), |imm| f32::from_bits(imm).into() }
}

/// `fn name[generics](m, op, ..) { .. }` takes as many records as it names, and goes on with the next instruction
/// after the body. `fn name(m, op @ start)` has the position before that. `fn name(m)` takes none, and sees to it
/// itself where to go.
macro_rules! handlers {
    ($($(#[$attribute:meta])* fn $name:ident $([$($generics:tt)*])?
        ($m:ident $(, $op:ident $(@ $start:ident)?)*) $body:block)*) => {$(
        $(#[$attribute])*
        #[allow(unused_mut, unreachable_code, reason = "for some")]
        pub(crate) extern "rust-preserve-none" fn $name<'a, 'f, $($($generics)*)?>(
            pc: $crate::code::Pc<'a>,
            slots: &'a bun_engine_wasm_runtime::interpreted::Slots,
            memory: bun_engine_wasm_runtime::interpreted::View,
            frame: &'f $crate::machine::Frame<'a, 'f>,
            cx: &'f $crate::machine::Cx<'a>,
            int: u64,
            single: f32,
            double: f64,
        ) -> bun_engine_wasm_runtime::Outcome {
            let mut $m = $crate::machine::Machine { pc, slots, memory, frame, cx, int, single, double };
            $(
                $(let $start = $m.pc.clone();)?
                let $op = $crate::machine::given!($m.pc.take());
            )*
            $body
            $crate::machine::handlers!(@end $m $($op)*);
        }
    )*};
    (@end $m:ident) => {};
    (@end $m:ident $last:ident) => { $crate::machine::go!($m, $last.next) };
    (@end $m:ident $first:ident $($rest:ident)+) => { $crate::machine::handlers!(@end $m $($rest)+) };
}

/// Goes on with another handler.
macro_rules! go {
    ($m:ident, $handler:expr) => {
        $crate::machine::go!($m, $handler, $m.pc)
    };
    ($m:ident, $handler:expr, $pc:expr) => {
        become ($handler)(
            $pc, $m.slots, $m.memory, $m.frame, $m.cx, $m.int, $m.single, $m.double,
        )
    };
}

/// Leaves the function.
macro_rules! fail {
    ($failure:expr) => {{
        core::hint::cold_path();
        return bun_engine_wasm_runtime::Outcome::failure($failure);
    }};
}

/// What the translation has seen to.
macro_rules! given {
    ($option:expr) => {
        match $option {
            Some(value) => value,
            None => $crate::machine::fail!(bun_engine_wasm_runtime::Failure::BROKEN),
        }
    };
}

/// For what fails with nothing that the function could catch.
macro_rules! attempt {
    ($result:expr) => {
        match $result {
            Ok(value) => value,
            Err(failure) => $crate::machine::fail!(failure),
        }
    };
    ($option:expr, $trap:ident) => {
        match $option {
            Some(value) => value,
            None => $crate::machine::fail!(bun_engine_wasm_compiler::abi::Trap::$trap),
        }
    };
}

/// An expression for each of the values that a variable can have, in which a constant has it.
macro_rules! specialize {
    ($value:expr => const $NAME:ident: bool, $body:expr) => {
        if $value {
            const $NAME: bool = true;
            $body
        } else {
            const $NAME: bool = false;
            $body
        }
    };
    ($value:expr => const $NAME:ident: $Enum:ident { $($variant:ident)* }, $body:expr) => {
        match $value {
            $($Enum::$variant => {
                const $NAME: $Enum = $Enum::$variant;
                $body
            })*
            #[allow(unreachable_patterns, reason = "for some")]
            _ => unreachable!(),
        }
    };
    ($value:expr => const $NAME:ident: $Enum:ident as u8 { $($variant:ident)* }, $body:expr) => {
        match $value {
            $($Enum::$variant => {
                const $NAME: u8 = $Enum::$variant as u8;
                $body
            })*
            #[allow(unreachable_patterns, reason = "for some")]
            _ => unreachable!(),
        }
    };
}

pub(crate) use {attempt, fail, given, go, handlers, specialize};
