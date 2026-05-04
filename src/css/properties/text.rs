use crate as css;
use crate::Printer;
use crate::PrintErr;
use crate::css_values::length::LengthPercentage;
use crate::css_values::color::CssColor;
use crate::css_values::length::LengthValue as Length;
use crate::css_values::percentage::Percentage;

/// A value for the [text-transform](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-transform-property) property.
pub struct TextTransform {
    /// How case should be transformed.
    pub case: TextTransformCase,
    /// How ideographic characters should be transformed.
    pub other: TextTransformOther,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct TextTransformOther: u8 {
        /// Puts all typographic character units in full-width form.
        const FULL_WIDTH     = 1 << 0;
        /// Converts all small Kana characters to the equivalent full-size Kana.
        const FULL_SIZE_KANA = 1 << 1;
    }
}

/// Defines how text case should be transformed in the
/// [text-transform](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-transform-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` — unimplemented placeholder.
pub struct TextTransformCase;

/// A value for the [white-space](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#white-space-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct WhiteSpace;

/// A value for the [word-break](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#word-break-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct WordBreak;

/// A value for the [line-break](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#line-break-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct LineBreak;

/// A value for the [hyphens](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#hyphenation) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct Hyphens;

/// A value for the [overflow-wrap](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#overflow-wrap-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct OverflowWrap;

/// A value for the [text-align](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextAlign;

/// A value for the [text-align-last](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-align-last-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextAlignLast;

/// A value for the [text-justify](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-justify-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextJustify;

/// A value for the [word-spacing](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#word-spacing-property)
/// and [letter-spacing](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#letter-spacing-property) properties.
pub enum Spacing {
    /// No additional spacing is applied.
    Normal,
    /// Additional spacing between each word or letter.
    Length(Length),
}

/// A value for the [text-indent](https://www.w3.org/TR/2021/CRD-css-text-3-20210422/#text-indent-property) property.
pub struct TextIndent {
    /// The amount to indent.
    pub value: LengthPercentage,
    /// Inverts which lines are affected.
    pub hanging: bool,
    /// Affects the first line after each hard break.
    pub each_line: bool,
}

bitflags::bitflags! {
    /// A value for the [text-decoration-line](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-line-property) property.
    ///
    /// Multiple lines may be specified by combining the flags.
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct TextDecorationLine: u8 {
        /// Each line of text is underlined.
        const UNDERLINE      = 1 << 0;
        /// Each line of text has a line over it.
        const OVERLINE       = 1 << 1;
        /// Each line of text has a line through the middle.
        const LINE_THROUGH   = 1 << 2;
        /// The text blinks.
        const BLINK          = 1 << 3;
        /// The text is decorated as a spelling error.
        const SPELLING_ERROR = 1 << 4;
        /// The text is decorated as a grammar error.
        const GRAMMAR_ERROR  = 1 << 5;
    }
}

/// A value for the [text-decoration-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-style-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextDecorationStyle;

/// A value for the [text-decoration-thickness](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-width-property) property.
pub enum TextDecorationThickness {
    /// The UA chooses an appropriate thickness for text decoration lines.
    Auto,
    /// Use the thickness defined in the current font.
    FromFont,
    /// An explicit length.
    LengthPercentage(LengthPercentage),
}

/// A value for the [text-decoration](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-property) shorthand property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextDecoration;

/// A value for the [text-decoration-skip-ink](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-skip-ink-property) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextDecorationSkipInk;

/// A text emphasis shape for the [text-emphasis-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-style-property) property.
///
/// See [TextEmphasisStyle](TextEmphasisStyle).
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextEmphasisStyle;

/// A value for the [text-emphasis](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-property) shorthand property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextEmphasis;

/// A value for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
pub struct TextEmphasisPosition {
    /// The vertical position.
    pub vertical: TextEmphasisPositionVertical,
    /// The horizontal position.
    pub horizontal: TextEmphasisPositionHorizontal,
}

/// A vertical position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
///
/// See [TextEmphasisPosition](TextEmphasisPosition).
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextEmphasisPositionVertical;

/// A horizontal position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
///
/// See [TextEmphasisPosition](TextEmphasisPosition).
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct TextEmphasisPositionHorizontal;

/// A value for the [text-shadow](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-shadow-property) property.
#[derive(Clone, PartialEq)]
pub struct TextShadow {
    /// The color of the text shadow.
    pub color: CssColor,
    /// The x offset of the text shadow.
    pub x_offset: Length,
    /// The y offset of the text shadow.
    pub y_offset: Length,
    /// The blur radius of the text shadow.
    pub blur: Length,
    /// The spread distance of the text shadow.
    pub spread: Length, // added in Level 4 spec
}

impl TextShadow {
    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut color: Option<CssColor> = None;
        type Lengths = (Length, Length, Length, Length);
        let mut lengths: Option<Lengths> = None;

        loop {
            if lengths.is_none() {
                let value = input.try_parse(|i: &mut css::Parser| -> css::Result<Lengths> {
                    let horizontal = match Length::parse(i) {
                        Ok(v) => v,
                        Err(e) => return Err(e),
                    };
                    let vertical = match Length::parse(i) {
                        Ok(v) => v,
                        Err(e) => return Err(e),
                    };
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
            return Err(input.new_error(css::BasicParseErrorKind::QualifiedRuleInvalid));
        };
        Ok(Self {
            color: color.unwrap_or(CssColor::CurrentColor),
            x_offset: l.0,
            y_offset: l.1,
            blur: l.2,
            spread: l.3,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.x_offset.to_css(dest)?;
        dest.write_char(' ')?;
        self.y_offset.to_css(dest)?;

        if self.blur != Length::zero() || self.spread != Length::zero() {
            dest.write_char(' ')?;
            self.blur.to_css(dest)?;

            if self.spread != Length::zero() {
                dest.write_char(' ')?;
                self.spread.to_css(dest)?;
            }
        }

        if self.color != CssColor::CurrentColor {
            dest.write_char(' ')?;
            self.color.to_css(dest)?;
        }

        Ok(())
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        self.color.is_compatible(browsers)
            && self.x_offset.is_compatible(browsers)
            && self.y_offset.is_compatible(browsers)
            && self.blur.is_compatible(browsers)
            && self.spread.is_compatible(browsers)
    }

    // Zig: `pub fn eql` via `css.implementEql(@This(), ...)` — field-wise equality.
    // Ported as `#[derive(PartialEq)]` above; callers use `==`.

    pub fn deep_clone(&self, alloc: &bun_alloc::Arena) -> Self {
        // TODO(port): Zig used reflection-based `css.implementDeepClone`. Fields here
        // are value types, so a plain Clone is equivalent; arena param retained for
        // signature compatibility with the CSS deep_clone protocol.
        let _ = alloc;
        self.clone()
    }
}

/// A value for the [text-size-adjust](https://w3c.github.io/csswg-drafts/css-size-adjust/#adjustment-control) property.
pub enum TextSizeAdjust {
    /// Use the default size adjustment when displaying on a small device.
    Auto,
    /// No size adjustment when displaying on a small device.
    None,
    /// When displaying on a small device, the font size is multiplied by this percentage.
    Percentage(Percentage),
}

/// A value for the [direction](https://drafts.csswg.org/css-writing-modes-3/#direction) property.
// Zig wires eql/hash/parse/toCss/deepClone via `css.DefineEnumProperty(@This())`.
// In Rust these come from a derive; Phase B wires `#[derive(css::EnumProperty)]`.
// TODO(port): add `#[derive(css::EnumProperty)]` once the derive macro exists.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    /// This value sets inline base direction (bidi directionality) to line-left-to-line-right.
    Ltr,
    /// This value sets inline base direction (bidi directionality) to line-right-to-line-left.
    Rtl,
}

/// A value for the [unicode-bidi](https://drafts.csswg.org/css-writing-modes-3/#unicode-bidi) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct UnicodeBidi;

/// A value for the [box-decoration-break](https://www.w3.org/TR/css-break-3/#break-decoration) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(...))` — unimplemented placeholder.
pub struct BoxDecorationBreak;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/text.zig (272 lines)
//   confidence: medium
//   todos:      20
//   notes:      Most types are `@compileError` placeholders in Zig; ported as unit structs. `DefineEnumProperty` needs a Rust derive macro in Phase B.
// ──────────────────────────────────────────────────────────────────────────
