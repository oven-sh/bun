//! Fonts, from the UI library. Without it, every character is a square of 1em.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::rc::Rc;

use crate::abi::{self, Cluster, FontMetrics, FontSetting, Glyph, Slice, TextRun};
use crate::abi_graphics::Graphics;
use crate::font_face::Coverage;
use crate::name::{Map, Name, Set};
use crate::order::Order as _;
use crate::properties::{Groups, Id};
use crate::svg_values::TextRendering;
use crate::types::{AutoOrNone, FontCaps, FontKerning, FontStyle, Ligatures, Numeric};

unsafe extern "C" {
    safe fn Bun__Desktop__renderer() -> *const c_void;
    safe fn Bun__Desktop__graphics() -> *const c_void;
}

pub(crate) fn graphics() -> Option<&'static Graphics> {
    // SAFETY: null, or a static of the library, which is never unloaded.
    unsafe { Bun__Desktop__graphics().cast::<Graphics>().as_ref() }
}

pub(crate) fn renderer() -> Option<&'static abi::Renderer> {
    // SAFETY: null, or a static of the library, which is never unloaded.
    unsafe { Bun__Desktop__renderer().cast::<abi::Renderer>().as_ref() }
}

#[derive(Default)]
#[repr(C)]
pub(crate) struct Shaped {
    pub(crate) text: String,
    /// One for each cluster, or none.
    pub(crate) letters: Vec<abi::Letter>,
    /// Where the characters are that do not start a letter.
    joined: Box<[u32]>,
    pub(crate) label: Option<crate::lines::Label>,
    spelled_out: core::cell::OnceCell<(Box<[Cluster]>, Box<[Glyph]>)>,
    pub(crate) faces: smallvec::SmallVec<[abi::Face; 1]>,
    pub(crate) base_level: u8,
    /// Stands in for the runs and the direction. 0 after `shape_rest`.
    pub(crate) how: u64,
}

impl Shaped {
    #[inline]
    fn spelled_out(&self) -> &(Box<[Cluster]>, Box<[Glyph]>) {
        self.spelled_out.get_or_init(|| {
            let (clusters, glyphs) = abi::spell_out(&self.text, &self.letters, &self.joined);
            (clusters.into(), glyphs.into())
        })
    }

    #[inline]
    pub(crate) fn clusters(&self) -> &[Cluster] {
        &self.spelled_out().0
    }

    pub(crate) fn glyphs(&self) -> &[Glyph] {
        &self.spelled_out().1
    }

    pub(crate) fn count(&self) -> usize {
        if self.letters.is_empty() {
            self.clusters().len()
        } else {
            self.letters.len()
        }
    }

    /// How many clusters start in that part of the text.
    pub(crate) fn count_in(&self, range: core::ops::Range<usize>) -> usize {
        let before = |offset: usize| self.joined.partition_point(|it| (*it as usize) < offset);
        match self.letters.len() {
            0 => {
                self.clusters()
                    .partition_point(|it| (it.start as usize) < range.end)
                    - self
                        .clusters()
                        .partition_point(|it| (it.start as usize) < range.start)
            }
            len if len == self.text.len() => range.len(),
            _ => {
                self.text.as_bytes()[range.clone()]
                    .chunks(255)
                    .map(|it| {
                        usize::from(
                            it.iter()
                                .fold(0, |count, it| count + u8::from(*it as i8 >= -0x40)),
                        )
                    })
                    .sum::<usize>()
                    - (before(range.end) - before(range.start))
            }
        }
    }

    /// How many clusters start before `offset`, which tends to be near the end.
    pub(crate) fn count_before(&self, offset: usize) -> usize {
        self.count() - self.count_in(offset..self.text.len())
    }

    /// Of a cluster that tends to be near the end.
    pub(crate) fn start_of(&self, cluster: usize) -> usize {
        match self.letters.len() {
            0 => self.clusters()[cluster].start as usize,
            len if len == self.text.len() => cluster,
            len => self
                .text
                .char_indices()
                .rev()
                .filter(|it| self.joined.binary_search(&(it.0 as u32)).is_err())
                .nth(len - 1 - cluster)
                .map_or(0, |it| it.0),
        }
    }

    /// How many letters the two start with.
    pub(crate) fn letters_in_common(&self, other: &Shaped) -> usize {
        if self.faces.iter().zip(&other.faces).all(|it| it.0 == it.1) {
            self.letters
                .iter()
                .zip(&other.letters)
                .take_while(|it| it.0 == it.1)
                .count()
        } else {
            0
        }
    }

    pub(crate) fn has_a_letter_per_character(&self) -> bool {
        !self.letters.is_empty() && self.joined.is_empty()
    }
}

pub(crate) struct Fonts {
    pub(crate) device_scale: f32,
    pub(crate) scope: u32,
    pub(crate) settings: Option<std::sync::Arc<bun_web::host::FontSettings>>,
    metrics: RefCell<Map<(u32, u32), FontMetrics>>,
    pub(crate) used: RefCell<Set<Wanted>>,
    pub(crate) newly_used: RefCell<Vec<Wanted>>,
    /// There is no telling with what characters.
    pub(crate) used_by_canvases: Set<Wanted>,
    /// By what `describe` has returned.
    described: RefCell<Set<(u32, Wanted)>>,
    /// The first bytes of the characters that faces are waiting for.
    awaited: Option<Box<[bool; 256]>>,
    written: RefCell<Set<(u32, char)>>,
    pub(crate) newly_written: RefCell<Vec<(u32, char)>>,
    /// Since something was added to `newly_used`.
    pub(crate) has_written: Cell<bool>,
}

/// The family in lowercase, the stretch, the slope and the weight.
pub(crate) type Wanted = (Name, [u32; 3]);

pub(crate) fn features(style: &Groups) -> Vec<FontSetting> {
    let (font, mut features) = (&style.font, Vec::new());
    let mut add = |on: bool, tags: &[&[u8; 4]], value: f32| {
        if on {
            features.extend(tags.iter().map(|tag| FontSetting { tag: **tag, value }));
        }
    };
    let ligatures = |flags| font.ligatures.intersects(flags);
    add(
        ligatures(Ligatures::NONE | Ligatures::NO_COMMON),
        &[b"liga", b"clig"],
        0.0,
    );
    add(
        ligatures(Ligatures::NONE | Ligatures::NO_CONTEXTUAL),
        &[b"calt"],
        0.0,
    );
    add(ligatures(Ligatures::DISCRETIONARY), &[b"dlig"], 1.0);
    add(ligatures(Ligatures::HISTORICAL), &[b"hlig"], 1.0);
    for (flag, tag) in [
        (Numeric::LINING, b"lnum"),
        (Numeric::OLDSTYLE, b"onum"),
        (Numeric::PROPORTIONAL, b"pnum"),
        (Numeric::TABULAR, b"tnum"),
        (Numeric::DIAGONAL, b"frac"),
        (Numeric::STACKED, b"afrc"),
        (Numeric::ORDINAL, b"ordn"),
        (Numeric::SLASHED_ZERO, b"zero"),
    ] {
        add(font.numeric.contains(flag), &[tag], 1.0);
    }
    let caps: &[&[u8; 4]] = match font.caps {
        FontCaps::Normal => &[],
        FontCaps::SmallCaps => &[b"smcp"],
        FontCaps::AllSmallCaps => &[b"smcp", b"c2sc"],
        FontCaps::PetiteCaps => &[b"pcap"],
        FontCaps::AllPetiteCaps => &[b"pcap", b"c2pc"],
        FontCaps::Unicase => &[b"unic"],
        FontCaps::TitlingCaps => &[b"titl"],
    };
    add(true, caps, 1.0);
    let others = [
        Id::FontVariantEastAsian,
        Id::FontVariantPosition,
        Id::FontVariantAlternates,
    ]
    .map(|it| style.other_if_set(it));
    for word in others
        .into_iter()
        .flatten()
        .flat_map(str::split_ascii_whitespace)
    {
        let tag = match word {
            "jis78" => b"jp78",
            "jis83" => b"jp83",
            "jis90" => b"jp90",
            "jis04" => b"jp04",
            "simplified" => b"smpl",
            "traditional" => b"trad",
            "full-width" => b"fwid",
            "proportional-width" => b"pwid",
            "ruby" => b"ruby",
            "sub" => b"subs",
            "super" => b"sups",
            "historical-forms" => b"hist",
            _ => continue,
        };
        add(true, &[tag], 1.0);
    }
    features.extend(font.features.iter());
    features
}

/// What at-rules add to the description of a font.
#[derive(Default)]
pub(crate) struct Defined {
    pub(crate) features: Vec<FontSetting>,
    pub(crate) palette_family: Vec<u8>,
    pub(crate) palette: u32,
    pub(crate) palette_overrides: Vec<[u32; 2]>,
}

impl Fonts {
    /// The second is for `monospace`.
    pub(crate) fn medium_sizes(&self) -> [f32; 2] {
        self.settings
            .as_ref()
            .map_or([16.0, 13.0], |it| [it.size, it.monospace_size])
    }

    pub(crate) fn new(scope: u32) -> Fonts {
        Fonts {
            scope,
            settings: None,
            device_scale: 1.0,
            metrics: RefCell::default(),
            used: RefCell::default(),
            newly_used: RefCell::default(),
            used_by_canvases: Set::default(),
            described: RefCell::default(),
            awaited: None,
            written: RefCell::default(),
            newly_written: RefCell::default(),
            has_written: Cell::new(false),
        }
    }

    pub(crate) fn forget_metrics(&self) {
        self.metrics.borrow_mut().clear();
    }

    pub(crate) fn describe(&self, groups: &Groups, defined: &Defined) -> u32 {
        let font = &groups.font;
        let id = self.identify(groups, defined);
        for family in font.family.names() {
            let used = (
                Name::lowercase(family),
                [font.stretch.0, font.style.slope(), font.weight.0].map(|it| it.round().to_bits()),
            );
            if self.described.borrow_mut().insert((id, used)) && self.used.borrow_mut().insert(used)
            {
                self.has_written
                    .set(self.has_written.get() && !self.newly_used.borrow().is_empty());
                self.newly_used.borrow_mut().push(used);
            }
        }
        id
    }

    pub(crate) fn note_written(&self, text: &str, from: usize, runs: &[TextRun]) {
        self.has_written.set(true);
        let Some(awaited) = self
            .awaited
            .as_deref()
            .filter(|it| text[from..].bytes().any(|byte| it[usize::from(byte)]))
        else {
            return;
        };
        let mut runs = runs.iter().peekable();
        for (at, character) in text[from..]
            .char_indices()
            .map(|it| (from + it.0, it.1))
            .filter(|it| awaited[usize::from(text.as_bytes()[it.0])])
        {
            while runs.next_if(|it| it.end as usize <= at).is_some() {}
            let written = runs
                .peek()
                .map(|it| (it.font, character))
                .filter(|it| self.written.borrow_mut().insert(*it));
            self.newly_written.borrow_mut().extend(written);
        }
    }

    pub(crate) fn wait_for<'a>(&mut self, faces: impl Iterator<Item = &'a Coverage>) {
        let mut awaited = None;
        for face in faces {
            let awaited: &mut Box<[bool; 256]> =
                awaited.get_or_insert_with(|| Box::new([false; 256]));
            (0..=u8::MAX)
                .zip(awaited.iter_mut())
                .for_each(|(byte, it)| {
                    *it |= if byte < 128 {
                        face.has(char::from(byte))
                    } else {
                        face.has_more_than_ascii()
                    }
                });
        }
        self.awaited = awaited;
        self.written.get_mut().clear();
    }

    pub(crate) fn is_for(&self, font: u32, wanted: Wanted) -> bool {
        self.described.borrow().contains(&(font, wanted))
    }

    fn identify(&self, groups: &Groups, defined: &Defined) -> u32 {
        let (Some(renderer), font) = (renderer(), &groups.font) else {
            return 0;
        };
        let features = [&defined.features[..], &features(groups)].concat();
        let mut adjust = groups
            .other(Id::FontSizeAdjust)
            .split_ascii_whitespace()
            .rev();
        let size_adjust = adjust.next().and_then(|it| it.parse::<f32>().ok());
        let mut language_override = [0; 4];
        if let [b'"', tag @ .., b'"'] = groups.other(Id::FontLanguageOverride).as_bytes() {
            language_override = core::array::from_fn(|it| *tag.get(it).unwrap_or(&b' '));
        }
        let is_smoothed = matches!(
            groups.other(Id::WebkitFontSmoothing),
            "auto" | "subpixel-antialiased"
        ) && groups.svg.text_rendering != TextRendering::GeometricPrecision;
        let allowed = |value, bit| if value == AutoOrNone::Auto { bit } else { 0 };
        let (style, oblique_angle) = match font.style {
            FontStyle::Normal => (abi::FONT_NORMAL, 0.0),
            FontStyle::Italic => (abi::FONT_ITALIC, 0.0),
            FontStyle::Oblique(angle) => (abi::FONT_OBLIQUE, angle),
        };
        let language = font
            .locale
            .0
            .strip_prefix('"')
            .and_then(|it| it.strip_suffix('"'));
        let chosen = self
            .settings
            .as_ref()
            .filter(|it| !it.generic.is_empty())
            .map(|settings| {
                let chosen = |name: &[u8]| {
                    settings.generic.iter().find(|it| {
                        name.split_first() == Some((&abi::GENERIC_FAMILY, it.0.as_bytes()))
                    })
                };
                font.family
                    .names()
                    .flat_map(|it| [chosen(it).map_or(it, |it| it.1.as_bytes()), b"\0"])
                    .collect::<Vec<_>>()
                    .concat()
            });
        let description = abi::FontDescription {
            scope: self.scope,
            families: Slice::new(chosen.as_deref().unwrap_or(&font.family.0)),
            weight: font.weight.0,
            stretch: font.stretch.0,
            style,
            synthesis: allowed(font.synthesis_weight, abi::SYNTHESIZE_WEIGHT)
                | allowed(font.synthesis_style, abi::SYNTHESIZE_STYLE)
                | if groups.other(Id::FontSynthesisSmallCaps) == "auto" {
                    abi::SYNTHESIZE_SMALL_CAPS
                } else {
                    0
                }
                | if is_smoothed {
                    abi::SYNTHESIZE_SMOOTHING
                } else {
                    0
                },
            optical_sizing: font.optical_sizing == AutoOrNone::Auto,
            kerning: font.kerning != FontKerning::None,
            oblique_angle,
            variations: Slice::new(&font.variations),
            features: Slice::new(&features),
            language: Slice::new(language.unwrap_or_default().as_bytes()),
            device_scale: self.device_scale,
            language_override,
            size_adjust_metric: match adjust.next() {
                _ if size_adjust.is_none() => abi::ADJUST_NONE,
                Some("cap-height") => abi::ADJUST_CAP_HEIGHT,
                Some("ch-width") => abi::ADJUST_CH_WIDTH,
                Some("ic-width") => abi::ADJUST_IC_WIDTH,
                Some("ic-height") => abi::ADJUST_IC_HEIGHT,
                _ => abi::ADJUST_EX_HEIGHT,
            },
            size_adjust: size_adjust.unwrap_or(0.0),
            emoji: match groups.other(Id::FontVariantEmoji) {
                "text" => abi::EMOJI_AS_TEXT,
                "emoji" => abi::EMOJI_IN_COLOR,
                "unicode" => abi::EMOJI_AS_IN_UNICODE,
                _ => abi::EMOJI_NORMAL,
            },
            palette_family: Slice::new(&defined.palette_family),
            palette: defined.palette,
            palette_overrides: Slice::new(&defined.palette_overrides),
        };
        // SAFETY: what the slices point to outlives the call.
        unsafe { (renderer.font_describe)(&raw const description) }
    }

    pub(crate) fn metrics(&self, font: u32, size: f32) -> FontMetrics {
        *self
            .metrics
            .borrow_mut()
            .entry((font, size.to_bits()))
            .or_insert_with(|| match renderer() {
                Some(renderer) => (renderer.font_metrics)(font, size),
                None => FontMetrics {
                    ascent: (size * 0.8).round(),
                    descent: (size * 0.2).round(),
                    line_gap: 0.0,
                    x_height: size * 0.8,
                    cap_height: size * 0.8,
                    zero_advance: size.round(),
                    ideograph_advance: size.round(),
                    space_advance: size.round(),
                    underline_offset: size * 0.1,
                    underline_thickness: size * 0.05,
                    average_advance: size.round(),
                    widest_advance: size.round(),
                },
            })
    }
}

/// Next to the direction: a line may start with anything but a space.
pub(crate) const BREAKS_ANYWHERE: u8 = 0x80;

fn allow_break(flags: &mut u8) {
    *flags |= if *flags & abi::CLUSTER_SPACE == 0 {
        abi::CLUSTER_BREAK_BEFORE
    } else {
        0
    };
}

/// For a text that starts with `known` bytes of a former one. `runs` start at `from`. Also returns from where on it has been shaped, and how many letters have stayed the same.
pub(crate) fn shape_rest(
    former: Rc<Shaped>,
    known: usize,
    text: &str,
    (runs, from): (&[TextRun], usize),
    direction: u8,
) -> Result<(Shaped, usize, usize), Rc<Shaped>> {
    let Some(renderer) = renderer().filter(|_| !former.letters.is_empty()) else {
        return Err(former);
    };
    // SAFETY: as in `shape`.
    let (letters, joined, faces, skipped) = unsafe {
        let rest = (renderer.shape_rest)(
            Slice::new(text.as_bytes()),
            Slice::new(runs),
            from as u32,
            known as u32,
        );
        (
            rest.letters.get(),
            rest.joined.get(),
            rest.faces.get(),
            rest.skipped as usize,
        )
    };
    if letters.is_empty() || skipped > known || former.faces.len() + faces.len() > 256 {
        return Err(former);
    }
    let (kept, mut all) = (former.count_before(skipped), former.faces.clone());
    let indices = faces.iter().map(|face| {
        all.extend((!all.contains(face)).then_some(*face));
        all.iter().position(|it| it == face).unwrap_or(0) as u8
    });
    let indices: smallvec::SmallVec<[u8; 8]> = indices.collect();
    let letters = letters.iter().map(|&(mut it)| {
        it.face = indices[usize::from(it.face)];
        if direction & BREAKS_ANYWHERE != 0 {
            allow_break(&mut it.flags);
        }
        it
    });
    let same = kept
        + former.letters[kept..]
            .iter()
            .zip(letters.clone())
            .take_while(|it| *it.0 == it.1)
            .count();
    let joined = [
        &former.joined[..former.joined.partition_point(|it| (*it as usize) < skipped)],
        joined,
    ]
    .concat()
    .into();
    let (mut own_text, mut own_letters) = match Rc::try_unwrap(former) {
        Ok(it) => (it.text, it.letters),
        Err(it) => {
            let (mut text, mut letters) = (
                String::with_capacity(text.len() * 5 / 4),
                Vec::with_capacity((kept + letters.len()) * 5 / 4),
            );
            text.push_str(&it.text[..skipped]);
            letters.extend_from_slice(&it.letters[..kept]);
            (text, letters)
        }
    };
    own_text.truncate(skipped);
    own_text.push_str(&text[skipped..]);
    own_letters.truncate(kept);
    own_letters.extend(letters);
    let label = crate::lines::Label::new(text, &own_letters, &all);
    Ok((
        Shaped {
            text: own_text,
            letters: own_letters,
            joined,
            label,
            faces: all,
            ..Shaped::default()
        },
        skipped,
        same,
    ))
}

pub(crate) fn shape(text: &str, runs: &[TextRun], direction: u8) -> Shaped {
    let (anywhere, direction) = (
        direction & BREAKS_ANYWHERE != 0,
        direction & !BREAKS_ANYWHERE,
    );
    let mut shaped = match renderer() {
        None => shape_squares(text, runs, direction),
        // SAFETY: the arguments outlive the call, and the result is copied before the next one.
        Some(renderer) => unsafe {
            let shaped = (renderer.shape)(Slice::new(text.as_bytes()), Slice::new(runs), direction);
            let letters = shaped.letters.get();
            Shaped {
                text: text.into(),
                letters: letters.into(),
                joined: shaped.joined.get().into(),
                label: None,
                spelled_out: if letters.is_empty() {
                    (shaped.clusters.get().into(), shaped.glyphs.get().into()).into()
                } else {
                    Default::default()
                },
                faces: shaped.faces.get().into(),
                base_level: shaped.base_level,
                how: 0,
            }
        },
    };
    if anywhere {
        shaped
            .letters
            .iter_mut()
            .for_each(|it| allow_break(&mut it.flags));
        shaped
            .spelled_out
            .get_mut()
            .into_iter()
            .flat_map(|it| &mut it.0)
            .for_each(|it| allow_break(&mut it.flags));
    }
    shaped.label = crate::lines::Label::new(text, &shaped.letters, &shaped.faces);
    shaped
}

/// On the clock of the renderer.
pub(crate) fn now() -> f64 {
    renderer().map_or(0.0, |it| (it.now)())
}

pub(crate) fn image_alpha(image: u32, [width, height]: [usize; 2]) -> Vec<u8> {
    // SAFETY: as in `shape`.
    renderer().map_or_else(Vec::new, |it| unsafe {
        (it.image_alpha)(image, width as u32, height as u32)
            .get()
            .to_vec()
    })
}

pub(crate) fn font_table(face: &abi::Face, tag: [u8; 4]) -> &'static [u8] {
    // SAFETY: the renderer keeps font files.
    renderer().map_or(&[], |it| unsafe {
        (it.font_table)(face.id, u32::from_be_bytes(tag)).get()
    })
}

pub(crate) fn word(table: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_be_bytes(*table.get(at..)?.first_chunk()?).into())
}

pub(crate) fn has_positioning_feature(face: &abi::Face, tag: [u8; 4]) -> bool {
    let table = font_table(face, *b"GPOS");
    let list = word(table, 6).and_then(|it| {
        Some(
            table
                .get(it + 2..)?
                .as_chunks::<6>()
                .0
                .iter()
                .take(word(table, it)?),
        )
    });
    list.into_iter().flatten().any(|it| it.starts_with(&tag))
}

pub(crate) fn glyph_extent(face: &abi::Face, glyph: u32) -> abi::GlyphExtent {
    let square = abi::GlyphExtent {
        advance: face.size,
        ink: abi::Rect::new([0.0, -face.ascent, face.size, face.ascent + face.descent]),
    };
    renderer().map_or(square, |it| (it.glyph_extent)(face.id, face.size, glyph))
}

/// From left to right.
pub(crate) fn ink_spans(
    face: &abi::Face,
    glyphs: &[Glyph],
    top: f32,
    bottom: f32,
) -> Vec<[f32; 2]> {
    let Some(renderer) = renderer() else {
        return Vec::new();
    };
    // SAFETY: as in `shape`.
    let mut spans = unsafe {
        (renderer.ink_spans)(face.id, face.size, Slice::new(glyphs), top, bottom)
            .get()
            .to_vec()
    };
    spans.order_by(|a, b| a[0].total_cmp(&b[0]));
    spans
}

fn shape_squares(text: &str, runs: &[TextRun], direction: u8) -> Shaped {
    let face = |run: &TextRun| abi::Face {
        id: 0,
        size: run.size,
        ascent: (run.size * 0.8).round(),
        descent: (run.size * 0.2).round(),
        line_gap: 0.0,
    };
    let base_level = u8::from(direction == abi::DIRECTION_RTL);
    let (mut clusters, mut index, mut previous) = (Vec::new(), 0, '\0');
    for (start, character) in text.char_indices() {
        while runs[index].end as usize <= start {
            index += 1;
        }
        let run = &runs[index];
        let is_space = matches!(character, ' ' | '\t');
        let breaks = matches!(
            previous,
            ' ' | '\t' | '-' | '\u{ad}' | '\u{200b}' | '\u{fffc}'
        ) || character == '\u{fffc}'
            || run.word_break == abi::BREAK_ALL;
        let is_ignorable = character.is_control()
            || matches!(character, '\u{ad}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}')
            || matches!(character, '\u{2066}'..='\u{2069}' | '\u{fffc}');
        let flag = |on: bool, flag| if on { flag } else { 0 };
        clusters.push(Cluster {
            start: start as u32,
            advance: match is_ignorable {
                true => 0.0,
                false if is_space => run.size.round() + run.letter_spacing + run.word_spacing,
                false => run.size.round() + run.letter_spacing,
            },
            glyphs: abi::Span::default(),
            bidi_level: base_level
                * if character.is_ascii_alphanumeric() {
                    2
                } else {
                    1
                },
            flags: flag(breaks && !is_space && start > 0, abi::CLUSTER_BREAK_BEFORE)
                | flag(is_space, abi::CLUSTER_SPACE)
                | flag(character == '\u{ad}', abi::CLUSTER_SOFT_HYPHEN),
            face: index as u16,
        });
        previous = character;
    }
    Shaped {
        text: text.into(),
        spelled_out: (clusters.into(), Box::default()).into(),
        letters: Vec::new(),
        joined: Box::default(),
        label: None,
        faces: runs.iter().map(face).collect(),
        base_level,
        how: 0,
    }
}
