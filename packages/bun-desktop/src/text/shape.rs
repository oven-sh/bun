use std::ops::Range;

use super::breaks::{Breaks, flags_in_ascii, is_ideograph, is_letter};
use super::fonts::{FONTS, Fonts, Presentation, is_default_ignorable};
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
    pub faces: Vec<abi::Face>,
    pub base_level: u8,
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

fn may_be_bidirectional(text: &str) -> bool {
    !text.is_ascii()
        && text.chars().any(|character| {
            matches!(character as u32, 0x590..=0x8FF | 0x200E..=0x200F | 0x202A..=0x202E | 0x2066..=0x2069
                | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF | 0x10800..=0x10FFF | 0x1E800..=0x1EFFF)
        })
}

fn is_cursive(script: Script) -> bool {
    matches!(
        &script.0,
        b"Arab" | b"Rohg" | b"Mand" | b"Mong" | b"Nkoo" | b"Phag" | b"Syrc"
    )
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

    /// What most text takes. Clusters are bytes until the end.
    fn spell(&mut self, text: &str, runs: &[TextRun], fonts: &mut Fonts) -> Option<()> {
        let (bytes, mut start) = (text.as_bytes(), 0);
        let (is_ascii, is_latin) = (text.is_ascii(), |it: char| Script::of(it) == Script::LATIN);
        let others = if is_ascii {
            Vec::new()
        } else {
            text.char_indices().filter(|it| !it.1.is_ascii()).collect()
        };
        let script = if bytes.iter().any(u8::is_ascii_alphabetic)
            || others.iter().any(|it| is_latin(it.1))
        {
            Script::LATIN
        } else {
            Script::COMMON
        };
        let mut objects = others.iter().filter(|it| it.1 == '\u{FFFC}').peekable();
        self.letters.resize(bytes.len(), UNSPELLED);
        for (index, run) in runs.iter().enumerate() {
            let end = (run.end as usize).clamp(start, bytes.len());
            let candidate = fonts
                .primary_for_ascii(run.font)
                .filter(|_| run.word_break & (abi::RUN_UPRIGHT | abi::RUN_VERTICAL) == 0)?;
            text.is_char_boundary(end).then_some(())?;
            for &(offset, it) in others[others.partition_point(|it| it.0 < start)..]
                .iter()
                .take_while(|it| it.0 < end)
                .filter(|it| it.1 != '\u{FFFC}')
            {
                (it < '\u{231A}'
                    && unicode::stands_alone(it)
                    && !(is_default_ignorable(it) || is_undrawn(it) || is_hanging_space(it))
                    && (is_latin(it) || !Script::of(it).is_specific()))
                .then_some(())?;
                (fonts.select(
                    run.font,
                    &text[offset..][..it.len_utf8()],
                    Presentation::Any,
                    &mut Vec::new(),
                ) == Some(candidate))
                .then_some(())?;
            }
            while start < end {
                let rest = &bytes[start..objects.peek().map_or(end, |it| it.0.min(end))];
                let drawn = match rest.iter().fold(true, |all, it| all & (*it >= b' ')) {
                    true => rest.len(),
                    false => rest.iter().take_while(|it| **it >= b' ').count(),
                };
                let undrawn = if objects.next_if(|it| it.0 == start).is_some() {
                    3
                } else {
                    1
                };
                matches!((drawn, bytes[start]), (1.., _) | (_, b'\t' | b'\n' | 0xEF))
                    .then_some(())?;
                let item = Item {
                    run: index,
                    candidate,
                    level: 0,
                    script,
                    draws: drawn > 0,
                    is_small_capital: false,
                    end: start + drawn.max(undrawn),
                };
                self.shape_item(text, run, item, start, fonts)?;
                start = item.end;
            }
        }
        for (offset, _) in text
            .match_indices('-')
            .filter(|it| bytes.get(it.0 + 1).is_some_and(u8::is_ascii_digit))
        {
            self.letters[offset + 1].flags = flags_in_ascii(bytes, offset + 1);
        }
        if !is_ascii {
            let (mut breaks, mut runs, mut done) = (Breaks::default(), runs.iter().peekable(), 0);
            for offset in others
                .iter()
                .flat_map(|&(offset, it)| [offset, offset + it.len_utf8()])
                .filter(|it| *it < bytes.len())
            {
                while runs.next_if(|it| it.end as usize <= offset).is_some() {}
                if std::mem::replace(&mut done, offset) < offset
                    && breaks.allows(text, offset, runs.peek()?.word_break)
                {
                    self.letters[offset].flags |= abi::CLUSTER_BREAK_BEFORE;
                }
            }
            let mut bytes = bytes.iter();
            self.letters
                .retain(|_| bytes.next().is_some_and(|it| it & 0xC0 != 0x80));
        }
        (start == text.len()).then_some(())
    }

    /// Adds what has been placed.
    fn spell_item(
        &mut self,
        text: &str,
        run: &TextRun,
        range: Range<usize>,
        scale: f32,
        face: u8,
    ) -> Option<()> {
        let bytes = text.as_bytes();
        for (index, it) in self.placed.iter().enumerate() {
            let (at, next) = (
                it.cluster as usize,
                self.placed
                    .get(index + 1)
                    .map_or(range.end, |it| it.cluster as usize),
            );
            ((it.dx, it.dy) == (0, 0) && it.advance >= 0 && it.id != NO_GLYPH && at < next)
                .then_some(())?;
            let joined = self.letters[at..next]
                .iter()
                .take_while(|it| it.advance < 0.)
                .count();
            let advance = match joined {
                1 => it.advance as f32 * scale,
                _ => it.advance as f32 * scale / text.get(at..at + joined)?.chars().count() as f32,
            };
            for (letter, at) in self.letters[at..at + joined].iter_mut().zip(at..) {
                *letter = Letter {
                    advance,
                    glyph: NO_GLYPH,
                    flags: flags_in_ascii(bytes, at),
                    face,
                };
            }
            self.letters[at].glyph = it.id;
        }
        let letters = &mut self.letters[range.clone()];
        letters
            .iter()
            .fold(true, |all, it| all & (it.advance >= 0.))
            .then_some(())?;
        if run.letter_spacing != 0. || run.word_spacing != 0. {
            for (letter, at) in letters.iter_mut().zip(range) {
                letter.advance += run.letter_spacing;
                if bytes[at] == b' ' || bytes[at..].starts_with("\u{A0}".as_bytes()) {
                    letter.advance += run.word_spacing;
                }
            }
        }
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
        if self.clusters.len() == text.chars().count() {
            self.letters.extend(self.clusters.iter().map_while(letter));
        }
        if self.letters.len() < self.clusters.len() {
            return self.letters.clear();
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

    /// Fails if there are letters, and they do not do.
    fn shape_item(
        &mut self,
        text: &str,
        run: &TextRun,
        item: Item,
        first: usize,
        fonts: &mut Fonts,
    ) -> Option<()> {
        let (resolved, face) = fonts.instance(run.font, item.candidate, run.size);
        let candidate = &resolved.candidates[item.candidate];
        let size = run.size * candidate.size_adjust * if item.is_small_capital { 0.7 } else { 1. };
        let metrics = candidate.line_metrics(face, size, resolved.device_scale);
        let face_index = self
            .faces
            .iter()
            .position(|known| *known == metrics)
            .unwrap_or_else(|| {
                self.faces.push(metrics);
                self.faces.len() - 1
            });
        let spells = !self.letters.is_empty();
        if spells && !item.draws {
            self.letters[first] = Letter {
                advance: 0.,
                glyph: NO_GLYPH,
                flags: flags_in_ascii(text.as_bytes(), first),
                face: face_index.try_into().ok()?,
            };
        } else if face_index > 0 && !spells {
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
        if spells {
            let face = u8::try_from(face_index)
                .ok()
                .filter(|_| !face.file.has_color)?;
            WORDS.with_borrow_mut(|words| {
                words.shape(
                    &shaping,
                    text,
                    first..item.end,
                    Some(Spelling {
                        letters: &mut self.letters,
                        scale,
                        face,
                    }),
                    placed,
                )
            });
            return self.spell_item(text, run, first..item.end, scale, face);
        }
        let start = self.clusters[first].start as usize;
        let end = self
            .clusters
            .get(item.end)
            .map_or(text.len(), |next| next.start as usize);
        let clusters = &mut self.clusters[first..item.end];
        WORDS.with_borrow_mut(|words| words.shape(&shaping, text, start..end, None, placed));

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
                    .then(|| face.bitmap_advance(id, size))
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

fn shape_with(text: &str, runs: &[TextRun], direction: u8, may_spell: bool, output: &mut Shaped) {
    output.clusters.clear();
    output.glyphs.clear();
    output.letters.clear();
    output.faces.clear();
    output.items.clear();
    let bidi = (direction == abi::DIRECTION_RTL || may_be_bidirectional(text))
        .then(|| unicode::resolve_bidi(text, direction));
    output.base_level = bidi.as_ref().map_or(0, |bidi| bidi.0);

    let fonts = &mut *FONTS.lock();
    let is_simple = bidi.is_none()
        && runs
            .iter()
            .all(|run| run.word_break & 3 != abi::BREAK_ALL && !fonts.may_shrink(run.font));
    if is_simple && may_spell && !text.is_empty() && output.spell(text, runs, fonts).is_some() {
        return;
    }
    output.letters.clear();
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
            output.shape_item(text, &runs[item.run], item, first, fonts);
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
    fn spelling_makes_no_difference() {
        crate::system_icu::install();
        let text = "To  AVAT. \"Type\" a -> b\tfi ffl 1/2 x-1 -2 a-b (A) don\u{2019}t \u{201c}office\u{201d} \u{2014} caf\u{e9} a\u{a0}b \u{2022} so\u{2026} \u{fffc}\u{fffc} f\u{fffc}i 1\u{fffc}\t\u{fffc} $-1 ?' W.\n";
        let (mut expected, mut actual) = (Shaped::default(), Shaped::default());
        for family in font_families() {
            let [regular, bold] =
                [400., 700.].map(|it| describe(Description::new(family.as_bytes(), it)));
            for (start, _) in text.char_indices().cycle().take(400) {
                let (text, spacing) = (&text[start..], (start % 2) as f32);
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
                        &actual.clusters,
                        &actual.glyphs,
                        &actual.faces
                    ),
                    (
                        &expected.letters,
                        &expected.clusters,
                        &expected.glyphs,
                        &expected.faces
                    ),
                    "{} from {start}",
                    &*family
                );
            }
        }
    }
}
