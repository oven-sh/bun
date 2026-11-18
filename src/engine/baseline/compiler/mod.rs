//! One pass over the instructions for what is likely, and one over what that left out.

#![forbid(unsafe_code)]

mod access;
mod allocation;
mod arithmetic;
mod call;
mod control;
mod element;
mod frame;
mod iteration;
mod native;
mod operand;
mod property;
mod scope;
mod string;
mod suspension;
mod template;
mod test;

use core::cell::Cell;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code as MachineCode, CodeTooLarge};
use bun_engine_bytecode::{
    Body, Code, Flow, Instruction, Instructions, Jump, Opcode, RawInstruction, Register, Shape,
};
use bun_engine_interpreter::outcome;
use bun_engine_vm::{Arithmetic, CellType, CodeBlock, is_optimizable};
use smallvec::SmallVec;

use crate::emit::{Emit, WORD, assembler_options, at};
use crate::profiles::{Likely, Profiles};
use crate::registers::*;
use crate::thunks::Thunks;

pub(crate) use call::ENTRY;
pub(crate) use scope::emit_resolve_dynamic;

/// An instruction, and where its code starts.
#[derive(Clone, Copy)]
pub(crate) struct Step {
    pub(crate) raw: RawInstruction,
    pub(crate) label: Label,
    /// What it expects to find in `T0`.
    pub(crate) carried: Option<Register>,
    /// To the interpreter.
    pub(crate) is_left_out: bool,
}

pub(crate) struct Compiled<'a> {
    pub(crate) code: &'a MachineCode,
    pub(crate) entry: Label,
    pub(crate) cold: Label,
    pub(crate) steps: &'a [Step],
    /// What the code takes for recorded already, by the word of the profile.
    pub(crate) assumed: &'a [(u32, Arithmetic)],
}

/// In a place, besides the index of the step.
const IS_TARGET: u32 = 1 << 31;

/// Memory that one compilation leaves to the next.
#[derive(Default)]
struct Buffers {
    assembler: Option<(MacroAssembler, MachineCode)>,
    steps: Vec<Step>,
    places: Vec<u32>,
    likely_locals: Vec<Likely>,
    cold: Vec<Cold>,
    assumed: Vec<(u32, Arithmetic)>,
}

thread_local! {
    static BUFFERS: Cell<Buffers> = Cell::default();
}

/// Code that is out of the way.
#[derive(Clone, Copy)]
struct Cold {
    emit: fn(&mut Compiler<'_>, &Cold),
    offset: u32,
    entry: Label,
    /// The end of the instruction, unless it asked for another place.
    resume: Label,
    /// Does all of the instruction.
    slow: Label,
    /// For what has a second way to go on.
    other: Label,
    carried: Option<Register>,
}

pub(crate) struct Compiler<'a> {
    m: MacroAssembler,
    code: &'a Code,
    body: &'a Body,
    profiles: Profiles<'a>,
    thunks: &'a Thunks,
    coroutine_type: CellType,
    /// Whether there is a tier above, for which to count and to record what happens.
    records: bool,
    /// Whether the code may be made again. It leaves out what has never run, and counts what it is not prepared for.
    is_provisional: bool,
    first_constant: u32,
    reads_scope: bool,
    steps: Vec<Step>,
    /// By offset.
    places: Vec<u32>,
    /// By the index of the local.
    likely_locals: Vec<Likely>,
    cold: Vec<Cold>,
    assumed: Vec<(u32, Arithmetic)>,

    offset: u32,
    /// The register whose value is in `T0`.
    carried: Option<Register>,
    /// That value is a boolean, whichever way it came about.
    carries_boolean: bool,
    incoming: Option<Register>,
    is_incoming_boolean: bool,
    uses_incoming: bool,
    slow: Option<Label>,
    end: Option<Label>,
}

/// Of what follows a code block.
const MOST_WORDS: usize = 1 << 26;

pub(crate) fn release_memory() {
    BUFFERS.take();
}

fn emptied<T>(mut buffer: Vec<T>, capacity: usize) -> Vec<T> {
    buffer.clear();
    buffer.reserve(capacity);
    buffer
}

pub(crate) fn compile<T>(
    code_block: &CodeBlock,
    thunks: &Thunks,
    (seed, is_provisional): (u64, bool),
    install: impl FnOnce(&Compiled<'_>) -> T,
) -> Result<T, CodeTooLarge> {
    /// What it takes to compile more bytes or locals, or to make more code, is not kept.
    const LONG: usize = 1024;
    const LONG_CODE: usize = 32 * LONG;
    let (code, body): (&Code, _) = (code_block.code(), code_block.body());
    let size = body.instructions().len();
    let linked = code.constants.len() + code.functions.len() + code.scopes.len();
    let first_constant = CodeBlock::first_constant(body);
    if first_constant + linked > MOST_WORDS {
        return Err(CodeTooLarge);
    }
    let is_short = size.max(body.locals() as usize) <= LONG;
    let buffers = if is_short {
        BUFFERS.take()
    } else {
        Buffers::default()
    };
    let options = assembler_options(seed);
    let mut compiler = Compiler {
        m: match buffers.assembler {
            Some((mut m, spent)) => {
                m.restart(options, Some(spent));
                m
            }
            None => MacroAssembler::new(options),
        },
        code,
        body,
        profiles: Profiles::new(code_block),
        thunks,
        coroutine_type: code_block.coroutine_type(),
        records: is_optimizable(body),
        is_provisional,
        first_constant: first_constant as u32,
        reads_scope: false,
        steps: emptied(buffers.steps, size / 4),
        places: emptied(buffers.places, size),
        likely_locals: emptied(buffers.likely_locals, 0),
        cold: emptied(buffers.cold, size / 3),
        assumed: emptied(buffers.assumed, 0),
        offset: 0,
        carried: None,
        carries_boolean: false,
        incoming: None,
        is_incoming_boolean: false,
        uses_incoming: false,
        slow: None,
        end: None,
    };
    compiler.m.reserve(size * 20);
    compiler.survey();
    let entry = compiler.prologue();
    compiler.main_pass();
    let cold = compiler.m.mark();
    compiler.cold_pass();
    let code = compiler.m.take_code()?;
    let installed = install(&Compiled {
        code: &code,
        entry,
        cold,
        steps: &compiler.steps,
        assumed: &compiler.assumed,
    });
    if is_short && code.bytes().len() <= LONG_CODE {
        BUFFERS.set(Buffers {
            assembler: Some((compiler.m, code)),
            steps: compiler.steps,
            places: compiler.places,
            likely_locals: compiler.likely_locals,
            cold: compiler.cold,
            assumed: compiler.assumed,
        });
    }
    Ok(installed)
}

/// Whether other code might have spared the instruction its slow path.
fn goes_by_profile(opcode: Opcode) -> bool {
    use Opcode::*;
    !matches!(
        opcode,
        LoopHint
            | ToThis
            | CreateThis
            | CreateScope
            | CreateRest
            | CreateDirectArguments
            | EnsureArguments
            | EnsureRest
            | NewFunction
            | NewObject
            | NewObjectLiteral
            | NewArray
            | NewArrayFromConstant
            | NewArrayWithSize
            | RethrowIfAny
    )
}

const fn slot(register: Register) -> Address {
    Address::new(FP, register.offset() * WORD)
}

/// A field of the entry that starts at `word`.
const fn metadata(word: u32, field: usize) -> Address {
    let entry = CodeBlock::OFFSET_OF_METADATA + word as usize * WORD as usize;
    at(CODE_BLOCK, entry + field)
}

impl Compiler<'_> {
    #[inline(always)]
    fn step_at(&self, offset: u32) -> &Step {
        &self.steps[(self.places[offset as usize] & !IS_TARGET) as usize]
    }

    #[inline(always)]
    fn raw(&self, offset: u32) -> RawInstruction {
        self.step_at(offset).raw
    }

    #[inline(always)]
    fn instruction(&self, offset: u32) -> Instruction {
        Instruction::from(&self.step_at(offset).raw)
    }

    fn survey(&mut self) {
        let body = self.body;
        let size = body.instructions().len();
        self.places.resize(size, 0);
        (self.likely_locals).resize(body.locals() as usize, Likely::Unknown);
        for (offset, raw) in Instructions::new(body.padded_instructions(), 0..size as u32) {
            if !self.reads_scope {
                raw.for_each_use(body, |run| {
                    self.reads_scope |= run.contains(Register::SCOPE);
                });
            }
            if raw.opcode.branches() {
                raw.for_each_target(body, offset, |target| {
                    self.places[target as usize] |= IS_TARGET;
                });
            }
            self.places[offset as usize] |= self.steps.len() as u32;
            self.steps.push(Step {
                raw,
                label: self.m.new_label(),
                carried: None,
                is_left_out: false,
            });
        }
        for handler in body.handlers() {
            self.places[handler.target as usize] |= IS_TARGET;
        }
    }

    fn label_at(&self, offset: u32) -> Label {
        debug_assert!(self.places[offset as usize] & IS_TARGET != 0);
        self.step_at(offset).label
    }

    fn target(&self, jump: Jump) -> Label {
        self.label_at(jump.from(self.offset))
    }

    fn main_pass(&mut self) {
        let mut decided_until = 0;
        for index in 0..self.steps.len() {
            let Step { raw, label, .. } = self.steps[index];
            if self.places[self.offset as usize] & IS_TARGET != 0 {
                if raw.opcode == Opcode::LoopHint {
                    self.m.align(16, 10);
                }
                self.carried = None;
            }
            self.m.bind(label);
            if self.is_provisional
                && index >= decided_until
                && self.profiles.has_run(&raw) == Some(false)
            {
                decided_until = self.leave_out_if_unknown(index);
            }
            if self.steps[index].is_left_out {
                self.offset += u32::from(raw.size);
                continue;
            }
            self.incoming = self.carried.take();
            self.is_incoming_boolean = core::mem::take(&mut self.carries_boolean);
            self.uses_incoming = false;
            let (incoming, first_cold) = (self.incoming, self.cold.len());
            self.template();
            self.note_results(&raw);
            self.steps[index].carried = incoming.filter(|_| self.uses_incoming);
            self.finish_instruction(first_cold);
            self.offset += u32::from(raw.size);
        }
    }

    /// The rest of the block, if nothing says that it has run. Returns where it ends.
    fn leave_out_if_unknown(&mut self, first: usize) -> usize {
        let (mut end, mut offset, mut has_run) = (first, self.offset, false);
        while let Some(step) = self.steps.get(end)
            && (end == first || self.places[offset as usize] & IS_TARGET == 0)
            // Where the interpreter hands the frame back.
            && step.raw.opcode != Opcode::LoopHint
        {
            has_run |= self.profiles.has_run(&step.raw) == Some(true);
            offset += u32::from(step.raw.size);
            end += 1;
        }
        if !has_run {
            (self.steps[first..end].iter_mut()).for_each(|step| step.is_left_out = true);
            self.m.move32(ARGUMENTS[2], self.offset);
            self.m.jump_address(self.thunks.leave);
        }
        end
    }

    fn finish_instruction(&mut self, first_cold: usize) {
        if let Some(entry) = self.slow.take() {
            let resume = self.end();
            self.cold.push(Cold {
                emit: |c, cold| {
                    c.call_step(goes_by_profile(c.raw(cold.offset).opcode));
                    c.resume_with_carried(cold);
                },
                offset: self.offset,
                entry,
                resume,
                slow: entry,
                other: entry,
                carried: None,
            });
        }
        for cold in &mut self.cold[first_cold..] {
            cold.carried = self.carried;
        }
        if let Some(end) = self.end.take() {
            self.m.bind(end);
        }
    }

    fn cold_pass(&mut self) {
        (self.carried, self.incoming) = (None, None);
        for index in 0..self.cold.len() {
            let cold = self.cold[index];
            self.offset = cold.offset;
            self.m.bind(cold.entry);
            (cold.emit)(self, &cold);
        }
    }

    /// Where to go, with nothing written yet, to have the instruction done the general way.
    fn slow(&mut self) -> Label {
        *self.slow.get_or_insert_with(|| self.m.new_label())
    }

    fn end(&mut self) -> Label {
        *self.end.get_or_insert_with(|| self.m.new_label())
    }

    fn cold_until(&mut self, resume: Label, emit: fn(&mut Compiler<'_>, &Cold)) -> Label {
        let slow = self.slow();
        self.cold_with(resume, slow, emit)
    }

    /// For one that does not fall back on the slow path.
    fn cold_alone(&mut self, resume: Label, emit: fn(&mut Compiler<'_>, &Cold)) -> Label {
        self.cold_with(resume, resume, emit)
    }

    fn cold_with(
        &mut self,
        resume: Label,
        slow: Label,
        emit: fn(&mut Compiler<'_>, &Cold),
    ) -> Label {
        let entry = self.m.new_label();
        self.cold.push(Cold {
            emit,
            offset: self.offset,
            entry,
            resume,
            slow,
            other: slow,
            carried: None,
        });
        entry
    }

    fn resume_with_carried(&mut self, cold: &Cold) {
        if !self.raw(cold.offset).opcode.flow().falls_through() {
            return;
        }
        if let Some(register) = cold.carried {
            self.m.load64(T0, slot(register));
        }
        self.m.jump(cold.resume);
    }

    /// Falls through if the instruction does.
    fn call_slow_path(&mut self) {
        self.call_step(false);
    }

    fn call_step(&mut self, is_surprise: bool) {
        let raw = self.raw(self.offset);
        self.m.move32(ARGUMENTS[2], self.offset);
        (self.m).call_address(self.thunks.slow_path(raw.opcode, is_surprise));
        let mut code = outcome::FIRST_TARGET;
        for (&shape, &word) in raw.opcode.shapes().iter().zip(raw.words()) {
            if shape == Shape::Target {
                let target = self.target(Jump(word as i32));
                if raw.opcode.flow() == Flow::Jumps {
                    return self.m.jump(target);
                }
                self.m.branch32(Cond::Eq, T0, code, target);
                code += 1;
            }
        }
        match raw.opcode {
            Opcode::SwitchInt | Opcode::SwitchChar | Opcode::SwitchString => {
                let mut targets: SmallVec<[(i64, Label); 16]> = SmallVec::new();
                raw.for_each_target(self.body, self.offset, |target| {
                    let code = outcome::OFFSET as i64 + i64::from(target);
                    targets.push((code, self.label_at(target)));
                });
                targets.sort_unstable();
                targets.dedup();
                let last = targets[targets.len() - 1].1;
                self.search(Width::W32, T0, &targets, last);
            }
            opcode if !opcode.flow().falls_through() => {
                self.m.move64(T0, SECOND_RESULT);
                self.epilogue();
            }
            _ => {}
        }
    }

    /// Jumps to the label of the key that `value` equals. They are sorted, as signed numbers.
    fn search(&mut self, width: Width, value: Gpr, keys: &[(i64, Label)], otherwise: Label) {
        if keys.len() <= 3 {
            for &(key, label) in keys {
                self.m.branch(width, Cond::Eq, value, Untrusted(key), label);
            }
            return self.m.jump(otherwise);
        }
        let (lower, upper) = keys.split_at(keys.len() / 2);
        let in_upper = self.m.new_label();
        (self.m).branch(width, Cond::Ge, value, Untrusted(upper[0].0), in_upper);
        self.search(width, value, lower, otherwise);
        self.m.bind(in_upper);
        self.search(width, value, upper, otherwise);
    }

    /// What the slot in the frame says while the instruction has called out.
    fn store_call_site(&mut self) {
        let start = self.body.instructions().as_ptr().addr() as u32;
        (self.m).store32(crate::emit::CALL_SITE, start.wrapping_add(self.offset));
    }

    fn restore_stack_pointer(&mut self) {
        let bottom = Address::new(FP, -(self.body.locals() as i32) * WORD);
        self.m.compute_address(SP, bottom);
    }

    /// Right after a call that may have run other code.
    fn return_point(&mut self) {
        self.restore_stack_pointer();
        self.m.load_pinned_registers();
    }
}
