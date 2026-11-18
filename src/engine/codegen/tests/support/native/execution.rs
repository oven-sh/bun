//! One run of a compiled program, with the patchpoints and calls of `vocabulary` done on the saved registers.

use std::collections::HashMap;

use bun_engine_asm::abi::{ALL, FRAME_POINTER as FP, STACK_POINTER as SP};
use bun_engine_asm::{Bank, Label, Reg, RegisterSet, Target};
use bun_engine_codegen::ir::{
    Action, Boundary, EffectFlags, Entity, Function, Input, Location, Op, Origin, Output,
    Patchpoint, PatchpointFlags, Store, Token, Type, Value,
};

use super::processor::{Processor, TICK, read, write};
use super::recorder::{Kind, Stop};
use super::{Compiled, host, stub};
use crate::support::datum::{Datum, all_bits};
use crate::support::harness::Case;
use crate::support::interpreter::{self, Machine, Outcome};
use crate::support::memory::{
    ARGUMENTS_SIZE, ARGUMENTS_START, DATA_SIZE, FRAME_POINTER, Input as Start, slot_address,
};
use crate::support::random::{Random, mix};
use crate::support::vocabulary::{CALLEE_COUNT, NOT_CELL_MASK, NUMBER_TAG, registers};

const MARGIN: u64 = 64;
const LOW_HALF: u128 = u64::MAX as u128;

macro_rules! require {
    ($condition:expr, $($message:tt)*) => {
        if !$condition {
            return Err(format!($($message)*));
        }
    };
}

pub(super) struct Execution<'a, 'p> {
    case: &'a Case,
    /// Says what sites do. What was compiled is what the passes made of it.
    program: &'a Function,
    sites: &'a HashMap<Token, Value>,
    compiled: &'a Compiled,
    code_start: u64,
    processor: &'a mut Processor<'p>,
    machine: Machine<'a>,
    random: Random,
    fp: u64,
    pinned: Vec<(Reg, u128)>,
    /// Bytes that must not change.
    untouched: Vec<(&'static str, u64, Vec<u8>)>,
    uses: Vec<Datum>,
    results: Vec<Datum>,
}

fn location_of(reg: Reg) -> Location {
    match reg.bank() {
        Bank::Gpr => Location::Gpr(reg.gpr()),
        Bank::Fpr => Location::Fpr(reg.fpr()),
    }
}

fn register_at(location: Location) -> Option<Reg> {
    match location {
        Location::Gpr(reg) => Some(reg.into()),
        Location::Fpr(reg) => Some(reg.into()),
        _ => None,
    }
}

fn registers_at(locations: impl IntoIterator<Item = Location>) -> RegisterSet {
    locations.into_iter().filter_map(register_at).collect()
}

fn is_late(input: Input) -> bool {
    matches!(
        input,
        Input::LateAnywhere | Input::LateRegister | Input::LateFixed(_)
    )
}

fn wants_register(input: Input) -> bool {
    !matches!(
        input,
        Input::Anywhere | Input::ColdAnywhere | Input::LateAnywhere | Input::Outgoing(_)
    )
}

impl<'a, 'p> Execution<'a, 'p> {
    pub(super) fn new(
        case: &'a Case,
        sites: &'a HashMap<Token, Value>,
        compiled: &'a Compiled,
        code_start: u64,
        processor: &'a mut Processor<'p>,
        stack_end: u64,
    ) -> Self {
        Self {
            case,
            program: &case.program.function,
            sites,
            compiled,
            code_start,
            processor,
            machine: Machine::new(&case.world.layout, case.world.target),
            random: Random::new(0),
            fp: stack_end - 4096 - 16 * (case.seed % 8),
            pinned: Vec::new(),
            untouched: Vec::new(),
            uses: Vec::new(),
            results: Vec::new(),
        }
    }

    pub(super) fn check(&mut self, index: usize) -> Result<(), String> {
        let (input, reference) = (&self.case.inputs[index], &self.case.references[index]);
        self.random = Random::new(mix(self.case.seed, 100 + index as u64));
        self.enter(input);
        let outcome = self.run(reference.steps)?;
        if let Outcome::Trap(origin) = outcome
            && self.case.world.target.is_arm64()
        {
            // The processor may have written what comes before the fault.
            let kept = DATA_SIZE as usize - self.bytes_stored_at(origin).saturating_sub(1);
            self.machine.memory.data.bits[kept..]
                .copy_from_slice(&reference.memory.data.bits[kept..]);
        }
        reference.check(&outcome, &self.machine.trace, &self.machine.memory)
    }

    fn bytes_stored_at(&self, origin: Origin) -> usize {
        let program = self.program;
        let mut all = program
            .blocks()
            .flat_map(|block| program.instructions(block));
        let found = all.find(|&value| program.origin(value) == origin);
        match found.map(|value| *program.op(value)) {
            Some(Op::Store {
                kind: Store::Full,
                args: [stored, _],
                ..
            }) => program.type_of(stored).bytes() as usize,
            Some(
                Op::Store {
                    kind: Store::Narrow(size),
                    ..
                }
                | Op::StoreLane { lanes: size, .. },
            ) => size.bytes().into(),
            _ => 0,
        }
    }

    // Places

    fn address_of(&self, label: Label) -> u64 {
        self.code_start + u64::from(self.compiled.code.offset_of(label))
    }

    fn frame_address(&self, offset: i32) -> u64 {
        self.fp.wrapping_add_signed(offset.into())
    }

    fn sp(&self) -> u64 {
        self.fp - u64::from(self.compiled.frame.size)
    }

    fn outgoing(&self, offset: i32) -> Location {
        Location::Frame(offset - self.compiled.frame.size as i32)
    }

    /// The real address, the size and the address in `memory` of each part of the frame.
    fn parts_of_frame(&self) -> impl Iterator<Item = (u64, u32, u64)> + use<'a> {
        let (program, frame, fp) = (self.program, &self.compiled.frame, self.fp);
        let reserved = program.reserved_frame_bytes;
        let below = u64::from(reserved);
        let slots = program.slots().keys().map(move |slot| {
            (
                fp.wrapping_add_signed(frame.offset_of(slot).into()),
                program.slots()[slot].size,
                slot_address(program, slot),
            )
        });
        std::iter::once((fp - below, reserved, FRAME_POINTER - below)).chain(slots)
    }

    fn translate(&self, address: u64) -> u64 {
        let above = ARGUMENTS_START as u64;
        let arguments = (self.fp + above, ARGUMENTS_SIZE, FRAME_POINTER + above);
        self.parts_of_frame()
            .chain([arguments])
            .find(|&(real, size, _)| address.wrapping_sub(real) < size.into())
            .map_or(address, |(real, _, made_up)| address - real + made_up)
    }

    fn read_bits(&self, location: Location, ty: Type) -> u128 {
        let bits = match location {
            Location::Gpr(reg) => self.processor.context.gpr(reg).into(),
            Location::Fpr(reg) => self.processor.context.get(reg.into()),
            Location::Frame(offset) => {
                let mut bytes = [0; 16];
                read(
                    self.frame_address(offset),
                    &mut bytes[..ty.bytes() as usize],
                );
                u128::from_le_bytes(bytes)
            }
            Location::Displaced(base, offset) => {
                let base = self.processor.context.gpr(base);
                base.wrapping_add_signed(offset.into()).into()
            }
            Location::Constant(bits) => bits.get().into(),
            Location::VectorConstant(constant) => self.compiled.function.vector_constant(constant),
        };
        bits & all_bits(ty)
    }

    fn read_use(&self, location: Location, value: Value) -> Datum {
        let ty = self.program.type_of(value);
        let bits = self.read_bits(location, ty);
        if ty == Type::I64 {
            self.translate(bits as u64).into()
        } else {
            bits.into()
        }
    }

    /// Leaves anything in the rest of a register, unless `is_extended` says that of an I32 it is clear.
    fn write_value(&mut self, location: Location, ty: Type, bits: u128, is_extended: bool) {
        if let Location::Frame(offset) = location {
            let bytes = bits.to_le_bytes();
            return write(self.frame_address(offset), &bytes[..ty.bytes() as usize]);
        }
        let rest = if ty == Type::I32 && is_extended {
            0
        } else {
            self.random.next128() & !all_bits(ty)
        };
        let reg = register_at(location).unwrap();
        self.processor.context.set(reg, bits | rest);
    }

    fn overwrite(&mut self, registers: RegisterSet) {
        for reg in registers {
            self.processor.context.set(reg, self.random.next128());
        }
    }

    fn overwrite_upper_halves(&mut self, registers: RegisterSet) {
        for reg in registers {
            let kept = self.processor.context.get(reg) & LOW_HALF;
            let garbage = self.random.next128() & !LOW_HALF;
            self.processor.context.set(reg, kept | garbage);
        }
    }

    fn overwrite_memory(&mut self, start: u64, end: u64) {
        for address in (start..end).step_by(8) {
            let size = (end - address).min(8) as usize;
            write(address, &self.random.next().to_le_bytes()[..size]);
        }
    }

    /// All of a short range, and the ends of a long one.
    fn ends_of(start: u64, end: u64) -> [(u64, u64); 2] {
        let middle = (start + 4 * MARGIN).min(end);
        [
            (start, middle),
            (middle.max(end.saturating_sub(MARGIN)), end),
        ]
    }

    fn unpinned(&self) -> RegisterSet {
        ALL - RegisterSet::of(&[SP, FP], &[]) - self.program.pinned
    }

    fn fetch_data(&mut self) {
        let start = self.case.world.layout.data_start();
        read(start, &mut self.machine.memory.data.bits);
    }

    fn fetch_memory(&mut self) {
        self.fetch_data();
        let mut rest = &mut self.machine.memory.frame.bits[..];
        let (program, frame) = (self.program, &self.compiled.frame);
        let reserved = program.reserved_frame_bytes;
        let slots = program.slots().keys();
        let slots = slots.map(|slot| (frame.offset_of(slot), program.slots()[slot].size));
        for (offset, size) in std::iter::once((-(reserved as i32), reserved)).chain(slots) {
            let part = rest.split_off_mut(..size as usize).unwrap();
            read(self.fp.wrapping_add_signed(offset.into()), part);
        }
    }

    fn store_memory(&self) {
        let memory = &self.machine.memory;
        write(self.case.world.layout.data_start(), &memory.data.bits);
        let mut rest = &memory.frame.bits[..];
        for (address, size, _) in self.parts_of_frame() {
            write(address, rest.split_off(..size as usize).unwrap());
        }
    }

    // What has to hold wherever the code stops

    fn watch(&mut self, name: &'static str, start: u64, end: u64) {
        let mut bytes = vec![0; (end - start) as usize];
        read(start, &mut bytes);
        self.untouched.push((name, start, bytes));
    }

    fn check_untouched(&self) -> Result<(), String> {
        let mut now = Vec::new();
        for (name, start, bytes) in &self.untouched {
            now.resize(bytes.len(), 0);
            read(*start, &mut now);
            require!(now == *bytes, "{name} changed");
        }
        for &(reg, value) in &self.pinned {
            let now = self.processor.context.get(reg);
            require!(now == value, "{reg:?} is pinned but changed to {now:#x}");
        }
        Ok(())
    }

    fn check_frame(&self) -> Result<(), String> {
        let context = &self.processor.context;
        let (fp, sp) = (context.gpr(FP), context.gpr(SP));
        require!(fp == self.fp, "the frame pointer changed to {fp:#x}");
        let distance = fp.wrapping_sub(sp) as i64;
        require!(
            sp == self.sp(),
            "the stack pointer is {distance} below the frame pointer"
        );
        let mut arguments = [0; ARGUMENTS_SIZE as usize];
        read(self.frame_address(ARGUMENTS_START), &mut arguments);
        require!(
            arguments[..] == self.machine.memory.arguments.bits,
            "arguments changed"
        );
        self.check_untouched()
    }

    // The start and the end

    fn enter(&mut self, input: &Start) {
        let (program, layout) = (self.program, &self.case.world.layout);
        let padded = &self.compiled.function;
        let (fp, sp) = (self.fp, self.sp());
        self.machine.reset(program, input, Some(&mut self.random));
        self.untouched.clear();

        let arguments_end = fp + ARGUMENTS_START as u64 + u64::from(ARGUMENTS_SIZE);
        let gap = Self::ends_of(
            fp - u64::from(padded.reserved_frame_bytes),
            fp - u64::from(program.reserved_frame_bytes),
        );
        let outgoing = Self::ends_of(sp, sp + u64::from(padded.outgoing_bytes));
        let forbidden = [
            (
                "the frame of the caller",
                arguments_end,
                arguments_end + MARGIN,
            ),
            ("reserved bytes", gap[0].0, gap[0].1),
            ("reserved bytes", gap[1].0, gap[1].1),
            (
                "what precedes the data",
                layout.data_start() - MARGIN,
                layout.data_start(),
            ),
        ];
        for (name, start, end) in forbidden {
            self.overwrite_memory(start, end);
            self.watch(name, start, end);
        }
        self.overwrite_memory(outgoing[0].0, outgoing[0].1);
        self.overwrite_memory(outgoing[1].0, gap[0].0);
        self.store_memory();
        let arguments = &self.machine.memory.arguments.bits;
        write(self.frame_address(ARGUMENTS_START), arguments);
        write(layout.read_only_start(), &input.read_only);
        let read_only_end = layout.read_only_start() + input.read_only.len() as u64;
        self.watch("read-only memory", layout.read_only_start(), read_only_end);

        self.overwrite(ALL);
        let known = [layout.data_start(), NUMBER_TAG, NOT_CELL_MASK];
        for (&reg, value) in registers(self.case.world.target).pinned.iter().zip(known) {
            self.processor.context.set_gpr(reg, value);
        }
        let context = &self.processor.context;
        self.pinned.clear();
        self.pinned.extend(
            program
                .pinned
                .into_iter()
                .map(|reg| (reg, context.get(reg))),
        );
        let entry = program.entries()[input.entry];
        let params = program.params(entry.block).iter();
        for ((&param, &boundary), &arg) in params.zip(program.entry_params(entry)).zip(&input.args)
        {
            if let Boundary::Register(reg) = boundary {
                let ty = program.type_of(param);
                self.write_value(location_of(reg), ty, arg, program.params_are_extended);
            }
        }
        let return_address = stub::address(layout.base, stub::RETURN);
        let header = [self.processor.context.gpr(FP), return_address];
        let header = header.iter().flat_map(|word| word.to_le_bytes()).collect();
        self.untouched.push(("the header of the frame", fp, header));
        host::prepare_call(&mut self.processor.context, fp + 16, return_address);
        self.processor.context.pc = self.address_of(self.compiled.entries[input.entry]);
    }

    fn run(&mut self, most_stops: u64) -> Result<Outcome, String> {
        for _ in 0..=most_stops {
            self.processor.context.compared = [(); 2].map(|()| self.random.next() << 62);
            self.processor.run();
            let reason = self.processor.context.reason as usize;
            match reason {
                stub::RETURN => return self.finish_return(),
                stub::SIGNAL => return self.finish_signal(),
                _ => {}
            }
            let offset = self.processor.context.pc.wrapping_sub(self.code_start);
            let found = self.compiled.stops.get(&offset);
            let stop = found.ok_or_else(|| format!("stub {reason} is called from {offset:#x}"))?;
            let at = |problem| format!("at {offset:#x}, {:?}: {problem}", stop.token);
            self.check_frame().map_err(at)?;
            self.fetch_memory();
            match self.act(stop, reason).map_err(at)? {
                Ok(()) => self.store_memory(),
                Err(interpreter::Stop::With(outcome)) => return Ok(outcome),
                Err(interpreter::Stop::Undefined(reason)) => return Ok(Outcome::Undefined(reason)),
            }
        }
        Ok(Outcome::OutOfFuel)
    }

    fn finish_return(&mut self) -> Result<Outcome, String> {
        let (_, _, header) = self.untouched.pop().unwrap();
        let context = &self.processor.context;
        require!(
            context.gpr(FP).to_le_bytes() == header[..8],
            "the frame pointer of the caller is lost"
        );
        require!(
            context.gpr(SP) == self.fp + 16,
            "the stack pointer of the caller is lost"
        );
        self.check_untouched()?;
        let is_return = |&value: &Value| matches!(self.program.op(value), Op::Return(_));
        let mut ends = self.program.blocks().map(|block| self.program.last(block));
        let model = ends
            .find(|end| !end.is_none() && is_return(end))
            .ok_or("returns without a return")?;
        let mut results = Vec::new();
        let mut expected = self.machine.memory.arguments.bits.clone();
        for (&value, &boundary) in self
            .program
            .operands(model)
            .iter()
            .zip(self.program.results())
        {
            let ty = self.program.type_of(value);
            let location = match boundary {
                Boundary::Register(reg) => {
                    require!(
                        ty != Type::I32 || context.get(reg) >> 32 == 0,
                        "the result in {reg:?} is not extended"
                    );
                    location_of(reg)
                }
                Boundary::Frame(offset) => {
                    let start = (offset - ARGUMENTS_START) as usize;
                    let size = ty.bytes().max(8) as usize;
                    read(self.frame_address(offset), &mut expected[start..][..size]);
                    Location::Frame(offset)
                }
            };
            results.push(self.read_bits(location, ty).into());
        }
        let mut arguments = [0; ARGUMENTS_SIZE as usize];
        read(self.frame_address(ARGUMENTS_START), &mut arguments);
        require!(arguments[..] == expected, "arguments changed");
        self.fetch_data();
        Ok(Outcome::Return(results))
    }

    fn finish_signal(&mut self) -> Result<Outcome, String> {
        let context = &self.processor.context;
        let (signal, address) = (context.signal, context.fault_address);
        let offset = context.pc.wrapping_sub(self.code_start);
        require!(signal != TICK, "does not end, and is at {offset:#x}");
        require!(
            matches!(signal, libc::SIGSEGV | libc::SIGBUS)
                && self.case.world.layout.faults_at(address)
                && offset < self.compiled.code.instructions_end().into(),
            "signal {signal} at {offset:#x} for address {address:#x}"
        );
        self.check_frame()
            .map_err(|problem| format!("at the fault at {offset:#x}: {problem}"))?;
        self.fetch_memory();
        let origins = &self.compiled.origins;
        let after = origins.partition_point(|&(start, _)| u64::from(start) <= offset);
        Ok(Outcome::Trap(origins[after - 1].1))
    }

    // Sites

    fn act(&mut self, stop: &Stop, reason: usize) -> Result<Result<(), interpreter::Stop>, String> {
        let site = self.sites[&stop.token];
        require!(
            matches!(stop.kind, Kind::Call) == (reason < CALLEE_COUNT),
            "went to stub {reason}"
        );
        let state = self.program.state(self.program.state_of(site));
        require!(
            state.len() == stop.state.len(),
            "the state has another size"
        );
        require!(
            (stop.scratch & self.program.pinned).is_empty(),
            "a scratch register is pinned"
        );
        let Op::Patchpoint(patchpoint) = *self.program.op(site) else {
            self.overwrite(stop.scratch);
            self.uses.clear();
            self.read_state(stop, site);
            return Ok(Err(self.machine.exit(self.program, stop.token, &self.uses)));
        };
        let (operands, results) = self.locate(stop, patchpoint);
        self.check_constraints(stop, site, &operands, &results)?;
        self.read_uses(stop, site, &operands, &results, reason)?;
        let invoked = self
            .machine
            .invoke(self.program, site, &self.uses, &mut self.results);
        Ok(invoked.map(|successor| self.go_on(stop, patchpoint, &results, successor)))
    }

    /// The address that an indirect call goes to is made out to be a constant.
    fn locate(&self, stop: &Stop, patchpoint: Patchpoint) -> (Vec<Location>, Vec<Location>) {
        if let Kind::Patchpoint {
            operands, results, ..
        } = &stop.kind
        {
            return (operands.clone(), results.clone());
        }
        let operand = |&input: &Input| match input {
            Input::Fixed(reg) => location_of(reg),
            Input::Outgoing(offset) => self.outgoing(offset),
            _ => Location::Gpr(FP),
        };
        let result = |&(_, output): &(Type, Output)| match output {
            Output::Fixed(reg) => location_of(reg),
            Output::Outgoing(offset) => self.outgoing(offset),
            _ => unreachable!("a callee knows where its results go"),
        };
        (
            self.program
                .inputs(patchpoint)
                .iter()
                .map(operand)
                .collect(),
            self.program
                .outputs(patchpoint)
                .iter()
                .map(result)
                .collect(),
        )
    }

    fn check_constraints(
        &self,
        stop: &Stop,
        site: Value,
        operands: &[Location],
        results: &[Location],
    ) -> Result<(), String> {
        let Op::Patchpoint(patchpoint) = *self.program.op(site) else {
            unreachable!()
        };
        let data = self.program.patchpoint(patchpoint);
        let (inputs, outputs) = (
            self.program.inputs(patchpoint),
            self.program.outputs(patchpoint),
        );
        let is_indirect = data.action == Action::CallIndirect;
        let values = self.program.operands(site);
        for position in usize::from(is_indirect)..inputs.len() {
            let (input, location) = (inputs[position], operands[position]);
            let fits = match input {
                Input::Fixed(reg) | Input::LateFixed(reg) => location == location_of(reg),
                Input::Outgoing(offset) => location == self.outgoing(offset),
                _ => !wants_register(input) || register_at(location).is_some(),
            };
            require!(fits, "operand {position} is at {location:?}");
            let must_be_extended = wants_register(input)
                && self.program.type_of(values[position]) == Type::I32
                && !data.flags.contains(PatchpointFlags::UNEXTENDED_OPERANDS);
            require!(
                !must_be_extended || self.read_bits(location, Type::I64) >> 32 == 0,
                "operand {position} is not extended"
            );
        }
        let mut written = RegisterSet::EMPTY;
        for (position, (&(_, output), &location)) in outputs.iter().zip(results).enumerate() {
            let fits = match output {
                Output::Fixed(reg) => location == location_of(reg),
                Output::Outgoing(offset) => location == self.outgoing(offset),
                _ => register_at(location).is_some_and(|reg| self.unpinned().contains(reg)),
            };
            let reg = registers_at([location]);
            require!(
                fits && (written & reg).is_empty(),
                "result {position} is at {location:?}"
            );
            written |= reg;
        }
        let edges = if data.effects.has(EffectFlags::ENDS_BLOCK) {
            self.program.successors(self.program.block_of(site)).len()
        } else {
            0
        };
        let returns = data.action != Action::Custom;
        require!(
            stop.labels.len() == edges.saturating_sub(returns.into()),
            "has another number of successors"
        );
        let Kind::Patchpoint {
            live_registers,
            live_vectors,
            ..
        } = stop.kind
        else {
            return Ok(());
        };
        require!(
            (written & stop.scratch).is_empty(),
            "a result is in a scratch register"
        );
        let lost = data.clobbers_early | data.clobbers_late | stop.scratch | written;
        require!(
            (live_registers & lost).is_empty()
                && (live_vectors & data.clobbers_upper_halves).is_empty()
                && (live_vectors - live_registers.in_bank(Bank::Fpr)).is_empty(),
            "{live_registers:?} and {live_vectors:?} cannot be live"
        );
        Ok(())
    }

    fn read_state(&mut self, stop: &Stop, site: Value) {
        let state = self.program.state(self.program.state_of(site));
        for (&location, &value) in stop.state.iter().zip(state) {
            self.uses.push(self.read_use(location, value));
        }
    }

    fn read_uses(
        &mut self,
        stop: &Stop,
        site: Value,
        operands: &[Location],
        results: &[Location],
        reason: usize,
    ) -> Result<(), String> {
        let (program, callees) = (self.program, &self.case.world.layout.callees);
        let Op::Patchpoint(patchpoint) = *program.op(site) else {
            unreachable!()
        };
        let data = program.patchpoint(patchpoint);
        let (inputs, outputs) = (program.inputs(patchpoint), program.outputs(patchpoint));
        let values = program.operands(site);

        let early = outputs.iter().zip(results);
        let early = early.filter(|((_, output), _)| *output == Output::EarlyRegister);
        let early = registers_at(early.map(|(_, &location)| location));
        if matches!(stop.kind, Kind::Patchpoint { .. }) {
            self.overwrite(stop.scratch);
        }
        self.overwrite(data.clobbers_early | early);
        self.uses.clear();
        for ((&location, &value), &input) in operands.iter().zip(values).zip(inputs) {
            self.uses.push(if is_late(input) {
                0u64.into()
            } else {
                self.read_use(location, value)
            });
        }

        let consumed = inputs.iter().zip(operands);
        let consumed = consumed.filter(|&(&input, _)| input == Input::ConsumedRegister);
        let consumed = registers_at(consumed.map(|(_, &location)| location));
        let written = registers_at(results.iter().copied());
        self.overwrite(data.clobbers_late | stop.scratch | consumed | written);
        self.overwrite_upper_halves(data.clobbers_upper_halves);
        let sp = self.sp();
        let outgoing = u64::from(self.compiled.function.outgoing_bytes);
        for (start, end) in Self::ends_of(sp - 2 * MARGIN, sp + outgoing) {
            self.overwrite_memory(start, end);
        }
        let arguments = inputs.iter().zip(values);
        let arguments = arguments.filter_map(|(&input, &value)| match input {
            Input::Outgoing(offset) => Some((offset, program.type_of(value))),
            _ => None,
        });
        let returned = outputs.iter().filter_map(|&(ty, output)| match output {
            Output::Outgoing(offset) => Some((offset, ty)),
            _ => None,
        });
        for (offset, ty) in arguments.chain(returned) {
            let start = sp + offset as u64;
            self.overwrite_memory(start, start + u64::from(ty.bytes().max(8)));
        }
        for (position, &input) in inputs.iter().enumerate() {
            if is_late(input) {
                self.uses[position] = self.read_use(operands[position], values[position]);
            }
        }
        self.read_state(stop, site);

        match data.action {
            Action::Custom | Action::CustomCall => {}
            Action::Call(Target::Symbol(callee)) => {
                require!(callee as usize == reason, "calls {reason}");
            }
            Action::Call(Target::Address(callee)) => {
                require!(callee as u64 == callees[reason], "calls {reason}");
            }
            Action::CallIndirect => self.uses[0] = callees[reason].into(),
        }
        Ok(())
    }

    fn go_on(
        &mut self,
        stop: &Stop,
        patchpoint: Patchpoint,
        results: &[Location],
        successor: usize,
    ) {
        let data = self.program.patchpoint(patchpoint);
        let returns = data.action != Action::Custom;
        if returns && successor != 0 {
            self.overwrite(self.unpinned());
            self.processor.context.pc = self.address_of(stop.labels[successor - 1]);
            return;
        }
        let mut destination = None;
        if let Kind::Patchpoint {
            live_registers,
            live_vectors,
            falls_through_to,
            ..
        } = stop.kind
        {
            self.overwrite(self.unpinned() - live_registers);
            self.overwrite_upper_halves(live_registers.in_bank(Bank::Fpr) - live_vectors);
            if !returns && falls_through_to != Some(successor) {
                destination = stop.labels.get(successor).copied();
            }
        }
        let is_extended = !data.flags.contains(PatchpointFlags::UNEXTENDED_RESULTS);
        let outputs = self.program.outputs(patchpoint);
        for (position, &(ty, _)) in outputs.iter().enumerate() {
            let bits = self.results[position].bits;
            self.write_value(results[position], ty, bits, is_extended);
        }
        if let Some(label) = destination {
            self.processor.context.pc = self.address_of(label);
        } else if data.flags.contains(PatchpointFlags::MOVES_STACK_POINTER) {
            let moved = self.sp() - 16 * self.random.below(8) as u64;
            self.processor.context.set_gpr(SP, moved);
        }
    }
}

/// The slots are aligned, apart, and between what is reserved at either end.
pub(super) fn check_layout(compiled: &Compiled) -> Result<(), String> {
    let (function, frame) = (&compiled.function, &compiled.frame);
    require!(frame.size % 16 == 0, "the frame has {} bytes", frame.size);
    let range = |slot| {
        let start = i64::from(frame.offset_of(slot));
        (start, start + i64::from(function.slots()[slot].size))
    };
    let lowest = i64::from(function.outgoing_bytes) - i64::from(frame.size);
    let highest = -i64::from(function.reserved_frame_bytes);
    require!(lowest <= highest, "the frame is too small");
    for slot in function.slots().keys() {
        let (start, end) = range(slot);
        let earlier = function.slots().keys().take(slot.index());
        require!(
            start % i64::from(function.slots()[slot].alignment) == 0
                && lowest <= start
                && end <= highest
                && earlier.map(range).all(|(a, b)| b <= start || end <= a),
            "{slot:?} is at {start}"
        );
    }
    Ok(())
}
