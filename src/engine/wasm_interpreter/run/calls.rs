//! Calls. The frame of the callee starts at the slot in `low`, where the arguments are and the results will be.

use bun_engine_wasm_compiler::abi::{Callable, Trap};
use bun_engine_wasm_format::FuncIndex;
use bun_engine_wasm_runtime::interpreted::Callee;
use bun_engine_wasm_runtime::{Failure, Outcome};

use super::control::check;
use super::exceptions::{catch, throw_from};
use crate::code::{Op, Pc, index_before};
use crate::machine::{Cx, Frame, Handler, Machine, Running, attempt, fail, given, go, handlers};

/// From the start, in a frame that has been made for the function.
#[inline(always)]
pub(crate) fn run<'a, 'f>(ops: &'a [Op], frame: &'f Frame<'a, 'f>, cx: &'f Cx<'a>) -> Outcome {
    run_with(ops, frame, cx, cx.first_memory())
}

#[inline(always)]
fn run_with<'a, 'f>(
    ops: &'a [Op],
    frame: &'f Frame<'a, 'f>,
    cx: &'f Cx<'a>,
    memory: bun_engine_wasm_runtime::interpreted::View,
) -> Outcome {
    let (handler, pc): (Handler, _) = if cx.must_check(frame) {
        core::hint::cold_path();
        (check, given!(Pc::at(ops, 0)))
    } else {
        let (link, pc) = given!(Pc::after(ops, 0));
        (link.next, pc)
    };
    handler(pc, frame.slots(), memory, frame, cx, 0, 0.0, 0.0)
}

/// For whoever has made a frame. What comes out is a value, an exception that a caller catches, or a failure that the
/// host knows of.
#[inline(always)]
pub(crate) fn settle<'a>(frame: &Frame<'a, '_>, outcome: Outcome) -> Result<u64, Failure> {
    outcome
        .into_result()
        .or_else(|failure| settle_failure(frame, failure).into_result())
}

#[cold]
#[inline(never)]
fn settle_failure<'a>(frame: &Frame<'a, '_>, mut failure: Failure) -> Outcome {
    while failure == Failure::REPLACED {
        match call_in_place_of(frame, frame.cx.successor(frame)) {
            Ok(value) => return Outcome::value(value),
            Err(other) => failure = other,
        }
    }
    assert!(failure != Failure::BROKEN);
    Outcome::failure(frame.cx.raise(frame, failure))
}

#[inline]
fn call_host<'a>(frame: &Frame<'a, '_>, callee: Callee<'a>) -> Result<u64, Failure> {
    let called = frame.cx.call_host(frame, callee);
    called.map_err(|failure| throw_from(frame, failure))?;
    Ok(frame.slots()[0].get())
}

fn call_in_place_of<'a>(frame: &Frame<'a, '_>, callee: Callee<'a>) -> Result<u64, Failure> {
    if callee.is_of_host() {
        return call_host(frame, callee);
    }
    let cx = Cx::new(frame.cx.of(callee)).map_err(|_| Trap::OutOfMemory)?;
    let ops = &cx.code(callee.func()).map_err(|_| Trap::OutOfMemory)?.ops;
    cx.call_in_place_of(frame, callee.func(), Running::new(ops, &cx), |frame| {
        run(ops, frame, &cx).into_result()
    })
}

/// Where the caller goes on. The place is taken from the site, which is one word, and not from the program counter
/// and the record, which are three, so that a frame is as small as it can be.
macro_rules! returned {
    ($site:ident, $caller:ident, $result:expr) => {{
        let cx = $caller.cx;
        cx.return_to($caller);
        let ops = $caller.ops.get();
        let (link, pc) = given!(Pc::after(ops, index_before(ops, $site)));
        let mut m = Machine {
            pc,
            slots: $caller.slots(),
            memory: cx.first_memory(),
            frame: $caller,
            cx,
            int: 0,
            single: 0.0,
            double: 0.0,
        };
        match $result {
            Ok(value) => m.int = value,
            Err(failure) => {
                core::hint::cold_path();
                let Some(exception) = failure.as_exception() else {
                    fail!(failure);
                };
                m.int = exception.address() as u64;
                go!(m, catch);
            }
        }
        go!(m, link.next);
    }};
}

macro_rules! call_defined {
    ($m:ident, $op:ident, $func:expr, $ops:expr) => {{
        let (cx, memory, ops): (_, _, &[Op]) = ($m.cx, $m.memory, $ops);
        let slots = attempt!(cx.window($m.slots, $op.low()), StackOverflow);
        let (site, running) = ($m.pc.site(), Running::new(ops, cx));
        let (result, caller) = cx.call($m.frame, site, $func, slots, running, |frame| {
            settle(frame, run_with(ops, frame, cx, memory))
        });
        returned!(site, caller, result);
    }};
}

/// In a function of its own, so that the frames for the usual calls are small.
#[inline(never)]
fn call_any<'a, 'f>(
    caller: &'f Frame<'a, 'f>,
    site: usize,
    first_slot: u32,
    callable: &Callable,
) -> Outcome {
    let cx = caller.cx;
    let slots = attempt!(cx.window(caller.slots(), first_slot), StackOverflow);
    let callee = cx.callee(callable);
    cx.call_out(caller, site, slots, Running::nothing(cx), |frame| {
        let outcome = match callee.is_of_host() {
            true => call_host(frame, callee).into(),
            false => Outcome::failure(frame.hand_over(callee)),
        };
        settle(frame, outcome).into()
    })
}

macro_rules! call_callable {
    ($m:ident, $op:ident, $callable:expr) => {{
        let callable = $callable;
        if let Some(func) = $m.cx.defined_function(&callable)
            && let Some(code) = $m.cx.existing_code(func)
        {
            call_defined!($m, $op, FuncIndex(func as u32), &code.ops);
        }
        let (caller, site) = ($m.frame, $m.pc.site());
        let outcome = call_any(caller, site, $op.low(), &callable);
        returned!(site, caller, outcome.into_result());
    }};
}

impl Machine<'_, '_> {
    /// For a callee that takes the frame.
    #[inline(always)]
    fn move_arguments(&self, first: u32, count: u32) -> Option<()> {
        let arguments = self.range(first, count as usize)?;
        (self.slots.iter().zip(arguments)).for_each(|(to, from)| to.set(from.get()));
        Some(())
    }
}

macro_rules! start_over {
    ($m:ident, $func:expr, $ops:expr) => {{
        let ops: &[Op] = $ops;
        $m.frame.reuse_for($func);
        $m.frame.ops.set(ops);
        $crate::run::control::jump!($m, 0, true);
    }};
}

macro_rules! leave_to_callable {
    ($m:ident, $op:ident, $count:expr, $callable:expr) => {{
        let callable = $callable;
        given!($m.move_arguments($op.low(), $count));
        if let Some(func) = $m.cx.defined_function(&callable)
            && let Some(code) = $m.cx.existing_code(func)
        {
            start_over!($m, FuncIndex(func as u32), &code.ops);
        }
        fail!($m.frame.hand_over($m.cx.callee(&callable)));
    }};
}

handlers! {
    /// Of the function that the instruction names in `imm`. Then it is run again.
    #[cold]
    fn translate_callee(m) {
        let func = FuncIndex(given!(m.pc.peek(0)).imm);
        attempt!(m.cx.code(func).ok(), OutOfMemory);
        let ops = m.frame.ops.get();
        go!(m, given!(ops.get(index_before(ops, m.pc.site()))).next);
    }

    fn call(m, op @ start) {
        let Some(code) = m.cx.existing_code(op.imm as usize) else {
            core::hint::cold_path();
            go!(m, translate_callee, start);
        };
        call_defined!(m, op, FuncIndex(op.imm), &code.ops);
    }

    fn call_import(m, op) {
        let (callable, caller) = (m.cx.import(FuncIndex(op.imm)), m.frame);
        let site = m.pc.site();
        let outcome = call_any(caller, site, op.low(), &callable);
        returned!(site, caller, outcome.into_result());
    }

    /// `imm` tells where the view of the table is.
    fn call_indirect(m, op, ty, index) {
        call_callable!(m, op, attempt!(m.cx.element(op.imm, m.get(index.a), ty.whole())));
    }

    fn call_ref(m, op) {
        call_callable!(m, op, attempt!(m.cx.referenced_function(m.get(op.c()))));
    }

    fn return_call(m, op @ start, count) {
        let Some(code) = m.cx.existing_code(op.imm as usize) else {
            core::hint::cold_path();
            go!(m, translate_callee, start);
        };
        given!(m.move_arguments(op.low(), count.imm));
        start_over!(m, FuncIndex(op.imm), &code.ops);
    }

    fn return_call_import(m, op, count) {
        leave_to_callable!(m, op, count.imm, m.cx.import(FuncIndex(op.imm)));
    }

    fn return_call_indirect(m, op, ty, rest) {
        leave_to_callable!(m, op, rest.imm, attempt!(m.cx.element(op.imm, m.get(rest.a), ty.whole())));
    }

    fn return_call_ref(m, op, count) {
        leave_to_callable!(m, op, count.imm, attempt!(m.cx.referenced_function(m.get(op.c()))));
    }
}
