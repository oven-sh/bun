//! Letters that join, in Arabic and other scripts.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use std::ops::Range;

use super::buffer::Buffer;
use super::plan::{Builder, GLOBAL, MANUAL_JOINERS, Plan};
use crate::text::sfnt::{Font, Tag};
use crate::unicode::{self, joining};

const FORMS: [&Tag; 7] = [
    b"isol", b"fina", b"fin2", b"fin3", b"medi", b"med2", b"init",
];
const ISOL: u8 = 0;
const FINA: u8 = 1;
const FIN2: u8 = 2;
const FIN3: u8 = 3;
const MEDI: u8 = 4;
const MED2: u8 = 5;
const INIT: u8 = 6;
const NONE: u8 = 7;

pub fn add_features(builder: &mut Builder) {
    builder.add(&[b"stch"], GLOBAL);
    builder.pause(None);
    builder.add(&[b"ccmp", b"locl"], GLOBAL | MANUAL_JOINERS);
    builder.pause(None);
    for form in FORMS {
        builder.add(&[form], MANUAL_JOINERS);
        builder.pause(None);
    }
    builder.add(&[b"rlig"], GLOBAL | MANUAL_JOINERS);
    builder.pause(None);
    builder.add(&[b"calt"], GLOBAL | MANUAL_JOINERS);
    if !builder.has(b"rclt") {
        builder.pause(None);
    }
    builder.add(&[b"liga", b"clig", b"mset"], GLOBAL | MANUAL_JOINERS);
}

/// The new form of the letter before, the form of this one, and the next state.
fn step(state: u8, character: u32) -> Option<[u8; 3]> {
    let (is_alaph, is_dalath_or_rish) = (
        character == 0x710,
        matches!(character, 0x715 | 0x716 | 0x72A | 0x72F),
    );
    let kind = unicode::joining_type(character);
    let joins_next = matches!(kind, joining::DUAL | joining::CAUSING);
    Some(match (kind, state) {
        (joining::TRANSPARENT, _) => return None,
        (joining::NONE, _) => [NONE, NONE, 0],
        (joining::LEFT, _) => [NONE, ISOL, 2],
        (_, 2 | 3) => {
            let next = if is_alaph {
                4
            } else if is_dalath_or_rish {
                6
            } else if joins_next {
                3
            } else {
                1
            };
            [if state == 2 { INIT } else { MEDI }, FINA, next]
        }
        _ => {
            let before = [NONE, NONE, NONE, NONE, MED2, ISOL, NONE][usize::from(state)];
            match state {
                1.. if is_alaph => [before, if state == 6 { FIN3 } else { FIN2 }, 5],
                _ => [
                    before,
                    ISOL,
                    if is_dalath_or_rish {
                        6
                    } else if joins_next {
                        2
                    } else {
                        1
                    },
                ],
            }
        }
    })
}

/// For fonts that only have the forms as characters.
pub fn use_presentation_forms(font: &Font, plan: &Plan, buffer: &mut Buffer, forms: &[u8]) {
    /// A letter, its isolated form, and how many of that, the final, the initial and the medial form there are in a row.
    #[rustfmt::skip]
    const LETTERS: [(u32, u32, u32); 76] = [
        (0x621, 0xFE80, 1), (0x622, 0xFE81, 2), (0x623, 0xFE83, 2), (0x624, 0xFE85, 2), (0x625, 0xFE87, 2), (0x626, 0xFE89, 4),
        (0x627, 0xFE8D, 2), (0x628, 0xFE8F, 4), (0x629, 0xFE93, 2), (0x62A, 0xFE95, 4), (0x62B, 0xFE99, 4), (0x62C, 0xFE9D, 4),
        (0x62D, 0xFEA1, 4), (0x62E, 0xFEA5, 4), (0x62F, 0xFEA9, 2), (0x630, 0xFEAB, 2), (0x631, 0xFEAD, 2), (0x632, 0xFEAF, 2),
        (0x633, 0xFEB1, 4), (0x634, 0xFEB5, 4), (0x635, 0xFEB9, 4), (0x636, 0xFEBD, 4), (0x637, 0xFEC1, 4), (0x638, 0xFEC5, 4),
        (0x639, 0xFEC9, 4), (0x63A, 0xFECD, 4), (0x641, 0xFED1, 4), (0x642, 0xFED5, 4), (0x643, 0xFED9, 4), (0x644, 0xFEDD, 4),
        (0x645, 0xFEE1, 4), (0x646, 0xFEE5, 4), (0x647, 0xFEE9, 4), (0x648, 0xFEED, 2), (0x649, 0xFEEF, 2), (0x64A, 0xFEF1, 4),
        (0x671, 0xFB50, 2), (0x677, 0xFBDD, 1), (0x679, 0xFB66, 4), (0x67A, 0xFB5E, 4), (0x67B, 0xFB52, 4), (0x67E, 0xFB56, 4),
        (0x67F, 0xFB62, 4), (0x680, 0xFB5A, 4), (0x683, 0xFB76, 4), (0x684, 0xFB72, 4), (0x686, 0xFB7A, 4), (0x687, 0xFB7E, 4),
        (0x688, 0xFB88, 2), (0x68C, 0xFB84, 2), (0x68D, 0xFB82, 2), (0x68E, 0xFB86, 2), (0x691, 0xFB8C, 2), (0x698, 0xFB8A, 2),
        (0x6A4, 0xFB6A, 4), (0x6A6, 0xFB6E, 4), (0x6A9, 0xFB8E, 4), (0x6AD, 0xFBD3, 4), (0x6AF, 0xFB92, 4), (0x6B1, 0xFB9A, 4),
        (0x6B3, 0xFB96, 4), (0x6BA, 0xFB9E, 2), (0x6BB, 0xFBA0, 4), (0x6BE, 0xFBAA, 4), (0x6C0, 0xFBA4, 2), (0x6C1, 0xFBA6, 4),
        (0x6C5, 0xFBE0, 2), (0x6C6, 0xFBD9, 2), (0x6C7, 0xFBD7, 2), (0x6C8, 0xFBDB, 2), (0x6C9, 0xFBE2, 2), (0x6CB, 0xFBDE, 2),
        (0x6CC, 0xFBFC, 4), (0x6D0, 0xFBE4, 4), (0x6D2, 0xFBAE, 2), (0x6D3, 0xFBB0, 2),
    ];
    if plan.script.0 != *b"Arab" || FORMS.iter().any(|it| plan.mask(it) != 0) {
        return;
    }
    for (glyph, form) in buffer.glyphs.iter_mut().zip(forms) {
        let Some(offset) = [ISOL, FINA, INIT, MEDI]
            .iter()
            .position(|it| it == form)
            .map(|it| it as u32)
        else {
            continue;
        };
        let letter = LETTERS
            .binary_search_by_key(&glyph.character, |it| it.0)
            .ok()
            .map(|it| LETTERS[it])
            .filter(|it| offset < it.2);
        let character = letter
            .map(|it| it.1 + offset)
            .or((glyph.character == 0x649).then_some(0xFBE6 + offset));
        glyph.id = character.and_then(|it| font.glyph(it)).unwrap_or(glyph.id);
    }
    for lam in (0..forms.len())
        .rev()
        .filter(|it| matches!(forms[*it], INIT | MEDI))
    {
        let glyphs = &buffer.glyphs;
        let alef = (lam + 1..glyphs.len())
            .find(|it| !glyphs[*it].is_unicode_mark())
            .filter(|_| glyphs[lam].character == 0x644);
        let kind = alef.and_then(|it| {
            [0x622, 0x623, 0x625, 0x627]
                .iter()
                .position(|alef| *alef == glyphs[it].character)
        });
        if let Some((alef, ligature)) = alef.zip(
            kind.and_then(|it| font.glyph(0xFEF5 + it as u32 * 2 + u32::from(forms[lam] == MEDI))),
        ) {
            buffer.merge_clusters(lam..alef + 1);
            buffer.glyphs[lam].id = ligature;
            buffer.replace(alef..alef + 1, []);
        }
    }
}

/// Returns the form of each glyph.
pub fn set_masks(plan: &Plan, buffer: &mut Buffer) -> Vec<u8> {
    let mut state = buffer.context[0]
        .iter()
        .find_map(|it| step(0, *it))
        .map_or(0, |it| it[2]);
    let (mut forms, mut last) = (vec![NONE; buffer.glyphs.len()], None);
    for (index, glyph) in buffer.glyphs.iter().enumerate() {
        let Some([before, form, next]) = step(state, glyph.character) else {
            continue;
        };
        last.filter(|_| before != NONE)
            .into_iter()
            .for_each(|it: usize| forms[it] = before);
        (forms[index], last, state) = (form, Some(index), next);
    }
    if let Some(([before @ ..NONE, ..], last)) = buffer.context[1]
        .iter()
        .find_map(|it| step(state, *it))
        .zip(last)
    {
        forms[last] = before;
    }
    let masks = FORMS.map(|it| plan.bit(it));
    for (index, glyph) in buffer.glyphs.iter_mut().enumerate() {
        if index > 0
            && matches!(glyph.character, 0x180B..=0x180D | 0x180F)
            && plan.script.0 == *b"Mong"
        {
            forms[index] = forms[index - 1];
        }
        glyph.mask |= masks.get(usize::from(forms[index])).unwrap_or(&0);
    }
    forms
}

/// https://www.unicode.org/reports/tr53/
pub fn reorder_marks(buffer: &mut Buffer, Range { mut start, end }: Range<usize>) {
    const MODIFIERS: [u32; 14] = [
        0x654, 0x655, 0x658, 0x6DC, 0x6E3, 0x6E7, 0x6E8, 0x8CA, 0x8CB, 0x8CD, 0x8CE, 0x8CF, 0x8D3,
        0x8F3,
    ];
    let mut at = start;
    for (class, new_class) in [(220, 22), (230, 26)] {
        at += buffer.glyphs[at..end]
            .iter()
            .take_while(|it| it.combining < class)
            .count();
        let count = buffer.glyphs[at..end]
            .iter()
            .take_while(|it| it.combining == class && MODIFIERS.contains(&it.character))
            .count();
        if count > 0 {
            buffer.merge_clusters(start..at + count);
            buffer.glyphs[start..at + count].rotate_right(count);
            buffer.glyphs[start..start + count]
                .iter_mut()
                .for_each(|it| it.combining = new_class);
            (start, at) = (start + count, at + count);
        }
    }
}
