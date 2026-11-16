//! The values of the properties that only SVG has.

use crate::values::*;

keywords! {
    LineCap { Butt = "butt", Round = "round", Square = "square" }
    LineJoin { Miter = "miter", Round = "round", Bevel = "bevel" }
    TextAnchor { Start = "start", Middle = "middle", End = "end" }
    DominantBaseline { Auto = "auto", Alphabetic = "alphabetic", Ideographic = "ideographic", Middle = "middle",
        Central = "central", Mathematical = "mathematical", Hanging = "hanging", UseScript = "use-script",
        NoChange = "no-change", ResetSize = "reset-size", TextAfterEdge = "text-after-edge",
        TextBeforeEdge = "text-before-edge" }
    AlignmentBaseline { Auto = "auto", Baseline = "baseline", Alphabetic = "alphabetic", Ideographic = "ideographic",
        Middle = "middle", Central = "central", Mathematical = "mathematical", Hanging = "hanging",
        BeforeEdge = "before-edge", TextBeforeEdge = "text-before-edge", AfterEdge = "after-edge",
        TextAfterEdge = "text-after-edge" }
    ShapeRendering { Auto = "auto", OptimizeSpeed = "optimizespeed", CrispEdges = "crispedges",
        GeometricPrecision = "geometricprecision" }
    TextRendering { Auto = "auto", OptimizeSpeed = "optimizespeed", OptimizeLegibility = "optimizelegibility",
        GeometricPrecision = "geometricprecision" }
    ColorRendering { Auto = "auto", OptimizeSpeed = "optimizespeed", OptimizeQuality = "optimizequality" }
    ColorInterpolation { Auto = "auto", Srgb = "srgb", LinearRgb = "linearrgb" }
    VectorEffect { None = "none", NonScalingStroke = "non-scaling-stroke" }
    BufferedRendering { Auto = "auto", Dynamic = "dynamic", Static = "static" }
    TransformBox { ViewBox = "view-box", FillBox = "fill-box", StrokeBox = "stroke-box", ContentBox = "content-box",
        BorderBox = "border-box" }
    MaskType { Luminance = "luminance", Alpha = "alpha" }
    PaintKind { Fill = "fill", Stroke = "stroke", Markers = "markers" }
}

#[derive(Clone, PartialEq)]
pub(crate) enum SvgPaint {
    None,
    Color(Color),
    ContextFill,
    ContextStroke,
    /// With the fallback.
    Url(Str, Option<NoneOr<Color>>),
}

impl Css for SvgPaint {
    fn parse(p: &mut P, cx: &Ctx) -> Option<SvgPaint> {
        Some(match () {
            () if keyword(p, "none") => SvgPaint::None,
            () if keyword(p, "context-fill") => SvgPaint::ContextFill,
            () if keyword(p, "context-stroke") => SvgPaint::ContextStroke,
            () => match url(p, cx) {
                Some(url) => SvgPaint::Url(url, NoneOr::parse(p, cx)),
                None => SvgPaint::Color(Color::parse(p, cx)?),
            },
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            SvgPaint::None => out.extend_from_slice(b"none"),
            SvgPaint::ContextFill => out.extend_from_slice(b"context-fill"),
            SvgPaint::ContextStroke => out.extend_from_slice(b"context-stroke"),
            SvgPaint::Color(color) => color.write(out),
            SvgPaint::Url(url, fallback) => {
                write_url(url, out);
                if let Some(fallback) = fallback {
                    out.push(b' ');
                    fallback.write(out);
                }
            }
        }
    }
    fn lerp(&self, to: &SvgPaint, t: Mixing) -> Option<SvgPaint> {
        match (self, to) {
            (SvgPaint::Color(a), SvgPaint::Color(b)) => a.lerp(b, t).map(SvgPaint::Color),
            _ => None,
        }
    }
}

/// A number is a length in pixels.
#[derive(Clone, PartialEq)]
pub(crate) struct SvgLength(pub(crate) Lp);

impl Css for SvgLength {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        (number(p, cx).map(|it| Lp::Px(it * cx.zoom)))
            .or_else(|| Lp::parse(p, cx))
            .map(SvgLength)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(SvgLength)
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct StrokeWidth(pub(crate) Lp);

impl Css for StrokeWidth {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        SvgLength::parse(p, cx).map(|it| {
            StrokeWidth(match it.0 {
                Lp::Px(it) => Lp::Px(it.max(0.0)),
                Lp::Fraction(it) => Lp::Fraction(it.max(0.0)),
                it => it,
            })
        })
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(|it| {
            StrokeWidth(if let Lp::Px(px) = it {
                Lp::Px(px.max(0.0))
            } else {
                it
            })
        })
    }
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct Dashes(pub(crate) NoneOrCommas<StrokeWidth>);

impl Css for Dashes {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Dashes> {
        if keyword(p, "none") {
            return Some(Dashes::default());
        }
        let mut dashes = vec![StrokeWidth::parse(p, cx)?];
        while let Some(next) = if comma(p) {
            Some(StrokeWidth::parse(p, cx)?)
        } else {
            StrokeWidth::parse(p, cx)
        } {
            dashes.push(next);
        }
        Some(Dashes(NoneOrCommas(dashes.into())))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let (a, b) = (&self.0.0, &to.0.0);
        let count = (1..=b.len())
            .map(|it| it * a.len())
            .find(|it| *it > 0 && it % b.len() == 0)?;
        let mixed = (0..count).map(|it| a[it % a.len()].lerp(&b[it % b.len()], t));
        Some(Dashes(NoneOrCommas(mixed.collect::<Option<_>>()?)))
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct PaintOrder(pub(crate) [PaintKind; 3]);

impl PaintOrder {
    pub(crate) const NORMAL: PaintOrder =
        PaintOrder([PaintKind::Fill, PaintKind::Stroke, PaintKind::Markers]);
}

impl Css for PaintOrder {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        if keyword(p, "normal") {
            return Some(PaintOrder::NORMAL);
        }
        let mut order = vec![PaintKind::parse(p, cx)?];
        while let Some(next) = PaintKind::parse(p, cx) {
            (!order.contains(&next)).then_some(())?;
            order.push(next);
        }
        let rest: Vec<_> = PaintOrder::NORMAL
            .0
            .into_iter()
            .filter(|it| !order.contains(it))
            .collect();
        order.extend(rest);
        order.try_into().ok().map(PaintOrder)
    }
    fn write(&self, out: &mut Out) {
        use PaintKind::*;
        match self.0 {
            [Fill, Stroke, _] => out.extend_from_slice(b"normal"),
            [first, Fill, _] => first.write(out),
            order => write_list(&order[..2], " ", out, PaintKind::write),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct Url(pub(crate) Str);

impl Css for Url {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        url(p, cx).map(Url)
    }
    fn write(&self, out: &mut Out) {
        write_url(&self.0, out);
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum BaselineShift {
    Sub,
    Super,
    Length(Lp),
}

impl Css for BaselineShift {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Some(match () {
            () if keyword(p, "baseline") => BaselineShift::Length(Lp::ZERO),
            () if keyword(p, "sub") => BaselineShift::Sub,
            () if keyword(p, "super") => BaselineShift::Super,
            () => BaselineShift::Length(SvgLength::parse(p, cx)?.0),
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            BaselineShift::Sub => out.extend_from_slice(b"sub"),
            BaselineShift::Super => out.extend_from_slice(b"super"),
            BaselineShift::Length(length) => length.write(out),
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        match (self, to) {
            (BaselineShift::Length(a), BaselineShift::Length(b)) => {
                a.lerp(b, t).map(BaselineShift::Length)
            }
            _ => None,
        }
    }
}

/// The attribute `d` does not go through the cascade, where nothing could be shared between paths.
#[derive(Clone, PartialEq)]
pub(crate) enum PathData {
    Attribute,
    None,
    Path(Str),
}

impl Css for PathData {
    fn parse(p: &mut P, _: &Ctx) -> Option<Self> {
        if keyword(p, "none") {
            return Some(PathData::None);
        }
        let data = attempt(p, |p| {
            function(p)
                .filter(|it| eq(it, "path"))
                .and_then(|_| nested(p, string))
        })?;
        crate::path::normalize(text(data)).map(|it| {
            if it.is_empty() {
                PathData::None
            } else {
                PathData::Path(it.into())
            }
        })
    }
    fn write(&self, out: &mut Out) {
        let PathData::Path(data) = self else {
            return out.extend_from_slice(b"none");
        };
        out.extend_from_slice(b"path(");
        write_string(data.as_bytes(), out);
        out.push(b')');
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let (PathData::Path(a), PathData::Path(b)) = (self, to) else {
            return None;
        };
        let [of_a, of_b] = t.weights();
        crate::path::mix_paths(a, b, of_a, of_b).map(|it| PathData::Path(it.into()))
    }
}
