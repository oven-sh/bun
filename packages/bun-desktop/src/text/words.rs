//! Remembers how words were shaped.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::ops::Range;

use super::breaks::{flags_in_ascii, is_letter};
use super::fonts::Face;
use super::reach::Reach;
use super::shaper::{Buffer, Direction, Feature, Glyph, Plan, Shaper};
use crate::abi::{Letter, NO_GLYPH};
use crate::hash::{FastHasher, FastMap};
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

    fn identity(&self) -> u64 {
        let mut hasher = FastHasher::default();
        let size = if self.face.file.has_tracking {
            self.size.to_bits()
        } else {
            0
        };
        (
            self.face.id,
            self.script,
            self.is_rtl,
            self.features_hash,
            size,
        )
            .hash(&mut hasher);
        hasher.finish()
    }
}

const UNKNOWN: f32 = 0.;
const COMPLEX: i32 = -1;
const END: u8 = 0;

/// Most ASCII text is glyphs whose advance depends on the next one.
struct Pairs(Box<[[Pair; 128]; 128]>);

#[derive(Clone, Copy, Default)]
#[repr(C)]
struct Pair {
    advance: f32,
    glyph: u16,
    /// What follows from the two for each.
    flags: [u8; 2],
}

/// One for each byte of the text. Those that are left to `Placed` stay `UNSPELLED`.
pub struct Spelling<'a> {
    pub letters: &'a mut [Letter],
    pub scale: f32,
    pub face: u8,
}

pub const UNSPELLED: Letter = Letter {
    advance: -1.,
    glyph: NO_GLYPH,
    flags: 0,
    face: 0,
};

impl Pairs {
    #[cold]
    fn learn(shaping: &Shaping, first: u8, second: u8, buffer: &mut Buffer) -> Pair {
        let (text, mut placed) = ([first, second], Vec::new());
        let flags = [
            flags_in_ascii(&text, 0),
            if second == END {
                0
            } else {
                flags_in_ascii(&text, 1)
            },
        ];
        let text = str::from_utf8(&text[..1 + usize::from(second != END)]).unwrap_or_default();
        shaping.run(text, 0..text.len(), buffer, &mut placed);
        let only_kerns = shaping.with_shaper(|it| {
            let [first, next] = [0, 1].map(|at| it.font.glyph((*text.as_bytes().get(at)?).into()));
            first.is_some_and(|first| {
                next.is_some() == (second != END) && it.only_kerns(first, next)
            })
        });
        let is_printable = text.bytes().all(|it| (b' '..0x7f).contains(&it));
        let placed = placed.first().filter(|it| {
            is_printable
                && only_kerns
                && (it.dx, it.dy) == (0, 0)
                && it.advance > 0
                && it.id != NO_GLYPH
        });
        placed.map_or(
            Pair {
                advance: -1.,
                ..Pair::default()
            },
            |it| Pair {
                advance: it.advance as f32,
                glyph: it.id,
                flags,
            },
        )
    }

    /// Of the character at `at` and the next one.
    fn get(
        &mut self,
        shaping: &Shaping,
        text: &[u8],
        at: usize,
        buffer: &mut Buffer,
    ) -> Option<Pair> {
        let (first, second) = (
            text[at],
            text.get(at + 1).map_or(END, |it| (*it).max(END + 1)),
        );
        let pair = self
            .0
            .get_mut(usize::from(first))?
            .get_mut(usize::from(second))?;
        if pair.advance == UNKNOWN {
            *pair = Pairs::learn(shaping, first, second, buffer);
        }
        Some(*pair).filter(|it| it.advance > 0.)
    }

    /// Returns how many characters it has done.
    #[inline(always)]
    fn follow(&self, text: &[u8], mut put: impl FnMut(usize, Pair)) -> usize {
        let Some(mut row) = text.first().and_then(|it| self.0.get(usize::from(*it))) else {
            return 0;
        };
        for (index, second) in text[1..].iter().map(|it| usize::from(*it)).enumerate() {
            match row.get(second) {
                Some(pair) if pair.advance > 0. && second != usize::from(END) => put(index, *pair),
                _ => return index,
            }
            row = &self.0[second];
        }
        text.len() - 1
    }

    #[inline(never)]
    fn spell(&self, text: &[u8], letters: &mut [Letter], flags: u8, scale: f32, face: u8) -> usize {
        let Some(mut row) = text.first().and_then(|it| self.0.get(usize::from(*it))) else {
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
                advance: pair.advance * scale,
                glyph: own as u16,
                flags: (own >> 16) as u8,
                face: (own >> 24) as u8,
            };
            (carried, row) = (rest >> 8 & 0xff_0000, &self.0[usize::from(second & 0x7f)]);
        }
        text.len() - 1
    }

    /// Returns where the words end that it has shaped from `start` on.
    fn shape(
        &mut self,
        shaping: &Shaping,
        whole: &[u8],
        (start, item, reach): (usize, &Range<usize>, Reach),
        buffer: &mut Buffer,
        spelling: &mut Option<Spelling>,
        to: &mut Vec<Placed>,
    ) -> usize {
        let (text, len, mut at) = (
            &whole[..item.end],
            to.len(),
            start.saturating_sub(reach.before + 1).max(item.start),
        );
        while at < text.len() {
            let Some(pair) = self.get(shaping, text, at, buffer) else {
                let unaffected =
                    &text[start..(at + 1).saturating_sub(reach.after.max(1)).max(start)];
                let words = unaffected
                    .iter()
                    .rposition(|it| *it == b' ')
                    .map_or(0, |it| it + 1);
                match spelling {
                    Some(it) => it.letters[start + words..at.max(start + words)].fill(UNSPELLED),
                    None => to.truncate(len + words),
                }
                return start + words;
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
            at += 1;
            match spelling {
                _ if at <= start => {}
                Some(Spelling {
                    letters,
                    scale,
                    face,
                }) => {
                    letters[at - 1] = Letter {
                        advance: pair.advance * *scale,
                        glyph: pair.glyph,
                        flags: flags_in_ascii(text, at - 1),
                        face: *face,
                    };
                    at += self.spell(
                        &text[at..],
                        &mut letters[at..],
                        pair.flags[1],
                        *scale,
                        *face,
                    );
                }
                None => {
                    place(at - 1, pair);
                    at += self.follow(&text[at..], |index, it| place(at + index, it));
                }
            }
        }
        item.end
    }
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
    known: FastMap<u64, Word>,
    text: Vec<u8>,
    glyphs: Vec<Placed>,
    buffer: Buffer,
    unknown: Vec<Unknown>,
    scratch: Vec<Placed>,
    /// The glyph and the advance of a character in a script without spaces.
    characters: FastMap<(u64, char), (u16, i32)>,
    /// With how much text there has been.
    pairs: FastMap<u64, (usize, Option<Pairs>)>,
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

    #[cold]
    fn learn_character(&mut self, shaping: &Shaping, character: char) -> (u16, i32) {
        let (mut bytes, placed) = ([0; 4], &mut self.scratch);
        let text = character.encode_utf8(&mut bytes);
        placed.clear();
        shaping.run(text, 0..text.len(), &mut self.buffer, placed);
        let is_independent = |id: u16| {
            shaping.with_shaper(|it| {
                it.font
                    .glyph(character.into())
                    .is_some_and(|own| it.is_independent(own) && it.is_independent(id.into()))
            })
        };
        match placed[..] {
            [
                Placed {
                    id,
                    advance: advance @ 1..,
                    dx: 0,
                    dy: 0,
                    ..
                },
            ] if character >= '\u{2e80}' && stands_alone(character) && is_independent(id) => {
                (id, advance)
            }
            _ => (0, COMPLEX),
        }
    }

    /// Only shapes around what depends on its neighbors.
    fn shape_characters(
        &mut self,
        shaping: &Shaping,
        text: &str,
        item: Range<usize>,
        to: &mut Vec<Placed>,
    ) {
        const REACH: usize = 4;
        let (identity, len, mut pending, mut calm) = (shaping.identity(), to.len(), None, 0);
        if self.characters.len() > 1 << 15 {
            self.characters.clear();
        }
        to.reserve(item.len() / 3);
        for (at, character) in text[item.clone()]
            .char_indices()
            .map(|it| (item.start + it.0, Some(it.1)))
            .chain([(item.end, None)])
        {
            let known = character.map(|it| match self.characters.get(&(identity, it)) {
                Some(known) => *known,
                None => {
                    let learned = self.learn_character(shaping, it);
                    self.characters.insert((identity, it), learned);
                    learned
                }
            });
            if let Some((_, COMPLEX)) = known {
                // A mark goes on what is before it.
                pending = pending.or_else(|| {
                    Some(if to.len() > len {
                        to.pop()?.cluster as usize
                    } else {
                        at
                    })
                });
                calm = 0;
            } else if pending.is_some() && known.is_some() && calm < REACH {
                calm += 1;
            } else {
                if let Some(start) = pending.take() {
                    let before: usize = text[item.start..start]
                        .chars()
                        .rev()
                        .take(REACH)
                        .map(char::len_utf8)
                        .sum();
                    self.scratch.clear();
                    shaping.run(
                        text,
                        start - before..at,
                        &mut self.buffer,
                        &mut self.scratch,
                    );
                    to.extend(
                        self.scratch
                            .iter()
                            .filter(|it| it.cluster as usize >= start),
                    );
                }
                to.extend(known.map(|(id, advance)| Placed {
                    cluster: at as u32,
                    advance,
                    id,
                    dx: 0,
                    dy: 0,
                }));
            }
        }
    }

    pub fn shape(
        &mut self,
        shaping: &Shaping,
        text: &str,
        item: Range<usize>,
        mut spelling: Option<Spelling>,
        to: &mut Vec<Placed>,
    ) {
        const MAX_GLYPHS: usize = 1 << 16;
        const MAX_REACH: usize = 12;
        const MAX_TABLES: usize = 24;
        const WORTH_A_TABLE: usize = 2000;
        if matches!(&shaping.script.0, b"Hani" | b"Hira" | b"Kana")
            && !shaping.is_rtl
            && !shaping.is_vertical
        {
            return self.shape_characters(shaping, text, item, to);
        }
        let (joins, len) = (shaping.script.0 == *b"Arab", to.len());
        let has_words = if shaping.is_rtl {
            joins || shaping.script.0 == *b"Hebr"
        } else {
            matches!(&shaping.script.0, b"Latn" | b"Zyyy" | b"Cyrl" | b"Grek")
        };
        // The form of a letter depends on the next one, which a mark may be in front of.
        let further = |it: usize| if joins && it > 0 { it + 2 } else { it };
        let reach = has_words
            .then(|| shaping.face.file.reach())
            .flatten()
            .map(|it| Reach {
                before: further(it.before),
                after: further(it.after),
            });
        let Some(reach) = reach.filter(|reach| reach.before + reach.after <= MAX_REACH) else {
            return shaping.run(text, item, &mut self.buffer, to);
        };
        if self.glyphs.len() > MAX_GLYPHS {
            self.known.clear();
            self.text.clear();
            self.glyphs.clear();
        }
        let (identity, bytes, mut start) = (shaping.identity(), text.as_bytes(), item.start);
        if self.pairs.len() > MAX_TABLES && !self.pairs.contains_key(&identity) {
            self.pairs.clear();
        }
        let (seen, pairs) = self.pairs.entry(identity).or_default();
        *seen += item.len();
        let new = || vec![[Pair::default(); _]; 128].try_into().ok().map(Pairs);
        let mut pairs = pairs.take().or_else(|| {
            (*seen > WORTH_A_TABLE
                && !shaping.capitalizes
                && !shaping.is_vertical
                && !shaping.is_rtl)
                .then(new)?
        });
        let mut outside = FastHasher::default();
        if joins {
            (
                &bytes[item.start.saturating_sub(20)..item.start],
                &bytes[item.end..bytes.len().min(item.end + 20)],
            )
                .hash(&mut outside);
        }
        let outside = outside.finish();
        to.reserve(item.len());
        while start < item.end {
            if let Some(pairs) = &mut pairs {
                let (before, from) = (to.len(), start);
                start = pairs.shape(
                    shaping,
                    bytes,
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
            let space = bytes[start..item.end].iter().position(|byte| *byte == b' ');
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
        self.pairs.entry(identity).or_default().1 = pairs;
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
        let texts = [
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
            for (start, _) in text.char_indices().step_by(2) {
                let (mut expected, mut actual) = (Vec::new(), Vec::new());
                shaping.run(text, start..text.len(), &mut buffer, &mut expected);
                words.shape(&shaping, text, start..text.len(), None, &mut actual);
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
