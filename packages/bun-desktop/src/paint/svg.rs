use resvg::tiny_skia::{PathStroker, Transform};
use resvg::usvg::{self, FillRule, Group, Node, PaintOrder};

use super::edges;
use super::raster::{Clip, IntRect, Layer, Paint, map_rect, path_from, premultiply};
use crate::abi::Rect;

/// Only has paths in plain colors, like most icons.
fn is_simple(group: &Group) -> bool {
    let is_plain = |paint: &usvg::Paint| matches!(paint, usvg::Paint::Color(_));
    group.children().iter().all(|node| match node {
        Node::Group(group) => !group.should_isolate() && is_simple(group),
        Node::Path(path) => {
            path.rendering_mode().use_shape_antialiasing()
                && path.fill().is_none_or(|fill| is_plain(fill.paint()))
                && path
                    .stroke()
                    .is_none_or(|stroke| is_plain(stroke.paint()) && stroke.dasharray().is_none())
        }
        _ => false,
    })
}

fn fill(
    target: &mut Layer,
    path: &resvg::tiny_skia::Path,
    rule: FillRule,
    (paint, opacity): (&usvg::Paint, usvg::Opacity),
    matrix: &Transform,
) {
    let usvg::Paint::Color(color) = paint else {
        return;
    };
    let bounds = path.bounds();
    let bounds = Rect {
        x: bounds.x(),
        y: bounds.y(),
        width: bounds.width(),
        height: bounds.height(),
    };
    let area = IntRect::around(map_rect(matrix, bounds)).intersect(target.rect);
    let coverage = edges::fill(&path_from(path), rule == FillRule::EvenOdd, matrix, area);
    let color = premultiply(u32::from_be_bytes([
        color.red,
        color.green,
        color.blue,
        opacity.to_u8(),
    ]));
    target.fill_coverage(&coverage, &Clip::new(area), &Paint::Solid(color));
}

fn draw_simple(target: &mut Layer, group: &Group, matrix: &Transform) {
    for node in group.children() {
        match node {
            Node::Group(group) => draw_simple(target, group, &matrix.pre_concat(group.transform())),
            Node::Path(path) if path.is_visible() => {
                let draw_fill = |target: &mut Layer| {
                    let Some(style) = path.fill() else { return };
                    fill(
                        target,
                        path.data(),
                        style.rule(),
                        (style.paint(), style.opacity()),
                        matrix,
                    );
                };
                let draw_stroke = |target: &mut Layer| {
                    let Some(style) = path.stroke() else { return };
                    let resolution = PathStroker::compute_resolution_scale(matrix);
                    let Some(outline) = path.data().stroke(&style.to_tiny_skia(), resolution)
                    else {
                        return;
                    };
                    fill(
                        target,
                        &outline,
                        FillRule::NonZero,
                        (style.paint(), style.opacity()),
                        matrix,
                    );
                };
                if path.paint_order() == PaintOrder::FillAndStroke {
                    draw_fill(target);
                    draw_stroke(target);
                } else {
                    draw_stroke(target);
                    draw_fill(target);
                }
            }
            _ => {}
        }
    }
}

pub fn draw(target: &mut Layer, tree: &usvg::Tree, matrix: &Transform) {
    if is_simple(tree.root()) && matrix.is_finite() {
        return draw_simple(
            target,
            tree.root(),
            &matrix.pre_concat(tree.root().transform()),
        );
    }
    if !crate::svg_limits::is_cheap(tree, matrix, target.rect.area()) {
        return;
    }
    let matrix = matrix.post_translate(-target.rect.left as f32, -target.rect.top as f32);
    resvg::render(tree, matrix, &mut target.pixmap.as_mut());
}
