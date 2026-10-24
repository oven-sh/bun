#[cfg(test)]
mod tests;

use bun_sema::atom::known;
use bun_sema::hir::{self, Chain, ExprId, ExprKind, NodeData};
use smallvec::{SmallVec, smallvec};

use super::intrinsic_call::{find_linked_function, lower_if_abrupt_close_iterator, lower_throw};
use super::{Arguments, CallOptions, Callee};
use crate::builtins::Intrinsic;
use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{FunctionFlags, OperandKind};
use crate::ir::{BlockId, Opcode, PropertyKey, PropertyKeyId, TypeId, TypeTable, ValueId};
use crate::lower::expression::{Evaluation, ShortCircuit};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, parameters};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Misuse {
    Position,
    ArgumentCount,
    ArgumentNotLiteral,
    UnknownLinkedFunction,
    UnsupportedConversion,
    BundleError,
}

pub(super) type Lowered<T> = Result<T, (ExprId, Misuse)>;

#[derive(Copy, Clone)]
pub(super) struct IntrinsicCall<'l> {
    pub(super) call: ExprId,
    pub(super) callee: ExprId,
    pub(super) arguments: &'l [ExprId],
    pub(super) exit: Option<BlockId>,
    pub(super) options: CallOptions<'l>,
}

fn is_spread(hir: &hir::File<'_>, argument: ExprId) -> bool {
    matches!(hir[argument].kind, ExprKind::Spread(_))
}

pub(super) fn has_spread(hir: &hir::File<'_>, arguments: &[ExprId]) -> bool {
    arguments.iter().any(|&argument| is_spread(hir, argument))
}

pub(in crate::lower) fn lower_intrinsic_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    intrinsic: Intrinsic,
    exit: Option<BlockId>,
) -> ValueId {
    match exit {
        None if lowering.file.is_chain_root(expression) => lowering
            .lower_in_chain(ShortCircuit::Undefined, &mut |lowering, exit| {
                lowering.lower_intrinsic_value(expression, intrinsic, Some(exit))
            }),
        Some(_) | None => lowering.lower_intrinsic_value(expression, intrinsic, exit),
    }
}

pub(super) fn lower_intrinsic_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    intrinsic: Intrinsic,
    evaluation: Evaluation<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Call(node) = hir[call].kind else {
        unreachable!("lower_intrinsic_call takes a Call expression");
    };
    let arguments: SmallVec<[ExprId; 4]> = hir.ids(hir[node].args).collect();
    let callee = lowering.file.skip_type_syntax(hir[node].callee);
    let site = IntrinsicCall {
        call,
        callee,
        arguments: &arguments,
        exit: evaluation.chain_exit,
        options: CallOptions {
            tail: evaluation.tail,
            expected_result: None,
            is_never_inlined: false,
        },
    };
    let lowered = match hir[node].chain {
        Chain::Start => Err((call, Misuse::Position)),
        Chain::No if lowering.file.is_chain_root(callee) => Err((callee, Misuse::Position)),
        Chain::No | Chain::Continue => lowering.try_lower_intrinsic_call(site, intrinsic),
    };
    lowering.finish_intrinsic(lowered)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_intrinsic_value(
        &mut self,
        expression: ExprId,
        intrinsic: Intrinsic,
        exit: Option<BlockId>,
    ) -> ValueId {
        self.set_position(self.file.hir[expression].pos);
        let lowered = self.try_lower_intrinsic_value(expression, intrinsic, exit);
        self.finish_intrinsic(lowered)
    }

    pub(super) fn lower_intrinsic_argument(&mut self, argument: ExprId) -> Lowered<ValueId> {
        if is_spread(self.file.hir, argument) {
            return Err((argument, Misuse::ArgumentCount));
        }
        Ok(self.lower_expression(argument))
    }

    pub(super) fn emit_private_global_get(&mut self, name: &[u8]) -> ValueId {
        let key = self.file.engine_private_key(name);
        let global = self.builder.builtin(BuiltinId::GlobalThis);
        self.builder.prop_get(global, key, true, false)
    }

    fn try_lower_intrinsic_value(
        &mut self,
        expression: ExprId,
        intrinsic: Intrinsic,
        exit: Option<BlockId>,
    ) -> Lowered<ValueId> {
        match intrinsic {
            Intrinsic::Builtin(id) => Ok(self.emit_locked_builtin(id)),
            Intrinsic::LinkTimeConstant(constant) => Ok(self.builder.link_time_constant(constant)),
            Intrinsic::NativeBinding(id) => Ok(self.builder.native_binding(id)),
            Intrinsic::Undefined | Intrinsic::Directive(_) | Intrinsic::Erased => {
                Ok(self.builder.undefined())
            }
            Intrinsic::Int(value) => Ok(self.builder.integer(value)),
            Intrinsic::Bool(value) => Ok(self.builder.boolean(value)),
            Intrinsic::Double(value) => Ok(self.builder.double(value)),
            Intrinsic::PrivateGlobal | Intrinsic::ReplaceablePrivateGlobal => {
                let ExprKind::Ident(atom) = self.file.hir[expression].kind else {
                    return Err((expression, Misuse::Position));
                };
                let names = self.file.inputs.builtin_names;
                let name = names.get_private(atom).or_else(|| names.get(atom));
                let name = name.expect("the resolver found the name of an intrinsic in the table");
                Ok(self.emit_private_global_get(table::text_of_name(name)))
            }
            Intrinsic::PrivateName | Intrinsic::SymbolKey(_) => {
                Ok(self.lower_private_member(expression, exit)?.function)
            }
            Intrinsic::LinkedFunction(linked) => {
                let function = find_linked_function(self, expression, linked)?;
                Ok(self.builder.new_closure(function, &[]))
            }
            _ => Err((expression, Misuse::Position)),
        }
    }

    fn lower_private_member(&mut self, access: ExprId, exit: Option<BlockId>) -> Lowered<Callee> {
        let hir = self.file.hir;
        let Some((object, _)) = hir.member_key(access) else {
            return Err((access, Misuse::Position));
        };
        if matches!(hir[object].kind, ExprKind::Super) {
            let this = self.get_this();
            let function = member::lower_member(self, access, exit);
            return Ok(Callee::without_key(function, Some(this), None));
        }
        let (object, name) = member::lower_member_operands(self, access, exit);
        self.set_position(hir[access].pos);
        let function = self.emit_get(object, name);
        Ok(Callee {
            function,
            this: Some(object),
            key: name.key_operands().1,
            name: None,
        })
    }

    fn try_lower_intrinsic_call(
        &mut self,
        site: IntrinsicCall<'_>,
        intrinsic: Intrinsic,
    ) -> Lowered<ValueId> {
        match intrinsic {
            Intrinsic::Operation(opcode) => self.lower_operation(site, opcode, false),
            Intrinsic::HasJSType { first, last } => {
                let [value] = lower_named_arguments(self, site)?;
                Ok(self.builder.has_js_type(value, first, last))
            }
            Intrinsic::Builtin(id) => Ok(self.lower_builtin_function_call(site, id)),
            Intrinsic::Construct(id) => {
                let [argument] = lower_named_arguments(self, site)?;
                let callee = self.emit_locked_builtin(id);
                let arguments = Arguments::Values(smallvec![argument]);
                Ok(self.emit_construct(callee, arguments, None))
            }
            Intrinsic::IsNullish => self.lower_type_test(site, TypeTable::NULLISH),
            Intrinsic::IsObject => self.lower_type_test(site, TypeTable::OBJECT),
            Intrinsic::IsCallable => self.lower_type_test(site, TypeTable::FUNCTION),
            Intrinsic::Call { is_never_inlined } => {
                let options = CallOptions {
                    is_never_inlined,
                    ..site.options
                };
                self.lower_function_call(IntrinsicCall { options, ..site })
            }
            Intrinsic::Apply => self.lower_function_apply(site),
            Intrinsic::ArrayPush => self.lower_array_push(site),
            Intrinsic::PutByValDirect { private_key: false } => {
                let [object, key, value] = lower_named_arguments(self, site)?;
                let object = self.claim_operand_kind(object, OperandKind::Object);
                self.emit_define(object, PropertyName::Computed(key), value);
                Ok(value)
            }
            Intrinsic::PutByValDirect { private_key: true } => self.lower_private_define(site),
            Intrinsic::GetOwnProperty { private_key } => {
                self.lower_operation(site, Opcode::GetOwnProperty, private_key)
            }
            Intrinsic::ArgumentCount => {
                let [] = get_named_arguments(self.file, site)?;
                let count = self.builder.argument_count();
                count.ok_or((site.call, Misuse::Position))
            }
            Intrinsic::Argument => self.lower_argument_read(site),
            Intrinsic::PrivateName | Intrinsic::SymbolKey(_) => {
                let callee = self.lower_private_member(site.callee, site.exit)?;
                Ok(self.lower_call_with_rest(site, callee, site.arguments))
            }
            Intrinsic::LinkedFunction(linked) => self.lower_linked_function_call(site, linked),
            Intrinsic::PrependArgument { callee, argument } => {
                Ok(self.lower_prepended_argument_call(site, callee, argument))
            }
            Intrinsic::HasPromiseStatus(status) => self.lower_promise_status_test(site, status),
            Intrinsic::Conversion(conversion) => self.lower_conversion(site, conversion),
            Intrinsic::Throw(kind) => lower_throw(self, site, kind),
            Intrinsic::IfAbruptCloseIterator => lower_if_abrupt_close_iterator(self, site),
            Intrinsic::Erased => Ok(self.builder.undefined()),
            Intrinsic::Directive(_) | Intrinsic::NativeCall(_) => {
                Err((site.call, Misuse::Position))
            }
            Intrinsic::BundleError => Err((site.call, Misuse::BundleError)),
            _ => {
                let function = self.lower_intrinsic_value(site.callee, intrinsic, site.exit);
                let callee = Callee::without_key(function, None, None);
                Ok(self.lower_call_with_rest(site, callee, site.arguments))
            }
        }
    }

    fn lower_type_test(&mut self, site: IntrinsicCall<'_>, tested: TypeId) -> Lowered<ValueId> {
        let [value] = lower_named_arguments(self, site)?;
        Ok(self.builder.type_test(value, tested))
    }

    fn lower_array_push(&mut self, site: IntrinsicCall<'_>) -> Lowered<ValueId> {
        let [array, value] = lower_named_arguments(self, site)?;
        let array = self.claim_operand_kind(array, OperandKind::Object);
        let length = PropertyName::Constant(self.file.atom_key(known::length));
        let index = self.emit_get(array, length);
        self.emit_define(array, PropertyName::Computed(index), value);
        Ok(value)
    }

    fn lower_private_define(&mut self, site: IntrinsicCall<'_>) -> Lowered<ValueId> {
        let hir = self.file.hir;
        let [object, key, value] = get_named_arguments(self.file, site)?;
        let ExprKind::String(text) = hir[key].kind else {
            return Err((key, Misuse::ArgumentNotLiteral));
        };
        let object = self.lower_expression(object);
        let value = self.lower_expression(value);
        self.set_position(hir[site.call].pos);
        let object = self.claim_operand_kind(object, OperandKind::Object);
        let text = self.file.queries.atom_bytes(text);
        let key = self.file.engine_private_key(text);
        self.builder.prop_define(object, key, value);
        Ok(value)
    }

    fn lower_argument_read(&mut self, site: IntrinsicCall<'_>) -> Lowered<ValueId> {
        let hir = self.file.hir;
        let [argument] = get_named_arguments(self.file, site)?;
        let ExprKind::Call(call) = hir[site.call].kind else {
            return Err((site.call, Misuse::Position));
        };
        let Some(position) = parameters::literal_argument_position(hir, &hir[call]) else {
            return Err((argument, Misuse::ArgumentNotLiteral));
        };
        let function = self.builder.function();
        let has_rest_parameter = function.flags.contains(FunctionFlags::HAS_REST_PARAMETER);
        let positional = function.parameters.len() - usize::from(has_rest_parameter);
        if position as usize >= positional {
            return Err((site.call, Misuse::Position));
        }
        Ok(self.builder.parameter(position))
    }

    fn finish_intrinsic(&mut self, lowered: Lowered<ValueId>) -> ValueId {
        let (expression, misuse) = match lowered {
            Ok(value) => return value,
            Err(misused) => misused,
        };
        let message: &[u8] = match misuse {
            Misuse::Position => b"intrinsic is not valid in this position",
            Misuse::ArgumentCount => b"wrong number of arguments to intrinsic",
            Misuse::ArgumentNotLiteral => b"intrinsic argument must be a literal",
            Misuse::UnknownLinkedFunction => {
                b"the function of this name is not marked $linkTimeConstant"
            }
            Misuse::UnsupportedConversion => b"no operation converts this way",
            Misuse::BundleError => b"$bundleError is reachable",
        };
        let span = self.file.span_of(NodeData::Expr(expression));
        let diagnostics = &mut self.file.diagnostics;
        diagnostics.report(Code::InvalidRuntimeSource, span, &[message]);
        self.builder.undefined()
    }
}

pub(super) fn get_named_arguments<const N: usize>(
    file: &FileLowering<'_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<[ExprId; N]> {
    match <[ExprId; N]>::try_from(site.arguments) {
        Ok(arguments) if !has_spread(file.hir, site.arguments) => Ok(arguments),
        Ok(_) | Err(_) => Err((site.call, Misuse::ArgumentCount)),
    }
}

pub(super) fn lower_named_arguments<const N: usize>(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<[ValueId; N]> {
    let arguments: [ExprId; N] = get_named_arguments(lowering.file, site)?;
    let values = arguments.map(|argument| lowering.lower_expression(argument));
    lowering.set_position(lowering.file.hir[site.call].pos);
    Ok(values)
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn engine_private_key(&mut self, text: &[u8]) -> PropertyKeyId {
        let text = self.intern_bytes(text);
        let key = PropertyKey::from_engine_private_name(text);
        self.fragment.property_keys.intern(key)
    }
}
