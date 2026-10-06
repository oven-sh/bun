//! CSS properties related to filters and effects.

#![warn(unused_must_use)]
use crate as css;
use crate::PrintErr;
use crate::Printer;
use crate::SmallList;
use crate::css_parser::Token;
use crate::css_values::angle::Angle;
use crate::css_values::color::{ColorFallbackKind, CssColor};
use crate::css_values::length::Length;
use crate::css_values::percentage::NumberOrPercentage;
use crate::css_values::url::Url;
use crate::generics::CssEql as _;
use bun_alloc::Arena;

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
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Filter> {
        if let Ok(url) = input.try_parse(Url::parse) {
            return Ok(Filter::Url(url));
        }

        let location = input.current_source_location();
        let function = input.expect_function_cloned()?;
        // An omitted argument means the function's identity value.
        let one = || NumberOrPercentage::Number(1.0);
        input.parse_nested_block(|i: &mut css::Parser| -> css::Result<Filter> {
            crate::match_ignore_ascii_case! { function, {
                b"blur" => Ok(Filter::Blur(i.try_parse(Length::parse).ok().unwrap_or_else(Length::zero))),
                b"brightness" => Ok(Filter::Brightness(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                b"contrast" => Ok(Filter::Contrast(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                b"grayscale" => Ok(Filter::Grayscale(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                // The spec allows a unitless zero here: https://github.com/w3c/fxtf-drafts/issues/228
                b"hue-rotate" => Ok(Filter::HueRotate(i.try_parse(Angle::parse_with_unitless_zero).ok().unwrap_or_else(Angle::zero))),
                b"invert" => Ok(Filter::Invert(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                b"opacity" => Ok(Filter::Opacity(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                b"saturate" => Ok(Filter::Saturate(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                b"sepia" => Ok(Filter::Sepia(i.try_parse(NumberOrPercentage::parse).ok().unwrap_or_else(one))),
                b"drop-shadow" => Ok(Filter::DropShadow(DropShadow::parse(i)?)),
                _ => Err(location.new_unexpected_token_error(Token::Ident(function))),
            }}
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // Arguments equal to the function's default are omitted, as lightningcss does.
        let amount =
            |name: &str, v: &NumberOrPercentage, dest: &mut Printer| -> Result<(), PrintErr> {
                dest.write_str(name)?;
                dest.write_char(b'(')?;
                if v.into_f32() != 1.0 {
                    v.to_css(dest)?;
                }
                dest.write_char(b')')
            };
        match self {
            Filter::Blur(val) => {
                dest.write_str("blur(")?;
                if *val != Length::zero() {
                    val.to_css(dest)?;
                }
                dest.write_char(b')')
            }
            Filter::Brightness(v) => amount("brightness", v, dest),
            Filter::Contrast(v) => amount("contrast", v, dest),
            Filter::Grayscale(v) => amount("grayscale", v, dest),
            Filter::HueRotate(val) => {
                dest.write_str("hue-rotate(")?;
                if !val.is_zero() {
                    val.to_css(dest)?;
                }
                dest.write_char(b')')
            }
            Filter::Invert(v) => amount("invert", v, dest),
            Filter::Opacity(v) => amount("opacity", v, dest),
            Filter::Saturate(v) => amount("saturate", v, dest),
            Filter::Sepia(v) => amount("sepia", v, dest),
            Filter::DropShadow(val) => {
                dest.write_str("drop-shadow(")?;
                val.to_css(dest)?;
                dest.write_char(b')')
            }
            Filter::Url(url) => url.to_css(dest),
        }
    }

    fn deep_clone(&self, arena: &Arena) -> Self {
        // Expanded per variant: `Url` is not `Clone`.
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

    fn eql(&self, rhs: &Self) -> bool {
        match (self, rhs) {
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

    /// Converts the color of a `drop-shadow()` to `kind`; every other filter is copied.
    fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> Self {
        match self {
            Filter::DropShadow(shadow) => Filter::DropShadow(shadow.get_fallback(arena, kind)),
            other => other.deep_clone(arena),
        }
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
                let value = input.try_parse(
                    |p: &mut css::Parser| -> css::Result<(Length, Length, Length)> {
                        let horizontal = Length::parse(p)?;
                        let vertical = Length::parse(p)?;
                        let blur = p.try_parse(Length::parse).ok().unwrap_or_else(Length::zero);
                        Ok((horizontal, vertical, blur))
                    },
                );

                if let Ok(v) = value {
                    lengths = Some(v);
                    continue;
                }
            }

            if color.is_none() {
                if let Ok(c) = input.try_parse(CssColor::parse) {
                    color = Some(c);
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

        if !self.color.eql(&CssColor::CurrentColor) {
            dest.write_char(b' ')?;
            self.color.to_css(dest)?;
        }

        Ok(())
    }

    fn deep_clone(&self, arena: &Arena) -> Self {
        // `Length` is `Clone` (its `Box<Calc>` clones deeply).
        DropShadow {
            color: self.color.deep_clone(arena),
            x_offset: self.x_offset.clone(),
            y_offset: self.y_offset.clone(),
            blur: self.blur.clone(),
        }
    }

    fn eql(&self, rhs: &Self) -> bool {
        self.color.eql(&rhs.color)
            && self.x_offset == rhs.x_offset
            && self.y_offset == rhs.y_offset
            && self.blur == rhs.blur
    }

    fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> Self {
        let color = if kind == ColorFallbackKind::RGB {
            self.color.to_rgb()
        } else if kind == ColorFallbackKind::P3 {
            self.color.to_p3()
        } else if kind == ColorFallbackKind::LAB {
            self.color.to_lab()
        } else {
            None
        };
        DropShadow {
            color: color.unwrap_or_else(|| self.color.deep_clone(arena)),
            x_offset: self.x_offset.clone(),
            y_offset: self.y_offset.clone(),
            blur: self.blur.clone(),
        }
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
            .try_parse(|p| p.expect_ident_matching(b"none"))
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

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        match self {
            FilterList::None => FilterList::None,
            FilterList::Filters(filters) => {
                let mut out = SmallList::<Filter, 1>::init_capacity(filters.len());
                for filter in filters.slice() {
                    out.append(filter.deep_clone(arena));
                }
                FilterList::Filters(out)
            }
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        match (self, rhs) {
            (FilterList::None, FilterList::None) => true,
            (FilterList::Filters(a), FilterList::Filters(b)) => {
                a.len() == b.len() && a.slice().iter().zip(b.slice()).all(|(x, y)| x.eql(y))
            }
            _ => false,
        }
    }

    /// Returns the RGB and P3 fallbacks a `drop-shadow()` color needs for `targets`,
    /// and lowers `self` to LAB in place when that is needed too.
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
                out.append(filter.get_fallback(arena, kind));
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
                let lab = filter.get_fallback(arena, ColorFallbackKind::LAB);
                let _ = core::mem::replace(filter, lab);
            }
        }

        res
    }

    pub(crate) fn is_compatible(&self, _browsers: &css::targets::Browsers) -> bool {
        true
    }
}

impl<'bump> css::generic::DeepClone<'bump> for FilterList {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        FilterList::deep_clone(self, bump)
    }
}
impl css::generic::CssEql for FilterList {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        FilterList::eql(self, other)
    }
}
impl css::generic::IsCompatible for FilterList {
    #[inline]
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        FilterList::is_compatible(self, browsers)
    }
}
