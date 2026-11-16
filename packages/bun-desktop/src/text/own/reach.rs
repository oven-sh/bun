//! How far across a space the rules of a font look.

use super::sfnt::{Data, Font};
use super::shaper::Tables;
use super::shaper::layout::{
    Matcher, Subtable, Table, context_layout, coverage, covered, rules_in,
};

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
    spaces: Vec<u32>,
    reach: Reach,
    budget: usize,
}

fn subtables(table: &Table) -> impl Iterator<Item = &Subtable> {
    (0..table.lookup_count())
        .filter_map(|it| table.lookup(it))
        .flat_map(|it| &it.subtables)
}

fn covered_glyphs(table: Data) -> impl Iterator<Item = u16> {
    table
        .at16(2)
        .into_iter()
        .flat_map(covered)
        .flat_map(|(first, last)| first..=last)
        .take(1 << 16)
}

impl Analysis {
    fn is_space(&self, matcher: Matcher, value: u16) -> bool {
        self.spaces.iter().any(|it| matcher.matches(*it, value))
    }

    /// `parts` are what comes before, the input after `first`, and what comes after it.
    fn note(&mut self, first: u16, parts: [Data; 3], matchers: [Matcher; 3]) -> Option<()> {
        self.budget = self.budget.checked_sub(
            1 + parts.iter().map(|it| it.0.len()).sum::<usize>() * self.spaces.len(),
        )?;
        let [before, rest, after] = [0, 1, 2].map(|part| {
            parts[part]
                .u16s(0, usize::MAX)
                .map(move |it| (matchers[part], it))
        });
        let (input, len) = (
            before.len()..before.len() + 1 + rest.len(),
            before.len() + 1 + rest.len() + after.len(),
        );
        for (position, (matcher, value)) in before
            .rev()
            .chain([(matchers[1], first)])
            .chain(rest)
            .chain(after)
            .enumerate()
        {
            if self.is_space(matcher, value) {
                self.reach.after = self.reach.after.max(if input.start <= position {
                    len - 1 - position
                } else {
                    0
                });
                self.reach.before = self.reach.before.max(if input.end > position + 1 {
                    position
                } else {
                    0
                });
            }
        }
        Some(())
    }

    fn context(&mut self, table: Data, is_chained: bool) -> Option<()> {
        let (matchers, sets, only) = context_layout(table, is_chained)?;
        if let Some(rule) = only {
            return self.note(table.u16(6 + rule.parts[0].0.len())?, rule.parts, matchers);
        }
        let firsts: Vec<u16> = if table.u16(0)? == 1 {
            covered_glyphs(table).collect()
        } else {
            (0..table.u16(sets)?).collect()
        };
        self.budget = self.budget.checked_sub(firsts.len())?;
        for (index, first) in firsts.into_iter().enumerate() {
            rules_in(table, sets, index, is_chained)
                .try_for_each(|rule| self.note(first, rule.parts, matchers))?;
        }
        Some(())
    }

    fn substitute_spaces(&mut self, table: Data) -> Option<()> {
        for index in 0..self.spaces.len() {
            let Some(covered) = coverage(table.at16(2)?, self.spaces[index]) else {
                continue;
            };
            let by = if table.u16(0)? == 1 {
                (self.spaces[index] as u16).wrapping_add(table.u16(4)?)
            } else {
                table.u16(6 + covered * 2)?
            };
            self.spaces
                .extend(Some(u32::from(by)).filter(|it| !self.spaces.contains(it)));
        }
        (self.spaces.len() <= 64).then_some(())
    }

    fn look_at(&mut self, table: &Table, &Subtable { kind, data, .. }: &Subtable) -> Option<()> {
        let [context, chain, _] = table.special_kinds();
        match (table.positions, kind) {
            _ if kind == context || kind == chain => self.context(data, kind == chain)?,
            (false, 4) => {
                for (set, first) in data.u16s(6, data.u16(4)?.into()).zip(covered_glyphs(data)) {
                    let set = data.from(set.into())?;
                    for ligature in set.u16s(2, set.u16(0)?.into()) {
                        let rest = set.part(
                            usize::from(ligature) + 4,
                            usize::from(set.u16(usize::from(ligature) + 2)?.checked_sub(1)?) * 2,
                        )?;
                        self.note(
                            first,
                            [Data::default(), rest, Data::default()],
                            [Matcher::Glyphs; 3],
                        )?;
                    }
                }
            }
            (false, 8) => {
                let before = data.part(6, usize::from(data.u16(4)?) * 2)?;
                let after = data.part(
                    8 + before.0.len(),
                    usize::from(data.u16(6 + before.0.len())?) * 2,
                )?;
                self.note(
                    data.u16(2)?,
                    [before, Data::default(), after],
                    [Matcher::Coverages(data); 3],
                )?;
            }
            (true, 2) if self.is_space(Matcher::Coverages(data), data.u16(2)?) => {
                self.reach.after = self.reach.after.max(1)
            }
            _ => {}
        }
        Some(())
    }
}

/// `None` if there is no telling.
pub fn reach(font: &Font, tables: &Tables, space: u32) -> Option<Reach> {
    if font.table(b"morx").is_some() || font.table(b"kerx").is_some() {
        return None;
    }
    let mut analysis = Analysis {
        spaces: vec![space],
        reach: Reach {
            before: 0,
            after: font.table(b"kern").is_some().into(),
        },
        budget: 1 << 24,
    };
    let singles = tables.layout[0]
        .iter()
        .flat_map(subtables)
        .filter(|it| it.kind == 1);
    { singles }.try_for_each(|it| analysis.substitute_spaces(it.data))?;
    tables
        .layout
        .iter()
        .flatten()
        .try_for_each(|table| subtables(table).try_for_each(|it| analysis.look_at(table, it)))?;
    Some(analysis.reach)
}
