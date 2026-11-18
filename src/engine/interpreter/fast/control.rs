use bun_engine_bytecode::{DebugHook, op};
use bun_engine_vm::Tier;
use bun_engine_vm::code::metadata::{Cover, Flags};

use crate::machine::{EMPTY, dispatch, go, handler, jump, next, slow};
use crate::slow::Frame;
use crate::stubs;

handler! {
    fn goto(m, op: op::Goto) {
        jump!(m, op.target)
    }

    fn loop_hint(m, op: op::LoopHint) {
        let code_block = m.code_block();
        let counter = code_block.interpreter_counter();
        let count = counter.get().wrapping_add(1);
        counter.set(count);
        if count >= 0 {
            go!(m, tier_up_in_loop::<W>)
        }
        if m.fp.addr() < m.vm.traps().stack_limit() {
            slow!(m, op::LoopHint)
        }
        next!(m, op)
    }

    #[cold]
    #[inline(never)]
    fn tier_up_in_loop(m, _op: op::LoopHint) {
        let (_, f) = Frame::enter(m.vm, m.frame(), m.start());
        let offset = f.code_block.bytecode_offset_of(f.header.call_site());
        let address = (m.vm.hooks().tier_up)(m.vm, Tier::Interpreter, f.code_block, f.header, Some(offset));
        if address != 0 {
            go!(m, stubs::jump_to; address)
        }
        slow!(m, op::LoopHint)
    }

    fn cover(m, op: op::Cover) {
        m.entry::<Cover>(op.metadata).count().update(|count| count + 1);
        next!(m, op)
    }

    fn jump_if_builtin(m, op: op::JumpIfBuiltin) {
        if m.reg(op.value) == m.get(op.builtin) {
            jump!(m, op.target)
        }
        m.entry::<Flags>(op.metadata).0.set(1);
        next!(m, op)
    }

    fn switch_int(m, op: op::SwitchInt) {
        let value = m.get(op.value);
        if !m.is_int32(value) {
            slow!(m, op::SwitchInt)
        }
        let code_block = m.code_block();
        let table = code_block.body().int_switches().get_unchecked(op.table.index());
        let bun_engine_bytecode::IntCases::Dense { first, targets } = &table.cases else {
            slow!(m, op::SwitchInt)
        };
        let target = targets.get((value as i32).wrapping_sub(*first) as u32 as usize);
        dispatch!(m, m.at_offset(*target.unwrap_or(&table.default)))
    }

    fn debug(m, op: op::Debug) {
        let requests = m.vm.stepping_debugger_count().get() | m.code_block().debugger_requests().get();
        if requests != 0 || op.hook == DebugHook::DidReachDebuggerStatement {
            slow!(m, op::Debug)
        }
        next!(m, op)
    }

    fn rethrow_if_any(m, op: op::RethrowIfAny) {
        if m.reg(op.exception) != EMPTY {
            slow!(m, op::RethrowIfAny)
        }
        next!(m, op)
    }

    fn throw_if_not_object(m, op: op::ThrowIfNotObject) {
        if m.as_object(m.get(op.value)).is_none() {
            slow!(m, op::ThrowIfNotObject)
        }
        next!(m, op)
    }

    fn throw_if_nullish(m, op: op::ThrowIfNullish) {
        if bun_engine_vm::Value::from_bits(m.get(op.value)).is_undefined_or_null() {
            slow!(m, op::ThrowIfNullish)
        }
        next!(m, op)
    }
}

macro_rules! prefixes {
    ($($name:ident, $table:ident;)*) => { handler! { raw $(
        fn $name(m, _a, _b, _c) {
            let pc = crate::machine::Pc(m.pc.0.add(1));
            go!(m, crate::table::$table[usize::from(*pc.0)], pc)
        }
    )*} };
}

prefixes! {
    wide16_prefix, WIDE16;
    wide32_prefix, WIDE32;
}
