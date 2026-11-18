use bun_engine_bytecode::Register;
use bun_engine_text::names;
use bun_engine_vm::code::metadata::WeakCell;
use bun_engine_vm::{
    Cx, ElementKind, Gc, ImmutableArray, JsArray, JsFunction, JsObject, JsResult, Value, errors,
};

use super::{Frame, Next, execute};

fn create_rest(cx: &Cx, f: Frame<'_>, skip: u32) -> JsResult<Gc<JsArray>> {
    f.code_block.note_argument_count(f.header);
    let shape = cx.global().array_shape(ElementKind::Contiguous);
    let rest = f.header.rest(skip as usize);
    cx.or_out_of_memory(JsArray::try_from_values_with_shape(cx, shape, rest))
}

execute! {
    Enter(op, cx, f) {
        // SAFETY: what has a code block is one of these.
        f.set(Register::SCOPE, unsafe { JsFunction::scope_of(f.header.callee().cell()) });
        for index in 1..=op.variables {
            f.set(Register::local(index), Value::UNDEFINED);
        }
    }
    Move(op, cx, f) {
        f.set_or_empty(op.dst, f.get_or_empty(op.src));
    }
    Return(op, cx, f) {
        Next::Return(f.get(op.value))
    }
    ToThis(op, cx, f) {
        f.set_profiled(op.this, op.metadata, f.reg(op.this).to_sloppy_this(cx));
    }
    CreateThis(op, cx, f) {
        let new_target = f.cell::<JsObject>(op.new_target);
        f.entry::<WeakCell>(op.metadata).record(f.code_block, &new_target);
        f.set(op.dst, new_target.create_this(cx, op.capacity)?);
    }
    CheckInitialized(op, cx, f) {
        if f.reg_or_empty(op.value).is_none() {
            return Err(errors::throw_uninitialized_variable(cx, f.name(op.name)));
        }
    }
    CheckThis(op, cx, f) {
        if f.reg_or_empty(op.this).is_none() {
            return Err(errors::throw_this_is_not_bound(cx));
        }
    }
    BindThis(op, cx, f) {
        if f.reg_or_empty(op.this).is_some() {
            return Err(cx.throw_reference_error("'super()' can't be called more than once in a constructor."));
        }
        f.set(op.this, f.reg(op.value));
    }
    ArgumentCount(op, cx, f) {
        f.set(op.dst, f.header.argument_count());
    }
    GetArgument(op, cx, f) {
        f.set_profiled(op.dst, op.metadata, f.header.argument(op.index as usize));
    }
    CreateRest(op, cx, f) {
        f.set(op.dst, create_rest(cx, f, op.skip)?);
    }
    EnsureRest(op, cx, f) {
        if f.reg_or_empty(op.rest).is_none() {
            f.set(op.rest, create_rest(cx, f, op.skip)?);
        }
    }
    SpreadArguments(op, cx, f) {
        let can = f.reg_or_empty(op.arguments).is_none() && cx.global().array_iterator_protocol_is_pristine();
        if can && op.for_call {
            f.set_or_empty(op.dst, None);
        } else if can {
            f.code_block.note_argument_count(f.header);
            let list = ImmutableArray::try_from_values(cx, f.header.rest(op.skip as usize));
            f.set(op.dst, cx.or_out_of_memory(list)?);
        }
        Next::jump_if(can)
    }
    GetArgumentsLength(op, cx, f) {
        let length = match f.reg_or_empty(op.arguments) {
            Some(arguments) => arguments.get(cx, names::length)?,
            None => f.header.rest(op.skip as usize).len().into(),
        };
        f.set_profiled(op.dst, op.metadata, length);
    }
    GetArgumentByVal(op, cx, f) {
        let index = f.get(op.key).as_index_int32().filter(|_| f.reg_or_empty(op.arguments).is_none());
        let argument = index.and_then(|index| f.header.rest(op.skip as usize).get(index as usize).copied());
        if let Some(argument) = argument {
            f.set_profiled(op.dst, op.metadata, argument);
        }
        Next::jump_if(argument.is_some())
    }
}
