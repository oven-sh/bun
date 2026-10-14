//! Which token gets which color.

use super::Token;
use bun_core::output::ColorDepth;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Color {
    Rgb(u8, u8, u8),
    /// One of the 16 colors that the terminal has a palette for: 0 to 15.
    Palette(u8),
}

impl Color {
    pub const fn hex(rgb: u32) -> Color {
        Color::Rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8)
    }
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct Font: u8 {
        const BOLD = 1 << 0;
        const ITALIC = 1 << 1;
        const UNDERLINE = 1 << 2;
        const STRIKETHROUGH = 1 << 3;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct Style {
    /// `None`: the color of plain text.
    pub color: Option<Color>,
    pub font: Font,
}

impl Style {
    const PLAIN: Style = Style {
        color: None,
        font: Font::empty(),
    };

    const fn hex(rgb: u32) -> Style {
        Style {
            color: Some(Color::hex(rgb)),
            font: Font::empty(),
        }
    }

    const fn palette(index: u8) -> Style {
        Style {
            color: Some(Color::Palette(index)),
            font: Font::empty(),
        }
    }

    const fn with(self, font: Font) -> Style {
        Style {
            color: self.color,
            font: self.font.union(font),
        }
    }
}

/// What a theme says about one token. What it leaves out comes from the token's parent.
#[derive(Copy, Clone, Default)]
pub struct PartialStyle {
    pub color: Option<Color>,
    /// The flags that are set either way.
    pub font_given: Font,
    pub font: Font,
}

/// The colors of a built-in theme, as 0xRRGGBB.
struct Palette {
    foreground: u32,
    background: u32,
    comment: u32,
    /// Punctuation and operators.
    muted: u32,
    /// Also tags.
    keyword: u32,
    string: u32,
    /// Also regular expressions and built-in types.
    escape: u32,
    /// Also constants.
    number: u32,
    function: u32,
    ty: u32,
    property: u32,
    parameter: u32,
    this: u32,
    /// Also decorators and labels.
    attribute: u32,
}

#[derive(Clone)]
pub struct Theme {
    pub foreground: Option<Color>,
    pub background: Option<Color>,
    styles: [Style; Token::COUNT],
}

impl Theme {
    #[inline]
    pub fn style(&self, token: Token) -> Style {
        self.styles[token as usize]
    }

    /// `given`: by token.
    pub fn new(
        foreground: Option<Color>,
        background: Option<Color>,
        given: &[PartialStyle; Token::COUNT],
    ) -> Theme {
        let mut styles = [Style::PLAIN; Token::COUNT];
        // A parent comes before its children.
        for &token in Token::ALL {
            let inherited = token.parent().map_or(Style::PLAIN, |it| styles[it as usize]);
            let own = given[token as usize];
            styles[token as usize] = Style {
                color: own.color.or(inherited.color),
                font: (inherited.font - own.font_given) | (own.font & own.font_given),
            };
        }
        Theme {
            foreground,
            background,
            styles,
        }
    }

    /// The theme for a terminal with a light or a dark background.
    pub fn built_in(is_light: bool, depth: ColorDepth) -> &'static Theme {
        match is_light {
            // The 16 colors are the terminal's own, which suit its background.
            _ if depth == ColorDepth::C16 => &Theme::TERMINAL,
            true => &Theme::LIGHT,
            false => &Theme::DARK,
        }
    }

    const fn from_table(
        foreground: Option<Color>,
        background: Option<Color>,
        own: &[(Token, Style)],
    ) -> Theme {
        let mut is_given = [false; Token::COUNT];
        let mut styles = [Style::PLAIN; Token::COUNT];
        let mut index = 0;
        while index < own.len() {
            styles[own[index].0 as usize] = own[index].1;
            is_given[own[index].0 as usize] = true;
            index += 1;
        }
        index = 0;
        while index < Token::COUNT {
            if !is_given[index]
                && let Some(parent) = Token::ALL[index].parent()
            {
                styles[index] = styles[parent as usize];
            }
            index += 1;
        }
        Theme {
            foreground,
            background,
            styles,
        }
    }

    const fn from_palette(colors: Palette) -> Theme {
        use Token::*;
        let muted = Style::hex(colors.muted);
        let keyword = Style::hex(colors.keyword);
        let string = Style::hex(colors.string);
        let escape = Style::hex(colors.escape);
        let number = Style::hex(colors.number);
        let function = Style::hex(colors.function);
        let ty = Style::hex(colors.ty);
        let attribute = Style::hex(colors.attribute);
        Theme::from_table(
            Some(Color::hex(colors.foreground)),
            Some(Color::hex(colors.background)),
            &[
                (Comment, Style::hex(colors.comment).with(Font::ITALIC)),
                (String, string),
                (StringEscape, escape),
                (StringRegexp, escape),
                (StringSpecial, escape),
                (Number, number),
                (NumberUnit, keyword),
                (Boolean, number),
                (Constant, number),
                (Keyword, keyword),
                (Operator, muted),
                (Punctuation, muted),
                (PunctuationSpecial, keyword),
                (VariableParameter, Style::hex(colors.parameter)),
                (VariableBuiltin, Style::hex(colors.this).with(Font::ITALIC)),
                (Property, Style::hex(colors.property)),
                (Function, function),
                (Type, ty),
                (TypeBuiltin, escape),
                (Namespace, ty),
                (Label, attribute),
                (Decorator, attribute),
                (Tag, keyword),
                (TagComponent, ty),
                (TagDelimiter, muted),
                (Attribute, attribute),
                (Selector, keyword),
                (SelectorClass, ty),
                (SelectorId, function),
                (SelectorPseudo, escape),
                (MarkupHeading, function.with(Font::BOLD)),
                (MarkupBold, Style::PLAIN.with(Font::BOLD)),
                (MarkupItalic, Style::PLAIN.with(Font::ITALIC)),
                (MarkupStrikethrough, muted.with(Font::STRIKETHROUGH)),
                (MarkupLink, function),
                (MarkupLinkUrl, muted.with(Font::UNDERLINE)),
                (MarkupRaw, string),
                (MarkupQuote, muted.with(Font::ITALIC)),
                (MarkupList, keyword),
            ],
        )
    }

    pub const DARK: Theme = Theme::from_palette(Palette {
        foreground: 0xe4e6eb,
        background: 0x0f1115,
        comment: 0x6b7385,
        muted: 0x8b93a7,
        keyword: 0xf47ab8,
        string: 0xa6dc8f,
        escape: 0x5fd7c7,
        number: 0xf7a86d,
        function: 0x7ab8ff,
        ty: 0xffd479,
        property: 0xb4befe,
        parameter: 0xf0b6a0,
        this: 0xff8a8a,
        attribute: 0xc8a6ff,
    });

    pub const LIGHT: Theme = Theme::from_palette(Palette {
        foreground: 0x1f2328,
        background: 0xffffff,
        comment: 0x7b8494,
        muted: 0x6a7280,
        keyword: 0xc2287e,
        string: 0x2b7a2f,
        escape: 0x0b7c78,
        number: 0xb3540a,
        function: 0x1c5fd0,
        ty: 0x8f6400,
        property: 0x4a55b8,
        parameter: 0xa8472a,
        this: 0xc4302b,
        attribute: 0x7a3fd0,
    });

    /// For a terminal with 16 colors, which are whatever its own theme says, on a dark background or a light one.
    pub const TERMINAL: Theme = {
        use Token::*;
        const RED: Style = Style::palette(1);
        const GREEN: Style = Style::palette(2);
        const YELLOW: Style = Style::palette(3);
        const BLUE: Style = Style::palette(4);
        const MAGENTA: Style = Style::palette(5);
        const CYAN: Style = Style::palette(6);
        const GRAY: Style = Style::palette(8);
        Theme::from_table(
            None,
            None,
            &[
                (Comment, GRAY),
                (String, GREEN),
                (StringEscape, CYAN),
                (StringRegexp, CYAN),
                (StringSpecial, CYAN),
                (Number, YELLOW),
                (Boolean, YELLOW),
                (Constant, YELLOW),
                (Keyword, MAGENTA),
                (PunctuationSpecial, MAGENTA),
                (VariableBuiltin, RED),
                (Function, BLUE),
                (Type, CYAN),
                (Namespace, CYAN),
                (Label, MAGENTA),
                (Decorator, MAGENTA),
                (Tag, RED),
                (TagComponent, CYAN),
                (TagDelimiter, GRAY),
                (Attribute, YELLOW),
                (Selector, MAGENTA),
                (SelectorClass, YELLOW),
                (SelectorId, BLUE),
                (SelectorPseudo, CYAN),
                (MarkupHeading, BLUE.with(Font::BOLD)),
                (MarkupBold, Style::PLAIN.with(Font::BOLD)),
                (MarkupItalic, Style::PLAIN.with(Font::ITALIC)),
                (MarkupStrikethrough, Style::PLAIN.with(Font::STRIKETHROUGH)),
                (MarkupLink, BLUE),
                (MarkupLinkUrl, GRAY.with(Font::UNDERLINE)),
                (MarkupRaw, GREEN),
                (MarkupQuote, GRAY),
                (MarkupList, MAGENTA),
            ],
        )
    };
}
