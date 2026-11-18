//! Points, transforms, paths and pixels.

use std::alloc::{Layout, alloc_zeroed};
use std::mem::MaybeUninit;
use std::ptr::NonNull;
use std::sync::Arc;

use std::ops::{Add, Mul, Neg, Sub};

#[path = "gfx/stroke.rs"]
mod stroke;

pub use stroke::{Cap, Join, Stroke, length};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub const ZERO: Point = Point::new(0., 0.);

    pub const fn new(x: f32, y: f32) -> Point {
        Point { x, y }
    }

    pub fn dot(self, other: Point) -> f32 {
        self.x * other.x + self.y * other.y
    }

    pub fn cross(self, other: Point) -> f32 {
        self.x * other.y - self.y * other.x
    }

    pub fn lerp(self, other: Point, t: f32) -> Point {
        self + (other - self) * t
    }
}

impl From<[f32; 2]> for Point {
    fn from([x, y]: [f32; 2]) -> Point {
        Point { x, y }
    }
}

impl Add for Point {
    type Output = Point;

    fn add(self, other: Point) -> Point {
        Point::new(self.x + other.x, self.y + other.y)
    }
}

impl Sub for Point {
    type Output = Point;

    fn sub(self, other: Point) -> Point {
        Point::new(self.x - other.x, self.y - other.y)
    }
}

impl Mul<f32> for Point {
    type Output = Point;

    fn mul(self, by: f32) -> Point {
        Point::new(self.x * by, self.y * by)
    }
}

impl Neg for Point {
    type Output = Point;

    fn neg(self) -> Point {
        Point::new(-self.x, -self.y)
    }
}

/// `x` becomes `sx * x + kx * y + tx`, and `y` becomes `ky * x + sy * y + ty`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    pub sx: f32,
    pub ky: f32,
    pub kx: f32,
    pub sy: f32,
    pub tx: f32,
    pub ty: f32,
}

impl Default for Transform {
    fn default() -> Transform {
        Transform::identity()
    }
}

impl Transform {
    pub const fn from_row(sx: f32, ky: f32, kx: f32, sy: f32, tx: f32, ty: f32) -> Transform {
        Transform {
            sx,
            ky,
            kx,
            sy,
            tx,
            ty,
        }
    }

    pub const fn identity() -> Transform {
        Transform::from_scale(1., 1.)
    }

    pub const fn from_scale(x: f32, y: f32) -> Transform {
        Transform::from_row(x, 0., 0., y, 0., 0.)
    }

    pub const fn from_translate(x: f32, y: f32) -> Transform {
        Transform::from_row(1., 0., 0., 1., x, y)
    }

    pub fn is_finite(&self) -> bool {
        [self.sx, self.ky, self.kx, self.sy, self.tx, self.ty]
            .iter()
            .all(|it| it.is_finite())
    }

    pub fn has_skew(&self) -> bool {
        self.kx != 0. || self.ky != 0.
    }

    pub fn get_scale(&self) -> (f32, f32) {
        (
            (self.sx * self.sx + self.kx * self.kx).sqrt(),
            (self.ky * self.ky + self.sy * self.sy).sqrt(),
        )
    }

    pub fn map(&self, point: Point) -> Point {
        Point::new(
            point.x * self.sx + point.y * self.kx + self.tx,
            point.x * self.ky + point.y * self.sy + self.ty,
        )
    }

    /// `other` is applied first.
    pub fn pre_concat(&self, other: Transform) -> Transform {
        if !self.has_skew() && !other.has_skew() {
            let (tx, ty) = (self.sx * other.tx + self.tx, self.sy * other.ty + self.ty);
            return Transform::from_row(self.sx * other.sx, 0., 0., self.sy * other.sy, tx, ty);
        }
        let sum = |a: f32, b: f32, c: f32, d: f32| {
            (f64::from(a) * f64::from(b) + f64::from(c) * f64::from(d)) as f32
        };
        Transform {
            sx: sum(self.sx, other.sx, self.kx, other.ky),
            ky: sum(self.ky, other.sx, self.sy, other.ky),
            kx: sum(self.sx, other.kx, self.kx, other.sy),
            sy: sum(self.ky, other.kx, self.sy, other.sy),
            tx: sum(self.sx, other.tx, self.kx, other.ty) + self.tx,
            ty: sum(self.ky, other.tx, self.sy, other.ty) + self.ty,
        }
    }

    pub fn pre_translate(&self, x: f32, y: f32) -> Transform {
        self.pre_concat(Transform::from_translate(x, y))
    }

    pub fn pre_scale(&self, x: f32, y: f32) -> Transform {
        self.pre_concat(Transform::from_scale(x, y))
    }

    pub fn post_translate(&self, x: f32, y: f32) -> Transform {
        Transform {
            tx: self.tx + x,
            ty: self.ty + y,
            ..*self
        }
    }

    pub fn post_scale(&self, x: f32, y: f32) -> Transform {
        Transform::from_scale(x, y).pre_concat(*self)
    }

    pub fn invert(&self) -> Option<Transform> {
        if !self.has_skew() {
            let (x, y) = (1. / self.sx, 1. / self.sy);
            return Some(Transform::from_row(
                x,
                0.,
                0.,
                y,
                -self.tx * x,
                -self.ty * y,
            ))
            .filter(Transform::is_finite);
        }
        let [sx, ky, kx, sy, tx, ty] =
            [self.sx, self.ky, self.kx, self.sy, self.tx, self.ty].map(f64::from);
        let determinant =
            Some(sx * sy - kx * ky).filter(|it| it.abs() > 1. / (1u64 << 36) as f64)?;
        let [sx, ky, kx, sy, tx, ty] = [sy, -ky, -kx, sx, kx * ty - sy * tx, ky * tx - sx * ty]
            .map(|it| (it / determinant) as f32);
        Some(Transform {
            sx,
            ky,
            kx,
            sy,
            tx,
            ty,
        })
        .filter(Transform::is_finite)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Command {
    MoveTo(Point),
    LineTo(Point),
    QuadTo(Point, Point),
    CurveTo(Point, Point, Point),
    Close,
}

impl Command {
    pub fn transform(&self, by: &Transform) -> Command {
        match *self {
            Command::MoveTo(to) => Command::MoveTo(by.map(to)),
            Command::LineTo(to) => Command::LineTo(by.map(to)),
            Command::QuadTo(a, to) => Command::QuadTo(by.map(a), by.map(to)),
            Command::CurveTo(a, b, to) => Command::CurveTo(by.map(a), by.map(b), by.map(to)),
            Command::Close => Command::Close,
        }
    }
}

pub type Path = Vec<Command>;

pub trait PathBuilder {
    fn add(&mut self, command: Command) -> &mut Self;

    fn move_to(&mut self, to: impl Into<Point>) -> &mut Self {
        self.add(Command::MoveTo(to.into()))
    }

    fn line_to(&mut self, to: impl Into<Point>) -> &mut Self {
        self.add(Command::LineTo(to.into()))
    }

    #[cfg(target_os = "macos")]
    fn quad_to(&mut self, a: impl Into<Point>, to: impl Into<Point>) -> &mut Self {
        self.add(Command::QuadTo(a.into(), to.into()))
    }

    fn curve_to(
        &mut self,
        a: impl Into<Point>,
        b: impl Into<Point>,
        to: impl Into<Point>,
    ) -> &mut Self {
        self.add(Command::CurveTo(a.into(), b.into(), to.into()))
    }

    fn close(&mut self) -> &mut Self {
        self.add(Command::Close)
    }
}

impl PathBuilder for Path {
    fn add(&mut self, command: Command) -> &mut Path {
        self.push(command);
        self
    }
}

/// With the control points.
pub fn bounds(path: &[Command]) -> crate::abi::Rect {
    let (mut low, mut high) = (
        Point::new(f32::MAX, f32::MAX),
        Point::new(f32::MIN, f32::MIN),
    );
    let mut add = |points: &[Point]| {
        for point in points {
            (low, high) = (
                Point::new(low.x.min(point.x), low.y.min(point.y)),
                Point::new(high.x.max(point.x), high.y.max(point.y)),
            );
        }
    };
    for command in path {
        match *command {
            Command::MoveTo(to) | Command::LineTo(to) => add(&[to]),
            Command::QuadTo(a, to) => add(&[a, to]),
            Command::CurveTo(a, b, to) => add(&[a, b, to]),
            Command::Close => {}
        }
    }
    match low.x <= high.x && low.y <= high.y {
        true => crate::abi::Rect {
            x: low.x,
            y: low.y,
            width: high.x - low.x,
            height: high.y - low.y,
        },
        false => crate::abi::Rect::default(),
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Fill {
    NonZero,
    EvenOdd,
}

pub enum Style<'a> {
    Fill(Fill),
    Stroke(Stroke<'a>),
}

impl From<Fill> for Style<'_> {
    fn from(fill: Fill) -> Self {
        Style::Fill(fill)
    }
}

impl<'a> From<Stroke<'a>> for Style<'a> {
    fn from(stroke: Stroke<'a>) -> Self {
        Style::Stroke(stroke)
    }
}

/// Premultiplied RGBA. It is never empty.
pub struct Pixmap {
    width: u32,
    height: u32,
    data: Data,
}

enum Data {
    Own(Vec<u8>),
    /// Until somebody writes.
    Shared(Arc<Vec<u8>>),
}

/// `write` initializes the pixels that it gets, with the number of the first.
fn written(len: usize, write: impl Fn(usize, &mut [MaybeUninit<u8>]) + Sync) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(len);
    crate::parallel::in_bands(
        &mut bytes.spare_capacity_mut()[..len],
        4,
        len as i64 / 4,
        write,
    );
    // SAFETY: the bands are all of it.
    unsafe { bytes.set_len(len) };
    bytes
}

impl Pixmap {
    fn len(width: u32, height: u32) -> Option<usize> {
        let fits = (1..1 << 29).contains(&width) && (1..1 << 29).contains(&height);
        fits.then(|| width as usize * height as usize * 4)
    }

    /// `None` if it is empty, or if there is no memory.
    pub fn new(width: u32, height: u32) -> Option<Pixmap> {
        let len = Pixmap::len(width, height)?;
        // SAFETY: the size is not zero.
        let bytes = NonNull::new(unsafe { alloc_zeroed(Layout::array::<u8>(len).ok()?) })?;
        // SAFETY: the global allocator has made it with the layout of that many bytes, which are initialized.
        Some(Pixmap {
            width,
            height,
            data: Data::Own(unsafe { Vec::from_raw_parts(bytes.as_ptr(), len, len) }),
        })
    }

    pub fn from_vec(data: Vec<u8>, width: u32, height: u32) -> Option<Pixmap> {
        (Pixmap::len(width, height)? == data.len()).then_some(Pixmap {
            width,
            height,
            data: Data::Own(data),
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    #[inline]
    pub fn data(&self) -> &[u8] {
        match &self.data {
            Data::Own(data) => data,
            Data::Shared(data) => data,
        }
    }

    #[inline]
    pub fn data_mut(&mut self) -> &mut [u8] {
        if let Data::Shared(_) = self.data {
            self.stop_sharing();
        }
        match &mut self.data {
            Data::Own(data) => data,
            Data::Shared(_) => &mut [],
        }
    }

    #[cold]
    fn stop_sharing(&mut self) {
        if let Data::Shared(data) = std::mem::replace(&mut self.data, Data::Own(Vec::new())) {
            self.data = Data::Own(Arc::try_unwrap(data).unwrap_or_else(|it| {
                written(it.len(), |first, to| {
                    _ = to.write_copy_of_slice(&it[first * 4..][..to.len()])
                })
            }));
        }
    }

    /// From now on, `shared` has an answer.
    pub fn allow_sharing(&mut self) {
        if let Data::Own(data) = &mut self.data {
            self.data = Data::Shared(Arc::new(std::mem::take(data)));
        }
    }

    pub fn shared(&self) -> Option<Pixmap> {
        let Data::Shared(data) = &self.data else {
            return None;
        };
        Some(Pixmap {
            data: Data::Shared(data.clone()),
            ..*self
        })
    }

    /// False if that is no better than writing to the pixels.
    pub fn fill_instead_of_copying(&mut self, pixel: [u8; 4]) -> bool {
        let is_shared = matches!(&self.data, Data::Shared(data) if Arc::strong_count(data) > 1);
        if is_shared {
            self.data = Data::Own(written(self.data().len(), |_, to| {
                to.as_chunks_mut().0.fill(pixel.map(MaybeUninit::new))
            }));
        }
        is_shared
    }

    /// The part of the rectangle that is inside.
    pub fn cropped(&self, left: i32, top: i32, right: i32, bottom: i32) -> Option<Pixmap> {
        let ([left, right], [top, bottom]) = (
            [left, right].map(|it| it.clamp(0, self.width as i32) as usize),
            [top, bottom].map(|it| it.clamp(0, self.height as i32) as usize),
        );
        let (width, height) = (right.checked_sub(left)?, bottom.checked_sub(top)?);
        let mut data = Vec::with_capacity(width * height * 4);
        let rows = self
            .data()
            .chunks(self.width as usize * 4)
            .skip(top)
            .take(height);
        rows.for_each(|row| data.extend_from_slice(&row[left * 4..right * 4]));
        Pixmap::from_vec(data, width as u32, height as u32)
    }
}
