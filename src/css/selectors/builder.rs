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
// PORT NOTE: Zig threaded `arena: Allocator` and built `components` into
// an arena `ArrayList`. Phase A: `GenericSelector.components` is a std `Vec`
// (see parser.rs `// PERF(port): was arena ArrayList`), so the builder uses
// std `Vec` for the result and drops the `&'bump Arena` field. Phase B
// re-threads `'bump` once `GenericSelector.components` becomes
// `bun_alloc::ArenaVec<'bump, _>`.
pub struct SelectorBuilder<Impl: ValidSelectorImpl> {
    /// The entire sequence of simple selectors, from left to right, without combinators.
    ///
    /// We make this large because the result of parsing a selector is fed into a new
    /// Arc-ed allocation, so any spilled vec would be a wasted allocation. Also,
    /// Components are large enough that we don't have much cache locality benefit
    /// from reserving stack space for fewer of them.
    simple_selectors: SmallList<GenericComponent<Impl>, 32>,

    /// The combinators, and the length of the compound selector to their left.
    combinators: SmallList<(Combinator, usize), 32>,

    /// The length of the current compound selector.
    current_len: usize,
}

pub struct BuildResult<Impl: ValidSelectorImpl> {
    pub specificity_and_flags: SpecificityAndFlags,
    pub components: Vec<GenericComponent<Impl>>,
}

impl<Impl: ValidSelectorImpl> Default for SelectorBuilder<Impl> {
    #[inline]
    fn default() -> Self {
        Self {
            simple_selectors: SmallList::default(),
            combinators: SmallList::default(),
            current_len: 0,
        }
    }
}

impl<Impl: ValidSelectorImpl> SelectorBuilder<Impl> {
    #[inline]
    pub fn init() -> Self {
        Self::default()
    }

    /// Returns true if combinators have ever been pushed to this builder.
    #[inline]
    pub fn has_combinators(&self) -> bool {
        self.combinators.len() > 0
    }

    /// Completes the current compound selector and starts a new one, delimited
    /// by the given combinator.
    #[inline]
    pub fn push_combinator(&mut self, combinator: Combinator) {
        // PORT NOTE: `SmallList::append/insert` no longer take an arena —
        // it owns its spill buffer (global arena). The `bump` field is
        // retained for `BuildResult.components` (BumpVec) only.
        self.combinators.append((combinator, self.current_len));
        self.current_len = 0;
    }

    /// Pushes a simple selector onto the current compound selector.
    pub fn push_simple_selector(&mut self, ss: GenericComponent<Impl>) {
        debug_assert!(!ss.is_combinator());
        self.simple_selectors.append(ss);
        self.current_len += 1;
    }

    pub fn add_nesting_prefix(&mut self) {
        self.combinators.insert(0, (Combinator::Descendant, 1));
        self.simple_selectors.insert(0, GenericComponent::Nesting);
    }

    // PORT NOTE: Zig `deinit` only freed `simple_selectors` and `combinators`.
    // In Rust, `SmallList` owns its spill buffer and frees on `Drop`, so no
    // explicit `Drop` impl is needed here.

    /// Consumes the builder, producing a Selector.
    ///
    /// *NOTE*: This will free all allocated memory in the builder
    pub fn build(
        &mut self,
        parsed_pseudo: bool,
        parsed_slotted: bool,
        parsed_part: bool,
    ) -> BuildResult<Impl> {
        let specificity = compute_specificity::<Impl>(self.simple_selectors.slice());
        let mut flags = SelectorFlags::empty();
        if parsed_pseudo {
            flags |= SelectorFlags::HAS_PSEUDO;
        }
        if parsed_slotted {
            flags |= SelectorFlags::HAS_SLOTTED;
        }
        if parsed_part {
            flags |= SelectorFlags::HAS_PART;
        }
        // `build_with_specificity_and_flags()` will
        // PORT NOTE: Zig had `defer this.deinit()` here to free SmallList capacity
        // after building. In Rust, `Drop` on `SelectorBuilder` handles this when the
        // builder goes out of scope; the call below already drains the contents.
        self.build_with_specificity_and_flags(SpecificityAndFlags { specificity, flags })
    }

    /// Builds a selector with the given specificity and flags.
    ///
    /// PERF:
    ///     Recall that this code is ported from servo, which optimizes for matching speed, so
    ///     the final AST has the components of the selector stored in reverse order, which is
    ///     optimized for matching.
    ///
    ///     We don't really care about matching selectors, and storing the components in reverse
    ///     order requires additional allocations, and undoing the reversal when serializing the
    ///     selector. So we could just change this code to store the components in the same order
    ///     as the source.
    pub fn build_with_specificity_and_flags(
        &mut self,
        spec: SpecificityAndFlags,
    ) -> BuildResult<Impl> {
        let mut components: Vec<GenericComponent<Impl>> = Vec::new();

        // Emit compounds right-to-left (matching order), each compound's simple
        // selectors left-to-right. `drain(at..)` moves the suffix out by value;
        // draining a suffix is shift-free.
        let at = self.simple_selectors.len() as usize - self.current_len;
        components.extend(self.simple_selectors.drain(at..));
        for &(combo, len) in self.combinators.slice().iter().rev() {
            components.push(GenericComponent::Combinator(combo));
            let at = self.simple_selectors.len() as usize - len;
            components.extend(self.simple_selectors.drain(at..));
        }
        debug_assert_eq!(self.simple_selectors.len(), 0);
        self.combinators.clear_retaining_capacity();

        BuildResult {
            specificity_and_flags: spec,
            components,
        }
    }
}

// ported from: src/css/selectors/builder.zig
