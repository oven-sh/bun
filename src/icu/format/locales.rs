//! The directories: of the names of locales that have packed bundles, and of all other files.

use crate::schema::Target;
use crate::words::Words;
use core::cmp::Ordering;

/// Compares `name` with the key at the start of `key`, which ends with a NUL.
#[inline]
pub fn compare_with_key(name: &[u8], key: &[u8]) -> Ordering {
    if let Some((a, b)) = name.iter().zip(key).find(|(a, b)| a != b) {
        return a.cmp(b);
    }
    match key.get(name.len()) {
        Some(0) => Ordering::Equal,
        Some(_) => Ordering::Less,
        None => Ordering::Greater,
    }
}

#[inline]
fn search(count: usize, compare: impl Fn(usize) -> Ordering) -> Option<usize> {
    let (mut start, mut limit) = (0, count);
    while start < limit {
        let middle = (start + limit) / 2;
        match compare(middle) {
            Ordering::Less => limit = middle,
            Ordering::Greater => start = middle + 1,
            Ordering::Equal => return Some(middle),
        }
    }
    None
}

/// Returns the index of `name` among the sorted keys whose offsets `offset_at` gives.
#[inline]
pub fn search_keys(
    keys: &[u8],
    count: usize,
    name: &[u8],
    offset_at: impl Fn(usize) -> usize,
) -> Option<usize> {
    search(count, |i| {
        compare_with_key(name, keys.get(offset_at(i)..).unwrap_or_default())
    })
}

/// The count, four words for each locale in the order of their names, the strings that links lead to.
#[derive(Clone, Copy)]
pub struct Locales<'a>(Words<'a>);

#[derive(Clone, Copy)]
pub struct Locale {
    pub unit: usize,
    /// The index of the locale whose text predicts the text of this one. English refers to itself.
    pub reference: usize,
    /// The index of its record in a cell.
    pub record: usize,
    /// A bit for each tree that has the bundle.
    pub trees: u8,
    pub link: Link,
}

/// `%%ALIAS` or `%%Parent`, which is the same in all trees: the offset of the string in `Locales::words`, and the kind.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Link(pub u16);

impl Link {
    pub const IS_PARENT: u16 = 1 << 15;

    pub fn exists(self) -> bool {
        self.0 != 0
    }

    /// Returns the offset if `target` is this kind of link.
    pub fn offset_for(self, target: Target) -> Option<u16> {
        let kind = match self.0 & Self::IS_PARENT {
            0 => Target::ALIAS,
            _ => Target::PARENT,
        };
        (self.exists() && target == kind).then_some(self.0 & !Self::IS_PARENT)
    }
}

impl Locale {
    pub const WORDS: usize = 4;

    pub fn pack(self) -> u32 {
        (self.unit << 23 | self.reference << 13 | self.record << 6) as u32 | u32::from(self.trees)
    }
}

impl<'a> Locales<'a> {
    pub fn new(item: &'a [u8]) -> Self {
        Self(Words::of(item))
    }

    pub fn words(self) -> Words<'a> {
        self.0
    }

    pub fn count(self) -> usize {
        self.0.index_at(0)
    }

    pub fn find(self, keys: &[u8], name: &[u8]) -> Option<usize> {
        let name_at = |i| self.0.index_at(1 + Locale::WORDS * i);
        search_keys(keys, self.count(), name, name_at)
    }

    pub fn get(self, index: usize) -> Locale {
        let words = self.0.from(1 + Locale::WORDS * index);
        let packed = words.index_at(2) | words.index_at(3) << 16;
        Locale {
            unit: packed >> 23,
            reference: packed >> 13 & 0x3ff,
            record: packed >> 6 & 0x7f,
            trees: (packed & 0x3f) as u8,
            link: Link(words.at(1)),
        }
    }
}

/// The count, then four words for each file in the order of their paths, such as "coll/de.res".
#[derive(Clone, Copy)]
pub struct Files<'a>(Words<'a>);

#[derive(Clone, Copy)]
pub struct File {
    pub item: usize,
    pub is_squeezed: bool,
    pub kind: FileKind,
}

#[derive(Clone, Copy)]
pub enum FileKind {
    /// The item is the file.
    Plain,
    /// The item has the resources of bundles as `.res` files have them, with a pool of keys (`keys_of`).
    Bundle { root: u32, no_fallback: bool },
}

impl File {
    pub const WORDS: usize = 4;
    pub const NO_FALLBACK: u16 = 1 << 15;
    pub const SQUEEZED: u16 = 1 << 14;
    /// In the place of the root, which is a table.
    pub const PLAIN: u32 = 0;
}

impl<'a> Files<'a> {
    pub fn new(item: &'a [u8]) -> Self {
        Self(Words::of(item))
    }

    pub fn find(self, path: &[u8]) -> Option<File> {
        let name_at = |i| self.0.index_at(1 + File::WORDS * i);
        let index = search_keys(self.0.as_bytes(), self.0.index_at(0), path, name_at)?;
        let words = self.0.from(1 + File::WORDS * index);
        let (item, root) = (
            words.at(1),
            u32::from(words.at(2)) | u32::from(words.at(3)) << 16,
        );
        Some(File {
            item: (item % File::SQUEEZED).into(),
            is_squeezed: item & File::SQUEEZED != 0,
            kind: match root {
                File::PLAIN => FileKind::Plain,
                root => FileKind::Bundle {
                    root,
                    no_fallback: item & File::NO_FALLBACK != 0,
                },
            },
        })
    }
}
