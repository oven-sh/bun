//! Remembers how words were shaped.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::ops::Range;

use super::breaks::{flags_in_ascii, is_letter};
use super::fonts::{Face, is_default_ignorable};
use super::pages::Pages;
use super::reach::Reach;
use super::shaper::{Buffer, Direction, Feature, Glyph, Plan, Shaper};
use crate::abi::{Letter, NO_GLYPH};
use crate::hash::{FastHasher, FastMap, keyed, keyed_words};
use crate::unicode::{Script, stands_alone};

/// In steps.
#[derive(Clone, Copy)]
pub struct Placed {
    pub cluster: u32,
    pub advance: i32,
    pub id: u16,
    pub dx: i32,
    pub dy: i32,
}

#[derive(Clone, Copy)]
pub struct Shaping<'a> {
    pub face: &'static Face,
    pub size: f32,
    pub script: Script,
    pub is_rtl: bool,
    pub is_vertical: bool,
    pub capitalizes: bool,
    pub language: &'a [u8],
    pub features: &'a [Feature],
    pub features_hash: u64,
}

impl Shaping<'_> {
    fn with_shaper<T>(&self, work: impl FnOnce(&Shaper) -> T) -> T {
        let direction = match (self.is_vertical, self.is_rtl) {
            (true, _) => Direction::Down,
            (_, true) => Direction::Left,
            _ => Direction::Right,
        };
        let Face { file, coords, .. } = *self.face;
        let plan = self
            .face
            .plan((self.script, self.is_rtl, self.features_hash), || {
                Plan::new(
                    &file.tables,
                    coords,
                    self.script,
                    direction,
                    self.language,
                    self.features,
                )
            });
        work(&Shaper {
            font: &file.font,
            tables: &file.tables,
            coords,
            plan: &plan,
            size: self.size,
        })
    }

    fn run(&self, text: &str, range: Range<usize>, buffer: &mut Buffer, to: &mut Vec<Placed>) {
        buffer.glyphs.clear();
        for (offset, character) in text[range.clone()].char_indices() {
            let glyph = |it: char| Glyph {
                character: it.into(),
                cluster: (range.start + offset) as u32,
                ..Glyph::default()
            };
            match self.capitalizes {
                true => buffer.glyphs.extend(character.to_uppercase().map(glyph)),
                false => buffer.glyphs.push(glyph(character)),
            }
        }
        buffer.context.iter_mut().for_each(Vec::clear);
        buffer.context[0].extend(text[..range.start].chars().rev().take(5).map(u32::from));
        buffer.context[1].extend(text[range.end..].chars().take(5).map(u32::from));
        self.with_shaper(|it| it.shape(buffer));
        to.extend(buffer.glyphs.iter().map(|it| Placed {
            cluster: it.cluster,
            advance: it.advance[0] - it.advance[1],
            id: it.id as u16,
            dx: it.offset[0],
            dy: it.offset[1],
        }));
    }

    fn is_syllabic(&self) -> bool {
        matches!(&self.script.0, b"Hani" | b"Hira" | b"Kana" | b"Hang")
    }

    fn goes_by_characters(&self, item: &str) -> bool {
        self.is_syllabic()
            && !self.is_rtl
            && !self.is_vertical
            && !self.capitalizes
            && !item.is_ascii()
    }

    /// If words are shaped one by one.
    fn reach(&self) -> Option<Reach> {
        const MAX_REACH: usize = 12;
        let joins = self.script.0 == *b"Arab";
        let has_words = if self.is_rtl {
            joins || self.script.0 == *b"Hebr"
        } else {
            self.is_syllabic() || matches!(&self.script.0, b"Latn" | b"Zyyy" | b"Cyrl" | b"Grek")
        };
        // The form of a letter depends on the next one, which a mark may be in front of.
        let further = |it: usize| if joins && it > 0 { it + 2 } else { it };
        let reach = has_words
            .then(|| self.face.file.reach())
            .flatten()
            .map(|it| Reach {
                before: further(it.before),
                after: further(it.after),
            });
        reach.filter(|reach| reach.before + reach.after <= MAX_REACH)
    }

    /// Whether what is around an item makes no difference.
    fn ignores_context(&self) -> bool {
        matches!(
            &self.script.0,
            b"Latn"
                | b"Zyyy"
                | b"Cyrl"
                | b"Grek"
                | b"Hebr"
                | b"Armn"
                | b"Geor"
                | b"Ethi"
                | b"Thai"
                | b"Laoo"
                | b"Khmr"
                | b"Mymr"
                | b"Tibt"
                | b"Sinh"
        ) || matches!(
            &self.script.0,
            b"Deva" | b"Beng" | b"Guru" | b"Gujr" | b"Orya" | b"Taml" | b"Telu" | b"Knda" | b"Mlym"
        ) || self.is_syllabic()
    }

    /// Whether `Words::shape` may start inside of the item.
    pub fn is_local(&self, item: &str) -> bool {
        self.goes_by_characters(item) || self.reach().is_some()
    }

    fn identity(&self) -> u64 {
        let size = if self.face.file.has_tracking {
            self.size.to_bits()
        } else {
            0
        };
        let script = u64::from(u32::from_ne_bytes(self.script.0)) << 1 | u64::from(self.is_rtl);
        keyed_words([
            u64::from(self.face.id) << 32 | u64::from(size),
            self.features_hash,
            script,
        ])
    }
}

const UNKNOWN: f32 = 0.;
const END: u8 = 0;

/// In most text, the advance of a glyph depends on the next one.
struct Pairs {
    ascii: Box<[[Pair; 128]; 128]>,
    others: Others<6>,
}

/// By so many low bits of the two, or empty. They have the advance, the high bits and the glyph.
#[derive(Default)]
struct Others<const BITS: u32>(Vec<u64>);

impl<const BITS: u32> Others<BITS> {
    const COMPLEX: u64 = (1 << 28) - 1;

    #[inline(always)]
    fn get(
        &mut self,
        shaping: &Shaping,
        first: char,
        second: Option<char>,
        buffer: &mut Buffer,
    ) -> Option<Pair> {
        let ([a, b], low) = (
            [
                u64::from(first),
                second.map_or(0, |it| u64::from(it).max(1)),
            ],
            (1 << BITS) - 1,
        );
        (a | b < 1 << 16).then_some(())?;
        let (slot, high) = (
            ((a & low) << BITS | b & low) as usize,
            a >> BITS << 10 | b >> BITS,
        );
        let known = self
            .0
            .get(slot)
            .copied()
            .filter(|it| it >> 16 & 0xf_ffff == high && it >> 36 != 0);
        let known = known.unwrap_or_else(|| {
            let learned = Pairs::learn(
                shaping,
                &String::from_iter([first].into_iter().chain(second)),
                buffer,
            );
            let (glyph, advance) = learned.map_or((0, Self::COMPLEX), |it| {
                (it.0, (it.1 as u64).min(Self::COMPLEX))
            });
            if self.0.is_empty() {
                self.0 = vec![0; 1 << (2 * BITS)];
            }
            self.0[slot] = advance << 36 | high << 16 | u64::from(glyph);
            self.0[slot]
        });
        (known >> 36 != Self::COMPLEX).then_some(Pair {
            advance: (known >> 36) as i32 as f32,
            glyph: known as u16,
            flags: [0; 2],
        })
    }
}

#[derive(Clone, Copy, Default)]
#[repr(C)]
struct Pair {
    advance: f32,
    glyph: u16,
    /// What follows from the two for each.
    flags: [u8; 2],
}

/// One for each cluster of an item. Those that are left to `Placed` stay `UNSPELLED`. The flags of what is not ASCII, and of what follows it, are there.
pub struct Spelling<'a> {
    pub letters: &'a mut [Letter],
    /// How many have been dealt with, and how many of them were left.
    pub done: usize,
    pub left: usize,
    /// Where characters go on with a cluster.
    pub joined: &'a [u32],
    pub scale: f32,
    pub spacing: f32,
    pub face: u8,
}

pub const UNSPELLED: Letter = Letter {
    advance: f32::MIN,
    glyph: NO_GLYPH,
    flags: 0,
    face: 0,
};

impl Spelling<'_> {
    pub fn count(&self, text: &str, range: Range<usize>) -> usize {
        let before = |offset: usize| self.joined.partition_point(|it| (*it as usize) < offset);
        text[range.clone()].chars().count() - (before(range.end) - before(range.start))
    }

    fn leave(&mut self, count: usize) {
        (self.done, self.left) = (self.done + count, self.left + count);
    }

    #[inline(always)]
    fn put(&mut self, glyph: u16, advance: f32, flags: u8) {
        let letter = &mut self.letters[self.done];
        *letter = Letter {
            advance: advance * self.scale + self.spacing,
            glyph,
            flags: letter.flags | flags,
            face: self.face,
        };
        self.done += 1;
    }

    fn take_back(&mut self, count: usize) {
        self.letters[self.done - count..self.done]
            .iter_mut()
            .for_each(|it| it.advance = UNSPELLED.advance);
        self.done -= count;
    }
}

/// Whether nothing but the tables of the font decides on what becomes of it.
fn is_ordinary(character: char) -> bool {
    matches!(character, ' '..='~')
        || character >= '\u{a0}'
            && character != '\u{2044}'
            && stands_alone(character)
            && !is_default_ignorable(character)
}

/// Where the text is so many characters before `at`, but not before `least`.
fn back(text: &str, at: usize, count: usize, least: usize) -> usize {
    let bytes = at.saturating_sub(count).max(least);
    match text.as_bytes()[bytes..at].is_ascii() {
        true => bytes,
        false => {
            at - text[least..at]
                .chars()
                .rev()
                .take(count)
                .map(char::len_utf8)
                .sum::<usize>()
        }
    }
}

impl Pairs {
    /// The glyph and the advance of the first character of one or two.
    #[cold]
    fn learn(shaping: &Shaping, text: &str, buffer: &mut Buffer) -> Option<(u16, i32)> {
        let mut placed = Vec::new();
        text.chars().all(is_ordinary).then_some(())?;
        shaping.run(text, 0..text.len(), buffer, &mut placed);
        let only_kerns = shaping.with_shaper(|it| {
            let mut glyphs = text
                .chars()
                .map(|character| it.font.glyph(character.into()));
            let (first, next) = (glyphs.next().flatten(), glyphs.next());
            first.is_some_and(|first| next != Some(None) && it.only_kerns(first, next.flatten()))
        });
        placed
            .first()
            .filter(|it| {
                only_kerns && (it.dx, it.dy) == (0, 0) && it.advance > 0 && it.id != NO_GLYPH
            })
            .map(|it| (it.id, it.advance))
    }

    /// Of the character at `at` and the next one. Also returns how long the first one is.
    fn get(
        &mut self,
        shaping: &Shaping,
        text: &str,
        at: usize,
        buffer: &mut Buffer,
    ) -> Option<(Pair, usize)> {
        let bytes = text.as_bytes();
        let (first, second) = (
            bytes[at],
            bytes.get(at + 1).map_or(END, |it| (*it).max(END + 1)),
        );
        let Some(pair) = self
            .ascii
            .get_mut(usize::from(first))
            .and_then(|it| it.get_mut(usize::from(second)))
        else {
            let mut characters = text[at..].chars();
            let first = characters.next()?;
            return Some((
                self.others.get(shaping, first, characters.next(), buffer)?,
                first.len_utf8(),
            ));
        };
        if pair.advance == UNKNOWN {
            let both = &text[at..text.len().min(at + 2)];
            let flags = [
                flags_in_ascii(both.as_bytes(), 0),
                if second == END {
                    0
                } else {
                    flags_in_ascii(both.as_bytes(), 1)
                },
            ];
            *pair = Pairs::learn(shaping, both, buffer).map_or(
                Pair {
                    advance: -1.,
                    ..Pair::default()
                },
                |(glyph, advance)| Pair {
                    advance: advance as f32,
                    glyph,
                    flags,
                },
            );
        }
        Some((*pair, 1)).filter(|it| it.0.advance > 0.)
    }

    /// Returns how many characters it has done.
    #[inline(always)]
    fn follow(&self, text: &[u8], mut put: impl FnMut(usize, Pair)) -> usize {
        let Some(mut row) = text.first().and_then(|it| self.ascii.get(usize::from(*it))) else {
            return 0;
        };
        for (index, second) in text[1..].iter().map(|it| usize::from(*it)).enumerate() {
            match row.get(second) {
                Some(pair) if pair.advance > 0. && second != usize::from(END) => put(index, *pair),
                _ => return index,
            }
            row = &self.ascii[second];
        }
        text.len() - 1
    }

    #[inline(never)]
    fn spell(
        &self,
        text: &[u8],
        letters: &mut [Letter],
        flags: u8,
        [scale, spacing]: [f32; 2],
        face: u8,
    ) -> usize {
        let Some(mut row) = text.first().and_then(|it| self.ascii.get(usize::from(*it))) else {
            return 0;
        };
        let (face, mut carried) = (u32::from(face) << 24, u32::from(flags) << 16);
        for (index, (second, letter)) in text[1..].iter().zip(letters).enumerate() {
            let pair = row[usize::from(second & 0x7f)];
            if *second as i8 <= 0 || pair.advance.to_bits() as i32 <= 0 {
                return index;
            }
            let rest = u32::from(pair.glyph)
                | u32::from(pair.flags[0]) << 16
                | u32::from(pair.flags[1]) << 24;
            let own = rest & 0xff_ffff | carried | face;
            *letter = Letter {
                advance: pair.advance * scale + spacing,
                glyph: own as u16,
                flags: (own >> 16) as u8,
                face: (own >> 24) as u8,
            };
            (carried, row) = (
                rest >> 8 & 0xff_0000,
                &self.ascii[usize::from(second & 0x7f)],
            );
        }
        text.len() - 1
    }

    /// While one of two is not ASCII. Returns where it has stopped.
    #[inline(never)]
    fn spell_others(
        &mut self,
        shaping: &Shaping,
        text: &str,
        mut at: usize,
        buffer: &mut Buffer,
        spelling: &mut Spelling,
    ) -> usize {
        let mut characters = text[at..].chars();
        let Some(mut first) = characters.next() else {
            return at;
        };
        for second in characters {
            let Some(pair) = (!first.is_ascii() || !second.is_ascii())
                .then(|| self.others.get(shaping, first, Some(second), buffer))
                .flatten()
            else {
                break;
            };
            spelling.put(
                pair.glyph,
                pair.advance,
                if first.is_ascii() {
                    flags_in_ascii(text.as_bytes(), at)
                } else {
                    0
                },
            );
            (at, first) = (at + first.len_utf8(), second);
        }
        at
    }

    /// Returns where the words end that it has shaped from `start` on.
    fn shape(
        &mut self,
        shaping: &Shaping,
        whole: &str,
        (start, item, reach): (usize, &Range<usize>, Reach),
        buffer: &mut Buffer,
        spelling: &mut Option<&mut Spelling>,
        to: &mut Vec<Placed>,
    ) -> usize {
        let (text, mut at) = (
            &whole[..item.end],
            back(whole, start, reach.before + 1, item.start),
        );
        let bytes = text.as_bytes();
        while at < text.len() {
            let Some((pair, len)) = self.get(shaping, text, at, buffer) else {
                let unaffected =
                    &bytes[start..back(text, at.max(start), reach.after.max(1) - 1, start)];
                let end = start
                    + unaffected
                        .iter()
                        .rposition(|it| *it == b' ')
                        .map_or(0, |it| it + 1);
                let extra = text[end..at.max(end)].chars().count();
                match spelling {
                    Some(it) => it.take_back(extra),
                    None => to.truncate(to.len() - extra),
                }
                return end;
            };
            let mut place = |at: usize, it: Pair| {
                to.push(Placed {
                    cluster: at as u32,
                    advance: it.advance as i32,
                    id: it.glyph,
                    dx: 0,
                    dy: 0,
                })
            };
            at += len;
            match spelling {
                _ if at <= start => {}
                Some(it) => {
                    it.put(pair.glyph, pair.advance, flags_in_ascii(bytes, at - len));
                    if bytes.get(at - 1..at + 1).is_some_and(|it| !it.is_ascii()) {
                        at = self.spell_others(shaping, text, at, buffer, it);
                    }
                    let Some(flags) = it
                        .letters
                        .get(it.done)
                        .filter(|_| at < text.len())
                        .map(|it| it.flags | flags_in_ascii(bytes, at))
                    else {
                        continue;
                    };
                    let count = self.spell(
                        &bytes[at..],
                        &mut it.letters[it.done..],
                        flags,
                        [it.scale, it.spacing],
                        it.face,
                    );
                    (at, it.done) = (at + count, it.done + count);
                }
                None => {
                    place(at - len, pair);
                    at += self.follow(&bytes[at..], |index, it| place(at + index, it));
                }
            }
        }
        item.end
    }
}

/// The glyphs of characters that do not depend on their neighbors.
#[derive(Default)]
struct Singles {
    /// The glyph, and an index into `advances` in the high half.
    known: Pages<u32>,
    /// In steps. The first two are taken.
    advances: Vec<i32>,
    /// For those that depend on the next one.
    pairs: Others<7>,
}

impl Singles {
    const COMPLEX: u32 = 1 << 16;

    #[cold]
    fn learn(&mut self, shaping: &Shaping, character: char, buffer: &mut Buffer) -> u32 {
        let (mut bytes, mut placed) = ([0; 4], Vec::new());
        if is_ordinary(character) {
            shaping.run(
                character.encode_utf8(&mut bytes),
                0..character.len_utf8(),
                buffer,
                &mut placed,
            );
        }
        let is_independent = |id: u16| {
            shaping.with_shaper(|it| {
                it.font.glyph(character.into()).is_some_and(|own| {
                    it.is_independent(own) && (own == id.into() || it.is_independent(id.into()))
                })
            })
        };
        let learned = match placed[..] {
            [
                Placed {
                    id,
                    advance: advance @ 1..,
                    dx: 0,
                    dy: 0,
                    ..
                },
            ] if id != NO_GLYPH && self.advances.len() < 256 && is_independent(id) => {
                self.advances.resize(self.advances.len().max(2), 0);
                let index = self
                    .advances
                    .iter()
                    .position(|it| *it == advance)
                    .unwrap_or(self.advances.len());
                self.advances
                    .extend((index == self.advances.len()).then_some(advance));
                (index as u32) << 16 | u32::from(id)
            }
            _ => Singles::COMPLEX,
        };
        self.known.set(character, learned);
        learned
    }
}

/// What is known about a way of shaping.
#[derive(Default)]
struct Table {
    identity: u64,
    last_use: u64,
    /// How much text there has been.
    seen: usize,
    pairs: Option<Pairs>,
    singles: Singles,
}

/// A word and the space after it.
struct Word {
    shaping: u64,
    /// With what it depends on around it.
    text: Range<u32>,
    glyphs: Range<u32>,
}

#[derive(Default)]
pub struct Words {
    tables: Vec<Table>,
    uses: u64,
    memory: Memory,
}

#[derive(Default)]
struct Memory {
    known: FastMap<u64, Word>,
    text: Vec<u8>,
    glyphs: Vec<Placed>,
    buffer: Buffer,
    unknown: Vec<Unknown>,
    scratch: Vec<Placed>,
}

struct Unknown {
    hash: u64,
    shaping: u64,
    word: Range<usize>,
    context: Range<usize>,
}

thread_local! {
    pub static WORDS: RefCell<Words> = RefCell::default();
}

/// Adds the space before `word` and what is in reach, as far as it is in `item`.
fn widen(text: &str, word: &Range<usize>, item: &Range<usize>, reach: Reach) -> Range<usize> {
    let bytes = word.start.saturating_sub(reach.before + 1).max(item.start)
        ..(word.end + reach.after).min(item.end);
    if text.as_bytes()[bytes.start..word.start].is_ascii()
        && text.as_bytes()[word.end..bytes.end].is_ascii()
    {
        return bytes;
    }
    let before = text[item.start..word.start]
        .chars()
        .rev()
        .take(reach.before + 1);
    let after = text[word.end..item.end].chars().take(reach.after);
    word.start - before.map(char::len_utf8).sum::<usize>()
        ..word.end + after.map(char::len_utf8).sum::<usize>()
}

impl Words {
    /// `from` is where the item starts, or a word or an ideograph in it.
    pub fn shape(
        &mut self,
        shaping: &Shaping,
        text: &str,
        item: Range<usize>,
        from: usize,
        spelling: Option<&mut Spelling>,
        to: &mut Vec<Placed>,
    ) {
        const MAX_TABLES: usize = 24;
        let identity = shaping.identity();
        let index = self
            .tables
            .iter()
            .position(|it| it.identity == identity)
            .unwrap_or_else(|| {
                let oldest = (0..self.tables.len())
                    .min_by_key(|it| self.tables[*it].last_use)
                    .filter(|_| self.tables.len() == MAX_TABLES);
                oldest
                    .into_iter()
                    .for_each(|it| _ = self.tables.swap_remove(it));
                self.tables.push(Table {
                    identity,
                    ..Table::default()
                });
                self.tables.len() - 1
            });
        self.uses += 1;
        self.tables[index].last_use = self.uses;
        self.memory.shape(
            &mut self.tables[index],
            shaping,
            text,
            (item, from),
            spelling,
            to,
        );
    }
}

impl Memory {
    /// Shapes the words that were not found, which follow each other.
    fn learn(&mut self, shaping: &Shaping, text: &str, to: &mut Vec<Placed>) {
        let (Some(first), Some(last)) = (self.unknown.first(), self.unknown.last()) else {
            return;
        };
        self.scratch.clear();
        shaping.run(
            text,
            first.context.start..last.context.end,
            &mut self.buffer,
            &mut self.scratch,
        );
        if shaping.is_rtl {
            self.scratch.reverse();
        }
        let mut rest = &self.scratch[self
            .scratch
            .partition_point(|it| (it.cluster as usize) < first.word.start)..];
        for Unknown {
            hash,
            shaping,
            word,
            context,
        } in self.unknown.drain(..)
        {
            let (glyphs, after) =
                rest.split_at(rest.partition_point(|it| (it.cluster as usize) < word.end));
            rest = after;
            to.extend(glyphs);
            let (text_start, glyphs_start) = (self.text.len() as u32, self.glyphs.len() as u32);
            self.text.extend(text[context].as_bytes());
            self.glyphs.extend(glyphs.iter().map(|it| Placed {
                cluster: it.cluster - word.start as u32,
                ..*it
            }));
            let (text, glyphs) = (
                text_start..self.text.len() as u32,
                glyphs_start..self.glyphs.len() as u32,
            );
            self.known.insert(
                hash,
                Word {
                    shaping,
                    text,
                    glyphs,
                },
            );
        }
    }

    /// Only shapes around what depends on its neighbors.
    fn shape_characters(
        &mut self,
        singles: &mut Singles,
        shaping: &Shaping,
        text: &str,
        (item, from): (Range<usize>, usize),
        mut spelling: Option<&mut Spelling>,
        to: &mut Vec<Placed>,
    ) {
        const REACH: usize = 4;
        let (mut pending, mut calm, mut last, len) = (None, 0, None, to.len());
        if spelling.is_none() {
            to.reserve(item.len() / 3);
        }
        let mut characters = text[from..item.end]
            .char_indices()
            .map(|it| (from + it.0, Some(it.1)))
            .chain([(item.end, None)])
            .peekable();
        while let Some((at, character)) = characters.next() {
            let known = character.map(|it| {
                let known = match singles.known.get(it) {
                    0 => singles.learn(shaping, it, &mut self.buffer),
                    known => known,
                };
                match known {
                    Singles::COMPLEX => singles
                        .pairs
                        .get(
                            shaping,
                            it,
                            characters.peek().and_then(|it| it.1),
                            &mut self.buffer,
                        )
                        .map(|it| (it.glyph, it.advance as i32)),
                    known => Some((known as u16, singles.advances[(known >> 16) as usize])),
                }
            });
            if known == Some(None) {
                // The numbers of a fraction have any length.
                if character == Some('\u{2044}') {
                    if let Some(it) = spelling {
                        it.take_back(it.done);
                        (it.done, it.left) = (it.letters.len(), it.letters.len());
                    }
                    to.truncate(len);
                    self.scratch.clear();
                    shaping.run(text, item, &mut self.buffer, &mut self.scratch);
                    return to.extend(self.scratch.iter().filter(|it| it.cluster as usize >= from));
                }
                // A mark goes on what is before it.
                if pending.is_none() && last.is_some() {
                    match &mut spelling {
                        Some(it) => it.take_back(1),
                        None => _ = to.pop(),
                    }
                }
                (pending, calm) = (pending.or(last).or(Some(at)), 0);
            } else if pending.is_some() && known.is_some() && calm < REACH {
                calm += 1;
            } else {
                if let Some(start) = pending.take() {
                    self.scratch.clear();
                    shaping.run(
                        text,
                        back(text, start, REACH, item.start)
                            ..at + character.map_or(0, char::len_utf8),
                        &mut self.buffer,
                        &mut self.scratch,
                    );
                    to.extend(
                        self.scratch
                            .iter()
                            .filter(|it| (start..at).contains(&(it.cluster as usize))),
                    );
                    spelling
                        .iter_mut()
                        .for_each(|it| it.leave(it.count(text, start..at)));
                }
                let Some(Some((id, advance))) = known else {
                    break;
                };
                match &mut spelling {
                    Some(it) => it.put(
                        id,
                        advance as f32,
                        if text.as_bytes()[at].is_ascii() {
                            flags_in_ascii(text.as_bytes(), at)
                        } else {
                            0
                        },
                    ),
                    None => to.push(Placed {
                        cluster: at as u32,
                        advance,
                        id,
                        dx: 0,
                        dy: 0,
                    }),
                }
                last = Some(at);
            }
        }
    }

    fn shape(
        &mut self,
        table: &mut Table,
        shaping: &Shaping,
        text: &str,
        (item, from): (Range<usize>, usize),
        mut spelling: Option<&mut Spelling>,
        to: &mut Vec<Placed>,
    ) {
        const MAX_GLYPHS: usize = 1 << 16;
        const WORTH_A_TABLE: usize = 2000;
        if shaping.goes_by_characters(&text[item.clone()]) {
            return self.shape_characters(
                &mut table.singles,
                shaping,
                text,
                (item, from),
                spelling,
                to,
            );
        }
        let (joins, len) = (shaping.script.0 == *b"Arab", to.len());
        let (reach, is_short) = (
            shaping.reach(),
            item.len() <= 96 && shaping.ignores_context(),
        );
        let (Some(reach), is_one_word) = (
            reach.or(is_short.then_some(Reach {
                before: 0,
                after: 0,
            })),
            reach.is_none(),
        ) else {
            spelling
                .iter_mut()
                .for_each(|it| it.leave(it.letters.len()));
            return shaping.run(text, item, &mut self.buffer, to);
        };
        if self.glyphs.len() > MAX_GLYPHS {
            self.known.clear();
            self.text.clear();
            self.glyphs.clear();
        }
        let (identity, bytes, mut start) = (table.identity, text.as_bytes(), from);
        table.seen += item.end - from;
        if table.pairs.is_none()
            && table.seen > WORTH_A_TABLE
            && !is_one_word
            && !shaping.capitalizes
            && !shaping.is_vertical
            && !shaping.is_rtl
        {
            table.pairs = vec![[Pair::default(); _]; 128]
                .try_into()
                .ok()
                .map(|ascii| Pairs {
                    ascii,
                    others: Others::default(),
                });
        }
        let outside = if joins {
            keyed((
                &bytes[item.start.saturating_sub(20)..item.start],
                &bytes[item.end..bytes.len().min(item.end + 20)],
            ))
        } else {
            0
        };
        if spelling.is_none() {
            to.reserve(item.len());
        }
        while start < item.end {
            if let Some(pairs) = &mut table.pairs {
                let (before, from) = (to.len(), start);
                start = pairs.shape(
                    shaping,
                    text,
                    (start, &item, reach),
                    &mut self.buffer,
                    &mut spelling,
                    to,
                );
                if start > from && !self.unknown.is_empty() {
                    let len = to.len() - before;
                    self.learn(shaping, text, to);
                    to[before..].rotate_left(len);
                }
                if start == item.end {
                    break;
                }
            }
            let space = bytes[start..item.end]
                .iter()
                .position(|byte| *byte == b' ' && !is_one_word);
            let mut end = space.map_or(item.end, |space| start + space + 1);
            // A mark goes on the space before it.
            while end < item.end
                && !bytes[end].is_ascii()
                && !text[end..].starts_with(|it| is_letter(it) || it.is_alphanumeric())
            {
                let space = bytes[end..item.end].iter().position(|byte| *byte == b' ');
                end = space.map_or(item.end, |space| end + space + 1);
            }
            let word = start..end;
            spelling
                .iter_mut()
                .for_each(|it| it.leave(it.count(text, word.clone())));
            let context = widen(text, &word, &item, reach);
            let identity =
                identity ^ (start - context.start) as u64 ^ ((context.end - end) as u64) << 8;
            let identity = if context.start == item.start || context.end == item.end {
                identity ^ outside
            } else {
                identity
            };
            let mut hasher = FastHasher::default();
            (identity, &bytes[context.clone()]).hash(&mut hasher);
            let hash = hasher.finish();
            let is_it = |known: &&Word| {
                known.shaping == identity
                    && self.text[known.text.start as usize..known.text.end as usize]
                        == bytes[context.clone()]
            };
            match self
                .known
                .get(&hash)
                .filter(is_it)
                .map(|known| known.glyphs.clone())
            {
                Some(glyphs) => {
                    self.learn(shaping, text, to);
                    let glyphs = &self.glyphs[glyphs.start as usize..glyphs.end as usize];
                    to.extend(glyphs.iter().map(|it| Placed {
                        cluster: it.cluster + start as u32,
                        ..*it
                    }));
                }
                None => self.unknown.push(Unknown {
                    hash,
                    shaping: identity,
                    word,
                    context,
                }),
            }
            start = end;
        }
        self.learn(shaping, text, to);
        if shaping.is_rtl {
            to[len..].reverse();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::fonts::FONTS;
    use crate::text::{Description, describe, font_families};

    #[test]
    fn makes_no_difference() {
        crate::system_icu::install();
        let text = "To  AVAT. \"Type\" Y a -> b => c != d, (A) fi ffl 1/2 x:y 12:30 - T - Te\u{301}st W. A' T' -- www <!-- x --> \
            1 000 000 \u{301}a A - B a - b A : B ( A ) x * 2 2 x 2 \u{2192} f f i T o Another , . ! ? L ' T \
            averyveryveryveryveryveryveryveryveryveryveryverylongword T ";
        let arabic = "السلام عليكم  لا إله مُحَمَّد ، في الله و ر ز د (كتب) لأ لَا بِسْمِ ـ من من في في عليكم ";
        let hebrew = "שלום עולם בְּרֵאשִׁית בָּרָא , (של) של את את ״ב״ עולם ";
        let (mut words, mut buffer) = (Words::default(), Buffer::default());
        let han = "日本語の文章、「テスト」です。漢字 12 か\u{3099}葛\u{e0100}城——……平成 (株) ぁーキャ。」中文标点,测试";
        let korean = "이것은 한국어 문장입니다. 12\u{2044}34 (가) 가\u{11a8} \u{1100}\u{1161} 漢字, AV To ㄱㄴ 한\u{302e} ";
        let russian =
            "Гг. «Тест» — УД Ау, ёлка й и\u{306} То же: АТ ГА “да” 1\u{2044}2 fi é AV’s Ωμέγα ";
        let (kana, hindi) = (
            "これはコンポーネントを作成します、データが「テスト」。ぁーきゃか\u{3099}ト\u{309a}た㌔",
            "यह हिन्दी क्षेत्र श्री \u{200d}क्\u{200d} ज्ञान",
        );
        let texts = [
            (kana, Script(*b"Hira")),
            (kana, Script::HAN),
            (hindi, Script(*b"Deva")),
            (korean, Script(*b"Hang")),
            (russian, Script(*b"Cyrl")),
            (russian, Script::LATIN),
            (text, Script::LATIN),
            (arabic, Script(*b"Arab")),
            (hebrew, Script(*b"Hebr")),
            (han, Script::HAN),
            (han, Script(*b"Kana")),
        ];
        for (family, (text, script)) in font_families()
            .iter()
            .flat_map(|family| texts.map(|it| (family, it)))
        {
            let font = describe(Description::new(family.as_bytes(), 400.));
            let fonts = &mut *FONTS.lock();
            let Some(primary) = fonts.primary(font) else {
                continue;
            };
            let (face, is_rtl) = (
                fonts.instance(font, primary, 16.).1,
                matches!(&script.0, b"Arab" | b"Hebr"),
            );
            let shaping = Shaping {
                face,
                size: 16.,
                script,
                is_rtl,
                is_vertical: false,
                capitalizes: false,
                language: &[],
                features: &[],
                features_hash: 0,
            };
            for (start, _) in text.char_indices().step_by(2).cycle().take(120) {
                let (mut expected, mut actual) = (Vec::new(), Vec::new());
                shaping.run(text, start..text.len(), &mut buffer, &mut expected);
                words.shape(&shaping, text, start..text.len(), start, None, &mut actual);
                let plain = |glyphs: Vec<Placed>| -> Vec<_> {
                    glyphs
                        .iter()
                        .map(|it| (it.cluster, it.id, it.advance, it.dx, it.dy))
                        .collect()
                };
                assert_eq!(plain(actual), plain(expected), "{} from {start}", &**family);
            }
        }
    }
}
