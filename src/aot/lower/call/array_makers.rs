use bun_sema::hir::{Call, Chain, ExprId, ExprKind, Flags, FnKind, ParamId, PropKey, PropKind};
use smallvec::SmallVec;

use super::written_operands::{find_locked_builtin, find_only_argument};
use super::{Arguments, CallSite, callee, emit_call};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Mutability};
use crate::ir::{TypeTable, ValueId};
use crate::lower::expression::{self, lower_expression};
use crate::lower::{FileLowering, FunctionLowering, condition, convert};

// The ways in which programs write "a list of this length": `Array.from({ length }, mapper)`, `Array(length).fill(value)`, `[...Array(length).keys()]`.

fn is_named(file: &FileLowering<'_, '_, '_, '_>, key: PropKey, name: &[u8]) -> bool {
    matches!(key, PropKey::Name(atom) if file.queries.atom_bytes(atom) == name)
}

// The `n` of `{ length: n }`.
fn find_written_length(file: &FileLowering<'_, '_, '_, '_>, items: ExprId) -> Option<ExprId> {
    let hir = file.hir;
    let ExprKind::Object(properties) = hir[items].kind else {
        return None;
    };
    let mut properties = properties.iter();
    let property = hir[properties.next()?];
    let is_value = matches!(property.kind, PropKind::Init | PropKind::Shorthand);
    (properties.next().is_none() && is_value && is_named(file, property.key, b"length"))
        .then_some(property.value)
}

struct ArrayOfLength {
    construction: ExprId,
    length: ExprId,
}

// `Array(n)`, `new Array(n)`
fn find_array_of_length(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<ArrayOfLength> {
    let hir = file.hir;
    let (ExprKind::Call(site) | ExprKind::New(site)) = hir[expression].kind else {
        return None;
    };
    let site = hir[site];
    if !matches!(site.chain, Chain::No)
        || find_locked_builtin(file, site.callee) != Some(BuiltinId::Array)
    {
        return None;
    }
    Some(ArrayOfLength {
        construction: expression,
        length: find_only_argument(file, site)?,
    })
}

struct MethodCall {
    receiver: ExprId,
    site: Call,
}

// `receiver.name(..)`, where the receiver is a list that the expression itself makes: the method is the one of Array.prototype.
fn find_method_call(
    file: &FileLowering<'_, '_, '_, '_>,
    site: Call,
    name: &[u8],
    method: BuiltinId,
) -> Option<MethodCall> {
    let ExprKind::Dot {
        obj: receiver,
        name: written,
        chain: Chain::No,
        ..
    } = file.hir[site.callee].kind
    else {
        return None;
    };
    let is_fixed = table::entry(method).mutability == Mutability::AlwaysLocked;
    let is_method = matches!(site.chain, Chain::No) && file.queries.atom_bytes(written) == name;
    (is_fixed && is_method).then_some(MethodCall { receiver, site })
}

fn find_method_call_at(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    name: &[u8],
    method: BuiltinId,
) -> Option<MethodCall> {
    let ExprKind::Call(site) = file.hir[expression].kind else {
        return None;
    };
    find_method_call(file, file.hir[site], name, method)
}

// An arrow function has no `arguments`: it sees what its parameters name.
fn takes_at_most_two_operands(file: &FileLowering<'_, '_, '_, '_>, mapper: ExprId) -> bool {
    let hir = file.hir;
    let ExprKind::Fn(function) = hir[mapper].kind else {
        return false;
    };
    let function = &hir[function];
    let is_rest = |parameter: ParamId| hir[parameter].flags.contains(Flags::REST);
    function.kind == FnKind::Arrow
        && function.params.len() <= 2
        && !function.params.iter().any(is_rest)
}

fn is_evaluated_without_effect(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    matches!(
        file.hir[expression].kind,
        ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Fn(_)
    )
}

fn emit_maker(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    position: u32,
    maker: BuiltinId,
    operands: &[ValueId],
) -> ValueId {
    lowering.set_position(position);
    let function = expression::emit_locked_builtin(lowering, maker);
    let made = emit_call(
        lowering,
        function,
        None,
        Arguments::Values(SmallVec::from_slice(operands)),
        CallSite::default(),
    );
    lowering.set_position(lowering.file.hir[call].pos);
    convert::claim_call_result(lowering, call, made)
}

fn lower_operand(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    operand: ExprId,
) -> ValueId {
    let mut operands = [lower_expression(lowering, operand)];
    convert::convert_arguments(lowering, call, &mut operands);
    operands[0]
}

// `Array(-1)` throws before what stands behind it is evaluated.
fn lower_length(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    array: &ArrayOfLength,
    evaluated_behind: &[ExprId],
) -> ValueId {
    let length = lower_operand(lowering, array.construction, array.length);
    if evaluated_behind
        .iter()
        .all(|&expression| is_evaluated_without_effect(lowering.file, expression))
    {
        return length;
    }
    lowering.set_position(super::construct_position(lowering.file, array.construction));
    let check =
        expression::emit_locked_builtin(lowering, BuiltinId::CompilerHelpersCheckedArrayLength);
    emit_call(
        lowering,
        check,
        None,
        Arguments::Values(SmallVec::from_slice(&[length])),
        CallSite::default(),
    )
}

// Array.from({ length: n }), Array.from({ length: n }, mapper)
pub(super) fn lower_array_from(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let arguments: SmallVec<[ExprId; 4]> = hir.ids(site.args).collect();
    if arguments
        .iter()
        .any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
    {
        return None;
    }
    let (&items, mapper) = match arguments.as_slice() {
        [items] => (items, None),
        [items, mapper] => (items, Some(*mapper)),
        _ => return None,
    };
    let length = find_written_length(lowering.file, items)?;
    let length = lower_expression(lowering, length);
    let position = callee::last_mapped_position(lowering.file, site.callee);
    let Some(mapper) = mapper else {
        return Some(emit_maker(
            lowering,
            call,
            position,
            BuiltinId::CompilerHelpersArrayOfUndefined,
            &[length],
        ));
    };
    let is_written_as_function = matches!(hir[mapper].kind, ExprKind::Fn(_));
    let mut written = [
        lowering.builder.undefined(),
        lower_expression(lowering, mapper),
    ];
    convert::convert_arguments(lowering, call, &mut written);
    if is_written_as_function {
        return Some(emit_maker(
            lowering,
            call,
            position,
            BuiltinId::CompilerHelpersArrayFromLength,
            &[length, written[1]],
        ));
    }

    // Array.from takes undefined for no mapper at all, and the list then holds undefined: not what a mapper returns.
    let split =
        condition::split_expression_on_type(lowering, None, written[1], TypeTable::UNDEFINED);
    let result = lowering.builder.create_variable(None);
    let join = lowering.create_block();
    lowering.builder.switch_to(split.taken);
    let made = emit_maker(
        lowering,
        call,
        position,
        BuiltinId::CompilerHelpersArrayOfUndefined,
        &[length],
    );
    lowering.builder.write_variable(result, made);
    lowering.jump(join);
    lowering.builder.switch_to(split.not_taken);
    let made = emit_maker(
        lowering,
        call,
        position,
        BuiltinId::CompilerHelpersArrayFromLength,
        &[length, split.not_taken_value],
    );
    lowering.builder.write_variable(result, made);
    lowering.jump(join);
    lowering.continue_in(join);
    Some(lowering.builder.read_variable(result))
}

// Array(n).fill(value)
fn lower_filled_array(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    let fill = find_method_call(lowering.file, site, b"fill", BuiltinId::ArrayPrototypeFill)?;
    let array = find_array_of_length(lowering.file, fill.receiver)?;
    let value = find_only_argument(lowering.file, fill.site)?;

    let length = lower_length(lowering, &array, &[value]);
    let value = lower_operand(lowering, call, value);
    let position = callee::last_mapped_position(lowering.file, site.callee);
    Some(emit_maker(
        lowering,
        call,
        position,
        BuiltinId::CompilerHelpersFilledArray,
        &[length, value],
    ))
}

// Array(n).fill(value).map(mapper)
fn lower_mapped_filled_array(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    let map = find_method_call(lowering.file, site, b"map", BuiltinId::ArrayPrototypeMap)?;
    let fill = find_method_call_at(
        lowering.file,
        map.receiver,
        b"fill",
        BuiltinId::ArrayPrototypeFill,
    )?;
    let array = find_array_of_length(lowering.file, fill.receiver)?;
    let value = find_only_argument(lowering.file, fill.site)?;
    let mapper = find_only_argument(lowering.file, map.site)?;
    if !takes_at_most_two_operands(lowering.file, mapper) {
        return None;
    }

    let length = lower_length(lowering, &array, &[value, mapper]);
    let value = lower_operand(lowering, map.receiver, value);
    let mapper = lower_operand(lowering, call, mapper);
    let position = callee::last_mapped_position(lowering.file, site.callee);
    Some(emit_maker(
        lowering,
        call,
        position,
        BuiltinId::CompilerHelpersMappedFilledArray,
        &[length, value, mapper],
    ))
}

pub(super) fn try_lower_method_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    lower_filled_array(lowering, call, site)
        .or_else(|| lower_mapped_filled_array(lowering, call, site))
}

// [...Array(n).keys()]
pub(in crate::lower) fn try_lower_list_of_indexes(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let ExprKind::Array(elements) = hir[literal].kind else {
        return None;
    };
    let mut elements = hir.ids(elements);
    let ExprKind::Spread(spread) = hir[elements.next()?].kind else {
        return None;
    };
    if elements.next().is_some() {
        return None;
    }
    let keys = find_method_call_at(
        lowering.file,
        spread,
        b"keys",
        BuiltinId::ArrayPrototypeKeys,
    )?;
    let array = find_array_of_length(lowering.file, keys.receiver)?;
    if hir.ids(keys.site.args).next().is_some() {
        return None;
    }

    let length = lower_length(lowering, &array, &[]);
    lowering.set_position(hir[literal].pos);
    let function =
        expression::emit_locked_builtin(lowering, BuiltinId::CompilerHelpersArrayOfIndexes);
    Some(emit_call(
        lowering,
        function,
        None,
        Arguments::Values(SmallVec::from_slice(&[length])),
        CallSite::default(),
    ))
}
