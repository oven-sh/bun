#![warn(unused_must_use)]
use crate as css;
use crate::PrintErr;
use crate::Printer;
use crate::css_values::color::CssColor;
use crate::css_values::length::LengthValue as Length;
use crate::css_values::percentage::Percentage;

/// A value for the [text-shadow](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-shadow-property) property.
#[derive(Clone, PartialEq)]
pub struct TextShadow {
    /// The color of the text shadow.
    pub(crate) color: CssColor,
    /// The x offset of the text shadow.
    pub(crate) x_offset: Length,
    /// The y offset of the text shadow.
    pub(crate) y_offset: Length,
    /// The blur radius of the text shadow.
    pub(crate) blur: Length,
    /// The spread distance of the text shadow.
    pub(crate) spread: Length, // added in Level 4 spec
}

impl TextShadow {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut color: Option<CssColor> = None;
        type Lengths = (Length, Length, Length, Length);
        let mut lengths: Option<Lengths> = None;

        loop {
            if lengths.is_none() {
                let value = input.try_parse(|i: &mut css::Parser| -> css::Result<Lengths> {
                    let horizontal = Length::parse(i)?;
                    let vertical = Length::parse(i)?;
                    let blur = i.try_parse(Length::parse).ok().unwrap_or_else(Length::zero);
                    let spread = i.try_parse(Length::parse).ok().unwrap_or_else(Length::zero);
                    Ok((horizontal, vertical, blur, spread))
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

        let Some(l) = lengths else {
            return Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid));
        };
        Ok(Self {
            color: color.unwrap_or(CssColor::CurrentColor),
            x_offset: l.0,
            y_offset: l.1,
            blur: l.2,
            spread: l.3,
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.x_offset.to_css(dest)?;
        dest.write_char(b' ')?;
        self.y_offset.to_css(dest)?;

        if self.blur != Length::zero() || self.spread != Length::zero() {
            dest.write_char(b' ')?;
            self.blur.to_css(dest)?;

            if self.spread != Length::zero() {
                dest.write_char(b' ')?;
                self.spread.to_css(dest)?;
            }
        }

        if self.color != CssColor::CurrentColor {
            dest.write_char(b' ')?;
            self.color.to_css(dest)?;
        }

        Ok(())
    }

    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        self.color.is_compatible(browsers)
            && self.x_offset.is_compatible(browsers)
            && self.y_offset.is_compatible(browsers)
            && self.blur.is_compatible(browsers)
            && self.spread.is_compatible(browsers)
    }

    pub(crate) fn deep_clone(&self, alloc: &bun_alloc::Arena) -> Self {
        // Fields deep-clone via `#[derive(Clone)]` (`CssColor`/`Length`
        // `Box`-carrying variants clone deeply onto the global heap), so a
        // plain Clone is equivalent; arena param retained for signature
        // compatibility with the CSS deep_clone protocol.
        let _ = alloc;
        self.clone()
    }
}

// Forward to the inherent method so the blanket `SmallList<T,N>` impl in
// `crate::generics` (IsCompatible) applies to `SmallList<TextShadow,1>`.
// (DeepClone is bridged via `bridge_deep_clone!(TextShadow)` in generics.rs.)
impl css::generics::IsCompatible for TextShadow {
    #[inline]
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        self.is_compatible(browsers)
    }
}

/// A value for the [hyphens](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#hyphenation) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum Hyphens {
    /// Words are not hyphenated.
    None,
    /// Words are only hyphenated where there are characters inside the word that explicitly suggest hyphenation opportunities.
    Manual,
    /// Words may be broken at hyphenation opportunities determined automatically by the UA.
    Auto,
}

/// A value for the [text-align-last](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-last-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextAlignLast {
    /// Content on the affected line is aligned per `text-align-all` unless set to `justify`, in which case it is start-aligned.
    Auto,
    /// Inline-level content is aligned to the start edge of the line box.
    Start,
    /// Inline-level content is aligned to the end edge of the line box.
    End,
    /// Inline-level content is aligned to the line-left edge of the line box.
    Left,
    /// Inline-level content is aligned to the line-right edge of the line box.
    Right,
    /// Inline-level content is centered within the line box.
    Center,
    /// Text is justified according to the method specified by the text-justify property.
    Justify,
    /// Matches the parent element.
    MatchParent,
}

/// A value for the [text-size-adjust](https://w3c.github.io/csswg-drafts/css-size-adjust/#adjustment-control) property.
#[derive(Clone, Copy, PartialEq, crate::Parse, crate::ToCss)]
pub enum TextSizeAdjust {
    /// Use the default size adjustment when displaying on a small device.
    Auto,
    /// No size adjustment when displaying on a small device.
    None,
    /// When displaying on a small device, the font size is multiplied by this percentage.
    Percentage(Percentage),
}

/// A value for the [text-decoration-skip-ink](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-skip-ink-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextDecorationSkipInk {
    /// UAs may interrupt underlines and overlines.
    Auto,
    /// UAs must interrupt underlines and overlines.
    None,
    /// UA must draw continuous underlines and overlines.
    All,
}

/// A value for the [box-decoration-break](https://www.w3.org/TR/css-break-3/#break-decoration) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum BoxDecorationBreak {
    /// The element is rendered with no breaks present, and then sliced by the breaks afterward.
    Slice,
    /// Each box fragment is independently wrapped with the border, padding, and margin.
    Clone,
}

/// A value for the [direction](https://drafts.csswg.org/css-writing-modes-3/#direction) property.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty, crate::generics::CssHash,
)]
pub enum Direction {
    /// This value sets inline base direction (bidi directionality) to line-left-to-line-right.
    Ltr,
    /// This value sets inline base direction (bidi directionality) to line-right-to-line-left.
    Rtl,
}
