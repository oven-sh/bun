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
mod pages;
mod raster;
mod reach;
mod sfnt;
mod shape;
mod shaper;
mod woff;
mod words;

#[cfg(target_os = "macos")]
pub use catalog::about_glyph;
pub use decoded::{keep_font, map_file, open_stored, store_for};
pub use fonts::{
    Description, Face, Levels, Palette, Recipe, describe, face, generation, levels, metrics,
    prewarm,
};
pub use fonts::{
    Origin, fallback_family, family_named, file_of, font_named, fonts_of, generic_family,
    import_face, listed_file, open_font,
};
pub use fonts::{
    decode_font, decode_font_later, drop_font_scope, font_families, order_font, register_font,
    unregister_font,
};
pub use line::{Line, glyph_extent, ink_spans};
pub use raster::{GlyphImage, GlyphPixels, correct_stroke, glyph_path, ink_for, rasterize};
pub use shape::{Shaped, shape, shape_rest};

pub fn release_memory() {
    raster::release_memory();
    words::WORDS.take();
}
