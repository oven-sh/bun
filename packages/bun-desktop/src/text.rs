//! Fonts: what a `font-family` resolves to, shaping, and glyph images.

#[cfg(all(feature = "own-fonts", not(target_os = "macos")))]
mod autohint;
mod breaks;
#[cfg_attr(
    all(feature = "own-fonts", any(target_os = "linux", target_os = "freebsd")),
    path = "text/own/fontconfig.rs"
)]
#[cfg_attr(
    all(feature = "own-fonts", target_os = "macos"),
    path = "text/own/core_text.rs"
)]
#[cfg_attr(
    all(
        not(feature = "own-fonts"),
        any(target_os = "linux", target_os = "freebsd")
    ),
    path = "text/fontconfig.rs"
)]
#[cfg_attr(
    all(not(feature = "own-fonts"), target_os = "macos"),
    path = "text/core_text.rs"
)]
mod catalog;
#[cfg_attr(feature = "own-fonts", path = "text/own/decoded.rs")]
mod decoded;
#[cfg_attr(feature = "own-fonts", path = "text/own/fonts.rs")]
mod fonts;
#[cfg(feature = "own-fonts")]
#[cfg_attr(not(target_os = "macos"), path = "text/own/hint.rs")]
#[cfg_attr(target_os = "macos", path = "text/own/no_hint.rs")]
mod hint;
mod line;
#[cfg_attr(feature = "own-fonts", path = "text/own/raster.rs")]
mod raster;
#[cfg_attr(feature = "own-fonts", path = "text/own/reach.rs")]
mod reach;
#[cfg(feature = "own-fonts")]
mod sfnt;
#[cfg_attr(feature = "own-fonts", path = "text/own/shape.rs")]
mod shape;
#[cfg(feature = "own-fonts")]
mod shaper;
mod woff;
#[cfg_attr(feature = "own-fonts", path = "text/own/words.rs")]
mod words;

pub use fonts::{Description, Palette, Recipe, command, describe, em_box, face, metrics, prewarm};
pub use line::{Line, glyph_extent, ink_spans};
pub use raster::{GlyphImage, GlyphPixels, glyph_path, rasterize, shade_for};
pub use shape::{Shaped, shape};

pub fn release_memory() {
    raster::release_memory();
    words::WORDS.take();
}
