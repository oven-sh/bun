//! Compiles a function in one pass over its instructions.

mod allocation;
mod atomic;
mod calls;
mod cast;
mod cold;
mod condition;
mod control;
mod division;
mod edges;
mod exceptions;
mod frame;
mod loops;
mod memory;
mod moves;
mod numeric;
mod operand;
mod prologue;
mod reference;
mod registers;
mod table;
mod variable;
mod vector;

use core::mem;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, CodeTooLarge, Options};
use bun_engine_wasm_format::{
    BlockType, Catch, CodeIndex, Flow, FunctionBody, FunctionFlags, ModuleHeader, Visit,
};

use self::cold::{Cold, Traps};
use self::condition::Condition;
use self::control::{Block, BlockKind};
use self::edges::{Detour, Target};
use self::exceptions::Handlers;
pub use self::frame::Frame;
use self::loops::LoopPlans;
use self::memory::FirstMemory;
use self::moves::{Moves, Step};
use self::operand::Operand;
use self::registers::{Local, Owners, Registers};
use crate::abi::Signature;
use crate::clauses::Scope;
use crate::output::{CompiledFunction, Counters, DirectCall, Environment};

type Compiled = Result<(), CodeTooLarge>;

/// Memory that the compilation of one function leaves to the next.
#[derive(Default)]
pub struct Compiler {
    kept: Option<(MacroAssembler, Buffers)>,
    spent: Option<Code>,
}

/// All are empty.
#[derive(Default)]
struct Buffers {
    stack: Vec<Operand>,
    locals: Vec<Local>,
    blocks: Vec<Block>,
    else_targets: Vec<Target>,
    snapshots: Vec<Owners>,
    last_moves: Vec<Step>,
    steps: Vec<Step>,
    detours: Vec<Detour>,
    cold: Vec<Cold>,
    table_labels: Vec<Label>,
    table_targets: Vec<u32>,
    catches: Vec<Catch>,
    handlers: Handlers,
    loops: LoopPlans,
}

struct Function<'a> {
    masm: MacroAssembler,
    env: &'a Environment<'a>,
    module: &'a ModuleHeader,
    body: FunctionBody<'a>,
    bytes: &'a [u8],
    signature: Signature,
    frame: Frame,
    counters: Option<Counters>,
    loop_entry: Option<u32>,
    entry: Label,
    first_memory: FirstMemory,
    uses_simd: bool,
    keeps_all_locals: bool,

    /// Of the instruction that is being compiled.
    offset: usize,
    is_dead: bool,
    /// The instruction before took care of this one.
    is_next_done: bool,
    condition: Condition,
    registers: Registers,
    stack: Vec<Operand>,
    /// Below this position all operands are in registers or slots.
    lowest_lazy: u32,
    locals: Vec<Local>,
    /// From the stack pointer up to the frame pointer.
    stack_depth: u32,

    blocks: Vec<Block>,
    else_targets: Vec<Target>,
    snapshots: Vec<Owners>,
    moves: Moves,
    /// Those of `detours`, then those that are about to be emitted.
    steps: Vec<Step>,
    detours: Vec<Detour>,
    table_labels: Vec<Label>,
    table_targets: Vec<u32>,
    loops: LoopPlans,
    loop_depth: u32,
    catches: Vec<Catch>,
    handlers: Handlers,
    catch_depth: u32,

    cold: Vec<Cold>,
    traps: Traps,
    direct_calls: Vec<(Label, CodeIndex)>,
}

/// A guess.
const CODE_BYTES_FOR_EACH_BYTE: usize = 3;
/// What a larger function needed is not kept.
const RETAINED_BODY_SIZE: usize = 1 << 16;
const RETAINED_CODE_SIZE: usize = 1 << 18;

impl Compiler {
    /// Without `counters` the code never asks for better code. With `loop_entry` it is entered at the start of that
    /// loop and takes over a [`Frame`].
    pub fn compile(
        &mut self,
        env: &Environment<'_>,
        code: CodeIndex,
        counters: Option<Counters>,
        loop_entry: Option<u32>,
    ) -> Result<CompiledFunction, CodeTooLarge> {
        let options = Options {
            features: env.features,
            shorten_jumps: false,
            seed: env.seed ^ u64::from(code.0),
        };
        let (mut masm, mut buffers) = (self.kept.take())
            .unwrap_or_else(|| (MacroAssembler::new(options), Buffers::default()));
        masm.restart(options, self.spent.take());
        let body = env.module.body(code);
        masm.reserve(body.bytes().len() * CODE_BYTES_FOR_EACH_BYTE);
        let signature = Signature::new(body.func_type());
        let frame = Frame::new(&body, &signature, |ty, offset| {
            buffers.locals.push(Local::new(ty, offset));
        });
        let (entry, first_memory) = (masm.new_label(), FirstMemory::new(env));
        let mut function = Function {
            masm,
            env,
            module: body.header(),
            body,
            bytes: body.bytes(),
            signature,
            frame,
            counters,
            loop_entry,
            entry,
            first_memory,
            uses_simd: body.facts().flags.contains(FunctionFlags::USES_SIMD),
            keeps_all_locals: false,
            offset: 0,
            is_dead: false,
            is_next_done: false,
            condition: Condition::NONE,
            registers: Registers::new(first_memory),
            stack: buffers.stack,
            lowest_lazy: 0,
            locals: buffers.locals,
            stack_depth: frame.size(),
            blocks: buffers.blocks,
            else_targets: buffers.else_targets,
            snapshots: buffers.snapshots,
            moves: Moves::new(buffers.last_moves),
            steps: buffers.steps,
            detours: buffers.detours,
            table_labels: buffers.table_labels,
            table_targets: buffers.table_targets,
            loops: buffers.loops,
            loop_depth: 0,
            catches: buffers.catches,
            handlers: buffers.handlers,
            catch_depth: 0,
            cold: buffers.cold,
            traps: Traps::new(entry),
            direct_calls: Vec::new(),
        };
        function.emit()?;
        let compiled = function.finish()?;
        if body.bytes().len() <= RETAINED_BODY_SIZE {
            self.kept = Some(function.into_memory());
        }
        Ok(compiled)
    }

    /// Takes the memory of what has been copied to where it runs.
    pub fn recycle(&mut self, compiled: CompiledFunction) {
        if compiled.code.bytes().len() <= RETAINED_CODE_SIZE {
            self.spent = Some(compiled.code);
        }
    }
}

impl Function<'_> {
    fn emit(&mut self) -> Compiled {
        self.emit_prologue();
        let ty = BlockType::Func(self.body.type_index());
        self.open(BlockKind::Body, ty, Scope::NONE);
        self.body.driver().run(self)?;
        self.emit_cold_code();
        Ok(())
    }

    fn finish(&mut self) -> Result<CompiledFunction, CodeTooLarge> {
        let code = self.masm.take_code()?;
        let direct_call = |&(end, callee)| DirectCall {
            end_offset: code.offset_of(end),
            callee,
        };
        let (call_sites, clauses) = self.handlers.finish(&code);
        Ok(CompiledFunction {
            entry_offset: code.offset_of(self.entry),
            frame_size: self.frame.size(),
            call_sites,
            clauses,
            inline_frames: Vec::new(),
            inline_ranges: Vec::new(),
            direct_calls: self.direct_calls.iter().map(direct_call).collect(),
            code,
        })
    }

    #[inline(always)]
    fn into_memory(mut self) -> (MacroAssembler, Buffers) {
        self.stack.clear();
        self.locals.clear();
        self.snapshots.clear();
        self.cold.clear();
        self.handlers.clear();
        let buffers = Buffers {
            stack: self.stack,
            locals: self.locals,
            blocks: self.blocks,
            else_targets: self.else_targets,
            snapshots: self.snapshots,
            last_moves: self.moves.into_buffer(),
            steps: self.steps,
            detours: self.detours,
            cold: self.cold,
            table_labels: self.table_labels,
            table_targets: self.table_targets,
            catches: self.catches,
            handlers: self.handlers,
            loops: self.loops,
        };
        (self.masm, buffers)
    }
}

impl Visit for Function<'_> {
    type Error = CodeTooLarge;

    fn unhandled(&mut self) -> Compiled {
        unreachable!()
    }

    #[inline(always)]
    fn at(&mut self, offset: u32) {
        self.offset = offset as usize;
        self.registers.recent |= mem::take(&mut self.registers.locked);
    }

    #[inline(always)]
    fn flow(&self) -> Flow {
        if self.is_dead { Flow::Dead } else { Flow::Live }
    }
}
