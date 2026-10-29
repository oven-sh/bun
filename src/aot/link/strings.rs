use super::keys::{collect_shards, number_by_unit};
use super::state::{MergedStrings, UnitMarks};
use super::unit::{LinkUnit, shard_of};
use crate::ir::parallel::map_each;
use crate::ir::{Id, InParallel, StringId, StringTable};

fn is_text(units: &[LinkUnit], bytes: &[u8]) -> impl Fn(&(u32, StringId), u64) -> bool {
    move |&(unit, id), _| units[unit as usize].strings.get(id) == bytes
}

pub(super) fn merge_strings(
    units: &[LinkUnit],
    marks: &[UnitMarks],
    in_parallel: InParallel<'_>,
) -> MergedStrings {
    debug_assert_eq!(units.len(), marks.len());
    let shards = collect_shards(in_parallel, &|number, shard| {
        for (position, (unit, unit_marks)) in units.iter().zip(marks).enumerate() {
            for &local in unit.string_shards.shard(number) {
                if !unit_marks.strings[local as usize] {
                    continue;
                }
                let id = StringId::new(local as usize);
                let is_equal = is_text(units, unit.strings.get(id));
                shard.add(unit.strings.hash(id), (position as u32, id), is_equal);
            }
        }
    });
    let (program_ids, first_occurrences) =
        number_by_unit(&shards, units.len(), in_parallel, &|unit, id| {
            units[unit as usize].strings.get(id)
        });
    let string_at = |place: usize| {
        let (unit, id) = first_occurrences[place];
        (&units[unit as usize].strings, id)
    };
    let table = StringTable::of_distinct_strings(first_occurrences.len(), &string_at, in_parallel);

    let units_with_marks: Vec<(&LinkUnit, &UnitMarks)> = units.iter().zip(marks).collect();
    let local_to_program = map_each(units_with_marks, in_parallel, &|(unit, marks)| {
        let strings = &unit.strings;
        let program_id = |id: StringId| {
            if !marks.strings[id.index()] {
                return None;
            }
            let shard = shard_of(strings.hash(id));
            let entry = shards[shard]
                .find(strings.hash(id), is_text(units, strings.get(id)))
                .expect("every retained string was merged");
            Some(program_ids[shard][entry as usize])
        };
        strings.ids().map(program_id).collect()
    });

    MergedStrings {
        table,
        local_to_program,
    }
}
