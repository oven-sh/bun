#![warn(unused_must_use)]
use crate as css;
use crate::css_values::color::ColorFallbackKind;
use crate::css_values::color::CssColor;
use crate::css_values::image::Image;
use crate::css_values::length::LengthPercentageOrAuto;
use crate::css_values::position::{HorizontalPosition, Position, VerticalPosition};
use crate::generics::{CssEql, DeepClone};
use crate::properties::{Property, PropertyId};
use crate::{
    DeclarationList, Parser, PrintErr, Printer, PropertyHandlerContext, SmallList, VendorPrefix,
};
use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVecExt as _;

/// A value for the [background](https://www.w3.org/TR/css-backgrounds-3/#background) shorthand property.
// Clone derive gated on `Image` gaining `Clone` upstream.
#[cfg_attr(any(), derive(Clone))]
pub struct Background {
    /// The background image.
    pub(crate) image: Image,
    /// The background color.
    pub(crate) color: CssColor,
    /// The background position.
    pub(crate) position: BackgroundPosition,
    /// How the background image should repeat.
    pub(crate) repeat: BackgroundRepeat,
    /// The size of the background image.
    pub(crate) size: BackgroundSize,
    /// The background attachment.
    pub(crate) attachment: BackgroundAttachment,
    /// The background origin.
    pub(crate) origin: BackgroundOrigin,
    /// How the background should be clipped.
    pub(crate) clip: BackgroundClip,
}

impl Background {
    pub(crate) fn parse(input: &mut Parser) -> css::Result<Self> {
        let mut color: Option<CssColor> = None;
        let mut position: Option<BackgroundPosition> = None;
        let mut size: Option<BackgroundSize> = None;
        let mut image: Option<Image> = None;
        let mut repeat: Option<BackgroundRepeat> = None;
        let mut attachment: Option<BackgroundAttachment> = None;
        let mut origin: Option<BackgroundOrigin> = None;
        let mut clip: Option<BackgroundClip> = None;

        loop {
            // TODO: only allowed on the last background.
            if color.is_none() {
                if let Ok(value) = input.try_parse(CssColor::parse) {
                    color = Some(value);
                    continue;
                }
            }

            if position.is_none() {
                if let Ok(value) = input.try_parse(BackgroundPosition::parse) {
                    position = Some(value);

                    size = input
                        .try_parse(|i: &mut Parser| -> css::Result<BackgroundSize> {
                            i.expect_delim(b'/')?;
                            BackgroundSize::parse(i)
                        })
                        .ok();

                    continue;
                }
            }

            if image.is_none() {
                if let Ok(value) = input.try_parse(Image::parse) {
                    image = Some(value);
                    continue;
                }
            }

            if repeat.is_none() {
                if let Ok(value) = input.try_parse(BackgroundRepeat::parse) {
                    repeat = Some(value);
                    continue;
                }
            }

            if attachment.is_none() {
                if let Ok(value) = input.try_parse(BackgroundAttachment::parse) {
                    attachment = Some(value);
                    continue;
                }
            }

            if origin.is_none() {
                if let Ok(value) = input.try_parse(BackgroundOrigin::parse) {
                    origin = Some(value);
                    continue;
                }
            }

            if clip.is_none() {
                if let Ok(value) = input.try_parse(BackgroundClip::parse) {
                    clip = Some(value);
                    continue;
                }
            }

            break;
        }

        if clip.is_none() {
            if let Some(o) = origin {
                // BackgroundOrigin's three variants are a prefix of BackgroundClip;
                // map explicitly so the optimizer collapses to the identity move.
                clip = Some(match o {
                    BackgroundOrigin::BorderBox => BackgroundClip::BorderBox,
                    BackgroundOrigin::PaddingBox => BackgroundClip::PaddingBox,
                    BackgroundOrigin::ContentBox => BackgroundClip::ContentBox,
                });
            }
        }

        Ok(Background {
            image: image.unwrap_or_default(),
            color: color.unwrap_or_default(),
            position: position.unwrap_or_else(BackgroundPosition::default),
            repeat: repeat.unwrap_or_else(BackgroundRepeat::default),
            size: size.unwrap_or_else(BackgroundSize::default),
            attachment: attachment.unwrap_or_else(BackgroundAttachment::default),
            origin: origin.unwrap_or(BackgroundOrigin::PaddingBox),
            clip: clip.unwrap_or(BackgroundClip::BorderBox),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let mut has_output = false;

        if self.color != CssColor::default() {
            self.color.to_css(dest)?;
            has_output = true;
        }

        if !self.image.eql(&Image::default()) {
            if has_output {
                dest.write_str(" ")?;
            }
            self.image.to_css(dest)?;
            has_output = true;
        }

        let position: Position = self.position.into_position();
        if !position.is_zero() || !self.size.eql(&BackgroundSize::default()) {
            if has_output {
                dest.write_str(" ")?;
            }
            position.to_css(dest)?;

            if !self.size.eql(&BackgroundSize::default()) {
                dest.delim(b'/', true)?;
                self.size.to_css(dest)?;
            }

            has_output = true;
        }

        if !self.repeat.eql(&BackgroundRepeat::default()) {
            if has_output {
                dest.write_str(" ")?;
            }
            self.repeat.to_css(dest)?;
            has_output = true;
        }

        if self.attachment != BackgroundAttachment::default() {
            if has_output {
                dest.write_str(" ")?;
            }
            self.attachment.to_css(dest)?;
            has_output = true;
        }

        let output_padding_box = self.origin != BackgroundOrigin::PaddingBox
            || (!self.clip.eql_origin(BackgroundOrigin::BorderBox)
                && self.clip.is_background_box());

        if output_padding_box {
            if has_output {
                dest.write_str(" ")?;
            }
            self.origin.to_css(dest)?;
            has_output = true;
        }

        if (output_padding_box && !self.clip.eql_origin(self.origin))
            || !self.clip.eql_origin(BackgroundOrigin::BorderBox)
        {
            if has_output {
                dest.write_str(" ")?;
            }

            self.clip.to_css(dest)?;
            has_output = true;
        }

        // If nothing was output, then this is the initial value, e.g. background: transparent
        if !has_output {
            if dest.minify {
                // `0 0` is the shortest valid background value
                self.position.to_css(dest)?;
            } else {
                dest.write_str("none")?;
            }
        }

        Ok(())
    }

    fn get_image(&self) -> &Image {
        &self.image
    }

    fn with_image(&self, arena: &Bump, image: Image) -> Self {
        let mut ret = self.deep_clone(arena);
        ret.image = image;
        ret
    }

    fn get_fallback(&self, arena: &Bump, kind: ColorFallbackKind) -> Background {
        let mut ret = self.deep_clone(arena);
        ret.color = self.color.get_fallback(arena, kind);
        ret.image = self.image.get_fallback(arena, kind);
        ret
    }

    fn get_necessary_fallbacks(&self, targets: &css::targets::Targets) -> ColorFallbackKind {
        self.color.get_necessary_fallbacks(targets)
            | self.get_image().get_necessary_fallbacks(targets)
    }

    #[inline]
    pub(crate) fn deep_clone(&self, arena: &Bump) -> Self {
        // `Image` is the only non-`Clone` field; it provides its own `deep_clone`.
        Self {
            image: self.image.deep_clone(arena),
            color: self.color.clone(),
            position: self.position.clone(),
            repeat: self.repeat,
            size: self.size.clone(),
            attachment: self.attachment,
            origin: self.origin,
            clip: self.clip,
        }
    }

    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        self.image.eql(&rhs.image)
            && self.color == rhs.color
            && self.position == rhs.position
            && self.repeat.eql(&rhs.repeat)
            && self.size.eql(&rhs.size)
            && self.attachment == rhs.attachment
            && self.origin == rhs.origin
            && self.clip == rhs.clip
    }
}

/// A value for the [background-size](https://www.w3.org/TR/css-backgrounds-3/#background-size) property.
#[derive(Clone, PartialEq)]
pub enum BackgroundSize {
    /// An explicit background size.
    Explicit(ExplicitBackgroundSize),
    /// The `cover` keyword. Scales the background image to cover both the width and height of the element.
    Cover,
    /// The `contain` keyword. Scales the background image so that it fits within the element.
    Contain,
}

#[derive(Clone, PartialEq)]
pub struct ExplicitBackgroundSize {
    /// The width of the background.
    pub(crate) width: LengthPercentageOrAuto,
    /// The height of the background.
    pub(crate) height: LengthPercentageOrAuto,
}

impl BackgroundSize {
    pub(crate) fn parse(input: &mut Parser) -> css::Result<Self> {
        if let Ok(width) = input.try_parse(LengthPercentageOrAuto::parse) {
            let height = input
                .try_parse(LengthPercentageOrAuto::parse)
                .unwrap_or(LengthPercentageOrAuto::Auto);
            return Ok(BackgroundSize::Explicit(ExplicitBackgroundSize {
                width,
                height,
            }));
        }

        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;

        crate::match_ignore_ascii_case! { ident, {
            b"cover" => Ok(BackgroundSize::Cover),
            b"contain" => Ok(BackgroundSize::Contain),
            _ => Err(location.new_unexpected_token_error(css::Token::Ident(ident))),
        }}
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            BackgroundSize::Cover => dest.write_str("cover"),
            BackgroundSize::Contain => dest.write_str("contain"),
            BackgroundSize::Explicit(explicit) => {
                explicit.width.to_css(dest)?;
                if !matches!(explicit.height, LengthPercentageOrAuto::Auto) {
                    dest.write_str(" ")?;
                    explicit.height.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    pub(crate) fn default() -> Self {
        BackgroundSize::Explicit(ExplicitBackgroundSize {
            width: LengthPercentageOrAuto::Auto,
            height: LengthPercentageOrAuto::Auto,
        })
    }

    #[inline]
    pub(crate) fn deep_clone(&self, _arena: &Bump) -> Self {
        self.clone()
    }
}

/// A value for the [background-position](https://drafts.csswg.org/css-backgrounds/#background-position) shorthand property.
#[derive(Clone, PartialEq)]
pub struct BackgroundPosition {
    /// The x-position.
    pub(crate) x: HorizontalPosition,
    /// The y-position.
    pub(crate) y: VerticalPosition,
}

impl BackgroundPosition {
    pub(crate) fn parse(input: &mut Parser) -> css::Result<Self> {
        let pos = Position::parse(input)?;
        Ok(BackgroundPosition::from_position(pos))
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let pos = self.into_position();
        pos.to_css(dest)
    }

    fn default() -> Self {
        BackgroundPosition::from_position(Position::default())
    }

    fn from_position(pos: Position) -> BackgroundPosition {
        BackgroundPosition { x: pos.x, y: pos.y }
    }

    fn into_position(&self) -> Position {
        Position {
            x: self.x.clone(),
            y: self.y.clone(),
        }
    }

    #[inline]
    pub(crate) fn deep_clone(&self, _arena: &Bump) -> Self {
        self.clone()
    }
}

/// A value for the [background-repeat](https://www.w3.org/TR/css-backgrounds-3/#background-repeat) property.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct BackgroundRepeat {
    /// A repeat style for the x direction.
    pub(crate) x: BackgroundRepeatKeyword,
    /// A repeat style for the y direction.
    pub(crate) y: BackgroundRepeatKeyword,
}

impl BackgroundRepeat {
    pub(crate) fn default() -> Self {
        BackgroundRepeat {
            x: BackgroundRepeatKeyword::Repeat,
            y: BackgroundRepeatKeyword::Repeat,
        }
    }

    pub(crate) fn parse(input: &mut Parser) -> css::Result<Self> {
        let state = input.state();
        let ident = input.expect_ident_cloned()?;

        crate::match_ignore_ascii_case! { ident, {
            b"repeat-x" => return Ok(BackgroundRepeat {
                x: BackgroundRepeatKeyword::Repeat,
                y: BackgroundRepeatKeyword::NoRepeat,
            }),
            b"repeat-y" => return Ok(BackgroundRepeat {
                x: BackgroundRepeatKeyword::NoRepeat,
                y: BackgroundRepeatKeyword::Repeat,
            }),
            _ => input.reset(&state),
        }}

        let x = BackgroundRepeatKeyword::parse(input)?;
        let y = input.try_parse(BackgroundRepeatKeyword::parse).unwrap_or(x);

        Ok(BackgroundRepeat { x, y })
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        use BackgroundRepeatKeyword::{NoRepeat, Repeat};

        if self.x == Repeat && self.y == NoRepeat {
            dest.write_str("repeat-x")
        } else if self.x == NoRepeat && self.y == Repeat {
            dest.write_str("repeat-y")
        } else {
            self.x.to_css(dest)?;
            if self.y != self.x {
                dest.write_str(" ")?;
                self.y.to_css(dest)?;
            }
            Ok(())
        }
    }
}

crate::css_eql_partialeq!(
    ExplicitBackgroundSize,
    BackgroundSize,
    BackgroundPosition,
    BackgroundRepeat,
);

/// A [`<repeat-style>`](https://www.w3.org/TR/css-backgrounds-3/#typedef-repeat-style) value,
/// used within the `background-repeat` property to represent how a background image is repeated
/// in a single direction.
///
/// See [BackgroundRepeat](BackgroundRepeat).
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum BackgroundRepeatKeyword {
    /// The image is repeated in this direction.
    Repeat,
    /// The image is repeated so that it fits, and then spaced apart evenly.
    Space,
    /// The image is scaled so that it repeats an even number of times.
    Round,
    /// The image is placed once and not repeated in this direction.
    NoRepeat,
}

/// A value for the [background-attachment](https://www.w3.org/TR/css-backgrounds-3/#background-attachment) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]

pub enum BackgroundAttachment {
    /// The background scrolls with the container.
    Scroll,
    /// The background is fixed to the viewport.
    Fixed,
    /// The background is fixed with regard to the element's contents.
    Local,
}

impl BackgroundAttachment {
    fn default() -> Self {
        BackgroundAttachment::Scroll
    }
}

/// A value for the [background-origin](https://www.w3.org/TR/css-backgrounds-3/#background-origin) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
#[repr(u8)]
pub enum BackgroundOrigin {
    /// The position is relative to the border box.
    BorderBox,
    /// The position is relative to the padding box.
    PaddingBox,
    /// The position is relative to the content box.
    ContentBox,
}

/// A value for the [background-clip](https://drafts.csswg.org/css-backgrounds-4/#background-clip) property.
#[derive(Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
#[repr(u8)]
pub enum BackgroundClip {
    /// The background is clipped to the border box.
    BorderBox,
    /// The background is clipped to the padding box.
    PaddingBox,
    /// The background is clipped to the content box.
    ContentBox,
    /// The background is clipped to the area painted by the border.
    Border,
    /// The background is clipped to the text content of the element.
    Text,
}

impl BackgroundClip {
    fn default() -> BackgroundClip {
        BackgroundClip::BorderBox
    }

    fn eql_origin(self, other: BackgroundOrigin) -> bool {
        match self {
            BackgroundClip::BorderBox => other == BackgroundOrigin::BorderBox,
            BackgroundClip::PaddingBox => other == BackgroundOrigin::PaddingBox,
            BackgroundClip::ContentBox => other == BackgroundOrigin::ContentBox,
            _ => false,
        }
    }

    fn is_background_box(self) -> bool {
        matches!(
            self,
            BackgroundClip::BorderBox | BackgroundClip::PaddingBox | BackgroundClip::ContentBox
        )
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Default)]
    pub struct BackgroundProperty: u16 {
        const COLOR      = 1 << 0;
        const IMAGE      = 1 << 1;
        const POSITION_X = 1 << 2;
        const POSITION_Y = 1 << 3;
        const REPEAT     = 1 << 4;
        const SIZE       = 1 << 5;
        const ATTACHMENT = 1 << 6;
        const ORIGIN     = 1 << 7;
        const CLIP       = 1 << 8;
    }
}

impl BackgroundProperty {
    const BACKGROUND_COLOR: Self = Self::COLOR;
    const BACKGROUND_IMAGE: Self = Self::IMAGE;
    const BACKGROUND_POSITION_X: Self = Self::POSITION_X;
    const BACKGROUND_POSITION_Y: Self = Self::POSITION_Y;
    const BACKGROUND_POSITION: Self =
        Self::from_bits_truncate(Self::POSITION_X.bits() | Self::POSITION_Y.bits());
    const BACKGROUND_REPEAT: Self = Self::REPEAT;
    const BACKGROUND_SIZE: Self = Self::SIZE;
    const BACKGROUND_ATTACHMENT: Self = Self::ATTACHMENT;
    const BACKGROUND_ORIGIN: Self = Self::ORIGIN;

    const BACKGROUND: Self = Self::from_bits_truncate(
        Self::COLOR.bits()
            | Self::IMAGE.bits()
            | Self::POSITION_X.bits()
            | Self::POSITION_Y.bits()
            | Self::REPEAT.bits()
            | Self::SIZE.bits()
            | Self::ATTACHMENT.bits()
            | Self::ORIGIN.bits()
            | Self::CLIP.bits(),
    );

    fn try_from_property_id(property_id: PropertyId) -> Option<BackgroundProperty> {
        match property_id {
            PropertyId::BackgroundColor => Some(Self::BACKGROUND_COLOR),
            PropertyId::BackgroundImage => Some(Self::BACKGROUND_IMAGE),
            PropertyId::BackgroundPositionX => Some(Self::BACKGROUND_POSITION_X),
            PropertyId::BackgroundPositionY => Some(Self::BACKGROUND_POSITION_Y),
            PropertyId::BackgroundPosition => Some(Self::BACKGROUND_POSITION),
            PropertyId::BackgroundRepeat => Some(Self::BACKGROUND_REPEAT),
            PropertyId::BackgroundSize => Some(Self::BACKGROUND_SIZE),
            PropertyId::BackgroundAttachment => Some(Self::BACKGROUND_ATTACHMENT),
            PropertyId::BackgroundOrigin => Some(Self::BACKGROUND_ORIGIN),
            PropertyId::Background => Some(Self::BACKGROUND),
            _ => None,
        }
    }
}

/// The values of the `background` longhands that are not written yet.
///
/// Declarations that the same targets read set them, so they can be written
/// as one declaration.
#[derive(Default)]
struct BackgroundState {
    color: Option<CssColor>,
    images: Option<SmallList<Image, 1>>,
    x_positions: Option<SmallList<HorizontalPosition, 1>>,
    y_positions: Option<SmallList<VerticalPosition, 1>>,
    repeats: Option<SmallList<BackgroundRepeat, 1>>,
    sizes: Option<SmallList<BackgroundSize, 1>>,
    attachments: Option<SmallList<BackgroundAttachment, 1>>,
    origins: Option<SmallList<BackgroundOrigin, 1>>,
    clips: Option<(SmallList<BackgroundClip, 1>, VendorPrefix)>,
}

/// Merges the `background` declarations of a rule.
///
/// A browser that cannot read a declaration drops it and uses the declaration
/// before it (CSS 2.1 section 4.2). So a declaration that some target does not
/// read, which is one with a prefixed image, does not replace the values
/// before it and does not share a declaration with other values. The values
/// before it stay pending instead, and a later value that every target reads
/// removes them. lightningcss overwrites them.
///
/// The pending values are written in this order: `earlier`, `cur`, `later`.
#[derive(Default)]
pub struct BackgroundHandler {
    /// The open state. Every target reads each of its parts.
    cur: BackgroundState,
    /// The states before `cur`, in source order.
    ///
    /// `earlier[..replaced]`: values with a prefixed image that a later value
    /// replaced for every target. See `drop_replaced`.
    ///
    /// `earlier[replaced..]`: the values before a `background` that some target
    /// does not read, and that declaration. The open state is behind it.
    earlier: Vec<BackgroundState>,
    replaced: usize,
    /// The `background-image` values after the image of `cur` that some target
    /// does not read.
    later: Vec<SmallList<Image, 1>>,
    flushed_properties: BackgroundProperty,
    has_any: bool,
}

// Struct fields cannot be indexed by string at runtime; the `flushHelper` /
// `initSmallListHelper` / `push` helpers are expanded into small per-field
// macros below. A derive macro could replace them.

macro_rules! init_small_list_helper {
    ($this:expr, $field:ident, $length:expr) => {{
        let length = $length;
        if let Some(list) = &mut $this.$field {
            list.clear_retaining_capacity();
            list.ensure_total_capacity(length);
            list
        } else {
            $this.$field = Some(SmallList::init_capacity(length));
            $this.$field.as_mut().unwrap()
        }
    }};
}

macro_rules! flush_helper {
    ($this:expr, $field:ident, $val:expr, $dest:expr, $context:expr) => {{
        if let Some(existing) = &$this.cur.$field {
            if !crate::generic::eql(existing, $val)
                && $context.targets.browsers.is_some()
                && !crate::generic::is_compatible($val, &$context.targets.browsers.unwrap())
            {
                $this.flush($dest, $context);
            }
        }
    }};
}

macro_rules! push_property {
    ($this:expr, $dest:expr, $variant:ident, $bg_prop:expr, $val:expr) => {{
        $dest.push(Property::$variant($val));
        $this.flushed_properties.insert($bg_prop);
    }};
}

fn has_vendor_prefix(images: &SmallList<Image, 1>) -> bool {
    images.any(|image: &Image| image.has_vendor_prefix())
}

/// Whether some target drops a declaration with these images.
fn some_target_skips(images: &SmallList<Image, 1>, targets: &css::targets::Targets) -> bool {
    images.any(|image: &Image| !image.is_read_by_all(targets))
}

impl BackgroundState {
    fn image(images: SmallList<Image, 1>) -> Self {
        Self {
            images: Some(images),
            ..Self::default()
        }
    }

    fn is_empty(&self) -> bool {
        self.color.is_none()
            && self.images.is_none()
            && self.x_positions.is_none()
            && self.y_positions.is_none()
            && self.repeats.is_none()
            && self.sizes.is_none()
            && self.attachments.is_none()
            && self.origins.is_none()
            && self.clips.is_none()
    }

    /// Whether every longhand is set, as after a `background` shorthand.
    fn is_complete(&self) -> bool {
        self.color.is_some()
            && self.images.is_some()
            && self.x_positions.is_some()
            && self.y_positions.is_some()
            && self.repeats.is_some()
            && self.sizes.is_some()
            && self.attachments.is_some()
            && self.origins.is_some()
            && self.clips.is_some()
    }

    fn has_prefixed_image(&self) -> bool {
        self.images.as_ref().is_some_and(has_vendor_prefix)
    }

    /// Sets every longhand from a `background` shorthand.
    fn set_shorthand(
        &mut self,
        val: &SmallList<Background, 1>,
        color: CssColor,
        images: SmallList<Image, 1>,
        clips: (SmallList<BackgroundClip, 1>, VendorPrefix),
        arena: &Bump,
    ) {
        self.color = Some(color);
        self.images = Some(images);
        let len = val.len();
        {
            let x_positions = init_small_list_helper!(self, x_positions, len);
            for b in val.slice() {
                x_positions.append_assume_capacity(b.position.x.clone());
            }
        }
        {
            let y_positions = init_small_list_helper!(self, y_positions, len);
            for b in val.slice() {
                y_positions.append_assume_capacity(b.position.y.clone());
            }
        }
        {
            let repeats = init_small_list_helper!(self, repeats, len);
            for b in val.slice() {
                repeats.append_assume_capacity(b.repeat);
            }
        }
        {
            let sizes = init_small_list_helper!(self, sizes, len);
            for b in val.slice() {
                sizes.append_assume_capacity(b.size.deep_clone(arena));
            }
        }
        {
            let attachments = init_small_list_helper!(self, attachments, len);
            for b in val.slice() {
                attachments.append_assume_capacity(b.attachment);
            }
        }
        {
            let origins = init_small_list_helper!(self, origins, len);
            for b in val.slice() {
                origins.append_assume_capacity(b.origin);
            }
        }
        self.clips = Some(clips);
    }
}

impl BackgroundHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        let arena = dest.bump();
        match property {
            Property::BackgroundColor(val) => {
                flush_helper!(self, color, val, dest, context);
                self.cur.color = Some(val.deep_clone(arena));
            }
            Property::BackgroundImage(val) => self.handle_image(val, dest, context),
            Property::BackgroundPosition(val) => {
                let len = val.len();
                {
                    let x_positions = init_small_list_helper!(self.cur, x_positions, len);
                    for position in val.slice() {
                        x_positions.append_assume_capacity(position.x.clone());
                    }
                }
                {
                    let y_positions = init_small_list_helper!(self.cur, y_positions, len);
                    for position in val.slice() {
                        y_positions.append_assume_capacity(position.y.clone());
                    }
                }
            }
            Property::BackgroundPositionX(val) => {
                // Drop replaces deinit; just overwrite.
                self.cur.x_positions = Some(val.deep_clone(arena));
            }
            Property::BackgroundPositionY(val) => {
                self.cur.y_positions = Some(val.deep_clone(arena));
            }
            Property::BackgroundRepeat(val) => {
                self.cur.repeats = Some(val.deep_clone(arena));
            }
            Property::BackgroundSize(val) => {
                self.cur.sizes = Some(val.deep_clone(arena));
            }
            Property::BackgroundAttachment(val) => {
                self.cur.attachments = Some(val.deep_clone(arena));
            }
            Property::BackgroundOrigin(val) => {
                self.cur.origins = Some(val.deep_clone(arena));
            }
            Property::BackgroundClip(x) => {
                let val: &SmallList<BackgroundClip, 1> = &x.0;
                let vendor_prefix: VendorPrefix = x.1;
                // Compute the predicate first, then dispatch (avoids holding
                // &mut self.cur.clips across self.flush()).
                let needs_flush = if let Some((clips, vp)) = &self.cur.clips {
                    vendor_prefix != *vp && !SmallList::eql(val, clips)
                } else {
                    false
                };
                if needs_flush {
                    // `flush()` takes the open state, so any borrow into
                    // `self.cur.clips` would be stale once `flush()` returns.
                    // Do not touch it.
                    self.flush(dest, context);
                    let arena = dest.bump();
                    self.cur.clips = Some((val.deep_clone(arena), vendor_prefix));
                } else if let Some((clips, vp)) = &mut self.cur.clips {
                    if !SmallList::eql(val, clips) {
                        *clips = val.deep_clone(arena);
                    }
                    vp.insert(vendor_prefix);
                } else {
                    self.cur.clips = Some((val.deep_clone(arena), vendor_prefix));
                }
            }
            Property::Background(val) => self.handle_shorthand(val, dest, context),
            Property::Unparsed(val) => {
                if is_background_property(val.property_id) {
                    self.flush(dest, context);
                    let arena = dest.bump();
                    let mut unparsed = val.deep_clone(arena);
                    context.add_unparsed_fallbacks(arena, &mut unparsed);
                    if let Some(prop) = BackgroundProperty::try_from_property_id(val.property_id) {
                        self.flushed_properties.insert(prop);
                    }

                    dest.push(Property::Unparsed(unparsed));
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        self.has_any = true;
        true
    }

    // The two arms with an image are functions of their own:
    // `handle_property` is on the path of every declaration of every rule.

    #[inline(never)]
    fn handle_image(
        &mut self,
        val: &SmallList<Image, 1>,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        self.flush_before_unsupported_images(val, dest, context);
        self.set_images(val.deep_clone(dest.bump()), context);
    }

    #[inline(never)]
    fn handle_shorthand(
        &mut self,
        val: &SmallList<Background, 1>,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        let arena = dest.bump();
        let mut images: SmallList<Image, 1> = SmallList::init_capacity(val.len());
        for b in val.slice() {
            images.append_assume_capacity(b.image.deep_clone(arena));
        }
        let color = val.last().unwrap().color.deep_clone(arena);
        let mut clips: SmallList<BackgroundClip, 1> = SmallList::init_capacity(val.len());
        for b in val.slice() {
            clips.append_assume_capacity(b.clip);
        }

        // Every flush decision comes before the new value is recorded.
        self.flush_before_unsupported_images(&images, dest, context);
        flush_helper!(self, color, &color, dest, context);
        let mut clips_vp = VendorPrefix::NONE;
        // Drop the `self.cur.clips` borrow before calling flush().
        let needs_flush = if let Some((existing_clips, existing_vp)) = &self.cur.clips {
            clips_vp != *existing_vp && !SmallList::eql(&clips, existing_clips)
        } else {
            false
        };
        if needs_flush {
            self.flush(dest, context);
        }
        let arena = dest.bump();

        if some_target_skips(&images, &context.targets) {
            // The targets that do not read this declaration use the
            // values before it. Longhands after it go to a new state
            // behind it.
            if self.repeats_last_shorthand(&images) {
                self.earlier.pop();
            } else {
                self.close();
            }
            let mut state = BackgroundState::default();
            state.set_shorthand(val, color, images, (clips, clips_vp), arena);
            self.earlier.push(state);
        } else {
            if let Some((_, existing_vp)) = &self.cur.clips {
                clips_vp.insert(*existing_vp);
            }
            self.drop_replaced(has_vendor_prefix(&images), context);
            self.cur
                .set_shorthand(val, color, images, (clips, clips_vp), arena);
        }
    }

    /// The newest pending image value.
    fn latest_images(&self) -> Option<&SmallList<Image, 1>> {
        self.later
            .last()
            .or(self.cur.images.as_ref())
            .or_else(|| self.earlier.last()?.images.as_ref())
    }

    /// The compat data says that some target lacks `images`: the pending
    /// values are written, so that they stay as the fallback.
    fn flush_before_unsupported_images(
        &mut self,
        images: &SmallList<Image, 1>,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        let Some(browsers) = context.targets.browsers else {
            return;
        };
        let unsupported = self.latest_images().is_some_and(|existing| {
            !crate::generic::eql(existing, images)
                && images.any(|image: &Image| !image.is_compatible_as_written(&browsers))
        });
        if unsupported {
            self.flush(dest, context);
        }
    }

    /// Records the value of a `background-image` declaration.
    fn set_images(&mut self, images: SmallList<Image, 1>, context: &PropertyHandlerContext) {
        if some_target_skips(&images, &context.targets) {
            // An equal value has the same readers and replaces the one before it.
            if !(self.later.last()).is_some_and(|last| crate::generic::eql(last, &images)) {
                self.later.push(images);
            }
            return;
        }

        // Every target reads this image, so no target uses the images before it.
        let has_targets = context.targets.browsers.is_some();
        let closed = self.replaced != self.earlier.len();
        if has_targets && (closed || !has_vendor_prefix(&images)) {
            self.later.clear();
            if !closed {
                self.earlier.clear();
                self.replaced = 0;
            }
        } else {
            // The prefixed ones stay, as in `drop_replaced`.
            if let Some(replaced) = self.cur.images.take_if(|images| has_vendor_prefix(images)) {
                self.earlier.push(BackgroundState::image(replaced));
            }
            for later in self.later.drain(..) {
                self.earlier.push(BackgroundState::image(later));
            }
            if !closed {
                self.replaced = self.earlier.len();
            }
        }
        self.cur.images = Some(images);
    }

    /// Whether the newest pending value is a `background` with these images
    /// and nothing after it. It has the readers of a new `background` with the
    /// same images, which replaces it for them.
    fn repeats_last_shorthand(&self, images: &SmallList<Image, 1>) -> bool {
        self.cur.is_empty()
            && self.later.is_empty()
            && self.earlier.len() > self.replaced
            && (self.earlier.last())
                .and_then(|last| last.images.as_ref())
                .is_some_and(|last| crate::generic::eql(last, images))
    }

    /// A `background` that some target does not read follows. The pending
    /// values stay for that target, and nothing is added to them.
    fn close(&mut self) {
        if !self.cur.is_empty() {
            self.earlier.push(core::mem::take(&mut self.cur));
        }
        for later in self.later.drain(..) {
            self.earlier.push(BackgroundState::image(later));
        }
    }

    /// A `background` that every target reads follows, so no target uses the
    /// pending values. The caller sets `cur`.
    ///
    /// An unprefixed value with targets drops them all: the prefixes that the
    /// targets need are generated from it. Otherwise the values with a prefix
    /// stay, as lightningcss keeps them.
    fn drop_replaced(&mut self, prefixed: bool, context: &PropertyHandlerContext) {
        let has_targets = context.targets.browsers.is_some();
        if has_targets && !prefixed {
            self.earlier.clear();
            self.later.clear();
            self.replaced = 0;
            return;
        }

        let mut kept = self.replaced;
        for i in self.replaced..self.earlier.len() {
            if self.earlier[i].has_prefixed_image() {
                self.earlier.swap(kept, i);
                kept += 1;
            }
        }
        self.earlier.truncate(kept);
        // Without targets a prefixed image is never in `cur`.
        if has_targets && self.cur.has_prefixed_image() {
            // The longhands of an incomplete state are no part of the
            // declaration that had the prefix.
            self.earlier.push(if self.cur.is_complete() {
                core::mem::take(&mut self.cur)
            } else {
                BackgroundState::image(self.cur.images.take().unwrap())
            });
        }
        for later in self.later.drain(..) {
            self.earlier.push(BackgroundState::image(later));
        }
        self.replaced = self.earlier.len();
    }

    /// Writes the pending values inside a rule, before a value that cannot
    /// join them.
    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        // No target uses the replaced values. Only the end of the rule writes
        // them: here lightningcss leaves them pending, and the unprefixed
        // value that usually follows drops them.
        if self.replaced != 0 && context.targets.browsers.is_some() {
            self.earlier.drain(..self.replaced);
            self.replaced = 0;
        }
        self.write_pending(dest, context);
    }

    fn write_pending(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }
        self.has_any = false;

        if !self.earlier.is_empty() {
            for state in core::mem::take(&mut self.earlier) {
                self.write_state(state, dest, context);
            }
            self.replaced = 0;
        }
        let cur = core::mem::take(&mut self.cur);
        self.write_state(cur, dest, context);
        if !self.later.is_empty() {
            for images in core::mem::take(&mut self.later) {
                self.write_state(BackgroundState::image(images), dest, context);
            }
        }
    }

    fn write_state(
        &mut self,
        state: BackgroundState,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        let arena = dest.bump();

        let BackgroundState {
            color: mut maybe_color,
            images: mut maybe_images,
            x_positions: mut maybe_x_positions,
            y_positions: mut maybe_y_positions,
            repeats: mut maybe_repeats,
            sizes: mut maybe_sizes,
            attachments: mut maybe_attachments,
            origins: mut maybe_origins,
            clips: mut maybe_clips,
        } = state;

        if let (
            Some(color),
            Some(images),
            Some(x_positions),
            Some(y_positions),
            Some(repeats),
            Some(sizes),
            Some(attachments),
            Some(origins),
            Some(clips),
        ) = (
            maybe_color.as_ref(),
            maybe_images.as_mut(),
            maybe_x_positions.as_mut(),
            maybe_y_positions.as_mut(),
            maybe_repeats.as_mut(),
            maybe_sizes.as_mut(),
            maybe_attachments.as_mut(),
            maybe_origins.as_mut(),
            maybe_clips.as_mut(),
        ) {
            // Only use shorthand syntax if the number of layers matches on all properties.
            let len = images.len();
            if x_positions.len() == len
                && y_positions.len() == len
                && repeats.len() == len
                && sizes.len() == len
                && attachments.len() == len
                && origins.len() == len
                && clips.0.len() == len
            {
                let clip_prefixes = if clips
                    .0
                    .any(|clip: &BackgroundClip| *clip == BackgroundClip::Text)
                {
                    context
                        .targets
                        .prefixes(clips.1, css::prefixes::Feature::BackgroundClip)
                } else {
                    clips.1
                };
                let clip_property = if clip_prefixes != VendorPrefix::NONE {
                    Some(Property::BackgroundClip((
                        clips.0.deep_clone(arena),
                        clip_prefixes,
                    )))
                } else {
                    None
                };

                let mut backgrounds: SmallList<Background, 1> = SmallList::init_capacity(len);
                // Index by `i` and clone each element to avoid 8 simultaneous borrows.
                for i in 0..(len as usize) {
                    backgrounds.append_assume_capacity(Background {
                        color: if i == (len as usize) - 1 {
                            color.deep_clone(arena)
                        } else {
                            CssColor::default()
                        },
                        image: images.slice()[i].deep_clone(arena),
                        position: BackgroundPosition {
                            x: x_positions.slice()[i].clone(),
                            y: y_positions.slice()[i].clone(),
                        },
                        repeat: repeats.slice()[i],
                        size: sizes.slice()[i].clone(),
                        attachment: attachments.slice()[i],
                        origin: origins.slice()[i],
                        clip: if clip_prefixes == VendorPrefix::NONE {
                            clips.0.slice()[i]
                        } else {
                            BackgroundClip::default()
                        },
                    });
                }
                // The elements were cloned into `backgrounds` above, so the
                // originals Drop normally; no explicit clear needed.
                // PERF: profile the clones if hot.

                if self.flushed_properties.is_empty() {
                    let mut fallbacks =
                        crate::small_list::get_fallbacks(&mut backgrounds, arena, &context.targets);
                    // Pop in reverse then re-reverse via a temp Vec to
                    // preserve order while consuming the list. `fallbacks` is
                    // a plain Vec, so a direct `for fb in fallbacks` would
                    // also work.
                    let mut tmp: Vec<SmallList<Background, 1>> =
                        Vec::with_capacity(fallbacks.len());
                    while let Some(fb) = fallbacks.pop() {
                        tmp.push(fb);
                    }
                    for fallback in tmp.into_iter().rev() {
                        push_property!(
                            self,
                            dest,
                            Background,
                            BackgroundProperty::BACKGROUND,
                            fallback
                        );
                    }
                }

                push_property!(
                    self,
                    dest,
                    Background,
                    BackgroundProperty::BACKGROUND,
                    backgrounds
                );

                if let Some(clip) = clip_property {
                    dest.push(clip);
                    self.flushed_properties.insert(BackgroundProperty::CLIP);
                }

                return;
            }
        }

        if let Some(mut color) = maybe_color.take() {
            if !self.flushed_properties.contains(BackgroundProperty::COLOR) {
                let fallbacks = color.get_fallbacks(arena, &context.targets);
                for fallback in fallbacks.into_iter() {
                    push_property!(
                        self,
                        dest,
                        BackgroundColor,
                        BackgroundProperty::BACKGROUND_COLOR,
                        fallback
                    );
                }
            }
            push_property!(
                self,
                dest,
                BackgroundColor,
                BackgroundProperty::BACKGROUND_COLOR,
                color
            );
        }

        if let Some(mut images) = maybe_images.take() {
            if !self.flushed_properties.contains(BackgroundProperty::IMAGE) {
                let mut fallbacks =
                    crate::small_list::get_fallbacks(&mut images, arena, &context.targets);
                // Pop in reverse then re-reverse via a temp Vec to preserve
                // order while consuming the list. `fallbacks` is a plain Vec,
                // so a direct `for fb in fallbacks` would also work.
                let mut tmp: Vec<SmallList<Image, 1>> = Vec::with_capacity(fallbacks.len());
                while let Some(fb) = fallbacks.pop() {
                    tmp.push(fb);
                }
                for fallback in tmp.into_iter().rev() {
                    push_property!(
                        self,
                        dest,
                        BackgroundImage,
                        BackgroundProperty::BACKGROUND_IMAGE,
                        fallback
                    );
                }
            }
            push_property!(
                self,
                dest,
                BackgroundImage,
                BackgroundProperty::BACKGROUND_IMAGE,
                images
            );
        }

        if maybe_x_positions.is_some()
            && maybe_y_positions.is_some()
            && maybe_x_positions.as_ref().unwrap().len()
                == maybe_y_positions.as_ref().unwrap().len()
        {
            let xs = maybe_x_positions.take().unwrap();
            let ys = maybe_y_positions.take().unwrap();
            let mut positions: SmallList<BackgroundPosition, 1> =
                SmallList::init_capacity(xs.len());
            debug_assert_eq!(xs.slice().len(), ys.slice().len());
            for (x, y) in xs.slice().iter().zip(ys.slice().iter()) {
                positions.append_assume_capacity(BackgroundPosition {
                    x: x.clone(),
                    y: y.clone(),
                });
            }
            push_property!(
                self,
                dest,
                BackgroundPosition,
                BackgroundProperty::BACKGROUND_POSITION,
                positions
            );
        } else {
            if let Some(x) = maybe_x_positions.take() {
                push_property!(
                    self,
                    dest,
                    BackgroundPositionX,
                    BackgroundProperty::BACKGROUND_POSITION_X,
                    x
                );
            }
            if let Some(y) = maybe_y_positions.take() {
                push_property!(
                    self,
                    dest,
                    BackgroundPositionY,
                    BackgroundProperty::BACKGROUND_POSITION_Y,
                    y
                );
            }
        }

        if let Some(rep) = maybe_repeats.take() {
            push_property!(
                self,
                dest,
                BackgroundRepeat,
                BackgroundProperty::BACKGROUND_REPEAT,
                rep
            );
        }

        if let Some(rep) = maybe_sizes.take() {
            push_property!(
                self,
                dest,
                BackgroundSize,
                BackgroundProperty::BACKGROUND_SIZE,
                rep
            );
        }

        if let Some(rep) = maybe_attachments.take() {
            push_property!(
                self,
                dest,
                BackgroundAttachment,
                BackgroundProperty::BACKGROUND_ATTACHMENT,
                rep
            );
        }

        if let Some(rep) = maybe_origins.take() {
            push_property!(
                self,
                dest,
                BackgroundOrigin,
                BackgroundProperty::BACKGROUND_ORIGIN,
                rep
            );
        }

        if let Some((clips, vp)) = maybe_clips.take() {
            let prefixes = if clips.any(|clip: &BackgroundClip| *clip == BackgroundClip::Text) {
                context
                    .targets
                    .prefixes(vp, css::prefixes::Feature::BackgroundClip)
            } else {
                vp
            };
            dest.push(Property::BackgroundClip((
                clips.deep_clone(arena),
                prefixes,
            )));
            self.flushed_properties.insert(BackgroundProperty::CLIP);
        }
    }

    pub(crate) fn finalize(
        &mut self,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        self.write_pending(dest, context);
        self.flushed_properties = BackgroundProperty::empty();
    }
}

// `Background` participates in `SmallList::get_fallbacks` via the
// `ImageFallback` trait.
impl crate::small_list::ImageFallback for Background {
    #[inline]
    fn get_image(&self) -> &Image {
        Background::get_image(self)
    }
    #[inline]
    fn with_image(&self, arena: &Bump, image: Image) -> Self {
        Background::with_image(self, arena, image)
    }
    #[inline]
    fn get_fallback(&self, arena: &Bump, kind: ColorFallbackKind) -> Self {
        Background::get_fallback(self, arena, kind)
    }
    #[inline]
    fn get_necessary_fallbacks(&self, targets: &css::targets::Targets) -> ColorFallbackKind {
        Background::get_necessary_fallbacks(self, targets)
    }
}

fn is_background_property(property_id: PropertyId) -> bool {
    matches!(
        property_id,
        PropertyId::BackgroundColor
            | PropertyId::BackgroundImage
            | PropertyId::BackgroundPosition
            | PropertyId::BackgroundPositionX
            | PropertyId::BackgroundPositionY
            | PropertyId::BackgroundRepeat
            | PropertyId::BackgroundSize
            | PropertyId::BackgroundAttachment
            | PropertyId::BackgroundOrigin
            | PropertyId::BackgroundClip(_)
            | PropertyId::Background
    )
}
