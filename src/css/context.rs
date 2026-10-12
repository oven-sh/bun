use crate::css_parser as css;

use css::css_rules::media::MediaRule;

use css::css_properties::background::is_background_property;
use css::css_properties::border::is_border_property;
use css::css_properties::border_image::is_border_image_property;
use css::css_properties::custom::{CustomPropertyName, Fallbacks, UnparsedProperty};
use css::css_properties::{PropertyId, PropertyIdTag};
use css::media_query::{MediaCondition, MediaFeature, MediaFeatureId, MediaList, MediaQuery};

use bun_alloc::{Arena as Bump, ArenaPtr};
use bun_collections::ArrayHashMap;
use bun_core::strings;

/// A fallback declaration staged for an `@supports` rule.
struct StagedCopy {
    property: css::Property,
    /// Address of the declaration in the block's source list that staged this. Compared, never read through.
    source: usize,
    /// Index in the handler's output list from which later output lands behind the base declaration.
    later_from: usize,
}

impl StagedCopy {
    fn property_id(&self) -> PropertyId {
        self.property.property_id()
    }

    /// The index in `source` of the declaration that staged this.
    fn source_index(&self, source: &[css::Property]) -> usize {
        self.source.wrapping_sub(source.as_ptr().addr()) / core::mem::size_of::<css::Property>()
    }
}

/// The copies one `@supports` rule holds for one importance, in source order.
#[derive(Default)]
pub(crate) struct StagedList {
    copies: Vec<StagedCopy>,
    /// How many of `copies` each property id has, so that a retract scans back no further than its earliest one.
    counts: Vec<(PropertyId, usize)>,
}

impl StagedList {
    fn push(&mut self, copy: StagedCopy) {
        let id = copy.property_id();
        match self.counts.iter_mut().find(|(counted, _)| *counted == id) {
            Some((_, count)) => *count += 1,
            None => self.counts.push((id, 1)),
        }
        self.copies.push(copy);
    }

    fn holds(&self, id: PropertyId) -> bool {
        self.counts.iter().any(|(counted, _)| *counted == id)
    }

    fn holds_family(&self, family: PropertyIdTag) -> bool {
        self.counts
            .iter()
            .any(|(counted, _)| family_of(*counted) == family)
    }

    fn retract(&mut self, id: PropertyId) {
        let Some(counted) = self.counts.iter().position(|(counted, _)| *counted == id) else {
            return;
        };
        let (_, mut left) = self.counts.swap_remove(counted);
        let mut first = self.copies.len();
        while left > 0 {
            first -= 1;
            if self.copies[first].property_id() == id {
                left -= 1;
            }
        }
        let mut kept = first;
        for at in first..self.copies.len() {
            if self.copies[at].property_id() != id {
                self.copies.swap(kept, at);
                kept += 1;
            }
        }
        self.copies.truncate(kept);
    }

    /// Moves out the copies that belong with the output at and behind index `cut`.
    fn split_off(&mut self, cut: usize) -> StagedList {
        let at = self.copies.partition_point(|copy| copy.later_from <= cut);
        let mut behind = StagedList::default();
        for copy in self.copies.drain(at..) {
            let id = copy.property_id();
            self.counts.retain_mut(|(counted, count)| {
                if *counted == id {
                    *count -= 1;
                }
                *count > 0
            });
            behind.push(copy);
        }
        behind
    }
}

pub struct SupportsEntry {
    pub(crate) condition: css::SupportsCondition,
    pub(crate) declarations: StagedList,
    pub(crate) important_declarations: StagedList,
}

// No explicit deinit — all fields own their storage and drop automatically.

impl SupportsEntry {
    fn list(&self, important: bool) -> &StagedList {
        if important {
            &self.important_declarations
        } else {
            &self.declarations
        }
    }

    fn list_mut(&mut self, important: bool) -> &mut StagedList {
        if important {
            &mut self.important_declarations
        } else {
            &mut self.declarations
        }
    }

    fn is_empty(&self) -> bool {
        self.declarations.copies.is_empty() && self.important_declarations.copies.is_empty()
    }
}

/// The declarations behind a cut in a style rule's block, printed as a rule of their own behind the `@supports` rules of what precedes them.
pub(crate) struct Tail {
    declarations: Vec<css::Property>,
    important: bool,
    supports: Vec<SupportsEntry>,
}

/// The group a declaration of `id` can be overridden within: the `background` properties, the `border` and `border-image` properties, or the property alone.
fn family_of(id: PropertyId) -> PropertyIdTag {
    let tag = id.tag();
    if is_background_property(id) {
        PropertyIdTag::Background
    } else if is_border_property(tag) || is_border_image_property(tag) {
        PropertyIdTag::Border
    } else {
        tag
    }
}

/// Whether `declaration` is `all`, which the parser keeps as an unknown property until it has a typed one (#42042).
fn is_all(declaration: &css::Property) -> bool {
    let css::Property::Custom(custom) = declaration else {
        return false;
    };
    matches!(
        custom.name,
        CustomPropertyName::Unknown(name)
            if strings::eql_case_insensitive_ascii_check_length(name.v(), b"all")
    )
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DeclarationContext {
    None,
    StyleRule,
    StyleAttribute,
}

pub struct PropertyHandlerContext<'a> {
    // `arena` is the parser arena that owns the AST being
    // minified; bound to `'a` alongside the other borrowed inputs.
    pub(crate) arena: &'a Bump,
    pub(crate) targets: css::targets::Targets,
    pub(crate) is_important: bool,
    pub(crate) supports: Vec<SupportsEntry>,
    pub(crate) tails: Vec<Tail>,
    /// A handler printed a declaration behind a later one of its family, and that family has copies staged.
    output_unordered: bool,
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
            tails: Vec::new(),
            output_unordered: false,
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
            tails: Vec::new(),
            output_unordered: false,
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

    /// Clone a property list into a bump-allocated `DeclarationList`.
    /// (`'static` per crate-wide `'bump`-erasure; see rules/mod.rs decl_block_static.)
    #[inline]
    fn clone_decls<'p>(
        &self,
        list: impl IntoIterator<Item = &'p css::Property>,
    ) -> css::DeclarationList<'static> {
        let bump: &'static Bump = self.bump_static();
        bun_alloc::vec_from_iter_in(list.into_iter().map(|p| p.deep_clone(bump)), bump)
    }

    #[inline]
    fn clone_copies(&self, list: &StagedList) -> css::DeclarationList<'static> {
        self.clone_decls(list.copies.iter().map(|copy| &copy.property))
    }

    pub(crate) fn get_supports_rules<T>(
        &self,
        style_rule: &css::StyleRule<T>,
    ) -> Vec<css::CssRule<T>> {
        if self.supports.is_empty() {
            return Vec::new();
        }

        let mut dest: Vec<css::CssRule<T>> = Vec::with_capacity(self.supports.len());
        self.push_supports_rules(&self.supports, style_rule, &mut dest);
        dest
    }

    fn push_supports_rules<T>(
        &self,
        entries: &[SupportsEntry],
        style_rule: &css::StyleRule<T>,
        dest: &mut Vec<css::CssRule<T>>,
    ) {
        for entry in entries {
            dest.push(css::CssRule::Supports(css::SupportsRule {
                condition: entry.condition.deep_clone(self.arena),
                rules: css::CssRuleList {
                    v: vec![css::CssRule::Style(css::StyleRule {
                        selectors: style_rule.selectors.deep_clone(),
                        vendor_prefix: css::VendorPrefix::NONE,
                        declarations: css::DeclarationBlock {
                            declarations: self.clone_copies(&entry.declarations),
                            important_declarations: self
                                .clone_copies(&entry.important_declarations),
                        },
                        rules: css::CssRuleList::default(),
                        loc: style_rule.loc,
                    })],
                },
                loc: style_rule.loc,
            }));
        }
    }

    /// Each tail as a style rule with `style_rule`'s selectors, followed by its own `@supports` rules.
    pub(crate) fn get_tail_rules<T>(&self, style_rule: &css::StyleRule<T>) -> Vec<css::CssRule<T>> {
        let mut dest: Vec<css::CssRule<T>> = Vec::new();

        for tail in &self.tails {
            let mut declarations = css::DeclarationBlock::new_in(self.bump_static());
            if tail.important {
                declarations.important_declarations = self.clone_decls(&tail.declarations);
            } else {
                declarations.declarations = self.clone_decls(&tail.declarations);
            }
            dest.push(css::CssRule::Style(css::StyleRule {
                selectors: style_rule.selectors.deep_clone(),
                vendor_prefix: style_rule.vendor_prefix,
                declarations,
                rules: css::CssRuleList::default(),
                loc: style_rule.loc,
            }));
            self.push_supports_rules(&tail.supports, style_rule, &mut dest);
        }

        dest
    }

    pub(crate) fn get_additional_rules<T>(
        &self,
        style_rule: &css::StyleRule<T>,
    ) -> Vec<css::CssRule<T>> {
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
        self.tails.clear();
        self.output_unordered = false;
        self.ltr.clear();
        self.rtl.clear();
        self.dark.clear();
    }
}

impl<'a> PropertyHandlerContext<'a> {
    fn add_conditional_property(&mut self, condition: css::SupportsCondition, copy: StagedCopy) {
        if self.context != DeclarationContext::StyleRule {
            return;
        }

        let important = self.is_important;
        if let Some(entry) = self
            .supports
            .iter_mut()
            .find(|entry| condition.eql(&entry.condition))
        {
            entry.list_mut(important).push(copy);
        } else {
            let mut entry = SupportsEntry {
                condition,
                declarations: StagedList::default(),
                important_declarations: StagedList::default(),
            };
            entry.list_mut(important).push(copy);
            self.supports.push(entry);
        }
    }

    /// `source` is the declaration as it sits in the block being minified; `later_from` is the index in the handler's output list from which later output lands behind the base.
    pub(crate) fn add_unparsed_fallbacks(
        &mut self,
        bump: &bun_alloc::Arena,
        unparsed: &mut UnparsedProperty,
        source: &UnparsedProperty,
        later_from: usize,
    ) {
        if self.context != DeclarationContext::StyleRule
            && self.context != DeclarationContext::StyleAttribute
        {
            return;
        }

        let fallbacks = unparsed.value.get_fallbacks(bump, &self.targets);
        if !self.supports.is_empty() && unparsed.value.is_valid_at_parse_time() {
            self.retract_conditional(unparsed.property_id, fallbacks.slice());
        }
        // `SmallList`
        // has no `IntoIterator`, so spill to a Vec to preserve P3-before-LAB order.
        for condition_and_fallback in fallbacks.to_owned_slice().into_vec() {
            self.add_conditional_property(
                condition_and_fallback.0,
                StagedCopy {
                    property: css::Property::Unparsed(UnparsedProperty {
                        // `PropertyId` is `Copy`.
                        property_id: unparsed.property_id,
                        value: condition_and_fallback.1,
                    }),
                    source: core::ptr::from_ref(source).addr(),
                    later_from,
                },
            );
        }
    }

    /// Drops the staged copies of `property_id`, except in the `@supports` rules of `keep`, where the declaration in hand stages its own behind them.
    pub(crate) fn retract_conditional(&mut self, property_id: PropertyId, keep: &[Fallbacks]) {
        if self.context != DeclarationContext::StyleRule {
            return;
        }

        // Departs from lightningcss on purpose: it prints these behind the rule, where they beat the later declaration that the cascade lets win in every browser.
        let important = self.is_important;
        self.supports.retain_mut(|entry| {
            if !keep.iter().any(|(kept, _)| kept.eql(&entry.condition)) {
                entry.list_mut(important).retract(property_id);
            }
            !entry.is_empty()
        });
    }

    /// Whether an earlier declaration of the rule in hand has a copy of `property_id` staged.
    pub(crate) fn has_live_copy(&self, property_id: PropertyId) -> bool {
        self.context == DeclarationContext::StyleRule
            && self
                .supports
                .iter()
                .any(|entry| entry.list(self.is_important).holds(property_id))
    }

    /// For a handler that prints a declaration of `id`'s family behind a later one: a cut would carry it over the copies of that family.
    pub(crate) fn mark_output_unordered(&mut self, id: PropertyId) {
        let family = family_of(id);
        self.output_unordered |= self.supports.iter().any(|entry| {
            [&entry.declarations, &entry.important_declarations]
                .into_iter()
                .any(|list| list.holds_family(family))
        });
    }

    /// Cuts the output lists in front of each declaration that competes with a staged copy, and parks what is behind a cut in `tails`.
    #[cold]
    #[inline(never)]
    pub(crate) fn split_at_competitors(
        &mut self,
        source: &css::DeclarationBlock<'_>,
        output: &mut css::DeclarationList<'_>,
        important_output: &mut css::DeclarationList<'_>,
    ) {
        if self.context != DeclarationContext::StyleRule || self.output_unordered {
            return;
        }

        // Departs from lightningcss on purpose: it prints every copy behind the whole rule, where the copy beats later declarations that the cascade puts after it.
        self.split_list(&source.declarations, output, false);
        self.split_list(&source.important_declarations, important_output, true);
        self.supports.retain(|entry| !entry.is_empty());
    }

    fn split_list(
        &mut self,
        source: &[css::Property],
        output: &mut css::DeclarationList<'_>,
        important: bool,
    ) {
        if self
            .supports
            .iter()
            .all(|entry| entry.list(important).copies.is_empty())
        {
            return;
        }

        debug_assert!(
            self.supports.iter().all(|entry| {
                let copies = &entry.list(important).copies;
                copies.is_sorted_by(|a, b| a.source < b.source && a.later_from <= b.later_from)
                    && copies
                        .iter()
                        .all(|copy| copy.source_index(source) < source.len())
            }),
            "staged copies are in source order and point into the block being minified"
        );

        // Source order decides whether anything competes: handlers that buffer emit earlier declarations behind a base.
        let uncopied: Vec<Vec<(PropertyIdTag, usize)>> = self
            .supports
            .iter()
            .map(|entry| last_uncopied(&entry.list(important).copies, source))
            .collect();

        let mut cuts: Vec<usize> = Vec::new();
        let mut cursors = vec![0usize; self.supports.len()];
        let mut has_copies = false;
        let mut competed: Vec<PropertyIdTag> = Vec::new();
        for (index, declaration) in output.iter().enumerate() {
            for ((entry, cursor), uncopied) in self.supports.iter().zip(&mut cursors).zip(&uncopied)
            {
                let copies = &entry.list(important).copies;
                while let Some(copy) = copies.get(*cursor).filter(|copy| copy.later_from <= index) {
                    *cursor += 1;
                    has_copies = true;
                    let family = family_of(copy.property_id());
                    let at = copy.source_index(source);
                    if !competed.contains(&family)
                        && uncopied
                            .iter()
                            .any(|&(later, last)| later == family && last > at)
                    {
                        competed.push(family);
                    }
                }
            }
            if has_copies
                && (is_all(declaration) || competed.contains(&family_of(declaration.property_id())))
            {
                cuts.push(index);
                has_copies = false;
                competed.clear();
            }
        }

        let arena = self.arena;
        let mut tails: Vec<Tail> = Vec::with_capacity(cuts.len());
        for &cut in cuts.iter().rev() {
            let mut declarations: Vec<css::Property> = Vec::with_capacity(output.len() - cut);
            while let Some(declaration) = output.pop() {
                declarations.push(declaration);
                if output.len() == cut {
                    break;
                }
            }
            declarations.reverse();

            let mut supports: Vec<SupportsEntry> = Vec::new();
            for entry in &mut self.supports {
                let behind = entry.list_mut(important).split_off(cut);
                if behind.copies.is_empty() {
                    continue;
                }
                let mut tail_entry = SupportsEntry {
                    condition: entry.condition.deep_clone(arena),
                    declarations: StagedList::default(),
                    important_declarations: StagedList::default(),
                };
                *tail_entry.list_mut(important) = behind;
                supports.push(tail_entry);
            }

            tails.push(Tail {
                declarations,
                important,
                supports,
            });
        }
        self.tails.extend(tails.into_iter().rev());
    }
}

/// The last index in `source`, per family in `copies`, of a declaration that staged none of them: one that did shadows the earlier copies inside the same `@supports` rule.
fn last_uncopied(copies: &[StagedCopy], source: &[css::Property]) -> Vec<(PropertyIdTag, usize)> {
    let mut families: Vec<PropertyIdTag> = Vec::new();
    for copy in copies {
        let family = family_of(copy.property_id());
        if !families.contains(&family) {
            families.push(family);
        }
    }

    let mut found: Vec<(PropertyIdTag, usize)> = Vec::with_capacity(families.len());
    let mut sources = copies
        .iter()
        .rev()
        .map(|copy| copy.source_index(source))
        .peekable();
    for (index, declaration) in source.iter().enumerate().rev() {
        if found.len() == families.len() {
            break;
        }
        // `all: revert-layer` is the placeholder of a slot whose declaration no handler took; a typed `all` (#42042) would need telling apart here.
        if sources.next_if_eq(&index).is_some() || matches!(declaration, css::Property::All(_)) {
            continue;
        }
        let family = family_of(declaration.property_id());
        if families.contains(&family) && !found.iter().any(|&(later, _)| later == family) {
            found.push((family, index));
        }
    }
    found
}
