//! Computed values. `bun_css` parses, and the result is computed right away.

use core::cell::{Cell, RefCell};
use std::io::Write as _;
use std::rc::Rc;

use bun_css::css_parser::{Parser, ParserInput, ParserOpts};

use crate::abi::FontMetrics;
use crate::calc::{Inputs, Kind, Node, Options, Unit};
pub(crate) use crate::color::{Color, Interpolation, Rgba, mix_colors, with_current_color};

pub(crate) type P<'a, 'b> = Parser<'a, 'b>;
pub(crate) type Str = Rc<str>;
pub(crate) type Out = Vec<u8>;

pub(crate) fn text(bytes: &[u8]) -> &str {
    core::str::from_utf8(bytes).unwrap_or_default()
}

pub(crate) fn eq(a: &[u8], b: &str) -> bool {
    a.eq_ignore_ascii_case(b.as_bytes())
}

thread_local! {
    static ARENA: RefCell<bun_alloc::Arena> = RefCell::new(bun_alloc::Arena::new());
    /// About how much has been parsed since the arena was last looked at.
    static USES: Cell<usize> = const { Cell::new(0) };
}

pub(crate) fn with_parser<R>(source: &[u8], parse: impl FnOnce(&mut P) -> R) -> R {
    USES.set(USES.get() + source.len() + 64);
    if USES.get() > 1 << 15 {
        release_parser_memory();
    }
    ARENA.with_borrow(|arena| {
        let mut input = ParserInput::new(source, arena);
        let flags = ParserOpts::CLIP_COLORS | ParserOpts::RAW_URL_TOKENS;
        parse(&mut Parser::new(&mut input, None, flags, None))
    })
}

/// `None` if `parse` leaves anything over.
pub(crate) fn parse_all<R>(source: &[u8], parse: impl FnOnce(&mut P) -> Option<R>) -> Option<R> {
    with_parser(source, |p| parse(p).filter(|_| p.is_exhausted()))
}

pub(crate) fn release_parser_memory() {
    ARENA.with(|arena| {
        if let Ok(mut arena) = arena.try_borrow_mut() {
            USES.set(0);
            arena.reset_retain_with_limit(128 * 1024);
        }
    });
}

pub(crate) fn attempt<'b, R>(
    p: &mut P<'_, 'b>,
    parse: impl FnOnce(&mut P<'_, 'b>) -> Option<R>,
) -> Option<R> {
    let state = p.state();
    let result = parse(p);
    if result.is_none() {
        p.reset(&state);
    }
    result
}

pub(crate) fn nested<'b, R>(
    p: &mut P<'_, 'b>,
    parse: impl FnOnce(&mut P<'_, 'b>) -> Option<R>,
) -> Option<R> {
    p.parse_nested_block(|p| match parse(p) {
        Some(result) => Ok(result),
        None => Err(p.new_error_for_next_token()),
    })
    .ok()
}

pub(crate) fn ident<'b>(p: &mut P<'_, 'b>) -> Option<&'b [u8]> {
    attempt(p, |p| p.expect_ident().ok())
}

pub(crate) fn keyword(p: &mut P, name: &str) -> bool {
    attempt(p, |p| p.expect_ident_matching(name.as_bytes()).ok()).is_some()
}

pub(crate) fn function<'b>(p: &mut P<'_, 'b>) -> Option<&'b [u8]> {
    attempt(p, |p| p.expect_function().ok())
}

pub(crate) fn comma(p: &mut P) -> bool {
    attempt(p, |p| p.expect_comma().ok()).is_some()
}

pub(crate) fn delim(p: &mut P, delimiter: u8) -> bool {
    attempt(p, |p| p.expect_delim(delimiter).ok()).is_some()
}

pub(crate) fn string<'b>(p: &mut P<'_, 'b>) -> Option<&'b [u8]> {
    attempt(p, |p| p.expect_string().ok())
}

pub(crate) fn custom_ident(p: &mut P) -> Option<Str> {
    attempt(p, |p| {
        let name = p.expect_ident().ok()?;
        (!bun_css::values::ident::is_reserved_custom_ident(name)).then(|| text(name).into())
    })
}

/// In the canonical unit. Only a literal has to be `min` or more.
pub(crate) fn quantity(p: &mut P, cx: &Ctx, kind: Kind, min: f32) -> Option<f32> {
    attempt(p, |p| {
        let node = Node::parse(p, &Options::new(kind))?;
        let value = node.compute(cx, 1.0) as f32;
        let value = if kind == Kind::Length {
            finite(value)
        } else if value.is_nan() {
            0.0
        } else {
            value.clamp(f32::MIN, f32::MAX)
        };
        (value >= min || !node.is_literal()).then_some(value.max(min))
    })
}

pub(crate) fn number(p: &mut P, cx: &Ctx) -> Option<f32> {
    quantity(p, cx, Kind::Number, f32::MIN)
}

pub(crate) fn percentage(p: &mut P, cx: &Ctx) -> Option<f32> {
    quantity(p, cx, Kind::Percentage, f32::MIN)
}

pub(crate) fn number_or_percentage(p: &mut P, cx: &Ctx) -> Option<f32> {
    number(p, cx).or_else(|| percentage(p, cx))
}

pub(crate) fn integer(p: &mut P, cx: &Ctx) -> Option<i32> {
    attempt(p, |p| p.expect_integer().ok()).or_else(|| {
        attempt(p, |p| {
            let node = Node::parse(p, &Options::new(Kind::Number)).filter(|it| !it.is_literal())?;
            Some((node.compute(cx, 1.0) + 0.5).floor() as i32)
        })
    })
}

pub(crate) fn degrees(p: &mut P, cx: &Ctx) -> Option<f32> {
    quantity(p, cx, Kind::Angle, f32::MIN)
        .map(|it| it.clamp(-MAX_DEGREES, MAX_DEGREES))
        .or_else(|| attempt(p, |p| p.expect_number().ok().filter(|it| *it == 0.0)))
}

pub(crate) fn px(p: &mut P, cx: &Ctx) -> Option<f32> {
    quantity(p, cx, Kind::Length, f32::MIN)
}

pub(crate) fn fr(p: &mut P, cx: &Ctx) -> Option<f32> {
    quantity(p, cx, Kind::Flex, 0.0)
}

pub(crate) fn commas<'b, T>(
    p: &mut P<'_, 'b>,
    mut parse: impl FnMut(&mut P<'_, 'b>) -> Option<T>,
) -> Option<Vec<T>> {
    let mut items = vec![parse(p)?];
    while comma(p) {
        items.push(parse(p)?);
    }
    Some(items)
}

/// Counts as whole turns.
pub(crate) const MAX_DEGREES: f32 = 2.867_080_6e15;
pub(crate) const MAX_LENGTH: f32 = 33_554_428.0;

fn finite(value: f32) -> f32 {
    match value.is_nan() {
        true => 0.0,
        false => value.clamp(-MAX_LENGTH, MAX_LENGTH),
    }
}

pub(crate) fn write_number(value: f32, out: &mut Out) {
    write_double(value.into(), out);
}

pub(crate) fn write_channel(value: f64, out: &mut Out) {
    match value.abs() {
        1e-6..1e-4 => {
            let digits = format!("{value:.*}", (5.0 - value.abs().log10().floor()) as usize);
            out.extend_from_slice(digits.trim_end_matches('0').as_bytes());
        }
        ..1e-12 => out.push(b'0'),
        1e-12..1e-6 => _ = write!(out, "{value:.5e}"),
        _ => Node::Value(value, Unit::Number).write(out),
    }
}

/// With six significant digits.
pub(crate) fn write_double(value: f64, out: &mut Out) {
    if value == value.trunc() && value.abs() < 1e6 {
        let _ = write!(out, "{}", value as i32);
        return;
    }
    let start = out.len();
    let _ = write!(out, "{value:.5e}");
    let Some(at) = bun_core::strings::last_index_of_char(&out[start..], b'e') else {
        return;
    };
    let exponent: i32 = text(&out[start + at + 1..]).parse().unwrap_or_default();
    let is_plain = (-4..6).contains(&exponent);
    out.truncate(if is_plain { start } else { start + at });
    if is_plain {
        let _ = write!(out, "{value:.*}", (5 - exponent) as usize);
    }
    while exponent != 5 && out.last() == Some(&b'0') {
        out.pop();
    }
    if out.last() == Some(&b'.') {
        out.pop();
    }
    if !is_plain {
        let _ = write!(
            out,
            "e{}{:02}",
            if exponent < 0 { '-' } else { '+' },
            exponent.abs()
        );
    }
}

thread_local! {
    static ZOOM: Cell<f32> = const { Cell::new(1.0) };
}

/// Lets `write` take the zoom out of lengths.
pub(crate) fn with_zoom<R>(zoom: f32, run: impl FnOnce() -> R) -> R {
    let outer = ZOOM.replace(zoom);
    let result = run();
    ZOOM.set(outer);
    result
}

pub(crate) fn written_zoom() -> f32 {
    ZOOM.get()
}

pub(crate) fn write_px(value: f32, out: &mut Out) {
    write_number(value / ZOOM.get(), out);
    out.extend_from_slice(b"px");
}

pub(crate) fn write_string(value: &[u8], out: &mut Out) {
    let _ = bun_css::css_parser::serializer::serialize_string(value, out);
}

pub(crate) fn write_ident(value: &[u8], out: &mut Out) {
    let _ = bun_css::css_parser::serializer::serialize_identifier(value, out);
}

pub(crate) fn write_list<T>(
    items: &[T],
    separator: &str,
    out: &mut Out,
    mut write: impl FnMut(&T, &mut Out),
) {
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.extend_from_slice(separator.as_bytes());
        }
        write(item, out);
    }
}

// ───────────────────────────── context ─────────────────────────────

bitflags::bitflags! {
    /// What a computed value depends on, besides its text.
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct Deps: u16 {
        const ROOT = 1;
        const VIEWPORT = 1 << 1;
        /// Fonts, `color`, `color-scheme` or `zoom` of the element or of its parent.
        const INHERITED = 1 << 2;
        const CONTAINER = 1 << 3;
        const ATTRIBUTES = 1 << 4;
        const SIBLINGS = 1 << 5;
        /// `inherit` on a property that is not inherited by default.
        const PARENT = 1 << 6;
        /// `font-size` is a length that is not relative to the parent's, or a keyword.
        const ABSOLUTE_FONT_SIZE = 1 << 7;
        const FONT_SIZE_KEYWORD = 1 << 8;
        /// With `INHERITED`.
        const FONT_UNITS = 1 << 11;
        const ANCHOR = 1 << 9;
        const MATH_FONT_SIZE = 1 << 10;

        /// The same for all elements.
        const OF_DOCUMENT = Self::ROOT.bits() | Self::VIEWPORT.bits() | Self::ABSOLUTE_FONT_SIZE.bits()
            | Self::FONT_SIZE_KEYWORD.bits() | Self::ANCHOR.bits();
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct FontUnits {
    pub(crate) size: f32,
    pub(crate) weight: f32,
    pub(crate) line_height: f32,
}

/// Of the root element, without its zoom.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct RootUnits {
    pub(crate) size: f32,
    pub(crate) line_height: f32,
    /// `ex`, `ch`, `cap` and `ic`
    pub(crate) metrics: [f32; 4],
}

/// The writing mode and the direction.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct Flow(pub(crate) u8);

impl Flow {
    pub(crate) const DEFAULT: Flow = Flow(0);
    pub(crate) const COUNT: usize = 6;

    pub(crate) fn index(self) -> usize {
        self.0.into()
    }

    pub(crate) fn is_vertical(self) -> bool {
        self.0 > 1
    }

    /// Of block-start, inline-end, block-end and inline-start: 0 top, 1 right, 2 bottom or 3 left.
    pub(crate) fn sides(self) -> [usize; 4] {
        [
            [0, 1, 2, 3],
            [0, 3, 2, 1],
            [1, 2, 3, 0],
            [1, 0, 3, 2],
            [3, 2, 1, 0],
            [3, 0, 1, 2],
        ][self.index()]
    }
}

/// What relative values are relative to.
pub(crate) struct Ctx<'a> {
    pub(crate) viewport: [f32; 2],
    pub(crate) root: RootUnits,
    /// The parent's, while the font properties are computed.
    pub(crate) font: FontUnits,
    pub(crate) metrics: &'a dyn Fn() -> FontMetrics,
    pub(crate) container: &'a dyn Fn() -> [f32; 2],
    /// Its value of a property that has no type.
    pub(crate) parent: &'a dyn Fn(crate::properties::Id) -> Out,
    /// The index from 1, and the count.
    pub(crate) siblings: &'a dyn Fn() -> (usize, usize),
    pub(crate) element: u32,
    pub(crate) color: Rgba,
    pub(crate) accent: u32,
    /// With `accent-color`.
    pub(crate) dark: bool,
    pub(crate) zoom: f32,
    pub(crate) flow: Flow,
    pub(crate) base_url: &'a [u8],
    pub(crate) deps: Cell<Deps>,
}

impl Ctx<'_> {
    /// For telling whether a value is valid.
    pub(crate) fn dummy() -> Ctx<'static> {
        let font = FontUnits {
            size: 16.0,
            weight: 400.0,
            line_height: 18.0,
        };
        Ctx {
            viewport: [800.0, 600.0],
            root: RootUnits {
                size: 16.0,
                line_height: 18.0,
                metrics: [8.0, 8.0, 12.0, 16.0],
            },
            font,
            metrics: &FontMetrics::default,
            container: &|| [800.0, 600.0],
            parent: &|id| id.syntax().note("i=").unwrap_or_default().into(),
            siblings: &|| (1, 1),
            element: 0,
            color: Rgba::BLACK,
            accent: 0xff,
            dark: false,
            zoom: 1.0,
            flow: Flow::DEFAULT,
            base_url: b"",
            deps: Cell::default(),
        }
    }

    pub(crate) fn uses(&self, deps: Deps) {
        self.deps.set(self.deps.get() | deps);
    }

    pub(crate) fn px_per(&self, unit: Unit) -> f64 {
        use Unit as U;
        let font = || {
            self.uses(Deps::INHERITED | Deps::FONT_UNITS);
            self.font
        };
        let metrics = || {
            self.uses(Deps::INHERITED | Deps::FONT_UNITS);
            (self.metrics)()
        };
        let root = || {
            self.uses(Deps::ROOT);
            self.root
        };
        let viewport = || {
            self.uses(Deps::VIEWPORT);
            self.viewport.map(|size| size * self.zoom / 100.0)
        };
        let container = || {
            self.uses(Deps::CONTAINER);
            (self.container)().map(|size| size / 100.0)
        };
        let inline = || {
            self.uses(Deps::INHERITED);
            usize::from(self.flow.is_vertical())
        };
        f64::from(match unit {
            U::Em => font().size,
            U::Rem => root().size * self.zoom,
            U::Ex => metrics().x_height,
            U::Rex => root().metrics[0] * self.zoom,
            U::Ch => metrics().zero_advance,
            U::Rch => root().metrics[1] * self.zoom,
            U::Cap => metrics().cap_height,
            U::Rcap => root().metrics[2] * self.zoom,
            U::Ic => metrics().ideograph_advance,
            U::Ric => root().metrics[3] * self.zoom,
            U::Lh => font().line_height,
            U::Rlh => root().line_height * self.zoom,
            U::Vw | U::Lvw | U::Svw | U::Dvw => viewport()[0],
            U::Vi | U::Lvi | U::Svi | U::Dvi => viewport()[inline()],
            U::Vh | U::Lvh | U::Svh | U::Dvh => viewport()[1],
            U::Vb | U::Lvb | U::Svb | U::Dvb => viewport()[1 - inline()],
            U::Vmin | U::Lvmin | U::Svmin | U::Dvmin => viewport()[0].min(viewport()[1]),
            U::Vmax | U::Lvmax | U::Svmax | U::Dvmax => viewport()[0].max(viewport()[1]),
            U::Cqw => container()[0],
            U::Cqi => container()[inline()],
            U::Cqh => container()[1],
            U::Cqb => container()[1 - inline()],
            U::Cqmin => container()[0].min(container()[1]),
            U::Cqmax => container()[0].max(container()[1]),
            _ => 1.0,
        })
    }

    pub(crate) fn url(&self, url: &[u8]) -> Str {
        if self.base_url.is_empty()
            || url.is_empty()
            || url.starts_with(b"data:")
            || url.starts_with(b"#")
        {
            return text(url).into();
        }
        let base = bun_core::StringView::from_bytes(self.base_url);
        let joined = bun_url::join(&base, &bun_core::StringView::from_bytes(url));
        text(&joined.to_utf8()).into()
    }
}

pub(crate) trait Css: Sized + Clone + PartialEq {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self>;
    fn write(&self, out: &mut Out);
    fn written(&self) -> Out {
        let mut out = Out::new();
        self.write(&mut out);
        out
    }
    /// `None` if the values cannot be combined.
    fn lerp(&self, _to: &Self, _t: Mixing) -> Option<Self> {
        None
    }
}

pub(crate) fn mix(from: f32, to: f32, t: f32) -> f32 {
    from + (to - from) * t
}

/// How two values are combined.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Mixing {
    Lerp(f32),
    Add,
    Accumulate,
}

impl Mixing {
    pub(crate) fn of(self, from: f32, to: f32) -> f32 {
        if let Mixing::Lerp(t) = self {
            mix(from, to, t)
        } else {
            from + to
        }
    }

    /// For factors, which multiply.
    pub(crate) fn of_factors(self, from: f32, to: f32) -> f32 {
        match self {
            Mixing::Lerp(t) => mix(from, to, t),
            Mixing::Add => from * to,
            Mixing::Accumulate => from + to - 1.0,
        }
    }

    /// Of values that cannot be combined.
    pub(crate) fn pick<'a, T>(self, from: &'a T, to: &'a T) -> &'a T {
        if matches!(self, Mixing::Lerp(t) if t < 0.5) {
            from
        } else {
            to
        }
    }

    pub(crate) fn weights(self) -> [f32; 2] {
        if let Mixing::Lerp(t) = self {
            [1.0 - t, t]
        } else {
            [1.0; 2]
        }
    }
}

// ───────────────────────────── numbers and lengths ─────────────────────────────

impl Css for f32 {
    fn parse(p: &mut P, cx: &Ctx) -> Option<f32> {
        number(p, cx)
    }
    fn write(&self, out: &mut Out) {
        write_number(*self, out);
    }
    fn lerp(&self, to: &f32, t: Mixing) -> Option<f32> {
        Some(t.of(*self, *to))
    }
}

impl Css for i32 {
    fn parse(p: &mut P, cx: &Ctx) -> Option<i32> {
        integer(p, cx)
    }
    fn write(&self, out: &mut Out) {
        let _ = write!(out, "{self}");
    }
    fn lerp(&self, to: &i32, t: Mixing) -> Option<i32> {
        Some((t.of(*self as f32, *to as f32) + 0.5).floor() as i32)
    }
}

impl Css for Str {
    fn parse(p: &mut P, _: &Ctx) -> Option<Str> {
        custom_ident(p)
    }
    fn write(&self, out: &mut Out) {
        write_ident(self.as_bytes(), out);
    }
}

macro_rules! numeric {
    ($(#[$doc:meta])* $name:ident, $unit:literal, $scale:literal, $min:expr, |$p:ident, $cx:ident| $parse:expr) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Default, PartialEq)]
        pub(crate) struct $name(pub(crate) f32);
        impl Css for $name {
            fn parse($p: &mut P, $cx: &Ctx) -> Option<Self> {
                $parse.map($name)
            }
            fn write(&self, out: &mut Out) {
                write_number(self.0 * $scale, out);
                out.extend_from_slice($unit.as_bytes());
            }
            fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
                Some($name(t.of(self.0, to.0).max($min)))
            }
        }
    };
}

numeric!(Px, "px", 1.0, f32::MIN, |p, cx| px(p, cx));
numeric!(PositivePx, "px", 1.0, 0.0, |p, cx| quantity(
    p,
    cx,
    Kind::Length,
    0.0
));
numeric!(Positive, "", 1.0, 0.0, |p, cx| quantity(
    p,
    cx,
    Kind::Number,
    0.0
));
numeric!(Degrees, "deg", 1.0, f32::MIN, |p, cx| degrees(p, cx));
numeric!(
    /// In milliseconds.
    Time, "s", 0.001, f32::MIN, |p, cx| quantity(p, cx, Kind::Time, f32::MIN).map(|it| (it * 1000.0).clamp(f32::MIN, f32::MAX))
);
numeric!(BorderWidth, "px", 1.0, 0.0, |p, cx| match ident(p) {
    Some(name) if eq(name, "thin") => Some(cx.zoom),
    Some(name) if eq(name, "medium") => Some(3.0 * cx.zoom),
    Some(name) if eq(name, "thick") => Some(5.0 * cx.zoom),
    Some(_) => None,
    None => PositivePx::parse(p, cx).map(|width| width.0),
});

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Alpha(pub(crate) f32, f32);

impl Alpha {
    /// Animations work with what is out of range.
    pub(crate) const fn new(value: f32) -> Alpha {
        Alpha(value.clamp(0.0, 1.0), value)
    }

    pub(crate) fn clamp(&mut self) {
        self.1 = self.0;
    }
}

impl Css for Alpha {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        number_or_percentage(p, cx).map(Alpha::new)
    }
    fn write(&self, out: &mut Out) {
        write_number(self.0, out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(Alpha::new(t.of(self.1, to.1)))
    }
}

#[derive(PartialEq)]
pub(crate) enum Calc {
    /// Pixels and a fraction of the basis.
    Linear(f32, f32),
    Tree(Node),
}

/// `<length-percentage>`
#[derive(Clone, PartialEq)]
pub(crate) enum Lp {
    Px(f32),
    Fraction(f32),
    Calc(Rc<Calc>),
}

impl Lp {
    pub(crate) const ZERO: Lp = Lp::Px(0.0);

    /// Of a node that is computed.
    pub(crate) fn new(node: Node) -> Lp {
        match node {
            Node::Value(value, Unit::Percent) => Lp::Fraction(finite(value as f32) / 100.0),
            Node::Value(value, _) => Lp::Px(finite(value as f32)),
            Node::Sum(all)
                if let [Node::Value(a, unit), Node::Value(b, _)] = all[..]
                    && (a + b).is_finite() =>
            {
                let [px, percent] = if unit == Unit::Percent {
                    [b, a]
                } else {
                    [a, b]
                };
                Lp::linear(finite(px as f32), percent as f32 / 100.0)
            }
            node => Lp::Calc(Rc::new(Calc::Tree(node))),
        }
    }

    fn linear(px: f32, fraction: f32) -> Lp {
        if px == 0.0 {
            Lp::Fraction(fraction)
        } else {
            Lp::Calc(Rc::new(Calc::Linear(px, fraction)))
        }
    }

    pub(crate) fn resolve(&self, basis: f32) -> f32 {
        match self {
            Lp::Px(px) => *px,
            Lp::Fraction(fraction) => fraction * basis,
            Lp::Calc(calc) => match &**calc {
                Calc::Linear(px, fraction) => px + fraction * basis,
                Calc::Tree(node) => node.resolve(basis, 0.0, &|_| None).unwrap_or_default(),
            },
        }
    }

    pub(crate) fn node(&self) -> Node {
        let [px, percent] =
            [Unit::Px, Unit::Percent].map(|unit| move |value: f32| Node::Value(value.into(), unit));
        match self {
            Lp::Px(it) => px(*it),
            Lp::Fraction(it) => percent(it * 100.0),
            Lp::Calc(calc) => match &**calc {
                Calc::Linear(a, b) => Node::Sum(vec![percent(b * 100.0), px(*a)]),
                Calc::Tree(node) => node.clone(),
            },
        }
    }

    pub(crate) fn plus(&self, other: &Lp) -> Lp {
        Lp::new(self.node().plus(other.node()))
    }

    /// `100% - self`
    pub(crate) fn from_end(&self) -> Lp {
        Lp::new(Node::Value(100.0, Unit::Percent).plus(self.node().times(-1.0)))
    }

    pub(crate) fn positive(p: &mut P, cx: &Ctx) -> Option<Lp> {
        computed_length(p, cx, &Options::LENGTH_PERCENTAGE, true).map(Lp::new)
    }
}

pub(crate) fn computed_length(
    p: &mut P,
    cx: &Ctx,
    options: &Options,
    is_positive: bool,
) -> Option<Node> {
    attempt(p, |p| {
        let node = Node::parse(p, options)?;
        match node.simplified(Some(cx), false) {
            Node::Value(value, unit) if is_positive && value < 0.0 => {
                (!node.is_literal()).then_some(Node::Value(0.0, unit))
            }
            computed => Some(computed),
        }
    })
}

impl Node {
    /// Of a length that is computed.
    pub(crate) fn resolve(
        &self,
        basis: f32,
        size: f32,
        anchor: &dyn Fn(&crate::calc::Anchor) -> Option<f32>,
    ) -> Option<f32> {
        self.evaluate(&Inputs {
            basis: basis.into(),
            keywords: &[size.into()],
            anchor,
        })
        .map(|it| finite(it as f32))
    }

    pub(crate) fn lerp(self, to: Node, t: Mixing) -> Node {
        let [a, b] = t.weights();
        self.times(a.into()).plus(to.times(b.into()))
    }
}

impl Css for Lp {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Lp> {
        computed_length(
            p,
            cx,
            &Options {
                anchor_size: true,
                ..Options::LENGTH_PERCENTAGE
            },
            false,
        )
        .map(Lp::new)
    }
    fn write(&self, out: &mut Out) {
        self.node().write(out);
    }
    fn lerp(&self, to: &Lp, t: Mixing) -> Option<Lp> {
        Some(match (self, to) {
            (Lp::Px(a), Lp::Px(b)) => Lp::Px(t.of(*a, *b)),
            (Lp::Fraction(a), Lp::Fraction(b)) => Lp::Fraction(t.of(*a, *b)),
            _ => Lp::new(self.node().lerp(to.node(), t)),
        })
    }
}

impl Lp {
    pub(crate) fn lerp_positive(&self, to: &Lp, t: Mixing) -> Option<Lp> {
        self.lerp(to, t).map(|it| match it {
            Lp::Px(px) => Lp::Px(px.max(0.0)),
            Lp::Fraction(fraction) => Lp::Fraction(fraction.max(0.0)),
            calc => calc,
        })
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct PositiveLp(pub(crate) Lp);

impl Css for PositiveLp {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Lp::positive(p, cx).map(PositiveLp)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp_positive(&to.0, t).map(PositiveLp)
    }
}

macro_rules! optional {
    ($name:ident, $keyword:literal) => {
        #[derive(Clone, Copy, PartialEq)]
        pub(crate) struct $name<T>(pub(crate) Option<T>);
        impl<T: Css> Css for $name<T> {
            fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
                match keyword(p, $keyword) {
                    true => Some($name(None)),
                    false => T::parse(p, cx).map(|value| $name(Some(value))),
                }
            }
            fn write(&self, out: &mut Out) {
                match &self.0 {
                    Some(value) => value.write(out),
                    None => out.extend_from_slice($keyword.as_bytes()),
                }
            }
            fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
                Some($name(Some(self.0.as_ref()?.lerp(to.0.as_ref()?, t)?)))
            }
        }
    };
}
optional!(Auto, "auto");
optional!(NoneOr, "none");
optional!(Normal, "normal");

macro_rules! list {
    ($name:ident, $empty:literal, $separator:literal, |$p:ident| $more:expr) => {
        #[derive(Clone, PartialEq)]
        pub(crate) struct $name<T>(pub(crate) Rc<[T]>);
        impl<T> Default for $name<T> {
            fn default() -> Self {
                $name(Rc::default())
            }
        }
        impl<T> core::ops::Deref for $name<T> {
            type Target = [T];
            fn deref(&self) -> &[T] {
                &self.0
            }
        }
        impl<T: Css> Css for $name<T> {
            fn parse($p: &mut P, cx: &Ctx) -> Option<Self> {
                if !$empty.is_empty() && keyword($p, $empty) {
                    return Some(Self::default());
                }
                let mut items = vec![T::parse($p, cx)?];
                while $more {
                    items.push(T::parse($p, cx)?);
                }
                Some($name(items.into()))
            }
            fn write(&self, out: &mut Out) {
                if self.0.is_empty() {
                    out.extend_from_slice($empty.as_bytes());
                }
                write_list(&self.0, $separator, out, T::write);
            }
            fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
                if self.0.len() != to.0.len() {
                    return None;
                }
                let pairs = self.0.iter().zip(to.0.iter());
                pairs
                    .map(|(a, b)| a.lerp(b, t))
                    .collect::<Option<_>>()
                    .map($name)
            }
        }
    };
}
list!(Commas, "", ", ", |p| comma(p));
list!(NoneOrCommas, "none", ", ", |p| comma(p));
list!(NormalOrCommas, "normal", ", ", |p| comma(p));
list!(NoneOrSpaces, "none", " ", |p| !p.is_exhausted());

impl<T> Commas<T> {
    pub(crate) fn one(item: T) -> Self {
        Commas(Rc::new([item]))
    }

    /// The list repeats.
    pub(crate) fn at(&self, index: usize) -> &T {
        &self.0[index % self.0.len()]
    }
}

/// One value for both axes, or two.
#[derive(Clone, PartialEq)]
pub(crate) struct Pair<T>(pub(crate) T, pub(crate) T);

impl<T: Css> Css for Pair<T> {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let first = T::parse(p, cx)?;
        let second = attempt(p, |p| T::parse(p, cx)).unwrap_or_else(|| first.clone());
        Some(Pair(first, second))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
        if self.0 != self.1 {
            out.push(b' ');
            self.1.write(out);
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(Pair(self.0.lerp(&to.0, t)?, self.1.lerp(&to.1, t)?))
    }
}

/// Top, right, bottom, left, from one to four values.
pub(crate) fn sides<T: Css>(p: &mut P, cx: &Ctx) -> Option<[T; 4]> {
    let top = T::parse(p, cx)?;
    let mut next = || attempt(p, |p| T::parse(p, cx));
    let (right, bottom, left) = (next(), next(), next());
    let right = right.unwrap_or_else(|| top.clone());
    let bottom = bottom.unwrap_or_else(|| top.clone());
    let left = left.unwrap_or_else(|| right.clone());
    Some([top, right, bottom, left])
}

macro_rules! keywords {
    ($($name:ident { $($variant:ident = $first:literal $(| $alias:literal)*),+ $(,)? })+) => {$(
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub(crate) enum $name { $($variant),+ }
        impl $name {
            pub(crate) fn from_name(name: &[u8]) -> Option<Self> {
                $(if $crate::values::eq(name, $first) $(|| $crate::values::eq(name, $alias))* {
                    return Some($name::$variant);
                })+
                None
            }

            #[allow(dead_code)]
            pub(crate) fn name(self) -> &'static str {
                match self { $($name::$variant => $first),+ }
            }
        }
        impl $crate::values::Css for $name {
            fn parse(p: &mut $crate::values::P, _: &$crate::values::Ctx) -> Option<Self> {
                $crate::values::attempt(p, |p| Self::from_name(p.expect_ident().ok()?))
            }
            fn write(&self, out: &mut $crate::values::Out) {
                out.extend_from_slice(self.name().as_bytes());
            }
        }
    )+};
}
pub(crate) use keywords;

/// Keywords in any order, or the one that stands for none of them.
macro_rules! flags {
    ($name:ident, $empty:literal { $($flag:ident = $bit:literal $keyword:literal),+ $(,)? }) => {
        bitflags::bitflags! {
            #[derive(Clone, Copy, Default, PartialEq, Eq)]
            pub(crate) struct $name: u32 { $(const $flag = 1 << $bit;)+ }
        }
        impl $crate::values::Css for $name {
            fn parse(p: &mut $crate::values::P, _: &$crate::values::Ctx) -> Option<Self> {
                if $crate::values::keyword(p, $empty) {
                    return Some(Self::empty());
                }
                let mut flags = Self::empty();
                loop {
                    $(if $crate::values::keyword(p, $keyword) {
                        flags |= Self::$flag;
                        continue;
                    })+
                    return (!flags.is_empty()).then_some(flags);
                }
            }
            fn write(&self, out: &mut $crate::values::Out) {
                if self.is_empty() {
                    return out.extend_from_slice($empty.as_bytes());
                }
                let start = out.len();
                $(if self.contains(Self::$flag) {
                    if out.len() > start {
                        out.push(b' ');
                    }
                    out.extend_from_slice($keyword.as_bytes());
                })+
            }
        }
    };
}
pub(crate) use flags;

/// A value that is only passed on, or only read back.
#[derive(Clone, PartialEq)]
pub(crate) struct Raw(pub(crate) Str);

impl Css for Raw {
    fn parse(p: &mut P, _: &Ctx) -> Option<Raw> {
        p.skip_whitespace();
        let start = p.position();
        while p.next().is_ok() {}
        let source = p.slice_from(start).trim_ascii();
        (!source.is_empty()).then(|| Raw(text(source).into()))
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(self.0.as_bytes());
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Size {
    /// `auto`, or `none` for a maximum.
    Auto,
    Length(Lp),
    MinContent,
    MaxContent,
    FitContent,
    Stretch,
    /// Only for `flex-basis`.
    Content,
    /// Only for the basis of `calc-size()`.
    Any,
    /// `calc-size()`: the basis, and the calculation.
    Calc(Rc<(Size, Node)>),
    Anchor(Rc<Node>),
}

const SIZE: Node = Node::Keyword(0, "size", Kind::Length);

impl Size {
    fn parse_with(p: &mut P, cx: &Ctx, auto: &str) -> Option<Size> {
        if let Some(name) = ident(p) {
            let name = name.strip_prefix(b"-webkit-").unwrap_or(name);
            return Some(match () {
                () if eq(name, auto) => Size::Auto,
                () if eq(name, "min-content") => Size::MinContent,
                () if eq(name, "max-content") => Size::MaxContent,
                () if eq(name, "fit-content") => Size::FitContent,
                () if eq(name, "stretch") || eq(name, "fill-available") => Size::Stretch,
                () if eq(name, "content") => Size::Content,
                () => return None,
            });
        }
        if let Some(node) = computed_length(
            p,
            cx,
            &Options {
                anchor_size: true,
                ..Options::LENGTH_PERCENTAGE
            },
            true,
        ) {
            return Some(Size::new(node));
        }
        eq(function(p)?, "calc-size").then_some(())?;
        nested(p, |p| {
            let basis = if keyword(p, "any") {
                Size::Any
            } else {
                Size::parse_with(p, cx, auto)?
            };
            comma(p).then_some(())?;
            let size = Size::Calc(Rc::new((
                basis,
                Node::parse_sum(p, &Options::CALC_SIZE)?.simplified(Some(cx), false),
            )));
            if let Size::Anchor(_) = size.basis() {
                Some(Size::new(size.canonical()?.1))
            } else {
                Some(size)
            }
        })
    }

    fn new(node: Node) -> Size {
        if node.has_anchor() {
            Size::Anchor(Rc::new(node))
        } else {
            Size::Length(Lp::new(node))
        }
    }

    /// What is at the bottom of `calc-size()`.
    pub(crate) fn basis(&self) -> &Size {
        if let Size::Calc(calc) = self {
            calc.0.basis()
        } else {
            self
        }
    }

    /// https://drafts.csswg.org/css-values-5/#calc-size-canonicalize-for-interpolation. `None` if it gets too long.
    fn canonical(&self) -> Option<(Size, Node)> {
        Some(match self {
            Size::Length(length) => (Size::Any, length.node()),
            Size::Anchor(node) => (Size::Any, Node::clone(node)),
            Size::Calc(calc) => {
                let (basis, inner) = calc.0.canonical()?;
                (inner.count() * calc.1.count() < 1 << 12).then_some(())?;
                let is_fraction = matches!(&calc.0, Size::Length(it) if !matches!(it, Lp::Px(_)));
                (
                    if is_fraction {
                        Size::Length(Lp::Fraction(1.0))
                    } else {
                        basis
                    },
                    calc.1.with_keyword(&inner).simplified(None, false),
                )
            }
            keyword => (keyword.clone(), SIZE),
        })
    }

    fn write_with(&self, out: &mut Out, auto: &str) {
        let rest = match self {
            Size::Auto => auto,
            Size::Length(length) => return length.write(out),
            Size::MinContent => "min-content",
            Size::MaxContent => "max-content",
            Size::FitContent => "fit-content",
            Size::Stretch => "stretch",
            Size::Content => "content",
            Size::Any => "any",
            Size::Anchor(node) => return node.write(out),
            Size::Calc(calc) => {
                out.extend_from_slice(b"calc-size(");
                calc.0.write_with(out, auto);
                out.extend_from_slice(b", ");
                calc.1.write_inner(out, false);
                ")"
            }
        };
        out.extend_from_slice(rest.as_bytes());
    }
}

impl Css for Size {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Size> {
        Size::parse_with(p, cx, "auto")
    }
    fn write(&self, out: &mut Out) {
        self.write_with(out, "auto");
    }
    fn lerp(&self, to: &Size, t: Mixing) -> Option<Size> {
        match (self, to) {
            (Size::Length(a), Size::Length(b)) => a.lerp_positive(b, t).map(Size::Length),
            _ => {
                let has_calc = [self, to].iter().any(|it| matches!(it, Size::Calc(_)));
                let has_keyword = [self, to]
                    .iter()
                    .any(|it| !matches!(it, Size::Calc(_) | Size::Length(_) | Size::Anchor(_)));
                (has_calc || !has_keyword || ALLOWS_KEYWORDS.get()).then_some(())?;
                let ((from_basis, from), (to_basis, to)) = (self.canonical()?, to.canonical()?);
                (from_basis == Size::Any || to_basis == Size::Any || from_basis == to_basis)
                    .then_some(())?;
                let [a, b] = t.weights();
                let weighted = |node: Node, by: f32| match matches!(t, Mixing::Lerp(_))
                    && (node == SIZE || matches!(node, Node::Sum(_)))
                {
                    true => Node::Product(vec![Node::Value(by.into(), Unit::Number), node]),
                    false => node.times(by.into()),
                };
                let (basis, mixed) = (
                    if from_basis == Size::Any {
                        to_basis
                    } else {
                        from_basis
                    },
                    weighted(from, a).plus(weighted(to, b)),
                );
                Some(if mixed.has_anchor() {
                    Size::new(mixed)
                } else {
                    Size::Calc(Rc::new((basis, mixed)))
                })
            }
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct MaxSize(pub(crate) Size);

impl Css for MaxSize {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Size::parse_with(p, cx, "none").map(MaxSize)
    }
    fn write(&self, out: &mut Out) {
        self.0.write_with(out, "none");
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        (self.0 != Size::Auto && to.0 != Size::Auto).then_some(())?;
        self.0.lerp(&to.0, t).map(MaxSize)
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct FlexBasis(pub(crate) Size);

impl Css for FlexBasis {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Size::parse(p, cx).map(FlexBasis)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(FlexBasis)
    }
}

// ───────────────────────────── positions ─────────────────────────────

#[derive(Clone, PartialEq)]
pub(crate) struct Position(pub(crate) Lp, pub(crate) Lp);

impl Position {
    pub(crate) const CENTER: Position = Position(Lp::Fraction(0.5), Lp::Fraction(0.5));

    pub(crate) fn resolve(&self, width: f32, height: f32) -> [f32; 2] {
        [self.0.resolve(width), self.1.resolve(height)]
    }
}

impl Position {
    /// Of one or two values.
    pub(crate) fn parse_short(p: &mut P, cx: &Ctx) -> Option<Position> {
        Position::parse_with(p, cx, false)
    }

    fn parse_with(p: &mut P, cx: &Ctx, has_offsets: bool) -> Option<Position> {
        keywords! { Edge { Left = "left", Top = "top", Right = "right", Bottom = "bottom", Center = "center" } }
        let of = |edge: Option<Edge>, offset: Option<Lp>| match (edge, offset) {
            (Some(Edge::Right | Edge::Bottom), offset) => {
                offset.unwrap_or(Lp::Fraction(0.0)).from_end()
            }
            (_, Some(offset)) => offset,
            (edge, None) => Lp::Fraction(if edge == Some(Edge::Center) { 0.5 } else { 0.0 }),
        };
        let part = |p: &mut P| {
            let edge = Edge::parse(p, cx);
            Some((
                edge,
                if edge.is_none() || has_offsets {
                    Lp::parse(p, cx)
                } else {
                    None
                },
            ))
            .filter(|it| *it != (None, None))
        };
        let (first, center) = (part(p)?, || (Some(Edge::Center), None));
        let state = p.state();
        let (first, second) = match (first, part(p)) {
            (first @ (Some(_), _), Some(second @ (Some(_), _))) => (first, second),
            (first @ (None, _), Some(second)) => (first, second),
            ((edge @ Some(_), offset @ Some(_)), _) => {
                p.reset(&state);
                ((edge, None), (None, offset))
            }
            (first, second) => (first, second.unwrap_or_else(center)),
        };
        let is_swapped = matches!(first.0, Some(Edge::Top | Edge::Bottom))
            || matches!(second.0, Some(Edge::Left | Edge::Right));
        let (x, y) = if is_swapped {
            (second, first)
        } else {
            (first, second)
        };
        Some(Position(of(x.0, x.1), of(y.0, y.1)))
    }
}

impl Css for Position {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Position> {
        Position::parse_with(p, cx, true)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
        out.push(b' ');
        self.1.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(Position(self.0.lerp(&to.0, t)?, self.1.lerp(&to.1, t)?))
    }
}

/// `background-position-x` or `-y`.
#[derive(Clone, PartialEq)]
pub(crate) struct AxisPosition(pub(crate) Lp);

impl Css for AxisPosition {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let Some(name) = ident(p) else {
            return Lp::parse(p, cx).map(AxisPosition);
        };
        if eq(name, "center") {
            return Some(AxisPosition(Lp::Fraction(0.5)));
        }
        let is_end = eq(name, "right") || eq(name, "bottom");
        if !is_end && !eq(name, "left") && !eq(name, "top") {
            return None;
        }
        let offset = Lp::parse(p, cx).unwrap_or(Lp::Fraction(0.0));
        Some(AxisPosition(if is_end {
            offset.from_end()
        } else {
            offset
        }))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(AxisPosition)
    }
}

keywords! { Composite { Replace = "replace", Add = "add", Accumulate = "accumulate" } }

impl Composite {
    pub(crate) fn mixing(self) -> Option<Mixing> {
        [None, Some(Mixing::Add), Some(Mixing::Accumulate)][self as usize]
    }
}

thread_local! {
    /// `interpolate-size` of the element whose values are being interpolated.
    pub(crate) static ALLOWS_KEYWORDS: Cell<bool> = const { Cell::new(false) };
}

pub(crate) fn url(p: &mut P, cx: &Ctx) -> Option<Str> {
    link(p).map(|it| cx.url(it.0))
}

/// The URL, and where the request modifiers are.
pub(crate) fn link<'a>(p: &mut P<'_, 'a>) -> Option<(&'a [u8], &'a [u8])> {
    attempt(p, |p| p.expect_url().ok())
        .map(|it| (it, &b""[..]))
        .or_else(|| {
            attempt(p, |p| {
                eq(function(p)?, "url").then_some(())?;
                nested(p, |p| {
                    let (url, start) = (string(p)?, p.position());
                    while p.next().is_ok() {}
                    Some((url, p.slice_from(start)))
                })
            })
        })
}

pub(crate) fn write_url(url: &str, out: &mut Out) {
    out.extend_from_slice(b"url(");
    write_string(url.as_bytes(), out);
    out.push(b')');
}
