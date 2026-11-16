use super::breaks::{Breaks, breaks_in_ascii};
use super::fonts::{FONTS, Fonts, Presentation, is_default_ignorable};
use super::shaper::{Feature, STEPS_PER_UNIT};
use super::words::{Placed, Shaping, WORDS};
use crate::abi::{self, Cluster, Glyph, Span, TextRun};
use crate::bun::abi::BREAK_GRAPHEMES;
use crate::unicode::{self, Script};

#[derive(Default)]
pub struct Shaped {
    pub clusters: Vec<Cluster>,
    pub glyphs: Vec<Glyph>,
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

    /// `itemize` for what most text is.
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
            let primary = fonts.primary_for_ascii(run.font);
            if let Some(candidate) = primary {
                self.clusters.extend((start..end).map(|offset| {
                    let breaks = if breaks_in_ascii(bytes, offset) {
                        abi::CLUSTER_BREAK_BEFORE
                    } else {
                        0
                    };
                    let space = if matches!(bytes[offset], b' ' | b'\t') {
                        abi::CLUSTER_SPACE
                    } else {
                        0
                    };
                    Cluster {
                        start: offset as u32,
                        advance: 0.,
                        glyphs: Span::default(),
                        bidi_level: 0,
                        flags: breaks | space,
                        face: 0,
                    }
                }));
                for part in bytes[start..end]
                    .chunk_by(|a, b| is_undrawn((*a).into()) == is_undrawn((*b).into()))
                {
                    start += part.len();
                    self.items.push(Item {
                        run: index,
                        candidate,
                        level: 0,
                        script,
                        draws: !is_undrawn(part[0].into()),
                        is_small_capital: false,
                        end: start,
                    });
                }
                continue;
            }
            for offset in start..end {
                let byte = bytes[offset];
                let breaks = if breaks_in_ascii(bytes, offset) {
                    abi::CLUSTER_BREAK_BEFORE
                } else {
                    0
                };
                let space = if matches!(byte, b' ' | b'\t') {
                    abi::CLUSTER_SPACE
                } else {
                    0
                };
                self.clusters.push(Cluster {
                    start: offset as u32,
                    advance: 0.,
                    glyphs: Span::default(),
                    bidi_level: 0,
                    flags: breaks | space,
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
            let mut fallbacks = Vec::new();
            let mut add = |offset: usize, cluster: &str| {
                let first = cluster.chars().next().unwrap_or(' ');
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
                let flag = |on: bool, flag: u8| if on { flag } else { 0 };
                let level = levels.map_or(0, |levels| levels[offset]);
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
                    is_small_capital: candidate
                        .is_some_and(|it| fonts.shrinks(run.font, it, first)),
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
            start = end;
        }
    }

    fn shape_item(
        &mut self,
        text: &str,
        run: &TextRun,
        item: Item,
        first: usize,
        fonts: &mut Fonts,
    ) {
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
        let start = self.clusters[first].start as usize;
        let end = self
            .clusters
            .get(item.end)
            .map_or(text.len(), |next| next.start as usize);
        let clusters = &mut self.clusters[first..item.end];
        clusters
            .iter_mut()
            .for_each(|cluster| cluster.face = face_index as u16);
        if !item.draws {
            return;
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
        WORDS.with_borrow_mut(|words| words.shape(&shaping, text, start..end, placed));

        let scale = size / face.units_per_em() / STEPS_PER_UNIT as f32;
        let has_vertical_metrics =
            is_vertical && face.table(u32::from_be_bytes(*b"vmtx")).is_some();
        let groups = &mut self.groups;
        groups.clear();
        let (mut glyph, mut guess, is_plain) =
            (0, 0, !is_vertical && !is_rtl && !face.file.has_color);
        self.glyphs.reserve(placed.len());
        while glyph < placed.len() {
            while is_plain
                && let (Some([it, next]), Some([cluster, after])) = (
                    placed[glyph..].first_chunk(),
                    clusters[guess..].first_chunk_mut(),
                )
                && (it.cluster, next.cluster) == (cluster.start, after.start)
            {
                let start = self.glyphs.len() as u32;
                (cluster.glyphs, cluster.advance) = (
                    Span {
                        start,
                        end: start + 1,
                    },
                    it.advance as f32 * scale,
                );
                self.glyphs.push(Glyph {
                    id: it.id.into(),
                    x: it.dx as f32 * scale,
                    y: -it.dy as f32 * scale,
                });
                (glyph, guess) = (glyph + 1, guess + 1);
            }
            let offset = placed[glyph].cluster;
            let owner = match clusters.get(guess) {
                Some(cluster) if cluster.start == offset => guess,
                _ => clusters
                    .partition_point(|cluster| cluster.start <= offset)
                    .saturating_sub(1),
            };
            guess = owner + 1;
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
            groups.push((owner, next, group_start, self.glyphs.len() as u32, x));
        }
        if is_rtl {
            groups.reverse();
        }

        let first_character =
            |cluster: &Cluster| text[cluster.start as usize..].chars().next().unwrap_or(' ');
        for (index, &(owner, next, start, end, advance)) in groups.iter().enumerate() {
            let next = next
                .or(groups.get(index + 1).map(|group| group.0))
                .unwrap_or(clusters.len());
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
    }
}

pub fn shape(text: &str, runs: &[TextRun], direction: u8, output: &mut Shaped) {
    output.clusters.clear();
    output.glyphs.clear();
    output.faces.clear();
    output.items.clear();
    let bidi = (direction == abi::DIRECTION_RTL || may_be_bidirectional(text))
        .then(|| unicode::resolve_bidi(text, direction));
    output.base_level = bidi.as_ref().map_or(0, |bidi| bidi.0);

    let fonts = &mut *FONTS.lock();
    if bidi.is_none()
        && text.is_ascii()
        && runs
            .iter()
            .all(|run| run.word_break & 3 != abi::BREAK_ALL && !fonts.may_shrink(run.font))
    {
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
