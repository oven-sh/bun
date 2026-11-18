use bun_engine_bytecode::{Register, Specialization, Width};
use bun_engine_vm::code::metadata;
use bun_engine_vm::heap::barrier;
use bun_engine_vm::{
    CallFrame, CellType, CodeBlock, Executable, Gc, JsCell, JsFunction, Tier, ValueProfile, call,
};

use crate::machine::{CONSTANT_BIAS, EMPTY, Machine, cell, dispatch, go, handler, next};
use crate::slow::Frame;
use crate::slow::calls::{self as slow, AnyCall, FixedCall, Returns, VarargsCall, write_header};
use crate::stubs;

handler! { raw
    fn prologue(m, code_block, _b, _c) {
        let code_block = cell::<CodeBlock>(code_block.assume_init());
        let arguments = m.fp.byte_add(CallFrame::OFFSET_OF_THIS);
        let count = code_block.parameters() as usize;
        let profiles = m.constants.cast_mut().wrapping_add(CONSTANT_BIAS as usize).sub(count);
        for index in 0..count {
            profiles.add(index).write_volatile(*arguments.add(index));
        }
        let counter = code_block.interpreter_counter();
        let count = counter.get().wrapping_add(CodeBlock::ENTRY_WEIGHT);
        counter.set(count);
        if count >= 0 || !m.needs_no_barrier(&code_block) {
            go!(m, finish_prologue::<W>)
        }
        dispatch!(m, m.pc)
    }

    #[cold]
    #[inline(never)]
    fn finish_prologue(m, _a, _b, _c) {
        let (_, f) = Frame::enter(m.vm, m.frame(), m.pc.0);
        if !m.needs_no_barrier(f.code_block) {
            barrier::slow_path(f.code_block);
        }
        if f.code_block.interpreter_counter().get() >= 0 {
            let address = (m.vm.hooks().tier_up)(m.vm, Tier::Interpreter, f.code_block, f.header, None);
            if address != 0 {
                go!(m, stubs::jump_to; address)
            }
        }
        dispatch!(m, m.pc)
    }

    #[cold]
    #[inline(never)]
    fn prologue_with_traps(m, code_block, _b, _c) {
        let (cx, _) = Frame::enter(m.vm, m.frame(), m.pc.0);
        if cx.handle_traps().is_err() {
            go!(m, stubs::throw)
        }
        go!(m, prologue::<W>; code_block.assume_init())
    }
}

impl<W: Width> Machine<W> {
    #[inline(always)]
    unsafe fn new_frame(&self, distance: u32) -> *mut u64 {
        // SAFETY: among the locals.
        unsafe { self.fp.sub(distance as usize) }
    }
}

#[inline(always)]
fn replaced_entry(specialization: Specialization) -> usize {
    match specialization {
        Specialization::Call => call::replaced_call_entry(),
        Specialization::Construct => call::replaced_construct_entry(),
    }
}

macro_rules! make_call {
    ($m:ident, $O:ty, $executable:expr, $entry:expr, $new_frame:expr) => {{
        if <$O as AnyCall>::IS_TAIL {
            go!($m, tail_call::<$O, W>; $executable, $entry, $new_frame)
        }
        go!($m, stubs::call::<$O, W>; $executable, $entry, $new_frame)
    }};
}

handler! {
    fn fixed_call<O: FixedCall>(m, op: O) {
        let callee = m.get(op.callee());
        let profile = &m.entry::<metadata::Call>(op.metadata()).profile;
        if callee as usize != profile.callee().bits() {
            go!(m, call_other::<O, W>; callee)
        }
        go!(m, call_function::<O, W>; callee, profile.way_to_only_target())
    }

    #[inline(never)]
    fn call_other<O: FixedCall>(m, op: O, callee) {
        if m.is_cell(callee) && CellType::FUNCTIONS.contains(cell::<JsCell>(callee).cell_type()) {
            let profile = &m.entry::<metadata::Call>(op.metadata()).profile;
            let executable = JsFunction::executable_of(cell(callee)).address();
            let seen = profile.executable().bits();
            if seen == executable {
                go!(m, call_function::<O, W>; callee, profile.way_to_only_target())
            }
            if seen == bun_engine_vm::ic::CallProfile::MEGAMORPHIC
                || profile.try_count(callee as usize, executable)
            {
                go!(m, call_function::<O, W>; callee, executable)
            }
        }
        go!(m, call_slow::<O, W>)
    }

    #[inline(always)]
    fn call_function<O: FixedCall>(m, op: O, callee, executable) {
        if O::OPCODE == bun_engine_bytecode::Opcode::SuperConstruct {
            let seen = m.entry::<metadata::SuperConstruct>(op.metadata()).new_target.bits();
            if seen != m.get(op.this()) as usize && seen != metadata::WeakCell::MANY {
                go!(m, call_slow::<O, W>)
            }
        }
        let executable = cell::<Executable>(executable);
        if executable.entry(O::SPECIALIZATION) == replaced_entry(O::SPECIALIZATION) {
            m.code_block().link_calls_again();
            go!(m, call_slow::<O, W>)
        }
        let this = m.get(op.this());
        let [first, second] = op.arguments().map(|it| it.map(|it| m.get(it)));
        if let Some(first) = first {
            m.set(Register::outgoing_argument(op.frame(), 0), first);
        }
        if let Some(second) = second {
            m.set(Register::outgoing_argument(op.frame(), 1), second);
        }
        let new_frame = m.new_frame(op.frame());
        let code_block = executable.code_block(O::SPECIALIZATION).map_or(0, Gc::address);
        write_header(new_frame, code_block, callee, op.count().into(), this);
        m.frame().set_call_site(m.start().addr() as u32);
        make_call!(m, O, executable.address(), executable.entry(O::SPECIALIZATION), new_frame.addr())
    }

    #[inline(never)]
    fn call_slow<O: FixedCall>(m, op: O) {
        let prepared = slow::prepare_fixed_call::<O>(m.vm, m.frame(), m.start());
        if prepared.entry == 0 {
            go!(m, stubs::throw)
        }
        make_call!(m, O, prepared.executable, prepared.entry, m.new_frame(op.frame()).addr())
    }

    fn varargs_call<O: VarargsCall>(m, _op: O) {
        let new_frame = slow::size_varargs_frame::<O>(m.vm, m.frame(), m.start());
        if new_frame == 0 {
            go!(m, stubs::throw)
        }
        go!(m, stubs::extend_stack::<O, W>; new_frame)
    }

    fn fill_varargs_frame<O: VarargsCall>(m, _op: O, new_frame) {
        let words = core::ptr::with_exposed_provenance_mut(new_frame as usize);
        let prepared = slow::fill_varargs_frame::<O>(m.vm, m.frame(), m.start(), words);
        if prepared.entry == 0 {
            go!(m, stubs::throw)
        }
        make_call!(m, O, prepared.executable, prepared.entry, new_frame)
    }

    fn after_call<O: Returns>(m, op: O, result) {
        if let Some((dst, profile)) = op.result() {
            m.entry::<ValueProfile>(profile).record_bits(result);
            m.set(dst, result);
        }
        next!(m, op)
    }
}

/// With `this` and one argument.
pub(crate) const ACCESSOR_FRAME_WORDS: usize = slow::frame_words(2);

handler! { raw
    /// A getter gets no value.
    fn fill_accessor_frame<O: Returns>(m, function, this, value) {
        let (function, value) = (function.assume_init(), value.assume_init());
        let count = 1 + usize::from(value != EMPTY);
        let new_frame = m.fp.sub(m.code_block().locals() as usize + slow::frame_words(count));
        let executable = JsFunction::executable_or_rare_data(cell(function));
        let code_block = executable.code_block(Specialization::Call).map_or(0, Gc::address);
        write_header(new_frame, code_block, function, count as u64, this.assume_init());
        if value != EMPTY {
            *new_frame.byte_add(CallFrame::OFFSET_OF_ARGUMENTS) = value;
        }
        m.frame().set_call_site(m.start().addr() as u32);
        go!(m, stubs::call::<O, W>; executable.address(), executable.entry(Specialization::Call), new_frame.addr())
    }

    #[inline(never)]
    fn tail_call<O: AnyCall>(m, executable, entry, new_frame) {
        let (executable, entry, new_frame) = (executable.assume_init(), entry.assume_init(), new_frame.assume_init());
        if !slow::makes_tail_call(entry as usize, CallFrame::from_address(new_frame as usize)) {
            go!(m, stubs::call::<O, W>; executable, entry, new_frame)
        }
        let new_frame = slow::replace_frame(m.frame(), core::ptr::with_exposed_provenance(new_frame as usize));
        go!(m, stubs::tail_call; executable, entry, new_frame)
    }
}
