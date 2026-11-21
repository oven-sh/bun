//! The linked package of data. Its length is not known and `--trim` removes pages from it, so no slice covers more than one item.

use crate::common::memory::set_oom;
use std::cmp::Ordering;
use std::ffi::c_void;

unsafe extern "C" {
    /// A `DataHeader`, `uint32_t count`, `{ uint32_t nameOffset, dataOffset; }[count]` from `count` on, the sorted names, the items. The tests fill theirs in.
    static mut icudt79_dat: u8;

    /// Returns `item`, or what it decompresses to, with its `length`. Ends the process if `--trim` removed the item.
    fn bun_icu_maybe_decompress(item: *const c_void, length: &mut i32) -> *const c_void;
}

/// `DataHeader { uint16_t headerSize; uint8_t magic1, magic2; UDataInfo info; }`
type DataHeader = [u8; 24];

/// SAFETY: The `N` bytes at `data` are readable.
unsafe fn bytes_at<const N: usize>(data: *const u8) -> [u8; N] {
    // SAFETY: an array of bytes needs no alignment.
    unsafe { data.cast::<[u8; N]>().read() }
}

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];

/// Returns the item with its header. Returns `None` if it is missing, or if allocation fails.
pub(crate) fn find(name: &[u8]) -> Option<&'static [u8]> {
    let package = &raw const icudt79_dat;
    // SAFETY: the symbol has the layout above. The names are sorted, so each is at least as long as the prefix that the
    // search skips.
    let (item, mut length) = unsafe {
        let toc = package.add(u16::from_ne_bytes(bytes_at(package)).into());
        let word = |index: usize| u32::from_ne_bytes(bytes_at(toc.add(4 * index)));
        let count = word(0) as usize;
        let index = prefix_binary_search(name, count, |index| {
            let name = toc.add(word(1 + 2 * index) as usize);
            move |at| name.add(at).read()
        })?;
        let start = word(2 + 2 * index);
        let length = if index + 1 < count {
            word(4 + 2 * index).wrapping_sub(start).cast_signed()
        } else {
            -1
        };
        (toc.add(start as usize), length)
    };
    // SAFETY: `item` is an item of the package. What replaces it has `length` bytes for good.
    unsafe {
        let result = bun_icu_maybe_decompress(item.cast(), &mut length).cast::<u8>();
        let length = if result != item {
            length as usize
        } else if bytes_at(item) == ZSTD_MAGIC {
            // Sound data stay compressed only for want of memory.
            set_oom(());
            return None;
        } else {
            stated_length(item).min(length as u32 as usize)
        };
        Some(std::slice::from_raw_parts(result, length))
    }
}

pub(crate) const RBBI_DATA_FORMAT: u8 = 7;

/// Returns the size of collation data after the header: the last index, or the size of the indexes if it has no parts.
fn collation_data_size(index: impl Fn(usize) -> usize) -> usize {
    const IX_REORDER_CODES_OFFSET: usize = 5;
    const IX_TOTAL_SIZE: usize = 19;
    let count = index(0).min(IX_TOTAL_SIZE + 1);
    if count > IX_REORDER_CODES_OFFSET {
        index(count - 1).max(count * 4)
    } else {
        count * 4
    }
}

/// Returns the length that the item states, or 0 if the format is not known.
/// SAFETY: `item` is an item of the package.
unsafe fn stated_length(item: *const u8) -> usize {
    // SAFETY: an item with the magic bytes has a header. The formats start with `int32_t indexes[]`, and have the
    // indexes that are read.
    unsafe {
        let [size0, size1, 0xda, 0x27] = bytes_at(item) else {
            return 0;
        };
        let [
            ..,
            format0,
            format1,
            format2,
            format3,
            major,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
        ]: DataHeader = bytes_at(item);
        let header_size = usize::from(u16::from_ne_bytes([size0, size1]));
        let index =
            |index: usize| u32::from_ne_bytes(bytes_at(item.add(header_size + 4 * index))) as usize;
        header_size
            + match (&[format0, format1, format2, format3], major) {
                // URES_INDEX_BUNDLE_TOP, after the root
                (b"ResB", 2..=3) => 4 * index(1 + 3),
                // IX_TOTAL_SIZE
                (b"Nrm2", 5) => index(7),
                (b"Emoj", 1) => index(13),
                (b"Brk ", RBBI_DATA_FORMAT) => index(2),
                (b"Dict", _) => index(3),
                (b"UCol", 5) => collation_data_size(index),
                _ => return 0,
            }
    }
}

/// `name_at(index)` maps an offset in the name of that entry to the byte. ICU4C: ucmndata.cpp, offsetTOCPrefixBinarySearch
fn prefix_binary_search<N: Fn(usize) -> u8>(
    name: &[u8],
    count: usize,
    name_at: impl Fn(usize) -> N,
) -> Option<usize> {
    // strcmpAfterPrefix
    let compare = |index: usize, prefix: &mut usize| {
        let entry_name = name_at(index);
        loop {
            let (c1, c2) = (name.get(*prefix).copied().unwrap_or(0), entry_name(*prefix));
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
