//! Reads ICU's package and its resource bundles.

use std::collections::BTreeMap;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Res<'a> {
    String(Vec<u16>),
    Alias(Vec<u16>),
    Int(i32),
    Ints(Vec<i32>),
    Binary(Vec<u8>),
    Array(Vec<Res<'a>>),
    /// Sorted by key.
    Table(Vec<(&'a str, Res<'a>)>),
}

impl<'a> Res<'a> {
    pub(crate) fn get(&self, key: &str) -> Option<&Self> {
        let Self::Table(items) = self else {
            return None;
        };
        let index = items.binary_search_by_key(&key, |item| item.0).ok()?;
        Some(&items[index].1)
    }

    pub(crate) fn items_mut(&mut self, key: &str) -> Vec<&mut Self> {
        let Self::Table(items) = self else {
            return Vec::new();
        };
        match items.iter_mut().find(|it| it.0 == key) {
            Some((_, Self::Table(items))) => items.iter_mut().map(|it| &mut it.1).collect(),
            Some((_, Self::Array(items))) => items.iter_mut().collect(),
            _ => Vec::new(),
        }
    }

    pub(crate) fn at(&self, path: &[&str]) -> Option<&Self> {
        path.iter().try_fold(self, |res, key| res.get(key))
    }

    pub(crate) fn binaries(&mut self) -> Vec<&mut Vec<u8>> {
        match self {
            Self::Binary(bytes) => vec![bytes],
            Self::Table(items) => items.iter_mut().flat_map(|it| it.1.binaries()).collect(),
            _ => Vec::new(),
        }
    }

    pub(crate) fn for_each_key(&self, f: &mut impl FnMut(&'a str)) {
        match self {
            Self::Array(items) => items.iter().for_each(|item| item.for_each_key(f)),
            Self::Table(items) => items.iter().for_each(|(key, item)| {
                f(key);
                item.for_each_key(f);
            }),
            _ => {}
        }
    }
}

pub(crate) struct Bundle<'a> {
    /// Empty for the main tree.
    pub(crate) tree: &'a str,
    pub(crate) name: &'a str,
    pub(crate) no_fallback: bool,
    pub(crate) root: Res<'a>,
}

pub(crate) fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

pub(crate) fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(*bytes[at..].first_chunk().expect("four bytes"))
}

fn c_string(bytes: &[u8], at: usize) -> &str {
    let length = bytes[at..].iter().take_while(|&&byte| byte != 0).count();
    str::from_utf8(&bytes[at..at + length]).expect("ASCII")
}

/// Splits at the first `separator`, which is ASCII.
pub(crate) fn split_once(text: &str, separator: u8) -> Option<(&str, &str)> {
    let at = text.bytes().take_while(|&byte| byte != separator).count();
    (at < text.len()).then(|| (&text[..at], &text[at + 1..]))
}

/// Returns the items by their paths, such as "coll/de.res".
pub(crate) fn read_package(package: &[u8]) -> BTreeMap<&str, &[u8]> {
    assert!(&package[12..16] == b"CmnD" && package[8] == 0);
    let toc = &package[usize::from(u16_at(package, 0))..];
    let count = u32_at(toc, 0) as usize;
    let start_of = |i: usize| {
        if i < count {
            u32_at(toc, 8 + 8 * i) as usize
        } else {
            toc.len()
        }
    };
    let item = |i: usize| {
        let name = c_string(toc, u32_at(toc, 4 + 8 * i) as usize);
        let path = split_once(name, b'/').expect("a prefix").1;
        (path, &toc[start_of(i)..start_of(i + 1)])
    };
    (0..count).map(item).collect()
}

/// Returns the header and the rest.
pub(crate) fn split_header(item: &[u8]) -> (&[u8], &[u8]) {
    item.split_at(u16_at(item, 0).into())
}

#[derive(Default)]
struct File<'a> {
    bytes: &'a [u8],
    units: &'a [u8],
    pool_keys: &'a [u8],
    pool_units: &'a [u8],
    /// The offsets from here on lead to the pool.
    key_limit: usize,
    /// The offsets up to here lead to the pool.
    pool_string_limit: usize,
    pool_string16_limit: usize,
}

fn index(bytes: &[u8], index: usize) -> usize {
    u32_at(bytes, 4 + 4 * index) as usize
}

fn attributes(bytes: &[u8]) -> usize {
    index(bytes, 5)
}

fn utf16(bytes: &[u8], length: usize) -> Vec<u16> {
    (0..length).map(|i| u16_at(bytes, 2 * i)).collect()
}

impl<'a> File<'a> {
    fn new(bytes: &'a [u8], pool: Option<&'a [u8]>) -> Self {
        let keys_start = |bytes| 4 * (1 + (index(bytes, 0) & 0xff));
        let keys_end = |bytes| 4 * index(bytes, 1);
        let has_keys = keys_end(bytes) > keys_start(bytes);
        Self {
            bytes,
            units: &bytes[keys_end(bytes)..],
            pool_keys: pool.map_or(&[], |it| &it[keys_start(it)..]),
            pool_units: pool.map_or(&[], |it| &it[keys_end(it)..]),
            key_limit: if has_keys { keys_end(bytes) } else { 0 },
            pool_string_limit: index(bytes, 0) >> 8 | (attributes(bytes) & 0xf000) << 12,
            pool_string16_limit: attributes(bytes) >> 16,
        }
    }

    fn key16(&self, offset: u16) -> &'a str {
        match usize::from(offset).checked_sub(self.key_limit) {
            Some(offset) => c_string(self.pool_keys, offset),
            None => c_string(self.bytes, offset.into()),
        }
    }

    fn string16(&self, offset: u16) -> Res<'a> {
        let offset = usize::from(offset);
        let local = offset.checked_sub(self.pool_string16_limit);
        self.string(local.map_or(offset, |local| local + self.pool_string_limit))
    }

    fn string(&self, offset: usize) -> Res<'a> {
        let text = match offset.checked_sub(self.pool_string_limit) {
            Some(local) => &self.units[2 * local..],
            None => &self.pool_units[2 * offset..],
        };
        let unit = |i: usize| usize::from(u16_at(text, 2 * i));
        let (start, length) = match unit(0) {
            ..0xdc00 | 0xe000.. => (0, (0..).take_while(|&i| unit(i) != 0).count()),
            first @ ..0xdfef => (1, first & 0x3ff),
            first @ ..=0xdffe => (2, (first - 0xdfef) << 16 | unit(1)),
            _ => (3, unit(1) << 16 | unit(2)),
        };
        Res::String(utf16(&text[2 * start..], length))
    }

    fn read(&self, res: u32) -> Res<'a> {
        let (type_, offset) = (res >> 28, (res & 0x0fff_ffff) as usize);
        let at = |offset| {
            if offset == 0 {
                &[0; 8]
            } else {
                &self.bytes[4 * offset..]
            }
        };
        let counted = || (u32_at(at(offset), 0) as usize, &at(offset)[4..]);
        let counted16 = || {
            let units = &self.units[2 * offset..];
            (usize::from(u16_at(units, 0)), &units[2..])
        };
        match type_ {
            0 => Res::String(utf16(counted().1, counted().0)),
            1 => Res::Binary(counted().1[..counted().0].to_vec()),
            2 => {
                let (count, keys) = (usize::from(u16_at(at(offset), 0)), &at(offset)[2..]);
                let items = &at(offset)[4 * (1 + count / 2)..];
                let key = |i: usize| self.key16(u16_at(keys, 2 * i));
                let item = |i: usize| self.read(u32_at(items, 4 * i));
                Res::Table((0..count).map(|i| (key(i), item(i))).collect())
            }
            3 => Res::Alias(utf16(counted().1, counted().0)),
            5 => {
                let (count, rest) = counted16();
                let key = |i: usize| self.key16(u16_at(rest, 2 * i));
                let item = |i: usize| self.string16(u16_at(rest, 2 * (count + i)));
                Res::Table((0..count).map(|i| (key(i), item(i))).collect())
            }
            6 => self.string(offset),
            7 => Res::Int((res << 4).cast_signed() >> 4),
            8 => {
                let (count, items) = counted();
                Res::Array(
                    (0..count)
                        .map(|i| self.read(u32_at(items, 4 * i)))
                        .collect(),
                )
            }
            9 => {
                let (count, items) = counted16();
                Res::Array(
                    (0..count)
                        .map(|i| self.string16(u16_at(items, 2 * i)))
                        .collect(),
                )
            }
            14 => {
                let (count, items) = counted();
                Res::Ints(
                    (0..count)
                        .map(|i| u32_at(items, 4 * i).cast_signed())
                        .collect(),
                )
            }
            _ => panic!("a resource of type {type_}"),
        }
    }
}

pub(crate) fn read_bundles<'a>(items: &BTreeMap<&'a str, &'a [u8]>) -> Vec<Bundle<'a>> {
    const NO_FALLBACK: usize = 1;
    let names = items.iter().filter_map(|(path, item)| {
        let path = path.strip_suffix(".res")?;
        let (tree, name) = split_once(path, b'/').unwrap_or(("", path));
        Some((tree, name, split_header(item).1))
    });
    let pools: BTreeMap<_, _> = (names.clone())
        .filter(|&(_, name, _)| name == "pool")
        .map(|(tree, _, bytes)| (tree, bytes))
        .collect();
    let bundles = names.filter(|&(_, name, _)| name != "pool");
    let bundles = bundles.map(|(tree, name, bytes)| {
        let file = File::new(bytes, pools.get(tree).copied());
        Bundle {
            tree,
            name,
            no_fallback: attributes(bytes) & NO_FALLBACK != 0,
            root: file.read(u32_at(bytes, 0)),
        }
    });
    bundles.collect()
}

/// Reads what `image::write_image` has written.
pub(crate) fn read_image<'a>(image: &'a [u8], keys: &'a [u8], root: u32) -> Res<'a> {
    let file = File {
        bytes: image,
        units: image,
        pool_keys: keys,
        ..File::default()
    };
    file.read(root)
}
