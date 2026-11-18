//! What a test asks the macro assembler to emit.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{
    Amount, AtomicOp, Memory, NegativeZero, RegOrImm, RegOrMem, Rounding, Shift, Src,
};

pub(crate) struct Operation {
    pub(crate) describe: Box<dyn Fn() -> String>,
    pub(crate) emit: Box<dyn Fn(&mut MacroAssembler, Label)>,
    /// All registers that it names. Those that it does not can serve as scratch registers.
    pub(crate) names: RegisterSet,
}

impl Operation {
    /// Runs with the usual scratch registers only, unless it tells what it names.
    pub(crate) fn custom(
        name: String,
        emit: impl Fn(&mut MacroAssembler, Label) + 'static,
    ) -> Self {
        Self {
            describe: Box::new(move || name.clone()),
            emit: Box::new(emit),
            names: abi::ALL,
        }
    }

    pub(crate) fn naming(self, names: impl Names) -> Self {
        Self {
            names: names.names(),
            ..self
        }
    }

    /// `around` gets what emits the operation.
    pub(crate) fn wrapped(
        self,
        more_names: impl Names,
        around: impl Fn(&mut MacroAssembler, Label, &dyn Fn(&mut MacroAssembler)) + 'static,
    ) -> Self {
        let emit = self.emit;
        Self {
            describe: self.describe,
            emit: Box::new(move |masm, target| around(masm, target, &|masm| emit(masm, target))),
            names: self.names | more_names.names(),
        }
    }
}

pub(crate) trait Names: Copy {
    fn names(self) -> RegisterSet {
        RegisterSet::EMPTY
    }
}

macro_rules! names {
    ($($type:ty),* => nothing) => {
        $(impl Names for $type {})*
    };
    ($($type:ty => |$value:ident| $names:expr,)*) => {
        $(impl Names for $type {
            fn names(self) -> RegisterSet {
                let $value = self;
                $names
            }
        })*
    };
}

names!(Width, Size, Sign, FloatWidth, Cond, TestCond, ResultCond, FloatCond, Shift => nothing);
names!(Rounding, AtomicOp, NegativeZero, Absolute, u8, i32, i64, u64, f64 => nothing);
names! {
    Gpr => |reg| RegisterSet::of(&[reg], &[]),
    Fpr => |reg| RegisterSet::of(&[], &[reg]),
    [Gpr; 2] => |pair| RegisterSet::of(&pair, &[]),
    RegisterSet => |set| set,
    Address => |address| abi::ALL.gprs().filter(|&reg| address.uses(reg)).collect(),
    Memory => |memory| Src::from(memory).names(),
    RegOrImm => |operand| Src::from(operand).names(),
    RegOrMem => |operand| Src::from(operand).names(),
    Src => |src| match src {
        Src::Reg(reg) => reg.names(),
        Src::Mem(Memory::Address(address)) => address.names(),
        _ => RegisterSet::EMPTY,
    },
    Amount => |amount| match amount {
        Amount::Reg(reg) => reg.names(),
        Amount::Imm(_) => RegisterSet::EMPTY,
    },
}

/// A call of a method. `=> target` adds the label to branch to as the last argument.
macro_rules! op {
    ($method:ident($($argument:expr),*)) => {
        $crate::machine::op!(@ $method($($argument),*), move |masm, _| masm.$method($($argument),*))
    };
    ($method:ident($($argument:expr),*) => target) => {
        $crate::machine::op!(
            @ $method($($argument),*),
            move |masm, target| masm.$method($($argument,)* target)
        )
    };
    (@ $method:ident($($argument:expr),*), $emit:expr) => {
        $crate::machine::Operation {
            describe: Box::new(move || format!("{}{:x?}", stringify!($method), ($($argument,)*))),
            emit: Box::new($emit),
            names: RegisterSet::EMPTY $(| $crate::machine::operation::Names::names($argument))*,
        }
    };
}

#[allow(unused_imports)]
pub(crate) use op;
