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
