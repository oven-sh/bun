//! `GSUB`
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use super::buffer::{BASE, Glyph, LIGATED, LIGATURE, MARK, MULTIPLIED, SUBSTITUTED};
use super::layout::{Apply, Lookup, Matcher, Positions, coverage, rules_for};
use crate::text::sfnt::Data;
use crate::text::sfnt::work::spend;
use crate::unicode::category;

pub const REVERSE: u16 = 8;

/// `how` is `LIGATED`, `MULTIPLIED` or 0, and `guess` is the class if the font does not say.
fn substituted(context: &mut Apply, id: u16, how: u16, guess: u16) -> Glyph {
    const HISTORY: u16 = SUBSTITUTED | LIGATED | MULTIPLIED;
    let (mut glyph, id) = (*context.current(), u32::from(id));
    context.digest.add(id);
    let class = glyph.class & !if how == LIGATED { MULTIPLIED } else { 0 } | SUBSTITUTED | how;
    glyph.class = match context.definitions.classes {
        Some(_) => class & HISTORY | context.definitions.class(id),
        None if guess != 0 => class & HISTORY | guess,
        None => class,
    };
    Glyph { id, ..glyph }
}

fn replace(context: &mut Apply, id: u16) -> Option<()> {
    *context.current() = substituted(context, id, 0, 0);
    context.at += 1;
    Some(())
}

fn multiply(context: &mut Apply, sequence: Data) -> Option<()> {
    let (at, count) = (context.at, usize::from(sequence.u16(0)?));
    match count {
        0 => context.buffer.delete(at),
        1 => replace(context, sequence.u16(2)?)?,
        _ => {
            (context.buffer.glyphs.len() + count <= context.buffer.max_len).then_some(())?;
            let guess = if context.current().class & LIGATURE != 0 {
                BASE
            } else {
                0
            };
            let part = |(index, id): (usize, u16)| {
                let glyph = substituted(context, id, MULTIPLIED, guess);
                Glyph {
                    ligature: if glyph.ligature_id() == 0 {
                        index as u8 & 15
                    } else {
                        glyph.ligature
                    },
                    ..glyph
                }
            };
            let parts: Vec<_> = sequence
                .part(2, count * 2)?
                .u16s(0, count)
                .enumerate()
                .map(part)
                .collect();
            context.buffer.replace(at..at + 1, parts);
            context.at += count;
        }
    }
    Some(())
}

fn ligate(context: &mut Apply, positions: Positions, id: u16) {
    let (at, glyphs) = (context.at, &context.buffer.glyphs);
    let has_only_marks = positions[1..].iter().all(|it| glyphs[*it].is_mark());
    let [is_base, is_mark] =
        [BASE, MARK].map(|class| has_only_marks && glyphs[at].class & class != 0);
    let (is_ligature, total) = (
        !is_base && !is_mark,
        positions.iter().fold(0u8, |all, it| {
            all.wrapping_add(glyphs[*it].component_count())
        }),
    );
    let (mut last_id, mut last_count) = (glyphs[at].ligature_id(), glyphs[at].component_count());
    let (mut so_far, ligature) = (
        last_count,
        if is_ligature {
            context.buffer.next_ligature_id() << 5
        } else {
            0
        },
    );
    context
        .buffer
        .merge_clusters(at..positions[positions.len() - 1] + 1);
    if is_ligature {
        let glyph = context.current();
        glyph.ligature = ligature | 16 | total & 15;
        if glyph.category == category::NON_SPACING_MARK {
            (glyph.category, glyph.combining) = (category::OTHER_LETTER, 0);
        }
    }
    *context.current() = substituted(context, id, LIGATED, if is_ligature { LIGATURE } else { 0 });
    let moved = |component: u8, so_far: u8, last: u8| {
        ligature | so_far.wrapping_sub(last).wrapping_add(component.min(last)) & 15
    };
    let mut next = at + 1;
    for (removed, position) in positions[1..].iter().enumerate() {
        for mark in context.buffer.glyphs[next..position - removed]
            .iter_mut()
            .filter(|_| is_ligature)
        {
            mark.ligature = moved(
                if mark.component() == 0 {
                    last_count
                } else {
                    mark.component()
                },
                so_far,
                last_count,
            );
        }
        next = position - removed;
        let component = context.buffer.remove(next);
        (last_id, last_count) = (component.ligature_id(), component.component_count());
        so_far = so_far.wrapping_add(last_count);
    }
    let follows = |it: &&mut Glyph| {
        !is_mark && last_id != 0 && it.ligature_id() == last_id && it.component() != 0
    };
    context.buffer.glyphs[next..]
        .iter_mut()
        .take_while(follows)
        .for_each(|it| it.ligature = moved(it.component(), so_far, last_count));
    context.at = next;
}

fn ligatures(set: Data) -> impl Iterator<Item = (u16, Data)> {
    let read = move |offset: u16| {
        let ligature = set.from(offset.into())?;
        Some((
            ligature.u16(0)?,
            ligature.part(4, usize::from(ligature.u16(2)?.checked_sub(1)?) * 2)?,
        ))
    };
    set.u16s(2, set.u16(0).unwrap_or(0).into()).filter_map(read)
}

pub fn apply(context: &mut Apply, kind: u16, table: Data) -> Option<()> {
    let glyph = context.current().id;
    let index = coverage(table.at16(2)?, glyph)?;
    let listed = || (Some(index) < table.u16(4).map(usize::from)).then_some(6 + index * 2);
    match kind {
        1 if table.u16(0)? == 1 => replace(context, (glyph as u16).wrapping_add(table.u16(4)?)),
        1 => replace(context, table.u16(listed()?)?),
        2 => multiply(context, table.at16(listed()?)?),
        3 => {
            let (set, mask) = (table.at16(listed()?)?, context.options.mask);
            let (count, mut choice) = (
                u32::from(set.u16(0).filter(|it| *it > 0)?),
                (mask & context.current().mask) >> mask.trailing_zeros(),
            );
            if choice == super::plan::MAX_VALUE && context.options.is_random {
                context.random = context.random.wrapping_mul(48271) % 0x7fff_ffff;
                choice = context.random % count + 1;
            }
            replace(
                context,
                set.u16(Some(choice).filter(|it| (1..=count).contains(it))? as usize * 2)?,
            )
        }
        4 => {
            let next = context.next_that_must_match();
            let is_possible = |(_, rest): &(u16, Data)| {
                rest.u16(0)
                    .zip(next)
                    .is_none_or(|(wanted, next)| u32::from(wanted) == next)
            };
            let matching = |(id, rest)| Some((id, context.match_input(rest, Matcher::Glyphs)?));
            let (id, positions) = ligatures(
                table
                    .at16(listed()?)
                    .filter(|it| spend(it.u16(0).map_or(0, usize::from) * 4).is_some())?,
            )
            .filter(is_possible)
            .find_map(matching)?;
            if positions.len() == 1 {
                return replace(context, id);
            }
            ligate(context, positions, id);
            Some(())
        }
        REVERSE if context.depth == 0 => {
            let before = usize::from(table.u16(4)?) * 2;
            let after = usize::from(table.u16(6 + before)?) * 2;
            let id = table
                .u16(10 + before + after + index * 2)
                .filter(|_| Some(index) < table.u16(8 + before + after).map(usize::from))?;
            let around = [table.part(6, before)?, table.part(8 + before, after)?]
                .map(|it| (it, Matcher::Coverages(table)));
            context
                .matches_around(around, context.at + 1)
                .then(|| replace(context, id))?
        }
        _ => None,
    }
}

/// Whether it does something to just these glyphs.
pub fn would_apply(lookup: &Lookup, glyphs: &[u32], has_no_context: bool) -> bool {
    let is_rest = |rest: Data, matcher: Matcher| {
        rest.0.len() == glyphs.len() * 2 - 2
            && rest
                .u16s(0, 64)
                .zip(&glyphs[1..])
                .all(|(value, glyph)| matcher.matches(*glyph, value))
    };
    lookup.subtables.iter().any(|table| {
        let covered = || coverage(table.data.at16(2)?, glyphs[0]);
        match table.kind {
            4 => covered()
                .and_then(|it| table.data.at16(6 + it * 2))
                .is_some_and(|set| ligatures(set).any(|it| is_rest(it.1, Matcher::Glyphs))),
            5 | 6 => rules_for(table.data, table.kind == 6, glyphs[0]).is_some_and(
                |(matchers, mut rules)| {
                    rules.any(|it| {
                        (!has_no_context || it.parts[0].0.len() + it.parts[2].0.len() == 0)
                            && is_rest(it.parts[1], matchers[1])
                    })
                },
            ),
            _ => glyphs.len() == 1 && covered().is_some(),
        }
    })
}
