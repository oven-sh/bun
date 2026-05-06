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
// Most `parse` / `to_css` *bodies* remain `#[cfg(any())]`-gated below
// because they bottom out on still-unported leaf surface (DeriveParse /
// DeriveToCss proc-macros, EnumProperty derive over strum, BabyList::parse,
// parse_utility::parse_string, generics::is_compatible blanket). Each gate
// carries a `blocked_on:` note so the next round can lift bodies as their
// deps land.

#![allow(unused_imports, dead_code)]

use crate::css_parser as css;
use crate::compat::Feature;
use crate::error::ParserError;
use crate::printer::Printer;
use crate::PrintErr;

use crate::values as css_values;
use css_values::angle::Angle;
use css_values::length::{LengthPercentage, LengthValue};
use css_values::number::{CSSNumber, CSSNumberFns};
use css_values::percentage::{DimensionPercentage, Percentage};

use bun_collections::BabyList;
use bun_string::strings;

type CssResult<T> = css::CssResult<T>;
type PrintResult<T> = core::result::Result<T, PrintErr>;

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
    // TODO: implement this
    #[cfg(any())] // blocked_on: css::DeriveParse(@This()).parse → #[derive(Parse)]
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::DeriveParse::parse(input)
    }
    #[cfg(any())] // blocked_on: css::DeriveToCss(@This()).toCss → #[derive(ToCss)]
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::DeriveToCss::to_css(self, dest)
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
    #[cfg(any())] // blocked_on: css::DeriveParse(@This()).parse → #[derive(Parse)]
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::DeriveParse::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            AbsoluteFontWeight::Weight(weight) => CSSNumberFns::to_css(weight, dest),
            AbsoluteFontWeight::Normal => dest.write_str(if dest.minify { "400" } else { "normal" }),
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
#[derive(Clone, PartialEq)]
pub enum FontSize {
    /// An explicit size.
    Length(LengthPercentage),
    /// An absolute font size keyword.
    Absolute(AbsoluteFontSize),
    /// A relative font size keyword.
    Relative(RelativeFontSize),
}

impl FontSize {
    #[cfg(any())] // blocked_on: css::DeriveParse / css::DeriveToCss → #[derive(Parse, ToCss)]
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::DeriveParse::parse(input)
    }
    #[cfg(any())] // blocked_on: #[derive(ToCss)]
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::DeriveToCss::to_css(self, dest)
    }

    #[cfg(any())] // blocked_on: DimensionPercentage::is_compatible bound (D: IsCompatible)
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
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
// TODO(port): css.DefineEnumProperty provides parse/toCss via @tagName; map to #[derive(EnumProperty)] in Phase B
pub enum AbsoluteFontSize {
    /// "xx-small"
    #[strum(serialize = "xx-small")]
    XxSmall,
    /// "x-small"
    #[strum(serialize = "x-small")]
    XSmall,
    /// "small"
    #[strum(serialize = "small")]
    Small,
    /// "medium"
    #[strum(serialize = "medium")]
    Medium,
    /// "large"
    #[strum(serialize = "large")]
    Large,
    /// "x-large"
    #[strum(serialize = "x-large")]
    XLarge,
    /// "xx-large"
    #[strum(serialize = "xx-large")]
    XxLarge,
    /// "xxx-large"
    #[strum(serialize = "xxx-large")]
    XxxLarge,
}

impl AbsoluteFontSize {
    // TODO(port): DefineEnumProperty: eql/hash/parse/toCss/deepClone — derives above + crate::enum_property_util
    #[cfg(any())] // blocked_on: EnumProperty impl (from_ascii_case_insensitive)
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::enum_property_util::to_css(self, dest)
    }

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
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
// TODO(port): css.DefineEnumProperty
pub enum RelativeFontSize {
    #[strum(serialize = "smaller")]
    Smaller,
    #[strum(serialize = "larger")]
    Larger,
}

impl RelativeFontSize {
    #[cfg(any())] // blocked_on: EnumProperty impl (from_ascii_case_insensitive)
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::enum_property_util::to_css(self, dest)
    }
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
    // TODO: implement this
    #[cfg(any())] // blocked_on: css::DeriveParse(@This()).parse → #[derive(Parse)]
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::DeriveParse::parse(input)
    }

    #[cfg(any())] // blocked_on: Percentage::to_css un-gate
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
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
// TODO(port): css.DefineEnumProperty
pub enum FontStretchKeyword {
    /// 100%
    #[strum(serialize = "normal")]
    Normal,
    /// 50%
    #[strum(serialize = "ultra-condensed")]
    UltraCondensed,
    /// 62.5%
    #[strum(serialize = "extra-condensed")]
    ExtraCondensed,
    /// 75%
    #[strum(serialize = "condensed")]
    Condensed,
    /// 87.5%
    #[strum(serialize = "semi-condensed")]
    SemiCondensed,
    /// 112.5%
    #[strum(serialize = "semi-expanded")]
    SemiExpanded,
    /// 125%
    #[strum(serialize = "expanded")]
    Expanded,
    /// 150%
    #[strum(serialize = "extra-expanded")]
    ExtraExpanded,
    /// 200%
    #[strum(serialize = "ultra-expanded")]
    UltraExpanded,
}

impl FontStretchKeyword {
    #[cfg(any())] // blocked_on: EnumProperty impl (from_ascii_case_insensitive)
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::enum_property_util::to_css(self, dest)
    }

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
#[cfg(any())] // blocked_on: ArrayHashMap key trait bounds for FontFamily
pub type FontFamilyHashMap<V> = bun_collections::ArrayHashMap<FontFamily, V>;

impl FontFamily {
    #[cfg(any())]
    // blocked_on: Parser::expect_string/expect_ident lifetime detachment +
    // GenericFontFamily::parse (EnumProperty impl) + bumpalo::collections::Vec
    // arena threading (`input.allocator()` → &Bump).
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if let Ok(value) = input.try_parse(css::Parser::expect_string) {
            // arena-owned: parser slice lives for 'bump
            return Ok(FontFamily::FamilyName(value as *const [u8]));
        }

        if let Ok(value) = input.try_parse(GenericFontFamily::parse) {
            return Ok(FontFamily::Generic(value));
        }

        let bump = input.allocator();
        let value = input.expect_ident()?;
        // AST crate: ArrayListUnmanaged fed input.allocator() (arena) → bumpalo Vec
        let mut string: Option<bumpalo::collections::Vec<'_, u8>> = None;
        while let Ok(ident) = input.try_parse(css::Parser::expect_ident) {
            if string.is_none() {
                let mut s = bumpalo::collections::Vec::<u8>::new_in(bump);
                s.extend_from_slice(value);
                string = Some(s);
            }

            if let Some(s) = string.as_mut() {
                s.push(b' ');
                s.extend_from_slice(ident);
            }
        }

        let final_value: *const [u8] = match string {
            Some(s) => s.into_bump_slice() as *const [u8],
            None => value as *const [u8],
        };

        Ok(FontFamily::FamilyName(final_value))
    }

    #[cfg(any())]
    // blocked_on: GenericFontFamily::parse (EnumProperty), parse_utility::parse_string,
    // serializer::serialize_string writer trait.
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        match self {
            FontFamily::Generic(val) => val.to_css(dest),
            FontFamily::FamilyName(val_ptr) => {
                // SAFETY: arena-owned slice valid for 'bump (parser/printer arena outlives FontFamily)
                let val: &[u8] = unsafe { &**val_ptr };
                // Generic family names such as sans-serif must be quoted if parsed as a string.
                // CSS wide keywords, as well as "default", must also be quoted.
                // https://www.w3.org/TR/css-fonts-4/#family-name-syntax

                if !val.is_empty()
                    && !css::parse_utility::parse_string::<GenericFontFamily>(
                        dest.allocator,
                        val,
                        GenericFontFamily::parse,
                    )
                    .is_ok()
                {
                    // AST crate: std.Io.Writer.Allocating on dest.allocator (arena) → bumpalo Vec
                    let mut id = bumpalo::collections::Vec::<u8>::new_in(dest.allocator);
                    let mut first = true;
                    for slice in val.split(|b| *b == b' ') {
                        if first {
                            first = false;
                        } else {
                            id.push(b' ');
                        }
                        if css::serializer::serialize_identifier(slice, &mut id).is_err() {
                            return Err(dest.add_fmt_error());
                        }
                    }
                    if id.len() < val.len() + 2 {
                        return dest.write_str(&id[..]);
                    }
                }
                match css::serializer::serialize_string(val, dest) {
                    Ok(()) => Ok(()),
                    Err(_) => Err(dest.add_fmt_error()),
                }
            }
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        match self {
            FontFamily::Generic(g) => g.is_compatible(browsers),
            FontFamily::FamilyName(_) => true,
        }
    }

    // eql / hash / deepClone — see manual impls below
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
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
// TODO(port): css.DefineEnumProperty
pub enum GenericFontFamily {
    #[strum(serialize = "serif")]
    Serif,
    #[strum(serialize = "sans-serif")]
    SansSerif,
    #[strum(serialize = "cursive")]
    Cursive,
    #[strum(serialize = "fantasy")]
    Fantasy,
    #[strum(serialize = "monospace")]
    Monospace,
    #[strum(serialize = "system-ui")]
    SystemUi,
    #[strum(serialize = "emoji")]
    Emoji,
    #[strum(serialize = "math")]
    Math,
    #[strum(serialize = "fangsong")]
    Fangsong,
    #[strum(serialize = "ui-serif")]
    UiSerif,
    #[strum(serialize = "ui-sans-serif")]
    UiSansSerif,
    #[strum(serialize = "ui-monospace")]
    UiMonospace,
    #[strum(serialize = "ui-rounded")]
    UiRounded,

    // CSS wide keywords. These must be parsed as identifiers so they
    // don't get serialized as strings.
    // https://www.w3.org/TR/css-values-4/#common-keywords
    #[strum(serialize = "initial")]
    Initial,
    #[strum(serialize = "inherit")]
    Inherit,
    #[strum(serialize = "unset")]
    Unset,
    // Default is also reserved by the <custom-ident> type.
    // https://www.w3.org/TR/css-values-4/#custom-idents
    #[strum(serialize = "default")]
    Default,

    // CSS defaulting keywords
    // https://drafts.csswg.org/css-cascade-5/#defaulting-keywords
    #[strum(serialize = "revert")]
    Revert,
    #[strum(serialize = "revert-layer")]
    RevertLayer,
}

impl GenericFontFamily {
    #[cfg(any())] // blocked_on: EnumProperty impl (from_ascii_case_insensitive)
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::enum_property_util::to_css(self, dest)
    }

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

    #[cfg(any())]
    // blocked_on: Angle::parse + Parser::expect_ident lifetime detachment for
    // Token::Ident error payload (arena 'static cast).
    pub fn parse(input: &mut css::Parser) -> CssResult<FontStyle> {
        let location = input.current_source_location();
        let ident = input.expect_ident()?;
        // todo_stuff.match_ignore_ascii_case
        if strings::eql_case_insensitive_ascii_check_length(b"normal", ident) {
            Ok(FontStyle::Normal)
        } else if strings::eql_case_insensitive_ascii_check_length(b"italic", ident) {
            Ok(FontStyle::Italic)
        } else if strings::eql_case_insensitive_ascii_check_length(b"oblique", ident) {
            let angle = input
                .try_parse(Angle::parse)
                .unwrap_or(FontStyle::default_oblique_angle());
            Ok(FontStyle::Oblique(angle))
        } else {
            //
            Err(location.new_unexpected_token_error(crate::Token::Ident(ident)))
        }
    }

    #[cfg(any())] // blocked_on: Angle::to_css
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
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
// TODO(port): css.DefineEnumProperty
pub enum FontVariantCaps {
    /// No special capitalization features are applied.
    #[strum(serialize = "normal")]
    Normal,
    /// The small capitals feature is used for lower case letters.
    #[strum(serialize = "small-caps")]
    SmallCaps,
    /// Small capitals are used for both upper and lower case letters.
    #[strum(serialize = "all-small-caps")]
    AllSmallCaps,
    /// Petite capitals are used.
    #[strum(serialize = "petite-caps")]
    PetiteCaps,
    /// Petite capitals are used for both upper and lower case letters.
    #[strum(serialize = "all-petite-caps")]
    AllPetiteCaps,
    /// Enables display of mixture of small capitals for uppercase letters with normal lowercase letters.
    #[strum(serialize = "unicase")]
    Unicase,
    /// Uses titling capitals.
    #[strum(serialize = "titling-caps")]
    TitlingCaps,
}

impl FontVariantCaps {
    #[cfg(any())] // blocked_on: EnumProperty impl (from_ascii_case_insensitive)
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn default() -> FontVariantCaps {
        FontVariantCaps::Normal
    }

    fn is_css2(&self) -> bool {
        matches!(self, FontVariantCaps::Normal | FontVariantCaps::SmallCaps)
    }

    #[cfg(any())] // blocked_on: FontVariantCaps::parse
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
    #[cfg(any())] // blocked_on: css::DeriveParse / css::DeriveToCss → #[derive(Parse, ToCss)]
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::DeriveParse::parse(input)
    }
    #[cfg(any())] // blocked_on: #[derive(ToCss)]
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::DeriveToCss::to_css(self, dest)
    }

    #[cfg(any())] // blocked_on: DimensionPercentage::is_compatible bound
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
// PORT NOTE: no `#[derive(Clone, PartialEq)]` — `BabyList<T>` derives neither.
// Zig's `eql`/`deepClone` were reflection-based (`css.implementEql` / `css.
// implementDeepClone`); Phase B provides those via the generics blanket.
pub struct Font {
    /// The font family.
    pub family: BabyList<FontFamily>,
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
        ("variant_caps", crate::properties::PropertyIdTag::FontVariantCaps),
    ];

    #[cfg(any())]
    // blocked_on: FontStyle/FontWeight/FontVariantCaps/FontStretchKeyword/
    // FontSize/LineHeight ::parse + BabyList::<FontFamily>::parse.
    pub fn parse(input: &mut css::Parser) -> CssResult<Font> {
        let mut style: Option<FontStyle> = None;
        let mut weight: Option<FontWeight> = None;
        let mut stretch: Option<FontStretch> = None;
        let mut size: Option<FontSize> = None;
        let mut variant_caps: Option<FontVariantCaps> = None;
        let mut count: i32 = 0;

        loop {
            // Skip "normal" since it is valid for several properties, but we don't know which ones it will be used for yet.
            if input.try_parse(|i| i.expect_ident_matching(b"normal")).is_ok() {
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

        let family = BabyList::<FontFamily>::parse(input)?;

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

    #[cfg(any())]
    // blocked_on: FontStyle/FontVariantCaps/FontWeight/FontStretch/FontSize/
    // LineHeight/FontFamily ::to_css.
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

        let len = self.family.len() as usize;
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
#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
// TODO(port): css.DefineEnumProperty
pub enum VerticalAlignKeyword {
    /// Align the baseline of the box with the baseline of the parent box.
    #[strum(serialize = "baseline")]
    Baseline,
    /// Lower the baseline of the box to the proper position for subscripts of the parent's box.
    #[strum(serialize = "sub")]
    Sub,
    /// Raise the baseline of the box to the proper position for superscripts of the parent's box.
    #[strum(serialize = "super")]
    Super,
    /// Align the top of the aligned subtree with the top of the line box.
    #[strum(serialize = "top")]
    Top,
    /// Align the top of the box with the top of the parent's content area.
    #[strum(serialize = "text-top")]
    TextTop,
    /// Align the vertical midpoint of the box with the baseline of the parent box plus half the x-height of the parent.
    #[strum(serialize = "middle")]
    Middle,
    /// Align the bottom of the aligned subtree with the bottom of the line box.
    #[strum(serialize = "bottom")]
    Bottom,
    /// Align the bottom of the box with the bottom of the parent's content area.
    #[strum(serialize = "text-bottom")]
    TextBottom,
}

impl VerticalAlignKeyword {
    #[cfg(any())] // blocked_on: EnumProperty impl (from_ascii_case_insensitive)
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse::<Self>(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> PrintResult<()> {
        css::enum_property_util::to_css(self, dest)
    }
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

    pub fn try_from_property_id(property_id: crate::properties::PropertyIdTag) -> Option<FontProperty> {
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
    family: Option<BabyList<FontFamily>>,
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
    // PORT NOTE: real `handle_property`/`finalize` bodies remain gated below.
    // The handler stub surface here matches `handler_stub!` so
    // `DeclarationHandler` (declaration.rs) compiles unchanged.
    #[cfg(not(any()))]
    #[inline]
    pub fn handle_property(
        &mut self,
        _property: &crate::properties::Property,
        _dest: &mut crate::DeclarationList<'_>,
        _context: &mut crate::PropertyHandlerContext<'_>,
    ) -> bool {
        false
    }
    #[cfg(not(any()))]
    #[inline]
    pub fn finalize(
        &mut self,
        _dest: &mut crate::DeclarationList<'_>,
        _context: &mut crate::PropertyHandlerContext<'_>,
    ) {
    }

    #[cfg(any())]
    // blocked_on: generics::is_compatible/eql/deepClone blankets,
    // PropertyHandlerContext::allocator(), DeclarationList::push,
    // Property::Font*/Unparsed payloads, FontFamilyHashMap.
    pub fn handle_property(
        &mut self,
        property: &crate::properties::Property,
        dest: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) -> bool {
        use crate::properties::Property;

        // TODO(port): Zig used `comptime prop: []const u8` + @field for property_helper / flush_helper / push.
        // No Rust equivalent for field-name reflection — expanded as macro_rules! over (handler_field, Property variant, FontProperty flag).
        macro_rules! flush_helper {
            ($this:expr, $field:ident, $val:expr) => {{
                if $this.$field.is_some()
                    && $this.$field.as_ref().unwrap() != $val
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
                // TODO(port): css.generic.deepClone(.., context.allocator) — arena-aware clone in Phase B
                $this.$field = Some($val.clone());
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

                // TODO(port): css.generic.deepClone with context.allocator — arena-aware clone in Phase B
                self.family = Some(val.family.clone());
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
                    self.flushed_properties.insert(
                        FontProperty::try_from_property_id(val.property_id.tag()).unwrap(),
                    );
                    // PERF(port): was dest.append(context.allocator, property.*) on arena
                    dest.push(property.clone());
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    #[cfg(any())]
    pub fn finalize(
        &mut self,
        decls: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) {
        self.flush(decls, context);
        self.flushed_properties = FontProperty::empty();
    }

    #[cfg(any())]
    // blocked_on: FontFamilyHashMap, PropertyHandlerContext::allocator(),
    // BabyList::ordered_remove/insert/at, generics::is_compatible.
    fn flush(
        &mut self,
        decls: &mut crate::DeclarationList<'_>,
        context: &mut crate::PropertyHandlerContext<'_>,
    ) {
        use crate::properties::Property;

        macro_rules! push_prop {
            (Font, $val:expr) => {{
                // PERF(port): was dest.append(ctx.allocator, ..) on arena-backed list
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

        let mut family: Option<BabyList<FontFamily>> = self.family.take();
        if !self.flushed_properties.contains(FontProperty::FONT_FAMILY) {
            family = compatible_font_family(
                family,
                !context.targets.should_compile_same(Feature::FontFamilySystemUi),
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
                while (i as u32) < f.len() {
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

        if let (
            Some(_),
            Some(_),
            Some(_),
            Some(_),
            Some(_),
            Some(_),
            Some(variant_caps_v),
        ) = (
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
                    variant_caps: if caps.is_css2() { caps } else { FontVariantCaps::default() },
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
    b"Segoe UI", // Windows >= Vista
    b"Roboto", // Android >= 4
    b"Noto Sans", // Plasma >= 5.5
    b"Ubuntu", // Ubuntu >= 10.10
    b"Cantarell", // GNOME >= 3
    b"Helvetica Neue",
];

#[cfg(any())]
// blocked_on: BabyList::insert allocator threading + arena Bump param.
#[inline]
fn compatible_font_family(
    _family: Option<BabyList<FontFamily>>,
    is_supported: bool,
) -> Option<BabyList<FontFamily>> {
    let mut family = _family;
    if is_supported {
        return family;
    }

    if let Some(families) = family.as_mut() {
        for (i, v) in families.slice_const().iter().enumerate() {
            if is_system_ui(v) {
                for (j, name) in DEFAULT_SYSTEM_FONTS.iter().enumerate() {
                    // TODO(port): families.insert(allocator, idx, val) — BabyList::insert with arena
                    let _ = families.insert(i + j + 1, FontFamily::FamilyName(*name as *const [u8]));
                }
                break;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/font.zig (1061 lines)
//   confidence: medium
//   todos:      27
//   notes:      module un-gated; all data types real; parse/to_css/handle_property/
//               flush bodies internally gated on DeriveParse/DeriveToCss proc-
//               macros + EnumProperty from_ascii_case_insensitive impls +
//               generics::IsCompatible blanket + parse_utility::parse_string +
//               BabyList parse/insert allocator threading. FontFamily.FamilyName
//               is arena-owned *const [u8] (thread 'bump in Phase B; manual
//               PartialEq/Clone compare/copy by content/pointer-shallow);
//               FontHandler @field helpers expanded via macro_rules!.
// ──────────────────────────────────────────────────────────────────────────
