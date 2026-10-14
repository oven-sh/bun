//! Which token gets which color.

use super::Token;

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

    const fn built_in(
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

    pub const DARK: Theme = {
        use Token::*;
        const MUTED: Style = Style::hex(0x8b93a7);
        const PINK: Style = Style::hex(0xf47ab8);
        const GREEN: Style = Style::hex(0xa6dc8f);
        const TEAL: Style = Style::hex(0x5fd7c7);
        const ORANGE: Style = Style::hex(0xf7a86d);
        const YELLOW: Style = Style::hex(0xffd479);
        const BLUE: Style = Style::hex(0x7ab8ff);
        const LAVENDER: Style = Style::hex(0xb4befe);
        const PEACH: Style = Style::hex(0xf0b6a0);
        const RED: Style = Style::hex(0xff8a8a);
        const PURPLE: Style = Style::hex(0xc8a6ff);
        Theme::built_in(
            Some(Color::hex(0xe4e6eb)),
            Some(Color::hex(0x0f1115)),
            &[
                (Comment, Style::hex(0x6b7385).with(Font::ITALIC)),
                (String, GREEN),
                (StringEscape, TEAL),
                (StringRegexp, TEAL),
                (StringSpecial, TEAL),
                (Number, ORANGE),
                (NumberUnit, PINK),
                (Boolean, ORANGE),
                (Constant, ORANGE),
                (Keyword, PINK),
                (Operator, MUTED),
                (Punctuation, MUTED),
                (PunctuationSpecial, PINK),
                (VariableParameter, PEACH),
                (VariableBuiltin, RED.with(Font::ITALIC)),
                (Property, LAVENDER),
                (Function, BLUE),
                (Type, YELLOW),
                (TypeBuiltin, TEAL),
                (Namespace, YELLOW),
                (Label, PURPLE),
                (Decorator, PURPLE),
                (Tag, PINK),
                (TagComponent, YELLOW),
                (TagDelimiter, MUTED),
                (Attribute, PURPLE),
                (Selector, PINK),
                (SelectorClass, YELLOW),
                (SelectorId, BLUE),
                (SelectorPseudo, TEAL),
                (MarkupHeading, BLUE.with(Font::BOLD)),
                (MarkupBold, Style::PLAIN.with(Font::BOLD)),
                (MarkupItalic, Style::PLAIN.with(Font::ITALIC)),
                (MarkupStrikethrough, MUTED.with(Font::STRIKETHROUGH)),
                (MarkupLink, BLUE),
                (MarkupLinkUrl, MUTED.with(Font::UNDERLINE)),
                (MarkupRaw, GREEN),
                (MarkupQuote, MUTED.with(Font::ITALIC)),
                (MarkupList, PINK),
            ],
        )
    };

    pub const LIGHT: Theme = {
        use Token::*;
        const MUTED: Style = Style::hex(0x6a7280);
        const PINK: Style = Style::hex(0xc2287e);
        const GREEN: Style = Style::hex(0x2b7a2f);
        const TEAL: Style = Style::hex(0x0b7c78);
        const ORANGE: Style = Style::hex(0xb3540a);
        const YELLOW: Style = Style::hex(0x8f6400);
        const BLUE: Style = Style::hex(0x1c5fd0);
        const LAVENDER: Style = Style::hex(0x4a55b8);
        const PEACH: Style = Style::hex(0xa8472a);
        const RED: Style = Style::hex(0xc4302b);
        const PURPLE: Style = Style::hex(0x7a3fd0);
        Theme::built_in(
            Some(Color::hex(0x1f2328)),
            Some(Color::hex(0xffffff)),
            &[
                (Comment, Style::hex(0x7b8494).with(Font::ITALIC)),
                (String, GREEN),
                (StringEscape, TEAL),
                (StringRegexp, TEAL),
                (StringSpecial, TEAL),
                (Number, ORANGE),
                (NumberUnit, PINK),
                (Boolean, ORANGE),
                (Constant, ORANGE),
                (Keyword, PINK),
                (Operator, MUTED),
                (Punctuation, MUTED),
                (PunctuationSpecial, PINK),
                (VariableParameter, PEACH),
                (VariableBuiltin, RED.with(Font::ITALIC)),
                (Property, LAVENDER),
                (Function, BLUE),
                (Type, YELLOW),
                (TypeBuiltin, TEAL),
                (Namespace, YELLOW),
                (Label, PURPLE),
                (Decorator, PURPLE),
                (Tag, PINK),
                (TagComponent, YELLOW),
                (TagDelimiter, MUTED),
                (Attribute, PURPLE),
                (Selector, PINK),
                (SelectorClass, YELLOW),
                (SelectorId, BLUE),
                (SelectorPseudo, TEAL),
                (MarkupHeading, BLUE.with(Font::BOLD)),
                (MarkupBold, Style::PLAIN.with(Font::BOLD)),
                (MarkupItalic, Style::PLAIN.with(Font::ITALIC)),
                (MarkupStrikethrough, MUTED.with(Font::STRIKETHROUGH)),
                (MarkupLink, BLUE),
                (MarkupLinkUrl, MUTED.with(Font::UNDERLINE)),
                (MarkupRaw, GREEN),
                (MarkupQuote, MUTED.with(Font::ITALIC)),
                (MarkupList, PINK),
            ],
        )
    };

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
        Theme::built_in(
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
