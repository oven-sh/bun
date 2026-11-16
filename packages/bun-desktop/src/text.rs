//! Fonts: what a `font-family` resolves to, shaping, and glyph images.

#[cfg(not(target_os = "macos"))]
mod autohint;
mod breaks;
#[cfg_attr(
    any(target_os = "linux", target_os = "freebsd"),
    path = "text/fontconfig.rs"
)]
#[cfg_attr(target_os = "macos", path = "text/core_text.rs")]
mod catalog;
mod decoded;
mod fonts;
#[cfg_attr(target_os = "macos", path = "text/no_hint.rs")]
mod hint;
mod line;
mod raster;
mod reach;
mod sfnt;
mod shape;
mod shaper;
mod woff;
mod words;

pub use fonts::{Description, Palette, Recipe, command, describe, em_box, face, metrics, prewarm};
pub use line::{Line, glyph_extent, ink_spans};
pub use raster::{GlyphImage, GlyphPixels, glyph_path, rasterize, shade_for};
pub use shape::{Shaped, shape};

pub fn release_memory() {
    raster::release_memory();
    words::WORDS.take();
}
