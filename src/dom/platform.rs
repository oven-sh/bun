//! Fonts, from the UI library. Without it, every character is a square of 1em.

use core::cell::RefCell;
use core::ffi::c_void;

use crate::abi::{self, Cluster, FontMetrics, FontSetting, Glyph, Slice, TextRun};
use crate::name::{Map, Name, Set};
use crate::properties::{Groups, Id};
use crate::types::{AutoOrNone, FontCaps, FontKerning, FontStyle, Ligatures, Numeric};

unsafe extern "C" {
    safe fn Bun__Desktop__renderer() -> *const c_void;
}

pub(crate) fn renderer() -> Option<&'static abi::Renderer> {
    // SAFETY: null, or a static of the library, which is never unloaded.
    unsafe { Bun__Desktop__renderer().cast::<abi::Renderer>().as_ref() }
}

#[derive(Default)]
pub(crate) struct Shaped {
    pub(crate) clusters: Vec<Cluster>,
    pub(crate) glyphs: Vec<Glyph>,
    pub(crate) faces: Vec<abi::Face>,
    pub(crate) base_level: u8,
}

pub(crate) struct Fonts {
    pub(crate) device_scale: f32,
    pub(crate) scope: u32,
    metrics: RefCell<Map<(u32, u32), FontMetrics>>,
    /// Family in lowercase, weight, and whether it is slanted.
    pub(crate) used: RefCell<Set<(Name, u16, bool)>>,
    pub(crate) newly_used: RefCell<Vec<(Name, u16, bool)>>,
}

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
    pub(crate) fn new(scope: u32) -> Fonts {
        Fonts {
            scope,
            device_scale: 1.0,
            metrics: RefCell::default(),
            used: RefCell::default(),
            newly_used: RefCell::default(),
        }
    }

    pub(crate) fn forget_metrics(&self) {
        self.metrics.borrow_mut().clear();
    }

    pub(crate) fn describe(&self, groups: &Groups, defined: &Defined) -> u32 {
        let font = &groups.font;
        for family in font.family.names() {
            let used = (
                Name::lowercase(family),
                font.weight.0 as u16,
                font.style != FontStyle::Normal,
            );
            if self.used.borrow_mut().insert(used) {
                self.newly_used.borrow_mut().push(used);
            }
        }
        let Some(renderer) = renderer() else { return 0 };
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
        let description = abi::FontDescription {
            scope: self.scope,
            families: Slice::new(&font.family.0),
            weight: font.weight.0,
            stretch: font.stretch.0,
            style,
            synthesis: allowed(font.synthesis_weight, abi::SYNTHESIZE_WEIGHT)
                | allowed(font.synthesis_style, abi::SYNTHESIZE_STYLE)
                | if groups.other(Id::FontSynthesisSmallCaps) == "auto" {
                    abi::SYNTHESIZE_SMALL_CAPS
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

pub(crate) fn shape(text: &str, runs: &[TextRun], direction: u8) -> Shaped {
    let Some(renderer) = renderer() else {
        return shape_squares(text, runs, direction);
    };
    // SAFETY: the arguments outlive the call, and the result is copied before the next one.
    unsafe {
        let shaped = (renderer.shape)(Slice::new(text.as_bytes()), Slice::new(runs), direction);
        Shaped {
            clusters: shaped.clusters.get().to_vec(),
            glyphs: shaped.glyphs.get().to_vec(),
            faces: shaped.faces.get().to_vec(),
            base_level: shaped.base_level,
        }
    }
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

pub(crate) fn font_table(face: &abi::Face, tag: &[u8; 4]) -> &'static [u8] {
    // SAFETY: the renderer keeps font files.
    renderer().map_or(&[], |it| unsafe {
        (it.font_table)(face.id, u32::from_be_bytes(*tag)).get()
    })
}

pub(crate) fn word(table: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_be_bytes(*table.get(at..)?.first_chunk()?).into())
}

pub(crate) fn has_positioning_feature(face: &abi::Face, tag: &[u8; 4]) -> bool {
    let table = font_table(face, b"GPOS");
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
    list.into_iter().flatten().any(|it| it.starts_with(tag))
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
    spans.sort_by(|a, b| a[0].total_cmp(&b[0]));
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
        clusters,
        glyphs: Vec::new(),
        faces: runs.iter().map(face).collect(),
        base_level,
    }
}
