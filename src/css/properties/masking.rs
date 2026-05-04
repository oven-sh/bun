use crate as css;
use crate::Printer;
use crate::PrintErr;

use crate::css_values::length::LengthPercentage;
use crate::css_values::image::Image;
use crate::css_values::rect::Rect;
use crate::css_values::url::Url;
use crate::css_values::length::LengthOrNumber;
use crate::css_values::position::Position;

use crate::css_properties::border_radius::BorderRadius;
use crate::css_properties::shape::FillRule;

use crate::css_properties::background::BackgroundSize;
use crate::css_properties::background::BackgroundRepeat;
use crate::css_properties::border_image::BorderImageSlice;
use crate::css_properties::border_image::BorderImageSideWidth;
use crate::css_properties::border_image::BorderImageRepeat;
use crate::css_properties::border_image::BorderImage;

use crate::VendorPrefix;
use crate::PropertyId;
use crate::PropertyIdTag;

/// A value for the [clip-path](https://www.w3.org/TR/css-masking-1/#the-clip-path) property.
// TODO(port): non-pub in Zig — confirm visibility
enum ClipPath {
    /// No clip path.
    None,
    /// A url reference to an SVG path element.
    Url(Url),
    /// A basic shape, positioned according to the reference box.
    Shape {
        /// A basic shape.
        // todo_stuff.think_about_mem_mgmt
        shape: Box<BasicShape>,
        /// A reference box that the shape is positioned according to.
        reference_box: GeometryBox,
    },
    /// A reference box.
    Box(GeometryBox),
}

/// A [`<geometry-box>`](https://www.w3.org/TR/css-masking-1/#typedef-geometry-box) value
/// as used in the `mask-clip` and `clip-path` properties.
// TODO(port): css.DefineEnumProperty(@This()) — comptime-generated eql/hash/parse/toCss/deepClone.
// In Rust this becomes #[derive] of the css enum-property protocol (kebab-case serialization).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum GeometryBox {
    /// The painted content is clipped to the content box.
    #[css(name = "border-box")]
    BorderBox,
    /// The painted content is clipped to the padding box.
    #[css(name = "padding-box")]
    PaddingBox,
    /// The painted content is clipped to the border box.
    #[css(name = "content-box")]
    ContentBox,
    /// The painted content is clipped to the margin box.
    #[css(name = "margin-box")]
    MarginBox,
    /// The painted content is clipped to the object bounding box.
    #[css(name = "fill-box")]
    FillBox,
    /// The painted content is clipped to the stroke bounding box.
    #[css(name = "stroke-box")]
    StrokeBox,
    /// Uses the nearest SVG viewport as reference box.
    #[css(name = "view-box")]
    ViewBox,
}

impl GeometryBox {
    pub fn into_mask_clip(&self) -> MaskClip {
        MaskClip::GeometryBox(*self)
    }
}

impl Default for GeometryBox {
    fn default() -> GeometryBox {
        GeometryBox::BorderBox
    }
}

/// A CSS [`<basic-shape>`](https://www.w3.org/TR/css-shapes-1/#basic-shape-functions) value.
pub enum BasicShape {
    /// An inset rectangle.
    Inset(InsetRect),
    /// A circle.
    Circle(Circle),
    /// An ellipse.
    Ellipse(Ellipse),
    /// A polygon.
    Polygon(Polygon),
}

/// An [`inset()`](https://www.w3.org/TR/css-shapes-1/#funcdef-inset) rectangle shape.
// TODO(port): non-pub in Zig — confirm visibility
struct InsetRect {
    /// The rectangle.
    rect: Rect<LengthPercentage>,
    /// A corner radius for the rectangle.
    radius: BorderRadius,
}

/// A [`circle()`](https://www.w3.org/TR/css-shapes-1/#funcdef-circle) shape.
pub struct Circle {
    /// The radius of the circle.
    pub radius: ShapeRadius,
    /// The position of the center of the circle.
    pub position: Position,
}

/// An [`ellipse()`](https://www.w3.org/TR/css-shapes-1/#funcdef-ellipse) shape.
pub struct Ellipse {
    /// The x-radius of the ellipse.
    pub radius_x: ShapeRadius,
    /// The y-radius of the ellipse.
    pub radius_y: ShapeRadius,
    /// The position of the center of the ellipse.
    pub position: Position,
}

/// A [`polygon()`](https://www.w3.org/TR/css-shapes-1/#funcdef-polygon) shape.
pub struct Polygon {
    /// The fill rule used to determine the interior of the polygon.
    pub fill_rule: FillRule,
    /// The points of each vertex of the polygon.
    // TODO(port): css is an AST crate (§Allocators) — if Polygon is arena-fed this must become
    // `bumpalo::collections::Vec<'bump, Point>` and Polygon/BasicShape/ClipPath gain `<'bump>`.
    // No construction site exists in src/css/*.zig today, so provenance is unconfirmed; keeping
    // plain Vec<Point> until Phase B verifies the allocator.
    pub points: Vec<Point>,
}

/// A [`<shape-radius>`](https://www.w3.org/TR/css-shapes-1/#typedef-shape-radius) value
/// that defines the radius of a `circle()` or `ellipse()` shape.
pub enum ShapeRadius {
    /// An explicit length or percentage.
    LengthPercentage(LengthPercentage),
    /// The length from the center to the closest side of the box.
    ClosestSide,
    /// The length from the center to the farthest side of the box.
    FarthestSide,
}

/// A point within a `polygon()` shape.
///
/// See [Polygon](Polygon).
pub struct Point {
    /// The x position of the point.
    pub x: LengthPercentage,
    /// The y position of the point.
    pub y: LengthPercentage,
}

/// A value for the [mask-mode](https://www.w3.org/TR/css-masking-1/#the-mask-mode) property.
// TODO(port): css.DefineEnumProperty(@This()) → derive css enum-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskMode {
    /// The luminance values of the mask image is used.
    #[css(name = "luminance")]
    Luminance,
    /// The alpha values of the mask image is used.
    #[css(name = "alpha")]
    Alpha,
    /// If an SVG source is used, the value matches the `mask-type` property. Otherwise, the alpha values are used.
    #[css(name = "match-source")]
    MatchSource,
}

impl Default for MaskMode {
    fn default() -> MaskMode {
        MaskMode::MatchSource
    }
}

/// A value for the [mask-clip](https://www.w3.org/TR/css-masking-1/#the-mask-clip) property.
// TODO(port): css.DeriveParse / css.DeriveToCss → derive css union-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, css::Parse, css::ToCss)]
pub enum MaskClip {
    /// A geometry box.
    // Zig: @"geometry-box"
    GeometryBox(GeometryBox),
    /// The painted content is not clipped.
    #[css(name = "no-clip")]
    NoClip,
}

/// A value for the [mask-composite](https://www.w3.org/TR/css-masking-1/#the-mask-composite) property.
// TODO(port): css.DefineEnumProperty(@This()) → derive css enum-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskComposite {
    /// The source is placed over the destination.
    #[css(name = "add")]
    Add,
    /// The source is placed, where it falls outside of the destination.
    #[css(name = "subtract")]
    Subtract,
    /// The parts of source that overlap the destination, replace the destination.
    #[css(name = "intersect")]
    Intersect,
    /// The non-overlapping regions of source and destination are combined.
    #[css(name = "exclude")]
    Exclude,
}

impl Default for MaskComposite {
    fn default() -> MaskComposite {
        MaskComposite::Add
    }
}

/// A value for the [mask-type](https://www.w3.org/TR/css-masking-1/#the-mask-type) property.
// TODO(port): css.DefineEnumProperty(@This()) → derive css enum-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskType {
    /// The luminance values of the mask is used.
    #[css(name = "luminance")]
    Luminance,
    /// The alpha values of the mask is used.
    #[css(name = "alpha")]
    Alpha,
}

/// A value for the [mask](https://www.w3.org/TR/css-masking-1/#the-mask) shorthand property.
#[derive(Debug, Clone, PartialEq)]
pub struct Mask {
    /// The mask image.
    pub image: Image,
    /// The position of the mask.
    pub position: Position,
    /// The size of the mask image.
    pub size: BackgroundSize,
    /// How the mask repeats.
    pub repeat: BackgroundRepeat,
    /// The box in which the mask is clipped.
    pub clip: MaskClip,
    /// The origin of the mask.
    pub origin: GeometryBox,
    /// How the mask is composited with the element.
    pub composite: MaskComposite,
    /// How the mask image is interpreted.
    pub mode: MaskMode,
}

impl Mask {
    // TODO(port): PropertyFieldMap was a Zig anon-struct const consumed by comptime
    // reflection in shorthand handlers. Represent as assoc const slice; Phase B may
    // replace with a trait/derive.
    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("image", PropertyIdTag::MaskImage),
        ("position", PropertyIdTag::MaskPosition),
        ("size", PropertyIdTag::MaskSize),
        ("repeat", PropertyIdTag::MaskRepeat),
        ("clip", PropertyIdTag::MaskClip),
        ("origin", PropertyIdTag::MaskOrigin),
        ("composite", PropertyIdTag::MaskComposite),
        ("mode", PropertyIdTag::MaskMode),
    ];

    // TODO(port): VendorPrefixMap was a Zig anon-struct const of bools consumed by
    // comptime reflection. Represent as field-name slice; Phase B may replace with trait/derive.
    pub const VENDOR_PREFIX_MAP: &'static [&'static str] = &[
        "image",
        "position",
        "size",
        "repeat",
        "clip",
        "origin",
    ];

    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut image: Option<Image> = None;
        let mut position: Option<Position> = None;
        let mut size: Option<BackgroundSize> = None;
        let mut repeat: Option<BackgroundRepeat> = None;
        let mut clip: Option<MaskClip> = None;
        let mut origin: Option<GeometryBox> = None;
        let mut composite: Option<MaskComposite> = None;
        let mut mode: Option<MaskMode> = None;

        loop {
            if image.is_none() {
                if let Some(value) = input.try_parse(Image::parse).as_value() {
                    image = Some(value);
                    continue;
                }
            }

            if position.is_none() {
                if let Some(value) = input.try_parse(Position::parse).as_value() {
                    position = Some(value);
                    size = input
                        .try_parse(|i: &mut css::Parser| -> css::Result<BackgroundSize> {
                            if let Some(e) = i.expect_delim('/').as_err() {
                                return css::Result::err(e);
                            }
                            BackgroundSize::parse(i)
                        })
                        .as_value();
                    continue;
                }
            }

            if repeat.is_none() {
                if let Some(value) = input.try_parse(BackgroundRepeat::parse).as_value() {
                    repeat = Some(value);
                    continue;
                }
            }

            if origin.is_none() {
                if let Some(value) = input.try_parse(GeometryBox::parse).as_value() {
                    origin = Some(value);
                    continue;
                }
            }

            if clip.is_none() {
                if let Some(value) = input.try_parse(MaskClip::parse).as_value() {
                    clip = Some(value);
                    continue;
                }
            }

            if composite.is_none() {
                if let Some(value) = input.try_parse(MaskComposite::parse).as_value() {
                    composite = Some(value);
                    continue;
                }
            }

            if mode.is_none() {
                if let Some(value) = input.try_parse(MaskMode::parse).as_value() {
                    mode = Some(value);
                    continue;
                }
            }

            break;
        }

        if clip.is_none() {
            if let Some(o) = origin {
                clip = Some(o.into_mask_clip());
            }
        }

        css::Result::ok(Self {
            image: image.unwrap_or_else(Image::default),
            position: position.unwrap_or_else(Position::default),
            repeat: repeat.unwrap_or_else(BackgroundRepeat::default),
            size: size.unwrap_or_else(BackgroundSize::default),
            origin: origin.unwrap_or(GeometryBox::BorderBox),
            clip: clip.unwrap_or_else(|| GeometryBox::BorderBox.into_mask_clip()),
            composite: composite.unwrap_or(MaskComposite::Add),
            mode: mode.unwrap_or(MaskMode::MatchSource),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.image.to_css(dest)?;

        if self.position != Position::default() || self.size != BackgroundSize::default() {
            dest.write_char(' ')?;
            self.position.to_css(dest)?;

            if self.size != BackgroundSize::default() {
                dest.delim('/', true)?;
                self.size.to_css(dest)?;
            }
        }

        if self.repeat != BackgroundRepeat::default() {
            dest.write_char(' ')?;
            self.repeat.to_css(dest)?;
        }

        if self.origin != GeometryBox::BorderBox
            || self.clip != GeometryBox::BorderBox.into_mask_clip()
        {
            dest.write_char(' ')?;
            self.origin.to_css(dest)?;

            if self.clip != self.origin.into_mask_clip() {
                dest.write_char(' ')?;
                self.clip.to_css(dest)?;
            }
        }

        if self.composite != MaskComposite::default() {
            dest.write_char(' ')?;
            self.composite.to_css(dest)?;
        }

        if self.mode != MaskMode::default() {
            dest.write_char(' ')?;
            self.mode.to_css(dest)?;
        }

        Ok(())
    }

    // eql → #[derive(PartialEq)]
    // deepClone → #[derive(Clone)]
}

/// A value for the [mask-border-mode](https://www.w3.org/TR/css-masking-1/#the-mask-border-mode) property.
// TODO(port): css.DefineEnumProperty(@This()) → derive css enum-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskBorderMode {
    /// The luminance values of the mask image is used.
    #[css(name = "luminance")]
    Luminance,
    /// The alpha values of the mask image is used.
    #[css(name = "alpha")]
    Alpha,
}

impl Default for MaskBorderMode {
    fn default() -> Self {
        MaskBorderMode::Alpha
    }
}

/// A value for the [mask-border](https://www.w3.org/TR/css-masking-1/#the-mask-border) shorthand property.
/// A value for the [mask-border](https://www.w3.org/TR/css-masking-1/#the-mask-border) shorthand property.
#[derive(Debug, Clone, PartialEq)]
pub struct MaskBorder {
    /// The mask image.
    pub source: Image,
    /// The offsets that define where the image is sliced.
    pub slice: BorderImageSlice,
    /// The width of the mask image.
    pub width: Rect<BorderImageSideWidth>,
    /// The amount that the image extends beyond the border box.
    pub outset: Rect<LengthOrNumber>,
    /// How the mask image is scaled and tiled.
    pub repeat: BorderImageRepeat,
    /// How the mask image is interpreted.
    pub mode: MaskBorderMode,
}

impl MaskBorder {
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"mask-border", PropertyFieldMap);

    // TODO(port): PropertyFieldMap — see note on Mask::PROPERTY_FIELD_MAP
    pub const PROPERTY_FIELD_MAP: &'static [(&'static str, PropertyIdTag)] = &[
        ("source", PropertyIdTag::MaskBorderSource),
        ("slice", PropertyIdTag::MaskBorderSlice),
        ("width", PropertyIdTag::MaskBorderWidth),
        ("outset", PropertyIdTag::MaskBorderOutset),
        ("repeat", PropertyIdTag::MaskBorderRepeat),
        ("mode", PropertyIdTag::MaskBorderMode),
    ];

    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut mode: Option<MaskBorderMode> = None;
        let border_image = BorderImage::parse_with_callback(input, |p: &mut css::Parser| -> bool {
            if mode.is_none() {
                if let Some(value) = p.try_parse(MaskBorderMode::parse).as_value() {
                    mode = Some(value);
                    return true;
                }
            }
            false
        });

        if border_image.is_ok() || mode.is_some() {
            // PERF(port): Zig used `comptime BorderImage.default()` — const-eval default in Phase B
            let bi = border_image.unwrap_or(BorderImage::default());
            css::Result::ok(MaskBorder {
                source: bi.source,
                slice: bi.slice,
                width: bi.width,
                outset: bi.outset,
                repeat: bi.repeat,
                mode: mode.unwrap_or_else(MaskBorderMode::default),
            })
        } else {
            css::Result::err(input.new_custom_error(css::ParserError::InvalidDeclaration))
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        BorderImage::to_css_internal(
            &self.source,
            &self.slice,
            &self.width,
            &self.outset,
            &self.repeat,
            dest,
        )?;
        if self.mode != MaskBorderMode::default() {
            dest.write_char(' ')?;
            self.mode.to_css(dest)?;
        }
        Ok(())
    }

    // eql → #[derive(PartialEq)]
    // deepClone → #[derive(Clone)]
}

/// A value for the [-webkit-mask-composite](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-mask-composite)
/// property.
///
/// See also [MaskComposite](MaskComposite).
/// A value for the [-webkit-mask-composite](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-mask-composite)
/// property.
///
/// See also [MaskComposite](MaskComposite).
// TODO(port): css.DefineEnumProperty(@This()) → derive css enum-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum WebKitMaskComposite {
    #[css(name = "clear")]
    Clear,
    #[css(name = "copy")]
    Copy,
    /// Equivalent to `add` in the standard `mask-composite` syntax.
    #[css(name = "source-over")]
    SourceOver,
    /// Equivalent to `intersect` in the standard `mask-composite` syntax.
    #[css(name = "source-in")]
    SourceIn,
    /// Equivalent to `subtract` in the standard `mask-composite` syntax.
    #[css(name = "source-out")]
    SourceOut,
    #[css(name = "source-atop")]
    SourceAtop,
    #[css(name = "destination-over")]
    DestinationOver,
    #[css(name = "destination-in")]
    DestinationIn,
    #[css(name = "destination-out")]
    DestinationOut,
    #[css(name = "destination-atop")]
    DestinationAtop,
    /// Equivalent to `exclude` in the standard `mask-composite` syntax.
    #[css(name = "xor")]
    Xor,
}

/// A value for the [-webkit-mask-source-type](https://github.com/WebKit/WebKit/blob/6eece09a1c31e47489811edd003d1e36910e9fd3/Source/WebCore/css/CSSProperties.json#L6578-L6587)
/// property.
///
/// See also [MaskMode](MaskMode).
/// A value for the [-webkit-mask-source-type](https://github.com/WebKit/WebKit/blob/6eece09a1c31e47489811edd003d1e36910e9fd3/Source/WebCore/css/CSSProperties.json#L6578-L6587)
/// property.
///
/// See also [MaskMode](MaskMode).
// TODO(port): css.DefineEnumProperty(@This()) → derive css enum-property protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum WebKitMaskSourceType {
    /// Equivalent to `match-source` in the standard `mask-mode` syntax.
    #[css(name = "auto")]
    Auto,
    /// The luminance values of the mask image is used.
    #[css(name = "luminance")]
    Luminance,
    /// The alpha values of the mask image is used.
    #[css(name = "alpha")]
    Alpha,
}

pub fn get_webkit_mask_property(property_id: &PropertyId) -> Option<PropertyId> {
    // TODO(port): PropertyId variant naming — Zig uses kebab-case @"mask-border-source" etc.
    // Mapping to PascalCase variants here; Phase B should verify exact PropertyId enum shape.
    match property_id {
        PropertyId::MaskBorderSource => Some(PropertyId::MaskBoxImageSource(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderSlice => Some(PropertyId::MaskBoxImageSlice(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderWidth => Some(PropertyId::MaskBoxImageWidth(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderOutset => Some(PropertyId::MaskBoxImageOutset(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderRepeat => Some(PropertyId::MaskBoxImageRepeat(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorder => Some(PropertyId::MaskBoxImage(VendorPrefix::WEBKIT)),
        PropertyId::MaskComposite => Some(PropertyId::WebkitMaskComposite),
        PropertyId::MaskMode => Some(PropertyId::MaskSourceType(VendorPrefix::WEBKIT)),
        _ => None,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/masking.zig (572 lines)
//   confidence: medium
//   todos:      13
//   notes:      DefineEnumProperty/DeriveParse/DeriveToCss mapped to placeholder #[derive(css::Parse, css::ToCss)] + #[css(name=..)]; PropertyFieldMap/VendorPrefixMap comptime metadata flattened to assoc const slices; PropertyId/PropertyIdTag variant names guessed (kebab→PascalCase)
// ──────────────────────────────────────────────────────────────────────────
