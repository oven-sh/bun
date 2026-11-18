//! Media queries, container queries and the conditions of `@supports` and `if()`.

use bun_css::Token;
use bun_css::css_parser::Delimiters;

use crate::calc::{Kind, Node, Options};
use crate::grammar::{Mode, definition, is_reserved};
use crate::name::{Name, name};
use crate::selector_parser;
use crate::sheet::{Declared, Within, supports_declaration};
use crate::values::*;

keywords! {
    Feature {
        Width = "width", Height = "height", DeviceWidth = "device-width", DeviceHeight = "device-height",
        InlineSize = "inline-size", BlockSize = "block-size",
        AspectRatio = "aspect-ratio", DeviceAspectRatio = "device-aspect-ratio",
        Resolution = "resolution", PixelRatio = "-webkit-device-pixel-ratio",
        Color = "color", ColorIndex = "color-index", Monochrome = "monochrome",
        HorizontalSegments = "horizontal-viewport-segments", VerticalSegments = "vertical-viewport-segments",
        Grid = "grid", Transform3d = "-webkit-transform-3d",
        Orientation = "orientation", Scan = "scan", Update = "update", OverflowBlock = "overflow-block",
        OverflowInline = "overflow-inline", ColorGamut = "color-gamut", DynamicRange = "dynamic-range", Pointer = "pointer",
        AnyPointer = "any-pointer", Hover = "hover", AnyHover = "any-hover", Scripting = "scripting",
        DisplayMode = "display-mode", DevicePosture = "device-posture", ForcedColors = "forced-colors",
        PrefersColorScheme = "prefers-color-scheme", PrefersContrast = "prefers-contrast",
        PrefersReducedMotion = "prefers-reduced-motion", PrefersReducedTransparency = "prefers-reduced-transparency",
        Stuck = "stuck", Snapped = "snapped", Scrollable = "scrollable", Scrolled = "scrolled",
    }
}

impl Feature {
    fn is_range(self) -> bool {
        self as u8 <= Feature::VerticalSegments as u8
    }

    fn keywords(self) -> &'static str {
        use Feature as F;
        match self {
            F::Orientation => "portrait landscape",
            F::Scan => "interlace progressive",
            F::Update => "none slow fast",
            F::OverflowBlock => "none scroll paged",
            F::OverflowInline => "none scroll",
            F::ColorGamut => "srgb p3 rec2020",
            F::DynamicRange => "standard high",
            F::Pointer | F::AnyPointer => "none coarse fine",
            F::Hover | F::AnyHover => "none hover",
            F::Scripting => "none initial-only enabled",
            F::DisplayMode => {
                "fullscreen standalone minimal-ui browser window-controls-overlay picture-in-picture tabbed"
            }
            F::DevicePosture => "continuous folded",
            F::ForcedColors => "none active",
            F::PrefersColorScheme => "light dark",
            F::PrefersContrast => "no-preference more less custom",
            F::PrefersReducedMotion | F::PrefersReducedTransparency => "no-preference reduce",
            F::Stuck => "none top right bottom left block-start inline-start block-end inline-end",
            F::Snapped => "none x y block inline both",
            F::Scrollable | F::Scrolled => {
                "none top right bottom left block-start inline-start block-end inline-end x y block inline"
            }
            _ => "",
        }
    }

    fn operand(self, p: &mut P, out: &mut Out) -> Option<Operand> {
        use Feature as F;
        let mut numeric = |p: &mut P, kind, syntax| {
            let state = p.state();
            out.extend(definition(syntax)?.write_from(p, Mode::Specified)?);
            (!delim(p, b'/')).then_some(())?;
            p.reset(&state);
            let (start, node) = (p.position(), Node::parse(p, &Options::new(kind)));
            node.filter(|_| !crate::calc::has_random(p.slice_from(start)))
        };
        Some(match self {
            F::AspectRatio | F::DeviceAspectRatio => {
                let width = numeric(p, Kind::Number, "<ratio>")?;
                let height = if delim(p, b'/') {
                    Node::parse(p, &Options::new(Kind::Number))?
                } else {
                    Node::ONE
                };
                Operand::Ratio(width, height)
            }
            F::Resolution => Operand::Number(numeric(p, Kind::Resolution, "<mq-resolution>")?),
            F::PixelRatio | F::Transform3d => {
                Operand::Number(numeric(p, Kind::Number, "<mq-number>")?)
            }
            F::Grid => Operand::Integer(numeric(p, Kind::Number, "<mq-boolean>")?),
            _ if (self as u8) < F::AspectRatio as u8 => {
                Operand::Number(numeric(p, Kind::Length, "<mq-length>")?)
            }
            _ if self.is_range() => Operand::Integer(numeric(p, Kind::Number, "<mq-integer>")?),
            _ => {
                let name = ident(p)?.to_ascii_lowercase();
                self.keywords()
                    .split_ascii_whitespace()
                    .any(|it| it.as_bytes() == name)
                    .then_some(())?;
                out.extend(&name);
                Operand::Keyword(Name::new(&name))
            }
        })
    }
}

pub(crate) enum Actual {
    Number(f32),
    Keyword(Name),
}

pub(crate) enum Operand {
    Number(Node),
    Integer(Node),
    Ratio(Node, Node),
    Keyword(Name),
}

/// Whether less, equal and greater are true.
#[derive(Clone, Copy)]
pub(crate) struct Comparison([bool; 3]);

impl Comparison {
    const EQUAL: Comparison = Comparison([false, true, false]);

    fn parse(p: &mut P, out: &mut Out) -> Option<Comparison> {
        attempt(p, |p| {
            let Token::Delim(first @ 0x3c..=0x3e) = *p.next().ok()? else {
                return None;
            };
            let is_equal = |p: &mut P| {
                matches!(p.next_including_whitespace().ok()?, Token::Delim(0x3d)).then_some(())
            };
            let or_equal = first != 0x3d && attempt(p, is_equal).is_some();
            out.extend([b' ', first as u8]);
            out.extend_from_slice(if or_equal { b"= " } else { b" " });
            Some(Comparison([
                first == 0x3c,
                first == 0x3d || or_equal,
                first == 0x3e,
            ]))
        })
    }

    fn flipped(self) -> Comparison {
        Comparison([self.0[2], self.0[1], self.0[0]])
    }

    pub(crate) fn holds(self, a: f64, b: f64, tolerance: f64) -> bool {
        self.0[if a == b || (a - b).abs() <= tolerance {
            1
        } else if a < b {
            0
        } else {
            2
        }]
    }
}

pub(crate) enum Condition {
    Constant(Option<bool>),
    Not(Box<Condition>),
    All(Vec<Condition>),
    Any(Vec<Condition>),
    Boolean(Feature),
    Compare(Feature, Comparison, Operand),
    Style(Name, Option<Declared>),
    /// Each is the name of a custom property, or a value.
    StyleRange(Vec<Result<Name, Declared>>, Vec<Comparison>),
    /// `None` is any.
    ScrollState(Feature, Option<Name>),
    Fallback(Option<Out>),
    /// In `if()`.
    Media(Box<Condition>),
}

pub(crate) trait Subject {
    fn feature(&self, feature: Feature) -> Option<Actual>;
    fn compute(&self, value: &Node) -> f64;
    /// Of what only a container or an element can answer.
    fn other(&self, _condition: &Condition) -> Option<bool> {
        None
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Of {
    Media,
    Container,
    Style,
    ScrollState,
    Anchored,
    Supports,
    If,
}

fn rest<'a>(p: &mut P<'_, 'a>) -> Option<&'a [u8]> {
    p.skip_whitespace();
    let start = p.position();
    p.expect_no_error_token().ok()?;
    Some(p.slice_from(start).trim_ascii_end())
}

fn feature(p: &mut P, of: Of, out: &mut Out) -> Option<Condition> {
    let known = |name: &[u8]| {
        Feature::from_name(name).filter(|it| match (of, it) {
            (Of::ScrollState, it) => *it as u8 >= Feature::Stuck as u8,
            (_, Feature::InlineSize | Feature::BlockSize) => of == Of::Container,
            (_, Feature::Width | Feature::Height | Feature::AspectRatio | Feature::Orientation) => {
                true
            }
            (_, it) => of == Of::Media && (*it as u8) < Feature::Stuck as u8,
        })
    };
    let (state, start) = (p.state(), out.len());
    if let Some(name) = ident(p).map(<[u8]>::to_ascii_lowercase) {
        out.extend(&name);
        if p.is_exhausted() {
            return known(&name).map(|it| {
                if of == Of::ScrollState {
                    Condition::ScrollState(it, None)
                } else {
                    Condition::Boolean(it)
                }
            });
        }
        if attempt(p, |p| p.expect_colon().ok()).is_some() {
            out.extend_from_slice(b": ");
            let (vendor, plain) = name.split_at(if name.starts_with(b"-webkit-") { 8 } else { 0 });
            let limit = [
                (b"min-", [false, true, true]),
                (b"max-", [true, true, false]),
            ]
            .into_iter()
            .find(|it| plain.starts_with(it.0));
            let feature = match limit {
                Some(_) => known(&[vendor, &plain[4..]].concat())
                    .filter(|it| it.is_range() && plain[4] != b'-')?,
                None => known(&name)?,
            };
            return Some(match feature.operand(p, out)? {
                Operand::Keyword(value) if of == Of::ScrollState => {
                    Condition::ScrollState(feature, Some(value))
                }
                operand => Condition::Compare(
                    feature,
                    limit.map_or(Comparison::EQUAL, |it| Comparison(it.1)),
                    operand,
                ),
            });
        }
        if let Some(feature) = known(&name).filter(|it| it.is_range()) {
            return Some(Condition::Compare(
                feature,
                Comparison::parse(p, out)?,
                feature.operand(p, out)?,
            ));
        }
    }
    p.reset(&state);
    while Comparison::parse(p, out).is_none() {
        p.next().ok()?;
    }
    let feature = known(ident(p)?).filter(|it| it.is_range())?;
    p.reset(&state);
    out.truncate(start);
    let (low, first) = (feature.operand(p, out)?, Comparison::parse(p, out)?);
    out.extend(ident(p)?.to_ascii_lowercase());
    let low = Condition::Compare(feature, first.flipped(), low);
    let Some(second) = Comparison::parse(p, out) else {
        return Some(low);
    };
    (first.0[0] == second.0[0] && first.0[2] == second.0[2] && first.0[0] != first.0[2])
        .then_some(())?;
    Some(Condition::All(vec![
        low,
        Condition::Compare(feature, second, feature.operand(p, out)?),
    ]))
}

fn style(p: &mut P, out: &mut Out) -> Option<Condition> {
    let state = p.state();
    if let Some(name) = ident(p).filter(|it| it.starts_with(b"--")) {
        let is_alone = p.is_exhausted();
        if is_alone || attempt(p, |p| p.expect_colon().ok()).is_some() {
            write_ident(name, out);
            if is_alone {
                return Some(Condition::Style(Name::new(name), None));
            }
            let value = crate::scan::without_priority(rest(p)?).0;
            out.extend([b": ", value].concat());
            return Some(Condition::Style(
                Name::new(name),
                Some(Declared::custom(value)?),
            ));
        }
    }
    p.reset(&state);
    let (mut operands, mut comparisons) = (Vec::new(), Vec::new());
    loop {
        p.skip_whitespace();
        let (start, mut written) = (p.position(), Out::new());
        let (source, comparison) = loop {
            let source = p.slice_from(start).trim_ascii_end();
            match Comparison::parse(p, &mut written) {
                None if p.next().is_ok() => p.skip_whitespace(),
                found => break (source, found),
            }
        };
        (!source.is_empty()).then_some(())?;
        out.extend([source, &written].concat());
        let name = parse_all(source, |p| {
            ident(p).filter(|it| it.starts_with(b"--")).map(Name::new)
        });
        operands.push(match name {
            Some(name) => Ok(name),
            None => Err(Declared::custom(source)?),
        });
        match comparison {
            Some(comparison) => comparisons.push(comparison),
            None => break,
        }
    }
    let is_ordered =
        |a: &Comparison, b: &Comparison| a.0[0] == b.0[0] && a.0[2] == b.0[2] && a.0[0] != a.0[2];
    (matches!(comparisons[..], [_]) || matches!(&comparisons[..], [a, b] if is_ordered(a, b)))
        .then_some(Condition::StyleRange(operands, comparisons))
}

fn fallback(p: &mut P, out: &mut Out) -> Option<Condition> {
    keyword(p, "fallback").then_some(())?;
    out.extend_from_slice(b"fallback");
    if p.is_exhausted() {
        return Some(Condition::Fallback(None));
    }
    p.expect_colon().ok()?;
    let value = definition("<anchored-fallback>")?.write_from(p, Mode::Specified)?;
    out.extend([b": ", &value[..]].concat());
    Some(Condition::Fallback(Some(value)))
}

fn supports_function(name: &[u8], p: &mut P, namespaces: selector_parser::Parser) -> Option<bool> {
    const AT_RULES: &str = "container counter-style font-face font-feature-values font-palette-values function import keyframes layer \
        media namespace page position-try property scope starting-style supports view-transition -webkit-keyframes annotation \
        character-variant ornaments styleset stylistic swash top-left-corner top-left top-center top-right top-right-corner \
        bottom-left-corner bottom-left bottom-center bottom-right bottom-right-corner left-top left-middle left-bottom right-top \
        right-middle right-bottom";
    let is_in = |all: &str, name: &[u8]| all.split_ascii_whitespace().any(|it| eq(name, it));
    Some(match () {
        () if eq(name, "selector") => {
            selector_parser::Parser {
                is_strict: true,
                ..namespaces
            }
            .parse(rest(p)?)?
            .len()
                == 1
        }
        () if eq(name, "font-format") => {
            is_in("collection opentype truetype woff woff2", ident(p)?)
        }
        () if eq(name, "font-tech") => is_in(
            "features-opentype features-aat color-colrv0 color-colrv1 color-sbix color-cbdt variations palettes",
            ident(p)?,
        ),
        () if eq(name, "at-rule") => {
            matches!(*p.next().ok()?, Token::AtKeyword(name) if is_in(AT_RULES, name))
        }
        () if eq(name, "named-feature") => is_in("anchor-position-follows-transforms", ident(p)?),
        () => return None,
    })
}

fn declaration(p: &mut P, is_quirky: bool) -> Option<Condition> {
    let name = ident(p)?;
    p.expect_colon().ok()?;
    let value = crate::scan::without_priority(rest(p)?).0;
    Some(Condition::Constant(Some(supports_declaration(
        name,
        value,
        if is_quirky {
            Within::Quirks
        } else {
            Within::Style
        },
    ))))
}

struct Reader<'a> {
    out: Out,
    depth: u8,
    selectors: selector_parser::Parser<'a>,
}

impl Reader<'_> {
    fn new() -> Self {
        Reader {
            out: Out::new(),
            depth: 0,
            selectors: Default::default(),
        }
    }

    fn condition(&mut self, p: &mut P, of: Of, allows_or: bool) -> Option<Condition> {
        if keyword(p, "not") {
            self.out.extend_from_slice(b"not ");
            return Some(Condition::Not(Box::new(self.in_parentheses(p, of)?)));
        }
        let mut all = vec![self.in_parentheses(p, of)?];
        let operator = if allows_or && keyword(p, "or") {
            "or"
        } else if keyword(p, "and") {
            "and"
        } else {
            return all.pop();
        };
        loop {
            self.out.extend([" ", operator, " "].concat().bytes());
            all.push(self.in_parentheses(p, of)?);
            if !keyword(p, operator) {
                return Some(if operator == "or" {
                    Condition::Any(all)
                } else {
                    Condition::All(all)
                });
            }
        }
    }

    /// A condition, or else what it is made of.
    fn inside(&mut self, p: &mut P, of: Of) -> Option<Condition> {
        let start = self.out.len();
        attempt(p, |p| {
            self.condition(p, of, true).filter(|_| p.is_exhausted())
        })
        .or_else(|| {
            self.out.truncate(start);
            match of {
                Of::Style => style(p, &mut self.out),
                Of::Anchored => fallback(p, &mut self.out),
                Of::Supports => declaration(p, self.selectors.is_quirky),
                Of::If => None,
                _ => feature(p, of, &mut self.out),
            }
        })
    }

    fn in_parentheses(&mut self, p: &mut P, of: Of) -> Option<Condition> {
        p.skip_whitespace();
        let (position, start) = (p.position(), self.out.len());
        let name = match *p.next().ok()? {
            Token::OpenParen => &b""[..],
            Token::Function(name) => name,
            _ => return None,
        };
        let inner = match of {
            _ if name.is_empty() => Some(of),
            Of::Container | Of::If if eq(name, "style") => Some(Of::Style),
            Of::Container if eq(name, "scroll-state") => Some(Of::ScrollState),
            Of::Container if eq(name, "anchored") => Some(Of::Anchored),
            Of::If if eq(name, "media") => Some(Of::Media),
            Of::If if eq(name, "supports") => Some(Of::Supports),
            _ => None,
        };
        self.out.extend(name.to_ascii_lowercase());
        self.out.push(b'(');
        self.depth += 1;
        let known = nested(p, |p| {
            let known = attempt(p, |p| match inner {
                _ if self.depth > 64 => None,
                Some(Of::Media) if of == Of::If => {
                    let query = attempt(p, |p| self.media_query(p).filter(|_| p.is_exhausted()))
                        .or_else(|| feature(p, Of::Media, &mut self.out));
                    query
                        .filter(|_| p.is_exhausted())
                        .map(|it| Condition::Media(Box::new(it)))
                }
                Some(inner) => self.inside(p, inner).filter(|_| p.is_exhausted()),
                None if of == Of::Supports => supports_function(name, p, self.selectors)
                    .filter(|_| p.is_exhausted())
                    .map(|it| Condition::Constant(Some(it))),
                None => None,
            });
            (known.is_some() || rest(p).is_some()).then_some(known)
        });
        self.depth -= 1;
        self.out.push(b')');
        known?.or_else(|| {
            self.out.truncate(start);
            self.out.extend_from_slice(p.slice_from(position));
            Some(Condition::Constant((of == Of::Supports).then_some(false)))
        })
    }

    fn media_query(&mut self, p: &mut P) -> Option<Condition> {
        let start = self.out.len();
        if let Some(condition) = attempt(p, |p| self.condition(p, Of::Media, true)) {
            return Some(condition);
        }
        self.out.truncate(start);
        let qualifier = ["not", "only"].into_iter().find(|it| keyword(p, it));
        let kind = ident(p)
            .filter(|it| {
                !["only", "not", "and", "or", "layer"]
                    .iter()
                    .any(|word| eq(it, word))
            })?
            .to_ascii_lowercase();
        let mut all = vec![Condition::Constant(Some(
            kind == b"all" || kind == b"screen",
        ))];
        let has_condition = keyword(p, "and");
        self.out
            .extend(qualifier.into_iter().flat_map(|it| it.bytes().chain(*b" ")));
        if qualifier.is_some() || kind != b"all" || !has_condition {
            write_ident(&kind, &mut self.out);
            self.out
                .extend_from_slice(if has_condition { b" and " } else { b"" });
        }
        if has_condition {
            all.push(self.condition(p, Of::Media, false)?);
        }
        Some(if qualifier == Some("not") {
            Condition::Not(Box::new(Condition::All(all)))
        } else {
            Condition::All(all)
        })
    }
}

/// With what each query is written as.
pub(crate) fn media_list(source: &[u8]) -> (Condition, Vec<Out>) {
    with_parser(source, |p| {
        if p.is_exhausted() {
            return (Condition::Constant(Some(true)), Vec::new());
        }
        let (mut queries, mut texts) = (Vec::new(), Vec::new());
        loop {
            let mut reader = Reader::new();
            let query = p.parse_until_before(Delimiters::COMMA, |p| {
                reader
                    .media_query(p)
                    .ok_or_else(|| p.new_error_for_next_token())
            });
            texts.push(if query.is_ok() {
                reader.out
            } else {
                b"not all".to_vec()
            });
            queries.extend(query);
            if p.next().is_err() {
                return (Condition::Any(queries), texts);
            }
        }
    })
}

/// <https://html.spec.whatwg.org/#parse-a-sizes-attribute>
pub(crate) fn source_size(source: &[u8], media: &dyn Subject) -> Option<f32> {
    let mut entries = Vec::new();
    with_parser(source, |p| {
        let (mut start, mut last) = (0, 0);
        loop {
            p.skip_whitespace();
            let at = p.position();
            match p.next() {
                Ok(Token::Comma) => {
                    entries.push((start, last, at));
                    (start, last) = (at + 1, at + 1);
                }
                Ok(_) => last = at,
                Err(_) => break entries.push((start, last, source.len())),
            }
        }
    });
    entries.into_iter().find_map(|(start, last, end)| {
        let length = parse_all(&source[last..end], |p| {
            Node::parse(p, &Options::new(Kind::Length))
        })?;
        let size = media.compute(&length) as f32;
        if !size.is_finite() || size < 0.0 && length.is_literal() {
            return None;
        }
        let holds = parse_all(&source[start..last], |p| {
            if p.is_exhausted() {
                return Some(true);
            }
            Reader::new().condition(p, Of::Media, true)?.evaluate(media)
        })?;
        holds.then_some(size.max(0.0))
    })
}

/// `None` if it is invalid.
pub(crate) fn supports(source: &[u8], selectors: selector_parser::Parser) -> Option<bool> {
    parse_all(source, |p| {
        Reader {
            selectors,
            ..Reader::new()
        }
        .condition(p, Of::Supports, true)
    })?
    .evaluate(&())
}

/// In `@import`, where it may be a declaration.
pub(crate) fn supports_import(source: &[u8]) -> Option<bool> {
    parse_all(source, |p| Reader::new().inside(p, Of::Supports))?.evaluate(&())
}

pub(crate) fn if_condition(p: &mut P) -> Option<Condition> {
    if keyword(p, "else") {
        Some(Condition::Constant(Some(true)))
    } else {
        Reader::new().condition(p, Of::If, true)
    }
}

pub(crate) struct ContainerCondition {
    pub(crate) name: Option<Str>,
    pub(crate) condition: Condition,
    pub(crate) text: Out,
}

pub(crate) fn container_list(source: &[u8]) -> Option<Vec<ContainerCondition>> {
    parse_all(source, |p| {
        commas(p, |p| {
            let is_name = |it: &&[u8]| {
                !is_reserved(it) && !["none", "and", "or", "not"].iter().any(|word| eq(it, word))
            };
            let (name, mut reader) = (
                attempt(p, |p| ident(p).filter(is_name)).map(|it| Str::from(text(it))),
                Reader::new(),
            );
            let condition = attempt(p, |p| reader.condition(p, Of::Container, true));
            let condition =
                condition.or_else(|| name.as_ref().map(|_| Condition::Constant(Some(true))))?;
            Some(ContainerCondition {
                name,
                condition,
                text: reader.out,
            })
        })
    })
}

impl Subject for () {
    fn feature(&self, _: Feature) -> Option<Actual> {
        None
    }
    fn compute(&self, _: &Node) -> f64 {
        0.0
    }
}

impl Condition {
    /// `None` is unknown.
    pub(crate) fn evaluate(&self, subject: &dyn Subject) -> Option<bool> {
        let fold = |list: &[Condition], decisive: bool| {
            let mut result = Some(!decisive);
            for condition in list {
                match condition.evaluate(subject) {
                    Some(value) if value == decisive => return Some(decisive),
                    Some(_) => {}
                    None => result = None,
                }
            }
            result
        };
        match self {
            Condition::Constant(value) => *value,
            Condition::Not(inner) => inner.evaluate(subject).map(|value| !value),
            Condition::All(list) => fold(list, false),
            Condition::Any(list) => fold(list, true),
            Condition::Boolean(feature) => Some(match subject.feature(*feature)? {
                Actual::Number(number) => number != 0.0,
                Actual::Keyword(keyword) => {
                    keyword != name!("none") && keyword != name!("no-preference")
                }
            }),
            Condition::Compare(feature, comparison, operand) => {
                Some(match (subject.feature(*feature)?, operand) {
                    (Actual::Keyword(actual), Operand::Keyword(expected)) => actual == *expected,
                    (Actual::Number(actual), Operand::Number(it)) => {
                        comparison.holds(actual.into(), subject.compute(it), 1.0 / 128.0)
                    }
                    (Actual::Number(actual), Operand::Integer(it)) => {
                        comparison.holds(actual.into(), (subject.compute(it) + 0.5).floor(), 0.0)
                    }
                    (Actual::Number(actual), Operand::Ratio(width, height)) => {
                        let ratio = subject.compute(width) / subject.compute(height);
                        comparison.holds(
                            actual.into(),
                            if ratio.is_nan() { f64::INFINITY } else { ratio },
                            1e-6,
                        )
                    }
                    _ => return None,
                })
            }
            other => subject.other(other),
        }
    }

    pub(crate) fn any_leaf(&self, test: &mut dyn FnMut(&Condition) -> bool) -> bool {
        match self {
            Condition::Not(inner) => inner.any_leaf(test),
            Condition::All(list) | Condition::Any(list) => list.iter().any(|it| it.any_leaf(test)),
            leaf => test(leaf),
        }
    }
}
