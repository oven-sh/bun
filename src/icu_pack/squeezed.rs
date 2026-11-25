//! Replaces what repeats in an item by copies.

use crate::codes::push_number;
use bun_icu_format::squeezed::command::*;
use bun_icu_format::squeezed::{MAX_ITEMS, Squeezed};
use std::collections::BTreeMap;

const MAX_LITERALS: usize = NARROW as usize;
const SHORT_COPIES: usize = (LONG_COPY - COPY) as usize;

fn command(bytes: &[u8], at: usize, length: usize, kind: Kind) -> Vec<u8> {
    let covered = &bytes[at..at + length];
    match kind {
        Kind::Literal => [&[length as u8 - 1], covered].concat(),
        Kind::Narrow => {
            let head = NARROW + (length / 2 - 1) as u8;
            [head]
                .into_iter()
                .chain(covered.iter().copied().step_by(2))
                .collect()
        }
        Kind::Copy { distance } => {
            let more = length - MIN_COPY;
            let mut command = vec![COPY + more.min(SHORT_COPIES) as u8];
            if more >= SHORT_COPIES {
                push_number(&mut command, more - SHORT_COPIES);
            }
            push_number(&mut command, distance - 1);
            command
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Literal,
    Narrow,
    Copy { distance: usize },
}

/// For each place from `start` on: the longest copy for each size of a distance.
fn copies(bytes: &[u8], start: usize) -> Vec<Vec<(usize, usize)>> {
    let mut places: BTreeMap<&[u8; MIN_COPY], Vec<usize>> = BTreeMap::new();
    let mut all = Vec::new();
    for (at, key) in bytes.array_windows().enumerate() {
        let earlier = places.entry(key).or_default();
        let mut best = BTreeMap::new();
        for &from in earlier.iter().rev().take(2000).filter(|_| at >= start) {
            let length = bytes[at..]
                .iter()
                .zip(&bytes[from..])
                .take_while(|(a, b)| a == b)
                .count();
            let known = best
                .entry((at - from - 1).max(1).ilog2() / 7)
                .or_insert((0, 0));
            if length > known.0 {
                *known = (length, at - from);
            }
        }
        earlier.push(at);
        all.push(best.into_values().collect());
    }
    all.resize(bytes.len(), Vec::new());
    all
}

pub(crate) fn squeeze(number: usize, base: &[u8], item: &[u8]) -> Vec<u8> {
    let bytes = [base, item].concat();
    let copies = copies(&bytes, base.len());
    let mut best = vec![(0, 0, Kind::Literal); bytes.len() + 1];
    for at in (base.len()..bytes.len()).rev() {
        let literals = (1..=MAX_LITERALS.min(bytes.len() - at)).map(|it| (it, Kind::Literal));
        let units = bytes[at..].as_chunks::<2>().0.iter().take(MAX_LITERALS);
        let narrow =
            (1..=units.take_while(|it| it[1] == 0).count()).map(|it| (2 * it, Kind::Narrow));
        let copies = copies[at].iter().flat_map(|&(longest, distance)| {
            let lengths = (MIN_COPY..longest.min(64)).chain([longest]);
            lengths.map(move |it| (it, Kind::Copy { distance }))
        });
        let ways = literals.chain(narrow).chain(copies).map(|(length, kind)| {
            (
                best[at + length].0 + command(&bytes, at, length, kind).len(),
                length,
                kind,
            )
        });
        best[at] = ways.min().expect("a way");
    }
    let mut squeezed = Vec::new();
    assert!(number < MAX_ITEMS && item.len().is_multiple_of(2));
    [number, item.len(), base.len()]
        .into_iter()
        .for_each(|it| push_number(&mut squeezed, it));
    let mut at = base.len();
    while at < bytes.len() {
        squeezed.extend(command(&bytes, at, best[at].1, best[at].2));
        at += best[at].1;
    }
    let mut expanded = [base, &vec![0; item.len()]].concat();
    Squeezed::new(&squeezed).expand(&mut expanded);
    assert!(expanded == bytes);
    squeezed
}
