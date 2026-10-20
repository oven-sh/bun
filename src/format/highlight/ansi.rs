//! Turns spans into text with ANSI escape sequences.

use super::{Color, Font, Span, Style, Theme, Token};
use bun_core::ansi256;
use bun_core::output::ColorDepth;
use bun_core::strings;
use std::io::Write as _;

/// The parameters of the escape sequence that sets a foreground color: `38;2;255;0;0`.
#[derive(Copy, Clone, Default)]
struct Foreground {
    bytes: [u8; 16],
    len: u8,
}

impl Foreground {
    fn new(color: Color, depth: ColorDepth) -> Foreground {
        let mut it = Foreground::default();
        let mut rest = &mut it.bytes[..];
        let palette = |index: u8| match index {
            0..8 => 30 + index,
            _ => 90 + (index & 7),
        };
        let _ = match (color, depth) {
            (Color::Palette(index), _) => write!(rest, "{}", palette(index)),
            (Color::Rgb(r, g, b), ColorDepth::C16m) => write!(rest, "38;2;{r};{g};{b}"),
            (Color::Rgb(r, g, b), ColorDepth::C256) => {
                write!(rest, "38;5;{}", ansi256::get(r.into(), g.into(), b.into()))
            }
            (Color::Rgb(r, g, b), ColorDepth::C16 | ColorDepth::None) => {
                let index = ansi256::get16(r.into(), g.into(), b.into());
                write!(rest, "{}", palette(index))
            }
        };
        it.len = (16 - rest.len()) as u8;
        it
    }

    #[inline]
    fn bytes(&self) -> &[u8] {
        &self.bytes[..self.len as usize]
    }
}

struct Writer<'o> {
    out: &'o mut Vec<u8>,
    current: Style,
}

impl Writer<'_> {
    /// Switches to `style`. `foreground` holds the parameters for its color.
    #[inline]
    fn switch_to(&mut self, style: Style, foreground: &[u8]) {
        if style != self.current {
            self.write_switch(style, foreground);
        }
    }

    fn write_switch(&mut self, style: Style, foreground: &[u8]) {
        const FONTS: [(Font, &[u8], &[u8]); 4] = [
            (Font::BOLD, b"1", b"22"),
            (Font::ITALIC, b"3", b"23"),
            (Font::UNDERLINE, b"4", b"24"),
            (Font::STRIKETHROUGH, b"9", b"29"),
        ];
        let out = &mut *self.out;
        out.extend_from_slice(b"\x1b[");
        let start = out.len();
        if style.color != self.current.color {
            out.extend_from_slice(match style.color {
                Some(_) => foreground,
                None => b"39",
            });
        }
        let changed = style.font ^ self.current.font;
        for (font, on, off) in FONTS {
            if changed.contains(font) {
                if out.len() > start {
                    out.push(b';');
                }
                out.extend_from_slice(if style.font.contains(font) { on } else { off });
            }
        }
        out.push(b'm');
        self.current = style;
    }

    #[inline]
    fn reset(&mut self) {
        self.switch_to(Style::default(), b"");
    }
}

/// A theme prepared for a terminal: the escape sequence parameters for each token's color are already formatted.
pub struct AnsiStyles {
    depth: ColorDepth,
    styles: [(Style, Foreground); Token::COUNT],
}

impl AnsiStyles {
    pub fn new(theme: &Theme, depth: ColorDepth) -> AnsiStyles {
        AnsiStyles {
            depth,
            styles: std::array::from_fn(|index| {
                let style = theme.style(Token::ALL[index]);
                let foreground = style.color.map(|it| Foreground::new(it, depth));
                (style, foreground.unwrap_or_default())
            }),
        }
    }

    /// Without colors [`write_ansi`] copies the code, whatever its spans are.
    pub fn has_colors(&self) -> bool {
        self.depth != ColorDepth::None
    }
}

/// Appends `code`, colored with `theme`. Every line resets the styles it sets, so callers can split the result on `\n`.
pub fn write_ansi(code: &[u8], spans: &[Span], theme: &AnsiStyles, out: &mut Vec<u8>) {
    if !theme.has_colors() {
        out.extend_from_slice(code);
        return;
    }
    out.reserve(code.len() + spans.len() * 12);
    let mut writer = Writer {
        out,
        current: Style::default(),
    };
    let mut at = 0;
    for span in spans {
        let (start, end) = (span.start as usize, span.end as usize);
        let (Some(before), Some(mut text)) = (code.get(at..start), code.get(start..end)) else {
            continue;
        };
        at = end;
        let (style, foreground) = &theme.styles[span.token as usize];
        let (style, foreground) = (*style, foreground.bytes());
        // A color is invisible on blanks, so leave it on if the next token sets another one anyway.
        let stays_on = style != Style::default()
            && !(writer.current.font).intersects(Font::UNDERLINE | Font::STRIKETHROUGH)
            && before.iter().all(|&byte| byte == b' ' || byte == b'\t');
        if !stays_on {
            writer.reset();
        }
        writer.out.extend_from_slice(before);
        while let Some(line_end) = strings::index_of_char_usize(text, b'\n') {
            if line_end > 0 {
                writer.switch_to(style, foreground);
                writer.out.extend_from_slice(&text[..line_end]);
            }
            writer.reset();
            writer.out.push(b'\n');
            text = &text[line_end + 1..];
        }
        if !text.is_empty() {
            writer.switch_to(style, foreground);
            writer.out.extend_from_slice(text);
        }
    }
    writer.reset();
    writer
        .out
        .extend_from_slice(code.get(at..).unwrap_or_default());
}
