//! Canvases and images, between `bun_dom` and the UI library. Both compile this file.
//!
//! Canvases, patterns and images share one space of ids, in which 0 is nothing.
#![allow(dead_code, unreachable_pub)] // Each side uses its half.

use core::ffi::c_void;

use crate::abi::{Filter, GradientStop, Matrix, PathVerb, Rect, Slice, Span};

#[repr(C, u8)]
#[derive(Clone, Copy)]
pub enum Paint {
    Color(u32),
    Linear {
        from: [f32; 2],
        to: [f32; 2],
        stops: Span,
    },
    /// The centers and the radii.
    Radial {
        from: [f32; 3],
        to: [f32; 3],
        stops: Span,
    },
    /// Radians clockwise from the x axis.
    Conic {
        center: [f32; 2],
        start: f32,
        stops: Span,
    },
    Pattern {
        tile: u32,
        repeats: [bool; 2],
        matrix: Matrix,
    },
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Cap {
    Butt,
    Round,
    Square,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Join {
    Miter,
    Round,
    Bevel,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Pen {
    pub width: f32,
    pub miter_limit: f32,
    pub dash_offset: f32,
    pub cap: Cap,
    pub join: Join,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Operator {
    SourceOver,
    SourceIn,
    SourceOut,
    SourceAtop,
    DestinationOver,
    DestinationIn,
    DestinationOut,
    DestinationAtop,
    Lighter,
    Copy,
    Xor,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
    Clear,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Baseline {
    Alphabetic,
    Top,
    Hanging,
    Middle,
    Ideographic,
    Bottom,
}

#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
pub struct TextStyle {
    pub font: u32,
    pub size: f32,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub is_right_to_left: bool,
    pub baseline: Baseline,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct TextMetrics {
    pub width: f32,
    pub ink_left: f32,
    pub ink_right: f32,
    pub ink_ascent: f32,
    pub ink_descent: f32,
    pub font_ascent: f32,
    pub font_descent: f32,
    pub em_ascent: f32,
    pub em_descent: f32,
    pub hanging: f32,
    pub alphabetic: f32,
    pub ideographic: f32,
}

/// `part` of `source`, which is drawn at `size`, becomes the image `id`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Snapshot {
    pub id: u32,
    pub source: u32,
    pub size: [f32; 2],
    pub part: Rect,
    pub to: [u32; 2],
    pub flips: bool,
    pub is_smooth: bool,
    /// Only `Paint::Pattern` can use it.
    pub is_tile: bool,
}

/// Paths are in the pixels of the canvas, and everything else is in the space of the last `Transform`.
#[repr(C, u8)]
#[derive(Clone, Copy)]
pub enum Command {
    Create {
        id: u32,
        size: [u32; 2],
        is_opaque: bool,
        is_read_often: bool,
    },
    Snapshot(Snapshot),
    Release(u32),
    DropFontScope(u32),
    /// The canvas for the commands below.
    Select(u32),
    /// Clears the pixels and the state.
    Reset([u32; 2]),
    /// Clears the pixels.
    Erase,
    Transform(Matrix),
    FillPaint(Paint),
    StrokePaint(Paint),
    Compositing {
        alpha: f32,
        operator: Operator,
    },
    Pen {
        pen: Pen,
        dashes: Span,
    },
    Shadow {
        offset: [f32; 2],
        blur: f32,
        color: u32,
    },
    Smoothing(bool),
    Filters(Span),
    /// With `saves`, `RestoreClip` goes back to the clip before it.
    Clip {
        verbs: Span,
        is_even_odd: bool,
        saves: bool,
    },
    RestoreClip,
    Fill {
        verbs: Span,
        is_even_odd: bool,
    },
    Stroke {
        verbs: Span,
    },
    FillRect(Rect),
    StrokeRect(Rect),
    ClearRect(Rect),
    /// `alignment` is how much of the text is left of `at`.
    Text {
        text: Span,
        style: TextStyle,
        at: [f32; 2],
        alignment: f32,
        max_width: f32,
        strokes: bool,
    },
    Image {
        image: u32,
        size: [f32; 2],
        from: Rect,
        to: Rect,
    },
}

#[repr(C)]
pub struct Commands {
    pub commands: Slice<Command>,
    pub verbs: Slice<PathVerb>,
    pub stops: Slice<GradientStop>,
    pub filters: Slice<Filter>,
    pub dashes: Slice<f32>,
    /// UTF-8.
    pub text: Slice<u8>,
    /// More is on its way before the windows have to show it.
    pub is_partial: bool,
}

/// `[x, y, width, height]`
pub type Area = [i32; 4];

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Png,
    Jpeg,
    Webp,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Decoded {
    /// 0 if it failed.
    pub id: u32,
    pub size: [u32; 2],
    /// Of EXIF.
    pub orientation: u8,
}

/// Gets bytes that are only valid during the call.
pub type Sink = unsafe extern "C" fn(context: *mut c_void, bytes: *const u8, len: usize);

/// Any thread may call these. They copy what they keep. Pixels are RGBA, not premultiplied.
#[repr(C)]
pub struct Graphics {
    pub reserve_id: extern "C" fn() -> u32,
    pub draw: unsafe extern "C" fn(*const Commands),
    pub measure: unsafe extern "C" fn(text: Slice<u8>, style: TextStyle) -> TextMetrics,
    pub is_in_path:
        unsafe extern "C" fn(point: &[f32; 2], verbs: Slice<PathVerb>, is_even_odd: bool) -> bool,
    pub is_in_stroke: unsafe extern "C" fn(
        point: &[f32; 2],
        verbs: Slice<PathVerb>,
        matrix: &Matrix,
        pen: Pen,
        dashes: Slice<f32>,
    ) -> bool,
    /// Writes every pixel of the area, and waits for that.
    pub read: unsafe extern "C" fn(canvas: u32, area: &Area, is_on_black: bool, rgba: *mut u8),
    /// `rgba` covers `area`, and `dirty` is inside of that.
    pub write: unsafe extern "C" fn(canvas: u32, area: &Area, dirty: &Area, rgba: *const u8),
    pub insert: unsafe extern "C" fn(size: &[u32; 2], rgba: *const u8) -> u32,
    /// `quality` is from 1 to 100.
    pub encode: unsafe extern "C" fn(
        size: &[u32; 2],
        rgba: *const u8,
        Format,
        quality: u8,
        Sink,
        *mut c_void,
    ) -> bool,
    pub decode: unsafe extern "C" fn(bytes: Slice<u8>, is_oriented: bool) -> Decoded,
    /// Does not wait for the pixels. Fails unless the image is large enough for that to be worthwhile.
    pub open: unsafe extern "C" fn(bytes: Slice<u8>, density: f32, scale: f32) -> Decoded,
}
