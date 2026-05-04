use bun_css as css;
use bun_css::SmallList;
use bun_css::Printer;
use bun_css::PrintErr;
use bun_css::css_values::color::CssColor;
use bun_css::css_values::length::Length;
use bun_css::VendorPrefix;
use bun_css::Property;
use bun_css::prefixes::Feature;
use bun_css::ColorFallbackKind;
use bun_alloc::Arena; // bumpalo::Bump re-export (CSS is an AST crate)

/// A value for the [box-shadow](https://drafts.csswg.org/css-backgrounds/#box-shadow) property.
pub struct BoxShadow {
    /// The color of the box shadow.
    pub color: CssColor,
    /// The x offset of the shadow.
    pub x_offset: Length,
    /// The y offset of the shadow.
    pub y_offset: Length,
    /// The blur radius of the shadow.
    pub blur: Length,
    /// The spread distance of the shadow.
    pub spread: Length,
    /// Whether the shadow is inset within the box.
    pub inset: bool,
}

impl BoxShadow {
    pub fn parse(input: &mut css::Parser) -> css::Result<Self> {
        let mut color: Option<CssColor> = None;
        struct Lengths {
            x: Length,
            y: Length,
            blur: Length,
            spread: Length,
        }
        let mut lengths: Option<Lengths> = None;
        let mut inset = false;

        loop {
            if !inset {
                if input
                    .try_parse(|p| p.expect_ident_matching("inset"))
                    .is_ok()
                {
                    inset = true;
                    continue;
                }
            }

            if lengths.is_none() {
                let value = input.try_parse(|p: &mut css::Parser| -> css::Result<Lengths> {
                    let horizontal = match Length::parse(p) {
                        Ok(v) => v,
                        Err(e) => return Err(e),
                    };
                    let vertical = match Length::parse(p) {
                        Ok(v) => v,
                        Err(e) => return Err(e),
                    };
                    let blur = p.try_parse(Length::parse).ok().unwrap_or_else(Length::zero);
                    let spread = p.try_parse(Length::parse).ok().unwrap_or_else(Length::zero);
                    Ok(Lengths {
                        x: horizontal,
                        y: vertical,
                        blur,
                        spread,
                    })
                });

                if let Ok(v) = value {
                    lengths = Some(v);
                    continue;
                }
            }

            if color.is_none() {
                if let Some(c) = input.try_parse(CssColor::parse).ok() {
                    color = Some(c);
                    continue;
                }
            }

            break;
        }

        let final_lengths = match lengths {
            Some(l) => l,
            None => return Err(input.new_error(css::BasicParseErrorKind::QualifiedRuleInvalid)),
        };
        Ok(BoxShadow {
            color: color.unwrap_or(CssColor::CurrentColor),
            x_offset: final_lengths.x,
            y_offset: final_lengths.y,
            blur: final_lengths.blur,
            spread: final_lengths.spread,
            inset,
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.inset {
            dest.write_str("inset ")?;
        }

        self.x_offset.to_css(dest)?;
        dest.write_char(' ')?;
        self.y_offset.to_css(dest)?;

        if !self.blur.eql(&Length::zero()) || !self.spread.eql(&Length::zero()) {
            dest.write_char(' ')?;
            self.blur.to_css(dest)?;

            if !self.spread.eql(&Length::zero()) {
                dest.write_char(' ')?;
                self.spread.to_css(dest)?;
            }
        }

        if !self.color.eql(&CssColor::CurrentColor) {
            dest.write_char(' ')?;
            self.color.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field iteration — replace with derive in Phase B
        css::implement_deep_clone(self, allocator)
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        // TODO(port): css.implementEql uses @typeInfo field iteration — replace with derive in Phase B
        css::implement_eql(self, rhs)
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        self.color.is_compatible(browsers)
            && self.x_offset.is_compatible(browsers)
            && self.y_offset.is_compatible(browsers)
            && self.blur.is_compatible(browsers)
            && self.spread.is_compatible(browsers)
    }
}

#[derive(Default)]
pub struct BoxShadowHandler {
    pub box_shadows: Option<(SmallList<BoxShadow, 1>, VendorPrefix)>,
    pub flushed: bool,
}

impl BoxShadowHandler {
    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        match property {
            Property::BoxShadow(b) => {
                let box_shadows: &SmallList<BoxShadow, 1> = &b.0;
                let prefix: VendorPrefix = b.1;
                if self.box_shadows.is_some()
                    && context.targets.browsers.is_some()
                    && !box_shadows.is_compatible(context.targets.browsers.unwrap())
                {
                    self.flush(dest, context);
                }

                if let Some(bxs) = &mut self.box_shadows {
                    let val: &mut SmallList<BoxShadow, 1> = &mut bxs.0;
                    let prefixes: &mut VendorPrefix = &mut bxs.1;
                    if !val.eql(box_shadows) && !prefixes.contains(prefix) {
                        // PORT NOTE: reshaped for borrowck — drop borrow of self.box_shadows before flush
                        self.flush(dest, context);
                        self.box_shadows = Some((
                            box_shadows.deep_clone(context.allocator),
                            prefix,
                        ));
                    } else {
                        *val = box_shadows.deep_clone(context.allocator);
                        prefixes.insert(prefix);
                    }
                } else {
                    self.box_shadows = Some((
                        box_shadows.deep_clone(context.allocator),
                        prefix,
                    ));
                }
            }
            Property::Unparsed(unp) => {
                if unp.property_id == css::PropertyId::BoxShadow {
                    self.flush(dest, context);

                    let mut unparsed = unp.deep_clone(context.allocator);
                    context.add_unparsed_fallbacks(&mut unparsed);
                    dest.push(Property::Unparsed(unparsed));
                    self.flushed = true;
                } else {
                    return false;
                }
            }
            _ => return false,
        }

        true
    }

    pub fn finalize(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        self.flush(dest, context);
        self.flushed = false;
    }

    pub fn flush(
        &mut self,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) {
        if self.box_shadows.is_none() {
            return;
        }

        let Some((box_shadows, prefixes2)) = self.box_shadows.take() else {
            self.flushed = true;
            return;
        };

        if !self.flushed {
            let mut prefixes = context.targets.prefixes(prefixes2, Feature::BoxShadow);
            let mut fallbacks = ColorFallbackKind::empty();
            for shadow in box_shadows.slice() {
                fallbacks.insert(shadow.color.get_necessary_fallbacks(context.targets));
            }

            if fallbacks.contains(ColorFallbackKind::RGB) {
                let mut rgb: SmallList<BoxShadow, 1> =
                    SmallList::init_capacity(context.allocator, box_shadows.len());
                rgb.set_len(box_shadows.len());
                debug_assert_eq!(box_shadows.slice().len(), rgb.slice_mut().len());
                for (input, output) in box_shadows.slice().iter().zip(rgb.slice_mut().iter_mut()) {
                    output.color = input
                        .color
                        .to_rgb(context.allocator)
                        .unwrap_or_else(|| input.color.deep_clone(context.allocator));
                    // PORT NOTE: Zig used `inline for std.meta.fields(BoxShadow)` skipping `color`.
                    // Expanded explicitly — keep in sync with BoxShadow field list.
                    output.x_offset = css::generic::deep_clone(&input.x_offset, context.allocator);
                    output.y_offset = css::generic::deep_clone(&input.y_offset, context.allocator);
                    output.blur = css::generic::deep_clone(&input.blur, context.allocator);
                    output.spread = css::generic::deep_clone(&input.spread, context.allocator);
                    output.inset = input.inset;
                }

                dest.push(Property::BoxShadow((rgb, prefixes)));
                if prefixes.contains(VendorPrefix::NONE) {
                    prefixes = VendorPrefix::NONE;
                } else {
                    // Only output RGB for prefixed property (e.g. -webkit-box-shadow)
                    return;
                }
            }

            if fallbacks.contains(ColorFallbackKind::P3) {
                let mut p3: SmallList<BoxShadow, 1> =
                    SmallList::init_capacity(context.allocator, box_shadows.len());
                p3.set_len(box_shadows.len());
                debug_assert_eq!(box_shadows.slice().len(), p3.slice_mut().len());
                for (input, output) in box_shadows.slice().iter().zip(p3.slice_mut().iter_mut()) {
                    output.color = input
                        .color
                        .to_p3(context.allocator)
                        .unwrap_or_else(|| input.color.deep_clone(context.allocator));
                    // PORT NOTE: expanded `inline for std.meta.fields(BoxShadow)` skipping `color`.
                    output.x_offset = css::generic::deep_clone(&input.x_offset, context.allocator);
                    output.y_offset = css::generic::deep_clone(&input.y_offset, context.allocator);
                    output.blur = css::generic::deep_clone(&input.blur, context.allocator);
                    output.spread = css::generic::deep_clone(&input.spread, context.allocator);
                    output.inset = input.inset;
                }
                dest.push(Property::BoxShadow((p3, VendorPrefix::NONE)));
            }

            if fallbacks.contains(ColorFallbackKind::LAB) {
                let mut lab: SmallList<BoxShadow, 1> =
                    SmallList::init_capacity(context.allocator, box_shadows.len());
                lab.set_len(box_shadows.len());
                debug_assert_eq!(box_shadows.slice().len(), lab.slice_mut().len());
                for (input, output) in box_shadows.slice().iter().zip(lab.slice_mut().iter_mut()) {
                    output.color = input
                        .color
                        .to_lab(context.allocator)
                        .unwrap_or_else(|| input.color.deep_clone(context.allocator));
                    // PORT NOTE: expanded `inline for std.meta.fields(BoxShadow)` skipping `color`.
                    output.x_offset = css::generic::deep_clone(&input.x_offset, context.allocator);
                    output.y_offset = css::generic::deep_clone(&input.y_offset, context.allocator);
                    output.blur = css::generic::deep_clone(&input.blur, context.allocator);
                    output.spread = css::generic::deep_clone(&input.spread, context.allocator);
                    output.inset = input.inset;
                }
                dest.push(Property::BoxShadow((lab, VendorPrefix::NONE)));
            } else {
                dest.push(Property::BoxShadow((box_shadows, prefixes)));
            }
        } else {
            dest.push(Property::BoxShadow((box_shadows, prefixes2)));
        }

        self.flushed = true;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/box_shadow.zig (259 lines)
//   confidence: medium
//   todos:      2
//   notes:      implement_eql/implement_deep_clone need derive macros; std.meta.fields loops expanded by hand; borrowck reshape needed in handle_property (flush while holding &mut self.box_shadows)
// ──────────────────────────────────────────────────────────────────────────
