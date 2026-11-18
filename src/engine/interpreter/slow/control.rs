use bun_engine_bytecode::{DebugHook, ErrorKind};
use bun_engine_text::PropertyName;
use bun_engine_vm::code::metadata::{Counter, Cover, Flags};
use bun_engine_vm::{JsString, errors};

use super::{Next, execute};

execute! {
    Wide16Prefix(op, cx, f) {
        unreachable!()
    }
    Wide32Prefix(op, cx, f) {
        unreachable!()
    }
    Goto(op, cx, f) {
        Next::FirstTarget
    }
    LoopHint(op, cx, f) {
        if cx.traps().need_handling() {
            cx.handle_traps()?;
        }
    }
    JumpIfBuiltin(op, cx, f) {
        let is_builtin = f.reg(op.value) == f.get(op.builtin);
        if !is_builtin {
            f.entry::<Flags>(op.metadata).0.set(1);
        }
        Next::jump_if(is_builtin)
    }
    SwitchInt(op, cx, f) {
        let (table, value) = (&f.code_block.body().int_switches()[op.table.index()], f.get(op.value));
        let number = value.as_number().filter(|&it| f64::from(it as i32) == it);
        Next::Offset(number.map_or(table.default, |number| table.target(number as i32)))
    }
    SwitchChar(op, cx, f) {
        let table = &f.code_block.body().int_switches()[op.table.index()];
        Next::Offset(match f.get(op.value).as_string() {
            Some(string) if string.len() == 1 => table.target(string.unit_at(cx, 0)?.into()),
            _ => table.default,
        })
    }
    SwitchString(op, cx, f) {
        let table = &f.code_block.body().string_switches()[op.table.index()];
        let keys = &f.code_block.code().string_switches[op.table.index()];
        let key = match f.get(op.value).as_string() {
            Some(string) => string.to_existing_property_key(cx)?,
            None => None,
        };
        let case = key.and_then(|key| keys.iter().position(|it| *it == key.name()));
        Next::Offset(case.map_or(table.default, |case| table.targets[case]))
    }
    Catch(op, cx, f) {
        let exception = cx.clear_exception().expect("what the handler was found for");
        f.entry::<Counter>(op.metadata).0.update(|count| count + 1);
        f.set(op.exception, exception);
        f.set(op.value, exception.value());
    }
    Throw(op, cx, f) {
        return Err(cx.throw(f.get(op.value)))
    }
    Rethrow(op, cx, f) {
        return Err(cx.throw_exception(f.cell(op.exception)))
    }
    RethrowIfAny(op, cx, f) {
        if let Some(exception) = f.reg_or_empty(op.exception) {
            return Err(cx.throw_exception(exception.cast()));
        }
    }
    ThrowError(op, cx, f) {
        if op.kind == ErrorKind::OutOfMemory {
            return Err(cx.throw_out_of_memory());
        }
        let message = f.get(op.message).cast::<JsString>().to_string_ref(cx)?;
        return Err(cx.throw_error(errors::error_type_of(op.kind), message))
    }
    ThrowStatic(op, cx, f) {
        return Err(errors::throw_static(cx, op.error, f.name(op.name)))
    }
    ThrowIfNotObject(op, cx, f) {
        if !f.get(op.value).is_object() {
            return Err(errors::throw_static(cx, op.error, PropertyName::EMPTY));
        }
    }
    ThrowIfNullish(op, cx, f) {
        if f.get(op.value).is_undefined_or_null() {
            return Err(errors::throw_static(cx, op.error, f.name(op.name)));
        }
    }
    Debug(op, cx, f) {
        if op.hook == DebugHook::DidReachDebuggerStatement
            || cx.stepping_debugger_count().get() | f.code_block.debugger_requests().get() != 0
        {
            cx.debug(f.header, op.hook);
        }
    }
    JumpIfFrameIsKept(op, cx, f) {
        Next::jump_if(cx.keeps_frame_at_tail_call(f.header))
    }
    Cover(op, cx, f) {
        f.entry::<Cover>(op.metadata).count().update(|count| count + 1);
    }
}
