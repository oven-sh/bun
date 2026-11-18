//! Transforms.

use std::rc::Rc;

use crate::abi;
use crate::calc::{Kind, Node, Options};
use crate::properties::Id;
use crate::types::multiply;
use crate::values::*;

/// In the order of `matrix3d()`.
pub(crate) type Matrix3d = [f64; 16];

pub(crate) const IDENTITY_3D: Matrix3d = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// `b` is applied first.
pub(crate) fn multiply_3d(a: &Matrix3d, b: &Matrix3d) -> Matrix3d {
    core::array::from_fn(|i| (0..4).map(|k| a[k * 4 + i % 4] * b[i / 4 * 4 + k]).sum())
}

pub(crate) fn invert_3d(m: &Matrix3d) -> Option<Matrix3d> {
    let (mut m, mut inverse) = (*m, IDENTITY_3D);
    for column in 0..4 {
        let pivot = (column..4)
            .max_by(|a, b| m[a * 4 + column].abs().total_cmp(&m[b * 4 + column].abs()))?;
        let scale = m[pivot * 4 + column];
        (scale != 0.0 && scale.is_finite()).then_some(())?;
        for matrix in [&mut m, &mut inverse] {
            for i in 0..4 {
                matrix.swap(pivot * 4 + i, column * 4 + i);
                matrix[column * 4 + i] /= scale;
            }
        }
        for row in (0..4).filter(|it| *it != column) {
            let factor = m[row * 4 + column];
            for i in 0..4 {
                m[row * 4 + i] -= factor * m[column * 4 + i];
                inverse[row * 4 + i] -= factor * inverse[column * 4 + i];
            }
        }
    }
    Some(inverse)
}

pub(crate) fn is_2d(m: &Matrix3d) -> bool {
    [2, 3, 6, 7, 8, 9, 10, 11, 14, 15]
        .iter()
        .all(|i| m[*i] == IDENTITY_3D[*i])
}

pub(crate) fn flattened(m: &Matrix3d) -> abi::Matrix {
    [0, 1, 4, 5, 12, 13].map(|i| m[i] as f32)
}

pub(crate) fn extended(m: [f32; 6]) -> Matrix3d {
    let mut all = IDENTITY_3D;
    [0, 1, 4, 5, 12, 13]
        .into_iter()
        .zip(m)
        .for_each(|(i, it)| all[i] = it.into());
    all
}

pub(crate) fn write_matrix(mut m: Matrix3d, out: &mut Out) {
    let zoom = f64::from(crate::values::written_zoom());
    (0..3).for_each(|it| (m[12 + it], m[3 + 4 * it]) = (m[12 + it] / zoom, m[3 + 4 * it] * zoom));
    let flat = [0, 1, 4, 5, 12, 13].map(|i| m[i]);
    let (name, items) = if is_2d(&m) {
        ("matrix(", &flat[..])
    } else {
        ("matrix3d(", &m[..])
    };
    out.extend_from_slice(name.as_bytes());
    write_list(items, ", ", out, |it, out| write_double(*it, out));
    out.push(b')');
}

keywords! {
    Name {
        Translate = "translate", TranslateX = "translateX", TranslateY = "translateY", TranslateZ = "translateZ",
        Translate3d = "translate3d", Scale = "scale", ScaleX = "scaleX", ScaleY = "scaleY", ScaleZ = "scaleZ",
        Scale3d = "scale3d", Rotate = "rotate", RotateX = "rotateX", RotateY = "rotateY", RotateZ = "rotateZ",
        Rotate3d = "rotate3d", Skew = "skew", SkewX = "skewX", SkewY = "skewY", Perspective = "perspective",
        Matrix = "matrix", Matrix3d = "matrix3d",
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Transform {
    Translate(Name, Lp, Lp, f32),
    Scale(Name, [f32; 3]),
    /// An axis of any length, and degrees.
    Rotate(Name, [f32; 3], f32),
    Skew(Name, f32, f32),
    Perspective(Option<f32>),
    Matrix(Rc<Matrix3d>),
    /// Matrices that depend on the size of the box.
    Deferred(Rc<(Transforms, Transforms, Mixing)>),
}

pub(crate) const Z_AXIS: [f32; 3] = [0.0, 0.0, 1.0];

fn sin_cos(degrees: f64) -> (f64, f64) {
    match degrees.rem_euclid(360.0) {
        0.0 => (0.0, 1.0),
        90.0 => (1.0, 0.0),
        180.0 => (0.0, -1.0),
        270.0 => (-1.0, 0.0),
        degrees => degrees.to_radians().sin_cos(),
    }
}

fn unit(axis: [f64; 3]) -> Option<[f64; 3]> {
    let length = axis.into_iter().fold(0.0, f64::hypot);
    (length != 0.0).then(|| axis.map(|it| it / length))
}

/// Around an axis of any length.
pub(crate) fn rotation_3d(axis: [f64; 3], degrees: f64) -> Matrix3d {
    let mut m = IDENTITY_3D;
    let (Some(axis), (sin, cos)) = (unit(axis), sin_cos(degrees)) else {
        return m;
    };
    for (i, j, k) in [(0, 1, 2), (1, 2, 0), (2, 0, 1)] {
        m[i * 5] = if axis[i].abs() == 1.0 {
            1.0
        } else {
            cos + axis[i] * axis[i] * (1.0 - cos)
        };
        m[i * 4 + j] = axis[i] * axis[j] * (1.0 - cos) + axis[k] * sin;
        m[j * 4 + i] = axis[i] * axis[j] * (1.0 - cos) - axis[k] * sin;
    }
    m
}

impl Name {
    pub(crate) fn is_3d(self) -> bool {
        self.name().ends_with(['Z', 'd'])
            || matches!(self, Name::RotateX | Name::RotateY | Name::Perspective)
    }
}

/// Each function of a value of `transform` with its arguments. `none` is no function, and no argument.
pub(crate) fn specified_functions(source: &[u8]) -> Option<Vec<(Name, Vec<Node>)>> {
    Id::Transform.syntax().accepts(source).then_some(())?;
    parse_all(source, |p| {
        let mut all = Vec::new();
        while !keyword(p, "none") && !p.is_exhausted() {
            let name = Name::from_name(function(p)?)?;
            let kinds = [
                Options::new(Kind::Number),
                Options::LENGTH_PERCENTAGE,
                Options::new(Kind::Angle),
            ];
            let argument = |p: &mut P| kinds.iter().find_map(|it| Node::parse(p, it));
            all.push((
                name,
                nested(p, |p| {
                    if keyword(p, "none") {
                        Some(Vec::new())
                    } else {
                        commas(p, argument)
                    }
                })?,
            ));
        }
        Some(all)
    })
}

type Quaternion = [f64; 4];

fn quaternion(axis: [f32; 3], degrees: f32) -> Quaternion {
    let (sin, cos) = (f64::from(degrees).to_radians() / 2.0).sin_cos();
    unit(axis.map(f64::from)).map_or([0.0, 0.0, 0.0, 1.0], |[x, y, z]| {
        [x * sin, y * sin, z * sin, cos]
    })
}

fn blend_quaternions(a: Quaternion, b: Quaternion, t: Mixing) -> Quaternion {
    let Mixing::Lerp(t) = t else {
        return [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ];
    };
    let product = (0..4).map(|i| a[i] * b[i]).sum::<f64>().clamp(-1.0, 1.0);
    if product.abs() > 1.0 - 1e-5 {
        return a;
    }
    let (angle, a) = (
        product.abs().acos(),
        a.map(|it| if product < 0.0 { -it } else { it }),
    );
    let [from, to] = [1.0 - f64::from(t), t.into()].map(|it| (it * angle).sin() / angle.sin());
    core::array::from_fn(|i| a[i] * from + b[i] * to)
}

struct Decomposed {
    perspective: [f64; 4],
    translate: [f64; 3],
    rotation: Quaternion,
    skew: [f64; 3],
    scale: [f64; 3],
}

fn decompose(m: &Matrix3d) -> Option<Decomposed> {
    (m[15] != 0.0).then_some(())?;
    let m = m.map(|it| it / m[15]);
    let mut affine = m;
    (affine[3], affine[7], affine[11], affine[15]) = (0.0, 0.0, 0.0, 1.0);
    let inverse = invert_3d(&affine)?;
    let perspective =
        core::array::from_fn(|i| (0..4).map(|k| m[k * 4 + 3] * inverse[i * 4 + k]).sum());
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let minus = |a: [f64; 3], b: [f64; 3], times: f64| [0, 1, 2].map(|i| a[i] - b[i] * times);
    let mut c = [0, 4, 8].map(|i| [m[i], m[i + 1], m[i + 2]]);
    let (mut scale, mut skew) = ([0.0; 3], [0.0; 3]);
    for i in 0..3 {
        for earlier in 0..i {
            skew[i + earlier - 1] = dot(c[earlier], c[i]);
            c[i] = minus(c[i], c[earlier], skew[i + earlier - 1]);
        }
        scale[i] = dot(c[i], c[i]).sqrt();
        c[i] = c[i].map(|it| it / scale[i]);
        (0..i).for_each(|earlier| skew[i + earlier - 1] /= scale[i]);
    }
    let cross = [0, 1, 2]
        .map(|i| c[1][(i + 1) % 3] * c[2][(i + 2) % 3] - c[1][(i + 2) % 3] * c[2][(i + 1) % 3]);
    if dot(c[0], cross) < 0.0 {
        if is_2d(&m) {
            let axis = usize::from(m[0] >= m[5]);
            (scale[axis], c[axis], skew[0]) = (-scale[axis], c[axis].map(|it| -it), -skew[0]);
        } else {
            (scale, c) = (scale.map(|it| -it), c.map(|it| it.map(|it| -it)));
        }
    }
    let [[xx, yx, zx], [xy, yy, zy], [xz, yz, zz]] = c;
    let part = |sum: f64| (0.5 * (1.0 + sum).sqrt(), 0.5 / (1.0 + sum).sqrt());
    let rotation = match () {
        () if 1.0 + xx + yy + zz > 0.001 => {
            let (r, s) = part(xx + yy + zz);
            [(zy - yz) * s, (xz - zx) * s, (yx - xy) * s, r]
        }
        () if xx > yy && xx > zz => {
            let (r, s) = part(xx - yy - zz);
            [r, (xy + yx) * s, (xz + zx) * s, (zy - yz) * s]
        }
        () if yy > zz => {
            let (r, s) = part(yy - xx - zz);
            [(xy + yx) * s, r, (yz + zy) * s, (xz - zx) * s]
        }
        () => {
            let (r, s) = part(zz - xx - yy);
            [(xz + zx) * s, (yz + zy) * s, r, (yx - xy) * s]
        }
    };
    Some(Decomposed {
        perspective,
        translate: [m[12], m[13], m[14]],
        rotation,
        skew,
        scale,
    })
}

fn recompose(it: &Decomposed) -> Matrix3d {
    let with = |items: &[(usize, f64)]| {
        let mut m = IDENTITY_3D;
        items.iter().for_each(|(at, value)| m[*at] = *value);
        m
    };
    let ([x, y, z, w], p, t) = (it.rotation, it.perspective, it.translate);
    [
        with(&[(12, t[0]), (13, t[1]), (14, t[2])]),
        with(&[
            (0, 1.0 - 2.0 * (y * y + z * z)),
            (1, 2.0 * (x * y + z * w)),
            (2, 2.0 * (x * z - y * w)),
            (4, 2.0 * (x * y - z * w)),
            (5, 1.0 - 2.0 * (x * x + z * z)),
            (6, 2.0 * (y * z + x * w)),
            (8, 2.0 * (x * z + y * w)),
            (9, 2.0 * (y * z - x * w)),
            (10, 1.0 - 2.0 * (x * x + y * y)),
        ]),
        with(&[(9, it.skew[2])]),
        with(&[(8, it.skew[1])]),
        with(&[(4, it.skew[0])]),
        with(&[(0, it.scale[0]), (5, it.scale[1]), (10, it.scale[2])]),
    ]
    .iter()
    .fold(
        with(&[(3, p[0]), (7, p[1]), (11, p[2]), (15, p[3])]),
        |all, one| multiply_3d(&all, one),
    )
}

fn blend_matrices(from: &Matrix3d, to: &Matrix3d, t: Mixing) -> Option<Matrix3d> {
    fn each<const N: usize>(a: [f64; N], b: [f64; N], t: Mixing, first_one: usize) -> [f64; N] {
        core::array::from_fn(|i| match t {
            Mixing::Lerp(t) => a[i] + (b[i] - a[i]) * f64::from(t),
            _ => a[i] + b[i] - if i >= first_one { 1.0 } else { 0.0 },
        })
    }
    let (a, b) = (decompose(from)?, decompose(to)?);
    Some(recompose(&Decomposed {
        perspective: each(a.perspective, b.perspective, t, 3),
        translate: each(a.translate, b.translate, t, 3),
        rotation: blend_quaternions(a.rotation, b.rotation, t),
        skew: each(a.skew, b.skew, t, 3),
        scale: each(a.scale, b.scale, t, 0),
    }))
}

impl Transform {
    pub(crate) fn rotation(degrees: f32) -> Transform {
        Transform::Rotate(Name::Rotate, Z_AXIS, degrees)
    }

    pub(crate) fn matrix_3d(&self, width: f32, height: f32) -> Matrix3d {
        let mut m = IDENTITY_3D;
        match self {
            Transform::Translate(_, x, y, z) => {
                (m[12], m[13], m[14]) = (
                    x.resolve(width).into(),
                    y.resolve(height).into(),
                    (*z).into(),
                )
            }
            Transform::Scale(_, [x, y, z]) => {
                (m[0], m[5], m[10]) = ((*x).into(), (*y).into(), (*z).into())
            }
            Transform::Rotate(_, axis, degrees) => {
                return rotation_3d(
                    axis.map(f64::from),
                    if degrees.abs() < MAX_DEGREES {
                        (*degrees).into()
                    } else {
                        0.0
                    },
                );
            }
            Transform::Skew(_, x, y) => {
                (m[4], m[1]) = (
                    f64::from(*x).to_radians().tan(),
                    f64::from(*y).to_radians().tan(),
                )
            }
            Transform::Perspective(depth) => {
                m[11] = depth.map_or(0.0, |it| -1.0 / f64::from(it.max(1.0)))
            }
            Transform::Matrix(matrix) => return **matrix,
            Transform::Deferred(it) => {
                let (from, to) = (it.0.matrix_3d(width, height), it.1.matrix_3d(width, height));
                let is_early = matches!(it.2, Mixing::Lerp(t) if t < 0.5);
                return blend_matrices(&from, &to, it.2).unwrap_or(if is_early {
                    from
                } else {
                    to
                });
            }
        }
        m
    }

    /// Projected on the plane of the screen.
    pub(crate) fn matrix(&self, width: f32, height: f32) -> abi::Matrix {
        match self {
            Transform::Translate(_, x, y, _) => {
                [1.0, 0.0, 0.0, 1.0, x.resolve(width), y.resolve(height)]
            }
            Transform::Scale(_, [x, y, _]) => [*x, 0.0, 0.0, *y, 0.0, 0.0],
            _ => flattened(&self.matrix_3d(width, height)),
        }
    }

    fn neutral(&self) -> Transform {
        match self {
            Transform::Translate(name, ..) => Transform::Translate(*name, Lp::ZERO, Lp::ZERO, 0.0),
            Transform::Scale(name, _) => Transform::Scale(*name, [1.0; 3]),
            Transform::Rotate(name, axis, _) => Transform::Rotate(*name, *axis, 0.0),
            Transform::Skew(name, ..) => Transform::Skew(*name, 0.0, 0.0),
            Transform::Perspective(_) => Transform::Perspective(None),
            Transform::Matrix(_) | Transform::Deferred(_) => {
                Transform::Matrix(Rc::new(IDENTITY_3D))
            }
        }
    }

    pub(crate) fn has_percentage(&self) -> bool {
        match self {
            Transform::Translate(_, x, y, _) => !matches!((x, y), (Lp::Px(_), Lp::Px(_))),
            other => matches!(other, Transform::Deferred(_)),
        }
    }

    /// Whether it is more than an affine transform that can be undone.
    pub(crate) fn projects(&self) -> bool {
        let matrix = (!matches!(self, Transform::Translate(..)) && self.is_3d())
            .then(|| self.matrix_3d(1.0, 1.0));
        matrix.is_some_and(|it| {
            [3, 7, 11, 15].iter().any(|at| it[*at] != IDENTITY_3D[*at]) || invert_3d(&it).is_none()
        })
    }

    pub(crate) fn is_3d(&self) -> bool {
        match self {
            Transform::Translate(name, ..)
            | Transform::Scale(name, _)
            | Transform::Rotate(name, ..) => name.is_3d(),
            Transform::Skew(..) => false,
            Transform::Perspective(_) => true,
            Transform::Matrix(matrix) => !is_2d(matrix),
            Transform::Deferred(it) => it.0.0.iter().chain(it.1.0.iter()).any(Transform::is_3d),
        }
    }
}

impl Css for Transform {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Transform> {
        use Transform as T;
        let name = Name::from_name(function(p)?)?;
        nested(p, |p| {
            Some(match name {
                Name::TranslateY => T::Translate(name, Lp::ZERO, Lp::parse(p, cx)?, 0.0),
                Name::TranslateZ => T::Translate(name, Lp::ZERO, Lp::ZERO, px(p, cx)?),
                Name::Translate | Name::TranslateX | Name::Translate3d => {
                    let x = Lp::parse(p, cx)?;
                    let y = if comma(p) {
                        Lp::parse(p, cx)?
                    } else {
                        Lp::ZERO
                    };
                    T::Translate(name, x, y, if comma(p) { px(p, cx)? } else { 0.0 })
                }
                Name::Scale | Name::ScaleX | Name::ScaleY | Name::ScaleZ | Name::Scale3d => {
                    T::Scale(
                        name,
                        match (name, &commas(p, |p| number_or_percentage(p, cx))?[..]) {
                            (Name::ScaleX, [x]) => [*x, 1.0, 1.0],
                            (Name::ScaleY, [y]) => [1.0, *y, 1.0],
                            (Name::ScaleZ, [z]) => [1.0, 1.0, *z],
                            (Name::Scale, [x]) => [*x, *x, 1.0],
                            (Name::Scale, [x, y]) => [*x, *y, 1.0],
                            (Name::Scale3d, [x, y, z]) => [*x, *y, *z],
                            _ => return None,
                        },
                    )
                }
                Name::Rotate | Name::RotateZ => T::Rotate(name, Z_AXIS, degrees(p, cx)?),
                Name::RotateX => T::Rotate(name, [1.0, 0.0, 0.0], degrees(p, cx)?),
                Name::RotateY => T::Rotate(name, [0.0, 1.0, 0.0], degrees(p, cx)?),
                Name::Rotate3d => {
                    let mut next = || number(p, cx).filter(|_| comma(p));
                    T::Rotate(name, [next()?, next()?, next()?], degrees(p, cx)?)
                }
                Name::SkewY => T::Skew(name, 0.0, degrees(p, cx)?),
                Name::Skew | Name::SkewX => T::Skew(
                    name,
                    degrees(p, cx)?,
                    if comma(p) { degrees(p, cx)? } else { 0.0 },
                ),
                Name::Perspective => {
                    T::Perspective(NoneOr::<PositivePx>::parse(p, cx)?.0.map(|it| it.0))
                }
                Name::Matrix | Name::Matrix3d => {
                    let items = commas(p, |p| number(p, cx))?;
                    let mut matrix = match name {
                        Name::Matrix => extended(items.try_into().ok()?),
                        _ => <[f32; 16]>::try_from(items).ok()?.map(f64::from),
                    };
                    let zoom = f64::from(cx.zoom);
                    (0..3).for_each(|it| {
                        (matrix[12 + it], matrix[3 + 4 * it]) =
                            (matrix[12 + it] * zoom, matrix[3 + 4 * it] / zoom)
                    });
                    T::Matrix(Rc::new(matrix))
                }
            })
        })
    }
    fn write(&self, out: &mut Out) {
        use Transform as T;
        let name = match self {
            T::Translate(name, ..)
            | T::Scale(name, _)
            | T::Rotate(name, ..)
            | T::Skew(name, ..) => *name,
            T::Perspective(_) => Name::Perspective,
            T::Matrix(_) | T::Deferred(_) => return write_matrix(self.matrix_3d(0.0, 0.0), out),
        };
        let shown = |is_short: bool| match name.name().as_bytes().last() {
            Some(b'X') => 0..1,
            Some(b'Y') => 1..2,
            Some(b'Z') => 2..3,
            Some(b'd') => 0..3,
            _ => 0..if is_short { 1 } else { 2 },
        };
        name.write(out);
        out.push(b'(');
        match self {
            T::Translate(_, x, y, z) => write_list(
                &[x, y, &Lp::Px(*z)][shown(*y == Lp::ZERO)],
                ", ",
                out,
                |it, out| it.write(out),
            ),
            T::Scale(_, all) => write_list(&all[shown(all[0] == all[1])], ", ", out, f32::write),
            T::Skew(_, x, y) => write_list(
                &[Degrees(*x), Degrees(*y)][shown(*y == 0.0)],
                ", ",
                out,
                Degrees::write,
            ),
            T::Perspective(depth) => NoneOr(depth.map(Px)).write(out),
            T::Rotate(_, axis, degrees) => {
                for it in axis.iter().filter(|_| name == Name::Rotate3d) {
                    it.write(out);
                    out.extend_from_slice(b", ");
                }
                Degrees(*degrees).write(out);
            }
            T::Matrix(_) | T::Deferred(_) => {}
        }
        out.push(b')');
    }
    fn lerp(&self, to: &Transform, t: Mixing) -> Option<Transform> {
        use Transform as T;
        let is_3d = self.is_3d() || to.is_3d();
        let common = |a: &Name, b: &Name, flat, deep| {
            if a == b {
                *a
            } else if is_3d {
                deep
            } else {
                flat
            }
        };
        Some(match (self, to) {
            (T::Translate(m, a, b, c), T::Translate(n, d, e, f)) => T::Translate(
                common(m, n, Name::Translate, Name::Translate3d),
                a.lerp(d, t)?,
                b.lerp(e, t)?,
                t.of(*c, *f),
            ),
            (T::Scale(m, a), T::Scale(n, b)) => T::Scale(
                common(m, n, Name::Scale, Name::Scale3d),
                [0, 1, 2].map(|i| t.of_factors(a[i], b[i])),
            ),
            (T::Skew(m, a, b), T::Skew(n, c, d)) if m == n => {
                T::Skew(*m, t.of(*a, *c), t.of(*b, *d))
            }
            (T::Rotate(m, a, from), T::Rotate(n, b, to)) => {
                let name = common(m, n, Name::Rotate, Name::Rotate3d);
                let [from, to] = [(a, from), (b, to)].map(|it| {
                    if unit(it.0.map(f64::from)).is_some() {
                        *it.1
                    } else {
                        0.0
                    }
                });
                let are_parallel = unit(a.map(f64::from))
                    .zip(unit(b.map(f64::from)))
                    .is_some_and(|(a, b)| (0..3).map(|i| a[i] * b[i]).sum::<f64>() > 1.0 - 1e-4);
                if are_parallel || from == 0.0 || to == 0.0 {
                    let axis = unit((if from == 0.0 { b } else { a }).map(f64::from))
                        .filter(|_| from != 0.0 || to != 0.0);
                    return Some(T::Rotate(
                        name,
                        axis.map_or(Z_AXIS, |it| it.map(|it| it as f32)),
                        t.of(from, to),
                    ));
                }
                let [x, y, z, w] = blend_quaternions(quaternion(*a, from), quaternion(*b, to), t);
                let axis = unit([x, y, z].map(|it| {
                    if it.abs() < 1e-6 {
                        0.0
                    } else {
                        f64::from(it as f32)
                    }
                }))
                .map_or(Z_AXIS, |it| it.map(|it| it as f32));
                T::Rotate(
                    name,
                    axis,
                    (2.0 * w.clamp(-1.0, 1.0).acos()).to_degrees() as f32,
                )
            }
            (T::Perspective(a), T::Perspective(b)) => {
                let [a, b] = [a, b].map(|it| it.map_or(0.0, |it| 1.0 / it.max(1.0)));
                T::Perspective(Some(t.of(a, b)).filter(|it| *it > 0.0).map(|it| 1.0 / it))
            }
            (T::Matrix(a), T::Matrix(b)) => T::Matrix(Rc::new(blend_matrices(a, b, t)?)),
            _ => return None,
        })
    }
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct Transforms(pub(crate) NoneOrSpaces<Transform>);

impl Transforms {
    /// What `of_hint` reads, and no author can declare.
    pub(crate) fn hint(matrix: &abi::Matrix) -> [u8; 49] {
        core::array::from_fn(|at| {
            if at == 0 {
                1
            } else {
                b'a' + (matrix[(at - 1) / 8].to_bits() >> ((at - 1) % 8 * 4) & 15) as u8
            }
        })
    }

    pub(crate) fn of_hint(source: &[u8], zoom: f32) -> Option<Transforms> {
        let (&[a, b, c, d, e, f], []) = source.strip_prefix(&[1])?.as_chunks::<8>() else {
            return None;
        };
        let [a, b, c, d, e, f] = [a, b, c, d, e, f].map(|it| {
            f32::from_bits(it.iter().rev().fold(0, |all, it| {
                all << 4 | u32::from(it.wrapping_sub(b'a') & 15)
            }))
        });
        let moved = Transform::Translate(Name::Translate, Lp::Px(e * zoom), Lp::Px(f * zoom), 0.0);
        Some(Transforms(NoneOrSpaces(Rc::new([
            moved,
            Transform::Matrix(Rc::new(extended([a, b, c, d, 0.0, 0.0]))),
        ]))))
    }

    pub(crate) fn matrix_3d(&self, width: f32, height: f32) -> Matrix3d {
        self.0.iter().fold(IDENTITY_3D, |all, one| {
            multiply_3d(&all, &one.matrix_3d(width, height))
        })
    }

    pub(crate) fn matrix(&self, width: f32, height: f32) -> abi::Matrix {
        match &self.0[..] {
            [only] => only.matrix(width, height),
            all if all.iter().any(Transform::is_3d) => flattened(&self.matrix_3d(width, height)),
            all => all.iter().fold(crate::types::IDENTITY, |all, one| {
                multiply(&all, &one.matrix(width, height))
            }),
        }
    }
}

impl Css for Transforms {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        NoneOrSpaces::parse(p, cx).map(Transforms)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let (from, to) = (&self.0[..], &to.0[..]);
        if t == Mixing::Add {
            return Some(Transforms(NoneOrSpaces(
                from.iter().chain(to).cloned().collect(),
            )));
        }
        let mut list = Vec::with_capacity(from.len().max(to.len()));
        for index in 0..from.len().max(to.len()) {
            let pair = match (from.get(index), to.get(index)) {
                (Some(a), Some(b)) => a.lerp(b, t),
                (Some(a), None) => a.lerp(&a.neutral(), t),
                (None, b) => b.and_then(|b| b.neutral().lerp(b, t)),
            };
            let Some(pair) = pair else {
                let [from, to] = [from, to]
                    .map(|it| Transforms(NoneOrSpaces(it.get(index..).unwrap_or_default().into())));
                list.push(
                    match from
                        .0
                        .iter()
                        .chain(to.0.iter())
                        .any(Transform::has_percentage)
                    {
                        true => Transform::Deferred(Rc::new((from, to, t))),
                        false => Transform::Matrix(Rc::new(blend_matrices(
                            &from.matrix_3d(0.0, 0.0),
                            &to.matrix_3d(0.0, 0.0),
                            t,
                        )?)),
                    },
                );
                break;
            };
            list.push(pair);
        }
        Some(Transforms(NoneOrSpaces(list.into())))
    }
}

macro_rules! individual_transform {
    ($name:ident, |$p:ident, $cx:ident| $parse:expr, |$out:ident| $pattern:pat => $write:expr) => {
        #[derive(Clone, PartialEq)]
        pub(crate) struct $name(pub(crate) Option<Transform>);
        impl Css for $name {
            fn parse($p: &mut P, $cx: &Ctx) -> Option<Self> {
                match keyword($p, "none") {
                    true => Some($name(None)),
                    false => Some($name(Some($parse))),
                }
            }
            fn write(&self, $out: &mut Out) {
                match &self.0 {
                    Some($pattern) => $write,
                    _ => $out.extend_from_slice(b"none"),
                }
            }
            fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
                Some($name(match (&self.0, &to.0) {
                    (Some(a), Some(b)) => Some(a.lerp(b, t)?),
                    (Some(a), None) => Some(a.lerp(&a.neutral(), t)?),
                    (None, Some(b)) => Some(b.neutral().lerp(b, t)?),
                    (None, None) => None,
                }))
            }
        }
    };
}

individual_transform!(Translate, |p, cx| {
    let x = Lp::parse(p, cx)?;
    let y = Lp::parse(p, cx).unwrap_or(Lp::ZERO);
    Transform::Translate(Name::Translate3d, x, y, px(p, cx).unwrap_or(0.0))
}, |out| Transform::Translate(_, x, y, z) => {
    let count = if *z != 0.0 { 3 } else if *y != Lp::ZERO { 2 } else { 1 };
    write_list(&[x, y, &Lp::Px(*z)][..count], " ", out, |it, out| it.write(out));
});

individual_transform!(Scale, |p, cx| {
    let x = number_or_percentage(p, cx)?;
    let y = number_or_percentage(p, cx).unwrap_or(x);
    Transform::Scale(Name::Scale3d, [x, y, number_or_percentage(p, cx).unwrap_or(1.0)])
}, |out| Transform::Scale(_, all) => {
    write_list(&all[..if all[2] != 1.0 { 3 } else if all[0] != all[1] { 2 } else { 1 }], " ", out, f32::write);
});

individual_transform!(Rotate, |p, cx| {
    let angle = |p: &mut P| quantity(p, cx, Kind::Angle, f32::MIN).map(|it| it.clamp(-MAX_DEGREES, MAX_DEGREES));
    let before = angle(p);
    let axis = match () {
        () if keyword(p, "x") => [1.0, 0.0, 0.0],
        () if keyword(p, "y") => [0.0, 1.0, 0.0],
        () if keyword(p, "z") => Z_AXIS,
        () => attempt(p, |p| Some([number(p, cx)?, number(p, cx)?, number(p, cx)?])).unwrap_or(Z_AXIS),
    };
    Transform::Rotate(Name::Rotate3d, axis, before.or_else(|| angle(p))?)
}, |out| Transform::Rotate(_, axis, degrees) => {
    let (name, along) = match *axis {
        [x, 0.0, 0.0] if x != 0.0 => ("x ", x),
        [0.0, y, 0.0] if y != 0.0 => ("y ", y),
        [0.0, 0.0, z] if z != 0.0 => ("", z),
        _ => {
            write_list(axis, " ", out, f32::write);
            (" ", 1.0)
        }
    };
    out.extend_from_slice(name.as_bytes());
    Degrees(degrees * along.signum()).write(out);
});

#[derive(Clone, PartialEq)]
pub(crate) struct TransformOrigin(pub(crate) Position, pub(crate) f32);

impl Css for TransformOrigin {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Some(TransformOrigin(
            Position::parse_short(p, cx)?,
            px(p, cx).unwrap_or(0.0),
        ))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
        if self.1 != 0.0 {
            out.push(b' ');
            write_px(self.1, out);
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(TransformOrigin(self.0.lerp(&to.0, t)?, t.of(self.1, to.1)))
    }
}
