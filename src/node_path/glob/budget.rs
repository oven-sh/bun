//! Node has no budget: it keeps going until it finishes or runs out of memory. Bun throws instead.

use bun_core::{AllocError, StackCheck};

/// Why a compilation or a match was given up.
#[derive(Clone, Copy)]
pub enum Abort {
    StackOverflow,
    BudgetExceeded,
    /// `should_continue` returned `false`.
    Terminated,
    Memory(crate::Error),
}

impl From<crate::Error> for Abort {
    fn from(error: crate::Error) -> Self {
        Abort::Memory(error)
    }
}

/// Rough costs, relative to one comparison of two code units.
pub(super) mod cost {
    /// An iteration of a loop over parts.
    pub(crate) const STEP: usize = 4;
    /// The fixed overhead of handling a slice, or the per-unit cost of parsing or lowercasing it.
    pub(crate) const CALL: usize = 8;
    pub(crate) const RECURSION: usize = 16;
    /// A search in a table or a tree, or formatting a number.
    pub(crate) const LOOKUP: usize = 32;
    pub(crate) const ALLOCATION: usize = 64;

    pub(crate) const fn vector_scan(len: usize) -> usize {
        len / 8
    }

    /// Allocating something and filling it in two passes over `len` items.
    pub(crate) const fn build(len: usize) -> usize {
        ALLOCATION + 2 * len
    }
}

/// Roughly what the allocator adds to the few small allocations of one object.
pub(super) const ALLOCATION_OVERHEAD: usize = 32;

const COMPILE_LIMIT: usize = 1 << 29;
const MAX_COMPILE_BYTES: usize = 128 << 20;
const MATCH_LIMIT: usize = 1 << 28;
const MATCH_LIMIT_PER_UNIT: usize = 64;
const CHECK_INTERVAL: usize = 1 << 18;

pub(super) struct Budget<'a> {
    spent: usize,
    next_check: usize,
    limit: usize,
    bytes_in_use: usize,
    should_continue: &'a mut dyn FnMut() -> bool,
}

impl<'a> Budget<'a> {
    #[inline(always)]
    fn new(limit: usize, should_continue: &'a mut dyn FnMut() -> bool) -> Self {
        Budget {
            spent: 0,
            next_check: CHECK_INTERVAL,
            limit,
            bytes_in_use: 0,
            should_continue,
        }
    }

    pub(super) fn to_compile(should_continue: &'a mut dyn FnMut() -> bool) -> Self {
        Self::new(COMPILE_LIMIT, should_continue)
    }

    #[inline(always)]
    pub(super) fn to_match(path_len: usize, should_continue: &'a mut dyn FnMut() -> bool) -> Self {
        let limit = MATCH_LIMIT + MATCH_LIMIT_PER_UNIT * path_len;
        Self::new(limit, should_continue)
    }

    /// The next [`spend`](Self::spend) checks for this too.
    #[inline(always)]
    pub(super) fn spend_unchecked(&mut self, amount: usize) {
        self.spent += amount;
    }

    #[inline(always)]
    pub(super) fn spend(&mut self, amount: usize) -> Result<(), Abort> {
        self.spend_unchecked(amount);
        if self.spent < self.next_check {
            return Ok(());
        }
        self.check()
    }

    #[cold]
    fn check(&mut self) -> Result<(), Abort> {
        if self.spent > self.limit {
            return Err(Abort::BudgetExceeded);
        }
        self.next_check = self.spent + CHECK_INTERVAL;
        let should_continue = (self.should_continue)();
        should_continue.then_some(()).ok_or(Abort::Terminated)
    }

    pub(super) fn bytes_in_use(&self) -> usize {
        self.bytes_in_use
    }

    pub(super) fn charge_memory(&mut self, bytes: usize) -> Result<(), Abort> {
        self.bytes_in_use += bytes;
        let fits = self.bytes_in_use <= MAX_COMPILE_BYTES;
        fits.then_some(()).ok_or(Abort::BudgetExceeded)
    }

    /// Replaces the charges made since [`bytes_in_use`](Self::bytes_in_use) was `checkpoint` by `bytes`.
    pub(super) fn settle_memory(&mut self, checkpoint: usize, bytes: usize) -> Result<(), Abort> {
        self.bytes_in_use = checkpoint;
        self.charge_memory(bytes)
    }
}

pub(super) fn check_stack() -> Result<(), Abort> {
    let is_safe = StackCheck::init().is_safe_to_recurse();
    is_safe.then_some(()).ok_or(Abort::StackOverflow)
}

pub(super) fn try_with_capacity<T>(capacity: usize) -> Result<Vec<T>, Abort> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)
        .map_err(|_| crate::Error::Alloc(AllocError))?;
    Ok(vec)
}
