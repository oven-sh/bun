//! Picks among equivalent sequences of characters the one that the font has.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use super::buffer::{Buffer, Glyph, HIDDEN, IS_MISSING_SPACE};
use super::{Rules, Shaper, arabic, scripts, syllabic};
use crate::unicode;

const MAX_MARKS: usize = 32;

fn is_selector(glyph: &Glyph) -> bool {
    matches!(glyph.character, 0xFE00..=0xFE0F | 0xE0100..=0xE01EF)
}

fn decompose(
    shaper: &Shaper,
    like: Glyph,
    character: u32,
    is_shortest: bool,
    to: &mut Vec<Glyph>,
) -> Option<()> {
    let (first, second) = syllabic::decompose(shaper.plan.rules, character)?;
    let made = |character: u32| {
        let mut glyph = Glyph {
            id: shaper.font.glyph(character)?,
            ..like
        };
        glyph.set_character(character);
        Some(glyph)
    };
    let (whole, second) = (
        made(first),
        if second == 0 {
            None
        } else {
            Some(made(second)?)
        },
    );
    if (is_shortest && whole.is_some()) || decompose(shaper, like, first, is_shortest, to).is_none()
    {
        to.push(whole?);
    }
    to.extend(second);
    Some(())
}

fn add(shaper: &Shaper, mut glyph: Glyph, is_shortest: bool, to: &mut Vec<Glyph>) {
    let id = shaper.font.glyph(glyph.character);
    if !(is_shortest && id.is_some())
        && decompose(shaper, glyph, glyph.character, is_shortest, to).is_some()
    {
        return;
    }
    let instead = match glyph.character {
        _ if id.is_some() => None,
        0x2011 => shaper.font.glyph(0x2010),
        0x20 | 0xA0 | 0x2000..=0x200A | 0x202F | 0x205F | 0x3000 => shaper
            .font
            .glyph(0x20)
            .inspect(|_| glyph.flags |= IS_MISSING_SPACE),
        _ => None,
    };
    to.push(Glyph {
        id: id.or(instead).unwrap_or(0),
        ..glyph
    });
}

fn add_with_selectors(shaper: &Shaper, glyphs: &[Glyph], to: &mut Vec<Glyph>) {
    let mut rest = glyphs.iter().peekable();
    while let Some(glyph) = rest.next() {
        let variant = rest
            .peek()
            .filter(|it| is_selector(it))
            .and_then(|it| shaper.font.glyph_variant(glyph.character, it.character));
        rest.next_if(|_| variant.is_some());
        to.push(Glyph {
            id: variant
                .or_else(|| shaper.font.glyph(glyph.character))
                .unwrap_or(0),
            ..*glyph
        });
    }
}

fn compose(shaper: &Shaper, first: &Glyph, second: u32) -> Option<u32> {
    let composed = || unicode::compose(first.character, second);
    match shaper.plan.rules {
        Rules::Indic | Rules::Khmer | Rules::Universal if first.is_unicode_mark() => None,
        Rules::Indic if (first.character, second) == (0x9AF, 0x9BC) => Some(0x9DF),
        Rules::Hebrew if shaper.plan.mask(b"mark") == 0 => {
            composed().or_else(|| scripts::hebrew_form(first.character, second))
        }
        _ => composed(),
    }
}

pub fn normalize(shaper: &Shaper, buffer: &mut Buffer) {
    let rules = shaper.plan.rules;
    let never_changes = rules == Rules::Hangul;
    let is_shortest = !matches!(
        rules,
        Rules::Indic | Rules::Khmer | Rules::Myanmar | Rules::Universal
    );
    let known = |glyph: &mut Glyph| {
        shaper
            .font
            .glyph(glyph.character)
            .filter(|_| !glyph.is_unicode_mark())
            .map(|it| glyph.id = it)
            .is_some()
    };
    if is_shortest && buffer.glyphs.iter_mut().all(known) {
        return;
    }
    let input = std::mem::take(&mut buffer.glyphs);
    let (mut start, mut has_marks) = (0, false);
    buffer.glyphs.reserve(input.len());
    while start < input.len() {
        let cluster = &input[start
            ..start
                + 1
                + input[start + 1..]
                    .iter()
                    .take_while(|it| it.is_unicode_mark())
                    .count()];
        start += cluster.len();
        has_marks |= cluster.len() > 1;
        match cluster {
            [glyph] => add(shaper, *glyph, is_shortest, &mut buffer.glyphs),
            _ if cluster.iter().any(is_selector) => {
                add_with_selectors(shaper, cluster, &mut buffer.glyphs)
            }
            _ => cluster
                .iter()
                .for_each(|it| add(shaper, *it, never_changes, &mut buffer.glyphs)),
        }
    }
    if !has_marks {
        return;
    }
    let mut start = 0;
    while start < buffer.glyphs.len() {
        let end = if buffer.glyphs[start].combining == 0 {
            start
        } else {
            buffer.end_of_run(start, |it| it.combining != 0)
        };
        if (1..=MAX_MARKS).contains(&(end - start)) {
            buffer.sort(start..end, |it| it.combining);
            match rules {
                Rules::Arabic => arabic::reorder_marks(buffer, start..end),
                Rules::Hebrew => scripts::reorder_hebrew_marks(buffer, start..end),
                _ => {}
            }
        }
        start = end + 1;
    }
    for index in 1..buffer.glyphs.len().saturating_sub(1) {
        let [before, after] = [index - 1, index + 1].map(|it| buffer.glyphs[it].combining);
        if buffer.glyphs[index].character == 0x34F && (after == 0 || before <= after) {
            buffer.glyphs[index].flags &= !HIDDEN;
        }
    }
    let (mut starter, mut at) = (0, 1);
    while let Some(&glyph) = buffer.glyphs.get(at).filter(|_| !never_changes) {
        let is_reachable = glyph.is_unicode_mark()
            && (starter == at - 1 || buffer.glyphs[at - 1].combining < glyph.combining);
        let composed = is_reachable
            .then(|| compose(shaper, &buffer.glyphs[starter], glyph.character))
            .flatten();
        if let Some((character, id)) = composed.and_then(|it| Some((it, shaper.font.glyph(it)?))) {
            buffer.merge_clusters(starter..at + 1);
            buffer.remove(at);
            buffer.glyphs[starter].id = id;
            buffer.glyphs[starter].set_character(character);
        } else {
            (starter, at) = (if glyph.combining == 0 { at } else { starter }, at + 1);
        }
    }
}
