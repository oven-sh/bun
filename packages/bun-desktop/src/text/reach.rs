//! How far across a space the rules of a font look.

use std::ops::Range;

use skrifa::raw::tables::gpos::{PairPos, PositionSubtables};
use skrifa::raw::tables::gsub::{SingleSubst, SubstitutionSubtables};
use skrifa::raw::tables::layout::{
    ChainedSequenceContext, ClassDef, CoverageTable, SequenceContext,
};
use skrifa::raw::types::BigEndian;
use skrifa::raw::{ReadError, TableProvider as _};
use skrifa::{FontRef, GlyphId16, Tag};

/// In characters.
#[derive(Clone, Copy, Default)]
pub struct Reach {
    /// What follows a space depends on this many before it.
    pub before: usize,
    /// A space and what precedes it depend on this many after it.
    pub after: usize,
}

struct Analysis {
    /// With what it can be substituted by.
    spaces: Vec<GlyphId16>,
    reach: Reach,
}

type Result<T = ()> = std::result::Result<T, ReadError>;

impl Analysis {
    /// `rule` says which of its positions match a space, and it changes those in `input`.
    fn note(&mut self, rule: &[bool], input: Range<usize>) {
        for position in (0..rule.len()).filter(|position| rule[*position]) {
            if input.start <= position {
                self.reach.after = self.reach.after.max(rule.len() - 1 - position);
            }
            if input.end > position + 1 {
                self.reach.before = self.reach.before.max(position);
            }
        }
    }

    fn chain(&mut self, backtrack: Vec<bool>, input: Vec<bool>, lookahead: Vec<bool>) {
        let range = backtrack.len()..backtrack.len() + input.len();
        let rule: Vec<_> = backtrack
            .into_iter()
            .rev()
            .chain(input)
            .chain(lookahead)
            .collect();
        self.note(&rule, range);
    }

    fn is_covered(&self, coverage: &CoverageTable) -> bool {
        self.spaces
            .iter()
            .any(|space| coverage.get(*space).is_some())
    }

    fn glyphs(&self, glyphs: &[BigEndian<GlyphId16>]) -> Vec<bool> {
        glyphs
            .iter()
            .map(|glyph| self.spaces.contains(&glyph.get()))
            .collect()
    }

    fn classes(&self, definition: &ClassDef, classes: impl Iterator<Item = u16>) -> Vec<bool> {
        classes
            .map(|class| {
                self.spaces
                    .iter()
                    .any(|space| definition.get(*space) == class)
            })
            .collect()
    }

    fn coverages<'a>(
        &self,
        coverages: impl Iterator<Item = Result<CoverageTable<'a>>>,
    ) -> Result<Vec<bool>> {
        coverages
            .map(|coverage| Ok(self.is_covered(&coverage?)))
            .collect()
    }

    fn context(&mut self, context: &SequenceContext) -> Result {
        match context {
            SequenceContext::Format1(table) => {
                for (first, set) in table.coverage()?.iter().zip(table.seq_rule_sets().iter()) {
                    for rule in set
                        .transpose()?
                        .iter()
                        .flat_map(|set| set.seq_rules().iter())
                    {
                        let input = [
                            vec![self.spaces.contains(&first)],
                            self.glyphs(rule?.input_sequence()),
                        ];
                        self.chain(Vec::new(), input.concat(), Vec::new());
                    }
                }
            }
            SequenceContext::Format2(table) => {
                let definition = table.class_def()?;
                for (first, set) in (0..).zip(table.class_seq_rule_sets().iter()) {
                    for rule in set
                        .transpose()?
                        .iter()
                        .flat_map(|set| set.class_seq_rules().iter())
                    {
                        let rest = rule?.input_sequence().iter().map(BigEndian::get);
                        self.chain(
                            Vec::new(),
                            self.classes(&definition, std::iter::once(first).chain(rest)),
                            Vec::new(),
                        );
                    }
                }
            }
            SequenceContext::Format3(table) => self.chain(
                Vec::new(),
                self.coverages(table.coverages().iter())?,
                Vec::new(),
            ),
        }
        Ok(())
    }

    fn chained_context(&mut self, context: &ChainedSequenceContext) -> Result {
        match context {
            ChainedSequenceContext::Format1(table) => {
                for (first, set) in table
                    .coverage()?
                    .iter()
                    .zip(table.chained_seq_rule_sets().iter())
                {
                    for rule in set
                        .transpose()?
                        .iter()
                        .flat_map(|set| set.chained_seq_rules().iter())
                    {
                        let rule = rule?;
                        let input = [
                            vec![self.spaces.contains(&first)],
                            self.glyphs(rule.input_sequence()),
                        ]
                        .concat();
                        self.chain(
                            self.glyphs(rule.backtrack_sequence()),
                            input,
                            self.glyphs(rule.lookahead_sequence()),
                        );
                    }
                }
            }
            ChainedSequenceContext::Format2(table) => {
                let (before, input, after) = (
                    table.backtrack_class_def()?,
                    table.input_class_def()?,
                    table.lookahead_class_def()?,
                );
                for (first, set) in (0..).zip(table.chained_class_seq_rule_sets().iter()) {
                    for rule in set
                        .transpose()?
                        .iter()
                        .flat_map(|set| set.chained_class_seq_rules().iter())
                    {
                        let rule = rule?;
                        let rest = rule.input_sequence().iter().map(BigEndian::get);
                        self.chain(
                            self.classes(
                                &before,
                                rule.backtrack_sequence().iter().map(BigEndian::get),
                            ),
                            self.classes(&input, std::iter::once(first).chain(rest)),
                            self.classes(
                                &after,
                                rule.lookahead_sequence().iter().map(BigEndian::get),
                            ),
                        );
                    }
                }
            }
            ChainedSequenceContext::Format3(table) => self.chain(
                self.coverages(table.backtrack_coverages().iter())?,
                self.coverages(table.input_coverages().iter())?,
                self.coverages(table.lookahead_coverages().iter())?,
            ),
        }
        Ok(())
    }

    fn substitute_spaces(&mut self, table: &SingleSubst) -> Result {
        for index in 0..self.spaces.len() {
            let space = self.spaces[index];
            let substitute = match table {
                SingleSubst::Format1(table) => (table.coverage()?.get(space)).map(|_| {
                    GlyphId16::new(space.to_u16().wrapping_add_signed(table.delta_glyph_id()))
                }),
                SingleSubst::Format2(table) => (table.coverage()?.get(space)).and_then(|index| {
                    Some(table.substitute_glyph_ids().get(usize::from(index))?.get())
                }),
            };
            self.spaces
                .extend(substitute.filter(|substitute| !self.spaces.contains(substitute)));
        }
        Ok(())
    }

    fn substitutions(&mut self, font: &FontRef) -> Result {
        let Ok(table) = font.gsub() else {
            return Ok(());
        };
        let lookups = table.lookup_list()?.lookups();
        for lookup in lookups.iter() {
            if let SubstitutionSubtables::Single(tables) = lookup?.subtables()? {
                tables
                    .iter()
                    .try_for_each(|table| self.substitute_spaces(&table?))?;
            }
        }
        for lookup in lookups.iter() {
            match lookup?.subtables()? {
                SubstitutionSubtables::Ligature(tables) => {
                    for table in tables.iter() {
                        let table = table?;
                        for (first, set) in
                            table.coverage()?.iter().zip(table.ligature_sets().iter())
                        {
                            for ligature in set?.ligatures().iter() {
                                let rest = self.glyphs(ligature?.component_glyph_ids());
                                self.chain(
                                    Vec::new(),
                                    [vec![self.spaces.contains(&first)], rest].concat(),
                                    Vec::new(),
                                );
                            }
                        }
                    }
                }
                SubstitutionSubtables::Contextual(tables) => {
                    tables.iter().try_for_each(|table| self.context(&table?))?
                }
                SubstitutionSubtables::ChainContextual(tables) => tables
                    .iter()
                    .try_for_each(|table| self.chained_context(&table?))?,
                SubstitutionSubtables::Reverse(tables) => {
                    for table in tables.iter() {
                        let table = table?;
                        self.chain(
                            self.coverages(table.backtrack_coverages().iter())?,
                            vec![self.is_covered(&table.coverage()?)],
                            self.coverages(table.lookahead_coverages().iter())?,
                        );
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn positions(&mut self, font: &FontRef) -> Result {
        let Ok(table) = font.gpos() else {
            return Ok(());
        };
        for lookup in table.lookup_list()?.lookups().iter() {
            match lookup?.subtables()? {
                PositionSubtables::Pair(tables) => {
                    for table in tables.iter() {
                        let coverage = match table? {
                            PairPos::Format1(table) => table.coverage()?,
                            PairPos::Format2(table) => table.coverage()?,
                        };
                        self.note(&[self.is_covered(&coverage), false], 0..2);
                    }
                }
                PositionSubtables::Contextual(tables) => {
                    tables.iter().try_for_each(|table| self.context(&table?))?
                }
                PositionSubtables::ChainContextual(tables) => tables
                    .iter()
                    .try_for_each(|table| self.chained_context(&table?))?,
                _ => {}
            }
        }
        Ok(())
    }
}

/// `None` if there is no telling.
pub fn reach(font: &FontRef, space: u32) -> Option<Reach> {
    let has_table = |tag: &[u8; 4]| font.table_data(Tag::new(tag)).is_some();
    if has_table(b"morx") || has_table(b"kerx") {
        return None;
    }
    let reach = Reach {
        before: 0,
        after: has_table(b"kern").into(),
    };
    let mut analysis = Analysis {
        spaces: vec![GlyphId16::new(space.try_into().ok()?)],
        reach,
    };
    analysis.substitutions(font).ok()?;
    analysis.positions(font).ok()?;
    Some(analysis.reach)
}
