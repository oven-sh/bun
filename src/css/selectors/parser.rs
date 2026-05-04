//! CSS selector parser — ported from `src/css/selectors/parser.zig`.
//! Originally derived from servo/lightningcss selector parsing.

use core::fmt;

use bun_css as css;
use bun_css::css_values::ident::{CustomIdent, Ident};
use bun_css::selector::impl_ as impl_;
use bun_css::selector::serialize;
use bun_css::{CSSStringFns, IdentFns, Parser as CssParser, ParserOptions, PrintErr, Printer, SmallList, Token, TokenList};
use bun_str::strings;
use bun_wyhash::Wyhash;

use super::builder as selector_builder;
use super::builder::SelectorBuilder;

pub use bun_css::Printer as PrinterRe; // re-export parity (Printer/PrintErr were `pub const` aliases)

/// `css::Result<T>` — the CSS parser result type (`Ok(T)` / `Err(css::ParseError)`).
type CResult<T> = css::Result<T>;

// TODO(port): arena lifetimes. The Zig code threads `parser.allocator` / `input.allocator()`
// (a bump arena) through every allocation. Phase A uses `Vec`/`Box` and a `Str` alias for
// source-borrowed byte slices; Phase B should re-thread `'bump` and switch to
// `bumpalo::collections::Vec<'bump, T>` / `&'bump [u8]` per PORTING.md §Allocators (AST crates).
// PERF(port): was arena bulk-free — profile in Phase B.
type Str = css::Str; // arena-backed `[]const u8` source slice; defined by the css crate

/// Instantiation of generic selector structs using our implementation of the `SelectorImpl` trait.
pub type Component = GenericComponent<impl_::Selectors>;
pub type Selector = GenericSelector<impl_::Selectors>;
pub type SelectorList = GenericSelectorList<impl_::Selectors>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ToCssCtx {
    Lightning,
    Servo,
}

/// The definition of whitespace per CSS Selectors Level 3 § 4.
pub const SELECTOR_WHITESPACE: &[u8] = &[b' ', b'\t', b'\n', b'\r', 0x0C];

/// Compile-time check that `T` satisfies the `SelectorImpl` trait shape.
/// In Rust this is expressed as a trait bound; this fn is kept for diff parity.
pub fn valid_selector_impl<T: SelectorImpl>() {
    // Zig used `_ = T.SelectorImpl.X;` to force decl resolution; in Rust the trait
    // bound `T: SelectorImpl` is the check.
}

/// The `SelectorImpl` shape (Zig validated via `ValidSelectorImpl`). Phase B: this trait
/// lives in `bun_css::selector::impl_` and is implemented by `impl_::Selectors`.
pub trait SelectorImpl: Sized {
    type ExtraMatchingData;
    type AttrValue: PartialEq + Clone;
    type Identifier: PartialEq + Clone;
    type LocalIdentifier: PartialEq + Clone;
    type LocalName: PartialEq + Clone;
    type NamespaceUrl: PartialEq + Clone;
    type NamespacePrefix: PartialEq + Clone;
    type BorrowedNamespaceUrl;
    type BorrowedLocalName;
    type NonTSPseudoClass: PartialEq + Clone;
    type VendorPrefix: PartialEq + Clone;
    type PseudoElement: PartialEq + Clone;
}

// ─────────────────────────────────────────────────────────────────────────────
// attrs
// ─────────────────────────────────────────────────────────────────────────────
pub mod attrs {
    use super::*;

    #[derive(Clone, PartialEq, Eq)]
    pub struct NamespaceUrl<Impl: SelectorImpl> {
        pub prefix: Impl::NamespacePrefix,
        pub url: Impl::NamespaceUrl,
    }

    impl<Impl: SelectorImpl> NamespaceUrl<Impl> {
        pub fn eql(&self, rhs: &Self) -> bool {
            css::implement_eql(self, rhs)
        }
        pub fn deep_clone(&self) -> Self {
            css::implement_deep_clone(self)
        }
        pub fn hash(&self, hasher: &mut Wyhash) {
            css::implement_hash(self, hasher)
        }
    }

    #[derive(Clone, PartialEq)]
    pub struct AttrSelectorWithOptionalNamespace<Impl: SelectorImpl> {
        pub namespace: Option<NamespaceConstraint<NamespaceUrl<Impl>>>,
        pub local_name: Impl::LocalName,
        pub local_name_lower: Impl::LocalName,
        pub operation: ParsedAttrSelectorOperation<Impl::AttrValue>,
        pub never_matches: bool,
    }

    impl<Impl: SelectorImpl> AttrSelectorWithOptionalNamespace<Impl> {
        pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
            dest.write_char('[')?;
            if let Some(nsp) = &self.namespace {
                match nsp {
                    NamespaceConstraint::Specific(v) => {
                        IdentFns::to_css(&v.prefix, dest)?;
                        dest.write_char('|')?;
                    }
                    NamespaceConstraint::Any => {
                        dest.write_str("*|")?;
                    }
                }
            }
            IdentFns::to_css(&self.local_name, dest)?;
            match &self.operation {
                ParsedAttrSelectorOperation::Exists => {}
                ParsedAttrSelectorOperation::WithValue { operator, case_sensitivity, expected_value } => {
                    operator.to_css(dest)?;
                    // try v.expected_value.toCss(dest);
                    CSSStringFns::to_css(expected_value, dest)?;
                    match case_sensitivity {
                        ParsedCaseSensitivity::CaseSensitive
                        | ParsedCaseSensitivity::AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument => {}
                        ParsedCaseSensitivity::AsciiCaseInsensitive => {
                            dest.write_str(" i")?;
                        }
                        ParsedCaseSensitivity::ExplicitCaseSensitive => {
                            dest.write_str(" s")?;
                        }
                    }
                }
            }
            dest.write_char(']')
        }

        pub fn eql(&self, rhs: &Self) -> bool {
            css::implement_eql(self, rhs)
        }
        pub fn deep_clone(&self) -> Self {
            css::implement_deep_clone(self)
        }
        pub fn hash(&self, hasher: &mut Wyhash) {
            css::implement_hash(self, hasher)
        }
    }

    #[derive(Clone, PartialEq, Eq)]
    pub enum NamespaceConstraint<NamespaceUrl> {
        Any,
        /// Empty string for no namespace
        Specific(NamespaceUrl),
    }

    impl<N: PartialEq + Clone> NamespaceConstraint<N> {
        pub fn eql(&self, rhs: &Self) -> bool {
            css::implement_eql(self, rhs)
        }
        pub fn hash(&self, hasher: &mut Wyhash) {
            css::implement_hash(self, hasher)
        }
        pub fn deep_clone(&self) -> Self {
            css::implement_deep_clone(self)
        }
    }

    #[derive(Clone, PartialEq)]
    pub enum ParsedAttrSelectorOperation<AttrValue> {
        Exists,
        WithValue {
            operator: AttrSelectorOperator,
            case_sensitivity: ParsedCaseSensitivity,
            expected_value: AttrValue,
        },
    }

    impl<A: PartialEq + Clone> ParsedAttrSelectorOperation<A> {
        pub fn deep_clone(&self) -> Self {
            css::implement_deep_clone(self)
        }
        pub fn eql(&self, rhs: &Self) -> bool {
            css::implement_eql(self, rhs)
        }
        pub fn hash(&self, hasher: &mut Wyhash) {
            css::implement_hash(self, hasher)
        }
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

    impl AttrSelectorOperator {
        pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
            // https://drafts.csswg.org/cssom/#serializing-selectors
            // See "attribute selector".
            dest.write_str(match self {
                Self::Equal => "=",
                Self::Includes => "~=",
                Self::DashMatch => "|=",
                Self::Prefix => "^=",
                Self::Substring => "*=",
                Self::Suffix => "$=",
            })
        }

        pub fn hash(&self, hasher: &mut Wyhash) {
            css::implement_hash(self, hasher)
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    pub enum AttrSelectorOperation {
        Equal,
        Includes,
        DashMatch,
        Prefix,
        Substring,
        Suffix,
    }

    #[derive(Clone, Copy, PartialEq, Eq, Hash)]
    pub enum ParsedCaseSensitivity {
        // 's' was specified.
        ExplicitCaseSensitive,
        // 'i' was specified.
        AsciiCaseInsensitive,
        // No flags were specified and HTML says this is a case-sensitive attribute.
        CaseSensitive,
        // No flags were specified and HTML says this is a case-insensitive attribute.
        AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Specificity
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Specificity {
    pub id_selectors: u32,
    pub class_like_selectors: u32,
    pub element_selectors: u32,
}

impl Specificity {
    const MAX_10BIT: u32 = (1 << 10) - 1;

    pub fn to_u32(self) -> u32 {
        (self.id_selectors.min(Self::MAX_10BIT) << 20)
            | (self.class_like_selectors.min(Self::MAX_10BIT) << 10)
            | self.element_selectors.min(Self::MAX_10BIT)
    }

    pub fn from_u32(value: u32) -> Specificity {
        debug_assert!(value <= (Self::MAX_10BIT << 20 | Self::MAX_10BIT << 10 | Self::MAX_10BIT));
        Specificity {
            id_selectors: value >> 20,
            class_like_selectors: (value >> 10) & Self::MAX_10BIT,
            element_selectors: value & Self::MAX_10BIT,
        }
    }

    pub fn add(&mut self, rhs: Specificity) {
        self.id_selectors += rhs.id_selectors;
        self.element_selectors += rhs.element_selectors;
        self.class_like_selectors += rhs.class_like_selectors;
    }
}

pub fn compute_specificity<Impl: SelectorImpl>(iter: &[GenericComponent<Impl>]) -> u32 {
    let spec = compute_complex_selector_specificity::<Impl>(iter);
    spec.to_u32()
}

fn compute_complex_selector_specificity<Impl: SelectorImpl>(iter: &[GenericComponent<Impl>]) -> Specificity {
    let mut specificity = Specificity::default();
    for simple_selector in iter {
        compute_simple_selector_specificity::<Impl>(simple_selector, &mut specificity);
    }
    specificity
}

fn compute_simple_selector_specificity<Impl: SelectorImpl>(
    simple_selector: &GenericComponent<Impl>,
    specificity: &mut Specificity,
) {
    use GenericComponent as C;
    match simple_selector {
        C::Combinator(_) => {
            unreachable!("Found combinator in simple selectors vector?");
        }
        C::Part(_) | C::PseudoElement(_) | C::LocalName(_) => {
            specificity.element_selectors += 1;
        }
        C::Slotted(selector) => {
            specificity.element_selectors += 1;
            // Note that due to the way ::slotted works we only compete with
            // other ::slotted rules, so the above rule doesn't really
            // matter, but we do it still for consistency with other
            // pseudo-elements.
            //
            // See: https://github.com/w3c/csswg-drafts/issues/1915
            specificity.add(Specificity::from_u32(selector.specificity()));
        }
        C::Host(maybe_selector) => {
            specificity.class_like_selectors += 1;
            if let Some(selector) = maybe_selector {
                // See: https://github.com/w3c/csswg-drafts/issues/1915
                specificity.add(Specificity::from_u32(selector.specificity()));
            }
        }
        C::Id(_) => {
            specificity.id_selectors += 1;
        }
        C::Class(_)
        | C::AttributeInNoNamespace { .. }
        | C::AttributeInNoNamespaceExists { .. }
        | C::AttributeOther(_)
        | C::Root
        | C::Empty
        | C::Scope
        | C::Nth(_)
        | C::NonTsPseudoClass(_) => {
            specificity.class_like_selectors += 1;
        }
        C::NthOf(nth_of_data) => {
            // https://drafts.csswg.org/selectors/#specificity-rules:
            //
            //     The specificity of the :nth-last-child() pseudo-class,
            //     like the :nth-child() pseudo-class, combines the
            //     specificity of a regular pseudo-class with that of its
            //     selector argument S.
            specificity.class_like_selectors += 1;
            let mut max: u32 = 0;
            for selector in nth_of_data.selectors.iter() {
                max = selector.specificity().max(max);
            }
            specificity.add(Specificity::from_u32(max));
        }
        C::Negation(_) | C::Is(_) | C::Any { .. } => {
            // https://drafts.csswg.org/selectors/#specificity-rules:
            //
            //     The specificity of an :is() pseudo-class is replaced by the
            //     specificity of the most specific complex selector in its
            //     selector list argument.
            let list: &[GenericSelector<Impl>] = match simple_selector {
                C::Negation(list) => list,
                C::Is(list) => list,
                C::Any { selectors, .. } => selectors,
                _ => unreachable!(),
            };
            let mut max: u32 = 0;
            for selector in list {
                max = selector.specificity().max(max);
            }
            specificity.add(Specificity::from_u32(max));
        }
        C::Where(_)
        | C::Has(_)
        | C::ExplicitUniversalType
        | C::ExplicitAnyNamespace
        | C::ExplicitNoNamespace
        | C::DefaultNamespace(_)
        | C::Namespace { .. } => {
            // Does not affect specificity
        }
        C::Nesting => {
            // TODO
        }
    }
}

/// Build up a Selector.
/// selector : simple_selector_sequence [ combinator simple_selector_sequence ]* ;
///
/// `Err` means invalid selector.
fn parse_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
    nesting_requirement: NestingRequirement,
) -> CResult<GenericSelector<Impl>> {
    if nesting_requirement == NestingRequirement::Prefixed {
        let parser_state = input.state();
        if !input.expect_delim('&').is_ok() {
            return Err(input.new_custom_error(
                SelectorParseErrorKind::MissingNestingPrefix.into_default_parser_error(),
            ));
        }
        input.reset(&parser_state);
    }

    // PERF: allocations here
    // PERF(port): was arena-backed SelectorBuilder — profile in Phase B
    let mut builder = SelectorBuilder::<Impl>::default();

    'outer_loop: loop {
        // Parse a sequence of simple selectors.
        let empty = parse_compound_selector::<Impl>(parser, state, input, &mut builder)?;
        if empty {
            let kind: SelectorParseErrorKind = if builder.has_combinators() {
                SelectorParseErrorKind::DanglingCombinator
            } else {
                SelectorParseErrorKind::EmptySelector
            };
            return Err(input.new_custom_error(kind.into_default_parser_error()));
        }

        if state.after_any_pseudo() {
            let source_location = input.current_source_location();
            if let Ok(next) = input.next() {
                return Err(source_location.new_custom_error(
                    SelectorParseErrorKind::UnexpectedSelectorAfterPseudoElement(next.clone())
                        .into_default_parser_error(),
                ));
            }
            break;
        }

        // Parse a combinator
        let combinator: Combinator;
        let mut any_whitespace = false;
        loop {
            let before_this_token = input.state();
            let tok: &Token = match input.next_including_whitespace() {
                Ok(vv) => vv,
                Err(_) => break 'outer_loop,
            };
            match tok {
                Token::Whitespace => {
                    any_whitespace = true;
                    continue;
                }
                Token::Delim(d) => match *d {
                    '>' => {
                        if parser.deep_combinator_enabled()
                            && input
                                .try_parse(|i: &mut CssParser| -> CResult<()> {
                                    i.expect_delim('>')?;
                                    i.expect_delim('>')
                                })
                                .is_ok()
                        {
                            combinator = Combinator::DeepDescendant;
                        } else {
                            combinator = Combinator::Child;
                        }
                        break;
                    }
                    '+' => {
                        combinator = Combinator::NextSibling;
                        break;
                    }
                    '~' => {
                        combinator = Combinator::LaterSibling;
                        break;
                    }
                    '/' => {
                        if parser.deep_combinator_enabled() {
                            if input
                                .try_parse(|i: &mut CssParser| -> CResult<()> {
                                    i.expect_ident_matching("deep")?;
                                    i.expect_delim('/')
                                })
                                .is_ok()
                            {
                                combinator = Combinator::Deep;
                                break;
                            } else {
                                break 'outer_loop;
                            }
                        }
                    }
                    _ => {}
                },
                _ => {}
            }

            input.reset(&before_this_token);

            if any_whitespace {
                combinator = Combinator::Descendant;
                break;
            } else {
                break 'outer_loop;
            }
        }

        if !state.allows_combinators() {
            return Err(input.new_custom_error(
                SelectorParseErrorKind::InvalidState.into_default_parser_error(),
            ));
        }

        builder.push_combinator(combinator);
    }

    if !state.contains(SelectorParsingState::AFTER_NESTING) {
        match nesting_requirement {
            NestingRequirement::Implicit => {
                builder.add_nesting_prefix();
            }
            NestingRequirement::Contained | NestingRequirement::Prefixed => {
                return Err(input.new_custom_error(
                    SelectorParseErrorKind::MissingNestingSelector.into_default_parser_error(),
                ));
            }
            _ => {}
        }
    }

    let has_pseudo_element = state.contains(SelectorParsingState::AFTER_PSEUDO_ELEMENT)
        || state.contains(SelectorParsingState::AFTER_UNKNOWN_PSEUDO_ELEMENT);
    let slotted = state.contains(SelectorParsingState::AFTER_SLOTTED);
    let part = state.contains(SelectorParsingState::AFTER_PART);
    let result = builder.build(has_pseudo_element, slotted, part);
    Ok(GenericSelector {
        specificity_and_flags: result.specificity_and_flags,
        components: result.components,
    })
}

/// simple_selector_sequence
/// : [ type_selector | universal ] [ HASH | class | attrib | pseudo | negation ]*
/// | [ HASH | class | attrib | pseudo | negation ]+
///
/// `Err(())` means invalid selector.
/// `Ok(true)` is an empty selector
fn parse_compound_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    state: &mut SelectorParsingState,
    input: &mut CssParser,
    builder: &mut SelectorBuilder<Impl>,
) -> CResult<bool> {
    input.skip_whitespace();

    let mut empty: bool = true;
    if parser.is_nesting_allowed() && input.try_parse(|i| i.expect_delim('&')).is_ok() {
        state.insert(SelectorParsingState::AFTER_NESTING);
        builder.push_simple_selector(GenericComponent::Nesting);
        empty = false;
    }

    if let Ok(_) = parse_type_selector::<Impl>(parser, input, *state, builder) {
        // Note: Zig `.asValue()` here means "if Ok"; the bool result is unused.
        // TODO(port): the Zig only sets `empty = false` on Ok(true|false) — but
        // `asValue()` returns Some on .result regardless of bool value, so this matches.
        empty = false;
    }

    loop {
        let result: SimpleSelectorParseResult<Impl> = {
            let ret = parse_one_simple_selector::<Impl>(parser, input, state)?;
            match ret {
                Some(result) => result,
                None => break,
            }
        };

        if empty {
            if let Some(url) = parser.default_namespace() {
                // If there was no explicit type selector, but there is a
                // default namespace, there is an implicit "<defaultns>|*" type
                // selector. Except for :host() or :not() / :is() / :where(),
                // where we ignore it.
                //
                // https://drafts.csswg.org/css-scoping/#host-element-in-tree:
                //
                //     When considered within its own shadow trees, the shadow
                //     host is featureless. Only the :host, :host(), and
                //     :host-context() pseudo-classes are allowed to match it.
                //
                // https://drafts.csswg.org/selectors-4/#featureless:
                //
                //     A featureless element does not match any selector at all,
                //     except those it is explicitly defined to match. If a
                //     given selector is allowed to match a featureless element,
                //     it must do so while ignoring the default namespace.
                //
                // https://drafts.csswg.org/selectors-4/#matches
                //
                //     Default namespace declarations do not affect the compound
                //     selector representing the subject of any selector within
                //     a :is() pseudo-class, unless that compound selector
                //     contains an explicit universal selector or type selector.
                //
                //     (Similar quotes for :where() / :not())
                //
                let ignore_default_ns = state.contains(SelectorParsingState::SKIP_DEFAULT_NAMESPACE)
                    || matches!(result, SimpleSelectorParseResult::SimpleSelector(GenericComponent::Host(_)));
                if !ignore_default_ns {
                    builder.push_simple_selector(GenericComponent::DefaultNamespace(url));
                }
            }
        }

        empty = false;

        match result {
            SimpleSelectorParseResult::SimpleSelector(s) => {
                builder.push_simple_selector(s);
            }
            SimpleSelectorParseResult::PartPseudo(selector) => {
                state.insert(SelectorParsingState::AFTER_PART);
                builder.push_combinator(Combinator::Part);
                builder.push_simple_selector(GenericComponent::Part(selector));
            }
            SimpleSelectorParseResult::SlottedPseudo(selector) => {
                state.insert(SelectorParsingState::AFTER_SLOTTED);
                builder.push_combinator(Combinator::SlotAssignment);
                builder.push_simple_selector(GenericComponent::Slotted(selector));
            }
            SimpleSelectorParseResult::PseudoElement(p) => {
                if !p.is_unknown() {
                    state.insert(SelectorParsingState::AFTER_PSEUDO_ELEMENT);
                    builder.push_combinator(Combinator::PseudoElement);
                } else {
                    state.insert(SelectorParsingState::AFTER_UNKNOWN_PSEUDO_ELEMENT);
                }

                if !p.accepts_state_pseudo_classes() {
                    state.insert(SelectorParsingState::AFTER_NON_STATEFUL_PSEUDO_ELEMENT);
                }

                if p.is_webkit_scrollbar() {
                    state.insert(SelectorParsingState::AFTER_WEBKIT_SCROLLBAR);
                }

                if p.is_view_transition() {
                    state.insert(SelectorParsingState::AFTER_VIEW_TRANSITION);
                }

                builder.push_simple_selector(GenericComponent::PseudoElement(p));
            }
        }
    }

    Ok(empty)
}

fn parse_relative_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
    nesting_requirement_: NestingRequirement,
) -> CResult<GenericSelector<Impl>> {
    // https://www.w3.org/TR/selectors-4/#parse-relative-selector
    let mut nesting_requirement = nesting_requirement_;
    let s = input.state();

    let combinator: Option<Combinator> = 'combinator: {
        let tok = input.next()?;
        if let Token::Delim(c) = tok {
            match *c {
                '>' => break 'combinator Some(Combinator::Child),
                '+' => break 'combinator Some(Combinator::NextSibling),
                '~' => break 'combinator Some(Combinator::LaterSibling),
                _ => {}
            }
        }
        input.reset(&s);
        None
    };

    let scope: GenericComponent<Impl> = if nesting_requirement == NestingRequirement::Implicit {
        GenericComponent::Nesting
    } else {
        GenericComponent::Scope
    };

    if combinator.is_some() {
        nesting_requirement = NestingRequirement::None;
    }

    let mut selector = parse_selector::<Impl>(parser, input, state, nesting_requirement)?;
    if let Some(wombo_combo) = combinator {
        // https://www.w3.org/TR/selectors/#absolutizing
        selector.components.push(GenericComponent::Combinator(wombo_combo));
        // PERF(port): was assume_capacity (catch unreachable on arena)
        selector.components.push(scope);
    }

    Ok(selector)
}

/// Compile-time validation of the `SelectorParser` shape. In Rust the methods are
/// inherent on `SelectorParser`; this is a no-op kept for diff parity.
pub fn valid_selector_parser<T>() {
    // Zig: `_ = T.SelectorParser.parseSlotted;` etc. — structural duck-typing check.
    // In Rust these are inherent methods on `SelectorParser`; nothing to validate at runtime.
}

/// The [:dir()](https://drafts.csswg.org/selectors-4/#the-dir-pseudo) pseudo class.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    /// Left to right
    Ltr,
    /// Right to left
    Rtl,
}

impl Direction {
    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }
    pub fn as_str(&self) -> &'static str {
        css::enum_property_util::as_str(self)
    }
    pub fn parse(input: &mut CssParser) -> CResult<Self> {
        css::enum_property_util::parse(input)
    }
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

/// A pseudo class.
#[derive(Clone, PartialEq)]
pub enum PseudoClass {
    /// https://drafts.csswg.org/selectors-4/#linguistic-pseudos
    /// The [:lang()](https://drafts.csswg.org/selectors-4/#the-lang-pseudo) pseudo class.
    Lang {
        /// A list of language codes.
        languages: Vec<Str>,
        // PERF(port): was arena ArrayList — profile in Phase B
    },
    /// The [:dir()](https://drafts.csswg.org/selectors-4/#the-dir-pseudo) pseudo class.
    Dir {
        /// A direction.
        direction: Direction,
    },

    // https://drafts.csswg.org/selectors-4/#useraction-pseudos
    /// The [:hover](https://drafts.csswg.org/selectors-4/#the-hover-pseudo) pseudo class.
    Hover,
    /// The [:active](https://drafts.csswg.org/selectors-4/#the-active-pseudo) pseudo class.
    Active,
    /// The [:focus](https://drafts.csswg.org/selectors-4/#the-focus-pseudo) pseudo class.
    Focus,
    /// The [:focus-visible](https://drafts.csswg.org/selectors-4/#the-focus-visible-pseudo) pseudo class.
    FocusVisible,
    /// The [:focus-within](https://drafts.csswg.org/selectors-4/#the-focus-within-pseudo) pseudo class.
    FocusWithin,

    /// https://drafts.csswg.org/selectors-4/#time-pseudos
    /// The [:current](https://drafts.csswg.org/selectors-4/#the-current-pseudo) pseudo class.
    Current,
    /// The [:past](https://drafts.csswg.org/selectors-4/#the-past-pseudo) pseudo class.
    Past,
    /// The [:future](https://drafts.csswg.org/selectors-4/#the-future-pseudo) pseudo class.
    Future,

    /// https://drafts.csswg.org/selectors-4/#resource-pseudos
    /// The [:playing](https://drafts.csswg.org/selectors-4/#selectordef-playing) pseudo class.
    Playing,
    /// The [:paused](https://drafts.csswg.org/selectors-4/#selectordef-paused) pseudo class.
    Paused,
    /// The [:seeking](https://drafts.csswg.org/selectors-4/#selectordef-seeking) pseudo class.
    Seeking,
    /// The [:buffering](https://drafts.csswg.org/selectors-4/#selectordef-buffering) pseudo class.
    Buffering,
    /// The [:stalled](https://drafts.csswg.org/selectors-4/#selectordef-stalled) pseudo class.
    Stalled,
    /// The [:muted](https://drafts.csswg.org/selectors-4/#selectordef-muted) pseudo class.
    Muted,
    /// The [:volume-locked](https://drafts.csswg.org/selectors-4/#selectordef-volume-locked) pseudo class.
    VolumeLocked,

    /// The [:fullscreen](https://fullscreen.spec.whatwg.org/#:fullscreen-pseudo-class) pseudo class.
    Fullscreen(css::VendorPrefix),

    /// https://drafts.csswg.org/selectors/#display-state-pseudos
    /// The [:open](https://drafts.csswg.org/selectors/#selectordef-open) pseudo class.
    Open,
    /// The [:closed](https://drafts.csswg.org/selectors/#selectordef-closed) pseudo class.
    Closed,
    /// The [:modal](https://drafts.csswg.org/selectors/#modal-state) pseudo class.
    Modal,
    /// The [:picture-in-picture](https://drafts.csswg.org/selectors/#pip-state) pseudo class.
    PictureInPicture,

    /// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open
    /// The [:popover-open](https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open) pseudo class.
    PopoverOpen,

    /// The [:defined](https://drafts.csswg.org/selectors-4/#the-defined-pseudo) pseudo class.
    Defined,

    /// https://drafts.csswg.org/selectors-4/#location
    /// The [:any-link](https://drafts.csswg.org/selectors-4/#the-any-link-pseudo) pseudo class.
    AnyLink(css::VendorPrefix),
    /// The [:link](https://drafts.csswg.org/selectors-4/#link-pseudo) pseudo class.
    Link,
    /// The [:local-link](https://drafts.csswg.org/selectors-4/#the-local-link-pseudo) pseudo class.
    LocalLink,
    /// The [:target](https://drafts.csswg.org/selectors-4/#the-target-pseudo) pseudo class.
    Target,
    /// The [:target-within](https://drafts.csswg.org/selectors-4/#the-target-within-pseudo) pseudo class.
    TargetWithin,
    /// The [:visited](https://drafts.csswg.org/selectors-4/#visited-pseudo) pseudo class.
    Visited,

    /// https://drafts.csswg.org/selectors-4/#input-pseudos
    /// The [:enabled](https://drafts.csswg.org/selectors-4/#enabled-pseudo) pseudo class.
    Enabled,
    /// The [:disabled](https://drafts.csswg.org/selectors-4/#disabled-pseudo) pseudo class.
    Disabled,
    /// The [:read-only](https://drafts.csswg.org/selectors-4/#read-only-pseudo) pseudo class.
    ReadOnly(css::VendorPrefix),
    /// The [:read-write](https://drafts.csswg.org/selectors-4/#read-write-pseudo) pseudo class.
    ReadWrite(css::VendorPrefix),
    /// The [:placeholder-shown](https://drafts.csswg.org/selectors-4/#placeholder) pseudo class.
    PlaceholderShown(css::VendorPrefix),
    /// The [:default](https://drafts.csswg.org/selectors-4/#the-default-pseudo) pseudo class.
    Default,
    /// The [:checked](https://drafts.csswg.org/selectors-4/#checked) pseudo class.
    Checked,
    /// The [:indeterminate](https://drafts.csswg.org/selectors-4/#indeterminate) pseudo class.
    Indeterminate,
    /// The [:blank](https://drafts.csswg.org/selectors-4/#blank) pseudo class.
    Blank,
    /// The [:valid](https://drafts.csswg.org/selectors-4/#valid-pseudo) pseudo class.
    Valid,
    /// The [:invalid](https://drafts.csswg.org/selectors-4/#invalid-pseudo) pseudo class.
    Invalid,
    /// The [:in-range](https://drafts.csswg.org/selectors-4/#in-range-pseudo) pseudo class.
    InRange,
    /// The [:out-of-range](https://drafts.csswg.org/selectors-4/#out-of-range-pseudo) pseudo class.
    OutOfRange,
    /// The [:required](https://drafts.csswg.org/selectors-4/#required-pseudo) pseudo class.
    Required,
    /// The [:optional](https://drafts.csswg.org/selectors-4/#optional-pseudo) pseudo class.
    Optional,
    /// The [:user-valid](https://drafts.csswg.org/selectors-4/#user-valid-pseudo) pseudo class.
    UserValid,
    /// The [:used-invalid](https://drafts.csswg.org/selectors-4/#user-invalid-pseudo) pseudo class.
    UserInvalid,

    /// The [:autofill](https://html.spec.whatwg.org/multipage/semantics-other.html#selector-autofill) pseudo class.
    Autofill(css::VendorPrefix),

    // CSS modules
    /// The CSS modules :local() pseudo class.
    Local {
        /// A local selector.
        selector: Box<Selector>,
    },
    /// The CSS modules :global() pseudo class.
    Global {
        /// A global selector.
        selector: Box<Selector>,
    },

    /// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo class.
    // https://webkit.org/blog/363/styling-scrollbars/
    WebkitScrollbar(WebKitScrollbarPseudoClass),
    /// An unknown pseudo class.
    Custom {
        /// The pseudo class name.
        name: Str,
    },
    /// An unknown functional pseudo class.
    CustomFunction {
        /// The pseudo class name.
        name: Str,
        /// The arguments of the pseudo class function.
        arguments: TokenList,
    },
}

impl PseudoClass {
    pub fn is_equivalent(&self, other: &PseudoClass) -> bool {
        use PseudoClass as P;
        if matches!(self, P::Fullscreen(_)) && matches!(other, P::Fullscreen(_)) { return true; }
        if matches!(self, P::AnyLink(_)) && matches!(other, P::AnyLink(_)) { return true; }
        if matches!(self, P::ReadOnly(_)) && matches!(other, P::ReadOnly(_)) { return true; }
        if matches!(self, P::ReadWrite(_)) && matches!(other, P::ReadWrite(_)) { return true; }
        if matches!(self, P::PlaceholderShown(_)) && matches!(other, P::PlaceholderShown(_)) { return true; }
        if matches!(self, P::Autofill(_)) && matches!(other, P::Autofill(_)) { return true; }
        self.eql(other)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // PERF(alloc): I don't like making these little allocations
        // TODO(port): Zig builds a fresh `Printer` over an allocating writer, calls
        // `serialize::serializePseudoClass`, then writes the buffer to `dest`. Phase B
        // should expose a `Printer::new_buffered(dest)` helper or write directly.
        let mut s: Vec<u8> = Vec::new();
        let mut printer = Printer::new_buffered(&mut s, css::PrinterOptions::default(), dest.import_info, dest.local_names, dest.symbols);
        serialize::serialize_pseudo_class(self, &mut printer, None)?;
        dest.write_str_bytes(&s)
    }

    pub fn eql(&self, rhs: &PseudoClass) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn get_prefix(&self) -> css::VendorPrefix {
        use PseudoClass as P;
        match self {
            P::Fullscreen(p) | P::AnyLink(p) | P::ReadOnly(p) | P::ReadWrite(p)
            | P::PlaceholderShown(p) | P::Autofill(p) => *p,
            _ => css::VendorPrefix::empty(),
        }
    }

    pub fn get_necessary_prefixes(&mut self, targets: css::targets::Targets) -> css::VendorPrefix {
        use css::prefixes::Feature as F;
        use PseudoClass as P;
        let (p, feature): (&mut css::VendorPrefix, F) = match self {
            P::Fullscreen(p) => (p, F::PseudoClassFullscreen),
            P::AnyLink(p) => (p, F::PseudoClassAnyLink),
            P::ReadOnly(p) => (p, F::PseudoClassReadOnly),
            P::ReadWrite(p) => (p, F::PseudoClassReadWrite),
            P::PlaceholderShown(p) => (p, F::PseudoClassPlaceholderShown),
            P::Autofill(p) => (p, F::PseudoClassAutofill),
            _ => return css::VendorPrefix::empty(),
        };
        *p = targets.prefixes(*p, feature);
        *p
    }

    pub fn is_user_action_state(&self) -> bool {
        use PseudoClass as P;
        matches!(self, P::Active | P::Hover | P::Focus | P::FocusWithin | P::FocusVisible)
    }

    pub fn is_valid_before_webkit_scrollbar(&self) -> bool {
        !matches!(self, PseudoClass::WebkitScrollbar(_))
    }

    pub fn is_valid_after_webkit_scrollbar(&self) -> bool {
        use PseudoClass as P;
        matches!(self, P::WebkitScrollbar(_) | P::Enabled | P::Disabled | P::Hover | P::Active)
    }
}

/// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo class.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum WebKitScrollbarPseudoClass {
    /// :horizontal
    Horizontal,
    /// :vertical
    Vertical,
    /// :decrement
    Decrement,
    /// :increment
    Increment,
    /// :start
    Start,
    /// :end
    End,
    /// :double-button
    DoubleButton,
    /// :single-button
    SingleButton,
    /// :no-button
    NoButton,
    /// :corner-present
    CornerPresent,
    /// :window-inactive
    WindowInactive,
}

/// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo element.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum WebKitScrollbarPseudoElement {
    /// ::-webkit-scrollbar
    Scrollbar,
    /// ::-webkit-scrollbar-button
    Button,
    /// ::-webkit-scrollbar-track
    Track,
    /// ::-webkit-scrollbar-track-piece
    TrackPiece,
    /// ::-webkit-scrollbar-thumb
    Thumb,
    /// ::-webkit-scrollbar-corner
    Corner,
    /// ::-webkit-resizer
    Resizer,
}

impl WebKitScrollbarPseudoElement {
    #[inline]
    pub fn eql(&self, rhs: &Self) -> bool {
        *self == *rhs
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectorParser
// ─────────────────────────────────────────────────────────────────────────────

pub struct SelectorParser<'a> {
    pub is_nesting_allowed: bool,
    pub options: &'a ParserOptions,
    // `allocator: Allocator` dropped — arena threaded via `input.allocator()` in Zig.
    // PERF(port): was arena bulk-free — Phase B re-threads `&'bump Bump`.
}

impl<'a> SelectorParser<'a> {
    pub type Impl = impl_::Selectors;

    pub fn new_local_identifier(
        &mut self,
        input: &mut CssParser,
        tag: css::CssRefTag,
        raw: Str,
        loc: usize,
    ) -> <impl_::Selectors as SelectorImpl>::LocalIdentifier {
        if input.flags.css_modules {
            return <impl_::Selectors as SelectorImpl>::LocalIdentifier::from_ref(
                input.add_symbol_for_name(raw, tag, bun_logger::Loc { start: i32::try_from(loc).unwrap() }),
                #[cfg(debug_assertions)]
                (raw, ()),
            );
        }
        <impl_::Selectors as SelectorImpl>::LocalIdentifier::from_ident(Ident { v: raw })
    }

    pub fn namespace_for_prefix(&mut self, prefix: Ident) -> Option<Str> {
        let _ = self;
        Some(prefix.v)
    }

    pub fn parse_functional_pseudo_element(
        &mut self,
        name: Str,
        input: &mut CssParser,
    ) -> CResult<PseudoElement> {
        // Zig's `ComptimeEnumMap.get` is ASCII-case-insensitive; lower into a stack
        // buffer before the phf lookup so `::CUE(...)` etc. still match.
        // TODO(port): phf custom hasher — replace stack-lowercase with a case-folded phf in Phase B.
        static MAP: phf::Map<&'static [u8], u8> = phf::phf_map! {
            b"cue" => 0,
            b"cue-region" => 1,
            b"view-transition-group" => 2,
            b"view-transition-image-pair" => 3,
            b"view-transition-old" => 4,
            b"view-transition-new" => 5,
        };
        let mut lower_buf = [0u8; 32];
        let lookup = if name.len() <= lower_buf.len() {
            for (i, b) in name.iter().enumerate() {
                lower_buf[i] = b.to_ascii_lowercase();
            }
            MAP.get(&lower_buf[..name.len()])
        } else {
            None
        };
        if let Some(v) = lookup {
            return match v {
                0 => Ok(PseudoElement::CueFunction {
                    selector: Box::new(Selector::parse(self, input)?),
                }),
                1 => Ok(PseudoElement::CueRegionFunction {
                    selector: Box::new(Selector::parse(self, input)?),
                }),
                2 => Ok(PseudoElement::ViewTransitionGroup {
                    part_name: ViewTransitionPartName::parse(input)?,
                }),
                3 => Ok(PseudoElement::ViewTransitionImagePair {
                    part_name: ViewTransitionPartName::parse(input)?,
                }),
                4 => Ok(PseudoElement::ViewTransitionOld {
                    part_name: ViewTransitionPartName::parse(input)?,
                }),
                5 => Ok(PseudoElement::ViewTransitionNew {
                    part_name: ViewTransitionPartName::parse(input)?,
                }),
                _ => unreachable!(),
            };
        }
        if !strings::starts_with(name, b"-") {
            self.options.warn(input.new_custom_error(
                SelectorParseErrorKind::UnsupportedPseudoClassOrElement(name)
                    .into_default_parser_error(),
            ));
        }

        let mut args: Vec<css::css_properties::custom::TokenOrValue> = Vec::new();
        TokenList::parse_raw(input, &mut args, self.options, 0)?;

        Ok(PseudoElement::CustomFunction {
            name,
            arguments: TokenList { v: args },
        })
    }

    fn parse_is_and_where(&self) -> bool {
        let _ = self;
        true
    }

    /// Whether the given function name is an alias for the `:is()` function.
    fn parse_any_prefix(&self, name: &[u8]) -> Option<css::VendorPrefix> {
        // TODO(port): phf custom hasher — Zig used `ComptimeStringMap.getAnyCase`.
        if strings::eql_case_insensitive_ascii_check_length(name, b"-webkit-any") {
            return Some(css::VendorPrefix::WEBKIT);
        }
        if strings::eql_case_insensitive_ascii_check_length(name, b"-moz-any") {
            return Some(css::VendorPrefix::MOZ);
        }
        None
    }

    pub fn parse_non_ts_pseudo_class(
        &mut self,
        loc: css::SourceLocation,
        name: Str,
    ) -> CResult<PseudoClass> {
        // @compileError(css.todo_stuff.match_ignore_ascii_case);
        let pseudo_class: PseudoClass = 'pseudo_class: {
            // TODO(port): phf custom hasher — Zig used `ComptimeStringMap.getAnyCase`
            // (ASCII case-insensitive). Phase B: generate a case-folded phf or use a
            // `match` over the lowercased name.
            if let Some(pseudo) = lookup_non_ts_pseudo_class(name) {
                break 'pseudo_class pseudo;
            }
            if strings::starts_with_char(name, b'_') {
                self.options.warn(loc.new_custom_error(
                    SelectorParseErrorKind::UnsupportedPseudoClassOrElement(name),
                ));
            } else if (self.options.css_modules.is_some()
                && strings::eql_case_insensitive_ascii_check_length(name, b"local"))
                || strings::eql_case_insensitive_ascii_check_length(name, b"global")
            {
                return Err(loc.new_custom_error(
                    SelectorParseErrorKind::AmbiguousCssModuleClass(name),
                ));
            }
            return Ok(PseudoClass::Custom { name });
        };

        Ok(pseudo_class)
    }

    pub fn parse_host(&mut self) -> bool {
        true
    }

    pub fn parse_non_ts_functional_pseudo_class(
        &mut self,
        name: Str,
        parser: &mut CssParser,
    ) -> CResult<PseudoClass> {
        // todo_stuff.match_ignore_ascii_case
        let pseudo_class = 'pseudo_class: {
            if strings::eql_case_insensitive_ascii_check_length(name, b"lang") {
                let languages = parser.parse_comma_separated(CssParser::expect_ident_or_string)?;
                return Ok(PseudoClass::Lang { languages });
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"dir") {
                break 'pseudo_class PseudoClass::Dir {
                    direction: Direction::parse(parser)?,
                };
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"local")
                && self.options.css_modules.is_some()
            {
                break 'pseudo_class PseudoClass::Local {
                    selector: {
                        let selector = Selector::parse(self, parser)?;
                        Box::new(selector)
                    },
                };
            } else if strings::eql_case_insensitive_ascii_check_length(name, b"global")
                && self.options.css_modules.is_some()
            {
                break 'pseudo_class PseudoClass::Global {
                    selector: {
                        let selector = Selector::parse(self, parser)?;
                        Box::new(selector)
                    },
                };
            } else {
                if !strings::starts_with_char(name, b'-') {
                    self.options.warn(parser.new_custom_error(
                        SelectorParseErrorKind::UnsupportedPseudoClassOrElement(name)
                            .into_default_parser_error(),
                    ));
                }
                let mut args: Vec<css::css_properties::custom::TokenOrValue> = Vec::new();
                css::TokenListFns::parse_raw(parser, &mut args, self.options, 0)?;
                break 'pseudo_class PseudoClass::CustomFunction {
                    name,
                    arguments: TokenList { v: args },
                };
            }
        };

        Ok(pseudo_class)
    }

    pub fn is_nesting_allowed(&self) -> bool {
        self.is_nesting_allowed
    }

    pub fn deep_combinator_enabled(&self) -> bool {
        self.options.flags.deep_selector_combinator
    }

    pub fn default_namespace(&self) -> Option<<impl_::Selectors as SelectorImpl>::NamespaceUrl> {
        let _ = self;
        None
    }

    pub fn parse_part(&self) -> bool {
        let _ = self;
        true
    }

    pub fn parse_slotted(&self) -> bool {
        let _ = self;
        true
    }

    /// The error recovery that selector lists inside :is() and :where() have.
    fn is_and_where_error_recovery(&self) -> ParseErrorRecovery {
        let _ = self;
        ParseErrorRecovery::IgnoreInvalidSelector
    }

    pub fn parse_pseudo_element(
        &mut self,
        loc: css::SourceLocation,
        name: Str,
    ) -> CResult<PseudoElement> {
        // TODO(port): phf custom hasher — Zig used `ComptimeStringMap.getCaseInsensitiveWithEql`.
        let pseudo_element = lookup_pseudo_element(name).unwrap_or_else(|| {
            if !strings::starts_with_char(name, b'-') {
                self.options.warn(loc.new_custom_error(
                    SelectorParseErrorKind::UnsupportedPseudoClassOrElement(name),
                ));
            }
            PseudoElement::Custom { name }
        });

        Ok(pseudo_element)
    }
}

/// Case-insensitive lookup table for `parse_non_ts_pseudo_class`.
/// Mirrors the `ComptimeStringMap` at parser.zig:1120.
fn lookup_non_ts_pseudo_class(name: &[u8]) -> Option<PseudoClass> {
    use css::VendorPrefix as VP;
    use PseudoClass as P;
    use WebKitScrollbarPseudoClass as WS;
    // TODO(port): replace with phf once a case-insensitive hasher is available.
    macro_rules! m {
        ($($lit:literal => $val:expr,)*) => {{
            $( if strings::eql_case_insensitive_ascii_check_length(name, $lit) { return Some($val); } )*
            None
        }};
    }
    m! {
        // https://drafts.csswg.org/selectors-4/#useraction-pseudos
        b"hover" => P::Hover,
        b"active" => P::Active,
        b"focus" => P::Focus,
        b"focus-visible" => P::FocusVisible,
        b"focus-within" => P::FocusWithin,
        // https://drafts.csswg.org/selectors-4/#time-pseudos
        b"current" => P::Current,
        b"past" => P::Past,
        b"future" => P::Future,
        // https://drafts.csswg.org/selectors-4/#resource-pseudos
        b"playing" => P::Playing,
        b"paused" => P::Paused,
        b"seeking" => P::Seeking,
        b"buffering" => P::Buffering,
        b"stalled" => P::Stalled,
        b"muted" => P::Muted,
        b"volume-locked" => P::VolumeLocked,
        // https://fullscreen.spec.whatwg.org/#:fullscreen-pseudo-class
        b"fullscreen" => P::Fullscreen(VP::NONE),
        b"-webkit-full-screen" => P::Fullscreen(VP::WEBKIT),
        b"-moz-full-screen" => P::Fullscreen(VP::MOZ),
        b"-ms-fullscreen" => P::Fullscreen(VP::MS),
        // https://drafts.csswg.org/selectors/#display-state-pseudos
        b"open" => P::Open,
        b"closed" => P::Closed,
        b"modal" => P::Modal,
        b"picture-in-picture" => P::PictureInPicture,
        // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-popover-open
        b"popover-open" => P::PopoverOpen,
        // https://drafts.csswg.org/selectors-4/#the-defined-pseudo
        b"defined" => P::Defined,
        // https://drafts.csswg.org/selectors-4/#location
        b"any-link" => P::AnyLink(VP::NONE),
        b"-webkit-any-link" => P::AnyLink(VP::WEBKIT),
        b"-moz-any-link" => P::AnyLink(VP::MOZ),
        b"link" => P::Link,
        b"local-link" => P::LocalLink,
        b"target" => P::Target,
        b"target-within" => P::TargetWithin,
        b"visited" => P::Visited,
        // https://drafts.csswg.org/selectors-4/#input-pseudos
        b"enabled" => P::Enabled,
        b"disabled" => P::Disabled,
        b"read-only" => P::ReadOnly(VP::NONE),
        b"-moz-read-only" => P::ReadOnly(VP::MOZ),
        b"read-write" => P::ReadWrite(VP::NONE),
        b"-moz-read-write" => P::ReadWrite(VP::MOZ),
        b"placeholder-shown" => P::PlaceholderShown(VP::NONE),
        b"-moz-placeholder-shown" => P::PlaceholderShown(VP::MOZ),
        b"-ms-placeholder-shown" => P::PlaceholderShown(VP::MS),
        b"default" => P::Default,
        b"checked" => P::Checked,
        b"indeterminate" => P::Indeterminate,
        b"blank" => P::Blank,
        b"valid" => P::Valid,
        b"invalid" => P::Invalid,
        b"in-range" => P::InRange,
        b"out-of-range" => P::OutOfRange,
        b"required" => P::Required,
        b"optional" => P::Optional,
        b"user-valid" => P::UserValid,
        b"user-invalid" => P::UserInvalid,
        // https://html.spec.whatwg.org/multipage/semantics-other.html#selector-autofill
        b"autofill" => P::Autofill(VP::NONE),
        b"-webkit-autofill" => P::Autofill(VP::WEBKIT),
        b"-o-autofill" => P::Autofill(VP::O),
        // https://webkit.org/blog/363/styling-scrollbars/
        b"horizontal" => P::WebkitScrollbar(WS::Horizontal),
        b"vertical" => P::WebkitScrollbar(WS::Vertical),
        b"decrement" => P::WebkitScrollbar(WS::Decrement),
        b"increment" => P::WebkitScrollbar(WS::Increment),
        b"start" => P::WebkitScrollbar(WS::Start),
        b"end" => P::WebkitScrollbar(WS::End),
        b"double-button" => P::WebkitScrollbar(WS::DoubleButton),
        b"single-button" => P::WebkitScrollbar(WS::SingleButton),
        b"no-button" => P::WebkitScrollbar(WS::NoButton),
        b"corner-present" => P::WebkitScrollbar(WS::CornerPresent),
        b"window-inactive" => P::WebkitScrollbar(WS::WindowInactive),
    }
}

/// Case-insensitive lookup table for `parse_pseudo_element`.
/// Mirrors the `ComptimeStringMap` at parser.zig:1333.
fn lookup_pseudo_element(name: &[u8]) -> Option<PseudoElement> {
    use css::VendorPrefix as VP;
    use PseudoElement as PE;
    use WebKitScrollbarPseudoElement as WS;
    macro_rules! m {
        ($($lit:literal => $val:expr,)*) => {{
            $( if strings::eql_case_insensitive_ascii_check_length(name, $lit) { return Some($val); } )*
            None
        }};
    }
    m! {
        b"before" => PE::Before,
        b"after" => PE::After,
        b"first-line" => PE::FirstLine,
        b"first-letter" => PE::FirstLetter,
        b"cue" => PE::Cue,
        b"cue-region" => PE::CueRegion,
        b"selection" => PE::Selection(VP::NONE),
        b"-moz-selection" => PE::Selection(VP::MOZ),
        b"placeholder" => PE::Placeholder(VP::NONE),
        b"-webkit-input-placeholder" => PE::Placeholder(VP::WEBKIT),
        b"-moz-placeholder" => PE::Placeholder(VP::MOZ),
        b"-ms-input-placeholder" => PE::Placeholder(VP::MS),
        b"marker" => PE::Marker,
        b"backdrop" => PE::Backdrop(VP::NONE),
        b"-webkit-backdrop" => PE::Backdrop(VP::WEBKIT),
        b"file-selector-button" => PE::FileSelectorButton(VP::NONE),
        b"-webkit-file-upload-button" => PE::FileSelectorButton(VP::WEBKIT),
        b"-ms-browse" => PE::FileSelectorButton(VP::MS),
        b"-webkit-scrollbar" => PE::WebkitScrollbar(WS::Scrollbar),
        b"-webkit-scrollbar-button" => PE::WebkitScrollbar(WS::Button),
        b"-webkit-scrollbar-track" => PE::WebkitScrollbar(WS::Track),
        b"-webkit-scrollbar-track-piece" => PE::WebkitScrollbar(WS::TrackPiece),
        b"-webkit-scrollbar-thumb" => PE::WebkitScrollbar(WS::Thumb),
        b"-webkit-scrollbar-corner" => PE::WebkitScrollbar(WS::Corner),
        b"-webkit-resizer" => PE::WebkitScrollbar(WS::Resizer),
        b"view-transition" => PE::ViewTransition,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GenericSelectorList
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
pub struct GenericSelectorList<Impl: SelectorImpl> {
    // PERF: make this equivalent to SmallVec<[Selector; 1]>
    pub v: SmallList<GenericSelector<Impl>, 1>,
}

/// `DebugFmt` wrapper — implements `Display` over a borrowed list (debug builds only).
pub struct SelectorListDebugFmt<'a, Impl: SelectorImpl>(pub &'a GenericSelectorList<Impl>);

impl<'a, Impl: SelectorImpl> fmt::Display for SelectorListDebugFmt<'a, Impl> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if !cfg!(debug_assertions) {
            return Ok(());
        }
        write!(f, "SelectorList[\n")?;
        let last = self.0.v.len().saturating_sub(1);
        for (i, sel) in self.0.v.slice().iter().enumerate() {
            if i != last {
                write!(f, " {}\n", sel.debug())?;
            } else {
                write!(f, " {},\n", sel.debug())?;
            }
        }
        write!(f, "]\n")
    }
}

impl<Impl: SelectorImpl> GenericSelectorList<Impl> {
    pub fn debug(&self) -> SelectorListDebugFmt<'_, Impl> {
        SelectorListDebugFmt(self)
    }

    pub fn any_has_pseudo_element(&self) -> bool {
        for sel in self.v.slice() {
            if sel.has_pseudo_element() {
                return true;
            }
        }
        false
    }

    pub fn specifities_all_equal(&self) -> bool {
        if self.v.len() == 0 {
            return true;
        }
        if self.v.len() == 1 {
            return true;
        }
        let value = self.v.at(0).specificity();
        for sel in &self.v.slice()[1..] {
            if sel.specificity() != value {
                return false;
            }
        }
        true
    }

    /// Do not call this! Use `serializer::serialize_selector_list()` or
    /// `tocss_servo::to_css_selector_list()` instead.
    #[deprecated = "use serializer::serialize_selector_list()"]
    pub fn to_css(&self, _dest: &mut Printer) -> Result<(), PrintErr> {
        unreachable!("use serializer::serialize_selector_list()");
    }

    pub fn parse_with_options(input: &mut CssParser, options: &ParserOptions) -> CResult<Self> {
        let mut parser = SelectorParser {
            options,
            is_nesting_allowed: true,
        };
        Self::parse(&mut parser, input, ParseErrorRecovery::DiscardList, NestingRequirement::None)
    }

    pub fn parse(
        parser: &mut SelectorParser,
        input: &mut CssParser,
        error_recovery: ParseErrorRecovery,
        nesting_requirement: NestingRequirement,
    ) -> CResult<Self> {
        let mut state = SelectorParsingState::empty();
        Self::parse_with_state(parser, input, &mut state, error_recovery, nesting_requirement)
    }

    pub fn parse_relative(
        parser: &mut SelectorParser,
        input: &mut CssParser,
        error_recovery: ParseErrorRecovery,
        nesting_requirement: NestingRequirement,
    ) -> CResult<Self> {
        let mut state = SelectorParsingState::empty();
        Self::parse_relative_with_state(parser, input, &mut state, error_recovery, nesting_requirement)
    }

    pub fn parse_with_state(
        parser: &mut SelectorParser,
        input: &mut CssParser,
        state: &mut SelectorParsingState,
        recovery: ParseErrorRecovery,
        nesting_requirement: NestingRequirement,
    ) -> CResult<Self> {
        let original_state = *state;
        // TODO: Think about deinitialization in error cases
        let mut values: SmallList<GenericSelector<Impl>, 1> = SmallList::default();

        loop {
            // PORT NOTE: reshaped for borrowck — Zig used a `Closure` struct capturing
            // `&mut state` and `&mut parser`; Rust captures a local `saw_nesting` flag
            // and applies it to `state` after the closure returns (no raw `*mut`).
            let mut saw_nesting = false;
            let selector = input.parse_until_before(css::Delimiters::COMMA, |input2: &mut CssParser| {
                let mut selector_state = original_state;
                let result = parse_selector::<Impl>(parser, input2, &mut selector_state, nesting_requirement);
                if selector_state.contains(SelectorParsingState::AFTER_NESTING) {
                    saw_nesting = true;
                }
                result
            });
            if saw_nesting {
                state.insert(SelectorParsingState::AFTER_NESTING);
            }

            let was_ok = selector.is_ok();
            match selector {
                Ok(sel) => {
                    values.push(sel);
                    // PERF(port): was arena append — profile in Phase B
                }
                Err(e) => match recovery {
                    ParseErrorRecovery::DiscardList => return Err(e),
                    ParseErrorRecovery::IgnoreInvalidSelector => {}
                },
            }

            loop {
                if let Ok(tok) = input.next() {
                    if matches!(tok, Token::Comma) {
                        break;
                    }
                    // Shouldn't have got a selector if getting here.
                    debug_assert!(!was_ok);
                }
                return Ok(Self { v: values });
            }
        }
    }

    // TODO: this looks exactly the same as `parse_with_state()` except it uses
    // `parse_relative_selector()` instead of `parse_selector()`
    pub fn parse_relative_with_state(
        parser: &mut SelectorParser,
        input: &mut CssParser,
        state: &mut SelectorParsingState,
        recovery: ParseErrorRecovery,
        nesting_requirement: NestingRequirement,
    ) -> CResult<Self> {
        let original_state = *state;
        // TODO: Think about deinitialization in error cases
        let mut values: SmallList<GenericSelector<Impl>, 1> = SmallList::default();

        loop {
            // PORT NOTE: reshaped for borrowck — capture a local flag instead of a
            // raw `*mut SelectorParsingState`, then fold into `state` after return.
            let mut saw_nesting = false;
            let selector = input.parse_until_before(css::Delimiters::COMMA, |input2: &mut CssParser| {
                let mut selector_state = original_state;
                let result = parse_relative_selector::<Impl>(parser, input2, &mut selector_state, nesting_requirement);
                if selector_state.contains(SelectorParsingState::AFTER_NESTING) {
                    saw_nesting = true;
                }
                result
            });
            if saw_nesting {
                state.insert(SelectorParsingState::AFTER_NESTING);
            }

            let was_ok = selector.is_ok();
            match selector {
                Ok(sel) => {
                    values.push(sel);
                }
                Err(e) => match recovery {
                    ParseErrorRecovery::DiscardList => return Err(e),
                    ParseErrorRecovery::IgnoreInvalidSelector => {}
                },
            }

            loop {
                if let Ok(tok) = input.next() {
                    if matches!(tok, Token::Comma) {
                        break;
                    }
                    // Shouldn't have got a selector if getting here.
                    debug_assert!(!was_ok);
                }
                return Ok(Self { v: values });
            }
        }
    }

    pub fn from_selector(selector: GenericSelector<Impl>) -> Self {
        let mut result = Self::default();
        result.v.push(selector);
        result
    }

    pub fn deep_clone(&self) -> Self {
        Self { v: self.v.deep_clone() }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        self.v.eql(&rhs.v)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GenericSelector
// ─────────────────────────────────────────────────────────────────────────────

/// -- original comment from servo --
/// A Selector stores a sequence of simple selectors and combinators. The
/// iterator classes allow callers to iterate at either the raw sequence level or
/// at the level of sequences of simple selectors separated by combinators. Most
/// callers want the higher-level iterator.
///
/// We store compound selectors internally right-to-left (in matching order).
/// Additionally, we invert the order of top-level compound selectors so that
/// each one matches left-to-right. This is because matching namespace, local name,
/// id, and class are all relatively cheap, whereas matching pseudo-classes might
/// be expensive (depending on the pseudo-class). Since authors tend to put the
/// pseudo-classes on the right, it's faster to start matching on the left.
///
/// This reordering doesn't change the semantics of selector matching, and we
/// handle it in to_css to make it invisible to serialization.
#[derive(Clone)]
pub struct GenericSelector<Impl: SelectorImpl> {
    pub specificity_and_flags: SpecificityAndFlags,
    pub components: Vec<GenericComponent<Impl>>,
    // PERF(port): was arena ArrayList — profile in Phase B
}

pub struct SelectorDebugFmt<'a, Impl: SelectorImpl>(pub &'a GenericSelector<Impl>);

impl<'a, Impl: SelectorImpl> fmt::Display for SelectorDebugFmt<'a, Impl> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if !cfg!(debug_assertions) {
            return Ok(());
        }
        write!(f, "Selector(")?;
        // TODO(port): the Zig builds a fresh `Printer` and calls
        // `tocss_servo::to_css_selector` into a buffer, then writes the buffer.
        // Phase B should mirror once `Printer::new` is ported.
        let mut buf: Vec<u8> = Vec::new();
        let symbols = bun_js_parser::ast::SymbolMap::default();
        let mut printer = Printer::new_buffered(&mut buf, css::PrinterOptions::default(), None, None, &symbols);
        // TODO(port): `Printer::in_debug_fmt` is a thread-local/static flag in Zig.
        match css::selector::tocss_servo::to_css_selector(self.0, &mut printer) {
            Ok(()) => write!(f, "{}", bstr::BStr::new(&buf)),
            Err(e) => write!(f, "<error writing selector: {}>\n", <&'static str>::from(e)),
        }
    }
}

impl<Impl: SelectorImpl> GenericSelector<Impl> {
    pub fn debug(&self) -> SelectorDebugFmt<'_, Impl> {
        SelectorDebugFmt(self)
    }

    /// Parse a selector, without any pseudo-element.
    pub fn parse(parser: &mut SelectorParser, input: &mut CssParser) -> CResult<Self> {
        let mut state = SelectorParsingState::empty();
        parse_selector::<Impl>(parser, input, &mut state, NestingRequirement::None)
    }

    /// Do not call this! Use `serializer::serialize_selector()` or
    /// `tocss_servo::to_css_selector()` instead.
    #[deprecated = "use serializer::serialize_selector()"]
    pub fn to_css(&self, _dest: &mut Printer) -> Result<(), PrintErr> {
        unreachable!("use serializer::serialize_selector()");
    }

    pub fn append(&mut self, component: GenericComponent<Impl>) {
        let index = 'index: {
            for (i, comp) in self.components.iter().enumerate() {
                match comp {
                    GenericComponent::Combinator(_) | GenericComponent::PseudoElement(_) => break 'index i,
                    _ => {}
                }
            }
            self.components.len()
        };
        self.components.insert(index, component);
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn eql(&self, other: &Self) -> bool {
        css::implement_eql(self, other)
    }

    pub fn has_combinator(&self) -> bool {
        for c in &self.components {
            if let GenericComponent::Combinator(comb) = c {
                if comb.is_tree_combinator() {
                    return true;
                }
            }
        }
        false
    }

    pub fn has_pseudo_element(&self) -> bool {
        self.specificity_and_flags.has_pseudo_element()
    }

    /// Returns count of simple selectors and combinators in the Selector.
    pub fn len(&self) -> usize {
        self.components.len()
    }

    pub fn from_component(component: GenericComponent<Impl>) -> Self {
        let mut builder = SelectorBuilder::<Impl>::default();
        if let Some(combinator) = component.as_combinator() {
            builder.push_combinator(combinator);
        } else {
            builder.push_simple_selector(component);
        }
        let result = builder.build(false, false, false);
        Self {
            specificity_and_flags: result.specificity_and_flags,
            components: result.components,
        }
    }

    pub fn specificity(&self) -> u32 {
        self.specificity_and_flags.specificity
    }

    pub fn parse_with_options(input: &mut CssParser, options: &ParserOptions) -> CResult<Self> {
        let mut selector_parser = SelectorParser {
            is_nesting_allowed: true,
            options,
        };
        Self::parse(&mut selector_parser, input)
    }

    pub fn iter_raw_match_order(&self) -> RawMatchOrderIterator<'_, Impl> {
        RawMatchOrderIterator { slice: &self.components, i: 0 }
    }

    /// Returns an iterator over the sequence of simple selectors and
    /// combinators, in parse order (from left to right), starting from
    /// `offset`.
    pub fn iter_raw_parse_order_from(&self, offset: usize) -> RawParseOrderFromIter<'_, Impl> {
        RawParseOrderFromIter {
            slice: &self.components[0..self.components.len() - offset],
            i: 0,
        }
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

pub struct RawMatchOrderIterator<'a, Impl: SelectorImpl> {
    slice: &'a [GenericComponent<Impl>],
    i: usize,
}

impl<'a, Impl: SelectorImpl> Iterator for RawMatchOrderIterator<'a, Impl> {
    type Item = &'a GenericComponent<Impl>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.i >= self.slice.len() {
            return None;
        }
        let result = &self.slice[self.i];
        self.i += 1;
        Some(result)
    }
}

pub struct RawParseOrderFromIter<'a, Impl: SelectorImpl> {
    slice: &'a [GenericComponent<Impl>],
    i: usize,
}

impl<'a, Impl: SelectorImpl> Iterator for RawParseOrderFromIter<'a, Impl> {
    type Item = &'a GenericComponent<Impl>;
    fn next(&mut self) -> Option<Self::Item> {
        if !(self.i < self.slice.len()) {
            return None;
        }
        let result = &self.slice[self.slice.len() - 1 - self.i];
        self.i += 1;
        Some(result)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GenericComponent
// ─────────────────────────────────────────────────────────────────────────────

/// A CSS simple selector or combinator. We store both in the same enum for
/// optimal packing and cache performance, see [1].
///
/// [1] https://bugzilla.mozilla.org/show_bug.cgi?id=1357973
#[derive(Clone)]
pub enum GenericComponent<Impl: SelectorImpl> {
    Combinator(Combinator),

    ExplicitAnyNamespace,
    ExplicitNoNamespace,
    DefaultNamespace(Impl::NamespaceUrl),
    Namespace {
        prefix: Impl::NamespacePrefix,
        url: Impl::NamespaceUrl,
    },

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
    Any {
        vendor_prefix: Impl::VendorPrefix,
        selectors: Box<[GenericSelector<Impl>]>,
    },
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

    pub fn as_class(&self) -> Option<&Impl::LocalIdentifier> {
        match self {
            Self::Class(v) => Some(v),
            _ => None,
        }
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn as_combinator(&self) -> Option<Combinator> {
        if let Self::Combinator(c) = self {
            Some(*c)
        } else {
            None
        }
    }

    pub fn convert_helper_is(s: Box<[GenericSelector<Impl>]>) -> Self {
        Self::Is(s)
    }

    pub fn convert_helper_where(s: Box<[GenericSelector<Impl>]>) -> Self {
        Self::Where(s)
    }

    pub fn convert_helper_any(s: Box<[GenericSelector<Impl>]>, prefix: Impl::VendorPrefix) -> Self {
        Self::Any { vendor_prefix: prefix, selectors: s }
    }

    /// Returns true if this is a combinator.
    pub fn is_combinator(&self) -> bool {
        matches!(self, Self::Combinator(_))
    }

    /// Do not call this! Use `serializer::serialize_component()` or
    /// `tocss_servo::to_css_component()` instead.
    #[deprecated = "use serializer::serialize_component()"]
    pub fn to_css(&self, _dest: &mut Printer) -> Result<(), PrintErr> {
        unreachable!("use serializer::serialize_component()");
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

impl<Impl: SelectorImpl> fmt::Display for GenericComponent<Impl> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // TODO(port): Zig matches on a few variants and falls through to `@tagName`.
        // Rust enums need `strum::IntoStaticStr` for the tag name; Phase B.
        match self {
            Self::LocalName(ln) => write!(f, "local_name={}", bstr::BStr::new(ln.name.v)),
            Self::Combinator(c) => write!(f, "combinator='{}'", c),
            Self::PseudoElement(_) => write!(f, "pseudo_element=<..>"),
            Self::Class(_) => write!(f, "class=<..>"),
            _ => write!(f, "<component>"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NthSelectorData / NthOfSelectorData
// ─────────────────────────────────────────────────────────────────────────────

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

    pub fn is_function_(&self) -> bool {
        self.a != 0 || self.b != 1
    }

    fn number_sign(num: i32) -> &'static str {
        if num >= 0 { "+" } else { "" }
    }

    pub fn write_affine(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // PERF: this could be made faster
        if self.a == 0 && self.b == 0 {
            dest.write_char('0')
        } else if self.a == 1 && self.b == 0 {
            dest.write_char('n')
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

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

/// The properties that comprise an :nth- pseudoclass as of Selectors 4 (e.g.,
/// nth-child(An+B [of S]?)).
/// https://www.w3.org/TR/selectors-4/#nth-child-pseudo
#[derive(Clone)]
pub struct NthOfSelectorData<Impl: SelectorImpl> {
    pub data: NthSelectorData,
    pub selectors: Box<[GenericSelector<Impl>]>,
}

impl<Impl: SelectorImpl> NthOfSelectorData<Impl> {
    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }
    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }
    pub fn nth_data(&self) -> NthSelectorData {
        self.data
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SelectorParsingState (packed struct(u16) — all-bool → bitflags!)
// ─────────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct SelectorParsingState: u16 {
        /// Whether we should avoid adding default namespaces to selectors that
        /// aren't type or universal selectors.
        const SKIP_DEFAULT_NAMESPACE = 1 << 0;

        /// Whether we've parsed a ::slotted() pseudo-element already.
        ///
        /// If so, then we can only parse a subset of pseudo-elements, and
        /// whatever comes after them if so.
        const AFTER_SLOTTED = 1 << 1;

        /// Whether we've parsed a ::part() pseudo-element already.
        ///
        /// If so, then we can only parse a subset of pseudo-elements, and
        /// whatever comes after them if so.
        const AFTER_PART = 1 << 2;

        /// Whether we've parsed a pseudo-element (as in, an
        /// `Impl::PseudoElement` thus not accounting for `::slotted` or
        /// `::part`) already.
        ///
        /// If so, then other pseudo-elements and most other selectors are
        /// disallowed.
        const AFTER_PSEUDO_ELEMENT = 1 << 3;

        /// Whether we've parsed a non-stateful pseudo-element (again, as-in
        /// `Impl::PseudoElement`) already. If so, then other pseudo-classes are
        /// disallowed. If this flag is set, `AFTER_PSEUDO_ELEMENT` must be set
        /// as well.
        const AFTER_NON_STATEFUL_PSEUDO_ELEMENT = 1 << 4;

        /// Whether we explicitly disallow combinators.
        const DISALLOW_COMBINATORS = 1 << 5;

        /// Whether we explicitly disallow pseudo-element-like things.
        const DISALLOW_PSEUDOS = 1 << 6;

        /// Whether we have seen a nesting selector.
        const AFTER_NESTING = 1 << 7;

        const AFTER_WEBKIT_SCROLLBAR = 1 << 8;
        const AFTER_VIEW_TRANSITION = 1 << 9;
        const AFTER_UNKNOWN_PSEUDO_ELEMENT = 1 << 10;
    }
}

impl SelectorParsingState {
    /// Whether we are after any of the pseudo-like things.
    pub fn after_any_pseudo(self) -> bool {
        self.intersects(Self::AFTER_PART | Self::AFTER_SLOTTED | Self::AFTER_PSEUDO_ELEMENT)
    }

    pub fn allows_pseudos(self) -> bool {
        !self.contains(Self::AFTER_PSEUDO_ELEMENT) && !self.contains(Self::DISALLOW_PSEUDOS)
    }

    pub fn allows_part(self) -> bool {
        !self.contains(Self::DISALLOW_PSEUDOS) && !self.after_any_pseudo()
    }

    pub fn allows_slotted(self) -> bool {
        self.allows_part()
    }

    pub fn allows_tree_structural_pseudo_classes(self) -> bool {
        !self.after_any_pseudo()
    }

    pub fn allows_non_functional_pseudo_classes(self) -> bool {
        !self.contains(Self::AFTER_SLOTTED) && !self.contains(Self::AFTER_NON_STATEFUL_PSEUDO_ELEMENT)
    }

    pub fn allows_combinators(self) -> bool {
        !self.contains(Self::DISALLOW_COMBINATORS)
    }

    pub fn allows_custom_functional_pseudo_classes(self) -> bool {
        !self.after_any_pseudo()
    }
}

// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SpecificityAndFlags {
    /// There are two free bits here, since we use ten bits for each specificity
    /// kind (id, class, element).
    pub specificity: u32,
    /// There's padding after this field due to the size of the flags.
    pub flags: SelectorFlags,
}

impl SpecificityAndFlags {
    pub fn eql(&self, other: &Self) -> bool {
        css::implement_eql(self, other)
    }
    pub fn has_pseudo_element(&self) -> bool {
        self.flags.contains(SelectorFlags::HAS_PSEUDO)
    }
    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
    pub fn deep_clone(&self) -> Self {
        *self
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct SelectorFlags: u8 {
        const HAS_PSEUDO = 1 << 0;
        const HAS_SLOTTED = 1 << 1;
        const HAS_PART = 1 << 2;
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NestingRequirement {
    None,
    Prefixed,
    Contained,
    Implicit,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Combinator {
    Child,       // >
    Descendant,  // space
    NextSibling, // +
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

    /// Do not call this! Use `serializer::serialize_combinator()` or
    /// `tocss_servo::to_css_combinator()` instead.
    #[deprecated = "use serializer::serialize_combinator()"]
    pub fn to_css(&self, _dest: &mut Printer) -> Result<(), PrintErr> {
        unreachable!("use serializer::serialize_combinator()");
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

#[derive(Clone)]
pub enum SelectorParseErrorKind {
    InvalidState,
    ClassNeedsIdent(Token),
    PseudoElementExpectedIdent(Token),
    UnsupportedPseudoClassOrElement(Str),
    NoQualifiedNameInAttributeSelector(Token),
    UnexpectedTokenInAttributeSelector(Token),
    UnexpectedSelectorAfterPseudoElement(Token),
    InvalidQualNameInAttr(Token),
    ExpectedBarInAttr(Token),
    EmptySelector,
    DanglingCombinator,
    InvalidPseudoClassBeforeWebkitScrollbar,
    InvalidPseudoClassAfterWebkitScrollbar,
    InvalidPseudoClassAfterPseudoElement,
    MissingNestingSelector,
    MissingNestingPrefix,
    ExpectedNamespace(Str),
    BadValueInAttr(Token),
    ExplicitNamespaceUnexpectedToken(Token),
    UnexpectedIdent(Str),
    AmbiguousCssModuleClass(Str),
}

impl SelectorParseErrorKind {
    pub fn into_default_parser_error(self) -> css::ParserError {
        css::ParserError::SelectorError(self.into_selector_error())
    }

    pub fn into_selector_error(self) -> css::SelectorError {
        use css::SelectorError as S;
        use SelectorParseErrorKind as K;
        match self {
            K::InvalidState => S::InvalidState,
            K::ClassNeedsIdent(token) => S::ClassNeedsIdent(token),
            K::PseudoElementExpectedIdent(token) => S::PseudoElementExpectedIdent(token),
            K::UnsupportedPseudoClassOrElement(name) => S::UnsupportedPseudoClassOrElement(name),
            K::NoQualifiedNameInAttributeSelector(token) => S::NoQualifiedNameInAttributeSelector(token),
            K::UnexpectedTokenInAttributeSelector(token) => S::UnexpectedTokenInAttributeSelector(token),
            K::InvalidQualNameInAttr(token) => S::InvalidQualNameInAttr(token),
            K::ExpectedBarInAttr(token) => S::ExpectedBarInAttr(token),
            K::EmptySelector => S::EmptySelector,
            K::DanglingCombinator => S::DanglingCombinator,
            K::InvalidPseudoClassBeforeWebkitScrollbar => S::InvalidPseudoClassBeforeWebkitScrollbar,
            K::InvalidPseudoClassAfterWebkitScrollbar => S::InvalidPseudoClassAfterWebkitScrollbar,
            K::InvalidPseudoClassAfterPseudoElement => S::InvalidPseudoClassAfterPseudoElement,
            K::MissingNestingSelector => S::MissingNestingSelector,
            K::MissingNestingPrefix => S::MissingNestingPrefix,
            K::ExpectedNamespace(name) => S::ExpectedNamespace(name),
            K::BadValueInAttr(token) => S::BadValueInAttr(token),
            K::ExplicitNamespaceUnexpectedToken(token) => S::ExplicitNamespaceUnexpectedToken(token),
            K::UnexpectedIdent(ident) => S::UnexpectedIdent(ident),
            K::UnexpectedSelectorAfterPseudoElement(tok) => S::UnexpectedSelectorAfterPseudoElement(tok),
            K::AmbiguousCssModuleClass(name) => S::AmbiguousCssModuleClass(name),
        }
    }
}

pub enum SimpleSelectorParseResult<Impl: SelectorImpl> {
    SimpleSelector(GenericComponent<Impl>),
    PseudoElement(Impl::PseudoElement),
    SlottedPseudo(GenericSelector<Impl>),
    // todo_stuff.think_mem_mgmt
    PartPseudo(Box<[Impl::Identifier]>),
}

/// A pseudo element.
#[derive(Clone, PartialEq)]
pub enum PseudoElement {
    /// The [::after](https://drafts.csswg.org/css-pseudo-4/#selectordef-after) pseudo element.
    After,
    /// The [::before](https://drafts.csswg.org/css-pseudo-4/#selectordef-before) pseudo element.
    Before,
    /// The [::first-line](https://drafts.csswg.org/css-pseudo-4/#first-line-pseudo) pseudo element.
    FirstLine,
    /// The [::first-letter](https://drafts.csswg.org/css-pseudo-4/#first-letter-pseudo) pseudo element.
    FirstLetter,
    /// The [::selection](https://drafts.csswg.org/css-pseudo-4/#selectordef-selection) pseudo element.
    Selection(css::VendorPrefix),
    /// The [::placeholder](https://drafts.csswg.org/css-pseudo-4/#placeholder-pseudo) pseudo element.
    Placeholder(css::VendorPrefix),
    /// The [::marker](https://drafts.csswg.org/css-pseudo-4/#marker-pseudo) pseudo element.
    Marker,
    /// The [::backdrop](https://fullscreen.spec.whatwg.org/#::backdrop-pseudo-element) pseudo element.
    Backdrop(css::VendorPrefix),
    /// The [::file-selector-button](https://drafts.csswg.org/css-pseudo-4/#file-selector-button-pseudo) pseudo element.
    FileSelectorButton(css::VendorPrefix),
    /// A [webkit scrollbar](https://webkit.org/blog/363/styling-scrollbars/) pseudo element.
    WebkitScrollbar(WebKitScrollbarPseudoElement),
    /// The [::cue](https://w3c.github.io/webvtt/#the-cue-pseudo-element) pseudo element.
    Cue,
    /// The [::cue-region](https://w3c.github.io/webvtt/#the-cue-region-pseudo-element) pseudo element.
    CueRegion,
    /// The [::cue()](https://w3c.github.io/webvtt/#cue-selector) functional pseudo element.
    CueFunction {
        /// The selector argument.
        selector: Box<Selector>,
    },
    /// The [::cue-region()](https://w3c.github.io/webvtt/#cue-region-selector) functional pseudo element.
    CueRegionFunction {
        /// The selector argument.
        selector: Box<Selector>,
    },
    /// The [::view-transition](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition) pseudo element.
    ViewTransition,
    /// The [::view-transition-group()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-group-pt-name-selector) functional pseudo element.
    ViewTransitionGroup {
        /// A part name selector.
        part_name: ViewTransitionPartName,
    },
    /// The [::view-transition-image-pair()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-image-pair-pt-name-selector) functional pseudo element.
    ViewTransitionImagePair {
        /// A part name selector.
        part_name: ViewTransitionPartName,
    },
    /// The [::view-transition-old()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-old-pt-name-selector) functional pseudo element.
    ViewTransitionOld {
        /// A part name selector.
        part_name: ViewTransitionPartName,
    },
    /// The [::view-transition-new()](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#view-transition-new-pt-name-selector) functional pseudo element.
    ViewTransitionNew {
        /// A part name selector.
        part_name: ViewTransitionPartName,
    },
    /// An unknown pseudo element.
    Custom {
        /// The name of the pseudo element.
        name: Str,
    },
    /// An unknown functional pseudo element.
    CustomFunction {
        /// The name of the pseudo element.
        name: Str,
        /// The arguments of the pseudo element function.
        arguments: TokenList,
    },
}

impl PseudoElement {
    pub fn is_equivalent(&self, other: &PseudoElement) -> bool {
        use PseudoElement as PE;
        if matches!(self, PE::Selection(_)) && matches!(other, PE::Selection(_)) { return true; }
        if matches!(self, PE::Placeholder(_)) && matches!(other, PE::Placeholder(_)) { return true; }
        if matches!(self, PE::Backdrop(_)) && matches!(other, PE::Backdrop(_)) { return true; }
        if matches!(self, PE::FileSelectorButton(_)) && matches!(other, PE::FileSelectorButton(_)) { return true; }
        self.eql(other)
    }

    pub fn eql(&self, other: &PseudoElement) -> bool {
        css::implement_eql(self, other)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }

    pub fn get_necessary_prefixes(&mut self, targets: css::targets::Targets) -> css::VendorPrefix {
        use css::prefixes::Feature as F;
        use PseudoElement as PE;
        let (p, feature): (&mut css::VendorPrefix, F) = match self {
            PE::Selection(p) => (p, F::PseudoElementSelection),
            PE::Placeholder(p) => (p, F::PseudoElementPlaceholder),
            PE::Backdrop(p) => (p, F::PseudoElementBackdrop),
            PE::FileSelectorButton(p) => (p, F::PseudoElementFileSelectorButton),
            _ => return css::VendorPrefix::empty(),
        };
        *p = targets.prefixes(*p, feature);
        *p
    }

    pub fn get_prefix(&self) -> css::VendorPrefix {
        use PseudoElement as PE;
        match self {
            PE::Selection(p) | PE::Placeholder(p) | PE::Backdrop(p) | PE::FileSelectorButton(p) => *p,
            _ => css::VendorPrefix::empty(),
        }
    }

    pub fn valid_after_slotted(&self) -> bool {
        use PseudoElement as PE;
        matches!(self, PE::Before | PE::After | PE::Marker | PE::Placeholder(_) | PE::FileSelectorButton(_))
    }

    pub fn is_unknown(&self) -> bool {
        matches!(self, PseudoElement::Custom { .. } | PseudoElement::CustomFunction { .. })
    }

    pub fn accepts_state_pseudo_classes(&self) -> bool {
        let _ = self;
        // Be lienient.
        true
    }

    pub fn is_webkit_scrollbar(&self) -> bool {
        matches!(self, PseudoElement::WebkitScrollbar(_))
    }

    pub fn is_view_transition(&self) -> bool {
        use PseudoElement as PE;
        matches!(
            self,
            PE::ViewTransitionGroup { .. }
                | PE::ViewTransitionImagePair { .. }
                | PE::ViewTransitionNew { .. }
                | PE::ViewTransitionOld { .. }
        )
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // PERF(alloc): I don't like making small allocations here for the string.
        // TODO(port): see PseudoClass::to_css note.
        let mut s: Vec<u8> = Vec::new();
        let mut printer = Printer::new_buffered(&mut s, css::PrinterOptions::default(), dest.import_info, dest.local_names, dest.symbols);
        serialize::serialize_pseudo_element(self, &mut printer, None)?;
        dest.write_str_bytes(&s)
    }
}

impl fmt::Display for PseudoElement {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // TODO(port): @tagName — needs strum::IntoStaticStr; Phase B.
        write!(f, "<pseudo_element>")
    }
}

/// An enum for the different types of :nth- pseudoclasses
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
    pub fn is_only(self) -> bool {
        self == NthType::OnlyChild || self == NthType::OnlyOfType
    }

    pub fn is_of_type(self) -> bool {
        self == NthType::OfType || self == NthType::LastOfType || self == NthType::OnlyOfType
    }

    pub fn is_from_end(self) -> bool {
        self == NthType::LastChild || self == NthType::LastOfType || self == NthType::LastCol
    }

    pub fn allows_of_selector(self) -> bool {
        self == NthType::Child || self == NthType::LastChild
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// parse_type_selector / parse_one_simple_selector / parse_attribute_selector
// ─────────────────────────────────────────────────────────────────────────────

/// * `Err(())`: Invalid selector, abort
/// * `Ok(false)`: Not a type selector, could be something else. `input` was not consumed.
/// * `Ok(true)`: Length 0 (`*|*`), 1 (`*|E` or `ns|*`) or 2 (`|E` or `ns|E`)
pub fn parse_type_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: SelectorParsingState,
    sink: &mut SelectorBuilder<Impl>,
) -> CResult<bool> {
    let result = match parse_qualified_name::<Impl>(parser, input, false) {
        Ok(v) => v,
        Err(e) => {
            if matches!(e.kind, css::ParseErrorKind::Basic(css::BasicParseErrorKind::EndOfInput)) {
                return Ok(false);
            }
            return Err(e);
        }
    };

    let (namespace, local_name) = match result {
        OptionalQName::None(_) => return Ok(false),
        OptionalQName::Some(ns, ln) => (ns, ln),
    };

    if state.after_any_pseudo() {
        return Err(input.new_custom_error(
            SelectorParseErrorKind::InvalidState.into_default_parser_error(),
        ));
    }

    match namespace {
        QNamePrefix::ImplicitAnyNamespace => {}
        QNamePrefix::ImplicitDefaultNamespace(url) => {
            sink.push_simple_selector(GenericComponent::DefaultNamespace(url));
        }
        QNamePrefix::ExplicitNamespace(prefix, url) => {
            let component: GenericComponent<Impl> = 'component: {
                if let Some(default_url) = parser.default_namespace() {
                    if url == default_url {
                        break 'component GenericComponent::DefaultNamespace(url);
                    }
                }
                GenericComponent::Namespace { prefix, url }
            };
            sink.push_simple_selector(component);
        }
        QNamePrefix::ExplicitNoNamespace => {
            sink.push_simple_selector(GenericComponent::ExplicitNoNamespace);
        }
        QNamePrefix::ExplicitAnyNamespace => {
            // Element type selectors that have no namespace
            // component (no namespace separator) represent elements
            // without regard to the element's namespace (equivalent
            // to "*|") unless a default namespace has been declared
            // for namespaced selectors (e.g. in CSS, in the style
            // sheet). If a default namespace has been declared,
            // such selectors will represent only elements in the
            // default namespace.
            // -- Selectors § 6.1.1
            // So we'll have this act the same as the
            // QNamePrefix::ImplicitAnyNamespace case.
            // For lightning css this logic was removed, should be handled when matching.
            sink.push_simple_selector(GenericComponent::ExplicitAnyNamespace);
        }
        QNamePrefix::ImplicitNoNamespace => {
            unreachable!("Should not be returned with in_attr_selector = false");
        }
    }

    if let Some(name) = local_name {
        sink.push_simple_selector(GenericComponent::LocalName(LocalName {
            lower_name: {
                // PERF: check if it's already lowercase
                // PERF(port): was arena alloc — profile in Phase B
                let mut lowercase = vec![0u8; name.len()];
                Ident { v: strings::copy_lowercase(name, &mut lowercase[..]).into() }
                // TODO(port): `copy_lowercase` returns the slice into `lowercase`; in Zig the
                // arena owns the buffer. Phase B: bump-alloc and store `&'bump [u8]`.
            },
            name: Ident { v: name },
        }));
    } else {
        sink.push_simple_selector(GenericComponent::ExplicitUniversalType);
    }

    Ok(true)
}

/// Parse a simple selector other than a type selector.
///
/// * `Err(())`: Invalid selector, abort
/// * `Ok(None)`: Not a simple selector, could be something else. `input` was not consumed.
/// * `Ok(Some(_))`: Parsed a simple selector or pseudo-element
pub fn parse_one_simple_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
) -> CResult<Option<SimpleSelectorParseResult<Impl>>> {
    type S<Impl> = SimpleSelectorParseResult<Impl>;

    let start = input.state();
    let token_location = input.current_source_location();
    let token_loc = input.position();
    let token = match input.next_including_whitespace() {
        Ok(v) => v.clone(),
        Err(_) => {
            input.reset(&start);
            return Ok(None);
        }
    };

    match token {
        Token::IdHash(id) => {
            if state.after_any_pseudo() {
                return Err(token_location.new_custom_error(
                    SelectorParseErrorKind::UnexpectedSelectorAfterPseudoElement(Token::IdHash(id))
                        .into_default_parser_error(),
                ));
            }
            let component = GenericComponent::Id(parser.new_local_identifier(input, css::CssRefTag::ID, id, token_loc));
            return Ok(Some(S::SimpleSelector(component)));
        }
        Token::OpenSquare => {
            if state.after_any_pseudo() {
                return Err(token_location.new_custom_error(
                    SelectorParseErrorKind::UnexpectedSelectorAfterPseudoElement(Token::OpenSquare)
                        .into_default_parser_error(),
                ));
            }
            let attr = input.parse_nested_block(|input2: &mut CssParser| {
                parse_attribute_selector::<Impl>(parser, input2)
            })?;
            return Ok(Some(S::SimpleSelector(attr)));
        }
        Token::Colon => {
            let location = input.current_source_location();
            let (is_single_colon, next_token): (bool, Token) = match input.next_including_whitespace()?.clone() {
                Token::Colon => (false, input.next_including_whitespace()?.clone()),
                t => (true, t),
            };
            let (name, is_functional): (Str, bool) = match next_token {
                Token::Ident(name) => (name, false),
                Token::Function(name) => (name, true),
                t => {
                    let e = SelectorParseErrorKind::PseudoElementExpectedIdent(t);
                    return Err(input.new_custom_error(e.into_default_parser_error()));
                }
            };
            let is_pseudo_element = !is_single_colon || is_css2_pseudo_element(name);
            if is_pseudo_element {
                if !state.allows_pseudos() {
                    return Err(input.new_custom_error(
                        SelectorParseErrorKind::InvalidState.into_default_parser_error(),
                    ));
                }
                let pseudo_element: Impl::PseudoElement = if is_functional {
                    if parser.parse_part() && strings::eql_case_insensitive_ascii_check_length(name, b"part") {
                        if !state.allows_part() {
                            return Err(input.new_custom_error(
                                SelectorParseErrorKind::InvalidState.into_default_parser_error(),
                            ));
                        }

                        let names = input.parse_nested_block(|input2: &mut CssParser| -> CResult<Box<[Impl::Identifier]>> {
                            // todo_stuff.think_about_mem_mgmt
                            // PERF(port): was arena ArrayList with capacity 1 — profile in Phase B
                            let mut result: Vec<Impl::Identifier> = Vec::with_capacity(1);

                            result.push(Impl::Identifier::from(Ident { v: input2.expect_ident()? }));

                            while !input2.is_exhausted() {
                                result.push(Impl::Identifier::from(Ident { v: input2.expect_ident()? }));
                            }

                            Ok(result.into_boxed_slice())
                        })?;

                        return Ok(Some(S::PartPseudo(names)));
                    }

                    if parser.parse_slotted() && strings::eql_case_insensitive_ascii_check_length(name, b"slotted") {
                        if !state.allows_slotted() {
                            return Err(input.new_custom_error(
                                SelectorParseErrorKind::InvalidState.into_default_parser_error(),
                            ));
                        }
                        let selector = input.parse_nested_block(|input2: &mut CssParser| {
                            parse_inner_compound_selector::<Impl>(parser, input2, state)
                        })?;
                        return Ok(Some(S::SlottedPseudo(selector)));
                    }

                    input.parse_nested_block(|i: &mut CssParser| {
                        parser.parse_functional_pseudo_element(name, i)
                    })?
                    // TODO(port): `Impl::PseudoElement` is `PseudoElement` for the concrete
                    // `impl_::Selectors`; the generic path needs a `From`/trait bound in Phase B.
                } else {
                    parser.parse_pseudo_element(location, name)?
                };

                if state.contains(SelectorParsingState::AFTER_SLOTTED) && pseudo_element.valid_after_slotted() {
                    return Ok(Some(S::PseudoElement(pseudo_element)));
                }

                return Ok(Some(S::PseudoElement(pseudo_element)));
            } else {
                let pseudo_class: GenericComponent<Impl> = if is_functional {
                    input.parse_nested_block(|input2: &mut CssParser| {
                        parse_functional_pseudo_class::<Impl>(parser, input2, name, state)
                    })?
                } else {
                    parse_simple_pseudo_class::<Impl>(parser, location, name, *state)?
                };
                return Ok(Some(S::SimpleSelector(pseudo_class)));
            }
        }
        Token::Delim(d) => match d {
            '.' => {
                if state.after_any_pseudo() {
                    return Err(token_location.new_custom_error(
                        SelectorParseErrorKind::UnexpectedSelectorAfterPseudoElement(Token::Delim('.'))
                            .into_default_parser_error(),
                    ));
                }
                let location = input.current_source_location();
                let class = match input.next_including_whitespace()?.clone() {
                    Token::Ident(class) => class,
                    t => {
                        let e = SelectorParseErrorKind::ClassNeedsIdent(t);
                        return Err(location.new_custom_error(e.into_default_parser_error()));
                    }
                };
                return Ok(Some(S::SimpleSelector(GenericComponent::Class(
                    parser.new_local_identifier(input, css::CssRefTag::CLASS, class, token_loc),
                ))));
            }
            '&' => {
                if parser.is_nesting_allowed() {
                    state.insert(SelectorParsingState::AFTER_NESTING);
                    return Ok(Some(S::SimpleSelector(GenericComponent::Nesting)));
                }
            }
            _ => {}
        },
        _ => {}
    }

    input.reset(&start);
    Ok(None)
}

pub fn parse_attribute_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
) -> CResult<GenericComponent<Impl>> {
    type N<Impl> = attrs::NamespaceConstraint<attrs::NamespaceUrl<Impl>>;

    let (namespace, local_name): (Option<N<Impl>>, Str) = 'brk: {
        input.skip_whitespace();

        let qname = parse_qualified_name::<Impl>(parser, input, true)?;
        match qname {
            OptionalQName::None(t) => {
                return Err(input.new_custom_error(
                    SelectorParseErrorKind::NoQualifiedNameInAttributeSelector(t)
                        .into_default_parser_error(),
                ));
            }
            OptionalQName::Some(ns, ln) => {
                let ln = ln.unwrap_or_else(|| unreachable!());
                break 'brk (
                    match ns {
                        QNamePrefix::ImplicitNoNamespace | QNamePrefix::ExplicitNoNamespace => None,
                        QNamePrefix::ExplicitNamespace(prefix, url) => {
                            Some(attrs::NamespaceConstraint::Specific(attrs::NamespaceUrl { prefix, url }))
                        }
                        QNamePrefix::ExplicitAnyNamespace => Some(attrs::NamespaceConstraint::Any),
                        QNamePrefix::ImplicitAnyNamespace | QNamePrefix::ImplicitDefaultNamespace(_) => {
                            unreachable!("Not returned with in_attr_selector = true");
                        }
                    },
                    ln,
                );
            }
        }
    };

    let location = input.current_source_location();
    let operator: attrs::AttrSelectorOperator = 'operator: {
        let tok = match input.next() {
            Ok(v) => v.clone(),
            Err(_) => {
                // [foo]
                let local_name_lower: Str = {
                    // PERF(port): was arena alloc — profile in Phase B
                    let mut lower = vec![0u8; local_name.len()];
                    let _ = strings::copy_lowercase(local_name, &mut lower);
                    lower.into()
                    // TODO(port): arena lifetime for lowercased name
                };
                if let Some(ns) = namespace {
                    let x = attrs::AttrSelectorWithOptionalNamespace::<Impl> {
                        namespace: Some(ns),
                        local_name: Ident { v: local_name }.into(),
                        local_name_lower: Ident { v: local_name_lower }.into(),
                        never_matches: false,
                        operation: attrs::ParsedAttrSelectorOperation::Exists,
                    };
                    return Ok(GenericComponent::AttributeOther(Box::new(x)));
                } else {
                    return Ok(GenericComponent::AttributeInNoNamespaceExists {
                        local_name: Ident { v: local_name }.into(),
                        local_name_lower: Ident { v: local_name_lower }.into(),
                    });
                }
            }
        };

        match tok {
            // [foo=bar]
            Token::Delim(d) if d == '=' => break 'operator attrs::AttrSelectorOperator::Equal,
            // [foo~=bar]
            Token::IncludeMatch => break 'operator attrs::AttrSelectorOperator::Includes,
            // [foo|=bar]
            Token::DashMatch => break 'operator attrs::AttrSelectorOperator::DashMatch,
            // [foo^=bar]
            Token::PrefixMatch => break 'operator attrs::AttrSelectorOperator::Prefix,
            // [foo*=bar]
            Token::SubstringMatch => break 'operator attrs::AttrSelectorOperator::Substring,
            // [foo$=bar]
            Token::SuffixMatch => break 'operator attrs::AttrSelectorOperator::Suffix,
            _ => {}
        }
        return Err(location.new_custom_error(
            SelectorParseErrorKind::UnexpectedTokenInAttributeSelector(tok)
                .into_default_parser_error(),
        ));
    };

    let value_str: Str = match input.expect_ident_or_string() {
        Ok(v) => v,
        Err(e) => {
            if let css::ParseErrorKind::Basic(css::BasicParseErrorKind::UnexpectedToken(tok)) = &e.kind {
                return Err(e.location.new_custom_error(
                    SelectorParseErrorKind::BadValueInAttr(tok.clone()).into_default_parser_error(),
                ));
            }
            return Err(css::ParseError { kind: e.kind, location: e.location });
        }
    };
    let never_matches = match operator {
        attrs::AttrSelectorOperator::Equal | attrs::AttrSelectorOperator::DashMatch => false,
        attrs::AttrSelectorOperator::Includes => {
            value_str.is_empty() || strings::index_of_any(value_str, SELECTOR_WHITESPACE).is_some()
        }
        attrs::AttrSelectorOperator::Prefix
        | attrs::AttrSelectorOperator::Substring
        | attrs::AttrSelectorOperator::Suffix => value_str.is_empty(),
    };

    let attribute_flags = parse_attribute_flags(input)?;

    let value: Impl::AttrValue = value_str.into();
    let (local_name_lower, local_name_is_ascii_lowercase): (Impl::LocalName, bool) = 'brk: {
        let first_uppercase = 'a: {
            for (i, &b) in local_name.iter().enumerate() {
                if b >= b'A' && b <= b'Z' {
                    break 'a Some(i);
                }
            }
            None
        };
        if let Some(first_uppercase) = first_uppercase {
            let str_ = &local_name[first_uppercase..];
            // PERF(port): was arena alloc — profile in Phase B
            let mut lower = vec![0u8; str_.len()];
            let lowered: Str = strings::copy_lowercase(str_, &mut lower).into();
            // TODO(port): arena lifetime
            break 'brk (Ident { v: lowered }.into(), false);
        } else {
            break 'brk (Ident { v: local_name }.into(), true);
        }
    };
    let case_sensitivity: attrs::ParsedCaseSensitivity =
        attribute_flags.to_case_sensitivity(local_name_lower.as_bytes(), namespace.is_some());
    // TODO(port): `local_name_lower.v` access — Zig used `.v`; Phase B confirm `LocalName` shape.
    if namespace.is_some() && !local_name_is_ascii_lowercase {
        Ok(GenericComponent::AttributeOther(Box::new(
            attrs::AttrSelectorWithOptionalNamespace::<Impl> {
                namespace,
                local_name: Ident { v: local_name }.into(),
                local_name_lower,
                never_matches,
                operation: attrs::ParsedAttrSelectorOperation::WithValue {
                    operator,
                    case_sensitivity,
                    expected_value: value,
                },
            },
        )))
    } else {
        Ok(GenericComponent::AttributeInNoNamespace {
            local_name: Ident { v: local_name }.into(),
            operator,
            value,
            case_sensitivity,
            never_matches,
        })
    }
}

/// Returns whether the name corresponds to a CSS2 pseudo-element that
/// can be specified with the single colon syntax (in addition to the
/// double-colon syntax, which can be used for all pseudo-elements).
pub fn is_css2_pseudo_element(name: &[u8]) -> bool {
    // ** Do not add to this list! **
    // TODO: todo_stuff.match_ignore_ascii_case
    strings::eql_case_insensitive_ascii_check_length(name, b"before")
        || strings::eql_case_insensitive_ascii_check_length(name, b"after")
        || strings::eql_case_insensitive_ascii_check_length(name, b"first-line")
        || strings::eql_case_insensitive_ascii_check_length(name, b"first-letter")
}

/// Parses one compound selector suitable for nested stuff like :-moz-any, etc.
pub fn parse_inner_compound_selector<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
) -> CResult<GenericSelector<Impl>> {
    let mut child_state = {
        let mut child_state = *state;
        child_state.insert(SelectorParsingState::DISALLOW_PSEUDOS);
        child_state.insert(SelectorParsingState::DISALLOW_COMBINATORS);
        child_state
    };
    let result = parse_selector::<Impl>(parser, input, &mut child_state, NestingRequirement::None)?;
    if child_state.contains(SelectorParsingState::AFTER_NESTING) {
        state.insert(SelectorParsingState::AFTER_NESTING);
    }
    Ok(result)
}

pub fn parse_functional_pseudo_class<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    name: Str,
    state: &mut SelectorParsingState,
) -> CResult<GenericComponent<Impl>> {
    // TODO(port): phf custom hasher — Zig used `ComptimeEnumMap.getASCIIICaseInsensitive`.
    macro_rules! eq {
        ($lit:literal) => {
            strings::eql_case_insensitive_ascii_check_length(name, $lit)
        };
    }
    if eq!(b"nth-child") {
        return parse_nth_pseudo_class::<Impl>(parser, input, *state, NthType::Child);
    } else if eq!(b"nth-of-type") {
        return parse_nth_pseudo_class::<Impl>(parser, input, *state, NthType::OfType);
    } else if eq!(b"nth-last-child") {
        return parse_nth_pseudo_class::<Impl>(parser, input, *state, NthType::LastChild);
    } else if eq!(b"nth-last-of-type") {
        return parse_nth_pseudo_class::<Impl>(parser, input, *state, NthType::LastOfType);
    } else if eq!(b"nth-col") {
        return parse_nth_pseudo_class::<Impl>(parser, input, *state, NthType::Col);
    } else if eq!(b"nth-last-col") {
        return parse_nth_pseudo_class::<Impl>(parser, input, *state, NthType::LastCol);
    } else if eq!(b"is") {
        if parser.parse_is_and_where() {
            return parse_is_or_where::<Impl, _>(parser, input, state, |s| GenericComponent::convert_helper_is(s));
        }
    } else if eq!(b"where") {
        if parser.parse_is_and_where() {
            return parse_is_or_where::<Impl, _>(parser, input, state, |s| GenericComponent::convert_helper_where(s));
        }
    } else if eq!(b"has") {
        return parse_has::<Impl>(parser, input, state);
    } else if eq!(b"host") {
        if !state.allows_tree_structural_pseudo_classes() {
            return Err(input.new_custom_error(
                SelectorParseErrorKind::InvalidState.into_default_parser_error(),
            ));
        }
        return Ok(GenericComponent::Host(Some(
            parse_inner_compound_selector::<Impl>(parser, input, state)?,
        )));
    } else if eq!(b"not") {
        return parse_negation::<Impl>(parser, input, state);
    }

    if let Some(prefix) = parser.parse_any_prefix(name) {
        return parse_is_or_where::<Impl, _>(parser, input, state, move |s| {
            GenericComponent::convert_helper_any(s, prefix)
        });
    }

    if !state.allows_custom_functional_pseudo_classes() {
        return Err(input.new_custom_error(
            SelectorParseErrorKind::InvalidState.into_default_parser_error(),
        ));
    }

    let result = parser.parse_non_ts_functional_pseudo_class(name, input)?;

    Ok(GenericComponent::NonTsPseudoClass(result.into()))
    // TODO(port): `Impl::NonTSPseudoClass` is `PseudoClass` for the concrete impl;
    // generic path needs a `From` bound in Phase B.
}

pub fn parse_simple_pseudo_class<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    location: css::SourceLocation,
    name: Str,
    state: SelectorParsingState,
) -> CResult<GenericComponent<Impl>> {
    if !state.allows_non_functional_pseudo_classes() {
        return Err(location.new_custom_error(
            SelectorParseErrorKind::InvalidState.into_default_parser_error(),
        ));
    }

    if state.allows_tree_structural_pseudo_classes() {
        // TODO(port): phf custom hasher — Zig used `ComptimeEnumMap.getAnyCase`.
        macro_rules! eq {
            ($lit:literal) => {
                strings::eql_case_insensitive_ascii_check_length(name, $lit)
            };
        }
        if eq!(b"first-child") { return Ok(GenericComponent::Nth(NthSelectorData::first(false))); }
        if eq!(b"last-child") { return Ok(GenericComponent::Nth(NthSelectorData::last(false))); }
        if eq!(b"only-child") { return Ok(GenericComponent::Nth(NthSelectorData::only(false))); }
        if eq!(b"root") { return Ok(GenericComponent::Root); }
        if eq!(b"empty") { return Ok(GenericComponent::Empty); }
        if eq!(b"scope") { return Ok(GenericComponent::Scope); }
        if eq!(b"host") {
            if parser.parse_host() {
                return Ok(GenericComponent::Host(None));
            }
        }
        if eq!(b"first-of-type") { return Ok(GenericComponent::Nth(NthSelectorData::first(true))); }
        if eq!(b"last-of-type") { return Ok(GenericComponent::Nth(NthSelectorData::last(true))); }
        if eq!(b"only-of-type") { return Ok(GenericComponent::Nth(NthSelectorData::only(true))); }
    }

    // The view-transition pseudo elements accept the :only-child pseudo class.
    // https://w3c.github.io/csswg-drafts/css-view-transitions-1/#pseudo-root
    if state.contains(SelectorParsingState::AFTER_VIEW_TRANSITION) {
        if strings::eql_case_insensitive_ascii_check_length(name, b"only-child") {
            return Ok(GenericComponent::Nth(NthSelectorData::only(false)));
        }
    }

    let pseudo_class = parser.parse_non_ts_pseudo_class(location, name)?;
    if state.contains(SelectorParsingState::AFTER_WEBKIT_SCROLLBAR) {
        if !pseudo_class.is_valid_after_webkit_scrollbar() {
            return Err(location.new_custom_error(
                SelectorParseErrorKind::InvalidPseudoClassAfterWebkitScrollbar.into_default_parser_error(),
            ));
        }
    } else if state.contains(SelectorParsingState::AFTER_PSEUDO_ELEMENT) {
        if !pseudo_class.is_user_action_state() {
            return Err(location.new_custom_error(
                SelectorParseErrorKind::InvalidPseudoClassAfterPseudoElement.into_default_parser_error(),
            ));
        }
    } else if !pseudo_class.is_valid_before_webkit_scrollbar() {
        return Err(location.new_custom_error(
            SelectorParseErrorKind::InvalidPseudoClassBeforeWebkitScrollbar.into_default_parser_error(),
        ));
    }

    Ok(GenericComponent::NonTsPseudoClass(pseudo_class.into()))
}

pub fn parse_nth_pseudo_class<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: SelectorParsingState,
    ty: NthType,
) -> CResult<GenericComponent<Impl>> {
    if !state.allows_tree_structural_pseudo_classes() {
        return Err(input.new_custom_error(
            SelectorParseErrorKind::InvalidState.into_default_parser_error(),
        ));
    }

    let (a, b) = css::nth::parse_nth(input)?;
    let nth_data = NthSelectorData { ty, is_function: true, a, b };

    if !ty.allows_of_selector() {
        return Ok(GenericComponent::Nth(nth_data));
    }

    // Try to parse "of <selector-list>".
    if input.try_parse(|i| i.expect_ident_matching("of")).is_err() {
        return Ok(GenericComponent::Nth(nth_data));
    }

    // Whitespace between "of" and the selector list is optional
    // https://github.com/w3c/csswg-drafts/issues/8285
    let mut child_state = {
        let mut s = state;
        s.insert(SelectorParsingState::SKIP_DEFAULT_NAMESPACE);
        s.insert(SelectorParsingState::DISALLOW_PSEUDOS);
        s
    };

    let selectors = SelectorList::parse_with_state(
        parser,
        input,
        &mut child_state,
        ParseErrorRecovery::IgnoreInvalidSelector,
        NestingRequirement::None,
    )?;

    Ok(GenericComponent::NthOf(NthOfSelectorData {
        data: nth_data,
        selectors: selectors.v.into_boxed_slice(),
    }))
}

/// `func` must take `Box<[GenericSelector<Impl>]>` (plus any captured extras) and
/// return a `GenericComponent<Impl>`.
pub fn parse_is_or_where<Impl: SelectorImpl, F>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
    func: F,
) -> CResult<GenericComponent<Impl>>
where
    F: FnOnce(Box<[GenericSelector<Impl>]>) -> GenericComponent<Impl>,
{
    debug_assert!(parser.parse_is_and_where());
    // https://drafts.csswg.org/selectors/#matches-pseudo:
    //
    //     Pseudo-elements cannot be represented by the matches-any
    //     pseudo-class; they are not valid within :is().
    //
    let mut child_state = {
        let mut child_state = *state;
        child_state.insert(SelectorParsingState::SKIP_DEFAULT_NAMESPACE);
        child_state.insert(SelectorParsingState::DISALLOW_PSEUDOS);
        child_state
    };

    let inner = SelectorList::parse_with_state(
        parser,
        input,
        &mut child_state,
        parser.is_and_where_error_recovery(),
        NestingRequirement::None,
    )?;
    if child_state.contains(SelectorParsingState::AFTER_NESTING) {
        state.insert(SelectorParsingState::AFTER_NESTING);
    }

    let selector_slice = inner.v.into_boxed_slice();

    // PORT NOTE: Zig threaded extra `args_` through an ArgsTuple to `func`; in Rust
    // the closure captures extras directly (e.g. `prefix` for `:any()`).
    let result = func(selector_slice);

    Ok(result)
}

pub fn parse_has<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
) -> CResult<GenericComponent<Impl>> {
    let mut child_state = *state;
    let inner = SelectorList::parse_relative_with_state(
        parser,
        input,
        &mut child_state,
        parser.is_and_where_error_recovery(),
        NestingRequirement::None,
    )?;

    if child_state.contains(SelectorParsingState::AFTER_NESTING) {
        state.insert(SelectorParsingState::AFTER_NESTING);
    }
    Ok(GenericComponent::Has(inner.v.into_boxed_slice()))
}

/// Level 3: Parse **one** simple_selector.  (Though we might insert a second
/// implied "<defaultns>|*" type selector.)
pub fn parse_negation<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    state: &mut SelectorParsingState,
) -> CResult<GenericComponent<Impl>> {
    let mut child_state = *state;
    child_state.insert(SelectorParsingState::SKIP_DEFAULT_NAMESPACE);
    child_state.insert(SelectorParsingState::DISALLOW_PSEUDOS);

    let list = SelectorList::parse_with_state(
        parser,
        input,
        &mut child_state,
        ParseErrorRecovery::DiscardList,
        NestingRequirement::None,
    )?;

    if child_state.contains(SelectorParsingState::AFTER_NESTING) {
        state.insert(SelectorParsingState::AFTER_NESTING);
    }

    Ok(GenericComponent::Negation(list.v.into_boxed_slice()))
}

pub enum OptionalQName<Impl: SelectorImpl> {
    Some(QNamePrefix<Impl>, Option<Str>),
    None(Token),
}

pub enum QNamePrefix<Impl: SelectorImpl> {
    ImplicitNoNamespace,                                                  // `foo` in attr selectors
    ImplicitAnyNamespace,                                                 // `foo` in type selectors, without a default ns
    ImplicitDefaultNamespace(Impl::NamespaceUrl),                          // `foo` in type selectors, with a default ns
    ExplicitNoNamespace,                                                  // `|foo`
    ExplicitAnyNamespace,                                                 // `*|foo`
    ExplicitNamespace(Impl::NamespacePrefix, Impl::NamespaceUrl),         // `prefix|foo`
}

/// * `Err(())`: Invalid selector, abort
/// * `Ok(None(token))`: Not a simple selector, could be something else. `input` was not consumed,
///                      but the token is still returned.
/// * `Ok(Some(namespace, local_name))`: `None` for the local name means a `*` universal selector
pub fn parse_qualified_name<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    input: &mut CssParser,
    in_attr_selector: bool,
) -> CResult<OptionalQName<Impl>> {
    let start = input.state();

    let tok = match input.next_including_whitespace() {
        Ok(v) => v.clone(),
        Err(e) => {
            input.reset(&start);
            return Err(e);
        }
    };
    match &tok {
        Token::Ident(value) => {
            let value = *value;
            let after_ident = input.state();
            let n = if let Ok(t) = input.next_including_whitespace() {
                matches!(t, Token::Delim('|'))
            } else {
                false
            };
            if n {
                let prefix: Impl::NamespacePrefix = Ident { v: value }.into();
                let result: Option<Impl::NamespaceUrl> = parser.namespace_for_prefix(Ident { v: value }).map(Into::into);
                let url: Impl::NamespaceUrl = match result {
                    Some(url) => url,
                    None => {
                        return Err(input.new_custom_error(
                            SelectorParseErrorKind::UnsupportedPseudoClassOrElement(value)
                                .into_default_parser_error(),
                        ));
                    }
                };
                return parse_qualified_name_eplicit_namespace_helper::<Impl>(
                    input,
                    QNamePrefix::ExplicitNamespace(prefix, url),
                    in_attr_selector,
                );
            } else {
                input.reset(&after_ident);
                if in_attr_selector {
                    return Ok(OptionalQName::Some(QNamePrefix::ImplicitNoNamespace, Some(value)));
                }
                return Ok(parse_qualified_name_default_namespace_helper::<Impl>(parser, Some(value)));
            }
        }
        Token::Delim(c) => match *c {
            '*' => {
                let after_star = input.state();
                let result = input.next_including_whitespace();
                if let Ok(t) = &result {
                    if matches!(t, Token::Delim('|')) {
                        return parse_qualified_name_eplicit_namespace_helper::<Impl>(
                            input,
                            QNamePrefix::ExplicitAnyNamespace,
                            in_attr_selector,
                        );
                    }
                }
                // PORT NOTE: reshaped for borrowck — clone token before reset.
                let result_cloned = result.map(|t| t.clone());
                input.reset(&after_star);
                if in_attr_selector {
                    match result_cloned {
                        Ok(t) => {
                            return Err(after_star.source_location().new_custom_error(
                                SelectorParseErrorKind::ExpectedBarInAttr(t),
                            ));
                        }
                        Err(e) => return Err(e),
                    }
                } else {
                    return Ok(parse_qualified_name_default_namespace_helper::<Impl>(parser, None));
                }
            }
            '|' => {
                return parse_qualified_name_eplicit_namespace_helper::<Impl>(
                    input,
                    QNamePrefix::ExplicitNoNamespace,
                    in_attr_selector,
                );
            }
            _ => {}
        },
        _ => {}
    }
    input.reset(&start);
    Ok(OptionalQName::None(tok))
}

fn parse_qualified_name_default_namespace_helper<Impl: SelectorImpl>(
    parser: &mut SelectorParser,
    local_name: Option<Str>,
) -> OptionalQName<Impl> {
    let namespace: QNamePrefix<Impl> = if let Some(url) = parser.default_namespace() {
        QNamePrefix::ImplicitDefaultNamespace(url)
    } else {
        QNamePrefix::ImplicitAnyNamespace
    };
    OptionalQName::Some(namespace, local_name)
}

fn parse_qualified_name_eplicit_namespace_helper<Impl: SelectorImpl>(
    input: &mut CssParser,
    namespace: QNamePrefix<Impl>,
    in_attr_selector: bool,
) -> CResult<OptionalQName<Impl>> {
    let location = input.current_source_location();
    let t = input.next_including_whitespace()?.clone();
    match &t {
        Token::Ident(local_name) => return Ok(OptionalQName::Some(namespace, Some(*local_name))),
        Token::Delim(c) if *c == '*' => {
            return Ok(OptionalQName::Some(namespace, None));
        }
        _ => {}
    }
    if in_attr_selector {
        let e = SelectorParseErrorKind::InvalidQualNameInAttr(t);
        return Err(location.new_custom_error(e));
    }
    Err(location.new_custom_error(SelectorParseErrorKind::ExplicitNamespaceUnexpectedToken(t)))
}

#[derive(Clone, PartialEq)]
pub struct LocalName<Impl: SelectorImpl> {
    pub name: Impl::LocalName,
    pub lower_name: Impl::LocalName,
}

impl<Impl: SelectorImpl> LocalName<Impl> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        IdentFns::to_css(&self.name, dest)
    }
}

/// An attribute selector can have 's' or 'i' as flags, or no flags at all.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AttributeFlags {
    // Matching should be case-sensitive ('s' flag).
    CaseSensitive,
    // Matching should be case-insensitive ('i' flag).
    AsciiCaseInsensitive,
    // No flags.  Matching behavior depends on the name of the attribute.
    CaseSensitivityDependsOnName,
}

impl AttributeFlags {
    pub fn to_case_sensitivity(self, local_name: &[u8], have_namespace: bool) -> attrs::ParsedCaseSensitivity {
        match self {
            AttributeFlags::CaseSensitive => attrs::ParsedCaseSensitivity::ExplicitCaseSensitive,
            AttributeFlags::AsciiCaseInsensitive => attrs::ParsedCaseSensitivity::AsciiCaseInsensitive,
            AttributeFlags::CaseSensitivityDependsOnName => {
                // <https://html.spec.whatwg.org/multipage/#selectors>
                // TODO(port): phf custom hasher — Zig used `ComptimeEnumMap.has` (case-sensitive).
                static MAP: phf::Set<&'static [u8]> = phf::phf_set! {
                    b"dir", b"http_equiv", b"rel", b"enctype", b"align", b"accept",
                    b"nohref", b"lang", b"bgcolor", b"direction", b"valign", b"checked",
                    b"frame", b"link", b"accept_charset", b"hreflang", b"text",
                    b"valuetype", b"language", b"nowrap", b"vlink", b"disabled",
                    b"noshade", b"codetype", b"defer", b"noresize", b"target",
                    b"scrolling", b"rules", b"scope", b"rev", b"media", b"method",
                    b"charset", b"alink", b"selected", b"multiple", b"color", b"shape",
                    b"type", b"clear", b"compact", b"face", b"declare", b"axis",
                    b"readonly",
                };
                if !have_namespace && MAP.contains(local_name) {
                    return attrs::ParsedCaseSensitivity::AsciiCaseInsensitiveIfInHtmlElementInHtmlDocument;
                }
                attrs::ParsedCaseSensitivity::CaseSensitive
            }
        }
    }
}

/// A [view transition part name](https://w3c.github.io/csswg-drafts/css-view-transitions-1/#typedef-pt-name-selector).
#[derive(Clone, PartialEq)]
pub enum ViewTransitionPartName {
    /// *
    All,
    /// <custom-ident>
    Name(CustomIdent),
    /// .<custom-ident>
    Class(CustomIdent),
}

impl ViewTransitionPartName {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Self::All => dest.write_str("*"),
            Self::Name(name) => css::CustomIdentFns::to_css(name, dest),
            Self::Class(name) => {
                dest.write_char('.')?;
                css::CustomIdentFns::to_css(name, dest)
            }
        }
    }

    pub fn parse(input: &mut CssParser) -> CResult<ViewTransitionPartName> {
        if input.try_parse(|i| i.expect_delim('*')).is_ok() {
            return Ok(Self::All);
        }

        // Try to parse a class selector (.<custom-ident>)
        if input.try_parse(|i| i.expect_delim('.')).is_ok() {
            return Ok(Self::Class(CustomIdent::parse(input)?));
        }

        Ok(Self::Name(CustomIdent::parse(input)?))
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        css::implement_eql(self, rhs)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }

    pub fn deep_clone(&self) -> Self {
        css::implement_deep_clone(self)
    }
}

pub fn parse_attribute_flags(input: &mut CssParser) -> CResult<AttributeFlags> {
    let location = input.current_source_location();
    let token = match input.next() {
        Ok(v) => v.clone(),
        Err(_) => {
            // Selectors spec says language-defined; HTML says it depends on the
            // exact attribute name.
            return Ok(AttributeFlags::CaseSensitivityDependsOnName);
        }
    };

    let ident = if let Token::Ident(ident) = &token {
        *ident
    } else {
        return Err(location.new_basic_unexpected_token_error(token));
    };

    if strings::eql_case_insensitive_ascii_check_length(ident, b"i") {
        Ok(AttributeFlags::AsciiCaseInsensitive)
    } else if strings::eql_case_insensitive_ascii_check_length(ident, b"s") {
        Ok(AttributeFlags::CaseSensitive)
    } else {
        Err(location.new_basic_unexpected_token_error(token))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/selectors/parser.zig (3664 lines)
//   confidence: medium
//   todos:      22
//   notes:      Arena lifetimes deferred (Str/Vec/Box used); ComptimeStringMap/EnumMap → stack-lowercase + phf or linear case-insensitive matchers (phf needs custom hasher); SelectorParsingState → bitflags; closures replace Zig anon-struct callbacks (saw_nesting flag, no raw *mut); Impl::PseudoElement/NonTSPseudoClass coercions need From bounds in Phase B.
// ──────────────────────────────────────────────────────────────────────────
