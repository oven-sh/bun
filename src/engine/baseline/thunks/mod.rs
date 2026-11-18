//! Code that all baseline code of the process shares.

#![forbid(unsafe_code)]

mod arrays;
mod frames;
mod values;

use std::sync::OnceLock;

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::Opcode;
use bun_engine_exec_memory::{CodeHandle, NativeFrames, Priority};
use bun_engine_interpreter::{SLOW_PATHS, fixed_call_preparation, varargs_call_preparation};
use bun_engine_vm::{CodeBlock, Vm, call, operators};

use crate::compiler::{ENTRY, emit_resolve_dynamic};
use crate::emit::*;
use crate::ic::Entries;
use crate::registers::*;
use crate::runtime;

const UNKNOWN: i32 = operators::UNKNOWN as i32;

const SURPRISES: Address = at(CODE_BLOCK, CodeBlock::OFFSET_OF_SURPRISE_COUNTER);

macro_rules! thunks {
    ($($(#[$doc:meta])* $name:ident,)*) => {
        pub(crate) struct Thunks {
            $($(#[$doc])* pub(crate) $name: usize,)*
            /// By opcode: a step and the way to it that is counted or, of a call that spreads its arguments, two steps.
            steps: [[usize; 2]; Opcode::COUNT],
            pub(crate) entries: Entries<usize>,
            code: CodeHandle,
        }

        fn generate() -> Option<Thunks> {
            let mut emitter = Emitter::new();
            $(let $name = emitter.routine(Emitter::$name);)*
            let steps = Opcode::ALL.map(|opcode| emitter.steps(opcode));
            let (entries, names) =
                Entries::emit(&mut emitter.m, &mut emitter.frames, emitter.write_barrier);
            let code = emitter.m.finish().ok()?;
            let handle = bun_engine_exec_memory::link(&code, Priority::Required, |_| 0).ok()?;
            handle.set_routines(&code, &emitter.frames);
            let address = |label| handle.address(code.offset_of(label));
            let thunks = Thunks {
                $($name: address($name),)*
                steps: steps.map(|labels| labels.map(|label| label.map_or(0, address))),
                entries: entries.map(address),
                code: handle,
            };
            thunks.code.describe_parts(|| {
                let place = |label| thunks.code.address(code.offset_of(label));
                let names = names.iter().map(|&(label, name)| (place(label), format!("access {name}")));
                thunks.names().into_iter().chain(names).collect()
            });
            Some(thunks)
        }

        impl Thunks {
            fn names(&self) -> Vec<(usize, String)> {
                let steps = (Opcode::ALL.iter().zip(self.steps))
                    .flat_map(|(opcode, steps)| steps.map(|step| (step, format!("step of {opcode:?}"))));
                [$((self.$name, concat!("thunk ", stringify!($name)).into()),)*]
                    .into_iter()
                    .chain(steps.filter(|step| step.0 != 0))
                    .collect()
            }
        }
    };
}

thunks! {
    /// For the cell in `T1`. Keeps `T0`.
    write_barrier,
    pad_arguments,
    finish_prologue,
    /// With the offset of the instruction in the third argument register.
    tier_up_in_loop,
    /// Goes on at the instruction that the call site stands for.
    resume,
    catch,
    /// To jump to at the start of an instruction that has no code, with its offset in the third argument register.
    leave,
    /// With the callee in `T0` and the profile in `T1`, which becomes zero unless the call can go ahead with what is
    /// in `EXECUTABLE`. Keeps `T0` and those from `T5` on.
    check_callee,
    /// With the new frame in `T1`.
    tail_call,
    /// For the list in `T5` but the first `T6`, below `T7`. Leaves the new frame in `T1`, or zero if there is more to
    /// it, the first argument in `T2` and their number in `T5`. Keeps `T0` and `EXECUTABLE`.
    size_frame_for_list,
    /// `T0` and `T1` into `F0` and `F1`. `T2` becomes zero unless both are numbers.
    to_doubles,
    /// Of `T0` and `T1` as doubles, with the profile in `T4`. These three leave zero if there is more to it.
    add,
    subtract,
    multiply,
    /// These go on to the function of that name in `operators`, with all arguments but the first in their places.
    add_any,
    subtract_any,
    multiply_any,
    divide,
    remainder,
    exponentiate,
    bit_and,
    bit_or,
    bit_xor,
    shift_left,
    shift_right,
    concatenate,
    to_string,
    to_number,
    type_of,
    compare,
    find_atom,
    /// These three leave the answer in `T0`, or more than 1 if they have none.
    to_boolean,
    strict_equal,
    loose_equal,
    /// `T2` on to `T1`. These two leave the result in `T0`, or zero if there is more to it.
    push,
    pop,
    /// Whether iterating over `T1`, which it keeps, is to go through the elements of an array.
    is_pristine_array,
    /// Whether `T1`, which it keeps, is an array whose holes are undefined and that is not too long for a call.
    is_argument_list,
    resolve_dynamic,
}

static THUNKS: OnceLock<Option<Thunks>> = OnceLock::new();

/// None if there is no memory to run code from.
pub(crate) fn get() -> Option<&'static Thunks> {
    THUNKS.get_or_init(generate).as_ref()
}

impl Thunks {
    /// These take the offset of the instruction in the third argument register, and do not return if it throws.
    pub(crate) fn slow_path(&self, opcode: Opcode, is_surprise: bool) -> usize {
        self.steps[opcode as usize][usize::from(is_surprise)]
    }

    pub(crate) fn prepare_call(&self, opcode: Opcode, is_surprise: bool) -> usize {
        self.steps[opcode as usize][usize::from(is_surprise)]
    }

    pub(crate) fn size_frame(&self, opcode: Opcode) -> usize {
        self.steps[opcode as usize][0]
    }

    /// With the new frame in the fourth.
    pub(crate) fn fill_frame(&self, opcode: Opcode) -> usize {
        self.steps[opcode as usize][1]
    }
}

macro_rules! operators {
    ($($thunk:ident $function:ident,)*) => {
        impl Emitter {$(
            fn $thunk(&mut self) {
                self.m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
                self.m.load_global(ARGUMENTS[0]);
                (self.m).jump_address(operators::$function as *const () as usize);
            }
        )*}
    };
}

operators! {
    add_any add,
    subtract_any subtract,
    multiply_any multiply,
    divide divide,
    remainder remainder,
    exponentiate exponentiate,
    bit_and bit_and,
    bit_or bit_or,
    bit_xor bit_xor,
    shift_left shift_left,
    shift_right shift_right,
    concatenate concatenate,
    to_string to_string,
    to_number to_number,
    type_of type_of,
    compare compare,
    find_atom find_atom,
}

struct Emitter {
    m: MacroAssembler,
    frames: NativeFrames,
    throw: Label,
    write_barrier: Label,
    compile_again: Label,
}

impl Emitter {
    fn new() -> Emitter {
        let mut m = MacroAssembler::new(assembler_options(0));
        m.reserve(48 << 10);
        let throw = m.external_address(call::throw_from_frame());
        let (write_barrier, compile_again) = (m.new_label(), m.new_label());
        Emitter {
            m,
            frames: NativeFrames::default(),
            throw,
            write_barrier,
            compile_again,
        }
    }

    fn routine(&mut self, emit: impl FnOnce(&mut Self)) -> Label {
        self.m.align(16, 15);
        let start = self.m.here();
        emit(self);
        start
    }

    /// Calls a function of the `Vm`, the frame and whatever is in the argument registers after those.
    fn call_with_frame(&mut self, function: usize) {
        self.m.move64(ARGUMENTS[0], VM);
        self.m.move64(ARGUMENTS[1], FP);
        self.frames.enter(&mut self.m);
        self.m.call_address(function);
        self.frames.leave(&mut self.m);
    }

    fn step(&mut self, function: usize, prepares_call: bool) -> Option<Label> {
        let start = self.m.here();
        let instructions = at(CODE_BLOCK, CodeBlock::OFFSET_OF_INSTRUCTIONS);
        self.m.add64(ARGUMENTS[2], ARGUMENTS[2], instructions);
        self.call_with_frame(function);
        self.m.branch_if_zero64(T0, self.throw);
        if prepares_call {
            self.m.move64(EXECUTABLE, SECOND_RESULT);
            self.m.move64(ENTRY, T0);
        }
        self.m.ret();
        Some(start)
    }

    fn count_surprise(&mut self, weight: i32, enough: Label) {
        (self.m).branch_add32_to_memory(ResultCond::NonNegative, SURPRISES, weight, enough);
    }

    fn steps(&mut self, opcode: Opcode) -> [Option<Label>; 2] {
        self.m.align(16, 15);
        if let Some(slow_path) = SLOW_PATHS[opcode as usize] {
            let counted = self.m.here();
            self.count_surprise(2, self.compile_again);
            [self.step(slow_path as usize, false), Some(counted)]
        } else if let Some(prepare) = fixed_call_preparation(opcode) {
            let counted = self.m.here();
            self.m.add32_to_memory(SURPRISES, 2);
            let start = self.m.here();
            (self.m).branch32(Cond::Ge, SURPRISES, 0, self.compile_again);
            self.step(prepare as usize, true);
            [Some(start), Some(counted)]
        } else if let Some((size, fill)) = varargs_call_preparation(opcode) {
            [
                self.step(size as usize, false),
                self.step(fill as usize, true),
            ]
        } else {
            [None; 2]
        }
    }

    fn write_barrier(&mut self) {
        self.m.bind(self.write_barrier);
        self.frames.enter(&mut self.m);
        self.m.push_pair(T0, T1);
        self.m.move64(ARGUMENTS[0], T1);
        self.m.call_address(runtime::remember as *const () as usize);
        self.m.pop_pair(T0, T1);
        self.frames.leave(&mut self.m);
        self.m.ret();
    }

    fn answer(&mut self, label: Label, answer: i32) {
        self.m.bind(label);
        self.m.move32(T0, answer);
        self.m.ret();
    }

    fn resolve_dynamic(&mut self) {
        emit_resolve_dynamic(&mut self.m);
    }
}
