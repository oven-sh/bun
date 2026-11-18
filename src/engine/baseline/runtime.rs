//! Installing code, and what it calls.

use core::any::Any;
use core::ops::Range;
use std::hash::{BuildHasher, RandomState};
use std::rc::Rc;

use bun_engine_bytecode::{Opcode, Register};
use bun_engine_exec_memory::{CodeHandle, OutOfExecutableMemory, Priority, pressure};
use bun_engine_macros::native_abi;
use bun_engine_vm::code::counting_compile_time;
use bun_engine_vm::heap::{Scope, Survivors, barrier};
use bun_engine_vm::{
    Arithmetic, CallFrame, CodeBlock, CodeOrigin, CompiledCode, FastHasher, FunctionExecutable,
    InlineFrame, JsCell, Tier, Value, Visitor, Vm, options,
};

use crate::compiler::{self, Compiled};
use crate::tables::{Start, Starts};
use crate::thunks;

/// Serves every code block that has the same unlinked code.
struct BaselineCode {
    handle: CodeHandle,
    entry: u32,
    /// Where the code for the unlikely cases starts.
    cold: u32,
    starts: Starts,
    assumed: Box<[(u32, Arithmetic)]>,
    generation: u8,
    seed: u64,
    /// Of the code before it was linked.
    hash: u64,
}

impl BaselineCode {
    const LAST_GENERATION: u8 = 3;

    fn of(code_block: &CodeBlock) -> Option<Rc<BaselineCode>> {
        let compiled: Rc<dyn Any> = code_block.compiled()?;
        compiled.downcast().ok()
    }

    fn patience(&self, code_block: &CodeBlock) -> i32 {
        /// About what it takes to compile a byte, in what a surprise costs.
        const PER_BYTE: usize = 8;
        /// More than an instruction counts for, which is to get past the counter.
        const LEAST: i32 = 16;
        if self.generation == Self::LAST_GENERATION {
            return i32::MAX;
        }
        let size = code_block.body().instructions().len();
        let patience = ((size * PER_BYTE) << (2 * self.generation)) as f64;
        ((patience * options().jit_policy_scale) as i32).max(LEAST)
    }

    /// Returns the entry.
    fn put_to_use(self: Rc<Self>, code_block: &CodeBlock) -> usize {
        if !self.assumed.is_empty() {
            let entries = code_block.entries();
            for &(word, seen) in &self.assumed {
                entries.arithmetic(word).record(seen);
            }
        }
        (code_block.surprise_counter()).set(-self.patience(code_block));
        code_block.link_calls_again();
        let entry = self.handle.address(self.entry);
        // SAFETY: of the same `Code`.
        unsafe { code_block.set_compiled(Tier::Baseline, self, entry) };
        entry
    }
}

impl CompiledCode for BaselineCode {
    fn origin_of_call_site(&self, _: u32) -> CodeOrigin {
        unreachable!()
    }

    fn has_call_site(&self, _: u32) -> bool {
        false
    }

    /// Only for the likely cases.
    fn origin_of_address(&self, address: usize) -> Option<CodeOrigin> {
        let offset = address.wrapping_sub(self.handle.start());
        (offset < self.cold as usize).then(|| CodeOrigin {
            bytecode_offset: self.starts.offset_at(offset as u32),
            inline_frame: None,
        })
    }

    fn inline_frame(&self, _: &Vm, _: u32) -> InlineFrame {
        unreachable!()
    }

    unsafe fn inline_callee(&self, _: &CallFrame, _: u32) -> Value {
        unreachable!()
    }

    fn catch_address(&self, _: u32, _: CodeOrigin, _: u32) -> usize {
        unreachable!()
    }

    fn visit(&self, _: &CodeBlock, _: &mut Visitor) {}

    fn reconcile_weak_references(&self, _: &CodeBlock, _: &Survivors) {}

    fn invalidate(&self) {}

    fn addresses(&self) -> Range<usize> {
        self.handle.addresses()
    }

    fn size(&self) -> usize {
        self.handle.len() + self.starts.size() + size_of_val(&*self.assumed)
    }
}

fn describe(code_block: &CodeBlock) -> String {
    match code_block.executable().downcast::<FunctionExecutable>() {
        Some(function) => format!("baseline {}", function.name_text()),
        None => format!("baseline {:?}", code_block.body().kind()),
    }
}

/// For what an instruction carries: it has no code.
const LEFT_OUT: i32 = 1;

enum Failure {
    TooLarge,
    OutOfMemory,
    NoChange,
}

fn compile(
    code_block: &CodeBlock,
    previous: Option<&BaselineCode>,
) -> Result<BaselineCode, Failure> {
    let thunks = thunks::get().ok_or(Failure::OutOfMemory)?;
    let (generation, seed) = match (previous, options().threshold_for_baseline) {
        (Some(previous), _) => (previous.generation + 1, previous.seed),
        (None, 0) => (
            BaselineCode::LAST_GENERATION,
            RandomState::new().hash_one(()),
        ),
        (None, _) => (0, RandomState::new().hash_one(())),
    };
    let is_provisional = generation < BaselineCode::LAST_GENERATION;
    let install = |compiled: &Compiled<'_>| {
        let targets = compiled.code.relocations().iter().map(|it| it.target);
        let hash = targets.fold(bun_wyhash::hash(compiled.code.bytes()), |hash, target| {
            FastHasher::default().hash_one((hash, target))
        });
        match previous {
            Some(previous) if previous.hash == hash => Err(Failure::NoChange),
            _ => link(compiled, generation, seed, hash).map_err(|_| Failure::OutOfMemory),
        }
    };
    let code = counting_compile_time(|| {
        compiler::compile(code_block, thunks, (seed, is_provisional), install)
    });
    let code = code.map_err(|_| Failure::TooLarge)??;
    code.handle.describe(|| describe(code_block));
    Ok(code)
}

fn link(
    compiled: &Compiled<'_>,
    generation: u8,
    seed: u64,
    hash: u64,
) -> Result<BaselineCode, OutOfExecutableMemory> {
    let place = |label| compiled.code.offset_of(label);
    let starts = compiled.steps.iter().map(|step| Start {
        size: step.raw.size,
        is_entered_often: matches!(step.raw.opcode, Opcode::LoopHint | Opcode::Catch),
        code: place(step.label),
        carried: match step.is_left_out {
            true => LEFT_OUT,
            false => step.carried.map_or(0, Register::offset),
        },
    });
    Ok(BaselineCode {
        handle: bun_engine_exec_memory::link(compiled.code, Priority::Optional, |_| 0)?,
        entry: place(compiled.entry),
        cold: place(compiled.cold),
        starts: Starts::new(starts),
        assumed: compiled.assumed.into(),
        generation,
        seed,
        hash,
    })
}

/// Returns the entry.
fn attach(code_block: &CodeBlock, code: Rc<BaselineCode>) -> usize {
    code_block.interpreter_counter().set(0);
    let entry = code.put_to_use(code_block);
    code_block.tier_up_after_warm_up();
    entry
}

pub fn did_collect(scope: Scope) {
    if scope == Scope::Full {
        compiler::release_memory();
    }
}

/// For `Hooks::adopt_machine_code`.
pub fn adopt(code_block: &CodeBlock) -> usize {
    match code_block.code().machine_code.get() {
        Some(code) => attach(code_block, code),
        None => bun_engine_interpreter::entry(),
    }
}

/// `None` if it is too early or has failed. Then the counter says when to ask again.
fn find_or_compile(vm: &Vm, code_block: &CodeBlock) -> Option<Rc<BaselineCode>> {
    let shared = &code_block.code().machine_code;
    if let found @ Some(_) = shared.get() {
        return found;
    }
    if !code_block.is_due_for_next_tier(vm) {
        return None;
    }
    match compile(code_block, None).map(Rc::new) {
        Ok(code) => {
            shared.set(Rc::<BaselineCode>::clone(&code));
            return Some(code);
        }
        Err(Failure::TooLarge | Failure::NoChange) => code_block.never_tier_up(),
        Err(Failure::OutOfMemory) => code_block.tier_up_much_later(),
    }
    None
}

/// The counter of the interpreter has run out. Returns where the frame goes on, or zero if it stays.
pub fn tier_up(vm: &Vm, code_block: &CodeBlock) -> usize {
    if code_block.tier() == Tier::Interpreter {
        let Some(code) = find_or_compile(vm, code_block) else {
            return 0;
        };
        attach(code_block, code);
    }
    resume_entry(code_block)
}

/// For the executable. This and the others below fall back on the interpreter if there is no baseline code.
pub fn entry(code_block: &CodeBlock) -> usize {
    match BaselineCode::of(code_block) {
        Some(code) => code.handle.address(code.entry),
        None => bun_engine_interpreter::entry(),
    }
}

/// To jump to with the frame pointer and the `Vm` in their registers. Runs the instruction at the call site.
pub fn resume_entry(code_block: &CodeBlock) -> usize {
    match thunks::get().filter(|_| code_block.tier() == Tier::Baseline) {
        Some(thunks) => thunks.resume,
        None => bun_engine_interpreter::resume_entry(),
    }
}

pub fn catch_address(code_block: &CodeBlock, _: u32) -> usize {
    match thunks::get().filter(|_| code_block.tier() == Tier::Baseline) {
        Some(thunks) => thunks.catch,
        None => bun_engine_interpreter::catch_entry(),
    }
}

#[repr(C)]
pub(crate) struct Resumption {
    address: usize,
    carried: u64,
}

#[native_abi]
pub(crate) type FindStart = unsafe fn(&CallFrame, u32) -> Resumption;

#[native_abi]
pub(crate) unsafe fn compile_again(frame: &CallFrame, offset: u32) -> Resumption {
    let code_block = frame.code_block().expect("a frame of baseline code");
    let code = BaselineCode::of(&code_block).expect("baseline code");
    let shared = &code_block.code().machine_code;
    let newer = (shared.get::<BaselineCode>()).filter(|it| it.generation > code.generation);
    let successor = newer.or_else(|| {
        let is_worth_it =
            code.generation < BaselineCode::LAST_GENERATION && pressure(code.handle.len()) < 2.0;
        let successor = Rc::new(is_worth_it.then(|| compile(&code_block, Some(&code)).ok())??);
        shared.set(Rc::<BaselineCode>::clone(&successor));
        Some(successor)
    });
    if let Some(successor) = successor {
        successor.put_to_use(&code_block);
    } else {
        let patience = code.patience(&code_block).saturating_mul(16);
        code_block.surprise_counter().set(-patience);
    }
    // SAFETY: the caller's.
    unsafe { find_start(frame, offset) }
}

#[native_abi]
pub(crate) unsafe fn find_start(frame: &CallFrame, offset: u32) -> Resumption {
    let code_block = frame.code_block().expect("a frame of baseline code");
    let code = BaselineCode::of(&code_block).expect("baseline code");
    let (start, carried) = code.starts.find(offset);
    if carried == LEFT_OUT {
        frame.set_call_site(code_block.call_site_of(offset));
        return Resumption {
            address: bun_engine_interpreter::resume_entry(),
            carried: 0,
        };
    }
    Resumption {
        address: code.handle.address(start),
        // SAFETY: a register of the code, or the first word of the frame.
        carried: unsafe { frame.slot(carried as isize) }.get(),
    }
}

#[native_abi]
pub(crate) fn remember(cell: &JsCell) {
    barrier::slow_path(cell);
}

fn optimize(vm: &Vm, frame: &CallFrame, loop_offset: Option<u32>) -> usize {
    let code_block = frame.code_block().expect("a frame of baseline code");
    vm.set_top_call_frame(frame);
    frame.set_call_site(code_block.call_site_of(loop_offset.unwrap_or(0)));
    (vm.hooks().tier_up)(vm, Tier::Baseline, &code_block, frame, loop_offset)
}

#[native_abi]
pub(crate) unsafe fn finish_prologue(vm: &Vm, frame: &CallFrame) -> usize {
    let code_block = frame.code_block().expect("a frame of baseline code");
    code_block.write_barrier_for_cell();
    code_block.renew_lease();
    if code_block.execution_counter().get() < 0 {
        return 0;
    }
    optimize(vm, frame, None)
}

#[native_abi]
pub(crate) unsafe fn tier_up_in_loop(vm: &Vm, frame: &CallFrame, offset: u32) -> usize {
    optimize(vm, frame, Some(offset))
}
