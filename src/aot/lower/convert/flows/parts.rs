use bun_sema::check::aot::{
    FunctionRef, FunctionSignatures, MemberName, ObjectMemberKind, ShapeKind, TupleElementKind,
};
use smallvec::SmallVec;

use super::{find_flow_target, record_flow_at};
use crate::ir::ContentsSlot;
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering};

pub(super) const LEVELS_BELOW_FLOW: u8 = 2;

fn record_part(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    levels: u8,
) {
    if let Some(target) = find_flow_target(file, target) {
        record_flow_at(file, source, target, levels);
    }
}

pub(super) fn find_value_type<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    ty: CheckerTypeId,
) -> Option<(CheckerTypeId, ShapeKind<'c>)> {
    let mut current = ty;
    let mut visited: SmallVec<[CheckerTypeId; 4]> = SmallVec::new();
    loop {
        current = file.queries.without_nullish(current).ok()?;
        if visited.contains(&current) {
            return None;
        }
        visited.push(current);
        match file.queries.type_shape(current).ok()?.kind {
            ShapeKind::TypeVariable { constraint, .. } => current = constraint?,
            kind => return Some((current, kind)),
        }
    }
}

fn find_function_declaration(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<FunctionRef> {
    match file.queries.type_shape(ty).ok()?.kind {
        ShapeKind::Function(signatures) => {
            file.queries.declaration_of_signatures(signatures.declared)
        }
        _ => None,
    }
}

fn is_one_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    one: CheckerTypeId,
    other: CheckerTypeId,
) -> bool {
    let declaration = find_function_declaration(file, one);
    declaration.is_some() && declaration == find_function_declaration(file, other)
}

fn record_symbol_member_flows(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    let shape = file.queries.type_shape(source);
    let Ok(ShapeKind::Class(class)) = shape.map(|shape| shape.kind) else {
        return;
    };
    let members = file.queries.class_shape(class).members;
    for member in members.iter().filter(|member| !member.is_static) {
        let MemberName::Symbol(name) = member.name else {
            continue;
        };
        let found = (
            file.queries.find_checked_member(source, name),
            file.queries.find_checked_member(target, name),
        );
        let (Ok(Some(own)), Ok(Some(read_as))) = found else {
            continue;
        };
        if read_as.kind == ObjectMemberKind::Setter {
            continue;
        }
        if let (Ok(own), Ok(read_as)) = (own.checked, read_as.checked) {
            record_part(file, own, read_as, 0);
        }
    }
}

pub(super) fn record_member_flows(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    if let Ok((members, methods_above)) = file.queries.members_typed_otherwise(source, target) {
        let mut methods_followed = 0;
        for member in members {
            if member.kind_in_base == ObjectMemberKind::Setter {
                continue;
            }
            methods_followed += usize::from(member.is_method_above);
            if !is_one_function(file, member.checked, member.in_base) {
                record_part(file, member.checked, member.in_base, 0);
            }
        }
        if let Some(methods) = methods_above.filter(|methods| methods.count == methods_followed) {
            file.queries.note_methods_followed(methods);
        }
    }
    record_symbol_member_flows(file, source, target);
}

pub(super) fn record_flows_of_parts(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    levels: u8,
) {
    let Some((source, source_kind)) = find_value_type(file, source) else {
        return;
    };
    let has_parts = matches!(
        source_kind,
        ShapeKind::Class(_)
            | ShapeKind::Object
            | ShapeKind::Array { .. }
            | ShapeKind::Tuple { .. }
            | ShapeKind::Builtin { .. }
            | ShapeKind::Function(FunctionSignatures { declared: [_], .. })
    );
    if !has_parts {
        return;
    }
    let Some((target, target_kind)) = find_value_type(file, target) else {
        return;
    };
    if source == target {
        return;
    }
    match (source_kind, target_kind) {
        (ShapeKind::Class(_) | ShapeKind::Object, ShapeKind::Object) => {
            record_member_flows(file, source, target);
        }
        (
            ShapeKind::Tuple { elements, .. },
            ShapeKind::Tuple {
                elements: places, ..
            },
        ) => {
            for (element, place) in elements.iter().zip(places) {
                if element.kind != TupleElementKind::Variadic
                    && place.kind != TupleElementKind::Variadic
                {
                    record_part(file, element.ty, place.ty, levels);
                }
            }
        }
        (
            ShapeKind::Tuple { elements, .. },
            ShapeKind::Array { .. } | ShapeKind::Builtin { .. },
        ) => {
            let Some(held) = find_contents_type(file, target, ContentsSlot::Element) else {
                return;
            };
            for element in elements {
                if element.kind != TupleElementKind::Variadic {
                    record_part(file, element.ty, held, levels);
                }
            }
        }
        (
            ShapeKind::Array { .. } | ShapeKind::Builtin { .. },
            ShapeKind::Array { .. } | ShapeKind::Builtin { .. },
        ) => {
            for slot in ContentsSlot::ALL {
                let held = (
                    find_contents_type(file, source, slot),
                    find_contents_type(file, target, slot),
                );
                if let (Some(source), Some(target)) = held {
                    record_part(file, source, target, levels);
                }
            }
        }
        (ShapeKind::Function(returning), ShapeKind::Function(expecting)) => {
            if is_one_function(file, source, target) {
                return;
            }
            let returning = file.queries.only_signature(returning);
            let expecting = file.queries.only_signature(expecting);
            let (Some(returning), Some(expecting)) = (returning, expecting) else {
                return;
            };
            let results = (
                file.queries.signature_result(returning),
                file.queries.signature_result(expecting),
            );
            if let (Ok(returned), Ok(expected)) = results {
                record_part(file, returned, expected, levels);
            }
        }
        _ => {}
    }
}
