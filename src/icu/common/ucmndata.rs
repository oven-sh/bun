//! A package of data in a file. Bytes past the end read as 0. ICU4C: ucmndata.cpp

use crate::common::bytes::U_IS_BIG_ENDIAN;
use crate::common::udata::UDataInfo;
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};
use std::cmp::Ordering;

#[derive(Clone, Copy)]
pub(crate) struct Package<'a> {
    /// `uint32_t count`, `{ uint32_t nameOffset, dataOffset; }[count]` from `count` on, the sorted names, the items.
    toc: &'a [u8],
    count: usize,
}

fn zero_padded<const N: usize>(file: &[u8], at: usize) -> [u8; N] {
    let rest = file.get(at..).unwrap_or_default();
    std::array::from_fn(|index| rest.get(index).copied().unwrap_or(0))
}

impl<'a> Package<'a> {
    pub(crate) fn new(file: &'a [u8]) -> Result<Self, UErrorCode> {
        let (info, header_size) = UDataInfo::with_header_size(&zero_padded::<24>(file, 0))
            .ok_or(U_INVALID_FORMAT_ERROR)?;
        let toc = file.get(header_size..).unwrap_or_default();
        // With a negative count only entry 0 is found.
        let count = usize::try_from(i32::from_ne_bytes(zero_padded(toc, 0))).unwrap_or(1);
        // A file has no valid addresses, so a table of pointers has to be empty.
        if info.is_big_endian == U_IS_BIG_ENDIAN
            && info.charset_family == 0
            && info.format_version[0] == 1
            && matches!((&info.data_format, count), (b"CmnD", _) | (b"ToCP", 0))
        {
            Ok(Self { toc, count })
        } else {
            Err(U_INVALID_FORMAT_ERROR)
        }
    }
}

impl Package<'static> {
    /// Returns the item with its header.
    pub(crate) fn find(self, name: &[u8]) -> Option<&'static [u8]> {
        let Self { toc, count } = self;
        let word = |index: usize, at| u32::from_ne_bytes(zero_padded(toc, index * 8 + at));
        let index = prefix_binary_search(name, count, |index| {
            toc.get(word(index, 4) as usize..).unwrap_or_default()
        })?;
        let start = word(index, 8);
        let rest = toc.get(start as usize..).unwrap_or_default();
        let header_size = UDataInfo::split_item(rest)
            .map_or(0, |(_, memory)| (rest.len() - memory.len()).max(24));
        // The item ends with the file unless the next one starts between the end of the header and that of the file.
        let length = (index + 1 < count)
            .then(|| word(index, 16).checked_sub(start))
            .flatten()
            .map(|length| length as usize)
            .filter(|&length| length >= header_size);
        let item = length.and_then(|length| rest.get(..length));
        Some(item.unwrap_or(rest))
    }
}

/// `name_at(index)` begins with the name of that entry. ICU4C: ucmndata.cpp, offsetTOCPrefixBinarySearch
fn prefix_binary_search<'a>(
    name: &[u8],
    count: usize,
    name_at: impl Fn(usize) -> &'a [u8],
) -> Option<usize> {
    // strcmpAfterPrefix
    let compare = |index: usize, prefix: &mut usize| {
        let entry_name = name_at(index);
        loop {
            let [c1, c2] = [name, entry_name].map(|it| it.get(*prefix).copied().unwrap_or(0));
            if c1 != c2 || c1 == 0 {
                return c1.cmp(&c2);
            }
            *prefix += 1;
        }
    };
    let (mut start, mut limit) = (1, count.checked_sub(1)?);
    let (mut start_prefix, mut limit_prefix) = (0, 0);
    if compare(0, &mut start_prefix).is_eq() {
        return Some(0);
    }
    if compare(limit, &mut limit_prefix).is_eq() {
        return Some(limit);
    }
    while start < limit {
        let middle = start + (limit - start) / 2;
        let mut prefix = start_prefix.min(limit_prefix);
        match compare(middle, &mut prefix) {
            Ordering::Less => (limit, limit_prefix) = (middle, prefix),
            Ordering::Greater => (start, start_prefix) = (middle + 1, prefix),
            Ordering::Equal => return Some(middle),
        }
    }
    None
}
