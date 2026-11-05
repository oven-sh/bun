use super::unused_records::{UseInput, is_plain_record, set_mark, unmarked};
use crate::builtins::id::BuiltinClass;
use crate::ir::generated::{
    Data, DataNode, FieldForm, Layout, MAX_TRACKED_INTEGER, PositionFlags, Primitives, Type,
    TypeFlags,
};
use crate::ir::parallel::map_each;
use crate::ir::{Id, InParallel, LayoutId, TypeTable};
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

fn is_integer_within((minimum, maximum): (i64, i64), number: f64) -> bool {
    const BOUND: f64 = (MAX_TRACKED_INTEGER + 1) as f64;
    let integer = number as i64;
    let is_integer = number.abs() < BOUND && integer as f64 == number;
    let is_negative_zero = number == 0.0 && number.is_sign_negative();
    is_integer && !is_negative_zero && (minimum..=maximum).contains(&integer)
}

fn may_hold(layouts: &[Layout], ty: &Type, value: &DataNode) -> bool {
    let is_unlisted = |id: &LayoutId| layouts.get(id.index()).is_none();
    if ty.layouts.iter().any(is_unlisted) {
        return true;
    }
    let has = |primitive| ty.primitives.contains(primitive);
    let may_hold_any_object = ty.flags.contains(TypeFlags::ANY_OBJECT) || !ty.layouts.is_empty();
    match *value {
        DataNode::Undefined => has(Primitives::UNDEFINED),
        DataNode::Null => has(Primitives::NULL),
        DataNode::Hole => has(Primitives::ABSENT),
        DataNode::Boolean { value: true } => has(Primitives::TRUE),
        DataNode::Boolean { value: false } => has(Primitives::FALSE),
        DataNode::Number { value } => {
            let integers = ty.integer_range();
            has(Primitives::NUMBER) || integers.is_some_and(|range| is_integer_within(range, value))
        }
        DataNode::String { value } => has(Primitives::STRING) || ty.strings.contains(&value),
        DataNode::BigInt { .. } => has(Primitives::BIG_INT),
        DataNode::Array { .. } => {
            let mut classes = ty.classes.iter().map(|part| part.builtin_class);
            may_hold_any_object || classes.any(|class| class == BuiltinClass::Array)
        }
        DataNode::Object { .. } => may_hold_any_object,
    }
}

fn find_fields_filled_with_other_data(
    layouts: &[Layout],
    data: &[Data],
    types: &TypeTable,
) -> Vec<(LayoutId, usize)> {
    let mut filled = Vec::new();
    let mut pending: Vec<&DataNode> = data.iter().map(|data| &data.root).collect();
    while let Some(node) = pending.pop() {
        let (layout, members) = match node {
            DataNode::Array { elements, .. } => {
                pending.extend(elements);
                continue;
            }
            DataNode::Object { layout, members } => (*layout, members),
            DataNode::Undefined
            | DataNode::Null
            | DataNode::Hole
            | DataNode::Boolean { .. }
            | DataNode::Number { .. }
            | DataNode::String { .. }
            | DataNode::BigInt { .. } => continue,
        };
        pending.extend(members.iter().map(|member| &member.value));
        let fields = &layouts[layout.index()].fields;
        for (index, field) in fields.iter().enumerate() {
            let declared = field.declared;
            if declared.is_expected()
                || declared.ty == TypeTable::ANYTHING
                || field.form.contains(FieldForm::IS_ACCESSOR)
            {
                continue;
            }
            let member = members.iter().find(|member| Some(member.key) == field.key);
            if member.is_some_and(|it| !may_hold(layouts, types.get(declared.ty), &it.value)) {
                filled.push((layout, index));
            }
        }
    }
    filled
}

const DATA_IN_A_TASK: usize = if cfg!(test) { 1 } else { 256 };

pub(super) fn expect_fields_filled_with_other_data(
    layouts: &mut [Layout],
    data: &[Data],
    types: &TypeTable,
    in_parallel: InParallel<'_>,
) {
    let read_layouts = &*layouts;
    let tasks: Vec<&[Data]> = data.chunks(DATA_IN_A_TASK).collect();
    let filled = map_each(tasks, in_parallel, &|data| {
        find_fields_filled_with_other_data(read_layouts, data, types)
    });
    for (layout, index) in filled.into_iter().flatten() {
        let declared = &mut layouts[layout.index()].fields[index].declared;
        declared.flags =
            declared.flags.without(PositionFlags::IS_INT32_PROMISE) | PositionFlags::IS_EXPECTED;
    }
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

    fn is_expected(program: &Program, name: &str) -> bool {
        let has_name = |key: PropertyKeyId| {
            let text = program.property_keys.get(key).text;
            text.is_some_and(|id| program.strings.get(id) == name.as_bytes())
        };
        let written = program.layouts.iter().filter(|it| it.module.is_some());
        let field = written
            .flat_map(|layout| &layout.fields)
            .find(|field| field.key.is_some_and(has_name))
            .expect(name);
        field.declared.flags.contains(PositionFlags::IS_EXPECTED)
    }

    #[test]
    fn field_filled_with_data_outside_its_type_is_expected() {
        const SOURCE: &str = r#"
interface Point { x: number; y: number }
interface Size { width: number; height: number }
export const point: Point = { x: undefined!, y: 1 };
export const size: Size = { width: 2, height: 3 };
"#;
        let linked = link_sources_without_bun_modules(&[("main.ts", SOURCE)]);
        let program = linked.expect("the program links").program;
        let cases = [
            ("Point", "x", true),
            ("Point", "y", false),
            ("Size", "width", false),
            ("Size", "height", false),
        ];
        for (layout, name, expected) in cases {
            let is_expected = is_expected(&program, name);
            assert_eq!(is_expected, expected, "{layout}.{name}");
        }
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
            let is_expected = is_expected(&program, name);
            assert_eq!(is_expected, expected, "{layout}.{name}");
        }
    }
}
