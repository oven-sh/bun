#![warn(unused_must_use)]
use crate as css;
use crate::PrintErr;
use crate::Printer;

use crate::css_values::image::Image;
use crate::css_values::length::LengthOrNumber;
use crate::css_values::position::Position;
use crate::css_values::rect::Rect;

use crate::css_properties::background::BackgroundRepeat;
use crate::css_properties::background::BackgroundSize;
use crate::css_properties::border_image::BorderImage;
use crate::css_properties::border_image::BorderImageRepeat;
use crate::css_properties::border_image::BorderImageSideWidth;
use crate::css_properties::border_image::BorderImageSlice;

use crate::VendorPrefix;
use crate::generics::{CssEql, DeepClone};
use crate::properties::PropertyId;

/// A [`<geometry-box>`](https://www.w3.org/TR/css-masking-1/#typedef-geometry-box) value
/// as used in the `mask-clip` and `clip-path` properties.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum GeometryBox {
    /// The painted content is clipped to the content box.
    #[css(name = "border-box")]
    #[default]
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
    pub fn into_mask_clip(self) -> MaskClip {
        MaskClip::GeometryBox(self)
    }
}

/// A value for the [mask-mode](https://www.w3.org/TR/css-masking-1/#the-mask-mode) property.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskMode {
    /// The luminance values of the mask image is used.
    #[css(name = "luminance")]
    Luminance,
    /// The alpha values of the mask image is used.
    #[css(name = "alpha")]
    Alpha,
    /// If an SVG source is used, the value matches the `mask-type` property. Otherwise, the alpha values are used.
    #[css(name = "match-source")]
    #[default]
    MatchSource,
}

/// A value for the [mask-clip](https://www.w3.org/TR/css-masking-1/#the-mask-clip) property.
#[derive(Debug, Clone, Copy, PartialEq, Eq, css::Parse, css::ToCss)]
pub enum MaskClip {
    /// A geometry box.
    GeometryBox(GeometryBox),
    /// The painted content is not clipped.
    #[css(name = "no-clip")]
    NoClip,
}

/// A value for the [mask-composite](https://www.w3.org/TR/css-masking-1/#the-mask-composite) property.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskComposite {
    /// The source is placed over the destination.
    #[css(name = "add")]
    #[default]
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

/// A value for the [mask-type](https://www.w3.org/TR/css-masking-1/#the-mask-type) property.
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
// Debug/Clone/PartialEq derives gated on `Image`/`Position`/
// `BackgroundSize`/`BackgroundRepeat` gaining those derives upstream.
#[cfg_attr(any(), derive(Debug, Clone, PartialEq))]
#[derive(DeepClone, CssEql)]
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
    // Field names that carry a vendor prefix.

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
                if let Ok(value) = input.try_parse(Image::parse) {
                    image = Some(value);
                    continue;
                }
            }

            if position.is_none() {
                if let Ok(value) = input.try_parse(Position::parse) {
                    position = Some(value);
                    size = input
                        .try_parse(|i: &mut css::Parser| -> css::Result<BackgroundSize> {
                            i.expect_delim(b'/')?;
                            BackgroundSize::parse(i)
                        })
                        .ok();
                    continue;
                }
            }

            if repeat.is_none() {
                if let Ok(value) = input.try_parse(BackgroundRepeat::parse) {
                    repeat = Some(value);
                    continue;
                }
            }

            if origin.is_none() {
                if let Ok(value) = input.try_parse(GeometryBox::parse) {
                    origin = Some(value);
                    continue;
                }
            }

            if clip.is_none() {
                if let Ok(value) = input.try_parse(MaskClip::parse) {
                    clip = Some(value);
                    continue;
                }
            }

            if composite.is_none() {
                if let Ok(value) = input.try_parse(MaskComposite::parse) {
                    composite = Some(value);
                    continue;
                }
            }

            if mode.is_none() {
                if let Ok(value) = input.try_parse(MaskMode::parse) {
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

        Ok(Self {
            image: image.unwrap_or_default(),
            position: position.unwrap_or_default(),
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
            dest.write_char(b' ')?;
            self.position.to_css(dest)?;

            if self.size != BackgroundSize::default() {
                dest.delim(b'/', true)?;
                self.size.to_css(dest)?;
            }
        }

        if self.repeat != BackgroundRepeat::default() {
            dest.write_char(b' ')?;
            self.repeat.to_css(dest)?;
        }

        if self.origin != GeometryBox::BorderBox
            || self.clip != GeometryBox::BorderBox.into_mask_clip()
        {
            dest.write_char(b' ')?;
            self.origin.to_css(dest)?;

            if self.clip != self.origin.into_mask_clip() {
                dest.write_char(b' ')?;
                self.clip.to_css(dest)?;
            }
        }

        if self.composite != MaskComposite::default() {
            dest.write_char(b' ')?;
            self.composite.to_css(dest)?;
        }

        if self.mode != MaskMode::default() {
            dest.write_char(b' ')?;
            self.mode.to_css(dest)?;
        }

        Ok(())
    }

    // eql → #[derive(PartialEq)]
    // deepClone → #[derive(Clone)]
}

/// A value for the [mask-border-mode](https://www.w3.org/TR/css-masking-1/#the-mask-border-mode) property.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash, css::Parse, css::ToCss)]
pub enum MaskBorderMode {
    /// The luminance values of the mask image is used.
    #[css(name = "luminance")]
    Luminance,
    /// The alpha values of the mask image is used.
    #[css(name = "alpha")]
    #[default]
    Alpha,
}

/// A value for the [mask-border](https://www.w3.org/TR/css-masking-1/#the-mask-border) shorthand property.
// Debug/Clone/PartialEq derives gated on `Image`/`Rect<_>` gaining
// those derives upstream.
#[cfg_attr(any(), derive(Debug, Clone, PartialEq))]
#[derive(DeepClone, CssEql)]
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

    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut mode: Option<MaskBorderMode> = None;
        let border_image = BorderImage::parse_with_callback(input, |p: &mut css::Parser| -> bool {
            if mode.is_none() {
                if let Ok(value) = p.try_parse(MaskBorderMode::parse) {
                    mode = Some(value);
                    return true;
                }
            }
            false
        });

        if border_image.is_ok() || mode.is_some() {
            // PERF: could const-eval the default
            let bi = border_image.unwrap_or_else(|_| BorderImage::default());
            Ok(MaskBorder {
                source: bi.source,
                slice: bi.slice,
                width: bi.width,
                outset: bi.outset,
                repeat: bi.repeat,
                mode: mode.unwrap_or_default(),
            })
        } else {
            Err(input.new_custom_error(css::ParserError::invalid_declaration))
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
            dest.write_char(b' ')?;
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
    match property_id {
        PropertyId::MaskBorderSource => Some(PropertyId::MaskBoxImageSource(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderSlice => Some(PropertyId::MaskBoxImageSlice(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderWidth => Some(PropertyId::MaskBoxImageWidth(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderOutset => Some(PropertyId::MaskBoxImageOutset(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorderRepeat => Some(PropertyId::MaskBoxImageRepeat(VendorPrefix::WEBKIT)),
        PropertyId::MaskBorder => Some(PropertyId::MaskBoxImage(VendorPrefix::WEBKIT)),
        PropertyId::MaskComposite => Some(PropertyId::WebKitMaskComposite),
        PropertyId::MaskMode => Some(PropertyId::MaskSourceType(VendorPrefix::WEBKIT)),
        _ => None,
    }
}
