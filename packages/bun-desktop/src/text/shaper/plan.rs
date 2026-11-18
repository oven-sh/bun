//! Which lookups apply, and in which order.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use std::sync::atomic::AtomicU64;

use super::layout::{Options, Table};
use super::{Direction, Feature, Rules, Tables, arabic, language, syllabic};
use crate::text::sfnt::variations::Coords;
use crate::text::sfnt::{Data, Tag};
use crate::unicode::Script;

pub const MAX_VALUE: u32 = 255;
const GLOBAL_BIT: u32 = 31;

pub const GLOBAL: u8 = 1;
pub const HAS_FALLBACK: u8 = 2;
pub const MANUAL_NON_JOINERS: u8 = 4;
pub const MANUAL_JOINERS: u8 = 8;
pub const MANUAL: u8 = 12;
const ANYWHERE: u8 = 16;
const RANDOM: u8 = 32;
pub const PER_SYLLABLE: u8 = 64;

struct Wanted {
    tag: Tag,
    flags: u8,
    value: u32,
    /// Of the substitutions.
    stage: usize,
}

struct Selected {
    tag: Tag,
    mask: u32,
    stage: usize,
    indexes: [Option<u16>; 2],
}

#[derive(Default)]
pub struct Stage {
    pub lookups: Vec<(u16, Options)>,
    pub then: Option<syllabic::Step>,
}

pub struct Builder<'a> {
    tables: &'a Tables,
    languages: [Option<Data>; 2],
    wanted: Vec<Wanted>,
    steps: Vec<Option<syllabic::Step>>,
}

fn find(table: &Table, language: Option<Data>, tag: &Tag) -> Option<u16> {
    language?
        .u16s(6, language?.u16(4)?.into())
        .find(|it| table.feature_tag(*it) == Some(*tag))
}

impl Builder<'_> {
    pub fn add(&mut self, tags: &[&Tag], flags: u8) {
        self.wanted.extend(tags.iter().map(|tag| Wanted {
            tag: **tag,
            flags,
            value: 1,
            stage: self.steps.len(),
        }));
    }

    fn set(&mut self, tag: &Tag, flags: u8, value: u32) {
        self.wanted.push(Wanted {
            tag: *tag,
            flags: flags | GLOBAL,
            value,
            stage: self.steps.len(),
        });
    }

    pub fn is_on(&self, tag: &Tag) -> bool {
        self.wanted
            .iter()
            .rfind(|it| it.tag == *tag)
            .is_some_and(|it| it.value != 0)
    }

    pub fn disable(&mut self, tag: &Tag) {
        self.set(tag, 0, 0);
    }

    /// What was added so far is done with all of the text first.
    pub fn pause(&mut self, then: Option<syllabic::Step>) {
        self.steps.push(then);
    }

    pub fn has(&self, tag: &Tag) -> bool {
        (0..2).any(|it| {
            self.tables.layout[it]
                .as_ref()
                .and_then(|table| find(table, self.languages[it], tag))
                .is_some()
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kerning {
    None,
    Kern,
    Kerx,
}

pub struct Plan {
    pub script: Script,
    pub direction: Direction,
    /// Unless the script is written either way.
    pub(super) is_leftwards: Option<bool>,
    pub(super) rules: Rules,
    /// In `GSUB`.
    pub chosen_script: Option<Tag>,
    pub global_mask: u32,
    selected: Vec<Selected>,
    pub substitutions: Vec<Stage>,
    pub positions: Vec<(u16, Options)>,
    pub morx_flags: Option<Vec<u32>>,
    pub uses_gpos: bool,
    pub kerning: Kerning,
    /// Of the glyphs that were used last.
    pub(super) advances: [AtomicU64; 256],
    pub zeroes_marks: bool,
    pub moves_zeroed_marks: bool,
    pub places_marks: bool,
}

impl Plan {
    pub fn new(
        tables: &Tables,
        coords: &Coords,
        script: Script,
        direction: Direction,
        language: &[u8],
        features: &[Feature],
    ) -> Plan {
        let (scripts, languages) = (
            language::script_tags(script),
            language::language_tags(language),
        );
        let chosen = [0, 1].map(|it| tables.layout[it].as_ref()?.select(&scripts, &languages));
        let is_horizontal = direction != Direction::Down;
        let uses_morx = tables.morx.is_some() && (is_horizontal || tables.layout[0].is_none());
        let natural_rules = Rules::of(script, is_horizontal, chosen[0].map(|it| it.0));
        let rules = if uses_morx && natural_rules != Rules::Default {
            Rules::None
        } else {
            natural_rules
        };

        let mut builder = Builder {
            tables,
            languages: chosen.map(|it| it?.2),
            wanted: Vec::new(),
            steps: Vec::new(),
        };
        builder.add(&[b"rvrn"], GLOBAL);
        builder.pause(None);
        match direction {
            Direction::Right => builder.add(&[b"ltra", b"ltrm"], GLOBAL),
            Direction::Left => {
                builder.add(&[b"rtla"], GLOBAL);
                builder.add(&[b"rtlm"], 0);
            }
            Direction::Down => {}
        }
        builder.add(&[b"frac", b"numr", b"dnom"], 0);
        builder.set(b"rand", RANDOM, MAX_VALUE);
        builder.add(&[b"Harf", b"HARF"], GLOBAL);
        match rules {
            Rules::Arabic => arabic::add_features(&mut builder),
            Rules::Hangul => builder.add(&[b"ljmo", b"vjmo", b"tjmo"], 0),
            _ => syllabic::add_features(rules, &mut builder),
        }
        builder.add(
            &[
                b"Buzz", b"BUZZ", b"abvm", b"blwm", b"ccmp", b"locl", b"rlig",
            ],
            GLOBAL,
        );
        builder.add(&[b"mark", b"mkmk"], GLOBAL | MANUAL);
        if is_horizontal {
            builder.add(
                &[b"calt", b"clig", b"curs", b"dist", b"liga", b"rclt"],
                GLOBAL,
            );
            builder.add(&[b"kern"], GLOBAL | HAS_FALLBACK);
        } else {
            builder.add(&[b"vert"], GLOBAL | ANYWHERE);
        }
        features
            .iter()
            .for_each(|it| builder.set(&it.tag, 0, it.value));
        syllabic::override_features(rules, &mut builder);

        let Builder {
            languages,
            mut wanted,
            steps,
            ..
        } = builder;
        wanted.sort_by_key(|it| it.tag);
        wanted.dedup_by(|later, first| {
            if later.tag != first.tag {
                return false;
            }
            first.value = if later.flags & GLOBAL != 0 {
                later.value
            } else {
                first.value.max(later.value)
            };
            first.flags = first.flags & !GLOBAL | later.flags & (GLOBAL | HAS_FALLBACK);
            first.stage = first.stage.min(later.stage);
            true
        });
        let required = [0, 1].map(|it| languages[it]?.u16(2).filter(|it| *it != 0xffff));
        let (mut next_bit, mut global_mask, mut required_stage) = (0, 1 << GLOBAL_BIT, 0);
        let (mut selected, mut options) = (Vec::new(), Vec::new());
        for Wanted {
            tag,
            flags,
            value,
            stage,
        } in wanted
        {
            let bits = if flags & GLOBAL != 0 && value == 1 {
                0
            } else {
                (32 - value.leading_zeros()).min(8)
            };
            if value == 0 || next_bit + bits >= GLOBAL_BIT {
                continue;
            }
            if required[0].and_then(|it| tables.layout[0].as_ref()?.feature_tag(it)) == Some(tag) {
                required_stage = stage;
            }
            let mut indexes =
                [0, 1].map(|it| find(tables.layout[it].as_ref()?, languages[it], &tag));
            if indexes == [None; 2] && flags & ANYWHERE != 0 {
                indexes = [0, 1].map(|it| {
                    Some(
                        tables.layout[it]
                            .as_ref()?
                            .features()
                            .position(|it| it == tag)? as u16,
                    )
                });
            }
            if indexes == [None; 2] && flags & HAS_FALLBACK == 0 {
                continue;
            }
            let mask = if bits == 0 {
                1 << GLOBAL_BIT
            } else {
                ((1 << bits) - 1) << next_bit
            };
            global_mask |= if flags & GLOBAL != 0 {
                value << next_bit & mask
            } else {
                0
            };
            next_bit += bits;
            selected.push(Selected {
                tag,
                mask,
                stage,
                indexes,
            });
            options.push(flags);
        }
        let lookups = |table: usize, stage: Option<usize>| {
            let Some(layout) = &tables.layout[table] else {
                return Vec::new();
            };
            let required = required[table]
                .filter(|_| stage.is_none_or(|it| it == required_stage))
                .map(|it| (it, 1 << GLOBAL_BIT, 0));
            let chosen = selected
                .iter()
                .zip(&options)
                .filter(|it| stage.is_none_or(|stage| stage == it.0.stage));
            let features = required.into_iter().chain(
                chosen.filter_map(|(it, flags)| Some((it.indexes[table]?, it.mask, *flags))),
            );
            let (substitutions, mut all) = (layout.substitutions(coords), Vec::new());
            for (feature, mask, flags) in features {
                let options = Options {
                    mask,
                    skips_joiners: flags & MANUAL_JOINERS == 0,
                    skips_non_joiners: flags & MANUAL_NON_JOINERS == 0,
                    is_random: flags & RANDOM != 0,
                    is_per_syllable: flags & PER_SYLLABLE != 0 && table == 0,
                };
                all.extend(
                    layout
                        .lookups_of(feature, substitutions)
                        .map(|it| (it, options)),
                );
            }
            all.sort_by_key(|it| it.0);
            all.dedup_by(|(index, later), (first_index, first)| {
                let is_same = index == first_index;
                if is_same {
                    first.mask |= later.mask;
                    first.skips_joiners &= later.skips_joiners;
                    first.skips_non_joiners &= later.skips_non_joiners;
                }
                is_same
            });
            all
        };
        let stages = steps.into_iter().chain([None]).enumerate();
        let substitutions = stages
            .map(|(index, then)| Stage {
                lookups: lookups(0, Some(index)),
                then,
            })
            .collect();

        let has_gpos = tables.layout[1].is_some()
            && (rules != Rules::Hebrew || chosen[1].is_some_and(|it| it.0 == *b"hebr"));
        let uses_gpos =
            has_gpos && (tables.kerx.is_none() || !uses_morx && tables.layout[0].is_some());
        let kern = selected
            .iter()
            .find(|it| it.tag == *if is_horizontal { b"kern" } else { b"vkrn" });
        let kerning = match tables.kerx {
            _ if uses_gpos && kern.is_some_and(|it| it.indexes[1].is_some()) => Kerning::None,
            Some(_) => Kerning::Kerx,
            None if tables.kern.is_some() && natural_rules.has_fallback_positions() => {
                Kerning::Kern
            }
            None => Kerning::None,
        };
        let [has_machine, goes_across] = tables
            .kern
            .filter(|_| kerning == Kerning::Kern)
            .map_or([false; 2], super::apple::kern_traits);
        let is_unplaced = !uses_gpos && kerning != Kerning::Kerx && !goes_across;
        Plan {
            script,
            direction,
            is_leftwards: super::is_written_leftwards(script),
            rules,
            chosen_script: chosen[0].map(|it| it.0),
            global_mask,
            positions: lookups(1, None),
            substitutions,
            morx_flags: tables
                .morx
                .filter(|_| uses_morx)
                .map(|it| super::apple::chain_flags(it, tables.feat, features)),
            uses_gpos,
            kerning,
            advances: [const { AtomicU64::new(0) }; 256],
            zeroes_marks: natural_rules.zeroes_marks().is_some()
                && kerning != Kerning::Kerx
                && !has_machine,
            moves_zeroed_marks: is_unplaced && !uses_morx,
            places_marks: is_unplaced && natural_rules.has_fallback_positions(),
            selected,
        }
    }

    pub fn mask(&self, tag: &Tag) -> u32 {
        self.selected
            .binary_search_by_key(tag, |it| it.tag)
            .map_or(0, |it| self.selected[it].mask)
    }

    /// For the value 1.
    pub fn bit(&self, tag: &Tag) -> u32 {
        self.mask(tag).isolate_lowest_one()
    }

    /// Those of the stage in which a feature substitutes.
    pub fn lookups_with(&self, tag: &Tag) -> &[(u16, Options)] {
        self.selected
            .binary_search_by_key(tag, |it| it.tag)
            .map_or(&[], |it| {
                &self.substitutions[self.selected[it].stage].lookups
            })
    }
}
