//! Apple's tables: `morx`, `kerx`, `kern` and `trak`.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use super::buffer::{Attachment, Buffer, Glyph};
use super::{Direction, Feature, STEPS_PER_UNIT, Shaper};
use crate::text::sfnt::{Data, Tag};

pub const DELETED: u32 = 0xffff;
const STAYS: u16 = 0x4000;
const MARKS: u16 = 0x8000;

/// A value of `size` bytes for a glyph.
fn look_up(table: Data, glyph: u32, size: usize) -> Option<u32> {
    let value = |at: usize, size: usize| {
        Some(
            table
                .part(at, size)?
                .0
                .iter()
                .fold(0, |all, it| all << 8 | u32::from(*it)),
        )
    };
    let glyph = u16::try_from(glyph).ok()?;
    let listed = |at: usize| {
        glyph
            .checked_sub(table.u16(at)?)
            .filter(|it| Some(*it) < table.u16(at + 2))
            .map(usize::from)
    };
    match table.u16(0)? {
        0 => value(2 + usize::from(glyph) * size, size),
        8 => value(6 + listed(2)? * size, size),
        10 => value(
            8 + listed(4)? * usize::from(table.u16(2)?),
            table.u16(2).filter(|it| *it <= 4)?.into(),
        ),
        format => {
            let (step, count) = (usize::from(table.u16(2)?), usize::from(table.u16(4)?));
            let found = Data::partition(count, |it| {
                table.u16(12 + it * step).is_some_and(|it| it < glyph)
            });
            let at = 12 + Some(found).filter(|it| *it < count)? * step;
            let offset = glyph.checked_sub(table.u16(if format == 6 { at } else { at + 2 })?)?;
            match format {
                2 => value(at + 4, size),
                4 => value(
                    usize::from(table.u16(at + 4)?) + usize::from(offset) * size,
                    size,
                ),
                _ => value(at + 2, size).filter(|_| table.u16(at) == Some(glyph)),
            }
        }
    }
}

struct Machine {
    data: Data,
    is_old: bool,
    columns: usize,
    classes: Data,
    states: usize,
    entries: Data,
    entry_size: usize,
}

impl Machine {
    /// Entries have `more` bytes after the flags.
    fn new(data: Data, is_old: bool, more: usize) -> Option<Machine> {
        let field = |index: usize| {
            if is_old {
                data.u16(index * 2).map(usize::from)
            } else {
                data.u32(index * 4).map(|it| it as usize)
            }
        };
        let (columns, classes, entries) = (
            field(0).filter(|it| *it >= 4)?,
            data.from(field(1)?)?,
            data.from(field(3)?)?,
        );
        Some(Machine {
            data,
            is_old,
            columns,
            classes,
            states: field(2)?,
            entries,
            entry_size: 4 + more,
        })
    }

    fn class_of(&self, glyph: u32) -> Option<usize> {
        let class = match self.is_old {
            _ if glyph == DELETED => 2,
            true => {
                let index = glyph
                    .checked_sub(self.classes.u16(0)?.into())
                    .filter(|it| Some(*it) < self.classes.u16(2).map(u32::from))?;
                self.classes.u8(4 + index as usize)?.into()
            }
            false => look_up(self.classes, glyph, 2)? as usize,
        };
        (class < self.columns).then_some(class)
    }

    /// The next state, the flags and the rest.
    fn entry(&self, state: usize, class: usize) -> Option<(usize, u16, Data)> {
        let cell = state * self.columns + class;
        let entry = if self.is_old {
            self.data.u8(self.states + cell)?.into()
        } else {
            usize::from(self.data.u16(self.states + cell * 2)?)
        };
        let entry = self
            .entries
            .part(entry * self.entry_size, self.entry_size)?;
        let next = usize::from(entry.u16(0)?);
        Some((
            if self.is_old {
                next.checked_sub(self.states)? / self.columns
            } else {
                next
            },
            entry.u16(2)?,
            entry.from(4)?,
        ))
    }

    /// Whether a glyph gets it going. `acts` gets the flags of an entry, and whether it refers to an action.
    fn starts_in(&self, buffer: &Buffer, acts: impl Fn(u16, bool) -> bool) -> bool {
        let mut entries = buffer
            .glyphs
            .iter()
            .filter_map(|it| self.entry(0, self.class_of(it.id)?));
        entries.any(|(next, flags, rest)| {
            next != 0 || flags & MARKS != 0 || acts(flags, rest.0.iter().any(|it| *it != 0xff))
        })
    }

    /// `act` gets where the machine is, which may be after the last glyph, and the flags and the rest of an entry.
    fn run(
        &self,
        buffer: &mut Buffer,
        mut act: impl FnMut(&mut Buffer, &mut usize, u16, Data) -> Option<()>,
    ) -> Option<()> {
        let (mut state, mut at) = (0, 0);
        loop {
            let class = buffer
                .glyphs
                .get(at)
                .map_or(0, |it| self.class_of(it.id).unwrap_or(1));
            let (next, flags, rest) = self.entry(state, class)?;
            act(buffer, &mut at, flags, rest);
            (state, buffer.budget) = (next, buffer.budget - 1);
            if at >= buffer.glyphs.len() {
                return Some(());
            }
            at += usize::from(flags & STAYS == 0 || buffer.budget <= 0);
        }
    }
}

/// The type of feature, and the settings that turn it on and off.
fn setting_for(tag: &Tag) -> Option<[u16; 3]> {
    const SETTINGS: [(&Tag, [u16; 3]); 48] = [
        (b"afrc", [11, 1, 0]),
        (b"c2pc", [38, 2, 0]),
        (b"c2sc", [38, 1, 0]),
        (b"calt", [36, 0, 1]),
        (b"case", [33, 0, 1]),
        (b"clig", [1, 18, 19]),
        (b"cpsp", [33, 2, 3]),
        (b"cswh", [36, 4, 5]),
        (b"dlig", [1, 4, 5]),
        (b"expt", [20, 10, 16]),
        (b"frac", [11, 2, 0]),
        (b"fwid", [22, 1, 7]),
        (b"halt", [22, 6, 7]),
        (b"hist", [40, 0, 1]),
        (b"hkna", [34, 0, 1]),
        (b"hlig", [1, 20, 21]),
        (b"hngl", [23, 1, 0]),
        (b"hojo", [20, 12, 16]),
        (b"hwid", [22, 2, 7]),
        (b"ital", [32, 2, 3]),
        (b"jp04", [20, 11, 16]),
        (b"jp78", [20, 2, 16]),
        (b"jp83", [20, 3, 16]),
        (b"jp90", [20, 4, 16]),
        (b"liga", [1, 2, 3]),
        (b"lnum", [21, 1, 2]),
        (b"mgrk", [15, 10, 11]),
        (b"nlck", [20, 13, 16]),
        (b"onum", [21, 0, 2]),
        (b"ordn", [10, 3, 0]),
        (b"palt", [22, 5, 7]),
        (b"pcap", [37, 2, 0]),
        (b"pkna", [22, 0, 7]),
        (b"pnum", [6, 1, 4]),
        (b"pwid", [22, 0, 7]),
        (b"qwid", [22, 4, 7]),
        (b"ruby", [28, 2, 3]),
        (b"sinf", [10, 4, 0]),
        (b"smcp", [37, 1, 0]),
        (b"smpl", [20, 1, 16]),
        (b"subs", [10, 2, 0]),
        (b"sups", [10, 1, 0]),
        (b"swsh", [36, 2, 3]),
        (b"tnum", [6, 0, 4]),
        (b"trad", [20, 0, 16]),
        (b"twid", [22, 3, 7]),
        (b"vert", [4, 0, 1]),
        (b"zero", [14, 4, 5]),
    ];
    if let [b's', b's', tens @ b'0'..=b'2', ones @ b'0'..=b'9'] = *tag {
        let set = u16::from((tens - b'0') * 10 + ones - b'0') * 2;
        return Some([35, set, set + 1]);
    }
    SETTINGS.iter().find(|it| it.0 == tag).map(|it| it.1)
}

fn chains(morx: Data) -> impl Iterator<Item = Data> {
    let mut rest = morx.from(8);
    (0..morx.u32(4).unwrap_or(0)).map_while(move |_| {
        let (chain, len) = (rest?, rest?.u32(4).filter(|it| *it >= 16)? as usize);
        rest = chain.from(len);
        chain.part(0, len)
    })
}

/// Which subtables of each chain apply.
pub fn chain_flags(morx: Data, feat: Option<Data>, features: &[Feature]) -> Vec<u32> {
    let declared = |kind: u16| {
        let records = (0..usize::from(feat?.u16(4)?)).filter_map(|it| feat?.part(12 + it * 12, 12));
        { records }
            .find(|it| it.u16(0) == Some(kind) && it.u16(2) != Some(0))?
            .u16(8)
    };
    let mut wanted: Vec<(u16, u16)> = Vec::new();
    for feature in features {
        let setting = setting_for(&feature.tag)
            .map(|[kind, on, off]| (kind, if feature.value != 0 { on } else { off }));
        let Some((kind, setting)) =
            setting.or((feature.tag == *b"aalt").then_some((17, feature.value as u16)))
        else {
            continue;
        };
        let Some(flags) =
            declared(kind).or_else(|| declared(3).filter(|_| (kind, setting) == (37, 1)))
        else {
            continue;
        };
        if wanted
            .iter()
            .all(|it| it.0 != kind || flags & 0x8000 == 0 && it.1 | 1 != setting | 1)
        {
            wanted.push((kind, setting));
        }
    }
    let flags = |chain: Data| {
        let entries = (0..chain.u32(8)? as usize).map_while(|it| chain.part(16 + it * 12, 12));
        { entries }.try_fold(chain.u32(0)?, |flags, entry| {
            let setting = (entry.u16(0)?, entry.u16(2)?);
            let is_wanted =
                wanted.contains(&setting) || setting == (3, 3) && wanted.contains(&(37, 1));
            Some(if is_wanted {
                flags & entry.u32(8)? | entry.u32(4)?
            } else {
                flags
            })
        })
    };
    chains(morx).map(|it| flags(it).unwrap_or(0)).collect()
}

fn rearrange(table: Data, buffer: &mut Buffer) -> Option<()> {
    /// How many glyphs move from the start and from the end, where 3 stands for two that swap.
    const MOVES: [[usize; 2]; 16] = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 0],
        [3, 0],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 1],
        [3, 1],
        [2, 2],
        [3, 2],
        [2, 3],
        [3, 3],
    ];
    let (mut start, mut end) = (0, 0);
    Machine::new(table, false, 0)
        .filter(|it| it.starts_in(buffer, |flags, _| flags & 15 != 0))?
        .run(buffer, |buffer, at, flags, _| {
            start = if flags & MARKS != 0 { *at } else { start };
            end = if flags & 0x2000 != 0 {
                (*at + 1).min(buffer.glyphs.len())
            } else {
                end
            };
            let [first, last] = MOVES[usize::from(flags & 15)];
            let (left, right) = (first.min(2), last.min(2));
            let count = end
                .checked_sub(start)
                .filter(|it| flags & 15 != 0 && (left + right..=64).contains(it) && *it > 0)?;
            buffer.merge_clusters(start..(*at + 1).min(buffer.glyphs.len()).max(end));
            let glyphs = &mut buffer.glyphs[start..end];
            glyphs.rotate_left(left);
            glyphs[..count - left].rotate_right(right);
            if first == 3 {
                glyphs.swap(count - 1, count - 2);
            }
            if last == 3 {
                glyphs.swap(0, 1);
            }
            Some(())
        })
}

fn replace_in_context(
    table: Data,
    buffer: &mut Buffer,
    set: impl Fn(&mut Glyph, u32),
) -> Option<()> {
    let (lookups, mut mark) = (table.at32(16)?, None);
    Machine::new(table, false, 4)
        .filter(|it| it.starts_in(buffer, |_, refers| refers))?
        .run(buffer, |buffer, at, flags, entry| {
            (*at < buffer.glyphs.len() || mark.is_some()).then_some(())?;
            for (field, index) in [
                (0, mark.unwrap_or(0)),
                (2, (*at).min(buffer.glyphs.len().checked_sub(1)?)),
            ] {
                let lookup = entry
                    .u16(field)
                    .filter(|it| *it != 0xffff)
                    .and_then(|it| lookups.from(lookups.u32(usize::from(it) * 4)? as usize));
                let (Some(lookup), Some(glyph)) = (lookup, buffer.glyphs.get_mut(index)) else {
                    continue;
                };
                look_up(lookup, glyph.id, 2)
                    .into_iter()
                    .for_each(|id| set(glyph, id));
            }
            mark = if flags & MARKS != 0 { Some(*at) } else { mark };
            Some(())
        })
}

fn ligate(table: Data, buffer: &mut Buffer, set: impl Fn(&mut Glyph, u32)) -> Option<()> {
    let (actions, components, ligatures, mut stack) = (
        table.at32(16)?,
        table.at32(20)?,
        table.at32(24)?,
        Vec::new(),
    );
    Machine::new(table, false, 2)
        .filter(|it| it.starts_in(buffer, |flags, _| flags & 0x2000 != 0))?
        .run(buffer, |buffer, at, flags, entry| {
            if flags & MARKS != 0 && stack.last() != Some(at) {
                stack.push(*at);
            }
            (flags & 0x2000 != 0 && !stack.is_empty() && *at < buffer.glyphs.len()).then_some(())?;
            let (mut cursor, mut ligature) = (stack.len(), 0);
            for action in usize::from(entry.u16(0)?).. {
                let Some(before) = cursor.checked_sub(1) else {
                    stack.clear();
                    break;
                };
                let (action, position) = (actions.u32(action * 4)?, stack[before]);
                let component = buffer
                    .glyphs
                    .get(position)?
                    .id
                    .wrapping_add_signed((action << 2) as i32 >> 2);
                (cursor, ligature) = (
                    before,
                    ligature + usize::from(components.u16(component as usize * 2)?),
                );
                if action >> 30 != 0 {
                    set(
                        &mut buffer.glyphs[position],
                        ligatures.u16(ligature * 2)?.into(),
                    );
                    let end = stack[stack.len() - 1] + 1;
                    stack
                        .drain(cursor + 1..)
                        .for_each(|it| buffer.glyphs[it].id = DELETED);
                    buffer.merge_clusters(position..end);
                }
                if action >> 31 != 0 {
                    break;
                }
            }
            Some(())
        })
}

fn insert(table: Data, buffer: &mut Buffer, set: impl Fn(&mut Glyph, u32)) -> Option<()> {
    let (glyphs, mut mark) = (table.at32(16)?, 0);
    let add = |buffer: &mut Buffer, next_to: usize, is_before: bool, first: u16, count: u16| {
        let like = *buffer
            .glyphs
            .get(next_to)
            .or(buffer.glyphs.last())
            .filter(|_| buffer.glyphs.len() < buffer.max_len)?;
        let to = (next_to + usize::from(!is_before)).min(buffer.glyphs.len());
        let added = glyphs
            .part(usize::from(first) * 2, usize::from(count) * 2)?
            .u16s(0, count.into());
        buffer.replace(
            to..to,
            added.map(|id| {
                let mut glyph = like;
                set(&mut glyph, id.into());
                glyph
            }),
        );
        Some(usize::from(count))
    };
    Machine::new(table, false, 4)
        .filter(|it| it.starts_in(buffer, |flags, refers| refers && flags & 0x3ff != 0))?
        .run(buffer, |buffer, at, flags, entry| {
            let here = *at;
            if let Some(first) = entry.u16(2).filter(|it| *it != 0xffff) {
                *at += add(buffer, mark, flags & 0x400 != 0, first, flags & 31).unwrap_or(0);
            }
            mark = if flags & MARKS != 0 { here } else { mark };
            let count = add(
                buffer,
                *at,
                flags & 0x800 != 0,
                entry.u16(0).filter(|it| *it != 0xffff)?,
                flags >> 5 & 31,
            )?;
            *at += if flags & STAYS == 0 { count } else { 0 };
            Some(())
        })
}

pub fn substitute(shaper: &Shaper, flags: &[u32], buffer: &mut Buffer, direction: Direction) {
    let definitions = &shaper.tables.definitions;
    let set = |glyph: &mut Glyph, id: u32| {
        (glyph.id, glyph.class) = (
            id,
            definitions
                .classes
                .map_or(glyph.class, |_| definitions.class(id)),
        );
    };
    for (chain, flags) in shaper.tables.morx.into_iter().flat_map(chains).zip(flags) {
        let mut rest = chain
            .u32(8)
            .and_then(|it| chain.from(16 + it as usize * 12));
        for _ in 0..chain.u32(12).unwrap_or(0) {
            let Some((table, len @ 12.., coverage, when)) =
                rest.and_then(|it| Some((it, it.u32(0)?, it.u32(4)?, it.u32(8)?)))
            else {
                break;
            };
            rest = table.from(len as usize);
            let is_for_direction =
                coverage & 1 << 29 != 0 || (coverage >> 31 != 0) == (direction == Direction::Down);
            let Some(table) = table
                .part(12, len as usize - 12)
                .filter(|_| when & flags != 0 && is_for_direction)
            else {
                continue;
            };
            let is_reversed = (coverage & 1 << 30 != 0)
                != (coverage & 1 << 28 == 0 && direction == Direction::Left);
            if is_reversed {
                buffer.glyphs.reverse();
            }
            match coverage & 0xff {
                0 => rearrange(table, buffer),
                1 => replace_in_context(table, buffer, set),
                2 => ligate(table, buffer, set),
                4 => {
                    for glyph in buffer.glyphs.iter_mut().filter(|it| it.id != DELETED) {
                        look_up(table, glyph.id, 2)
                            .into_iter()
                            .for_each(|id| set(glyph, id));
                    }
                    None
                }
                5 => insert(table, buffer, set),
                _ => None,
            };
            if is_reversed {
                buffer.glyphs.reverse();
            }
        }
    }
}

struct Kerning<'a> {
    shaper: &'a Shaper<'a>,
    mask: u32,
    /// The axis that the text goes along.
    along: usize,
    goes_across: bool,
    /// From a glyph to the one before it in visual order, once they are in logical order again.
    towards_start: i16,
}

impl Kerning<'_> {
    fn pairs(&self, buffer: &mut Buffer, value: impl Fn(u32, u32) -> Option<i16>) -> Option<()> {
        let is_skipped = |it: &Glyph| it.is_mark() || it.is_ignorable();
        let mut first = 0;
        (self.mask != 0).then(|| self.chain(buffer))?;
        while first < buffer.glyphs.len() {
            let glyphs = &mut buffer.glyphs;
            let second = first + 1 + glyphs[first + 1..].iter().position(|it| !is_skipped(it))?;
            let by =
                i32::from(value(glyphs[first].id, glyphs[second].id).unwrap_or(0)) * STEPS_PER_UNIT;
            if self.goes_across && by != 0 {
                glyphs[second].offset[1 - self.along] = by;
            } else {
                glyphs[first].advance[self.along] += by >> 1;
                glyphs[second].advance[self.along] += by - (by >> 1);
                glyphs[second].offset[self.along] += by - (by >> 1);
            }
            first = second;
        }
        Some(())
    }

    fn sorted_pairs(&self, buffer: &mut Buffer, pairs: Data, count: usize) -> Option<()> {
        self.pairs(buffer, |first, second| {
            let found = Data::partition(count, |it| {
                pairs
                    .u32(it * 6)
                    .is_some_and(|it| it < first << 16 | second)
            });
            pairs
                .i16(found * 6 + 4)
                .filter(|_| found < count && pairs.u32(found * 6) == Some(first << 16 | second))
        })
    }

    fn contextual(&self, buffer: &mut Buffer, machine: Data, is_old: bool) -> Option<()> {
        let (mut stack, states) = (
            Vec::new(),
            Machine::new(machine, is_old, if is_old { 0 } else { 2 })?,
        );
        states
            .starts_in(buffer, |flags, refers| {
                refers || is_old && flags & 0x3fff != 0
            })
            .then(|| self.chain(buffer))?;
        states.run(buffer, |buffer, at, flags, entry| {
            let overflows = flags & MARKS != 0 && stack.len() == 8;
            if !is_old && flags & 0x2000 != 0 || overflows {
                stack.clear();
            }
            stack.extend((flags & MARKS != 0 && !overflows).then_some(*at));
            let values = match is_old {
                true => machine.from(Some(flags & 0x3fff).filter(|it| *it != 0)?.into())?,
                false => machine
                    .at32(16)?
                    .from(usize::from(entry.u16(0).filter(|it| *it != 0xffff)? & !1))?,
            };
            for value in values.u16s(0, stack.len()) {
                let Some(glyph) = buffer.glyphs.get_mut(stack.pop()?) else {
                    continue;
                };
                let by = i32::from((value & !1) as i16) * STEPS_PER_UNIT;
                if !self.goes_across {
                    glyph.advance[self.along] += if self.mask != 0 { by } else { 0 };
                    glyph.offset[self.along] += if self.mask != 0 { by } else { 0 };
                } else if value & !1 == 0x8000 {
                    (
                        glyph.attachment,
                        glyph.attached_to,
                        glyph.offset[1 - self.along],
                    ) = (Attachment::None, 0, 0);
                } else if glyph.attachment != Attachment::None {
                    glyph.offset[1 - self.along] += by;
                }
                if value & 1 != 0 {
                    break;
                }
            }
            Some(())
        })
    }

    fn anchored(&self, buffer: &mut Buffer, machine: Data, towards_base: i16) -> Option<()> {
        let (kind, actions, mut mark) = (
            machine.u32(16)? >> 30,
            machine.from(machine.u32(16)? as usize & 0xff_ffff)?,
            None,
        );
        let anchor = |glyph: u32, index: u16| {
            let table = self.shaper.tables.ankr?;
            let anchors = table
                .at32(8)?
                .from(look_up(table.at32(4)?, glyph, 2)? as usize)?;
            anchors.part(
                4 + usize::from(Some(index).filter(|it| Some(u32::from(*it)) < anchors.u32(0))?)
                    * 4,
                4,
            )
        };
        let states = Machine::new(machine, false, 2)?;
        states
            .starts_in(buffer, |_, refers| refers)
            .then(|| self.chain(buffer))?;
        states.run(buffer, |buffer, at, flags, entry| {
            let next = if flags & MARKS != 0 { Some(*at) } else { mark };
            let before = std::mem::replace(&mut mark, next)?;
            let (action, base) = (
                usize::from(entry.u16(0).filter(|it| *it != 0xffff)?),
                buffer.glyphs.get(before)?.id,
            );
            let glyph = buffer.glyphs.get_mut(*at)?;
            let (on, own) = match kind {
                1 => (
                    anchor(base, actions.u16(action * 4)?),
                    anchor(glyph.id, actions.u16(action * 4 + 2)?),
                ),
                2 => (actions.from(action * 8), actions.from(action * 8 + 4)),
                _ => return None,
            };
            let coordinate = |point: Option<Data>, axis: usize| {
                point.and_then(|it| it.i16(axis * 2)).map_or(0, i32::from)
            };
            glyph.offset =
                [0, 1].map(|it| (coordinate(on, it) - coordinate(own, it)) * STEPS_PER_UNIT);
            (glyph.attachment, glyph.attached_to) = (
                Attachment::Mark,
                i16::try_from(before.abs_diff(*at)).ok()? * towards_base,
            );
            Some(())
        })
    }

    /// What moves across the line takes what follows along.
    fn chain(&self, buffer: &mut Buffer) {
        let chains = self.goes_across
            && buffer
                .glyphs
                .iter()
                .all(|it| it.attachment != Attachment::Cursive);
        for glyph in buffer.glyphs.iter_mut().filter(|_| chains) {
            (glyph.attachment, glyph.attached_to) = (Attachment::Cursive, self.towards_start);
        }
    }
}

fn in_visual_order(
    buffer: &mut Buffer,
    direction: Direction,
    apply: impl FnOnce(&mut Buffer) -> Option<()>,
) {
    if direction == Direction::Left {
        buffer.glyphs.reverse();
    }
    apply(buffer);
    if direction == Direction::Left {
        buffer.glyphs.reverse();
    }
}

struct KernTable {
    /// With its header.
    data: Data,
    header: usize,
    format: u8,
    is_horizontal: bool,
    goes_across: bool,
}

fn kern_tables(kern: Data) -> impl Iterator<Item = KernTable> {
    let is_apples = kern.u16(0) == Some(1);
    let (count, header) = if is_apples {
        (kern.u32(4), 8)
    } else {
        (kern.u16(2).map(u32::from), 6)
    };
    let mut rest = kern.from(if is_apples { 8 } else { 4 });
    (0..count.unwrap_or(0)).map_while(move |_| {
        let (data, [a, b]) = (rest?, rest?.u16(4)?.to_be_bytes());
        rest = data.from(
            if is_apples {
                data.u32(0)? as usize
            } else {
                data.u16(2)?.into()
            }
            .max(header),
        );
        Some(match is_apples {
            true => KernTable {
                data,
                header,
                format: if a & 0x20 != 0 { u8::MAX } else { b },
                is_horizontal: a & 0x80 == 0,
                goes_across: a & 0x40 != 0,
            },
            false => KernTable {
                data,
                header,
                format: a,
                is_horizontal: b & 1 != 0,
                goes_across: b & 4 != 0,
            },
        })
    })
}

/// Whether it has a state machine, and whether it moves glyphs across the line.
pub fn kern_traits(kern: Data) -> [bool; 2] {
    [
        kern_tables(kern).any(|it| it.format == 1),
        kern_tables(kern).any(|it| it.goes_across),
    ]
}

fn kerning_mask(shaper: &Shaper, direction: Direction) -> u32 {
    shaper.plan.mask(if direction == Direction::Down {
        b"vkrn"
    } else {
        b"kern"
    })
}

pub fn kern(shaper: &Shaper, buffer: &mut Buffer, direction: Direction) -> Option<()> {
    let (mask, along) = (
        kerning_mask(shaper, direction),
        usize::from(direction == Direction::Down),
    );
    let towards_start = if direction == Direction::Left { 1 } else { -1 };
    for KernTable {
        data,
        header,
        format,
        goes_across,
        ..
    } in kern_tables(shaper.tables.kern?).filter(|it| it.is_horizontal == (along == 0))
    {
        let (kerning, body) = (
            Kerning {
                shaper,
                mask,
                along,
                goes_across,
                towards_start,
            },
            data.from(header)?,
        );
        in_visual_order(buffer, direction, |buffer| match format {
            0 => kerning.sorted_pairs(buffer, body.from(8)?, body.u16(0)?.into()),
            1 => kerning.contextual(buffer, body, true),
            2 => kerning.pairs(buffer, |first, second| {
                let class = |table: Data, glyph: u32| {
                    let index = glyph
                        .checked_sub(table.u16(0)?.into())
                        .filter(|it| Some(*it) < table.u16(2).map(u32::from))?;
                    table.u16(4 + index as usize * 2).map(usize::from)
                };
                let offset = class(data.at16(header + 2)?, first).unwrap_or(0)
                    + class(data.at16(header + 4)?, second).unwrap_or(0);
                data.i16(Some(offset).filter(|it| Some(*it) >= body.u16(6).map(usize::from))?)
            }),
            3 => kerning.pairs(buffer, |first, second| {
                let (glyphs, [values, rows, columns]) = (
                    usize::from(body.u16(0)?),
                    [2, 3, 4].map(|it| usize::from(body.u8(it).unwrap_or(0))),
                );
                let class = |glyph: u32, side: usize| {
                    body.u8(6
                        + values * 2
                        + glyphs * side
                        + Some(glyph as usize).filter(|it| *it < glyphs)?)
                };
                let (row, column) = (
                    usize::from(class(first, 0)?),
                    usize::from(class(second, 1)?),
                );
                (row < rows && column < columns).then_some(())?;
                body.i16(
                    6 + usize::from(body.u8(6 + (values + glyphs) * 2 + row * columns + column)?)
                        * 2,
                )
            }),
            _ => None,
        });
    }
    Some(())
}

pub fn kern_with_kerx(shaper: &Shaper, buffer: &mut Buffer, direction: Direction) -> Option<()> {
    let (mask, along) = (
        kerning_mask(shaper, direction),
        usize::from(direction == Direction::Down),
    );
    let (mut rest, towards_start) = (
        shaper.tables.kerx?.from(8)?,
        if direction == Direction::Left { 1 } else { -1 },
    );
    for _ in 0..shaper.tables.kerx?.u32(4)? {
        let (len, coverage) = (rest.u32(0).filter(|it| *it >= 12)? as usize, rest.u32(4)?);
        let (data, goes_across) = (rest.part(0, len).unwrap_or(rest), coverage & 1 << 30 != 0);
        rest = rest.from(len).unwrap_or_default();
        if (coverage >> 31 != 0) != (along == 1) || coverage & 1 << 29 != 0 {
            continue;
        }
        let (kerning, body) = (
            Kerning {
                shaper,
                mask,
                along,
                goes_across,
                towards_start,
            },
            data.from(12)?,
        );
        let class = |at: usize, glyph: u32, size: usize| {
            look_up(data.at32(at)?, glyph, size).map(|it| it as usize)
        };
        let goes_backwards = coverage & 1 << 28 != 0;
        let order = if goes_backwards == (direction == Direction::Left) {
            Direction::Right
        } else {
            Direction::Left
        };
        in_visual_order(buffer, order, |buffer| match coverage & 0xff {
            0 | 2 | 6 if goes_backwards => Some(kerning.chain(buffer)),
            4 => kerning.anchored(buffer, body, if order == Direction::Left { 1 } else { -1 }),
            0 => kerning.sorted_pairs(buffer, body.from(16)?, body.u32(0)? as usize),
            1 => kerning.contextual(buffer, body, false),
            2 => kerning.pairs(buffer, |first, second| {
                data.at32(24)?
                    .i16((class(16, first, 2)? + class(20, second, 2)?) * 2)
            }),
            6 => {
                let size = if body.u32(0)? & 1 != 0 { 4 } else { 2 };
                kerning.pairs(buffer, |first, second| {
                    data.at32(28)?
                        .i16((class(20, first, size)? + class(24, second, size)? + 1) * size - 2)
                })
            }
            _ => None,
        });
    }
    Some(())
}

/// Spacing that depends on the size.
pub fn track(shaper: &Shaper, glyphs: &mut [Glyph], direction: Direction) -> Option<()> {
    let (table, along) = (
        shaper.tables.trak?,
        usize::from(direction == Direction::Down),
    );
    let data = table.at16(6 + along * 2)?;
    let (count, sizes) = (
        usize::from(data.u16(2)?),
        table.from(data.u32(4)? as usize)?,
    );
    let value = |track: usize| {
        let values = table.from(data.u16(14 + track * 8)?.into())?;
        let entry =
            |index: usize| Some((sizes.fixed(index * 4)?, f32::from(values.i16(index * 2)?)));
        let after = (0..count)
            .position(|it| entry(it).is_some_and(|it| it.0 >= shaper.size))
            .unwrap_or(count);
        let ((from, low), (to, high)) = (
            entry(after.saturating_sub(1))?,
            entry(after.min(count.checked_sub(1)?))?,
        );
        Some(if from < to {
            low + (high - low) * (shaper.size - from) / (to - from)
        } else {
            low
        })
    };
    let (last, track) = (usize::from(data.u16(0)?.checked_sub(1)?), |index: usize| {
        data.fixed(8 + index * 8).unwrap_or(0.)
    });
    let (below, above) = (
        (1..=last).take_while(|it| track(*it) <= 0.).count(),
        last - (0..last).rev().take_while(|it| track(*it) >= 0.).count(),
    );
    let by = match track(above) - track(below) {
        0. => value(below)?,
        span => value(below)? - track(below) / span * (value(above)? - value(below)?),
    };
    let by = (by * STEPS_PER_UNIT as f32).round() as i32;
    glyphs
        .chunk_by_mut(|_, next| next.flags & super::buffer::CONTINUES != 0)
        .for_each(|it| it[0].advance[along] += by);
    Some(())
}
