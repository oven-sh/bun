use bun_engine_bytecode::{Register, op};
use bun_engine_vm::code::metadata::ToThis;
use bun_engine_vm::{CallFrame, CellType, JsArray, JsFunction, ValueProfile};

use crate::machine::{EMPTY, UNDEFINED, cell, go, handler, jump, next, slow};
use crate::stubs;

const FIRST_ARGUMENT: usize = CallFrame::OFFSET_OF_ARGUMENTS / size_of::<u64>();

handler! {
    fn enter(m, op: op::Enter) {
        let scope = JsFunction::scope_of(cell(m.reg(Register::CALLEE)));
        m.set(Register::SCOPE, scope.address() as u64);
        let mut index = op.variables as usize;
        while index != 0 {
            // Not to be made a call of `memset`.
            m.fp.sub(index + 1).write_volatile(UNDEFINED);
            index -= 1;
        }
        next!(m, op)
    }

    fn mov(m, op: op::Move) {
        m.set(op.dst, m.get(op.src));
        next!(m, op)
    }

    fn ret(m, op: op::Return) {
        go!(m, stubs::return_value; m.get(op.value))
    }

    fn to_this(m, op: op::ToThis) {
        let this = m.reg(op.this);
        if !m.as_object(this).is_some_and(|it| it.cell_type() != CellType::GlobalObject) {
            slow!(m, op::ToThis)
        }
        m.entry::<ToThis>(op.metadata).value.record_bits(this);
        next!(m, op)
    }

    fn check_initialized(m, op: op::CheckInitialized) {
        if m.reg(op.value) == EMPTY {
            slow!(m, op::CheckInitialized)
        }
        next!(m, op)
    }

    fn check_this(m, op: op::CheckThis) {
        if m.reg(op.this) == EMPTY {
            slow!(m, op::CheckThis)
        }
        next!(m, op)
    }

    fn bind_this(m, op: op::BindThis) {
        if m.reg(op.this) != EMPTY {
            slow!(m, op::BindThis)
        }
        m.set(op.this, m.reg(op.value));
        next!(m, op)
    }

    fn argument_count(m, op: op::ArgumentCount) {
        m.set(op.dst, m.box_int32(m.frame().argument_count() as i32));
        next!(m, op)
    }

    fn get_argument(m, op: op::GetArgument) {
        let index = op.index as usize;
        let value = if index < m.frame().argument_count() {
            *m.fp.add(FIRST_ARGUMENT + index)
        } else {
            UNDEFINED
        };
        m.entry::<ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    fn get_arguments_length(m, op: op::GetArgumentsLength) {
        let arguments = m.reg(op.arguments);
        let length = if arguments == EMPTY {
            m.frame().argument_count().saturating_sub(op.skip as usize) as u32
        } else if let Some(array) = m.as_cell(arguments).and_then(|it| it.downcast::<JsArray>()) {
            array.length()
        } else {
            slow!(m, op::GetArgumentsLength)
        };
        if length > i32::MAX as u32 {
            slow!(m, op::GetArgumentsLength)
        }
        let length = m.box_int32(length as i32);
        m.entry::<ValueProfile>(op.metadata).record_bits(length);
        m.set(op.dst, length);
        next!(m, op)
    }

    fn get_argument_by_val(m, op: op::GetArgumentByVal) {
        let index = m.get(op.key).wrapping_sub(m.number_tag);
        let count = m.frame().argument_count().saturating_sub(op.skip as usize);
        if m.reg(op.arguments) != EMPTY || index >= count as u64 {
            next!(m, op)
        }
        let value = *m.fp.add(FIRST_ARGUMENT + op.skip as usize + index as usize);
        m.entry::<ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        jump!(m, op.done)
    }

    fn spread_arguments(m, op: op::SpreadArguments) {
        if m.reg(op.arguments) != EMPTY || !m.code_block().global().array_iterator_protocol_is_pristine() {
            next!(m, op)
        }
        if !op.for_call {
            slow!(m, op::SpreadArguments)
        }
        m.set(op.dst, EMPTY);
        jump!(m, op.done)
    }
}
