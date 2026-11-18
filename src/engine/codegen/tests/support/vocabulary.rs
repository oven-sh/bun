//! What the patchpoints and calls of test programs do.
//!
//! All have one meaning, [`Machine::invoke`], which depends on the effects that the instruction declares and on the
//! [`Behaviour`] in the low bits of its token. The rest of the token is a number that only copies of the instruction
//! share. The constraints on operands and results, clobbers, scratch registers and flags are unrelated to the meaning.
//!
//! One generator of machine code thus serves every patchpoint, and one kind of stub every callee:
//!
//! 1. Overwrite `clobbers_early`, the scratch registers and the `EarlyRegister` results.
//! 2. Save the operands that are not late.
//! 3. Overwrite `clobbers_late`, the upper halves of `clobbers_upper_halves`, the `ConsumedRegister` operands and the
//!    results. With `MOVES_STACK_POINTER`, move it down by a multiple of 16.
//! 4. Save the late operands and the values of the state.
//! 5. Keeping all registers, call a function that clears what the types of these values do not cover, replaces
//!    addresses in the frame by their counterparts from `memory`, copies the data, the reserved bytes and the slots to
//!    `Machine::memory`, calls `invoke` with the instruction that [`sites`] has for the token, and copies them back.
//! 6. Exit, or load the results and go on or to the successor. With `UNEXTENDED_RESULTS`, fill their upper halves.
//!
//! Callee `n` has signature `n / 2` of [`signature`]. A direct call names it as `Symbol(n)` or by its address in
//! `Layout::callees`. The stub finds token and state through its return address. A call that ends its block goes to a
//! handler one time in four, and then has no results.

use std::collections::HashMap;

use bun_engine_asm::{Bank, Fpr, Gpr, Reg, RegisterSet, arm64, x64};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{
    Access, AccessFlags, Action, EffectFlags, Function, Heap, Input, Op, Output, Patchpoint,
    PatchpointFlags, Token, Type, Value,
};

use super::datum::{Datum, Kind, Open, all_bits};
use super::interpreter::{Machine, Source, Stop};
use super::memory::Memory;
use super::nodes::token_of;
use super::random::mix;

bitflags::bitflags! {
    /// The first operand is the first after the address of an indirect call.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct Behaviour: u32 {
        /// The first operand must not be zero.
        const NEEDS_NONZERO = 1 << 0;
        /// Touches only the eight bytes at the first operand, not all of the heaps that it reads and writes.
        const THROUGH_POINTER = 1 << 1;
        /// Exits if the low three bits of the first operand are all set.
        const EXITS_BY_OPERAND = 1 << 2;
        /// Exits one time in 32.
        const EXITS_BY_CHANCE = 1 << 3;
        /// The successor is the low 32 bits of the first operand modulo their number.
        const GOES_BY_OPERAND = 1 << 4;
        /// Integers are below 16, and floats are multiples of a quarter.
        const SMALL_RESULTS = 1 << 5;
        /// The first result is the address of an object.
        const GIVES_OBJECT = 1 << 6;
        /// The first result is the first operand.
        const GIVES_OPERAND = 1 << 7;
    }
}

const BEHAVIOUR_BITS: u32 = 8;

pub(crate) fn token(number: u32, behaviour: Behaviour) -> Token {
    Token(number << BEHAVIOUR_BITS | behaviour.bits())
}

fn behaviour(token: Token) -> Behaviour {
    Behaviour::from_bits_truncate(token.0)
}

/// An instruction for each token, which has the types of operands, state and results.
pub(crate) fn sites(function: &Function) -> HashMap<Token, Value> {
    let instructions = function
        .blocks()
        .flat_map(|block| function.instructions(block));
    let with_token = |value| match *function.op(value) {
        Op::Patchpoint(patchpoint) => Some((function.patchpoint(patchpoint).token, value)),
        ref op => Some((op.exit()?.token, value)),
    };
    instructions.filter_map(with_token).collect()
}

pub(crate) fn result_types(function: &Function, site: Value) -> impl Iterator<Item = Type> {
    let ty = function.type_of(site);
    let elements = (0..).map_while(move |position| function.tuple_element_type(site, position));
    let elements = elements.filter(move |_| ty == Type::Tuple);
    elements.chain(ty.is_data().then_some(ty))
}

fn result_bits(ty: Type, behaviour: Behaviour, seed: u64) -> u128 {
    const SPECIAL: [f64; 8] = [
        0.0,
        -0.0,
        1.0,
        -1.0,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
        2_147_483_648.0,
    ];
    let is_small = behaviour.contains(Behaviour::SMALL_RESULTS);
    let float = || match seed >> 61 {
        0 if !is_small => SPECIAL[seed as usize % SPECIAL.len()],
        _ => ((seed % 256) as f64 - 128.0) / 4.0,
    };
    match ty {
        Type::I32 | Type::I64 if is_small => (seed % 16).into(),
        Type::F32 if is_small || seed >> 62 == 0 => (float() as f32).to_bits().into(),
        Type::F64 if is_small || seed >> 62 == 0 => float().to_bits().into(),
        _ => (u128::from(mix(seed, 1)) << 64 | u128::from(mix(seed, 2))) & all_bits(ty),
    }
}

impl Machine<'_> {
    /// `CALLEE_COUNT` if it is no call, and the uses without the address.
    fn callee<'a>(
        &self,
        function: &Function,
        patchpoint: Patchpoint,
        uses: &'a [Datum],
    ) -> Result<(usize, &'a [Datum]), Stop> {
        let callee_at = |address: u64| {
            let found = self
                .layout
                .callees
                .iter()
                .position(|&callee| callee == address);
            found.ok_or(Stop::Undefined("call of what is no function"))
        };
        let (callee, uses) = match function.patchpoint(patchpoint).action {
            Action::Custom | Action::CustomCall => (CALLEE_COUNT, uses),
            Action::Call(bun_engine_asm::Target::Symbol(callee)) => (callee as usize, uses),
            Action::Call(bun_engine_asm::Target::Address(address)) => {
                (callee_at(address as u64)?, uses)
            }
            Action::CallIndirect => (callee_at(uses[0].known()?)?, &uses[1..]),
        };
        if callee != CALLEE_COUNT {
            let expected = signature(self.target, callee / 2);
            let inputs = function.inputs(patchpoint);
            let inputs = &inputs[inputs.len() - expected.params.len().min(inputs.len())..];
            if !inputs
                .iter()
                .eq(expected.params.iter().map(|(_, input)| input))
                || function.outputs(patchpoint) != expected.results
            {
                return Err(Stop::Undefined("call with another signature"));
            }
        }
        Ok((callee, uses))
    }

    /// Gives the position of the successor, for the end of a block. `uses` are the operands and then the state.
    pub(crate) fn invoke(
        &mut self,
        function: &Function,
        site: Value,
        uses: &[Datum],
        results: &mut Vec<Datum>,
    ) -> Result<usize, Stop> {
        const WORD: u32 = 8;
        let (effects, state) = (function.effects(site), function.state_of(site));
        let (token, callee, uses) = match *function.op(site) {
            Op::Patchpoint(patchpoint) => {
                let (callee, uses) = self.callee(function, patchpoint, uses)?;
                (function.patchpoint(patchpoint).token, callee, uses)
            }
            Op::Node { kind, data, .. } | Op::WideNode { kind, data, .. } => {
                (token_of(kind, data), CALLEE_COUNT, uses)
            }
            _ => unreachable!("neither a patchpoint nor a node"),
        };
        let (behaviour, is_node) = (behaviour(token), function.op(site).node().is_some());
        let is_call = matches!(*function.op(site), Op::Patchpoint(patchpoint)
            if function.patchpoint(patchpoint).action != Action::Custom);
        let first_of_state = uses.len() - function.state(state).len();
        if behaviour.contains(Behaviour::NEEDS_NONZERO) && !uses[0].is_not_zero()? {
            return Err(Stop::Undefined("operand of a patchpoint is zero"));
        }

        let seen = |value: Datum| match value.kind {
            Kind::FrameAddress(_) if Memory::is_inside(self.layout, function, value) => {
                Datum::from(value.bits)
            }
            _ => value.as_bits(),
        };
        let mut seed = Some(mix(token.0.into(), callee as u64));
        let first_observed = self.trace.observed.len();
        for (position, &value) in uses.iter().enumerate() {
            let value = seen(value);
            self.trace.observed.push(value);
            if is_node && position >= first_of_state {
                continue;
            }
            seed = seed
                .filter(|_| value.unknown == 0)
                .map(|seed| mix(mix(seed, value.bits as u64), (value.bits >> 64) as u64));
        }
        if is_node
            && !effects.writes_memory()
            && !effects.has(EffectFlags::FENCE | EffectFlags::KEPT)
        {
            self.trace.observed.truncate(first_observed);
        } else if effects.has(EffectFlags::EXITS | EffectFlags::FENCE) {
            if !effects.has(EffectFlags::EXITS) && is_node {
                self.trace
                    .observed
                    .truncate(first_observed + first_of_state);
            }
            self.record(function, Source::Site(token), effects, first_observed);
        } else {
            self.trace.observed.truncate(first_observed);
            if effects.must_execute() {
                self.trace.add_unordered(seed);
            }
        }

        let add = |seed: Option<u64>, more: Option<u64>| Some(mix(seed?, more?));
        let through_pointer = behaviour.contains(Behaviour::THROUGH_POINTER);
        let place = |machine: &Self, heap, writes| {
            let access = Access::new(heap, AccessFlags::empty());
            machine.locate(function, site, (uses[0], 0), WORD, access, writes)
        };
        if effects.reads != Heap::NOTHING {
            if through_pointer {
                let word = self.memory.read(place(self, effects.reads, false)?, WORD);
                seed = add(seed, word.known().ok());
            } else {
                let range = function.heap_range(effects.reads);
                seed = add(seed, self.memory.hash_data(range));
                seed = add(seed, self.memory.hash_frame(range));
            }
        }

        let successors = if effects.has(EffectFlags::ENDS_BLOCK) {
            Some(function.successors(function.block_of(site)).len() as u64)
        } else {
            None
        };
        let exits = successors == Some(0)
            || behaviour.contains(Behaviour::EXITS_BY_OPERAND) && uses[0].known()? & 7 == 7
            || behaviour.contains(Behaviour::EXITS_BY_CHANCE) && seed.ok_or(Open)? >> 20 & 31 == 0;

        if effects.writes != Heap::NOTHING {
            if through_pointer {
                let place = place(self, effects.writes, true)?;
                let word =
                    seed.map_or_else(|| Datum::anything(Type::I64), |seed| mix(seed, 3).into());
                self.memory.write(place, WORD, word);
            } else {
                let range = function.heap_range(effects.writes);
                self.memory.scramble(self.layout, range, seed, 3);
            }
        }

        if exits {
            return Err(self.exit(function, token, &uses[first_of_state..]));
        }
        results.clear();
        for (position, ty) in result_types(function, site).enumerate() {
            let seed = seed.map(|seed| mix(seed, 16 + position as u64));
            results.push(match seed {
                _ if position == 0 && behaviour.contains(Behaviour::GIVES_OPERAND) => uses[0],
                _ if effects.has(EffectFlags::DISTINCT) => self.new_identity(),
                None => Datum::anything(ty),
                Some(seed) if position == 0 && behaviour.contains(Behaviour::GIVES_OBJECT) => {
                    self.layout.object(seed).into()
                }
                Some(seed) => result_bits(ty, behaviour, seed).into(),
            });
        }
        Ok(match successors {
            None => 0,
            Some(count) if behaviour.contains(Behaviour::GOES_BY_OPERAND) => {
                u64::from(uses[0].known()? as u32) % count
            }
            Some(count) if !is_call => seed.ok_or(Open)? % count,
            Some(count) if count > 1 && seed.ok_or(Open)? >> 30 & 3 == 0 => {
                results.clear();
                results.extend(result_types(function, site).map(Datum::anything));
                1 + seed.ok_or(Open)? % (count - 1)
            }
            Some(_) => 0,
        } as usize)
    }
}

/// The registers of a target, as test programs use them.
pub(crate) struct Registers {
    pub(crate) frame_pointer: Gpr,
    /// The address of the data, the number tag and the not-cell mask.
    pub(crate) pinned: [Gpr; 3],
    /// For operands, results and parameters.
    pub(crate) usable: RegisterSet,
    /// May be clobbered, and hold nothing else.
    pub(crate) scratch: RegisterSet,
    /// Those of `scratch` that compiled code uses like any other.
    pub(crate) allocatable_scratch: RegisterSet,
    /// Some instructions work on these only.
    pub(crate) indispensable: RegisterSet,
    pub(crate) of_signatures: RegisterSet,
    /// How many of each bank one instruction may need.
    pub(crate) least: [u32; 2],
    pub(crate) argument_gprs: &'static [Gpr],
    pub(crate) argument_fprs: &'static [Fpr],
    pub(crate) return_gprs: [Gpr; 2],
    pub(crate) return_fpr: Fpr,
    caller_saved: RegisterSet,
    saved_low_half: RegisterSet,
}

pub(crate) const NUMBER_TAG: u64 = 0xfffe_0000_0000_0000;
pub(crate) const NOT_CELL_MASK: u64 = NUMBER_TAG | 2;

pub(crate) fn registers(target: Target) -> &'static Registers {
    macro_rules! describe {
        ($arch:ident, $scratch_gprs:expr, $allocatable:expr, $special:expr, $indispensable:expr, $least:expr) => {{
            use $arch::abi::*;
            const SCRATCH: RegisterSet = RegisterSet::of(&$scratch_gprs, &SCRATCH_FPRS);
            const SPECIAL: RegisterSet = RegisterSet::of(&$special, &[]);
            const REGISTERS: Registers = Registers {
                frame_pointer: FRAME_POINTER,
                pinned: [VM, NUMBER_TAG, NOT_CELL_MASK],
                usable: ALL.difference(PINNED.union(SCRATCH).union(SPECIAL)),
                scratch: SCRATCH,
                allocatable_scratch: RegisterSet::of(&$allocatable, &[SCRATCH_FPRS[1]]),
                indispensable: RegisterSet::of(&$indispensable, &[]),
                of_signatures: RegisterSet::of(&ARGUMENT_GPRS, &ARGUMENT_FPRS)
                    .union(RegisterSet::of(&RETURN_GPRS, &[RETURN_FPR])),
                least: $least,
                argument_gprs: &ARGUMENT_GPRS,
                argument_fprs: &ARGUMENT_FPRS,
                return_gprs: RETURN_GPRS,
                return_fpr: RETURN_FPR,
                caller_saved: CALLER_SAVED.difference(SPECIAL),
                saved_low_half: CALLEE_SAVED_LOW_HALF,
            };
            &REGISTERS
        }};
    }
    match target {
        Target::X64(_) => describe!(
            x64,
            [SCRATCH_GPR],
            [SCRATCH_GPR],
            [x64::RSP, x64::RBP],
            [x64::RAX, x64::RCX, x64::RDX],
            [6, 6]
        ),
        Target::Arm64(_) => describe!(
            arm64,
            SCRATCH_GPRS,
            [],
            [arm64::SP, arm64::FP, arm64::LR],
            [],
            [11, 8]
        ),
    }
}

pub(crate) const SIGNATURE_COUNT: usize = 9;
/// Keep no register and have no results in memory.
pub(crate) const SIGNATURES_FOR_HANDLERS: [usize; 2] = [6, 7];
pub(crate) const CALLEE_COUNT: usize = 2 * SIGNATURE_COUNT;

pub(crate) struct Signature {
    pub(crate) params: Vec<(Type, Input)>,
    pub(crate) results: Vec<(Type, Output)>,
    pub(crate) clobbers: RegisterSet,
    pub(crate) clobbers_upper_halves: RegisterSet,
    pub(crate) flags: PatchpointFlags,
}

/// In the argument registers as long as there are any, then on the stack.
fn place<T>(
    registers: &Registers,
    types: &[Type],
    in_register: fn(Reg) -> T,
    on_stack: fn(i32) -> T,
) -> Vec<(Type, T)> {
    let (mut gprs, mut fprs) = (
        registers.argument_gprs.iter(),
        registers.argument_fprs.iter(),
    );
    let mut end = 0;
    let place_one = |&ty: &Type| {
        let reg = if ty.is_int() {
            gprs.next().map(|&reg| Reg::from(reg))
        } else {
            fprs.next().map(|&reg| Reg::from(reg))
        };
        let next_on_stack = || {
            let size = ty.bytes().max(8);
            end = u32::next_multiple_of(end, size) + size;
            on_stack((end - size) as i32)
        };
        (ty, reg.map_or_else(next_on_stack, in_register))
    };
    types.iter().map(place_one).collect()
}

fn describe_signature(registers: &Registers, index: usize) -> Signature {
    use Type::{F32, F64, I32, I64, V128};
    let params = |types: &[Type]| place(registers, types, Input::Fixed, Input::Outgoing);
    let [first, second] = registers.return_gprs.map(|reg| Output::Fixed(reg.into()));
    let float = Output::Fixed(registers.return_fpr.into());
    let native = |params, results, flags| Signature {
        params,
        results,
        clobbers: registers.caller_saved,
        clobbers_upper_halves: registers.saved_low_half,
        flags,
    };
    let keeping_nothing = |params, results, flags| Signature {
        params,
        results,
        clobbers: registers.usable | registers.scratch,
        clobbers_upper_halves: RegisterSet::EMPTY,
        flags,
    };
    let none = PatchpointFlags::empty();
    match index {
        0 => native(vec![], vec![], none),
        1 => native(params(&[I64, I64]), vec![(I64, first)], none),
        2 => native(
            params(&[I32, F64, I64, F32]),
            vec![(I32, first)],
            PatchpointFlags::UNEXTENDED_RESULTS,
        ),
        3 => {
            let mixed = [I64, F64, I32, F32].repeat(5);
            native(params(&mixed), vec![(F64, float)], none)
        }
        4 => native(params(&[I64]), vec![(I64, first), (I64, second)], none),
        5 => native(params(&[F64, F64]), vec![(F64, float)], none),
        6 => keeping_nothing(
            (0..4).map(|n| (I64, Input::Outgoing(8 * n))).collect(),
            vec![(I64, first)],
            PatchpointFlags::MOVES_STACK_POINTER,
        ),
        7 => keeping_nothing(
            params(&[I32, I64, F64]),
            vec![(I32, second), (F64, float), (I64, first)],
            PatchpointFlags::UNEXTENDED_OPERANDS | PatchpointFlags::UNEXTENDED_RESULTS,
        ),
        _ => {
            let results = [[I32, F32, V128, I64].repeat(4), vec![F64, I64, V128]].concat();
            keeping_nothing(
                params(&[[V128, I32, F64].repeat(5), vec![I64; 4]].concat()),
                place(registers, &results, Output::Fixed, Output::Outgoing),
                none,
            )
        }
    }
}

pub(crate) fn signature(target: Target, index: usize) -> &'static Signature {
    static TABLES: [std::sync::OnceLock<Vec<Signature>>; 2] =
        [const { std::sync::OnceLock::new() }; 2];
    let describe_all = || {
        (0..SIGNATURE_COUNT)
            .map(|index| describe_signature(registers(target), index))
            .collect()
    };
    &TABLES[usize::from(target.is_x64())].get_or_init(describe_all)[index]
}

pub(crate) fn bank_of(ty: Type) -> Bank {
    if ty.is_int() { Bank::Gpr } else { Bank::Fpr }
}
