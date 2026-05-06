//! CSS selector parsing and serialization.
//!
//! Hub for `selector.rs` (high-level API + downleveling) / `parser.rs`
//! (Component / Selector / SelectorList grammar) / `builder.rs`.
//!
//! ─── B-2 round 4 status ──────────────────────────────────────────────────
//! Hub un-gated with **real-shaped data layer**: `SelectorImpl` trait,
//! `impl_::Selectors` marker, `GenericComponent`/`GenericSelector`/
//! `GenericSelectorList` (full variant set), `Combinator`, `Direction`,
//! `SpecificityAndFlags`, `SelectorFlags`, `NthSelectorData`,
//! `NthOfSelectorData`, `LocalName`, `attrs::*`. The concrete `Component`/
//! `Selector`/`SelectorList` aliases instantiate the generics over
//! `impl_::Selectors` so `rules::style`, `css_modules`, `context` and
//! `css_parser::AtRulePrelude` see the real layout.
//!
//! `PseudoClass` / `PseudoElement` remain `#[non_exhaustive]` empty enums:
//! their ~60 variants carry `Str` (arena-slice alias not yet at crate root)
//! and `properties::custom::TokenList` payloads.
//!
//! The three leaf files stay `#[cfg(any())]`-gated:
//!   parser.rs   — blocked_on `bun_css::{Str, CSSStringFns, IdentFns,
//!                 TokenList}` crate-root re-exports + `selector::serialize`
//!                 + `selector::tocss_servo` (cycle through selector.rs).
//!   selector.rs — blocked_on `css_parser::{CSSString, CSSStringFns,
//!                 SymbolList, StyleContext}` re-exports + parser grammar.
//!   builder.rs  — blocked_on parser.rs `compute_specificity` /
//!                 `ValidSelectorImpl` (real bodies).
//! When `parser.rs` un-gates, the inline `pub mod parser { .. }` below is
//! deleted and the gated `pub mod parser;` line takes over.

#[cfg(any())]
pub mod builder;
#[cfg(any())]
pub mod parser;
#[cfg(any())]
#[path = "selector.rs"]
pub mod selector;

#[cfg(not(any()))]
pub mod parser {
    use crate::css_values::ident::{Ident, IdentOrRef};
    use crate::{PrintErr, Printer, SmallList, VendorPrefix};
    use core::fmt;

    // ─── SelectorImpl trait (Zig: ValidSelectorImpl shape check) ──────────
    /// Associated-type bundle the generic selector grammar is parameterized
    /// over. Servo-style; one impl (`impl_::Selectors`) in this crate.
    // PORT NOTE: Zig validated this via `ValidSelectorImpl(T)` at comptime
    // (decl-resolution side effect). The Rust trait bound *is* the check.
    // Bounds kept loose (no `PartialEq + Clone`) until the leaf assoc types
    // (`Ident`/`IdentOrRef`/`CSSString`) gain those derives in values/.
    pub trait SelectorImpl: Sized {
        type ExtraMatchingData;
        type AttrValue;
        type Identifier;
        type LocalIdentifier;
        type LocalName;
        type NamespaceUrl;
        type NamespacePrefix;
        type BorrowedNamespaceUrl;
        type BorrowedLocalName;
        type NonTSPseudoClass;
        type VendorPrefix;
        type PseudoElement;
    }

    /// Compile-time check that `T` satisfies the `SelectorImpl` trait shape.
    pub fn valid_selector_impl<T: SelectorImpl>() {}

    /// The definition of whitespace per CSS Selectors Level 3 § 4.
    pub const SELECTOR_WHITESPACE: &[u8] = &[b' ', b'\t', b'\n', b'\r', 0x0C];

    // ─── attrs ────────────────────────────────────────────────────────────
    pub mod attrs {
        use super::*;

        pub struct NamespaceUrl<Impl: SelectorImpl> {
            pub prefix: Impl::NamespacePrefix,
            pub url: Impl::NamespaceUrl,
        }

        pub struct AttrSelectorWithOptionalNamespace<Impl: SelectorImpl> {
            pub namespace: Option<NamespaceConstraint<NamespaceUrl<Impl>>>,
            pub local_name: Impl::LocalName,
            pub local_name_lower: Impl::LocalName,
            pub operation: ParsedAttrSelectorOperation<Impl::AttrValue>,
            pub never_matches: bool,
        }

        pub enum NamespaceConstraint<NamespaceUrl> {
            Any,
            /// Empty string for no namespace
            Specific(NamespaceUrl),
        }

        pub enum ParsedAttrSelectorOperation<AttrValue> {
            Exists,
            WithValue {
                operator: AttrSelectorOperator,
                case_sensitivity: ParsedCaseSensitivity,
                expected_value: AttrValue,
            },
        }

        #[derive(Clone, Copy, PartialEq, Eq, Hash)]
        pub enum AttrSelectorOperator {
            Equal,
            Includes,
            DashMatch,
            Prefix,
            Substring,
            Suffix,
        }

        #[derive(Clone, Copy, PartialEq, Eq, Hash)]
        pub enum ParsedCaseSensitivity {
            CaseSensitive,
            AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument,
            AsciiCaseInsensitive,
            ExplicitCaseSensitive,
        }
    }

    // ─── Direction / Combinator / NthType ─────────────────────────────────

    /// The `:dir()` argument.
    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    pub enum Direction {
        /// Left to right
        Ltr,
        /// Right to left
        Rtl,
    }

    #[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
    pub enum Combinator {
        Child,        // >
        Descendant,   // space
        NextSibling,  // +
        LaterSibling, // ~
        /// A dummy combinator we use to the left of pseudo-elements.
        ///
        /// It serializes as the empty string, and acts effectively as a child
        /// combinator in most cases.  If we ever actually start using a child
        /// combinator for this, we will need to fix up the way hashes are computed
        /// for revalidation selectors.
        PseudoElement,
        /// Another combinator used for ::slotted(), which represent the jump from
        /// a node to its assigned slot.
        SlotAssignment,
        /// Another combinator used for `::part()`, which represents the jump from
        /// the part to the containing shadow host.
        Part,
        /// Non-standard Vue >>> combinator.
        /// https://vue-loader.vuejs.org/guide/scoped-css.html#deep-selectors
        DeepDescendant,
        /// Non-standard /deep/ combinator.
        /// Appeared in early versions of the css-scoping-1 specification:
        /// https://www.w3.org/TR/2014/WD-css-scoping-1-20140403/#deep-combinator
        /// And still supported as an alias for >>> by Vue.
        Deep,
    }

    impl Combinator {
        pub fn eql(&self, rhs: &Self) -> bool {
            *self == *rhs
        }
        pub fn is_tree_combinator(&self) -> bool {
            matches!(self, Self::Child | Self::Descendant | Self::NextSibling | Self::LaterSibling)
        }
    }

    impl fmt::Display for Combinator {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                Self::Child => write!(f, ">"),
                Self::Descendant => write!(f, "`descendant` (space)"),
                Self::NextSibling => write!(f, "+"),
                Self::LaterSibling => write!(f, "~"),
                other => write!(f, "{}", <&'static str>::from(*other)),
            }
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    pub enum NthType {
        Child,
        LastChild,
        OnlyChild,
        OfType,
        LastOfType,
        OnlyOfType,
        Col,
        LastCol,
    }

    impl NthType {
        pub fn is_of_type(&self) -> bool {
            matches!(self, Self::OfType | Self::LastOfType | Self::OnlyOfType)
        }
        pub fn is_only(&self) -> bool {
            matches!(self, Self::OnlyChild | Self::OnlyOfType)
        }
        pub fn is_from_end(&self) -> bool {
            matches!(self, Self::LastChild | Self::LastOfType | Self::LastCol)
        }
    }

    /// The properties that comprise an :nth- pseudoclass as of Selectors 3 (e.g.,
    /// nth-child(An+B)).
    /// https://www.w3.org/TR/selectors-3/#nth-child-pseudo
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct NthSelectorData {
        pub ty: NthType,
        pub is_function: bool,
        pub a: i32,
        pub b: i32,
    }

    impl NthSelectorData {
        /// Returns selector data for :only-{child,of-type}
        pub fn only(of_type: bool) -> NthSelectorData {
            NthSelectorData {
                ty: if of_type { NthType::OnlyOfType } else { NthType::OnlyChild },
                is_function: false,
                a: 0,
                b: 1,
            }
        }
        /// Returns selector data for :first-{child,of-type}
        pub fn first(of_type: bool) -> NthSelectorData {
            NthSelectorData {
                ty: if of_type { NthType::OfType } else { NthType::Child },
                is_function: false,
                a: 0,
                b: 1,
            }
        }
        /// Returns selector data for :last-{child,of-type}
        pub fn last(of_type: bool) -> NthSelectorData {
            NthSelectorData {
                ty: if of_type { NthType::LastOfType } else { NthType::LastChild },
                is_function: false,
                a: 0,
                b: 1,
            }
        }
        pub fn is_function_(&self) -> bool {
            self.a != 0 || self.b != 1
        }
        fn number_sign(num: i32) -> &'static str {
            if num >= 0 { "+" } else { "" }
        }
        pub fn write_start(&self, dest: &mut Printer, is_function: bool) -> Result<(), PrintErr> {
            dest.write_str(match self.ty {
                NthType::Child => if is_function { ":nth-child(" } else { ":first-child" },
                NthType::LastChild => if is_function { ":nth-last-child(" } else { ":last-child" },
                NthType::OfType => if is_function { ":nth-of-type(" } else { ":first-of-type" },
                NthType::LastOfType => if is_function { ":nth-last-of-type(" } else { ":last-of-type" },
                NthType::OnlyChild => ":only-child",
                NthType::OnlyOfType => ":only-of-type",
                NthType::Col => ":nth-col(",
                NthType::LastCol => ":nth-last-col(",
            })
        }
        pub fn write_affine(&self, dest: &mut Printer) -> Result<(), PrintErr> {
            // PERF: this could be made faster
            if self.a == 0 && self.b == 0 {
                dest.write_char(b'0')
            } else if self.a == 1 && self.b == 0 {
                dest.write_char(b'n')
            } else if self.a == -1 && self.b == 0 {
                dest.write_str("-n")
            } else if self.b == 0 {
                dest.write_fmt(format_args!("{}n", self.a))
            } else if self.a == 2 && self.b == 1 {
                dest.write_str("odd")
            } else if self.a == 0 {
                dest.write_fmt(format_args!("{}", self.b))
            } else if self.a == 1 {
                dest.write_fmt(format_args!("n{}{}", Self::number_sign(self.b), self.b))
            } else if self.a == -1 {
                dest.write_fmt(format_args!("-n{}{}", Self::number_sign(self.b), self.b))
            } else {
                dest.write_fmt(format_args!("{}n{}{}", self.a, Self::number_sign(self.b), self.b))
            }
        }
    }

    /// The properties that comprise an :nth- pseudoclass as of Selectors 4 (e.g.,
    /// nth-child(An+B [of S]?)).
    /// https://www.w3.org/TR/selectors-4/#nth-child-pseudo
    pub struct NthOfSelectorData<Impl: SelectorImpl> {
        pub data: NthSelectorData,
        pub selectors: Box<[GenericSelector<Impl>]>,
    }

    impl<Impl: SelectorImpl> NthOfSelectorData<Impl> {
        pub fn nth_data(&self) -> NthSelectorData {
            self.data
        }
    }

    pub struct LocalName<Impl: SelectorImpl> {
        pub name: Impl::LocalName,
        pub lower_name: Impl::LocalName,
    }

    // ─── Specificity / flags ──────────────────────────────────────────────

    bitflags::bitflags! {
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub struct SelectorFlags: u8 {
            const HAS_PSEUDO = 1 << 0;
            const HAS_SLOTTED = 1 << 1;
            const HAS_PART = 1 << 2;
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct SpecificityAndFlags {
        /// There are two free bits here, since we use ten bits for each specificity
        /// kind (id, class, element).
        pub specificity: u32,
        /// There's padding after this field due to the size of the flags.
        pub flags: SelectorFlags,
    }

    impl SpecificityAndFlags {
        pub fn has_pseudo_element(&self) -> bool {
            self.flags.contains(SelectorFlags::HAS_PSEUDO)
        }
    }

    /// How to treat invalid selectors in a selector list.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum ParseErrorRecovery {
        /// Discard the entire selector list, this is the default behavior for
        /// almost all of CSS.
        DiscardList,
        /// Ignore invalid selectors, potentially creating an empty selector list.
        ///
        /// This is the error recovery mode of :is() and :where()
        IgnoreInvalidSelector,
    }
    /// Legacy spelling — `parser.rs` uses `ParseErrorRecovery`, callers in
    /// `css_parser.rs` spell it `ErrorRecovery`.
    pub use ParseErrorRecovery as ErrorRecovery;

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum NestingRequirement {
        None,
        Prefixed,
        Contained,
        Implicit,
    }

    // ─── PseudoClass / PseudoElement ──────────────────────────────────────
    // blocked_on: `Str` arena-slice alias + `properties::custom::TokenList`
    // (real). The full variant set (~60) lives in the gated parser.rs and
    // re-widens on un-gate.

    /// Non-tree-structural pseudo-class (e.g. `:hover`, `:dir(ltr)`).
    #[non_exhaustive]
    pub enum PseudoClass {}

    /// Pseudo-element (e.g. `::before`, `::placeholder`).
    #[non_exhaustive]
    pub enum PseudoElement {}

    /// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo class.
    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    #[non_exhaustive]
    pub enum WebKitScrollbarPseudoClass {}

    /// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo element.
    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    #[non_exhaustive]
    pub enum WebKitScrollbarPseudoElement {}

    // ─── GenericComponent / GenericSelector / GenericSelectorList ─────────

    /// A CSS simple selector or combinator. We store both in the same enum for
    /// optimal packing and cache performance, see [1].
    ///
    /// [1] https://bugzilla.mozilla.org/show_bug.cgi?id=1357973
    pub enum GenericComponent<Impl: SelectorImpl> {
        Combinator(Combinator),

        ExplicitAnyNamespace,
        ExplicitNoNamespace,
        DefaultNamespace(Impl::NamespaceUrl),
        Namespace { prefix: Impl::NamespacePrefix, url: Impl::NamespaceUrl },

        ExplicitUniversalType,
        LocalName(LocalName<Impl>),

        Id(Impl::LocalIdentifier),
        Class(Impl::LocalIdentifier),

        AttributeInNoNamespaceExists {
            local_name: Impl::LocalName,
            local_name_lower: Impl::LocalName,
        },
        /// Used only when local_name is already lowercase.
        AttributeInNoNamespace {
            local_name: Impl::LocalName,
            operator: attrs::AttrSelectorOperator,
            value: Impl::AttrValue,
            case_sensitivity: attrs::ParsedCaseSensitivity,
            never_matches: bool,
        },
        /// Use a Box in the less common cases with more data to keep size_of::<Component>() small.
        AttributeOther(Box<attrs::AttrSelectorWithOptionalNamespace<Impl>>),

        /// Pseudo-classes
        Negation(Box<[GenericSelector<Impl>]>),
        Root,
        Empty,
        Scope,
        Nth(NthSelectorData),
        NthOf(NthOfSelectorData<Impl>),
        NonTsPseudoClass(Impl::NonTSPseudoClass),
        /// The ::slotted() pseudo-element:
        ///
        /// https://drafts.csswg.org/css-scoping/#slotted-pseudo
        ///
        /// The selector here is a compound selector, that is, no combinators.
        ///
        /// NOTE(emilio): This should support a list of selectors, but as of this
        /// writing no other browser does, and that allows them to put ::slotted()
        /// in the rule hash, so we do that too.
        ///
        /// See https://github.com/w3c/csswg-drafts/issues/2158
        Slotted(GenericSelector<Impl>),
        /// The `::part` pseudo-element.
        ///   https://drafts.csswg.org/css-shadow-parts/#part
        Part(Box<[Impl::Identifier]>),
        /// The `:host` pseudo-class:
        ///
        /// https://drafts.csswg.org/css-scoping/#host-selector
        ///
        /// NOTE(emilio): This should support a list of selectors, but as of this
        /// writing no other browser does, and that allows them to put :host()
        /// in the rule hash, so we do that too.
        ///
        /// See https://github.com/w3c/csswg-drafts/issues/2158
        Host(Option<GenericSelector<Impl>>),
        /// The `:where` pseudo-class.
        ///
        /// https://drafts.csswg.org/selectors/#zero-matches
        ///
        /// The inner argument is conceptually a SelectorList, but we move the
        /// selectors to the heap to keep Component small.
        Where(Box<[GenericSelector<Impl>]>),
        /// The `:is` pseudo-class.
        ///
        /// https://drafts.csswg.org/selectors/#matches-pseudo
        ///
        /// Same comment as above re. the argument.
        Is(Box<[GenericSelector<Impl>]>),
        Any { vendor_prefix: Impl::VendorPrefix, selectors: Box<[GenericSelector<Impl>]> },
        /// The `:has` pseudo-class.
        ///
        /// https://www.w3.org/TR/selectors/#relational
        Has(Box<[GenericSelector<Impl>]>),
        /// An implementation-dependent pseudo-element selector.
        PseudoElement(Impl::PseudoElement),
        /// A nesting selector:
        ///
        /// https://drafts.csswg.org/css-nesting-1/#nest-selector
        ///
        /// NOTE: This is a lightningcss addition.
        Nesting,
    }

    impl<Impl: SelectorImpl> GenericComponent<Impl> {
        /// If css modules is enabled these will be locally scoped
        pub fn is_locally_scoped(&self) -> bool {
            matches!(self, Self::Id(_) | Self::Class(_))
        }
        pub fn is_combinator(&self) -> bool {
            matches!(self, Self::Combinator(_))
        }
        pub fn as_combinator(&self) -> Option<Combinator> {
            match self {
                Self::Combinator(c) => Some(*c),
                _ => None,
            }
        }
    }

    /// A single compound selector (sequence of `Component`s with combinators).
    ///
    /// We store compound selectors internally right-to-left (in matching order).
    /// Additionally, we invert the order of top-level compound selectors so that
    /// each one matches left-to-right. This is because matching namespace, local
    /// name, id, class are all relatively cheap, whereas matching pseudo-classes
    /// might be expensive (depending on the pseudo-class). Since authors tend to
    /// put the pseudo-classes on the right, it's faster to start matching on the
    /// left.
    ///
    /// This reordering doesn't change the semantics of selector matching, and we
    /// handle it in to_css to make it invisible to serialization.
    pub struct GenericSelector<Impl: SelectorImpl> {
        pub specificity_and_flags: SpecificityAndFlags,
        pub components: Vec<GenericComponent<Impl>>,
        // PERF(port): was arena ArrayList — profile in Phase B
    }

    impl<Impl: SelectorImpl> GenericSelector<Impl> {
        #[inline]
        pub fn len(&self) -> usize {
            self.components.len()
        }
        #[inline]
        pub fn specificity(&self) -> u32 {
            self.specificity_and_flags.specificity
        }
        #[inline]
        pub fn has_pseudo_element(&self) -> bool {
            self.specificity_and_flags.has_pseudo_element()
        }
        pub fn has_combinator(&self) -> bool {
            for c in &self.components {
                if let GenericComponent::Combinator(co) = c {
                    if co.is_tree_combinator() {
                        return true;
                    }
                }
            }
            false
        }
    }

    /// A parsed CSS selector list (comma-separated compound selectors).
    pub struct GenericSelectorList<Impl: SelectorImpl> {
        // PERF: make this equivalent to SmallVec<[Selector; 1]>
        pub v: SmallList<GenericSelector<Impl>, 1>,
    }

    impl<Impl: SelectorImpl> Default for GenericSelectorList<Impl> {
        fn default() -> Self {
            Self { v: SmallList::default() }
        }
    }

    impl<Impl: SelectorImpl> GenericSelectorList<Impl> {
        pub fn any_has_pseudo_element(&self) -> bool {
            for sel in self.v.slice() {
                if sel.has_pseudo_element() {
                    return true;
                }
            }
            false
        }
    }

    // ─── Concrete instantiation ───────────────────────────────────────────
    /// Our implementation of the `SelectorImpl` interface — moved here from
    /// `selector.rs` so the concrete `Component`/`Selector`/`SelectorList`
    /// aliases resolve without the parser↔selector cycle.
    pub mod impl_ {
        use super::*;

        /// Marker type carrying the associated-type bundle for Bun's selector
        /// grammar.
        pub struct Selectors;

        impl SelectorImpl for Selectors {
            type ExtraMatchingData = ();
            type AttrValue = &'static [u8]; // values::string::CSSString
            type Identifier = Ident;
            /// An identifier which could be a local name for use in CSS modules
            type LocalIdentifier = IdentOrRef;
            type LocalName = Ident;
            type NamespacePrefix = Ident;
            // TODO(port): lifetime — Zig `[]const u8` type alias borrowing input.
            type NamespaceUrl = &'static [u8];
            type BorrowedNamespaceUrl = &'static [u8];
            type BorrowedLocalName = Ident;
            type NonTSPseudoClass = PseudoClass;
            type PseudoElement = PseudoElement;
            type VendorPrefix = VendorPrefix;
        }

        pub mod local_identifier {
            use super::*;
            pub fn from_ident(ident: Ident) -> IdentOrRef {
                IdentOrRef::from_ident(ident)
            }
        }
    }

    /// Instantiation of generic selector structs using our `SelectorImpl`.
    pub type Component = GenericComponent<impl_::Selectors>;
    pub type Selector = GenericSelector<impl_::Selectors>;
    pub type SelectorList = GenericSelectorList<impl_::Selectors>;
}

#[cfg(not(any()))]
pub mod selector {
    //! High-level selector API (downleveling / prefix detection / serialize).
    //! Real body in `selector.rs` (gated). This re-exports the data layer
    //! from the inline `parser` module so `crate::selector::parser::*` and
    //! `crate::selector::{Selector,SelectorList,Component,...}` resolve.
    pub use super::parser;
    pub use super::parser::{
        impl_, Combinator, Component, Direction, PseudoClass, PseudoElement, Selector,
        SelectorList,
    };
    /// Legacy raw-ident spelling.
    pub use impl_ as r#impl;

    /// Selector serializer namespace. Real body (`serialize_selector_list`,
    /// `serialize_selector`, `serialize_combinator`) lives in the gated
    /// `selector.rs::serialize` module and depends on `IdentFns`/`CSSStringFns`.
    pub mod serialize {}
    /// Servo-compat serializer (`to_css_selector`, `to_css_component`).
    pub mod tocss_servo {}
}

#[cfg(not(any()))]
pub mod builder {}

pub use parser::{Component, PseudoClass, PseudoElement, Selector, SelectorList};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/selectors/ (selector.zig + parser.zig + builder.zig)
//   confidence: medium
//   todos:      0
//   notes:      hub un-gated with real-shaped data layer (SelectorImpl trait + impl_::Selectors marker, full GenericComponent variant set, Combinator/Direction/Nth*/SpecificityAndFlags/attrs); SelectorList.v is SmallList<Selector,1> matching parser.rs; PseudoClass/PseudoElement remain #[non_exhaustive] empties (blocked on Str/TokenList); parser.rs/selector.rs/builder.rs leaf files gated on bun_css::{Str,IdentFns,CSSStringFns,TokenList} crate-root re-exports
// ──────────────────────────────────────────────────────────────────────────
