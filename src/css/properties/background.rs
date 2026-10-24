#![warn(unused_must_use)]
use crate as css;
use crate::css_values::color::ColorFallbackKind;
use crate::css_values::color::CssColor;
use crate::css_values::image::Image;
use crate::css_values::length::LengthPercentageOrAuto;
use crate::css_values::position::{HorizontalPosition, Position, VerticalPosition};
use crate::generics::{CssEql, DeepClone};
use crate::properties::custom::UnparsedProperty;
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

/// The background longhands that a run of declarations sets.
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

impl BackgroundState {
    fn image_only(images: SmallList<Image, 1>) -> BackgroundState {
        BackgroundState {
            images: Some(images),
            ..Default::default()
        }
    }

    /// The longhands that the state sets. `flush` writes one `background` when it sets them all.
    fn longhands(&self) -> BackgroundProperty {
        let mut set = BackgroundProperty::empty();
        set.set(BackgroundProperty::COLOR, self.color.is_some());
        set.set(BackgroundProperty::IMAGE, self.images.is_some());
        set.set(BackgroundProperty::POSITION_X, self.x_positions.is_some());
        set.set(BackgroundProperty::POSITION_Y, self.y_positions.is_some());
        set.set(BackgroundProperty::REPEAT, self.repeats.is_some());
        set.set(BackgroundProperty::SIZE, self.sizes.is_some());
        set.set(BackgroundProperty::ATTACHMENT, self.attachments.is_some());
        set.set(BackgroundProperty::ORIGIN, self.origins.is_some());
        set.set(BackgroundProperty::CLIP, self.clips.is_some());
        set
    }

    fn is_empty(&self) -> bool {
        self.longhands().is_empty()
    }

    fn is_image_only(&self) -> bool {
        self.longhands() == BackgroundProperty::IMAGE
    }

    /// `background` does not reset a prefixed `background-clip`.
    fn sets_prefixed_clip(&self) -> bool {
        matches!(&self.clips, Some((_, prefix)) if *prefix != VendorPrefix::NONE)
    }

    /// A clip under another prefix with another value has to stay a declaration of its own.
    fn clips_conflict(&self, later: &BackgroundState) -> bool {
        matches!(
            (&self.clips, &later.clips),
            (Some((clips, prefix)), Some((later_clips, later_prefix)))
                if prefix != later_prefix && !SmallList::eql(later_clips, clips)
        )
    }

    /// Applies the longhands that `later` sets on top of this state.
    fn apply(&mut self, later: BackgroundState) {
        macro_rules! apply {
            ($($field:ident),*) => {$(
                if later.$field.is_some() {
                    self.$field = later.$field;
                }
            )*};
        }
        apply!(
            color,
            images,
            x_positions,
            y_positions,
            repeats,
            sizes,
            attachments,
            origins
        );
        if let Some((later_clips, later_prefix)) = later.clips {
            match &mut self.clips {
                Some((clips, prefix)) => {
                    if !SmallList::eql(&later_clips, clips) {
                        *clips = later_clips;
                    }
                    prefix.insert(later_prefix);
                }
                None => self.clips = Some((later_clips, later_prefix)),
            }
        }
    }
}

/// Which targets read the images of the open state.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum Reach {
    /// Every target. Also the answer for a state that sets no image.
    #[default]
    Every,
    /// Unprefixed images that the targets were not asked about yet.
    Unasked,
    /// Not every target.
    Partial,
}

enum Pending {
    /// A closed state. A later image that every target reads folds a resumable one back in.
    State {
        state: Box<BackgroundState>,
        resumable: bool,
    },
    Unparsed(UnparsedProperty),
}

impl Pending {
    /// A declaration that a later image overrides when every target reads that image.
    fn sets_only_an_image(&self) -> bool {
        match self {
            Pending::State { state, resumable } => !resumable && state.is_image_only(),
            Pending::Unparsed(unparsed) => {
                matches!(unparsed.property_id, PropertyId::BackgroundImage)
            }
        }
    }

    fn is_resumable(&self) -> bool {
        matches!(
            self,
            Pending::State {
                resumable: true,
                ..
            }
        )
    }

    fn sets_prefixed_clip(&self) -> bool {
        match self {
            Pending::State { state, .. } => state.sets_prefixed_clip(),
            Pending::Unparsed(unparsed) => matches!(
                unparsed.property_id,
                PropertyId::BackgroundClip(prefix) if prefix != VendorPrefix::NONE
            ),
        }
    }
}

/// Unlike lightningcss, a value that a target cannot read never replaces the declaration before it.
#[derive(Default)]
pub struct BackgroundHandler {
    /// The declarations that still fold into one another.
    open: BackgroundState,
    /// Earlier declarations that a target may still need, in source order.
    pending: Vec<Pending>,
    /// One past the index of the first resumable state in `pending`, or 0.
    first_resumable: u32,
    flushed_properties: BackgroundProperty,
    reach: Reach,
    has_any: bool,
}

// Struct fields cannot be indexed by name at runtime, so these helpers are per-field macros.

macro_rules! init_small_list_helper {
    ($this:expr, $field:ident, $length:expr) => {{
        let length = $length;
        if let Some(list) = &mut $this.open.$field {
            list.clear_retaining_capacity();
            list.ensure_total_capacity(length);
            list
        } else {
            $this.open.$field = Some(SmallList::init_capacity(length));
            $this.open.$field.as_mut().unwrap()
        }
    }};
}

macro_rules! push_property {
    ($this:expr, $dest:expr, $variant:ident, $bg_prop:expr, $val:expr) => {{
        $dest.push(Property::$variant($val));
        $this.flushed_properties.insert($bg_prop);
    }};
}

/// Whether every target reads the lowest colour fallback that `flush` writes in front of `images`.
fn color_fallback_reaches_every_target(
    images: &SmallList<Image, 1>,
    arena: &Bump,
    targets: &css::targets::Targets,
    browsers: &css::targets::Browsers,
) -> bool {
    let mut kinds = ColorFallbackKind::empty();
    for image in images.slice() {
        kinds.insert(image.get_necessary_fallbacks(targets));
    }
    let lowest = kinds.lowest();
    !lowest.is_empty()
        && images
            .slice()
            .iter()
            .all(|image| image.get_fallback(arena, lowest).is_compatible(browsers))
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
                if !self.open_color_is_fallback_of(val, context) {
                    self.before_longhand(BackgroundProperty::COLOR, arena, context);
                } else if !self.pending.is_empty() || self.open_is_partial(arena, context) {
                    self.close(false);
                } else {
                    self.flush(dest, context);
                }
                self.open.color = Some(val.deep_clone(arena));
            }
            Property::BackgroundImage(val) => self.image_longhand(val, dest, context),
            Property::BackgroundPosition(val) => {
                self.before_longhand(BackgroundProperty::BACKGROUND_POSITION, arena, context);
                let len = val.len();
                {
                    let x_positions = init_small_list_helper!(self, x_positions, len);
                    for position in val.slice() {
                        x_positions.append_assume_capacity(position.x.clone());
                    }
                }
                {
                    let y_positions = init_small_list_helper!(self, y_positions, len);
                    for position in val.slice() {
                        y_positions.append_assume_capacity(position.y.clone());
                    }
                }
            }
            Property::BackgroundPositionX(val) => {
                self.before_longhand(BackgroundProperty::POSITION_X, arena, context);
                self.open.x_positions = Some(val.deep_clone(arena));
            }
            Property::BackgroundPositionY(val) => {
                self.before_longhand(BackgroundProperty::POSITION_Y, arena, context);
                self.open.y_positions = Some(val.deep_clone(arena));
            }
            Property::BackgroundRepeat(val) => {
                self.before_longhand(BackgroundProperty::REPEAT, arena, context);
                self.open.repeats = Some(val.deep_clone(arena));
            }
            Property::BackgroundSize(val) => {
                self.before_longhand(BackgroundProperty::SIZE, arena, context);
                self.open.sizes = Some(val.deep_clone(arena));
            }
            Property::BackgroundAttachment(val) => {
                self.before_longhand(BackgroundProperty::ATTACHMENT, arena, context);
                self.open.attachments = Some(val.deep_clone(arena));
            }
            Property::BackgroundOrigin(val) => {
                self.before_longhand(BackgroundProperty::ORIGIN, arena, context);
                self.open.origins = Some(val.deep_clone(arena));
            }
            Property::BackgroundClip(x) => {
                let val: &SmallList<BackgroundClip, 1> = &x.0;
                let vendor_prefix: VendorPrefix = x.1;
                let conflicts = matches!(
                    &self.open.clips,
                    Some((clips, vp)) if vendor_prefix != *vp && !SmallList::eql(val, clips)
                );
                if conflicts {
                    self.flush(dest, context);
                } else {
                    self.before_longhand(BackgroundProperty::CLIP, arena, context);
                }
                if let Some((clips, vp)) = &mut self.open.clips {
                    if !SmallList::eql(val, clips) {
                        *clips = val.deep_clone(arena);
                    }
                    vp.insert(vendor_prefix);
                } else {
                    self.open.clips = Some((val.deep_clone(arena), vendor_prefix));
                }
            }
            Property::Background(val) => self.shorthand(val, dest, context),
            Property::Unparsed(val) => {
                if !is_background_property(val.property_id) {
                    return false;
                }
                let partial = self.open_is_partial(arena, context);
                if partial || !self.pending.is_empty() {
                    // Held too, so that a later `background` can still override everything before it.
                    self.close(!partial);
                    self.pending.push(Pending::Unparsed(val.deep_clone(arena)));
                } else {
                    self.flush(dest, context);
                    self.write_unparsed(val.deep_clone(arena), dest, context);
                }
            }
            _ => return false,
        }

        self.has_any = true;
        true
    }

    fn image_longhand(
        &mut self,
        val: &SmallList<Image, 1>,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        let arena = dest.bump();
        let prefixed = val.any(|image: &Image| image.contains_vendor_prefix());
        if !prefixed && matches!(&self.open.images, Some(open) if crate::generic::eql(open, val)) {
            return;
        }
        if self.holds_nothing() {
            self.open.images = Some(val.deep_clone(arena));
            self.reach = Self::reach_of_first(prefixed, context);
            return;
        }

        let partial = self.open_is_partial(arena, context);
        let held = partial || !self.pending.is_empty();
        let every_target_reads = !prefixed
            && match context.targets.browsers {
                None => true,
                Some(browsers) => {
                    crate::generic::is_compatible(val, &browsers)
                        || (!held
                            && self.open.images.is_none()
                            && self.flushed_properties.is_empty()
                            && color_fallback_reaches_every_target(
                                val,
                                arena,
                                &context.targets,
                                &browsers,
                            ))
                }
            };

        let is_shorthand = self.open.longhands().union(BackgroundProperty::IMAGE)
            == BackgroundProperty::BACKGROUND;
        if !every_target_reads {
            if !held && !prefixed && self.open.images.is_some() {
                // The image before it is its manual fallback.
                self.flush(dest, context);
            } else if is_shorthand {
                self.close(!partial);
            } else if let Some(images) = self.open.images.take() {
                // Only the image is held. The other longhands are declarations of their own and keep folding.
                self.push_state(BackgroundState::image_only(images), !partial);
            }
            self.open.images = Some(val.deep_clone(arena));
            self.reach = Reach::Partial;
            return;
        }

        if partial {
            if is_shorthand {
                // No fold into a `background` that a target ignores.
                self.close(false);
            } else if let Some(images) = self.open.images.take() {
                // Every target reads the new image. Without targets the image before it stays as written.
                if context.targets.browsers.is_none() {
                    self.push_state(BackgroundState::image_only(images), false);
                }
            }
        }
        if self.open.images.is_none() {
            self.resume(context.targets.browsers.is_some());
        }
        self.open.images = Some(val.deep_clone(arena));
        self.reach = Reach::Every;
    }

    fn shorthand(
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
        let mut clips_vp = VendorPrefix::NONE;

        let prefixed = images.any(|image: &Image| image.contains_vendor_prefix());
        let conflicts = matches!(
            &self.open.clips,
            Some((open_clips, open_vp)) if clips_vp != *open_vp && !SmallList::eql(&clips, open_clips)
        );
        if conflicts {
            self.flush(dest, context);
        }
        let reach = if self.holds_nothing() {
            Self::reach_of_first(prefixed, context)
        } else {
            self.before_shorthand(&images, &color, prefixed, dest, context)
        };
        if let Some((_, open_vp)) = &self.open.clips {
            clips_vp.insert(*open_vp);
        }

        self.open.color = Some(color);
        self.open.images = Some(images);
        self.reach = reach;
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
        self.open.clips = Some((clips, clips_vp));
    }

    /// Closes, writes or drops what is in front of a `background`. Returns the reach of its images.
    fn before_shorthand(
        &mut self,
        images: &SmallList<Image, 1>,
        color: &CssColor,
        prefixed: bool,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> Reach {
        let arena = dest.bump();
        let partial = self.open_is_partial(arena, context);
        let held = partial || !self.pending.is_empty();
        let is_fallback = self.open_color_is_fallback_of(color, context);
        let same_images = !prefixed
            && matches!(&self.open.images, Some(open) if crate::generic::eql(open, images));

        // `reach_behind`: a declaration that stays in front of the shorthand stops its colour fallbacks.
        let (every_target_reads, reach_behind) = if prefixed {
            (false, Reach::Partial)
        } else if same_images {
            (
                !partial,
                if partial {
                    Reach::Partial
                } else {
                    Reach::Unasked
                },
            )
        } else {
            match context.targets.browsers {
                None => (true, Reach::Every),
                Some(browsers) if crate::generic::is_compatible(images, &browsers) => {
                    (true, Reach::Every)
                }
                Some(browsers) => {
                    let with_fallbacks = self.open.images.is_none()
                        && self.flushed_properties.is_empty()
                        && color_fallback_reaches_every_target(
                            images,
                            arena,
                            &context.targets,
                            &browsers,
                        );
                    (with_fallbacks, Reach::Partial)
                }
            }
        };

        if !every_target_reads {
            if same_images {
                if is_fallback {
                    self.close(false);
                }
            } else if !held && ((!prefixed && self.open.images.is_some()) || is_fallback) {
                // The image or the colour before it is its manual fallback.
                self.flush(dest, context);
            } else {
                self.close(!partial && !is_fallback);
            }
            return Reach::Partial;
        }

        if is_fallback {
            if held {
                self.close(false);
            } else {
                self.flush(dest, context);
            }
            return reach_behind;
        }
        if !self.supersede(context) {
            self.flush(dest, context);
            return reach_behind;
        }
        if same_images {
            self.reach
        } else {
            Reach::Every
        }
    }

    fn reach_of_first(prefixed: bool, context: &PropertyHandlerContext) -> Reach {
        if prefixed {
            Reach::Partial
        } else if context.targets.browsers.is_none() {
            Reach::Every
        } else {
            Reach::Unasked
        }
    }

    fn holds_nothing(&self) -> bool {
        !self.has_any || (self.pending.is_empty() && self.open.is_empty())
    }

    /// Whether the open colour is the manual fallback of `val`, a later colour that a target lacks.
    fn open_color_is_fallback_of(&self, val: &CssColor, context: &PropertyHandlerContext) -> bool {
        matches!(
            (&self.open.color, context.targets.browsers),
            (Some(open), Some(browsers))
                if !crate::generic::eql(open, val) && !crate::generic::is_compatible(val, &browsers)
        )
    }

    /// `flush` writes the colour fallbacks of a first image, so the lowest fallback decides for it.
    fn open_is_partial(&mut self, arena: &Bump, context: &PropertyHandlerContext) -> bool {
        if self.reach == Reach::Unasked {
            self.reach = match (&self.open.images, context.targets.browsers) {
                (Some(images), Some(browsers))
                    if !crate::generic::is_compatible(images, &browsers)
                        && !(self.pending.is_empty()
                            && self.flushed_properties.is_empty()
                            && color_fallback_reaches_every_target(
                                images,
                                arena,
                                &context.targets,
                                &browsers,
                            )) =>
                {
                    Reach::Partial
                }
                _ => Reach::Every,
            };
        }
        self.reach == Reach::Partial
    }

    /// One `background` that a target cannot read takes in no longhand. Separate longhands keep folding.
    fn before_longhand(
        &mut self,
        longhand: BackgroundProperty,
        arena: &Bump,
        context: &PropertyHandlerContext,
    ) {
        if self.reach != Reach::Every
            && self.open.longhands().union(longhand) == BackgroundProperty::BACKGROUND
            && self.open_is_partial(arena, context)
        {
            self.close(false);
        }
    }

    /// Moves the open state to the end of `pending`.
    fn close(&mut self, resumable: bool) {
        self.reach = Reach::Every;
        if !self.open.is_empty() {
            let state = core::mem::take(&mut self.open);
            self.push_state(state, resumable);
        }
    }

    fn push_state(&mut self, state: BackgroundState, resumable: bool) {
        let state = Box::new(state);
        self.pending.push(Pending::State { state, resumable });
        if resumable && self.first_resumable == 0 {
            self.first_resumable = self.pending.len() as u32;
        }
    }

    /// Drops what a `background` that every target reads overrides. False if that loses a prefixed clip.
    fn supersede(&mut self, context: &PropertyHandlerContext) -> bool {
        if context.targets.browsers.is_some() {
            if self.pending.iter().any(Pending::sets_prefixed_clip) {
                return false;
            }
            self.pending.clear();
            self.first_resumable = 0;
            return true;
        }

        // Without targets the prefixed and the unparsed declarations stay as written.
        let start = match self.first_resumable {
            0 => self.pending.len(),
            first => first as usize - 1,
        };
        if self.pending[start..]
            .iter()
            .any(|entry| entry.is_resumable() && entry.sets_prefixed_clip())
        {
            return false;
        }
        if self.reach == Reach::Partial {
            self.close(false);
        }
        let mut kept = start;
        for i in start..self.pending.len() {
            if !self.pending[i].is_resumable() {
                self.pending.swap(kept, i);
                kept += 1;
            }
        }
        self.pending.truncate(kept);
        self.first_resumable = 0;
        true
    }

    /// Drops the image-only declarations that a later image overrides, and folds the resumable states back in.
    fn resume(&mut self, has_targets: bool) {
        // Without targets the overridden declarations stay as written.
        let mut overridden = Vec::new();
        while let Some(entry) = self.pending.pop() {
            match entry {
                Pending::State {
                    mut state,
                    resumable: true,
                } if !state.clips_conflict(&self.open) => {
                    if self.first_resumable as usize > self.pending.len() {
                        self.first_resumable = 0;
                    }
                    state.apply(core::mem::take(&mut self.open));
                    self.open = *state;
                    if self.open.images.is_some() {
                        break;
                    }
                }
                entry if entry.sets_only_an_image() => {
                    if !has_targets {
                        overridden.push(entry);
                    }
                }
                entry => {
                    self.pending.push(entry);
                    break;
                }
            }
        }
        self.pending.extend(overridden.into_iter().rev());
    }

    fn write_unparsed(
        &mut self,
        mut unparsed: UnparsedProperty,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        context.add_unparsed_fallbacks(dest.bump(), &mut unparsed);
        if let Some(prop) = BackgroundProperty::try_from_property_id(unparsed.property_id) {
            self.flushed_properties.insert(prop);
        }
        dest.push(Property::Unparsed(unparsed));
    }

    /// Writes the held declarations and the open state.
    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }
        self.has_any = false;

        // A resumable state without an image is no manual fallback of the shorthand after it.
        let mut shorthand_fallbacks = self.flushed_properties.is_empty();
        if !self.pending.is_empty() {
            let mut pending = core::mem::take(&mut self.pending);
            for entry in pending.drain(..) {
                match entry {
                    Pending::State { state, resumable } => {
                        let is_manual_fallback = !resumable || state.images.is_some();
                        self.write_state(*state, shorthand_fallbacks, dest, context);
                        shorthand_fallbacks &= !is_manual_fallback;
                    }
                    Pending::Unparsed(unparsed) => {
                        self.write_unparsed(unparsed, dest, context);
                        shorthand_fallbacks = false;
                    }
                }
            }
            self.pending = pending;
            self.first_resumable = 0;
        }
        self.reach = Reach::Every;
        let open = core::mem::take(&mut self.open);
        self.write_state(open, shorthand_fallbacks, dest, context);
    }

    fn write_state(
        &mut self,
        state: BackgroundState,
        shorthand_fallbacks: bool,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        let arena = dest.bump();

        let mut maybe_color: Option<CssColor> = state.color;
        let mut maybe_images: Option<SmallList<Image, 1>> = state.images;
        let mut maybe_x_positions: Option<SmallList<HorizontalPosition, 1>> = state.x_positions;
        let mut maybe_y_positions: Option<SmallList<VerticalPosition, 1>> = state.y_positions;
        let mut maybe_repeats: Option<SmallList<BackgroundRepeat, 1>> = state.repeats;
        let mut maybe_sizes: Option<SmallList<BackgroundSize, 1>> = state.sizes;
        let mut maybe_attachments: Option<SmallList<BackgroundAttachment, 1>> = state.attachments;
        let mut maybe_origins: Option<SmallList<BackgroundOrigin, 1>> = state.origins;
        let mut maybe_clips: Option<(SmallList<BackgroundClip, 1>, VendorPrefix)> = state.clips;

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

                if shorthand_fallbacks {
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
        self.flush(dest, context);
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
