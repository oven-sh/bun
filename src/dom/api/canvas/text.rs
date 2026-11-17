//! https://html.spec.whatwg.org/#text-styles

use core::cell::Cell;
use std::rc::Rc;

use bun_jsc::JsCell;

use crate::abi::{self, FontMetrics, FontSetting, Slice};
use crate::abi_graphics as wire;
use crate::calc::{Kind, Node, Options};
use crate::generated_bindgen::canvas::{
    CanvasFontKerning, CanvasFontStretch, CanvasFontVariantCaps,
};
use crate::name::{Map, Name};
use crate::platform::renderer;
use crate::properties::{Prop, Value};
use crate::types::{Families, FontCaps, FontStyle};
use crate::values::{
    Css as _, Ctx, Deps, FontUnits, Out, RootUnits, Str, parse_all, write_number, write_px,
};

/// What a context takes from its font style source object.
#[derive(Clone)]
pub(crate) struct Inherited {
    pub(crate) font_size: f32,
    pub(crate) root_font_size: f32,
    pub(crate) line_height: f32,
    pub(crate) is_right_to_left: bool,
    pub(crate) color: u32,
    pub(crate) language: Str,
    pub(crate) font_scope: u32,
}

/// With the units of a font of `size`.
pub(super) fn with_units<R>(size: f32, root_size: f32, compute: impl FnOnce(&Ctx) -> R) -> R {
    let [ex, ch, cap, ic] = [0.5, 0.5, 0.7, 1.0];
    let metrics = || FontMetrics {
        x_height: size * ex,
        zero_advance: size * ch,
        cap_height: size * cap,
        ideograph_advance: size * ic,
        ..FontMetrics::default()
    };
    compute(&Ctx {
        font: FontUnits {
            size,
            weight: 400.0,
            line_height: size * 1.2,
        },
        root: RootUnits {
            size: root_size,
            line_height: root_size * 1.2,
            metrics: [ex, ch, cap, ic].map(|it| it * root_size),
        },
        metrics: &metrics,
        ..Ctx::dummy()
    })
}

/// What else the choice of a face depends on.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct Variation {
    /// Its document has to load the font.
    pub(super) canvas: u32,
    pub(super) scope: u32,
    pub(super) language: Name,
    pub(super) kerning: CanvasFontKerning,
    pub(super) stretch: CanvasFontStretch,
    pub(super) caps: CanvasFontVariantCaps,
}

pub(crate) struct Font {
    pub(super) serialized: Out,
    pub(super) size: f32,
    pub(crate) weight: f32,
    pub(crate) style: FontStyle,
    pub(crate) families: Families,
    pub(super) stretch: CanvasFontStretch,
    pub(super) caps: CanvasFontVariantCaps,
    pub(super) is_relative: bool,
    described: Cell<Option<(Variation, u32)>>,
}

const STRETCHES: [(CanvasFontStretch, f32); 9] = [
    (CanvasFontStretch::UltraCondensed, 50.0),
    (CanvasFontStretch::ExtraCondensed, 62.5),
    (CanvasFontStretch::Condensed, 75.0),
    (CanvasFontStretch::SemiCondensed, 87.5),
    (CanvasFontStretch::Normal, 100.0),
    (CanvasFontStretch::SemiExpanded, 112.5),
    (CanvasFontStretch::Expanded, 125.0),
    (CanvasFontStretch::ExtraExpanded, 150.0),
    (CanvasFontStretch::UltraExpanded, 200.0),
];

thread_local! {
    static ABSOLUTE: JsCell<Map<Box<[u8]>, Rc<Font>>> = JsCell::default();
}

impl Font {
    pub(super) fn parse(
        source: &[u8],
        size: f32,
        line_height: f32,
        root_size: f32,
    ) -> Option<Font> {
        let (values, deps) = with_units(size, root_size, |cx| {
            let cx = Ctx {
                font: FontUnits {
                    line_height,
                    ..cx.font
                },
                deps: Cell::default(),
                ..*cx
            };
            Some((
                Prop::from_name(b"font")?.parse(source, &cx, false)?,
                cx.deps.get(),
            ))
        })?;
        let mut font = Font {
            serialized: Out::new(),
            size: 0.0,
            weight: 400.0,
            style: FontStyle::Normal,
            families: Families(Rc::default()),
            stretch: CanvasFontStretch::Normal,
            caps: CanvasFontVariantCaps::Normal,
            is_relative: deps.intersects(Deps::INHERITED | Deps::ROOT),
            described: Cell::new(None),
        };
        for value in values.iter() {
            match value.typed() {
                Value::FontSize(it) => font.size = it.0,
                Value::FontWeight(it) => font.weight = it.0,
                Value::FontStyle(it) => font.style = *it,
                Value::FontFamily(it) => font.families = it.clone(),
                Value::FontStretch(it) => {
                    font.stretch = STRETCHES.iter().find(|known| known.1 == it.0)?.0
                }
                Value::FontVariantCaps(FontCaps::SmallCaps) => {
                    font.caps = CanvasFontVariantCaps::SmallCaps
                }
                _ => {}
            }
        }
        let out = &mut font.serialized;
        if font.style != FontStyle::Normal {
            out.extend_from_slice(b"italic ");
        }
        match font.weight {
            400.0 => {}
            700.0 => out.extend_from_slice(b"bold "),
            weight => {
                write_number(weight, out);
                out.push(b' ');
            }
        }
        if font.caps != CanvasFontVariantCaps::Normal {
            out.extend_from_slice(b"small-caps ");
        }
        write_px(font.size, out);
        out.push(b' ');
        font.families.write(out);
        Some(font)
    }

    /// With the sizes that a detached canvas has for relative units.
    pub(super) fn parse_cached(source: &[u8]) -> Option<Rc<Font>> {
        const MAX_KNOWN: usize = 256;
        if let Some(known) = ABSOLUTE.with(|known| known.get().get(source).cloned()) {
            return Some(known);
        }
        let font = Rc::new(Font::parse(source, 10.0, 12.0, 16.0)?);
        ABSOLUTE.with(|known| {
            known.with_mut(|known| {
                if known.len() >= MAX_KNOWN {
                    known.clear();
                }
                known.insert(source.into(), Rc::clone(&font));
            })
        });
        Some(font)
    }

    pub(super) fn known_id(&self, variation: Variation) -> Option<u32> {
        self.described
            .get()
            .filter(|it| it.0 == variation)
            .map(|it| it.1)
    }

    pub(super) fn describe(&self, variation: Variation, language: &str) -> u32 {
        let tags: &[&[u8; 4]] = match variation.caps {
            CanvasFontVariantCaps::Normal => &[],
            CanvasFontVariantCaps::SmallCaps => &[b"smcp"],
            CanvasFontVariantCaps::AllSmallCaps => &[b"smcp", b"c2sc"],
            CanvasFontVariantCaps::PetiteCaps => &[b"pcap"],
            CanvasFontVariantCaps::AllPetiteCaps => &[b"pcap", b"c2pc"],
            CanvasFontVariantCaps::Unicase => &[b"unic"],
            CanvasFontVariantCaps::TitlingCaps => &[b"titl"],
        };
        let features: Vec<_> = tags
            .iter()
            .map(|tag| FontSetting {
                tag: **tag,
                value: 1.0,
            })
            .collect();
        let (style, oblique_angle) = match self.style {
            FontStyle::Normal => (abi::FONT_NORMAL, 0.0),
            FontStyle::Italic => (abi::FONT_ITALIC, 0.0),
            FontStyle::Oblique(angle) => (abi::FONT_OBLIQUE, angle),
        };
        let description = abi::FontDescription {
            scope: variation.scope,
            families: Slice::new(&self.families.0),
            weight: self.weight,
            stretch: STRETCHES[variation.stretch as usize].1,
            style,
            synthesis: abi::SYNTHESIZE_WEIGHT | abi::SYNTHESIZE_STYLE,
            optical_sizing: true,
            kerning: variation.kerning != CanvasFontKerning::None,
            oblique_angle,
            variations: Slice::new(&[]),
            features: Slice::new(&features),
            language: Slice::new(language.as_bytes()),
            device_scale: 1.0,
            language_override: [0; 4],
            size_adjust_metric: abi::ADJUST_NONE,
            size_adjust: 0.0,
            emoji: abi::EMOJI_NORMAL,
            palette_family: Slice::new(&[]),
            palette: 0,
            palette_overrides: Slice::new(&[]),
        };
        // SAFETY: what the slices point to outlives the call.
        let id = renderer().map_or(0, |it| unsafe {
            (it.font_describe)(&raw const description)
        });
        self.described.set(Some((variation, id)));
        id
    }
}

/// `letterSpacing` or `wordSpacing`.
#[derive(Clone, Default)]
pub(super) struct Spacing(Option<Rc<Node>>);

impl Spacing {
    pub(super) fn parse(source: &[u8]) -> Option<Spacing> {
        parse_all(source, |p| Node::parse(p, &Options::new(Kind::Length)))
            .map(|it| Spacing(Some(Rc::new(it))))
    }

    pub(super) fn serialize(&self) -> Out {
        let Some(length) = &self.0 else {
            return b"0px".into();
        };
        let mut out = Out::new();
        length.write_specified(&mut out);
        out
    }

    pub(super) fn resolve(&self, size: f32, root_size: f32) -> f32 {
        self.0.as_ref().map_or(0.0, |it| {
            with_units(size, root_size, |cx| it.compute(cx, 1.0) as f32)
        })
    }
}

pub(crate) struct TextMetrics(pub(super) wire::TextMetrics);

macro_rules! metrics {
    ($($getter:ident => $field:ident),+) => {
        impl TextMetrics {
            $(pub(crate) fn $getter(&self) -> f64 {
                self.0.$field.into()
            })+
        }
    };
}

metrics! {
    get_width => width,
    get_actual_bounding_box_left => ink_left,
    get_actual_bounding_box_right => ink_right,
    get_font_bounding_box_ascent => font_ascent,
    get_font_bounding_box_descent => font_descent,
    get_actual_bounding_box_ascent => ink_ascent,
    get_actual_bounding_box_descent => ink_descent,
    get_em_height_ascent => em_ascent,
    get_em_height_descent => em_descent,
    get_hanging_baseline => hanging,
    get_alphabetic_baseline => alphabetic,
    get_ideographic_baseline => ideographic
}
