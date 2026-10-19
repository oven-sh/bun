#![warn(unused_must_use)]
use crate as css;
use crate::CSSString;
use crate::CSSStringFns;
use crate::PrintErr;
use crate::Printer;
use crate::VendorPrefix;
use crate::css_properties::custom::CustomPropertyName;
use crate::css_properties::{Property, PropertyIdTag};
use crate::css_values::calc::{Calc, MathFunction};
use crate::css_values::color::CssColor;
use crate::css_values::length::LengthPercentage;
use crate::css_values::length::LengthValue as Length;
use crate::prefixes::Feature;
use bun_alloc::Arena;
use bun_alloc::ArenaVecExt as _;

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

bitflags::bitflags! {
    /// A value for the [text-decoration-line](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-line-property) property.
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

impl TextDecorationLine {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut value: Option<TextDecorationLine> = None;
        while let Ok(flag) = input.try_parse(Self::parse_keyword) {
            value = Some(match value {
                None => flag,
                // Unlike lightningcss: `none` and the error lines stand alone and no line repeats, as in browsers.
                Some(lines) if lines.combines() && flag.combines() && !lines.intersects(flag) => {
                    lines | flag
                }
                Some(_) => {
                    return Err(input.new_custom_error(css::ParserError::invalid_declaration));
                }
            });
        }
        value.ok_or_else(|| input.new_custom_error(css::ParserError::invalid_declaration))
    }

    fn parse_keyword(input: &mut css::Parser) -> css::Result<Self> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        Ok(crate::match_ignore_ascii_case! { ident, {
            b"none" => TextDecorationLine::empty(),
            b"underline" => TextDecorationLine::UNDERLINE,
            b"overline" => TextDecorationLine::OVERLINE,
            b"line-through" => TextDecorationLine::LINE_THROUGH,
            b"blink" => TextDecorationLine::BLINK,
            b"spelling-error" => TextDecorationLine::SPELLING_ERROR,
            b"grammar-error" => TextDecorationLine::GRAMMAR_ERROR,
            _ => return Err(location.new_unexpected_token_error(css::Token::Ident(ident))),
        }})
    }

    fn combines(self) -> bool {
        !self.is_empty() && !self.intersects(Self::SPELLING_ERROR.union(Self::GRAMMAR_ERROR))
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.is_empty() {
            return dest.write_str("none");
        }
        if self.contains(Self::SPELLING_ERROR) {
            return dest.write_str("spelling-error");
        }
        if self.contains(Self::GRAMMAR_ERROR) {
            return dest.write_str("grammar-error");
        }

        let mut needs_space = false;
        for (flag, name) in [
            (Self::UNDERLINE, "underline"),
            (Self::OVERLINE, "overline"),
            (Self::LINE_THROUGH, "line-through"),
            (Self::BLINK, "blink"),
        ] {
            if self.contains(flag) {
                if needs_space {
                    dest.write_char(b' ')?;
                }
                dest.write_str(name)?;
                needs_space = true;
            }
        }
        Ok(())
    }
}

/// A value for the [text-decoration-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-style-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextDecorationStyle {
    /// A single line segment.
    Solid,
    /// Two parallel solid lines with some space between them.
    Double,
    /// A series of round dots.
    Dotted,
    /// A series of square-ended dashes.
    Dashed,
    /// A wavy line.
    Wavy,
}

/// A value for the [text-decoration-thickness](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-width-property) property.
#[derive(Clone, PartialEq, crate::Parse, crate::ToCss)]
pub enum TextDecorationThickness {
    /// The UA chooses an appropriate thickness for text decoration lines.
    Auto,
    /// Use the thickness defined in the current font.
    FromFont,
    /// An explicit length.
    LengthPercentage(LengthPercentage),
}

/// A value for the [text-decoration](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-decoration-property) shorthand property.
#[derive(Clone, PartialEq)]
pub struct TextDecoration {
    /// The lines to display.
    pub(crate) line: TextDecorationLine,
    /// The thickness of the lines.
    pub(crate) thickness: TextDecorationThickness,
    /// The style of the lines.
    pub(crate) style: TextDecorationStyle,
    /// The color of the lines.
    pub(crate) color: CssColor,
}

impl TextDecoration {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut line = None;
        let mut thickness = None;
        let mut style = None;
        let mut color = None;

        loop {
            macro_rules! prop {
                ($key:ident, $ty:ty) => {
                    if $key.is_none()
                        && let Ok(value) = input.try_parse(<$ty>::parse)
                    {
                        $key = Some(value);
                        continue;
                    }
                };
            }

            prop!(line, TextDecorationLine);
            prop!(thickness, TextDecorationThickness);
            prop!(style, TextDecorationStyle);
            prop!(color, CssColor);
            break;
        }

        // Unlike lightningcss: an empty value is not a declaration.
        if line.is_none() && thickness.is_none() && style.is_none() && color.is_none() {
            return Err(input.new_custom_error(css::ParserError::invalid_declaration));
        }

        Ok(TextDecoration {
            line: line.unwrap_or_default(),
            thickness: thickness.unwrap_or(TextDecorationThickness::Auto),
            style: style.unwrap_or(TextDecorationStyle::Solid),
            color: color.unwrap_or(CssColor::CurrentColor),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let has_thickness = self.thickness != TextDecorationThickness::Auto;
        let has_style = self.style != TextDecorationStyle::Solid;
        let has_color = self.color != CssColor::CurrentColor;

        // Unlike lightningcss: a thickness, style or color is printed when the line is `none` too.
        let mut needs_space = !self.line.is_empty() || !(has_thickness || has_style || has_color);
        if needs_space {
            self.line.to_css(dest)?;
        }

        if has_thickness {
            if needs_space {
                dest.write_char(b' ')?;
            }
            self.thickness.to_css(dest)?;
            needs_space = true;
        }

        if has_style {
            if needs_space {
                dest.write_char(b' ')?;
            }
            self.style.to_css(dest)?;
            needs_space = true;
        }

        if has_color {
            if needs_space {
                dest.write_char(b' ')?;
            }
            self.color.to_css(dest)?;
        }

        Ok(())
    }

    fn get_fallbacks(&mut self, arena: &Arena, targets: &css::targets::Targets) -> Vec<Self> {
        let colors = self.color.get_fallbacks(arena, targets);
        colors
            .to_owned_slice()
            .into_vec()
            .into_iter()
            .map(|color| TextDecoration {
                color,
                ..self.clone()
            })
            .collect()
    }
}

/// A keyword for the [text-emphasis-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-style-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextEmphasisFillMode {
    /// The shape is filled with solid color.
    Filled,
    /// The shape is hollow.
    Open,
}

/// A text emphasis shape for the [text-emphasis-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-style-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextEmphasisShape {
    /// Display small circles as marks.
    Dot,
    /// Display large circles as marks.
    Circle,
    /// Display double circles as marks.
    DoubleCircle,
    /// Display triangles as marks.
    Triangle,
    /// Display sesames as marks.
    Sesame,
}

/// A value for the [text-emphasis-style](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-style-property) property.
#[derive(Clone, Copy)]
pub enum TextEmphasisStyle {
    /// No emphasis.
    None,
    /// Defines the fill and shape of the marks.
    Keyword {
        /// The fill mode for the marks.
        fill: TextEmphasisFillMode,
        /// The shape of the marks.
        shape: Option<TextEmphasisShape>,
    },
    /// Display the given string as marks.
    String(CSSString),
}

impl PartialEq for TextEmphasisStyle {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::None, Self::None) => true,
            (
                Self::Keyword { fill, shape },
                Self::Keyword {
                    fill: other_fill,
                    shape: other_shape,
                },
            ) => fill == other_fill && shape == other_shape,
            // SAFETY: both strings are slices of the parser arena.
            (Self::String(a), Self::String(b)) => unsafe {
                crate::arena_str(*a) == crate::arena_str(*b)
            },
            _ => false,
        }
    }
}

impl TextEmphasisStyle {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if input
            .try_parse(|input| input.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(TextEmphasisStyle::None);
        }

        if let Ok(string) =
            input.try_parse(|input| input.expect_string().map(std::ptr::from_ref::<[u8]>))
        {
            return Ok(TextEmphasisStyle::String(string));
        }

        let mut shape = input.try_parse(TextEmphasisShape::parse).ok();
        let fill = input.try_parse(TextEmphasisFillMode::parse).ok();
        if shape.is_none() {
            shape = input.try_parse(TextEmphasisShape::parse).ok();
        }

        if shape.is_none() && fill.is_none() {
            return Err(input.new_custom_error(css::ParserError::invalid_declaration));
        }

        Ok(TextEmphasisStyle::Keyword {
            fill: fill.unwrap_or(TextEmphasisFillMode::Filled),
            shape,
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            TextEmphasisStyle::None => dest.write_str("none"),
            TextEmphasisStyle::String(string) => CSSStringFns::to_css(string, dest),
            TextEmphasisStyle::Keyword { fill, shape } => {
                let needs_space = *fill != TextEmphasisFillMode::Filled || shape.is_none();
                if needs_space {
                    fill.to_css(dest)?;
                }

                if let Some(shape) = shape {
                    if needs_space {
                        dest.write_char(b' ')?;
                    }
                    shape.to_css(dest)?;
                }
                Ok(())
            }
        }
    }
}

/// A value for the [text-emphasis](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-property) shorthand property.
#[derive(Clone, PartialEq)]
pub struct TextEmphasis {
    /// The text emphasis style.
    pub(crate) style: TextEmphasisStyle,
    /// The text emphasis color.
    pub(crate) color: CssColor,
}

impl TextEmphasis {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut style = None;
        let mut color = None;

        loop {
            if style.is_none()
                && let Ok(value) = input.try_parse(TextEmphasisStyle::parse)
            {
                style = Some(value);
                continue;
            }

            if color.is_none()
                && let Ok(value) = input.try_parse(CssColor::parse)
            {
                color = Some(value);
                continue;
            }

            break;
        }

        // Unlike lightningcss: an empty value is not a declaration.
        if style.is_none() && color.is_none() {
            return Err(input.new_custom_error(css::ParserError::invalid_declaration));
        }

        Ok(TextEmphasis {
            style: style.unwrap_or(TextEmphasisStyle::None),
            color: color.unwrap_or(CssColor::CurrentColor),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let has_style = self.style != TextEmphasisStyle::None;
        let has_color = self.color != CssColor::CurrentColor;

        // Unlike lightningcss: a color is printed when the style is `none` too.
        if has_style || !has_color {
            self.style.to_css(dest)?;
        }

        if has_color {
            if has_style {
                dest.write_char(b' ')?;
            }
            self.color.to_css(dest)?;
        }

        Ok(())
    }

    fn get_fallbacks(&mut self, arena: &Arena, targets: &css::targets::Targets) -> Vec<Self> {
        let colors = self.color.get_fallbacks(arena, targets);
        colors
            .to_owned_slice()
            .into_vec()
            .into_iter()
            .map(|color| TextEmphasis {
                color,
                ..self.clone()
            })
            .collect()
    }
}

/// A vertical position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextEmphasisPositionVertical {
    /// Draw marks over the text in horizontal typographic modes.
    Over,
    /// Draw marks under the text in horizontal typographic modes.
    Under,
}

/// A horizontal position keyword for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum TextEmphasisPositionHorizontal {
    /// Draw marks to the right of the text in vertical typographic modes.
    Left,
    /// Draw marks to the left of the text in vertical typographic modes.
    Right,
}

/// A value for the [text-emphasis-position](https://www.w3.org/TR/2020/WD-css-text-decor-4-20200506/#text-emphasis-position-property) property.
#[derive(Clone, Copy, PartialEq)]
pub struct TextEmphasisPosition {
    /// The vertical position.
    pub(crate) vertical: TextEmphasisPositionVertical,
    /// The horizontal position.
    pub(crate) horizontal: TextEmphasisPositionHorizontal,
}

impl TextEmphasisPosition {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Self> {
        if let Ok(horizontal) = input.try_parse(TextEmphasisPositionHorizontal::parse) {
            let vertical = TextEmphasisPositionVertical::parse(input)?;
            Ok(TextEmphasisPosition {
                horizontal,
                vertical,
            })
        } else {
            let vertical = TextEmphasisPositionVertical::parse(input)?;
            let horizontal = input
                .try_parse(TextEmphasisPositionHorizontal::parse)
                .unwrap_or(TextEmphasisPositionHorizontal::Right);
            Ok(TextEmphasisPosition {
                horizontal,
                vertical,
            })
        }
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.vertical.to_css(dest)?;
        if self.horizontal != TextEmphasisPositionHorizontal::Right {
            dest.write_char(b' ')?;
            self.horizontal.to_css(dest)?;
        }
        Ok(())
    }
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

bitflags::bitflags! {
    /// A set of the properties that `TextDecorationHandler` takes.
    #[derive(Clone, Copy, Default)]
    struct Names: u16 {
        const LINE              = 1 << 0;
        const STYLE             = 1 << 1;
        const COLOR             = 1 << 2;
        const EMPHASIS_STYLE    = 1 << 3;
        const EMPHASIS_COLOR    = 1 << 4;
        const EMPHASIS_POSITION = 1 << 5;
        const THICKNESS         = 1 << 6;
        const DECORATION        = 1 << 7;
        const EMPHASIS          = 1 << 8;
    }
}

/// The count of longhands that have a prefixed name. They are the low bits of `Names`.
const PREFIXED_LONGHANDS: usize = 6;

impl Names {
    fn of(tag: PropertyIdTag) -> Option<Names> {
        Some(match tag {
            PropertyIdTag::TextDecorationLine => Names::LINE,
            PropertyIdTag::TextDecorationThickness => Names::THICKNESS,
            PropertyIdTag::TextDecorationStyle => Names::STYLE,
            PropertyIdTag::TextDecorationColor => Names::COLOR,
            PropertyIdTag::TextDecoration => Names::DECORATION,
            PropertyIdTag::TextEmphasisStyle => Names::EMPHASIS_STYLE,
            PropertyIdTag::TextEmphasisColor => Names::EMPHASIS_COLOR,
            PropertyIdTag::TextEmphasis => Names::EMPHASIS,
            PropertyIdTag::TextEmphasisPosition => Names::EMPHASIS_POSITION,
            _ => return None,
        })
    }

    /// The longhands that a declaration of these properties sets.
    fn longhands(self) -> Names {
        let mut longhands = self;
        if self.contains(Names::DECORATION) {
            longhands |= Names::LINE | Names::STYLE | Names::COLOR;
        }
        if self.contains(Names::EMPHASIS) {
            longhands |= Names::EMPHASIS_STYLE | Names::EMPHASIS_COLOR;
        }
        longhands
    }
}

/// Folds the `text-decoration` and `text-emphasis` longhands and writes the prefixes that the targets need.
#[derive(Default)]
pub struct TextDecorationHandler {
    line: Option<TextDecorationLine>,
    thickness: Option<TextDecorationThickness>,
    style: Option<TextDecorationStyle>,
    color: Option<CssColor>,
    /// The prefixes of the declarations that set the four values above.
    decoration: VendorPrefix,
    emphasis_style: Option<TextEmphasisStyle>,
    emphasis_color: Option<CssColor>,
    /// The prefixes of the declarations that set the two values above.
    emphasis: VendorPrefix,
    emphasis_position: Option<(TextEmphasisPosition, VendorPrefix)>,
    /// The properties whose declarations set the values in the buffer.
    buffered: Names,
    /// The properties that the handler wrote to the block since `all`.
    flushed: Names,
    /// The prefixes that the author wrote for each longhand since `all`.
    written: [VendorPrefix; PREFIXED_LONGHANDS],
    /// The prefixes that the author wrote for each longhand in the other list of the block (`!important` or not).
    elsewhere: [VendorPrefix; PREFIXED_LONGHANDS],
}

/// How a declaration relates to the values of its group in the buffer.
struct Relation {
    /// The declaration sets the longhands that the buffer has, to the values that the buffer has.
    same: bool,
    /// The declaration sets a longhand that the buffer has to another value.
    differs: bool,
}

impl TextDecorationHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        macro_rules! relation {
            ($($slot:ident: $val:expr),+) => {{
                let mut relation = Relation { same: true, differs: false };
                $(match (&self.$slot, $val) {
                    (Some(old), Some(new)) if old != new => {
                        relation.same = false;
                        relation.differs = true;
                    }
                    (Some(_), None) | (None, Some(_)) => relation.same = false,
                    _ => {}
                })+
                relation
            }};
        }

        macro_rules! set {
            ($($slot:ident ($longhand:expr): $val:expr),+) => {
                $(if let Some(val) = $val {
                    if self.$slot.as_ref().is_some_and(|old| old != val) {
                        self.buffered.remove($longhand);
                    }
                    self.$slot = Some(val.clone());
                })+
            };
        }

        macro_rules! decoration {
            ($name:expr, $vp:expr, $line:expr, $thickness:expr, $style:expr, $color:expr) => {{
                let (name, vp) = ($name, $vp);
                let relation =
                    relation!(line: $line, thickness: $thickness, style: $style, color: $color);
                if !self.decoration.is_empty()
                    && !self.joins_decoration(name, vp, &relation, &context.targets)
                {
                    self.flush(dest, context);
                }
                set!(line(Names::LINE): $line, thickness(Names::THICKNESS): $thickness, style(Names::STYLE): $style, color(Names::COLOR): $color);
                self.decoration.insert(vp);
                self.buffered.insert(name);
                self.wrote(name, vp);
            }};
        }

        macro_rules! emphasis {
            ($name:expr, $vp:expr, $style:expr, $color:expr) => {{
                let (name, vp) = ($name, $vp);
                let relation = relation!(emphasis_style: $style, emphasis_color: $color);
                let shorthand = (Names::EMPHASIS, Feature::TextEmphasis);
                if !self.emphasis.is_empty()
                    && !self.joins(self.emphasis, name, vp, &relation, shorthand, &context.targets)
                {
                    self.flush(dest, context);
                }
                set!(emphasis_style(Names::EMPHASIS_STYLE): $style, emphasis_color(Names::EMPHASIS_COLOR): $color);
                self.emphasis.insert(vp);
                self.buffered.insert(name);
                self.wrote(name, vp);
            }};
        }

        const NO_LINE: Option<&TextDecorationLine> = None;
        const NO_THICKNESS: Option<&TextDecorationThickness> = None;
        const NO_STYLE: Option<&TextDecorationStyle> = None;
        const NO_EMPHASIS_STYLE: Option<&TextEmphasisStyle> = None;
        const NO_COLOR: Option<&CssColor> = None;

        match property {
            Property::TextDecorationLine(v) => {
                decoration!(
                    Names::LINE,
                    v.1,
                    Some(&v.0),
                    NO_THICKNESS,
                    NO_STYLE,
                    NO_COLOR
                )
            }
            Property::TextDecorationThickness(v) => {
                decoration!(
                    Names::THICKNESS,
                    VendorPrefix::NONE,
                    NO_LINE,
                    Some(v),
                    NO_STYLE,
                    NO_COLOR
                )
            }
            Property::TextDecorationStyle(v) => {
                decoration!(
                    Names::STYLE,
                    v.1,
                    NO_LINE,
                    NO_THICKNESS,
                    Some(&v.0),
                    NO_COLOR
                )
            }
            Property::TextDecorationColor(v) => {
                decoration!(
                    Names::COLOR,
                    v.1,
                    NO_LINE,
                    NO_THICKNESS,
                    NO_STYLE,
                    Some(&v.0)
                )
            }
            Property::TextDecoration(v) => decoration!(
                Names::DECORATION,
                v.1,
                Some(&v.0.line),
                Some(&v.0.thickness),
                Some(&v.0.style),
                Some(&v.0.color)
            ),
            Property::TextEmphasisStyle(v) => {
                emphasis!(Names::EMPHASIS_STYLE, v.1, Some(&v.0), NO_COLOR)
            }
            Property::TextEmphasisColor(v) => {
                emphasis!(Names::EMPHASIS_COLOR, v.1, NO_EMPHASIS_STYLE, Some(&v.0))
            }
            Property::TextEmphasis(v) => {
                emphasis!(Names::EMPHASIS, v.1, Some(&v.0.style), Some(&v.0.color))
            }
            Property::TextEmphasisPosition(v) => {
                match &mut self.emphasis_position {
                    Some((position, prefixes)) if *position == v.0 => prefixes.insert(v.1),
                    position => {
                        // A second value is a new declaration, as for the other properties.
                        if position.is_some() {
                            self.flush(dest, context);
                        }
                        self.emphasis_position = Some(*v);
                    }
                }
                self.buffered.insert(Names::EMPHASIS_POSITION);
                self.wrote(Names::EMPHASIS_POSITION, v.1);
            }
            Property::Unparsed(unparsed) => {
                let tag = unparsed.property_id.tag();
                let Some(name) = Names::of(tag) else {
                    if tag == PropertyIdTag::All {
                        self.see_other(true, dest, context);
                    }
                    return false;
                };
                self.flush(dest, context);

                let written = unparsed.property_id.prefix().or_none();
                let mut prefixes = written;
                // Unlike lightningcss: an unparsed longhand gets the prefixes of its own feature, as its typed value does.
                if let Some(feature) = tag.prefix_feature() {
                    prefixes = self.prefixes(written, name, feature, &context.targets);
                }
                self.flushed.insert(name);
                self.wrote(name, written);

                let arena = dest.bump();
                let mut unparsed =
                    unparsed.with_property_id(arena, unparsed.property_id.with_prefix(prefixes));
                context.add_unparsed_fallbacks(arena, &mut unparsed);
                dest.push(Property::Unparsed(unparsed));
            }
            Property::All(_) => {
                self.see_other(true, dest, context);
                return false;
            }
            Property::Custom(custom) => {
                match &custom.name {
                    CustomPropertyName::Custom(_) => {}
                    name => {
                        self.see_other(name.as_str().eq_ignore_ascii_case(b"all"), dest, context)
                    }
                }
                return false;
            }
            _ => return false,
        }

        true
    }

    /// Whether a declaration can go into a buffer that has values of its group with the prefixes `buffered`.
    fn joins(
        &self,
        buffered: VendorPrefix,
        name: Names,
        vp: VendorPrefix,
        relation: &Relation,
        shorthand: (Names, Feature),
        targets: &css::targets::Targets,
    ) -> bool {
        if relation.same {
            return true;
        }
        // Unlike lightningcss: a declaration with other prefixes replaces nothing, so each prefix keeps its values.
        if vp != buffered {
            return false;
        }
        // Unlike lightningcss: a second value of one property is a new declaration, so a fallback value stays.
        if relation.differs && self.buffered.contains(name) {
            return false;
        }
        // Unlike lightningcss: unprefixed declarations fold only when the block has no prefix that the targets need. A second pass sees the prefixes of the first one, and folds nothing more.
        !vp.contains(VendorPrefix::NONE)
            || !targets
                .prefixes(VendorPrefix::NONE, shorthand.1)
                .intersects(self.covered(shorthand.0))
    }

    fn joins_decoration(
        &self,
        name: Names,
        vp: VendorPrefix,
        relation: &Relation,
        targets: &css::targets::Targets,
    ) -> bool {
        if relation.same {
            // A thickness has no prefixed longhand, so a shorthand with a thickness keeps its own prefixes.
            return vp == self.decoration
                || matches!(self.thickness, None | Some(TextDecorationThickness::Auto));
        }
        // Unlike lightningcss: nothing folds with no browser list. Safari reads a style or a color only in the prefixed shorthand, and it reads the unprefixed longhands.
        (!vp.contains(VendorPrefix::NONE) || targets.browsers.is_some())
            && self.joins(
                self.decoration,
                name,
                vp,
                relation,
                (Names::DECORATION, Feature::TextDecoration),
                targets,
            )
    }

    /// Takes `all`, which sets every property, or an unknown name, which can be one more spelling of a property in the buffer.
    fn see_other(
        &mut self,
        all: bool,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        // Unlike lightningcss: the buffer is written before a declaration that can override it.
        self.flush(dest, context);
        if all {
            self.flushed = Names::empty();
            self.written = Default::default();
        }
    }

    /// Records the prefixed names in the other list of the block (`!important` or not).
    pub(crate) fn see_other_list(&mut self, declarations: &css::DeclarationList) {
        for declaration in declarations.iter() {
            let id = declaration.property_id();
            if let Some(name) = Names::of(id.tag()) {
                Self::record(&mut self.elsewhere, name, id.prefix());
            }
        }
    }

    pub(crate) fn finalize(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        self.flush(dest, context);
        self.flushed = Names::empty();
        self.written = Default::default();
        self.elsewhere = Default::default();
    }

    /// Records the prefixes of a declaration that the author wrote.
    fn wrote(&mut self, name: Names, prefixes: VendorPrefix) {
        Self::record(&mut self.written, name, prefixes);
    }

    fn record(
        written: &mut [VendorPrefix; PREFIXED_LONGHANDS],
        name: Names,
        prefixes: VendorPrefix,
    ) {
        let longhands = name.longhands().bits();
        for (i, written) in written.iter_mut().enumerate() {
            if longhands & (1 << i) != 0 {
                written.insert(prefixes.difference(VendorPrefix::NONE));
            }
        }
    }

    /// The prefixes that the author wrote for a longhand that a declaration of `name` sets.
    fn covered(&self, name: Names) -> VendorPrefix {
        let longhands = name.longhands().bits();
        let mut covered = VendorPrefix::empty();
        for i in 0..PREFIXED_LONGHANDS {
            if longhands & (1 << i) != 0 {
                covered.insert(self.written[i] | self.elsewhere[i]);
            }
        }
        covered
    }

    /// The prefixes to write a declaration with: the written ones, and the ones that the targets need.
    fn prefixes(
        &self,
        written: VendorPrefix,
        name: Names,
        feature: Feature,
        targets: &css::targets::Targets,
    ) -> VendorPrefix {
        if !written.contains(VendorPrefix::NONE) {
            return written;
        }
        // Unlike lightningcss: a written prefix stays, and a prefix that the block has for a longhand is not added.
        written
            | targets
                .prefixes(VendorPrefix::NONE, feature)
                .difference(self.covered(name))
    }

    fn flush(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        if self.buffered.is_empty() {
            return;
        }

        let arena = dest.bump();
        let targets = context.targets;

        // A declaration equal to the one before it joins that one, as it does in the buffer. So a second pass finds no pair to merge.
        macro_rules! push {
            ($prop:ident, $val:expr, $prefixes:expr) => {{
                let (val, prefixes) = ($val, $prefixes);
                match dest.last_mut() {
                    Some(Property::$prop(last)) if last.0 == val => last.1.insert(prefixes),
                    _ => dest.push(Property::$prop((val, prefixes))),
                }
            }};
        }

        macro_rules! single_property {
            ($val:expr, $written:expr, $prop:ident, $name:expr) => {
                if let Some(val) = $val {
                    let prefixes = self.prefixes($written, $name, Feature::$prop, &targets);
                    push!($prop, val, prefixes);
                }
            };
        }

        macro_rules! color {
            ($val:expr, $written:expr, $prop:ident, $name:expr) => {
                if let Some(mut val) = $val {
                    let prefixes = self.prefixes($written, $name, Feature::$prop, &targets);
                    if prefixes.contains(VendorPrefix::NONE) && !self.flushed.contains($name) {
                        let fallbacks = val.get_fallbacks(arena, &targets);
                        for fallback in fallbacks.to_owned_slice().into_vec() {
                            push!($prop, fallback, prefixes);
                        }
                    }
                    push!($prop, val, prefixes);
                }
            };
        }

        macro_rules! thickness {
            ($val:expr) => {
                let val = match $val {
                    // A percentage is a part of 1em. Targets that do not read one get a calc().
                    TextDecorationThickness::LengthPercentage(LengthPercentage::Percentage(p))
                        if targets.should_compile_same(
                            css::compat::Feature::TextDecorationThicknessPercent,
                        ) =>
                    {
                        let em =
                            Calc::Value(Box::new(LengthPercentage::Dimension(Length::Em(1.0))));
                        let calc = Calc::Function(Box::new(MathFunction::Calc(Calc::Product {
                            number: p.v,
                            expression: Box::new(em),
                        })));
                        TextDecorationThickness::LengthPercentage(LengthPercentage::Calc(
                            Box::new(calc),
                        ))
                    }
                    val => val,
                };
                if !matches!(dest.last(), Some(Property::TextDecorationThickness(last)) if *last == val)
                {
                    dest.push(Property::TextDecorationThickness(val));
                }
            };
        }

        let written = core::mem::take(&mut self.decoration);
        match (
            self.line.take(),
            self.thickness.take(),
            self.style.take(),
            self.color.take(),
        ) {
            (Some(line), Some(thickness), Some(style), Some(color)) => {
                let mut prefixes = written;
                let mut decoration = TextDecoration {
                    line,
                    thickness,
                    style,
                    color,
                };
                let mut thickness = None;

                if written.contains(VendorPrefix::NONE) {
                    // Only add prefixes if one of the new sub-properties was used
                    if decoration.style != TextDecorationStyle::Solid
                        || decoration.color != CssColor::CurrentColor
                    {
                        prefixes = self.prefixes(
                            written,
                            Names::DECORATION,
                            Feature::TextDecoration,
                            &targets,
                        );
                        if !self.flushed.contains(Names::DECORATION) {
                            for fallback in decoration.get_fallbacks(arena, &targets) {
                                push!(TextDecoration, fallback, prefixes);
                            }
                        }
                    }

                    // Some browsers don't support thickness in the shorthand property yet.
                    if decoration.thickness != TextDecorationThickness::Auto
                        && !(prefixes == VendorPrefix::NONE
                            && targets.is_compatible(
                                css::compat::Feature::TextDecorationThicknessShorthand,
                            ))
                    {
                        thickness = Some(core::mem::replace(
                            &mut decoration.thickness,
                            TextDecorationThickness::Auto,
                        ));
                    }
                }

                match dest.last_mut() {
                    // A shorthand with a thickness keeps its own prefixes here too: see `joins_decoration`.
                    Some(Property::TextDecoration(last))
                        if last.0 == decoration
                            && (last.1 == prefixes
                                || decoration.thickness == TextDecorationThickness::Auto) =>
                    {
                        last.1.insert(prefixes)
                    }
                    _ => dest.push(Property::TextDecoration((decoration, prefixes))),
                }
                if let Some(thickness) = thickness {
                    thickness!(thickness);
                }
            }
            (line, thickness, style, color) => {
                single_property!(line, written, TextDecorationLine, Names::LINE);
                single_property!(style, written, TextDecorationStyle, Names::STYLE);
                color!(color, written, TextDecorationColor, Names::COLOR);
                if let Some(thickness) = thickness {
                    thickness!(thickness);
                }
            }
        }

        let written = core::mem::take(&mut self.emphasis);
        match (self.emphasis_style.take(), self.emphasis_color.take()) {
            (Some(style), Some(color)) => {
                let prefixes =
                    self.prefixes(written, Names::EMPHASIS, Feature::TextEmphasis, &targets);
                let mut emphasis = TextEmphasis { style, color };
                if prefixes.contains(VendorPrefix::NONE) && !self.flushed.contains(Names::EMPHASIS)
                {
                    for fallback in emphasis.get_fallbacks(arena, &targets) {
                        push!(TextEmphasis, fallback, prefixes);
                    }
                }
                push!(TextEmphasis, emphasis, prefixes);
            }
            (style, color) => {
                single_property!(style, written, TextEmphasisStyle, Names::EMPHASIS_STYLE);
                color!(color, written, TextEmphasisColor, Names::EMPHASIS_COLOR);
            }
        }

        if let Some((position, written)) = self.emphasis_position.take() {
            // Unlike lightningcss: a written prefix stays. The prefixed name does not read a horizontal keyword.
            let prefixes = if position.horizontal == TextEmphasisPositionHorizontal::Right {
                self.prefixes(
                    written,
                    Names::EMPHASIS_POSITION,
                    Feature::TextEmphasisPosition,
                    &targets,
                )
            } else {
                written
            };
            push!(TextEmphasisPosition, position, prefixes);
        }

        self.flushed.insert(core::mem::take(&mut self.buffered));
    }
}
