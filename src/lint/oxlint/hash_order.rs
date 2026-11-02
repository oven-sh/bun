//! Reproduces the iteration order of oxlint's hash tables.

use bun_lint::prelude::*;
use bun_lint::semantic::{hashbrown_table_order, oxc_table_order};
use rustc_hash::{FxHashMap, FxHashSet, FxHasher};
use std::hash::Hasher;

/// `FxHasher`'s hash of a string.
pub(crate) fn hash_of_str(text: &[u8]) -> u64 {
    let mut hasher = FxHasher::default();
    hasher.write(text);
    hasher.write_u8(0xFF);
    hasher.finish()
}

/// True if a table created with `capacity` that holds `len` items has to grow before the next insert. It's full at 3 of
/// 4 buckets, 7 of 8, or 7/8 of a larger table.
fn is_full(len: usize, capacity: usize) -> bool {
    match len.max(capacity) {
        0..=3 => len == 3,
        4..=7 => len == 7,
        wanted => len == (wanted * 8 / 7).next_power_of_two() / 8 * 7,
    }
}

/// Models just enough of a `hashbrown` table to know its iteration order. Some oxlint rules report the first match they
/// find in such a table, or print the names in it. The order depends on the hashes and on the insertion order.
pub struct HashOrder<T> {
    /// The capacity the table was created with.
    capacity: usize,
    /// The half of each hash that picks the bucket, and the items, both in insertion order.
    hashes: Vec<u32>,
    items: Vec<T>,
    /// True if the last call was [`HashOrder::insert_again`].
    was_insert_again: bool,
}

impl<T: Copy> HashOrder<T> {
    pub fn new() -> Self {
        HashOrder::with_capacity(0)
    }

    /// `with_capacity`, which `collect` also uses.
    pub(crate) fn with_capacity(capacity: usize) -> Self {
        HashOrder {
            capacity,
            hashes: Vec::new(),
            items: Vec::new(),
            was_insert_again: false,
        }
    }

    /// `item` must not be in the table yet.
    pub fn insert(&mut self, hash: u64, item: T) {
        self.hashes.push(hash as u32);
        self.items.push(item);
        self.was_insert_again = false;
    }

    /// `insert` of an item that's already in the table. hashbrown reserves room for one more item before it looks the
    /// item up, so a full table grows.
    pub fn insert_again(&mut self) {
        self.was_insert_again = true;
    }

    pub fn iter(&self) -> impl Iterator<Item = T> {
        let mut order = hashbrown_table_order(&self.hashes, self.capacity);
        if self.was_insert_again && is_full(self.items.len(), self.capacity) {
            // The items move to the larger table in the smaller table's iteration order.
            let hash_at = |at: &u32| self.hashes.get(*at as usize).copied().unwrap_or_default();
            let moved: Vec<u32> = order.iter().map(hash_at).collect();
            let grown = hashbrown_table_order(&moved, self.items.len() + 1);
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

/// The iteration order of `scoping.root_unresolved_references()`, a hash table of all the names the file refers to but
/// doesn't declare.
pub struct UnresolvedOrder<'a> {
    /// Each name's position in the iteration order.
    ranks: FxHashMap<Name<'a>, u32>,
}

impl<'a> UnresolvedOrder<'a> {
    pub fn new(file: &'a File<'a>) -> Self {
        // Each name with the offset of its first reference. Names are inserted into the table in that order.
        let mut seen = FxHashSet::default();
        let mut names: Vec<(u32, Name<'a>)> = (file.unresolved_references())
            .filter(|it| seen.insert(it.name()))
            .map(|it| (it.span().start, it.name()))
            .collect();
        // In oxc nothing declares a function's `arguments`.
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
        let order = oxc_table_order(names.iter().map(|it| it.1.bytes()));
        let name_at = |index: u32| names.get(index as usize).map(|it| it.1);
        UnresolvedOrder {
            ranks: order.into_iter().filter_map(name_at).zip(0..).collect(),
        }
    }

    /// `name`'s position in the iteration order.
    pub fn rank(&self, name: Name<'a>) -> u32 {
        self.ranks.get(&name).copied().unwrap_or(u32::MAX)
    }
}
