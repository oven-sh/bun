//! `<canvas>`, `OffscreenCanvas`, `ImageBitmap` and `ImageData`.

mod bitmap;
mod context;
mod element;
mod encoding;
mod host;
mod image_bitmap;
mod image_data;
mod offscreen;
mod paint;
mod path;
mod recorder;
mod text;
mod transfer;

pub(crate) use bitmap::{Owned, Source, decode, drop_font_scope, open};
pub(crate) use context::Context;
pub(crate) use element::CANVAS_STEPS;
pub(crate) use host::*;
pub(crate) use image_bitmap::ImageBitmap;
pub(crate) use image_data::ImageData;
pub(crate) use offscreen::OffscreenCanvas;
pub(crate) use paint::{CanvasGradient, CanvasPattern};
pub(crate) use path::Path;
pub(crate) use text::TextMetrics;
pub(crate) use transfer::{Transferable, receive};

use super::graphics::{Affine, Failure, are_finite};
