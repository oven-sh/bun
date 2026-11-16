//! Hangul, Hebrew, Thai and Lao.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use std::ops::Range;

use super::Shaper;
use super::buffer::{Buffer, CONTINUES, Glyph};
use super::plan::Plan;
use crate::unicode;

fn made(like: Glyph, character: u32, kind: u8) -> Glyph {
    let mut glyph = Glyph { kind, ..like };
    glyph.set_character(character);
    glyph
}

/// Jamo that stay apart get 1, 2 or 3 as their kind.
pub fn compose_hangul(shaper: &Shaper, buffer: &mut Buffer) {
    const SYLLABLES: Range<u32> = 0xAC00..0xD7A4;
    let has = |character: u32| shaper.font.glyph(character).is_some();
    let is_trailing = |it: u32| matches!(it, 0x11A8..=0x11FF | 0xD7CB..=0xD7FB);
    let (mut at, mut syllable) = (0, 0..0);
    while let Some(&glyph) = buffer.glyphs.get(at) {
        let next = |by: usize| buffer.glyphs.get(at + by).map_or(0, |it| it.character);
        let (character, second, third) = (glyph.character, next(1), next(2));
        let (taken, with) = if matches!(character, 0x302E | 0x302F) {
            let is_spacing = shaper
                .font
                .glyph(character)
                .is_none_or(|it| shaper.advance(it) != 0);
            if !syllable.is_empty() && syllable.end == at {
                if is_spacing {
                    buffer.merge_clusters(syllable.start..at + 1);
                    buffer.glyphs[syllable.start..=at].rotate_right(1);
                }
            } else if has(0x25CC) {
                buffer.replace(
                    at + usize::from(is_spacing)..at + usize::from(is_spacing),
                    [Glyph {
                        character: 0x25CC,
                        ..glyph
                    }],
                );
                at += 1;
            }
            (at, syllable) = (at + 1, 0..0);
            continue;
        } else if matches!(character, 0x1100..=0x115F | 0xA960..=0xA97C)
            && matches!(second, 0x1160..=0x11A7 | 0xD7B0..=0xD7C6)
        {
            let (count, whole) = (
                if is_trailing(third) { 3 } else { 2 },
                unicode::compose(character, second),
            );
            match if count == 3 {
                whole.and_then(|it| unicode::compose(it, third))
            } else {
                whole
            }
            .filter(|it| has(*it))
            {
                Some(whole) => (count, vec![(whole, 0)]),
                None => (
                    count,
                    [(character, 1), (second, 2), (third, 3)][..count].to_vec(),
                ),
            }
        } else if SYLLABLES.contains(&character) {
            let index = character - SYLLABLES.start;
            let parts = [
                (0x1100 + index / 588, 1),
                (0x1161 + index % 588 / 28, 2),
                (0x11A7 + index % 28, 3),
            ];
            let (parts, goes_on) = (
                &parts[..if index.is_multiple_of(28) { 2 } else { 3 }],
                index.is_multiple_of(28) && is_trailing(second),
            );
            match unicode::compose(character, second).filter(|it| goes_on && has(*it)) {
                Some(whole) => (2, vec![(whole, 0)]),
                None if (goes_on || !has(character)) && parts.iter().all(|it| has(it.0)) => (
                    1 + usize::from(goes_on),
                    parts
                        .iter()
                        .copied()
                        .chain(goes_on.then_some((second, 3)))
                        .collect(),
                ),
                None => {
                    (syllable, at) = (if has(character) { at..at + 1 } else { 0..0 }, at + 1);
                    continue;
                }
            }
        } else {
            at += 1;
            continue;
        };
        buffer.merge_clusters(at..at + taken);
        (syllable, buffer.glyphs[at].flags) = (at..at + with.len(), glyph.flags);
        let like = buffer.glyphs[at];
        buffer.replace(
            at..at + taken,
            with.into_iter()
                .map(|(character, kind)| made(like, character, kind)),
        );
        at = syllable.end;
    }
}

pub fn set_hangul_masks(plan: &Plan, buffer: &mut Buffer) {
    let (masks, alternates) = (
        [0, plan.bit(b"ljmo"), plan.bit(b"vjmo"), plan.bit(b"tjmo")],
        plan.mask(b"calt"),
    );
    for glyph in &mut buffer.glyphs {
        let is_jamo =
            matches!(glyph.character, 0x1100..=0x11FF | 0xA960..=0xA97C | 0xD7B0..=0xD7FB);
        glyph.mask = glyph.mask & !if is_jamo { alternates } else { 0 }
            | if is_jamo { 0 } else { alternates }
            | masks[usize::from(glyph.kind)];
    }
}

/// Into a mark, which goes before the tone marks, and a vowel.
pub fn decompose_sara_am(buffer: &mut Buffer) {
    let mut at = 0;
    while let Some(&glyph) = buffer.glyphs.get(at) {
        at += 1;
        if glyph.character & !0x80 != 0xE33 {
            continue;
        }
        let mut mark = made(glyph, glyph.character + 0x1A, 0);
        mark.flags |= CONTINUES;
        buffer.replace(at - 1..at, [mark, made(glyph, glyph.character - 1, 0)]);
        let is_above = |it: &&Glyph| matches!(it.character & !0x80, 0xE31 | 0xE34..=0xE37 | 0xE3B | 0xE47..=0xE4E);
        let start = at
            - 1
            - buffer.glyphs[..at - 1]
                .iter()
                .rev()
                .take_while(is_above)
                .count();
        buffer.glyphs[start..at].rotate_right(1);
        at += 1;
        buffer.merge_clusters(start.saturating_sub(1)..at);
    }
}

/// Old fonts have shifted marks in the private use area.
pub fn shift_thai_marks(shaper: &Shaper, buffer: &mut Buffer) {
    /// The first and the last character, and where Windows and macOS have them, with how far apart they are there.
    type Forms = &'static [[u32; 5]];
    const DOWN: Forms = &[
        [0xE48, 0xE4C, 0xF70A, 0xF88B, 3],
        [0xE38, 0xE3A, 0xF718, 0xF89B, 1],
    ];
    const DOWN_LEFT: Forms = &[[0xE48, 0xE4C, 0xF705, 0xF88C, 3]];
    const LEFT: Forms = &[
        [0xE48, 0xE4C, 0xF713, 0xF88A, 3],
        [0xE31, 0xE31, 0xF710, 0xF884, 1],
        [0xE34, 0xE37, 0xF701, 0xF885, 1],
        [0xE47, 0xE47, 0xF712, 0xF889, 1],
        [0xE4D, 0xE4D, 0xF711, 0xF899, 1],
    ];
    const WITHOUT_DESCENDER: Forms = &[
        [0xE0D, 0xE0D, 0xF70F, 0xF89A, 1],
        [0xE10, 0xE10, 0xF700, 0xF89E, 1],
    ];
    let (mut above, mut below, mut base) = (3, 2, 0);
    for index in 0..buffer.glyphs.len() {
        let next = if above == 1 { 2 } else { 3 };
        let (target, forms) = match buffer.glyphs[index].character {
            0xE31 | 0xE34..=0xE37 | 0xE47 | 0xE4D | 0xE4E => (
                index,
                [&[], LEFT, &[], &[]][std::mem::replace(&mut above, next)],
            ),
            0xE48..=0xE4C => (
                index,
                [DOWN, DOWN_LEFT, LEFT, &[]][std::mem::replace(&mut above, next)],
            ),
            0xE38..=0xE3A => [(index, &[][..]), (base, WITHOUT_DESCENDER), (index, DOWN)]
                [std::mem::replace(&mut below, 2)],
            character => {
                (base, [above, below]) = (
                    index,
                    match character {
                        0xE1B | 0xE1D | 0xE1F => [1, 0],
                        0xE0D | 0xE10 => [0, 1],
                        0xE0E | 0xE0F => [0, 2],
                        0xE01..=0xE2E => [0, 0],
                        _ => [3, 2],
                    },
                );
                continue;
            }
        };
        let character = &mut buffer.glyphs[target].character;
        if let Some([first, _, windows, mac, step]) =
            forms.iter().find(|it| (it[0]..=it[1]).contains(character))
        {
            let forms = [
                windows + *character - first,
                mac + (*character - first) * step,
            ];
            *character = forms
                .into_iter()
                .find(|it| shaper.font.glyph(*it).is_some())
                .unwrap_or(*character);
        }
    }
}

/// The presentation forms that normalization leaves alone, for old fonts.
pub fn hebrew_form(first: u32, second: u32) -> Option<u32> {
    match (first, second) {
        (0xFB2A | 0xFB2B, 0x5BC) => Some(first + 2),
        (0x5F2, _) => None,
        _ => (0xFB1D..=0xFB4E).find(|it| unicode::decompose(*it) == Some((first, second))),
    }
}

pub fn reorder_hebrew_marks(buffer: &mut Buffer, range: Range<usize>) {
    let class = |at: usize| buffer.glyphs[at].combining;
    let is_it = |it: &usize| {
        matches!(
            (class(it - 2), class(it - 1), class(*it)),
            (20 | 21, 22 | 23, 25 | 220)
        )
    };
    if let Some(at) = (range.start + 2..range.end).find(is_it) {
        buffer.merge_clusters(at - 1..at + 1);
        buffer.glyphs.swap(at - 1, at);
    }
}
