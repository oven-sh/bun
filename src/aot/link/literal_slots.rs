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
    let is_literal_layout = pairs.map(|(checked, other)| checked.into_inner() && !other.into_inner());
    is_literal_layout.map(AtomicBool::new).collect()
}

fn keeps_typed_slot(ty: &Type) -> bool {
    let unboxed = Primitives::NUMBER | Primitives::BOOLEAN;
    *ty != Type::primitives(ty.primitives & Primitives::NULLISH)
        && ty.primitives.without(unboxed | Primitives::NULLISH).is_empty()
        && ty.flags.without(TypeFlags::HAS_INTEGERS).is_empty()
        && ty.opaque.is_none()
        && ty.environment.is_none()
        && ty.strings.is_empty()
        && ty.builtins.is_empty()
        && ty.functions.is_empty()
}

/// Object literals are written through every type their property names satisfy, so a typed slot needs a check and a slow path at
/// each store and a presence check at each read. Slots declared with strings or functions hold any value instead, and the declared
/// type becomes a prediction. Numbers, booleans, containers and objects keep typed slots: their readers use the proven type.
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
            declared.flags = declared.flags.without(PositionFlags::IS_INT32_PROMISE) | PositionFlags::IS_EXPECTED;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{Program, PropertyKeyId};
    use crate::link::testing::link_sources_without_bun_modules;

    const MAIN: &str = r#"
interface Item { id: string; count: number; done: boolean; tags: string[]; owner: Item | null; run: () => void }
class Point { x: string = "x"; y: string = "y" }
export function makeItem(): Item { return { id: "a", count: 1, done: false, tags: [], owner: null, run() {} }; }
export const values = [makeItem(), new Point()];
"#;

    fn link() -> Program {
        link_sources_without_bun_modules(&[("main.ts", MAIN)]).expect("the program links").program
    }

    fn find_layout<'a>(program: &'a Program, name: &str) -> &'a Layout {
        let has_name = |layout: &&Layout| {
            layout.name.is_some_and(|id| program.strings.get(id) == name.as_bytes())
        };
        program.layouts.iter().find(has_name).expect(name)
    }

    fn is_expected(program: &Program, layout: &str, name: &str) -> bool {
        let has_name = |key: PropertyKeyId| {
            let text = program.property_keys.get(key).text;
            text.is_some_and(|id| program.strings.get(id) == name.as_bytes())
        };
        let fields = &find_layout(program, layout).fields;
        let field = fields.iter().find(|field| field.key.is_some_and(has_name)).expect(name);
        field.declared.flags.contains(PositionFlags::IS_EXPECTED)
    }

    #[test]
    fn literal_slots_hold_any_value() {
        let program = link();
        for name in ["id", "run"] {
            assert!(is_expected(&program, "Item", name), "{name}");
        }
    }

    #[test]
    fn numbers_booleans_containers_and_objects_stay_typed() {
        let program = link();
        for name in ["count", "done", "tags", "owner"] {
            assert!(!is_expected(&program, "Item", name), "{name}");
        }
    }

    #[test]
    fn class_fields_stay_typed() {
        let program = link();
        assert!(!is_expected(&program, "Point", "x"));
    }
}
