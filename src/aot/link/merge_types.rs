use super::grouped::Grouped;
use super::numbering::TableIds;
use super::tables::LinkTables;
use crate::ir::parallel::{extend_from_each, map_each};
use crate::ir::references::IdMap;
use crate::ir::types::ClassPart;
use crate::ir::{
    FunctionId, Id, InParallel, LayoutId, StringId, Type, TypeId, TypeTable, drop_each,
    for_each_mut,
};
use crate::statistics::{Stage, StepClock};
use bun_sort_by_number::{SortByNumber, number_of_signed};
use core::cmp::Ordering;
use core::hash::BuildHasher;
use core::mem::take;
use core::ops::Range;
use rustc_hash::FxBuildHasher;
use std::sync::atomic::{self, AtomicU32};

pub(super) struct TypesByHeight {
    numbers: Vec<u32>,
    starts: Vec<u32>,
}

impl TypesByHeight {
    fn new(types: &[Type]) -> TypesByHeight {
        let mut heights: Vec<u32> = Vec::with_capacity(types.len());
        for ty in types {
            let named = ty.classes.iter().flat_map(|part| &part.contents);
            let height = named.map(|id| heights[id.index()] + 1).max();
            heights.push(height.unwrap_or(0));
        }
        let heights = heights
            .get(TypeTable::WELL_KNOWN_COUNT..)
            .unwrap_or_default();
        let highest = heights.iter().max();
        let height_count = highest.map_or(0, |&highest| highest as usize + 1);

        let mut starts = vec![0u32; height_count + 1];
        for &height in heights {
            starts[height as usize + 1] += 1;
        }
        let mut count = 0;
        for start in &mut starts {
            count += *start;
            *start = count;
        }
        let mut next_places = starts.clone();
        let mut numbers = vec![0u32; heights.len()];
        for (number, &height) in (TypeTable::WELL_KNOWN_COUNT as u32..).zip(heights) {
            let place = &mut next_places[height as usize];
            numbers[*place as usize] = number;
            *place += 1;
        }
        TypesByHeight { numbers, starts }
    }

    fn height_count(&self) -> usize {
        self.starts.len() - 1
    }

    fn at_height(&self, height: usize) -> &[u32] {
        match self.starts.get(height..height + 2) {
            Some(&[start, end]) => &self.numbers[start as usize..end as usize],
            _ => &[],
        }
    }
}

const END_OF_LIST: u32 = 0;

#[inline]
fn push_program_ids<I: Id>(
    row: &mut Vec<u32>,
    named: &[I],
    program_ids: &[Option<I>],
) -> Option<()> {
    for id in named {
        row.push(program_ids[id.index()]?.to_word() + 1);
    }
    Some(())
}

#[inline]
fn push_sorted_list<I: Id>(
    row: &mut Vec<u32>,
    named: &[I],
    program_ids: &[Option<I>],
) -> Option<()> {
    let start = row.len();
    push_program_ids(row, named, program_ids)?;
    row[start..].sort_unstable();
    row.push(END_OF_LIST);
    Some(())
}

fn push_row(row: &mut Vec<u32>, ty: &Type, map: &IdMap<'_>) -> Option<()> {
    let Type {
        primitives,
        flags,
        opaque,
        environment,
        minimum,
        maximum,
        strings,
        layouts,
        classes,
        builtins,
        functions,
    } = ty;
    let (minimum, maximum) = (number_of_signed(*minimum), number_of_signed(*maximum));
    row.push(primitives.to_wire());
    row.push(flags.to_wire());
    row.push(opaque.map_or(0, |kind| kind.to_wire() + 1));
    push_program_ids(row, environment.as_slice(), map.layouts)?;
    row.push(END_OF_LIST);
    row.push((minimum >> 32) as u32);
    row.push(minimum as u32);
    row.push((maximum >> 32) as u32);
    row.push(maximum as u32);
    push_sorted_list(row, strings, map.strings)?;
    push_sorted_list(row, layouts, map.layouts)?;
    for part in classes {
        let ClassPart {
            builtin_class,
            contents,
        } = part;
        row.push(builtin_class.to_wire() + 1);
        push_program_ids(row, contents, map.types)?;
        row.push(END_OF_LIST);
    }
    row.push(END_OF_LIST);
    for id in builtins {
        row.push(id.to_wire() + 1);
    }
    row.push(END_OF_LIST);
    push_sorted_list(row, functions, map.functions)
}

#[cfg(test)]
thread_local! {
    static COMPARISONS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static ROWS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
}

fn compare_rows(a: &[u32], b: &[u32]) -> Ordering {
    #[cfg(test)]
    COMPARISONS.set(COMPARISONS.get() + 1);
    a.cmp(b)
}

fn compare_rows_behind(a: &[u32], b: &[u32], words_alike: usize) -> (Ordering, usize) {
    #[cfg(test)]
    COMPARISONS.set(COMPARISONS.get() + 1);
    let shorter = a.len().min(b.len());
    let (front_of_a, front_of_b) = (&a[..shorter], &b[..shorter]);
    let mut at = words_alike;
    while at < shorter && front_of_a[at] == front_of_b[at] {
        at += 1;
    }
    let order = match at < shorter {
        true => front_of_a[at].cmp(&front_of_b[at]),
        false => a.len().cmp(&b.len()),
    };
    (order, at)
}

fn count_splitters_up_to(splitters: &[&[u32]], row: &[u32]) -> usize {
    let (mut low, mut high) = (0, splitters.len());
    let (mut alike_below, mut alike_above) = (0, 0);
    while low < high {
        let middle = low + (high - low) / 2;
        let words_alike = alike_below.min(alike_above);
        let (order, words_alike) = compare_rows_behind(splitters[middle], row, words_alike);
        if order.is_le() {
            (low, alike_below) = (middle + 1, words_alike);
        } else {
            (high, alike_above) = (middle, words_alike);
        }
    }
    low
}

const TYPES_IN_A_RUN: usize = if cfg!(test) { 64 } else { 1 << 12 };
const WORDS_IN_MOST_ROWS: usize = 16;
const MAX_PART_BITS: u32 = 10;
const MIN_PART_LENGTH: usize = 1 << 10;
const MAX_BUCKET_COUNT: usize = 256;
const SAMPLES_PER_BUCKET: usize = 8;
const MIN_BUCKET_LENGTH: usize = 256;

fn keep_hash(hash: u64) -> u64 {
    hash
}

#[derive(Copy, Clone)]
struct Hashing {
    weaken: fn(u64) -> u64,
    part_bits: u32,
}

impl Hashing {
    fn new(weaken: fn(u64) -> u64, count: usize) -> Hashing {
        let part_bits = (count / MIN_PART_LENGTH).max(1).ilog2().min(MAX_PART_BITS);
        Hashing { weaken, part_bits }
    }

    fn hash_of(self, row: &[u32]) -> u64 {
        (self.weaken)(FxBuildHasher.hash_one(row))
    }

    fn part_count(self) -> usize {
        1 << self.part_bits
    }

    fn part_of(self, hash: u64) -> usize {
        (hash >> 1 >> (u64::BITS - 1 - self.part_bits)) as usize
    }
}

#[derive(Copy, Clone)]
struct Entry {
    hash: u64,
    run: u32,
    place: u32,
}

const _: () = assert!(size_of::<Entry>() == 16);

#[derive(Copy, Clone)]
struct Cut<'a> {
    tables: u32,
    numbers: &'a [u32],
}

struct Run {
    tables: u32,
    numbers: Vec<u32>,
    rows: Vec<u32>,
    ends: Vec<u32>,
    entries: Grouped<Entry>,
}

impl Run {
    fn new(run: u32, cut: Cut<'_>, types: &[Type], map: &IdMap<'_>, hashing: Hashing) -> Run {
        let count = cut.numbers.len();
        let mut numbers = Vec::with_capacity(count);
        let mut rows: Vec<u32> = Vec::with_capacity(count * WORDS_IN_MOST_ROWS);
        let mut ends: Vec<u32> = Vec::with_capacity(count);
        let mut entries = Vec::with_capacity(count);
        let mut parts = Vec::with_capacity(count);
        for &number in cut.numbers {
            #[cfg(test)]
            ROWS.set(ROWS.get() + 1);
            let start = rows.len();
            if push_row(&mut rows, &types[number as usize], map).is_none() {
                rows.truncate(start);
                continue;
            }
            let hash = hashing.hash_of(&rows[start..]);
            entries.push(Entry {
                hash,
                run,
                place: numbers.len() as u32,
            });
            parts.push(hashing.part_of(hash) as u32);
            numbers.push(number);
            ends.push(u32::try_from(rows.len()).expect("the rows of a run fit 32 bits"));
        }
        Run {
            tables: cut.tables,
            numbers,
            rows,
            ends,
            entries: Grouped::new(&entries, &parts, hashing.part_count()),
        }
    }

    fn row(&self, place: u32) -> &[u32] {
        let start = match place.checked_sub(1) {
            Some(before) => self.ends[before as usize],
            None => 0,
        };
        &self.rows[start as usize..self.ends[place as usize] as usize]
    }
}

fn row_at(runs: &[Run], entry: Entry) -> &[u32] {
    runs[entry.run as usize].row(entry.place)
}

fn list_types_of_part(runs: &[Run], part: usize) -> Vec<Entry> {
    let pieces = || runs.iter().map(|run| run.entries.in_group(part));
    let mut entries = Vec::with_capacity(pieces().map(<[Entry]>::len).sum());
    for piece in pieces() {
        entries.extend_from_slice(piece);
    }
    entries.sort_by_u64(|entry| entry.hash);

    let mut listed: Vec<Entry> = Vec::new();
    for tied in entries.chunk_by(|a, b| a.hash == b.hash) {
        let first = listed.len();
        for &entry in tied {
            let row = row_at(runs, entry);
            let mut with_same_hash = listed[first..].iter();
            if !with_same_hash.any(|&other| row_at(runs, other) == row) {
                listed.push(entry);
            }
        }
    }
    listed
}

struct ListedAt {
    part: usize,
    place: usize,
}

struct ListedTypes {
    hashing: Option<Hashing>,
    by_part: Vec<Vec<Entry>>,
}

impl ListedTypes {
    fn new(runs: &[Run], hashing: Hashing, in_parallel: InParallel<'_>) -> ListedTypes {
        let parts: Vec<usize> = (0..hashing.part_count()).collect();
        ListedTypes {
            hashing: Some(hashing),
            by_part: map_each(parts, in_parallel, &|part| list_types_of_part(runs, part)),
        }
    }

    fn of_different_types(runs: &[Run], in_parallel: InParallel<'_>) -> ListedTypes {
        let numbered_runs: Vec<(u32, &Run)> = (0u32..).zip(runs).collect();
        let by_part = map_each(numbered_runs, in_parallel, &|(run, types)| {
            let places = 0..types.numbers.len() as u32;
            let entries = places.map(|place| Entry {
                hash: 0,
                run,
                place,
            });
            entries.collect::<Vec<Entry>>()
        });
        ListedTypes {
            hashing: None,
            by_part,
        }
    }

    fn find(&self, runs: &[Run], entry: Entry) -> ListedAt {
        let Some(hashing) = self.hashing else {
            return ListedAt {
                part: entry.run as usize,
                place: entry.place as usize,
            };
        };
        let part = hashing.part_of(entry.hash);
        let listed = &self.by_part[part];
        let first = listed.partition_point(|other| other.hash < entry.hash);
        let has_hash_of_entry = |place: usize| {
            let other = listed.get(place);
            other.is_some_and(|other| other.hash == entry.hash)
        };
        let place = match has_hash_of_entry(first + 1) {
            true => {
                let row = row_at(runs, entry);
                let mut from_first = listed[first..].iter();
                let found = from_first.position(|&other| row_at(runs, other) == row);
                first + found.expect("every type of the runs is listed")
            }
            false => first,
        };
        debug_assert!(row_at(runs, listed[place]) == row_at(runs, entry));
        ListedAt { part, place }
    }
}

fn choose_splitters<'a>(runs: &'a [Run], listed: &[Vec<Entry>]) -> Vec<&'a [u32]> {
    let count: usize = listed.iter().map(Vec::len).sum();
    let bucket_count = (count / MIN_BUCKET_LENGTH).min(MAX_BUCKET_COUNT);
    if bucket_count < 2 {
        return Vec::new();
    }
    let stride = count / (bucket_count * SAMPLES_PER_BUCKET);
    let entries = listed.iter().flatten().step_by(stride);
    let mut samples: Vec<&[u32]> = entries.map(|&entry| row_at(runs, entry)).collect();
    samples.sort_unstable_by(|a, b| compare_rows(a, b));
    let splitters = samples.into_iter().step_by(SAMPLES_PER_BUCKET);
    splitters.skip(1).collect()
}

#[derive(Copy, Clone)]
struct Listed {
    entry: Entry,
    part: u32,
    place: u32,
}

fn group_by_bucket(
    runs: &[Run],
    splitters: &[&[u32]],
    part: usize,
    listed: &[Entry],
) -> Grouped<Listed> {
    let bucket_of = |entry: &Entry| count_splitters_up_to(splitters, row_at(runs, *entry)) as u32;
    let buckets: Vec<u32> = listed.iter().map(bucket_of).collect();
    let listed = (0u32..).zip(listed).map(|(place, &entry)| Listed {
        entry,
        part: part as u32,
        place,
    });
    let listed: Vec<Listed> = listed.collect();
    Grouped::new(&listed, &buckets, splitters.len() + 1)
}

fn count_words_alike_in_front(words: &[u32], rows: &[(Range<usize>, Listed)]) -> usize {
    let Some(((first, _), others)) = rows.split_first() else {
        return 0;
    };
    let first = &words[first.clone()];
    let mut words_alike = first.len();
    for (row, _) in others {
        let row = &words[row.clone()];
        let compared = words_alike.min(row.len());
        let (front_of_first, front_of_row) = (&first[..compared], &row[..compared]);
        words_alike = 0;
        while words_alike < compared && front_of_first[words_alike] == front_of_row[words_alike] {
            words_alike += 1;
        }
    }
    words_alike
}

struct NumberedTypes {
    listed: ListedTypes,
    ids: Vec<Vec<AtomicU32>>,
}

impl NumberedTypes {
    fn number_bucket(
        &self,
        runs: &[Run],
        by_bucket: &[Grouped<Listed>],
        bucket: usize,
        first_id: u32,
    ) -> Vec<Entry> {
        let mut listed: Vec<Listed> = Vec::new();
        for part in by_bucket {
            listed.extend_from_slice(part.in_group(bucket));
        }
        let mut words: Vec<u32> = Vec::with_capacity(listed.len() * WORDS_IN_MOST_ROWS);
        let mut rows: Vec<(Range<usize>, Listed)> = Vec::with_capacity(listed.len());
        for ty in listed {
            let start = words.len();
            words.extend_from_slice(row_at(runs, ty.entry));
            rows.push((start..words.len(), ty));
        }
        let words_alike = count_words_alike_in_front(&words, &rows);
        for (row, _) in &mut rows {
            row.start += words_alike;
        }
        rows.sort_unstable_by(|a, b| compare_rows(&words[a.0.clone()], &words[b.0.clone()]));
        for (id, (_, ty)) in (first_id..).zip(&rows) {
            self.ids[ty.part as usize][ty.place as usize].store(id, atomic::Ordering::Relaxed);
        }
        rows.iter().map(|(_, ty)| ty.entry).collect()
    }

    fn find(&self, runs: &[Run], entry: Entry) -> TypeId {
        let ListedAt { part, place } = self.listed.find(runs, entry);
        TypeId::from_word(self.ids[part][place].load(atomic::Ordering::Relaxed))
    }
}

fn number_types(
    runs: &[Run],
    listed: ListedTypes,
    first_id: usize,
    in_parallel: InParallel<'_>,
) -> (NumberedTypes, Vec<Vec<Entry>>) {
    let splitters = choose_splitters(runs, &listed.by_part);
    let parts: Vec<usize> = (0..listed.by_part.len()).collect();
    let by_bucket = map_each(parts, in_parallel, &|part| {
        group_by_bucket(runs, &splitters, part, &listed.by_part[part])
    });

    let mut next_id = first_id;
    let mut buckets: Vec<(usize, u32)> = Vec::with_capacity(splitters.len() + 1);
    for bucket in 0..=splitters.len() {
        buckets.push((bucket, u32::try_from(next_id).expect("an id has 32 bits")));
        let lengths = by_bucket.iter().map(|part| part.in_group(bucket).len());
        next_id += lengths.sum::<usize>();
    }
    let unset_ids = |listed: &Vec<Entry>| -> Vec<AtomicU32> {
        listed.iter().map(|_| AtomicU32::new(0)).collect()
    };
    let numbered = NumberedTypes {
        ids: listed.by_part.iter().map(unset_ids).collect(),
        listed,
    };
    let in_order = map_each(buckets, in_parallel, &|(bucket, first_id)| {
        numbered.number_bucket(runs, &by_bucket, bucket, first_id)
    });
    (numbered, in_order)
}

struct Share<'a, T> {
    first_number: u32,
    items: &'a mut [T],
}

fn share_out<'a, T>(cuts: &[Cut<'_>], lists: &'a mut [Vec<T>]) -> Vec<Share<'a, T>> {
    let mut shares = Vec::with_capacity(cuts.len());
    let mut left = cuts.iter().peekable();
    for (tables, list) in (0u32..).zip(lists) {
        let (mut free, mut first_number) = (list.as_mut_slice(), 0u32);
        while left.next_if(|cut| cut.tables == tables).is_some() {
            let end = match left.peek() {
                Some(next) if next.tables == tables => next.numbers[0],
                _ => first_number + free.len() as u32,
            };
            let (items, rest) = take(&mut free).split_at_mut((end - first_number) as usize);
            shares.push(Share {
                first_number,
                items,
            });
            (free, first_number) = (rest, end);
        }
    }
    assert_eq!(shares.len(), cuts.len());
    shares
}

fn cut_height(by_height: &[TypesByHeight], height: usize) -> Vec<Cut<'_>> {
    let mut cuts = Vec::new();
    for (tables, types) in (0u32..).zip(by_height) {
        let numbers = types.at_height(height).chunks(TYPES_IN_A_RUN);
        cuts.extend(numbers.map(|numbers| Cut { tables, numbers }));
    }
    cuts
}

fn list_types_of_tables(tables: &[LinkTables]) -> Vec<&[Type]> {
    tables
        .iter()
        .map(|tables| &tables.types.types()[..tables.lengths.types as usize])
        .collect()
}

fn sort_lists_by_height(lists: &[&[Type]], in_parallel: InParallel<'_>) -> Vec<TypesByHeight> {
    map_each(lists.to_vec(), in_parallel, &|types| {
        TypesByHeight::new(types)
    })
}

pub(super) fn sort_types_by_height(
    tables: &[LinkTables],
    in_parallel: InParallel<'_>,
) -> Vec<TypesByHeight> {
    sort_lists_by_height(&list_types_of_tables(tables), in_parallel)
}

#[derive(Copy, Clone)]
pub(super) struct NamesOfRecords<'a> {
    pub strings: &'a [Vec<Option<StringId>>],
    pub layouts: &'a [Vec<u32>],
    pub functions: &'a [Vec<u32>],
}

const NO_GROUP: u32 = u32::MAX;

struct ChosenTypes {
    tables: u32,
    numbers: Vec<u32>,
}

pub(super) struct AlikeTypes {
    groups: Vec<Vec<u32>>,
    chosen: Vec<ChosenTypes>,
    places: Vec<Vec<(u32, u32)>>,
    ids_of_well_known_types: Vec<Vec<Option<TypeId>>>,
}

fn write_names_as_ids<I: Id>(names: &[u32]) -> Vec<Option<I>> {
    names.iter().map(|&name| Some(I::from_word(name))).collect()
}

fn find_alike_types_in_lists(
    lists: &[&[Type]],
    by_height: &[TypesByHeight],
    names: NamesOfRecords<'_>,
    weaken_hash: fn(u64) -> u64,
    in_parallel: InParallel<'_>,
) -> AlikeTypes {
    debug_assert_eq!(lists.len(), by_height.len());
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let all_tables: Vec<usize> = (0..lists.len()).collect();
    let names_as_ids = map_each(all_tables, in_parallel, &|tables: usize| TableIds {
        layouts: write_names_as_ids::<LayoutId>(&names.layouts[tables]),
        functions: write_names_as_ids::<FunctionId>(&names.functions[tables]),
        ..TableIds::default()
    });
    let map_of = |tables: u32| IdMap {
        strings: &names.strings[tables as usize],
        ..names_as_ids[tables as usize].as_map()
    };
    let cuts = cut_height(by_height, 0);
    let count: usize = cuts.iter().map(|cut| cut.numbers.len()).sum();
    let hashing = Hashing::new(weaken_hash, count);
    let numbered_cuts: Vec<(u32, Cut<'_>)> = (0u32..).zip(cuts.iter().copied()).collect();
    let runs = map_each(numbered_cuts, in_parallel, &|(run, cut)| {
        let types = lists[cut.tables as usize];
        Run::new(run, cut, types, &map_of(cut.tables), hashing)
    });
    steps.end("types that are alike: rows");
    let listed = ListedTypes::new(&runs, hashing, in_parallel);
    steps.end("types that are alike: those that differ");

    let mut first_groups: Vec<u32> = Vec::with_capacity(listed.by_part.len());
    let mut group_count = 0usize;
    for part in &listed.by_part {
        first_groups.push(u32::try_from(group_count).expect("a group has 32 bits"));
        group_count += part.len();
    }
    assert!(group_count < NO_GROUP as usize, "a group has 32 bits");
    let mut groups: Vec<Vec<u32>> = map_each(lists.to_vec(), in_parallel, &|types| {
        vec![NO_GROUP; types.len()]
    });
    let shares = share_out(&cuts, &mut groups);
    let mut tasks: Vec<(&Run, Share<'_, u32>, Vec<u32>)> = runs
        .iter()
        .zip(shares)
        .map(|(run, share)| (run, share, Vec::new()))
        .collect();
    for_each_mut(&mut tasks, in_parallel, &|(run, share, chosen)| {
        let mut is_chosen = vec![false; run.numbers.len()];
        for &entry in &run.entries.items {
            let ListedAt { part, place } = listed.find(&runs, entry);
            let number = run.numbers[entry.place as usize];
            share.items[(number - share.first_number) as usize] = first_groups[part] + place as u32;
            let of_group = listed.by_part[part][place];
            is_chosen[entry.place as usize] =
                (of_group.run, of_group.place) == (entry.run, entry.place);
        }
        let numbers = run.numbers.iter().zip(&is_chosen);
        let numbers = numbers.filter(|&(_, &is_chosen)| is_chosen);
        *chosen = numbers.map(|(&number, _)| number).collect();
    });
    let chosen = tasks
        .into_iter()
        .filter(|(_, _, numbers)| !numbers.is_empty());
    let chosen: Vec<ChosenTypes> = chosen
        .map(|(run, _, numbers)| ChosenTypes {
            tables: run.tables,
            numbers,
        })
        .collect();
    let places = map_each(listed.by_part, in_parallel, &|entries: Vec<Entry>| {
        let places = entries.into_iter().map(|entry| {
            let run = &runs[entry.run as usize];
            (run.tables, run.numbers[entry.place as usize])
        });
        places.collect::<Vec<(u32, u32)>>()
    });
    steps.end("types that are alike: groups");
    drop_each(runs, in_parallel);

    let id_of_well_known_type =
        |number: usize| (number < TypeTable::WELL_KNOWN_COUNT).then(|| TypeId::new(number));
    let ids_of_well_known_types: Vec<Vec<Option<TypeId>>> =
        map_each(lists.to_vec(), in_parallel, &|types| {
            (0..types.len()).map(id_of_well_known_type).collect()
        });
    steps.end_with(|| {
        format!("types that are alike: {count} types of height 0 in {group_count} groups")
    });
    AlikeTypes {
        groups,
        chosen,
        places,
        ids_of_well_known_types,
    }
}

pub(super) struct MergedTypes {
    pub count: usize,
    places: Vec<Vec<(u32, u32)>>,
}

fn merge_type_lists(
    lists: &[&[Type]],
    by_height: &[TypesByHeight],
    alike: AlikeTypes,
    ids: &[TableIds],
    weaken_hash: fn(u64) -> u64,
    in_parallel: InParallel<'_>,
) -> (MergedTypes, Vec<Vec<Option<TypeId>>>) {
    debug_assert_eq!(lists.len(), ids.len());
    debug_assert_eq!(lists.len(), by_height.len());
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let height_counts = by_height.iter().map(TypesByHeight::height_count);
    let height_count = height_counts.max().unwrap_or(0);

    debug_assert!(
        lists
            .iter()
            .all(|types| types.starts_with(TypeTable::new().types()))
    );
    let mut type_count = TypeTable::WELL_KNOWN_COUNT;
    let mut places_of_types: Vec<Vec<(u32, u32)>> = Vec::new();
    let AlikeTypes {
        groups,
        chosen,
        places: places_of_groups,
        ids_of_well_known_types: mut program_ids,
    } = alike;

    for height in 0..height_count {
        let cuts: Vec<Cut<'_>> = match height {
            0 => {
                let chosen = chosen.iter().map(|chosen| Cut {
                    tables: chosen.tables,
                    numbers: &chosen.numbers,
                });
                chosen.collect()
            }
            _ => cut_height(by_height, height),
        };
        let count: usize = cuts.iter().map(|cut| cut.numbers.len()).sum();
        let hashing = Hashing::new(weaken_hash, count);
        let known_count = type_count;
        let mut parts_of_height = StepClock::new(Stage::LinkAndEmit);
        let mut end_part = |part: &str| {
            if count >= 1 << 18 {
                parts_of_height.end_with(|| format!("merge types: height {height}: {part}"));
            }
        };
        let map_of = |tables: u32| IdMap {
            types: &program_ids[tables as usize],
            ..ids[tables as usize].as_map()
        };
        let numbered_cuts: Vec<(u32, Cut<'_>)> = (0u32..).zip(cuts.iter().copied()).collect();
        let runs = map_each(numbered_cuts, in_parallel, &|(run, cut)| {
            let types = lists[cut.tables as usize];
            Run::new(run, cut, types, &map_of(cut.tables), hashing)
        });
        end_part("rows");
        let listed = match height {
            0 => ListedTypes::of_different_types(&runs, in_parallel),
            _ => ListedTypes::new(&runs, hashing, in_parallel),
        };
        let (numbered, in_order) = number_types(&runs, listed, known_count, in_parallel);
        end_part("those that differ, in order");
        let places = map_each(in_order, in_parallel, &|entries: Vec<Entry>| {
            let places = entries.into_iter().map(|entry| {
                let run = &runs[entry.run as usize];
                (run.tables, run.numbers[entry.place as usize])
            });
            places.collect::<Vec<(u32, u32)>>()
        });
        type_count += places.iter().map(Vec::len).sum::<usize>();
        places_of_types.extend(places);
        end_part("places of those that differ");

        let shares = share_out(&cuts, &mut program_ids);
        let mut tasks: Vec<(&Run, Share<'_, Option<TypeId>>)> = runs.iter().zip(shares).collect();
        for_each_mut(&mut tasks, in_parallel, &|(run, share)| {
            for &entry in &run.entries.items {
                let number = run.numbers[entry.place as usize];
                let id = numbered.find(&runs, entry);
                share.items[(number - share.first_number) as usize] = Some(id);
            }
        });
        drop(tasks);
        end_part("ids");
        if height == 0 {
            let mut ids_of_groups: Vec<Option<TypeId>> = Vec::new();
            extend_from_each(
                &mut ids_of_groups,
                &places_of_groups,
                in_parallel,
                &|&(tables, number)| program_ids[tables as usize][number as usize],
            );
            let lists_of_tables = program_ids.iter_mut().zip(&groups).zip(by_height);
            let mut tasks: Vec<(&mut Vec<Option<TypeId>>, &Vec<u32>, &TypesByHeight)> =
                lists_of_tables
                    .map(|((program_ids, groups), types)| (program_ids, groups, types))
                    .collect();
            for_each_mut(&mut tasks, in_parallel, &|(program_ids, groups, types)| {
                for &number in types.at_height(0) {
                    let group = groups[number as usize];
                    if group != NO_GROUP {
                        program_ids[number as usize] = ids_of_groups[group as usize];
                    }
                }
            });
            drop(tasks);
            end_part("ids of those that are alike");
        }
        drop_each(runs, in_parallel);
        if steps.logs() {
            let different = type_count - known_count;
            steps.end(&format!(
                "merge types: height {height}: {count} types, {different} different"
            ));
        }
    }
    let merged = MergedTypes {
        count: type_count,
        places: places_of_types,
    };
    (merged, program_ids)
}

#[inline]
fn copy_list<T: Clone>(list: &[T]) -> Vec<T> {
    match list.is_empty() {
        true => Vec::new(),
        false => list.to_vec(),
    }
}

fn copy_type(ty: &Type) -> Type {
    Type {
        strings: copy_list(&ty.strings),
        layouts: copy_list(&ty.layouts),
        classes: copy_list(&ty.classes),
        builtins: copy_list(&ty.builtins),
        functions: copy_list(&ty.functions),
        ..*ty
    }
}

fn make_records_of_lists<'a>(
    lists: &[&[Type]],
    merged: &MergedTypes,
    map_of: &(dyn Fn(u32) -> IdMap<'a> + Sync),
    in_parallel: InParallel<'_>,
) -> Vec<Type> {
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let mut program_types: Vec<Type> = Vec::with_capacity(merged.count + merged.count / 8);
    program_types.extend_from_slice(TypeTable::new().types());
    extend_from_each(&mut program_types, &merged.places, in_parallel, &|&(
        tables,
        number,
    )| {
        let mut ty = copy_type(&lists[tables as usize][number as usize]);
        ty.remap_ids(&map_of(tables));
        ty
    });
    debug_assert_eq!(program_types.len(), merged.count);
    steps.end("merge types: records");
    program_types
}

pub(super) fn find_alike_types(
    tables: &[LinkTables],
    by_height: &[TypesByHeight],
    names: NamesOfRecords<'_>,
    in_parallel: InParallel<'_>,
) -> AlikeTypes {
    let lists = list_types_of_tables(tables);
    find_alike_types_in_lists(&lists, by_height, names, keep_hash, in_parallel)
}

pub(super) fn merge_types(
    tables: &[LinkTables],
    by_height: &[TypesByHeight],
    alike: AlikeTypes,
    ids: &[TableIds],
    in_parallel: InParallel<'_>,
) -> (MergedTypes, Vec<Vec<Option<TypeId>>>) {
    let lists = list_types_of_tables(tables);
    merge_type_lists(&lists, by_height, alike, ids, keep_hash, in_parallel)
}

pub(super) fn make_type_records(
    tables: &[LinkTables],
    merged: &MergedTypes,
    ids: &[TableIds],
    in_parallel: InParallel<'_>,
) -> Vec<Type> {
    let lists = list_types_of_tables(tables);
    let map_of = |tables: u32| ids[tables as usize].as_map();
    make_records_of_lists(&lists, merged, &map_of, in_parallel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::id::{BuiltinClass, BuiltinId};
    use crate::ir::testing::{array_of, layout, string};
    use crate::ir::{OpaqueKind, Primitives, PropertyKeyTable, StringTable, run_serially};
    use crate::load::ProjectId;

    const WELL_KNOWN_COUNT: usize = TypeTable::WELL_KNOWN_COUNT;

    fn function(index: usize) -> FunctionId {
        FunctionId::new(index)
    }

    fn id_behind_well_known_types(place: usize) -> Option<TypeId> {
        Some(TypeId::new(WELL_KNOWN_COUNT + place))
    }

    fn ids_of_layouts(layouts: &[usize]) -> TableIds {
        TableIds {
            layouts: layouts.iter().map(|&index| Some(layout(index))).collect(),
            ..TableIds::default()
        }
    }

    fn name_records<I: Id>(tables: usize, ids: &[Option<I>]) -> Vec<u32> {
        let numbered = (0u32..).zip(ids);
        numbered
            .map(|(number, id)| match id {
                Some(id) => id.to_word(),
                None => (1 << 24) + ((tables as u32) << 12) + number,
            })
            .collect()
    }

    struct Names {
        strings: Vec<Vec<Option<StringId>>>,
        layouts: Vec<Vec<u32>>,
        functions: Vec<Vec<u32>>,
    }

    impl Names {
        fn of_ids(ids: &[TableIds]) -> Names {
            let numbered = || ids.iter().enumerate();
            Names {
                strings: ids.iter().map(|ids| ids.strings.clone()).collect(),
                layouts: numbered()
                    .map(|(tables, ids)| name_records(tables, &ids.layouts))
                    .collect(),
                functions: numbered()
                    .map(|(tables, ids)| name_records(tables, &ids.functions))
                    .collect(),
            }
        }

        fn of_records(&self) -> NamesOfRecords<'_> {
            NamesOfRecords {
                strings: &self.strings,
                layouts: &self.layouts,
                functions: &self.functions,
            }
        }
    }

    fn merge_lists(
        lists: &[&[Type]],
        names: &Names,
        ids: &[TableIds],
        weaken_hash: fn(u64) -> u64,
        in_parallel: InParallel<'_>,
    ) -> (TypeTable, Vec<Vec<Option<TypeId>>>) {
        let by_height = sort_lists_by_height(lists, in_parallel);
        let names = names.of_records();
        let alike = find_alike_types_in_lists(lists, &by_height, names, weaken_hash, in_parallel);
        let (merged, program_ids) =
            merge_type_lists(lists, &by_height, alike, ids, weaken_hash, in_parallel);
        let map_of = |tables: u32| IdMap {
            types: &program_ids[tables as usize],
            ..ids[tables as usize].as_map()
        };
        let records = make_records_of_lists(lists, &merged, &map_of, in_parallel);
        assert_eq!(records.len(), merged.count);
        (
            TypeTable::of_distinct_types(records, in_parallel),
            program_ids,
        )
    }

    fn merge(
        types: &[TypeTable],
        ids: &[TableIds],
        in_parallel: InParallel<'_>,
    ) -> (TypeTable, Vec<Vec<Option<TypeId>>>) {
        let lists: Vec<&[Type]> = types.iter().map(TypeTable::types).collect();
        merge_lists(&lists, &Names::of_ids(ids), ids, keep_hash, in_parallel)
    }

    #[test]
    fn comparison_goes_by_the_fields_in_the_order_of_the_schema() {
        let class_part = |class: u32, contents: &[TypeId]| ClassPart {
            builtin_class: BuiltinClass::from_wire(class).expect("the table has the class"),
            contents: contents.to_vec(),
        };
        let builtin = |word: u32| BuiltinId::from_wire(word).expect("the table has the built-in");
        let number_list = || class_part(0, &[TypeTable::NUMBER]);
        let two_numbers = class_part(0, &[TypeTable::NUMBER, TypeTable::NUMBER]);
        let string_list = class_part(0, &[TypeTable::STRING]);
        #[rustfmt::skip]
        let ascending = [
            Type { minimum: -1, maximum: 9, ..Type::default() },
            Type::default(),
            Type::function(function(0)),
            Type { functions: vec![function(0), function(1)], ..Type::default() },
            Type::function(function(1)),
            Type { builtins: vec![builtin(5)], ..Type::default() },
            Type { builtins: vec![builtin(6)], ..Type::default() },
            Type { classes: vec![class_part(0, &[])], ..Type::default() },
            Type { classes: vec![number_list()], ..Type::default() },
            Type { classes: vec![number_list(), class_part(1, &[])], ..Type::default() },
            Type { classes: vec![two_numbers], ..Type::default() },
            Type { classes: vec![string_list], ..Type::default() },
            Type { classes: vec![class_part(1, &[])], ..Type::default() },
            Type::layout(layout(0)),
            Type { layouts: vec![layout(0), layout(1)], ..Type::default() },
            Type::layout(layout(1)),
            Type::string_literal(string(0)),
            Type::string_literal(string(1)),
            Type { maximum: 1, ..Type::default() },
            Type { minimum: 1, ..Type::default() },
            Type::environment(layout(0)),
            Type::opaque(OpaqueKind::IteratorState),
            Type::any_function(),
            Type::primitives(Primitives::UNDEFINED),
        ];
        let ids = TableIds {
            strings: (0..2).map(|index| Some(string(index))).collect(),
            types: (0..WELL_KNOWN_COUNT)
                .map(|index| Some(TypeId::new(index)))
                .collect(),
            layouts: (0..2).map(|index| Some(layout(index))).collect(),
            functions: (0..2).map(|index| Some(function(index))).collect(),
            ..TableIds::default()
        };
        let rows = ascending.each_ref().map(|ty| {
            let mut row = Vec::new();
            push_row(&mut row, ty, &ids.as_map()).expect("the program has every record");
            row
        });
        for (place, a) in rows.iter().enumerate() {
            for (other_place, b) in rows.iter().enumerate() {
                let types = (&ascending[place], &ascending[other_place]);
                assert_eq!(compare_rows(a, b), place.cmp(&other_place), "{types:?}");
            }
        }
    }

    #[test]
    fn height_is_one_above_the_highest_type_named() {
        let mut types = TypeTable::new();
        assert_eq!(TypesByHeight::new(types.types()).height_count(), 0);
        let numbers = types.intern(array_of(TypeTable::NUMBER));
        let dog = types.intern(Type::layout(layout(0)));
        let map = types.intern(Type::class(BuiltinClass::Map, &[dog, numbers]));
        let by_height = TypesByHeight::new(types.types());
        assert_eq!(by_height.height_count(), 3);
        assert_eq!(by_height.at_height(0), [dog.to_word()]);
        assert_eq!(by_height.at_height(1), [numbers.to_word()]);
        assert_eq!(by_height.at_height(2), [map.to_word()]);
        assert!(by_height.at_height(3).is_empty());
    }

    #[test]
    fn well_known_types_keep_their_ids() {
        let (program, ids) = merge(&[], &[], &run_serially);
        assert_eq!(program.types(), TypeTable::new().types());
        assert!(ids.is_empty());

        let mut types = TypeTable::new();
        types.intern(array_of(TypeTable::ARRAY));
        let (program, ids) = merge(&[types], &[TableIds::default()], &run_serially);
        let same_ids: Vec<Option<TypeId>> = (0..=WELL_KNOWN_COUNT)
            .map(|index| Some(TypeId::new(index)))
            .collect();
        assert_eq!(ids, [same_ids]);
        assert_eq!(
            program.types()[..WELL_KNOWN_COUNT],
            *TypeTable::new().types()
        );
        assert_eq!(
            program.types()[WELL_KNOWN_COUNT..],
            [array_of(TypeTable::ARRAY)]
        );
    }

    #[test]
    fn tables_that_number_layouts_differently_share_their_types() {
        let either = || Type {
            layouts: vec![layout(0), layout(1)],
            ..Type::default()
        };
        let mut first = TypeTable::new();
        let dog = first.intern(Type::layout(layout(0)));
        first.intern(Type::layout(layout(1)));
        first.intern(either());
        first.intern(array_of(dog));
        let mut second = TypeTable::new();
        let dog = second.intern(Type::layout(layout(1)));
        second.intern(array_of(dog));
        second.intern(either());

        let ids = [ids_of_layouts(&[7, 3]), ids_of_layouts(&[3, 7])];
        let (program, ids) = merge(&[first, second], &ids, &run_serially);
        let expected = [
            Type::layout(layout(3)),
            Type {
                layouts: vec![layout(3), layout(7)],
                ..Type::default()
            },
            Type::layout(layout(7)),
            array_of(TypeId::new(WELL_KNOWN_COUNT + 2)),
        ];
        assert_eq!(program.types()[WELL_KNOWN_COUNT..], expected);
        let id = id_behind_well_known_types;
        assert_eq!(ids[0][WELL_KNOWN_COUNT..], [id(2), id(0), id(1), id(3)]);
        assert_eq!(ids[1][WELL_KNOWN_COUNT..], [id(2), id(3), id(1)]);
    }

    #[test]
    fn types_found_alike_by_the_keys_of_their_layouts_get_one_id() {
        let either = |a: usize, b: usize| Type {
            layouts: vec![layout(a), layout(b)],
            ..Type::default()
        };
        let mut first = TypeTable::new();
        let dog = first.intern(Type::layout(layout(0)));
        first.intern(Type::layout(layout(1)));
        first.intern(either(0, 1));
        first.intern(Type::layout(layout(2)));
        first.intern(array_of(dog));
        let mut second = TypeTable::new();
        let dog = second.intern(Type::layout(layout(2)));
        second.intern(either(0, 2));
        second.intern(Type::layout(layout(1)));
        second.intern(array_of(dog));

        let ids_of = |layouts: [Option<usize>; 3]| TableIds {
            layouts: layouts.map(|index| index.map(layout)).to_vec(),
            ..TableIds::default()
        };
        let ids = [
            ids_of([Some(7), Some(3), None]),
            ids_of([Some(3), None, Some(7)]),
        ];
        let by_key = Names {
            layouts: vec![vec![40, 10, 25], vec![10, 25, 40]],
            ..Names::of_ids(&ids)
        };
        let lists = [first.types(), second.types()];
        let expected = [
            Type::layout(layout(3)),
            either(3, 7),
            Type::layout(layout(7)),
            array_of(TypeId::new(WELL_KNOWN_COUNT + 2)),
        ];
        let id = id_behind_well_known_types;
        for names in [by_key, Names::of_ids(&ids)] {
            let (program, ids) = merge_lists(&lists, &names, &ids, keep_hash, &run_serially);
            assert_eq!(program.types()[WELL_KNOWN_COUNT..], expected);
            assert_eq!(
                ids[0][WELL_KNOWN_COUNT..],
                [id(2), id(0), id(1), None, id(3)]
            );
            assert_eq!(ids[1][WELL_KNOWN_COUNT..], [id(2), id(1), None, id(3)]);
        }
    }

    #[test]
    fn type_that_names_a_record_without_an_id_is_left_out_with_what_names_it() {
        let mut types = TypeTable::new();
        let incomplete = [
            Type::function(function(0)),
            Type {
                functions: vec![function(0), function(1)],
                ..Type::default()
            },
            Type::layout(layout(0)),
            Type::environment(layout(0)),
            Type::string_literal(string(0)),
        ]
        .map(|ty| types.intern(ty));
        let list = types.intern(array_of(incomplete[0]));
        let lists = types.intern(array_of(list));
        let whole = types.intern(Type::function(function(1)));

        let ids = TableIds {
            strings: vec![None],
            layouts: vec![None],
            functions: vec![None, Some(function(0))],
            ..TableIds::default()
        };
        let (program, ids) = merge(&[types], &[ids], &run_serially);
        for id in incomplete.into_iter().chain([list, lists]) {
            assert_eq!(ids[0][id.index()], None);
        }
        assert_eq!(ids[0][whole.index()], id_behind_well_known_types(0));
        assert_eq!(
            program.types()[WELL_KNOWN_COUNT..],
            [Type::function(function(0))]
        );
    }

    fn table_of_ranges_and_their_lists(maxima: impl Iterator<Item = i64>) -> TypeTable {
        let mut types = TypeTable::new();
        for maximum in maxima {
            let range = types.intern(Type::integers(0, maximum));
            types.intern(array_of(range));
        }
        types
    }

    #[test]
    fn program_does_not_depend_on_how_the_types_are_spread_over_tables() {
        let ranges = (1..20_000).map(|maximum| Type::integers(0, maximum));
        let lists = (0..19_999).map(|place| array_of(TypeId::new(WELL_KNOWN_COUNT + place)));
        let expected: Vec<Type> = ranges.chain(lists).collect();
        let ids = [(); 3].map(|()| TableIds::default());

        let whole = [table_of_ranges_and_their_lists(1..20_000)];
        let (program, _) = merge(&whole, &ids[..1], &run_serially);
        assert_eq!(program.types()[WELL_KNOWN_COUNT..], expected);

        let mut parts = [
            table_of_ranges_and_their_lists((1..12_000).rev()),
            table_of_ranges_and_their_lists(9_000..20_000),
            table_of_ranges_and_their_lists((1..20_000).step_by(7)),
        ];
        let (program, program_ids) = merge(&parts, &ids, &run_serially);
        assert_eq!(program.types()[WELL_KNOWN_COUNT..], expected);
        for (types, program_ids) in parts.iter().zip(&program_ids) {
            let map = IdMap {
                types: program_ids,
                ..ids[0].as_map()
            };
            for (ty, id) in types.types().iter().zip(program_ids) {
                let mut remapped = ty.clone();
                remapped.remap_ids(&map);
                let id = id.expect("the type names nothing that the program lacks");
                assert_eq!(remapped, *program.get(id));
            }
        }

        let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| {
            (0..count).rev().for_each(work);
        };
        parts.reverse();
        let (program, _) = merge(&parts, &ids, &in_reverse);
        assert_eq!(program.types()[WELL_KNOWN_COUNT..], expected);
    }

    #[test]
    fn type_that_many_tables_hold_is_put_in_order_once() {
        let tables: Vec<TypeTable> = (0..64)
            .map(|_| table_of_ranges_and_their_lists(1..1_000))
            .collect();
        let ids: Vec<TableIds> = tables.iter().map(|_| TableIds::default()).collect();
        let before = COMPARISONS.get();
        let (program, _) = merge(&tables, &ids, &run_serially);
        let comparisons = COMPARISONS.get() - before;
        assert_eq!(program.len(), WELL_KNOWN_COUNT + 2 * 999);
        assert!(comparisons < 2 * 999 * 32, "{comparisons}");
    }

    #[test]
    fn behind_the_ids_one_row_is_written_for_the_types_of_height_0_that_are_alike() {
        let tables: Vec<TypeTable> = (0..64)
            .map(|_| table_of_ranges_and_their_lists(1..1_000))
            .collect();
        let lists: Vec<&[Type]> = tables.iter().map(TypeTable::types).collect();
        let ids: Vec<TableIds> = tables.iter().map(|_| TableIds::default()).collect();
        let by_height = sort_lists_by_height(&lists, &run_serially);
        let names = Names::of_ids(&ids);
        let names = names.of_records();
        let alike = find_alike_types_in_lists(&lists, &by_height, names, keep_hash, &run_serially);
        let before = ROWS.get();
        let (merged, _) =
            merge_type_lists(&lists, &by_height, alike, &ids, keep_hash, &run_serially);
        assert_eq!(merged.count, WELL_KNOWN_COUNT + 2 * 999);
        assert_eq!(ROWS.get() - before, 999 + 64 * 999);
    }

    fn assert_ranges_and_their_lists_are_merged(count: i64, weaken_hash: fn(u64) -> u64) {
        let parts = [
            table_of_ranges_and_their_lists((1..count * 2 / 3).rev()),
            table_of_ranges_and_their_lists(count / 3..count),
        ];
        let lists: Vec<&[Type]> = parts.iter().map(TypeTable::types).collect();
        let ids = [(); 2].map(|()| TableIds::default());
        let names = Names::of_ids(&ids);
        let (program, program_ids) = merge_lists(&lists, &names, &ids, weaken_hash, &run_serially);

        let ranges = (1..count).map(|maximum| Type::integers(0, maximum));
        let lists_of_ranges =
            (0..count as usize - 1).map(|place| array_of(TypeId::new(WELL_KNOWN_COUNT + place)));
        let expected: Vec<Type> = ranges.chain(lists_of_ranges).collect();
        assert_eq!(program.types()[WELL_KNOWN_COUNT..], expected);
        for (types, program_ids) in parts.iter().zip(&program_ids) {
            let map = IdMap {
                types: program_ids,
                ..ids[0].as_map()
            };
            for (ty, id) in types.types().iter().zip(program_ids) {
                let mut remapped = ty.clone();
                remapped.remap_ids(&map);
                let id = id.expect("the type names nothing that the program lacks");
                assert_eq!(remapped, *program.get(id));
            }
        }
    }

    #[test]
    fn types_that_share_a_hash_stay_apart() {
        assert_ranges_and_their_lists_are_merged(300, |_| 7);
        assert_ranges_and_their_lists_are_merged(6_000, |hash| hash >> 58 << 58);
    }

    #[test]
    fn parts_follow_the_order_of_the_hashes() {
        let one_part = Hashing::new(keep_hash, MIN_PART_LENGTH);
        assert_eq!(one_part.part_count(), 1);
        assert_eq!(one_part.part_of(u64::MAX), 0);
        let four_parts = Hashing::new(keep_hash, MIN_PART_LENGTH * 7);
        assert_eq!(four_parts.part_count(), 4);
        assert_eq!(
            [0, 1 << 62, u64::MAX].map(|hash| four_parts.part_of(hash)),
            [0, 1, 3]
        );
        let most_parts = Hashing::new(keep_hash, usize::MAX);
        assert_eq!(most_parts.part_count(), 1 << MAX_PART_BITS);
        assert_eq!(most_parts.part_of(u64::MAX), most_parts.part_count() - 1);
    }

    #[test]
    fn type_behind_the_length_of_its_tables_is_not_read() {
        let mut types = TypeTable::new();
        types.intern(Type::layout(layout(0)));
        let length = types.len();
        types.intern(Type::layout(layout(1)));
        let mut tables = LinkTables {
            project: ProjectId::Application,
            strings: StringTable::default(),
            property_keys: PropertyKeyTable::default(),
            types,
            functions: Vec::new(),
            layouts: Vec::new(),
            variables: Vec::new(),
            modules: Vec::new(),
            module_failures: Vec::new(),
            lengths: Default::default(),
        };
        tables.lengths.types = length as u32;
        let tables = [tables];
        let by_height = sort_types_by_height(&tables, &run_serially);
        let ids = [ids_of_layouts(&[0])];
        let names = Names::of_ids(&ids);
        let alike = find_alike_types(&tables, &by_height, names.of_records(), &run_serially);
        let (program, ids) = merge_types(&tables, &by_height, alike, &ids, &run_serially);
        assert_eq!(program.count, length);
        assert_eq!(ids[0].len(), length);
    }
}
