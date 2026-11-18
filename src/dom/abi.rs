//! What `bun_dom` and the UI library pass to each other. `packages/bun-desktop` compiles this file too.
//!
//! Lengths are CSS pixels, y grows down, and colors are `0xRRGGBBAA` in sRGB, not premultiplied.
#![allow(dead_code, unreachable_pub)] // Each side uses its half.

/// Bumped with every change to this file, to the library's exports, or to its JSON messages.
pub const ABI_VERSION: u32 = 40;

#[path = "abi_accessibility.rs"]
pub mod accessibility;

#[repr(C)]
pub struct Slice<T> {
    pub ptr: *const T,
    pub len: usize,
}

impl<T> Clone for Slice<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Slice<T> {}

impl<T> Slice<T> {
    pub fn new(slice: &[T]) -> Self {
        Slice {
            ptr: slice.as_ptr(),
            len: slice.len(),
        }
    }

    /// # Safety
    /// What `new` was given is alive and unchanged for `'a`.
    pub unsafe fn get<'a>(self) -> &'a [T] {
        if self.len == 0 {
            return &[];
        }
        // SAFETY: the caller's contract.
        unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
    }
}

/// `start..end` in one of the arrays of the struct that holds it.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    pub fn range(self) -> core::ops::Range<usize> {
        self.start as usize..self.end as usize
    }
}

// ───────────────────────────── text ─────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FontSetting {
    pub tag: [u8; 4],
    pub value: f32,
}

pub const FONT_NORMAL: u8 = 0;
pub const FONT_ITALIC: u8 = 1;
pub const FONT_OBLIQUE: u8 = 2;

pub const SYNTHESIZE_WEIGHT: u8 = 1;
pub const SYNTHESIZE_STYLE: u8 = 2;
pub const SYNTHESIZE_SMALL_CAPS: u8 = 4;
/// The weight that macOS adds to text.
pub const SYNTHESIZE_SMOOTHING: u8 = 8;

/// Marks a name in [`FontDescription::families`] as a generic family, such as `sans-serif` or `system-ui`.
pub const GENERIC_FAMILY: u8 = 1;

/// The `font-*` properties but the size.
#[repr(C)]
pub struct FontDescription {
    /// The `scope` that `font.register` was given. Its faces hide the system's families of the same name.
    pub scope: u32,
    /// Names, each followed by a 0.
    pub families: Slice<u8>,
    pub weight: f32,
    /// In percent.
    pub stretch: f32,
    pub style: u8,
    pub synthesis: u8,
    pub optical_sizing: bool,
    pub kerning: bool,
    /// Degrees, for `FONT_OBLIQUE`.
    pub oblique_angle: f32,
    pub variations: Slice<FontSetting>,
    pub features: Slice<FontSetting>,
    /// A BCP 47 tag, or nothing.
    pub language: Slice<u8>,
    /// Ascents, descents and line gaps are rounded to device pixels.
    pub device_scale: f32,
    /// An OpenType language system tag, or zeros.
    pub language_override: [u8; 4],
    /// Each font is scaled so that the metric is `size_adjust` times the size.
    pub size_adjust_metric: u8,
    pub size_adjust: f32,
    pub emoji: u8,
    /// The family that the palette is for. Without one, it is for all.
    pub palette_family: Slice<u8>,
    /// An index, or a `PALETTE_*`.
    pub palette: u32,
    /// Indexes into the palette, and colors.
    pub palette_overrides: Slice<[u32; 2]>,
}

pub const ADJUST_NONE: u8 = 0;
pub const ADJUST_EX_HEIGHT: u8 = 1;
pub const ADJUST_CAP_HEIGHT: u8 = 2;
pub const ADJUST_CH_WIDTH: u8 = 3;
pub const ADJUST_IC_WIDTH: u8 = 4;
pub const ADJUST_IC_HEIGHT: u8 = 5;

pub const EMOJI_NORMAL: u8 = 0;
pub const EMOJI_AS_TEXT: u8 = 1;
pub const EMOJI_IN_COLOR: u8 = 2;
pub const EMOJI_AS_IN_UNICODE: u8 = 3;

pub const PALETTE_LIGHT: u32 = u32::MAX - 1;
pub const PALETTE_DARK: u32 = u32::MAX;

/// Of the first available font, at the size that was asked for. All but the offsets are positive.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FontMetrics {
    pub ascent: f32,
    pub descent: f32,
    pub line_gap: f32,
    pub x_height: f32,
    pub cap_height: f32,
    pub zero_advance: f32,
    pub ideograph_advance: f32,
    pub space_advance: f32,
    /// From the baseline down to the top of the line.
    pub underline_offset: f32,
    pub underline_thickness: f32,
    /// For the widths of text controls.
    pub average_advance: f32,
    pub widest_advance: f32,
}

pub const BREAK_NORMAL: u8 = 0;
pub const BREAK_ALL: u8 = 1;
pub const BREAK_KEEP_ALL: u8 = 2;
/// The flags below are added to those.
pub const BREAK_LOOSE: u8 = 4;
pub const BREAK_STRICT: u8 = 8;
/// With the rules for Chinese and Japanese.
pub const BREAK_CJ: u8 = 16;
/// With the alternate glyphs for vertical text.
pub const RUN_VERTICAL: u8 = 32;
/// Shaped from top to bottom. The glyphs are placed relative to the middle of the top edge of their cluster.
pub const RUN_UPRIGHT: u8 = 64;

/// A run ends where the next one starts.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextRun {
    pub end: u32,
    /// From `font_describe`.
    pub font: u32,
    pub size: f32,
    pub letter_spacing: f32,
    pub word_spacing: f32,
    pub word_break: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GlyphExtent {
    pub advance: f32,
    /// The y axis goes down from the baseline.
    pub ink: Rect,
}

pub const DIRECTION_LTR: u8 = 0;
pub const DIRECTION_RTL: u8 = 1;
pub const DIRECTION_AUTO: u8 = 2;

/// A line may start with this cluster.
pub const CLUSTER_BREAK_BEFORE: u8 = 1;
/// U+0020, U+0009, U+3000 and the other spaces that hang at the end of a line.
pub const CLUSTER_SPACE: u8 = 2;
/// U+00AD. A line that ends here ends with a hyphen.
pub const CLUSTER_SOFT_HYPHEN: u8 = 4;

/// A grapheme cluster. A ligature's glyphs belong to its first cluster, and its clusters share the advance evenly.
/// U+FFFC, U+0009, U+000A, bidi controls and other default ignorables have no glyphs and no advance.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cluster {
    /// Where it starts in the text. It ends where the next one starts.
    pub start: u32,
    /// With letter and word spacing.
    pub advance: f32,
    /// In visual order.
    pub glyphs: Span,
    pub bidi_level: u8,
    pub flags: u8,
    /// An index into [`ShapedText::faces`].
    pub face: u16,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Glyph {
    pub id: u32,
    /// In [`ShapedText`], from the left edge of the cluster (of the whole ligature) on the baseline. In
    /// [`DisplayList`], from the origin of the [`Item::Text`].
    pub x: f32,
    pub y: f32,
}

pub const NO_GLYPH: u16 = u16::MAX;

/// A cluster at bidi level 0, whose glyph is at its origin.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Letter {
    pub advance: f32,
    pub glyph: u16,
    pub flags: u8,
    pub face: u8,
}

pub fn spell_out(text: &str, letters: &[Letter], joined: &[u32]) -> (Vec<Cluster>, Vec<Glyph>) {
    let (mut glyphs, mut joined) = (Vec::with_capacity(letters.len()), joined.iter().peekable());
    let clusters = text
        .char_indices()
        .filter(|it| joined.next_if_eq(&&(it.0 as u32)).is_none())
        .zip(letters)
        .map(|((start, _), it)| {
            let first = glyphs.len() as u32;
            glyphs.extend((it.glyph != NO_GLYPH).then_some(Glyph {
                id: it.glyph.into(),
                x: 0.0,
                y: 0.0,
            }));
            Cluster {
                start: start as u32,
                advance: it.advance,
                glyphs: Span {
                    start: first,
                    end: glyphs.len() as u32,
                },
                bidi_level: 0,
                flags: it.flags,
                face: it.face.into(),
            }
        });
    (clusters.collect(), glyphs)
}

/// A font file with its variations and synthesis applied, at a size.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Face {
    pub id: u32,
    /// With `size-adjust`.
    pub size: f32,
    pub ascent: f32,
    pub descent: f32,
    pub line_gap: f32,
}

#[repr(C)]
pub struct ShapedText {
    /// In logical order.
    pub clusters: Slice<Cluster>,
    pub glyphs: Slice<Glyph>,
    /// In place of `clusters` and `glyphs`, or none.
    pub letters: Slice<Letter>,
    /// Where the characters are that do not start a letter, ascending.
    pub joined: Slice<u32>,
    pub faces: Slice<Face>,
    /// 0 or 1: what `DIRECTION_AUTO` resolved to.
    pub base_level: u8,
    /// Where the letters of `shape_rest` start in the text.
    pub skipped: u32,
}

// ───────────────────────────── painting ─────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// `[horizontal, vertical]` radii: top left, top right, bottom right, bottom left. They never overlap.
pub type Radii = [[f32; 2]; 4];

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RoundedRect {
    pub rect: Rect,
    pub radii: Radii,
    /// `-electron-corner-smoothing`, from 0 to 1.
    pub smoothing: f32,
}

/// For each corner, how much of `smoothing` there is room for along the horizontal and along the vertical edge.
pub fn smoothing_of_corners(
    [width, height]: [f32; 2],
    [a, b, c, d]: [f32; 4],
    smoothing: f32,
) -> [[f32; 2]; 4] {
    let along = |side: f32, radii: f32| (side / radii.max(1e-6) - 1.0).min(smoothing).max(0.0);
    let [top, right, bottom, left] = [
        along(width, a + b),
        along(height, b + c),
        along(width, c + d),
        along(height, d + a),
    ];
    [[top, left], [top, right], [bottom, right], [bottom, left]]
}

impl RoundedRect {
    /// A smooth corner has one radius.
    pub fn smaller_radii(&self) -> [f32; 4] {
        self.radii.map(|[x, y]| x.min(y).max(0.0))
    }

    /// How far the curves go along the edges.
    pub fn reach(&self) -> Radii {
        if self.smoothing == 0.0 {
            return self.radii;
        }
        let radii = self.smaller_radii();
        let smoothing =
            smoothing_of_corners([self.rect.width, self.rect.height], radii, self.smoothing);
        [0, 1, 2, 3].map(|it| smoothing[it].map(|by| radii[it] * (1.0 + by)))
    }

    /// Clockwise from the top left: where each starts, and three cubic curves.
    /// The construction is that of Electron's `electron_smooth_round_rect.cc` (MIT).
    pub fn smooth_corners(&self) -> [[[f32; 2]; 10]; 4] {
        let (
            Rect {
                x,
                y,
                width,
                height,
            },
            radii,
        ) = (self.rect, self.smaller_radii());
        let smoothing = smoothing_of_corners([width, height], radii, self.smoothing);
        let (corners, edges) = (
            [
                [x, y],
                [x + width, y],
                [x + width, y + height],
                [x, y + height],
            ],
            [[0.0, -1.0], [1.0, 0.0], [0.0, 1.0], [-1.0, 0.0]],
        );
        [0, 1, 2, 3].map(|it| {
            let (radius, [before, after]) = (radii[it], [edges[it], edges[(it + 1) % 4]]);
            let at = |back: f32, on: f32| {
                [0, 1].map(|axis| corners[it][axis] - before[axis] * back + after[axis] * on)
            };
            let angles = [smoothing[it][1 - it % 2], smoothing[it][it % 2]]
                .map(|it| it * core::f32::consts::FRAC_PI_4);
            let handle =
                4.0 / 3.0 * ((core::f32::consts::FRAC_PI_2 - angles[0] - angles[1]) / 4.0).tan();
            let [first, second] = angles.map(|angle| {
                let ((sin, cos), start, near) = (
                    angle.sin_cos(),
                    1.0 + angle / core::f32::consts::FRAC_PI_4,
                    1.0 - (angle / 2.0).tan(),
                );
                [
                    [start, 0.0],
                    [(start + near * 2.0) / 3.0, 0.0],
                    [near, 0.0],
                    [1.0 - sin, 1.0 - cos],
                    [1.0 - sin - handle * cos, 1.0 - cos + handle * sin],
                ]
                .map(|it| it.map(|it| it * radius))
            });
            core::array::from_fn(|point| {
                if point < 5 {
                    at(first[point][0], first[point][1])
                } else {
                    at(second[9 - point][1], second[9 - point][0])
                }
            })
        })
    }
}

/// `[a, b, c, d, e, f]` of CSS's `matrix()`.
pub type Matrix = [f32; 6];

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LineStyle {
    None,
    Solid,
    Dotted,
    Dashed,
    Double,
    Groove,
    Ridge,
    Inset,
    Outset,
    Wavy,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GradientStop {
    /// Ascending. Between two stops the color is interpolated in premultiplied sRGB.
    pub offset: f32,
    pub color: u32,
}

/// Points are relative to the tile's origin.
#[repr(C, u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GradientShape {
    Linear {
        from: [f32; 2],
        to: [f32; 2],
    },
    Radial {
        center: [f32; 2],
        radius: [f32; 2],
    },
    /// Degrees clockwise from the top.
    Conic {
        center: [f32; 2],
        angle: f32,
    },
}

/// Where a background image goes: once at `rect`, and again every `step` along an axis whose step is not 0.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Tile {
    pub rect: Rect,
    pub step: [f32; 2],
}

#[repr(C, u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Filter {
    Blur(f32),
    Brightness(f32),
    Contrast(f32),
    Grayscale(f32),
    /// Degrees.
    HueRotate(f32),
    Invert(f32),
    Opacity(f32),
    Saturate(f32),
    Sepia(f32),
    DropShadow {
        offset: [f32; 2],
        /// The standard deviation.
        blur: f32,
        color: u32,
    },
    /// Makes it black, with the luminance for alpha.
    Luminance {
        linear: bool,
    },
    /// An SVG `filter`, with its region. The `Primitive`s that follow are in it, and the last one is the result.
    Graph(Rect),
    Primitive {
        kind: Primitive,
        /// Works in linearRGB.
        linear: bool,
        /// Floats in `bytes`: two inputs, the subregion, and what `kind` lists. An input is `INPUT_*` or the position
        /// of a primitive in the graph.
        arguments: Span,
    },
}

pub const INPUT_GRAPHIC: f32 = -1.0;
pub const INPUT_ALPHA: f32 = -2.0;
pub const INPUT_NOTHING: f32 = -3.0;

/// Colors are four arguments from 0 to 255. A light is its kind (0: distant, 1: point, 2: spot), `x`, `y`, `z` (the
/// direction of a distant one), what it points at, `specularExponent`, and the cosine of `limitingConeAngle`.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Primitive {
    /// The position of a mode in `BlendMode`.
    Blend,
    /// 20 numbers.
    ColorMatrix,
    /// 256 values from 0 to 255 for each channel.
    ComponentTransfer,
    /// 0 to 6 for over, in, out, atop, xor, lighter and arithmetic, and `k1` to `k4`.
    Composite,
    /// Columns, rows, `targetX`, `targetY`, divisor, bias, `edgeMode` (duplicate, wrap, none), `preserveAlpha`, kernel.
    ConvolveMatrix,
    /// `surfaceScale`, `diffuseConstant`, nothing, color, light.
    DiffuseLighting,
    /// `surfaceScale`, `specularConstant`, `specularExponent`, color, light.
    SpecularLighting,
    /// Two scales, and the two channels.
    DisplacementMap,
    /// Offset, two standard deviations, color.
    DropShadow,
    /// Color.
    Flood,
    /// Two standard deviations.
    GaussianBlur,
    /// Which of the layer's `Item::Input`.
    Image,
    /// Inputs.
    Merge,
    /// Two radii, and whether it dilates.
    Morphology,
    Offset,
    /// The subregion of the input.
    Tile,
    /// Two frequencies, octaves, seed, whether it stitches, whether it is `fractalNoise`.
    Turbulence,
}

pub const CAP_BUTT: u8 = 0;
pub const CAP_ROUND: u8 = 1;
pub const CAP_SQUARE: u8 = 2;

pub const JOIN_MITER: u8 = 0;
pub const JOIN_ROUND: u8 = 1;
pub const JOIN_BEVEL: u8 = 2;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Stroke {
    pub width: f32,
    pub miter_limit: f32,
    pub dash_offset: f32,
    /// An even number of floats in `bytes`.
    pub dashes: Span,
    pub cap: u8,
    pub join: u8,
}

/// The inside of a path or, if the stroke has a width, its stroke.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Outline {
    pub verbs: Span,
    /// Of what it covers.
    pub bounds: Rect,
    pub stroke: Stroke,
    pub even_odd: bool,
    /// Not antialiased.
    pub crisp: bool,
    /// `OUTLINE_*`
    pub how: u8,
}

/// The inside is where the winding number is positive.
pub const OUTLINE_POSITIVE: u8 = 1;
/// The inside and the stroke.
pub const OUTLINE_WITH_STROKE: u8 = 2;
pub const OUTLINE_WITHOUT_STROKE: u8 = 4;
/// All else in `bounds`.
pub const OUTLINE_INVERSE: u8 = 8;

pub const SPREAD_PAD: u8 = 0;
pub const SPREAD_REPEAT: u8 = 1;
pub const SPREAD_REFLECT: u8 = 2;

#[repr(C, u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PathVerb {
    Move([f32; 2]),
    Line([f32; 2]),
    Cubic([f32; 2], [f32; 2], [f32; 2]),
    Close,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BlendMode {
    Normal,
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
    PlusLighter,
    /// Erases what is under it, in a mask with `mask-composite: subtract` or `exclude`.
    DestinationOut,
    /// Keeps what is under it, in a mask with `mask-composite: intersect`.
    DestinationIn,
    SourceIn,
    SourceOut,
    Xor,
    /// Normal, for a group that starts as a copy of what is under it.
    FromBackdrop,
}

#[repr(C, u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Item {
    /// Ends at the matching `Pop`, like every `Push*`.
    PushClip(RoundedRect),
    PushClipPath {
        verbs: Span,
        even_odd: bool,
    },
    /// Applied after the transforms inside of it and before the ones around it.
    PushTransform(Matrix),
    /// A group that is filtered, masked, and then blended as a whole. Nothing in it is painted outside of `bounds`
    /// before the filters.
    PushLayer {
        bounds: Rect,
        opacity: f32,
        blend: BlendMode,
        filters: Span,
    },
    /// In a layer: what follows, up to the layer's `Pop`, is not painted but multiplies the layer's alpha.
    Mask {
        luminance: bool,
    },
    Pop,
    /// Paints a filtered copy of what is already painted in the layer.
    Backdrop {
        shape: RoundedRect,
        filters: Span,
        opacity: f32,
    },
    Fill {
        shape: RoundedRect,
        color: u32,
    },
    /// Top, right, bottom, left, inside of `shape`.
    Border {
        shape: RoundedRect,
        widths: [f32; 4],
        colors: [u32; 4],
        styles: [LineStyle; 4],
    },
    /// An outer shadow is only painted outside of `shape` (the border box), an inset one inside (the padding box).
    Shadow {
        shape: RoundedRect,
        /// `shape` after the offset and the spread.
        shadow: Rect,
        radii: Radii,
        /// The CSS blur radius, twice the standard deviation.
        blur: f32,
        color: u32,
        inset: bool,
        /// An opaque `Fill` of `shape` follows.
        covered: bool,
    },
    Gradient {
        clip: RoundedRect,
        tile: Tile,
        shape: GradientShape,
        stops: Span,
        repeating: bool,
    },
    /// An id from `image.decode` or `canvas.create`.
    Image {
        clip: RoundedRect,
        tile: Tile,
        image: u32,
        pixelated: bool,
    },
    /// A whole SVG document in `bytes`, whose viewport is `rect`. It may paint anywhere in `clip`.
    Svg {
        clip: Rect,
        rect: Rect,
        source: Span,
        hash: u64,
    },
    Text {
        /// On the baseline.
        origin: [f32; 2],
        /// For culling.
        bounds: Rect,
        face: u32,
        size: f32,
        glyphs: Span,
        color: u32,
        /// The CSS blur radius of a `text-shadow`.
        blur: f32,
    },
    /// A horizontal text decoration. `rect.height` is its thickness.
    Line {
        rect: Rect,
        color: u32,
        style: LineStyle,
    },
    /// Blinks.
    Caret {
        rect: Rect,
        color: u32,
    },
    Path {
        outline: Outline,
        color: u32,
    },
    PushClipOutline(Outline),
    /// An SVG gradient, between two points or, unless both radii are negative, two circles.
    Shade {
        bounds: Rect,
        from: [f32; 3],
        to: [f32; 3],
        /// From the space of the gradient.
        matrix: Matrix,
        /// Interpolated without being premultiplied.
        stops: Span,
        spread: u8,
    },
    /// A transform in which nothing is moved to whole pixels.
    PushVector(Matrix),
    /// Fills `bounds` with copies of what is painted in `tile.rect`.
    PushPattern {
        bounds: Rect,
        tile: Tile,
        /// From the space of the tile.
        matrix: Matrix,
    },
    /// A transform with perspective: the rows of a 3x3 matrix.
    PushProjection([f32; 9]),
    /// In a layer, before its `Mask`: what follows, up to the next `Input`, `Mask` or `Pop`, is for `Primitive::Image`.
    Input,
    TextStroke {
        origin: [f32; 2],
        bounds: Rect,
        face: u32,
        size: f32,
        glyphs: Span,
        color: u32,
        stroke: Stroke,
    },
    /// `part` of an image whose size is `whole`, in each tile.
    ImagePart {
        clip: Rect,
        tile: Tile,
        image: u32,
        whole: [f32; 2],
        part: Rect,
        pixelated: bool,
    },
}

/// `app-region`. Of the regions under a point, the last one counts.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Region {
    pub rect: Rect,
    pub drag: bool,
}

pub const NO_SCROLLER: u32 = u32::MAX;

pub const SCROLLS_X: u8 = 1;
pub const SCROLLS_Y: u8 = 2;
/// `overscroll-behavior` keeps what is left of a scroll from the parent.
pub const CONTAINS_X: u8 = 4;
pub const CONTAINS_Y: u8 = 8;
/// The renderer leaves it to the engine, like with `scroll-snap-type`.
pub const SCROLLED_BY_ENGINE: u8 = 16;

/// The renderer adds up how far it has scrolled `id` and reports that total in `scroll` events. It shows the offset
/// `offset + total - applied`.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Scroller {
    pub id: u32,
    /// An index: where scrolling continues at the end of this one.
    pub parent: u32,
    /// What the items were painted for.
    pub offset: [f32; 2],
    pub min: [f32; 2],
    pub max: [f32; 2],
    /// The total of the last event that `offset` includes.
    pub applied: [f64; 2],
    /// Changes when a script or the engine sets the offset, which ends what the renderer was doing.
    pub generation: u32,
    pub flags: u8,
}

#[repr(C, u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    /// Without samples: the item becomes a translation by `offset` minus what is shown.
    Scroll { scroller: u32 },
    /// Positions are offsets of the scroller on the x axis for 0, and on the y axis for 1.
    Offset { scroller: u32, axis: u8 },
    /// Positions are from 0 to 1 in each cycle. `start` is on the clock of `Renderer::now`, in milliseconds.
    Time { start: f64, cycle: f64, cycles: f64 },
}

/// Replaces the matrix of a `PushTransform` or the opacity of a `PushLayer` or a `Backdrop`.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Driver {
    pub item: u32,
    pub source: Source,
    /// Into `numbers`: a position followed by 6 numbers or by 1, repeatedly. Positions ascend. Values are interpolated
    /// linearly, jump where a position repeats, and stay the same before the first and after the last.
    pub samples: Span,
}

pub const HIT_CONTENT: u8 = 0;
/// Has a `wheel` listener that is not passive, or an ancestor has.
pub const HIT_BLOCKING: u8 = 1;
pub const HIT_THUMB_X: u8 = 2;
pub const HIT_THUMB_Y: u8 = 3;

/// The last one under the pointer says what the wheel scrolls.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    /// It has the transforms and clips that an item has which is painted before this one. Ascending.
    pub item: u32,
    pub rect: Rect,
    pub scroller: u32,
    pub kind: u8,
    /// For a thumb: how far dragging it by a pixel scrolls.
    pub ratio: f32,
}

/// What the renderer can change about a display list while the engine is busy.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Compositing {
    pub scrollers: Slice<Scroller>,
    pub drivers: Slice<Driver>,
    pub numbers: Slice<f32>,
    pub hits: Slice<Hit>,
}

#[repr(C)]
pub struct DisplayList {
    /// Device pixels per CSS pixel are this times the window's scale factor.
    pub zoom: f32,
    pub items: Slice<Item>,
    pub glyphs: Slice<Glyph>,
    pub stops: Slice<GradientStop>,
    pub filters: Slice<Filter>,
    pub verbs: Slice<PathVerb>,
    pub bytes: Slice<u8>,
    pub regions: Slice<Region>,
}

/// What `bun_desktop_renderer` returns. The functions run on the thread of the UI, and copy what they keep.
#[repr(C)]
pub struct Renderer {
    /// The same id for the same description. It stays valid, and `font.register` changes what it resolves to.
    pub font_describe: unsafe extern "C" fn(*const FontDescription) -> u32,
    pub font_metrics: extern "C" fn(font: u32, size: f32) -> FontMetrics,
    /// One paragraph of UTF-8. The result is valid until the next call.
    pub shape:
        unsafe extern "C" fn(text: Slice<u8>, runs: Slice<TextRun>, direction: u8) -> ShapedText,
    /// Likewise, if the first `known` bytes have been shaped to letters with the same runs, whatever came after them. Leaves out what is still right.
    /// `runs` start at `from`, where one has ended. There are no letters if it takes `shape`.
    pub shape_rest: unsafe extern "C" fn(
        text: Slice<u8>,
        runs: Slice<TextRun>,
        from: u32,
        known: u32,
    ) -> ShapedText,
    /// Replaces what the surface shows.
    pub submit: unsafe extern "C" fn(surface: u32, list: *const DisplayList),
    /// For `text-decoration-skip-ink`: for each glyph that has ink between `top` and `bottom`, which are measured down
    /// from the baseline, where that starts and ends on the x axis. The result is valid until the next call.
    pub ink_spans: unsafe extern "C" fn(
        face: u32,
        size: f32,
        glyphs: Slice<Glyph>,
        top: f32,
        bottom: f32,
    ) -> Slice<[f32; 2]>,
    /// Without a list, only the scrollers have changed.
    pub submit_composited: unsafe extern "C" fn(
        surface: u32,
        list: *const DisplayList,
        compositing: *const Compositing,
    ),
    /// The clock of `frame` events.
    pub now: extern "C" fn() -> f64,
    /// The alpha channel of the image at that size, row by row. The result is valid until the next call.
    pub image_alpha: extern "C" fn(image: u32, width: u32, height: u32) -> Slice<u8>,
    /// The bytes of a table of the font file, which stay valid.
    pub font_table: extern "C" fn(face: u32, tag: u32) -> Slice<u8>,
    pub glyph_extent: extern "C" fn(face: u32, size: f32, glyph: u32) -> GlyphExtent,
    /// An image of this size that shows the list, for `image.release` to release.
    pub record_image:
        unsafe extern "C" fn(list: *const DisplayList, width: f32, height: f32) -> u32,
    /// `tree` is a surface, or an image with `TREE_OF_IMAGE`.
    pub update_accessibility: unsafe extern "C" fn(tree: u32, update: *const accessibility::Update),
    /// For tests, which ask what an assistive technology would. The result is valid until the next call.
    pub inspect_accessibility: unsafe extern "C" fn(question: Slice<u8>) -> Slice<u8>,
}
