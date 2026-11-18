//! Each instruction as a whole, for any operands. The interpreter and baseline code fall back on these.

pub(crate) mod calls;
mod classes;
mod control;
mod exotic;
mod frames;
mod iteration;
mod objects;
mod operators;
pub(crate) mod properties;
mod regexp;
mod scopes;
pub(crate) mod suspension;

use bun_engine_bytecode::{
    IdentifierIndex, Jump, Narrow, Op, Opcode, Operand, Register, Wide16, Wide32, op,
};
use bun_engine_macros::native_abi;
use bun_engine_text::PropertyName;
use bun_engine_vm::code::metadata::Entry;
use bun_engine_vm::{
    CallFrame, CellKind, CodeBlock, Cx, Environment, ForInRegisters, Gc, IteratorRegisters,
    JsResult, Step, Value, ValueVec, Vm,
};

use crate::machine::{Pc, dispatch, go, handler, jump};
use crate::stubs;

/// Where control goes after an instruction.
#[derive(Clone, Copy)]
pub(crate) enum Next {
    FallThrough,
    FirstTarget,
    SecondTarget,
    /// From the start of the code.
    Offset(u32),
    Return(Value),
}

/// What a slow path returns.
#[repr(C)]
pub struct Outcome {
    /// One of `outcome`.
    pub code: usize,
    /// For `RETURN`.
    pub value: u64,
}

pub mod outcome {
    pub const EXCEPTION: usize = 0;
    pub const FALL_THROUGH: usize = 1;
    pub const FIRST_TARGET: usize = 2;
    pub const SECOND_TARGET: usize = 3;
    pub const RETURN: usize = 4;
    /// Plus an offset from the start of the code.
    pub const OFFSET: usize = 5;
}

impl Next {
    #[inline(always)]
    pub(crate) fn jump_if(condition: bool) -> Next {
        if condition {
            Next::FirstTarget
        } else {
            Next::FallThrough
        }
    }

    #[inline(always)]
    fn encode(result: &JsResult<Next>) -> Outcome {
        let (code, value) = match *result {
            Err(_) => (outcome::EXCEPTION, 0),
            Ok(Next::FallThrough) => (outcome::FALL_THROUGH, 0),
            Ok(Next::FirstTarget) => (outcome::FIRST_TARGET, 0),
            Ok(Next::SecondTarget) => (outcome::SECOND_TARGET, 0),
            Ok(Next::Return(value)) => (outcome::RETURN, value.to_bits()),
            Ok(Next::Offset(offset)) => (outcome::OFFSET + offset as usize, 0),
        };
        Outcome { code, value }
    }
}

/// A frame whose code is not optimized, for the operands of the instruction that it is at.
#[derive(Clone, Copy)]
pub(crate) struct Frame<'a> {
    pub(crate) header: &'a CallFrame,
    #[cfg_attr(rootcheck, rootcheck::stays("the frame holds it"))]
    pub(crate) code_block: &'a CodeBlock,
}

impl<'a> Frame<'a> {
    /// Also makes the frame known to whoever walks the stack.
    ///
    /// # Safety
    /// `start` is that of the instruction which the frame is at, and it is the innermost.
    #[inline(always)]
    pub(crate) unsafe fn enter<'cx>(
        vm: &Vm,
        header: &'a CallFrame,
        start: *const u8,
    ) -> (&'cx mut Cx, Frame<'a>) {
        vm.set_top_call_frame(header);
        header.set_call_site(start.addr() as u32);
        // SAFETY: the caller's.
        unsafe { Self::new(header) }
    }

    /// # Safety
    /// `header` is that of a frame, or of memory that is laid out like one, whose code is running.
    #[inline(always)]
    unsafe fn new<'cx>(header: &'a CallFrame) -> (&'cx mut Cx, Frame<'a>) {
        // SAFETY: the frame keeps its code block alive, and generated code runs inside a call that has the `Cx`.
        unsafe {
            let code_block = Gc::<CodeBlock>::from_address(header.code_block_bits()).baseline();
            let cx = Cx::from_global(code_block.global());
            let code_block = &*code_block.as_ptr();
            (cx, Frame { header, code_block })
        }
    }

    #[inline(always)]
    pub(crate) fn reg_or_empty(self, register: Register) -> Option<Value> {
        // SAFETY: verified to be inside the frame.
        unsafe { Value::from_bits_or_empty(self.header.slot(register.offset() as isize).get()) }
    }

    #[inline(always)]
    pub(crate) fn get_or_empty(self, operand: Operand) -> Option<Value> {
        let word = bun_engine_bytecode::Field::word(operand);
        match operand.as_constant() {
            // SAFETY: verified to be a constant.
            Some(index) => unsafe {
                Value::from_bits_or_empty(*self.code_block.constants_ptr().add(index as usize))
            },
            None => self.reg_or_empty(Register::from_offset(word as i32)),
        }
    }

    #[inline(always)]
    pub(crate) fn reg(self, register: Register) -> Value {
        self.reg_or_empty(register).expect("a value")
    }

    #[inline(always)]
    pub(crate) fn get(self, operand: Operand) -> Value {
        self.get_or_empty(operand).expect("a value")
    }

    #[inline(always)]
    pub(crate) fn cell<T: CellKind>(self, register: Register) -> Gc<T> {
        self.reg(register).cast()
    }

    #[inline(always)]
    pub(crate) fn set_or_empty(self, register: Register, value: Option<Value>) {
        // SAFETY: verified to be inside the frame.
        unsafe { self.header.slot(register.offset() as isize) }.set(Value::bits_of(value));
    }

    #[inline(always)]
    pub(crate) fn set(self, register: Register, value: impl Into<Value>) {
        self.set_or_empty(register, Some(value.into()));
    }

    /// For an instruction whose entry starts with the profile.
    #[inline(always)]
    pub(crate) fn set_profiled(self, register: Register, metadata: u32, value: impl Into<Value>) {
        let value = value.into();
        self.entry::<bun_engine_vm::ValueProfile>(metadata)
            .record(value);
        self.set(register, value);
    }

    #[inline(always)]
    pub(crate) fn name(self, index: IdentifierIndex) -> PropertyName<'a> {
        self.code_block.identifier(index)
    }

    /// `T` is the type of the entries of the instruction.
    #[inline(always)]
    pub(crate) fn entry<T: Entry>(self, word: u32) -> &'a T {
        // SAFETY: private to this crate, whose callers name the type that `metadata` gives for the kind.
        unsafe { self.code_block.metadata(word) }
    }

    /// In the order of their addresses, which is from the last to the first. Not to be held across a `set`.
    #[inline(always)]
    pub(crate) fn run(self, first: Register, count: u32) -> &'a [Option<Value>] {
        let lowest = first.offset() as isize + 1 - count as isize;
        // SAFETY: verified to be inside the frame.
        unsafe {
            let lowest = self.header.slot(lowest).as_ptr();
            core::slice::from_raw_parts(lowest.cast(), count as usize)
        }
    }

    /// Three registers, as what an instruction has put there.
    #[inline(always)]
    pub(crate) fn state<T: State>(self, first: Register) -> &'a T {
        // SAFETY: verified to be inside the frame.
        unsafe {
            &*self
                .header
                .slot(first.nth(2).offset() as isize)
                .as_ptr()
                .cast()
        }
    }

    /// For an instruction that jumps if there is no value.
    #[inline(always)]
    pub(crate) fn value_of(self, cx: &Cx, step: Step) -> JsResult<Option<Value>> {
        match step {
            Step::DONE => Ok(None),
            Step::FAILED => cx.check_exception().map(|()| unreachable!()),
            // SAFETY: neither of those.
            _ => Ok(Some(unsafe { Value::from_bits(step.bits()) })),
        }
    }

    #[inline(always)]
    pub(crate) fn collect(self, first: Register, count: u32) -> ValueVec {
        let mut values = ValueVec::new();
        for index in 0..count {
            values.push(self.reg(first.nth(index)));
        }
        values
    }

    #[inline(always)]
    pub(crate) fn outer_scope(self, scope: Register, depth: u32) -> Gc<Environment> {
        let mut environment = self.cell::<Environment>(scope);
        for _ in 0..depth {
            environment = environment.parent().cast();
        }
        environment
    }
}

/// Three words that can change.
pub(crate) trait State {}

impl State for ForInRegisters {}
impl State for IteratorRegisters {}

pub(crate) trait Execute: Op {
    fn execute(self, cx: &mut Cx, frame: Frame<'_>) -> JsResult<Next>;
}

/// `execute! { Op(op, cx, f) { .. } }`. The block is a `Next`, or nothing for falling through.
macro_rules! execute {
    ($($Op:ident($op:ident, $cx:ident, $f:ident) $body:block)*) => {$(
        impl $crate::slow::Execute for bun_engine_bytecode::op::$Op {
            #[inline(always)]
            #[allow(unused_variables, unreachable_code, clippy::unit_arg)]
            fn execute(
                self,
                $cx: &mut bun_engine_vm::Cx,
                $f: $crate::slow::Frame<'_>,
            ) -> bun_engine_vm::JsResult<$crate::slow::Next> {
                let $op = self;
                Ok($crate::slow::Next::from($body))
            }
        }
    )*};
}

pub(crate) use execute;

impl From<()> for Next {
    #[inline(always)]
    fn from((): ()) -> Next {
        Next::FallThrough
    }
}

impl From<!> for Next {
    fn from(never: !) -> Next {
        never
    }
}

/// # Safety
/// The start of such an instruction in verified code.
#[inline(always)]
pub(crate) unsafe fn decode<O: Op>(start: *const u8) -> O {
    // SAFETY: the caller's.
    unsafe {
        match *start {
            byte if byte == Opcode::Wide16Prefix as u8 => O::decode::<Wide16>(Pc(start.add(1))),
            byte if byte == Opcode::Wide32Prefix as u8 => O::decode::<Wide32>(Pc(start.add(1))),
            _ => O::decode::<Narrow>(Pc(start)),
        }
    }
}

/// `start` is that of the instruction, with its prefix.
#[native_abi]
pub type SlowPath = unsafe fn(vm: &Vm, frame: &CallFrame, start: *const u8) -> Outcome;

#[native_abi]
#[inline(never)]
pub(crate) unsafe fn slow_path<O: Execute>(
    vm: &Vm,
    frame: &CallFrame,
    start: *const u8,
) -> Outcome {
    vm.set_top_call_frame(frame);
    frame.set_call_site(start.addr() as u32);
    // SAFETY: the caller's.
    unsafe { run::<O>(frame, start) }
}

#[inline(never)]
unsafe fn run<O: Execute>(frame: &CallFrame, start: *const u8) -> Outcome {
    // SAFETY: the caller's.
    let (op, (cx, frame)) = unsafe { (decode::<O>(start), Frame::new(frame)) };
    Next::encode(&op.execute(cx, frame))
}

/// For optimized code, which has made its frame known already. No prologue has remembered the owner of the profiles.
#[native_abi]
pub(crate) unsafe fn operation<O: Execute>(_: &Vm, frame: &CallFrame, start: *const u8) -> Outcome {
    // SAFETY: the caller's.
    unsafe {
        let outcome = run::<O>(frame, start);
        let owner = Gc::<CodeBlock>::from_address(frame.code_block_bits()).baseline();
        owner.write_barrier_for_cell();
        outcome
    }
}

pub(crate) trait Targets: Op {
    fn target(self, index: usize) -> Option<Jump>;
}

macro_rules! define_targets {
    ($(
        $(#[$doc:meta])*
        $name:ident $mnemonic:ident $flow:ident { $($field:ident: $shape:ident),* } $(=> $metadata:ident)?;
    )*) => {$(
        impl Targets for op::$name {
            #[inline(always)]
            fn target(self, index: usize) -> Option<Jump> {
                let targets: [Option<Jump>; _] = [$(define_targets!(@target $shape, self.$field),)* None];
                targets.into_iter().flatten().nth(index)
            }
        }
    )*};
    (@target Target, $value:expr) => { Some($value) };
    (@target $shape:ident, $value:expr) => { None };
}

bun_engine_bytecode::instruction_table!(define_targets);

handler! {
    #[inline(never)]
    fn handler<O: Slow>(m, op: O) {
        let Outcome { code: result, value } = slow_path::<O>(m.vm, m.frame(), m.start());
        if result == outcome::FALL_THROUGH {
            dispatch!(m, m.after(&op))
        }
        if result == outcome::EXCEPTION {
            go!(m, stubs::throw)
        }
        if let Some(target) = op.target(0) && result == outcome::FIRST_TARGET {
            jump!(m, target)
        }
        if let Some(target) = op.target(1) && result == outcome::SECOND_TARGET {
            jump!(m, target)
        }
        if result == outcome::RETURN {
            go!(m, stubs::return_value; value)
        }
        dispatch!(m, m.at_offset((result - outcome::OFFSET) as u32))
    }
}

pub(crate) trait Slow: Execute + Targets {}

impl<O: Execute + Targets> Slow for O {}

/// The frame is treated as one whose code has not begun.
#[native_abi]
pub(crate) unsafe fn throw_stack_overflow_at_entry(vm: &Vm, frame: &CallFrame) {
    // SAFETY: called by the entry, for a frame whose header is complete.
    unsafe {
        let (cx, _) = Frame::enter(vm, frame, core::ptr::null());
        frame.set_code_block(None);
        let _ = cx.throw_stack_overflow();
    }
}
