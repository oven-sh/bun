//! Which script each glyph belongs to.
//!
//! Derived from the auto-hinter of FreeType and its port in skrifa. Copyright (c) The FreeType Project (www.freetype.org),
//! (c) 2019 Fontations Developers. FreeType License and MIT, see `licenses/freetype.txt` and `licenses/fontations.txt`.

use super::scripts::{FEATURES, RANGES, SCRIPTS, Script};
use crate::text::sfnt::work::{limited, spend};
use crate::text::sfnt::{Data, Font, Tag};
use crate::text::shaper::language::script_tags;
use crate::text::shaper::layout::{Subtable, Table, context_layout, coverage, covered, rules_in};
use crate::unicode;

#[derive(Clone, Copy)]
pub struct Style {
    pub script: &'static Script,
    pub feature: Option<&'static Tag>,
}

/// The first one that fits wins.
fn all() -> impl Iterator<Item = Style> + Clone {
    SCRIPTS.iter().flat_map(|script| {
        let features = FEATURES
            .into_iter()
            .filter(|_| matches!(script.tag, b"Cyrl" | b"Grek" | b"Latn"));
        features
            .map(Some)
            .chain([None])
            .map(move |feature| Style { script, feature })
    })
}

const UNKNOWN: u8 = u8::MAX;

pub struct Styles {
    /// An index into `all`, and whether it is a mark.
    of_glyphs: Vec<(u8, bool)>,
}

/// What the lookups of a style make.
struct Outputs<'a> {
    table: &'a Table,
    is_visited: Vec<bool>,
    is_output: Vec<bool>,
    /// The glyphs that tell heights, until it is known that one of them is substituted.
    telling: Option<Vec<u32>>,
}

impl Outputs<'_> {
    fn add(&mut self, glyphs: impl Iterator<Item = u16>) -> Option<()> {
        for glyph in glyphs {
            spend(1)?;
            self.is_output
                .get_mut(usize::from(glyph))
                .into_iter()
                .for_each(|it| *it = true);
        }
        Some(())
    }

    fn visit(&mut self, lookup: u16, depth: usize) -> Option<()> {
        if depth > 64 || std::mem::replace(self.is_visited.get_mut(usize::from(lookup))?, true) {
            return None;
        }
        for subtable in &self.table.lookup(lookup.into())?.subtables {
            self.look_at(subtable, depth);
        }
        Some(())
    }

    fn look_at(&mut self, &Subtable { kind, data, .. }: &Subtable, depth: usize) -> Option<()> {
        let listed = |table: Data, at: usize| table.u16s(at + 2, table.u16(at).unwrap_or(0).into());
        let tables =
            |table: Data, at: usize| listed(table, at).filter_map(move |it| table.from(it.into()));
        match kind {
            1 if data.u16(0)? == 1 => {
                let by = data.u16(4)?;
                self.add(
                    covered(data.at16(2)?)
                        .flat_map(|(first, last)| first..=last)
                        .map(|it| it.wrapping_add(by)),
                )?;
            }
            1 => self.add(listed(data, 4))?,
            2 | 3 => self.add(tables(data, 4).flat_map(|it| listed(it, 0)))?,
            4 => self.add(
                tables(data, 4)
                    .flat_map(|it| tables(it, 0))
                    .filter_map(|it| it.u16(0)),
            )?,
            5 | 6 => {
                let (_, sets, only) = context_layout(data, kind == 6)?;
                let count = if only.is_some() {
                    0
                } else {
                    data.u16(sets)?.into()
                };
                for rule in only
                    .into_iter()
                    .chain((0..count).flat_map(|it| rules_in(data, sets, it, kind == 6)))
                {
                    spend(1 + rule.actions.0.len())?;
                    for lookup in rule.actions.u16s(0, usize::MAX).skip(1).step_by(2) {
                        self.visit(lookup, depth + 1);
                    }
                }
            }
            8 => {
                let after = 6 + usize::from(data.u16(4)?) * 2;
                self.add(listed(data, after + 2 + usize::from(data.u16(after)?) * 2))?;
            }
            _ => {}
        }
        let covered = data.at16(2).filter(|_| kind <= 2 && depth == 1)?;
        self.telling
            .take_if(|it| it.iter().any(|it| coverage(covered, *it).is_some()));
        Some(())
    }
}

impl Styles {
    pub fn new(font: &Font, substitutions: Option<&Table>) -> Styles {
        limited(1 << 25, || Styles::find(font, substitutions))
    }

    fn find(font: &Font, substitutions: Option<&Table>) -> Styles {
        let mut styles = Styles {
            of_glyphs: vec![(UNKNOWN, false); font.glyph_count as usize],
        };
        let plain = || (0..).zip(all()).filter(|it| it.1.feature.is_none());
        let of_scripts: Vec<u8> = plain().map(|it| it.0).collect();
        for (index, style) in (0..).zip(all()).filter(|it| it.1.feature.is_some()) {
            styles.assign_outputs(font, substitutions, index, style, false);
        }
        for (character, glyph) in font.mappings() {
            let range = RANGES
                .get(RANGES.partition_point(|it| it.1 < character))
                .filter(|it| it.0 <= character);
            if let (Some(&(.., script, is_mark)), Some(style)) =
                (range, styles.of_glyphs.get_mut(glyph as usize))
                && of_scripts[usize::from(script)] <= style.0
            {
                *style = (of_scripts[usize::from(script)], style.1 || is_mark);
            }
        }
        for (index, style) in plain() {
            styles.assign_outputs(font, substitutions, index, style, false);
        }
        for (index, style) in plain().filter(|it| it.1.script.tag == b"Latn") {
            styles.assign_outputs(font, substitutions, index, style, true);
        }
        styles
    }

    fn assign_outputs(
        &mut self,
        font: &Font,
        table: Option<&Table>,
        index: u8,
        style: Style,
        is_default: bool,
    ) -> Option<()> {
        let (table, mut tags) = (table?, script_tags(unicode::Script(*style.script.tag)));
        tags.extend(is_default.then_some(*b"DFLT"));
        let mut lookups = table.all_lookups(&tags, style.feature).peekable();
        lookups.peek()?;
        let telling = |_| {
            style
                .script
                .zones
                .iter()
                .flat_map(|it| it.0.chars())
                .filter_map(|it| font.glyph(it.into()))
                .collect()
        };
        let (is_visited, is_output) = (
            vec![false; table.lookup_count()],
            vec![false; self.of_glyphs.len()],
        );
        let mut outputs = Outputs {
            table,
            is_visited,
            is_output,
            telling: style.feature.map(telling),
        };
        for lookup in lookups.take_while(|_| spend(1).is_some()) {
            outputs.visit(lookup, 1);
        }
        for (style, is_output) in self.of_glyphs.iter_mut().zip(outputs.is_output) {
            if is_output && outputs.telling.is_none() && style.0 == UNKNOWN {
                style.0 = index;
            }
        }
        Some(())
    }

    /// An index for `Style::nth`, and whether it is a mark.
    pub fn of(&self, glyph: u32) -> Option<(u8, bool)> {
        self.of_glyphs.get(glyph as usize).copied()
    }
}

impl Style {
    /// What is not known is hinted like ideographs.
    pub fn nth(index: u8) -> Style {
        all().nth(index.into()).unwrap_or(Style {
            script: &SCRIPTS[SCRIPTS.len() - 1],
            feature: None,
        })
    }

    /// The glyphs for `cluster` in this style.
    pub fn shaper(self, font: &Font, table: Option<&Table>) -> impl Fn(&str) -> Vec<u32> {
        let lookups = table.zip(self.feature).and_then(|(table, feature)| {
            let (.., language) =
                table.select(&script_tags(unicode::Script(*self.script.tag)), &[])?;
            let index = language?
                .u16s(6, language?.u16(4)?.into())
                .find(|it| table.feature_tag(*it) == Some(*feature))?;
            Some(
                table
                    .lookups_of(index, None)
                    .take(64)
                    .filter_map(|it| table.lookup(it.into()))
                    .collect::<Vec<_>>(),
            )
        });
        move |cluster| {
            let mut glyphs: Vec<u32> = cluster
                .chars()
                .map(|it| font.glyph(it.into()).unwrap_or(0))
                .collect();
            let mut is_substituted = lookups.is_none();
            for lookup in lookups.iter().flatten() {
                for glyph in &mut glyphs {
                    let by = lookup.subtables.iter().filter(|it| it.kind == 1).find_map(
                        |&Subtable { data, .. }| {
                            let index = coverage(data.at16(2)?, *glyph)?;
                            if data.u16(0)? == 1 {
                                Some((*glyph as u16).wrapping_add(data.u16(4)?))
                            } else {
                                data.u16(6 + index * 2)
                            }
                        },
                    );
                    (*glyph, is_substituted) =
                        (by.map_or(*glyph, u32::from), is_substituted || by.is_some());
                }
            }
            glyphs.retain(|_| is_substituted);
            glyphs
        }
    }
}
