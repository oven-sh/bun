//! Runs operations of the macro assembler on the processor and compares all that they change with a model.
//!
//! `ASM_TEST_SEED` and `ASM_TEST_RUNS` vary the operands, and `ASM_TEST_TRACE` names each case before it runs.

#![allow(
    dead_code,
    unused_macros,
    clippy::disallowed_methods,
    clippy::disallowed_macros
)]

#[cfg_attr(target_arch = "aarch64", path = "arm64.rs")]
#[cfg_attr(target_arch = "x86_64", path = "x86_64.rs")]
pub(crate) mod host;
pub(crate) mod memory;
pub(crate) mod model;
pub(crate) mod operands;
pub(crate) mod operation;
pub(crate) mod values;

use std::fmt::Write as _;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Amount, Bank, Code, Features, Memory, Options, Reg, Scratch, Src};
use bun_engine_exec_memory::{CodeHandle, Priority, link};

use memory::{Arena, STACK_REACH, WINDOW_SIZE};
pub(crate) use model::{Machine, Outcome, Registers};
use operands::{SP, operand_registers};
use operation::Names;
pub(crate) use operation::Operation;
#[allow(unused_imports)]
pub(crate) use operation::op;
use values::{Boundaries, FOREMOST_FLOATS, Kind, Random, mask};

pub(crate) const WIDTHS: [Width; 2] = [Width::W32, Width::W64];
pub(crate) const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];
pub(crate) const SIGNS: [Sign; 2] = [Sign::Signed, Sign::Unsigned];
pub(crate) const FLOAT_WIDTHS: [FloatWidth; 2] = [FloatWidth::F32, FloatWidth::F64];

/// Where the harness keeps its own data, from the stack pointer.
mod slot {
    pub(super) const ENTRY: i32 = 0x3000;
    pub(super) const EXIT: i32 = ENTRY + 8;
    pub(super) const REGISTERS: i32 = ENTRY + 16;
    pub(super) const BRANCHED: i32 = ENTRY + 24;
}

const CASES_IN_A_BATCH: usize = 192;
const USUAL_RUNS: usize = 8;
const MOST_ATTEMPTS: usize = 200;
const BEFORE_OPERAND: usize = 48;
const REGION_SIZE: usize = 128;
const NOISE_SIZE: usize = 4096;

#[derive(Clone, Copy)]
enum Input {
    Gpr(Gpr, Size),
    Fpr(Fpr, FloatWidth),
    Mem(Memory, Kind),
}

impl Input {
    fn kind(self) -> Kind {
        match self {
            Self::Gpr(_, size) => Kind::Int(size),
            Self::Fpr(_, width) => Kind::Float(width),
            Self::Mem(_, kind) => kind,
        }
    }
}

pub(crate) struct Case {
    operation: Operation,
    model: Box<dyn Fn(&mut Machine) -> Outcome>,
    prepare: Vec<Box<dyn Fn(&mut Machine, &mut Random) -> bool>>,
    inputs: Vec<Input>,
    memories: Vec<Memory>,
    alignment: usize,
    constant: Option<u64>,
    has_untrusted_constant: bool,
    clobbers: RegisterSet,
    keeps_first_scratch: bool,
    overwrites_free_stack: bool,
    tries_all_boundaries: bool,
}

impl Case {
    pub(crate) fn new<O: Into<Outcome>>(
        operation: Operation,
        model: impl Fn(&mut Machine) -> O + 'static,
    ) -> Self {
        Self {
            operation,
            model: Box::new(move |machine| model(machine).into()),
            prepare: Vec::new(),
            inputs: Vec::new(),
            memories: Vec::new(),
            alignment: 1,
            constant: None,
            has_untrusted_constant: false,
            clobbers: RegisterSet::EMPTY,
            keeps_first_scratch: false,
            overwrites_free_stack: false,
            tries_all_boundaries: false,
        }
    }

    pub(crate) fn reads(mut self, size: Size, src: impl Into<Src>) -> Self {
        match src.into() {
            Src::Reg(SP) => {}
            Src::Reg(reg) => self.inputs.push(Input::Gpr(reg, size)),
            Src::Imm(value) => self.constant = Some(value as u64),
            Src::Untrusted(value) => {
                self.constant = Some(value as u64);
                self.has_untrusted_constant = true;
            }
            Src::Mem(memory) => {
                self.inputs.push(Input::Mem(memory, Kind::Int(size)));
                self.memories.push(memory);
            }
        }
        self
    }

    pub(crate) fn reads_amount(self, amount: Amount) -> Self {
        match amount {
            Amount::Reg(reg) => self.reads(Size::S8, reg),
            Amount::Imm(_) => self,
        }
    }

    pub(crate) fn reads_float(mut self, width: FloatWidth, reg: Fpr) -> Self {
        self.inputs.push(Input::Fpr(reg, width));
        self
    }

    /// Makes the address valid.
    pub(crate) fn accesses(mut self, memory: impl Into<Memory>) -> Self {
        self.memories.push(memory.into());
        self
    }

    pub(crate) fn aligned(mut self, size: Size) -> Self {
        self.alignment = size.bytes().into();
        self
    }

    /// Runs after the operands are chosen. It may change them, or return false to pass them over.
    pub(crate) fn given(
        mut self,
        prepare: impl Fn(&mut Machine, &mut Random) -> bool + 'static,
    ) -> Self {
        self.prepare.push(Box::new(prepare));
        self
    }

    pub(crate) fn clobbers(mut self, registers: RegisterSet) -> Self {
        self.clobbers = registers;
        self
    }

    pub(crate) fn keeps_first_scratch(mut self) -> Self {
        self.keeps_first_scratch = true;
        self
    }

    pub(crate) fn overwrites_free_stack(mut self) -> Self {
        self.overwrites_free_stack = true;
        self
    }

    /// Of the first two operands.
    pub(crate) fn with_all_boundaries(mut self, wanted: bool) -> Self {
        self.tries_all_boundaries = wanted;
        self
    }
}

/// For an operation that has the stack pointer as its destination. The result ends up in `keeper`, which is no operand.
pub(crate) fn moving_stack_pointer(
    operation: Operation,
    keeper: Gpr,
    model: impl Fn(&mut Machine) + 'static,
) -> Case {
    let operation = operation.wrapped(keeper, move |masm, _, emit| {
        emit(masm);
        host::exchange_with_stack_pointer(masm.assembler(), keeper);
    });
    Case::new(operation, move |machine| {
        let old = machine.get64(SP);
        model(machine);
        machine.set64(keeper, machine.get64(SP));
        machine.set64(SP, old);
    })
    .given(move |machine, _| {
        machine.set64(keeper, machine.get64(SP));
        true
    })
}

fn variable(name: &str) -> Option<u64> {
    std::env::var(name).ok().map(|text| text.parse().unwrap())
}

pub(crate) fn seed() -> u64 {
    variable("ASM_TEST_SEED").unwrap_or(1)
}

pub(crate) fn scaled_runs(runs: usize) -> usize {
    runs * variable("ASM_TEST_RUNS").unwrap_or(1) as usize
}

pub(crate) fn feature_sets() -> Vec<Features> {
    let host = Features::host();
    (0..=host.bits())
        .filter_map(Features::from_bits)
        .filter(|&features| host.contains(features))
        .collect()
}

pub(crate) fn install(code: &Code) -> CodeHandle {
    link(code, Priority::Required, |_| unreachable!()).unwrap()
}

/// Those with which the first constant that can be disguised is.
fn disguising_seeds() -> Vec<u64> {
    let bytes = |seed, src: Untrusted<i64>| {
        let mut masm = MacroAssembler::new(Options {
            features: Features::empty(),
            shorten_jumps: false,
            seed,
        });
        masm.move32(abi::RETURN_GPRS[0], src);
        masm.size()
    };
    let constant = Untrusted(0x1234_5678);
    let least = (0..64).map(|seed| bytes(seed, constant)).min().unwrap();
    let seeds = (0..2048).filter(|&seed| bytes(seed, constant) > least);
    seeds.collect()
}

struct Region {
    start: usize,
    before: [u8; REGION_SIZE],
    expected: [u8; REGION_SIZE],
}

pub(crate) struct Harness {
    pub(crate) random: Random,
    pub(crate) operand_registers: RegisterSet,
    /// What the case that is running may overwrite.
    free: RegisterSet,
    arena: Arena,
    stack_pointer: usize,
    enter: CodeHandle,
    exit: CodeHandle,
    boundaries: Boundaries,
    noise: Vec<u8>,
    feature_sets: Vec<Features>,
    disguising_seeds: Vec<u64>,
    cases: Vec<Case>,
    batches: usize,
    runs: usize,
    traces: bool,
}

impl Harness {
    pub(crate) fn new() -> Self {
        let mut arena = Arena::new();
        let mut random = Random(seed());
        let mut exit = Self::assembler(Features::empty(), false, 0);
        host::exit(exit.assembler());
        Self {
            operand_registers: operand_registers(),
            free: RegisterSet::EMPTY,
            stack_pointer: arena.stack_pointer(),
            arena,
            enter: install(&host::enter()),
            exit: install(&exit.finish().unwrap()),
            boundaries: Boundaries::new(),
            noise: (0..NOISE_SIZE).map(|_| random.next() as u8).collect(),
            random,
            feature_sets: feature_sets(),
            disguising_seeds: disguising_seeds(),
            cases: Vec::new(),
            batches: 0,
            runs: scaled_runs(USUAL_RUNS),
            traces: variable("ASM_TEST_TRACE").is_some(),
        }
    }

    pub(crate) fn assembler(features: Features, shorten_jumps: bool, seed: u64) -> MacroAssembler {
        MacroAssembler::new(Options {
            features,
            shorten_jumps,
            seed,
        })
    }

    pub(crate) fn default_scratch() -> Scratch {
        Self::assembler(Features::empty(), false, 0).scratch()
    }

    /// For the operations that leave these registers alone.
    pub(crate) fn use_first_scratch_for_operands(&mut self) {
        let scratch = Self::default_scratch();
        self.operand_registers.insert(scratch.gprs[0].unwrap());
        self.operand_registers.insert(scratch.fprs[0].unwrap());
    }

    pub(crate) fn stack_pointer(&self) -> usize {
        self.stack_pointer
    }

    fn is_on_stack(offset: i32) -> bool {
        let is_near_slots = offset.abs_diff(slot::ENTRY) < 2 * REGION_SIZE as u32;
        offset.unsigned_abs() as usize <= STACK_REACH - REGION_SIZE && !is_near_slots
    }

    pub(crate) fn absolute_addresses(&mut self) -> Vec<Absolute> {
        let mut all = Vec::new();
        for window in self.arena.windows() {
            let round = (window + REGION_SIZE).next_multiple_of(1 << 16);
            let any = window + REGION_SIZE + self.random.below(WINDOW_SIZE - 2 * REGION_SIZE);
            let near_round = self
                .random
                .pick(&[round, round + 8, round - 8, round + 4095]);
            all.extend([near_round, any, any & !15].map(Absolute));
        }
        all
    }

    pub(crate) fn add(&mut self, case: Case) {
        self.cases.push(case);
        if self.cases.len() == CASES_IN_A_BATCH {
            self.run_batch();
        }
    }

    /// Registers that the case leaves free, if there are any.
    fn other_scratch(&mut self, case: &Case) -> Scratch {
        let usual = Self::default_scratch();
        let mut free = self.operand_registers - case.operation.names - case.clobbers;
        for &memory in &case.memories {
            free -= memory.names();
        }
        if free.gprs().count() < 2 || free.fprs().count() < 2 {
            return usual;
        }
        let mut take = |bank| {
            let candidates: Vec<Reg> = free.in_bank(bank).into_iter().collect();
            let reg = self.random.pick(&candidates);
            free.remove(reg);
            reg
        };
        Scratch {
            gprs: usual.gprs.map(|reg| reg.map(|_| take(Bank::Gpr).gpr())),
            fprs: usual.fprs.map(|reg| reg.map(|_| take(Bank::Fpr).fpr())),
        }
    }

    fn run_batch(&mut self) {
        let cases = std::mem::take(&mut self.cases);
        self.batches += 1;
        let usual = vec![Self::default_scratch(); cases.len()];
        let other: Vec<Scratch> = cases.iter().map(|case| self.other_scratch(case)).collect();
        let mut configurations = vec![
            (Features::empty(), false, &other),
            (Features::host(), true, &other),
        ];
        for &features in &self.feature_sets {
            configurations.extend([(features, false, &usual), (features, true, &usual)]);
        }
        let mut seen: Vec<Vec<u8>> = Vec::new();
        for (features, shorten_jumps, scratch) in configurations {
            let masm = Self::assembler(features, shorten_jumps, self.batches as u64);
            let (code, entries) = self.assemble(masm, &cases, scratch, shorten_jumps.into());
            if !seen.iter().any(|bytes| bytes == code.bytes()) {
                seen.push(code.bytes().into());
                self.run_cases(&cases, scratch, &code, &entries, features);
            }
        }
        if self.disguising_seeds.is_empty() {
            return;
        }
        for index in (0..cases.len()).filter(|&index| cases[index].has_untrusted_constant) {
            let features = self.random.pick(&self.feature_sets);
            let masm = Self::assembler(features, true, self.random.pick(&self.disguising_seeds));
            let (case, variant) = (&cases[index..=index], self.random.below(4));
            let scratch = &self.random.pick(&[&usual, &other])[index..=index];
            let (code, entries) = self.assemble(masm, case, scratch, variant);
            self.run_cases(case, scratch, &code, &entries, features);
        }
    }

    /// Returns where each case starts and ends.
    fn assemble(
        &self,
        mut masm: MacroAssembler,
        cases: &[Case],
        scratch: &[Scratch],
        variant: usize,
    ) -> (Code, Vec<[Label; 2]>) {
        let (behind, ahead) = (masm.here(), masm.new_label());
        host::exit(masm.assembler());
        let outside = masm.external_address(self.exit.start());
        let mut entries = Vec::with_capacity(cases.len());
        for (index, case) in cases.iter().enumerate() {
            let (start, next) = (masm.here(), masm.new_label());
            let target = [next, behind, ahead, outside][(index + variant) % 4];
            masm.set_scratch(scratch[index]);
            (case.operation.emit)(&mut masm, target);
            entries.push([start, masm.mark()]);
            host::note_fall_through(masm.assembler());
            masm.bind(next);
            host::exit(masm.assembler());
        }
        if self.batches.is_multiple_of(8) && cases.len() > 1 {
            for _ in 0..8192 {
                masm.nop();
            }
        }
        masm.bind(ahead);
        host::exit(masm.assembler());
        (masm.finish().unwrap(), entries)
    }

    fn run_cases(
        &mut self,
        cases: &[Case],
        scratch: &[Scratch],
        code: &Code,
        entries: &[[Label; 2]],
        features: Features,
    ) {
        let handle = install(code);
        for ((case, ends), scratch) in cases.iter().zip(entries).zip(scratch) {
            if self.traces {
                eprintln!("{} with {features:?}", (case.operation.describe)());
            }
            let [start, end] = ends.map(|label| code.offset_of(label));
            let kept = usize::from(case.keeps_first_scratch);
            let gprs: RegisterSet = scratch.gprs[kept..].iter().flatten().copied().collect();
            let fprs: RegisterSet = scratch.fprs[kept..].iter().flatten().copied().collect();
            self.free = gprs | fprs | case.clobbers | RegisterSet::of(host::UNCHECKED, &[]);
            if let Err(difference) = self.run_case(case, handle.address(start)) {
                let bytes = &code.bytes()[start as usize..end as usize];
                let listing = crate::support::disassemble(&host::LLVM_ARGUMENTS, bytes);
                panic!(
                    "{} with {features:?} and {scratch:?}\n{difference}{}",
                    (case.operation.describe)(),
                    listing.unwrap_or_default().join("\n")
                );
            }
        }
    }

    fn run_case(&mut self, case: &Case, entry: usize) -> Result<(), String> {
        let mut machine = Machine {
            registers: Registers {
                fprs: std::array::from_fn(|_| self.random.vector()),
                gprs: std::array::from_fn(|_| self.random.next()),
                host_stack: 0,
            },
            unspecified: Vec::new(),
            written: RegisterSet::EMPTY,
        };
        machine.set64(SP, self.stack_pointer as u64);
        let mut accepted = 0;
        if case.tries_all_boundaries {
            for values in self.boundary_operands(case) {
                accepted += usize::from(self.run_once(case, entry, &mut machine, &values)?);
            }
        }
        let mut attempts = 0;
        while attempts < self.runs || accepted == 0 && attempts < MOST_ATTEMPTS {
            attempts += 1;
            let values = self.drawn_operands(case, Vec::new());
            accepted += usize::from(self.run_once(case, entry, &mut machine, &values)?);
        }
        if accepted == 0 {
            return Err("no operands were accepted\n".into());
        }
        Ok(())
    }

    /// Adds to `values` those for the remaining inputs.
    fn drawn_operands(&mut self, case: &Case, mut values: Vec<u64>) -> Vec<u64> {
        for input in &case.inputs[values.len()..] {
            let related = values.last().copied().or(case.constant);
            values.push(
                self.boundaries
                    .draw(input.kind(), related, &mut self.random),
            );
        }
        values
    }

    fn boundary_operands(&mut self, case: &Case) -> Vec<Vec<u64>> {
        let first = self.boundaries.of(case.inputs[0].kind());
        let mut all = Vec::new();
        if let Some(input) = case.inputs.get(1) {
            let wants_all = self.runs > USUAL_RUNS || matches!(input.kind(), Kind::Int(_));
            for (i, &a) in first.iter().enumerate() {
                for (j, &b) in self.boundaries.of(input.kind()).iter().enumerate() {
                    if wants_all || i.min(j) < FOREMOST_FLOATS {
                        all.push(vec![a, b]);
                    }
                }
            }
        } else {
            all.extend(first.iter().map(|&value| vec![value]));
        }
        let complete = |values| self.drawn_operands(case, values);
        all.into_iter().map(complete).collect()
    }

    /// Chooses the registers of the address that are not `fixed` so that it is in the arena.
    fn place(
        &mut self,
        machine: &mut Machine,
        address: Address,
        alignment: usize,
        fixed: &mut RegisterSet,
    ) {
        let alignment = self.random.pick(&[alignment, alignment, 16]);
        let window = self.stack_pointer + (2 << 20);
        let target = (window + self.random.below(WINDOW_SIZE)) & !(alignment - 1);
        let rest = (target as u64).wrapping_sub_signed(address.offset().into());
        let (base, spare_bits) = (address.base(), self.random.next());
        match address.index() {
            Some((index, Scale::One)) if index == base && !fixed.contains(base) => {
                machine.set64(base, rest >> 1 | spare_bits << 63);
            }
            Some((index, scale)) if index == base && !fixed.contains(base) => {
                const INVERSES: [u64; 3] = [
                    0xaaaa_aaaa_aaaa_aaab,
                    0xcccc_cccc_cccc_cccd,
                    0x8e38_e38e_38e3_8e39,
                ];
                machine.set64(base, rest.wrapping_mul(INVERSES[scale as usize - 1]));
            }
            Some((index, scale)) if !fixed.contains(base) => {
                machine.set64(
                    base,
                    rest.wrapping_sub(machine.get64(index) << scale.log2()),
                );
            }
            Some((index, scale)) if !fixed.contains(index) => {
                let log2 = u32::from(scale.log2());
                let high = spare_bits.checked_shl(64 - log2).unwrap_or(0);
                machine.set64(index, rest.wrapping_sub(machine.get64(base)) >> log2 | high);
            }
            None if !fixed.contains(base) => machine.set64(base, rest),
            _ => {}
        }
        fixed.insert(base);
        if let Some((index, _)) = address.index() {
            fixed.insert(index);
        }
    }

    fn is_usable(&self, memory: Memory, address: usize, alignment: usize) -> bool {
        let offset = i32::try_from(address.wrapping_sub(self.stack_pointer) as isize);
        address.is_multiple_of(alignment)
            && (matches!(memory, Memory::Absolute(_)) || offset.is_ok_and(Self::is_on_stack))
    }

    /// Returns whether the operands were accepted.
    fn run_once(
        &mut self,
        case: &Case,
        entry: usize,
        machine: &mut Machine,
        values: &[u64],
    ) -> Result<bool, String> {
        for (&input, &value) in case.inputs.iter().zip(values) {
            let kept = mask(input.kind().size());
            match input {
                Input::Gpr(reg, _) => machine.set64(reg, self.random.next() & !kept | value),
                Input::Fpr(reg, _) => {
                    let above = self.random.vector() & !u128::from(kept);
                    machine.set_vector(reg, above | u128::from(value));
                }
                Input::Mem(..) => {}
            }
        }
        let mut fixed = RegisterSet::of(&[SP], &[]);
        let mut starts = vec![self.stack_pointer - REGION_SIZE, self.stack_pointer];
        for &memory in &case.memories {
            if let Memory::Address(address) = memory {
                self.place(machine, address, case.alignment, &mut fixed);
            }
            let address = machine.address(memory);
            if !self.is_usable(memory, address, case.alignment) {
                return Ok(false);
            }
            starts.push(address - BEFORE_OPERAND);
        }
        for &start in &starts {
            let first = self.random.below(NOISE_SIZE - REGION_SIZE);
            memory::write(start, &self.noise[first..][..REGION_SIZE]);
        }
        for (&input, &value) in case.inputs.iter().zip(values) {
            if let Input::Mem(memory, kind) = input {
                machine.store(kind.size(), memory, value);
            }
        }
        if !(case.prepare.iter()).all(|prepare| prepare(machine, &mut self.random)) {
            return Ok(false);
        }

        let before = machine.registers.clone();
        let mut regions: Vec<Region> = (starts.into_iter())
            .map(|start| Region {
                start,
                before: [0; REGION_SIZE],
                expected: [0; REGION_SIZE],
            })
            .collect();
        for region in &mut regions {
            memory::read(region.start, &mut region.before);
        }
        machine.unspecified.clear();
        machine.written = RegisterSet::EMPTY;
        let outcome = (case.model)(machine);
        for region in &mut regions {
            memory::read(region.start, &mut region.expected);
        }
        for region in &regions {
            memory::write(region.start, &region.before);
        }

        let mut actual = before.clone();
        let branched = self.execute(entry, &mut actual);

        for reg in self.free - machine.written {
            machine.forget(reg);
        }
        machine.accept(&actual, branched);
        let mut difference = String::new();
        if outcome != Outcome::Either && outcome != branched.into() {
            writeln!(difference, "expected {outcome:?}").unwrap();
        }
        if machine.registers != actual {
            describe_registers(&mut difference, &machine.registers, &actual);
        }
        let mut bytes = [0; REGION_SIZE];
        for region in &regions[usize::from(case.overwrites_free_stack)..] {
            memory::read(region.start, &mut bytes);
            if bytes != region.expected {
                let (start, before, expected) = (region.start, region.before, region.expected);
                writeln!(difference, "at {start:x}\nbefore   {before:02x?}").unwrap();
                writeln!(
                    difference,
                    "expected {expected:02x?}\nactual   {bytes:02x?}"
                )
                .unwrap();
            }
        }
        if !difference.is_empty() {
            writeln!(difference, "operands {values:x?}\ngprs {:x?}", before.gprs).unwrap();
            return Err(difference);
        }
        machine.registers = before;
        Ok(true)
    }

    /// Returns whether the code left without falling through.
    pub(crate) fn execute(&mut self, entry: usize, registers: &mut Registers) -> bool {
        let slot = |offset: i32| self.stack_pointer + offset as usize;
        let pointer: *mut Registers = registers;
        memory::write(slot(slot::ENTRY), &entry.to_le_bytes());
        memory::write(
            slot(slot::REGISTERS),
            &pointer.expose_provenance().to_le_bytes(),
        );
        memory::write(slot(slot::BRANCHED), &1usize.to_le_bytes());
        // SAFETY: `enter` has this type, and the code at `entry` ends by leaving through the slot.
        unsafe { std::mem::transmute::<usize, host::Enter>(self.enter.start())(pointer) };
        registers.host_stack = 0;
        let mut branched = [0];
        memory::read(slot(slot::BRANCHED), &mut branched);
        branched != [0]
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            self.run_batch();
        }
    }
}

fn describe_registers(text: &mut String, expected: &Registers, actual: &Registers) {
    for (number, (expected, actual)) in expected.gprs.iter().zip(actual.gprs).enumerate() {
        if *expected != actual {
            writeln!(text, "r{number} is {actual:x} instead of {expected:x}").unwrap();
        }
    }
    for (number, (expected, actual)) in expected.fprs.iter().zip(actual.fprs).enumerate() {
        if *expected != actual {
            writeln!(text, "f{number} is {actual:x} instead of {expected:x}").unwrap();
        }
    }
}
