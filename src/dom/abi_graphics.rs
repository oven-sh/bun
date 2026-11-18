//! Canvases and images, between `bun_dom` and the UI library. Both compile this file.
//!
//! Canvases, patterns and images share one space of ids, in which 0 is nothing.
#![allow(dead_code, unreachable_pub)] // Each side uses its half.

use core::ffi::c_void;

use crate::abi::{Filter, GradientStop, Matrix, Rect, Slice, Span};

/// What takes a fixed number of words.
trait Words: Copy {
    const LEN: usize = 1;
    fn put(self, to: &mut [u32]);
    fn get(from: &[u32]) -> Self;
}

macro_rules! words {
    ($($Type:ty: $put:expr, $get:expr;)+) => {$(
        impl Words for $Type {
            #[inline(always)]
            fn put(self, to: &mut [u32]) {
                to[0] = $put(self);
            }

            #[inline(always)]
            fn get(from: &[u32]) -> Self {
                $get(from[0])
            }
        }
    )+};
}

words! {
    u32: |it| it, |it| it;
    f32: f32::to_bits, f32::from_bits;
    bool: u32::from, |it| it != 0;
}

impl<T: Words, const N: usize> Words for [T; N] {
    const LEN: usize = T::LEN * N;

    #[inline(always)]
    fn put(self, to: &mut [u32]) {
        (0..N).for_each(|at| self[at].put(&mut to[at * T::LEN..]));
    }

    #[inline(always)]
    fn get(from: &[u32]) -> Self {
        core::array::from_fn(|at| T::get(&from[at * T::LEN..]))
    }
}

macro_rules! put {
    ($to:ident, $start:expr, $($field:ident: $Type:ty),*) => {
        let mut _at = $start;
        $($field.put(&mut $to[_at..]); _at += <$Type>::LEN;)*
    };
}

macro_rules! get {
    ($from:ident, $start:expr, $($field:ident: $Type:ty),*) => {
        let mut _at = $start;
        $(let $field = <$Type>::get(&$from[_at..]); _at += <$Type>::LEN;)*
    };
}

macro_rules! records {
    ($($Name:ident { $($field:ident: $Type:ty),+ })+) => {$(
        impl Words for $Name {
            const LEN: usize = 0 $(+ <$Type>::LEN)+;

            #[inline(always)]
            fn put(self, to: &mut [u32]) {
                let $Name { $($field),+ } = self;
                put!(to, 0, $($field: $Type),+);
            }

            #[inline(always)]
            fn get(from: &[u32]) -> Self {
                get!(from, 0, $($field: $Type),+);
                $Name { $($field),+ }
            }
        }
    )+};
}

records! {
    Span { start: u32, end: u32 }
    Rect { x: f32, y: f32, width: f32, height: f32 }
    Pen { width: f32, miter_limit: f32, dash_offset: f32, cap: Cap, join: Join }
    TextStyle { font: u32, size: f32, letter_spacing: f32, word_spacing: f32, is_right_to_left: bool, baseline: Baseline }
    Snapshot { id: u32, source: u32, size: [f32; 2], part: Rect, to: [u32; 2], flips: bool, is_smooth: bool, is_sharpened: bool, is_tile: bool, is_wide: bool }
}

macro_rules! choices {
    ($($Name:ident { $($variant:ident),+ })+) => {$(
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum $Name {
            $($variant),+
        }

        words! {
            $Name: |it| it as u32, |it| [$($Name::$variant),+][it as usize];
        }
    )+};
}

choices! {
    Cap { Butt, Round, Square }
    Join { Miter, Round, Bevel }
    Baseline { Alphabetic, Top, Hanging, Middle, Ideographic, Bottom }
    Operator {
        SourceOver, SourceIn, SourceOut, SourceAtop, DestinationOver, DestinationIn, DestinationOut, DestinationAtop, Lighter,
        Copy, Xor, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference,
        Exclusion, Hue, Saturation, Color, Luminosity, Clear
    }
}

/// An enum of which a value is a word that says which variant it is, followed by the fields.
macro_rules! variants {
    ($(#[$about:meta])* $Name:ident, $Tag:ident { $($(#[$doc:meta])* $Variant:ident $(($($one:ident: $One:ty),+))? $({ $($field:ident: $Type:ty),+ })?,)+ }) => {
        $(#[$about])*
        #[derive(Clone, Copy)]
        pub enum $Name {
            $($(#[$doc])* $Variant $(($($One),+))? $({ $($field: $Type),+ })?,)+
        }

        enum $Tag {
            $($Variant),+
        }

        impl $Name {
            #[inline(always)]
            pub fn write(self, to: &mut Vec<u32>) {
                match self {$(
                    $Name::$Variant $(($($one),+))? $({ $($field),+ })? => {
                        let mut words = [$Tag::$Variant as u32; 1 $($(+ <$One>::LEN)+)? $($(+ <$Type>::LEN)+)?];
                        let _all = &mut words;
                        put!(_all, 1, $($($one: $One),+)? $($($field: $Type),+)?);
                        to.extend_from_slice(&words);
                    }
                )+}
            }

            /// Leaves what comes after it.
            #[inline(always)]
            pub fn read(from: &mut &[u32]) -> Option<$Name> {
                let tag = *from.first()?;
                $(if tag == $Tag::$Variant as u32 {
                    let (_words, rest) = from.split_first_chunk::<{ 1 $($(+ <$One>::LEN)+)? $($(+ <$Type>::LEN)+)? }>()?;
                    *from = rest;
                    get!(_words, 1, $($($one: $One),+)? $($($field: $Type),+)?);
                    return Some($Name::$Variant $(($($one),+))? $({ $($field),+ })?);
                })+
                None
            }
        }
    };
}

variants! {
    /// Of a path. What follows `Close` begins where the contour began.
    Verb, VerbTag {
        Move(to: [f32; 2]),
        Line(to: [f32; 2]),
        Quad(control: [f32; 2], to: [f32; 2]),
        Cubic(first: [f32; 2], second: [f32; 2], to: [f32; 2]),
        /// In radians clockwise from the x axis, and a turn at most. A line leads to it, unless it is the first.
        Arc { center: [f32; 2], radius: f32, from: f32, sweep: f32 },
        /// A contour, clockwise unless one side is negative. What follows begins at the origin of `rect`.
        RoundRect { rect: Rect, radius: f32 },
        Close,
    }
}

variants! {
    Paint, PaintTag {
        Linear { from: [f32; 2], to: [f32; 2], stops: Span },
        /// The centers and the radii.
        Radial { from: [f32; 3], to: [f32; 3], stops: Span },
        /// Radians clockwise from the x axis.
        Conic { center: [f32; 2], start: f32, stops: Span },
        Pattern { tile: u32, repeats: [bool; 2], matrix: Matrix },
    }
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
#[derive(Clone, Copy)]
pub struct Snapshot {
    pub id: u32,
    pub source: u32,
    pub size: [f32; 2],
    pub part: Rect,
    pub to: [u32; 2],
    pub flips: bool,
    pub is_smooth: bool,
    /// With a cubic filter, if it is enlarged.
    pub is_sharpened: bool,
    /// Only `Paint::Pattern` can use it.
    pub is_tile: bool,
    /// Of a tile. Others are in the color space of the source.
    pub is_wide: bool,
}

variants! {
    /// Paths are in the pixels of the canvas, and everything else is in the space of the last `Transform`.
    Command, CommandTag {
        /// The pixels and the colors of what is wide are in Display P3.
        Create { id: u32, size: [u32; 2], is_opaque: bool, is_read_often: bool, is_wide: bool },
        Snapshot(wanted: Snapshot),
        Release(id: u32),
        DropFontScope(scope: u32),
        /// The canvas for the commands below.
        Select(id: u32),
        /// Clears the pixels and the state.
        Reset(size: [u32; 2]),
        /// Clears the pixels.
        Erase,
        Transform(to: Matrix),
        FillColor(color: u32),
        StrokeColor(color: u32),
        /// Where the `Paint` is in `parts`.
        FillPaint(paint: Span),
        StrokePaint(paint: Span),
        Compositing { alpha: f32, operator: Operator },
        Pen { pen: Pen, dashes: Span },
        LineWidth(width: f32),
        Shadow { offset: [f32; 2], blur: f32, color: u32 },
        Smoothing(is_smooth: bool),
        Filters(filters: Span),
        /// With `saves`, `RestoreClip` goes back to the clip before it.
        Clip { verbs: Span, is_even_odd: bool, saves: bool },
        RestoreClip,
        Fill { verbs: Span, is_even_odd: bool },
        Stroke { verbs: Span },
        FillRect(rect: Rect),
        StrokeRect(rect: Rect),
        ClearRect(rect: Rect),
        /// `alignment` is how much of the text is left of `at`.
        Text { text: Span, style: TextStyle, at: [f32; 2], alignment: f32, max_width: f32, strokes: bool },
        Image { image: u32, size: [f32; 2], from: Rect, to: Rect },
    }
}

#[repr(C)]
pub struct Commands {
    /// What `Command::write` has written.
    pub commands: Slice<u32>,
    /// Likewise, of `Verb` and `Paint`.
    pub parts: Slice<u32>,
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
        unsafe extern "C" fn(point: &[f32; 2], verbs: Slice<u32>, is_even_odd: bool) -> bool,
    pub is_in_stroke: unsafe extern "C" fn(
        point: &[f32; 2],
        verbs: Slice<u32>,
        matrix: &Matrix,
        pen: Pen,
        dashes: Slice<f32>,
    ) -> bool,
    /// Writes every pixel of the area, and waits for that.
    pub read: unsafe extern "C" fn(canvas: u32, area: &Area, is_on_black: bool, rgba: *mut u8),
    /// `rgba` covers `area`, and `dirty` is inside of that.
    pub write: unsafe extern "C" fn(canvas: u32, area: &Area, dirty: &Area, rgba: *const u8),
    /// In sRGB, in Display P3, or in both. The other one is null.
    pub insert: unsafe extern "C" fn(size: &[u32; 2], rgba: *const u8, wide: *const u8) -> u32,
    /// From sRGB to Display P3, or back.
    pub convert: unsafe extern "C" fn(rgba: *mut u8, pixels: usize, widens: bool),
    /// Whether it may have colors that sRGB lacks. It waits.
    pub has_wide_colors: extern "C" fn(image: u32) -> bool,
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
