//! The arithmetic of `DOMMatrix`.

use crate::calc::Node;
use crate::transform::{
    IDENTITY_3D, Matrix3d, Name, invert_3d, multiply_3d, rotation_3d, specified_functions,
};
use crate::values::Ctx;

/// Where `a` to `f` are.
pub(crate) const FLAT: [usize; 6] = [0, 1, 4, 5, 12, 13];

#[derive(Clone, Copy)]
pub(crate) struct Matrix {
    pub(crate) m: Matrix3d,
    pub(crate) is_2d: bool,
}

impl Matrix {
    pub(crate) const IDENTITY: Matrix = Matrix {
        m: IDENTITY_3D,
        is_2d: true,
    };

    pub(crate) fn from_2d(values: [f64; 6]) -> Matrix {
        let mut matrix = Matrix::IDENTITY;
        FLAT.into_iter()
            .zip(values)
            .for_each(|(at, value)| matrix.m[at] = value);
        matrix
    }

    /// `None` unless there are 6 or 16.
    pub(crate) fn from_values(values: &[f64]) -> Option<Matrix> {
        match values.try_into() {
            Ok(values) => Some(Matrix::from_2d(values)),
            Err(_) => Some(Matrix {
                m: values.try_into().ok()?,
                is_2d: false,
            }),
        }
    }

    /// <https://drafts.csswg.org/geometry/#parse-a-string-into-an-abstract-matrix>
    pub(crate) fn parse(source: &[u8]) -> Option<Matrix> {
        let (cx, mut matrix) = (Ctx::dummy(), Matrix::IDENTITY);
        if source.is_empty() {
            return Some(matrix);
        }
        for (name, arguments) in specified_functions(source)? {
            let is_translation = matches!(
                name,
                Name::Translate | Name::TranslateX | Name::TranslateY | Name::Translate3d
            );
            (!(is_translation && arguments.iter().any(Node::has_percentage))).then_some(())?;
            let values: Vec<_> = arguments.iter().map(|it| it.compute(&cx, 1.0)).collect();
            let at = |index: usize, or: f64| values.get(index).copied().unwrap_or(or);
            let x = at(0, 0.0);
            match name {
                Name::Matrix | Name::Matrix3d => matrix.multiply(&Matrix::from_values(&values)?),
                Name::Translate | Name::TranslateX | Name::Translate3d => {
                    matrix.translate(x, at(1, 0.0), at(2, 0.0))
                }
                Name::TranslateY => matrix.translate(0.0, x, 0.0),
                Name::TranslateZ => matrix.translate(0.0, 0.0, x),
                Name::Scale | Name::Scale3d => matrix.scale([x, at(1, x), at(2, 1.0)], [0.0; 3]),
                Name::ScaleX => matrix.scale([x, 1.0, 1.0], [0.0; 3]),
                Name::ScaleY => matrix.scale([1.0, x, 1.0], [0.0; 3]),
                Name::ScaleZ => matrix.scale([1.0, 1.0, x], [0.0; 3]),
                Name::Rotate | Name::RotateZ => matrix.rotate_axis_angle([0.0, 0.0, 1.0], x),
                Name::RotateX => matrix.rotate_axis_angle([1.0, 0.0, 0.0], x),
                Name::RotateY => matrix.rotate_axis_angle([0.0, 1.0, 0.0], x),
                Name::Rotate3d => matrix.rotate_axis_angle([x, at(1, 0.0), at(2, 0.0)], at(3, 0.0)),
                Name::Skew | Name::SkewX => matrix.skew(x, at(1, 0.0)),
                Name::SkewY => matrix.skew(0.0, x),
                Name::Perspective => matrix.perspective(values.first().map(|it| it.max(1.0))),
            }
            matrix.is_2d &= !name.is_3d();
        }
        cx.deps.get().is_empty().then_some(matrix)
    }

    pub(super) fn to_record(self) -> impl Iterator<Item = f64> {
        self.m.into_iter().chain([self.is_2d.into()])
    }

    pub(super) fn from_record(values: &[f64]) -> Matrix {
        let matrix = Matrix {
            m: core::array::from_fn(|it| values[it]),
            is_2d: false,
        };
        if values[16] == 0.0 {
            matrix
        } else {
            Matrix::from_2d(matrix.flat())
        }
    }

    /// 6 or 16
    pub(crate) fn values(&self) -> Vec<f64> {
        if self.is_2d {
            self.flat().into()
        } else {
            self.m.into()
        }
    }

    pub(crate) fn flat(&self) -> [f64; 6] {
        FLAT.map(|at| self.m[at])
    }

    pub(crate) fn is_finite(&self) -> bool {
        self.m.iter().all(|it| it.is_finite())
    }

    pub(crate) fn set(&mut self, at: usize, value: f64) {
        self.m[at] = value;
        self.is_2d &= FLAT.contains(&at) || value == IDENTITY_3D[at];
    }

    /// `other` is applied first.
    pub(crate) fn multiply(&mut self, other: &Matrix) {
        self.m = multiply_3d(&self.m, &other.m);
        self.is_2d &= other.is_2d;
    }

    pub(crate) fn translate(&mut self, x: f64, y: f64, z: f64) {
        let mut other = Matrix {
            is_2d: z == 0.0,
            ..Matrix::IDENTITY
        };
        other.m[12..15].copy_from_slice(&[x, y, z]);
        self.multiply(&other);
    }

    pub(crate) fn scale(&mut self, [x, y, z]: [f64; 3], origin: [f64; 3]) {
        let mut other = Matrix {
            is_2d: z == 1.0,
            ..Matrix::IDENTITY
        };
        (other.m[0], other.m[5], other.m[10]) = (x, y, z);
        self.translate(origin[0], origin[1], origin[2]);
        self.multiply(&other);
        self.translate(-origin[0], -origin[1], -origin[2]);
    }

    pub(crate) fn rotate(&mut self, x: f64, y: f64, z: f64) {
        for (axis, degrees, is_2d) in [
            ([0.0, 0.0, 1.0], z, true),
            ([0.0, 1.0, 0.0], y, y == 0.0),
            ([1.0, 0.0, 0.0], x, x == 0.0),
        ] {
            self.multiply(&Matrix {
                m: rotation_3d(axis, degrees),
                is_2d,
            });
        }
    }

    pub(crate) fn rotate_axis_angle(&mut self, axis: [f64; 3], degrees: f64) {
        self.multiply(&Matrix {
            m: rotation_3d(axis, degrees),
            is_2d: axis[0] == 0.0 && axis[1] == 0.0,
        });
    }

    pub(crate) fn skew(&mut self, x: f64, y: f64) {
        self.multiply(&Matrix::from_2d([
            1.0,
            y.to_radians().tan(),
            x.to_radians().tan(),
            1.0,
            0.0,
            0.0,
        ]));
    }

    pub(crate) fn perspective(&mut self, distance: Option<f64>) {
        let mut other = Matrix {
            is_2d: false,
            ..Matrix::IDENTITY
        };
        other.m[11] = distance.map_or(0.0, |it| -1.0 / it);
        self.multiply(&other);
    }

    pub(crate) fn invert(&mut self) {
        let [a, b, c, d, e, f] = self.flat();
        let determinant = a * d - b * c;
        let inverse = match self.is_2d {
            _ if !self.is_finite() => None,
            true => (determinant != 0.0).then(|| {
                Matrix::from_2d(
                    [d, -b, -c, a, c * f - d * e, b * e - a * f].map(|it| it / determinant),
                )
            }),
            false => invert_3d(&self.m).map(|m| Matrix { m, is_2d: false }),
        };
        *self = inverse.unwrap_or(Matrix {
            m: [f64::NAN; 16],
            is_2d: false,
        });
    }

    pub(crate) fn transform(&self, [x, y, z, w]: [f64; 4]) -> [f64; 4] {
        core::array::from_fn(|row| {
            self.m[row] * x + self.m[4 + row] * y + self.m[8 + row] * z + self.m[12 + row] * w
        })
    }
}
