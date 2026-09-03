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

/// `NSRange`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Range {
    pub location: usize,
    pub length: usize,
}

/// `MTLClearColor`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClearColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

/// `MTLOrigin`: a texel position.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Origin3 {
    pub x: usize,
    pub y: usize,
    pub z: usize,
}

/// `MTLSize`: a texel extent, or a thread / threadgroup count.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Size3 {
    pub w: usize,
    pub h: usize,
    pub d: usize,
}

/// `MTLRegion`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Region {
    pub origin: Origin3,
    pub size: Size3,
}

impl Region {
    /// `MTLRegionMake2D`.
    pub const fn new_2d(x: usize, y: usize, w: usize, h: usize) -> Region {
        Region {
            origin: Origin3 { x, y, z: 0 },
            size: Size3 { w, h, d: 1 },
        }
    }
}

/// `MTLViewport`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub znear: f64,
    pub zfar: f64,
}

/// `MTLScissorRect`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScissorRect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}
