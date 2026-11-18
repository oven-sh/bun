//! Units and math functions.

use crate::order::Order as _;
use crate::properties::Prop;
use bun_core::strings;
use core::hash::BuildHasher;
use core::ops::Range;
use std::borrow::Cow;
use std::rc::Rc;

use bun_css::Token;

use crate::types::dashed_ident;
use crate::values::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Length,
    Angle,
    Time,
    Frequency,
    Resolution,
    Flex,
    Percentage,
    Number,
}

macro_rules! units {
    ($($kind:ident { $($Unit:ident $name:literal $factor:expr),+ })+) => {
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub(crate) enum Unit { $($($Unit,)+)+ }

        /// The name, and how many of the canonical unit it is, or 0 if that depends on the element.
        const UNITS: &[(Unit, &str, Kind, f64)] = &[$($((Unit::$Unit, $name, Kind::$kind, $factor),)+)+];
    };
}

units! {
    Number { Number "" 1.0 }
    Percentage { Percent "%" 1.0 }
    Length {
        Px "px" 1.0, Em "em" 0.0, Rem "rem" 0.0, Vw "vw" 0.0, Vh "vh" 0.0, Cm "cm" 96.0 / 2.54, Mm "mm" 96.0 / 25.4,
        Q "q" 96.0 / 101.6, In "in" 96.0, Pt "pt" 96.0 / 72.0, Pc "pc" 16.0, Ex "ex" 0.0, Rex "rex" 0.0, Ch "ch" 0.0,
        Rch "rch" 0.0, Cap "cap" 0.0, Rcap "rcap" 0.0, Ic "ic" 0.0, Ric "ric" 0.0, Lh "lh" 0.0, Rlh "rlh" 0.0, Vi "vi" 0.0,
        Vb "vb" 0.0, Vmin "vmin" 0.0, Vmax "vmax" 0.0, Svw "svw" 0.0, Svh "svh" 0.0, Svi "svi" 0.0, Svb "svb" 0.0,
        Svmin "svmin" 0.0, Svmax "svmax" 0.0, Lvw "lvw" 0.0, Lvh "lvh" 0.0, Lvi "lvi" 0.0, Lvb "lvb" 0.0,
        Lvmin "lvmin" 0.0, Lvmax "lvmax" 0.0, Dvw "dvw" 0.0, Dvh "dvh" 0.0, Dvi "dvi" 0.0, Dvb "dvb" 0.0,
        Dvmin "dvmin" 0.0, Dvmax "dvmax" 0.0, Cqw "cqw" 0.0, Cqh "cqh" 0.0, Cqi "cqi" 0.0, Cqb "cqb" 0.0,
        Cqmin "cqmin" 0.0, Cqmax "cqmax" 0.0
    }
    Angle { Deg "deg" 1.0, Grad "grad" 0.9, Rad "rad" 180.0 / core::f64::consts::PI, Turn "turn" 360.0 }
    Time { S "s" 1.0, Ms "ms" 0.001 }
    Frequency { Hz "hz" 1.0, Khz "khz" 1000.0 }
    Resolution { Dppx "dppx" 1.0, X "x" 1.0, Dpi "dpi" 1.0 / 96.0, Dpcm "dpcm" 2.54 / 96.0 }
    Flex { Fr "fr" 1.0 }
}

impl Unit {
    pub(crate) fn from_name(name: &[u8]) -> Option<Unit> {
        UNITS[2..].iter().find(|it| eq(name, it.1)).map(|it| it.0)
    }

    pub(crate) fn name(self) -> &'static str {
        UNITS[self as usize].1
    }

    pub(crate) fn kind(self) -> Kind {
        UNITS[self as usize].2
    }

    /// In the canonical unit, if that is known.
    pub(crate) fn canonical(self, value: f64, cx: Option<&Ctx>) -> Option<f64> {
        match (UNITS[self as usize].3, self.kind(), cx) {
            (0.0, _, cx) => Some(value * cx?.px_per(self)),
            (factor, Kind::Length, Some(cx)) => Some(value * factor * f64::from(cx.zoom)),
            (factor, ..) => Some(value * factor),
        }
    }
}

impl Kind {
    pub(crate) fn unit(self) -> Unit {
        [
            Unit::Px,
            Unit::Deg,
            Unit::S,
            Unit::Hz,
            Unit::Dppx,
            Unit::Fr,
            Unit::Percent,
            Unit::Number,
        ][self as usize]
    }
}

keywords! {
    Function {
        Min = "min", Max = "max", Clamp = "clamp", Round = "round", Mod = "mod", Rem = "rem", Abs = "abs", Hypot = "hypot", Random = "random",
        Sign = "sign", Progress = "progress", Atan2 = "atan2", Sin = "sin", Cos = "cos", Tan = "tan", Asin = "asin",
        Acos = "acos", Atan = "atan", Pow = "pow", Sqrt = "sqrt", Log = "log", Exp = "exp",
        SiblingIndex = "sibling-index", SiblingCount = "sibling-count",
    }
    Modifier { Nearest = "nearest", Up = "up", Down = "down", ToZero = "to-zero", NoClamp = "no-clamp" }
    AnchorSide { Inside = "inside", Outside = "outside", Top = "top", Left = "left", Right = "right", Bottom = "bottom",
        Start = "start", End = "end", SelfStart = "self-start", SelfEnd = "self-end", Center = "center" }
    AnchorSize { Width = "width", Height = "height", Block = "block", Inline = "inline", SelfBlock = "self-block",
        SelfInline = "self-inline" }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Measure {
    Side(AnchorSide),
    Percentage(Node),
    /// `None` is the axis of the property.
    Size(Option<AnchorSize>),
}

/// `anchor()` or `anchor-size()`
#[derive(Clone, PartialEq)]
pub(crate) struct Anchor {
    pub(crate) name: Option<Str>,
    pub(crate) measure: Measure,
    pub(crate) fallback: Option<Node>,
}

#[derive(Clone, PartialEq)]
pub(crate) enum Node {
    Value(f64, Unit),
    /// An index into `Options::keywords`.
    Keyword(u8, &'static str, Kind),
    /// In `clamp()`.
    None,
    /// What the values of `random()` that are the same have in common.
    Seed(Str),
    Sum(Vec<Node>),
    Product(Vec<Node>),
    Negate(Box<Node>),
    Invert(Box<Node>),
    Call(Function, Modifier, Vec<Node>),
    Anchor(Rc<Anchor>),
}

#[derive(Clone, Copy)]
pub(crate) struct Options {
    pub(crate) kind: Kind,
    /// Of something of that kind.
    pub(crate) percentages: bool,
    pub(crate) keywords: &'static [&'static str],
    pub(crate) anchor: bool,
    pub(crate) anchor_size: bool,
}

impl Options {
    pub(crate) const fn new(kind: Kind) -> Options {
        Options {
            kind,
            percentages: false,
            keywords: &[],
            anchor: false,
            anchor_size: false,
        }
    }

    pub(crate) const LENGTH_PERCENTAGE: Options = Options {
        percentages: true,
        ..Options::new(Kind::Length)
    };
    pub(crate) const CALC_SIZE: Options = Options {
        keywords: &["size"],
        ..Options::LENGTH_PERCENTAGE
    };
}

const MAX_DEPTH: u8 = 100;

/// The power of each kind.
type Type = [i8; 7];

fn type_of(kind: Kind) -> Type {
    core::array::from_fn(|index| i8::from(index == kind as usize))
}

/// With the precision that the token lacks.
fn exact(p: &P, start: usize, unit: usize, rounded: f32) -> f64 {
    let source = p.slice_from(start);
    text(&source[..source.len().saturating_sub(unit)])
        .parse()
        .unwrap_or_else(|_| rounded.into())
}

thread_local! {
    static RANDOM_STATE: std::hash::RandomState = std::hash::RandomState::new();
}

struct Reader<'a> {
    options: &'a Options,
    depth: u8,
}

impl Reader<'_> {
    fn inside<T>(
        &mut self,
        p: &mut P,
        read: impl FnOnce(&mut Self, &mut P) -> Option<T>,
    ) -> Option<T> {
        self.depth += 1;
        let result = (self.depth <= MAX_DEPTH).then(|| nested(p, |p| read(self, p)))?;
        self.depth -= 1;
        result
    }

    fn sum(&mut self, p: &mut P) -> Option<Node> {
        let mut terms = vec![self.product(p)?];
        loop {
            let operator = attempt(p, |p| {
                matches!(p.next_including_whitespace().ok()?, Token::Whitespace(_)).then_some(())?;
                let operator = *p.next().ok()?;
                matches!(p.next_including_whitespace().ok()?, Token::Whitespace(_)).then_some(())?;
                matches!(operator, Token::Delim(0x2b | 0x2d))
                    .then_some(matches!(operator, Token::Delim(0x2d)))
            });
            match operator {
                Some(true) => terms.push(Node::Negate(Box::new(self.product(p)?))),
                Some(false) => terms.push(self.product(p)?),
                None => {
                    return if terms.len() == 1 {
                        terms.pop()
                    } else {
                        Some(Node::Sum(terms))
                    };
                }
            }
        }
    }

    fn product(&mut self, p: &mut P) -> Option<Node> {
        let mut factors = vec![self.value(p)?];
        loop {
            match () {
                () if delim(p, b'*') => factors.push(self.value(p)?),
                () if delim(p, b'/') => factors.push(Node::Invert(Box::new(self.value(p)?))),
                () => {
                    return if factors.len() == 1 {
                        factors.pop()
                    } else {
                        Some(Node::Product(factors))
                    };
                }
            }
        }
    }

    fn value(&mut self, p: &mut P) -> Option<Node> {
        p.skip_whitespace();
        let start = p.position();
        Some(match *p.next().ok()? {
            Token::Number(number) => Node::Value(exact(p, start, 0, number.value), Unit::Number),
            Token::Percentage { unit_value, .. } => {
                Node::Value(exact(p, start, 1, unit_value * 100.0), Unit::Percent)
            }
            Token::Dimension(it) => Node::Value(
                exact(p, start, it.unit.len(), it.num.value),
                Unit::from_name(it.unit)?,
            ),
            Token::OpenParen => self.inside(p, Self::sum)?,
            Token::Function(name) => self.function(name, p)?,
            Token::Ident(name) => {
                const CONSTANTS: [(&str, f64); 5] = [
                    ("e", core::f64::consts::E),
                    ("pi", core::f64::consts::PI),
                    ("infinity", f64::INFINITY),
                    ("-infinity", f64::NEG_INFINITY),
                    ("nan", f64::NAN),
                ];
                match (0..).zip(self.options.keywords).find(|it| eq(name, it.1)) {
                    Some((index, name)) => Node::Keyword(
                        index,
                        name,
                        if *name == "size" {
                            Kind::Length
                        } else {
                            Kind::Number
                        },
                    ),
                    None => {
                        Node::Value(CONSTANTS.iter().find(|it| eq(name, it.0))?.1, Unit::Number)
                    }
                }
            }
            _ => return None,
        })
    }

    fn function(&mut self, name: &[u8], p: &mut P) -> Option<Node> {
        if eq(name, "calc") || eq(name, "-webkit-calc") {
            return self.inside(p, Self::sum);
        }
        let Some(function) = Function::from_name(name) else {
            let is_size = eq(name, "anchor-size");
            (if is_size {
                self.options.anchor_size
            } else {
                self.options.anchor && eq(name, "anchor")
            })
            .then_some(())?;
            return self.inside(p, |this, p| this.anchor(is_size, p));
        };
        self.inside(p, |this, p| {
            let seed = if function == Function::Random {
                Some(this.seed(p)?)
            } else {
                None
            };
            let modifier = match function {
                Function::Round => attempt(p, |p| {
                    Modifier::from_name(ident(p)?).filter(|it| *it != Modifier::NoClamp && comma(p))
                }),
                Function::Progress => keyword(p, "no-clamp").then_some(Modifier::NoClamp),
                _ => None,
            };
            let argument = |p: &mut P| match function == Function::Clamp && keyword(p, "none") {
                true => Some(Node::None),
                false => this.sum(p),
            };
            let arguments = if function as u8 >= Function::SiblingIndex as u8 {
                Vec::new()
            } else {
                commas(p, argument)?
            };
            let counts = match function {
                Function::Min | Function::Max | Function::Hypot => 1..=usize::MAX,
                Function::Clamp | Function::Progress => 3..=3,
                Function::Round | Function::Log => 1..=2,
                Function::Random => 2..=3,
                Function::Mod | Function::Rem | Function::Atan2 | Function::Pow => 2..=2,
                Function::SiblingIndex | Function::SiblingCount => 0..=0,
                _ => 1..=1,
            };
            (counts.contains(&arguments.len()) && arguments.get(1) != Some(&Node::None))
                .then_some(())?;
            Some(Node::Call(
                function,
                modifier.unwrap_or(Modifier::Nearest),
                seed.into_iter().chain(arguments).collect(),
            ))
        })
    }

    fn seed(&mut self, p: &mut P) -> Option<Node> {
        if keyword(p, "fixed") {
            let value = Node::parse_at(p, &Options::new(Kind::Number), self.depth)?;
            return (!matches!(value, Node::Value(it, _) if !(0.0..=1.0).contains(&it))
                && comma(p))
            .then_some(value);
        }
        let mut parts: [Option<Out>; 3] = [None, None, None];
        let is_auto = keyword(p, "auto");
        while let Some((index, name)) =
            attempt(p, |p| ident(p).and_then(|it| Some((seed_part(it)?, it))))
        {
            let mut written = Out::new();
            write_ident(
                &if index == 1 {
                    name.to_ascii_lowercase()
                } else {
                    name.to_vec()
                },
                &mut written,
            );
            (!is_auto && parts[index].replace(written).is_none()).then_some(())?;
        }
        let parts: Vec<_> = parts.into_iter().flatten().collect();
        (!is_auto && parts.is_empty() || comma(p))
            .then(|| Node::Seed(text(&parts.join(&b' ')).into()))
    }

    fn anchor(&mut self, is_size: bool, p: &mut P) -> Option<Node> {
        let (start, before) = (p.position(), dashed_ident(p));
        let measure = match is_size {
            true => Measure::Size(attempt(p, |p| AnchorSize::from_name(ident(p)?))),
            false => match ident(p) {
                Some(side) => Measure::Side(AnchorSide::from_name(side)?),
                None => Measure::Percentage(Node::parse(p, &Options::new(Kind::Percentage))?),
            },
        };
        let name = before.or_else(|| dashed_ident(p));
        let has_fallback = if p.position() == start {
            !p.is_exhausted()
        } else {
            comma(p)
        };
        let fallback = match has_fallback {
            true => Some(Node::parse_at(p, self.options, self.depth)?),
            false => None,
        };
        Some(Node::Anchor(Rc::new(Anchor {
            name,
            measure,
            fallback,
        })))
    }
}

fn seed_part(name: &[u8]) -> Option<usize> {
    match name {
        [b'-', b'-', _, ..] => Some(0),
        _ if eq(name, "element-scoped") => Some(1),
        _ => (name.starts_with(b"ua-")
            || eq(name, "property-scoped")
            || eq(name, "property-index-scoped"))
        .then_some(2),
    }
}

pub(crate) fn has_random(source: &[u8]) -> bool {
    strings::contains_char(source, b'(')
        && strings::contains_case_insensitive_ascii(source, b"random(")
}

/// Spells out what the `random()`s in a value owe to the property.
pub(crate) fn scope_random<'a>(property: Prop, source: &'a [u8]) -> Cow<'a, [u8]> {
    fn visit(
        p: &mut P,
        depth: u8,
        count: &mut u32,
        replace: &mut dyn FnMut(Range<usize>, u32, &[u8]),
    ) {
        while let Ok(token) = p.next().copied() {
            if !matches!(token, Token::Function(_) | Token::OpenParen) || depth > MAX_DEPTH {
                continue;
            }
            crate::values::visit_nested(p, |p| {
                if matches!(token, Token::Function(name) if eq(name, "random")) {
                    *count += 1;
                    p.skip_whitespace();
                    let (first, mut at) = (p.position(), p.position());
                    while let Some(name) = attempt(p, |p| {
                        ident(p).filter(|it| {
                            seed_part(it).is_some() || eq(it, "auto") || eq(it, "fixed")
                        })
                    }) {
                        replace(at..p.position(), *count, name);
                        p.skip_whitespace();
                        at = p.position();
                    }
                    if at == first {
                        replace(at..at, *count, b"");
                    }
                }
                visit(p, depth + 1, count, replace);
            });
        }
    }
    if !has_random(source) {
        return Cow::Borrowed(source);
    }
    let property = if let Prop::Custom(name) = property {
        crate::custom::spelling(name)
    } else {
        property.name().into()
    };
    let (mut out, mut at) = (Out::new(), 0);
    with_parser(source, |p| {
        visit(p, 0, &mut 0, &mut |range, index, name| {
            let name = match () {
                () if name.is_empty() => format!("element-scoped ua-{property}-{index}, "),
                () if eq(name, "auto") => format!("element-scoped ua-{property}-{index}"),
                () if eq(name, "property-scoped") => format!("ua-{property}"),
                () if eq(name, "property-index-scoped") => format!("ua-{property}-{index}"),
                () => return,
            };
            out.extend([&source[at..range.start], name.as_bytes()].concat());
            at = range.end;
        });
    });
    out.extend_from_slice(&source[at..]);
    Cow::Owned(out)
}

/// https://drafts.csswg.org/css-values-5/#random-simplify
fn random(base: f64, min: f64, max: f64, step: Option<f64>) -> f64 {
    if min.is_infinite() {
        return min;
    }
    if max.is_infinite() || max.is_nan() || step.is_some_and(f64::is_nan) {
        return f64::NAN;
    }
    let range = (max - min).max(0.0);
    match step.filter(|it| *it > 0.0) {
        None => min + base * range,
        Some(f64::INFINITY) => min,
        Some(step) => {
            let count = (range / step + 1e-3).floor();
            (min + (base * (count + 1.0)).floor().min(count) * step).min(min + range)
        }
    }
}

fn round(modifier: Modifier, value: f64, step: f64) -> f64 {
    if step == 0.0 || value.is_infinite() && step.is_infinite() || step.is_nan() {
        return f64::NAN;
    }
    if step.is_infinite() {
        return match modifier {
            Modifier::Up if value > 0.0 => f64::INFINITY,
            Modifier::Down if value < 0.0 => f64::NEG_INFINITY,
            _ => value * 0.0,
        };
    }
    let step = step.abs();
    let (lower, upper) = ((value / step).floor() * step, (value / step).ceil() * step);
    match modifier {
        Modifier::Up => upper,
        Modifier::Down => lower,
        Modifier::ToZero => {
            if value > 0.0 {
                lower
            } else {
                upper
            }
        }
        _ => {
            if value - lower < upper - value {
                lower
            } else {
                upper
            }
        }
    }
}

/// Angles are in degrees.
fn call(function: Function, modifier: Modifier, a: &[f64]) -> f64 {
    let pick = |a: f64, b: f64, less: bool| match () {
        () if a.is_nan() || b.is_nan() => f64::NAN,
        () => {
            if a.total_cmp(&b).is_lt() == less {
                a
            } else {
                b
            }
        }
    };
    let exactly = |at: [f64; 4], otherwise: fn(f64) -> f64| match a[0].rem_euclid(360.0) / 90.0 {
        _ if a[0] == 0.0 => otherwise(a[0]),
        quarters if quarters.fract() == 0.0 && quarters < 4.0 => at[quarters as usize],
        _ => otherwise(a[0].to_radians()),
    };
    match function {
        Function::Min => a
            .iter()
            .copied()
            .reduce(|a, b| pick(a, b, true))
            .unwrap_or_default(),
        Function::Max => a
            .iter()
            .copied()
            .reduce(|a, b| pick(a, b, false))
            .unwrap_or_default(),
        Function::Clamp => pick(a[0], pick(a[1], a[2], true), false),
        Function::Round => round(modifier, a[0], a.get(1).copied().unwrap_or(1.0)),
        Function::Rem => a[0] % a[1],
        Function::Mod if a[1].is_infinite() && a[0].is_finite() => {
            if a[0].is_sign_negative() == a[1].is_sign_negative() {
                a[0]
            } else {
                f64::NAN
            }
        }
        Function::Mod => match a[0] % a[1] {
            0.0 => 0f64.copysign(a[1]),
            rest if (rest < 0.0) != (a[1] < 0.0) => rest + a[1],
            rest => rest,
        },
        Function::Abs => a[0].abs(),
        Function::Hypot => a.iter().fold(0.0, |all, it| it.hypot(all)),
        Function::Random => random(
            a[0].clamp(0.0, 1.0 - f64::EPSILON),
            a[1],
            a[2],
            a.get(3).copied(),
        ),
        Function::Sign => {
            if a[0] == 0.0 {
                a[0]
            } else {
                a[0].signum()
            }
        }
        Function::Progress => match (a[0] - a[1]) / (a[2] - a[1]) {
            progress if modifier == Modifier::NoClamp => progress,
            progress if progress.is_nan() => 0.0,
            progress => progress.clamp(0.0, 1.0),
        },
        Function::Atan2 => a[0].atan2(a[1]).to_degrees(),
        Function::Sin => exactly([0.0, 1.0, 0.0, -1.0], f64::sin),
        Function::Cos => exactly([1.0, 0.0, -1.0, 0.0], f64::cos),
        Function::Tan => exactly([0.0, f64::INFINITY, 0.0, f64::NEG_INFINITY], f64::tan),
        Function::Asin => a[0].asin().to_degrees(),
        Function::Acos => a[0].acos().to_degrees(),
        Function::Atan => a[0].atan().to_degrees(),
        Function::Pow if a[1].is_nan() => f64::NAN,
        Function::Pow => a[0].powf(a[1]),
        Function::Sqrt => a[0].sqrt(),
        Function::Log => a[0].ln() / a.get(1).map_or(1.0, |base| base.ln()),
        Function::Exp => a[0].exp(),
        Function::SiblingIndex | Function::SiblingCount => 1.0,
    }
}

/// What the leaves stand for.
pub(crate) struct Inputs<'a> {
    /// 100%
    pub(crate) basis: f64,
    pub(crate) keywords: &'a [f64],
    pub(crate) anchor: &'a dyn Fn(&Anchor) -> Option<f32>,
}

impl Node {
    pub(crate) const ONE: Node = Node::Value(1.0, Unit::Number);

    /// A literal or a math function. A literal zero is a length.
    pub(crate) fn parse(p: &mut P, options: &Options) -> Option<Node> {
        Node::parse_at(p, options, 0)
    }

    /// A math function of any type.
    pub(crate) fn parse_untyped(p: &mut P) -> Option<Node> {
        let node = Reader {
            options: &Options::LENGTH_PERCENTAGE,
            depth: 0,
        }
        .value(p)?;
        let kinds = [
            Kind::Percentage,
            Kind::Length,
            Kind::Angle,
            Kind::Time,
            Kind::Frequency,
            Kind::Resolution,
        ];
        kinds
            .into_iter()
            .any(|it| node.type_with(it).is_some())
            .then(|| Node::Sum(vec![node]))
    }

    /// What is inside of `calc()`.
    pub(crate) fn parse_sum(p: &mut P, options: &Options) -> Option<Node> {
        attempt(p, |p| {
            Reader { options, depth: 0 }
                .sum(p)
                .filter(|it| it.is_of(options))
        })
    }

    fn parse_at(p: &mut P, options: &Options, depth: u8) -> Option<Node> {
        attempt(p, |p| {
            p.skip_whitespace();
            let (state, start) = (p.state(), p.position());
            let token = *p.next().ok()?;
            match token {
                Token::Dimension(it) => {
                    return Unit::from_name(it.unit)
                        .filter(|it| it.kind() == options.kind)
                        .map(|unit| {
                            Node::Value(exact(p, start, it.unit.len(), it.num.value), unit)
                        });
                }
                Token::Number(it) if options.kind == Kind::Number => {
                    return Some(Node::Value(exact(p, start, 0, it.value), Unit::Number));
                }
                Token::Percentage { unit_value, .. }
                    if options.percentages || options.kind == Kind::Percentage =>
                {
                    return Some(Node::Value(
                        exact(p, start, 1, unit_value * 100.0),
                        Unit::Percent,
                    ));
                }
                _ => {}
            }
            let is_keyword = matches!(token, Token::Ident(name) if options.keywords.iter().any(|it| eq(name, it)));
            (is_keyword || !matches!(token, Token::Ident(_) | Token::OpenParen)).then_some(())?;
            p.reset(&state);
            let node = Reader { options, depth }.value(p)?;
            if let Token::Function(_) = token {
                return node.is_of(options).then(|| Node::Sum(vec![node]));
            }
            match node {
                Node::Value(0.0, Unit::Number) if options.kind == Kind::Length => {
                    Some(Node::Value(0.0, Unit::Px))
                }
                node => Some(node).filter(|it| it.is_of(options)),
            }
        })
    }

    fn is_of(&self, options: &Options) -> bool {
        let percent = if options.percentages {
            options.kind
        } else {
            Kind::Percentage
        };
        self.type_with(percent) == Some(type_of(options.kind))
            && (options.percentages
                || matches!(options.kind, Kind::Percentage | Kind::Number)
                || !self.has_percentage())
    }

    fn operands(&self) -> &[Node] {
        match self {
            Node::Sum(all) | Node::Product(all) | Node::Call(.., all) => all,
            Node::Negate(one) | Node::Invert(one) => core::slice::from_ref(one),
            Node::Anchor(anchor) => anchor.fallback.as_slice(),
            _ => &[],
        }
    }

    pub(crate) fn any(&self, test: &dyn Fn(&Node) -> bool) -> bool {
        test(self) || self.operands().iter().any(|it| it.any(test))
    }

    pub(crate) fn count(&self) -> usize {
        1 + self.operands().iter().map(Node::count).sum::<usize>()
    }

    pub(crate) fn has_percentage(&self) -> bool {
        self.any(&|it| matches!(it, Node::Value(_, Unit::Percent)))
    }

    pub(crate) fn has_anchor(&self) -> bool {
        self.any(&|it| matches!(it, Node::Anchor(_)))
    }

    fn type_with(&self, percent: Kind) -> Option<Type> {
        use Function as F;
        let same = |all: &[Node]| {
            let mut types = all
                .iter()
                .filter(|it| **it != Node::None)
                .map(|it| it.type_with(percent));
            let first = types.next()??;
            types.all(|it| it == Some(first)).then_some(first)
        };
        let (number, angle) = (type_of(Kind::Number), type_of(Kind::Angle));
        Some(match self {
            Node::Value(_, Unit::Percent) => type_of(percent),
            Node::Value(_, unit) => type_of(unit.kind()),
            Node::Keyword(.., kind) => type_of(*kind),
            Node::None => return None,
            Node::Anchor(_) => type_of(Kind::Length),
            Node::Sum(all) => same(all)?,
            Node::Negate(one) => one.type_with(percent)?,
            Node::Invert(one) => one.type_with(percent)?.map(|it| -it),
            Node::Product(all) => all.iter().try_fold(number, |all, it| {
                let one = it.type_with(percent)?;
                Some(core::array::from_fn(|index| {
                    all[index].saturating_add(one[index])
                }))
            })?,
            Node::Call(F::SiblingIndex | F::SiblingCount, ..) => number,
            Node::Seed(_) => number,
            Node::Call(F::Random, _, all) => same(&all[1..])?,
            Node::Call(function, _, all) => match (function, same(all)?) {
                (F::Round, of) if all.len() == 1 && of != number => return None,
                (
                    F::Min | F::Max | F::Clamp | F::Round | F::Mod | F::Rem | F::Abs | F::Hypot,
                    of,
                ) => of,
                (F::Progress, of) if of != number && of.iter().filter(|it| **it != 0).ne([&1]) => {
                    return None;
                }
                (F::Sign | F::Progress, _) => number,
                (F::Atan2, _) => angle,
                (F::Sin | F::Cos | F::Tan, of) if of == angle => number,
                (_, of) if of != number => return None,
                (F::Asin | F::Acos | F::Atan, _) => angle,
                _ => number,
            },
        })
    }

    /// `is_basis_known`: percentages are not of something that may be negative.
    pub(crate) fn simplified(&self, cx: Option<&Ctx>, is_basis_known: bool) -> Node {
        let simplified = |it: &Node| it.simplified(cx, is_basis_known);
        match self {
            Node::Value(value, unit) => match unit.canonical(*value, cx) {
                Some(value) => Node::Value(value, unit.kind().unit()),
                None => self.clone(),
            },
            Node::Seed(seed) if let Some(cx) = cx => {
                cx.uses(Deps::SIBLINGS);
                let element = if seed
                    .split_ascii_whitespace()
                    .any(|it| it == "element-scoped")
                {
                    cx.element
                } else {
                    0
                };
                let hash = RANDOM_STATE.with(|it| it.hash_one((&**seed, element)));
                Node::Value((hash >> 11) as f64 / (1u64 << 53) as f64, Unit::Number)
            }
            Node::Call(Function::Random, modifier, all) if cx.is_none() => {
                let seed = core::iter::once(all[0].as_specified(true));
                Node::Call(
                    Function::Random,
                    *modifier,
                    seed.chain(all[1..].iter().map(simplified)).collect(),
                )
            }
            Node::Keyword(..) | Node::None | Node::Seed(_) => self.clone(),
            Node::Anchor(anchor) => {
                cx.iter().for_each(|it| it.uses(Deps::ANCHOR));
                let measure = match &anchor.measure {
                    Measure::Percentage(it) if cx.is_some() => {
                        Measure::Percentage(it.simplified(cx, true))
                    }
                    measure => measure.clone(),
                };
                let fallback = anchor.fallback.as_ref().map(|it| {
                    if cx.is_some() {
                        simplified(it)
                    } else {
                        it.as_specified(false)
                    }
                });
                Node::Anchor(Rc::new(Anchor {
                    name: anchor.name.clone(),
                    measure,
                    fallback,
                }))
            }
            Node::Negate(one) => match simplified(one) {
                Node::Negate(inner) => *inner,
                Node::Value(value, unit) => Node::Value(-value, unit),
                Node::Sum(all) if all.iter().all(|it| matches!(it, Node::Value(..))) => {
                    Node::Sum(all).times(-1.0)
                }
                one => Node::Negate(Box::new(one)),
            },
            Node::Invert(one) => match simplified(one) {
                Node::Invert(inner) => *inner,
                Node::Value(value, Unit::Number) => Node::Value(1.0 / value, Unit::Number),
                one => Node::Invert(Box::new(one)),
            },
            Node::Sum(all) => Node::sum(all.iter().map(simplified)),
            Node::Product(all) => Node::product(all.iter().map(simplified)),
            Node::Call(function @ (Function::SiblingIndex | Function::SiblingCount), ..)
                if let Some(cx) = cx =>
            {
                cx.uses(Deps::SIBLINGS);
                let (index, count) = (cx.siblings)();
                Node::Value(
                    if *function == Function::SiblingIndex {
                        index
                    } else {
                        count
                    } as f64,
                    Unit::Number,
                )
            }
            Node::Call(function, modifier, all) => Node::call(
                *function,
                *modifier,
                all.iter().map(simplified).collect(),
                is_basis_known,
            ),
        }
    }

    fn sum(terms: impl Iterator<Item = Node>) -> Node {
        let mut all: Vec<Node> = Vec::new();
        let flat = terms.flat_map(|it| {
            if let Node::Sum(inner) = it {
                inner
            } else {
                vec![it]
            }
        });
        for term in flat {
            let same = |it: &&mut Node| matches!((&**it, &term), (Node::Value(_, a), Node::Value(_, b)) if a == b);
            match (all.iter_mut().find(same), &term) {
                (Some(Node::Value(total, _)), Node::Value(value, _)) => *total += value,
                _ => all.push(term),
            }
        }
        if all.len() == 1 {
            all.swap_remove(0)
        } else {
            Node::Sum(all)
        }
    }

    fn product(factors: impl Iterator<Item = Node>) -> Node {
        let (mut number, mut all) = (None, Vec::new());
        for factor in factors.flat_map(|it| {
            if let Node::Product(inner) = it {
                inner
            } else {
                vec![it]
            }
        }) {
            match factor {
                Node::Value(value, Unit::Number) => number = Some(number.unwrap_or(1.0) * value),
                factor => all.push(factor),
            }
        }
        let is_plain = |it: &Node| match it {
            Node::Sum(all) => all.iter().all(|it| matches!(it, Node::Value(..))),
            it => matches!(it, Node::Value(..)),
        };
        if all.len() == 1 && (number.is_none() || is_plain(&all[0])) {
            return all.swap_remove(0).times(number.unwrap_or(1.0));
        }
        let (mut value, mut powers) = (number.unwrap_or(1.0), Vec::<(Unit, i32)>::new());
        let is_numeric = all.iter().all(|it| {
            let (factor, unit, power) = match it {
                Node::Value(value, unit) => (*value, *unit, 1),
                Node::Invert(inner) if let Node::Value(value, unit) = **inner => {
                    (1.0 / value, unit, -1)
                }
                _ => return false,
            };
            value *= factor;
            match powers.iter_mut().find(|it| it.0 == unit) {
                Some(known) => known.1 += power,
                None => powers.push((unit, power)),
            }
            unit == unit.kind().unit() && unit != Unit::Percent
        });
        powers.retain(|it| it.1 != 0);
        match powers[..] {
            [] if is_numeric => Node::Value(value, Unit::Number),
            [(unit, 1)] if is_numeric => Node::Value(value, unit),
            _ => {
                match (
                    all.iter_mut().find_map(|it| {
                        if let Node::Value(value, _) = it {
                            Some(value)
                        } else {
                            None
                        }
                    }),
                    number,
                ) {
                    (Some(value), Some(number)) => *value *= number,
                    _ => drop(all.splice(0..0, number.map(|it| Node::Value(it, Unit::Number)))),
                }
                Node::Product(all)
            }
        }
    }

    fn call(
        function: Function,
        modifier: Modifier,
        mut all: Vec<Node>,
        is_basis_known: bool,
    ) -> Node {
        use Function as F;
        if function == F::Clamp {
            match (&all[0], &all[2]) {
                (Node::None, Node::None) => return all.swap_remove(1),
                (Node::None, _) => {
                    return Node::call(F::Min, modifier, all.split_off(1), is_basis_known);
                }
                (_, Node::None) => {
                    return Node::call(F::Max, modifier, all.drain(..2).collect(), is_basis_known);
                }
                _ => {}
            }
        }
        let is_known = |unit: Unit| {
            if unit == Unit::Percent {
                is_basis_known
            } else {
                unit == unit.kind().unit()
            }
        };
        let typed = &all[usize::from(function == F::Random)..];
        if let Some(Node::Value(_, unit)) = typed.first()
            && is_known(*unit)
            && typed
                .iter()
                .all(|it| matches!(it, Node::Value(_, other) if other == unit))
        {
            let inputs = Inputs {
                basis: 100.0,
                keywords: &[],
                anchor: &|_| None,
            };
            let unit = match function {
                F::Atan2 | F::Asin | F::Acos | F::Atan => Unit::Deg,
                _ if function as u8 >= F::Sign as u8 => Unit::Number,
                _ => *unit,
            };
            return Node::Value(
                Node::Call(function, modifier, all)
                    .evaluate(&inputs)
                    .unwrap_or_default(),
                unit,
            );
        }
        if matches!(function, F::Min | F::Max) {
            let mut kept: Vec<Node> = Vec::with_capacity(all.len());
            for it in all {
                let same = |other: &&mut Node| matches!((&**other, &it), (Node::Value(_, a), Node::Value(_, b)) if a == b && (*a != Unit::Percent || is_basis_known));
                match (kept.iter_mut().find(same), &it) {
                    (Some(Node::Value(best, _)), Node::Value(value, _)) => {
                        *best = call(function, modifier, &[*best, *value])
                    }
                    _ => kept.push(it),
                }
            }
            return if kept.len() == 1 {
                kept.swap_remove(0)
            } else {
                Node::Call(function, modifier, kept)
            };
        }
        Node::Call(function, modifier, all)
    }

    pub(crate) fn times(self, factor: f64) -> Node {
        match self {
            it if factor == 1.0 => it,
            Node::Value(value, unit) => Node::Value(value * factor, unit),
            Node::Sum(all) => Node::Sum(all.into_iter().map(|it| it.times(factor)).collect()),
            Node::Negate(inner) if factor == -1.0 => *inner,
            it if factor == -1.0 => Node::Negate(Box::new(it)),
            it => Node::product([Node::Value(factor, Unit::Number), it].into_iter()),
        }
    }

    pub(crate) fn plus(self, other: Node) -> Node {
        Node::sum([self, other].into_iter())
    }

    /// With `replace` applied to each of the anchor functions.
    pub(crate) fn with_anchors(&self, replace: &dyn Fn(&Anchor) -> Anchor) -> Node {
        self.map(&|it| {
            if let Node::Anchor(anchor) = it {
                Some(Node::Anchor(Rc::new(replace(anchor))))
            } else {
                None
            }
        })
    }

    /// `None` if one is missing and has no fallback.
    pub(crate) fn without_anchors(&self, find: &dyn Fn(&Anchor) -> Option<f32>) -> Option<Node> {
        let replaced = self.map(&|it| match it {
            Node::Anchor(anchor) => find(anchor)
                .map(|it| Node::Value(it.into(), Unit::Px))
                .or_else(|| anchor.fallback.as_ref()?.without_anchors(find)),
            _ => None,
        });
        (!replaced.has_anchor()).then(|| replaced.simplified(None, false))
    }

    pub(crate) fn with_keyword(&self, value: &Node) -> Node {
        self.map(&|it| matches!(it, Node::Keyword(..)).then(|| value.clone()))
    }

    fn map(&self, replace: &dyn Fn(&Node) -> Option<Node>) -> Node {
        let each = |all: &[Node]| all.iter().map(|it| it.map(replace)).collect();
        match replace(self).unwrap_or_else(|| self.clone()) {
            replaced if matches!(self, Node::Keyword(..)) => replaced,
            Node::Sum(all) => Node::Sum(each(&all)),
            Node::Product(all) => Node::Product(each(&all)),
            Node::Call(function, modifier, all) => Node::Call(function, modifier, each(&all)),
            Node::Negate(one) => Node::Negate(Box::new(one.map(replace))),
            Node::Invert(one) => Node::Invert(Box::new(one.map(replace))),
            Node::Anchor(it) => Node::Anchor(Rc::new(Anchor {
                fallback: it.fallback.as_ref().map(|it| it.map(replace)),
                ..Anchor::clone(&it)
            })),
            leaf => leaf,
        }
    }

    /// Of a node that is computed. `None` if an anchor is missing.
    pub(crate) fn evaluate(&self, inputs: &Inputs) -> Option<f64> {
        Some(match self {
            Node::Value(value, Unit::Percent) => value / 100.0 * inputs.basis,
            Node::Value(value, _) => *value,
            Node::Keyword(index, ..) => inputs
                .keywords
                .get(usize::from(*index))
                .copied()
                .unwrap_or_default(),
            Node::None | Node::Seed(_) => f64::NAN,
            Node::Anchor(anchor) => match (inputs.anchor)(anchor) {
                Some(px) => px.into(),
                None => anchor.fallback.as_ref()?.evaluate(inputs)?,
            },
            Node::Negate(one) => -one.evaluate(inputs)?,
            Node::Invert(one) => 1.0 / one.evaluate(inputs)?,
            Node::Sum(all) => all
                .iter()
                .try_fold(-0.0, |all, it| Some(all + it.evaluate(inputs)?))?,
            Node::Product(all) => all
                .iter()
                .try_fold(1.0, |all, it| Some(all * it.evaluate(inputs)?))?,
            Node::Call(function, modifier, all) => {
                let mut values: smallvec::SmallVec<[f64; 3]> = all
                    .iter()
                    .map(|it| it.evaluate(inputs))
                    .collect::<Option<_>>()?;
                if matches!(function, Function::Sin | Function::Cos | Function::Tan)
                    && all[0].type_with(Kind::Percentage) == Some(type_of(Kind::Number))
                {
                    values[0] = values[0].to_degrees();
                }
                call(*function, *modifier, &values)
            }
        })
    }

    /// In the canonical unit. 100% is `basis`.
    pub(crate) fn compute(&self, cx: &Ctx, basis: f64) -> f64 {
        let inputs = Inputs {
            basis,
            keywords: &[],
            anchor: &|_| None,
        };
        match self {
            Node::Value(value, unit) if *unit != Unit::Percent => unit.canonical(*value, Some(cx)),
            _ => self.simplified(Some(cx), true).evaluate(&inputs),
        }
        .unwrap_or_default()
    }

    /// Of what `parse` returns.
    pub(crate) fn is_literal(&self) -> bool {
        !matches!(self, Node::Sum(_))
    }

    /// Of what `parse` returns. `write_specified` still tells `calc(1px)` from `1px`.
    pub(crate) fn as_specified(&self, is_basis_known: bool) -> Node {
        if self.is_literal() {
            self.clone()
        } else {
            Node::Sum(vec![self.simplified(None, is_basis_known)])
        }
    }

    /// Of what `as_specified` returns.
    pub(crate) fn write_specified(&self, out: &mut Out) {
        match self {
            Node::Sum(all) if let [only] = &all[..] => only.write_as_function(out),
            literal => literal.write(out),
        }
    }

    pub(crate) fn write(&self, out: &mut Out) {
        match self {
            Node::Value(value, unit) if value.is_finite() => {
                write_double(
                    if *unit == Unit::Px {
                        value / f64::from(written_zoom())
                    } else {
                        *value
                    },
                    out,
                );
                out.extend_from_slice(unit.name().as_bytes());
            }
            Node::Keyword(..) => self.write_inner(out, false),
            Node::Sum(all) if let [only] = &all[..] => only.write_as_function(out),
            _ => self.write_as_function(out),
        }
    }

    fn write_as_function(&self, out: &mut Out) {
        let needs_calc =
            |it: Function| (Function::Sin as u8..=Function::Exp as u8).contains(&(it as u8));
        if matches!(self, Node::Call(function, ..) if !needs_calc(*function))
            || matches!(self, Node::Anchor(_))
        {
            return self.write_inner(out, false);
        }
        out.extend_from_slice(b"calc(");
        self.write_inner(out, false);
        out.push(b')');
    }

    /// As it is written in a math function.
    pub(crate) fn write_inner(&self, out: &mut Out, is_operand: bool) {
        fn sorted(all: &[Node]) -> Vec<&Node> {
            let mut all: Vec<_> = all.iter().collect();
            all.order_by_key(|it| {
                if let Node::Value(_, unit) = it {
                    (false, unit.name())
                } else {
                    (true, "")
                }
            });
            all
        }
        let needs_parentheses = is_operand
            && match self {
                Node::Value(value, unit) => !value.is_finite() && *unit != Unit::Number,
                it => matches!(
                    it,
                    Node::Sum(_) | Node::Product(_) | Node::Negate(_) | Node::Invert(_)
                ),
            };
        if needs_parentheses {
            out.push(b'(');
        }
        match self {
            Node::Value(value, _) if value.is_finite() => self.write(out),
            Node::Value(value, unit) => {
                out.extend_from_slice(if value.is_nan() {
                    b"NaN"
                } else if *value < 0.0 {
                    b"-infinity"
                } else {
                    b"infinity"
                });
                if *unit != Unit::Number {
                    out.extend_from_slice(b" * 1");
                    out.extend_from_slice(unit.name().as_bytes());
                }
            }
            Node::Keyword(_, name, _) => out.extend_from_slice(name.as_bytes()),
            Node::None | Node::Seed(_) => out.extend_from_slice(b"none"),
            Node::Negate(one) | Node::Invert(one) => {
                out.extend_from_slice(if let Node::Negate(_) = self {
                    b"-1 * "
                } else {
                    b"1 / "
                });
                one.write_inner(out, true);
            }
            Node::Sum(all) => {
                for (index, term) in sorted(all).into_iter().enumerate() {
                    match term {
                        _ if index == 0 => term.write_inner(out, true),
                        Node::Negate(inner) => {
                            out.extend_from_slice(b" - ");
                            inner.write_inner(out, true);
                        }
                        Node::Value(value, unit) if *value < 0.0 => {
                            out.extend_from_slice(b" - ");
                            Node::Value(-value, *unit).write_inner(out, true);
                        }
                        _ => {
                            out.extend_from_slice(b" + ");
                            term.write_inner(out, true);
                        }
                    }
                }
            }
            Node::Product(all) => {
                for (index, factor) in sorted(all).into_iter().enumerate() {
                    match factor {
                        _ if index == 0 => factor.write_inner(out, true),
                        Node::Invert(inner) => {
                            out.extend_from_slice(b" / ");
                            inner.write_inner(out, true);
                        }
                        _ => {
                            out.extend_from_slice(b" * ");
                            factor.write_inner(out, true);
                        }
                    }
                }
            }
            Node::Call(function, modifier, all) => {
                function.write(out);
                out.push(b'(');
                if *modifier != Modifier::Nearest {
                    modifier.write(out);
                    out.extend_from_slice(if *modifier == Modifier::NoClamp {
                        b" "
                    } else {
                        b", "
                    });
                }
                let (seed, rest) = all.split_at(usize::from(*function == Function::Random));
                match seed {
                    [Node::Seed(seed)] if seed.is_empty() => {}
                    [Node::Seed(seed)] => out.extend([seed.as_bytes(), b", "].concat()),
                    [fixed] => {
                        out.extend_from_slice(b"fixed ");
                        fixed.write_specified(out);
                        out.extend_from_slice(b", ");
                    }
                    _ => {}
                }
                write_list(rest, ", ", out, |it, out| it.write_inner(out, false));
                out.push(b')');
            }
            Node::Anchor(anchor) => {
                out.extend_from_slice(if let Measure::Size(_) = anchor.measure {
                    b"anchor-size("
                } else {
                    b"anchor("
                });
                let start = out.len();
                anchor.name.iter().for_each(|it| it.write(out));
                if out.len() > start && anchor.measure != Measure::Size(None) {
                    out.push(b' ');
                }
                match &anchor.measure {
                    Measure::Side(side) => side.write(out),
                    Measure::Percentage(it) => it.as_specified(true).write_specified(out),
                    Measure::Size(size) => size.iter().for_each(|it| it.write(out)),
                }
                if let Some(fallback) = &anchor.fallback {
                    out.extend_from_slice(if out.len() > start { b", " } else { b"" });
                    fallback.write(out);
                }
                out.push(b')');
            }
        }
        if needs_parentheses {
            out.push(b')');
        }
    }
}
