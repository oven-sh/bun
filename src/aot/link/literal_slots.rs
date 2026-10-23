use super::unit::LinkUnit;
use super::unused_records::{UseInput, is_plain_record, set_mark, unmarked};
use crate::ir::generated::{Layout, PositionFlags, Primitives, Type, TypeFlags};
use crate::ir::{Id, TypeTable};
use crate::load::ProjectId;
use std::sync::atomic::AtomicBool;

fn is_checked_application_file(unit: &LinkUnit) -> bool {
    unit.is_checked && unit.file.project == ProjectId::Application
}

fn find_literal_layouts(input: &UseInput<'_>) -> Vec<AtomicBool> {
    let count = input.numbering.counts.layouts;
    let (in_checked_files, in_other_files) = (unmarked(count), unmarked(count));
    input.for_each_unit(&|unit, ids| {
        let allocated = match is_checked_application_file(unit) {
            true => &in_checked_files,
            false => &in_other_files,
        };
        for layout in &unit.allocated_layouts {
            if let Some(id) = ids.layouts[layout.index()] {
                set_mark(&allocated[id.index()]);
            }
        }
    });
    let pairs = in_checked_files.into_iter().zip(in_other_files);
    let is_literal_layout =
        pairs.map(|(checked, other)| checked.into_inner() && !other.into_inner());
    is_literal_layout.map(AtomicBool::new).collect()
}

fn keeps_typed_slot(ty: &Type) -> bool {
    let unboxed = Primitives::NUMBER | Primitives::BOOLEAN;
    *ty != Type::primitives(ty.primitives & Primitives::NULLISH)
        && ty
            .primitives
            .without(unboxed | Primitives::NULLISH)
            .is_empty()
        && ty.flags.without(TypeFlags::HAS_INTEGERS).is_empty()
        && ty.opaque.is_none()
        && ty.environment.is_none()
        && ty.strings.is_empty()
        && ty.builtins.is_empty()
        && ty.functions.is_empty()
}

/// Object literals are written through every type their property names satisfy, so a typed slot needs a check and a slow path at each store and a presence check at each read.
pub(super) fn widen_literal_slots(layouts: &mut [Layout], input: &UseInput<'_>, types: &TypeTable) {
    let is_literal_layout = find_literal_layouts(input);
    input.for_each_layout(layouts, &is_literal_layout, &|layout, is_literal_layout| {
        if !is_literal_layout || !is_plain_record(layout) {
            return;
        }
        for field in &mut layout.fields {
            let declared = &mut field.declared;
            if declared.ty == TypeTable::ANYTHING || keeps_typed_slot(types.get(declared.ty)) {
                continue;
            }
            declared.flags = declared.flags.without(PositionFlags::IS_INT32_PROMISE)
                | PositionFlags::IS_EXPECTED;
        }
    });
}
