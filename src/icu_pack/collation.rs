//! Packs the root collation and the tailorings.

#[path = "../icu/i18n/collunsafe.rs"]
mod collunsafe;

use crate::codes::{push_number, to_bytes};
use crate::files::split_header;
use crate::resb::u32_at;
use crate::tries::{Trie, read_string_trie, write_string_trie};
use crate::{fast_latin, runs};
use bun_icu_format::Words;
use bun_icu_format::collation::*;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::atomic::{AtomicU16, AtomicU32};

const SPECIAL: u8 = 0xc0;
const FALLBACK: u32 = 0xc0;
const UNASSIGNED: u32 = u32::MAX;
const LEAD_ALL_FALLBACK: u32 = 0x1cd;
const COMMON_WEIGHTS: u32 = 0x0500_0500;

const LONG_PRIMARY_TAG: u32 = 1;
const EXPANSION32_TAG: u32 = 5;
const EXPANSION_TAG: u32 = 6;
const PACKED_TAG: u32 = 7;
const PREFIX_TAG: u32 = 8;
const CONTRACTION_TAG: u32 = 9;
const DIGIT_TAG: u32 = 10;
const OFFSET_TAG: u32 = 14;
const OFFSET_LOW_BYTE: u32 = SPECIAL as u32 | OFFSET_TAG;
const INDEX_SHIFT: u32 = 13;

const JAMO: usize = 19 + 21 + 27;
const HANGUL: Range<u32> = 0xac00..0xd7a4;
const LEADS: Range<u32> = 0xd800..0xdc00;
const EMOJI: Range<u32> = 0x1f000..0x20000;
const FIRST_CJK: u32 = 0x2e80;
/// A tailoring with more mappings has those from `FIRST_CJK` on in runs.
const MAX_EAGER: usize = 5000;

/// What a CE32 stands for, whatever the tables that it refers to.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Value {
    Plain(u32),
    Expansion(Vec<u64>),
    /// The bits below the index, and the value unless numbers are compared, or the default.
    Digit(u32, Box<Value>),
    Context(u32, Box<Value>, Vec<(Vec<u16>, Value)>),
}

fn ce_from_ce32(ce32: u32) -> u64 {
    let (is_simple, ce32) = ((ce32 as u8) < SPECIAL, u64::from(ce32));
    if is_simple {
        (ce32 & 0xffff_0000) << 32 | (ce32 & 0xff00) << 16 | (ce32 & 0xff) << 8
    } else if ce32 & 0xf == LONG_PRIMARY_TAG.into() {
        (ce32 & 0xffff_ff00) << 32 | u64::from(COMMON_WEIGHTS)
    } else {
        ce32 & 0xffff_ff00
    }
}

/// ICU4C: collationdatabuilder.cpp, encodeOneCEAsCE32
fn ce32_from_ce(ce: u64) -> Option<u32> {
    let (primary, lower) = ((ce >> 32) as u32, ce as u32);
    let simple = primary | lower >> 16 | lower >> 8 & 0xff;
    let candidates = [simple, primary | 0xc1, lower | 0xc2];
    candidates.into_iter().find(|&it| ce_from_ce32(it) == ce)
}

/// ICU4C: collation.cpp, getThreeBytePrimaryForOffsetData
fn long_primary_at(c: u32, data: u64) -> u32 {
    let (base, lower) = ((data >> 32) as u32, data as u32);
    let third = (c - (lower >> 8)) * (lower & 0x7f) + (base >> 8 & 0xff) - 2;
    let (first, count) = if lower & 0x80 != 0 {
        (4, 251)
    } else {
        (2, 254)
    };
    let second = third / 254 + (base >> 16 & 0xff) - first;
    let bytes = [
        (base >> 24) + second / count,
        second % count + first,
        third % 254 + 2,
        0xc1,
    ];
    u32::from_be_bytes(bytes.map(|it| it as u8))
}

#[derive(Clone, Copy)]
struct Tables<'a> {
    ces: &'a [u8],
    ce32s: &'a [u8],
    contexts: &'a [u8],
}

impl Tables<'_> {
    fn ce(&self, index: usize) -> u64 {
        u64::from_le_bytes(*self.ces[8 * index..].first_chunk().expect("a CE"))
    }

    fn ce32(&self, index: usize) -> u32 {
        u32_at(self.ce32s, 4 * index)
    }

    fn value(&self, ce32: u32) -> Value {
        let (index, low_bits) = ((ce32 >> INDEX_SHIFT) as usize, ce32 % (1 << INDEX_SHIFT));
        let indexes = index..index + (low_bits >> 8) as usize;
        match ce32 & 0xf {
            _ if (ce32 as u8) < SPECIAL => Value::Plain(ce32),
            EXPANSION32_TAG => {
                Value::Expansion(indexes.map(|i| ce_from_ce32(self.ce32(i))).collect())
            }
            EXPANSION_TAG => Value::Expansion(indexes.map(|i| self.ce(i)).collect()),
            PACKED_TAG => Value::Expansion(self.packed_expansion(ce32)),
            OFFSET_TAG => panic!("only a code point has an offset"),
            DIGIT_TAG => Value::Digit(low_bits, self.value(self.ce32(index)).into()),
            PREFIX_TAG | CONTRACTION_TAG => {
                let default = u32_at(self.contexts, 2 * index).rotate_left(16);
                let entries = read_string_trie(&self.contexts[2 * index + 4..]).into_iter();
                let entries = entries.map(|(text, ce32)| (text, self.value(ce32)));
                Value::Context(low_bits, self.value(default).into(), entries.collect())
            }
            _ => Value::Plain(ce32),
        }
    }

    fn offset_ce(&self, ce32: u32) -> Option<u64> {
        (ce32 % 0x100 == OFFSET_LOW_BYTE).then(|| self.ce((ce32 >> INDEX_SHIFT) as usize))
    }

    /// A primary weight takes less time to read than to compute.
    fn value_of(&self, c: u32, ce32: u32) -> Value {
        match self.offset_ce(ce32) {
            Some(ce) => Value::Plain(long_primary_at(c, ce)),
            None => self.value(ce32),
        }
    }

    fn packed_expansion(&self, ce32: u32) -> Vec<u64> {
        let split = |bits: u32| (ce32 >> 8 >> bits, (ce32 >> 8) as usize % (1 << bits));
        if ce32 as u8 == PAIR_LOW_BYTE {
            let (second, first) = split(PAIR_INDEX_BITS);
            return vec![self.ce(first), self.ce(second as usize)];
        }
        let (secondary, syllable) = split(HANJA_INDEX_BITS);
        let [lead, bytes @ ..] = self.ce32(syllable).to_le_bytes().map(u64::from);
        let primaries = bytes
            .into_iter()
            .filter(|&it| it != 0)
            .map(|it| lead << 56 | it << 48);
        let mut ces: Vec<_> = primaries.map(|it| it | u64::from(COMMON_WEIGHTS)).collect();
        let last = ces.last_mut().expect("a CE");
        *last = *last & !0xffff_0000 | u64::from(secondary + HANJA_MIN_SECONDARY) << 16;
        ces
    }
}

/// Returns the entry for the syllable and the secondary weight if `ces` are those of a Han character in Korean.
fn as_hanja(ces: &[u64]) -> Option<([u8; 4], u32)> {
    let ([first, _] | [first, _, _], [before @ .., last]) = (ces, ces) else {
        return None;
    };
    let secondary = ((*last as u32) >> 16).checked_sub(HANJA_MIN_SECONDARY)?;
    let mut syllable = [(first >> 56) as u8, 0, 0, 0];
    (syllable[1..].iter_mut().zip(ces)).for_each(|(byte, ce)| *byte = (ce >> 48) as u8);
    let fits = ces
        .iter()
        .all(|ce| ce >> 56 == first >> 56 && ce & 0xffff_0000_ffff == 0x0500)
        && before.iter().all(|&ce| ce as u32 == COMMON_WEIGHTS)
        && secondary < 1 << (24 - HANJA_INDEX_BITS);
    fits.then_some((syllable, secondary))
}

/// What ICU's format has.
struct Source<'a> {
    options: u32,
    reorder_codes: Vec<u8>,
    /// By code unit or supplementary code point, unless it is the initial value.
    values: BTreeMap<u32, Value>,
    /// By supplementary code point: the CE that its primary weight is computed from.
    offset_ces: BTreeMap<u32, u64>,
    jamo: Vec<Value>,
    unsafe_backward: &'a [u8],
    fast_latin: &'a [u8],
    scripts: &'a [u8],
}

fn read_values(get: impl Fn(u32) -> u32, initial: u32, tables: Tables) -> BTreeMap<u32, Value> {
    let ce32s = (0..0x11_0000)
        .map(|c| (c, get(c)))
        .filter(|it| it.1 != initial);
    ce32s
        .map(|(c, ce32)| (c, tables.value_of(c, ce32)))
        .collect()
}

fn read_jamo(first: Option<usize>, tables: Tables) -> Vec<Value> {
    let indexes = first.into_iter().flat_map(|first| first..first + JAMO);
    indexes.map(|i| tables.value(tables.ce32(i))).collect()
}

impl<'a> Source<'a> {
    fn new(file: &'a [u8]) -> Self {
        let bytes = split_header(file).1;
        let index = |i: u32| (i < u32_at(bytes, 0)).then(|| u32_at(bytes, 4 * i as usize));
        let part = |i| match (index(i), index(i + 1)) {
            (Some(start), Some(end)) => &bytes[start as usize..end as usize],
            _ => &[],
        };
        let (trie, ces, ce32s, contexts) = (part(7), part(9), part(11), part(13));
        let tables = Tables {
            ces,
            ce32s,
            contexts,
        };
        let (mut values, mut offset_ces) = (BTreeMap::new(), BTreeMap::new());
        if trie.len() >= 8 {
            let (trie, initial) = (Trie(trie), Trie(trie).initial_value());
            assert!(LEADS.clone().all(|c| trie.of_lead_code_point(c) == initial));
            assert!(tables.ce32(0) == 0);
            values = read_values(|c| trie.get(c), initial, tables);
            let with_ce = |&c: &u32| Some((c, tables.offset_ce(trie.get(c))?));
            offset_ces = values
                .range(0x10000..)
                .map(|it| it.0)
                .filter_map(with_ce)
                .collect();
        }
        let codes = part(5)
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|it| it[2..] == [0; 2]);
        let jamo = index(4).filter(|it| it.cast_signed() >= 0);
        Self {
            options: u32_at(bytes, 4),
            reorder_codes: codes.flatten().copied().collect(),
            values,
            offset_ces,
            jamo: read_jamo(jamo.map(|it| it as usize), tables),
            unsafe_backward: part(14),
            fast_latin: part(15),
            scripts: part(16),
        }
    }

    fn for_each_expansion(&self, f: &mut impl FnMut(&[u64])) {
        (self.values.values().chain(&self.jamo)).for_each(|it| it.for_each_expansion(f));
    }
}

impl Value {
    fn for_each_expansion(&self, f: &mut impl FnMut(&[u64])) {
        match self {
            Self::Expansion(ces) => f(ces),
            Self::Digit(_, value) => value.for_each_expansion(f),
            Self::Context(_, default, entries) => {
                default.for_each_expansion(f);
                entries.iter().for_each(|it| it.1.for_each_expansion(f));
            }
            _ => {}
        }
    }
}

#[derive(Default)]
struct Pool {
    bytes: Vec<u8>,
    ce32s: BTreeMap<Value, u32>,
    /// By the size of an element and the bytes: where they are.
    known: BTreeMap<(usize, Vec<u8>), usize>,
}

impl Pool {
    /// Returns the index in units of `size` bytes.
    fn add(&mut self, size: usize, bytes: Vec<u8>) -> usize {
        if let Some(&known) = self.known.get(&(size, bytes.clone())) {
            return known;
        }
        self.bytes
            .resize(self.bytes.len().next_multiple_of(size), 0);
        let index = self.bytes.len() / size;
        self.bytes.extend(&bytes);
        self.known.insert((size, bytes), index);
        index
    }

    /// Other expansions can use parts of it.
    fn add_sequence(&mut self, size: usize, bytes: &[u8]) -> usize {
        let (index, count) = (self.add(size, bytes.into()), bytes.len() / size);
        for (start, end) in (0..count).flat_map(|it| (it + 1..=count).map(move |end| (it, end))) {
            let part = bytes[size * start..size * end].to_vec();
            self.known.entry((size, part)).or_insert(index + start);
        }
        index
    }

    fn add_expansion(&mut self, ces: &[u64]) -> u32 {
        let ce32s: Option<Vec<_>> = ces.iter().map(|&ce| ce32_from_ce(ce)).collect();
        let (tag, index) = match ce32s {
            Some(ce32s) => {
                let bytes: Vec<_> = ce32s.into_iter().flat_map(u32::to_le_bytes).collect();
                (EXPANSION32_TAG, self.add_sequence(4, &bytes))
            }
            None => {
                let bytes: Vec<_> = ces.iter().copied().flat_map(u64::to_le_bytes).collect();
                (EXPANSION_TAG, self.add_sequence(8, &bytes))
            }
        };
        (index as u32) << INDEX_SHIFT | (ces.len() as u32) << 8 | u32::from(SPECIAL) | tag
    }

    fn ce32(&mut self, value: &Value) -> u32 {
        if let Some(&known) = self.ce32s.get(value) {
            return known;
        }
        let with_index = |index: usize, low_bits: u32| (index as u32) << INDEX_SHIFT | low_bits;
        let ce32 = match value {
            &Value::Plain(ce32) => ce32,
            Value::Expansion(ces) => self.add_expansion(ces),
            Value::Digit(low_bits, value) => {
                let ce32 = self.ce32(value);
                with_index(self.add(4, ce32.to_le_bytes().into()), *low_bits)
            }
            Value::Context(low_bits, default, entries) => {
                let default = self.ce32(default).rotate_left(16).to_le_bytes();
                let entries = entries.iter().map(|it| (it.0.clone(), self.ce32(&it.1)));
                let trie = write_string_trie(&entries.collect::<Vec<_>>());
                with_index(
                    self.add(2, [&default[..], &to_bytes(&trie)].concat()),
                    *low_bits,
                )
            }
        };
        self.ce32s.insert(value.clone(), ce32);
        ce32
    }

    /// Adds the longest expansions and the largest elements first. Returns the CE32s, and the index of those of the Jamo.
    fn add_values(&mut self, source: &Source) -> (BTreeMap<u32, u32>, usize) {
        let mut expansions = BTreeSet::new();
        source.for_each_expansion(&mut |ces| {
            let is_narrow = ces.iter().all(|&ce| ce32_from_ce(ce).is_some());
            expansions.insert((is_narrow, Reverse(ces.len()), ces.to_vec()));
        });
        (expansions.into_iter()).for_each(|it| _ = self.ce32(&Value::Expansion(it.2)));
        let digits = source
            .values
            .values()
            .filter(|it| matches!(it, Value::Digit(..)));
        digits.for_each(|it| _ = self.ce32(it));
        let jamo = source
            .jamo
            .iter()
            .flat_map(|it| self.ce32(it).to_le_bytes());
        let jamo: Vec<_> = jamo.collect();
        let jamo = if jamo.is_empty() {
            0
        } else {
            self.add(4, jamo)
        };
        let ce32s = source
            .values
            .iter()
            .map(|(&c, value)| (c, self.ce32(value)));
        (ce32s.collect(), jamo)
    }

    /// Starts the pool with what the expansions that only tailorings have can refer to.
    fn new(root: &Source, tailorings: &[&Source]) -> Self {
        let mut of_root = BTreeSet::new();
        root.for_each_expansion(&mut |ces| _ = of_root.insert(ces.to_vec()));
        let mut own = BTreeSet::new();
        for tailoring in tailorings {
            tailoring.for_each_expansion(&mut |ces| _ = own.insert(ces.to_vec()));
        }
        let mut pool = Self::default();
        pool.add(4, vec![0; 4]);
        let (mut pairs, mut as_second) = (Vec::new(), BTreeMap::new());
        for ces in own.difference(&of_root) {
            if let Some((syllable, secondary)) = as_hanja(ces) {
                let index = pool.add(4, syllable.into()) as u32;
                assert!(index < 1 << HANJA_INDEX_BITS);
                let ce32 = (secondary << HANJA_INDEX_BITS | index) << 8 | u32::from(HANJA_LOW_BYTE);
                pool.ce32s.insert(Value::Expansion(ces.clone()), ce32);
            } else if let [first, second] = ces[..] {
                pairs.push([first, second]);
                as_second.entry(first).or_insert(0);
                *as_second.entry(second).or_insert(0) += 1;
            }
        }
        // A smaller CE32 takes less room in a context.
        let mut ces: Vec<_> = as_second.into_iter().collect();
        ces.sort_by_key(|it| Reverse(it.1));
        ces.iter()
            .for_each(|it| _ = pool.add(8, it.0.to_le_bytes().into()));
        assert!(pool.bytes.len() <= 8 << PAIR_INDEX_BITS);
        for pair in pairs {
            let [first, second] = pair.map(|ce| pool.add(8, ce.to_le_bytes().into()) as u32);
            let ce32 = (second << PAIR_INDEX_BITS | first) << 8 | u32::from(PAIR_LOW_BYTE);
            pool.ce32s.insert(Value::Expansion(pair.into()), ce32);
        }
        pool
    }

    fn push_part(&mut self, numbers: &mut Vec<u8>, part: &[u8]) {
        let offset = if part.is_empty() {
            0
        } else {
            self.add(1, part.into())
        };
        push_number(numbers, offset);
        push_number(numbers, part.len());
    }
}

fn write_layer(changes: &BTreeMap<u32, u32>) -> Vec<u8> {
    let (mut layer, mut next, mut last) = (Vec::new(), 0, [0; 4]);
    for (&unit, value) in changes {
        let (distance, value) = ((unit - next) as usize, value.to_le_bytes());
        let changed = (0..4).filter(|&i| value[i] != last[i]);
        layer.push((distance.min(15) << 4 | changed.clone().map(|i| 1 << i).sum::<usize>()) as u8);
        if distance >= 15 {
            push_number(&mut layer, distance - 15);
        }
        layer.extend(changed.map(|i| value[i]));
        (next, last) = (unit + 1, value);
    }
    layer
}

const HANGUL_CE32S: [u32; 2] = [0xcc, 0x1cc];

fn write_shared_values(root: &BTreeMap<u32, u32>) -> Vec<u32> {
    let mut values = vec![FALLBACK; trie::ASCII_BLOCKS];
    let uniform = trie::HANGUL_BLOCKS.into_iter().zip(HANGUL_CE32S).chain([
        (trie::LAZY_BLOCK, LAZY_CE32),
        (trie::UNASSIGNED_BLOCK, UNASSIGNED),
        (trie::LEAD_BLOCK, LEAD_ALL_FALLBACK),
    ]);
    uniform.for_each(|(block, value)| values[block..][..trie::BLOCK_LENGTH].fill(value));
    values.extend(trie::ASCII.chain(trie::LATIN_1).map(|c| root[&(c as u32)]));
    values.push((trie::USED + trie::GRANULARITY) as u32);
    values
}

/// Returns the CE32 of a code unit in a tailoring without mappings.
fn untailored(unit: u32, root: &BTreeMap<u32, u32>) -> u32 {
    match unit {
        0..0x80 | 0xc0..0x100 => root[&unit],
        0xd800..0xdc00 => LEAD_ALL_FALLBACK,
        _ => FALLBACK,
    }
}

/// Removes the syllables from `ce32s`, and returns their block.
fn take_hangul(ce32s: &mut BTreeMap<u32, u32>, range: Range<u32>) -> usize {
    let hangul = ce32s[&HANGUL.start];
    assert!(range.into_iter().all(|c| ce32s.remove(&c) == Some(hangul)));
    trie::HANGUL_BLOCKS[HANGUL_CE32S
        .iter()
        .position(|&it| it == hangul)
        .expect("a block")]
}

/// The parts of the supplementary range without values have `empty`. The others get blocks from `next` on.
fn write_index_1(in_runs: &BTreeMap<u32, u32>, empty: usize, next: &mut usize) -> Vec<u16> {
    let parts = in_runs
        .range(0x10000..)
        .map(|it| (it.0 - 0x10000) >> trie::INDEX_1_SHIFT);
    let parts: BTreeSet<_> = parts.collect();
    let mut index = vec![empty as u16; parts.last().map_or(0, |&it| it as usize + 1)];
    for part in parts {
        index[part as usize] = *next as u16;
        *next += trie::INDEX_2_BLOCK_LENGTH;
    }
    index
}

/// Removes from `in_runs` what `Mappings::primaries` can have, if that is most of it.
fn take_primaries(in_runs: &mut BTreeMap<u32, u32>) -> Vec<u16> {
    let (han, mut rest) = (trie::UNIFIED_HAN, in_runs.clone());
    let mut primaries = vec![0; han.len()];
    for (block, own) in primaries.chunks_mut(runs::BLOCK_LENGTH).enumerate() {
        let first = (han.start + block * runs::BLOCK_LENGTH) as u32;
        let values = in_runs.range(first..first + runs::BLOCK_LENGTH as u32);
        if (values.clone()).all(|(_, &ce32)| ce32_of_primary((ce32 >> 16) as u16) == ce32) {
            for (c, ce32) in values {
                own[(c - first) as usize] = (ce32 >> 16) as u16;
                rest.remove(c);
            }
        }
    }
    if in_runs.len() - rest.len() < primaries.len() / 2 {
        return Vec::new();
    }
    *in_runs = rest;
    primaries
}

/// Gives consecutive blocks one CE32 where ICU does, so that they are filled in at once. Emoji are worth their own values.
fn share_offsets(in_runs: &mut BTreeMap<u32, u32>, source: &Source, pool: &mut Pool) {
    let offset_ces = source.offset_ces.iter();
    let offset_ces: Vec<_> = offset_ces.filter(|it| !EMOJI.contains(it.0)).collect();
    for range in offset_ces.chunk_by(|a, b| a.0 + 1 == *b.0 && a.1 == b.1) {
        let length = runs::BLOCK_LENGTH as u32;
        let first = range[0].0.next_multiple_of(length);
        let end = (range[0].0 + range.len() as u32) / length * length;
        if end >= first + 2 * length {
            let index = pool.add(8, range[0].1.to_le_bytes().into()) as u32;
            in_runs.extend((first..end).map(|c| (c, index << INDEX_SHIFT | OFFSET_LOW_BYTE)));
        }
    }
}

fn push_runs(
    packed: &mut Vec<u8>,
    mut in_runs: BTreeMap<u32, u32>,
    empty: usize,
    next: &mut usize,
) {
    let index_1 = write_index_1(&in_runs, empty, next);
    for numbers in [index_1, take_primaries(&mut in_runs)] {
        push_number(packed, numbers.len());
        packed.extend(to_bytes(&numbers));
    }
    packed.extend(runs::write(&in_runs));
}

/// The CE32s of the code units that a tailoring changes.
type Changes = BTreeMap<u32, u32>;

/// Returns the earlier tailorings whose changes come before the own ones, and these.
fn split_changes(changes: &Changes, earlier: &[Changes]) -> (Vec<usize>, Changes) {
    let (mut parents, mut applied) = (Vec::new(), Changes::new());
    let rest = |applied: &Changes| -> Changes {
        let differs = |(unit, value): &(&u32, &u32)| applied.get(unit) != Some(value);
        changes
            .iter()
            .filter(differs)
            .map(|it| (*it.0, *it.1))
            .collect()
    };
    loop {
        let with = |parent: usize| {
            let mut both = applied.clone();
            both.extend(&earlier[parent]);
            both
        };
        let candidates = (0..earlier.len())
            .filter(|&it| earlier[it].keys().all(|unit| changes.contains_key(unit)));
        let best = candidates.min_by_key(|&it| rest(&with(it)).len());
        match best.filter(|&it| rest(&with(it)).len() + 2 < rest(&applied).len()) {
            Some(best) => {
                applied = with(best);
                parents.push(best);
            }
            None => return (parents, rest(&applied)),
        }
    }
}

pub(crate) struct Packed<'a> {
    pub(crate) root: Vec<u8>,
    /// By what `%%CollationBin` is in ICU's data.
    pub(crate) tailorings: BTreeMap<&'a [u8], Vec<u8>>,
}

pub(crate) fn pack<'a>(root_file: &[u8], files: &[&'a [u8]]) -> Packed<'a> {
    let root = Source::new(root_file);
    let mut sources: Vec<_> = files
        .iter()
        .map(|&file| (file, Source::new(file)))
        .collect();
    sources.sort_by_key(|it| it.1.values.len());
    let mut pool = Pool::new(&root, &sources.iter().map(|it| &it.1).collect::<Vec<_>>());
    let (root_ce32s, root_jamo) = pool.add_values(&root);
    let [empty_of_tailorings, empty_of_root, mut next_index_2] =
        [0, 1, 2].map(|it| it * trie::INDEX_2_BLOCK_LENGTH);
    let mut all_values = 0;

    let (mut all_changes, mut all_layers) = (Vec::new(), Vec::<Vec<Vec<u8>>>::new());
    let mut tailorings = BTreeMap::new();
    for (file, source) in &sources {
        let mut packed = Vec::new();
        push_number(&mut packed, source.options as usize & 0xff_ffff);
        push_number(&mut packed, source.reorder_codes.len() / 4);
        packed.extend(&source.reorder_codes);
        if !source.values.is_empty() {
            let (mut ce32s, jamo) = pool.add_values(source);
            let hangul = take_hangul(&mut ce32s, HANGUL);
            let is_large = ce32s.len() > MAX_EAGER;
            let in_runs = ce32s.split_off(if is_large { &FIRST_CJK } else { &0x10000 });
            let kept =
                |unit: u32| untailored(unit, &root_ce32s) == FALLBACK || ce32s.contains_key(&unit);
            assert!((0..0x10000).all(|it| kept(it) || in_runs.contains_key(&it)));
            ce32s.retain(|&unit, ce32| untailored(unit, &root_ce32s) != *ce32);
            let (parents, own) = split_changes(&ce32s, &all_changes);
            let layers = parents.iter().flat_map(|&it| all_layers[it].clone());
            let layers: Vec<_> = layers
                .chain([write_layer(&own)])
                .filter(|it| !it.is_empty())
                .collect();
            let block_of = |&unit: &u32| {
                if unit < 0x80 {
                    (0, 0x80)
                } else {
                    (unit >> 5, 32)
                }
            };
            let blocks: BTreeSet<_> = ce32s.keys().map(block_of).collect();
            let values = blocks.iter().map(|it| it.1).sum();
            all_values += values;
            for number in [all_changes.len() + 1, values, jamo, hangul] {
                push_number(&mut packed, number);
            }
            pool.push_part(&mut packed, source.unsafe_backward);
            pool.push_part(
                &mut packed,
                &fast_latin::changes(root.fast_latin, source.fast_latin),
            );
            let mut numbers = Vec::new();
            layers
                .iter()
                .for_each(|it| pool.push_part(&mut numbers, it));
            push_number(&mut packed, numbers.len());
            packed.extend(numbers);
            push_runs(&mut packed, in_runs, empty_of_tailorings, &mut next_index_2);
            all_changes.push(ce32s);
            all_layers.push(layers);
        }
        tailorings.insert(*file, packed);
    }
    assert!(all_changes.len() < MAX_TRIES && all_values <= trie::VALUES - trie::LAZY_LIMIT);

    let shared = write_shared_values(&root_ce32s)
        .into_iter()
        .flat_map(u32::to_le_bytes);
    let shared: Vec<_> = shared.collect();
    let mut in_runs = root_ce32s;
    let hangul = take_hangul(&mut in_runs, HANGUL.start..HANGUL.end & !31);
    in_runs.retain(|c, _| !matches!(c, 0..0x80 | 0xc0..0x100));
    share_offsets(&mut in_runs, &root, &mut pool);
    let mut mappings = Vec::new();
    for number in [0, 0, root_jamo, hangul, 0, 0, 0, 0, 0] {
        push_number(&mut mappings, number);
    }
    push_runs(&mut mappings, in_runs, empty_of_root, &mut next_index_2);
    assert!(next_index_2 <= trie::INDEX_2_LENGTH);

    let mut header = split_header(root_file).0;
    header[12..16].copy_from_slice(&DATA_FORMAT);
    let parts = [
        root.scripts,
        root.fast_latin,
        &shared,
        &mappings,
        &pool.bytes,
    ];
    let mut fields = vec![root.options];
    let mut bytes = Vec::new();
    for part in parts {
        bytes.extend(part);
        bytes.resize(bytes.len().next_multiple_of(4), 0);
        fields.push((4 * (1 + Root::PARTS) + bytes.len()) as u32);
    }
    let after_header = [
        fields.into_iter().flat_map(u32::to_le_bytes).collect(),
        bytes,
    ]
    .concat();
    verify(&Root::new(&after_header), &root, &sources, &tailorings);
    Packed {
        root: [header, after_header].concat(),
        tailorings,
    }
}

/// ICU4C: uset.cpp, uset_getSerializedSet
fn code_points(serialized: &[u16]) -> BTreeSet<u32> {
    let [length, bmp_length] = [0, 1].map(|i| usize::from(serialized[i] & 0x7fff));
    assert!(serialized[0] & 0x8000 != 0);
    let (bmp, rest) = serialized[2..2 + length].split_at(bmp_length);
    let rest = rest.as_chunks().0.iter();
    let rest = rest.map(|&[high, low]| u32::from(high) << 16 | u32::from(low));
    let boundaries: Vec<_> = bmp.iter().map(|&it| it.into()).chain(rest).collect();
    let (ranges, []) = boundaries.as_chunks() else {
        panic!("U+10FFFF is safe");
    };
    ranges.iter().flat_map(|&[start, end]| start..end).collect()
}

fn verify(
    packed: &Root,
    root: &Source,
    sources: &[(&[u8], Source)],
    tailorings: &BTreeMap<&[u8], Vec<u8>>,
) {
    let tables = Tables {
        ces: packed.pool,
        ce32s: packed.pool,
        contexts: packed.pool,
    };
    let check = |mappings: &Mappings, source: &Source| {
        let shared = packed
            .shared_values
            .as_chunks()
            .0
            .iter()
            .map(|&it| u32::from_le_bytes(it));
        let mut values: Vec<_> = shared.map(AtomicU32::new).collect();
        let first_block = values.len().next_multiple_of(trie::GRANULARITY);
        values.resize_with(first_block + mappings.values, AtomicU32::default);
        let mut index: Vec<_> = (0..trie::BMP_INDEX_LENGTH)
            .map(|_| AtomicU16::new(0))
            .collect();
        mappings.expand_trie(packed, &mut index, &values, first_block);
        let value = |at: usize| match at.checked_sub(trie::VALUES) {
            Some(index) => ce32_of_primary(Words::of(mappings.primaries).at(index)),
            None => values[at].load(Relaxed),
        };
        let high_start = 0x10000 + ((mappings.index_1.len() as u32 / 2) << trie::INDEX_1_SHIFT);
        let initial = value(mappings.null_block());
        let get = |c: u32| {
            let block = match c {
                ..0x10000 => index[c as usize >> trie::BLOCK_SHIFT].load(Relaxed).into(),
                _ if c < high_start => trie::LAZY_BLOCK,
                _ => return initial,
            };
            match value(block * trie::GRANULARITY + c as usize % trie::BLOCK_LENGTH) {
                LAZY_CE32 => mappings.runs.block(c).map_or(initial, |block| {
                    let mut half = [0; trie::BLOCK_LENGTH];
                    block.expand_half(c, initial, |i, value| half[i] = value);
                    let ce32 = half[c as usize % trie::BLOCK_LENGTH];
                    assert!(ce32 == block.get(c).unwrap_or(initial));
                    ce32
                }),
                ce32 => ce32,
            }
        };
        assert!(read_values(get, initial, tables) == source.values);
        assert!(read_jamo(Some(mappings.jamo).filter(|&it| it != 0), tables) == source.jamo);
    };
    check(&packed.mappings(), root);
    let unsafe_backward: Vec<_> = Words::of(root.unsafe_backward).iter().collect();
    let known = code_points(&collunsafe::UNSAFE_SERIALIZED_DATA);
    assert!(code_points(&unsafe_backward).is_subset(&known));
    crate::parallel::map(sources, |(file, source)| {
        let Some(mappings) = Tailoring::new(&tailorings[file], packed).mappings else {
            return assert!(source.values.is_empty());
        };
        check(&mappings, source);
        let mut fast_latin = vec![[0; 2]; mappings.fast_latin_units()];
        mappings.expand_fast_latin(packed, &mut fast_latin);
        assert!(fast_latin.as_flattened() == source.fast_latin);
        assert!(mappings.unsafe_backward == source.unsafe_backward);
    });
}
