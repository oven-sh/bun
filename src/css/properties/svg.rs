//! CSS properties used in SVG.

#![warn(unused_must_use)]
use crate as css;
use crate::PrintErr;
use crate::Printer;
use crate::SmallList;
use crate::css_values::color::CssColor;
use crate::css_values::url::Url;
use crate::generics::CssEql as _;
use bun_alloc::Arena;

/// An SVG [`<paint>`](https://www.w3.org/TR/SVG2/painting.html#SpecifyingPaint) value
/// used in the `fill` and `stroke` properties.
pub enum SVGPaint {
    /// A URL reference to a paint server element, e.g. `linearGradient`, `radialGradient`, and `pattern`.
    Url {
        /// The url of the paint server.
        url: Url,
        /// A fallback to be used in case the paint server cannot be resolved.
        fallback: Option<SVGPaintFallback>,
    },
    /// A solid color paint.
    Color(CssColor),
    /// Use the paint value of fill from a context element.
    ContextFill,
    /// Use the paint value of stroke from a context element.
    ContextStroke,
    /// No paint.
    None,
}

/// A fallback for an SVG paint in case a paint server `url()` cannot be resolved.
pub enum SVGPaintFallback {
    /// No fallback.
    None,
    /// A solid color.
    Color(CssColor),
}

impl SVGPaintFallback {
    fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if input
            .try_parse(|p| p.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(SVGPaintFallback::None);
        }
        CssColor::parse(input).map(SVGPaintFallback::Color)
    }

    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            SVGPaintFallback::None => dest.write_str("none"),
            SVGPaintFallback::Color(color) => color.to_css(dest),
        }
    }

    fn deep_clone(&self, arena: &Arena) -> Self {
        match self {
            SVGPaintFallback::None => SVGPaintFallback::None,
            SVGPaintFallback::Color(color) => SVGPaintFallback::Color(color.deep_clone(arena)),
        }
    }

    fn eql(&self, rhs: &Self) -> bool {
        match (self, rhs) {
            (SVGPaintFallback::None, SVGPaintFallback::None) => true,
            (SVGPaintFallback::Color(a), SVGPaintFallback::Color(b)) => a.eql(b),
            _ => false,
        }
    }
}

impl SVGPaint {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if let Ok(url) = input.try_parse(Url::parse) {
            let fallback = input.try_parse(SVGPaintFallback::parse).ok();
            return Ok(SVGPaint::Url { url, fallback });
        }

        if let Ok(color) = input.try_parse(CssColor::parse) {
            return Ok(SVGPaint::Color(color));
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        crate::match_ignore_ascii_case! { ident, {
            b"context-fill" => Ok(SVGPaint::ContextFill),
            b"context-stroke" => Ok(SVGPaint::ContextStroke),
            b"none" => Ok(SVGPaint::None),
            _ => Err(location.new_unexpected_token_error(css::Token::Ident(ident))),
        }}
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            SVGPaint::Url { url, fallback } => {
                url.to_css(dest)?;
                if let Some(fallback) = fallback {
                    dest.write_char(b' ')?;
                    fallback.to_css(dest)?;
                }
                Ok(())
            }
            SVGPaint::Color(color) => color.to_css(dest),
            SVGPaint::ContextFill => dest.write_str("context-fill"),
            SVGPaint::ContextStroke => dest.write_str("context-stroke"),
            SVGPaint::None => dest.write_str("none"),
        }
    }

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        match self {
            SVGPaint::Url { url, fallback } => SVGPaint::Url {
                url: url.deep_clone(arena),
                fallback: fallback.as_ref().map(|f| f.deep_clone(arena)),
            },
            SVGPaint::Color(color) => SVGPaint::Color(color.deep_clone(arena)),
            SVGPaint::ContextFill => SVGPaint::ContextFill,
            SVGPaint::ContextStroke => SVGPaint::ContextStroke,
            SVGPaint::None => SVGPaint::None,
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        match (self, rhs) {
            (
                SVGPaint::Url {
                    url: a,
                    fallback: fa,
                },
                SVGPaint::Url {
                    url: b,
                    fallback: fb,
                },
            ) => {
                a.eql(b)
                    && match (fa, fb) {
                        (None, None) => true,
                        (Some(x), Some(y)) => x.eql(y),
                        _ => false,
                    }
            }
            (SVGPaint::Color(a), SVGPaint::Color(b)) => a.eql(b),
            (SVGPaint::ContextFill, SVGPaint::ContextFill)
            | (SVGPaint::ContextStroke, SVGPaint::ContextStroke)
            | (SVGPaint::None, SVGPaint::None) => true,
            _ => false,
        }
    }

    /// Returns the RGB and P3 fallbacks the paint's color needs for `targets`, and lowers
    /// `self` to LAB in place when that is needed too (see `CssColor::get_fallbacks`).
    pub(crate) fn get_fallbacks(
        &mut self,
        arena: &Arena,
        targets: &css::targets::Targets,
    ) -> SmallList<SVGPaint, 2> {
        let mut res = SmallList::<SVGPaint, 2>::default();
        match self {
            SVGPaint::Color(color) => {
                for fb in color.get_fallbacks(arena, targets).slice() {
                    res.append(SVGPaint::Color(fb.deep_clone(arena)));
                }
            }
            SVGPaint::Url {
                url,
                fallback: Some(SVGPaintFallback::Color(color)),
            } => {
                for fb in color.get_fallbacks(arena, targets).slice() {
                    res.append(SVGPaint::Url {
                        url: url.deep_clone(arena),
                        fallback: Some(SVGPaintFallback::Color(fb.deep_clone(arena))),
                    });
                }
            }
            _ => {}
        }
        res
    }

    pub(crate) fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        match self {
            SVGPaint::Color(color)
            | SVGPaint::Url {
                fallback: Some(SVGPaintFallback::Color(color)),
                ..
            } => color.is_compatible(browsers),
            _ => true,
        }
    }
}

impl<'bump> css::generic::DeepClone<'bump> for SVGPaint {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        SVGPaint::deep_clone(self, bump)
    }
}
impl css::generic::CssEql for SVGPaint {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        SVGPaint::eql(self, other)
    }
}
impl css::generic::IsCompatible for SVGPaint {
    #[inline]
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        SVGPaint::is_compatible(self, browsers)
    }
}
