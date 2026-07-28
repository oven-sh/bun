use crate::css_parser as css;

use css::css_rules::media::MediaRule;

use css::css_properties::custom::UnparsedProperty;
use css::media_query::{MediaCondition, MediaFeature, MediaFeatureId, MediaList, MediaQuery};

use bun_alloc::{Arena as Bump, ArenaPtr};
use bun_collections::ArrayHashMap;

pub struct SupportsEntry {
    pub(crate) condition: css::SupportsCondition,
    pub(crate) declarations: Vec<css::Property>,
    pub(crate) important_declarations: Vec<css::Property>,
}

// No explicit deinit — all fields own their storage and drop automatically.

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DeclarationContext {
    None,
    StyleRule,
    Keyframes,
    StyleAttribute,
}

pub struct PropertyHandlerContext<'a> {
    // `arena` is the parser arena that owns the AST being
    // minified; bound to `'a` alongside the other borrowed inputs.
    pub(crate) arena: &'a Bump,
    pub(crate) targets: css::targets::Targets,
    pub(crate) is_important: bool,
    pub(crate) supports: Vec<SupportsEntry>,
    pub(crate) ltr: Vec<css::Property>,
    pub(crate) rtl: Vec<css::Property>,
    pub(crate) dark: Vec<css::Property>,
    pub(crate) context: DeclarationContext,
    pub(crate) unused_symbols: &'a ArrayHashMap<Box<[u8]>, ()>,
}

impl<'a> PropertyHandlerContext<'a> {
    pub(crate) fn new(
        arena: &'a Bump,
        targets: &css::targets::Targets,
        unused_symbols: &'a ArrayHashMap<Box<[u8]>, ()>,
    ) -> PropertyHandlerContext<'a> {
        PropertyHandlerContext {
            arena,
            targets: *targets,
            is_important: false,
            supports: Vec::new(),
            ltr: Vec::new(),
            rtl: Vec::new(),
            dark: Vec::new(),
            context: DeclarationContext::None,
            unused_symbols,
        }
    }

    pub(crate) fn child(&self, context: DeclarationContext) -> PropertyHandlerContext<'a> {
        PropertyHandlerContext {
            arena: self.arena,
            targets: self.targets,
            is_important: false,
            supports: Vec::new(),
            ltr: Vec::new(),
            rtl: Vec::new(),
            dark: Vec::new(),
            context,
            unused_symbols: self.unused_symbols,
        }
    }

    pub(crate) fn add_dark_rule(&mut self, property: css::Property) {
        self.dark.push(property);
    }

    pub(crate) fn add_logical_rule(&mut self, ltr: css::Property, rtl: css::Property) {
        self.ltr.push(ltr);
        self.rtl.push(rtl);
    }

    pub(crate) fn should_compile_logical(&self, feature: css::compat::Feature) -> bool {
        // Don't convert logical properties in style attributes because
        // our fallbacks rely on extra rules to define --ltr and --rtl.
        if self.context == DeclarationContext::StyleAttribute {
            return false;
        }

        self.targets.should_compile_logical(feature)
    }
}

// ─── heavy rule-building helpers ──────────────────────────────────────────

impl<'a> PropertyHandlerContext<'a> {
    /// `'static`-erased arena handle for building `DeclarationBlock<'static>` /
    /// `DeclarationList<'static>` (see rules/mod.rs `decl_block_static`).
    ///
    /// SAFETY: `StyleRule.declarations: DeclarationBlock<'static>` is a
    /// crate-wide `'bump`-erasure placeholder until `CssRule<'bump, R>`
    /// re-threads the arena lifetime. The arena outlives every rule built
    /// from it; centralized here so call-sites below don't open-code the
    /// lifetime erasure.
    #[inline]
    fn bump_static(&self) -> &'static Bump {
        // SAFETY: the arena outlives every rule built from it; `'static` is the
        // crate-wide `'bump`-erasure placeholder documented on this fn.
        unsafe { bun_collections::detach_ref(self.arena) }
    }

    /// Clone a std-Vec property list into a bump-allocated `DeclarationList`.
    /// (`'static` per crate-wide `'bump`-erasure; see rules/mod.rs decl_block_static.)
    #[inline]
    fn clone_decls(&self, list: &[css::Property]) -> css::DeclarationList<'static> {
        let bump: &'static Bump = self.bump_static();
        bun_alloc::vec_from_iter_in(list.iter().map(|p| p.deep_clone(bump)), bump)
    }

    pub(crate) fn get_supports_rules<T>(&self, style_rule: &css::StyleRule<T>) -> Vec<css::CssRule<T>> {
        if self.supports.is_empty() {
            return Vec::new();
        }

        let mut dest: Vec<css::CssRule<T>> = Vec::with_capacity(self.supports.len());

        for entry in &self.supports {
            dest.push(css::CssRule::Supports(css::SupportsRule {
                condition: entry.condition.deep_clone(self.arena),
                rules: css::CssRuleList {
                    v: vec![css::CssRule::Style(css::StyleRule {
                        selectors: style_rule.selectors.deep_clone(),
                        vendor_prefix: css::VendorPrefix::NONE,
                        declarations: css::DeclarationBlock {
                            declarations: self.clone_decls(&entry.declarations),
                            important_declarations: self.clone_decls(&entry.important_declarations),
                        },
                        rules: css::CssRuleList::default(),
                        loc: style_rule.loc,
                    })],
                },
                loc: style_rule.loc,
            }));
        }

        dest
    }

    pub(crate) fn get_additional_rules<T>(&self, style_rule: &css::StyleRule<T>) -> Vec<css::CssRule<T>> {
        // TODO: :dir/:lang raises the specificity of the selector. Use :where to lower it?
        let mut dest: Vec<css::CssRule<T>> = Vec::new();

        if !self.ltr.is_empty() {
            self.get_additional_rules_helper(
                css::selector::parser::Direction::Ltr,
                &self.ltr,
                style_rule,
                &mut dest,
            );
        }

        if !self.rtl.is_empty() {
            self.get_additional_rules_helper(
                css::selector::parser::Direction::Rtl,
                &self.rtl,
                style_rule,
                &mut dest,
            );
        }

        if !self.dark.is_empty() {
            dest.push(css::CssRule::Media(MediaRule {
                query: MediaList {
                    media_queries: {
                        // Arena-backed to match `MediaList.media_queries: Vec<_, ArenaPtr>`.
                        let mut list: Vec<MediaQuery, ArenaPtr> =
                            Vec::with_capacity_in(1, ArenaPtr::new(self.bump_static()));

                        list.push(MediaQuery {
                            qualifier: None,
                            media_type: css::media_query::MediaType::All,
                            condition: Some(MediaCondition::Feature(Box::new_in(
                                MediaFeature::Plain {
                                    name: css::media_query::MediaFeatureName::Standard(
                                        MediaFeatureId::PrefersColorScheme,
                                    ),
                                    value: css::media_query::MediaFeatureValue::Ident(css::Ident {
                                        v: b"dark",
                                    }),
                                },
                                ArenaPtr::new(self.bump_static()),
                            ))),
                        });

                        list
                    },
                },
                rules: {
                    let mut list: css::CssRuleList<T> = css::CssRuleList::default();

                    list.v.push(css::CssRule::Style(css::StyleRule {
                        selectors: style_rule.selectors.deep_clone(),
                        vendor_prefix: css::VendorPrefix::NONE,
                        declarations: css::DeclarationBlock {
                            declarations: self.clone_decls(&self.dark),
                            important_declarations: css::DeclarationList::new_in(
                                self.bump_static(),
                            ),
                        },
                        rules: css::CssRuleList::default(),
                        loc: style_rule.loc,
                    }));

                    list
                },
                loc: style_rule.loc,
            }));
        }

        dest
    }

    // Takes the Direction value and a borrow of the decls Vec directly.
    pub(crate) fn get_additional_rules_helper<T>(
        &self,
        dir: css::selector::parser::Direction,
        decls: &[css::Property],
        sty: &css::StyleRule<T>,
        dest: &mut Vec<css::CssRule<T>>,
    ) {
        let mut selectors = sty.selectors.deep_clone();
        for selector in selectors.v.slice_mut() {
            selector.append(css::Component::NonTsPseudoClass(css::PseudoClass::Dir {
                direction: dir,
            }));
        }

        let rule = css::StyleRule {
            selectors,
            vendor_prefix: css::VendorPrefix::NONE,
            declarations: css::DeclarationBlock {
                declarations: self.clone_decls(decls),
                important_declarations: css::DeclarationList::new_in(self.bump_static()),
            },
            rules: css::CssRuleList::default(),
            loc: sty.loc,
        };

        dest.push(css::CssRule::Style(rule));
    }
}

impl<'a> PropertyHandlerContext<'a> {
    pub(crate) fn reset(&mut self) {
        // Per-element `deinit()` calls dropped — Vec::clear drops each element,
        // and SupportsEntry / Property own their resources via Drop.
        self.supports.clear();
        self.ltr.clear();
        self.rtl.clear();
        self.dark.clear();
    }
}

impl<'a> PropertyHandlerContext<'a> {
    pub(crate) fn add_conditional_property(
        &mut self,
        condition: css::SupportsCondition,
        property: css::Property,
    ) {
        if self.context != DeclarationContext::StyleRule {
            return;
        }

        let found = 'brk: {
            for supp in self.supports.iter_mut() {
                if condition.eql(&supp.condition) {
                    break 'brk Some(supp);
                }
            }
            break 'brk None;
        };

        if let Some(entry) = found {
            if self.is_important {
                entry.important_declarations.push(property);
            } else {
                entry.declarations.push(property);
            }
        } else {
            let mut important_declarations: Vec<css::Property> = Vec::new();
            let mut declarations: Vec<css::Property> = Vec::new();
            if self.is_important {
                important_declarations.push(property);
            } else {
                declarations.push(property);
            }
            self.supports.push(SupportsEntry {
                condition,
                declarations,
                important_declarations,
            });
        }
    }

    pub(crate) fn add_unparsed_fallbacks(
        &mut self,
        bump: &bun_alloc::Arena,
        unparsed: &mut UnparsedProperty,
    ) {
        if self.context != DeclarationContext::StyleRule
            && self.context != DeclarationContext::StyleAttribute
        {
            return;
        }

        let fallbacks = unparsed.value.get_fallbacks(bump, &self.targets);
        // `SmallList`
        // has no `IntoIterator`, so spill to a Vec to preserve P3-before-LAB order.
        for condition_and_fallback in fallbacks.to_owned_slice().into_vec() {
            self.add_conditional_property(
                condition_and_fallback.0,
                css::Property::Unparsed(UnparsedProperty {
                    // `PropertyId` is `Copy`.
                    property_id: unparsed.property_id,
                    value: condition_and_fallback.1,
                }),
            );
        }
    }
}
