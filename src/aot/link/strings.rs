use super::state::{MergedStrings, UnitMarks};
use super::unit::{FindsByUnit, LinkUnit, SHARD_COUNT, shard_of};
use crate::ir::{Id, InParallel, StringId, StringTable, for_each_mut};
use hashbrown::HashTable;

struct StringShard {
    shard: usize,
    table: HashTable<u32>,
    entries: Vec<(u32, StringId)>,
    hashes: Vec<u64>,
    program_ids: Vec<StringId>,
}

impl StringShard {
    fn new(shard: usize) -> StringShard {
        StringShard {
            shard,
            table: HashTable::new(),
            entries: Vec::new(),
            hashes: Vec::new(),
            program_ids: Vec::new(),
        }
    }

    fn find(&self, units: &[LinkUnit], strings: &StringTable, id: StringId) -> Option<u32> {
        let bytes = strings.get(id);
        let is_equal = |&entry: &u32| {
            let (unit, entry_id) = self.entries[entry as usize];
            units[unit as usize].strings.get(entry_id) == bytes
        };
        self.table.find(strings.hash(id), is_equal).copied()
    }

    fn collect_strings(&mut self, units: &[LinkUnit], marks: &[UnitMarks]) {
        for (position, (unit, unit_marks)) in units.iter().zip(marks).enumerate() {
            for &local in unit.string_shards.shard(self.shard) {
                if !unit_marks.strings[local as usize] {
                    continue;
                }
                let id = StringId::new(local as usize);
                if self.find(units, &unit.strings, id).is_some() {
                    continue;
                }
                let (entry, hash) = (self.entries.len() as u32, unit.strings.hash(id));
                self.entries.push((position as u32, id));
                self.hashes.push(hash);
                let hashes = &self.hashes;
                self.table
                    .insert_unique(hash, entry, |&other| hashes[other as usize]);
            }
        }
    }
}

fn build_string_table(
    shards: &mut [StringShard],
    units: &[LinkUnit],
    in_parallel: InParallel<'_>,
) -> StringTable {
    let entries: Vec<&[(u32, StringId)]> = shards.iter().map(|shard| &shard.entries[..]).collect();
    let first_occurrences = FindsByUnit::new(units.len(), &entries);
    let order = first_occurrences.order_rows_by(in_parallel, &|unit, id| {
        units[unit as usize].strings.get(id)
    });

    let string_at = |place: usize| {
        let (unit, id) = first_occurrences.finds[order[place] as usize];
        (&units[unit as usize].strings, id)
    };
    let table = StringTable::of_distinct_strings(order.len(), &string_at, in_parallel);
    let program_ids = first_occurrences.number_in(&order);

    let mut shards: Vec<(&mut StringShard, &Vec<u32>)> =
        shards.iter_mut().zip(&first_occurrences.places).collect();
    for_each_mut(&mut shards, in_parallel, &|(shard, places)| {
        let program_id = |&place: &u32| program_ids[place as usize];
        shard.program_ids = places.iter().map(program_id).collect();
    });
    table
}

pub(super) fn merge_strings(
    units: &[LinkUnit],
    marks: &[UnitMarks],
    in_parallel: InParallel<'_>,
) -> MergedStrings {
    debug_assert_eq!(units.len(), marks.len());
    let mut shards: Vec<StringShard> = (0..SHARD_COUNT).map(StringShard::new).collect();
    for_each_mut(&mut shards, in_parallel, &|shard| {
        shard.collect_strings(units, marks)
    });
    let table = build_string_table(&mut shards, units, in_parallel);

    let mut slots: Vec<(usize, Vec<Option<StringId>>)> =
        (0..units.len()).map(|unit| (unit, Vec::new())).collect();
    for_each_mut(&mut slots, in_parallel, &|(position, program_ids)| {
        let strings = &units[*position].strings;
        let is_retained = &marks[*position].strings;
        let program_id = |id: StringId| {
            if !is_retained[id.index()] {
                return None;
            }
            let shard = &shards[shard_of(strings.hash(id))];
            let entry = shard
                .find(units, strings, id)
                .expect("every retained string was merged");
            Some(shard.program_ids[entry as usize])
        };
        *program_ids = strings.ids().map(program_id).collect();
    });

    MergedStrings {
        table,
        local_to_program: slots
            .into_iter()
            .map(|(_, program_ids)| program_ids)
            .collect(),
    }
}
