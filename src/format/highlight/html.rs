//! Turns spans into HTML, and a theme into the CSS for that HTML.

use super::{Color, Font, Span, Style, Theme, Token};
use crate::text::ByteSet;
use bun_core::strings::{self, html_escape_entity};
use std::io::Write as _;
use std::sync::OnceLock;

/// Appends the class for `token`: `hl-keyword-control` for `keyword.control`.
fn write_class(out: &mut Vec<u8>, token: Token) {
    out.extend_from_slice(b"hl-");
    let start = out.len();
    out.extend_from_slice(token.name().as_bytes());
    for byte in &mut out[start..] {
        if *byte == b'.' {
            *byte = b'-';
        }
    }
}

/// Appends the classes of `token`'s parents and then its own: `hl-keyword hl-keyword-control`.
fn write_classes(out: &mut Vec<u8>, token: Token) {
    if let Some(parent) = token.parent() {
        write_classes(out, parent);
        out.push(b' ');
    }
    write_class(out, token);
}

/// The `<span class="..">` of every token, back to back in one buffer.
struct OpenTags {
    bytes: Vec<u8>,
    ends: [u16; Token::COUNT],
}

impl OpenTags {
    fn get() -> &'static OpenTags {
        static TAGS: OnceLock<OpenTags> = OnceLock::new();
        TAGS.get_or_init(OpenTags::new)
    }

    fn new() -> OpenTags {
        let mut tags = OpenTags {
            bytes: Vec::with_capacity(Token::COUNT * 64),
            ends: [0; Token::COUNT],
        };
        for &token in Token::ALL {
            tags.bytes.extend_from_slice(b"<span class=\"");
            write_classes(&mut tags.bytes, token);
            tags.bytes.extend_from_slice(b"\">");
            tags.ends[token as usize] = tags.bytes.len() as u16;
        }
        tags
    }

    #[inline]
    fn of(&self, token: Token) -> &[u8] {
        let index = token as usize;
        let start = match index.checked_sub(1) {
            Some(before) => self.ends[before],
            None => 0,
        };
        &self.bytes[start as usize..self.ends[index] as usize]
    }
}

const CLOSE: &[u8] = b"</span>";

/// Finds the next byte to stop at. Most tokens are a few bytes long, and there a plain loop beats the SIMD search.
#[inline]
fn find(text: &[u8], from: usize, few: &ByteSet, many: &[u8]) -> Option<usize> {
    if text.len() - from < 32 {
        return few.find(text, from);
    }
    strings::index_of_any(&text[from..], many).map(|at| from + at)
}

/// Appends `text` with `&`, `<` and `>` escaped.
#[inline]
fn write_text(out: &mut Vec<u8>, text: &[u8]) {
    const STOPS: ByteSet = ByteSet::new(b"&<>");
    let mut from = 0;
    while let Some(at) = find(text, from, &STOPS, b"&<>") {
        out.extend_from_slice(&text[from..at]);
        out.extend_from_slice(html_escape_entity(text[at]).unwrap_or_default());
        from = at + 1;
    }
    out.extend_from_slice(&text[from..]);
}

/// Appends `text` wrapped in `open` and `</span>`. Each non-empty line gets its own element.
#[inline]
fn write_span(out: &mut Vec<u8>, text: &[u8], open: &[u8]) {
    const STOPS: ByteSet = ByteSet::new(b"&<>\n");
    let (mut from, mut is_open) = (0, false);
    loop {
        let stop = find(text, from, &STOPS, b"&<>\n");
        let end = stop.unwrap_or(text.len());
        let is_line_break = stop.is_some_and(|at| text[at] == b'\n');
        if !is_open && (end > from || stop.is_some() && !is_line_break) {
            out.extend_from_slice(open);
            is_open = true;
        }
        out.extend_from_slice(&text[from..end]);
        if is_open && (is_line_break || stop.is_none()) {
            out.extend_from_slice(CLOSE);
            is_open = false;
        }
        let Some(at) = stop else { return };
        out.extend_from_slice(html_escape_entity(text[at]).unwrap_or(b"\n"));
        from = at + 1;
    }
}

/// Appends `code` as HTML, with a `<span>` for each span. No element crosses a line break, so callers can split the
/// result on `\n`.
pub fn write_html(code: &[u8], spans: &[Span], out: &mut Vec<u8>) {
    let tags = OpenTags::get();
    out.reserve(code.len() + spans.len() * 40);
    let mut at = 0;
    for span in spans {
        let (start, end) = (span.start as usize, span.end as usize);
        let (Some(before), Some(text)) = (code.get(at..start), code.get(start..end)) else {
            continue;
        };
        write_text(out, before);
        write_span(out, text, tags.of(span.token));
        at = end;
    }
    write_text(out, code.get(at..).unwrap_or_default());
}

fn write_color(out: &mut Vec<u8>, property: &str, color: Option<Color>) {
    if let Some(Color::Rgb(r, g, b)) = color {
        let _ = write!(out, "{property}:#{r:02x}{g:02x}{b:02x};");
    }
}

fn write_declarations(out: &mut Vec<u8>, style: Style, inherited: Style) {
    if style.color != inherited.color {
        write_color(out, "color", style.color);
    }
    let changed = style.font ^ inherited.font;
    let value = |flag, on: &'static str, off: &'static str| match style.font.contains(flag) {
        true => on,
        false => off,
    };
    if changed.contains(Font::BOLD) {
        let _ = write!(out, "font-weight:{};", value(Font::BOLD, "bold", "normal"));
    }
    if changed.contains(Font::ITALIC) {
        let _ = write!(out, "font-style:{};", value(Font::ITALIC, "italic", "normal"));
    }
    if changed.intersects(Font::UNDERLINE | Font::STRIKETHROUGH) {
        let lines = match (
            style.font.contains(Font::UNDERLINE),
            style.font.contains(Font::STRIKETHROUGH),
        ) {
            (true, true) => "underline line-through",
            (true, false) => "underline",
            (false, true) => "line-through",
            (false, false) => "none",
        };
        let _ = write!(out, "text-decoration:{lines};");
    }
}

/// Appends the style sheet that colors [`write_html`]'s output with `theme`. `.hl` is for the element around the code.
pub fn write_css(theme: &Theme, out: &mut Vec<u8>) {
    out.extend_from_slice(b".hl{");
    write_color(out, "color", theme.foreground);
    write_color(out, "background", theme.background);
    out.extend_from_slice(b"}\n");
    for &token in Token::ALL {
        let inherited = token.parent().map(|it| theme.style(it)).unwrap_or_default();
        let style = theme.style(token);
        if style == inherited {
            continue;
        }
        out.push(b'.');
        write_class(out, token);
        out.push(b'{');
        write_declarations(out, style, inherited);
        out.extend_from_slice(b"}\n");
    }
}
