//! Per-package colors for `bun run --filter` / `--parallel` prefixes.
//!
//! On truecolor terminals the color is a pure function of the label, so a
//! package keeps its color across runs: a hash picks the hue, drawn at a fixed
//! OKLCH lightness that reads on light and dark backgrounds with as much chroma
//! as sRGB has at that hue (CSS gamut mapping trims the excess). The
//! mustard/olive hues are skipped. Other terminals rotate through the six basic
//! ANSI colors by position.

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

const LIGHTNESS: f32 = 0.72;
const CHROMA: f32 = 0.2;
/// OKLCH hues in `[SKIP_FROM, SKIP_TO)` come out mustard/olive at this lightness.
const SKIP_FROM: f32 = 70.0;
const SKIP_TO: f32 = 128.0;

#[derive(Clone, Copy)]
pub enum LabelColor {
    Basic(&'static str),
    Rgb([u8; 3]),
}

impl LabelColor {
    pub fn for_label(label: &[u8], position: usize) -> LabelColor {
        Self::for_label_at_depth(label, position, Source::color_depth())
    }

    pub fn for_label_at_depth(label: &[u8], position: usize, depth: ColorDepth) -> LabelColor {
        if depth != ColorDepth::C16m {
            return LabelColor::Basic(BASIC[position % BASIC.len()]);
        }
        let unit = (bun_wyhash::hash(label) >> 40) as f32 / (1u32 << 24) as f32;
        let mut h = unit * (360.0 - (SKIP_TO - SKIP_FROM));
        if h >= SKIP_FROM {
            h += SKIP_TO - SKIP_FROM;
        }
        let rgb = RGBA::from(SRGB::from(OKLCH {
            l: LIGHTNESS,
            c: CHROMA,
            h,
            alpha: 1.0,
        }));
        LabelColor::Rgb([rgb.red, rgb.green, rgb.blue])
    }

    /// SGR that colors gutter text (`│`, `|`) in the package color.
    pub fn gutter(self, out: &mut Vec<u8>) {
        match self {
            LabelColor::Basic(c) => out.extend_from_slice(c.as_bytes()),
            LabelColor::Rgb([r, g, b]) => {
                let _ = write!(out, "\x1b[38;2;{r};{g};{b}m");
            }
        }
    }

    /// Writes `label` in bold package color.
    pub fn label(self, out: &mut Vec<u8>, label: &[u8]) {
        out.extend_from_slice(ansi::BOLD.as_bytes());
        self.gutter(out);
        out.extend_from_slice(label);
        out.extend_from_slice(ansi::RESET.as_bytes());
    }
}
