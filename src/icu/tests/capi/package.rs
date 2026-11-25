//! A small package of data in the place of ICU's.

use std::cell::UnsafeCell;
use std::sync::Once;

use bun_icu_format::locales::File;
use bun_icu_format::package::{ALIGNMENT, FILES, MAGIC};

use Resource::{Alias, Array, Int, Ints, Str, Table};

#[derive(Clone, Copy)]
enum Resource {
    Str(&'static str),
    Alias(&'static str),
    Int(u32),
    Ints(&'static [i32]),
    Array(&'static [Resource]),
    /// Sorted by key.
    Table(&'static [(&'static str, Resource)]),
}

const HEADER_SIZE: usize = 32;
/// The root resource and the indexes.
const KEYS_BOTTOM: usize = 4 * 8;

fn header(format: [u8; 4], version: u8) -> Vec<u8> {
    let mut bytes = [HEADER_SIZE as u8, 0, 0xda, 0x27, 20, 0, 0, 0, 0, 0, 2, 0].to_vec();
    bytes.extend(format);
    bytes.push(version);
    bytes.resize(HEADER_SIZE, 0);
    bytes
}

#[derive(Default)]
struct Bundle {
    keys: Vec<u8>,
    units: Vec<u16>,
    /// They start at `base`, which is known once the keys and the units are.
    words: Vec<u32>,
    base: usize,
}

impl Bundle {
    fn add(&mut self, resource: Resource) -> u32 {
        let (kind, words): (u32, Vec<u32>) = match resource {
            Str(text) => {
                let offset = self.units.len() as u32;
                self.units.extend(text.encode_utf16().chain([0]));
                return 6 << 28 | offset;
            }
            Int(value) => return 7 << 28 | value,
            Alias(path) => {
                let units: Vec<u16> = path.encode_utf16().chain([0]).collect();
                (3, [vec![path.len() as u32], in_pairs(&units)].concat())
            }
            Ints(values) => (14, counted(values.iter().map(|&value| value as u32))),
            Array(items) => (8, counted(items.iter().map(|&item| self.add(item)))),
            Table(entries) => {
                let mut units = vec![entries.len() as u16];
                for (key, _) in entries {
                    units.push((KEYS_BOTTOM + self.keys.len()) as u16);
                    self.keys.extend(key.bytes().chain([0]));
                }
                let values = entries.iter().map(|&(_, value)| self.add(value));
                (2, [in_pairs(&units), values.collect()].concat())
            }
        };
        let offset = (self.base + self.words.len()) as u32;
        self.words.extend(words);
        kind << 28 | offset
    }
}

fn counted(words: impl ExactSizeIterator<Item = u32>) -> Vec<u32> {
    std::iter::once(words.len() as u32).chain(words).collect()
}

fn in_pairs(units: &[u16]) -> Vec<u32> {
    let pair = |it: &[u16]| u32::from(it[0]) | u32::from(*it.get(1).unwrap_or(&0)) << 16;
    units.chunks(2).map(pair).collect()
}

const NO_FALLBACK: u32 = 1;

fn bundle(root: Resource, attributes: u32) -> Vec<u8> {
    let write = |base| {
        let mut bundle = Bundle {
            units: vec![0],
            base,
            ..Bundle::default()
        };
        (bundle.add(root), bundle)
    };
    let (_, measured) = write(0);
    let keys_top = (KEYS_BOTTOM + measured.keys.len()).div_ceil(4);
    let units_top = keys_top + measured.units.len().div_ceil(2);
    let (root, written) = write(units_top);
    let top = (units_top + written.words.len()) as u32;
    let (keys, units) = (keys_top as u32, units_top as u32);
    let indexes = [root, 7, keys, top, top, 99, attributes, units];

    let mut bytes = header(*b"ResB", 2);
    bytes.extend(indexes.iter().flat_map(|index| index.to_le_bytes()));
    bytes.extend(&written.keys);
    bytes.resize(HEADER_SIZE + 4 * keys_top, 0xaa);
    let words = [in_pairs(&written.units), written.words].concat();
    bytes.extend(words.iter().flat_map(|word| word.to_le_bytes()));
    bytes
}

const LATIN: Resource = Table(&[
    ("miscPatterns", Table(&[("range", Str("{0}-{1}"))])),
    ("patterns", Table(&[("decimalFormat", Str("#,##0.###"))])),
    (
        "symbols",
        Table(&[
            ("approximatelySign", Str("~")),
            ("decimal", Str(".")),
            ("exponential", Str("E")),
            ("group", Str(",")),
            ("infinity", Str("∞")),
            ("minusSign", Str("-")),
            ("nan", Str("NaN")),
            ("percentSign", Str("%")),
            ("plusSign", Str("+")),
        ]),
    ),
]);

const ROOT: Resource = Table(&[
    (
        "NumberElements",
        Table(&[("default", Str("latn")), ("latn", LATIN)]),
    ),
    (
        "listPattern",
        Table(&[
            ("or", Alias("/LOCALE/listPattern/standard")),
            (
                "standard",
                Table(&[
                    ("2", Str("{0} & {1}")),
                    ("end", Str("{0} & {1}")),
                    ("middle", Str("{0}, {1}")),
                    ("start", Str("{0}, {1}")),
                ]),
            ),
        ]),
    ),
]);

const SPACING: Resource = Table(&[
    ("currencyMatch", Str("[[:^S:]&[:^Z:]]")),
    ("insertBetween", Str(" ")),
    ("surroundingMatch", Str("[:digit:]")),
]);

const CURRENCIES: Resource = Table(&[(
    "currencySpacing",
    Table(&[("afterCurrency", SPACING), ("beforeCurrency", SPACING)]),
)]);

const GERMAN: Resource = Table(&[(
    "NumberElements",
    Table(&[(
        "latn",
        Table(&[(
            "symbols",
            Table(&[("decimal", Str(",")), ("group", Str("."))]),
        )]),
    )]),
)]);

const PLURALS: Resource = Table(&[
    ("locales", Table(&[("de", Str("set0"))])),
    (
        "rules",
        Table(&[(
            "set0",
            Table(&[
                ("one", Str("i = 1 and v = 0 @integer 1")),
                ("other", Str(" @integer 0")),
            ]),
        )]),
    ),
]);

const SUPPLEMENTAL: Resource = Table(&[
    (
        "calendarPreferenceData",
        Table(&[("001", Array(&[Str("gregorian")]))]),
    ),
    ("cldrVersion", Str("49")),
    (
        "weekData",
        Table(&[("001", Ints(&[2, 1, 7, 0, 1, 86_400_000]))]),
    ),
]);

const NUMBERING_SYSTEMS: Resource = Table(&[(
    "numberingSystems",
    Table(&[(
        "latn",
        Table(&[
            ("algorithmic", Int(0)),
            ("desc", Str("0123456789")),
            ("radix", Int(10)),
        ]),
    )]),
)]);

const INDEX: Resource = Table(&[(
    "InstalledLocales",
    Table(&[("de", Str("")), ("en", Str(""))]),
)]);

#[repr(C, align(16))]
struct Package(UnsafeCell<[u8; 4096]>);

// SAFETY: `install` writes it once, before anything reads it.
unsafe impl Sync for Package {}

#[unsafe(export_name = "bun_icu_package")]
static PACKAGE: Package = Package(UnsafeCell::new([0; _]));

/// In the format of ICU. The names are sorted.
#[cfg(not(miri))]
pub(crate) fn package(package: &str, items: &[(impl std::fmt::Display, Vec<u8>)]) -> Vec<u8> {
    let (mut entries, mut rest) = (vec![items.len() as u32], Vec::new());
    let entries_size = 4 + 8 * items.len();
    for (name, _) in items {
        entries.extend([(entries_size + rest.len()) as u32, 0]);
        rest.extend(format!("{package}/{name}\0").bytes());
    }
    for (index, (_, bytes)) in items.iter().enumerate() {
        let offset = (entries_size + rest.len()).next_multiple_of(16);
        rest.resize(offset - entries_size, 0xaa);
        entries[2 + 2 * index] = offset as u32;
        rest.extend(bytes);
    }
    let mut package = header(*b"CmnD", 1);
    package.extend(entries.iter().flat_map(|word| word.to_le_bytes()));
    package.extend(rest);
    package
}

#[cfg(not(miri))]
pub(crate) fn german() -> Vec<u8> {
    bundle(GERMAN, 0)
}

#[cfg(not(miri))]
pub(crate) fn german_of(package: &str) -> Vec<u8> {
    let alias = Alias(format!("/{package}/de/NumberElements").leak());
    bundle(Table(vec![("NumberElements", alias)].leak()), 0)
}

/// Has literal bytes only.
fn squeezed(file: &[u8]) -> Vec<u8> {
    let mut item = vec![0, file.len() as u8 | 0x80, (file.len() >> 7) as u8, 0];
    for literal in file.chunks(32) {
        item.push(literal.len() as u8 - 1);
        item.extend(literal);
    }
    item
}

/// In the format of the linked package. The paths are sorted.
fn linked(files: &[(&str, u16, Vec<u8>)]) -> Vec<u8> {
    let (mut directory, mut paths) = (vec![files.len() as u16], String::new());
    for (item, (path, flags, _)) in (FILES + 1..).zip(files) {
        let name = 2 * (1 + File::WORDS * files.len()) + paths.len();
        directory.extend([name as u16, item as u16 | flags, 0, 0]);
        paths.extend([path, "\0"]);
    }
    let directory = directory.iter().flat_map(|word| word.to_le_bytes());
    let directory: Vec<u8> = directory.chain(paths.bytes()).collect();
    let items = [&[][..], &[], &directory].into_iter();
    let (mut words, mut rest) = (vec![0, (FILES + 1 + files.len()) as u32], Vec::<u8>::new());
    let first = MAGIC.len() + 4 * (words.len() + FILES + 2 + files.len());
    for item in items
        .chain(files.iter().map(|file| &file.2[..]))
        .chain([&[][..]])
    {
        words.push((first + rest.len()) as u32);
        rest.extend(item);
        rest.resize(rest.len().next_multiple_of(ALIGNMENT), 0);
    }
    let words = words.iter().flat_map(|word| word.to_le_bytes());
    MAGIC.into_iter().chain(words).chain(rest).collect()
}

/// Each test calls it first.
pub(crate) fn install() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let package = linked(&[
            ("curr/root.res", 0, bundle(CURRENCIES, 0)),
            ("de.res", File::SQUEEZED, squeezed(&bundle(GERMAN, 0))),
            ("nomagic.res", 0, vec![0; 16]),
            (
                "numberingSystems.res",
                0,
                bundle(NUMBERING_SYSTEMS, NO_FALLBACK),
            ),
            ("pluralRanges.res", 0, bundle(INDEX, NO_FALLBACK)),
            ("plurals.res", 0, bundle(PLURALS, NO_FALLBACK)),
            ("res_index.res", 0, bundle(INDEX, NO_FALLBACK)),
            ("root.res", 0, bundle(ROOT, 0)),
            ("supplementalData.res", 0, bundle(SUPPLEMENTAL, NO_FALLBACK)),
        ]);
        // SAFETY: nothing has read it yet.
        let room = unsafe { &mut *PACKAGE.0.get() };
        room[..package.len()].copy_from_slice(&package);
    });
}
