#![warn(unused_must_use)]
use crate as css;
use crate::PrintErr;
use crate::Printer;
use crate::SmallList;

use crate::css_values::image::Image;
use crate::css_values::length::LengthOrNumber;
use crate::css_values::percentage::NumberOrPercentage;
use crate::css_values::position::Position;
use crate::css_values::rect::Rect;

use crate::css_properties::background::BackgroundRepeat;
use crate::css_properties::background::BackgroundSize;
use crate::css_properties::border_image::BorderImage;
use crate::css_properties::border_image::BorderImageRepeat;
use crate::css_properties::border_image::BorderImageSideWidth;
use crate::css_properties::border_image::BorderImageSlice;

use crate::VendorPrefix;
use crate::css_properties::CSSWideKeyword;
use crate::css_properties::custom::{CustomPropertyName, TokenOrValue, UnparsedProperty};
use crate::css_properties::{Property, PropertyIdTag};
use crate::css_values::color::ColorFallbackKind;
use crate::generics::{CssEql, DeepClone};
use crate::prefixes::Feature;
use crate::properties::PropertyId;
use crate::small_list::ImageFallback;
use crate::targets::Targets;
use bun_alloc::{Arena, ArenaVecExt as _};

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
    pub(crate) fn into_mask_clip(self) -> MaskClip {
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
    pub(crate) image: Image,
    /// The position of the mask.
    pub(crate) position: Position,
    /// The size of the mask image.
    pub(crate) size: BackgroundSize,
    /// How the mask repeats.
    pub(crate) repeat: BackgroundRepeat,
    /// The box in which the mask is clipped.
    pub(crate) clip: MaskClip,
    /// The origin of the mask.
    pub(crate) origin: GeometryBox,
    /// How the mask is composited with the element.
    pub(crate) composite: MaskComposite,
    /// How the mask image is interpreted.
    pub(crate) mode: MaskMode,
}

impl Mask {
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
    pub(crate) source: Image,
    /// The offsets that define where the image is sliced.
    pub(crate) slice: BorderImageSlice,
    /// The width of the mask image.
    pub(crate) width: Rect<BorderImageSideWidth>,
    /// The amount that the image extends beyond the border box.
    pub(crate) outset: Rect<LengthOrNumber>,
    /// How the mask image is scaled and tiled.
    pub(crate) repeat: BorderImageRepeat,
    /// How the mask image is interpreted.
    pub(crate) mode: MaskBorderMode,
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

pub(crate) fn get_webkit_mask_property(property_id: &PropertyId) -> Option<PropertyId> {
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

impl From<MaskComposite> for WebKitMaskComposite {
    fn from(composite: MaskComposite) -> WebKitMaskComposite {
        match composite {
            MaskComposite::Add => WebKitMaskComposite::SourceOver,
            MaskComposite::Subtract => WebKitMaskComposite::SourceOut,
            MaskComposite::Intersect => WebKitMaskComposite::SourceIn,
            MaskComposite::Exclude => WebKitMaskComposite::Xor,
        }
    }
}

impl From<MaskMode> for WebKitMaskSourceType {
    fn from(mode: MaskMode) -> WebKitMaskSourceType {
        match mode {
            MaskMode::Luminance => WebKitMaskSourceType::Luminance,
            MaskMode::Alpha => WebKitMaskSourceType::Alpha,
            MaskMode::MatchSource => WebKitMaskSourceType::Auto,
        }
    }
}

impl ImageFallback for Mask {
    #[inline]
    fn get_image(&self) -> &Image {
        &self.image
    }
    fn with_image(&self, _arena: &Arena, image: Image) -> Self {
        Mask {
            image,
            position: self.position.clone(),
            size: self.size.clone(),
            repeat: self.repeat,
            clip: self.clip,
            origin: self.origin,
            composite: self.composite,
            mode: self.mode,
        }
    }
    fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> Self {
        self.with_image(arena, self.image.get_fallback(arena, kind))
    }
    fn get_necessary_fallbacks(&self, targets: &Targets) -> ColorFallbackKind {
        self.image.get_necessary_fallbacks(targets)
    }
}

const NONE: VendorPrefix = VendorPrefix::NONE;
const WEBKIT: VendorPrefix = VendorPrefix::WEBKIT;

/// A longhand or shorthand that [`MaskHandler`] tracks.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Slot {
    Image,
    Position,
    Size,
    Repeat,
    Clip,
    Origin,
    Mode,
    Composite,
    Mask,
    BorderSource,
    BorderSlice,
    BorderWidth,
    BorderOutset,
    BorderRepeat,
    Border,
}

const SLOT_COUNT: usize = Slot::Border as usize + 1;
const SIX: [Slot; 6] = [
    Slot::Image,
    Slot::Position,
    Slot::Size,
    Slot::Repeat,
    Slot::Clip,
    Slot::Origin,
];
const BORDER_LONGHANDS: [Slot; 5] = [
    Slot::BorderSource,
    Slot::BorderSlice,
    Slot::BorderWidth,
    Slot::BorderOutset,
    Slot::BorderRepeat,
];
/// The longhands that the old `-webkit-mask` shorthand sets. It never had the composite.
const WEBKIT_MASK: u16 = 0b111_1111;
const BORDER: u16 = 0b11111 << Slot::BorderSource as u16;

impl Slot {
    const fn bit(self) -> u16 {
        1 << self as u16
    }

    /// The longhands that a `-webkit-` declaration of this slot sets.
    const fn longhands(self) -> u16 {
        match self {
            Slot::Mask => WEBKIT_MASK,
            Slot::Border => BORDER,
            _ => self.bit(),
        }
    }

    /// The slots whose merge ends when a line of this slot is written: a shorthand resets its longhands.
    const fn overlaps(self) -> u16 {
        match self {
            // Also the border group: the standard `mask` resets `mask-border`.
            Slot::Mask => WEBKIT_MASK | Slot::Composite.bit() | BORDER | Slot::Border.bit(),
            Slot::Border => BORDER | Slot::Mask.bit(),
            Slot::BorderSource
            | Slot::BorderSlice
            | Slot::BorderWidth
            | Slot::BorderOutset
            | Slot::BorderRepeat => Slot::Border.bit() | Slot::Mask.bit(),
            _ => Slot::Mask.bit(),
        }
    }

    /// Whether the `-webkit-` form is the same row with a prefix bit. The other slots have a second row for it.
    const fn has_prefix_bits(self) -> bool {
        matches!(
            self,
            Slot::Image
                | Slot::Position
                | Slot::Size
                | Slot::Repeat
                | Slot::Clip
                | Slot::Origin
                | Slot::Mask
        )
    }
}

/// The slot of a mask declaration and the names it is written with.
fn slot_of(id: PropertyId) -> Option<(Slot, VendorPrefix)> {
    Some(match id {
        PropertyId::MaskImage(names) => (Slot::Image, names),
        PropertyId::MaskPosition(names) => (Slot::Position, names),
        PropertyId::MaskSize(names) => (Slot::Size, names),
        PropertyId::MaskRepeat(names) => (Slot::Repeat, names),
        PropertyId::MaskClip(names) => (Slot::Clip, names),
        PropertyId::MaskOrigin(names) => (Slot::Origin, names),
        PropertyId::Mask(names) => (Slot::Mask, names),
        PropertyId::MaskMode => (Slot::Mode, NONE),
        PropertyId::MaskComposite => (Slot::Composite, NONE),
        PropertyId::WebKitMaskComposite => (Slot::Composite, WEBKIT),
        PropertyId::MaskBorderSource => (Slot::BorderSource, NONE),
        PropertyId::MaskBorderSlice => (Slot::BorderSlice, NONE),
        PropertyId::MaskBorderWidth => (Slot::BorderWidth, NONE),
        PropertyId::MaskBorderOutset => (Slot::BorderOutset, NONE),
        PropertyId::MaskBorderRepeat => (Slot::BorderRepeat, NONE),
        PropertyId::MaskBorder => (Slot::Border, NONE),
        // Without the prefix these six are names that no browser has.
        PropertyId::MaskSourceType(names) if names == WEBKIT => (Slot::Mode, WEBKIT),
        PropertyId::MaskBoxImageSource(names) if names == WEBKIT => (Slot::BorderSource, WEBKIT),
        PropertyId::MaskBoxImageSlice(names) if names == WEBKIT => (Slot::BorderSlice, WEBKIT),
        PropertyId::MaskBoxImageWidth(names) if names == WEBKIT => (Slot::BorderWidth, WEBKIT),
        PropertyId::MaskBoxImageOutset(names) if names == WEBKIT => (Slot::BorderOutset, WEBKIT),
        PropertyId::MaskBoxImageRepeat(names) if names == WEBKIT => (Slot::BorderRepeat, WEBKIT),
        PropertyId::MaskBoxImage(names) if names == WEBKIT => (Slot::Border, WEBKIT),
        _ => return None,
    })
}

fn id_of(declaration: &Property) -> PropertyId {
    match declaration {
        Property::Unparsed(unparsed) => unparsed.property_id,
        _ => declaration.property_id(),
    }
}

/// The names of a declaration whose row has prefix bits.
fn names_mut(declaration: &mut Property) -> Option<&mut VendorPrefix> {
    match declaration {
        Property::MaskImage(value) => Some(&mut value.1),
        Property::MaskPosition(value) => Some(&mut value.1),
        Property::MaskSize(value) => Some(&mut value.1),
        Property::MaskRepeat(value) => Some(&mut value.1),
        Property::MaskClip(value) => Some(&mut value.1),
        Property::MaskOrigin(value) => Some(&mut value.1),
        Property::Mask(value) => Some(&mut value.1),
        Property::Unparsed(unparsed) => unparsed.property_id.prefix_slot_mut(),
        _ => None,
    }
}

/// Whether two declarations of one slot have the same value. The names can differ.
fn same_value(a: &Property, b: &Property) -> bool {
    use Property as P;
    use css::generic::eql;
    macro_rules! two_rows {
        ($(($standard:ident, $webkit:ident)),+) => {
            match (a, b) {
                $(
                    (P::$standard(a), P::$standard(b)) => eql(a, b),
                    (P::$webkit(a), P::$webkit(b)) => eql(&a.0, &b.0),
                    (P::$standard(a), P::$webkit(b)) | (P::$webkit(b), P::$standard(a)) => eql(a, &b.0),
                )+
                _ => false,
            }
        };
    }
    match (a, b) {
        (P::MaskImage(a), P::MaskImage(b)) => eql(&a.0, &b.0),
        (P::MaskPosition(a), P::MaskPosition(b)) => eql(&a.0, &b.0),
        (P::MaskSize(a), P::MaskSize(b)) => eql(&a.0, &b.0),
        (P::MaskRepeat(a), P::MaskRepeat(b)) => eql(&a.0, &b.0),
        (P::MaskClip(a), P::MaskClip(b)) => eql(&a.0, &b.0),
        (P::MaskOrigin(a), P::MaskOrigin(b)) => eql(&a.0, &b.0),
        (P::Mask(a), P::Mask(b)) => eql(&a.0, &b.0),
        (P::MaskMode(a), P::MaskMode(b)) => eql(a, b),
        (P::MaskSourceType(a), P::MaskSourceType(b)) => eql(&a.0, &b.0),
        (P::MaskMode(a), P::MaskSourceType(b)) | (P::MaskSourceType(b), P::MaskMode(a)) => a
            .iter()
            .map(|mode| WebKitMaskSourceType::from(*mode))
            .eq(b.0.iter().copied()),
        (P::MaskComposite(a), P::MaskComposite(b)) => eql(a, b),
        (P::WebKitMaskComposite(a), P::WebKitMaskComposite(b)) => eql(a, b),
        (P::MaskComposite(a), P::WebKitMaskComposite(b))
        | (P::WebKitMaskComposite(b), P::MaskComposite(a)) => a
            .iter()
            .map(|composite| WebKitMaskComposite::from(*composite))
            .eq(b.iter().copied()),
        (P::MaskBorder(a), P::MaskBorder(b)) => eql(a, b),
        (P::MaskBoxImage(a), P::MaskBoxImage(b)) => eql(&a.0, &b.0),
        (P::MaskBorder(a), P::MaskBoxImage(b)) | (P::MaskBoxImage(b), P::MaskBorder(a)) => {
            eql(&a.source, &b.0.source)
                && eql(&a.slice, &b.0.slice)
                && eql(&a.width, &b.0.width)
                && eql(&a.outset, &b.0.outset)
                && eql(&a.repeat, &b.0.repeat)
        }
        (P::Unparsed(a), P::Unparsed(b)) => a.value.eql(&b.value),
        _ => two_rows!(
            (MaskBorderSource, MaskBoxImageSource),
            (MaskBorderSlice, MaskBoxImageSlice),
            (MaskBorderWidth, MaskBoxImageWidth),
            (MaskBorderOutset, MaskBoxImageOutset),
            (MaskBorderRepeat, MaskBoxImageRepeat)
        ),
    }
}

/// The `-webkit-` declaration of a standard declaration whose prefixed form is another row.
fn webkit_row(declaration: &Property, arena: &Arena) -> Option<Property> {
    use css::generic::deep_clone;
    Some(match declaration {
        Property::MaskComposite(list) => Property::WebKitMaskComposite(
            list.iter().map(|composite| (*composite).into()).collect(),
        ),
        Property::MaskMode(list) => {
            Property::MaskSourceType((list.iter().map(|mode| (*mode).into()).collect(), WEBKIT))
        }
        Property::MaskBorderSource(value) => {
            Property::MaskBoxImageSource((deep_clone(value, arena), WEBKIT))
        }
        Property::MaskBorderSlice(value) => {
            Property::MaskBoxImageSlice((deep_clone(value, arena), WEBKIT))
        }
        Property::MaskBorderWidth(value) => {
            Property::MaskBoxImageWidth((deep_clone(value, arena), WEBKIT))
        }
        Property::MaskBorderOutset(value) => {
            Property::MaskBoxImageOutset((deep_clone(value, arena), WEBKIT))
        }
        Property::MaskBorderRepeat(value) => {
            Property::MaskBoxImageRepeat((deep_clone(value, arena), WEBKIT))
        }
        // Unlike lightningcss: a `var()` composite or mode is copied too, as esbuild and autoprefixer do.
        Property::Unparsed(unparsed) => Property::Unparsed(
            unparsed.with_property_id(arena, get_webkit_mask_property(&unparsed.property_id)?),
        ),
        _ => return None,
    })
}

/// One of the six `-webkit-mask-*` longhands of a `mask` value.
fn webkit_longhand(slot: Slot, masks: &SmallList<Mask, 1>, arena: &Arena) -> Property {
    let masks = masks.iter();
    match slot {
        Slot::Image => Property::MaskImage((
            masks.map(|mask| mask.image.deep_clone(arena)).collect(),
            WEBKIT,
        )),
        Slot::Position => {
            Property::MaskPosition((masks.map(|mask| mask.position.clone()).collect(), WEBKIT))
        }
        Slot::Size => Property::MaskSize((masks.map(|mask| mask.size.clone()).collect(), WEBKIT)),
        Slot::Repeat => Property::MaskRepeat((masks.map(|mask| mask.repeat).collect(), WEBKIT)),
        Slot::Clip => Property::MaskClip((masks.map(|mask| mask.clip).collect(), WEBKIT)),
        _ => Property::MaskOrigin((masks.map(|mask| mask.origin).collect(), WEBKIT)),
    }
}

/// A `-webkit-mask-box-image-*` longhand of a `mask-border` value. A slice or width that the value does not give is 0 or `auto`.
fn webkit_border_longhand(slot: Slot, border: &MaskBorder, arena: &Arena) -> Property {
    use css::generic::{deep_clone, eql};
    match slot {
        Slot::BorderSource => {
            Property::MaskBoxImageSource((deep_clone(&border.source, arena), WEBKIT))
        }
        Slot::BorderSlice if border.slice.eql(&BorderImageSlice::default()) => {
            let slice = BorderImageSlice {
                offsets: Rect::all(NumberOrPercentage::Number(0.0)),
                fill: false,
            };
            Property::MaskBoxImageSlice((slice, WEBKIT))
        }
        Slot::BorderSlice => {
            Property::MaskBoxImageSlice((deep_clone(&border.slice, arena), WEBKIT))
        }
        Slot::BorderWidth if eql(&border.width, &Rect::all(BorderImageSideWidth::default())) => {
            Property::MaskBoxImageWidth((Rect::all(BorderImageSideWidth::Auto), WEBKIT))
        }
        Slot::BorderWidth => {
            Property::MaskBoxImageWidth((deep_clone(&border.width, arena), WEBKIT))
        }
        Slot::BorderOutset => {
            Property::MaskBoxImageOutset((deep_clone(&border.outset, arena), WEBKIT))
        }
        _ => Property::MaskBoxImageRepeat((deep_clone(&border.repeat, arena), WEBKIT)),
    }
}

/// `initial` for one `-webkit-mask-box-image*` name.
fn webkit_border_initial(slot: Slot) -> Property {
    let property_id = match slot {
        Slot::BorderSource => PropertyId::MaskBoxImageSource(WEBKIT),
        Slot::BorderSlice => PropertyId::MaskBoxImageSlice(WEBKIT),
        Slot::BorderWidth => PropertyId::MaskBoxImageWidth(WEBKIT),
        Slot::BorderOutset => PropertyId::MaskBoxImageOutset(WEBKIT),
        Slot::BorderRepeat => PropertyId::MaskBoxImageRepeat(WEBKIT),
        _ => PropertyId::MaskBoxImage(WEBKIT),
    };
    Property::Unparsed(UnparsedProperty {
        property_id,
        value: css::TokenList {
            v: vec![TokenOrValue::Token(css::Token::Ident(b"initial"))],
        },
    })
}

/// The fallback lines that an image value needs: prefixed copies of the image, and colors.
#[derive(Clone, Copy, Default)]
struct FallbackKinds {
    prefixes: VendorPrefix,
    colors: ColorFallbackKind,
}

impl FallbackKinds {
    fn of<'a>(images: impl Iterator<Item = &'a Image>, targets: &Targets) -> FallbackKinds {
        let mut prefixes = VendorPrefix::empty();
        let mut colors = ColorFallbackKind::empty();
        for image in images {
            prefixes |= image.get_necessary_prefixes(targets);
            colors |= image.get_necessary_fallbacks(targets);
        }
        FallbackKinds {
            prefixes: if prefixes.contains(NONE) {
                prefixes.difference(NONE)
            } else {
                VendorPrefix::empty()
            },
            colors: colors.intersection(ColorFallbackKind::RGB | ColorFallbackKind::P3),
        }
    }
}

/// The names that a fallback value is written under: a prefixed image only under the name with that prefix.
fn fallback_names<'a>(
    images: impl Iterator<Item = &'a Image>,
    names: VendorPrefix,
) -> VendorPrefix {
    let own = images
        .fold(VendorPrefix::empty(), |prefixes, image| {
            prefixes | image.get_vendor_prefix()
        })
        .difference(NONE)
        .intersection(names);
    if own.is_empty() { names } else { own }
}

const MASK_IMAGES: usize = 0;
const BORDER_IMAGES: usize = 1;

/// Unlike lightningcss: each mask declaration stays where it is written. No fold, drop or move can change a winner or a second pass.
#[derive(Default)]
pub struct MaskHandler {
    /// Whether the block has a mask declaration in this list or in the other list.
    open: bool,
    /// Whether the block has a `-webkit-mask-composite` line since `all`.
    webkit_composite: bool,
    /// Whether the other list of the block (`!important` or not) gets a `-webkit-mask-composite` line.
    webkit_composite_elsewhere: bool,
    /// A declaration merges only into a line at or after this index.
    floor: u32,
    /// The index + 1 of the last line of each slot: under the standard name, under the `-webkit-` name.
    last: [[u32; 2]; SLOT_COUNT],
    /// The longhands that the block declared with `-webkit-` since `all`.
    written: u16,
    /// The longhands that the other list of the block declares with `-webkit-`.
    elsewhere: u16,
    /// The mask-border longhands that got a `-webkit-mask-box-image*` copy from this handler since `all`.
    copied: u16,
    /// The fallback kinds that every earlier image of the mask group, and of the border group, needed.
    images: [Option<FallbackKinds>; 2],
}

const _: () = assert!(core::mem::size_of::<MaskHandler>() <= 144);

/// Matches the 27 mask rows, which are next to each other in `Property`: one range test.
macro_rules! mask_rows {
    () => {
        Property::MaskImage(..)
            | Property::MaskMode(..)
            | Property::MaskRepeat(..)
            | Property::MaskPositionX(..)
            | Property::MaskPositionY(..)
            | Property::MaskPosition(..)
            | Property::MaskClip(..)
            | Property::MaskOrigin(..)
            | Property::MaskSize(..)
            | Property::MaskComposite(..)
            | Property::MaskType(..)
            | Property::Mask(..)
            | Property::MaskBorderSource(..)
            | Property::MaskBorderMode(..)
            | Property::MaskBorderSlice(..)
            | Property::MaskBorderWidth(..)
            | Property::MaskBorderOutset(..)
            | Property::MaskBorderRepeat(..)
            | Property::MaskBorder(..)
            | Property::WebKitMaskComposite(..)
            | Property::MaskSourceType(..)
            | Property::MaskBoxImage(..)
            | Property::MaskBoxImageSource(..)
            | Property::MaskBoxImageSlice(..)
            | Property::MaskBoxImageWidth(..)
            | Property::MaskBoxImageOutset(..)
            | Property::MaskBoxImageRepeat(..)
    };
}

const fn is_mask_tag(tag: PropertyIdTag) -> bool {
    tag as u16 >= PropertyIdTag::MaskImage as u16
        && tag as u16 <= PropertyIdTag::MaskBoxImageRepeat as u16
}

impl MaskHandler {
    /// Whether `handle_property` has to see `property`. A name that is not a mask matters only after a mask declaration.
    #[inline(always)]
    pub(crate) fn wants(&self, property: &Property) -> bool {
        match property {
            mask_rows!() => true,
            Property::Unparsed(unparsed) => {
                let tag = unparsed.property_id.tag();
                is_mask_tag(tag) || (self.open && tag == PropertyIdTag::All)
            }
            Property::Custom(_) | Property::All(_) => self.open,
            _ => false,
        }
    }

    #[inline(never)]
    pub(crate) fn handle_property(
        &mut self,
        property: &mut Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        let targets = context.targets;
        if targets.browsers.is_none() {
            return false;
        }
        if let Property::Custom(custom) = property {
            match &custom.name {
                CustomPropertyName::Custom(_) => {}
                name if name.as_str().eq_ignore_ascii_case(b"all") => self.see_all(dest),
                // An unknown name can be one more spelling of a mask longhand (`-webkit-mask-position-x`).
                CustomPropertyName::Unknown(_) => self.floor = dest.len() as u32 + 1,
            }
            return false;
        }
        let id = id_of(property);
        let Some((slot, names)) = slot_of(id) else {
            match id.tag() {
                PropertyIdTag::All => self.see_all(dest),
                PropertyIdTag::MaskPositionX | PropertyIdTag::MaskPositionY => {
                    self.end(Slot::Position.bit() | Slot::Mask.bit())
                }
                PropertyIdTag::MaskBorderMode => self.end(Slot::Border.bit() | Slot::Mask.bit()),
                tag if is_mask_tag(tag) && tag != PropertyIdTag::MaskType => {
                    self.floor = dest.len() as u32 + 1
                }
                _ => {}
            }
            return false;
        };

        self.open = true;
        if names.contains(WEBKIT) {
            self.written |= slot.longhands();
            self.copied &= !slot.longhands();
        }
        // A repeat of the last line of its slot changes nothing: it gets no copies and is dropped.
        let own = usize::from(!slot.has_prefix_bits() && names == WEBKIT);
        if let Some(previous) = self.line(self.last[slot as usize][own])
            && same_value(&dest[previous], property)
            && slot_of(id_of(&dest[previous])).is_some_and(|(_, written)| written.contains(names))
        {
            return true;
        }
        // Unlike lightningcss: a `var()` value gets no `@supports` color fallback. Bun would nest one more on each pass.
        let copy = names == NONE && targets.prefixes(NONE, Feature::Mask).contains(WEBKIT);
        let declaration = core::mem::replace(property, Property::All(CSSWideKeyword::RevertLayer));
        match slot {
            Slot::Mask => self.mask(declaration, names, copy, dest, &targets),
            Slot::Border => self.border(declaration, names, copy, dest, &targets),
            slot if slot.has_prefix_bits() => {
                self.longhand(slot, declaration, names, copy, dest, &targets)
            }
            slot => self.two_rows(slot, declaration, names, copy, dest, &targets),
        }
        true
    }

    /// Records the `-webkit-` names in the other list of the block: each list has its own handler.
    pub(crate) fn see_other_list(&mut self, declarations: &css::DeclarationList) {
        for declaration in declarations.iter() {
            if !matches!(declaration, mask_rows!() | Property::Unparsed(_)) {
                continue;
            }
            let Some((slot, names)) = slot_of(id_of(declaration)) else {
                continue;
            };
            self.open = true;
            if names.contains(WEBKIT) {
                self.elsewhere |= slot.longhands();
            }
            self.webkit_composite_elsewhere |= match declaration {
                Property::Mask((masks, names)) => {
                    names.contains(NONE)
                        && masks.any(|mask| mask.composite != MaskComposite::default())
                }
                _ => slot == Slot::Composite,
            };
        }
    }

    pub(crate) fn finalize(&mut self) {
        if self.open {
            *self = MaskHandler::default();
        }
    }

    /// `all` resets every longhand, so the block starts again. What the other list wrote stays.
    fn see_all(&mut self, dest: &css::DeclarationList) {
        *self = MaskHandler {
            open: true,
            floor: dest.len() as u32 + 1,
            elsewhere: self.elsewhere,
            webkit_composite_elsewhere: self.webkit_composite_elsewhere,
            ..MaskHandler::default()
        };
    }

    fn covered(&self, slots: u16) -> bool {
        (self.written | self.elsewhere) & slots != 0
    }

    /// The index in `dest` of a line in `last`, when a declaration can still merge into it.
    fn line(&self, index: u32) -> Option<usize> {
        (index > self.floor).then(|| index as usize - 1)
    }

    fn end(&mut self, slots: u16) {
        for (slot, last) in self.last.iter_mut().enumerate() {
            if slots & (1 << slot) != 0 {
                *last = [0, 0];
            }
        }
    }

    /// Writes one line, or merges it into the last line of its slot when the value is equal and nothing in between overrides it.
    fn write(
        &mut self,
        slot: Slot,
        names: VendorPrefix,
        declaration: Property,
        dest: &mut css::DeclarationList,
    ) {
        let last = self.last[slot as usize];
        let index = dest.len() as u32 + 1;
        if slot.has_prefix_bits() {
            if let Some(previous) = self.line(last[0])
                && same_value(&dest[previous], &declaration)
            {
                if let Some(written) = names_mut(&mut dest[previous]) {
                    written.insert(names);
                }
                return;
            }
            self.last[slot as usize] = [index, 0];
        } else {
            let own = usize::from(names == WEBKIT);
            self.webkit_composite |= slot == Slot::Composite && names == WEBKIT;
            let same = match (self.line(last[own]), self.line(last[1 - own])) {
                (Some(previous), _) => {
                    if same_value(&dest[previous], &declaration) {
                        return;
                    }
                    false
                }
                (None, Some(other)) => same_value(&dest[other], &declaration),
                (None, None) => false,
            };
            let mut last = if same { last } else { [0, 0] };
            last[own] = index;
            self.last[slot as usize] = last;
        }
        self.end(slot.overlaps());
        dest.push(declaration);
    }

    /// Unlike lightningcss: a value gets its fallbacks when no earlier image is one that a browser in need of them can read.
    fn allows_fallbacks(&mut self, group: usize, needs: FallbackKinds) -> bool {
        let (allowed, earlier) = match self.images[group] {
            None => (true, needs),
            Some(earlier) => (
                earlier.prefixes.contains(needs.prefixes) && earlier.colors.contains(needs.colors),
                FallbackKinds {
                    prefixes: earlier.prefixes.intersection(needs.prefixes),
                    colors: earlier.colors.intersection(needs.colors),
                },
            ),
        };
        self.images[group] = Some(earlier);
        allowed
    }

    fn list_fallbacks<T: ImageFallback>(
        &mut self,
        value: &mut SmallList<T, 1>,
        arena: &Arena,
        targets: &Targets,
    ) -> Vec<SmallList<T, 1>> {
        let needs = FallbackKinds::of(value.iter().map(|item| item.get_image()), targets);
        if self.allows_fallbacks(MASK_IMAGES, needs) {
            crate::small_list::get_fallbacks(value, arena, targets)
        } else {
            Vec::new()
        }
    }

    fn border_fallbacks(
        &mut self,
        source: &mut Image,
        arena: &Arena,
        targets: &Targets,
    ) -> SmallList<Image, 6> {
        let needs = FallbackKinds::of(core::iter::once(&*source), targets);
        if self.allows_fallbacks(BORDER_IMAGES, needs) {
            source.get_fallbacks(arena, targets)
        } else {
            SmallList::default()
        }
    }

    /// `mask-image`, `mask-position`, `mask-size`, `mask-repeat`, `mask-clip` or `mask-origin`.
    fn longhand(
        &mut self,
        slot: Slot,
        mut declaration: Property,
        names: VendorPrefix,
        copy: bool,
        dest: &mut css::DeclarationList,
        targets: &Targets,
    ) {
        // Unlike lightningcss: a written prefix stays, and a prefix that the block already wrote is not added.
        let names = if copy && !self.covered(slot.bit()) {
            names | WEBKIT
        } else {
            names
        };
        match &mut declaration {
            Property::MaskImage((images, _)) => {
                for fallback in self.list_fallbacks(images, dest.bump(), targets) {
                    let names = fallback_names(fallback.iter(), names);
                    self.write(slot, names, Property::MaskImage((fallback, names)), dest);
                }
            }
            _ if slot == Slot::Image => {
                self.allows_fallbacks(MASK_IMAGES, FallbackKinds::default());
            }
            _ => {}
        }
        if let Some(written) = names_mut(&mut declaration) {
            *written = names;
        }
        self.write(slot, names, declaration, dest);
    }

    /// A longhand whose `-webkit-` form is another row: the composite, the mode, the mask-border longhands.
    fn two_rows(
        &mut self,
        slot: Slot,
        mut declaration: Property,
        names: VendorPrefix,
        copy: bool,
        dest: &mut css::DeclarationList,
        targets: &Targets,
    ) {
        let arena = dest.bump();
        let copy = copy && !self.covered(slot.bit());
        match &mut declaration {
            Property::MaskBorderSource(source) => {
                for fallback in self.border_fallbacks(source, arena, targets) {
                    if copy {
                        let webkit = (fallback.deep_clone(arena), WEBKIT);
                        self.write(slot, WEBKIT, Property::MaskBoxImageSource(webkit), dest);
                    }
                    self.write(slot, NONE, Property::MaskBorderSource(fallback), dest);
                }
            }
            Property::MaskBoxImageSource((source, _)) => {
                for fallback in self.border_fallbacks(source, arena, targets) {
                    self.write(
                        slot,
                        WEBKIT,
                        Property::MaskBoxImageSource((fallback, WEBKIT)),
                        dest,
                    );
                }
            }
            _ if slot == Slot::BorderSource => {
                self.allows_fallbacks(BORDER_IMAGES, FallbackKinds::default());
            }
            _ => {}
        }
        if copy && let Some(webkit) = webkit_row(&declaration, arena) {
            self.write(slot, WEBKIT, webkit, dest);
            self.copied |= slot.bit() & BORDER;
        }
        self.write(slot, names, declaration, dest);
    }

    /// `mask` or `-webkit-mask`.
    fn mask(
        &mut self,
        declaration: Property,
        names: VendorPrefix,
        copy: bool,
        dest: &mut css::DeclarationList,
        targets: &Targets,
    ) {
        let arena = dest.bump();
        let standard = names.contains(NONE);
        if standard {
            self.reset_copied_border(dest);
        }
        // The copy is the old shorthand, unless the block wrote a `-webkit-` longhand that it would reset.
        let shorthand = copy && !self.covered(WEBKIT_MASK);
        let mut masks = match declaration {
            Property::Mask((masks, _)) => masks,
            mut unparsed => {
                self.allows_fallbacks(MASK_IMAGES, FallbackKinds::default());
                let names = if shorthand { names | WEBKIT } else { names };
                if let Some(written) = names_mut(&mut unparsed) {
                    *written = names;
                }
                return self.write(Slot::Mask, names, unparsed, dest);
            }
        };

        // Unlike lightningcss: a `-webkit-mask` keeps a composite or mode keyword. Only an alias of `mask` takes one.
        let need = standard && targets.prefixes(NONE, Feature::Mask).contains(WEBKIT);
        let has_composite = masks.any(|mask| mask.composite != MaskComposite::default());
        let has_mode = masks.any(|mask| mask.mode != MaskMode::default());
        // Unlike lightningcss: the old shorthand does not reset the composite, so the copy states it after an earlier line.
        let composite = need
            && !self.covered(Slot::Composite.bit())
            && (has_composite || self.webkit_composite || self.webkit_composite_elsewhere);
        let mode = need && !self.covered(Slot::Mode.bit()) && (has_mode || (copy && !shorthand));
        let split = has_composite || has_mode || composite || mode;
        let to = if copy { names | WEBKIT } else { names };

        let fallbacks = self.list_fallbacks(&mut masks, arena, targets);
        let count = fallbacks.len();
        for (index, masks) in fallbacks
            .into_iter()
            .chain(core::iter::once(masks))
            .enumerate()
        {
            // Unlike lightningcss: the value itself keeps every name, also when its image has a prefix.
            let to = if index < count {
                fallback_names(masks.iter().map(|mask| &mask.image), to)
            } else {
                to
            };
            let own = to.intersection(names);
            // A line that no shorthand resets is the same for each fallback: it is written once.
            let first = shorthand || index == 0;
            if copy && to.contains(WEBKIT) {
                if shorthand && !split && own.contains(NONE) {
                    let names = own | WEBKIT;
                    self.write(Slot::Mask, names, Property::Mask((masks, names)), dest);
                    continue;
                }
                if shorthand {
                    // The old shorthand takes no composite and no mode: they are lines of their own.
                    let webkit = masks.iter().map(|mask| Mask {
                        composite: MaskComposite::default(),
                        mode: MaskMode::default(),
                        ..mask.deep_clone(arena)
                    });
                    self.write(
                        Slot::Mask,
                        WEBKIT,
                        Property::Mask((webkit.collect(), WEBKIT)),
                        dest,
                    );
                } else {
                    for slot in SIX {
                        if !self.covered(slot.bit()) && (first || slot == Slot::Image) {
                            self.write(slot, WEBKIT, webkit_longhand(slot, &masks, arena), dest);
                        }
                    }
                }
            }
            if composite && first {
                let webkit = masks.iter().map(|mask| mask.composite.into()).collect();
                self.write(
                    Slot::Composite,
                    WEBKIT,
                    Property::WebKitMaskComposite(webkit),
                    dest,
                );
            }
            if mode && first {
                let webkit = (masks.iter().map(|mask| mask.mode.into()).collect(), WEBKIT);
                self.write(Slot::Mode, WEBKIT, Property::MaskSourceType(webkit), dest);
            }
            if !own.is_empty() {
                self.write(Slot::Mask, own, Property::Mask((masks, own)), dest);
            }
        }
    }

    /// `mask-border` or `-webkit-mask-box-image`.
    fn border(
        &mut self,
        declaration: Property,
        names: VendorPrefix,
        copy: bool,
        dest: &mut css::DeclarationList,
        targets: &Targets,
    ) {
        let arena = dest.bump();
        let uncovered = BORDER & !(self.written | self.elsewhere);
        match declaration {
            Property::MaskBorder(mut border) => {
                let to = if copy { NONE | WEBKIT } else { NONE };
                let mut longhands = uncovered;
                for source in self.border_fallbacks(&mut border.source, arena, targets) {
                    let names = fallback_names(core::iter::once(&source), to);
                    let fallback = MaskBorder {
                        source,
                        ..border.deep_clone(arena)
                    };
                    self.write_border(fallback, names, longhands, dest);
                    // The longhand copies are the same for each fallback, except for the source.
                    if uncovered != BORDER {
                        longhands &= Slot::BorderSource.bit();
                    }
                }
                self.write_border(border, to, longhands, dest);
                if copy {
                    self.copied |= uncovered;
                }
            }
            Property::MaskBoxImage((mut border, _)) => {
                for source in self.border_fallbacks(&mut border.source, arena, targets) {
                    let fallback = BorderImage {
                        source,
                        ..border.deep_clone(arena)
                    };
                    self.write(
                        Slot::Border,
                        WEBKIT,
                        Property::MaskBoxImage((fallback, WEBKIT)),
                        dest,
                    );
                }
                self.write(
                    Slot::Border,
                    WEBKIT,
                    Property::MaskBoxImage((border, WEBKIT)),
                    dest,
                );
            }
            unparsed => {
                self.allows_fallbacks(BORDER_IMAGES, FallbackKinds::default());
                // A `var()` cannot be split into the longhands that the block did not write.
                if copy
                    && uncovered == BORDER
                    && let Some(webkit) = webkit_row(&unparsed, arena)
                {
                    self.write(Slot::Border, WEBKIT, webkit, dest);
                    self.copied |= BORDER;
                }
                self.write(Slot::Border, names, unparsed, dest);
            }
        }
    }

    fn write_border(
        &mut self,
        border: MaskBorder,
        names: VendorPrefix,
        uncovered: u16,
        dest: &mut css::DeclarationList,
    ) {
        let arena = dest.bump();
        if names.contains(WEBKIT) && uncovered == BORDER {
            let webkit = BorderImage {
                source: border.source.deep_clone(arena),
                slice: border.slice.deep_clone(arena),
                width: css::generic::deep_clone(&border.width, arena),
                outset: css::generic::deep_clone(&border.outset, arena),
                repeat: border.repeat.deep_clone(arena),
            };
            self.write(
                Slot::Border,
                WEBKIT,
                Property::MaskBoxImage((webkit, WEBKIT)),
                dest,
            );
            // Unlike lightningcss: `-webkit-mask-box-image` fills the middle and the slice longhand does not.
            if !border.slice.fill {
                let slice = webkit_border_longhand(Slot::BorderSlice, &border, arena);
                self.write(Slot::BorderSlice, WEBKIT, slice, dest);
            }
        } else if names.contains(WEBKIT) {
            for slot in BORDER_LONGHANDS {
                if uncovered & slot.bit() != 0 {
                    self.write(
                        slot,
                        WEBKIT,
                        webkit_border_longhand(slot, &border, arena),
                        dest,
                    );
                }
            }
        }
        if names.contains(NONE) {
            self.write(Slot::Border, NONE, Property::MaskBorder(border), dest);
        }
    }

    /// Unlike lightningcss: `mask` resets `mask-border` and the old `-webkit-mask` does not, so the copies get a reset line.
    fn reset_copied_border(&mut self, dest: &mut css::DeclarationList) {
        let copied = core::mem::take(&mut self.copied);
        if copied == BORDER {
            self.write(
                Slot::Border,
                WEBKIT,
                webkit_border_initial(Slot::Border),
                dest,
            );
        } else {
            for slot in BORDER_LONGHANDS {
                if copied & slot.bit() != 0 {
                    self.write(slot, WEBKIT, webkit_border_initial(slot), dest);
                }
            }
        }
    }

    /// Runs the handler alone over a keyframe, which reaches no other handler. A browser ignores `!important` there.
    pub(crate) fn handle_keyframe(
        declarations: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        let mut handler = MaskHandler::default();
        if context.targets.browsers.is_none()
            || !declarations
                .iter()
                .any(|declaration| handler.wants(declaration))
        {
            return;
        }
        let mut dest =
            css::DeclarationList::with_capacity_in(declarations.len(), declarations.bump());
        for declaration in declarations.iter_mut() {
            if !(handler.wants(declaration)
                && handler.handle_property(declaration, &mut dest, context))
            {
                dest.push(core::mem::replace(
                    declaration,
                    Property::All(CSSWideKeyword::RevertLayer),
                ));
            }
        }
        *declarations = dest;
    }
}
