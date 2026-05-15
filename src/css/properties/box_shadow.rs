#![allow(dead_code, unused_imports)]
use crate as css;
use crate::PrintErr;
use crate::Printer;
use crate::SmallList;
use crate::VendorPrefix;
use crate::css_properties::Property;
use crate::css_values::color::ColorFallbackKind;
use crate::css_values::color::CssColor;
use crate::css_values::length::Length;
use crate::generics::{CssEql, DeepClone, IsCompatible};
use crate::prefixes::Feature;
use bun_alloc::Arena;
use bun_alloc::ArenaVecExt as _; // bumpalo::Bump re-export (CSS is an AST crate)

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

// PORT NOTE: `SmallList::{deep_clone,eql,is_compatible}` are bounded on the
// `generics::{DeepClone,CssEql,IsCompatible}` traits. Wire BoxShadow into all
// three so the handler can use `SmallList<BoxShadow,1>` directly without
// hand-rolling per-field loops.
impl<'bump> css::generic::DeepClone<'bump> for BoxShadow {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        BoxShadow::deep_clone(self, bump)
    }
}
impl css::generic::CssEql for BoxShadow {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        BoxShadow::eql(self, other)
    }
}
impl css::generic::IsCompatible for BoxShadow {
    #[inline]
    fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        BoxShadow::is_compatible(self, browsers)
    }
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
                    .try_parse(|p| p.expect_ident_matching(b"inset"))
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
            None => return Err(input.new_error(css::BasicParseErrorKind::qualified_rule_invalid)),
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
        dest.write_char(b' ')?;
        self.y_offset.to_css(dest)?;

        // PORT NOTE: Zig `Length.eql` → Rust `PartialEq` (see values/length.rs).
        if self.blur != Length::zero() || self.spread != Length::zero() {
            dest.write_char(b' ')?;
            self.blur.to_css(dest)?;

            if self.spread != Length::zero() {
                dest.write_char(b' ')?;
                self.spread.to_css(dest)?;
            }
        }

        if !self.color.eql(&CssColor::CurrentColor) {
            dest.write_char(b' ')?;
            self.color.to_css(dest)?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, arena: &Arena) -> Self {
        // PORT NOTE: Zig css.implementDeepClone iterated @typeInfo fields. Expanded
        // explicitly here — keep in sync with the BoxShadow field list. `Length`
        // has no `DeepClone` trait impl yet but is `Clone` (Box<Calc> deep-clones).
        BoxShadow {
            color: self.color.deep_clone(arena),
            x_offset: self.x_offset.clone(),
            y_offset: self.y_offset.clone(),
            blur: self.blur.clone(),
            spread: self.spread.clone(),
            inset: self.inset,
        }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        // PORT NOTE: Zig css.implementEql iterated @typeInfo fields. Expanded
        // explicitly. `Length` Zig `eql` → Rust `PartialEq` (values/length.rs).
        self.color.eql(&rhs.color)
            && self.x_offset == rhs.x_offset
            && self.y_offset == rhs.y_offset
            && self.blur == rhs.blur
            && self.spread == rhs.spread
            && self.inset == rhs.inset
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
        let arena = dest.bump();
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

                // PORT NOTE: reshaped for borrowck — Zig held simultaneous &mut into
                // self.box_shadows across self.flush(). Compute the predicate first,
                // then either flush+replace or update in place.
                let needs_flush = if let Some(bxs) = &self.box_shadows {
                    !SmallList::eql(&bxs.0, box_shadows) && !bxs.1.contains(prefix)
                } else {
                    false
                };
                if let Some(bxs) = &mut self.box_shadows {
                    if needs_flush {
                        self.flush(dest, context);
                        self.box_shadows = Some((box_shadows.deep_clone(arena), prefix));
                    } else {
                        bxs.0 = box_shadows.deep_clone(arena);
                        bxs.1.insert(prefix);
                    }
                } else {
                    self.box_shadows = Some((box_shadows.deep_clone(arena), prefix));
                }
            }
            Property::Unparsed(unp) => {
                if unp.property_id.tag() == css::css_properties::PropertyIdTag::BoxShadow {
                    self.flush(dest, context);

                    let mut unparsed = unp.deep_clone(arena);
                    // TODO(port): re-enable once `PropertyHandlerContext::add_unparsed_fallbacks`
                    // un-gates (blocked on `SupportsCondition::eql` in context.rs).

                    context.add_unparsed_fallbacks(arena, &mut unparsed);
                    let _ = &mut unparsed;
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
        let arena = dest.bump();

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

            // PORT NOTE: Zig used `initCapacity(len)` + `setLen(len)` + per-index field
            // writes via `inline for std.meta.fields(BoxShadow)` skipping `color`. That
            // pattern would observe partially-uninit `BoxShadow` values in Rust, so we
            // build each fully-formed `BoxShadow` and `append`. Behavior is identical.
            macro_rules! build_color_fallback {
                ($conv:ident) => {{
                    let mut out: SmallList<BoxShadow, 1> =
                        SmallList::init_capacity(box_shadows.len());
                    for input in box_shadows.slice().iter() {
                        out.append(BoxShadow {
                            color: input
                                .color
                                .$conv()
                                .unwrap_or_else(|| input.color.deep_clone(arena)),
                            x_offset: input.x_offset.clone(),
                            y_offset: input.y_offset.clone(),
                            blur: input.blur.clone(),
                            spread: input.spread.clone(),
                            inset: input.inset,
                        });
                    }
                    out
                }};
            }

            if fallbacks.contains(ColorFallbackKind::RGB) {
                let rgb = build_color_fallback!(to_rgb);
                dest.push(Property::BoxShadow((rgb, prefixes)));
                if prefixes.contains(VendorPrefix::NONE) {
                    prefixes = VendorPrefix::NONE;
                } else {
                    // Only output RGB for prefixed property (e.g. -webkit-box-shadow)
                    return;
                }
            }

            if fallbacks.contains(ColorFallbackKind::P3) {
                let p3 = build_color_fallback!(to_p3);
                dest.push(Property::BoxShadow((p3, VendorPrefix::NONE)));
            }

            if fallbacks.contains(ColorFallbackKind::LAB) {
                let lab = build_color_fallback!(to_lab);
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

// ported from: src/css/properties/box_shadow.zig
