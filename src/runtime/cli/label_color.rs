//! Per-package colors for `bun run --filter` / `--parallel` prefixes.
//!
//! On truecolor terminals the color is a pure function of the label, so a
//! package keeps its color across runs. Hue (and a chroma tier) come from a
//! hash; lightness/chroma are fixed in OKLCH so every hue is equally legible.
//! The label is drawn as a pill whose foreground and background are both ours
//! (dark shade on light tint), and the gutter uses a mid-lightness foreground,
//! so both read on light and dark terminals. Other terminals rotate through the
//! six basic ANSI colors by position.

use std::io::Write as _;

use bun_core::output::{ColorDepth, Source, ansi};
use bun_css::values::color::{OKLCH, RGBA, SRGB};

const BASIC: [&str; 6] = [
    ansi::CYAN,
    ansi::YELLOW,
    ansi::MAGENTA,
    ansi::GREEN,
    ansi::BLUE,
    ansi::RED,
];

#[derive(Clone, Copy)]
pub enum LabelColor {
    Basic(&'static str),
    Rgb {
        gutter: [u8; 3],
        pill_bg: [u8; 3],
        pill_fg: [u8; 3],
    },
}

impl LabelColor {
    pub fn for_label(label: &[u8], position: usize) -> LabelColor {
        Self::for_label_at_depth(label, position, Source::color_depth())
    }

    pub fn for_label_at_depth(label: &[u8], position: usize, depth: ColorDepth) -> LabelColor {
        if depth != ColorDepth::C16m {
            return LabelColor::Basic(BASIC[position % BASIC.len()]);
        }
        let h = bun_wyhash::hash(label);
        let hue = (h >> 32) as f32 * (360.0 / 4_294_967_296.0);
        let chroma = if h & 1 == 0 { 0.14 } else { 0.10 };
        LabelColor::Rgb {
            gutter: oklch_to_srgb(0.68, chroma, hue),
            pill_bg: oklch_to_srgb(0.86, 0.08, hue),
            pill_fg: oklch_to_srgb(0.32, 0.09, hue),
        }
    }

    /// SGR that colors gutter text (`│`, `|`) in the package color.
    pub fn gutter(self, out: &mut Vec<u8>) {
        match self {
            LabelColor::Basic(c) => out.extend_from_slice(c.as_bytes()),
            LabelColor::Rgb {
                gutter: [r, g, b], ..
            } => {
                let _ = write!(out, "\x1b[38;2;{r};{g};{b}m");
            }
        }
    }

    /// Writes `label` as a colored pill (truecolor) or bold colored text.
    pub fn pill(self, out: &mut Vec<u8>, label: &[u8]) {
        match self {
            LabelColor::Basic(c) => {
                out.extend_from_slice(ansi::BOLD.as_bytes());
                out.extend_from_slice(c.as_bytes());
                out.extend_from_slice(label);
                out.extend_from_slice(ansi::RESET.as_bytes());
            }
            LabelColor::Rgb {
                pill_bg: [br, bg, bb],
                pill_fg: [fr, fg, fb],
                ..
            } => {
                let _ = write!(
                    out,
                    "\x1b[48;2;{br};{bg};{bb}m\x1b[38;2;{fr};{fg};{fb}m\x1b[1m "
                );
                out.extend_from_slice(label);
                out.extend_from_slice(b" ");
                out.extend_from_slice(ansi::RESET.as_bytes());
            }
        }
    }
}

fn oklch_to_srgb(l: f32, c: f32, h: f32) -> [u8; 3] {
    let rgb = RGBA::from(SRGB::from(OKLCH {
        l,
        c,
        h,
        alpha: 1.0,
    }));
    [rgb.red, rgb.green, rgb.blue]
}
