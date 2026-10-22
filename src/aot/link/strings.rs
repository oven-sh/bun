use super::state::{MergedStrings, UnitMarks};
use super::unit::{LinkUnit, SHARD_COUNT, shard_of};
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

fn merge_sorted_entries(shards: &[StringShard]) -> Vec<(u32, StringId)> {
    let count: usize = shards.iter().map(|shard| shard.entries.len()).sum();
    let mut first_occurrences = Vec::with_capacity(count);
    for shard in shards {
        debug_assert!(shard.entries.is_sorted());
        first_occurrences.extend_from_slice(&shard.entries);
    }
    first_occurrences.sort();
    first_occurrences
}

fn build_string_table(
    shards: &mut [StringShard],
    units: &[LinkUnit],
    in_parallel: InParallel<'_>,
) -> StringTable {
    let first_occurrences = merge_sorted_entries(shards);
    let unit_of = |entry: u32| first_occurrences[entry as usize].0;
    let mut order: Vec<u32> = (0..first_occurrences.len() as u32).collect();
    let mut runs: Vec<&mut [u32]> =
        order.chunk_by_mut(|&a, &b| unit_of(a) == unit_of(b)).collect();
    for_each_mut(&mut runs, in_parallel, &|run| {
        let strings = &units[unit_of(run[0]) as usize].strings;
        run.sort_unstable_by_key(|&entry| strings.get(first_occurrences[entry as usize].1));
    });

    let string_at = |place: usize| {
        let (unit, id) = first_occurrences[order[place] as usize];
        (&units[unit as usize].strings, id)
    };
    let table = StringTable::of_distinct_strings(order.len(), &string_at, in_parallel);
    let mut program_ids = vec![StringId::new(0); first_occurrences.len()];
    for (place, &entry) in order.iter().enumerate() {
        program_ids[entry as usize] = StringId::new(place);
    }

    for_each_mut(shards, in_parallel, &|shard| {
        let program_id = |entry: &(u32, StringId)| {
            let position = first_occurrences.binary_search(entry);
            program_ids[position.expect("every entry is a first occurrence")]
        };
        shard.program_ids = shard.entries.iter().map(program_id).collect();
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
