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

pub struct SelectorBuilder<Impl: ValidSelectorImpl> {
    simple_selectors: SmallList<GenericComponent<Impl>, 32>,

    /// The combinators, and the length of the compound selector to their left.
    combinators: SmallList<(Combinator, usize), 32>,

    /// The length of the current compound selector.
    current_len: usize,

    alloc: ArenaPtr,
}

pub struct BuildResult<Impl: ValidSelectorImpl> {
    pub specificity_and_flags: SpecificityAndFlags,
    pub components: Vec<GenericComponent<Impl>, ArenaPtr>,
}

impl<Impl: ValidSelectorImpl> Default for SelectorBuilder<Impl> {
    #[inline]
    fn default() -> Self {
        Self::init_in(ArenaPtr::global())
    }
}

impl<Impl: ValidSelectorImpl> SelectorBuilder<Impl> {
    #[inline]
    pub(crate) fn init_in(alloc: ArenaPtr) -> Self {
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
        // PORT NOTE: `SmallList::append/insert` no longer take an arena —
        // it owns its spill buffer (global arena). The `bump` field is
        // retained for `BuildResult.components` (BumpVec) only.
        self.combinators.append((combinator, self.current_len));
        self.current_len = 0;
    }

    /// Pushes a simple selector onto the current compound selector.
    pub(crate) fn push_simple_selector(&mut self, ss: GenericComponent<Impl>) {
        debug_assert!(!ss.is_combinator());
        self.simple_selectors.append(ss);
        self.current_len += 1;
    }

    pub(crate) fn add_nesting_prefix(&mut self) {
        self.combinators.insert(0, (Combinator::Descendant, 1));
        self.simple_selectors.insert(0, GenericComponent::Nesting);
    }

    // PORT NOTE: Zig `deinit` only freed `simple_selectors` and `combinators`.
    // In Rust, `SmallList` owns its spill buffer and frees on `Drop`, so no
    // explicit `Drop` impl is needed here.

    /// Consumes the builder, producing a Selector.
    ///
    /// *NOTE*: This will free all allocated memory in the builder
    pub(crate) fn build(
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
        self.build_with_specificity_and_flags(SpecificityAndFlags { specificity, flags })
    }

    pub(crate) fn build_with_specificity_and_flags(
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

        let mut components: Vec<GenericComponent<Impl>, ArenaPtr> = Vec::new_in(self.alloc);

        let mut current_simple_selectors_i: usize = 0;
        let mut combinator_i: i64 = i64::from(combinators_len) - 1;
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

        self.simple_selectors.set_len(0);
        self.combinators.set_len(0);

        BuildResult {
            specificity_and_flags: spec,
            components,
        }
    }
}

pub(crate) fn split_from_end<T>(s: &[T], at: usize) -> (&[T], &[T]) {
    let midpoint = s.len() - at;
    (&s[0..midpoint], &s[midpoint..])
}

// ported from: src/css/selectors/builder.zig
