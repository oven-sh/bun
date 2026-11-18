//! For what a font has no rules or glyphs.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use super::buffer::{Glyph, HIDDEN, IS_MISSING_SPACE, LIGATED};
use super::{Direction, STEPS_PER_UNIT, Shaper};
use crate::unicode::{self, category};

pub fn zero(mark: &mut Glyph, moves: bool) {
    for axis in 0..2 {
        mark.offset[axis] -= if moves { mark.advance[axis] } else { 0 };
        mark.advance[axis] = 0;
    }
}

pub fn size_spaces(shaper: &Shaper, glyphs: &mut [Glyph], direction: Direction) {
    let (em, axis) = (
        i32::from(shaper.font.units_per_em),
        usize::from(direction == Direction::Down),
    );
    let like = |characters: &str| {
        let glyph = characters
            .chars()
            .find_map(|it| shaper.font.glyph(it.into()))?;
        let height = || {
            shaper
                .font
                .vertical_advance(glyph, shaper.coords)
                .map(|it| it as i32 * STEPS_PER_UNIT)
        };
        if axis == 0 {
            Some(shaper.advance(glyph))
        } else {
            height()
        }
    };
    for glyph in glyphs
        .iter_mut()
        .filter(|it| it.flags & IS_MISSING_SPACE != 0 && it.class & LIGATED == 0)
    {
        let part = |of: i32| Some((em + of / 2) / of * STEPS_PER_UNIT);
        let advance = match glyph.character {
            0x2001 | 0x2003 | 0x3000 => part(1),
            0x2000 | 0x2002 => part(2),
            0x2004 => part(3),
            0x2005 => part(4),
            0x2009 => part(5),
            0x2006 => part(6),
            0x200A => part(16),
            0x205F => Some(em * 4 / 18 * STEPS_PER_UNIT),
            0x2007 => like("0123456789"),
            0x2008 => like(".,"),
            0x202F => Some(glyph.advance[axis].abs() / 2),
            _ => None,
        };
        glyph.advance[axis] =
            advance.map_or(glyph.advance[axis], |it| if axis == 0 { it } else { -it });
    }
}

const BELOW: u8 = 220;
const BELOW_RIGHT: u8 = 222;
const ABOVE_LEFT: u8 = 228;
const ABOVE: u8 = 230;
const ABOVE_RIGHT: u8 = 232;

/// By where they go.
pub fn reclassify_marks(glyphs: &mut [Glyph]) {
    for mark in glyphs
        .iter_mut()
        .filter(|it| it.category == category::NON_SPACING_MARK && it.combining < 200)
    {
        mark.combining = match (mark.character, unicode::combining_class(mark.character)) {
            (0xE31 | 0xE34..=0xE37 | 0xE47 | 0xE4C..=0xE4E, _) | (_, 24 | 107) => ABOVE_RIGHT,
            (0xEB1 | 0xEB4..=0xEB7 | 0xEBB | 0xECC | 0xECD, _)
            | (_, 26..=28 | 30 | 31 | 33..=36 | 122 | 130) => ABOVE,
            (0xEBC, _) | (_, 10..=18 | 20 | 22 | 29 | 32 | 118 | 129 | 132) => BELOW,
            (0xE3A, _) | (_, 103) => BELOW_RIGHT,
            (_, 23) => 214,
            (_, 19 | 25) => ABOVE_LEFT,
            (_, class @ (BELOW | ABOVE)) => class,
            _ => mark.combining,
        };
    }
}

#[derive(Clone, Copy)]
struct Extents {
    left: i32,
    width: i32,
    top: i32,
    bottom: i32,
}

fn extents(shaper: &Shaper, glyph: u32) -> Option<Extents> {
    let bounds = shaper.font.bounds(glyph, shaper.coords)?;
    let [left, right, top, bottom] = [
        bounds.x,
        bounds.x + bounds.width,
        bounds.y + bounds.height,
        bounds.y,
    ]
    .map(|it| i32::from(it.round() as i16) * STEPS_PER_UNIT);
    Some(Extents {
        left,
        width: right - left,
        top,
        bottom,
    })
}

fn place(
    shaper: &Shaper,
    mark: &mut Glyph,
    base: &mut Extents,
    direction: Direction,
) -> Option<()> {
    let (own, gap) = (
        extents(shaper, mark.id)?,
        i32::from(shaper.font.units_per_em) / 16 * STEPS_PER_UNIT,
    );
    let (class, height) = (mark.combining, own.top - own.bottom);
    let gap_unless_attached = if class <= 216 { 0 } else { gap };
    let x = match class {
        233 | 234 if direction != Direction::Down => {
            (if direction == Direction::Right {
                base.width
            } else {
                0
            }) - own.width / 2
        }
        200 | 218 | ABOVE_LEFT => 0,
        216 | BELOW_RIGHT | ABOVE_RIGHT => base.width - own.width,
        _ => (base.width - own.width) / 2,
    };
    let y = match class {
        200 | 202 | 218 | BELOW | BELOW_RIGHT | 233 => {
            let y = base.bottom - gap_unless_attached - own.top;
            let kept = if (gap > 0) == (y > 0) { 0 } else { y };
            base.bottom = own.top + kept - height;
            kept
        }
        214 | 216 | ABOVE_LEFT | ABOVE | ABOVE_RIGHT | 234 => {
            let y = base.top + gap_unless_attached - own.bottom;
            let kept = if (gap > 0) != (y > 0) { y + -y / 2 } else { y };
            base.top = own.bottom + kept + height;
            kept
        }
        _ => 0,
    };
    mark.offset = [base.left + x - own.left, y];
    Some(())
}

fn place_around(
    shaper: &Shaper,
    base: &Glyph,
    marks: &mut [Glyph],
    direction: Direction,
    moves: bool,
) {
    let Some(ink) = extents(shaper, base.id) else {
        return marks
            .iter_mut()
            .filter(|it| it.category == category::NON_SPACING_MARK)
            .for_each(|it| zero(it, moves));
    };
    let whole = Extents {
        left: 0,
        width: shaper.advance(base.id),
        top: ink.top + base.offset[1],
        bottom: ink.bottom + base.offset[1],
    };
    let (is_forward, count) = (
        direction != Direction::Left,
        i32::from(base.component_count()),
    );
    let mut offset = if is_forward {
        base.advance.map(|it| -it)
    } else {
        [0; 2]
    };
    let (mut last, mut taken) = (None, whole);
    for mark in marks {
        if mark.combining == 0 {
            offset = [0, 1].map(|it| {
                offset[it]
                    + if is_forward {
                        -mark.advance[it]
                    } else {
                        mark.advance[it]
                    }
            });
            continue;
        }
        let belongs = base.ligature_id() != 0 && base.ligature_id() == mark.ligature_id();
        let component = Some(i32::from(mark.component()) - 1)
            .filter(|it| belongs && *it < count)
            .unwrap_or(count - 1);
        if last.replace((component, mark.combining)) != last {
            let from_left = if shaper.plan.direction == Direction::Left {
                count - 1 - component
            } else {
                component
            };
            taken = Extents {
                left: from_left * whole.width / count.max(1),
                width: whole.width / count.max(1),
                ..whole
            };
        }
        place(shaper, mark, &mut taken, direction);
        (mark.advance, mark.offset) = ([0; 2], [0, 1].map(|it| mark.offset[it] + offset[it]));
    }
}

pub fn place_marks(shaper: &Shaper, glyphs: &mut [Glyph], direction: Direction, moves: bool) {
    for cluster in glyphs.chunk_by_mut(|_, next| {
        next.is_unicode_mark() || next.flags & HIDDEN != 0 || next.is_ignorable()
    }) {
        let marks = cluster.iter().take_while(|it| it.is_unicode_mark()).count();
        if let [base, marks @ ..] = &mut cluster[marks..]
            && !marks.is_empty()
        {
            place_around(shaper, base, marks, direction, moves);
        }
    }
}
