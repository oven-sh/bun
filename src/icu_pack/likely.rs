//! Shrinks the likely subtags without changing their format. ICU4C: loclikelysubtags.cpp

use crate::tries::{read_bytes_trie, write_bytes_trie};
use std::cmp::Reverse;
use std::collections::BTreeMap;

const SPECIAL_ENTRIES: u32 = 2;
const LANGUAGES: i32 = 27 * 27 * 27;
/// "aa"
const ANY_LANGUAGE: i32 = 1 + 27;

/// The language of an entry is not read if the locale has one, so that languages can share entries.
pub(crate) fn pack(trie: &mut Vec<u8>, entries: &mut Vec<i32>) {
    let mut keys = read_bytes_trie(trie);
    let unknown = u16::from(b'*');
    let entry_of = |(key, value): &(Vec<u16>, u32)| {
        let entry = entries[*value as usize];
        let language = (entry & 0xff_ffff) % LANGUAGES;
        if key[0] == unknown {
            entry
        } else {
            entry - language + ANY_LANGUAGE
        }
    };
    let mut uses = BTreeMap::new();
    for key in keys.iter().filter(|it| it.1 >= SPECIAL_ENTRIES) {
        *uses.entry(entry_of(key)).or_insert(0) += 1;
    }
    let mut shared: Vec<_> = uses.into_iter().collect();
    shared.sort_by_key(|it| Reverse(it.1));
    let indexes: BTreeMap<_, _> = shared
        .iter()
        .map(|it| it.0)
        .zip(SPECIAL_ENTRIES..)
        .collect();
    for key in keys.iter_mut().filter(|it| it.1 >= SPECIAL_ENTRIES) {
        key.1 = indexes[&entry_of(key)];
    }
    entries.truncate(SPECIAL_ENTRIES as usize);
    entries.extend(shared.iter().map(|it| it.0));
    *trie = write_bytes_trie(&keys);
    assert!(read_bytes_trie(trie) == keys);
}
