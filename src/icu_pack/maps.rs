//! Learns which character takes the place of which in another language.

use crate::codes::{push_number, to_bytes};
use bun_icu_format::model::Map;
use std::cmp::Reverse;
use std::collections::BTreeMap;

const SPACE: u16 = b' ' as u16;

/// Calls `seen(theirs, own)` for the characters that seem to correspond if `theirs` is read as `mapped`.
fn align(theirs: &[u16], mapped: &[u16], own: &[u16], seen: &mut impl FnMut(u16, u16)) {
    let (mut at, mut is_aligned) = (0, true);
    for &unit in own {
        let is_at = |at: usize| mapped.get(at) == Some(&unit);
        if (is_aligned || is_at(at))
            && let Some(&theirs) = theirs.get(at)
        {
            seen(theirs, unit);
        }
        let next_space = || (at..mapped.len()).find(|&at| mapped[at] == SPACE);
        (at, is_aligned) = if let Some(found) = (at..at + 3).find(|&at| is_at(at)) {
            (found + 1, true)
        } else if is_at(at.wrapping_sub(1)) {
            (at, true)
        } else if unit == SPACE {
            next_space().map_or((at + 1, false), |at| (at + 1, true))
        } else {
            (at + usize::from(mapped.get(at) != Some(&SPACE)), false)
        };
    }
}

/// Returns the replacements for `pairs` of their text and the own one, with how often each predicts more than none.
fn replacements(pairs: &[(&[u16], &[u16])]) -> BTreeMap<u16, (u16, usize)> {
    let mut map = BTreeMap::new();
    for round in 0..4 {
        let mut seen = Vec::new();
        for &(theirs, own) in pairs {
            if round == 0 {
                let count = if theirs.len() == own.len() {
                    own.len()
                } else {
                    1
                };
                seen.extend(theirs.iter().copied().zip(own.iter().copied()).take(count));
            } else {
                let mapped = theirs
                    .iter()
                    .map(|it| map.get(it).map_or(*it, |&(to, _)| to));
                let mapped: Vec<_> = mapped.collect();
                align(theirs, &mapped, own, &mut |a, b| seen.push((a, b)));
            }
        }
        seen.sort_unstable();
        map.clear();
        for of_unit in seen.chunk_by(|a, b| a.0 == b.0) {
            let best = of_unit.chunk_by(|a, b| a == b).max_by_key(|run| run.len());
            let (best, same) = (
                best.expect("a run"),
                of_unit.iter().filter(|it| it.0 == it.1),
            );
            if let gain @ 3.. = best.len() - same.count() {
                map.insert(best[0].0, (best[0].1, gain));
            }
        }
    }
    map
}

/// Returns the multiplier, the number of pairs and the pairs, as a model has them.
pub(crate) fn learn(pairs: &[(&[u16], &[u16])]) -> Vec<u8> {
    // So many characters have to be predicted to make up for the room of a pair.
    const COST_OF_PAIR: usize = 10;
    let replacements = replacements(pairs).into_iter();
    let mut replacements: Vec<_> = replacements.filter(|it| it.1.1 > COST_OF_PAIR).collect();
    replacements.sort_by_key(|it| Reverse(it.1.1));
    let fill = |multiplier: u16, size: usize| {
        let (mut table, mut gain) = (vec![[0; 2]; size], 0);
        for &(from, (to, predicted)) in &replacements {
            let pair = &mut table[Map::index_of(multiplier, size, from)];
            if *pair == [0; 2] {
                (*pair, gain) = ([from, to], gain + predicted);
            }
        }
        (gain.saturating_sub(COST_OF_PAIR * size), table)
    };
    let sizes = (2..=8).map(|quarters| replacements.len() * quarters / 4);
    let sizes = sizes.filter(|&size| size > 0);
    let choices = sizes.flat_map(|size| (1..=u16::MAX).step_by(61).map(move |it| (it, size)));
    let best = choices.max_by_key(|&(multiplier, size)| fill(multiplier, size).0);
    let best = best.filter(|&(multiplier, size)| fill(multiplier, size).0 > 0);
    let (multiplier, table) = best.map_or((0, Vec::new()), |it| (it.0, fill(it.0, it.1).1));
    let mut map = Vec::new();
    push_number(&mut map, multiplier.into());
    push_number(&mut map, table.len());
    map.extend(to_bytes(table.as_flattened()));
    map
}
