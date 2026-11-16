//! `offset-path`

use crate::abi::{Matrix, Rect, RoundedRect};
use crate::boxes::BoxId;
use crate::contour::Contour;
use crate::document::Document;
use crate::geometry::translation;
use crate::path::{Path, at_distance};
use crate::properties::{Id, Style};
use crate::svg::{rotation, scaling};
use crate::tree::NodeId;
use crate::types::*;
use crate::values::*;

struct Ray {
    degrees: f32,
    /// `None` for `sides`.
    extent: Option<Extent>,
    contains: bool,
    at: Option<Position>,
}

fn ray(p: &mut P, cx: &Ctx) -> Option<Ray> {
    let mut ray = Ray {
        degrees: degrees(p, cx)?,
        extent: Some(Extent::ClosestSide),
        contains: false,
        at: None,
    };
    ray.extent = if keyword(p, "sides") {
        None
    } else {
        Extent::parse(p, cx).or(ray.extent)
    };
    ray.contains = keyword(p, "contain");
    ray.at = if keyword(p, "at") {
        Position::parse(p, cx)
    } else {
        None
    };
    Some(ray)
}

impl Ray {
    fn length(&self, [x, y]: [f32; 2], [width, height]: [f32; 2]) -> f32 {
        let [across, down] = [[x.abs(), (width - x).abs()], [y.abs(), (height - y).abs()]];
        let [near, far] =
            [f32::min, f32::max].map(|pick| [pick(across[0], across[1]), pick(down[0], down[1])]);
        match self.extent {
            Some(Extent::ClosestSide) => near[0].min(near[1]),
            Some(Extent::FarthestSide) => far[0].max(far[1]),
            Some(Extent::ClosestCorner) => near[0].hypot(near[1]),
            Some(Extent::FarthestCorner) => far[0].hypot(far[1]),
            None if !(0.0..=width).contains(&x) || !(0.0..=height).contains(&y) => 0.0,
            None => {
                let (sin, cos) = self.degrees.to_radians().sin_cos();
                let until = |direction: f32, sides: [f32; 2]| {
                    if direction.abs() < 1e-6 {
                        f32::MAX
                    } else {
                        sides[usize::from(direction > 0.0)] / direction.abs()
                    }
                };
                until(sin, across).min(until(-cos, down))
            }
        }
    }
}

impl Document {
    pub(crate) fn motion(&self, id: BoxId) -> Option<Matrix> {
        let (it, container) = (&self.boxes[id], self.boxes[id].container);
        it.style.other_if_set(Id::OffsetPath)?;
        let area = |area| {
            let RoundedRect { rect, radii } = self
                .frame_of(container, self.border_box(container))
                .area(area);
            RoundedRect {
                rect: rect.moved(self.offset_in_container(id).map(|it| -it)),
                radii,
            }
        };
        let contour = |area: BoxArea| {
            let frame = self.frame_of(
                container,
                self.border_box(container)
                    .moved(self.offset_in_container(id).map(|it| -it)),
            );
            Some(
                Contour::of(&self.boxes[container].style, &frame)?
                    .edge(&frame, area.into())
                    .0
                    .starting_at_top(),
            )
        };
        self.motion_in(
            it.node,
            &it.style,
            self.transform_reference(id),
            &area,
            &contour,
        )
    }

    /// `own` is the reference box of the transform, and `area` is a box of the containing block in the same coordinates.
    pub(crate) fn motion_in(
        &self,
        node: NodeId,
        style: &Style,
        own: Rect,
        area: &dyn Fn(BoxArea) -> RoundedRect,
        contour: &dyn Fn(BoxArea) -> Option<Path>,
    ) -> Option<Matrix> {
        let (source, cx) = (
            style.other_if_set(Id::OffsetPath)?,
            Ctx {
                zoom: style.zoom,
                ..Ctx::dummy()
            },
        );
        let distance: Lp = style.parse_other(Id::OffsetDistance)?;
        let start = |reference: Rect| match style.other(Id::OffsetPosition) {
            "auto" => [-reference.x, -reference.y],
            _ => style
                .parse_other(Id::OffsetPosition)
                .unwrap_or(Position::CENTER)
                .resolve(reference.width, reference.height),
        };
        let along = |path: Path| {
            let (length, pieces) = (path.length(), path.pieces());
            let distance = distance.resolve(length);
            let distance = if path.is_closed() && length > 0.0 {
                distance.rem_euclid(length)
            } else {
                distance
            };
            at_distance(&pieces, distance)
                .unwrap_or_else(|| (path.start().unwrap_or_default(), 0.0))
        };
        let with_area = |p: &mut P| BoxArea::parse(p, &cx).unwrap_or(BoxArea::BorderBox);
        let as_ray = parse_all(source.as_bytes(), |p| {
            Some((
                function(p)
                    .filter(|it| eq(it, "ray"))
                    .and_then(|_| nested(p, |p| ray(p, &cx)))?,
                with_area(p),
            ))
        });
        let (point, radians) = if let Some((ray, kind)) = as_ray {
            let reference = area(kind).rect;
            let from = ray.at.as_ref().map_or_else(
                || start(reference),
                |it| it.resolve(reference.width, reference.height),
            );
            let margin = if ray.contains {
                own.width.max(own.height) / 2.0
            } else {
                0.0
            };
            let (length, radians) = (
                distance.resolve(
                    (ray.length(from, [reference.width, reference.height]) - margin).max(0.0),
                ),
                (ray.degrees - 90.0).to_radians(),
            );
            (
                [
                    reference.x + from[0] + length * radians.cos(),
                    reference.y + from[1] + length * radians.sin(),
                ],
                radians,
            )
        } else if let Some((url, kind)) =
            parse_all(source.as_bytes(), |p| Some((url(p, &cx)?, with_area(p))))
        {
            let (reference, path) = (
                area(kind).rect,
                self.svg_reference(node, &url)
                    .and_then(|it| it.document.svg_path(&it)),
            );
            along(
                path.unwrap_or_else(|| Path::parse("M0 0"))
                    .transformed(&multiply(
                        &translation([reference.x, reference.y]),
                        &scaling(style.zoom, style.zoom),
                    )),
            )
        } else {
            let (mut shape, kind) = (*style.parse_other::<ClipPath>(Id::OffsetPath)?.0?).clone();
            let mut reference = area(kind);
            match &mut shape {
                Shape::Path(..) => reference = RoundedRect::default(),
                Shape::Ellipse(_, center, _)
                    if !bun_core::strings::contains(source.as_bytes(), b" at ")
                        && !bun_core::strings::contains(source.as_bytes(), b"(at ") =>
                {
                    let [x, y] = start(reference.rect);
                    *center = Position(Lp::Px(x), Lp::Px(y));
                }
                _ => {}
            }
            let is_ellipse = matches!(shape, Shape::Ellipse(..));
            along(
                match crate::shapes::resolve(&shape, &reference, style.zoom) {
                    crate::shapes::Resolved::Rounded(it) if is_ellipse => Path::ellipse(
                        [it.rect.x + it.radii[0][0], it.rect.y + it.radii[0][1]],
                        it.radii[0],
                    ),
                    resolved => contour(kind)
                        .filter(|_| shape == Shape::Box)
                        .unwrap_or_else(|| resolved.into_path().0),
                },
            )
        };
        let origin = style.effects.origin.0.resolve(own.width, own.height);
        let anchor = style
            .parse_other::<Position>(Id::OffsetAnchor)
            .map_or(origin, |it| it.resolve(own.width, own.height));
        let (follows, degrees) = parse_all(style.other(Id::OffsetRotate).as_bytes(), |p| {
            Some((keyword(p, "auto"), degrees(p, &cx).unwrap_or(0.0)))
        })?;
        let without_noise = |noise: f32| {
            move |it: f32| {
                if (it - it.round()).abs() < noise {
                    it.round()
                } else {
                    it
                }
            }
        };
        let turn = rotation(degrees.to_radians() + if follows { radians } else { 0.0 })
            .map(without_noise(5e-4));
        let moved = multiply(
            &translation(
                [point[0] - own.x - origin[0], point[1] - own.y - origin[1]]
                    .map(without_noise(0.02)),
            ),
            &turn,
        );
        Some(multiply(
            &moved,
            &translation([origin[0] - anchor[0], origin[1] - anchor[1]]),
        ))
    }
}
