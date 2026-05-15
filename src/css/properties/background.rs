#![allow(unused_imports, dead_code, unused_macros)]
#![warn(unused_must_use)]
use crate as css;
use crate::css_values::color::ColorFallbackKind;
use crate::css_values::color::CssColor;
use crate::css_values::image::Image;
use crate::css_values::length::LengthPercentageOrAuto;
use crate::css_values::position::{HorizontalPosition, Position, VerticalPosition};
use crate::css_values::ratio::Ratio;
use crate::generics::{CssEql, DeepClone};
use crate::properties::{Property, PropertyId, PropertyIdTag};
use crate::{
    DeclarationList, Parser, PrintErr, Printer, PropertyHandlerContext, SmallList, VendorPrefix,
};
use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVecExt as _;

/// A value for the [background](https://www.w3.org/TR/css-backgrounds-3/#background) shorthand property.
// PORT NOTE: Clone derive gated on `Image` gaining `Clone` upstream.
#[cfg_attr(any(), derive(Clone))]
pub struct Background {
    /// The background image.
    pub image: Image,
    /// The background color.
    pub color: CssColor,
    /// The background position.
    pub position: BackgroundPosition,
    /// How the background image should repeat.
    pub repeat: BackgroundRepeat,
    /// The size of the background image.
    pub size: BackgroundSize,
    /// The background attachment.
    pub attachment: BackgroundAttachment,
    /// The background origin.
    pub origin: BackgroundOrigin,
    /// How the background should be clipped.
    pub clip: BackgroundClip,
}

impl Background {
    // Zig `deinit` was a no-op (all allocations in CSS parser are in arena) — Drop handles it.

    pub fn parse(input: &mut Parser) -> css::Result<Self> {
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
            image: image.unwrap_or_else(Image::default),
            color: color.unwrap_or_else(CssColor::default),
            position: position.unwrap_or_else(BackgroundPosition::default),
            repeat: repeat.unwrap_or_else(BackgroundRepeat::default),
            size: size.unwrap_or_else(BackgroundSize::default),
            attachment: attachment.unwrap_or_else(BackgroundAttachment::default),
            origin: origin.unwrap_or(BackgroundOrigin::PaddingBox),
            clip: clip.unwrap_or(BackgroundClip::BorderBox),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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
            || (!self.clip.eql_origin(&BackgroundOrigin::BorderBox)
                && self.clip.is_background_box());

        if output_padding_box {
            if has_output {
                dest.write_str(" ")?;
            }
            self.origin.to_css(dest)?;
            has_output = true;
        }

        if (output_padding_box && !self.clip.eql_origin(&BackgroundOrigin::BorderBox))
            || !self.clip.eql_origin(&BackgroundOrigin::BorderBox)
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

    pub fn get_image(&self) -> &Image {
        &self.image
    }

    pub fn with_image(&self, arena: &Bump, image: Image) -> Self {
        let mut ret = self.deep_clone(arena);
        ret.image = image;
        ret
    }

    pub fn get_fallback(&self, arena: &Bump, kind: ColorFallbackKind) -> Background {
        let mut ret = self.deep_clone(arena);
        ret.color = self.color.get_fallback(arena, kind);
        ret.image = self.image.get_fallback(arena, kind);
        ret
    }

    pub fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> ColorFallbackKind {
        self.color.get_necessary_fallbacks(targets)
            | self.get_image().get_necessary_fallbacks(targets)
    }

    #[inline]
    pub fn deep_clone(&self, arena: &Bump) -> Self {
        // PORT NOTE: `css.implementDeepClone` reflection — expanded field-wise.
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

    pub fn eql(&self, rhs: &Self) -> bool {
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
    pub width: LengthPercentageOrAuto,
    /// The height of the background.
    pub height: LengthPercentageOrAuto,
}

impl ExplicitBackgroundSize {
    #[inline]
    pub fn deep_clone(&self, _arena: &Bump) -> Self {
        self.clone()
    }
}

impl BackgroundSize {
    pub fn parse(input: &mut Parser) -> css::Result<Self> {
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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

    pub fn default() -> Self {
        BackgroundSize::Explicit(ExplicitBackgroundSize {
            width: LengthPercentageOrAuto::Auto,
            height: LengthPercentageOrAuto::Auto,
        })
    }

    #[inline]
    pub fn deep_clone(&self, _arena: &Bump) -> Self {
        self.clone()
    }
}

/// A value for the [background-position](https://drafts.csswg.org/css-backgrounds/#background-position) shorthand property.
#[derive(Clone, PartialEq)]
pub struct BackgroundPosition {
    /// The x-position.
    pub x: HorizontalPosition,
    /// The y-position.
    pub y: VerticalPosition,
}

impl BackgroundPosition {
    // TODO(port): PropertyFieldMap — Zig comptime struct mapping fields → PropertyIdTag.
    // Port as associated consts or a trait impl in Phase B.
    pub const PROPERTY_FIELD_MAP_X: PropertyIdTag = PropertyIdTag::BackgroundPositionX;
    pub const PROPERTY_FIELD_MAP_Y: PropertyIdTag = PropertyIdTag::BackgroundPositionY;

    pub fn parse(input: &mut Parser) -> css::Result<Self> {
        let pos = Position::parse(input)?;
        Ok(BackgroundPosition::from_position(pos))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let pos = self.into_position();
        pos.to_css(dest)
    }

    pub fn default() -> Self {
        BackgroundPosition::from_position(Position::default())
    }

    pub fn from_position(pos: Position) -> BackgroundPosition {
        BackgroundPosition { x: pos.x, y: pos.y }
    }

    pub fn into_position(&self) -> Position {
        Position {
            x: self.x.clone(),
            y: self.y.clone(),
        }
    }

    #[inline]
    pub fn deep_clone(&self, _arena: &Bump) -> Self {
        self.clone()
    }
}

/// A value for the [background-repeat](https://www.w3.org/TR/css-backgrounds-3/#background-repeat) property.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct BackgroundRepeat {
    /// A repeat style for the x direction.
    pub x: BackgroundRepeatKeyword,
    /// A repeat style for the y direction.
    pub y: BackgroundRepeatKeyword,
}

impl BackgroundRepeat {
    pub fn default() -> Self {
        BackgroundRepeat {
            x: BackgroundRepeatKeyword::Repeat,
            y: BackgroundRepeatKeyword::Repeat,
        }
    }

    pub fn parse(input: &mut Parser) -> css::Result<Self> {
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

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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

    pub fn deep_clone(&self, _arena: &Bump) -> Self {
        *self
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

// TODO(port): css.DefineEnumProperty provides eql/hash/parse/to_css/deep_clone via reflection.
// Phase B: implement as a derive macro or trait that maps kebab-case names.
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
    pub fn default() -> Self {
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
    pub fn default() -> BackgroundClip {
        BackgroundClip::BorderBox
    }

    pub fn eql_origin(&self, other: &BackgroundOrigin) -> bool {
        match self {
            BackgroundClip::BorderBox => *other == BackgroundOrigin::BorderBox,
            BackgroundClip::PaddingBox => *other == BackgroundOrigin::PaddingBox,
            BackgroundClip::ContentBox => *other == BackgroundOrigin::ContentBox,
            _ => false,
        }
    }

    pub fn is_background_box(&self) -> bool {
        matches!(
            self,
            BackgroundClip::BorderBox | BackgroundClip::PaddingBox | BackgroundClip::ContentBox
        )
    }
}

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
#[derive(Clone)]
pub struct AspectRatio {
    /// The `auto` keyword.
    pub auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    pub ratio: Option<Ratio>,
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
    pub const BACKGROUND_COLOR: Self = Self::COLOR;
    pub const BACKGROUND_IMAGE: Self = Self::IMAGE;
    pub const BACKGROUND_POSITION_X: Self = Self::POSITION_X;
    pub const BACKGROUND_POSITION_Y: Self = Self::POSITION_Y;
    pub const BACKGROUND_POSITION: Self =
        Self::from_bits_truncate(Self::POSITION_X.bits() | Self::POSITION_Y.bits());
    pub const BACKGROUND_REPEAT: Self = Self::REPEAT;
    pub const BACKGROUND_SIZE: Self = Self::SIZE;
    pub const BACKGROUND_ATTACHMENT: Self = Self::ATTACHMENT;
    pub const BACKGROUND_ORIGIN: Self = Self::ORIGIN;
    pub const BACKGROUND_CLIP: Self = Self::CLIP;

    pub const BACKGROUND: Self = Self::from_bits_truncate(
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

    // blocked_on: PropertyId variant arity (BackgroundClip carries VendorPrefix payload)
    pub fn try_from_property_id(property_id: PropertyId) -> Option<BackgroundProperty> {
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

#[derive(Default)]
pub struct BackgroundHandler {
    pub color: Option<CssColor>,
    pub images: Option<SmallList<Image, 1>>,
    pub has_prefix: bool,
    pub x_positions: Option<SmallList<HorizontalPosition, 1>>,
    pub y_positions: Option<SmallList<VerticalPosition, 1>>,
    pub repeats: Option<SmallList<BackgroundRepeat, 1>>,
    pub sizes: Option<SmallList<BackgroundSize, 1>>,
    pub attachments: Option<SmallList<BackgroundAttachment, 1>>,
    pub origins: Option<SmallList<BackgroundOrigin, 1>>,
    pub clips: Option<(SmallList<BackgroundClip, 1>, VendorPrefix)>,
    // TODO(port): arena Vec — Zig is `ArrayListUnmanaged(Property)` fed `context.arena`
    // (CSS arena). Should be `bun_alloc::ArenaVec<'bump, Property>`; thread `'bump` on
    // BackgroundHandler in Phase B.
    pub decls: Vec<Property>,
    pub flushed_properties: BackgroundProperty,
    pub has_any: bool,
}

// PORT NOTE: the Zig uses comptime field-name strings + @field for `flushHelper` /
// `initSmallListHelper` / `push`. Rust cannot index struct fields by string at runtime;
// these helpers are expanded into small per-field macros below. Phase B may want a
// derive macro instead.

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
        if let Some(existing) = &$this.$field {
            if !crate::generic::eql(existing, $val)
                && $context.targets.browsers.is_some()
                && !crate::generic::is_compatible($val, $context.targets.browsers.unwrap())
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

impl BackgroundHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        let arena = dest.bump();
        match property {
            Property::BackgroundColor(val) => {
                flush_helper!(self, color, val, dest, context);
                self.color = Some(val.deep_clone(arena));
            }
            Property::BackgroundImage(val) => {
                self.background_helper(val, property, dest, context);
                self.images = Some(val.deep_clone(arena));
            }
            Property::BackgroundPosition(val) => {
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
                // Drop replaces deinit; just overwrite.
                self.x_positions = Some(val.deep_clone(arena));
            }
            Property::BackgroundPositionY(val) => {
                self.y_positions = Some(val.deep_clone(arena));
            }
            Property::BackgroundRepeat(val) => {
                self.repeats = Some(val.deep_clone(arena));
            }
            Property::BackgroundSize(val) => {
                self.sizes = Some(val.deep_clone(arena));
            }
            Property::BackgroundAttachment(val) => {
                self.attachments = Some(val.deep_clone(arena));
            }
            Property::BackgroundOrigin(val) => {
                self.origins = Some(val.deep_clone(arena));
            }
            Property::BackgroundClip(x) => {
                let val: &SmallList<BackgroundClip, 1> = &x.0;
                let vendor_prefix: VendorPrefix = x.1;
                // PORT NOTE: reshaped for borrowck — Zig held &mut into self.clips
                // across self.flush(). Compute the predicate first, then dispatch.
                let needs_flush = if let Some((clips, vp)) = &self.clips {
                    vendor_prefix != *vp && !SmallList::eql(val, clips)
                } else {
                    false
                };
                if needs_flush {
                    // `flush()` takes ownership of `self.clips` via `take()` and
                    // frees it, so any borrow into `self.clips` would be stale
                    // once `flush()` returns. Do not touch it.
                    self.flush(dest, context);
                    let arena = dest.bump();
                    self.clips = Some((val.deep_clone(arena), vendor_prefix));
                } else if let Some((clips, vp)) = &mut self.clips {
                    if !SmallList::eql(val, clips) {
                        *clips = val.deep_clone(arena);
                    }
                    vp.insert(vendor_prefix);
                } else {
                    self.clips = Some((val.deep_clone(arena), vendor_prefix));
                }
            }
            Property::Background(val) => {
                let mut images: SmallList<Image, 1> = SmallList::init_capacity(val.len());
                for b in val.slice() {
                    images.append_assume_capacity(b.image.deep_clone(arena));
                }
                self.background_helper(&images, property, dest, context);
                let arena = dest.bump();
                let color = val.last().unwrap().color.deep_clone(arena);
                flush_helper!(self, color, &color, dest, context);
                let arena = dest.bump();
                let mut clips: SmallList<BackgroundClip, 1> = SmallList::init_capacity(val.len());
                for b in val.slice() {
                    clips.append_assume_capacity(b.clip);
                }
                let mut clips_vp = VendorPrefix::NONE;
                // PORT NOTE: reshaped for borrowck — drop borrow before calling flush().
                let needs_flush = if let Some((existing_clips, existing_vp)) = &self.clips {
                    clips_vp != *existing_vp && !SmallList::eql(&clips, existing_clips)
                } else {
                    false
                };
                if needs_flush {
                    self.flush(dest, context);
                } else if let Some((_, existing_vp)) = &self.clips {
                    clips_vp.insert(*existing_vp);
                }

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

                self.clips = Some((clips, clips_vp));
            }
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

    fn background_helper(
        &mut self,
        val: &SmallList<Image, 1>,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        flush_helper!(self, images, val, dest, context);

        // Store prefixed properties. Clear if we hit an unprefixed property and we have
        // targets. In this case, the necessary prefixes will be generated.
        self.has_prefix = val.any(|item: &Image| item.has_vendor_prefix());
        if self.has_prefix {
            let arena = dest.bump();
            self.decls.push(property.deep_clone(arena));
        } else if context.targets.browsers.is_some() {
            self.decls.clear();
        }
    }

    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }
        self.has_any = false;
        let arena = dest.bump();

        let mut maybe_color: Option<CssColor> = self.color.take();
        let mut maybe_images: Option<SmallList<Image, 1>> = self.images.take();
        let mut maybe_x_positions: Option<SmallList<HorizontalPosition, 1>> =
            self.x_positions.take();
        let mut maybe_y_positions: Option<SmallList<VerticalPosition, 1>> = self.y_positions.take();
        let mut maybe_repeats: Option<SmallList<BackgroundRepeat, 1>> = self.repeats.take();
        let mut maybe_sizes: Option<SmallList<BackgroundSize, 1>> = self.sizes.take();
        let mut maybe_attachments: Option<SmallList<BackgroundAttachment, 1>> =
            self.attachments.take();
        let mut maybe_origins: Option<SmallList<BackgroundOrigin, 1>> = self.origins.take();
        let mut maybe_clips: Option<(SmallList<BackgroundClip, 1>, VendorPrefix)> =
            self.clips.take();
        // Zig had `defer { ... deinit }` here — Drop handles cleanup at scope exit.

        if maybe_color.is_some()
            && maybe_images.is_some()
            && maybe_x_positions.is_some()
            && maybe_y_positions.is_some()
            && maybe_repeats.is_some()
            && maybe_sizes.is_some()
            && maybe_attachments.is_some()
            && maybe_origins.is_some()
            && maybe_clips.is_some()
        {
            let color = maybe_color.as_ref().unwrap();
            let images = maybe_images.as_mut().unwrap();
            let x_positions = maybe_x_positions.as_mut().unwrap();
            let y_positions = maybe_y_positions.as_mut().unwrap();
            let repeats = maybe_repeats.as_mut().unwrap();
            let sizes = maybe_sizes.as_mut().unwrap();
            let attachments = maybe_attachments.as_mut().unwrap();
            let origins = maybe_origins.as_mut().unwrap();
            let clips = maybe_clips.as_mut().unwrap();

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
                // PORT NOTE: reshaped for borrowck — Zig zipped 8 slices by value; here we
                // index by `i` and clone each element to avoid 8 simultaneous borrows.
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
                // Zig: defer { clearRetainingCapacity on each list } — values were moved
                // by-value into `backgrounds` above, so clearing prevents double-free.
                // In Rust we cloned, so the originals will Drop normally; no explicit clear
                // needed for correctness. Leaving as-is.
                // PERF(port): was arena bulk-free / move-then-clear — profile in Phase B

                if self.flushed_properties.is_empty() {
                    let mut fallbacks =
                        crate::small_list::get_fallbacks(&mut backgrounds, arena, context.targets);
                    // PORT NOTE: Vec has no owning iterator; pop in reverse then
                    // re-reverse via a temp Vec to preserve order.
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

                self.reset();
                return;
            }
        }

        if let Some(mut color) = maybe_color.take() {
            if !self.flushed_properties.contains(BackgroundProperty::COLOR) {
                let fallbacks = color.get_fallbacks(arena, context.targets);
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
                    crate::small_list::get_fallbacks(&mut images, arena, context.targets);
                // PORT NOTE: Vec has no owning iterator; pop in reverse then
                // re-reverse via a temp Vec to preserve order.
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
            // Zig: clearRetainingCapacity on xs/ys after moving values out — Drop handles it.
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

        self.reset();
    }

    fn reset(&mut self) {
        // Zig deinit'd each field then set to null — Drop on assignment handles both.
        self.color = None;
        self.images = None;
        self.x_positions = None;
        self.y_positions = None;
        self.repeats = None;
        self.sizes = None;
        self.attachments = None;
        self.origins = None;
        self.clips = None;
    }

    pub fn finalize(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        // If the last declaration is prefixed, pop the last value
        // so it isn't duplicated when we flush.
        if self.has_prefix {
            let _ = self.decls.pop();
            // Drop handles deinit.
        }

        let arena = dest.bump();
        for decl in self.decls.drain(..) {
            // PORT NOTE: Zig was `appendSlice` (bitwise copy of arena-backed
            // values). `Property` is not `Clone` here, so move out via drain.
            let _ = arena;
            dest.push(decl);
        }

        self.flush(dest, context);
        self.flushed_properties = BackgroundProperty::empty();
    }
}

// `Background` participates in `SmallList::get_fallbacks` via the duck-typed
// `ImageFallback` protocol (Zig dispatched on `@hasDecl(T, "getImage")`).
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
    fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> ColorFallbackKind {
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

// ported from: src/css/properties/background.zig
