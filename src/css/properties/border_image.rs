use crate as css;
use bun_alloc::ArenaVecExt as _;

use crate::Result;
use css::PrintErr;
use css::Printer;
use css::SmallList;

use crate::generics::IsCompatible as _;
use css::VendorPrefix;
use css::css_properties::{Property, PropertyIdTag};
use css::css_values::image::Image;
use css::css_values::length::LengthOrNumber;
use css::css_values::length::LengthPercentage;
use css::css_values::number::{CSSNumber, CSSNumberFns};
use css::css_values::percentage::NumberOrPercentage;
use css::css_values::percentage::Percentage;
use css::css_values::rect::Rect;

use bun_alloc::Arena;

/// A value for the [border-image](https://www.w3.org/TR/css-backgrounds-3/#border-image) shorthand property.
pub struct BorderImage {
    /// The border image.
    pub source: Image,
    /// The offsets that define where the image is sliced.
    pub slice: BorderImageSlice,
    /// The width of the border image.
    pub width: Rect<BorderImageSideWidth>,
    /// The amount that the image extends beyond the border box.
    pub outset: Rect<LengthOrNumber>,
    /// How the border image is scaled and tiled.
    pub repeat: BorderImageRepeat,
}

impl BorderImage {
    // Recorded here for a future shorthand trait/derive to consume.
    // PropertyFieldMap:
    //   source -> PropertyIdTag::BorderImageSource
    //   slice  -> PropertyIdTag::BorderImageSlice
    //   width  -> PropertyIdTag::BorderImageWidth
    //   outset -> PropertyIdTag::BorderImageOutset
    //   repeat -> PropertyIdTag::BorderImageRepeat
    // VendorPrefixMap: all fields = true

    pub(crate) fn parse(input: &mut css::Parser) -> Result<BorderImage> {
        Self::parse_with_callback(input, |_: &mut css::Parser| false)
    }

    pub(crate) fn parse_with_callback(
        input: &mut css::Parser,
        mut callback: impl FnMut(&mut css::Parser) -> bool,
    ) -> Result<BorderImage> {
        let mut source: Option<Image> = None;
        let mut slice: Option<BorderImageSlice> = None;
        let mut width: Option<Rect<BorderImageSideWidth>> = None;
        let mut outset: Option<Rect<LengthOrNumber>> = None;
        let mut repeat: Option<BorderImageRepeat> = None;

        loop {
            if slice.is_none() {
                if let Ok(value) = input.try_parse(BorderImageSlice::parse) {
                    slice = Some(value);
                    // Parse border image width and outset, if applicable.
                    let maybe_width_outset = input.try_parse(
                        |i: &mut css::Parser| -> Result<(
                            Option<Rect<BorderImageSideWidth>>,
                            Option<Rect<LengthOrNumber>>,
                        )> {
                            i.expect_delim(b'/')?;

                            let w = i.try_parse(Rect::<BorderImageSideWidth>::parse).ok();

                            let o = i
                                .try_parse(
                                    |in_: &mut css::Parser| -> Result<Rect<LengthOrNumber>> {
                                        in_.expect_delim(b'/')?;
                                        Rect::<LengthOrNumber>::parse(in_)
                                    },
                                )
                                .ok();

                            if w.is_none() && o.is_none() {
                                return Err(
                                    i.new_custom_error(css::ParserError::invalid_declaration)
                                );
                            }
                            Ok((w, o))
                        },
                    );

                    if let Ok(val) = maybe_width_outset {
                        width = val.0;
                        outset = val.1;
                    }
                    continue;
                }
            }

            if source.is_none() {
                if let Ok(value) = input.try_parse(Image::parse) {
                    source = Some(value);
                    continue;
                }
            }

            if repeat.is_none() {
                if let Ok(value) = input.try_parse(BorderImageRepeat::parse) {
                    repeat = Some(value);
                    continue;
                }
            }

            if callback(input) {
                continue;
            }

            break;
        }

        if source.is_some()
            || slice.is_some()
            || width.is_some()
            || outset.is_some()
            || repeat.is_some()
        {
            return Ok(BorderImage {
                source: source.unwrap_or_default(),
                slice: slice.unwrap_or_else(BorderImageSlice::default),
                width: width.unwrap_or_else(|| {
                    Rect::<BorderImageSideWidth>::all(BorderImageSideWidth::default())
                }),
                outset: outset
                    .unwrap_or_else(|| Rect::<LengthOrNumber>::all(LengthOrNumber::default())),
                repeat: repeat.unwrap_or_else(BorderImageRepeat::default),
            });
        }
        Err(input.new_custom_error(css::ParserError::invalid_declaration))
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        Self::to_css_internal(
            &self.source,
            &self.slice,
            &self.width,
            &self.outset,
            &self.repeat,
            dest,
        )
    }

    pub(crate) fn to_css_internal(
        source: &Image,
        slice: &BorderImageSlice,
        width: &Rect<BorderImageSideWidth>,
        outset: &Rect<LengthOrNumber>,
        repeat: &BorderImageRepeat,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        if !source.eql(&Image::default()) {
            source.to_css(dest)?;
        }
        let has_slice = !slice.eql(&BorderImageSlice::default());
        let has_width = !width.eql(&Rect::<BorderImageSideWidth>::all(
            BorderImageSideWidth::default(),
        ));
        let has_outset = !outset.eql(&Rect::<LengthOrNumber>::all(LengthOrNumber::Number(0.0)));
        if has_slice || has_width || has_outset {
            dest.write_str(" ")?;
            slice.to_css(dest)?;
            if has_width || has_outset {
                dest.delim(b'/', true)?;
            }
            if has_width {
                width.to_css(dest)?;
            }

            if has_outset {
                dest.delim(b'/', true)?;
                outset.to_css(dest)?;
            }
        }

        if !repeat.eql(&BorderImageRepeat::default()) {
            dest.write_str(" ")?;
            return repeat.to_css(dest);
        }

        Ok(())
    }

    pub(crate) fn get_fallbacks(
        &mut self,
        arena: &Arena,
        targets: &css::targets::Targets,
    ) -> SmallList<BorderImage, 6> {
        let fallbacks = self.source.get_fallbacks(arena, targets);
        // `defer fallbacks.deinit(arena)` dropped — SmallList drops at scope exit.
        let mut res = SmallList::<BorderImage, 6>::init_capacity(fallbacks.len());
        for fallback in fallbacks {
            // `fallback` is moved into the cloned shorthand.
            let mut clone = self.deep_clone(arena);
            clone.source = fallback;
            res.append(clone);
        }
        res
    }

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        // Keep in sync with the BorderImage field list.
        BorderImage {
            source: self.source.deep_clone(arena),
            slice: self.slice.deep_clone(arena),
            width: self.width.deep_clone(arena),
            outset: self.outset.deep_clone(arena),
            repeat: self.repeat.deep_clone(arena),
        }
    }

    pub(crate) fn eql(&self, other: &BorderImage) -> bool {
        self.source.eql(&other.source)
            && self.slice.eql(&other.slice)
            && self.width.eql(&other.width)
            && self.outset.eql(&other.outset)
            && self.repeat.eql(&other.repeat)
    }

    pub(crate) fn default() -> BorderImage {
        BorderImage {
            source: Image::default(),
            slice: BorderImageSlice::default(),
            width: Rect::<BorderImageSideWidth>::all(BorderImageSideWidth::default()),
            outset: Rect::<LengthOrNumber>::all(LengthOrNumber::default()),
            repeat: BorderImageRepeat::default(),
        }
    }
}

/// A value for the [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) property.
pub struct BorderImageRepeat {
    /// The horizontal repeat value.
    pub horizontal: BorderImageRepeatKeyword,
    /// The vertical repeat value.
    pub vertical: BorderImageRepeatKeyword,
}

impl BorderImageRepeat {
    pub(crate) fn parse(input: &mut css::Parser) -> Result<BorderImageRepeat> {
        let horizontal = BorderImageRepeatKeyword::parse(input)?;
        let vertical = input.try_parse(BorderImageRepeatKeyword::parse).ok();
        Ok(BorderImageRepeat {
            horizontal,
            vertical: vertical.unwrap_or(horizontal),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.horizontal.to_css(dest)?;
        if self.horizontal != self.vertical {
            dest.write_str(" ")?;
            self.vertical.to_css(dest)?;
        }
        Ok(())
    }

    pub(crate) fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        self.horizontal.is_compatible(browsers) && self.vertical.is_compatible(browsers)
    }

    pub(crate) fn default() -> BorderImageRepeat {
        BorderImageRepeat {
            horizontal: BorderImageRepeatKeyword::Stretch,
            vertical: BorderImageRepeatKeyword::Stretch,
        }
    }

    pub(crate) fn eql(&self, other: &BorderImageRepeat) -> bool {
        self.horizontal == other.horizontal && self.vertical == other.vertical
    }

    pub(crate) fn deep_clone(&self, _arena: &Arena) -> Self {
        BorderImageRepeat {
            horizontal: self.horizontal,
            vertical: self.vertical,
        }
    }
}

/// A value for the [border-image-width](https://www.w3.org/TR/css-backgrounds-3/#border-image-width) property.
#[derive(Clone, PartialEq)]
pub enum BorderImageSideWidth {
    /// A number representing a multiple of the border width.
    Number(CSSNumber),
    /// An explicit length or percentage.
    LengthPercentage(LengthPercentage),
    /// The `auto` keyword, representing the natural width of the image slice.
    Auto,
}

impl BorderImageSideWidth {
    // Hand-expanded — tried in declaration order
    // (Number → LengthPercentage → keyword `auto`).
    pub(crate) fn parse(input: &mut css::Parser) -> Result<Self> {
        if let Ok(n) = input.try_parse(CSSNumberFns::parse) {
            return Ok(BorderImageSideWidth::Number(n));
        }
        if let Ok(lp) = input.try_parse(LengthPercentage::parse) {
            return Ok(BorderImageSideWidth::LengthPercentage(lp));
        }
        input.expect_ident_matching(b"auto")?;
        Ok(BorderImageSideWidth::Auto)
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            BorderImageSideWidth::Number(n) => CSSNumberFns::to_css(*n, dest),
            BorderImageSideWidth::LengthPercentage(lp) => lp.to_css(dest),
            BorderImageSideWidth::Auto => dest.write_str("auto"),
        }
    }

    pub(crate) fn default() -> BorderImageSideWidth {
        BorderImageSideWidth::Number(1.0)
    }

    pub(crate) fn deep_clone(&self, _arena: &Arena) -> Self {
        self.clone()
    }

    pub(crate) fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        match self {
            BorderImageSideWidth::LengthPercentage(l) => l.is_compatible(browsers),
            _ => true,
        }
    }
}

impl crate::generics::IsCompatible for BorderImageSideWidth {
    #[inline]
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
        Self::is_compatible(self, browsers)
    }
}

// `IsCompatible for LengthOrNumber` is provided centrally by
// `generics::bridges::bridge_is_compatible!` (forwards to the inherent method).

/// A single [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) keyword.
#[derive(Clone, Copy, PartialEq, Eq, Hash, css::DefineEnumProperty)]
pub enum BorderImageRepeatKeyword {
    /// The image is stretched to fill the area.
    Stretch,
    /// The image is tiled (repeated) to fill the area.
    Repeat,
    /// The image is scaled so that it repeats an even number of times.
    Round,
    /// The image is repeated so that it fits, and then spaced apart evenly.
    Space,
}

impl BorderImageRepeatKeyword {
    pub(crate) fn is_compatible(self, browsers: &css::targets::Browsers) -> bool {
        match self {
            BorderImageRepeatKeyword::Round => {
                css::compat::Feature::BorderImageRepeatRound.is_compatible(browsers)
            }
            BorderImageRepeatKeyword::Space => {
                css::compat::Feature::BorderImageRepeatSpace.is_compatible(browsers)
            }
            BorderImageRepeatKeyword::Stretch | BorderImageRepeatKeyword::Repeat => true,
        }
    }
}

/// A value for the [border-image-slice](https://www.w3.org/TR/css-backgrounds-3/#border-image-slice) property.
pub struct BorderImageSlice {
    /// The offsets from the edges of the image.
    pub offsets: Rect<NumberOrPercentage>,
    /// Whether the middle of the border image should be preserved.
    pub fill: bool,
}

impl BorderImageSlice {
    pub(crate) fn parse(input: &mut css::Parser) -> Result<BorderImageSlice> {
        let mut fill = input
            .try_parse(|i| i.expect_ident_matching(b"fill"))
            .is_ok();
        let offsets = Rect::<NumberOrPercentage>::parse(input)?;
        if !fill {
            fill = input
                .try_parse(|i| i.expect_ident_matching(b"fill"))
                .is_ok();
        }
        Ok(BorderImageSlice { offsets, fill })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        self.offsets.to_css(dest)?;
        if self.fill {
            dest.write_str(" fill")?;
        }
        Ok(())
    }

    pub(crate) fn is_compatible(&self, _: &css::targets::Browsers) -> bool {
        true
    }

    pub(crate) fn eql(&self, other: &BorderImageSlice) -> bool {
        self.offsets.eql(&other.offsets) && self.fill == other.fill
    }

    pub(crate) fn default() -> BorderImageSlice {
        BorderImageSlice {
            offsets: Rect::<NumberOrPercentage>::all(NumberOrPercentage::Percentage(Percentage {
                v: 1.0,
            })),
            fill: false,
        }
    }

    pub(crate) fn deep_clone(&self, arena: &Arena) -> Self {
        BorderImageSlice {
            offsets: self.offsets.deep_clone(arena),
            fill: self.fill,
        }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub(crate) struct BorderImageProperty: u8 {
        const SOURCE = 1 << 0;
        const SLICE  = 1 << 1;
        const WIDTH  = 1 << 2;
        const OUTSET = 1 << 3;
        const REPEAT = 1 << 4;
    }
}

impl BorderImageProperty {
    pub(crate) const BORDER_IMAGE_SOURCE: BorderImageProperty = BorderImageProperty::SOURCE;
    pub(crate) const BORDER_IMAGE_SLICE: BorderImageProperty = BorderImageProperty::SLICE;
    pub(crate) const BORDER_IMAGE_WIDTH: BorderImageProperty = BorderImageProperty::WIDTH;
    pub(crate) const BORDER_IMAGE_OUTSET: BorderImageProperty = BorderImageProperty::OUTSET;
    pub(crate) const BORDER_IMAGE_REPEAT: BorderImageProperty = BorderImageProperty::REPEAT;

    pub(crate) const BORDER_IMAGE: BorderImageProperty = BorderImageProperty::all();

    pub(crate) fn try_from_property_id(property_id: PropertyIdTag) -> Option<BorderImageProperty> {
        match property_id {
            PropertyIdTag::BorderImageSource => Some(BorderImageProperty::SOURCE),
            PropertyIdTag::BorderImageSlice => Some(BorderImageProperty::SLICE),
            PropertyIdTag::BorderImageWidth => Some(BorderImageProperty::WIDTH),
            PropertyIdTag::BorderImageOutset => Some(BorderImageProperty::OUTSET),
            PropertyIdTag::BorderImageRepeat => Some(BorderImageProperty::REPEAT),
            PropertyIdTag::BorderImage => Some(BorderImageProperty::BORDER_IMAGE),
            _ => None,
        }
    }
}

#[derive(Default)]
pub(crate) struct BorderImageHandler {
    pub source: Option<Image>,
    pub slice: Option<BorderImageSlice>,
    pub width: Option<Rect<BorderImageSideWidth>>,
    pub outset: Option<Rect<LengthOrNumber>>,
    pub repeat: Option<BorderImageRepeat>,
    pub vendor_prefix: VendorPrefix,
    pub flushed_properties: BorderImageProperty,
    pub has_any: bool,
}

impl BorderImageHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        let arena = dest.bump();

        // `flushHelper`/`propertyHelper` are macro_rules! to keep the
        // per-field name dispatch without reflection.
        macro_rules! flush_helper {
            ($self:expr, $d:expr, $ctx:expr, $name:ident, $val:expr) => {
                if $self.$name.is_some()
                    && !$self.$name.as_ref().unwrap().eql($val)
                    && $ctx.targets.browsers.is_some()
                    && $val.is_compatible(&$ctx.targets.browsers.unwrap())
                {
                    $self.flush($d, $ctx);
                }
            };
        }

        macro_rules! property_helper {
            ($self:expr, $field:ident, $val:expr, $d:expr, $ctx:expr) => {{
                if $self.vendor_prefix != VendorPrefix::NONE {
                    $self.flush($d, $ctx);
                }

                flush_helper!($self, $d, $ctx, $field, $val);

                $self.vendor_prefix = VendorPrefix::NONE;
                $self.$field = Some($val.deep_clone(arena));
                $self.has_any = true;
            }};
        }

        match property {
            Property::BorderImageSource(val) => property_helper!(self, source, val, dest, context),
            Property::BorderImageSlice(val) => property_helper!(self, slice, val, dest, context),
            Property::BorderImageWidth(val) => property_helper!(self, width, val, dest, context),
            Property::BorderImageOutset(val) => property_helper!(self, outset, val, dest, context),
            Property::BorderImageRepeat(val) => property_helper!(self, repeat, val, dest, context),
            Property::BorderImage(_val) => {
                let val = &_val.0;
                let vp = _val.1;

                flush_helper!(self, dest, context, source, &val.source);
                flush_helper!(self, dest, context, slice, &val.slice);
                flush_helper!(self, dest, context, width, &val.width);
                flush_helper!(self, dest, context, outset, &val.outset);
                flush_helper!(self, dest, context, repeat, &val.repeat);

                self.source = Some(val.source.deep_clone(arena));
                self.slice = Some(val.slice.deep_clone(arena));
                self.width = Some(val.width.deep_clone(arena));
                self.outset = Some(val.outset.deep_clone(arena));
                self.repeat = Some(val.repeat.deep_clone(arena));
                self.vendor_prefix |= vp;
                self.has_any = true;
            }
            Property::Unparsed(unparsed) => {
                if is_border_image_property(unparsed.property_id.tag()) {
                    self.flush(dest, context);

                    // Even if we weren't able to parse the value (e.g. due to var() references),
                    // we can still add vendor prefixes to the property itself.
                    let mut unparsed_clone =
                        if unparsed.property_id.tag() == PropertyIdTag::BorderImage {
                            unparsed.get_prefixed(
                                arena,
                                &context.targets,
                                css::prefixes::Feature::BorderImage,
                            )
                        } else {
                            unparsed.deep_clone(arena)
                        };

                    context.add_unparsed_fallbacks(arena, &mut unparsed_clone);
                    self.flushed_properties.insert(
                        BorderImageProperty::try_from_property_id(unparsed_clone.property_id.tag())
                            .unwrap(),
                    );
                    dest.push(Property::Unparsed(unparsed_clone));
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub(crate) fn finalize(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        self.flush(dest, context);
        self.flushed_properties = BorderImageProperty::empty();
    }

    pub(crate) fn reset(&mut self) {
        self.source = None;
        self.slice = None;
        self.width = None;
        self.outset = None;
        self.repeat = None;
    }

    pub(crate) fn will_flush(&self, property: &Property) -> bool {
        match property {
            Property::BorderImageSource(_)
            | Property::BorderImageSlice(_)
            | Property::BorderImageWidth(_)
            | Property::BorderImageOutset(_)
            | Property::BorderImageRepeat(_) => self.vendor_prefix != VendorPrefix::NONE,
            Property::Unparsed(val) => is_border_image_property(val.property_id.tag()),
            _ => false,
        }
    }

    fn flush(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        if !self.has_any {
            return;
        }
        let arena = dest.bump();

        self.has_any = false;

        match (
            self.source.take(),
            self.slice.take(),
            self.width.take(),
            self.outset.take(),
            self.repeat.take(),
        ) {
            (Some(source), Some(slice), Some(width), Some(outset), Some(repeat)) => {
                let mut border_image = BorderImage {
                    source,
                    slice,
                    width,
                    outset,
                    repeat,
                };

                let mut prefix = self.vendor_prefix;
                if prefix.contains(VendorPrefix::NONE) && !border_image.slice.fill {
                    prefix = context
                        .targets
                        .prefixes(self.vendor_prefix, css::prefixes::Feature::BorderImage);
                    if self.flushed_properties.is_empty() {
                        let fallbacks = border_image.get_fallbacks(arena, &context.targets);
                        for fallback in fallbacks {
                            // Match prefix of fallback. e.g. -webkit-linear-gradient
                            // can only be used in -webkit-border-image, not -moz-border-image.
                            // However, if border-image is unprefixed, gradients can still be.
                            let mut p = fallback.source.get_vendor_prefix() & prefix;
                            if p.is_empty() {
                                p = prefix;
                            }
                            dest.push(Property::BorderImage((fallback, p)));
                        }
                    }
                }

                let p = border_image.source.get_vendor_prefix() & prefix;
                if !p.is_empty() {
                    prefix = p;
                }

                dest.push(Property::BorderImage((border_image, prefix)));
                self.flushed_properties
                    .insert(BorderImageProperty::BORDER_IMAGE);
            }
            (source, slice, width, outset, repeat) => {
                if let Some(mut mut_source) = source {
                    if !self
                        .flushed_properties
                        .contains(BorderImageProperty::BORDER_IMAGE_SOURCE)
                    {
                        let img_fallbacks = mut_source.get_fallbacks(arena, &context.targets);
                        for fallback in img_fallbacks {
                            dest.push(Property::BorderImageSource(fallback));
                        }
                    }

                    dest.push(Property::BorderImageSource(mut_source));
                    self.flushed_properties
                        .insert(BorderImageProperty::BORDER_IMAGE_SOURCE);
                }

                if let Some(s) = slice {
                    dest.push(Property::BorderImageSlice(s));
                    self.flushed_properties
                        .insert(BorderImageProperty::BORDER_IMAGE_SLICE);
                }

                if let Some(w) = width {
                    dest.push(Property::BorderImageWidth(w));
                    self.flushed_properties
                        .insert(BorderImageProperty::BORDER_IMAGE_WIDTH);
                }

                if let Some(o) = outset {
                    dest.push(Property::BorderImageOutset(o));
                    self.flushed_properties
                        .insert(BorderImageProperty::BORDER_IMAGE_OUTSET);
                }

                if let Some(r) = repeat {
                    dest.push(Property::BorderImageRepeat(r));
                    self.flushed_properties
                        .insert(BorderImageProperty::BORDER_IMAGE_REPEAT);
                }
            }
        }

        self.vendor_prefix = VendorPrefix::empty();
    }
}

pub(crate) fn is_border_image_property(property_id: PropertyIdTag) -> bool {
    matches!(
        property_id,
        PropertyIdTag::BorderImageSource
            | PropertyIdTag::BorderImageSlice
            | PropertyIdTag::BorderImageWidth
            | PropertyIdTag::BorderImageOutset
            | PropertyIdTag::BorderImageRepeat
            | PropertyIdTag::BorderImage
    )
}

crate::css_eql_partialeq!(BorderImageSideWidth);
