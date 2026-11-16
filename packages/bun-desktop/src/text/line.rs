use std::cell::RefCell;

use resvg::tiny_skia::Transform;
use rustc_hash::FxHashMap;

use super::{Shaped, face, glyph_path, shape};
use crate::abi::{Cluster, Face, Glyph, GlyphExtent, Rect, TextRun};
use crate::paint::raster::{Coverage, IntRect, Path};

/// Text that does not wrap, from its left end on the baseline.
pub struct Line {
    pub width: f32,
    pub runs: Vec<(Face, Vec<Glyph>)>,
}

/// Rule L2 of UAX #9.
fn visual_order(clusters: &[Cluster]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..clusters.len()).collect();
    let highest = clusters
        .iter()
        .map(|cluster| cluster.bidi_level)
        .max()
        .unwrap_or(0);
    for level in (1..=highest).rev() {
        order
            .split_mut(|index| clusters[*index].bidi_level < level)
            .for_each(<[usize]>::reverse);
    }
    order
}

impl Line {
    pub fn new(text: &str, run: TextRun, direction: u8) -> Line {
        let mut shaped = Shaped::default();
        shape(text, &[run], direction, &mut shaped);
        let mut line = Line {
            width: 0.,
            runs: Vec::new(),
        };
        for index in visual_order(&shaped.clusters) {
            let cluster = shaped.clusters[index];
            let mut x = line.width;
            line.width += cluster.advance;
            if cluster.bidi_level & 1 == 1 {
                let rest_of_ligature = shaped.clusters[index + 1..].iter();
                let rest_of_ligature =
                    rest_of_ligature.take_while(|next| next.glyphs.start == next.glyphs.end);
                x -= rest_of_ligature.map(|next| next.advance).sum::<f32>();
            }
            let face = shaped.faces[usize::from(cluster.face)];
            let glyphs = shaped.glyphs[cluster.glyphs.range()]
                .iter()
                .map(|glyph| Glyph {
                    x: x + glyph.x,
                    ..*glyph
                });
            match line.runs.last_mut() {
                Some((last, run)) if *last == face => run.extend(glyphs),
                _ => line.runs.push((face, glyphs.collect())),
            }
        }
        line
    }

    pub fn path(&self) -> Path {
        let mut path = Path::new();
        for (run, glyphs) in &self.runs {
            let Some(face) = face(run.id) else { continue };
            for glyph in glyphs {
                let shift = zeno::Transform::translation(glyph.x, glyph.y);
                path.extend(
                    glyph_path(face, glyph.id, run.size)
                        .iter()
                        .map(|command| command.transform(&shift)),
                );
            }
        }
        path
    }

    pub fn ink_bounds(&self) -> Rect {
        let bounds = zeno::bounds(&self.path(), zeno::Fill::NonZero, None);
        let (mut left, mut top, mut right, mut bottom) =
            (bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
        for (run, glyphs) in &self.runs {
            let Some(face) = face(run.id).filter(|face| face.file.has_color) else {
                continue;
            };
            for glyph in glyphs {
                (left, right) = (
                    left.min(glyph.x),
                    right.max(glyph.x + face.advance(glyph.id, run.size)),
                );
                (top, bottom) = (top.min(-run.ascent), bottom.max(run.descent));
            }
        }
        Rect {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }
}

fn ink_span(
    face: &super::fonts::Face,
    glyph: u32,
    size: f32,
    top: f32,
    bottom: f32,
) -> Option<[f32; 2]> {
    const SAMPLES: f32 = 4.;
    let path = glyph_path(face, glyph, size);
    let bounds = zeno::bounds(&path, zeno::Fill::NonZero, None);
    if bounds.max.y <= top || bounds.min.y >= bottom {
        return None;
    }
    let band = Rect {
        x: bounds.min.x * SAMPLES,
        y: 0.,
        width: bounds.width() * SAMPLES,
        height: (bottom - top) * SAMPLES,
    };
    let (area, zoom) = (
        IntRect::around(band),
        Transform::from_row(SAMPLES, 0., 0., SAMPLES, 0., -top * SAMPLES),
    );
    let coverage = Coverage::of_path(&path, zeno::Fill::NonZero, &zoom, area);
    let rows = || coverage.data.chunks(area.width().max(1));
    let first = rows()
        .filter_map(|row| row.iter().position(|value| *value > 32))
        .min()?;
    let last = rows()
        .filter_map(|row| row.iter().rposition(|value| *value > 32))
        .max()?;
    Some([first, last + 1].map(|column| (area.left + column as i32) as f32 / SAMPLES))
}

pub fn glyph_extent(face_id: u32, size: f32, glyph: u32) -> Option<GlyphExtent> {
    let face = face(face_id)?;
    let bounds = zeno::bounds(&glyph_path(face, glyph, size), zeno::Fill::NonZero, None);
    let ink = Rect {
        x: bounds.min.x,
        y: bounds.min.y,
        width: bounds.width(),
        height: bounds.height(),
    };
    Some(GlyphExtent {
        advance: face.advance(glyph, size),
        ink,
    })
}

pub fn ink_spans(
    face_id: u32,
    size: f32,
    glyphs: &[Glyph],
    top: f32,
    bottom: f32,
    spans: &mut Vec<[f32; 2]>,
) {
    thread_local! {
        static KNOWN: RefCell<FxHashMap<[u32; 5], Option<[f32; 2]>>> = RefCell::default();
    }
    let Some(face) = face(face_id) else { return };
    KNOWN.with_borrow_mut(|known| {
        if known.len() > 4096 {
            known.clear();
        }
        for glyph in glyphs {
            let (top, bottom) = (top - glyph.y, bottom - glyph.y);
            let key = [
                face_id,
                glyph.id,
                size.to_bits(),
                top.to_bits(),
                bottom.to_bits(),
            ];
            let span = *known
                .entry(key)
                .or_insert_with(|| ink_span(face, glyph.id, size, top, bottom));
            spans.extend(span.map(|span| span.map(|x| x + glyph.x)));
        }
    });
}
