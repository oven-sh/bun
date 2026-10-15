//! CSS properties related to filters and effects.

#![warn(unused_must_use)]
use crate as css;
use crate::PrintErr;
use crate::Printer;
use crate::SmallList;
use crate::css_values::angle::Angle;
use crate::css_values::color::{ColorFallbackKind, CssColor};
use crate::css_values::length::Length;
use crate::css_values::percentage::NumberOrPercentage;
use crate::css_values::url::Url;
use crate::generics::{CssEql, DeepClone, IsCompatible};
use bun_alloc::Arena;

/// Parses `T` and rejects a value with a negative sign, as the
/// `<length [0,∞]>` and `<number [0,∞]>` ranges of the filter functions require.
fn parse_non_negative<T>(
    input: &mut css::Parser,
    parse: impl FnOnce(&mut css::Parser) -> css::Result<T>,
    try_sign: impl FnOnce(&T) -> Option<f32>,
) -> css::Result<T> {
    let value = parse(input)?;
    if try_sign(&value).is_some_and(f32::is_sign_negative) {
        return Err(input.new_custom_error(css::ParserError::invalid_value));
    }
    Ok(value)
}

fn number_or_percentage_sign(v: &NumberOrPercentage) -> Option<f32> {
    Some(match v {
        NumberOrPercentage::Number(n) => *n,
        NumberOrPercentage::Percentage(p) => p.v,
    })
}

/// A [filter](https://drafts.fxtf.org/filter-effects-1/#filter-functions) function.
pub enum Filter {
    /// A `blur()` filter.
    Blur(Length),
    /// A `brightness()` filter.
    Brightness(NumberOrPercentage),
    /// A `contrast()` filter.
    Contrast(NumberOrPercentage),
    /// A `grayscale()` filter.
    Grayscale(NumberOrPercentage),
    /// A `hue-rotate()` filter.
    HueRotate(Angle),
    /// An `invert()` filter.
    Invert(NumberOrPercentage),
    /// An `opacity()` filter.
    Opacity(NumberOrPercentage),
    /// A `saturate()` filter.
    Saturate(NumberOrPercentage),
    /// A `sepia()` filter.
    Sepia(NumberOrPercentage),
    /// A `drop-shadow()` filter.
    DropShadow(DropShadow),
    /// A `url()` reference to an SVG filter.
    Url(Url),
}

impl Filter {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if let Ok(url) = input.try_parse(Url::parse) {
            return Ok(Filter::Url(url));
        }

        let location = input.current_source_location();
        let function = input.expect_function_cloned()?;

        macro_rules! amount {
            ($variant:ident) => {
                input.parse_nested_block(|i| {
                    Ok(Filter::$variant(
                        i.try_parse(|i| {
                            parse_non_negative(
                                i,
                                NumberOrPercentage::parse,
                                number_or_percentage_sign,
                            )
                        })
                        .unwrap_or(NumberOrPercentage::Number(1.0)),
                    ))
                })
            };
        }

        crate::match_ignore_ascii_case! { function, {
            b"blur" => input.parse_nested_block(|i| {
                Ok(Filter::Blur(
                    i.try_parse(|i| parse_non_negative(i, Length::parse, Length::try_sign))
                        .unwrap_or_else(|_| Length::zero()),
                ))
            }),
            b"brightness" => amount!(Brightness),
            b"contrast" => amount!(Contrast),
            b"grayscale" => amount!(Grayscale),
            b"hue-rotate" => input.parse_nested_block(|i| {
                // Spec has an exception for unitless zero angles: https://github.com/w3c/fxtf-drafts/issues/228
                Ok(Filter::HueRotate(
                    i.try_parse(Angle::parse_with_unitless_zero).unwrap_or_else(|_| Angle::zero()),
                ))
            }),
            b"invert" => amount!(Invert),
            b"opacity" => amount!(Opacity),
            b"saturate" => amount!(Saturate),
            b"sepia" => amount!(Sepia),
            b"drop-shadow" => input.parse_nested_block(|i| Ok(Filter::DropShadow(DropShadow::parse(i)?))),
            _ => Err(location.new_unexpected_token_error(css::Token::Ident(function))),
        }}
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        macro_rules! amount {
            ($name:literal, $val:expr) => {{
                dest.write_str(concat!($name, "("))?;
                if $val.into_f32() != 1.0 {
                    $val.to_css(dest)?;
                }
                dest.write_char(b')')
            }};
        }

        match self {
            Filter::Blur(val) => {
                dest.write_str("blur(")?;
                if *val != Length::zero() {
                    val.to_css(dest)?;
                }
                dest.write_char(b')')
            }
            Filter::Brightness(val) => amount!("brightness", val),
            Filter::Contrast(val) => amount!("contrast", val),
            Filter::Grayscale(val) => amount!("grayscale", val),
            Filter::HueRotate(val) => {
                dest.write_str("hue-rotate(")?;
                if !val.is_zero() {
                    val.to_css(dest)?;
                }
                dest.write_char(b')')
            }
            Filter::Invert(val) => amount!("invert", val),
            Filter::Opacity(val) => amount!("opacity", val),
            Filter::Saturate(val) => amount!("saturate", val),
            Filter::Sepia(val) => amount!("sepia", val),
            Filter::DropShadow(val) => {
                dest.write_str("drop-shadow(")?;
                val.to_css(dest)?;
                dest.write_char(b')')
            }
            Filter::Url(url) => url.to_css(dest),
        }
    }

    fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> Self {
        match self {
            Filter::DropShadow(shadow) => Filter::DropShadow(shadow.get_fallback(arena, kind)),
            _ => self.deep_clone(arena),
        }
    }

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        match self {
            Filter::Blur(v) => Filter::Blur(v.clone()),
            Filter::Brightness(v) => Filter::Brightness(v.clone()),
            Filter::Contrast(v) => Filter::Contrast(v.clone()),
            Filter::Grayscale(v) => Filter::Grayscale(v.clone()),
            Filter::HueRotate(v) => Filter::HueRotate(*v),
            Filter::Invert(v) => Filter::Invert(v.clone()),
            Filter::Opacity(v) => Filter::Opacity(v.clone()),
            Filter::Saturate(v) => Filter::Saturate(v.clone()),
            Filter::Sepia(v) => Filter::Sepia(v.clone()),
            Filter::DropShadow(shadow) => Filter::DropShadow(shadow.deep_clone(arena)),
            Filter::Url(url) => Filter::Url(url.deep_clone(arena)),
        }
    }

    pub(crate) fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (Filter::Blur(a), Filter::Blur(b)) => a == b,
            (Filter::Brightness(a), Filter::Brightness(b))
            | (Filter::Contrast(a), Filter::Contrast(b))
            | (Filter::Grayscale(a), Filter::Grayscale(b))
            | (Filter::Invert(a), Filter::Invert(b))
            | (Filter::Opacity(a), Filter::Opacity(b))
            | (Filter::Saturate(a), Filter::Saturate(b))
            | (Filter::Sepia(a), Filter::Sepia(b)) => a == b,
            (Filter::HueRotate(a), Filter::HueRotate(b)) => a == b,
            (Filter::DropShadow(a), Filter::DropShadow(b)) => a.eql(b),
            (Filter::Url(a), Filter::Url(b)) => a.eql(b),
            _ => false,
        }
    }

    pub(crate) fn is_compatible(&self, _browsers: &css::targets::Browsers) -> bool {
        true
    }
}

/// A [`drop-shadow()`](https://drafts.fxtf.org/filter-effects-1/#funcdef-filter-drop-shadow) filter function.
pub struct DropShadow {
    /// The color of the drop shadow.
    pub(crate) color: CssColor,
    /// The x offset of the drop shadow.
    pub(crate) x_offset: Length,
    /// The y offset of the drop shadow.
    pub(crate) y_offset: Length,
    /// The blur radius of the drop shadow.
    pub(crate) blur: Length,
}

impl DropShadow {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut color: Option<CssColor> = None;
        let mut lengths: Option<(Length, Length, Length)> = None;

        loop {
            if lengths.is_none() {
                let value = input.try_parse(|i: &mut css::Parser| -> css::Result<_> {
                    let horizontal = Length::parse(i)?;
                    let vertical = Length::parse(i)?;
                    let blur = i
                        .try_parse(|i| parse_non_negative(i, Length::parse, Length::try_sign))
                        .unwrap_or_else(|_| Length::zero());
                    Ok((horizontal, vertical, blur))
                });

                if let Ok(v) = value {
                    lengths = Some(v);
                    continue;
                }
            }

            if color.is_none() {
                if let Ok(value) = input.try_parse(CssColor::parse) {
                    color = Some(value);
                    continue;
                }
            }

            break;
        }

        let Some((x_offset, y_offset, blur)) = lengths else {
            return Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid));
        };
        Ok(DropShadow {
            color: color.unwrap_or(CssColor::CurrentColor),
            x_offset,
            y_offset,
            blur,
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.x_offset.to_css(dest)?;
        dest.write_char(b' ')?;
        self.y_offset.to_css(dest)?;

        if self.blur != Length::zero() {
            dest.write_char(b' ')?;
            self.blur.to_css(dest)?;
        }

        if self.color != CssColor::CurrentColor {
            dest.write_char(b' ')?;
            self.color.to_css(dest)?;
        }

        Ok(())
    }

    fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> DropShadow {
        DropShadow {
            color: self.color.get_fallback(arena, kind),
            x_offset: self.x_offset.clone(),
            y_offset: self.y_offset.clone(),
            blur: self.blur.clone(),
        }
    }

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        DropShadow {
            color: self.color.deep_clone(arena),
            x_offset: self.x_offset.clone(),
            y_offset: self.y_offset.clone(),
            blur: self.blur.clone(),
        }
    }

    pub(crate) fn eql(&self, other: &Self) -> bool {
        self.color.eql(&other.color)
            && self.x_offset == other.x_offset
            && self.y_offset == other.y_offset
            && self.blur == other.blur
    }
}

/// A value for the [filter](https://drafts.fxtf.org/filter-effects-1/#FilterProperty) and
/// [backdrop-filter](https://drafts.fxtf.org/filter-effects-2/#BackdropFilterProperty) properties.
pub enum FilterList {
    /// The `none` keyword.
    None,
    /// A list of filter functions.
    Filters(SmallList<Filter, 1>),
}

impl FilterList {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(FilterList::None);
        }

        let mut filters = SmallList::<Filter, 1>::default();
        while let Ok(filter) = input.try_parse(Filter::parse) {
            filters.append(filter);
        }

        Ok(FilterList::Filters(filters))
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            FilterList::None => dest.write_str("none"),
            FilterList::Filters(filters) => {
                let mut first = true;
                for filter in filters.slice() {
                    if first {
                        first = false;
                    } else {
                        dest.whitespace()?;
                    }
                    filter.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    /// Returns the RGB and P3 fallback lists to print before this value, and
    /// converts `self` to LAB when the targets need it. Same protocol as
    /// `get_fallbacks_text_shadow`.
    pub(crate) fn get_fallbacks(
        &mut self,
        arena: &Arena,
        targets: &css::targets::Targets,
    ) -> SmallList<FilterList, 2> {
        let mut res = SmallList::<FilterList, 2>::default();
        let FilterList::Filters(filters) = self else {
            return res;
        };

        let mut fallbacks = ColorFallbackKind::empty();
        for filter in filters.slice() {
            if let Filter::DropShadow(shadow) = filter {
                fallbacks.insert(shadow.color.get_necessary_fallbacks(targets));
            }
        }

        let convert = |filters: &SmallList<Filter, 1>, kind: ColorFallbackKind| {
            let mut out = SmallList::<Filter, 1>::init_capacity(filters.len());
            for filter in filters.slice() {
                out.append_assume_capacity(filter.get_fallback(arena, kind));
            }
            FilterList::Filters(out)
        };

        if fallbacks.contains(ColorFallbackKind::RGB) {
            res.append(convert(filters, ColorFallbackKind::RGB));
        }

        if fallbacks.contains(ColorFallbackKind::P3) {
            res.append(convert(filters, ColorFallbackKind::P3));
        }

        if fallbacks.contains(ColorFallbackKind::LAB) {
            for filter in filters.slice_mut() {
                *filter = filter.get_fallback(arena, ColorFallbackKind::LAB);
            }
        }

        res
    }

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        match self {
            FilterList::None => FilterList::None,
            FilterList::Filters(filters) => FilterList::Filters(filters.deep_clone(arena)),
        }
    }

    pub(crate) fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (FilterList::None, FilterList::None) => true,
            (FilterList::Filters(a), FilterList::Filters(b)) => SmallList::eql(a, b),
            _ => false,
        }
    }

    pub(crate) fn is_compatible(&self, _browsers: &css::targets::Browsers) -> bool {
        true
    }
}

impl<'bump> DeepClone<'bump> for Filter {
    #[inline]
    fn deep_clone(&self, arena: &'bump Arena) -> Self {
        Filter::deep_clone(self, arena)
    }
}
impl CssEql for Filter {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        Filter::eql(self, other)
    }
}
impl IsCompatible for Filter {
    #[inline]
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        Filter::is_compatible(self, browsers)
    }
}

impl<'bump> DeepClone<'bump> for FilterList {
    #[inline]
    fn deep_clone(&self, arena: &'bump Arena) -> Self {
        FilterList::deep_clone(self, arena)
    }
}
impl CssEql for FilterList {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        FilterList::eql(self, other)
    }
}
impl IsCompatible for FilterList {
    #[inline]
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        FilterList::is_compatible(self, browsers)
    }
}
