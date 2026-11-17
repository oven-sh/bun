//! <https://drafts.csswg.org/geometry/>

mod matrix;

use core::cell::Cell;

use bun_jsc::bindgen::{
    ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result, TypedArray, to_js,
};
use bun_jsc::{DOMExceptionCode, JSValue};

use crate::api::core::List;
use crate::api::typed::numeric::{max, min};
use crate::generated_bindgen::geometry::*;
pub(crate) use crate::generated_bindgen::geometry::{
    DOMMatrix, DOMMatrix2DInit, DOMMatrixInit, DOMMatrixReadOnly, DOMPoint, DOMQuad, DOMRect,
};
use crate::transform::IDENTITY_3D;
use crate::values::{Out, write_list};
use matrix::FLAT;
pub(crate) use matrix::Matrix;

fn read_doubles<'a>(cx: &mut JsScope<'a>, clone: JsLocal<'a>, count: u32) -> Result<'a, Vec<f64>> {
    let global = cx.global();
    (0..count)
        .map(|it| Ok(clone.to_js().get_index(global, it)?.to_number(global)?))
        .collect()
}

macro_rules! serializable {
    ($($Class:ident $count:literal |$this:ident| $write:expr, |$heap:ident, $values:ident| $read:expr;)+) => {
        $(impl $Class {
            pub(crate) fn serialize<'a>(&self, cx: &mut JsScope<'a>, _: bool) -> Result<'a, JsLocal<'a>> {
                let $this = self;
                to_js::array(&cx.heap, $write, to_js::f64)
            }

            pub(crate) fn deserialize<'a>(cx: &mut JsScope<'a>, clone: JsLocal<'a>) -> Result<'a, &'a Self> {
                let ($values, $heap) = (read_doubles(cx, clone, $count)?, &cx.heap);
                Ok($read)
            }
        })+
    };
}

fn four(values: &[f64]) -> [f64; 4] {
    core::array::from_fn(|it| values[it])
}

serializable! {
    DOMPointReadOnly 4 |it| it.values(), |heap, all| DOMPointReadOnly::new(heap, four(&all));
    DOMPoint 4 |it| it.values(), |heap, all| DOMPoint::new(heap, four(&all));
    DOMRectReadOnly 4 |it| it.values(), |heap, all| DOMRectReadOnly::new(heap, four(&all));
    DOMRect 4 |it| it.values(), |heap, all| DOMRect::new(heap, four(&all));
    DOMQuad 16 |it| it.points().concat(), |heap, all| DOMQuad::new(heap, &core::array::from_fn(|it| four(&all[it * 4..])));
    DOMMatrixReadOnly 17 |it| it.matrix().to_record(), |heap, all| DOMMatrixReadOnly::new(heap, Matrix::from_record(&all));
    DOMMatrix 17 |it| it.matrix().to_record(), |heap, all| DOMMatrix::new(heap, Matrix::from_record(&all));
}

macro_rules! coordinates {
    ($Base:ident $Mutable:ident $($index:literal $get:ident $set:ident)+) => {
        impl $Base {
            pub(crate) fn constructor(a: f64, b: f64, c: f64, d: f64) -> $Base {
                $Base([a, b, c, d].map(Cell::new))
            }

            pub(crate) fn values(&self) -> [f64; 4] {
                self.0.each_ref().map(Cell::get)
            }
            $(pub(crate) fn $get(&self) -> f64 {
                self.0[$index].get()
            })+
        }

        impl $Mutable {
            pub(crate) fn constructor(a: f64, b: f64, c: f64, d: f64) -> $Base {
                $Base::constructor(a, b, c, d)
            }

            $(pub(crate) fn $get(&self) -> f64 {
                $Base::$get(self)
            }

            pub(crate) fn $set(&self, value: f64) {
                let $Base(values) = &**self;
                values[$index].set(value);
            })+
        }
    };
}

pub(crate) struct DOMPointReadOnly([Cell<f64>; 4]);
coordinates!(DOMPointReadOnly DOMPoint 0 get_x set_x 1 get_y set_y 2 get_z set_z 3 get_w set_w);

pub(crate) struct DOMRectReadOnly([Cell<f64>; 4]);
coordinates!(DOMRectReadOnly DOMRect 0 get_x set_x 1 get_y set_y 2 get_width set_width 3 get_height set_height);

impl DOMPointInit {
    fn values(&self) -> [f64; 4] {
        [self.x, self.y, self.z, self.w]
    }
}

impl DOMRectInit {
    fn values(&self) -> [f64; 4] {
        [self.x, self.y, self.width, self.height]
    }
}

impl DOMPointReadOnly {
    fn new<'a>(heap: &JsHeap<'a>, values: [f64; 4]) -> &'a Self {
        js_DOMPointReadOnly::create(heap, DOMPointReadOnly(values.map(Cell::new)))
    }

    pub(crate) fn from_point<'a>(heap: &JsHeap<'a>, other: &DOMPointInit) -> &'a Self {
        js_DOMPointReadOnly::create(heap, DOMPointReadOnly(other.values().map(Cell::new)))
    }

    pub(crate) fn matrix_transform<'a>(
        &self,
        heap: &JsHeap<'a>,
        matrix: &DOMMatrixInit,
    ) -> Result<'a, &'a DOMPoint> {
        Ok(DOMPoint::new(
            heap,
            matrix.fixed(heap)?.transform(self.values()),
        ))
    }
}

impl DOMPoint {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, values: [f64; 4]) -> &'a Self {
        js_DOMPoint::create(heap, DOMPointReadOnly(values.map(Cell::new)))
    }

    pub(crate) fn from_point<'a>(heap: &JsHeap<'a>, other: &DOMPointInit) -> &'a Self {
        DOMPoint::new(heap, other.values())
    }
}

impl DOMRectReadOnly {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, values: [f64; 4]) -> &'a Self {
        js_DOMRectReadOnly::create(heap, DOMRectReadOnly(values.map(Cell::new)))
    }

    pub(crate) fn from_rect<'a>(heap: &JsHeap<'a>, other: &DOMRectInit) -> &'a Self {
        DOMRectReadOnly::new(heap, other.values())
    }

    pub(crate) fn get_top(&self) -> f64 {
        min(self.get_y(), self.get_y() + self.get_height())
    }

    pub(crate) fn get_right(&self) -> f64 {
        max(self.get_x(), self.get_x() + self.get_width())
    }

    pub(crate) fn get_bottom(&self) -> f64 {
        max(self.get_y(), self.get_y() + self.get_height())
    }

    pub(crate) fn get_left(&self) -> f64 {
        min(self.get_x(), self.get_x() + self.get_width())
    }
}

impl DOMRect {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, values: [f64; 4]) -> &'a Self {
        js_DOMRect::create(heap, DOMRectReadOnly(values.map(Cell::new)))
    }

    pub(crate) fn from_rect<'a>(heap: &JsHeap<'a>, other: &DOMRectInit) -> &'a Self {
        DOMRect::new(heap, other.values())
    }
}

pub(crate) struct DOMRectList(u32, bun_jsc::bindgen::Interior);

impl DOMRectList {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, rects: &[[f64; 4]]) -> &'a Self {
        let (this, list) = (
            js_DOMRectList::create(heap, DOMRectList(rects.len() as u32, Default::default())),
            List::with_capacity(heap, rects.len() as u32),
        );
        js_DOMRectList::set_rects(this, list.to_js());
        rects
            .iter()
            .for_each(|it| list.push(heap, DOMRect::new(heap, *it).to_js()));
        this
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.0
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<JSValue> {
        Some(List::from_value(js_DOMRectList::rects(self)?).get(index)).filter(|it| !it.is_empty())
    }

    pub(crate) fn item<'a>(&self, heap: &JsHeap<'a>, index: u32) -> Option<&'a DOMRect> {
        DOMRect::from_js(heap, self.indexed_get(index)?)
    }
}

impl DOMQuad {
    fn fill<'a>(&'a self, heap: &JsHeap<'a>, points: &[[f64; 4]; 4]) -> &'a Self {
        let setters = [
            js_DOMQuad::set_p1,
            js_DOMQuad::set_p2,
            js_DOMQuad::set_p3,
            js_DOMQuad::set_p4,
        ];
        setters
            .into_iter()
            .zip(points)
            .for_each(|(set, point)| set(self, Some(DOMPoint::new(heap, *point))));
        self
    }

    pub(crate) fn new<'a>(heap: &JsHeap<'a>, points: &[[f64; 4]; 4]) -> &'a Self {
        js_DOMQuad::create(heap, DOMQuad::default()).fill(heap, points)
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        p1: &DOMPointInit,
        p2: &DOMPointInit,
        p3: &DOMPointInit,
        p4: &DOMPointInit,
    ) -> &'a Self {
        structure
            .create(heap, DOMQuad::default())
            .fill(heap, &[p1, p2, p3, p4].map(DOMPointInit::values))
    }

    pub(crate) fn from_rect<'a>(heap: &JsHeap<'a>, other: &DOMRectInit) -> &'a Self {
        let [x, y, width, height] = other.values();
        DOMQuad::new(
            heap,
            &[
                [x, y],
                [x + width, y],
                [x + width, y + height],
                [x, y + height],
            ]
            .map(|[x, y]| [x, y, 0.0, 1.0]),
        )
    }

    pub(crate) fn from_quad<'a>(heap: &JsHeap<'a>, other: &DOMQuadInit) -> &'a Self {
        DOMQuad::new(
            heap,
            &[&other.p1, &other.p2, &other.p3, &other.p4].map(DOMPointInit::values),
        )
    }

    fn points(&self) -> [[f64; 4]; 4] {
        [
            js_DOMQuad::p1,
            js_DOMQuad::p2,
            js_DOMQuad::p3,
            js_DOMQuad::p4,
        ]
        .map(|get| get(self).map_or([0.0; 4], |it| it.values()))
    }

    pub(crate) fn get_bounds<'a>(&self, heap: &JsHeap<'a>) -> &'a DOMRect {
        let points = self.points();
        let edge = |axis: usize, pick: fn(f64, f64) -> f64| {
            points[1..]
                .iter()
                .fold(points[0][axis], |all, it| pick(all, it[axis]))
        };
        let (left, top) = (edge(0, min), edge(1, min));
        DOMRect::new(heap, [left, top, edge(0, max) - left, edge(1, max) - top])
    }
}

impl DOMMatrix2DInit {
    /// <https://drafts.csswg.org/geometry/#matrix-validate-and-fixup-2d>
    pub(crate) fn fixed<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, Matrix> {
        let pairs = [
            (self.a, self.m11),
            (self.b, self.m12),
            (self.c, self.m21),
            (self.d, self.m22),
            (self.e, self.m41),
            (self.f, self.m42),
        ];
        let mut matrix = Matrix::IDENTITY;
        for ((short, long), at) in pairs.into_iter().zip(FLAT) {
            if short
                .zip(long)
                .is_some_and(|(a, b)| a != b && !(a.is_nan() && b.is_nan()))
            {
                return Err(
                    heap.type_error(format_args!("Property mismatch on matrix initialization."))
                );
            }
            matrix.m[at] = long.or(short).unwrap_or(matrix.m[at]);
        }
        Ok(matrix)
    }
}

impl DOMMatrixInit {
    /// <https://drafts.csswg.org/geometry/#matrix-validate-and-fixup>
    pub(crate) fn fixed<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, Matrix> {
        let DOMMatrixInit {
            a,
            b,
            c,
            d,
            e,
            f,
            m11,
            m12,
            m21,
            m22,
            m41,
            m42,
            ..
        } = *self;
        let mut matrix = DOMMatrix2DInit {
            a,
            b,
            c,
            d,
            e,
            f,
            m11,
            m12,
            m21,
            m22,
            m41,
            m42,
        }
        .fixed(heap)?;
        let rest = [
            self.m13, self.m14, self.m23, self.m24, self.m31, self.m32, self.m33, self.m34,
            self.m43, self.m44,
        ];
        let rest = [2, 3, 6, 7, 8, 9, 10, 11, 14, 15].into_iter().zip(rest);
        let looks_2d = rest.clone().all(|(at, value)| value == IDENTITY_3D[at]);
        if self.is_2d == Some(true) && !looks_2d {
            return Err(heap.type_error(format_args!(
                "The is2D member is set to true but the input matrix is a 3d matrix."
            )));
        }
        matrix.is_2d = self.is_2d.unwrap_or(looks_2d);
        rest.filter(|_| !matrix.is_2d)
            .for_each(|(at, value)| matrix.m[at] = value);
        Ok(matrix)
    }
}

pub(crate) struct AnyMatrix(Cell<Matrix>);

fn from_sequence<'a>(heap: &JsHeap<'a>, values: &[f64]) -> Result<'a, Matrix> {
    Matrix::from_values(values).ok_or_else(|| {
        heap.type_error(format_args!(
            "The sequence must contain 6 elements for a 2D matrix or 16 elements for a 3D matrix."
        ))
    })
}

fn from_string<'a>(heap: &JsHeap<'a>, source: &[u8]) -> Result<'a, Matrix> {
    Matrix::parse(source).ok_or_else(|| {
        heap.dom_exception(
            DOMExceptionCode::SyntaxError,
            format_args!("Failed to parse '{}'.", bun_core::fmt::s(source)),
        )
    })
}

macro_rules! factories {
    ($($Class:ident $js:ident)+) => {$(
        impl $Class {
            pub(crate) fn new<'a>(heap: &JsHeap<'a>, matrix: Matrix) -> &'a Self {
                $js::create(heap, AnyMatrix(matrix.into()))
            }

            pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, init: Option<MatrixSource<'a>>) -> Result<'a, AnyMatrix> {
                Ok(AnyMatrix(Cell::new(match init {
                    None => Matrix::IDENTITY,
                    Some(MatrixSource::Numbers(values)) => from_sequence(heap, &values)?,
                    Some(MatrixSource::Text(source)) if heap.is_window() => from_string(heap, &source)?,
                    Some(MatrixSource::Text(_)) => return Err(heap.type_error(format_args!("DOMMatrix can't be constructed with strings on workers."))),
                })))
            }

            pub(crate) fn from_matrix<'a>(heap: &JsHeap<'a>, other: &DOMMatrixInit) -> Result<'a, &'a Self> {
                Ok(Self::new(heap, other.fixed(heap)?))
            }

            pub(crate) fn from_float32_array<'a>(heap: &JsHeap<'a>, array: JsLocal<'a, TypedArray<f32>>) -> Result<'a, &'a Self> {
                let values: Vec<_> = array.with_elements(heap, |all| all.iter().take(17).map(|it| f64::from(it.get())).collect());
                Ok(Self::new(heap, from_sequence(heap, &values)?))
            }

            pub(crate) fn from_float64_array<'a>(heap: &JsHeap<'a>, array: JsLocal<'a, TypedArray<f64>>) -> Result<'a, &'a Self> {
                let values: Vec<_> = array.with_elements(heap, |all| all.iter().take(17).map(|it| it.get()).collect());
                Ok(Self::new(heap, from_sequence(heap, &values)?))
            }
        }
    )+};
}
factories!(DOMMatrixReadOnly js_DOMMatrixReadOnly DOMMatrix js_DOMMatrix);

/// One method makes a copy, and the other changes the matrix.
macro_rules! operations {
    ($($copy:ident $in_place:ident ($($argument:ident: $Type:ty),*) |$matrix:ident| $body:expr;)+) => {
        impl DOMMatrixReadOnly {$(
            pub(crate) fn $copy<'a>(&self, heap: &JsHeap<'a> $(, $argument: $Type)*) -> &'a DOMMatrix {
                let copy = DOMMatrix::new(heap, self.matrix());
                copy.$in_place($($argument),*)
            }
        )+}

        impl DOMMatrix {$(
            pub(crate) fn $in_place<'a>(&'a self $(, $argument: $Type)*) -> &'a Self {
                self.change(|$matrix| $body);
                self
            }
        )+}
    };
}

operations! {
    translate translate_self (x: f64, y: f64, z: f64) |it| it.translate(x, y, z);
    scale scale_self (x: f64, y: Option<f64>, z: f64, origin_x: f64, origin_y: f64, origin_z: f64)
        |it| it.scale([x, y.unwrap_or(x), z], [origin_x, origin_y, origin_z]);
    scale3d scale3d_self (by: f64, origin_x: f64, origin_y: f64, origin_z: f64) |it| it.scale([by; 3], [origin_x, origin_y, origin_z]);
    rotate rotate_self (x: f64, y: Option<f64>, z: Option<f64>) |it| match (y, z) {
        (None, None) => it.rotate(0.0, 0.0, x),
        _ => it.rotate(x, y.unwrap_or(0.0), z.unwrap_or(0.0)),
    };
    rotate_from_vector rotate_from_vector_self (x: f64, y: f64) |it| it.rotate(0.0, 0.0, if x == 0.0 && y == 0.0 { 0.0 } else { y.atan2(x).to_degrees() });
    rotate_axis_angle rotate_axis_angle_self (x: f64, y: f64, z: f64, angle: f64) |it| it.rotate_axis_angle([x, y, z], angle);
    skew_x skew_x_self (angle: f64) |it| it.skew(angle, 0.0);
    skew_y skew_y_self (angle: f64) |it| it.skew(0.0, angle);
    inverse invert_self () |it| it.invert();
}

impl AnyMatrix {
    pub(crate) fn matrix(&self) -> Matrix {
        self.0.get()
    }

    fn change(&self, change: impl FnOnce(&mut Matrix)) {
        let mut matrix = self.0.get();
        change(&mut matrix);
        self.0.set(matrix);
    }
}

impl DOMMatrixReadOnly {
    pub(crate) fn get_is_2d(&self) -> bool {
        self.matrix().is_2d
    }

    pub(crate) fn get_is_identity(&self) -> bool {
        self.matrix().m == IDENTITY_3D
    }

    pub(crate) fn scale_non_uniform<'a>(&self, heap: &JsHeap<'a>, x: f64, y: f64) -> &'a DOMMatrix {
        self.scale(heap, x, Some(y), 1.0, 0.0, 0.0, 0.0)
    }

    pub(crate) fn flip_x<'a>(&self, heap: &JsHeap<'a>) -> &'a DOMMatrix {
        self.scale_non_uniform(heap, -1.0, 1.0)
    }

    pub(crate) fn flip_y<'a>(&self, heap: &JsHeap<'a>) -> &'a DOMMatrix {
        self.scale_non_uniform(heap, 1.0, -1.0)
    }

    pub(crate) fn multiply<'a>(
        &self,
        heap: &JsHeap<'a>,
        other: &DOMMatrixInit,
    ) -> Result<'a, &'a DOMMatrix> {
        let copy = DOMMatrix::new(heap, self.matrix());
        copy.multiply_self(heap, other)
    }

    pub(crate) fn transform_point<'a>(
        &self,
        heap: &JsHeap<'a>,
        point: &DOMPointInit,
    ) -> &'a DOMPoint {
        DOMPoint::new(heap, self.matrix().transform(point.values()))
    }

    pub(crate) fn to_float32_array<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, JsLocal<'a, TypedArray<f32>>> {
        heap.create_typed_array(&self.matrix().m.map(|it| it as f32))
    }

    pub(crate) fn to_float64_array<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> Result<'a, JsLocal<'a, TypedArray<f64>>> {
        heap.create_typed_array(&self.matrix().m)
    }

    pub(crate) fn stringify<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, Out> {
        let matrix = self.matrix();
        if !matrix.is_finite() {
            return Err(heap.dom_exception(
                DOMExceptionCode::InvalidStateError,
                format_args!("DOMMatrix cannot be serialized with NaN or Infinity values."),
            ));
        }
        let mut out = Out::from(if matrix.is_2d { "matrix(" } else { "matrix3d(" });
        let write = |it: &f64, out: &mut Out| {
            out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *it))
        };
        write_list(&matrix.values(), ", ", &mut out, write);
        out.push(b')');
        Ok(out)
    }
}

impl MatrixElement {
    pub(crate) fn get(&self, at: usize) -> f64 {
        self.matrix().m[at]
    }

    pub(crate) fn set(&self, at: usize, value: f64) {
        self.change(|it| it.set(at, value));
    }
}

impl DOMMatrix {
    pub(crate) fn multiply_self<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        other: &DOMMatrixInit,
    ) -> Result<'a, &'a Self> {
        let other = other.fixed(heap)?;
        self.change(|it| it.multiply(&other));
        Ok(self)
    }

    pub(crate) fn pre_multiply_self<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        other: &DOMMatrixInit,
    ) -> Result<'a, &'a Self> {
        let mut other = other.fixed(heap)?;
        other.multiply(&self.matrix());
        self.change(|it| *it = other);
        Ok(self)
    }

    pub(crate) fn set_matrix_value<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        source: &[u8],
    ) -> Result<'a, &'a Self> {
        let matrix = from_string(heap, source)?;
        self.change(|it| *it = matrix);
        Ok(self)
    }
}
