use crate::css_parser as css;
use crate::css_parser::{CSSString, CSSStringFns, Printer, PrintErr, StyleContext, SymbolList, VendorPrefix};
use crate::css_parser::targets::Targets;
use crate::css_parser::compat::Feature;

use bun_alloc::Arena as Bump;
use bun_collections::ArrayHashMap;
use bun_core::Output;

bun_output::declare_scope!(CSS_SELECTORS, visible);

pub use css::Printer as _Printer; // re-export alias parity
pub use css::PrintErr as _PrintErr;

pub use parser::Selector;
pub use parser::SelectorList;
pub use parser::Component;
pub use parser::PseudoClass;
pub use parser::PseudoElement;

/// Our implementation of the `SelectorImpl` interface
///
// TODO(port): `impl` is a Rust keyword; using raw identifier `r#impl` for module name parity.
pub mod r#impl {
    use super::*;

    pub mod selectors {
        use super::*;

        pub mod selector_impl {
            use super::*;

            pub type AttrValue = css::css_values::string::CSSString;
            pub type Identifier = css::css_values::ident::Ident;
            /// An identifier which could be a local name for use in CSS modules
            pub type LocalIdentifier = css::css_values::ident::IdentOrRef;
            pub type LocalName = css::css_values::ident::Ident;
            pub type NamespacePrefix = css::css_values::ident::Ident;
            pub type NamespaceUrl = &'static [u8]; // TODO(port): lifetime — Zig `[]const u8` type alias
            pub type BorrowedNamespaceUrl = &'static [u8]; // TODO(port): lifetime
            pub type BorrowedLocalName = css::css_values::ident::Ident;

            pub type NonTSPseudoClass = parser::PseudoClass;
            pub type PseudoElement = parser::PseudoElement;
            pub type VendorPrefix = css::VendorPrefix;
            pub type ExtraMatchingData = ();
        }

        pub mod local_identifier {
            use super::*;

            pub fn from_ident(ident: css::css_values::ident::Ident) -> selector_impl::LocalIdentifier {
                css::css_values::ident::IdentOrRef { v: ident }
            }
        }
    }
}

pub use super::parser;

/// Returns whether two selector lists are equivalent, i.e. the same minus any vendor prefix differences.
pub fn is_equivalent(selectors: &[Selector], other: &[Selector]) -> bool {
    if selectors.len() != other.len() {
        return false;
    }

    for (i, a) in selectors.iter().enumerate() {
        let b = &other[i];
        if a.len() != b.len() {
            return false;
        }

        debug_assert_eq!(a.components.len(), b.components.len());
        for (a_comp, b_comp) in a.components.iter().zip(b.components.iter()) {
            let is_equiv = 'blk: {
                if let (Component::NonTsPseudoClass(a_pc), Component::NonTsPseudoClass(b_pc)) = (a_comp, b_comp) {
                    break 'blk a_pc.is_equivalent(b_pc);
                } else if let (Component::PseudoElement(a_pe), Component::PseudoElement(b_pe)) = (a_comp, b_comp) {
                    break 'blk a_pe.is_equivalent(b_pe);
                } else if matches!(
                    (a_comp, b_comp),
                    (Component::Any { .. }, Component::Is(_))
                        | (Component::Is(_), Component::Any { .. })
                        | (Component::Any { .. }, Component::Any { .. })
                        | (Component::Is(_), Component::Is(_))
                ) {
                    let a_selectors = match a_comp {
                        Component::Any { selectors, .. } => &selectors[..],
                        Component::Is(v) => &v[..],
                        _ => unreachable!(),
                    };
                    let b_selectors = match b_comp {
                        Component::Any { selectors, .. } => &selectors[..],
                        Component::Is(v) => &v[..],
                        _ => unreachable!(),
                    };
                    break 'blk is_equivalent(a_selectors, b_selectors);
                } else {
                    break 'blk Component::eql(a_comp, b_comp);
                }
            };

            if !is_equiv {
                return false;
            }
        }
    }

    true
}

/// Downlevels the given selectors to be compatible with the given browser targets.
/// Returns the necessary vendor prefixes.
pub fn downlevel_selectors<'bump>(bump: &'bump Bump, selectors: &mut [Selector], targets: Targets) -> VendorPrefix {
    let mut necessary_prefixes = VendorPrefix::empty();
    for selector in selectors.iter_mut() {
        for component in selector.components.iter_mut() {
            necessary_prefixes.insert(downlevel_component(bump, component, targets));
        }
    }
    necessary_prefixes
}

pub fn downlevel_component<'bump>(bump: &'bump Bump, component: &mut Component, targets: Targets) -> VendorPrefix {
    match component {
        Component::NonTsPseudoClass(pc) => {
            return match pc {
                PseudoClass::Dir(d) => {
                    if targets.should_compile_same(Feature::DirSelector) {
                        *component = downlevel_dir(bump, d.direction, targets);
                        return downlevel_component(bump, component, targets);
                    }
                    VendorPrefix::empty()
                }
                PseudoClass::Lang(l) => {
                    // :lang() with multiple languages is not supported everywhere.
                    // compile this to :is(:lang(a), :lang(b)) etc.
                    if l.languages.len() > 1 && targets.should_compile_same(Feature::LangSelectorList) {
                        *component = Component::Is(lang_list_to_selectors(bump, &l.languages));
                        return downlevel_component(bump, component, targets);
                    }
                    VendorPrefix::empty()
                }
                _ => pc.get_necessary_prefixes(targets),
            };
        }
        Component::PseudoElement(pe) => pe.get_necessary_prefixes(targets),
        Component::Is(selectors) => {
            let mut necessary_prefixes = downlevel_selectors(bump, selectors, targets);

            // Convert :is to :-webkit-any/:-moz-any if needed.
            // All selectors must be simple, no combinators are supported.
            if targets.should_compile_same(Feature::IsSelector)
                && !should_unwrap_is(selectors)
                && 'brk: {
                    for selector in selectors.iter() {
                        if selector.has_combinator() {
                            break 'brk false;
                        }
                    }
                    break 'brk true;
                }
            {
                necessary_prefixes.insert(targets.prefixes(VendorPrefix::NONE, css::prefixes::Feature::AnyPseudo));
            } else {
                necessary_prefixes.insert(VendorPrefix::NONE);
            }

            necessary_prefixes
        }
        Component::Negation(selectors) => {
            let mut necessary_prefixes = downlevel_selectors(bump, selectors, targets);

            // Downlevel :not(.a, .b) -> :not(:is(.a, .b)) if not list is unsupported.
            // We need to use :is() / :-webkit-any() rather than :not(.a):not(.b) to ensure the specificity is equivalent.
            // https://drafts.csswg.org/selectors/#specificity-rules
            if selectors.len() > 1 && targets.should_compile_same(Feature::NotSelectorList) {
                let is: Selector = Selector::from_component(
                    bump,
                    Component::Is({
                        // PERF(port): was arena bulk-alloc — profile in Phase B
                        let mut new_selectors =
                            bumpalo::collections::Vec::with_capacity_in(selectors.len(), bump);
                        for sel in selectors.iter() {
                            new_selectors.push(sel.deep_clone(bump));
                        }
                        new_selectors.into_bump_slice_mut()
                        // TODO(port): Zig used `allocator.alloc(Selector, n)` returning `[]Selector`;
                        // exact owned-slice type for Component::Is payload TBD in Phase B.
                    }),
                );
                let mut list = bumpalo::collections::Vec::with_capacity_in(1, bump);
                list.push(is);
                // PERF(port): was appendAssumeCapacity
                *component = Component::Negation(list.into_bump_slice_mut());

                if targets.should_compile_same(Feature::IsSelector) {
                    necessary_prefixes
                        .insert(targets.prefixes(VendorPrefix::NONE, css::prefixes::Feature::AnyPseudo));
                } else {
                    necessary_prefixes.insert(VendorPrefix::NONE);
                }
            }

            necessary_prefixes
        }
        Component::Where(s) | Component::Has(s) => downlevel_selectors(bump, s, targets),
        Component::Any { selectors, .. } => downlevel_selectors(bump, selectors, targets),
        _ => VendorPrefix::empty(),
    }
}

const RTL_LANGS: &[&[u8]] = &[
    b"ae", b"ar", b"arc", b"bcc", b"bqi", b"ckb", b"dv", b"fa", b"glk", b"he", b"ku", b"mzn", b"nqo", b"pnb",
    b"ps", b"sd", b"ug", b"ur", b"yi",
];

fn downlevel_dir<'bump>(bump: &'bump Bump, dir: parser::Direction, targets: Targets) -> Component {
    // Convert :dir to :lang. If supported, use a list of languages in a single :lang,
    // otherwise, use :is/:not, which may be further downleveled to e.g. :-webkit-any.
    if !targets.should_compile_same(Feature::LangSelectorList) {
        let c = Component::NonTsPseudoClass(PseudoClass::Lang {
            languages: {
                let mut list = bumpalo::collections::Vec::with_capacity_in(RTL_LANGS.len(), bump);
                list.extend_from_slice(RTL_LANGS);
                // PERF(port): was appendSliceAssumeCapacity
                list
            },
        });
        if dir == parser::Direction::Ltr {
            return Component::Negation(
                bumpalo::vec![in bump; Selector::from_component(bump, c)].into_bump_slice_mut(),
            );
        }
        return c;
    } else {
        if dir == parser::Direction::Ltr {
            return Component::Negation(lang_list_to_selectors(bump, RTL_LANGS));
        }
        return Component::Is(lang_list_to_selectors(bump, RTL_LANGS));
    }
}

fn lang_list_to_selectors<'bump>(bump: &'bump Bump, langs: &[&[u8]]) -> &'bump mut [Selector] {
    // TODO(port): return type — Zig returned `[]Selector` (mutable arena slice).
    let mut selectors = bumpalo::collections::Vec::with_capacity_in(langs.len(), bump);
    for lang in langs {
        selectors.push(Selector::from_component(
            bump,
            Component::NonTsPseudoClass(PseudoClass::Lang {
                languages: {
                    let mut list = bumpalo::collections::Vec::with_capacity_in(1, bump);
                    list.push(*lang);
                    // PERF(port): was appendAssumeCapacity
                    list
                },
            }),
        ));
    }
    selectors.into_bump_slice_mut()
}

/// Returns the vendor prefix (if any) used in the given selector list.
/// If multiple vendor prefixes are seen, this is invalid, and an empty result is returned.
pub fn get_prefix(selectors: &SelectorList) -> VendorPrefix {
    let mut prefix = VendorPrefix::empty();
    for selector in selectors.v.slice() {
        for component in selector.components.iter() {
            let component: &Component = component;
            let p = match component {
                // Return none rather than empty for these so that we call downlevel_selectors.
                Component::NonTsPseudoClass(pc) => match pc {
                    PseudoClass::Lang { .. } => VendorPrefix::NONE,
                    PseudoClass::Dir { .. } => VendorPrefix::NONE,
                    _ => pc.get_prefix(),
                },
                Component::Is(_) => VendorPrefix::NONE,
                Component::Where(_) => VendorPrefix::NONE,
                Component::Has(_) => VendorPrefix::NONE,
                Component::Negation(_) => VendorPrefix::NONE,
                Component::Any { vendor_prefix, .. } => *vendor_prefix,
                Component::PseudoElement(pe) => pe.get_prefix(),
                _ => VendorPrefix::empty(),
            };

            if !p.is_empty() {
                // Allow none to be mixed with a prefix.
                let mut prefix_without_none = prefix;
                prefix_without_none.remove(VendorPrefix::NONE);
                if prefix_without_none.is_empty() || prefix_without_none == p {
                    prefix.insert(p);
                } else {
                    return VendorPrefix::empty();
                }
            }
        }
    }

    prefix
}

pub fn is_compatible(selectors: &[parser::Selector], targets: Targets) -> bool {
    use Feature as F;
    for selector in selectors {
        for component in selector.components.iter() {
            let feature = match component {
                Component::Id(_) | Component::Class(_) | Component::LocalName(_) => continue,

                Component::ExplicitAnyNamespace
                | Component::ExplicitNoNamespace
                | Component::DefaultNamespace(_)
                | Component::Namespace(_) => F::Namespaces,

                Component::ExplicitUniversalType => F::Selectors2,

                Component::AttributeInNoNamespaceExists { .. } => F::Selectors2,

                Component::AttributeInNoNamespace(x) => 'brk: {
                    if x.case_sensitivity != parser::attrs::ParsedCaseSensitivity::CaseSensitive {
                        break 'brk F::CaseInsensitive;
                    }
                    match x.operator {
                        parser::attrs::AttrSelectorOperator::Equal
                        | parser::attrs::AttrSelectorOperator::Includes
                        | parser::attrs::AttrSelectorOperator::DashMatch => F::Selectors2,
                        parser::attrs::AttrSelectorOperator::Prefix
                        | parser::attrs::AttrSelectorOperator::Substring
                        | parser::attrs::AttrSelectorOperator::Suffix => F::Selectors3,
                    }
                }

                Component::AttributeOther(attr) => match &attr.operation {
                    parser::attrs::ParsedAttrSelectorOperation::Exists => F::Selectors2,
                    parser::attrs::ParsedAttrSelectorOperation::WithValue(x) => 'brk: {
                        if x.case_sensitivity != parser::attrs::ParsedCaseSensitivity::CaseSensitive {
                            break 'brk F::CaseInsensitive;
                        }
                        match x.operator {
                            parser::attrs::AttrSelectorOperator::Equal
                            | parser::attrs::AttrSelectorOperator::Includes
                            | parser::attrs::AttrSelectorOperator::DashMatch => F::Selectors2,
                            parser::attrs::AttrSelectorOperator::Prefix
                            | parser::attrs::AttrSelectorOperator::Substring
                            | parser::attrs::AttrSelectorOperator::Suffix => F::Selectors3,
                        }
                    }
                },

                Component::Empty | Component::Root => F::Selectors3,
                Component::Negation(sels) => {
                    // :not() selector list is not forgiving.
                    if !targets.is_compatible(F::Selectors3) || !is_compatible(sels, targets) {
                        return false;
                    }
                    continue;
                }

                Component::Nth(data) => 'brk: {
                    if data.ty == parser::NthType::Child && data.a == 0 && data.b == 1 {
                        break 'brk F::Selectors2;
                    }
                    if data.ty == parser::NthType::Col || data.ty == parser::NthType::LastCol {
                        return false;
                    }
                    F::Selectors3
                }
                Component::NthOf(n) => {
                    if !targets.is_compatible(F::NthChildOf) || !is_compatible(&n.selectors, targets) {
                        return false;
                    }
                    continue;
                }

                // These support forgiving selector lists, so no need to check nested selectors.
                Component::Is(sels) => 'brk: {
                    // ... except if we are going to unwrap them.
                    if should_unwrap_is(sels) && is_compatible(sels, targets) {
                        continue;
                    }
                    break 'brk F::IsSelector;
                }
                Component::Where(_) | Component::Nesting => F::IsSelector,
                Component::Any { .. } => return false,
                Component::Has(sels) => {
                    if !targets.is_compatible(F::HasSelector) || !is_compatible(sels, targets) {
                        return false;
                    }
                    continue;
                }

                Component::Scope | Component::Host(_) | Component::Slotted(_) => F::Shadowdomv1,

                Component::Part(_) => F::PartPseudo,

                Component::NonTsPseudoClass(pseudo) => 'brk: {
                    match pseudo {
                        PseudoClass::Link
                        | PseudoClass::Visited
                        | PseudoClass::Active
                        | PseudoClass::Hover
                        | PseudoClass::Focus
                        | PseudoClass::Lang { .. } => break 'brk F::Selectors2,

                        PseudoClass::Checked
                        | PseudoClass::Disabled
                        | PseudoClass::Enabled
                        | PseudoClass::Target => break 'brk F::Selectors3,

                        PseudoClass::AnyLink(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::AnyLink;
                            }
                        }
                        PseudoClass::Indeterminate => break 'brk F::IndeterminatePseudo,

                        PseudoClass::Fullscreen(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::Fullscreen;
                            }
                        }

                        PseudoClass::FocusVisible => break 'brk F::FocusVisible,
                        PseudoClass::FocusWithin => break 'brk F::FocusWithin,
                        PseudoClass::Default => break 'brk F::DefaultPseudo,
                        PseudoClass::Dir { .. } => break 'brk F::DirSelector,
                        PseudoClass::Optional => break 'brk F::OptionalPseudo,
                        PseudoClass::PlaceholderShown(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::PlaceholderShown;
                            }
                        }

                        PseudoClass::ReadOnly(prefix) | PseudoClass::ReadWrite(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::ReadOnlyWrite;
                            }
                        }

                        PseudoClass::Valid | PseudoClass::Invalid | PseudoClass::Required => {
                            break 'brk F::FormValidation
                        }
                        PseudoClass::InRange | PseudoClass::OutOfRange => break 'brk F::InOutOfRange,

                        PseudoClass::Autofill(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::Autofill;
                            }
                        }

                        // Experimental, no browser support.
                        PseudoClass::Current
                        | PseudoClass::Past
                        | PseudoClass::Future
                        | PseudoClass::Playing
                        | PseudoClass::Paused
                        | PseudoClass::Seeking
                        | PseudoClass::Stalled
                        | PseudoClass::Buffering
                        | PseudoClass::Muted
                        | PseudoClass::VolumeLocked
                        | PseudoClass::TargetWithin
                        | PseudoClass::LocalLink
                        | PseudoClass::Blank
                        | PseudoClass::UserInvalid
                        | PseudoClass::UserValid
                        | PseudoClass::Defined => return false,

                        PseudoClass::Custom { .. } => {}

                        _ => {}
                    }
                    return false;
                }

                Component::PseudoElement(pseudo) => 'brk: {
                    match pseudo {
                        PseudoElement::After | PseudoElement::Before => break 'brk F::Gencontent,
                        PseudoElement::FirstLine => break 'brk F::FirstLine,
                        PseudoElement::FirstLetter => break 'brk F::FirstLetter,
                        PseudoElement::Selection(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::Selection;
                            }
                        }
                        PseudoElement::Placeholder(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::Placeholder;
                            }
                        }
                        PseudoElement::Marker => break 'brk F::MarkerPseudo,
                        PseudoElement::Backdrop(prefix) => {
                            if *prefix == VendorPrefix::NONE {
                                break 'brk F::Dialog;
                            }
                        }
                        PseudoElement::Cue => break 'brk F::Cue,
                        PseudoElement::CueFunction { .. } => break 'brk F::CueFunction,
                        PseudoElement::Custom { .. } => return false,
                        _ => {}
                    }
                    return false;
                }

                Component::Combinator(combinator) => match combinator {
                    parser::Combinator::Child | parser::Combinator::NextSibling => F::Selectors2,
                    parser::Combinator::LaterSibling => F::Selectors3,
                    _ => continue,
                },
            };

            if !targets.is_compatible(feature) {
                return false;
            }
        }
    }

    true
}

/// Determines whether a selector list contains only unused selectors.
/// A selector is considered unused if it contains a class or id component that exists in the set of unused symbols.
pub fn is_unused(
    selectors: &[parser::Selector],
    unused_symbols: &ArrayHashMap<&[u8], ()>, // TODO(port): Zig `std.StringArrayHashMapUnmanaged(void)`
    symbols: &SymbolList,
    parent_is_unused: bool,
) -> bool {
    if unused_symbols.len() == 0 {
        return false;
    }

    for selector in selectors {
        if !is_selector_unused(selector, unused_symbols, symbols, parent_is_unused) {
            return false;
        }
    }

    true
}

fn is_selector_unused(
    selector: &parser::Selector,
    unused_symbols: &ArrayHashMap<&[u8], ()>,
    symbols: &SymbolList,
    parent_is_unused: bool,
) -> bool {
    for component in selector.components.iter() {
        match component {
            Component::Class(ident) | Component::Id(ident) => {
                let actual_ident = ident.as_original_string(symbols);
                if unused_symbols.contains_key(actual_ident) {
                    return true;
                }
            }
            Component::Is(is) | Component::Where(is) => {
                if is_unused(is, unused_symbols, symbols, parent_is_unused) {
                    return true;
                }
            }
            Component::Any { selectors, .. } => {
                if is_unused(selectors, unused_symbols, symbols, parent_is_unused) {
                    return true;
                }
            }
            Component::Nesting => {
                if parent_is_unused {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// The serialization module ported from lightningcss.
///
/// Note that we have two serialization modules, one from lightningcss and one from servo.
///
/// This is because it actually uses both implementations. This is confusing.
pub mod serialize {
    use super::*;

    pub fn serialize_selector_list(
        list: &[parser::Selector],
        dest: &mut Printer,
        context: Option<&StyleContext>,
        is_relative: bool,
    ) -> Result<(), PrintErr> {
        let mut first = true;
        for selector in list {
            if !first {
                dest.delim(b',', false)?;
            }
            first = false;
            serialize_selector(selector, dest, context, is_relative)?;
        }
        Ok(())
    }

    pub fn serialize_selector(
        selector: &parser::Selector,
        dest: &mut Printer,
        context: Option<&StyleContext>,
        is_relative_: bool,
    ) -> Result<(), PrintErr> {
        let mut is_relative = is_relative_;

        #[cfg(debug_assertions)]
        {
            bun_output::scoped_log!(CSS_SELECTORS, "Selector components:\n");
            for comp in selector.components.iter() {
                bun_output::scoped_log!(CSS_SELECTORS, " {:?}\n", comp);
            }

            bun_output::scoped_log!(CSS_SELECTORS, "Compound selector iter\n");
            let mut compound_selectors = CompoundSelectorIter { sel: selector, i: 0 };
            while let Some(comp) = compound_selectors.next() {
                for c in comp {
                    bun_output::scoped_log!(CSS_SELECTORS, "  {:?}, ", c);
                }
            }
            bun_output::scoped_log!(CSS_SELECTORS, "\n");
        }

        // Compound selectors invert the order of their contents, so we need to
        // undo that during serialization.
        //
        // This two-iterator strategy involves walking over the selector twice.
        // We could do something more clever, but selector serialization probably
        // isn't hot enough to justify it, and the stringification likely
        // dominates anyway.
        //
        // NB: A parse-order iterator is a Rev<>, which doesn't expose as_slice(),
        // which we need for |split|. So we split by combinators on a match-order
        // sequence and then reverse.
        let mut combinators = CombinatorIter { sel: selector, i: 0 };
        let mut compound_selectors = CompoundSelectorIter { sel: selector, i: 0 };
        let should_compile_nesting = dest.targets.should_compile_same(Feature::Nesting);

        let mut first = true;
        let mut combinators_exhausted = false;
        while let Some(compound_) = compound_selectors.next() {
            debug_assert!(!combinators_exhausted);
            let mut compound = compound_;

            // Skip implicit :scope in relative selectors (e.g. :has(:scope > foo) -> :has(> foo))
            if is_relative && compound.len() >= 1 && matches!(compound[0], Component::Scope) {
                if let Some(combinator) = combinators.next() {
                    serialize_combinator(&combinator, dest)?;
                }
                compound = &compound[1..];
                is_relative = false;
            }

            // https://drafts.csswg.org/cssom/#serializing-selectors
            if compound.is_empty() {
                continue;
            }

            let has_leading_nesting = first && matches!(compound[0], Component::Nesting);
            let first_index: usize = if has_leading_nesting { 1 } else { 0 };
            first = false;

            // 1. If there is only one simple selector in the compound selectors
            //    which is a universal selector, append the result of
            //    serializing the universal selector to s.
            //
            // Check if `!compound{}` first--this can happen if we have
            // something like `... > ::before`, because we store `>` and `::`
            // both as combinators internally.
            //
            // If we are in this case, after we have serialized the universal
            // selector, we skip Step 2 and continue with the algorithm.
            let (can_elide_namespace, first_non_namespace) = if first_index >= compound.len() {
                (true, first_index)
            } else {
                match compound[0] {
                    Component::ExplicitAnyNamespace
                    | Component::ExplicitNoNamespace
                    | Component::Namespace(_) => (false, first_index + 1),
                    Component::DefaultNamespace(_) => (true, first_index + 1),
                    _ => (true, first_index),
                }
            };
            let mut perform_step_2 = true;
            let next_combinator = combinators.next();
            if first_non_namespace == compound.len() - 1 {
                // We have to be careful here, because if there is a
                // pseudo element "combinator" there isn't really just
                // the one simple selector. Technically this compound
                // selector contains the pseudo element selector as well
                // -- Combinator::PseudoElement, just like
                // Combinator::SlotAssignment, don't exist in the
                // spec.
                if next_combinator == Some(parser::Combinator::PseudoElement)
                    && compound[first_non_namespace].as_combinator() == Some(parser::Combinator::SlotAssignment)
                {
                    // do nothing
                } else if matches!(compound[first_non_namespace], Component::ExplicitUniversalType) {
                    // Iterate over everything so we serialize the namespace
                    // too.
                    let swap_nesting = has_leading_nesting && should_compile_nesting;
                    let slice = if swap_nesting {
                        // Swap nesting and type selector (e.g. &div -> div&).
                        &compound[1.min(compound.len())..]
                    } else {
                        compound
                    };

                    for simple in slice {
                        serialize_component(simple, dest, context)?;
                    }

                    if swap_nesting {
                        serialize_nesting(dest, context, false)?;
                    }

                    // Skip step 2, which is an "otherwise".
                    perform_step_2 = false;
                } else {
                    // do nothing
                }
            }

            // 2. Otherwise, for each simple selector in the compound selectors
            //    that is not a universal selector of which the namespace prefix
            //    maps to a namespace that is not the default namespace
            //    serialize the simple selector and append the result to s.
            //
            // See https://github.com/w3c/csswg-drafts/issues/1606, which is
            // proposing to change this to match up with the behavior asserted
            // in cssom/serialize-namespaced-type-selectors.html, which the
            // following code tries to match.
            if perform_step_2 {
                let iter = compound;
                let mut i: usize = 0;
                if has_leading_nesting
                    && should_compile_nesting
                    && is_type_selector(if first_non_namespace < compound.len() {
                        Some(&compound[first_non_namespace])
                    } else {
                        None
                    })
                {
                    // Swap nesting and type selector (e.g. &div -> div&).
                    // This ensures that the compiled selector is valid. e.g. (div.foo is valid, .foodiv is not).
                    let nesting = &iter[i];
                    i += 1;
                    let local = &iter[i];
                    i += 1;
                    serialize_component(local, dest, context)?;

                    // Also check the next item in case of namespaces.
                    if first_non_namespace > first_index {
                        let local2 = &iter[i];
                        i += 1;
                        serialize_component(local2, dest, context)?;
                    }

                    serialize_component(nesting, dest, context)?;
                } else if has_leading_nesting && should_compile_nesting {
                    // Nesting selector may serialize differently if it is leading, due to type selectors.
                    i += 1;
                    serialize_nesting(dest, context, true)?;
                }

                if i < compound.len() {
                    for simple in &iter[i..] {
                        if matches!(simple, Component::ExplicitUniversalType) {
                            // Can't have a namespace followed by a pseudo-element
                            // selector followed by a universal selector in the same
                            // compound selector, so we don't have to worry about the
                            // real namespace being in a different `compound`.
                            if can_elide_namespace {
                                continue;
                            }
                        }
                        serialize_component(simple, dest, context)?;
                    }
                }
            }

            // 3. If this is not the last part of the chain of the selector
            //    append a single SPACE (U+0020), followed by the combinator
            //    ">", "+", "~", ">>", "||", as appropriate, followed by another
            //    single SPACE (U+0020) if the combinator was not whitespace, to
            //    s.
            if let Some(c) = next_combinator {
                serialize_combinator(&c, dest)?;
            } else {
                combinators_exhausted = true;
            }

            // 4. If this is the last part of the chain of the selector and
            //    there is a pseudo-element, append "::" followed by the name of
            //    the pseudo-element, to s.
            //
            // (we handle this above)
        }
        Ok(())
    }

    pub fn serialize_component(
        component: &parser::Component,
        dest: &mut Printer,
        context: Option<&StyleContext>,
    ) -> Result<(), PrintErr> {
        match component {
            Component::Combinator(c) => return serialize_combinator(c, dest),
            Component::AttributeInNoNamespace(v) => {
                dest.write_char(b'[')?;
                css::css_values::ident::IdentFns::to_css(&v.local_name, dest)?;
                v.operator.to_css(dest)?;

                if dest.minify {
                    // PERF: should we put a scratch buffer in the printer
                    // Serialize as both an identifier and a string and choose the shorter one.
                    // TODO(port): Zig used `std.Io.Writer.Allocating`; use a Vec<u8> here.
                    let mut id: Vec<u8> = Vec::new();
                    if css::serializer::serialize_identifier(&v.value, &mut id).is_err() {
                        return dest.add_fmt_error();
                    }

                    let s = css::to_css::string(
                        dest.allocator,
                        // TODO(port): generic type param `CSSString` was passed at comptime in Zig.
                        &v.value,
                        css::PrinterOptions::default(),
                        dest.import_info,
                        dest.local_names,
                        dest.symbols,
                    )?;

                    let id_items = &id[..];
                    if !id_items.is_empty() && id_items.len() < s.len() {
                        dest.write_str(id_items)?;
                    } else {
                        dest.write_str(&s)?;
                    }
                } else {
                    CSSStringFns::to_css(&v.value, dest)?;
                }

                match v.case_sensitivity {
                    parser::attrs::ParsedCaseSensitivity::CaseSensitive
                    | parser::attrs::ParsedCaseSensitivity::AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument => {}
                    parser::attrs::ParsedCaseSensitivity::AsciiCaseInsensitive => dest.write_str(b" i")?,
                    parser::attrs::ParsedCaseSensitivity::ExplicitCaseSensitive => dest.write_str(b" s")?,
                }
                return dest.write_char(b']');
            }
            Component::Is(_) | Component::Where(_) | Component::Negation(_) | Component::Any { .. } => {
                match component {
                    Component::Where(_) => dest.write_str(b":where(")?,
                    Component::Is(selectors) => {
                        // If there's only one simple selector, serialize it directly.
                        if should_unwrap_is(selectors) {
                            return serialize_selector(&selectors[0], dest, context, false);
                        }

                        let vp = dest.vendor_prefix;
                        if vp.contains(VendorPrefix::WEBKIT) || vp.contains(VendorPrefix::MOZ) {
                            dest.write_char(b':')?;
                            vp.to_css(dest)?;
                            dest.write_str(b"any(")?;
                        } else {
                            dest.write_str(b":is(")?;
                        }
                    }
                    Component::Negation(_) => {
                        dest.write_str(b":not(")?;
                    }
                    Component::Any { vendor_prefix, .. } => {
                        let vp = dest.vendor_prefix.or(*vendor_prefix);
                        if vp.contains(VendorPrefix::WEBKIT) || vp.contains(VendorPrefix::MOZ) {
                            dest.write_char(b':')?;
                            vp.to_css(dest)?;
                            dest.write_str(b"any(")?;
                        } else {
                            dest.write_str(b":is(")?;
                        }
                    }
                    _ => unreachable!(),
                }
                serialize_selector_list(
                    match component {
                        Component::Where(list) | Component::Is(list) | Component::Negation(list) => list,
                        Component::Any { selectors, .. } => selectors,
                        _ => unreachable!(),
                    },
                    dest,
                    context,
                    false,
                )?;
                return dest.write_str(b")");
            }
            Component::Has(list) => {
                dest.write_str(b":has(")?;
                serialize_selector_list(list, dest, context, true)?;
                return dest.write_str(b")");
            }
            Component::NonTsPseudoClass(pseudo) => {
                return serialize_pseudo_class(pseudo, dest, context);
            }
            Component::PseudoElement(pseudo) => {
                return serialize_pseudo_element(pseudo, dest, context);
            }
            Component::Nesting => {
                return serialize_nesting(dest, context, false);
            }
            Component::Class(class) => {
                dest.write_char(b'.')?;
                return dest.write_ident_or_ref(*class, dest.css_module.is_some());
            }
            Component::Id(id) => {
                dest.write_char(b'#')?;
                return dest.write_ident_or_ref(*id, dest.css_module.is_some());
            }
            Component::Host(selector) => {
                dest.write_str(b":host")?;
                if let Some(sel) = selector {
                    dest.write_char(b'(')?;
                    serialize_selector(sel, dest, dest.context(), false)?;
                    dest.write_char(b')')?;
                }
                return Ok(());
            }
            Component::Slotted(selector) => {
                dest.write_str(b"::slotted(")?;
                serialize_selector(selector, dest, dest.context(), false)?;
                dest.write_char(b')')?;
            }
            // Component::Nth(nth_data) => {
            //     nth_data.write_start(dest, nth_data.is_function())?;
            //     if nth_data.is_function() {
            //         nth_data.write_affine(dest)?;
            //         dest.write_char(b')')?;
            //     }
            // }

            _ => {
                tocss_servo::to_css_component(component, dest)?;
            }
        }
        Ok(())
    }

    pub fn serialize_combinator(
        combinator: &parser::Combinator,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        match combinator {
            parser::Combinator::Child => dest.delim(b'>', true)?,
            parser::Combinator::Descendant => dest.write_str(b" ")?,
            parser::Combinator::NextSibling => dest.delim(b'+', true)?,
            parser::Combinator::LaterSibling => dest.delim(b'~', true)?,
            parser::Combinator::Deep => dest.write_str(b" /deep/ ")?,
            parser::Combinator::DeepDescendant => {
                dest.whitespace()?;
                dest.write_str(b">>>")?;
                dest.whitespace()?;
            }
            parser::Combinator::PseudoElement
            | parser::Combinator::Part
            | parser::Combinator::SlotAssignment => return Ok(()),
        }
        Ok(())
    }

    pub fn serialize_pseudo_class(
        pseudo_class: &parser::PseudoClass,
        dest: &mut Printer,
        context: Option<&StyleContext>,
    ) -> Result<(), PrintErr> {
        match pseudo_class {
            PseudoClass::Lang { languages } => {
                dest.write_str(b":lang(")?;
                let mut first = true;
                for lang in languages.iter() {
                    if first {
                        first = false;
                    } else {
                        dest.delim(b',', false)?;
                    }
                    if css::serializer::serialize_identifier(lang, dest).is_err() {
                        return dest.add_fmt_error();
                    }
                }
                return dest.write_str(b")");
            }
            PseudoClass::Dir(d) => {
                let dir = d.direction;
                dest.write_str(b":dir(")?;
                dir.to_css(dest)?;
                return dest.write_str(b")");
            }
            _ => {}
        }

        #[inline]
        fn write_prefixed(
            d: &mut Printer,
            prefix: VendorPrefix,
            val: &'static [u8],
        ) -> Result<(), PrintErr> {
            d.write_char(b':')?;
            // If the printer has a vendor prefix override, use that.
            let vp = if !d.vendor_prefix.is_empty() {
                (d.vendor_prefix | prefix).or_none()
            } else {
                prefix
            };
            vp.to_css(d)?;
            d.write_str(val)
        }

        // TODO(port): Zig `Helpers.pseudo` used comptime `@field` to look up
        // `dest.pseudo_classes.<snake_case_key>`. Expanded per call site via macro.
        macro_rules! pseudo {
            ($d:expr, $field:ident, $s:literal) => {{
                let class = if let Some(pseudo_classes) = &$d.pseudo_classes {
                    pseudo_classes.$field
                } else {
                    None
                };
                if let Some(class) = class {
                    $d.write_char(b'.')?;
                    $d.write_ident(class, true)?;
                } else {
                    $d.write_str($s)?;
                }
            }};
        }

        match pseudo_class {
            // https://drafts.csswg.org/selectors-4/#useraction-pseudos
            PseudoClass::Hover => pseudo!(dest, hover, b":hover"),
            PseudoClass::Active => pseudo!(dest, active, b":active"),
            PseudoClass::Focus => pseudo!(dest, focus, b":focus"),
            PseudoClass::FocusVisible => pseudo!(dest, focus_visible, b":focus-visible"),
            PseudoClass::FocusWithin => pseudo!(dest, focus_within, b":focus-within"),

            // https://drafts.csswg.org/selectors-4/#time-pseudos
            PseudoClass::Current => dest.write_str(b":current")?,
            PseudoClass::Past => dest.write_str(b":past")?,
            PseudoClass::Future => dest.write_str(b":future")?,

            // https://drafts.csswg.org/selectors-4/#resource-pseudos
            PseudoClass::Playing => dest.write_str(b":playing")?,
            PseudoClass::Paused => dest.write_str(b":paused")?,
            PseudoClass::Seeking => dest.write_str(b":seeking")?,
            PseudoClass::Buffering => dest.write_str(b":buffering")?,
            PseudoClass::Stalled => dest.write_str(b":stalled")?,
            PseudoClass::Muted => dest.write_str(b":muted")?,
            PseudoClass::VolumeLocked => dest.write_str(b":volume-locked")?,

            // https://fullscreen.spec.whatwg.org/#:fullscreen-pseudo-class
            PseudoClass::Fullscreen(prefix) => {
                dest.write_char(b':')?;
                let vp = if !dest.vendor_prefix.is_empty() {
                    (dest.vendor_prefix & *prefix).or_none()
                } else {
                    *prefix
                };
                vp.to_css(dest)?;
                if vp.contains(VendorPrefix::WEBKIT) || vp.contains(VendorPrefix::MOZ) {
                    dest.write_str(b"full-screen")?;
                } else {
                    dest.write_str(b"fullscreen")?;
                }
            }

            // https://drafts.csswg.org/selectors/#display-state-pseudos
            PseudoClass::Open => dest.write_str(b":open")?,
            PseudoClass::Closed => dest.write_str(b":closed")?,
            PseudoClass::Modal => dest.write_str(b":modal")?,
            PseudoClass::PictureInPicture => dest.write_str(b":picture-in-picture")?,

            // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open
            PseudoClass::PopoverOpen => dest.write_str(b":popover-open")?,

            // https://drafts.csswg.org/selectors-4/#the-defined-pseudo
            PseudoClass::Defined => dest.write_str(b":defined")?,

            // https://drafts.csswg.org/selectors-4/#location
            PseudoClass::AnyLink(prefix) => write_prefixed(dest, *prefix, b"any-link")?,
            PseudoClass::Link => dest.write_str(b":link")?,
            PseudoClass::LocalLink => dest.write_str(b":local-link")?,
            PseudoClass::Target => dest.write_str(b":target")?,
            PseudoClass::TargetWithin => dest.write_str(b":target-within")?,
            PseudoClass::Visited => dest.write_str(b":visited")?,

            // https://drafts.csswg.org/selectors-4/#input-pseudos
            PseudoClass::Enabled => dest.write_str(b":enabled")?,
            PseudoClass::Disabled => dest.write_str(b":disabled")?,
            PseudoClass::ReadOnly(prefix) => write_prefixed(dest, *prefix, b"read-only")?,
            PseudoClass::ReadWrite(prefix) => write_prefixed(dest, *prefix, b"read-write")?,
            PseudoClass::PlaceholderShown(prefix) => write_prefixed(dest, *prefix, b"placeholder-shown")?,
            PseudoClass::Default => dest.write_str(b":default")?,
            PseudoClass::Checked => dest.write_str(b":checked")?,
            PseudoClass::Indeterminate => dest.write_str(b":indeterminate")?,
            PseudoClass::Blank => dest.write_str(b":blank")?,
            PseudoClass::Valid => dest.write_str(b":valid")?,
            PseudoClass::Invalid => dest.write_str(b":invalid")?,
            PseudoClass::InRange => dest.write_str(b":in-range")?,
            PseudoClass::OutOfRange => dest.write_str(b":out-of-range")?,
            PseudoClass::Required => dest.write_str(b":required")?,
            PseudoClass::Optional => dest.write_str(b":optional")?,
            PseudoClass::UserValid => dest.write_str(b":user-valid")?,
            PseudoClass::UserInvalid => dest.write_str(b":user-invalid")?,

            // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-autofill
            PseudoClass::Autofill(prefix) => write_prefixed(dest, *prefix, b"autofill")?,

            PseudoClass::Local(selector) => {
                serialize_selector(&selector.selector, dest, context, false)?
            }
            PseudoClass::Global(selector) => {
                let css_module = if let Some(module) = dest.css_module.take() {
                    Some(module)
                } else {
                    None
                };
                serialize_selector(&selector.selector, dest, context, false)?;
                dest.css_module = css_module;
            }

            // https://webkit.org/blog/363/styling-scrollbars/
            PseudoClass::WebkitScrollbar(s) => {
                use parser::WebkitScrollbarPseudoClass as S;
                dest.write_str(match s {
                    S::Horizontal => b":horizontal",
                    S::Vertical => b":vertical",
                    S::Decrement => b":decrement",
                    S::Increment => b":increment",
                    S::Start => b":start",
                    S::End => b":end",
                    S::DoubleButton => b":double-button",
                    S::SingleButton => b":single-button",
                    S::NoButton => b":no-button",
                    S::CornerPresent => b":corner-present",
                    S::WindowInactive => b":window-inactive",
                })?;
            }

            PseudoClass::Lang { .. } => unreachable!(),
            PseudoClass::Dir { .. } => unreachable!(),
            PseudoClass::Custom { name } => {
                dest.write_char(b':')?;
                return dest.write_str(name);
            }
            PseudoClass::CustomFunction(v) => {
                dest.write_char(b':')?;
                dest.write_str(&v.name)?;
                dest.write_char(b'(')?;
                v.arguments.to_css_raw(dest)?;
                dest.write_char(b')')?;
            }
        }
        Ok(())
    }

    pub fn serialize_pseudo_element(
        pseudo_element: &parser::PseudoElement,
        dest: &mut Printer,
        context: Option<&StyleContext>,
    ) -> Result<(), PrintErr> {
        fn write_prefix(d: &mut Printer, prefix: VendorPrefix) -> Result<VendorPrefix, PrintErr> {
            d.write_str(b"::")?;
            // If the printer has a vendor prefix override, use that.
            let vp = if !d.vendor_prefix.is_empty() {
                (d.vendor_prefix & prefix).or_none()
            } else {
                prefix
            };
            vp.to_css(d)?;
            bun_output::scoped_log!(
                CSS_SELECTORS,
                "VENDOR PREFIX {} OVERRIDE {}",
                vp.as_bits(),
                d.vendor_prefix.as_bits()
            );
            Ok(vp)
        }

        fn write_prefixed(d: &mut Printer, prefix: VendorPrefix, val: &'static [u8]) -> Result<(), PrintErr> {
            let _ = write_prefix(d, prefix)?;
            d.write_str(val)
        }

        // switch (pseudo_element.*) {
        //     // CSS2 pseudo elements support a single colon syntax in addition
        //     // to the more correct double colon for other pseudo elements.
        //     // We use that here because it's supported everywhere and is shorter.
        //     .after => try dest.writeStr(":after"),
        //     .before => try dest.writeStr(":before"),
        //     .marker => try dest.writeStr(":first-letter"),
        //     .selection => |prefix| Helpers.writePrefixed(dest, prefix, "selection"),
        //     .cue => dest.writeStr("::cue"),
        //     .cue_region => dest.writeStr("::cue-region"),
        //     .cue_function => |v| {
        //         dest.writeStr("::cue(");
        //         try serializeSelector(v.selector, dest, context, false);
        //         try dest.writeChar(')');
        //     },
        // }
        match pseudo_element {
            // CSS2 pseudo elements support a single colon syntax in addition
            // to the more correct double colon for other pseudo elements.
            // We use that here because it's supported everywhere and is shorter.
            PseudoElement::After => dest.write_str(b":after")?,
            PseudoElement::Before => dest.write_str(b":before")?,
            PseudoElement::FirstLine => dest.write_str(b":first-line")?,
            PseudoElement::FirstLetter => dest.write_str(b":first-letter")?,
            PseudoElement::Marker => dest.write_str(b"::marker")?,
            PseudoElement::Selection(prefix) => write_prefixed(dest, *prefix, b"selection")?,
            PseudoElement::Cue => dest.write_str(b"::cue")?,
            PseudoElement::CueRegion => dest.write_str(b"::cue-region")?,
            PseudoElement::CueFunction(v) => {
                dest.write_str(b"::cue(")?;
                serialize_selector(&v.selector, dest, context, false)?;
                dest.write_char(b')')?;
            }
            PseudoElement::CueRegionFunction(v) => {
                dest.write_str(b"::cue-region(")?;
                serialize_selector(&v.selector, dest, context, false)?;
                dest.write_char(b')')?;
            }
            PseudoElement::Placeholder(prefix) => {
                let vp = write_prefix(dest, *prefix)?;
                if vp.contains(VendorPrefix::WEBKIT) || vp.contains(VendorPrefix::MS) {
                    dest.write_str(b"input-placeholder")?;
                } else {
                    dest.write_str(b"placeholder")?;
                }
            }
            PseudoElement::Backdrop(prefix) => write_prefixed(dest, *prefix, b"backdrop")?,
            PseudoElement::FileSelectorButton(prefix) => {
                let vp = write_prefix(dest, *prefix)?;
                if vp.contains(VendorPrefix::WEBKIT) {
                    dest.write_str(b"file-upload-button")?;
                } else if vp.contains(VendorPrefix::MS) {
                    dest.write_str(b"browse")?;
                } else {
                    dest.write_str(b"file-selector-button")?;
                }
            }
            PseudoElement::WebkitScrollbar(s) => {
                use parser::WebkitScrollbarPseudoElement as S;
                dest.write_str(match s {
                    S::Scrollbar => b"::-webkit-scrollbar",
                    S::Button => b"::-webkit-scrollbar-button",
                    S::Track => b"::-webkit-scrollbar-track",
                    S::TrackPiece => b"::-webkit-scrollbar-track-piece",
                    S::Thumb => b"::-webkit-scrollbar-thumb",
                    S::Corner => b"::-webkit-scrollbar-corner",
                    S::Resizer => b"::-webkit-resizer",
                })?;
            }
            PseudoElement::ViewTransition => dest.write_str(b"::view-transition")?,
            PseudoElement::ViewTransitionGroup(v) => {
                dest.write_str(b"::view-transition-group(")?;
                v.part_name.to_css(dest)?;
                dest.write_char(b')')?;
            }
            PseudoElement::ViewTransitionImagePair(v) => {
                dest.write_str(b"::view-transition-image-pair(")?;
                v.part_name.to_css(dest)?;
                dest.write_char(b')')?;
            }
            PseudoElement::ViewTransitionOld(v) => {
                dest.write_str(b"::view-transition-old(")?;
                v.part_name.to_css(dest)?;
                dest.write_char(b')')?;
            }
            PseudoElement::ViewTransitionNew(v) => {
                dest.write_str(b"::view-transition-new(")?;
                v.part_name.to_css(dest)?;
                dest.write_char(b')')?;
            }
            PseudoElement::Custom { name } => {
                dest.write_str(b"::")?;
                return dest.write_str(name);
            }
            PseudoElement::CustomFunction(v) => {
                let name = &v.name;
                dest.write_str(b"::")?;
                dest.write_str(name)?;
                dest.write_char(b'(')?;
                v.arguments.to_css_raw(dest)?;
                dest.write_char(b')')?;
            }
        }
        Ok(())
    }

    pub fn serialize_nesting(
        dest: &mut Printer,
        context: Option<&StyleContext>,
        first: bool,
    ) -> Result<(), PrintErr> {
        if let Some(ctx) = context {
            // If there's only one simple selector, just serialize it directly.
            // Otherwise, use an :is() pseudo class.
            // Type selectors are only allowed at the start of a compound selector,
            // so use :is() if that is not the case.
            if ctx.selectors.v.len() == 1
                && (first
                    || (!has_type_selector(ctx.selectors.v.at(0)) && is_simple(ctx.selectors.v.at(0))))
            {
                serialize_selector(ctx.selectors.v.at(0), dest, ctx.parent, false)?;
            } else {
                dest.write_str(b":is(")?;
                serialize_selector_list(ctx.selectors.v.slice(), dest, ctx.parent, false)?;
                dest.write_char(b')')?;
            }
        } else {
            // If there is no context, we are at the root if nesting is supported. This is equivalent to :scope.
            // Otherwise, if nesting is supported, serialize the nesting selector directly.
            if dest.targets.should_compile_same(Feature::Nesting) {
                dest.write_str(b":scope")?;
            } else {
                dest.write_char(b'&')?;
            }
        }
        Ok(())
    }
}

pub mod tocss_servo {
    use super::*;

    pub fn to_css_selector_list(
        selectors: &[parser::Selector],
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        if selectors.is_empty() {
            return Ok(());
        }

        to_css_selector(&selectors[0], dest)?;

        if selectors.len() > 1 {
            for selector in &selectors[1..] {
                dest.write_str(b", ")?;
                to_css_selector(selector, dest)?;
            }
        }
        Ok(())
    }

    pub fn to_css_selector(
        selector: &parser::Selector,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        // Compound selectors invert the order of their contents, so we need to
        // undo that during serialization.
        //
        // This two-iterator strategy involves walking over the selector twice.
        // We could do something more clever, but selector serialization probably
        // isn't hot enough to justify it, and the stringification likely
        // dominates anyway.
        //
        // NB: A parse-order iterator is a Rev<>, which doesn't expose as_slice(),
        // which we need for |split|. So we split by combinators on a match-order
        // sequence and then reverse.
        let mut combinators = CombinatorIter { sel: selector, i: 0 };
        let mut compound_selectors = CompoundSelectorIter { sel: selector, i: 0 };

        let mut combinators_exhausted = false;
        while let Some(compound) = compound_selectors.next() {
            debug_assert!(!combinators_exhausted);

            // https://drafts.csswg.org/cssom/#serializing-selectors
            if compound.is_empty() {
                continue;
            }

            // 1. If there is only one simple selector in the compound selectors
            //    which is a universal selector, append the result of
            //    serializing the universal selector to s.
            //
            // Check if `!compound{}` first--this can happen if we have
            // something like `... > ::before`, because we store `>` and `::`
            // both as combinators internally.
            //
            // If we are in this case, after we have serialized the universal
            // selector, we skip Step 2 and continue with the algorithm.
            let (can_elide_namespace, first_non_namespace): (bool, usize) = if 0 >= compound.len() {
                (true, 0)
            } else {
                match compound[0] {
                    Component::ExplicitAnyNamespace
                    | Component::ExplicitNoNamespace
                    | Component::Namespace(_) => (false, 1),
                    Component::DefaultNamespace(_) => (true, 1),
                    _ => (true, 0),
                }
            };
            let mut perform_step_2 = true;
            let next_combinator = combinators.next();
            if first_non_namespace == compound.len() - 1 {
                // We have to be careful here, because if there is a
                // pseudo element "combinator" there isn't really just
                // the one simple selector. Technically this compound
                // selector contains the pseudo element selector as well
                // -- Combinator::PseudoElement, just like
                // Combinator::SlotAssignment, don't exist in the
                // spec.
                if next_combinator == Some(parser::Combinator::PseudoElement)
                    && compound[first_non_namespace].as_combinator()
                        == Some(parser::Combinator::SlotAssignment)
                {
                    // do nothing
                } else if matches!(compound[first_non_namespace], Component::ExplicitUniversalType) {
                    // Iterate over everything so we serialize the namespace
                    // too.
                    for simple in compound {
                        to_css_component(simple, dest)?;
                    }
                    // Skip step 2, which is an "otherwise".
                    perform_step_2 = false;
                } else {
                    // do nothing
                }
            }

            // 2. Otherwise, for each simple selector in the compound selectors
            //    that is not a universal selector of which the namespace prefix
            //    maps to a namespace that is not the default namespace
            //    serialize the simple selector and append the result to s.
            //
            // See https://github.com/w3c/csswg-drafts/issues/1606, which is
            // proposing to change this to match up with the behavior asserted
            // in cssom/serialize-namespaced-type-selectors.html, which the
            // following code tries to match.
            if perform_step_2 {
                for simple in compound {
                    if matches!(simple, Component::ExplicitUniversalType) {
                        // Can't have a namespace followed by a pseudo-element
                        // selector followed by a universal selector in the same
                        // compound selector, so we don't have to worry about the
                        // real namespace being in a different `compound`.
                        if can_elide_namespace {
                            continue;
                        }
                    }
                    to_css_component(simple, dest)?;
                }
            }

            // 3. If this is not the last part of the chain of the selector
            //    append a single SPACE (U+0020), followed by the combinator
            //    ">", "+", "~", ">>", "||", as appropriate, followed by another
            //    single SPACE (U+0020) if the combinator was not whitespace, to
            //    s.
            if let Some(c) = next_combinator {
                to_css_combinator(&c, dest)?;
            } else {
                combinators_exhausted = true;
            }

            // 4. If this is the last part of the chain of the selector and
            //    there is a pseudo-element, append "::" followed by the name of
            //    the pseudo-element, to s.
            //
            // (we handle this above)
        }
        Ok(())
    }

    pub fn to_css_component(
        component: &parser::Component,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        match component {
            Component::Combinator(c) => to_css_combinator(c, dest)?,
            Component::Slotted(selector) => {
                dest.write_str(b"::slotted(")?;
                to_css_selector(selector, dest)?;
                dest.write_char(b')')?;
            }
            Component::Part(part_names) => {
                dest.write_str(b"::part(")?;
                for (i, name) in part_names.iter().enumerate() {
                    if i != 0 {
                        dest.write_char(b' ')?;
                    }
                    css::IdentFns::to_css(name, dest)?;
                }
                dest.write_char(b')')?;
            }
            Component::PseudoElement(p) => {
                p.to_css(dest)?;
            }
            Component::Id(s) => {
                dest.write_char(b'#')?;
                let str = dest.lookup_ident_or_ref(*s);
                dest.write_str(str)?;
            }
            Component::Class(s) => {
                dest.write_char(b'.')?;
                let str = dest.lookup_ident_or_ref(*s);
                dest.write_str(str)?;
            }
            Component::LocalName(local_name) => {
                local_name.to_css(dest)?;
            }
            Component::ExplicitUniversalType => {
                dest.write_char(b'*')?;
            }
            Component::DefaultNamespace(_) => return Ok(()),

            Component::ExplicitNoNamespace => {
                dest.write_char(b'|')?;
            }
            Component::ExplicitAnyNamespace => {
                dest.write_str(b"*|")?;
            }
            Component::Namespace(ns) => {
                css::IdentFns::to_css(&ns.prefix, dest)?;
                dest.write_char(b'|')?;
            }
            Component::AttributeInNoNamespaceExists(v) => {
                dest.write_char(b'[')?;
                css::IdentFns::to_css(&v.local_name, dest)?;
                dest.write_char(b']')?;
            }
            Component::AttributeInNoNamespace(v) => {
                dest.write_char(b'[')?;
                css::IdentFns::to_css(&v.local_name, dest)?;
                v.operator.to_css(dest)?;
                CSSStringFns::to_css(&v.value, dest)?;
                match v.case_sensitivity {
                    parser::attrs::ParsedCaseSensitivity::CaseSensitive
                    | parser::attrs::ParsedCaseSensitivity::AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument => {}
                    parser::attrs::ParsedCaseSensitivity::AsciiCaseInsensitive => dest.write_str(b" i")?,
                    parser::attrs::ParsedCaseSensitivity::ExplicitCaseSensitive => dest.write_str(b" s")?,
                }
                dest.write_char(b']')?;
            }
            Component::AttributeOther(attr_selector) => {
                attr_selector.to_css(dest)?;
            }
            // Pseudo-classes
            Component::Root => {
                dest.write_str(b":root")?;
            }
            Component::Empty => {
                dest.write_str(b":empty")?;
            }
            Component::Scope => {
                dest.write_str(b":scope")?;
            }
            Component::Host(selector) => {
                dest.write_str(b":host")?;
                if let Some(sel) = selector {
                    dest.write_char(b'(')?;
                    to_css_selector(sel, dest)?;
                    dest.write_char(b')')?;
                }
            }
            Component::Nth(nth_data) => {
                nth_data.write_start(dest, nth_data.is_function())?;
                if nth_data.is_function() {
                    nth_data.write_affine(dest)?;
                    dest.write_char(b')')?;
                }
            }
            Component::NthOf(nth_of_data) => {
                let nth_data = nth_of_data.nth_data();
                nth_data.write_start(dest, true)?;
                // A selector must be a function to hold An+B notation
                debug_assert!(nth_data.is_function);
                nth_data.write_affine(dest)?;
                // Only :nth-child or :nth-last-child can be of a selector list
                debug_assert!(
                    nth_data.ty == parser::NthType::Child || nth_data.ty == parser::NthType::LastChild
                );
                // The selector list should not be empty
                debug_assert!(!nth_of_data.selectors.is_empty());
                dest.write_str(b" of ")?;
                to_css_selector_list(&nth_of_data.selectors, dest)?;
                dest.write_char(b')')?;
            }
            Component::Is(_)
            | Component::Where(_)
            | Component::Negation(_)
            | Component::Has(_)
            | Component::Any { .. } => {
                match component {
                    Component::Where(_) => dest.write_str(b":where(")?,
                    Component::Is(_) => dest.write_str(b":is(")?,
                    Component::Negation(_) => dest.write_str(b":not(")?,
                    Component::Has(_) => dest.write_str(b":has(")?,
                    Component::Any { vendor_prefix, .. } => {
                        dest.write_char(b':')?;
                        vendor_prefix.to_css(dest)?;
                        dest.write_str(b"any(")?;
                    }
                    _ => unreachable!(),
                }
                to_css_selector_list(
                    match component {
                        Component::Where(list)
                        | Component::Is(list)
                        | Component::Negation(list)
                        | Component::Has(list) => list,
                        Component::Any { selectors, .. } => selectors,
                        _ => unreachable!(),
                    },
                    dest,
                )?;
                dest.write_str(b")")?;
            }
            Component::NonTsPseudoClass(pseudo) => {
                pseudo.to_css(dest)?;
            }
            Component::Nesting => dest.write_char(b'&')?,
        }
        Ok(())
    }

    pub fn to_css_combinator(
        combinator: &parser::Combinator,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        match combinator {
            parser::Combinator::Child => dest.write_str(b" > ")?,
            parser::Combinator::Descendant => dest.write_str(b" ")?,
            parser::Combinator::NextSibling => dest.write_str(b" + ")?,
            parser::Combinator::LaterSibling => dest.write_str(b" ~ ")?,
            parser::Combinator::Deep => dest.write_str(b" /deep/ ")?,
            parser::Combinator::DeepDescendant => {
                dest.write_str(b" >>> ")?;
            }
            parser::Combinator::PseudoElement
            | parser::Combinator::Part
            | parser::Combinator::SlotAssignment => return Ok(()),
        }
        Ok(())
    }

    pub fn to_css_pseudo_element(
        pseudo_element: &parser::PseudoElement,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        match pseudo_element {
            PseudoElement::Before => dest.write_str(b"::before")?,
            PseudoElement::After => dest.write_str(b"::after")?,
            // TODO(port): Zig switch was non-exhaustive over a multi-variant enum (compiler bug or intentional?).
            _ => {}
        }
        Ok(())
    }
}

pub fn should_unwrap_is(selectors: &[parser::Selector]) -> bool {
    if selectors.len() == 1 {
        let first = &selectors[0];
        if !has_type_selector(first) && is_simple(first) {
            return true;
        }
    }

    false
}

fn has_type_selector(selector: &parser::Selector) -> bool {
    let mut iter = selector.iter_raw_match_order();
    let first = iter.next();

    if is_namespace(first.as_ref()) {
        return is_type_selector(iter.next().as_ref());
    }

    is_type_selector(first.as_ref())
}

fn is_namespace(component: Option<&parser::Component>) -> bool {
    if let Some(c) = component {
        return matches!(
            c,
            Component::ExplicitAnyNamespace
                | Component::ExplicitNoNamespace
                | Component::Namespace(_)
                | Component::DefaultNamespace(_)
        );
    }
    false
}

fn is_type_selector(component: Option<&parser::Component>) -> bool {
    if let Some(c) = component {
        return matches!(c, Component::LocalName(_) | Component::ExplicitUniversalType);
    }
    false
}

fn is_simple(selector: &parser::Selector) -> bool {
    let mut iter = selector.iter_raw_parse_order_from(0);
    let any_is_combinator = 'any_is_combinator: {
        while let Some(component) = iter.next() {
            if component.is_combinator() {
                break 'any_is_combinator true;
            }
        }
        break 'any_is_combinator false;
    };
    !any_is_combinator
}

pub struct CombinatorIter<'a> {
    pub sel: &'a parser::Selector,
    pub i: usize,
}

impl<'a> CombinatorIter<'a> {
    /// Original source has this iterator defined like so:
    /// ```rs
    /// selector
    ///   .iter_raw_match_order() // just returns an iterator
    ///   .rev() // reverses the iterator
    ///   .filter_map(|x| x.as_combinator()) // returns only entries which are combinators
    /// ```
    pub fn next(&mut self) -> Option<parser::Combinator> {
        while self.i < self.sel.components.len() {
            let idx = self.sel.components.len() - 1 - self.i;
            self.i += 1;
            let Some(combinator) = self.sel.components[idx].as_combinator() else {
                continue;
            };
            return Some(combinator);
        }
        None
    }
}

pub struct CompoundSelectorIter<'a> {
    pub sel: &'a parser::Selector,
    pub i: usize,
}

impl<'a> CompoundSelectorIter<'a> {
    /// This iterator is basically like doing `selector.components.splitByCombinator()`.
    ///
    /// For example:
    /// ```css
    /// div > p.class
    /// ```
    ///
    /// The iterator would return:
    /// ```
    /// First slice:
    /// .{
    ///   .{ .local_name = "div" }
    /// }
    ///
    /// Second slice:
    /// .{
    ///   .{ .local_name = "p" },
    ///   .{ .class = "class" }
    /// }
    /// ```
    ///
    /// BUT, the selectors are stored in reverse order, so this code needs to split the components backwards.
    ///
    /// Original source has this iterator defined like so:
    /// ```rs
    /// selector
    ///  .iter_raw_match_order()
    ///  .as_slice()
    ///  .split(|x| x.is_combinator()) // splits the slice into subslices by elements that match over the predicate
    ///  .rev() // reverse
    /// ```
    #[inline]
    pub fn next(&mut self) -> Option<&'a [parser::Component]> {
        // Since we iterating backwards, we convert all indices into "backwards form" by doing `self.sel.components.len() - 1 - i`
        let items = self.sel.components.as_slice();
        while self.i < items.len() {
            let next_index: Option<usize> = 'next_index: {
                for j in self.i..items.len() {
                    if items[items.len() - 1 - j].is_combinator() {
                        break 'next_index Some(j);
                    }
                }
                break 'next_index None;
            };
            if let Some(combinator_index) = next_index {
                let start = if combinator_index == 0 { 0 } else { combinator_index - 1 };
                let end = self.i;
                let slice = &items[items.len() - 1 - start..items.len() - end];
                self.i = combinator_index + 1;
                return Some(slice);
            }
            let slice = &items[0..items.len() - 1 - self.i + 1];
            self.i = items.len();
            return Some(slice);
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/selectors/selector.zig (1613 lines)
//   confidence: medium
//   todos:      10
//   notes:      Arena-backed (bumpalo) slice ownership for Component::Is/Negation payloads needs Phase B reconciliation; `r#impl` module name; Component/PseudoClass variant shapes guessed from Zig union arms.
// ──────────────────────────────────────────────────────────────────────────
