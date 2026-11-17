//! How the text of an attribute becomes data, and back.

use std::io::Write as _;

use bun_core::strings;

use crate::api::core::{DomString, Known};
use crate::api::graphics::Affine;
use crate::calc::{Kind, Unit};
use crate::path::Numbers;
use crate::sheet::supports_declaration;
use crate::values::{Out, Str, text, write_list, write_number};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Axis {
    X,
    Y,
    Other,
}

#[derive(Clone)]
pub(super) struct Length {
    pub(super) value: f32,
    pub(super) unit: Unit,
    /// In place of the value and the unit.
    pub(super) calculation: Option<Str>,
    pub(super) axis: Axis,
}

#[derive(Clone, Copy)]
pub(super) struct Angle {
    pub(super) value: f32,
    pub(super) unit: Unit,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub(super) enum Function {
    Matrix = 1,
    Translate,
    Scale,
    Rotate,
    SkewX,
    SkewY,
}

#[derive(Clone, Copy)]
pub(super) struct Transform {
    pub(super) function: Function,
    pub(super) angle: f32,
    center: [f32; 2],
    pub(super) matrix: Affine,
}

#[derive(Clone)]
pub(super) enum Data {
    /// As many as the syntax has. Keywords are their constants.
    Numbers([f64; 6]),
    Length(Length),
    Angle(Angle),
    Transform(Transform),
    Text(DomString),
}

/// With the initial value.
#[derive(Clone, Copy)]
pub(crate) enum Syntax {
    Length(Axis, f32, Unit),
    Number(f32),
    NumberOrPercentage,
    NumberPair(f32),
    Integer(i32),
    Order,
    /// From the constant 1 on.
    Keyword(&'static [&'static str], u16),
    Text,
    Boolean,
    OrientAngle,
    OrientType,
    ViewBox,
    Ratio,
    Numbers,
    Lengths(Axis),
    Transforms,
    Points,
    Tokens,
    Languages,
}

pub(super) const ALIGNMENTS: [&str; 10] = [
    "none", "xMinYMin", "xMidYMin", "xMaxYMin", "xMinYMid", "xMidYMid", "xMaxYMid", "xMinYMax",
    "xMidYMax", "xMaxYMax",
];
const FITS: [&str; 2] = ["meet", "slice"];
const ORIENTATIONS: [&str; 3] = ["auto", "0", "auto-start-reverse"];
const ORIENT_ANGLE: f64 = 2.0;

pub(crate) struct Reflected {
    pub(super) attribute: Known,
    pub(super) syntax: Syntax,
    /// Which one of a pair.
    pub(super) index: usize,
    /// For a list that is not a member of an `SVGAnimated*`.
    pub(super) is_animated: bool,
}

impl Reflected {
    pub(crate) const fn new(attribute: Known, syntax: Syntax) -> Reflected {
        Reflected {
            attribute,
            syntax,
            index: 0,
            is_animated: false,
        }
    }

    pub(crate) const fn second(attribute: Known, syntax: Syntax) -> Reflected {
        Reflected {
            index: 1,
            ..Reflected::new(attribute, syntax)
        }
    }

    pub(crate) const fn animated(attribute: Known, syntax: Syntax) -> Reflected {
        Reflected {
            is_animated: true,
            ..Reflected::new(attribute, syntax)
        }
    }
}

/// A comma may come last.
fn numbers(source: &str) -> Option<Vec<f32>> {
    let mut input = Numbers(source.as_bytes());
    let numbers = input.by_ref().collect();
    input.0.is_empty().then_some(numbers)
}

pub(super) fn split<'s>(source: &'s str, at: &'static str) -> impl Iterator<Item = &'s str> {
    strings::split(source.as_bytes(), at.as_bytes()).map(text)
}

fn split_once(source: &str, at: u8) -> Option<(&str, &str)> {
    strings::split_once_char(source.as_bytes(), at)
        .map(|(before, after)| (text(before), text(after)))
}

fn integers(source: &str) -> Option<Vec<f64>> {
    let parts = split(source.trim_ascii(), ",").map(str::trim_ascii);
    let words = parts.flat_map(|part| {
        part.split_ascii_whitespace()
            .chain(part.is_empty().then_some(""))
    });
    words
        .map(|it| it.parse::<i32>().ok().map(f64::from))
        .collect()
}

fn constant(keywords: &[&str], word: &str) -> Option<f64> {
    keywords
        .iter()
        .position(|it| *it == word)
        .map(|it| it as f64 + 1.0)
}

/// The number, and what is attached to it.
fn dimension(source: &str) -> Option<(f32, &[u8])> {
    let source = source.trim_ascii().as_bytes();
    let (number, unit) = source.split_at(
        source.len()
            - source
                .iter()
                .rev()
                .take_while(|it| it.is_ascii_alphabetic() || **it == b'%')
                .count(),
    );
    number
        .last()
        .is_some_and(u8::is_ascii_digit)
        .then_some(())?;
    if let [value] = numbers(text(number))?[..] {
        Some((value, unit))
    } else {
        None
    }
}

impl Length {
    pub(super) fn new(value: f32, unit: Unit, axis: Axis) -> Length {
        Length {
            value,
            unit,
            calculation: None,
            axis,
        }
    }

    #[optimize(size)]
    pub(super) fn parse(source: &str, axis: Axis) -> Option<Length> {
        let Some((value, unit)) = dimension(source) else {
            let source = source.trim_ascii();
            let is_calculation =
                source.ends_with(')') && supports_declaration(b"x", source.as_bytes());
            return is_calculation.then(|| Length {
                calculation: Some(source.into()),
                ..Length::new(0.0, Unit::Number, axis)
            });
        };
        let unit = match unit {
            b"" => Unit::Number,
            b"%" => Unit::Percent,
            name => Unit::from_name(name).filter(|it| it.kind() == Kind::Length)?,
        };
        Some(Length::new(value, unit, axis))
    }

    #[optimize(size)]
    pub(super) fn write(&self, out: &mut Out) {
        match &self.calculation {
            Some(source) => out.extend_from_slice(source.as_bytes()),
            None => Angle {
                value: self.value,
                unit: self.unit,
            }
            .write(out),
        }
    }
}

impl Angle {
    pub(super) const ZERO: Angle = Angle {
        value: 0.0,
        unit: Unit::Number,
    };

    #[optimize(size)]
    pub(super) fn parse(source: &str) -> Option<Angle> {
        let (value, name) = dimension(source)?;
        let unit = [Unit::Number, Unit::Deg, Unit::Rad, Unit::Grad, Unit::Turn]
            .into_iter()
            .find(|it| it.name().as_bytes() == name)?;
        Some(Angle { value, unit })
    }

    #[optimize(size)]
    pub(super) fn write(self, out: &mut Out) {
        write_number(self.value, out);
        out.extend_from_slice(self.unit.name().as_bytes());
    }
}

pub(super) fn rotation(degrees: f64) -> [f64; 6] {
    let (sin, cos) = degrees.to_radians().sin_cos();
    [cos, sin, -sin, cos, 0.0, 0.0]
}

pub(super) fn skew(x: f32, y: f32) -> [f64; 6] {
    let [x, y] = [x, y].map(|it| f64::from(it).to_radians().tan());
    [1.0, y, x, 1.0, 0.0, 0.0]
}

const FUNCTIONS: [(Function, &str); 6] = [
    (Function::Matrix, "matrix"),
    (Function::Translate, "translate"),
    (Function::Scale, "scale"),
    (Function::Rotate, "rotate"),
    (Function::SkewX, "skewX"),
    (Function::SkewY, "skewY"),
];

impl Transform {
    pub(super) fn of_matrix(matrix: Affine) -> Transform {
        Transform {
            function: Function::Matrix,
            angle: 0.0,
            center: [0.0; 2],
            matrix,
        }
    }

    /// `None` for the wrong number of arguments.
    pub(super) fn new(function: Function, arguments: &[f32]) -> Option<Transform> {
        let (mut angle, mut center) = (0.0, [0.0; 2]);
        let matrix = match (function, arguments) {
            (Function::Matrix, &[a, b, c, d, e, f]) => [a, b, c, d, e, f].map(f64::from),
            (Function::Translate, &[x]) => [1.0, 0.0, 0.0, 1.0, x.into(), 0.0],
            (Function::Translate, &[x, y]) => [1.0, 0.0, 0.0, 1.0, x.into(), y.into()],
            (Function::Scale, &[x] | &[x, _]) => [
                x.into(),
                0.0,
                0.0,
                arguments[arguments.len() - 1].into(),
                0.0,
                0.0,
            ],
            (Function::Rotate, &[degrees] | &[degrees, _, _]) => {
                (angle, center) = (degrees, arguments[1..].try_into().unwrap_or_default());
                let [x, y] = center.map(f64::from);
                Affine([1.0, 0.0, 0.0, 1.0, x, y])
                    .then(rotation(degrees.into()))
                    .then([1.0, 0.0, 0.0, 1.0, -x, -y])
                    .0
            }
            (Function::SkewX | Function::SkewY, &[degrees]) => {
                angle = degrees;
                if function == Function::SkewX {
                    skew(degrees, 0.0)
                } else {
                    skew(0.0, degrees)
                }
            }
            _ => return None,
        };
        Some(Transform {
            function,
            angle,
            center,
            matrix: Affine(matrix),
        })
    }

    #[optimize(size)]
    fn parse_list(mut rest: &str) -> Option<Vec<Transform>> {
        let mut all = Vec::new();
        loop {
            rest = rest.trim_ascii_start();
            let Some((name, after)) = split_once(rest, b'(') else {
                return rest.is_empty().then_some(all);
            };
            let (arguments, after) = split_once(after, b')')?;
            all.push(Transform::new(
                FUNCTIONS.iter().find(|it| it.1 == name.trim_ascii_end())?.0,
                &numbers(arguments)?,
            )?);
            rest = after.trim_ascii_start();
            rest = rest.strip_prefix(',').unwrap_or(rest);
        }
    }

    #[optimize(size)]
    fn write(&self, out: &mut Out) {
        let ([a, b, c, d, e, f], [x, y]) = (self.matrix.narrow(), self.center);
        let arguments: &[f32] = match self.function {
            Function::Matrix => &[a, b, c, d, e, f],
            Function::Translate => &[e, f],
            Function::Scale => &[a, d],
            Function::Rotate if self.center != [0.0; 2] => &[self.angle, x, y],
            _ => &[self.angle],
        };
        out.extend_from_slice(FUNCTIONS[self.function as usize - 1].1.as_bytes());
        out.push(b'(');
        write_list(arguments, " ", out, |it, out| write_number(*it, out));
        out.push(b')');
    }
}

impl Data {
    pub(super) fn of(numbers: impl IntoIterator<Item = impl Into<f64>>) -> Data {
        let mut all = [0.0; 6];
        all.iter_mut()
            .zip(numbers)
            .for_each(|(to, from)| *to = from.into());
        Data::Numbers(all)
    }
}

impl Syntax {
    pub(super) fn initial(self) -> Data {
        match self {
            Syntax::Length(axis, value, unit) => Data::Length(Length::new(value, unit, axis)),
            Syntax::Number(value) | Syntax::NumberPair(value) => Data::of([value; 2]),
            Syntax::Integer(value) => Data::of([value]),
            Syntax::Order => Data::of([3; 2]),
            Syntax::Keyword(_, value) => Data::of([value]),
            Syntax::Text => Data::Text(DomString::default()),
            Syntax::OrientAngle => Data::Angle(Angle::ZERO),
            Syntax::OrientType => Data::of([ORIENT_ANGLE]),
            Syntax::Ratio => Data::of([6, 1]),
            _ => Data::Numbers([0.0; 6]),
        }
    }

    pub(super) fn keywords(self) -> &'static [&'static str] {
        if let Syntax::Keyword(keywords, _) = self {
            keywords
        } else {
            &ORIENTATIONS
        }
    }

    #[optimize(size)]
    pub(super) fn parse(self, source: &DomString) -> Option<Data> {
        let pair = |all: &[f64]| {
            if let [first] | [first, _] = all {
                Some(Data::of([*first, all[all.len() - 1]]))
            } else {
                None
            }
        };
        let text = &*source.to_utf8();
        Some(match self {
            Syntax::Text => Data::Text(source.clone()),
            Syntax::Length(axis, ..) => Data::Length(Length::parse(text, axis)?),
            Syntax::NumberOrPercentage
                if let Some(percent) = text.trim_ascii_end().strip_suffix('%') =>
            {
                Data::of(numbers(percent)?.first().map(|it| it / 100.0))
            }
            Syntax::Number(_) | Syntax::NumberOrPercentage => {
                Data::of(<[f32; 1]>::try_from(Numbers::all(text)?).ok()?)
            }
            Syntax::NumberPair(_) => pair(
                &Numbers::all(text)?
                    .into_iter()
                    .map(f64::from)
                    .collect::<Vec<_>>(),
            )?,
            Syntax::Integer(_) => Data::of(<[f64; 1]>::try_from(integers(text)?).ok()?),
            Syntax::Order => pair(&integers(text).filter(|all| all.iter().all(|it| *it > 0.0))?)?,
            Syntax::Keyword(keywords, _) => Data::of([constant(keywords, text)?]),
            Syntax::Boolean => Data::of([text == "true"]),
            Syntax::OrientAngle => Data::Angle(Angle::parse(text)?),
            Syntax::OrientType => Data::of([constant(&ORIENTATIONS, text)?]),
            Syntax::ViewBox => Data::of(
                <[f32; 4]>::try_from(numbers(text)?)
                    .ok()
                    .filter(|it| it[2] >= 0.0 && it[3] >= 0.0)?,
            ),
            Syntax::Ratio => {
                let mut words = text.split_ascii_whitespace();
                let values = [
                    constant(&ALIGNMENTS, words.next()?)?,
                    constant(&FITS, words.next().unwrap_or("meet"))?,
                ];
                words.next().is_none().then(|| Data::of(values))?
            }
            _ => return None,
        })
    }

    #[optimize(size)]
    pub(super) fn parse_list(self, source: &DomString) -> Option<Vec<Data>> {
        let text = &*source.to_utf8();
        Some(match self {
            Syntax::Numbers => numbers(text)?
                .into_iter()
                .map(|it| Data::of([it]))
                .collect(),
            Syntax::Points => numbers(text)?
                .as_chunks::<2>()
                .0
                .iter()
                .map(|it| Data::of(*it))
                .collect(),
            Syntax::Transforms => Transform::parse_list(text)?
                .into_iter()
                .map(Data::Transform)
                .collect(),
            Syntax::Tokens => source.tokens().map(Data::Text).collect(),
            Syntax::Languages if text.trim_ascii().is_empty() => Vec::new(),
            Syntax::Languages => split(text, ",")
                .map(|it| Data::Text(it.trim_ascii().into()))
                .collect(),
            Syntax::Lengths(axis) => {
                let mut depth = 0_usize;
                let is_separator = |it: &u8| {
                    depth =
                        (depth + usize::from(*it == b'(')).saturating_sub(usize::from(*it == b')'));
                    depth == 0 && (*it == b',' || it.is_ascii_whitespace())
                };
                let words = text
                    .as_bytes()
                    .split(is_separator)
                    .filter(|it| !it.is_empty())
                    .map(crate::values::text);
                words
                    .map(|it| Length::parse(it, axis).map(Data::Length))
                    .collect::<Option<_>>()?
            }
            _ => return None,
        })
    }

    /// `current` is what the attribute has.
    pub(super) fn serialize(self, data: &Data, current: Option<DomString>) -> DomString {
        match (self, data, current) {
            (_, Data::Text(it), _) => it.clone(),
            (Syntax::OrientType, Data::Numbers([ORIENT_ANGLE, ..]), Some(current))
                if Angle::parse(&current.to_utf8()).is_some() =>
            {
                current
            }
            _ => self.serialize_list(core::slice::from_ref(data)),
        }
    }

    pub(super) fn serialize_list(self, items: &[Data]) -> DomString {
        let mut out = Out::new();
        write_list(
            items,
            if let Syntax::Languages = self {
                ","
            } else {
                " "
            },
            &mut out,
            |it, out| self.write(it, out),
        );
        text(&out).into()
    }

    #[optimize(size)]
    fn write(self, data: &Data, out: &mut Out) {
        let numbers = match data {
            Data::Numbers(numbers) => numbers,
            Data::Length(it) => return it.write(out),
            Data::Angle(it) => return it.write(out),
            Data::Transform(it) => return it.write(out),
            Data::Text(it) => return out.extend_from_slice(it.to_utf8().as_bytes()),
        };
        let word = |keywords: &[&'static str], index: usize| keywords[numbers[index] as usize - 1];
        let (count, glue): (usize, &str) = match self {
            Syntax::Keyword(..) | Syntax::OrientType => {
                return out.extend_from_slice(word(self.keywords(), 0).as_bytes());
            }
            Syntax::Boolean => {
                return out.extend_from_slice(if numbers[0] == 0.0 { b"false" } else { b"true" });
            }
            Syntax::Ratio => {
                return out.extend_from_slice(
                    [word(&ALIGNMENTS, 0), word(&FITS, 1)].join(" ").as_bytes(),
                );
            }
            Syntax::NumberPair(_) | Syntax::Order if numbers[0] != numbers[1] => (2, " "),
            Syntax::Points => (2, ","),
            Syntax::ViewBox => (4, " "),
            _ => (1, ""),
        };
        write_list(&numbers[..count], glue, out, |it, out| match self {
            Syntax::Integer(_) | Syntax::Order => _ = write!(out, "{}", *it as i32),
            _ => write_number(*it as f32, out),
        });
    }
}
