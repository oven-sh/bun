use bun_sema::util::SharedSort;

use super::keys::{MergedKeys, merge_keys};
use super::state::{MergedPropertyKeys, UnitIds, UnitMarks};
use super::unit::{KeyList, LinkUnit};
use crate::ir::{
    Id, IdMap, InParallel, PropertyKey, PropertyKeyId, PropertyKeyTable, for_each_mut,
};

fn remap_marked_keys(
    keys: &PropertyKeyTable,
    marks: &[bool],
    map: &IdMap<'_>,
) -> KeyList<PropertyKey> {
    debug_assert_eq!(keys.len(), marks.len());
    let marked_keys = keys.as_slice().iter().zip(marks);
    let marked_keys = marked_keys.filter_map(|(&key, &is_marked)| is_marked.then_some(key));
    let remapped_keys = marked_keys.map(|mut key| {
        key.remap_ids(map);
        key
    });
    KeyList::new(remapped_keys.collect())
}

fn create_key_lists(
    units: &[LinkUnit],
    marks: &[UnitMarks],
    ids: &[UnitIds],
    in_parallel: InParallel<'_>,
) -> Vec<KeyList<PropertyKey>> {
    let mut slots: Vec<(usize, Option<KeyList<PropertyKey>>)> =
        (0..units.len()).map(|unit| (unit, None)).collect();
    for_each_mut(&mut slots, in_parallel, &|(unit, list)| {
        let (keys, marks) = (&units[*unit].property_keys, &marks[*unit].property_keys);
        *list = Some(remap_marked_keys(keys, marks, &ids[*unit].as_map()));
    });
    let lists = slots.into_iter();
    lists
        .map(|(_, list)| list.expect("every task ran"))
        .collect()
}

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
    let lists = create_key_lists(units, marks, ids, in_parallel);
    let list_references: Vec<&KeyList<PropertyKey>> = lists.iter().collect();
    let merged = merge_keys(&list_references, in_parallel);
    let (table, program_ids) = number_merged_keys(&merged);

    let mut slots: Vec<(usize, Vec<Option<PropertyKeyId>>)> =
        (0..units.len()).map(|unit| (unit, Vec::new())).collect();
    for_each_mut(&mut slots, in_parallel, &|(unit, local_to_program)| {
        let mut merged_indexes = merged.local_to_merged[*unit].iter();
        let program_id = |&is_marked: &bool| {
            if !is_marked {
                return None;
            }
            let &index = merged_indexes.next().expect("every marked key was merged");
            Some(program_ids[index as usize])
        };
        *local_to_program = marks[*unit].property_keys.iter().map(program_id).collect();
    });

    MergedPropertyKeys {
        table,
        local_to_program: slots
            .into_iter()
            .map(|(_, local_to_program)| local_to_program)
            .collect(),
    }
}
