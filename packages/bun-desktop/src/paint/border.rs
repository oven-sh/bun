//! Borders and text decorations, after Blink's `BoxBorderPainter` and `StyledStrokeData`.

use super::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, add_rounded_rect, has_radii, map_rect,
    premultiply, rounded_rect_path,
};
use crate::abi::{LineStyle, Rect, RoundedRect};
use crate::gfx::{self, Cap, Fill, PathBuilder as _, Stroke, Transform};

pub fn inset(shape: &RoundedRect, [top, right, bottom, left]: [f32; 4]) -> RoundedRect {
    let shrink = |[x, y]: [f32; 2], by_x: f32, by_y: f32| [(x - by_x).max(0.), (y - by_y).max(0.)];
    let [tl, tr, br, bl] = shape.radii;
    RoundedRect {
        rect: Rect {
            x: shape.rect.x + left,
            y: shape.rect.y + top,
            width: (shape.rect.width - left - right).max(0.),
            height: (shape.rect.height - top - bottom).max(0.),
        },
        radii: [
            shrink(tl, left, top),
            shrink(tr, right, top),
            shrink(br, right, bottom),
            shrink(bl, left, bottom),
        ],
        ..*shape
    }
}

fn best_gap(length: f32, dash: f32, gap: f32, closed: bool) -> f32 {
    let available = if closed { length } else { length + gap };
    let fewer = (available / (dash + gap)).floor();
    let gap_for =
        |dashes: f32| (length - dashes * dash) / if closed { dashes } else { dashes - 1. };
    let (wider, narrower) = (gap_for(fewer), gap_for(fewer + 1.));
    if narrower <= 0. || (wider - gap).abs() < (narrower - gap).abs() {
        wider
    } else {
        narrower
    }
}

/// `None` for a line that is too short to have gaps.
fn dashes(style: LineStyle, width: f32, length: f32, closed: bool) -> Option<([f32; 2], Cap)> {
    if style == LineStyle::Dotted && width > 3. {
        let gap = best_gap(length, width, width, closed);
        return (length >= width * 2.).then_some(([0.001, gap + width - 0.011], Cap::Round));
    }
    let (dash, gap) = match style {
        LineStyle::Dashed if width >= 3. => (width * 2., width),
        LineStyle::Dashed => (width * 3., width * 2.),
        _ => (width, width),
    };
    if length <= dash * 2. {
        None
    } else if length <= dash * 2. + gap {
        let factor = length / (dash * 2. + gap);
        Some(([dash * factor, gap * factor], Cap::Butt))
    } else if style == LineStyle::Dashed {
        Some(([dash, best_gap(length, dash, gap, closed)], Cap::Butt))
    } else {
        Some(([dash, gap], Cap::Butt))
    }
}

/// Widths are in the space of `matrix`, which has `scale` device pixels per unit, and dashes depend on those.
fn dashed(
    path: &Path,
    style: LineStyle,
    width: f32,
    closed: bool,
    matrix: &Transform,
    scale: f32,
    area: IntRect,
) -> Coverage {
    let length = gfx::length(path);
    let mut stroke = Stroke::new(width);
    let extra = if !closed && style == LineStyle::Dotted && width * scale > 3. {
        width
    } else {
        0.
    };
    let pattern = dashes(style, width * scale, (length + extra) * scale, closed);
    let pattern = pattern.map(|(lengths, cap)| (lengths.map(|length| length / scale), cap));
    if let Some((lengths, cap)) = &pattern {
        (stroke.dashes, stroke.cap) = (lengths, *cap);
    }
    Coverage::of_path(path, stroke, matrix, area)
}

fn straight_line(rect: Rect, horizontal: bool, style: LineStyle, scale: f32) -> (Path, f32) {
    let width = if horizontal { rect.height } else { rect.width };
    let cap = if style == LineStyle::Dotted && width * scale > 3. {
        width / 2.
    } else {
        0.
    };
    let mut path = Path::new();
    if horizontal {
        let y = rect.y + width / 2.;
        path.move_to([rect.x + cap, y])
            .line_to([rect.x + rect.width - cap, y]);
    } else {
        let x = rect.x + width / 2.;
        path.move_to([x, rect.y + cap])
            .line_to([x, rect.y + rect.height - cap]);
    }
    (path, width)
}

/// `Color::Dark` and `Color::Light` in Blink.
fn shifted(color: u32, by: f32) -> u32 {
    let [r, g, b, a] = color.to_be_bytes();
    let value = f32::from(r.max(g).max(b)) / 255.;
    if value == 0. {
        return color | 0x5454_5400;
    }
    let factor = (value + by).clamp(0., 1.) / value;
    let [r, g, b] = [r, g, b].map(|channel| (f32::from(channel) * factor * 255.99998 / 255.) as u8);
    u32::from_be_bytes([r, g, b, a])
}

fn shade(color: u32, side: usize, is_inset: bool) -> u32 {
    let linear = |channel: u8| match f32::from(channel) / 255. {
        it if it <= 0.040_45 => it / 12.92,
        it => ((it + 0.055) / 1.055).powf(2.4),
    };
    let ([r, g, b, _], is_dark) = (color.to_be_bytes(), (side == 0 || side == 3) == is_inset);
    match 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) {
        ..=0.014_443_9 if is_dark => shifted(color, 0.33),
        ..=0.014_443_9 => shifted(shifted(color, 0.33), 0.33),
        _ if is_dark => shifted(color, -0.33),
        0.830_77.. => color,
        _ => shifted(color, 0.33),
    }
}

fn corners(rect: Rect) -> [[f32; 2]; 4] {
    let (right, bottom) = (rect.x + rect.width, rect.y + rect.height);
    [
        [rect.x, rect.y],
        [right, rect.y],
        [right, bottom],
        [rect.x, bottom],
    ]
}

/// Where the line from the outer to the inner corner crosses the chord of the inner curve.
fn miter_end(outer: [f32; 2], inner: [f32; 2], radius: [f32; 2], corner: usize) -> [f32; 2] {
    if radius[0] <= 0. || radius[1] <= 0. {
        return inner;
    }
    let (sign_x, sign_y) = [(1., 1.), (-1., 1.), (-1., -1.), (1., -1.)][corner];
    let (dx, dy) = (inner[0] - outer[0], inner[1] - outer[1]);
    let along = dx * sign_x / radius[0] + dy * sign_y / radius[1];
    if along <= 0. {
        return inner;
    }
    [inner[0] + dx / along, inner[1] + dy / along]
}

pub struct Border<'a> {
    pub shape: &'a RoundedRect,
    pub widths: [f32; 4],
    pub colors: [u32; 4],
    pub styles: [LineStyle; 4],
}

impl Border<'_> {
    fn ring(&self, from: f32, to: f32, matrix: &Transform, scale: f32, area: IntRect) -> Coverage {
        let at = |fraction: f32| {
            self.widths
                .map(|width| (width * fraction * scale).round() / scale)
        };
        let mut path = rounded_rect_path(&inset(self.shape, at(from)));
        add_rounded_rect(&mut path, &inset(self.shape, at(to)));
        Coverage::of_path(&path, Fill::EvenOdd, matrix, area)
    }

    fn side_rect(&self, side: usize) -> Rect {
        let (rect, width) = (self.shape.rect, self.widths[side]);
        match side {
            0 => Rect {
                height: width,
                ..rect
            },
            1 => Rect {
                x: rect.x + rect.width - width,
                width,
                ..rect
            },
            2 => Rect {
                y: rect.y + rect.height - width,
                height: width,
                ..rect
            },
            _ => Rect { width, ..rect },
        }
    }

    pub fn paint(
        &self,
        layer: &mut Layer,
        matrix: &Transform,
        scale: f32,
        clip: &Clip,
        area: IntRect,
    ) {
        let inner = inset(self.shape, self.widths);
        let (outer_corners, inner_corners) = (corners(self.shape.rect), corners(inner.rect));
        let miters: [_; 4] = std::array::from_fn(|corner| {
            miter_end(
                outer_corners[corner],
                inner_corners[corner],
                inner.radii[corner],
                corner,
            )
        });
        let is_present =
            |side: usize| self.widths[side] > 0. && self.styles[side] != LineStyle::None;
        let look = |side: usize| match self.styles[side] {
            LineStyle::Inset => (LineStyle::Solid, shade(self.colors[side], side, true), 0),
            LineStyle::Outset => (LineStyle::Solid, shade(self.colors[side], side, false), 0),
            LineStyle::Double if self.widths[side] * scale < 3. => {
                (LineStyle::Solid, self.colors[side], 0)
            }
            LineStyle::Groove | LineStyle::Ridge if self.widths[side] * scale <= 1.01 => {
                (LineStyle::Solid, self.colors[side], 0)
            }
            style @ (LineStyle::Groove | LineStyle::Ridge) => {
                let is_groove = style == LineStyle::Groove;
                (
                    style,
                    shade(self.colors[side], side, is_groove),
                    shade(self.colors[side], side, !is_groove),
                )
            }
            style => (style, self.colors[side], 0),
        };

        let mut done = [false; 4];
        for side in (0..4).filter(|side| is_present(*side)) {
            if done[side] {
                continue;
            }
            let (style, color, second_color) = look(side);
            let is_broken = matches!(style, LineStyle::Dotted | LineStyle::Dashed);
            let is_alike = |other: usize| {
                is_present(other)
                    && look(other) == look(side)
                    && (!is_broken || self.widths[other] == self.widths[side])
            };
            let alike: Vec<usize> = (side..4).filter(|other| is_alike(*other)).collect();
            alike.iter().for_each(|other| done[*other] = true);
            if color & 0xFF == 0 {
                continue;
            }

            // One path for all of them, so that no seam shows where they meet.
            let clip = if alike.len() == (0..4).filter(|side| is_present(*side)).count()
                && !(is_broken && has_radii(self.shape) && alike.len() < 4)
            {
                clip.clone()
            } else {
                let mut region = Path::new();
                for &side in &alike {
                    let next = (side + 1) % 4;
                    region
                        .move_to(outer_corners[side])
                        .line_to(outer_corners[next]);
                    region.line_to(miters[next]).line_to(miters[side]).close();
                }
                clip.within(Coverage::of_path(&region, Fill::NonZero, matrix, area))
            };
            let mut fill = |coverage: Coverage, color: u32| {
                layer.fill_coverage(&coverage, &clip, &Paint::Solid(premultiply(color)))
            };
            match style {
                _ if is_broken && has_radii(self.shape) => {
                    let center =
                        rounded_rect_path(&inset(self.shape, self.widths.map(|width| width / 2.)));
                    let mut coverage =
                        dashed(&center, style, self.widths[side], true, matrix, scale, area);
                    if self.widths != [self.widths[side]; 4] {
                        coverage.intersect(&self.ring(0., 1., matrix, scale, area));
                    }
                    fill(coverage, color);
                }
                _ if is_broken => {
                    let mut coverage = Coverage::filled(area, 0);
                    for &side in &alike {
                        let (line, width) =
                            straight_line(self.side_rect(side), side % 2 == 0, style, scale);
                        coverage.unite(&dashed(&line, style, width, false, matrix, scale, area));
                    }
                    fill(coverage, color);
                }
                LineStyle::Double => {
                    fill(self.ring(0., 1. / 3., matrix, scale, area), color);
                    fill(self.ring(2. / 3., 1., matrix, scale, area), color);
                }
                LineStyle::Groove | LineStyle::Ridge => {
                    fill(self.ring(0., 0.5, matrix, scale, area), color);
                    fill(self.ring(0.5, 1., matrix, scale, area), second_color);
                }
                _ => fill(self.ring(0., 1., matrix, scale, area), color),
            }
        }
    }
}

/// A dotted, dashed or wavy text decoration.
pub fn decoration(
    rect: Rect,
    style: LineStyle,
    matrix: &Transform,
    scale: f32,
    area: IntRect,
) -> Coverage {
    if style != LineStyle::Wavy {
        let (thickness, width) = (rect.height * scale, (rect.height * scale).round().max(1.));
        let middle = (rect.y * scale + (thickness / 2.).max(0.5)).floor() + width % 2. / 2.;
        let (left, right) = (
            (rect.x * scale).trunc() / scale,
            ((rect.x + rect.width) * scale).trunc() / scale,
        );
        let whole = Rect {
            x: left,
            y: (middle - width / 2.) / scale,
            width: right - left,
            height: width / scale,
        };
        let (line, width) = straight_line(whole, true, style, scale);
        let mut coverage = dashed(&line, style, width, false, matrix, scale, area);
        let bounds = Rect {
            y: middle / scale - rect.height / 2.,
            height: rect.height,
            ..whole
        };
        coverage.intersect(&Coverage::of_shape(
            &RoundedRect {
                rect: bounds,
                ..RoundedRect::default()
            },
            matrix,
            area,
        ));
        return coverage;
    }
    let thickness = (rect.height * scale).max(1.);
    let reach = (0.5 + (3. * thickness + 0.5).round()) / scale;
    let step = (0.5 + (2. * thickness + 0.5).round()) / scale;
    let shown = matrix
        .invert()
        .map_or(rect, |back| map_rect(&back, area.to_rect()));
    let hidden = ((shown.x - rect.height - rect.x) / (step * 2.))
        .floor()
        .max(0.);
    let right = (rect.x + rect.width).min(shown.x + shown.width + rect.height);
    let (mut x, y) = (rect.x + (hidden - 1.) * step * 2., rect.y + 0.5 / scale);
    let mut wave = Path::new();
    wave.move_to([x, y]);
    while x < right + step * 2. && wave.len() < 1 << 16 {
        wave.curve_to(
            [x + step, y + reach],
            [x + step, y - reach],
            [x + step * 2., y],
        );
        x += step * 2.;
    }
    let mut coverage = Coverage::of_path(&wave, Stroke::new(rect.height), matrix, area);
    let bounds = RoundedRect {
        rect: Rect {
            y: y - reach,
            height: reach * 2.,
            ..rect
        },
        ..RoundedRect::default()
    };
    coverage.intersect(&Coverage::of_shape(&bounds, matrix, area));
    coverage
}
