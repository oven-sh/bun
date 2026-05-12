use crate as css;
use crate::DeclarationList;
use crate::PrintErr;
use crate::Printer;
use crate::PropertyCategory;
use crate::PropertyHandlerContext;
use crate::VendorPrefix;
use crate::css_properties::{Property, PropertyId, PropertyIdTag};
use crate::css_values::length::LengthPercentage;
use crate::css_values::rect::Rect;
use crate::css_values::size::Size2D;
use bun_alloc::ArenaVecExt as _;

/// A value for the [border-radius](https://www.w3.org/TR/css-backgrounds-3/#border-radius) property.
// PORT NOTE: `Size2D<T>` carries no `Clone`/`PartialEq` derives (it exposes
// inherent `deep_clone`/`eql` instead, matching the Zig protocol surface), so
// `BorderRadius` can't `#[derive]` them either. The handler below uses
// `Size2D::deep_clone`/`Size2D::eql` directly.
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
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        BorderRadius {
            top_left: self.top_left.deep_clone(bump),
            top_right: self.top_right.deep_clone(bump),
            bottom_right: self.bottom_right.deep_clone(bump),
            bottom_left: self.bottom_left.deep_clone(bump),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        Size2D::eql(&self.top_left, &other.top_left)
            && Size2D::eql(&self.top_right, &other.top_right)
            && Size2D::eql(&self.bottom_right, &other.bottom_right)
            && Size2D::eql(&self.bottom_left, &other.bottom_left)
    }

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
        let widths = Rect::<LengthPercentage>::parse_with(input, LengthPercentage::parse)?;
        let heights = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
            // errdefer-style cleanup of `widths` is implicit via Drop on the `?` path.
            Rect::<LengthPercentage>::parse_with(input, LengthPercentage::parse)?
        } else {
            // PORT NOTE: Zig `widths.deepClone(arena)` — `LengthPercentage` is
            // `Clone`-via-derive (no arena indirection), so per-field `.clone()` is exact.
            Rect {
                top: widths.top.clone(),
                right: widths.right.clone(),
                bottom: widths.bottom.clone(),
                left: widths.left.clone(),
            }
        };

        Ok(BorderRadius {
            top_left: Size2D {
                a: widths.top,
                b: heights.top,
            },
            top_right: Size2D {
                a: widths.right,
                b: heights.right,
            },
            bottom_right: Size2D {
                a: widths.bottom,
                b: heights.bottom,
            },
            bottom_left: Size2D {
                a: widths.left,
                b: heights.left,
            },
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // PORT NOTE: Zig built `Rect(*const LengthPercentage)` and reused
        // `Rect.toCss`. `Rect::<&T>::to_css` would need `&T: ToCss + PartialEq`;
        // inline the 4-side serialization to avoid that bound (logic is identical
        // to `values::rect::Rect::to_css`).
        #[inline]
        fn write_rect(
            top: &LengthPercentage,
            right: &LengthPercentage,
            bottom: &LengthPercentage,
            left: &LengthPercentage,
            dest: &mut Printer,
        ) -> Result<(), PrintErr> {
            top.to_css(dest)?;
            let same_vertical = top == bottom;
            let same_horizontal = right == left;
            if same_vertical && same_horizontal && top == right {
                return Ok(());
            }
            dest.write_str(b" ")?;
            right.to_css(dest)?;
            if same_vertical && same_horizontal {
                return Ok(());
            }
            dest.write_str(b" ")?;
            bottom.to_css(dest)?;
            if same_horizontal {
                return Ok(());
            }
            dest.write_str(b" ")?;
            left.to_css(dest)
        }

        let (wt, wr, wb, wl) = (
            &self.top_left.a,
            &self.top_right.a,
            &self.bottom_right.a,
            &self.bottom_left.a,
        );
        let (ht, hr, hb, hl) = (
            &self.top_left.b,
            &self.top_right.b,
            &self.bottom_right.b,
            &self.bottom_left.b,
        );

        write_rect(wt, wr, wb, wl, dest)?;

        if !(wt == ht && wr == hr && wb == hb && wl == hl) {
            dest.delim(b'/', true)?;
            write_rect(ht, hr, hb, hl, dest)?;
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

// PORT NOTE: `Size2D::is_compatible` is bounded on `T: values::protocol::IsCompatible`,
// which `LengthPercentage` (= `DimensionPercentage<LengthValue>`) does not yet impl.
// Hand-roll the per-component check via `LengthPercentage::is_compatible` (inherent
// method) until that protocol impl lands.
#[inline]
fn size2d_lp_is_compatible(
    val: &Size2D<LengthPercentage>,
    browsers: css::targets::Browsers,
) -> bool {
    val.a.is_compatible(browsers) && val.b.is_compatible(browsers)
}

macro_rules! maybe_flush {
    ($self:expr, $d:expr, $ctx:expr, $prop:ident, $val:expr, $vp:expr) => {{
        // If two vendor prefixes for the same property have different
        // values, we need to flush what we have immediately to preserve order.
        if let Some(existing) = &$self.$prop {
            if !Size2D::eql(&existing.0, $val) && !existing.1.contains($vp) {
                $self.flush($d, $ctx);
            }
        }

        if $self.$prop.is_some()
            && $ctx.targets.browsers.is_some()
            && !size2d_lp_is_compatible($val, $ctx.targets.browsers.unwrap())
        {
            $self.flush($d, $ctx);
        }
    }};
}

macro_rules! property_helper {
    ($self:expr, $d:expr, $ctx:expr, $bump:expr, $prop:ident, $val:expr, $vp:expr) => {{
        if $self.category != PropertyCategory::Physical {
            $self.flush($d, $ctx);
        }

        maybe_flush!($self, $d, $ctx, $prop, $val, $vp);

        // Otherwise, update the value and add the prefix.
        if let Some(existing) = &mut $self.$prop {
            *existing = ($val.deep_clone($bump), $vp);
        } else {
            $self.$prop = Some(($val.deep_clone($bump), $vp));
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

        // PORT NOTE: Zig stored `property.deepClone(arena)`. `Property` itself
        // has no blanket `Clone`; callers pass an already-deep_clone'd `Property`.
        $self.$prop = Some($val);
        $self.category = PropertyCategory::Logical;
        $self.has_any = true;
    }};
}

macro_rules! single_property {
    ($d:expr, $ctx:expr, $variant:ident, $val:expr) => {{
        if let Some(v) = $val {
            if !v.1.is_empty() {
                let prefix = $ctx
                    .targets
                    .prefixes(v.1, css::prefixes::Feature::BorderRadius);
                $d.push(Property::$variant((v.0, prefix)));
            }
        }
    }};
}

macro_rules! logical_property {
    ($d:expr, $ctx:expr, $bump:expr, $val:expr, $ltr:ident, $rtl:ident, $logical_supported:expr) => {{
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
                            Property::$ltr((radius.deep_clone($bump), prefix)),
                            Property::$rtl((radius, prefix)),
                        );
                    }
                    Property::Unparsed(unparsed) => {
                        $ctx.add_logical_rule(
                            Property::Unparsed(
                                unparsed.with_property_id($bump, PropertyId::$ltr(prefix)),
                            ),
                            Property::Unparsed(
                                unparsed.with_property_id($bump, PropertyId::$rtl(prefix)),
                            ),
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
        let bump = dest.bump();
        // PORT NOTE: `Property::deep_clone` is still gated; reconstruct the
        // matched variant directly (Size2D<LP> deep-clones via inherent method).
        match property {
            Property::BorderTopLeftRadius((val, vp)) => {
                property_helper!(self, dest, context, bump, top_left, val, *vp)
            }
            Property::BorderTopRightRadius((val, vp)) => {
                property_helper!(self, dest, context, bump, top_right, val, *vp)
            }
            Property::BorderBottomRightRadius((val, vp)) => {
                property_helper!(self, dest, context, bump, bottom_right, val, *vp)
            }
            Property::BorderBottomLeftRadius((val, vp)) => {
                property_helper!(self, dest, context, bump, bottom_left, val, *vp)
            }
            Property::BorderStartStartRadius(r) => {
                logical_property_helper!(
                    self,
                    dest,
                    context,
                    start_start,
                    Property::BorderStartStartRadius(r.deep_clone(bump))
                )
            }
            Property::BorderStartEndRadius(r) => {
                logical_property_helper!(
                    self,
                    dest,
                    context,
                    start_end,
                    Property::BorderStartEndRadius(r.deep_clone(bump))
                )
            }
            Property::BorderEndEndRadius(r) => {
                logical_property_helper!(
                    self,
                    dest,
                    context,
                    end_end,
                    Property::BorderEndEndRadius(r.deep_clone(bump))
                )
            }
            Property::BorderEndStartRadius(r) => {
                logical_property_helper!(
                    self,
                    dest,
                    context,
                    end_start,
                    Property::BorderEndStartRadius(r.deep_clone(bump))
                )
            }
            Property::BorderRadius((val, vp)) => {
                self.start_start = None;
                self.start_end = None;
                self.end_end = None;
                self.end_start = None;

                maybe_flush!(self, dest, context, top_left, &val.top_left, *vp);
                maybe_flush!(self, dest, context, top_right, &val.top_right, *vp);
                maybe_flush!(self, dest, context, bottom_right, &val.bottom_right, *vp);
                maybe_flush!(self, dest, context, bottom_left, &val.bottom_left, *vp);

                property_helper!(self, dest, context, bump, top_left, &val.top_left, *vp);
                property_helper!(self, dest, context, bump, top_right, &val.top_right, *vp);
                property_helper!(
                    self,
                    dest,
                    context,
                    bump,
                    bottom_right,
                    &val.bottom_right,
                    *vp
                );
                property_helper!(
                    self,
                    dest,
                    context,
                    bump,
                    bottom_left,
                    &val.bottom_left,
                    *vp
                );
            }
            Property::Unparsed(unparsed) => {
                if is_border_radius_property(unparsed.property_id.tag()) {
                    // Even if we weren't able to parse the value (e.g. due to var() references),
                    // we can still add vendor prefixes to the property itself.
                    match unparsed.property_id.tag() {
                        PropertyIdTag::BorderStartStartRadius => {
                            logical_property_helper!(
                                self,
                                dest,
                                context,
                                start_start,
                                Property::Unparsed(unparsed.deep_clone(bump))
                            )
                        }
                        PropertyIdTag::BorderStartEndRadius => {
                            logical_property_helper!(
                                self,
                                dest,
                                context,
                                start_end,
                                Property::Unparsed(unparsed.deep_clone(bump))
                            )
                        }
                        PropertyIdTag::BorderEndEndRadius => {
                            logical_property_helper!(
                                self,
                                dest,
                                context,
                                end_end,
                                Property::Unparsed(unparsed.deep_clone(bump))
                            )
                        }
                        PropertyIdTag::BorderEndStartRadius => {
                            logical_property_helper!(
                                self,
                                dest,
                                context,
                                end_start,
                                Property::Unparsed(unparsed.deep_clone(bump))
                            )
                        }
                        _ => {
                            self.flush(dest, context);
                            dest.push(Property::Unparsed(unparsed.get_prefixed(
                                bump,
                                context.targets,
                                css::prefixes::Feature::BorderRadius,
                            )));
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

        if let (Some(tl), Some(tr), Some(br), Some(bl)) = (
            &mut top_left,
            &mut top_right,
            &mut bottom_right,
            &mut bottom_left,
        ) {
            let intersection = tl.1 & tr.1 & br.1 & bl.1;
            if !intersection.is_empty() {
                let prefix = context
                    .targets
                    .prefixes(intersection, css::prefixes::Feature::BorderRadius);
                let bump = dest.bump();
                dest.push(Property::BorderRadius((
                    BorderRadius {
                        top_left: tl.0.deep_clone(bump),
                        top_right: tr.0.deep_clone(bump),
                        bottom_right: br.0.deep_clone(bump),
                        bottom_left: bl.0.deep_clone(bump),
                    },
                    prefix,
                )));
                tl.1.remove(intersection);
                tr.1.remove(intersection);
                br.1.remove(intersection);
                bl.1.remove(intersection);
            }
        }

        let logical_supported =
            !context.should_compile_logical(css::compat::Feature::LogicalBorderRadius);
        let bump = dest.bump();

        single_property!(dest, context, BorderTopLeftRadius, top_left);
        single_property!(dest, context, BorderTopRightRadius, top_right);
        single_property!(dest, context, BorderBottomRightRadius, bottom_right);
        single_property!(dest, context, BorderBottomLeftRadius, bottom_left);

        logical_property!(
            dest,
            context,
            bump,
            start_start,
            BorderTopLeftRadius,
            BorderTopRightRadius,
            logical_supported
        );
        logical_property!(
            dest,
            context,
            bump,
            start_end,
            BorderTopRightRadius,
            BorderTopLeftRadius,
            logical_supported
        );
        logical_property!(
            dest,
            context,
            bump,
            end_end,
            BorderBottomRightRadius,
            BorderBottomLeftRadius,
            logical_supported
        );
        logical_property!(
            dest,
            context,
            bump,
            end_start,
            BorderBottomLeftRadius,
            BorderBottomRightRadius,
            logical_supported
        );
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

// ported from: src/css/properties/border_radius.zig
