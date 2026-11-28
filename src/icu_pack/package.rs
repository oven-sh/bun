//! Puts the items together.

use crate::codes::to_bytes;
use bun_icu_format::locales::File;
use bun_icu_format::package::{ALIGNMENT, COLUMNS, MAGIC, MAX_UNITS, Package};
use std::collections::BTreeMap;

/// An item that is found by a path.
pub(crate) struct Named {
    pub(crate) bytes: Vec<u8>,
    pub(crate) files: Vec<Entry>,
    pub(crate) is_squeezed: bool,
}

pub(crate) struct Entry {
    pub(crate) path: String,
    pub(crate) root: u32,
    pub(crate) no_fallback: bool,
}

/// `items` have their indexes.
pub(crate) fn directory<'a>(items: impl Iterator<Item = (usize, &'a Named)>) -> Vec<u8> {
    let files = items.flat_map(|(item, it)| {
        it.files
            .iter()
            .map(move |file| (item, file, it.is_squeezed))
    });
    let files: BTreeMap<_, _> = files.map(|it| (it.1.path.as_bytes(), it)).collect();
    let (mut words, mut paths) = (vec![files.len() as u16], Vec::new());
    let first_path = 2 * (1 + File::WORDS * files.len());
    for (path, (item, file, is_squeezed)) in files {
        assert!(item < File::SQUEEZED.into());
        let flag = if file.no_fallback {
            File::NO_FALLBACK
        } else {
            0
        } | if is_squeezed { File::SQUEEZED } else { 0 };
        let name = u16::try_from(first_path + paths.len()).expect("16 bits");
        let root = [file.root as u16, (file.root >> 16) as u16];
        words.extend([name, item as u16 | flag].into_iter().chain(root));
        paths.extend(path.iter().chain([&0]));
    }
    [to_bytes(&words), paths].concat()
}

pub(crate) fn assemble(before: &[&[u8]], cells: &[Vec<u8>], after: &[&[u8]]) -> Vec<u8> {
    let (units, count) = (
        cells.len() / COLUMNS,
        before.len() + cells.len() + after.len(),
    );
    assert!(units <= MAX_UNITS);
    let mut package = MAGIC.to_vec();
    package.extend(to_bytes(&[before.len() as u16, units as u16]));
    package.extend((count as u32).to_le_bytes());
    package.resize(Package::offset_field(count + 1), 0);
    let [before, after] = [before, after].map(|it| it.iter().map(|&it| (it, ALIGNMENT)));
    let cells = cells.iter().map(|it| (&it[..], 1));
    let items = before.chain(cells).chain(after);
    for (index, (item, alignment)) in items.chain([(&[][..], 1)]).enumerate() {
        package.resize(package.len().next_multiple_of(alignment), 0);
        let offset = (package.len() as u32).to_le_bytes();
        package[Package::offset_field(index)..][..4].copy_from_slice(&offset);
        package.extend(item);
    }
    package
}
