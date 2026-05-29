use crate as css;
use crate::css_properties::custom::UnparsedProperty;
use crate::css_properties::{Property, PropertyIdTag};
use crate::generics::{DeepClone as _, IsCompatible as _};
use bun_alloc::ArenaVecExt as _;

/// *NOTE* The struct field names must match their corresponding variants in `Property`!
#[derive(Default)]
pub struct FallbackHandler {
    pub color: Option<usize>,
    pub text_shadow: Option<usize>,
}

impl FallbackHandler {
    pub(crate) fn handle_property(
        &mut self,
        property: &Property,
        dest: &mut css::DeclarationList,
        context: &mut css::PropertyHandlerContext,
    ) -> bool {
        let arena = dest.bump();

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
                        ($fb)(&mut val, arena, &context.targets, dest);
                    }

                    if $self_field.is_none()
                        || (context.targets.browsers.is_some()
                            && !($ic)(&val, &context.targets.browsers.unwrap()))
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

    pub(crate) fn finalize(
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
