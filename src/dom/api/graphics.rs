//! What the interfaces for graphics share.

use bun_jsc::DOMExceptionCode;
use bun_jsc::bindgen::{Error, IntoError, JsHeap};

use crate::generated_bindgen::geometry::DOMMatrix2DInit;

/// An exception that takes no heap to describe.
#[derive(Clone, Copy)]
pub(crate) enum Failure {
    Dom(DOMExceptionCode, &'static str),
    Range(&'static str),
    Type(&'static str),
}

impl Failure {
    pub(crate) const fn index_size(message: &'static str) -> Failure {
        Failure::Dom(DOMExceptionCode::IndexSizeError, message)
    }

    pub(crate) const fn invalid_state(message: &'static str) -> Failure {
        Failure::Dom(DOMExceptionCode::InvalidStateError, message)
    }
}

impl<'a> IntoError<'a> for Failure {
    #[cold]
    fn into_error(self, heap: &JsHeap<'a>) -> Error<'a> {
        match self {
            Failure::Dom(code, message) => heap.dom_exception(code, format_args!("{message}")),
            Failure::Range(message) => heap.range_error(format_args!("{message}")),
            Failure::Type(message) => heap.type_error(format_args!("{message}")),
        }
    }
}

#[inline]
pub(crate) fn are_finite<const N: usize>(numbers: [f64; N]) -> bool {
    numbers
        .into_iter()
        .fold(true, |all, it| all & it.is_finite())
}

/// `[a, b, c, d, e, f]`
#[derive(Clone, Copy)]
pub(crate) struct Affine(pub(crate) [f64; 6]);

impl Default for Affine {
    fn default() -> Affine {
        Affine([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    }
}

impl Affine {
    /// https://drafts.fxtf.org/geometry/#matrix-validate-and-fixup-2d
    pub(crate) fn from_init(init: &DOMMatrix2DInit) -> Result<Affine, Failure> {
        let pairs = [
            (init.a, init.m11),
            (init.b, init.m12),
            (init.c, init.m21),
            (init.d, init.m22),
            (init.e, init.m41),
            (init.f, init.m42),
        ];
        let mut matrix = Affine::default();
        for (value, pair) in matrix.0.iter_mut().zip(pairs) {
            if let (Some(short), Some(long)) = pair
                && short != long
                && !(short.is_nan() && long.is_nan())
            {
                return Err(Failure::Type(
                    "Two names for the same member of the matrix disagree.",
                ));
            }
            *value = pair.1.or(pair.0).unwrap_or(*value);
        }
        Ok(matrix)
    }

    #[inline]
    pub(crate) fn map(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.0;
        [a * x + c * y + e, b * x + d * y + f]
    }

    pub(crate) fn inverse(&self) -> Option<Affine> {
        let [a, b, c, d, e, f] = self.0;
        let determinant = Some(a * d - b * c).filter(|it| *it != 0.0 && it.is_finite())?;
        Some(Affine(
            [d, -b, -c, a, c * f - d * e, b * e - a * f].map(|it| it / determinant),
        ))
    }

    pub(crate) fn unmap(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        let [a, b, c, d, e, f] = self.0;
        [d * (x - e) - c * (y - f), a * (y - f) - b * (x - e)].map(|it| it / (a * d - b * c))
    }

    /// What it is given applies first.
    #[inline]
    pub(crate) fn then(&self, [a, b, c, d, e, f]: [f64; 6]) -> Affine {
        let (m, [x, y]) = (self.0, self.map([e, f]));
        Affine([
            m[0] * a + m[2] * b,
            m[1] * a + m[3] * b,
            m[0] * c + m[2] * d,
            m[1] * c + m[3] * d,
            x,
            y,
        ])
    }

    pub(crate) fn narrow(&self) -> crate::abi::Matrix {
        self.0.map(|it| it as f32)
    }
}

pub(crate) fn can_draw() -> bool {
    crate::platform::graphics().is_some()
}
