//! CSS [media queries](https://drafts.csswg.org/mediaqueries/).
//!
//! Ported from `src/css/media_query.zig`.
//!
//! ─── B-2 round 3 status ──────────────────────────────────────────────────
//! Module un-gated. All data types (`MediaList`, `MediaQuery`,
//! `MediaCondition`, `QueryFeature`, `MediaFeatureValue`, `MediaFeatureId`,
//! `MediaFeatureName`, `MediaFeatureComparison`, `MediaFeatureType`,
//! `Operator`, `Qualifier`, `MediaType`, `QueryConditionFlags`) compile for
//! real so `rules::{media,import,custom_media}` and
//! `css_parser::AtRulePrelude` can hold them. `to_css` and arena-aware
//! `deep_clone` are real; the `rules::dc::{media_list,query_feature}`
//! bridges now route through them. `QueryFeature::parse` and the
//! `MediaFeatureName`/`MediaFeatureValue` leaf parsers are real — the
//! `values::{length,number,resolution,ratio}` calc lattice has un-gated, so
//! `@media`/`@container` parse end-to-end.

use crate as css;
use crate::css_properties::custom::EnvironmentVariable;
use crate::css_values::ident::{DashedIdent, Ident};
use crate::{Parser, PrintErr, Printer, Result};

pub use crate::Error;

// TODO(port): the CSS crate borrows strings from parser input with lifetime `'i`
// (matching lightningcss). Phase A avoids struct lifetime params; Phase B should
// thread `'i` through `MediaType::Custom`, `Ident`, `DashedIdent`, etc.

// ───────────────────────── value-type imports ─────────────────────────
// Real `values/` payloads — the calc lattice has un-gated, so the local
// stand-ins are gone and `MediaFeatureValue` carries the canonical types.
use crate::css_values::length::Length;
use crate::css_values::number::{CSSIntegerFns, CSSNumberFns};
use crate::css_values::ratio::Ratio;
use crate::css_values::resolution::Resolution;
type CSSNumber = f32;
type CSSInteger = i32;

// ───────────────────────── QueryCondition trait ─────────────────────────
// Implementors: MediaCondition, StyleQuery, ContainerCondition.
// NOT SupportsCondition — its variant set {Not, And(Vec), Or(Vec), Declaration,
// Selector, Unknown} and its `needs_parens(&Self)` / `b" not "` contract are
// structurally different and must stay hand-rolled.
//
// `deep_clone` is intentionally NOT on this trait. The Zig precedent is ONE
// reflective `css.implementDeepClone` (generics.zig); the Rust equivalent is
// `#[derive(DeepClone)]` (generics.rs). The hand-expansions in callers exist
// only because of derive blockers — fix the derive, not the trait.

/// Trait modeling Zig's `ValidQueryCondition` comptime interface check.
/// Any type that can appear as a node in a query-condition tree.
pub trait QueryCondition: Sized + ToCss {
    /// Leaf payload: `QueryFeature<_>` for media/container, `Property` for
    /// `StyleQuery`.
    type Feature;

    fn parse_feature(input: &mut Parser) -> Result<Self>;
    /// `parse_feature` with `ParserOptions` threaded — needed for the
    /// `env()` arm of `MediaFeatureValue::parse_unknown`. Default impl
    /// drops `options` so out-of-tree implementors (e.g.
    /// `rules::container::{ContainerCondition,StyleQuery}`) keep compiling
    /// until they opt in.
    fn parse_feature_with_options(
        input: &mut Parser,
        _options: &css::ParserOptions,
    ) -> Result<Self> {
        Self::parse_feature(input)
    }
    fn create_negation(condition: Box<Self>) -> Self;
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self;
    fn parse_style_query(input: &mut Parser) -> Result<Self>;
    /// See `parse_feature_with_options` — same default-forward rationale.
    fn parse_style_query_with_options(
        input: &mut Parser,
        _options: &css::ParserOptions,
    ) -> Result<Self> {
        Self::parse_style_query(input)
    }
    fn needs_parens(
        &self,
        parent_operator: Option<Operator>,
        targets: &css::targets::Targets,
    ) -> bool;

    // ─── variant-walk accessors (drive `condition_to_css`) ───
    fn as_feature(&self) -> Option<&Self::Feature>;
    fn as_not(&self) -> Option<&Self>;
    fn as_operation(&self) -> Option<(Operator, &[Self])>;

    /// Serialize the leaf feature. Not defaulted: `Property::to_css` takes an
    /// extra `is_custom_property` flag, and `QueryFeature::to_css` is inherent
    /// (not the `ToCss` trait), so callers must spell the dispatch.
    fn feature_to_css(f: &Self::Feature, dest: &mut Printer) -> core::result::Result<(), PrintErr>;

    /// Serialize a variant that isn't `Feature`/`Not`/`Operation`
    /// (e.g. `ContainerCondition::Style`). Implementors with no extra
    /// variants leave the default.
    fn extra_to_css(&self, _dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        unreachable!("QueryCondition: no extra variants")
    }

    /// Provided: shared `ToCss` body for the `Feature`/`Not`/`Operation`
    /// lattice (+ `extra_to_css` fallback). Mirrors the three hand-rolled
    /// `match`es this replaced.
    fn condition_to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if let Some(f) = self.as_feature() {
            return Self::feature_to_css(f, dest);
        }
        if let Some(c) = self.as_not() {
            dest.write_str("not ")?;
            let needs = c.needs_parens(None, &dest.targets);
            return to_css_with_parens_if_needed(c, dest, needs);
        }
        if let Some((op, conds)) = self.as_operation() {
            return operation_to_css(op, conds, dest);
        }
        self.extra_to_css(dest)
    }
}

/// `to_css` protocol used by the generic query-condition serializers.
/// Re-exported from `generics` — the local trait was byte-identical.
pub use crate::generics::ToCss;

// ───────────────────────── MediaList / MediaQuery ─────────────────────────

/// A [media query list](https://drafts.csswg.org/mediaqueries/#mq-list).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MediaList {
    /// The list of media queries.
    pub media_queries: Vec<MediaQuery>,
    // PERF(port): was ArrayListUnmanaged backed by parser arena — profile in Phase B
}

/// A [media query](https://drafts.csswg.org/mediaqueries/#media).
#[derive(Debug, Clone, PartialEq)]
pub struct MediaQuery {
    /// The qualifier (`not` / `only`).
    pub qualifier: Option<Qualifier>,
    /// The media type (`screen`, `print`, `all`, ...).
    pub media_type: MediaType,
    /// The media condition.
    pub condition: Option<MediaCondition>,
}

/// `not` / `and` / `or` boolean combiner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum Operator {
    And,
    Or,
}

/// `only` / `not` media-query qualifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum Qualifier {
    Only,
    Not,
}

/// A [media type](https://drafts.csswg.org/mediaqueries/#media-types).
// Clone: bitwise OK — `Custom` borrows arena-owned parser input (non-owning).
#[derive(Debug, Clone)]
pub enum MediaType {
    /// `all` (default).
    All,
    /// `print`.
    Print,
    /// `screen`.
    Screen,
    /// An unknown / deprecated / custom media type.
    // TODO(port): arena lifetime — Zig borrowed parser input.
    Custom(*const [u8]),
}

// PORT NOTE: hand-rolled — derived PartialEq on `*const [u8]` compares
// address+len, not byte content. Spec `MediaType.eql` compares slice bytes
// (via `css.implementEql`); adjacent-@media merging (rules.zig) depends on
// content equality across distinct arena offsets.
impl PartialEq for MediaType {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::All, Self::All) => true,
            (Self::Print, Self::Print) => true,
            (Self::Screen, Self::Screen) => true,
            // SAFETY: arena-owned slices valid for the MediaList lifetime.
            (Self::Custom(a), Self::Custom(b)) => unsafe { **a == **b },
            _ => false,
        }
    }
}

/// Flags for `parse_query_condition`.
// PORT NOTE: Zig `packed struct(u8)` with two bool fields → bitflags!
bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct QueryConditionFlags: u8 {
        /// Whether to allow top-level "or" boolean logic.
        const ALLOW_OR = 1 << 0;
        /// Whether to allow style container queries.
        const ALLOW_STYLE = 1 << 1;
    }
}

impl QueryConditionFlags {
    #[inline]
    pub fn allow_or(self) -> bool {
        self.contains(Self::ALLOW_OR)
    }
    #[inline]
    pub fn allow_style(self) -> bool {
        self.contains(Self::ALLOW_STYLE)
    }
}

// ───────────────────────── MediaCondition ─────────────────────────

/// Represents a media condition. Implements `QueryCondition`.
#[derive(Debug, Clone, PartialEq)]
pub enum MediaCondition {
    Feature(MediaFeature),
    Not(Box<MediaCondition>),
    Operation {
        operator: Operator,
        conditions: Vec<MediaCondition>,
        // PERF(port): was ArrayListUnmanaged backed by parser arena — profile in Phase B
    },
}

// ───────────────────────── QueryFeature / MediaFeature ─────────────────────────

/// `MediaFeature` is the media-query specialization of the generic
/// `QueryFeature` (also used by `@container`).
pub type MediaFeature = QueryFeature<MediaFeatureId>;

/// A media feature name (either a known `MediaFeatureId` or a custom/unknown ident).
#[derive(Debug, Clone)]
pub enum MediaFeatureName<FeatureId: FeatureIdTrait> {
    /// A standard known feature.
    Standard(FeatureId),
    /// A `--custom` feature (custom-media).
    Custom(DashedIdent),
    /// An unrecognized feature name.
    Unknown(Ident),
}

// PORT NOTE: `eql` was hand-written byte compare on the ident slices; data-only
// PartialEq derived once `Ident`/`DashedIdent` gain `PartialEq` (values/ un-gate).
impl<FeatureId: FeatureIdTrait> PartialEq for MediaFeatureName<FeatureId> {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Standard(a), Self::Standard(b)) => a == b,
            (Self::Custom(a), Self::Custom(b)) => a.v() == b.v(),
            // SAFETY: arena-owned slices valid for the MediaList lifetime.
            (Self::Unknown(a), Self::Unknown(b)) => unsafe { *a.v == *b.v },
            _ => false,
        }
    }
}

/// A `(name: value)` / `(name)` / `(name > value)` / `(a < name < b)` query feature.
#[derive(Debug, Clone, PartialEq)]
pub enum QueryFeature<FeatureId: FeatureIdTrait> {
    /// A plain media feature, e.g. `(min-width: 240px)`.
    Plain {
        name: MediaFeatureName<FeatureId>,
        value: MediaFeatureValue,
    },
    /// A boolean feature, e.g. `(hover)`.
    Boolean { name: MediaFeatureName<FeatureId> },
    /// A range, e.g. `(width > 240px)`.
    Range {
        name: MediaFeatureName<FeatureId>,
        operator: MediaFeatureComparison,
        value: MediaFeatureValue,
    },
    /// An interval, e.g. `(120px < width < 240px)`.
    Interval {
        name: MediaFeatureName<FeatureId>,
        start: MediaFeatureValue,
        start_operator: MediaFeatureComparison,
        end: MediaFeatureValue,
        end_operator: MediaFeatureComparison,
    },
}

/// Comparison operator in a range media feature.
// PORT NOTE: discriminants are power-of-two bitflags — Zig media_query.zig
// bitwise-ORs `@intFromEnum(start_operator) | @intFromEnum(end_operator)` to
// validate interval operator pairs. Do NOT use implicit 0..=4.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum MediaFeatureComparison {
    #[strum(serialize = "=")]
    Equal = 1,
    #[strum(serialize = ">")]
    GreaterThan = 2,
    #[strum(serialize = ">=")]
    GreaterThanEqual = 4,
    #[strum(serialize = "<")]
    LessThan = 8,
    #[strum(serialize = "<=")]
    LessThanEqual = 16,
}

/// [media feature value](https://drafts.csswg.org/mediaqueries/#typedef-mf-value).
// PORT NOTE: `Debug` hand-rolled below — `Length` (calc tree) does not derive
// `Debug`, but the `MediaCondition`/`QueryFeature` chain wants it for
// diagnostics.
#[derive(Clone)]
pub enum MediaFeatureValue {
    /// A length value.
    Length(Length),
    /// A number value.
    Number(CSSNumber),
    /// An integer value.
    Integer(CSSInteger),
    /// A boolean value.
    Boolean(bool),
    /// A resolution.
    Resolution(Resolution),
    /// A ratio.
    Ratio(Ratio),
    /// An identifier.
    Ident(Ident),
    /// An environment variable reference.
    Env(EnvironmentVariable),
}

impl core::fmt::Debug for MediaFeatureValue {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Minimal — `Length` lacks `Debug`; emit the variant tag only.
        use MediaFeatureValue as V;
        match self {
            V::Length(_) => f.write_str("Length(..)"),
            V::Number(n) => write!(f, "Number({n})"),
            V::Integer(i) => write!(f, "Integer({i})"),
            V::Boolean(b) => write!(f, "Boolean({b})"),
            V::Resolution(r) => write!(f, "Resolution({r:?})"),
            V::Ratio(r) => write!(f, "Ratio({r:?})"),
            V::Ident(i) => write!(f, "Ident({i:?})"),
            V::Env(_) => f.write_str("Env(..)"),
        }
    }
}

// PORT NOTE: derive(PartialEq) blocked on `Ident`/`EnvironmentVariable` lacking
// std `PartialEq`; hand-roll all arms (Zig: `css.implementEql`).
impl PartialEq for MediaFeatureValue {
    fn eq(&self, other: &Self) -> bool {
        use MediaFeatureValue as V;
        match (self, other) {
            (V::Length(a), V::Length(b)) => a == b,
            (V::Number(a), V::Number(b)) => a == b,
            (V::Integer(a), V::Integer(b)) => a == b,
            (V::Boolean(a), V::Boolean(b)) => a == b,
            (V::Resolution(a), V::Resolution(b)) => a == b,
            (V::Ratio(a), V::Ratio(b)) => a == b,
            (V::Ident(a), V::Ident(b)) => a.v() == b.v(),
            // Zig: `css.implementEql` recurses into `EnvironmentVariable.eql` —
            // ported via the `CssEql` derive on `EnvironmentVariable`
            // (name + indices + fallback structural equality).
            (V::Env(a), V::Env(b)) => {
                use crate::generics::CssEql as _;
                a.eql(b)
            }
            _ => false,
        }
    }
}

/// The type of a media feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaFeatureType {
    /// A length value.
    Length,
    /// A number value.
    Number,
    /// An integer value.
    Integer,
    /// A boolean value.
    Boolean,
    /// A resolution.
    Resolution,
    /// A ratio.
    Ratio,
    /// An identifier.
    Ident,
    /// Unknown — accept any.
    Unknown,
}

impl MediaFeatureType {
    /// Zig: `MediaFeatureType.allowsRanges`.
    pub fn allows_ranges(self) -> bool {
        use MediaFeatureType as T;
        matches!(
            self,
            T::Length | T::Number | T::Integer | T::Resolution | T::Ratio | T::Unknown
        )
    }
}

/// Trait modeling Zig's `MediaFeatureId`-shape comptime interface for the
/// generic `QueryFeature<FeatureId>`.
pub trait FeatureIdTrait: Copy + PartialEq + Eq {
    fn value_type(&self) -> MediaFeatureType;
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>;
    fn from_str(s: &[u8]) -> Option<Self>;
    /// Serialize with a `min-`/`max-` prefix. Default writes the prefix then
    /// delegates to `to_css`; specializations (e.g. `-webkit-device-pixel-ratio`)
    /// override to interleave the prefix mid-name.
    fn to_css_with_prefix(
        &self,
        prefix: &str,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        dest.write_str(prefix)?;
        self.to_css(dest)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum MediaFeatureId {
    /// The [width](https://w3c.github.io/csswg-drafts/mediaqueries-5/#width) media feature.
    #[strum(serialize = "width")]
    Width,
    /// The [height](https://w3c.github.io/csswg-drafts/mediaqueries-5/#height) media feature.
    #[strum(serialize = "height")]
    Height,
    /// The [aspect-ratio](https://w3c.github.io/csswg-drafts/mediaqueries-5/#aspect-ratio) media feature.
    #[strum(serialize = "aspect-ratio")]
    AspectRatio,
    /// The [orientation](https://w3c.github.io/csswg-drafts/mediaqueries-5/#orientation) media feature.
    #[strum(serialize = "orientation")]
    Orientation,
    /// The [overflow-block](https://w3c.github.io/csswg-drafts/mediaqueries-5/#overflow-block) media feature.
    #[strum(serialize = "overflow-block")]
    OverflowBlock,
    /// The [overflow-inline](https://w3c.github.io/csswg-drafts/mediaqueries-5/#overflow-inline) media feature.
    #[strum(serialize = "overflow-inline")]
    OverflowInline,
    /// The [horizontal-viewport-segments](https://w3c.github.io/csswg-drafts/mediaqueries-5/#horizontal-viewport-segments) media feature.
    #[strum(serialize = "horizontal-viewport-segments")]
    HorizontalViewportSegments,
    /// The [vertical-viewport-segments](https://w3c.github.io/csswg-drafts/mediaqueries-5/#vertical-viewport-segments) media feature.
    #[strum(serialize = "vertical-viewport-segments")]
    VerticalViewportSegments,
    /// The [display-mode](https://w3c.github.io/csswg-drafts/mediaqueries-5/#display-mode) media feature.
    #[strum(serialize = "display-mode")]
    DisplayMode,
    /// The [resolution](https://w3c.github.io/csswg-drafts/mediaqueries-5/#resolution) media feature.
    #[strum(serialize = "resolution")]
    Resolution,
    /// The [scan](https://w3c.github.io/csswg-drafts/mediaqueries-5/#scan) media feature.
    #[strum(serialize = "scan")]
    Scan,
    /// The [grid](https://w3c.github.io/csswg-drafts/mediaqueries-5/#grid) media feature.
    #[strum(serialize = "grid")]
    Grid,
    /// The [update](https://w3c.github.io/csswg-drafts/mediaqueries-5/#update) media feature.
    #[strum(serialize = "update")]
    Update,
    /// The [environment-blending](https://w3c.github.io/csswg-drafts/mediaqueries-5/#environment-blending) media feature.
    #[strum(serialize = "environment-blending")]
    EnvironmentBlending,
    /// The [color](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color) media feature.
    #[strum(serialize = "color")]
    Color,
    /// The [color-index](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color-index) media feature.
    #[strum(serialize = "color-index")]
    ColorIndex,
    /// The [monochrome](https://w3c.github.io/csswg-drafts/mediaqueries-5/#monochrome) media feature.
    #[strum(serialize = "monochrome")]
    Monochrome,
    /// The [color-gamut](https://w3c.github.io/csswg-drafts/mediaqueries-5/#color-gamut) media feature.
    #[strum(serialize = "color-gamut")]
    ColorGamut,
    /// The [dynamic-range](https://w3c.github.io/csswg-drafts/mediaqueries-5/#dynamic-range) media feature.
    #[strum(serialize = "dynamic-range")]
    DynamicRange,
    /// The [inverted-colors](https://w3c.github.io/csswg-drafts/mediaqueries-5/#inverted-colors) media feature.
    #[strum(serialize = "inverted-colors")]
    InvertedColors,
    /// The [pointer](https://w3c.github.io/csswg-drafts/mediaqueries-5/#pointer) media feature.
    #[strum(serialize = "pointer")]
    Pointer,
    /// The [hover](https://w3c.github.io/csswg-drafts/mediaqueries-5/#hover) media feature.
    #[strum(serialize = "hover")]
    Hover,
    /// The [any-pointer](https://w3c.github.io/csswg-drafts/mediaqueries-5/#any-pointer) media feature.
    #[strum(serialize = "any-pointer")]
    AnyPointer,
    /// The [any-hover](https://w3c.github.io/csswg-drafts/mediaqueries-5/#any-hover) media feature.
    #[strum(serialize = "any-hover")]
    AnyHover,
    /// The [nav-controls](https://w3c.github.io/csswg-drafts/mediaqueries-5/#nav-controls) media feature.
    #[strum(serialize = "nav-controls")]
    NavControls,
    /// The [video-color-gamut](https://w3c.github.io/csswg-drafts/mediaqueries-5/#video-color-gamut) media feature.
    #[strum(serialize = "video-color-gamut")]
    VideoColorGamut,
    /// The [video-dynamic-range](https://w3c.github.io/csswg-drafts/mediaqueries-5/#video-dynamic-range) media feature.
    #[strum(serialize = "video-dynamic-range")]
    VideoDynamicRange,
    /// The [scripting](https://w3c.github.io/csswg-drafts/mediaqueries-5/#scripting) media feature.
    #[strum(serialize = "scripting")]
    Scripting,
    /// The [prefers-reduced-motion](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-motion) media feature.
    #[strum(serialize = "prefers-reduced-motion")]
    PrefersReducedMotion,
    /// The [prefers-reduced-transparency](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-transparency) media feature.
    #[strum(serialize = "prefers-reduced-transparency")]
    PrefersReducedTransparency,
    /// The [prefers-contrast](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-contrast) media feature.
    #[strum(serialize = "prefers-contrast")]
    PrefersContrast,
    /// The [forced-colors](https://w3c.github.io/csswg-drafts/mediaqueries-5/#forced-colors) media feature.
    #[strum(serialize = "forced-colors")]
    ForcedColors,
    /// The [prefers-color-scheme](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-color-scheme) media feature.
    #[strum(serialize = "prefers-color-scheme")]
    PrefersColorScheme,
    /// The [prefers-reduced-data](https://w3c.github.io/csswg-drafts/mediaqueries-5/#prefers-reduced-data) media feature.
    #[strum(serialize = "prefers-reduced-data")]
    PrefersReducedData,
    /// The [device-width](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-width) media feature.
    #[strum(serialize = "device-width")]
    DeviceWidth,
    /// The [device-height](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-height) media feature.
    #[strum(serialize = "device-height")]
    DeviceHeight,
    /// The [device-aspect-ratio](https://w3c.github.io/csswg-drafts/mediaqueries-5/#device-aspect-ratio) media feature.
    #[strum(serialize = "device-aspect-ratio")]
    DeviceAspectRatio,

    /// The non-standard -webkit-device-pixel-ratio media feature.
    #[strum(serialize = "-webkit-device-pixel-ratio")]
    WebkitDevicePixelRatio,
    /// The non-standard -moz-device-pixel-ratio media feature.
    #[strum(serialize = "-moz-device-pixel-ratio")]
    MozDevicePixelRatio,
}

impl MediaFeatureId {
    // Zig: `pub const valueType = css.DeriveValueType(@This(), ValueTypeMap).valueType;`
    pub fn value_type(&self) -> MediaFeatureType {
        use MediaFeatureId::*;
        use MediaFeatureType as T;
        match self {
            Width | Height | DeviceWidth | DeviceHeight => T::Length,
            AspectRatio | DeviceAspectRatio => T::Ratio,
            Orientation
            | OverflowBlock
            | OverflowInline
            | DisplayMode
            | Scan
            | Update
            | EnvironmentBlending
            | ColorGamut
            | DynamicRange
            | InvertedColors
            | Pointer
            | Hover
            | AnyPointer
            | AnyHover
            | NavControls
            | VideoColorGamut
            | VideoDynamicRange
            | Scripting
            | PrefersReducedMotion
            | PrefersReducedTransparency
            | PrefersContrast
            | ForcedColors
            | PrefersColorScheme
            | PrefersReducedData => T::Ident,
            HorizontalViewportSegments
            | VerticalViewportSegments
            | Color
            | ColorIndex
            | Monochrome => T::Integer,
            Resolution => T::Resolution,
            Grid => T::Boolean,
            WebkitDevicePixelRatio | MozDevicePixelRatio => T::Number,
        }
    }
}

impl FeatureIdTrait for MediaFeatureId {
    fn value_type(&self) -> MediaFeatureType {
        MediaFeatureId::value_type(self)
    }
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // Zig: `css.DefineEnumProperty(@This()).toCss` — emits the lowercase
        // tag name. `strum::IntoStaticStr` already carries those strings.
        dest.write_str(<&'static str>::from(*self))
    }
    fn to_css_with_prefix(
        &self,
        prefix: &str,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        match self {
            // Zig: `-webkit-{s}device-pixel-ratio` — webkit places the
            // min/max prefix between the vendor prefix and the feature name.
            MediaFeatureId::WebkitDevicePixelRatio => {
                dest.write_str("-webkit-")?;
                dest.write_str(prefix)?;
                dest.write_str("device-pixel-ratio")
            }
            _ => {
                dest.write_str(prefix)?;
                FeatureIdTrait::to_css(self, dest)
            }
        }
    }
    fn from_str(s: &[u8]) -> Option<Self> {
        // Zig: `css.DefineEnumProperty(@This()).parse` — case-insensitive
        // ASCII tag-name table. No dependency on the gated `values/` lattice.
        use MediaFeatureId::*;
        crate::match_ignore_ascii_case! { s, {
            b"width" => Some(Width),
            b"height" => Some(Height),
            b"aspect-ratio" => Some(AspectRatio),
            b"orientation" => Some(Orientation),
            b"overflow-block" => Some(OverflowBlock),
            b"overflow-inline" => Some(OverflowInline),
            b"horizontal-viewport-segments" => Some(HorizontalViewportSegments),
            b"vertical-viewport-segments" => Some(VerticalViewportSegments),
            b"display-mode" => Some(DisplayMode),
            b"resolution" => Some(Resolution),
            b"scan" => Some(Scan),
            b"grid" => Some(Grid),
            b"update" => Some(Update),
            b"environment-blending" => Some(EnvironmentBlending),
            b"color" => Some(Color),
            b"color-index" => Some(ColorIndex),
            b"monochrome" => Some(Monochrome),
            b"color-gamut" => Some(ColorGamut),
            b"dynamic-range" => Some(DynamicRange),
            b"inverted-colors" => Some(InvertedColors),
            b"pointer" => Some(Pointer),
            b"hover" => Some(Hover),
            b"any-pointer" => Some(AnyPointer),
            b"any-hover" => Some(AnyHover),
            b"nav-controls" => Some(NavControls),
            b"video-color-gamut" => Some(VideoColorGamut),
            b"video-dynamic-range" => Some(VideoDynamicRange),
            b"scripting" => Some(Scripting),
            b"prefers-reduced-motion" => Some(PrefersReducedMotion),
            b"prefers-reduced-transparency" => Some(PrefersReducedTransparency),
            b"prefers-contrast" => Some(PrefersContrast),
            b"forced-colors" => Some(ForcedColors),
            b"prefers-color-scheme" => Some(PrefersColorScheme),
            b"prefers-reduced-data" => Some(PrefersReducedData),
            b"device-width" => Some(DeviceWidth),
            b"device-height" => Some(DeviceHeight),
            b"device-aspect-ratio" => Some(DeviceAspectRatio),
            b"-webkit-device-pixel-ratio" => Some(WebkitDevicePixelRatio),
            b"-moz-device-pixel-ratio" => Some(MozDevicePixelRatio),
            _ => None,
        }}
    }
}

// ───────────────────────── to_css / matching ─────────────────────────

impl MediaList {
    /// Returns whether the media query list always matches.
    pub fn always_matches(&self) -> bool {
        // If the media list is empty, it always matches.
        self.media_queries.is_empty() || self.media_queries.iter().all(MediaQuery::always_matches)
    }

    /// Returns whether the media query list never matches.
    pub fn never_matches(&self) -> bool {
        !self.media_queries.is_empty() && self.media_queries.iter().all(MediaQuery::never_matches)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.media_queries.is_empty() {
            return dest.write_str("not all");
        }
        dest.write_comma_separated(&self.media_queries, |d, q| q.to_css(d))
    }
}

impl crate::generic::ToCss for MediaList {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        MediaList::to_css(self, dest)
    }
}

impl MediaQuery {
    /// Returns whether the media query is guaranteed to always match.
    pub fn always_matches(&self) -> bool {
        self.qualifier.is_none()
            && matches!(self.media_type, MediaType::All)
            && self.condition.is_none()
    }

    /// Returns whether the media query is guaranteed to never match.
    pub fn never_matches(&self) -> bool {
        matches!(self.qualifier, Some(Qualifier::Not))
            && matches!(self.media_type, MediaType::All)
            && self.condition.is_none()
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if let Some(qual) = self.qualifier {
            qual.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        match &self.media_type {
            MediaType::All => {
                // We need to print "all" if there's a qualifier, or there's
                // just an empty list of expressions.
                //
                // Otherwise, we'd serialize media queries like "(min-width:
                // 40px)" in "all (min-width: 40px)", which is unexpected.
                if self.qualifier.is_some() || self.condition.is_none() {
                    dest.write_str("all")?;
                }
            }
            MediaType::Print => dest.write_str("print")?,
            MediaType::Screen => dest.write_str("screen")?,
            MediaType::Custom(desc) => {
                // SAFETY: arena-owned slice valid for the MediaList lifetime.
                dest.write_str(unsafe { crate::arena_str(*desc) })?;
            }
        }

        let Some(condition) = &self.condition else {
            return Ok(());
        };

        let needs_parens = if !matches!(self.media_type, MediaType::All) || self.qualifier.is_some()
        {
            dest.write_str(" and ")?;
            matches!(
                condition,
                MediaCondition::Operation { operator, .. } if *operator != Operator::And
            )
        } else {
            false
        };

        to_css_with_parens_if_needed(condition, dest, needs_parens)
    }
}

/// Zig: `toCssWithParensIfNeeded` — wraps `v.to_css()` in parentheses when the
/// caller's grammar position requires it.
pub fn to_css_with_parens_if_needed<T: ToCss + ?Sized>(
    v: &T,
    dest: &mut Printer,
    needs_parens: bool,
) -> core::result::Result<(), PrintErr> {
    if needs_parens {
        dest.write_char(b'(')?;
    }
    v.to_css(dest)?;
    if needs_parens {
        dest.write_char(b')')?;
    }
    Ok(())
}

/// Zig: `operationToCss` — serialize `a OP b OP c ...` with per-child parens.
pub fn operation_to_css<C: QueryCondition>(
    operator: Operator,
    conditions: &[C],
    dest: &mut Printer,
) -> core::result::Result<(), PrintErr> {
    let first = &conditions[0];
    to_css_with_parens_if_needed(
        first,
        dest,
        first.needs_parens(Some(operator), &dest.targets),
    )?;
    if conditions.len() == 1 {
        return Ok(());
    }
    for item in &conditions[1..] {
        dest.write_char(b' ')?;
        operator.to_css(dest)?;
        dest.write_char(b' ')?;
        to_css_with_parens_if_needed(item, dest, item.needs_parens(Some(operator), &dest.targets))?;
    }
    Ok(())
}

impl ToCss for MediaCondition {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.condition_to_css(dest)
    }
}

impl QueryCondition for MediaCondition {
    type Feature = MediaFeature;

    fn as_feature(&self) -> Option<&MediaFeature> {
        if let Self::Feature(f) = self {
            Some(f)
        } else {
            None
        }
    }
    fn as_not(&self) -> Option<&Self> {
        if let Self::Not(c) = self {
            Some(c)
        } else {
            None
        }
    }
    fn as_operation(&self) -> Option<(Operator, &[Self])> {
        if let Self::Operation {
            operator,
            conditions,
        } = self
        {
            Some((*operator, conditions))
        } else {
            None
        }
    }
    fn feature_to_css(f: &MediaFeature, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        f.to_css(dest)
    }

    fn parse_feature(input: &mut Parser) -> Result<Self> {
        let feature = MediaFeature::parse(input)?;
        Ok(MediaCondition::Feature(feature))
    }
    fn parse_feature_with_options(
        input: &mut Parser,
        options: &css::ParserOptions,
    ) -> Result<Self> {
        let feature = MediaFeature::parse_with_options(input, options)?;
        Ok(MediaCondition::Feature(feature))
    }
    fn create_negation(condition: Box<Self>) -> Self {
        MediaCondition::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        MediaCondition::Operation {
            operator,
            conditions,
        }
    }
    fn parse_style_query(input: &mut Parser) -> Result<Self> {
        // Zig: `return .{ .err = input.newErrorForNextToken() }`
        Err(input.new_error_for_next_token())
    }
    fn needs_parens(
        &self,
        parent_operator: Option<Operator>,
        targets: &css::targets::Targets,
    ) -> bool {
        match self {
            MediaCondition::Not(_) => true,
            MediaCondition::Operation { operator, .. } => Some(*operator) != parent_operator,
            MediaCondition::Feature(f) => f.needs_parens(parent_operator, targets),
        }
    }
}

impl<FeatureId: FeatureIdTrait> QueryFeature<FeatureId> {
    pub fn needs_parens(
        &self,
        parent_operator: Option<Operator>,
        targets: &css::targets::Targets,
    ) -> bool {
        parent_operator != Some(Operator::And)
            && matches!(self, QueryFeature::Interval { .. })
            && targets.should_compile_same(css::compat::Feature::MediaIntervalSyntax)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_char(b'(')?;

        match self {
            QueryFeature::Boolean { name } => {
                name.to_css(dest)?;
            }
            QueryFeature::Plain { name, value } => {
                name.to_css(dest)?;
                dest.delim(b':', false)?;
                value.to_css(dest)?;
            }
            QueryFeature::Range {
                name,
                operator,
                value,
            } => {
                // If range syntax is unsupported, use min/max prefix if possible.
                if dest
                    .targets
                    .should_compile_same(css::compat::Feature::MediaRangeSyntax)
                {
                    return write_min_max(*operator, name, value, dest);
                }
                name.to_css(dest)?;
                operator.to_css(dest)?;
                value.to_css(dest)?;
            }
            QueryFeature::Interval {
                name,
                start,
                start_operator,
                end,
                end_operator,
            } => {
                if dest
                    .targets
                    .should_compile_same(css::compat::Feature::MediaIntervalSyntax)
                {
                    write_min_max(start_operator.opposite(), name, start, dest)?;
                    dest.write_str(" and (")?;
                    return write_min_max(*end_operator, name, end, dest);
                }

                start.to_css(dest)?;
                start_operator.to_css(dest)?;
                name.to_css(dest)?;
                end_operator.to_css(dest)?;
                end.to_css(dest)?;
            }
        }

        dest.write_char(b')')
    }
}

impl<FeatureId: FeatureIdTrait> MediaFeatureName<FeatureId> {
    /// Zig: `MediaFeatureName.valueType`.
    pub fn value_type(&self) -> MediaFeatureType {
        match self {
            MediaFeatureName::Standard(standard) => standard.value_type(),
            _ => MediaFeatureType::Unknown,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureName::Standard(v) => v.to_css(dest),
            // PORT NOTE: Zig `DashedIdentFns.toCss` → `dest.writeDashedIdent`
            // (handles css-module name rewriting).
            MediaFeatureName::Custom(d) => d.to_css(dest),
            MediaFeatureName::Unknown(v) => v.to_css(dest),
        }
    }

    pub fn to_css_with_prefix(
        &self,
        prefix: &str,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureName::Standard(v) => v.to_css_with_prefix(prefix, dest),
            MediaFeatureName::Custom(d) => {
                dest.write_str(prefix)?;
                d.to_css(dest)
            }
            MediaFeatureName::Unknown(v) => {
                dest.write_str(prefix)?;
                v.to_css(dest)
            }
        }
    }

    /// Parses a media feature name. Returns `(name, legacy_comparator)` —
    /// `legacy_comparator` is `Some` when the ident carried a `min-`/`max-`
    /// prefix (lowered to `>=`/`<=`).
    ///
    /// Zig: `MediaFeatureName.parse`.
    pub fn parse(input: &mut Parser) -> Result<(Self, Option<MediaFeatureComparison>)> {
        use bun_core::strings;
        let ident = input.expect_ident_cloned()?;

        if strings::starts_with(ident, b"--") {
            return Ok((MediaFeatureName::Custom(DashedIdent { v: ident }), None));
        }

        let mut name: &[u8] = ident;

        // Webkit places its prefixes before "min" and "max". Remove it first, and
        // re-add after removing min/max.
        let is_webkit = strings::starts_with_case_insensitive_ascii(name, b"-webkit-");
        if is_webkit {
            name = &name[8..];
        }

        let comparator: Option<MediaFeatureComparison> =
            if strings::starts_with_case_insensitive_ascii(name, b"min-") {
                name = &name[4..];
                Some(MediaFeatureComparison::GreaterThanEqual)
            } else if strings::starts_with_case_insensitive_ascii(name, b"max-") {
                name = &name[4..];
                Some(MediaFeatureComparison::LessThanEqual)
            } else {
                None
            };

        // PORT NOTE: Zig `allocPrint("-webkit-{s}", .{name})` then
        // `parse_utility.parseString(.., FeatureId.parse)` — the re-tokenize is
        // only to feed `DefineEnumProperty.parse` an ident token. Here
        // `FeatureIdTrait::from_str` does the same case-insensitive table lookup
        // directly, so a stack buffer suffices and the temp string is freed
        // immediately (Zig asserts `FeatureId` is an enum for the same reason).
        // PERF: stack buffer here?
        let mut webkit_buf: [u8; 64] = [0; 64];
        let final_name: &[u8] = if is_webkit {
            let len = 8 + name.len();
            if len <= webkit_buf.len() {
                webkit_buf[..8].copy_from_slice(b"-webkit-");
                webkit_buf[8..len].copy_from_slice(name);
                &webkit_buf[..len]
            } else {
                // Overlong unknown ident — can't be a known FeatureId; fall
                // through to `Unknown` below.
                b""
            }
        } else {
            name
        };

        if !final_name.is_empty() {
            if let Some(standard) = FeatureId::from_str(final_name) {
                return Ok((MediaFeatureName::Standard(standard), comparator));
            }
        }

        Ok((MediaFeatureName::Unknown(Ident { v: ident }), None))
    }
}

impl MediaFeatureComparison {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            // PORT NOTE(suspect): Zig emits '-' for `Equal` (media_query.zig:1156),
            // diverging from the spec `=` and from this enum's strum tag. Ported
            // byte-for-byte; revisit if upstream fixes.
            MediaFeatureComparison::Equal => dest.delim(b'-', true),
            MediaFeatureComparison::GreaterThan => dest.delim(b'>', true),
            MediaFeatureComparison::GreaterThanEqual => {
                dest.whitespace()?;
                dest.write_str(">=")?;
                dest.whitespace()
            }
            MediaFeatureComparison::LessThan => dest.delim(b'<', true),
            MediaFeatureComparison::LessThanEqual => {
                dest.whitespace()?;
                dest.write_str("<=")?;
                dest.whitespace()
            }
        }
    }

    pub fn opposite(self) -> Self {
        match self {
            MediaFeatureComparison::GreaterThan => MediaFeatureComparison::LessThan,
            MediaFeatureComparison::GreaterThanEqual => MediaFeatureComparison::LessThanEqual,
            MediaFeatureComparison::LessThan => MediaFeatureComparison::GreaterThan,
            MediaFeatureComparison::LessThanEqual => MediaFeatureComparison::GreaterThanEqual,
            MediaFeatureComparison::Equal => MediaFeatureComparison::Equal,
        }
    }
}

impl MediaFeatureValue {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureValue::Length(len) => len.to_css(dest),
            MediaFeatureValue::Number(num) => css::to_css::float32(*num, dest),
            MediaFeatureValue::Integer(int) => css::to_css::integer(*int, dest),
            MediaFeatureValue::Boolean(b) => {
                if *b {
                    dest.write_char(b'1')
                } else {
                    dest.write_char(b'0')
                }
            }
            MediaFeatureValue::Resolution(res) => res.to_css(dest),
            MediaFeatureValue::Ratio(ratio) => ratio.to_css(dest),
            MediaFeatureValue::Ident(id) => id.to_css(dest),
            MediaFeatureValue::Env(env) => env.to_css(dest, false),
        }
    }

    /// Zig: `addF32` — adjust by `other` for strict-inequality → min/max
    /// boundary lowering. Consumes `self`.
    pub fn add_f32(self, other: f32) -> MediaFeatureValue {
        match self {
            // Zig: `len.add(arena, Length.px(other))` — calc lattice.
            MediaFeatureValue::Length(len) => MediaFeatureValue::Length(len.add(Length::px(other))),
            MediaFeatureValue::Number(num) => MediaFeatureValue::Number(num + other),
            MediaFeatureValue::Integer(num) => {
                MediaFeatureValue::Integer(num + if other.is_sign_positive() { 1 } else { -1 })
            }
            MediaFeatureValue::Boolean(v) => MediaFeatureValue::Boolean(v),
            MediaFeatureValue::Resolution(res) => MediaFeatureValue::Resolution(res.add_f32(other)),
            MediaFeatureValue::Ratio(ratio) => MediaFeatureValue::Ratio(ratio.add_f32(other)),
            MediaFeatureValue::Ident(id) => MediaFeatureValue::Ident(id),
            MediaFeatureValue::Env(env) => MediaFeatureValue::Env(env), // TODO: calc support
        }
    }

    /// Zig: `MediaFeatureValue.valueType`.
    pub fn value_type(&self) -> MediaFeatureType {
        use MediaFeatureValue as V;
        match self {
            V::Length(_) => MediaFeatureType::Length,
            V::Number(_) => MediaFeatureType::Number,
            V::Integer(_) => MediaFeatureType::Integer,
            V::Boolean(_) => MediaFeatureType::Boolean,
            V::Resolution(_) => MediaFeatureType::Resolution,
            V::Ratio(_) => MediaFeatureType::Ratio,
            V::Ident(_) => MediaFeatureType::Ident,
            V::Env(_) => MediaFeatureType::Unknown,
        }
    }

    /// Zig: `MediaFeatureValue.checkType`.
    pub fn check_type(&self, expected_type: MediaFeatureType) -> bool {
        let vt = self.value_type();
        if expected_type == MediaFeatureType::Unknown || vt == MediaFeatureType::Unknown {
            return true;
        }
        expected_type == vt
    }

    /// Parses a single media query feature value, with an expected type.
    /// If the type is unknown, pass `MediaFeatureType::Unknown` instead.
    pub fn parse(
        input: &mut Parser,
        expected_type: MediaFeatureType,
        options: &css::ParserOptions,
    ) -> Result<MediaFeatureValue> {
        if let Ok(value) = input.try_parse(|i| MediaFeatureValue::parse_known(i, expected_type)) {
            return Ok(value);
        }
        MediaFeatureValue::parse_unknown(input, options)
    }

    pub fn parse_known(
        input: &mut Parser,
        expected_type: MediaFeatureType,
    ) -> Result<MediaFeatureValue> {
        Ok(match expected_type {
            MediaFeatureType::Boolean => {
                let value = CSSIntegerFns::parse(input)?;
                if value != 0 && value != 1 {
                    return Err(input.new_custom_error(css::ParserError::invalid_value));
                }
                MediaFeatureValue::Boolean(value == 1)
            }
            MediaFeatureType::Number => MediaFeatureValue::Number(CSSNumberFns::parse(input)?),
            MediaFeatureType::Integer => MediaFeatureValue::Integer(CSSIntegerFns::parse(input)?),
            MediaFeatureType::Length => MediaFeatureValue::Length(Length::parse(input)?),
            MediaFeatureType::Resolution => {
                MediaFeatureValue::Resolution(Resolution::parse(input)?)
            }
            MediaFeatureType::Ratio => MediaFeatureValue::Ratio(Ratio::parse(input)?),
            MediaFeatureType::Ident => MediaFeatureValue::Ident(Ident::parse(input)?),
            MediaFeatureType::Unknown => {
                return Err(input.new_custom_error(css::ParserError::invalid_value));
            }
        })
    }

    pub fn parse_unknown(
        input: &mut Parser,
        options: &css::ParserOptions,
    ) -> Result<MediaFeatureValue> {
        // Ratios are ambiguous with numbers because the second param is optional (e.g. 2/1 == 2).
        // We require the / delimiter when parsing ratios so that 2/1 ends up as a ratio and 2 is
        // parsed as a number.
        if let Ok(ratio) = input.try_parse(Ratio::parse_required) {
            return Ok(MediaFeatureValue::Ratio(ratio));
        }

        // Parse number next so that unitless values are not parsed as lengths.
        if let Ok(num) = input.try_parse(CSSNumberFns::parse) {
            return Ok(MediaFeatureValue::Number(num));
        }

        if let Ok(res) = input.try_parse(Length::parse) {
            return Ok(MediaFeatureValue::Length(res));
        }

        if let Ok(res) = input.try_parse(Resolution::parse) {
            return Ok(MediaFeatureValue::Resolution(res));
        }

        // PORT NOTE: Zig `input.tryParse(EnvironmentVariable.parse, .{})` left
        // `options`/`depth` undefined (tryParse builds `ArgsTuple` and only
        // fills index 0) — UB. Fixed here by threading the real `ParserOptions`
        // down from `QueryFeature::parse` and passing `depth = 0`.
        if let Ok(env) = input.try_parse(|i| EnvironmentVariable::parse(i, options, 0)) {
            return Ok(MediaFeatureValue::Env(env));
        }

        let ident = Ident::parse(input)?;
        Ok(MediaFeatureValue::Ident(ident))
    }
}

/// Zig: `writeMinMax` — lower a range/interval comparator to legacy
/// `min-`/`max-` prefixed plain feature.
fn write_min_max<FeatureId: FeatureIdTrait>(
    operator: MediaFeatureComparison,
    name: &MediaFeatureName<FeatureId>,
    value: &MediaFeatureValue,
    dest: &mut Printer,
) -> core::result::Result<(), PrintErr> {
    let prefix = match operator {
        MediaFeatureComparison::GreaterThan | MediaFeatureComparison::GreaterThanEqual => {
            Some("min-")
        }
        MediaFeatureComparison::LessThan | MediaFeatureComparison::LessThanEqual => Some("max-"),
        MediaFeatureComparison::Equal => None,
    };

    if let Some(p) = prefix {
        name.to_css_with_prefix(p, dest)?;
    } else {
        name.to_css(dest)?;
    }

    dest.delim(b':', false)?;

    // PORT NOTE: Zig deepCloned `value` into `dest.arena` then mutated; here
    // `MediaFeatureValue: Clone` so we clone-by-value.
    let adjusted: Option<MediaFeatureValue> = match operator {
        MediaFeatureComparison::GreaterThan => Some(value.clone().add_f32(0.001)),
        MediaFeatureComparison::LessThan => Some(value.clone().add_f32(-0.001)),
        _ => None,
    };

    if let Some(val) = adjusted {
        val.to_css(dest)?;
    } else {
        value.to_css(dest)?;
    }

    dest.write_char(b')')
}

// ───────────────────────── deep_clone ─────────────────────────
// Arena-aware `deep_clone` — port of Zig's per-type `deepClone(arena)`
// bodies. Un-gated this round so `rules::dc::{media_list,query_feature}` can
// route through real impls instead of `#[derive(Clone)]` passthroughs.
//
// PORT NOTE: written as **inherent** methods (not `#[derive(DeepClone)]`) to
// match the Zig hand-written bodies exactly: Zig copies `name`/`qualifier`/
// `media_type`/`operator` fields by value (they are `Copy`/arena-slice types
// under the generics.zig "const strings" rule) and only recurses into the
// allocating payloads (`Vec`, `Box`, `MediaFeatureValue`). The derive would
// instead add a spurious `FeatureId: DeepClone<'bump>` where-bound.

impl MediaList {
    /// Zig: `MediaList.deepClone` — element-wise clone of `media_queries`.
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            media_queries: self
                .media_queries
                .iter()
                .map(|q| q.deep_clone(bump))
                .collect(),
        }
    }

    /// Zig: `pub fn clone(this, arena)` — alias for `deepClone`.
    #[inline]
    pub fn clone_in(&self, bump: &bun_alloc::Arena) -> Self {
        self.deep_clone(bump)
    }

    /// Zig: `MediaList.cloneWithImportRecords` — `MediaList` carries no
    /// `ImportRecord` indices so this is just `deep_clone`.
    #[inline]
    pub fn clone_with_import_records(
        &self,
        bump: &bun_alloc::Arena,
        _import_records: &mut Vec<bun_ast::ImportRecord>,
    ) -> Self {
        self.deep_clone(bump)
    }

    /// Zig: `pub const eql = css.implementEql(@This())` — structural eq.
    #[inline]
    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

impl MediaQuery {
    /// Zig: `MediaQuery.deepClone` — field-wise.
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            qualifier: self.qualifier,
            media_type: self.media_type.deep_clone(bump),
            condition: self.condition.as_ref().map(|c| c.deep_clone(bump)),
        }
    }
}

impl MediaType {
    /// Zig: `css.implementDeepClone` — `Custom([]const u8)` is an arena-owned
    /// slice (identity copy under the generics.zig "const strings" rule).
    #[inline]
    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        self.clone()
    }
}

impl MediaCondition {
    /// Zig: `MediaCondition.deepClone` — variant-wise recursion.
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        match self {
            MediaCondition::Feature(f) => MediaCondition::Feature(f.deep_clone(bump)),
            // Zig: `bun.create(arena, MediaCondition, c.deepClone(arena))`
            MediaCondition::Not(c) => MediaCondition::Not(Box::new(c.deep_clone(bump))),
            MediaCondition::Operation {
                operator,
                conditions,
            } => MediaCondition::Operation {
                operator: *operator,
                conditions: conditions.iter().map(|c| c.deep_clone(bump)).collect(),
            },
        }
    }
}

impl<FeatureId: FeatureIdTrait> MediaFeatureName<FeatureId> {
    /// Zig: struct-copy (`name = this.plain.name`). All payloads are `Copy` /
    /// arena-slice idents; `derive(Clone)` is the faithful deep clone.
    #[inline]
    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        self.clone()
    }
}

impl<FeatureId: FeatureIdTrait> QueryFeature<FeatureId> {
    /// Zig: `QueryFeature.deepClone` — variant-wise; `name`/`operator` are
    /// value-copied, `MediaFeatureValue` recurses.
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        match self {
            QueryFeature::Plain { name, value } => QueryFeature::Plain {
                name: name.deep_clone(bump),
                value: value.deep_clone(bump),
            },
            QueryFeature::Boolean { name } => QueryFeature::Boolean {
                name: name.deep_clone(bump),
            },
            QueryFeature::Range {
                name,
                operator,
                value,
            } => QueryFeature::Range {
                name: name.deep_clone(bump),
                operator: *operator,
                value: value.deep_clone(bump),
            },
            QueryFeature::Interval {
                name,
                start,
                start_operator,
                end,
                end_operator,
            } => QueryFeature::Interval {
                name: name.deep_clone(bump),
                start: start.deep_clone(bump),
                start_operator: *start_operator,
                end: end.deep_clone(bump),
                end_operator: *end_operator,
            },
        }
    }
}

impl MediaFeatureValue {
    /// Zig: `MediaFeatureValue.deepClone` — variant-wise.
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        use MediaFeatureValue as V;
        match self {
            // Zig: `l.deepClone(arena)` — real `values::length::Length`
            // owns a calc tree. The local `value_shims::Length` stand-in is a
            // unit struct, so `Clone` is faithful until the calc lattice
            // un-gates and the shim is replaced.
            V::Length(l) => V::Length(l.clone()),
            V::Number(n) => V::Number(*n),
            V::Integer(i) => V::Integer(*i),
            V::Boolean(b) => V::Boolean(*b),
            V::Resolution(r) => V::Resolution(*r),
            V::Ratio(r) => V::Ratio(*r),
            V::Ident(i) => V::Ident(i.deep_clone(bump)),
            // Zig: `e.deepClone(arena)` — `EnvironmentVariable` carries
            // `Vec<CSSInteger>` + `Option<TokenList>`; route through its
            // `#[derive(DeepClone)]` impl.
            V::Env(e) => {
                use crate::generics::DeepClone as _;
                V::Env(e.deep_clone(bump))
            }
        }
    }
}

// ───────────────────────── parse impl bodies ─────────────────────────

impl MediaType {
    pub fn parse(input: &mut Parser) -> Result<MediaType> {
        let name = input.expect_ident()?;
        Ok(MediaType::from_str(name))
    }

    pub fn from_str(name: &[u8]) -> MediaType {
        use bun_core::eql_case_insensitive_ascii_check_length as eq;
        if eq(name, b"all") {
            return MediaType::All;
        }
        if eq(name, b"print") {
            return MediaType::Print;
        }
        if eq(name, b"screen") {
            return MediaType::Screen;
        }
        MediaType::Custom(std::ptr::from_ref::<[u8]>(name))
    }
}

impl MediaList {
    /// Parse a media query list from CSS.
    pub fn parse(input: &mut Parser, options: &css::ParserOptions) -> Result<MediaList> {
        // PERF(port): was ArrayListUnmanaged(input.arena())
        let mut media_queries: Vec<MediaQuery> = Vec::new();
        loop {
            match input
                .parse_until_before(css::Delimiters::COMMA, |i| MediaQuery::parse(i, options))
            {
                Ok(mq) => media_queries.push(mq),
                Err(e) => {
                    if matches!(
                        e.kind,
                        css::error::ParserErrorKind::basic(css::BasicParseErrorKind::end_of_input)
                    ) {
                        break;
                    }
                    return Err(e);
                }
            }

            match input.next() {
                Ok(tok) => {
                    if !matches!(tok, css::Token::Comma) {
                        // Zig: bun.Output.panic(...) — see media_query.zig:54.
                        unreachable!(
                            "expected a comma after parsing a MediaQuery — bug in CSS parser"
                        );
                    }
                }
                Err(_) => break,
            }
        }

        Ok(MediaList { media_queries })
    }
}

impl MediaQuery {
    pub fn parse(input: &mut Parser, options: &css::ParserOptions) -> Result<MediaQuery> {
        // Zig: `Fn.tryParseFn` returning `(?Qualifier, ?MediaType)`.
        let (qualifier, explicit_media_type) = input
            .try_parse(|i| -> Result<(Option<Qualifier>, Option<MediaType>)> {
                let qualifier = i.try_parse(Qualifier::parse).ok();
                let media_type = MediaType::parse(i)?;
                Ok((qualifier, Some(media_type)))
            })
            .unwrap_or((None, None));

        let condition = if explicit_media_type.is_none() {
            Some(MediaCondition::parse_with_flags(
                input,
                QueryConditionFlags::ALLOW_OR,
                options,
            )?)
        } else if input.try_parse(|i| i.expect_ident_matching(b"and")).is_ok() {
            Some(MediaCondition::parse_with_flags(
                input,
                QueryConditionFlags::empty(),
                options,
            )?)
        } else {
            None
        };

        let media_type = explicit_media_type.unwrap_or(MediaType::All);

        Ok(MediaQuery {
            qualifier,
            media_type,
            condition,
        })
    }
}

impl MediaCondition {
    #[inline]
    pub fn parse_with_flags(
        input: &mut Parser,
        flags: QueryConditionFlags,
        options: &css::ParserOptions,
    ) -> Result<Self> {
        parse_query_condition_with_options::<MediaCondition>(input, flags, options)
    }
}

/// Parse a single query condition.
///
/// Forwarder kept for callers that don't yet thread `ParserOptions`
/// (e.g. `rules::container`); routes through `ParserOptions::default(None)`.
#[inline]
pub fn parse_query_condition<C: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
) -> Result<C> {
    parse_query_condition_with_options::<C>(input, flags, &css::ParserOptions::default(None))
}

/// Parse a single query condition with `ParserOptions` threaded so the
/// `env()` arm of `MediaFeatureValue::parse_unknown` is reachable.
pub fn parse_query_condition_with_options<C: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
    options: &css::ParserOptions,
) -> Result<C> {
    use bun_core::strings;
    let location = input.current_source_location();
    let (is_negation, is_style) = 'brk: {
        let tok = input.next()?.clone();
        match &tok {
            css::Token::OpenParen => break 'brk (false, false),
            css::Token::Ident(ident) => {
                if strings::eql_case_insensitive_ascii_check_length(ident, b"not") {
                    break 'brk (true, false);
                }
            }
            css::Token::Function(f) => {
                if flags.allow_style()
                    && strings::eql_case_insensitive_ascii_check_length(f, b"style")
                {
                    break 'brk (false, true);
                }
            }
            _ => {}
        }
        return Err(location.new_unexpected_token_error(tok));
    };

    // (is_negation, is_style)
    let first_condition: C = match (is_negation, is_style) {
        (true, false) => {
            let inner_condition = parse_parens_or_function::<C>(input, flags, options)?;
            return Ok(C::create_negation(Box::new(inner_condition)));
        }
        (true, true) => {
            let inner_condition = C::parse_style_query_with_options(input, options)?;
            return Ok(C::create_negation(Box::new(inner_condition)));
        }
        (false, false) => parse_paren_block::<C>(input, flags, options)?,
        (false, true) => C::parse_style_query_with_options(input, options)?,
    };

    let operator: Operator = match input.try_parse(Operator::parse) {
        Ok(op) => op,
        Err(_) => return Ok(first_condition),
    };

    if !flags.allow_or() && operator == Operator::Or {
        return Err(location.new_unexpected_token_error(css::Token::Ident(b"or")));
    }

    // PERF(port): was ArrayListUnmanaged(input.arena())
    let mut conditions: Vec<C> = Vec::new();
    conditions.push(first_condition);
    conditions.push(parse_parens_or_function::<C>(input, flags, options)?);

    let delim: &[u8] = match operator {
        Operator::And => b"and",
        Operator::Or => b"or",
    };

    loop {
        if input.try_parse(|i| i.expect_ident_matching(delim)).is_err() {
            return Ok(C::create_operation(operator, conditions));
        }
        conditions.push(parse_parens_or_function::<C>(input, flags, options)?);
    }
}

/// Parse a media condition in parentheses, or a style() function.
pub fn parse_parens_or_function<C: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
    options: &css::ParserOptions,
) -> Result<C> {
    use bun_core::strings;
    let location = input.current_source_location();
    let t = input.next()?.clone();
    match &t {
        css::Token::OpenParen => return parse_paren_block::<C>(input, flags, options),
        css::Token::Function(f) => {
            if flags.allow_style() && strings::eql_case_insensitive_ascii_check_length(f, b"style")
            {
                return C::parse_style_query_with_options(input, options);
            }
        }
        _ => {}
    }
    Err(location.new_unexpected_token_error(t))
}

fn parse_paren_block<C: QueryCondition>(
    input: &mut Parser,
    flags: QueryConditionFlags,
    options: &css::ParserOptions,
) -> Result<C> {
    // Zig: `Closure { flags }.parseNestedBlockFn` — collapsed to a closure
    // capturing `flags`/`options` by copy/reborrow.
    input.parse_nested_block(|i| {
        if let Ok(inner) =
            i.try_parse(|i2| parse_query_condition_with_options::<C>(i2, flags, options))
        {
            return Ok(inner);
        }
        C::parse_feature_with_options(i, options)
    })
}

impl<FeatureId: FeatureIdTrait> QueryFeature<FeatureId> {
    /// Parse a media/container feature inside `(` `)`.
    ///
    /// Zig: `QueryFeature.parse` (media_query.zig:945).
    ///
    /// Forwarder kept for callers that don't yet thread `ParserOptions`
    /// (e.g. `rules::container::ContainerCondition::parse_feature`).
    #[inline]
    pub fn parse(input: &mut Parser) -> Result<Self> {
        Self::parse_with_options(input, &css::ParserOptions::default(None))
    }

    /// `QueryFeature.parse` with `ParserOptions` threaded so the `env()`
    /// arm of `MediaFeatureValue::parse_unknown` is reachable.
    pub fn parse_with_options(input: &mut Parser, options: &css::ParserOptions) -> Result<Self> {
        match input.try_parse(|i| Self::parse_name_first(i, options)) {
            Ok(res) => Ok(res),
            Err(e) => {
                if matches!(
                    e.kind,
                    css::error::ParserErrorKind::custom(css::ParserError::invalid_media_query)
                ) {
                    return Err(e);
                }
                Self::parse_value_first(input, options)
            }
        }
    }

    /// Zig: `QueryFeature.parseNameFirst`.
    pub fn parse_name_first(input: &mut Parser, options: &css::ParserOptions) -> Result<Self> {
        let (name, legacy_op) = MediaFeatureName::<FeatureId>::parse(input)?;

        let operator = match input.try_parse(|i| consume_operation_or_colon(i, true)) {
            Ok(operator) => operator,
            Err(_) => return Ok(QueryFeature::Boolean { name }),
        };

        if operator.is_some() && legacy_op.is_some() {
            return Err(input.new_custom_error(css::ParserError::invalid_media_query));
        }

        let value = MediaFeatureValue::parse(input, name.value_type(), options)?;
        if !value.check_type(name.value_type()) {
            return Err(input.new_custom_error(css::ParserError::invalid_media_query));
        }

        if let Some(op) = operator.or(legacy_op) {
            if !name.value_type().allows_ranges() {
                return Err(input.new_custom_error(css::ParserError::invalid_media_query));
            }

            Ok(QueryFeature::Range {
                name,
                operator: op,
                value,
            })
        } else {
            Ok(QueryFeature::Plain { name, value })
        }
    }

    /// Zig: `QueryFeature.parseValueFirst`.
    pub fn parse_value_first(input: &mut Parser, options: &css::ParserOptions) -> Result<Self> {
        // We need to find the feature name first so we know the type.
        let start = input.state();
        // PORT NOTE: Zig loops `MediaFeatureName.parse` then checks
        // `isExhausted()` — but `expectIdent` does not advance on error, so
        // the literal Zig body would spin on a non-ident token. The intent
        // (matching lightningcss) is to *skip* tokens until the name is
        // found; advance one token per failed attempt.
        let name: MediaFeatureName<FeatureId> = loop {
            if let Ok((name, legacy_op)) = input.try_parse(MediaFeatureName::<FeatureId>::parse) {
                if legacy_op.is_some() {
                    return Err(input.new_custom_error(css::ParserError::invalid_media_query));
                }
                break name;
            }
            if input.next().is_err() {
                return Err(input.new_custom_error(css::ParserError::invalid_media_query));
            }
        };

        input.reset(&start);

        // Now we can parse the first value.
        let value = MediaFeatureValue::parse(input, name.value_type(), options)?;
        let operator = consume_operation_or_colon(input, false)?;

        // Skip over the feature name again.
        {
            let (feature_name, _blah) = MediaFeatureName::<FeatureId>::parse(input)?;
            debug_assert!(feature_name == name);
        }

        if !name.value_type().allows_ranges() || !value.check_type(name.value_type()) {
            return Err(input.new_custom_error(css::ParserError::invalid_media_query));
        }

        if let Ok(end_operator_) = input.try_parse(|i| consume_operation_or_colon(i, false)) {
            let start_operator = operator.unwrap();
            let end_operator = end_operator_.unwrap();
            // Start and end operators must be matching.
            // PORT NOTE: discriminants are bitflags (1/2/4/8/16) — see the
            // comment on `MediaFeatureComparison`. Zig bitwise-ORs them.
            const GT: u8 = MediaFeatureComparison::GreaterThan as u8;
            const GTE: u8 = MediaFeatureComparison::GreaterThanEqual as u8;
            const LT: u8 = MediaFeatureComparison::LessThan as u8;
            const LTE: u8 = MediaFeatureComparison::LessThanEqual as u8;
            let check_val: u8 = (start_operator as u8) | (end_operator as u8);
            #[allow(clippy::eq_op)]
            match check_val {
                v if v == (GT | GT)
                    || v == (GT | GTE)
                    || v == (GTE | GTE)
                    || v == (LT | LT)
                    || v == (LT | LTE)
                    || v == (LTE | LTE) => {}
                _ => {
                    return Err(input.new_custom_error(css::ParserError::invalid_media_query));
                }
            }

            let end_value = MediaFeatureValue::parse(input, name.value_type(), options)?;
            if !end_value.check_type(name.value_type()) {
                return Err(input.new_custom_error(css::ParserError::invalid_media_query));
            }

            Ok(QueryFeature::Interval {
                name,
                start: value,
                start_operator,
                end: end_value,
                end_operator,
            })
        } else {
            let final_operator = operator.unwrap().opposite();
            Ok(QueryFeature::Range {
                name,
                operator: final_operator,
                value,
            })
        }
    }
}

/// Consumes an operation or a colon, or returns an error.
///
/// Zig: `consumeOperationOrColon` (media_query.zig:1103). Returns `Ok(None)`
/// when a colon was consumed (and `allow_colon`); `Ok(Some(op))` for `<`/`>`/`=`.
fn consume_operation_or_colon(
    input: &mut Parser,
    allow_colon: bool,
) -> Result<Option<MediaFeatureComparison>> {
    let location = input.current_source_location();
    let first_delim: u32 = {
        let loc = input.current_source_location();
        let next_token = input.next()?.clone();
        match next_token {
            css::Token::Colon if allow_colon => return Ok(None),
            css::Token::Delim(oper) => oper,
            _ => return Err(loc.new_unexpected_token_error(next_token)),
        }
    };

    match first_delim {
        d if d == u32::from(b'=') => Ok(Some(MediaFeatureComparison::Equal)),
        d if d == u32::from(b'>') => {
            if input.try_parse(|i| i.expect_delim(b'=')).is_ok() {
                return Ok(Some(MediaFeatureComparison::GreaterThanEqual));
            }
            Ok(Some(MediaFeatureComparison::GreaterThan))
        }
        d if d == u32::from(b'<') => {
            if input.try_parse(|i| i.expect_delim(b'=')).is_ok() {
                return Ok(Some(MediaFeatureComparison::LessThanEqual));
            }
            Ok(Some(MediaFeatureComparison::LessThan))
        }
        _ => Err(location.new_unexpected_token_error(css::Token::Delim(first_delim))),
    }
}

// ported from: src/css/media_query.zig
