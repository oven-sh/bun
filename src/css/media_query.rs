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
//! `css_parser::AtRulePrelude` can hold them. The `parse`/`to_css`/
//! `deep_clone` impl bodies — which compile against
//! `values::{length,number,resolution,ratio}` (calc lattice, gated),
//! `IdentFns`/`CSSNumberFns` associated-fn namespaces (gated), and
//! `compat::Feature::Media{Range,Interval}Syntax` (not yet emitted by the
//! prefix table generator) — stay `#[cfg(any())]`-gated below. The full
//! 1500-line port body is preserved in git history (rev 8b7b16543a) and
//! re-lands when `values/` un-gates.

use crate as css;
use crate::css_properties::custom::EnvironmentVariable;
use crate::css_values::ident::{DashedIdent, Ident};
use crate::{Parser, PrintErr, Printer, Result};

pub use crate::Error;

// TODO(port): the CSS crate borrows strings from parser input with lifetime `'i`
// (matching lightningcss). Phase A avoids struct lifetime params; Phase B should
// thread `'i` through `MediaType::Custom`, `Ident`, `DashedIdent`, etc.

// ───────────────────────── value-type shims ─────────────────────────
// Local stand-ins for `values::{length,resolution,ratio}` so the
// `MediaFeatureValue` enum has real payloads. Replaced by
// `crate::css_values::*` when the calc lattice un-gates.
mod value_shims {
    /// `values::length::Length` stand-in.
    #[derive(Debug, Clone, PartialEq)]
    pub struct Length;
    /// `values::resolution::Resolution` stand-in.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct Resolution;
    /// `values::ratio::Ratio` stand-in.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct Ratio;
}
use value_shims::{Length, Ratio, Resolution};
type CSSNumber = f32;
type CSSInteger = i32;

// ───────────────────────── QueryCondition trait ─────────────────────────

/// Trait modeling Zig's `ValidQueryCondition` comptime interface check.
/// Any type that can appear as a node in a query-condition tree.
pub trait QueryCondition: Sized {
    fn parse_feature(input: &mut Parser) -> Result<Self>;
    fn create_negation(condition: Box<Self>) -> Self;
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self;
    fn parse_style_query(input: &mut Parser) -> Result<Self>;
    fn needs_parens(
        &self,
        parent_operator: Option<Operator>,
        targets: &css::targets::Targets,
    ) -> bool;
}

/// Local `to_css` protocol used by the generic query-condition serializers.
pub trait ToCss {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>;
}

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Operator {
    #[strum(serialize = "and")]
    And,
    #[strum(serialize = "or")]
    Or,
}

/// `only` / `not` media-query qualifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Qualifier {
    #[strum(serialize = "only")]
    Only,
    #[strum(serialize = "not")]
    Not,
}

/// A [media type](https://drafts.csswg.org/mediaqueries/#media-types).
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
            // SAFETY: arena-owned slices valid for the MediaList lifetime.
            (Self::Custom(a), Self::Custom(b)) => unsafe { *a.v == *b.v },
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
#[derive(Debug, Clone)]
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

// PORT NOTE: derive(PartialEq) blocked on `Ident`/`EnvironmentVariable` lacking
// PartialEq while `values/` is gated; hand-roll the comparable arms.
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
            // SAFETY: arena-owned slice valid for the MediaList lifetime.
            (V::Ident(a), V::Ident(b)) => unsafe { *a.v == *b.v },
            // EnvironmentVariable tree equality — loud `todo!()` until
            // `properties::custom` gains PartialEq; silently returning false
            // is forbidden (PORTING.md §Forbidden patterns: silent-no-op).
            (V::Env(_), V::Env(_)) => {
                todo!("MediaFeatureValue::Env PartialEq — gated on EnvironmentVariable: PartialEq")
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
            Orientation | OverflowBlock | OverflowInline | DisplayMode | Scan | Update
            | EnvironmentBlending | ColorGamut | DynamicRange | InvertedColors | Pointer
            | Hover | AnyPointer | AnyHover | NavControls | VideoColorGamut | VideoDynamicRange
            | Scripting | PrefersReducedMotion | PrefersReducedTransparency | PrefersContrast
            | ForcedColors | PrefersColorScheme | PrefersReducedData => T::Ident,
            HorizontalViewportSegments | VerticalViewportSegments | Color | ColorIndex
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
        macro_rules! lookup {
            ($($lit:literal => $variant:ident),* $(,)?) => {{
                $(if s.eq_ignore_ascii_case($lit) { return Some($variant); })*
                None
            }};
        }
        lookup! {
            b"width" => Width,
            b"height" => Height,
            b"aspect-ratio" => AspectRatio,
            b"orientation" => Orientation,
            b"overflow-block" => OverflowBlock,
            b"overflow-inline" => OverflowInline,
            b"horizontal-viewport-segments" => HorizontalViewportSegments,
            b"vertical-viewport-segments" => VerticalViewportSegments,
            b"display-mode" => DisplayMode,
            b"resolution" => Resolution,
            b"scan" => Scan,
            b"grid" => Grid,
            b"update" => Update,
            b"environment-blending" => EnvironmentBlending,
            b"color" => Color,
            b"color-index" => ColorIndex,
            b"monochrome" => Monochrome,
            b"color-gamut" => ColorGamut,
            b"dynamic-range" => DynamicRange,
            b"inverted-colors" => InvertedColors,
            b"pointer" => Pointer,
            b"hover" => Hover,
            b"any-pointer" => AnyPointer,
            b"any-hover" => AnyHover,
            b"nav-controls" => NavControls,
            b"video-color-gamut" => VideoColorGamut,
            b"video-dynamic-range" => VideoDynamicRange,
            b"scripting" => Scripting,
            b"prefers-reduced-motion" => PrefersReducedMotion,
            b"prefers-reduced-transparency" => PrefersReducedTransparency,
            b"prefers-contrast" => PrefersContrast,
            b"forced-colors" => ForcedColors,
            b"prefers-color-scheme" => PrefersColorScheme,
            b"prefers-reduced-data" => PrefersReducedData,
            b"device-width" => DeviceWidth,
            b"device-height" => DeviceHeight,
            b"device-aspect-ratio" => DeviceAspectRatio,
            b"-webkit-device-pixel-ratio" => WebkitDevicePixelRatio,
            b"-moz-device-pixel-ratio" => MozDevicePixelRatio,
        }
    }
}

// ───────────────────────── to_css / matching ─────────────────────────
// Un-gated this round so `rules::media::MediaRule::{minify,to_css}` can call
// `MediaList::{always_matches,never_matches,to_css}`. The serialization tree
// bottoms out at `MediaFeatureValue::to_css`; the `Length`/`Resolution`/`Ratio`
// arms there remain `todo!()`-loud until the local `value_shims` are replaced
// by the real `crate::css_values::{length,resolution,ratio}` types.

impl MediaList {
    /// Returns whether the media query list always matches.
    pub fn always_matches(&self) -> bool {
        // If the media list is empty, it always matches.
        self.media_queries.is_empty()
            || self.media_queries.iter().all(MediaQuery::always_matches)
    }

    /// Returns whether the media query list never matches.
    pub fn never_matches(&self) -> bool {
        !self.media_queries.is_empty()
            && self.media_queries.iter().all(MediaQuery::never_matches)
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.media_queries.is_empty() {
            return dest.write_str("not all");
        }
        let mut first = true;
        for query in &self.media_queries {
            if !first {
                dest.delim(b',', false)?;
            }
            first = false;
            query.to_css(dest)?;
        }
        Ok(())
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
                dest.write_str(unsafe { &**desc })?;
            }
        }

        let Some(condition) = &self.condition else { return Ok(()) };

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

impl Qualifier {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // Zig: css.enum_property_util.toCss → lowercase tag name.
        dest.write_str(<&'static str>::from(*self))
    }
}

impl Operator {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // Zig: css.enum_property_util.toCss → lowercase tag name.
        dest.write_str(<&'static str>::from(*self))
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
pub fn operation_to_css<C: QueryCondition + ToCss>(
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
        to_css_with_parens_if_needed(
            item,
            dest,
            item.needs_parens(Some(operator), &dest.targets),
        )?;
    }
    Ok(())
}

impl ToCss for MediaCondition {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaCondition::Feature(f) => f.to_css(dest),
            MediaCondition::Not(c) => {
                dest.write_str("not ")?;
                to_css_with_parens_if_needed(
                    &**c,
                    dest,
                    c.needs_parens(None, &dest.targets),
                )
            }
            MediaCondition::Operation { operator, conditions } => {
                operation_to_css(*operator, conditions.as_slice(), dest)
            }
        }
    }
}

impl QueryCondition for MediaCondition {
    fn parse_feature(_input: &mut Parser) -> Result<Self> {
        // blocked_on: MediaFeature::parse (values/ calc lattice)
        todo!("MediaCondition::parse_feature — gated on QueryFeature::parse")
    }
    fn create_negation(condition: Box<Self>) -> Self {
        MediaCondition::Not(condition)
    }
    fn create_operation(operator: Operator, conditions: Vec<Self>) -> Self {
        MediaCondition::Operation { operator, conditions }
    }
    fn parse_style_query(_input: &mut Parser) -> Result<Self> {
        // Zig: returns input.newErrorForNextToken() — parse path still gated.
        todo!("MediaCondition::parse_style_query — gated on Parser::new_error_for_next_token")
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
            QueryFeature::Range { name, operator, value } => {
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
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            MediaFeatureName::Standard(v) => v.to_css(dest),
            // PORT NOTE: Zig routed through DashedIdentFns.toCss → dest.writeDashedIdent
            // (handles css-module name rewriting). Printer::write_dashed_ident is
            // currently `#[cfg(any())]`-gated; fail loud rather than silently
            // emitting an unscoped ident that diverges from Zig output under
            // css-modules (PORTING.md §Forbidden: silent-no-op).
            MediaFeatureName::Custom(_d) => {
                todo!("MediaFeatureName::Custom to_css gated on Printer::write_dashed_ident")
            }
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
            MediaFeatureName::Custom(_d) => {
                todo!("MediaFeatureName::Custom to_css_with_prefix gated on Printer::write_dashed_ident")
            }
            MediaFeatureName::Unknown(v) => {
                dest.write_str(prefix)?;
                v.to_css(dest)
            }
        }
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
            MediaFeatureValue::Length(_len) => {
                // blocked_on: crate::css_values::length::Length replacing the
                // local value_shims::Length stand-in (calc lattice un-gate).
                todo!("MediaFeatureValue::Length to_css — gated on values::length::Length")
            }
            MediaFeatureValue::Number(num) => css::to_css::float32(*num, dest),
            MediaFeatureValue::Integer(int) => css::to_css::integer(*int, dest),
            MediaFeatureValue::Boolean(b) => {
                if *b { dest.write_char(b'1') } else { dest.write_char(b'0') }
            }
            MediaFeatureValue::Resolution(_res) => {
                todo!("MediaFeatureValue::Resolution to_css — gated on values::resolution::Resolution")
            }
            MediaFeatureValue::Ratio(_ratio) => {
                todo!("MediaFeatureValue::Ratio to_css — gated on values::ratio::Ratio")
            }
            MediaFeatureValue::Ident(id) => id.to_css(dest),
            MediaFeatureValue::Env(_env) => {
                // blocked_on: properties::custom::EnvironmentVariable real body
                // (currently a data-only stub via `gated_prop!`).
                todo!("MediaFeatureValue::Env to_css — gated on properties::custom un-gate")
            }
        }
    }

    /// Zig: `addF32` — adjust by `other` for strict-inequality → min/max
    /// boundary lowering. Consumes `self`.
    pub fn add_f32(self, other: f32) -> MediaFeatureValue {
        match self {
            MediaFeatureValue::Length(_len) => {
                // Zig: len.add(allocator, Length.px(other)) — calc lattice.
                todo!("MediaFeatureValue::Length add_f32 — gated on values::length::Length::add")
            }
            MediaFeatureValue::Number(num) => MediaFeatureValue::Number(num + other),
            MediaFeatureValue::Integer(num) => {
                MediaFeatureValue::Integer(num + if other.is_sign_positive() { 1 } else { -1 })
            }
            MediaFeatureValue::Boolean(v) => MediaFeatureValue::Boolean(v),
            MediaFeatureValue::Resolution(_res) => {
                todo!("MediaFeatureValue::Resolution add_f32 — gated on values::resolution::Resolution::add_f32")
            }
            MediaFeatureValue::Ratio(_ratio) => {
                todo!("MediaFeatureValue::Ratio add_f32 — gated on values::ratio::Ratio::add_f32")
            }
            MediaFeatureValue::Ident(id) => MediaFeatureValue::Ident(id),
            MediaFeatureValue::Env(env) => MediaFeatureValue::Env(env), // TODO: calc support
        }
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

    // PORT NOTE: Zig deepCloned `value` into `dest.allocator` then mutated; here
    // `MediaFeatureValue: Clone` so we clone-by-value. The `Length`/`Resolution`/
    // `Ratio` arms of `add_f32` remain `todo!()` until the value-shims are real.
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

// ───────────────────────── gated impl bodies ─────────────────────────
// Every `parse`/`to_css`/`deep_clone` body below compiles against the
// gated `values/` lattice + `compat::Feature::Media{Range,Interval}Syntax`
// + `ParserError::{InvalidMediaQuery,InvalidValue}` and the (still-shim)
// `Delimiters`-as-struct calling convention. They are preserved here
// `#[cfg(any())]`-gated so the next round can flip them on without
// re-porting from Zig.
#[cfg(any())]
mod __impl_bodies {
    // (full 1500-line port body — see git rev 8b7b16543a:src/css/media_query.rs)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/media_query.zig (1494 lines)
//   confidence: medium
//   todos:      3
//   notes:      module un-gated; all data types real; parse/to_css impl bodies internally gated on values/{length,number,resolution,ratio} + IdentFns/CSSNumberFns + compat::Feature media-range variants; PartialEq for MediaFeatureValue/MediaFeatureName hand-rolled until Ident/EnvironmentVariable gain PartialEq
// ──────────────────────────────────────────────────────────────────────────
