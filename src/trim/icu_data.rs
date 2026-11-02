use core::ops::Range;

use crate::error::TrimInternalError;

pub(crate) const TOMBSTONE: [u8; 16] = *b"BUNICUREMOVED\0\0\0";

const MINIMUM_PACKAGE_SIZE: usize = 32;
const MINIMUM_HEADER_SIZE: usize = 20;
const COUNT_SIZE: usize = 4;
const ENTRY_SIZE: usize = 8;
const DATA_OFFSET_FIELD: usize = 4;
const TOMBSTONE_SIZE: u32 = TOMBSTONE.len() as u32;

struct TableOfContents {
    start: usize,
    count: u32,
}

struct Tombstone {
    entries: Range<u32>,
    start: u32,
}

struct PlannedRemoval {
    table: TableOfContents,
    tombstones: Vec<Tombstone>,
    removed_spans: Vec<Range<u32>>,
    dead_ranges: Vec<Range<u32>>,
    dead_names: Vec<u32>,
}

/// Returns the byte ranges of `package` that nothing refers to any more: ascending, disjoint, adjacent ones merged, offsets from the first byte of `package`.
pub(crate) fn remove_items(
    package: &mut [u8],
    removed_items: &[Range<u32>],
    tombstoned_items: &[Range<u32>],
) -> Result<Vec<Range<u32>>, TrimInternalError> {
    let removal = plan_removal(package, removed_items, tombstoned_items)
        .ok_or(TrimInternalError::MalformedIcuData)?;
    write_tombstones(package, &removal);
    zero_names(package, &removal);
    compact_entries(package, &removal);
    Ok(removal.dead_ranges)
}

fn plan_removal(
    package: &[u8],
    removed_items: &[Range<u32>],
    tombstoned_items: &[Range<u32>],
) -> Option<PlannedRemoval> {
    let table = read_table_of_contents(package)?;
    check_runs(removed_items, table.count)?;
    check_runs(tombstoned_items, table.count)?;
    check_disjoint(removed_items, tombstoned_items)?;
    let removed_spans = merge_adjacent(removed_items.iter().cloned());
    let tombstoned_spans = merge_adjacent(tombstoned_items.iter().cloned());
    let (tombstones, mut dead_ranges) = table.find_tombstones(package, &tombstoned_spans)?;
    dead_ranges.extend(table.find_dead_ranges(package, &removed_spans)?);
    dead_ranges.sort_unstable_by_key(|range| range.start);
    let dead_names = table.find_dead_names(package, &removed_spans)?;
    Some(PlannedRemoval {
        table,
        tombstones,
        removed_spans,
        dead_ranges: merge_adjacent(dead_ranges),
        dead_names,
    })
}

fn read_table_of_contents(package: &[u8]) -> Option<TableOfContents> {
    if package.len() < MINIMUM_PACKAGE_SIZE
        || u32::try_from(package.len()).is_err()
        || !has_common_data_header(package)
    {
        return None;
    }
    let start = usize::from(u16::from_le_bytes(*package.first_chunk()?));
    if start < MINIMUM_HEADER_SIZE {
        return None;
    }
    let count = u32_at(package, start)?;
    let entries_end = start as u64 + COUNT_SIZE as u64 + ENTRY_SIZE as u64 * u64::from(count);
    if entries_end > package.len() as u64 {
        return None;
    }
    let table = TableOfContents { start, count };
    table.check_entries(package)?;
    Some(table)
}

fn has_common_data_header(package: &[u8]) -> bool {
    package.get(2..4) == Some(&[0xda, 0x27][..])
        && package.get(8..10) == Some(&[0, 0][..])
        && package.get(12..17) == Some(&b"CmnD\x01"[..])
}

fn check_runs(runs: &[Range<u32>], count: u32) -> Option<()> {
    let mut previous_end = 0;
    for run in runs {
        if run.is_empty() || run.start < previous_end {
            return None;
        }
        previous_end = run.end;
    }
    (previous_end <= count).then_some(())
}

fn check_disjoint(mut left: &[Range<u32>], mut right: &[Range<u32>]) -> Option<()> {
    while let (Some(left_run), Some(right_run)) = (left.first(), right.first()) {
        if left_run.end <= right_run.start {
            left = &left[1..];
        } else if right_run.end <= left_run.start {
            right = &right[1..];
        } else {
            return None;
        }
    }
    Some(())
}

fn push_merged(ranges: &mut Vec<Range<u32>>, range: Range<u32>) {
    match ranges.last_mut() {
        Some(last) if last.end == range.start => last.end = range.end,
        _ => ranges.push(range),
    }
}

fn merge_adjacent(ranges: impl IntoIterator<Item = Range<u32>>) -> Vec<Range<u32>> {
    let mut merged = Vec::new();
    for range in ranges {
        push_merged(&mut merged, range);
    }
    merged
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(*bytes.get(at..)?.first_chunk()?))
}

impl TableOfContents {
    fn entry_position(&self, index: u32) -> usize {
        self.start + COUNT_SIZE + ENTRY_SIZE * index as usize
    }

    fn name_offset(&self, package: &[u8], index: u32) -> Option<u32> {
        if index >= self.count {
            return None;
        }
        u32_at(package, self.entry_position(index))
    }

    fn data_offset(&self, package: &[u8], index: u32) -> Option<u32> {
        if index >= self.count {
            return None;
        }
        u32_at(package, self.entry_position(index) + DATA_OFFSET_FIELD)
    }

    fn item_start(&self, package: &[u8], index: u32) -> Option<u32> {
        if index == self.count {
            return u32::try_from(package.len()).ok();
        }
        Some(self.start as u32 + self.data_offset(package, index)?)
    }

    fn check_entries(&self, package: &[u8]) -> Option<()> {
        let limit = u32::try_from(package.len() - self.start).ok()?;
        let entries_size = u32::try_from(self.entry_position(self.count) - self.start).ok()?;
        let mut previous_data_offset = entries_size;
        for index in 0..self.count {
            let data_offset = self.data_offset(package, index)?;
            let name_offset = self.name_offset(package, index)?;
            if data_offset < previous_data_offset
                || name_offset < entries_size
                || name_offset >= limit
            {
                return None;
            }
            let name = package.get(self.start + name_offset as usize..)?;
            if !bun_core::strings::contains_char(name, 0) {
                return None;
            }
            previous_data_offset = data_offset;
        }
        (previous_data_offset <= limit).then_some(())
    }

    fn find_owned_extent(&self, package: &[u8], span: &Range<u32>) -> Option<Range<u32>> {
        let preceding_start = span
            .start
            .checked_sub(1)
            .and_then(|index| self.item_start(package, index));
        let first_owned = span
            .clone()
            .find(|&index| self.item_start(package, index) != preceding_start)
            .unwrap_or(span.end);
        Some(self.item_start(package, first_owned)?..self.item_start(package, span.end)?)
    }

    fn find_dead_ranges(
        &self,
        package: &[u8],
        removed_spans: &[Range<u32>],
    ) -> Option<Vec<Range<u32>>> {
        let mut dead_ranges = Vec::with_capacity(removed_spans.len());
        for span in removed_spans {
            let extent = self.find_owned_extent(package, span)?;
            if !extent.is_empty() {
                push_merged(&mut dead_ranges, extent);
            }
        }
        Some(dead_ranges)
    }

    fn find_tombstones(
        &self,
        package: &[u8],
        tombstoned_spans: &[Range<u32>],
    ) -> Option<(Vec<Tombstone>, Vec<Range<u32>>)> {
        let mut tombstones = Vec::with_capacity(tombstoned_spans.len());
        let mut dead_ranges = Vec::with_capacity(tombstoned_spans.len());
        for span in tombstoned_spans {
            let extent = self.find_owned_extent(package, span)?;
            if extent.end - extent.start < TOMBSTONE_SIZE {
                continue;
            }
            tombstones.push(Tombstone {
                entries: span.clone(),
                start: extent.start,
            });
            let dead_range = extent.start + TOMBSTONE_SIZE..extent.end;
            if !dead_range.is_empty() {
                dead_ranges.push(dead_range);
            }
        }
        Some((tombstones, dead_ranges))
    }

    fn find_dead_names(&self, package: &[u8], removed_spans: &[Range<u32>]) -> Option<Vec<u32>> {
        let mut dead_names = Vec::new();
        for span in removed_spans {
            let retained_before = span
                .start
                .checked_sub(1)
                .and_then(|index| self.name_offset(package, index));
            let retained_after = self.name_offset(package, span.end);
            for index in span.clone() {
                let name_offset = self.name_offset(package, index)?;
                if retained_before != Some(name_offset) && retained_after != Some(name_offset) {
                    dead_names.push(name_offset);
                }
            }
        }
        Some(dead_names)
    }
}

fn write_tombstones(package: &mut [u8], removal: &PlannedRemoval) {
    let table = &removal.table;
    for tombstone in &removal.tombstones {
        let start = tombstone.start as usize;
        package[start..start + TOMBSTONE.len()].copy_from_slice(&TOMBSTONE);
        let data_offset = (tombstone.start - table.start as u32).to_le_bytes();
        for index in tombstone.entries.clone() {
            let field = table.entry_position(index) + DATA_OFFSET_FIELD;
            package[field..field + data_offset.len()].copy_from_slice(&data_offset);
        }
    }
}

fn zero_names(package: &mut [u8], removal: &PlannedRemoval) {
    for &name_offset in &removal.dead_names {
        package[removal.table.start + name_offset as usize..]
            .iter_mut()
            .take_while(|byte| **byte != 0)
            .for_each(|byte| *byte = 0);
    }
}

fn compact_entries(package: &mut [u8], removal: &PlannedRemoval) {
    let table = &removal.table;
    let Some(first_span) = removal.removed_spans.first() else {
        return;
    };
    let mut retained_count = first_span.start;
    for (index, span) in removal.removed_spans.iter().enumerate() {
        let next_start = removal
            .removed_spans
            .get(index + 1)
            .map_or(table.count, |next| next.start);
        package.copy_within(
            table.entry_position(span.end)..table.entry_position(next_start),
            table.entry_position(retained_count),
        );
        retained_count += next_start - span.end;
    }
    package[table.entry_position(retained_count)..table.entry_position(table.count)].fill(0);
    package[table.start..table.start + COUNT_SIZE].copy_from_slice(&retained_count.to_le_bytes());
}

#[cfg(test)]
#[allow(clippy::single_range_in_vec_init)]
pub(crate) mod tests {
    use super::*;

    const HEADER_SIZE: usize = 32;
    const FIVE_ITEMS: [(&str, usize); 5] = [
        ("coll/a", 40),
        ("coll/b", 24),
        ("curr/c", 33),
        ("lang/d", 16),
        ("zone/e", 50),
    ];

    fn put_u32(bytes: &mut [u8], at: usize, value: u32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    pub(crate) fn package_of(items: &[(&str, usize)], header_size: usize) -> Vec<u8> {
        let mut header = vec![0; header_size];
        header[..2].copy_from_slice(&(header_size as u16).to_le_bytes());
        header[2..4].copy_from_slice(&[0xda, 0x27]);
        header[12..17].copy_from_slice(b"CmnD\x01");
        let mut entries = vec![0; COUNT_SIZE + items.len() * ENTRY_SIZE];
        put_u32(&mut entries, 0, items.len() as u32);
        let mut at = entries.len();
        let mut names = Vec::new();
        for (index, (name, _)) in items.iter().enumerate() {
            put_u32(&mut entries, COUNT_SIZE + index * ENTRY_SIZE, at as u32);
            names.extend_from_slice(name.as_bytes());
            names.push(0);
            at += name.len() + 1;
        }
        let mut bodies = Vec::new();
        for (index, (_, size)) in items.iter().enumerate() {
            let padding = (16 - at % 16) % 16;
            put_u32(
                &mut entries,
                COUNT_SIZE + index * ENTRY_SIZE + DATA_OFFSET_FIELD,
                (at + padding) as u32,
            );
            bodies.resize(bodies.len() + padding + size, 0xaa);
            at += padding + size;
        }
        [header, entries, names, bodies].concat()
    }

    fn compare_after_prefix(
        package: &[u8],
        left: &[u8],
        right_at: usize,
        prefix_length: &mut usize,
    ) -> i32 {
        loop {
            let left_byte = i32::from(left.get(*prefix_length).copied().unwrap_or(0));
            let right_byte = i32::from(package[right_at + *prefix_length]);
            let comparison = left_byte - right_byte;
            if comparison != 0 || left_byte == 0 {
                return comparison;
            }
            *prefix_length += 1;
        }
    }

    fn lookup(package: &[u8], name: &str) -> Option<usize> {
        let table = read_table_of_contents(package)?;
        let name = name.as_bytes();
        let name_at =
            |index: u32| table.start + table.name_offset(package, index).unwrap() as usize;
        let found = |index: u32| Some(table.item_start(package, index).unwrap() as usize);
        if table.count == 0 {
            return None;
        }
        let mut start = 0;
        let mut limit = table.count;
        let mut start_prefix_length = 0;
        let mut limit_prefix_length = 0;
        if compare_after_prefix(package, name, name_at(start), &mut start_prefix_length) == 0 {
            return found(start);
        }
        start += 1;
        limit -= 1;
        if compare_after_prefix(package, name, name_at(limit), &mut limit_prefix_length) == 0 {
            return found(limit);
        }
        while start < limit {
            let index = (start + limit) / 2;
            let mut prefix_length = start_prefix_length.min(limit_prefix_length);
            let comparison =
                compare_after_prefix(package, name, name_at(index), &mut prefix_length);
            if comparison < 0 {
                limit = index;
                limit_prefix_length = prefix_length;
            } else if comparison == 0 {
                return found(index);
            } else {
                start = index + 1;
                start_prefix_length = prefix_length;
            }
        }
        None
    }

    fn item_starts(package: &[u8]) -> Vec<u32> {
        let table = read_table_of_contents(package).unwrap();
        (0..=table.count)
            .map(|index| table.item_start(package, index).unwrap())
            .collect()
    }

    fn name_range(package: &[u8], index: u32) -> Range<usize> {
        let table = read_table_of_contents(package).unwrap();
        let start = table.start + table.name_offset(package, index).unwrap() as usize;
        let length = bun_core::strings::index_of_char_usize(&package[start..], 0).unwrap();
        start..start + length + 1
    }

    fn name_field(index: usize) -> usize {
        HEADER_SIZE + COUNT_SIZE + index * ENTRY_SIZE
    }

    fn data_field(index: usize) -> usize {
        name_field(index) + DATA_OFFSET_FIELD
    }

    fn check_retained(package: &[u8], before: &[u8], retained: &[usize]) {
        let starts = item_starts(before);
        assert_eq!(u32_at(package, HEADER_SIZE), Some(retained.len() as u32));
        for (index, (name, _)) in FIVE_ITEMS.iter().enumerate() {
            let expected = retained.contains(&index).then_some(starts[index] as usize);
            assert_eq!(lookup(package, name), expected, "{name}");
        }
        let first_item = starts[0] as usize;
        assert_eq!(package[first_item..], before[first_item..]);
    }

    fn check_lookups(package: &[u8], starts: &[u32], expected_items: [Option<usize>; 5]) {
        for ((name, _), expected_item) in FIVE_ITEMS.iter().zip(expected_items) {
            assert_eq!(
                lookup(package, name),
                expected_item.map(|item| starts[item] as usize),
                "{name}"
            );
        }
    }

    fn tombstone_range(start: u32) -> Range<usize> {
        start as usize..start as usize + TOMBSTONE.len()
    }

    fn check_malformed(
        package: &[u8],
        removed_items: &[Range<u32>],
        tombstoned_items: &[Range<u32>],
    ) {
        let mut edited = package.to_vec();
        let result = remove_items(&mut edited, removed_items, tombstoned_items);
        assert!(matches!(result, Err(TrimInternalError::MalformedIcuData)));
        assert_eq!(edited, package);
    }

    fn check_edit_malformed(edit: impl FnOnce(&mut Vec<u8>)) {
        let mut package = package_of(&FIVE_ITEMS, HEADER_SIZE);
        edit(&mut package);
        check_malformed(&package, &[1..2], &[]);
        check_malformed(&package, &[], &[1..2]);
    }

    #[test]
    fn removes_middle_items() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        let dead_ranges = remove_items(&mut package, &[1..3], &[]).unwrap();
        assert_eq!(dead_ranges, vec![starts[1]..starts[3]]);
        check_retained(&package, &before, &[0, 3, 4]);
        for index in [1, 2] {
            let name = name_range(&before, index);
            assert!(package[name].iter().all(|byte| *byte == 0));
        }
        assert!(
            package[name_field(3)..name_field(5)]
                .iter()
                .all(|byte| *byte == 0)
        );
        assert_eq!(
            package[name_range(&before, 0)],
            before[name_range(&before, 0)]
        );
    }

    #[test]
    fn removes_first_item() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        assert_eq!(
            remove_items(&mut package, &[0..1], &[]).unwrap(),
            vec![starts[0]..starts[1]]
        );
        check_retained(&package, &before, &[1, 2, 3, 4]);
    }

    #[test]
    fn removes_last_item() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        let dead_ranges = remove_items(&mut package, &[4..5], &[]).unwrap();
        assert_eq!(dead_ranges, vec![starts[4]..before.len() as u32]);
        check_retained(&package, &before, &[0, 1, 2, 3]);
    }

    #[test]
    fn removes_all_items() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        let dead_ranges = remove_items(&mut package, &[0..5], &[]).unwrap();
        assert_eq!(dead_ranges, vec![starts[0]..before.len() as u32]);
        check_retained(&package, &before, &[]);
        assert!(
            package[name_field(0)..name_field(5)]
                .iter()
                .all(|byte| *byte == 0)
        );
    }

    #[test]
    fn separate_runs_give_separate_ranges() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        let dead_ranges = remove_items(&mut package, &[0..1, 2..3, 4..5], &[]).unwrap();
        assert_eq!(
            dead_ranges,
            vec![
                starts[0]..starts[1],
                starts[2]..starts[3],
                starts[4]..before.len() as u32
            ]
        );
        check_retained(&package, &before, &[1, 3]);
    }

    #[test]
    fn merges_adjacent_runs() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        assert_eq!(
            remove_items(&mut package, &[0..1, 1..2], &[]).unwrap(),
            vec![starts[0]..starts[2]]
        );
        check_retained(&package, &before, &[2, 3, 4]);
    }

    #[test]
    fn honors_header_size() {
        for header_size in [32, 48] {
            let before = package_of(&FIVE_ITEMS, header_size);
            let mut package = before.clone();
            let starts = item_starts(&before);
            assert_eq!(
                remove_items(&mut package, &[1..2], &[]).unwrap(),
                vec![starts[1]..starts[2]]
            );
            assert_eq!(lookup(&package, "coll/b"), None);
            assert_eq!(lookup(&package, "curr/c"), Some(starts[2] as usize));
            assert_eq!(package[starts[0] as usize..], before[starts[0] as usize..]);
        }
    }

    #[test]
    fn retains_shared_data_offset() {
        let before = package_of(&[("a", 0), ("b", 16)], HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        assert_eq!(starts[0], starts[1]);
        assert!(remove_items(&mut package, &[0..1], &[]).unwrap().is_empty());
        assert_eq!(lookup(&package, "a"), None);
        assert_eq!(lookup(&package, "b"), Some(starts[1] as usize));
    }

    #[test]
    fn retains_data_shared_with_preceding_item() {
        let before = package_of(&[("a", 0), ("b", 16), ("c", 16)], HEADER_SIZE);
        let starts = item_starts(&before);
        assert_eq!(starts[0], starts[1]);

        let mut package = before.clone();
        assert!(remove_items(&mut package, &[1..2], &[]).unwrap().is_empty());
        assert_eq!(lookup(&package, "a"), Some(starts[0] as usize));
        assert_eq!(lookup(&package, "b"), None);
        assert_eq!(lookup(&package, "c"), Some(starts[2] as usize));

        let mut package = before.clone();
        assert_eq!(
            remove_items(&mut package, &[1..3], &[]).unwrap(),
            vec![starts[2]..before.len() as u32]
        );
        assert_eq!(lookup(&package, "a"), Some(starts[0] as usize));
        assert_eq!(lookup(&package, "c"), None);
    }

    #[test]
    fn retains_last_item_shared_with_preceding_item() {
        let before = package_of(&[("a", 0), ("b", 16)], HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        assert!(remove_items(&mut package, &[1..2], &[]).unwrap().is_empty());
        assert_eq!(lookup(&package, "a"), Some(starts[0] as usize));
        assert_eq!(lookup(&package, "b"), None);
        assert_eq!(package[starts[0] as usize..], before[starts[0] as usize..]);
    }

    #[test]
    fn retains_shared_name() {
        let mut before = package_of(&[("a", 16), ("b", 16), ("c", 16)], HEADER_SIZE);
        let name_offset = u32_at(&before, name_field(0)).unwrap();
        put_u32(&mut before, name_field(1), name_offset);
        let mut package = before.clone();
        remove_items(&mut package, &[0..1], &[]).unwrap();
        assert_eq!(
            package[name_range(&before, 0)],
            before[name_range(&before, 0)]
        );

        let mut package = before.clone();
        remove_items(&mut package, &[0..2], &[]).unwrap();
        assert!(
            package[name_range(&before, 0)]
                .iter()
                .all(|byte| *byte == 0)
        );
    }

    #[test]
    fn empty_run_list_changes_nothing() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        assert!(remove_items(&mut package, &[], &[]).unwrap().is_empty());
        assert_eq!(package, before);
    }

    #[test]
    fn tombstoned_items_keep_names_and_share_one_offset() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let mut package = before.clone();
        let starts = item_starts(&before);
        let dead_ranges = remove_items(&mut package, &[], &[1..2, 2..3]).unwrap();
        assert_eq!(dead_ranges, vec![starts[1] + TOMBSTONE_SIZE..starts[3]]);
        assert_eq!(u32_at(&package, HEADER_SIZE), Some(5));
        check_lookups(
            &package,
            &starts,
            [Some(0), Some(1), Some(1), Some(3), Some(4)],
        );
        assert_eq!(package[tombstone_range(starts[1])], TOMBSTONE);
        let names = name_field(5)..starts[0] as usize;
        assert_eq!(package[names.clone()], before[names]);
    }

    #[test]
    fn tombstone_leaves_sixteen_bytes() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let starts = item_starts(&before);

        let mut package = before.clone();
        let dead_ranges = remove_items(&mut package, &[], &[4..5]).unwrap();
        assert_eq!(
            dead_ranges,
            vec![starts[4] + TOMBSTONE_SIZE..before.len() as u32]
        );
        assert_eq!(package[tombstone_range(starts[4])], TOMBSTONE);

        let mut package = before.clone();
        assert_eq!(starts[4] - starts[3], TOMBSTONE_SIZE);
        assert!(remove_items(&mut package, &[], &[3..4]).unwrap().is_empty());
        assert_eq!(package[tombstone_range(starts[3])], TOMBSTONE);
        assert_eq!(package[..starts[3] as usize], before[..starts[3] as usize]);
        assert_eq!(package[starts[4] as usize..], before[starts[4] as usize..]);
    }

    #[test]
    fn span_shorter_than_tombstone_is_untouched() {
        let before = package_of(&[("a", 16), ("b", 15)], HEADER_SIZE);
        let mut package = before.clone();
        assert!(remove_items(&mut package, &[], &[1..2]).unwrap().is_empty());
        assert_eq!(package, before);
    }

    #[test]
    fn tombstone_next_to_removed_span() {
        let before = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let starts = item_starts(&before);

        let mut package = before.clone();
        let dead_ranges = remove_items(&mut package, &[1..2], &[2..4]).unwrap();
        assert_eq!(
            dead_ranges,
            vec![starts[1]..starts[2], starts[2] + TOMBSTONE_SIZE..starts[4]]
        );
        assert_eq!(u32_at(&package, HEADER_SIZE), Some(4));
        check_lookups(
            &package,
            &starts,
            [Some(0), None, Some(2), Some(2), Some(4)],
        );
        assert_eq!(package[tombstone_range(starts[2])], TOMBSTONE);

        let mut package = before.clone();
        let dead_ranges = remove_items(&mut package, &[3..4], &[1..3]).unwrap();
        assert_eq!(dead_ranges, vec![starts[1] + TOMBSTONE_SIZE..starts[4]]);
        assert_eq!(u32_at(&package, HEADER_SIZE), Some(4));
        check_lookups(
            &package,
            &starts,
            [Some(0), Some(1), Some(1), None, Some(4)],
        );
        assert_eq!(package[tombstone_range(starts[1])], TOMBSTONE);
    }

    #[test]
    fn item_sharing_data_with_retained_item_is_repointed_not_overwritten() {
        let before = package_of(&[("a", 0), ("b", 16), ("c", 32), ("d", 16)], HEADER_SIZE);
        let starts = item_starts(&before);
        assert_eq!(starts[0], starts[1]);

        let mut package = before.clone();
        let dead_ranges = remove_items(&mut package, &[], &[1..3]).unwrap();
        assert_eq!(dead_ranges, vec![starts[2] + TOMBSTONE_SIZE..starts[3]]);
        assert_eq!(lookup(&package, "a"), Some(starts[0] as usize));
        assert_eq!(lookup(&package, "b"), Some(starts[2] as usize));
        assert_eq!(lookup(&package, "c"), Some(starts[2] as usize));
        assert_eq!(lookup(&package, "d"), Some(starts[3] as usize));
        let shared = starts[0] as usize..starts[2] as usize;
        assert_eq!(package[shared.clone()], before[shared]);
        assert_eq!(package[tombstone_range(starts[2])], TOMBSTONE);

        let mut package = before.clone();
        assert!(remove_items(&mut package, &[], &[1..2]).unwrap().is_empty());
        assert_eq!(package, before);
    }

    #[test]
    fn rejects_malformed_header() {
        check_malformed(&[0; 31], &[], &[]);
        check_edit_malformed(|package| package[3] = 0x28);
        check_edit_malformed(|package| package[8] = 1);
        check_edit_malformed(|package| package[9] = 1);
        check_edit_malformed(|package| package[15] = b'X');
        check_edit_malformed(|package| package[16] = 2);
        check_edit_malformed(|package| package[..2].copy_from_slice(&u16::MAX.to_le_bytes()));
        check_edit_malformed(|package| package[..2].copy_from_slice(&19u16.to_le_bytes()));
        check_edit_malformed(|package| put_u32(package, HEADER_SIZE, u32::MAX));
    }

    #[test]
    fn rejects_malformed_entries() {
        check_edit_malformed(|package| {
            let first = u32_at(package, data_field(0)).unwrap();
            put_u32(package, data_field(1), first - 1);
        });
        check_edit_malformed(|package| {
            let limit = (package.len() - HEADER_SIZE) as u32;
            put_u32(package, data_field(4), limit + 1);
        });
        check_edit_malformed(|package| put_u32(package, data_field(0), 4));
        check_edit_malformed(|package| put_u32(package, name_field(0), 4));
        check_edit_malformed(|package| {
            let limit = (package.len() - HEADER_SIZE) as u32;
            put_u32(package, name_field(0), limit);
        });
        check_edit_malformed(|package| {
            let limit = (package.len() - HEADER_SIZE) as u32;
            put_u32(package, name_field(0), limit - 1);
        });
    }

    #[test]
    fn rejects_malformed_runs() {
        let package = package_of(&FIVE_ITEMS, HEADER_SIZE);
        let malformed_runs: [&[Range<u32>]; 4] = [&[4..6], &[0..2, 1..3], &[1..1], &[2..3, 0..1]];
        for runs in malformed_runs {
            check_malformed(&package, runs, &[]);
            check_malformed(&package, &[], runs);
        }
    }

    #[test]
    fn index_in_both_lists_is_malformed() {
        let package = package_of(&FIVE_ITEMS, HEADER_SIZE);
        check_malformed(&package, &[1..3], &[2..4]);
        check_malformed(&package, &[2..4], &[1..3]);
        check_malformed(&package, &[0..5], &[2..3]);
        check_malformed(&package, &[0..1, 3..4], &[1..2, 3..4]);
    }
}
