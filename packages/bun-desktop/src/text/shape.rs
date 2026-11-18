use std::ops::Range;

use super::breaks::{Breaks, flags_in_ascii, is_ideograph, is_large_kana, is_letter, is_mark};
use super::fonts::{FONTS, Fonts, Presentation, is_default_ignorable};
use super::pages::Pages;
use super::shaper::{Feature, STEPS_PER_UNIT};
use super::words::{Placed, Shaping, Spelling, UNSPELLED, WORDS};
use crate::abi::{self, Cluster, Glyph, Letter, NO_GLYPH, Span, TextRun};
use crate::bun::abi::BREAK_GRAPHEMES;
use crate::unicode::{self, Script};

#[derive(Default)]
pub struct Shaped {
    pub clusters: Vec<Cluster>,
    pub glyphs: Vec<Glyph>,
    pub letters: Vec<Letter>,
    pub joined: Vec<u32>,
    pub faces: Vec<abi::Face>,
    pub base_level: u8,
    /// Where the letters start in the text.
    pub skipped: usize,
    skipped_letters: usize,
    placed: Vec<Placed>,
    /// A cluster, the next one with glyphs if it has no group, where its glyphs start and end, and their advance.
    groups: Vec<(usize, Option<usize>, u32, u32, f32)>,
    items: Vec<Item>,
}

/// Clusters that are shaped together.
#[derive(Clone, Copy, PartialEq)]
struct Item {
    run: usize,
    candidate: usize,
    level: u8,
    script: Script,
    draws: bool,
    is_small_capital: bool,
    end: usize,
}

/// A character that is a cluster, with its kind, its candidate and its script.
#[derive(Clone, Copy)]
struct Known(u64);

impl Known {
    const SLOTS: usize = 4096;
    const SPACE: u8 = 1;
    const LETTER: u8 = 2;
    const IDEOGRAPH: u8 = 3;

    fn new(character: char, candidate: usize, is_listed: bool) -> Option<Known> {
        let kind = match character {
            ' ' => Known::SPACE,
            _ if is_letter(character) => Known::LETTER,
            _ if is_ideograph(character) => Known::IDEOGRAPH,
            _ => return None,
        };
        let script = Some(Script::of(character))
            .filter(|it| it.is_specific())
            .map_or(0, |it| u32::from_ne_bytes(it.0));
        (candidate < 256 && unicode::stands_alone(character)).then_some(Known(
            u64::from(script) << 32
                | (candidate as u64) << 24
                | u64::from(is_listed) << 23
                | u64::from(kind) << 21
                | u64::from(character),
        ))
    }

    fn find(all: &[u64], character: char) -> Option<Known> {
        all.get(character as usize % Known::SLOTS)
            .copied()
            .filter(|it| it & 0x1f_ffff == u64::from(character) && *it != 0)
            .map(Known)
    }

    fn kind(self) -> u8 {
        (self.0 >> 21) as u8 & 3
    }

    /// The flags of the cluster, if it goes on with the item.
    fn after(self, last: u8, item: &Item, fallbacks: &[usize], word_break: u8) -> Option<u8> {
        let (candidate, script) = (usize::from((self.0 >> 24) as u8), (self.0 >> 32) as u32);
        (item.draws
            && item.candidate == candidate
            && (script == 0 || script.to_ne_bytes() == item.script.0)
            && (self.0 >> 23 & 1 == 1 || fallbacks == [candidate]))
        .then_some(())?;
        match (last, self.kind(), word_break & 3) {
            (1.., Known::SPACE, _) => Some(abi::CLUSTER_SPACE),
            (Known::SPACE, ..) | (Known::IDEOGRAPH, Known::IDEOGRAPH, abi::BREAK_NORMAL) => {
                Some(abi::CLUSTER_BREAK_BEFORE)
            }
            (Known::LETTER, Known::LETTER, abi::BREAK_NORMAL | abi::BREAK_KEEP_ALL) => Some(0),
            _ => None,
        }
    }
}

/// What characters that are not ASCII have in common.
#[derive(Clone, Copy, PartialEq)]
struct Sort {
    candidate: usize,
    /// Whatever fallbacks the text before it has.
    is_settled: bool,
    /// If it has none.
    is_first_choice: bool,
    script: Option<Script>,
    kind: u8,
}

impl Sort {
    const OTHER: u8 = 0;
    const HANGING: u8 = 4;
    const UNDRAWN: u8 = 5;
    /// It may be part of a longer cluster.
    const ODD: u8 = 6;
}

#[derive(Default)]
pub struct Sorts {
    /// An index, plus one.
    of: Pages<u8>,
    all: Vec<Sort>,
}

impl Sorts {
    #[inline(always)]
    fn get(&self, character: char) -> Option<Sort> {
        self.all
            .get(usize::from(self.of.get(character)).wrapping_sub(1))
            .copied()
    }

    fn set(&mut self, character: char, sort: Sort) {
        let index = self
            .all
            .iter()
            .position(|it| *it == sort)
            .unwrap_or(self.all.len());
        if let Ok(number) = u8::try_from(index + 1) {
            self.all.extend((index == self.all.len()).then_some(sort));
            self.of.set(character, number);
        }
    }

    #[cold]
    fn learn(
        &mut self,
        character: char,
        font: u32,
        fonts: &mut Fonts,
        fallbacks: &mut Vec<usize>,
    ) -> Option<Sort> {
        let kind = match character {
            _ if is_undrawn(character) => Sort::UNDRAWN,
            _ if is_default_ignorable(character)
                || !unicode::stands_alone(character) && !is_pictograph(character) =>
            {
                Sort::ODD
            }
            _ if is_hanging_space(character) => Sort::HANGING,
            _ if is_letter(character) => Known::LETTER,
            _ if is_ideograph(character) || is_large_kana(character) => Known::IDEOGRAPH,
            _ => Sort::OTHER,
        };
        let mut sort = Sort {
            candidate: 0,
            is_settled: true,
            is_first_choice: false,
            script: Some(Script::of(character)).filter(|it| it.is_specific()),
            kind,
        };
        if kind < Sort::UNDRAWN {
            let mut bytes = [0; 4];
            let (cluster, is_first) = (character.encode_utf8(&mut bytes), fallbacks.is_empty());
            sort.candidate = fonts.select(font, cluster, presentation(cluster), fallbacks)?;
            sort.is_first_choice = is_first
                || self
                    .get(character)
                    .is_some_and(|it| it.is_first_choice && it.candidate == sort.candidate);
            let (is_for_text, resolved) = (
                fonts.is_for_text(font, character, presentation(cluster)),
                fonts.resolved(font)?,
            );
            sort.is_settled = !is_for_text
                || sort.candidate < resolved.listed && !fallbacks.contains(&sort.candidate);
            if !sort.is_settled && !resolved.candidates[sort.candidate].covers(character) {
                return Some(sort);
            }
        }
        self.set(character, sort);
        Some(sort)
    }
}

/// How many characters there are at the start that are printable ASCII.
fn printable(text: &[u8]) -> usize {
    let is_other = |it: &u8| it.wrapping_sub(b' ') > b'~' - b' ';
    let whole = text
        .as_chunks::<16>()
        .0
        .iter()
        .take_while(|it| !it.iter().fold(false, |any, it| any | is_other(it)))
        .count()
        * 16;
    whole + text[whole..].iter().take_while(|it| !is_other(it)).count()
}

/// Of the cluster at the start, if it is an emoji sequence or has the common marks.
fn length_of_sequence(text: &str) -> Option<usize> {
    let is_flag = |it: char| matches!(it, '\u{1F1E6}'..='\u{1F1FF}');
    let extends = |it: char| {
        is_mark(it)
            || matches!(it, '\u{FE0E}' | '\u{FE0F}' | '\u{20E3}' | '\u{1F3FB}'..='\u{1F3FF}' | '\u{E0020}'..='\u{E007F}')
    };
    let mut rest = text.char_indices().peekable();
    let mut base = rest.next()?.1;
    match is_flag(base) {
        true => _ = rest.next_if(|it| is_flag(it.1))?,
        false => ((unicode::stands_alone(base) || is_pictograph(base))
            && !base.is_control()
            && !is_undrawn(base)
            && !is_default_ignorable(base))
        .then_some(())?,
    }
    // That takes more than a glyph.
    (!is_ideograph(base) || !rest.peek().is_some_and(|it| is_mark(it.1))).then_some(())?;
    loop {
        while rest.next_if(|it| extends(it.1)).is_some() {}
        if rest.next_if(|it| it.1 == '\u{200D}').is_none() {
            break;
        }
        base = rest.next().map(|it| it.1).filter(|it| {
            unicode::is_pictographic(base.into()) && unicode::is_pictographic((*it).into())
        })?;
    }
    rest.next().map_or(Some(text.len()), |(at, it)| {
        (unicode::stands_alone(it) || is_pictograph(it) || is_flag(it)).then_some(at)
    })
}

fn presentation(cluster: &str) -> Presentation {
    let mut characters = cluster.chars();
    let (Some(first), second) = (characters.next(), characters.next()) else {
        return Presentation::Any;
    };
    match second {
        Some('\u{FE0F}' | '\u{20E3}') => Presentation::Color,
        Some('\u{FE0E}') => Presentation::Text,
        _ if first < '\u{231A}' => Presentation::Any,
        Some('\u{200D}' | '\u{1F3FB}'..='\u{1F3FF}') if unicode::is_emoji(first) => {
            Presentation::Color
        }
        _ if unicode::has_emoji_presentation(first) => Presentation::PrefersColor,
        _ => Presentation::Any,
    }
}

/// Of a letter with diacritical marks at the start.
fn length_with_marks(text: &str) -> Option<usize> {
    let mut rest = text.char_indices().skip(1).skip_while(|it| is_mark(it.1));
    text.starts_with(|it| is_letter(it) || is_ideograph(it))
        .then_some(())?;
    rest.next().map_or(Some(text.len()), |it| {
        unicode::stands_alone(it.1).then_some(it.0)
    })
}

fn is_hanging_space(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\u{1680}' | '\u{2000}'..='\u{2006}' | '\u{2008}'..='\u{200A}' | '\u{205F}' | '\u{3000}')
}

/// Joiners and soft hyphens stay in their item, where they affect the shapes around them. Isolates end it.
fn is_undrawn(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\r' | '\u{FFFC}' | '\u{2028}' | '\u{2029}' | '\u{2066}'..='\u{2069}'
    )
}

/// Whether something in it goes from right to left.
fn may_be_bidirectional(text: &str) -> bool {
    let bytes = text.as_bytes();
    let starts = |&[a, b, c]: &[u8; 3]| {
        (a.wrapping_sub(0xD6) < 10)
            | (a == 0xE0) & (b < 0xA4)
            | (a == 0xE2)
                & ((b == 0x80) & ((c == 0x8F) | (c == 0xAB) | (c == 0xAE))
                    | (b == 0x81) & (c == 0xA7))
            | (a == 0xEF) & (b.wrapping_sub(0xAC) < 16)
            | (a == 0xF0) & ((b == 0x90) | (b == 0x9E))
    };
    (bytes
        .array_windows()
        .fold(0, |any, it| any | u8::from(starts(it)))
        != 0
        || bytes.last_chunk().is_some_and(|&[a, b]| starts(&[a, b, 0])))
        && text.chars().any(|character| {
            matches!(character as u32, 0x590..=0x8FF | 0x200F | 0x202B | 0x202E | 0x2067
                | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFE | 0x10800..=0x10FFF | 0x1E800..=0x1EFFF)
        })
}

/// One that nothing but a modifier or a joiner makes part of a longer cluster.
fn is_pictograph(character: char) -> bool {
    matches!(character, '\u{1F300}'..='\u{1F3FA}' | '\u{1F400}'..='\u{1F6FF}' | '\u{1F900}'..='\u{1FAFF}')
}

fn is_cursive(script: Script) -> bool {
    matches!(
        &script.0,
        b"Arab" | b"Rohg" | b"Mand" | b"Mong" | b"Nkoo" | b"Phag" | b"Syrc"
    )
}

/// How far spelling has got.
struct Place {
    at: usize,
    letter: usize,
    script: Script,
    /// The kind of the character before.
    last: u8,
    breaks: Breaks,
}

/// An item whose end is still to come.
struct Started {
    at: usize,
    letter: usize,
    candidate: usize,
}

/// Adds what has been placed.
fn spell_placed(
    text: &str,
    range: &Range<usize>,
    placed: &[Placed],
    spelling: &mut Spelling,
    advance_of: impl Fn(&Placed) -> f32,
) -> Option<()> {
    let (mut offset, mut letter) = (range.start, 0);
    for (index, it) in placed.iter().enumerate() {
        let (at, next) = (
            it.cluster as usize,
            placed
                .get(index + 1)
                .map_or(range.end, |it| it.cluster as usize),
        );
        ((it.dx, it.dy) == (0, 0)
            && it.advance >= 0
            && it.id != NO_GLYPH
            && offset <= at
            && at < next)
            .then_some(())?;
        letter += if at > offset {
            spelling.count(text, offset..at)
        } else {
            0
        };
        let starts = text
            .get(at..next)?
            .char_indices()
            .map(|it| at + it.0)
            .filter(|it| spelling.joined.binary_search(&(*it as u32)).is_err());
        let count = starts
            .clone()
            .zip(spelling.letters.get(letter..)?)
            .take_while(|it| it.1.advance == UNSPELLED.advance)
            .count();
        let advance = if count == 1 {
            advance_of(it)
        } else {
            advance_of(it) / count as f32
        } + spelling.spacing;
        for (at, own) in starts.zip(&mut spelling.letters[letter..letter + count]) {
            *own = Letter {
                advance,
                glyph: NO_GLYPH,
                flags: own.flags | flags_in_ascii(text.as_bytes(), at),
                face: spelling.face,
            };
            offset = text.ceil_char_boundary(at + 1);
        }
        spelling
            .letters
            .get_mut(letter)
            .filter(|_| count > 0)?
            .glyph = it.id;
        (letter, spelling.left) = (letter + count, spelling.left.checked_sub(count)?);
    }
    (spelling.left == 0).then_some(())
}

impl Shaped {
    fn extend_items(&mut self, item: Item) {
        match self.items.last_mut() {
            Some(last)
                if Item {
                    end: item.end,
                    ..*last
                } == item =>
            {
                last.end = item.end
            }
            _ => self.items.push(item),
        }
    }

    fn clear(&mut self) {
        self.clusters.clear();
        self.glyphs.clear();
        self.letters.clear();
        self.joined.clear();
        self.faces.clear();
        self.items.clear();
        (self.base_level, self.skipped, self.skipped_letters) = (0, 0, 0);
    }

    /// What most text takes. `runs` start at `from`.
    fn spell(
        &mut self,
        text: &str,
        runs: &[TextRun],
        from: usize,
        fonts: &mut Fonts,
    ) -> Option<()> {
        let (bytes, is_ascii) = (text.as_bytes(), text.get(from..)?.is_ascii());
        let is_specific = |it: &(usize, char)| {
            it.1.is_ascii_alphabetic() || !it.1.is_ascii() && Script::of(it.1).is_specific()
        };
        let script = match text[..from]
            .char_indices()
            .rfind(is_specific)
            .or_else(|| text.char_indices().find(is_specific))
        {
            Some((at, it)) => (self.skipped == 0 || at < self.skipped && unicode::stands_alone(it))
                .then(|| Script::of(it))?,
            None => (self.skipped == 0).then_some(Script::COMMON)?,
        };
        self.letters.resize(
            if is_ascii {
                bytes.len() - from
            } else {
                text[from..].chars().count()
            },
            UNSPELLED,
        );
        let mut place = Place {
            at: from,
            letter: 0,
            script,
            last: Sort::OTHER,
            breaks: Breaks::default(),
        };
        for run in runs {
            let end = (run.end as usize).clamp(place.at, bytes.len());
            fonts.primary_for_ascii(run.font).filter(|_| {
                run.word_break & (abi::RUN_UPRIGHT | abi::RUN_VERTICAL) == 0
                    && text.is_char_boundary(end)
            })?;
            let mut sorts = std::mem::take(&mut fonts.resolved(run.font)?.sorts);
            let before = sorts.of.count();
            let spelled = self.spell_run(text, run, end, &mut place, &mut sorts, fonts);
            let more = sorts.of.count() - before;
            fonts.resolved(run.font)?.sorts = sorts;
            fonts.count_sorts(more);
            spelled?;
        }
        (place.at == text.len()).then_some(())?;
        self.letters.truncate(place.letter);
        self.letters.drain(..self.skipped_letters);
        self.joined.drain(
            ..self
                .joined
                .partition_point(|it| (*it as usize) < self.skipped),
        );
        let (mut counted, mut letter, mut joined) =
            (self.skipped, 0, self.joined.iter().peekable());
        for offset in text[self.skipped..]
            .match_indices('-')
            .map(|it| self.skipped + it.0)
            .filter(|it| bytes.get(it + 1).is_some_and(u8::is_ascii_digit))
        {
            letter += if is_ascii {
                offset - counted
            } else {
                text[counted..offset].chars().count()
            };
            while joined.next_if(|it| (**it as usize) < offset).is_some() {
                letter -= 1;
            }
            counted = offset;
            self.letters[letter + 1].flags = flags_in_ascii(bytes, offset + 1);
        }
        Some(())
    }

    fn spell_run(
        &mut self,
        text: &str,
        run: &TextRun,
        end: usize,
        place: &mut Place,
        sorts: &mut Sorts,
        fonts: &mut Fonts,
    ) -> Option<()> {
        let (bytes, mut fallbacks) = (text.as_bytes(), Vec::new());
        let (mut item, breaks_ideographs) = (
            Started {
                at: place.at,
                letter: place.letter,
                candidate: 0,
            },
            run.word_break & 3 == abi::BREAK_NORMAL,
        );
        while place.at < end {
            let (at, byte) = (place.at, bytes[place.at]);
            if byte.is_ascii() {
                if at > 0 && !bytes[at - 1].is_ascii() {
                    let joins =
                        byte == b' ' || place.last == Known::LETTER && byte.is_ascii_alphabetic();
                    self.letters[place.letter].flags =
                        u8::from(!joins && place.breaks.allows(text, at, run.word_break))
                            * abi::CLUSTER_BREAK_BEFORE;
                }
                let mut count = printable(&bytes[at..end]);
                if count == 0 {
                    matches!(byte, b'\t' | b'\n').then_some(())?;
                    self.finish(text, run, place, &mut item, Some(0), fonts)?;
                    self.leave_blank(run, place.letter, flags_in_ascii(bytes, at), fonts)?;
                    (place.at, place.letter, place.last) = (at + 1, place.letter + 1, Sort::OTHER);
                    (item.at, item.letter) = (place.at, place.letter);
                    continue;
                }
                let next = text[at + count..end]
                    .chars()
                    .next()
                    .filter(|it| !it.is_ascii());
                let goes_on = next.is_some_and(|it| {
                    sorts.get(it).map_or_else(
                        || !unicode::stands_alone(it) && !is_pictograph(it),
                        |it| it.kind == Sort::ODD,
                    ) && !matches!(it, '\u{1F1E6}'..='\u{1F1FF}')
                });
                count -= usize::from(goes_on);
                if count > 0 {
                    if item.candidate != 0 {
                        self.finish(text, run, place, &mut item, Some(0), fonts)?;
                    }
                    if place.script != Script::LATIN
                        && let Some(before) = bytes[at..at + count]
                            .iter()
                            .position(u8::is_ascii_alphabetic)
                    {
                        (place.at, place.letter) = (at + before, place.letter + before);
                        self.finish(text, run, place, &mut item, Some(0), fonts)?;
                        fallbacks.clear();
                        (place.script, count) = (Script::LATIN, count - before);
                    }
                    (place.at, place.letter) = (place.at + count, place.letter + count);
                    place.last = match bytes[place.at - 1] {
                        b' ' => Known::SPACE,
                        last => {
                            if last.is_ascii_alphabetic() {
                                Known::LETTER
                            } else {
                                Sort::OTHER
                            }
                        }
                    };
                }
                if !goes_on {
                    continue;
                }
            } else {
                let mut characters = text[at..end].chars();
                let mut next = characters.next();
                while let Some(character) = next.filter(|it| !it.is_ascii()) {
                    let known = sorts.get(character);
                    next = characters.next();
                    let is_alone = |it: char| {
                        it.is_ascii()
                            || sorts.get(it).map_or_else(
                                || unicode::stands_alone(it) || is_pictograph(it),
                                |it| it.kind != Sort::ODD,
                            )
                    };
                    if !next.is_none_or(is_alone) || known.is_some_and(|it| it.kind == Sort::ODD) {
                        next = Some(character);
                        break;
                    }
                    let script = known.map_or_else(
                        || Some(Script::of(character)).filter(|it| it.is_specific()),
                        |it| it.script,
                    );
                    if let Some(script) = script.filter(|it| *it != place.script) {
                        self.finish(text, run, place, &mut item, None, fonts)?;
                        fallbacks.clear();
                        place.script = script;
                    }
                    if let Some(it) = known
                        .filter(|it| fallbacks.is_empty() && !it.is_settled && it.is_first_choice)
                    {
                        fallbacks.push(it.candidate);
                    }
                    let sort = match known.filter(|it| it.is_settled || fallbacks == [it.candidate])
                    {
                        Some(known) => known,
                        None => sorts.learn(character, run.font, fonts, &mut fallbacks)?,
                    };
                    let flags = match (place.last, sort.kind) {
                        (_, Sort::ODD) => {
                            next = Some(character);
                            break;
                        }
                        (Known::LETTER, Known::LETTER) => 0,
                        (Known::IDEOGRAPH, Known::IDEOGRAPH) if breaks_ideographs => {
                            abi::CLUSTER_BREAK_BEFORE
                        }
                        (Known::SPACE, _) => abi::CLUSTER_BREAK_BEFORE,
                        _ => {
                            u8::from(place.breaks.allows(text, place.at, run.word_break))
                                * abi::CLUSTER_BREAK_BEFORE
                        }
                    };
                    if sort.kind == Sort::UNDRAWN {
                        self.finish(text, run, place, &mut item, Some(0), fonts)?;
                        self.leave_blank(run, place.letter, flags, fonts)?;
                        (item.at, item.letter) =
                            (place.at + character.len_utf8(), place.letter + 1);
                    } else {
                        if sort.candidate != item.candidate {
                            self.finish(text, run, place, &mut item, Some(sort.candidate), fonts)?;
                        }
                        self.letters[place.letter].flags = flags
                            | if sort.kind == Sort::HANGING {
                                abi::CLUSTER_SPACE
                            } else {
                                0
                            };
                    }
                    (place.at, place.letter, place.last) =
                        (place.at + character.len_utf8(), place.letter + 1, sort.kind);
                }
                if next.is_none_or(|it| it.is_ascii()) {
                    continue;
                }
            }
            let cluster = &text[place.at..place.at + length_of_sequence(&text[place.at..end])?];
            let first = cluster.chars().next()?;
            if let Some(script) =
                Some(Script::of(first)).filter(|it| it.is_specific() && *it != place.script)
            {
                self.finish(text, run, place, &mut item, None, fonts)?;
                fallbacks.clear();
                place.script = script;
            }
            let candidate =
                fonts.select(run.font, cluster, presentation(cluster), &mut fallbacks)?;
            if candidate != item.candidate {
                self.finish(text, run, place, &mut item, Some(candidate), fonts)?;
            }
            let flag = |on: bool, flag: u8| if on { flag } else { 0 };
            self.letters[place.letter].flags =
                flag(
                    place.breaks.allows(text, place.at, run.word_break),
                    abi::CLUSTER_BREAK_BEFORE,
                ) | flag(is_hanging_space(first), abi::CLUSTER_SPACE);
            self.joined.extend(
                cluster
                    .char_indices()
                    .skip(1)
                    .map(|it| (place.at + it.0) as u32),
            );
            (place.at, place.letter, place.last) =
                (place.at + cluster.len(), place.letter + 1, Sort::OTHER);
        }
        self.finish(text, run, place, &mut item, None, fonts)
    }

    /// Shapes the item, and starts another one.
    fn finish(
        &mut self,
        text: &str,
        run: &TextRun,
        place: &Place,
        item: &mut Started,
        candidate: Option<usize>,
        fonts: &mut Fonts,
    ) -> Option<()> {
        let done = std::mem::replace(
            item,
            Started {
                at: place.at,
                letter: place.letter,
                candidate: candidate.unwrap_or(item.candidate),
            },
        );
        let whole = Item {
            run: 0,
            candidate: done.candidate,
            level: 0,
            script: place.script,
            draws: true,
            is_small_capital: false,
            end: place.letter,
        };
        if done.at == self.skipped {
            self.skipped_letters = done.letter;
        }
        if done.at.max(self.skipped) < place.at {
            self.shape_item(
                text,
                run,
                whole,
                done.letter,
                Some(done.at..place.at),
                fonts,
            )
        } else {
            Some(())
        }
    }

    fn index_of(&mut self, face: abi::Face) -> usize {
        self.faces
            .iter()
            .position(|known| *known == face)
            .unwrap_or_else(|| {
                self.faces.push(face);
                self.faces.len() - 1
            })
    }

    fn leave_blank(
        &mut self,
        run: &TextRun,
        letter: usize,
        flags: u8,
        fonts: &mut Fonts,
    ) -> Option<()> {
        let face = self
            .index_of(fonts.measured_instance(run.font, 0, run.size, 1.).2)
            .try_into()
            .ok()?;
        self.letters[letter] = Letter {
            advance: 0.,
            glyph: NO_GLYPH,
            flags: self.letters[letter].flags | flags,
            face,
        };
        Some(())
    }

    /// Replaces the clusters and the glyphs if nothing gets lost.
    fn abbreviate(&mut self, text: &str) {
        let letter = |it: &Cluster| {
            let glyph = match self.glyphs[it.glyphs.range()] {
                [] => NO_GLYPH,
                [Glyph { id, x: 0., y: 0. }] => {
                    u16::try_from(id).ok().filter(|it| *it != NO_GLYPH)?
                }
                _ => return None,
            };
            Some(Letter {
                advance: it.advance,
                glyph,
                flags: it.flags,
                face: it.face.try_into().ok()?,
            })
        };
        self.letters.extend(self.clusters.iter().map_while(letter));
        if self.letters.len() < self.clusters.len() {
            return self.letters.clear();
        }
        if self.clusters.len() < text.chars().count() {
            let mut starts = self.clusters.iter().map(|it| it.start).peekable();
            self.joined.extend(
                text.char_indices()
                    .map(|it| it.0 as u32)
                    .filter(|it| starts.next_if_eq(it).is_none()),
            );
        }
        self.clusters.clear();
        self.glyphs.clear();
    }

    /// `itemize` for ASCII.
    fn itemize_ascii(&mut self, text: &str, runs: &[TextRun], fonts: &mut Fonts) {
        let bytes = text.as_bytes();
        let script = if bytes.iter().any(u8::is_ascii_alphabetic) {
            Script::LATIN
        } else {
            Script::COMMON
        };
        let mut start = 0;
        self.clusters.reserve(bytes.len());
        for (index, run) in runs.iter().enumerate() {
            let end = (run.end as usize).clamp(start, bytes.len());
            for offset in start..end {
                let byte = bytes[offset];
                self.clusters.push(Cluster {
                    start: offset as u32,
                    advance: 0.,
                    glyphs: Span::default(),
                    bidi_level: 0,
                    flags: flags_in_ascii(bytes, offset),
                    face: 0,
                });
                let draws = !is_undrawn(byte.into());
                let candidate = match draws {
                    true => fonts.select(
                        run.font,
                        &text[offset..offset + 1],
                        Presentation::Any,
                        &mut Vec::new(),
                    ),
                    false => fonts.primary(run.font),
                };
                let candidate = candidate.unwrap_or(usize::MAX);
                self.extend_items(Item {
                    run: index,
                    candidate,
                    level: 0,
                    script,
                    draws,
                    is_small_capital: false,
                    end: self.clusters.len(),
                });
            }
            start = end;
        }
    }

    fn itemize(&mut self, text: &str, runs: &[TextRun], levels: Option<&[u8]>, fonts: &mut Fonts) {
        let mut breaks = Breaks::default();
        let mut script = text
            .chars()
            .map(Script::of)
            .find(|it| it.is_specific())
            .unwrap_or(Script::COMMON);
        let mut graphemes = Vec::new();
        let mut start = 0;
        for (index, run) in runs.iter().enumerate() {
            let end = (run.end as usize).clamp(start, text.len());
            let Some(piece) = text.get(start..end) else {
                continue;
            };
            let (mut fallbacks, may_shrink) = (Vec::new(), fonts.may_shrink(run.font));
            let (mut known, mut last) = (
                fonts
                    .resolved(run.font)
                    .filter(|_| !may_shrink)
                    .map(|it| std::mem::take(&mut it.known)),
                0,
            );
            known
                .iter_mut()
                .filter(|it| it.is_empty())
                .for_each(|it| *it = vec![0; Known::SLOTS]);
            let mut add = |offset: usize, cluster: &str| {
                let (first, level) = (
                    cluster.chars().next().unwrap_or(' '),
                    levels.map_or(0, |levels| levels[offset]),
                );
                let slots = known
                    .as_deref_mut()
                    .filter(|_| first.len_utf8() == cluster.len());
                let own = slots.as_deref().and_then(|it| Known::find(it, first));
                let last = std::mem::replace(&mut last, own.map_or(0, Known::kind));
                if let Some((own, item)) =
                    own.zip(self.items.last_mut().filter(|it| it.level == level))
                    && let Some(flags) = own.after(last, item, &fallbacks, run.word_break)
                {
                    self.clusters.push(Cluster {
                        start: offset as u32,
                        advance: 0.,
                        glyphs: Span::default(),
                        bidi_level: level,
                        flags,
                        face: 0,
                    });
                    item.end += 1;
                    return;
                }
                let draws = !is_undrawn(first);
                if first.is_ascii_alphabetic() {
                    script = Script::LATIN;
                } else if !first.is_ascii() {
                    script = Some(Script::of(first))
                        .filter(|it| it.is_specific())
                        .unwrap_or(script);
                }
                let previous = self.items.last().filter(|item| item.run == index);
                if previous.is_some_and(|item| item.script != script) {
                    fallbacks.clear();
                }
                let candidate = match previous {
                    Some(item) if item.draws && is_default_ignorable(first) => Some(item.candidate),
                    _ if !draws || is_default_ignorable(first) => fonts.primary(run.font),
                    _ => fonts.select(run.font, cluster, presentation(cluster), &mut fallbacks),
                };
                if let (Some(slots), Some(candidate), Some(resolved)) =
                    (slots, candidate, fonts.resolved(run.font))
                    && let Some(new) = Known::new(first, candidate, candidate < resolved.listed)
                        .filter(|_| resolved.candidates[candidate].covers(first))
                {
                    slots[first as usize % Known::SLOTS] = new.0;
                }
                let flag = |on: bool, flag: u8| if on { flag } else { 0 };
                self.clusters.push(Cluster {
                    start: offset as u32,
                    advance: 0.,
                    glyphs: Span::default(),
                    bidi_level: level,
                    flags: flag(
                        breaks.allows(text, offset, run.word_break),
                        abi::CLUSTER_BREAK_BEFORE,
                    ) | flag(is_hanging_space(first), abi::CLUSTER_SPACE)
                        | flag(first == '\u{AD}', abi::CLUSTER_SOFT_HYPHEN),
                    face: 0,
                });
                let item = Item {
                    run: index,
                    candidate: candidate.unwrap_or(usize::MAX),
                    level,
                    script,
                    draws,
                    is_small_capital: may_shrink
                        && candidate.is_some_and(|it| fonts.shrinks(run.font, it, first)),
                    end: self.clusters.len(),
                };
                self.extend_items(item);
            };
            let mut rest = piece;
            graphemes.clear();
            while !rest.is_empty() {
                let length = match rest.as_bytes() {
                    [first @ ..0x80, ..0x80, ..] if *first != b'\r' => 1,
                    _ if rest.chars().take(2).all(unicode::stands_alone) => {
                        rest.ceil_char_boundary(1)
                    }
                    _ if let Some(length) = length_with_marks(rest) => length,
                    _ => {
                        if graphemes.is_empty() {
                            unicode::find_breaks(BREAK_GRAPHEMES, piece, &mut graphemes);
                        }
                        let done = piece.len() - rest.len();
                        let next =
                            graphemes.get(graphemes.partition_point(|it| *it as usize <= done));
                        next.map_or(rest.len(), |it| *it as usize - done)
                    }
                };
                add(end - rest.len(), &rest[..length]);
                rest = &rest[length..];
            }
            if let Some((resolved, known)) = fonts.resolved(run.font).zip(known) {
                resolved.known = known;
            }
            start = end;
        }
    }

    /// `spelled` is where the text is, if there are letters. Fails if they do not do.
    fn shape_item(
        &mut self,
        text: &str,
        run: &TextRun,
        item: Item,
        first: usize,
        spelled: Option<Range<usize>>,
        fonts: &mut Fonts,
    ) -> Option<()> {
        let (resolved, face, metrics) = fonts.measured_instance(
            run.font,
            item.candidate,
            run.size,
            if item.is_small_capital { 0.7 } else { 1. },
        );
        let (candidate, size, face_index) = (
            &resolved.candidates[item.candidate],
            metrics.size,
            self.index_of(metrics),
        );
        if face_index > 0 && spelled.is_none() {
            self.clusters[first..item.end]
                .iter_mut()
                .for_each(|cluster| cluster.face = face_index as u16);
        }
        if !item.draws {
            return Some(());
        }

        let is_vertical = run.word_break & abi::RUN_UPRIGHT != 0;
        let (is_rtl, is_spaced) = (
            item.level & 1 == 1 && !is_vertical,
            run.letter_spacing != 0.,
        );
        let more_features;
        let has_alternates = run.word_break & abi::RUN_VERTICAL != 0;
        let features = if is_spaced || has_alternates {
            let off = [b"liga", b"clig"].map(|tag| Feature {
                tag: *tag,
                value: 0,
            });
            let on = [Feature {
                tag: *b"vert",
                value: 1,
            }];
            more_features = [
                &off[..usize::from(is_spaced) * 2],
                &on[..usize::from(has_alternates)],
                &candidate.features,
            ]
            .concat();
            &more_features
        } else {
            &candidate.features
        };
        let shaping = Shaping {
            face,
            size,
            script: item.script,
            is_rtl,
            is_vertical,
            capitalizes: item.is_small_capital,
            language: &resolved.language,
            features,
            features_hash: candidate.features_hash
                ^ u64::from(is_spaced)
                ^ u64::from(is_vertical) << 1
                ^ u64::from(item.is_small_capital) << 2
                ^ u64::from(has_alternates) << 3,
        };
        let placed = &mut self.placed;
        placed.clear();
        let scale = size / face.units_per_em() / STEPS_PER_UNIT as f32;
        if let Some(range) = spelled {
            let (whole, has_color, mut first, mut range) =
                (range.clone(), face.file.has_color, first, range);
            if range.start < self.skipped {
                if !has_color && shaping.is_local(&text[range.clone()]) {
                    first += text[range.start..self.skipped].chars().count()
                        - self
                            .joined
                            .iter()
                            .filter(|it| (range.start..self.skipped).contains(&(**it as usize)))
                            .count();
                    range.start = self.skipped;
                }
                (self.skipped, self.skipped_letters) = (range.start, first);
            }
            let letters = &mut self.letters[first..item.end];
            let left = if has_color { letters.len() } else { 0 };
            let mut spelling = Spelling {
                letters,
                done: 0,
                left,
                joined: &self.joined,
                scale,
                spacing: run.letter_spacing,
                face: face_index.try_into().ok()?,
            };
            WORDS.with_borrow_mut(|words| {
                words.shape(
                    &shaping,
                    text,
                    whole,
                    range.start,
                    (!has_color).then_some(&mut spelling),
                    placed,
                )
            });
            let bitmap = |it: &Placed| {
                (has_color && it.advance != 0)
                    .then(|| face.bitmap_advance(it.id.into(), size, resolved.device_scale))
                    .flatten()
            };
            spell_placed(text, &range, placed, &mut spelling, |it| {
                bitmap(it).unwrap_or(it.advance as f32 * scale)
            })?;
            if run.word_spacing != 0. {
                let starts = text[range.clone()].char_indices().filter(|it| {
                    spelling
                        .joined
                        .binary_search(&((range.start + it.0) as u32))
                        .is_err()
                });
                starts
                    .zip(spelling.letters)
                    .filter(|it| matches!(it.0.1, ' ' | '\u{A0}'))
                    .for_each(|it| it.1.advance += run.word_spacing);
            }
            return Some(());
        }
        let start = self.clusters[first].start as usize;
        let end = self
            .clusters
            .get(item.end)
            .map_or(text.len(), |next| next.start as usize);
        let clusters = &mut self.clusters[first..item.end];
        WORDS.with_borrow_mut(|words| words.shape(&shaping, text, start..end, start, None, placed));

        let has_vertical_metrics =
            is_vertical && face.table(u32::from_be_bytes(*b"vmtx")).is_some();
        let groups = &mut self.groups;
        groups.clear();
        let (mut glyph, mut guess, is_plain) = (
            0,
            if is_rtl { clusters.len() - 1 } else { 0 },
            !is_vertical && !is_rtl && !face.file.has_color,
        );
        self.glyphs.reserve(placed.len());
        while glyph < placed.len() {
            if is_plain {
                let next = placed[glyph..]
                    .iter()
                    .zip(&clusters[guess..])
                    .take_while(|it| it.0.cluster == it.1.start);
                let (alone, start) = (next.count().saturating_sub(1), self.glyphs.len() as u32);
                self.glyphs.extend(
                    placed[glyph..][..alone]
                        .iter()
                        .zip(&mut clusters[guess..])
                        .zip(start..)
                        .map(|((it, cluster), start)| {
                            (cluster.glyphs, cluster.advance) = (
                                Span {
                                    start,
                                    end: start + 1,
                                },
                                it.advance as f32 * scale,
                            );
                            Glyph {
                                id: it.id.into(),
                                x: it.dx as f32 * scale,
                                y: -it.dy as f32 * scale,
                            }
                        }),
                );
                (glyph, guess) = (glyph + alone, guess + alone);
            }
            let (offset, after) = (placed[glyph].cluster, guess + 1);
            if is_rtl
                && !face.file.has_color
                && clusters[guess].start == offset
                && placed
                    .get(glyph + 1)
                    .is_none_or(|it| it.cluster < offset && guess > 0)
            {
                let (it, start) = (placed[glyph], self.glyphs.len() as u32);
                self.glyphs.push(Glyph {
                    id: it.id.into(),
                    x: it.dx as f32 * scale,
                    y: -it.dy as f32 * scale,
                });
                (clusters[guess].glyphs, clusters[guess].advance) = (
                    Span {
                        start,
                        end: start + 1,
                    },
                    it.advance as f32 * scale,
                );
                (glyph, guess) = (glyph + 1, guess.saturating_sub(1));
                continue;
            }
            let owner = match clusters.get(guess) {
                Some(cluster) if cluster.start == offset => guess,
                _ => clusters
                    .partition_point(|cluster| cluster.start <= offset)
                    .saturating_sub(1),
            };
            guess = if is_rtl {
                owner.saturating_sub(1)
            } else {
                owner + 1
            };
            let owner_end = clusters.get(owner + 1).map_or(u32::MAX, |next| next.start);
            let (group_start, mut x) = (self.glyphs.len() as u32, 0.);
            while glyph < placed.len()
                && (clusters[owner].start..owner_end).contains(&placed[glyph].cluster)
            {
                let Placed {
                    id,
                    advance,
                    dx,
                    dy,
                    ..
                } = placed[glyph];
                let id = id.into();
                glyph += 1;
                if is_vertical {
                    let (y, advance) = match has_vertical_metrics {
                        true => (-dy as f32 * scale, advance as f32 * scale),
                        false => (
                            metrics.ascent,
                            if x == 0. {
                                metrics.ascent + metrics.descent
                            } else {
                                0.
                            },
                        ),
                    };
                    self.glyphs.push(Glyph {
                        id,
                        x: dx as f32 * scale,
                        y: if has_vertical_metrics { x + y } else { y },
                    });
                    x += advance;
                    continue;
                }
                self.glyphs.push(Glyph {
                    id,
                    x: x + dx as f32 * scale,
                    y: -dy as f32 * scale,
                });
                let is_bitmap = face.file.has_color && advance != 0;
                x += is_bitmap
                    .then(|| face.bitmap_advance(id, size, resolved.device_scale))
                    .flatten()
                    .unwrap_or(advance as f32 * scale);
            }
            let next = placed.get(glyph).filter(|_| is_plain).map(|next| {
                owner
                    + clusters[owner + 1..]
                        .iter()
                        .take_while(|it| it.start <= next.cluster)
                        .count()
            });
            guess = next.unwrap_or(guess);
            let next = if is_rtl {
                Some(after.max(owner + 1))
            } else {
                next
            };
            groups.push((owner, next, group_start, self.glyphs.len() as u32, x));
        }

        let first_character =
            |cluster: &Cluster| text[cluster.start as usize..].chars().next().unwrap_or(' ');
        for (index, &(owner, next, start, end, advance)) in groups.iter().enumerate() {
            let next = next
                .or(groups.get(index + 1).map(|group| group.0))
                .unwrap_or(clusters.len());
            if next == owner + 1 {
                (clusters[owner].glyphs, clusters[owner].advance) = (Span { start, end }, advance);
                continue;
            }
            let owner = (owner..next)
                .find(|it| !is_default_ignorable(first_character(&clusters[*it])))
                .unwrap_or(owner);
            clusters[owner].glyphs = Span { start, end };
            let Some([owner, rest @ ..]) = clusters.get_mut(owner..next) else {
                continue;
            };
            if rest.is_empty() {
                owner.advance = advance;
                continue;
            }
            let shares = |cluster: &Cluster| !is_default_ignorable(first_character(cluster));
            let share =
                advance / (1 + rest.iter().filter(|cluster| shares(cluster)).count()) as f32;
            owner.advance = share;
            rest.iter_mut()
                .filter(|cluster| shares(cluster))
                .for_each(|cluster| cluster.advance = share);
        }
        if is_spaced || run.word_spacing != 0. {
            for cluster in clusters {
                let character = first_character(cluster);
                let is_separator = matches!(
                    character,
                    ' ' | '\u{A0}'
                        | '\u{1361}'
                        | '\u{10100}'
                        | '\u{10101}'
                        | '\u{1039F}'
                        | '\u{1091F}'
                );
                if !is_default_ignorable(character) && (is_separator || !is_cursive(item.script)) {
                    cluster.advance += run.letter_spacing;
                }
                if is_separator {
                    cluster.advance += run.word_spacing;
                }
            }
        }
        Some(())
    }
}

pub fn shape(text: &str, runs: &[TextRun], direction: u8, output: &mut Shaped) {
    shape_with(text, runs, direction, true, output);
}

/// Where a word or an ideograph starts that is so far before `known` that what comes after that makes no difference to what is before it.
fn place_to_resume(text: &str, from: usize, known: usize) -> Option<usize> {
    let mut before = text
        .get(from..known)?
        .char_indices()
        .rev()
        .skip(16)
        .take(256);
    let mut next = before.next()?;
    for it in before {
        if it.1 == ' ' && is_letter(next.1)
            || (it.1 == ' ' || is_ideograph(it.1)) && is_ideograph(next.1)
        {
            return Some(from + next.0);
        }
        next = it;
    }
    None
}

pub fn shape_rest(text: &str, runs: &[TextRun], from: usize, known: usize, output: &mut Shaped) {
    output.clear();
    let Some(skipped) =
        place_to_resume(text, from, known).filter(|it| !may_be_bidirectional(&text[*it..]))
    else {
        return;
    };
    let before = runs.partition_point(|it| it.end as usize <= skipped);
    let (from, runs, fonts) = (
        runs[..before].last().map_or(from, |it| it.end as usize),
        &runs[before..],
        &mut *FONTS.lock(),
    );
    output.skipped = skipped;
    if !(runs
        .iter()
        .all(|run| run.word_break & 3 != abi::BREAK_ALL && !fonts.may_shrink(run.font))
        && output.spell(text, runs, from, fonts).is_some())
    {
        output.clear();
    }
}

fn shape_with(text: &str, runs: &[TextRun], direction: u8, may_spell: bool, output: &mut Shaped) {
    output.clear();
    let bidi = (direction == abi::DIRECTION_RTL || may_be_bidirectional(text))
        .then(|| unicode::resolve_bidi(text, direction));
    output.base_level = bidi.as_ref().map_or(0, |bidi| bidi.0);

    let fonts = &mut *FONTS.lock();
    let is_simple = bidi.is_none()
        && runs
            .iter()
            .all(|run| run.word_break & 3 != abi::BREAK_ALL && !fonts.may_shrink(run.font));
    if is_simple && may_spell && !text.is_empty() && output.spell(text, runs, 0, fonts).is_some() {
        return;
    }
    output.letters.clear();
    output.joined.clear();
    output.faces.clear();
    if is_simple && text.is_ascii() {
        output.itemize_ascii(text, runs, fonts);
    } else {
        output.itemize(text, runs, bidi.as_ref().map(|bidi| &bidi.1[..]), fonts);
    }
    let mut first = 0;
    for index in 0..output.items.len() {
        let item = output.items[index];
        if item.candidate != usize::MAX {
            output.shape_item(text, &runs[item.run], item, first, None, fonts);
        }
        first = item.end;
    }
    if bidi.is_none() {
        output.abbreviate(text);
    }
    if output.faces.is_empty() {
        output.faces.push(abi::Face {
            id: u32::MAX,
            size: 0.,
            ascent: 0.,
            descent: 0.,
            line_gap: 0.,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::{Description, describe, font_families};

    #[test]
    fn the_rest_is_shaped_like_the_whole() {
        crate::system_icu::install();
        let text = "12 34 56 78 90 12 To  AVAT. \u{2192} office \u{2713} fi x-1 -2 don\u{2019}t 1 22 333\u{2044}4 caf\u{e9} e\u{301} Тест «да» AV 日本語の文章、「テスト」です。漢字漢字漢字漢字（株）ぁー \
            한국어 문장, 👍🏽 x 👨\u{200d}👩 \u{2066}a.b()\u{2069} ก็ไทย ไทย and a\tb so on and so on and so on to the end\n";
        let (mut whole, mut before, mut rest, mut resumed) =
            (Shaped::default(), Shaped::default(), Shaped::default(), 0);
        for (family, (known, _)) in font_families()
            .iter()
            .flat_map(|family| text.char_indices().map(move |it| (family, it)))
        {
            let [regular, bold] =
                [400., 700.].map(|it| describe(Description::new(family.as_bytes(), it)));
            let text = &text[..text.ceil_char_boundary(known + 1 + known % 7)];
            let runs = |end: usize| {
                [(regular, 42), (bold, 59), (regular, end)].map(|it| TextRun {
                    end: it.1.min(end) as u32,
                    font: it.0,
                    size: 15.,
                    letter_spacing: 0.,
                    word_spacing: 1.,
                    word_break: 0,
                })
            };
            shape(
                &text[..known],
                &runs(known),
                abi::DIRECTION_LTR,
                &mut before,
            );
            shape(text, &runs(text.len()), abi::DIRECTION_LTR, &mut whole);
            shape_rest(text, &runs(text.len()), 0, known, &mut rest);
            if before.letters.is_empty() || rest.letters.is_empty() {
                continue;
            }
            resumed += 1;
            let kept = text[..rest.skipped].chars().count()
                - before
                    .joined
                    .partition_point(|it| (*it as usize) < rest.skipped);
            let with_faces = |it: &Shaped| {
                it.letters
                    .iter()
                    .map(|letter| {
                        (
                            Letter { face: 0, ..*letter },
                            it.faces[usize::from(letter.face)],
                        )
                    })
                    .collect::<Vec<_>>()
            };
            assert_eq!(
                [&with_faces(&before)[..kept], &with_faces(&rest)].concat(),
                with_faces(&whole),
                "{} {text:?}",
                &**family
            );
            assert_eq!(
                rest.joined,
                whole.joined[whole
                    .joined
                    .partition_point(|it| (*it as usize) < rest.skipped)..]
            );
        }
        assert!(resumed > 0);
        let text = "one two three four five six seven \u{5e9}";
        shape_rest(
            text,
            &[TextRun {
                end: text.len() as u32,
                font: describe(Description::new(b"", 400.)),
                size: 15.,
                letter_spacing: 0.,
                word_spacing: 0.,
                word_break: 0,
            }],
            0,
            text.len() - 2,
            &mut rest,
        );
        assert!(rest.letters.is_empty());
    }

    #[test]
    fn spelling_makes_no_difference() {
        crate::system_icu::install();
        let latin = "To  AVAT. \"Type\" a -> b\tfi ffl 1/2 x-1 -2 a-b (A) don\u{2019}t \u{201c}office\u{201d} \u{2014} caf\u{e9} a\u{a0}b \u{2022} so\u{2026} \u{fffc}\u{fffc} f\u{fffc}i 1\u{fffc}\t\u{fffc} $-1 ?' a\u{2192}b \u{2713}\u{2713} \u{9d} \u{1f600}\u{1f680}! \u{26a1} \u{25b6}W.\n";
        let isolated = "see \u{2066}a.b()\u{2069}, \u{2068}x-1\u{2069}-2 (\u{2066}-\u{2069}a) é-5 \u{2066}\u{2066} y\u{2069}\u{2069}\n";
        let mixed = "Тест «да» AV — 12 Ωμέγα-3 日本語の文章、「テスト」です。React 漢字（株）ぁー\u{3000}中 한국어 문장, ├── │ ✓ x\n";
        let sequences = "a ⚠\u{fe0f} b❤\u{fe0f}\u{200d}🔥 1\u{fe0f}\u{20e3} 👍🏽x-1 🇯🇵🇺🇸 👨\u{200d}👩\u{200d}👧 ✔\u{fe0e}e\u{301} fi-7 日\u{fe0f}\n";
        let (mut expected, mut actual) = (Shaped::default(), Shaped::default());
        for (family, text) in font_families()
            .iter()
            .flat_map(|family| [latin, isolated, mixed, sequences].map(|it| (family, it)))
        {
            let [regular, bold] =
                [400., 700.].map(|it| describe(Description::new(family.as_bytes(), it)));
            for (start, _) in text.char_indices().cycle().take(200) {
                let (text, spacing) = (&text[start..], (start % 3) as f32 - 1.);
                let run = |font, end: usize| TextRun {
                    end: end as u32,
                    font,
                    size: 15.,
                    letter_spacing: spacing,
                    word_spacing: spacing,
                    word_break: abi::BREAK_KEEP_ALL * (start % 3 / 2) as u8,
                };
                let runs = [
                    run(regular, text.floor_char_boundary(text.len() / 2)),
                    run(bold, text.len()),
                ];
                shape_with(text, &runs, abi::DIRECTION_LTR, false, &mut expected);
                shape_with(text, &runs, abi::DIRECTION_LTR, true, &mut actual);
                assert_eq!(
                    (
                        &actual.letters,
                        &actual.joined,
                        &actual.clusters,
                        &actual.glyphs,
                        &actual.faces
                    ),
                    (
                        &expected.letters,
                        &expected.joined,
                        &expected.clusters,
                        &expected.glyphs,
                        &expected.faces
                    ),
                    "{} {text:?}",
                    &**family
                );
            }
        }
    }
}
