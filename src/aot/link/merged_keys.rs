use super::program_keys::{ProgramFunctionKey, ProgramLayoutKey, ProgramVariableKey};
use super::state::ModuleTable;
use super::tables::LinkTables;
use super::unit::LinkUnit;
use crate::ir::parallel::map_each;
use crate::ir::{FunctionId, Id, InParallel, LayoutId, TypeTable, VariableId, for_each_mut};
use bun_sema::atom::Interner;
use bun_sema::util::SharedSort;
use core::cmp::Ordering;
use core::ops::Range;

pub(super) trait OrderedKey: Copy + Eq + Send + Sync {
    fn rank(&self) -> u128;
    fn compare(&self, other: &Self, atoms: &Interner<'_>) -> Ordering;
}

#[derive(Copy, Clone, PartialEq, Eq)]
struct Ranked<K> {
    rank: u128,
    key: K,
}

impl<K: OrderedKey> Ranked<K> {
    #[inline]
    fn new(key: &K) -> Ranked<K> {
        Ranked {
            rank: key.rank(),
            key: *key,
        }
    }
}

impl<K: OrderedKey> OrderedKey for Ranked<K> {
    #[inline]
    fn rank(&self) -> u128 {
        self.rank
    }

    #[inline]
    fn compare(&self, other: &Self, atoms: &Interner<'_>) -> Ordering {
        let by_rank = self.rank.cmp(&other.rank);
        debug_assert!(
            by_rank == Ordering::Equal || by_rank == self.key.compare(&other.key, atoms),
            "the rank of a key goes against its order"
        );
        match by_rank {
            Ordering::Equal if self.key != other.key => self.key.compare(&other.key, atoms),
            _ => by_rank,
        }
    }
}

pub(super) struct MergedKeys<'a, K> {
    pub keys: Vec<K>,
    pub local_to_merged: Vec<Vec<u32>>,
    atoms: &'a Interner<'a>,
}

impl<K: OrderedKey> MergedKeys<'_, K> {
    pub(super) fn find(&self, key: &K) -> Option<u32> {
        let key = Ranked::new(key);
        let found = self
            .keys
            .binary_search_by(|other| Ranked::new(other).compare(&key, self.atoms));
        found.ok().map(|index| index as u32)
    }
}

const RUN_LENGTH: usize = if cfg!(test) { 64 } else { 1 << 12 };
const SAMPLE_DISTANCE: usize = RUN_LENGTH / 16;
const MAX_PART_COUNT: usize = if cfg!(test) { 8 } else { 128 };

fn gather_keys<K: OrderedKey>(
    lists: &[&[K]],
    starts: &[usize],
    range: Range<usize>,
) -> Vec<Ranked<K>> {
    let mut keys = Vec::with_capacity(range.len());
    let first = starts.partition_point(|&start| start <= range.start) - 1;
    for (list, &start) in lists.iter().zip(starts).skip(first) {
        if start >= range.end {
            break;
        }
        let from = range.start.saturating_sub(start);
        let to = list.len().min(range.end - start);
        keys.extend(list[from..to].iter().map(Ranked::new));
    }
    keys
}

fn choose_splitters<K: OrderedKey>(runs: &[Vec<K>], atoms: &Interner<'_>) -> Vec<K> {
    let samples = runs
        .iter()
        .flat_map(|run| run.iter().step_by(SAMPLE_DISTANCE));
    let mut samples: Vec<K> = samples.copied().collect();
    samples.shared_sort_unstable_by(|a, b| a.compare(b, atoms));
    let part_count = runs.len().min(MAX_PART_COUNT);
    let places = (1..part_count).map(|part| part * samples.len() / part_count);
    places.map(|place| samples[place]).collect()
}

fn cut_run<'r, K: OrderedKey>(
    run: &'r [K],
    from: Option<&K>,
    to: Option<&K>,
    atoms: &Interner<'_>,
) -> &'r [K] {
    let count_below =
        |bound: &K| run.partition_point(|key| key.compare(bound, atoms) == Ordering::Less);
    &run[from.map_or(0, count_below)..to.map_or(run.len(), count_below)]
}

fn merge_two_runs<K: OrderedKey>(
    mut first: &[K],
    mut second: &[K],
    atoms: &Interner<'_>,
) -> Vec<K> {
    let mut merged = Vec::with_capacity(first.len() + second.len());
    while let ([a, rest_of_first @ ..], [b, rest_of_second @ ..]) = (first, second) {
        let order = a.compare(b, atoms);
        merged.push(if order == Ordering::Greater { *b } else { *a });
        if order != Ordering::Greater {
            first = rest_of_first;
        }
        if order != Ordering::Less {
            second = rest_of_second;
        }
    }
    merged.extend_from_slice(first);
    merged.extend_from_slice(second);
    merged
}

fn merge_runs<K: OrderedKey>(runs: &[&[K]], atoms: &Interner<'_>) -> Vec<K> {
    match *runs {
        [] => Vec::new(),
        [run] => run.to_vec(),
        [first, second] => merge_two_runs(first, second, atoms),
        _ => {
            let (first, second) = runs.split_at(runs.len() / 2);
            merge_two_runs(&merge_runs(first, atoms), &merge_runs(second, atoms), atoms)
        }
    }
}

fn sort_distinct_keys<K: OrderedKey>(
    lists: &[&[K]],
    atoms: &Interner<'_>,
    in_parallel: InParallel<'_>,
) -> (Vec<Ranked<K>>, Vec<Vec<Ranked<K>>>) {
    let mut starts = Vec::with_capacity(lists.len());
    let mut key_count = 0usize;
    for list in lists {
        starts.push(key_count);
        key_count += list.len();
    }
    let ranges = (0..key_count).step_by(RUN_LENGTH);
    let ranges = ranges.map(|start| start..key_count.min(start + RUN_LENGTH));
    let runs = map_each(ranges.collect(), in_parallel, &|range: Range<usize>| {
        let mut run = gather_keys(lists, &starts, range);
        run.sort_unstable_by(|a, b| a.compare(b, atoms));
        run.dedup_by(|a, b| a.compare(b, atoms) == Ordering::Equal);
        run
    });
    if runs.len() < 2 {
        return (Vec::new(), runs);
    }

    let splitters = choose_splitters(&runs, atoms);
    let parts: Vec<usize> = (0..=splitters.len()).collect();
    let parts = map_each(parts, in_parallel, &|part: usize| {
        let from = part.checked_sub(1).map(|previous| &splitters[previous]);
        let to = splitters.get(part);
        let pieces = runs.iter().map(|run| cut_run(run, from, to, atoms));
        let pieces: Vec<&[Ranked<K>]> = pieces.filter(|piece| !piece.is_empty()).collect();
        merge_runs(&pieces, atoms)
    });
    (splitters, parts)
}

fn find_place<K: OrderedKey>(
    splitters: &[K],
    parts: &[Vec<K>],
    key: &K,
    atoms: &Interner<'_>,
) -> Option<(usize, usize)> {
    let is_reached = |splitter: &K| splitter.compare(key, atoms) != Ordering::Greater;
    let part = splitters.partition_point(is_reached);
    let place = parts[part].binary_search_by(|other| other.compare(key, atoms));
    Some((part, place.ok()?))
}

pub(super) fn merge_keys<'a, K: OrderedKey>(
    lists: &[&[K]],
    atoms: &'a Interner<'a>,
    in_parallel: InParallel<'_>,
) -> MergedKeys<'a, K> {
    let (splitters, parts) = sort_distinct_keys(lists, atoms, in_parallel);
    let key_count: usize = parts.iter().map(Vec::len).sum();
    let mut starts = Vec::with_capacity(parts.len());
    let mut keys: Vec<K> = Vec::with_capacity(key_count);
    for part in &parts {
        starts.push(keys.len());
        keys.extend(part.iter().map(|ranked| ranked.key));
    }
    debug_assert!(keys.is_sorted_by(|a, b| a.compare(b, atoms) == Ordering::Less));
    assert!(
        keys.len() <= u32::MAX as usize,
        "a merged index has 32 bits"
    );

    let unfilled = lists.iter().map(|list| vec![0; list.len()]);
    let mut local_to_merged: Vec<Vec<u32>> = unfilled.collect();
    let mut pieces: Vec<(&[K], &mut [u32])> = Vec::new();
    for (list, indexes) in lists.iter().zip(&mut local_to_merged) {
        pieces.extend(list.chunks(RUN_LENGTH).zip(indexes.chunks_mut(RUN_LENGTH)));
    }
    for_each_mut(&mut pieces, in_parallel, &|(keys, indexes)| {
        for (key, index) in keys.iter().zip(indexes.iter_mut()) {
            let found = find_place(&splitters, &parts, &Ranked::new(key), atoms);
            let (part, place) = found.expect("the keys of every list were merged");
            debug_assert!(
                parts[part][place].key == *key,
                "two keys that differ compare equal"
            );
            *index = (starts[part] + place) as u32;
        }
    });
    drop(pieces);
    MergedKeys {
        keys,
        local_to_merged,
        atoms,
    }
}

#[derive(Copy, Clone)]
pub(super) struct Merged<'a> {
    pub units: &'a [LinkUnit],
    pub tables: &'a [LinkTables],
    pub modules: &'a ModuleTable,
    pub functions: &'a MergedKeys<'a, ProgramFunctionKey>,
    pub layouts: &'a MergedKeys<'a, ProgramLayoutKey>,
    pub variables: &'a MergedKeys<'a, ProgramVariableKey>,
    pub in_parallel: InParallel<'a>,
}

impl Merged<'_> {
    #[inline]
    pub(super) fn function(&self, unit: &LinkUnit, id: FunctionId) -> u32 {
        self.functions.local_to_merged[unit.tables as usize][id.index()]
    }

    #[inline]
    pub(super) fn layout(&self, unit: &LinkUnit, id: LayoutId) -> u32 {
        self.layouts.local_to_merged[unit.tables as usize][id.index()]
    }

    #[inline]
    pub(super) fn variable(&self, unit: &LinkUnit, id: VariableId) -> u32 {
        self.variables.local_to_merged[unit.tables as usize][id.index()]
    }

    pub(super) fn types_of(&self, unit: &LinkUnit) -> &TypeTable {
        &self.tables[unit.tables as usize].types
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::link::ProgramModule;
    use crate::link::testing::{
        forward, in_application, prepare, reverse, test_class_key, test_function_key,
        test_variable_key, units_in_tasks, with_test_files,
    };
    use bun_sema::session::Session;
    use core::fmt::Debug;
    use std::collections::BTreeSet;
    use std::sync::atomic::AtomicUsize;
    use std::sync::atomic::Ordering::Relaxed;

    impl OrderedKey for u64 {
        fn rank(&self) -> u128 {
            u128::from(*self / 8)
        }

        fn compare(&self, other: &Self, _: &Interner<'_>) -> Ordering {
            self.cmp(other)
        }
    }

    fn with_atoms<R>(then: impl FnOnce(&Interner<'_>) -> R) -> R {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        then(&atoms)
    }

    fn on_four_threads(count: usize, work: &(dyn Fn(usize) + Sync)) {
        let next = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| {
                    loop {
                        let index = next.fetch_add(1, Relaxed);
                        if index >= count {
                            break;
                        }
                        work(index);
                    }
                });
            }
        });
    }

    fn number_lists() -> [Vec<u64>; 3] {
        [
            (0..1000).collect(),
            (500..1500).rev().collect(),
            (0..3000).step_by(7).collect(),
        ]
    }

    fn mapped_keys<K: Copy>(merged: &MergedKeys<'_, K>, list: usize) -> Vec<K> {
        let indexes = merged.local_to_merged[list].iter();
        indexes.map(|&index| merged.keys[index as usize]).collect()
    }

    fn assert_merged<K: OrderedKey + Ord + Debug>(lists: &[&[K]], merged: &MergedKeys<'_, K>) {
        let all_keys = lists.iter().flat_map(|list| list.iter().copied());
        let expected_keys: BTreeSet<K> = all_keys.collect();
        assert_eq!(merged.keys, Vec::from_iter(expected_keys));

        assert_eq!(merged.local_to_merged.len(), lists.len());
        for (position, list) in lists.iter().enumerate() {
            assert_eq!(mapped_keys(merged, position), *list);
            for (key, &index) in list.iter().zip(&merged.local_to_merged[position]) {
                assert_eq!(merged.find(key), Some(index));
            }
        }
    }

    #[test]
    fn merges_overlapping_number_lists() {
        with_atoms(|atoms| {
            let [first, second, third] = number_lists();
            let lists: [&[u64]; 3] = [&first, &second, &third];
            let merged = merge_keys(&lists, atoms, &forward);
            assert_merged(&lists, &merged);
            assert_eq!(merged.find(&1501), None);
            assert_eq!(merged.find(&3000), None);
        });
    }

    #[test]
    fn merges_overlapping_function_key_lists() {
        with_atoms(|atoms| {
            let key = |file, function| in_application(test_function_key(file, function));
            let first = [key(0, 0), key(0, 1), key(1, 0)];
            let second = [key(1, 0), key(1, 1), key(0, 1)];
            let third = [key(2, 0), key(0, 0), key(1, 1), key(2, 1)];
            let lists: [&[ProgramFunctionKey]; 3] = [&first, &second, &third];
            let merged = merge_keys(&lists, atoms, &forward);
            assert_merged(&lists, &merged);
            assert_eq!(merged.keys.len(), 6);
            assert_eq!(merged.find(&key(3, 0)), None);
        });
    }

    #[test]
    fn merges_lists_of_any_length() {
        with_atoms(|atoms| {
            let lengths = [
                1,
                RUN_LENGTH - 1,
                RUN_LENGTH,
                RUN_LENGTH + 1,
                3 * RUN_LENGTH,
                (2 * MAX_PART_COUNT + 1) * RUN_LENGTH + 7,
            ];
            for length in lengths {
                let numbers = (0..length as u64).map(|place| place * 7919 % 1009);
                let numbers: Vec<u64> = numbers.collect();
                let (first, rest) = numbers.split_at(length / 3);
                let (second, third) = rest.split_at(rest.len() / 5);
                let lists = [first, second, third];
                assert_merged(&lists, &merge_keys(&lists, atoms, &forward));
            }
        });
    }

    #[test]
    fn key_that_is_repeated_everywhere_is_listed_once() {
        with_atoms(|atoms| {
            let repeated = vec![7u64; 2 * MAX_PART_COUNT * RUN_LENGTH];
            let lists: [&[u64]; 2] = [&repeated, &repeated[..5]];
            let merged = merge_keys(&lists, atoms, &forward);
            assert_merged(&lists, &merged);
            assert_eq!(merged.keys, [7]);
        });
    }

    #[test]
    fn order_of_tasks_and_number_of_threads_do_not_change_the_result() {
        with_atoms(|atoms| {
            let [first, second, third] = number_lists();
            let lists: [&[u64]; 3] = [&first, &second, &third];
            let in_order = merge_keys(&lists, atoms, &forward);
            let other_ways: [InParallel<'_>; 2] = [&reverse, &on_four_threads];
            for in_parallel in other_ways {
                let merged = merge_keys(&lists, atoms, in_parallel);
                assert_eq!(merged.keys, in_order.keys);
                assert_eq!(merged.local_to_merged, in_order.local_to_merged);
            }
        });
    }

    #[test]
    fn order_of_lists_changes_neither_keys_nor_what_an_entry_maps_to() {
        with_atoms(|atoms| {
            let [first, second, third] = number_lists();
            let lists: [&[u64]; 3] = [&first, &second, &third];
            let swapped_lists: [&[u64]; 3] = [&second, &first, &third];
            let merged = merge_keys(&lists, atoms, &forward);
            let swapped = merge_keys(&swapped_lists, atoms, &forward);
            assert_eq!(merged.keys, swapped.keys);
            for (list, swapped_list) in [(0, 1), (1, 0), (2, 2)] {
                assert_eq!(
                    merged.local_to_merged[list],
                    swapped.local_to_merged[swapped_list]
                );
            }
        });
    }

    #[test]
    fn empty_list_has_no_indexes() {
        with_atoms(|atoms| {
            let lists: [&[u64]; 2] = [&[], &[9, 4]];
            let merged = merge_keys(&lists, atoms, &forward);
            assert_merged(&lists, &merged);
            assert!(merged.local_to_merged[0].is_empty());
            assert_eq!(merged.local_to_merged[1], [1, 0]);
        });
    }

    #[test]
    fn no_lists_merge_to_nothing() {
        with_atoms(|atoms| {
            let merged = merge_keys::<u64>(&[], atoms, &forward);
            assert!(merged.keys.is_empty());
            assert!(merged.local_to_merged.is_empty());
            assert_eq!(merged.find(&0), None);
        });
    }

    #[test]
    fn names_go_by_their_bytes_whatever_their_numbers() {
        let merge_names = |interned_in_this_order: [&[u8]; 3]| {
            with_atoms(|atoms| {
                for name in interned_in_this_order {
                    atoms.intern(name);
                }
                let key = |name: &[u8]| ProgramVariableKey::SyntheticExport {
                    module: ProgramModule::Runtime(RuntimeModule::NodePath),
                    name: atoms.intern(name),
                };
                let first = [key(b"pear"), key(b"apple")];
                let second = [key(b"fig"), key(b"pear")];
                let lists: [&[ProgramVariableKey]; 2] = [&first, &second];
                let merged = merge_keys(&lists, atoms, &forward);
                let name_of = |key: &ProgramVariableKey| match *key {
                    ProgramVariableKey::SyntheticExport { name, .. } => name,
                    _ => panic!("{key:?}"),
                };
                let names = merged.keys.iter();
                let names = names.map(|key| atoms.bytes(name_of(key)).to_vec());
                let names: Vec<Vec<u8>> = names.collect();
                (names, merged.local_to_merged)
            })
        };
        let names = vec![b"apple".to_vec(), b"fig".to_vec(), b"pear".to_vec()];
        let expected = (names, vec![vec![2, 0], vec![1, 2]]);
        assert_eq!(merge_names([b"pear", b"fig", b"apple"]), expected);
        assert_eq!(merge_names([b"apple", b"fig", b"pear"]), expected);
    }

    fn assert_finds_keys_of_tables<K: Copy + Eq + Debug>(
        keys_of_tables: &[K],
        merged: &MergedKeys<'_, K>,
        merged_index_of: impl Fn(usize) -> u32,
    ) {
        assert!(!keys_of_tables.is_empty());
        for (number, key) in keys_of_tables.iter().enumerate() {
            assert_eq!(merged.keys[merged_index_of(number) as usize], *key);
        }
    }

    #[test]
    fn id_in_a_unit_is_an_index_into_the_tables_of_the_unit() {
        with_test_files(|projects, [main, first, second]| {
            let units = units_in_tasks(projects, &[&[main], &[first, second]], |unit| {
                unit.define_body(|_| {});
                let file = unit.file.0;
                unit.fragment.declare_layout(test_class_key(file, 0));
                unit.fragment.declare_variable(test_variable_key(file, 0));
            });
            let prepared = prepare(units, projects);
            let merged = Merged {
                units: &prepared.units,
                tables: &prepared.tables,
                modules: &prepared.modules,
                functions: &prepared.functions,
                layouts: &prepared.layouts,
                variables: &prepared.variables,
                in_parallel: &forward,
            };
            assert_eq!((merged.units.len(), merged.tables.len()), (3, 2));
            for unit in merged.units {
                let tables = &merged.tables[unit.tables as usize];
                assert!(core::ptr::eq(merged.types_of(unit), &tables.types));
                assert_finds_keys_of_tables(&tables.functions, merged.functions, |number| {
                    merged.function(unit, FunctionId::new(number))
                });
                assert_finds_keys_of_tables(&tables.layouts, merged.layouts, |number| {
                    merged.layout(unit, LayoutId::new(number))
                });
                assert_finds_keys_of_tables(&tables.variables, merged.variables, |number| {
                    merged.variable(unit, VariableId::new(number))
                });
            }
        });
    }
}
