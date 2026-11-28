use core::ops::Range;

use bun_icu_format::bundles::Bundles;
use bun_icu_format::package::{
    ALIGNMENT, COLUMNS, FIRST_TREE_COLUMN, HEADER_SIZE, MAGIC, MODEL_COLUMN, Package, REMOVED,
    TOMBSTONED, TREES,
};

use crate::error::TrimInternalError;

struct PlannedItem {
    flags: u32,
    /// Empty if nothing reads the item any more.
    from: Range<usize>,
    to: usize,
}

struct PlannedRemoval {
    items: Vec<PlannedItem>,
    end: usize,
}

/// What `remove_items` would return. Changes nothing.
pub(crate) fn find_dead_range(
    package: &[u8],
    removed_items: &[Range<u32>],
    tombstoned_items: &[Range<u32>],
) -> Result<Range<u32>, TrimInternalError> {
    let removal = plan_removal(package, removed_items, tombstoned_items)
        .ok_or(TrimInternalError::MalformedIcuData)?;
    Ok(removal.end as u32..package.len() as u32)
}

/// Moves the items that are still read to the front, and returns the range of `package` after them.
pub(crate) fn remove_items(
    package: &mut [u8],
    removed_items: &[Range<u32>],
    tombstoned_items: &[Range<u32>],
) -> Result<Range<u32>, TrimInternalError> {
    let removal = plan_removal(package, removed_items, tombstoned_items)
        .ok_or(TrimInternalError::MalformedIcuData)?;
    let set_field = |package: &mut [u8], item: usize, value: u32| {
        package[Package::offset_field(item)..][..4].copy_from_slice(&value.to_le_bytes());
    };
    let mut end = removal.items.first().map_or(removal.end, |item| item.to);
    for (index, item) in removal.items.iter().enumerate() {
        package[end..item.to].fill(0);
        package.copy_within(item.from.clone(), item.to);
        set_field(package, index, item.to as u32 | item.flags);
        end = item.to + item.from.len();
    }
    set_field(package, removal.items.len(), removal.end as u32);
    Ok(removal.end as u32..package.len() as u32)
}

fn plan_removal(
    bytes: &[u8],
    removed_items: &[Range<u32>],
    tombstoned_items: &[Range<u32>],
) -> Option<PlannedRemoval> {
    let package = checked_package(bytes)?;
    let mut flags = vec![0; package.count()];
    set_flags(&mut flags, removed_items, REMOVED)?;
    set_flags(&mut flags, tombstoned_items, TOMBSTONED)?;
    let is_read = find_read_items(package, &flags)?;
    let cells = package.first_cell()..package.cell(package.units(), 0);
    let mut end = package.offset(0);
    let items = (flags.into_iter().zip(is_read).enumerate()).map(|(item, (flags, is_read))| {
        let start = package.offset(item);
        let from = start..if is_read {
            package.offset(item + 1)
        } else {
            start
        };
        let to = end.next_multiple_of(if cells.contains(&item) { 1 } else { ALIGNMENT });
        end = to + from.len();
        PlannedItem { flags, from, to }
    });
    let items = items.collect();
    Some(PlannedRemoval { items, end })
}

fn checked_package(bytes: &[u8]) -> Option<Package<'_>> {
    let package = Package::new(bytes);
    let (count, cells) = (package.count(), package.units() * COLUMNS);
    let mut end = HEADER_SIZE.checked_add(count.checked_add(1)?.checked_mul(4)?)?;
    if !bytes.starts_with(&MAGIC)
        || bytes.len() >= REMOVED as usize
        || end > bytes.len()
        || package.first_cell() + cells > count
    {
        return None;
    }
    let cells = package.first_cell()..package.first_cell() + cells;
    for item in 0..=count {
        let start = package.offset(item);
        let is_aligned = item == count || cells.contains(&item) || start.is_multiple_of(ALIGNMENT);
        if start < end || !is_aligned || package.flags(item) != 0 {
            return None;
        }
        end = start;
    }
    (end <= bytes.len()).then_some(package)
}

/// Fails unless the runs ascend and have only items without flags.
fn set_flags(flags: &mut [u32], runs: &[Range<u32>], flag: u32) -> Option<()> {
    let mut previous_end = 0;
    for run in runs {
        let of_run = flags.get_mut(run.start as usize..run.end as usize)?;
        if of_run.is_empty() || run.start < previous_end || of_run.iter().any(|&it| it != 0) {
            return None;
        }
        of_run.fill(flag);
        previous_end = run.end;
    }
    Some(())
}

/// The text of a locale is read with the model of its language, and with the text and the models of those that it refers to.
fn find_read_items(package: Package, flags: &[u32]) -> Option<Vec<bool>> {
    let mut is_read: Vec<bool> = flags.iter().map(|&it| it == 0).collect();
    if package.units() == 0 {
        return Some(is_read);
    }
    let bundles = Bundles(package);
    for index in 0..bundles.locales().count() {
        for column in FIRST_TREE_COLUMN..FIRST_TREE_COLUMN + TREES.len() {
            let own = package.cell(bundles.locales().get(index).unit, column);
            if *flags.get(own)? != 0 || package.item(own).is_empty() {
                continue;
            }
            for locale in bundles.levels(index) {
                *is_read.get_mut(package.cell(locale.unit, column))? = true;
                *is_read.get_mut(package.cell(locale.unit, MODEL_COLUMN))? = true;
            }
        }
    }
    Some(is_read)
}

#[cfg(test)]
#[allow(clippy::single_range_in_vec_init)]
pub(crate) mod tests {
    use bun_icu_format::locales::{Link, Locale};
    use bun_icu_format::package::LOCALES;

    use super::*;

    const FIVE_ITEMS: [usize; 5] = [40, 24, 36, 16, 52];

    fn put_u32(bytes: &mut [u8], at: usize, value: u32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn assemble(items: &[Vec<u8>], cells: Range<usize>) -> Vec<u8> {
        let mut package = MAGIC.to_vec();
        package.extend((cells.start as u16).to_le_bytes());
        package.extend(((cells.len() / COLUMNS) as u16).to_le_bytes());
        package.extend((items.len() as u32).to_le_bytes());
        package.resize(Package::offset_field(items.len() + 1), 0);
        for (index, item) in items.iter().enumerate() {
            if !cells.contains(&index) {
                package.resize(package.len().next_multiple_of(ALIGNMENT), 0);
            }
            let offset = package.len() as u32;
            put_u32(&mut package, Package::offset_field(index), offset);
            package.extend(item);
        }
        let end = package.len() as u32;
        put_u32(&mut package, Package::offset_field(items.len()), end);
        package
    }

    fn filled(first: usize, sizes: &[usize]) -> impl Iterator<Item = Vec<u8>> {
        (sizes.iter().zip(first..)).map(|(&size, index)| vec![0x40 + index as u8; size])
    }

    pub(crate) fn package_of(sizes: &[usize]) -> Vec<u8> {
        assemble(&filled(0, sizes).collect::<Vec<_>>(), 0..0)
    }

    const FIRST_CELL: usize = LOCALES + 1;

    /// Has a unit for each locale, whose cells have three bytes each, and then one more item.
    fn package_of_locales(references: &[usize]) -> Vec<u8> {
        let mut locales = (references.len() as u16).to_le_bytes().to_vec();
        for (unit, &reference) in references.iter().enumerate() {
            let locale = Locale {
                unit,
                reference,
                record: 0,
                trees: 0x3f,
                link: Link::default(),
            };
            locales.extend([0; 4].into_iter().chain(locale.pack().to_le_bytes()));
        }
        let cells = FIRST_CELL..FIRST_CELL + references.len() * COLUMNS;
        let mut items = vec![Vec::new(), locales];
        items.extend(filled(cells.start, &vec![3; cells.len()]));
        items.extend(filled(cells.end, &[16]));
        assemble(&items, cells)
    }

    fn cell(unit: usize, column: usize) -> u32 {
        (FIRST_CELL + unit * COLUMNS + column) as u32
    }

    fn without_zeros(item: &[u8]) -> &[u8] {
        let zeros = item.iter().rev().take_while(|&&byte| byte == 0).count();
        &item[..item.len() - zeros]
    }

    /// Returns the items that have lost their bytes, after checking all that holds for every removal.
    fn emptied(before: &[u8], removed: &[Range<u32>], tombstoned: &[Range<u32>]) -> Vec<u32> {
        let mut after = before.to_vec();
        let dead = remove_items(&mut after, removed, tombstoned).unwrap();
        assert_eq!(find_dead_range(before, removed, tombstoned).unwrap(), dead);
        assert_eq!(dead.end as usize, before.len());
        after.truncate(dead.start as usize);
        let (old, new) = (Package::new(before), Package::new(&after));
        assert_eq!(after[..HEADER_SIZE], before[..HEADER_SIZE]);
        assert_eq!(new.offset(new.count()), after.len());
        let cells = old.first_cell()..old.cell(old.units(), 0);
        let mut emptied = Vec::new();
        for item in 0..old.count() {
            let is_in = |runs: &[Range<u32>]| runs.iter().any(|run| run.contains(&(item as u32)));
            let flags = match (is_in(removed), is_in(tombstoned)) {
                (true, _) => REMOVED,
                (_, true) => TOMBSTONED,
                _ => 0,
            };
            assert_eq!(new.flags(item), flags, "{item}");
            assert!(cells.contains(&item) || new.offset(item).is_multiple_of(ALIGNMENT));
            if without_zeros(new.item(item)) != without_zeros(old.item(item)) {
                assert_eq!(without_zeros(new.item(item)), [], "{item}");
                emptied.push(item as u32);
            }
        }
        emptied
    }

    fn check_malformed(package: &[u8], removed: &[Range<u32>], tombstoned: &[Range<u32>]) {
        let mut edited = package.to_vec();
        let result = remove_items(&mut edited, removed, tombstoned);
        assert!(matches!(result, Err(TrimInternalError::MalformedIcuData)));
        assert_eq!(edited, package);
    }

    fn check_edit_malformed(edit: impl FnOnce(&mut Vec<u8>)) {
        let mut package = package_of(&FIVE_ITEMS);
        edit(&mut package);
        check_malformed(&package, &[1..2], &[]);
        check_malformed(&package, &[], &[1..2]);
    }

    #[test]
    fn empties_the_items_of_all_runs() {
        let package = package_of(&FIVE_ITEMS);
        let cases: [(&[Range<u32>], &[Range<u32>], &[u32]); 8] = [
            (&[], &[], &[]),
            (&[0..1], &[], &[0]),
            (&[1..3], &[], &[1, 2]),
            (&[], &[4..5], &[4]),
            (&[0..5], &[], &[0, 1, 2, 3, 4]),
            (&[0..1, 1..2], &[], &[0, 1]),
            (&[0..1, 4..5], &[2..3], &[0, 2, 4]),
            (&[3..4], &[1..3], &[1, 2, 3]),
        ];
        for (removed, tombstoned, expected) in cases {
            assert_eq!(emptied(&package, removed, tombstoned), expected);
        }
    }

    #[test]
    fn dead_range_is_as_long_as_the_emptied_items() {
        let package = package_of(&FIVE_ITEMS);
        let dead = find_dead_range(&package, &[0..1], &[2..3]).unwrap();
        assert_eq!(dead.len(), FIVE_ITEMS[0] + FIVE_ITEMS[2]);
    }

    #[test]
    fn dead_range_has_what_follows_the_last_item() {
        let package = [package_of(&FIVE_ITEMS), vec![0xaa; 12]].concat();
        assert_eq!(find_dead_range(&package, &[], &[]).unwrap().len(), 12);
    }

    #[test]
    fn empty_run_list_changes_nothing() {
        for before in [package_of(&FIVE_ITEMS), package_of_locales(&[0, 0, 1])] {
            let mut package = before.clone();
            assert!(remove_items(&mut package, &[], &[]).unwrap().is_empty());
            assert_eq!(package, before);
        }
    }

    #[test]
    fn language_that_nothing_refers_to_is_emptied() {
        let package = package_of_locales(&[0, 0, 1]);
        let last = cell(2, 0)..cell(3, 0);
        let expected: Vec<_> = last.clone().collect();
        assert_eq!(emptied(&package, &[], &[last]), expected);
    }

    #[test]
    fn languages_that_a_retained_one_refers_to_keep_their_bytes() {
        let package = package_of_locales(&[0, 0, 1, 0]);
        let tombstoned = [cell(0, 0)..cell(2, 0), cell(3, 0)..cell(4, 0)];
        let expected: Vec<_> = tombstoned[1].clone().collect();
        assert_eq!(emptied(&package, &[], &tombstoned), expected);
    }

    #[test]
    fn one_retained_tree_keeps_that_tree_and_the_models() {
        let package = package_of_locales(&[0, 0, 0]);
        let removed = [cell(0, 0)..cell(1, 3), cell(1, 4)..cell(3, 0)];
        let kept = [cell(0, 0), cell(0, 3), cell(1, 0), cell(1, 3)];
        let expected = (cell(0, 0)..cell(3, 0)).filter(|item| !kept.contains(item));
        assert_eq!(
            emptied(&package, &removed, &[]),
            expected.collect::<Vec<_>>()
        );
    }

    #[test]
    fn rejects_unit_that_has_no_cells() {
        let mut package = package_of_locales(&[0]);
        let last_word = Package::new(&package).offset(LOCALES) + 2 * Locale::WORDS;
        package[last_word + 1] = 0xff;
        check_malformed(&package, &[], &[]);
    }

    #[test]
    fn rejects_malformed_header() {
        check_malformed(&MAGIC, &[], &[]);
        check_edit_malformed(|package| package[3] = b'X');
        check_edit_malformed(|package| package[4] = 6);
        check_edit_malformed(|package| package[6] = 1);
        check_edit_malformed(|package| put_u32(package, 8, u32::MAX));
    }

    #[test]
    fn rejects_malformed_offsets() {
        let before = package_of(&FIVE_ITEMS);
        let offset = |item| Package::new(&before).offset(item) as u32;
        for (item, value) in [
            (0, offset(0) - 4),
            (1, offset(0) - 4),
            (1, offset(1) + 1),
            (3, offset(3) | REMOVED),
            (3, offset(3) | TOMBSTONED),
            (5, offset(5) + 1),
        ] {
            check_edit_malformed(|package| put_u32(package, Package::offset_field(item), value));
        }
    }

    #[test]
    fn rejects_malformed_runs() {
        let package = package_of(&FIVE_ITEMS);
        let malformed_runs: [&[Range<u32>]; 4] = [&[4..6], &[0..2, 1..3], &[1..1], &[2..3, 0..1]];
        for runs in malformed_runs {
            check_malformed(&package, runs, &[]);
            check_malformed(&package, &[], runs);
        }
    }

    #[test]
    fn index_in_both_lists_is_malformed() {
        let package = package_of(&FIVE_ITEMS);
        check_malformed(&package, &[1..3], &[2..4]);
        check_malformed(&package, &[2..4], &[1..3]);
        check_malformed(&package, &[0..5], &[2..3]);
        check_malformed(&package, &[0..1, 3..4], &[1..2, 3..4]);
    }
}
