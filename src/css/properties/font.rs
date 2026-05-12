//! CSS font properties.
//!
//! Ported from `src/css/properties/font.zig`.
//
// ─── B-2 round 9 status ────────────────────────────────────────────────────
// Module un-gated from `gated_prop!` so the *data types* (FontWeight /
// AbsoluteFontWeight / FontSize / AbsoluteFontSize / RelativeFontSize /
// FontStretch / FontStretchKeyword / FontFamily / GenericFontFamily /
// FontStyle / FontVariantCaps / LineHeight / Font / VerticalAlign /
// VerticalAlignKeyword / FontProperty / FontHandler) are real and referenced
// by `properties_generated.rs`, `declaration.rs`, and
// `rules/{font_face,font_palette_values}.rs`.
//
// Most `parse` / `to_css` *bodies* remain ``-gated below
// because they bottom out on still-unported leaf surface (DeriveParse /
// DeriveToCss proc-macros, EnumProperty derive over strum, Vec::parse,
// parse_utility::parse_string, generics::is_compatible blanket). Each gate
// carries a `blocked_on:` note so the next round can lift bodies as their
// deps land.

#![allow(unused_imports, dead_code)]
#![warn(unused_must_use)]

use crate::PrintResult;
use crate::compat::Feature;
use crate::css_parser as css;
use crate::error::ParserError;
use crate::printer::Printer;
use bun_alloc::ArenaVecExt as _;

use crate::values as css_values;
use css_values::angle::Angle;
use css_values::length::{LengthPercentage, LengthValue};
use css_values::number::{CSSNumber, CSSNumberFns};
use css_values::percentage::{DimensionPercentage, Percentage};

use bun_collections::VecExt;

use crate::generics::{CssEql, DeepClone};
use css::CssResult;

/// A value for the [font-weight](https://www.w3.org/TR/css-fonts-4/#font-weight-prop) property.
#[derive(Clone, PartialEq)]
// TODO(port): css.DeriveParse / css.DeriveToCss were comptime-reflection derives; provide proc-macro #[derive(Parse, ToCss)] in Phase B
pub enum FontWeight {
    /// An absolute font weight.
    Absolute(AbsoluteFontWeight),
    /// The `bolder` keyword.
    Bolder,
    /// The `lighter` keyword.
    Lighter,
}

impl FontWeight {
    // PORT NOTE: Zig `css.DeriveParse(@This()).parse` for a union(enum) with one
    // payload variant + 2 keyword variants tries the payload first, then matches
    // the remaining keywords against `expect_ident`.
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(v) = input.try_parse(AbsoluteFontWeight::parse) {
            return Ok(FontWeight::Absolute(v));
        }
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"bolder" => Ok(FontWeight::Bolder),
            b"lighter" => Ok(FontWeight::Lighter),
            _ => Err(location.new_unexpected_token_error(crate::Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            FontWeight::Absolute(a) => a.to_css(dest),
            FontWeight::Bolder => dest.write_str("bolder"),
            FontWeight::Lighter => dest.write_str("lighter"),
        }
    }

    #[inline]
    pub fn default() -> FontWeight {
        FontWeight::Absolute(AbsoluteFontWeight::default())
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            FontWeight::Absolute(a) => a.is_compatible(browsers),
            FontWeight::Bolder | FontWeight::Lighter => true,
        }
    }

    // eql → derived PartialEq
    // deepClone → derived Clone; TODO(port): arena-aware deep_clone if needed in Phase B
}

/// An [absolute font weight](https://www.w3.org/TR/css-fonts-4/#font-weight-absolute-values),
/// as used in the `font-weight` property.
///
/// See [FontWeight](FontWeight).
#[derive(Clone, PartialEq)]
pub enum AbsoluteFontWeight {
    /// An explicit weight.
    Weight(CSSNumber),
    /// Same as `400`.
    Normal,
    /// Same as `700`.
    Bold,
}

impl AbsoluteFontWeight {
    // PORT NOTE: Zig `css.DeriveParse(@This()).parse` — payload (`CSSNumber`) first,
    // then keyword variants.
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(n) = input.try_parse(CSSNumberFns::parse) {
            return Ok(AbsoluteFontWeight::Weight(n));
        }
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"normal" => Ok(AbsoluteFontWeight::Normal),
            b"bold" => Ok(AbsoluteFontWeight::Bold),
            _ => Err(location.new_unexpected_token_error(crate::Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            AbsoluteFontWeight::Weight(weight) => CSSNumberFns::to_css(weight, dest),
            AbsoluteFontWeight::Normal => {
                dest.write_str(if dest.minify { "400" } else { "normal" })
            }
            AbsoluteFontWeight::Bold => dest.write_str(if dest.minify { "700" } else { "bold" }),
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            // Older browsers only supported 100, 200, 300, ...900 rather than arbitrary values.
            AbsoluteFontWeight::Weight(val) => {
                if !((*val >= 100.0 && *val <= 900.0) && (*val % 100.0) == 0.0) {
                    Feature::FontWeightNumber.is_compatible(browsers)
                } else {
                    true
                }
            }
            _ => true,
        }
    }

    #[inline]
    pub fn default() -> AbsoluteFontWeight {
        AbsoluteFontWeight::Normal
    }

    // eql → derived PartialEq
}

/// A value for the [font-size](https://www.w3.org/TR/css-fonts-4/#font-size-prop) property.
#[derive(Clone, PartialEq, css::Parse, css::ToCss)]
pub enum FontSize {
    /// An explicit size.
    Length(LengthPercentage),
    /// An absolute font size keyword.
    Absolute(AbsoluteFontSize),
    /// A relative font size keyword.
    Relative(RelativeFontSize),
}

impl FontSize {
    // parse + to_css — provided by #[derive(css::Parse, css::ToCss)].
    // is_compatible KEPT (custom Rem branch).

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            FontSize::Length(l) => match l {
                DimensionPercentage::Dimension(LengthValue::Rem(_)) => {
                    Feature::FontSizeRem.is_compatible(browsers)
                }
                _ => l.is_compatible(browsers),
            },
            FontSize::Absolute(a) => a.is_compatible(browsers),
            FontSize::Relative(_) => true,
        }
    }

    // eql → derived PartialEq
    // deepClone → derived Clone
}

/// An [absolute font size](https://www.w3.org/TR/css-fonts-3/#absolute-size-value),
/// as used in the `font-size` property.
///
/// See [FontSize](FontSize).
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum AbsoluteFontSize {
    /// "xx-small"
    XxSmall,
    /// "x-small"
    XSmall,
    /// "small"
    Small,
    /// "medium"
    Medium,
    /// "large"
    Large,
    /// "x-large"
    XLarge,
    /// "xx-large"
    XxLarge,
    /// "xxx-large"
    XxxLarge,
}

impl AbsoluteFontSize {
    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            AbsoluteFontSize::XxxLarge => Feature::FontSizeXXXLarge.is_compatible(browsers),
            _ => true,
        }
    }
}

/// A [relative font size](https://www.w3.org/TR/css-fonts-3/#relative-size-value),
/// as used in the `font-size` property.
///
/// See [FontSize](FontSize).
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum RelativeFontSize {
    Smaller,
    Larger,
}

/// A value for the [font-stretch](https://www.w3.org/TR/css-fonts-4/#font-stretch-prop) property.
#[derive(Clone, PartialEq)]
pub enum FontStretch {
    /// A font stretch keyword.
    Keyword(FontStretchKeyword),
    /// A percentage.
    Percentage(Percentage),
}

impl FontStretch {
    // PORT NOTE: Zig `css.DeriveParse(@This()).parse` — two payload variants
    // tried in declaration order.
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(kw) = input.try_parse(FontStretchKeyword::parse) {
            return Ok(FontStretch::Keyword(kw));
        }
        Percentage::parse(input).map(FontStretch::Percentage)
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        if dest.minify {
            let percentage: Percentage = self.into_percentage();
            return percentage.to_css(dest);
        }

        match self {
            FontStretch::Percentage(val) => val.to_css(dest),
            FontStretch::Keyword(kw) => kw.to_css(dest),
        }
    }

    pub fn into_percentage(&self) -> Percentage {
        match self {
            FontStretch::Percentage(val) => *val,
            FontStretch::Keyword(kw) => kw.into_percentage(),
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            FontStretch::Percentage(_) => Feature::FontStretchPercentage.is_compatible(browsers),
            FontStretch::Keyword(_) => true,
        }
    }

    // eql → derived PartialEq
    // deepClone → derived Clone

    #[inline]
    pub fn default() -> FontStretch {
        FontStretch::Keyword(FontStretchKeyword::default())
    }
}

/// A [font stretch keyword](https://www.w3.org/TR/css-fonts-4/#font-stretch-prop),
/// as used in the `font-stretch` property.
///
/// See [FontStretch](FontStretch).
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum FontStretchKeyword {
    /// 100%
    Normal,
    /// 50%
    UltraCondensed,
    /// 62.5%
    ExtraCondensed,
    /// 75%
    Condensed,
    /// 87.5%
    SemiCondensed,
    /// 112.5%
    SemiExpanded,
    /// 125%
    Expanded,
    /// 150%
    ExtraExpanded,
    /// 200%
    UltraExpanded,
}

impl FontStretchKeyword {
    #[inline]
    pub fn default() -> FontStretchKeyword {
        FontStretchKeyword::Normal
    }

    pub fn into_percentage(&self) -> Percentage {
        let val: f32 = match self {
            FontStretchKeyword::UltraCondensed => 0.5,
            FontStretchKeyword::ExtraCondensed => 0.625,
            FontStretchKeyword::Condensed => 0.75,
            FontStretchKeyword::SemiCondensed => 0.875,
            FontStretchKeyword::Normal => 1.0,
            FontStretchKeyword::SemiExpanded => 1.125,
            FontStretchKeyword::Expanded => 1.25,
            FontStretchKeyword::ExtraExpanded => 1.5,
            FontStretchKeyword::UltraExpanded => 2.0,
        };
        Percentage { v: val }
    }
}

/// A value for the [font-family](https://www.w3.org/TR/css-fonts-4/#font-family-prop) property.
pub enum FontFamily {
    /// A generic family name.
    Generic(GenericFontFamily),
    /// A custom family name.
    // TODO(port): arena-backed slice — should be &'bump [u8] once 'bump lifetime is threaded in Phase B
    // PORT NOTE: with *const [u8] derived PartialEq/Eq/Hash would compare by pointer; Zig's custom
    // HashContext hashes/compares by content (Wyhash over bytes) — provide manual impls below.
    FamilyName(*const [u8]),
}

// TODO(port): Zig defined `pub fn HashMap(comptime V: type) type` wrapping std.ArrayHashMapUnmanaged
// with a custom Wyhash hasher over the family-name bytes. Module-level alias (inherent assoc types are nightly-only).
// blocked_on: ArrayHashMap key trait bounds for FontFamily
pub type FontFamilyHashMap<V> = bun_collections::ArrayHashMap<FontFamily, V>;

impl FontFamily {
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(value) =
            input.try_parse(|p| p.expect_string().map(|s| std::ptr::from_ref::<[u8]>(s)))
        {
            // arena-owned: parser slice lives for 'bump
            return Ok(FontFamily::FamilyName(value));
        }

        if let Ok(value) = input.try_parse(GenericFontFamily::parse) {
            return Ok(FontFamily::Generic(value));
        }

        // SAFETY: arena outlives the returned `FontFamily` (parser source/arena lives for 'bump).
        let bump: &'static bun_alloc::Arena =
            unsafe { &*std::ptr::from_ref::<bun_alloc::Arena>(input.arena()) };
        let value: *const [u8] = std::ptr::from_ref::<[u8]>(input.expect_ident()?);
        // AST crate: ArrayListUnmanaged fed input.arena() (arena) → bumpalo Vec
        let mut string: Option<bun_alloc::ArenaVec<'_, u8>> = None;
        while let Ok(ident) =
            input.try_parse(|p| p.expect_ident().map(|s| std::ptr::from_ref::<[u8]>(s)))
        {
            if string.is_none() {
                let mut s = bun_alloc::ArenaVec::<u8>::new_in(bump);
                // SAFETY: arena-owned slice valid for 'bump.
                s.extend_from_slice(unsafe { crate::arena_str(value) });
                string = Some(s);
            }

            if let Some(s) = string.as_mut() {
                s.push(b' ');
                // SAFETY: arena-owned slice valid for 'bump.
                s.extend_from_slice(unsafe { crate::arena_str(ident) });
            }
        }

        let final_value: *const [u8] = match string {
            Some(s) => std::ptr::from_ref::<[u8]>(s.into_bump_slice()),
            None => value,
        };

        Ok(FontFamily::FamilyName(final_value))
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            FontFamily::Generic(val) => val.to_css(dest),
            FontFamily::FamilyName(val_ptr) => {
                // SAFETY: arena-owned slice valid for 'bump (parser/printer arena outlives FontFamily)
                let val: &[u8] = unsafe { crate::arena_str(*val_ptr) };
                // Generic family names such as sans-serif must be quoted if parsed as a string.
                // CSS wide keywords, as well as "default", must also be quoted.
                // https://www.w3.org/TR/css-fonts-4/#family-name-syntax

                if !val.is_empty()
                    && !css::parse_utility::parse_string::<GenericFontFamily>(
                        dest.arena,
                        val,
                        GenericFontFamily::parse,
                    )
                    .is_ok()
                {
                    // AST crate: std.Io.Writer.Allocating on dest.arena (arena) → bumpalo Vec
                    let mut id = bun_alloc::ArenaVec::<u8>::new_in(dest.arena);
                    let mut first = true;
                    for slice in val.split(|b| *b == b' ') {
                        if first {
                            first = false;
                        } else {
                            id.push(b' ');
                        }
                        // `ArenaVec<u8>: WriteAll<Error = Infallible>` — cannot fail.
                        let _ = css::serializer::serialize_identifier(slice, &mut id);
                    }
                    if id.len() < val.len() + 2 {
                        return dest.write_str(&id[..]);
                    }
                }
                dest.serialize_string(val)
            }
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            FontFamily::Generic(g) => g.is_compatible(browsers),
            FontFamily::FamilyName(_) => true,
        }
    }

    // eql / hash / deepClone — `PartialEq`/`Clone` hand-impls below; bridged to
    // `CssEql`/`DeepClone` via `bridge_clone_partialeq!` in `generics.rs`.
}

// PORT NOTE: Zig's `css.implementEql` / `css.implementHash` walked fields by
// reflection and compared/hashed `[]const u8` by *content*. With `*const [u8]`
// in Rust, derived `PartialEq`/`Hash` would compare pointers, so hand-roll.
impl PartialEq for FontFamily {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (FontFamily::Generic(a), FontFamily::Generic(b)) => a == b,
            (FontFamily::FamilyName(a), FontFamily::FamilyName(b)) => {
                // SAFETY: arena-owned slices valid for the parse session.
                unsafe { (&**a).eq(&**b) }
            }
            _ => false,
        }
    }
}
impl Eq for FontFamily {}

impl core::hash::Hash for FontFamily {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        // PORT NOTE: Zig `css.implementHash` hashes the active tag then the
        // payload bytes. With `*const [u8]` a derived Hash would hash the
        // pointer address, breaking FontFamilyHashMap dedupe semantics.
        core::mem::discriminant(self).hash(state);
        match self {
            FontFamily::Generic(g) => g.hash(state),
            FontFamily::FamilyName(p) => {
                // SAFETY: arena-owned slice valid for the parse session.
                unsafe { (&**p).hash(state) }
            }
        }
    }
}

impl Clone for FontFamily {
    fn clone(&self) -> Self {
        // PORT NOTE: shallow — arena slice pointers are `Copy`; matches Zig's
        // implicit struct copy. `deepClone` would re-alloc the slice in 'bump.
        match self {
            FontFamily::Generic(g) => FontFamily::Generic(*g),
            FontFamily::FamilyName(n) => FontFamily::FamilyName(*n),
        }
    }
}

/// A [generic font family](https://www.w3.org/TR/css-fonts-4/#generic-font-families) name,
/// as used in the `font-family` property.
///
/// See [FontFamily](FontFamily).
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum GenericFontFamily {
    Serif,
    SansSerif,
    Cursive,
    Fantasy,
    Monospace,
    SystemUi,
    Emoji,
    Math,
    Fangsong,
    UiSerif,
    UiSansSerif,
    UiMonospace,
    UiRounded,

    // CSS wide keywords. These must be parsed as identifiers so they
    // don't get serialized as strings.
    // https://www.w3.org/TR/css-values-4/#common-keywords
    Initial,
    Inherit,
    Unset,
    // Default is also reserved by the <custom-ident> type.
    // https://www.w3.org/TR/css-values-4/#custom-idents
    Default,

    // CSS defaulting keywords
    // https://drafts.csswg.org/css-cascade-5/#defaulting-keywords
    Revert,
    RevertLayer,
}

impl GenericFontFamily {
    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            GenericFontFamily::SystemUi => Feature::FontFamilySystemUi.is_compatible(browsers),
            GenericFontFamily::UiSerif
            | GenericFontFamily::UiSansSerif
            | GenericFontFamily::UiMonospace
            | GenericFontFamily::UiRounded => Feature::ExtendedSystemFonts.is_compatible(browsers),
            _ => true,
        }
    }
}

/// A value for the [font-style](https://www.w3.org/TR/css-fonts-4/#font-style-prop) property.
#[derive(Clone, Copy, PartialEq)]
pub enum FontStyle {
    /// Normal font style.
    Normal,
    /// Italic font style.
    Italic,
    /// Oblique font style, with a custom angle.
    Oblique(Angle),
}

impl FontStyle {
    pub fn default() -> FontStyle {
        FontStyle::Normal
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<FontStyle> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"normal" => Ok(FontStyle::Normal),
            b"italic" => Ok(FontStyle::Italic),
            b"oblique" => {
                let angle = input
                    .try_parse(Angle::parse)
                    .unwrap_or(FontStyle::default_oblique_angle());
                Ok(FontStyle::Oblique(angle))
            },
            _ => Err(location.new_unexpected_token_error(crate::Token::Ident(ident))),
        }}
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            FontStyle::Normal => dest.write_str("normal"),
            FontStyle::Italic => dest.write_str("italic"),
            FontStyle::Oblique(angle) => {
                dest.write_str("oblique")?;
                if *angle != FontStyle::default_oblique_angle() {
                    dest.write_char(b' ')?;
                    angle.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            FontStyle::Oblique(angle) => {
                if *angle != FontStyle::default_oblique_angle() {
                    Feature::FontStyleObliqueAngle.is_compatible(browsers)
                } else {
                    true
                }
            }
            FontStyle::Normal | FontStyle::Italic => true,
        }
    }

    pub fn default_oblique_angle() -> Angle {
        Angle::Deg(14.0)
    }

    // eql → derived PartialEq
    // deepClone → derived Clone
}

/// A value for the [font-variant-caps](https://www.w3.org/TR/css-fonts-4/#font-variant-caps-prop) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum FontVariantCaps {
    /// No special capitalization features are applied.
    Normal,
    /// The small capitals feature is used for lower case letters.
    SmallCaps,
    /// Small capitals are used for both upper and lower case letters.
    AllSmallCaps,
    /// Petite capitals are used.
    PetiteCaps,
    /// Petite capitals are used for both upper and lower case letters.
    AllPetiteCaps,
    /// Enables display of mixture of small capitals for uppercase letters with normal lowercase letters.
    Unicase,
    /// Uses titling capitals.
    TitlingCaps,
}

impl FontVariantCaps {
    pub fn default() -> FontVariantCaps {
        FontVariantCaps::Normal
    }

    fn is_css2(&self) -> bool {
        matches!(self, FontVariantCaps::Normal | FontVariantCaps::SmallCaps)
    }

    pub fn parse_css2(input: &mut css::Parser) -> CssResult<FontVariantCaps> {
        let value = FontVariantCaps::parse(input)?;
        if !value.is_css2() {
            return Err(input.new_custom_error(ParserError::invalid_value));
        }
        Ok(value)
    }

    pub fn is_compatible(&self, _: crate::targets::Browsers) -> bool {
        true
    }
}

/// A value for the [line-height](https://www.w3.org/TR/2020/WD-css-inline-3-20200827/#propdef-line-height) property.
#[derive(Clone, PartialEq)]
pub enum LineHeight {
    /// The UA sets the line height based on the font.
    Normal,
    /// A multiple of the element's font size.
    Number(CSSNumber),
    /// An explicit height.
    Length(LengthPercentage),
}

impl LineHeight {
    // PORT NOTE: Zig `css.DeriveParse(@This()).parse` — keyword variant first
    // (`normal`), then payload variants in declaration order.
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if input
            .try_parse(|p| p.expect_ident_matching(b"normal"))
            .is_ok()
        {
            return Ok(LineHeight::Normal);
        }
        if let Ok(n) = input.try_parse(CSSNumberFns::parse) {
            return Ok(LineHeight::Number(n));
        }
        LengthPercentage::parse(input).map(LineHeight::Length)
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            LineHeight::Normal => dest.write_str("normal"),
            LineHeight::Number(n) => CSSNumberFns::to_css(n, dest),
            LineHeight::Length(l) => l.to_css(dest),
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            LineHeight::Length(l) => l.is_compatible(browsers),
            LineHeight::Normal | LineHeight::Number(_) => true,
        }
    }

    // eql → derived PartialEq
    // deepClone → derived Clone

    pub fn default() -> LineHeight {
        LineHeight::Normal
    }
}

/// A value for the [font](https://www.w3.org/TR/css-fonts-4/#font-prop) shorthand property.
// PORT NOTE: Zig's `eql`/`deepClone` were reflection-based (`css.implementEql`
// / `css.implementDeepClone`); the field-wise `#[derive(DeepClone, CssEql)]`
// is the Rust equivalent — every field type carries the trait via the
// blankets/bridges in `generics.rs`.
#[derive(DeepClone, CssEql)]
pub struct Font {
    /// The font family.
    pub family: Vec<FontFamily>,
    /// The font size.
    pub size: FontSize,
    /// The font style.
    pub style: FontStyle,
    /// The font weight.
    pub weight: FontWeight,
    /// The font stretch.
    pub stretch: FontStretch,
    /// The line height.
    pub line_height: LineHeight,
    /// How the text should be capitalized. Only CSS 2.1 values are supported.
    pub variant_caps: FontVariantCaps,
}

impl Font {
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.font, PropertyFieldMap);

    // TODO(port): PropertyFieldMap was a comptime anon-struct mapping field names → PropertyIdTag,
    // consumed by DefineShorthand reflection. Represent as a const array for Phase B codegen.
    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, crate::properties::PropertyIdTag)] = &[
        ("family", crate::properties::PropertyIdTag::FontFamily),
        ("size", crate::properties::PropertyIdTag::FontSize),
        ("style", crate::properties::PropertyIdTag::FontStyle),
        ("weight", crate::properties::PropertyIdTag::FontWeight),
        ("stretch", crate::properties::PropertyIdTag::FontStretch),
        ("line_height", crate::properties::PropertyIdTag::LineHeight),
        (
            "variant_caps",
            crate::properties::PropertyIdTag::FontVariantCaps,
        ),
    ];

    pub fn parse(input: &mut css::Parser) -> CssResult<Font> {
        let mut style: Option<FontStyle> = None;
        let mut weight: Option<FontWeight> = None;
        let mut stretch: Option<FontStretch> = None;
        let mut size: Option<FontSize> = None;
        let mut variant_caps: Option<FontVariantCaps> = None;
        let mut count: i32 = 0;

        loop {
            // Skip "normal" since it is valid for several properties, but we don't know which ones it will be used for yet.
            if input
                .try_parse(|i| i.expect_ident_matching(b"normal"))
                .is_ok()
            {
                count += 1;
                continue;
            }

            if style.is_none() {
                if let Ok(value) = input.try_parse(FontStyle::parse) {
                    style = Some(value);
                    count += 1;
                    continue;
                }
            }

            if weight.is_none() {
                if let Ok(value) = input.try_parse(FontWeight::parse) {
                    weight = Some(value);
                    count += 1;
                    continue;
                }
            }

            if variant_caps.is_some() {
                // PORT NOTE: Zig has `if (variant_caps != null)` here — preserved verbatim (likely upstream bug; should be `== null`)
                if let Ok(value) = input.try_parse(FontVariantCaps::parse_css2) {
                    variant_caps = Some(value);
                    count += 1;
                    continue;
                }
            }

            if stretch.is_none() {
                if let Ok(value) = input.try_parse(FontStretchKeyword::parse) {
                    stretch = Some(FontStretch::Keyword(value));
                    count += 1;
                    continue;
                }
            }

            size = Some(FontSize::parse(input)?);
            break;
        }

        if count > 4 {
            return Err(input.new_custom_error(ParserError::invalid_declaration));
        }

        let final_size = match size {
            Some(s) => s,
            None => return Err(input.new_custom_error(ParserError::invalid_declaration)),
        };

        let line_height = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
            Some(LineHeight::parse(input)?)
        } else {
            None
        };

        // PORT NOTE: Zig `Vec(FontFamily).parse` parsed a comma-separated
        // list and packed it; route through `parse_comma_separated` + move.
        let family = input
            .parse_comma_separated(FontFamily::parse)
            .map(Vec::<FontFamily>::move_from_list)?;

        Ok(Font {
            family,
            size: final_size,
            style: style.unwrap_or_else(FontStyle::default),
            weight: weight.unwrap_or_else(FontWeight::default),
            stretch: stretch.unwrap_or_else(FontStretch::default),
            line_height: line_height.unwrap_or_else(LineHeight::default),
            variant_caps: variant_caps.unwrap_or_else(FontVariantCaps::default),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        if self.style != FontStyle::default() {
            self.style.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        if self.variant_caps != FontVariantCaps::default() {
            self.variant_caps.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        if self.weight != FontWeight::default() {
            self.weight.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        if self.stretch != FontStretch::default() {
            self.stretch.to_css(dest)?;
            dest.write_char(b' ')?;
        }

        self.size.to_css(dest)?;

        if self.line_height != LineHeight::default() {
            dest.delim(b'/', true)?;
            self.line_height.to_css(dest)?;
        }

        dest.write_char(b' ')?;

        let len = self.family.len();
        for (idx, val) in self.family.slice_const().iter().enumerate() {
            val.to_css(dest)?;
            if idx < len - 1 {
                dest.delim(b',', false)?;
            }
        }
        Ok(())
    }

    // eql → css::implementEql (Phase B generics blanket)
    // deepClone → css::implementDeepClone (Phase B generics blanket)
}

/// A value for the [vertical align](https://drafts.csswg.org/css2/#propdef-vertical-align) property.
// TODO: there is a more extensive spec in CSS3 but it doesn't seem any browser implements it? https://www.w3.org/TR/css-inline-3/#transverse-alignment
#[derive(Clone, PartialEq)]
pub enum VerticalAlign {
    /// A vertical align keyword.
    Keyword(VerticalAlignKeyword),
    /// An explicit length.
    Length(LengthPercentage),
}

/// A keyword for the [vertical align](https://drafts.csswg.org/css2/#propdef-vertical-align) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum VerticalAlignKeyword {
    /// Align the baseline of the box with the baseline of the parent box.
    Baseline,
    /// Lower the baseline of the box to the proper position for subscripts of the parent's box.
    Sub,
    /// Raise the baseline of the box to the proper position for superscripts of the parent's box.
    Super,
    /// Align the top of the aligned subtree with the top of the line box.
    Top,
    /// Align the top of the box with the top of the parent's content area.
    TextTop,
    /// Align the vertical midpoint of the box with the baseline of the parent box plus half the x-height of the parent.
    Middle,
    /// Align the bottom of the aligned subtree with the bottom of the line box.
    Bottom,
    /// Align the bottom of the box with the bottom of the parent's content area.
    TextBottom,
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub struct FontProperty: u8 {
        const FONT_FAMILY       = 1 << 0;
        const FONT_SIZE         = 1 << 1;
        const FONT_STYLE        = 1 << 2;
        const FONT_WEIGHT       = 1 << 3;
        const FONT_STRETCH      = 1 << 4;
        const LINE_HEIGHT       = 1 << 5;
        const FONT_VARIANT_CAPS = 1 << 6;
        // __unused: u1 = 0 — bit 7 reserved
    }
}

impl FontProperty {
    const FONT: FontProperty = FontProperty::all();

    pub fn try_from_property_id(
        property_id: crate::properties::PropertyIdTag,
    ) -> Option<FontProperty> {
        // TODO(port): Zig used `inline for` over std.meta.fields + @field; expanded by hand
        use crate::properties::PropertyIdTag;
        match property_id {
            PropertyIdTag::FontFamily => Some(FontProperty::FONT_FAMILY),
            PropertyIdTag::FontSize => Some(FontProperty::FONT_SIZE),
            PropertyIdTag::FontStyle => Some(FontProperty::FONT_STYLE),
            PropertyIdTag::FontWeight => Some(FontProperty::FONT_WEIGHT),
            PropertyIdTag::FontStretch => Some(FontProperty::FONT_STRETCH),
            PropertyIdTag::LineHeight => Some(FontProperty::LINE_HEIGHT),
            PropertyIdTag::FontVariantCaps => Some(FontProperty::FONT_VARIANT_CAPS),
            PropertyIdTag::Font => Some(FontProperty::FONT),
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct FontHandler {
    family: Option<Vec<FontFamily>>,
    size: Option<FontSize>,
    style: Option<FontStyle>,
    weight: Option<FontWeight>,
    stretch: Option<FontStretch>,
    line_height: Option<LineHeight>,
    variant_caps: Option<FontVariantCaps>,
    flushed_properties: FontProperty,
    has_any: bool,
}

impl FontHandler {
    // blocked_on: generics::is_compatible/eql/deepClone blankets,
    // PropertyHandlerContext::arena(), DeclarationList::push,
    // Property::Font*/Unparsed payloads, FontFamilyHashMap.
    pub fn handle_property(
        &mut self,
        property: &crate::properties::Property,
        dest: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) -> bool {
        use crate::properties::Property;
        // PORT NOTE: `arena` field dropped from PropertyHandlerContext; the
        // arena is recovered via `dest.bump()` (DeclarationList = bumpalo::Vec).
        let arena = dest.bump();

        // TODO(port): Zig used `comptime prop: []const u8` + @field for property_helper / flush_helper / push.
        // No Rust equivalent for field-name reflection — expanded as macro_rules! over (handler_field, Property variant, FontProperty flag).
        macro_rules! flush_helper {
            ($this:expr, $field:ident, $val:expr) => {{
                if $this.$field.is_some()
                    && !crate::generic::eql($this.$field.as_ref().unwrap(), $val)
                    && context.targets.browsers.is_some()
                    && !crate::generic::is_compatible($val, context.targets.browsers.unwrap())
                {
                    $this.flush(dest, context);
                }
            }};
        }

        macro_rules! property_helper {
            ($this:expr, $field:ident, $val:expr) => {{
                flush_helper!($this, $field, $val);
                $this.$field = Some(crate::generic::deep_clone($val, arena));
                $this.has_any = true;
            }};
        }

        match property {
            Property::FontFamily(val) => property_helper!(self, family, val),
            Property::FontSize(val) => property_helper!(self, size, val),
            Property::FontStyle(val) => property_helper!(self, style, val),
            Property::FontWeight(val) => property_helper!(self, weight, val),
            Property::FontStretch(val) => property_helper!(self, stretch, val),
            Property::FontVariantCaps(val) => property_helper!(self, variant_caps, val),
            Property::LineHeight(val) => property_helper!(self, line_height, val),
            Property::Font(val) => {
                flush_helper!(self, family, &val.family);
                flush_helper!(self, size, &val.size);
                flush_helper!(self, style, &val.style);
                flush_helper!(self, weight, &val.weight);
                flush_helper!(self, stretch, &val.stretch);
                flush_helper!(self, line_height, &val.line_height);
                flush_helper!(self, variant_caps, &val.variant_caps);

                self.family = Some(crate::generic::deep_clone(&val.family, arena));
                self.size = Some(val.size.clone());
                self.style = Some(val.style);
                self.weight = Some(val.weight.clone());
                self.stretch = Some(val.stretch.clone());
                self.line_height = Some(val.line_height.clone());
                self.variant_caps = Some(val.variant_caps);
                self.has_any = true;
                // TODO: reset other properties
            }
            Property::Unparsed(val) => {
                if is_font_property(&val.property_id) {
                    self.flush(dest, context);
                    self.flushed_properties
                        .insert(FontProperty::try_from_property_id(val.property_id.tag()).unwrap());
                    // PERF(port): was dest.append(context.arena, property.*) on arena
                    dest.push(property.deep_clone(arena));
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub fn finalize(
        &mut self,
        decls: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) {
        self.flush(decls, context);
        self.flushed_properties = FontProperty::empty();
    }

    // blocked_on: FontFamilyHashMap, PropertyHandlerContext::arena(),
    // Vec::ordered_remove/insert/at, generics::is_compatible.
    fn flush(
        &mut self,
        decls: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) {
        use crate::properties::Property;

        macro_rules! push_prop {
            (Font, $val:expr) => {{
                // PERF(port): was dest.append(ctx.arena, ..) on arena-backed list
                decls.push(Property::Font($val));
                self.flushed_properties.insert(FontProperty::FONT);
            }};
            ($variant:ident, $flag:ident, $val:expr) => {{
                decls.push(Property::$variant($val));
                self.flushed_properties.insert(FontProperty::$flag);
            }};
        }

        if !self.has_any {
            return;
        }

        self.has_any = false;

        let mut family: Option<Vec<FontFamily>> = self.family.take();
        if !self.flushed_properties.contains(FontProperty::FONT_FAMILY) {
            family = compatible_font_family(
                family,
                !context
                    .targets
                    .should_compile_same(Feature::FontFamilySystemUi),
            );
        }

        let size: Option<FontSize> = self.size.take();
        let style: Option<FontStyle> = self.style.take();
        let weight: Option<FontWeight> = self.weight.take();
        let stretch: Option<FontStretch> = self.stretch.take();
        let line_height: Option<LineHeight> = self.line_height.take();
        let variant_caps: Option<FontVariantCaps> = self.variant_caps.take();

        if let Some(f) = family.as_mut() {
            if f.len() > 1 {
                // Dedupe
                // PERF(port): was std.heap.stackFallback(664, default_allocator) — profile in Phase B
                let mut seen: FontFamilyHashMap<()> = Default::default();

                let mut i: usize = 0;
                while i < f.len() {
                    // TODO(port): seen.getOrPut equivalent — using entry API
                    let key = f.at(i).clone();
                    if seen.contains_key(&key) {
                        let _ = f.ordered_remove(i);
                    } else {
                        seen.insert(key, ());
                        i += 1;
                    }
                }
            }
        }

        if let (Some(_), Some(_), Some(_), Some(_), Some(_), Some(_), Some(variant_caps_v)) = (
            family.as_ref(),
            size.as_ref(),
            style.as_ref(),
            weight.as_ref(),
            stretch.as_ref(),
            line_height.as_ref(),
            variant_caps.as_ref(),
        ) {
            let caps = *variant_caps_v;
            push_prop!(
                Font,
                Font {
                    family: family.unwrap(),
                    size: size.unwrap(),
                    style: style.unwrap(),
                    weight: weight.unwrap(),
                    stretch: stretch.unwrap(),
                    line_height: line_height.unwrap(),
                    variant_caps: if caps.is_css2() {
                        caps
                    } else {
                        FontVariantCaps::default()
                    },
                }
            );

            // The `font` property only accepts CSS 2.1 values for font-variant caps.
            // If we have a CSS 3+ value, we need to add a separate property.
            if !caps.is_css2() {
                push_prop!(FontVariantCaps, FONT_VARIANT_CAPS, caps);
            }
        } else {
            if let Some(val) = family {
                push_prop!(FontFamily, FONT_FAMILY, val);
            }

            if let Some(val) = size {
                push_prop!(FontSize, FONT_SIZE, val);
            }

            if let Some(val) = style {
                push_prop!(FontStyle, FONT_STYLE, val);
            }

            if let Some(val) = variant_caps {
                push_prop!(FontVariantCaps, FONT_VARIANT_CAPS, val);
            }

            if let Some(val) = weight {
                push_prop!(FontWeight, FONT_WEIGHT, val);
            }

            if let Some(val) = stretch {
                push_prop!(FontStretch, FONT_STRETCH, val);
            }

            if let Some(val) = line_height {
                push_prop!(LineHeight, LINE_HEIGHT, val);
            }
        }
    }
}

// TODO(port): SYSTEM_UI was `const FontFamily = .{ .generic = .system_ui }`; cannot be a `const` here
// because FontFamily contains a raw pointer. Compare against the Generic variant directly instead.
fn is_system_ui(f: &FontFamily) -> bool {
    matches!(f, FontFamily::Generic(GenericFontFamily::SystemUi))
}

const DEFAULT_SYSTEM_FONTS: &[&[u8]] = &[
    // #1: Supported as the '-apple-system' value (macOS, Safari >= 9.2 < 11, Firefox >= 43)
    b"-apple-system",
    // #2: Supported as the 'BlinkMacSystemFont' value (macOS, Chrome < 56)
    b"BlinkMacSystemFont",
    b"Segoe UI",  // Windows >= Vista
    b"Roboto",    // Android >= 4
    b"Noto Sans", // Plasma >= 5.5
    b"Ubuntu",    // Ubuntu >= 10.10
    b"Cantarell", // GNOME >= 3
    b"Helvetica Neue",
];

// blocked_on: Vec::insert arena threading + arena Bump param.
#[inline]
fn compatible_font_family(
    _family: Option<Vec<FontFamily>>,
    is_supported: bool,
) -> Option<Vec<FontFamily>> {
    let mut family = _family;
    if is_supported {
        return family;
    }

    if let Some(families) = family.as_mut() {
        // PORT NOTE: Zig (font.zig:1029-1035) iterates `families.sliceConst()`
        // by value while inserting into `families` mid-loop, then `break`s.
        // In Rust the immutable slice borrow would alias the &mut needed for
        // `insert` (and `insert` may reallocate, invalidating the iterator).
        // Reshape: capture the system-ui index first, drop the borrow, then
        // perform the inserts using the captured index.
        if let Some(i) = families.slice_const().iter().position(is_system_ui) {
            for (j, name) in DEFAULT_SYSTEM_FONTS.iter().enumerate() {
                // TODO(port): families.insert(arena, idx, val) — Vec::insert with arena
                families.insert(
                    i + j + 1,
                    FontFamily::FamilyName(std::ptr::from_ref::<[u8]>(*name)),
                );
            }
        }
    }

    family
}

#[inline]
fn is_font_property(property_id: &crate::properties::PropertyId) -> bool {
    use crate::properties::PropertyId;
    matches!(
        property_id,
        PropertyId::FontFamily
            | PropertyId::FontSize
            | PropertyId::FontStyle
            | PropertyId::FontWeight
            | PropertyId::FontStretch
            | PropertyId::FontVariantCaps
            | PropertyId::LineHeight
            | PropertyId::Font
    )
}

// ported from: src/css/properties/font.zig
