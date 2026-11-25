//! The pools of keys.

use bun_icu_format::package::{KEYS, TREES, keys_of};
use std::collections::{BTreeMap, BTreeSet};

/// By the index of the item.
pub(crate) struct Pools<'a>(pub(crate) BTreeMap<usize, Keys<'a>>);

impl<'a> Pools<'a> {
    /// Each key comes with the tree of its bundle.
    pub(crate) fn new(keys: &[(&str, &'a str)]) -> Self {
        let mut by_item: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for &(tree, key) in keys {
            by_item.entry(Self::item(tree)).or_default().push(key);
        }
        Self(by_item.iter().map(|it| (*it.0, Keys::new(it.1))).collect())
    }

    fn item(tree: &str) -> usize {
        (TREES.iter().position(|&it| it == tree.as_bytes())).map_or(KEYS, keys_of)
    }

    pub(crate) fn of(&self, tree: &str) -> &Keys<'a> {
        &self.0[&Self::item(tree)]
    }
}

pub(crate) struct Keys<'a> {
    offsets: BTreeMap<&'a str, u16>,
    pub(crate) bytes: Vec<u8>,
}

/// Maps each of the distinct `texts` to the longest one that ends with it.
pub(crate) fn longest_with_suffix<'a, T: Ord>(
    texts: impl Iterator<Item = &'a [T]>,
) -> BTreeMap<&'a [T], &'a [T]> {
    let mut texts: Vec<_> = texts.collect();
    texts.sort_by(|a, b| b.iter().rev().cmp(a.iter().rev()));
    let (mut owners, mut owner) = (BTreeMap::new(), None);
    for text in texts {
        let found = owner.filter(|owner: &&[T]| owner.ends_with(text));
        owners.insert(text, *owner.insert(found.unwrap_or(text)));
    }
    owners
}

impl<'a> Keys<'a> {
    /// The keys are stored in the order in which they first occur.
    fn new(keys: &[&'a str]) -> Self {
        let distinct: BTreeSet<_> = keys.iter().map(|key| key.as_bytes()).collect();
        let owners = longest_with_suffix(distinct.into_iter());
        let (mut offsets, mut ends, mut bytes) = (BTreeMap::new(), BTreeMap::new(), Vec::new());
        for &key in keys {
            let owner = owners[key.as_bytes()];
            let end = *ends.entry(owner).or_insert_with(|| {
                bytes.extend(owner);
                bytes.push(0);
                bytes.len() - 1
            });
            let offset = u16::try_from(end - key.len()).expect("16 bits");
            offsets.insert(key, offset);
        }
        Self { offsets, bytes }
    }

    pub(crate) fn offset(&self, key: &str) -> u16 {
        self.offsets[key]
    }
}
