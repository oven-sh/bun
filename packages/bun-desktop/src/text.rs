//! Fonts: what a `font-family` resolves to, shaping, and glyph images.

mod breaks;
#[cfg_attr(
    any(target_os = "linux", target_os = "freebsd"),
    path = "text/fontconfig.rs"
)]
#[cfg_attr(target_os = "macos", path = "text/core_text.rs")]
#[cfg_attr(target_os = "windows", path = "text/fontique.rs")]
mod catalog;
mod decoded;
mod fonts;
mod line;
mod raster;
mod reach;
mod shape;
mod woff;
mod words;

pub use fonts::{
    Description, Palette, Recipe, command, describe, em_box, face, file_for_character,
    file_for_family, metrics, prewarm,
};
pub use line::{Line, glyph_extent, ink_spans};
pub use raster::{GlyphImage, GlyphPixels, glyph_path, rasterize, shade_for};
pub use shape::{Shaped, shape};

pub fn release_memory() {
    raster::release_memory();
    words::WORDS.take();
}
