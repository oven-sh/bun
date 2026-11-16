//! What the hinter knows about faces.

use std::sync::{Arc, LazyLock};

use super::autohint::{self, Metrics, Style};
use super::fonts::{Face, File};
use crate::gfx::Path;
use crate::hash::FastMap;
use crate::sync::Mutex;

pub struct Styles(autohint::Styles);

impl Styles {
    pub fn new(file: &File) -> Option<Styles> {
        Some(Styles(autohint::Styles::new(
            &file.font,
            file.tables.layout[0].as_ref(),
        )))
    }
}

static METRICS: LazyLock<Mutex<FastMap<(u32, u8), Arc<Metrics>>>> = LazyLock::new(Mutex::default);

pub fn release_memory() {
    METRICS.lock().clear();
}

pub fn outline(face: &Face, glyph: u32, size: f32) -> Option<Path> {
    let (file, (style, is_mark)) = (face.file, face.file.styles()?.0.of(glyph)?);
    let measure = || {
        Arc::new(Metrics::new(
            &file.font,
            file.tables.layout[0].as_ref(),
            face.coords,
            Style::nth(style),
        ))
    };
    let metrics = METRICS
        .lock()
        .entry((face.id, style))
        .or_insert_with(measure)
        .clone();
    metrics.outline(&file.font, face.coords, glyph, is_mark, size)
}
