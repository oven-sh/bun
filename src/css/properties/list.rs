//! CSS properties related to lists and counters.

use crate as css;
use crate::css_values::ident::CustomIdent;
use crate::css_values::image::Image;
use crate::{CSSString, CSSStringFns, Parser, PrintErr, Printer};
use bun_core::strings;

/// Compares two arena strings by content.
fn string_eql(a: CSSString, b: CSSString) -> bool {
    // SAFETY: both point into the parser arena, which outlives the AST.
    unsafe { strings::eql(crate::arena_str(a), crate::arena_str(b)) }
}

/// A value for the [list-style-type](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#text-markers) property.
pub enum ListStyleType {
    /// No marker.
    None,
    /// An explicit marker string.
    String(CSSString),
    /// A named counter style.
    CounterStyle(CounterStyle),
}

impl ListStyleType {
    /// `disc`, the initial value.
    const DISC: Self =
        ListStyleType::CounterStyle(CounterStyle::Predefined(PredefinedCounterStyle::Disc));

    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(ListStyleType::None);
        }
        if let Ok(s) = input.try_parse(|i| i.expect_string().map(std::ptr::from_ref::<[u8]>)) {
            return Ok(ListStyleType::String(s));
        }
        CounterStyle::parse(input).map(ListStyleType::CounterStyle)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            ListStyleType::None => dest.write_str("none"),
            ListStyleType::String(s) => CSSStringFns::to_css(s, dest),
            ListStyleType::CounterStyle(style) => style.to_css(dest),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (ListStyleType::None, ListStyleType::None) => true,
            (ListStyleType::String(a), ListStyleType::String(b)) => string_eql(*a, *b),
            (ListStyleType::CounterStyle(a), ListStyleType::CounterStyle(b)) => {
                css::generic::eql(a, b)
            }
            _ => false,
        }
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        match self {
            ListStyleType::None => ListStyleType::None,
            ListStyleType::String(s) => ListStyleType::String(*s),
            ListStyleType::CounterStyle(style) => {
                ListStyleType::CounterStyle(css::generic::deep_clone(style, bump))
            }
        }
    }

    fn is_disc(&self) -> bool {
        matches!(
            self,
            ListStyleType::CounterStyle(CounterStyle::Predefined(PredefinedCounterStyle::Disc))
        )
    }

    /// Whether this is a counter style that has the name of a `list-style-position` keyword.
    fn is_named_like_position(&self) -> bool {
        match self {
            ListStyleType::CounterStyle(CounterStyle::Name(name)) => {
                <ListStylePosition as css::EnumProperty>::from_ascii_case_insensitive(name.v())
                    .is_some()
            }
            _ => false,
        }
    }
}

/// A [counter-style](https://www.w3.org/TR/css-counter-styles-3/#typedef-counter-style) name.
#[derive(css::CssEql, css::DeepClone)]
pub enum CounterStyle {
    /// A predefined counter style name.
    Predefined(PredefinedCounterStyle),
    /// A custom counter style name.
    Name(CustomIdent),
    /// An inline [`symbols()`](https://www.w3.org/TR/css-counter-styles-3/#symbols-function) definition.
    Symbols {
        /// The counter system.
        system: SymbolsType,
        /// The symbols.
        symbols: Vec<Symbol>,
    },
}

impl CounterStyle {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if let Ok(predefined) = input.try_parse(PredefinedCounterStyle::parse) {
            return Ok(CounterStyle::Predefined(predefined));
        }

        if input
            .try_parse(|i| i.expect_function_matching(b"symbols"))
            .is_ok()
        {
            return input.parse_nested_block(|i| {
                let system = i
                    .try_parse(SymbolsType::parse)
                    .unwrap_or(SymbolsType::Symbolic);
                let mut symbols = Vec::new();
                while let Ok(symbol) = i.try_parse(Symbol::parse) {
                    symbols.push(symbol);
                }
                Ok(CounterStyle::Symbols { system, symbols })
            });
        }

        CustomIdent::parse(input).map(CounterStyle::Name)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            CounterStyle::Predefined(style) => style.to_css(dest),
            CounterStyle::Name(name) => name.to_css(dest),
            CounterStyle::Symbols { system, symbols } => {
                dest.write_str("symbols(")?;
                let mut needs_space = false;
                if *system != SymbolsType::Symbolic {
                    system.to_css(dest)?;
                    needs_space = true;
                }
                for symbol in symbols {
                    if needs_space {
                        dest.write_char(b' ')?;
                    }
                    symbol.to_css(dest)?;
                    needs_space = true;
                }
                dest.write_char(b')')
            }
        }
    }
}

/// A [predefined counter](https://www.w3.org/TR/css-counter-styles-3/#predefined-counters) style.
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum PredefinedCounterStyle {
    // https://www.w3.org/TR/css-counter-styles-3/#simple-numeric
    Decimal,
    DecimalLeadingZero,
    ArabicIndic,
    Armenian,
    UpperArmenian,
    LowerArmenian,
    Bengali,
    Cambodian,
    Khmer,
    CjkDecimal,
    Devanagari,
    Georgian,
    Gujarati,
    Gurmukhi,
    Hebrew,
    Kannada,
    Lao,
    Malayalam,
    Mongolian,
    Myanmar,
    Oriya,
    Persian,
    LowerRoman,
    UpperRoman,
    Tamil,
    Telugu,
    Thai,
    Tibetan,

    // https://www.w3.org/TR/css-counter-styles-3/#simple-alphabetic
    LowerAlpha,
    LowerLatin,
    UpperAlpha,
    UpperLatin,
    LowerGreek,
    Hiragana,
    HiraganaIroha,
    Katakana,
    KatakanaIroha,

    // https://www.w3.org/TR/css-counter-styles-3/#simple-symbolic
    Disc,
    Circle,
    Square,
    DisclosureOpen,
    DisclosureClosed,

    // https://www.w3.org/TR/css-counter-styles-3/#simple-fixed
    CjkEarthlyBranch,
    CjkHeavenlyStem,

    // https://www.w3.org/TR/css-counter-styles-3/#complex-cjk
    JapaneseInformal,
    JapaneseFormal,
    KoreanHangulFormal,
    KoreanHanjaInformal,
    KoreanHanjaFormal,
    SimpChineseInformal,
    SimpChineseFormal,
    TradChineseInformal,
    TradChineseFormal,
    // The CSS 2 name of `trad-chinese-informal`. Lightning CSS does not list it.
    CjkIdeographic,
    EthiopicNumeric,
}

/// A [`<symbols-type>`](https://www.w3.org/TR/css-counter-styles-3/#typedef-symbols-type) value,
/// as used in the `symbols()` function.
///
/// See [CounterStyle](CounterStyle).
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum SymbolsType {
    Cyclic,
    Numeric,
    Alphabetic,
    Symbolic,
    Fixed,
}

/// A single [symbol](https://www.w3.org/TR/css-counter-styles-3/#funcdef-symbols) as used in the
/// `symbols()` function.
///
/// See [CounterStyle](CounterStyle).
pub enum Symbol {
    /// A string.
    String(CSSString),
    /// An image.
    Image(Image),
}

impl Symbol {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        if let Ok(s) = input.try_parse(|i| i.expect_string().map(std::ptr::from_ref::<[u8]>)) {
            return Ok(Symbol::String(s));
        }
        Image::parse(input).map(Symbol::Image)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Symbol::String(s) => CSSStringFns::to_css(s, dest),
            Symbol::Image(image) => image.to_css(dest),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (Symbol::String(a), Symbol::String(b)) => string_eql(*a, *b),
            (Symbol::Image(a), Symbol::Image(b)) => a.eql(b),
            _ => false,
        }
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        match self {
            Symbol::String(s) => Symbol::String(*s),
            Symbol::Image(image) => Symbol::Image(image.deep_clone(bump)),
        }
    }
}

/// A value for the [list-style-position](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-position-property) property.
#[derive(Clone, Copy, PartialEq, Eq, css::DefineEnumProperty)]
pub enum ListStylePosition {
    /// The list marker is placed inside the element.
    Inside,
    /// The list marker is placed outside the element.
    Outside,
}

/// A value for the [list-style](https://www.w3.org/TR/2020/WD-css-lists-3-20201117/#list-style-property) shorthand property.
#[derive(css::CssEql, css::DeepClone)]
pub struct ListStyle {
    /// The position of the list marker.
    pub(crate) position: ListStylePosition,
    /// The list marker image.
    pub(crate) image: Image,
    /// The list style type.
    pub(crate) list_style_type: ListStyleType,
}

impl ListStyle {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let mut position: Option<ListStylePosition> = None;
        let mut image: Option<Image> = None;
        let mut list_style_type: Option<ListStyleType> = None;
        let mut nones: u8 = 0;

        loop {
            // `none` is ambiguous - both list-style-image and list-style-type support it.
            if input
                .try_parse(|i| i.expect_ident_matching(b"none"))
                .is_ok()
            {
                nones += 1;
                if nones > 2 {
                    return Err(input.new_custom_error(css::ParserError::invalid_value));
                }
                continue;
            }

            if image.is_none() {
                if let Ok(value) = input.try_parse(Image::parse) {
                    image = Some(value);
                    continue;
                }
            }

            if position.is_none() {
                if let Ok(value) = input.try_parse(ListStylePosition::parse) {
                    position = Some(value);
                    continue;
                }
            }

            if list_style_type.is_none() {
                if let Ok(value) = input.try_parse(ListStyleType::parse) {
                    list_style_type = Some(value);
                    continue;
                }
            }

            break;
        }

        // An empty value is not a `list-style` of initial values.
        if nones == 0 && position.is_none() && image.is_none() && list_style_type.is_none() {
            return Err(input.new_custom_error(css::ParserError::invalid_value));
        }

        // Assign the `none` to the opposite property from the one we have a value for,
        // or both in case neither list-style-image or list-style-type have a value.
        let position = position.unwrap_or(ListStylePosition::Outside);
        match (nones, image, list_style_type) {
            (2, None, None) | (1, None, None) => Ok(ListStyle {
                position,
                image: Image::None,
                list_style_type: ListStyleType::None,
            }),
            (1, Some(image), None) => Ok(ListStyle {
                position,
                image,
                list_style_type: ListStyleType::None,
            }),
            (1, None, Some(list_style_type)) => Ok(ListStyle {
                position,
                image: Image::None,
                list_style_type,
            }),
            (0, image, list_style_type) => Ok(ListStyle {
                position,
                image: image.unwrap_or(Image::None),
                list_style_type: list_style_type.unwrap_or(ListStyleType::DISC),
            }),
            _ => Err(input.new_custom_error(css::ParserError::invalid_value)),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut needs_space = false;
        // A counter style named `inside` or `outside` reads as the position when nothing is before it.
        if self.position != ListStylePosition::Outside
            || self.list_style_type.is_named_like_position()
        {
            self.position.to_css(dest)?;
            needs_space = true;
        }

        if !matches!(self.image, Image::None) {
            if needs_space {
                dest.write_char(b' ')?;
            }
            self.image.to_css(dest)?;
            needs_space = true;
        }

        if !self.list_style_type.is_disc() {
            if needs_space {
                dest.write_char(b' ')?;
            }
            self.list_style_type.to_css(dest)?;
            needs_space = true;
        }

        if !needs_space {
            self.position.to_css(dest)?;
        }

        Ok(())
    }
}
