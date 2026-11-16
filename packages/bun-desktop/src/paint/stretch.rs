//! A box without most of its middle, along which nothing changes.

use super::border::inset;
use super::cpu::{Painter, snap_shadow};
use super::raster::{Clip, IntRect, Layer, Paint, Pixel, map_rect};
use super::scene::intersect;
use crate::abi::{Item, LineStyle, RoundedRect};
use crate::gfx::Transform;
use crate::small_vec::SmallVec;

/// What is stretched is the middle one of three equal pixels, because the GPU interpolates.
pub const STRETCHED: i32 = 3;

pub struct Stretch {
    pub item: Item,
    /// What `item` covers.
    pub area: IntRect,
    middle: [i32; 2],
    removed: [i32; 2],
    has_center: bool,
}

impl Stretch {
    pub fn of(painter: &Painter, index: usize, matrix: &Transform) -> Option<Stretch> {
        if matrix.has_skew() || matrix.sx <= 0. || matrix.sy <= 0. {
            return None;
        }
        let (frame, mut item) = (painter.frame, painter.scene.items[index]);
        let mut shapes: SmallVec<&mut RoundedRect, 2> = SmallVec::new();
        let (mut margins, mut has_center) = ([0.; 4], false);
        match &mut item {
            Item::Fill { shape, .. } => {
                *shape = frame.snap_shape(shape);
                shapes.push(shape);
                has_center = true;
            }
            Item::Border {
                shape,
                widths,
                styles,
                ..
            } => {
                if styles
                    .iter()
                    .any(|style| matches!(style, LineStyle::Dotted | LineStyle::Dashed))
                {
                    return None;
                }
                *shape = frame.snap_shape(shape);
                shapes.push(shape);
                margins = *widths;
            }
            Item::Shadow {
                shape,
                shadow,
                blur,
                inset,
                covered,
                ..
            } => {
                (*shape, *shadow) = snap_shadow(frame, shape, shadow);
                shapes.extend([shape, shadow]);
                margins = [*blur * 1.5 + 1.; 4];
                has_center = *covered && !*inset;
            }
            _ => return None,
        }
        let bounds = IntRect::around(map_rect(matrix, painter.scene.bounds(index)));
        let uniform = shapes.iter().fold(bounds.to_rect(), |uniform, shape| {
            let [tl, tr, br, bl] = shape.radii;
            let insets = [
                tl[1].max(tr[1]),
                tr[0].max(br[0]),
                br[1].max(bl[1]),
                tl[0].max(bl[0]),
            ];
            let insets = std::array::from_fn(|side| insets[side] + margins[side]);
            intersect(uniform, map_rect(matrix, inset(shape, insets).rect))
        });
        let (left, top) = (uniform.x.ceil() as i32 + 1, uniform.y.ceil() as i32 + 1);
        let removable = |start: i32, end: f32| (end.floor() as i32 - 1 - start - STRETCHED).max(0);
        let (dx, dy) = (
            removable(left, uniform.x + uniform.width),
            removable(top, uniform.y + uniform.height),
        );
        if dx == 0 && dy == 0 && bounds.area() > 256 * 256 {
            return None;
        }
        for shape in shapes {
            shape.rect.width -= dx as f32 / matrix.sx;
            shape.rect.height -= dy as f32 / matrix.sy;
        }
        let area = IntRect {
            right: bounds.right - dx,
            bottom: bounds.bottom - dy,
            ..bounds
        };
        Some(Stretch {
            item,
            area,
            middle: [left, top],
            removed: [dx, dy],
            has_center,
        })
    }

    pub fn render(&self, painter: &Painter, matrix: &Transform) -> Option<Layer> {
        let mut layer = Layer::new(self.area)?;
        painter.paint_leaf(
            &self.item,
            &mut layer,
            matrix,
            &Clip::new(self.area),
            self.area,
        );
        Some(layer)
    }

    /// Parts of `area`, and where they go.
    pub fn pieces(&self) -> impl Iterator<Item = (IntRect, IntRect)> {
        let spans = |low: i32, middle: i32, high: i32, removed: i32| -> SmallVec<[i32; 4], 3> {
            if removed == 0 {
                return SmallVec::from_iter([[low, high, low, high]]);
            }
            let (from, to) = (middle + 1, middle + 2);
            SmallVec::from_iter([
                [low, from, low, from],
                [from, to, from, to + removed],
                [to, high, to + removed, high + removed],
            ])
        };
        let columns = spans(
            self.area.left,
            self.middle[0],
            self.area.right,
            self.removed[0],
        );
        let rows = spans(
            self.area.top,
            self.middle[1],
            self.area.bottom,
            self.removed[1],
        );
        let cells = rows.into_iter().enumerate().flat_map(move |(row, y)| {
            columns
                .clone()
                .into_iter()
                .enumerate()
                .map(move |(column, x)| ((row, column), x, y))
        });
        let shown = cells.filter(|(cell, ..)| self.has_center || *cell != (1, 1));
        shown.map(|(_, x, y)| {
            (
                IntRect::new(x[0], y[0], x[1], y[1]),
                IntRect::new(x[2], y[2], x[3], y[3]),
            )
        })
    }

    pub fn paint(&self, painter: &Painter, layer: &mut Layer, matrix: &Transform, clip: &Clip) {
        let mut shown = self
            .pieces()
            .filter(|(_, to)| to.overlaps(clip.rect))
            .peekable();
        let Some(source) = shown.peek().and_then(|_| painter.recall(self, matrix)) else {
            return;
        };
        let (dx, dy) = (
            source.rect.left - self.area.left,
            source.rect.top - self.area.top,
        );
        for (from, to) in shown {
            let from = from.offset(dx, dy);
            let copy = |x: i32, y: i32, row: &mut [Pixel]| {
                let y = (from.top + y - to.top).min(from.bottom - 1);
                match from.width() == to.width() {
                    true => {
                        let x = from.left + x - to.left;
                        row.copy_from_slice(source.row(y, x, x + row.len() as i32))
                    }
                    false => row.fill(source.row(y, from.left, from.right)[0]),
                }
            };
            layer.fill(to, None, clip, &Paint::Shader(&copy));
        }
    }
}
