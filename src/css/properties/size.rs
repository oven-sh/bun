#![allow(unused_imports, dead_code, unused_macros)]
#![warn(unused_must_use)]
use crate as css;
use bun_alloc::ArenaVecExt as _;

use css::PrintErr;
use css::Printer;

use crate::properties::{Property, PropertyId, PropertyIdTag};
use css::css_properties::custom::UnparsedProperty;

use css::logical::PropertyCategory;

use css::css_values::length::LengthPercentage;
use css::css_values::ratio::Ratio;

use css::DeclarationList;
use css::PropertyHandlerContext;
use css::VendorPrefix;

use bun_alloc::Arena as Bump;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BoxSizing {
    /// Exclude the margin/border/padding from the width and height.
    ContentBox,
    /// Include the padding and border (but not the margin) in the width and height.
    BorderBox,
}
// PORT NOTE: css::DefineEnumProperty(@This()) — provided eql/hash/parse/toCss/deepClone via
// comptime reflection over @tagName. Hand-written here (only two variants) so the inherent
// `parse`/`to_css` participate in `impl_parse_tocss_via_inherent!` without a derive-coherence clash.
impl BoxSizing {
    pub fn parse(input: &mut css::Parser) -> css::Result<BoxSizing> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        if bun_core::eql_case_insensitive_ascii(ident, b"content-box", true) {
            Ok(BoxSizing::ContentBox)
        } else if bun_core::eql_case_insensitive_ascii(ident, b"border-box", true) {
            Ok(BoxSizing::BorderBox)
        } else {
            Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str(match self {
            BoxSizing::ContentBox => "content-box",
            BoxSizing::BorderBox => "border-box",
        })
    }

    #[inline]
    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        *self
    }
}

#[derive(Clone, PartialEq)]
pub enum Size {
    /// The `auto` keyworda
    Auto,
    /// An explicit length or percentage.
    LengthPercentage(LengthPercentage),
    /// The `min-content` keyword.
    MinContent(VendorPrefix),
    /// The `max-content` keyword.
    MaxContent(VendorPrefix),
    /// The `fit-content` keyword.
    FitContent(VendorPrefix),
    /// The `fit-content()` function.
    FitContentFunction(LengthPercentage),
    /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
    Stretch(VendorPrefix),
    /// The `contain` keyword.
    Contain,
}

/// Case-insensitive keyword dispatch for `Size`/`MaxSize` parse bodies.
/// PORT NOTE: Zig used `bun.ComptimeStringMap(..).getASCIIICaseInsensitive` —
/// expanded as an `if`-chain over `eql_case_insensitive_ascii::<true>` (≤14 keys;
/// per PORTING.md a phf table is overkill at this size).
macro_rules! size_ident_match {
    ($ident:expr, { $($lit:literal => $val:expr,)+ } else $err:expr) => {{
        let __ident: &[u8] = $ident;
        $(if bun_core::eql_case_insensitive_ascii(__ident, $lit, true) {
            Ok($val)
        } else)+ { $err }
    }};
}

impl Size {
    pub fn parse(input: &mut css::Parser) -> css::Result<Size> {
        let res = input.try_parse(|i: &mut css::Parser| -> css::Result<Size> {
            let ident = i.expect_ident()?;
            size_ident_match!(ident, {
                b"auto" => Size::Auto,
                b"min-content" => Size::MinContent(VendorPrefix::NONE),
                b"-webkit-min-content" => Size::MinContent(VendorPrefix::WEBKIT),
                b"-moz-min-content" => Size::MinContent(VendorPrefix::MOZ),
                b"max-content" => Size::MaxContent(VendorPrefix::NONE),
                b"-webkit-max-content" => Size::MaxContent(VendorPrefix::WEBKIT),
                b"-moz-max-content" => Size::MaxContent(VendorPrefix::MOZ),
                b"stretch" => Size::Stretch(VendorPrefix::NONE),
                b"-webkit-fill-available" => Size::Stretch(VendorPrefix::WEBKIT),
                b"-moz-available" => Size::Stretch(VendorPrefix::MOZ),
                b"fit-content" => Size::FitContent(VendorPrefix::NONE),
                b"-webkit-fit-content" => Size::FitContent(VendorPrefix::WEBKIT),
                b"-moz-fit-content" => Size::FitContent(VendorPrefix::MOZ),
                b"contain" => Size::Contain,
            } else Err(i.new_custom_error(css::ParserError::invalid_value)))
        });

        if res.is_ok() {
            return res;
        }

        if let Ok(v) = input.try_parse(parse_fit_content) {
            return Ok(Size::FitContentFunction(v));
        }

        let lp = input.try_parse(LengthPercentage::parse)?;
        Ok(Size::LengthPercentage(lp))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Size::Auto => dest.write_str("auto"),
            Size::Contain => dest.write_str("contain"),
            Size::MinContent(vp) => {
                vp.to_css(dest)?;
                dest.write_str("min-content")
            }
            Size::MaxContent(vp) => {
                vp.to_css(dest)?;
                dest.write_str("max-content")
            }
            Size::FitContent(vp) => {
                vp.to_css(dest)?;
                dest.write_str("fit-content")
            }
            Size::Stretch(vp) => {
                if *vp == VendorPrefix::NONE {
                    dest.write_str("stretch")
                } else if *vp == VendorPrefix::WEBKIT {
                    dest.write_str("-webkit-fill-available")
                } else if *vp == VendorPrefix::MOZ {
                    dest.write_str("-moz-available")
                } else {
                    unreachable!("Unexpected vendor prefixes")
                }
            }
            Size::FitContentFunction(l) => {
                dest.write_str("fit-content(")?;
                l.to_css(dest)?;
                dest.write_char(b')')
            }
            Size::LengthPercentage(l) => l.to_css(dest),
        }
    }
}

// PORT NOTE: split out of the gated `impl Size` above (B-2 round 15) — these
// don't depend on `parse`/`to_css` surface and are needed by `SizeHandler`.
impl Size {
    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        use css::compat::Feature as F;
        match self {
            Size::LengthPercentage(l) => l.is_compatible(browsers),
            Size::MinContent(_) => F::MinContentSize.is_compatible(browsers),
            Size::MaxContent(_) => F::MaxContentSize.is_compatible(browsers),
            Size::FitContent(_) => F::FitContentSize.is_compatible(browsers),
            Size::FitContentFunction(l) => {
                F::FitContentFunctionSize.is_compatible(browsers) && l.is_compatible(browsers)
            }
            Size::Stretch(vp) => {
                let feature = if *vp == VendorPrefix::NONE {
                    F::StretchSize
                } else if *vp == VendorPrefix::WEBKIT {
                    F::WebkitFillAvailableSize
                } else if *vp == VendorPrefix::MOZ {
                    F::MozAvailableSize
                } else {
                    return false;
                };
                feature.is_compatible(browsers)
            }
            Size::Contain => false, // ??? no data in mdn
            Size::Auto => true,
        }
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        // TODO(port): css.implementDeepClone — comptime field-walk; `Size` carries
        // only `LengthPercentage`/`VendorPrefix` payloads, both `Clone`-via-derive.
        self.clone()
    }

    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        // TODO(port): css.implementEql — comptime field-walk; #[derive(PartialEq)] above covers it.
        lhs == rhs
    }
}

/// A value for the [minimum](https://drafts.csswg.org/css-sizing-3/#min-size-properties)
/// and [maximum](https://drafts.csswg.org/css-sizing-3/#max-size-properties) size properties,
/// e.g. `min-width` and `max-height`.
#[derive(Clone, PartialEq)]
pub enum MaxSize {
    /// The `none` keyword.
    None,
    /// An explicit length or percentage.
    LengthPercentage(LengthPercentage),
    /// The `min-content` keyword.
    MinContent(VendorPrefix),
    /// The `max-content` keyword.
    MaxContent(VendorPrefix),
    /// The `fit-content` keyword.
    FitContent(VendorPrefix),
    /// The `fit-content()` function.
    FitContentFunction(LengthPercentage),
    /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
    Stretch(VendorPrefix),
    /// The `contain` keyword.
    Contain,
}

impl MaxSize {
    pub fn parse(input: &mut css::Parser) -> css::Result<MaxSize> {
        let res = input.try_parse(|i: &mut css::Parser| -> css::Result<MaxSize> {
            let ident = i.expect_ident()?;
            size_ident_match!(ident, {
                b"none" => MaxSize::None,
                b"min-content" => MaxSize::MinContent(VendorPrefix::NONE),
                b"-webkit-min-content" => MaxSize::MinContent(VendorPrefix::WEBKIT),
                b"-moz-min-content" => MaxSize::MinContent(VendorPrefix::MOZ),
                b"max-content" => MaxSize::MaxContent(VendorPrefix::NONE),
                b"-webkit-max-content" => MaxSize::MaxContent(VendorPrefix::WEBKIT),
                b"-moz-max-content" => MaxSize::MaxContent(VendorPrefix::MOZ),
                b"stretch" => MaxSize::Stretch(VendorPrefix::NONE),
                b"-webkit-fill-available" => MaxSize::Stretch(VendorPrefix::WEBKIT),
                b"-moz-available" => MaxSize::Stretch(VendorPrefix::MOZ),
                b"fit-content" => MaxSize::FitContent(VendorPrefix::NONE),
                b"-webkit-fit-content" => MaxSize::FitContent(VendorPrefix::WEBKIT),
                b"-moz-fit-content" => MaxSize::FitContent(VendorPrefix::MOZ),
                b"contain" => MaxSize::Contain,
            } else Err(i.new_custom_error(css::ParserError::invalid_value)))
        });

        if res.is_ok() {
            return res;
        }

        if let Ok(v) = input.try_parse(parse_fit_content) {
            return Ok(MaxSize::FitContentFunction(v));
        }

        match input.try_parse(LengthPercentage::parse) {
            Ok(v) => Ok(MaxSize::LengthPercentage(v)),
            Err(e) => Err(e),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            MaxSize::None => dest.write_str("none"),
            MaxSize::Contain => dest.write_str("contain"),
            MaxSize::MinContent(vp) => {
                vp.to_css(dest)?;
                dest.write_str("min-content")
            }
            MaxSize::MaxContent(vp) => {
                vp.to_css(dest)?;
                dest.write_str("max-content")
            }
            MaxSize::FitContent(vp) => {
                vp.to_css(dest)?;
                dest.write_str("fit-content")
            }
            MaxSize::Stretch(vp) => {
                if *vp == VendorPrefix::NONE {
                    dest.write_str("stretch")
                } else if *vp == VendorPrefix::WEBKIT {
                    dest.write_str("-webkit-fill-available")
                } else if *vp == VendorPrefix::MOZ {
                    dest.write_str("-moz-available")
                } else {
                    unreachable!("Unexpected vendor prefixes")
                }
            }
            MaxSize::FitContentFunction(l) => {
                dest.write_str("fit-content(")?;
                l.to_css(dest)?;
                dest.write_char(b')')
            }
            MaxSize::LengthPercentage(l) => l.to_css(dest),
        }
    }
}

// PORT NOTE: split out of the gated `impl MaxSize` above (B-2 round 15) — these
// don't depend on `parse`/`to_css` surface and are needed by `SizeHandler`.
impl MaxSize {
    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        use css::compat::Feature as F;
        match self {
            MaxSize::LengthPercentage(l) => l.is_compatible(browsers),
            MaxSize::MinContent(_) => F::MinContentSize.is_compatible(browsers),
            MaxSize::MaxContent(_) => F::MaxContentSize.is_compatible(browsers),
            MaxSize::FitContent(_) => F::FitContentSize.is_compatible(browsers),
            MaxSize::FitContentFunction(l) => {
                F::FitContentFunctionSize.is_compatible(browsers) && l.is_compatible(browsers)
            }
            MaxSize::Stretch(vp) => {
                let feature = if *vp == VendorPrefix::NONE {
                    F::StretchSize
                } else if *vp == VendorPrefix::WEBKIT {
                    F::WebkitFillAvailableSize
                } else if *vp == VendorPrefix::MOZ {
                    F::MozAvailableSize
                } else {
                    return false;
                };
                feature.is_compatible(browsers)
            }
            MaxSize::Contain => false, // ??? no data in mdn
            MaxSize::None => true,
        }
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        // TODO(port): css.implementDeepClone — comptime field-walk; `MaxSize` carries
        // only `LengthPercentage`/`VendorPrefix` payloads, both `Clone`-via-derive.
        self.clone()
    }

    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        lhs == rhs
    }
}

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
#[derive(Clone, PartialEq)]
pub struct AspectRatio {
    /// The `auto` keyword.
    pub auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    pub ratio: Option<Ratio>,
}

impl AspectRatio {
    pub fn parse(input: &mut css::Parser) -> css::Result<AspectRatio> {
        let location = input.current_source_location();
        let mut auto = input.try_parse(|i| i.expect_ident_matching(b"auto"));

        let ratio = input.try_parse(Ratio::parse);
        if auto.is_err() {
            auto = input.try_parse(|i| i.expect_ident_matching(b"auto"));
        }
        if auto.is_err() && ratio.is_err() {
            return Err(location.new_custom_error(css::ParserError::invalid_value));
        }

        Ok(AspectRatio {
            auto: auto.is_ok(),
            ratio: ratio.ok(),
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.auto {
            dest.write_str("auto")?;
        }

        if let Some(ratio) = &self.ratio {
            if self.auto {
                dest.write_char(b' ')?;
            }
            ratio.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        // PORT NOTE: css.implementDeepClone — `Ratio` is two `f32`s; #[derive(Clone)] is exact.
        self.clone()
    }

    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        lhs == rhs
    }
}

fn parse_fit_content(input: &mut css::Parser) -> css::Result<LengthPercentage> {
    input.expect_function_matching(b"fit-content")?;
    input.parse_nested_block(LengthPercentage::parse)
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct SizeProperty: u16 {
        const WIDTH           = 1 << 0;
        const HEIGHT          = 1 << 1;
        const MIN_WIDTH       = 1 << 2;
        const MIN_HEIGHT      = 1 << 3;
        const MAX_WIDTH       = 1 << 4;
        const MAX_HEIGHT      = 1 << 5;
        const BLOCK_SIZE      = 1 << 6;
        const INLINE_SIZE     = 1 << 7;
        const MIN_BLOCK_SIZE  = 1 << 8;
        const MIN_INLINE_SIZE = 1 << 9;
        const MAX_BLOCK_SIZE  = 1 << 10;
        const MAX_INLINE_SIZE = 1 << 11;
        // __unused: u4 — top 4 bits
    }
}

impl SizeProperty {
    pub fn try_from_property_id_tag(property_id: PropertyIdTag) -> Option<SizeProperty> {
        // TODO(port): Zig used `inline for (std.meta.fields(@This()))` to compare each
        // bitfield name against PropertyIdTag's @tagName. Expanded explicitly here.
        match property_id {
            PropertyIdTag::Width => Some(SizeProperty::WIDTH),
            PropertyIdTag::Height => Some(SizeProperty::HEIGHT),
            PropertyIdTag::MinWidth => Some(SizeProperty::MIN_WIDTH),
            PropertyIdTag::MinHeight => Some(SizeProperty::MIN_HEIGHT),
            PropertyIdTag::MaxWidth => Some(SizeProperty::MAX_WIDTH),
            PropertyIdTag::MaxHeight => Some(SizeProperty::MAX_HEIGHT),
            PropertyIdTag::BlockSize => Some(SizeProperty::BLOCK_SIZE),
            PropertyIdTag::InlineSize => Some(SizeProperty::INLINE_SIZE),
            PropertyIdTag::MinBlockSize => Some(SizeProperty::MIN_BLOCK_SIZE),
            PropertyIdTag::MinInlineSize => Some(SizeProperty::MIN_INLINE_SIZE),
            PropertyIdTag::MaxBlockSize => Some(SizeProperty::MAX_BLOCK_SIZE),
            PropertyIdTag::MaxInlineSize => Some(SizeProperty::MAX_INLINE_SIZE),
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct SizeHandler {
    pub width: Option<Size>,
    pub height: Option<Size>,
    pub min_width: Option<Size>,
    pub min_height: Option<Size>,
    pub max_width: Option<MaxSize>,
    pub max_height: Option<MaxSize>,
    pub block_size: Option<Size>,
    pub inline_size: Option<Size>,
    pub min_block_size: Option<Size>,
    pub min_inline_size: Option<Size>,
    pub max_block_size: Option<MaxSize>,
    pub max_inline_size: Option<MaxSize>,
    pub has_any: bool,
    pub flushed_properties: SizeProperty,
    pub category: PropertyCategory,
}

// PORT NOTE: un-gated B-2 round 15 — Property variants + prefixes::Feature +
// UnparsedProperty surface are real now. `context.arena` was dropped from
// PropertyHandlerContext; the arena is recovered via `dest.bump()`.
use css::compat::Feature;

// ─── helper macros (Zig used `inline fn` + `comptime []const u8` field names + @field/@unionInit) ───
//
// TODO(port): the following four macros replace Zig's `propertyHelper`, `logicalUnparsedHelper`,
// `flushPrefixHelper`, `flushPropertyHelper`, `flushLogicalHelper`. The Zig code passes field
// names as comptime strings and uses @field/@unionInit/@tagName to splice them into struct/enum
// accesses. Rust has no equivalent reflection — macro_rules! is the closest 1:1 mapping.
// PERF(port): was comptime monomorphization — profile in Phase B.

macro_rules! property_helper {
    ($this:expr, $field:ident, $ty:ty, $value:expr, $category:expr, $dest:expr, $context:expr) => {{
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.
        if $category != $this.category
            || ($this.$field.is_some()
                && $context.targets.browsers.is_some()
                && !$value.is_compatible($context.targets.browsers.unwrap()))
        {
            $this.flush($dest, $context);
        }

        $this.$field = Some($value.deep_clone($dest.bump()));
        $this.category = $category;
        $this.has_any = true;
    }};
}

macro_rules! logical_unparsed_helper {
    ($this:expr, $unparsed:expr, $physical_id:expr, $physical_flag:expr, $logical_supported:expr, $dest:expr, $context:expr) => {{
        let bump = $dest.bump();
        if $logical_supported {
            $this.flushed_properties.insert(
                SizeProperty::try_from_property_id_tag($unparsed.property_id.tag()).unwrap(),
            );
            // PORT NOTE: Zig pushed `property.deepClone(arena)`; the matched
            // payload is `Unparsed`, so reconstruct directly.
            $dest.push(Property::Unparsed($unparsed.deep_clone(bump)));
        } else {
            $dest.push(Property::Unparsed(
                $unparsed.with_property_id(bump, $physical_id),
            ));
            $this.flushed_properties.insert($physical_flag);
        }
    }};
}

macro_rules! flush_prefix_helper {
    ($this:expr, $prop_flag:expr, $prop_variant:ident, $size_ty:ident, $feature:ident, $size_variant:ident, $dest:expr, $context:expr) => {{
        if !$this.flushed_properties.contains($prop_flag) {
            let prefixes = $context
                .targets
                .prefixes(VendorPrefix::NONE, css::prefixes::Feature::$feature)
                .difference(VendorPrefix::NONE);
            // TODO(port): `inline for (css.VendorPrefix.FIELDS)` — iterate set bits.
            for prefix in prefixes.iter() {
                $dest.push(Property::$prop_variant($size_ty::$size_variant(prefix)));
            }
        }
    }};
}

macro_rules! flush_property_helper {
    ($this:expr, $prop_flag:expr, $prop_variant:ident, $field:ident, $size_ty:ident, $dest:expr, $context:expr) => {{
        if let Some(val) = $this.$field.take() {
            match &val {
                $size_ty::Stretch(vp) if *vp == VendorPrefix::NONE => {
                    flush_prefix_helper!(
                        $this,
                        $prop_flag,
                        $prop_variant,
                        $size_ty,
                        Stretch,
                        Stretch,
                        $dest,
                        $context
                    );
                }
                $size_ty::MinContent(vp) if *vp == VendorPrefix::NONE => {
                    flush_prefix_helper!(
                        $this,
                        $prop_flag,
                        $prop_variant,
                        $size_ty,
                        MinContent,
                        MinContent,
                        $dest,
                        $context
                    );
                }
                $size_ty::MaxContent(vp) if *vp == VendorPrefix::NONE => {
                    flush_prefix_helper!(
                        $this,
                        $prop_flag,
                        $prop_variant,
                        $size_ty,
                        MaxContent,
                        MaxContent,
                        $dest,
                        $context
                    );
                }
                $size_ty::FitContent(vp) if *vp == VendorPrefix::NONE => {
                    flush_prefix_helper!(
                        $this,
                        $prop_flag,
                        $prop_variant,
                        $size_ty,
                        FitContent,
                        FitContent,
                        $dest,
                        $context
                    );
                }
                _ => {}
            }
            $dest.push(Property::$prop_variant(val));
            $this.flushed_properties.insert($prop_flag);
        }
    }};
}

macro_rules! flush_logical_helper {
    (
        $this:expr,
        $prop_flag:expr, $prop_variant:ident,
        $field:ident,
        $phys_flag:expr, $phys_variant:ident,
        $size_ty:ident,
        $logical_supported:expr,
        $dest:expr, $context:expr
    ) => {{
        if $logical_supported {
            flush_property_helper!(
                $this,
                $prop_flag,
                $prop_variant,
                $field,
                $size_ty,
                $dest,
                $context
            );
        } else {
            flush_property_helper!(
                $this,
                $phys_flag,
                $phys_variant,
                $field,
                $size_ty,
                $dest,
                $context
            );
        }
    }};
}

impl SizeHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        let logical_supported = !context.should_compile_logical(Feature::LogicalSize);

        match property {
            Property::Width(v) => {
                property_helper!(
                    self,
                    width,
                    Size,
                    v,
                    PropertyCategory::Physical,
                    dest,
                    context
                )
            }
            Property::Height(v) => {
                property_helper!(
                    self,
                    height,
                    Size,
                    v,
                    PropertyCategory::Physical,
                    dest,
                    context
                )
            }
            Property::MinWidth(v) => {
                property_helper!(
                    self,
                    min_width,
                    Size,
                    v,
                    PropertyCategory::Physical,
                    dest,
                    context
                )
            }
            Property::MinHeight(v) => {
                property_helper!(
                    self,
                    min_height,
                    Size,
                    v,
                    PropertyCategory::Physical,
                    dest,
                    context
                )
            }
            Property::MaxWidth(v) => {
                property_helper!(
                    self,
                    max_width,
                    MaxSize,
                    v,
                    PropertyCategory::Physical,
                    dest,
                    context
                )
            }
            Property::MaxHeight(v) => {
                property_helper!(
                    self,
                    max_height,
                    MaxSize,
                    v,
                    PropertyCategory::Physical,
                    dest,
                    context
                )
            }
            Property::BlockSize(v) => {
                property_helper!(
                    self,
                    block_size,
                    Size,
                    v,
                    PropertyCategory::Logical,
                    dest,
                    context
                )
            }
            Property::MinBlockSize(v) => {
                property_helper!(
                    self,
                    min_block_size,
                    Size,
                    v,
                    PropertyCategory::Logical,
                    dest,
                    context
                )
            }
            Property::MaxBlockSize(v) => {
                property_helper!(
                    self,
                    max_block_size,
                    MaxSize,
                    v,
                    PropertyCategory::Logical,
                    dest,
                    context
                )
            }
            Property::InlineSize(v) => {
                property_helper!(
                    self,
                    inline_size,
                    Size,
                    v,
                    PropertyCategory::Logical,
                    dest,
                    context
                )
            }
            Property::MinInlineSize(v) => {
                property_helper!(
                    self,
                    min_inline_size,
                    Size,
                    v,
                    PropertyCategory::Logical,
                    dest,
                    context
                )
            }
            Property::MaxInlineSize(v) => {
                property_helper!(
                    self,
                    max_inline_size,
                    MaxSize,
                    v,
                    PropertyCategory::Logical,
                    dest,
                    context
                )
            }
            Property::Unparsed(unparsed) => match unparsed.property_id.tag() {
                PropertyIdTag::Width
                | PropertyIdTag::Height
                | PropertyIdTag::MinWidth
                | PropertyIdTag::MaxWidth
                | PropertyIdTag::MinHeight
                | PropertyIdTag::MaxHeight => {
                    self.flushed_properties.insert(
                        SizeProperty::try_from_property_id_tag(unparsed.property_id.tag()).unwrap(),
                    );
                    let bump = dest.bump();
                    dest.push(Property::Unparsed(unparsed.deep_clone(bump)));
                }
                PropertyIdTag::BlockSize => logical_unparsed_helper!(
                    self,
                    unparsed,
                    PropertyId::Height,
                    SizeProperty::HEIGHT,
                    logical_supported,
                    dest,
                    context
                ),
                PropertyIdTag::MinBlockSize => logical_unparsed_helper!(
                    self,
                    unparsed,
                    PropertyId::MinHeight,
                    SizeProperty::MIN_HEIGHT,
                    logical_supported,
                    dest,
                    context
                ),
                PropertyIdTag::MaxBlockSize => logical_unparsed_helper!(
                    self,
                    unparsed,
                    PropertyId::MaxHeight,
                    SizeProperty::MAX_HEIGHT,
                    logical_supported,
                    dest,
                    context
                ),
                PropertyIdTag::InlineSize => logical_unparsed_helper!(
                    self,
                    unparsed,
                    PropertyId::Width,
                    SizeProperty::WIDTH,
                    logical_supported,
                    dest,
                    context
                ),
                PropertyIdTag::MinInlineSize => logical_unparsed_helper!(
                    self,
                    unparsed,
                    PropertyId::MinWidth,
                    SizeProperty::MIN_WIDTH,
                    logical_supported,
                    dest,
                    context
                ),
                PropertyIdTag::MaxInlineSize => logical_unparsed_helper!(
                    self,
                    unparsed,
                    PropertyId::MaxWidth,
                    SizeProperty::MAX_WIDTH,
                    logical_supported,
                    dest,
                    context
                ),
                _ => return false,
            },
            _ => return false,
        }

        true
    }

    pub fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }

        self.has_any = false;
        let logical_supported = !context.should_compile_logical(Feature::LogicalSize);

        flush_property_helper!(self, SizeProperty::WIDTH, Width, width, Size, dest, context);
        flush_property_helper!(
            self,
            SizeProperty::MIN_WIDTH,
            MinWidth,
            min_width,
            Size,
            dest,
            context
        );
        flush_property_helper!(
            self,
            SizeProperty::MAX_WIDTH,
            MaxWidth,
            max_width,
            MaxSize,
            dest,
            context
        );
        flush_property_helper!(
            self,
            SizeProperty::HEIGHT,
            Height,
            height,
            Size,
            dest,
            context
        );
        flush_property_helper!(
            self,
            SizeProperty::MIN_HEIGHT,
            MinHeight,
            min_height,
            Size,
            dest,
            context
        );
        flush_property_helper!(
            self,
            SizeProperty::MAX_HEIGHT,
            MaxHeight,
            max_height,
            MaxSize,
            dest,
            context
        );
        flush_logical_helper!(
            self,
            SizeProperty::BLOCK_SIZE,
            BlockSize,
            block_size,
            SizeProperty::HEIGHT,
            Height,
            Size,
            logical_supported,
            dest,
            context
        );
        flush_logical_helper!(
            self,
            SizeProperty::MIN_BLOCK_SIZE,
            MinBlockSize,
            min_block_size,
            SizeProperty::MIN_HEIGHT,
            MinHeight,
            Size,
            logical_supported,
            dest,
            context
        );
        flush_logical_helper!(
            self,
            SizeProperty::MAX_BLOCK_SIZE,
            MaxBlockSize,
            max_block_size,
            SizeProperty::MAX_HEIGHT,
            MaxHeight,
            MaxSize,
            logical_supported,
            dest,
            context
        );
        flush_logical_helper!(
            self,
            SizeProperty::INLINE_SIZE,
            InlineSize,
            inline_size,
            SizeProperty::WIDTH,
            Width,
            Size,
            logical_supported,
            dest,
            context
        );
        flush_logical_helper!(
            self,
            SizeProperty::MIN_INLINE_SIZE,
            MinInlineSize,
            min_inline_size,
            SizeProperty::MIN_WIDTH,
            MinWidth,
            Size,
            logical_supported,
            dest,
            context
        );
        flush_logical_helper!(
            self,
            SizeProperty::MAX_INLINE_SIZE,
            MaxInlineSize,
            max_inline_size,
            SizeProperty::MAX_WIDTH,
            MaxWidth,
            MaxSize,
            logical_supported,
            dest,
            context
        );
    }

    pub fn finalize(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        self.flush(dest, context);
        self.flushed_properties = SizeProperty::empty();
    }
}

// ported from: src/css/properties/size.zig
