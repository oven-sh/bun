use bun_sema::atom::Atom;
use bun_sema::check::aot::{MemberLookup, ShapeKind, TupleElement, TupleElementKind};
use bun_sema::hir::{ExprId, ExprKind, PatId, PatKind, PropId, PropKey, PropKind};
use smallvec::{SmallVec, smallvec};

use super::supertypes::{self, ConversionKind};
use crate::ir::ContentsSlot;
use crate::lower::expression::{self, AssignmentTarget};
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone)]
enum Taken {
    Value(CheckerTypeId),
    RestOfList { list: CheckerTypeId, first: usize },
    RestOfObject(CheckerTypeId),
}

type PendingTargets = SmallVec<[(ExprId, Taken); 8]>;

fn record_default(file: &mut FileLowering<'_, '_, '_, '_>, pattern: PatId, default: ExprId) {
    if let Some(default) = default.some()
        && let Ok(target) = file.queries.binding_type(pattern)
    {
        supertypes::record_flow_into_type(file, default, target, ConversionKind::Performed);
    }
}

// The name under a pattern has the type of what the pattern takes out, so only the whole value and the defaults are converted.
pub(in crate::lower) fn record_binding_pattern_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    pattern: PatId,
    source: Option<ExprId>,
) {
    let hir = file.hir;
    match hir[pattern].kind {
        PatKind::Object(_) | PatKind::Array(_) => {}
        PatKind::Missing | PatKind::Ident(_) => return,
    }
    if let Some(source) = source
        && let Ok(target) = file.queries.binding_type(pattern)
    {
        supertypes::record_flow_into_type(file, source, target, ConversionKind::Performed);
    }
    let mut pending: SmallVec<[PatId; 8]> = smallvec![pattern];
    while let Some(pattern) = pending.pop() {
        match hir[pattern].kind {
            PatKind::Object(properties) => {
                for property in properties.iter().map(|property| hir[property]) {
                    record_default(file, property.value, property.default);
                    pending.push(property.value);
                }
            }
            PatKind::Array(elements) => {
                for element in elements.iter().map(|element| hir[element]) {
                    record_default(file, element.pat, element.default);
                    pending.push(element.pat);
                }
            }
            PatKind::Missing | PatKind::Ident(_) => {}
        }
    }
}

fn find_member_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    object: CheckerTypeId,
    name: Atom,
) -> Option<CheckerTypeId> {
    let object = file.queries.without_nullish(object).ok()?;
    match file.queries.find_member(object, name).ok()? {
        MemberLookup::Member(member) => member.types.checked.ok(),
        MemberLookup::Index(signature) => signature.types.checked.ok(),
        MemberLookup::Absent => None,
    }
}

fn find_tuple_elements<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    list: CheckerTypeId,
) -> Option<&'c [TupleElement]> {
    let list = file.queries.without_nullish(list).ok()?;
    let ShapeKind::Tuple { elements, .. } = file.queries.type_shape(list).ok()?.kind else {
        return None;
    };
    Some(elements)
}

fn find_union_members<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    list: CheckerTypeId,
) -> Option<&'c [CheckerTypeId]> {
    let list = file.queries.without_nullish(list).ok()?;
    let ShapeKind::Union(members) = file.queries.type_shape(list).ok()?.kind else {
        return None;
    };
    Some(members)
}

fn find_common_element_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    lists: &[CheckerTypeId],
    index: usize,
) -> Option<CheckerTypeId> {
    let mut common = None;
    for &list in lists {
        let Some(element) = find_element_type(file, list, index) else {
            continue;
        };
        if common.is_some_and(|common| common != element) {
            return None;
        }
        common = Some(element);
    }
    common
}

pub(super) fn find_element_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    list: CheckerTypeId,
    index: usize,
) -> Option<CheckerTypeId> {
    if let Some(members) = find_union_members(file, list) {
        return find_common_element_type(file, members, index);
    }
    let Some(elements) = find_tuple_elements(file, list) else {
        return find_contents_type(file, list, ContentsSlot::Element);
    };
    for (position, element) in elements.iter().enumerate() {
        match element.kind {
            TupleElementKind::Required | TupleElementKind::Optional if position < index => {}
            TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => {
                return Some(element.ty);
            }
            TupleElementKind::Variadic => return None,
        }
    }
    None
}

pub(super) fn collect_element_types_from(
    file: &mut FileLowering<'_, '_, '_, '_>,
    list: CheckerTypeId,
    first: usize,
) -> SmallVec<[CheckerTypeId; 4]> {
    let Some(elements) = find_tuple_elements(file, list) else {
        return find_contents_type(file, list, ContentsSlot::Element)
            .into_iter()
            .collect();
    };
    let mut types = SmallVec::new();
    for (position, element) in elements.iter().enumerate() {
        match element.kind {
            TupleElementKind::Required | TupleElementKind::Optional if position < first => {}
            TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => {
                types.push(element.ty);
            }
            TupleElementKind::Variadic => {
                types.extend(find_contents_type(file, element.ty, ContentsSlot::Element));
            }
        }
    }
    types
}

fn split_default(file: &FileLowering<'_, '_, '_, '_>, target: ExprId) -> (ExprId, Option<ExprId>) {
    let erased = expression::skip_type_syntax(file, target);
    if let ExprKind::Assign {
        op: None,
        target,
        value,
    } = file.hir[erased].kind
    {
        return (target, Some(value));
    }
    (target, None)
}

fn skip_spread(file: &FileLowering<'_, '_, '_, '_>, element: ExprId) -> ExprId {
    if let ExprKind::Spread(target) = file.hir[element].kind {
        target
    } else {
        element
    }
}

fn add_flowing_operands(
    file: &mut FileLowering<'_, '_, '_, '_>,
    pending: &mut PendingTargets,
    target: ExprId,
    source: ExprId,
) {
    for operand in supertypes::collect_flowing_operands(file, source) {
        if let Ok(ty) = file.queries.expression_type(operand) {
            pending.push((target, Taken::Value(ty)));
        }
    }
}

fn add_target(
    file: &mut FileLowering<'_, '_, '_, '_>,
    pending: &mut PendingTargets,
    target: ExprId,
    taken: Option<CheckerTypeId>,
) {
    let (target, default) = split_default(file, target);
    pending.extend(taken.map(|taken| (target, Taken::Value(taken))));
    if let Some(default) = default {
        add_flowing_operands(file, pending, target, default);
    }
}

fn add_property_target(
    file: &mut FileLowering<'_, '_, '_, '_>,
    pending: &mut PendingTargets,
    property: PropId,
    object: CheckerTypeId,
) {
    let hir = file.hir;
    match hir[property].kind {
        PropKind::Init | PropKind::Shorthand => {}
        PropKind::Spread => {
            let target = skip_spread(file, hir[property].value);
            pending.push((target, Taken::RestOfObject(object)));
            return;
        }
        PropKind::Method | PropKind::Getter | PropKind::Setter => return,
    }
    let member = match hir.runtime_property_key(property) {
        PropKey::Name(name) => find_member_type(file, object, name),
        PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => None,
    };
    add_target(file, pending, hir[property].value, member);
}

fn add_element_target(
    file: &mut FileLowering<'_, '_, '_, '_>,
    pending: &mut PendingTargets,
    element: ExprId,
    list: CheckerTypeId,
    index: usize,
) {
    if let ExprKind::Spread(target) = file.hir[element].kind {
        pending.push((target, Taken::RestOfList { list, first: index }));
        return;
    }
    let taken = find_element_type(file, list, index);
    add_target(file, pending, element, taken);
}

fn record_flow_into_target(file: &mut FileLowering<'_, '_, '_, '_>, target: ExprId, taken: Taken) {
    let Ok(assigned) = file.queries.expression_type(target) else {
        return;
    };
    let position = file.hir[target].pos;
    match taken {
        Taken::Value(source) => {
            let kind = ConversionKind::Asserted;
            supertypes::record_conversion(file, source, assigned, position, kind);
        }
        Taken::RestOfObject(object) => {
            supertypes::record_copied_members(file, object, assigned, position);
        }
        Taken::RestOfList { list, first } => {
            let Some(held) = find_contents_type(file, assigned, ContentsSlot::Element) else {
                return;
            };
            for element in collect_element_types_from(file, list, first) {
                let kind = ConversionKind::Asserted;
                supertypes::record_conversion(file, element, held, position, kind);
            }
        }
    }
}

fn record_taken_values(file: &mut FileLowering<'_, '_, '_, '_>, mut pending: PendingTargets) {
    let hir = file.hir;
    while let Some((target, taken)) = pending.pop() {
        match expression::classify_assignment_target(file, target) {
            AssignmentTarget::Elision => {}
            AssignmentTarget::Identifier { .. } | AssignmentTarget::Expression => {
                record_flow_into_target(file, target, taken);
            }
            AssignmentTarget::ObjectPattern(properties) => {
                let Taken::Value(object) = taken else {
                    continue;
                };
                for property in properties.iter() {
                    add_property_target(file, &mut pending, property, object);
                }
            }
            AssignmentTarget::ArrayPattern(elements) => {
                let (list, first) = match taken {
                    Taken::Value(list) => (list, 0),
                    Taken::RestOfList { list, first } => (list, first),
                    Taken::RestOfObject(_) => continue,
                };
                for (index, element) in hir.ids(elements).enumerate() {
                    add_element_target(file, &mut pending, element, list, first + index);
                }
            }
        }
    }
}

pub(in crate::lower) fn record_assignment_pattern_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    target: ExprId,
    source: ExprId,
) {
    match expression::classify_assignment_target(file, target) {
        AssignmentTarget::ArrayPattern(_) | AssignmentTarget::ObjectPattern(_) => {}
        _ => return,
    }
    let mut pending = PendingTargets::new();
    add_flowing_operands(file, &mut pending, target, source);
    record_taken_values(file, pending);
}

pub(in crate::lower) fn record_assigned_type_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    target: ExprId,
    source: CheckerTypeId,
) {
    record_taken_values(file, smallvec![(target, Taken::Value(source))]);
}
