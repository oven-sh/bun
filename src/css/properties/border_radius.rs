use crate as css;
use crate::Printer;
use crate::PrintErr;
use crate::css_values::length::LengthPercentage;
use crate::css_values::size::Size2D;
use crate::css_values::rect::Rect;
use crate::Property;
use crate::PropertyId;
use crate::VendorPrefix;
use crate::PropertyIdTag;
use crate::PropertyCategory;
use crate::DeclarationList;
use crate::PropertyHandlerContext;

/// A value for the [border-radius](https://www.w3.org/TR/css-backgrounds-3/#border-radius) property.
#[derive(Clone, PartialEq)]
pub struct BorderRadius {
    /// The x and y radius values for the top left corner.
    pub top_left: Size2D<LengthPercentage>,
    /// The x and y radius values for the top right corner.
    pub top_right: Size2D<LengthPercentage>,
    /// The x and y radius values for the bottom right corner.
    pub bottom_right: Size2D<LengthPercentage>,
    /// The x and y radius values for the bottom left corner.
    pub bottom_left: Size2D<LengthPercentage>,
}

impl BorderRadius {
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-radius", PropertyFieldMap);

    // TODO(port): PropertyFieldMap / VendorPrefixMap were Zig anonymous-struct decl literals
    // consumed by comptime DefineShorthand reflection. Represent as assoc consts for now;
    // Phase B should wire these into the shorthand trait/derive.
    pub const PROPERTY_FIELD_MAP: [(&'static str, &'static str); 4] = [
        ("top_left", "border-top-left-radius"),
        ("top_right", "border-top-right-radius"),
        ("bottom_right", "border-bottom-right-radius"),
        ("bottom_left", "border-bottom-left-radius"),
    ];

    pub const VENDOR_PREFIX_MAP: [(&'static str, bool); 4] = [
        ("top_left", true),
        ("top_right", true),
        ("bottom_right", true),
        ("bottom_left", true),
    ];

    pub fn parse(input: &mut css::Parser) -> css::Result<BorderRadius> {
        let widths = Rect::<LengthPercentage>::parse(input)?;
        let heights = if input.try_parse(|i| i.expect_delim('/')).is_ok() {
            // errdefer-style cleanup of `widths` is implicit via Drop on the `?` path.
            Rect::<LengthPercentage>::parse(input)?
        } else {
            widths.clone()
        };

        Ok(BorderRadius {
            top_left: Size2D { a: widths.top, b: heights.top },
            top_right: Size2D { a: widths.right, b: heights.right },
            bottom_right: Size2D { a: widths.bottom, b: heights.bottom },
            bottom_left: Size2D { a: widths.left, b: heights.left },
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let widths: Rect<&LengthPercentage> = Rect {
            top: &self.top_left.a,
            right: &self.top_right.a,
            bottom: &self.bottom_right.a,
            left: &self.bottom_left.a,
        };

        let heights: Rect<&LengthPercentage> = Rect {
            top: &self.top_left.b,
            right: &self.top_right.b,
            bottom: &self.bottom_right.b,
            left: &self.bottom_left.b,
        };

        widths.to_css(dest)?;

        if widths != heights {
            dest.delim('/', true)?;
            heights.to_css(dest)?;
        }
        Ok(())
    }

    // deepClone → #[derive(Clone)] (was css.implementDeepClone comptime field iteration)
    // eql       → #[derive(PartialEq)] (was css.implementEql comptime field iteration)
}

#[derive(Default)]
pub struct BorderRadiusHandler {
    pub top_left: Option<(Size2D<LengthPercentage>, VendorPrefix)>,
    pub top_right: Option<(Size2D<LengthPercentage>, VendorPrefix)>,
    pub bottom_right: Option<(Size2D<LengthPercentage>, VendorPrefix)>,
    pub bottom_left: Option<(Size2D<LengthPercentage>, VendorPrefix)>,
    pub start_start: Option<Property>,
    pub start_end: Option<Property>,
    pub end_end: Option<Property>,
    pub end_start: Option<Property>,
    // Zig: `= .physical`. derive(Default) is sound here because
    // PropertyCategory::default() == Physical (see src/css/logical.rs).
    pub category: PropertyCategory,
    pub has_any: bool,
}

// The Zig helpers take `comptime prop: []const u8` and use `@field` / `@unionInit` for
// token-level field/variant access. Rust has no field-by-name reflection, so these are
// macro_rules! that paste the field ident and the corresponding Property variant ident.

macro_rules! maybe_flush {
    ($self:expr, $d:expr, $ctx:expr, $prop:ident, $val:expr, $vp:expr) => {{
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if let Some(existing) = &$self.$prop {
            if existing.0 != *$val && !existing.1.contains($vp) {
                $self.flush($d, $ctx);
            }
        }

        if $self.$prop.is_some()
            && $ctx.targets.browsers.is_some()
            && !css::generic::is_compatible::<Size2D<LengthPercentage>>($val, $ctx.targets.browsers.unwrap())
        {
            $self.flush($d, $ctx);
        }
    }};
}

macro_rules! property_helper {
    ($self:expr, $d:expr, $ctx:expr, $prop:ident, $val:expr, $vp:expr) => {{
        if $self.category != PropertyCategory::Physical {
            $self.flush($d, $ctx);
        }

        maybe_flush!($self, $d, $ctx, $prop, $val, $vp);

        // Otherwise, update the value and add the prefix.
        if let Some(existing) = &mut $self.$prop {
            *existing = ($val.clone(), $vp);
        } else {
            $self.$prop = Some(($val.clone(), $vp));
            $self.has_any = true;
        }

        $self.category = PropertyCategory::Physical;
    }};
}

macro_rules! logical_property_helper {
    ($self:expr, $d:expr, $ctx:expr, $prop:ident, $val:expr) => {{
        if $self.category != PropertyCategory::Logical {
            $self.flush($d, $ctx);
        }

        $self.$prop = Some($val.clone());
        $self.category = PropertyCategory::Logical;
        $self.has_any = true;
    }};
}

macro_rules! single_property {
    ($d:expr, $ctx:expr, $variant:ident, $val:expr) => {{
        if let Some(v) = $val {
            if !v.1.is_empty() {
                let prefix = $ctx.targets.prefixes(v.1, css::prefixes::Feature::BorderRadius);
                $d.push(Property::$variant(v.0, prefix));
            }
        }
    }};
}

macro_rules! logical_property {
    ($d:expr, $ctx:expr, $val:expr, $ltr:ident, $rtl:ident, $logical_supported:expr) => {{
        if let Some(v) = $val {
            if $logical_supported {
                $d.push(v);
            } else {
                let prefix = $ctx
                    .targets
                    .prefixes(VendorPrefix::NONE, css::prefixes::Feature::BorderRadius);
                match v {
                    Property::BorderStartStartRadius(radius)
                    | Property::BorderStartEndRadius(radius)
                    | Property::BorderEndEndRadius(radius)
                    | Property::BorderEndStartRadius(radius) => {
                        $ctx.add_logical_rule(
                            Property::$ltr(radius.clone(), prefix),
                            Property::$rtl(radius, prefix),
                        );
                    }
                    Property::Unparsed(unparsed) => {
                        $ctx.add_logical_rule(
                            Property::Unparsed(unparsed.with_property_id(PropertyId::$ltr(prefix))),
                            Property::Unparsed(unparsed.with_property_id(PropertyId::$rtl(prefix))),
                        );
                    }
                    _ => {}
                }
            }
        }
    }};
}

impl BorderRadiusHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut DeclarationList,
        context: &mut PropertyHandlerContext,
    ) -> bool {
        match property {
            Property::BorderTopLeftRadius(val, vp) => property_helper!(self, dest, context, top_left, val, *vp),
            Property::BorderTopRightRadius(val, vp) => property_helper!(self, dest, context, top_right, val, *vp),
            Property::BorderBottomRightRadius(val, vp) => property_helper!(self, dest, context, bottom_right, val, *vp),
            Property::BorderBottomLeftRadius(val, vp) => property_helper!(self, dest, context, bottom_left, val, *vp),
            Property::BorderStartStartRadius(_) => logical_property_helper!(self, dest, context, start_start, property),
            Property::BorderStartEndRadius(_) => logical_property_helper!(self, dest, context, start_end, property),
            Property::BorderEndEndRadius(_) => logical_property_helper!(self, dest, context, end_end, property),
            Property::BorderEndStartRadius(_) => logical_property_helper!(self, dest, context, end_start, property),
            Property::BorderRadius(val, vp) => {
                self.start_start = None;
                self.start_end = None;
                self.end_end = None;
                self.end_start = None;

                maybe_flush!(self, dest, context, top_left, &val.top_left, *vp);
                maybe_flush!(self, dest, context, top_right, &val.top_right, *vp);
                maybe_flush!(self, dest, context, bottom_right, &val.bottom_right, *vp);
                maybe_flush!(self, dest, context, bottom_left, &val.bottom_left, *vp);

                property_helper!(self, dest, context, top_left, &val.top_left, *vp);
                property_helper!(self, dest, context, top_right, &val.top_right, *vp);
                property_helper!(self, dest, context, bottom_right, &val.bottom_right, *vp);
                property_helper!(self, dest, context, bottom_left, &val.bottom_left, *vp);
            }
            Property::Unparsed(unparsed) => {
                if is_border_radius_property(unparsed.property_id) {
                    // Even if we weren't able to parse the value (e.g. due to var() references),
                    // we can still add vendor prefixes to the property itself.
                    match unparsed.property_id {
                        PropertyIdTag::BorderStartStartRadius => {
                            logical_property_helper!(self, dest, context, start_start, property)
                        }
                        PropertyIdTag::BorderStartEndRadius => {
                            logical_property_helper!(self, dest, context, start_end, property)
                        }
                        PropertyIdTag::BorderEndEndRadius => {
                            logical_property_helper!(self, dest, context, end_end, property)
                        }
                        PropertyIdTag::BorderEndStartRadius => {
                            logical_property_helper!(self, dest, context, end_start, property)
                        }
                        _ => {
                            self.flush(dest, context);
                            dest.push(Property::Unparsed(
                                unparsed.get_prefixed(context.targets, css::prefixes::Feature::BorderRadius),
                            ));
                        }
                    }
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub fn finalize(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        self.flush(dest, context);
    }

    fn flush(&mut self, dest: &mut DeclarationList, context: &mut PropertyHandlerContext) {
        if !self.has_any {
            return;
        }

        self.has_any = false;

        let mut top_left = self.top_left.take();
        let mut top_right = self.top_right.take();
        let mut bottom_right = self.bottom_right.take();
        let mut bottom_left = self.bottom_left.take();
        let start_start = self.start_start.take();
        let start_end = self.start_end.take();
        let end_end = self.end_end.take();
        let end_start = self.end_start.take();

        if let (Some(tl), Some(tr), Some(br), Some(bl)) =
            (&mut top_left, &mut top_right, &mut bottom_right, &mut bottom_left)
        {
            let intersection = tl.1 & tr.1 & br.1 & bl.1;
            if !intersection.is_empty() {
                let prefix = context
                    .targets
                    .prefixes(intersection, css::prefixes::Feature::BorderRadius);
                dest.push(Property::BorderRadius(
                    BorderRadius {
                        top_left: tl.0.clone(),
                        top_right: tr.0.clone(),
                        bottom_right: br.0.clone(),
                        bottom_left: bl.0.clone(),
                    },
                    prefix,
                ));
                tl.1.remove(intersection);
                tr.1.remove(intersection);
                br.1.remove(intersection);
                bl.1.remove(intersection);
            }
        }

        let logical_supported = !context.should_compile_logical(css::compat::Feature::LogicalBorderRadius);

        single_property!(dest, context, BorderTopLeftRadius, top_left);
        single_property!(dest, context, BorderTopRightRadius, top_right);
        single_property!(dest, context, BorderBottomRightRadius, bottom_right);
        single_property!(dest, context, BorderBottomLeftRadius, bottom_left);

        logical_property!(dest, context, start_start, BorderTopLeftRadius, BorderTopRightRadius, logical_supported);
        logical_property!(dest, context, start_end, BorderTopRightRadius, BorderTopLeftRadius, logical_supported);
        logical_property!(dest, context, end_end, BorderBottomRightRadius, BorderBottomLeftRadius, logical_supported);
        logical_property!(dest, context, end_start, BorderBottomLeftRadius, BorderBottomRightRadius, logical_supported);
    }
}

pub fn is_border_radius_property(property_id: PropertyIdTag) -> bool {
    if is_logical_border_radius_property(property_id) {
        return true;
    }

    matches!(
        property_id,
        PropertyIdTag::BorderTopLeftRadius
            | PropertyIdTag::BorderTopRightRadius
            | PropertyIdTag::BorderBottomRightRadius
            | PropertyIdTag::BorderBottomLeftRadius
            | PropertyIdTag::BorderRadius
    )
}

pub fn is_logical_border_radius_property(property_id: PropertyIdTag) -> bool {
    matches!(
        property_id,
        PropertyIdTag::BorderStartStartRadius
            | PropertyIdTag::BorderStartEndRadius
            | PropertyIdTag::BorderEndEndRadius
            | PropertyIdTag::BorderEndStartRadius
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/border_radius.zig (321 lines)
//   confidence: medium
//   todos:      1
//   notes:      @field/@unionInit helpers ported as macro_rules!; Property variant naming (kebab→PascalCase) and tuple-vs-struct payload shape need Phase-B alignment with generated Property enum.
// ──────────────────────────────────────────────────────────────────────────
