//! The order in which a hash table of oxlint is iterated.

use bun_lint::prelude::*;
use bun_lint::semantic::{order_in_table, order_in_table_of_oxc};
use rustc_hash::{FxHashMap, FxHashSet, FxHasher};
use std::hash::Hasher;

/// What `FxHasher` makes of a string.
pub(crate) fn hash_of_str(text: &[u8]) -> u64 {
    let mut hasher = FxHasher::default();
    hasher.write(text);
    hasher.write_u8(0xFF);
    hasher.finish()
}

/// Whether a table that was made for `capacity` and has `len` has to grow for one more: it has 3 in 4 buckets, 7 in 8, or 7 in
/// each 8.
fn is_full(len: usize, capacity: usize) -> bool {
    match len.max(capacity) {
        0..=3 => len == 3,
        4..=7 => len == 7,
        wanted => len == (wanted * 8 / 7).next_power_of_two() / 8 * 7,
    }
}

/// A table of the crate `hashbrown`, as far as it takes to know in which order it is iterated. Some rules of oxlint report the first
/// of what they find in such a table, or print the names in it. The order follows from the hashes and from the order in which
/// they are inserted.
pub struct HashOrder<T> {
    /// What the table is made for.
    capacity: usize,
    /// The half of each hash that picks the bucket, and the items, in the order in which they are inserted.
    hashes: Vec<u32>,
    items: Vec<T>,
    /// [`HashOrder::insert_again`] was the last that was called.
    is_asked_again: bool,
}

impl<T: Copy> HashOrder<T> {
    pub fn new() -> Self {
        HashOrder::with_capacity(0)
    }

    /// `with_capacity`, which is also what `collect` makes.
    pub(crate) fn with_capacity(capacity: usize) -> Self {
        HashOrder {
            capacity,
            hashes: Vec::new(),
            items: Vec::new(),
            is_asked_again: false,
        }
    }

    /// `item` has to be new.
    pub fn insert(&mut self, hash: u64, item: T) {
        self.hashes.push(hash as u32);
        self.items.push(item);
        self.is_asked_again = false;
    }

    /// `insert` of what the table has already. It makes room for one more before it looks, so a table that is full grows.
    pub fn insert_again(&mut self) {
        self.is_asked_again = true;
    }

    pub fn iter(&self) -> impl Iterator<Item = T> {
        let mut order = order_in_table(&self.hashes, self.capacity);
        if self.is_asked_again && is_full(self.items.len(), self.capacity) {
            // All go to the greater table in the order of the smaller one.
            let hash_at = |at: &u32| self.hashes.get(*at as usize).copied().unwrap_or_default();
            let moved: Vec<u32> = order.iter().map(hash_at).collect();
            let grown = order_in_table(&moved, self.items.len() + 1);
            order = grown
                .iter()
                .filter_map(|at| order.get(*at as usize).copied())
                .collect();
        }
        order
            .into_iter()
            .filter_map(|at| self.items.get(at as usize).copied())
    }
}

/// The order of `scoping.root_unresolved_references()`, which is a hash table of all the names that the file refers to and does not
/// declare.
pub struct UnresolvedOrder<'a> {
    /// The place of each name in the table.
    ranks: FxHashMap<Name<'a>, u32>,
}

impl<'a> UnresolvedOrder<'a> {
    pub fn new(file: &'a File<'a>) -> Self {
        // The names, where each is first referred to: they get into the table in this order.
        let mut seen = FxHashSet::default();
        let mut names: Vec<(u32, Name<'a>)> = (file.unresolved_references())
            .filter(|it| seen.insert(it.name()))
            .map(|it| (it.span().start, it.name()))
            .collect();
        // For oxc nothing declares the `arguments` of a function.
        let arguments = file.name_of("arguments");
        if file.mentions("arguments") && !seen.contains(&arguments) {
            let is_arguments =
                |it: &Expr<'a>| it.as_ident() == Some(arguments) && it.symbol().is_none();
            let first = file
                .exprs_of_kind(ExprTag::Ident)
                .filter(is_arguments)
                .map(|it| it.span().start)
                .min();
            names.extend(first.map(|start| (start, arguments)));
            utils::sort::sort_unstable_by_key(&mut names, |it| it.0);
        }
        let order = order_in_table_of_oxc(names.iter().map(|it| it.1.bytes()));
        let name_at = |place: u32| names.get(place as usize).map(|it| it.1);
        UnresolvedOrder {
            ranks: order.into_iter().filter_map(name_at).zip(0..).collect(),
        }
    }

    /// The place of `name` in the table.
    pub fn rank(&self, name: Name<'a>) -> u32 {
        self.ranks.get(&name).copied().unwrap_or(u32::MAX)
    }
}
