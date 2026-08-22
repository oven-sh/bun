//! CSS-ish colour strings to `NSColor`.

use crate::Named;
use crate::error::{Error, Result};
use crate::named_enum;
use crate::objc::appkit::NSColor;

/// A colour as JavaScript gives it to us.
#[derive(Clone, Debug, PartialEq)]
pub enum Color {
    Rgba { r: f32, g: f32, b: f32, a: f32 },
    System(SystemColor),
}

named_enum! {
    /// Dynamic system colours, by their JavaScript names.
    pub enum SystemColor {
        Label = "label",
        SecondaryLabel = "secondaryLabel",
        TertiaryLabel = "tertiaryLabel",
        QuaternaryLabel = "quaternaryLabel",
        Text = "text",
        Placeholder = "placeholder",
        Link = "link",
        Separator = "separator",
        Accent = "accent",
        Control = "control",
        ControlText = "controlText",
        ControlBackground = "controlBackground",
        WindowBackground = "windowBackground",
        UnderPageBackground = "underPageBackground",
        TextBackground = "textBackground",
        SelectedContentBackground = "selectedContentBackground",
        Clear = "clear",
        Black = "black",
        White = "white",
        Gray = "gray",
        Red = "red",
        Orange = "orange",
        Yellow = "yellow",
        Green = "green",
        Mint = "mint",
        Teal = "teal",
        Cyan = "cyan",
        Blue = "blue",
        Indigo = "indigo",
        Purple = "purple",
        Pink = "pink",
        Brown = "brown",
    }
}

impl SystemColor {
    pub(crate) fn nscolor(self) -> NSColor {
        match self {
            SystemColor::Label => NSColor::label_color(),
            SystemColor::SecondaryLabel => NSColor::secondary_label_color(),
            SystemColor::TertiaryLabel => NSColor::tertiary_label_color(),
            SystemColor::QuaternaryLabel => NSColor::quaternary_label_color(),
            SystemColor::Text => NSColor::text_color(),
            SystemColor::Placeholder => NSColor::placeholder_text_color(),
            SystemColor::Link => NSColor::link_color(),
            SystemColor::Separator => NSColor::separator_color(),
            SystemColor::Accent => NSColor::control_accent_color(),
            SystemColor::Control => NSColor::control_color(),
            SystemColor::ControlText => NSColor::control_text_color(),
            SystemColor::ControlBackground => NSColor::control_background_color(),
            SystemColor::WindowBackground => NSColor::window_background_color(),
            SystemColor::UnderPageBackground => NSColor::under_page_background_color(),
            SystemColor::TextBackground => NSColor::text_background_color(),
            SystemColor::SelectedContentBackground => NSColor::selected_content_background_color(),
            SystemColor::Clear => NSColor::clear_color(),
            SystemColor::Black => NSColor::black_color(),
            SystemColor::White => NSColor::white_color(),
            SystemColor::Gray => NSColor::system_gray_color(),
            SystemColor::Red => NSColor::system_red_color(),
            SystemColor::Orange => NSColor::system_orange_color(),
            SystemColor::Yellow => NSColor::system_yellow_color(),
            SystemColor::Green => NSColor::system_green_color(),
            SystemColor::Mint => NSColor::system_mint_color(),
            SystemColor::Teal => NSColor::system_teal_color(),
            SystemColor::Cyan => NSColor::system_cyan_color(),
            SystemColor::Blue => NSColor::system_blue_color(),
            SystemColor::Indigo => NSColor::system_indigo_color(),
            SystemColor::Purple => NSColor::system_purple_color(),
            SystemColor::Pink => NSColor::system_pink_color(),
            SystemColor::Brown => NSColor::system_brown_color(),
        }
    }
}

impl Color {
    /// Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`,
    /// `rgba(r, g, b, a)` or one of the system colour names.
    pub fn parse(s: &str) -> Result<Color> {
        let s = s.trim();
        let bad = || Error::BadColor(s.to_owned());
        if let Some(hex) = s.strip_prefix('#') {
            let nibble = |i: usize| {
                hex.as_bytes()
                    .get(i)
                    .and_then(|&c| (c as char).to_digit(16))
                    .ok_or_else(bad)
            };
            let (r, g, b, a) = match hex.len() {
                3 | 4 => {
                    let ch = |i| nibble(i).map(|v| (v * 17) as f32 / 255.0);
                    (
                        ch(0)?,
                        ch(1)?,
                        ch(2)?,
                        if hex.len() == 4 { ch(3)? } else { 1.0 },
                    )
                }
                6 | 8 => {
                    let byte =
                        |i| Ok::<f32, Error>((nibble(i)? * 16 + nibble(i + 1)?) as f32 / 255.0);
                    (
                        byte(0)?,
                        byte(2)?,
                        byte(4)?,
                        if hex.len() == 8 { byte(6)? } else { 1.0 },
                    )
                }
                _ => return Err(bad()),
            };
            return Ok(Color::Rgba { r, g, b, a });
        }
        let func = |name: &str| {
            s.strip_prefix(name)
                .and_then(|r| r.strip_prefix('('))
                .and_then(|r| r.strip_suffix(')'))
        };
        if let Some(args) = func("rgba").or_else(|| func("rgb")) {
            let mut parts = bun_core::strings::split(args.as_bytes(), b",")
                .map(|p| core::str::from_utf8(p).map_or("", str::trim));
            // `full_scale` is what a bare number is out of; `%` is always out of 100.
            let mut component = |full_scale: f32| -> Result<Option<f32>> {
                let Some(p) = parts.next() else {
                    return Ok(None);
                };
                let v = if let Some(pct) = p.strip_suffix('%') {
                    pct.parse::<f32>().map(|v| v / 100.0)
                } else {
                    p.parse::<f32>().map(|v| v / full_scale)
                };
                let v = v.map_err(|_| bad())?;
                if !v.is_finite() {
                    return Err(bad());
                }
                Ok(Some(v.clamp(0.0, 1.0)))
            };
            let r = component(255.0)?.ok_or_else(bad)?;
            let g = component(255.0)?.ok_or_else(bad)?;
            let b = component(255.0)?.ok_or_else(bad)?;
            let a = component(1.0)?.unwrap_or(1.0);
            if parts.next().is_some() {
                return Err(bad());
            }
            return Ok(Color::Rgba { r, g, b, a });
        }
        let s = if s == "grey" { "gray" } else { s };
        SystemColor::from_name(s).map(Color::System).ok_or_else(bad)
    }

    /// The `NSColor` for this colour.
    pub(crate) fn to_nscolor(&self) -> NSColor {
        match *self {
            Color::Rgba { r, g, b, a } => {
                NSColor::srgb(f64::from(r), f64::from(g), f64::from(b), f64::from(a))
            }
            Color::System(c) => c.nscolor(),
        }
    }
}
