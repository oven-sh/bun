use core::ffi::CStr;
use core::ops::Range;

use crate::bytes::{narrow, put_u32, slice, slice_mut, u8_at, u16_at, u32_at};
use crate::{Error, Result};

const COUNT: usize = 4;
const ENTRY: usize = 8;
const ALIGNMENT: usize = 16;
const PADDING: u8 = 0xaa;

fn header_size(package: &[u8]) -> Result<usize> {
    let size = usize::from(u16_at(package, 0)?);
    let is_little_endian = u8_at(package, 8)? == 0;
    let is_common_data = slice(package, 2, 2)? == [0xda, 0x27]
        && slice(package, 12, 4)? == b"CmnD"
        && u8_at(package, 16)? == 1;
    if is_common_data && is_little_endian && size.is_multiple_of(ALIGNMENT) {
        Ok(size)
    } else {
        Err(Error::InvalidExecutable)
    }
}

struct Item {
    name: usize,
    data: Range<usize>,
}

pub(crate) fn without_items(
    package: &mut [u8],
    is_left_out: impl Fn(usize) -> bool,
) -> Result<usize> {
    let header = header_size(package)?;
    let contents = package.get_mut(header..).ok_or(Error::InvalidExecutable)?;
    let count = u32_at(contents, 0)? as usize;
    let mut names = Vec::new();
    let mut kept = Vec::new();
    for index in 0..count {
        let entry = COUNT + index * ENTRY;
        let start = u32_at(contents, entry + 4)? as usize;
        let end = if index + 1 < count {
            u32_at(contents, entry + ENTRY + 4)? as usize
        } else {
            contents.len()
        };
        if !start.is_multiple_of(ALIGNMENT) || start > end || end > contents.len() {
            return Err(Error::InvalidExecutable);
        }
        if is_left_out(index) {
            continue;
        }
        let name = contents
            .get(u32_at(contents, entry)? as usize..)
            .unwrap_or_default();
        let name = CStr::from_bytes_until_nul(name).map_err(|_| Error::InvalidExecutable)?;
        kept.push(Item {
            name: names.len(),
            data: start..end,
        });
        names.extend_from_slice(name.to_bytes_with_nul());
    }
    if kept.len() == count {
        return Ok(package.len());
    }

    let first_name = COUNT + kept.len() * ENTRY;
    let mut end = first_name + names.len();
    if kept.first().is_some_and(|item| end > item.data.start) {
        return Err(Error::InvalidExecutable);
    }
    put_u32(contents, 0, narrow(kept.len() as u64)?)?;
    slice_mut(contents, first_name, names.len())?.copy_from_slice(&names);
    for (index, item) in kept.iter().enumerate() {
        let start = end.next_multiple_of(ALIGNMENT);
        if start > item.data.start {
            return Err(Error::InvalidExecutable);
        }
        slice_mut(contents, end, start - end)?.fill(PADDING);
        put_u32(
            contents,
            COUNT + index * ENTRY,
            narrow((first_name + item.name) as u64)?,
        )?;
        put_u32(contents, COUNT + index * ENTRY + 4, narrow(start as u64)?)?;
        contents.copy_within(item.data.clone(), start);
        end = start + item.data.len();
    }
    Ok(header + end)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const HEADER: usize = 32;

    pub(crate) fn package_of(items: &[(&str, &[u8])]) -> Vec<u8> {
        let mut package = vec![0; HEADER];
        package[..4].copy_from_slice(&[HEADER as u8, 0, 0xda, 0x27]);
        package[12..17].copy_from_slice(b"CmnD\x01");
        package.extend_from_slice(&(items.len() as u32).to_le_bytes());
        package.resize(HEADER + COUNT + items.len() * ENTRY, 0);
        for (index, (name, _)) in items.iter().enumerate() {
            let at = (package.len() - HEADER) as u32;
            package[HEADER + COUNT + index * ENTRY..][..4].copy_from_slice(&at.to_le_bytes());
            package.extend_from_slice(name.as_bytes());
            package.push(0);
        }
        for (index, (_, data)) in items.iter().enumerate() {
            package.resize(package.len().next_multiple_of(ALIGNMENT), PADDING);
            let at = (package.len() - HEADER) as u32;
            package[HEADER + COUNT + index * ENTRY + 4..][..4].copy_from_slice(&at.to_le_bytes());
            package.extend_from_slice(data);
        }
        package
    }

    const ITEMS: [(&str, &[u8]); 5] = [
        ("icudt75l/coll/de.res", &[1; 40]),
        ("icudt75l/coll/root.res", &[2; 16]),
        ("icudt75l/en.res", &[3; 100]),
        ("icudt75l/ibm-37_P100-1995.cnv", &[4; 5000]),
        ("icudt75l/zoneinfo64.res", &[5; 33]),
    ];

    fn keeping(kept: &[usize]) -> Vec<u8> {
        let mut package = package_of(&ITEMS);
        let length = without_items(&mut package, |index| !kept.contains(&index)).unwrap();
        package.truncate(length);
        package
    }

    fn only(kept: &[usize]) -> Vec<u8> {
        let mut package = package_of(&kept.iter().map(|&index| ITEMS[index]).collect::<Vec<_>>());
        if kept.last().is_some_and(|&last| last + 1 < ITEMS.len()) {
            package.resize(package.len().next_multiple_of(ALIGNMENT), PADDING);
        }
        package
    }

    #[test]
    fn what_stays_is_the_package_that_icu_would_have_made_of_it() {
        for kept in [
            &[0, 1, 2, 3][..],
            &[1, 2, 3, 4],
            &[0, 2, 4],
            &[2],
            &[4],
            &[0],
            &[3, 4],
            &[],
        ] {
            assert_eq!(keeping(kept), only(kept), "{kept:?}");
        }
    }

    #[test]
    fn a_package_that_loses_nothing_is_not_touched() {
        let whole = package_of(&ITEMS);
        let mut package = whole.clone();
        assert_eq!(without_items(&mut package, |_| false), Ok(whole.len()));
        assert_eq!(package, whole);
    }

    #[test]
    fn the_last_item_ends_where_the_package_ends() {
        let mut package = package_of(&ITEMS);
        package.extend_from_slice(&[6; 7]);
        let length = without_items(&mut package, |index| index != 4).unwrap();
        assert_eq!(
            package[length - 40..length],
            [&[5; 33][..], &[6; 7]].concat()
        );
    }

    #[test]
    fn something_else_is_refused() {
        let refused = |change: fn(&mut Vec<u8>)| {
            let mut package = package_of(&ITEMS);
            change(&mut package);
            without_items(&mut package, |index| index == 0)
        };
        assert!(refused(|_| {}).is_ok());
        assert_eq!(
            refused(|package| package[2] = 0),
            Err(Error::InvalidExecutable)
        );
        assert_eq!(
            refused(|package| package[8] = 1),
            Err(Error::InvalidExecutable)
        );
        assert_eq!(
            refused(|package| package[12] = b'R'),
            Err(Error::InvalidExecutable)
        );
        assert_eq!(
            refused(|package| package[16] = 2),
            Err(Error::InvalidExecutable)
        );
        assert_eq!(
            refused(|package| package[0] = 24),
            Err(Error::InvalidExecutable)
        );
        assert_eq!(
            refused(|package| package.truncate(10)),
            Err(Error::InvalidExecutable)
        );
        assert_eq!(
            refused(|package| package.truncate(HEADER + 20)),
            Err(Error::InvalidExecutable)
        );
    }

    #[test]
    fn offsets_that_cannot_be_are_refused() {
        let with_entry = |index: usize, field: usize, value: u32| {
            let mut package = package_of(&ITEMS);
            package[HEADER + COUNT + index * ENTRY + field..][..4]
                .copy_from_slice(&value.to_le_bytes());
            without_items(&mut package, |index| index == 0)
        };
        assert_eq!(with_entry(2, 4, !15), Err(Error::InvalidExecutable));
        assert_eq!(with_entry(2, 4, 0), Err(Error::InvalidExecutable));
        assert_eq!(with_entry(2, 4, 200 + 1), Err(Error::InvalidExecutable));
        assert_eq!(with_entry(1, 4, 16), Err(Error::InvalidExecutable));
        assert_eq!(with_entry(2, 0, u32::MAX), Err(Error::InvalidExecutable));
        let mut unending = package_of(&ITEMS);
        let last = unending.len() - 1;
        unending[HEADER + COUNT + 4 * ENTRY..][..4]
            .copy_from_slice(&((last - HEADER) as u32).to_le_bytes());
        assert_eq!(
            without_items(&mut unending, |index| index == 0),
            Err(Error::InvalidExecutable)
        );
    }

    #[test]
    fn more_entries_than_there_are_bytes_for() {
        let mut package = package_of(&ITEMS);
        package[HEADER..HEADER + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            without_items(&mut package, |index| index == 0),
            Err(Error::InvalidExecutable)
        );
    }
}
