use bun_sema::fold::Constant;
use bun_sema::hir::ExprId;
use smallvec::{SmallVec, smallvec};

use super::intrinsic::{
    IntrinsicCall, Lowered, Misuse, emit_private_global_get, engine_private_key,
    get_named_arguments, has_spread, lower_intrinsic_argument, lower_named_arguments,
};
use super::{
    Arguments, CallSite, Callee, emit_call, emit_call_at, emit_construct, lower_argument_slice,
};
use crate::builtins::PromiseStatus;
use crate::builtins::id::{BuiltinId, BuiltinName, RuntimeFunction};
use crate::builtins::table::{self, Conversion, ErrorKind};
use crate::ir::generated::{self, BlockRole, RuntimeErrorKind};
use crate::ir::{BlockId, FunctionId, FunctionKey, ValueId};
use crate::lower::control::{self, CleanupLanding, CleanupPath};
use crate::lower::expression::{
    emit_locked_builtin, find_constant, lower_argument_list, lower_expression,
    lower_expression_for_effect,
};
use crate::lower::function::{self, EntryArguments};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, condition, exception};

pub(super) fn create_anonymous_callee(function: ValueId, this: Option<ValueId>) -> Callee {
    Callee {
        function,
        this,
        key: None,
        name: None,
    }
}

pub(super) fn lower_call_with_rest(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    callee: Callee,
    rest: &[ExprId],
) -> ValueId {
    let arguments = lower_argument_slice(lowering, rest);
    lowering.set_position(lowering.file.hir[site.call].pos);
    emit_call_at(lowering, callee, arguments, site.options)
}

fn lower_call_with_this(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    function: ValueId,
    arguments: &[ExprId],
) -> Lowered<ValueId> {
    let (this, rest) = match arguments.split_first() {
        Some((&this, rest)) => (Some(lower_intrinsic_argument(lowering, this)?), rest),
        None => (None, arguments),
    };
    let callee = create_anonymous_callee(function, this);
    Ok(lower_call_with_rest(lowering, site, callee, rest))
}

pub(super) fn lower_function_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    if let Some((function, _)) = lowering.file.hir.member_key(site.callee) {
        let function = member::lower_member_base(lowering, site.callee, function, site.exit);
        return lower_call_with_this(lowering, site, function, site.arguments);
    }
    let Some((&function, arguments)) = site.arguments.split_first() else {
        return Err((site.call, Misuse::ArgumentCount));
    };
    let function = lower_intrinsic_argument(lowering, function)?;
    lower_call_with_this(lowering, site, function, arguments)
}

pub(super) fn lower_function_apply(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let Some((function, _)) = lowering.file.hir.member_key(site.callee) else {
        return Err((site.callee, Misuse::Position));
    };
    let function = member::lower_member_base(lowering, site.callee, function, site.exit);
    let apply = emit_locked_builtin(lowering, BuiltinId::FunctionPrototypeApply);
    let callee = create_anonymous_callee(apply, Some(function));
    Ok(lower_call_with_rest(lowering, site, callee, site.arguments))
}

pub(super) fn lower_builtin_function_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    builtin: BuiltinId,
) -> ValueId {
    let function = emit_locked_builtin(lowering, builtin);
    let holder = table::entry(builtin).holder;
    let this = holder.map(|holder| emit_locked_builtin(lowering, holder));
    let callee = create_anonymous_callee(function, this);
    lower_call_with_rest(lowering, site, callee, site.arguments)
}

pub(super) fn find_linked_function(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
    linked: RuntimeFunction,
) -> Lowered<FunctionId> {
    let function = lowering.file.inputs.library_functions.find(linked);
    let function = function.ok_or((identifier, Misuse::UnknownLinkedFunction))?;
    if function.file == lowering.file.file {
        let source = function.function;
        return Ok(function::declare_source_function(
            lowering.file,
            source,
            None,
        ));
    }
    let key = FunctionKey::Source(function);
    Ok(lowering.file.reference_function(key))
}

pub(super) fn lower_linked_function_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    linked: RuntimeFunction,
) -> Lowered<ValueId> {
    let function = find_linked_function(lowering, site.callee, linked)?;
    let arguments = lower_argument_slice(lowering, site.arguments);
    lowering.set_position(lowering.file.hir[site.call].pos);
    let is_declared_here = lowering.file.function_key(function).home_file() == lowering.file.file;
    Ok(match arguments {
        Arguments::Values(values) if is_declared_here => {
            let entry_arguments = EntryArguments {
                this: None,
                new_target: None,
                parameters: &values,
            };
            function::emit_direct_call(lowering, function, entry_arguments)
        }
        Arguments::Values(_) | Arguments::List(_) => {
            let closure = lowering.builder.new_closure(function, &[]);
            let callee = create_anonymous_callee(closure, None);
            emit_call_at(lowering, callee, arguments, site.options)
        }
    })
}

pub(super) fn lower_prepended_argument_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    callee: BuiltinName,
    argument: u32,
) -> ValueId {
    let hir = lowering.file.hir;
    let position = hir[site.call].pos;
    let function = emit_private_global_get(lowering, callee);
    let prepended = lowering.builder.integer(i64::from(argument));
    let arguments = if has_spread(hir, site.arguments) {
        let list = lower_argument_list(lowering, &[prepended], site.arguments, position);
        Arguments::List(list)
    } else {
        let mut values: SmallVec<[ValueId; 4]> = smallvec![prepended];
        let rest = site.arguments.iter();
        values.extend(rest.map(|&argument| lower_expression(lowering, argument)));
        Arguments::Values(values)
    };
    lowering.set_position(position);
    let callee = create_anonymous_callee(function, None);
    emit_call_at(lowering, callee, arguments, site.options)
}

pub(super) fn lower_promise_status_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    status: PromiseStatus,
) -> Lowered<ValueId> {
    let expected = match status {
        PromiseStatus::Pending => 0,
        PromiseStatus::Fulfilled => 1,
        PromiseStatus::Rejected => 2,
    };
    let key = engine_private_key(lowering.file, b"peekPromiseStatus");
    let global = lowering.builder.builtin(BuiltinId::GlobalThis);
    let function = lowering.builder.prop_get(global, key, true, false);
    let [promise] = lower_named_arguments(lowering, site)?;
    let arguments = Arguments::Values(smallvec![promise]);
    let actual = emit_call(lowering, function, None, arguments, CallSite::default());
    let expected = lowering.builder.integer(expected);
    Ok(lowering.builder.strict_eq(actual, expected))
}

pub(super) fn lower_conversion(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    conversion: Conversion,
) -> Lowered<ValueId> {
    let [value] = lower_named_arguments(lowering, site)?;
    let builder = &mut lowering.builder;
    match conversion {
        Conversion::ToBoolean => Ok(builder.to_boolean(value)),
        Conversion::ToNumber => Ok(builder.to_number(value)),
        Conversion::ToNumeric => Ok(builder.to_numeric(value)),
        Conversion::ToString => Ok(builder.to_string(value)),
        Conversion::ToPropertyKey => Ok(builder.to_property_key(value)),
        Conversion::ToObject => Ok(builder.to_object(value, None)),
        Conversion::ToLength => Ok(builder.to_length(value)),
        Conversion::ToInt32 => {
            let zero = builder.integer(0);
            Ok(builder.bit_or(value, zero))
        }
        Conversion::ToUint32 => {
            let zero = builder.integer(0);
            Ok(builder.ur_shift(value, zero))
        }
        _ => Err((site.call, Misuse::UnsupportedConversion)),
    }
}

fn get_thrown_error(kind: ErrorKind) -> (generated::ErrorKind, BuiltinId) {
    match kind {
        ErrorKind::TypeError => (generated::ErrorKind::TypeError, BuiltinId::TypeError),
        ErrorKind::RangeError => (generated::ErrorKind::RangeError, BuiltinId::RangeError),
    }
}

pub(super) fn lower_throw(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    kind: ErrorKind,
) -> Lowered<ValueId> {
    let [argument] = get_named_arguments(lowering.file, site)?;
    let position = lowering.file.hir[site.call].pos;
    let (error_kind, constructor) = get_thrown_error(kind);
    match find_constant(lowering.file, argument) {
        Some(Constant::String(text)) => {
            let message = lowering.file.intern_atom(text);
            lowering.set_position(position);
            lowering.builder.throw_new_error(error_kind, message);
            lowering.builder.unreachable();
            lowering.begin_unreachable_block();
        }
        Some(
            Constant::Undefined
            | Constant::Null
            | Constant::Boolean(_)
            | Constant::Number(_)
            | Constant::BigInt(_),
        )
        | None => {
            let message = lower_expression(lowering, argument);
            lowering.set_position(position);
            let constructor = emit_locked_builtin(lowering, constructor);
            let arguments = Arguments::Values(smallvec![message]);
            let call_site = CallSite::default();
            let error = emit_construct(lowering, constructor, None, arguments, call_site);
            exception::emit_throw(lowering, error);
        }
    }
    Ok(lowering.builder.undefined())
}

pub(super) fn lower_if_abrupt_close_iterator(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let [iterator, expression] = get_named_arguments(lowering.file, site)?;
    let position = lowering.file.hir[site.call].pos;
    let iterator = lower_expression(lowering, iterator);
    let after = lowering.create_block();

    control::begin_cleanup(lowering, BlockRole::CleanupHandler, None);
    lower_expression_for_effect(lowering, expression);
    // A normal completion closes nothing, so it leaves without an exit of the cleanup.
    lowering.jump(after);

    lowering.set_position(position);
    let landing = CleanupLanding::KeepsException;
    control::end_cleanup_per_exit(lowering, landing, &mut |lowering, path| {
        emit_iterator_object_close(lowering, iterator, path);
    });
    lowering.continue_in(after);
    Ok(lowering.builder.undefined())
}

fn emit_iterator_object_close(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    iterator: ValueId,
    path: CleanupPath,
) {
    let closed = lowering.create_block();
    match path {
        CleanupPath::Normal => {
            let result = emit_return_method_call(lowering, iterator, closed);
            let error = RuntimeErrorKind::IteratorResultNotObject;
            lowering.builder.require_object(result, error);
        }
        CleanupPath::Rethrow | CleanupPath::Throw { .. } => {
            let handler = control::begin_handler(lowering, BlockRole::CatchHandler, None);
            emit_return_method_call(lowering, iterator, closed);
            control::end_handler(lowering, handler);
            lowering.jump(closed);
            lowering.continue_in(handler.block());
            lowering.builder.catch_value();
        }
    }
    lowering.jump(closed);
    lowering.continue_in(closed);
}

fn emit_return_method_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    iterator: ValueId,
    if_absent: BlockId,
) -> ValueId {
    let text = lowering.file.intern_bytes(b"return");
    let key = lowering.file.text_key(text);
    let method = member::emit_get(lowering, iterator, PropertyName::Constant(key));
    let method = condition::branch_if_nullish(lowering, method, if_absent);
    let arguments = Arguments::Values(SmallVec::new());
    emit_call(
        lowering,
        method,
        Some(iterator),
        arguments,
        CallSite::default(),
    )
}
