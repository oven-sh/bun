//! A small package of data in the place of ICU's.

use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::sync::{Once, OnceLock};

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

/// Stands for an item that the hook decompresses.
const COMPRESSED: &[u8; 16] = b"compressed de\0\0\0";

#[repr(C, align(16))]
struct Package(UnsafeCell<[u8; 4096]>);

// SAFETY: `install` writes it once, before anything reads it.
unsafe impl Sync for Package {}

#[unsafe(export_name = "icudt79_dat")]
static PACKAGE: Package = Package(UnsafeCell::new([0; _]));
static DECOMPRESSED: OnceLock<Vec<u8>> = OnceLock::new();

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_icu_maybe_decompress(
    item: *const c_void,
    length: &mut i32,
) -> *const c_void {
    // SAFETY: each item has 16 bytes or more.
    if unsafe { item.cast::<[u8; 16]>().read() } != *COMPRESSED {
        return item;
    }
    let bytes = DECOMPRESSED.get().unwrap();
    *length = bytes.len() as i32;
    bytes.as_ptr().cast()
}

/// Each test calls it first.
pub(crate) fn install() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        DECOMPRESSED.set(bundle(GERMAN, 0)).unwrap();
        let items = [
            ("curr/root.res", bundle(CURRENCIES, 0)),
            ("de.res", COMPRESSED.to_vec()),
            ("frame.res", [0x28, 0xb5, 0x2f, 0xfd].repeat(4)),
            ("nomagic.res", vec![0; 16]),
            (
                "numberingSystems.res",
                bundle(NUMBERING_SYSTEMS, NO_FALLBACK),
            ),
            ("pluralRanges.res", bundle(INDEX, NO_FALLBACK)),
            ("plurals.res", bundle(PLURALS, NO_FALLBACK)),
            ("res_index.res", bundle(INDEX, NO_FALLBACK)),
            ("root.res", bundle(ROOT, 0)),
            ("supplementalData.res", bundle(SUPPLEMENTAL, NO_FALLBACK)),
        ];
        let (mut entries, mut rest) = (vec![items.len() as u32], Vec::new());
        let entries_size = 4 + 8 * items.len();
        for (name, _) in &items {
            entries.extend([(entries_size + rest.len()) as u32, 0]);
            rest.extend(format!("icudt79l/{name}\0").bytes());
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
        // SAFETY: nothing has read it yet.
        let room = unsafe { &mut *PACKAGE.0.get() };
        room[..package.len()].copy_from_slice(&package);
    });
}
