//! From the body of a function to `Code`, in one pass.

mod calls;
mod condition;
mod control;
mod emit;
mod exceptions;
mod memory;
mod numeric;
mod operands;
mod reference;
mod variable;
mod vector;

use bun_engine_wasm_format::{
    Catch, Flow, FuncIndex, FunctionBody, FunctionFlags, OutOfMemory, ValKind, Visit,
};
use bun_engine_wasm_runtime::Module;

use self::control::Block;
use self::emit::{LastResults, Revisable};
use self::operands::{Operand, SCRATCH_SLOTS, width};
use crate::code::{Code, Op};
use crate::handlers::Handlers;
use crate::run::{control as run_control, moves};

type Done<T = ()> = Result<T, OutOfMemory>;

#[derive(Clone, Copy)]
struct Local {
    slot: u32,
    kind: ValKind,
}

/// A frame has the parameters, slots to get at far ones if there are any, the other locals, the exceptions that are
/// being handled and the operands.
struct Translator<'a> {
    module: &'a Module,
    ops: Vec<Op>,
    locals: Vec<Local>,
    operands: Vec<Operand>,
    /// No operand below is `Place::Local`.
    settled: usize,
    first_scratch_slot: u16,
    first_exception_slot: u32,
    first_operand_slot: u32,
    blocks: Vec<Block<'a>>,
    last_results: LastResults,
    revisable: Revisable,
    is_dead: bool,
    handlers: Handlers,
    /// Of the `try_table` blocks that are open.
    catches: Vec<Catch>,
    catch_depth: u32,
}

fn with_room<T>(count: usize) -> Done<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(count)?;
    Ok(vec)
}

fn boxed<T: Copy>(items: &[T]) -> Done<Box<[T]>> {
    let mut vec = with_room(items.len())?;
    vec.extend_from_slice(items);
    Ok(vec.into_boxed_slice())
}

/// The results can be on their way out without having been on the stack.
fn most_operands(body: &FunctionBody<'_>) -> u32 {
    (body.facts().max_stack_height).max(body.func_type().results.len() as u32)
}

/// Of a function that the module defines.
pub(crate) fn translate(module: &Module, func: FuncIndex) -> Done<Code> {
    let body = module.body(module.code_index(func).expect("not an import"));
    let mut translator = Translator {
        module,
        ops: with_room(body.bytes().len() / 4 + 4)?,
        locals: with_room(body.facts().local_count as usize)?,
        operands: with_room(most_operands(&body) as usize)?,
        settled: 0,
        first_scratch_slot: 0,
        first_exception_slot: 0,
        first_operand_slot: 0,
        blocks: Vec::new(),
        last_results: LastResults::NONE,
        revisable: Revisable::Nothing,
        is_dead: false,
        handlers: Handlers::default(),
        catches: Vec::new(),
        catch_depth: 0,
    };
    translator.begin(&body)?;
    body.driver().run(&mut translator)?;
    let handlers = translator.handlers;
    Ok(Code {
        ops: boxed(&translator.ops)?,
        handlers: (!handlers.is_empty()).then(|| Box::new(handlers)),
    })
}

impl<'a> Translator<'a> {
    fn begin(&mut self, body: &FunctionBody<'a>) -> Done {
        let (facts, ty) = (body.facts(), body.func_type());
        let widest = match facts.flags.contains(FunctionFlags::USES_SIMD) {
            true => 2,
            false => 1,
        };
        let values = facts.local_count + most_operands(body);
        let most = values * widest + facts.max_catch_depth + SCRATCH_SLOTS;
        let has_far_slots = u16::try_from(most).is_err();
        self.ops.push(Op {
            a: 0,
            b: 0,
            imm: 0,
            next: run_control::nowhere,
        });
        if has_far_slots {
            self.emit(moves::find_room, 0, 0, most)?;
        }

        let mut slot = (ty.params.iter()).fold(0, |slot, it| self.add_locals(slot, 1, it.kind()));
        self.first_scratch_slot = u16::try_from(slot).expect("there are few enough parameters");
        slot += if has_far_slots { SCRATCH_SLOTS } else { 0 };
        let first = self.locals.len();
        for (count, ty) in body.local_groups() {
            slot = self.add_locals(slot, count, ty.kind());
        }
        self.first_exception_slot = slot;
        self.first_operand_slot = slot + facts.max_catch_depth;
        self.ops[0].imm = self.first_operand_slot + most_operands(body) * widest;
        self.initialize_locals(first)?;
        self.open_body(ty.results)
    }

    /// Returns the slot after them.
    fn add_locals(&mut self, first: u32, count: u32, kind: ValKind) -> u32 {
        let slot = |index| first + index * width(kind);
        (self.locals).extend((0..count).map(slot).map(|slot| Local { slot, kind }));
        slot(count)
    }

    fn initialize_locals(&mut self, first: usize) -> Done {
        let (end, is_ref) = (self.first_exception_slot, |it: &Local| {
            it.kind == ValKind::Ref
        });
        let declared = &self.locals[first..];
        if let Some(number) = declared.iter().find(|it| !is_ref(it)) {
            let last = declared.iter().rfind(|it| !is_ref(it)).unwrap_or(number);
            self.clear(number.slot, last.slot + width(last.kind))?;
        }
        let mut next = first;
        while let Some(skipped) = self.locals[next..].iter().position(is_ref) {
            let start = next + skipped;
            next = start
                + self.locals[start..]
                    .iter()
                    .take_while(|it| is_ref(it))
                    .count();
            let (start, after) = (self.locals[start].slot, self.locals.get(next));
            let count = after.map_or(end, |it| it.slot) - start;
            self.emit_low(moves::fill::<true>, start, count)?;
        }
        Ok(())
    }

    /// And perhaps some more after them.
    fn clear(&mut self, start: u32, end: u32) -> Done {
        const MOST_STEPS: u32 = 4;
        if end - start > MOST_STEPS * moves::MOST_CLEARED || u16::try_from(end).is_err() {
            return self.emit_low(moves::fill::<false>, start, end - start);
        }
        for first in (start..end).step_by(moves::MOST_CLEARED as usize) {
            self.emit(moves::for_clear(end - first), first as u16, 0, 0)?;
        }
        Ok(())
    }
}

impl Visit for Translator<'_> {
    type Error = OutOfMemory;

    fn unhandled(&mut self) -> Done {
        unreachable!("there is a method for each instruction")
    }

    #[inline]
    fn flow(&self) -> Flow {
        match self.is_dead {
            true => Flow::Dead,
            false => Flow::Live,
        }
    }
}
