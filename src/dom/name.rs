use core::hash::{BuildHasher, BuildHasherDefault, Hash, Hasher};
use std::hash::RandomState;
use std::sync::LazyLock;

use bun_core::Mutex;

/// A tag, class, id, attribute or custom property name. No two texts have the same.
///
/// The lowest bits are the namespace. The others are a permutation of the text itself if it is short, of its public hash if it is in
/// `KNOWN`, or else of a hash with a secret key that `Interned` keeps unique.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Name(u64);

const NAMESPACE: u64 = 15;
const MAX_SHORT: usize = 7;
const IS_SHORT: u64 = 1 << 59;
const IS_KNOWN: u64 = 1 << 58;

/// The long names that have a value at compile time, one per line.
const KNOWN: &[u8] = include_bytes!("names.txt");

const SLOTS: usize = 1 << 12;

/// `Name::tag` and the range in `KNOWN`, at `Name::slot` or in the next free slot.
static BY_HASH: [(u32, u16, u16); SLOTS] = {
    let (mut slots, mut start, mut count) = ([(0, 0, 0); SLOTS], 0, 0);
    while start < KNOWN.len() {
        let mut end = start;
        while KNOWN[end] != b'\n' {
            end += 1;
        }
        let text = KNOWN.split_at(end).0.split_at(start).1.trim_ascii_end();
        let name = Name::hash(text, false);
        let mut slot = name.slot();
        while slots[slot].2 != 0 {
            assert!(
                slots[slot].0 != name.tag(),
                "two lines of names.txt collide"
            );
            slot = (slot + 1) % SLOTS;
        }
        slots[slot] = (name.tag(), start as u16, (start + text.len()) as u16);
        (start, count) = (end + 1, count + 1);
    }
    assert!(count <= SLOTS / 2 && KNOWN.len() <= u16::MAX as usize);
    slots
};

/// The other long names, of all threads.
#[derive(Default)]
struct Interned {
    ranges: Map<Name, (u32, u32)>,
    texts: Vec<u8>,
    has_collided: bool,
}

static INTERNED: LazyLock<Mutex<Interned>> = LazyLock::new(Default::default);
static SECRET: LazyLock<RandomState> = LazyLock::new(RandomState::new);

/// For what stands in for its input, which a page must not be able to make collide.
pub(crate) fn keyed_hasher() -> impl Hasher {
    SECRET.build_hasher()
}

pub(crate) fn keyed_hash(value: impl Hash) -> u64 {
    SECRET.hash_one(value)
}

static FACTORS: LazyLock<[u64; 18]> = LazyLock::new(|| core::array::from_fn(keyed_hash));

/// Likewise, but faster: NH and then multiply-shift, both of which are universal.
#[inline]
pub(crate) fn keyed_hash_of_words(words: &[u64]) -> u64 {
    let [low, high, keys @ ..] = &*FACTORS;
    if words.len() > keys.len() {
        return keyed_hash(words);
    }
    let ((pairs, last), keys) = (words.as_chunks::<2>(), keys.as_chunks::<2>().0);
    let mut sum = words.len() as u128;
    for (words, keys) in pairs.iter().zip(keys) {
        sum = sum.wrapping_add(product(*words, keys));
    }
    if let [last] = last {
        sum = sum.wrapping_add(product([*last, 0], &keys[pairs.len()]));
    }
    (sum.wrapping_mul(u128::from(*high) << 64 | u128::from(*low | 1)) >> 64) as u64
}

pub(crate) fn keyed_hash_of_bytes(first: u64, bytes: &[u8]) -> u64 {
    let [low, high, a, b, keys @ ..] = &*FACTORS;
    if bytes.len() > keys.len() * 8 {
        return keyed_hash((first, bytes));
    }
    let ((whole, rest), keys) = (bytes.as_chunks::<8>(), keys.as_chunks::<2>().0);
    let (pairs, last) = whole.as_chunks::<2>();
    let mut sum = product(
        [
            first,
            rest.iter()
                .fold(bytes.len() as u64, |all, it| all << 8 | u64::from(*it)),
        ],
        &[*a, *b],
    );
    for ([one, other], keys) in pairs.iter().zip(keys) {
        sum = sum.wrapping_add(product(
            [u64::from_le_bytes(*one), u64::from_le_bytes(*other)],
            keys,
        ));
    }
    if let [last] = last {
        sum = sum.wrapping_add(product([u64::from_le_bytes(*last), 0], &keys[pairs.len()]));
    }
    (sum.wrapping_mul(u128::from(*high) << 64 | u128::from(*low | 1)) >> 64) as u64
}

#[inline(always)]
fn product(words: [u64; 2], keys: &[u64; 2]) -> u128 {
    u128::from(words[0].wrapping_add(keys[0])) * u128::from(words[1].wrapping_add(keys[1]))
}

impl Interned {
    fn name(&mut self, text: &[u8], mut hash: u64) -> Name {
        loop {
            let name = Name::permuted((hash % IS_KNOWN) | 1);
            match self.ranges.get(&name) {
                Some(&(start, end)) if self.texts[start as usize..end as usize] == *text => {
                    return name;
                }
                Some(_) => (self.has_collided, hash) = (true, keyed_hash(hash)),
                None => {
                    // A text that is forgotten gets the same name again.
                    if self.texts.len() + text.len() > 8 << 20 && !self.has_collided {
                        *self = Interned::default();
                    }
                    let start = self.texts.len() as u32;
                    self.texts.extend_from_slice(text);
                    self.ranges.insert(name, (start, self.texts.len() as u32));
                    return name;
                }
            }
        }
    }
}

impl Name {
    pub(crate) const NONE: Name = Name(0);

    #[inline]
    pub(crate) fn new(bytes: &[u8]) -> Name {
        let name = Name::hash(bytes, false);
        if bytes.len() <= MAX_SHORT || name.known_text() == Some(bytes) {
            name
        } else {
            Name::intern(bytes)
        }
    }

    #[inline]
    pub(crate) fn lowercase(bytes: &[u8]) -> Name {
        let name = Name::hash(bytes, true);
        let is_it = |text: &[u8]| {
            text.iter()
                .copied()
                .eq(bytes.iter().map(u8::to_ascii_lowercase))
        };
        if bytes.len() <= MAX_SHORT || name.known_text().is_some_and(is_it) {
            name
        } else {
            Name::intern(&bytes.to_ascii_lowercase())
        }
    }

    /// `new`, at compile time.
    pub(crate) const fn known(bytes: &[u8]) -> Name {
        let name = Name::hash(bytes, false);
        let is_known = bytes.len() <= MAX_SHORT
            || matches!(name.known_text(), Some(text) if text.eq_ignore_ascii_case(bytes));
        assert!(is_known, "add the name to src/dom/names.txt");
        name
    }

    fn intern(text: &[u8]) -> Name {
        let hash = keyed_hash_of_bytes(0, text);
        INTERNED.lock().name(text, hash)
    }

    /// What the name is if the text is short or known. Anybody can find long texts that collide.
    #[inline]
    pub(crate) const fn hash(bytes: &[u8], lowercase: bool) -> Name {
        const fn mix(hash: u64, word: u64) -> u64 {
            let product = (hash ^ word) as u128 * 0x9e37_79b9_7f4a_7c15;
            product as u64 ^ (product >> 64) as u64
        }
        const fn lower(word: u64) -> u64 {
            const ONES: u64 = u64::MAX / 255;
            let low = word & (ONES * 0x7f);
            let is_upper =
                (low + ONES * (0x80 - b'A' as u64)) & !(low + ONES * (0x7f - b'Z' as u64)) & !word;
            word | (is_upper & (ONES * 0x80)) >> 2
        }
        let (mut hash, mut rest) = (0xcbf2_9ce4_8422_2325 ^ bytes.len() as u64, bytes);
        while let Some((word, after)) = rest.split_first_chunk::<8>() {
            let word = u64::from_le_bytes(*word);
            (hash, rest) = (mix(hash, if lowercase { lower(word) } else { word }), after);
        }
        let mut last = 0;
        while let [byte, after @ ..] = rest {
            (last, rest) = (last << 8 | *byte as u64, after);
        }
        last = if lowercase { lower(last) } else { last };
        Name::permuted(match bytes.len() <= MAX_SHORT {
            true => IS_SHORT | (bytes.len() as u64) << 56 | last,
            false => IS_KNOWN | (mix(hash, last) % IS_KNOWN),
        })
    }

    /// Of the numbers of 60 bits.
    const fn permuted(mut bits: u64) -> Name {
        bits = (bits ^ bits >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9) % (1 << 60);
        bits = (bits ^ bits >> 27).wrapping_mul(0x94d0_49bb_1331_11eb) % (1 << 60);
        Name((bits ^ bits >> 31) << 4)
    }

    const fn slot(self) -> usize {
        (self.0 >> 40) as usize % SLOTS
    }

    const fn tag(self) -> u32 {
        (self.0 >> 4) as u32
    }

    /// The only one that can have this hash.
    const fn known_text(self) -> Option<&'static [u8]> {
        let mut slot = self.slot();
        while BY_HASH[slot].2 != 0 {
            let (tag, start, end) = BY_HASH[slot];
            if tag == self.tag() {
                return Some(KNOWN.split_at(end as usize).0.split_at(start as usize).1);
            }
            slot = (slot + 1) % SLOTS;
        }
        None
    }

    /// From `keyed_hash`, for comparing with others of the kind.
    pub(crate) const fn stand_in(hash: u64) -> Name {
        Name(hash & !NAMESPACE | 1 << 63)
    }

    /// The same name in another namespace, such as classes or ids.
    pub(crate) const fn salted(self, salt: u64) -> Name {
        debug_assert!(self.0 & NAMESPACE == 0 && salt <= NAMESPACE);
        Name(self.0 ^ (salt.wrapping_mul(0xa076_1d64_78bd_642f) & !NAMESPACE) | salt)
    }

    pub(crate) fn paired(self, other: Name) -> Name {
        Name::intern(
            (u128::from(self.0) << 64 | u128::from(other.0))
                .to_le_bytes()
                .as_slice(),
        )
        .salted(11)
    }

    pub(crate) const fn bits(self) -> u64 {
        self.0
    }
}

macro_rules! name {
    ($text:literal) => {
        const { $crate::name::Name::known($text.as_bytes()) }
    };
}
pub(crate) use name;

macro_rules! is_name {
    ($name:expr, $($text:literal)|+) => {{
        let name = $name;
        $(name == $crate::name::name!($text))||+
    }};
}
pub(crate) use is_name;

#[derive(Default)]
pub(crate) struct FastHasher(u64);

impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.0.rotate_left(26)
    }
    fn write(&mut self, bytes: &[u8]) {
        self.write_u64(bun_wyhash::hash(bytes));
    }
    fn write_u8(&mut self, value: u8) {
        self.write_u64(value.into());
    }
    fn write_u16(&mut self, value: u16) {
        self.write_u64(value.into());
    }
    fn write_u32(&mut self, value: u32) {
        self.write_u64(value.into());
    }
    fn write_u64(&mut self, value: u64) {
        self.0 = (self.0.wrapping_add(value)).wrapping_mul(0xf135_7aea_2e62_a9c5);
    }
    fn write_usize(&mut self, value: usize) {
        self.write_u64(value as u64);
    }
}

pub(crate) type Map<K, V> =
    bun_collections::hashbrown::HashMap<K, V, BuildHasherDefault<FastHasher>>;
pub(crate) type Set<K> = bun_collections::hashbrown::HashSet<K, BuildHasherDefault<FastHasher>>;
