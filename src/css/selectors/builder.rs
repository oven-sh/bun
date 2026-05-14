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
        // PORT NOTE: reshaped for borrowck — capture combinators.len()
        // before borrowing simple_selectors.slice().
        let combinators_len = self.combinators.len();

        let (rest, current) = split_from_end::<GenericComponent<Impl>>(
            self.simple_selectors.slice(),
            self.current_len,
        );
        let combinators = self.combinators.slice();

        let mut components: Vec<GenericComponent<Impl>> = Vec::new();

        let mut current_simple_selectors_i: usize = 0;
        let mut combinator_i: i64 = i64::try_from(combinators_len).expect("int cast") - 1;
        let mut rest_of_simple_selectors = rest;
        let mut current_simple_selectors = current;

        loop {
            if current_simple_selectors_i < current_simple_selectors.len() {
                // PORT NOTE: Zig copies the component by value here (struct copy).
                // `GenericComponent<Impl>` is not `Copy`; we bitwise-move it out
                // via `ptr::read` — sound because every element of
                // `simple_selectors` is consumed exactly once across the loop,
                // and `set_len(0)` below suppresses the source slice's `Drop`.
                // SAFETY: each index is read at most once (the cursor
                // monotonically advances; `rest_of_simple_selectors` is the
                // disjoint prefix of the previous `current` slice). The source
                // storage is leaked-then-truncated via `set_len(0)`.
                let moved = unsafe {
                    core::ptr::read(&raw const current_simple_selectors[current_simple_selectors_i])
                };
                components.push(moved);
                current_simple_selectors_i += 1;
            } else {
                if combinator_i >= 0 {
                    let (combo, len) =
                        combinators[usize::try_from(combinator_i).expect("int cast")];
                    let (rest2, current2) =
                        split_from_end::<GenericComponent<Impl>>(rest_of_simple_selectors, len);
                    rest_of_simple_selectors = rest2;
                    current_simple_selectors_i = 0;
                    current_simple_selectors = current2;
                    combinator_i -= 1;
                    components.push(GenericComponent::Combinator(combo));
                    continue;
                }
                break;
            }
        }

        // This function should take every component from `self.simple_selectors`
        // and place it into `components` and return it.
        //
        // This means that we shouldn't leak any `GenericComponent<Impl>`, so
        // it is safe to just set the length to 0.
        //
        // Combinators don't need to be deinitialized because they are simple enums.
        self.simple_selectors.set_len(0);
        self.combinators.set_len(0);

        BuildResult {
            specificity_and_flags: spec,
            components,
        }
    }
}

pub fn split_from_end<T>(s: &[T], at: usize) -> (&[T], &[T]) {
    let midpoint = s.len() - at;
    (&s[0..midpoint], &s[midpoint..])
}

// ported from: src/css/selectors/builder.zig
