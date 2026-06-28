//! `bun_fuzzy` — fzf-style fuzzy filename scoring.
//!
//! A from-scratch implementation of the published `FuzzyMatchV2` algorithm
//! from junegunn/fzf (`src/algo/algo.go`): a Smith-Waterman-style alignment
//! with affine gap penalties and position-dependent bonuses (word boundaries,
//! camelCase transitions, path separators), tuned for `/`-separated file
//! paths.
//!
//! Pipeline for a query over N candidates:
//!
//! 1. [`is_subsequence`] rejects the overwhelming majority of candidates in a
//!    few nanoseconds each.
//! 2. [`Scorer::score`] runs the O(needle x haystack) DP on the survivors,
//!    using `O(needle)` memory and zero heap allocation after
//!    [`Scorer::set_needle`].
//! 3. [`TopK`] selects the best K results in O(N log K).
//!
//! [`Scorer::score_with_positions`] additionally recovers the matched byte
//! indices for highlighting (exact within documented bounds, greedy past
//! them).
//!
//! This crate is a pure leaf: no JSC, no event loop, no I/O.

mod chars;
mod score;
mod scorer;
mod subsequence;
mod topk;

#[cfg(test)]
mod tests;

pub use scorer::{CaseMode, MAX_BACKTRACK_CELLS, MAX_BACKTRACK_HAYSTACK, Scorer, ScorerOptions};
pub use subsequence::is_subsequence;
pub use topk::TopK;
