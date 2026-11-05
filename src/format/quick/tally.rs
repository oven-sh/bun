//! For tools that ask what the reader of fast.rs refuses, and what that costs: what it refused and why, the tokens that were read, the nodes that were made.

use std::cell::RefCell;

#[derive(Default)]
pub struct Tally {
    /// (where the item starts, why it was refused: see `refusal` in fast.rs)
    pub refused: Vec<(i32, i32)>,
    /// where each token starts
    pub tokens: Vec<i32>,
    /// (head, start, end)
    pub nodes: Vec<(i32, i32, i32)>,
}

thread_local! {
    static TALLY: RefCell<Tally> = RefCell::new(Tally::default());
}

pub(crate) fn refused(reason: i32, start: i32) {
    TALLY.with_borrow_mut(|t| t.refused.push((start, reason)));
}

pub(crate) fn token(start: i32) {
    TALLY.with_borrow_mut(|t| t.tokens.push(start));
}

pub(crate) fn node(head: i32, start: i32, end: i32) {
    TALLY.with_borrow_mut(|t| t.nodes.push((head, start, end)));
}

/// What has been noted since the last call. Positions count from `BASE`.
pub fn take() -> Tally {
    TALLY.take()
}

pub const BASE: i32 = crate::text::SRC_BASE;
