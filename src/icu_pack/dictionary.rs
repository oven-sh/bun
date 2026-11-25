//! Packs the dictionaries of break iterators.

use crate::codes::to_bytes;
use crate::files::split_header;
use crate::resb::u32_at;
use crate::tries::{Entry, read_bytes_trie, read_string_trie};
use bun_icu_format::dictionary::*;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const MAX_WORD_LENGTH: usize = 20;
const MAX_TOKEN_LENGTH: usize = 8;
const ROUNDS: usize = 20;

/// Returns the sorted words, and whether they have values.
fn read_words(file: &[u8]) -> (Vec<Entry>, bool) {
    let bytes = split_header(file).1;
    let (trie, kind) = (&bytes[u32_at(bytes, 0) as usize..], u32_at(bytes, 16));
    if kind % 8 == 1 {
        return (read_string_trie(trie), true);
    }
    let (mut words, offset) = (read_bytes_trie(trie), u32_at(bytes, 20) as u16);
    for unit in words.iter_mut().flat_map(|it| &mut it.0) {
        *unit = match *unit {
            0xfe => 0x200c,
            0xff => 0x200d,
            delta => offset + delta,
        };
    }
    words.sort();
    assert!(words.iter().all(|it| it.1 == 0));
    (words, false)
}

/// Removes the words that the engine for Chinese and Japanese cannot find, or for which it finds cheaper parts.
fn useful(words: &[Entry]) -> Vec<Entry> {
    let costs: BTreeMap<_, _> = words.iter().map(|it| (&it.0[..], it.1)).collect();
    let has_cheaper_parts = |(word, cost): &Entry| {
        let mut best = vec![u32::MAX / 2; word.len() + 1];
        best[0] = 0;
        for (start, end) in (1..=word.len()).flat_map(|end| (0..end).map(move |it| (it, end))) {
            if let Some(part) = costs.get(&word[start..end]) {
                best[end] = best[end].min(best[start] + part);
            }
        }
        best[word.len()] < *cost
    };
    let is_found = |word: &[u16]| {
        let is_other = |unit: &u16| matches!(unit, ..0x2e80 | 0xd800..0xe000);
        word.len() <= MAX_WORD_LENGTH && !word.iter().any(is_other)
    };
    let useful = words
        .iter()
        .filter(|it| is_found(&it.0) && !has_cheaper_parts(it));
    useful.cloned().collect()
}

/// The words that have the first `depth` units in common.
#[derive(Clone, Copy)]
struct Node<'w> {
    words: &'w [Entry],
    depth: usize,
}

impl<'w> Node<'w> {
    fn text(self) -> &'w [u16] {
        &self.words[0].0[..self.depth]
    }

    fn value(self) -> Option<u32> {
        (self.words[0].0.len() == self.depth).then_some(self.words[0].1)
    }

    fn children(self) -> impl Iterator<Item = Self> {
        let longer = &self.words[self.value().is_some().into()..];
        let groups = longer.chunk_by(move |a, b| a.0[self.depth] == b.0[self.depth]);
        groups.map(move |words| Self {
            words,
            depth: self.depth + 1,
        })
    }

    /// Returns the first node from this one on that ends a word or has more than one child.
    fn end_of_path(self) -> Self {
        let (first, last) = (&self.words[0].0, &self.words[self.words.len() - 1].0);
        let depth = first.iter().zip(last).take_while(|(a, b)| a == b).count();
        Self { depth, ..self }
    }

    fn for_each_path(self, f: &mut impl FnMut(&'w [u16])) {
        for child in self.children() {
            let end = child.end_of_path();
            f(&end.text()[self.depth..]);
            end.for_each_path(f);
        }
    }
}

struct Alphabet {
    /// By code unit.
    symbols: BTreeMap<u16, usize>,
    first_symbols: usize,
    rare_symbols: usize,
}

impl Alphabet {
    fn is_rare(&self, unit: u16) -> bool {
        self.symbols[&unit] >= self.rare_symbols
    }

    /// Returns the lengths of the parts that take the fewest labels.
    fn parse(&self, path: &[u16], tokens: &BTreeSet<&[u16]>) -> Vec<usize> {
        let mut best = vec![(0, 0); path.len() + 1];
        for start in (0..path.len()).rev() {
            let alone = (
                best[start + 1].0 + 1 + usize::from(self.is_rare(path[start])),
                1,
            );
            let lengths = 2..=MAX_TOKEN_LENGTH.min(path.len() - start);
            let lengths = lengths.filter(|it| tokens.contains(&path[start..start + it]));
            let ways = lengths.map(|it| (best[start + it].0 + 1, it));
            best[start] = ways.chain([alone]).min().expect("a way");
        }
        let starts = std::iter::successors(Some(0), |&it| {
            Some(it + best[it].1).filter(|&it| it < path.len())
        });
        starts.map(|it| best[it].1).collect()
    }

    fn choose_tokens<'w>(
        &self,
        paths: &BTreeMap<&'w [u16], usize>,
        count: usize,
    ) -> BTreeSet<&'w [u16]> {
        let mut tokens = BTreeSet::new();
        for round in 1..=ROUNDS {
            let mut gains = BTreeMap::new();
            for (&path, &uses) in paths {
                let (mut start, mut before) = (0, None);
                for length in self.parse(path, &tokens) {
                    let end = start + length;
                    if length > 1 {
                        *gains.entry(&path[start..end]).or_insert(0) += 10 * uses;
                    }
                    if let Some(both) = before.map(|it| &path[it..end])
                        && both.len() <= MAX_TOKEN_LENGTH
                        && !self.is_rare(both[0])
                        && !tokens.contains(both)
                    {
                        let weight = if 5 * round > 3 * ROUNDS { 7 } else { 10 };
                        *gains.entry(both).or_insert(0) += weight * uses;
                    }
                    (start, before) = (end, Some(start));
                }
            }
            let mut gains: Vec<_> = gains.into_iter().filter(|it| it.1 >= 20).collect();
            gains.sort_by_key(|it| Reverse(it.1));
            gains.truncate(count.min((5 * count * round).div_ceil(3 * ROUNDS)));
            tokens = gains.into_iter().map(|it| it.0).collect();
        }
        tokens
    }
}

#[derive(Default)]
struct Bits {
    bytes: Vec<u8>,
    count: usize,
}

impl Bits {
    fn push(&mut self, field: usize, width: usize) {
        assert!(field >> width == 0);
        for bit in 0..width {
            self.bytes.resize(self.count / 8 + 1, 0);
            self.bytes[self.count / 8] |= ((field >> bit & 1) as u8) << (self.count % 8);
            self.count += 1;
        }
    }
}

/// Returns the number of low bits, and the bytes.
fn write_seconds(symbols: &[usize]) -> (usize, Vec<u8>) {
    let Some(&last) = symbols.last() else {
        return (0, Vec::new());
    };
    let width = (0..15).min_by_key(|&it| symbols.len() * it + (last >> it));
    let (width, mut bits) = (width.expect("a width"), Bits::default());
    symbols
        .iter()
        .for_each(|it| bits.push(it % (1 << width), width));
    let mut rest = symbols.iter().peekable();
    for high in 0..=last >> width {
        while rest.next_if(|it| *it >> width == high).is_some() {
            bits.push(1, 1);
        }
        bits.push(0, 1);
    }
    (width, bits.bytes)
}

/// What is below a node of the packed trie.
enum Below<'w> {
    Children(Node<'w>),
    /// The lengths of the parts of the path that follow the node, in reverse order.
    Parts(Node<'w>, Vec<usize>),
    Rare(Vec<(Node<'w>, Vec<usize>)>),
}

fn alphabet(root: Node, rare_symbols: usize) -> Alphabet {
    let mut counts = BTreeMap::new();
    for first in root.children() {
        counts.extend(first.children().next().map(|_| (first.text()[0], 0)));
    }
    let firsts: BTreeSet<_> = counts.keys().copied().collect();
    for first in root.children() {
        first.for_each_path(&mut |path| {
            path.iter()
                .for_each(|&it| *counts.entry(it).or_insert(0) += 1)
        });
    }
    let mut units: Vec<_> = counts.into_iter().collect();
    units.sort_by_key(|&(unit, count)| (count < 32 && !firsts.contains(&unit), Reverse(count)));
    let last_first = units.iter().rposition(|it| firsts.contains(&it.0));
    Alphabet {
        symbols: units.iter().map(|it| it.0).zip(1..).collect(),
        first_symbols: last_first.expect("a word") + 2,
        rare_symbols: rare_symbols.min(units.len() + 1),
    }
}

/// Returns the pages, the entries and the values of the symbols.
fn write_units(root: Node, alphabet: &Alphabet) -> [Vec<u8>; 3] {
    let entries = alphabet.symbols.iter().map(|it| (*it.0, *it.1 as u16));
    let mut entries: BTreeMap<_, _> = entries.collect();
    let mut values = vec![0; entries.len() + 1];
    for (unit, value) in root
        .children()
        .filter_map(|it| Some((it.text()[0], it.value()?)))
    {
        match alphabet.symbols.get(&unit) {
            Some(&symbol) => values[symbol] = u8::try_from(value + 1).expect("8 bits"),
            None => _ = entries.insert(unit, IS_LONE | value as u16),
        }
    }
    let (mut pages, mut slots) = (vec![0; 0x10000 >> PAGE_SHIFT], vec![0; 1 << PAGE_SHIFT]);
    for (unit, entry) in entries {
        let page = &mut pages[usize::from(unit >> PAGE_SHIFT)];
        if *page == 0 {
            *page = u8::try_from(slots.len() >> PAGE_SHIFT).expect("8 bits");
            slots.resize(slots.len() + (1 << PAGE_SHIFT), 0);
        }
        slots[(usize::from(*page) << PAGE_SHIFT) + usize::from(unit % (1 << PAGE_SHIFT))] = entry;
    }
    [pages, to_bytes(&slots), values]
}

/// Returns the packed values, the common ones and the rare ones.
fn write_values(of_seconds: &[u32], of_others: &[u32]) -> [Vec<u8>; 3] {
    let (mut packed, mut common, mut rare) = (Bits::default(), Vec::new(), Vec::new());
    for values in [of_seconds, of_others] {
        let mut counts = BTreeMap::new();
        values
            .iter()
            .for_each(|&it| *counts.entry(it as u8).or_insert(0) += 1);
        let mut counts: Vec<_> = counts.into_iter().collect();
        counts.sort_by_key(|it| Reverse(it.1));
        counts.resize(RARE_VALUE as usize, (0, 0));
        for &value in values {
            let index = counts.iter().position(|it| u32::from(it.0) == value);
            if index.is_none() {
                rare.extend(((packed.count as u32 / VALUE_BITS) << 8 | value).to_le_bytes());
            }
            packed.push(index.unwrap_or(RARE_VALUE as usize), VALUE_BITS as usize);
        }
        common.extend(counts.iter().map(|it| it.0));
    }
    [packed.bytes, common, rare]
}

fn write<'w>(
    words: &'w [Entry],
    has_values: bool,
    label_bits: usize,
    rare_symbols: usize,
) -> Vec<u8> {
    let root = Node { words, depth: 0 };
    let alphabet = alphabet(root, rare_symbols);
    let symbol_of = |node: &Node| alphabet.symbols[&node.text()[node.depth - 1]];
    let sorted_children = |node| {
        let mut children: Vec<_> = Node::children(node).collect();
        children.sort_by_key(symbol_of);
        children
    };

    let firsts = root
        .children()
        .filter(|it| alphabet.symbols.contains_key(&it.text()[0]));
    let firsts: BTreeMap<_, _> = firsts.map(|it| (symbol_of(&it), it)).collect();
    let (mut index, mut seconds, mut second_nodes) = (Bits::default(), Vec::new(), Vec::new());
    let (mut maps, mut map_size) = (Vec::new(), 0);
    if alphabet.symbols.len() < MAX_MAPPED_SYMBOLS && !has_values {
        map_size = 2 + (alphabet.symbols.len() + 1).div_ceil(8);
        let mut push_map = |node: Option<Node<'w>>, first_child: usize| {
            let children = node.map_or(Vec::new(), sorted_children);
            let flags = [
                (ENDS_WORD, node.and_then(Node::value).is_some()),
                (HAS_CHILDREN, !children.is_empty()),
            ];
            let flags: u16 = flags.iter().filter(|it| it.1).map(|it| it.0).sum();
            assert!(first_child < HAS_CHILDREN.into());
            let bits: u128 = children.iter().map(|it| 1 << (16 + symbol_of(it))).sum();
            maps.extend(&(bits | u128::from(flags | first_child as u16)).to_le_bytes()[..map_size]);
            children
        };
        let mut after_two = Vec::new();
        for symbol in 0..=alphabet.symbols.len() {
            let first_child = alphabet.symbols.len() + 1 + after_two.len();
            after_two.extend(push_map(firsts.get(&symbol).copied(), first_child));
        }
        for node in after_two {
            second_nodes.extend(push_map(Some(node), second_nodes.len()));
        }
    } else {
        for symbol in 1..=alphabet.first_symbols {
            let children = firsts
                .get(&symbol)
                .map_or(Vec::new(), |&it| sorted_children(it));
            let (width, bytes) = write_seconds(&children.iter().map(symbol_of).collect::<Vec<_>>());
            for (field, bits) in [seconds.len(), second_nodes.len(), width]
                .into_iter()
                .zip(SECONDS_FIELDS)
            {
                index.push(field, bits as usize);
            }
            seconds.extend(bytes);
            second_nodes.extend(children);
        }
    }

    let mut paths = BTreeMap::new();
    for node in &second_nodes {
        node.for_each_path(&mut |path| *paths.entry(path).or_insert(0) += 1);
    }
    let labelled = paths
        .keys()
        .copied()
        .flatten()
        .filter(|&&it| !alphabet.is_rare(it));
    let labelled: BTreeMap<_, _> = labelled.map(|it| (alphabet.symbols[it], *it)).collect();
    let escapes = (alphabet.symbols.len() + 1 - alphabet.rare_symbols).div_ceil(1 << label_bits);
    let tokens = alphabet.choose_tokens(&paths, (1 << label_bits) - escapes - labelled.len());
    let (mut symbol_labels, mut tails_index, mut tails) = (Vec::new(), Vec::new(), Vec::new());
    let mut labels_of = BTreeMap::new();
    for symbol in 0..alphabet.rare_symbols {
        symbol_labels.push(tails_index.len() as u16);
        let Some(unit) = labelled.get(&symbol).map(std::slice::from_ref) else {
            continue;
        };
        let longer = tokens.range(unit..).take_while(|it| it.starts_with(unit));
        for &text in [&unit].into_iter().chain(longer) {
            labels_of.insert(text, tails_index.len());
            tails_index.push(u16::try_from(tails.len()).expect("16 bits"));
            tails.extend(&text[1..]);
        }
    }
    let escape = tails_index.len();
    symbol_labels.push(escape as u16);
    tails_index.push(tails.len() as u16);

    let (mut labels, mut is_first, mut blocks) = (Bits::default(), Bits::default(), Vec::new());
    let mut values = Vec::new();
    let mut queue: VecDeque<_> = second_nodes.iter().map(|&it| Below::Children(it)).collect();
    let (mut count, mut parents, mut ends, mut at_start) = (0, 0u64, 0u64, [0; 2]);
    let mut values_of_seconds = 0;
    while let Some(below) = queue.pop_front() {
        let bit = 1 << (count % 64);
        let after = |node: Node<'_>, parts: Vec<usize>| parts.is_empty().then_some(node.depth);
        let mut edges = match below {
            Below::Children(node) => {
                if let Some(value) = node.value() {
                    ends |= bit;
                    values.push(value);
                }
                let edges = sorted_children(node).into_iter().map(|child| {
                    let path = &child.end_of_path().text()[node.depth..];
                    (
                        child,
                        alphabet.parse(path, &tokens).into_iter().rev().collect(),
                    )
                });
                edges.collect()
            }
            Below::Parts(node, parts) => vec![(
                Node {
                    depth: node.depth + 1,
                    ..node
                },
                parts,
            )],
            Below::Rare(edges) => {
                parents |= bit;
                for (i, (child, mut parts)) in edges.into_iter().enumerate() {
                    parts.pop();
                    labels.push(
                        (symbol_of(&child) - alphabet.rare_symbols) % (1 << label_bits),
                        label_bits,
                    );
                    is_first.push((i == 0).into(), 1);
                    queue.push_back(match after(child, parts.clone()) {
                        Some(_) => Below::Children(child),
                        None => Below::Parts(child, parts),
                    });
                }
                Vec::new()
            }
        };
        let rare =
            edges.split_off(edges.partition_point(|it| symbol_of(&it.0) < alphabet.rare_symbols));
        let has_common = !edges.is_empty();
        for (i, (child, mut parts)) in edges.into_iter().enumerate() {
            let end = Node {
                depth: child.depth - 1 + parts.pop().expect("a part"),
                ..child
            };
            labels.push(labels_of[&end.text()[child.depth - 1..]], label_bits);
            is_first.push((i == 0).into(), 1);
            queue.push_back(if parts.is_empty() {
                Below::Children(end)
            } else {
                Below::Parts(end, parts)
            });
        }
        if has_common || !rare.is_empty() {
            parents |= bit;
        }
        let high = |it: &(Node, _)| (symbol_of(&it.0) - alphabet.rare_symbols) >> label_bits;
        for (i, group) in rare.chunk_by(|a, b| high(a) == high(b)).enumerate() {
            labels.push(escape + high(&group[0]), label_bits);
            is_first.push((!has_common && i == 0).into(), 1);
            queue.push_back(Below::Rare(group.into()));
        }
        count += 1;
        if count == second_nodes.len() {
            values_of_seconds = values.len();
        }
        if count % (1 << BLOCK_SHIFT) == 0 || queue.is_empty() {
            blocks.extend(std::mem::take(&mut parents).to_le_bytes());
            blocks.extend(std::mem::take(&mut ends).to_le_bytes());
            let numbers = at_start.iter().take(1 + usize::from(has_values));
            blocks.extend(numbers.flat_map(|it: &usize| it.to_le_bytes().into_iter().take(3)));
            at_start = [is_first.count, values.len()];
        }
    }
    is_first.push(1, 1);

    let [pages, entries, symbol_values] = write_units(root, &alphabet);
    let (of_seconds, of_others) = values.split_at(values_of_seconds);
    let [values, common_values, rare_values] = match has_values {
        true => write_values(of_seconds, of_others),
        false => Default::default(),
    };
    let parts = [
        pages,
        entries,
        symbol_values,
        index.bytes,
        seconds,
        maps,
        blocks,
        is_first.bytes,
        labels.bytes,
        to_bytes(&symbol_labels),
        to_bytes(&tails_index),
        to_bytes(&tails),
        values,
        common_values,
        rare_values,
    ];
    let mut fields = vec![4 * Dictionary::FIELDS];
    parts
        .iter()
        .for_each(|it| fields.push(fields[fields.len() - 1] + it.len()));
    fields.extend([
        alphabet.first_symbols,
        second_nodes.len(),
        map_size,
        label_bits,
        alphabet.rare_symbols,
        escape,
    ]);
    let fields = fields.into_iter().flat_map(|it| (it as u32).to_le_bytes());
    [fields.collect(), parts.concat(), vec![u8::MAX; 8]].concat()
}

/// Compares the results for each word, and for each word with another unit in each place.
fn verify(bytes: &[u8], words: &[Entry]) {
    let dictionary = Dictionary::new(bytes).expect("a header");
    let set: BTreeMap<_, _> = words.iter().map(|it| (&it.0[..], it.1 as u8)).collect();
    let check = |text: &[u16]| {
        let after = words.partition_point(|it| &it.0[..] <= text);
        let common = |i: usize| {
            words.get(i).map_or(0, |it| {
                it.0.iter().zip(text).take_while(|(a, b)| a == b).count()
            })
        };
        let common = common(after.wrapping_sub(1)).max(common(after));
        let prefix = &text[..common];
        let longer = words.partition_point(|it| &it.0[..] <= prefix);
        let has_longer = words.get(longer).is_some_and(|it| it.0.starts_with(prefix));
        let read = text.len().min(common + usize::from(has_longer));
        let found = (1..=common).filter_map(|it| Some((it, *set.get(&text[..it])?)));
        let mut actual = Vec::new();
        let actually_read = dictionary.matches(text, |length, value| actual.push((length, value)));
        assert!(
            (actually_read, actual) == (read, found.collect()),
            "{text:x?}"
        );
    };
    for (i, (word, _)) in words.iter().enumerate() {
        let other = &words[i * 7919 % words.len()].0;
        for at in 0..=word.len() {
            check(&word[..at]);
            check(&[&word[..at], other].concat());
            check(&[&word[at..], other].concat());
        }
    }
}

pub(crate) fn pack(file: &[u8]) -> Vec<u8> {
    let (mut words, has_values) = read_words(file);
    if has_values {
        words = useful(&words);
    }
    let ways: &[_] = if has_values {
        &[(12, 2200), (12, 2400), (12, 2600)]
    } else {
        &[(8, 256), (9, 256), (10, 256), (11, 256)]
    };
    let ways = crate::parallel::map(ways, |&(bits, rare)| write(&words, has_values, bits, rare));
    let bytes = ways.into_iter().min_by_key(Vec::len).expect("a way");
    verify(&bytes, &words);
    let mut header = split_header(file).0;
    header[12..16].copy_from_slice(&DATA_FORMAT);
    [header, bytes].concat()
}
