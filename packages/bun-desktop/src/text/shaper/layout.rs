//! What `GSUB` and `GPOS` have in common, and `GDEF`.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicI64, Ordering::Relaxed};

use super::buffer::{self, Buffer, Glyph};
use super::{Direction, position, substitute};
use crate::small_vec::SmallVec;
use crate::text::sfnt::memo::remembered;
use crate::text::sfnt::variations::{self, Coords};
use crate::text::sfnt::work::spend;
use crate::text::sfnt::{Data, Font, Tag};

pub fn coverage(table: Data, glyph: u32) -> Option<usize> {
    remembered(0, table, glyph.min(1 << 16) | 1 << 24, || {
        Some(search_coverage(table, glyph)? as u32)
    })
    .map(|it| it as usize)
}

fn search_coverage(table: Data, glyph: u32) -> Option<usize> {
    let (glyph, count) = (u16::try_from(glyph).ok()?, usize::from(table.u16(2)?));
    if table.u16(0)? == 1 {
        return table
            .part(4, count * 2)?
            .0
            .as_chunks()
            .0
            .binary_search_by_key(&glyph, |it| u16::from_be_bytes(*it))
            .ok();
    }
    let range = find_range(table, count, glyph)?;
    Some(usize::from(range.u16(4)?) + usize::from(glyph - range.u16(0)?))
}

fn find_range(table: Data, count: usize, glyph: u16) -> Option<Data> {
    let ranges = table.part(4, count * 6)?.0.as_chunks::<6>().0;
    let range =
        ranges.get(ranges.partition_point(|it| u16::from_be_bytes([it[2], it[3]]) < glyph))?;
    Some(Data(range)).filter(|it| it.u16(0) <= Some(glyph))
}

pub fn covered(table: Data) -> impl Iterator<Item = (u16, u16)> {
    let (size, count) = (
        if table.u16(0) == Some(1) { 2 } else { 6 },
        table.u16(2).unwrap_or(0),
    );
    (0..usize::from(count)).map_while(move |it| {
        table
            .u16(4 + it * size)
            .zip(table.u16(4 + it * size + size / 3 / 2 * 2))
    })
}

pub fn class_of(table: Option<Data>, glyph: u32) -> u16 {
    let find = || {
        let (table, glyph) = (table?, u16::try_from(glyph).ok()?);
        match table.u16(0)? {
            1 => table.u16(
                6 + usize::from(
                    glyph
                        .checked_sub(table.u16(2)?)
                        .filter(|it| Some(*it) < table.u16(4))?,
                ) * 2,
            ),
            _ => remembered(0, table, u32::from(glyph) | 2 << 24, || {
                find_range(table, table.u16(2)?.into(), glyph)?
                    .u16(4)
                    .map(u32::from)
            })
            .map(|it| it as u16),
        }
    };
    find().unwrap_or(0)
}

/// Tells quickly that a glyph is not in a set.
#[derive(Clone, Copy)]
pub struct Digest<const WORDS: usize = 32> {
    remainders: [u64; WORDS],
    quotients: u64,
}

impl<const WORDS: usize> Digest<WORDS> {
    pub const EMPTY: Self = Digest {
        remainders: [0; WORDS],
        quotients: 0,
    };
    const BITS: u32 = WORDS as u32 * 64;

    pub fn add(&mut self, glyph: u32) {
        self.remainders[(glyph % Self::BITS / 64) as usize] |= 1 << (glyph % 64);
        self.quotients |= 1 << (glyph / Self::BITS % 64);
    }

    fn add_range(&mut self, first: u32, last: u32) {
        (first / Self::BITS..=last / Self::BITS).for_each(|it| self.quotients |= 1 << (it % 64));
        for word in (first / 64..=last / 64).take(WORDS + 1) {
            let [from, to] = [first.saturating_sub(word * 64), (last - word * 64).min(63)];
            self.remainders[word as usize % WORDS] |= u64::MAX << from & u64::MAX >> (63 - to);
        }
        if last.saturating_sub(first) >= Self::BITS {
            self.remainders = [u64::MAX; WORDS];
        }
    }

    fn may_have(&self, glyph: u32) -> bool {
        self.remainders[(glyph % Self::BITS / 64) as usize] >> (glyph % 64)
            & self.quotients >> (glyph / Self::BITS % 64)
            & 1
            != 0
    }

    fn may_meet(&self, other: &Self) -> bool {
        self.quotients & other.quotients != 0
            && self
                .remainders
                .iter()
                .zip(&other.remainders)
                .fold(0, |any, (a, b)| any | a & b)
                != 0
    }
}

#[derive(Clone, Copy, Default)]
pub struct Definitions {
    pub classes: Option<Data>,
    mark_classes: Option<Data>,
    mark_sets: Option<Data>,
    store: Option<Data>,
}

impl Definitions {
    pub fn new(font: &Font) -> Definitions {
        /// The sizes of `GDEF`, `GSUB` and `GPOS` in versions of Times New Roman, Tahoma, Courier New and others that have wrong classes.
        #[rustfmt::skip]
        const BROKEN: [[usize; 3]; 40] = [
            [442, 2874, 42038], [430, 2874, 40662], [442, 2874, 39116], [430, 2874, 39374], [490, 3046, 41638], [478, 3046, 41902],
            [898, 12554, 46470], [910, 12566, 47732], [928, 23298, 59332], [940, 23310, 60732], [964, 23836, 60072],
            [976, 23832, 61456], [994, 24474, 60336], [1006, 24470, 61740], [1006, 24576, 61346], [1018, 24572, 62828],
            [1006, 24576, 61352], [1018, 24572, 62834], [832, 7324, 47162], [844, 7302, 45474], [180, 13054, 7254], [192, 12638, 7254],
            [192, 12690, 7254], [188, 248, 3852], [188, 264, 3426], [1058, 47032, 11818], [1046, 47030, 12600], [1058, 71796, 16770],
            [1046, 71790, 17862], [1046, 71788, 17112], [1058, 71794, 17514], [1330, 109904, 57938], [1330, 109904, 58972],
            [1004, 59092, 14836], [588, 5078, 14418], [588, 5078, 14238], [894, 17162, 33960], [894, 17154, 34472], [816, 7868, 17052],
            [816, 7868, 17138],
        ];
        let sizes = [b"GDEF", b"GSUB", b"GPOS"].map(|it| font.table(it).map_or(0, |it| it.0.len()));
        let Some(table) = font.table(b"GDEF").filter(|_| !BROKEN.contains(&sizes)) else {
            return Definitions::default();
        };
        let since = |minor: u16| Some(table).filter(|it| it.u16(2) >= Some(minor));
        let (mark_sets, store) = (
            since(2).and_then(|it| it.at16(12)),
            since(3).and_then(|it| it.at32(14)),
        );
        Definitions {
            classes: table.at16(4),
            mark_classes: table.at16(10),
            mark_sets,
            store,
        }
    }

    pub fn class(&self, glyph: u32) -> u16 {
        match class_of(self.classes, glyph) {
            1 => buffer::BASE,
            2 => buffer::LIGATURE,
            3 => buffer::MARK | class_of(self.mark_classes, glyph) << 8,
            _ => 0,
        }
    }
}

pub struct Subtable {
    pub kind: u16,
    pub data: Data,
    digest: Digest<8>,
}

pub struct Lookup {
    /// With the mark filtering set in the high half.
    pub flags: u32,
    pub subtables: Vec<Subtable>,
    digest: Digest,
}

pub const RIGHT_TO_LEFT: u32 = 1;
pub const IGNORE_MARKS: u32 = 8;
pub const IGNORE_CLASSES: u32 = 14;
const USE_MARK_SET: u32 = 16;

pub struct Table {
    data: Data,
    pub positions: bool,
    lookups: Vec<OnceLock<Option<Box<Lookup>>>>,
    /// Offsets can make a small table look huge.
    budget: AtomicI64,
}

impl Table {
    pub fn new(font: &Font, tag: &Tag) -> Option<Table> {
        let data = font.table(tag).filter(|it| it.u16(0) == Some(1))?;
        let count = data.at16(8).and_then(|it| it.u16(0)).unwrap_or(0);
        Some(Table {
            data,
            positions: tag == b"GPOS",
            lookups: (0..count).map(|_| OnceLock::new()).collect(),
            budget: (data.0.len() as i64 * 16 + 16384).into(),
        })
    }

    /// The types of contextual lookups and extensions.
    pub fn special_kinds(&self) -> [u16; 3] {
        if self.positions { [7, 8, 9] } else { [5, 6, 7] }
    }

    pub fn lookup_count(&self) -> usize {
        self.lookups.len()
    }

    pub fn lookup(&self, index: usize) -> Option<&Lookup> {
        let read = || {
            let (table, [context, chain, extension]) = (
                self.data.at16(8)?.at16(2 + index * 2)?,
                self.special_kinds(),
            );
            let (count, flags) = (usize::from(table.u16(4)?), u32::from(table.u16(2)?));
            let set = if flags & USE_MARK_SET != 0 {
                u32::from(table.u16(6 + count * 2)?) << 16
            } else {
                0
            };
            let spend = |cost: usize| self.budget.fetch_sub(cost as i64, Relaxed) > 0;
            let mut all = Digest::EMPTY;
            let subtables = (0..count).take_while(|_| spend(32)).filter_map(|it| {
                let (kind, data) = (table.u16(0)?, table.at16(6 + it * 2)?);
                let (kind, data) = if kind == extension {
                    (data.u16(2)?, data.at32(4)?)
                } else {
                    (kind, data)
                };
                let first = match data.u16(0)? {
                    3 if kind == context => 6,
                    3 if kind == chain => 6 + usize::from(data.u16(2)?) * 2,
                    _ => 2,
                };
                let mut digest = Digest::EMPTY;
                let coverage = data
                    .at16(first)
                    .filter(|it| spend(it.u16(2).unwrap_or(0).into()))?;
                for (first, last) in covered(coverage)
                    .take_while(|it| spend(usize::from(it.1.saturating_sub(it.0)) / 256))
                {
                    digest.add_range(first.into(), last.into());
                    all.add_range(first.into(), last.into());
                }
                Some(Subtable { kind, data, digest })
            });
            Some(
                Lookup {
                    flags: flags | set,
                    subtables: subtables.collect(),
                    digest: all,
                }
                .into(),
            )
        };
        self.lookups.get(index)?.get_or_init(read).as_deref()
    }

    fn records(list: Data, at: usize) -> impl Iterator<Item = (Tag, Option<Data>)> {
        (0..usize::from(list.u16(at).unwrap_or(0)))
            .map_while(move |it| Some((list.tag(at + 2 + it * 6)?, list.at16(at + 6 + it * 6))))
    }

    /// The script that was chosen, whether it was asked for, and the language system.
    pub fn select(&self, scripts: &[Tag], languages: &[Tag]) -> Option<(Tag, bool, Option<Data>)> {
        let find = |list: Data, at: usize, tags: &[Tag]| {
            tags.iter()
                .find_map(|tag| Table::records(list, at).find(|it| it.0 == *tag))
        };
        let list = self.data.at16(4)?;
        let (tag, script) =
            find(list, 0, scripts).or_else(|| find(list, 0, &[*b"DFLT", *b"dflt", *b"latn"]))?;
        let language = script.and_then(|it| {
            find(it, 2, languages)
                .or_else(|| find(it, 2, &[*b"dflt"]))
                .map_or(it.at16(0), |it| it.1)
        });
        Some((tag, scripts.contains(&tag), language))
    }

    /// In all language systems of these scripts.
    #[cfg(not(target_os = "macos"))]
    pub fn all_lookups(&self, scripts: &[Tag], feature: Option<&Tag>) -> impl Iterator<Item = u16> {
        let scripts = Table::records(self.data.at16(4).unwrap_or_default(), 0)
            .filter(|it| scripts.contains(&it.0))
            .filter_map(|it| it.1);
        let languages = scripts.flat_map(|it| {
            Table::records(it, 2)
                .map(|it| it.1)
                .chain([it.at16(0)])
                .flatten()
        });
        let features = languages
            .flat_map(|it| it.u16s(6, it.u16(4).unwrap_or(0).into()))
            .take(1 << 16);
        features
            .filter(move |it| feature.is_none_or(|tag| self.feature_tag(*it) == Some(*tag)))
            .flat_map(|it| self.lookups_of(it, None))
            .take(1 << 20)
    }

    pub fn features(&self) -> impl Iterator<Item = Tag> {
        self.data
            .at16(6)
            .into_iter()
            .flat_map(|it| Table::records(it, 0))
            .map(|it| it.0)
    }

    pub fn feature_tag(&self, index: u16) -> Option<Tag> {
        self.data
            .at16(6)
            .filter(|it| Some(index) < it.u16(0))?
            .tag(2 + usize::from(index) * 6)
    }

    /// What replaces features for this instance of a variable font.
    pub fn substitutions(&self, coords: &Coords) -> Option<Data> {
        let table = self.data.at32(10).filter(|_| self.data.u16(2) >= Some(1))?;
        let holds = |condition: Data| {
            let coord = coords
                .get(usize::from(condition.u16(2)?))
                .map_or(0, |it| *it);
            Some(condition.u16(0)? == 1 && (condition.i16(4)?..=condition.i16(6)?).contains(&coord))
        };
        let all_hold = |set: Data| {
            (0..usize::from(set.u16(0).unwrap_or(0).min(64)))
                .all(|it| set.at32(2 + it * 4).and_then(holds) == Some(true))
        };
        let mut records = (0..table.u32(4)?.min(4096) as usize).map(|it| 8 + it * 8);
        table.at32(records.find(|it| table.at32(*it).is_none_or(all_hold))? + 4)
    }

    pub fn lookups_of(
        &self,
        feature: u16,
        substitutions: Option<Data>,
    ) -> impl Iterator<Item = u16> {
        let replaced = substitutions.and_then(|table| {
            let mut records = (0..usize::from(table.u16(4)?)).map(|it| 6 + it * 6);
            table.at32(records.find(|it| table.u16(*it) == Some(feature))? + 2)
        });
        let table = replaced
            .or_else(|| self.data.at16(6)?.at16(6 + usize::from(feature) * 6))
            .unwrap_or_default();
        table.u16s(4, table.u16(2).unwrap_or(0).into())
    }
}

/// How the numbers in a rule are to be read.
#[derive(Clone, Copy)]
pub enum Matcher {
    Glyphs,
    Classes(Option<Data>),
    /// They are offsets into this.
    Coverages(Data),
}

impl Matcher {
    /// If there is only one that matches.
    fn value_of(self, glyph: u32) -> Option<u16> {
        match self {
            Matcher::Glyphs => glyph.try_into().ok(),
            Matcher::Classes(table) => Some(class_of(table, glyph)),
            Matcher::Coverages(_) => None,
        }
    }

    pub fn matches(self, glyph: u32, value: u16) -> bool {
        match self {
            Matcher::Glyphs => glyph == u32::from(value),
            Matcher::Classes(table) => class_of(table, glyph) == value,
            Matcher::Coverages(base) => base
                .from(value.into())
                .and_then(|it| coverage(it, glyph))
                .is_some(),
        }
    }
}

/// Of a contextual lookup.
pub struct Rule {
    /// What comes before, the input after its first glyph, and what comes after it.
    pub parts: [Data; 3],
    pub actions: Data,
}

impl Rule {
    /// `skipped` is the size of the first input, if it is listed.
    fn read(data: Data, is_chained: bool, skipped: usize) -> Option<Rule> {
        let size = |at: usize| Some(usize::from(data.u16(at)?) * 2);
        if !is_chained {
            let input = size(0)?.checked_sub(2)?;
            let actions = data.part(4 + skipped + input, size(2)? * 2)?;
            return Some(Rule {
                parts: [
                    Data::default(),
                    data.part(4 + skipped, input)?,
                    Data::default(),
                ],
                actions,
            });
        }
        let before = size(0)?;
        let input = size(2 + before)?.checked_sub(2)?;
        let at = 4 + before + skipped + input;
        let after = size(at)?;
        let actions = data.part(at + 4 + after, size(at + 2 + after)? * 2)?;
        Some(Rule {
            parts: [
                data.part(2, before)?,
                data.part(4 + before + skipped, input)?,
                data.part(at + 2, after)?,
            ],
            actions,
        })
    }
}

/// How to match, where the rule sets are, and the only rule if there are no sets.
pub fn context_layout(
    table: Data,
    is_chained: bool,
) -> Option<([Matcher; 3], usize, Option<Rule>)> {
    Some(match table.u16(0)? {
        1 => ([Matcher::Glyphs; 3], 4, None),
        2 if is_chained => (
            [4, 6, 8].map(|it| Matcher::Classes(table.at16(it))),
            10,
            None,
        ),
        2 => ([Matcher::Classes(table.at16(4)); 3], 6, None),
        _ => (
            [Matcher::Coverages(table); 3],
            0,
            Some(Rule::read(table.from(2)?, is_chained, 2)?),
        ),
    })
}

pub fn rules_in(
    table: Data,
    sets: usize,
    index: usize,
    is_chained: bool,
) -> impl Iterator<Item = Rule> {
    let set = table
        .at16(sets + 2 + index * 2)
        .filter(|_| Some(index) < table.u16(sets).map(usize::from))
        .unwrap_or_default();
    set.u16s(2, set.u16(0).unwrap_or(0).into())
        .filter_map(move |it| Rule::read(set.from(it.into())?, is_chained, 0))
}

/// The rules for input that starts with `glyph`.
pub fn rules_for(
    table: Data,
    is_chained: bool,
    glyph: u32,
) -> Option<([Matcher; 3], impl Iterator<Item = Rule>)> {
    let (matchers, sets, only) = context_layout(table, is_chained)?;
    let first = only.as_ref().map_or(2, |it| 6 + it.parts[0].0.len());
    let index = coverage(table.at16(first)?, glyph)?;
    let index = if let Matcher::Classes(classes) = matchers[1] {
        class_of(classes, glyph).into()
    } else {
        index
    };
    let listed = only
        .is_none()
        .then(|| rules_in(table, sets, index, is_chained));
    Some((
        matchers,
        only.into_iter().chain(listed.into_iter().flatten()),
    ))
}

pub type Positions = SmallVec<usize, 8>;

#[derive(Clone, Copy)]
pub struct Options {
    pub mask: u32,
    pub skips_joiners: bool,
    pub skips_non_joiners: bool,
    pub is_random: bool,
    pub is_per_syllable: bool,
}

pub struct Apply<'a> {
    pub table: &'a Table,
    pub definitions: &'a Definitions,
    pub coords: &'a Coords,
    pub direction: Direction,
    pub buffer: &'a mut Buffer,
    pub digest: Digest,
    pub at: usize,
    pub options: Options,
    pub flags: u32,
    pub depth: u32,
    pub random: u32,
    /// The base that was found for marks, and from where.
    pub last_base: (Option<usize>, usize),
}

pub enum Skip {
    Yes,
    Maybe,
    No,
}

impl Apply<'_> {
    pub fn current(&mut self) -> &mut Glyph {
        &mut self.buffer.glyphs[self.at]
    }

    /// In steps.
    pub fn device_delta(&self, device: Option<Data>) -> f32 {
        let read = || {
            let device =
                device.filter(|it| !self.coords.is_empty() && it.u16(4) == Some(0x8000))?;
            variations::delta(
                self.definitions.store?,
                device.u16(0)?.into(),
                device.u16(2)?.into(),
                self.coords,
            )
        };
        read().unwrap_or(0.) * super::STEPS_PER_UNIT as f32
    }

    fn considers(&self, glyph: &Glyph, flags: u32) -> bool {
        if u32::from(glyph.class) & flags & IGNORE_CLASSES != 0 {
            false
        } else if !glyph.is_mark() {
            true
        } else if flags & USE_MARK_SET != 0 {
            let set = self
                .definitions
                .mark_sets
                .and_then(|it| it.at32(4 + (flags >> 16) as usize * 4));
            set.and_then(|it| coverage(it, glyph.id)).is_some()
        } else {
            flags & 0xff00 == 0 || flags & 0xff00 == u32::from(glyph.class) & 0xff00
        }
    }

    pub fn may_skip(&self, glyph: &Glyph, flags: u32, is_context: bool) -> Skip {
        if !self.considers(glyph, flags) {
            return Skip::Yes;
        }
        let is_skipped = |flag: u16, skips: bool| skips || glyph.flags & flag == 0;
        let positions = self.table.positions;
        match glyph.is_ignorable()
            && is_skipped(
                buffer::NON_JOINER,
                positions || is_context && self.options.skips_non_joiners,
            )
            && is_skipped(buffer::JOINER, is_context || self.options.skips_joiners)
            && is_skipped(buffer::HIDDEN, positions)
        {
            true => Skip::Maybe,
            false => Skip::No,
        }
    }

    /// `None` if it is to be skipped.
    pub fn is_match(
        &self,
        glyph: &Glyph,
        flags: u32,
        is_context: bool,
        wanted: Option<(Matcher, u16)>,
    ) -> Option<bool> {
        let must_match = match self.may_skip(glyph, flags, is_context) {
            Skip::Yes => return None,
            skip => matches!(skip, Skip::No),
        };
        let syllable = self.buffer.glyphs.get(self.at).map_or(0, |it| it.syllable);
        let is_eligible = (is_context || glyph.mask & self.options.mask != 0)
            && (!self.options.is_per_syllable || syllable == 0 || syllable == glyph.syllable);
        match is_eligible
            && wanted.map_or(must_match, |(matcher, value)| {
                matcher.matches(glyph.id, value)
            }) {
            true => Some(true),
            false => must_match.then_some(false),
        }
    }

    /// The first of `indexes` that is not skipped, if it matches.
    pub fn find(
        &self,
        mut indexes: impl Iterator<Item = usize>,
        flags: u32,
        is_context: bool,
        wanted: Option<(Matcher, u16)>,
    ) -> Option<usize> {
        let mut tried = 0;
        let found = indexes.find_map(|it| {
            tried += 8;
            Some((
                it,
                self.is_match(&self.buffer.glyphs[it], flags, is_context, wanted)?,
            ))
        });
        let found = spend(tried).and(found)?;
        found.1.then_some(found.0)
    }

    /// To rule out most rules at once.
    pub fn next_that_must_match(&self) -> Option<u32> {
        let next = self.buffer.glyphs[self.at + 1..]
            .iter()
            .take(8)
            .find(|it| self.considers(it, self.flags))?;
        (!next.is_ignorable()).then_some(next.id)
    }

    /// Where the current glyph and those that match `rest` are.
    pub fn match_input(&self, rest: Data, matcher: Matcher) -> Option<Positions> {
        let (glyphs, mut positions, mut last) = (
            &self.buffer.glyphs,
            Positions::from_iter([self.at]),
            self.at,
        );
        let (id, component) = (glyphs[last].ligature_id(), glyphs[last].component());
        for value in rest.u16s(0, 64) {
            last = self.find(
                last + 1..glyphs.len(),
                self.flags,
                false,
                Some((matcher, value)),
            )?;
            let this = (glyphs[last].ligature_id(), glyphs[last].component());
            if id != 0 && component != 0 {
                // Marks on different components of a ligature only go together if the ligature is ignored.
                let ligature = || {
                    glyphs[..self.at]
                        .iter()
                        .rev()
                        .take_while(|it| it.ligature_id() == id)
                        .find(|it| it.component() == 0)
                };
                (this == (id, component)
                    || matches!(self.may_skip(ligature()?, self.flags, false), Skip::Yes))
                .then_some(())?;
            } else if this.0 != 0 && this.1 != 0 && this.0 != id {
                return None;
            }
            positions.push(last);
        }
        Some(positions)
    }

    pub fn matches_around(&self, [before, after]: [(Data, Matcher); 2], end: usize) -> bool {
        let next = |at: usize, value| {
            Some(
                self.find(
                    at..self.buffer.glyphs.len(),
                    self.flags,
                    true,
                    Some((after.1, value)),
                )? + 1,
            )
        };
        let previous =
            |at: usize, value| self.find((0..at).rev(), self.flags, true, Some((before.1, value)));
        after.0.u16s(0, usize::MAX).try_fold(end, next).is_some()
            && before
                .0
                .u16s(0, usize::MAX)
                .try_fold(self.at, previous)
                .is_some()
    }

    fn act(&mut self, mut positions: Positions, actions: Data) {
        let mut end = positions[positions.len() - 1] + 1;
        for action in actions.0.as_chunks::<4>().0 {
            let (index, lookup) = (
                usize::from(u16::from_be_bytes([action[0], action[1]])),
                u16::from_be_bytes([action[2], action[3]]),
            );
            let (Some(&at), len) = (positions.get(index), self.buffer.glyphs.len()) else {
                continue;
            };
            if at >= len {
                continue;
            }
            self.at = at;
            self.buffer.budget -= 1;
            let Some(lookup) = self
                .table
                .lookup(lookup.into())
                .filter(|_| self.depth < 64 && self.buffer.budget > 0)
            else {
                continue;
            };
            let flags = std::mem::replace(&mut self.flags, lookup.flags);
            self.depth += 1;
            self.apply_here(lookup);
            (self.flags, self.depth) = (flags, self.depth - 1);
            let mut delta = self.buffer.glyphs.len() as isize - len as isize;
            let unlimited = end as isize + delta;
            end = unlimited.max(at as isize) as usize;
            delta += end as isize - unlimited;
            if delta > 0 {
                if positions.len() + delta as usize > 64 {
                    break;
                }
                positions[index + 1..]
                    .iter_mut()
                    .for_each(|it| *it += delta as usize);
                (1..=delta as usize).for_each(|it| positions.insert(index + it, at + it));
            } else if delta < 0 {
                let removed = delta.unsigned_abs().min(positions.len() - index - 1);
                positions[index + 1..].rotate_left(removed);
                positions.truncate(positions.len() - removed);
                positions[index + 1..]
                    .iter_mut()
                    .for_each(|it| *it -= removed);
            }
        }
        self.at = end;
    }

    fn apply_context(&mut self, table: Data, is_chained: bool) -> Option<()> {
        let (matchers, mut rules) = rules_for(table, is_chained, self.current().id)?;
        let next = if let Matcher::Coverages(_) = matchers[1] {
            None
        } else {
            self.next_that_must_match()
        };
        let [input, after] = [matchers[1], matchers[2]].map(|it| it.value_of(next?));
        let mut tried = 0;
        let found = rules.find_map(|rule| {
            tried += 1;
            let wanted = rule.parts[1]
                .u16(0)
                .map(|it| (it, input))
                .or_else(|| Some((rule.parts[2].u16(0)?, after)));
            wanted
                .is_none_or(|(value, next)| next.is_none_or(|it| it == value))
                .then_some(())?;
            let positions = self.match_input(rule.parts[1], matchers[1])?;
            let around = [(rule.parts[0], matchers[0]), (rule.parts[2], matchers[2])];
            self.matches_around(around, positions[positions.len() - 1] + 1)
                .then_some((positions, rule))
        });
        let (positions, rule) = spend(tried * 4).and(found)?;
        self.act(positions, rule.actions);
        Some(())
    }

    fn apply_here(&mut self, lookup: &Lookup) -> bool {
        let (glyph, [context, chain, _]) = (self.current().id, self.table.special_kinds());
        if spend(8 + lookup.subtables.len()).is_none() {
            self.buffer.budget = 0;
        }
        lookup
            .subtables
            .iter()
            .filter(|it| it.digest.may_have(glyph))
            .any(|&Subtable { kind, data, .. }| {
                match kind {
                    _ if kind == context || kind == chain => {
                        self.apply_context(data, kind == chain)
                    }
                    _ if self.table.positions => position::apply(self, kind, data),
                    _ => substitute::apply(self, kind, data),
                }
                .is_some()
            })
    }

    pub fn apply(&mut self, index: u16, options: Options) {
        let Some(lookup) = self
            .table
            .lookup(index.into())
            .filter(|it| it.digest.may_meet(&self.digest))
        else {
            return;
        };
        if spend(self.buffer.glyphs.len()).is_none() {
            return;
        }
        (self.options, self.flags, self.last_base) = (options, lookup.flags, (None, 0));
        let applies = |it: &Self, glyph: &Glyph| {
            lookup.digest.may_have(glyph.id)
                && glyph.mask & options.mask != 0
                && it.considers(glyph, lookup.flags)
        };
        if !self.table.positions
            && lookup
                .subtables
                .first()
                .is_some_and(|it| it.kind == substitute::REVERSE)
        {
            for at in (0..self.buffer.glyphs.len()).rev() {
                self.at = at;
                if self.buffer.budget > 0 && applies(self, &self.buffer.glyphs[at]) {
                    self.apply_here(lookup);
                }
            }
            return;
        }
        self.at = 0;
        while let Some(skipped) = self
            .buffer
            .glyphs
            .get(self.at..)
            .and_then(|it| it.iter().position(|it| applies(self, it)))
            && self.buffer.budget > 0
        {
            self.at += skipped;
            if !self.apply_here(lookup) {
                self.at += 1;
            }
        }
    }
}
