use super::tables::LinkTables;
use crate::ir::parallel::map_each;
use crate::ir::{Id, InParallel, StringId, StringTable, for_each_mut};
use crate::statistics::{Stage, StepClock};
use bun_sema::util::SharedSort;
use bun_sort_by_number::SortByNumber;
use core::cmp::Ordering;
use core::ops::Range;

#[derive(Copy, Clone, Default)]
struct StringEntry {
    hash: u64,
    tables: u32,
    id: StringId,
}

const _: () = assert!(size_of::<StringEntry>() == 16);

const PART_BITS: u32 = 8;
const PART_COUNT: usize = 1 << PART_BITS;
const STRINGS_IN_A_TASK: usize = if cfg!(test) { 64 } else { 1 << 14 };

fn part_of(hash: u64) -> usize {
    (hash >> (u64::BITS - PART_BITS)) as usize
}

struct Slice {
    tables: u32,
    ids: Range<u32>,
}

fn cut_into_slices(tables: &[LinkTables]) -> Vec<Slice> {
    let mut slices = Vec::new();
    for (number, set) in (0u32..).zip(tables) {
        let length = set.lengths.strings;
        for start in (0..length).step_by(STRINGS_IN_A_TASK) {
            let end = length.min(start.saturating_add(STRINGS_IN_A_TASK as u32));
            slices.push(Slice {
                tables: number,
                ids: start..end,
            });
        }
    }
    slices
}

#[derive(Copy, Clone)]
struct StringSources<'a> {
    tables: &'a [LinkTables],
    hash_of: fn(&StringTable, StringId) -> u64,
}

impl<'a> StringSources<'a> {
    fn bytes(self, entry: StringEntry) -> &'a [u8] {
        self.tables[entry.tables as usize].strings.get(entry.id)
    }

    fn compare(self, a: StringEntry, b: StringEntry) -> Ordering {
        let by_hash = a.hash.cmp(&b.hash);
        by_hash.then_with(|| self.bytes(a).cmp(self.bytes(b)))
    }

    fn entries_of(self, slice: &Slice) -> impl Iterator<Item = StringEntry> + use<'a> {
        let tables = slice.tables;
        let strings = &self.tables[tables as usize].strings;
        let ids = slice.ids.clone().map(StringId::from_word);
        ids.map(move |id| StringEntry {
            hash: (self.hash_of)(strings, id),
            tables,
            id,
        })
    }
}

struct EntriesByPart {
    entries: Vec<StringEntry>,
    starts: [u32; PART_COUNT + 1],
}

impl EntriesByPart {
    fn new(sources: StringSources<'_>, slice: &Slice) -> EntriesByPart {
        let mut starts = [0u32; PART_COUNT + 1];
        for entry in sources.entries_of(slice) {
            starts[part_of(entry.hash) + 1] += 1;
        }
        let mut count = 0;
        for start in &mut starts {
            count += *start;
            *start = count;
        }
        let mut next_places = starts;
        let mut entries = vec![StringEntry::default(); slice.ids.len()];
        for entry in sources.entries_of(slice) {
            let place = &mut next_places[part_of(entry.hash)];
            entries[*place as usize] = entry;
            *place += 1;
        }
        EntriesByPart { entries, starts }
    }

    fn in_part(&self, part: usize) -> &[StringEntry] {
        &self.entries[self.starts[part] as usize..self.starts[part + 1] as usize]
    }
}

fn list_strings_of_part(
    sources: StringSources<'_>,
    slices: &[EntriesByPart],
    part: usize,
) -> Vec<StringEntry> {
    let pieces = || slices.iter().map(|slice| slice.in_part(part));
    let mut entries = Vec::with_capacity(pieces().map(<[StringEntry]>::len).sum());
    for piece in pieces() {
        entries.extend_from_slice(piece);
    }
    entries.sort_by_u64(|entry| entry.hash);

    let mut strings = Vec::new();
    for tied in entries.chunk_by_mut(|a, b| a.hash == b.hash) {
        let bytes = sources.bytes(tied[0]);
        if tied[1..].iter().all(|&entry| sources.bytes(entry) == bytes) {
            strings.push(tied[0]);
            continue;
        }
        tied.shared_sort_unstable_by(|&a, &b| sources.bytes(a).cmp(sources.bytes(b)));
        let runs = tied.chunk_by(|&a, &b| sources.bytes(a) == sources.bytes(b));
        strings.extend(runs.map(|run| run[0]));
    }
    strings
}

pub(super) struct ProgramStrings<'a> {
    sources: StringSources<'a>,
    slices: Vec<Slice>,
    entries: Vec<StringEntry>,
    part_starts: [usize; PART_COUNT + 1],
}

impl<'a> ProgramStrings<'a> {
    fn new(sources: StringSources<'a>, in_parallel: InParallel<'_>) -> ProgramStrings<'a> {
        let mut steps = StepClock::new(Stage::LinkAndEmit);
        let slices = cut_into_slices(sources.tables);
        let by_part = map_each(slices.iter().collect(), in_parallel, &|slice: &Slice| {
            EntriesByPart::new(sources, slice)
        });
        steps.end("merge strings: entries by part");
        let parts = map_each((0..PART_COUNT).collect(), in_parallel, &|part: usize| {
            list_strings_of_part(sources, &by_part, part)
        });
        steps.end("merge strings: strings of the parts");
        let mut part_starts = [0usize; PART_COUNT + 1];
        for (part, strings) in parts.iter().enumerate() {
            part_starts[part + 1] = part_starts[part] + strings.len();
        }
        let entries = parts.concat();
        debug_assert!(entries.is_sorted_by(|&a, &b| sources.compare(a, b) == Ordering::Less));
        ProgramStrings {
            sources,
            slices,
            entries,
            part_starts,
        }
    }

    fn find(&self, entry: StringEntry) -> StringId {
        let part = part_of(entry.hash);
        let start = self.part_starts[part];
        let in_part = &self.entries[start..self.part_starts[part + 1]];
        let first = in_part.partition_point(|other| other.hash < entry.hash);
        let has_hash_of_entry = |place: usize| {
            let other = in_part.get(place);
            other.is_some_and(|other| other.hash == entry.hash)
        };
        let place = match has_hash_of_entry(first + 1) {
            true => {
                let found = in_part.binary_search_by(|&other| self.sources.compare(other, entry));
                found.ok()
            }
            false => has_hash_of_entry(first).then_some(first),
        };
        let place = place.expect("every string below the length of its tables is merged");
        debug_assert!(self.sources.bytes(in_part[place]) == self.sources.bytes(entry));
        StringId::new(start + place)
    }

    pub(super) fn make_table(&self, in_parallel: InParallel<'_>) -> StringTable {
        let mut steps = StepClock::new(Stage::LinkAndEmit);
        let tables = self.sources.tables;
        let string_at = |place: usize| {
            let entry = self.entries[place];
            (&tables[entry.tables as usize].strings, entry.id)
        };
        let table = StringTable::of_distinct_strings(self.entries.len(), &string_at, in_parallel);
        steps.end_with(|| format!("merge strings: table of {} strings", table.len()));
        table
    }

    pub(super) fn list_ids(&self, in_parallel: InParallel<'_>) -> Vec<Vec<Option<StringId>>> {
        let mut steps = StepClock::new(Stage::LinkAndEmit);
        let lengths = self.sources.tables.iter().map(|set| set.lengths.strings);
        let mut program_ids: Vec<Vec<Option<StringId>>> =
            lengths.map(|length| vec![None; length as usize]).collect();
        let lists = program_ids
            .iter_mut()
            .flat_map(|ids| ids.chunks_mut(STRINGS_IN_A_TASK));
        let mut tasks: Vec<(&Slice, &mut [Option<StringId>])> =
            self.slices.iter().zip(lists).collect();
        assert_eq!(tasks.len(), self.slices.len());
        for_each_mut(&mut tasks, in_parallel, &|(slice, program_ids)| {
            assert_eq!(slice.ids.len(), program_ids.len());
            let entries = self.sources.entries_of(slice);
            for (entry, program_id) in entries.zip(program_ids.iter_mut()) {
                *program_id = Some(self.find(entry));
            }
        });
        drop(tasks);
        steps.end("merge strings: ids");
        program_ids
    }
}

pub(super) fn order_strings<'a>(
    tables: &'a [LinkTables],
    in_parallel: InParallel<'_>,
) -> ProgramStrings<'a> {
    let sources = StringSources {
        tables,
        hash_of: StringTable::hash,
    };
    ProgramStrings::new(sources, in_parallel)
}

#[cfg(test)]
fn merge_strings_of(
    sources: StringSources<'_>,
    in_parallel: InParallel<'_>,
) -> (StringTable, Vec<Vec<Option<StringId>>>) {
    let strings = ProgramStrings::new(sources, in_parallel);
    (
        strings.make_table(in_parallel),
        strings.list_ids(in_parallel),
    )
}

#[cfg(test)]
fn merge_strings(
    tables: &[LinkTables],
    in_parallel: InParallel<'_>,
) -> (StringTable, Vec<Vec<Option<StringId>>>) {
    let sources = StringSources {
        tables,
        hash_of: StringTable::hash,
    };
    merge_strings_of(sources, in_parallel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{PropertyKeyTable, TypeTable};
    use crate::link::testing::{forward, reverse};
    use crate::load::ProjectId;
    use crate::lower::TableLengths;

    type MergedStrings = (StringTable, Vec<Vec<Option<StringId>>>);

    fn name(number: usize) -> Vec<u8> {
        format!("name {number}").into_bytes()
    }

    fn names(numbers: impl IntoIterator<Item = usize>) -> Vec<Vec<u8>> {
        numbers.into_iter().map(name).collect()
    }

    fn tables_of(strings: &[Vec<u8>]) -> LinkTables {
        let mut table = StringTable::default();
        for bytes in strings {
            table.intern(bytes);
        }
        LinkTables {
            project: ProjectId::Application,
            lengths: TableLengths {
                strings: table.len() as u32,
                ..TableLengths::default()
            },
            strings: table,
            property_keys: PropertyKeyTable::default(),
            types: TypeTable::new(),
            functions: Vec::new(),
            layouts: Vec::new(),
            variables: Vec::new(),
            modules: Vec::new(),
            module_failures: Vec::new(),
        }
    }

    fn overlapping_tables() -> [LinkTables; 3] {
        [
            tables_of(&names(0..1000)),
            tables_of(&names((500..1500).rev())),
            tables_of(&names((0..3000).step_by(7))),
        ]
    }

    fn with_true_hashes(tables: &[LinkTables]) -> StringSources<'_> {
        StringSources {
            tables,
            hash_of: StringTable::hash,
        }
    }

    fn texts_of(table: &StringTable) -> Vec<&[u8]> {
        table.ids().map(|id| table.get(id)).collect()
    }

    fn assert_merged(sources: StringSources<'_>, (table, program_ids): &MergedStrings) {
        let mut expected: Vec<(u64, &[u8])> = Vec::new();
        for set in sources.tables {
            let strings = &set.strings;
            let ids = strings.ids().take(set.lengths.strings as usize);
            expected.extend(ids.map(|id| ((sources.hash_of)(strings, id), strings.get(id))));
        }
        expected.sort_unstable();
        expected.dedup();
        let expected: Vec<&[u8]> = expected.into_iter().map(|(_, bytes)| bytes).collect();
        assert_eq!(texts_of(table), expected);

        assert_eq!(program_ids.len(), sources.tables.len());
        for (set, program_ids) in sources.tables.iter().zip(program_ids) {
            assert_eq!(program_ids.len(), set.lengths.strings as usize);
            for (id, &program_id) in set.strings.ids().zip(program_ids) {
                assert!(program_id.is_some());
                assert_eq!(program_id, table.find(set.strings.get(id)));
            }
        }
    }

    #[test]
    fn strings_of_all_tables_appear_once_each_in_hash_order() {
        let tables = overlapping_tables();
        let merged = merge_strings(&tables, &forward);
        assert_merged(with_true_hashes(&tables), &merged);
        let (table, _) = &merged;
        let hashes: Vec<u64> = table.ids().map(|id| table.hash(id)).collect();
        assert!(hashes.is_sorted());
        for id in table.ids() {
            assert_eq!(table.hash(id), StringTable::hash_of(table.get(id)));
        }
    }

    #[test]
    fn tables_of_any_length_are_merged() {
        let lengths = [
            0,
            1,
            STRINGS_IN_A_TASK - 1,
            STRINGS_IN_A_TASK,
            STRINGS_IN_A_TASK + 1,
            5 * STRINGS_IN_A_TASK + 3,
        ];
        for length in lengths {
            let tables = [
                tables_of(&names(0..length)),
                tables_of(&names(length / 2..2 * length)),
            ];
            let merged = merge_strings(&tables, &forward);
            assert_merged(with_true_hashes(&tables), &merged);
        }
    }

    #[test]
    fn neither_the_order_of_the_tables_nor_which_of_them_hold_a_string_changes_the_program() {
        let merged_texts = |tables: &[LinkTables]| -> Vec<Vec<u8>> {
            let (table, _) = merge_strings(tables, &forward);
            table.ids().map(|id| table.get(id).to_vec()).collect()
        };
        let expected = merged_texts(&[tables_of(&names(0..500))]);
        let ways = [
            vec![tables_of(&names(0..300)), tables_of(&names(200..500))],
            vec![
                tables_of(&names((200..500).rev())),
                tables_of(&names(0..300)),
            ],
            vec![
                tables_of(&names((0..500).step_by(2))),
                tables_of(&names(100..110)),
                tables_of(&names((1..500).step_by(2))),
            ],
        ];
        for tables in ways {
            assert_eq!(merged_texts(&tables), expected);
        }
    }

    #[test]
    fn order_of_the_tasks_changes_nothing() {
        let tables = overlapping_tables();
        let (table, program_ids) = merge_strings(&tables, &forward);
        let (table_in_reverse, program_ids_in_reverse) = merge_strings(&tables, &reverse);
        assert_eq!(texts_of(&table), texts_of(&table_in_reverse));
        assert_eq!(program_ids, program_ids_in_reverse);
    }

    #[test]
    fn strings_at_or_past_the_length_are_not_read() {
        let mut cut = tables_of(&names(0..10));
        cut.lengths.strings = 4;
        let tables = [cut, tables_of(&names(8..9))];
        let merged = merge_strings(&tables, &forward);
        assert_merged(with_true_hashes(&tables), &merged);
        let (table, program_ids) = &merged;
        assert_eq!(table.len(), 5);
        assert_eq!(program_ids[0].len(), 4);
        assert!(table.find(&name(8)).is_some());
        assert_eq!(table.find(&name(9)), None);
    }

    fn two_bits_of_hash(strings: &StringTable, id: StringId) -> u64 {
        strings.hash(id) >> 62 << 62
    }

    fn one_hash_for_all(_: &StringTable, _: StringId) -> u64 {
        5 << 56
    }

    #[test]
    fn different_strings_with_the_same_hash_are_ordered_by_bytes() {
        let [first, second, third] = overlapping_tables();
        let prefixes = [Vec::new(), b"n".to_vec(), b"na".to_vec(), name(1)];
        let tables = [first, second, tables_of(&prefixes), third];
        let weak_hashes: [fn(&StringTable, StringId) -> u64; 2] =
            [two_bits_of_hash, one_hash_for_all];
        let ways: [InParallel<'_>; 2] = [&forward, &reverse];
        for hash_of in weak_hashes {
            let sources = StringSources {
                tables: &tables,
                hash_of,
            };
            for in_parallel in ways {
                assert_merged(sources, &merge_strings_of(sources, in_parallel));
            }
        }
    }

    #[test]
    fn tables_without_strings_get_empty_lists() {
        let (table, program_ids) = merge_strings(&[], &forward);
        assert!(table.is_empty());
        assert!(program_ids.is_empty());

        let tables = [tables_of(&[]), tables_of(&names(0..3)), tables_of(&[])];
        let merged = merge_strings(&tables, &forward);
        assert_merged(with_true_hashes(&tables), &merged);
        assert_eq!(merged.0.len(), 3);
    }

    #[test]
    fn strings_interned_later_come_after_the_merged_ones() {
        let tables = [tables_of(&names(0..100))];
        let (mut table, program_ids) = merge_strings(&tables, &forward);
        assert_eq!(Some(table.intern(&name(7))), program_ids[0][7]);
        assert_eq!(table.len(), 100);
        assert_eq!(table.intern(&name(100)).index(), 100);
    }
}
