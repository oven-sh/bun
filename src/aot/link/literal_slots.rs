use super::unused_records::{UseInput, is_plain_record, set_mark, unmarked};
use crate::ir::generated::{Layout, PositionFlags, Primitives, Type, TypeFlags};
use crate::ir::{Id, TypeTable};
use crate::load::ProjectId;
use std::sync::atomic::AtomicBool;

fn find_literal_layouts(input: &UseInput<'_>) -> Vec<AtomicBool> {
    let count = input.numbering.counts.layouts;
    let (in_checked_files, in_other_files) = (unmarked(count), unmarked(count));
    input.for_each_unit(&|unit, ids| {
        let allocated = match unit.is_checked && unit.file.project == ProjectId::Application {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{Program, PropertyKeyId, StringId};
    use crate::link::testing::link_sources_without_bun_modules;

    const MAIN: &str = r#"
interface Item { id: string; count: number; done: boolean; tags: string[]; owner: Item | null; run: () => void }
class Point { x: string = "x"; y: string = "y" }
export function makeItem(): Item { return { id: "a", count: 1, done: false, tags: [], owner: null, run() {} }; }
export const values = [makeItem(), new Point()];
"#;

    fn is_expected(program: &Program, layout: &str, name: &str) -> bool {
        let is_text = |id: Option<StringId>, text: &str| {
            id.is_some_and(|id| program.strings.get(id) == text.as_bytes())
        };
        let has_name = |key: PropertyKeyId| is_text(program.property_keys.get(key).text, name);
        let mut layouts = program.layouts.iter();
        let found = layouts.find(|candidate| is_text(candidate.name, layout));
        let fields = &found.expect(layout).fields;
        let field = fields
            .iter()
            .find(|field| field.key.is_some_and(has_name))
            .expect(name);
        field.declared.flags.contains(PositionFlags::IS_EXPECTED)
    }

    #[test]
    fn only_literal_slots_of_strings_and_functions_hold_any_value() {
        let linked = link_sources_without_bun_modules(&[("main.ts", MAIN)]);
        let program = linked.expect("the program links").program;
        let cases = [
            ("Item", "id", true),
            ("Item", "run", true),
            ("Item", "count", false),
            ("Item", "done", false),
            ("Item", "tags", false),
            ("Item", "owner", false),
            ("Point", "x", false),
        ];
        for (layout, name, expected) in cases {
            let is_expected = is_expected(&program, layout, name);
            assert_eq!(is_expected, expected, "{layout}.{name}");
        }
    }
}
