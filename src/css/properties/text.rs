#![warn(unused_must_use)]
use crate as css;
use crate::CSSString;
use crate::CSSStringFns;
use crate::PrintErr;
use crate::Printer;
use crate::VendorPrefix;
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

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
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

        while !input.is_exhausted() {
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
#[derive(Clone, Copy, PartialEq, Eq)]
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

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
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
    /// The longhands of `text-decoration` and `text-emphasis` that have a prefixed name.
    #[derive(Clone, Copy, PartialEq, Eq)]
    struct Longhands: u8 {
        const LINE              = 1 << 0;
        const STYLE             = 1 << 1;
        const COLOR             = 1 << 2;
        const EMPHASIS_STYLE    = 1 << 3;
        const EMPHASIS_COLOR    = 1 << 4;
        const EMPHASIS_POSITION = 1 << 5;
        const DECORATION        = Self::LINE.bits() | Self::STYLE.bits() | Self::COLOR.bits();
        const EMPHASIS          = Self::EMPHASIS_STYLE.bits() | Self::EMPHASIS_COLOR.bits();
    }
}

impl Longhands {
    const COUNT: usize = 6;

    /// The longhands that a declaration of a property sets. `None` is a property that the handler does not take.
    fn of(tag: PropertyIdTag) -> Option<Longhands> {
        Some(match tag {
            PropertyIdTag::TextDecorationLine => Longhands::LINE,
            PropertyIdTag::TextDecorationThickness => Longhands::empty(),
            PropertyIdTag::TextDecorationStyle => Longhands::STYLE,
            PropertyIdTag::TextDecorationColor => Longhands::COLOR,
            PropertyIdTag::TextDecoration => Longhands::DECORATION,
            PropertyIdTag::TextEmphasisStyle => Longhands::EMPHASIS_STYLE,
            PropertyIdTag::TextEmphasisColor => Longhands::EMPHASIS_COLOR,
            PropertyIdTag::TextEmphasis => Longhands::EMPHASIS,
            PropertyIdTag::TextEmphasisPosition => Longhands::EMPHASIS_POSITION,
            _ => return None,
        })
    }
}

/// The prefixes of the declarations that set each of the `Longhands`. `NONE` is an unprefixed declaration.
type Prefixes = [VendorPrefix; Longhands::COUNT];

/// Records a declaration that the author wrote. One with a prefix and `NONE` is an unprefixed one with the copies of an earlier pass.
fn record(prefixes: &mut Prefixes, longhands: Longhands, vp: VendorPrefix) {
    let vp = if vp.contains(VendorPrefix::NONE) {
        VendorPrefix::NONE
    } else {
        vp
    };
    for (i, prefixes) in prefixes.iter_mut().enumerate() {
        if longhands.bits() & (1 << i) != 0 {
            prefixes.insert(vp);
        }
    }
}

/// Writes the prefixes, color fallbacks and thickness longhand that the targets need. Unlike lightningcss: a declaration stays where it is and no longhand is folded, so a second pass changes nothing.
#[derive(Default)]
pub struct TextDecorationHandler {
    /// What the author wrote in the block since `all`.
    written: Prefixes,
    /// What the author wrote in the other list of the block (`!important` or not).
    elsewhere: Prefixes,
    /// The length of the list after the last declaration of this handler. `None`: the block has none yet.
    mark: Option<usize>,
    /// WebKit can have a decoration style or color that a line alone does not reset: see `styles`.
    stale: bool,
}

impl TextDecorationHandler {
    /// Inlined into the handler chain, so a declaration that this handler does not take costs one test of its tag.
    #[inline(always)]
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        other: &css::DeclarationList,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        match property {
            Property::TextDecorationLine(_)
            | Property::TextDecorationThickness(_)
            | Property::TextDecorationStyle(_)
            | Property::TextDecorationColor(_)
            | Property::TextDecoration(_)
            | Property::TextEmphasisStyle(_)
            | Property::TextEmphasisColor(_)
            | Property::TextEmphasis(_)
            | Property::TextEmphasisPosition(_) => self.handle(property, other, dest, context),
            Property::Unparsed(unparsed) if Longhands::of(unparsed.property_id.tag()).is_some() => {
                self.handle(property, other, dest, context)
            }
            _ => false,
        }
    }

    #[inline(never)]
    fn handle(
        &mut self,
        property: &Property,
        other: &css::DeclarationList,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        let arena = dest.bump();
        let targets = context.targets;

        match self.mark {
            None => self.see_other_list(other, context.is_important),
            // `all` sets every property, so what the block has before it counts no more. `all` has no row: it is an unknown name.
            Some(mark) => {
                let all = dest[mark..].iter().any(|property| match property {
                    Property::All(_) => true,
                    Property::Unparsed(unparsed) => {
                        unparsed.property_id.tag() == PropertyIdTag::All
                    }
                    Property::Custom(custom) => custom.name.as_str().eq_ignore_ascii_case(b"all"),
                    _ => false,
                });
                if all {
                    self.written = Prefixes::default();
                    self.stale = false;
                }
            }
        }
        let stale = self.stale;
        self.stale |= Self::styles(property);

        macro_rules! longhand {
            ($prop:ident, $longhands:ident, $v:expr) => {{
                let prefixes = self.take(Longhands::$longhands, $v.1, Feature::$prop, &targets);
                dest.push(Property::$prop(($v.0.clone(), prefixes)));
            }};
        }

        macro_rules! with_fallbacks {
            ($prop:ident, $longhands:ident, $v:expr, $fallbacks:expr) => {{
                let first = self.needs_fallbacks(Longhands::$longhands);
                let prefixes = self.take(Longhands::$longhands, $v.1, Feature::$prop, &targets);
                let mut val = $v.0.clone();
                if first && prefixes.contains(VendorPrefix::NONE) {
                    for fallback in $fallbacks(&mut val) {
                        dest.push(Property::$prop((fallback, prefixes)));
                    }
                }
                dest.push(Property::$prop((val, prefixes)));
            }};
        }

        let color_fallbacks = |color: &mut CssColor| {
            color
                .get_fallbacks(arena, &targets)
                .to_owned_slice()
                .into_vec()
        };

        match property {
            Property::TextDecorationLine(v) => longhand!(TextDecorationLine, LINE, v),
            Property::TextDecorationStyle(v) => longhand!(TextDecorationStyle, STYLE, v),
            Property::TextDecorationColor(v) => {
                with_fallbacks!(TextDecorationColor, COLOR, v, color_fallbacks)
            }
            Property::TextDecorationThickness(thickness) => {
                dest.push(Self::thickness(thickness.clone(), &targets));
            }
            Property::TextDecoration(v) => {
                let mut decoration = v.0.clone();
                let mut prefixes = v.1;
                let mut thickness = None;

                // Unlike lightningcss: a prefixed shorthand stays as it is. The thickness longhand has no prefixed name.
                if prefixes.contains(VendorPrefix::NONE) {
                    // Some browsers don't support thickness in the shorthand property yet.
                    if decoration.thickness != TextDecorationThickness::Auto
                        && !targets
                            .is_compatible(css::compat::Feature::TextDecorationThicknessShorthand)
                    {
                        thickness = Some(core::mem::replace(
                            &mut decoration.thickness,
                            TextDecorationThickness::Auto,
                        ));
                    }

                    // Only add prefixes if one of the new sub-properties was used
                    let new_sub_property = decoration.style != TextDecorationStyle::Solid
                        || decoration.color != CssColor::CurrentColor;
                    // Unlike lightningcss: a line alone gets the prefixes too when WebKit can have a style or a color from before it.
                    if new_sub_property || stale {
                        let first = new_sub_property && self.needs_fallbacks(Longhands::DECORATION);
                        prefixes = self.prefixes(
                            Longhands::DECORATION,
                            prefixes,
                            Feature::TextDecoration,
                            &targets,
                        );
                        if first {
                            for fallback in decoration.get_fallbacks(arena, &targets) {
                                dest.push(Property::TextDecoration((fallback, prefixes)));
                            }
                        }
                    }
                    self.stale = new_sub_property;
                }

                record(&mut self.written, Longhands::DECORATION, v.1);
                dest.push(Property::TextDecoration((decoration, prefixes)));
                if let Some(thickness) = thickness {
                    dest.push(Self::thickness(thickness, &targets));
                }
            }
            Property::TextEmphasisStyle(v) => longhand!(TextEmphasisStyle, EMPHASIS_STYLE, v),
            Property::TextEmphasisColor(v) => {
                with_fallbacks!(TextEmphasisColor, EMPHASIS_COLOR, v, color_fallbacks)
            }
            Property::TextEmphasis(v) => {
                with_fallbacks!(TextEmphasis, EMPHASIS, v, |emphasis: &mut TextEmphasis| {
                    emphasis.get_fallbacks(arena, &targets)
                })
            }
            Property::TextEmphasisPosition(v) => {
                let prefixes = self.take(
                    Longhands::EMPHASIS_POSITION,
                    v.1,
                    Feature::TextEmphasisPosition,
                    &targets,
                );
                let added = prefixes.difference(v.1);
                if v.0.horizontal == TextEmphasisPositionHorizontal::Right || added.is_empty() {
                    dest.push(Property::TextEmphasisPosition((v.0, prefixes)));
                } else {
                    // Unlike lightningcss: the prefixed name reads no horizontal keyword, so it gets the vertical one alone and keeps no earlier position.
                    let vertical = TextEmphasisPosition {
                        vertical: v.0.vertical,
                        horizontal: TextEmphasisPositionHorizontal::Right,
                    };
                    dest.push(Property::TextEmphasisPosition((vertical, added)));
                    dest.push(Property::TextEmphasisPosition((v.0, v.1)));
                }
            }
            Property::Unparsed(unparsed) => {
                let tag = unparsed.property_id.tag();
                let Some(longhands) = Longhands::of(tag) else {
                    return false;
                };
                let mut prefixes = unparsed.property_id.prefix().or_none();
                // Unlike lightningcss: an unparsed longhand gets the prefixes of its own feature, as its typed value does.
                if let Some(feature) = tag.prefix_feature() {
                    prefixes = self.take(longhands, prefixes, feature, &targets);
                }
                let mut unparsed =
                    unparsed.with_property_id(arena, unparsed.property_id.with_prefix(prefixes));
                context.add_unparsed_fallbacks(arena, &mut unparsed);
                dest.push(Property::Unparsed(unparsed));
            }
            _ => return false,
        }

        self.mark = Some(dest.len());
        true
    }

    /// Whether an unprefixed declaration gives WebKit a decoration style or color. There, the unprefixed shorthand is the line alone.
    fn styles(property: &Property) -> bool {
        let (styles, vp) = match property {
            Property::TextDecoration((decoration, vp)) => (
                decoration.style != TextDecorationStyle::Solid
                    || decoration.color != CssColor::CurrentColor,
                *vp,
            ),
            Property::TextDecorationStyle((_, vp)) | Property::TextDecorationColor((_, vp)) => {
                (true, *vp)
            }
            Property::Unparsed(unparsed) => (
                matches!(
                    unparsed.property_id.tag(),
                    PropertyIdTag::TextDecoration
                        | PropertyIdTag::TextDecorationStyle
                        | PropertyIdTag::TextDecorationColor
                ),
                unparsed.property_id.prefix().or_none(),
            ),
            _ => return false,
        };
        styles && vp.contains(VendorPrefix::NONE)
    }

    /// Reads the other list of the block (`!important` or not), when this list has its first declaration for the handler.
    fn see_other_list(&mut self, other: &css::DeclarationList, important: bool) {
        for declaration in other.iter() {
            let id = declaration.property_id();
            if let Some(longhands) = Longhands::of(id.tag()) {
                record(&mut self.elsewhere, longhands, id.prefix().or_none());
                // An `!important` line alone does not reset a style or a color of the normal list in WebKit.
                self.stale |= important && Self::styles(declaration);
            }
        }
    }

    pub(crate) fn finalize(
        &mut self,
        _dest: &mut css::DeclarationList,
        _context: &mut css::PropertyHandlerContext,
    ) {
        if self.mark.is_some() {
            *self = Self::default();
        }
    }

    /// Records a declaration and returns the prefixes to write it with.
    fn take(
        &mut self,
        longhands: Longhands,
        vp: VendorPrefix,
        feature: Feature,
        targets: &css::targets::Targets,
    ) -> VendorPrefix {
        let prefixes = self.prefixes(longhands, vp, feature, targets);
        record(&mut self.written, longhands, vp);
        prefixes
    }

    /// The prefixes to write a declaration with: its own ones, and the ones that the targets need.
    fn prefixes(
        &self,
        longhands: Longhands,
        vp: VendorPrefix,
        feature: Feature,
        targets: &css::targets::Targets,
    ) -> VendorPrefix {
        if !vp.contains(VendorPrefix::NONE) {
            return vp;
        }
        let mut covered = VendorPrefix::empty();
        for i in 0..Longhands::COUNT {
            if longhands.bits() & (1 << i) != 0 {
                covered.insert(self.written[i] | self.elsewhere[i]);
            }
        }
        // Unlike lightningcss: a written prefix stays, and a prefix that the author wrote for a longhand is not added.
        vp | targets
            .prefixes(VendorPrefix::NONE, feature)
            .difference(covered)
    }

    /// Unlike lightningcss: an earlier unprefixed value of every longhand is the fallback, as for `color` in `FallbackHandler`. So a second pass adds none.
    fn needs_fallbacks(&self, longhands: Longhands) -> bool {
        (0..Longhands::COUNT).any(|i| {
            longhands.bits() & (1 << i) != 0 && !self.written[i].contains(VendorPrefix::NONE)
        })
    }

    fn thickness(thickness: TextDecorationThickness, targets: &css::targets::Targets) -> Property {
        Property::TextDecorationThickness(match thickness {
            // A percentage is a part of 1em. Targets that do not read one get a calc().
            TextDecorationThickness::LengthPercentage(LengthPercentage::Percentage(p))
                if targets
                    .should_compile_same(css::compat::Feature::TextDecorationThicknessPercent) =>
            {
                let em = Calc::Value(Box::new(LengthPercentage::Dimension(Length::Em(1.0))));
                let calc = Calc::Function(Box::new(MathFunction::Calc(Calc::Product {
                    number: p.v,
                    expression: Box::new(em),
                })));
                TextDecorationThickness::LengthPercentage(LengthPercentage::Calc(Box::new(calc)))
            }
            thickness => thickness,
        })
    }
}
