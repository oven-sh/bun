//! `GPOS`
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use super::buffer::{Attachment, Glyph, MULTIPLIED};
use super::layout::{Apply, IGNORE_CLASSES, IGNORE_MARKS, RIGHT_TO_LEFT, class_of, coverage};
use super::{Direction, STEPS_PER_UNIT};
use crate::text::sfnt::Data;

fn value_size(format: u16) -> usize {
    (format & 0xff).count_ones() as usize * 2
}

/// Offsets in `record` are relative to `base`.
fn adjust(context: &mut Apply, index: usize, format: u16, record: Data, base: Data) {
    let is_vertical = context.direction == Direction::Down;
    for (bit, value) in (0..8)
        .filter(|it| format >> it & 1 != 0)
        .zip(record.u16s(0, 8))
        .filter(|it| it.1 != 0)
    {
        let by = match bit {
            ..4 => i32::from(value as i16) * STEPS_PER_UNIT,
            _ => context.device_delta(base.from(value.into())).round() as i32,
        };
        let glyph = &mut context.buffer.glyphs[index];
        match bit % 4 {
            axis @ (0 | 1) => glyph.offset[axis] += by,
            2 if !is_vertical => glyph.advance[0] += by,
            3 if is_vertical => glyph.advance[1] -= by,
            _ => {}
        }
    }
}

fn anchor(context: &Apply, table: Data) -> [f32; 2] {
    let device = |at: usize| table.at16(at).filter(|_| table.u16(0) == Some(3));
    [2, 4].map(|at| {
        (i32::from(table.i16(at).unwrap_or(0)) * STEPS_PER_UNIT) as f32
            + context.device_delta(device(at + 4))
    })
}

fn apply_pair(context: &mut Apply, table: Data, index: usize) -> Option<()> {
    let second = context.find(
        context.at + 1..context.buffer.glyphs.len(),
        context.flags,
        false,
        None,
    )?;
    let ([first_format, second_format], other) = (
        [table.u16(4)?, table.u16(6)?],
        context.buffer.glyphs[second].id,
    );
    let size = value_size(first_format) + value_size(second_format);
    let (record, base) = if table.u16(0)? == 1 {
        let set = table
            .at16(10 + Some(index).filter(|it| Some(*it) < table.u16(8).map(usize::from))? * 2)?;
        let count = usize::from(set.u16(0)?);
        let found = Data::partition(count, |it| {
            set.u16(2 + it * (size + 2))
                .is_some_and(|it| u32::from(it) < other)
        });
        let record = set.part(
            2 + Some(found).filter(|it| *it < count)? * (size + 2),
            size + 2,
        )?;
        (
            record
                .from(2)
                .filter(|_| record.u16(0).map(u32::from) == Some(other))?,
            set,
        )
    } else {
        let (row, column) = (
            class_of(table.at16(8), context.current().id),
            class_of(table.at16(10), other),
        );
        (row < table.u16(12)? && column < table.u16(14)?).then_some(())?;
        (
            table.part(
                16 + (usize::from(row) * usize::from(table.u16(14)?) + usize::from(column)) * size,
                size,
            )?,
            table,
        )
    };
    adjust(context, context.at, first_format, record, base);
    adjust(
        context,
        second,
        second_format,
        record.from(value_size(first_format))?,
        base,
    );
    context.at = second + usize::from(second_format != 0);
    Some(())
}

/// Turns around the chain of glyphs that `child` hangs on.
fn reverse_chain(glyphs: &mut [Glyph], child: usize, across: usize, new_parent: usize) {
    let mut chain = vec![child];
    while let Some(&last) = chain
        .last()
        .filter(|it| glyphs[**it].attachment == Attachment::Cursive)
    {
        let by = std::mem::take(&mut glyphs[last].attached_to);
        match last.checked_add_signed(by.into()) {
            Some(parent) if by != 0 && parent != new_parent && parent < glyphs.len() => {
                chain.push(parent)
            }
            _ => break,
        }
    }
    for &[child, parent] in chain.array_windows().rev() {
        glyphs[parent].offset[across] = -glyphs[child].offset[across];
        (glyphs[parent].attached_to, glyphs[parent].attachment) = (
            (child as isize - parent as isize) as i16,
            Attachment::Cursive,
        );
    }
}

fn apply_cursive(context: &mut Apply, table: Data, index: usize) -> Option<()> {
    let (entry, after) = (table.at16(6 + index * 4)?, context.at);
    let before = context.find((0..after).rev(), context.flags, false, None)?;
    let exit = table.at16(8 + coverage(table.at16(2)?, context.buffer.glyphs[before].id)? * 4)?;
    let (entry, exit) = (anchor(context, entry), anchor(context, exit));
    let (along, glyphs) = (
        usize::from(context.direction == Direction::Down),
        &mut context.buffer.glyphs,
    );
    let (ends, starts) = if context.direction == Direction::Left {
        ((after, entry), (before, exit))
    } else {
        ((before, exit), (after, entry))
    };
    glyphs[ends.0].advance[along] = ends.1[along].round() as i32 + glyphs[ends.0].offset[along];
    let by = starts.1[along].round() as i32 + glyphs[starts.0].offset[along];
    glyphs[starts.0].advance[along] -= by;
    glyphs[starts.0].offset[along] -= by;
    let (across, offset) = (
        1 - along,
        (entry[1 - along] - exit[1 - along]).round() as i32,
    );
    let (child, parent, offset) = if context.flags & RIGHT_TO_LEFT != 0 {
        (before, after, offset)
    } else {
        (after, before, -offset)
    };
    reverse_chain(glyphs, child, across, parent);
    let by = i16::try_from(parent as isize - child as isize).unwrap_or(0);
    (
        glyphs[child].attached_to,
        glyphs[child].attachment,
        glyphs[child].offset[across],
    ) = (by, Attachment::Cursive, offset);
    if glyphs[parent].attached_to == -by {
        (glyphs[parent].attached_to, glyphs[parent].offset[across]) = (0, 0);
    }
    context.at += 1;
    Some(())
}

/// `anchors` has a row for each of the glyphs or components that marks go on.
fn attach(
    context: &mut Apply,
    table: Data,
    mark: usize,
    anchors: Data,
    row: usize,
    to: usize,
) -> Option<()> {
    let (marks, classes) = (table.at16(8)?, usize::from(table.u16(6)?));
    let class = usize::from(marks.u16(2 + mark * 4)?);
    (class < classes && row < anchors.u16(0)?.into()).then_some(())?;
    let (on, own) = (
        anchor(context, anchors.at16(2 + (row * classes + class) * 2)?),
        anchor(context, marks.at16(4 + mark * 4)?),
    );
    let (attached_to, glyph) = (
        i16::try_from(to as isize - context.at as isize).ok()?,
        context.current(),
    );
    (glyph.offset, glyph.attachment, glyph.attached_to) = (
        [0, 1].map(|it| (on[it] - own[it]).round() as i32),
        Attachment::Mark,
        attached_to,
    );
    context.at += 1;
    Some(())
}

fn find_base(context: &mut Apply, accepts: impl Fn(&[Glyph], usize) -> bool) -> Option<usize> {
    let ((last, searched_from), glyphs) = (context.last_base, &context.buffer.glyphs);
    let (last, searched_from) = if searched_from > context.at {
        (None, 0)
    } else {
        (last, searched_from)
    };
    let is_base = |it: &usize| {
        context.is_match(&glyphs[*it], IGNORE_MARKS, false, None) == Some(true)
            && accepts(glyphs, *it)
    };
    context.last_base = (
        (searched_from..context.at).rfind(is_base).or(last),
        context.at,
    );
    context.last_base.0
}

pub fn apply(context: &mut Apply, kind: u16, table: Data) -> Option<()> {
    let index = coverage(table.at16(2)?, context.current().id)?;
    let row_of =
        |context: &Apply, glyph: usize| coverage(table.at16(4)?, context.buffer.glyphs[glyph].id);
    match kind {
        1 => {
            let (format, is_for_all) = (table.u16(4)?, table.u16(0)? == 1);
            (is_for_all || index < table.u16(6)?.into()).then_some(())?;
            adjust(
                context,
                context.at,
                format,
                table.from(if is_for_all {
                    6
                } else {
                    8 + index * value_size(format)
                })?,
                table,
            );
            context.at += 1;
            Some(())
        }
        2 => apply_pair(context, table, index),
        3 => apply_cursive(context, table, index),
        4 => {
            // Only the first of the glyphs that one was replaced with takes marks, unless the font says otherwise.
            let base = find_base(context, |glyphs, at| {
                let (glyph, before) = (&glyphs[at], &glyphs[at.saturating_sub(1)]);
                let goes_on = (glyph.class & before.class & MULTIPLIED != 0
                    && glyph.component() != 0
                    && !before.is_mark())
                    && (glyph.ligature_id(), glyph.component())
                        == (before.ligature_id(), before.component() + 1);
                !goes_on
                    || table
                        .at16(4)
                        .and_then(|it| coverage(it, glyph.id))
                        .is_some()
            })?;
            attach(
                context,
                table,
                index,
                table.at16(10)?,
                row_of(context, base)?,
                base,
            )
        }
        5 => {
            let base = find_base(context, |_, _| true)?;
            let anchors = table.at16(10)?.at16(2 + row_of(context, base)? * 2)?;
            let (count, id, mark) = (
                anchors.u16(0).filter(|it| *it > 0)?,
                context.buffer.glyphs[base].ligature_id(),
                *context.current(),
            );
            let belongs = id != 0 && id == mark.ligature_id() && mark.component() > 0;
            attach(
                context,
                table,
                index,
                anchors,
                usize::from(if belongs {
                    count.min(mark.component().into())
                } else {
                    count
                }) - 1,
                base,
            )
        }
        6 => {
            let base = context.find(
                (0..context.at).rev(),
                context.flags & !IGNORE_CLASSES,
                false,
                None,
            )?;
            let [this, other] = [context.at, base].map(|it| {
                (
                    context.buffer.glyphs[it].ligature_id(),
                    context.buffer.glyphs[it].component(),
                )
            });
            let is_good = if this.0 == other.0 {
                this.0 == 0 || this.1 == other.1
            } else {
                [this, other].iter().any(|it| it.0 > 0 && it.1 == 0)
            };
            (is_good && context.buffer.glyphs[base].is_mark()).then_some(())?;
            attach(
                context,
                table,
                index,
                table.at16(10)?,
                row_of(context, base)?,
                base,
            )
        }
        _ => None,
    }
}

fn follow(glyphs: &mut [Glyph], child: usize, direction: Direction, depth: u32) {
    let by = std::mem::take(&mut glyphs[child].attached_to);
    let Some(parent) = child
        .checked_add_signed(by.into())
        .filter(|it| by != 0 && *it < glyphs.len() && depth > 0)
    else {
        return;
    };
    follow(glyphs, parent, direction, depth - 1);
    if glyphs[child].attachment == Attachment::Cursive {
        let across = usize::from(direction != Direction::Down);
        return glyphs[child].offset[across] += glyphs[parent].offset[across];
    }
    for axis in 0..2 {
        let sum = |glyphs: &[Glyph]| {
            glyphs
                .iter()
                .fold(0i32, |all, it| all.wrapping_add(it.advance[axis]))
        };
        let between = match direction {
            Direction::Left if parent > child => -sum(&glyphs[child + 1..=parent]),
            _ if parent > child => sum(&glyphs[child..parent]),
            Direction::Left => sum(&glyphs[parent + 1..=child]),
            _ => -sum(&glyphs[parent..child]),
        };
        glyphs[child].offset[axis] += glyphs[parent].offset[axis] + between;
    }
}

/// Makes offsets relative to where the glyphs are, instead of to what they are attached to.
pub fn finish(glyphs: &mut [Glyph], direction: Direction) {
    for index in 0..glyphs.len() {
        if glyphs[index].attached_to != 0 {
            follow(glyphs, index, direction, 64);
        }
    }
}
