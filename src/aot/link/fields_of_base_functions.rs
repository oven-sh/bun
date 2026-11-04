use super::program_keys::ProgramLayoutKey;
use crate::ir::generated::{Field, FieldFlags, Layout, LayoutFlags};
use crate::ir::{Id, InParallel, LayoutId, for_each_mut};

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

// This cuts the work into tasks. No answer depends on it.
const LAYOUTS_IN_A_TASK: usize = if cfg!(test) { 2 } else { 1024 };

/// A constructor function stores its fields before what is below it stores its own, so they come first.
pub(super) fn take_fields_of_base_functions(
    layouts: &mut [Layout],
    keys: &[ProgramLayoutKey],
    in_parallel: InParallel<'_>,
) {
    let mut taken = vec![0; layouts.len()];
    for layout in 0..layouts.len() {
        if let Some(base) = find_function_of_other_project(layouts, keys, layout) {
            taken[layout] = take_fields(layouts, layout, base);
        }
    }
    if taken.iter().all(|&taken| taken == 0) {
        return;
    }
    // Every field of the program is looked at, each list of fields somewhere else in memory.
    let mut tasks: Vec<&mut [Layout]> = layouts.chunks_mut(LAYOUTS_IN_A_TASK).collect();
    for_each_mut(&mut tasks, in_parallel, &|layouts| {
        for field in layouts.iter_mut().flat_map(|layout| &mut layout.fields) {
            if let (Some(origin), Some(number)) = (field.origin_layout, &mut field.origin_field) {
                *number += taken[origin.index()];
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::PropertyKeyId;
    use crate::link::testing::{forward, key_in, reverse, test_class_key};
    use crate::load::ProjectId;

    fn field(key: usize) -> Field {
        Field {
            key: Some(PropertyKeyId::new(key)),
            flags: FieldFlags::IS_REQUIRED,
            ..Field::default()
        }
    }

    // Field `number` of layout `origin`, as a class below declares it again.
    fn field_from(key: usize, origin: usize, number: u32) -> Field {
        Field {
            origin_layout: Some(LayoutId::new(origin)),
            origin_field: Some(number),
            ..field(key)
        }
    }

    #[test]
    fn number_of_a_field_counts_what_its_layout_takes_from_a_function_of_the_library() {
        let function = || Layout {
            flags: LayoutFlags::IS_CONSTRUCTOR_FUNCTION,
            fields: vec![field(7), field(8)],
            ..Layout::default()
        };
        let below_function = || Layout {
            base: Some(LayoutId::new(0)),
            fields: vec![field(8), field(9)],
            ..Layout::default()
        };
        let names_fields_above = |base: usize| Layout {
            base: Some(LayoutId::new(base)),
            fields: vec![field_from(9, 1, 1), field_from(7, 0, 0)],
            ..Layout::default()
        };
        let projects = [
            ProjectId::Runtime,
            ProjectId::Application,
            ProjectId::Application,
            ProjectId::Application,
            ProjectId::Application,
        ];
        let keys: Vec<ProgramLayoutKey> = (0u32..)
            .zip(projects)
            .map(|(class, project)| key_in(project, test_class_key(0, class)))
            .collect();
        let ways: [InParallel<'_>; 2] = [&forward, &reverse];
        for in_parallel in ways {
            let mut layouts = vec![
                function(),
                below_function(),
                names_fields_above(1),
                names_fields_above(2),
                names_fields_above(3),
            ];
            take_fields_of_base_functions(&mut layouts, &keys, in_parallel);
            let keys_of_fields: Vec<Option<PropertyKeyId>> =
                layouts[1].fields.iter().map(|field| field.key).collect();
            let expected = [7, 8, 9].map(|key| Some(PropertyKeyId::new(key)));
            assert_eq!(keys_of_fields, expected);
            assert!(!layouts[1].fields[0].flags.contains(FieldFlags::IS_REQUIRED));
            for layout in &layouts[2..] {
                let numbers = layout.fields.iter().map(|field| field.origin_field);
                assert_eq!(numbers.collect::<Vec<_>>(), [Some(2), Some(0)]);
            }
        }
    }
}
