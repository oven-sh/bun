//! Transforms that have depth.

use crate::abi::{Item, Matrix, Outline, Rect};
use crate::boxes::{BoxId, VIEWPORT};
use crate::document::Document;
use crate::paint::{Painter, Space};
use crate::path::Path;
use crate::properties::{Id, Style, WillChange};
use crate::svg_values::TransformBox;
use crate::transform::{
    IDENTITY_3D, Matrix3d, Transform, extended, flattened, invert_3d, multiply_3d,
};
use crate::types::*;
use crate::values::{Css, Ctx, Position, parse_all};

pub(crate) const EVERYWHERE: Rect = Rect {
    x: -1e6,
    y: -1e6,
    width: 2e6,
    height: 2e6,
};

fn translation([x, y]: [f32; 2], z: f32) -> Matrix3d {
    let mut matrix = IDENTITY_3D;
    [matrix[12], matrix[13], matrix[14]] = [x, y, z].map(f64::from);
    matrix
}

fn around(point: [f32; 2], z: f32, matrix: &Matrix3d) -> Matrix3d {
    multiply_3d(
        &multiply_3d(&translation(point, z), matrix),
        &translation(point.map(|it| -it), -z),
    )
}

/// For what is in the plane where `z` is 0.
pub(crate) fn affine(m: &Matrix3d) -> Option<Matrix> {
    (m[3].abs() < 1e-12 && m[7].abs() < 1e-12 && m[15] > 0.0)
        .then(|| flattened(m).map(|it| it / m[15] as f32))
}

pub(crate) fn unproject(m: &[f32; 9], [x, y]: [f32; 2]) -> Option<[f32; 2]> {
    let [a, b, c, d, e, f] = [
        m[0] - x * m[6],
        m[1] - x * m[7],
        x * m[8] - m[2],
        m[3] - y * m[6],
        m[4] - y * m[7],
        y * m[8] - m[5],
    ];
    let point = [c * e - b * f, a * f - c * d].map(|it| it / (a * e - b * d));
    (m[6] * point[0] + m[7] * point[1] + m[8] > 0.0).then_some(point)
}

type Polygon = Vec<[f64; 3]>;

/// The parts where `side` is positive and where it is negative.
fn split<const N: usize>(
    points: &[[f64; N]],
    side: impl Fn(&[f64; N]) -> f64,
) -> [Vec<[f64; N]>; 2] {
    let mut parts = [Vec::new(), Vec::new()];
    for (from, to) in points.iter().zip(points.iter().cycle().skip(1)) {
        let (a, b) = (side(from), side(to));
        parts[0].extend((a >= 0.0).then_some(*from));
        parts[1].extend((a <= 0.0).then_some(*from));
        if a * b < 0.0 {
            parts.iter_mut().for_each(|it| {
                it.push(core::array::from_fn(|axis| {
                    from[axis] + (to[axis] - from[axis]) * a / (a - b)
                }))
            });
        }
    }
    parts
}

/// Of the part that is in front of the viewer.
fn project(m: &Matrix3d, rect: Rect) -> Polygon {
    let corners = [
        [rect.x, rect.y],
        [rect.right(), rect.y],
        [rect.right(), rect.bottom()],
        [rect.x, rect.bottom()],
    ];
    let corners = corners.map(|[x, y]| {
        [0, 1, 2, 3].map(|row| m[row] * f64::from(x) + m[4 + row] * f64::from(y) + m[12 + row])
    });
    let [seen, _] = split(&corners, |it| it[3] - 1e-5);
    seen.iter()
        .map(|[x, y, z, w]| [x / w, y / w, z / w])
        .collect()
}

fn normal(polygon: &Polygon) -> Option<[f64; 3]> {
    let mut sum = [0.0; 3];
    for (a, b) in polygon.iter().zip(polygon.iter().cycle().skip(1)) {
        (0..3).for_each(|it| {
            sum[it] += (a[(it + 1) % 3] - b[(it + 1) % 3]) * (a[(it + 2) % 3] + b[(it + 2) % 3])
        });
    }
    let length = sum.iter().map(|it| it * it).sum::<f64>().sqrt();
    (length > 1e-9).then(|| sum.map(|it| it / length * if sum[2] < 0.0 { -1.0 } else { 1.0 }))
}

struct Plane {
    id: BoxId,
    origin: [f32; 2],
    matrix: Matrix3d,
}

struct Piece {
    plane: usize,
    polygon: Polygon,
    is_whole: bool,
}

/// From the back to the front, by binary space partitioning.
fn sort(mut pieces: Vec<Piece>, budget: &mut u32, out: &mut Vec<Piece>) {
    const THRESHOLD: f64 = 0.05;
    let Some(normal) = pieces
        .first()
        .filter(|_| *budget > 0 && bun_core::StackCheck::init().is_safe_to_recurse())
        .and_then(|it| normal(&it.polygon))
    else {
        return out.append(&mut pieces);
    };
    let point = pieces[0].polygon[0];
    let side = |it: &[f64; 3]| {
        Some(
            (0..3)
                .map(|axis| (it[axis] - point[axis]) * normal[axis])
                .sum::<f64>(),
        )
        .filter(|it| it.abs() > THRESHOLD)
        .unwrap_or(0.0)
    };
    let mut pieces = pieces.into_iter();
    let (mut front, mut level, mut back) = (Vec::new(), Vec::from_iter(pieces.next()), Vec::new());
    for piece in pieces {
        match [1.0, -1.0].map(|sign| piece.polygon.iter().any(|it| side(it) * sign > 0.0)) {
            [false, false] => level.push(piece),
            [true, false] => front.push(piece),
            [false, true] => back.push(piece),
            [true, true] => {
                *budget = budget.saturating_sub(1);
                let [a, b] = split(&piece.polygon, side).map(|polygon| Piece {
                    plane: piece.plane,
                    polygon,
                    is_whole: false,
                });
                front.push(a);
                back.push(b);
            }
        }
    }
    sort(back, budget, out);
    out.append(&mut level);
    sort(front, budget, out);
}

impl Style {
    pub(crate) fn wants_3d(&self) -> bool {
        self.other_if_set(Id::TransformStyle).is_some()
    }

    fn transforms(&self) -> impl Iterator<Item = &Transform> {
        let e = &self.effects;
        [&e.translate.0, &e.rotate.0, &e.scale.0]
            .into_iter()
            .flatten()
            .chain(e.transform.0.0.iter())
    }

    pub(crate) fn is_3d(&self) -> bool {
        self.transforms().any(Transform::is_3d)
    }

    /// It has more than an affine transform in the plane of its parent can do.
    pub(crate) fn has_depth(&self) -> bool {
        let projects = |it: &Transform| {
            let matrix = it.is_3d().then(|| it.matrix_3d(1.0, 1.0));
            matrix.is_some_and(|it| {
                [3, 7, 11, 15].iter().any(|at| it[*at] != IDENTITY_3D[*at])
                    || invert_3d(&it).is_none()
            })
        };
        self.wants_3d()
            || self.effects.backface == Backface::Hidden && self.is_3d()
            || self.transforms().any(projects)
    }

    /// `motion` is from `offset-path`.
    pub(crate) fn transform_3d(&self, reference: Rect, motion: Option<Matrix>) -> Matrix3d {
        let (
            e,
            Rect {
                x,
                y,
                width,
                height,
            },
        ) = (&self.effects, reference);
        let individual = [&e.translate.0, &e.rotate.0, &e.scale.0]
            .into_iter()
            .flatten()
            .map(|it| it.matrix_3d(width, height));
        let all = individual
            .chain(motion.map(extended))
            .chain([e.transform.matrix_3d(width, height)]);
        let origin = e.origin.0.resolve(width, height);
        around(
            [x + origin[0], y + origin[1]],
            e.origin.1,
            &all.fold(IDENTITY_3D, |all, it| multiply_3d(&all, &it)),
        )
    }

    pub(crate) fn text_stroke_width(&self) -> f32 {
        let width = self
            .other_if_set(Id::WebkitTextStrokeWidth)
            .and_then(|_| self.parse_other::<crate::values::Lp>(Id::WebkitTextStrokeWidth));
        width.map_or(0.0, |it| it.resolve(0.0))
    }

    pub(crate) fn parse_other<T: Css>(&self, id: Id) -> Option<T> {
        parse_all(self.other(id).as_bytes(), |p| {
            T::parse(
                p,
                &Ctx {
                    zoom: self.zoom,
                    ..Ctx::dummy()
                },
            )
        })
    }
}

impl Document {
    pub(crate) fn transform_reference(&self, id: BoxId) -> Rect {
        match self.boxes[id].style.effects.transform_box {
            TransformBox::ContentBox | TransformBox::FillBox => Rect::new(self.content_box(id)),
            _ => self.border_box(id),
        }
    }

    pub(crate) fn own_transform_3d(&self, id: BoxId) -> Option<Matrix3d> {
        let it = &self.boxes[id];
        (it.style.has_transform() && !it.is_foreign_object).then(|| {
            it.style
                .transform_3d(self.transform_reference(id), self.motion(id))
        })
    }

    fn preserves_3d(&self, id: BoxId) -> bool {
        let (it, e) = (&self.boxes[id], &self.boxes[id].style.effects);
        it.style.wants_3d()
            && !it.style.has_effects()
            && it.overflow == [Overflow::Visible; 2]
            && e.isolation == Isolation::Auto
            && e.backdrop_filter.0.is_empty()
            && !(e.clip.0.is_some() && it.style.is_out_of_flow())
            && !(e.will_change.0 | it.style.animates)
                .intersects(WillChange::OPACITY | WillChange::FILTER)
            && !it.style.contain().contains(Contain::PAINT)
            && !it.is_foreign_object
            && !(it.style.has_transition_name() || self.is_captured(it.node))
    }

    /// The box of the parent element.
    fn parent_in_depth(&self, id: BoxId) -> Option<BoxId> {
        let mut ancestors = self.tree.flat_ancestors(self.boxes[id].node);
        self.own_box(ancestors.find(|it| {
            self.tree
                .style(*it)
                .is_none_or(|it| it.display() != Display::Contents)
        })?)
    }

    /// Whether it is sorted by depth with its parent.
    pub(crate) fn is_plane(&self, id: BoxId) -> bool {
        let it = &self.boxes[id];
        self.has_depth.get()
            && it.node != 0
            && (it.style.has_transform()
                || it.style.wants_3d()
                || it.style.effects.backface == Backface::Hidden
                || it
                    .style
                    .effects
                    .will_change
                    .0
                    .contains(WillChange::TRANSFORM))
            && self
                .parent_in_depth(id)
                .is_some_and(|it| self.preserves_3d(it))
    }

    fn lender_of_perspective(&self, id: BoxId) -> Option<BoxId> {
        let style = &self.boxes[id].style;
        self.parent_in_depth(id).filter(|it| {
            (style.has_transform() || style.wants_3d())
                && self.boxes[*it].style.effects.perspective.0.is_some()
        })
    }

    pub(crate) fn is_in_depth(&self, id: BoxId) -> bool {
        let it = &self.boxes[id];
        self.has_depth.get()
            && it.node != 0
            && !it.is_foreign_object
            && (it.style.has_depth()
                || self.is_plane(id)
                || self.lender_of_perspective(id).is_some())
    }

    pub(crate) fn has_simple_transform(&self, id: BoxId) -> bool {
        let style = &self.boxes[id].style;
        !self.is_in_depth(id)
            && style.effects.transform_box == TransformBox::ViewBox
            && style.other_if_set(Id::OffsetPath).is_none()
    }

    /// `origin` is where the border box is.
    fn perspective(&self, id: BoxId, origin: [f32; 2]) -> Matrix3d {
        let (style, reference) = (&self.boxes[id].style, self.transform_reference(id));
        let Some(distance) = &style.effects.perspective.0 else {
            return IDENTITY_3D;
        };
        let [x, y] = style
            .parse_other(Id::PerspectiveOrigin)
            .unwrap_or(Position::CENTER)
            .resolve(reference.width, reference.height);
        let mut matrix = IDENTITY_3D;
        matrix[11] = -1.0 / f64::from(distance.0.max(style.zoom));
        around(
            [origin[0] + reference.x + x, origin[1] + reference.y + y],
            0.0,
            &matrix,
        )
    }

    pub(crate) fn offset_in(&self, id: BoxId, ancestor: BoxId) -> [f32; 2] {
        let inside = core::iter::once(id)
            .chain(self.boxes.containers(id))
            .take_while(|it| *it != ancestor && *it != VIEWPORT);
        inside
            .map(|it| self.offset_in_container(it))
            .fold([0.0; 2], |a, b| [a[0] + b[0], a[1] + b[1]])
    }

    /// From the coordinates of the border box.
    pub(crate) fn map_to_viewport(&self, id: BoxId, rect: Rect) -> Rect {
        if !self.has_depth.get() {
            return rect.transformed(&self.to_viewport(id));
        }
        let mut all = IDENTITY_3D;
        for id in core::iter::once(id)
            .chain(self.boxes.containers(id))
            .take_while(|it| *it != VIEWPORT)
        {
            if !self.is_in_depth(id) {
                all = multiply_3d(&extended(self.to_container(id)), &all);
                continue;
            }
            all = multiply_3d(&self.own_transform_3d(id).unwrap_or(IDENTITY_3D), &all);
            if let Some(parent) = self.lender_of_perspective(id) {
                all = multiply_3d(
                    &self.perspective(parent, self.offset_in(id, parent).map(|it| -it)),
                    &all,
                );
            }
            all = multiply_3d(&translation(self.offset_in_container(id), 0.0), &all);
            if !self.is_plane(id) {
                [2, 6, 8, 9, 10, 11, 14]
                    .into_iter()
                    .for_each(|it| all[it] = IDENTITY_3D[it]);
            }
        }
        Path::polygon(
            project(&all, rect)
                .iter()
                .map(|it| [it[0] as f32, it[1] as f32]),
            true,
        )
        .bounds()
        .unwrap_or_default()
    }

    fn gather_planes(&self, id: BoxId, origin: [f32; 2], outer: &Matrix3d, out: &mut Vec<Plane>) {
        let scale = self.environment.scale;
        let origin = origin.map(|it| (it * scale).round() / scale);
        let matrix = multiply_3d(
            outer,
            &around(
                origin,
                0.0,
                &self.own_transform_3d(id).unwrap_or(IDENTITY_3D),
            ),
        );
        out.push(Plane { id, origin, matrix });
        if !self.preserves_3d(id) {
            return;
        }
        let (inner, mut children, mut pending) = (
            multiply_3d(&matrix, &self.perspective(id, origin)),
            Vec::new(),
            vec![id],
        );
        while let Some(parent) = pending.pop() {
            let (anonymous, own): (Vec<_>, Vec<_>) = self.boxes[parent]
                .children
                .iter()
                .partition(|it| self.boxes[**it].node == 0);
            children.extend(own.into_iter().filter(|it| self.is_plane(*it)));
            pending.extend(anonymous.into_iter().rev());
        }
        children.sort_by_key(|it| self.boxes[*it].style.paint.z_index.0.unwrap_or(0));
        for child in children {
            let [x, y] = self.offset_in(child, id);
            self.gather_planes(child, [origin[0] + x, origin[1] + y], &inner, out);
        }
    }
}

impl Painter<'_> {
    /// Paints the stacking context, and those that share its depth.
    pub(crate) fn in_depth(&mut self, id: BoxId, space: &Space) {
        let document = self.document;
        self.depends_on_outside();
        if document.is_plane(id) {
            return;
        }
        let outer = document
            .lender_of_perspective(id)
            .map_or(IDENTITY_3D, |parent| {
                self.leave_scrolling_to_engine(space);
                let [x, y] = document.offset_in(id, parent);
                document.perspective(parent, [space.origin[0] - x, space.origin[1] - y])
            });
        let (mut planes, mut sorted) = (Vec::new(), Vec::new());
        document.gather_planes(id, space.origin, &outer, &mut planes);
        planes.retain(|it| {
            invert_3d(&it.matrix).is_some_and(|inverse| {
                inverse[10] >= 0.0
                    || document.boxes[it.id].style.effects.backface == Backface::Visible
            })
        });
        let pieces = planes.iter().enumerate().map(|(plane, it)| Piece {
            plane,
            polygon: project(&it.matrix, document.ink(it.id).moved(it.origin)),
            is_whole: true,
        });
        sort(
            pieces
                .filter(|it| planes.len() == 1 || normal(&it.polygon).is_some())
                .collect(),
            &mut 256,
            &mut sorted,
        );
        for piece in sorted {
            let (Plane { id, origin, matrix }, mut inside, links) =
                (&planes[piece.plane], *space, self.out.links.len() as u32);
            if !piece.is_whole {
                let outline = self.outline_of(
                    &Path::polygon(
                        piece.polygon.iter().map(|it| [it[0] as f32, it[1] as f32]),
                        true,
                    ),
                    FillRule::Nonzero,
                );
                self.link(
                    Item::PushClipOutline(Outline {
                        crisp: true,
                        ..outline
                    }),
                    &mut inside,
                );
            }
            (inside.origin, inside.visible) = (*origin, document.ink(*id).moved(*origin));
            match affine(matrix) {
                Some(matrix) => {
                    let Some(inverse) = invert(&matrix) else {
                        continue;
                    };
                    inside.visible = space.visible.transformed(&inverse);
                    self.link(Item::PushTransform(matrix), &mut inside);
                }
                None => self.link(
                    Item::PushProjection(
                        [0, 4, 12, 1, 5, 13, 3, 7, 15].map(|it| matrix[it] as f32),
                    ),
                    &mut inside,
                ),
            }
            self.placed_stacking_context(*id, inside, true);
            if !piece.is_whole {
                self.contents.retain(|_, it| it.link < links);
            }
        }
    }
}
