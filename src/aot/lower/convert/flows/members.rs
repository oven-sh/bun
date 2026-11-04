use bun_sema::check::aot::{GaveUp, ShapeKind};
use smallvec::{SmallVec, smallvec};

use super::{FlowTarget, is_container};
use crate::ir::{LayoutId, Type, TypeId};
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone)]
struct Member {
    ty: CheckerTypeId,
    layout: LayoutId,
}

type Members = SmallVec<[Member; 4]>;

fn collect_members(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Members {
    let mut members = Members::new();
    let mut opened: SmallVec<[CheckerTypeId; 4]> = SmallVec::new();
    let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
    while let Some(ty) = pending.pop() {
        let Ok(shape) = file.queries.type_shape(ty) else {
            continue;
        };
        let layout = match shape.kind {
            ShapeKind::Union(_) | ShapeKind::TypeVariable { .. } if opened.contains(&ty) => None,
            ShapeKind::Union(parts) => {
                opened.push(ty);
                pending.extend_from_slice(parts);
                None
            }
            ShapeKind::TypeVariable { constraint, .. } => {
                opened.push(ty);
                pending.extend(constraint);
                None
            }
            ShapeKind::Class(class) => Some(file.class_layout(class)),
            ShapeKind::Object => file.object_type_layout(ty),
            ShapeKind::AnyObject => file.module_type_layout(ty),
            ShapeKind::Anything(_)
            | ShapeKind::Never
            | ShapeKind::Undefined
            | ShapeKind::Null
            | ShapeKind::Boolean
            | ShapeKind::BooleanLiteral(_)
            | ShapeKind::Number
            | ShapeKind::NumberLiteral(_)
            | ShapeKind::NumericEnumMember(_)
            | ShapeKind::BigInt
            | ShapeKind::BigIntLiteral { .. }
            | ShapeKind::String
            | ShapeKind::StringLiteral(_)
            | ShapeKind::TemplateLiteral { .. }
            | ShapeKind::Symbol
            | ShapeKind::Int32 { .. }
            | ShapeKind::Function(_)
            | ShapeKind::ClassConstructor(_)
            | ShapeKind::Array { .. }
            | ShapeKind::Tuple { .. }
            | ShapeKind::Builtin { .. } => None,
        };
        members.extend(layout.map(|layout| Member { ty, layout }));
    }
    members
}

fn has_one_layout(file: &FileLowering<'_, '_, '_, '_>, ty: TypeId) -> bool {
    file.fragment.types.get(ty).layouts.len() == 1
}

fn has_container_member(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    let ShapeKind::Union(members) = shape.kind else {
        return false;
    };
    members.iter().any(|&member| is_container(file, member))
}

fn is_assignable_without_nullish(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
) -> Result<bool, GaveUp> {
    let objects = file.queries.without_nullish(source).unwrap_or(source);
    file.queries.is_assignable(objects, target)
}

fn record_pair(file: &mut FileLowering<'_, '_, '_, '_>, source: TypeId, target: FlowTarget) {
    // Also where both types have one layout, and there is no pair to record.
    file.note_layouts_of_objects(target.mapped);
    let facts = &mut file.fragment.family_facts;
    facts.record_conversion(source, target.mapped);
}

// One type for all of them: the checker lists the members of a union in the order of their ids, which follow its schedule, and link reads the pairs in the order they were recorded.
fn union_of_layouts(file: &mut FileLowering<'_, '_, '_, '_>, members: &[Member]) -> TypeId {
    let types = &mut file.fragment.types;
    let layouts: SmallVec<[TypeId; 4]> = members
        .iter()
        .map(|member| types.intern(Type::layout(member.layout)))
        .collect();
    types.union_all(layouts)
}

pub(super) fn record_layout_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    mapped: TypeId,
    target: FlowTarget,
) {
    let has_one_target = has_one_layout(file, target.mapped);
    if has_one_target && has_one_layout(file, mapped) {
        return record_pair(file, mapped, target);
    }
    let facts = &mut file.fragment.family_facts;
    if !facts.begins_member_flow(source, target.ty) {
        return;
    }
    let accepted = is_assignable_without_nullish(file, source, target.ty);
    if accepted == Ok(true) && has_one_target && !has_container_member(file, target.ty) {
        return record_pair(file, mapped, target);
    }
    let sources = collect_members(file, source);
    let targets = collect_members(file, target.ty);
    if sources.is_empty() || targets.is_empty() {
        return record_pair(file, mapped, target);
    }
    let mut unmatched = Members::new();
    let mut refused = Members::new();
    for &member in &sources {
        let mut layouts = targets.iter().map(|candidate| candidate.layout);
        let is_named = layouts.any(|layout| layout == member.layout);
        if is_named {
            file.note_layout_of_objects(member.layout);
            continue;
        }
        if file.flows_into_container(member.ty, target.ty) {
            continue;
        }
        let mut is_matched = false;
        for &candidate in &targets {
            if file.queries.is_assignable(member.ty, candidate.ty) == Ok(true) {
                file.add_conversion(member.layout, candidate.layout);
                is_matched = true;
            }
        }
        if is_matched {
            continue;
        }
        let is_accepted = match accepted {
            Ok(is_accepted) => is_accepted,
            Err(_) => file.queries.is_assignable(member.ty, target.ty) != Ok(false),
        };
        match is_accepted {
            true => unmatched.push(member),
            false => refused.push(member),
        }
    }
    if !unmatched.is_empty() {
        let rest = union_of_layouts(file, &unmatched);
        record_pair(file, rest, target);
    }
    if refused.len() < sources.len() {
        return;
    }
    for &member in &refused {
        for &candidate in &targets {
            if file.queries.can_be_asserted(member.ty, candidate.ty) != Ok(false) {
                file.add_conversion(member.layout, candidate.layout);
            }
        }
    }
}
