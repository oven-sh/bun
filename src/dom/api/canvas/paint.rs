//! https://html.spec.whatwg.org/#fill-and-stroke-styles

use core::cell::Cell;
use std::io::Write as _;
use std::rc::Rc;

use bun_jsc::{DOMExceptionCode, JsCell};

use super::bitmap::Owned;
use super::recorder::{List, add};
use super::{Affine, Failure, are_finite};
use crate::abi::GradientStop;
use crate::abi_graphics as wire;
use crate::color::{Exact, Specified};
use crate::generated_bindgen::geometry::DOMMatrix2DInit;
use crate::name::Map;
use crate::values::{Ctx, Out, parse_all};

#[derive(Clone, Copy, PartialEq)]
pub(super) struct Color {
    pub(super) rgba: u32,
    /// Unless `rgba` says it all.
    exact: Option<Exact>,
}

/// `#rgb` and the like, and `rgb()` with commas and plain numbers.
fn parse_simple(source: &[u8]) -> Option<u32> {
    if let [b'#', digits @ ..] = source {
        let digit = |all: u32, it: &u8| Some(all << 4 | char::from(*it).to_digit(16)?);
        let doubled = |all: u32, it: &u8| Some(all << 8 | (char::from(*it).to_digit(16)? * 17));
        return match digits.len() {
            3 => Some(digits.iter().try_fold(0, doubled)? << 8 | 0xff),
            4 => digits.iter().try_fold(0, doubled),
            6 => Some(digits.iter().try_fold(0, digit)? << 8 | 0xff),
            8 => digits.iter().try_fold(0, digit),
            _ => None,
        };
    }
    let rest = source.strip_prefix(b"rgb")?.strip_suffix(b")")?;
    let mut rest = rest.strip_prefix(b"a").unwrap_or(rest).strip_prefix(b"(")?;
    let mut rgb = 0;
    for channel in 0..3 {
        rest = rest.strip_prefix(b" ").unwrap_or(rest);
        let count = rest
            .iter()
            .take(4)
            .take_while(|it| it.is_ascii_digit())
            .count();
        let value = rest[..count]
            .iter()
            .fold(0, |all, it| all * 10 + u32::from(it - b'0'));
        (1..4).contains(&count).then_some(())?;
        rgb = rgb << 8 | value.min(255);
        match &rest[count..] {
            [] if channel == 2 => return Some(rgb << 8 | 0xff),
            [b',', after @ ..] => rest = after,
            _ => return None,
        }
    }
    let alpha = match rest.strip_prefix(b" ").unwrap_or(rest) {
        b"0" => 0.0,
        b"1" => 1.0,
        number @ ([b'0', b'.', digits @ ..] | [b'.', digits @ ..])
            if !digits.is_empty() && digits.iter().all(u8::is_ascii_digit) =>
        {
            crate::values::text(number).parse::<f32>().ok()?
        }
        _ => return None,
    };
    Some(rgb << 8 | (alpha * 255.0).round() as u32)
}

pub(super) enum Parsed {
    Color(Color),
    OfCurrent(Specified),
}

thread_local! {
    static KNOWN: Box<JsCell<Map<Box<[u8]>, Color>>> = Box::default();
}

impl Color {
    pub(super) const BLACK: Color = Color::plain(0xff);
    pub(super) const TRANSPARENT: Color = Color::plain(0);

    pub(super) const fn plain(rgba: u32) -> Color {
        Color { rgba, exact: None }
    }

    #[optimize(size)]
    fn new(exact: Exact) -> Color {
        Color {
            rgba: exact.rgba(),
            exact: (!exact.is_legacy).then_some(exact),
        }
    }

    #[inline]
    pub(super) fn parse(source: &[u8]) -> Option<Parsed> {
        match parse_simple(source) {
            Some(rgba) => Some(Parsed::Color(Color::plain(rgba))),
            None => Color::parse_any(source),
        }
    }

    fn parse_any(source: &[u8]) -> Option<Parsed> {
        const MAX_KNOWN: usize = 1024;
        if let Some(known) = KNOWN.with(|known| known.get().get(source).copied()) {
            return Some(Parsed::Color(known));
        }
        let specified = parse_all(source, Specified::parse)?;
        let Some(color) = specified.resolve(&Ctx::dummy(), None).map(Color::new) else {
            return Some(Parsed::OfCurrent(specified));
        };
        KNOWN.with(|known| {
            known.with_mut(|known| {
                if known.len() >= MAX_KNOWN {
                    known.clear();
                }
                if source.len() < 64 {
                    known.insert(source.into(), color);
                }
            })
        });
        Some(Parsed::Color(color))
    }

    pub(super) fn resolve(specified: &Specified, current: u32) -> Color {
        specified
            .resolve(&Ctx::dummy(), Some(&Exact::legacy(current)))
            .map_or(Color::BLACK, Color::new)
    }

    /// https://drafts.csswg.org/css-color/#HTML-compatible-serialization-of-srgb
    pub(super) fn serialize(&self) -> Out {
        let mut out = Out::new();
        match self.exact {
            Some(exact) => exact.write(&mut out),
            None if self.rgba & 0xff == 0xff => _ = write!(out, "#{:06x}", self.rgba >> 8),
            None => crate::color::write_rgba(self.rgba, &mut out),
        }
        out
    }
}

pub(super) enum Shape {
    Linear([f32; 2], [f32; 2]),
    Radial([f32; 3], [f32; 3]),
    Conic([f32; 2], f32),
}

enum Kind {
    Gradient(Shape, JsCell<Vec<GradientStop>>),
    Pattern {
        tile: Owned,
        repeats: [bool; 2],
        matrix: Cell<Affine>,
    },
}

/// What a gradient or a pattern shares with the drawing states that use it.
pub(super) struct Paint {
    kind: Kind,
    pub(super) version: Cell<u32>,
    pub(super) is_origin_clean: bool,
}

impl Paint {
    pub(super) fn record(&self, list: &mut List) -> wire::Paint {
        match &self.kind {
            Kind::Gradient(shape, stops) => {
                let stops = add(&mut list.stops, stops.get().iter().copied());
                match *shape {
                    Shape::Linear(from, to) => wire::Paint::Linear { from, to, stops },
                    Shape::Radial(from, to) => wire::Paint::Radial { from, to, stops },
                    Shape::Conic(center, start) => wire::Paint::Conic {
                        center,
                        start,
                        stops,
                    },
                }
            }
            Kind::Pattern {
                tile,
                repeats,
                matrix,
            } => wire::Paint::Pattern {
                tile: tile.id(),
                repeats: *repeats,
                matrix: matrix.get().narrow(),
            },
        }
    }

    fn did_change(&self) {
        self.version.set(self.version.get().wrapping_add(1));
    }
}

pub(crate) struct CanvasGradient(pub(super) Rc<Paint>);

impl CanvasGradient {
    #[optimize(size)]
    pub(super) fn new(shape: Shape) -> CanvasGradient {
        let kind = Kind::Gradient(shape, JsCell::default());
        CanvasGradient(Rc::new(Paint {
            kind,
            version: Cell::new(0),
            is_origin_clean: true,
        }))
    }

    pub(crate) fn add_color_stop(&self, offset: f64, color: &[u8]) -> Result<(), Failure> {
        if !(0.0..=1.0).contains(&offset) {
            return Err(Failure::index_size(
                "The offset is outside the range (0.0, 1.0).",
            ));
        }
        let color = match Color::parse(color) {
            Some(Parsed::Color(color)) => color.rgba,
            Some(Parsed::OfCurrent(color)) => Color::resolve(&color, 0xff).rgba,
            None => {
                return Err(Failure::Dom(
                    DOMExceptionCode::SyntaxError,
                    "The value could not be parsed as a color.",
                ));
            }
        };
        let (Kind::Gradient(_, stops), offset) = (&self.0.kind, offset as f32) else {
            return Ok(());
        };
        stops.with_mut(|stops| {
            stops.insert(
                stops.partition_point(|it| it.offset <= offset),
                GradientStop { offset, color },
            )
        });
        self.0.did_change();
        Ok(())
    }
}

pub(crate) struct CanvasPattern(pub(super) Rc<Paint>, usize);

impl CanvasPattern {
    #[optimize(size)]
    pub(super) fn new(
        tile: Owned,
        bytes: usize,
        repeats: [bool; 2],
        is_origin_clean: bool,
    ) -> CanvasPattern {
        let kind = Kind::Pattern {
            tile,
            repeats,
            matrix: Cell::default(),
        };
        CanvasPattern(
            Rc::new(Paint {
                kind,
                version: Cell::new(0),
                is_origin_clean,
            }),
            bytes,
        )
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.1
    }

    pub(crate) fn set_transform(&self, transform: &DOMMatrix2DInit) -> Result<(), Failure> {
        let to = Affine::from_init(transform)?;
        if let Kind::Pattern { matrix, .. } = &self.0.kind
            && are_finite(to.0)
        {
            matrix.set(to);
            self.0.did_change();
        }
        Ok(())
    }
}
