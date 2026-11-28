//! Tells how the table of a tailoring for fast Latin comparisons differs from that of the root.

use crate::codes::{push_number, to_bytes};
use bun_icu_format::collation::fast_latin::{MIN_SHORT, WEIGHTS};
use std::collections::BTreeMap;

fn units(bytes: &[u8]) -> Vec<u16> {
    bytes
        .as_chunks()
        .0
        .iter()
        .map(|&it| u16::from_le_bytes(it))
        .collect()
}

pub(crate) fn changes(root: &[u8], own: &[u8]) -> Vec<u8> {
    let (mut predicted, own) = (units(root), units(own));
    if own.is_empty() {
        return Vec::new();
    }
    predicted.resize(own.len(), 0);
    let mut changes = Vec::new();
    push_number(&mut changes, own.len());
    let short: Vec<_> = (0..own.len())
        .filter(|&i| predicted[i] >= MIN_SHORT)
        .collect();
    for (shift, bits) in WEIGHTS {
        let weight = |unit: u16| (unit >> shift) % (1 << bits);
        let mut votes = BTreeMap::new();
        for &i in short.iter().filter(|&&i| own[i] >= MIN_SHORT) {
            *votes
                .entry((weight(predicted[i]), weight(own[i])))
                .or_insert(0) += 1;
        }
        let (mut steps, mut offset, mut new) = (Vec::new(), 0, Vec::new());
        for old in 0..1 << bits {
            let best = votes.range((old, 0)..(old + 1, 0)).max_by_key(|it| it.1);
            let next = best.map_or(offset, |it| it.0.1.wrapping_sub(old) as u8);
            if next != offset {
                steps.extend([old as u8, next]);
                offset = next;
            }
            new.push(u16::from((old as u8).wrapping_add(offset)));
        }
        push_number(&mut changes, steps.len() / 2);
        changes.extend(steps);
        for &i in &short {
            let old = weight(predicted[i]);
            predicted[i] = predicted[i] ^ old << shift | new[usize::from(old)] << shift;
        }
    }
    let differing = |end: usize| (0..end).filter(|&i| predicted[i] != own[i]);
    let end = (0..=own.len()).min_by_key(|&end| 3 * differing(end).count() + 2 * (own.len() - end));
    let (end, mut singles, mut last) = (end.expect("an end"), Vec::new(), 0);
    for at in differing(end) {
        while last != at {
            let distance = (at - last).min(u8::MAX.into());
            last += distance;
            singles.push(distance as u8);
            singles.extend(own[last].to_le_bytes());
        }
    }
    push_number(&mut changes, singles.len() / 3);
    [changes, singles, to_bytes(&own[end..])].concat()
}
