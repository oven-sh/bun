use bun_sema::util::SharedSort;

use super::keys::{MergedKeys, merge_keys};
use super::state::{MergedPropertyKeys, UnitIds, UnitMarks};
use super::unit::{KeyList, LinkUnit};
use crate::ir::parallel::map_each;
use crate::ir::{Id, InParallel, PropertyKey, PropertyKeyId, PropertyKeyTable};

fn number_merged_keys(merged: &MergedKeys<PropertyKey>) -> (PropertyKeyTable, Vec<PropertyKeyId>) {
    let mut table = PropertyKeyTable::default();
    let mut program_ids: Vec<Option<PropertyKeyId>> = vec![None; merged.keys.len()];
    let mut first_occurrences = Vec::new();
    for unit_keys in &merged.local_to_merged {
        first_occurrences.clear();
        let unit_keys = unit_keys.iter().copied();
        first_occurrences.extend(unit_keys.filter(|&index| program_ids[index as usize].is_none()));
        first_occurrences.shared_sort_unstable_by_key(|&index| {
            let key = &merged.keys[index as usize];
            (
                key.kind,
                key.text,
                key.owner,
                key.symbol,
                key.module,
                key.position,
            )
        });
        first_occurrences.dedup();
        for &index in &first_occurrences {
            let id = table.intern(merged.keys[index as usize]);
            debug_assert_eq!(id.index() + 1, table.len(), "merged keys are distinct");
            program_ids[index as usize] = Some(id);
        }
    }
    let program_ids = program_ids.into_iter();
    let program_ids = program_ids.map(|id| id.expect("every merged key is in a list"));
    (table, program_ids.collect())
}

pub(super) fn merge_property_keys(
    units: &[LinkUnit],
    marks: &[UnitMarks],
    ids: &[UnitIds],
    in_parallel: InParallel<'_>,
) -> MergedPropertyKeys {
    debug_assert_eq!(units.len(), marks.len());
    debug_assert_eq!(units.len(), ids.len());
    let positions: Vec<usize> = (0..units.len()).collect();
    let lists = map_each(positions.clone(), in_parallel, &|unit| {
        let (keys, marks) = (&units[unit].property_keys, &marks[unit].property_keys);
        debug_assert_eq!(keys.len(), marks.len());
        let map = ids[unit].as_map();
        let marked_keys = keys.as_slice().iter().zip(marks);
        let marked_keys = marked_keys.filter_map(|(&key, &is_marked)| is_marked.then_some(key));
        let remapped_keys = marked_keys.map(|mut key| {
            key.remap_ids(&map);
            key
        });
        KeyList::new(remapped_keys.collect())
    });
    let list_references: Vec<&KeyList<PropertyKey>> = lists.iter().collect();
    let merged = merge_keys(&list_references, in_parallel);
    let (table, program_ids) = number_merged_keys(&merged);

    let local_to_program = map_each(positions, in_parallel, &|unit| {
        let mut merged_indexes = merged.local_to_merged[unit].iter();
        let program_id = |&is_marked: &bool| {
            if !is_marked {
                return None;
            }
            let &index = merged_indexes.next().expect("every marked key was merged");
            Some(program_ids[index as usize])
        };
        marks[unit].property_keys.iter().map(program_id).collect()
    });

    MergedPropertyKeys {
        table,
        local_to_program,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::LayoutKey;
    use crate::link::testing::{
        forward, mark_everything, number_everything, reverse, test_class_key, unit_of,
    };
    use crate::lower::{FragmentBuilder, ModuleFragment};
    use crate::modules::ModuleRef;
    use bun_sema::program::FileId;

    fn create_unit(file: u32, add_keys: impl FnOnce(&mut FragmentBuilder)) -> LinkUnit {
        let mut fragment = FragmentBuilder::new(FileId(file));
        add_keys(&mut fragment);
        unit_of(fragment.finish(ModuleFragment::default()))
    }

    fn add_text_key(fragment: &mut FragmentBuilder, text: &[u8]) {
        let text = fragment.strings.intern(text);
        fragment.property_keys.intern(PropertyKey::from_text(text));
    }

    fn add_numbered_text_keys(fragment: &mut FragmentBuilder, numbers: impl Iterator<Item = u32>) {
        for number in numbers {
            add_text_key(fragment, format!("key {number}").as_bytes());
        }
    }

    fn add_private_name(fragment: &mut FragmentBuilder, text: &[u8], class: LayoutKey) {
        let text = fragment.strings.intern(text);
        let owner = fragment.declare_layout(class);
        let key = PropertyKey::from_private_name(text, owner);
        fragment.property_keys.intern(key);
    }

    fn add_created_symbol(fragment: &mut FragmentBuilder, file: u32, position: u32) {
        let module = fragment.declare_module(ModuleRef::File(FileId(file)));
        let key = PropertyKey::from_created_symbol(module, position, None);
        fragment.property_keys.intern(key);
    }

    fn mark_all(units: &[LinkUnit]) -> Vec<UnitMarks> {
        units.iter().map(mark_everything).collect()
    }

    fn merge(
        units: &[LinkUnit],
        marks: &[UnitMarks],
        in_parallel: InParallel<'_>,
    ) -> MergedPropertyKeys {
        merge_property_keys(units, marks, &number_everything(units), in_parallel)
    }

    fn id(index: usize) -> Option<PropertyKeyId> {
        Some(PropertyKeyId::new(index))
    }

    #[test]
    fn equal_text_keys_merge() {
        let units = [
            create_unit(0, |fragment| {
                add_text_key(fragment, b"first");
                add_text_key(fragment, b"shared");
            }),
            create_unit(1, |fragment| {
                add_text_key(fragment, b"shared");
                add_text_key(fragment, b"second");
            }),
        ];
        let merged = merge(&units, &mark_all(&units), &forward);
        assert_eq!(merged.local_to_program, [[id(0), id(1)], [id(1), id(2)]]);
        assert_eq!(merged.table.len(), 3);
    }

    #[test]
    fn private_names_of_two_classes_stay_apart() {
        let units = [
            create_unit(0, |fragment| {
                add_private_name(fragment, b"x", test_class_key(0, 0));
                add_private_name(fragment, b"x", test_class_key(0, 1));
            }),
            create_unit(1, |fragment| {
                add_private_name(fragment, b"x", test_class_key(0, 1));
            }),
        ];
        let merged = merge(&units, &mark_all(&units), &forward);
        assert_eq!(merged.local_to_program, [vec![id(0), id(1)], vec![id(1)]]);
        let [first, second] = [0, 1].map(|index| *merged.table.get(PropertyKeyId::new(index)));
        assert_eq!(first.text, second.text);
        assert_ne!(first.owner, second.owner);
    }

    #[test]
    fn created_symbols_differ_by_module_and_position() {
        let units = [
            create_unit(0, |fragment| {
                add_created_symbol(fragment, 0, 10);
                add_created_symbol(fragment, 0, 20);
                add_created_symbol(fragment, 1, 10);
            }),
            create_unit(1, |fragment| add_created_symbol(fragment, 1, 10)),
        ];
        let merged = merge(&units, &mark_all(&units), &forward);
        assert_eq!(
            merged.local_to_program,
            [vec![id(0), id(1), id(2)], vec![id(2)]]
        );
    }

    #[test]
    fn unmarked_key_has_no_id() {
        let units = [
            create_unit(0, |fragment| {
                add_text_key(fragment, b"first");
                add_text_key(fragment, b"shared");
                add_text_key(fragment, b"last");
            }),
            create_unit(1, |fragment| {
                add_text_key(fragment, b"dropped");
                add_text_key(fragment, b"shared");
            }),
        ];
        let mut marks = mark_all(&units);
        marks[0].property_keys[1] = false;
        marks[1].property_keys[0] = false;
        let merged = merge(&units, &marks, &forward);
        assert_eq!(
            merged.local_to_program,
            [vec![id(0), None, id(1)], vec![None, id(2)]]
        );
        assert_eq!(merged.table.len(), 3);
    }

    #[test]
    fn task_order_does_not_change_ids() {
        let units = [
            create_unit(0, |fragment| add_numbered_text_keys(fragment, 500..1500)),
            create_unit(1, |fragment| add_numbered_text_keys(fragment, 0..1000)),
        ];
        let marks = mark_all(&units);
        let in_order = merge(&units, &marks, &forward);
        let in_reverse = merge(&units, &marks, &reverse);
        assert_eq!(in_order.table.len(), 1500);
        let mut ids_of_first_unit = in_order.local_to_program[0].clone();
        ids_of_first_unit.sort_unstable();
        assert!(ids_of_first_unit.into_iter().eq((0..1000).map(id)));
        assert_eq!(in_order.table.as_slice(), in_reverse.table.as_slice());
        assert_eq!(in_order.local_to_program, in_reverse.local_to_program);
    }
}
