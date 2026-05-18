#![allow(dead_code, unused_imports, unused_macros)]
use crate as css;
use crate::VendorPrefix;
use crate::css_properties::custom::UnparsedProperty;
use crate::css_properties::{Property, PropertyIdTag};
use crate::generics::{DeepClone as _, IsCompatible as _};
use crate::prefixes::Feature;
use bun_alloc::ArenaVecExt as _;

/// *NOTE* The struct field names must match their corresponding variants in `Property`!
#[derive(Default)]
pub struct FallbackHandler {
    pub color: Option<usize>,
    pub text_shadow: Option<usize>,
    // TODO: add these back plz
    // filter: Option<usize>,
    // backdrop_filter: Option<usize>,
    // fill: Option<usize>,
    // stroke: Option<usize>,
    // caret_color: Option<usize>,
    // caret: Option<usize>,
}

impl FallbackHandler {
    // TODO(port): Zig computed this via @typeInfo(FallbackHandler).Struct.fields.len.
    #[allow(dead_code)]
    const FIELD_COUNT: usize = 2;

    pub fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        // The Zig source does `inline for (std.meta.fields(FallbackHandler))` and uses
        // `@field` / `@unionInit` keyed on the field name. Rust has no field reflection,
        // so we expand each (field, Property variant, has_vendor_prefix) pair via macro.
        // TODO(port): proc-macro — if the field list grows, generate these arms from a
        // single source of truth shared with `Property`/`PropertyIdTag`.

        let arena = dest.bump();

        // PORT NOTE: Zig's `inline for` over `std.meta.fields(FallbackHandler)` dispatched
        // each (field, Property variant) pair via a single generic body using `@field` /
        // `@unionInit` + `css.generic.{deepClone,isCompatible,hasGetFallbacks}`. Rust has
        // no field reflection and the generic-trait surface (`DeepClone`/`IsCompatible`/
        // `get_fallbacks` on `SmallList<TextShadow,1>`) is still partially gated, so we
        // expand each pair via a macro that takes per-type closures for those three ops.
        // This keeps the *control flow* identical while letting each payload type use its
        // own inherent methods until the trait lattice un-gates.
        macro_rules! handle_unprefixed {
            (
                $self_field:ident,
                $Variant:ident,
                deep_clone = $dc:expr,
                fallbacks  = $fb:expr,
                is_compat  = $ic:expr
            ) => {
                if let Property::$Variant(payload) = property {
                    let mut val = ($dc)(payload, arena);

                    if $self_field.is_none() {
                        // PORT NOTE: `has_fallbacks` only used in the vendor-prefixed branch in Zig.
                        ($fb)(&mut val, arena, context.targets, dest);
                    }

                    if $self_field.is_none()
                        || (context.targets.browsers.is_some()
                            && !($ic)(&val, context.targets.browsers.unwrap()))
                    {
                        *$self_field = Some(dest.len());
                        dest.push(Property::$Variant(val));
                    } else if let Some(index) = *$self_field {
                        dest[index] = Property::$Variant(val);
                    } else {
                        // val dropped — Rust Drop handles cleanup (Zig: val.deinit(context.arena))
                        drop(val);
                    }

                    return true;
                }
            };
        }

        // PORT NOTE: reshaped for borrowck — pre-borrow each self.<field> as &mut so the
        // macro body can both read and assign it without re-borrowing `self`.
        let this = &mut *self;
        let color = &mut this.color;
        let text_shadow = &mut this.text_shadow;

        // PropertyIdTag::Color has no vendor prefix.
        handle_unprefixed!(
            color,
            Color,
            deep_clone = |c: &css::css_values::color::CssColor, a| c.deep_clone(a),
            fallbacks = |v: &mut css::css_values::color::CssColor,
                         a: &bun_alloc::Arena,
                         t,
                         d: &mut css::DeclarationList| {
                let fbs = v.get_fallbacks(a, t);
                for fb in fbs.to_owned_slice().into_vec() {
                    d.push(Property::Color(fb));
                }
            },
            is_compat = |v: &css::css_values::color::CssColor, b| v.is_compatible(b)
        );
        // PropertyIdTag::TextShadow has no vendor prefix.
        handle_unprefixed!(
            text_shadow,
            TextShadow,
            deep_clone =
                |l: &css::SmallList<css::css_properties::text::TextShadow, 1>, a| l.deep_clone(a),
            fallbacks = |v: &mut css::SmallList<css::css_properties::text::TextShadow, 1>,
                         a: &bun_alloc::Arena,
                         t,
                         d: &mut css::DeclarationList| {
                for fb in css::small_list::get_fallbacks_text_shadow(v, a, t)
                    .to_owned_slice()
                    .into_vec()
                {
                    d.push(Property::TextShadow(fb));
                }
            },
            is_compat = |v: &css::SmallList<css::css_properties::text::TextShadow, 1>, b| v
                .is_compatible(b)
        );

        if let Property::Unparsed(val) = property {
            let val: &UnparsedProperty = val;
            let (mut unparsed, index): (UnparsedProperty, &mut Option<usize>) = 'unparsed_and_index: {
                macro_rules! match_unparsed_unprefixed {
                    ($self_field:ident, $Variant:ident) => {
                        if val.property_id.tag() == PropertyIdTag::$Variant {
                            let newval = val.deep_clone(arena);
                            break 'unparsed_and_index (newval, $self_field);
                        }
                    };
                }
                macro_rules! match_unparsed_prefixed {
                    ($self_field:ident, $Variant:ident, $FeatureVariant:ident) => {
                        if val.property_id.tag() == PropertyIdTag::$Variant {
                            // PORT NOTE: Zig accessed `@field(val.property_id, field.name)[1]`
                            // to get the VendorPrefix from the PropertyId payload. Mapped to
                            // the generated `PropertyId::prefix()` accessor.
                            let newval = if val.property_id.prefix().contains(VendorPrefix::NONE) {
                                val.get_prefixed(arena, context.targets, Feature::$FeatureVariant)
                            } else {
                                val.deep_clone(arena)
                            };
                            break 'unparsed_and_index (newval, $self_field);
                        }
                    };
                }

                match_unparsed_unprefixed!(color, Color);
                match_unparsed_unprefixed!(text_shadow, TextShadow);
                // (no prefixed properties active yet — `match_unparsed_prefixed!` kept for
                // when filter/backdrop_filter/etc. are re-enabled in this handler.)

                return false;
            };

            // TODO(port): re-enable once `PropertyHandlerContext::add_unparsed_fallbacks`
            // un-gates (blocked on `SupportsCondition::eql` in context.rs).

            context.add_unparsed_fallbacks(arena, &mut unparsed);
            let _ = &mut unparsed;
            if let Some(i) = *index {
                dest[i] = Property::Unparsed(unparsed);
            } else {
                *index = Some(dest.len());
                dest.push(Property::Unparsed(unparsed));
            }

            return true;
        }

        false
    }

    pub fn finalize(
        &mut self,
        _dest: &mut css::DeclarationList,
        _context: &mut css::PropertyHandlerContext,
    ) {
        // Zig: inline for (std.meta.fields(FallbackHandler)) |f| @field(this, f.name) = null;
        self.color = None;
        self.text_shadow = None;
    }
}

// ported from: src/css/properties/prefix_handler.zig
