use bun_sema::fold::Constant;
use bun_sema::hir::ExprId;
use smallvec::{SmallVec, smallvec};

use super::intrinsic::{
    IntrinsicCall, Lowered, Misuse, get_named_arguments, has_spread, lower_named_arguments,
};
use super::{Arguments, Callee, emit_call};
use crate::builtins::PromiseStatus;
use crate::builtins::id::{BuiltinId, BuiltinName, RuntimeFunction};
use crate::builtins::table::{self, Conversion, ErrorKind};
use crate::ir::generated::{self, BlockRole, RuntimeErrorKind};
use crate::ir::{BlockId, FunctionId, FunctionKey, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::control::{CleanupLanding, CleanupPath};
use crate::lower::expression::find_constant;
use crate::lower::function::{self, EntryArguments};
use crate::lower::member::PropertyName;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_call_with_rest(
        &mut self,
        site: IntrinsicCall<'_>,
        callee: Callee,
        rest: &[ExprId],
    ) -> ValueId {
        let arguments = self.lower_argument_slice(rest);
        self.set_position(self.file.hir[site.call].pos);
        self.emit_call_at(callee, arguments, site.options)
    }

    fn lower_call_with_this(
        &mut self,
        site: IntrinsicCall<'_>,
        function: ValueId,
        arguments: &[ExprId],
    ) -> Lowered<ValueId> {
        let (this, rest) = match arguments.split_first() {
            Some((&this, rest)) => (Some(self.lower_intrinsic_argument(this)?), rest),
            None => (None, arguments),
        };
        let callee = Callee::without_key(function, this, None);
        Ok(self.lower_call_with_rest(site, callee, rest))
    }

    pub(super) fn lower_function_call(&mut self, site: IntrinsicCall<'_>) -> Lowered<ValueId> {
        if let Some((function, _)) = self.file.hir.member_key(site.callee) {
            let function = self.lower_member_base(site.callee, function, site.exit);
            return self.lower_call_with_this(site, function, site.arguments);
        }
        let Some((&function, arguments)) = site.arguments.split_first() else {
            return Err((site.call, Misuse::ArgumentCount));
        };
        let function = self.lower_intrinsic_argument(function)?;
        self.lower_call_with_this(site, function, arguments)
    }

    pub(super) fn lower_function_apply(&mut self, site: IntrinsicCall<'_>) -> Lowered<ValueId> {
        let Some((function, _)) = self.file.hir.member_key(site.callee) else {
            return Err((site.callee, Misuse::Position));
        };
        let function = self.lower_member_base(site.callee, function, site.exit);
        let apply = self.emit_locked_builtin(BuiltinId::FunctionPrototypeApply);
        let callee = Callee::without_key(apply, Some(function), None);
        Ok(self.lower_call_with_rest(site, callee, site.arguments))
    }

    pub(super) fn lower_builtin_function_call(
        &mut self,
        site: IntrinsicCall<'_>,
        builtin: BuiltinId,
    ) -> ValueId {
        let function = self.emit_locked_builtin(builtin);
        let holder = table::entry(builtin).holder;
        let this = holder.map(|holder| self.emit_locked_builtin(holder));
        let callee = Callee::without_key(function, this, None);
        self.lower_call_with_rest(site, callee, site.arguments)
    }

    pub(super) fn lower_linked_function_call(
        &mut self,
        site: IntrinsicCall<'_>,
        linked: RuntimeFunction,
    ) -> Lowered<ValueId> {
        let function = find_linked_function(self, site.callee, linked)?;
        let arguments = self.lower_argument_slice(site.arguments);
        self.set_position(self.file.hir[site.call].pos);
        let is_declared_here = self.file.function_key(function).home_file() == self.file.file;
        Ok(match arguments {
            Arguments::Values(values) if is_declared_here => {
                let entry_arguments = EntryArguments {
                    this: None,
                    new_target: None,
                    parameters: &values,
                };
                self.emit_direct_call(function, entry_arguments)
            }
            Arguments::Values(_) | Arguments::List(_) => {
                let closure = self.builder.new_closure(function, &[]);
                let callee = Callee::without_key(closure, None, None);
                self.emit_call_at(callee, arguments, site.options)
            }
        })
    }

    pub(super) fn lower_prepended_argument_call(
        &mut self,
        site: IntrinsicCall<'_>,
        callee: BuiltinName,
        argument: u32,
    ) -> ValueId {
        let hir = self.file.hir;
        let position = hir[site.call].pos;
        let function = self.emit_private_global_get(table::text_of_name(callee));
        let prepended = self.builder.integer(i64::from(argument));
        let arguments = if has_spread(hir, site.arguments) {
            let list = self.lower_argument_list(&[prepended], site.arguments, position);
            Arguments::List(list)
        } else {
            let mut values: SmallVec<[ValueId; 4]> = smallvec![prepended];
            let rest = site.arguments.iter();
            values.extend(rest.map(|&argument| self.lower_expression(argument)));
            Arguments::Values(values)
        };
        self.set_position(position);
        let callee = Callee::without_key(function, None, None);
        self.emit_call_at(callee, arguments, site.options)
    }

    pub(super) fn lower_promise_status_test(
        &mut self,
        site: IntrinsicCall<'_>,
        status: PromiseStatus,
    ) -> Lowered<ValueId> {
        let expected = match status {
            PromiseStatus::Pending => 0,
            PromiseStatus::Fulfilled => 1,
            PromiseStatus::Rejected => 2,
        };
        let function = self.emit_private_global_get(b"peekPromiseStatus");
        let [promise] = lower_named_arguments(self, site)?;
        let actual = emit_call(self, function, None, &[promise]);
        let expected = self.builder.integer(expected);
        Ok(self.builder.strict_eq(actual, expected))
    }

    pub(super) fn lower_conversion(
        &mut self,
        site: IntrinsicCall<'_>,
        conversion: Conversion,
    ) -> Lowered<ValueId> {
        let [value] = lower_named_arguments(self, site)?;
        let builder = &mut self.builder;
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

    fn emit_iterator_object_close(&mut self, iterator: ValueId, path: CleanupPath) {
        let closed = self.create_block();
        match path {
            CleanupPath::Normal => {
                let result = self.emit_return_method_call(iterator, closed);
                let error = RuntimeErrorKind::IteratorResultNotObject;
                self.builder.require_object(result, error);
            }
            CleanupPath::Rethrow | CleanupPath::Throw { .. } => {
                let handler = self.begin_handler(BlockRole::CatchHandler, None);
                self.emit_return_method_call(iterator, closed);
                self.end_handler(handler);
                self.jump(closed);
                self.continue_in(handler.block());
                self.builder.catch_value();
            }
        }
        self.jump(closed);
        self.continue_in(closed);
    }

    fn emit_return_method_call(&mut self, iterator: ValueId, if_absent: BlockId) -> ValueId {
        let text = self.file.intern_bytes(b"return");
        let key = self.file.text_key(text);
        let method = self.emit_get(iterator, PropertyName::Constant(key));
        let method = self.branch_if_nullish(method, if_absent);
        emit_call(self, method, Some(iterator), &[])
    }
}

pub(super) fn find_linked_function(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
    linked: RuntimeFunction,
) -> Lowered<FunctionId> {
    let function = lowering.file.inputs.library_functions.find(linked);
    let function = function.ok_or((identifier, Misuse::UnknownLinkedFunction))?;
    let key = FunctionKey::Source(function);
    Ok(if function.file == lowering.file.file {
        function::declare_source_function(lowering.file, function.function, None)
    } else {
        lowering.file.reference_function(key)
    })
}

pub(super) fn lower_throw(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    kind: ErrorKind,
) -> Lowered<ValueId> {
    let [argument] = get_named_arguments(lowering.file, site)?;
    let position = lowering.file.hir[site.call].pos;
    let (error_kind, constructor) = match kind {
        ErrorKind::TypeError => (generated::ErrorKind::TypeError, BuiltinId::TypeError),
        ErrorKind::RangeError => (generated::ErrorKind::RangeError, BuiltinId::RangeError),
    };
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
            let message = lowering.lower_expression(argument);
            lowering.set_position(position);
            let constructor = lowering.emit_locked_builtin(constructor);
            let arguments = Arguments::Values(smallvec![message]);
            let error = lowering.emit_construct(constructor, arguments, None);
            lowering.emit_throw(error);
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
    let iterator = lowering.lower_expression(iterator);
    let after = lowering.create_block();

    lowering.begin_cleanup(BlockRole::CleanupHandler, None);
    lowering.lower_expression_for_effect(expression);
    // A normal completion closes nothing, so it leaves without an exit of the cleanup.
    lowering.jump(after);

    lowering.set_position(position);
    let landing = CleanupLanding::KeepsException;
    lowering.end_cleanup_per_exit(landing, &mut |lowering, path| {
        lowering.emit_iterator_object_close(iterator, path);
    });
    lowering.continue_in(after);
    Ok(lowering.builder.undefined())
}
