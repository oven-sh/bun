use bun_sema::atom::{Atom, known};
use bun_sema::bind::Parent;
use bun_sema::check::aot::{
    IndexKey, IndexSignature, MemberLookup, MemberName, PositionTypes, ShapeKind,
};
use bun_sema::hir::{
    BinOp, Branches, ExprId, ExprKind, File, FnId, MemberKey, Prop, PropId, PropKey, PropKind,
    is_proto_setter,
};
use smallvec::{SmallVec, smallvec};

use super::{ObjectBuilder, builder};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::TypeSiteKind;
use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::{
    CheckerTypeId, FileLowering, FunctionLowering, call, condition, convert, data, expression,
    function, layouts,
};

struct AccessorDefinition {
    head: ValueId,
    name: PropertyName,
    closure: ValueId,
}

#[derive(Copy, Clone)]
struct Dictionary {
    ty: CheckerTypeId,
    position: u32,
}

// The types are asked in the order in which a literal finds its layout: the type it is written under, then its own.
fn find_dictionary(file: &mut FileLowering<'_, '_, '_, '_>, literal: ExprId) -> Option<Dictionary> {
    if let ExprKind::Object(properties) = file.hir[literal].kind
        && properties.iter().next().is_none()
    {
        return None;
    }
    let position = file.hir[literal].pos;
    if let Ok(Some(ty)) = file.queries.contextual_type(literal) {
        if layouts::is_dictionary_type(file, ty) {
            return Some(Dictionary { ty, position });
        }
        if layouts::object_type_layout(file, ty).is_some() {
            return None;
        }
    }
    let ty = file.queries.expression_type(literal).ok()?;
    layouts::is_dictionary_type(file, ty).then_some(Dictionary { ty, position })
}

fn has_only_written_names(hir: &File<'_>, literal: ExprId) -> bool {
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    properties.iter().all(|property| {
        let prop = hir[property];
        let is_value = matches!(
            prop.kind,
            PropKind::Init | PropKind::Shorthand | PropKind::Method
        );
        is_value
            && !is_proto_setter(&prop)
            && matches!(hir.runtime_property_key(property), PropKey::Name(_))
    })
}

// `Object.defineProperties(target, { .. })`, `Object.create(base, { .. })`: the built-in takes the literal as a map, name by name, and nobody else sees it.
fn is_map_of_descriptors(file: &FileLowering<'_, '_, '_, '_>, literal: ExprId) -> bool {
    let hir = file.hir;
    let mut child = literal;
    while let Parent::Expr(parent) = file.bound.parent_of_expr(child) {
        if hir.type_assertion_operand(parent) == Some(child) {
            child = parent;
            continue;
        }
        let ExprKind::Call(call) = hir[parent].kind else {
            return false;
        };
        let callee = expression::skip_type_syntax(file, hir[call].callee);
        return hir.ids(hir[call].args).nth(1) == Some(child)
            && matches!(
                file.builtins.builtin_of_expression(callee),
                Some(BuiltinId::ObjectDefineProperties | BuiltinId::ObjectCreate)
            );
    }
    false
}

fn is_marked_literal(file: &FileLowering<'_, '_, '_, '_>, literal: ExprId) -> bool {
    has_only_written_names(file.hir, literal) && !is_map_of_descriptors(file, literal)
}

// `const levels: Record<string, number> = { debug: 0, info: 1 }`: the type allows any name, and the names that the object has are written.
fn begin_under_dictionary_type(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ObjectBuilder {
    let layout = layouts::literal_layout(lowering.file, literal);
    lowering
        .file
        .fragment
        .note_literal_under_dictionary_type(layout);
    let mut object = super::begin_object(lowering, layout);
    builder::open_head(lowering, &mut object);
    object
}

// `{ ...source, a }` where no type says which names the object will have.
fn begins_as_copy(file: &mut FileLowering<'_, '_, '_, '_>, literal: ExprId) -> bool {
    let hir = file.hir;
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    let Some(first) = properties.iter().next().map(|first| hir[first]) else {
        return false;
    };
    if first.kind != PropKind::Spread {
        return false;
    }
    let names_of_source_are_unknown = file
        .queries
        .expression_type(first.value)
        .and_then(|ty| file.queries.type_shape(ty))
        .is_ok_and(|shape| {
            matches!(
                shape.kind,
                ShapeKind::TypeVariable { .. } | ShapeKind::Anything(_) | ShapeKind::AnyObject
            )
        });
    if names_of_source_are_unknown {
        return true;
    }
    let has_object_type = file
        .queries
        .expression_type(literal)
        .and_then(|ty| file.queries.type_shape(ty))
        .is_ok_and(|shape| matches!(shape.kind, ShapeKind::Object));
    if has_object_type {
        return false;
    }
    if file
        .queries
        .is_written_under_type_variable(literal)
        .unwrap_or(false)
    {
        return true;
    }
    let Ok(Some(written)) = file.queries.contextual_type(literal) else {
        return true;
    };
    layouts::object_type_layout(file, written).is_none()
}

fn is_literal(hir: &File<'_>, expression: ExprId) -> bool {
    matches!(
        hir[hir.skip_type_assertions(expression)].kind,
        ExprKind::Array(_) | ExprKind::Object(_)
    )
}

// `Point.prototype = { .. }`: the run time watches the members of a class on an ordinary object alone.
fn is_stored_as_prototype_object(file: &FileLowering<'_, '_, '_, '_>, literal: ExprId) -> bool {
    let hir = file.hir;
    if !matches!(hir[literal].kind, ExprKind::Object(_)) {
        return false;
    }
    let mut child = literal;
    while let Parent::Expr(parent) = file.bound.parent_of_expr(child) {
        if hir.type_assertion_operand(parent) == Some(child) {
            child = parent;
            continue;
        }
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[parent].kind
        else {
            return false;
        };
        return value == child
            && matches!(hir.member_key(target), Some((_, MemberKey::Name(name))) if name == known::prototype);
    }
    false
}

pub(super) fn holds_dictionary_literal(
    file: &mut FileLowering<'_, '_, '_, '_>,
    root: ExprId,
) -> bool {
    debug_assert!(
        file.decisions().is_data_literal(root),
        "a data literal was expected"
    );
    if is_stored_as_prototype_object(file, root) {
        return true;
    }
    let hir = file.hir;
    let mut pending: SmallVec<[ExprId; 8]> = smallvec![root];
    while let Some(expression) = pending.pop() {
        let literal = hir.skip_type_assertions(expression);
        if let ExprKind::Array(items) = hir[literal].kind {
            pending.extend(hir.ids(items).filter(|&item| is_literal(hir, item)));
            continue;
        }
        let ExprKind::Object(properties) = hir[literal].kind else {
            continue;
        };
        if find_dictionary(file, literal).is_some() {
            return true;
        }
        let values = properties.iter().map(|property| hir[property].value);
        pending.extend(values.filter(|&value| is_literal(hir, value)));
    }
    false
}

fn find_types_under_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    dictionary: CheckerTypeId,
    name: Atom,
) -> Option<PositionTypes> {
    match file.queries.find_member(dictionary, name) {
        Ok(MemberLookup::Index(signature)) => Some(signature.types),
        Ok(MemberLookup::Member(_) | MemberLookup::Absent) | Err(_) => None,
    }
}

fn find_key_kind(file: &mut FileLowering<'_, '_, '_, '_>, key: ExprId) -> Option<IndexKey> {
    let ty = file.queries.expression_type(key).ok()?;
    match file.queries.type_shape(ty).ok()?.kind {
        ShapeKind::String | ShapeKind::StringLiteral(_) | ShapeKind::TemplateLiteral { .. } => {
            Some(IndexKey::String)
        }
        ShapeKind::Number | ShapeKind::NumberLiteral(_) | ShapeKind::NumericEnumMember(_) => {
            Some(IndexKey::Number)
        }
        ShapeKind::Symbol => Some(IndexKey::Symbol),
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable { .. }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::BigInt
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::AnyObject
        | ShapeKind::Function(_)
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Class(_)
        | ShapeKind::Object
        | ShapeKind::Union(_)
        | ShapeKind::Constrained { .. } => None,
    }
}

fn find_signature(signatures: &[IndexSignature], key: IndexKey) -> Option<IndexSignature> {
    signatures
        .iter()
        .copied()
        .find(|signature| signature.key == key)
}

// Which pattern a key matches depends on its text, so beside a pattern nothing is said about a key that has only a kind.
fn find_types_under_key_kind(
    file: &mut FileLowering<'_, '_, '_, '_>,
    dictionary: CheckerTypeId,
    key: IndexKey,
) -> Option<PositionTypes> {
    let signatures = file.queries.index_signatures(dictionary).ok()?;
    if find_signature(signatures, IndexKey::Pattern).is_some() {
        return None;
    }
    let found = match key {
        IndexKey::Number => find_signature(signatures, IndexKey::Number)
            .or_else(|| find_signature(signatures, IndexKey::String)),
        IndexKey::String | IndexKey::Pattern => find_signature(signatures, IndexKey::String),
        IndexKey::Symbol => find_signature(signatures, IndexKey::Symbol),
    };
    found.map(|signature| signature.types)
}

fn find_member_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    dictionary: CheckerTypeId,
    key: PropKey,
) -> Option<PositionTypes> {
    match key {
        PropKey::Name(name) => find_types_under_name(file, dictionary, name),
        PropKey::Computed(key) => {
            let kind = find_key_kind(file, key)?;
            find_types_under_key_kind(file, dictionary, kind)
        }
        PropKey::Private(_) | PropKey::None => None,
    }
}

// A member of the literal is converted like the value of `dictionary[key] = value`.
fn convert_dictionary_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    dictionary: Option<Dictionary>,
    key: PropKey,
    value: ValueId,
    source: ExprId,
) -> ValueId {
    let Some(dictionary) = dictionary else {
        return value;
    };
    let Some(types) = find_member_types(lowering.file, dictionary.ty, key) else {
        return value;
    };
    let origin = SiteOrigin {
        kind: TypeSiteKind::Element,
        position: dictionary.position,
    };
    let position = positions::create_position(lowering.file, types, origin);
    let subject = convert::Int32Subject::LiteralProperty;
    convert::describe_int32_flow(lowering, position, subject, Some(source));
    convert::convert_initializer(lowering, value, position, Some(source))
}

fn record_flow_into_signature(
    file: &mut FileLowering<'_, '_, '_, '_>,
    copied: PositionTypes,
    signature: Option<PositionTypes>,
    position: u32,
) {
    if let (Ok(copied), Some(Ok(held))) = (copied.checked, signature.map(|types| types.checked)) {
        convert::record_type_flow(file, copied, held, position);
    }
}

// What is read out of the dictionary is tested against the type of its index signature, so what a spread copies into it goes into the family of that type.
fn record_spread_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    dictionary: Option<Dictionary>,
    source: ExprId,
) {
    let Some(dictionary) = dictionary else {
        return;
    };
    let Ok(copied) = file.queries.expression_type(source) else {
        return;
    };
    let Ok(copied) = file.queries.without_nullish(copied) else {
        return;
    };
    if copied == dictionary.ty {
        return;
    }
    let position = file.hir[source].pos;
    if let Ok(members) = file.queries.object_members(copied) {
        for member in members {
            if let MemberName::String(name) = member.name {
                let signature = find_types_under_name(file, dictionary.ty, name);
                record_flow_into_signature(file, member.types, signature, position);
            }
        }
    }
    if let Ok(signatures) = file.queries.index_signatures(copied) {
        for copied_signature in signatures {
            let signature = find_types_under_key_kind(file, dictionary.ty, copied_signature.key);
            record_flow_into_signature(file, copied_signature.types, signature, position);
        }
    }
}

// `{ __proto__: null }` and nothing else.
fn is_empty_without_prototype(hir: &File<'_>, literal: ExprId) -> bool {
    let ExprKind::Object(props) = hir[literal].kind else {
        return false;
    };
    if props.len() != 1 {
        return false;
    }
    let prop = hir[props.at(0)];
    prop.kind == PropKind::Init
        && is_proto_setter(&prop)
        && matches!(
            hir[hir.skip_type_assertions(prop.value)].kind,
            ExprKind::Null
        )
}

pub(super) fn lower_object_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    literal: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Object(props) = hir[literal].kind else {
        unreachable!("lower_object_literal takes an Object expression");
    };
    // What Object.create(null) makes: the object is born without a prototype and nothing takes one away from it.
    if is_empty_without_prototype(hir, literal) {
        lowering.set_position(hir[literal].pos);
        let null = lowering.builder.null();
        return call::emit_builtin_call(lowering, BuiltinId::ObjectCreate, &[null]);
    }
    if lowering.file.decisions().is_data_literal(literal)
        && !super::holds_dictionary_literal(lowering.file, literal)
    {
        return data::lower_decided_data(lowering, literal);
    }
    let is_prototype_object = is_stored_as_prototype_object(lowering.file, literal);
    let is_copy = !is_prototype_object && begins_as_copy(lowering.file, literal);
    let dictionary = if is_copy {
        None
    } else {
        find_dictionary(lowering.file, literal)
    };
    let mut rest = props.iter();
    let mut object = match dictionary {
        Some(_) if is_marked_literal(lowering.file, literal) => {
            begin_under_dictionary_type(lowering, literal)
        }
        Some(_) => super::begin_dictionary(lowering),
        None if is_prototype_object => super::begin_dictionary(lowering),
        None if is_copy => {
            let first = hir[rest.next().expect("a literal that begins with a spread")];
            lowering.set_position(first.pos);
            let source = expression::lower_expression(lowering, first.value);
            lowering.set_position(first.pos);
            super::begin_copy(lowering, source)
        }
        None => {
            let layout = layouts::literal_layout(lowering.file, literal);
            super::begin_object(lowering, layout)
        }
    };
    for prop in rest {
        lower_property_definition(lowering, &mut object, dictionary, prop);
    }
    lowering.set_position(hir[literal].pos);
    super::finish_object(lowering, object)
}

fn has_only_plain_members(hir: &File<'_>, literal: ExprId) -> bool {
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    properties.iter().all(|property| {
        let prop = hir[property];
        matches!(prop.kind, PropKind::Init | PropKind::Shorthand)
            && !is_proto_setter(&prop)
            && matches!(hir.runtime_property_key(property), PropKey::Name(_))
    })
}

fn ends_in_literal_of_plain_members(file: &FileLowering<'_, '_, '_, '_>, source: ExprId) -> bool {
    let hir = file.hir;
    if expression::is_statically_resolved(file, source) || file.is_simplified(source) {
        return false;
    }
    let is_dead = |arm: ExprId| file.decisions().is_dead_expr(arm);
    match hir[source].kind {
        ExprKind::Object(_) => has_only_plain_members(hir, source),
        ExprKind::Binary {
            op: BinOp::And,
            right,
            ..
        } => !is_dead(right) && ends_in_literal_of_plain_members(file, right),
        ExprKind::Cond { branches, .. } => {
            let Branches { yes, no } = hir.branches(branches);
            !is_dead(yes)
                && !is_dead(no)
                && (ends_in_literal_of_plain_members(file, yes)
                    || ends_in_literal_of_plain_members(file, no))
        }
        _ => false,
    }
}

fn lower_spread(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    dictionary: Option<Dictionary>,
    source: ExprId,
    position: u32,
) {
    let hir = lowering.file.hir;
    if !ends_in_literal_of_plain_members(lowering.file, source) {
        let value = expression::lower_expression(lowering, source);
        lowering.set_position(position);
        record_spread_flow(lowering.file, dictionary, source);
        super::add_spread(lowering, object, value);
        return;
    }
    match hir[source].kind {
        ExprKind::Object(properties) => {
            for property in properties.iter() {
                lower_property_definition(lowering, object, dictionary, property);
            }
        }
        ExprKind::Binary { left, right, .. } => {
            builder::finish_head(lowering, object);
            let if_true = lowering.create_block();
            let join = lowering.create_block();
            condition::lower_condition(lowering, left, if_true, join);
            lowering.continue_in(if_true);
            lower_spread(lowering, object, dictionary, right, position);
            lowering.jump(join);
            lowering.continue_in(join);
        }
        ExprKind::Cond { test, branches } => {
            let Branches { yes, no } = hir.branches(branches);
            builder::finish_head(lowering, object);
            let if_true = lowering.create_block();
            let if_false = lowering.create_block();
            let join = lowering.create_block();
            condition::lower_condition(lowering, test, if_true, if_false);
            lowering.continue_in(if_true);
            lower_spread(lowering, object, dictionary, yes, position);
            lowering.jump(join);
            lowering.continue_in(if_false);
            lower_spread(lowering, object, dictionary, no, position);
            lowering.jump(join);
            lowering.continue_in(join);
        }
        _ => unreachable!("ends_in_literal_of_plain_members has looked"),
    }
}

fn lower_property_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    dictionary: Option<Dictionary>,
    property: PropId,
) {
    let hir = lowering.file.hir;
    let prop = hir[property];
    let key = hir.runtime_property_key(property);
    lowering.set_position(prop.pos);
    match prop.kind {
        PropKind::Spread => lower_spread(lowering, object, dictionary, prop.value, prop.pos),
        PropKind::Init if is_proto_setter(&prop) => {
            let prototype = expression::lower_expression(lowering, prop.value);
            lowering.set_position(prop.pos);
            builder::set_prototype(lowering, object, prototype);
        }
        PropKind::Init | PropKind::Shorthand => {
            let Some(name) = try_lower_property_name(lowering, key) else {
                expression::lower_expression_for_effect(lowering, prop.value);
                return;
            };
            let value = expression::lower_named_evaluation(lowering, prop.value, name);
            lowering.set_position(prop.pos);
            let value = convert_dictionary_member(lowering, dictionary, key, value, prop.value);
            builder::add_member(lowering, object, name, value, Some(prop.value));
        }
        PropKind::Method => {
            let Some(name) = try_lower_property_name(lowering, key) else {
                return;
            };
            lowering.set_position(prop.pos);
            let closure = lower_method_closure(lowering, object, &prop, name);
            let closure = convert_dictionary_member(lowering, dictionary, key, closure, prop.value);
            builder::add_member(lowering, object, name, closure, Some(prop.value));
        }
        PropKind::Getter => {
            if let Some(getter) = lower_accessor_definition(lowering, object, &prop, key) {
                let (computed_key, constant_key) = getter.name.key_operands();
                note_accessor(lowering, constant_key);
                lowering.builder.define_getter(
                    getter.head,
                    getter.closure,
                    computed_key,
                    constant_key,
                );
            }
        }
        PropKind::Setter => {
            if let Some(setter) = lower_accessor_definition(lowering, object, &prop, key) {
                let (computed_key, constant_key) = setter.name.key_operands();
                note_accessor(lowering, constant_key);
                lowering.builder.define_setter(
                    setter.head,
                    setter.closure,
                    computed_key,
                    constant_key,
                );
            }
        }
    }
}

fn note_accessor(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    constant_key: Option<PropertyKeyId>,
) {
    if let Some(key) = constant_key {
        lowering.file.fragment.note_write(key);
    }
}

fn try_lower_property_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: PropKey,
) -> Option<PropertyName> {
    match key {
        PropKey::Name(_) | PropKey::Computed(_) => Some(member::lower_property_name(lowering, key)),
        PropKey::Private(_) | PropKey::None => None,
    }
}

fn lower_method_closure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    prop: &Prop,
    name: PropertyName,
) -> ValueId {
    let function = get_method_function(lowering, prop);
    if !function::captures_home_object(lowering.file, function) {
        return function::lower_function_expression(lowering, function, Some(name));
    }
    let head = builder::open_head(lowering, object);
    function::lower_method(lowering, function, name, head)
}

fn lower_accessor_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: &mut ObjectBuilder,
    prop: &Prop,
    key: PropKey,
) -> Option<AccessorDefinition> {
    let name = try_lower_property_name(lowering, key)?;
    lowering.set_position(prop.pos);
    let head = builder::open_head(lowering, object);
    let function = get_method_function(lowering, prop);
    let closure = function::lower_method(lowering, function, name, head);
    Some(AccessorDefinition {
        head,
        name,
        closure,
    })
}

fn get_method_function(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, prop: &Prop) -> FnId {
    let ExprKind::Fn(function) = lowering.file.hir[prop.value].kind else {
        unreachable!("the value of a method, getter or setter is a function");
    };
    function
}
