#[cfg(test)]
mod tests;

use bun_sema::atom::known;
use bun_sema::hir::{self, Chain, ExprId, ExprKind, NodeData};
use smallvec::{SmallVec, smallvec};

use super::intrinsic_call::{
    create_anonymous_callee, find_linked_function, lower_builtin_function_call,
    lower_call_with_rest, lower_conversion, lower_function_apply, lower_function_call,
    lower_if_abrupt_close_iterator, lower_linked_function_call, lower_prepended_argument_call,
    lower_promise_status_test, lower_throw,
};
use super::intrinsic_operation::{KeySpelling, claim_operand_kind, lower_operation};
use super::{Arguments, CallOptions, CallSite, Callee, emit_construct};
use crate::builtins::Intrinsic;
use crate::builtins::id::{BuiltinId, BuiltinName};
use crate::builtins::table;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{FunctionFlags, OperandKind};
use crate::ir::{BlockId, Opcode, PropertyKey, PropertyKeyId, TypeId, TypeTable, ValueId};
use crate::lower::expression::{
    Evaluation, ShortCircuit, emit_locked_builtin, is_chain_root, lower_expression, lower_in_chain,
    skip_type_syntax,
};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, function, parameters};

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
        None if is_chain_root(lowering.file, expression) => {
            lower_in_chain(lowering, ShortCircuit::Undefined, &mut |lowering, exit| {
                lower_intrinsic_value(lowering, expression, intrinsic, Some(exit))
            })
        }
        Some(_) | None => lower_intrinsic_value(lowering, expression, intrinsic, exit),
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
    let callee = skip_type_syntax(lowering.file, hir[node].callee);
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
        Chain::No if is_chain_root(lowering.file, callee) => Err((callee, Misuse::Position)),
        Chain::No | Chain::Continue => try_lower_intrinsic_call(lowering, site, intrinsic),
    };
    finish_intrinsic(lowering, lowered)
}

pub(super) fn lower_intrinsic_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    intrinsic: Intrinsic,
    exit: Option<BlockId>,
) -> ValueId {
    lowering.set_position(lowering.file.hir[expression].pos);
    let lowered = try_lower_intrinsic_value(lowering, expression, intrinsic, exit);
    finish_intrinsic(lowering, lowered)
}

pub(super) fn lower_intrinsic_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    argument: ExprId,
) -> Lowered<ValueId> {
    if is_spread(lowering.file.hir, argument) {
        return Err((argument, Misuse::ArgumentCount));
    }
    Ok(lower_expression(lowering, argument))
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
    let values = arguments.map(|argument| lower_expression(lowering, argument));
    lowering.set_position(lowering.file.hir[site.call].pos);
    Ok(values)
}

pub(super) fn engine_private_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    text: &[u8],
) -> PropertyKeyId {
    let text = file.intern_bytes(text);
    let key = PropertyKey::from_engine_private_name(text);
    file.fragment.property_keys.intern(key)
}

pub(super) fn emit_private_global_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: BuiltinName,
) -> ValueId {
    let key = engine_private_key(lowering.file, table::text_of_name(name));
    let global = lowering.builder.builtin(BuiltinId::GlobalThis);
    lowering.builder.prop_get(global, key, true, false)
}

fn try_lower_intrinsic_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    intrinsic: Intrinsic,
    exit: Option<BlockId>,
) -> Lowered<ValueId> {
    match intrinsic {
        Intrinsic::Builtin(id) => Ok(emit_locked_builtin(lowering, id)),
        Intrinsic::LinkTimeConstant(constant) => Ok(lowering.builder.link_time_constant(constant)),
        Intrinsic::NativeBinding(id) => Ok(lowering.builder.native_binding(id)),
        Intrinsic::Undefined | Intrinsic::Directive(_) | Intrinsic::Erased => {
            Ok(lowering.builder.undefined())
        }
        Intrinsic::Int(value) => Ok(lowering.builder.integer(value)),
        Intrinsic::Bool(value) => Ok(lowering.builder.boolean(value)),
        Intrinsic::Double(value) => Ok(lowering.builder.double(value)),
        Intrinsic::PrivateGlobal | Intrinsic::ReplaceablePrivateGlobal => {
            lower_private_global(lowering, expression)
        }
        Intrinsic::PrivateName | Intrinsic::SymbolKey(_) => {
            Ok(lower_private_member(lowering, expression, exit)?.function)
        }
        Intrinsic::LinkedFunction(linked) => {
            let function = find_linked_function(lowering, expression, linked)?;
            Ok(lowering.builder.new_closure(function, &[]))
        }
        Intrinsic::Operation(_)
        | Intrinsic::Conversion(_)
        | Intrinsic::Throw(_)
        | Intrinsic::IfAbruptCloseIterator
        | Intrinsic::HasJSType { .. }
        | Intrinsic::Construct(_)
        | Intrinsic::NativeCall(_)
        | Intrinsic::IsNullish
        | Intrinsic::IsObject
        | Intrinsic::IsCallable
        | Intrinsic::Call { .. }
        | Intrinsic::Apply
        | Intrinsic::ArrayPush
        | Intrinsic::PutByValDirect { .. }
        | Intrinsic::GetOwnProperty { .. }
        | Intrinsic::ArgumentCount
        | Intrinsic::Argument
        | Intrinsic::PrependArgument { .. }
        | Intrinsic::HasPromiseStatus(_)
        | Intrinsic::BundleError => Err((expression, Misuse::Position)),
    }
}

fn lower_private_global(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> Lowered<ValueId> {
    let ExprKind::Ident(atom) = lowering.file.hir[identifier].kind else {
        return Err((identifier, Misuse::Position));
    };
    let names = lowering.file.inputs.builtin_names;
    let name = names.get_private(atom).or_else(|| names.get(atom));
    let name = name.expect("the resolver found the name of an intrinsic in the table");
    Ok(emit_private_global_get(lowering, name))
}

fn lower_private_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    exit: Option<BlockId>,
) -> Lowered<Callee> {
    let hir = lowering.file.hir;
    let Some((object, _)) = hir.member_key(access) else {
        return Err((access, Misuse::Position));
    };
    if matches!(hir[object].kind, ExprKind::Super) {
        let this = function::get_this(lowering);
        let function = member::lower_member(lowering, access, exit);
        return Ok(create_anonymous_callee(function, Some(this)));
    }
    let (object, name) = member::lower_member_operands(lowering, access, exit);
    lowering.set_position(hir[access].pos);
    let function = member::emit_get(lowering, object, name);
    let key = match name {
        PropertyName::Constant(key) => Some(key),
        PropertyName::Computed(_) => None,
    };
    Ok(Callee {
        function,
        this: Some(object),
        key,
        name: None,
    })
}

fn try_lower_intrinsic_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    intrinsic: Intrinsic,
) -> Lowered<ValueId> {
    match intrinsic {
        Intrinsic::Operation(opcode) => lower_operation(lowering, site, opcode, KeySpelling::Text),
        Intrinsic::HasJSType { first, last } => {
            let [value] = lower_named_arguments(lowering, site)?;
            Ok(lowering.builder.has_js_type(value, first, last))
        }
        Intrinsic::Builtin(id) => Ok(lower_builtin_function_call(lowering, site, id)),
        Intrinsic::Construct(id) => lower_builtin_construct(lowering, site, id),
        Intrinsic::LinkTimeConstant(_)
        | Intrinsic::NativeBinding(_)
        | Intrinsic::Undefined
        | Intrinsic::Int(_)
        | Intrinsic::Bool(_)
        | Intrinsic::Double(_)
        | Intrinsic::PrivateGlobal
        | Intrinsic::ReplaceablePrivateGlobal => {
            let function = lower_intrinsic_value(lowering, site.callee, intrinsic, site.exit);
            let callee = create_anonymous_callee(function, None);
            Ok(lower_call_with_rest(lowering, site, callee, site.arguments))
        }
        Intrinsic::IsNullish => lower_type_test(lowering, site, TypeTable::NULLISH),
        Intrinsic::IsObject => lower_type_test(lowering, site, TypeTable::OBJECT),
        Intrinsic::IsCallable => lower_type_test(lowering, site, TypeTable::FUNCTION),
        Intrinsic::Call { is_never_inlined } => {
            let options = CallOptions {
                is_never_inlined,
                ..site.options
            };
            lower_function_call(lowering, IntrinsicCall { options, ..site })
        }
        Intrinsic::Apply => lower_function_apply(lowering, site),
        Intrinsic::ArrayPush => lower_array_push(lowering, site),
        Intrinsic::PutByValDirect { private_key: false } => lower_element_define(lowering, site),
        Intrinsic::PutByValDirect { private_key: true } => lower_private_define(lowering, site),
        Intrinsic::GetOwnProperty { private_key: false } => {
            lower_operation(lowering, site, Opcode::GetOwnProperty, KeySpelling::Text)
        }
        Intrinsic::GetOwnProperty { private_key: true } => {
            let keys = KeySpelling::EnginePrivateName;
            lower_operation(lowering, site, Opcode::GetOwnProperty, keys)
        }
        Intrinsic::ArgumentCount => lower_argument_count(lowering, site),
        Intrinsic::Argument => lower_argument_read(lowering, site),
        Intrinsic::PrivateName | Intrinsic::SymbolKey(_) => {
            let callee = lower_private_member(lowering, site.callee, site.exit)?;
            Ok(lower_call_with_rest(lowering, site, callee, site.arguments))
        }
        Intrinsic::LinkedFunction(linked) => lower_linked_function_call(lowering, site, linked),
        Intrinsic::PrependArgument { callee, argument } => {
            Ok(lower_prepended_argument_call(lowering, site, callee, argument))
        }
        Intrinsic::HasPromiseStatus(status) => lower_promise_status_test(lowering, site, status),
        Intrinsic::Conversion(conversion) => lower_conversion(lowering, site, conversion),
        Intrinsic::Throw(kind) => lower_throw(lowering, site, kind),
        Intrinsic::IfAbruptCloseIterator => lower_if_abrupt_close_iterator(lowering, site),
        Intrinsic::Erased => Ok(lowering.builder.undefined()),
        Intrinsic::Directive(_) | Intrinsic::NativeCall(_) => Err((site.call, Misuse::Position)),
        Intrinsic::BundleError => Err((site.call, Misuse::BundleError)),
    }
}

fn lower_builtin_construct(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    builtin: BuiltinId,
) -> Lowered<ValueId> {
    let [argument] = lower_named_arguments(lowering, site)?;
    let callee = emit_locked_builtin(lowering, builtin);
    let arguments = Arguments::Values(smallvec![argument]);
    let call_site = CallSite::default();
    Ok(emit_construct(lowering, callee, None, arguments, call_site))
}

fn lower_type_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
    tested: TypeId,
) -> Lowered<ValueId> {
    let [value] = lower_named_arguments(lowering, site)?;
    Ok(lowering.builder.type_test(value, tested))
}

fn lower_array_push(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let [array, value] = lower_named_arguments(lowering, site)?;
    let array = claim_operand_kind(lowering, array, OperandKind::Object);
    let length = PropertyName::Constant(lowering.file.atom_key(known::length));
    let index = member::emit_get(lowering, array, length);
    member::emit_define(lowering, array, PropertyName::Computed(index), value);
    Ok(value)
}

fn lower_element_define(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let [object, key, value] = lower_named_arguments(lowering, site)?;
    let object = claim_operand_kind(lowering, object, OperandKind::Object);
    member::emit_define(lowering, object, PropertyName::Computed(key), value);
    Ok(value)
}

fn lower_private_define(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let hir = lowering.file.hir;
    let [object, key, value] = get_named_arguments(lowering.file, site)?;
    let ExprKind::String(text) = hir[key].kind else {
        return Err((key, Misuse::ArgumentNotLiteral));
    };
    let object = lower_expression(lowering, object);
    let value = lower_expression(lowering, value);
    lowering.set_position(hir[site.call].pos);
    let object = claim_operand_kind(lowering, object, OperandKind::Object);
    let text = lowering.file.queries.atom_bytes(text);
    let key = engine_private_key(lowering.file, text);
    lowering.builder.prop_define(object, key, value);
    Ok(value)
}

fn lower_argument_count(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let [] = get_named_arguments(lowering.file, site)?;
    lowering.builder.argument_count().ok_or((site.call, Misuse::Position))
}

fn lower_argument_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    site: IntrinsicCall<'_>,
) -> Lowered<ValueId> {
    let hir = lowering.file.hir;
    let [argument] = get_named_arguments(lowering.file, site)?;
    let ExprKind::Call(call) = hir[site.call].kind else {
        return Err((site.call, Misuse::Position));
    };
    let Some(position) = parameters::literal_argument_position(hir, &hir[call]) else {
        return Err((argument, Misuse::ArgumentNotLiteral));
    };
    let function = lowering.builder.function();
    let has_rest_parameter = function.flags.contains(FunctionFlags::HAS_REST_PARAMETER);
    let positional = function.parameters.len() - usize::from(has_rest_parameter);
    if position as usize >= positional {
        return Err((site.call, Misuse::Position));
    }
    Ok(lowering.builder.parameter(position))
}

fn finish_intrinsic(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    lowered: Lowered<ValueId>,
) -> ValueId {
    match lowered {
        Ok(value) => value,
        Err((expression, misuse)) => report_misuse(lowering, expression, misuse),
    }
}

fn report_misuse(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    misuse: Misuse,
) -> ValueId {
    let message: &[u8] = match misuse {
        Misuse::Position => b"intrinsic is not valid in this position",
        Misuse::ArgumentCount => b"wrong number of arguments to intrinsic",
        Misuse::ArgumentNotLiteral => b"intrinsic argument must be a literal",
        Misuse::UnknownLinkedFunction => b"the function of this name is not marked $linkTimeConstant",
        Misuse::UnsupportedConversion => b"no operation converts this way",
        Misuse::BundleError => b"$bundleError is reachable",
    };
    let span = lowering.file.span_of(NodeData::Expr(expression));
    let diagnostics = &mut lowering.file.diagnostics;
    diagnostics.report(Code::InvalidRuntimeSource, span, &[message]);
    lowering.builder.undefined()
}
