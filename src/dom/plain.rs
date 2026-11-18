//! The values that scripts keep writing, which take no tokenizer.

use smallvec::SmallVec;

use crate::calc::{Node, Unit};
use crate::color::{Color, Rgba};
use crate::properties::{Id, Value};
use crate::transform::{Name, Transform, Transforms, Z_AXIS};
use crate::types::Inset;
use crate::values::{Alpha, Auto, Lp, MAX_DEGREES, MaxSize, NoneOrSpaces, PositiveLp, Size};

struct Plain<'a> {
    rest: &'a [u8],
    zoom: f64,
}

impl Plain<'_> {
    fn take(&mut self, start: &[u8]) -> bool {
        self.rest
            .strip_prefix(start)
            .map(|it| self.rest = it)
            .is_some()
    }

    fn comma(&mut self) -> bool {
        self.take(b", ") || self.take(b",")
    }

    fn number(&mut self) -> Option<f64> {
        const POWERS: [f64; 23] = [
            1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15,
            1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
        ];
        let start = usize::from(self.rest.first() == Some(&b'-'));
        let (mut digits, mut end, mut point) = (0u64, start, None);
        while let Some(&byte) = self.rest.get(end) {
            match byte {
                b'0'..=b'9' => {
                    digits = digits
                        .saturating_mul(10)
                        .saturating_add(u64::from(byte - b'0'))
                }
                b'.' if point.is_none() => point = Some(end),
                _ => break,
            }
            end += 1;
        }
        (end > start && self.rest[end - 1] != b'.').then_some(())?;
        let mut power = POWERS
            .get(point.map_or(0, |it| end - it - 1))
            .filter(|_| digits < 1 << f64::MANTISSA_DIGITS);
        if let [b'e', b'-', b'0'..=b'9', rest @ ..] = &self.rest[end..] {
            (end, power) = (
                end + 3 + rest.iter().take_while(|it| it.is_ascii_digit()).count(),
                None,
            );
        }
        let number;
        (number, self.rest) = self.rest.split_at(end);
        let Some(power) = power else {
            return crate::values::text(number)
                .parse()
                .ok()
                .filter(|it: &f64| it.abs() < 1e22);
        };
        Some(if start == 1 {
            -(digits as f64 / power)
        } else {
            digits as f64 / power
        })
    }

    fn degrees(&mut self) -> Option<f32> {
        let number = self.number()?;
        let per_unit = match () {
            () if self.take(b"deg") => 1.0,
            () if self.take(b"rad") => 180.0 / core::f64::consts::PI,
            () if self.take(b"turn") => 360.0,
            () => return None,
        };
        Some(((number * per_unit) as f32).clamp(-MAX_DEGREES, MAX_DEGREES))
    }

    fn color(&mut self) -> Option<Color> {
        if self.take(b"#") {
            return Color::from_digits(core::mem::take(&mut self.rest));
        }
        let is_rgb = self.take(b"rgb(") || self.take(b"rgba(");
        (is_rgb || self.take(b"hsl(") || self.take(b"hsla(")).then_some(())?;
        let first = self.number()?;
        let mut next = || {
            self.comma()
                .then(|| self.number())?
                .filter(|_| is_rgb || self.take(b"%"))
        };
        let channels = [first, next()?, next()?];
        let alpha = if self.comma() { self.number()? } else { 1.0 };
        self.take(b")")
            .then(|| Color::from_channels(is_rgb, channels, alpha))
    }

    fn length(&mut self) -> Option<Lp> {
        let number = self.number()?;
        Some(Lp::new(match () {
            () if self.take(b"px") => Node::Value(number * self.zoom, Unit::Px),
            () if self.take(b"%") => Node::Value(number, Unit::Percent),
            () => (number == 0.0).then_some(Node::Value(0.0, Unit::Px))?,
        }))
    }

    fn positive(&mut self) -> Option<Lp> {
        (!self.rest.starts_with(b"-")).then(|| self.length())?
    }

    fn px(&mut self) -> Option<f32> {
        if let Lp::Px(px) = self.length()? {
            Some(px)
        } else {
            None
        }
    }

    fn transform(&mut self) -> Option<Transform> {
        let transform = match () {
            () if self.take(b"translate(") => Transform::Translate(
                Name::Translate,
                self.length()?,
                if self.comma() {
                    self.length()?
                } else {
                    Lp::ZERO
                },
                0.0,
            ),
            () if self.take(b"translateX(") => {
                Transform::Translate(Name::TranslateX, self.length()?, Lp::ZERO, 0.0)
            }
            () if self.take(b"translateY(") => {
                Transform::Translate(Name::TranslateY, Lp::ZERO, self.length()?, 0.0)
            }
            () if self.take(b"translateZ(") => {
                Transform::Translate(Name::TranslateZ, Lp::ZERO, Lp::ZERO, self.px()?)
            }
            () if self.take(b"translate3d(") => Transform::Translate(
                Name::Translate3d,
                self.length()?,
                self.comma().then(|| self.length())??,
                self.comma().then(|| self.px())??,
            ),
            () if self.take(b"scale(") => {
                let x = self.number()? as f32;
                Transform::Scale(
                    Name::Scale,
                    [
                        x,
                        if self.comma() {
                            self.number()? as f32
                        } else {
                            x
                        },
                        1.0,
                    ],
                )
            }
            () if self.take(b"scaleX(") => {
                Transform::Scale(Name::ScaleX, [self.number()? as f32, 1.0, 1.0])
            }
            () if self.take(b"scaleY(") => {
                Transform::Scale(Name::ScaleY, [1.0, self.number()? as f32, 1.0])
            }
            () if self.take(b"rotate(") => Transform::Rotate(Name::Rotate, Z_AXIS, self.degrees()?),
            () if self.take(b"rotateZ(") => {
                Transform::Rotate(Name::RotateZ, Z_AXIS, self.degrees()?)
            }
            () => return None,
        };
        self.take(b")").then_some(transform)
    }

    fn transforms(&mut self) -> Option<SmallVec<[Transform; 2]>> {
        let mut all = SmallVec::new();
        loop {
            all.push(self.transform()?);
            if !self.take(b" ") && self.rest.is_empty() {
                return Some(all);
            }
        }
    }
}

/// In which a number is a length.
pub(crate) fn svg_length(source: &[u8], zoom: f32) -> Option<Lp> {
    let p = &mut Plain {
        rest: source,
        zoom: zoom.into(),
    };
    let number = p.number()?;
    match p.rest {
        b"" => Some(Lp::limited(number as f32 * zoom)),
        b"%" => Some(Lp::new(Node::Value(number, Unit::Percent))),
        _ => None,
    }
}

pub(crate) fn number(source: &[u8]) -> Option<f64> {
    let p = &mut Plain {
        rest: source,
        zoom: 1.0,
    };
    p.number().filter(|_| p.rest.is_empty())
}

impl Id {
    pub(crate) fn is_plain(self, source: &[u8]) -> bool {
        let p = &mut Plain {
            rest: source,
            zoom: 1.0,
        };
        if self == Id::Transform {
            p.transforms().is_some() && p.rest.is_empty()
        } else {
            self.parse_plain(source, 1.0).is_some()
        }
    }

    /// The computed value. `None` does not mean that it is invalid.
    pub(crate) fn parse_plain(self, source: &[u8], zoom: f32) -> Option<Value> {
        let p = &mut Plain {
            rest: source,
            zoom: zoom.into(),
        };
        let value = match self {
            Id::Width => Value::Width(Size::Length(p.positive()?)),
            Id::Height => Value::Height(Size::Length(p.positive()?)),
            Id::MinWidth => Value::MinWidth(Size::Length(p.positive()?)),
            Id::MinHeight => Value::MinHeight(Size::Length(p.positive()?)),
            Id::MaxWidth => Value::MaxWidth(MaxSize(Size::Length(p.positive()?))),
            Id::MaxHeight => Value::MaxHeight(MaxSize(Size::Length(p.positive()?))),
            Id::MarginTop => Value::MarginTop(Auto(Some(p.length()?))),
            Id::MarginRight => Value::MarginRight(Auto(Some(p.length()?))),
            Id::MarginBottom => Value::MarginBottom(Auto(Some(p.length()?))),
            Id::MarginLeft => Value::MarginLeft(Auto(Some(p.length()?))),
            Id::PaddingTop => Value::PaddingTop(PositiveLp(p.positive()?)),
            Id::PaddingRight => Value::PaddingRight(PositiveLp(p.positive()?)),
            Id::PaddingBottom => Value::PaddingBottom(PositiveLp(p.positive()?)),
            Id::PaddingLeft => Value::PaddingLeft(PositiveLp(p.positive()?)),
            Id::Top => Value::Top(Inset::Length(p.length()?)),
            Id::Right => Value::Right(Inset::Length(p.length()?)),
            Id::Bottom => Value::Bottom(Inset::Length(p.length()?)),
            Id::Left => Value::Left(Inset::Length(p.length()?)),
            Id::Opacity => Value::Opacity(Alpha::new(p.number()? as f32)),
            Id::BackgroundColor => Value::BackgroundColor(p.color()?),
            Id::Color => Value::Color(Rgba::plain(p.color()?.resolve(0))),
            Id::Transform => Value::Transform(Transforms(NoneOrSpaces(
                p.transforms()?.into_iter().collect(),
            ))),
            _ => return None,
        };
        p.rest.is_empty().then_some(value)
    }
}
