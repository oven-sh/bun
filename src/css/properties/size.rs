#![warn(unused_must_use)]
use crate as css;
use bun_alloc::ArenaVecExt as _;

use css::PrintErr;
use css::Printer;

use crate::properties::{Property, PropertyId, PropertyIdTag};

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
// Hand-written (only two variants) so the inherent `parse`/`to_css` participate in
// `impl_parse_tocss_via_inherent!` without a derive-coherence clash.
impl BoxSizing {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<BoxSizing> {
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

    pub(crate) fn to_css(self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str(match self {
            BoxSizing::ContentBox => "content-box",
            BoxSizing::BorderBox => "border-box",
        })
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
/// An `if`-chain over `eql_case_insensitive_ascii::<true>` (≤14 keys;
/// a phf table is overkill at this size).
macro_rules! size_ident_match {
    ($ident:expr, { $($lit:literal => $val:expr,)+ } else $err:expr) => {{
        let __ident: &[u8] = $ident;
        $(if bun_core::eql_case_insensitive_ascii(__ident, $lit, true) {
            Ok($val)
        } else)+ { $err }
    }};
}

impl Size {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<Size> {
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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

// Split out of `impl Size` above — these don't depend on
// `parse`/`to_css` surface and are needed by `SizeHandler`.
impl Size {
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
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

    /// Whether every target reads the value with the vendor prefix it has.
    /// See [`css::targets::Targets::all_read`].
    fn is_read_by_all(&self, targets: &css::targets::Targets) -> bool {
        match self {
            Size::MinContent(vp)
            | Size::MaxContent(vp)
            | Size::FitContent(vp)
            | Size::Stretch(vp) => targets.all_read(css::targets::PrefixedValue::SizeKeyword, *vp),
            _ => true,
        }
    }

    pub(crate) fn deep_clone(&self, _bump: &Bump) -> Self {
        // `Size` carries only `LengthPercentage`/`VendorPrefix` payloads, both `Clone`-via-derive.
        self.clone()
    }

    pub(crate) fn eql(lhs: &Self, rhs: &Self) -> bool {
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
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<MaxSize> {
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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

// Split out of `impl MaxSize` above — these don't depend on
// `parse`/`to_css` surface and are needed by `SizeHandler`.
impl MaxSize {
    fn is_compatible(&self, browsers: &css::targets::Browsers) -> bool {
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

    /// Whether every target reads the value with the vendor prefix it has.
    /// See [`css::targets::Targets::all_read`].
    fn is_read_by_all(&self, targets: &css::targets::Targets) -> bool {
        match self {
            MaxSize::MinContent(vp)
            | MaxSize::MaxContent(vp)
            | MaxSize::FitContent(vp)
            | MaxSize::Stretch(vp) => {
                targets.all_read(css::targets::PrefixedValue::SizeKeyword, *vp)
            }
            _ => true,
        }
    }

    pub(crate) fn deep_clone(&self, _bump: &Bump) -> Self {
        // `MaxSize` carries only `LengthPercentage`/`VendorPrefix` payloads, both `Clone`-via-derive.
        self.clone()
    }

    pub(crate) fn eql(lhs: &Self, rhs: &Self) -> bool {
        lhs == rhs
    }
}

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
#[derive(Copy, Clone, PartialEq)]
pub struct AspectRatio {
    /// The `auto` keyword.
    pub(crate) auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    pub(crate) ratio: Option<Ratio>,
}

impl AspectRatio {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<AspectRatio> {
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
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

    pub(crate) fn deep_clone(&self, _bump: &Bump) -> Self {
        // `Ratio` is two `f32`s; #[derive(Clone)] is exact.
        *self
    }

    pub(crate) fn eql(lhs: &Self, rhs: &Self) -> bool {
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
    fn try_from_property_id_tag(property_id: PropertyIdTag) -> Option<SizeProperty> {
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
    pub(crate) width: Option<Size>,
    pub(crate) height: Option<Size>,
    pub(crate) min_width: Option<Size>,
    pub(crate) min_height: Option<Size>,
    pub(crate) max_width: Option<MaxSize>,
    pub(crate) max_height: Option<MaxSize>,
    pub(crate) block_size: Option<Size>,
    pub(crate) inline_size: Option<Size>,
    pub(crate) min_block_size: Option<Size>,
    pub(crate) min_inline_size: Option<Size>,
    pub(crate) max_block_size: Option<MaxSize>,
    pub(crate) max_inline_size: Option<MaxSize>,
    /// The values that a later value of the same property did not replace,
    /// because some target does not read the later one. They are written
    /// ahead of the values above.
    earlier: Vec<Property>,
    pub(crate) has_any: bool,
    pub(crate) flushed_properties: SizeProperty,
    pub(crate) category: PropertyCategory,
}

// `context.arena` was dropped from PropertyHandlerContext; the
// arena is recovered via `dest.bump()`.
use css::compat::Feature;

// ─── helper macros ───

macro_rules! property_helper {
    ($this:expr, $field:ident, $variant:ident, $value:expr, $category:expr, $dest:expr, $context:expr) => {{
        // If the category changes betweet logical and physical,
        // or if the value contains syntax that isn't supported across all targets,
        // preserve the previous value as a fallback.
        if $category != $this.category
            || ($this.$field.is_some()
                && $context.targets.browsers.is_some()
                && !$value.is_compatible($context.targets.browsers.as_ref().unwrap()))
        {
            $this.flush($dest, $context);
        }

        let value = $value.deep_clone($dest.bump());
        let read_by_all = value.is_read_by_all(&$context.targets);
        if !read_by_all || !$this.earlier.is_empty() {
            keep_earlier(
                &mut $this.earlier,
                &mut $this.$field,
                &value,
                read_by_all,
                Property::$variant,
                |property| match property {
                    Property::$variant(value) => Some(value),
                    _ => None,
                },
            );
        }
        $this.$field = Some(value);
        $this.category = $category;
        $this.has_any = true;
    }};
}

/// `value` follows `pending` for one size property. `earlier` has the values
/// of every size property that a later value did not replace.
///
/// A target that does not read `value` drops the declaration and uses the one
/// before it (CSS 2.1 section 4.2), so `pending` is kept. lightningcss
/// overwrites it. A value that every target reads removes the kept values of
/// its property.
#[inline(never)]
fn keep_earlier<T: PartialEq>(
    earlier: &mut Vec<Property>,
    pending: &mut Option<T>,
    value: &T,
    read_by_all: bool,
    property: fn(T) -> Property,
    of_property: fn(&Property) -> Option<&T>,
) {
    if read_by_all {
        earlier.retain(|earlier| of_property(earlier).is_none());
        return;
    }
    // An equal value has the same readers, so it replaces the one before it.
    // The list is then never longer than the set of prefixed values.
    earlier.retain(|earlier| of_property(earlier) != Some(value));
    if let Some(pending) = pending.take() {
        if pending != *value {
            earlier.push(property(pending));
        }
    }
}

macro_rules! logical_unparsed_helper {
    ($this:expr, $unparsed:expr, $physical_id:expr, $physical_flag:expr, $logical_supported:expr, $dest:expr, $context:expr) => {{
        $this.flush_before_unparsed(
            $unparsed.property_id.tag(),
            PropertyCategory::Logical,
            $dest,
            $context,
        );
        let bump = $dest.bump();
        if $logical_supported {
            $this.flushed_properties.insert(
                SizeProperty::try_from_property_id_tag($unparsed.property_id.tag()).unwrap(),
            );
            // The matched payload is `Unparsed`, so reconstruct directly.
            $dest.push(Property::Unparsed($unparsed.deep_clone(bump)));
        } else {
            $dest.push(Property::Unparsed(
                $unparsed.with_property_id(bump, $physical_id),
            ));
            $this.flushed_properties.insert($physical_flag);
        }
    }};
}

/// The keyword sizes that may need vendor-prefixed fallbacks (`stretch`,
/// `min-content`, ...), shared by `Size` and `MaxSize` so `flush` is one
/// out-of-line helper per value type instead of one expansion per property.
trait PrefixedKeyword: Sized {
    fn unprefixed_keyword(&self) -> Option<(css::prefixes::Feature, fn(VendorPrefix) -> Self)>;
}

macro_rules! impl_prefixed_keyword {
    ($ty:ident) => {
        impl PrefixedKeyword for $ty {
            fn unprefixed_keyword(
                &self,
            ) -> Option<(css::prefixes::Feature, fn(VendorPrefix) -> Self)> {
                use css::prefixes::Feature;
                match self {
                    $ty::Stretch(vp) if *vp == VendorPrefix::NONE => {
                        Some((Feature::Stretch, $ty::Stretch))
                    }
                    $ty::MinContent(vp) if *vp == VendorPrefix::NONE => {
                        Some((Feature::MinContent, $ty::MinContent))
                    }
                    $ty::MaxContent(vp) if *vp == VendorPrefix::NONE => {
                        Some((Feature::MaxContent, $ty::MaxContent))
                    }
                    $ty::FitContent(vp) if *vp == VendorPrefix::NONE => {
                        Some((Feature::FitContent, $ty::FitContent))
                    }
                    _ => None,
                }
            }
        }
    };
}
impl_prefixed_keyword!(Size);
impl_prefixed_keyword!(MaxSize);

#[inline(never)]
fn flush_size_property<T: PrefixedKeyword>(
    flushed_properties: &mut SizeProperty,
    val: Option<T>,
    flag: SizeProperty,
    property: fn(T) -> Property,
    dest: &mut DeclarationList,
    context: &PropertyHandlerContext,
) {
    let Some(val) = val else {
        return;
    };
    if let Some((feature, keyword)) = val.unprefixed_keyword() {
        if !flushed_properties.contains(flag) {
            let prefixes = context
                .targets
                .prefixes(VendorPrefix::NONE, feature)
                .difference(VendorPrefix::NONE);
            for prefix in prefixes.iter() {
                dest.push(property(keyword(prefix)));
            }
        }
    }
    dest.push(property(val));
    flushed_properties.insert(flag);
}

impl SizeHandler {
    pub(crate) fn handle_property(
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
                    Width,
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
                    Height,
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
                    MinWidth,
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
                    MinHeight,
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
                    MaxWidth,
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
                    MaxHeight,
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
                    BlockSize,
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
                    MinBlockSize,
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
                    MaxBlockSize,
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
                    InlineSize,
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
                    MinInlineSize,
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
                    MaxInlineSize,
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
                    self.flush_before_unparsed(
                        unparsed.property_id.tag(),
                        PropertyCategory::Physical,
                        dest,
                        context,
                    );
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

    /// An unparsed value of the property `tag` follows. The pending values that
    /// it replaces are written before it: a value of that property, the values
    /// of the other category (a logical and a physical property can be the
    /// same size), and the kept values. A kept value behind it would replace it.
    #[inline(never)]
    fn flush_before_unparsed(
        &mut self,
        tag: PropertyIdTag,
        category: PropertyCategory,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        if self.has_any
            && (self.category != category || !self.earlier.is_empty() || self.is_pending(tag))
        {
            self.flush(dest, context);
        }
    }

    fn is_pending(&self, tag: PropertyIdTag) -> bool {
        match tag {
            PropertyIdTag::Width => self.width.is_some(),
            PropertyIdTag::Height => self.height.is_some(),
            PropertyIdTag::MinWidth => self.min_width.is_some(),
            PropertyIdTag::MinHeight => self.min_height.is_some(),
            PropertyIdTag::MaxWidth => self.max_width.is_some(),
            PropertyIdTag::MaxHeight => self.max_height.is_some(),
            PropertyIdTag::BlockSize => self.block_size.is_some(),
            PropertyIdTag::InlineSize => self.inline_size.is_some(),
            PropertyIdTag::MinBlockSize => self.min_block_size.is_some(),
            PropertyIdTag::MinInlineSize => self.min_inline_size.is_some(),
            PropertyIdTag::MaxBlockSize => self.max_block_size.is_some(),
            PropertyIdTag::MaxInlineSize => self.max_inline_size.is_some(),
            _ => false,
        }
    }

    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }

        self.has_any = false;
        let logical_supported = !context.should_compile_logical(Feature::LogicalSize);
        let flushed = &mut self.flushed_properties;

        macro_rules! physical {
            ($flag:ident, $variant:ident, $val:expr) => {
                flush_size_property(
                    flushed,
                    $val,
                    SizeProperty::$flag,
                    Property::$variant,
                    dest,
                    context,
                )
            };
        }
        macro_rules! logical {
            ($flag:ident, $variant:ident, $val:expr, $phys_flag:ident, $phys_variant:ident) => {
                if logical_supported {
                    physical!($flag, $variant, $val)
                } else {
                    physical!($phys_flag, $phys_variant, $val)
                }
            };
        }

        for earlier in self.earlier.drain(..) {
            match earlier {
                Property::Width(v) => physical!(WIDTH, Width, Some(v)),
                Property::MinWidth(v) => physical!(MIN_WIDTH, MinWidth, Some(v)),
                Property::MaxWidth(v) => physical!(MAX_WIDTH, MaxWidth, Some(v)),
                Property::Height(v) => physical!(HEIGHT, Height, Some(v)),
                Property::MinHeight(v) => physical!(MIN_HEIGHT, MinHeight, Some(v)),
                Property::MaxHeight(v) => physical!(MAX_HEIGHT, MaxHeight, Some(v)),
                Property::BlockSize(v) => logical!(BLOCK_SIZE, BlockSize, Some(v), HEIGHT, Height),
                Property::MinBlockSize(v) => {
                    logical!(MIN_BLOCK_SIZE, MinBlockSize, Some(v), MIN_HEIGHT, MinHeight)
                }
                Property::MaxBlockSize(v) => {
                    logical!(MAX_BLOCK_SIZE, MaxBlockSize, Some(v), MAX_HEIGHT, MaxHeight)
                }
                Property::InlineSize(v) => logical!(INLINE_SIZE, InlineSize, Some(v), WIDTH, Width),
                Property::MinInlineSize(v) => {
                    logical!(MIN_INLINE_SIZE, MinInlineSize, Some(v), MIN_WIDTH, MinWidth)
                }
                Property::MaxInlineSize(v) => {
                    logical!(MAX_INLINE_SIZE, MaxInlineSize, Some(v), MAX_WIDTH, MaxWidth)
                }
                _ => unreachable!("only size properties are kept"),
            }
        }

        physical!(WIDTH, Width, self.width.take());
        physical!(MIN_WIDTH, MinWidth, self.min_width.take());
        physical!(MAX_WIDTH, MaxWidth, self.max_width.take());
        physical!(HEIGHT, Height, self.height.take());
        physical!(MIN_HEIGHT, MinHeight, self.min_height.take());
        physical!(MAX_HEIGHT, MaxHeight, self.max_height.take());
        logical!(
            BLOCK_SIZE,
            BlockSize,
            self.block_size.take(),
            HEIGHT,
            Height
        );
        logical!(
            MIN_BLOCK_SIZE,
            MinBlockSize,
            self.min_block_size.take(),
            MIN_HEIGHT,
            MinHeight
        );
        logical!(
            MAX_BLOCK_SIZE,
            MaxBlockSize,
            self.max_block_size.take(),
            MAX_HEIGHT,
            MaxHeight
        );
        logical!(
            INLINE_SIZE,
            InlineSize,
            self.inline_size.take(),
            WIDTH,
            Width
        );
        logical!(
            MIN_INLINE_SIZE,
            MinInlineSize,
            self.min_inline_size.take(),
            MIN_WIDTH,
            MinWidth
        );
        logical!(
            MAX_INLINE_SIZE,
            MaxInlineSize,
            self.max_inline_size.take(),
            MAX_WIDTH,
            MaxWidth
        );
    }

    pub(crate) fn finalize(
        &mut self,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) {
        self.flush(dest, context);
        self.flushed_properties = SizeProperty::empty();
    }
}
