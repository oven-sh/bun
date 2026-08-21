//! CoreGraphics value types. `CGFloat` is `f64` on every 64-bit Apple target.

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub origin: Point,
    pub size: Size,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            origin: Point { x, y },
            size: Size { width, height },
        }
    }
}

/// `NSEdgeInsets`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Insets {
    pub top: f64,
    pub left: f64,
    pub bottom: f64,
    pub right: f64,
}

impl Insets {
    pub const fn uniform(v: f64) -> Insets {
        Insets {
            top: v,
            left: v,
            bottom: v,
            right: v,
        }
    }
}

/// A finite length greater than zero.
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
pub struct Positive(f64);

impl Positive {
    pub fn new(v: f64) -> Option<Positive> {
        (v.is_finite() && v > 0.0).then_some(Positive(v))
    }

    #[inline]
    pub fn get(self) -> f64 {
        self.0
    }
}
