use bun_sema::bind::Parent;
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::hir::{Call, Chain, ExprId, ExprKind};
use smallvec::SmallVec;

use super::{Arguments, CallSite, array_makers, callee, emit_call, emit_construct};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, table};
use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::expression::{self, lower_expression, lower_expression_for_effect};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FileLowering, FunctionLowering, convert, layouts, object, types};

// A call of a built-in that writes out the structure of what it takes makes what the text says.

struct Entry {
    key: PropertyName,
    value: ValueId,
}

pub(super) fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    callee: ExprId,
) -> Option<BuiltinId> {
    match file
        .builtins
        .of_expr(expression::skip_type_syntax(file, callee))
    {
        Some(Resolved::Builtin(path)) => path.locked_builtin().map(table::canonical_id),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}

/// The literal of `Object.defineProperty(object, key, { .. })`. The call alone has it: what it says becomes part of the definition, also where it says constants alone.
pub(in crate::lower) fn is_written_descriptor(
    file: &FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> bool {
    let Parent::Expr(parent) = file.bound.parent_of_expr(literal) else {
        return false;
    };
    let ExprKind::Call(site) = file.hir[parent].kind else {
        return false;
    };
    let site = file.hir[site];
    let takes_descriptor = matches!(
        find_locked_builtin(file, site.callee),
        Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty)
    );
    takes_descriptor
        && matches!(site.chain, Chain::No)
        && file.hir.ids(site.args).nth(2) == Some(literal)
}

// An `as` is a conversion of the list, which is then made.
fn find_array_literal(file: &FileLowering<'_, '_, '_, '_>, list: ExprId) -> Option<ExprId> {
    let hir = file.hir;
    let mut current = list;
    loop {
        match hir[current].kind {
            ExprKind::Array(_) => return Some(current),
            ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand) => {
                current = operand;
            }
            _ => return None,
        }
    }
}

// The elements of an array literal without a hole and without a spread.
fn find_written_list(
    file: &FileLowering<'_, '_, '_, '_>,
    list: ExprId,
) -> Option<SmallVec<[ExprId; 8]>> {
    let hir = file.hir;
    let ExprKind::Array(elements) = hir[find_array_literal(file, list)?].kind else {
        return None;
    };
    let elements: SmallVec<[ExprId; 8]> = hir.ids(elements).collect();
    let is_value =
        |&element: &ExprId| !matches!(hir[element].kind, ExprKind::Missing | ExprKind::Spread(_));
    elements.iter().all(is_value).then_some(elements)
}

// What flows into a list flows into what the types say that the list holds, whether the list is made or not.
fn record_flow_into_list(file: &mut FileLowering<'_, '_, '_, '_>, list: ExprId) {
    if let Some(literal) = find_array_literal(file, list) {
        types::array_literal_contents(file, literal);
    }
}

fn record_flow_into_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    list: ExprId,
    holds_lists: bool,
) {
    record_flow_into_list(lowering.file, list);
    if holds_lists {
        for pair in find_written_list(lowering.file, list).unwrap_or_default() {
            record_flow_into_list(lowering.file, pair);
        }
    }
    let mut unmade = [lowering.builder.undefined()];
    convert::convert_arguments(lowering, call, &mut unmade);
}

// A pair that is shorter than two is read beyond its end.
fn find_written_pairs(
    file: &FileLowering<'_, '_, '_, '_>,
    list: ExprId,
) -> Option<SmallVec<[SmallVec<[ExprId; 8]>; 8]>> {
    let mut pairs = SmallVec::new();
    for pair in find_written_list(file, list)? {
        let pair = find_written_list(file, pair)?;
        if pair.len() < 2 {
            return None;
        }
        pairs.push(pair);
    }
    Some(pairs)
}

pub(super) fn find_only_argument(
    file: &FileLowering<'_, '_, '_, '_>,
    site: Call,
) -> Option<ExprId> {
    let mut arguments = file.hir.ids(site.args);
    let argument = arguments.next()?;
    let is_spread = matches!(file.hir[argument].kind, ExprKind::Spread(_));
    (arguments.next().is_none() && !is_spread).then_some(argument)
}

fn is_made_of_constants(file: &FileLowering<'_, '_, '_, '_>, list: ExprId) -> bool {
    find_array_literal(file, list).is_some_and(|literal| file.decisions().is_data_literal(literal))
}

fn lower_rest_of_pair(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, pair: &[ExprId]) {
    for &unread in &pair[2..] {
        lower_expression_for_effect(lowering, unread);
    }
}

// `Object.fromEntries([[key, value], ..])`. A key is converted when its property is defined, behind every expression of the list.
fn lower_object_from_entries(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    let list = find_only_argument(lowering.file, site)?;
    let pairs = find_written_pairs(lowering.file, list)?;
    if pairs.is_empty() {
        return None;
    }
    let mut entries: SmallVec<[Entry; 8]> = SmallVec::new();
    for pair in &pairs {
        let key = member::lower_computed_key(lowering, pair[0]);
        let value = lower_expression(lowering, pair[1]);
        lower_rest_of_pair(lowering, pair);
        entries.push(Entry { key, value });
    }
    record_flow_into_argument(lowering, call, list, true);
    lowering.set_position(lowering.file.hir[call].pos);

    let mut names: SmallVec<[(PropertyKeyId, ObjectMemberKind); 8]> = SmallVec::new();
    for entry in &entries {
        if let PropertyName::Constant(key) = entry.key {
            names.push((key, ObjectMemberKind::Field));
        }
    }
    let mut made = if names.len() == entries.len() {
        let layout = layouts::untyped_layout(lowering.file, &names);
        object::begin_object(lowering, layout)
    } else {
        object::begin_dictionary(lowering)
    };
    for entry in entries {
        object::add_property(lowering, &mut made, entry.key, entry.value);
    }
    let made = object::finish_object(lowering, made);
    Some(convert::claim_call_result(lowering, call, made))
}

// `Object.defineProperties(target, Object.getOwnPropertyDescriptors(source))`: nobody but the outer call has the descriptors.
fn lower_definition_by_descriptors(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let arguments: SmallVec<[ExprId; 4]> = hir.ids(site.args).collect();
    let &[target, descriptors] = arguments.as_slice() else {
        return None;
    };
    if matches!(hir[target].kind, ExprKind::Spread(_)) {
        return None;
    }
    let ExprKind::Call(description) = hir[descriptors].kind else {
        return None;
    };
    let description = hir[description];
    if !matches!(description.chain, Chain::No)
        || find_locked_builtin(lowering.file, description.callee)
            != Some(BuiltinId::ObjectGetOwnPropertyDescriptors)
    {
        return None;
    }
    let source = find_only_argument(lowering.file, description)?;

    let target = lower_expression(lowering, target);
    let source = lower_expression(lowering, source);
    lowering.set_position(callee::last_mapped_position(
        lowering.file,
        description.callee,
    ));
    let describe =
        expression::emit_locked_builtin(lowering, BuiltinId::CompilerHelpersDescribeUnlessOrdinary);
    let arguments = Arguments::Values(SmallVec::from_slice(&[source]));
    let described = emit_call(lowering, describe, None, arguments, CallSite::default());

    let mut written = [target, described];
    convert::convert_arguments(lowering, call, &mut written);
    let [target, described] = written;
    lowering.set_position(callee::last_mapped_position(lowering.file, site.callee));
    let define =
        expression::emit_locked_builtin(lowering, BuiltinId::CompilerHelpersDefinePropertiesFrom);
    let define_site = CallSite {
        callee_name: callee::find_callee_name(lowering.file, site.callee),
        ..CallSite::default()
    };
    let arguments = Arguments::Values(SmallVec::from_slice(&[target, described, source]));
    let defined = emit_call(lowering, define, None, arguments, define_site);
    lowering.set_position(hir[call].pos);
    Some(convert::claim_call_result(lowering, call, defined))
}

pub(super) fn try_lower_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    if !matches!(site.chain, Chain::No) {
        return None;
    }
    match find_locked_builtin(lowering.file, site.callee) {
        Some(BuiltinId::ObjectFromEntries) => lower_object_from_entries(lowering, call, site),
        Some(BuiltinId::ObjectDefineProperties) => {
            lower_definition_by_descriptors(lowering, call, site)
        }
        Some(BuiltinId::ArrayFrom) => array_makers::lower_array_from(lowering, call, site),
        Some(BuiltinId::Object) => lower_empty_object(lowering, call, site),
        Some(_) => None,
        None => array_makers::try_lower_method_call(lowering, call, site),
    }
}

fn emit_empty_collection(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    site: Call,
    constructor: BuiltinId,
) -> ValueId {
    lowering.set_position(super::construct_position(lowering.file, expression));
    let function = expression::emit_locked_builtin(lowering, constructor);
    let construct_site = CallSite {
        callee_name: callee::find_callee_name(lowering.file, site.callee),
        ..CallSite::default()
    };
    emit_construct(
        lowering,
        function,
        None,
        Arguments::Values(SmallVec::new()),
        construct_site,
    )
}

fn emit_insertion(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    method: BuiltinId,
    collection: ValueId,
    operands: &[ValueId],
) {
    let method = expression::emit_locked_builtin(lowering, method);
    let arguments = Arguments::Values(SmallVec::from_slice(operands));
    emit_call(
        lowering,
        method,
        Some(collection),
        arguments,
        CallSite::default(),
    );
}

// `new Map([[key, value], ..])`. A list of constants stays: the whole map is laid into the image.
fn lower_map_of_entries(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    site: Call,
) -> Option<ValueId> {
    let list = find_only_argument(lowering.file, site)?;
    if is_made_of_constants(lowering.file, list) {
        return None;
    }
    let pairs = find_written_pairs(lowering.file, list)?;
    let mut entries: SmallVec<[[ValueId; 2]; 8]> = SmallVec::new();
    for pair in &pairs {
        let key = lower_expression(lowering, pair[0]);
        let value = lower_expression(lowering, pair[1]);
        lower_rest_of_pair(lowering, pair);
        entries.push([key, value]);
    }
    record_flow_into_argument(lowering, expression, list, true);
    let map = emit_empty_collection(lowering, expression, site, BuiltinId::Map);
    for entry in &entries {
        emit_insertion(lowering, BuiltinId::MapPrototypeSet, map, entry);
    }
    lowering.set_position(lowering.file.hir[expression].pos);
    Some(convert::claim_call_result(lowering, expression, map))
}

// `new Set([value, ..])`.
fn lower_set_of_values(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    site: Call,
) -> Option<ValueId> {
    let list = find_only_argument(lowering.file, site)?;
    if is_made_of_constants(lowering.file, list) {
        return None;
    }
    let elements = find_written_list(lowering.file, list)?;
    let values: SmallVec<[ValueId; 8]> = elements
        .iter()
        .map(|&element| lower_expression(lowering, element))
        .collect();
    record_flow_into_argument(lowering, expression, list, false);
    let set = emit_empty_collection(lowering, expression, site, BuiltinId::Set);
    for &value in &values {
        emit_insertion(lowering, BuiltinId::SetPrototypeAdd, set, &[value]);
    }
    lowering.set_position(lowering.file.hir[expression].pos);
    Some(convert::claim_call_result(lowering, expression, set))
}

pub(super) fn try_lower_new(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    site: Call,
) -> Option<ValueId> {
    match find_locked_builtin(lowering.file, site.callee)? {
        BuiltinId::Map => lower_map_of_entries(lowering, expression, site),
        BuiltinId::Set => lower_set_of_values(lowering, expression, site),
        BuiltinId::Object => lower_empty_object(lowering, expression, site),
        _ => None,
    }
}

fn lower_empty_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    site: Call,
) -> Option<ValueId> {
    if !site.args.is_empty() {
        return None;
    }
    lowering.set_position(lowering.file.hir[expression].pos);
    let layout = layouts::untyped_layout(lowering.file, &[]);
    let made = object::begin_object(lowering, layout);
    Some(object::finish_object(lowering, made))
}
