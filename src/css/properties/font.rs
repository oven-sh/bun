//! CSS font properties.
//
// The data types (FontWeight / AbsoluteFontWeight / FontSize /
// AbsoluteFontSize / RelativeFontSize /
// FontStretch / FontStretchKeyword / FontFamily / GenericFontFamily /
// FontStyle / FontVariantCaps / LineHeight / Font /
// FontProperty / FontHandler) are real and referenced
// by `properties_generated.rs`, `declaration.rs`, and
// `rules/{font_face,font_palette_values}.rs`.

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
pub enum FontWeight {
    /// An absolute font weight.
    Absolute(AbsoluteFontWeight),
    /// The `bolder` keyword.
    Bolder,
    /// The `lighter` keyword.
    Lighter,
}

impl FontWeight {
    // Tries the payload variant first, then matches the remaining keywords
    // against `expect_ident`.
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Self> {
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            FontWeight::Absolute(a) => a.to_css(dest),
            FontWeight::Bolder => dest.write_str("bolder"),
            FontWeight::Lighter => dest.write_str("lighter"),
        }
    }

    #[inline]
    fn default() -> FontWeight {
        FontWeight::Absolute(AbsoluteFontWeight::default())
    }

    pub(crate) fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        match self {
            FontWeight::Absolute(a) => a.is_compatible(browsers),
            FontWeight::Bolder | FontWeight::Lighter => true,
        }
    }

    // eql → derived PartialEq; deepClone → derived Clone (no arena-owned data)
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
    // Payload (`CSSNumber`) first, then keyword variants.
    fn parse(input: &mut css::Parser) -> CssResult<Self> {
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

    fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            AbsoluteFontWeight::Weight(weight) => CSSNumberFns::to_css(*weight, dest),
            AbsoluteFontWeight::Normal => {
                dest.write_str(if dest.minify { "400" } else { "normal" })
            }
            AbsoluteFontWeight::Bold => dest.write_str(if dest.minify { "700" } else { "bold" }),
        }
    }

    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
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
    fn default() -> AbsoluteFontWeight {
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

    pub(crate) fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
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
    fn is_compatible(self, browsers: &crate::targets::Browsers) -> bool {
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
#[derive(Copy, Clone, PartialEq)]
pub enum FontStretch {
    /// A font stretch keyword.
    Keyword(FontStretchKeyword),
    /// A percentage.
    Percentage(Percentage),
}

impl FontStretch {
    // Two payload variants tried in declaration order.
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(kw) = input.try_parse(FontStretchKeyword::parse) {
            return Ok(FontStretch::Keyword(kw));
        }
        Percentage::parse(input).map(FontStretch::Percentage)
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> PrintResult<()> {
        if dest.minify {
            let percentage: Percentage = self.into_percentage();
            return percentage.to_css(dest);
        }

        match self {
            FontStretch::Percentage(val) => val.to_css(dest),
            FontStretch::Keyword(kw) => kw.to_css(dest),
        }
    }

    fn into_percentage(self) -> Percentage {
        match self {
            FontStretch::Percentage(val) => val,
            FontStretch::Keyword(kw) => kw.into_percentage(),
        }
    }

    pub(crate) fn is_compatible(self, browsers: &crate::targets::Browsers) -> bool {
        match self {
            FontStretch::Percentage(_) => Feature::FontStretchPercentage.is_compatible(browsers),
            FontStretch::Keyword(_) => true,
        }
    }

    // eql → derived PartialEq
    // deepClone → derived Clone

    #[inline]
    fn default() -> FontStretch {
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
    fn default() -> FontStretchKeyword {
        FontStretchKeyword::Normal
    }

    fn into_percentage(self) -> Percentage {
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
    // Arena-backed slice: the pointer targets bytes owned by the parser arena and is
    // only valid while that arena is alive (becomes `&'bump [u8]` once the 'bump
    // lifetime is threaded through these types). With `*const [u8]`, derived
    // PartialEq/Eq/Hash would compare by pointer; the manual impls below
    // hash/compare by content (Wyhash over bytes).
    FamilyName(*const [u8]),
}

type FontFamilyHashMap<V> = bun_collections::ArrayHashMap<FontFamily, V>;

impl FontFamily {
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(value) = input.try_parse(|p| p.expect_string().map(std::ptr::from_ref::<[u8]>)) {
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
        while let Ok(ident) = input.try_parse(|p| p.expect_ident().map(std::ptr::from_ref::<[u8]>))
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
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

    pub(crate) fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        match self {
            FontFamily::Generic(g) => g.is_compatible(browsers),
            FontFamily::FamilyName(_) => true,
        }
    }

    // eql / hash / deepClone — `PartialEq`/`Clone` hand-impls below; bridged to
    // `CssEql`/`DeepClone` via `bridge_clone_partialeq!` in `generics.rs`.
}

// With `*const [u8]`, derived `PartialEq`/`Hash` would compare pointers;
// hand-roll to compare/hash the bytes by *content*.
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
        // Hash the active tag then the payload bytes. With `*const [u8]` a
        // derived Hash would hash the pointer address, breaking
        // FontFamilyHashMap dedupe semantics.
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
        // shallow — arena slice pointers are `Copy`.
        // `deepClone` would re-alloc the slice in 'bump.
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
    fn is_compatible(self, browsers: &crate::targets::Browsers) -> bool {
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
    fn default() -> FontStyle {
        FontStyle::Normal
    }

    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<FontStyle> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"normal" => Ok(FontStyle::Normal),
            b"italic" => Ok(FontStyle::Italic),
            b"oblique" => {
                let angle = input
                    .try_parse(Angle::parse)
                    .unwrap_or_else(|_| FontStyle::default_oblique_angle());
                Ok(FontStyle::Oblique(angle))
            },
            _ => Err(location.new_unexpected_token_error(crate::Token::Ident(ident))),
        }}
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            FontStyle::Normal => dest.write_str("normal"),
            FontStyle::Italic => dest.write_str("italic"),
            FontStyle::Oblique(angle) => {
                dest.write_str("oblique")?;
                if angle != FontStyle::default_oblique_angle() {
                    dest.write_char(b' ')?;
                    angle.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    pub(crate) fn is_compatible(self, browsers: &crate::targets::Browsers) -> bool {
        match self {
            FontStyle::Oblique(angle) => {
                if angle != FontStyle::default_oblique_angle() {
                    Feature::FontStyleObliqueAngle.is_compatible(browsers)
                } else {
                    true
                }
            }
            FontStyle::Normal | FontStyle::Italic => true,
        }
    }

    pub(crate) fn default_oblique_angle() -> Angle {
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
    fn default() -> FontVariantCaps {
        FontVariantCaps::Normal
    }

    fn is_css2(self) -> bool {
        matches!(self, FontVariantCaps::Normal | FontVariantCaps::SmallCaps)
    }

    fn parse_css2(input: &mut css::Parser) -> CssResult<FontVariantCaps> {
        let value = FontVariantCaps::parse(input)?;
        if !value.is_css2() {
            return Err(input.new_custom_error(ParserError::invalid_value));
        }
        Ok(value)
    }

    pub(crate) fn is_compatible(self, _: &crate::targets::Browsers) -> bool {
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
    // Keyword variant first (`normal`), then payload variants in declaration order.
    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Self> {
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            LineHeight::Normal => dest.write_str("normal"),
            LineHeight::Number(n) => CSSNumberFns::to_css(*n, dest),
            LineHeight::Length(l) => l.to_css(dest),
        }
    }

    pub(crate) fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        match self {
            LineHeight::Length(l) => l.is_compatible(browsers),
            LineHeight::Normal | LineHeight::Number(_) => true,
        }
    }

    // eql → derived PartialEq
    // deepClone → derived Clone

    fn default() -> LineHeight {
        LineHeight::Normal
    }
}

/// A value for the [font](https://www.w3.org/TR/css-fonts-4/#font-prop) shorthand property.
// Field-wise `#[derive(DeepClone, CssEql)]` — every field type carries the
// trait via the blankets/bridges in `generics.rs`.
#[derive(DeepClone, CssEql)]
pub struct Font {
    /// The font family.
    pub(crate) family: Vec<FontFamily>,
    /// The font size.
    pub(crate) size: FontSize,
    /// The font style.
    pub(crate) style: FontStyle,
    /// The font weight.
    pub(crate) weight: FontWeight,
    /// The font stretch.
    pub(crate) stretch: FontStretch,
    /// The line height.
    pub(crate) line_height: LineHeight,
    /// How the text should be capitalized. Only CSS 2.1 values are supported.
    pub(crate) variant_caps: FontVariantCaps,
}

impl Font {
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.font, PropertyFieldMap);

    pub(crate) fn parse(input: &mut css::Parser) -> CssResult<Font> {
        let mut style: Option<FontStyle> = None;
        let mut weight: Option<FontWeight> = None;
        let mut stretch: Option<FontStretch> = None;
        let final_size: FontSize;
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
                // Intentionally checks `is_some()` to match upstream lightningcss (likely a bug there; should be `is_none()`)
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

            final_size = FontSize::parse(input)?;
            break;
        }

        if count > 4 {
            return Err(input.new_custom_error(ParserError::invalid_declaration));
        }

        let line_height = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
            Some(LineHeight::parse(input)?)
        } else {
            None
        };

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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
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

    // eql → css::implementEql (generics blanket impl)
    // deepClone → css::implementDeepClone (generics blanket impl)
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct FontProperty: u8 {
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

    fn try_from_property_id(
        property_id: crate::properties::PropertyIdTag,
    ) -> Option<FontProperty> {
        // Keep in sync when new Font* PropertyIdTag variants are added.
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
    pub(crate) fn handle_property(
        &mut self,
        property: &crate::properties::Property,
        dest: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) -> bool {
        use crate::properties::Property;
        // `arena` field dropped from PropertyHandlerContext; the
        // arena is recovered via `dest.bump()` (DeclarationList = bumpalo::Vec).
        let arena = dest.bump();

        // macro_rules! over (handler_field, Property variant, FontProperty flag)
        // for property_helper / flush_helper / push.
        macro_rules! flush_helper {
            ($this:expr, $field:ident, $val:expr) => {{
                if $this.$field.is_some()
                    && !crate::generic::eql($this.$field.as_ref().unwrap(), $val)
                    && context.targets.browsers.is_some()
                    && !crate::generic::is_compatible(
                        $val,
                        context.targets.browsers.as_ref().unwrap(),
                    )
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
                self.stretch = Some(val.stretch);
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
                    dest.push(property.deep_clone(arena));
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub(crate) fn finalize(
        &mut self,
        decls: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) {
        self.flush(decls, context);
        self.flushed_properties = FontProperty::empty();
    }

    fn flush(
        &mut self,
        decls: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) {
        use crate::properties::Property;

        macro_rules! push_prop {
            (Font, $val:expr) => {{
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
                let mut seen: FontFamilyHashMap<()> = Default::default();

                let mut i: usize = 0;
                while i < f.len() {
                    use bun_collections::array_hash_map::MapEntry;
                    match seen.entry(f.at(i).clone()) {
                        MapEntry::Occupied(_) => {
                            let _ = f.ordered_remove(i);
                        }
                        MapEntry::Vacant(v) => {
                            v.insert(());
                            i += 1;
                        }
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

// Matched against the Generic variant directly instead of a const
// (FontFamily holds a raw pointer).
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
        // Iterating the slice while inserting into `families` mid-loop would
        // alias the &mut needed for `insert` (and `insert` may reallocate,
        // invalidating the iterator).
        // Capture the system-ui index first, drop the borrow, then
        // perform the inserts using the captured index.
        if let Some(i) = families.slice_const().iter().position(is_system_ui) {
            for (j, name) in DEFAULT_SYSTEM_FONTS.iter().enumerate() {
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
