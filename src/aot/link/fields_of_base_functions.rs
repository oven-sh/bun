use super::program_keys::ProgramLayoutKey;
use crate::ir::generated::{Field, FieldFlags, Layout, LayoutFlags};
use crate::ir::{Id, LayoutId};

fn find_function_of_other_project(
    layouts: &[Layout],
    keys: &[ProgramLayoutKey],
    layout: usize,
) -> Option<LayoutId> {
    let base = layouts[layout].base?;
    let is_function = layouts[base.index()]
        .flags
        .contains(LayoutFlags::IS_CONSTRUCTOR_FUNCTION);
    (is_function && keys[base.index()].project != keys[layout].project).then_some(base)
}

// The code of a class names its private fields by their numbers.
fn is_named_by_number(field: &Field) -> bool {
    let unnamed = FieldFlags::IS_PRIVATE | FieldFlags::IS_BRAND | FieldFlags::IS_HIDDEN;
    field.key.is_none() || field.flags.intersects(unnamed)
}

// The function may leave early, and another function may stand in its place when the program runs.
fn copy_field(field: &Field) -> Field {
    Field {
        flags: field.flags.without(FieldFlags::IS_REQUIRED),
        ..*field
    }
}

fn take_fields(layouts: &mut [Layout], layout: usize, base: LayoutId) -> u32 {
    let own_fields = &layouts[layout].fields;
    if own_fields.iter().any(is_named_by_number) {
        return 0;
    }
    let is_missing = |field: &&Field| {
        !is_named_by_number(field) && own_fields.iter().all(|own| own.key != field.key)
    };
    let base_fields = layouts[base.index()].fields.iter();
    let mut fields: Vec<Field> = base_fields.filter(is_missing).map(copy_field).collect();
    let taken = fields.len() as u32;
    if taken > 0 {
        fields.append(&mut layouts[layout].fields);
        layouts[layout].fields = fields;
    }
    taken
}

/// A constructor function stores its fields before what is below it stores its own, so they come first.
pub(super) fn take_fields_of_base_functions(layouts: &mut [Layout], keys: &[ProgramLayoutKey]) {
    let mut taken = vec![0; layouts.len()];
    for layout in 0..layouts.len() {
        if let Some(base) = find_function_of_other_project(layouts, keys, layout) {
            taken[layout] = take_fields(layouts, layout, base);
        }
    }
    let fields = layouts.iter_mut().flat_map(|layout| &mut layout.fields);
    for field in fields {
        if let (Some(origin), Some(number)) = (field.origin_layout, &mut field.origin_field) {
            *number += taken[origin.index()];
        }
    }
}
