//! This is the selector builder module ported from the copypasted implementation from
//! servo in lightningcss.
//!
//! -- original comment from servo --
//! Helper module to build up a selector safely and efficiently.
//!
//! Our selector representation is designed to optimize matching, and has
//! several requirements:
//! * All simple selectors and combinators are stored inline in the same buffer
//!   as Component instances.
//! * We store the top-level compound selectors from right to left, i.e. in
//!   matching order.
//! * We store the simple selectors for each combinator from left to right, so
//!   that we match the cheaper simple selectors first.
//!
//! Meeting all these constraints without extra memmove traffic during parsing
//! is non-trivial. This module encapsulates those details and presents an
//! easy-to-use API for the parser.

use crate::SmallList;
pub use crate::{PrintErr, Printer};
use bun_alloc::ArenaPtr;

use crate::selector::parser::{
    BunSelectorImpl as ValidSelectorImpl, Combinator, GenericComponent, SelectorFlags,
    SpecificityAndFlags, compute_specificity,
};

/// Top-level SelectorBuilder struct. This should be stack-allocated by the
/// consumer and never moved (because it contains a lot of inline data that
/// would be slow to memmov).
///
/// After instantiation, callers may call the push_simple_selector() and
/// push_combinator() methods to append selector data as it is encountered
/// (from left to right). Once the process is complete, callers should invoke
/// build(), which transforms the contents of the SelectorBuilder into a heap-
/// allocated Selector and leaves the builder in a drained state.
pub struct SelectorBuilder<'bump, Impl: ValidSelectorImpl<'bump>> {
    /// The entire sequence of simple selectors, from left to right, without combinators.
    ///
    /// We make this large because the result of parsing a selector is fed into a new
    /// Arc-ed allocation, so any spilled vec would be a wasted allocation. Also,
    /// Components are large enough that we don't have much cache locality benefit
    /// from reserving stack space for fewer of them.
    simple_selectors: SmallList<GenericComponent<'bump, Impl>, 32>,

    /// The combinators, and the length of the compound selector to their left.
    combinators: SmallList<(Combinator, usize), 32>,

    /// The length of the current compound selector.
    current_len: usize,

    alloc: ArenaPtr<'bump>,
}

pub(crate) struct BuildResult<'bump, Impl: ValidSelectorImpl<'bump>> {
    pub(crate) specificity_and_flags: SpecificityAndFlags,
    pub(crate) components: Vec<GenericComponent<'bump, Impl>, ArenaPtr<'bump>>,
}

impl<'bump, Impl: ValidSelectorImpl<'bump>> Default for SelectorBuilder<'bump, Impl> {
    #[inline]
    fn default() -> Self {
        Self::init_in(ArenaPtr::global())
    }
}

impl<'bump, Impl: ValidSelectorImpl<'bump>> SelectorBuilder<'bump, Impl> {
    #[inline]
    pub(crate) fn init_in(alloc: ArenaPtr<'bump>) -> Self {
        Self {
            simple_selectors: SmallList::default(),
            combinators: SmallList::default(),
            current_len: 0,
            alloc,
        }
    }

    /// Returns true if combinators have ever been pushed to this builder.
    #[inline]
    pub(crate) fn has_combinators(&self) -> bool {
        self.combinators.len() > 0
    }

    /// Completes the current compound selector and starts a new one, delimited
    /// by the given combinator.
    #[inline]
    pub(crate) fn push_combinator(&mut self, combinator: Combinator) {
        // `SmallList` owns its spill buffer (global arena); the `bump` field
        // is retained for `BuildResult.components` (BumpVec) only.
        self.combinators.append((combinator, self.current_len));
        self.current_len = 0;
    }

    /// Pushes a simple selector onto the current compound selector.
    pub(crate) fn push_simple_selector(&mut self, ss: GenericComponent<'bump, Impl>) {
        debug_assert!(!ss.is_combinator());
        self.simple_selectors.append(ss);
        self.current_len += 1;
    }

    pub(crate) fn last_simple_selector(&self) -> Option<&GenericComponent<'bump, Impl>> {
        self.simple_selectors.last()
    }

    pub(crate) fn add_nesting_prefix(&mut self) {
        self.combinators.insert(0, (Combinator::Descendant, 1));
        self.simple_selectors.insert(0, GenericComponent::Nesting);
    }

    // `SmallList` owns its spill buffer and frees on `Drop`, so no explicit
    // `Drop` impl is needed here.

    /// Consumes the builder, producing a Selector.
    ///
    /// *NOTE*: This will free all allocated memory in the builder
    pub(crate) fn build(&mut self, flags: SelectorFlags) -> BuildResult<'bump, Impl> {
        let specificity = compute_specificity::<Impl>(self.simple_selectors.slice());
        // `build_with_specificity_and_flags()` drains the contents; `Drop` on
        // `SelectorBuilder` frees the SmallList capacity when the builder goes
        // out of scope.
        self.build_with_specificity_and_flags(SpecificityAndFlags { specificity, flags })
    }

    /// Builds a selector with the given specificity and flags.
    ///
    /// PERF:
    /// Recall that this code is ported from servo, which optimizes for matching speed, so
    /// the final AST has the components of the selector stored in reverse order, which is
    /// optimized for matching.
    ///
    /// We don't really care about matching selectors, and storing the components in reverse
    /// order requires additional allocations, and undoing the reversal when serializing the
    /// selector. So we could just change this code to store the components in the same order
    /// as the source.
    fn build_with_specificity_and_flags(
        &mut self,
        spec: SpecificityAndFlags,
    ) -> BuildResult<'bump, Impl> {
        let mut components = Vec::new_in(self.alloc);

        let mut compound_len = self.current_len;
        loop {
            let start = self.simple_selectors.0.len() - compound_len;
            for component in self.simple_selectors.0.drain(start..) {
                components.push(component);
            }
            let Some((combinator, len)) = self.combinators.pop() else {
                break;
            };
            components.push(GenericComponent::Combinator(combinator));
            compound_len = len;
        }

        BuildResult {
            specificity_and_flags: spec,
            components,
        }
    }
}
