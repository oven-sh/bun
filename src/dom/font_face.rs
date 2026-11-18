//! <https://drafts.csswg.org/css-fonts/#font-face-rule>

use std::rc::Rc;

use bun_ui::protocol;

use crate::document::Document;
use crate::grammar::{Mode, definition, split_list};
use crate::hooks::{family_name, unicode_range, words};
use crate::types::{FontSettings, FontStretch};
use crate::values::{
    Css, Ctx, Out, Str, function, keywords, nested, parse_all, text, url, with_parser,
};

keywords! {
    Descriptor { Family = "font-family", Style = "font-style", Weight = "font-weight", Stretch = "font-stretch", UnicodeRange = "unicode-range",
        Variant = "font-variant", FeatureSettings = "font-feature-settings", VariationSettings = "font-variation-settings",
        Display = "font-display", AscentOverride = "ascent-override", DescentOverride = "descent-override",
        LineGapOverride = "line-gap-override", SizeAdjust = "size-adjust" }
}

impl Descriptor {
    const COUNT: usize = Descriptor::SizeAdjust as usize + 1;

    fn initial(self) -> &'static str {
        match self {
            Descriptor::Family => "",
            Descriptor::UnicodeRange => "U+0-10FFFF",
            Descriptor::Display => "auto",
            Descriptor::SizeAdjust => "100%",
            _ => "normal",
        }
    }

    pub(crate) fn parse(self, source: &[u8]) -> Option<Out> {
        crate::sheet::descriptor(
            "font-face",
            self.name().as_bytes(),
            crate::scan::trim(source),
        )
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Source {
    Url(Str),
    Local(Str),
}

impl Source {
    /// Those in a format that is supported, from the serialization of `src`.
    pub(crate) fn parse_list(src: &[u8], base_url: &[u8]) -> Rc<[Source]> {
        let cx = Ctx {
            base_url,
            ..Ctx::dummy()
        };
        let is_supported = |format: &[u8]| {
            let format = format
                .trim_ascii()
                .strip_prefix(b"\"")
                .and_then(|it| it.strip_suffix(b"\""))
                .unwrap_or(format)
                .to_ascii_lowercase();
            definition("<font-format>").is_some_and(|it| {
                it.accepts(format.strip_suffix(b"-variations").unwrap_or(&format))
            })
        };
        let parse = |source: &[u8]| {
            let format = words(source)
                .into_iter()
                .find_map(|it| it.strip_prefix(b"format(")?.strip_suffix(b")"));
            format.is_none_or(is_supported).then_some(())?;
            with_parser(source, |p| {
                url(p, &cx).map(Source::Url).or_else(|| {
                    Some(Source::Local(
                        text(&function(p).and_then(|_| nested(p, family_name))?).into(),
                    ))
                })
            })
        };
        split_list(src).into_iter().filter_map(parse).collect()
    }
}

/// What a source has turned out to be.
#[derive(Clone)]
pub(crate) enum Data {
    Bytes(Rc<[u8]>),
    Local(Str),
}

pub(crate) struct Coverage(Vec<[u32; 2]>);

impl Coverage {
    pub(crate) fn has(&self, character: char) -> bool {
        self.0.is_empty()
            || self
                .0
                .iter()
                .any(|[first, last]| (*first..=*last).contains(&character.into()))
    }

    pub(crate) fn has_more_than_ascii(&self) -> bool {
        self.0.iter().any(|it| it[1] > 127)
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct FontFace {
    pub(crate) family: Str,
    pub(crate) sources: Rc<[Source]>,
    /// As they are serialized, if they are given.
    given: [Option<Str>; Descriptor::COUNT],
    /// Of the stretch, the slope and the weight. `None` is up to the font.
    ranges: [Option<[f32; 2]>; 3],
}

impl FontFace {
    pub(crate) const ITALIC: f32 = 14.0;
    const NORMAL: [f32; 3] = [100.0, 0.0, 400.0];

    pub(crate) fn of_rule(sources: Rc<[Source]>) -> FontFace {
        FontFace {
            family: "".into(),
            sources,
            given: Default::default(),
            ranges: [None; 3],
        }
    }

    pub(crate) fn of_script(sources: Rc<[Source]>) -> FontFace {
        FontFace {
            ranges: Self::NORMAL.map(|it| Some([it; 2])),
            ..FontFace::of_rule(sources)
        }
    }

    pub(crate) fn get(&self, descriptor: Descriptor) -> &str {
        self.given[descriptor as usize]
            .as_deref()
            .unwrap_or_else(|| descriptor.initial())
    }

    fn computed(&self, descriptor: Descriptor) -> Out {
        let compute = |it: &Str| {
            definition(&format!("@font-face/{}", descriptor.name()))?
                .write(it.as_bytes(), Mode::Computed(&Ctx::dummy()))
        };
        self.given[descriptor as usize]
            .as_ref()
            .and_then(compute)
            .unwrap_or_else(|| descriptor.initial().into())
    }

    /// `value` is serialized.
    pub(crate) fn set(&mut self, descriptor: Descriptor, value: &[u8]) {
        self.given[descriptor as usize] = Some(text(value).into());
        let index = match descriptor {
            Descriptor::Family => {
                return self.family =
                    text(&parse_all(value, family_name).unwrap_or_default()).into();
            }
            Descriptor::Stretch => 0,
            Descriptor::Style => 1,
            Descriptor::Weight => 2,
            _ => return,
        };
        let computed = self.computed(descriptor);
        let number = |it: &[u8]| match (descriptor, it) {
            (Descriptor::Stretch, _) => {
                parse_all(it, |p| FontStretch::parse(p, &Ctx::dummy())).map(|it| it.0)
            }
            (_, b"bold") => Some(700.0),
            _ => text(it.strip_suffix(b"deg").unwrap_or(it)).parse().ok(),
        };
        let mut numbers = words(&computed).into_iter().filter_map(number);
        self.ranges[index] = match (numbers.next(), numbers.next()) {
            (Some(a), b) => Some([a.min(b.unwrap_or(a)), a.max(b.unwrap_or(a))]),
            _ if matches!(&*computed, b"italic" | b"oblique") => Some([Self::ITALIC; 2]),
            _ => (computed != b"auto").then_some([Self::NORMAL[index]; 2]),
        };
    }

    /// <https://drafts.csswg.org/css-fonts-4/#font-style-matching>
    pub(crate) fn distance(&self, [stretch, slope, weight]: [f32; 3]) -> [u32; 3] {
        let directed = |wanted: f32, [low, high]: [f32; 2], prefers_lower: bool| {
            let (above, below) = ((low - wanted).max(0.0), (wanted - high).max(0.0));
            above
                + below
                + if (if prefers_lower { above } else { below }) > 0.0 {
                    1e4
                } else {
                    0.0
                }
        };
        let [stretches, slopes, weights] =
            [0, 1, 2].map(|it| self.ranges[it].unwrap_or([Self::NORMAL[it]; 2]));
        let is_last = (400.0..=500.0).contains(&weight) && weights[0] > 500.0;
        let other_way = if slope < 0.0 { slopes[0] } else { -slopes[1] };
        let slope = if other_way > 0.0 {
            other_way + 2e4
        } else {
            directed(
                slope,
                slopes,
                if slope < 0.0 {
                    slope <= -Self::ITALIC
                } else {
                    slope < Self::ITALIC
                },
            )
        };
        [
            directed(stretch, stretches, stretch <= 100.0),
            slope,
            directed(weight, weights, weight < 400.0) + f32::from(is_last) * 2e4,
        ]
        .map(|it| (it * 4.0) as u32)
    }

    /// Empty for everything.
    fn unicode_range(&self) -> Vec<[u32; 2]> {
        let all: Vec<_> = split_list(self.get(Descriptor::UnicodeRange).as_bytes())
            .into_iter()
            .filter_map(unicode_range)
            .collect();
        if all == [[0, char::MAX.into()]] {
            Vec::new()
        } else {
            all
        }
    }

    pub(crate) fn coverage(&self) -> Coverage {
        Coverage(self.unicode_range())
    }

    pub(crate) fn covers_any(&self, characters: &str) -> bool {
        let coverage = self.coverage();
        characters.is_empty() || characters.chars().any(|it| coverage.has(it))
    }

    /// Among faces that match as well, the one with the highest `order` wins. Fails if it is not a font.
    pub(crate) fn register(
        &self,
        data: &Data,
        scope: u32,
        order: u32,
    ) -> Result<u32, protocol::Text> {
        let Some(ui) = ui() else { return Ok(0) };
        let fraction = |it| {
            self.computed(it)
                .strip_suffix(b"%")
                .and_then(|it| text(it).parse::<f32>().ok())
                .map(|it| it / 100.0)
                .into()
        };
        let settings = |it| {
            let all = parse_all(&self.computed(it), |p| {
                FontSettings::parse(p, &Ctx::dummy())
            });
            all.iter()
                .flat_map(|it| it.iter())
                .map(|it| bun_ui::FontSetting {
                    tag: it.tag,
                    value: it.value,
                })
                .collect()
        };
        let [stretch, slope, weight] = self.ranges;
        let face = protocol::FontFace {
            scope,
            family: (*self.family).into(),
            weight: weight.into(),
            stretch: stretch.into(),
            style: match slope {
                None => protocol::FontFaceStyle::Auto,
                Some([0.0, 0.0]) => protocol::FontFaceStyle::Normal,
                Some(_) => protocol::FontFaceStyle::Slanted,
            },
            slope: slope.into(),
            order,
            unicode_range: Some(self.unicode_range())
                .filter(|it| !it.is_empty())
                .map(Into::into)
                .into(),
            size_adjust: fraction(Descriptor::SizeAdjust),
            ascent_override: fraction(Descriptor::AscentOverride),
            descent_override: fraction(Descriptor::DescentOverride),
            line_gap_override: fraction(Descriptor::LineGapOverride),
            features: settings(Descriptor::FeatureSettings),
            variations: settings(Descriptor::VariationSettings),
        };
        let source = match data {
            Data::Bytes(bytes) => protocol::FontSource::Bytes((**bytes).into()),
            Data::Local(name) => protocol::FontSource::Local((**name).into()),
        };
        (ui.register_font)(face, source).get()
    }
}

pub(crate) fn ui() -> Option<&'static protocol::Ui> {
    crate::platform::renderer().and_then(|_| bun_ui::loaded())
}

pub(crate) fn unregister(id: u32) {
    ui().into_iter().for_each(|it| (it.unregister_font)(id));
}

/// Whether that changes which face is used.
pub(crate) fn reorder(id: u32, order: u32) -> bool {
    ui().is_some_and(|it| matches!((it.order_font)(id, order).get(), Ok(true)))
}

/// For what has no `FontFaceSet`.
impl Document {
    pub(crate) fn take_font_urls(&mut self, may_be_local: bool) -> Vec<Str> {
        let mut urls = Vec::new();
        for face in self.take_font_requests() {
            let is_it = |it: &&Source| match it {
                Source::Url(_) => true,
                Source::Local(name) => {
                    may_be_local
                        && face
                            .register(&Data::Local(Rc::clone(name)), self.fonts.scope, 0)
                            .is_ok()
                }
            };
            match face.sources.iter().find(is_it) {
                Some(Source::Url(url)) => urls.push(Rc::clone(url)),
                Some(Source::Local(_)) => self.fonts_changed(),
                None => {}
            }
        }
        urls
    }

    pub(crate) fn set_font(&mut self, url: &str, bytes: &[u8]) {
        let (source, data) = (Source::Url(url.into()), Data::Bytes(bytes.into()));
        self.font_faces()
            .iter()
            .filter(|it| it.sources.contains(&source))
            .for_each(|it| _ = it.register(&data, self.fonts.scope, 0));
        self.fonts_changed();
    }
}
